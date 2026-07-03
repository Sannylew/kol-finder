"""
后台登录鉴权。单管理员账号，密码哈希存数据库，登录发 JWT。
仅用于保护「后台设置」相关接口。
"""
import hashlib
import hmac
import logging
import secrets
import time

import jwt
from fastapi import Header, HTTPException

import config
from db import Base, SessionLocal, engine
from sqlalchemy import String, select
from sqlalchemy.orm import Mapped, mapped_column

logger = logging.getLogger("kol.auth")

# JWT 密钥：优先环境变量（config 统一读取），否则用持久化随机串
_SECRET = config.AUTH_SECRET
TOKEN_TTL = 7 * 24 * 3600  # 7 天

DEFAULT_USERNAME = "admin"
DEFAULT_PASSWORD = "admin123"


class AdminUser(Base):
    __tablename__ = "admin_user"
    username: Mapped[str] = mapped_column(String(64), primary_key=True)
    pwd_hash: Mapped[str] = mapped_column(String(255))
    salt: Mapped[str] = mapped_column(String(64))


class AuthMeta(Base):
    __tablename__ = "auth_meta"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(String(255))


def _hash(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode(), salt.encode(), 100_000
    ).hex()


# 登录失败限流：{username: (失败次数, 锁定到的时间戳)}
_LOGIN_FAILS: dict[str, list] = {}
_MAX_FAILS = 5
_LOCK_SECONDS = 300  # 锁 5 分钟


def _check_lock(username: str):
    rec = _LOGIN_FAILS.get(username)
    if rec and rec[0] >= _MAX_FAILS:
        if time.time() < rec[1]:
            wait = int(rec[1] - time.time())
            raise HTTPException(status_code=429, detail=f"登录失败次数过多，请 {wait} 秒后再试")
        # 锁定已过期，重置计数，重新给予机会
        _LOGIN_FAILS.pop(username, None)


def _record_fail(username: str):
    rec = _LOGIN_FAILS.get(username, [0, 0])
    rec[0] += 1
    if rec[0] >= _MAX_FAILS:
        rec[1] = time.time() + _LOCK_SECONDS
    _LOGIN_FAILS[username] = rec


def _clear_fail(username: str):
    _LOGIN_FAILS.pop(username, None)


def _get_secret(session) -> str:
    if _SECRET:
        return _SECRET
    row = session.get(AuthMeta, "jwt_secret")
    if row:
        return row.value
    s = secrets.token_hex(32)
    session.add(AuthMeta(key="jwt_secret", value=s))
    session.commit()
    return s


def _get_pwd_version(session, username: str) -> int:
    """密码版本号：改密码后递增，使旧 token 失效。"""
    row = session.get(AuthMeta, f"pwd_ver:{username}")
    return int(row.value) if row else 0


def _bump_pwd_version(session, username: str) -> None:
    key = f"pwd_ver:{username}"
    row = session.get(AuthMeta, key)
    if row:
        row.value = str(int(row.value) + 1)
    else:
        session.add(AuthMeta(key=key, value="1"))


def init_auth() -> None:
    Base.metadata.create_all(engine, tables=[AdminUser.__table__, AuthMeta.__table__])
    with SessionLocal() as session:
        exists = session.scalar(select(AdminUser).limit(1))
        if not exists:
            init_pwd = config.ADMIN_INIT_PASSWORD or DEFAULT_PASSWORD
            is_default = not config.ADMIN_INIT_PASSWORD
            salt = secrets.token_hex(16)
            session.add(AdminUser(
                username=DEFAULT_USERNAME,
                pwd_hash=_hash(init_pwd, salt),
                salt=salt,
            ))
            # 标记是否仍为默认密码：登录后前台温和提示（不强制）
            session.add(AuthMeta(
                key=f"must_change:{DEFAULT_USERNAME}",
                value="1" if is_default else "0",
            ))
            session.commit()
            if is_default:
                logger.warning(
                    "已创建默认管理员 %s / %s，建议尽快修改密码",
                    DEFAULT_USERNAME, DEFAULT_PASSWORD,
                )
            else:
                logger.info("已创建管理员 %s（使用 ADMIN_INIT_PASSWORD）", DEFAULT_USERNAME)


def must_change_password(username: str) -> bool:
    with SessionLocal() as session:
        row = session.get(AuthMeta, f"must_change:{username}")
        return bool(row and row.value == "1")


def _clear_must_change(session, username: str) -> None:
    row = session.get(AuthMeta, f"must_change:{username}")
    if row:
        row.value = "0"


def login(username: str, password: str) -> str:
    _check_lock(username)
    with SessionLocal() as session:
        user = session.get(AdminUser, username)
        if not user or not hmac.compare_digest(user.pwd_hash, _hash(password, user.salt)):
            _record_fail(username)
            logger.warning("登录失败: username=%s", username)
            raise HTTPException(status_code=401, detail="用户名或密码错误")
        _clear_fail(username)
        secret = _get_secret(session)
        pwd_ver = _get_pwd_version(session, username)
    logger.info("登录成功: username=%s", username)
    payload = {
        "sub": username,
        "pv": pwd_ver,
        "exp": int(time.time()) + TOKEN_TTL,
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def change_password(username: str, old_pwd: str, new_pwd: str) -> None:
    if len(new_pwd) < 6:
        raise HTTPException(status_code=400, detail="新密码至少 6 位")
    with SessionLocal() as session:
        user = session.get(AdminUser, username)
        if not user or not hmac.compare_digest(user.pwd_hash, _hash(old_pwd, user.salt)):
            raise HTTPException(status_code=401, detail="原密码错误")
        user.salt = secrets.token_hex(16)
        user.pwd_hash = _hash(new_pwd, user.salt)
        _bump_pwd_version(session, username)  # 使旧 token 失效
        _clear_must_change(session, username)  # 清除强制改密标记
        session.commit()
    logger.info("密码已修改: username=%s", username)


def reset_password(username: str, new_pwd: str) -> None:
    """管理员忘记密码时，由命令行脚本调用强制重置（无需原密码）。"""
    if len(new_pwd) < 6:
        raise ValueError("新密码至少 6 位")
    with SessionLocal() as session:
        user = session.get(AdminUser, username)
        salt = secrets.token_hex(16)
        if user:
            user.salt = salt
            user.pwd_hash = _hash(new_pwd, salt)
        else:
            session.add(AdminUser(username=username, pwd_hash=_hash(new_pwd, salt), salt=salt))
        _bump_pwd_version(session, username)  # 使旧 token 失效
        _clear_must_change(session, username)  # 清除强制改密标记
        session.commit()


def verify_token(authorization: str = Header(default="")) -> str:
    """依赖项：校验请求头里的 Bearer token。"""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未登录")
    token = authorization[7:]
    with SessionLocal() as session:
        secret = _get_secret(session)
        try:
            payload = jwt.decode(token, secret, algorithms=["HS256"])
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="登录已过期，请重新登录")
        except jwt.InvalidTokenError:
            raise HTTPException(status_code=401, detail="无效的登录凭证")
        username = payload.get("sub", "")
        # 校验密码版本：改密码后旧 token 失效
        if payload.get("pv", 0) != _get_pwd_version(session, username):
            raise HTTPException(status_code=401, detail="登录已失效，请重新登录")
    return username


def is_logged_in(authorization: str = Header(default="")) -> bool:
    """可选鉴权：返回是否为有效登录态，不强制（用于按身份决定是否脱敏）。"""
    if not authorization.startswith("Bearer "):
        return False
    token = authorization[7:]
    try:
        with SessionLocal() as session:
            secret = _get_secret(session)
            payload = jwt.decode(token, secret, algorithms=["HS256"])
            username = payload.get("sub", "")
            if payload.get("pv", 0) != _get_pwd_version(session, username):
                return False
        return True
    except Exception:  # noqa: BLE001
        return False

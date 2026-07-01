"""
运维功能：日志查看 + 数据库备份。供后台管理（需登录）调用。

备份策略：调用宿主机 docker exec 容器内的 pg_dump 导出 SQL，gzip 压缩存到 backups/。
日志：读取 logging_setup 写入的 app.log。
"""
import gzip
import logging
import re
import subprocess
from datetime import datetime
from pathlib import Path

import config
from logging_setup import LOG_FILE

logger = logging.getLogger("kol.maintenance")

BACKUP_DIR = Path(__file__).with_name("backups")
BACKUP_DIR.mkdir(exist_ok=True)

# 备份文件名规则：db-YYYYmmdd-HHMMSS.sql.gz
_BACKUP_NAME_RE = re.compile(r"^db-\d{8}-\d{6}\.sql\.gz$")


def tail_log(lines: int = 200, level: str = "") -> dict:
    """读取日志文件末尾若干行。level 可选过滤（INFO/WARNING/ERROR）。"""
    lines = max(1, min(lines, 2000))
    if not LOG_FILE.exists():
        return {"lines": [], "total": 0, "file": str(LOG_FILE)}

    # 读取全部行后取末尾（日志已轮转，单文件不大，安全）
    with LOG_FILE.open("r", encoding="utf-8", errors="replace") as f:
        all_lines = f.readlines()

    if level:
        lv = level.strip().upper()
        all_lines = [ln for ln in all_lines if f" {lv} " in ln or f" {lv:<7} " in ln]

    tail = [ln.rstrip("\n") for ln in all_lines[-lines:]]
    return {"lines": tail, "total": len(tail), "file": str(LOG_FILE)}


def list_backups() -> list[dict]:
    """列出已有备份，按时间倒序。"""
    out = []
    for p in sorted(BACKUP_DIR.glob("db-*.sql.gz"), reverse=True):
        if not _BACKUP_NAME_RE.match(p.name):
            continue
        st = p.stat()
        out.append({
            "name": p.name,
            "size": st.st_size,
            "created_at": datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds"),
        })
    return out


def create_backup() -> dict:
    """执行一次数据库备份。返回备份文件信息。"""
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = BACKUP_DIR / f"db-{stamp}.sql.gz"

    cmd = ["docker", "exec", config.PG_CONTAINER,
           "pg_dump", "-U", config.PG_USER, config.PG_DB]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=300)
    except FileNotFoundError as e:
        raise RuntimeError("未找到 docker 命令，无法在容器内备份") from e
    except subprocess.TimeoutExpired as e:
        raise RuntimeError("备份超时") from e

    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="replace")[:300]
        raise RuntimeError(f"pg_dump 失败: {err}")

    with gzip.open(target, "wb") as f:
        f.write(proc.stdout)

    st = target.stat()
    logger.info("已创建备份: %s (%d 字节)", target.name, st.st_size)
    return {
        "name": target.name,
        "size": st.st_size,
        "created_at": datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds"),
    }


def _safe_backup_path(name: str) -> Path:
    """校验备份文件名合法且在 backups/ 内，防路径穿越。"""
    if not _BACKUP_NAME_RE.match(name):
        raise ValueError("非法的备份文件名")
    path = (BACKUP_DIR / name).resolve()
    if path.parent != BACKUP_DIR.resolve():
        raise ValueError("非法的备份路径")
    if not path.exists():
        raise FileNotFoundError("备份文件不存在")
    return path


def get_backup_path(name: str) -> Path:
    """供下载使用，返回校验后的安全路径。"""
    return _safe_backup_path(name)


def delete_backup(name: str) -> None:
    path = _safe_backup_path(name)
    path.unlink()
    logger.info("已删除备份: %s", name)


# 恢复上传文件大小上限（数据库 dump，给 50MB 余量）
MAX_RESTORE_BYTES = 50 * 1024 * 1024


def _run_psql(sql_bytes: bytes) -> None:
    """把 SQL 通过 stdin 喂给容器内的 psql 执行。出错即抛异常。"""
    cmd = ["docker", "exec", "-i", config.PG_CONTAINER,
           "psql", "-U", config.PG_USER, "-d", config.PG_DB,
           "-v", "ON_ERROR_STOP=1"]
    try:
        proc = subprocess.run(cmd, input=sql_bytes, capture_output=True, timeout=300)
    except FileNotFoundError as e:
        raise RuntimeError("未找到 docker 命令，无法恢复") from e
    except subprocess.TimeoutExpired as e:
        raise RuntimeError("恢复超时") from e
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="replace")[:300]
        raise RuntimeError(f"psql 恢复失败: {err}")


def _restore_sql(sql_body: bytes) -> None:
    """重置 public schema 后导入 SQL（整库回滚到备份时刻）。"""
    reset = b"DROP SCHEMA IF EXISTS public CASCADE;\nCREATE SCHEMA public;\n"
    _run_psql(reset + sql_body)


def restore_backup(name: str) -> dict:
    """从已有备份恢复。恢复前自动先做一次快照，便于回滚。"""
    path = _safe_backup_path(name)

    # 恢复前快照
    safety = create_backup()
    logger.warning("恢复前已自动快照: %s", safety["name"])

    with gzip.open(path, "rb") as f:
        sql_body = f.read()
    _restore_sql(sql_body)
    logger.warning("已从备份恢复数据库: %s", name)
    return {"restored": name, "safety_backup": safety["name"]}


def restore_from_bytes(raw: bytes) -> dict:
    """从上传的 .sql.gz 字节恢复。先校验、落盘为备份，再恢复。"""
    if len(raw) > MAX_RESTORE_BYTES:
        raise ValueError("备份文件过大")
    # 校验 gzip 魔数
    if raw[:2] != b"\x1f\x8b":
        raise ValueError("不是有效的 .sql.gz 备份文件")
    try:
        sql_body = gzip.decompress(raw)
    except (OSError, EOFError) as e:
        raise ValueError("备份文件已损坏或格式不正确") from e
    # 简单内容校验：应包含建表/复制等 SQL 关键字，避免随意文件
    head = sql_body[:4096].decode("utf-8", errors="replace").upper()
    if not any(kw in head for kw in ("CREATE TABLE", "COPY ", "INSERT INTO", "PostgreSQL".upper())):
        raise ValueError("文件内容不像数据库备份")

    # 落盘为一个新备份（便于追溯）
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = BACKUP_DIR / f"db-{stamp}.sql.gz"
    with gzip.open(target, "wb") as f:
        f.write(sql_body)

    # 恢复前快照
    safety = create_backup()
    logger.warning("上传恢复前已自动快照: %s", safety["name"])

    _restore_sql(sql_body)
    logger.warning("已从上传文件恢复数据库: %s", target.name)
    return {"restored": target.name, "safety_backup": safety["name"]}

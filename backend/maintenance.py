"""
运维功能：日志查看 + 数据库备份。供后台管理（需登录）调用。

备份策略：把 SQLite 数据文件安全导出并 gzip 压缩存到 backups/。
日志：读取 logging_setup 写入的 app.log。
"""
import gzip
import logging
import re
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

import config
from logging_setup import LOG_FILE

logger = logging.getLogger("kol.maintenance")

BACKUP_DIR = Path(__file__).with_name("backups")
BACKUP_DIR.mkdir(exist_ok=True)

# 备份文件名规则：db-YYYYmmdd-HHMMSS[-N].db.gz
_BACKUP_NAME_RE = re.compile(r"^db-\d{8}-\d{6}(-\d+)?\.db\.gz$")


def _unique_backup_path(stamp: str) -> Path:
    """生成不冲突的备份路径（同秒多次备份时加序号，避免覆盖）。"""
    target = BACKUP_DIR / f"db-{stamp}.db.gz"
    n = 1
    while target.exists():
        target = BACKUP_DIR / f"db-{stamp}-{n}.db.gz"
        n += 1
    return target


def tail_log(lines: int = 200, level: str = "") -> dict:
    """读取日志文件末尾若干行。level 可选过滤（INFO/WARNING/ERROR）。"""
    lines = max(1, min(lines, 2000))
    if not LOG_FILE.exists():
        return {"lines": [], "total": 0, "file": str(LOG_FILE)}

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
    for p in sorted(BACKUP_DIR.glob("db-*.db.gz"), reverse=True):
        if not _BACKUP_NAME_RE.match(p.name):
            continue
        st = p.stat()
        out.append({
            "name": p.name,
            "size": st.st_size,
            "created_at": datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds"),
        })
    return out


def _dump_sqlite() -> bytes:
    """用 SQLite 在线备份 API 导出一致性快照，返回 db 文件字节。"""
    src_path = config.DB_FILE
    if not src_path or not Path(src_path).exists():
        raise RuntimeError("未找到 SQLite 数据文件，无法备份")
    tmp = BACKUP_DIR / f".snapshot-{datetime.now().strftime('%Y%m%d%H%M%S%f')}.db"
    try:
        src = sqlite3.connect(src_path)
        dst = sqlite3.connect(str(tmp))
        with dst:
            src.backup(dst)          # 在线一致性备份（不锁死主库）
        src.close()
        dst.close()
        return tmp.read_bytes()
    finally:
        tmp.unlink(missing_ok=True)


def create_backup() -> dict:
    """执行一次数据库备份。返回备份文件信息。"""
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = _unique_backup_path(stamp)

    data = _dump_sqlite()
    with gzip.open(target, "wb") as f:
        f.write(data)

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


# 恢复上传文件大小上限（SQLite db，给 50MB 余量）
MAX_RESTORE_BYTES = 50 * 1024 * 1024


def _restore_db_bytes(db_bytes: bytes) -> None:
    """用 db 文件字节覆盖当前 SQLite 数据库（整库回滚到备份时刻）。"""
    from db import engine  # 延迟导入，避免循环依赖
    src_path = config.DB_FILE
    if not src_path:
        raise RuntimeError("非 SQLite 部署，无法用文件恢复")

    # 校验：字节必须是合法 SQLite 文件（能打开且能查询）
    tmp = BACKUP_DIR / f".restore-{datetime.now().strftime('%Y%m%d%H%M%S%f')}.db"
    try:
        tmp.write_bytes(db_bytes)
        conn = sqlite3.connect(str(tmp))
        conn.execute("SELECT count(*) FROM sqlite_master")
        conn.close()
    except sqlite3.DatabaseError as e:
        tmp.unlink(missing_ok=True)
        raise ValueError("不是有效的 SQLite 数据库文件") from e

    # 释放当前所有连接，覆盖主库文件，清理 WAL 附属文件
    engine.dispose()
    shutil.move(str(tmp), src_path)
    for suffix in ("-wal", "-shm"):
        p = Path(src_path + suffix)
        p.unlink(missing_ok=True)


def restore_backup(name: str) -> dict:
    """从已有备份恢复。恢复前自动先做一次快照，便于回滚。"""
    path = _safe_backup_path(name)

    safety = create_backup()
    logger.warning("恢复前已自动快照: %s", safety["name"])

    with gzip.open(path, "rb") as f:
        db_bytes = f.read()
    _restore_db_bytes(db_bytes)
    logger.warning("已从备份恢复数据库: %s", name)
    return {"restored": name, "safety_backup": safety["name"]}


def restore_from_bytes(raw: bytes) -> dict:
    """从上传的 .db.gz 字节恢复。先校验、落盘为备份，再恢复。"""
    if len(raw) > MAX_RESTORE_BYTES:
        raise ValueError("备份文件过大")
    if raw[:2] != b"\x1f\x8b":
        raise ValueError("不是有效的 .db.gz 备份文件")
    try:
        db_bytes = gzip.decompress(raw)
    except (OSError, EOFError) as e:
        raise ValueError("备份文件已损坏或格式不正确") from e
    # SQLite 文件头魔数校验
    if db_bytes[:16] != b"SQLite format 3\x00":
        raise ValueError("文件内容不是 SQLite 数据库")

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = _unique_backup_path(stamp)
    with gzip.open(target, "wb") as f:
        f.write(db_bytes)

    safety = create_backup()
    logger.warning("上传恢复前已自动快照: %s", safety["name"])

    _restore_db_bytes(db_bytes)
    logger.warning("已从上传文件恢复数据库: %s", target.name)
    return {"restored": target.name, "safety_backup": safety["name"]}

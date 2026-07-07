"""
运维功能：日志查看 + 数据库备份。供后台管理（需登录）调用。

备份策略：把 SQLite 数据文件安全导出并 gzip 压缩存到 backups/。
日志：读取 logging_setup 写入的 app.log。
"""
import gzip
import logging
import os
import re
import shutil
import sqlite3
import subprocess
from datetime import datetime
from pathlib import Path

import config
from logging_setup import LOG_FILE

logger = logging.getLogger("kol.maintenance")

PROJECT_DIR = Path(__file__).resolve().parent.parent
UPDATE_UNIT = "kol-finder-update"
_VERSION_TAG_RE = re.compile(r"^v(\d+)\.(\d+)\.(\d+)(?:[-.][A-Za-z0-9]+)?$")

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


def _version_tuple(tag_or_version: str) -> tuple[int, int, int]:
    text = (tag_or_version or "").strip()
    if text and not text.startswith("v"):
        text = f"v{text}"
    match = _VERSION_TAG_RE.match(text)
    if not match:
        return (0, 0, 0)
    return tuple(int(part) for part in match.groups())


def _run_command(args: list[str], timeout: int = 15) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=str(PROJECT_DIR),
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
    )


def _latest_release_tag() -> str | None:
    if not shutil.which("git") or not (PROJECT_DIR / ".git").exists():
        return None
    result = _run_command(["git", "ls-remote", "--tags", "--refs", "origin", "v*"], timeout=20)
    if result.returncode != 0:
        logger.warning("检查远端版本失败: %s", (result.stderr or result.stdout).strip())
        return None

    tags: list[str] = []
    for line in result.stdout.splitlines():
        ref = line.rsplit("/", 1)[-1].strip()
        if _VERSION_TAG_RE.match(ref):
            tags.append(ref)
    if not tags:
        return None
    return max(tags, key=_version_tuple)


def _update_running() -> bool:
    if os.name == "nt" or not shutil.which("systemctl"):
        return False
    result = _run_command(["systemctl", "is-active", "--quiet", UPDATE_UNIT], timeout=5)
    return result.returncode == 0


def _unsupported_reason() -> str:
    if os.name == "nt":
        return "当前是 Windows 本地开发环境，不支持在后台直接执行服务器更新。"
    if not (PROJECT_DIR / ".git").exists():
        return "当前目录不是 Git 部署，不能通过后台拉取版本更新。"
    if not (PROJECT_DIR / "scripts" / "update.sh").exists():
        return "缺少 scripts/update.sh 更新脚本。"
    if not shutil.which("git"):
        return "服务器缺少 git 命令。"
    if not shutil.which("bash"):
        return "服务器缺少 bash 命令。"
    if not shutil.which("systemctl") or not shutil.which("systemd-run"):
        return "服务器未提供 systemd-run/systemctl，不能托管后台更新任务。"
    if hasattr(os, "geteuid") and os.geteuid() != 0:
        return "后端服务需要以 root 运行，或具备启动 systemd 更新任务的权限。"
    return ""


def update_status() -> dict:
    current = config.APP_VERSION
    reason = _unsupported_reason()
    supported = not reason
    latest = _latest_release_tag() if supported else None
    update_available = bool(latest and _version_tuple(latest) > _version_tuple(current))
    if supported:
        if not latest:
            reason = "未能获取远端最新版本，请检查服务器网络或 GitHub 访问。"
        elif update_available:
            reason = "发现可用更新。"
        else:
            reason = "当前已是最新版本。"
    return {
        "current_version": current,
        "latest_tag": latest,
        "latest_version": latest[1:] if latest and latest.startswith("v") else latest,
        "update_available": update_available,
        "supported": supported,
        "reason": reason,
        "running": _update_running(),
        "unit": UPDATE_UNIT,
    }


def start_update(target: str = "latest") -> dict:
    target = (target or "latest").strip()
    status = update_status()
    if not status["supported"]:
        raise RuntimeError(status["reason"])
    if status["running"]:
        raise RuntimeError("已有版本更新任务正在运行，请稍后再试。")

    if target == "latest":
        ref = status.get("latest_tag")
        if not ref:
            raise RuntimeError("未能获取远端最新版本，请稍后再试。")
        if not status["update_available"]:
            raise RuntimeError("当前已是最新版本，无需更新。")
    else:
        ref = target if target.startswith("v") else f"v{target}"
        if not _VERSION_TAG_RE.match(ref):
            raise ValueError("版本号格式必须类似 v1.3.0")

    script = PROJECT_DIR / "scripts" / "update.sh"
    args = [
        "systemd-run",
        f"--unit={UPDATE_UNIT}",
        "--collect",
        f"--property=WorkingDirectory={PROJECT_DIR}",
        "/usr/bin/env",
        "bash",
        str(script),
        str(ref),
    ]
    result = _run_command(args, timeout=20)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(detail or "启动更新任务失败")

    logger.warning("版本更新任务已启动: target=%s unit=%s", ref, UPDATE_UNIT)
    return {
        "ok": True,
        "target": str(ref),
        "unit": UPDATE_UNIT,
        "message": "版本更新任务已启动，服务会在更新过程中自动重启。",
    }

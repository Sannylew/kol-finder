"""
统一日志配置：控制台 + 文件轮转。

- 级别由环境变量 LOG_LEVEL 控制（默认 INFO）
- 文件写到 backend/logs/app.log，单文件 5MB，保留 5 份
- 同时覆盖 uvicorn 的访问/错误日志，避免重复或丢失
"""
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

import config

LOG_DIR = Path(__file__).with_name("logs")
LOG_FILE = LOG_DIR / "app.log"

_FORMAT = "%(asctime)s %(levelname)-7s [%(name)s] %(message)s"
_DATEFMT = "%Y-%m-%d %H:%M:%S"

_configured = False


def setup_logging() -> None:
    """初始化根日志。可重复调用，只生效一次。"""
    global _configured
    if _configured:
        return

    LOG_DIR.mkdir(exist_ok=True)
    level = getattr(logging, config.LOG_LEVEL, logging.INFO)

    formatter = logging.Formatter(_FORMAT, datefmt=_DATEFMT)

    console = logging.StreamHandler()
    console.setFormatter(formatter)

    file_handler = RotatingFileHandler(
        LOG_FILE, maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8"
    )
    file_handler.setFormatter(formatter)

    root = logging.getLogger()
    root.setLevel(level)
    # 避免重复添加 handler（reload 场景）
    root.handlers.clear()
    root.addHandler(console)
    root.addHandler(file_handler)

    # 让 uvicorn 的日志走同一套 handler
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        lg.handlers.clear()
        lg.propagate = True

    _configured = True
    logging.getLogger("kol").info("日志已初始化，级别=%s，文件=%s", config.LOG_LEVEL, LOG_FILE)

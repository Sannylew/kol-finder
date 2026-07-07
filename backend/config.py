"""
配置读取。优先读环境变量，其次读同目录下的 .env 文件。

推荐只配 2 个值：
  KDOCS_WEBHOOK_URL - 「复制脚本 webhook」拿到的完整链接（自动解析域名/file_id/script_id）
  KDOCS_TOKEN       - 生成的 APIToken（脚本令牌）
"""
import os
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent


def _load_dotenv() -> None:
    env_path = Path(__file__).with_name(".env")
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


_load_dotenv()

# 应用版本号：读取项目根目录的 VERSION 文件（供前端显示）
def _read_version() -> str:
    try:
        vf = Path(__file__).resolve().parent.parent / "VERSION"
        return vf.read_text(encoding="utf-8").strip() or "unknown"
    except Exception:  # noqa: BLE001
        return "unknown"


APP_VERSION = _read_version()

# 推荐：直接配置完整 webhook 链接
KDOCS_WEBHOOK_URL = os.environ.get("KDOCS_WEBHOOK_URL", "")

# APIToken（脚本令牌）
KDOCS_TOKEN = os.environ.get("KDOCS_TOKEN", "")

# 兼容：也可单独配置（一般留空即可）
KDOCS_FILE_ID = os.environ.get("KDOCS_FILE_ID", "")
KDOCS_SCRIPT_ID = os.environ.get("KDOCS_SCRIPT_ID", "")

# 同步间隔（秒），默认 5 分钟
SYNC_INTERVAL_SECONDS = int(os.environ.get("SYNC_INTERVAL_SECONDS", "300"))

# 运行环境：development / production。生产环境下缺失关键配置会直接拒绝启动。
APP_ENV = os.environ.get("APP_ENV", "development").strip().lower()
IS_PROD = APP_ENV in ("production", "prod")

def _sqlite_url(path: Path) -> str:
    return f"sqlite:///{path.as_posix()}"


def _normalize_database_url(raw_url: str) -> str:
    """Resolve relative SQLite paths against backend/ so config survives cwd changes."""
    raw_url = raw_url.strip()
    if not raw_url:
        return _sqlite_url(_BACKEND_DIR / "kol.db")
    if not raw_url.startswith("sqlite:///"):
        return raw_url

    db_path_raw = raw_url.replace("sqlite:///", "", 1)
    if not db_path_raw or db_path_raw == ":memory:":
        return raw_url

    db_path = Path(db_path_raw)
    if not db_path.is_absolute():
        parts = db_path.parts
        if parts and parts[0] == "backend":
            db_path = _BACKEND_DIR.parent / db_path
        else:
            db_path = _BACKEND_DIR / db_path
    return _sqlite_url(db_path.resolve())


# 数据库连接串。默认使用 backend 目录下的 SQLite 文件 kol.db。
# 也可用 DATABASE_URL 环境变量覆盖（例如指向其他路径或数据库）。
DATABASE_URL = _normalize_database_url(os.environ.get("DATABASE_URL", ""))

# JWT 密钥。生产环境必须设置 AUTH_SECRET，否则重启后已登录令牌全部失效。
AUTH_SECRET = os.environ.get("AUTH_SECRET", "").strip()
if IS_PROD and not AUTH_SECRET:
    raise RuntimeError(
        "生产环境必须设置 AUTH_SECRET 环境变量（用于签发登录令牌）。"
    )

# 首次启动创建的管理员初始密码。不设置则用内置默认（仅供开发/首次登录）。
ADMIN_INIT_PASSWORD = os.environ.get("ADMIN_INIT_PASSWORD", "").strip()

# 日志级别：DEBUG / INFO / WARNING / ERROR
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").strip().upper()

# ---------- 备份相关 ----------
# SQLite 数据文件路径（从 DATABASE_URL 解析，供备份/恢复使用）
if DATABASE_URL.startswith("sqlite"):
    DB_FILE = DATABASE_URL.replace("sqlite:///", "", 1)
else:
    DB_FILE = ""

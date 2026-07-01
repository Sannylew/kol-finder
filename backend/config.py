"""
配置读取。优先读环境变量，其次读同目录下的 .env 文件。

推荐只配 2 个值：
  KDOCS_WEBHOOK_URL - 「复制脚本 webhook」拿到的完整链接（自动解析域名/file_id/script_id）
  KDOCS_TOKEN       - 生成的 APIToken（脚本令牌）
"""
import os
from pathlib import Path


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

# 数据库连接串。默认使用 backend 目录下的 SQLite 文件 kol.db。
# 也可用 DATABASE_URL 环境变量覆盖（例如指向其他路径或数据库）。
_DEFAULT_DB_PATH = Path(__file__).with_name("kol.db")
_DEFAULT_DB_URL = f"sqlite:///{_DEFAULT_DB_PATH.as_posix()}"
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip() or _DEFAULT_DB_URL

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

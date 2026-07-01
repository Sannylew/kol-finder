#!/usr/bin/env bash
# 从备份恢复数据库(SQLite) + 照片（Linux）。
# 用法：
#   bash scripts/restore.sh backups/db-20260628-030000.db.gz [backups/uploads-20260628-030000.tar.gz]
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB_FILE="${DB_FILE:-$PROJECT_DIR/backend/kol.db}"
SERVICE_NAME="${SERVICE_NAME:-kol-backend}"

DB_BACKUP="${1:-}"
PHOTO_BACKUP="${2:-}"

if [ -z "$DB_BACKUP" ] || [ ! -f "$DB_BACKUP" ]; then
  echo "用法: bash scripts/restore.sh <db备份.db.gz> [照片备份.tar.gz]"
  exit 1
fi

echo "!! 警告：恢复会覆盖当前数据库 $DB_FILE 的内容。"
read -r -p "确认继续？输入 yes: " ans
[ "$ans" = "yes" ] || { echo "已取消"; exit 0; }

# 停后端，避免占用数据库文件
if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  echo "停止后端服务..."
  systemctl stop "$SERVICE_NAME"
  STARTED=1
else
  STARTED=0
fi

# 1) 恢复数据库：解压覆盖，并清理 WAL 附属文件
echo "恢复数据库..."
gunzip -c "$DB_BACKUP" > "$DB_FILE"
rm -f "${DB_FILE}-wal" "${DB_FILE}-shm"
echo "  数据库已恢复。"

# 2) 恢复照片
if [ -n "$PHOTO_BACKUP" ] && [ -f "$PHOTO_BACKUP" ]; then
  echo "恢复照片..."
  tar -xzf "$PHOTO_BACKUP" -C "$PROJECT_DIR/backend"
  echo "  照片已恢复。"
fi

# 重启后端
if [ "$STARTED" = "1" ]; then
  systemctl start "$SERVICE_NAME"
  echo "后端服务已重启。"
else
  echo "恢复完成。请启动后端服务：sudo systemctl start $SERVICE_NAME"
fi

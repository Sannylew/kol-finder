#!/usr/bin/env bash
# 数据库(SQLite) + 照片备份脚本（Linux）。
# 用法：bash scripts/backup.sh
# 建议配 cron 每日执行，例如：
#   0 3 * * * cd /opt/kol-finder && bash scripts/backup.sh >> /var/log/kol-backup.log 2>&1
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backend/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
DB_FILE="${DB_FILE:-$PROJECT_DIR/backend/kol.db}"
UPLOADS_DIR="$PROJECT_DIR/backend/uploads"

STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "[$(date '+%F %T')] 开始备份..."

# 1) 数据库：用 sqlite3 在线备份保证一致性；无 sqlite3 命令则直接复制
DB_OUT="$BACKUP_DIR/db-$STAMP.db.gz"
if [ -f "$DB_FILE" ]; then
  if command -v sqlite3 >/dev/null 2>&1; then
    TMP="$BACKUP_DIR/.snap-$STAMP.db"
    sqlite3 "$DB_FILE" ".backup '$TMP'"
    gzip -c "$TMP" > "$DB_OUT"
    rm -f "$TMP"
  else
    gzip -c "$DB_FILE" > "$DB_OUT"
  fi
  echo "  数据库 -> $DB_OUT"
else
  echo "  未找到数据库文件 $DB_FILE，跳过"
fi

# 2) 照片打包
if [ -d "$UPLOADS_DIR" ]; then
  PHOTO_FILE="$BACKUP_DIR/uploads-$STAMP.tar.gz"
  tar -czf "$PHOTO_FILE" -C "$PROJECT_DIR/backend" uploads
  echo "  照片 -> $PHOTO_FILE"
fi

# 3) 清理过期备份
find "$BACKUP_DIR" -name 'db-*.db.gz' -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name 'uploads-*.tar.gz' -mtime +"$KEEP_DAYS" -delete

echo "[$(date '+%F %T')] 备份完成。保留最近 $KEEP_DAYS 天。"

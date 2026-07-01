#!/usr/bin/env bash
# 数据库 + 照片备份脚本（Linux）。
# 用法：bash scripts/backup.sh
# 建议配 cron 每日执行，例如：
#   0 3 * * * cd /opt/kol-finder && bash scripts/backup.sh >> /var/log/kol-backup.log 2>&1
set -euo pipefail

# ---- 配置（按需修改或用环境变量覆盖）----
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"          # 保留天数
PG_CONTAINER="${PG_CONTAINER:-kol_postgres}"
PG_USER="${POSTGRES_USER:-kol}"
PG_DB="${POSTGRES_DB:-kol_finder}"
UPLOADS_DIR="$PROJECT_DIR/backend/uploads"

STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "[$(date '+%F %T')] 开始备份..."

# 1) 数据库导出（在 docker 容器内执行 pg_dump）
DB_FILE="$BACKUP_DIR/db-$STAMP.sql.gz"
docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" "$PG_DB" | gzip > "$DB_FILE"
echo "  数据库 -> $DB_FILE"

# 2) 照片打包
if [ -d "$UPLOADS_DIR" ]; then
  PHOTO_FILE="$BACKUP_DIR/uploads-$STAMP.tar.gz"
  tar -czf "$PHOTO_FILE" -C "$PROJECT_DIR/backend" uploads
  echo "  照片 -> $PHOTO_FILE"
fi

# 3) 清理过期备份
find "$BACKUP_DIR" -name 'db-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name 'uploads-*.tar.gz' -mtime +"$KEEP_DAYS" -delete

echo "[$(date '+%F %T')] 备份完成。保留最近 $KEEP_DAYS 天。"

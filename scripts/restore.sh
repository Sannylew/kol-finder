#!/usr/bin/env bash
# 从备份恢复数据库 + 照片（Linux）。
# 用法：
#   bash scripts/restore.sh backups/db-20260628-030000.sql.gz [backups/uploads-20260628-030000.tar.gz]
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PG_CONTAINER="${PG_CONTAINER:-kol_postgres}"
PG_USER="${POSTGRES_USER:-kol}"
PG_DB="${POSTGRES_DB:-kol_finder}"

DB_BACKUP="${1:-}"
PHOTO_BACKUP="${2:-}"

if [ -z "$DB_BACKUP" ] || [ ! -f "$DB_BACKUP" ]; then
  echo "用法: bash scripts/restore.sh <db备份.sql.gz> [照片备份.tar.gz]"
  exit 1
fi

echo "!! 警告：恢复会覆盖当前数据库 $PG_DB 的内容。"
read -r -p "确认继续？输入 yes: " ans
[ "$ans" = "yes" ] || { echo "已取消"; exit 0; }

# 1) 恢复数据库
echo "恢复数据库..."
gunzip -c "$DB_BACKUP" | docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB"
echo "  数据库已恢复。"

# 2) 恢复照片
if [ -n "$PHOTO_BACKUP" ] && [ -f "$PHOTO_BACKUP" ]; then
  echo "恢复照片..."
  tar -xzf "$PHOTO_BACKUP" -C "$PROJECT_DIR/backend"
  echo "  照片已恢复。"
fi

echo "恢复完成。建议重启后端服务。"

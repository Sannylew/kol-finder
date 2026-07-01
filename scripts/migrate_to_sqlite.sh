#!/usr/bin/env bash
# 从 v1.0.x（PostgreSQL）自动迁移到 SQLite 版。
#
# 用法（在现有部署目录，root 或 sudo）：
#   sudo bash scripts/migrate_to_sqlite.sh
#   sudo BRANCH=dev bash scripts/migrate_to_sqlite.sh    # 指定分支/tag（默认 main）
#
# 脚本做的事（保住照片，博主数据靠重新同步）：
#   1) 备份当前数据 + 导出照片映射（趁 PG 还在）
#   2) 拉取 SQLite 版代码
#   3) 重装后端依赖并重启（自动建 kol.db）
#   4) 导入照片映射
#   5) 重建前端、reload nginx
#   6) 提示停止并可选删除旧 PG 容器
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"
SERVICE_NAME="kol-backend"
BRANCH="${BRANCH:-main}"
PG_CONTAINER="${PG_CONTAINER:-kol_postgres}"
PG_USER="${POSTGRES_USER:-kol}"
PG_DB="${POSTGRES_DB:-kol_finder}"
PHOTO_MAP="$BACKEND_DIR/photo_map.csv"

step() { echo; echo "-------- $* --------"; }
fail() { echo; echo "!! 错误: $*"; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "请用 root 或 sudo 运行"
[ -d "$PROJECT_DIR/.git" ] || fail "当前目录不是 git 仓库，无法自动拉取代码。请先 git 接管或手动迁移"

# 防止 git checkout 时替换正在执行的脚本导致中断：先把自己复制到 /tmp 再从那里运行
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
if [ "${_MIGRATE_RELAUNCHED:-0}" != "1" ]; then
  TMP_SELF="/tmp/kol_migrate_$$.sh"
  cp "$SELF" "$TMP_SELF"
  export _MIGRATE_RELAUNCHED=1
  export PROJECT_DIR
  exec bash "$TMP_SELF" "$@"
fi

echo "============================================================"
echo "  迁移到 SQLite 版"
echo "============================================================"
echo "  博主数据将从金山重新同步；照片会自动迁移保留。"
echo "  过程中后端会短暂重启。迁移前会自动备份，异常可回滚。"
if [ "${AUTO_YES:-0}" != "1" ]; then
  printf "确认开始迁移？输入 yes 继续（或用 AUTO_YES=1 跳过确认）："
  read -r ans
  [ "$ans" = "yes" ] || { echo "已取消。"; exit 0; }
fi

# 1) 备份 + 导出照片映射（PG 还在时）
step "备份并导出照片映射"
[ -f "$PROJECT_DIR/scripts/backup.sh" ] && bash "$PROJECT_DIR/scripts/backup.sh" || echo "（备份脚本执行有警告，继续）"

if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${PG_CONTAINER}$"; then
  if docker exec "$PG_CONTAINER" psql -U "$PG_USER" "$PG_DB" -At -F',' \
       -c "SELECT uid, filename FROM kol_photo" > "$PHOTO_MAP" 2>/dev/null; then
    echo "已导出照片映射：$(wc -l < "$PHOTO_MAP") 条 -> $PHOTO_MAP"
  else
    echo "警告：导出照片映射失败（可能无照片表），将跳过照片迁移"
    : > "$PHOTO_MAP"
  fi
else
  echo "警告：未发现运行中的 PG 容器 $PG_CONTAINER，跳过照片映射导出"
  : > "$PHOTO_MAP"
fi

# 2) 拉取 SQLite 版代码
step "拉取 SQLite 版代码（$BRANCH）"
# 国内网络对 github.com 常不稳，自动重试并回退到镜像
_git_fetch() {
  local url_official="https://github.com/Sannylew/kol-finder.git"
  local url_mirror="https://ghfast.top/https://github.com/Sannylew/kol-finder.git"
  git -C "$PROJECT_DIR" config http.version HTTP/1.1 2>/dev/null || true
  # 先试当前 origin（可能是官方），失败再切镜像
  for i in 1 2; do
    if git -C "$PROJECT_DIR" fetch origin --tags --prune 2>/dev/null; then
      return 0
    fi
    echo "  拉取失败，重试 ($i) ..."
    sleep 2
  done
  echo "  官方源不可用，切换到国内镜像加速 ..."
  git -C "$PROJECT_DIR" remote set-url origin "$url_mirror"
  if git -C "$PROJECT_DIR" fetch origin --tags --prune; then
    # 拉成功后把地址还原为官方，方便后续正常使用
    git -C "$PROJECT_DIR" remote set-url origin "$url_official"
    return 0
  fi
  git -C "$PROJECT_DIR" remote set-url origin "$url_official"
  return 1
}
_git_fetch || fail "拉取代码失败（网络问题）。可稍后重试，或手动 git fetch 后重跑本脚本"
git -C "$PROJECT_DIR" checkout -f "$BRANCH"
git -C "$PROJECT_DIR" pull --ff-only origin "$BRANCH" 2>/dev/null || true

# 3) 后端依赖 + 重启（自动建 kol.db）
step "更新后端依赖并重启"
cd "$BACKEND_DIR"
# 关键：把 DATABASE_URL 从 PostgreSQL 改为 SQLite（否则后端仍连旧 PG，停 PG 即崩）
if grep -q '^DATABASE_URL=postgresql' .env 2>/dev/null; then
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=sqlite:///${BACKEND_DIR}/kol.db|" .env
  echo "已将 DATABASE_URL 切换为 SQLite（${BACKEND_DIR}/kol.db）"
elif ! grep -q '^DATABASE_URL=sqlite' .env 2>/dev/null; then
  # 无 DATABASE_URL 或其他值，统一写成 SQLite
  if grep -q '^DATABASE_URL=' .env 2>/dev/null; then
    sed -i "s|^DATABASE_URL=.*|DATABASE_URL=sqlite:///${BACKEND_DIR}/kol.db|" .env
  else
    echo "DATABASE_URL=sqlite:///${BACKEND_DIR}/kol.db" >> .env
  fi
  echo "已设置 DATABASE_URL 为 SQLite"
fi
# 确保 AUTH_SECRET 有值（沿用旧 .env；若为占位符则生成）
if grep -q '^AUTH_SECRET=__AUTO_GENERATE__' .env 2>/dev/null; then
  AUTH_VAL="$(openssl rand -hex 32 2>/dev/null || head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 48)"
  sed -i "s|^AUTH_SECRET=__AUTO_GENERATE__|AUTH_SECRET=${AUTH_VAL}|" .env
fi
[ -d venv ] || python3 -m venv venv
./venv/bin/pip install -q --upgrade pip
./venv/bin/pip install -q -r requirements.txt
systemctl restart "$SERVICE_NAME"
sleep 3
systemctl is-active --quiet "$SERVICE_NAME" || fail "后端启动失败，看 journalctl -u $SERVICE_NAME -n 50"
echo "后端已切换到 SQLite 并重启"

# 4) 导入照片映射（此时已连 SQLite，导入进正确的库）
step "导入照片映射"
if [ -s "$PHOTO_MAP" ]; then
  ./venv/bin/python migrate_photos.py "$PHOTO_MAP"
else
  echo "无照片映射，跳过"
fi

# 5) 重建前端 + nginx
step "重建前端"
cd "$FRONTEND_DIR"
npm install --no-fund --no-audit
npm run build
[ -f "$FRONTEND_DIR/dist/index.html" ] || fail "前端构建失败，手动重试 cd frontend && npm run build"
nginx -t && systemctl reload nginx || echo "（nginx 重载有警告，请手动检查 nginx -t）"

chmod +x "$PROJECT_DIR"/scripts/*.sh 2>/dev/null || true

echo
echo "============================================================"
echo "  迁移完成（已切换到 SQLite）"
echo "============================================================"
echo "  下一步："
echo "    1) 浏览器登录后台 → 点【立即同步】拉取博主数据"
echo "       （照片会按 uid 自动对应显示）"
echo "    2) 确认数据/照片正常后，停止不再需要的 PG 容器："
echo "         cd $PROJECT_DIR && sudo docker compose down"
echo "       （确认无误后可加 -v 删除数据卷释放空间：docker compose down -v）"
echo "------------------------------------------------------------"
echo "  数据文件：$BACKEND_DIR/kol.db"
echo "  如迁移异常，可用迁移前的备份回滚（backend/backups/）。"
echo "============================================================"

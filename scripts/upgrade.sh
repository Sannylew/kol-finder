#!/usr/bin/env bash
# KOL Finder 升级脚本（Ubuntu/Debian）
#
# 用法：把新版 zip 解压到任意目录，进入该目录后运行：
#   sudo bash scripts/upgrade.sh
# 默认升级 /opt/kol-finder；目标目录不同时用第一个参数指定：
#   sudo bash scripts/upgrade.sh /your/path/kol-finder
#
# 脚本会：备份 -> 用新代码覆盖后端/前端（保留 .env、照片、备份、数据库）
#         -> 重装后端依赖 -> 重启后端 -> 重建前端 -> reload nginx
set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"      # 新版代码所在目录（脚本所在项目根）
TARGET_DIR="${1:-/opt/kol-finder}"               # 现有部署目录
SERVICE_NAME="kol-backend"

step() { echo; echo "-------- $* --------"; }
fail() { echo; echo "!! 错误: $*"; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "请用 root 或 sudo 运行：sudo bash scripts/upgrade.sh"
[ -d "$TARGET_DIR/backend" ] || fail "目标目录不像已部署的项目：$TARGET_DIR（可用参数指定：sudo bash scripts/upgrade.sh /路径）"

# 防止源目录和目标目录相同（原地解压会导致自我覆盖）
if [ "$SRC_DIR" = "$TARGET_DIR" ]; then
  fail "新版目录与部署目录相同（$SRC_DIR）。请把新版 zip 解压到另一个目录再运行升级。"
fi

echo "============================================================"
echo "  KOL Finder 升级"
echo "  新版代码: $SRC_DIR"
echo "  升级目标: $TARGET_DIR"
echo "============================================================"
echo "  将保留：.env、backend/uploads（照片）、backend/backups、数据库"
echo "  将更新：后端代码、前端代码、运维脚本"
printf "确认升级？输入 yes 继续："
read -r ans
[ "$ans" = "yes" ] || { echo "已取消。"; exit 0; }

# 1) 备份
step "备份当前数据"
if [ -f "$TARGET_DIR/scripts/backup.sh" ]; then
  bash "$TARGET_DIR/scripts/backup.sh" || echo "（备份脚本执行有警告，继续）"
else
  echo "未找到备份脚本，跳过（建议先手动备份）"
fi

# 2) 覆盖代码（保留运行数据）
step "更新代码（保留 .env / 照片 / 备份）"
# 后端：覆盖 .py 等代码，保留 .env、venv、uploads、backups、logs
mkdir -p "$TARGET_DIR/backend"
find "$SRC_DIR/backend" -maxdepth 1 -type f -name '*.py' -exec cp -f {} "$TARGET_DIR/backend/" \;
cp -f "$SRC_DIR/backend/requirements.txt" "$TARGET_DIR/backend/" 2>/dev/null || true
# 前端：覆盖 src、配置文件，保留 node_modules/dist（稍后重建）
cp -rf "$SRC_DIR/frontend/src" "$TARGET_DIR/frontend/"
cp -f "$SRC_DIR/frontend/index.html" "$TARGET_DIR/frontend/" 2>/dev/null || true
cp -f "$SRC_DIR/frontend/package.json" "$SRC_DIR/frontend/package-lock.json" "$TARGET_DIR/frontend/" 2>/dev/null || true
cp -f "$SRC_DIR/frontend/vite.config.ts" "$SRC_DIR/frontend/tsconfig.json" "$SRC_DIR/frontend/tsconfig.node.json" "$TARGET_DIR/frontend/" 2>/dev/null || true
# 运维脚本 + compose + 文档
cp -rf "$SRC_DIR/scripts" "$TARGET_DIR/"
cp -f "$SRC_DIR/docker-compose.yml" "$TARGET_DIR/" 2>/dev/null || true
cp -f "$SRC_DIR/README.md" "$TARGET_DIR/" 2>/dev/null || true
cp -rf "$SRC_DIR/airscript" "$TARGET_DIR/" 2>/dev/null || true
echo "代码已更新"

# 3) 后端依赖 + 重启
step "更新后端依赖并重启"
cd "$TARGET_DIR/backend"
[ -d venv ] || python3 -m venv venv
./venv/bin/pip install -q --upgrade pip
./venv/bin/pip install -q -r requirements.txt
systemctl restart "$SERVICE_NAME"
sleep 3
systemctl is-active --quiet "$SERVICE_NAME" || fail "后端启动失败，看 journalctl -u $SERVICE_NAME -n 50"
echo "后端已重启"

# 4) 重建前端
step "重建前端"
cd "$TARGET_DIR/frontend"
npm install --no-fund --no-audit
npm run build
[ -f "$TARGET_DIR/frontend/dist/index.html" ] || fail "前端构建失败，手动重试 cd frontend && npm run build"
echo "前端已重建"

# 5) reload nginx
step "重载 nginx"
nginx -t && systemctl reload nginx || echo "（nginx 重载有警告，请手动检查 nginx -t）"

chmod +x "$TARGET_DIR"/scripts/*.sh 2>/dev/null || true

echo
echo "============================================================"
echo "  升级完成"
echo "============================================================"
echo "  浏览器强制刷新（Ctrl+Shift+R）查看新版。"
echo
echo "  本次升级如涉及数据去重（v1.0.1），建议执行："
echo "    在后台点【立即同步】让数据按新规则重新入库，然后："
echo "    cd $TARGET_DIR/backend"
echo "    sudo ./venv/bin/python dedup.py          # 预览重复"
echo "    sudo ./venv/bin/python dedup.py --apply  # 清理重复"
echo "============================================================"

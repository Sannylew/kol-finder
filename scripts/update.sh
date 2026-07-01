#!/usr/bin/env bash
# KOL Finder 更新脚本（从 GitHub 拉取最新代码）
#
# 用法（在项目目录，root 或 sudo）：
#   sudo bash scripts/update.sh            # 拉取当前分支最新代码并更新
#   sudo bash scripts/update.sh v1.0.2     # 更新到指定 tag/分支
#
# 前提：项目目录是 git 仓库（git clone 部署，或已用 git 接管）。
#      非 git 目录请改用 upgrade.sh（解压新包覆盖）。
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"
SERVICE_NAME="kol-backend"
REF="${1:-}"

step() { echo; echo "-------- $* --------"; }
fail() { echo; echo "!! 错误: $*"; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "请用 root 或 sudo 运行：sudo bash scripts/update.sh"
[ -d "$PROJECT_DIR/.git" ] || fail "当前目录不是 git 仓库，无法 git 更新。请改用 upgrade.sh（解压新包覆盖）"

cd "$PROJECT_DIR"

# 记录更新前版本
OLD_VER="$(cat VERSION 2>/dev/null || echo unknown)"
echo "当前版本：$OLD_VER"

# 1) 备份
step "备份当前数据"
[ -f scripts/backup.sh ] && bash scripts/backup.sh || echo "（无备份脚本，跳过）"

# 2) 拉取最新代码
step "拉取最新代码"
git fetch origin --tags --prune
if [ -n "$REF" ]; then
  git checkout -f "$REF"
  git pull --ff-only origin "$REF" 2>/dev/null || true
else
  BR="$(git rev-parse --abbrev-ref HEAD)"
  git pull --ff-only origin "$BR"
fi
NEW_VER="$(cat VERSION 2>/dev/null || echo unknown)"
echo "更新后版本：$NEW_VER"

# 3) 后端依赖 + 重启
step "更新后端依赖并重启"
cd "$BACKEND_DIR"
[ -d venv ] || python3 -m venv venv
./venv/bin/pip install -q --upgrade pip
./venv/bin/pip install -q -r requirements.txt
systemctl restart "$SERVICE_NAME"
sleep 3
systemctl is-active --quiet "$SERVICE_NAME" || fail "后端启动失败，看 journalctl -u $SERVICE_NAME -n 50"
echo "后端已重启"

# 4) 重建前端
step "重建前端"
cd "$FRONTEND_DIR"
npm install --no-fund --no-audit
npm run build
[ -f "$FRONTEND_DIR/dist/index.html" ] || fail "前端构建失败，手动重试 cd frontend && npm run build"
echo "前端已重建"

# 5) reload nginx
step "重载 nginx"
nginx -t && systemctl reload nginx || echo "（nginx 重载有警告，请手动检查 nginx -t）"

chmod +x "$PROJECT_DIR"/scripts/*.sh 2>/dev/null || true

echo
echo "============================================================"
echo "  更新完成：$OLD_VER -> $NEW_VER"
echo "============================================================"
echo "  浏览器强制刷新（Ctrl+Shift+R）查看新版。"
echo "  如本次更新涉及数据去重，请在后台点【立即同步】后执行："
echo "    cd $BACKEND_DIR && sudo ./venv/bin/python dedup.py --apply"
echo "============================================================"

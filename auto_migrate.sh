#!/usr/bin/env bash
# KOL Finder 一键迁移引导脚本（PostgreSQL 旧版 -> SQLite 新版）
#
# 一条命令完成迁移（在旧版部署所在服务器执行）：
#   sudo bash <(curl -fsSL https://raw.githubusercontent.com/Sannylew/kol-finder/main/auto_migrate.sh)
# 或 wget：
#   sudo bash <(wget -qO- https://raw.githubusercontent.com/Sannylew/kol-finder/main/auto_migrate.sh)
#
# 自定义部署目录 / 分支：
#   sudo INSTALL_DIR=/opt/kol-finder BRANCH=main bash <(curl -fsSL .../auto_migrate.sh)
#
# 脚本自动完成：装 git → 接管现有部署为 git 仓库 → 拉取代码 → 运行迁移
# （备份/导出照片/切库/导入照片/重建前端/停 PG）。
# 迁移后博主数据需在后台点【立即同步】重新拉取；照片自动保留。
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/kol-finder}"
BRANCH="${BRANCH:-main}"
REPO_URL="https://github.com/Sannylew/kol-finder.git"
MIRROR_URL="https://ghfast.top/${REPO_URL}"
# 国内网络对官方源常不稳，默认优先镜像；设 PREFER_OFFICIAL=1 可强制先用官方
PREFER_OFFICIAL="${PREFER_OFFICIAL:-0}"

c_info() { echo -e "\033[36m$*\033[0m"; }
c_err()  { echo -e "\033[31m$*\033[0m"; }

[ "$(id -u)" -eq 0 ] || { c_err "请用 root 或 sudo 运行"; exit 1; }
[ -d "$INSTALL_DIR/backend" ] || { c_err "未找到已部署项目：$INSTALL_DIR（用 INSTALL_DIR 指定实际路径）"; exit 1; }

c_info "==> 迁移目标：$INSTALL_DIR （分支 $BRANCH）"

# 1) 确保 git
if ! command -v git >/dev/null 2>&1; then
  c_info "==> 安装 git ..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq && apt-get install -y -qq git
fi

cd "$INSTALL_DIR"
git config --global http.version HTTP/1.1 2>/dev/null || true

# 2) 接管为 git 仓库（若还不是）
if [ ! -d "$INSTALL_DIR/.git" ]; then
  c_info "==> 接管现有部署为 git 仓库 ..."
  git init -q
  git remote add origin "$REPO_URL"
fi
git remote get-url origin >/dev/null 2>&1 || git remote add origin "$REPO_URL"

# 3) 拉取代码（默认优先国内镜像，失败回退官方）
c_info "==> 拉取最新代码 ..."
if [ "$PREFER_OFFICIAL" = "1" ]; then
  FIRST_URL="$REPO_URL"; SECOND_URL="$MIRROR_URL"
else
  FIRST_URL="$MIRROR_URL"; SECOND_URL="$REPO_URL"
fi
git remote set-url origin "$FIRST_URL"
if ! git fetch origin --tags --prune 2>/dev/null; then
  c_info "   首选源不可用，切换备用源 ..."
  git remote set-url origin "$SECOND_URL"
  git fetch origin --tags --prune || { c_err "拉取失败（网络问题），请稍后重试"; exit 1; }
fi
# 拉成功后统一还原为官方地址，方便后续正常使用
git remote set-url origin "$REPO_URL"

# 4) 取出迁移脚本（确保用最新版）
git checkout -f "origin/$BRANCH" -- scripts/migrate_to_sqlite.sh backend/migrate_photos.py
chmod +x scripts/*.sh 2>/dev/null || true

# 5) 运行迁移（全自动，含停 PG）
c_info "==> 开始迁移 ..."
exec env AUTO_YES=1 BRANCH="$BRANCH" bash scripts/migrate_to_sqlite.sh

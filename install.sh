#!/usr/bin/env bash
# KOL Finder 一行引导安装脚本
#
# 一行安装（需仓库公开）：
#   bash <(curl -fsSL https://raw.githubusercontent.com/Sannylew/kol-finder/main/install.sh)
# 或：
#   bash <(wget -qO- https://raw.githubusercontent.com/Sannylew/kol-finder/main/install.sh)
#
# 自定义安装目录 / 端口：
#   INSTALL_DIR=/opt/kol-finder HTTP_PORT=9000 bash <(curl -fsSL .../install.sh)
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Sannylew/kol-finder.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/kol-finder}"
BRANCH="${BRANCH:-main}"

c_info() { echo -e "\033[36m$*\033[0m"; }
c_ok()   { echo -e "\033[32m$*\033[0m"; }
c_err()  { echo -e "\033[31m$*\033[0m"; }

# 需要 root（clone 到 /opt、装依赖都要）
if [ "$(id -u)" -ne 0 ]; then
  c_err "请用 root 或 sudo 运行，例如："
  echo "  sudo bash <(curl -fsSL https://raw.githubusercontent.com/Sannylew/kol-finder/main/install.sh)"
  exit 1
fi

c_info "==> 准备安装 KOL Finder"
echo "    仓库: $REPO_URL"
echo "    目录: $INSTALL_DIR"
echo "    分支: $BRANCH"

# 1) 确保 git 已安装
if ! command -v git >/dev/null 2>&1; then
  c_info "==> 安装 git ..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq && apt-get install -y -qq git
fi

# 2) 获取代码：已存在则更新，否则克隆
if [ -d "$INSTALL_DIR/.git" ]; then
  c_info "==> 检测到已存在的部署，拉取最新代码 ..."
  git -C "$INSTALL_DIR" fetch origin --tags --prune
  git -C "$INSTALL_DIR" checkout -f "$BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH" || true
elif [ -d "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
  c_err "目录 $INSTALL_DIR 已存在且非 git 仓库，请先备份/清空，或用 INSTALL_DIR 指定其他目录。"
  exit 1
else
  c_info "==> 克隆仓库 ..."
  git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi

# 3) 调用部署脚本
c_info "==> 开始部署 ..."
cd "$INSTALL_DIR"
chmod +x scripts/*.sh 2>/dev/null || true
# 传递可选的 HTTP_PORT / AUTO_YES 给 deploy.sh
exec bash scripts/deploy.sh

c_ok "完成。"

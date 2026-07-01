#!/usr/bin/env bash
# KOL Finder 一键卸载脚本（Ubuntu/Debian）
#
# 用法（项目根目录，root 或 sudo）：
#   sudo bash scripts/uninstall.sh
#
# 运行后会让你选择：
#   1) 保留数据（删服务/容器，保留数据库卷、照片、备份、.env，可重新部署）
#   2) 全部清除（连数据一起删，等于全新）
#
# 注意：不会卸载 Docker / Node / nginx 这些系统软件（可能别的程序在用）。
set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_NAME="kol-backend"
NGINX_SITE="kol-finder"

c_red() { echo -e "\033[31m$*\033[0m"; }

[ "$(id -u)" -eq 0 ] || { echo "请用 root 或 sudo 运行：sudo bash scripts/uninstall.sh"; exit 1; }

echo "============================================================"
echo "  KOL Finder 卸载"
echo "============================================================"
echo "  请选择卸载方式："
echo "    1) 保留数据  —— 删除服务/容器/构建产物，保留数据库、照片、备份、.env"
echo "    2) 全部清除  —— 在上面基础上，连数据库卷、照片、备份、.env 一起删除"
echo "    其他键取消"
echo "------------------------------------------------------------"
printf "请输入 1 或 2："
read -r choice

case "$choice" in
  1)
    PURGE=0
    echo "已选择：保留数据"
    ;;
  2)
    PURGE=1
    c_red "已选择：全部清除（数据库卷、照片、备份、.env 将被删除，不可恢复）"
    printf "确认全部清除？再次输入 yes 继续："
    read -r confirm
    [ "$confirm" = "yes" ] || { echo "已取消。"; exit 0; }
    ;;
  *)
    echo "已取消。"
    exit 0
    ;;
esac

# 1) 后端服务
echo
echo "-- 停止并删除后端服务"
systemctl stop "$SERVICE_NAME" 2>/dev/null || true
systemctl disable "$SERVICE_NAME" 2>/dev/null || true
rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload 2>/dev/null || true
echo "   完成"

# 2) nginx 站点
echo "-- 删除 nginx 站点配置"
rm -f "/etc/nginx/sites-enabled/${NGINX_SITE}" "/etc/nginx/sites-available/${NGINX_SITE}"
if command -v nginx >/dev/null 2>&1; then
  nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true
fi
echo "   完成"

# 3) 数据库容器
echo "-- 停止数据库容器"
cd "$PROJECT_DIR"
if [ "$PURGE" -eq 1 ]; then
  docker compose down -v 2>/dev/null || true   # -v 连数据卷一起删
else
  docker compose down 2>/dev/null || true       # 保留数据卷
fi
echo "   完成"

# 4) 构建产物 / 虚拟环境
echo "-- 删除后端 venv、前端 dist"
rm -rf "$PROJECT_DIR/backend/venv" "$PROJECT_DIR/frontend/dist" "$PROJECT_DIR/frontend/node_modules"
echo "   完成"

# 5) 全部清除：清数据
if [ "$PURGE" -eq 1 ]; then
  echo "-- 删除数据：uploads / backups / logs / .env"
  rm -rf "$PROJECT_DIR/backend/uploads" "$PROJECT_DIR/backend/backups" "$PROJECT_DIR/backend/logs"
  rm -f "$PROJECT_DIR/.env" "$PROJECT_DIR/backend/.env"
  echo "   完成"
fi

echo
echo "============================================================"
echo "  卸载完成"
if [ "$PURGE" -eq 1 ]; then
  echo "  数据已清空。重新部署相当于全新安装。"
else
  echo "  数据已保留（数据库卷 / uploads / backups / .env）。"
  echo "  重新部署：sudo bash scripts/deploy.sh"
fi
echo "  项目文件未删除，如需删除整个目录：rm -rf $PROJECT_DIR"
echo "============================================================"

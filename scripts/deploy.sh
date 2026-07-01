#!/usr/bin/env bash
# KOL Finder 一键部署脚本（Ubuntu/Debian）
#
# 用法（项目根目录，root 或 sudo）：
#   sudo bash scripts/deploy.sh
# 自定义端口（默认 8088）：
#   sudo HTTP_PORT=9000 bash scripts/deploy.sh
#
# 分三步执行，每步结束会停下等你按回车再继续：
#   第一步：系统依赖 + Docker + 数据库
#   第二步：后端（依赖 + 服务）
#   第三步：前端（构建 + nginx）
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HTTP_PORT="${HTTP_PORT:-8088}"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"
SERVICE_NAME="kol-backend"
NGINX_SITE="kol-finder"

step()  { echo; echo "-------- $* --------"; }
stage() { echo; echo "############################################################"; echo "#  $*"; echo "############################################################"; }
fail()  { echo; echo "!! 错误: $*"; exit 1; }

trap 'rc=$?; echo; echo "!! 部署中断（退出码 $rc，脚本第 $LINENO 行）。请把上面几行输出发给维护者；修复后直接重跑 sudo bash scripts/deploy.sh（已完成步骤会自动跳过）"' ERR

[ "$(id -u)" -eq 0 ] || fail "请用 root 或 sudo 运行：sudo bash scripts/deploy.sh"

# 阶段之间暂停，等用户确认。可设 AUTO_YES=1 跳过所有暂停（全自动）。
pause_next() {
  local next="$1"
  echo
  if [ "${AUTO_YES:-0}" = "1" ]; then
    echo ">> 进入下一步：$next"
    return
  fi
  printf ">> 本阶段完成。按【回车】继续：%s（按 Ctrl+C 可中止）" "$next"
  read -r _
}

# ============================================================
stage "安装系统依赖、Docker、数据库"
# ============================================================

step "安装系统依赖（apt：python / nginx / curl 等）"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y python3 python3-venv python3-pip nginx curl ca-certificates iproute2

# Node.js
NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -v 2>/dev/null | sed -n 's/^v\([0-9]\{1,\}\).*/\1/p')"
  if [ -n "$NODE_MAJOR" ] && [ "$NODE_MAJOR" -ge 18 ] 2>/dev/null; then NEED_NODE=0; fi
fi
if [ "$NEED_NODE" -eq 1 ]; then
  step "安装 Node.js 20"
  curl -fsSL --connect-timeout 20 --max-time 180 https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo "Node.js 已安装：$(node -v)，跳过"
fi

# Docker
if ! command -v docker >/dev/null 2>&1; then
  step "安装 Docker"
  curl -fsSL --connect-timeout 20 --max-time 300 https://get.docker.com | sh || true
  if ! command -v docker >/dev/null 2>&1; then
    echo "官方源安装失败，改用 Ubuntu 自带源（docker.io）..."
    apt-get install -y docker.io docker-compose-v2
  fi
  echo "Docker 安装完成"
else
  echo "Docker 已安装：$(docker --version)，跳过"
fi
systemctl enable --now docker || true
docker compose version >/dev/null 2>&1 || fail "Docker Compose 不可用。可手动安装：sudo apt install -y docker.io docker-compose-v2"

# 国内镜像加速器（仅当未配置过时）
if [ ! -f /etc/docker/daemon.json ] || ! grep -q 'registry-mirrors' /etc/docker/daemon.json 2>/dev/null; then
  step "配置 Docker 镜像加速器（国内拉取更快）"
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": ["https://docker.1panel.live", "https://docker.m.daocloud.io", "https://docker.1ms.run"]
}
EOF
  systemctl restart docker || true
  sleep 2
fi

step "配置环境变量（.env）"
[ -f "$PROJECT_DIR/.env" ] || cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
[ -f "$BACKEND_DIR/.env" ] || cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
# 去除可能的 Windows 换行符 \r（CRLF），避免读取的值尾部带 \r 导致密码/URL 错乱
sed -i 's/\r$//' "$PROJECT_DIR/.env" "$BACKEND_DIR/.env" 2>/dev/null || true
echo "已就绪：根 .env、backend/.env"

# 自动生成随机密钥，替换模板里的 __AUTO_GENERATE__ 占位符（首次部署时）
gen_secret() { openssl rand -hex 16 2>/dev/null || head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24; }
gen_auth()   { openssl rand -hex 32 2>/dev/null || head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 48; }

if grep -q '__AUTO_GENERATE__' "$PROJECT_DIR/.env"; then
  DB_PASS="$(gen_secret)"
  sed -i "s|__AUTO_GENERATE__|${DB_PASS}|g" "$PROJECT_DIR/.env"
  # backend/.env 的 DATABASE_URL 里的同一占位符也用这个库密码替换
  sed -i "s|postgresql+psycopg://\([^:]*\):__AUTO_GENERATE__@|postgresql+psycopg://\1:${DB_PASS}@|" "$BACKEND_DIR/.env"
  echo "已生成随机数据库密码"
fi
if grep -q '^AUTH_SECRET=__AUTO_GENERATE__' "$BACKEND_DIR/.env"; then
  AUTH_VAL="$(gen_auth)"
  sed -i "s|^AUTH_SECRET=__AUTO_GENERATE__|AUTH_SECRET=${AUTH_VAL}|" "$BACKEND_DIR/.env"
  echo "已生成随机 AUTH_SECRET"
fi
# 若 backend/.env 的 DATABASE_URL 仍残留占位符（例如根 .env 已存在未含占位符），用根库密码补齐
if grep -q '__AUTO_GENERATE__' "$BACKEND_DIR/.env"; then
  RP="$(grep -E '^POSTGRES_PASSWORD=' "$PROJECT_DIR/.env" | head -1 | cut -d= -f2- | tr -d '\r')"
  [ -n "$RP" ] && sed -i "s|:__AUTO_GENERATE__@|:${RP}@|" "$BACKEND_DIR/.env"
fi

SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [ -n "$SERVER_IP" ] && grep -q '^ALLOWED_ORIGINS=' "$BACKEND_DIR/.env"; then
  sed -i "s|^ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=http://$SERVER_IP:$HTTP_PORT|" "$BACKEND_DIR/.env"
  echo "已设置 ALLOWED_ORIGINS=http://$SERVER_IP:$HTTP_PORT"
fi

# 数据库连接串：仅当 backend/.env 缺少 DATABASE_URL 或其密码为空时，才用根 .env 的值补全。
# 已有合法连接串则不改动（避免误判破坏 URL）。
ROOT_USER="$(grep -E '^POSTGRES_USER=' "$PROJECT_DIR/.env" | head -1 | cut -d= -f2- | tr -d '\r')"
ROOT_PW="$(grep -E '^POSTGRES_PASSWORD=' "$PROJECT_DIR/.env" | head -1 | cut -d= -f2- | tr -d '\r')"
ROOT_DB="$(grep -E '^POSTGRES_DB=' "$PROJECT_DIR/.env" | head -1 | cut -d= -f2- | tr -d '\r')"
ROOT_USER="${ROOT_USER:-kol}"
ROOT_DB="${ROOT_DB:-kol_finder}"
DB_URL="$(grep -E '^DATABASE_URL=' "$BACKEND_DIR/.env" | head -1 | cut -d= -f2- | tr -d '\r')"
# 从连接串里取出密码部分（取不到说明格式不对或为空）
URL_PW="$(printf '%s' "$DB_URL" | sed -n 's#^postgresql+psycopg://[^:]*:\(.*\)@[^@]*$#\1#p')"

if [ -z "$URL_PW" ]; then
  # 连接串缺失/密码为空 => 用根 .env 的值补全（仅全新部署有意义）
  if [ -z "$ROOT_PW" ]; then
    fail "backend/.env 的 DATABASE_URL 不完整，且根 .env 未设置 POSTGRES_PASSWORD，无法自动补全"
  fi
  NEW_URL="postgresql+psycopg://${ROOT_USER}:${ROOT_PW}@127.0.0.1:5432/${ROOT_DB}"
  if grep -qE '^DATABASE_URL=' "$BACKEND_DIR/.env"; then
    NEW_URL="$NEW_URL" awk '/^DATABASE_URL=/ { print "DATABASE_URL=" ENVIRON["NEW_URL"]; next } { print }' \
      "$BACKEND_DIR/.env" > "$BACKEND_DIR/.env.tmp" && mv "$BACKEND_DIR/.env.tmp" "$BACKEND_DIR/.env"
  else
    echo "DATABASE_URL=${NEW_URL}" >> "$BACKEND_DIR/.env"
  fi
  echo "已补全 backend/.env 的 DATABASE_URL"
fi

step "启动数据库（docker compose，首次会拉取镜像）"
cd "$PROJECT_DIR"
docker compose up -d
echo "等待数据库就绪..."
for i in $(seq 1 30); do
  docker exec kol_postgres pg_isready -U kol >/dev/null 2>&1 && break
  sleep 2
done
docker exec kol_postgres pg_isready -U kol >/dev/null 2>&1 || fail "数据库未就绪。若是拉取镜像超时，请检查网络或镜像加速器后重跑；详见 docker logs kol_postgres"
echo "数据库已就绪"

echo
echo ">> 系统依赖、Docker、数据库都已就绪。"
pause_next "安装并启动后端服务"

# ============================================================
stage "部署后端"
# ============================================================

step "安装后端 Python 依赖"
cd "$BACKEND_DIR"
[ -d venv ] || python3 -m venv venv
./venv/bin/pip install --upgrade pip
./venv/bin/pip install -r requirements.txt

step "注册后端为系统服务（开机自启）"
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=KOL Finder Backend
After=network.target docker.service
Requires=docker.service

[Service]
WorkingDirectory=$BACKEND_DIR
ExecStart=$BACKEND_DIR/venv/bin/python run.py
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"
sleep 3
systemctl is-active --quiet "$SERVICE_NAME" || fail "后端启动失败，看 journalctl -u $SERVICE_NAME -n 50"
echo "后端服务已启动"

echo
echo ">> 后端服务已运行（127.0.0.1:8000）。"
pause_next "构建前端并配置 nginx"

# ============================================================
stage "构建前端、配置 nginx"
# ============================================================

step "构建前端（npm install + build）"
cd "$FRONTEND_DIR"
npm install --no-fund --no-audit
npm run build
[ -f "$FRONTEND_DIR/dist/index.html" ] || fail "前端构建失败，手动重试 cd frontend && npm run build"
echo "前端构建完成"

step "配置 nginx (端口 $HTTP_PORT)"
cat > "/etc/nginx/sites-available/${NGINX_SITE}" <<EOF
server {
    listen $HTTP_PORT;
    listen [::]:$HTTP_PORT;
    server_name _;

    root $FRONTEND_DIR/dist;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        client_max_body_size 60m;
    }

    location /uploads/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
    }
}
EOF
ln -sf "/etc/nginx/sites-available/${NGINX_SITE}" "/etc/nginx/sites-enabled/${NGINX_SITE}"
nginx -t || fail "nginx 配置测试失败（可能端口 $HTTP_PORT 被占）"
systemctl enable nginx || true
systemctl reload nginx || systemctl restart nginx
echo "nginx 已配置并重载"

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow "${HTTP_PORT}/tcp" || true
fi
chmod +x "$PROJECT_DIR"/scripts/*.sh 2>/dev/null || true

# 自检
HEALTH="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${HTTP_PORT}/api/health" 2>/dev/null || echo 000)"

echo
echo "============================================================"
if [ "$HEALTH" = "200" ]; then
  echo "  部署完成 ✓（自检通过）"
else
  echo "  部署完成（自检未通过：/api/health 返回 $HEALTH）"
fi
echo "============================================================"
echo "  访问地址:   http://${SERVER_IP:-服务器IP}:${HTTP_PORT}"
echo "  管理员账号: admin"
echo "  初始密码:   admin123  （首次登录会强制修改）"
echo "------------------------------------------------------------"
echo "  登录后进【后台设置】填金山 Webhook + Token，点同步拉数据"
echo "------------------------------------------------------------"
echo "  常用命令："
echo "    重启后端:   sudo systemctl restart ${SERVICE_NAME}"
echo "    后端日志:   sudo journalctl -u ${SERVICE_NAME} -f"
echo "    重启数据库: cd ${PROJECT_DIR} && sudo docker compose restart"
if [ "$HEALTH" != "200" ]; then
  echo "------------------------------------------------------------"
  echo "  自检未通过：服务可能还在启动，稍等 10 秒刷新浏览器；"
  echo "  若持续异常看后端日志：sudo journalctl -u ${SERVICE_NAME} -n 50"
fi
echo "============================================================"

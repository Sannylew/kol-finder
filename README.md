# KOL Finder · 博主资料库

从金山在线文档（kdocs）**只读同步**博主数据到本地数据库，提供搜索、筛选、照片管理的可视化系统。

> 核心原则：**只读取在线文档，绝不修改文档。** 所有数据写入都发生在本地数据库。

---

## 功能概览

### 前台（浏览展示，公开）
- **博主资料库**：卡片墙展示，支持搜索（姓名/抖音号/电话/公司/备注/地址）、筛选（公司/合同/合作周期/尺码）、分页
- **数据统计**：概览博主总数、今日/本周新增、已签/未签合同、已配照片
- **详情查看**：完整字段，关键信息一键复制，抖音号可跳转搜索
- **包裹图片**：每个博主可上传多张包裹实拍图，缩略图展示、点击放大查看（灯箱）；访客可见，仅管理员可增删
- **公司名称展示**：后台可配置公司名，显示在左上角品牌区（所有访问者可见）
- **浏览体验**：返回顶部、每页数量选择（20/50/100，记住偏好）、一键重置筛选、浏览状态同步到 URL（刷新/分享/前进后退保留筛选与页码）
- **数据脱敏**：开启后访客看到打码信息（姓名/照片/身材数据明文，电话/地址/抖音号/公司部分打码，序号/备注等整体打码），管理员登录后看全部明文

### 后台控制台（独立页面 `/admin`，需登录）
- **仪表盘**：博主总数、今日/本周新增、已签/未签、已配照片、最近同步、待清理数，可一键同步
- **博主列表**：搜索、分页，调整**前台展示排序**（数字越低越靠前）、置顶/取消置顶、移到默认排序、删除博主（连带照片）
- **已移除博主**：文档中已删除、本地仍保留的博主，逐个或一键清理
- **数据源设置**：金山 Webhook / Token / 测试连接 / 自动同步开关与间隔
- **同步记录**：查看历史同步日志
- **外观设置**：公司名称、前端脱敏开关、卡片是否显示公司
- **系统日志**：查看运行日志，按级别过滤
- **数据备份/恢复**：一键备份、下载、上传恢复，恢复前自动快照
- **版本更新**：检查 GitHub Release 最新版本，支持在服务器后台触发受控更新
- **修改密码**

### 数据同步与安全
- **数据同步**：定时/手动从金山在线文档拉取最新数据，增量入库（不重复、不回写文档）
- **删除识别**：同步自动识别文档中已删除的博主 → 前台不再显示 → 进入「已移除博主」待清理
- **照片管理**：给博主上传/更换/删除主图照片（本地存储，独立于同步数据）
- **登录鉴权**：所有写操作需管理员登录，登录失败限流；默认密码可登录，后台温和提示建议修改

---

## 技术栈

| 层 | 技术 |
|----|------|
| 数据源 | 金山文档 AirScript（HTTP API，只读脚本） |
| 后端 | Python + FastAPI + SQLAlchemy + APScheduler |
| 数据库 | SQLite（单文件，零配置） |
| 前端 | React 18 + TypeScript + Vite |
| 鉴权 | JWT + PBKDF2 密码哈希 |

---

## 目录结构

```
kol-finder/
├── VERSION                     版本号
├── CHANGELOG.md                更新日志
├── install.sh                  一键引导安装（clone + 部署）
├── auto_migrate.sh             一键迁移引导（旧版 PG → SQLite）
├── airscript/
│   └── read_sheet.js           金山文档里运行的只读脚本
├── scripts/                    运维脚本
│   ├── deploy.sh               一键部署（依赖/后端/前端/nginx）
│   ├── update.sh               从 GitHub 拉取更新（git pull）
│   ├── upgrade.sh              解压新包覆盖升级（非 git 方式）
│   ├── migrate_to_sqlite.sh    PG→SQLite 迁移（被 auto_migrate.sh 调用）
│   ├── uninstall.sh            一键卸载（保留数据 / 全部清除）
│   ├── backup.sh               数据库+照片备份
│   └── restore.sh              从备份恢复
├── backend/                    后端
│   ├── app.py                  FastAPI 主程序（API + 定时任务）
│   ├── dedup.py                重复数据清理工具
│   ├── migrate_photos.py       照片关联迁移工具（旧库→SQLite）
│   ├── run.py                  启动入口（127.0.0.1:8000）
│   ├── auth.py                 登录鉴权
│   ├── reset_password.py       忘记密码重置工具
│   ├── kdocs_client.py         金山 API 客户端
│   ├── sync.py                 同步逻辑
│   ├── cleaner.py              数据清洗
│   ├── db.py                   数据库模型（SQLite）
│   ├── queries.py              查询 + 脱敏 + 统计
│   ├── photos.py               照片管理
│   ├── maintenance.py          日志查看 + 备份/恢复
│   ├── logging_setup.py        日志配置（文件轮转）
│   ├── settings_store.py       运行时配置存储
│   ├── config.py               基础配置
│   ├── .env                    实际配置（不提交 git）
│   ├── kol.db                  SQLite 数据库文件（自动生成）
│   ├── logs/                   运行日志（自动生成）
│   ├── backups/                数据库备份（自动生成）
│   └── uploads/                博主照片存储目录
└── frontend/                   前端
    └── src/
        ├── App.tsx             前台主页面（浏览展示）
        ├── main.tsx            路由入口（前台 / + 后台 /admin）
        ├── api.ts              接口封装
        ├── admin/              后台控制台（布局/登录/仪表盘/博主列表/各设置面板）
        └── components/         卡片/详情抽屉/确认框
```

---

## 环境要求

- Linux 服务器（Ubuntu / Debian，推荐 Ubuntu 22.04+）
- Python 3.11+、Node.js 18+、Nginx（一键脚本会自动安装）

> 数据库使用 SQLite（单文件），无需 Docker、无需数据库服务。

---

## 部署

以 Ubuntu/Debian 为例，部署到服务器供团队访问。提供三种方式，任选其一。

### 方式一：一键安装（最简单）

一条命令自动完成「安装 git → 克隆仓库 → 部署」：

```bash
sudo bash <(curl -fsSL https://raw.githubusercontent.com/Sannylew/kol-finder/main/install.sh)
```

或用 wget：

```bash
sudo bash <(wget -qO- https://raw.githubusercontent.com/Sannylew/kol-finder/main/install.sh)
```

自定义安装目录或端口：

```bash
sudo INSTALL_DIR=/opt/kol-finder HTTP_PORT=9000 bash <(curl -fsSL https://raw.githubusercontent.com/Sannylew/kol-finder/main/install.sh)
```

> 若访问 `raw.githubusercontent.com` 不稳定，改用方式二。

### 方式二：克隆仓库 + 部署脚本

先克隆代码（方便后续 `update.sh` 一键更新），再运行部署脚本：

```bash
cd /opt
sudo git clone https://github.com/Sannylew/kol-finder.git
cd kol-finder
sudo bash scripts/deploy.sh
```

`deploy.sh` 会自动完成：安装依赖（Python / Node / nginx）→ 配置 `backend/.env`（自动生成随机 AUTH_SECRET）→ 安装后端依赖并注册为开机自启服务 → 构建前端 → 配置 nginx。数据库为 SQLite，随后端自动创建，无需额外配置。

脚本分两步执行，每步结束会停下等待确认，方便查看每步结果：
1. 依赖 + 配置 + 后端服务
2. 前端（构建 + nginx）

> 无人值守部署可加 `AUTO_YES=1` 跳过每步确认：`sudo AUTO_YES=1 bash scripts/deploy.sh`。

默认对外端口为 **8088**，如需更改：

```bash
sudo HTTP_PORT=9000 bash scripts/deploy.sh
```

脚本可重复执行（更新代码后、或某步失败修复后再次运行，已完成的步骤会自动跳过）。

> 方式一本质上也是自动执行方式二的步骤，两者结果一致。

部署完成后还需：
1. 云服务器**安全组**放行对应 TCP 端口（默认 8088）
2. 浏览器访问 `http://服务器IP:8088`，右上角进后台用 **admin / admin123** 登录，进【数据源设置】填金山 Webhook + Token，仪表盘点同步拉数据（建议尽快改密）

常用运维命令：

```bash
sudo journalctl -u kol-backend -f          # 看后端实时日志
sudo systemctl restart kol-backend         # 重启后端（数据库随后端加载）
```

#### 安装常见问题

- **Node.js 安装失败 `curl: (35)` / 连接超时**：国内网络访问 NodeSource 不稳，重跑脚本即可重试；或先手动安装 Node 18+ 再重跑。
- **端口被占用**：默认 8088，换端口重跑：`sudo HTTP_PORT=9000 bash scripts/deploy.sh`。
- **脚本中途失败**：定位问题后直接再跑一次 `sudo bash scripts/deploy.sh`，已完成的步骤会自动跳过。

#### 从 GitHub 更新

用 git 克隆部署的，一条命令拉取最新代码并更新：

```bash
cd /opt/kol-finder
sudo bash scripts/update.sh            # 更新到最新版本
sudo bash scripts/update.sh v1.0.2     # 或更新到指定版本（tag）
```

脚本会：备份 → `git pull` 拉最新代码 → 重装后端依赖 → 重启后端 → 重建前端 → reload nginx。`.env`、照片、数据库不受影响。

> 若当初是解压 zip 部署（非 git），先接管为 git 仓库即可用上面的更新：
> ```bash
> cd /opt/kol-finder
> sudo git init && sudo git remote add origin https://github.com/Sannylew/kol-finder.git
> sudo git fetch origin && sudo git checkout -f main
> ```
> `.env`、`kol.db`、`uploads/`、`backups/` 在 `.gitignore` 中，接管不会覆盖它们。

#### 卸载

```bash
sudo bash scripts/uninstall.sh
```

运行后选择：**1) 保留数据**（删服务/构建产物，保留数据库、照片、备份、.env，之后可重新部署恢复）或 **2) 全部清除**（连数据一起删，需再输 `yes` 确认，等于全新）。卸载只移除本项目的后端服务、nginx 站点，**不会卸载 Node / nginx 等系统软件**（避免影响同机其他程序）。

#### 从旧版（PostgreSQL）迁移到 SQLite

旧版本用 PostgreSQL，本版本改用 SQLite。在旧版部署的服务器上执行**一条命令**即可自动迁移（博主数据从金山重新同步，照片自动保留）：

```bash
curl -fsSL https://ghfast.top/https://raw.githubusercontent.com/Sannylew/kol-finder/main/auto_migrate.sh -o /tmp/auto_migrate.sh || curl -fsSL https://raw.githubusercontent.com/Sannylew/kol-finder/main/auto_migrate.sh -o /tmp/auto_migrate.sh; sudo bash /tmp/auto_migrate.sh
```

> 采用「先下载到 /tmp 再 sudo 执行」，避免普通用户 `sudo bash <(curl ...)` 因进程替换导致的 `/dev/fd/63: 没有那个文件` 报错；并优先用国内镜像 `ghfast.top` 下载，官方源不通时自动回退。

脚本自动完成：安装 git → 接管现有部署为 git 仓库 → 拉取代码 → 备份 → 导出照片映射 → 切换到 SQLite → 导入照片 → 重建前端 → 停止旧 PG 容器。

迁移完成后：**浏览器登录后台点【立即同步】** 拉取博主数据，照片按 uid（姓名+电话）自动对应显示。

> - 保留 PG 容器（不自动停）：加 `KEEP_PG=1`
> - 迁移前的备份在 `backend/backups/`，异常可回滚
> - 确认稳定后释放空间：`cd /opt/kol-finder && sudo docker compose down -v`

---

## 配置数据源（金山在线文档）

数据从金山文档同步，需要配置 **Webhook 链接** 和 **脚本令牌**。

### 步骤

1. 用金山账号打开要同步的在线表格
2. 顶部菜单「**效率 → AirScript 脚本编辑器**」
3. 新建「**文档共享脚本**」，粘贴 `airscript/read_sheet.js` 的内容，运行测试
4. 脚本「**⋯**」菜单 →「**复制脚本 webhook**」→ 得到 Webhook 链接
5. 编辑器工具栏「**脚本令牌**」→「**创建脚本令牌**」→ 得到 Token
6. 在系统**后台设置**（齿轮图标，需登录）里填入 Webhook 和 Token，点「测试连接」成功后保存

> 更换同步文档：在新文档重复上述步骤，把新的 Webhook 和 Token 填到后台设置即可。

### 表格列要求

脚本默认读取 `Sheet1`，表头在第 1 行，识别以下列：
序号、建群时间、姓名、电话、合同、公司、合作时间、邮寄件数、备注、尺码、身高、体重、胸围、腰围、臀围、抖音视频情况、抖音号、收货地址。

---

## 后台管理说明（需登录）

后台是**独立页面**，前台右上角齿轮进入，或直接访问 `/admin`（如 `http://服务器IP:8088/admin`）。左侧菜单分组：

| 菜单 | 说明 |
|------|------|
| 仪表盘 | 数据总览 + 最近同步 + 待清理数 + 一键同步 |
| 博主列表 | 搜索/分页；调整前台展示排序、置顶/取消置顶、移到默认排序、删除博主 |
| 已移除博主 | 文档已删、本地仍保留的博主，逐个或一键清理（连带照片、包裹图） |
| 数据源设置 | 金山 Webhook / Token / 测试连接 / 自动同步开关与间隔 |
| 同步记录 | 历史同步日志（时间/新增/更新/结果） |
| 外观设置 | 公司名称、前端脱敏开关、卡片是否显示公司 |
| 系统日志 | 运行日志，可按 INFO/WARNING/ERROR 过滤 |
| 数据备份 | 一键备份、下载、删除、上传 `.db.gz` 恢复（恢复前自动快照） |
| 版本更新 | 检查 GitHub Release 最新版本；支持 Linux/systemd 服务器通过固定脚本后台更新 |
| 修改密码 | 修改后旧登录失效，需用新密码重新登录 |

**展示排序**：数字越低越靠前，未设置的排在已排序博主之后；前台列表据此排序。可拖动调整、上移/下移、置顶或移到默认排序。属本地附加数据，同步不覆盖。

> 网页备份/恢复直接操作 SQLite 数据文件，无需额外依赖。也可用服务器脚本 `scripts/backup.sh` 与 `scripts/restore.sh`（可配 cron 定时备份）。

> 默认密码 `admin / admin123` 可正常登录；仍为默认密码时后台会温和提示建议修改（不强制）。生产环境建议尽快改密。

---

## 数据同步说明

```
金山在线文档 ──(只读)──► AirScript HTTP API ──► 后端拉取
                                                  │
                                          清洗（日期/布尔/尺码大写/地址）
                                                  │
                                          增量 upsert（按姓名+电话识别唯一）
                                                  ▼
                                              SQLite
```

- 同步只读取，不修改文档
- 以「姓名+电话」作为唯一键，重复同步不会产生重复数据
- 前端搜索/筛选/展示全部读本地数据库，快且稳

---

## 安全说明

- 浏览、搜索博主数据：**公开**（脱敏开启时访客看打码数据：姓名/照片/身材明文，电话/地址/抖音号/公司打码，序号/备注等整体打码）
- 同步、上传/删除照片、改配置：**需管理员登录**
- 登录失败 5 次锁定 5 分钟（锁定过期后重新计数）
- 改密码后旧登录令牌立即失效
- 仍为默认密码时，后台温和提示建议修改（不强制拦截）；生产环境请尽快改密
- 生产环境强制要求设置 `AUTH_SECRET` 环境变量（部署脚本自动生成随机值）
- CORS 通过 `ALLOWED_ORIGINS` 限制来源；后端只监听本机 127.0.0.1，经 nginx 反代对外
- 后端日志写入 `backend/logs/app.log`（5MB 轮转，保留 5 份），记录登录、同步、配置变更

### 忘记密码

在服务器运行（用后端 venv 里的 python）：

```bash
cd /opt/kol-finder/backend
sudo ./venv/bin/python reset_password.py            # 交互式
sudo ./venv/bin/python reset_password.py 新密码      # 直接重置 admin
```

---

## 数据备份与恢复

数据库（博主数据、配置、账号）和照片都需定期备份。项目自带脚本：

```bash
# 立即备份一次（数据库 + 照片，输出到 backups/）
sudo bash scripts/backup.sh

# 配置每日自动备份（crontab -e 加一行，凌晨 3 点）
0 3 * * * cd /opt/kol-finder && bash scripts/backup.sh >> /var/log/kol-backup.log 2>&1
```

恢复：

```bash
# 从指定备份恢复（会覆盖当前数据，需确认）
sudo bash scripts/restore.sh backups/db-20260628-030000.db.gz backups/uploads-20260628-030000.tar.gz
```

> 备份默认保留 14 天（`KEEP_DAYS` 可调）。建议把 `backups/` 目录定期同步到异地或对象存储。

---

## 常用命令

> 以下为**本地开发/调试**用（开发机，无需 sudo）。生产服务器请用前面「部署」章节的 systemd 命令。

```bash
# 后端（首次运行自动创建 SQLite 数据库 backend/kol.db）
cd backend && python run.py

# 手动同步一次（命令行）
cd backend && python sync.py

# 前端开发
cd frontend && npm run dev

# 前端构建生产版本
cd frontend && npm run build
```

---

## 注意事项

- `.env`、`backend/.env`、`backend/kol.db`、`backend/uploads/`、备份数据不应提交到 git（已在 `.gitignore` 中）
- 默认管理员 admin / admin123，生产环境请尽快改密
- 系统设计为内网使用，公网开放前请确保使用强密码、配置 HTTPS 并收紧 CORS

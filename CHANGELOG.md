# 更新日志

本项目版本变更记录。遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.1.0] - 2026-07-01

### 变更
- **数据库从 PostgreSQL 改为 SQLite**（单文件，零配置），移除 Docker 依赖，大幅简化部署
- 备份/恢复改为直接操作 SQLite 文件（`.db.gz`），部署脚本精简为两步
- nginx 配置默认开启 gzip 压缩与静态资源缓存

### 修复
- upsert 改用版本无关写法，修复不同 SQLAlchemy 版本下 `on_conflict_do_update` 兼容报错
- 迁移脚本自动将 `.env` 的 `DATABASE_URL` 从 PostgreSQL 切换为 SQLite（否则停 PG 后后端崩溃）
- 迁移脚本在切换数据库后再导入照片，避免照片关联写入错误的库
- 备份文件名同秒冲突（自动加序号避免覆盖）
- install/update/migrate 脚本在 GitHub 不稳时自动回退国内镜像

### 新增
- `backend/migrate_photos.py`：从旧版 PostgreSQL 迁移照片关联到 SQLite
- `scripts/migrate_to_sqlite.sh`：一键自动迁移（备份→导出照片映射→切库→导入照片→重建前端）

### 说明
- 旧版（PostgreSQL）升级：博主数据从金山重新同步，照片自动迁移保留（详见 README）

## [1.0.2] - 2026-06-30

### 安全
- 移除仓库中预设的真实数据库密码与 `AUTH_SECRET`，改为占位符 `__AUTO_GENERATE__`
- 部署脚本 `deploy.sh` 首次部署时自动生成随机数据库密码与 `AUTH_SECRET`

### 新增
- `scripts/update.sh`：从 GitHub 拉取最新代码并自动更新（git pull + 重装依赖 + 重启 + 重建前端）
- `VERSION` 文件：版本号单一来源
- `CHANGELOG.md`：变更记录

### 变更
- 更新方式改为基于 git 拉取（详见 README「从 GitHub 更新」）

## [1.0.1] - 2026-06-30

### 修复
- 修复重复博主问题：唯一键 `uid` 改用「姓名+电话」，补填抖音号不再产生重复记录
- 新增 `backend/dedup.py` 一次性去重脚本，清理历史重复数据
- 修复前端引用 Google Fonts 导致的国内访问加载卡顿（改用本地系统字体）
- 修复 CRLF 换行导致的 `.env` 密码/连接串错乱

### 新增
- 一键脚本：`deploy.sh`（三步式部署）、`upgrade.sh`（升级）、`uninstall.sh`（卸载）
- Docker 安装失败自动回退 Ubuntu 源、拉取镜像自动配置国内加速器

### 变更
- 移除 Windows 部署文档，仅保留 Linux 部署

## [1.0.0] - 2026-06-28

### 新增
- 首个版本：从金山在线文档只读同步博主数据的可视化系统
- 数据同步、搜索筛选、照片管理、登录鉴权、数据脱敏、备份恢复
- 一键部署脚本、生产加固（结构化日志、健康检查、环境变量凭证）

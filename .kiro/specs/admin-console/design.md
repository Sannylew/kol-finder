# 设计文档

## 概述

将后台从弹窗（SettingsDialog）重构为独立页面（`/admin` 路由，登录后访问），迁移现有功能并新增：博主优先级排序、仪表盘、同步记录、后台博主列表管理。前台保持公开浏览，按优先级排序并显示置顶角标。

设计原则：引入 `react-router-dom` 做前台/后台分离；后端只加最小改动（priority 字段 + 少量接口）；现有接口行为与鉴权不变；只读文档原则不变。

## 架构

```
前端（单 SPA + 路由）
├── /            前台浏览（现有 App 内容，公开）
│                 顶部「进入后台」入口 → /admin
└── /admin       后台控制台（需登录）
     ├── AdminLayout（左菜单 + 顶部条 + <Outlet/>）
     ├── 仪表盘         /admin
     ├── 博主列表       /admin/kols
     ├── 已移除博主     /admin/removed
     ├── 数据源设置     /admin/source
     ├── 同步记录       /admin/sync-logs
     ├── 外观设置       /admin/appearance
     ├── 系统日志       /admin/logs
     ├── 数据备份       /admin/backups
     └── 修改密码       /admin/password
        │ 所有 /admin/* 受 RequireAuth 保护，401 → 跳登录
        ▼
后端 FastAPI（新增少量接口 + priority 字段）
```

nginx 已有 `try_files $uri /index.html`，支持前端路由刷新不 404。

## 后端设计

### 数据模型变更（db.py）

`Kol` 新增字段：

```python
priority: Mapped[int | None] = mapped_column(Integer, index=True)  # 越低越靠前，空=未设置
```

- 轻量迁移：`_migrate_schema` 中检测 `priority` 列，缺失则 `ALTER TABLE kol ADD COLUMN priority INTEGER`（可空，既有数据默认 NULL）。
- **同步不覆盖**：`upsert_rows` 的 `update_cols` 已由 `DATA_FIELDS` 决定，`priority` 不在 `DATA_FIELDS` 中，故更新分支不会动它；新增分支不显式赋值（默认 NULL）。需确认 `_normalize` 不含 priority（不含）。

### 排序逻辑（queries.py::list_kols）

新增排序模式：默认前台排序改为「优先级优先」。SQLite 中 NULL 排序需显式处理（NULL 排最后）：

```python
# 默认（sort_by="seq" 或 "priority"）：有优先级在前（priority 升序，NULL 最后），再按 seq
from sqlalchemy import case
priority_null_last = case((Kol.priority.is_(None), 1), else_=0)
stmt = stmt.order_by(priority_null_last.asc(), Kol.priority.asc(), Kol.seq.asc())
```

- 保留现有 `sort_by` 白名单其它选项（name/height 等）供后台列表按需排序；但前台默认走上面的优先级排序。
- 实现方式：新增 `sort_by="priority"`（默认），命中时用上面的复合排序；其它 sort_by 维持原逻辑。前台请求默认不传 sort_by → 用 priority 排序。

### `_row_to_dict` 增加 priority 字段

`_row_to_dict` 输出加入 `priority`（管理员与前台都可返回；前台用于显示置顶角标，非敏感）。脱敏白名单 `keep_plain` 加入 `priority`。

### 新增/调整接口（app.py）

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| PUT | `/api/kols/{uid}/priority` | 需登录 | body `{priority: int\|null}`；设置/清空优先级 |
| POST | `/api/kols/{uid}/pin` | 需登录 | 置顶：设为当前最小 priority - 1（或 1）；返回新值 |
| DELETE | `/api/kols/{uid}/pin` | 需登录 | 取消置顶：priority 置 NULL |
| GET | `/api/sync-logs` | 需登录 | 历史同步记录（倒序，limit 可选） |

- 优先级校验：整数且 ≥ 0（负数拒绝，返回 400）；null/空 → 清空。
- 置顶语义（确认口径）：置顶 = 取当前所有非空 priority 的最小值 min，新值 = min-1（min 不存在则用 1）。使该博主排到最前。
- `PUT /api/kols/{uid}/priority` 与已有 `DELETE /api/kols/{uid}`、`GET /api/kols/{uid}` 路径层级不冲突（子路径 priority/pin）。注意仍需在 `/api/kols/{uid}` 之后或之前声明不影响（子路径更具体，FastAPI 精确匹配）。

### db.py 辅助函数

```python
def set_priority(uid, value: int | None) -> bool   # 存在则设置，返回是否命中
def pin_kol(uid) -> int | None                      # 置顶，返回新 priority
def unpin_kol(uid) -> bool                           # 清空 priority
def list_sync_logs(limit=50) -> list[dict]           # 复用 SyncLog
```

### 同步记录接口

复用现有 `SyncLog` 表；`list_sync_logs` 返回 `[{synced_at, total, inserted, updated, message}]` 倒序。

## 前端设计

### 依赖

新增 `react-router-dom`（v6）。`package.json` 加依赖，`main.tsx` 包 `<BrowserRouter>`。

### 路由结构（main.tsx / routes）

```tsx
<BrowserRouter>
  <Routes>
    <Route path="/" element={<App/>} />                    {/* 前台 */}
    <Route path="/admin" element={<RequireAuth><AdminLayout/></RequireAuth>}>
      <Route index element={<Dashboard/>} />
      <Route path="kols" element={<KolAdmin/>} />
      <Route path="removed" element={<RemovedPanel/>} />
      <Route path="source" element={<SourceSettings/>} />
      <Route path="sync-logs" element={<SyncLogs/>} />
      <Route path="appearance" element={<AppearanceSettings/>} />
      <Route path="logs" element={<SystemLogs/>} />
      <Route path="backups" element={<BackupPanel/>} />
      <Route path="password" element={<ChangePassword/>} />
    </Route>
    <Route path="/admin/login" element={<AdminLogin/>} />
  </Routes>
</BrowserRouter>
```

- `RequireAuth`：无 token → 跳 `/admin/login`；登录后回来。
- 全局 axios 响应拦截器：收到 401 → 清 token → 跳 `/admin/login`（仅 /admin 下生效或全局引导）。

### 组件拆分（复用现有 SettingsDialog 逻辑）

现有 `SettingsDialog` 的登录、设置、日志、备份逻辑拆成后台子面板组件：

| 新组件 | 来源 |
|--------|------|
| `AdminLayout` | 新建：左菜单 + 顶部条 + Outlet |
| `AdminLogin` | 抽取 SettingsDialog 的登录表单 |
| `Dashboard` | 新建：调用 stats + sync/status + removed/count |
| `KolAdmin` | 新建：博主列表（分页/搜索/优先级/删除） |
| `RemovedPanel` | 复用现有 RemovedDialog 逻辑（转为面板） |
| `SourceSettings` | 抽取 webhook/token/测试/自动同步 |
| `SyncLogs` | 新建：同步记录 |
| `AppearanceSettings` | 抽取公司名 + 脱敏开关 |
| `SystemLogs` | 抽取日志面板 |
| `BackupPanel` | 抽取备份面板 |
| `ChangePassword` | 抽取改密 |

- 现有 `SettingsDialog.tsx` 保留还是移除：改为不再从前台弹出；前台齿轮按钮改为 `<Link to="/admin">`。为减少风险，可先保留文件但不挂载，逻辑迁移到子面板。

### 前台改动（App.tsx）

- 顶部原「后台设置」齿轮 → 改为「进入后台」按钮，`navigate("/admin")` 或 `<a href="/admin">`。
- 移除前台的 SettingsDialog 挂载（登录/设置全部走 /admin）。保留退出登录？前台不再需要登录态操作，登出移到后台顶部条。
- 前台列表排序默认走后端 priority 排序（不传 sort_by 即可）。
- 前台卡片（KolCard）：`priority != null` 时显示「置顶」角标（星形 + 文案），脱敏时也显示。

### 后台博主列表（KolAdmin）

- 复用 `/api/kols`（privileged 会因带 token 自动不脱敏），分页 + 搜索。
- 每行：姓名/电话/公司/合同/优先级(可编辑输入框)/照片标识/操作（保存优先级、置顶、取消置顶、删除）。
- 优先级编辑：输入数字 → 调 `PUT /api/kols/{uid}/priority`；置顶/取消置顶调 pin 接口。
- 删除复用 `DELETE /api/kols/{uid}` + ConfirmDialog。

### 仪表盘（Dashboard）

- 卡片区：总数/今日/本周/已签/未签/已配照片（`/api/stats`）。
- 状态区：最近同步时间与结果（`/api/sync/status` + `/api/sync-logs` 第一条）、待清理数（`/api/kols/removed/count`）。
- 操作：「立即同步」按钮（`POST /api/sync`）、待清理跳转 `/admin/removed`。

### API 封装（api.ts）新增

```ts
export async function setKolPriority(uid: string, priority: number | null): Promise<void>;
export async function pinKol(uid: string): Promise<{ priority: number | null }>;
export async function unpinKol(uid: string): Promise<void>;
export async function fetchSyncLogs(limit?: number): Promise<SyncLogItem[]>;
export interface SyncLogItem { synced_at: string; total: number; inserted: number; updated: number; message: string; }
```

`Kol` 类型加 `priority?: number | null`。

## 数据模型

```
kol（新增列）
┌──────────┬─────────┬──────────────────────────────┐
│ priority │ INTEGER │ 越低越靠前，NULL=未设置，index │
└──────────┴─────────┴──────────────────────────────┘
```

## 错误处理

| 场景 | 后端 | 前端 |
|------|------|------|
| 未登录访问 /admin | — | RequireAuth 跳登录 |
| 接口 401（过期） | 401 | 拦截器清 token + 跳登录 |
| 优先级非整数/负数 | 400 | toast 提示 |
| 设置优先级时博主不存在 | 404 | toast 报错 |
| 同步记录为空 | 返回空数组 | 显示「暂无记录」 |

## 测试策略

手动为主，关键后端可选 pytest：

- 迁移：旧库启动自动补 priority 列，既有数据 NULL
- 同步不覆盖：设优先级后同步 → priority 不变
- 排序：设置不同 priority → 前台顺序正确（低值在前，NULL 最后）
- 置顶/取消：pin 后排最前，unpin 后回落
- 接口鉴权：priority/pin/sync-logs 未登录均 401
- 路由：直接访问 /admin 未登录跳登录；登录后各面板可用；刷新 /admin/kols 不 404（nginx try_files / 开发 vite history fallback）
- 回归：前台浏览/搜索/筛选/照片/包裹图不变；原设置/日志/备份功能在后台可用；`npm run build` 通过
- 移动端：左菜单可收起

## 迁移与运维影响

- `init_db` 自动补 priority 列，无需手动迁移
- 新增前端依赖 react-router-dom：部署 `update.sh` 会 `npm install` 自动装
- Vite dev 默认支持 history fallback；生产 nginx 已有 try_files，刷新子路由不 404
- 「只读文档」原则不变；priority 为本地附加数据
- 完成后建议升 minor 版本（需用户同意后再改 VERSION/CHANGELOG）

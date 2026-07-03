# 设计文档

## 概述

给同步增加「软标记 + 手动清理」能力：同步时把文档中已消失的博主标记为 `in_doc=False`（不删数据），前端右上角提供入口让管理员查看并逐个/一键删除这些博主（连带主图、包裹图）。文档更新照常 upsert，同步 0 行时跳过标记以防误判。

设计原则：**同步永不自动删数据**；删除只由管理员显式触发；复用现有主图/包裹图删除逻辑；不破坏现有同步计数与统计。

## 架构

```
同步 sync_once → db.upsert_rows(rows)
                    ├─ 现有：按 uid 新增/更新
                    └─ 新增：本次 uid 集合 → 命中的 in_doc=True，未命中的 in_doc=False
                              （rows 为空则跳过标记）
                    ▼
前端右上角「已移除博主」入口（仅管理员）
   ├─ GET  /api/kols/removed        列表（需登录）
   ├─ DELETE /api/kols/{uid}        删单个博主（需登录，连带主图+包裹图）
   └─ POST /api/kols/removed/purge  一键清理全部 in_doc=False（需登录）
```

## 组件与接口

### 数据模型变更（db.py）

`Kol` 表新增字段：

```python
in_doc: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("1"), index=True)
```

- `server_default="1"`：历史数据自动迁移为 True（满足需求 2.4）。
- SQLite 对已存在表新增带默认值的列：用轻量迁移（`init_db` 中检测列是否存在，缺失则 `ALTER TABLE kol ADD COLUMN in_doc BOOLEAN NOT NULL DEFAULT 1`）。

#### 轻量迁移逻辑（db.py::init_db 内）

```python
# 建表后检查 kol 表是否有 in_doc 列，没有则补加（SQLite）
cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(kol)")}
if "in_doc" not in cols:
    conn.exec_driver_sql("ALTER TABLE kol ADD COLUMN in_doc BOOLEAN NOT NULL DEFAULT 1")
```

### 同步标记逻辑（db.py::upsert_rows）

在现有 upsert 循环中收集本次出现的 uid 集合 `present_uids`；提交前：

```python
if rows:  # 安全阀：0 行不标记（需求 1.3）
    # 本次出现的 → in_doc=True（upsert 时顺带设）
    # 本地存在但本次未出现的 → in_doc=False
    session.query(Kol).filter(~Kol.uid.in_(present_uids)).update(
        {Kol.in_doc: False}, synchronize_session=False
    )
    # present_uids 对应记录确保 in_doc=True（新增默认 True；更新分支显式设 True）
```

- 新增分支：`Kol(..., in_doc=True)`
- 更新分支：`obj.in_doc = True`（覆盖此前可能的 False，满足需求 1.4）
- `in_(present_uids)` 大集合在 SQLite 有参数上限（约 999），需分批或改用临时表/差集方式；实现时若 uid 数超阈值，分批处理或先全置 False 再对 present 置 True（两步 UPDATE，避免 IN 超限）。

推荐实现（避免 IN 上限）：
```python
if rows:
    session.query(Kol).update({Kol.in_doc: False}, synchronize_session=False)  # 先全部置 False
    # 再把本次出现的置 True（present_uids 分批）
    for batch in chunks(list(present_uids), 500):
        session.query(Kol).filter(Kol.uid.in_(batch)).update({Kol.in_doc: True}, synchronize_session=False)
```
注意顺序：先全置 False，再对 present 批量置 True；对新增记录（本循环内 add 的）已是 True，需保证不被前面的全置 False 影响——因此「先全置 False」应在 upsert 循环**之前**执行，或对新增对象在 flush 后再置 True。实现时采用：**先对已有记录全置 False → 再执行 upsert（新增/更新均设 True）**，逻辑最清晰。

### 删除博主（新增 photos + queries/db 协作）

新增一个统一删除函数（放 db.py 或 queries.py），删除博主及其关联：

```python
def delete_kol(uid: str) -> bool:
    # 1) 删主图（photos.delete_photo，含文件）
    # 2) 删包裹图（photos.delete_all_package_photos，含文件）
    # 3) 删 kol 记录
    # 不存在返回 False
```

复用现有 `photos.delete_photo(uid)`、`photos.delete_all_package_photos(uid)`。

### 后端路由（app.py）

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/api/kols/removed` | 需登录 | 返回 `in_doc=False` 的博主列表 `{items:[{uid,name,phone,has_photo,pkg_count}], count}` |
| DELETE | `/api/kols/{uid}` | 需登录 | 删除单个博主（连带主图+包裹图） |
| POST | `/api/kols/removed/purge` | 需登录 | 删除全部 `in_doc=False`，返回 `{deleted: n}` |

- 路由顺序注意：`/api/kols/removed` 必须定义在 `/api/kols/{uid}` 之前，否则 `removed` 会被当作 uid 匹配。当前 `get_kol` 用的是 `/api/kols/{uid}`（GET），而 removed 是 GET `/api/kols/removed`——需把 removed 路由放在 `{uid}` 之前声明。
- DELETE `/api/kols/{uid}` 目前不存在，新增；不与现有主图删除 `/api/kols/{uid}/photo` 冲突（路径不同）。

响应示例：
```json
// GET /api/kols/removed
{ "count": 2, "items": [
  { "uid": "np:张三|138...", "name": "张三", "phone": "138...", "has_photo": true, "pkg_count": 3 }
]}
// POST purge
{ "ok": true, "deleted": 2 }
```

### 查询层（queries.py）

新增 `list_removed_kols()`：查询 `in_doc=False` 的博主，附带 has_photo（查 kol_photo）、pkg_count（count kol_package_photo）。此接口仅管理员调用，**不脱敏**（返回真实姓名电话供管理员辨识）。

### 前端 API（api.ts）

```ts
export interface RemovedKol { uid: string; name: string; phone: string; has_photo: boolean; pkg_count: number; }
export async function fetchRemovedKols(): Promise<{ count: number; items: RemovedKol[] }>;
export async function deleteKol(uid: string): Promise<void>;                 // DELETE /api/kols/{uid}
export async function purgeRemovedKols(): Promise<{ deleted: number }>;      // POST /api/kols/removed/purge
```

### 前端 UI（App.tsx）

右上角 header 的 `.sync` 区，在设置齿轮旁新增一个入口按钮（仅 `isAdmin` 显示）：

```tsx
{isAdmin && (
  <button className="btn-icon removed-btn" title="文档已移除的博主" onClick={openRemoved}>
    <TrashPeopleIcon />
    {removedCount > 0 && <span className="badge-count">{removedCount}</span>}
  </button>
)}
```

- 状态：`removedCount`、`removedOpen`、`removedItems`、`removedBusy`
- 进入页面/每次同步完成后刷新 `removedCount`（调用 `fetchRemovedKols` 取 count；或轻量返回仅 count）
- 点击打开弹窗（复用现有 modal 风格 or 新建轻量弹窗），列出 items：姓名/电话/照片标识，每行「删除」按钮 + 顶部「全部清理」
- 删除/清理走 `ConfirmDialog` 二次确认
- 操作后刷新：removed 列表、主列表 reloadList、stats、count

新增弹窗组件 `RemovedDialog.tsx`（或内联在 App）。建议独立组件，保持 App 精简。

### 同步后刷新角标

现有 `handleSync` 成功后，追加刷新 removedCount。首次加载 useEffect 也拉一次（仅管理员）。

## 数据模型

```
kol （新增列）
┌──────────┬─────────┬──────────────────────────────┐
│ in_doc   │ BOOLEAN │ 是否在最近一次文档同步中出现   │
│          │         │ 默认 1(True)，index           │
└──────────┴─────────┴──────────────────────────────┘
```

## 错误处理

| 场景 | 后端 | 前端 |
|------|------|------|
| 同步 0 行 | 跳过标记，记录日志 | 角标不变 |
| 未登录调用 removed/delete/purge | 401 | toast「请先登录」 |
| 删除不存在博主 | 404 | toast 报错 |
| 删除时文件缺失 | 忽略文件错误，继续删记录 | — |
| purge 无可删项 | deleted=0 | toast「暂无可清理」 |

## 测试策略

手动为主，关键逻辑可选最小 pytest：

- 同步标记：文档去掉某人→同步后其 in_doc=False；该人重新加回→同步后 in_doc=True；同步返回 0 行→不改标记
- 更新回归：文档改字段→同步正常更新；新增→in_doc=True；计数/日志不变
- 删除：删单个→kol/主图/包裹图（记录+文件）全清；purge→全部 in_doc=False 清除
- 权限：未登录访问 removed/delete/purge 均 401；访客前端不显示入口
- 迁移：旧库（无 in_doc 列）启动后自动补列且既有数据为 True
- 前端：角标数量正确；删除/清理后列表、统计、角标刷新；`npm run build` 通过

## 迁移与运维影响

- `init_db` 自动补 `in_doc` 列，无需手动迁移脚本；旧数据默认 True
- 不改动 deploy.sh/update.sh；服务器走普通 `update.sh` 部署
- 完成后 VERSION 升 1.3.0，CHANGELOG 记录
- 「只读文档」原则不变：同步仍只读文档，删除只作用于本地库

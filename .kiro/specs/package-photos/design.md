# 设计文档

## 概述

在博主详情抽屉新增「包裹图片」功能：每个博主可上传多张包裹实拍图，缩略图网格展示，点击放大（灯箱），支持新增与删除单张。访客可见性与主图一致（脱敏也展示）。

设计原则：**最大化复用现有主图系统**（`photos.py` 的存储、校验、静态服务、uid 迁移逻辑），新增一张独立表 `kol_package_photo`（一对多），不改动任何现有接口的行为。

## 架构

沿用现有分层，无新增依赖：

```
前端 KolDrawer.tsx
  ├─ 包裹图区块（缩略图网格 + 添加入口 + 单张删除）
  └─ Lightbox 灯箱（放大、Esc、上/下一张、滚动锁）
        │  api.ts 新增：fetchPackagePhotos / uploadPackagePhotos / deletePackagePhoto
        ▼
后端 app.py 新增路由（复用 auth 鉴权、StaticFiles /uploads）
        │
        ▼
photos.py 新增：KolPackagePhoto 模型 + CRUD（复用 _sniff_image / ALLOWED_EXT / MAX_BYTES / UPLOAD_DIR）
        │
        ▼
SQLite: kol_package_photo 表（uid 多条）；文件存 backend/uploads/
```

数据隔离与迁移：包裹图独立于金山同步；uid 变化时随主图一起迁移（`db.py::_migrate_uid`）；文件在 `uploads/` 内，已被 `backup.sh` 打包。

## 组件与接口

### 后端数据模型（photos.py）

新增表，与主图 `KolPhoto` 并列，但主键用自增 id（一个 uid 多条）：

```python
class KolPackagePhoto(Base):
    __tablename__ = "kol_package_photo"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    uid: Mapped[str] = mapped_column(String(128), index=True)   # 关联博主，可重复
    filename: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime)
```

常量复用现有：`ALLOWED_EXT`、`MAX_BYTES`、`UPLOAD_DIR`、`_sniff_image`。新增：

```python
MAX_PACKAGE_PHOTOS = 20  # 单博主上限
```

### 后端函数（photos.py）

| 函数 | 说明 |
|------|------|
| `init_package_photo_table()` | 建表，在 app.py lifespan 启动时调用 |
| `list_package_photos(uid) -> list[dict]` | 返回该 uid 全部包裹图 `[{id, filename}]`，按 id 升序 |
| `get_package_photo_map(uids) -> dict[str, list[str]]` | 批量取（预留，列表页暂不用） |
| `count_package_photos(uid) -> int` | 该 uid 现有张数（判上限） |
| `save_package_photo(uid, original_name, content) -> dict` | 校验+存盘+插入一条，返回 `{id, filename}`；超上限抛 ValueError |
| `delete_package_photo(uid, photo_id) -> bool` | 删除指定 id（校验属于该 uid）+ 删文件；不存在返回 False |
| `delete_all_package_photos(uid)` | 删该 uid 全部（供 uid 迁移/清理，可选） |

校验逻辑与 `save_photo` 一致：扩展名 → 大小 → magic bytes；文件名用 `uuid4().hex + ext`。

### 后端路由（app.py）

URL 形态对齐主图 `/api/kols/{uid}/photo`：

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/api/kols/{uid}/package-photos` | 无（访客可见） | 返回 `{items: [{id, url}]}` |
| POST | `/api/kols/{uid}/package-photos` | 需登录 | 多文件上传 `files: list[UploadFile]`，逐张保存，返回新增项 |
| DELETE | `/api/kols/{uid}/package-photos/{photo_id}` | 需登录 | 删除单张 |

- GET 不脱敏、不隐藏（满足需求 1.4 访客可见）。
- url 由 `f"/uploads/{filename}"` 拼接（复用现有静态挂载，无需新静态目录）。
- POST 分块读取限制大小（对齐主图 upload_photo 的 1MB 分块 + MAX_BYTES 校验）；逐个文件独立校验，单个失败不影响其他，返回成功列表 + 失败原因列表。
- 上传前检查 `count_package_photos(uid)`，达上限或本次批量会超限时按需截断并提示。

响应示例：
```json
// GET
{ "items": [ { "id": 3, "url": "/uploads/abc.jpg" }, { "id": 5, "url": "/uploads/def.png" } ] }
// POST
{ "ok": true, "added": [ {"id": 6, "url": "/uploads/x.jpg"} ], "errors": [ {"name":"a.txt","reason":"文件不是有效的图片"} ] }
```

### uid 迁移（db.py）

现有 `_migrate_uid(session, old_uid, new_uid)` 只迁移 `kol_photo`。扩展为同时迁移 `kol_package_photo`（多条，直接 UPDATE uid）：

```python
session.execute(
    text("UPDATE kol_package_photo SET uid = :new WHERE uid = :old"),
    {"new": new_uid, "old": old_uid},
)
```
包裹图一对多、无唯一冲突问题，直接整体改 uid 即可（比主图简单）。需保证建表在迁移执行前（lifespan 已建表；`_migrate_uid` 在同步时触发，晚于启动建表）。为稳妥，UPDATE 前用 `CREATE TABLE IF NOT EXISTS` 语义已由 SQLAlchemy 建表保证。

### 前端 API（api.ts）

```ts
export interface PackagePhoto { id: number; url: string; }

export async function fetchPackagePhotos(uid: string): Promise<PackagePhoto[]>;
export async function uploadPackagePhotos(uid: string, files: File[]):
  Promise<{ added: PackagePhoto[]; errors: { name: string; reason: string }[] }>;
export async function deletePackagePhoto(uid: string, id: number): Promise<void>;
```
上传用单个 `FormData` 追加多个 `files` 字段，`multipart/form-data`。

### 前端 UI（KolDrawer.tsx）

在主图 `photo-actions`/`upload` 之后、`<div className="section">联系与资料` 之前插入包裹图区块：

```tsx
<div className="section pkg-section">
  <h4>包裹图片</h4>
  <div className="pkg-grid">
    {pkgPhotos.map((p) => (
      <div className="pkg-thumb" key={p.id}>
        <img src={p.url} onClick={() => openLightbox(index)} loading="lazy" />
        {isAdmin && <button className="pkg-del" onClick={() => askDelete(p)}>×</button>}
      </div>
    ))}
    {isAdmin && (
      <div className="pkg-add" onClick={() => pkgFileRef.current?.click()}>＋</div>
    )}
  </div>
  {/* 访客且无图：不渲染整个区块 */}
</div>
```

状态与逻辑：
- `pkgPhotos: PackagePhoto[]`、`pkgBusy`、`lightboxIndex: number | null`、`confirmDelPkg: PackagePhoto | null`
- 打开抽屉（`kol` 变化）时 `fetchPackagePhotos(kol.uid)` 加载；关闭清空
- `isAdmin` 由父组件（App）传入（现有 App 已有 isAdmin 状态；KolDrawer 目前用 `masked` 推断权限不足以判管理员，需**新增 prop `isAdmin`** 传入）
- 上传成功后把 `added` 合并进 `pkgPhotos`；有 `errors` 用 toast 汇总提示
- 删除确认复用 `ConfirmDialog`
- 访客且 `pkgPhotos.length===0`：整个区块不渲染（需求 1.3）

### 灯箱 Lightbox

轻量内联实现（不引第三方库），复用 `useScrollLock`：
- 固定定位遮罩 + 居中大图 + 关闭按钮 + 左右切换箭头（多图时）
- 点击遮罩/关闭按钮/Esc 关闭；← → 切换
- z-index 高于抽屉

## 权限传递调整

当前 `KolDrawer` 无法区分「管理员登录」与「脱敏关闭」。主图按钮实际依赖 `kol.photo_url` 存在性显示更换/删除，未严格判管理员。为包裹图的「添加/删除入口仅管理员可见」，需：

- App.tsx 给 `<KolDrawer isAdmin={isAdmin} ... />` 传入
- KolDrawer Props 增加 `isAdmin?: boolean`
- 上传/删除入口以 `isAdmin` 为条件渲染（后端仍强制鉴权兜底）

（不改动主图现有行为，仅新增 prop。）

## 数据模型

```
kol_package_photo
┌────────────┬──────────────┬───────────────────────────┐
│ id (PK)    │ INTEGER      │ 自增                       │
│ uid        │ VARCHAR(128) │ 博主 uid，index，可重复    │
│ filename   │ VARCHAR(255) │ uploads/ 下的随机文件名    │
│ created_at │ DATETIME     │ 上传时间                   │
└────────────┴──────────────┴───────────────────────────┘
```

## 错误处理

| 场景 | 后端 | 前端 |
|------|------|------|
| 未登录上传/删除 | 401（auth.verify_token） | toast「请先登录」 |
| 非图片/超大/格式错 | 该文件计入 errors，不中断批量 | toast 汇总失败项 |
| 超上限 | 截断保存或整体拒绝 + 提示 | toast「最多 20 张」 |
| 博主不存在 | 404 | toast 报错 |
| 删除不存在的图 | 404 | toast 报错 |
| 缩略图/大图加载失败 | — | onError 占位，不破图 |

## 测试策略

按项目现状（无自动化测试框架），采用手动验证为主，关键后端逻辑可加最小 pytest（可选）：

- 后端：上传多张→GET 返回一致；删除单张→列表减少且文件删除；超上限拒绝；非图片拒绝；未登录 401；uid 迁移后包裹图跟随
- 前端：访客看得到图但无添加/删除入口；管理员可增删；灯箱开关/切换/Esc/滚动锁；无图时访客不显示空区块
- 回归：主图上传/删除、列表、统计、同步不受影响；`npm run build` 通过

## 迁移与运维影响

- 新表由 `init_package_photo_table()` 在启动自动建，无需手动迁移脚本
- `backup.sh` 已打包整个 `uploads/`，包裹图文件自动纳入备份；数据库备份含新表
- 版本号：完成后 VERSION 升 1.2.0，走现有 `update.sh` 部署（SQLite→SQLite 普通更新，非跨库迁移）
- PG→SQLite 的 `migrate_photos.py`/`photo_map` 仅涉及主图；包裹图为新版新增，旧 PG 无此数据，无需迁移

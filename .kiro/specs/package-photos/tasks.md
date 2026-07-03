# Implementation Plan: 包裹图片功能

## Overview

在博主详情抽屉新增「包裹图片」功能：多图上传、缩略图网格、点击灯箱放大、单张删除。访客可见（脱敏也展示），增删入口仅管理员可见。最大化复用现有主图系统（photos.py 存储/校验/静态服务），新增独立表 `kol_package_photo`（一对多），不改动现有接口行为。完成后 VERSION 升 1.2.0，走普通 update.sh 部署。

## Tasks

- [x] 1. 后端：包裹图数据模型与 CRUD（photos.py）
  - 在 `backend/photos.py` 新增 `KolPackagePhoto` 模型（id 自增主键、uid 带 index、filename、created_at）
  - 新增常量 `MAX_PACKAGE_PHOTOS = 20`
  - 新增 `init_package_photo_table()`：复用 `Base.metadata.create_all` 建表
  - 新增 `list_package_photos(uid)`：按 id 升序返回 `[{id, filename}]`
  - 新增 `count_package_photos(uid)`：返回张数
  - 新增 `save_package_photo(uid, original_name, content)`：复用 `_sniff_image/ALLOWED_EXT/MAX_BYTES`，随机文件名存盘，插入一条，返回 `{id, filename}`；文件写盘失败时回滚（不留孤儿记录）
  - 新增 `delete_package_photo(uid, photo_id)`：校验记录属于该 uid，删文件+删记录，不存在返回 False
  - 新增 `delete_all_package_photos(uid)`（供迁移/清理）
  - _需求: 3, 4, 5.1_

- [x] 2. 后端：启动建表接入（app.py lifespan）
  - 在 `lifespan` 中 `photos.init_photo_table()` 之后调用 `photos.init_package_photo_table()`
  - _需求: 5.1_

- [x] 3. 后端：包裹图路由（app.py）
  - [x] 3.1 GET `/api/kols/{uid}/package-photos`（访客可见，无鉴权）
    - 返回 `{items: [{id, url}]}`，url=`/uploads/{filename}`
    - 不做脱敏/隐藏处理（满足访客可见）
    - _需求: 1.1, 1.2, 1.4_
  - [x] 3.2 POST `/api/kols/{uid}/package-photos`（需登录，多文件）
    - 参数 `files: list[UploadFile] = File(...)`
    - 先校验博主存在（`queries.get_kol`），否则 404
    - 读取现有张数，结合上限做「能传几张传几张」：超出部分计入 errors 提示，不整批拒绝
    - 每个文件分块读取限制大小（对齐主图 1MB 分块 + MAX_BYTES），逐个独立校验，单个失败计入 errors 不中断
    - 返回 `{ok, added:[{id,url}], errors:[{name,reason}]}`
    - _需求: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.8_
  - [x] 3.3 DELETE `/api/kols/{uid}/package-photos/{photo_id}`（需登录）
    - 调 `delete_package_photo`，不存在返回 404，成功返回 `{ok:true}`
    - _需求: 4.1, 4.3, 4.4, 4.5_

- [x] 4. 后端：uid 迁移带上包裹图（db.py）
  - 在 `_migrate_uid` 中，主图迁移之后追加 `UPDATE kol_package_photo SET uid=:new WHERE uid=:old`
  - _需求: 5.3_

- [x] 5. 前端：API 封装（api.ts）
  - 新增 `PackagePhoto` 接口类型 `{ id: number; url: string }`
  - `fetchPackagePhotos(uid)` → GET
  - `uploadPackagePhotos(uid, files)` → POST（单个 FormData 追加多个 files 字段，multipart）
  - `deletePackagePhoto(uid, id)` → DELETE
  - _需求: 1.1, 3.2, 4.3_

- [-] 6. 前端：KolDrawer 新增 isAdmin prop 并由 App 传入
  - `KolDrawer` Props 增加 `isAdmin?: boolean`
  - `App.tsx` 渲染处传 `isAdmin={isAdmin}`
  - 不改动主图现有按钮行为
  - _需求: 3.1, 4.1_

- [x] 7. 前端：包裹图区块 UI（KolDrawer.tsx）
  - 在主图 `photo-actions`/`upload` 之后、「联系与资料」section 之前插入包裹图 section
  - 状态：`pkgPhotos`、`pkgBusy`、`confirmDelPkg`、隐藏的 `pkgFileRef`（multiple）
  - 打开抽屉（kol 变化）时加载 `fetchPackagePhotos`；关闭清空
  - 缩略图网格（小尺寸），`loading="lazy"`，onError 占位
  - 管理员：显示「＋ 添加」入口（multiple 选择）与每张的删除按钮；访客不显示
  - 访客且无图：整个 section 不渲染
  - 上传：调用 `uploadPackagePhotos`，合并 `added`，`errors` 用 toast 汇总；重置 input value
  - 删除：ConfirmDialog 二次确认后调用 `deletePackagePhoto`，从列表移除
  - _需求: 1.1, 1.2, 1.3, 1.5, 3.1, 3.2, 3.7, 3.8, 4.1, 4.2, 4.3_

- [x] 8. 前端：灯箱 Lightbox（放大查看）
  - 内联组件或 KolDrawer 内实现：遮罩 + 大图 + 关闭按钮 + 多图左右切换
  - 点击遮罩/关闭/Esc 关闭；← → 切换；复用 `useScrollLock` 锁背景滚动
  - z-index 高于抽屉
  - _需求: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 9. 前端：样式（styles.css）
  - `.pkg-grid` 小缩略图网格；`.pkg-thumb`（含删除角标 `.pkg-del`）；`.pkg-add` 虚线加号入口
  - Lightbox：`.lightbox-scrim`、`.lightbox-img`、`.lb-close`、`.lb-nav`
  - 风格与现有卡片/抽屉一致（朴素、圆角、无花哨）；LF 行尾
  - _需求: 1.2, 2.1_

- [x] 10. 验证与构建
  - `cd frontend && npm run build` 通过（tsc + vite）
  - 手动核对：访客可见图但无增删入口；脱敏开启仍展示；管理员增删即时生效；灯箱开关/切换/Esc/滚动锁；无图时访客不显示空区块
  - 回归：主图上传/删除、列表、统计、同步不受影响
  - _需求: 1.3, 1.4, 6.1, 6.2, 6.3_

- [x] 11. 收尾：版本与文档
  - `VERSION` 升到 `1.2.0`
  - `CHANGELOG.md` 记录本次新增（包裹图：多图上传/缩略图/灯箱/删除，访客可见）
  - README「功能概览」补一句包裹图；确认改动脚本/文件 LF 行尾
  - 提交推送 main（普通 SQLite 更新，服务器用 `update.sh` 部署）
  - _需求: 5.4, 6.3_

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"], "dependsOn": [] },
    { "wave": 2, "tasks": ["2", "3", "4"], "dependsOn": ["1"] },
    { "wave": 3, "tasks": ["5"], "dependsOn": ["3"] },
    { "wave": 4, "tasks": ["6"], "dependsOn": ["5"] },
    { "wave": 5, "tasks": ["7"], "dependsOn": ["6"] },
    { "wave": 6, "tasks": ["8"], "dependsOn": ["7"] },
    { "wave": 7, "tasks": ["9"], "dependsOn": ["8"] },
    { "wave": 8, "tasks": ["10"], "dependsOn": ["2", "4", "9"] },
    { "wave": 9, "tasks": ["11"], "dependsOn": ["10"] }
  ]
}
```

说明：任务 1（模型+CRUD）为基础；2/3/4 依赖 1 可并行；前端 5→6→7→8→9 顺序推进；10 验证需后端建表(2)、迁移(4)与前端样式(9)就绪；11 收尾在验证后。

## Notes

- 后端先行（任务 1-4），前端依赖后端接口（5-9）。
- 上传超上限策略：本次批量「能传几张传几张」，超出部分计入 errors 提示，不整批拒绝（已与用户确认）。
- 访客可见性与主图一致：GET 接口不鉴权、不脱敏；脱敏开启也照常展示。
- 增删入口仅管理员可见（前端 isAdmin 控制 + 后端 verify_token 兜底）。
- 不改动主图/列表/统计/同步现有行为；新表启动自动建，无需手动迁移脚本；文件纳入现有 backup.sh。
- 所有改动的 .sh/.py/.ts/.css 保持 LF 行尾（Linux 生产运行）。

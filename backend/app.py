"""
FastAPI 后端：对外提供达人数据接口 + 同步控制 + 定时自动同步。

启动：
  uvicorn app:app --reload --port 8000
然后访问 http://localhost:8000/docs 查看并测试所有接口。
"""
from contextlib import asynccontextmanager
import logging
import os

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import config
import db
import photos
import queries
import settings_store
import auth
import maintenance
from logging_setup import setup_logging
from kdocs_client import KdocsClient, KdocsError
from sync import sync_once, build_client

setup_logging()
logger = logging.getLogger("kol.api")

scheduler = BackgroundScheduler(timezone="Asia/Shanghai")


def _scheduled_sync():
    if not settings_store.is_auto_sync_enabled():
        return  # 自动同步已关闭
    try:
        stats = sync_once()
        logger.info("定时同步完成: %s", stats)
    except Exception as e:  # noqa: BLE001
        logger.error("定时同步失败: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动：建表 + 启动定时任务
    db.init_db()
    photos.init_photo_table()
    photos.init_package_photo_table()
    settings_store.init_settings_table()
    auth.init_auth()
    interval = settings_store.get_sync_interval()
    scheduler.add_job(
        _scheduled_sync,
        "interval",
        seconds=interval,
        id="kdocs_sync",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("定时同步已开启，每 %s 秒一次", interval)
    yield
    # 关闭
    scheduler.shutdown(wait=False)
    logger.info("应用关闭，调度器已停止")


app = FastAPI(title="KOL Finder API", version=config.APP_VERSION, lifespan=lifespan)

# 允许访问的前端来源。生产通过 ALLOWED_ORIGINS 环境变量显式配置。
_ALLOWED_ORIGINS = [o.strip() for o in os.environ.get(
    "ALLOWED_ORIGINS",
    "http://127.0.0.1:5173,http://localhost:5173",
).split(",") if o.strip()]
logger.info("CORS 允许来源: %s", _ALLOWED_ORIGINS)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# 照片静态服务：/uploads/xxx.jpg 直接访问图片文件
app.mount("/uploads", StaticFiles(directory=str(photos.UPLOAD_DIR)), name="uploads")


@app.get("/api/health")
def health():
    """健康检查：含数据库连通性。DB 不可用返回 503。"""
    try:
        count = db.count_kols()
    except Exception as e:  # noqa: BLE001
        logger.error("健康检查失败，数据库不可用: %s", e)
        raise HTTPException(status_code=503, detail="数据库不可用")
    return {"status": "ok", "kol_count": count, "version": config.APP_VERSION}


@app.get("/api/version")
def version():
    """返回应用版本号（供前端显示）。"""
    return {"version": config.APP_VERSION}


@app.get("/api/kols")
def list_kols(
    keyword: str = "",
    has_contract: bool | None = None,
    size: str = "",
    coop_period: str = "",
    company: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    sort_by: str = "seq",
    order: str = "asc",
    logged_in: bool = Depends(auth.is_logged_in),
):
    """达人列表：分页 + 搜索 + 筛选 + 排序。管理员登录则不脱敏。"""
    return queries.list_kols(
        keyword=keyword,
        has_contract=has_contract,
        size=size,
        coop_period=coop_period,
        company=company,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        order=order,
        privileged=logged_in,
    )


@app.get("/api/kols/{uid}")
def get_kol(uid: str, logged_in: bool = Depends(auth.is_logged_in)):
    """达人详情。管理员登录则不脱敏。"""
    row = queries.get_kol(uid, privileged=logged_in)
    if not row:
        raise HTTPException(status_code=404, detail="未找到该达人")
    return row


@app.get("/api/stats")
def get_stats(logged_in: bool = Depends(auth.is_logged_in)):
    """统计概览：总数、签约数、尺码分布、合作周期分布。脱敏开启且未登录时不泄露具体数字。"""
    return queries.stats(privileged=logged_in)


@app.get("/api/filter-options")
def get_filter_options(logged_in: bool = Depends(auth.is_logged_in)):
    """筛选下拉项。脱敏开启且未登录时返回空，避免泄露明文。"""
    return queries.filter_options(privileged=logged_in)


@app.post("/api/kols/{uid}/photo")
async def upload_photo(uid: str, file: UploadFile = File(...), _user: str = Depends(auth.verify_token)):
    """上传/替换某个博主的照片（每人一张）。需登录。"""
    if not queries.get_kol(uid):
        raise HTTPException(status_code=404, detail="未找到该博主")
    # 分块读取并限制大小，避免超大文件在校验前就撑爆内存
    max_bytes = photos.MAX_BYTES
    chunks = []
    read = 0
    while True:
        chunk = await file.read(1024 * 1024)  # 每次最多 1MB
        if not chunk:
            break
        read += len(chunk)
        if read > max_bytes:
            raise HTTPException(status_code=400, detail="图片过大，最大 10MB")
        chunks.append(chunk)
    content = b"".join(chunks)
    try:
        filename = photos.save_photo(uid, file.filename or "photo.jpg", content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "photo_url": f"/uploads/{filename}"}


@app.delete("/api/kols/{uid}/photo")
def delete_photo(uid: str, _user: str = Depends(auth.verify_token)):
    """删除某个博主的照片。需登录。"""
    ok = photos.delete_photo(uid)
    if not ok:
        raise HTTPException(status_code=404, detail="该博主没有照片")
    return {"ok": True}


@app.get("/api/kols/{uid}/package-photos")
def list_package_photos(uid: str):
    """某博主的包裹图列表（访客可见，不脱敏）。"""
    items = [
        {"id": p["id"], "url": f"/uploads/{p['filename']}"}
        for p in photos.list_package_photos(uid)
    ]
    return {"items": items}


@app.post("/api/kols/{uid}/package-photos")
async def upload_package_photos(
    uid: str,
    files: list[UploadFile] = File(...),
    _user: str = Depends(auth.verify_token),
):
    """给博主上传一张或多张包裹图（追加）。需登录。

    逐张独立校验：单个失败计入 errors，不中断其余；超上限的部分被拒并提示。
    """
    if not queries.get_kol(uid):
        raise HTTPException(status_code=404, detail="未找到该博主")

    max_bytes = photos.MAX_BYTES
    remaining = photos.MAX_PACKAGE_PHOTOS - photos.count_package_photos(uid)
    added: list[dict] = []
    errors: list[dict] = []

    for f in files:
        name = f.filename or "photo.jpg"
        if remaining <= 0:
            errors.append({"name": name, "reason": f"已达上限（最多 {photos.MAX_PACKAGE_PHOTOS} 张）"})
            continue
        # 分块读取并限制大小，避免超大文件撑爆内存
        chunks = []
        read = 0
        too_big = False
        while True:
            chunk = await f.read(1024 * 1024)
            if not chunk:
                break
            read += len(chunk)
            if read > max_bytes:
                too_big = True
                break
            chunks.append(chunk)
        if too_big:
            errors.append({"name": name, "reason": "图片过大，最大 10MB"})
            continue
        content = b"".join(chunks)
        try:
            info = photos.save_package_photo(uid, name, content)
            added.append({"id": info["id"], "url": f"/uploads/{info['filename']}"})
            remaining -= 1
        except ValueError as e:
            errors.append({"name": name, "reason": str(e)})

    if added:
        logger.info("上传包裹图 by=%s uid=%s: +%d, 失败 %d", _user, uid, len(added), len(errors))
    return {"ok": True, "added": added, "errors": errors}


@app.delete("/api/kols/{uid}/package-photos/{photo_id}")
def delete_package_photo(uid: str, photo_id: int, _user: str = Depends(auth.verify_token)):
    """删除某博主的一张包裹图。需登录。"""
    ok = photos.delete_package_photo(uid, photo_id)
    if not ok:
        raise HTTPException(status_code=404, detail="未找到该包裹图")
    return {"ok": True}


@app.post("/api/auth/login")
def auth_login(payload: dict):
    username = (payload or {}).get("username", "")
    password = (payload or {}).get("password", "")
    token = auth.login(username, password)
    return {
        "ok": True,
        "token": token,
        "username": username,
        "must_change_password": auth.must_change_password(username),
    }


@app.post("/api/auth/change-password")
def auth_change_password(payload: dict, _user: str = Depends(auth.verify_token)):
    auth.change_password(_user, (payload or {}).get("old_password", ""), (payload or {}).get("new_password", ""))
    return {"ok": True}


@app.get("/api/public-config")
def public_config():
    """无需登录的前端配置：当前是否脱敏。"""
    return {"mask_enabled": settings_store.is_mask_enabled()}


@app.get("/api/settings")
def get_settings(_user: str = Depends(auth.verify_token)):
    """读取后台配置（token 遮罩）。需登录。"""
    return settings_store.get_public()


@app.put("/api/settings")
def update_settings(payload: dict, _user: str = Depends(auth.verify_token)):
    """更新后台配置。token 传空表示不修改。修改间隔会重排定时任务。需登录。"""
    allowed = {"kdocs_webhook_url", "kdocs_token", "sync_interval_seconds", "mask_enabled", "auto_sync_enabled"}
    items = {k: v for k, v in payload.items() if k in allowed}

    # 校验同步间隔
    if "sync_interval_seconds" in items:
        try:
            sec = int(items["sync_interval_seconds"])
            if sec < 30:
                raise HTTPException(status_code=400, detail="同步间隔不能小于 30 秒")
            items["sync_interval_seconds"] = str(sec)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="同步间隔必须是数字")

    # 开关类转 0/1
    for sw in ("mask_enabled", "auto_sync_enabled"):
        if sw in items:
            items[sw] = "1" if items[sw] in (True, "1", "true", "True", 1) else "0"

    settings_store.set_many(items)

    interval = settings_store.get_sync_interval()
    scheduler.reschedule_job("kdocs_sync", trigger="interval", seconds=interval)

    # 记录变更的键（不记录敏感值）
    logger.info("配置已更新 by=%s, keys=%s", _user, sorted(items.keys()))

    return {"ok": True, **settings_store.get_public()}


@app.post("/api/settings/test")
def test_connection(payload: dict | None = None, _user: str = Depends(auth.verify_token)):
    """测试金山连接。需登录。"""
    payload = payload or {}
    s = settings_store.get_all()
    webhook = payload.get("kdocs_webhook_url") or s.get("kdocs_webhook_url") or config.KDOCS_WEBHOOK_URL
    token = payload.get("kdocs_token") or s.get("kdocs_token") or config.KDOCS_TOKEN
    if not webhook or not token:
        raise HTTPException(status_code=400, detail="缺少 webhook 或 token")
    try:
        client = KdocsClient(token=token, webhook_url=webhook)
        data = client.fetch_rows()
    except (KdocsError, ValueError) as e:
        raise HTTPException(status_code=502, detail=f"连接失败：{e}")
    return {
        "ok": True,
        "total": data.get("total", 0),
        "headers": data.get("headers", []),
    }


@app.post("/api/sync")
def trigger_sync(_user: str = Depends(auth.verify_token)):
    """手动触发一次同步。需登录。"""
    try:
        stats = sync_once()
    except Exception as e:  # noqa: BLE001
        logger.error("手动同步失败: %s", e)
        raise HTTPException(status_code=502, detail="同步失败，请检查数据源配置或稍后重试")
    logger.info("手动同步完成 by=%s: %s", _user, stats)
    return {"ok": True, **stats}


@app.get("/api/sync/status")
def sync_status():
    """最近一次同步状态。"""
    last = db.get_last_sync()
    return {"last_sync": last, "interval_seconds": settings_store.get_sync_interval()}


# ---------- 运维：日志 + 备份（需登录）----------

@app.get("/api/logs")
def get_logs(lines: int = Query(200, ge=1, le=2000), level: str = "", _user: str = Depends(auth.verify_token)):
    """查看系统日志末尾若干行。可按级别过滤。需登录。"""
    return maintenance.tail_log(lines=lines, level=level)


@app.get("/api/backups")
def list_backups(_user: str = Depends(auth.verify_token)):
    """列出已有数据库备份。需登录。"""
    return {"items": maintenance.list_backups()}


@app.post("/api/backups")
def create_backup(_user: str = Depends(auth.verify_token)):
    """立即创建一次数据库备份。需登录。"""
    try:
        info = maintenance.create_backup()
    except RuntimeError as e:
        logger.error("备份失败: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    logger.info("手动备份完成 by=%s: %s", _user, info["name"])
    return {"ok": True, **info}


@app.get("/api/backups/{name}/download")
def download_backup(name: str, _user: str = Depends(auth.verify_token)):
    """下载指定备份文件。需登录。"""
    try:
        path = maintenance.get_backup_path(name)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=404, detail=str(e))
    return FileResponse(path, filename=name, media_type="application/gzip")


@app.delete("/api/backups/{name}")
def delete_backup(name: str, _user: str = Depends(auth.verify_token)):
    """删除指定备份文件。需登录。"""
    try:
        maintenance.delete_backup(name)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"ok": True}


@app.post("/api/backups/{name}/restore")
def restore_backup(name: str, _user: str = Depends(auth.verify_token)):
    """从已有备份恢复数据库（会覆盖当前数据，恢复前自动快照）。需登录。"""
    try:
        result = maintenance.restore_backup(name)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        logger.error("恢复失败: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    logger.warning("数据库已恢复 by=%s: %s", _user, result)
    return {"ok": True, **result}


@app.post("/api/backups/restore-upload")
async def restore_upload(file: UploadFile = File(...), _user: str = Depends(auth.verify_token)):
    """上传 .sql.gz 备份文件恢复数据库（会覆盖当前数据，恢复前自动快照）。需登录。"""
    # 分块读取并限制大小
    max_bytes = maintenance.MAX_RESTORE_BYTES
    chunks = []
    read = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        read += len(chunk)
        if read > max_bytes:
            raise HTTPException(status_code=400, detail="备份文件过大")
        chunks.append(chunk)
    raw = b"".join(chunks)
    try:
        result = maintenance.restore_from_bytes(raw)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        logger.error("上传恢复失败: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    logger.warning("数据库已从上传文件恢复 by=%s: %s", _user, result)
    return {"ok": True, **result}

"""
博主照片（本地扩展数据）。独立于金山同步表，用 uid 关联。
照片文件存 uploads/ 目录，数据库只存元信息。
同步博主数据时不会影响这里的照片。
"""
import os
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import DateTime, Integer, String, select
from sqlalchemy.orm import Mapped, mapped_column

from db import Base, SessionLocal, engine

UPLOAD_DIR = Path(__file__).with_name("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
MAX_BYTES = 10 * 1024 * 1024  # 10MB
MAX_PACKAGE_PHOTOS = 20  # 单个博主的包裹图数量上限


def _validate_image(original_name: str, content: bytes) -> str:
    """校验图片（扩展名 → 大小 → magic bytes），返回小写扩展名。不通过则抛 ValueError。"""
    ext = os.path.splitext(original_name)[1].lower()
    if ext not in ALLOWED_EXT:
        raise ValueError(f"不支持的图片格式: {ext}，仅支持 {', '.join(sorted(ALLOWED_EXT))}")
    if len(content) > MAX_BYTES:
        raise ValueError("图片过大，最大 10MB")
    if not _sniff_image(content):
        raise ValueError("文件不是有效的图片")
    return ext


def _sniff_image(content: bytes) -> bool:
    """通过文件头(magic bytes)判断是否真实图片，防伪装文件。"""
    if len(content) < 12:
        return False
    # JPEG
    if content[:3] == b"\xff\xd8\xff":
        return True
    # PNG
    if content[:8] == b"\x89PNG\r\n\x1a\n":
        return True
    # GIF
    if content[:6] in (b"GIF87a", b"GIF89a"):
        return True
    # WEBP: RIFF....WEBP
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return True
    return False


class KolPhoto(Base):
    __tablename__ = "kol_photo"

    uid: Mapped[str] = mapped_column(String(128), primary_key=True)
    filename: Mapped[str] = mapped_column(String(255))
    updated_at: Mapped[datetime] = mapped_column(DateTime)


def init_photo_table() -> None:
    Base.metadata.create_all(engine, tables=[KolPhoto.__table__])


def get_photo_filename(uid: str) -> str | None:
    with SessionLocal() as session:
        row = session.get(KolPhoto, uid)
        return row.filename if row else None


def get_photo_map(uids: list[str]) -> dict[str, str]:
    """批量取多个 uid 的照片文件名，用于列表页。"""
    if not uids:
        return {}
    with SessionLocal() as session:
        rows = session.scalars(
            select(KolPhoto).where(KolPhoto.uid.in_(uids))
        ).all()
        return {r.uid: r.filename for r in rows}


def count_photos() -> int:
    """已上传照片的博主数。"""
    from sqlalchemy import func
    with SessionLocal() as session:
        return session.scalar(select(func.count()).select_from(KolPhoto)) or 0


def save_photo(uid: str, original_name: str, content: bytes) -> str:
    """保存（或替换）一个博主的照片。返回新文件名。"""
    ext = _validate_image(original_name, content)

    # 删除旧文件
    old = get_photo_filename(uid)
    if old:
        old_path = UPLOAD_DIR / old
        if old_path.exists():
            try:
                old_path.unlink()
            except OSError:
                pass

    # 用随机名避免冲突，保留扩展名
    filename = f"{uuid.uuid4().hex}{ext}"
    (UPLOAD_DIR / filename).write_bytes(content)

    now = datetime.now()
    with SessionLocal() as session:
        row = session.get(KolPhoto, uid)
        if row:
            row.filename = filename
            row.updated_at = now
        else:
            session.add(KolPhoto(uid=uid, filename=filename, updated_at=now))
        session.commit()

    return filename


def delete_photo(uid: str) -> bool:
    with SessionLocal() as session:
        row = session.get(KolPhoto, uid)
        if not row:
            return False
        path = UPLOAD_DIR / row.filename
        if path.exists():
            try:
                path.unlink()
            except OSError:
                pass
        session.delete(row)
        session.commit()
    return True


# ==========================================================================
# 包裹图（一个博主可多张）。独立表，用 uid 关联，文件同样存 uploads/。
# 与主图隔离：同步/主图操作互不影响。
# ==========================================================================

class KolPackagePhoto(Base):
    __tablename__ = "kol_package_photo"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    uid: Mapped[str] = mapped_column(String(128), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime)


def init_package_photo_table() -> None:
    Base.metadata.create_all(engine, tables=[KolPackagePhoto.__table__])


def list_package_photos(uid: str) -> list[dict]:
    """返回某博主的全部包裹图，按 id 升序：[{id, filename}]。"""
    with SessionLocal() as session:
        rows = session.scalars(
            select(KolPackagePhoto)
            .where(KolPackagePhoto.uid == uid)
            .order_by(KolPackagePhoto.id.asc())
        ).all()
        return [{"id": r.id, "filename": r.filename} for r in rows]


def count_package_photos(uid: str) -> int:
    """某博主现有包裹图张数。"""
    from sqlalchemy import func
    with SessionLocal() as session:
        return session.scalar(
            select(func.count()).select_from(KolPackagePhoto).where(KolPackagePhoto.uid == uid)
        ) or 0


def save_package_photo(uid: str, original_name: str, content: bytes) -> dict:
    """校验并保存一张包裹图（追加，不覆盖）。返回 {id, filename}。

    超出上限或文件非法时抛 ValueError。
    """
    if count_package_photos(uid) >= MAX_PACKAGE_PHOTOS:
        raise ValueError(f"包裹图数量已达上限（{MAX_PACKAGE_PHOTOS} 张）")
    ext = _validate_image(original_name, content)

    filename = f"{uuid.uuid4().hex}{ext}"
    path = UPLOAD_DIR / filename
    path.write_bytes(content)

    now = datetime.now()
    try:
        with SessionLocal() as session:
            row = KolPackagePhoto(uid=uid, filename=filename, created_at=now)
            session.add(row)
            session.commit()
            session.refresh(row)
            new_id = row.id
    except Exception:
        # 入库失败则清理已落盘文件，避免孤儿文件
        if path.exists():
            try:
                path.unlink()
            except OSError:
                pass
        raise

    return {"id": new_id, "filename": filename}


def delete_package_photo(uid: str, photo_id: int) -> bool:
    """删除某博主的一张包裹图（校验归属）。删记录+删文件。不存在返回 False。"""
    with SessionLocal() as session:
        row = session.get(KolPackagePhoto, photo_id)
        if not row or row.uid != uid:
            return False
        path = UPLOAD_DIR / row.filename
        if path.exists():
            try:
                path.unlink()
            except OSError:
                pass
        session.delete(row)
        session.commit()
    return True


def delete_all_package_photos(uid: str) -> int:
    """删除某博主的全部包裹图（记录+文件）。返回删除条数。供清理/迁移使用。"""
    deleted = 0
    with SessionLocal() as session:
        rows = session.scalars(
            select(KolPackagePhoto).where(KolPackagePhoto.uid == uid)
        ).all()
        for r in rows:
            path = UPLOAD_DIR / r.filename
            if path.exists():
                try:
                    path.unlink()
                except OSError:
                    pass
            session.delete(r)
            deleted += 1
        session.commit()
    return deleted

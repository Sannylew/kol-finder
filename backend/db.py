"""
SQLite 存储层（SQLAlchemy）。以 uid 为唯一键做 upsert，并记录同步日志。
数据文件默认在 backend/kol.db（可用 DATABASE_URL 覆盖）。
"""
from datetime import datetime

from sqlalchemy import (
    Boolean, DateTime, Float, Integer, String, Text, create_engine, event, func, select, text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

import config
import cleaner

# SQLite 需要 check_same_thread=False 以配合多线程（APScheduler + Web）
_is_sqlite = config.DATABASE_URL.startswith("sqlite")
_connect_args = {"check_same_thread": False} if _is_sqlite else {}
engine = create_engine(
    config.DATABASE_URL, connect_args=_connect_args, pool_pre_ping=True, future=True
)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, future=True)


# 启用 WAL 模式 + 外键，提升并发读写与稳定性
if _is_sqlite:
    @event.listens_for(engine, "connect")
    def _sqlite_pragma(dbapi_conn, _rec):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA busy_timeout=5000")
        cur.close()


class Base(DeclarativeBase):
    pass


class Kol(Base):
    __tablename__ = "kol"

    uid: Mapped[str] = mapped_column(String(128), primary_key=True)
    seq: Mapped[int | None] = mapped_column(Integer)
    group_date: Mapped[str | None] = mapped_column(String(32))
    name: Mapped[str | None] = mapped_column(String(128), index=True)
    phone: Mapped[str | None] = mapped_column(String(64), index=True)
    has_contract: Mapped[bool] = mapped_column(Boolean, default=False)
    company: Mapped[str | None] = mapped_column(String(128))
    coop_period: Mapped[str | None] = mapped_column(String(64))
    shipment: Mapped[str | None] = mapped_column(String(64))
    note: Mapped[str | None] = mapped_column(Text)
    size: Mapped[str | None] = mapped_column(String(32))
    height: Mapped[float | None] = mapped_column(Float)
    weight: Mapped[float | None] = mapped_column(Float)
    bust: Mapped[float | None] = mapped_column(Float)
    waist: Mapped[float | None] = mapped_column(Float)
    hip: Mapped[float | None] = mapped_column(Float)
    video_status: Mapped[str | None] = mapped_column(String(64))
    douyin_id: Mapped[str | None] = mapped_column(String(64), index=True)
    address: Mapped[str | None] = mapped_column(Text)
    # 快递状态（如 "8/9已对" / "8.11寄出" / "待寄回"）。本地录入 + 同步共用，非敏感。
    delivery_status: Mapped[str | None] = mapped_column(String(64))
    # 是否在最近一次成功同步的文档中出现。False = 文档已删除、本地仍保留（孤儿）。
    in_doc: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("1"), index=True)
    # 展示优先级：数字越低越靠前，NULL=未设置（排在已设置者之后）。本地附加，同步不覆盖。
    priority: Mapped[int | None] = mapped_column(Integer, index=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime | None] = mapped_column(DateTime)


class SyncLog(Base):
    __tablename__ = "sync_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime)
    total: Mapped[int] = mapped_column(Integer)
    inserted: Mapped[int] = mapped_column(Integer)
    updated: Mapped[int] = mapped_column(Integer)
    message: Mapped[str | None] = mapped_column(String(255))


# 业务字段（不含审计字段）
DATA_FIELDS = [
    "uid", "seq", "group_date", "name", "phone", "has_contract", "company",
    "coop_period", "shipment", "note", "size", "height", "weight",
    "bust", "waist", "hip", "video_status", "douyin_id", "address",
    "delivery_status",
]


def init_db() -> None:
    Base.metadata.create_all(engine)
    _migrate_schema()


def _migrate_schema() -> None:
    """轻量迁移：为旧库补充新增列（SQLite）。既有数据默认视为在文档中（in_doc=1）。"""
    if not _is_sqlite:
        return
    with engine.begin() as conn:
        cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(kol)")}
        if "in_doc" not in cols:
            conn.exec_driver_sql(
                "ALTER TABLE kol ADD COLUMN in_doc BOOLEAN NOT NULL DEFAULT 1"
            )
        if "priority" not in cols:
            conn.exec_driver_sql(
                "ALTER TABLE kol ADD COLUMN priority INTEGER"
            )
        if "delivery_status" not in cols:
            conn.exec_driver_sql(
                "ALTER TABLE kol ADD COLUMN delivery_status VARCHAR(64)"
            )


def _to_float(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _to_int(v):
    if v is None or v == "":
        return None
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _normalize(row: dict) -> dict:
    """把 cleaner 输出的一行，规整成数据库列类型。"""
    return {
        "uid": row["uid"],
        "seq": _to_int(row.get("seq")),
        "group_date": str(row.get("group_date") or "") or None,
        "name": str(row.get("name") or "") or None,
        "phone": str(row.get("phone") or "") or None,
        "has_contract": bool(row.get("has_contract")),
        "company": str(row.get("company") or "") or None,
        "coop_period": str(row.get("coop_period") or "") or None,
        "shipment": str(row.get("shipment") or "") or None,
        "note": str(row.get("note") or "") or None,
        "size": str(row.get("size") or "") or None,
        "height": _to_float(row.get("height")),
        "weight": _to_float(row.get("weight")),
        "bust": _to_float(row.get("bust")),
        "waist": _to_float(row.get("waist")),
        "hip": _to_float(row.get("hip")),
        "video_status": str(row.get("video_status") or "") or None,
        "douyin_id": str(row.get("douyin_id") or "") or None,
        "address": str(row.get("address") or "") or None,
        "delivery_status": str(row.get("delivery_status") or "") or None,
    }


def _migrate_uid(session, old_uid: str, new_uid: str) -> None:
    """把旧 uid 的关联数据迁移到新 uid（用于同一人补填抖音号导致 uid 变化的情况）。
    迁移内容：主图(kol_photo) + 包裹图(kol_package_photo)。随后删除旧的 kol 记录，由新 uid 的 upsert 接管。
    """
    if old_uid == new_uid:
        return
    # 迁移照片：若新 uid 还没有照片，则把旧 uid 的照片移过来；否则删除旧照片记录
    has_new_photo = session.execute(
        text("SELECT 1 FROM kol_photo WHERE uid = :u"), {"u": new_uid}
    ).first()
    if has_new_photo:
        session.execute(text("DELETE FROM kol_photo WHERE uid = :u"), {"u": old_uid})
    else:
        session.execute(
            text("UPDATE kol_photo SET uid = :new WHERE uid = :old"),
            {"new": new_uid, "old": old_uid},
        )
    # 迁移包裹图（一对多，无唯一冲突，直接整体改 uid）
    session.execute(
        text("UPDATE kol_package_photo SET uid = :new WHERE uid = :old"),
        {"new": new_uid, "old": old_uid},
    )
    # 删除旧的博主记录
    session.execute(text("DELETE FROM kol WHERE uid = :u"), {"u": old_uid})


def _upsert_loop(rows: list[dict], *, incremental: bool, now: datetime) -> dict:
    """核心 upsert 逻辑。返回 {inserted, updated, total}。

    去重增强：若新数据的电话能匹配到库中另一条 uid 不同的记录（典型场景：
    某人原来没填抖音号、后来补填导致 uid 从 np:.. 变成 dy:..），则先把旧记录
    （含照片）迁移到新 uid，避免产生重复卡片。

    incremental=False（全量同步）：先把所有已有记录 in_doc 置 False，命中再置回
    True，未出现者保持 False（文档已删除）。安全阀：rows 为空时跳过标记。
    incremental=True（本地导入）：不碰未出现记录的 in_doc；命中的 in_doc=False 行
    置回 True（重新激活），新增行 in_doc=True。
    """
    inserted = updated = 0

    with SessionLocal() as session:
        if rows and not incremental:
            session.query(Kol).update({Kol.in_doc: False}, synchronize_session=False)

        key_to_uid: dict[str, str] = {}
        for u, n, p in session.execute(select(Kol.uid, Kol.name, Kol.phone)).all():
            n = (n or "").strip()
            p = (p or "").strip()
            if n or p:
                key_to_uid[f"{n}|{p}"] = u

        for raw in rows:
            data = _normalize(raw)
            uid = data["uid"]
            n = (data.get("name") or "").strip()
            p = (data.get("phone") or "").strip()
            key = f"{n}|{p}"

            # 查重迁移：同一「姓名+电话」但 uid 变了（旧记录是抖音号 uid）→ 迁移到新 uid
            if (n or p) and key in key_to_uid and key_to_uid[key] != uid:
                old_uid = key_to_uid[key]
                _migrate_uid(session, old_uid, uid)
            if n or p:
                key_to_uid[key] = uid

            update_cols = {k: v for k, v in data.items() if k != "uid"}

            obj = session.get(Kol, uid)
            if obj is None:
                session.add(Kol(**data, in_doc=True, created_at=now, updated_at=now))
                inserted += 1
            else:
                for col, val in update_cols.items():
                    setattr(obj, col, val)
                obj.in_doc = True  # 出现即视为有效（增量导入会把已移除的行重新激活）
                obj.updated_at = now
                updated += 1

        session.commit()

    return {"inserted": inserted, "updated": updated, "total": len(rows)}


def upsert_rows(rows: list[dict]) -> dict:
    """全量同步 upsert（软删除语义），并写一条同步日志。"""
    now = datetime.now()
    stats = _upsert_loop(rows, incremental=False, now=now)
    with SessionLocal() as session:
        session.add(SyncLog(
            synced_at=now, total=len(rows),
            inserted=stats["inserted"], updated=stats["updated"], message="ok",
        ))
        session.commit()
    return stats


def import_rows(rows: list[dict]) -> dict:
    """本地增量导入 upsert：不写同步日志、不触碰未出现记录的 in_doc。"""
    return _upsert_loop(rows, incremental=True, now=datetime.now())


def _payload_to_data(payload: dict) -> dict:
    """把前端表单 payload（标准字段名）规整成数据库列类型（复用 _normalize）。"""
    row = {
        "uid": "",
        "seq": payload.get("seq"),
        "group_date": payload.get("group_date"),
        "name": str(payload.get("name") or "").strip(),
        "phone": str(payload.get("phone") or "").strip(),
        "has_contract": cleaner._to_bool(payload.get("has_contract")),
        "company": payload.get("company"),
        "coop_period": payload.get("coop_period"),
        "shipment": payload.get("shipment"),
        "note": payload.get("note"),
        "size": str(payload.get("size") or "").strip().upper() or None,
        "height": payload.get("height"),
        "weight": payload.get("weight"),
        "bust": payload.get("bust"),
        "waist": payload.get("waist"),
        "hip": payload.get("hip"),
        "video_status": payload.get("video_status"),
        "douyin_id": payload.get("douyin_id"),
        "address": payload.get("address"),
        "delivery_status": payload.get("delivery_status"),
    }
    return _normalize(row)


def create_kol(payload: dict) -> str:
    """手动新增博主。姓名、电话必填。返回新 uid；同名同电话已存在则抛 ValueError。"""
    name = str(payload.get("name") or "").strip()
    phone = str(payload.get("phone") or "").strip()
    if not name:
        raise ValueError("姓名不能为空")
    if not phone:
        raise ValueError("电话不能为空")

    data = _payload_to_data(payload)
    uid = cleaner._make_uid({"name": name, "phone": phone, "douyin_id": data.get("douyin_id") or ""})
    data["uid"] = uid
    now = datetime.now()

    with SessionLocal() as session:
        existing = session.get(Kol, uid)
        if existing is not None:
            if existing.in_doc:
                raise ValueError(f"已存在同名同电话的博主（{name} {phone}）")
            else:
                raise ValueError(f"该博主（{name} {phone}）在「已移除博主」列表中，请先在已移除博主面板恢复后再编辑")
        session.add(Kol(**data, in_doc=True, created_at=now, updated_at=now))
        session.commit()
    return uid


def update_kol(uid: str, payload: dict) -> str | None:
    """编辑博主业务字段（全字段覆盖语义：payload 中未提供的字段会被规整为 NULL）。

    姓名/电话变更会迁移 uid（保留照片+priority+created_at）。
    返回新 uid（可能等于旧 uid）；博主不存在返回 None；新 uid 撞车抛 ValueError。
    注意：前端 KolForm 始终提交全字段；若直接调用 API，需传完整字段，避免误清空。"""
    name = str(payload.get("name") or "").strip()
    phone = str(payload.get("phone") or "").strip()
    if not name:
        raise ValueError("姓名不能为空")
    if not phone:
        raise ValueError("电话不能为空")

    data = _payload_to_data(payload)
    new_uid = cleaner._make_uid({"name": name, "phone": phone, "douyin_id": data.get("douyin_id") or ""})
    data["uid"] = new_uid
    now = datetime.now()

    with SessionLocal() as session:
        obj = session.get(Kol, uid)
        if obj is None:
            return None

        if new_uid != uid:
            if session.get(Kol, new_uid) is not None:
                raise ValueError(f"已存在同名同电话的博主（{name} {phone}）")
            old_priority = obj.priority
            old_created_at = obj.created_at
            _migrate_uid(session, uid, new_uid)  # 删除旧行 + 迁移照片
            session.add(Kol(**data, in_doc=True, priority=old_priority,
                            created_at=old_created_at, updated_at=now))
        else:
            update_cols = {k: v for k, v in data.items() if k != "uid"}
            for col, val in update_cols.items():
                setattr(obj, col, val)
            obj.updated_at = now

        session.commit()
    return new_uid


def get_last_sync() -> dict | None:
    with SessionLocal() as session:
        row = session.scalars(
            select(SyncLog).order_by(SyncLog.id.desc()).limit(1)
        ).first()
        if not row:
            return None
        status = "error" if (row.message or "").lower().startswith("error:") else "ok"
        return {
            "synced_at": row.synced_at.isoformat(timespec="seconds"),
            "total": row.total,
            "inserted": row.inserted,
            "updated": row.updated,
            "message": row.message,
            "status": status,
        }


def record_sync_failure(message: str) -> None:
    """Record a failed sync attempt so status endpoints reflect the latest real state."""
    text_msg = (message or "unknown error").replace("\n", " ").strip()
    if len(text_msg) > 230:
        text_msg = text_msg[:230] + "..."
    with SessionLocal() as session:
        session.add(SyncLog(
            synced_at=datetime.now(),
            total=0,
            inserted=0,
            updated=0,
            message=f"error: {text_msg}",
        ))
        session.commit()


def count_kols() -> int:
    with SessionLocal() as session:
        return session.scalar(select(func.count()).select_from(Kol)) or 0


def count_active_kols() -> int:
    with SessionLocal() as session:
        return session.scalar(
            select(func.count()).select_from(Kol).where(Kol.in_doc.is_(True))
        ) or 0


def count_removed() -> int:
    """文档已移除、本地仍保留（in_doc=False）的博主数。"""
    with SessionLocal() as session:
        return session.scalar(
            select(func.count()).select_from(Kol).where(Kol.in_doc.is_(False))
        ) or 0


def list_removed() -> list[dict]:
    """列出 in_doc=False 的博主（供管理员确认清理，不脱敏）。"""
    import photos
    with SessionLocal() as session:
        rows = session.scalars(
            select(Kol).where(Kol.in_doc.is_(False)).order_by(Kol.name.asc())
        ).all()
        out = []
        for r in rows:
            out.append({
                "uid": r.uid,
                "name": r.name or "",
                "phone": r.phone or "",
                "has_photo": photos.get_photo_filename(r.uid) is not None,
                "pkg_count": len(photos.list_package_photos(r.uid)),
            })
        return out


def _delete_kol_in_session(session, uid: str) -> list[str]:
    """在给定 session 内删除博主及其主图/包裹图的数据库记录。
    返回需要删除的磁盘文件名列表（由调用方在提交后统一清理，保证 DB 与文件一致）。
    博主不存在返回 None。"""
    import photos
    obj = session.get(Kol, uid)
    if obj is None:
        return None

    files: list[str] = []

    # 主图记录
    main = session.get(photos.KolPhoto, uid)
    if main is not None:
        files.append(main.filename)
        session.delete(main)

    # 包裹图记录
    pkgs = session.scalars(
        select(photos.KolPackagePhoto).where(photos.KolPackagePhoto.uid == uid)
    ).all()
    for p in pkgs:
        files.append(p.filename)
        session.delete(p)

    session.delete(obj)
    return files


def _unlink_files(filenames: list[str]) -> None:
    """删除 uploads 目录下的文件，忽略缺失/错误。"""
    import photos
    for fn in filenames:
        photos.delete_upload_file(fn)


def delete_kol(uid: str) -> bool:
    """删除单个博主及其关联（主图 + 包裹图，含文件）。不存在返回 False。
    数据库记录在单个事务内删除，提交成功后再清理磁盘文件，避免 DB 与文件不一致。"""
    with SessionLocal() as session:
        files = _delete_kol_in_session(session, uid)
        if files is None:
            return False
        session.commit()
    _unlink_files(files)
    return True


def purge_removed() -> int:
    """删除全部 in_doc=False 的博主及其关联。返回删除数量。
    所有记录在单事务内删除，提交成功后统一清理文件。"""
    with SessionLocal() as session:
        uids = list(session.scalars(select(Kol.uid).where(Kol.in_doc.is_(False))).all())
        all_files: list[str] = []
        for uid in uids:
            files = _delete_kol_in_session(session, uid)
            if files:
                all_files.extend(files)
        session.commit()
    _unlink_files(all_files)
    return len(uids)


def set_priority(uid: str, value: int | None) -> bool:
    """设置或清空博主优先级（value=None 清空）。命中返回 True，博主不存在返回 False。"""
    with SessionLocal() as session:
        obj = session.get(Kol, uid)
        if obj is None:
            return False
        obj.priority = value
        session.commit()
    return True


def pin_kol(uid: str) -> int | None:
    """置顶：设为当前最小非空 priority - 1（无则 1）。返回新 priority；博主不存在返回 None 且不改动。"""
    with SessionLocal() as session:
        obj = session.get(Kol, uid)
        if obj is None:
            return None
        min_p = session.scalar(
            select(func.min(Kol.priority)).where(Kol.priority.isnot(None))
        )
        # 无已设置优先级则用 1；否则设为比当前最小更靠前（最低到 0）
        new_val = 1 if min_p is None else max(0, min_p - 1)
        obj.priority = new_val
        session.commit()
        return new_val


def unpin_kol(uid: str) -> bool:
    """取消置顶：清空 priority。命中返回 True，博主不存在返回 False。"""
    return set_priority(uid, None)


def set_priority_batch(uids: list[str], value: int | None) -> int:
    """批量设置/清空优先级。返回实际更新的博主数量。单事务处理。"""
    if not uids:
        return 0
    updated = 0
    with SessionLocal() as session:
        for uid in uids:
            obj = session.get(Kol, uid)
            if obj is not None:
                obj.priority = value
                updated += 1
        session.commit()
    return updated


def reorder_priority(uids: list[str]) -> int | None:
    """Assign continuous priority values to the given KOLs in one transaction."""
    if not uids:
        return 0
    with SessionLocal() as session:
        rows = session.scalars(select(Kol).where(Kol.uid.in_(uids))).all()
        by_uid = {row.uid: row for row in rows}
        if len(by_uid) != len(uids):
            return None
        for idx, uid in enumerate(uids, start=1):
            by_uid[uid].priority = idx
        session.commit()
        return len(uids)


def apply_priorities(items: list[dict]) -> int | None:
    """Apply explicit priority values in one transaction.

    The submitted uid set must exactly match active KOLs. This prevents partial
    saves from filtered lists and avoids accidentally updating removed records.
    """
    if not items:
        return 0
    uids = [str(item["uid"]) for item in items]
    with SessionLocal() as session:
        active_uids = set(session.scalars(
            select(Kol.uid).where(Kol.in_doc.is_(True))
        ).all())
        if set(uids) != active_uids:
            return None
        rows = session.scalars(
            select(Kol).where(Kol.uid.in_(uids), Kol.in_doc.is_(True))
        ).all()
        by_uid = {row.uid: row for row in rows}
        if len(by_uid) != len(uids):
            return None
        for item in items:
            by_uid[str(item["uid"])].priority = item.get("priority")
        session.commit()
        return len(items)


def list_sync_logs(limit: int = 50) -> list[dict]:
    """历史同步记录，按时间倒序。"""
    limit = min(max(1, limit), 500)
    with SessionLocal() as session:
        rows = session.scalars(
            select(SyncLog).order_by(SyncLog.id.desc()).limit(limit)
        ).all()
        return [{
            "synced_at": r.synced_at.isoformat(timespec="seconds"),
            "total": r.total,
            "inserted": r.inserted,
            "updated": r.updated,
            "message": r.message,
        } for r in rows]

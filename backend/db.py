"""
SQLite 存储层（SQLAlchemy）。以 uid 为唯一键做 upsert，并记录同步日志。
数据文件默认在 backend/kol.db（可用 DATABASE_URL 覆盖）。
"""
from datetime import datetime

from sqlalchemy import (
    Boolean, DateTime, Float, Integer, String, Text, create_engine, event, func, select,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

import config

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
]


def init_db() -> None:
    Base.metadata.create_all(engine)


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
    }


def _migrate_uid(session, old_uid: str, new_uid: str) -> None:
    """把旧 uid 的关联数据迁移到新 uid（用于同一人补填抖音号导致 uid 变化的情况）。
    迁移内容：主图(kol_photo) + 包裹图(kol_package_photo)。随后删除旧的 kol 记录，由新 uid 的 upsert 接管。
    """
    if old_uid == new_uid:
        return
    # 迁移照片：若新 uid 还没有照片，则把旧 uid 的照片移过来；否则删除旧照片记录
    from sqlalchemy import text
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


def upsert_rows(rows: list[dict]) -> dict:
    """按 uid upsert。返回 {inserted, updated, total}。

    去重增强：若新数据的电话能匹配到库中另一条 uid 不同的记录（典型场景：
    某人原来没填抖音号、后来补填导致 uid 从 np:.. 变成 dy:..），则先把旧记录
    （含照片）迁移到新 uid，避免产生重复卡片。
    """
    now = datetime.now()
    inserted = updated = 0

    with SessionLocal() as session:
        existing_uids = set(session.scalars(select(Kol.uid)).all())
        # 姓名+电话 -> uid 映射，用于查重迁移（兼容历史上用抖音号当 uid 的旧记录）
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
                existing_uids.discard(old_uid)
            if n or p:
                key_to_uid[key] = uid

            update_cols = {k: v for k, v in data.items() if k != "uid"}

            # 版本无关的 upsert：存在则更新（保留 created_at），否则插入
            obj = session.get(Kol, uid)
            if obj is None:
                session.add(Kol(**data, created_at=now, updated_at=now))
                inserted += 1
                existing_uids.add(uid)
            else:
                for col, val in update_cols.items():
                    setattr(obj, col, val)
                obj.updated_at = now
                updated += 1

        session.add(SyncLog(
            synced_at=now, total=len(rows),
            inserted=inserted, updated=updated, message="ok",
        ))
        session.commit()

    # 注意：updated 这里是“命中已存在记录”的数量，含内容未变的。
    return {"inserted": inserted, "updated": updated, "total": len(rows)}


def get_last_sync() -> dict | None:
    with SessionLocal() as session:
        row = session.scalars(
            select(SyncLog).order_by(SyncLog.id.desc()).limit(1)
        ).first()
        if not row:
            return None
        return {
            "synced_at": row.synced_at.isoformat(timespec="seconds"),
            "total": row.total,
            "inserted": row.inserted,
            "updated": row.updated,
            "message": row.message,
        }


def count_kols() -> int:
    with SessionLocal() as session:
        return session.scalar(select(func.count()).select_from(Kol)) or 0

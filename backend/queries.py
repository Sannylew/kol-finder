"""
达人数据查询层：分页、搜索、筛选、统计。全部在数据库做，支持大数据量。
"""
from sqlalchemy import func, or_, select

from db import Kol, SessionLocal
import photos
import settings_store


def _mask_phone(s: str) -> str:
    s = str(s)
    if len(s) >= 7:
        return s[:3] + "*" * (len(s) - 7) + s[-4:]
    return s[:1] + "*" * max(len(s) - 1, 0)


def _mask_generic(s: str) -> str:
    s = str(s)
    n = len(s)
    if n <= 1:
        return "*"
    if n <= 4:
        return s[0] + "*" * (n - 1)
    keep = max(1, n // 4)
    return s[:keep] + "*" * (n - keep * 2) + s[-keep:]


def _mask_address(s: str) -> str:
    """地址保留前面省市区，后面详细门牌打码。"""
    s = str(s)
    if not s:
        return s
    # 保留前 6 个字（大致到区/县），其余打码
    head = s[:6]
    return head + "*" * min(max(len(s) - 6, 0), 12)


def _apply_mask(row: dict) -> dict:
    """脱敏（白名单策略）：仅保留姓名/照片/签约等识别字段，其余一律遮罩。
    新增字段默认被脱敏，避免遗漏。
    """
    # 完全保留明文的字段（识别 + 系统字段 + 身材数据）
    keep_plain = {
        "uid", "name", "has_contract", "photo_url", "updated_at",
        "height", "weight", "bust", "waist", "hip",
    }
    # 用专门规则部分遮罩的字段
    out = dict(row)

    for key, val in row.items():
        if key in keep_plain:
            continue
        if val is None or val == "":
            continue
        if key == "phone":
            out[key] = _mask_phone(str(val))
        elif key == "address":
            out[key] = _mask_address(str(val))
        elif key in ("douyin_id", "company"):
            out[key] = _mask_generic(str(val))
        else:
            # 其余所有字段（尺码/周期/身材/备注/序号/建群时间/邮寄/视频等）整体打码
            out[key] = "***"

    out["_masked"] = True
    return out


def _row_to_dict(k: Kol) -> dict:
    return {
        "uid": k.uid,
        "seq": k.seq,
        "group_date": k.group_date,
        "name": k.name,
        "phone": k.phone,
        "has_contract": k.has_contract,
        "company": k.company,
        "coop_period": k.coop_period,
        "shipment": k.shipment,
        "note": k.note,
        "size": k.size,
        "height": k.height,
        "weight": k.weight,
        "bust": k.bust,
        "waist": k.waist,
        "hip": k.hip,
        "video_status": k.video_status,
        "douyin_id": k.douyin_id,
        "address": k.address,
        "updated_at": k.updated_at.isoformat(timespec="seconds") if k.updated_at else None,
    }


def _photo_url(filename: str | None) -> str | None:
    return f"/uploads/{filename}" if filename else None


# 允许的排序字段白名单
SORTABLE = {
    "seq": Kol.seq, "name": Kol.name, "group_date": Kol.group_date,
    "height": Kol.height, "weight": Kol.weight, "updated_at": Kol.updated_at,
}


def list_kols(
    *,
    keyword: str = "",
    has_contract: bool | None = None,
    size: str = "",
    coop_period: str = "",
    company: str = "",
    page: int = 1,
    page_size: int = 20,
    sort_by: str = "seq",
    order: str = "asc",
    privileged: bool = False,
) -> dict:
    """分页查询达人列表。privileged=True（已登录管理员）时不脱敏。"""
    page = max(1, page)
    page_size = min(max(1, page_size), 200)

    with SessionLocal() as session:
        stmt = select(Kol)

        if keyword:
            like = f"%{keyword.strip()}%"
            stmt = stmt.where(or_(
                Kol.name.ilike(like),
                Kol.phone.ilike(like),
                Kol.douyin_id.ilike(like),
                Kol.company.ilike(like),
                Kol.note.ilike(like),
                Kol.address.ilike(like),
            ))
        if has_contract is not None:
            stmt = stmt.where(Kol.has_contract == has_contract)
        if size:
            stmt = stmt.where(Kol.size == size)
        if coop_period:
            stmt = stmt.where(Kol.coop_period == coop_period)
        if company:
            masked_view = settings_store.is_mask_enabled() and not privileged
            if masked_view:
                # 访客看到的是打码公司名，反查所有打码后等于该值的真实公司名再匹配
                all_companies = session.execute(
                    select(Kol.company).distinct().where(Kol.company.isnot(None))
                ).all()
                matched = [c for (c,) in all_companies if c and _mask_generic(c) == company]
                if matched:
                    stmt = stmt.where(Kol.company.in_(matched))
                else:
                    # 兜底：也允许直接精确匹配（理论上不会命中）
                    stmt = stmt.where(Kol.company == company)
            else:
                stmt = stmt.where(Kol.company == company)

        # 总数
        total = session.scalar(
            select(func.count()).select_from(stmt.subquery())
        ) or 0

        # 排序
        col = SORTABLE.get(sort_by, Kol.seq)
        col = col.desc() if order.lower() == "desc" else col.asc()
        stmt = stmt.order_by(col).offset((page - 1) * page_size).limit(page_size)

        rows = session.scalars(stmt).all()
        items = [_row_to_dict(k) for k in rows]

    # 批量附加照片 URL
    photo_map = photos.get_photo_map([it["uid"] for it in items])
    for it in items:
        it["photo_url"] = _photo_url(photo_map.get(it["uid"]))

    # 脱敏（开启时只保留姓名+照片+签约）；管理员登录则不脱敏
    if settings_store.is_mask_enabled() and not privileged:
        items = [_apply_mask(it) for it in items]

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size,
    }


def get_kol(uid: str, privileged: bool = False) -> dict | None:
    with SessionLocal() as session:
        k = session.get(Kol, uid)
        if not k:
            return None
        row = _row_to_dict(k)
    row["photo_url"] = _photo_url(photos.get_photo_filename(uid))
    if settings_store.is_mask_enabled() and not privileged:
        row = _apply_mask(row)
    return row


def stats(privileged: bool = False) -> dict:
    """统计概览。脱敏开启且未登录时，隐藏具体数字与分布，避免绕过前端脱敏。"""
    if settings_store.is_mask_enabled() and not privileged:
        return {
            "total": None,
            "contracted": None,
            "uncontracted": None,
            "today_new": None,
            "week_new": None,
            "with_photo": None,
            "size_distribution": [],
            "coop_period_distribution": [],
            "masked": True,
        }

    from datetime import datetime, timedelta
    now = datetime.now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=today_start.weekday())  # 本周一 00:00

    with SessionLocal() as session:
        total = session.scalar(select(func.count()).select_from(Kol)) or 0
        contracted = session.scalar(
            select(func.count()).select_from(Kol).where(Kol.has_contract.is_(True))
        ) or 0

        # 今日 / 本周新增（按 created_at；created_at 仅首次入库时写入，不会被同步覆盖）
        today_new = session.scalar(
            select(func.count()).select_from(Kol).where(Kol.created_at >= today_start)
        ) or 0
        week_new = session.scalar(
            select(func.count()).select_from(Kol).where(Kol.created_at >= week_start)
        ) or 0

        # 尺码分布
        size_rows = session.execute(
            select(Kol.size, func.count())
            .group_by(Kol.size).order_by(func.count().desc())
        ).all()
        size_dist = [
            {"size": s or "未填", "count": c} for s, c in size_rows
        ]

        # 合作周期分布
        period_rows = session.execute(
            select(Kol.coop_period, func.count())
            .group_by(Kol.coop_period).order_by(func.count().desc())
        ).all()
        period_dist = [
            {"period": p or "未填", "count": c} for p, c in period_rows
        ]

    # 有照片的博主数
    with_photo = photos.count_photos()

    return {
        "total": total,
        "contracted": contracted,
        "uncontracted": total - contracted,
        "today_new": today_new,
        "week_new": week_new,
        "with_photo": with_photo,
        "size_distribution": size_dist,
        "coop_period_distribution": period_dist,
    }


def filter_options(privileged: bool = False) -> dict:
    """返回可用于筛选的去重选项（尺码、合作周期、公司）。
    尺码、合作周期为筛选用的非敏感字段，始终明文返回。
    公司名脱敏时做部分打码（保留显示、不隐藏），打码值用于筛选时由后端反查匹配。
    """
    masked = settings_store.is_mask_enabled() and not privileged
    with SessionLocal() as session:
        sizes = [s for (s,) in session.execute(
            select(Kol.size).distinct().where(Kol.size.isnot(None)).order_by(Kol.size)
        ).all() if s]
        periods = [p for (p,) in session.execute(
            select(Kol.coop_period).distinct()
            .where(Kol.coop_period.isnot(None)).order_by(Kol.coop_period)
        ).all() if p]
        raw_companies = [c for (c,) in session.execute(
            select(Kol.company).distinct()
            .where(Kol.company.isnot(None)).order_by(Kol.company)
        ).all() if c]

    if masked:
        # 打码后去重并保持顺序（多个真实公司可能打码成同一显示值，合并为一个选项）
        seen = set()
        companies = []
        for c in raw_companies:
            mc = _mask_generic(c)
            if mc not in seen:
                seen.add(mc)
                companies.append(mc)
    else:
        companies = raw_companies

    return {"sizes": sizes, "coop_periods": periods, "companies": companies}

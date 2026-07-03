"""
运行时配置存储（数据库）。优先级：数据库 > .env 默认值。

网页后台改的配置存这里，立即生效，无需重启或改文件。
"""
from sqlalchemy import String, Text, select
from sqlalchemy.orm import Mapped, mapped_column

import config
from db import Base, SessionLocal, engine

# 支持的配置键 + 默认值（默认取自 .env / config）
DEFAULTS = {
    "kdocs_webhook_url": config.KDOCS_WEBHOOK_URL,
    "kdocs_token": config.KDOCS_TOKEN,
    "sync_interval_seconds": str(config.SYNC_INTERVAL_SECONDS),
    "auto_sync_enabled": "1",  # 自动同步总开关：1=开
    "mask_enabled": "0",  # 前端脱敏开关：1=开（只显示姓名+照片）
    "company_name": "",  # 公司名称（显示在左上角品牌区，公开可见）
}

SECRET_KEYS = {"kdocs_token"}  # 返回前端时遮罩


class Setting(Base):
    __tablename__ = "app_setting"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


def init_settings_table() -> None:
    Base.metadata.create_all(engine, tables=[Setting.__table__])


def get_all() -> dict:
    """返回全部配置（数据库覆盖默认值）。"""
    result = dict(DEFAULTS)
    with SessionLocal() as session:
        for row in session.scalars(select(Setting)).all():
            result[row.key] = row.value
    return result


def get(key: str) -> str:
    return get_all().get(key, "")


def set_many(items: dict) -> None:
    """批量写入配置。只接受已知键，忽略空 token（避免被遮罩值覆盖）。"""
    with SessionLocal() as session:
        for key, value in items.items():
            if key not in DEFAULTS:
                continue
            value = "" if value is None else str(value)
            # token 传空表示“不修改”，跳过
            if key in SECRET_KEYS and value.strip() == "":
                continue
            row = session.get(Setting, key)
            if row:
                row.value = value
            else:
                session.add(Setting(key=key, value=value))
        session.commit()


def get_public() -> dict:
    """给前端展示用：敏感字段遮罩、附带是否已配置标记。"""
    data = get_all()
    out = {}
    for k, v in data.items():
        if k in SECRET_KEYS:
            out[k] = ""  # 不回传明文
            out[k + "_set"] = bool(str(v).strip())
        else:
            out[k] = v
    return out


def get_sync_interval() -> int:
    try:
        return int(get("sync_interval_seconds"))
    except (TypeError, ValueError):
        return config.SYNC_INTERVAL_SECONDS


def is_mask_enabled() -> bool:
    return str(get("mask_enabled")).strip() in {"1", "true", "True"}


def is_auto_sync_enabled() -> bool:
    return str(get("auto_sync_enabled")).strip() in {"1", "true", "True"}


def get_company_name() -> str:
    return str(get("company_name") or "").strip()

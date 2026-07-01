"""
数据清洗：把金山原始返回的行数据，转成干净统一的结构。

处理：
- 清洗表头里的换行/空白（情况\n\n备注 -> 备注）
- 丢弃空的占位列（col1 等）
- Excel 日期序列号 -> YYYY-MM-DD
- 合同列 ✅/√/是 -> True
- 数字型电话/抖音号转成字符串（避免精度丢失与前导零问题）
- 生成稳定的唯一键 uid（优先抖音号，其次姓名+电话）
"""
from datetime import datetime, timedelta
import re

# 原始表头 -> 标准字段名
HEADER_MAP = {
    "序号": "seq",
    "建群时间": "group_date",
    "姓名": "name",
    "电话": "phone",
    "合同": "has_contract",
    "公司": "company",
    "合作时间": "coop_period",
    "邮寄件数": "shipment",
    "备注": "note",
    "情况备注": "note",
    "尺码": "size",
    "身高": "height",
    "体重": "weight",
    "胸围": "bust",
    "腰围": "waist",
    "臀围": "hip",
    "抖音视频情况": "video_status",
    "抖音号": "douyin_id",
    "收货地址": "address",
}

DATE_FIELDS = {"group_date"}
BOOL_FIELDS = {"has_contract"}
STR_FIELDS = {"phone", "douyin_id"}  # 强制转字符串，避免大数精度问题
TRUE_TOKENS = {"✅", "√", "是", "true", "TRUE", "1"}


def _norm_header(raw: str) -> str:
    """去掉表头里的所有空白与换行。"""
    return "".join(str(raw).split())


def _excel_serial_to_date(value) -> str:
    """Excel 日期序列号转 YYYY-MM-DD。非数字原样返回字符串。"""
    try:
        serial = float(value)
    except (TypeError, ValueError):
        return str(value).strip()
    # Excel 起点 1899-12-30（兼容 1900 闰年 bug）
    if serial <= 0:
        return str(value).strip()
    base = datetime(1899, 12, 30)
    try:
        return (base + timedelta(days=serial)).strftime("%Y-%m-%d")
    except OverflowError:
        return str(value).strip()


def _to_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {t.lower() for t in TRUE_TOKENS}


def _to_str(value) -> str:
    """数字转字符串去掉末尾 .0；其余 strip。"""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def clean_row(raw: dict) -> dict:
    """清洗单行。返回标准字段名的 dict。"""
    out = {}
    for raw_key, val in raw.items():
        field = HEADER_MAP.get(_norm_header(raw_key))
        if field is None:
            continue  # 丢弃 col1 等无映射列
        if val is None:
            val = ""

        if field in DATE_FIELDS:
            val = _excel_serial_to_date(val)
        elif field in BOOL_FIELDS:
            val = _to_bool(val)
        elif field in STR_FIELDS:
            val = _to_str(val)
        elif isinstance(val, str):
            val = val.strip()

        # 尺码统一大写（s/m -> S/M），中文等其他字符不受影响
        if field == "size" and isinstance(val, str):
            val = val.upper()

        out[field] = val

    # 收货地址优化：去掉开头重复的「姓名 电话」，只留纯地址
    out["address"] = _clean_address(
        out.get("address", ""), out.get("name", ""), out.get("phone", "")
    )

    out["uid"] = _make_uid(out)
    return out


def _clean_address(addr: str, name: str, phone: str) -> str:
    """地址格式通常是「姓名 电话 真实地址」，去掉前缀的姓名和电话。"""
    s = str(addr or "").strip()
    if not s:
        return ""
    name = str(name or "").strip()
    phone = str(phone or "").strip()

    # 去掉开头的姓名
    if name and s.startswith(name):
        s = s[len(name):].strip()
    # 去掉开头的电话
    if phone and s.startswith(phone):
        s = s[len(phone):].strip()
    # 个别顺序是 电话 在前的，再兜底去一次姓名
    if name and s.startswith(name):
        s = s[len(name):].strip()

    # 把中间多余空白压成单空格
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _make_uid(row: dict) -> str:
    """生成稳定唯一键：用姓名+电话（两者文档里必有，且不随补填抖音号而变）。
    退化处理：缺电话时用抖音号兜底，再不行只用姓名，避免 uid 为空。
    """
    name = str(row.get("name", "")).strip()
    phone = str(row.get("phone", "")).strip()
    if name and phone:
        return f"np:{name}|{phone}"
    if phone:
        return f"np:|{phone}"
    douyin = str(row.get("douyin_id", "")).strip()
    if douyin:
        return "dy:" + douyin
    return f"np:{name}|"


def clean_rows(raw_rows: list[dict]) -> list[dict]:
    cleaned = []
    for raw in raw_rows:
        row = clean_row(raw)
        if str(row.get("name", "")).strip():  # 必须有姓名才算有效
            cleaned.append(row)
    return cleaned

"""
金山文档 AirScript HTTP API 客户端。

负责：调用金山的「同步执行脚本」接口，拿到 AirScript 里 return 的 JSON 数据。

官方接口：
  POST https://{host}/api/v3/ide/file/{file_id}/script/{script_id}/sync_task
  Header: AirScript-Token, Content-Type: application/json
  返回:  data.result 即脚本 return 的字符串

host 支持 www.kdocs.cn 与 365.kdocs.cn 等，自动从 webhook 链接识别。
"""
import json
import re
from urllib.parse import urlparse

import requests

# 允许的金山域名后缀（白名单，避免把 webhook 发到任意主机）
_ALLOWED_HOST_SUFFIX = ("kdocs.cn", "wps.cn")

_WEBHOOK_RE = re.compile(
    r"/api/v3/ide/file/(?P<file_id>[^/]+)/script/(?P<script_id>[^/]+)/(?:sync_task|task)"
)


class KdocsError(Exception):
    """金山接口调用异常。"""


def parse_webhook(webhook_url: str) -> tuple[str, str, str]:
    """从 webhook 链接解析出 (base_url, file_id, script_id)。

    例如:
      https://365.kdocs.cn/api/v3/ide/file/536156153075/script/V2-xxx/sync_task
      -> ("https://365.kdocs.cn", "536156153075", "V2-xxx")
    """
    parsed = urlparse(webhook_url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise KdocsError(f"webhook 链接格式不对: {webhook_url}")

    host = parsed.netloc.lower()
    if not any(host == s or host.endswith("." + s) for s in _ALLOWED_HOST_SUFFIX):
        raise KdocsError(f"不被信任的域名: {host}")

    m = _WEBHOOK_RE.search(parsed.path)
    if not m:
        raise KdocsError(f"无法从链接解析 file_id/script_id: {webhook_url}")

    base_url = f"{parsed.scheme}://{parsed.netloc}"
    return base_url, m.group("file_id"), m.group("script_id")


class KdocsClient:
    # 默认域名，当只给 file_id/script_id 不给完整链接时使用
    DEFAULT_BASE_URL = "https://www.kdocs.cn"

    def __init__(
        self,
        token: str,
        webhook_url: str = "",
        file_id: str = "",
        script_id: str = "",
        base_url: str = "",
        timeout: int = 60,
    ):
        """两种用法：
        1. 传 webhook_url（推荐）：自动解析域名/file_id/script_id
        2. 传 file_id + script_id（+ 可选 base_url）
        """
        if not token:
            raise ValueError("token 不能为空")

        if webhook_url:
            base_url, file_id, script_id = parse_webhook(webhook_url)

        if not (file_id and script_id):
            raise ValueError("需要 webhook_url，或同时提供 file_id 和 script_id")

        self.token = token
        self.file_id = file_id
        self.script_id = script_id
        self.base_url = (base_url or self.DEFAULT_BASE_URL).rstrip("/")
        self.timeout = timeout

    def _sync_task_url(self) -> str:
        return (
            f"{self.base_url}/api/v3/ide/file/{self.file_id}"
            f"/script/{self.script_id}/sync_task"
        )

    def fetch_rows(self, argv: dict | None = None) -> dict:
        """同步执行脚本并返回解析后的数据。

        返回结构: {"headers": [...], "rows": [...], "total": N}
        """
        headers = {
            "Content-Type": "application/json",
            "AirScript-Token": self.token,
        }
        body = {"Context": {"argv": argv or {}}}

        try:
            resp = requests.post(
                self._sync_task_url(),
                headers=headers,
                data=json.dumps(body),
                timeout=self.timeout,
            )
        except requests.RequestException as e:
            raise KdocsError(f"请求金山接口失败: {e}") from e

        if resp.status_code != 200:
            raise KdocsError(
                f"金山接口返回 HTTP {resp.status_code}: {resp.text[:300]}"
            )

        try:
            payload = resp.json()
        except ValueError as e:
            raise KdocsError(f"金山返回非 JSON: {resp.text[:300]}") from e

        if payload.get("error"):
            raise KdocsError(f"脚本执行错误: {payload['error']}")

        result = (payload.get("data") or {}).get("result")
        if result is None:
            raise KdocsError(f"未取到 data.result，原始返回: {payload}")

        if isinstance(result, str):
            try:
                result = json.loads(result)
            except ValueError as e:
                raise KdocsError(f"data.result 不是合法 JSON: {result[:300]}") from e

        if not isinstance(result, dict) or "rows" not in result:
            raise KdocsError(f"返回数据结构不符合预期: {result}")

        return result

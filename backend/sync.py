"""
同步主逻辑：金山拉取 -> 清洗 -> 入库。

用法：
  python sync.py            # 执行一次同步
  python sync.py --loop     # 按 SYNC_INTERVAL_SECONDS 间隔循环同步
"""
import logging
import sys
import threading
import time
from datetime import datetime

import config
import db
import settings_store
from cleaner import clean_rows
from kdocs_client import KdocsClient, KdocsError

logger = logging.getLogger("kol.sync")

# 同步并发锁：手动同步与定时同步互斥，避免同一时刻重复 upsert
_sync_lock = threading.Lock()


def build_client() -> KdocsClient:
    # 优先用后台数据库里的配置，回退到 .env
    s = settings_store.get_all()
    return KdocsClient(
        token=s.get("kdocs_token") or config.KDOCS_TOKEN,
        webhook_url=s.get("kdocs_webhook_url") or config.KDOCS_WEBHOOK_URL,
        file_id=config.KDOCS_FILE_ID,
        script_id=config.KDOCS_SCRIPT_ID,
    )


def sync_once(client: KdocsClient | None = None) -> dict:
    """执行一次同步，返回统计。并发调用时会串行执行（拿不到锁则等待）。"""
    with _sync_lock:
        try:
            client = client or build_client()
            data = client.fetch_rows()
            rows = clean_rows(data.get("rows", []))
            stats = db.upsert_rows(rows)
            return stats
        except Exception as e:
            db.record_sync_failure(str(e))
            raise


def main():
    # 独立运行时也初始化日志（用于 --loop 作为后台服务）
    try:
        from logging_setup import setup_logging
        setup_logging()
    except Exception:  # noqa: BLE001
        pass

    s = settings_store.get_all()
    if not (s.get("kdocs_token") or config.KDOCS_TOKEN):
        print("[X] 未配置 KDOCS_TOKEN，请检查 backend/.env 或后台设置")
        return

    db.init_db()
    loop = "--loop" in sys.argv

    if not loop:
        _run_and_print()
        return

    interval = config.SYNC_INTERVAL_SECONDS
    print(f"[启动] 定时同步，每 {interval} 秒一次。Ctrl+C 停止。")
    while True:
        _run_and_print()
        try:
            time.sleep(interval)
        except KeyboardInterrupt:
            print("\n[停止] 已退出定时同步。")
            break


def _run_and_print():
    ts = datetime.now().strftime("%H:%M:%S")
    try:
        stats = sync_once()
        print(
            f"[{ts}] 同步完成：共 {stats['total']} 行，"
            f"新增 {stats['inserted']}，更新 {stats['updated']}"
        )
    except KdocsError as e:
        print(f"[{ts}] 同步失败：{e}")
    except Exception as e:  # noqa: BLE001 兜底，避免循环中断
        print(f"[{ts}] 未预期错误：{e}")


if __name__ == "__main__":
    main()

import { useEffect, useState } from "react";
import { fetchSyncLogs, type SyncLogItem } from "../api";

export default function SyncLogs() {
  const [items, setItems] = useState<SyncLogItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSyncLogs(100)
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="admin-page">
      <div className="admin-page-head"><h2>同步记录</h2></div>
      <div className="admin-card">
        {loading ? (
          <p className="hint">读取中…</p>
        ) : items.length === 0 ? (
          <p className="hint">暂无记录</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr><th>时间</th><th>总数</th><th>新增</th><th>更新</th><th>结果</th></tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td>{new Date(it.synced_at).toLocaleString("zh-CN")}</td>
                  <td>{it.total}</td>
                  <td>{it.inserted}</td>
                  <td>{it.updated}</td>
                  <td>{it.message || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

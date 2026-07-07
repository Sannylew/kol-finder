import { useEffect, useState } from "react";
import { fetchRemovedKols, deleteKol, purgeRemovedKols, type RemovedKol } from "../api";
import ConfirmDialog from "../components/ConfirmDialog";

export default function RemovedPanel() {
  const [items, setItems] = useState<RemovedKol[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState<RemovedKol | null>(null);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  function load() {
    setLoading(true);
    fetchRemovedKols().then((r) => setItems(r.items)).catch(() => setItems([])).finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  async function handleDelete() {
    const target = confirmDel; setConfirmDel(null);
    if (!target) return;
    setBusy(true); setMsg(null);
    try {
      await deleteKol(target.uid);
      setItems((prev) => prev.filter((x) => x.uid !== target.uid));
      setMsg({ type: "ok", text: `已删除「${target.name || target.uid}」` });
    } catch (e: any) { setMsg({ type: "err", text: e?.response?.data?.detail || "删除失败" }); }
    finally { setBusy(false); }
  }

  async function handlePurge() {
    setConfirmPurge(false); setBusy(true); setMsg(null);
    try {
      const { deleted } = await purgeRemovedKols();
      setItems([]);
      setMsg({ type: "ok", text: `已清理 ${deleted} 个已移除博主` });
    } catch (e: any) { setMsg({ type: "err", text: e?.response?.data?.detail || "清理失败" }); }
    finally { setBusy(false); }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <h2>已移除博主</h2>
        {items.length > 0 && (
          <button className="btn-danger sm" disabled={busy} onClick={() => setConfirmPurge(true)}>全部清理</button>
        )}
      </div>
      {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}

      <div className="admin-card">
        <p className="hint" style={{ marginBottom: 14 }}>
          以下博主已从在线文档中删除，但本地仍保留。删除将连带其照片、已拍衣服，不可恢复。
        </p>
        {loading ? <p className="hint">读取中…</p>
          : items.length === 0 ? <div className="removed-empty">暂无已移除博主</div>
          : (
            <div className="removed-list">
              {items.map((r) => (
                <div className="removed-row" key={r.uid}>
                  <div className="removed-info">
                    <span className="removed-name">{r.name || "未命名"}</span>
                    <span className="removed-phone">{r.phone || "—"}</span>
                    <span className="removed-tags">
                      {r.has_photo && <span className="removed-tag">主图</span>}
                      {r.pkg_count > 0 && <span className="removed-tag">已拍衣服 {r.pkg_count}</span>}
                    </span>
                  </div>
                  <button className="btn-ghost sm danger" disabled={busy} onClick={() => setConfirmDel(r)}>删除</button>
                </div>
              ))}
            </div>
          )}
      </div>

      <ConfirmDialog
        open={!!confirmDel}
        title="删除博主"
        message={`确定删除「${confirmDel?.name || ""}」吗？将同时删除其照片和已拍衣服，不可恢复。`}
        confirmText="删除" danger
        onConfirm={handleDelete}
        onCancel={() => setConfirmDel(null)}
      />
      <ConfirmDialog
        open={confirmPurge}
        title="全部清理"
        message={`确定清理全部 ${items.length} 个已移除博主吗？将同时删除他们的照片和已拍衣服，不可恢复。`}
        confirmText="全部清理" danger
        onConfirm={handlePurge}
        onCancel={() => setConfirmPurge(false)}
      />
    </div>
  );
}

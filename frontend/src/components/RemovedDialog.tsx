import { useEffect, useState } from "react";
import { fetchRemovedKols, deleteKol, purgeRemovedKols, type RemovedKol } from "../api";
import { useScrollLock } from "../useScrollLock";
import ConfirmDialog from "./ConfirmDialog";

interface Props {
  open: boolean;
  onClose: () => void;
  onChanged: () => void; // 删除/清理后通知父组件刷新列表、统计、角标
  onToast: (text: string, type?: "" | "ok" | "err") => void;
}

export default function RemovedDialog({ open, onClose, onChanged, onToast }: Props) {
  const [items, setItems] = useState<RemovedKol[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState<RemovedKol | null>(null);
  const [confirmPurge, setConfirmPurge] = useState(false);
  useScrollLock(open);

  function load() {
    setLoading(true);
    fetchRemovedKols()
      .then((r) => setItems(r.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleDelete() {
    const target = confirmDel;
    if (!target) return;
    setConfirmDel(null);
    setBusy(true);
    try {
      await deleteKol(target.uid);
      setItems((prev) => prev.filter((x) => x.uid !== target.uid));
      onChanged();
      onToast(`已删除「${target.name || target.uid}」`, "ok");
    } catch (err: any) {
      onToast("删除失败：" + (err?.response?.data?.detail || err.message), "err");
    } finally {
      setBusy(false);
    }
  }

  async function handlePurge() {
    setConfirmPurge(false);
    setBusy(true);
    try {
      const { deleted } = await purgeRemovedKols();
      setItems([]);
      onChanged();
      onToast(`已清理 ${deleted} 个已移除博主`, "ok");
    } catch (err: any) {
      onToast("清理失败：" + (err?.response?.data?.detail || err.message), "err");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>文档已移除的博主</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p className="hint" style={{ marginBottom: 16 }}>
            以下博主已从在线文档中删除，但本地仍保留。可单独删除或一键清理（连带其照片、包裹图，不可恢复）。
          </p>

          {loading ? (
            <p className="hint">读取中…</p>
          ) : items.length === 0 ? (
            <div className="removed-empty">暂无已移除博主</div>
          ) : (
            <>
              <div className="removed-toolbar">
                <span className="removed-total">共 {items.length} 个</span>
                <button
                  className="btn-danger sm"
                  disabled={busy}
                  onClick={() => setConfirmPurge(true)}
                >
                  全部清理
                </button>
              </div>
              <div className="removed-list">
                {items.map((r) => (
                  <div className="removed-row" key={r.uid}>
                    <div className="removed-info">
                      <span className="removed-name">{r.name || "未命名"}</span>
                      <span className="removed-phone">{r.phone || "—"}</span>
                      <span className="removed-tags">
                        {r.has_photo && <span className="removed-tag">主图</span>}
                        {r.pkg_count > 0 && <span className="removed-tag">包裹图 {r.pkg_count}</span>}
                      </span>
                    </div>
                    <button
                      className="btn-ghost sm danger"
                      disabled={busy}
                      onClick={() => setConfirmDel(r)}
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmDel}
        title="删除博主"
        message={`确定删除「${confirmDel?.name || ""}」吗？将同时删除其照片和包裹图，不可恢复。`}
        confirmText="删除"
        danger
        onConfirm={handleDelete}
        onCancel={() => setConfirmDel(null)}
      />
      <ConfirmDialog
        open={confirmPurge}
        title="全部清理"
        message={`确定清理全部 ${items.length} 个已移除博主吗？将同时删除他们的照片和包裹图，不可恢复。`}
        confirmText="全部清理"
        danger
        onConfirm={handlePurge}
        onCancel={() => setConfirmPurge(false)}
      />
    </div>
  );
}

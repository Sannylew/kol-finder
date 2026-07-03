import { useEffect, useRef, useState } from "react";
import {
  fetchBackups, createBackup, deleteBackup, downloadBackup,
  restoreBackup, restoreUpload, type BackupItem,
} from "../api";
import ConfirmDialog from "../components/ConfirmDialog";

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function BackupPanel() {
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [delTarget, setDelTarget] = useState("");
  const [restoreTarget, setRestoreTarget] = useState("");
  const [pendingUpload, setPendingUpload] = useState<File | null>(null);
  const restoreFileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  function load() {
    setLoading(true);
    fetchBackups().then(setBackups).catch(() => setMsg({ type: "err", text: "读取备份列表失败" })).finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  async function handleBackupNow() {
    setBackingUp(true); setMsg(null);
    try { await createBackup(); setMsg({ type: "ok", text: "备份已创建" }); load(); }
    catch (e: any) { setMsg({ type: "err", text: e?.response?.data?.detail || "备份失败" }); }
    finally { setBackingUp(false); }
  }

  async function handleDownload(name: string) {
    try { await downloadBackup(name); } catch { setMsg({ type: "err", text: "下载失败" }); }
  }

  async function handleDelete() {
    const name = delTarget; setDelTarget("");
    if (!name) return;
    try { await deleteBackup(name); setMsg({ type: "ok", text: "备份已删除" }); load(); }
    catch { setMsg({ type: "err", text: "删除失败" }); }
  }

  async function handleRestore() {
    const name = restoreTarget; setRestoreTarget("");
    if (!name) return;
    setRestoring(true); setMsg(null);
    try {
      const r = await restoreBackup(name);
      setMsg({ type: "ok", text: `已恢复（恢复前自动快照 ${r.safety_backup}）` });
      load();
    } catch (e: any) { setMsg({ type: "err", text: e?.response?.data?.detail || "恢复失败" }); }
    finally { setRestoring(false); }
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setPendingUpload(f);
    if (restoreFileRef.current) restoreFileRef.current.value = "";
  }

  async function handleRestoreUpload() {
    const f = pendingUpload; setPendingUpload(null);
    if (!f) return;
    setRestoring(true); setMsg(null);
    try {
      const r = await restoreUpload(f);
      setMsg({ type: "ok", text: `已从上传文件恢复（自动快照 ${r.safety_backup}）` });
      load();
    } catch (e: any) { setMsg({ type: "err", text: e?.response?.data?.detail || "恢复失败" }); }
    finally { setRestoring(false); }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head"><h2>数据备份</h2></div>
      {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}

      <div className="admin-card">
        <p className="hint" style={{ marginBottom: 12 }}>
          备份内容为数据库（博主数据、配置、账号）。照片文件请用服务器脚本一并备份。
        </p>
        <div className="modal-actions" style={{ justifyContent: "flex-start", marginBottom: 8 }}>
          <button className="btn-primary" onClick={handleBackupNow} disabled={backingUp || restoring}>
            {backingUp ? "备份中…" : "立即备份"}
          </button>
          <button className="btn-ghost" onClick={load}>刷新</button>
          <input ref={restoreFileRef} type="file" accept=".gz,application/gzip" style={{ display: "none" }} onChange={onPickFile} />
          <button className="btn-ghost" onClick={() => restoreFileRef.current?.click()} disabled={restoring}>上传备份恢复</button>
        </div>
        <div className="restore-warn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>
          恢复会<b>覆盖当前全部数据</b>，系统会在恢复前自动做一次快照以便回滚。
        </div>
        <div className="backup-list">
          {loading ? <p className="hint">读取中…</p>
            : backups.length === 0 ? <p className="hint">暂无备份</p>
            : backups.map((b) => (
              <div className="backup-row" key={b.name}>
                <div className="bk-info">
                  <span className="bk-name">{b.name}</span>
                  <span className="bk-meta">{b.created_at.replace("T", " ")} · {fmtSize(b.size)}</span>
                </div>
                <div className="bk-actions">
                  <button className="link-btn" onClick={() => setRestoreTarget(b.name)} disabled={restoring}>恢复</button>
                  <button className="link-btn" onClick={() => handleDownload(b.name)}>下载</button>
                  <button className="link-btn danger" onClick={() => setDelTarget(b.name)}>删除</button>
                </div>
              </div>
            ))}
        </div>
        {restoring && <p className="hint" style={{ marginTop: 10 }}>正在恢复，请勿关闭…</p>}
      </div>

      <ConfirmDialog
        open={!!delTarget}
        title="删除备份"
        message={`确定删除备份「${delTarget}」吗？`}
        confirmText="删除" danger
        onConfirm={handleDelete}
        onCancel={() => setDelTarget("")}
      />
      <ConfirmDialog
        open={!!restoreTarget}
        title="恢复数据"
        message={`确定用「${restoreTarget}」恢复吗？将覆盖当前全部数据（恢复前自动快照）。`}
        confirmText="恢复" danger
        onConfirm={handleRestore}
        onCancel={() => setRestoreTarget("")}
      />
      <ConfirmDialog
        open={!!pendingUpload}
        title="上传恢复"
        message={`确定用上传文件「${pendingUpload?.name || ""}」恢复吗？将覆盖当前全部数据（恢复前自动快照）。`}
        confirmText="恢复" danger
        onConfirm={handleRestoreUpload}
        onCancel={() => setPendingUpload(null)}
      />
    </div>
  );
}

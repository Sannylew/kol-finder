import { useEffect, useState } from "react";
import {
  fetchKols, setKolPriority, pinKol, unpinKol, deleteKol,
} from "../api";
import type { Kol } from "../types";
import ConfirmDialog from "../components/ConfirmDialog";

const PAGE_SIZE = 20;

export default function KolAdmin() {
  const [keyword, setKeyword] = useState("");
  const [debKeyword, setDebKeyword] = useState("");
  const [items, setItems] = useState<Kol[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busyUid, setBusyUid] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [confirmDel, setConfirmDel] = useState<Kol | null>(null);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebKeyword(keyword), 350);
    return () => clearTimeout(t);
  }, [keyword]);

  useEffect(() => { setPage(1); }, [debKeyword]);

  function load() {
    setLoading(true);
    fetchKols({ keyword: debKeyword, page, page_size: PAGE_SIZE, sort_by: "priority" })
      .then((res) => {
        setItems(res.items); setTotal(res.total); setPages(res.pages);
        const d: Record<string, string> = {};
        res.items.forEach((k) => { d[k.uid] = k.priority == null ? "" : String(k.priority); });
        setDrafts(d);
      })
      .catch(() => setMsg({ type: "err", text: "加载失败" }))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [debKeyword, page]);

  async function savePriority(k: Kol) {
    const raw = (drafts[k.uid] ?? "").trim();
    let value: number | null;
    if (raw === "") value = null;
    else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) { setMsg({ type: "err", text: "优先级须为非负整数" }); return; }
      value = n;
    }
    setBusyUid(k.uid); setMsg(null);
    try {
      await setKolPriority(k.uid, value);
      setMsg({ type: "ok", text: `已更新「${k.name || k.uid}」优先级` });
      load();
    } catch (e: any) { setMsg({ type: "err", text: e?.response?.data?.detail || "保存失败" }); }
    finally { setBusyUid(""); }
  }

  async function doPin(k: Kol) {
    setBusyUid(k.uid); setMsg(null);
    try { await pinKol(k.uid); setMsg({ type: "ok", text: `已置顶「${k.name || k.uid}」` }); load(); }
    catch (e: any) { setMsg({ type: "err", text: e?.response?.data?.detail || "置顶失败" }); }
    finally { setBusyUid(""); }
  }

  async function doUnpin(k: Kol) {
    setBusyUid(k.uid); setMsg(null);
    try { await unpinKol(k.uid); setMsg({ type: "ok", text: `已取消置顶` }); load(); }
    catch (e: any) { setMsg({ type: "err", text: e?.response?.data?.detail || "操作失败" }); }
    finally { setBusyUid(""); }
  }

  async function handleDelete() {
    const target = confirmDel; setConfirmDel(null);
    if (!target) return;
    setBusyUid(target.uid); setMsg(null);
    try { await deleteKol(target.uid); setMsg({ type: "ok", text: `已删除「${target.name || ""}」` }); load(); }
    catch (e: any) { setMsg({ type: "err", text: e?.response?.data?.detail || "删除失败" }); }
    finally { setBusyUid(""); }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <h2>博主列表</h2>
        <span className="hint">共 {total} 位</span>
      </div>
      {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}

      <div className="admin-card">
        <div className="admin-search">
          <input placeholder="搜索姓名 / 电话 / 公司 / 备注…" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        </div>

        {loading ? <p className="hint">读取中…</p>
          : items.length === 0 ? <p className="hint">没有找到博主</p>
          : (
            <table className="admin-table kol-table">
              <thead>
                <tr>
                  <th>姓名</th><th>电话</th><th>公司</th><th>合同</th>
                  <th>照片</th><th>优先级</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((k) => (
                  <tr key={k.uid} className={busyUid === k.uid ? "busy" : ""}>
                    <td>{k.name || "—"}</td>
                    <td className="mono">{k.phone || "—"}</td>
                    <td>{k.company || "—"}</td>
                    <td>{k.has_contract ? "已签" : "未签"}</td>
                    <td>{k.photo_url ? "有" : "—"}</td>
                    <td>
                      <input
                        className="prio-input"
                        value={drafts[k.uid] ?? ""}
                        placeholder="—"
                        onChange={(e) => setDrafts((p) => ({ ...p, [k.uid]: e.target.value }))}
                        onKeyDown={(e) => e.key === "Enter" && savePriority(k)}
                      />
                    </td>
                    <td className="kol-actions">
                      <button className="link-btn" disabled={busyUid === k.uid} onClick={() => savePriority(k)}>保存</button>
                      <button className="link-btn" disabled={busyUid === k.uid} onClick={() => doPin(k)}>置顶</button>
                      {k.priority != null && (
                        <button className="link-btn" disabled={busyUid === k.uid} onClick={() => doUnpin(k)}>取消置顶</button>
                      )}
                      <button className="link-btn danger" disabled={busyUid === k.uid} onClick={() => setConfirmDel(k)}>删除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

        {pages > 1 && (
          <div className="pager" style={{ marginTop: 16 }}>
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
            <span className="gap">{page} / {pages}</span>
            <button disabled={page >= pages} onClick={() => setPage(page + 1)}>›</button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmDel}
        title="删除博主"
        message={`确定删除「${confirmDel?.name || ""}」吗？将同时删除其照片和包裹图，不可恢复。`}
        confirmText="删除" danger
        onConfirm={handleDelete}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  );
}

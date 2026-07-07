import { useEffect, useState } from "react";
import { applyKolPriorities, deleteKol, fetchKols } from "../api";
import type { Kol } from "../types";
import ConfirmDialog from "../components/ConfirmDialog";

const SORT_PAGE_SIZE = 1000;

function moveItem(list: Kol[], fromUid: string, toUid: string): Kol[] {
  const from = list.findIndex((item) => item.uid === fromUid);
  const to = list.findIndex((item) => item.uid === toUid);
  if (from < 0 || to < 0 || from === to) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function swapItem(list: Kol[], uid: string, delta: number): Kol[] {
  const from = list.findIndex((item) => item.uid === uid);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= list.length) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export default function KolAdmin() {
  const [keyword, setKeyword] = useState("");
  const [debKeyword, setDebKeyword] = useState("");
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<Kol[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [dragUid, setDragUid] = useState("");
  const [dragOverUid, setDragOverUid] = useState("");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [priorityDrafts, setPriorityDrafts] = useState<Record<string, string>>({});
  const [confirmDel, setConfirmDel] = useState<Kol | null>(null);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  function makeOrderDrafts(list: Kol[], skip = excluded) {
    const drafts: Record<string, string> = {};
    let order = 1;
    list.forEach((item) => {
      drafts[item.uid] = skip.has(item.uid) ? "" : String(order);
      if (!skip.has(item.uid)) order += 1;
    });
    setPriorityDrafts(drafts);
  }

  function orderLocked() {
    return debKeyword.trim() !== "" || total > SORT_PAGE_SIZE;
  }

  function showOrderLockedMessage() {
    setMsg({
      type: "err",
      text: debKeyword.trim()
        ? "搜索结果不能直接保存全局排序，请清空搜索后调整"
        : `当前只加载前 ${SORT_PAGE_SIZE} 位，不能保存全局排序`,
    });
  }

  useEffect(() => {
    const t = setTimeout(() => setDebKeyword(keyword), 350);
    return () => clearTimeout(t);
  }, [keyword]);

  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debKeyword]);

  function loadList() {
    setLoading(true);
    fetchKols({ keyword: debKeyword, page: 1, page_size: SORT_PAGE_SIZE, sort_by: "priority" })
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
        setExcluded(new Set());
        const drafts: Record<string, string> = {};
        res.items.forEach((item) => {
          drafts[item.uid] = item.priority == null ? "" : String(item.priority);
        });
        setPriorityDrafts(drafts);
        setDirty(false);
      })
      .catch(() => setMsg({ type: "err", text: "博主列表加载失败" }))
      .finally(() => setLoading(false));
  }

  function activate(uid: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      next.delete(uid);
      return next;
    });
  }

  function move(uid: string, delta: number) {
    if (orderLocked()) { showOrderLockedMessage(); return; }
    const nextExcluded = new Set(excluded);
    nextExcluded.delete(uid);
    activate(uid);
    setItems((prev) => {
      const next = swapItem(prev, uid, delta);
      makeOrderDrafts(next, nextExcluded);
      return next;
    });
    setDirty(true);
  }

  function pin(uid: string) {
    if (orderLocked()) { showOrderLockedMessage(); return; }
    const nextExcluded = new Set(excluded);
    nextExcluded.delete(uid);
    activate(uid);
    setItems((prev) => {
      const item = prev.find((k) => k.uid === uid);
      if (!item) return prev;
      const next = [item, ...prev.filter((k) => k.uid !== uid)];
      makeOrderDrafts(next, nextExcluded);
      return next;
    });
    setDirty(true);
  }

  function clearPriority(uid: string) {
    if (orderLocked()) { showOrderLockedMessage(); return; }
    const nextExcluded = new Set(excluded);
    nextExcluded.add(uid);
    setExcluded((prev) => {
      const next = new Set(prev);
      next.add(uid);
      return next;
    });
    setItems((prev) => {
      const item = prev.find((k) => k.uid === uid);
      if (!item) return prev;
      const next = [...prev.filter((k) => k.uid !== uid), item];
      makeOrderDrafts(next, nextExcluded);
      return next;
    });
    setDirty(true);
  }

  function dropItem(uid: string) {
    if (orderLocked()) { showOrderLockedMessage(); return; }
    if (!dragUid) return;
    const nextExcluded = new Set(excluded);
    nextExcluded.delete(dragUid);
    activate(dragUid);
    setItems((prev) => {
      const next = moveItem(prev, dragUid, uid);
      makeOrderDrafts(next, nextExcluded);
      return next;
    });
    setDirty(true);
    setDragUid("");
    setDragOverUid("");
  }

  function updatePriority(uid: string, value: string) {
    if (orderLocked()) { showOrderLockedMessage(); return; }
    const clean = value.replace(/[^\d]/g, "");
    setPriorityDrafts((prev) => ({ ...prev, [uid]: clean }));
    setExcluded((prev) => {
      const next = new Set(prev);
      if (clean === "") next.add(uid);
      else next.delete(uid);
      return next;
    });
    setDirty(true);
  }

  async function saveOrder() {
    if (orderLocked()) {
      showOrderLockedMessage();
      return;
    }
    const ordered = items
      .map((item) => {
        const raw = (priorityDrafts[item.uid] ?? "").trim();
        return {
          uid: item.uid,
          priority: raw === "" ? null : Number(raw),
        };
      });
    const invalid = ordered.some((item) => (
      item.priority !== null && (!Number.isInteger(item.priority) || item.priority < 0)
    ));
    if (invalid) {
      setMsg({ type: "err", text: "优先级必须是非负整数，数字越小越靠前" });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await applyKolPriorities(ordered);
      setMsg({ type: "ok", text: `排序已保存，共更新 ${res.updated} 位博主` });
      setDirty(false);
      loadList();
    } catch (e: any) {
      setMsg({ type: "err", text: e?.response?.data?.detail || "保存排序失败" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    const target = confirmDel;
    setConfirmDel(null);
    if (!target) return;
    setSaving(true);
    setMsg(null);
    try {
      await deleteKol(target.uid);
      setMsg({ type: "ok", text: `已删除「${target.name || ""}」` });
      loadList();
    } catch (e: any) {
      setMsg({ type: "err", text: e?.response?.data?.detail || "删除失败" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head kol-admin-head">
        <div>
          <h2>博主列表</h2>
          <span className="hint">共 {total} 位，优先级数字越小越靠前，也可以拖动调整</span>
        </div>
        <div className="kol-head-actions">
          <button className="btn-ghost sm" onClick={loadList} disabled={loading || saving}>
            重新加载
          </button>
          <button className="btn-primary sm" onClick={saveOrder} disabled={!dirty || saving || orderLocked()}>
            {saving ? "保存中..." : "保存排序"}
          </button>
        </div>
      </div>
      {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}

      <div className="admin-card">
        <div className="admin-search kol-admin-search">
          <input
            placeholder="搜索姓名 / 电话 / 公司 / 备注..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>

        <div className="sort-panel always-sort-panel">
          <div className="sort-panel-head">
            <div>
              <strong>拖动调整展示顺序</strong>
              <span>保留优先级规则：数字越小越靠前。拖动会自动改写优先级，清空后回到默认顺序。</span>
            </div>
            {dirty && <span className="sort-dirty">有未保存调整</span>}
          </div>

          {loading ? (
            <p className="hint">读取博主列表中...</p>
          ) : items.length === 0 ? (
            <p className="hint">没有可排序的博主</p>
          ) : (
            <div className="sort-list">
              {items.map((k, i) => {
                const isExcluded = excluded.has(k.uid) || (priorityDrafts[k.uid] ?? "") === "";
                return (
                  <div
                    key={k.uid}
                    className={`sort-row ${dragUid === k.uid ? "dragging" : ""} ${dragOverUid === k.uid ? "drag-over" : ""} ${isExcluded ? "excluded" : ""}`}
                    draggable={!orderLocked()}
                    onDragStart={(e) => {
                      setDragUid(k.uid);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", k.uid);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverUid(k.uid);
                    }}
                    onDragLeave={() => setDragOverUid((uid) => (uid === k.uid ? "" : uid))}
                    onDrop={(e) => {
                      e.preventDefault();
                      dropItem(k.uid);
                    }}
                    onDragEnd={() => {
                      setDragUid("");
                      setDragOverUid("");
                    }}
                  >
                    <div className="sort-handle" title="拖动排序" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </div>
                    <label className="sort-priority" title="优先级，数字越小越靠前">
                      <span>优先级</span>
                      <input
                        value={priorityDrafts[k.uid] ?? ""}
                        placeholder="未排序"
                        inputMode="numeric"
                        onChange={(e) => updatePriority(k.uid, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        disabled={orderLocked() || saving}
                      />
                    </label>
                    <div className="sort-avatar">
                      {k.photo_url ? (
                        <img src={k.photo_thumb_url || k.photo_url} alt="" loading="lazy" decoding="async" />
                      ) : (
                        <span>{(k.name || "?").slice(0, 1)}</span>
                      )}
                    </div>
                    <div className="sort-main">
                      <div className="sort-name">{k.name || "未命名"}</div>
                      <div className="sort-meta">
                        <span>{k.company || "无公司"}</span>
                        <span>{k.phone || "无电话"}</span>
                      </div>
                    </div>
                    <span className={`sort-contract ${k.has_contract ? "signed" : ""}`}>
                      {k.has_contract ? "已签合同" : "未签合同"}
                    </span>
                    <div className="sort-actions">
                      <button className="link-btn" disabled={i === 0 || saving || orderLocked()} onClick={() => move(k.uid, -1)}>上移</button>
                      <button className="link-btn" disabled={i === items.length - 1 || saving || orderLocked()} onClick={() => move(k.uid, 1)}>下移</button>
                      <button className="link-btn" disabled={saving || orderLocked()} onClick={() => pin(k.uid)}>置顶</button>
                      <button className="link-btn" disabled={saving || isExcluded || orderLocked()} onClick={() => clearPriority(k.uid)}>清空</button>
                      <button className="link-btn danger" disabled={saving} onClick={() => setConfirmDel(k)}>删除</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {total > SORT_PAGE_SIZE && (
            <p className="hint sort-limit">当前最多载入前 {SORT_PAGE_SIZE} 位用于排序，请先用搜索缩小范围。</p>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmDel}
        title="删除博主"
        message={`确定删除「${confirmDel?.name || ""}」吗？将同时删除其照片和已拍衣服，不可恢复。`}
        confirmText="删除"
        danger
        onConfirm={handleDelete}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  );
}

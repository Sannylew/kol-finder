import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchStats, fetchSyncStatus, fetchRemovedCount, triggerSync,
  type Stats,
} from "../api";
import type { SyncStatus } from "../types";

export default function Dashboard() {
  const nav = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [removed, setRemoved] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  function refresh() {
    fetchStats().then(setStats).catch(() => {});
    fetchSyncStatus().then(setSync).catch(() => {});
    fetchRemovedCount().then(setRemoved).catch(() => {});
  }

  useEffect(() => { refresh(); }, []);

  async function handleSync() {
    setSyncing(true);
    setMsg(null);
    try {
      await triggerSync();
      setMsg({ type: "ok", text: "同步完成" });
      refresh();
    } catch (e: any) {
      setMsg({ type: "err", text: e?.response?.data?.detail || "同步失败" });
    } finally {
      setSyncing(false);
    }
  }

  const cards = [
    { label: "博主总数", value: stats?.total ?? 0 },
    { label: "今日新增", value: `+${stats?.today_new ?? 0}` },
    { label: "本周新增", value: `+${stats?.week_new ?? 0}` },
    { label: "已签合同", value: stats?.contracted ?? 0 },
    { label: "未签合同", value: stats?.uncontracted ?? 0 },
    { label: "已配照片", value: stats?.with_photo ?? 0 },
  ];

  const lastSync = sync?.last_sync
    ? new Date(sync.last_sync.synced_at).toLocaleString("zh-CN")
    : "尚未同步";

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <h2>仪表盘</h2>
        <button className="btn-primary" disabled={syncing} onClick={handleSync}>
          {syncing ? "同步中…" : "立即同步"}
        </button>
      </div>

      {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}

      <div className="admin-stat-grid">
        {cards.map((c) => (
          <div className="admin-stat-card" key={c.label}>
            <div className="admin-stat-num">{c.value}</div>
            <div className="admin-stat-label">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="admin-info-row">
        <div className="admin-info-card">
          <div className="admin-info-title">最近同步</div>
          <div className="admin-info-value">{lastSync}</div>
          {sync?.last_sync && (
            <div className="admin-info-sub">
              新增 {sync.last_sync.inserted} · 更新 {sync.last_sync.updated} · 共 {sync.last_sync.total}
            </div>
          )}
        </div>
        <div className="admin-info-card">
          <div className="admin-info-title">待清理（文档已移除）</div>
          <div className="admin-info-value">{removed}</div>
          {removed > 0 && (
            <button className="btn-ghost sm" onClick={() => nav("/admin/removed")}>去清理</button>
          )}
        </div>
      </div>
    </div>
  );
}

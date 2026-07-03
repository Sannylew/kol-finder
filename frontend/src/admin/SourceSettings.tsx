import { useEffect, useState } from "react";
import { fetchSettings, saveSettings, testConnection } from "../api";

export default function SourceSettings() {
  const [webhook, setWebhook] = useState("");
  const [token, setToken] = useState("");
  const [tokenSet, setTokenSet] = useState(false);
  const [interval, setInterval] = useState("300");
  const [autoSync, setAutoSync] = useState(true);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    fetchSettings()
      .then((s: any) => {
        setWebhook(s.kdocs_webhook_url || "");
        setTokenSet(!!s.kdocs_token_set);
        setInterval(s.sync_interval_seconds || "300");
        setAutoSync(s.auto_sync_enabled === "1" || s.auto_sync_enabled === 1 || s.auto_sync_enabled === true);
      })
      .catch(() => setMsg({ type: "err", text: "读取配置失败" }))
      .finally(() => setLoading(false));
  }, []);

  async function handleTest() {
    setTesting(true); setMsg(null);
    try {
      const r = await testConnection({ kdocs_webhook_url: webhook, kdocs_token: token || undefined });
      setMsg({ type: "ok", text: `连接成功，读取到 ${r.total} 条数据` });
    } catch (e: any) {
      setMsg({ type: "err", text: e?.response?.data?.detail || "连接失败" });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true); setMsg(null);
    try {
      await saveSettings({
        kdocs_webhook_url: webhook,
        kdocs_token: token || undefined,
        sync_interval_seconds: interval,
        auto_sync_enabled: autoSync ? "1" : "0",
      } as any);
      setToken("");
      setMsg({ type: "ok", text: "已保存，配置立即生效" });
    } catch (e: any) {
      setMsg({ type: "err", text: e?.response?.data?.detail || "保存失败" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="admin-page"><p className="hint">读取中…</p></div>;

  return (
    <div className="admin-page">
      <div className="admin-page-head"><h2>数据源设置</h2></div>
      {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}

      <div className="admin-card">
        <div className="readonly-note">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
          </svg>
          <span>系统仅<b>只读</b>同步文档数据，<b>不会修改</b>你的在线文档。</span>
        </div>

        <div className="field">
          <label>金山 Webhook 链接</label>
          <input value={webhook} onChange={(e) => setWebhook(e.target.value)}
            placeholder="https://365.kdocs.cn/api/v3/ide/file/.../sync_task" />
          <p className="hint">决定从哪个在线文档同步数据。更换文档时填这里。</p>
        </div>

        <div className="field">
          <label>脚本令牌 Token</label>
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)}
            placeholder={tokenSet ? "已配置，留空则不修改" : "请输入 Token"} />
          <p className="hint">访问该文档的密钥。留空表示沿用已保存的，不改动。</p>
        </div>

        <div className="field toggle-field">
          <div>
            <label>自动同步</label>
            <p className="hint">开启后按下方间隔自动拉取；关闭则只能手动同步。</p>
          </div>
          <button className={`switch ${autoSync ? "on" : ""}`} onClick={() => setAutoSync(!autoSync)} aria-label="自动同步开关">
            <span className="knob" />
          </button>
        </div>

        <div className="field">
          <label>自动同步间隔</label>
          <div className="select-wrap" style={{ display: "block" }}>
            <select value={interval} onChange={(e) => setInterval(e.target.value)} disabled={!autoSync} style={{ width: "100%" }}>
              <option value="60">每 1 分钟</option>
              <option value="300">每 5 分钟（默认）</option>
              <option value="600">每 10 分钟</option>
              <option value="1800">每 30 分钟</option>
              <option value="3600">每 1 小时</option>
              <option value="21600">每 6 小时</option>
              <option value="43200">每 12 小时</option>
              <option value="86400">每 24 小时</option>
            </select>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn-ghost" onClick={handleTest} disabled={testing}>
            {testing ? "测试中…" : "测试连接"}
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

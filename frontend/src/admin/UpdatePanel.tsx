import { useEffect, useMemo, useState } from "react";
import {
  fetchUpdateStatus,
  startVersionUpdate,
  type UpdateStatus,
} from "../api";
import ConfirmDialog from "../components/ConfirmDialog";

function versionText(value?: string | null) {
  return value ? `v${value.replace(/^v/, "")}` : "未获取";
}

export default function UpdatePanel() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function load(silent = false) {
    if (!silent) {
      setLoading(true);
      setMsg(null);
    }
    try {
      const data = await fetchUpdateStatus();
      setStatus(data);
    } catch (e: any) {
      setMsg({ type: "err", text: e?.response?.data?.detail || "检查版本更新失败" });
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!status?.running) return;
    const timer = window.setInterval(() => load(true), 10000);
    return () => window.clearInterval(timer);
  }, [status?.running]);

  const canUpdate = useMemo(() => {
    return Boolean(status?.supported && status?.update_available && !status?.running);
  }, [status]);

  async function handleStart() {
    setConfirmOpen(false);
    setStarting(true);
    setMsg(null);
    try {
      const result = await startVersionUpdate("latest");
      setMsg({ type: "ok", text: result.message || "更新任务已启动" });
      await load(true);
    } catch (e: any) {
      setMsg({ type: "err", text: e?.response?.data?.detail || "启动更新失败" });
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h2>版本更新</h2>
          <p className="hint">从 GitHub Release 拉取正式版本，自动备份、更新依赖、重启后端并重建前端。</p>
        </div>
        <button className="btn-ghost" onClick={() => load()} disabled={loading || starting}>
          {loading ? "检查中..." : "检查更新"}
        </button>
      </div>

      {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}

      <div className="admin-card update-card">
        <div className="update-status-head">
          <div>
            <div className="admin-info-title">更新状态</div>
            <div className={`update-state ${status?.update_available ? "available" : ""} ${status?.running ? "running" : ""}`}>
              {loading ? "正在检查" : status?.running ? "更新任务运行中" : status?.update_available ? "发现新版本" : "无需更新"}
            </div>
          </div>
          <button className="btn-primary" onClick={() => setConfirmOpen(true)} disabled={!canUpdate || starting}>
            {starting ? "启动中..." : "更新到最新版本"}
          </button>
        </div>

        <div className="update-grid">
          <div className="update-item">
            <span>当前版本</span>
            <strong>{versionText(status?.current_version)}</strong>
          </div>
          <div className="update-item">
            <span>最新版本</span>
            <strong>{versionText(status?.latest_version || status?.latest_tag)}</strong>
          </div>
          <div className="update-item">
            <span>任务单元</span>
            <strong>{status?.unit || "-"}</strong>
          </div>
          <div className="update-item">
            <span>执行环境</span>
            <strong>{status?.supported ? "支持后台更新" : "不支持后台更新"}</strong>
          </div>
        </div>

        <div className={`update-note ${status?.supported ? "" : "warn"}`}>
          {status?.reason || "正在读取版本信息..."}
        </div>

        <div className="update-checklist">
          <div>更新前会自动执行服务器备份脚本。</div>
          <div>更新过程中后端会重启，后台页面可能短暂断开。</div>
          <div>只会执行项目内固定脚本，不支持输入自定义命令。</div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="确认更新版本"
        message={`确定更新到 ${versionText(status?.latest_version || status?.latest_tag)} 吗？更新会自动备份并重启服务，期间后台可能短暂不可用。`}
        confirmText="开始更新"
        onConfirm={handleStart}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

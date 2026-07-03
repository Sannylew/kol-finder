import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { changePassword, clearToken } from "../api";

export default function ChangePassword() {
  const nav = useNavigate();
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function handleSave() {
    if (!oldPwd || !newPwd) {
      setMsg({ type: "err", text: "请填写原密码和新密码" });
      return;
    }
    setSaving(true); setMsg(null);
    try {
      await changePassword(oldPwd, newPwd);
      clearToken();
      setMsg({ type: "ok", text: "密码已修改，请用新密码重新登录" });
      setTimeout(() => nav("/admin/login", { replace: true }), 1200);
    } catch (e: any) {
      setMsg({ type: "err", text: e?.response?.data?.detail || "修改失败" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head"><h2>修改密码</h2></div>
      {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}

      <div className="admin-card">
        <div className="field">
          <label>原密码</label>
          <input type="password" value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} />
        </div>
        <div className="field">
          <label>新密码</label>
          <input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()} />
          <p className="hint">修改后旧登录立即失效，需用新密码重新登录。</p>
        </div>
        <div className="modal-actions">
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "提交中…" : "修改密码"}
          </button>
        </div>
      </div>
    </div>
  );
}

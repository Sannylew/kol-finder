import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login, changePassword, setToken, clearToken, getToken } from "../api";

/** 后台登录页。首次默认密码登录后强制改密。 */
export default function AdminLogin() {
  const nav = useNavigate();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // 强制改密
  const [mustChange, setMustChange] = useState(false);
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");

  async function handleLogin() {
    setLoggingIn(true);
    setMsg(null);
    try {
      const r = await login(username, password);
      setToken(r.token);
      setPassword("");
      if (r.must_change_password) {
        setMustChange(true);
        setOldPwd("");
        setMsg({ type: "err", text: "当前为默认密码，请立即修改后再使用" });
      } else {
        nav("/admin", { replace: true });
      }
    } catch (e: any) {
      setMsg({ type: "err", text: e?.response?.data?.detail || "登录失败" });
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleChangePwd() {
    setMsg(null);
    try {
      await changePassword(oldPwd, newPwd);
      clearToken();
      setMustChange(false);
      setOldPwd(""); setNewPwd("");
      setMsg({ type: "ok", text: "密码已修改，请用新密码重新登录" });
    } catch (e: any) {
      setMsg({ type: "err", text: e?.response?.data?.detail || "修改失败" });
    }
  }

  return (
    <div className="admin-auth">
      <div className="admin-auth-card">
        <div className="admin-auth-brand">KOL <em>Finder</em> · 后台</div>

        {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}

        {mustChange ? (
          <>
            <div className="field">
              <label>原密码（默认 admin123）</label>
              <input type="password" value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} />
            </div>
            <div className="field">
              <label>新密码</label>
              <input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleChangePwd()} />
            </div>
            <button className="btn-primary" style={{ width: "100%" }} onClick={handleChangePwd}>
              修改密码
            </button>
          </>
        ) : (
          <>
            <div className="field">
              <label>用户名</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="field">
              <label>密码</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()} />
            </div>
            <button className="btn-primary" style={{ width: "100%" }} disabled={loggingIn} onClick={handleLogin}>
              {loggingIn ? "登录中…" : "登录"}
            </button>
            <div className="admin-auth-back">
              <a href="/">← 返回前台</a>
            </div>
          </>
        )}
        {getToken() && !mustChange && (
          <div className="admin-auth-back">
            <a href="/admin">已登录，进入后台 →</a>
          </div>
        )}
      </div>
    </div>
  );
}

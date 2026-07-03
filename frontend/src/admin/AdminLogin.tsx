import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login, setToken, getToken } from "../api";

/** 后台登录页。默认密码可正常登录（不强制改密，仅在后台温和提示）。 */
export default function AdminLogin() {
  const nav = useNavigate();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function handleLogin() {
    setLoggingIn(true);
    setMsg(null);
    try {
      const r = await login(username, password);
      setToken(r.token);
      setPassword("");
      // 记录是否仍为默认密码，供后台温和提示（不强制）
      localStorage.setItem("kol_default_pwd", r.must_change_password ? "1" : "0");
      nav("/admin", { replace: true });
    } catch (e: any) {
      setMsg({ type: "err", text: e?.response?.data?.detail || "登录失败" });
    } finally {
      setLoggingIn(false);
    }
  }

  return (
    <div className="admin-auth">
      <div className="admin-auth-card">
        <div className="admin-auth-brand">KOL <em>Finder</em> · 后台</div>

        {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}

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
        {getToken() && (
          <div className="admin-auth-back">
            <a href="/admin">已登录，进入后台 →</a>
          </div>
        )}
      </div>
    </div>
  );
}

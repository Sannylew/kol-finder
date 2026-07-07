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
      <div className="admin-auth-shell">
        <section className="admin-auth-intro" aria-label="后台说明">
          <a className="admin-auth-home" href="/">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            返回前台
          </a>
          <div className="admin-auth-brand">KOL <em>Finder</em></div>
          <h1>后台控制台</h1>
          <p>管理数据源、同步记录、照片资料和系统设置。</p>
          <div className="admin-auth-status">
            <span />
            需要管理员身份
          </div>
        </section>

        <section className="admin-auth-card" aria-label="管理员登录">
          <div className="admin-auth-card-head">
            <h2>登录</h2>
          </div>

          {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}

          <form
            className="admin-auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!loggingIn) handleLogin();
            }}
          >
            <div className="field">
              <label htmlFor="admin-username">用户名</label>
              <input
                id="admin-username"
                value={username}
                autoComplete="username"
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="admin-password">密码</label>
              <input
                id="admin-password"
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button className="btn-primary admin-auth-submit" disabled={loggingIn} type="submit">
              {loggingIn ? "登录中…" : "登录后台"}
            </button>
          </form>

          <div className="admin-auth-links">
            <a href="/">返回前台</a>
            {getToken() && <a href="/admin">已登录，进入后台</a>}
          </div>
        </section>
      </div>
    </div>
  );
}

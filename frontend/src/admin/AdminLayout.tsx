import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { clearToken } from "../api";

const MENU: { group: string; items: { to: string; label: string; end?: boolean }[] }[] = [
  { group: "概览", items: [{ to: "/admin", label: "仪表盘", end: true }] },
  {
    group: "博主管理",
    items: [
      { to: "/admin/kols", label: "博主列表" },
      { to: "/admin/removed", label: "已移除博主" },
    ],
  },
  {
    group: "数据同步",
    items: [
      { to: "/admin/source", label: "数据源设置" },
      { to: "/admin/sync-logs", label: "同步记录" },
    ],
  },
  {
    group: "系统",
    items: [
      { to: "/admin/appearance", label: "外观设置" },
      { to: "/admin/logs", label: "系统日志" },
      { to: "/admin/backups", label: "数据备份" },
      { to: "/admin/password", label: "修改密码" },
    ],
  },
];

export default function AdminLayout() {
  const nav = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  function logout() {
    clearToken();
    nav("/admin/login", { replace: true });
  }

  return (
    <div className="admin-shell">
      <aside className={`admin-side ${menuOpen ? "open" : ""}`}>
        <div className="admin-logo">KOL <em>Finder</em></div>
        <nav className="admin-menu">
          {MENU.map((g) => (
            <div className="admin-menu-group" key={g.group}>
              <div className="admin-menu-title">{g.group}</div>
              {g.items.map((it) => (
                <NavLink
                  key={it.to}
                  to={it.to}
                  end={it.end}
                  className={({ isActive }) => `admin-menu-item ${isActive ? "active" : ""}`}
                  onClick={() => setMenuOpen(false)}
                >
                  {it.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      {menuOpen && <div className="admin-side-scrim" onClick={() => setMenuOpen(false)} />}

      <div className="admin-main">
        <header className="admin-topbar">
          <button className="admin-hamburger" onClick={() => setMenuOpen(true)} aria-label="菜单">☰</button>
          <div className="admin-topbar-spacer" />
          <a className="admin-top-link" href="/">返回前台</a>
          <button className="admin-top-link danger" onClick={logout}>退出登录</button>
        </header>
        <main className="admin-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

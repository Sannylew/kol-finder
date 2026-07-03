import { useEffect, useMemo, useState } from "react";
import type { Kol, FilterOptions, SyncStatus } from "./types";
import {
  fetchKols, fetchFilterOptions, fetchSyncStatus, triggerSync, fetchPublicConfig, getToken, clearToken,
  fetchStats, type Stats, fetchVersion,
} from "./api";
import KolCard from "./components/KolCard";
import KolDrawer from "./components/KolDrawer";
import SettingsDialog from "./components/SettingsDialog";
import ConfirmDialog from "./components/ConfirmDialog";

const PAGE_SIZE = 20;

function useDebounced<T>(value: T, delay = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export default function App() {
  const [keyword, setKeyword] = useState("");
  const debKeyword = useDebounced(keyword);
  const [contract, setContract] = useState<"" | "yes" | "no">("");
  const [size, setSize] = useState("");
  const [period, setPeriod] = useState("");
  const [company, setCompany] = useState("");
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<Kol[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [options, setOptions] = useState<FilterOptions>({ sizes: [], coop_periods: [], companies: [] });
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [selected, setSelected] = useState<Kol | null>(null);
  const [toast, setToast] = useState<{ text: string; type: "" | "ok" | "err" }>({ text: "", type: "" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [masked, setMasked] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [isAdmin, setIsAdmin] = useState(!!getToken());
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [version, setVersion] = useState("");

  function refreshStats() {
    fetchStats().then(setStats).catch(() => {});
  }

  function refreshOptions() {
    fetchFilterOptions().then(setOptions).catch(() => {});
  }

  function refreshPublicConfig() {
    fetchPublicConfig()
      .then((c) => setMasked(!!c.mask_enabled))
      .catch(() => {})
      .finally(() => setConfigLoaded(true));
  }

  function showToast(text: string, type: "" | "ok" | "err" = "") {
    setToast({ text, type });
    setTimeout(() => setToast({ text: "", type: "" }), 1800);
  }

  function handleLogout() {
    setConfirmLogout(false);
    clearToken();
    setIsAdmin(false);
    refreshPublicConfig();
    reloadList();
    refreshStats();
    refreshOptions();
    showToast("已退出登录", "ok");
  }

  function reloadList() {
    fetchKols({
      keyword: debKeyword,
      has_contract: contract === "" ? undefined : contract === "yes",
      size, coop_period: period, company, page, page_size: PAGE_SIZE,
    }).then((res) => { setItems(res.items); setTotal(res.total); setPages(res.pages); }).catch(() => {});
  }

  // 初始化筛选项 + 同步状态
  useEffect(() => {
    fetchFilterOptions().then(setOptions).catch(() => {});
    fetchSyncStatus().then(setSync).catch(() => {});
    refreshPublicConfig();
    refreshStats();
    fetchVersion().then(setVersion).catch(() => {});
  }, []);

  // 筛选变化时回到第一页
  useEffect(() => { setPage(1); }, [debKeyword, contract, size, period, company]);

  // 加载列表
  useEffect(() => {
    setLoading(true);
    setError("");
    fetchKols({
      keyword: debKeyword,
      has_contract: contract === "" ? undefined : contract === "yes",
      size,
      coop_period: period,
      company,
      page,
      page_size: PAGE_SIZE,
    })
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
        setPages(res.pages);
      })
      .catch((e) => setError(e?.message || "加载失败，请确认后端已启动"))
      .finally(() => setLoading(false));
  }, [debKeyword, contract, size, period, company, page]);

  async function handleSync() {
    setSyncing(true);
    try {
      await triggerSync();
      const s = await fetchSyncStatus();
      setSync(s);
      // 重新加载当前页
      const res = await fetchKols({
        keyword: debKeyword,
        has_contract: contract === "" ? undefined : contract === "yes",
        size, coop_period: period, company, page, page_size: PAGE_SIZE,
      });
      setItems(res.items); setTotal(res.total); setPages(res.pages);
      fetchFilterOptions().then(setOptions).catch(() => {});
      refreshStats();
    } catch (e: any) {
      if (e?.response?.status === 401) {
        showToast("请先登录后台再同步", "err");
        setSettingsOpen(true);
      } else {
        showToast("同步失败：" + (e?.response?.data?.detail || e.message), "err");
      }
    } finally {
      setSyncing(false);
    }
  }

  function handlePhotoChange(uid: string, photoUrl: string | null) {
    setItems((prev) => prev.map((k) => (k.uid === uid ? { ...k, photo_url: photoUrl } : k)));
    setSelected((prev) => (prev && prev.uid === uid ? { ...prev, photo_url: photoUrl } : prev));
  }

  const lastSyncText = useMemo(() => {
    if (!sync?.last_sync) return "尚未同步";
    const t = new Date(sync.last_sync.synced_at);
    return `上次同步 ${t.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
  }, [sync]);

  const pageButtons = useMemo(() => buildPages(page, pages), [page, pages]);
  const effectiveMask = masked && !isAdmin;

  return (
    <>
      <header>
        <div className="brand">
          <span className="mark">KOL <em>Finder</em></span>
          <span className="sub">Blogger Atelier</span>
        </div>
        <div className="sync">
          <span className="status">
            <span className={`dot ${syncing ? "syncing" : ""}`} />
            {syncing ? "同步中…" : lastSyncText}
          </span>
          <button className="btn-sync" onClick={handleSync} disabled={syncing}>
            <svg className={syncing ? "spin" : ""} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M23 4v6h-6M1 20v-6h6" />
              <path d="M3.5 9a9 9 0 0 1 14.8-3.4L23 10M1 14l4.7 4.4A9 9 0 0 0 20.5 15" />
            </svg>
            立即同步
          </button>
          <button className="btn-icon" title="后台设置" onClick={() => { setIsAdmin(!!getToken()); setSettingsOpen(true); }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          {isAdmin && (
            <button className="btn-icon logout" title="退出登录" onClick={() => setConfirmLogout(true)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
            </button>
          )}
        </div>
      </header>

      <div className="toolbar">
        <h1>博主资料库</h1>
        <p className="lead">
          {!configLoaded ? (
            <>数据来自在线文档，仅读取不修改</>
          ) : (masked && !isAdmin) ? (
            <>已同步 <b>**</b> 位博主 · 数据来自在线文档，仅读取不修改</>
          ) : (
            <>已同步 <b>{total}</b> 位博主 · 数据来自在线文档，仅读取不修改</>
          )}
        </p>
        {configLoaded && (
          <div className="stat-bar">
            <div className="stat-card">
              <div className="sc-num">{effectiveMask ? "**" : (stats?.total ?? 0)}</div>
              <div className="sc-label">博主总数</div>
            </div>
            <div className="stat-card accent">
              <div className="sc-num">{effectiveMask ? "**" : `+${stats?.today_new ?? 0}`}</div>
              <div className="sc-label">今日新增</div>
            </div>
            <div className="stat-card">
              <div className="sc-num">{effectiveMask ? "**" : `+${stats?.week_new ?? 0}`}</div>
              <div className="sc-label">本周新增</div>
            </div>
            <div className="stat-card">
              <div className="sc-num">{effectiveMask ? "**" : (stats?.contracted ?? 0)}</div>
              <div className="sc-label">已签合同</div>
            </div>
            <div className="stat-card">
              <div className="sc-num">{effectiveMask ? "**" : (stats?.uncontracted ?? 0)}</div>
              <div className="sc-label">未签合同</div>
            </div>
            <div className="stat-card">
              <div className="sc-num">{effectiveMask ? "**" : (stats?.with_photo ?? 0)}</div>
              <div className="sc-label">已配照片</div>
            </div>
          </div>
        )}
        <div className="controls">
          <div className="search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input
              placeholder="搜索姓名 / 抖音号 / 电话 / 公司 / 备注…"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          <div className="select-wrap">
            <select value={company} onChange={(e) => setCompany(e.target.value)}>
              <option value="">全部公司</option>
              {options.companies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="select-wrap">
            <select value={contract} onChange={(e) => setContract(e.target.value as any)}>
              <option value="">全部合同</option>
              <option value="yes">已签合同</option>
              <option value="no">未签合同</option>
            </select>
          </div>
          <div className="select-wrap">
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="">全部周期</option>
              {options.coop_periods.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="select-wrap">
            <select value={size} onChange={(e) => setSize(e.target.value)}>
              <option value="">全部尺码</option>
              {options.sizes.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      </div>

      {error ? (
        <div className="state">
          <div className="big">加载失败</div>
          <div>{error}</div>
        </div>
      ) : loading ? (
        <div className="grid">
          {Array.from({ length: 10 }).map((_, i) => (
            <div className="skeleton" key={i}>
              <div className="sk-photo" />
              <div className="sk-body" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="state">
          <div className="big">没有找到博主</div>
          <div>换个关键词或筛选条件试试</div>
        </div>
      ) : (
        <>
          <div className="grid">
            {items.map((k, i) => (
              <KolCard key={k.uid} kol={k} index={i} masked={effectiveMask} onClick={() => setSelected(k)} onToast={showToast} />
            ))}
          </div>
          {pages > 1 && (
            <div className="pager">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
              {pageButtons.map((p, i) =>
                p === "..." ? (
                  <span className="gap" key={`g${i}`}>…</span>
                ) : (
                  <button
                    key={p}
                    className={p === page ? "active" : ""}
                    onClick={() => setPage(p as number)}
                  >
                    {p}
                  </button>
                )
              )}
              <button disabled={page >= pages} onClick={() => setPage(page + 1)}>›</button>
            </div>
          )}
        </>
      )}

      <KolDrawer
        kol={selected}
        masked={effectiveMask}
        isAdmin={isAdmin}
        onClose={() => setSelected(null)}
        onPhotoChange={handlePhotoChange}
        onToast={showToast}
      />
      <div className={`toast ${toast.type} ${toast.text ? "show" : ""}`}>{toast.text}</div>

      <ConfirmDialog
        open={confirmLogout}
        title="退出登录"
        message="确定要退出后台管理登录吗？"
        confirmText="退出"
        danger
        onConfirm={handleLogout}
        onCancel={() => setConfirmLogout(false)}
      />

      <SettingsDialog
        open={settingsOpen}
        onClose={() => { setSettingsOpen(false); setIsAdmin(!!getToken()); reloadList(); refreshOptions(); refreshStats(); }}
        onSaved={() => {
          setIsAdmin(!!getToken());
          fetchSyncStatus().then(setSync).catch(() => {});
          refreshPublicConfig();
          refreshStats();
          refreshOptions();
          // 重新加载列表以应用脱敏
          fetchKols({
            keyword: debKeyword,
            has_contract: contract === "" ? undefined : contract === "yes",
            size, coop_period: period, company, page, page_size: PAGE_SIZE,
          }).then((res) => { setItems(res.items); setTotal(res.total); setPages(res.pages); }).catch(() => {});
        }}
      />

      <footer className="app-footer">
        <span className="mark">KOL Finder</span>
        {version && <span className="ver">v{version}</span>}
      </footer>
    </>
  );
}

function buildPages(cur: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const res: (number | "...")[] = [1];
  const start = Math.max(2, cur - 1);
  const end = Math.min(total - 1, cur + 1);
  if (start > 2) res.push("...");
  for (let i = start; i <= end; i++) res.push(i);
  if (end < total - 1) res.push("...");
  res.push(total);
  return res;
}

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Kol, FilterOptions } from "./types";
import {
  fetchKols, fetchFilterOptions, fetchPublicConfig, getToken,
  fetchStats, type Stats, fetchVersion,
} from "./api";
import KolCard from "./components/KolCard";
import KolDrawer from "./components/KolDrawer";

const PAGE_SIZE_KEY = "kol_page_size";
const PAGE_SIZE_OPTIONS = [20, 50, 100];
function initialPageSize(): number {
  const v = Number(localStorage.getItem(PAGE_SIZE_KEY));
  return PAGE_SIZE_OPTIONS.includes(v) ? v : 20;
}

function useDebounced<T>(value: T, delay = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export default function App() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sp0 = useMemo(() => searchParams, []); // 仅用初始值初始化状态，后续由状态回写 URL
  const initContract = (["yes", "no"].includes(sp0.get("contract") || "") ? sp0.get("contract") : "") as "" | "yes" | "no";
  const initPage = Math.max(1, Number(sp0.get("page")) || 1);

  const [keyword, setKeyword] = useState(sp0.get("kw") || "");
  const debKeyword = useDebounced(keyword);
  const [contract, setContract] = useState<"" | "yes" | "no">(initContract);
  const [size, setSize] = useState(sp0.get("size") || "");
  const [period, setPeriod] = useState(sp0.get("period") || "");
  const [company, setCompany] = useState(sp0.get("company") || "");
  const [page, setPage] = useState(initPage);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [showTop, setShowTop] = useState(false);

  const [items, setItems] = useState<Kol[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [options, setOptions] = useState<FilterOptions>({ sizes: [], coop_periods: [], companies: [] });
  const [selected, setSelected] = useState<Kol | null>(null);
  const [toast, setToast] = useState<{ text: string; type: "" | "ok" | "err" }>({ text: "", type: "" });
  const [masked, setMasked] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [showCompanyOnCard, setShowCompanyOnCard] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [version, setVersion] = useState("");

  const isAdmin = !!getToken();

  function refreshStats() {
    fetchStats().then(setStats).catch(() => {});
  }

  function refreshPublicConfig() {
    fetchPublicConfig()
      .then((c) => {
        setMasked(!!c.mask_enabled);
        setCompanyName(c.company_name || "");
        setShowCompanyOnCard(!!c.show_company_on_card);
      })
      .catch(() => {})
      .finally(() => setConfigLoaded(true));
  }

  function showToast(text: string, type: "" | "ok" | "err" = "") {
    setToast({ text, type });
    setTimeout(() => setToast({ text: "", type: "" }), 1800);
  }

  // 初始化
  useEffect(() => {
    fetchFilterOptions().then(setOptions).catch(() => {});
    refreshPublicConfig();
    refreshStats();
    fetchVersion().then(setVersion).catch(() => {});
  }, []);

  // 筛选或每页数量变化时回到第一页（跳过首次挂载，避免覆盖 URL 里带的 page 参数）
  const firstFilterRun = useRef(true);
  useEffect(() => {
    if (firstFilterRun.current) { firstFilterRun.current = false; return; }
    setPage(1);
  }, [debKeyword, contract, size, period, company, pageSize]);

  // 浏览状态同步到 URL（刷新/分享/前进后退保留；pageSize 属个人偏好走 localStorage）
  useEffect(() => {
    const next: Record<string, string> = {};
    if (debKeyword) next.kw = debKeyword;
    if (contract) next.contract = contract;
    if (size) next.size = size;
    if (period) next.period = period;
    if (company) next.company = company;
    if (page > 1) next.page = String(page);
    setSearchParams(next, { replace: true });
  }, [debKeyword, contract, size, period, company, page, setSearchParams]);

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
      page_size: pageSize,
    })
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
        setPages(res.pages);
      })
      .catch((e) => setError(e?.message || "加载失败，请确认后端已启动"))
      .finally(() => setLoading(false));
  }, [debKeyword, contract, size, period, company, page, pageSize]);

  // 越界保护：数据变化后当前页超过总页数时，回落到最后一页
  useEffect(() => {
    if (!loading && pages >= 1 && page > pages) {
      setPage(pages);
    }
  }, [loading, pages, page]);

  // 返回顶部按钮：滚动超过一屏后显示
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 600);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function changePageSize(n: number) {
    setPageSize(n);
    localStorage.setItem(PAGE_SIZE_KEY, String(n));
  }

  function resetFilters() {
    setKeyword("");
    setContract("");
    setSize("");
    setPeriod("");
    setCompany("");
    setPage(1);
  }

  const hasActiveFilter = !!(keyword || contract || size || period || company);

  function handlePhotoChange(uid: string, photoUrl: string | null) {
    setItems((prev) => prev.map((k) => (k.uid === uid ? { ...k, photo_url: photoUrl } : k)));
    setSelected((prev) => (prev && prev.uid === uid ? { ...prev, photo_url: photoUrl } : prev));
  }

  const pageButtons = useMemo(() => buildPages(page, pages), [page, pages]);
  const effectiveMask = masked && !isAdmin;

  return (
    <>
      <header>
        <div className="brand">
          <span className="mark">KOL <em>Finder</em></span>
          {configLoaded && companyName && <span className="company-badge">{companyName}</span>}
        </div>
        <div className="sync">
          <Link className="btn-icon" to="/admin" title="进入后台">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </Link>
        </div>
      </header>

      <div className="toolbar">
        <h1>博主资料库</h1>
        <p className="lead">
          {!configLoaded ? (
            <>数据来自在线文档，仅读取不修改</>
          ) : effectiveMask ? (
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
          {hasActiveFilter && (
            <button className="btn-reset" onClick={resetFilters} title="清空所有筛选条件">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              重置筛选
            </button>
          )}
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
              <KolCard key={k.uid} kol={k} index={i} masked={effectiveMask} showCompany={showCompanyOnCard} onClick={() => setSelected(k)} onToast={showToast} />
            ))}
          </div>
          <div className="pager-bar">
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
            <div className="page-size">
              <span>每页</span>
              <div className="select-wrap">
                <select value={pageSize} onChange={(e) => changePageSize(Number(e.target.value))}>
                  {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>
          </div>
        </>
      )}

      {showTop && (
        <button className="back-top" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} title="返回顶部">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
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

import { useState } from "react";
import type { Kol } from "../types";
import { copyText } from "../clipboard";

interface Props {
  kol: Kol;
  index: number;
  masked?: boolean;
  onClick: () => void;
  onToast: (msg: string) => void;
}

function fmt(v: number | null): string {
  return v === null || v === undefined ? "—" : String(v);
}

export default function KolCard({ kol, index, masked, onClick, onToast }: Props) {
  const [copied, setCopied] = useState("");

  function copy(e: React.MouseEvent, key: string, value: string | null, label: string) {
    e.stopPropagation();
    if (!value) return;
    copyText(value)
      .then(() => {
        setCopied(key);
        onToast(`已复制${label}`);
        setTimeout(() => setCopied(""), 1200);
      })
      .catch(() => onToast("复制失败，请手动复制"));
  }

  function openDouyin(e: React.MouseEvent) {
    e.stopPropagation();
    if (!kol.douyin_id) return;
    const url = `https://www.douyin.com/search/${encodeURIComponent(kol.douyin_id)}`;
    window.open(url, "_blank", "noopener");
  }

  return (
    <div
      className="card"
      style={{ animationDelay: `${Math.min(index, 12) * 45}ms` }}
      onClick={onClick}
    >
      <div className="photo">
        <span className={`badge ${kol.has_contract ? "signed" : "unsigned"}`}>
          {kol.has_contract ? "● 已签合同" : "○ 未签合同"}
        </span>
        {kol.photo_url && (
          <span className="has-photo">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="m21 15-5-5L5 21" />
            </svg>
          </span>
        )}
        {kol.photo_url ? (
          <img src={kol.photo_url} alt={kol.name || ""} loading="lazy" />
        ) : (
          <span className="initial">{(kol.name || "?").slice(0, 1)}</span>
        )}
        <div className="photo-info">
          <div className="name">{kol.name || "未命名"}</div>
          {!masked && (
            <div className="meta">
              {kol.size && <span className="tag gold">{kol.size}</span>}
              {kol.coop_period && <span className="tag">{kol.coop_period}</span>}
            </div>
          )}
        </div>
      </div>

      <div className="cbody">
        <div className="contact">
          <div className="crow">
            <span className="lbl">公司</span>
            <span className="cval">{kol.company || "—"}</span>
          </div>
          <div className="crow">
            <span className="lbl">抖音</span>
            <span className="cval mono">{kol.douyin_id || "—"}</span>
            {kol.douyin_id && !masked && (
              <span className="ic-group">
                <button className="ic-btn" title="复制抖音号" onClick={(e) => copy(e, "dy", kol.douyin_id, "抖音号")}>
                  {copied === "dy" ? <CheckIcon /> : <CopyIcon />}
                </button>
                <button className="ic-btn" title="在抖音搜索" onClick={openDouyin}>
                  <ExternalIcon />
                </button>
              </span>
            )}
          </div>
          <div className="crow">
            <span className="lbl">电话</span>
            <span className="cval mono">{kol.phone || "—"}</span>
            {kol.phone && !masked && (
              <span className="ic-group">
                <button className="ic-btn" title="复制电话" onClick={(e) => copy(e, "ph", kol.phone, "电话")}>
                  {copied === "ph" ? <CheckIcon /> : <CopyIcon />}
                </button>
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="body-strip">
        <div className="b"><div className="bn">{fmt(kol.height)}</div><div className="bl">身高</div></div>
        <div className="b"><div className="bn">{fmt(kol.weight)}</div><div className="bl">体重</div></div>
        <div className="b"><div className="bn">{fmt(kol.bust)}</div><div className="bl">胸围</div></div>
        <div className="b"><div className="bn">{fmt(kol.waist)}</div><div className="bl">腰围</div></div>
        <div className="b"><div className="bn">{fmt(kol.hip)}</div><div className="bl">臀围</div></div>
      </div>

      <div className="cnote">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span className="txt">{kol.note || "暂无备注"}</span>
      </div>
    </div>
  );
}

const CopyIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
const ExternalIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <path d="M15 3h6v6M10 14 21 3" />
  </svg>
);

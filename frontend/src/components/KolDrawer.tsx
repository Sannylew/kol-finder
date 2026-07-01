import { useRef, useState } from "react";
import type { Kol } from "../types";
import { uploadPhoto, deletePhoto } from "../api";
import { copyText } from "../clipboard";
import { useScrollLock } from "../useScrollLock";
import ConfirmDialog from "./ConfirmDialog";

interface Props {
  kol: Kol | null;
  masked?: boolean;
  onClose: () => void;
  onPhotoChange: (uid: string, photoUrl: string | null) => void;
  onToast: (text: string, type?: "" | "ok" | "err") => void;
}

function fmt(v: number | null): string {
  return v === null || v === undefined ? "—" : String(v);
}

const CopyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export default function KolDrawer({ kol, masked, onClose, onPhotoChange, onToast }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string>("");
  const [confirmDel, setConfirmDel] = useState(false);
  const open = !!kol;
  useScrollLock(open);

  function copy(key: string, value: string, label: string) {
    if (!value || value === "—") return;
    copyText(value)
      .then(() => {
        setCopiedKey(key);
        onToast(`已复制${label}`, "ok");
        setTimeout(() => setCopiedKey(""), 1500);
      })
      .catch(() => onToast("复制失败，请手动复制", "err"));
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !kol) return;
    setBusy(true);
    try {
      const { photo_url } = await uploadPhoto(kol.uid, file);
      onPhotoChange(kol.uid, photo_url);
      onToast("照片已上传", "ok");
    } catch (err: any) {
      onToast("上传失败：" + (err?.response?.data?.detail || err.message), "err");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleDelete() {
    if (!kol || !kol.photo_url) return;
    setConfirmDel(false);
    setBusy(true);
    try {
      await deletePhoto(kol.uid);
      onPhotoChange(kol.uid, null);
      onToast("照片已删除", "ok");
    } catch (err: any) {
      onToast("删除失败：" + (err?.response?.data?.detail || err.message), "err");
    } finally {
      setBusy(false);
    }
  }

  // 可复制信息行
  const rows: { key: string; label: string; value: string; mono?: boolean }[] = kol
    ? [
        { key: "name", label: "姓名", value: kol.name || "—" },
        { key: "phone", label: "电话", value: kol.phone || "—", mono: true },
        { key: "douyin", label: "抖音号", value: kol.douyin_id || "—", mono: true },
        { key: "company", label: "公司", value: kol.company || "—" },
        { key: "address", label: "收货地址", value: kol.address || "—" },
      ]
    : [];

  return (
    <>
      <div className={`scrim ${open ? "open" : ""}`} onClick={onClose} />
      <aside className={`drawer ${open ? "open" : ""}`}>
        {kol && (
          <>
            <div className="d-photo">
              <button className="d-close" onClick={onClose}>×</button>
              {kol.photo_url ? (
                <img src={kol.photo_url} alt={kol.name || ""} />
              ) : (
                <span className="initial">{(kol.name || "?").slice(0, 1)}</span>
              )}
            </div>
            <div className="d-body">
              <div className="d-name">{kol.name || "未命名"}</div>
              <div className="d-sub">
                <span className={`d-badge ${kol.has_contract ? "signed" : "unsigned"}`}>
                  {kol.has_contract ? "已签合同" : "未签合同"}
                </span>
                {!masked && kol.coop_period && <span className="d-badge plain">{kol.coop_period}</span>}
                {!masked && kol.size && <span className="d-badge gold">{kol.size}</span>}
              </div>

              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleFile}
              />
              {kol.photo_url ? (
                <div className="photo-actions">
                  <button
                    className={`pa-btn ${busy ? "busy" : ""}`}
                    onClick={() => !busy && fileRef.current?.click()}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M23 4v6h-6M1 20v-6h6" />
                      <path d="M3.5 9a9 9 0 0 1 14.8-3.4L23 10M1 14l4.7 4.4A9 9 0 0 0 20.5 15" />
                    </svg>
                    {busy ? "处理中…" : "更换照片"}
                  </button>
                  <button
                    className={`pa-btn danger ${busy ? "busy" : ""}`}
                    onClick={() => !busy && setConfirmDel(true)}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                    </svg>
                    删除照片
                  </button>
                </div>
              ) : (
                <div
                  className={`upload ${busy ? "busy" : ""}`}
                  onClick={() => !busy && fileRef.current?.click()}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  {busy ? "处理中…" : "上传照片"}
                </div>
              )}

              <div className="section">
                <h4>联系与资料{masked ? "" : "（点击可复制）"}</h4>
                <div className="copy-list">
                  {rows.map((r) => (
                    <div
                      className={`copy-row ${masked ? "nocopy" : ""}`}
                      key={r.key}
                      onClick={() => !masked && copy(r.key, r.value, r.label)}
                    >
                      <span className="ck">{r.label}</span>
                      <span className={`cv ${r.mono ? "mono" : ""}`}>{r.value}</span>
                      {!masked && (
                        <button className={`copy-btn ${copiedKey === r.key ? "done" : ""}`}>
                          {copiedKey === r.key ? <CheckIcon /> : <CopyIcon />}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="section">
                <h4>合作信息</h4>
                <div className="rows">
                  <div className="row"><span className="k">合同状态</span><span className="v">{kol.has_contract ? "已签合同" : "未签合同"}</span></div>
                  <div className="row"><span className="k">合作周期</span><span className="v">{kol.coop_period || "—"}</span></div>
                  <div className="row"><span className="k">建群时间</span><span className="v">{kol.group_date || "—"}</span></div>
                  <div className="row"><span className="k">邮寄件数</span><span className="v">{kol.shipment || "—"}</span></div>
                  <div className="row"><span className="k">视频情况</span><span className="v">{kol.video_status || "—"}</span></div>
                  <div className="row"><span className="k">序号</span><span className="v">{kol.seq ?? "—"}</span></div>
                </div>
              </div>

              <div className="section">
                <h4>身材数据</h4>
                <div className="body-grid">
                  <div className="stat"><div className="num">{kol.size || "—"}</div><div className="lbl">尺码</div></div>
                  <div className="stat"><div className="num">{fmt(kol.height)}</div><div className="lbl">身高 cm</div></div>
                  <div className="stat"><div className="num">{fmt(kol.weight)}</div><div className="lbl">体重 斤</div></div>
                  <div className="stat"><div className="num">{fmt(kol.bust)}</div><div className="lbl">胸围</div></div>
                  <div className="stat"><div className="num">{fmt(kol.waist)}</div><div className="lbl">腰围</div></div>
                  <div className="stat"><div className="num">{fmt(kol.hip)}</div><div className="lbl">臀围</div></div>
                </div>
              </div>

              <div className="section">
                <h4>备注</h4>
                <div className="note-box">{kol.note || "—"}</div>
              </div>
            </div>
          </>
        )}
      </aside>
      <ConfirmDialog
        open={confirmDel}
        title="删除照片"
        message={`确定删除「${kol?.name || ""}」的照片吗？此操作不可恢复。`}
        confirmText="删除"
        danger
        onConfirm={handleDelete}
        onCancel={() => setConfirmDel(false)}
      />
    </>
  );
}

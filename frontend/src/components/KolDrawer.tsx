import { useEffect, useRef, useState } from "react";
import type { Kol } from "../types";
import {
  uploadPhoto, deletePhoto,
  fetchPackagePhotos, uploadPackagePhotos, deletePackagePhoto, type PackagePhoto,
} from "../api";
import { copyText } from "../clipboard";
import { useScrollLock } from "../useScrollLock";
import ConfirmDialog from "./ConfirmDialog";

interface Props {
  kol: Kol | null;
  masked?: boolean;
  isAdmin?: boolean;
  onClose: () => void;
  onPhotoChange: (uid: string, photoUrl: string | null, photoThumbUrl?: string | null) => void;
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
const CloseIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export default function KolDrawer({ kol, masked, isAdmin, onClose, onPhotoChange, onToast }: Props) {
  const drawerRef = useRef<HTMLElement>(null);
  const photoRef = useRef<HTMLDivElement>(null);
  const collapsingPhotoRef = useRef(false);
  const pkgCacheRef = useRef<Map<string, PackagePhoto[]>>(new Map());
  const fileRef = useRef<HTMLInputElement>(null);
  const pkgFileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string>("");
  const [confirmDel, setConfirmDel] = useState(false);
  const [pkgPhotos, setPkgPhotos] = useState<PackagePhoto[]>([]);
  const [pkgBusy, setPkgBusy] = useState(false);
  const [confirmDelPkg, setConfirmDelPkg] = useState<PackagePhoto | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [photoPreviewOpen, setPhotoPreviewOpen] = useState(false);
  const [fullPhotoReady, setFullPhotoReady] = useState(false);
  const open = !!kol;
  useScrollLock(open);

  // 打开抽屉/切换博主时加载已拍衣服；关闭清空
  useEffect(() => {
    if (!kol) {
      setPkgPhotos([]);
      setLightboxIndex(null);
      setPhotoPreviewOpen(false);
      setFullPhotoReady(false);
      return;
    }
    setPhotoPreviewOpen(false);
    setFullPhotoReady(false);
    const cached = pkgCacheRef.current.get(kol.uid);
    if (cached) {
      setPkgPhotos(cached);
    } else {
      setPkgPhotos([]);
    }
    let alive = true;
    fetchPackagePhotos(kol.uid)
      .then((list) => {
        if (!alive) return;
        pkgCacheRef.current.set(kol.uid, list);
        setPkgPhotos(list);
      })
      .catch(() => { if (alive) setPkgPhotos([]); });
    return () => { alive = false; };
  }, [kol?.uid]);

  useEffect(() => {
    if (!kol?.photo_url) {
      setFullPhotoReady(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const img = new Image();
      img.decoding = "async";
      img.src = kol.photo_url || "";
      const markReady = () => {
        if (!cancelled) setFullPhotoReady(true);
      };
      if (img.decode) {
        img.decode().then(markReady).catch(markReady);
      } else {
        img.onload = markReady;
        img.onerror = markReady;
      }
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [kol?.uid, kol?.photo_url]);

  useEffect(() => {
    if (!photoPreviewOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPhotoPreviewOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [photoPreviewOpen]);

  // 灯箱键盘操作：Esc 关闭，←/→ 切换
  useEffect(() => {
    if (lightboxIndex === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setLightboxIndex(null);
      else if (e.key === "ArrowLeft") setLightboxIndex((i) => (i === null ? i : (i - 1 + pkgPhotos.length) % pkgPhotos.length));
      else if (e.key === "ArrowRight") setLightboxIndex((i) => (i === null ? i : (i + 1) % pkgPhotos.length));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIndex, pkgPhotos.length]);

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

  function collapsePhotoAndRevealInfo(deltaY = 0) {
    if (!photoPreviewOpen || collapsingPhotoRef.current) return;
    const drawer = drawerRef.current;
    const photo = photoRef.current;
    collapsingPhotoRef.current = true;
    if (photo) {
      photo.style.height = `${photo.getBoundingClientRect().height}px`;
      photo.style.overflow = "hidden";
    }
    requestAnimationFrame(() => {
      setPhotoPreviewOpen(false);
      requestAnimationFrame(() => {
        if (photo) {
          photo.style.height = `${Math.min(window.innerHeight * 0.72, 624)}px`;
        }
        window.setTimeout(() => {
          const gentleStep = Math.min(Math.max(deltaY * 0.75, 18), 90);
          drawer?.scrollBy({ top: gentleStep, behavior: "smooth" });
        }, 180);
        window.setTimeout(() => {
          if (photo) {
            photo.style.height = "";
            photo.style.overflow = "";
          }
          collapsingPhotoRef.current = false;
        }, 560);
      });
    });
  }

  function handleDrawerWheel(e: React.WheelEvent<HTMLElement>) {
    if (!photoPreviewOpen || e.deltaY <= 0) return;
    e.preventDefault();
    collapsePhotoAndRevealInfo(e.deltaY);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !kol) return;
    setBusy(true);
    try {
      const { photo_url, photo_thumb_url } = await uploadPhoto(kol.uid, file);
      onPhotoChange(kol.uid, photo_url, photo_thumb_url);
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

  async function handlePkgFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length || !kol) return;
    setPkgBusy(true);
    try {
      const { added, errors } = await uploadPackagePhotos(kol.uid, files);
      if (added.length) {
        setPkgPhotos((prev) => {
          const next = [...prev, ...added];
          pkgCacheRef.current.set(kol.uid, next);
          return next;
        });
      }
      if (errors.length) {
        onToast(`${added.length ? `已添加 ${added.length} 张，` : ""}${errors.length} 张失败：${errors[0].reason}`, added.length ? "ok" : "err");
      } else {
        onToast(`已添加 ${added.length} 张已拍衣服`, "ok");
      }
    } catch (err: any) {
      onToast("上传失败：" + (err?.response?.data?.detail || err.message), "err");
    } finally {
      setPkgBusy(false);
      if (pkgFileRef.current) pkgFileRef.current.value = "";
    }
  }

  async function handleDeletePkg() {
    const target = confirmDelPkg;
    if (!kol || !target) return;
    setConfirmDelPkg(null);
    setPkgBusy(true);
    try {
      await deletePackagePhoto(kol.uid, target.id);
      setPkgPhotos((prev) => {
        const next = prev.filter((p) => p.id !== target.id);
        pkgCacheRef.current.set(kol.uid, next);
        return next;
      });
      setLightboxIndex(null);
      onToast("已拍衣服已删除", "ok");
    } catch (err: any) {
      onToast("删除失败：" + (err?.response?.data?.detail || err.message), "err");
    } finally {
      setPkgBusy(false);
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
  const drawerPhotoSrc = kol
    ? (photoPreviewOpen && fullPhotoReady ? kol.photo_url : (kol.photo_thumb_url || kol.photo_url))
    : "";

  return (
    <>
      <div className={`scrim ${open ? "open" : ""}`} onClick={onClose} />
      <aside
        ref={drawerRef}
        className={`drawer ${open ? "open" : ""} ${photoPreviewOpen ? "photo-expanded" : ""}`}
        onWheel={handleDrawerWheel}
      >
        {kol && (
          <>
            <div className="d-photo" ref={photoRef}>
              <button className="d-close" onClick={onClose} aria-label="关闭档案"><CloseIcon /></button>
              <div className="d-kicker">Creator file</div>
              {kol.photo_url ? (
                <button
                  className="d-photo-open"
                  type="button"
                  onClick={() => setPhotoPreviewOpen((v) => !v)}
                  aria-label="查看主图全图"
                >
                  <img
                    src={drawerPhotoSrc || ""}
                    alt={kol.name || ""}
                    decoding="async"
                    loading="eager"
                    fetchPriority={photoPreviewOpen ? "high" : "low"}
                  />
                </button>
              ) : (
                <span className="initial">{(kol.name || "?").slice(0, 1)}</span>
              )}
            </div>
            <div className="d-body">
              <div className="d-identity">
                <span className="d-label">博主完整档案</span>
                <div className="d-name">{kol.name || "未命名"}</div>
                <div className="d-sub">
                  <span className={`d-badge ${kol.has_contract ? "signed" : "unsigned"}`}>
                    {kol.has_contract ? "已签合同" : "未签合同"}
                  </span>
                  {!masked && kol.coop_period && <span className="d-badge plain">{kol.coop_period}</span>}
                  {!masked && kol.size && <span className="d-badge gold">{kol.size}</span>}
                </div>
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

              <input
                ref={pkgFileRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: "none" }}
                onChange={handlePkgFiles}
              />
              {(isAdmin || pkgPhotos.length > 0) && (
                <div className="section pkg-section archive-section">
                  <h4>已拍衣服{pkgPhotos.length > 0 ? `（${pkgPhotos.length}）` : ""}</h4>
                  <div className="pkg-grid">
                    {pkgPhotos.map((p, i) => (
                      <div className="pkg-thumb" key={p.id}>
                        <img
                          src={p.thumb_url || p.url}
                          alt="已拍衣服"
                          loading="lazy"
                          onClick={() => setLightboxIndex(i)}
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0.25"; }}
                        />
                        {isAdmin && (
                          <button
                            className="pkg-del"
                            title="删除这张已拍衣服"
                            onClick={() => !pkgBusy && setConfirmDelPkg(p)}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                    {isAdmin && (
                      <div
                        className={`pkg-add ${pkgBusy ? "busy" : ""}`}
                        onClick={() => !pkgBusy && pkgFileRef.current?.click()}
                        title="添加已拍衣服"
                      >
                        {pkgBusy ? (
                          <span className="pkg-add-txt">上传中…</span>
                        ) : (
                          <>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M12 5v14M5 12h14" />
                            </svg>
                            <span className="pkg-add-txt">添加</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="section archive-section">
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

              <div className="section archive-section">
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

              <div className="section archive-section">
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

              <div className="section archive-section">
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

      <ConfirmDialog
        open={!!confirmDelPkg}
        title="删除已拍衣服"
        message="确定删除这张已拍衣服吗？此操作不可恢复。"
        confirmText="删除"
        danger
        onConfirm={handleDeletePkg}
        onCancel={() => setConfirmDelPkg(null)}
      />

      {lightboxIndex !== null && pkgPhotos[lightboxIndex] && (
        <div className="lightbox-scrim" onClick={() => setLightboxIndex(null)}>
          <button className="lb-close" onClick={() => setLightboxIndex(null)} title="关闭"><CloseIcon /></button>
          {pkgPhotos.length > 1 && (
            <button
              className="lb-nav prev"
              onClick={(e) => { e.stopPropagation(); setLightboxIndex((i) => (i === null ? i : (i - 1 + pkgPhotos.length) % pkgPhotos.length)); }}
              title="上一张"
            >‹</button>
          )}
          <img
            className="lightbox-img"
            src={pkgPhotos[lightboxIndex].url}
            alt="已拍衣服"
            onClick={(e) => e.stopPropagation()}
          />
          {pkgPhotos.length > 1 && (
            <button
              className="lb-nav next"
              onClick={(e) => { e.stopPropagation(); setLightboxIndex((i) => (i === null ? i : (i + 1) % pkgPhotos.length)); }}
              title="下一张"
            >›</button>
          )}
          {pkgPhotos.length > 1 && (
            <div className="lb-counter">{lightboxIndex + 1} / {pkgPhotos.length}</div>
          )}
        </div>
      )}
    </>
  );
}

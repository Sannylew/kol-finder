import { useEffect, useState } from "react";
import { createKol, updateKol } from "../api";
import type { Kol } from "../types";

interface Props {
  open: boolean;
  initial: Kol | null; // null = 新增
  onClose: () => void;
  onSaved: () => void;
}

interface FormState {
  name: string;
  phone: string;
  has_contract: boolean;
  company: string;
  coop_period: string;
  size: string;
  height: string;
  weight: string;
  bust: string;
  waist: string;
  hip: string;
  douyin_id: string;
  note: string;
  address: string;
  delivery_status: string;
  // 扩展字段
  seq: string;
  group_date: string;
  shipment: string;
  video_status: string;
}

const EMPTY: FormState = {
  name: "", phone: "", has_contract: false, company: "", coop_period: "",
  size: "", height: "", weight: "", bust: "", waist: "", hip: "",
  douyin_id: "", note: "", address: "", delivery_status: "",
  seq: "", group_date: "", shipment: "", video_status: "",
};

function toNum(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function fromKol(k: Kol): FormState {
  return {
    name: k.name || "",
    phone: k.phone || "",
    has_contract: !!k.has_contract,
    company: k.company || "",
    coop_period: k.coop_period || "",
    size: k.size || "",
    height: k.height == null ? "" : String(k.height),
    weight: k.weight == null ? "" : String(k.weight),
    bust: k.bust == null ? "" : String(k.bust),
    waist: k.waist == null ? "" : String(k.waist),
    hip: k.hip == null ? "" : String(k.hip),
    douyin_id: k.douyin_id || "",
    note: k.note || "",
    address: k.address || "",
    delivery_status: k.delivery_status || "",
    seq: k.seq == null ? "" : String(k.seq),
    group_date: k.group_date || "",
    shipment: k.shipment || "",
    video_status: k.video_status || "",
  };
}

export default function KolForm({ open, initial, onClose, onSaved }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [showMore, setShowMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open) {
      setForm(initial ? fromKol(initial) : EMPTY);
      setShowMore(false);
      setErr("");
    }
  }, [open, initial]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    const phone = form.phone.trim();
    if (!name) { setErr("请填写姓名"); return; }
    if (!phone) { setErr("请填写电话"); return; }

    const payload = {
      name,
      phone,
      has_contract: form.has_contract,
      company: form.company.trim() || null,
      coop_period: form.coop_period.trim() || null,
      size: form.size.trim() || null,
      height: toNum(form.height),
      weight: toNum(form.weight),
      bust: toNum(form.bust),
      waist: toNum(form.waist),
      hip: toNum(form.hip),
      douyin_id: form.douyin_id.trim() || null,
      note: form.note.trim() || null,
      address: form.address.trim() || null,
      delivery_status: form.delivery_status.trim() || null,
      seq: toNum(form.seq),
      group_date: form.group_date.trim() || null,
      shipment: form.shipment.trim() || null,
      video_status: form.video_status.trim() || null,
    };

    setSaving(true);
    setErr("");
    try {
      if (initial) await updateKol(initial.uid, payload);
      else await createKol(payload);
      onSaved();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className={`scrim ${open ? "open" : ""}`} onClick={onClose} />
      <div className={`drawer ${open ? "open" : ""}`}>
        <div className="modal-head">
          <h3>{initial ? "编辑博主" : "新增博主"}</h3>
          <button className="modal-close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="modal-body">
          {err && <div className="msg err">{err}</div>}
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="field">
                <label>姓名<span className="req">*</span></label>
                <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="必填" />
              </div>
              <div className="field">
                <label>电话<span className="req">*</span></label>
                <input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="必填" inputMode="tel" />
              </div>

              <div className="field form-full">
                <label>合同状态</label>
                <label className="checkbox-line">
                  <input type="checkbox" checked={form.has_contract} onChange={(e) => set("has_contract", e.target.checked)} />
                  <span>{form.has_contract ? "已签合同" : "未签合同"}</span>
                </label>
              </div>

              <div className="field">
                <label>公司</label>
                <input value={form.company} onChange={(e) => set("company", e.target.value)} />
              </div>
              <div className="field">
                <label>合作时间</label>
                <input value={form.coop_period} onChange={(e) => set("coop_period", e.target.value)} placeholder="如 2026年1月" />
              </div>

              <div className="field">
                <label>尺码</label>
                <input value={form.size} onChange={(e) => set("size", e.target.value)} placeholder="S / M / L / XL" />
              </div>
              <div className="field">
                <label>快递状态</label>
                <input value={form.delivery_status} onChange={(e) => set("delivery_status", e.target.value)} placeholder="如 待寄回 / 8.11寄出" />
              </div>

              <div className="field">
                <label>身高 (cm)</label>
                <input value={form.height} onChange={(e) => set("height", e.target.value)} inputMode="decimal" type="number" min="0" />
              </div>
              <div className="field">
                <label>体重 (kg)</label>
                <input value={form.weight} onChange={(e) => set("weight", e.target.value)} inputMode="decimal" type="number" min="0" />
              </div>

              <div className="field">
                <label>胸围 (cm)</label>
                <input value={form.bust} onChange={(e) => set("bust", e.target.value)} inputMode="decimal" type="number" min="0" />
              </div>
              <div className="field">
                <label>腰围 (cm)</label>
                <input value={form.waist} onChange={(e) => set("waist", e.target.value)} inputMode="decimal" type="number" min="0" />
              </div>
              <div className="field">
                <label>臀围 (cm)</label>
                <input value={form.hip} onChange={(e) => set("hip", e.target.value)} inputMode="decimal" type="number" min="0" />
              </div>
              <div className="field">
                <label>抖音号</label>
                <input value={form.douyin_id} onChange={(e) => set("douyin_id", e.target.value)} />
              </div>

              <div className="field form-full">
                <label>备注</label>
                <textarea value={form.note} onChange={(e) => set("note", e.target.value)} rows={3} />
              </div>
              <div className="field form-full">
                <label>收货地址</label>
                <textarea value={form.address} onChange={(e) => set("address", e.target.value)} rows={2} />
              </div>
            </div>

            <button type="button" className="link-btn" onClick={() => setShowMore((v) => !v)}>
              {showMore ? "收起更多字段 ▲" : "更多字段 ▼"}
            </button>

            {showMore && (
              <div className="form-grid" style={{ marginTop: 14 }}>
                <div className="field">
                  <label>序号</label>
                  <input value={form.seq} onChange={(e) => set("seq", e.target.value)} inputMode="numeric" type="number" min="0" />
                </div>
                <div className="field">
                  <label>建群时间</label>
                  <input value={form.group_date} onChange={(e) => set("group_date", e.target.value)} placeholder="YYYY-MM-DD" />
                </div>
                <div className="field">
                  <label>邮寄件数</label>
                  <input value={form.shipment} onChange={(e) => set("shipment", e.target.value)} />
                </div>
                <div className="field">
                  <label>抖音视频情况</label>
                  <input value={form.video_status} onChange={(e) => set("video_status", e.target.value)} />
                </div>
              </div>
            )}

            <div className="modal-actions" style={{ marginTop: 20 }}>
              <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>取消</button>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

import { useEffect, useState } from "react";
import { fetchSettings, saveSettings } from "../api";

const PACKAGE_LIMIT_OPTIONS = [
  { value: 10, label: "10 张" },
  { value: 20, label: "20 张" },
  { value: 50, label: "50 张" },
  { value: 100, label: "100 张" },
  { value: 0, label: "不限制" },
];

export default function AppearanceSettings() {
  const [companyName, setCompanyName] = useState("");
  const [mask, setMask] = useState(false);
  const [showCompany, setShowCompany] = useState(false);
  const [packageLimit, setPackageLimit] = useState(20);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    fetchSettings()
      .then((s: any) => {
        setCompanyName(s.company_name || "");
        setMask(s.mask_enabled === "1" || s.mask_enabled === 1 || s.mask_enabled === true);
        setShowCompany(s.show_company_on_card === "1" || s.show_company_on_card === 1 || s.show_company_on_card === true);
        const limit = Number(s.package_photo_limit);
        setPackageLimit(Number.isFinite(limit) && limit >= 0 ? limit : 20);
      })
      .catch(() => setMsg({ type: "err", text: "读取配置失败" }))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true); setMsg(null);
    try {
      await saveSettings({
        company_name: companyName.trim(),
        mask_enabled: mask ? "1" : "0",
        show_company_on_card: showCompany ? "1" : "0",
        package_photo_limit: String(packageLimit),
      } as any);
      setMsg({ type: "ok", text: "已保存，配置立即生效" });
    } catch (e: any) {
      setMsg({ type: "err", text: e?.response?.data?.detail || "保存失败" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="admin-page"><p className="hint">读取中…</p></div>;

  return (
    <div className="admin-page">
      <div className="admin-page-head"><h2>外观设置</h2></div>
      {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}

      <div className="admin-card">
        <div className="field">
          <label>公司名称</label>
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} maxLength={40}
            placeholder="显示在左上角，例如：某某文化传媒" />
          <p className="hint">显示在前台左上角品牌区，所有访问者可见。留空则不显示。</p>
        </div>

        <div className="field toggle-field">
          <div>
            <label>前端脱敏显示</label>
            <p className="hint">开启后访客只能看到姓名和照片，电话、抖音号、地址、身材、备注等全部打码。</p>
          </div>
          <button className={`switch ${mask ? "on" : ""}`} onClick={() => setMask(!mask)} aria-label="脱敏开关">
            <span className="knob" />
          </button>
        </div>

        <div className="field toggle-field">
          <div>
            <label>卡片显示公司</label>
            <p className="hint">开启后前台卡片显示公司行；关闭则隐藏（详情页与后台不受影响）。</p>
          </div>
          <button className={`switch ${showCompany ? "on" : ""}`} onClick={() => setShowCompany(!showCompany)} aria-label="卡片显示公司开关">
            <span className="knob" />
          </button>
        </div>

        <div className="field">
          <label>已拍衣服图片上限</label>
          <div className="preset-group" role="group" aria-label="已拍衣服图片上限">
            {PACKAGE_LIMIT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`preset-btn ${packageLimit === opt.value ? "active" : ""}`}
                onClick={() => setPackageLimit(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="hint">限制每个博主详情里可追加的已拍衣服图片数量；不限制时仍保留单张 10MB 上传限制。</p>
        </div>

        <div className="modal-actions">
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

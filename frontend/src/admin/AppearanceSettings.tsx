import { useEffect, useState } from "react";
import { fetchSettings, saveSettings } from "../api";

export default function AppearanceSettings() {
  const [companyName, setCompanyName] = useState("");
  const [mask, setMask] = useState(false);
  const [showCompany, setShowCompany] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    fetchSettings()
      .then((s: any) => {
        setCompanyName(s.company_name || "");
        setMask(s.mask_enabled === "1" || s.mask_enabled === 1 || s.mask_enabled === true);
        setShowCompany(s.show_company_on_card === "1" || s.show_company_on_card === 1 || s.show_company_on_card === true);
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

        <div className="modal-actions">
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

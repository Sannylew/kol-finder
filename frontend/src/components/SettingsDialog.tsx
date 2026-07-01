import { useEffect, useRef, useState } from "react";
import {
  fetchSettings, saveSettings, testConnection,
  login, changePassword, getToken, setToken, clearToken,
  fetchLogs, fetchBackups, createBackup, deleteBackup, downloadBackup,
  restoreBackup, restoreUpload,
  type BackupItem,
} from "../api";
import { useScrollLock } from "../useScrollLock";
import ConfirmDialog from "./ConfirmDialog";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

type Tab = "settings" | "logs" | "backups";

export default function SettingsDialog({ open, onClose, onSaved }: Props) {
  const [authed, setAuthed] = useState(!!getToken());
  const [tab, setTab] = useState<Tab>("settings");

  // 登录表单
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  // 设置表单
  const [webhook, setWebhook] = useState("");
  const [token, setTokenField] = useState("");
  const [tokenSet, setTokenSet] = useState(false);
  const [interval, setIntervalSec] = useState("300");
  const [autoSync, setAutoSync] = useState(true);
  const [mask, setMask] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // 改密
  const [showPwd, setShowPwd] = useState(false);
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [mustChange, setMustChange] = useState(false);

  // 日志
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logLevel, setLogLevel] = useState("");
  const [logLoading, setLogLoading] = useState(false);

  // 备份
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [delTarget, setDelTarget] = useState<string>("");
  const [restoreTarget, setRestoreTarget] = useState<string>("");
  const [restoring, setRestoring] = useState(false);
  const restoreFileRef = useRef<HTMLInputElement>(null);
  const [pendingUpload, setPendingUpload] = useState<File | null>(null);

  useEffect(() => {
    if (!open) return;
    setMsg(null);
    setShowPwd(false);
    setMustChange(false);
    setTab("settings");
    setAuthed(!!getToken());
    if (getToken()) loadSettings();
  }, [open]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function loadSettings() {
    setLoading(true);
    setTokenField("");
    fetchSettings()
      .then((s: any) => {
        setWebhook(s.kdocs_webhook_url || "");
        setTokenSet(!!s.kdocs_token_set);
        setIntervalSec(s.sync_interval_seconds || "300");
        setAutoSync(s.auto_sync_enabled === "1" || s.auto_sync_enabled === 1 || s.auto_sync_enabled === true);
        setMask(s.mask_enabled === "1" || s.mask_enabled === 1 || s.mask_enabled === true);
        setAuthed(true);
      })
      .catch((e) => {
        if (e?.response?.status === 401) {
          clearToken();
          setAuthed(false);
        } else {
          setMsg({ type: "err", text: "读取配置失败" });
        }
      })
      .finally(() => setLoading(false));
  }

  async function handleLogin() {
    setLoggingIn(true);
    setMsg(null);
    try {
      const r = await login(username, password);
      setToken(r.token);
      setPassword("");
      if (r.must_change_password) {
        // 仍是默认密码：强制改密
        setAuthed(true);
        setShowPwd(true);
        setMustChange(true);
        setMsg({ type: "err", text: "当前为默认密码，请立即修改后再使用" });
        loadSettings();
      } else {
        loadSettings();
      }
    } catch (e: any) {
      setMsg({ type: "err", text: e?.response?.data?.detail || "登录失败" });
    } finally {
      setLoggingIn(false);
    }
  }

  function handleLogout() {
    clearToken();
    setAuthed(false);
    setMsg(null);
  }

  async function handleTest() {
    setTesting(true); setMsg(null);
    try {
      const r = await testConnection({ kdocs_webhook_url: webhook, kdocs_token: token || undefined });
      setMsg({ type: "ok", text: `连接成功，读取到 ${r.total} 条数据` });
    } catch (e: any) {
      setMsg({ type: "err", text: e?.response?.data?.detail || "连接失败" });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true); setMsg(null);
    try {
      await saveSettings({
        kdocs_webhook_url: webhook,
        kdocs_token: token || undefined,
        sync_interval_seconds: interval,
        auto_sync_enabled: autoSync ? "1" : "0",
        mask_enabled: mask ? "1" : "0",
      } as any);
      setMsg({ type: "ok", text: "已保存，配置立即生效" });
      onSaved();
    } catch (e: any) {
      setMsg({ type: "err", text: e?.response?.data?.detail || "保存失败" });
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePwd() {
    setMsg(null);
    try {
      await changePassword(oldPwd, newPwd);
      setOldPwd(""); setNewPwd(""); setShowPwd(false);
      setMustChange(false);
      // 改密后旧令牌已失效，清除登录态、回到登录界面，要求用新密码重新登录
      clearToken();
      setAuthed(false);
      setPassword("");
      onSaved();  // 通知外层刷新管理员状态（退出登录态）
      setMsg({ type: "ok", text: "密码已修改，请用新密码重新登录" });
    } catch (e: any) {
      setMsg({ type: "err", text: e?.response?.data?.detail || "修改失败" });
    }
  }

  function loadLogs() {
    setLogLoading(true);
    fetchLogs(300, logLevel)
      .then((r) => setLogLines(r.lines))
      .catch(() => setMsg({ type: "err", text: "读取日志失败" }))
      .finally(() => setLogLoading(false));
  }

  function loadBackups() {
    setBackupLoading(true);
    fetchBackups()
      .then(setBackups)
      .catch(() => setMsg({ type: "err", text: "读取备份列表失败" }))
      .finally(() => setBackupLoading(false));
  }

  function switchTab(t: Tab) {
    setTab(t);
    setMsg(null);
    if (t === "logs") loadLogs();
    if (t === "backups") loadBackups();
  }

  async function handleBackupNow() {
    setBackingUp(true); setMsg(null);
    try {
      await createBackup();
      setMsg({ type: "ok", text: "备份已创建" });
      loadBackups();
    } catch (e: any) {
      setMsg({ type: "err", text: e?.response?.data?.detail || "备份失败" });
    } finally {
      setBackingUp(false);
    }
  }

  async function handleDownloadBackup(name: string) {
    try {
      await downloadBackup(name);
    } catch {
      setMsg({ type: "err", text: "下载失败" });
    }
  }

  async function handleDeleteBackup() {
    const name = delTarget;
    setDelTarget("");
    if (!name) return;
    try {
      await deleteBackup(name);
      setMsg({ type: "ok", text: "备份已删除" });
      loadBackups();
    } catch {
      setMsg({ type: "err", text: "删除失败" });
    }
  }

  async function handleRestore() {
    const name = restoreTarget;
    setRestoreTarget("");
    if (!name) return;
    setRestoring(true); setMsg(null);
    try {
      const r = await restoreBackup(name);
      setMsg({ type: "ok", text: `已恢复（恢复前已自动快照 ${r.safety_backup}）` });
      loadBackups();
      onSaved();  // 数据变了，刷新列表
    } catch (e: any) {
      setMsg({ type: "err", text: e?.response?.data?.detail || "恢复失败" });
    } finally {
      setRestoring(false);
    }
  }

  function onPickRestoreFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setPendingUpload(f);
    if (restoreFileRef.current) restoreFileRef.current.value = "";
  }

  async function handleRestoreUpload() {
    const f = pendingUpload;
    setPendingUpload(null);
    if (!f) return;
    setRestoring(true); setMsg(null);
    try {
      const r = await restoreUpload(f);
      setMsg({ type: "ok", text: `已从上传文件恢复（自动快照 ${r.safety_backup}）` });
      loadBackups();
      onSaved();
    } catch (e: any) {
      setMsg({ type: "err", text: e?.response?.data?.detail || "恢复失败" });
    } finally {
      setRestoring(false);
    }
  }

  function fmtSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  // 弹窗打开时锁定背景滚动
  useScrollLock(open);

  if (!open) return null;

  return (
    <div className="modal-scrim">
      <div className="modal">
        <div className="modal-head">
          <h3>后台设置</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {!authed ? (
          <div className="modal-body">
            <p className="hint" style={{ marginBottom: 16 }}>修改配置需要管理员登录</p>
            <div className="field">
              <label>用户名</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="field">
              <label>密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                placeholder="请输入密码"
              />
            </div>
            {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}
            <div className="modal-actions">
              <button className="btn-primary" onClick={handleLogin} disabled={loggingIn}>
                {loggingIn ? "登录中…" : "登录"}
              </button>
            </div>
            <div className="forgot-tip">
              忘记密码？在服务器运行 <code>python reset_password.py</code> 重置
            </div>
          </div>
        ) : loading ? (
          <div className="modal-body"><p className="hint">读取中…</p></div>
        ) : mustChange ? (
          <div className="modal-body">
            <div className="msg err" style={{ marginBottom: 16 }}>
              当前账号仍在使用默认密码，存在安全风险。请先修改密码后再使用后台功能。
            </div>
            <div className="pwd-box">
              <div className="field">
                <label>原密码（默认 admin123）</label>
                <input type="password" value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} />
              </div>
              <div className="field">
                <label>新密码（至少 6 位）</label>
                <input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} />
              </div>
              {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}
              <div className="modal-actions">
                <button className="btn-primary" onClick={handleChangePwd}>确认修改</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="modal-body">
            <div className="tabbar">
              <button className={`tab ${tab === "settings" ? "active" : ""}`} onClick={() => switchTab("settings")}>设置</button>
              <button className={`tab ${tab === "logs" ? "active" : ""}`} onClick={() => switchTab("logs")}>日志</button>
              <button className={`tab ${tab === "backups" ? "active" : ""}`} onClick={() => switchTab("backups")}>备份</button>
            </div>

            {tab === "settings" && (
            <>
            <div className="settings-section">
              <div className="settings-section-title">数据源（金山在线文档）</div>

              <div className="readonly-note">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
                </svg>
                <span>系统仅<b>只读</b>同步文档数据，<b>不会修改</b>你的在线文档。</span>
              </div>

              <div className="field">
                <label>① 金山 Webhook 链接</label>
                <input value={webhook} onChange={(e) => setWebhook(e.target.value)}
                  placeholder="https://365.kdocs.cn/api/v3/ide/file/.../sync_task" />
                <p className="hint">
                  决定从<b>哪个在线文档</b>同步数据。更换文档时填这里。
                </p>
              </div>

              <div className="field">
                <label>② 脚本令牌 Token</label>
                <input type="password" value={token} onChange={(e) => setTokenField(e.target.value)}
                  placeholder={tokenSet ? "已配置，留空则不修改" : "请输入 Token"} />
                <p className="hint">访问该文档的密钥。留空表示沿用已保存的，不改动。</p>
              </div>

              <div className="guide">
                <div className="guide-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                  如何更换同步的在线文档？
                </div>
                <ol>
                  <li>在新的金山文档里打开「<b>效率 → AirScript 脚本编辑器</b>」</li>
                  <li>新建文档共享脚本，粘贴读取脚本并运行测试</li>
                  <li>脚本「⋯」菜单 →「<b>复制脚本 webhook</b>」，填到上方 ①</li>
                  <li>编辑器工具栏「<b>脚本令牌</b>」→ 创建令牌，填到上方 ②</li>
                  <li>点下方「<b>测试连接</b>」确认成功后「保存」</li>
                </ol>
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-section-title">同步与显示</div>

              <div className="field toggle-field">
                <div>
                  <label>自动同步</label>
                  <p className="hint">开启后系统按下方间隔自动从文档拉取；关闭则只能手动点「立即同步」。</p>
                </div>
                <button className={`switch ${autoSync ? "on" : ""}`} onClick={() => setAutoSync(!autoSync)} aria-label="自动同步开关">
                  <span className="knob" />
                </button>
              </div>

              <div className="field">
                <label>自动同步间隔</label>
                <div className="select-wrap" style={{ display: "block" }}>
                  <select value={interval} onChange={(e) => setIntervalSec(e.target.value)} disabled={!autoSync} style={{ width: "100%" }}>
                    <option value="60">每 1 分钟</option>
                    <option value="300">每 5 分钟（默认）</option>
                    <option value="600">每 10 分钟</option>
                    <option value="1800">每 30 分钟</option>
                    <option value="3600">每 1 小时</option>
                    <option value="21600">每 6 小时</option>
                    <option value="43200">每 12 小时</option>
                    <option value="86400">每 24 小时</option>
                  </select>
                </div>
                <p className="hint">系统每隔这段时间自动从文档拉取一次最新数据。</p>
              </div>

              <div className="field toggle-field">
                <div>
                  <label>前端脱敏显示</label>
                  <p className="hint">开启后所有访问者只能看到姓名和照片，电话、抖音号、地址、身材、备注等全部打码。</p>
                </div>
                <button className={`switch ${mask ? "on" : ""}`} onClick={() => setMask(!mask)} aria-label="脱敏开关">
                  <span className="knob" />
                </button>
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn-ghost" onClick={handleTest} disabled={testing}>
                {testing ? "测试中…" : "测试连接"}
              </button>
              <button className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? "保存中…" : "保存设置"}
              </button>
            </div>
            </>
            )}

            {tab === "logs" && (
              <div className="settings-section">
                <div className="settings-section-title">系统日志</div>
                <div className="log-toolbar">
                  <div className="select-wrap" style={{ display: "block", flex: 1 }}>
                    <select value={logLevel} onChange={(e) => { setLogLevel(e.target.value); }} style={{ width: "100%" }}>
                      <option value="">全部级别</option>
                      <option value="INFO">INFO</option>
                      <option value="WARNING">WARNING</option>
                      <option value="ERROR">ERROR</option>
                    </select>
                  </div>
                  <button className="btn-ghost" onClick={loadLogs} disabled={logLoading}>
                    {logLoading ? "刷新中…" : "刷新"}
                  </button>
                </div>
                <pre className="log-view">
                  {logLines.length ? logLines.join("\n") : (logLoading ? "读取中…" : "暂无日志")}
                </pre>
                <p className="hint">显示最近 300 行。完整日志在服务器 <code>backend/logs/app.log</code>。</p>
              </div>
            )}

            {tab === "backups" && (
              <div className="settings-section">
                <div className="settings-section-title">数据备份</div>
                <p className="hint" style={{ marginBottom: 12 }}>
                  备份内容为数据库（博主数据、配置、账号）。照片文件请用服务器脚本一并备份。
                </p>
                <div className="modal-actions" style={{ justifyContent: "flex-start", marginBottom: 8 }}>
                  <button className="btn-primary" onClick={handleBackupNow} disabled={backingUp || restoring}>
                    {backingUp ? "备份中…" : "立即备份"}
                  </button>
                  <button className="btn-ghost" onClick={loadBackups} disabled={backupLoading}>刷新</button>
                  <input
                    ref={restoreFileRef}
                    type="file"
                    accept=".gz,application/gzip"
                    style={{ display: "none" }}
                    onChange={onPickRestoreFile}
                  />
                  <button className="btn-ghost" onClick={() => restoreFileRef.current?.click()} disabled={restoring}>
                    上传备份恢复
                  </button>
                </div>
                <div className="restore-warn">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>
                  恢复会<b>覆盖当前全部数据</b>，系统会在恢复前自动做一次快照以便回滚。
                </div>
                <div className="backup-list">
                  {backupLoading ? (
                    <p className="hint">读取中…</p>
                  ) : backups.length === 0 ? (
                    <p className="hint">暂无备份</p>
                  ) : (
                    backups.map((b) => (
                      <div className="backup-row" key={b.name}>
                        <div className="bk-info">
                          <span className="bk-name">{b.name}</span>
                          <span className="bk-meta">{b.created_at.replace("T", " ")} · {fmtSize(b.size)}</span>
                        </div>
                        <div className="bk-actions">
                          <button className="link-btn" onClick={() => setRestoreTarget(b.name)} disabled={restoring}>恢复</button>
                          <button className="link-btn" onClick={() => handleDownloadBackup(b.name)}>下载</button>
                          <button className="link-btn danger" onClick={() => setDelTarget(b.name)}>删除</button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                {restoring && <p className="hint" style={{ marginTop: 10 }}>正在恢复，请勿关闭…</p>}
              </div>
            )}

            {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}

            <div className="settings-footer">
              <button className="link-btn" onClick={() => setShowPwd(!showPwd)}>修改密码</button>
              <button className="link-btn danger" onClick={handleLogout}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
                退出登录
              </button>
            </div>

            {showPwd && (
              <div className="pwd-box">
                <div className="field">
                  <label>原密码</label>
                  <input type="password" value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} />
                </div>
                <div className="field">
                  <label>新密码（至少 6 位）</label>
                  <input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} />
                </div>
                <div className="modal-actions">
                  <button className="btn-primary" onClick={handleChangePwd}>确认修改</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!delTarget}
        title="删除备份"
        message={`确定删除备份「${delTarget}」吗？此操作不可恢复。`}
        confirmText="删除"
        danger
        onConfirm={handleDeleteBackup}
        onCancel={() => setDelTarget("")}
      />

      <ConfirmDialog
        open={!!restoreTarget}
        title="恢复数据库"
        message={`确定用备份「${restoreTarget}」覆盖当前数据库吗？当前数据将被替换（恢复前会自动快照）。`}
        confirmText="确认恢复"
        danger
        onConfirm={handleRestore}
        onCancel={() => setRestoreTarget("")}
      />

      <ConfirmDialog
        open={!!pendingUpload}
        title="上传备份恢复"
        message={`确定用上传的文件「${pendingUpload?.name || ""}」覆盖当前数据库吗？当前数据将被替换（恢复前会自动快照）。`}
        confirmText="确认恢复"
        danger
        onConfirm={handleRestoreUpload}
        onCancel={() => setPendingUpload(null)}
      />
    </div>
  );
}

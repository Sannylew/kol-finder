import axios from "axios";
import type { Kol, KolListResponse, FilterOptions, SyncStatus } from "./types";

const api = axios.create({ baseURL: "" });

// 自动带上登录 token
const TOKEN_KEY = "kol_admin_token";
export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || "";
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}
api.interceptors.request.use((cfg) => {
  const t = getToken();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

// 401（登录过期/失效）：在后台页面下清除 token 并跳转登录
api.interceptors.response.use(
  (resp) => resp,
  (error) => {
    const status = error?.response?.status;
    if (status === 401 && typeof window !== "undefined") {
      const path = window.location.pathname;
      if (path.startsWith("/admin") && path !== "/admin/login") {
        clearToken();
        window.location.assign("/admin/login");
      }
    }
    return Promise.reject(error);
  }
);

export interface ListParams {
  keyword?: string;
  has_contract?: boolean;
  size?: string;
  coop_period?: string;
  company?: string;
  page?: number;
  page_size?: number;
  sort_by?: string;
  order?: string;
}

export async function fetchKols(params: ListParams): Promise<KolListResponse> {
  const clean: Record<string, unknown> = {};
  Object.entries(params).forEach(([k, v]) => {
    if (v !== "" && v !== undefined && v !== null) clean[k] = v;
  });
  const { data } = await api.get<KolListResponse>("/api/kols", { params: clean });
  return data;
}

export async function fetchKol(uid: string): Promise<Kol> {
  const { data } = await api.get<Kol>(`/api/kols/${encodeURIComponent(uid)}`);
  return data;
}

export async function fetchFilterOptions(): Promise<FilterOptions> {
  const { data } = await api.get<FilterOptions>("/api/filter-options");
  return data;
}

export async function fetchSyncStatus(): Promise<SyncStatus> {
  const { data } = await api.get<SyncStatus>("/api/sync/status");
  return data;
}

export async function triggerSync(): Promise<{ inserted: number; updated: number; total: number }> {
  const { data } = await api.post("/api/sync");
  return data;
}

export async function uploadPhoto(uid: string, file: File): Promise<{ photo_url: string }> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post(`/api/kols/${encodeURIComponent(uid)}/photo`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function deletePhoto(uid: string): Promise<void> {
  await api.delete(`/api/kols/${encodeURIComponent(uid)}/photo`);
}

// ---------- 包裹图（每人多张）----------

export interface PackagePhoto {
  id: number;
  url: string;
}

export async function fetchPackagePhotos(uid: string): Promise<PackagePhoto[]> {
  const { data } = await api.get<{ items: PackagePhoto[] }>(
    `/api/kols/${encodeURIComponent(uid)}/package-photos`
  );
  return data.items;
}

export async function uploadPackagePhotos(
  uid: string,
  files: File[]
): Promise<{ added: PackagePhoto[]; errors: { name: string; reason: string }[] }> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  const { data } = await api.post(
    `/api/kols/${encodeURIComponent(uid)}/package-photos`,
    form,
    { headers: { "Content-Type": "multipart/form-data" } }
  );
  return { added: data.added || [], errors: data.errors || [] };
}

export async function deletePackagePhoto(uid: string, id: number): Promise<void> {
  await api.delete(`/api/kols/${encodeURIComponent(uid)}/package-photos/${id}`);
}

// ---------- 文档已移除的博主（软标记 + 手动清理）----------

export interface RemovedKol {
  uid: string;
  name: string;
  phone: string;
  has_photo: boolean;
  pkg_count: number;
}

export async function fetchRemovedKols(): Promise<{ count: number; items: RemovedKol[] }> {
  const { data } = await api.get<{ count: number; items: RemovedKol[] }>("/api/kols/removed");
  return data;
}

export async function fetchRemovedCount(): Promise<number> {
  try {
    const { data } = await api.get<{ count: number }>("/api/kols/removed/count");
    return data.count || 0;
  } catch {
    return 0;
  }
}

export async function deleteKol(uid: string): Promise<void> {
  await api.delete(`/api/kols/${encodeURIComponent(uid)}`);
}

export async function purgeRemovedKols(): Promise<{ deleted: number }> {
  const { data } = await api.post("/api/kols/removed/purge");
  return data;
}

// ---------- 优先级 / 置顶 ----------

export async function setKolPriority(uid: string, priority: number | null): Promise<void> {
  await api.put(`/api/kols/${encodeURIComponent(uid)}/priority`, { priority });
}

export async function pinKol(uid: string): Promise<{ priority: number | null }> {
  const { data } = await api.post(`/api/kols/${encodeURIComponent(uid)}/pin`);
  return data;
}

export async function unpinKol(uid: string): Promise<void> {
  await api.delete(`/api/kols/${encodeURIComponent(uid)}/pin`);
}

// ---------- 同步记录 ----------

export interface SyncLogItem {
  synced_at: string;
  total: number;
  inserted: number;
  updated: number;
  message: string;
}

export async function fetchSyncLogs(limit = 50): Promise<SyncLogItem[]> {
  const { data } = await api.get<{ items: SyncLogItem[] }>("/api/sync-logs", { params: { limit } });
  return data.items;
}

export interface AppSettings {
  kdocs_webhook_url: string;
  kdocs_token: string;
  kdocs_token_set?: boolean;
  sync_interval_seconds: string;
  company_name?: string;
}

export async function fetchSettings(): Promise<AppSettings> {
  const { data } = await api.get<AppSettings>("/api/settings");
  return data;
}

export async function saveSettings(payload: Partial<AppSettings>): Promise<AppSettings> {
  const { data } = await api.put<AppSettings>("/api/settings", payload);
  return data;
}

export async function testConnection(payload: { kdocs_webhook_url?: string; kdocs_token?: string }): Promise<{ ok: boolean; total: number; headers: string[] }> {
  const { data } = await api.post("/api/settings/test", payload);
  return data;
}

export async function login(username: string, password: string): Promise<{ token: string; username: string; must_change_password?: boolean }> {
  const { data } = await api.post("/api/auth/login", { username, password });
  return data;
}

export async function changePassword(old_password: string, new_password: string): Promise<void> {
  await api.post("/api/auth/change-password", { old_password, new_password });
}

export async function fetchPublicConfig(): Promise<{ mask_enabled: boolean; company_name?: string; show_company_on_card?: boolean }> {
  const { data } = await api.get("/api/public-config");
  return data;
}

export interface Stats {
  total: number | null;
  contracted: number | null;
  uncontracted: number | null;
  today_new: number | null;
  week_new: number | null;
  with_photo: number | null;
  masked?: boolean;
}

export async function fetchStats(): Promise<Stats> {
  const { data } = await api.get<Stats>("/api/stats");
  return data;
}

export async function fetchVersion(): Promise<string> {
  try {
    const { data } = await api.get<{ version: string }>("/api/version");
    return data.version || "";
  } catch {
    return "";
  }
}

// ---------- 运维：日志 + 备份 ----------

export interface LogResult {
  lines: string[];
  total: number;
  file: string;
}

export async function fetchLogs(lines = 200, level = ""): Promise<LogResult> {
  const { data } = await api.get<LogResult>("/api/logs", { params: { lines, level: level || undefined } });
  return data;
}

export interface BackupItem {
  name: string;
  size: number;
  created_at: string;
}

export async function fetchBackups(): Promise<BackupItem[]> {
  const { data } = await api.get<{ items: BackupItem[] }>("/api/backups");
  return data.items;
}

export async function createBackup(): Promise<BackupItem> {
  const { data } = await api.post("/api/backups");
  return data;
}

export async function deleteBackup(name: string): Promise<void> {
  await api.delete(`/api/backups/${encodeURIComponent(name)}`);
}

export async function restoreBackup(name: string): Promise<{ restored: string; safety_backup: string }> {
  const { data } = await api.post(`/api/backups/${encodeURIComponent(name)}/restore`);
  return data;
}

export async function restoreUpload(file: File): Promise<{ restored: string; safety_backup: string }> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post("/api/backups/restore-upload", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function downloadBackup(name: string): Promise<void> {
  // 带鉴权头下载，转成 blob 触发浏览器保存
  const resp = await api.get(`/api/backups/${encodeURIComponent(name)}/download`, {
    responseType: "blob",
  });
  const url = window.URL.createObjectURL(resp.data as Blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export interface Kol {
  uid: string;
  seq: number | null;
  group_date: string | null;
  name: string | null;
  phone: string | null;
  has_contract: boolean;
  company: string | null;
  coop_period: string | null;
  shipment: string | null;
  note: string | null;
  size: string | null;
  height: number | null;
  weight: number | null;
  bust: number | null;
  waist: number | null;
  hip: number | null;
  video_status: string | null;
  douyin_id: string | null;
  address: string | null;
  priority: number | null;
  updated_at: string | null;
  photo_url: string | null;
}

export interface KolListResponse {
  items: Kol[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface FilterOptions {
  sizes: string[];
  coop_periods: string[];
  companies: string[];
}

export interface SyncStatus {
  last_sync: {
    synced_at: string;
    total: number;
    inserted: number;
    updated: number;
    message: string;
  } | null;
  interval_seconds: number;
}

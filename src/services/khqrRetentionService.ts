import { supabase } from '../lib/supabase';

/**
 * (21 Nov 2026) KHQR Installation data kept on the server (Settings > Data). The details (each entry, merchant, photos, GPS)
 * are kept for N months (default 6: this month + the 5 before); older months are deleted at night. A Super Admin can change
 * N and delete one month's details now. KPI Performance and the dashboards keep their totals (daily summaries).
 * Database: 20261121_02_khqr_keep_summaries.sql (qr_retention_info / qr_retention_set / qr_delete_month).
 */
export interface KhqrMonth { month: string; entries: number; attempts: number; summaryEntries: number; current: boolean; autoDelete: boolean }
export interface KhqrRetention { keepMonths: number; keepFrom: string; updatedBy: string | null; detailsSize: string; months: KhqrMonth[] }

const missing = (m: string) => /qr_retention|qr_delete_month|PGRST202|does not exist|schema cache/i.test(m);
const SETUP = 'The database needs the update 20261121_02_khqr_keep_summaries.sql first.';

export async function fetchKhqrRetention(): Promise<KhqrRetention> {
  const { data, error } = await supabase.rpc('qr_retention_info');
  if (error) throw new Error(missing(error.message) ? SETUP : error.message);
  const d: any = data || {};
  return {
    keepMonths: Number(d.keep_months) || 6, keepFrom: String(d.keep_from || ''), updatedBy: d.updated_by ?? null, detailsSize: String(d.details_size || ''),
    months: (Array.isArray(d.months) ? d.months : []).map((m: any) => ({
      month: String(m.month), entries: Number(m.entries) || 0, attempts: Number(m.attempts) || 0, summaryEntries: Number(m.summary_entries) || 0,
      current: !!m.current, autoDelete: !!m.auto_delete,
    })),
  };
}
export async function setKhqrKeepMonths(keepMonths: number): Promise<void> {
  const { error } = await supabase.rpc('qr_retention_set', { p: { keep_months: keepMonths } });
  if (error) throw new Error(missing(error.message) ? SETUP : error.message);
}
/** Deletes one month's details in parts (each call removes up to 5,000); onProgress gets the running total. */
export async function deleteKhqrMonth(month: string, onProgress?: (removed: number, remaining: number) => void): Promise<number> {
  let removed = 0;
  for (let i = 0; i < 200; i++) {
    const { data, error } = await supabase.rpc('qr_delete_month', { p: { month, max: 5000 } });
    if (error) throw new Error(missing(error.message) ? SETUP : error.message);
    const r: any = data || {};
    removed += (Number(r.entries_removed) || 0) + (Number(r.attempts_removed) || 0);
    const left = Number(r.remaining) || 0;
    onProgress?.(removed, left);
    if (left <= 0) return removed;
  }
  throw new Error('Stopped after 200 parts - please press Delete again to continue.');
}

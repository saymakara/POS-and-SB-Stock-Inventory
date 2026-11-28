import { supabase } from '../lib/supabase';
import { emitPortalSync, onPortalSync } from './portalSync';

/**
 * KPI Management Level (exempt from mandatory frontline KPI: 0 target, non-mandatory).
 *
 * (28 Nov 2026) Kept in the database (migration 20261128_01: kpi_management_list / kpi_management_set) and set in the
 * Staff Directory (Edit a staff member -> KPI role). Before, the list lived in each browser only, so another computer did
 * not see it. This module keeps the last list in memory (and a small copy on disk for the first paint), refreshes it from
 * the server, and tells the screens through KPI_MANAGEMENT_EXEMPT_EVENT. A browser's old list is copied to the server once
 * by an administrator (see migrateLegacyManagementList).
 */

export interface ManagementExemptStaff {
  staffId: string;
  staffName: string;
  updatedBy?: string | null;
  updatedAt?: string | null;
}

/** The old per-browser list (before 28 Nov 2026): read once, copied to the server, then removed. */
export const KPI_MANAGEMENT_EXEMPT_STORAGE_KEY = 'kpi_management_exempt_staff_v1';
const CACHE_KEY = 'kpi_management_cache_v2';
export const KPI_MANAGEMENT_EXEMPT_EVENT = 'kpi_management_exempt_changed';

const readJson = (key: string): unknown => {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
};
const clean = (x: unknown): ManagementExemptStaff[] =>
  (Array.isArray(x) ? x : [])
    .map((r: any) => ({ staffId: String(r?.staffId ?? r?.staff_id ?? '').trim(), staffName: String(r?.staffName ?? r?.staff_name ?? '').trim(),
      updatedBy: r?.updatedBy ?? r?.updated_by ?? null, updatedAt: r?.updatedAt ?? r?.updated_at ?? null }))
    .filter((r) => r.staffId || r.staffName);

let list: ManagementExemptStaff[] = clean(readJson(CACHE_KEY));
let loadedFromServer = false;
let serverMissing = false;     // the database update is not run yet: keep using the old per-browser list

const publish = (next: ManagementExemptStaff[]) => {
  list = next;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(next.map((s) => ({ staffId: s.staffId, staffName: s.staffName })))); } catch { /* blocked: fine */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(KPI_MANAGEMENT_EXEMPT_EVENT, { detail: next }));
};

const isMissing = (m: string) => /kpi_management|PGRST202|does not exist|schema cache|Could not find the function/i.test(m);
export const MANAGEMENT_SETUP_MSG = 'The database needs the update 20261128_01_sb_maintenance_and_staff_roles.sql first.';

/** The current list (memory). Call loadManagementList() to refresh it from the server. */
export function getManagementExemptStaff(): ManagementExemptStaff[] {
  if (serverMissing) return clean(readJson(KPI_MANAGEMENT_EXEMPT_STORAGE_KEY));
  return list;
}

let inflight: Promise<ManagementExemptStaff[]> | null = null;
/** Refreshes the list from the server (shared request; a list loaded less than 60 s ago is reused unless `force`). */
let loadedAt = 0;
export function loadManagementList(force = false): Promise<ManagementExemptStaff[]> {
  if (!force && loadedFromServer && Date.now() - loadedAt < 60_000) return Promise.resolve(list);
  if (inflight) return inflight;
  inflight = (async () => {
    const { data, error } = await supabase.rpc('kpi_management_list');
    if (error) {
      if (isMissing(error.message)) {
        if (!serverMissing) { serverMissing = true; publish(getManagementExemptStaff()); }
        return getManagementExemptStaff();
      }
      throw new Error(error.message);
    }
    serverMissing = false; loadedFromServer = true; loadedAt = Date.now();
    publish(clean(data));
    return list;
  })().finally(() => { inflight = null; });
  return inflight;
}

/** Admin HQ: switch Management Level on/off for one or more staff (by Staff ID). */
export async function setManagementLevel(items: Array<{ staffId: string; staffName?: string; on: boolean }>): Promise<void> {
  if (!items.length) return;
  const { error } = await supabase.rpc('kpi_management_set', {
    p: { items: items.map((i) => ({ staff_id: i.staffId.trim(), staff_name: (i.staffName || '').trim(), on: i.on })) },
  });
  if (error) throw new Error(isMissing(error.message) ? MANAGEMENT_SETUP_MSG : error.message);
  await loadManagementList(true).catch(() => undefined);
  emitPortalSync(['kpi'], { broadcast: true });
}

/**
 * Copies this browser's old list (kept before 28 Nov 2026) to the server once; only entries with a Staff ID can be copied
 * (names alone are listed back so the administrator can set them in the Staff Directory). The old copy is removed after.
 */
export async function migrateLegacyManagementList(): Promise<{ copied: number; skipped: string[] }> {
  const old = clean(readJson(KPI_MANAGEMENT_EXEMPT_STORAGE_KEY));
  if (!old.length) return { copied: 0, skipped: [] };
  const withId = old.filter((s) => /^[A-Za-z0-9._-]{1,40}$/.test(s.staffId));
  const skipped = old.filter((s) => !withId.includes(s)).map((s) => s.staffName || s.staffId);
  if (withId.length) await setManagementLevel(withId.map((s) => ({ staffId: s.staffId, staffName: s.staffName, on: true })));
  try { localStorage.removeItem(KPI_MANAGEMENT_EXEMPT_STORAGE_KEY); } catch { /* blocked: fine */ }
  return { copied: withId.length, skipped };
}

/** Other admins' changes (realtime / other tabs) refresh the list. */
let watching = false;
export function watchManagementList(): void {
  if (watching) return;
  watching = true;
  onPortalSync(['kpi', 'staff'], () => { void loadManagementList().catch(() => undefined); });   // at most once a minute
}

/**
 * Returns a Set of lower-cased staff IDs and names for O(1) exemption checks.
 */
export function getManagementExemptSet(): Set<string> {
  const set = new Set<string>();
  getManagementExemptStaff().forEach((s) => {
    if (s.staffId) set.add(s.staffId.trim().toLowerCase());
    if (s.staffName) set.add(s.staffName.trim().toLowerCase());
  });
  return set;
}

/**
 * Checks whether a specific staff member is explicitly defined as Management (Exempt).
 */
export function isStaffManagementExempt(
  staffId?: string | null,
  staffName?: string | null,
  exemptSet?: Set<string>
): boolean {
  if (!staffId && !staffName) return false;
  const set = exemptSet || getManagementExemptSet();
  if (staffId && set.has(staffId.trim().toLowerCase())) return true;
  if (staffName && set.has(staffName.trim().toLowerCase())) return true;
  return false;
}

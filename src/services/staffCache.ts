import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { fetchStaffAccounts, type StaffAccount } from './supabaseService';

/**
 * (29 Oct 2026) Staff Directory: instant opening.
 * The list is kept in memory (this browser tab only, never on disk: it holds contact details) and shown at once; the fresh
 * list replaces it quietly. Fetched in the background after sign-in (administrators only). The memory is emptied
 * when the signed-in user changes.
 */
try { sessionStorage.removeItem('staff_accounts_cache_v2'); } catch { /* blocked: fine */ }   // the old copy on disk held contact details
let list: StaffAccount[] | null = null;
let at = 0;                                            // when the list in memory was fetched
let owner: string | null | undefined;
export const clearStaffCache = () => { list = null; at = 0; };
export const getCachedStaff = () => list;
const listeners = new Set<(x: StaffAccount[]) => void>();
export const setCachedStaff = (x: StaffAccount[]) => { list = x; at = Date.now(); listeners.forEach((f) => f(x)); };
/** Called with every fresh list (any screen that shows it stays current without a download of its own). */
export const onStaffList = (f: (x: StaffAccount[]) => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

if (isSupabaseConfigured) {
  try {
    supabase.auth.onAuthStateChange((_e, session) => {
      const id = session?.user?.id ?? null;
      if (owner !== undefined && id !== owner) clearStaffCache();
      owner = id;
    });
  } catch { /* the cache simply stays empty */ }
}

/**
 * (4 Nov 2026) One shared download of the staff list. The sign-in load, the background warm-up and the Staff Directory
 * all asked for it at the same moment, so the whole list was downloaded two or three times. Now they share the request
 * that is already running, and a list fetched less than `maxAgeMs` ago is reused. `maxAgeMs: 0` forces a fresh copy
 * (after a change). Returns null when the list could not be loaded.
 */
let inflight: Promise<StaffAccount[] | null> | null = null;
export function loadStaff(opts: { maxAgeMs?: number } = {}): Promise<StaffAccount[] | null> {
  if (!isSupabaseConfigured) return Promise.resolve(null);
  const maxAge = opts.maxAgeMs ?? 30000;
  if (list && maxAge > 0 && Date.now() - at < maxAge) return Promise.resolve(list);
  if (inflight) return maxAge > 0 ? inflight : inflight.then(() => loadStaff({ maxAgeMs: 0 }));   // a forced copy must start after the change
  inflight = fetchStaffAccounts(1000, 0)
    .then((x) => { if (x) setCachedStaff(x); return x; })
    .catch(() => null)
    .finally(() => { inflight = null; });
  return inflight;
}
export function prefetchStaff(): Promise<void> {
  return loadStaff().then(() => undefined);
}

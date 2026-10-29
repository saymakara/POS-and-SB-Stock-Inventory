import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { fetchStaffAccounts } from './supabaseService';
import type { StaffAccount } from './supabaseService';

/**
 * (29 Oct 2026) Staff Directory: instant opening.
 * The list is kept in memory (this browser tab only, never on disk: it holds contact details) and shown at once; the fresh
 * list replaces it quietly. Fetched in the background after sign-in (administrators only). The memory is emptied
 * when the signed-in user changes.
 */
try { sessionStorage.removeItem('staff_accounts_cache_v2'); } catch { /* blocked: fine */ }   // the old copy on disk held contact details
let list: StaffAccount[] | null = null;
let owner: string | null | undefined;
export const clearStaffCache = () => { list = null; };
export const getCachedStaff = () => list;
export const setCachedStaff = (x: StaffAccount[]) => { list = x; };

if (isSupabaseConfigured) {
  try {
    supabase.auth.onAuthStateChange((_e, session) => {
      const id = session?.user?.id ?? null;
      if (owner !== undefined && id !== owner) clearStaffCache();
      owner = id;
    });
  } catch { /* the cache simply stays empty */ }
}

let inflight: Promise<void> | null = null;
export function prefetchStaff(): Promise<void> {
  if (!isSupabaseConfigured) return Promise.resolve();
  if (inflight) return inflight;
  inflight = fetchStaffAccounts(100, 0)
    .then((x) => { if (x) list = x; })
    .catch(() => {})
    .finally(() => { inflight = null; });
  return inflight;
}

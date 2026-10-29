import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { fetchAuditLogs } from './supabaseService';
import type { ServerAuditEntry } from './supabaseService';

/**
 * (29 Oct 2026) Audit Trail: instant opening.
 * The last pages are kept in memory (this browser tab only, never on disk) and shown at once; the fresh page replaces
 * them quietly. Emptied whenever the signed-in user changes. The first page is fetched in the background after sign-in
 * (administrators only).
 */
const pages = new Map<string, ServerAuditEntry[]>();
let owner: string | null | undefined;
const MAX_KEYS = 12;
const key = (limit: number, offset: number) => `${limit}:${offset}`;

export const clearAuditCache = () => pages.clear();
export const getCachedAudit = (limit: number, offset: number) => pages.get(key(limit, offset));
export function setCachedAudit(limit: number, offset: number, rows: ServerAuditEntry[]): void {
  const k = key(limit, offset);
  pages.delete(k); pages.set(k, rows);
  while (pages.size > MAX_KEYS) pages.delete(pages.keys().next().value as string);
}

if (isSupabaseConfigured) {
  try {
    supabase.auth.onAuthStateChange((_e, session) => {
      const id = session?.user?.id ?? null;
      if (owner !== undefined && id !== owner) clearAuditCache();
      owner = id;
    });
  } catch { /* the cache simply stays empty */ }
}

let inflight: Promise<void> | null = null;
export function prefetchAudit(): Promise<void> {
  if (!isSupabaseConfigured) return Promise.resolve();
  if (inflight) return inflight;
  inflight = fetchAuditLogs(50, 0)
    .then((rows) => { if (rows) setCachedAudit(50, 0, rows); })
    .catch(() => {})
    .finally(() => { inflight = null; });
  return inflight;
}

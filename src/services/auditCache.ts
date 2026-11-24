import { isSupabaseConfigured } from '../lib/supabase';
import { registerPortalCacheInvalidator } from '../utils/portalSync';
import { fetchAuditLogs, type ServerAuditEntry } from './supabaseService';
import { clearOnUserChange, rememberRecent } from '../utils/userScopedCache';

/**
 * (29 Oct 2026) Audit Trail: instant opening.
 * The last pages are kept in memory (this browser tab only, never on disk) and shown at once; the fresh page replaces
 * them quietly. Emptied whenever the signed-in user changes. The first page is fetched in the background after sign-in
 * (administrators only).
 */
const pages = new Map<string, ServerAuditEntry[]>();
const MAX_KEYS = 12;
const key = (limit: number, offset: number) => `${limit}:${offset}`;

let lastPrefetchAt = 0;
export const clearAuditCache = () => { pages.clear(); lastPrefetchAt = 0; };

registerPortalCacheInvalidator(['audit'], clearAuditCache);
export const getCachedAudit = (limit: number, offset: number) => pages.get(key(limit, offset));
export function setCachedAudit(limit: number, offset: number, rows: ServerAuditEntry[]): void {
  rememberRecent(pages, key(limit, offset), rows, MAX_KEYS);
  if (limit === 50 && offset === 0) lastPrefetchAt = Date.now();
}

clearOnUserChange(clearAuditCache);

let inflight: Promise<void> | null = null;
export function prefetchAudit(): Promise<void> {
  if (!isSupabaseConfigured) return Promise.resolve();
  if (pages.has(key(50, 0)) && Date.now() - lastPrefetchAt < 300_000) return Promise.resolve();
  if (inflight) return inflight;
  inflight = fetchAuditLogs(50, 0)
    .then((rows) => { if (rows) setCachedAudit(50, 0, rows); })
    .catch(() => {})
    .finally(() => { inflight = null; });
  return inflight;
}

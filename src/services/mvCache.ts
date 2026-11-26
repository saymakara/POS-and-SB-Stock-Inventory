import { clearFresh, isFresh, markFresh } from '../utils/freshness';
import { registerPortalCacheInvalidator } from '../utils/portalSync';
import { fetchMvVisitSummary, fetchMvVisitsPage, type MvVisit, type MvVisitSummary } from './supabaseService';
import { isSupabaseConfigured } from '../lib/supabase';
import { periodRange } from './khqrCache';
import type { FieldScope } from '../utils/fieldScope';

/**
 * (4 Nov 2026) Merchant Visit: the last answers, kept in memory only (they hold merchant details; never written to disk,
 * emptied on sign-out). Going back to the page shows them at once and the fresh answer replaces them quietly, as on the
 * other review pages (before, the page flashed "Loading" on every visit).
 */
const pages = new Map<string, { rows: MvVisit[]; total: number }>();
const summaries = new Map<string, MvVisitSummary>();
export const getMvPage = (k: string) => pages.get(k);
export const setMvPage = (k: string, v: { rows: MvVisit[]; total: number }) => { if (pages.size > 40) pages.clear(); pages.set(k, v); };
export const getMvSummary = (k: string) => summaries.get(k);
export const setMvSummary = (k: string, v: MvVisitSummary) => { if (summaries.size > 20) summaries.clear(); summaries.set(k, v); };
export function clearMvCache(): void { pages.clear(); summaries.clear(); clearFresh('mv:'); }

// (26 Nov 2026, enterprise data) a change by anyone marks the kept answers out of date instead of throwing them away: the page shows them at once and reads the new ones quietly behind them (stale while revalidate). Before, every change emptied the copy and the next visit showed a loading state.
export function markMvStale(): void { clearFresh('mv:'); }
registerPortalCacheInvalidator(['mv'], markMvStale);   // (26 Nov 2026: not on 'kpi' - every KHQR entry is a KPI change; this page shows visits only)

/** The page key of one Merchant Visit list view (as the page uses it). */
export const mvKey = (r: { from: string | null; to: string | null }, activity: string, region: FieldScope, branchId: string, search: string, page: number, pageSize: number) =>
  JSON.stringify([r.from, r.to, activity, region, branchId, search, page, pageSize]);

/**
 * (25 Nov 2026, speed) The page's first view (this month, all activities, page 1 of 50) and its figures, fetched when the
 * menu entry is pointed at - the same two requests the page makes when it opens, marked as just fetched so the page
 * shows them without asking again. Memory only, as the rest of this cache.
 */
let inflight: Promise<void> | null = null;
export function prefetchMv(): Promise<void> {
  if (!isSupabaseConfigured) return Promise.resolve();
  if (inflight) return inflight;
  const r = periodRange('MONTH');
  const key = mvKey(r, '', 'ALL', '', '', 1, 50);
  const sk = `${r.from}|${r.to}`;
  const needPage = !(pages.has(key) && isFresh('mv:p:' + key));
  const needSum = !(summaries.has(sk) && isFresh('mv:s:' + sk));
  if (!needPage && !needSum) return Promise.resolve();
  inflight = Promise.all([
    needPage ? fetchMvVisitsPage({ from: r.from, to: r.to, activity: undefined, region: 'ALL', branchId: undefined, search: '', page: 1, pageSize: 50 })
      .then((res) => { setMvPage(key, { rows: res.rows, total: res.total }); markFresh('mv:p:' + key); }).catch(() => {}) : null,
    needSum ? fetchMvVisitSummary(r.from, r.to).then((s) => { if (s) { setMvSummary(sk, s); markFresh('mv:s:' + sk); } }).catch(() => {}) : null,
  ]).then(() => undefined).finally(() => { inflight = null; });
  return inflight;
}
/** Runs `fn` now, or - when the page's first view is on its way - once it is here (then from its fresh copy). */
export function afterMvPrefetch(fn: () => unknown): void {
  if (inflight) void inflight.then(() => fn(), () => fn()); else void fn();
}

import { isSupabaseConfigured } from '../lib/supabase';
import { clearFresh, markFresh } from '../utils/freshness';
import { registerPortalCacheInvalidator } from '../utils/portalSync';
import { todayPP } from '../utils/time';
import {
  QrAttempt, QrEntry, QrMonthTotal, QrQuery, QrSharedMid, QrSummary,
  fetchQrAttemptsPage, fetchQrEntriesPage, fetchQrMonthHistory, fetchQrSharedMids, fetchQrSummary,
} from './supabaseService';
import { clearOnUserChange, rememberRecent } from '../utils/userScopedCache';

/**
 * (29 Oct 2026) KHQR screen: instant opening.
 * The last answers are kept in memory (this browser tab only, never saved to disk). Opening the screen shows them at
 * once and refreshes quietly behind them; the same data is fetched in the background right after sign-in.
 * The memory is emptied whenever the signed-in user changes, so one person never sees another person's rows.
 */
export type Period = 'ALL' | 'TODAY' | '7D' | 'MONTH' | 'LAST' | 'BOTH';

/** A period in Phnom Penh time (UTC+7) as ISO: from (inclusive) and to (exclusive, null = now). */
export function periodRange(p: Period): { from: string | null; to: string | null } {
  if (p === 'ALL') return { from: null, to: null };
  const today = todayPP();
  const startOf = (ymd: string) => new Date(`${ymd}T00:00:00+07:00`);
  if (p === 'TODAY') return { from: startOf(today).toISOString(), to: null };
  if (p === '7D') return { from: new Date(startOf(today).getTime() - 6 * 86400000).toISOString(), to: null };
  const [y, m] = today.split('-').map(Number);
  const first = (back: number) => {
    let yy = y, mm = m - back;
    while (mm < 1) { mm += 12; yy -= 1; }
    return startOf(`${yy}-${String(mm).padStart(2, '0')}-01`).toISOString();
  };
  if (p === 'MONTH') return { from: first(0), to: null };
  if (p === 'LAST') return { from: first(1), to: first(0) };
  return { from: first(1), to: null };                                  // BOTH: last month + this month
}

interface EntriesHit { rows: QrEntry[]; total: number }
const MAX_KEYS = 40;
const entries = new Map<string, EntriesHit>();
const summaries = new Map<string, QrSummary>();
const attempts = new Map<string, { rows: QrAttempt[]; total: number }>();
let history: QrMonthTotal[] | null = null;
const shared = new Map<string, QrSharedMid[] | null>();          // (25 Nov 2026: was kept in the page itself)

export function clearKhqrCache(): void { entries.clear(); summaries.clear(); attempts.clear(); shared.clear(); history = null; lastRun = 0; clearFresh('qr:'); }

registerPortalCacheInvalidator(['qr'], clearKhqrCache);

clearOnUserChange(clearKhqrCache);

export const entriesKey = (f: QrQuery, page: number, pageSize: number) =>
  JSON.stringify([f.from || '', f.to || '', f.activity || 'ALL', f.region || 'ALL', f.branchId || '', f.staffId || '', f.search || '', page, pageSize]);
const periodKey = (from: string | null, to: string | null) => `${from || ''}|${to || ''}`;

export const getCachedEntries = (key: string) => entries.get(key);
export function setCachedEntries(key: string, hit: EntriesHit): void {
  rememberRecent(entries, key, hit, MAX_KEYS);
}
export const attemptsKey = (f: { from?: string | null; to?: string | null; activity?: string; region?: string; branchId?: string; staffId?: string; search?: string; kind?: string }, page: number, pageSize: number) =>
  JSON.stringify([f.from || '', f.to || '', f.activity || 'ALL', f.region || 'ALL', f.branchId || '', f.staffId || '', f.search || '', f.kind || 'SUBMIT_BLOCKED', page, pageSize]);
export const getCachedAttempts = (key: string) => attempts.get(key);
export function setCachedAttempts(key: string, hit: { rows: QrAttempt[]; total: number }): void {
  rememberRecent(attempts, key, hit, MAX_KEYS);
}
export const getCachedSummary = (from: string | null, to: string | null) => summaries.get(periodKey(from, to));
export const setCachedSummary = (from: string | null, to: string | null, s: QrSummary) => { summaries.set(periodKey(from, to), s); };
/** Shared MIDs of a period (key `qr:sum:from|to`, as the page uses it). */
export const hasCachedShared = (k: string) => shared.has(k);
export const getCachedShared = (k: string) => shared.get(k);
export const setCachedShared = (k: string, v: QrSharedMid[] | null) => { shared.set(k, v); };
export const getCachedHistory = () => history;
export const setCachedHistory = (h: QrMonthTotal[]) => { history = h; };

/** The default view (this month, all activities, page 1, 50 rows), fetched quietly right after sign-in. */
let inflight: Promise<void> | null = null;
/** (25 Nov 2026) The parts of the background read still on its way: each part of the page waits only for its own. */
type KhqrPart = 'entries' | 'stats' | 'hist';
const parts: Partial<Record<KhqrPart, Promise<unknown>>> = {};
/** Runs `fn` now, or - when that part of the background read is on its way - once it is here (then from its fresh copy). */
export function afterKhqrPrefetch(part: KhqrPart, fn: () => unknown): void {
  const p = parts[part];
  if (p) void p.then(() => fn(), () => fn()); else void fn();
}
let lastRun = 0;
export function prefetchKhqr(): Promise<void> {
  if (!isSupabaseConfigured) return Promise.resolve();
  if (inflight) return inflight;
  if (Date.now() - lastRun < 300_000 && entries.size > 0) return Promise.resolve();
  const { from, to } = periodRange('ALL');
  const f: QrQuery = { from, to, activity: 'ALL', branchId: undefined, staffId: undefined, search: '' };
  // (25 Nov 2026) each answer is marked as just fetched, exactly as the page marks its own: the page opened right after
  // shows it and does not ask again (before, it showed the copy and then fetched the same data a second time)
  const sumKey = `qr:sum:${from}|${to}`;
  const done = (part: KhqrPart, p: Promise<unknown>) => { parts[part] = p; return p.finally(() => { if (parts[part] === p) delete parts[part]; }); };
  inflight = Promise.all([
    done('entries', fetchQrEntriesPage({ ...f, page: 1, pageSize: 50 }).then((r) => { const k = entriesKey(f, 1, 50); setCachedEntries(k, { rows: r.rows, total: r.total }); markFresh('qr:e:' + k); }).catch(() => {})),
    fetchQrAttemptsPage({ from, to, activity: 'ALL', kind: 'SUBMIT_BLOCKED', page: 1, pageSize: 50 }).then((r) => setCachedAttempts(attemptsKey({ from, to, activity: 'ALL', kind: 'SUBMIT_BLOCKED' }, 1, 50), { rows: r.rows, total: r.total })).catch(() => {}),
    done('stats', Promise.all([fetchQrSummary(from, to), fetchQrSharedMids(from, to, 200)]).then(([s, sm]) => {
      setCachedShared(sumKey, sm);
      if (s) { setCachedSummary(from, to, s); markFresh(sumKey); }
    }).catch(() => {})),
    done('hist', fetchQrMonthHistory(1).then((h) => { if (h) { setCachedHistory(h.slice(0, 1)); markFresh('qr:hist'); } }).catch(() => {})),
  ]).then(() => { lastRun = Date.now(); }).finally(() => { inflight = null; });
  return inflight;
}

import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { todayPP } from '../utils/time';
import {
  QrAttempt, QrEntry, QrMonthTotal, QrQuery, QrSummary,
  fetchQrAttemptsPage, fetchQrEntriesPage, fetchQrMonthHistory, fetchQrSummary,
} from './supabaseService';

/**
 * (29 Oct 2026) KHQR screen: instant opening.
 * The last answers are kept in memory (this browser tab only, never saved to disk). Opening the screen shows them at
 * once and refreshes quietly behind them; the same data is fetched in the background right after sign-in.
 * The memory is emptied whenever the signed-in user changes, so one person never sees another person's rows.
 */
export type Period = 'TODAY' | '7D' | 'MONTH' | 'LAST' | 'BOTH';

/** A period in Phnom Penh time (UTC+7) as ISO: from (inclusive) and to (exclusive, null = now). */
export function periodRange(p: Period): { from: string; to: string | null } {
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
let owner: string | null | undefined;

export function clearKhqrCache(): void { entries.clear(); summaries.clear(); attempts.clear(); history = null; }

if (isSupabaseConfigured) {
  try {
    supabase.auth.onAuthStateChange((_e, session) => {
      const id = session?.user?.id ?? null;
      if (owner !== undefined && id !== owner) clearKhqrCache();
      owner = id;
    });
  } catch { /* the cache simply stays empty */ }
}

export const entriesKey = (f: QrQuery, page: number, pageSize: number) =>
  JSON.stringify([f.from || '', f.to || '', f.activity || 'ALL', f.branchId || '', f.staffId || '', f.search || '', page, pageSize]);
const periodKey = (from: string | null, to: string | null) => `${from || ''}|${to || ''}`;

export const getCachedEntries = (key: string) => entries.get(key);
export function setCachedEntries(key: string, hit: EntriesHit): void {
  entries.delete(key); entries.set(key, hit);
  while (entries.size > MAX_KEYS) entries.delete(entries.keys().next().value as string);
}
export const attemptsKey = (f: { from?: string | null; to?: string | null; activity?: string; branchId?: string; staffId?: string; search?: string; kind?: string }, page: number, pageSize: number) =>
  JSON.stringify([f.from || '', f.to || '', f.activity || 'ALL', f.branchId || '', f.staffId || '', f.search || '', f.kind || 'SUBMIT_BLOCKED', page, pageSize]);
export const getCachedAttempts = (key: string) => attempts.get(key);
export function setCachedAttempts(key: string, hit: { rows: QrAttempt[]; total: number }): void {
  attempts.delete(key); attempts.set(key, hit);
  while (attempts.size > MAX_KEYS) attempts.delete(attempts.keys().next().value as string);
}
export const getCachedSummary = (from: string | null, to: string | null) => summaries.get(periodKey(from, to));
export const setCachedSummary = (from: string | null, to: string | null, s: QrSummary) => { summaries.set(periodKey(from, to), s); };
export const getCachedHistory = () => history;
export const setCachedHistory = (h: QrMonthTotal[]) => { history = h; };

/** The default view (this month, all activities, page 1, 50 rows), fetched quietly right after sign-in. */
let inflight: Promise<void> | null = null;
let lastRun = 0;
export function prefetchKhqr(): Promise<void> {
  if (!isSupabaseConfigured) return Promise.resolve();
  if (inflight) return inflight;
  if (Date.now() - lastRun < 30000) return Promise.resolve();
  const { from, to } = periodRange('MONTH');
  const f: QrQuery = { from, to, activity: 'ALL', branchId: undefined, staffId: undefined, search: '' };
  inflight = Promise.all([
    fetchQrEntriesPage({ ...f, page: 1, pageSize: 50 }).then((r) => setCachedEntries(entriesKey(f, 1, 50), { rows: r.rows, total: r.total })).catch(() => {}),
    fetchQrAttemptsPage({ from, to, activity: 'ALL', kind: 'SUBMIT_BLOCKED', page: 1, pageSize: 50 }).then((r) => setCachedAttempts(attemptsKey({ from, to, activity: 'ALL', kind: 'SUBMIT_BLOCKED' }, 1, 50), { rows: r.rows, total: r.total })).catch(() => {}),
    fetchQrSummary(from, to).then((s) => { if (s) setCachedSummary(from, to, s); }).catch(() => {}),
    fetchQrMonthHistory(1).then((h) => { if (h) setCachedHistory(h.slice(0, 1)); }).catch(() => {}),
  ]).then(() => { lastRun = Date.now(); }).finally(() => { inflight = null; });
  return inflight;
}

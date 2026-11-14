import { supabase } from '../lib/supabase';

/**
 * (31 Oct 2026) Phone App Review → Credit Card: entries sent by the Merchant Visit phone app (Apps Script), reviewed by
 * Head Office. Read only through the database functions cc_list / cc_counts (they mask account numbers for branch staff);
 * Confirm / Reject through cc_review (Admin HQ only), which also asks the phone app's bot to reply in the staff group.
 */
export type CcReview = 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'NO_REVIEW';
/** (11 Nov 2026) The list filter: a review status, or WAITING_DOCS (well received, documents not yet at Head Office). */
export type CcFilter = CcReview | 'WAITING_DOCS';
export type CcDocStatus = 'WAITING' | 'RECEIVED' | null;

export interface CcSupplementary { full_name?: string; marital?: string; account?: string; email?: string }
export interface CcHistoryItem { at: string; action: string; by?: string; reason?: string; note?: string; was?: string }
export interface CcEntry {
  id: number;
  recordId: string;
  requestType: string;
  cardStatus: string | null;
  failReason: string | null;
  fullName: string | null;
  contact: string | null;
  marital: string | null;
  primaryAcc: string | null;
  midOrAcc: string | null;
  limitUsd: number | null;
  repayment: string | null;
  email: string | null;
  supplementary: CcSupplementary[];
  remarks: string | null;
  photoCount: number;
  staffId: string;
  staffName: string | null;
  branchText: string | null;
  branchId: string | null;
  submittedAt: string;
  editedAt: string | null;
  reviewStatus: CcReview;
  reviewReason: string | null;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewHistory: CcHistoryItem[];
  notifyState: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | null;
  notifiedAt: string | null;
  telegramLink: string | null;
  /** (11 Nov 2026) Well Received → WAITING for the documents; confirmed later → RECEIVED. */
  docStatus: CcDocStatus;
  docSince: string | null;
  docFollowups: number;
  docLastFollowup: string | null;
}
export interface CcCounts {
  total: number;
  pending: number;
  confirmed: number;
  rejected: number;
  noReview: number;
  cards: number;
  primaryCards?: number;
  suppCards?: number;
  pendingAll: number;
  waitingDocs?: number;
}
export interface CcQuery { from: string | null; to: string | null; review?: CcFilter | ''; branchId?: string; search?: string; page: number; pageSize: number }

const map = (r: any): CcEntry => ({
  id: Number(r.id), recordId: r.record_id, requestType: r.request_type || '', cardStatus: r.card_status ?? null, failReason: r.fail_reason ?? null,
  fullName: r.full_name ?? null, contact: r.contact ?? null, marital: r.marital ?? null, primaryAcc: r.primary_acc ?? null,
  midOrAcc: r.mid_or_acc ?? null, limitUsd: r.limit_usd === null || r.limit_usd === undefined ? null : Number(r.limit_usd),
  repayment: r.repayment ?? null, email: r.email ?? null, supplementary: Array.isArray(r.supplementary) ? r.supplementary : [],
  remarks: r.remarks ?? null, photoCount: Number(r.photo_count) || 0, staffId: r.staff_id || '', staffName: r.staff_name ?? null,
  branchText: r.branch_text ?? null, branchId: r.branch_id ?? null, submittedAt: r.submitted_at, editedAt: r.edited_at ?? null,
  reviewStatus: r.review_status, reviewReason: r.review_reason ?? null, reviewNote: r.review_note ?? null, reviewedBy: r.reviewed_by ?? null,
  reviewedAt: r.reviewed_at ?? null, reviewHistory: Array.isArray(r.review_history) ? r.review_history : [],
  notifyState: r.notify_state ?? null, notifiedAt: r.notified_at ?? null, telegramLink: r.telegram_link ?? null,
  docStatus: r.doc_status === 'WAITING' || r.doc_status === 'RECEIVED' ? r.doc_status : null, docSince: r.doc_since ?? null,
  docFollowups: Number(r.doc_followups) || 0, docLastFollowup: r.doc_last_followup ?? null,
});

/**
 * (4 Nov 2026) Requests for the same answer share one network call, and an answer fetched less than `maxAgeMs` ago is
 * reused: the background warm-up and the page used to ask for the same list and counts at the same moment (2-3 calls each).
 * `maxAgeMs: 0` (Refresh, after a review) always asks the database.
 */
const inflight = new Map<string, Promise<unknown>>();
const born = new Map<string, number>();
function shared<T>(key: string, maxAgeMs: number, cached: () => T | undefined, run: () => Promise<T>): Promise<T> {
  const hit = cached();
  if (hit !== undefined && maxAgeMs > 0 && Date.now() - (born.get(key) || 0) < maxAgeMs) return Promise.resolve(hit);
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running && maxAgeMs > 0) return running;
  const p = run().then((v) => { born.set(key, Date.now()); return v; }).finally(() => { if (inflight.get(key) === p) inflight.delete(key); });
  inflight.set(key, p);
  return p;
}

export function fetchCcList(q: CcQuery, maxAgeMs = 45000): Promise<{ rows: CcEntry[]; total: number; masked: boolean }> {
  const k = ccListKey(q);
  return shared('L' + k, maxAgeMs, () => listCache.get(k), () => fetchCcListNow(q));
}
async function fetchCcListNow(q: CcQuery): Promise<{ rows: CcEntry[]; total: number; masked: boolean }> {
  const { data, error } = await supabase.rpc('cc_list', {
    p_from: q.from, p_to: q.to, p_review: q.review || null, p_branch: q.branchId || null, p_search: q.search || null,
    p_limit: q.pageSize, p_offset: (q.page - 1) * q.pageSize,
  });
  if (error) throw new Error(error.message);
  const d: any = data || {};
  const res = { rows: (Array.isArray(d.rows) ? d.rows : []).map(map), total: Number(d.total) || 0, masked: !!d.masked };
  setCachedCcList(ccListKey(q), res);
  return res;
}

export function fetchCcCounts(from: string | null, to: string | null, maxAgeMs = 45000): Promise<CcCounts | null> {
  const k = `${from || ''}|${to || ''}`;
  return shared('C' + k, maxAgeMs, () => countsCache.get(k), () => fetchCcCountsNow(from, to));
}
async function fetchCcCountsNow(from: string | null, to: string | null): Promise<CcCounts | null> {
  const { data, error } = await supabase.rpc('cc_counts', { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  const d: any = data || {};
  const res: CcCounts = {
    total: Number(d.total) || 0,
    pending: Number(d.pending) || 0,
    confirmed: Number(d.confirmed) || 0,
    rejected: Number(d.rejected) || 0,
    noReview: Number(d.no_review) || 0,
    cards: Number(d.cards) || 0,
    primaryCards: Number(d.primary_cards) || 0,
    suppCards: Number(d.supp_cards) || 0,
    pendingAll: Number(d.pending_all) || 0,
    waitingDocs: d.waiting_docs === undefined ? undefined : Number(d.waiting_docs) || 0,
  };
  setCachedCcCounts(`${from || ''}|${to || ''}`, res);
  return res;
}

/** Confirm, or Reject with a reason (Admin HQ). The bot replies in the staff group under the entry's post. */
export async function reviewCc(recordId: string, action: 'CONFIRM' | 'REJECT', reason?: string, note?: string): Promise<{ reviewedBy: string; reviewedAt: string }> {
  const { data, error } = await supabase.rpc('cc_review', { p_record_id: recordId, p_action: action, p_reason: reason || null, p_note: note || null });
  if (error) throw new Error(error.message);
  clearCcCache();
  const d: any = data || {};
  return { reviewedBy: d.reviewed_by || '', reviewedAt: d.reviewed_at || '' };
}

/** (11 Nov 2026) Well Received (waiting for the documents) or Follow Up (a reminder) - Admin HQ. The bot replies under the
 *  entry's post in the staff group (Merchant Visit 3.99+). */
export async function docsCc(recordId: string, action: 'WELL_RECEIVED' | 'FOLLOW_UP', note?: string): Promise<{ docStatus: CcDocStatus; docSince: string | null; docFollowups: number; docLastFollowup: string | null; by: string; at: string }> {
  const { data, error } = await supabase.rpc('cc_docs', { p_record_id: recordId, p_action: action, p_note: note || null });
  if (error) {
    if (/cc_docs|PGRST202|does not exist|schema cache/i.test(error.message)) throw new Error('The database needs the update 20261111_01_cc_documents.sql first.');
    throw new Error(error.message);
  }
  clearCcCache();
  const d: any = data || {};
  return { docStatus: d.doc_status ?? null, docSince: d.doc_since ?? null, docFollowups: Number(d.doc_followups) || 0, docLastFollowup: d.doc_last_followup ?? null, by: d.by || '', at: d.at || '' };
}

/** (31 Oct 2026, speed) The last answers, kept in memory only (cleared on sign-out): the page opens with them at once and
 *  the fresh answer replaces them quietly. */
const listCache = new Map<string, { rows: CcEntry[]; total: number; masked: boolean }>();
const countsCache = new Map<string, CcCounts>();
export const ccListKey = (q: CcQuery) => JSON.stringify([q.from, q.to, q.review || '', q.branchId || '', q.search || '', q.page, q.pageSize]);
export const getCachedCcList = (k: string) => listCache.get(k);
export const setCachedCcList = (k: string, v: { rows: CcEntry[]; total: number; masked: boolean }) => { if (listCache.size > 40) listCache.clear(); listCache.set(k, v); };
export const getCachedCcCounts = (k: string) => countsCache.get(k);
export const setCachedCcCounts = (k: string, v: CcCounts) => { countsCache.set(k, v); };
export function patchCachedCcEntry(recordId: string, next: Partial<CcEntry>): void {
  listCache.forEach((v, k) => {
    if (v.rows.some((r) => r.recordId === recordId)) {
      listCache.set(k, { ...v, rows: v.rows.map((r) => (r.recordId === recordId ? { ...r, ...next } : r)) });
    }
  });
}
export function clearCcCache(): void { listCache.clear(); countsCache.clear(); born.clear(); lastPrefetch = 0; }

/** Warms the default Credit Card view (all time, all entries, page 1) and counts in the background so opening the tab is 0ms. */
let inflightPrefetch: Promise<CcCounts | null> | null = null;
let lastPrefetch = 0;
export function prefetchCc(force = false): Promise<CcCounts | null> {
  if (inflightPrefetch) return inflightPrefetch;
  if (!force && Date.now() - lastPrefetch < 25000 && countsCache.has('|')) {
    return Promise.resolve(countsCache.get('|') || null);
  }
  const q: CcQuery = { from: null, to: null, review: '', branchId: '', search: '', page: 1, pageSize: 50 };
  inflightPrefetch = Promise.all([
    fetchCcCounts(null, null, force ? 0 : 4000).catch(() => null),
    fetchCcList(q, force ? 0 : 4000).catch(() => null),
  ]).then(([c]) => {
    lastPrefetch = Date.now();
    return c;
  }).finally(() => {
    inflightPrefetch = null;
  });
  return inflightPrefetch;
}

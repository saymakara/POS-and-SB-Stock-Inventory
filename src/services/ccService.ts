import { supabase } from '../lib/supabase';

/**
 * (31 Oct 2026) Phone App Review → Credit Card: entries sent by the Merchant Visit phone app (Apps Script), reviewed by
 * Head Office. Read only through the database functions cc_list / cc_counts (they mask account numbers for branch staff);
 * Confirm / Reject through cc_review (Admin HQ only), which also asks the phone app's bot to reply in the staff group.
 */
export type CcReview = 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'NO_REVIEW';

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
}
export interface CcCounts { total: number; pending: number; confirmed: number; rejected: number; noReview: number; cards: number; pendingAll: number }
export interface CcQuery { from: string | null; to: string | null; review?: CcReview | ''; branchId?: string; search?: string; page: number; pageSize: number }

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
});

export async function fetchCcList(q: CcQuery): Promise<{ rows: CcEntry[]; total: number; masked: boolean }> {
  const { data, error } = await supabase.rpc('cc_list', {
    p_from: q.from, p_to: q.to, p_review: q.review || null, p_branch: q.branchId || null, p_search: q.search || null,
    p_limit: q.pageSize, p_offset: (q.page - 1) * q.pageSize,
  });
  if (error) throw new Error(error.message);
  const d: any = data || {};
  return { rows: (Array.isArray(d.rows) ? d.rows : []).map(map), total: Number(d.total) || 0, masked: !!d.masked };
}

export async function fetchCcCounts(from: string | null, to: string | null): Promise<CcCounts | null> {
  const { data, error } = await supabase.rpc('cc_counts', { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  const d: any = data || {};
  return { total: Number(d.total) || 0, pending: Number(d.pending) || 0, confirmed: Number(d.confirmed) || 0, rejected: Number(d.rejected) || 0,
    noReview: Number(d.no_review) || 0, cards: Number(d.cards) || 0, pendingAll: Number(d.pending_all) || 0 };
}

/** Confirm, or Reject with a reason (Admin HQ). The bot replies in the staff group under the entry's post. */
export async function reviewCc(recordId: string, action: 'CONFIRM' | 'REJECT', reason?: string, note?: string): Promise<{ reviewedBy: string; reviewedAt: string }> {
  const { data, error } = await supabase.rpc('cc_review', { p_record_id: recordId, p_action: action, p_reason: reason || null, p_note: note || null });
  if (error) throw new Error(error.message);
  const d: any = data || {};
  return { reviewedBy: d.reviewed_by || '', reviewedAt: d.reviewed_at || '' };
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
export function clearCcCache(): void { listCache.clear(); countsCache.clear(); }

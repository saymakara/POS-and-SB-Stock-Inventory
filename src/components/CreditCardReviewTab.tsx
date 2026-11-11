import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CreditCard, Search, RefreshCw, Loader2, ChevronDown, CheckCircle2, XCircle, Clock, MinusCircle, Send, ExternalLink, Users, Pencil, PencilLine, Trash2, Inbox, BellRing } from 'lucide-react';
import { Branch, UserRole } from '../types';
import { Pager } from './Pager';
import { ClearFiltersButton } from './ClearFiltersButton';
import { ExportCsvButton } from './ExportCsvButton';
import { downloadCsv, collectAll, csvTime } from '../utils/exportCsv';
import { usePager } from '../utils/usePager';
import { stampPP } from '../utils/time';
import { Period, periodRange } from '../services/khqrCache';
import { CcCounts, CcEntry, CcFilter, CcReview, docsCc, fetchCcCounts, fetchCcList, reviewCc, ccListKey, getCachedCcList, setCachedCcList, getCachedCcCounts, setCachedCcCounts, patchCachedCcEntry, clearCcCache } from '../services/ccService';
import { deletePhoneRecords } from '../services/supabaseService';
import { DeleteRecordsDialog, NoCell, SelectBox, useRecordSelection } from './DeleteRecordsDialog';
import { CopyableRecordId } from './CopyableRecordId';
import { PhoneRecordEditDialog, EditField } from './PhoneRecordEditDialog';

const SPRING = { type: 'spring', stiffness: 500, damping: 32, mass: 0.55 } as const;

/**
 * Phone App Review → Credit Card (31 Oct 2026).
 * Credit Card entries sent by staff from the Merchant Visit phone app. Kept forever (never deleted like KHQR) and shown in full when opened.
 * Head Office reviews every successful onboarding: Confirm, or Reject with a reason (e.g. adverse CBC record); Admin HQ can change a decision later.
 * The bot replies in the staff group under the entry's own post. "Cards onboarded" counts confirmed entries only. A failed onboarding needs no review.
 * Admins see full account numbers; branch staff see their own branch only, with account numbers masked (****1234), and cannot review.
 */
type CcPeriod = 'ALL' | Period;
const PERIOD_LABEL: Record<CcPeriod, string> = { ALL: 'All time', TODAY: 'Today', '7D': 'Last 7 days', MONTH: 'This month', LAST: 'Last month', BOTH: 'Last 2 months' };
const ccPeriodRange = (p: CcPeriod): { from: string | null; to: string | null } => (p === 'ALL' ? { from: null, to: null } : periodRange(p));
const REVIEW_TABS: {
  v: CcFilter | '';
  label: string;
  Icon: React.ElementType;
  accentColor: string;
  badgeTone: string;
}[] = [
  { v: '', label: 'All', Icon: CreditCard, accentColor: 'text-[#003857]', badgeTone: 'bg-slate-100 text-slate-800 border-slate-200' },
  { v: 'PENDING', label: 'Waiting review', Icon: Clock, accentColor: 'text-amber-500', badgeTone: 'bg-amber-50 text-amber-700 border-amber-200' },
  { v: 'WAITING_DOCS', label: 'Waiting documents', Icon: Inbox, accentColor: 'text-sky-600', badgeTone: 'bg-sky-50 text-sky-700 border-sky-200' },   // (11 Nov 2026)
  { v: 'CONFIRMED', label: 'Confirmed', Icon: CheckCircle2, accentColor: 'text-emerald-600', badgeTone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { v: 'REJECTED', label: 'Rejected', Icon: XCircle, accentColor: 'text-rose-600', badgeTone: 'bg-rose-50 text-rose-700 border-rose-200' },
  { v: 'NO_REVIEW', label: 'Not onboarded', Icon: MinusCircle, accentColor: 'text-slate-400', badgeTone: 'bg-slate-100 text-slate-600 border-slate-200' },
];
export const CC_REJECT_REASONS = ['Adverse CBC record', 'Incorrect account number', 'Customer details do not match ID',
  'Missing or unclear documents', 'Credit limit not approved', 'Other'];
const GRID = 'grid items-center gap-x-4 grid-cols-[68px_165px_minmax(185px,1fr)_110px_120px_minmax(205px,1.25fr)_145px_24px]';
const fmt = (iso: string | null) => (iso ? stampPP(new Date(iso)) : '—');
const NF_USD = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const usd = (n: number | null) => (n === null ? '—' : `USD ${NF_USD.format(n)}`);
const isMissing = (msg: string) => /cc_list|cc_counts|PGRST20[25]|does not exist|schema cache/i.test(msg);

const STATUS_UI: Record<CcReview, { label: string; cls: string; Icon: React.ElementType }> = {
  PENDING: { label: 'Waiting review', cls: 'chip chip-amber', Icon: Clock },
  CONFIRMED: { label: 'Confirmed', cls: 'chip chip-green', Icon: CheckCircle2 },
  REJECTED: { label: 'Rejected', cls: 'chip chip-red', Icon: XCircle },
  NO_REVIEW: { label: 'Not onboarded', cls: 'chip chip-slate', Icon: MinusCircle },
};

interface Props { role: UserRole; branches: Branch[]; triggerToast: (msg: string) => void; onPendingChange?: (n: number) => void }

export const CreditCardReviewTab: React.FC<Props> = ({ role, branches, triggerToast, onPendingChange }) => {
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const isSuper = role === 'SUPER_ADMIN';                            // (4 Nov 2026) only a Super Admin deletes
  const pick = useRecordSelection();
  const [delOpen, setDelOpen] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  const [period, setPeriod] = useState<CcPeriod>('ALL');
  const [review, setReview] = useState<CcFilter | ''>('');
  const [branchId, setBranchId] = useState('');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [search, setSearch] = useState('');
  useEffect(() => { const t = setTimeout(() => setSearch(deferredQuery.trim()), 350); return () => clearTimeout(t); }, [deferredQuery]);

  const [first] = useState(() => getCachedCcList(ccListKey({ from: null, to: null, review: '', branchId: '', search: '', page: 1, pageSize: 50 })));
  const [rows, setRows] = useState<CcEntry[] | null>(first ? first.rows : null);
  const [total, setTotal] = useState(first ? first.total : 0);
  const [masked, setMasked] = useState(first ? first.masked : !isAdmin);
  const [counts, setCounts] = useState<CcCounts | null>(() => getCachedCcCounts('|') || null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<CcEntry | null>(null);   // (7 Nov 2026) Edit details

  const range = useMemo(() => ccPeriodRange(period), [period]);
  const pg = usePager(total, [range.from, range.to, review, branchId, search]);

  const cSeq = useRef(0);
  const loadCounts = useCallback(async (fresh = false) => {
    const seq = ++cSeq.current;
    const ck = `${range.from || ''}|${range.to || ''}`;
    const hitC = getCachedCcCounts(ck);
    if (hitC) setCounts(hitC);                                         // shown at once; the fresh numbers replace them
    try {
      const c = await fetchCcCounts(range.from, range.to, fresh ? 0 : 30000);
      if (seq !== cSeq.current || !c) return;
      setCachedCcCounts(ck, c);
      setCounts(c);
      onPendingChange?.(c.pendingAll);
    } catch { /* the list shows the error */ }
  }, [range.from, range.to, onPendingChange]);
  useEffect(() => { loadCounts(); }, [loadCounts]);

  const seqRef = useRef(0);
  const load = useCallback(async (fresh = false) => {
    const seq = ++seqRef.current;
    const q = { from: range.from, to: range.to, review, branchId, search, page: pg.page, pageSize: pg.pageSize };
    const key = ccListKey(q);
    let hit = getCachedCcList(key);
    // Instant client-side derivation from the cached "All" list when switching status tabs on page 1
    if (!hit && review && pg.page === 1) {
      const allHit = getCachedCcList(ccListKey({ ...q, review: '' }));
      if (allHit && allHit.rows.length === allHit.total) {
        const filtered = allHit.rows.filter((r) => r.reviewStatus === review);
        hit = { rows: filtered, total: filtered.length, masked: allHit.masked };
      }
    }
    if (hit) { setRows(hit.rows); setTotal(hit.total); setMasked(hit.masked); }   // the last answer at once (no waiting)
    setLoading(!hit);
    try {
      const res = await fetchCcList(q, fresh ? 0 : 30000);   // an answer from the last 30 s (sign-in warm-up, last visit) is reused
      if (seq !== seqRef.current) return;
      setCachedCcList(key, res);
      setRows(res.rows); setTotal(res.total); setMasked(res.masked); setLoadError('');
    } catch (e) {
      if (seq !== seqRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(isMissing(msg) ? 'SETUP' : msg);
      setRows((r) => r || []);
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [range.from, range.to, review, branchId, search, pg.page, pg.pageSize]);
  useEffect(() => { load(); }, [load]);

  const refresh = () => { load(true); loadCounts(true); };
  const filtersActive = period !== 'ALL' || review !== '' || !!branchId || !!query;
  const clearAll = () => { setPeriod('ALL'); setReview(''); setBranchId(''); setQuery(''); setSearch(''); };
  // (31 Oct 2026) Export CSV: every entry that matches the filters (all pages). Branch staff get masked account numbers.
  const exportCsv = async () => {
    const rows = await collectAll((page) => fetchCcList({ from: range.from, to: range.to, review, branchId, search, page, pageSize: 200 }, 0).then((r) => ({ rows: r.rows, total: r.total })), 200);
    if (!rows.length) return 0;
    const label: Record<CcFilter, string> = { PENDING: 'Waiting review', WAITING_DOCS: 'Waiting documents', CONFIRMED: 'Confirmed', REJECTED: 'Rejected', NO_REVIEW: 'Not onboarded' };
    downloadCsv(`Credit_Card_${review ? label[review].replace(/\s+/g, '_') : 'All'}_${PERIOD_LABEL[period].replace(/\s+/g, '_')}`,
      ['Record ID', 'Date Sent', 'Edited At', 'Request Type', 'Card Status', 'Failure Reason', 'Full Name', 'Contact Number', 'Status of Marriage',
        'Account Number', 'MID or Acc Number', 'Limit (USD)', 'Repayment', 'Email', 'Supplementary Cards', 'Supplementary Details', 'Cards Requested', 'Confirmed Cards Onboarded',
        'Remarks', 'Photos', 'Staff ID', 'Staff Name', 'Branch', 'Branch Code', 'Review', 'Reject Reason', 'Review Note', 'Reviewed By', 'Reviewed At', 'Telegram Reply',
        'Documents', 'Well Received At', 'Follow-ups', 'Last Follow-up'],
      rows.map((e) => [e.recordId, csvTime(e.submittedAt), csvTime(e.editedAt), e.requestType, e.cardStatus, e.failReason, e.fullName, e.contact, e.marital,
        e.primaryAcc, e.midOrAcc, e.limitUsd, e.repayment, e.email, e.supplementary.length,
        e.supplementary.map((x, i) => `${i + 1}. ${x.full_name || ''} · ${x.marital || ''} · ${x.account || ''}${x.email ? ' · ' + x.email : ''}`).join(' | '),
        (e.requestType === 'Add Supplementary Only' ? 0 : e.cardStatus === 'Onboarded Successfully' ? 1 : 0) + e.supplementary.length,
        e.reviewStatus === 'CONFIRMED' ? ((e.requestType === 'Add Supplementary Only' ? 0 : 1) + e.supplementary.length) : 0,
        e.remarks, e.photoCount, e.staffId, e.staffName, e.branchText, e.branchId, label[e.reviewStatus], e.reviewReason, e.reviewNote, e.reviewedBy,
        csvTime(e.reviewedAt), e.notifyState === 'SENT' ? 'Posted' : e.notifyState === 'FAILED' ? 'Not posted' : e.notifyState ? 'Posting' : '',
        e.docStatus === 'WAITING' ? 'Waiting' : e.docStatus === 'RECEIVED' ? 'Received' : '', csvTime(e.docSince), e.docFollowups || '', csvTime(e.docLastFollowup)]));
    return rows.length;
  };
  const onReviewed = (recordId: string, next: Partial<CcEntry>) => {
    patchCachedCcEntry(recordId, next);
    setRows((rs) => (rs || []).map((r) => (r.recordId === recordId ? { ...r, ...next } : r)));
    loadCounts(true);
    window.setTimeout(() => { load(true); }, 4500);
    window.setTimeout(() => { load(true); }, 9500);
  };

  const branchOptions = useMemo(() => branches.filter((b) => b.id !== '100').sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true })), [branches]);

  const tabCount = (v: CcFilter | ''): number | undefined => {
    if (!counts) return undefined;
    if (v === '') return counts.total;
    if (v === 'PENDING') return counts.pending;
    if (v === 'WAITING_DOCS') return counts.waitingDocs;
    if (v === 'CONFIRMED') return counts.confirmed;
    if (v === 'REJECTED') return counts.rejected;
    return counts.noReview;
  };

  return (
    <div className="flex flex-col gap-4 apple-tab-panel" aria-label="Credit Card review">
      {/* Hero Header & 5 KPI Cards (Push Configuring Hub Backdrop Style) */}
      <section className="relative overflow-hidden rounded-3xl p-6 sm:p-8 border shadow-sm bg-slate-100 border-slate-200/90 text-slate-900" aria-label="Credit Card review">
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2 max-w-3xl">
            <h1 className="text-2xl sm:text-3xl lg:text-[32px] font-extrabold tracking-tight flex items-center gap-3 text-slate-900 leading-tight">
              <CreditCard className="w-7 h-7 sm:w-8 sm:h-8 shrink-0 text-[#003857]" aria-hidden />
              <span>Credit Card</span>
            </h1>
            <p className="text-sm sm:text-base leading-relaxed text-slate-600">
              {isAdmin ? 'Check each successful onboarding, then Confirm or Reject. The bot replies in the staff group under the entry.' : 'Credit Card entries of your branch and their review result.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <select aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value as CcPeriod)}
              className="px-3 py-2 rounded-xl text-xs sm:text-sm font-normal border bg-white hover:bg-slate-50 text-slate-700 border-slate-200/90 shadow-2xs outline-none cursor-pointer">
              {(Object.keys(PERIOD_LABEL) as CcPeriod[]).map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}
            </select>
            <ExportCsvButton onExport={exportCsv} toast={triggerToast} />
            <button type="button" onClick={refresh} aria-label="Refresh" title="Refresh"
              className="group relative inline-flex items-center gap-2 px-3.5 py-2 rounded-xl active:scale-[0.98] transition-all font-semibold text-xs sm:text-sm border shadow-2xs cursor-pointer bg-white hover:bg-slate-50 text-slate-700 border-slate-200/90" data-allow-repeat>
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-600" /> : <RefreshCw className="w-3.5 h-3.5 text-slate-600 group-hover:rotate-180 transition-transform duration-300" />}
              <span>Sync Review</span>
            </button>
          </div>
        </div>
        {loadError === 'SETUP' ? (
          <div className="py-6 text-center text-sm text-slate-600 mt-6 pt-6 border-t border-slate-200/90">
            <CreditCard className="w-6 h-6 mx-auto mb-2 text-slate-400" />
            The Credit Card tables are not set up in the database yet. Apply the migration <span className="font-mono text-xs">20261031_11_credit_card_review.sql</span>, then refresh.
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mt-6 pt-6 border-t border-slate-200/90" aria-label="Credit Card statistics">
            <Kpi label="Waiting review" value={counts?.pending} sub={counts?.waitingDocs ? `Onboarded · ${counts.waitingDocs} waiting documents` : 'Onboarded · to confirm'} tone="amber" Icon={Clock} onClick={() => setReview('PENDING')} active={review === 'PENDING'} />
            <Kpi label="Confirmed" value={counts?.confirmed} sub="Checked by Head Office" tone="emerald" Icon={CheckCircle2} onClick={() => setReview('CONFIRMED')} active={review === 'CONFIRMED'} />
            <Kpi label="Rejected" value={counts?.rejected} sub="Returned with a reason" tone="rose" Icon={XCircle} onClick={() => setReview('REJECTED')} active={review === 'REJECTED'} />
            <Kpi label="Not onboarded" value={counts?.noReview} sub="Onboarding failed · no review" tone="slate" Icon={MinusCircle} onClick={() => setReview('NO_REVIEW')} active={review === 'NO_REVIEW'} />
            <Kpi
              label="Cards onboarded"
              value={counts?.cards}
              sub={counts && (counts.primaryCards !== undefined || counts.suppCards !== undefined)
                ? `Confirmed · ${counts.primaryCards ?? 0} primary + ${counts.suppCards ?? 0} supp.`
                : 'Confirmed by Head Office · primary + supplementary'}
              tone="blue"
              Icon={Users}
              onClick={() => setReview('CONFIRMED')}
              active={review === 'CONFIRMED'}
            />
          </div>
        )}
      </section>

      {loadError !== 'SETUP' && (<>
        <section className="bg-white rounded-2xl border border-slate-200 px-4 py-3 shadow-2xs" aria-label="Filters">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-100/90 border border-slate-200/90" role="tablist" aria-label="Review status">
              {REVIEW_TABS.map((t) => {
                const active = review === t.v;
                const n = tabCount(t.v);
                const Icon = t.Icon;
                return (
                  <button
                    key={t.label}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setReview(t.v)}
                    className={`relative px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all duration-200 inline-flex items-center gap-2 border select-none ${
                      active
                        ? 'border-transparent text-white'
                        : 'bg-white border-slate-200/90 text-slate-800 hover:border-slate-300 hover:bg-slate-50 shadow-2xs'
                    }`}
                  >
                    {active && (
                      <motion.div
                        layoutId="cc-review-pill"
                        className="absolute -inset-[1px] rounded-lg tab-active-blue border border-sky-400/40 shadow-xs z-0 pointer-events-none"
                        transition={SPRING}
                      />
                    )}
                    <Icon
                      className={`w-3.5 h-3.5 shrink-0 relative z-10 transition-colors duration-200 ${
                        active ? 'text-white' : t.accentColor
                      }`}
                      aria-hidden
                    />
                    <span className="relative z-10 whitespace-nowrap">{t.label}</span>
                    {n !== undefined && (
                      <span
                        className={`font-figure tabular-nums text-[10.5px] font-extrabold px-1.5 py-0.2 rounded relative z-10 border transition-colors duration-200 ${
                          active
                            ? 'bg-white/15 text-white border-white/20'
                            : t.badgeTone
                        }`}
                      >
                        {n.toLocaleString()}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {isAdmin && (
              <select aria-label="Branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} className="text-xs rounded-xl border border-slate-200 bg-white px-2.5 py-2 cursor-pointer max-w-[220px]">
                <option value="">All branches</option>
                <option value="100">Code 100 · Head Office</option>
                {branchOptions.map((b) => <option key={b.id} value={b.id}>Code {b.id} · {b.name}</option>)}
              </select>
            )}
            <div className="relative w-64 sm:w-72 lg:w-80 shrink-0">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden />
              <input aria-label="Search credit card entries" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder={isAdmin ? 'Search Record ID, customer, staff, phone or account' : 'Search Record ID, customer, staff or phone'}
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-white placeholder:text-slate-400 outline-none focus:border-slate-400 shadow-2xs" />
            </div>
            <ClearFiltersButton active={filtersActive} onClear={clearAll} />

            {/* Inline Selection Actions — Keeps table frame completely stable with 0px layout shift */}
            {isSuper && pick.sel.size > 0 && (
              <div
                className="flex items-center gap-2.5 shrink-0 bg-rose-50/70 border border-rose-200/80 px-3 py-1 rounded-xl transition-all ml-auto"
                aria-label="Selected records"
              >
                <span className="font-mono text-xs font-semibold text-rose-900">
                  {pick.sel.size.toLocaleString()} Selected
                </span>
                <span className="text-slate-300 text-xs">|</span>
                <button
                  type="button"
                  onClick={pick.clear}
                  className="text-xs text-slate-600 hover:text-slate-900 underline cursor-pointer"
                >
                  Clear selection
                </button>
                <button
                  type="button"
                  onClick={() => setDelOpen(true)}
                  className="px-3 py-1 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white inline-flex items-center gap-1.5 cursor-pointer shadow-2xs active:scale-[0.98] transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden />
                  Delete {pick.sel.size.toLocaleString()} permanently
                </button>
              </div>
            )}
          </div>
          {masked && <p className="mt-2 text-[11px] text-slate-500">Account numbers are shown masked (last 4 digits). Head Office sees the full numbers.</p>}
        </section>
        <DeleteRecordsDialog open={delOpen} count={pick.sel.size} what="Credit Card entries" sample={Array.from(pick.sel.values())}
          note="Any review reply still waiting to be posted in the staff group is cancelled."
          busy={delBusy} onCancel={() => setDelOpen(false)}
          onConfirm={async (reason) => {
            setDelBusy(true);
            try {
              const res = await deletePhoneRecords('CC', Array.from(pick.sel.keys()), reason);
              pick.clear(); setDelOpen(false); setOpen(null); clearCcCache();
              triggerToast(`${res.deleted} Credit Card entr${res.deleted === 1 ? 'y' : 'ies'} deleted permanently`);
              refresh();
            } catch (err) {
              triggerToast(`Not deleted: ${err instanceof Error ? err.message : String(err)}`);
            } finally { setDelBusy(false); }
          }} />
        <section className="fr-table-frame bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-x-auto overflow-y-hidden" aria-label="Credit Card entries">
          <div className="min-w-[1080px]">
            <div className={`${GRID} glass-table-thead navy-header-bar bg-[#003857] text-white text-[11px] font-bold uppercase tracking-wider px-4 py-2`} role="row">
              {(() => {
                const headerItems = isSuper && (rows || []).length > 0 ? (rows || []).map((x) => ({ id: x.id, rec: x.recordId })) : [];
                const allHeader = headerItems.length > 0 && headerItems.every((i) => pick.sel.has(i.id));
                const toggleHeader = () => pick.setMany(headerItems, !allHeader);
                return (
                  <NoCell
                    header
                    pad="wide"
                    className="font-bold"
                    box={headerItems.length > 0 && <SelectBox light checked={allHeader} onChange={toggleHeader} label={allHeader ? 'Unselect this page' : 'Select this page'} />}
                    onBoxClick={headerItems.length > 0 ? toggleHeader : undefined}
                  >
                    No.
                  </NoCell>
                );
              })()}
              <span>Date Sent</span>
              <span>Customer / Request</span>
              <span className="text-right">Limit</span>
              <span className="text-center">Cards</span>
              <span>Staff / Branch</span>
              <span className="pl-1">Review</span>
              <span />
            </div>
            {loadError && (
              <div className="p-6 text-center text-sm text-rose-700 bg-rose-50/60">
                Could not load the Credit Card entries: {loadError}{' '}
                <button type="button" onClick={() => { load(true); loadCounts(true); }} className="underline cursor-pointer">Try again</button>
              </div>
            )}
            {rows === null && !loadError && (
              <div aria-busy="true" aria-label="Loading">
                {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-[60px] border-b border-slate-100 px-4 flex items-center"><div className="skeleton h-3.5 rounded w-2/3" /></div>)}
              </div>
            )}
            {rows && rows.length === 0 && !loadError && (
              <div className="p-10 text-center text-sm font-semibold text-slate-500">
                {review === 'PENDING' ? 'Nothing is waiting for review.' : 'No Credit Card entries match the current filters.'}
              </div>
            )}
            <div data-page-content className="divide-y divide-slate-200/90">
              {(rows || []).map((e, i) => (
                <CcRow key={e.id} e={e} no={pg.start + i + 1} open={open === e.id} onToggle={() => setOpen((o) => (o === e.id ? null : e.id))}
                  canReview={isAdmin} onReviewed={onReviewed} toast={triggerToast}
                  checked={pick.sel.has(e.id)} onCheck={isSuper ? () => pick.toggle(e.id, e.recordId) : undefined} onEdit={isAdmin ? () => setEditing(e) : undefined} />
              ))}
            </div>
          </div>
          <Pager pg={pg} label="entries" />
        </section>
      </>)}
      {editing && (
        <PhoneRecordEditDialog open={!!editing} source="CC" rowId={editing.id} title={`Edit ${editing.recordId}`}
          sub={`Credit Card · ${editing.requestType} · ${editing.staffName || editing.staffId}`}
          fields={ccEditFields(editing)}
          note="Saved in the portal at once, and written to the same rows of the Merchant Visit Google Sheet (Credit Card tab) within a few minutes. The review decision does not change."
          onClose={() => setEditing(null)} onSaved={() => { clearCcCache(); refresh(); }} triggerToast={triggerToast} />
      )}
    </div>
  );
};

/* (7 Nov 2026) Edit: the customer's details and each supplementary card (cards are corrected, not added or removed). */
export function ccEditFields(e: CcEntry): EditField[] {
  const suppOnly = e.requestType === 'Add Supplementary Only';
  const out: EditField[] = [];
  if (!suppOnly) out.push({ key: 'card_status', label: 'Card status', value: e.cardStatus, options: ['Onboarded Successfully', 'Onboarding Failed'], section: 'Customer' });
  if (!suppOnly && e.cardStatus === 'Onboarding Failed') out.push({ key: 'fail_reason', label: 'Onboarding failure reason', value: e.failReason, section: 'Customer' });
  out.push(
    { key: 'full_name', label: suppOnly ? 'Primary cardholder name' : 'Full name', value: e.fullName, section: 'Customer' },
    { key: 'contact', label: 'Contact number', value: e.contact, numeric: true, section: 'Customer' },
    { key: 'marital', label: 'Status of marriage', value: e.marital, options: ['', 'Single', 'Married', 'Divorced', 'Widowed'], section: 'Customer' },
    { key: 'primary_acc', label: 'Account number', value: e.primaryAcc, numeric: true, section: 'Customer' },
    { key: 'mid_or_acc', label: 'MID or Acc Number', value: e.midOrAcc, numeric: true, section: 'Customer' },
  );
  if (!suppOnly) out.push(
    { key: 'limit_usd', label: 'Limit (USD)', value: e.limitUsd, numeric: true, section: 'Customer' },
    { key: 'repayment', label: 'Repayment', value: e.repayment, options: ['', 'Full Payment 100%', 'Minimum Payment 20%'], section: 'Customer' },
    { key: 'email', label: 'Email', value: e.email, section: 'Customer' },
  );
  e.supplementary.forEach((c, i) => out.push(
    { key: `supp.${i}.full_name`, label: 'Full name', value: c.full_name, section: `Supplementary card ${i + 1}` },
    { key: `supp.${i}.marital`, label: 'Status of marriage', value: c.marital, options: ['', 'Single', 'Married', 'Divorced', 'Widowed'], section: `Supplementary card ${i + 1}` },
    { key: `supp.${i}.account`, label: 'Account number', value: c.account, numeric: true, section: `Supplementary card ${i + 1}` },
    { key: `supp.${i}.email`, label: 'Email', value: c.email, section: `Supplementary card ${i + 1}` },
  ));
  out.push({ key: 'remarks', label: 'Remarks', value: e.remarks, multiline: true, section: 'Remarks' });
  return out;
}

const TONES = {
  amber: 'bg-amber-50 text-amber-600 border-amber-100', emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  rose: 'bg-rose-50 text-rose-600 border-rose-100', slate: 'bg-slate-50 text-slate-500 border-slate-200', blue: 'bg-sky-50 text-sky-600 border-sky-100',
} as const;
const Kpi: React.FC<{ label: string; value?: number; sub: string; tone: keyof typeof TONES; Icon: React.ElementType; onClick: () => void; active: boolean }> = ({ label, value, sub, tone, Icon, onClick, active }) => (
  <button type="button" onClick={onClick} aria-pressed={active}
    className={`text-left p-4 rounded-2xl border bg-white shadow-2xs transition-all cursor-pointer hover:border-slate-300 hover:shadow-md hover:-translate-y-0.5 ${active ? 'border-[#003857] ring-2 ring-sky-100' : 'border-slate-200/90'}`}>
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider truncate">{label}</span>
      <span className={`w-9 h-9 rounded-xl flex items-center justify-center border ${TONES[tone]}`}><Icon className="w-4.5 h-4.5" aria-hidden /></span>
    </div>
    <div className="font-figure text-3xl font-extrabold tabular-nums text-slate-900 my-2">{value === undefined ? '—' : value.toLocaleString()}</div>
    <div className="pt-2 border-t border-slate-100 text-xs text-slate-500 truncate" title={sub}>{sub}</div>
  </button>
);

const StatusChip: React.FC<{ s: CcReview; doc?: CcEntry['docStatus'] }> = ({ s, doc }) => {
  if (s === 'PENDING' && doc === 'WAITING') return <span className="chip chip-sky inline-flex items-center gap-1"><Inbox className="w-3 h-3" aria-hidden />Waiting documents</span>;   // (11 Nov 2026)
  const u = STATUS_UI[s];
  return <span className={`${u.cls} inline-flex items-center gap-1`}><u.Icon className="w-3 h-3" aria-hidden />{u.label}</span>;
};

const Field: React.FC<{ k: string; v: React.ReactNode; mono?: boolean }> = ({ k, v, mono }) => (
  <div className="min-w-0">
    <div className="text-[11px] uppercase tracking-wider text-slate-500">{k}</div>
    <div className={`text-[13px] text-slate-900 break-words ${mono ? 'font-mono' : ''}`}>{v === null || v === undefined || v === '' ? '—' : v}</div>
  </div>
);

const CardCountCell: React.FC<{
  cards: number;
  isRejected?: boolean;
}> = ({ cards, isRejected }) => {
  if (cards <= 0) {
    return <span className="text-slate-300 font-mono text-xs select-none">—</span>;
  }

  return (
    <div className={`inline-flex items-center justify-center ${isRejected ? 'opacity-50' : ''}`}>
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-100/90 border border-slate-200/80 text-slate-600 text-xs tabular-nums font-normal">
        <CreditCard className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden />
        <span>{cards} {cards === 1 ? 'card' : 'cards'}</span>
      </span>
    </div>
  );
};

const CcRow = memo(function CcRow({ e, no, open, onToggle, canReview, onReviewed, toast, checked, onCheck, onEdit }: {
  e: CcEntry; no: number; open: boolean; onToggle: () => void; canReview: boolean;
  onReviewed: (recordId: string, next: Partial<CcEntry>) => void; toast: (m: string) => void; checked?: boolean; onCheck?: () => void; onEdit?: () => void;
}) {
  const supp = e.requestType === 'Add Supplementary Only';
  const cards = (supp ? 0 : e.cardStatus === 'Onboarded Successfully' ? 1 : 0) + e.supplementary.length;
  const [mode, setMode] = useState<'none' | 'reject' | 'change'>('none');
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const act = async (action: 'CONFIRM' | 'REJECT', noteText: string = note) => {
    const finalReason = action === 'REJECT' ? (reason === 'Other' ? other.trim() : reason) : '';
    if (action === 'REJECT' && !finalReason) { toast('Choose or write the reason for rejecting.'); return; }
    setBusy(true);
    try {
      const r = await reviewCc(e.recordId, action, finalReason, noteText.trim());
      const was = e.reviewStatus === 'CONFIRMED' || e.reviewStatus === 'REJECTED' ? e.reviewStatus : null;
      const now = action === 'CONFIRM' ? 'CONFIRMED' : 'REJECTED';
      onReviewed(e.recordId, { reviewStatus: now, reviewReason: finalReason || null, reviewNote: noteText.trim() || null,
        reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt, notifyState: 'PENDING',
        reviewHistory: [...e.reviewHistory, { at: r.reviewedAt, action: now, by: r.reviewedBy, reason: finalReason || undefined, note: noteText.trim() || undefined, was: was || undefined }] });
      toast(`${e.recordId} ${was ? `changed to ${now.toLowerCase()} (was ${was.toLowerCase()})` : now.toLowerCase()} · the reply is being posted in the staff group.`);
      setMode('none');
    } catch (err) {
      toast(`Not saved: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setBusy(false); }
  };

  // (11 Nov 2026) Well Received: waiting for the documents at Head Office · Follow Up: a reminder to the staff member
  const docs = async (action: 'WELL_RECEIVED' | 'FOLLOW_UP') => {
    setBusy(true);
    try {
      const r = await docsCc(e.recordId, action, note.trim());
      onReviewed(e.recordId, { docStatus: r.docStatus, docSince: r.docSince, docFollowups: r.docFollowups, docLastFollowup: r.docLastFollowup, notifyState: 'PENDING',
        reviewHistory: [...e.reviewHistory, { at: r.at, action, by: r.by, note: note.trim() || undefined }] });
      toast(`${e.recordId} ${action === 'WELL_RECEIVED' ? 'well received · waiting for the documents' : `followed up (${r.docFollowups})`} · the reply is being posted in the staff group.`);
      setNote('');
    } catch (err) {
      toast(`Not saved: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setBusy(false); }
  };
  const followSoon = !!e.docLastFollowup && Date.now() - new Date(e.docLastFollowup).getTime() < 10 * 60 * 1000;

  return (
    <div className={checked ? "bg-sky-50/80" : "hover:bg-slate-50/70"}>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            onToggle();
          }
        }}
        aria-expanded={open}
        className={`${GRID} w-full text-left px-4 py-3 text-[13px] text-slate-700 cursor-pointer select-none transition-colors duration-150`}
      >
        <NoCell className="text-slate-500" pad="wide" onBoxClick={onCheck} box={onCheck && <SelectBox checked={!!checked} onChange={onCheck} label={`Select ${e.recordId}`} />}>{no}</NoCell>
        <span className="leading-tight min-w-0">
          <span className="block tabular-nums font-medium text-slate-800">{fmt(e.submittedAt)}</span>
          <CopyableRecordId id={e.recordId} onCopied={(id) => toast(`Copied Record ID: ${id}`)} />
        </span>
        <span className="leading-tight min-w-0 pr-2">
          <span className="block text-slate-800 font-medium truncate uppercase">{e.fullName || '—'}</span>
          <span className="block text-[11px] text-slate-500 truncate mt-0.5">
            {supp ? `Add supplementary · ${e.supplementary.length} card(s)` : e.cardStatus === 'Onboarding Failed' ? `Onboarding failed${e.failReason ? ' · ' + e.failReason : ''}` : `New card${e.supplementary.length ? ` + ${e.supplementary.length} supplementary` : ''}`}
          </span>
        </span>
        <span className="text-right tabular-nums font-medium text-slate-800 text-[13px]">
          {supp ? (
            <span className="text-slate-300 font-mono select-none">—</span>
          ) : e.limitUsd ? (
            usd(e.limitUsd)
          ) : (
            <span className="text-slate-300 font-mono select-none">—</span>
          )}
        </span>
        <span className="text-center">
          <CardCountCell
            cards={cards}
            isRejected={e.reviewStatus === 'REJECTED'}
          />
        </span>
        <span className="leading-tight min-w-0 pr-2">
          <span className="block truncate font-medium text-slate-800">
            {e.staffName || '—'}{e.staffId ? ` (${e.staffId})` : ''}
          </span>
          <span className="block text-[11px] text-slate-500 truncate mt-0.5">
            {e.branchText ? `${e.branchText}${e.branchId ? ` · Code ${e.branchId}` : ''}` : (e.branchId ? `Code ${e.branchId}` : '')}
          </span>
        </span>
        <span className="leading-tight pl-1">
          <StatusChip s={e.reviewStatus} doc={e.docStatus} />
          {e.editedAt && (
            <span className="block text-[10.5px] text-slate-400 mt-1">
              edited {fmt(e.editedAt)}
            </span>
          )}
        </span>
        <div className="flex items-center justify-center">
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180 text-slate-600' : ''}`} aria-hidden />
        </div>
      </div>

      <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="cc-details"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8, transition: { duration: 0.14 } }}
          transition={SPRING}
          className="px-4 pb-4 pt-1 bg-slate-50/60 border-t border-slate-100"
        >
          {onEdit && (
            <div className="flex justify-end pt-2 -mb-1">
              <button type="button" onClick={onEdit} data-testid="edit-record"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer shadow-2xs">
                <PencilLine className="w-3.5 h-3.5" aria-hidden="true" />Edit details
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 py-3">
            <Field k="Record ID" v={<CopyableRecordId id={e.recordId} onCopied={(id) => toast(`Copied Record ID: ${id}`)} variant="badge" />} />
            <Field k="Request type" v={e.requestType} />
            {!supp && <Field k="Card status" v={e.cardStatus} />}
            {e.failReason && <Field k="Failure reason" v={e.failReason} />}
            <Field k={supp ? 'Primary cardholder' : 'Full name'} v={e.fullName ? <span className="uppercase">{e.fullName}</span> : null} />
            {!supp && <Field k="Contact number" v={e.contact} mono />}
            {!supp && <Field k="Status of marriage" v={e.marital} />}
            <Field k={supp ? 'Primary account number' : 'Settlement account'} v={e.primaryAcc} mono />
            {e.midOrAcc && <Field k="MID or account number" v={e.midOrAcc} mono />}
            {!supp && <Field k="Limit offer" v={usd(e.limitUsd)} />}
            {!supp && <Field k="Repayment" v={e.repayment} />}
            {e.email && <Field k="Email" v={e.email} />}
            <Field k="Cards" v={cards} />
            <Field k="Photos" v={e.photoCount ? `${e.photoCount} (in the Telegram group)` : 'None'} />
          </div>
          {e.supplementary.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden mb-3">
              <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200">Supplementary cards</div>
              <table className="w-full text-[12px]">
                <thead><tr className="text-left text-slate-500"><th className="px-3 py-1.5 font-medium">#</th><th className="px-3 py-1.5 font-medium">Full name</th><th className="px-3 py-1.5 font-medium">Status of marriage</th><th className="px-3 py-1.5 font-medium">Account number</th><th className="px-3 py-1.5 font-medium">Email</th></tr></thead>
                <tbody>
                  {e.supplementary.map((s, i) => (
                    <tr key={i} className="border-t border-slate-100"><td className="px-3 py-1.5">{i + 1}</td><td className="px-3 py-1.5 uppercase">{s.full_name || '—'}</td><td className="px-3 py-1.5">{s.marital || '—'}</td><td className="px-3 py-1.5 font-mono">{s.account || '—'}</td><td className="px-3 py-1.5">{s.email || '—'}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {e.remarks && <div className="text-[13px] text-slate-700 mb-3"><span className="text-[11px] uppercase tracking-wider text-slate-500 block">Remarks</span>{e.remarks}</div>}

          {e.reviewStatus !== 'PENDING' && e.reviewStatus !== 'NO_REVIEW' && (
            <div className={`rounded-xl border px-3 py-2 text-[13px] mb-3 ${e.reviewStatus === 'CONFIRMED' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-rose-50 border-rose-200 text-rose-900'}`}>
              <strong>{e.reviewStatus === 'CONFIRMED' ? 'Confirmed' : 'Rejected'}</strong> by {e.reviewedBy || '—'} · {fmt(e.reviewedAt)}
              {e.reviewReason && <> · Reason: {e.reviewReason}</>}{e.reviewNote && <> · Note: {e.reviewNote}</>}
              <span className="block text-[11px] opacity-80 mt-0.5">
                Telegram reply: {e.notifyState === 'SENT' ? `posted ${fmt(e.notifiedAt)}` : e.notifyState === 'FAILED' ? 'could not be posted (tried 5 times)' : 'being posted…'}
              </span>
            </div>
          )}
          {e.reviewStatus === 'PENDING' && e.docStatus === 'WAITING' && (
            <div className="rounded-xl border px-3 py-2 text-[13px] mb-3 bg-sky-50 border-sky-200 text-sky-900">
              <strong>Well received</strong> {fmt(e.docSince)} · waiting for the documents at Head Office
              {e.docFollowups > 0 && <> · followed up {e.docFollowups}× (last {fmt(e.docLastFollowup)})</>}
              <span className="block text-[11px] opacity-80 mt-0.5">Confirm once the documents have arrived and are in order.</span>
            </div>
          )}
          {e.reviewHistory.length > 1 && (
            <div className="text-[12px] text-slate-600 mb-3">
              History: {e.reviewHistory.map((h) => `${h.action === 'RESUBMITTED' ? 'corrected by staff' : h.action === 'WELL_RECEIVED' ? 'well received' : h.action === 'FOLLOW_UP' ? 'followed up' : h.action.toLowerCase()}${h.reason ? ` (${h.reason})` : ''}${h.by && h.action !== 'RESUBMITTED' ? ` by ${h.by}` : ''} ${fmt(h.at)}`).join(' → ')}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {e.telegramLink && (
              <a href={e.telegramLink} target="_blank" rel="noreferrer" className="btn btn-secondary">
                <ExternalLink className="w-3.5 h-3.5" aria-hidden />Open group post
              </a>
            )}
            {canReview && e.reviewStatus === 'PENDING' && mode === 'none' && !e.docStatus && (
              <button type="button" disabled={busy} onClick={() => docs('WELL_RECEIVED')} className="btn btn-secondary"
                title="Acknowledge the onboarding; Head Office now waits for the staff member to bring the documents">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Inbox className="w-3.5 h-3.5" />}Well Received
              </button>
            )}
            {canReview && e.reviewStatus === 'PENDING' && mode === 'none' && e.docStatus === 'WAITING' && (
              <button type="button" disabled={busy || followSoon} onClick={() => docs('FOLLOW_UP')} className="btn btn-secondary"
                title={followSoon ? 'A follow-up was sent less than 10 minutes ago' : 'Remind the staff member in the group to bring the documents'}>
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BellRing className="w-3.5 h-3.5" />}Follow Up{e.docFollowups ? ` (${e.docFollowups})` : ''}
              </button>
            )}
            {canReview && e.reviewStatus === 'PENDING' && mode === 'none' && (<>
              <button type="button" disabled={busy} onClick={() => act('CONFIRM')}
                className="btn btn-primary">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}Confirm
              </button>
              <button type="button" disabled={busy} onClick={() => setMode('reject')}
                className="btn btn-danger">
                <XCircle className="w-3.5 h-3.5" />Reject…
              </button>
            </>)}
            {canReview && (e.reviewStatus === 'CONFIRMED' || e.reviewStatus === 'REJECTED') && mode === 'none' && (
              <button type="button" onClick={() => { setMode('change'); setReason(e.reviewReason && CC_REJECT_REASONS.includes(e.reviewReason) ? e.reviewReason : e.reviewReason ? 'Other' : ''); setOther(e.reviewReason && !CC_REJECT_REASONS.includes(e.reviewReason) ? e.reviewReason : ''); setNote(e.reviewNote || ''); }}
                className="btn btn-secondary">
                <Pencil className="w-3.5 h-3.5" />Change decision
              </button>
            )}
          </div>

          {canReview && mode === 'change' && (
            <div className="mt-3 rounded-xl border border-slate-300 bg-white p-3" aria-label="Change decision">
              <div className="text-[12px] font-semibold text-slate-800 mb-2">
                Change the decision (now {e.reviewStatus === 'CONFIRMED' ? 'Confirmed' : 'Rejected'}). The new decision is posted under the entry in the staff group.
              </div>
              {e.reviewStatus === 'REJECTED' && (
                <button type="button" disabled={busy} onClick={() => act('CONFIRM', '')}
                  className="mb-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-60">
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}Change to Confirmed
                </button>
              )}
              <div className="text-[12px] text-slate-600 mb-1.5">{e.reviewStatus === 'REJECTED' ? 'Or keep it rejected with another reason / note:' : 'Reject instead – reason (shown in the staff group):'}</div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {CC_REJECT_REASONS.map((r) => (
                  <button key={r} type="button" onClick={() => setReason(r)} aria-pressed={reason === r} data-allow-repeat
                    className={`px-2.5 py-1 rounded-lg border text-[12px] cursor-pointer ${reason === r ? 'bg-rose-600 text-white border-rose-600' : 'bg-white border-slate-200 hover:bg-slate-50'}`}>{r}</button>
                ))}
              </div>
              {reason === 'Other' && (
                <input aria-label="Other reason" value={other} onChange={(ev) => setOther(ev.target.value)} maxLength={200} placeholder="Write the reason"
                  className="w-full mb-2 px-3 py-2 text-xs rounded-lg border border-slate-200" />
              )}
              <textarea aria-label="Note to staff" value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={500} rows={2}
                placeholder="Optional note to the staff member" className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200" />
              <div className="flex items-center gap-2 mt-2">
                <button type="button" disabled={busy || !(reason === 'Other' ? other.trim() : reason)} onClick={() => act('REJECT')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50">
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}{e.reviewStatus === 'REJECTED' ? 'Update rejection & reply in group' : 'Change to Rejected & reply in group'}
                </button>
                <button type="button" onClick={() => setMode('none')} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs cursor-pointer">Cancel</button>
              </div>
            </div>
          )}

          {canReview && e.reviewStatus === 'PENDING' && mode === 'reject' && (
            <div className="mt-3 rounded-xl border border-rose-200 bg-white p-3" aria-label="Reject entry">
              <div className="text-[12px] font-semibold text-rose-800 mb-2">Reason for rejecting (shown in the staff group)</div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {CC_REJECT_REASONS.map((r) => (
                  <button key={r} type="button" onClick={() => setReason(r)} aria-pressed={reason === r} data-allow-repeat
                    className={`px-2.5 py-1 rounded-lg border text-[12px] cursor-pointer ${reason === r ? 'bg-rose-600 text-white border-rose-600' : 'bg-white border-slate-200 hover:bg-slate-50'}`}>{r}</button>
                ))}
              </div>
              {reason === 'Other' && (
                <input aria-label="Other reason" value={other} onChange={(ev) => setOther(ev.target.value)} maxLength={200} placeholder="Write the reason"
                  className="w-full mb-2 px-3 py-2 text-xs rounded-lg border border-slate-200" />
              )}
              <textarea aria-label="Note to staff" value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={500} rows={2}
                placeholder="Optional note to the staff member, e.g. what to do next" className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200" />
              <div className="flex items-center gap-2 mt-2">
                <button type="button" disabled={busy || !(reason === 'Other' ? other.trim() : reason)} onClick={() => act('REJECT')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50">
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}Reject &amp; reply in group
                </button>
                <button type="button" onClick={() => setMode('none')} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs cursor-pointer">Cancel</button>
              </div>
            </div>
          )}
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
});

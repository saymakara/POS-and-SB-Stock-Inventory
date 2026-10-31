import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { CreditCard, Search, RefreshCw, Loader2, ChevronDown, CheckCircle2, XCircle, Clock, MinusCircle, Send, ExternalLink, Users, Pencil } from 'lucide-react';
import { Branch, UserRole } from '../types';
import { Pager } from './Pager';
import { ExportCsvButton } from './ExportCsvButton';
import { downloadCsv, collectAll, csvTime } from '../utils/exportCsv';
import { usePager } from '../utils/usePager';
import { stampPP } from '../utils/time';
import { Period, periodRange } from '../services/khqrCache';
import { CcCounts, CcEntry, CcReview, fetchCcCounts, fetchCcList, reviewCc, ccListKey, getCachedCcList, setCachedCcList, getCachedCcCounts, setCachedCcCounts } from '../services/ccService';

/**
 * Phone App Review → Credit Card (31 Oct 2026).
 * Credit Card entries sent by staff from the Merchant Visit phone app. Head Office reviews every successful onboarding:
 * Confirm, or Reject with a reason (e.g. adverse CBC record); Admin HQ can change a decision later. The bot replies in the staff
 * group under the entry's own post. "Cards onboarded" counts confirmed entries only. A failed onboarding needs no review. Admins see full account numbers; branch staff see their own branch only,
 * with account numbers masked (****1234), and cannot review.
 */
const PERIOD_LABEL: Record<Period, string> = { TODAY: 'Today', '7D': 'Last 7 days', MONTH: 'This month', LAST: 'Last month', BOTH: 'Last 2 months' };
const REVIEW_TABS: { v: CcReview | ''; label: string }[] = [
  { v: 'PENDING', label: 'Waiting review' }, { v: 'CONFIRMED', label: 'Confirmed' }, { v: 'REJECTED', label: 'Rejected' },
  { v: 'NO_REVIEW', label: 'Not onboarded' }, { v: '', label: 'All' },
];
export const CC_REJECT_REASONS = ['Adverse CBC record', 'Incorrect account number', 'Customer details do not match ID',
  'Missing or unclear documents', 'Credit limit not approved', 'Other'];
const GRID = 'grid items-center gap-x-3 grid-cols-[40px_140px_minmax(190px,1.3fr)_110px_minmax(170px,1fr)_150px_20px]';
const fmt = (iso: string | null) => (iso ? stampPP(new Date(iso)) : '—');
const usd = (n: number | null) => (n === null ? '—' : `USD ${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`);
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
  const [period, setPeriod] = useState<Period>('MONTH');
  const [review, setReview] = useState<CcReview | ''>(isAdmin ? 'PENDING' : '');
  const [branchId, setBranchId] = useState('');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [search, setSearch] = useState('');
  useEffect(() => { const t = setTimeout(() => setSearch(deferredQuery.trim()), 350); return () => clearTimeout(t); }, [deferredQuery]);

  const [rows, setRows] = useState<CcEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [masked, setMasked] = useState(!isAdmin);
  const [counts, setCounts] = useState<CcCounts | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [open, setOpen] = useState<number | null>(null);

  const range = useMemo(() => periodRange(period), [period]);
  const pg = usePager(total, [range.from, range.to, review, branchId, search]);

  const cSeq = useRef(0);
  const loadCounts = useCallback(async () => {
    const seq = ++cSeq.current;
    const ck = `${range.from}|${range.to}`;
    const hitC = getCachedCcCounts(ck);
    if (hitC) setCounts(hitC);                                         // shown at once; the fresh numbers replace them
    try {
      const c = await fetchCcCounts(range.from, range.to);
      if (seq !== cSeq.current || !c) return;
      setCachedCcCounts(ck, c);
      setCounts(c);
      onPendingChange?.(c.pendingAll);
    } catch { /* the list shows the error */ }
  }, [range.from, range.to, onPendingChange]);
  useEffect(() => { loadCounts(); }, [loadCounts]);

  const seqRef = useRef(0);
  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    const q = { from: range.from, to: range.to, review, branchId, search, page: pg.page, pageSize: pg.pageSize };
    const key = ccListKey(q), hit = getCachedCcList(key);
    if (hit) { setRows(hit.rows); setTotal(hit.total); setMasked(hit.masked); }   // the last answer at once (no waiting)
    setLoading(!hit);
    try {
      const res = await fetchCcList(q);
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

  const refresh = () => { load(); loadCounts(); };
  // (31 Oct 2026) Export CSV: every entry that matches the filters (all pages). Branch staff get masked account numbers.
  const exportCsv = async () => {
    const rows = await collectAll((page) => fetchCcList({ from: range.from, to: range.to, review, branchId, search, page, pageSize: 200 }).then((r) => ({ rows: r.rows, total: r.total })), 200);
    if (!rows.length) return 0;
    const label: Record<CcReview, string> = { PENDING: 'Waiting review', CONFIRMED: 'Confirmed', REJECTED: 'Rejected', NO_REVIEW: 'Not onboarded' };
    downloadCsv(`Credit_Card_${review ? label[review].replace(/\s+/g, '_') : 'All'}_${PERIOD_LABEL[period].replace(/\s+/g, '_')}`,
      ['Record ID', 'Date Sent', 'Edited At', 'Request Type', 'Card Status', 'Failure Reason', 'Full Name', 'Contact Number', 'Status of Marriage',
        'Account Number', 'MID or Acc Number', 'Limit (USD)', 'Repayment', 'Email', 'Supplementary Cards', 'Supplementary Details', 'Cards',
        'Remarks', 'Photos', 'Staff ID', 'Staff Name', 'Branch Code', 'Branch', 'Review', 'Reject Reason', 'Review Note', 'Reviewed By', 'Reviewed At', 'Telegram Reply'],
      rows.map((e) => [e.recordId, csvTime(e.submittedAt), csvTime(e.editedAt), e.requestType, e.cardStatus, e.failReason, e.fullName, e.contact, e.marital,
        e.primaryAcc, e.midOrAcc, e.limitUsd, e.repayment, e.email, e.supplementary.length,
        e.supplementary.map((x, i) => `${i + 1}. ${x.full_name || ''} · ${x.marital || ''} · ${x.account || ''}${x.email ? ' · ' + x.email : ''}`).join(' | '),
        (e.requestType === 'Add Supplementary Only' ? 0 : e.cardStatus === 'Onboarded Successfully' ? 1 : 0) + e.supplementary.length,
        e.remarks, e.photoCount, e.staffId, e.staffName, e.branchId, e.branchText, label[e.reviewStatus], e.reviewReason, e.reviewNote, e.reviewedBy,
        csvTime(e.reviewedAt), e.notifyState === 'SENT' ? 'Posted' : e.notifyState === 'FAILED' ? 'Not posted' : e.notifyState ? 'Posting' : '']));
    return rows.length;
  };
  const onReviewed = (recordId: string, next: Partial<CcEntry>) => {
    setRows((rs) => (rs || []).map((r) => (r.recordId === recordId ? { ...r, ...next } : r)));
    loadCounts();
  };

  const branchOptions = useMemo(() => branches.filter((b) => b.id !== '100').sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true })), [branches]);

  return (
    <div className="flex flex-col gap-4" aria-label="Credit Card review">
      <section className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#003857] text-white flex items-center justify-center"><CreditCard className="w-5 h-5" aria-hidden /></div>
            <div>
              <h2 className="text-[15px] font-semibold text-slate-900">Phone App Review · Credit Card</h2>
              <p className="text-xs text-slate-500">
                {isAdmin ? 'Check each successful onboarding, then Confirm or Reject. The bot replies in the staff group under the entry.' : 'Credit Card entries of your branch and their review result.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value as Period)}
              className="text-xs rounded-xl border border-slate-200 bg-white px-2.5 py-2 cursor-pointer">
              {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}
            </select>
            <ExportCsvButton onExport={exportCsv} toast={triggerToast} />
            <button type="button" onClick={refresh} aria-label="Refresh" title="Refresh"
              className="btn-press p-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 cursor-pointer transition" data-allow-repeat>
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
        {loadError === 'SETUP' ? (
          <div className="py-6 text-center text-sm text-slate-600">
            <CreditCard className="w-6 h-6 mx-auto mb-2 text-slate-400" />
            The Credit Card tables are not set up in the database yet. Apply the migration <span className="font-mono text-xs">20261031_11_credit_card_review.sql</span>, then refresh.
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3" aria-label="Credit Card statistics">
            <Kpi label="Waiting review" value={counts?.pending} sub="Onboarded · to confirm" tone="amber" Icon={Clock} onClick={() => setReview('PENDING')} active={review === 'PENDING'} />
            <Kpi label="Confirmed" value={counts?.confirmed} sub="Checked by Head Office" tone="emerald" Icon={CheckCircle2} onClick={() => setReview('CONFIRMED')} active={review === 'CONFIRMED'} />
            <Kpi label="Rejected" value={counts?.rejected} sub="Returned with a reason" tone="rose" Icon={XCircle} onClick={() => setReview('REJECTED')} active={review === 'REJECTED'} />
            <Kpi label="Not onboarded" value={counts?.noReview} sub="Onboarding failed · no review" tone="slate" Icon={MinusCircle} onClick={() => setReview('NO_REVIEW')} active={review === 'NO_REVIEW'} />
            <Kpi label="Cards onboarded" value={counts?.cards} sub="Confirmed by Head Office · primary + supplementary" tone="blue" Icon={Users} onClick={() => setReview('')} active={review === ''} />
          </div>
        )}
      </section>

      {loadError !== 'SETUP' && (<>
        <section className="bg-white rounded-2xl border border-slate-200 px-4 py-3 shadow-2xs" aria-label="Filters">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex flex-wrap items-center p-1 rounded-xl bg-slate-100/90 border border-slate-200/90 gap-1" role="tablist" aria-label="Review status">
              {REVIEW_TABS.map((t) => (
                <button key={t.label} type="button" role="tab" aria-selected={review === t.v} onClick={() => setReview(t.v)}
                  className={`px-3 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${review === t.v ? 'tab-active-blue text-white font-semibold' : 'text-slate-600 hover:text-slate-900'}`}>
                  {t.label}
                </button>
              ))}
            </div>
            {isAdmin && (
              <select aria-label="Branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} className="text-xs rounded-xl border border-slate-200 bg-white px-2.5 py-2 cursor-pointer max-w-[220px]">
                <option value="">All branches</option>
                <option value="100">Code 100 · Head Office</option>
                {branchOptions.map((b) => <option key={b.id} value={b.id}>Code {b.id} · {b.name}</option>)}
              </select>
            )}
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
              <input aria-label="Search credit card entries" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder={isAdmin ? 'Search Record ID, customer, staff, phone or account' : 'Search Record ID, customer, staff or phone'}
                className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-slate-200 bg-white" />
            </div>
          </div>
          {masked && <p className="mt-2 text-[11px] text-slate-500">Account numbers are shown masked (last 4 digits). Head Office sees the full numbers.</p>}
        </section>

        <section className="fr-table-frame bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-x-auto" aria-label="Credit Card entries">
          <div className="min-w-[960px]">
            <div className={`${GRID} glass-table-thead navy-header-bar bg-[#003857] text-white text-[11px] font-medium uppercase tracking-wider px-3.5 py-3`} role="row">
              <span className="text-right">No.</span>
              <span>Date Sent</span>
              <span>Customer / Request</span>
              <span className="text-right">Limit</span>
              <span>Staff / Branch</span>
              <span>Review</span>
              <span />
            </div>
            {loadError && (
              <div className="p-6 text-center text-sm text-rose-700 bg-rose-50/60">
                Could not load the Credit Card entries: {loadError}{' '}
                <button type="button" onClick={load} className="underline cursor-pointer">Try again</button>
              </div>
            )}
            {rows === null && !loadError && (
              <div aria-busy="true" aria-label="Loading">
                {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-[54px] border-b border-slate-100 px-3.5 flex items-center"><div className="skeleton h-3.5 rounded w-2/3" /></div>)}
              </div>
            )}
            {rows && rows.length === 0 && !loadError && (
              <div className="p-10 text-center text-sm font-semibold text-slate-500">
                {review === 'PENDING' ? 'Nothing is waiting for review.' : 'No Credit Card entries match the current filters.'}
              </div>
            )}
            <div data-page-content className={`divide-y divide-slate-200/90 transition-opacity ${loading && rows ? 'opacity-60' : ''}`}>
              {(rows || []).map((e, i) => (
                <CcRow key={e.id} e={e} no={pg.start + i + 1} open={open === e.id} onToggle={() => setOpen((o) => (o === e.id ? null : e.id))}
                  canReview={isAdmin} onReviewed={onReviewed} toast={triggerToast} />
              ))}
            </div>
          </div>
          <Pager pg={pg} label="entries" />
        </section>
      </>)}
    </div>
  );
};

const TONES = {
  amber: 'bg-amber-50 text-amber-600 border-amber-100', emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  rose: 'bg-rose-50 text-rose-600 border-rose-100', slate: 'bg-slate-50 text-slate-500 border-slate-200', blue: 'bg-sky-50 text-sky-600 border-sky-100',
} as const;
const Kpi: React.FC<{ label: string; value?: number; sub: string; tone: keyof typeof TONES; Icon: React.ElementType; onClick: () => void; active: boolean }> = ({ label, value, sub, tone, Icon, onClick, active }) => (
  <button type="button" onClick={onClick} aria-pressed={active}
    className={`text-left p-4 rounded-2xl border bg-white shadow-2xs transition-all cursor-pointer hover:shadow-md hover:-translate-y-0.5 ${active ? 'border-[#003857] ring-2 ring-sky-100' : 'border-slate-200/90'}`}>
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider truncate">{label}</span>
      <span className={`w-9 h-9 rounded-xl flex items-center justify-center border ${TONES[tone]}`}><Icon className="w-4.5 h-4.5" aria-hidden /></span>
    </div>
    <div className="font-figure text-3xl font-extrabold tabular-nums text-slate-900 my-2">{value === undefined ? '—' : value.toLocaleString()}</div>
    <div className="pt-2 border-t border-slate-100 text-xs text-slate-500 truncate" title={sub}>{sub}</div>
  </button>
);

const StatusChip: React.FC<{ s: CcReview }> = ({ s }) => {
  const u = STATUS_UI[s];
  return <span className={`${u.cls} inline-flex items-center gap-1`}><u.Icon className="w-3 h-3" aria-hidden />{u.label}</span>;
};

const Field: React.FC<{ k: string; v: React.ReactNode; mono?: boolean }> = ({ k, v, mono }) => (
  <div className="min-w-0">
    <div className="text-[11px] uppercase tracking-wider text-slate-500">{k}</div>
    <div className={`text-[13px] text-slate-900 break-words ${mono ? 'font-mono' : ''}`}>{v === null || v === undefined || v === '' ? '—' : v}</div>
  </div>
);

const CcRow = memo(function CcRow({ e, no, open, onToggle, canReview, onReviewed, toast }: {
  e: CcEntry; no: number; open: boolean; onToggle: () => void; canReview: boolean;
  onReviewed: (recordId: string, next: Partial<CcEntry>) => void; toast: (m: string) => void;
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

  return (
    <div className="hover:bg-slate-50/70">
      <button type="button" onClick={onToggle} aria-expanded={open} className={`${GRID} w-full text-left px-3.5 py-2.5 text-[13px] text-slate-700 cursor-pointer`}>
        <span className="text-right tabular-nums text-slate-500">{no}</span>
        <span className="leading-tight">
          <span className="block tabular-nums">{fmt(e.submittedAt)}</span>
          <span className="block text-[11px] text-slate-500 font-mono truncate">{e.recordId}</span>
        </span>
        <span className="leading-tight min-w-0">
          <span className="block text-slate-900 truncate">{e.fullName || '—'}</span>
          <span className="block text-[11px] text-slate-500 truncate">
            {supp ? `Add supplementary · ${e.supplementary.length} card(s)` : e.cardStatus === 'Onboarding Failed' ? `Onboarding failed${e.failReason ? ' · ' + e.failReason : ''}` : `New card${e.supplementary.length ? ` + ${e.supplementary.length} supplementary` : ''}`}
          </span>
        </span>
        <span className="text-right tabular-nums">{supp ? '—' : usd(e.limitUsd)}</span>
        <span className="leading-tight min-w-0">
          <span className="block truncate">{e.staffName || '—'} <span className="text-slate-500">({e.staffId})</span></span>
          <span className="block text-[11px] text-slate-500 truncate">{e.branchId ? `Code ${e.branchId} · ` : ''}{e.branchText || ''}</span>
        </span>
        <span className="leading-tight"><StatusChip s={e.reviewStatus} />{e.editedAt && <span className="block text-[11px] text-slate-500 mt-0.5">edited {fmt(e.editedAt)}</span>}</span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 bg-slate-50/60 border-t border-slate-100">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 py-3">
            <Field k="Request type" v={e.requestType} />
            {!supp && <Field k="Card status" v={e.cardStatus} />}
            {e.failReason && <Field k="Failure reason" v={e.failReason} />}
            <Field k={supp ? 'Primary cardholder' : 'Full name'} v={e.fullName} />
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
                    <tr key={i} className="border-t border-slate-100"><td className="px-3 py-1.5">{i + 1}</td><td className="px-3 py-1.5">{s.full_name || '—'}</td><td className="px-3 py-1.5">{s.marital || '—'}</td><td className="px-3 py-1.5 font-mono">{s.account || '—'}</td><td className="px-3 py-1.5">{s.email || '—'}</td></tr>
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
          {e.reviewHistory.length > 1 && (
            <div className="text-[12px] text-slate-600 mb-3">
              History: {e.reviewHistory.map((h) => `${h.action === 'RESUBMITTED' ? 'corrected by staff' : h.action.toLowerCase()}${h.reason ? ` (${h.reason})` : ''}${h.by && h.action !== 'RESUBMITTED' ? ` by ${h.by}` : ''} ${fmt(h.at)}`).join(' → ')}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {e.telegramLink && (
              <a href={e.telegramLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs hover:bg-slate-100">
                <ExternalLink className="w-3.5 h-3.5" aria-hidden />Open group post
              </a>
            )}
            {canReview && e.reviewStatus === 'PENDING' && mode === 'none' && (<>
              <button type="button" disabled={busy} onClick={() => act('CONFIRM')}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-60">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}Confirm
              </button>
              <button type="button" disabled={busy} onClick={() => setMode('reject')}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-rose-300 bg-white hover:bg-rose-50 text-rose-700 text-xs font-semibold cursor-pointer">
                <XCircle className="w-3.5 h-3.5" />Reject…
              </button>
            </>)}
            {canReview && (e.reviewStatus === 'CONFIRMED' || e.reviewStatus === 'REJECTED') && mode === 'none' && (
              <button type="button" onClick={() => { setMode('change'); setReason(e.reviewReason && CC_REJECT_REASONS.includes(e.reviewReason) ? e.reviewReason : e.reviewReason ? 'Other' : ''); setOther(e.reviewReason && !CC_REJECT_REASONS.includes(e.reviewReason) ? e.reviewReason : ''); setNote(e.reviewNote || ''); }}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold cursor-pointer">
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
        </div>
      )}
    </div>
  );
});

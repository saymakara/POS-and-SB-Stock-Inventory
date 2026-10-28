import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search, RefreshCw, ChevronDown, MapPin, AlertTriangle, CheckCircle2, ShieldAlert, RotateCcw, Loader2, Send, QrCode, Sparkles,
} from 'lucide-react';
import { Branch, UserRole } from '../types';
import { ClearFiltersButton } from './ClearFiltersButton';
import { Pager } from './Pager';
import { usePager } from '../utils/usePager';
import { stampPP, stampSecPP, todayPP } from '../utils/time';
import {
  QrActivity, QrEntry, QrQuery, QrReviewStatus, QrSummary, QR_ACTIVITY_LABEL,
  fetchQrEntriesPage, fetchQrSummary, countQrNeedsReview, reviewQrEntry, subscribeToQrEntries,
} from '../services/supabaseService';

/**
 * Phone App Review → KHQR (28 Oct 2026).
 * New Installation and QR Replacement entries from the Merchant Visit phone app. Every QR material was scanned with the
 * camera and all carried the same MID. An entry is a Failed Attempt when the staff member scanned a QR with another MID
 * at least once before submitting: those are flagged here for an HQ admin to check or escalate.
 * Up to ~50,000 entries a month: the list is read from the server one page at a time (50 or 100 rows, newest first).
 */

type Period = 'TODAY' | '7D' | 'MONTH' | '3M' | 'ALL';
type StatusFilter = NonNullable<QrQuery['status']>;
const PERIOD_LABEL: Record<Period, string> = {
  TODAY: 'Today', '7D': 'Last 7 days', MONTH: 'This month', '3M': 'Last 3 months', ALL: 'All time',
};
const STATUS_TABS: Array<{ v: StatusFilter; label: string }> = [
  { v: 'ALL', label: 'All' },
  { v: 'NEEDS_REVIEW', label: 'Needs review' },
  { v: 'FAILED_ATTEMPT', label: 'Failed Attempt' },
  { v: 'COMPLETED', label: 'Completed' },
];
const REVIEW_LABEL: Record<QrReviewStatus, string> = { PENDING: 'Not reviewed', CHECKED: 'Checked', ESCALATED: 'Escalated' };
const SPRING = { type: 'spring', stiffness: 500, damping: 32, mass: 0.55 } as const;
const GRID =
  'grid items-center gap-x-3 grid-cols-[44px_150px_128px_minmax(190px,1.4fr)_64px_minmax(150px,1fr)_150px_112px_20px]';

/** Start of a period in Phnom Penh time (UTC+7), as ISO. */
function periodFrom(p: Period): string | null {
  if (p === 'ALL') return null;
  const today = todayPP();                                            // "2026-10-28"
  const startOf = (ymd: string) => new Date(`${ymd}T00:00:00+07:00`);
  if (p === 'TODAY') return startOf(today).toISOString();
  if (p === '7D') return new Date(startOf(today).getTime() - 6 * 86400000).toISOString();
  const [y, m] = today.split('-').map(Number);
  const back = p === 'MONTH' ? 0 : 2;
  let yy = y, mm = m - back;
  while (mm < 1) { mm += 12; yy -= 1; }
  return startOf(`${yy}-${String(mm).padStart(2, '0')}-01`).toISOString();
}

const isMissingTable = (msg: string) => /qr_installations|qr_summary|PGRST20[25]|does not exist|schema cache/i.test(msg);
const fmt = (iso: string | null) => (iso ? stampPP(new Date(iso)) : '—');

interface Props {
  role: UserRole;
  branches: Branch[];
  triggerToast: (msg: string) => void;
  /** Failed Attempt entries not reviewed yet (menu badge) */
  onNeedsReviewChange?: (n: number) => void;
}

export const KhqrReviewTab: React.FC<Props> = ({ role, branches, triggerToast, onNeedsReviewChange }) => {
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const [period, setPeriod] = useState<Period>('MONTH');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [activity, setActivity] = useState<'ALL' | QrActivity>('ALL');
  const [branchId, setBranchId] = useState('');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [search, setSearch] = useState('');                           // the search sent to the server (after a short pause)
  useEffect(() => {
    const t = setTimeout(() => setSearch(deferredQuery.trim()), 350);
    return () => clearTimeout(t);
  }, [deferredQuery]);

  const [rows, setRows] = useState<QrEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<QrSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [live, setLive] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [rowErr, setRowErr] = useState<Record<number, string>>({});

  const from = useMemo(() => periodFrom(period), [period]);
  const filters = useMemo<QrQuery>(() => ({ from, status, activity, branchId: branchId || undefined, search }), [from, status, activity, branchId, search]);
  const pg = usePager(total, [from, status, activity, branchId, search]);
  const page = pg.page, pageSize = pg.pageSize;

  const reqSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++reqSeq.current;
    setLoading(true);
    try {
      const [res, sum] = await Promise.all([
        fetchQrEntriesPage({ ...filters, page, pageSize }),
        fetchQrSummary(filters.from || null, null),
      ]);
      if (seq !== reqSeq.current) return;                             // an older request: a newer one is on its way
      setRows(res.rows);
      setTotal(res.total);
      if (sum) setSummary(sum);
      setLoadError('');
      if (page === 1) setNewCount(0);
    } catch (e) {
      if (seq !== reqSeq.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(isMissingTable(msg) ? 'SETUP' : msg);
      setRows((r) => r || []);
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [filters, page, pageSize]);
  useEffect(() => { load(); }, [load]);

  const refreshBadge = useCallback(() => {
    countQrNeedsReview().then((n) => { if (n !== null) onNeedsReviewChange?.(n); });
  }, [onNeedsReviewChange]);
  useEffect(() => { refreshBadge(); }, [refreshBadge]);

  // Live: a changed entry on this page is updated in place; new entries are announced (the list does not jump while
  // an admin is reading it) – "Show" loads them.
  const rowsRef = useRef<QrEntry[] | null>(null);
  rowsRef.current = rows;
  useEffect(() => {
    let badgeTimer: ReturnType<typeof setTimeout> | null = null;
    const unsub = subscribeToQrEntries((e) => {
      setLive(true);
      const cur = rowsRef.current || [];
      if (cur.some((x) => x.id === e.id)) setRows((rs) => (rs || []).map((x) => (x.id === e.id ? e : x)));
      else setNewCount((n) => n + 1);
      if (!badgeTimer) badgeTimer = setTimeout(() => { badgeTimer = null; refreshBadge(); }, 5000);
    });
    const t = setTimeout(() => setLive(true), 2500);
    return () => { unsub(); clearTimeout(t); if (badgeTimer) clearTimeout(badgeTimer); };
  }, [refreshBadge]);

  const decide = async (e: QrEntry, next: QrReviewStatus) => {
    const note = (notes[e.id] ?? e.reviewNote ?? '').trim();
    if (next === 'ESCALATED' && !note) {
      setRowErr((m) => ({ ...m, [e.id]: 'Please write the reason for escalation.' }));
      return;
    }
    setBusy(e.id);
    setRowErr((m) => ({ ...m, [e.id]: '' }));
    try {
      await reviewQrEntry(e.id, next, note);
      const stamp = new Date().toISOString();
      setRows((rs) => (rs || []).map((x) => (x.id === e.id ? { ...x, reviewStatus: next, reviewNote: note, reviewedAt: next === 'PENDING' ? null : stamp } : x)));
      triggerToast(next === 'CHECKED' ? `${e.recordId} marked as checked` : next === 'ESCALATED' ? `${e.recordId} escalated` : `${e.recordId} reopened`);
      refreshBadge();
      fetchQrSummary(filters.from || null, null).then((s) => s && setSummary(s));
    } catch (err) {
      setRowErr((m) => ({ ...m, [e.id]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(null);
    }
  };

  const filtersActive = !!query || status !== 'ALL' || activity !== 'ALL' || !!branchId || period !== 'MONTH';
  const clearAll = () => { setQuery(''); setSearch(''); setStatus('ALL'); setActivity('ALL'); setBranchId(''); setPeriod('MONTH'); };
  const branchOptions = useMemo(
    () => [...branches].sort((a, b) => String(a.code || a.id).localeCompare(String(b.code || b.id), undefined, { numeric: true })),
    [branches]
  );
  const loadingFirst = rows === null;

  return (
    <div className="flex flex-col gap-3.5 apple-tab-panel">
      {/* Filters */}
      <section className="bg-white rounded-2xl border border-slate-200 px-4 py-3 shadow-2xs" aria-label="Filters">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-2 flex items-center gap-2">
            <h2 className="text-sm font-medium text-slate-900">
              Phone App Review<span className="text-slate-500 font-normal"> · KHQR</span>
            </h2>
            <span
              className="inline-flex items-center gap-1.5 text-[11px] font-normal px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/90"
              title="New KHQR entries from the phone app are announced as they are saved"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden />
              {live ? 'Live' : 'Connected'}
            </span>
          </div>

          <div className="relative inline-flex items-center p-1 rounded-xl bg-slate-100/90 border border-slate-200/90 gap-1">
            {STATUS_TABS.map((t) => {
              const active = status === t.v;
              const n = summary
                ? t.v === 'ALL' ? summary.total : t.v === 'NEEDS_REVIEW' ? summary.needsReview : t.v === 'FAILED_ATTEMPT' ? summary.failed : summary.completed
                : null;
              return (
                <button
                  key={t.v}
                  type="button"
                  onClick={() => setStatus(t.v)}
                  aria-pressed={active}
                  className={`relative px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer select-none outline-none ${
                    active ? 'text-white font-semibold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {active && (
                    <motion.div layoutId="qr-status-pill" aria-hidden className="absolute inset-0 rounded-lg tab-active-blue border border-white/10 shadow-xs" transition={SPRING} />
                  )}
                  <span className="relative z-10 flex items-center gap-1.5">
                    {t.v === 'NEEDS_REVIEW' && <span className={`w-2 h-2 rounded-full ${active ? 'bg-rose-300' : 'bg-rose-500'}`} aria-hidden />}
                    <span>{t.label}</span>
                    {n !== null && (
                      <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded-md ${active ? 'bg-white/20 text-white font-bold' : 'bg-slate-200/60 text-slate-500'}`}>
                        ({n.toLocaleString()})
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            aria-label="Period"
            className="btn-press px-3 py-1.5 rounded-xl text-xs border bg-white hover:bg-slate-50 text-slate-700 border-slate-200 outline-none focus:border-slate-400 cursor-pointer"
          >
            {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}
          </select>
          <select
            value={activity}
            onChange={(e) => setActivity(e.target.value as 'ALL' | QrActivity)}
            aria-label="Activity"
            className="btn-press px-3 py-1.5 rounded-xl text-xs border bg-white hover:bg-slate-50 text-slate-700 border-slate-200 outline-none focus:border-slate-400 cursor-pointer"
          >
            <option value="ALL">All activities</option>
            <option value="NEW_INSTALLATION">New Installation{summary ? ` (${summary.install.toLocaleString()})` : ''}</option>
            <option value="QR_REPLACEMENT">QR Replacement{summary ? ` (${summary.replace.toLocaleString()})` : ''}</option>
          </select>
          {isAdmin && (
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              aria-label="Branch"
              className="btn-press px-3 py-1.5 rounded-xl text-xs border bg-white hover:bg-slate-50 text-slate-700 border-slate-200 outline-none focus:border-slate-400 cursor-pointer max-w-[200px]"
            >
              <option value="">All branches</option>
              {branchOptions.map((b) => <option key={b.id} value={b.id}>{b.code ? `${b.code} – ${b.name}` : b.name}</option>)}
            </select>
          )}

          <div className="relative ml-auto w-full sm:w-60">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search MID, Merchant, Staff, Record ID…"
              aria-label="Search KHQR entries"
              className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 outline-none focus:border-slate-400"
            />
          </div>
          <ClearFiltersButton className="!py-1.5" active={filtersActive} onClear={clearAll} />
          <button
            type="button"
            onClick={() => { load(); refreshBadge(); }}
            aria-label="Refresh"
            title="Refresh KHQR entries"
            className="btn-press p-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 cursor-pointer transition"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </button>
        </div>
      </section>

      {/* Period summary */}
      {summary && loadError !== 'SETUP' && (
        <section className="grid grid-cols-2 md:grid-cols-5 gap-2.5" aria-label={`Summary · ${PERIOD_LABEL[period]}`}>
          <Kpi label="Entries" value={summary.total} sub={`${summary.install.toLocaleString()} installation · ${summary.replace.toLocaleString()} replacement`} />
          <Kpi label="QR materials" value={summary.qr} sub={PERIOD_LABEL[period]} />
          <Kpi label="Completed" value={summary.completed} sub={summary.total ? `${((summary.completed / summary.total) * 100).toFixed(1)}% first-time right` : '—'} tone="good" />
          <Kpi label="Failed Attempt" value={summary.failed} sub="a QR with another MID was scanned" tone={summary.failed ? 'warn' : undefined} />
          <Kpi
            label="Needs review"
            value={summary.needsReview}
            sub={summary.needsReview ? 'Failed Attempt · not reviewed' : 'All reviewed'}
            tone={summary.needsReview ? 'bad' : 'good'}
            onClick={summary.needsReview ? () => setStatus('NEEDS_REVIEW') : undefined}
          />
        </section>
      )}

      <AnimatePresence initial={false}>
        {newCount > 0 && (
          <motion.button
            key="new"
            type="button"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={SPRING}
            onClick={() => { if (pg.page !== 1) pg.setPage(1); else load(); setNewCount(0); }}
            className="self-center inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#003857] text-white text-xs shadow-sm cursor-pointer hover:bg-[#002a42]"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {newCount} new {newCount === 1 ? 'entry' : 'entries'} · Show
          </motion.button>
        )}
      </AnimatePresence>

      {/* Table */}
      <section className="fr-table-frame bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-x-auto" aria-label="KHQR entries">
        <div className="min-w-[1080px]">
          <div className={`${GRID} glass-table-thead navy-header-bar bg-[#003857] text-white border-b border-slate-300 text-[11px] font-medium uppercase tracking-wider px-3.5 py-3`} role="row">
            <span className="text-right">No.</span>
            <span>Date Sent</span>
            <span>Activity</span>
            <span>Merchant / MID</span>
            <span className="text-center">QR</span>
            <span>Staff / Branch</span>
            <span>Status</span>
            <span>Review</span>
            <span />
          </div>

          {loadError === 'SETUP' && (
            <div className="p-8 text-center text-sm text-slate-600">
              <QrCode className="w-6 h-6 mx-auto mb-2 text-slate-400" />
              The KHQR tables are not set up in the database yet. Apply the migration <span className="font-mono text-xs">20261028_02_khqr_installation.sql</span>, then refresh.
            </div>
          )}
          {loadError && loadError !== 'SETUP' && (
            <div className="p-6 text-center text-sm text-rose-700 bg-rose-50/60">
              Could not load the KHQR entries: {loadError}{' '}
              <button type="button" onClick={load} className="underline cursor-pointer">Try again</button>
            </div>
          )}
          {loadingFirst && !loadError && (
            <div aria-busy="true" aria-label="Loading">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-[54px] border-b border-slate-100 px-3.5 flex items-center"><div className="skeleton h-3.5 rounded w-2/3" /></div>
              ))}
            </div>
          )}
          {rows && rows.length === 0 && !loadError && (
            <div className="p-10 text-center text-sm font-semibold text-slate-500">
              {status === 'NEEDS_REVIEW' ? 'No Failed Attempt entry is waiting for review.' : 'No KHQR entries match the current filters.'}
            </div>
          )}

          <div data-page-content className={`divide-y divide-slate-200/90 transition-opacity ${loading && rows ? 'opacity-60' : ''}`}>
            {(rows || []).map((e, i) => (
              <QrRow
                key={e.id}
                e={e}
                no={pg.start + i + 1}
                open={open === e.id}
                onToggle={() => setOpen((o) => (o === e.id ? null : e.id))}
                isAdmin={isAdmin}
                busy={busy === e.id}
                note={notes[e.id] ?? e.reviewNote}
                onNote={(v) => setNotes((m) => ({ ...m, [e.id]: v }))}
                err={rowErr[e.id] || ''}
                onDecide={(s) => decide(e, s)}
              />
            ))}
          </div>
        </div>
        <Pager pg={pg} label="entries" />
      </section>
    </div>
  );
};

const Kpi: React.FC<{ label: string; value: number; sub: string; tone?: 'good' | 'warn' | 'bad'; onClick?: () => void }> = ({ label, value, sub, tone, onClick }) => {
  const dot = tone === 'good' ? 'bg-emerald-500' : tone === 'warn' ? 'bg-amber-500' : tone === 'bad' ? 'bg-rose-500' : 'bg-slate-400';
  const Tag: any = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button', onClick, title: 'Show the entries that need review' } : {})}
      className={`text-left bg-white rounded-2xl border border-slate-200 px-4 py-3 shadow-2xs ${onClick ? 'cursor-pointer hover:border-slate-300 hover:shadow-xs transition' : ''}`}
    >
      <div className="flex items-center gap-1.5 text-[11px] text-slate-500 uppercase tracking-wider">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} aria-hidden />
        {label}
      </div>
      <div className="font-figure text-xl font-semibold text-slate-900 tabular-nums mt-0.5">{value.toLocaleString()}</div>
      <div className="text-[11px] text-slate-500 truncate" title={sub}>{sub}</div>
    </Tag>
  );
};

interface RowProps {
  e: QrEntry;
  no: number;
  open: boolean;
  onToggle: () => void;
  isAdmin: boolean;
  busy: boolean;
  note: string;
  onNote: (v: string) => void;
  err: string;
  onDecide: (s: QrReviewStatus) => void;
}

const QrRow = memo(function QrRow({ e, no, open, onToggle, isAdmin, busy, note, onNote, err, onDecide }: RowProps) {
  const failed = e.failedAttempts > 0;
  const flag = failed && e.reviewStatus === 'PENDING';
  const rowTone = flag ? 'bg-rose-50/70 hover:bg-rose-50' : failed && e.reviewStatus === 'ESCALATED' ? 'bg-rose-50/40 hover:bg-rose-50/70' : failed ? 'bg-amber-50/50 hover:bg-amber-50' : 'hover:bg-slate-50';
  const mapUrl = e.latitude !== null && e.longitude !== null ? `https://www.google.com/maps?q=${e.latitude},${e.longitude}` : '';
  return (
    <div className={rowTone}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`${GRID} w-full text-left px-3.5 py-2.5 text-[12.5px] text-slate-700 cursor-pointer relative`}
      >
        {flag && <span aria-hidden className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-rose-500" />}
        <span className="text-right tabular-nums text-slate-500">{no}</span>
        <span className="leading-tight">
          <span className="block tabular-nums">{fmt(e.submittedAt)}</span>
          <span className="block text-[11px] text-slate-500 font-mono truncate">{e.recordId}</span>
        </span>
        <span className="truncate">{QR_ACTIVITY_LABEL[e.activity]}</span>
        <span className="leading-tight min-w-0">
          <span className="block truncate text-slate-900" title={e.merchantNameKh ? `${e.merchantName} · ${e.merchantNameKh}` : e.merchantName}>{e.merchantName || e.merchantNameKh}</span>
          <span className="block text-[11px] text-slate-500 font-mono tabular-nums">{e.mid}</span>
        </span>
        <span className="text-center tabular-nums font-medium" title={`${e.qrCount} QR material(s) scanned`}>{e.qrCount}</span>
        <span className="leading-tight min-w-0">
          <span className="block truncate">{e.staffName || e.staffId}</span>
          <span className="block text-[11px] text-slate-500 truncate">{e.branchText || e.branchId || '—'}</span>
        </span>
        <span>
          {failed ? (
            <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${flag || e.reviewStatus === 'ESCALATED' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-amber-50 text-amber-800 border-amber-200'}`}>
              <AlertTriangle className="w-3 h-3" /> Failed Attempt ({e.failedAttempts})
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
              <CheckCircle2 className="w-3 h-3" /> Completed
            </span>
          )}
        </span>
        <span className="text-[11.5px]">
          {!failed ? (
            <span className="text-slate-400">—</span>
          ) : e.reviewStatus === 'PENDING' ? (
            <span className="text-rose-700 font-medium">Needs review</span>
          ) : e.reviewStatus === 'ESCALATED' ? (
            <span className="inline-flex items-center gap-1 text-rose-700"><ShieldAlert className="w-3 h-3" /> Escalated</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="w-3 h-3" /> Checked</span>
          )}
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="d"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4 pt-1 grid gap-4 md:grid-cols-3 text-[12.5px] text-slate-700">
              <div className="space-y-1.5">
                <Detail k="Record ID" v={<span className="font-mono">{e.recordId}</span>} />
                <Detail k="Merchant" v={<>{e.merchantName}{e.merchantNameKh && <span className="block text-slate-500">{e.merchantNameKh}</span>}</>} />
                <Detail k="MID" v={<span className="font-mono tabular-nums">{e.mid}</span>} />
                <Detail k="QR materials" v={`${e.qrCount} scanned, all with the same MID`} />
                <Detail k="Remark" v={e.remark || '—'} />
              </div>
              <div className="space-y-1.5">
                <Detail k="Saved at merchant" v={e.capturedAt ? stampSecPP(new Date(e.capturedAt)) : '—'} />
                <Detail k="Received" v={stampSecPP(new Date(e.submittedAt))} />
                <Detail
                  k="Location"
                  v={mapUrl ? (
                    <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sky-700 hover:underline">
                      <MapPin className="w-3 h-3" /> {e.latitude!.toFixed(6)}, {e.longitude!.toFixed(6)}
                    </a>
                  ) : '—'}
                />
                {e.gpsAccuracy !== null && <Detail k="GPS accuracy" v={`± ${Math.round(e.gpsAccuracy)} m`} />}
                <Detail
                  k="Photos"
                  v={e.telegramLink ? (
                    <a href={e.telegramLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sky-700 hover:underline">
                      <Send className="w-3 h-3" /> {e.photoCount} on Telegram
                    </a>
                  ) : `${e.photoCount} (Telegram post not linked)`}
                />
                <Detail k="App version" v={e.appVersion || '—'} />
              </div>
              <div className="space-y-2">
                {e.failedAttempts > 0 ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wider text-rose-700 font-medium mb-1">
                      Failed attempts ({e.failedAttempts})
                    </div>
                    {e.attempts.length ? (
                      <ol className="space-y-1">
                        {e.attempts.map((a, i) => (
                          <li key={i} className="text-[12px] text-rose-900 leading-snug">
                            <span className="tabular-nums text-rose-700">{a.at ? stampSecPP(new Date(a.at)) : '—'}</span>{' '}
                            scanned MID <span className="font-mono">{a.gotMid || '?'}</span>
                            {a.gotName ? ` (${a.gotName})` : ''} instead of <span className="font-mono">{a.expectedMid || e.mid}</span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <div className="text-[12px] text-rose-900">A QR with another MID was scanned; the details were not kept.</div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-[12px] text-emerald-800">
                    Every QR carried the same MID at the first try.
                  </div>
                )}

                {e.failedAttempts > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[11px] text-slate-500">
                      {REVIEW_LABEL[e.reviewStatus]}
                      {e.reviewStatus !== 'PENDING' && e.reviewedAt ? ` · ${fmt(e.reviewedAt)}` : ''}
                      {e.reviewStatus !== 'PENDING' && e.reviewedByName ? ` · ${e.reviewedByName}` : ''}
                    </div>
                    {isAdmin ? (
                      <>
                        <textarea
                          value={note}
                          onChange={(ev) => onNote(ev.target.value)}
                          maxLength={500}
                          rows={2}
                          placeholder="Review note (required to escalate)"
                          aria-label="Review note"
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-slate-400 resize-none"
                        />
                        <div className="flex flex-wrap gap-2">
                          {e.reviewStatus !== 'CHECKED' && (
                            <button type="button" disabled={busy} onClick={() => onDecide('CHECKED')}
                              className="btn-tactile inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer disabled:opacity-50">
                              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Mark as checked
                            </button>
                          )}
                          {e.reviewStatus !== 'ESCALATED' && (
                            <button type="button" disabled={busy} onClick={() => onDecide('ESCALATED')}
                              className="btn-tactile inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs bg-rose-600 hover:bg-rose-700 text-white cursor-pointer disabled:opacity-50">
                              <ShieldAlert className="w-3.5 h-3.5" /> Escalate
                            </button>
                          )}
                          {e.reviewStatus !== 'PENDING' && (
                            <button type="button" disabled={busy} onClick={() => onDecide('PENDING')}
                              className="btn-tactile inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 cursor-pointer disabled:opacity-50">
                              <RotateCcw className="w-3.5 h-3.5" /> Reopen
                            </button>
                          )}
                        </div>
                      </>
                    ) : (
                      e.reviewNote && <div className="text-xs text-slate-600">Note: {e.reviewNote}</div>
                    )}
                    {err && <div className="text-xs text-rose-700" role="alert">{err}</div>}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

const Detail: React.FC<{ k: string; v: React.ReactNode }> = ({ k, v }) => (
  <div className="flex gap-2">
    <span className="w-[118px] shrink-0 text-slate-500">{k}</span>
    <span className="min-w-0 break-words text-slate-800">{v}</span>
  </div>
);

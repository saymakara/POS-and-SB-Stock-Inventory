import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, RefreshCw, ChevronDown, MapPin, AlertTriangle, CheckCircle2, Loader2, Send, QrCode, Sparkles, UserX } from 'lucide-react';
import { Branch, UserRole } from '../types';
import { ClearFiltersButton } from './ClearFiltersButton';
import { Pager } from './Pager';
import { usePager } from '../utils/usePager';
import { stampPP, stampSecPP, todayPP } from '../utils/time';
import {
  QrActivity, QrEntry, QrQuery, QrStaffFailure, QrSummary, QR_ACTIVITY_LABEL,
  fetchQrEntriesPage, fetchQrSummary, fetchQrStaffFailures, subscribeToQrEntries,
} from '../services/supabaseService';

/**
 * Phone App Review → KHQR (28 Oct 2026).
 * New Installation and QR Replacement entries from the Merchant Visit phone app. Every QR material was scanned with the
 * camera; the app restricts Submit while any QR has another MID and records that as a "failed attempt". There is no
 * approval step here: the page shows the KHQR statistics, who had failed attempts, and every entry (newest first).
 * Up to ~50,000 entries a month: the list is read from the server one page at a time (50 or 100 rows).
 */

type Period = 'TODAY' | '7D' | 'MONTH' | '3M' | 'ALL';
type StatusFilter = NonNullable<QrQuery['status']>;
const PERIOD_LABEL: Record<Period, string> = {
  TODAY: 'Today', '7D': 'Last 7 days', MONTH: 'This month', '3M': 'Last 3 months', ALL: 'All time',
};
const STATUS_TABS: Array<{ v: StatusFilter; label: string }> = [
  { v: 'ALL', label: 'All' },
  { v: 'FAILED_ATTEMPT', label: 'Failed Attempt' },
  { v: 'COMPLETED', label: 'Completed' },
];
const SPRING = { type: 'spring', stiffness: 500, damping: 32, mass: 0.55 } as const;
const GRID =
  'grid items-center gap-x-3 grid-cols-[44px_150px_128px_minmax(190px,1.4fr)_56px_minmax(150px,1fr)_minmax(130px,0.8fr)_150px_20px]';
const SGRID = 'grid items-center gap-x-3 grid-cols-[44px_minmax(170px,1.2fr)_minmax(130px,1fr)_110px_120px_150px_minmax(220px,1.3fr)]';

/** Start of a period in Phnom Penh time (UTC+7), as ISO. */
function periodFrom(p: Period): string | null {
  if (p === 'ALL') return null;
  const today = todayPP();
  const startOf = (ymd: string) => new Date(`${ymd}T00:00:00+07:00`);
  if (p === 'TODAY') return startOf(today).toISOString();
  if (p === '7D') return new Date(startOf(today).getTime() - 6 * 86400000).toISOString();
  const [y, m] = today.split('-').map(Number);
  let yy = y, mm = m - (p === 'MONTH' ? 0 : 2);
  while (mm < 1) { mm += 12; yy -= 1; }
  return startOf(`${yy}-${String(mm).padStart(2, '0')}-01`).toISOString();
}

const isMissingTable = (msg: string) => /qr_installations|qr_summary|qr_staff_failures|PGRST20[25]|does not exist|schema cache/i.test(msg);
const fmt = (iso: string | null) => (iso ? stampPP(new Date(iso)) : '—');
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : '0.0%');

interface Props {
  role: UserRole;
  branches: Branch[];
  triggerToast: (msg: string) => void;
}

export const KhqrReviewTab: React.FC<Props> = ({ role, branches }) => {
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const [period, setPeriod] = useState<Period>('MONTH');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [activity, setActivity] = useState<'ALL' | QrActivity>('ALL');
  const [branchId, setBranchId] = useState('');
  const [staffSel, setStaffSel] = useState<{ id: string; name: string } | null>(null);
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
  const [staff, setStaff] = useState<QrStaffFailure[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [live, setLive] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [open, setOpen] = useState<number | null>(null);

  const from = useMemo(() => periodFrom(period), [period]);
  const filters = useMemo<QrQuery>(() => ({ from, status, activity, branchId: branchId || undefined, staffId: staffSel?.id || undefined, search }),
    [from, status, activity, branchId, staffSel, search]);
  const pg = usePager(total, [from, status, activity, branchId, staffSel, search]);
  const page = pg.page, pageSize = pg.pageSize;

  // the statistics and the staff table follow the period only (one request each)
  const statSeq = useRef(0);
  const loadStats = useCallback(async () => {
    const seq = ++statSeq.current;
    const [sum, st] = await Promise.all([fetchQrSummary(from, null), fetchQrStaffFailures(from, null)]);
    if (seq !== statSeq.current) return;
    if (sum) setSummary(sum);
    if (st) setStaff(st);
  }, [from]);
  useEffect(() => { loadStats(); }, [loadStats]);

  const reqSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++reqSeq.current;
    setLoading(true);
    try {
      const res = await fetchQrEntriesPage({ ...filters, page, pageSize });
      if (seq !== reqSeq.current) return;                             // an older request: a newer one is on its way
      setRows(res.rows);
      setTotal(res.total);
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

  // Live: new entries are announced (the list does not jump while someone reads it) – "Show" loads them.
  useEffect(() => {
    let statTimer: ReturnType<typeof setTimeout> | null = null;
    const unsub = subscribeToQrEntries(() => {
      setLive(true);
      setNewCount((n) => n + 1);
      if (!statTimer) statTimer = setTimeout(() => { statTimer = null; loadStats(); }, 5000);
    });
    const t = setTimeout(() => setLive(true), 2500);
    return () => { unsub(); clearTimeout(t); if (statTimer) clearTimeout(statTimer); };
  }, [loadStats]);

  const filtersActive = !!query || status !== 'ALL' || activity !== 'ALL' || !!branchId || !!staffSel || period !== 'MONTH';
  const clearAll = () => { setQuery(''); setSearch(''); setStatus('ALL'); setActivity('ALL'); setBranchId(''); setStaffSel(null); setPeriod('MONTH'); };
  const branchOptions = useMemo(
    () => [...branches].sort((a, b) => String(a.code || a.id).localeCompare(String(b.code || b.id), undefined, { numeric: true })),
    [branches]
  );
  const loadingFirst = rows === null;
  const entriesRef = useRef<HTMLElement | null>(null);
  const showStaff = (s: QrStaffFailure) => {
    setStaffSel({ id: s.staffId, name: s.staffName || s.staffId });
    setStatus('FAILED_ATTEMPT');
    setTimeout(() => entriesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  return (
    <div className="flex flex-col gap-3.5 apple-tab-panel">
      {/* KHQR statistics (this tab shows KHQR only) */}
      <section className="bg-white rounded-2xl border border-slate-200 px-4 py-3 shadow-2xs" aria-label="KHQR statistics">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <h2 className="text-sm font-medium text-slate-900 mr-1">
            Phone App Review<span className="text-slate-500 font-normal"> · KHQR</span>
          </h2>
          <span
            className="inline-flex items-center gap-1.5 text-[11px] font-normal px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/90"
            title="New KHQR entries from the phone app are announced as they are saved"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden />
            {live ? 'Live' : 'Connected'}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as Period)}
              aria-label="Period"
              className="btn-press px-3 py-1.5 rounded-xl text-xs border bg-white hover:bg-slate-50 text-slate-700 border-slate-200 outline-none focus:border-slate-400 cursor-pointer"
            >
              {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}
            </select>
            <button
              type="button"
              onClick={() => { load(); loadStats(); }}
              aria-label="Refresh"
              title="Refresh KHQR statistics and entries"
              className="btn-press p-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 cursor-pointer transition"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
        {loadError === 'SETUP' ? (
          <div className="py-6 text-center text-sm text-slate-600">
            <QrCode className="w-6 h-6 mx-auto mb-2 text-slate-400" />
            The KHQR tables are not set up in the database yet. Apply the migration <span className="font-mono text-xs">20261028_02_khqr_installation.sql</span>, then refresh.
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2.5">
            <Kpi label="KHQR entries" value={summary?.total} sub={summary ? `${summary.install.toLocaleString()} new · ${summary.replace.toLocaleString()} replaced` : ''} />
            <Kpi label="QR materials" value={summary?.qr} sub={summary && summary.total ? `${(summary.qr / summary.total).toFixed(1)} per entry` : PERIOD_LABEL[period]} />
            <Kpi label="Completed" value={summary?.completed} sub={summary ? `${pct(summary.completed, summary.total)} of entries` : ''} tone="good"
              onClick={() => setStatus('COMPLETED')} />
            {/* (3.50) every blocked Submit tap is one failed attempt */}
            <Kpi label="Failed Attempt" value={summary?.attempts} sub={summary ? `${summary.failed.toLocaleString()} entries affected` : ''} tone={summary?.attempts ? 'bad' : undefined}
              onClick={() => setStatus('FAILED_ATTEMPT')} />
            <Kpi label="Staff involved" value={summary?.staffFailed} sub="with failed attempts" tone={summary?.staffFailed ? 'bad' : undefined} />
          </div>
        )}
      </section>

      {/* Who had failed attempts (tracking, no approval) */}
      {loadError !== 'SETUP' && (
        <section className="fr-table-frame bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-x-auto" aria-label="Failed attempts by staff">
          <div className="px-4 py-2.5 flex items-center gap-2 border-b border-slate-200">
            <UserX className="w-4 h-4 text-rose-600" />
            <h3 className="text-[13px] font-medium text-slate-900">Failed attempts by staff</h3>
            <span className="text-[11.5px] text-slate-500">· {PERIOD_LABEL[period]}</span>
          </div>
          <div className="min-w-[1000px]">
            <div className={`${SGRID} glass-table-thead navy-header-bar bg-[#003857] text-white text-[11px] font-medium uppercase tracking-wider px-3.5 py-2.5`} role="row">
              <span className="text-right">No.</span>
              <span>Staff</span>
              <span>Branch</span>
              <span className="text-right">Failed attempts</span>
              <span className="text-right">Entries affected</span>
              <span>Last failed attempt</span>
              <span>Last wrong MID</span>
            </div>
            {staff === null && <div className="h-[46px] px-3.5 flex items-center"><div className="skeleton h-3.5 rounded w-1/2" /></div>}
            {staff && staff.length === 0 && (
              <div className="p-6 text-center text-sm text-emerald-700 inline-flex w-full justify-center items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" /> No failed attempt in this period.
              </div>
            )}
            <div className="divide-y divide-slate-200/90">
              {(staff || []).map((s, i) => (
                <button
                  key={s.staffId + i}
                  type="button"
                  onClick={() => showStaff(s)}
                  title="Show this staff member's Failed Attempt entries"
                  className={`${SGRID} w-full text-left px-3.5 py-2 text-[12.5px] text-slate-700 hover:bg-rose-50/60 cursor-pointer`}
                >
                  <span className="text-right tabular-nums text-slate-500">{i + 1}</span>
                  <span className="leading-tight min-w-0">
                    <span className="block truncate text-slate-900">{s.staffName || s.staffId}</span>
                    <span className="block text-[11px] text-slate-500 font-mono">{s.staffId}</span>
                  </span>
                  <span className="truncate">{s.branchText || '—'}</span>
                  <span className="text-right tabular-nums font-semibold text-rose-700">{s.attempts.toLocaleString()}</span>
                  <span className="text-right tabular-nums">
                    {s.entriesFailed.toLocaleString()}<span className="text-slate-400"> / {s.entries.toLocaleString()}</span>
                  </span>
                  <span className="tabular-nums">{fmt(s.lastAt)}</span>
                  <span className="text-[11.5px] leading-tight">
                    {s.lastGotMid ? (
                      <span className="font-mono" title={s.lastExpectedMid ? `Expected ${s.lastExpectedMid}` : undefined}>{s.lastGotMid}</span>
                    ) : '—'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Entries: filters */}
      <section ref={entriesRef} className="bg-white rounded-2xl border border-slate-200 px-4 py-3 shadow-2xs scroll-mt-4" aria-label="Filters">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[13px] font-medium text-slate-900 mr-1">KHQR entries</h3>
          <div className="relative inline-flex items-center p-1 rounded-xl bg-slate-100/90 border border-slate-200/90 gap-1">
            {STATUS_TABS.map((t) => {
              const active = status === t.v;
              const n = summary ? (t.v === 'ALL' ? summary.total : t.v === 'FAILED_ATTEMPT' ? summary.failed : summary.completed) : null;
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
                    {t.v === 'FAILED_ATTEMPT' && <span className={`w-2 h-2 rounded-full ${active ? 'bg-rose-300' : 'bg-rose-500'}`} aria-hidden />}
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
          {staffSel && (
            <button
              type="button"
              onClick={() => setStaffSel(null)}
              title="Show every staff member"
              className="btn-press inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs border border-rose-200 bg-rose-50 text-rose-700 cursor-pointer"
            >
              Staff: {staffSel.name} <span aria-hidden>×</span>
            </button>
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
        </div>
      </section>

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

      {/* Entries */}
      <section className="fr-table-frame bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-x-auto" aria-label="KHQR entries">
        <div className="min-w-[1080px]">
          <div className={`${GRID} glass-table-thead navy-header-bar bg-[#003857] text-white border-b border-slate-300 text-[11px] font-medium uppercase tracking-wider px-3.5 py-3`} role="row">
            <span className="text-right">No.</span>
            <span>Date Sent</span>
            <span>Activity</span>
            <span>Merchant / MID</span>
            <span className="text-center">QR</span>
            <span>Staff / Branch</span>
            <span>Location</span>
            <span>Status</span>
            <span />
          </div>

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
            <div className="p-10 text-center text-sm font-semibold text-slate-500">No KHQR entries match the current filters.</div>
          )}

          <div data-page-content className={`divide-y divide-slate-200/90 transition-opacity ${loading && rows ? 'opacity-60' : ''}`}>
            {(rows || []).map((e, i) => (
              <QrRow key={e.id} e={e} no={pg.start + i + 1} open={open === e.id} onToggle={() => setOpen((o) => (o === e.id ? null : e.id))} />
            ))}
          </div>
        </div>
        <Pager pg={pg} label="entries" />
      </section>
    </div>
  );
};

const Kpi: React.FC<{ label: string; value: number | undefined; sub: string; tone?: 'good' | 'warn' | 'bad'; onClick?: () => void }> = ({ label, value, sub, tone, onClick }) => {
  const dot = tone === 'good' ? 'bg-emerald-500' : tone === 'warn' ? 'bg-amber-500' : tone === 'bad' ? 'bg-rose-500' : 'bg-slate-400';
  const Tag: any = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button', onClick, title: `Show ${label.toLowerCase()} below` } : {})}
      className={`text-left rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 ${onClick ? 'cursor-pointer hover:border-slate-300 hover:bg-white transition' : ''}`}
    >
      <div className="flex items-center gap-1.5 text-[10.5px] text-slate-500 uppercase tracking-wider">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} aria-hidden />
        <span className="truncate">{label}</span>
      </div>
      <div className="font-figure text-xl font-semibold text-slate-900 tabular-nums mt-0.5">{value === undefined ? '—' : value.toLocaleString()}</div>
      <div className="text-[11px] text-slate-500 truncate" title={sub}>{sub || ' '}</div>
    </Tag>
  );
};

const QrRow = memo(function QrRow({ e, no, open, onToggle }: { e: QrEntry; no: number; open: boolean; onToggle: () => void }) {
  const failed = e.failedAttempts > 0;
  const mapUrl = e.latitude !== null && e.longitude !== null ? `https://www.google.com/maps?q=${e.latitude},${e.longitude}` : '';
  const place = [e.location, e.khan].filter(Boolean).join(' · ');
  return (
    <div className={failed ? 'bg-rose-50/50 hover:bg-rose-50' : 'hover:bg-slate-50'}>
      <button type="button" onClick={onToggle} aria-expanded={open} className={`${GRID} w-full text-left px-3.5 py-2.5 text-[12.5px] text-slate-700 cursor-pointer relative`}>
        {failed && <span aria-hidden className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-rose-500" />}
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
        <span className="truncate" title={place}>{place || '—'}</span>
        <span>
          {failed ? (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border bg-rose-50 text-rose-700 border-rose-200">
              <AlertTriangle className="w-3 h-3" /> Failed Attempt ({e.failedAttempts})
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
              <CheckCircle2 className="w-3 h-3" /> Completed
            </span>
          )}
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="d" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={SPRING} className="overflow-hidden">
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
                <Detail k="Location" v={place || '—'} />
                <Detail
                  k="GPS"
                  v={mapUrl ? (
                    <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sky-700 hover:underline">
                      <MapPin className="w-3 h-3" /> {e.latitude!.toFixed(6)}, {e.longitude!.toFixed(6)}{e.gpsAccuracy !== null ? ` (± ${Math.round(e.gpsAccuracy)} m)` : ''}
                    </a>
                  ) : '—'}
                />
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
              <div>
                {failed ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wider text-rose-700 font-medium mb-1">Failed attempts ({e.failedAttempts})</div>
                    <div className="text-[11.5px] text-rose-800 mb-1">Submit blocked: MID did not match.</div>
                    {e.attempts.length ? (
                      <ol className="space-y-1">
                        {e.attempts.map((a, i) => (
                          <li key={i} className="text-[12px] text-rose-900 leading-snug">
                            <span className="tabular-nums text-rose-700">{a.at ? stampSecPP(new Date(a.at)) : '—'}</span>{' '}
                            Wrong MID <span className="font-mono">{a.gotMid || '?'}</span>
                            {a.gotName ? ` (${a.gotName})` : ''}
                          </li>
                        ))}
                      </ol>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-[12px] text-emerald-800">
                    No failed attempt.
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

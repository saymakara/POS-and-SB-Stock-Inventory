import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, RefreshCw, ChevronDown, MapPin, ScanLine, CheckCircle2, Loader2, Send, QrCode, Sparkles, Layers, AlertTriangle, Users, Copy } from 'lucide-react';
import { Branch, UserRole } from '../types';
import { ClearFiltersButton } from './ClearFiltersButton';
import { Pager } from './Pager';
import { usePager } from '../utils/usePager';
import { stampPP, stampSecPP } from '../utils/time';
import {
  QrActivity, QrAttempt, QrAttemptKind, QrEntry, QrMonthTotal, QrQuery, QrSummary, QR_ACTIVITY_LABEL,
  fetchQrAttemptsPage, fetchQrSavedBySessions, fetchQrSharedMids, QrSharedMid, fetchQrEntriesPage, fetchQrMonthHistory, fetchQrSummary, subscribeToQrEntries,
} from '../services/supabaseService';
import {
  Period, periodRange, attemptsKey, getCachedAttempts, setCachedAttempts, entriesKey, getCachedEntries, setCachedEntries, getCachedSummary, setCachedSummary, getCachedHistory, setCachedHistory,
} from '../services/khqrCache';

/**
 * Phone App Review → KHQR (28 Oct 2026).
 * New Installation and QR Replacement entries from the Merchant Visit phone app. Every QR material was scanned with the
 * camera; the app restricts Submit while any QR has another MID and records that as a "failed attempt". There is no
 * approval step here: the page shows the KHQR statistics, who had failed attempts, and every entry (newest first).
 * Up to ~50,000 entries a month: the list is read from the server one page at a time (50 or 100 rows).
 */

// (29 Oct 2026) KHQR details are kept for this month and last month only (older months: monthly totals below)
const PERIOD_LABEL: Record<Period, string> = {
  TODAY: 'Today', '7D': 'Last 7 days', MONTH: 'This month', LAST: 'Last month', BOTH: 'Last 2 months',
};
const SPRING = { type: 'spring', stiffness: 500, damping: 32, mass: 0.55 } as const;
const GRID =
  'grid items-center gap-x-3 grid-cols-[44px_150px_128px_minmax(200px,1.4fr)_56px_minmax(160px,1fr)_minmax(150px,1fr)_20px]';
const LGRID = 'grid items-center gap-x-3 grid-cols-[36px_150px_112px_minmax(130px,1fr)_minmax(100px,0.8fr)_108px_128px_minmax(140px,1fr)_32px_164px]';
const SMGRID = 'grid items-center gap-x-3 grid-cols-[36px_96px_150px_minmax(160px,1fr)_70px_minmax(220px,1.6fr)_70px_minmax(140px,1fr)_120px_20px]';
const HGRID = 'grid items-center gap-x-3 grid-cols-[minmax(150px,1.2fr)_90px_120px_120px_110px_110px_110px_110px]';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ymd: string) => { const [y, m] = ymd.split('-').map(Number); return `${MONTH_NAMES[m - 1]} ${y}`; };

const isMissingTable = (msg: string) => /qr_installations|qr_summary|PGRST20[25]|does not exist|schema cache/i.test(msg);
const fmt = (iso: string | null) => (iso ? stampPP(new Date(iso)) : '—');

interface Props {
  role: UserRole;
  branches: Branch[];
  triggerToast: (msg: string) => void;
}

export const KhqrReviewTab: React.FC<Props> = ({ role, branches }) => {
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const [period, setPeriod] = useState<Period>('MONTH');
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

  // the last answers (kept in memory) are shown at once; fresh ones replace them quietly
  const [first] = useState(() => {
    const r = periodRange('MONTH');
    return { entries: getCachedEntries(entriesKey({ from: r.from, to: r.to, activity: 'ALL', search: '' }, 1, 50)), summary: getCachedSummary(r.from, r.to) };
  });
  const [rows, setRows] = useState<QrEntry[] | null>(first.entries ? first.entries.rows : null);
  const [total, setTotal] = useState(first.entries ? first.entries.total : 0);
  const [summary, setSummary] = useState<QrSummary | null>(first.summary || null);
  const [history, setHistory] = useState<QrMonthTotal[] | null>(getCachedHistory());
  const [shared, setShared] = useState<QrSharedMid[] | null>(null);   // (30 Oct 2026) one MID, 2+ staff, same day
  const sharedRef = useRef<HTMLElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [live, setLive] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [view, setView] = useState<'entries' | 'log'>('entries');      // (28 Oct 2026) saved entries, or every blocked Submit
  const [logKind, setLogKind] = useState<'ALL' | QrAttemptKind>('SUBMIT_BLOCKED');   // (30 Oct 2026) which records the log shows
  const [logKey, setLogKey] = useState(0);                            // reloads the failed attempts log

  const range = useMemo(() => periodRange(period), [period]);
  const from = range.from, to = range.to;
  // (28 Oct 2026) every KHQR entry is a request: no Completed / Failed Attempt split (failed attempts: the log)
  const filters = useMemo<QrQuery>(() => ({ from, to, activity, branchId: branchId || undefined, staffId: staffSel?.id || undefined, search }),
    [from, to, activity, branchId, staffSel, search]);
  const pg = usePager(total, [from, to, activity, branchId, staffSel, search]);
  const page = pg.page, pageSize = pg.pageSize;

  // Single fast RPC for summary; monthly history is fetched once and updated on live events
  const statSeq = useRef(0);
  const loadStats = useCallback(async () => {
    const seq = ++statSeq.current;
    const hit = getCachedSummary(from, to);
    if (hit) setSummary(hit);
    const [sum, sm] = await Promise.all([fetchQrSummary(from, to), fetchQrSharedMids(from, to, 200)]);
    if (seq !== statSeq.current) return;
    if (sum) { setCachedSummary(from, to, sum); setSummary(sum); }
    setShared(sm);
  }, [from, to]);
  useEffect(() => { loadStats(); }, [loadStats]);

  const loadMonthHistory = useCallback(async () => {
    const hist = await fetchQrMonthHistory(1);
    if (hist) { setCachedHistory(hist.slice(0, 1)); setHistory(hist.slice(0, 1)); }
  }, []);
  useEffect(() => { loadMonthHistory(); }, [loadMonthHistory]);

  const reqSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++reqSeq.current;
    const key = entriesKey(filters, page, pageSize);
    const hit = getCachedEntries(key);
    if (hit) { setRows(hit.rows); setTotal(hit.total); }               // shown at once; the fresh answer replaces it quietly
    setLoading(!hit);
    try {
      const res = await fetchQrEntriesPage({ ...filters, page, pageSize });
      if (seq !== reqSeq.current) return;                             // an older request: a newer one is on its way
      setCachedEntries(key, { rows: res.rows, total: res.total });
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
      if (!statTimer) statTimer = setTimeout(() => { statTimer = null; loadStats(); loadMonthHistory(); setLogKey((k) => k + 1); }, 5000);
    });
    const t = setTimeout(() => setLive(true), 2500);
    return () => { unsub(); clearTimeout(t); if (statTimer) clearTimeout(statTimer); };
  }, [loadStats, loadMonthHistory]);

  const filtersActive = !!query || activity !== 'ALL' || !!branchId || !!staffSel || period !== 'MONTH';
  const clearAll = () => { setQuery(''); setSearch(''); setActivity('ALL'); setBranchId(''); setStaffSel(null); setPeriod('MONTH'); };
  const branchOptions = useMemo(
    () => [...branches].sort((a, b) => String(a.code || a.id).localeCompare(String(b.code || b.id), undefined, { numeric: true })),
    [branches]
  );
  const loadingFirst = rows === null;
  const entriesRef = useRef<HTMLElement | null>(null);

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
              onClick={() => { load(); loadStats(); setLogKey((k) => k + 1); }}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-3.5">
            <BigKpiCard
              label="KHQR entries"
              value={summary?.total}
              sub={summary ? `${summary.install.toLocaleString()} new · ${summary.replace.toLocaleString()} replaced` : 'Registered KHQR installations'}
              icon={QrCode}
              accentColor="blue"
              badge={summary ? '100% Synced' : undefined}
            />
            <BigKpiCard
              label="QR materials"
              value={summary?.qr}
              sub={summary && summary.total ? `${(summary.qr / summary.total).toFixed(1)} materials / entry` : PERIOD_LABEL[period]}
              icon={Layers}
              accentColor="emerald"
              badge="Physical items"
            />
            <BigKpiCard
              label="Failed Attempt"
              value={summary?.attempts}
              sub="Submit tapped with a wrong-MID QR · blocked"
              icon={AlertTriangle}
              accentColor="rose"
              onClick={() => {
                setLogKind('SUBMIT_BLOCKED');
                setView('log');
                setTimeout(() => entriesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
              }}
            />
            <BigKpiCard
              label="Staff involved"
              value={summary?.staffFailed}
              sub="Staff with failed attempts"
              icon={Users}
              accentColor="amber"
              badge={summary?.staffFailed && summary.staffFailed > 0 ? `${summary.staffFailed} staff` : undefined}
            />
            <BigKpiCard
              label="Wrong Scan"
              value={summary?.wrongScans}
              sub={summary && summary.wrongScans > 0 ? `${summary.wrongScanStaff.toLocaleString()} staff · wrong-MID QR scanned` : 'Wrong-MID QR scanned · submitted or not'}
              icon={ScanLine}
              accentColor="orange"
              onClick={() => {
                setLogKind('WRONG_SCAN');
                setView('log');
                setTimeout(() => entriesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
              }}
            />
            <BigKpiCard
              label="Same MID, 2+ staff"
              value={summary?.sharedMids}
              sub={summary && summary.sharedMids > 0 ? `${summary.sharedMidStaff.toLocaleString()} staff · same day` : 'One MID entered by different staff on the same day'}
              icon={Copy}
              accentColor="violet"
              onClick={() => setTimeout(() => sharedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30)}
            />
          </div>
        )}
      </section>

      {/* (29 Oct 2026) Monthly history: latest month only */}
      {loadError !== 'SETUP' && history && history.length > 0 && (
        <section className="fr-table-frame bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-x-auto" aria-label="Monthly history">
          <div className="px-4 py-2.5 flex flex-wrap items-center gap-2 border-b border-slate-200">
            <h3 className="text-[13px] font-medium text-slate-900">Monthly history</h3>
            <span className="text-[11.5px] text-slate-500">· latest month only</span>
          </div>
          <div className="min-w-[880px]">
            <div className={`${HGRID} glass-table-thead navy-header-bar bg-[#003857] text-white text-[11px] font-medium uppercase tracking-wider px-3.5 py-2.5`} role="row">
              <span>Month</span>
              <span className="text-right">Entries</span>
              <span className="text-right">New Installation</span>
              <span className="text-right">QR Replacement</span>
              <span className="text-right">QR materials</span>
              <span className="text-right">Failed attempts</span>
              <span className="text-right">Staff involved</span>
              <span className="text-right" title="Wrong MID scanned, recorded at scan time (submitted or not)">Wrong scans</span>
            </div>
            <div className="divide-y divide-slate-200/90">
              {history.map((h) => (
                <div key={h.month} className={`${HGRID} px-3.5 py-2 text-[12.5px] text-slate-700`}>
                  <span className="flex items-center gap-2">
                    <span className="text-slate-900">{monthLabel(h.month)}</span>
                    <span className={`text-[10.5px] px-1.5 py-0.5 rounded-md border ${h.detailed ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                      {h.detailed ? 'Details' : 'Totals only'}
                    </span>
                  </span>
                  <span className="text-right tabular-nums font-medium text-slate-900">{h.entries.toLocaleString()}</span>
                  <span className="text-right tabular-nums">{h.install.toLocaleString()}</span>
                  <span className="text-right tabular-nums">{h.replace.toLocaleString()}</span>
                  <span className="text-right tabular-nums">{h.qr.toLocaleString()}</span>
                  <span className={`text-right tabular-nums ${h.attempts ? 'text-rose-700 font-semibold' : ''}`}>{h.attempts.toLocaleString()}</span>
                  <span className="text-right tabular-nums">{h.staffFailed.toLocaleString()}</span>
                  <span className={`text-right tabular-nums ${h.wrongScans ? 'text-orange-700 font-semibold' : ''}`}>{h.wrongScans.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* (30 Oct 2026) one MID entered by two or more staff on the same day */}
      {loadError !== 'SETUP' && shared && (
        <SharedMidTable rows={shared} periodLabel={PERIOD_LABEL[period]} innerRef={sharedRef} />
      )}

      {/* Entries: filters */}
      <section ref={entriesRef} className="bg-white rounded-2xl border border-slate-200 px-4 py-3 shadow-2xs scroll-mt-4" aria-label="Filters">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative inline-flex items-center p-1 rounded-xl bg-slate-100/90 border border-slate-200/90 gap-1" role="tablist" aria-label="View">
            {([['entries', 'KHQR entries', summary?.total], ['log', 'Failed attempts & wrong scans', summary ? summary.attempts + summary.wrongScans : undefined]] as const).map(([v, label, n]) => {
              const active = view === v;
              return (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setView(v)}
                  className={`relative px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer select-none outline-none ${
                    active ? 'text-white font-semibold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {active && (
                    <motion.div layoutId="qr-view-pill" aria-hidden className="absolute inset-0 rounded-lg tab-active-blue border border-white/10 shadow-xs" transition={SPRING} />
                  )}
                  <span className="relative z-10 flex items-center gap-1.5">
                    {v === 'log' && <span className={`w-2 h-2 rounded-full ${active ? 'bg-rose-300' : 'bg-rose-500'}`} aria-hidden />}
                    <span>{label}</span>
                    {n !== undefined && (
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
              placeholder={view === 'log' ? 'Search MID, Staff, Branch…' : 'Search MID, Merchant, Staff, Record ID…'}
              aria-label={view === 'log' ? 'Search failed attempts and wrong scans' : 'Search KHQR entries'}
              className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 outline-none focus:border-slate-400"
            />
          </div>
          <ClearFiltersButton className="!py-1.5" active={filtersActive} onClear={clearAll} />
        </div>
      </section>

      {view === 'log' && loadError !== 'SETUP' && (
        <QrAttemptLog from={from} to={to} activity={activity} branchId={branchId} staffId={staffSel?.id || ''} search={search} reloadKey={logKey} blockedCount={summary?.attempts} wrongCount={summary?.wrongScans} kind={logKind} setKind={setLogKind} />
      )}

      {view === 'entries' && (<>
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
      </>)}
    </div>
  );
};

/** (28 Oct 2026) Failed attempts log: every blocked Submit (a QR with another MID), newest first, page by page. */
const KIND_LABEL: Record<QrAttemptKind, string> = { SUBMIT_BLOCKED: 'Failed attempt', WRONG_SCAN: 'Wrong scan' };
const QrAttemptLog: React.FC<{ from: string | null; to: string | null; activity: 'ALL' | QrActivity; branchId: string; staffId: string; search: string; reloadKey: number; blockedCount?: number; wrongCount?: number;
  kind: 'ALL' | QrAttemptKind; setKind: (k: 'ALL' | QrAttemptKind) => void }> = ({
  from, to, activity, branchId, staffId, search, reloadKey, blockedCount, wrongCount, kind, setKind,
}) => {
  // (30 Oct 2026) two kinds, kept apart: Submit blocked (as before, the default) and Wrong scan (recorded at scan time)
  const [first] = useState(() => getCachedAttempts(attemptsKey({ from, to, activity, branchId: branchId || undefined, staffId: staffId || undefined, search, kind }, 1, 50)));
  const [rows, setRows] = useState<QrAttempt[] | null>(first ? first.rows : null);
  const [total, setTotal] = useState(first ? first.total : 0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const pg = usePager(total, [from, to, activity, branchId, staffId, search, kind]);
  const page = pg.page, pageSize = pg.pageSize;
  const seqRef = useRef(0);
  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    const params = { from, to, activity, branchId: branchId || undefined, staffId: staffId || undefined, search, kind, page, pageSize };
    const key = attemptsKey(params, page, pageSize);
    const hit = getCachedAttempts(key);
    if (hit) { setRows(hit.rows); setTotal(hit.total); }                // shown at once; the fresh rows replace it quietly
    setLoading(!hit);
    try {
      // the rows arrive first; "saved later" is looked up right after (one placeholder chip until then)
      const res = await fetchQrAttemptsPage({ ...params, withSaved: false });
      if (seq !== seqRef.current) return;
      const before = new Map((hit ? hit.rows : []).map((r) => [r.id, r]));
      const shown = res.rows.map((r) => { const b = before.get(r.id); return b ? { ...r, savedRecordId: b.savedRecordId, savedPending: false } : r; });
      setRows(shown); setTotal(res.total); setErr('');
      setLoading(false);
      const saved = await fetchQrSavedBySessions(Array.from(new Set(res.rows.map((r) => r.sessionId).filter(Boolean))));
      if (seq !== seqRef.current) return;
      const merged = res.rows.map((r) => ({ ...r, savedRecordId: saved.get(r.sessionId) || '', savedPending: false }));
      setCachedAttempts(key, { rows: merged, total: res.total });
      setRows(merged);
    } catch (e) {
      if (seq !== seqRef.current) return;
      setErr(e instanceof Error ? e.message : String(e)); setRows((r) => r || []);
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [from, to, activity, branchId, staffId, search, kind, page, pageSize]);
  useEffect(() => { load(); }, [load, reloadKey]);
  return (
    <section className="fr-table-frame bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-x-auto" aria-label="Failed attempts and wrong scans">
      <div className="px-4 py-2.5 flex flex-wrap items-center gap-2 border-b border-slate-200" role="tablist" aria-label="Failed attempts or wrong scans">
        {([
          ['SUBMIT_BLOCKED', 'Failed attempts', blockedCount, 'Submit was tapped while a QR had another MID: the app blocked it'],
          ['WRONG_SCAN', 'Wrong scans', wrongCount, 'A QR with another MID was scanned: recorded at once, whether or not Submit was tapped'],
          ['ALL', 'All', undefined, 'Both kinds'],
        ] as const).map(([k, label, n, tip]) => {
          const on = kind === k;
          return (
            <button key={k} type="button" role="tab" aria-selected={on} title={tip} onClick={() => setKind(k)}
              className={`px-3 py-1 rounded-full text-xs border cursor-pointer transition-colors ${on
                ? (k === 'WRONG_SCAN' ? 'bg-orange-600 text-white border-orange-600' : k === 'SUBMIT_BLOCKED' ? 'bg-rose-600 text-white border-rose-600' : 'bg-[#003857] text-white border-[#003857]')
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:text-slate-900'}`}>
              {label}{n !== undefined && <span className="ml-1 tabular-nums opacity-80">({n.toLocaleString()})</span>}
            </button>
          );
        })}
        <span className="text-[11.5px] text-slate-500 ml-1">
          {kind === 'WRONG_SCAN' ? '· Wrong scan: a QR with another MID was scanned (recorded at once, submitted or not)' : kind === 'SUBMIT_BLOCKED' ? '· Failed attempt: Submit was tapped while a QR had another MID (blocked)' : '· failed attempts and wrong scans'}
        </span>
      </div>
      <div className="min-w-[1190px]">
        <div className={`${LGRID} glass-table-thead navy-header-bar bg-[#003857] text-white text-[11px] font-medium uppercase tracking-wider px-3.5 py-3`} role="row">
          <span className="text-right">No.</span>
          <span>Time</span>
          <span>Type</span>
          <span>Staff</span>
          <span>Branch</span>
          <span>Activity</span>
          <span>Expected MID</span>
          <span>Wrong MID</span>
          <span className="text-center">QR</span>
          <span>Entry</span>
        </div>
        {err && (
          <div className="p-6 text-center text-sm text-rose-700 bg-rose-50/60">
            Could not load the records: {err}{' '}
            <button type="button" onClick={load} className="underline cursor-pointer">Try again</button>
          </div>
        )}
        {rows === null && !err && (
          <div aria-busy="true" aria-label="Loading">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-[50px] border-b border-slate-100 px-3.5 flex items-center"><div className="skeleton h-3.5 rounded w-2/3" /></div>)}
          </div>
        )}
        {rows && rows.length === 0 && !err && (
          <div className="p-10 text-center text-sm font-semibold text-emerald-700">{kind === 'WRONG_SCAN' ? 'No wrong scan matches the current filters.' : 'No failed attempt matches the current filters.'}</div>
        )}
        <div data-page-content className={`divide-y divide-slate-200/90 transition-opacity ${loading && rows ? 'opacity-60' : ''}`}>
          {(rows || []).map((a, i) => (
            <div key={a.id} className={`${LGRID} px-3.5 py-2.5 text-[12.5px] text-slate-700 hover:bg-rose-50/50`}>
              <span className="text-right tabular-nums text-slate-500">{pg.start + i + 1}</span>
              <span className="tabular-nums whitespace-nowrap" title={a.clientAt ? `On the phone: ${stampSecPP(new Date(a.clientAt))}` : undefined}>{stampSecPP(new Date(a.clientAt || a.receivedAt))}</span>
              <span>
                <span className={`inline-flex whitespace-nowrap text-[11px] px-2 py-0.5 rounded-full border ${a.kind === 'WRONG_SCAN' ? 'bg-orange-50 text-orange-800 border-orange-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>
                  {KIND_LABEL[a.kind]}
                </span>
              </span>
              <span className="leading-tight min-w-0">
                <span className="block truncate text-slate-900">{a.staffName || a.staffId}</span>
                <span className="block text-[11px] text-slate-500 font-mono">{a.staffId}</span>
              </span>
              <span className="truncate">{a.branchText || '—'}</span>
              <span className="truncate">{a.activity ? QR_ACTIVITY_LABEL[a.activity] : '—'}</span>
              <span className="font-mono tabular-nums">{a.expectedMid || '—'}</span>
              <span className="leading-tight min-w-0">
                <span className="block font-mono tabular-nums text-rose-700">{a.gotMid || '—'}</span>
                {a.gotName && <span className="block text-[11px] text-slate-500 truncate">{a.gotName}</span>}
              </span>
              <span className="text-center tabular-nums">{a.scannedCount || '—'}</span>
              <span>
                {a.savedPending ? (
                  <span className="skeleton inline-block h-5 w-20 rounded-full align-middle" aria-label="Checking" />
                ) : a.savedRecordId ? (
                  <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200 font-mono" title={a.kind === 'WRONG_SCAN' ? 'Corrected: the entry was saved later in the same scan' : 'Saved later in the same scan'}>
                    <CheckCircle2 className="w-3 h-3" /> {a.savedRecordId}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] px-2 py-0.5 rounded-full border bg-slate-50 text-slate-600 border-slate-200">Not saved</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
      <Pager pg={pg} label={kind === 'WRONG_SCAN' ? 'wrong scans' : kind === 'SUBMIT_BLOCKED' ? 'failed attempts' : 'records'} />
    </section>
  );
};

/** (30 Oct 2026) MIDs entered by two or more different staff on the same day (Phnom Penh time), newest day first. */
const SharedMidTable: React.FC<{ rows: QrSharedMid[]; periodLabel: string; innerRef: React.MutableRefObject<HTMLElement | null> }> = ({ rows, periodLabel, innerRef }) => {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section ref={innerRef} className="fr-table-frame bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-x-auto scroll-mt-4" aria-label="Same MID by two or more staff">
      <div className="px-4 py-2.5 flex flex-wrap items-center gap-2 border-b border-slate-200">
        <Copy className="w-4 h-4 text-violet-600" />
        <h3 className="text-[13px] font-medium text-slate-900">Same MID by 2+ staff</h3>
        <span className="text-[11.5px] text-slate-500">· same day (Phnom Penh time) · {periodLabel}</span>
      </div>
      <div className="min-w-[1160px]">
        <div className={`${SMGRID} glass-table-thead navy-header-bar bg-[#003857] text-white text-[11px] font-medium uppercase tracking-wider px-3.5 py-2.5`} role="row">
          <span className="text-right">No.</span>
          <span>Date</span>
          <span>MID</span>
          <span>Merchant</span>
          <span className="text-center">Staff</span>
          <span>Staff names</span>
          <span className="text-center">Entries</span>
          <span>Branches</span>
          <span>First – last</span>
          <span />
        </div>
        {rows.length === 0 && (
          <div className="p-8 text-center text-sm text-emerald-700 inline-flex w-full justify-center items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" /> No MID was entered by more than one staff member on the same day.
          </div>
        )}
        <div className="divide-y divide-slate-200/90">
          {rows.map((r, i) => {
            const key = r.day + r.mid;
            const isOpen = open === key;
            const names = Array.from(new Map(r.items.map((x) => [x.staffId, x.staffName || x.staffId])).values());
            const t = (iso: string) => stampPP(new Date(iso)).slice(11, 16);
            return (
              <div key={key}>
                <button type="button" onClick={() => setOpen(isOpen ? null : key)} aria-expanded={isOpen}
                  className={`${SMGRID} w-full text-left px-3.5 py-2.5 text-[12.5px] text-slate-700 hover:bg-violet-50/50 cursor-pointer`}>
                  <span className="text-right tabular-nums text-slate-500">{i + 1}</span>
                  <span className="tabular-nums">{r.day}</span>
                  <span className="font-mono tabular-nums text-slate-900">{r.mid}</span>
                  <span className="truncate">{r.merchantName || '—'}</span>
                  <span className="text-center tabular-nums font-semibold text-violet-700">{r.staffCount}</span>
                  <span className="truncate" title={names.join(', ')}>{names.join(', ')}</span>
                  <span className="text-center tabular-nums">{r.entries}</span>
                  <span className="truncate" title={r.branches}>{r.branches || '—'}</span>
                  <span className="tabular-nums">{t(r.firstAt)} – {t(r.lastAt)}</span>
                  <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                {isOpen && (
                  <div className="px-5 pb-3 pt-1 bg-slate-50/60">
                    <table className="w-full text-[12px] text-slate-700">
                      <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                        <th className="py-1.5 pr-3 font-medium">Time</th><th className="py-1.5 pr-3 font-medium">Record ID</th><th className="py-1.5 pr-3 font-medium">Staff</th>
                        <th className="py-1.5 pr-3 font-medium">Branch</th><th className="py-1.5 pr-3 font-medium">Activity</th><th className="py-1.5 pr-3 font-medium text-center">QR</th>
                      </tr></thead>
                      <tbody>
                        {r.items.map((x) => (
                          <tr key={x.recordId + x.at} className="border-t border-slate-200/70">
                            <td className="py-1.5 pr-3 tabular-nums">{stampSecPP(new Date(x.at))}</td>
                            <td className="py-1.5 pr-3 font-mono">{x.recordId || '—'}</td>
                            <td className="py-1.5 pr-3">{x.staffName || x.staffId} <span className="text-slate-500 font-mono text-[11px]">{x.staffId}</span></td>
                            <td className="py-1.5 pr-3">{x.branch || '—'}</td>
                            <td className="py-1.5 pr-3">{x.activity ? QR_ACTIVITY_LABEL[x.activity] : '—'}</td>
                            <td className="py-1.5 pr-3 text-center tabular-nums">{x.qr || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

interface BigKpiCardProps {
  label: string;
  value: number | undefined;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  accentColor: 'blue' | 'emerald' | 'rose' | 'amber' | 'violet' | 'orange';
  badge?: string;
  onClick?: () => void;
}

const BigKpiCard: React.FC<BigKpiCardProps> = ({
  label,
  value,
  sub,
  icon: Icon,
  accentColor,
  badge,
  onClick,
}) => {
  const isClickable = !!onClick;
  const Tag: any = isClickable ? 'button' : 'div';

  const theme = {
    blue: {
      iconBg: 'bg-sky-50 text-sky-600 border-sky-100',
      numColor: 'text-slate-900',
      hoverStyle: 'hover:border-sky-300 hover:ring-2 hover:ring-sky-100/80',
    },
    emerald: {
      iconBg: 'bg-emerald-50 text-emerald-600 border-emerald-100',
      numColor: 'text-slate-900',
      hoverStyle: 'hover:border-emerald-300 hover:ring-2 hover:ring-emerald-100/80',
    },
    rose: {
      iconBg: 'bg-rose-50 text-rose-600 border-rose-100',
      numColor: value && value > 0 ? 'text-rose-600' : 'text-slate-900',
      hoverStyle: 'hover:border-rose-300 hover:ring-2 hover:ring-rose-100/80',
    },
    orange: {
      iconBg: 'bg-orange-50 text-orange-600 border-orange-100',
      numColor: value && value > 0 ? 'text-orange-600' : 'text-slate-900',
      hoverStyle: 'hover:border-orange-300 hover:ring-2 hover:ring-orange-100/80',
    },
    violet: {
      iconBg: 'bg-violet-50 text-violet-600 border-violet-100',
      numColor: value && value > 0 ? 'text-violet-700' : 'text-slate-900',
      hoverStyle: 'hover:border-violet-300 hover:ring-2 hover:ring-violet-100/80',
    },
    amber: {
      iconBg: 'bg-amber-50 text-amber-600 border-amber-100',
      numColor: value && value > 0 ? 'text-amber-600' : 'text-slate-900',
      hoverStyle: 'hover:border-amber-300 hover:ring-2 hover:ring-amber-100/80',
    },
  }[accentColor];

  return (
    <Tag
      {...(isClickable ? { type: 'button', onClick, title: `Show ${label.toLowerCase()} log below` } : {})}
      className={`relative flex flex-col justify-between p-5 rounded-2xl border border-slate-200/90 bg-white shadow-2xs transition-all duration-200 text-left ${
        isClickable ? `cursor-pointer ${theme.hoverStyle} hover:shadow-md hover:-translate-y-0.5 group` : 'hover:border-slate-300 hover:shadow-xs'
      }`}
    >
      {/* Top row: Category Label + Icon Badge */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider truncate">
          {label}
        </span>
        <div className={`w-9.5 h-9.5 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center border shrink-0 transition-transform ${isClickable ? 'group-hover:scale-105' : ''} ${theme.iconBg}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>

      {/* Main KPI number */}
      <div className="my-2.5">
        <div className={`font-figure text-3xl sm:text-4xl font-extrabold tracking-tight tabular-nums leading-none ${theme.numColor}`}>
          {value === undefined ? '—' : value.toLocaleString()}
        </div>
      </div>

      {/* Subtitle / Footer info */}
      <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2 text-xs text-slate-500">
        <span className="truncate" title={sub}>
          {sub || '—'}
        </span>
        {isClickable ? (
          <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-rose-600 group-hover:text-rose-700 shrink-0">
            View log <span className="transition-transform group-hover:translate-x-0.5">→</span>
          </span>
        ) : badge ? (
          <span className="text-[11px] font-medium text-slate-400 shrink-0">
            {badge}
          </span>
        ) : null}
      </div>
    </Tag>
  );
};

const QrRow = memo(function QrRow({ e, no, open, onToggle }: { e: QrEntry; no: number; open: boolean; onToggle: () => void }) {
  const mapUrl = e.latitude !== null && e.longitude !== null ? `https://www.google.com/maps?q=${e.latitude},${e.longitude}` : '';
  const place = [e.location, e.khan].filter(Boolean).join(' · ');
  return (
    <div className="hover:bg-slate-50">
      <button type="button" onClick={onToggle} aria-expanded={open} className={`${GRID} w-full text-left px-3.5 py-2.5 text-[12.5px] text-slate-700 cursor-pointer relative`}>
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
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="d" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={SPRING} className="overflow-hidden">
            <div className="px-5 pb-4 pt-1 grid gap-4 md:grid-cols-2 text-[12.5px] text-slate-700">
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

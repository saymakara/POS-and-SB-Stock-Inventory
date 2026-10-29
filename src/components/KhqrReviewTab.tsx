import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, RefreshCw, ChevronDown, MapPin, CheckCircle2, Loader2, Send, QrCode, Sparkles, UserX, Layers, AlertTriangle, Users, FileSpreadsheet } from 'lucide-react';
import { Branch, UserRole } from '../types';
import { ClearFiltersButton } from './ClearFiltersButton';
import { Pager } from './Pager';
import { usePager } from '../utils/usePager';
import { stampPP, stampSecPP, todayPP } from '../utils/time';
import { csvFile } from '../utils/csv';
import {
  QrActivity, QrAttempt, QrEntry, QrQuery, QrStaffFailure, QrSummary, QR_ACTIVITY_LABEL,
  fetchQrAttemptsPage, fetchQrEntriesPage, fetchAllQrEntriesForExport, fetchQrSummary, fetchQrStaffFailures, subscribeToQrEntries,
} from '../services/supabaseService';

/**
 * Phone App Review → KHQR (28 Oct 2026).
 * New Installation and QR Replacement entries from the Merchant Visit phone app. Every QR material was scanned with the
 * camera; the app restricts Submit while any QR has another MID and records that as a "failed attempt". There is no
 * approval step here: the page shows the KHQR statistics, who had failed attempts, and every entry (newest first).
 * Up to ~50,000 entries a month: the list is read from the server one page at a time (50 or 100 rows).
 */

type Period = 'TODAY' | '7D' | 'MONTH' | '3M' | 'ALL';
const PERIOD_LABEL: Record<Period, string> = {
  TODAY: 'Today', '7D': 'Last 7 days', MONTH: 'This month', '3M': 'Last 3 months', ALL: 'All time',
};
const SPRING = { type: 'spring', stiffness: 500, damping: 32, mass: 0.55 } as const;
const SMOOTH_EXPAND = { duration: 0.22, ease: [0.16, 1, 0.3, 1] } as const;
const GRID =
  'grid items-center gap-x-3 grid-cols-[44px_140px_120px_minmax(160px,1.2fr)_115px_50px_minmax(140px,1.1fr)_90px_minmax(120px,0.9fr)_minmax(130px,0.9fr)_20px]';
const LGRID = 'grid items-center gap-x-3 grid-cols-[36px_145px_minmax(140px,1.1fr)_95px_minmax(110px,0.9fr)_108px_120px_minmax(130px,1fr)_32px_160px]';
const SGRID = 'grid items-center gap-x-3 grid-cols-[44px_minmax(160px,1.2fr)_100px_minmax(130px,1fr)_120px_160px_minmax(180px,1fr)]';

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

interface Props {
  role: UserRole;
  branches: Branch[];
  triggerToast: (msg: string) => void;
}

// Module-level shared cache so switching tabs paints instantly in 0ms without re-fetching flicker
let memorySummaryCache: QrSummary | null = null;
let memoryStaffCache: QrStaffFailure[] | null = null;
let memoryQrRowsCache: { rows: QrEntry[]; total: number } | null = null;

export const KhqrReviewTab: React.FC<Props> = ({ role, branches, triggerToast }) => {
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const [period, setPeriod] = useState<Period>('MONTH');
  const [activity, setActivity] = useState<'ALL' | QrActivity>('ALL');
  const [branchId, setBranchId] = useState('');
  const [staffSel, setStaffSel] = useState<{ id: string; name: string } | null>(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');                           // the search sent to the server (after a short debounce)
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const [rows, setRows] = useState<QrEntry[] | null>(() => memoryQrRowsCache?.rows || null);
  const [total, setTotal] = useState(() => memoryQrRowsCache?.total || 0);
  const [summary, setSummary] = useState<QrSummary | null>(() => memorySummaryCache);
  const [staff, setStaff] = useState<QrStaffFailure[] | null>(() => memoryStaffCache);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [live, setLive] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [view, setView] = useState<'entries' | 'log'>('entries');      // (28 Oct 2026) saved entries, or every blocked Submit
  const [logKey, setLogKey] = useState(0);                            // reloads the failed attempts log

  const from = useMemo(() => periodFrom(period), [period]);
  // (28 Oct 2026) every KHQR entry is a request: no Completed / Failed Attempt split (failed attempts: the log)
  const filters = useMemo<QrQuery>(() => ({ from, activity, branchId: branchId || undefined, staffId: staffSel?.id || undefined, search }),
    [from, activity, branchId, staffSel, search]);
  const pg = usePager(total, [from, activity, branchId, staffSel, search]);
  const page = pg.page, pageSize = pg.pageSize;

  // the statistics and the staff table follow the period only (one request each)
  const statSeq = useRef(0);
  const loadStats = useCallback(async () => {
    const seq = ++statSeq.current;
    const [sum, st] = await Promise.all([fetchQrSummary(from, null), fetchQrStaffFailures(from, null)]);
    if (seq !== statSeq.current) return;
    if (sum) { setSummary(sum); memorySummaryCache = sum; }
    if (st) { setStaff(st); memoryStaffCache = st; }
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
      memoryQrRowsCache = { rows: res.rows, total: res.total };
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
      if (!statTimer) statTimer = setTimeout(() => { statTimer = null; loadStats(); setLogKey((k) => k + 1); }, 5000);
    });
    const t = setTimeout(() => setLive(true), 2500);
    return () => { unsub(); clearTimeout(t); if (statTimer) clearTimeout(statTimer); };
  }, [loadStats]);

  const filtersActive = !!query || activity !== 'ALL' || !!branchId || !!staffSel || period !== 'MONTH';
  const clearAll = () => { setQuery(''); setSearch(''); setActivity('ALL'); setBranchId(''); setStaffSel(null); setPeriod('MONTH'); };
  const branchOptions = useMemo(
    () => [...branches].sort((a, b) => String(a.code || a.id).localeCompare(String(b.code || b.id), undefined, { numeric: true })),
    [branches]
  );
  const loadingFirst = rows === null;
  const entriesRef = useRef<HTMLElement | null>(null);
  const showStaff = (s: QrStaffFailure) => {
    setStaffSel({ id: s.staffId, name: s.staffName || s.staffId });
    setView('log');
    setTimeout(() => entriesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const [exporting, setExporting] = useState(false);

  const handleExportCsv = useCallback(async () => {
    if (view === 'entries') {
      if (!rows || rows.length === 0) return;
      setExporting(true);
      try {
        let exportData = rows;
        // If there are more entries matching on the server than what's on the current page, fetch all matching (up to 5000)
        if (total > rows.length) {
          const allEntries = await fetchAllQrEntriesForExport(filters, 5000);
          if (allEntries && allEntries.length > 0) {
            exportData = allEntries;
          }
        }

        const headers = [
          'No.',
          'Date Sent',
          'Activity',
          'Record ID',
          'Merchant Name',
          'Merchant Name (KH)',
          'MID',
          'QR Count',
          'Staff Name',
          'Staff ID',
          'Branch',
          'Location',
          'Khan / District',
          'GPS Latitude',
          'GPS Longitude',
          'Failed Attempts Count',
          'Status',
          'Remarks',
        ];

        const csvRows = exportData.map((e, idx) => [
          String(idx + 1),
          fmt(e.submittedAt),
          (e.activity && QR_ACTIVITY_LABEL[e.activity]) || e.activity || '',
          e.recordId || '',
          e.merchantName || '',
          e.merchantNameKh || '',
          e.mid || '',
          String(e.qrCount ?? 1),
          e.staffName || '',
          e.staffId || '',
          e.branchText || (e.branchId ? `Branch ${e.branchId}` : ''),
          e.location || '',
          e.khan || '',
          e.latitude != null ? String(e.latitude) : '',
          e.longitude != null ? String(e.longitude) : '',
          String(e.failedAttempts || 0),
          e.status === 'COMPLETED' ? 'Completed' : 'Failed attempt',
          e.remark || '',
        ]);

        const filename = `KHQR_Review_Entries_${todayPP()}.csv`;
        const blob = csvFile([headers, ...csvRows]);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 1000);

        triggerToast(`Exported ${exportData.length} KHQR entries to CSV`);
      } catch {
        triggerToast('Failed to export KHQR entries to CSV');
      } finally {
        setExporting(false);
      }
    } else {
      // Failed attempts view
      setExporting(true);
      try {
        const res = await fetchQrAttemptsPage({ from, activity, branchId: branchId || undefined, staffId: staffSel?.id || undefined, search, page: 1, pageSize: 100 });
        if (!res.rows || res.rows.length === 0) {
          triggerToast('No failed attempts to export');
          return;
        }
        const headers = [
          'No.',
          'Date & Time',
          'Activity',
          'Staff Name',
          'Staff ID',
          'Branch',
          'Expected MID',
          'Scanned / Got MID',
          'Got Name',
          'Scanned Count',
        ];
        const csvRows = res.rows.map((a, idx) => [
          String(idx + 1),
          fmt(a.receivedAt || a.clientAt),
          (a.activity && QR_ACTIVITY_LABEL[a.activity]) || a.activity || '',
          a.staffName || '',
          a.staffId || '',
          a.branchText || '',
          a.expectedMid || '',
          a.gotMid || '',
          a.gotName || '',
          String(a.scannedCount || 1),
        ]);
        const filename = `KHQR_Failed_Attempts_Log_${todayPP()}.csv`;
        const blob = csvFile([headers, ...csvRows]);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 1000);

        triggerToast(`Exported ${res.rows.length} failed attempt records to CSV`);
      } catch {
        triggerToast('Failed to export attempts log');
      } finally {
        setExporting(false);
      }
    }
  }, [view, rows, total, filters, from, activity, branchId, staffSel, search, triggerToast]);

  return (
    <div className="flex flex-col gap-3.5 apple-tab-panel">
      {/* KHQR statistics (this tab shows KHQR only) */}
      <section className="bg-white rounded-2xl border border-slate-200/90 p-4.5 sm:p-5 shadow-2xs" aria-label="KHQR statistics">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <h2 className="text-sm font-semibold text-slate-900 tracking-tight">
              Phone App Review<span className="text-slate-500 font-normal"> · KHQR</span>
            </h2>
            <span
              className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/90"
              title="New KHQR entries from the phone app are announced as they are saved"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden />
              {live ? 'Live' : 'Connected'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as Period)}
              aria-label="Period"
              className="btn-press px-3 py-1.5 rounded-xl text-xs font-medium border bg-white hover:bg-slate-50 text-slate-700 border-slate-200 outline-none focus:border-slate-400 cursor-pointer shadow-2xs transition"
            >
              {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}
            </select>
            <button
              type="button"
              onClick={() => { load(); loadStats(); setLogKey((k) => k + 1); }}
              aria-label="Refresh"
              title="Refresh KHQR statistics and entries"
              className="btn-press p-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 cursor-pointer transition shadow-2xs"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
        {loadError === 'SETUP' ? (
          <div className="py-8 text-center text-sm text-slate-600">
            <QrCode className="w-8 h-8 mx-auto mb-2 text-slate-400" />
            The KHQR tables are not set up in the database yet. Apply the migration <span className="font-mono text-xs">20261028_02_khqr_installation.sql</span>, then refresh.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
            <BigKpiCard
              label="KHQR Entries"
              value={summary?.total}
              sub={summary ? `${summary.install.toLocaleString()} new · ${summary.replace.toLocaleString()} replaced` : 'Registered KHQR installations'}
              icon={QrCode}
              accentColor="blue"
              badge={summary ? '100% Synced' : undefined}
            />
            <BigKpiCard
              label="QR Materials"
              value={summary?.qr}
              sub={summary && summary.total ? `${(summary.qr / summary.total).toFixed(1)} materials / entry` : PERIOD_LABEL[period]}
              icon={Layers}
              accentColor="emerald"
              badge="Physical items"
            />
            <BigKpiCard
              label="Failed Attempt"
              value={summary?.attempts}
              sub="Submit blocked · MID mismatch"
              icon={AlertTriangle}
              accentColor="rose"
              onClick={() => {
                setView('log');
                setTimeout(() => entriesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
              }}
            />
            <BigKpiCard
              label="Staff Involved"
              value={summary?.staffFailed}
              sub="Recorded failed attempts"
              icon={Users}
              accentColor="amber"
              badge={staff && staff.length > 0 ? `${staff.length} staff` : undefined}
            />
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
          <div className="min-w-[1040px]">
            <div className={`${SGRID} glass-table-thead navy-header-bar bg-[#003857] text-white text-[11px] font-medium uppercase tracking-wider px-3.5 py-2.5`} role="row">
              <span className="text-right">No.</span>
              <span>Staff Name</span>
              <span>Staff ID</span>
              <span>Branch</span>
              <span className="text-right">Failed attempts</span>
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
                  title="Show this staff member's failed attempts"
                  className={`${SGRID} w-full text-left px-3.5 py-2 text-[12.5px] text-slate-700 hover:bg-rose-50/60 cursor-pointer`}
                >
                  <span className="text-right tabular-nums text-slate-500">{i + 1}</span>
                  <span className="truncate font-medium text-slate-900" title={s.staffName || s.staffId}>
                    {s.staffName || '—'}
                  </span>
                  <span className="font-mono text-[11.5px] text-slate-600 tabular-nums">
                    {s.staffId || '—'}
                  </span>
                  <span className="truncate">{s.branchText || '—'}</span>
                  <span className="text-right tabular-nums font-semibold text-rose-700">{s.attempts.toLocaleString()}</span>
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
          <div className="relative inline-flex items-center p-1 rounded-xl bg-slate-100/90 border border-slate-200/90 gap-1" role="tablist" aria-label="View">
            {([['entries', 'KHQR entries', summary?.total], ['log', 'Failed attempts log', summary?.attempts]] as const).map(([v, label, n]) => {
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
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={view === 'log' ? 'Search MID, Staff, Branch…' : 'Search MID, Merchant, Staff, Record ID…'}
              aria-label={view === 'log' ? 'Search failed attempts' : 'Search KHQR entries'}
              className="w-full pl-8 pr-7 py-1.5 rounded-xl border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 outline-none focus:border-slate-400"
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(''); setSearch(''); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm w-5 h-5 flex items-center justify-center rounded cursor-pointer select-none"
                title="Clear search"
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>
          <ClearFiltersButton className="!py-1.5" active={filtersActive} onClear={clearAll} />
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={exporting || (view === 'entries' ? !rows || rows.length === 0 : false)}
            title={view === 'entries' ? `Export ${total || (rows?.length || 0)} KHQR entries to CSV` : 'Export failed attempts log to CSV'}
            className="btn-press px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium cursor-pointer transition shadow-2xs flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed select-none"
          >
            {exporting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" />
            ) : (
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            )}
            <span>Export CSV</span>
          </button>
        </div>
      </section>

      {/* Instant view switching: both views preserved in DOM without unmounting/re-fetching */}
      {loadError !== 'SETUP' && (
        <>
          <div className={view === 'log' ? 'block' : 'hidden'}>
            <QrAttemptLog from={from} activity={activity} branchId={branchId} staffId={staffSel?.id || ''} search={search} reloadKey={logKey} />
          </div>

          <div className={view === 'entries' ? 'flex flex-col gap-3.5' : 'hidden'}>
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
              <div className="min-w-[1280px]">
                <div className={`${GRID} glass-table-thead navy-header-bar bg-[#003857] text-white border-b border-slate-300 text-[11px] font-medium uppercase tracking-wider px-3.5 py-3`} role="row">
                  <span className="text-right">No.</span>
                  <span>Date Sent</span>
                  <span>Activity</span>
                  <span>Merchant Name</span>
                  <span>MID</span>
                  <span className="text-center">QR</span>
                  <span>Staff Name</span>
                  <span>Staff ID</span>
                  <span>Branch</span>
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
          </div>
        </>
      )}
    </div>
  );
};

/** (28 Oct 2026) Failed attempts log: every blocked Submit (a QR with another MID), newest first, page by page. */
const QrAttemptLog = memo(function QrAttemptLog({
  from, activity, branchId, staffId, search, reloadKey,
}: { from: string | null; activity: 'ALL' | QrActivity; branchId: string; staffId: string; search: string; reloadKey: number }) {
  const [rows, setRows] = useState<QrAttempt[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const pg = usePager(total, [from, activity, branchId, staffId, search]);
  const page = pg.page, pageSize = pg.pageSize;
  const seqRef = useRef(0);
  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const res = await fetchQrAttemptsPage({ from, activity, branchId: branchId || undefined, staffId: staffId || undefined, search, page, pageSize });
      if (seq !== seqRef.current) return;
      setRows(res.rows); setTotal(res.total); setErr('');
    } catch (e) {
      if (seq !== seqRef.current) return;
      setErr(e instanceof Error ? e.message : String(e)); setRows((r) => r || []);
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [from, activity, branchId, staffId, search, page, pageSize]);
  useEffect(() => { load(); }, [load, reloadKey]);
  return (
    <section className="fr-table-frame bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-x-auto" aria-label="Failed attempts log">
      <div className="min-w-[1140px]">
        <div className={`${LGRID} glass-table-thead navy-header-bar bg-[#003857] text-white text-[11px] font-medium uppercase tracking-wider px-3.5 py-3`} role="row">
          <span className="text-right">No.</span>
          <span>Time</span>
          <span>Staff Name</span>
          <span>Staff ID</span>
          <span>Branch</span>
          <span>Activity</span>
          <span>Expected MID</span>
          <span>Wrong MID</span>
          <span className="text-center">QR</span>
          <span>Entry</span>
        </div>
        {err && (
          <div className="p-6 text-center text-sm text-rose-700 bg-rose-50/60">
            Could not load the failed attempts: {err}{' '}
            <button type="button" onClick={load} className="underline cursor-pointer">Try again</button>
          </div>
        )}
        {rows === null && !err && (
          <div aria-busy="true" aria-label="Loading">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-[50px] border-b border-slate-100 px-3.5 flex items-center"><div className="skeleton h-3.5 rounded w-2/3" /></div>)}
          </div>
        )}
        {rows && rows.length === 0 && !err && (
          <div className="p-10 text-center text-sm font-semibold text-emerald-700">No failed attempt matches the current filters.</div>
        )}
        <div data-page-content className={`divide-y divide-slate-200/90 transition-opacity ${loading && rows ? 'opacity-60' : ''}`}>
          {(rows || []).map((a, i) => (
            <div key={a.id} className={`${LGRID} px-3.5 py-2.5 text-[12.5px] text-slate-700 hover:bg-rose-50/50`}>
              <span className="text-right tabular-nums text-slate-500">{pg.start + i + 1}</span>
              <span className="tabular-nums whitespace-nowrap" title={a.clientAt ? `On the phone: ${stampSecPP(new Date(a.clientAt))}` : undefined}>{stampSecPP(new Date(a.clientAt || a.receivedAt))}</span>
              <span className="truncate font-medium text-slate-900" title={a.staffName || a.staffId}>
                {a.staffName || '—'}
              </span>
              <span className="font-mono text-[11.5px] text-slate-600 tabular-nums">
                {a.staffId || '—'}
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
                {a.savedRecordId ? (
                  <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200 font-mono" title="Saved later in the same scan">
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
      <Pager pg={pg} label="failed attempts" />
    </section>
  );
});

interface BigKpiCardProps {
  label: string;
  value: number | undefined;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  accentColor: 'blue' | 'emerald' | 'rose' | 'amber';
  badge?: string;
  onClick?: () => void;
}

const BigKpiCard = memo(function BigKpiCard({
  label,
  value,
  sub,
  icon: Icon,
  accentColor,
  badge,
  onClick,
}: BigKpiCardProps) {
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
});

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
        <span className="leading-tight min-w-0" title={e.merchantNameKh ? `${e.merchantName} · ${e.merchantNameKh}` : e.merchantName}>
          <span className="block truncate font-medium text-slate-900">{e.merchantName || e.merchantNameKh || '—'}</span>
          {e.merchantNameKh && e.merchantName && (
            <span className="block text-[11px] text-slate-500 truncate">{e.merchantNameKh}</span>
          )}
        </span>
        <span className="font-mono text-[11.5px] text-slate-700 tabular-nums truncate" title={e.mid}>
          {e.mid || '—'}
        </span>
        <span className="text-center tabular-nums font-medium" title={`${e.qrCount} QR material(s) scanned`}>{e.qrCount}</span>
        <span className="truncate font-medium text-slate-900" title={e.staffName || e.staffId}>
          {e.staffName || '—'}
        </span>
        <span className="font-mono text-[11.5px] text-slate-600 tabular-nums truncate">
          {e.staffId || '—'}
        </span>
        <span className="truncate text-slate-700" title={e.branchText || e.branchId || undefined}>
          {e.branchText || e.branchId || '—'}
        </span>
        <span className="truncate" title={place}>{place || '—'}</span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="d" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={SMOOTH_EXPAND} className="overflow-hidden">
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

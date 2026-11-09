import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { isFresh, markFresh } from '../utils/freshness';
import { motion, AnimatePresence } from 'motion/react';
import { Search, RefreshCw, ChevronDown, MapPin, Loader2, Send, ClipboardList, Users, Building2, Navigation, PencilLine, Trash2 } from 'lucide-react';
import { Branch, UserRole } from '../types';
import { ClearFiltersButton } from './ClearFiltersButton';
import { ExportCsvButton } from './ExportCsvButton';
import { downloadCsv, collectAll, csvTime } from '../utils/exportCsv';
import { Pager } from './Pager';
import { usePager } from '../utils/usePager';
import { stampPP, stampSecPP } from '../utils/time';
import { MvVisit, MvVisitQuery, MvVisitSummary, fetchMvVisitsPage, fetchMvVisitSummary, deletePhoneRecords } from '../services/supabaseService';
import { getMvPage, setMvPage, getMvSummary, setMvSummary, clearMvCache } from '../services/mvCache';
const mvKey = (r: { from: string | null; to: string | null }, activity: string, branchId: string, search: string, page: number, pageSize: number) =>
  JSON.stringify([r.from, r.to, activity, branchId, search, page, pageSize]);
import { DeleteRecordsDialog, NoCell, SelectBox, useRecordSelection } from './DeleteRecordsDialog';
import { PhoneRecordEditDialog, EditField } from './PhoneRecordEditDialog';
import { Period, periodRange } from '../services/khqrCache';
import { CopyableRecordId } from './CopyableRecordId';

/**
 * Phone App Review → Merchant Visit (4 Nov 2026).
 * Every Merchant Visit form activity from the phone app (Account Opening, QR Merchant Onboarding, KHQR Issue, ABA Mobile
 * Support, Key Merchant Visit, ...). KHQR New Installation / QR Replacement have their own page (KHQR). No approval step:
 * the page shows the totals of the period and every visit (newest first), read from the server one page at a time.
 * The questions of the visit form are set in the phone app's Fields tab, so each visit's answers are shown as they came.
 */

const PERIOD_LABEL: Record<Period, string> = {
  ALL: 'All time', TODAY: 'Today', '7D': 'Last 7 days', MONTH: 'This month', LAST: 'Last month', BOTH: 'Last 2 months',
};
const SPRING = { type: 'spring', stiffness: 500, damping: 32, mass: 0.55 } as const;
const GRID = 'grid items-center gap-x-3 grid-cols-[68px_150px_minmax(150px,1fr)_minmax(200px,1.4fr)_minmax(160px,1fr)_minmax(140px,1fr)_20px]';
const isMissingTable = (msg: string) => /mv_visits|mv_visit_summary|PGRST20[25]|does not exist|schema cache/i.test(msg);
const fmt = (iso: string | null) => (iso ? stampPP(new Date(iso)) : '—');
// answers already shown in their own line of the details
const SHOWN = new Set(['activity type', 'merchant name', 'mid or acc number', 'account number', 'location', 'khan', 'latitude', 'longitude', 'remarks']);

interface Props {
  role: UserRole;
  branches: Branch[];
  triggerToast: (msg: string) => void;
}

export const MerchantVisitTab: React.FC<Props> = ({ role, branches, triggerToast }) => {
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const isSuper = role === 'SUPER_ADMIN';                            // (4 Nov 2026) only a Super Admin deletes
  const pick = useRecordSelection();
  const [delOpen, setDelOpen] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  const [period, setPeriod] = useState<Period>('MONTH');
  const [activity, setActivity] = useState('');
  const [branchId, setBranchId] = useState('');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [search, setSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSearch(deferredQuery.trim()), 350);
    return () => clearTimeout(t);
  }, [deferredQuery]);

  // the page as it was last shown (memory only): no "Loading" flash when coming back
  const [first] = useState(() => getMvPage(mvKey(periodRange('MONTH'), '', '', '', 1, 50)));
  const [rows, setRows] = useState<MvVisit[] | null>(first ? first.rows : null);
  const [total, setTotal] = useState(first ? first.total : 0);
  const [summary, setSummary] = useState<MvVisitSummary | null>(() => getMvSummary(`${periodRange('MONTH').from}|${periodRange('MONTH').to}`) || null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<MvVisit | null>(null);   // (7 Nov 2026) Edit details
  const seq = useRef(0);

  const range = useMemo(() => periodRange(period), [period]);
  const from = range.from, to = range.to;
  const filters = useMemo<MvVisitQuery>(() => ({ from, to, activity: activity || undefined, branchId: branchId || undefined, search }),
    [from, to, activity, branchId, search]);
  const pg = usePager(total, [from, to, activity, branchId, search]);
  const page = pg.page, pageSize = pg.pageSize;

  const load = useCallback(async (force = false) => {
    const my = ++seq.current;
    const key = mvKey({ from, to }, activity, branchId, search, page, pageSize);
    const hit = getMvPage(key);
    if (hit) { setRows(hit.rows); setTotal(hit.total); }               // the last answer at once; the fresh one replaces it
    if (hit && force !== true && isFresh('mv:p:' + key)) { setLoading(false); return; }   // (5 Nov 2026) fetched moments ago
    setLoading(!hit);
    try {
      const res = await fetchMvVisitsPage({ ...filters, page, pageSize });
      if (my !== seq.current) return;
      setMvPage(key, { rows: res.rows, total: res.total });
      markFresh('mv:p:' + key);
      setRows(res.rows); setTotal(res.total); setLoadError('');
    } catch (err) {
      if (my !== seq.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      setLoadError(isMissingTable(msg) ? 'SETUP' : msg);
      setRows((r) => r || []);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [filters, page, pageSize, from, to, activity, branchId, search]);
  const loadStats = useCallback(async (force = false) => {
    const k = `${from}|${to}`;
    const hit = getMvSummary(k);
    if (hit) setSummary(hit);
    if (hit && force !== true && isFresh('mv:s:' + k)) return;
    const s = await fetchMvVisitSummary(from, to);
    if (s) { setMvSummary(k, s); markFresh('mv:s:' + k); }
    setSummary((prev) => s || prev);                                   // a failed refresh keeps the numbers on screen
  }, [from, to]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadStats(); }, [loadStats]);

  const activities = useMemo(() => {
    const list = (summary?.byActivity || []).map((a) => a.activity).filter((a) => a && a !== '(none)');
    if (activity && !list.includes(activity)) list.unshift(activity);
    return list;
  }, [summary, activity]);
  const filtered = !!(activity || branchId || query);

  const exportCsv = useCallback(async () => {
    const list = await collectAll((p1) => fetchMvVisitsPage({ ...filters, page: p1, pageSize: 1000 }));
    if (!list.length) return 0;
    const extra = Array.from(new Set(list.flatMap((v) => Object.keys(v.answers)).filter((k) => !SHOWN.has(k.toLowerCase())))).sort();
    downloadCsv(`Merchant_Visits_${PERIOD_LABEL[period].replace(/\s+/g, '_')}`,
      ['Record ID', 'Date Sent', 'Activity', 'Merchant Name', 'MID / Account', 'Staff ID', 'Staff Name', 'Branch', 'Branch Code', 'Location', 'Khan',
        'Latitude', 'Longitude', 'Remarks', 'Photos (Telegram)', 'Edited'].concat(extra),
      list.map((v) => [v.recordId, csvTime(v.submittedAt), v.activity, v.merchantName, v.mid, v.staffId, v.staffName, v.branchText, v.branchId, v.location, v.khan,
        v.latitude, v.longitude, v.remarks, v.photoLink, csvTime(v.editedAt)].concat(extra.map((k) => v.answers[k] || ''))));
    return list.length;
  }, [filters, period]);

  const runDelete = async (reason: string) => {
    setDelBusy(true);
    try {
      const res = await deletePhoneRecords('VISIT', Array.from(pick.sel.keys()), reason);
      pick.clear(); setDelOpen(false); setOpen(null); clearMvCache();   // never show the deleted rows again, even for a moment
      triggerToast(`${res.deleted} visit(s) deleted permanently`);
      load(true); loadStats(true);
    } catch (err) {
      triggerToast(`Not deleted: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setDelBusy(false); }
  };
  const pageItems = (rows || []).map((v) => ({ id: v.id, rec: v.recordId }));
  const pageAll = pageItems.length > 0 && pageItems.every((i) => pick.sel.has(i.id));

  const top = summary?.byActivity?.slice(0, 3) || [];
  return (
    <div className="flex flex-col gap-3.5 apple-tab-panel">
      <section className="relative overflow-hidden rounded-3xl p-6 sm:p-8 border shadow-sm bg-slate-100 border-slate-200/90 text-slate-900" aria-label="Merchant visit statistics">
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2 max-w-3xl">
            <h1 className="text-2xl sm:text-3xl lg:text-[32px] font-extrabold tracking-tight flex items-center gap-3 text-slate-900 leading-tight">
              <ClipboardList className="w-7 h-7 sm:w-8 sm:h-8 shrink-0 text-indigo-600" aria-hidden />
              <span>Merchant Visit</span>
            </h1>
            <p className="text-sm sm:text-base leading-relaxed text-slate-600">
              Every merchant visit sent from the Merchant Visit app: account opening, QR onboarding, KHQR issues, support and key merchant visits.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as Period)}
              aria-label="Period"
              className="px-3 py-2 rounded-xl text-xs sm:text-sm font-normal border bg-white hover:bg-slate-50 text-slate-700 border-slate-200/90 shadow-2xs outline-none cursor-pointer"
            >
              {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}
            </select>
            <ExportCsvButton onExport={exportCsv} toast={triggerToast} title="Save the visits that match the filters as a CSV file (every answer in its own column)" />
            <button
              type="button"
              onClick={() => { load(true); loadStats(true); }}
              aria-label="Refresh"
              title="Refresh the visits"
              className="group relative inline-flex items-center gap-2 px-3.5 py-2 rounded-xl active:scale-[0.98] transition-all font-semibold text-xs sm:text-sm border shadow-2xs cursor-pointer bg-white hover:bg-slate-50 text-slate-700 border-slate-200/90"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-600" /> : <RefreshCw className="w-3.5 h-3.5 text-slate-600 group-hover:rotate-180 transition-transform duration-300" />}
              <span>Refresh</span>
            </button>
          </div>
        </div>
        {loadError === 'SETUP' ? (
          <div className="py-6 text-center text-sm text-slate-600 mt-6 pt-6 border-t border-slate-200/90">
            The merchant visit table is not set up in the database yet. Apply the migration <span className="font-mono text-xs">20261104_03_merchant_visit_all_to_portal.sql</span>, then refresh.
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mt-6 pt-6 border-t border-slate-200/90">
            <Kpi icon={ClipboardList} label="Visits" value={summary?.total} sub={top.length ? top.map((a) => `${a.activity} ${a.n.toLocaleString()}`).join(' · ') : PERIOD_LABEL[period]} />
            <Kpi icon={Users} label="Staff" value={summary?.staff} sub="sent at least one visit" />
            <Kpi icon={Building2} label="Branches" value={summary?.branches}
              sub={summary && summary.noBranch ? `${summary.noBranch.toLocaleString()} visit(s) without a matched branch` : 'with visits'} />
            <Kpi icon={Navigation} label="With GPS" value={summary?.withGps}
              sub={summary && summary.total ? `${Math.round((summary.withGps / summary.total) * 100)}% of visits` : 'location recorded'} />
          </div>
        )}
      </section>

      {/* Filters & Inline Selection Toolbar */}
      <section
        className="flex flex-wrap items-center justify-between gap-2.5 bg-white rounded-2xl border border-slate-200 shadow-2xs px-3.5 py-2.5 min-h-[52px]"
        aria-label="Filters"
      >
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-0">
          <label className="relative w-64 sm:w-72 lg:w-80 shrink-0">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search merchant, MID, Record ID or staff"
              aria-label="Search"
              className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs sm:text-sm outline-none focus:border-slate-400 bg-white placeholder:text-slate-400 shadow-2xs transition-colors"
            />
          </label>
          <select
            value={activity}
            onChange={(e) => setActivity(e.target.value)}
            aria-label="Activity"
            className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs sm:text-sm text-slate-700 cursor-pointer shadow-2xs outline-none"
          >
            <option value="">All activities</option>
            {activities.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          {isAdmin && (
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              aria-label="Branch"
              className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs sm:text-sm text-slate-700 cursor-pointer max-w-[260px] shadow-2xs outline-none"
            >
              <option value="">All branches</option>
              <option value="NONE">No matched branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.id} · {b.name}
                </option>
              ))}
            </select>
          )}
          <ClearFiltersButton active={filtered} onClear={() => { setActivity(''); setBranchId(''); setQuery(''); }} />
        </div>

        {/* Inline Selection Actions — Keeps table frame completely stable with 0px layout shift */}
        {isSuper && pick.sel.size > 0 && (
          <div
            className="flex items-center gap-2.5 shrink-0 bg-indigo-50/70 border border-indigo-200/80 px-3 py-1 rounded-xl transition-all"
            aria-label="Selected records"
          >
            <span className="font-mono text-xs font-semibold text-indigo-900">
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
      </section>
      <DeleteRecordsDialog open={delOpen} count={pick.sel.size} what="merchant visits" sample={Array.from(pick.sel.values())}
        busy={delBusy} onCancel={() => setDelOpen(false)} onConfirm={runDelete} />

      {/* Visits */}
      <section className="fr-table-frame bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-x-auto overflow-y-hidden" aria-label="Merchant visits">
        <div className="min-w-[1000px]">
          <div className={`${GRID} glass-table-thead navy-header-bar bg-[#003857] text-white border-b border-slate-300 text-[11px] font-medium uppercase tracking-wider px-3.5 py-2`} role="row">
            <NoCell
              header
              box={isSuper && pageItems.length > 0 && (
                <SelectBox light checked={pageAll} onChange={() => pick.setMany(pageItems, !pageAll)} label={pageAll ? 'Unselect this page' : 'Select this page'} />
              )}
              onBoxClick={isSuper && pageItems.length > 0 ? () => pick.setMany(pageItems, !pageAll) : undefined}
            >
              No.
            </NoCell>
            <span>Date Sent</span>
            <span>Activity</span>
            <span>Merchant / MID</span>
            <span>Staff / Branch</span>
            <span>Location</span>
            <span />
          </div>
          {loadError && loadError !== 'SETUP' && (
            <div className="p-6 text-center text-sm text-rose-700 bg-rose-50/60">
              Could not load the visits: {loadError}{' '}
              <button type="button" onClick={() => load(true)} className="underline cursor-pointer">Try again</button>
            </div>
          )}
          {rows === null && !loadError && (
            <div aria-busy="true" aria-label="Loading">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-[54px] border-b border-slate-100 px-3.5 flex items-center"><div className="skeleton h-3.5 rounded w-2/3" /></div>
              ))}
            </div>
          )}
          {rows && rows.length === 0 && !loadError && (
            <div className="p-10 text-center text-sm text-slate-500">
              {filtered ? 'No visit matches these filters.' : `No merchant visit in ${PERIOD_LABEL[period].toLowerCase()} yet.`}
            </div>
          )}
          <div className="divide-y divide-slate-100">
            {(rows || []).map((v, i) => (
              <VisitRow key={v.id} v={v} no={(page - 1) * pageSize + i + 1} open={open === v.id} onToggle={() => setOpen((o) => (o === v.id ? null : v.id))}
                checked={pick.sel.has(v.id)} onCheck={isSuper ? () => pick.toggle(v.id, v.recordId) : undefined} onEdit={isAdmin ? () => setEditing(v) : undefined} />
            ))}
          </div>
        </div>
      </section>
      {total > 0 && <Pager pg={pg} label="visits" />}
      {editing && (
        <PhoneRecordEditDialog open={!!editing} source="VISIT" rowId={editing.id} title={`Edit ${editing.recordId}`}
          sub={`Merchant Visit · ${editing.activity || '—'} · ${editing.staffName || editing.staffId}`}
          fields={visitEditFields(editing)}
          note="Saved in the portal at once, and written to the same row of the Merchant Visit Google Sheet within a few minutes."
          onClose={() => setEditing(null)} onSaved={() => { clearMvCache(); load(true); }} triggerToast={triggerToast} />
      )}
    </div>
  );
};

const Kpi: React.FC<{ icon: React.ElementType; label: string; value: number | undefined; sub: string }> = ({ icon: Icon, label, value, sub }) => (
  <div className="rounded-2xl bg-white border border-slate-200/90 px-4 py-3.5 shadow-2xs min-w-0">
    <div className="flex items-center gap-2 text-slate-500 text-xs font-semibold uppercase tracking-wide">
      <Icon className="w-4 h-4 text-[#003857]" aria-hidden />{label}
    </div>
    <div className="mt-1.5 text-2xl font-extrabold tabular-nums text-slate-900">{value === undefined ? '—' : value.toLocaleString()}</div>
    <div className="mt-0.5 text-xs text-slate-500 truncate" title={sub}>{sub}</div>
  </div>
);

/* (7 Nov 2026) Edit: every answer of the visit, in the form's order (the Merchant Visit app's Sheet columns). */
const VISIT_ORDER = ['Activity Type', 'Tag', 'Merchant Name', 'MID or Acc Number', 'Phone Number', 'Business Type', 'Location', 'Khan', 'Latitude', 'Longitude', 'Address', 'Product Types', 'Remarks'];
const VISIT_ACTIVITIES = ['Account Opening', 'QR Merchant Onboarding', 'Declined – Cash Only (No QR)', 'KHQR Issue', 'ABA Mobile Support', "Other Bank's Promo",
  'ABA QR in Good Condition', 'Key Merchant Visit', 'PaySound / Alert Telegram', 'On-site ATM Location', 'Bring Document to Merchant',
  'Market Coverage', 'Review Giant QR', 'ABA Gasoline Logo', 'Payway Inspection'];
export function visitEditFields(v: MvVisit): EditField[] {
  const a: Record<string, string> = { ...v.answers };
  if (!('Remarks' in a)) a.Remarks = v.remarks || '';
  const keys = Object.keys(a).sort((x, y) => { const i = VISIT_ORDER.indexOf(x), j = VISIT_ORDER.indexOf(y); return (i < 0 ? 99 : i) - (j < 0 ? 99 : j); });
  return keys.map((k) => ({ key: 'answers.' + k, label: k, value: a[k], multiline: /^(remarks|address)$/i.test(k),
    options: k === 'Activity Type' ? VISIT_ACTIVITIES : undefined }));
}

const VisitRow = memo(function VisitRow({ v, no, open, onToggle, checked, onCheck, onEdit }: {
  v: MvVisit; no: number; open: boolean; onToggle: () => void; checked?: boolean; onCheck?: () => void; onEdit?: () => void;
}) {
  const mapUrl = v.latitude !== null && v.longitude !== null ? `https://www.google.com/maps?q=${v.latitude},${v.longitude}` : '';
  const place = [v.location, v.khan].filter(Boolean).join(' · ');
  const others = Object.entries(v.answers).filter(([k]) => !SHOWN.has(k.toLowerCase()));
  return (
    <div className={checked ? 'bg-indigo-50/70' : 'hover:bg-slate-50'}>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onToggle(); } }}
        aria-expanded={open}
        className={`${GRID} w-full text-left px-3.5 py-2.5 text-[13px] text-slate-700 cursor-pointer relative select-none`}
      >
        <NoCell className="text-slate-500" onBoxClick={onCheck} box={onCheck && <SelectBox checked={!!checked} onChange={onCheck} label={`Select ${v.recordId}`} />}>{no}</NoCell>
        <span className="leading-tight min-w-0">
          <span className="block tabular-nums">{fmt(v.submittedAt)}</span>
          <CopyableRecordId id={v.recordId} />
        </span>
        <span className="truncate" title={v.activity}>{v.activity || '—'}</span>
        <span className="leading-tight min-w-0">
          <span className="block truncate text-slate-900" title={v.merchantName}>{v.merchantName || '—'}</span>
          <span className="block text-[11px] text-slate-500 font-mono tabular-nums">{v.mid}</span>
        </span>
        <span className="leading-tight min-w-0">
          <span className="block truncate">{v.staffName || v.staffId}</span>
          <span className="block text-[11px] text-slate-500 truncate">{v.branchText || v.branchId || '—'}</span>
        </span>
        <span className="truncate" title={place}>{place || '—'}</span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="d" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={SPRING} className="overflow-hidden">
            <div className="px-5 pb-4 pt-1 grid gap-4 md:grid-cols-2 text-[13px] text-slate-700">
              {onEdit && (
                <div className="md:col-span-2 flex justify-end -mb-2">
                  <button type="button" onClick={onEdit} data-testid="edit-record"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer shadow-2xs">
                    <PencilLine className="w-3.5 h-3.5" aria-hidden="true" />Edit details
                  </button>
                </div>
              )}
              <div className="space-y-1.5">
                <Detail k="Record ID" v={<CopyableRecordId id={v.recordId} variant="badge" />} />
                <Detail k="Activity" v={v.activity || '—'} />
                <Detail k="Merchant" v={v.merchantName || '—'} />
                <Detail k="MID / Account" v={v.mid ? <span className="font-mono tabular-nums">{v.mid}</span> : '—'} />
                <Detail k="Remarks" v={v.remarks || '—'} />
                {others.map(([k, val]) => <Detail key={k} k={k} v={val} />)}
              </div>
              <div className="space-y-1.5">
                <Detail k="Sent" v={stampSecPP(new Date(v.submittedAt))} />
                {v.editedAt && <Detail k="Edited" v={stampSecPP(new Date(v.editedAt))} />}
                <Detail k="Staff" v={`${v.staffName}${v.staffId ? ` (${v.staffId})` : ''}`} />
                <Detail k="Branch" v={v.branchId ? `${v.branchText} · ${v.branchId}` : `${v.branchText || '—'} (not matched to a branch)`} />
                <Detail k="Location" v={place || '—'} />
                <Detail
                  k="GPS"
                  v={mapUrl ? (
                    <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-700 hover:underline">
                      <MapPin className="w-3 h-3" /> {v.latitude!.toFixed(6)}, {v.longitude!.toFixed(6)}
                    </a>
                  ) : '—'}
                />
                <Detail
                  k="Photos"
                  v={v.photoLink ? (
                    <a href={v.photoLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-700 hover:underline">
                      <Send className="w-3 h-3" /> View on Telegram
                    </a>
                  ) : '—'}
                />
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

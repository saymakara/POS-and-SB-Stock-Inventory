import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Smartphone, Search, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Ban, Loader2, CheckSquare, Square, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Branch, Device, UserRole } from '../types';
import { STAGE_META } from '../data/initialData';
import {
  FieldEvent,
  FieldEventStatus,
  fetchBranchRegions,
  fetchPendingFieldEvents,
  fetchReviewedFieldEvents,
  subscribeToFieldEvents,
  approveFieldEvent,
  rejectFieldEvent,
} from '../services/supabaseService';

/**
 * Phone App Review.
 * Every POS / Sound Box record saved in the Merchant Visit phone app arrives here, one line per device. The stock does
 * not change until an admin approves it. The list is one clean line per record; tap a line to open its details and the
 * decision, which grow out of the line (morph). Waiting records load first and appear at once; reviewed records follow
 * in the background, and new records from the phone app appear live.
 */

const KIND_LABEL: Record<FieldEvent['kind'], string> = {
  INSTALL: 'Installation',
  REPLACE: 'Replacement',
  BATTERY: 'Battery replacement',
  SB_MAINT: 'Sound Box maintenance',
  SB_RETURN: 'Sound Box returned',
};
const STATUS_CHIP: Record<string, string> = { PENDING: 'chip-slate', APPROVED: 'chip-green', REJECTED: 'chip-red', SUPERSEDED: 'chip-slate', CANCELLED: 'chip-slate' };
const STATUS_LABEL: Record<string, string> = { PENDING: 'Waiting', APPROVED: 'Approved', REJECTED: 'Rejected', SUPERSEDED: 'Replaced by a newer edit', CANCELLED: 'Withdrawn in the phone app' };
type Filter = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL';
type TypeFilter = 'ALL' | 'POS Terminal' | 'Sound Box';
const DOT = { 'POS Terminal': 'bg-sky-500', 'Sound Box': 'bg-violet-500' } as const;
const SPRING = { type: 'spring', stiffness: 420, damping: 38, mass: 0.7 } as const;
const GRID = 'grid items-center gap-x-3 grid-cols-[24px_30px_104px_130px_minmax(120px,1fr)_minmax(110px,1fr)_minmax(120px,1fr)_104px_150px]';
const CACHE_KEY = 'fe_review_cache_v1';
const FIRST = 40;

const fmtTime = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Phnom_Penh' });
};

interface Props {
  role: UserRole;
  branches: Branch[];
  devices: Device[];
  triggerToast: (msg: string) => void;
  onApplied: () => void;
  onOpenWorkflow?: (serial: string) => void;
  /** Settings: show Phnom Penh staff only, or Phnom Penh and regional staff */
  scope?: 'PHNOM_PENH' | 'ALL';
}

interface RowOpt { branchId?: string; returnStage?: string; note?: string; ack?: boolean }

const needsReturnOf = (e: FieldEvent) => (e.kind === 'REPLACE' && !!e.oldSerial) || e.kind === 'SB_RETURN';
const needsBranchOf = (e: FieldEvent) => e.kind === 'INSTALL' || e.kind === 'REPLACE';
const hasBlock = (e: FieldEvent) => e.issues.some((i) => i.level === 'block');
const hasWarn = (e: FieldEvent) => e.issues.some((i) => i.level === 'warn');
const resolve = (e: FieldEvent, o?: RowOpt) => ({
  branchId: o?.branchId ?? (e.branchId || ''),
  returnStage: o?.returnStage ?? ('HQ_STOCK'),
  note: o?.note ?? '',
  ack: o?.ack ?? false,
});

export const FieldReviewTab: React.FC<Props> = ({ role, branches, devices, triggerToast, onApplied, onOpenWorkflow, scope = 'ALL' }) => {
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const [events, setEvents] = useState<FieldEvent[] | null>(() => {
    try { const c = sessionStorage.getItem(CACHE_KEY); return c ? (JSON.parse(c) as FieldEvent[]) : null; } catch { return null; }   // instant first paint
  });
  const [reviewedReady, setReviewedReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [live, setLive] = useState(false);
  const [filter, setFilter] = useState<Filter>('PENDING');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  const [opts, setOpts] = useState<Record<number, RowOpt>>({});
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const [rowErr, setRowErr] = useState<Record<number, string>>({});
  const [bulkNote, setBulkNote] = useState('');
  const [bulkAck, setBulkAck] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<'' | 'approve' | 'reject'>('');
  const [bulkReport, setBulkReport] = useState<string[]>([]);
  const [regions, setRegions] = useState<Record<string, string>>({});
  const [visible, setVisible] = useState(FIRST);
  const sentinel = useRef<HTMLDivElement | null>(null);

  useEffect(() => { fetchBranchRegions().then(setRegions); }, []);

  // keep a small copy of the waiting records so the next visit paints instantly
  useEffect(() => {
    if (!events) return;
    const t = window.setTimeout(() => {
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(events.filter((e) => e.status === 'PENDING').slice(0, 300))); } catch { /* storage full or blocked: fine */ }
    }, 800);
    return () => window.clearTimeout(t);
  }, [events]);

  const merge = useCallback((pending: FieldEvent[] | null, reviewed: FieldEvent[] | null) => {
    setEvents((prev) => {
      const keepPending = pending ?? (prev || []).filter((e) => e.status === 'PENDING');
      const keepReviewed = reviewed ?? (prev || []).filter((e) => e.status !== 'PENDING');
      return [...keepPending, ...keepReviewed];
    });
  }, []);

  const load = useCallback(async () => {
    setLoadError('');
    const pending = await fetchPendingFieldEvents();            // the waiting records first: this is what the admin needs now
    if (!pending) { setLoadError('The records could not be loaded. Please check the connection and tap Refresh.'); return; }
    merge(pending, null);
    const reviewed = await fetchReviewedFieldEvents(600);       // the rest follows in the background
    if (reviewed) { merge(null, reviewed); setReviewedReady(true); }
  }, [merge]);

  useEffect(() => {
    load();
    const unsub = subscribeToFieldEvents((e) => {
      setLive(true);
      setEvents((prev) => {
        if (!prev) return [e];
        const i = prev.findIndex((x) => x.id === e.id);
        if (i < 0) return [e, ...prev];
        const next = prev.slice(); next[i] = e; return next;
      });
    });
    return unsub;
  }, [load]);

  const deviceBySerial = useMemo(() => {
    const m = new Map<string, Device>();
    devices.forEach((d) => m.set(d.serial.toUpperCase(), d));
    return m;
  }, [devices]);

  const inScope = useCallback((e: FieldEvent) => {
    if (scope !== 'PHNOM_PENH') return true;
    const r = regions[String(e.branchId || '')];
    return !r || /phnom\s*penh/i.test(r);
  }, [scope, regions]);
  const scoped = useMemo(() => (events || []).filter(inScope), [events, inScope]);

  const counts = useMemo(() => {
    const c = { PENDING: 0, APPROVED: 0, REJECTED: 0, ALL: 0 };
    scoped.forEach((e) => { c.ALL++; if (e.status === 'PENDING' || e.status === 'APPROVED' || e.status === 'REJECTED') c[e.status]++; });
    return c;
  }, [scoped]);
  const typeCounts = useMemo(() => {
    const c = { pos: 0, sb: 0 };
    scoped.filter((e) => filter === 'ALL' || e.status === filter).forEach((e) => { if (e.deviceType === 'Sound Box') c.sb++; else c.pos++; });
    return c;
  }, [scoped, filter]);

  const shown = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return scoped
      .filter((e) => filter === 'ALL' || e.status === filter)
      .filter((e) => typeFilter === 'ALL' || e.deviceType === typeFilter)
      .filter((e) => !q || [e.serial, e.oldSerial, e.sourceRecordId, e.mid, e.tid, e.outletName, e.terminalName, e.staffName, e.staffId, e.branchText]
        .some((v) => String(v || '').toLowerCase().includes(q)))
      .sort((a, b) => filter === 'PENDING' ? a.receivedAt.localeCompare(b.receivedAt) : b.receivedAt.localeCompare(a.receivedAt));
  }, [scoped, filter, typeFilter, deferredQuery]);

  useEffect(() => { setVisible(FIRST); }, [filter, typeFilter, deferredQuery, scope]);
  useEffect(() => {          // more rows are drawn as the list is scrolled: a long list opens at once
    const el = sentinel.current;
    if (!el || visible >= shown.length) return;
    const io = new IntersectionObserver((en) => { if (en.some((x) => x.isIntersecting)) setVisible((v) => v + 60); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [visible, shown.length]);

  const shownPending = useMemo(() => shown.filter((e) => e.status === 'PENDING'), [shown]);
  const selectedShown = useMemo(() => shownPending.filter((e) => selected.has(e.id)), [shownPending, selected]);
  const allSelected = shownPending.length > 0 && selectedShown.length === shownPending.length;

  // ---- actions (kept stable so rows that did not change are not drawn again)
  const optsRef = useRef(opts); optsRef.current = opts;
  const setOpt = useCallback((id: number, patch: Partial<RowOpt>) => setOpts((p) => ({ ...p, [id]: { ...p[id], ...patch } })), []);
  const toggle = useCallback((id: number) => setSelected((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  const setBusy = (id: number, on: boolean) => setBusyIds((p) => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n; });
  const markDone = (id: number, st: FieldEventStatus) => {
    setEvents((prev) => prev && prev.map((x) => (x.id === id ? { ...x, status: st } : x)));
    setSelected((p) => { if (!p.has(id)) return p; const n = new Set(p); n.delete(id); return n; });
  };

  const approveOne = async (e: FieldEvent, ackAll: boolean): Promise<string> => {
    const o = resolve(e, optsRef.current[e.id]);
    if (hasBlock(e)) return 'cannot be approved as it is (see the red note)';
    if (needsBranchOf(e) && !o.branchId) return 'choose the branch first';
    const ack = ackAll || o.ack;
    if (hasWarn(e) && !ack) return 'tick "I checked the warnings" first';
    try {
      await approveFieldEvent(e.id, o.note, { branch_id: o.branchId || undefined, return_stage: needsReturnOf(e) ? o.returnStage : undefined, acknowledge: ack });
      markDone(e.id, 'APPROVED');
      return '';
    } catch (x) {
      const m = x instanceof Error ? x.message : String(x);
      if (/warning/i.test(m)) setOpt(e.id, { ack: false });
      return m;
    }
  };
  const rejectOne = async (e: FieldEvent, reason: string): Promise<string> => {
    if (!reason.trim()) return 'write the reason to reject';
    try { await rejectFieldEvent(e.id, reason.trim()); markDone(e.id, 'REJECTED'); return ''; }
    catch (x) { return x instanceof Error ? x.message : String(x); }
  };
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  const approveRow = useCallback(async (e: FieldEvent) => {
    setRowErr((p) => ({ ...p, [e.id]: '' }));
    setBusy(e.id, true);
    const err = await approveOne(e, false);
    setBusy(e.id, false);
    if (err) { setRowErr((p) => ({ ...p, [e.id]: cap(err) })); setOpen(e.id); }   // open the line so the reason is seen next to the controls
    else { triggerToast(`Approved · ${e.serial} · stock updated`); onApplied(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerToast, onApplied]);
  const rejectRow = useCallback(async (e: FieldEvent) => {
    const note = resolve(e, optsRef.current[e.id]).note;
    if (!note.trim()) { setOpen(e.id); setRowErr((p) => ({ ...p, [e.id]: 'Write the reason to reject, then tap Reject again.' })); return; }
    setRowErr((p) => ({ ...p, [e.id]: '' }));
    setBusy(e.id, true);
    const err = await rejectOne(e, note);
    setBusy(e.id, false);
    if (err) setRowErr((p) => ({ ...p, [e.id]: cap(err) }));
    else triggerToast(`Rejected · ${e.serial}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerToast]);
  const toggleOpen = useCallback((id: number) => setOpen((p) => (p === id ? null : id)), []);

  const runBulk = async (mode: 'approve' | 'reject') => {
    const list = selectedShown.slice();
    if (!list.length) return;
    if (mode === 'reject' && !bulkNote.trim()) { setBulkReport(['Write the reason to reject the selected records.']); return; }
    setBulkBusy(mode);
    setBulkReport([]);
    let ok = 0;
    const problems: string[] = [];
    for (const e of list) {
      const err = mode === 'approve' ? await approveOne(e, bulkAck) : await rejectOne(e, bulkNote);
      if (err) problems.push(`${e.serial}: ${err}`); else ok += 1;
    }
    setBulkBusy('');
    setBulkReport([`${ok} of ${list.length} ${mode === 'approve' ? 'approved' : 'rejected'}.`, ...problems]);
    if (ok) { triggerToast(`${ok} record(s) ${mode === 'approve' ? 'approved · stock updated' : 'rejected'}`); if (mode === 'approve') onApplied(); }
    if (!problems.length) setBulkNote('');
  };

  const pill = (active: boolean) => `btn-press px-2.5 py-1 rounded-lg text-xs font-semibold border cursor-pointer ${active ? 'bg-[#003857] text-white border-[#003857]' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`;
  const typePill = (t: TypeFilter, label: string, n: number) => (
    <button key={t} type="button" onClick={() => setTypeFilter(t)} aria-pressed={typeFilter === t} className={pill(typeFilter === t).replace('bg-[#003857]', 'bg-slate-800').replace('border-[#003857]', 'border-slate-800')}>
      {t !== 'ALL' && <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${DOT[t]}`} aria-hidden />}{label} <span className="opacity-70">({n})</span>
    </button>
  );
  const loadingFirst = !events && !loadError;
  const visibleRows = shown.slice(0, visible);

  return (
    <div className="flex flex-col gap-3">
      {/* Section 1 — what to look at */}
      <section className="bg-white rounded-2xl border border-slate-200 px-4 py-3 shadow-xs" aria-label="Filters">
        <div className="flex flex-wrap items-center gap-2">
          <Smartphone className="w-4 h-4 text-[#003857]" aria-hidden />
          <h2 className="text-base font-extrabold text-slate-900 mr-1">Phone App Review</h2>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 mr-2" title="New records from the phone app appear here as they are saved">
            <span className={`w-1.5 h-1.5 rounded-full ${live ? 'bg-emerald-500 sync-dot' : 'bg-slate-300'}`} aria-hidden />{live ? 'Live' : 'Connecting…'}
          </span>
          {(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as Filter[]).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f} className={pill(filter === f)}>
              {f === 'PENDING' ? 'Waiting' : f === 'ALL' ? 'All' : f === 'APPROVED' ? 'Approved' : 'Rejected'} <span className="opacity-70">({counts[f]})</span>
            </button>
          ))}
          <span className="hidden sm:block w-px h-5 bg-slate-200 mx-1" aria-hidden />
          {typePill('ALL', 'All devices', typeCounts.pos + typeCounts.sb)}
          {typePill('POS Terminal', 'POS Terminal', typeCounts.pos)}
          {typePill('Sound Box', 'Sound Box', typeCounts.sb)}
          <span className="text-[11px] text-slate-500 hidden xl:inline">{scope === 'PHNOM_PENH' ? 'Phnom Penh staff only' : 'Phnom Penh and Regional staff'}</span>
          <div className="relative ml-auto w-full sm:w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Serial, MID, staff…" aria-label="Search records"
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs outline-none focus:border-[#003857]" />
          </div>
          <button type="button" onClick={load} aria-label="Refresh" className="btn-press p-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 cursor-pointer"><RefreshCw className="w-3.5 h-3.5" /></button>
        </div>
      </section>

      {/* Section 2 — decide several at once */}
      <AnimatePresence initial={false}>
        {isAdmin && selectedShown.length > 0 && (
          <motion.section key="bulk" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={SPRING}
            className="sticky top-2 z-10 bg-white/95 backdrop-blur rounded-xl border border-slate-200 shadow-xs px-4 py-2.5 flex flex-wrap items-center gap-3" aria-label="Decide the selected records">
            <span className="text-xs font-semibold text-slate-700">{selectedShown.length} selected</span>
            <input value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} maxLength={500} placeholder="Reason (needed to reject)" aria-label="Reason for the selected records"
              className="flex-1 min-w-[160px] px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs outline-none focus:border-[#003857]" />
            {selectedShown.some(hasWarn) && (
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer">
                <input type="checkbox" checked={bulkAck} onChange={(e) => setBulkAck(e.target.checked)} /> I checked the warnings
              </label>
            )}
            <button type="button" onClick={() => runBulk('reject')} disabled={!!bulkBusy} className="btn-press px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-60 flex items-center gap-1.5 cursor-pointer">
              {bulkBusy === 'reject' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />} Reject {selectedShown.length}
            </button>
            <button type="button" onClick={() => runBulk('approve')} disabled={!!bulkBusy} className="btn-press px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60 flex items-center gap-1.5 cursor-pointer">
              {bulkBusy === 'approve' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Approve {selectedShown.length}
            </button>
            {bulkReport.length > 0 && (
              <ul role="status" className="basis-full text-[11px] space-y-0.5">
                {bulkReport.slice(0, 8).map((l, i) => <li key={i} className={i === 0 ? 'font-semibold text-slate-700' : 'text-rose-700'}>{l}</li>)}
                {bulkReport.length > 8 && <li className="text-rose-700">…and {bulkReport.length - 8} more.</li>}
              </ul>
            )}
          </motion.section>
        )}
      </AnimatePresence>

      {loadError && <div role="alert" className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">{loadError}</div>}

      {/* Section 3 — the records */}
      <section className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-x-auto" aria-label="Records">
       <div className="min-w-[980px]">
        <div className={`${GRID} bg-slate-50 text-slate-500 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider px-3 py-2.5`} role="row">
          <span>{isAdmin && shownPending.length > 0 && (
            <button type="button" aria-label={allSelected ? 'Unselect all' : 'Select all waiting'} aria-pressed={allSelected} onClick={() => setSelected(allSelected ? new Set() : new Set(shownPending.map((e) => e.id)))} className="cursor-pointer flex">
              {allSelected ? <CheckSquare className="w-4 h-4 text-[#003857]" /> : <Square className="w-4 h-4 text-slate-400" />}
            </button>
          )}</span>
          <span className="text-right">No.</span>
          <span>Device Type</span>
          <span>Record Type</span>
          <span>Serial Number</span>
          <span>Merchant Name</span>
          <span>Branch / Staff</span>
          <span>Status</span>
          <span className="text-right">Decision</span>
        </div>

        {loadingFirst && (
          <div aria-busy="true" aria-label="Loading">
            {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-[52px] border-b border-slate-100 px-3 flex items-center"><div className="skeleton h-3 rounded w-2/3" /></div>)}
          </div>
        )}
        {events && shown.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-500">
            {filter !== 'PENDING' && !reviewedReady ? 'Loading earlier records…' : filter === 'PENDING' ? 'Nothing is waiting for review.' : 'No records match.'}
          </div>
        )}

        <AnimatePresence initial={false}>
          {visibleRows.map((e, idx) => (
            <ReviewRow key={e.id} e={e} no={idx + 1} isAdmin={isAdmin} branches={branches} o={opts[e.id]} checked={selected.has(e.id)} isOpen={open === e.id}
              busy={busyIds.has(e.id) || !!bulkBusy} err={rowErr[e.id] || ''}
              device={deviceBySerial.get(e.serial.toUpperCase())} oldDevice={e.oldSerial ? deviceBySerial.get(e.oldSerial.toUpperCase()) : undefined}
              onOpt={setOpt} onCheck={toggle} onToggle={toggleOpen} onApprove={approveRow} onReject={rejectRow} onOpenWorkflow={onOpenWorkflow} />
          ))}
        </AnimatePresence>
        {visible < shown.length && <div ref={sentinel} className="h-10 flex items-center justify-center text-[11px] text-slate-400">Showing {visible} of {shown.length}…</div>}
       </div>
      </section>
    </div>
  );
};

/* ---------- one record: a clean line that opens into three labelled sections ---------- */

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="min-w-0">
    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">{title}</div>
    <div className="flex flex-col gap-1.5 text-xs text-slate-800">{children}</div>
  </div>
);
const Line: React.FC<{ k: string; children: React.ReactNode; mono?: boolean }> = ({ k, children, mono }) => (
  <div className="flex gap-2"><span className="w-28 shrink-0 text-slate-500">{k}</span><span className={`min-w-0 break-words ${mono ? 'font-mono' : ''}`}>{children || '—'}</span></div>
);

interface RowProps {
  e: FieldEvent; no: number; isAdmin: boolean; branches: Branch[]; o?: RowOpt; checked: boolean; isOpen: boolean; busy: boolean; err: string;
  device?: Device; oldDevice?: Device;
  onOpt: (id: number, p: Partial<RowOpt>) => void; onCheck: (id: number) => void; onToggle: (id: number) => void;
  onApprove: (e: FieldEvent) => void; onReject: (e: FieldEvent) => void; onOpenWorkflow?: (serial: string) => void;
}

const ReviewRow = memo(function ReviewRow({ e, no, isAdmin, branches, o, checked, isOpen, busy, err, device, oldDevice, onOpt, onCheck, onToggle, onApprove, onReject, onOpenWorkflow }: RowProps) {
  const pending = e.status === 'PENDING';
  const type = e.deviceType === 'Sound Box' ? 'Sound Box' : 'POS Terminal';
  const r = resolve(e, o);
  const blocks = e.issues.filter((i) => i.level === 'block').length;
  const warns = e.issues.filter((i) => i.level === 'warn').length;
  const needsBranch = needsBranchOf(e);
  const needsReturn = needsReturnOf(e);
  const stageText = (d?: Device) => d ? `${STAGE_META[d.stage]?.short || d.stage} · Branch ${d.branchId}${d.merchantName ? ' · ' + d.merchantName : ''}` : 'Not in the inventory';
  const merchant = [e.outletName, e.terminalName && e.terminalName !== e.outletName ? e.terminalName : ''].filter(Boolean).join(' · ');
  const canApprove = !blocks && !busy && (!needsBranch || !!r.branchId);

  return (
    <motion.div layout="position" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 24, transition: { duration: 0.16 } }} transition={SPRING}
      className={`border-b border-slate-100 last:border-b-0 ${checked ? 'bg-sky-50/50' : isOpen ? 'bg-slate-50/70' : 'bg-white'}`}>
      {/* the clean line */}
      <div className={`${GRID} px-3 py-2.5 text-xs`}>
        <span>{isAdmin && pending && (
          <button type="button" onClick={() => onCheck(e.id)} aria-pressed={checked} aria-label={`Select ${e.serial}`} className="cursor-pointer flex">
            {checked ? <CheckSquare className="w-4 h-4 text-[#003857]" /> : <Square className="w-4 h-4 text-slate-400" />}
          </button>
        )}</span>
        <span className="text-right text-slate-400 tabular-nums">{no}</span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className={`w-1.5 h-1.5 rounded-full ${type === 'Sound Box' ? 'bg-violet-500' : 'bg-sky-500'}`} aria-hidden />{type}</span>
        <span className="truncate" title={KIND_LABEL[e.kind]}>{KIND_LABEL[e.kind]}</span>
        <button type="button" onClick={() => onToggle(e.id)} aria-expanded={isOpen} className="text-left font-mono truncate cursor-pointer hover:underline inline-flex items-center gap-1" title="Open the details">
          <ChevronDown className={`w-3.5 h-3.5 shrink-0 text-slate-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
          <span className="truncate">{e.serial}</span>
        </button>
        <span className="truncate" title={merchant}>{merchant || '—'}</span>
        <span className="truncate" title={`${e.branchText} ${e.staffName}`}>{e.branchText || '—'}<span className="block text-[11px] text-slate-500 truncate">{e.staffName || '—'}</span></span>
        <span className="text-slate-600 leading-tight">
          {STATUS_LABEL[e.status].length > 12 ? 'Closed' : STATUS_LABEL[e.status]}
          {(blocks > 0 || warns > 0) && pending && (
            <span className="block text-[11px] text-slate-500">{blocks > 0 && <span className="text-rose-700">{blocks} to fix</span>}{blocks > 0 && warns > 0 && ' · '}{warns > 0 && `${warns} to check`}</span>
          )}
        </span>
        <span className="flex justify-end gap-1.5">
          {pending && isAdmin ? (
            <>
              <button type="button" onClick={() => onReject(e)} disabled={busy} className="btn-press px-2.5 py-1 rounded-lg text-xs font-bold border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-60 cursor-pointer">Reject</button>
              <button type="button" onClick={() => onApprove(e)} disabled={!canApprove} title={blocks ? 'Open the line to see what must be fixed' : needsBranch && !r.branchId ? 'Open the line and choose the branch' : undefined}
                className="btn-press px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-45 cursor-pointer inline-flex items-center gap-1">
                {busy && <Loader2 className="w-3 h-3 animate-spin" />}Approve
              </button>
            </>
          ) : <button type="button" onClick={() => onToggle(e.id)} className="text-[11px] text-slate-500 hover:underline cursor-pointer">{isOpen ? 'Hide' : 'Details'}</button>}
        </span>
      </div>

      {/* the details: grow out of the line */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div key="detail" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8, transition: { duration: 0.12 } }} transition={SPRING}
            className="px-4 pb-3 pt-2 grid gap-x-10 gap-y-4 md:grid-cols-2 border-t border-slate-100 bg-slate-50/50">
            <Section title="Details">
              <Line k="Record">{e.sourceRecordId}{e.unitNo > 1 ? ` · unit ${e.unitNo}` : ''} · {fmtTime(e.recordedAt)}</Line>
              <Line k="Staff">{e.staffName ? `${e.staffName}${e.staffId ? ` (${e.staffId})` : ''}` : ''}</Line>
              <Line k="MID · TID" mono>{[e.mid, e.tid].filter(Boolean).join(' · ')}</Line>
              {e.oldSerial && <Line k="Replaces" mono>{e.oldSerial}</Line>}
              {e.newBattery && <Line k="Battery" mono>{`${e.oldBattery || '—'} → ${e.newBattery}`}</Line>}
              <Line k="In inventory">{stageText(device)}</Line>
              {e.oldSerial && <Line k="Old unit">{stageText(oldDevice)}</Line>}
              {e.issues.length > 0 && (
                <ul className="mt-1 flex flex-col gap-1">
                  {e.issues.map((i, k) => (
                    <li key={k} className={`flex items-start gap-1.5 ${i.level === 'block' ? 'text-rose-700' : 'text-slate-600'}`}>
                      {i.level === 'block' ? <Ban className="w-3 h-3 shrink-0 mt-0.5" /> : <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5 text-slate-400" />}<span>{i.text}</span>
                    </li>
                  ))}
                </ul>
              )}
              {device && onOpenWorkflow && <button type="button" onClick={() => onOpenWorkflow(device.serial)} className="self-start text-[11px] text-[#003857] hover:underline cursor-pointer mt-1">Open this device</button>}
            </Section>

            <Section title={pending && isAdmin ? 'Decision' : 'Result'}>
              {pending && isAdmin ? (
                <>
                  {needsBranch && (
                    <label className="flex flex-col gap-1 text-slate-600">Branch of this installation
                      <select value={r.branchId} onChange={(x) => onOpt(e.id, { branchId: x.target.value })} className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-900">
                        <option value="">Choose a branch…</option>
                        {branches.map((b) => <option key={b.id} value={b.id}>{b.id} · {b.name}</option>)}
                      </select>
                    </label>
                  )}
                  {needsReturn && (
                    <label className="flex flex-col gap-1 text-slate-600">{e.kind === 'REPLACE' ? 'The old unit goes to' : 'The returned sound box goes to'}
                      <select value={r.returnStage} onChange={(x) => onOpt(e.id, { returnStage: x.target.value })} className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-900">
                        <option value="HQ_STOCK">Back to HQ stock</option>
                        <option value="BRANCH_RESERVE">Branch reserve</option>
                      </select>
                    </label>
                  )}
                  <label className="flex flex-col gap-1 text-slate-600">Reason (needed to reject)
                    <input value={r.note} onChange={(x) => onOpt(e.id, { note: x.target.value })} maxLength={500} className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-900" />
                  </label>
                  {(warns > 0 || /warning/i.test(err)) && !blocks && (
                    <label className="flex items-center gap-1.5 text-slate-700 cursor-pointer"><input type="checkbox" checked={r.ack} onChange={(x) => onOpt(e.id, { ack: x.target.checked })} /> I checked the warnings</label>
                  )}
                  {err && <div role="alert" className="text-rose-700 font-semibold">{err}</div>}
                </>
              ) : (
                <div>{STATUS_LABEL[e.status]}{e.reviewedByName ? ` by ${e.reviewedByName}` : ''}{e.reviewedAt ? ` · ${fmtTime(e.reviewedAt)}` : ''}{e.reviewNote ? ` · ${e.reviewNote}` : ''}</div>
              )}
            </Section>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});

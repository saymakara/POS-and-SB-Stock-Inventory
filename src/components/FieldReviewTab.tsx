import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Smartphone, Search, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Ban, Loader2, Cpu, Volume2, CheckSquare, Square } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Branch, Device, UserRole } from '../types';
import { STAGE_META } from '../data/initialData';
import {
  FieldEvent,
  FieldIssue,
  fetchFieldEvents,
  FieldEventStatus,
  subscribeToFieldEvents,
  recheckFieldEvent,
  approveFieldEvent,
  rejectFieldEvent,
} from '../services/supabaseService';

/**
 * Phone App Review (21 Oct 2026).
 * Every POS / Sound Box record saved in the Merchant Visit phone app (installation, replacement, battery replacement,
 * sound box maintenance or return) arrives here, one line per device. The stock does not change until an admin
 * approves it; the database then updates the device(s), the merchant history and the audit log in one step.
 * Branch staff see their own branch's records (read only).
 */

const KIND_LABEL: Record<FieldEvent['kind'], string> = {
  INSTALL: 'Installation',
  REPLACE: 'Replacement',
  BATTERY: 'Battery replacement',
  SB_MAINT: 'Sound Box maintenance',
  SB_RETURN: 'Sound Box returned',
};
const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-800 border-amber-200',
  APPROVED: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-800 border-rose-200',
  SUPERSEDED: 'bg-slate-100 text-slate-600 border-slate-200',
  CANCELLED: 'bg-slate-100 text-slate-600 border-slate-200',
};
const STATUS_LABEL: Record<string, string> = { PENDING: 'Waiting for review', APPROVED: 'Approved', REJECTED: 'Rejected', SUPERSEDED: 'Replaced by a newer edit', CANCELLED: 'Withdrawn in the phone app' };
type Filter = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL';
type TypeFilter = 'ALL' | 'POS Terminal' | 'Sound Box';
/** POS Terminal = blue, Sound Box = violet: the same colours on the bar, the chip and the tint of every record */
const TYPE_STYLE = {
  'POS Terminal': { bar: 'bg-sky-500', chip: 'bg-sky-100 text-sky-800 border-sky-200', tint: 'bg-sky-50/40', ring: 'border-sky-200' },
  'Sound Box': { bar: 'bg-violet-500', chip: 'bg-violet-100 text-violet-800 border-violet-200', tint: 'bg-violet-50/40', ring: 'border-violet-200' },
} as const;

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
}

interface RowOpt { branchId: string; returnStage: string; note: string; ack: boolean }

export const FieldReviewTab: React.FC<Props> = ({ role, branches, devices, triggerToast, onApplied, onOpenWorkflow }) => {
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const [events, setEvents] = useState<FieldEvent[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState<Filter>('PENDING');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [opts, setOpts] = useState<Record<number, Partial<RowOpt>>>({});
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const [rowErr, setRowErr] = useState<Record<number, string>>({});
  const [bulkNote, setBulkNote] = useState('');
  const [bulkAck, setBulkAck] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<'' | 'approve' | 'reject'>('');
  const [bulkReport, setBulkReport] = useState<string[]>([]);

  const load = useCallback(async () => {
    const list = await fetchFieldEvents(1000);
    if (!list) { setLoadError('The records could not be loaded. Please check the connection and tap Refresh.'); return; }
    setLoadError('');
    setEvents(list);
  }, []);

  useEffect(() => {
    load();
    const unsub = subscribeToFieldEvents((e) => {
      setEvents((prev) => {
        if (!prev) return prev;
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

  const counts = useMemo(() => {
    const c = { PENDING: 0, APPROVED: 0, REJECTED: 0, ALL: 0 };
    (events || []).forEach((e) => { c.ALL++; if (e.status === 'PENDING' || e.status === 'APPROVED' || e.status === 'REJECTED') c[e.status]++; });
    return c;
  }, [events]);
  const typeCounts = useMemo(() => {
    const c = { pos: 0, sb: 0 };
    (events || []).filter((e) => filter === 'ALL' || e.status === filter).forEach((e) => { if (e.deviceType === 'Sound Box') c.sb++; else c.pos++; });
    return c;
  }, [events, filter]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (events || [])
      .filter((e) => filter === 'ALL' || e.status === filter)
      .filter((e) => typeFilter === 'ALL' || e.deviceType === typeFilter)
      .filter((e) => !q || [e.serial, e.oldSerial, e.sourceRecordId, e.mid, e.tid, e.outletName, e.terminalName, e.staffName, e.staffId, e.branchText]
        .some((v) => String(v || '').toLowerCase().includes(q)))
      .sort((a, b) => filter === 'PENDING' ? a.receivedAt.localeCompare(b.receivedAt) : b.receivedAt.localeCompare(a.receivedAt));   // waiting: oldest first
  }, [events, filter, typeFilter, query]);

  const shownPending = useMemo(() => shown.filter((e) => e.status === 'PENDING'), [shown]);
  const selectedShown = useMemo(() => shownPending.filter((e) => selected.has(e.id)), [shownPending, selected]);
  const allSelected = shownPending.length > 0 && selectedShown.length === shownPending.length;

  const optOf = (e: FieldEvent): RowOpt => ({
    branchId: opts[e.id]?.branchId ?? (e.branchId || ''),
    returnStage: opts[e.id]?.returnStage ?? (e.kind === 'SB_RETURN' ? 'BRANCH_RESERVE' : 'FAULTY'),
    note: opts[e.id]?.note ?? '',
    ack: opts[e.id]?.ack ?? false,
  });
  const setOpt = (id: number, patch: Partial<RowOpt>) => setOpts((p) => ({ ...p, [id]: { ...p[id], ...patch } }));
  const toggle = (id: number) => setSelected((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const setBusy = (id: number, on: boolean) => setBusyIds((p) => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n; });
  const markDone = (id: number, st: FieldEventStatus) => {
    setEvents((prev) => prev && prev.map((x) => (x.id === id ? { ...x, status: st } : x)));
    setSelected((p) => { if (!p.has(id)) return p; const n = new Set(p); n.delete(id); return n; });
  };

  const needsReturn = (e: FieldEvent) => (e.kind === 'REPLACE' && !!e.oldSerial) || e.kind === 'SB_RETURN';
  const needsBranch = (e: FieldEvent) => e.kind === 'INSTALL' || e.kind === 'REPLACE';
  const hasBlock = (e: FieldEvent) => e.issues.some((i) => i.level === 'block');
  const hasWarn = (e: FieldEvent) => e.issues.some((i) => i.level === 'warn');

  /** Approve one record; returns '' on success or the reason it was not approved. */
  const approveOne = async (e: FieldEvent, ackAll: boolean): Promise<string> => {
    const o = optOf(e);
    if (hasBlock(e)) return 'cannot be approved as it is (see the red note)';
    if (needsBranch(e) && !o.branchId) return 'choose the branch first';
    const ack = ackAll || o.ack;
    if (hasWarn(e) && !ack) return 'tick "I checked the warnings" first';
    try {
      await approveFieldEvent(e.id, o.note, { branch_id: o.branchId || undefined, return_stage: needsReturn(e) ? o.returnStage : undefined, acknowledge: ack });
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
    try {
      await rejectFieldEvent(e.id, reason.trim());
      markDone(e.id, 'REJECTED');
      return '';
    } catch (x) {
      return x instanceof Error ? x.message : String(x);
    }
  };

  const approveRow = async (e: FieldEvent) => {
    setRowErr((p) => ({ ...p, [e.id]: '' }));
    setBusy(e.id, true);
    const err = await approveOne(e, false);
    setBusy(e.id, false);
    if (err) setRowErr((p) => ({ ...p, [e.id]: err.charAt(0).toUpperCase() + err.slice(1) }));
    else { triggerToast(`Approved · ${e.serial} · stock updated`); onApplied(); }
  };
  const rejectRow = async (e: FieldEvent) => {
    setRowErr((p) => ({ ...p, [e.id]: '' }));
    setBusy(e.id, true);
    const err = await rejectOne(e, optOf(e).note);
    setBusy(e.id, false);
    if (err) setRowErr((p) => ({ ...p, [e.id]: err.charAt(0).toUpperCase() + err.slice(1) }));
    else triggerToast(`Rejected · ${e.serial}`);
  };

  const runBulk = async (mode: 'approve' | 'reject') => {
    const list = selectedShown.slice();
    if (!list.length) return;
    if (mode === 'reject' && !bulkNote.trim()) { setBulkReport(['Write the reason to reject the selected records.']); return; }
    setBulkBusy(mode);
    setBulkReport([]);
    let ok = 0;
    const problems: string[] = [];
    for (const e of list) {                                   // one after another: each is checked again by the database
      const err = mode === 'approve' ? await approveOne(e, bulkAck) : await rejectOne(e, bulkNote);
      if (err) problems.push(`${e.serial}: ${err}`); else ok += 1;
    }
    setBulkBusy('');
    setBulkReport([`${ok} of ${list.length} ${mode === 'approve' ? 'approved' : 'rejected'}.`, ...problems]);
    if (ok) { triggerToast(`${ok} record(s) ${mode === 'approve' ? 'approved · stock updated' : 'rejected'}`); if (mode === 'approve') onApplied(); }
    if (!problems.length) setBulkNote('');
  };

  const typeBtn = (t: TypeFilter, label: string, n: number, cls: string) => (
    <button key={t} type="button" onClick={() => setTypeFilter(t)} aria-pressed={typeFilter === t}
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer transition-colors ${typeFilter === t ? cls : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>
      {label} <span className="opacity-75">({n})</span>
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#003857] text-white flex items-center justify-center shrink-0"><Smartphone className="w-5 h-5" /></div>
            <div>
              <h2 className="text-lg font-extrabold text-slate-900">Phone App Review</h2>
              <p className="text-xs text-slate-600 max-w-2xl leading-relaxed">
                Records saved in the Merchant Visit phone app, one line per device.
                {isAdmin ? ' Check the details, then approve to update the stock or reject with a reason. Tick several to decide them together.' : ' An admin reviews each one before the stock is updated.'}
              </p>
            </div>
          </div>
          <button type="button" onClick={load} className="px-3 py-2 rounded-xl text-xs font-bold border border-slate-200 bg-slate-50 hover:bg-slate-100 flex items-center gap-1.5 cursor-pointer">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as Filter[]).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer transition-colors ${filter === f ? 'bg-[#003857] text-white border-[#003857]' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>
              {f === 'PENDING' ? 'Waiting' : f === 'ALL' ? 'All' : f === 'APPROVED' ? 'Approved' : 'Rejected'} <span className="opacity-75">({counts[f]})</span>
            </button>
          ))}
          <span className="hidden sm:block w-px h-6 bg-slate-200 mx-1" aria-hidden />
          {typeBtn('ALL', 'All devices', typeCounts.pos + typeCounts.sb, 'bg-slate-800 text-white border-slate-800')}
          {typeBtn('POS Terminal', 'POS Terminal', typeCounts.pos, 'bg-sky-600 text-white border-sky-600')}
          {typeBtn('Sound Box', 'Sound Box', typeCounts.sb, 'bg-violet-600 text-white border-violet-600')}
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Serial, Record ID, MID, staff…" aria-label="Search records"
              className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 text-xs outline-none focus:border-[#003857]" />
          </div>
        </div>
      </div>

      {isAdmin && shownPending.length > 0 && (
        <div className="sticky top-2 z-10 bg-white/95 backdrop-blur rounded-2xl border border-slate-200 shadow-xs px-4 py-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setSelected(allSelected ? new Set() : new Set(shownPending.map((e) => e.id)))} className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer" aria-pressed={allSelected}>
            {allSelected ? <CheckSquare className="w-4 h-4 text-[#003857]" /> : <Square className="w-4 h-4 text-slate-400" />}
            {allSelected ? 'Unselect all' : `Select all waiting (${shownPending.length})`}
          </button>
          {selectedShown.length > 0 && (
            <>
              <span className="text-xs font-semibold text-slate-500">{selectedShown.length} selected</span>
              <input value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} maxLength={500} placeholder="Reason (needed to reject)" aria-label="Reason for the selected records"
                className="flex-1 min-w-[160px] px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs outline-none focus:border-[#003857]" />
              {selectedShown.some(hasWarn) && (
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={bulkAck} onChange={(e) => setBulkAck(e.target.checked)} /> I checked the warnings
                </label>
              )}
              <button type="button" onClick={() => runBulk('reject')} disabled={!!bulkBusy} className="px-3.5 py-2 rounded-xl text-xs font-extrabold border border-rose-200 text-rose-700 bg-white hover:bg-rose-50 disabled:opacity-60 flex items-center gap-1.5 cursor-pointer">
                {bulkBusy === 'reject' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />} Reject {selectedShown.length}
              </button>
              <button type="button" onClick={() => runBulk('approve')} disabled={!!bulkBusy} className="px-3.5 py-2 rounded-xl text-xs font-extrabold bg-[#003857] hover:bg-[#002a42] text-white disabled:opacity-60 flex items-center gap-1.5 cursor-pointer">
                {bulkBusy === 'approve' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Approve {selectedShown.length}
              </button>
            </>
          )}
          {bulkReport.length > 0 && (
            <ul role="status" className="basis-full text-[11px] space-y-0.5">
              {bulkReport.slice(0, 8).map((l, i) => <li key={i} className={i === 0 ? 'font-semibold text-slate-700' : 'text-rose-700'}>{l}</li>)}
              {bulkReport.length > 8 && <li className="text-rose-700">…and {bulkReport.length - 8} more.</li>}
            </ul>
          )}
        </div>
      )}

      {loadError && <div role="alert" className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">{loadError}</div>}
      {!events && !loadError && <div className="flex items-center gap-2 text-sm text-slate-500 p-6"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}
      {events && shown.length === 0 && (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          {filter === 'PENDING' ? 'Nothing is waiting for review.' : 'No records match.'}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <AnimatePresence initial={false}>
          {shown.map((e) => (
            <motion.div key={e.id} layout="position" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 24, transition: { duration: 0.18 } }}
              transition={{ type: 'spring', damping: 30, stiffness: 380, mass: 0.7 }}>
              <ReviewCard e={e} isAdmin={isAdmin} branches={branches} opt={optOf(e)} onOpt={(patch) => setOpt(e.id, patch)}
                checked={selected.has(e.id)} onCheck={() => toggle(e.id)} busy={busyIds.has(e.id) || !!bulkBusy} err={rowErr[e.id] || ''}
                device={deviceBySerial.get(e.serial.toUpperCase())} oldDevice={e.oldSerial ? deviceBySerial.get(e.oldSerial.toUpperCase()) : undefined}
                needsBranch={needsBranch(e)} needsReturn={needsReturn(e)} onApprove={() => approveRow(e)} onReject={() => rejectRow(e)} onOpenWorkflow={onOpenWorkflow} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};

const IssueList: React.FC<{ issues: FieldIssue[] }> = ({ issues }) => (
  <ul className="flex flex-col gap-1">
    {issues.map((i, k) => (
      <li key={k} className={`flex items-start gap-1.5 text-[11px] font-semibold rounded-lg px-2 py-1 border ${i.level === 'block' ? 'text-rose-800 bg-rose-50 border-rose-200' : 'text-amber-800 bg-amber-50 border-amber-200'}`}>
        {i.level === 'block' ? <Ban className="w-3.5 h-3.5 shrink-0 mt-px" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />}
        <span>{i.text}</span>
      </li>
    ))}
  </ul>
);

const Fact: React.FC<{ label: string; children: React.ReactNode; mono?: boolean }> = ({ label, children, mono }) => (
  <div className="min-w-0">
    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
    <div className={`text-xs text-slate-900 truncate ${mono ? 'font-mono' : ''}`}>{children || '—'}</div>
  </div>
);

const ReviewCard: React.FC<{
  e: FieldEvent; isAdmin: boolean; branches: Branch[]; opt: RowOpt; onOpt: (p: Partial<RowOpt>) => void; checked: boolean; onCheck: () => void;
  busy: boolean; err: string; device?: Device; oldDevice?: Device; needsBranch: boolean; needsReturn: boolean;
  onApprove: () => void; onReject: () => void; onOpenWorkflow?: (serial: string) => void;
}> = ({ e, isAdmin, branches, opt, onOpt, checked, onCheck, busy, err, device, oldDevice, needsBranch, needsReturn, onApprove, onReject, onOpenWorkflow }) => {
  const pending = e.status === 'PENDING';
  const style = TYPE_STYLE[e.deviceType === 'Sound Box' ? 'Sound Box' : 'POS Terminal'];
  const blocked = e.issues.some((i) => i.level === 'block');
  const warned = e.issues.some((i) => i.level === 'warn');
  const stageText = (d?: Device) => d ? `${STAGE_META[d.stage]?.short || d.stage} · Branch ${d.branchId}${d.merchantName ? ' · ' + d.merchantName : ''}` : 'Not in the inventory';
  const TypeIcon = e.deviceType === 'Sound Box' ? Volume2 : Cpu;
  const merchant = [e.outletName, e.terminalName && e.terminalName !== e.outletName ? e.terminalName : ''].filter(Boolean).join(' · ');

  return (
    <div className={`relative rounded-2xl border shadow-xs overflow-hidden ${style.ring} ${style.tint} bg-white ${checked ? 'ring-2 ring-[#003857]/40' : ''}`}>
      <span className={`absolute left-0 top-0 bottom-0 w-1.5 ${style.bar}`} aria-hidden />
      <div className="pl-5 pr-4 py-3.5 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && pending && (
            <button type="button" onClick={onCheck} aria-pressed={checked} aria-label={`Select ${e.serial}`} className="cursor-pointer">
              {checked ? <CheckSquare className="w-4.5 h-4.5 text-[#003857]" /> : <Square className="w-4.5 h-4.5 text-slate-400" />}
            </button>
          )}
          <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md border inline-flex items-center gap-1 ${style.chip}`}><TypeIcon className="w-3 h-3" aria-hidden />{e.deviceType}</span>
          <span className="text-[11px] font-semibold text-slate-700">{KIND_LABEL[e.kind]}</span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${STATUS_STYLE[e.status]}`}>{STATUS_LABEL[e.status]}</span>
          {e.revision > 1 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-md border bg-sky-50 text-sky-800 border-sky-200">Edited (revision {e.revision})</span>}
          <span className="ml-auto text-[11px] text-slate-500">{fmtTime(e.recordedAt)} · {e.sourceRecordId}{e.unitNo > 1 ? ' #' + e.unitNo : ''}</span>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <button type="button" onClick={() => device && onOpenWorkflow?.(device.serial)} disabled={!device || !onOpenWorkflow} className={`font-mono text-sm font-extrabold text-slate-900 ${device && onOpenWorkflow ? 'hover:underline cursor-pointer' : 'cursor-default'}`} title={device ? 'Open this device' : undefined}>{e.serial}</button>
          {e.oldSerial && <span className="text-xs text-slate-600">replaces <span className="font-mono font-semibold text-slate-800">{e.oldSerial}</span></span>}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2.5">
          <Fact label="Merchant">{merchant}</Fact>
          <Fact label="MID" mono>{e.mid}</Fact>
          <Fact label="TID" mono>{e.tid}</Fact>
          <Fact label="Staff">{e.staffName ? `${e.staffName}${e.staffId ? ` (${e.staffId})` : ''}` : ''}</Fact>
          <Fact label="Phone app branch">{e.branchText}</Fact>
          <Fact label="In the inventory now">{stageText(device)}</Fact>
          {e.oldSerial && <Fact label={`Taken out · ${e.oldSerial}`}>{stageText(oldDevice)}</Fact>}
          {e.newBattery && <Fact label="Battery" mono>{`${e.oldBattery || '—'} → ${e.newBattery}`}</Fact>}
        </div>

        {pending && e.issues.length > 0 && <IssueList issues={e.issues} />}

        {!pending && (
          <div className="text-xs text-slate-600">{STATUS_LABEL[e.status]}{e.reviewedByName ? ` by ${e.reviewedByName}` : ''}{e.reviewedAt ? ` · ${fmtTime(e.reviewedAt)}` : ''}{e.reviewNote ? ` · ${e.reviewNote}` : ''}</div>
        )}

        {pending && isAdmin && (
          <div className="flex flex-wrap items-end gap-2.5 pt-2.5 border-t border-slate-200/80">
            {needsBranch && (
              <label className="text-[11px] font-semibold text-slate-600 flex flex-col gap-1">
                Branch of this installation
                <select value={opt.branchId} onChange={(x) => onOpt({ branchId: x.target.value })} className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-900 min-w-[170px]">
                  <option value="">Choose a branch…</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.id} · {b.name}</option>)}
                </select>
              </label>
            )}
            {needsReturn && (
              <label className="text-[11px] font-semibold text-slate-600 flex flex-col gap-1">
                {e.kind === 'REPLACE' ? 'Device taken out goes to' : 'Returned sound box goes to'}
                <select value={opt.returnStage} onChange={(x) => onOpt({ returnStage: x.target.value })} className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-900">
                  <option value="FAULTY">Faulty / repair</option>
                  <option value="BRANCH_RESERVE">Branch reserve (working)</option>
                  <option value="HQ_STOCK">Back to HQ stock</option>
                </select>
              </label>
            )}
            <label className="text-[11px] font-semibold text-slate-600 flex flex-col gap-1 flex-1 min-w-[150px]">
              Reason (needed to reject)
              <input value={opt.note} onChange={(x) => onOpt({ note: x.target.value })} maxLength={500} className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-normal text-slate-900" />
            </label>
            {(warned || /warning/i.test(err)) && !blocked && (
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer pb-1.5">
                <input type="checkbox" checked={opt.ack} onChange={(x) => onOpt({ ack: x.target.checked })} /> I checked the warnings
              </label>
            )}
            <div className="flex gap-2 ml-auto">
              <button type="button" onClick={onReject} disabled={busy} className="px-3.5 py-2 rounded-xl text-xs font-extrabold border border-rose-200 text-rose-700 bg-white hover:bg-rose-50 disabled:opacity-60 flex items-center gap-1.5 cursor-pointer">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />} Reject
              </button>
              <button type="button" onClick={onApprove} disabled={blocked || busy} className="px-3.5 py-2 rounded-xl text-xs font-extrabold bg-[#003857] hover:bg-[#002a42] text-white disabled:opacity-50 flex items-center gap-1.5 cursor-pointer">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Approve
              </button>
            </div>
            {err && <div role="alert" className="basis-full text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</div>}
          </div>
        )}
      </div>
    </div>
  );
};

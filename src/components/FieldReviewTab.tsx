import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Smartphone, Search, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Ban, Loader2, Cpu, Volume2, CheckSquare, Square } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Branch, Device, UserRole } from '../types';
import { STAGE_META } from '../data/initialData';
import {
  fetchBranchRegions,
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
const STATUS_CHIP: Record<string, string> = {
  PENDING: 'chip-slate', APPROVED: 'chip-green', REJECTED: 'chip-red', SUPERSEDED: 'chip-slate', CANCELLED: 'chip-slate',
};
const STATUS_LABEL: Record<string, string> = { PENDING: 'Waiting', APPROVED: 'Approved', REJECTED: 'Rejected', SUPERSEDED: 'Replaced by a newer edit', CANCELLED: 'Withdrawn in the phone app' };
type Filter = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL';
type TypeFilter = 'ALL' | 'POS Terminal' | 'Sound Box';
/** quiet styling: a small coloured dot tells POS Terminal (blue) from Sound Box (violet); everything else stays neutral */
const TYPE_STYLE = {
  'POS Terminal': { dot: 'bg-sky-500', on: 'bg-slate-800 text-white border-slate-800' },
  'Sound Box': { dot: 'bg-violet-500', on: 'bg-slate-800 text-white border-slate-800' },
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
  /** Settings: show Phnom Penh staff only, or Phnom Penh and regional staff */
  scope?: 'PHNOM_PENH' | 'ALL';
}

interface RowOpt { branchId: string; returnStage: string; note: string; ack: boolean }

export const FieldReviewTab: React.FC<Props> = ({ role, branches, devices, triggerToast, onApplied, onOpenWorkflow, scope = 'ALL' }) => {
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

  const [regions, setRegions] = useState<Record<string, string>>({});
  useEffect(() => { fetchBranchRegions().then(setRegions); }, []);
  /** a record of a regional branch is hidden when the setting is 'Phnom Penh only'; records without a known branch stay visible */
  const inScope = useCallback((e: FieldEvent) => {
    if (scope !== 'PHNOM_PENH') return true;
    const r = regions[String(e.branchId || '')];
    return !r || /phnom\s*penh/i.test(r);
  }, [scope, regions]);

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
    const q = query.trim().toLowerCase();
    return scoped
      .filter((e) => filter === 'ALL' || e.status === filter)
      .filter((e) => typeFilter === 'ALL' || e.deviceType === typeFilter)
      .filter((e) => !q || [e.serial, e.oldSerial, e.sourceRecordId, e.mid, e.tid, e.outletName, e.terminalName, e.staffName, e.staffId, e.branchText]
        .some((v) => String(v || '').toLowerCase().includes(q)))
      .sort((a, b) => filter === 'PENDING' ? a.receivedAt.localeCompare(b.receivedAt) : b.receivedAt.localeCompare(a.receivedAt));   // waiting: oldest first
  }, [scoped, filter, typeFilter, query]);

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

  const typeBtn = (t: TypeFilter, label: string, n: number) => (
    <button key={t} type="button" onClick={() => setTypeFilter(t)} aria-pressed={typeFilter === t}
      className={`btn-press px-2.5 py-1 rounded-lg text-xs font-semibold border cursor-pointer ${typeFilter === t ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>
      {t !== 'ALL' && <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${TYPE_STYLE[t].dot}`} aria-hidden />}{label} <span className="opacity-70">({n})</span>
    </button>
  );
  const colCount = isAdmin ? 9 : 8;

  return (
    <div className="flex flex-col gap-3">
      <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <Smartphone className="w-4 h-4 text-[#003857]" aria-hidden />
          <h2 className="text-base font-extrabold text-slate-900 mr-2">Phone App Review</h2>
          {(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as Filter[]).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
              className={`btn-press px-2.5 py-1 rounded-lg text-xs font-semibold border cursor-pointer ${filter === f ? 'bg-[#003857] text-white border-[#003857]' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>
              {f === 'PENDING' ? 'Waiting' : f === 'ALL' ? 'All' : f === 'APPROVED' ? 'Approved' : 'Rejected'} <span className="opacity-70">({counts[f]})</span>
            </button>
          ))}
          <span className="hidden sm:block w-px h-5 bg-slate-200 mx-1" aria-hidden />
          {typeBtn('ALL', 'All devices', typeCounts.pos + typeCounts.sb)}
          {typeBtn('POS Terminal', 'POS Terminal', typeCounts.pos)}
          {typeBtn('Sound Box', 'Sound Box', typeCounts.sb)}
          <span className="text-[11px] text-slate-500 hidden lg:inline">{scope === 'PHNOM_PENH' ? 'Phnom Penh staff only' : 'Phnom Penh and Regional staff'}</span>
          <div className="relative ml-auto w-full sm:w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Serial, MID, staff…" aria-label="Search records"
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs outline-none focus:border-[#003857]" />
          </div>
          <button type="button" onClick={load} aria-label="Refresh" className="btn-press p-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 cursor-pointer"><RefreshCw className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {isAdmin && shownPending.length > 0 && selectedShown.length > 0 && (
        <div className="sticky top-2 z-10 bg-white/95 backdrop-blur rounded-xl border border-slate-200 shadow-xs px-4 py-2.5 flex flex-wrap items-center gap-3">
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
        </div>
      )}

      {loadError && <div role="alert" className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">{loadError}</div>}
      {!events && !loadError && <div className="flex items-center gap-2 text-sm text-slate-500 p-6"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}
      {events && shown.length === 0 && (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          {filter === 'PENDING' ? 'Nothing is waiting for review.' : 'No records match.'}
        </div>
      )}

      {shown.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr className="bg-slate-50 text-slate-600">
                {isAdmin && (
                  <th className="col-no" style={{ width: 34 }}>
                    {shownPending.length > 0 && (
                      <button type="button" aria-label={allSelected ? 'Unselect all' : 'Select all waiting'} aria-pressed={allSelected} onClick={() => setSelected(allSelected ? new Set() : new Set(shownPending.map((e) => e.id)))} className="cursor-pointer">
                        {allSelected ? <CheckSquare className="w-4 h-4 text-[#003857]" /> : <Square className="w-4 h-4 text-slate-400" />}
                      </button>
                    )}
                  </th>
                )}
                <th className="col-no">No.</th>
                <th>Device Type</th>
                <th>Record Type</th>
                <th>Serial Number</th>
                <th>Merchant / MID · TID</th>
                <th>Branch / Staff</th>
                <th>In Inventory Now</th>
                <th>Status / Date</th>
              </tr>
            </thead>
            {shown.map((e, idx) => (
              <ReviewRows key={e.id} no={idx + 1} e={e} isAdmin={isAdmin} branches={branches} opt={optOf(e)} onOpt={(patch) => setOpt(e.id, patch)}
                checked={selected.has(e.id)} onCheck={() => toggle(e.id)} busy={busyIds.has(e.id) || !!bulkBusy} err={rowErr[e.id] || ''}
                device={deviceBySerial.get(e.serial.toUpperCase())} oldDevice={e.oldSerial ? deviceBySerial.get(e.oldSerial.toUpperCase()) : undefined}
                needsBranch={needsBranch(e)} needsReturn={needsReturn(e)} colCount={colCount}
                onApprove={() => approveRow(e)} onReject={() => rejectRow(e)} onOpenWorkflow={onOpenWorkflow} />
            ))}
          </table>
        </div>
      )}
    </div>
  );
};

const IssueList: React.FC<{ issues: FieldIssue[] }> = ({ issues }) => (
  <div className="flex flex-wrap gap-1.5">
    {issues.map((i, k) => (
      <span key={k} className={`inline-flex items-start gap-1 text-[11px] rounded-md px-1.5 py-0.5 border ${i.level === 'block' ? 'text-rose-800 bg-rose-50 border-rose-200' : 'text-amber-800 bg-amber-50/70 border-amber-200'}`}>
        {i.level === 'block' ? <Ban className="w-3 h-3 shrink-0 mt-0.5" /> : <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />}
        <span>{i.text}</span>
      </span>
    ))}
  </div>
);

const ReviewRows: React.FC<{
  no: number; e: FieldEvent; isAdmin: boolean; branches: Branch[]; opt: RowOpt; onOpt: (p: Partial<RowOpt>) => void; checked: boolean; onCheck: () => void;
  busy: boolean; err: string; device?: Device; oldDevice?: Device; needsBranch: boolean; needsReturn: boolean; colCount: number;
  onApprove: () => void; onReject: () => void; onOpenWorkflow?: (serial: string) => void;
}> = ({ no, e, isAdmin, branches, opt, onOpt, checked, onCheck, busy, err, device, oldDevice, needsBranch, needsReturn, colCount, onApprove, onReject, onOpenWorkflow }) => {
  const pending = e.status === 'PENDING';
  const type = e.deviceType === 'Sound Box' ? 'Sound Box' : 'POS Terminal';
  const blocked = e.issues.some((i) => i.level === 'block');
  const warned = e.issues.some((i) => i.level === 'warn');
  const stageText = (d?: Device) => d ? `${STAGE_META[d.stage]?.short || d.stage} · Branch ${d.branchId}` : 'Not in the inventory';
  const merchant = [e.outletName, e.terminalName && e.terminalName !== e.outletName ? e.terminalName : ''].filter(Boolean).join(' · ');
  const showControls = pending && isAdmin;
  const showSecond = showControls || (pending && e.issues.length > 0) || !pending;
  const line = showSecond ? { borderBottom: 0 } : undefined;

  return (
    <motion.tbody layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ type: 'spring', damping: 32, stiffness: 400, mass: 0.7 }}
      className={checked ? 'row-selected' : ''}>
      <tr>
        {isAdmin && (
          <td className="col-no" style={line}>
            {pending && <button type="button" onClick={onCheck} aria-pressed={checked} aria-label={`Select ${e.serial}`} className="cursor-pointer">{checked ? <CheckSquare className="w-4 h-4 text-[#003857]" /> : <Square className="w-4 h-4 text-slate-400" />}</button>}
          </td>
        )}
        <td className="col-no" style={line}>{no}</td>
        <td style={line}><span className="inline-flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${TYPE_STYLE[type].dot}`} aria-hidden />{type}</span></td>
        <td style={line}>{KIND_LABEL[e.kind]}{e.revision > 1 && <span className="cell-sub">Edited (revision {e.revision})</span>}</td>
        <td style={line}>
          <button type="button" onClick={() => device && onOpenWorkflow?.(device.serial)} disabled={!device || !onOpenWorkflow} className={`cell-mono ${device && onOpenWorkflow ? 'hover:underline cursor-pointer' : 'cursor-default'}`}>{e.serial}</button>
          {e.oldSerial && <div className="cell-mono-sub">replaces {e.oldSerial}</div>}
          {e.newBattery && <div className="cell-mono-sub">battery {e.oldBattery || '—'} → {e.newBattery}</div>}
        </td>
        <td style={line}>{merchant || '—'}<div className="cell-mono-sub">{[e.mid, e.tid].filter(Boolean).join(' · ') || '—'}</div></td>
        <td style={line}>{e.branchText || '—'}<div className="cell-sub">{e.staffName ? `${e.staffName}${e.staffId ? ` (${e.staffId})` : ''}` : '—'}</div></td>
        <td style={line}>{stageText(device)}{e.oldSerial && <div className="cell-sub">Old: {stageText(oldDevice)}</div>}</td>
        <td style={line}><span className={`chip ${STATUS_CHIP[e.status]}`}>{STATUS_LABEL[e.status]}</span><div className="cell-sub">{fmtTime(e.recordedAt)}</div></td>
      </tr>
      {showSecond && (
        <tr>
          <td colSpan={colCount} style={{ paddingTop: 0, paddingBottom: 8 }}>
            {pending && e.issues.length > 0 && <div className="mb-1.5"><IssueList issues={e.issues} /></div>}
            {!pending && (
              <div className="text-xs text-slate-600">{STATUS_LABEL[e.status]}{e.reviewedByName ? ` by ${e.reviewedByName}` : ''}{e.reviewedAt ? ` · ${fmtTime(e.reviewedAt)}` : ''}{e.reviewNote ? ` · ${e.reviewNote}` : ''}</div>
            )}
            {showControls && (
              <div className="flex flex-wrap items-center gap-2">
                {needsBranch && (
                  <select value={opt.branchId} onChange={(x) => onOpt({ branchId: x.target.value })} aria-label="Branch of this installation" className="px-2 py-1 rounded-lg border border-slate-300 bg-white text-xs text-slate-900 min-w-[150px]">
                    <option value="">Branch of installation…</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.id} · {b.name}</option>)}
                  </select>
                )}
                {needsReturn && (
                  <select value={opt.returnStage} onChange={(x) => onOpt({ returnStage: x.target.value })} aria-label={e.kind === 'REPLACE' ? 'Device taken out goes to' : 'Returned sound box goes to'} className="px-2 py-1 rounded-lg border border-slate-300 bg-white text-xs text-slate-900">
                    <option value="FAULTY">Old unit → Faulty / repair</option>
                    <option value="BRANCH_RESERVE">Old unit → Branch reserve</option>
                    <option value="HQ_STOCK">Old unit → Back to HQ stock</option>
                  </select>
                )}
                <input value={opt.note} onChange={(x) => onOpt({ note: x.target.value })} maxLength={500} placeholder="Reason (needed to reject)" aria-label="Reason" className="flex-1 min-w-[140px] px-2 py-1 rounded-lg border border-slate-300 bg-white text-xs text-slate-900" />
                {(warned || /warning/i.test(err)) && !blocked && (
                  <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={opt.ack} onChange={(x) => onOpt({ ack: x.target.checked })} /> I checked the warnings
                  </label>
                )}
                <button type="button" onClick={onReject} disabled={busy} className="btn-press px-3 py-1 rounded-lg text-xs font-bold border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-60 flex items-center gap-1.5 cursor-pointer">
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />} Reject
                </button>
                <button type="button" onClick={onApprove} disabled={blocked || busy} className="btn-press px-3 py-1 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 flex items-center gap-1.5 cursor-pointer">
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Approve
                </button>
              </div>
            )}
            {err && <div role="alert" className="mt-1.5 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-1.5">{err}</div>}
          </td>
        </tr>
      )}
    </motion.tbody>
  );
};

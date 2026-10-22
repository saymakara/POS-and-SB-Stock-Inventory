import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Smartphone, Search, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Ban, MapPin, Loader2, ExternalLink } from 'lucide-react';
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

export const FieldReviewTab: React.FC<Props> = ({ role, branches, devices, triggerToast, onApplied, onOpenWorkflow }) => {
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const [events, setEvents] = useState<FieldEvent[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState<Filter>('PENDING');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);

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

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (events || [])
      .filter((e) => filter === 'ALL' || e.status === filter)
      .filter((e) => !q || [e.serial, e.oldSerial, e.sourceRecordId, e.mid, e.tid, e.outletName, e.terminalName, e.staffName, e.staffId, e.branchText]
        .some((v) => String(v || '').toLowerCase().includes(q)))
      .sort((a, b) => filter === 'PENDING' ? a.receivedAt.localeCompare(b.receivedAt) : b.receivedAt.localeCompare(a.receivedAt));   // waiting: oldest first
  }, [events, filter, query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#003857] text-white flex items-center justify-center shrink-0"><Smartphone className="w-5 h-5" /></div>
            <div>
              <h2 className="text-lg font-extrabold text-slate-900">Phone App Review</h2>
              <p className="text-xs text-slate-600 max-w-2xl leading-relaxed">
                Installations, replacements, battery replacements and sound box visits saved in the Merchant Visit phone app.
                {isAdmin ? ' Check each device and approve it to update the stock, or reject it with a reason.' : ' An admin reviews each one before the stock is updated.'}
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
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer ${filter === f ? 'bg-[#003857] text-white border-[#003857]' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>
              {f === 'PENDING' ? 'Waiting' : f === 'ALL' ? 'All' : f === 'APPROVED' ? 'Approved' : 'Rejected'} <span className="opacity-75">({counts[f]})</span>
            </button>
          ))}
          <div className="relative ml-auto w-full sm:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Serial, Record ID, MID, staff…" aria-label="Search records"
              className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 text-xs outline-none focus:border-[#003857]" />
          </div>
        </div>
      </div>

      {loadError && <div role="alert" className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">{loadError}</div>}
      {!events && !loadError && <div className="flex items-center gap-2 text-sm text-slate-500 p-6"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}
      {events && shown.length === 0 && (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          {filter === 'PENDING' ? 'Nothing is waiting for review.' : 'No records match.'}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {shown.map((e) => (
          <ReviewCard key={e.id} e={e} open={openId === e.id} onToggle={() => setOpenId(openId === e.id ? null : e.id)} isAdmin={isAdmin}
            branches={branches} device={deviceBySerial.get(e.serial.toUpperCase())} oldDevice={e.oldSerial ? deviceBySerial.get(e.oldSerial.toUpperCase()) : undefined}
            triggerToast={triggerToast} onDone={(st) => { setOpenId(null); setEvents((prev) => prev && prev.map((x) => (x.id === e.id ? { ...x, status: st } : x))); onApplied(); }} onOpenWorkflow={onOpenWorkflow} />
        ))}
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

const ReviewCard: React.FC<{
  e: FieldEvent; open: boolean; onToggle: () => void; isAdmin: boolean; branches: Branch[]; device?: Device; oldDevice?: Device;
  triggerToast: (m: string) => void; onDone: (status: FieldEventStatus) => void; onOpenWorkflow?: (serial: string) => void;
}> = ({ e, open, onToggle, isAdmin, branches, device, oldDevice, triggerToast, onDone, onOpenWorkflow }) => {
  const [issues, setIssues] = useState<FieldIssue[]>(e.issues);
  const [branchId, setBranchId] = useState<string>(e.branchId || '');
  const [returnStage, setReturnStage] = useState<string>(e.kind === 'SB_RETURN' ? 'BRANCH_RESERVE' : 'FAULTY');
  const [note, setNote] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState<'' | 'check' | 'approve' | 'reject'>('');
  const [err, setErr] = useState('');
  const pending = e.status === 'PENDING';

  useEffect(() => { setIssues(e.issues); }, [e.issues]);
  // opened: the warnings are checked again against the stock as it is now
  useEffect(() => {
    if (!open || !pending || !isAdmin) return;
    let alive = true;
    setBusy('check');
    recheckFieldEvent(e.id, branchId || undefined).then((x) => { if (alive) setIssues(x); }).catch(() => {}).finally(() => alive && setBusy(''));
    return () => { alive = false; };
  }, [open, pending, isAdmin, e.id, branchId]);

  const blocked = issues.some((i) => i.level === 'block');
  const warned = issues.some((i) => i.level === 'warn');
  // (22 Oct 2026) a confirmation covers only the warnings that were shown: when they change, it must be given again
  const issueKey = issues.map((i) => i.code + ':' + i.text).join('|');
  useEffect(() => { setAck(false); }, [issueKey]);
  const needsBranch = (e.kind === 'INSTALL' || e.kind === 'REPLACE') && !branchId;
  const needsReturn = (e.kind === 'REPLACE' && !!e.oldSerial) || e.kind === 'SB_RETURN';

  const approve = async () => {
    setErr('');
    if (busy) { setErr('Please wait – the record is being checked again.'); return; }
    if (blocked) { setErr('This record cannot be approved as it is. Reject it with the reason, or correct the stock first.'); return; }
    if (needsBranch) { setErr('Choose the branch first.'); return; }
    if (warned && !ack) { setErr('Tick the box to confirm you checked the warnings.'); return; }
    setBusy('approve');
    try {
      await approveFieldEvent(e.id, note, { branch_id: branchId || undefined, return_stage: needsReturn ? returnStage : undefined, acknowledge: ack });
      triggerToast(`Approved · ${e.serial} · stock updated`);
      onDone('APPROVED');
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
    } finally { setBusy(''); }
  };
  const reject = async () => {
    setErr('');
    if (!note.trim()) { setErr('Write the reason in the note to reject.'); return; }
    setBusy('reject');
    try {
      await rejectFieldEvent(e.id, note.trim());
      triggerToast(`Rejected · ${e.serial}`);
      onDone('REJECTED');
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
    } finally { setBusy(''); }
  };

  const stageText = (d?: Device) => d ? `${STAGE_META[d.stage]?.short || d.stage} · Branch ${d.branchId}${d.merchantName ? ' · ' + d.merchantName : ''}` : 'Not in the inventory';
  const entry = (e.payload && e.payload.entry) || {};

  return (
    <div className={`bg-white rounded-2xl border shadow-xs ${open ? 'border-[#003857]/40' : 'border-slate-200'}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full text-left p-4 flex flex-wrap items-start gap-3 cursor-pointer">
        <div className="flex-1 min-w-[220px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">{e.deviceType} · {KIND_LABEL[e.kind]}</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${STATUS_STYLE[e.status]}`}>{STATUS_LABEL[e.status]}</span>
            {e.revision > 1 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-md border bg-sky-50 text-sky-800 border-sky-200">Edited (revision {e.revision})</span>}
          </div>
          <div className="mt-1.5 text-sm font-extrabold text-slate-900 font-mono">
            {e.serial}{e.oldSerial ? <span className="font-sans font-semibold text-slate-500 text-xs"> replaces </span> : null}{e.oldSerial ? <span>{e.oldSerial}</span> : null}
          </div>
          <div className="text-xs text-slate-600 mt-0.5">
            {[e.outletName, e.terminalName && e.terminalName !== e.outletName ? e.terminalName : '', e.mid ? 'MID ' + e.mid : '', e.tid ? 'TID ' + e.tid : '',
              e.newBattery ? 'Battery ' + (e.oldBattery || '—') + ' → ' + e.newBattery : ''].filter(Boolean).join(' · ')}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {e.staffName || 'Staff'}{e.staffId ? ` (${e.staffId})` : ''} · {e.branchText || 'no branch'} · {fmtTime(e.recordedAt)} · {e.sourceRecordId}{e.unitNo > 1 ? ' #' + e.unitNo : ''}
          </div>
        </div>
        {pending && issues.length > 0 && (
          <span className={`text-[11px] font-bold px-2 py-1 rounded-lg border flex items-center gap-1 ${issues.some((i) => i.level === 'block') ? 'bg-rose-50 text-rose-800 border-rose-200' : 'bg-amber-50 text-amber-800 border-amber-200'}`}>
            <AlertTriangle className="w-3.5 h-3.5" /> {issues.length} to check
          </span>
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-slate-100 pt-3 flex flex-col gap-3">
          <div className="grid sm:grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-2.5">
              <div className="text-[10px] font-bold uppercase text-slate-500">In the inventory now · {e.serial}</div>
              <div className="font-semibold text-slate-800 mt-0.5">{stageText(device)}</div>
              {device && onOpenWorkflow && <button type="button" onClick={() => onOpenWorkflow(device.serial)} className="mt-1 text-[11px] font-bold text-[#003857] hover:underline cursor-pointer">Open device</button>}
            </div>
            {e.oldSerial && (
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-2.5">
                <div className="text-[10px] font-bold uppercase text-slate-500">Device taken out · {e.oldSerial}</div>
                <div className="font-semibold text-slate-800 mt-0.5">{stageText(oldDevice)}</div>
              </div>
            )}
          </div>
          {(e.remarks || entry.feedback || entry.checks) && (
            <div className="text-xs text-slate-700 leading-relaxed">
              {e.remarks && <div><b>Remarks:</b> {e.remarks}</div>}
              {entry.feedback && <div><b>Merchant feedback:</b> {entry.feedback}</div>}
              {entry.checks && <div><b>Checks:</b> {Object.entries(entry.checks).map(([k, v]) => `${k}: ${v}`).join(' · ')}</div>}
            </div>
          )}
          {e.latitude != null && e.longitude != null && (
            <a href={`https://maps.google.com/?q=${e.latitude},${e.longitude}`} target="_blank" rel="noopener noreferrer"
              className="text-xs font-bold text-[#003857] flex items-center gap-1 w-fit hover:underline"><MapPin className="w-3.5 h-3.5" /> Open the location <ExternalLink className="w-3 h-3" /></a>
          )}
          {issues.length > 0 && <IssueList issues={issues} />}
          {busy === 'check' && <div className="text-[11px] text-slate-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Checking against the stock…</div>}

          {!pending && (
            <div className="text-xs text-slate-600">{STATUS_LABEL[e.status]}{e.reviewedByName ? ` by ${e.reviewedByName}` : ''}{e.reviewedAt ? ` · ${fmtTime(e.reviewedAt)}` : ''}{e.reviewNote ? ` · ${e.reviewNote}` : ''}</div>
          )}

          {pending && isAdmin && (
            <div className="flex flex-col gap-2.5 rounded-xl border border-slate-200 p-3 bg-slate-50/60">
              {(e.kind === 'INSTALL' || e.kind === 'REPLACE') && (
                <label className="text-xs font-bold text-slate-700 flex flex-col gap-1">
                  Branch of this installation{!e.branchId && <span className="font-semibold text-amber-700">The phone app's branch "{e.branchText || '—'}" was not recognised – choose it once; it is remembered.</span>}
                  <select value={branchId} onChange={(x) => setBranchId(x.target.value)} className="px-2.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold">
                    <option value="">Choose a branch…</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.id} · {b.name}</option>)}
                  </select>
                </label>
              )}
              {needsReturn && (
                <label className="text-xs font-bold text-slate-700 flex flex-col gap-1">
                  {e.kind === 'REPLACE' ? `The device taken out (${e.oldSerial}) goes to` : 'The returned sound box goes to'}
                  <select value={returnStage} onChange={(x) => setReturnStage(x.target.value)} className="px-2.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold">
                    <option value="FAULTY">Faulty / repair</option>
                    <option value="BRANCH_RESERVE">Branch reserve (working)</option>
                    <option value="HQ_STOCK">Back to HQ stock</option>
                  </select>
                </label>
              )}
              <label className="text-xs font-bold text-slate-700 flex flex-col gap-1">
                Note (required to reject)
                <textarea value={note} onChange={(x) => setNote(x.target.value)} rows={2} maxLength={500} className="px-2.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-normal" />
              </label>
              {warned && !blocked && (
                <label className="flex items-start gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={ack} onChange={(x) => setAck(x.target.checked)} className="mt-0.5" /> I checked the warnings above and the record is correct.
                </label>
              )}
              {err && <div role="alert" className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</div>}
              <div className="flex flex-wrap gap-2 justify-end">
                <button type="button" onClick={reject} disabled={!!busy && busy !== 'check'} className="px-3.5 py-2 rounded-xl text-xs font-extrabold border border-rose-200 text-rose-700 bg-white hover:bg-rose-50 disabled:opacity-60 flex items-center gap-1.5 cursor-pointer">
                  {busy === 'reject' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />} Reject
                </button>
                <button type="button" onClick={approve} disabled={blocked || !!busy} className="px-3.5 py-2 rounded-xl text-xs font-extrabold bg-[#003857] hover:bg-[#002a42] text-white disabled:opacity-50 flex items-center gap-1.5 cursor-pointer">
                  {busy === 'approve' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Approve and update stock
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

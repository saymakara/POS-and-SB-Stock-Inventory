import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, RefreshCw, Loader2, CheckCircle2, XCircle, ChevronDown, Send } from 'lucide-react';
import { Branch, UserRole } from '../types';
import {
  MATERIALS, MaterialBalance, MaterialCode, MaterialCount, cleanMaterialError, countMonth, countReview, countSubmit, fetchCounts, fetchMaterialBalances,
  fetchReserveSerials, isMaterialsMissing, materialName, placeName,
} from '../services/materialsService';
import { BusyLabel, Kpi, MaterialDialog, MaterialsSetupNotice, Pill, btnLight, btnPrimary, btnRow, fmtDay, inputCls, labelCls } from './MaterialsUi';

/**
 * (5 Nov 2026) Stock Inventory → Monthly Count. Once a month each branch counts what is on its shelf: SIM cards and
 * batteries by number (tick each one), adaptors, stands and docks by quantity. The count waits for Admin HQ: Approve
 * corrects the system to the count (a missing SIM or battery is recorded Lost), Reject asks for a recount.
 */
const months = (n = 6) => {
  const out: string[] = []; const now = countMonth().split('-').map(Number);
  let y = now[0], m = now[1];
  for (let i = 0; i < n; i++) { out.push(`${y}-${String(m).padStart(2, '0')}`); m--; if (!m) { m = 12; y--; } }
  return out;
};
const MONTH_NAME = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthLabel = (k: string) => MONTH_NAME.format(new Date(`${k}-01T00:00:00Z`));

export const MaterialCountTab: React.FC<{ role: UserRole; branches: Branch[]; myBranch: string; triggerToast: (m: string) => void; onChanged?: () => void }> = ({
  role, branches, myBranch, triggerToast, onChanged,
}) => {
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const [month, setMonth] = useState(countMonth());
  const [counts, setCounts] = useState<MaterialCount[] | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [form, setForm] = useState<string | null>(null);              // branch being counted
  const [review, setReview] = useState<{ c: MaterialCount; action: 'APPROVE' | 'REJECT' } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setCounts(await fetchCounts(month)); setErr(''); } catch (e) { const m = cleanMaterialError(e); setErr(isMaterialsMissing(m) ? 'SETUP' : m); setCounts((x) => x || []); } finally { setLoading(false); }
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const byBranch = useMemo(() => {
    const m = new Map<string, MaterialCount>();
    (counts || []).forEach((c) => { if (c.status !== 'REJECTED' || !m.has(c.branchId)) m.set(c.branchId, c); });
    return m;
  }, [counts]);
  const list = isAdmin ? branches.filter((b) => b.id !== '100').map((b) => b.id) : [myBranch];
  const counted = list.filter((id) => { const c = byBranch.get(id); return c && c.status !== 'REJECTED'; }).length;
  const withDiff = (counts || []).filter((c) => c.status === 'PENDING' && c.differences > 0).length;
  const waiting = (counts || []).filter((c) => c.status === 'PENDING').length;

  const doReview = async () => {
    if (!review) return;
    setBusy(true);
    try {
      await countReview({ id: review.c.id, action: review.action, note: note.trim() });
      triggerToast(review.action === 'APPROVE' ? `Count of ${placeName(review.c.branchId, branches)} approved.` : 'Count rejected: the branch counts again.');
      setReview(null); setNote(''); load(); onChanged?.();
    } catch (e) { triggerToast(`Not saved: ${cleanMaterialError(e)}`); } finally { setBusy(false); }
  };

  if (err === 'SETUP') return <MaterialsSetupNotice />;
  return (
    <div className="flex flex-col gap-3.5">
      <section className="relative overflow-hidden rounded-3xl p-6 sm:p-7 border shadow-sm bg-slate-100 border-slate-200/90" aria-label="Monthly count">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-1.5 max-w-3xl">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight flex items-center gap-3 text-slate-900"><ClipboardCheck className="w-7 h-7 text-[#003857]" aria-hidden /><span>Monthly Count</span></h1>
            <p className="text-sm sm:text-base text-slate-600">Each branch counts its SIM cards, batteries, adaptors, stands and docks once a month. Admin HQ approves the differences.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" className="px-3 py-2 rounded-xl text-sm font-semibold border bg-white text-slate-700 border-slate-200/90 shadow-2xs cursor-pointer">
              {months().map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
            {!isAdmin && (!byBranch.get(myBranch) || byBranch.get(myBranch)!.status !== 'APPROVED') && (
              <button type="button" className={btnPrimary} onClick={() => setForm(myBranch)}><ClipboardCheck className="w-4 h-4" />Count my branch</button>
            )}
            <button type="button" className={btnLight} onClick={load} aria-label="Refresh">{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}Refresh</button>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3.5 mt-5 pt-5 border-t border-slate-200/90">
          <Kpi icon={ClipboardCheck} label="Counted" value={counts ? `${counted} / ${list.length}` : undefined} sub={monthLabel(month)} />
          <Kpi icon={Send} label="Waiting for review" value={counts ? waiting : undefined} sub="submitted, not yet approved" />
          <Kpi icon={XCircle} label="With differences" value={counts ? withDiff : undefined} tone={withDiff ? 'bad' : undefined} sub="waiting counts that differ from the system" />
        </div>
      </section>

      {err && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">Could not load the counts: {err}</div>}

      <section className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden" aria-label="Counts by branch">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="bg-[#003857] text-white text-[11px] uppercase tracking-wider">
                <th className="text-left font-medium px-3.5 py-2.5">Branch</th><th className="text-left font-medium px-3.5 py-2.5">Counted by</th>
                <th className="text-left font-medium px-3.5 py-2.5">Differences</th><th className="text-left font-medium px-3.5 py-2.5">Status</th><th className="px-3.5 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {counts === null && <tr><td colSpan={5} className="px-3.5 py-5"><div className="skeleton h-4 rounded w-1/2" /></td></tr>}
              {counts !== null && list.map((id) => {
                const c = byBranch.get(id);
                const isOpen = !!c && open === c.id;
                return (
                  <React.Fragment key={id}>
                    <tr className={`align-top ${c ? 'cursor-pointer hover:bg-slate-50/70' : ''}`} onClick={() => c && setOpen(isOpen ? null : c.id)}>
                      <td className="px-3.5 py-2.5 font-medium text-slate-800">{placeName(id, branches)}</td>
                      <td className="px-3.5 py-2.5">{c ? <>{c.submittedBy || '—'}<span className="block text-xs text-slate-500">{fmtDay(c.submittedAt)}</span></> : <span className="text-slate-400">Not counted yet</span>}</td>
                      <td className="px-3.5 py-2.5">{c ? (c.differences ? <span className="font-semibold text-rose-700">{c.differences} item(s)</span> : <span className="text-emerald-700 font-semibold">Matches</span>) : '—'}</td>
                      <td className="px-3.5 py-2.5">{!c ? <Pill tone="warn">Due</Pill> : c.status === 'APPROVED' ? <Pill tone="good">Approved</Pill> : c.status === 'REJECTED' ? <Pill tone="bad">Rejected · recount</Pill> : <Pill tone="info">Waiting for review</Pill>}</td>
                      <td className="px-3.5 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1.5">
                          {isAdmin && c?.status === 'PENDING' && <>
                            <button type="button" className={btnRow} onClick={() => { setReview({ c, action: 'APPROVE' }); setNote(''); }}><CheckCircle2 className="w-3.5 h-3.5 inline -mt-0.5 mr-1 text-emerald-600" />Approve</button>
                            <button type="button" className={btnRow} onClick={() => { setReview({ c, action: 'REJECT' }); setNote(''); }}>Reject</button>
                          </>}
                          {isAdmin && (!c || c.status === 'REJECTED') && <button type="button" className={btnRow} onClick={() => setForm(id)}>Enter count</button>}
                          {c && <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />}
                        </div>
                      </td>
                    </tr>
                    {isOpen && c && (
                      <tr><td colSpan={5} className="bg-slate-50/70 px-5 py-3">
                        <table className="w-full text-xs">
                          <thead><tr className="text-slate-500 uppercase tracking-wider text-[10.5px]"><th className="text-left py-1.5">Item</th><th className="text-right py-1.5">System</th><th className="text-right py-1.5">Counted</th><th className="text-right py-1.5">Difference</th><th className="text-left py-1.5 pl-4">Detail</th></tr></thead>
                          <tbody>
                            {c.lines.map((l) => (
                              <tr key={l.code} className="border-t border-slate-200/70">
                                <td className="py-1.5 font-semibold text-slate-800">{materialName(l.code)}</td>
                                <td className="py-1.5 text-right tabular-nums">{l.system}</td><td className="py-1.5 text-right tabular-nums">{l.counted}</td>
                                <td className={`py-1.5 text-right tabular-nums font-bold ${l.diff < 0 ? 'text-rose-700' : l.diff > 0 ? 'text-amber-700' : 'text-slate-500'}`}>{l.diff > 0 ? `+${l.diff}` : l.diff}</td>
                                <td className="py-1.5 pl-4 text-slate-600">
                                  {l.missing?.length ? <span className="block">Not found: <span className="font-mono">{l.missing.join(', ')}</span></span> : null}
                                  {l.extra?.length ? <span className="block">Not on this branch's list: <span className="font-mono">{l.extra.join(', ')}</span></span> : null}
                                  {l.remark && <span className="block italic">"{l.remark}"</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {c.reviewedBy && <p className="mt-2 text-xs text-slate-500">{c.status === 'APPROVED' ? 'Approved' : 'Rejected'} by {c.reviewedBy} · {fmtDay(c.reviewedAt)}{c.reviewNote ? ` · ${c.reviewNote}` : ''}</p>}
                      </td></tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <CountForm branchId={form} month={month} branches={branches} onClose={() => setForm(null)} onDone={() => { setForm(null); load(); onChanged?.(); }} triggerToast={triggerToast} />
      <MaterialDialog open={!!review} busy={busy} onClose={() => setReview(null)}
        title={review?.action === 'APPROVE' ? 'Approve count' : 'Reject count'}
        sub={review ? `${placeName(review.c.branchId, branches)} · ${monthLabel(review.c.month)}` : ''}
        footer={<><button type="button" className={btnLight} onClick={() => setReview(null)} disabled={busy}>Cancel</button>
          <button type="button" className={btnPrimary} onClick={doReview} disabled={busy || (review?.action === 'REJECT' && note.trim().length < 3)}><BusyLabel busy={busy}>{review?.action === 'APPROVE' ? 'Approve' : 'Reject'}</BusyLabel></button></>}>
        <p className="text-sm text-slate-600">{review?.action === 'APPROVE'
          ? `The system will be corrected to the counted figures (${review.c.differences} item(s) differ). A SIM card or battery that was not found is recorded Lost.`
          : 'The branch is asked to count again. Nothing changes in stock.'}</p>
        <label className={labelCls}>{review?.action === 'REJECT' ? 'Reason (required)' : 'Note (optional)'}<input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></label>
      </MaterialDialog>
    </div>
  );
};

/** The count of one branch: quantities, and a tick list of the SIMs / batteries the system holds for it. */
const CountForm: React.FC<{ branchId: string | null; month: string; branches: Branch[]; onClose: () => void; onDone: () => void; triggerToast: (m: string) => void }> = ({
  branchId, month, branches, onClose, onDone, triggerToast,
}) => {
  const qtyMats = MATERIALS.filter((m) => m.tracking === 'QTY');
  const serialMats = MATERIALS.filter((m) => m.tracking === 'SERIAL');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [lists, setLists] = useState<Record<string, string[]> | null>(null);
  const [ticked, setTicked] = useState<Record<string, Set<string>>>({});
  const [remark, setRemark] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [bal, setBal] = useState<MaterialBalance[]>([]);
  useEffect(() => {
    if (!branchId) return;
    setQty({}); setRemark({}); setLists(null); setTicked({});
    Promise.all([Promise.all(serialMats.map((m) => fetchReserveSerials(m.code, branchId))), fetchMaterialBalances()])
      .then(([ls, b]) => {
        const o: Record<string, string[]> = {}; serialMats.forEach((m, i) => { o[m.code] = ls[i]; });
        setLists(o); setBal(b); setTicked({});
      })
      .catch((e) => { triggerToast(`Could not load the branch stock: ${cleanMaterialError(e)}`); setLists({}); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);
  if (!branchId) return null;
  const sys = (code: MaterialCode) => bal.find((b) => b.code === code && b.branchId === branchId)?.onHand || 0;
  const ready = lists !== null && qtyMats.every((m) => qty[m.code] !== undefined && qty[m.code] !== '' && Number(qty[m.code]) >= 0);
  const toggle = (code: string, s: string) => setTicked((t) => { const n = new Set(t[code] || []); if (n.has(s)) n.delete(s); else n.add(s); return { ...t, [code]: n }; });
  const submit = async () => {
    setBusy(true);
    try {
      const r = await countSubmit({
        branch_id: branchId, month,
        lines: [
          ...qtyMats.map((m) => ({ code: m.code, counted: Math.floor(Number(qty[m.code])), remark: remark[m.code] || undefined })),
          ...serialMats.map((m) => ({ code: m.code, present: Array.from(ticked[m.code] || []), remark: remark[m.code] || undefined })),
        ],
      });
      triggerToast(r.differences ? `Count sent: ${r.differences} item(s) differ from the system. Admin HQ will review.` : 'Count sent: everything matches.');
      onDone();
    } catch (e) { triggerToast(`Not sent: ${cleanMaterialError(e)}`); } finally { setBusy(false); }
  };
  return (
    <MaterialDialog open wide title={`Count · ${placeName(branchId, branches)}`} sub={`${monthLabel(month)} · count what is on the shelf now`} busy={busy} onClose={onClose}
      footer={<><button type="button" className={btnLight} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={btnPrimary} onClick={submit} disabled={!ready || busy}><BusyLabel busy={busy}>Send count</BusyLabel></button></>}>
      <div className="grid sm:grid-cols-2 gap-3">
        {qtyMats.map((m) => {
          const d = qty[m.code] === undefined || qty[m.code] === '' ? null : Number(qty[m.code]) - sys(m.code);
          return (
            <div key={m.code} className="rounded-xl border border-slate-200 p-3 flex flex-col gap-2">
              <label className={labelCls}>{m.name}
                <input className={inputCls} type="number" min={0} inputMode="numeric" value={qty[m.code] ?? ''} onChange={(e) => setQty((q) => ({ ...q, [m.code]: e.target.value }))} placeholder="Counted" />
              </label>
              <span className="text-xs text-slate-500">System: {sys(m.code)}{d !== null && d !== 0 && <b className={d < 0 ? 'text-rose-700' : 'text-amber-700'}> · difference {d > 0 ? `+${d}` : d}</b>}</span>
              {d !== null && d !== 0 && <input className={`${inputCls} text-xs`} value={remark[m.code] || ''} onChange={(e) => setRemark((r) => ({ ...r, [m.code]: e.target.value }))} placeholder="Why is it different?" maxLength={200} />}
            </div>
          );
        })}
      </div>
      {serialMats.map((m) => {
        const all = lists?.[m.code] || [];
        const t = ticked[m.code] || new Set<string>();
        return (
          <div key={m.code} className="rounded-xl border border-slate-200 p-3 flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <b className="text-sm text-slate-900">{m.name}: tick each one you can see ({t.size} of {all.length})</b>
              {all.length > 0 && <button type="button" className={btnRow} onClick={() => setTicked((x) => ({ ...x, [m.code]: t.size === all.length ? new Set() : new Set(all) }))}>{t.size === all.length ? 'Untick all' : 'Tick all'}</button>}
            </div>
            {lists === null ? <div className="skeleton h-4 rounded w-1/3" /> : all.length === 0 ? <span className="text-xs text-slate-500">The system holds none in this branch's reserve.</span> : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-48 overflow-y-auto">
                {all.map((s) => (
                  <label key={s} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border text-xs font-mono cursor-pointer ${t.has(s) ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'}`}>
                    <input type="checkbox" checked={t.has(s)} onChange={() => toggle(m.code, s)} />{s}
                  </label>
                ))}
              </div>
            )}
            {all.length > t.size && lists !== null && <input className={`${inputCls} text-xs`} value={remark[m.code] || ''} onChange={(e) => setRemark((r) => ({ ...r, [m.code]: e.target.value }))} placeholder={`${all.length - t.size} not ticked: what happened?`} maxLength={200} />}
          </div>
        );
      })}
    </MaterialDialog>
  );
};

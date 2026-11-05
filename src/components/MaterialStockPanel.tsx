import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Boxes, Cpu, Volume2, RefreshCw, Loader2, PackagePlus, PencilLine, Upload, AlertTriangle, Download, Package } from 'lucide-react';
import { Branch, UserRole } from '../types';
import { downloadCsv } from '../utils/exportCsv';
import { parseCsv } from '../utils/csv';
import {
  DeviceGroup, LostItem, MaterialBalance, MaterialCode, MATERIALS, SerialStatus, cleanMaterialError, fetchLost, fetchMaterialBalances,
  isMaterialsMissing, materialAdjust, materialByCode, materialLostAction, materialName, materialOpening, materialStockIn, normMaterialSerial, placeName, productMaterials,
} from '../services/materialsService';
import { BusyLabel, Kpi, MaterialDialog, MaterialsSetupNotice, Pill, btnLight, btnPrimary, btnRow, fmtDay, inputCls, labelCls } from './MaterialsUi';

/**
 * (5 Nov 2026) Stock Inventory → POS Terminal / Sound Box. Two tabs: Units (today's Stock Inventory, this product only)
 * and Material (the kit materials of this product: stock per location and the Lost table).
 */
export const ProductStockPage: React.FC<{
  group: DeviceGroup; role: UserRole; branches: Branch[]; myBranch: string; triggerToast: (m: string) => void;
  units: React.ReactNode; view: 'UNITS' | 'MATERIAL'; onViewChange: (v: 'UNITS' | 'MATERIAL') => void; onLostChanged?: () => void;
}> = ({ group, role, branches, myBranch, triggerToast, units, view, onViewChange, onLostChanged }) => {
  const Icon = group === 'POS' ? Cpu : Volume2;
  const title = group === 'POS' ? 'POS Terminal' : 'Sound Box';
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-lg sm:text-xl font-extrabold text-slate-900">
          <Icon className={`w-5 h-5 ${group === 'POS' ? 'text-[#006BA6]' : 'text-[#4F518C]'}`} aria-hidden />{title}
        </h2>
        <div role="tablist" aria-label={`${title} views`} className="inline-flex p-1 rounded-xl bg-slate-100 border border-slate-200">
          {(['UNITS', 'MATERIAL'] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => onViewChange(v)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold cursor-pointer transition ${view === v ? 'bg-[#003857] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}>
              {v === 'UNITS' ? 'Units' : 'Material'}
            </button>
          ))}
        </div>
      </div>
      {view === 'UNITS' ? units : <MaterialStockPanel group={group} role={role} branches={branches} myBranch={myBranch} triggerToast={triggerToast} onLostChanged={onLostChanged} />}
    </div>
  );
};

const MaterialStockPanel: React.FC<{ group: DeviceGroup; role: UserRole; branches: Branch[]; myBranch: string; triggerToast: (m: string) => void; onLostChanged?: () => void }> = ({
  group, role, branches, myBranch, triggerToast, onLostChanged,
}) => {
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const mats = useMemo(() => productMaterials(group), [group]);
  const codes = useMemo(() => mats.map((m) => m.code), [mats]);
  const [bal, setBal] = useState<MaterialBalance[] | null>(null);
  const [lost, setLost] = useState<LostItem[] | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [onlyStock, setOnlyStock] = useState(false);
  const [lostFilter, setLostFilter] = useState<'OPEN' | ''>('OPEN');
  const [dlg, setDlg] = useState<'' | 'IN' | 'ADJUST' | 'OPENING'>('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, l] = await Promise.all([fetchMaterialBalances(), fetchLost(codes, lostFilter)]);
      setBal(b); setLost(l); setErr('');
    } catch (e) {
      const m = cleanMaterialError(e); setErr(isMaterialsMissing(m) ? 'SETUP' : m); setBal((x) => x || []); setLost((x) => x || []);
    } finally { setLoading(false); }
  }, [codes, lostFilter]);
  useEffect(() => { load(); }, [load]);
  const changed = () => { load(); onLostChanged?.(); };

  const cell = useMemo(() => {
    const m = new Map<string, MaterialBalance>();
    (bal || []).forEach((b) => m.set(`${b.code}|${b.branchId}`, b));
    return m;
  }, [bal]);
  const totals = useMemo(() => codes.map((c) => ({
    code: c,
    hq: cell.get(`${c}|100`)?.onHand || 0,
    branches: (bal || []).filter((b) => b.code === c && b.branchId !== '100').reduce((s, b) => s + b.onHand, 0),
    transit: (bal || []).filter((b) => b.code === c).reduce((s, b) => s + b.inTransit, 0),
  })), [codes, bal, cell]);
  const places = useMemo(() => {
    const list = isAdmin ? ['100', ...branches.filter((b) => b.id !== '100').map((b) => b.id)] : [myBranch];
    return onlyStock ? list.filter((id) => codes.some((c) => (cell.get(`${c}|${id}`)?.onHand || 0) > 0)) : list;
  }, [isAdmin, branches, myBranch, onlyStock, codes, cell]);
  const openLost = (lost || []).filter((l) => l.status === 'OPEN').length;

  const exportCsv = () => {
    downloadCsv(`${group === 'POS' ? 'pos' : 'sound-box'}-material-stock`, ['Location', ...mats.map((m) => m.name)],
      places.map((id) => [placeName(id, branches), ...codes.map((c) => cell.get(`${c}|${id}`)?.onHand || 0)]));
    triggerToast(`Saved ${places.length} location(s).`);
  };

  if (err === 'SETUP') return <MaterialsSetupNotice />;
  return (
    <div className="flex flex-col gap-3.5">
      <section className={`grid grid-cols-2 gap-3.5 ${codes.length >= 4 ? 'lg:grid-cols-5' : 'lg:grid-cols-3'}`} aria-label="Material totals">
        {totals.map((t) => (
          <Kpi key={t.code} icon={Package} label={materialName(t.code)} value={bal ? t.hq + t.branches : undefined}
            sub={`HQ ${t.hq.toLocaleString()} · branches ${t.branches.toLocaleString()}${t.transit ? ` · ${t.transit} in transit` : ''}`} />
        ))}
        <Kpi icon={AlertTriangle} label="Lost, open" value={lost ? openLost : undefined} tone={openLost ? 'bad' : undefined} sub="reported at returns and replacements" />
      </section>

      <section className="flex flex-wrap items-center justify-between gap-2.5 bg-white rounded-2xl border border-slate-200 shadow-2xs px-3.5 py-3" aria-label="Actions">
        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
              <input type="checkbox" checked={onlyStock} onChange={(e) => setOnlyStock(e.target.checked)} /> Only locations with stock
            </label>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && <button type="button" className={btnPrimary} onClick={() => setDlg('IN')}><PackagePlus className="w-4 h-4" />Stock In</button>}
          {isAdmin && <button type="button" className={btnLight} onClick={() => setDlg('ADJUST')}><PencilLine className="w-4 h-4" />Correct</button>}
          {isAdmin && <button type="button" className={btnLight} onClick={() => setDlg('OPENING')}><Upload className="w-4 h-4" />Opening stock</button>}
          <button type="button" className={btnLight} onClick={exportCsv}><Download className="w-4 h-4" />Export CSV</button>
          <button type="button" className={btnLight} onClick={load} aria-label="Refresh">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}Refresh
          </button>
        </div>
      </section>

      {err && err !== 'SETUP' && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">Could not load the materials: {err}</div>}

      <section className="fr-table-frame bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-x-auto" aria-label="Stock per location">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="bg-[#003857] text-white text-[11px] uppercase tracking-wider">
              <th className="text-left font-medium px-3.5 py-2.5">Location</th>
              {mats.map((m) => <th key={m.code} className="text-right font-medium px-3.5 py-2.5">{m.name}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {bal === null && <tr><td colSpan={mats.length + 1} className="px-3.5 py-6"><div className="skeleton h-4 rounded w-1/2" /></td></tr>}
            {bal !== null && places.length === 0 && <tr><td colSpan={mats.length + 1} className="px-3.5 py-8 text-center text-slate-500">No location holds {group === 'POS' ? 'POS' : 'Sound Box'} materials yet.</td></tr>}
            {bal !== null && places.map((id) => (
              <tr key={id} className={id === '100' ? 'bg-sky-50/40' : 'hover:bg-slate-50/70'}>
                <td className="px-3.5 py-2.5 font-medium text-slate-800">{placeName(id, branches)}</td>
                {codes.map((c) => {
                  const b = cell.get(`${c}|${id}`);
                  return (
                    <td key={c} className="px-3.5 py-2.5 text-right tabular-nums">
                      <span className={b?.onHand ? 'font-semibold text-slate-900' : 'text-slate-400'}>{(b?.onHand || 0).toLocaleString()}</span>
                      {b?.inTransit ? <span className="block text-[11px] text-indigo-700">{b.inTransit} in transit</span> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <LostTable title={`Lost · ${group === 'POS' ? 'POS Terminal' : 'Sound Box'} material`} rows={lost} branches={branches} isAdmin={isAdmin}
        filter={lostFilter} onFilter={setLostFilter} onChanged={changed} triggerToast={triggerToast} />

      <StockInDialog open={dlg === 'IN'} codes={codes} branches={branches} onClose={() => setDlg('')} onDone={changed} triggerToast={triggerToast} />
      <AdjustDialog open={dlg === 'ADJUST'} codes={codes} branches={branches} onClose={() => setDlg('')} onDone={changed} triggerToast={triggerToast} />
      <OpeningDialog open={dlg === 'OPENING'} branches={branches} onClose={() => setDlg('')} onDone={changed} triggerToast={triggerToast} />
    </div>
  );
};

/** The Lost table of a page: Open → Recovered or Written off (reason); a SIM can be marked Blocked with carrier. */
export const LostTable: React.FC<{
  title: string; rows: LostItem[] | null; branches: Branch[]; isAdmin: boolean; filter: 'OPEN' | ''; onFilter: (f: 'OPEN' | '') => void;
  onChanged: () => void; triggerToast: (m: string) => void;
}> = ({ title, rows, branches, isAdmin, filter, onFilter, onChanged, triggerToast }) => {
  const [act, setAct] = useState<{ item: LostItem; action: 'RECOVER' | 'WRITE_OFF' } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (item: LostItem, action: 'RECOVER' | 'WRITE_OFF' | 'BLOCKED', why = '') => {
    setBusy(true);
    try {
      await materialLostAction({ id: item.id, action, reason: why });
      triggerToast(action === 'BLOCKED' ? `SIM ${item.serial} marked blocked with the carrier.` : action === 'RECOVER' ? `${materialName(item.code)} recovered: back in branch stock.` : `${materialName(item.code)} written off.`);
      setAct(null); setReason(''); onChanged();
    } catch (e) { triggerToast(`Not saved: ${cleanMaterialError(e)}`); } finally { setBusy(false); }
  };
  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-rose-600" />{title}</h3>
        <div className="inline-flex p-0.5 rounded-lg bg-slate-100 border border-slate-200 text-xs font-semibold">
          {([['OPEN', 'Open'], ['', 'All']] as const).map(([v, l]) => (
            <button key={l} type="button" onClick={() => onFilter(v)} aria-pressed={filter === v}
              className={`px-3 py-1 rounded-md cursor-pointer ${filter === v ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500'}`}>{l}</button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-slate-500 bg-slate-50">
              <th className="text-left font-semibold px-4 py-2">Date</th><th className="text-left font-semibold px-4 py-2">Item</th>
              <th className="text-left font-semibold px-4 py-2">Merchant / unit</th><th className="text-left font-semibold px-4 py-2">Branch / reported by</th>
              <th className="text-left font-semibold px-4 py-2">Remark</th><th className="text-left font-semibold px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows === null && <tr><td colSpan={6} className="px-4 py-5"><div className="skeleton h-4 rounded w-1/3" /></td></tr>}
            {rows !== null && rows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-emerald-700 font-semibold">{filter === 'OPEN' ? 'No open lost item.' : 'Nothing reported lost.'}</td></tr>}
            {(rows || []).map((l) => (
              <tr key={l.id} className="align-top">
                <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">{fmtDay(l.createdAt)}<span className="block text-[11px] text-slate-500">{l.source || ''}</span></td>
                <td className="px-4 py-2.5"><b className="text-slate-900">{materialName(l.code)}</b>{l.serial ? <span className="block font-mono text-xs text-slate-600">{l.serial}</span> : <span className="block text-xs text-slate-600">× {l.qty}</span>}</td>
                <td className="px-4 py-2.5">{l.merchantName || '—'}<span className="block text-xs text-slate-500">{[l.mid && `MID ${l.mid}`, l.deviceSerial].filter(Boolean).join(' · ') || 'branch stock'}</span></td>
                <td className="px-4 py-2.5">{placeName(l.branchId, branches)}<span className="block text-xs text-slate-500">{l.reportedBy || ''}</span></td>
                <td className="px-4 py-2.5 text-slate-700 max-w-[260px]">{l.remark || '—'}{l.resolution && <span className="block text-xs text-slate-500">Closed: {l.resolution}</span>}</td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {l.status === 'OPEN' ? <Pill tone="bad">Open</Pill> : l.status === 'RECOVERED' ? <Pill tone="good">Recovered</Pill> : <Pill tone="mute">Written off</Pill>}
                    {l.code === 'SIM' && (l.blocked ? <Pill tone="info">Blocked with carrier</Pill> : isAdmin && <button type="button" className={btnRow} disabled={busy} onClick={() => run(l, 'BLOCKED')}>Blocked with carrier</button>)}
                    {isAdmin && l.status === 'OPEN' && <>
                      <button type="button" className={btnRow} disabled={busy} onClick={() => { setAct({ item: l, action: 'RECOVER' }); setReason(''); }}>Recovered</button>
                      <button type="button" className={btnRow} disabled={busy} onClick={() => { setAct({ item: l, action: 'WRITE_OFF' }); setReason(''); }}>Write off</button>
                    </>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <MaterialDialog open={!!act} busy={busy} onClose={() => setAct(null)}
        title={act?.action === 'RECOVER' ? 'Item recovered' : 'Write off lost item'}
        sub={act ? `${materialName(act.item.code)} ${act.item.serial || '× ' + act.item.qty} · ${placeName(act.item.branchId, branches)}` : ''}
        footer={<>
          <button type="button" className={btnLight} onClick={() => setAct(null)} disabled={busy}>Cancel</button>
          <button type="button" className={btnPrimary} disabled={busy || (act?.action === 'WRITE_OFF' && reason.trim().length < 3)} onClick={() => act && run(act.item, act.action, reason.trim())}>
            <BusyLabel busy={busy}>{act?.action === 'RECOVER' ? 'Back to branch stock' : 'Write off'}</BusyLabel>
          </button>
        </>}>
        <p className="text-sm text-slate-600">{act?.action === 'RECOVER' ? 'The item was found. It goes back into the reserve of its branch.' : 'The item will not come back. It is removed from stock for good; the reason is kept in the Audit Trail.'}</p>
        <label className={labelCls}>{act?.action === 'RECOVER' ? 'Note (optional)' : 'Reason (required)'}
          <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder={act?.action === 'RECOVER' ? 'e.g. found at the shop' : 'e.g. merchant closed, not reachable'} />
        </label>
      </MaterialDialog>
    </section>
  );
};

const PlaceSelect: React.FC<{ value: string; onChange: (v: string) => void; branches: Branch[]; id: string }> = ({ value, onChange, branches, id }) => (
  <select id={id} className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
    <option value="100">Head Office</option>
    {branches.filter((b) => b.id !== '100').map((b) => <option key={b.id} value={b.id}>{b.id} · {b.name}</option>)}
  </select>
);

/** Numbers typed or pasted one per line (or separated by commas), cleaned and de-duplicated. */
const parseNumbers = (code: MaterialCode, text: string) => {
  const ok: string[] = []; const bad: string[] = []; const seen = new Set<string>();
  text.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean).forEach((raw) => {
    const s = normMaterialSerial(code, raw);
    if (!s) bad.push(raw); else if (!seen.has(s)) { seen.add(s); ok.push(s); }
  });
  return { ok, bad };
};

export const StockInDialog: React.FC<{ open: boolean; codes: MaterialCode[]; branches: Branch[]; onClose: () => void; onDone: () => void; triggerToast: (m: string) => void }> = ({
  open, codes, branches, onClose, onDone, triggerToast,
}) => {
  const [code, setCode] = useState<MaterialCode>(codes[0]);
  const [place, setPlace] = useState('100');
  const [qty, setQty] = useState('');
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setCode(codes[0]); setPlace('100'); setQty(''); setText(''); setNote(''); } }, [open, codes]);
  const m = materialByCode.get(code)!;
  const nums = m.tracking === 'SERIAL' ? parseNumbers(code, text) : { ok: [], bad: [] };
  const ready = m.tracking === 'QTY' ? Number(qty) > 0 : nums.ok.length > 0;
  const save = async () => {
    setBusy(true);
    try {
      const r = await materialStockIn(m.tracking === 'QTY' ? { code, branch_id: place, qty: Math.floor(Number(qty)), note } : { code, branch_id: place, serials: nums.ok, note });
      triggerToast(`${m.name}: ${r.added} added${r.refused?.length ? `; ${r.refused.length} refused (${r.refused.slice(0, 3).map((x) => `${x.serial}: ${x.why}`).join('; ')})` : ''}.`);
      onDone(); onClose();
    } catch (e) { triggerToast(`Not added: ${cleanMaterialError(e)}`); } finally { setBusy(false); }
  };
  return (
    <MaterialDialog open={open} title="Stock In" sub="New materials received" busy={busy} onClose={onClose}
      footer={<><button type="button" className={btnLight} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={btnPrimary} onClick={save} disabled={!ready || busy}><BusyLabel busy={busy}>Add to stock</BusyLabel></button></>}>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className={labelCls} htmlFor="si-code">Material
          <select id="si-code" className={inputCls} value={code} onChange={(e) => setCode(e.target.value as MaterialCode)}>
            {codes.map((c) => <option key={c} value={c}>{materialName(c)}</option>)}
          </select>
        </label>
        <label className={labelCls} htmlFor="si-place">Location<PlaceSelect id="si-place" value={place} onChange={setPlace} branches={branches} /></label>
      </div>
      {m.tracking === 'QTY' ? (
        <label className={labelCls}>Quantity<input className={inputCls} type="number" min={1} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
      ) : (
        <label className={labelCls}>{m.name} numbers, one per line
          <textarea className={`${inputCls} font-mono h-36`} value={text} onChange={(e) => setText(e.target.value)} placeholder={code === 'SIM' ? '096 555 0142\n012 345 678' : 'BAT-100231'} />
          <span className="font-normal text-slate-500">{nums.ok.length} valid{nums.bad.length ? ` · ${nums.bad.length} not valid: ${nums.bad.slice(0, 4).join(', ')}` : ''}</span>
        </label>
      )}
      <label className={labelCls}>Note (optional)<input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. delivery from supplier, invoice no." /></label>
    </MaterialDialog>
  );
};

export const AdjustDialog: React.FC<{ open: boolean; codes: MaterialCode[]; branches: Branch[]; onClose: () => void; onDone: () => void; triggerToast: (m: string) => void }> = ({
  open, codes, branches, onClose, onDone, triggerToast,
}) => {
  const [code, setCode] = useState<MaterialCode>(codes[0]);
  const [place, setPlace] = useState('100');
  const [qty, setQty] = useState('');
  const [serial, setSerial] = useState('');
  const [status, setStatus] = useState<SerialStatus>('BRANCH_RESERVE');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setCode(codes[0]); setPlace('100'); setQty(''); setSerial(''); setStatus('BRANCH_RESERVE'); setReason(''); } }, [open, codes]);
  const m = materialByCode.get(code)!;
  const ready = reason.trim().length >= 3 && (m.tracking === 'QTY' ? qty !== '' && Number(qty) >= 0 : !!normMaterialSerial(code, serial));
  const save = async () => {
    setBusy(true);
    try {
      await materialAdjust(m.tracking === 'QTY' ? { code, branch_id: place, qty: Math.floor(Number(qty)), reason: reason.trim() }
        : { code, branch_id: place, serial, status, reason: reason.trim() });
      triggerToast(`${m.name} corrected.`); onDone(); onClose();
    } catch (e) { triggerToast(`Not corrected: ${cleanMaterialError(e)}`); } finally { setBusy(false); }
  };
  return (
    <MaterialDialog open={open} title="Correct stock" sub="Set the right figure; the reason is kept in the Audit Trail" busy={busy} onClose={onClose}
      footer={<><button type="button" className={btnLight} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={btnPrimary} onClick={save} disabled={!ready || busy}><BusyLabel busy={busy}>Save correction</BusyLabel></button></>}>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className={labelCls} htmlFor="ad-code">Material
          <select id="ad-code" className={inputCls} value={code} onChange={(e) => setCode(e.target.value as MaterialCode)}>
            {codes.map((c) => <option key={c} value={c}>{materialName(c)}</option>)}
          </select>
        </label>
        <label className={labelCls} htmlFor="ad-place">Location<PlaceSelect id="ad-place" value={place} onChange={setPlace} branches={branches} /></label>
      </div>
      {m.tracking === 'QTY' ? (
        <label className={labelCls}>Correct quantity at this location<input className={inputCls} type="number" min={0} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          <label className={labelCls}>{m.name} number<input className={`${inputCls} font-mono`} value={serial} onChange={(e) => setSerial(e.target.value)} /></label>
          <label className={labelCls} htmlFor="ad-status">Set to
            <select id="ad-status" className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as SerialStatus)}>
              <option value="BRANCH_RESERVE">In this location's stock</option><option value="FAULTY">Faulty</option><option value="WRITTEN_OFF">Written off</option>
            </select>
          </label>
        </div>
      )}
      <label className={labelCls}>Reason (required)<input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. counted 12 on the shelf" /></label>
    </MaterialDialog>
  );
};

/** Opening stock from a CSV file (Excel: File → Save As → CSV). Columns: Branch, Material, Quantity, Number. */
const MATERIAL_ALIASES: Record<string, MaterialCode> = {
  sim: 'SIM', simcard: 'SIM', battery: 'BATTERY', posadaptor: 'POS_ADAPTOR', posacadaptor: 'POS_ADAPTOR', adaptorpos: 'POS_ADAPTOR',
  stand: 'STAND', posstand: 'STAND', posstandholder: 'STAND', standholder: 'STAND', dock: 'DOCK', chargingdock: 'DOCK',
  sbadaptor: 'SB_ADAPTOR', soundboxadaptor: 'SB_ADAPTOR', soundboxacadaptor: 'SB_ADAPTOR',
};
const toCode = (s: string): MaterialCode | null => {
  const k = String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  if (MATERIALS.some((m) => m.code.toLowerCase().replace(/_/g, '') === k)) return MATERIALS.find((m) => m.code.toLowerCase().replace(/_/g, '') === k)!.code;
  return MATERIAL_ALIASES[k] || null;
};
const OpeningDialog: React.FC<{ open: boolean; branches: Branch[]; onClose: () => void; onDone: () => void; triggerToast: (m: string) => void }> = ({ open, branches, onClose, onDone, triggerToast }) => {
  const [file, setFile] = useState('');
  const [rows, setRows] = useState<{ qty: { branch: string; code: string; qty: number }[]; serials: { branch: string; code: string; serial: string }[]; bad: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  useEffect(() => { if (open) { setFile(''); setRows(null); setResult(''); } }, [open]);
  const template = () => {
    const b = branches.find((x) => x.id !== '100')?.id || '105';
    downloadCsv('material-opening-stock-template', ['Branch', 'Material', 'Quantity', 'Number'], [
      [b, 'POS AC Adaptor', 10, ''], [b, 'POS Stand Holder', 3, ''], [b, 'Charging Dock', 1, ''], [b, 'Sound Box AC Adaptor', 5, ''],
      [b, 'SIM Card', '', '096 555 0142'], [b, 'Battery', '', 'BAT-100231'], ['100', 'POS AC Adaptor', 500, ''],
    ]);
  };
  const read = async (f: File) => {
    setFile(f.name); setResult('');
    const grid = parseCsv(await f.text());
    const head = (grid[0] || []).map((h) => h.toLowerCase().trim());
    const col = (n: string) => head.findIndex((h) => h.startsWith(n));
    const iB = col('branch'), iM = col('material'), iQ = col('quantity') >= 0 ? col('quantity') : col('qty'), iN = col('number') >= 0 ? col('number') : col('serial');
    if (iB < 0 || iM < 0) { setRows({ qty: [], serials: [], bad: ['The first row must name the columns Branch, Material, Quantity, Number (use the template).'] }); return; }
    const out = { qty: [] as { branch: string; code: string; qty: number }[], serials: [] as { branch: string; code: string; serial: string }[], bad: [] as string[] };
    grid.slice(1).forEach((r, i) => {
      if (!r.some((c) => String(c).trim())) return;
      const code = toCode(r[iM]); const branch = String(r[iB] || '').trim();
      if (!code || !branch) { out.bad.push(`Row ${i + 2}: ${!branch ? 'no branch' : `unknown material "${r[iM]}"`}`); return; }
      const m = materialByCode.get(code)!;
      if (m.tracking === 'SERIAL') {
        const n = iN >= 0 ? String(r[iN] || '').trim() : '';
        if (!n) { out.bad.push(`Row ${i + 2}: ${m.name} needs a number`); return; }
        out.serials.push({ branch, code, serial: n });
      } else {
        const q = Number(String(iQ >= 0 ? r[iQ] : '').replace(/,/g, ''));
        if (!Number.isFinite(q) || q < 0) { out.bad.push(`Row ${i + 2}: ${m.name} needs a quantity`); return; }
        out.qty.push({ branch, code, qty: Math.floor(q) });
      }
    });
    setRows(out);
  };
  const save = async () => {
    if (!rows) return;
    setBusy(true);
    try {
      const r = await materialOpening({ qty: rows.qty, serials: rows.serials });
      setResult(`${r.qty_lines} quantity line(s) and ${r.serials} number(s) loaded.${r.refused.length ? ` ${r.refused.length} refused: ${r.refused.slice(0, 5).map((x) => x.why).join('; ')}` : ''}`);
      triggerToast('Opening stock loaded.'); onDone();
    } catch (e) { setResult(`Not loaded: ${cleanMaterialError(e)}`); } finally { setBusy(false); }
  };
  return (
    <MaterialDialog open={open} wide title="Opening stock" sub="Load the current counts of every branch once, before go-live" busy={busy} onClose={onClose}
      footer={<><button type="button" className={btnLight} onClick={onClose} disabled={busy}>Close</button>
        <button type="button" className={btnPrimary} onClick={save} disabled={busy || !rows || rows.qty.length + rows.serials.length === 0 || !!result}><BusyLabel busy={busy}>Load {rows ? rows.qty.length + rows.serials.length : 0} row(s)</BusyLabel></button></>}>
      <ol className="list-decimal pl-5 text-sm text-slate-700 space-y-1">
        <li>Download the template and fill one row per branch and material: <b>Quantity</b> for adaptors, stands and docks; one row per <b>Number</b> for SIM cards and batteries. Branch can be the code (105) or the name.</li>
        <li>In Excel: File → Save As → <b>CSV</b>. Then choose the file below.</li>
        <li>Quantities are <b>set</b> to the figure in the file (loading again corrects them); numbers already registered are refused.</li>
      </ol>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnLight} onClick={template}><Download className="w-4 h-4" />Download template</button>
        <label className={`${btnLight} relative`}>
          <Upload className="w-4 h-4" />{file || 'Choose CSV file'}
          <input type="file" accept=".csv,text/csv" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = ''; }} />
        </label>
      </div>
      {rows && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
          <b>{rows.qty.length}</b> quantity row(s) · <b>{rows.serials.length}</b> SIM / battery number(s)
          {rows.bad.length > 0 && <ul className="mt-2 text-rose-700 text-xs list-disc pl-5">{rows.bad.slice(0, 8).map((b) => <li key={b}>{b}</li>)}{rows.bad.length > 8 && <li>… {rows.bad.length - 8} more</li>}</ul>}
        </div>
      )}
      {result && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{result}</div>}
      <p className="text-xs text-slate-500 flex items-center gap-1.5"><Boxes className="w-3.5 h-3.5" />Every loaded figure is recorded in the material history and the Audit Trail.</p>
    </MaterialDialog>
  );
};

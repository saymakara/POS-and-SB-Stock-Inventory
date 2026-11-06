import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Package, Wifi, Signal, History, Loader2, Plus, Undo2, Repeat } from 'lucide-react';
import { Device, UserRole } from '../types';
import {
  DeviceKit, KitItem, MaterialCode, Movement, cleanMaterialError, deviceGroup, fetchKits, fetchMovements, isMaterialsMissing, kitAdd, kitMaterials, kitReplace,
  kitReturn, materialByCode, materialName, normMaterialSerial,
} from '../services/materialsService';
import { BusyLabel, MaterialDialog, Pill, btnLight, btnPrimary, btnRow, fmtDay, inputCls, labelCls } from './MaterialsUi';

/**
 * (5 Nov 2026) Merchant 360 → Kit. What this merchant holds with each unit: connection (4G SIM or the merchant's Wi-Fi),
 * SIM number, battery serial, adaptor, stand, dock, with who gave it and when. Admin HQ can record the kit of an existing
 * merchant, issue items from the branch reserve, take items back (Returned / Lost / Faulty) or replace one.
 */
const KIND_LABEL: Record<string, string> = {
  KIT_ADD: 'Issued from branch stock', KIT_BASELINE: 'Recorded (already at the merchant)', KIT_RETURN: 'Returned to branch stock',
  LOST: 'Reported lost', FAULTY: 'Returned faulty', RECOVER: 'Recovered', WRITE_OFF: 'Written off',
};

export const MerchantKitCard: React.FC<{ devices: Device[]; role: UserRole }> = ({ devices, role }) => {
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const serials = useMemo(() => devices.map((d) => d.serial), [devices]);
  const [kits, setKits] = useState<Map<string, DeviceKit> | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [dlg, setDlg] = useState<{ kind: 'RECORD' | 'ISSUE' | 'RETURN' | 'REPLACE'; device: Device } | null>(null);
  const [hist, setHist] = useState<{ serial: string; rows: Movement[] | null } | null>(null);

  const load = useCallback(async () => {
    try { setKits(await fetchKits(serials)); setErr(''); } catch (e) { const m = cleanMaterialError(e); setErr(isMaterialsMissing(m) ? 'SETUP' : m); setKits(new Map()); }
  }, [serials]);
  useEffect(() => { load(); }, [load]);
  const openHist = async (serial: string) => {
    if (hist?.serial === serial) { setHist(null); return; }
    setHist({ serial, rows: null });
    try { const rows = await fetchMovements({ deviceSerial: serial, limit: 60 }); setHist({ serial, rows }); } catch { setHist({ serial, rows: [] }); }
  };
  const done = (m: string) => { setMsg(m); setDlg(null); load(); if (hist) openHist(hist.serial).then(() => undefined); };

  if (err === 'SETUP') return null;   // materials not set up yet: the card stays hidden
  return (
    <div>
      <div className="flex items-center justify-between mb-2.5">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5"><Package className="w-3.5 h-3.5 text-slate-400" />Kit held by the merchant</h4>
      </div>
      {msg && <div role="status" className="mb-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs text-emerald-900">{msg}</div>}
      {err && <div role="alert" className="mb-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs text-rose-800">Could not load the kit: {err}</div>}
      <div className="flex flex-col gap-2.5">
        {devices.map((dev) => {
          const k = kits?.get(dev.serial);
          const items = k?.items || [];
          return (
            <div key={dev.serial} className="p-3.5 rounded-2xl border bg-slate-50/80 border-slate-200/90 shadow-2xs hover:bg-slate-50 transition-all">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900">{dev.type} · <span className="font-mono">{dev.serial}</span></div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {k?.connection === 'SIM' ? <Pill tone="info"><Signal className="w-3 h-3" />4G SIM</Pill> : k?.connection === 'WIFI' ? <Pill tone="mute"><Wifi className="w-3 h-3" />Merchant Wi-Fi</Pill> : <Pill tone="warn">Connection not recorded</Pill>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {isAdmin && items.length === 0 && <button type="button" className={btnRow} onClick={() => setDlg({ kind: 'RECORD', device: dev })}><Plus className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />Record kit</button>}
                  {isAdmin && <button type="button" className={btnRow} onClick={() => setDlg({ kind: 'ISSUE', device: dev })}>Issue from stock</button>}
                  {isAdmin && items.length > 0 && <button type="button" className={btnRow} onClick={() => setDlg({ kind: 'REPLACE', device: dev })}><Repeat className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />Replace</button>}
                  {isAdmin && items.length > 0 && <button type="button" className={btnRow} onClick={() => setDlg({ kind: 'RETURN', device: dev })}><Undo2 className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />Take back</button>}
                  <button type="button" className={btnRow} onClick={() => openHist(dev.serial)} aria-expanded={hist?.serial === dev.serial}><History className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />History</button>
                </div>
              </div>
              {kits === null ? <div className="skeleton h-4 rounded w-1/2 mt-3" /> : items.length === 0 ? (
                <p className="mt-2.5 text-xs text-slate-500">No kit recorded for this unit yet.{dev.batterySerial ? ` Battery on the unit record: ${dev.batterySerial}.` : ''}</p>
              ) : (
                <ul className="mt-2.5 divide-y divide-slate-100">
                  {items.map((it, i) => (
                    <li key={`${it.code}-${it.serial || i}`} className="py-1.5 flex flex-wrap items-baseline justify-between gap-2 text-xs">
                      <span className="text-slate-800"><b>{materialName(it.code)}</b> {it.serial ? <span className="font-mono">{it.serial}</span> : <span>× {it.qty}</span>}{it.note ? <span className="text-slate-500"> · {it.note}</span> : null}</span>
                      <span className="text-slate-500">{fmtDay(it.given_at)}{it.given_by ? ` · ${it.given_by}` : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
              {hist?.serial === dev.serial && (
                <div className="mt-2.5 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
                  {hist.rows === null ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : hist.rows.length === 0 ? <span className="text-xs text-slate-500">No kit history yet.</span> : (
                    <ol className="flex flex-col gap-1.5">
                      {hist.rows.map((m) => (
                        <li key={m.id} className="text-xs grid grid-cols-[86px_1fr] gap-2">
                          <span className="text-slate-500 tabular-nums">{fmtDay(m.at)}</span>
                          <span><b>{KIND_LABEL[m.kind] || m.kind}</b>: {materialName(m.code)} {m.serial || `× ${Math.abs(m.qty)}`}{m.note ? ` · ${m.note}` : ''}<span className="text-slate-500"> · {m.actor || ''}</span></span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {dlg && (dlg.kind === 'RECORD' || dlg.kind === 'ISSUE') && <KitAddDialog device={dlg.device} kit={kits?.get(dlg.device.serial)} baseline={dlg.kind === 'RECORD'} onClose={() => setDlg(null)} onDone={done} />}
      {dlg && dlg.kind === 'RETURN' && <KitReturnDialog device={dlg.device} kit={kits?.get(dlg.device.serial)!} onClose={() => setDlg(null)} onDone={done} />}
      {dlg && dlg.kind === 'REPLACE' && <KitReplaceDialog device={dlg.device} kit={kits?.get(dlg.device.serial)!} onClose={() => setDlg(null)} onDone={done} />}
    </div>
  );
};

/** Record the kit of an existing merchant (no stock movement) or issue items from the branch reserve. */
const KitAddDialog: React.FC<{ device: Device; kit?: DeviceKit; baseline: boolean; onClose: () => void; onDone: (m: string) => void }> = ({ device, kit, baseline, onClose, onDone }) => {
  const group = deviceGroup(device.type);
  const mats = kitMaterials(group);
  const has = (c: MaterialCode) => !!kit?.items.some((i) => i.code === c);
  const [conn, setConn] = useState<'SIM' | 'WIFI'>(kit?.connection || 'SIM');
  const [pick, setPick] = useState<Record<string, { on: boolean; qty: string; serial: string; note: string }>>(() => {
    const o: Record<string, { on: boolean; qty: string; serial: string; note: string }> = {};
    mats.forEach((m) => {
      const def = baseline && (m.kitRule === 'DEFAULT' || m.code === 'SIM');
      o[m.code] = { on: def && !has(m.code), qty: '1', serial: m.code === 'BATTERY' && baseline ? device.batterySerial || '' : '', note: '' };
    });
    return o;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (c: string, patch: Partial<{ on: boolean; qty: string; serial: string; note: string }>) => setPick((p) => ({ ...p, [c]: { ...p[c], ...patch } }));
  const chosen = mats.filter((m) => pick[m.code].on && !(m.code === 'SIM' && conn === 'WIFI'));
  const invalid = chosen.find((m) => (m.tracking === 'SERIAL' ? !normMaterialSerial(m.code, pick[m.code].serial) : !(Number(pick[m.code].qty) > 0)));
  const save = async () => {
    setBusy(true); setErr('');
    try {
      await kitAdd({ device_serial: device.serial, connection: conn, from_stock: !baseline,
        items: chosen.map((m) => (m.tracking === 'SERIAL' ? { code: m.code, serial: pick[m.code].serial, note: pick[m.code].note || undefined } : { code: m.code, qty: Math.floor(Number(pick[m.code].qty)), note: pick[m.code].note || undefined })) });
      onDone(baseline ? `Kit recorded for ${device.serial}.` : `Issued from branch stock to ${device.serial}.`);
    } catch (e) { setErr(cleanMaterialError(e)); } finally { setBusy(false); }
  };
  return (
    <MaterialDialog open wide title={baseline ? 'Record kit' : 'Issue from branch stock'} busy={busy} onClose={onClose}
      sub={`${device.type} ${device.serial}${device.merchantName ? ` · ${device.merchantName}` : ''} · ${baseline ? 'what the merchant already holds (no stock movement)' : `taken from the reserve of branch ${device.branchId}`}`}
      footer={<><button type="button" className={btnLight} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={btnPrimary} onClick={save} disabled={busy || (!chosen.length && conn === kit?.connection) || !!invalid}><BusyLabel busy={busy}>{baseline ? 'Save kit' : 'Issue'}</BusyLabel></button></>}>
      <fieldset className="flex flex-wrap gap-2" aria-label="Connection">
        <legend className="text-xs font-semibold text-slate-600 mb-1.5 w-full">Connection</legend>
        {(['SIM', 'WIFI'] as const).map((c) => (
          <label key={c} className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm cursor-pointer ${conn === c ? 'border-[#003857] bg-sky-50' : 'border-slate-200'}`}>
            <input type="radio" name="kit-conn" checked={conn === c} onChange={() => setConn(c)} />{c === 'SIM' ? '4G SIM card' : "Merchant's own Wi-Fi"}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200">
        {mats.map((m) => {
          const p = pick[m.code]; const off = (m.code === 'SIM' && conn === 'WIFI') || (m.tracking === 'SERIAL' && has(m.code));
          return (
            <div key={m.code} className={`grid sm:grid-cols-[200px_1fr_1fr] gap-2 items-center px-3 py-2.5 ${off ? 'opacity-50' : ''}`}>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-800 cursor-pointer">
                <input type="checkbox" checked={p.on && !off} disabled={off} onChange={(e) => set(m.code, { on: e.target.checked })} />{m.name}
                <span className="text-[10.5px] font-medium text-slate-500">{m.kitRule === 'DEFAULT' ? 'default' : m.kitRule === 'CONNECTION' ? 'if 4G' : 'on request'}</span>
              </label>
              {m.tracking === 'SERIAL'
                ? <input className={`${inputCls} font-mono`} disabled={off || !p.on} value={p.serial} onChange={(e) => set(m.code, { serial: e.target.value })} placeholder={off && has(m.code) ? 'already in the kit' : m.code === 'SIM' ? 'SIM number, e.g. 096 555 0142' : 'Battery serial'} aria-label={`${m.name} number`} />
                : <input className={inputCls} type="number" min={1} disabled={off || !p.on} value={p.qty} onChange={(e) => set(m.code, { qty: e.target.value })} aria-label={`${m.name} quantity`} />}
              <input className={`${inputCls} text-xs`} disabled={off || !p.on} value={p.note} onChange={(e) => set(m.code, { note: e.target.value })} placeholder={m.kitRule === 'OPTIONAL' ? 'e.g. merchant requested' : 'Note (optional)'} maxLength={120} aria-label={`${m.name} note`} />
            </div>
          );
        })}
      </div>
      {invalid && <p className="text-xs text-amber-700">{invalid.tracking === 'SERIAL' ? `Enter a valid ${invalid.name} number.` : `Enter the ${invalid.name} quantity.`}</p>}
      {err && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-sm text-rose-800">{err}</div>}
    </MaterialDialog>
  );
};

/** Take items back: Returned (to the branch reserve), Lost (remark; to the Lost table) or Faulty (to Head Office). */
const KitReturnDialog: React.FC<{ device: Device; kit: DeviceKit; onClose: () => void; onDone: (m: string) => void }> = ({ device, kit, onClose, onDone }) => {
  const [res, setRes] = useState<Record<number, { result: '' | 'RETURNED' | 'LOST' | 'FAULTY'; qty: string; remark: string }>>(() =>
    Object.fromEntries(kit.items.map((it, i) => [i, { result: 'RETURNED', qty: String(it.qty || 1), remark: '' }])));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const chosen = kit.items.map((it, i) => ({ it, r: res[i] })).filter((x) => x.r.result);
  const lostNoRemark = chosen.some((x) => x.r.result === 'LOST' && x.r.remark.trim().length < 3);
  const save = async () => {
    setBusy(true); setErr('');
    try {
      await kitReturn({ device_serial: device.serial, items: chosen.map(({ it, r }) => ({ code: it.code, serial: it.serial || undefined, qty: it.serial ? 1 : Math.floor(Number(r.qty)) || 1, result: r.result as 'RETURNED' | 'LOST' | 'FAULTY', remark: r.remark.trim() || undefined })) });
      const lost = chosen.filter((x) => x.r.result === 'LOST').length;
      onDone(`Kit of ${device.serial} updated: ${chosen.length - lost} item(s) back${lost ? `, ${lost} reported lost` : ''}.`);
    } catch (e) { setErr(cleanMaterialError(e)); } finally { setBusy(false); }
  };
  return (
    <MaterialDialog open wide title="Take back from the merchant" sub={`${device.type} ${device.serial}${device.merchantName ? ` · ${device.merchantName}` : ''} · returned items go back to the reserve of branch ${device.branchId}`} busy={busy} onClose={onClose}
      footer={<><button type="button" className={btnLight} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={btnPrimary} onClick={save} disabled={busy || !chosen.length || lostNoRemark}><BusyLabel busy={busy}>Save</BusyLabel></button></>}>
      <div className="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200">
        {kit.items.map((it: KitItem, i) => {
          const r = res[i];
          return (
            <div key={i} className="grid sm:grid-cols-[1fr_170px_1fr] gap-2 items-center px-3 py-2.5">
              <span className="text-sm text-slate-800"><b>{materialName(it.code)}</b> {it.serial ? <span className="font-mono text-xs">{it.serial}</span> : `× ${it.qty}`}</span>
              <select className={inputCls} value={r.result} onChange={(e) => setRes((x) => ({ ...x, [i]: { ...r, result: e.target.value as typeof r.result } }))} aria-label={`${materialName(it.code)} result`}>
                <option value="RETURNED">Returned</option><option value="LOST">Lost</option><option value="FAULTY">Faulty (to HQ)</option><option value="">Keep at merchant</option>
              </select>
              <div className="flex gap-2">
                {!it.serial && r.result && <input className={`${inputCls} w-20`} type="number" min={1} max={it.qty} value={r.qty} onChange={(e) => setRes((x) => ({ ...x, [i]: { ...r, qty: e.target.value } }))} aria-label="Quantity" />}
                {r.result && <input className={`${inputCls} text-xs`} value={r.remark} onChange={(e) => setRes((x) => ({ ...x, [i]: { ...r, remark: e.target.value } }))} placeholder={r.result === 'LOST' ? 'What happened? (required)' : 'Remark (optional)'} maxLength={200} aria-label="Remark" />}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-slate-500">A returned SIM card goes back to branch reserve and can be given to another merchant. A lost SIM appears on the SIM Card page so Admin HQ can ask the carrier to block it.</p>
      {err && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-sm text-rose-800">{err}</div>}
    </MaterialDialog>
  );
};

/** Replace one item: the old one is Faulty / Lost / Returned, the new one comes from the branch reserve. */
const KitReplaceDialog: React.FC<{ device: Device; kit: DeviceKit; onClose: () => void; onDone: (m: string) => void }> = ({ device, kit, onClose, onDone }) => {
  const [idx, setIdx] = useState(0);
  const [old, setOld] = useState<'FAULTY' | 'LOST' | 'RETURNED'>('FAULTY');
  const [remark, setRemark] = useState('');
  const [serial, setSerial] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const it = kit.items[idx];
  const m = it ? materialByCode.get(it.code)! : null;
  const ready = !!m && (m.tracking === 'QTY' || !!normMaterialSerial(m.code, serial)) && (old !== 'LOST' || remark.trim().length >= 3);
  const save = async () => {
    if (!it || !m) return;
    setBusy(true); setErr('');
    try {
      await kitReplace({ device_serial: device.serial, code: it.code, old_serial: it.serial || undefined, old_result: old, remark: remark.trim() || undefined, new_serial: m.tracking === 'SERIAL' ? serial : undefined, qty: 1 });
      onDone(`${m.name} replaced for ${device.serial}.`);
    } catch (e) { setErr(cleanMaterialError(e)); } finally { setBusy(false); }
  };
  return (
    <MaterialDialog open title="Replace an item" sub={`${device.type} ${device.serial} · the new one comes from the reserve of branch ${device.branchId}`} busy={busy} onClose={onClose}
      footer={<><button type="button" className={btnLight} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={btnPrimary} onClick={save} disabled={!ready || busy}><BusyLabel busy={busy}>Replace</BusyLabel></button></>}>
      <label className={labelCls} htmlFor="rp-item">Item
        <select id="rp-item" className={inputCls} value={idx} onChange={(e) => { setIdx(Number(e.target.value)); setSerial(''); }}>
          {kit.items.map((x, i) => <option key={i} value={i}>{materialName(x.code)} {x.serial || `× ${x.qty}`}</option>)}
        </select>
      </label>
      <label className={labelCls} htmlFor="rp-old">The old one is
        <select id="rp-old" className={inputCls} value={old} onChange={(e) => setOld(e.target.value as typeof old)}>
          <option value="FAULTY">Faulty (sent to Head Office)</option><option value="LOST">Lost (not collected)</option><option value="RETURNED">Working (back to branch stock)</option>
        </select>
      </label>
      {m?.tracking === 'SERIAL' && <label className={labelCls}>New {m.name} number<input className={`${inputCls} font-mono`} value={serial} onChange={(e) => setSerial(e.target.value)} placeholder={m.code === 'SIM' ? '096 555 0142' : 'Battery serial'} /></label>}
      <label className={labelCls}>{old === 'LOST' ? 'What happened? (required)' : 'Reason (optional)'}<input className={inputCls} value={remark} onChange={(e) => setRemark(e.target.value)} maxLength={200} placeholder="e.g. broken plug" /></label>
      {err && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-sm text-rose-800">{err}</div>}
    </MaterialDialog>
  );
};

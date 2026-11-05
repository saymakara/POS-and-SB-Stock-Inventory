import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Search, RefreshCw, Loader2, PackagePlus, PencilLine, CreditCard, Download } from 'lucide-react';
import { Branch, UserRole } from '../types';
import { Pager } from './Pager';
import { usePager } from '../utils/usePager';
import { downloadCsv, collectAll, csvTime } from '../utils/exportCsv';
import { ClearFiltersButton } from './ClearFiltersButton';
import {
  LostItem, MaterialSerial, SERIAL_STATUS_LABEL, SerialStatus, cleanMaterialError, fetchLost, fetchSerialStatusCounts, fetchSerialsPage, isMaterialsMissing, placeName,
} from '../services/materialsService';
import { MaterialsSetupNotice, StatusPill, btnLight, btnPrimary, fmtDay } from './MaterialsUi';
import { AdjustDialog, LostTable, StockInDialog } from './MaterialStockPanel';

/**
 * (5 Nov 2026) Stock Inventory → SIM Card. Every SIM by its number, for POS Terminals and Sound Boxes: Head Office stock,
 * in transit, branch reserve, at a merchant (unit and MID), lost. Returned SIMs go back to branch reserve and are re-used;
 * a lost SIM is marked Blocked with carrier once Admin HQ has asked the carrier to block it.
 */
const STATUSES: SerialStatus[] = ['HQ_STOCK', 'IN_TRANSIT', 'BRANCH_RESERVE', 'AT_MERCHANT', 'LOST', 'WRITTEN_OFF'];

export const SimCardTab: React.FC<{ role: UserRole; branches: Branch[]; myBranch: string; triggerToast: (m: string) => void; onLostChanged?: () => void }> = ({
  role, branches, myBranch, triggerToast, onLostChanged,
}) => {
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const [status, setStatus] = useState<SerialStatus | ''>('');
  const [branchId, setBranchId] = useState(isAdmin ? '' : myBranch);
  const [query, setQuery] = useState('');
  const dq = useDeferredValue(query);
  const [search, setSearch] = useState('');
  useEffect(() => { const t = setTimeout(() => setSearch(dq.trim()), 350); return () => clearTimeout(t); }, [dq]);
  const [rows, setRows] = useState<MaterialSerial[] | null>(null);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<SerialStatus, number> | null>(null);
  const [lost, setLost] = useState<LostItem[] | null>(null);
  const [lostFilter, setLostFilter] = useState<'OPEN' | ''>('OPEN');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [dlg, setDlg] = useState<'' | 'IN' | 'ADJUST'>('');
  const pg = usePager(total, [status, branchId, search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, c] = await Promise.all([
        fetchSerialsPage({ code: 'SIM', status, branchId: branchId || undefined, search, page: pg.page, pageSize: pg.pageSize }),
        fetchSerialStatusCounts('SIM', branchId || undefined),
      ]);
      setRows(p.rows); setTotal(p.total); setCounts(c); setErr('');
    } catch (e) {
      const m = cleanMaterialError(e); setErr(isMaterialsMissing(m) ? 'SETUP' : m); setRows((r) => r || []);
    } finally { setLoading(false); }
  }, [status, branchId, search, pg.page, pg.pageSize]);
  const loadLost = useCallback(async () => {
    try { setLost(await fetchLost(['SIM'], lostFilter)); } catch { setLost((x) => x || []); }
  }, [lostFilter]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadLost(); }, [loadLost]);
  const changed = () => { load(); loadLost(); onLostChanged?.(); };

  const exportCsv = async () => {
    const all = await collectAll((page) => fetchSerialsPage({ code: 'SIM', status, branchId: branchId || undefined, search, page, pageSize: 1000 }), 1000);
    downloadCsv('sim-cards', ['SIM number', 'Status', 'Location', 'Unit', 'MID', 'Merchant', 'Request', 'Blocked with carrier', 'Updated', 'Updated by'],
      all.map((s) => [s.serial, SERIAL_STATUS_LABEL[s.status], placeName(s.branchId, branches), s.deviceSerial, s.mid, s.merchantName, s.reqId, s.blocked ? 'Yes' : '', csvTime(s.updatedAt), s.updatedBy]));
    triggerToast(`Saved ${all.length} SIM card(s).`);
  };
  const totalAll = useMemo(() => (counts ? Object.values(counts).reduce((a, b) => a + b, 0) : undefined), [counts]);

  if (err === 'SETUP') return <MaterialsSetupNotice />;
  return (
    <div className="flex flex-col gap-3.5">
      <section className="relative overflow-hidden rounded-3xl p-6 sm:p-7 border shadow-sm bg-slate-100 border-slate-200/90" aria-label="SIM cards">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-1.5 max-w-3xl">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight flex items-center gap-3 text-slate-900">
              <CreditCard className="w-7 h-7 text-[#003857]" aria-hidden /><span>SIM Card</span>
            </h1>
            <p className="text-sm sm:text-base text-slate-600">Every SIM by its number, for POS Terminals and Sound Boxes: where it is, and which merchant and unit it serves.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isAdmin && <button type="button" className={btnPrimary} onClick={() => setDlg('IN')}><PackagePlus className="w-4 h-4" />Add SIMs</button>}
            {isAdmin && <button type="button" className={btnLight} onClick={() => setDlg('ADJUST')}><PencilLine className="w-4 h-4" />Correct</button>}
            <button type="button" className={btnLight} onClick={() => exportCsv().catch((e) => triggerToast(`Not saved: ${cleanMaterialError(e)}`))}><Download className="w-4 h-4" />Export CSV</button>
            <button type="button" className={btnLight} onClick={changed} aria-label="Refresh">{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}Refresh</button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-5 pt-5 border-t border-slate-200/90" role="group" aria-label="Status">
          <button type="button" onClick={() => setStatus('')} aria-pressed={status === ''}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border cursor-pointer ${status === '' ? 'bg-[#003857] text-white border-[#003857]' : 'bg-white text-slate-600 border-slate-200'}`}>
            All <span className="tabular-nums opacity-80 ml-1">{totalAll?.toLocaleString() ?? '—'}</span>
          </button>
          {STATUSES.map((s) => (
            <button key={s} type="button" onClick={() => setStatus(s)} aria-pressed={status === s}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border cursor-pointer ${status === s ? 'bg-[#003857] text-white border-[#003857]' : 'bg-white text-slate-600 border-slate-200'}`}>
              {SERIAL_STATUS_LABEL[s]} <span className="tabular-nums opacity-80 ml-1">{counts ? counts[s].toLocaleString() : '—'}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-2.5 bg-white rounded-2xl border border-slate-200 shadow-2xs px-3.5 py-3" aria-label="Filters">
        <label className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search SIM number, MID, unit serial or merchant" aria-label="Search"
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-slate-400" />
        </label>
        {isAdmin && (
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="Location" className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 cursor-pointer max-w-[260px]">
            <option value="">All locations</option><option value="100">Head Office</option>
            {branches.filter((b) => b.id !== '100').map((b) => <option key={b.id} value={b.id}>{b.id} · {b.name}</option>)}
          </select>
        )}
        <ClearFiltersButton active={!!status || !!query || (isAdmin && !!branchId)} onClear={() => { setStatus(''); setQuery(''); if (isAdmin) setBranchId(''); }} />
      </section>

      {err && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">Could not load the SIM cards: {err}</div>}

      <section className="fr-table-frame bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-x-auto" aria-label="SIM cards">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="bg-[#003857] text-white text-[11px] uppercase tracking-wider">
              <th className="text-left font-medium px-3.5 py-2.5 w-12">No.</th><th className="text-left font-medium px-3.5 py-2.5">SIM number</th>
              <th className="text-left font-medium px-3.5 py-2.5">Status</th><th className="text-left font-medium px-3.5 py-2.5">Location / merchant</th>
              <th className="text-left font-medium px-3.5 py-2.5">Unit</th><th className="text-left font-medium px-3.5 py-2.5">Since</th>
            </tr>
          </thead>
          <tbody data-page-content className={`divide-y divide-slate-100 transition-opacity ${loading && rows ? 'opacity-60' : ''}`}>
            {rows === null && [0, 1, 2].map((i) => <tr key={i}><td colSpan={6} className="px-3.5 py-3"><div className="skeleton h-4 rounded w-2/3" /></td></tr>)}
            {rows && rows.length === 0 && <tr><td colSpan={6} className="px-3.5 py-10 text-center text-slate-500">{totalAll === 0 ? 'No SIM card registered yet. Add SIMs, or load the opening stock from POS Terminal → Material.' : 'No SIM card matches the filters.'}</td></tr>}
            {(rows || []).map((s, i) => (
              <tr key={s.serial} className="hover:bg-slate-50/70">
                <td className="px-3.5 py-2.5 text-right tabular-nums text-slate-500">{pg.start + i + 1}</td>
                <td className="px-3.5 py-2.5 font-mono font-semibold text-slate-900 whitespace-nowrap">{s.serial}</td>
                <td className="px-3.5 py-2.5"><div className="flex flex-wrap gap-1"><StatusPill status={s.status} />{s.blocked && <span className="text-[11px] font-semibold text-sky-800">Blocked</span>}</div></td>
                <td className="px-3.5 py-2.5">{s.status === 'AT_MERCHANT' || s.status === 'LOST' ? (s.merchantName || '—') : placeName(s.branchId, branches)}
                  <span className="block text-xs text-slate-500">{s.status === 'AT_MERCHANT' || s.status === 'LOST' ? [s.mid && `MID ${s.mid}`, placeName(s.branchId, branches)].filter(Boolean).join(' · ') : s.status === 'IN_TRANSIT' ? `Request ${s.reqId}` : ''}</span>
                </td>
                <td className="px-3.5 py-2.5 font-mono text-xs">{s.deviceSerial || '—'}</td>
                <td className="px-3.5 py-2.5 tabular-nums whitespace-nowrap">{fmtDay(s.updatedAt)}<span className="block text-[11px] text-slate-500">{s.updatedBy || ''}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pager pg={pg} label="SIM cards" />
      </section>

      <LostTable title="Lost · SIM Card" rows={lost} branches={branches} isAdmin={isAdmin} filter={lostFilter} onFilter={setLostFilter} onChanged={changed} triggerToast={triggerToast} />
      <p className="text-xs text-slate-500 px-1">SIM numbers are saved in one form: 096 555 0142, 0965550142 and +855 96 555 0142 are the same SIM. A SIM already at a merchant cannot be given to another one.</p>

      <StockInDialog open={dlg === 'IN'} codes={['SIM']} branches={branches} onClose={() => setDlg('')} onDone={changed} triggerToast={triggerToast} />
      <AdjustDialog open={dlg === 'ADJUST'} codes={['SIM']} branches={branches} onClose={() => setDlg('')} onDone={changed} triggerToast={triggerToast} />
    </div>
  );
};

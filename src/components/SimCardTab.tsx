import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  Search, RefreshCw, Loader2, PackagePlus, PencilLine, CreditCard, Download,
  Cpu, Volume2
} from 'lucide-react';
import { Branch, UserRole, Device } from '../types';
import { Pager } from './Pager';
import { usePager } from '../utils/usePager';
import { downloadCsv, collectAll, csvTime } from '../utils/exportCsv';
import { ClearFiltersButton } from './ClearFiltersButton';
import {
  LostItem, MaterialSerial, SERIAL_STATUS_LABEL, SerialStatus, cleanMaterialError,
  fetchLost, fetchSerialStatusCounts, fetchSerialsPage, isMaterialsMissing, placeName,
} from '../services/materialsService';
import { MaterialsSetupNotice, StatusPill, btnLight, btnPrimary, fmtDay } from './MaterialsUi';
import { AdjustDialog, LostTable, StockInDialog } from './MaterialStockPanel';

/**
 * (5 Nov 2026) Stock Inventory → SIM Card.
 * Clean, single unified enterprise table showing SIM cards with their associated POS Terminal,
 * Sound Box, Merchant Name & MID, Deployment Date, Branch Staff, and Branch Name.
 */
const STATUSES: SerialStatus[] = ['HQ_STOCK', 'IN_TRANSIT', 'BRANCH_RESERVE', 'AT_MERCHANT', 'LOST', 'WRITTEN_OFF'];

export const SimCardTab: React.FC<{
  role: UserRole;
  branches: Branch[];
  myBranch: string;
  devices?: Device[];
  triggerToast: (m: string) => void;
  onLostChanged?: () => void;
}> = ({
  role, branches, myBranch, devices = [], triggerToast, onLostChanged,
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

  const deviceMap = useMemo(() => {
    const map = new Map<string, Device>();
    (devices || []).forEach((d) => {
      if (d.serial) map.set(d.serial.toUpperCase(), d);
    });
    return map;
  }, [devices]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = await fetchSerialsPage({ code: 'SIM', status, branchId: branchId || undefined, search, page: pg.page, pageSize: pg.pageSize });
      setRows(p.rows); setTotal(p.total); setErr('');
    } catch (e) {
      const m = cleanMaterialError(e); setErr(isMaterialsMissing(m) ? 'SETUP' : m); setRows((r) => r || []);
    } finally { setLoading(false); }
  }, [status, branchId, search, pg.page, pg.pageSize]);

  const loadLost = useCallback(async () => {
    try { setLost(await fetchLost(['SIM'], lostFilter)); } catch { setLost((x) => x || []); }
  }, [lostFilter]);

  const [countsKey, setCountsKey] = useState(0);
  useEffect(() => {
    let alive = true;
    fetchSerialStatusCounts('SIM', branchId || undefined).then((c) => { if (alive) setCounts(c); }).catch(() => {});
    return () => { alive = false; };
  }, [branchId, countsKey]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadLost(); }, [loadLost]);
  const changed = () => { load(); loadLost(); setCountsKey((k) => k + 1); onLostChanged?.(); };

  const exportCsv = async () => {
    const all = await collectAll((page) => fetchSerialsPage({ code: 'SIM', status, branchId: branchId || undefined, search, page, pageSize: 1000 }), 1000);
    downloadCsv('sim-cards', [
      'SIM number', 'Status', 'POS Terminal (Serial)', 'Sound Box (Serial)', 'Merchant Name', 'MID', 'Deployment Date', 'Branch Staff', 'Branch Name', 'Updated At', 'Updated By'
    ], all.map((s) => {
      const dev = s.deviceSerial ? deviceMap.get(s.deviceSerial.toUpperCase()) : undefined;
      let isSoundBox = false;
      let isPos = false;
      if (s.deviceSerial) {
        if (dev?.type === 'Sound Box' || /^(SB|000|Q161)/i.test(s.deviceSerial)) isSoundBox = true;
        else isPos = true;
      }
      const posSerial = (isPos && s.deviceSerial) ? s.deviceSerial : '';
      const soundBoxSerial = (isSoundBox && s.deviceSerial) ? s.deviceSerial : '';
      const merchantName = s.merchantName || dev?.merchantName || '';
      const mid = s.mid || dev?.mid || '';
      const deployedDate = dev?.deployedDate || (s.status === 'AT_MERCHANT' && s.updatedAt ? fmtDay(s.updatedAt) : '');
      const branchStaff = dev?.staff || dev?.installedByStaff || (s.status === 'AT_MERCHANT' ? s.updatedBy : '') || '';
      const branchName = dev?.branchName || placeName(s.branchId, branches);

      return [s.serial, SERIAL_STATUS_LABEL[s.status], posSerial, soundBoxSerial, merchantName, mid, deployedDate, branchStaff, branchName, csvTime(s.updatedAt), s.updatedBy];
    }));
    triggerToast(`Saved ${all.length} SIM card(s).`);
  };

  const totalAll = useMemo(() => (counts ? Object.values(counts).reduce((a, b) => a + b, 0) : undefined), [counts]);

  if (err === 'SETUP') return <MaterialsSetupNotice />;

  return (
    <div className="flex flex-col gap-3.5">
      {/* Top Banner Header */}
      <section className="relative overflow-hidden rounded-3xl p-6 sm:p-7 border shadow-sm bg-slate-100 border-slate-200/90" aria-label="SIM cards">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-1.5 max-w-3xl">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight flex items-center gap-3 text-slate-900">
              <CreditCard className="w-7 h-7 text-[#003857]" aria-hidden />
              <span>SIM Card Control Hub</span>
            </h1>
            <p className="text-sm sm:text-base text-slate-600">
              Cellular connectivity for POS Terminals and Sound Boxes: Head Office stock, in transit, branch reserve, and active merchant deployments.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isAdmin && (
              <button
                type="button"
                className={btnPrimary}
                onClick={() => setDlg('IN')}
              >
                <PackagePlus className="w-4 h-4" />
                Add SIMs
              </button>
            )}
            {isAdmin && (
              <button type="button" className={btnLight} onClick={() => setDlg('ADJUST')}>
                <PencilLine className="w-4 h-4" />
                Correct
              </button>
            )}
            <button
              type="button"
              className={btnLight}
              onClick={() => exportCsv().catch((e) => triggerToast(`Not saved: ${cleanMaterialError(e)}`))}
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
            <button type="button" className={btnLight} onClick={changed} aria-label="Refresh">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
          </div>
        </div>

        {/* Status Pills */}
        <div className="flex flex-wrap gap-2 mt-5 pt-5 border-t border-slate-200/90" role="group" aria-label="Status">
          <button
            type="button"
            onClick={() => setStatus('')}
            aria-pressed={status === ''}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border cursor-pointer ${
              status === '' ? 'bg-[#003857] text-white border-[#003857]' : 'bg-white text-slate-600 border-slate-200'
            }`}
          >
            All <span className="tabular-nums opacity-80 ml-1">{totalAll?.toLocaleString() ?? '—'}</span>
          </button>
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              aria-pressed={status === s}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border cursor-pointer ${
                status === s ? 'bg-[#003857] text-white border-[#003857]' : 'bg-white text-slate-600 border-slate-200'
              }`}
            >
              {SERIAL_STATUS_LABEL[s]}{' '}
              <span className="tabular-nums opacity-80 ml-1">
                {counts ? counts[s].toLocaleString() : '—'}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Filters Search Row */}
      <section className="flex flex-wrap items-center gap-2.5 bg-white rounded-2xl border border-slate-200 shadow-2xs px-3.5 py-3" aria-label="Filters">
        <label className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search SIM number, MID, unit serial or merchant"
            aria-label="Search"
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-slate-400"
          />
        </label>
        {isAdmin && (
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            aria-label="Location"
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 cursor-pointer max-w-[260px]"
          >
            <option value="">All locations</option>
            <option value="100">Head Office</option>
            {branches.filter((b) => b.id !== '100').map((b) => (
              <option key={b.id} value={b.id}>{b.id} · {b.name}</option>
            ))}
          </select>
        )}
        <ClearFiltersButton
          active={!!status || !!query || (isAdmin && !!branchId)}
          onClear={() => {
            setStatus('');
            setQuery('');
            if (isAdmin) setBranchId('');
          }}
        />
      </section>

      {err && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          Could not load the SIM cards: {err}
        </div>
      )}

      {/* Single Unified SIM Cards Table */}
      <section
        className="fr-table-frame bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden flex flex-col"
        aria-label="SIM Cards Table"
      >
        <div className="navy-header-bar px-4 sm:px-5 py-3 flex items-center justify-between text-white border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1 rounded-lg bg-white/10 text-white">
              <CreditCard className="w-4 h-4 text-[#5cc8ff]" />
            </div>
            <h2 className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
              <span>SIM Cards Inventory</span>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-white/15 text-white">
                {(totalAll ?? total ?? rows?.length ?? 0).toLocaleString()} cards
              </span>
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button
                type="button"
                onClick={() => setDlg('IN')}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white/15 hover:bg-white/25 text-white transition flex items-center gap-1.5 cursor-pointer"
              >
                <PackagePlus className="w-3.5 h-3.5" />
                <span>Add SIMs</span>
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] uppercase tracking-wider border-b border-slate-200">
                <th className="text-center font-semibold px-2.5 py-2.5 w-10">No.</th>
                <th className="text-left font-semibold px-2 py-2.5">SIM Number</th>
                <th className="text-left font-semibold px-2.5 py-2.5">Status</th>
                <th className="text-left font-semibold px-2 py-2.5">POS Terminal (Serial)</th>
                <th className="text-left font-semibold px-2 py-2.5">Sound Box (Serial)</th>
                <th className="text-left font-semibold px-2 py-2.5">Merchant Name / MID</th>
                <th className="text-left font-semibold px-2.5 py-2.5">Date of Deployment</th>
                <th className="text-left font-semibold px-2 py-2.5">Branch Staff</th>
                <th className="text-left font-semibold px-2 py-2.5">Branch Name</th>
              </tr>
            </thead>
            <tbody data-page-content className={`divide-y divide-slate-100 transition-opacity ${loading && rows ? 'opacity-60' : ''}`}>
              {rows === null && [0, 1, 2, 3].map((i) => (
                <tr key={i}>
                  <td colSpan={9} className="px-3.5 py-3.5">
                    <div className="skeleton h-4 rounded w-3/4" />
                  </td>
                </tr>
              ))}
              {rows && rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3.5 py-10 text-center text-slate-500">
                    {totalAll === 0 ? 'No SIM card registered yet. Add SIMs or load opening stock.' : 'No SIM card matches the current filters.'}
                  </td>
                </tr>
              )}
              {(rows || []).map((s, i) => {
                const dev = s.deviceSerial ? deviceMap.get(s.deviceSerial.toUpperCase()) : undefined;
                let isSoundBox = false;
                let isPos = false;

                if (s.deviceSerial) {
                  if (dev?.type === 'Sound Box' || /^(SB|000|Q161)/i.test(s.deviceSerial)) {
                    isSoundBox = true;
                  } else {
                    isPos = true;
                  }
                } else {
                  const noteLower = (s.note || '').toLowerCase();
                  if (noteLower.includes('[sound box]') || noteLower.includes('sound box') || noteLower.includes('[sb]')) {
                    isSoundBox = true;
                  } else if (noteLower.includes('[pos]') || noteLower.includes('pos terminal') || noteLower.includes('[pos terminal]')) {
                    isPos = true;
                  }
                }

                const posSerial = (isPos && s.deviceSerial) ? s.deviceSerial : '';
                const soundBoxSerial = (isSoundBox && s.deviceSerial) ? s.deviceSerial : '';
                const merchantName = s.merchantName || dev?.merchantName || '';
                const mid = s.mid || dev?.mid || '';
                const hasMerchant = Boolean(merchantName || mid);

                const deployedDate = dev?.deployedDate || (s.status === 'AT_MERCHANT' && s.updatedAt ? fmtDay(s.updatedAt) : '');
                const branchStaff = dev?.staff || dev?.installedByStaff || (s.status === 'AT_MERCHANT' ? s.updatedBy : '') || '';
                const branchName = dev?.branchName || (s.branchId && s.branchId !== '100' ? placeName(s.branchId, branches) : (s.branchId === '100' ? 'Head Office' : ''));

                return (
                  <tr key={s.serial} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-2.5 py-2.5 text-center tabular-nums text-slate-500 font-mono">
                      {pg.start + i + 1}
                    </td>
                    <td className="px-2 py-2.5 font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {s.serial}
                    </td>
                    <td className="px-2.5 py-2.5 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <StatusPill status={s.status} />
                        {s.blocked && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">
                            Blocked
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2.5 font-mono whitespace-nowrap">
                      {posSerial ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-sky-50 text-sky-800 border border-sky-200/90">
                          <Cpu className="w-3 h-3 text-sky-600 shrink-0" aria-hidden />
                          <span>{posSerial}</span>
                        </span>
                      ) : (
                        <span className="text-slate-300 select-none">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 font-mono whitespace-nowrap">
                      {soundBoxSerial ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-purple-50 text-purple-800 border border-purple-200/90">
                          <Volume2 className="w-3 h-3 text-purple-600 shrink-0" aria-hidden />
                          <span>{soundBoxSerial}</span>
                        </span>
                      ) : (
                        <span className="text-slate-300 select-none">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      {hasMerchant ? (
                        <div className="min-w-0 max-w-[200px]">
                          <span className="block font-medium text-slate-900 truncate" title={merchantName}>
                            {merchantName || '—'}
                          </span>
                          {mid && (
                            <span className="block text-[11px] font-mono text-slate-500 truncate">
                              MID: {mid}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-300 select-none">—</span>
                      )}
                    </td>
                    <td className="px-2.5 py-2.5 tabular-nums whitespace-nowrap">
                      {deployedDate ? (
                        <span className="text-slate-700 font-medium">{deployedDate}</span>
                      ) : (
                        <span className="text-slate-300 select-none">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      {branchStaff ? (
                        <span className="text-slate-800 font-medium truncate block max-w-[170px]" title={branchStaff}>
                          {branchStaff}
                        </span>
                      ) : (
                        <span className="text-slate-300 select-none">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      {branchName ? (
                        <span className="text-slate-700 truncate block max-w-[170px]" title={branchName}>
                          {branchName}
                        </span>
                      ) : (
                        <span className="text-slate-300 select-none">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pager pg={pg} label="SIM cards" />
      </section>

      {/* Lost Table */}
      <LostTable
        title="Lost · SIM Card"
        rows={lost}
        branches={branches}
        isAdmin={isAdmin}
        filter={lostFilter}
        onFilter={setLostFilter}
        onChanged={changed}
        triggerToast={triggerToast}
      />

      <p className="text-xs text-slate-500 px-1">
        SIM numbers are saved in one form: 096 555 0142, 0965550142 and +855 96 555 0142 are the same SIM. A SIM already at a merchant cannot be given to another one.
      </p>

      {/* Stock In Dialog */}
      <StockInDialog
        open={dlg === 'IN'}
        codes={['SIM']}
        branches={branches}
        onClose={() => setDlg('')}
        onDone={changed}
        triggerToast={triggerToast}
      />

      {/* Adjust Dialog */}
      <AdjustDialog
        open={dlg === 'ADJUST'}
        codes={['SIM']}
        branches={branches}
        onClose={() => setDlg('')}
        onDone={changed}
        triggerToast={triggerToast}
      />
    </div>
  );
};

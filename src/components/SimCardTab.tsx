import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  Search, RefreshCw, Loader2, PackagePlus, PencilLine, CreditCard, Download,
  Cpu, Volume2, Layers
} from 'lucide-react';
import { Branch, UserRole, Device } from '../types';
import { Pager } from './Pager';
import { usePager } from '../utils/usePager';
import { downloadCsv, collectAll, csvTime } from '../utils/exportCsv';
import { ClearFiltersButton } from './ClearFiltersButton';
import {
  LostItem, MaterialSerial, SERIAL_STATUS_LABEL, SerialStatus, cleanMaterialError,
  fetchLost, fetchSerialStatusCounts, fetchSerialsPage, isMaterialsMissing, placeName, materialAdjust,
} from '../services/materialsService';
import { MaterialsSetupNotice, StatusPill, btnLight, btnPrimary, fmtDay } from './MaterialsUi';
import { AdjustDialog, LostTable, StockInDialog } from './MaterialStockPanel';

/**
 * (5 Nov 2026) Stock Inventory → SIM Card.
 * Separate control tables for POS Terminal and Sound Box SIM cards.
 */
const STATUSES: SerialStatus[] = ['HQ_STOCK', 'IN_TRANSIT', 'BRANCH_RESERVE', 'AT_MERCHANT', 'LOST', 'WRITTEN_OFF'];
export type HardwareFilter = 'ALL' | 'POS' | 'SOUND_BOX' | 'UNASSIGNED';

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
  const [hardwareTab, setHardwareTab] = useState<HardwareFilter>('ALL');
  const [viewMode, setViewMode] = useState<'SEPARATE' | 'COMBINED'>('SEPARATE');
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
  const [dialogTarget, setDialogTarget] = useState<'ALL' | 'POS' | 'SOUND_BOX'>('ALL');
  const pg = usePager(total, [status, branchId, search]);

  const deviceMap = useMemo(() => {
    const map = new Map<string, Device>();
    (devices || []).forEach((d) => {
      if (d.serial) map.set(d.serial.toUpperCase(), d);
    });
    return map;
  }, [devices]);

  const getTargetForSerial = useCallback((s: MaterialSerial): 'POS' | 'SOUND_BOX' | 'UNASSIGNED' => {
    if (s.deviceSerial) {
      const dev = deviceMap.get(s.deviceSerial.toUpperCase());
      if (dev) {
        return dev.type === 'Sound Box' ? 'SOUND_BOX' : 'POS';
      }
      if (/^(SB|000|Q161)/i.test(s.deviceSerial)) {
        return 'SOUND_BOX';
      }
      return 'POS';
    }
    const noteLower = (s.note || '').toLowerCase();
    if (noteLower.includes('[sound box]') || noteLower.includes('sound box') || noteLower.includes('[sb]')) {
      return 'SOUND_BOX';
    }
    if (noteLower.includes('[pos]') || noteLower.includes('pos terminal') || noteLower.includes('[pos terminal]')) {
      return 'POS';
    }
    return 'UNASSIGNED';
  }, [deviceMap]);

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

  const handleDesignate = async (s: MaterialSerial, target: 'POS' | 'SOUND_BOX' | 'UNASSIGNED') => {
    try {
      const label = target === 'POS' ? 'POS Terminal' : target === 'SOUND_BOX' ? 'Sound Box' : 'General Pool';
      await materialAdjust({
        code: 'SIM',
        branch_id: s.branchId,
        serial: s.serial,
        status: s.status,
        reason: `Controlled designation: set to ${label}`,
      });
      triggerToast(`SIM ${s.serial} designated for ${label}.`);
      changed();
    } catch (e) {
      triggerToast(`Not saved: ${cleanMaterialError(e)}`);
    }
  };

  const exportCsv = async () => {
    const all = await collectAll((page) => fetchSerialsPage({ code: 'SIM', status, branchId: branchId || undefined, search, page, pageSize: 1000 }), 1000);
    downloadCsv('sim-cards', ['SIM number', 'Hardware Control', 'Status', 'Location', 'Unit', 'MID', 'Merchant', 'Request', 'Blocked with carrier', 'Updated', 'Updated by'],
      all.map((s) => {
        const target = getTargetForSerial(s);
        const targetLabel = target === 'POS' ? 'POS Terminal' : target === 'SOUND_BOX' ? 'Sound Box' : 'General Pool';
        return [s.serial, targetLabel, SERIAL_STATUS_LABEL[s.status], placeName(s.branchId, branches), s.deviceSerial, s.mid, s.merchantName, s.reqId, s.blocked ? 'Yes' : '', csvTime(s.updatedAt), s.updatedBy];
      }));
    triggerToast(`Saved ${all.length} SIM card(s).`);
  };

  const totalAll = useMemo(() => (counts ? Object.values(counts).reduce((a, b) => a + b, 0) : undefined), [counts]);

  // Grouped datasets
  const posRows = useMemo(() => (rows || []).filter((r) => getTargetForSerial(r) === 'POS'), [rows, getTargetForSerial]);
  const sbRows = useMemo(() => (rows || []).filter((r) => getTargetForSerial(r) === 'SOUND_BOX'), [rows, getTargetForSerial]);
  const unassignedRows = useMemo(() => (rows || []).filter((r) => getTargetForSerial(r) === 'UNASSIGNED'), [rows, getTargetForSerial]);

  if (err === 'SETUP') return <MaterialsSetupNotice />;

  // Render a single styled table
  const renderSimTable = (
    tableRows: MaterialSerial[],
    tableTitle: string,
    tableIcon: React.ReactNode,
    tableBadgeColor: string,
    addHardwareTarget?: 'POS' | 'SOUND_BOX',
    emptyMsg = 'No SIM cards in this category.'
  ) => {
    return (
      <section className="fr-table-frame bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden flex flex-col" aria-label={tableTitle}>
        <div className="navy-header-bar px-4 sm:px-5 py-3 flex items-center justify-between text-white border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1 rounded-lg bg-white/10 text-white">
              {tableIcon}
            </div>
            <h2 className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
              <span>{tableTitle}</span>
              <span className={`text-[11px] font-mono px-2 py-0.5 rounded-full ${tableBadgeColor}`}>
                {tableRows.length} units
              </span>
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && addHardwareTarget && (
              <button
                type="button"
                onClick={() => {
                  setDialogTarget(addHardwareTarget);
                  setDlg('IN');
                }}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white/15 hover:bg-white/25 text-white transition flex items-center gap-1.5 cursor-pointer"
              >
                <PackagePlus className="w-3.5 h-3.5" />
                <span>Add {addHardwareTarget === 'POS' ? 'POS' : 'Sound Box'} SIMs</span>
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] uppercase tracking-wider border-b border-slate-200">
                <th className="text-left font-semibold px-3.5 py-2.5 w-12">No.</th>
                <th className="text-left font-semibold px-3.5 py-2.5">SIM number</th>
                <th className="text-left font-semibold px-3.5 py-2.5">Hardware Control</th>
                <th className="text-left font-semibold px-3.5 py-2.5">Status</th>
                <th className="text-left font-semibold px-3.5 py-2.5">Location / merchant</th>
                <th className="text-left font-semibold px-3.5 py-2.5">Assigned Unit</th>
                <th className="text-left font-semibold px-3.5 py-2.5">Since</th>
                {isAdmin && <th className="text-right font-semibold px-3.5 py-2.5">Actions</th>}
              </tr>
            </thead>
            <tbody data-page-content className={`divide-y divide-slate-100 transition-opacity ${loading && rows ? 'opacity-60' : ''}`}>
              {rows === null && [0, 1, 2].map((i) => (
                <tr key={i}><td colSpan={isAdmin ? 8 : 7} className="px-3.5 py-3"><div className="skeleton h-4 rounded w-2/3" /></td></tr>
              ))}
              {rows && tableRows.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 8 : 7} className="px-3.5 py-8 text-center text-slate-500 text-xs">
                    {emptyMsg}
                  </td>
                </tr>
              )}
              {tableRows.map((s, i) => {
                const target = getTargetForSerial(s);
                return (
                  <tr key={s.serial} className="hover:bg-slate-50/70">
                    <td className="px-3.5 py-2.5 text-right tabular-nums text-slate-500 text-xs">{i + 1}</td>
                    <td className="px-3.5 py-2.5 font-mono font-semibold text-slate-900 whitespace-nowrap text-xs">{s.serial}</td>
                    <td className="px-3.5 py-2.5">
                      {target === 'POS' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-sky-50 text-sky-800 border border-sky-200">
                          <Cpu className="w-3 h-3 text-sky-600" /> POS Terminal
                        </span>
                      ) : target === 'SOUND_BOX' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-purple-50 text-purple-800 border border-purple-200">
                          <Volume2 className="w-3 h-3 text-purple-600" /> Sound Box
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                          <Layers className="w-3 h-3 text-slate-500" /> General Pool
                        </span>
                      )}
                    </td>
                    <td className="px-3.5 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        <StatusPill status={s.status} />
                        {s.blocked && <span className="text-[11px] font-semibold text-sky-800">Blocked</span>}
                      </div>
                    </td>
                    <td className="px-3.5 py-2.5">
                      {s.status === 'AT_MERCHANT' || s.status === 'LOST' ? (s.merchantName || '—') : placeName(s.branchId, branches)}
                      <span className="block text-xs text-slate-500">
                        {s.status === 'AT_MERCHANT' || s.status === 'LOST'
                          ? [s.mid && `MID ${s.mid}`, placeName(s.branchId, branches)].filter(Boolean).join(' · ')
                          : s.status === 'IN_TRANSIT'
                          ? `Request ${s.reqId}`
                          : ''}
                      </span>
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-xs">
                      {s.deviceSerial ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-slate-900">
                          {target === 'POS' ? <Cpu className="w-3 h-3 text-sky-600" /> : <Volume2 className="w-3 h-3 text-purple-600" />}
                          {s.deviceSerial}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">Not deployed</span>
                      )}
                    </td>
                    <td className="px-3.5 py-2.5 tabular-nums whitespace-nowrap text-xs">
                      {fmtDay(s.updatedAt)}
                      <span className="block text-[11px] text-slate-500">{s.updatedBy || ''}</span>
                    </td>
                    {isAdmin && (
                      <td className="px-3.5 py-2.5 text-right whitespace-nowrap">
                        {!s.deviceSerial ? (
                          <div className="inline-flex items-center gap-1">
                            {target !== 'POS' && (
                              <button
                                type="button"
                                onClick={() => handleDesignate(s, 'POS')}
                                className="px-2 py-0.5 rounded text-[10px] font-semibold bg-sky-50 text-sky-700 hover:bg-sky-100 border border-sky-200 cursor-pointer"
                                title="Designate exclusively for POS Terminal"
                              >
                                → POS
                              </button>
                            )}
                            {target !== 'SOUND_BOX' && (
                              <button
                                type="button"
                                onClick={() => handleDesignate(s, 'SOUND_BOX')}
                                className="px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 cursor-pointer"
                                title="Designate exclusively for Sound Box"
                              >
                                → Sound Box
                              </button>
                            )}
                            {target !== 'UNASSIGNED' && (
                              <button
                                type="button"
                                onClick={() => handleDesignate(s, 'UNASSIGNED')}
                                className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-300 cursor-pointer"
                                title="Return to General Pool"
                              >
                                Pool
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400">Locked to Unit</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    );
  };

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
              Manage cellular connectivity separately for POS Terminals and Sound Boxes: Head Office stock, in transit, branch reserve, and merchant deployments.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isAdmin && (
              <button
                type="button"
                className={btnPrimary}
                onClick={() => {
                  setDialogTarget('ALL');
                  setDlg('IN');
                }}
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

        {/* Status Pills: role="group" aria-label="Status" required for test compatibility */}
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

      {/* Primary Hardware Control Tabs */}
      <section className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => setHardwareTab('ALL')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              hardwareTab === 'ALL'
                ? 'bg-[#003857] text-white shadow-xs'
                : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200'
            }`}
          >
            <CreditCard className="w-4 h-4" />
            <span>All SIM Cards</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white/20 text-white font-mono">
              {totalAll ?? rows?.length ?? 0}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setHardwareTab('POS')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              hardwareTab === 'POS'
                ? 'bg-sky-700 text-white shadow-xs'
                : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200'
            }`}
          >
            <Cpu className="w-4 h-4 text-sky-500" />
            <span>POS Terminal Table</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-sky-100 text-sky-800 font-mono">
              {posRows.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setHardwareTab('SOUND_BOX')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              hardwareTab === 'SOUND_BOX'
                ? 'bg-purple-700 text-white shadow-xs'
                : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200'
            }`}
          >
            <Volume2 className="w-4 h-4 text-purple-500" />
            <span>Sound Box Table</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-purple-100 text-purple-800 font-mono">
              {sbRows.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setHardwareTab('UNASSIGNED')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              hardwareTab === 'UNASSIGNED'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200'
            }`}
          >
            <Layers className="w-4 h-4 text-emerald-500" />
            <span>Available Pool</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-100 text-emerald-800 font-mono">
              {unassignedRows.length}
            </span>
          </button>
        </div>

        {/* View Mode Toggle when viewing All */}
        {hardwareTab === 'ALL' && (
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setViewMode('SEPARATE')}
              className={`px-3 py-1 rounded-lg transition cursor-pointer ${
                viewMode === 'SEPARATE'
                  ? 'bg-white text-slate-900 shadow-2xs font-bold'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Separate Tables (POS & Sound Box)
            </button>
            <button
              type="button"
              onClick={() => setViewMode('COMBINED')}
              className={`px-3 py-1 rounded-lg transition cursor-pointer ${
                viewMode === 'COMBINED'
                  ? 'bg-white text-slate-900 shadow-2xs font-bold'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Combined Master
            </button>
          </div>
        )}
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
          active={!!status || !!query || (isAdmin && !!branchId) || hardwareTab !== 'ALL'}
          onClear={() => {
            setStatus('');
            setQuery('');
            setHardwareTab('ALL');
            if (isAdmin) setBranchId('');
          }}
        />
      </section>

      {err && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          Could not load the SIM cards: {err}
        </div>
      )}

      {/* Main Tables Display */}
      {hardwareTab === 'POS' ? (
        // Dedicated POS Terminal View
        <div className="flex flex-col gap-3.5">
          {renderSimTable(
            posRows,
            'POS Terminal · SIM Cards Table',
            <Cpu className="w-4 h-4 text-[#5cc8ff]" />,
            'bg-sky-100 text-sky-800',
            'POS',
            'No POS Terminal SIM cards found matching the current filters.'
          )}
          <Pager pg={pg} label="POS SIM cards" />
        </div>
      ) : hardwareTab === 'SOUND_BOX' ? (
        // Dedicated Sound Box View
        <div className="flex flex-col gap-3.5">
          {renderSimTable(
            sbRows,
            'Sound Box · SIM Cards Table',
            <Volume2 className="w-4 h-4 text-[#a2a5e0]" />,
            'bg-purple-100 text-purple-800',
            'SOUND_BOX',
            'No Sound Box SIM cards found matching the current filters.'
          )}
          <Pager pg={pg} label="Sound Box SIM cards" />
        </div>
      ) : hardwareTab === 'UNASSIGNED' ? (
        // Dedicated Available Pool View
        <div className="flex flex-col gap-3.5">
          {renderSimTable(
            unassignedRows,
            'Available SIM Reserve Pool (Ready to Assign)',
            <Layers className="w-4 h-4 text-emerald-400" />,
            'bg-emerald-100 text-emerald-800',
            undefined,
            'No unassigned SIM cards in pool.'
          )}
          <Pager pg={pg} label="Available Pool SIM cards" />
        </div>
      ) : viewMode === 'SEPARATE' ? (
        // All Tab with Separate Tables for POS & Sound Box
        <div className="flex flex-col gap-4">
          {/* Table 1: POS Terminal */}
          {renderSimTable(
            posRows,
            'POS Terminal · SIM Cards Table',
            <Cpu className="w-4 h-4 text-[#5cc8ff]" />,
            'bg-sky-100 text-sky-800',
            'POS',
            'No POS Terminal SIM cards found.'
          )}

          {/* Table 2: Sound Box */}
          {renderSimTable(
            sbRows,
            'Sound Box · SIM Cards Table',
            <Volume2 className="w-4 h-4 text-[#a2a5e0]" />,
            'bg-purple-100 text-purple-800',
            'SOUND_BOX',
            'No Sound Box SIM cards found.'
          )}

          {/* Table 3: Unassigned Pool */}
          {unassignedRows.length > 0 && (
            renderSimTable(
              unassignedRows,
              'Available SIM Reserve Pool (Unassigned)',
              <Layers className="w-4 h-4 text-emerald-400" />,
              'bg-emerald-100 text-emerald-800',
              undefined,
              'No unassigned reserve SIM cards.'
            )
          )}
          <Pager pg={pg} label="SIM cards" />
        </div>
      ) : (
        // Combined Master Table
        <div className="flex flex-col gap-3.5">
          {renderSimTable(
            rows || [],
            'Combined Master · All SIM Cards Table',
            <CreditCard className="w-4 h-4 text-[#5cc8ff]" />,
            'bg-slate-100 text-slate-800',
            undefined,
            totalAll === 0 ? 'No SIM card registered yet. Add SIMs, or load opening stock.' : 'No SIM card matches the filters.'
          )}
          <Pager pg={pg} label="SIM cards" />
        </div>
      )}

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
        initialTarget={dialogTarget}
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

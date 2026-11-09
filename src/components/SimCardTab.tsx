import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Search, RefreshCw, Loader2, PackagePlus, PencilLine, CreditCard, Download,
  Cpu, Volume2, Layers
} from 'lucide-react';
import { Branch, UserRole, Device, User } from '../types';
import { Pager } from './Pager';
import { usePager } from '../utils/usePager';
import { downloadCsv, csvTime } from '../utils/exportCsv';
import { ClearFiltersButton } from './ClearFiltersButton';
import {
  MaterialSerial, SERIAL_STATUS_LABEL, SerialStatus, cleanMaterialError,
  fetchSerialStatusCounts, fetchSerialsPage, isMaterialsMissing, placeName,
  adminSimUpdate,
} from '../services/materialsService';
import { MaterialsSetupNotice, StatusPill, btnLight, btnPrimary, fmtDay } from './MaterialsUi';
import { AdjustDialog, LostMaterialsSection, StockInDialog } from './MaterialStockPanel';
import { ManageSimModal } from './ManageSimModal';
import { WHILE_TAP_BUTTON, SPRING_NO_BOUNCE, SHARED_LAYOUT_IDS } from '../utils/animationRules';

/**
 * (6 Nov 2026) Stock Inventory → SIM Card.
 * Clean, fast unified enterprise table showing cellular connectivity SIM cards.
 * Hardware types (POS Terminal vs Sound Box) are selectable via intuitive type filters,
 * eliminating redundant empty product columns from the table.
 */
const SIM_CODES: ['SIM'] = ['SIM'];
const STATUSES: SerialStatus[] = ['HQ_STOCK', 'IN_TRANSIT', 'BRANCH_RESERVE', 'AT_MERCHANT', 'LOST', 'WRITTEN_OFF'];
export type HardwareFilter = 'ALL' | 'POS' | 'SOUND_BOX' | 'UNASSIGNED';

// Module-level caches for instant 0ms tab mounting without skeleton flicker
let simCache: { rows: MaterialSerial[]; total: number } | null = null;
let simCountsCache: Record<SerialStatus, number> | null = null;

const SimCardTabComponent: React.FC<{
  role: UserRole;
  branches: Branch[];
  myBranch: string;
  devices?: Device[];
  users?: User[];
  triggerToast: (m: string) => void;
  onLostChanged?: () => void;
  onUpdateDevice?: (sn: string, updates: any) => void;
}> = ({
  role, branches, myBranch, devices = [], users = [], triggerToast, onLostChanged, onUpdateDevice,
}) => {
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const [hardwareFilter, setHardwareFilter] = useState<HardwareFilter>('ALL');
  const [status, setStatus] = useState<SerialStatus | ''>('');
  const [branchId, setBranchId] = useState(isAdmin ? '' : myBranch);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  const [rows, setRows] = useState<MaterialSerial[] | null>(() => simCache?.rows || null);
  const [, setTotal] = useState(() => simCache?.total || 0);
  const [counts, setCounts] = useState<Record<SerialStatus, number> | null>(() => simCountsCache || null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [dlg, setDlg] = useState<'' | 'IN' | 'ADJUST'>('');
  const [managingSim, setManagingSim] = useState<MaterialSerial | null>(null);

  const deviceMap = useMemo(() => {
    const map = new Map<string, Device>();
    for (let i = 0; i < devices.length; i++) {
      const d = devices[i];
      if (d && d.serial) map.set(d.serial.toUpperCase(), d);
    }
    return map;
  }, [devices]);

  const getHardwareInfo = useCallback((s: MaterialSerial): {
    type: 'POS' | 'SOUND_BOX' | 'UNASSIGNED';
    label: string;
    serial: string;
  } => {
    if (s.deviceSerial) {
      const dev = deviceMap.get(s.deviceSerial.toUpperCase());
      const isSoundBox = dev?.type === 'Sound Box' || /^(SB|000|Q161)/i.test(s.deviceSerial);
      return {
        type: isSoundBox ? 'SOUND_BOX' : 'POS',
        label: isSoundBox ? 'Sound Box' : 'POS Terminal',
        serial: s.deviceSerial,
      };
    }
    const noteLower = (s.note || '').toLowerCase();
    if (noteLower.includes('[sound box]') || noteLower.includes('sound box') || noteLower.includes('[sb]')) {
      return {
        type: 'SOUND_BOX',
        label: 'Sound Box (Targeted)',
        serial: '',
      };
    }
    if (noteLower.includes('[pos]') || noteLower.includes('pos terminal') || noteLower.includes('[pos terminal]')) {
      return {
        type: 'POS',
        label: 'POS Terminal (Targeted)',
        serial: '',
      };
    }
    return {
      type: 'UNASSIGNED',
      label: 'Available Pool',
      serial: '',
    };
  }, [deviceMap]);

  const filteredRows = useMemo(() => {
    if (!rows) return null;
    if (hardwareFilter === 'ALL') return rows;
    return rows.filter((r) => getHardwareInfo(r).type === hardwareFilter);
  }, [rows, hardwareFilter, getHardwareInfo]);

  const typeCounts = useMemo(() => {
    const c = { ALL: rows?.length ?? 0, POS: 0, SOUND_BOX: 0, UNASSIGNED: 0 };
    if (!rows) return c;
    for (let i = 0; i < rows.length; i++) {
      const t = getHardwareInfo(rows[i]).type;
      c[t]++;
    }
    return c;
  }, [rows, getHardwareInfo]);

  const pg = usePager(filteredRows?.length ?? 0, [status, branchId, search, hardwareFilter]);
  const displayedRows = useMemo(
    () => (filteredRows || []).slice(pg.start, pg.end),
    [filteredRows, pg.start, pg.end]
  );

  const [countsKey, setCountsKey] = useState(0);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const p = await fetchSerialsPage({ code: 'SIM', status, branchId: branchId || undefined, search, page: 1, pageSize: 1000 }, force);
      if (!status && !branchId && !search) { simCache = { rows: p.rows, total: p.total }; }
      setRows(p.rows); setTotal(p.total); setErr('');
    } catch (e) {
      const m = cleanMaterialError(e); setErr(isMaterialsMissing(m) ? 'SETUP' : m); setRows((r) => r || []);
    } finally { setLoading(false); }
  }, [status, branchId, search]);

  useEffect(() => {
    let alive = true;
    fetchSerialStatusCounts('SIM', branchId || undefined, countsKey > 0).then((c) => { if (alive) { if (!branchId) simCountsCache = c; setCounts(c); } }).catch(() => {});
    return () => { alive = false; };
  }, [branchId, countsKey]);

  useEffect(() => { load(countsKey > 0); }, [load, countsKey]);
  const changed = () => { setCountsKey((k) => k + 1); onLostChanged?.(); };

  useEffect(() => {
    const handleSync = () => {
      load(true);
      setCountsKey((k) => k + 1);
    };
    window.addEventListener('materials-updated', handleSync);
    window.addEventListener('sim-card-updated', handleSync);
    return () => {
      window.removeEventListener('materials-updated', handleSync);
      window.removeEventListener('sim-card-updated', handleSync);
    };
  }, [load]);

  const handleSaveSim = async (payload: {
    serial: string;
    newSerial?: string;
    status: SerialStatus;
    branchId: string;
    deviceSerial: string | null;
    mid: string | null;
    merchantName: string | null;
    staff: string | null;
    deployedDate: string | null;
    blockedWithCarrier: boolean;
    note: string | null;
  }) => {
    try {
      await adminSimUpdate({
      serial: payload.serial,
      new_serial: payload.newSerial,
      status: payload.status,
      branch_id: payload.branchId,
      device_serial: payload.deviceSerial,
      mid: payload.mid,
      merchant_name: payload.merchantName,
      blocked_with_carrier: payload.blockedWithCarrier,
      note: payload.note,
    });
    } catch (e) {
      throw new Error(cleanMaterialError(e));   // shown in the panel; nothing was saved
    }

    if (onUpdateDevice && payload.deviceSerial) {
      onUpdateDevice(payload.deviceSerial, {
        customFields: { simCard: payload.newSerial || payload.serial },
        ...(payload.mid ? { mid: payload.mid } : {}),
        ...(payload.merchantName ? { merchantName: payload.merchantName } : {}),
        ...(payload.staff ? { staff: payload.staff } : {}),
        ...(payload.deployedDate ? { deployedDate: payload.deployedDate } : {}),
      });
    }

    triggerToast(`SIM ${payload.newSerial || payload.serial} updated successfully.`);
    changed();
  };

  const exportCsv = async () => {
    const list = filteredRows || rows || [];
    downloadCsv('sim-cards', [
      'SIM number', 'Status', 'Type of Sim Card', 'Assigned Device (Serial)', 'Merchant Name', 'MID', 'Deployment Date', 'Branch Staff', 'Branch Name', 'Updated At', 'Updated By'
    ], list.map((s) => {
      const dev = s.deviceSerial ? deviceMap.get(s.deviceSerial.toUpperCase()) : undefined;
      const hw = getHardwareInfo(s);
      const merchantName = s.merchantName || dev?.merchantName || '';
      const mid = s.mid || dev?.mid || '';
      const deployedDate = dev?.deployedDate || (s.status === 'AT_MERCHANT' && s.updatedAt ? fmtDay(s.updatedAt) : '');
      const branchStaff = dev?.staff || dev?.installedByStaff || (s.status === 'AT_MERCHANT' ? s.updatedBy : '') || '';
      const branchName = dev?.branchName || placeName(s.branchId, branches);

      return [s.serial, SERIAL_STATUS_LABEL[s.status], hw.label, hw.serial || '', merchantName, mid, deployedDate, branchStaff, branchName, csvTime(s.updatedAt), s.updatedBy];
    }));
    triggerToast(`Saved ${list.length} SIM card(s).`);
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
              <motion.button
                whileTap={WHILE_TAP_BUTTON}
                type="button"
                className={btnPrimary}
                onClick={() => setDlg('IN')}
              >
                <PackagePlus className="w-4 h-4" />
                Add SIMs
              </motion.button>
            )}
            {isAdmin && (
              <motion.button whileTap={WHILE_TAP_BUTTON} type="button" className={btnLight} onClick={() => setDlg('ADJUST')}>
                <PencilLine className="w-4 h-4" />
                Correct
              </motion.button>
            )}
            <motion.button
              whileTap={WHILE_TAP_BUTTON}
              type="button"
              className={btnLight}
              onClick={() => exportCsv().catch((e) => triggerToast(`Not saved: ${cleanMaterialError(e)}`))}
            >
              <Download className="w-4 h-4" />
              Export CSV
            </motion.button>
            <motion.button whileTap={WHILE_TAP_BUTTON} type="button" className={btnLight} onClick={changed} aria-label="Refresh">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </motion.button>
          </div>
        </div>

        {/* Status Filter Pills */}
        <div className="flex flex-wrap gap-2 mt-5 pt-5 border-t border-slate-200/90" role="group" aria-label="Status">
          <motion.button
            whileTap={WHILE_TAP_BUTTON}
            type="button"
            onClick={() => setStatus('')}
            aria-pressed={status === ''}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border cursor-pointer transition ${
              status === '' ? 'bg-[#003857] text-white border-[#003857]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            All <span className="tabular-nums opacity-80 ml-1">{totalAll?.toLocaleString() ?? '—'}</span>
          </motion.button>
          {STATUSES.map((s) => (
            <motion.button
              key={s}
              whileTap={WHILE_TAP_BUTTON}
              type="button"
              onClick={() => setStatus(s)}
              aria-pressed={status === s}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border cursor-pointer transition ${
                status === s ? 'bg-[#003857] text-white border-[#003857]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {SERIAL_STATUS_LABEL[s]}{' '}
              <span className="tabular-nums opacity-80 ml-1">
                {counts ? counts[s].toLocaleString() : '—'}
              </span>
            </motion.button>
          ))}
        </div>

        {/* Hardware Type Selector Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 mt-3.5 pt-3.5 border-t border-slate-200/90">
          <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-200/80 rounded-2xl" role="tablist" aria-label="Select Device Type">
            <motion.button
              whileTap={WHILE_TAP_BUTTON}
              type="button"
              role="tab"
              aria-selected={hardwareFilter === 'ALL'}
              onClick={() => setHardwareFilter('ALL')}
              className={`relative px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                hardwareFilter === 'ALL'
                  ? 'text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/70'
              }`}
            >
              {hardwareFilter === 'ALL' && (
                <motion.div
                  layoutId={SHARED_LAYOUT_IDS.SIM_HARDWARE_PILL}
                  transition={SPRING_NO_BOUNCE}
                  className="absolute inset-0 rounded-xl bg-[#003857] z-0 pointer-events-none"
                />
              )}
              <CreditCard className="w-3.5 h-3.5 relative z-10" />
              <span className="relative z-10">All Types</span>
              <span className={`relative z-10 text-[10px] px-1.5 py-0.5 rounded-full font-mono font-normal ${hardwareFilter === 'ALL' ? 'bg-white/20 text-white' : 'bg-slate-300 text-slate-700'}`}>
                {typeCounts.ALL}
              </span>
            </motion.button>
            <motion.button
              whileTap={WHILE_TAP_BUTTON}
              type="button"
              role="tab"
              aria-selected={hardwareFilter === 'POS'}
              onClick={() => setHardwareFilter('POS')}
              className={`relative px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                hardwareFilter === 'POS'
                  ? 'text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/70'
              }`}
            >
              {hardwareFilter === 'POS' && (
                <motion.div
                  layoutId={SHARED_LAYOUT_IDS.SIM_HARDWARE_PILL}
                  transition={SPRING_NO_BOUNCE}
                  className="absolute inset-0 rounded-xl bg-sky-700 z-0 pointer-events-none"
                />
              )}
              <Cpu className={`w-3.5 h-3.5 relative z-10 ${hardwareFilter === 'POS' ? 'text-sky-200' : 'text-sky-600'}`} />
              <span className="relative z-10">POS Terminal</span>
              <span className={`relative z-10 text-[10px] px-1.5 py-0.5 rounded-full font-mono font-normal ${hardwareFilter === 'POS' ? 'bg-white/20 text-white' : 'bg-slate-300 text-slate-700'}`}>
                {typeCounts.POS}
              </span>
            </motion.button>
            <motion.button
              whileTap={WHILE_TAP_BUTTON}
              type="button"
              role="tab"
              aria-selected={hardwareFilter === 'SOUND_BOX'}
              onClick={() => setHardwareFilter('SOUND_BOX')}
              className={`relative px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                hardwareFilter === 'SOUND_BOX'
                  ? 'text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/70'
              }`}
            >
              {hardwareFilter === 'SOUND_BOX' && (
                <motion.div
                  layoutId={SHARED_LAYOUT_IDS.SIM_HARDWARE_PILL}
                  transition={SPRING_NO_BOUNCE}
                  className="absolute inset-0 rounded-xl bg-purple-700 z-0 pointer-events-none"
                />
              )}
              <Volume2 className={`w-3.5 h-3.5 relative z-10 ${hardwareFilter === 'SOUND_BOX' ? 'text-purple-200' : 'text-purple-600'}`} />
              <span className="relative z-10">Sound Box</span>
              <span className={`relative z-10 text-[10px] px-1.5 py-0.5 rounded-full font-mono font-normal ${hardwareFilter === 'SOUND_BOX' ? 'bg-white/20 text-white' : 'bg-slate-300 text-slate-700'}`}>
                {typeCounts.SOUND_BOX}
              </span>
            </motion.button>
            <motion.button
              whileTap={WHILE_TAP_BUTTON}
              type="button"
              role="tab"
              aria-selected={hardwareFilter === 'UNASSIGNED'}
              onClick={() => setHardwareFilter('UNASSIGNED')}
              className={`relative px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                hardwareFilter === 'UNASSIGNED'
                  ? 'text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/70'
              }`}
            >
              {hardwareFilter === 'UNASSIGNED' && (
                <motion.div
                  layoutId={SHARED_LAYOUT_IDS.SIM_HARDWARE_PILL}
                  transition={SPRING_NO_BOUNCE}
                  className="absolute inset-0 rounded-xl bg-emerald-700 z-0 pointer-events-none"
                />
              )}
              <Layers className={`w-3.5 h-3.5 relative z-10 ${hardwareFilter === 'UNASSIGNED' ? 'text-emerald-200' : 'text-emerald-600'}`} />
              <span className="relative z-10">Available Pool</span>
              <span className={`relative z-10 text-[10px] px-1.5 py-0.5 rounded-full font-mono font-normal ${hardwareFilter === 'UNASSIGNED' ? 'bg-white/20 text-white' : 'bg-slate-300 text-slate-700'}`}>
                {typeCounts.UNASSIGNED}
              </span>
            </motion.button>
          </div>
          <p className="text-xs text-slate-500 italic hidden sm:block">
            SIM cards provide cellular service to either POS or Sound Box depending on merchant requirement
          </p>
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
        <select
          value={hardwareFilter}
          onChange={(e) => setHardwareFilter(e.target.value as HardwareFilter)}
          aria-label="Device Type"
          className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 cursor-pointer min-w-[170px]"
        >
          <option value="ALL">All Hardware Types</option>
          <option value="POS">POS Terminal</option>
          <option value="SOUND_BOX">Sound Box</option>
          <option value="UNASSIGNED">Available Pool (Unassigned)</option>
        </select>
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
          active={!!status || !!query || (isAdmin && !!branchId) || hardwareFilter !== 'ALL'}
          onClear={() => {
            setStatus('');
            setQuery('');
            setHardwareFilter('ALL');
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
                {(filteredRows?.length ?? rows?.length ?? 0).toLocaleString()} cards
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
                <th className="text-left font-semibold px-2.5 py-2.5">SIM Number</th>
                <th className="text-left font-semibold px-2.5 py-2.5">Status</th>
                <th className="text-left font-semibold px-2.5 py-2.5">Type of Sim Card</th>
                <th className="text-left font-semibold px-2.5 py-2.5">Assigned Device (Serial)</th>
                <th className="text-left font-semibold px-2.5 py-2.5">Merchant Name / MID</th>
                <th className="text-left font-semibold px-2.5 py-2.5">Date of Deployment</th>
                <th className="text-left font-semibold px-2.5 py-2.5">Branch Staff</th>
                <th className="text-left font-semibold px-2.5 py-2.5">Branch Name</th>
                <th className="text-right font-semibold px-2.5 py-2.5">Action</th>
              </tr>
            </thead>
            <tbody data-page-content className={`divide-y divide-slate-100 transition-opacity ${loading && rows ? 'opacity-60' : ''}`}>
              {rows === null && [0, 1, 2, 3].map((i) => (
                <tr key={i}>
                  <td colSpan={10} className="px-3.5 py-3.5">
                    <div className="skeleton h-4 rounded w-3/4" />
                  </td>
                </tr>
              ))}
              {rows && (filteredRows?.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={10} className="px-3.5 py-10 text-center text-slate-500">
                    {totalAll === 0 ? 'No SIM card registered yet. Add SIMs or load opening stock.' : 'No SIM card matches the current filters.'}
                  </td>
                </tr>
              )}
              {displayedRows.map((s, i) => {
                const dev = s.deviceSerial ? deviceMap.get(s.deviceSerial.toUpperCase()) : undefined;
                const hw = getHardwareInfo(s);

                const merchantName = s.merchantName || dev?.merchantName || '';
                const mid = s.mid || dev?.mid || '';
                const hasMerchant = Boolean(merchantName || mid);

                const deployedDate = dev?.deployedDate || (s.status === 'AT_MERCHANT' && s.updatedAt ? fmtDay(s.updatedAt) : '');
                const branchStaff = dev?.staff || dev?.installedByStaff || (s.status === 'AT_MERCHANT' ? s.updatedBy : '') || '';
                const branchName = dev?.branchName || (s.branchId && s.branchId !== '100' ? placeName(s.branchId, branches) : (s.branchId === '100' ? 'Head Office' : ''));

                return (
                  <tr key={s.serial} style={{ animationDelay: `${Math.min(i, 8) * 15}ms` }} className="row-stagger hover:bg-slate-50/70 transition-colors">
                    <td className="px-2.5 py-2.5 text-center tabular-nums text-slate-500 font-mono">
                      {pg.start + i + 1}
                    </td>
                    <td className="px-2.5 py-2.5 font-mono font-semibold text-slate-900 whitespace-nowrap">
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
                    <td className="px-2.5 py-2.5 whitespace-nowrap">
                      {hw.type === 'SOUND_BOX' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-purple-50 text-purple-800 border border-purple-200/90">
                          <Volume2 className="w-3.5 h-3.5 text-purple-600 shrink-0" aria-hidden />
                          <span>Sound Box</span>
                        </span>
                      ) : hw.type === 'POS' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-sky-50 text-sky-800 border border-sky-200/90">
                          <Cpu className="w-3.5 h-3.5 text-sky-600 shrink-0" aria-hidden />
                          <span>POS Terminal</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200/90">
                          <Layers className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden />
                          <span>Available (Both)</span>
                        </span>
                      )}
                    </td>
                    <td className="px-2.5 py-2.5 font-mono whitespace-nowrap">
                      {hw.serial ? (
                        <span className="font-semibold text-slate-800">{hw.serial}</span>
                      ) : (
                        <span className="text-slate-300 select-none">—</span>
                      )}
                    </td>
                    <td className="px-2.5 py-2.5">
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
                    <td className="px-2.5 py-2.5">
                      {branchStaff ? (
                        <span className="text-slate-800 font-medium truncate block max-w-[170px]" title={branchStaff}>
                          {branchStaff}
                        </span>
                      ) : (
                        <span className="text-slate-300 select-none">—</span>
                      )}
                    </td>
                    <td className="px-2.5 py-2.5">
                      {branchName ? (
                        <span className="text-slate-700 truncate block max-w-[170px]" title={branchName}>
                          {branchName}
                        </span>
                      ) : (
                        <span className="text-slate-300 select-none">—</span>
                      )}
                    </td>
                    <td className="px-2.5 py-2.5 text-right whitespace-nowrap">
                      <motion.button
                        whileTap={WHILE_TAP_BUTTON}
                        type="button"
                        onClick={() => setManagingSim(s)}
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-[#003857] hover:text-white text-slate-700 transition cursor-pointer border border-slate-200"
                        title="Manage SIM Card Lifecycle & Device Assignment"
                      >
                        Manage
                      </motion.button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pager pg={pg} label="SIM cards" />
      </section>

      {/* Manage SIM Modal */}
      {managingSim && (
        <ManageSimModal
          sim={managingSim}
          isOpen={Boolean(managingSim)}
          onClose={() => setManagingSim(null)}
          branches={branches}
          users={users}
          devices={devices}
          role={role}
          myBranch={myBranch}
          onSave={handleSaveSim}
        />
      )}

      {/* Stock In Dialog */}
      <StockInDialog
        open={dlg === 'IN'}
        codes={['SIM']}
        branches={branches}
        initialTarget={hardwareFilter === 'POS' || hardwareFilter === 'SOUND_BOX' ? hardwareFilter : 'ALL'}
        onClose={() => setDlg('')}
        onDone={changed}
        triggerToast={triggerToast}
      />

      <LostMaterialsSection codes={SIM_CODES} title="Lost Materials · SIM Card" branches={branches} isAdmin={isAdmin}
        triggerToast={triggerToast} onChanged={changed} />

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

export const SimCardTab = React.memo(SimCardTabComponent);

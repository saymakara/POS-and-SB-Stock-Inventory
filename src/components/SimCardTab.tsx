import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Search, RefreshCw, Loader2, PackagePlus, PencilLine, CreditCard, FileSpreadsheet,
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
import { MaterialsSetupNotice, StatusPill, fmtDay } from './MaterialsUi';
import { AdjustDialog, LostMaterialsSection, StockInDialog } from './MaterialStockPanel';
import { ManageSimModal } from './ManageSimModal';
import { getCachedDeviceBySerialMap } from './RightDrawerShell';
import { WHILE_TAP_BUTTON, SPRING_TAB_PILL, SHARED_LAYOUT_IDS } from '../utils/animationRules';
import {
  PillMotion,
  CAPSULE_TRACK_CLS,
  CAPSULE_PILL_CLS,
  CAPSULE_BTN_ACTIVE_CLS,
  CAPSULE_BTN_INACTIVE_CLS,
  CAPSULE_COUNT_ACTIVE_CLS,
  CAPSULE_COUNT_INACTIVE_CLS,
} from './PillMotion';
import { buildPpDirectoryScope } from '../utils/fieldScope';
import { getCachedStaff, onStaffList } from '../services/staffCache';
import { onPortalSync } from '../utils/portalSync';
import type { StaffAccount } from '../services/supabaseService';

/**
 * (6 Nov 2026) Stock Inventory → SIM Card.
 * Clean, fast unified enterprise table showing cellular connectivity SIM cards.
 * Hardware types (POS Terminal vs Sound Box) are selectable via intuitive type filters,
 * eliminating redundant empty product columns from the table.
 */
const SIM_CODES: ['SIM'] = ['SIM'];
const PRIMARY_SIM_STEPS: { status: SerialStatus; step: string; label: string }[] = [
  { status: 'HQ_STOCK', step: '1', label: 'Available In Stock' },
  { status: 'BRANCH_RESERVE', step: '2', label: 'Branch Reserve' },
  { status: 'AT_MERCHANT', step: '3', label: 'Bundled (Serial & MID)' },
];
const SIM_STATUS_DISPLAY: Record<SerialStatus, string> = {
  HQ_STOCK: 'Available In Stock',
  IN_TRANSIT: 'In Transit',
  BRANCH_RESERVE: 'Branch Reserve',
  AT_MERCHANT: 'Bundled Live',
  LOST: 'Lost',
  FAULTY: 'Faulty',
  WRITTEN_OFF: 'Written Off',
};
export type HardwareFilter = 'ALL' | 'POS' | 'SOUND_BOX' | 'UNASSIGNED';

const EmptyDash: React.FC = () => (
  <span className="text-slate-300 dark:text-slate-600 font-mono select-none" aria-hidden="true">&mdash;</span>
);

// Module-level caches for instant 0ms tab mounting without skeleton flicker
let simCache: { rows: MaterialSerial[]; total: number } | null = null;
let simCountsCache: Record<SerialStatus, number> | null = null;

const SimCardTabComponent: React.FC<{
  role: UserRole;
  branches: Branch[];
  myBranch: string;
  devices?: Device[];
  users?: User[];
  excludedSerials?: Set<string>;
  triggerToast: (m: string) => void;
  onLostChanged?: () => void;
  onUpdateDevice?: (sn: string, updates: any) => void;
}> = ({
  role, branches, myBranch, devices = [], users = [], excludedSerials, triggerToast, onLostChanged, onUpdateDevice,
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
  const [unfilteredRows, setUnfilteredRows] = useState<MaterialSerial[] | null>(() => simCache?.rows || null);
  const [, setTotal] = useState(() => simCache?.total || 0);
  const [counts, setCounts] = useState<Record<SerialStatus, number> | null>(() => simCountsCache || null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [dlg, setDlg] = useState<'' | 'IN' | 'ADJUST'>('');
  const [managingSim, setManagingSim] = useState<MaterialSerial | null>(null);
  const [cachedStaff, setCachedStaff] = useState<StaffAccount[] | null>(() => getCachedStaff());
  useEffect(() => onStaffList(setCachedStaff), []);

  const ppScope = useMemo(
    () => buildPpDirectoryScope(branches, users, cachedStaff),
    [branches, users, cachedStaff]
  );

  const isRowInScope = useCallback((r: MaterialSerial): boolean => {
    if (!ppScope.isBranchInScope(r.branchId)) return false;
    if (r.deviceSerial && excludedSerials?.has(r.deviceSerial.toUpperCase())) return false;
    return true;
  }, [ppScope, excludedSerials]);

  const deviceMap = useMemo(() => getCachedDeviceBySerialMap(devices), [devices]);

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

  const scopedRows = useMemo(() => {
    if (!rows) return null;
    return rows.filter(isRowInScope);
  }, [rows, isRowInScope]);

  const filteredRows = useMemo(() => {
    if (!scopedRows) return null;
    if (hardwareFilter === 'ALL') return scopedRows;
    return scopedRows.filter((r) => getHardwareInfo(r).type === hardwareFilter);
  }, [scopedRows, hardwareFilter, getHardwareInfo]);

  const typeCounts = useMemo(() => {
    const c = { ALL: scopedRows?.length ?? 0, POS: 0, SOUND_BOX: 0, UNASSIGNED: 0 };
    if (!scopedRows) return c;
    for (let i = 0; i < scopedRows.length; i++) {
      const t = getHardwareInfo(scopedRows[i]).type;
      c[t]++;
    }
    return c;
  }, [scopedRows, getHardwareInfo]);

  const pg = usePager(filteredRows?.length ?? 0, [status, branchId, search, hardwareFilter]);
  const displayedRows = useMemo(
    () => (filteredRows || []).slice(pg.start, pg.drawEnd),
    [filteredRows, pg.start, pg.drawEnd]
  );

  const [countsKey, setCountsKey] = useState(0);

  const load = useCallback(async (force = false, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const p = await fetchSerialsPage({ code: 'SIM', status, branchId: branchId || undefined, search, page: 1, pageSize: 1000 }, force);
      if (!status && !branchId && !search) { simCache = { rows: p.rows, total: p.total }; setUnfilteredRows(p.rows); }
      setRows(p.rows); setTotal(p.total); setErr('');
    } catch (e) {
      const m = cleanMaterialError(e); setErr(isMaterialsMissing(m) ? 'SETUP' : m); setRows((r) => r || []);
    } finally { if (!silent) setLoading(false); }
  }, [status, branchId, search]);

  useEffect(() => {
    let alive = true;
    fetchSerialStatusCounts('SIM', branchId || undefined, countsKey > 0).then((c) => { if (alive) { if (!branchId) simCountsCache = c; setCounts(c); } }).catch(() => {});
    return () => { alive = false; };
  }, [branchId, countsKey]);

  useEffect(() => { load(countsKey > 0); }, [load, countsKey]);
  const changed = () => { setCountsKey((k) => k + 1); onLostChanged?.(); };

  useEffect(() => {
    let timer = 0;
    const handleSync = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void load(true, true);
        setCountsKey((k) => k + 1);
      }, 350);
    };
    window.addEventListener('materials-updated', handleSync);
    window.addEventListener('sim-card-updated', handleSync);
    const unsubSync = onPortalSync(['materials', 'devices'], handleSync);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('materials-updated', handleSync);
      window.removeEventListener('sim-card-updated', handleSync);
      unsubSync();
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
    const list = filteredRows || scopedRows || [];
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

  const effectiveCounts = useMemo(() => {
    if (!counts) return null;
    const baseList = unfilteredRows
      ? (branchId ? unfilteredRows.filter((r) => r.branchId === branchId) : unfilteredRows)
      : rows;
    if (!baseList) return counts;
    const out: Record<SerialStatus, number> = { ...counts };
    for (let i = 0; i < baseList.length; i++) {
      const r = baseList[i];
      if (!isRowInScope(r) && (out[r.status] || 0) > 0) {
        out[r.status] = out[r.status] - 1;
      }
    }
    return out;
  }, [counts, unfilteredRows, rows, branchId, isRowInScope]);

  const totalAll = useMemo(
    () => (effectiveCounts ? Object.values(effectiveCounts).reduce((a, b) => a + b, 0) : undefined),
    [effectiveCounts]
  );

  if (err === 'SETUP') return <MaterialsSetupNotice />;

  return (
    <div className="flex flex-col gap-3.5">
      {/* Top Banner Header */}
      <section className="relative overflow-hidden rounded-3xl p-6 sm:p-7 border shadow-sm bg-slate-100 border-slate-200/90" aria-label="SIM cards">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="flex items-start gap-3.5 max-w-3xl">
            <div className="w-10 h-10 rounded-xl bg-white border border-slate-200/90 flex items-center justify-center shadow-2xs shrink-0 mt-0.5">
              <CreditCard className="w-5 h-5 text-[#155484]" aria-hidden />
            </div>
            <div className="space-y-1">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
                SIM Card Control Hub
              </h1>
              <p className="text-sm sm:text-base leading-relaxed text-slate-600">
                Track and manage provisioned SIM card numbers across HQ stock, branch reserves, POS Terminals, and Sound Boxes.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {isAdmin && (
              <motion.button
                whileHover={{ y: -1 }}
                whileTap={WHILE_TAP_BUTTON}
                type="button"
                className="btn btn-secondary btn-md shadow-2xs"
                onClick={() => setDlg('IN')}
              >
                <PackagePlus className="w-4 h-4 text-[#155484]" aria-hidden />
                <span>Add SIMs</span>
              </motion.button>
            )}
            {isAdmin && (
              <motion.button
                whileHover={{ y: -1 }}
                whileTap={WHILE_TAP_BUTTON}
                type="button"
                className="btn btn-secondary btn-md shadow-2xs"
                onClick={() => setDlg('ADJUST')}
              >
                <PencilLine className="w-4 h-4 text-amber-600" aria-hidden />
                <span>Correct</span>
              </motion.button>
            )}
            <motion.button
              whileHover={{ y: -1 }}
              whileTap={WHILE_TAP_BUTTON}
              type="button"
              className="btn btn-secondary btn-md shadow-2xs"
              onClick={() => exportCsv().catch((e) => triggerToast(`Not saved: ${cleanMaterialError(e)}`))}
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" aria-hidden />
              <span>Export CSV</span>
            </motion.button>
            <motion.button
              whileHover={{ y: -1 }}
              whileTap={WHILE_TAP_BUTTON}
              type="button"
              className="group btn btn-secondary btn-md shadow-2xs"
              onClick={changed}
              aria-label="Refresh"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin text-[#155484]" aria-hidden />
              ) : (
                <RefreshCw className="w-4 h-4 text-slate-600 group-hover:rotate-180 transition-transform duration-300" aria-hidden />
              )}
              <span>Refresh</span>
            </motion.button>
          </div>
        </div>

        {/* 3-Step Lifecycle & Status Filter Pills */}
        <div className="mt-5 pt-5 border-t border-slate-200/90">
          <div className={`${CAPSULE_TRACK_CLS} flex-wrap`} role="tablist" aria-label="Status">
            <button
              type="button"
              role="tab"
              aria-selected={status === ''}
              aria-pressed={status === ''}
              onClick={() => React.startTransition(() => setStatus(''))}
              className={`relative px-3 py-1.5 rounded-full text-xs cursor-pointer transition-colors inline-flex items-center gap-1.5 ${
                status === '' ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
              }`}
            >
              {status === '' && (
                <PillMotion
                  layoutId="sim-status-step-pill"
                  aria-hidden
                  className={CAPSULE_PILL_CLS}
                  transition={SPRING_TAB_PILL}
                />
              )}
              <span className="w-2 h-2 rounded-full bg-[#004e75] relative z-10 shrink-0" aria-hidden />
              <span className="relative z-10">All</span>
              <span className={`relative z-10 text-[10.5px] px-1.5 py-0.2 rounded-full tabular-nums transition-colors ${status === '' ? CAPSULE_COUNT_ACTIVE_CLS : CAPSULE_COUNT_INACTIVE_CLS}`}>
                {totalAll?.toLocaleString() ?? '—'}
              </span>
            </button>
            {PRIMARY_SIM_STEPS.map((item) => {
              const active = status === item.status;
              const dotCls = item.status === 'AT_MERCHANT' ? 'bg-emerald-500' : item.status === 'BRANCH_RESERVE' ? 'bg-amber-500' : 'bg-sky-500';
              return (
                <button
                  key={item.status}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-pressed={active}
                  onClick={() => React.startTransition(() => setStatus(item.status))}
                  className={`relative px-3 py-1.5 rounded-full text-xs cursor-pointer transition-colors inline-flex items-center gap-1.5 ${
                    active ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
                  }`}
                >
                  {active && (
                    <PillMotion
                      layoutId="sim-status-step-pill"
                      aria-hidden
                      className={CAPSULE_PILL_CLS}
                      transition={SPRING_TAB_PILL}
                    />
                  )}
                  <span className={`w-2 h-2 rounded-full relative z-10 shrink-0 ${dotCls}`} aria-hidden />
                  <span className="relative z-10">{item.step}. {item.label}</span>
                  <span className={`relative z-10 text-[10.5px] px-1.5 py-0.2 rounded-full tabular-nums transition-colors ${active ? CAPSULE_COUNT_ACTIVE_CLS : CAPSULE_COUNT_INACTIVE_CLS}`}>
                    {effectiveCounts ? effectiveCounts[item.status].toLocaleString() : '—'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Hardware Type Selector Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 mt-3.5 pt-3.5 border-t border-slate-200/90">
          <div
            className={`${CAPSULE_TRACK_CLS} flex-wrap`}
            role="tablist"
            aria-label="Select Device Type"
          >
            {([
              { id: 'ALL' as const, label: 'All Types', icon: CreditCard, count: typeCounts.ALL, accent: 'text-[#004e75] dark:text-sky-400' },
              { id: 'POS' as const, label: 'POS Terminal', icon: Cpu, count: typeCounts.POS, accent: 'text-[#184e77] dark:text-[#5cc8ff]' },
              { id: 'SOUND_BOX' as const, label: 'Sound Box', icon: Volume2, count: typeCounts.SOUND_BOX, accent: 'text-[#4F518C] dark:text-[#a2a5e0]' },
              { id: 'UNASSIGNED' as const, label: 'Available Pool', icon: Layers, count: typeCounts.UNASSIGNED, accent: 'text-emerald-600 dark:text-emerald-400' },
            ]).map(({ id, label, icon: Icon, count, accent }) => {
              const active = hardwareFilter === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => React.startTransition(() => setHardwareFilter(id))}
                  className={`relative px-3 py-1.5 rounded-full text-xs transition-colors cursor-pointer select-none flex items-center gap-1.5 ${
                    active ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
                  }`}
                >
                  {active && (
                    <PillMotion
                      layoutId={SHARED_LAYOUT_IDS.SIM_HARDWARE_PILL}
                      aria-hidden
                      transition={SPRING_TAB_PILL}
                      className={CAPSULE_PILL_CLS}
                    />
                  )}
                  <Icon className={`w-3.5 h-3.5 relative z-10 transition-colors ${accent}`} />
                  <span className="relative z-10">{label}</span>
                  <span
                    className={`relative z-10 text-[10px] px-1.5 py-0.5 rounded-full font-mono transition-colors ${
                      active ? CAPSULE_COUNT_ACTIVE_CLS : CAPSULE_COUNT_INACTIVE_CLS
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
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
            onChange={(e) => React.startTransition(() => setBranchId(e.target.value))}
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
          onClear={() => React.startTransition(() => {
            setStatus('');
            setQuery('');
            setHardwareFilter('ALL');
            if (isAdmin) setBranchId('');
          })}
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

        <div className="overflow-x-auto overflow-y-hidden">
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
            <tbody data-page-content className={`silk-rows divide-y divide-slate-100 table-quiet-body ${loading && rows ? 'is-loading' : ''}`}>
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
                  <tr key={s.serial} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-2.5 py-2.5 text-center tabular-nums text-slate-500 font-mono">
                      {pg.start + i + 1}
                    </td>
                    <td className="px-2.5 py-2.5 font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {s.serial}
                    </td>
                    <td className="px-2.5 py-2.5 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <StatusPill status={s.status} label={SIM_STATUS_DISPLAY[s.status]} />
                        {s.blocked && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">
                            Blocked
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2.5 py-2.5 whitespace-nowrap">
                      {hw.type === 'SOUND_BOX' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#4F518C]/10 text-[#4F518C] border border-[#4F518C]/20">
                          <Volume2 className="w-3.5 h-3.5 text-[#4F518C] shrink-0" aria-hidden />
                          <span>Sound Box</span>
                        </span>
                      ) : hw.type === 'POS' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#184e77]/10 text-[#184e77] border border-[#184e77]/20">
                          <Cpu className="w-3.5 h-3.5 text-[#184e77] shrink-0" aria-hidden />
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
                        <EmptyDash />
                      )}
                    </td>
                    <td className="px-2.5 py-2.5">
                      {hasMerchant ? (
                        <div className="min-w-0 max-w-[200px]">
                          <span className="block font-medium text-slate-900 truncate" title={merchantName}>
                            {merchantName || <EmptyDash />}
                          </span>
                          {mid && (
                            <span className="block text-[11px] font-mono text-slate-500 truncate">
                              MID: {mid}
                            </span>
                          )}
                        </div>
                      ) : (
                        <EmptyDash />
                      )}
                    </td>
                    <td className="px-2.5 py-2.5 tabular-nums whitespace-nowrap">
                      {deployedDate ? (
                        <span className="text-slate-700 font-medium">{deployedDate}</span>
                      ) : (
                        <EmptyDash />
                      )}
                    </td>
                    <td className="px-2.5 py-2.5">
                      {branchStaff ? (
                        <span className="text-slate-800 font-medium truncate block max-w-[170px]" title={branchStaff}>
                          {branchStaff}
                        </span>
                      ) : (
                        <EmptyDash />
                      )}
                    </td>
                    <td className="px-2.5 py-2.5">
                      {branchName ? (
                        <span className="text-slate-700 truncate block max-w-[170px]" title={branchName}>
                          {branchName}
                        </span>
                      ) : (
                        <EmptyDash />
                      )}
                    </td>
                    <td className="px-2.5 py-2.5 text-right whitespace-nowrap">
                      <motion.button
                        whileTap={WHILE_TAP_BUTTON}
                        type="button"
                        onClick={() => setManagingSim(s)}
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#eaf4f2] hover:bg-[#d5eae6] text-[#1d5c55] hover:text-[#144741] border border-[#c3e0da] hover:border-[#9fd0c7] transition cursor-pointer"
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

      {/* Manage SIM Modal (kept mounted so deviceBySerialMap stays warm and exit animations run smoothly) */}
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

import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Boxes, Cpu, Volume2, RefreshCw, Loader2, PackagePlus, PencilLine, Upload,
  AlertTriangle, Download, Package, Battery, Dock, Smartphone, Plug, Search, Copy, Check
} from 'lucide-react';
import { Branch, UserRole, Device } from '../types';
import { Pager } from './Pager';
import { usePager } from '../utils/usePager';
import { downloadCsv, csvTime } from '../utils/exportCsv';
import { parseCsv } from '../utils/csv';
import { ClearFiltersButton } from './ClearFiltersButton';
import {
  DeviceGroup, LostItem, MaterialBalance, MaterialCode, MATERIALS, SerialStatus, cleanMaterialError, fetchLost, fetchMaterialBalances,
  isMaterialsMissing, materialAdjust, materialByCode, materialLostAction, materialName, materialOpening, materialStockIn, normMaterialSerial, placeName, productMaterials,
  getCachedMaterialBalances, getCachedLost, clearMaterialsCache,
  MaterialSerial, SERIAL_STATUS_LABEL, fetchSerialsPage, fetchSerialStatusCounts,
} from '../services/materialsService';
import { isFresh } from '../utils/freshness';
import { BusyLabel, Kpi, MaterialDialog, MaterialsSetupNotice, Pill, StatusPill, btnLight, btnPrimary, btnRow, fmtDay, inputCls, labelCls } from './MaterialsUi';

export type ProductView = 'UNITS' | 'PUSH' | 'MATERIAL';
export const ProductStockPage: React.FC<{
  group: DeviceGroup; role: UserRole; branches: Branch[]; myBranch: string; triggerToast: (m: string) => void;
  units: React.ReactNode; push?: React.ReactNode; pushCount?: number; lostCount?: number;
  view: ProductView; onViewChange: (v: ProductView) => void; onLostChanged?: () => void;
  devices?: Device[];
}> = ({ group, role, branches, myBranch, triggerToast, units, push, pushCount, lostCount, view, onViewChange, onLostChanged, devices = [] }) => {
  const Icon = group === 'POS' ? Cpu : Volume2;
  const title = group === 'POS' ? 'POS Terminal' : 'Sound Box';
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-lg sm:text-xl font-extrabold text-slate-900">
          <Icon className={`w-5 h-5 ${group === 'POS' ? 'text-[#006BA6]' : 'text-[#4F518C]'}`} aria-hidden />{title}
        </h2>
        <div role="tablist" aria-label={`${title} views`} className="relative inline-flex p-1 rounded-xl bg-slate-100/90 border border-slate-200/90 shadow-2xs">
          {((push ? ['UNITS', 'PUSH', 'MATERIAL'] : ['UNITS', 'MATERIAL']) as ProductView[]).map((v) => {
            const n = v === 'PUSH' ? pushCount || 0 : v === 'MATERIAL' ? lostCount || 0 : 0;
            const isSelected = view === v;
            return (
              <motion.button
                key={v}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => onViewChange(v)}
                whileTap={{ scale: 0.97 }}
                title={v === 'PUSH' && n ? `${n} unit(s) waiting to be pushed` : v === 'MATERIAL' && n ? `${n} open lost item(s)` : undefined}
                className="relative inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold cursor-pointer select-none"
              >
                {isSelected && (
                  <motion.div
                    layoutId={`active-product-view-pill-${group}`}
                    className="absolute inset-0 rounded-lg bg-[#003857] shadow-xs z-0 pointer-events-none"
                    transition={{
                      type: 'spring',
                      stiffness: 500,
                      damping: 35,
                      mass: 0.55,
                    }}
                  />
                )}
                <span
                  className={`relative z-10 transition-colors duration-150 ${
                    isSelected ? 'text-white font-bold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {v === 'UNITS' ? 'Units' : v === 'PUSH' ? 'Push Configuring' : 'Material'}
                </span>
                {n > 0 && (
                  <span
                    className={`relative z-10 text-[10.5px] font-bold px-1.5 py-0.5 rounded-full tabular-nums transition-colors duration-150 ${
                      v === 'MATERIAL'
                        ? 'bg-rose-600 text-white shadow-2xs'
                        : isSelected
                        ? 'bg-white/20 text-white'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {n}
                  </span>
                )}
              </motion.button>
            );
          })}
        </div>
      </div>
      <motion.div
        key={view}
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="w-full"
      >
        {view === 'UNITS'
          ? units
          : view === 'PUSH' && push
          ? push
          : (
            <MaterialStockPanel
              group={group}
              role={role}
              branches={branches}
              myBranch={myBranch}
              triggerToast={triggerToast}
              onLostChanged={onLostChanged}
              devices={devices}
            />
          )}
      </motion.div>
    </div>
  );
};

const STATUS_OPTIONS: SerialStatus[] = ['HQ_STOCK', 'IN_TRANSIT', 'BRANCH_RESERVE', 'AT_MERCHANT', 'LOST', 'WRITTEN_OFF'];

const MaterialStockPanel: React.FC<{
  group: DeviceGroup;
  role: UserRole;
  branches: Branch[];
  myBranch: string;
  triggerToast: (m: string) => void;
  onLostChanged?: () => void;
  devices?: Device[];
}> = ({
  group, role, branches, myBranch, triggerToast, onLostChanged, devices = [],
}) => {
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const mats = useMemo(() => productMaterials(group), [group]);
  const codes = useMemo(() => mats.map((m) => m.code), [mats]);

  // Tab & Table Filter States
  const [selectedCode, setSelectedCode] = useState<MaterialCode | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<SerialStatus | ''>('');
  const [branchFilter, setBranchFilter] = useState(isAdmin ? '' : myBranch);
  const [query, setQuery] = useState('');
  const dq = useDeferredValue(query);
  const [search, setSearch] = useState('');
  useEffect(() => { const t = setTimeout(() => setSearch(dq.trim()), 350); return () => clearTimeout(t); }, [dq]);

  const [lostFilter, setLostFilter] = useState<'OPEN' | ''>('OPEN');
  const [bal, setBal] = useState<MaterialBalance[] | null>(() => getCachedMaterialBalances() || null);
  const [lost, setLost] = useState<LostItem[] | null>(() => getCachedLost(codes, 'OPEN') || null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [onlyStock, setOnlyStock] = useState(false);
  const [dlg, setDlg] = useState<'' | 'IN' | 'ADJUST' | 'OPENING'>('');
  const [copiedSerial, setCopiedSerial] = useState<string | null>(null);

  // Serials from material_serials table
  const [dbSerials, setDbSerials] = useState<MaterialSerial[] | null>(null);
  const [counts, setCounts] = useState<Record<SerialStatus, number> | null>(null);
  const [countsKey, setCountsKey] = useState(0);

  // Fast device lookup map
  const deviceMap = useMemo(() => {
    const map = new Map<string, Device>();
    for (let i = 0; i < devices.length; i++) {
      const d = devices[i];
      if (d && d.serial) map.set(d.serial.toUpperCase(), d);
    }
    return map;
  }, [devices]);

  // Devices-derived materials (e.g. POS Batteries, Stand Holders, Charging Docks, Adaptors recorded on POS devices)
  const deviceDerivedItems = useMemo(() => {
    if (!devices || devices.length === 0) return [];
    const items: MaterialSerial[] = [];
    const nowStr = new Date().toISOString();

    for (let i = 0; i < devices.length; i++) {
      const d = devices[i];
      if (group === 'POS' && d.type !== 'POS Terminal') continue;
      if (group === 'SB' && d.type !== 'Sound Box') continue;

      // Extract battery from POS Terminal
      if (d.batterySerial && d.batterySerial.trim()) {
        const bat = d.batterySerial.trim();
        const st: SerialStatus =
          d.stage === 'COMPLETE' || d.stage === 'CONFIGURING'
            ? 'AT_MERCHANT'
            : d.stage === 'HQ_STOCK'
            ? 'HQ_STOCK'
            : d.stage === 'LOST'
            ? 'LOST'
            : 'BRANCH_RESERVE';

        items.push({
          code: 'BATTERY',
          serial: bat,
          status: st,
          branchId: String(d.branchId || '100'),
          deviceSerial: d.serial,
          mid: d.mid || null,
          merchantName: d.merchantName || null,
          reqId: null,
          blocked: false,
          note: `Model: ${d.model || 'Wizar POS Q2 Pro'}`,
          updatedAt: d.deployedDate || d.updatedAt || nowStr,
          updatedBy: d.staff || null,
        });
      }
    }
    return items;
  }, [devices, group]);

  // Load balances and lost
  const load = useCallback(async (force = false) => {
    const cachedB = getCachedMaterialBalances();
    const cachedL = getCachedLost(codes, lostFilter);
    const kLost = codes.slice().sort().join(',') + '|' + lostFilter;
    if (!force && cachedB && cachedL && isFresh('mat:balances', 60000) && isFresh('mat:lost:' + kLost, 60000)) {
      setBal(cachedB);
      setLost(cachedL);
      setLoading(false);
      return;
    }
    if (!cachedB || !cachedL) setLoading(true);
    try {
      const [b, l] = await Promise.all([fetchMaterialBalances(force), fetchLost(codes, lostFilter, force)]);
      setBal(b); setLost(l); setErr('');
    } catch (e) {
      const m = cleanMaterialError(e); setErr(isMaterialsMissing(m) ? 'SETUP' : m); setBal((x) => x || []); setLost((x) => x || []);
    } finally { setLoading(false); }
  }, [codes, lostFilter]);

  // Load serials for this product's materials
  const loadSerials = useCallback(async (force = false) => {
    try {
      const queryCodes = selectedCode === 'ALL' ? codes : [selectedCode];
      const p = await fetchSerialsPage({
        codes: queryCodes,
        status: statusFilter,
        branchId: branchFilter || undefined,
        search,
        page: 1,
        pageSize: 1000,
      }, force);
      setDbSerials(p.rows);
    } catch {
      setDbSerials((prev) => prev || []);
    }
  }, [codes, selectedCode, statusFilter, branchFilter, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadSerials(countsKey > 0); }, [loadSerials, countsKey]);

  useEffect(() => {
    let alive = true;
    const queryCodes = selectedCode === 'ALL' ? codes : [selectedCode];
    fetchSerialStatusCounts(queryCodes, branchFilter || undefined, countsKey > 0)
      .then((c) => { if (alive) setCounts(c); })
      .catch(() => {});
    return () => { alive = false; };
  }, [codes, selectedCode, branchFilter, countsKey]);

  const changed = () => {
    clearMaterialsCache();
    setCountsKey((k) => k + 1);
    load(true);
    onLostChanged?.();
  };

  // Combine DB serials and device-derived serials
  const combinedItems = useMemo(() => {
    const list: MaterialSerial[] = [...(dbSerials || [])];
    const seen = new Set((dbSerials || []).map((r) => `${r.code}|${r.serial.toUpperCase()}`));

    for (let i = 0; i < deviceDerivedItems.length; i++) {
      const item = deviceDerivedItems[i];
      // Only include if matches active code filter
      if (selectedCode !== 'ALL' && item.code !== selectedCode) continue;
      // Only include if matches active status filter
      if (statusFilter && item.status !== statusFilter) continue;
      // Only include if matches active branch filter
      if (branchFilter && item.branchId !== branchFilter) continue;

      const key = `${item.code}|${item.serial.toUpperCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        list.push(item);
      }
    }

    // Apply search filter to derived items as well
    if (!search) return list;
    const sLow = search.toLowerCase();
    return list.filter((r) => {
      const dev = r.deviceSerial ? deviceMap.get(r.deviceSerial.toUpperCase()) : undefined;
      return (
        r.serial.toLowerCase().includes(sLow) ||
        (r.deviceSerial && r.deviceSerial.toLowerCase().includes(sLow)) ||
        (r.mid && r.mid.toLowerCase().includes(sLow)) ||
        (r.merchantName && r.merchantName.toLowerCase().includes(sLow)) ||
        (dev?.merchantName && dev.merchantName.toLowerCase().includes(sLow)) ||
        (r.updatedBy && r.updatedBy.toLowerCase().includes(sLow)) ||
        placeName(r.branchId, branches).toLowerCase().includes(sLow)
      );
    });
  }, [dbSerials, deviceDerivedItems, selectedCode, statusFilter, branchFilter, search, deviceMap, branches]);

  // Status counts across all loaded items
  const dynamicStatusCounts = useMemo(() => {
    const res: Record<SerialStatus, number> = {
      HQ_STOCK: 0, IN_TRANSIT: 0, BRANCH_RESERVE: 0, AT_MERCHANT: 0, LOST: 0, FAULTY: 0, WRITTEN_OFF: 0,
    };
    if (counts) {
      Object.assign(res, counts);
    }
    // Also add device-derived items to counts when on BATTERY or ALL
    if (selectedCode === 'ALL' || selectedCode === 'BATTERY') {
      const seen = new Set((dbSerials || []).map((r) => `${r.code}|${r.serial.toUpperCase()}`));
      for (let i = 0; i < deviceDerivedItems.length; i++) {
        const item = deviceDerivedItems[i];
        if (branchFilter && item.branchId !== branchFilter) continue;
        const key = `${item.code}|${item.serial.toUpperCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          res[item.status]++;
        }
      }
    }
    return res;
  }, [counts, dbSerials, deviceDerivedItems, selectedCode, branchFilter]);

  const totalAllItems = useMemo(
    () => Object.values(dynamicStatusCounts).reduce((a, b) => a + b, 0),
    [dynamicStatusCounts]
  );

  // Pagination for the detailed table
  const pg = usePager(combinedItems.length, [selectedCode, statusFilter, branchFilter, search]);
  const displayedItems = useMemo(
    () => combinedItems.slice(pg.start, pg.end),
    [combinedItems, pg.start, pg.end]
  );

  // Location cell mapping for the location summary table
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

  const exportSummaryCsv = () => {
    downloadCsv(`${group === 'POS' ? 'pos' : 'sound-box'}-material-stock`, ['Location', ...mats.map((m) => m.name)],
      places.map((id) => [placeName(id, branches), ...codes.map((c) => cell.get(`${c}|${id}`)?.onHand || 0)]));
    triggerToast(`Saved ${places.length} location(s).`);
  };

  const exportDetailedInventoryCsv = () => {
    const list = combinedItems;
    downloadCsv(
      `${group === 'POS' ? 'pos' : 'sound-box'}-materials-inventory`,
      [
        'Item / Serial Number', 'Material Type', 'Status', 'Assigned Device Serial',
        'Merchant Name', 'MID', 'Date of Deployment', 'Branch Staff', 'Branch Name', 'Updated At', 'Updated By'
      ],
      list.map((s) => {
        const dev = s.deviceSerial ? deviceMap.get(s.deviceSerial.toUpperCase()) : undefined;
        const merchantName = s.merchantName || dev?.merchantName || '';
        const mid = s.mid || dev?.mid || '';
        const deployedDate = dev?.deployedDate || (s.status === 'AT_MERCHANT' && s.updatedAt ? fmtDay(s.updatedAt) : '');
        const branchStaff = dev?.staff || dev?.installedByStaff || (s.status === 'AT_MERCHANT' ? s.updatedBy : '') || '';
        const branchName = dev?.branchName || placeName(s.branchId, branches);

        return [
          s.serial,
          materialName(s.code),
          SERIAL_STATUS_LABEL[s.status],
          s.deviceSerial || '',
          merchantName,
          mid,
          deployedDate,
          branchStaff,
          branchName,
          csvTime(s.updatedAt),
          s.updatedBy,
        ];
      })
    );
    triggerToast(`Saved ${list.length} material item(s).`);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedSerial(text);
    setTimeout(() => setCopiedSerial(null), 1800);
  };

  const getMaterialIcon = (code: MaterialCode) => {
    switch (code) {
      case 'BATTERY': return <Battery className="w-3.5 h-3.5 text-amber-600 shrink-0" />;
      case 'STAND': return <Smartphone className="w-3.5 h-3.5 text-indigo-600 shrink-0" />;
      case 'DOCK': return <Dock className="w-3.5 h-3.5 text-sky-600 shrink-0" />;
      case 'POS_ADAPTOR': return <Plug className="w-3.5 h-3.5 text-slate-600 shrink-0" />;
      case 'SB_ADAPTOR': return <Plug className="w-3.5 h-3.5 text-purple-600 shrink-0" />;
      default: return <Package className="w-3.5 h-3.5 text-slate-600 shrink-0" />;
    }
  };

  const getMaterialBadge = (code: MaterialCode) => {
    const name = materialName(code);
    switch (code) {
      case 'BATTERY':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-xs font-bold bg-amber-50 text-amber-900 border border-amber-200 shadow-2xs">
            <Battery className="w-3.5 h-3.5 text-amber-600" />
            <span>{name}</span>
          </span>
        );
      case 'STAND':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-xs font-bold bg-indigo-50 text-indigo-900 border border-indigo-200 shadow-2xs">
            <Smartphone className="w-3.5 h-3.5 text-indigo-600" />
            <span>{name}</span>
          </span>
        );
      case 'DOCK':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-xs font-bold bg-sky-50 text-sky-900 border border-sky-200 shadow-2xs">
            <Dock className="w-3.5 h-3.5 text-sky-600" />
            <span>{name}</span>
          </span>
        );
      case 'POS_ADAPTOR':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-800 border border-slate-200 shadow-2xs">
            <Plug className="w-3.5 h-3.5 text-slate-600" />
            <span>{name}</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-800 border border-slate-200 shadow-2xs">
            <Package className="w-3.5 h-3.5 text-slate-600" />
            <span>{name}</span>
          </span>
        );
    }
  };

  if (err === 'SETUP') return <MaterialsSetupNotice />;

  return (
    <div className="flex flex-col gap-4">
      {/* 1. TOP HERO BANNER & CONTROL HUB (SIM Card Tab Style) */}
      <section className="relative overflow-hidden rounded-3xl p-6 sm:p-7 border shadow-sm bg-slate-100 border-slate-200/90" aria-label="POS Materials Hub">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-1.5 max-w-3xl">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight flex items-center gap-3 text-slate-900">
              <Boxes className="w-7 h-7 text-[#003857]" aria-hidden />
              <span>{group === 'POS' ? 'POS Terminal Materials Control Hub' : 'Sound Box Materials Control Hub'}</span>
            </h1>
            <p className="text-sm sm:text-base text-slate-600">
              {group === 'POS'
                ? 'Individual inventory tracking, terminal assignments, and branch custody for Batteries, Stand Holders, Charging Docks, and AC Adaptors.'
                : 'Accessories and cables for Sound Box hardware across Head Office, branch reserves, and active deployments.'}
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
                Stock In
              </button>
            )}
            {isAdmin && (
              <button type="button" className={btnLight} onClick={() => setDlg('ADJUST')}>
                <PencilLine className="w-4 h-4" />
                Correct
              </button>
            )}
            {isAdmin && (
              <button type="button" className={btnLight} onClick={() => setDlg('OPENING')}>
                <Upload className="w-4 h-4" />
                Opening stock
              </button>
            )}
            <button
              type="button"
              className={btnLight}
              onClick={exportDetailedInventoryCsv}
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

        {/* Status Filter Pills (Sim Card Tab Style) */}
        <div className="flex flex-wrap gap-2 mt-5 pt-5 border-t border-slate-200/90" role="group" aria-label="Status">
          <button
            type="button"
            onClick={() => setStatusFilter('')}
            aria-pressed={statusFilter === ''}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border cursor-pointer transition ${
              statusFilter === '' ? 'bg-[#003857] text-white border-[#003857]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            All <span className="tabular-nums opacity-80 ml-1">{totalAllItems?.toLocaleString() ?? '—'}</span>
          </button>
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              aria-pressed={statusFilter === s}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border cursor-pointer transition ${
                statusFilter === s ? 'bg-[#003857] text-white border-[#003857]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {SERIAL_STATUS_LABEL[s]}{' '}
              <span className="tabular-nums opacity-80 ml-1">
                {dynamicStatusCounts[s]?.toLocaleString() ?? '0'}
              </span>
            </button>
          ))}
        </div>

        {/* Material Type Selector Tabs (Sim Card Tab Style) */}
        <div className="flex flex-wrap items-center justify-between gap-3 mt-3.5 pt-3.5 border-t border-slate-200/90">
          <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-200/80 rounded-2xl" role="group" aria-label="Select Material Category">
            <button
              type="button"
              aria-pressed={selectedCode === 'ALL'}
              onClick={() => setSelectedCode('ALL')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                selectedCode === 'ALL'
                  ? 'bg-[#003857] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/70'
              }`}
            >
              <Boxes className="w-3.5 h-3.5" />
              <span>All Items</span>
              <span className={`text-[10.5px] px-1.5 py-0.2 rounded-full tabular-nums ${selectedCode === 'ALL' ? 'bg-white/20 text-white' : 'bg-slate-300 text-slate-700'}`}>
                {combinedItems.length}
              </span>
            </button>

            {codes.map((c) => {
              const isSelected = selectedCode === c;
              const count = combinedItems.filter((i) => i.code === c).length;
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setSelectedCode(c)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-[#003857] text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/70'
                  }`}
                >
                  {getMaterialIcon(c)}
                  <span>{materialName(c)}</span>
                  <span className={`text-[10.5px] px-1.5 py-0.2 rounded-full tabular-nums ${isSelected ? 'bg-white/20 text-white' : 'bg-slate-300 text-slate-700'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <span className="text-xs text-slate-500 font-medium">
            Showing <strong className="text-slate-800">{combinedItems.length}</strong> {selectedCode === 'ALL' ? 'total items' : materialName(selectedCode)}
          </span>
        </div>
      </section>

      {/* 2. KPI METRIC SUMMARY CARDS */}
      <section className={`grid grid-cols-2 gap-3.5 ${codes.length >= 4 ? 'lg:grid-cols-5' : 'lg:grid-cols-3'}`} aria-label="Material totals">
        {totals.map((t) => {
          const isSelected = selectedCode === t.code;
          return (
            <div
              key={t.code}
              onClick={() => setSelectedCode(isSelected ? 'ALL' : t.code)}
              className={`cursor-pointer transition-all active:scale-[0.98] rounded-2xl ${isSelected ? 'ring-2 ring-[#003857] shadow-sm' : ''}`}
            >
              <Kpi
                icon={t.code === 'BATTERY' ? Battery : t.code === 'STAND' ? Smartphone : t.code === 'DOCK' ? Dock : Plug}
                label={materialName(t.code)}
                value={bal ? t.hq + t.branches : undefined}
                sub={`HQ ${t.hq.toLocaleString()} · branches ${t.branches.toLocaleString()}${t.transit ? ` · ${t.transit} in transit` : ''}`}
              />
            </div>
          );
        })}
        <div
          onClick={() => setStatusFilter(statusFilter === 'LOST' ? '' : 'LOST')}
          className={`cursor-pointer transition-all active:scale-[0.98] rounded-2xl ${statusFilter === 'LOST' ? 'ring-2 ring-rose-600 shadow-sm' : ''}`}
        >
          <Kpi
            icon={AlertTriangle}
            label="Lost, open"
            value={lost ? openLost : undefined}
            tone={openLost ? 'bad' : undefined}
            sub="reported at returns and replacements"
          />
        </div>
      </section>

      {/* 3. DEDICATED POS MATERIALS TABLE CONTROL (SIM Card Tab Style) */}
      <section className="bg-white rounded-3xl border border-slate-200/90 shadow-sm overflow-hidden" aria-label="POS Materials Inventory Table">
        {/* Table Toolbar: Search & Location Filter */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-slate-50/50">
          <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[280px]">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search serial, POS terminal, MID, merchant or staff..."
                className="w-full pl-9 pr-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs sm:text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-[#003857] focus:ring-2 focus:ring-[#003857]/10 transition"
              />
            </div>

            {isAdmin && (
              <div className="min-w-[160px]">
                <select
                  value={branchFilter}
                  onChange={(e) => setBranchFilter(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs sm:text-sm text-slate-800 outline-none focus:border-[#003857] transition"
                >
                  <option value="">All locations</option>
                  <option value="100">Head Office</option>
                  {branches.filter((b) => b.id !== '100').map((b) => (
                    <option key={b.id} value={b.id}>{b.id} · {b.name}</option>
                  ))}
                </select>
              </div>
            )}

            <ClearFiltersButton
              active={Boolean(query.trim() || statusFilter || (isAdmin && branchFilter) || selectedCode !== 'ALL')}
              onClear={() => {
                setQuery('');
                setStatusFilter('');
                if (isAdmin) setBranchFilter('');
                setSelectedCode('ALL');
              }}
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">
              {displayedItems.length} of {combinedItems.length} items shown
            </span>
          </div>
        </div>

        {/* Main Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm text-left">
            <thead>
              <tr className="bg-[#003857] text-white text-[10.5px] uppercase tracking-wider font-extrabold select-none">
                <th className="px-4 py-3 text-center w-12">No.</th>
                <th className="px-4 py-3">Item / Serial Number</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Material Type</th>
                <th className="px-4 py-3">Assigned POS Terminal</th>
                <th className="px-4 py-3">Merchant / MID</th>
                <th className="px-4 py-3">Deployment Date</th>
                <th className="px-4 py-3">Branch Staff</th>
                <th className="px-4 py-3">Branch Name</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {displayedItems.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2 max-w-sm mx-auto">
                      <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400">
                        <Boxes className="w-5 h-5 text-slate-400" />
                      </div>
                      <p className="font-bold text-slate-700 text-sm">No material items found</p>
                      <p className="text-xs text-slate-500">
                        {query || statusFilter || branchFilter || selectedCode !== 'ALL'
                          ? 'Try clearing active filters or modifying search keywords.'
                          : 'No items recorded yet. Click "Stock In" above to register new items into inventory.'}
                      </p>
                    </div>
                  </td>
                </tr>
              )}

              {displayedItems.map((s, idx) => {
                const dev = s.deviceSerial ? deviceMap.get(s.deviceSerial.toUpperCase()) : undefined;
                const merchantName = s.merchantName || dev?.merchantName || '—';
                const mid = s.mid || dev?.mid || '';
                const deployedDate = dev?.deployedDate || (s.status === 'AT_MERCHANT' && s.updatedAt ? fmtDay(s.updatedAt) : '—');
                const branchStaff = dev?.staff || dev?.installedByStaff || (s.status === 'AT_MERCHANT' ? s.updatedBy : '') || '—';
                const branchName = dev?.branchName || placeName(s.branchId, branches);

                return (
                  <tr key={`${s.code}-${s.serial}-${idx}`} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-2.5 text-center font-mono text-slate-400 font-semibold">
                      {pg.start + idx + 1}
                    </td>

                    <td className="px-4 py-2.5 font-mono font-bold text-slate-800">
                      <div className="flex items-center gap-1.5">
                        <span className="select-all">{s.serial}</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(s.serial)}
                          title="Copy serial"
                          className="text-slate-400 hover:text-slate-700 p-0.5 rounded cursor-pointer"
                        >
                          {copiedSerial === s.serial ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                    </td>

                    <td className="px-4 py-2.5">
                      <StatusPill status={s.status} />
                    </td>

                    <td className="px-4 py-2.5">
                      {getMaterialBadge(s.code)}
                    </td>

                    <td className="px-4 py-2.5 font-mono font-semibold">
                      {s.deviceSerial ? (
                        <span className="inline-flex items-center gap-1 text-[#006BA6] bg-[#006BA6]/10 px-2 py-0.5 rounded-md border border-[#006BA6]/20">
                          <Cpu className="w-3 h-3" />
                          <span>{s.deviceSerial}</span>
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">Unassigned Pool</span>
                      )}
                    </td>

                    <td className="px-4 py-2.5">
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-800 truncate max-w-[170px]" title={merchantName}>
                          {merchantName}
                        </span>
                        {mid && <span className="font-mono text-[10.5px] text-slate-400">MID: {mid}</span>}
                      </div>
                    </td>

                    <td className="px-4 py-2.5 font-mono text-slate-600">
                      {deployedDate}
                    </td>

                    <td className="px-4 py-2.5 font-medium text-slate-700">
                      {branchStaff}
                    </td>

                    <td className="px-4 py-2.5 text-slate-600 truncate max-w-[150px]" title={branchName}>
                      {branchName}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pager */}
        <div className="p-3.5 border-t border-slate-100 bg-slate-50/50">
          <Pager pg={pg} />
        </div>
      </section>

      {/* 4. STOCK BY LOCATION BREAKDOWN (PRESERVED FOR AUDIT & E2E INTEGRITY) */}
      <section className="fr-table-frame bg-white rounded-3xl border border-slate-200/90 shadow-2xs overflow-hidden" aria-label="Stock per location">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2.5 bg-slate-50/70">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-slate-900">Stock per Location Distribution</h3>
            <span className="text-xs text-slate-400">({places.length} active locations)</span>
          </div>
          <div className="flex items-center gap-3">
            {isAdmin && (
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none">
                <input type="checkbox" checked={onlyStock} onChange={(e) => setOnlyStock(e.target.checked)} className="rounded" /> Only locations with stock
              </label>
            )}
            <button type="button" className={btnLight} onClick={exportSummaryCsv}><Download className="w-3.5 h-3.5" />Export Location Matrix</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-[#003857] text-white text-[11px] uppercase tracking-wider">
                <th className="text-left font-medium px-3.5 py-2.5">Location</th>
                {mats.map((m) => <th key={m.code} className="text-right font-medium px-3.5 py-2.5">{m.name}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {bal === null && <tr><td colSpan={mats.length + 1} className="px-3.5 py-6"><div className="skeleton h-4 rounded w-1/2" /></td></tr>}
              {bal !== null && places.length === 0 && <tr><td colSpan={mats.length + 1} className="px-3.5 py-8 text-center text-slate-500">No location holds {group === 'POS' ? 'POS' : 'Sound Box'} materials yet.</td></tr>}
              {bal !== null && places.map((id) => (
                <tr key={id} className={id === '100' ? 'bg-sky-50/40 font-medium' : 'hover:bg-slate-50/70'}>
                  <td className="px-3.5 py-2.5 font-medium text-slate-800">{placeName(id, branches)}</td>
                  {codes.map((c) => {
                    const b = cell.get(`${c}|${id}`);
                    return (
                      <td key={c} className="px-3.5 py-2.5 text-right tabular-nums">
                        <span className={b?.onHand ? 'font-semibold text-slate-900' : 'text-slate-400'}>{(b?.onHand || 0).toLocaleString()}</span>
                        {b?.inTransit ? <span className="block text-[10.5px] text-indigo-700 font-semibold">{b.inTransit} in transit</span> : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 5. LOST ITEMS TABLE */}
      <LostTable title={`Lost · ${group === 'POS' ? 'POS Terminal' : 'Sound Box'} material`} rows={lost} branches={branches} isAdmin={isAdmin}
        filter={lostFilter} onFilter={setLostFilter} onChanged={changed} triggerToast={triggerToast} />

      {/* Dialogs */}
      <StockInDialog open={dlg === 'IN'} codes={codes} branches={branches} onClose={() => setDlg('')} onDone={changed} triggerToast={triggerToast} />
      <AdjustDialog open={dlg === 'ADJUST'} codes={codes} branches={branches} onClose={() => setDlg('')} onDone={changed} triggerToast={triggerToast} />
      <OpeningDialog open={dlg === 'OPENING'} branches={branches} onClose={() => setDlg('')} onDone={changed} triggerToast={triggerToast} />
    </div>
  );
};

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
        <div className="relative inline-flex p-0.5 rounded-lg bg-slate-100 border border-slate-200 text-xs font-semibold">
          {([['OPEN', 'Open'], ['', 'All']] as const).map(([v, l]) => {
            const isSelected = filter === v;
            return (
              <motion.button
                key={l}
                type="button"
                whileTap={{ scale: 0.97 }}
                onClick={() => onFilter(v)}
                aria-pressed={isSelected}
                className="relative px-3 py-1 rounded-md cursor-pointer select-none transition-colors duration-150"
              >
                {isSelected && (
                  <motion.div
                    layoutId="active-lost-filter-pill"
                    className="absolute inset-0 rounded-md bg-white shadow-2xs z-0 pointer-events-none"
                    transition={{ type: 'spring', stiffness: 500, damping: 35, mass: 0.55 }}
                  />
                )}
                <span className={`relative z-10 ${isSelected ? 'text-slate-900 font-bold' : 'text-slate-500 hover:text-slate-800'}`}>
                  {l}
                </span>
              </motion.button>
            );
          })}
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

export const StockInDialog: React.FC<{
  open: boolean;
  codes: MaterialCode[];
  branches: Branch[];
  initialTarget?: 'ALL' | 'POS' | 'SOUND_BOX';
  onClose: () => void;
  onDone: () => void;
  triggerToast: (m: string) => void;
}> = ({
  open, codes, branches, initialTarget = 'ALL', onClose, onDone, triggerToast,
}) => {
  const [code, setCode] = useState<MaterialCode>(codes[0]);
  const [place, setPlace] = useState('100');
  const [qty, setQty] = useState('');
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [targetDevice, setTargetDevice] = useState<'ALL' | 'POS' | 'SOUND_BOX'>(initialTarget);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setCode(codes[0]);
      setPlace('100');
      setQty('');
      setText('');
      setNote('');
      setTargetDevice(initialTarget);
    }
  }, [open, codes, initialTarget]);
  const m = materialByCode.get(code)!;
  const nums = m.tracking === 'SERIAL' ? parseNumbers(code, text) : { ok: [], bad: [] };
  const ready = m.tracking === 'QTY' ? Number(qty) > 0 : nums.ok.length > 0;
  const save = async () => {
    setBusy(true);
    try {
      let finalNote = note.trim();
      if (code === 'SIM') {
        if (targetDevice === 'POS') {
          finalNote = finalNote ? `[Target: POS Terminal] ${finalNote}` : '[Target: POS Terminal]';
        } else if (targetDevice === 'SOUND_BOX') {
          finalNote = finalNote ? `[Target: Sound Box] ${finalNote}` : '[Target: Sound Box]';
        }
      }
      const r = await materialStockIn(m.tracking === 'QTY' ? { code, branch_id: place, qty: Math.floor(Number(qty)), note: finalNote } : { code, branch_id: place, serials: nums.ok, note: finalNote });
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
      {code === 'SIM' && (
        <label className={labelCls}>Target Device Type
          <select
            className={inputCls}
            value={targetDevice}
            onChange={(e) => setTargetDevice(e.target.value as 'ALL' | 'POS' | 'SOUND_BOX')}
          >
            <option value="ALL">All / Shared Pool (Can be used for POS or Sound Box)</option>
            <option value="POS">POS Terminal Only (Dedicated for POS)</option>
            <option value="SOUND_BOX">Sound Box Only (Dedicated for Sound Box)</option>
          </select>
        </label>
      )}
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

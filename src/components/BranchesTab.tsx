import { createPortal } from 'react-dom';
import { ClearFiltersButton } from './ClearFiltersButton';
import { usePager } from '../utils/usePager';
import { Pager } from './Pager';
import { useSort, SortTh } from '../utils/sort';
import { csvFile } from '../utils/csv';
import { todayPP } from '../utils/time';
import React, { useState, useMemo, useDeferredValue } from 'react';
import { Branch, Device, User, UserRole, ThemeMode } from '../types';
import { STAGE_META } from '../data/initialData';
import { motion, AnimatePresence } from 'motion/react';
import {
  Building2,
  MapPin,
  Users,
  Search,

  Edit3,
  AlertTriangle,
  ArrowUpRight,
  LayoutGrid,
  List,
  X,
  Smartphone,
  Cpu,
  Volume2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Package,
} from 'lucide-react';
import { fmtNum } from '../utils/format';

interface BranchesTabProps {
  branches: Branch[];
  devices: Device[];
  users: User[];
  role: UserRole;
  theme?: ThemeMode;
  onSelectBranchFilter: (branchCode: string) => void;
  onOpenNewBranchModal?: () => void;
  onOpenEditBranchModal: (branch: Branch) => void;
  onSelectDevice?: (serial: string) => void;
}

export const BranchesTab: React.FC<BranchesTabProps> = ({
  branches,
  devices,
  users,
  role,
  onSelectBranchFilter,
  onOpenNewBranchModal: _onOpenNewBranchModal,
  theme = 'dark',
  onOpenEditBranchModal,
  onSelectDevice,
}) => {
  const isLight = theme === 'light';
  const [searchQuery, setSearchQuery] = useState('');
  const deferredQuery = useDeferredValue(searchQuery);                 // typing stays instant; the list follows a moment later
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'LOW_RESERVE' | 'HEALTHY'>('ALL');
  const [displayLayout, setDisplayLayout] = useState<'TABLE' | 'GRID'>('TABLE');
  const [expandedBranchCode, setExpandedBranchCode] = useState<string | null>(null);
  const [inspectedBranchCode, setInspectedBranchCode] = useState<string | null>(null);

  const isAdminLike = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const activeDevices = useMemo(
    () => devices.filter((d) => !d.archived),
    [devices]
  );

  // High-Throughput Branch Aggregation: Single pass over activeDevices
  const { branchDataMap, metrics } = useMemo(() => {
    interface BranchAccumulator {
      posCount: number;
      sbCount: number;
      hqCount: number;
      reserveCount: number;
      completeCount: number;
      inFlightCount: number;
      faultyCount: number;
      totalDevices: number;
      sampleDevices: Device[];
    }

    const bMap = new Map<string, BranchAccumulator>();
    for (let i = 0; i < branches.length; i++) {
      const acc: BranchAccumulator = {
        posCount: 0,
        sbCount: 0,
        hqCount: 0,
        reserveCount: 0,
        completeCount: 0,
        inFlightCount: 0,
        faultyCount: 0,
        totalDevices: 0,
        sampleDevices: [],
      };
      if (branches[i].code) bMap.set(String(branches[i].code).trim(), acc);
      if (branches[i].id) bMap.set(String(branches[i].id).trim(), acc);
    }

    let totalDevices = 0;
    let totalReserve = 0;
    let totalLive = 0;
    let totalPos = 0;
    let totalSb = 0;
    let totalHq = 0;

    const len = activeDevices.length;
    for (let i = 0; i < len; i++) {
      const d = activeDevices[i];
      const acc = bMap.get(String(d.branchId || '').trim());
      if (!acc) continue;

      acc.totalDevices++;
      totalDevices++;

      if (d.type === 'POS Terminal') { acc.posCount++; totalPos++; }
      else if (d.type === 'Sound Box') { acc.sbCount++; totalSb++; }

      if (d.stage === 'HQ_STOCK') {
        acc.hqCount++;
        totalHq++;
      } else if (d.stage === 'BRANCH_RESERVE') {
        acc.reserveCount++;
        totalReserve++;
      } else if (d.stage === 'COMPLETE') {
        acc.completeCount++;
        totalLive++;
      } else if (d.stage === 'CONFIGURING') {
        acc.inFlightCount++;
      } else if (d.stage === 'FAULTY') {
        acc.faultyCount++;
      }

      // Keep sample devices for drawer preview without bloating memory
      if (acc.sampleDevices.length < 100) {
        acc.sampleDevices.push(d);
      }
    }

    let totalStaff = 0;
    let lowReserveCount = 0;
    for (let i = 0; i < branches.length; i++) {
      const b = branches[i];
      const acc = bMap.get(b.code);
      const res = acc ? acc.reserveCount : 0;
      const staffFromDir = users.filter(
        (u) =>
          (String(u.branchId).trim() === String(b.code).trim() ||
           String(u.branchId).trim() === String(b.id).trim()) &&
          u.status !== 'Suspended'
      );
      const sCount = staffFromDir.length || (b.staff || []).length;
      totalStaff += sCount;
      if (b.code !== '100' && res < 1) lowReserveCount++;
    }

    return {
      branchDataMap: bMap,
      metrics: {
        totalBranches: branches.length,
        totalDevices,
        totalReserve,
        totalLive,
        totalPos,
        totalSb,
        totalStaff,
        totalHq,
        lowReserveCount,
      },
    };
  }, [branches, activeDevices, users]);

  const matchedBranches = useMemo(() => {
    return branches
      .map((b) => {
        const codeKey = String(b.code || '').trim();
        const idKey = String(b.id || '').trim();
        const acc = branchDataMap.get(codeKey) || (idKey ? branchDataMap.get(idKey) : undefined) || {
          posCount: 0,
          sbCount: 0,
          hqCount: 0,
          reserveCount: 0,
          completeCount: 0,
          inFlightCount: 0,
          faultyCount: 0,
          totalDevices: 0,
          sampleDevices: [],
        };
        const staffList = users.filter(
          (u) =>
            (String(u.branchId).trim() === String(b.code).trim() ||
             String(u.branchId).trim() === String(b.id).trim()) &&
            u.status !== 'Suspended'
        );
        const lowReserve = b.code !== '100' && acc.reserveCount < 1;

        return {
          ...b,
          devices: acc.sampleDevices,
          totalDevices: acc.totalDevices,
          posCount: acc.posCount,
          sbCount: acc.sbCount,
          hqCount: acc.hqCount,
          reserveCount: acc.reserveCount,
          completeCount: acc.completeCount,
          inFlightCount: acc.inFlightCount,
          faultyCount: acc.faultyCount,
          staffCount: staffList.length || (b.staff || []).length,
          staffList,
          lowReserve,
        };
      })
      .filter((b) => {
        // Status filter
        if (statusFilter === 'LOW_RESERVE' && !b.lowReserve) return false;
        if (statusFilter === 'HEALTHY' && b.lowReserve) return false;

        // Search query
        if (!deferredQuery.trim()) return true;
        const q = deferredQuery.toLowerCase();
        return (
          b.code.toLowerCase().includes(q) ||
          b.name.toLowerCase().includes(q) ||
          (b.staff && b.staff.some((s) => s.toLowerCase().includes(q))) ||
          b.staffList.some((u) => u.name.toLowerCase().includes(q) || (u.empId && u.empId.toLowerCase().includes(q)))
        );
      });
  }, [branches, branchDataMap, users, deferredQuery, statusFilter]);
  const { sorted: enrichedBranches, sort: brSort, toggle: brToggle } = useSort<(typeof matchedBranches)[number]>(matchedBranches, {
    code: (b) => Number(b.code) || b.code, name: (b) => b.name, pos: (b) => b.posCount, sb: (b) => b.sbCount, total: (b) => b.totalDevices,
    reserve: (b) => b.reserveCount, live: (b) => b.completeCount, staff: (b) => b.staffCount, status: (b) => (b.lowReserve ? 1 : 0),
  });

  const pg = usePager(enrichedBranches.length, [searchQuery, statusFilter, brSort]);
  const pagedBranches = useMemo(() => enrichedBranches.slice(pg.start, pg.end), [enrichedBranches, pg.start, pg.end]);

  const inspectedBranch = useMemo(
    () => enrichedBranches.find((b) => b.code === inspectedBranchCode) || null,
    [enrichedBranches, inspectedBranchCode]
  );

  const handleExportCsv = () => {
    const headers = [
      'No.',
      'Branch Code',
      'Branch Name',
      'POS Terminal',
      'Sound Box',
      'Total Units',
      'Branch Reserve',
      'HQ Stock',
      'Live Installed',
      'Staff Officers',
      'Reserve Status',
    ];
    const rows = enrichedBranches.map((b, idx) => [
      String(idx + 1),
      b.code,
      b.name,
      String(b.posCount),
      String(b.sbCount),
      String(b.totalDevices),
      String(b.reserveCount),
      String(b.hqCount || 0),
      String(b.completeCount),
      String(b.staffCount),
      b.lowReserve ? 'Low Reserve Alert' : 'Healthy',
    ]);
    const url = URL.createObjectURL(csvFile([headers, ...rows]));
    const link = document.createElement('a');
    link.href = url;
    link.download = `Branch_Codes_Inventory_Table_${todayPP()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-5">
      {/* KPI Overview Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="surface-card p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-zinc-100 text-zinc-800 border border-zinc-200 flex items-center justify-center shrink-0">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[10px] font-extrabold uppercase text-slate-500 tracking-wider">
              Connected Branches
            </div>
            <div className="text-lg font-black font-figure text-zinc-900">
              {metrics.totalBranches}
            </div>
            <div className="text-[10px] text-slate-400">Nationwide Network</div>
          </div>
        </div>

        <div className="surface-card p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 flex items-center justify-center shrink-0">
            <Package className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[10px] font-extrabold uppercase text-slate-500 tracking-wider">
              Total Hardware Units
            </div>
            <div className="text-lg font-black font-figure text-zinc-900">
              {fmtNum(metrics.totalDevices)}
            </div>
            <div className="text-[10px] text-slate-400">
              {fmtNum(metrics.totalPos)} POS · {fmtNum(metrics.totalSb)} SB
            </div>
          </div>
        </div>

        <div className="surface-card p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 flex items-center justify-center shrink-0">
            <Smartphone className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[10px] font-extrabold uppercase text-slate-500 tracking-wider">
              Branch Reserves
            </div>
            <div className="text-lg font-black font-figure text-zinc-900">
              {fmtNum(metrics.totalReserve)}
            </div>
            <div className="text-[10px] text-slate-400">
              {metrics.totalHq > 0
                ? `Ready for Merchant (${fmtNum(metrics.totalHq)} HQ)`
                : 'Ready for Merchant'}
            </div>
          </div>
        </div>

        <div className="surface-card p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[10px] font-extrabold uppercase text-slate-500 tracking-wider">
              Live Installed
            </div>
            <div className="text-lg font-black font-figure text-emerald-700">
              {fmtNum(metrics.totalLive)}
            </div>
            <div className="text-[10px] text-slate-400">
              {metrics.totalDevices > 0
                ? `${Math.round((metrics.totalLive / metrics.totalDevices) * 100)}% deployed`
                : '0% deployed'}
            </div>
          </div>
        </div>

        <div className="surface-card p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3 col-span-2 sm:col-span-1">
          <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[10px] font-extrabold uppercase text-slate-500 tracking-wider">
              Assigned Staff
            </div>
            <div className="text-lg font-black font-figure text-slate-800">
              {fmtNum(metrics.totalStaff)}
            </div>
            <div className="text-[10px] text-slate-400">Branch Field Officers</div>
          </div>
        </div>
      </div>

      {/* Main Table Card */}
      <div className="surface-card shadow-md rounded-2xl overflow-hidden border border-slate-200/80">
        {/* Controls Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200/80 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-[#003857] text-white flex items-center justify-center shadow-xs shrink-0">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-extrabold tracking-tight text-zinc-900">
                  Branch Codes Inventory Table
                </h2>
                <span className="text-xs font-mono font-bold text-slate-500">
                  · {enrichedBranches.length} Branches
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Device unit breakdown, deployable reserves, and active merchant installations by branch
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <ClearFiltersButton active={!!searchQuery || statusFilter !== 'ALL'} onClear={() => { setSearchQuery(''); setStatusFilter('ALL'); }} />
            {/* Search Input */}
            <div className="relative w-36 sm:w-44 md:w-48">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search code, name, staff..."
                className="w-full pl-8 pr-3 py-2 rounded-lg text-xs font-medium border bg-slate-50 border-slate-200 text-slate-800 focus:bg-white focus:border-zinc-700 outline-none transition"
              />
            </div>

            {/* Filter Pill */}
            <div className="inline-flex rounded-lg border bg-slate-100 p-0.5 border-slate-200 text-xs">
              <button
                type="button"
                onClick={() => setStatusFilter('ALL')}
                className={`px-2.5 py-1.5 rounded-md font-bold transition cursor-pointer text-[11px] ${
                  statusFilter === 'ALL'
                    ? 'bg-[#004953] text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('HEALTHY')}
                className={`px-2.5 py-1.5 rounded-md font-bold transition cursor-pointer text-[11px] ${
                  statusFilter === 'HEALTHY'
                    ? 'bg-white text-emerald-700 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Healthy
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('LOW_RESERVE')}
                className={`px-2.5 py-1.5 rounded-md font-bold transition cursor-pointer text-[11px] flex items-center gap-1 ${
                  statusFilter === 'LOW_RESERVE'
                    ? 'bg-white text-amber-700 shadow-2xs'
                    : 'text-amber-700 hover:text-amber-800'
                }`}
              >
                <span>Low Reserve</span>
                {metrics.lowReserveCount > 0 && (
                  <span className="font-mono font-bold text-[11px]">
                    {metrics.lowReserveCount}
                  </span>
                )}
              </button>
            </div>

            {/* View Switcher: Table (default) vs Cards */}
            <div className="inline-flex p-0.5 rounded-lg border bg-slate-100 border-slate-200">
              <button
                type="button"
                onClick={() => setDisplayLayout('TABLE')}
                className={`px-2.5 py-1.5 rounded-md text-[11px] font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  displayLayout === 'TABLE'
                    ? 'bg-[#004953] text-white shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
                title="Table View (by Branch)"
              >
                <List className="w-3.5 h-3.5" />
                <span>Table</span>
              </button>
              <button
                type="button"
                onClick={() => setDisplayLayout('GRID')}
                className={`px-2.5 py-1.5 rounded-md text-[11px] font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  displayLayout === 'GRID'
                    ? 'bg-[#004953] text-white shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
                title="Cards Grid"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>Cards</span>
              </button>
            </div>

            {/* CSV Export */}
            <button
              type="button"
              onClick={handleExportCsv}
              className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer transition shadow-2xs shrink-0"
              title="Export Branch Codes Table to CSV"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* View Mode 1: Table by Branch (Default) */}
        {displayLayout === 'TABLE' ? (
          <div className="overflow-x-auto">
            <table className="data-table min-w-[980px]">
              <thead className="glass-table-thead text-[11px] font-extrabold uppercase tracking-wider text-white">
                <tr>
                  <th className="py-3 px-3.5 w-10 text-center"><span className="sr-only">Expand</span></th>
                  <th className="py-3 px-3 w-10 text-right">No.</th>
                  <SortTh k="code" sort={brSort} onSort={brToggle} className="py-3 px-3.5">Branch Code</SortTh>
                  <SortTh k="name" sort={brSort} onSort={brToggle} className="py-3 px-3.5">Branch Name</SortTh>
                  <SortTh k="pos" sort={brSort} onSort={brToggle} align="center" className="py-3 px-3.5 text-center">POS Terminal</SortTh>
                  <SortTh k="sb" sort={brSort} onSort={brToggle} align="center" className="py-3 px-3.5 text-center">Sound Box</SortTh>
                  <SortTh k="total" sort={brSort} onSort={brToggle} align="center" className="py-3 px-3.5 text-center">Total Units</SortTh>
                  <SortTh k="reserve" sort={brSort} onSort={brToggle} align="center" className="py-3 px-3.5 text-center">Branch Reserve</SortTh>
                  <SortTh k="live" sort={brSort} onSort={brToggle} align="center" className="py-3 px-3.5 text-center">Live Installed</SortTh>
                  <SortTh k="staff" sort={brSort} onSort={brToggle} align="center" className="py-3 px-3.5 text-center">Staff Officers</SortTh>
                  <SortTh k="status" sort={brSort} onSort={brToggle} align="center" className="py-3 px-3.5 text-center">Reserve Status</SortTh>
                  <th className="py-3 px-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80 text-xs bg-white">
                {enrichedBranches.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="py-12 text-center text-slate-400">
                      <Building2 className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <p className="font-semibold">No branches match your search or filter.</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Try clearing search terms or changing status filter.
                      </p>
                    </td>
                  </tr>
                ) : (
                  pagedBranches.map((b, rowIdx) => {
                    const isExpanded = expandedBranchCode === b.code;
                    const totalUnits = Math.max(b.totalDevices, 1);
                    const completePct = Math.round((b.completeCount / totalUnits) * 100);

                    return (
                      <React.Fragment key={b.code}>
                        <tr
                          className={`hover:bg-slate-50/90 transition-colors ${
                            isExpanded ? 'bg-sky-50/40' : ''
                          }`}
                        >
                          {/* Row expand toggle */}
                          <td className="py-3 px-3.5 text-center">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedBranchCode(isExpanded ? null : b.code)
                              }
                              className="p-1 rounded hover:bg-slate-200/70 text-slate-500 cursor-pointer transition"
                              title={isExpanded ? 'Collapse breakdown' : 'Expand breakdown'}
                            >
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4 text-zinc-800" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                            </button>
                          </td>

                          <td className="py-3 px-3 text-right text-slate-500 tabular-nums">{pg.start + rowIdx + 1}</td>

                          {/* Branch Code */}
                          <td className="py-3 px-3.5 font-mono">
                            <span className="px-2 py-0.5 rounded-md text-xs font-mono bg-zinc-100 text-zinc-900 border border-zinc-200">
                                Code {b.code}
                              </span>
                          </td>

                          {/* Branch Name */}
                          <td className="py-3 px-3.5">
                            <div className="khmer text-zinc-900 text-xs">
                              {b.name}
                            </div>
                            <div className="flex items-center gap-1 text-[10px] text-slate-400 mt-0.5">
                              <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                              <span>Phnom Penh</span>
                            </div>
                          </td>

                          {/* POS Terminal Count */}
                          <td className="py-3 px-3.5 text-center">
                            <div className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-800">
                              <Cpu className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                              <span>{b.posCount}</span>
                            </div>
                          </td>

                          {/* Sound Box Count */}
                          <td className="py-3 px-3.5 text-center">
                            <div className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-800">
                              <Volume2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                              <span>{b.sbCount}</span>
                            </div>
                          </td>

                          {/* Total Unit */}
                          <td className="py-3 px-3.5 text-center">
                            <span className="font-mono text-xs text-zinc-900">
                              {b.totalDevices}
                            </span>
                            <span className="text-[10px] text-slate-400 block font-sans">
                              units
                            </span>
                          </td>

                          {/* Branch Reserve */}
                          <td className="py-3 px-3.5 text-center">
                            {b.code === '100' ? (
                              <div className="inline-flex flex-col items-center">
                                <span
                                  className={`inline-block px-2 py-0.5 rounded-md font-mono text-xs ${
                                    b.reserveCount > 0
                                      ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                      : 'bg-slate-100 text-slate-700 border border-slate-200'
                                  }`}
                                  title={`Branch Reserve: ${b.reserveCount}${b.hqCount > 0 ? ` · HQ Central Stock: ${b.hqCount}` : ''}`}
                                >
                                  {b.reserveCount}
                                </span>
                                {b.hqCount > 0 && (
                                  <span
                                    className="text-[10px] text-sky-700 font-mono font-medium mt-0.5"
                                    title="Central HQ Stock in Warehouse"
                                  >
                                    ({b.hqCount} HQ)
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span
                                className={`inline-block px-2 py-0.5 rounded-md font-mono text-xs ${
                                  b.reserveCount > 0
                                    ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                    : 'bg-red-50 text-red-700 border border-red-200'
                                }`}
                              >
                                {b.reserveCount}
                              </span>
                            )}
                          </td>

                          {/* Live Installed */}
                          <td className="py-3 px-3.5 text-center">
                            <div className="font-mono text-emerald-700 text-xs">
                              {b.completeCount}
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono">
                              {completePct}%
                            </div>
                          </td>

                          {/* Staff Count */}
                          <td className="py-3 px-3.5 text-center">
                            <div className="inline-flex items-center gap-1 font-mono text-slate-700">
                              <Users className="w-3 h-3 text-slate-400" />
                              <span>{b.staffCount}</span>
                            </div>
                          </td>

                          {/* Reserve Status */}
                          <td className="py-3 px-3.5 text-center">
                            {b.lowReserve ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-amber-50 text-amber-800 border border-amber-200">
                                <AlertTriangle className="w-2.5 h-2.5 text-amber-600" />
                                <span>Low Reserve</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-emerald-50 text-emerald-800 border border-emerald-200">
                                <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" />
                                <span>Healthy</span>
                              </span>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-3.5 text-right space-x-1.5 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setInspectedBranchCode(b.code)}
                              className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs transition cursor-pointer"
                              title={`Inspect devices and staff at Branch Code ${b.code}`}
                            >
                              Inspect
                            </button>

                            <button
                              type="button"
                              onClick={() => onSelectBranchFilter(b.code)}
                              className="px-2.5 py-1 rounded-lg bg-[#003857] hover:bg-[#002a42] text-white font-normal text-xs transition inline-flex items-center gap-1 cursor-pointer"
                              title={`Open filtered hardware stock ledger for Branch Code ${b.code}`}
                            >
                              <span>Stock Ledger</span>
                              <ArrowUpRight className="w-3 h-3" />
                            </button>

                            {isAdminLike && (
                              <button
                                type="button"
                                onClick={() => onOpenEditBranchModal(b)}
                                className="p-1.5 rounded-lg border bg-white hover:bg-slate-100 border-slate-200 text-slate-600 transition cursor-pointer inline-flex items-center justify-center align-middle"
                                title={`Edit Branch Code ${b.code}`}
                              >
                                <Edit3 className="w-3 h-3" />
                              </button>
                            )}
                          </td>
                        </tr>

                        {/* Inline Expandable Row Breakdown */}
                        {isExpanded && (
                          <tr className="bg-slate-50/90 border-y border-sky-200/60">
                            <td colSpan={11} className="py-4 px-6">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* Staff Officers Column */}
                                <div className="surface-card p-3.5 rounded-xl border border-slate-200 shadow-2xs">
                                  <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-100">
                                    <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                                      <Users className="w-3.5 h-3.5 text-zinc-700" />
                                      <span>Assigned Staff Officers ({b.staffList.length})</span>
                                    </h4>
                                    <span className="text-[10px] text-slate-400 font-mono">
                                      Branch Code {b.code}
                                    </span>
                                  </div>
                                  {b.staffList.length === 0 ? (
                                    <div className="text-xs text-slate-400 py-3 text-center">
                                      No dedicated IAM accounts assigned. Default staff: {(b.staff || []).join(', ') || 'Branch Officer'}
                                    </div>
                                  ) : (
                                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                                      {b.staffList.map((st) => (
                                        <div
                                          key={st.uid}
                                          className="p-2 rounded-lg border text-xs flex items-center justify-between bg-white border-slate-200"
                                        >
                                          <div>
                                            <div className="font-bold text-zinc-900 text-xs">
                                              {st.name}
                                            </div>
                                            <div className="text-[10px] text-slate-500">
                                              {st.position} · Employee ID: {st.empId}
                                            </div>
                                          </div>
                                          <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                                            {st.status}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>

                                {/* Hardware Inventory Breakdown Column */}
                                <div className="surface-card p-3.5 rounded-xl border border-slate-200 shadow-2xs">
                                  <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-100">
                                    <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                                      <Package className="w-3.5 h-3.5 text-zinc-700" />
                                      <span>Assigned Devices Breakdown ({b.devices.length})</span>
                                    </h4>
                                    <button
                                      type="button"
                                      onClick={() => onSelectBranchFilter(b.code)}
                                      className="text-[10px] text-zinc-800 hover:underline font-normal cursor-pointer"
                                    >
                                      View All in Stock Ledger &rarr;
                                    </button>
                                  </div>
                                  {b.devices.length === 0 ? (
                                    <div className="text-xs text-slate-400 py-3 text-center">
                                      No hardware units registered for this branch code yet.
                                    </div>
                                  ) : (
                                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                                      {b.devices.slice(0, 8).map((d) => (
                                        <div
                                          key={d.serial}
                                          onClick={() => {
                                            if (onSelectDevice) onSelectDevice(d.serial);
                                          }}
                                          className="p-2 rounded-lg border text-xs flex items-center justify-between bg-white hover:bg-zinc-50 border-slate-200 cursor-pointer transition"
                                          title="Click to view hardware serial lifecycle"
                                        >
                                          <div>
                                            <div className="font-mono font-bold text-zinc-900 text-xs">
                                              {d.serial}
                                            </div>
                                            <div className="text-[10px] text-slate-500">
                                              {d.type} · {d.model} {d.merchantName ? `· ${d.merchantName}` : ''}
                                            </div>
                                          </div>
                                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${STAGE_META[d.stage]?.badgeClassLight || 'bg-slate-100 text-slate-700 border-slate-200 font-semibold'}`}>
                                            {STAGE_META[d.stage].short}
                                          </span>
                                        </div>
                                      ))}
                                      {b.devices.length > 8 && (
                                        <div className="text-center pt-1 text-[11px] text-slate-500 font-medium">
                                          + {b.devices.length - 8} more units in branch stock
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : (
          /* View Mode 2: Cards Grid */
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {pagedBranches.map((b, idx) => {
              const isHQ = b.code === '100';
              const totalUnits = Math.max(b.totalDevices, 1);
              const completePct = Math.round((b.completeCount / totalUnits) * 100);
              const reservePct = Math.round((b.reserveCount / totalUnits) * 100);

              return (
                <motion.div
                  key={b.code}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, delay: Math.min(idx * 0.02, 0.25) }}
                  whileHover={{ y: -2, transition: { duration: 0.15 } }}
                  className="surface-card shadow-md hover:shadow-lg p-5 relative overflow-hidden flex flex-col justify-between transition-all hover:border-zinc-400 rounded-xl border border-slate-200"
                >
                  <div
                    className={`absolute top-0 left-0 right-0 h-1 ${
                      isHQ
                        ? 'bg-slate-700'
                        : b.lowReserve
                        ? 'bg-amber-600'
                        : 'bg-[#18191e]'
                    }`}
                  />

                  <div>
                    <div className="flex items-start justify-between gap-3 mb-3.5">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-[11px] font-extrabold text-zinc-900">
                            Branch Code: {b.code}
                          </span>
                          {b.lowReserve && (
                            <span className="text-[10px] font-bold text-amber-700 flex items-center gap-1">
                              · <AlertTriangle className="w-3 h-3" /> Reserve Low
                            </span>
                          )}
                        </div>
                        <h3 className="text-base font-extrabold tracking-tight text-zinc-900">
                          {b.name}
                        </h3>
                        <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5">
                          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>Phnom Penh</span>
                        </div>
                      </div>

                      {isAdminLike && (
                        <button
                          type="button"
                          onClick={() => onOpenEditBranchModal(b)}
                          className="p-2 rounded-lg border bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-600 transition cursor-pointer"
                          title={`Edit Branch Code ${b.code}`}
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-4 gap-2 mb-4">
                      <div className="surface-inset-light p-2.5 text-center">
                        <div className="text-base font-black font-figure text-zinc-900">
                          {b.totalDevices}
                        </div>
                        <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
                          Total
                        </div>
                      </div>

                      <div className="surface-inset-light p-2.5 text-center">
                        <div className="text-base font-black font-figure text-zinc-900">
                          {b.reserveCount}
                          {b.code === '100' && b.hqCount > 0 && (
                            <span className="text-[10px] text-sky-700 block font-normal font-sans">
                              {b.hqCount} HQ
                            </span>
                          )}
                        </div>
                        <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
                          Reserve
                        </div>
                      </div>

                      <div className="surface-inset-light p-2.5 text-center">
                        <div className="text-base font-black font-figure text-emerald-700">
                          {b.completeCount}
                        </div>
                        <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
                          Live
                        </div>
                      </div>

                      <div className="surface-inset-light p-2.5 text-center">
                        <div className="text-base font-black font-figure text-slate-700">
                          {b.inFlightCount}
                        </div>
                        <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
                          In-Flight
                        </div>
                      </div>
                    </div>

                    <div className="mb-3.5">
                      <div className="flex items-center justify-between text-[11px] font-mono mb-1.5">
                        <span className="text-slate-500">
                          POS: <strong className="text-zinc-900">{b.posCount}</strong> · Soundbox:{' '}
                          <strong className="text-zinc-900">{b.sbCount}</strong>
                        </span>
                        <span className="text-emerald-700 font-bold">
                          {completePct}% Installed
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full overflow-hidden flex bg-slate-200">
                        <div
                          style={{ width: `${completePct}%` }}
                          className="h-full bg-[#18191e]"
                        />
                        <div
                          style={{ width: `${reservePct}%` }}
                          className="h-full bg-slate-400"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-200/80 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
                      <Users className="w-3.5 h-3.5 text-zinc-700" />
                      <span>{b.staffCount} Staff Officers</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setInspectedBranchCode(b.code)}
                        className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold border bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700 transition cursor-pointer"
                      >
                        Inspect
                      </button>
                      <button
                        type="button"
                        onClick={() => onSelectBranchFilter(b.code)}
                        className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-[#003857] hover:bg-[#002a42] text-white transition flex items-center gap-1 cursor-pointer"
                      >
                        <span>Ledger</span>
                        <ArrowUpRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
        <Pager pg={pg} label="branches" />
      </div>

      {/* Inspect Branch Modal Drawer */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {inspectedBranch && (
              <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 overflow-y-auto">
                {/* Backdrop */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setInspectedBranchCode(null)}
                  className="fixed inset-0 bg-slate-950/75 backdrop-blur-md"
                />

                {/* Modal Container */}
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: 14 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 12 }}
                  transition={{ type: 'spring', damping: 32, stiffness: 480, mass: 0.6 }}
                  className={`relative w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden my-auto z-10 border-0 flex flex-col transform-gpu will-change-gpu gpu-modal-container ${
                    isLight ? 'bg-white text-[#002f49]' : 'bg-[#12151e] text-slate-100'
                  }`}
                >
                  {/* Signature Navy Header Bar */}
                  <div className="navy-header-bar rounded-t-3xl px-6 py-4.5 flex items-center justify-between text-white border-b border-white/10 shrink-0">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center shrink-0 shadow-xs text-sky-300">
                        <Building2 className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base sm:text-lg font-extrabold text-white tracking-tight truncate">
                            {inspectedBranch.name}
                          </h3>
                          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-white/15 text-white border border-white/20">
                            Branch Code {inspectedBranch.code}
                          </span>
                        </div>
                        <p className="text-xs text-slate-200/90 font-medium mt-0.5 truncate">
                          Branch inventory hub · Assigned staff &amp; live hardware allocation
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setInspectedBranchCode(null)}
                      aria-label="Close"
                      className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition cursor-pointer shrink-0 ml-2"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Sub-Header Context & Metric Strip */}
                  <div
                    className={`px-6 py-2.5 border-b flex items-center justify-between text-xs shrink-0 flex-wrap gap-2 ${
                      isLight ? 'bg-slate-50 border-slate-200 text-slate-700' : 'bg-[#151924] border-slate-800 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-50 dark:bg-sky-950/40 border border-sky-200/80 dark:border-sky-800/60 text-sky-800 dark:text-sky-300 font-mono font-bold text-[11px]">
                        <Cpu className="w-3 h-3 text-sky-600 dark:text-sky-400" />
                        <span>{inspectedBranch.posCount} POS</span>
                      </span>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800/60 text-indigo-800 dark:text-indigo-300 font-mono font-bold text-[11px]">
                        <Volume2 className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                        <span>{inspectedBranch.sbCount} Sound Box</span>
                      </span>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 text-amber-800 dark:text-amber-300 font-mono font-bold text-[11px]">
                        <Package className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                        <span>{inspectedBranch.reserveCount} Reserve</span>
                      </span>
                      {inspectedBranch.hqCount > 0 && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-50 dark:bg-sky-950/40 border border-sky-200/80 dark:border-sky-800/60 text-sky-800 dark:text-sky-300 font-mono font-bold text-[11px]">
                          <Building2 className="w-3 h-3 text-sky-600 dark:text-sky-400" />
                          <span>{inspectedBranch.hqCount} HQ Stock</span>
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300 font-mono font-bold text-[11px]">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                        <span>{inspectedBranch.completeCount} Live</span>
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span>Live Custody Directory</span>
                    </div>
                  </div>

                  {/* Modal Body */}
                  <div className="p-6 overflow-y-auto max-h-[68vh] space-y-4 text-xs">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Section 1: Assigned Branch Staff */}
                      <div className={`p-4 rounded-2xl border space-y-3 ${
                        isLight ? 'bg-slate-100/90 border-slate-200 shadow-2xs' : 'bg-[#161a24] border-slate-700/70'
                      }`}>
                        <div className="flex items-center justify-between pb-2.5 border-b border-slate-200/80 dark:border-white/[0.06]">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-[#003857]/10 text-[#003857] dark:bg-sky-400/10 dark:text-sky-400 flex items-center justify-center shrink-0">
                              <Users className="w-3.5 h-3.5" />
                            </div>
                            <div>
                              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                                1. Assigned Branch Staff ({inspectedBranch.staffList.length})
                              </h4>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                Active custodian officers deployed at this branch
                              </p>
                            </div>
                          </div>
                        </div>

                        {inspectedBranch.staffList.length === 0 ? (
                          <div className="text-xs text-slate-500 p-4 border border-slate-200/80 dark:border-slate-800 rounded-xl bg-white dark:bg-[#121620] text-center shadow-2xs">
                            No IAM users assigned to this branch. Default staff: {(inspectedBranch.staff || []).join(', ') || 'Branch Officer'}
                          </div>
                        ) : (
                          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                            {inspectedBranch.staffList.map((st) => (
                              <div
                                key={st.uid}
                                className="p-3 rounded-xl border text-xs flex items-center justify-between bg-white dark:bg-[#121620] border-slate-200/90 dark:border-slate-800 shadow-2xs"
                              >
                                <div>
                                  <div className="font-bold text-slate-900 dark:text-white">{st.name}</div>
                                  <div className="text-[10px] text-slate-500 mt-0.5">
                                    {st.position} · ID: <span className="font-mono font-semibold">{st.empId}</span>
                                  </div>
                                </div>
                                <span className="font-mono text-[10px] font-bold text-emerald-700 dark:text-emerald-300 px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 shadow-2xs">
                                  {st.status}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Section 2: Assigned Hardware Units */}
                      <div className={`p-4 rounded-2xl border space-y-3 ${
                        isLight ? 'bg-slate-100/90 border-slate-200 shadow-2xs' : 'bg-[#161a24] border-slate-700/70'
                      }`}>
                        <div className="flex items-center justify-between pb-2.5 border-b border-slate-200/80 dark:border-white/[0.06]">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-[#003857]/10 text-[#003857] dark:bg-sky-400/10 dark:text-sky-400 flex items-center justify-center shrink-0">
                              <Package className="w-3.5 h-3.5" />
                            </div>
                            <div>
                              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                                2. Hardware Units ({inspectedBranch.devices.length})
                              </h4>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                Physical stock in reserve or live at merchant
                              </p>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setInspectedBranchCode(null);
                              onSelectBranchFilter(inspectedBranch.code);
                            }}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-[#003857] hover:bg-[#002a42] text-white shadow-2xs transition flex items-center gap-1 cursor-pointer shrink-0"
                            title="Filter stock inventory ledger to this branch"
                          >
                            <span>Open in Ledger</span>
                            <ArrowUpRight className="w-3 h-3" />
                          </button>
                        </div>

                        {inspectedBranch.devices.length === 0 ? (
                          <div className="text-xs text-slate-500 p-4 border border-slate-200/80 dark:border-slate-800 rounded-xl bg-white dark:bg-[#121620] text-center shadow-2xs">
                            No hardware units currently registered for this branch code.
                          </div>
                        ) : (
                          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                            {inspectedBranch.devices.map((d) => (
                              <div
                                key={d.serial}
                                onClick={() => {
                                  setInspectedBranchCode(null);
                                  if (onSelectDevice) onSelectDevice(d.serial);
                                }}
                                className="p-2.5 rounded-xl border text-xs flex items-center justify-between cursor-pointer bg-white dark:bg-[#121620] hover:bg-slate-50 dark:hover:bg-slate-800/60 border-slate-200/90 dark:border-slate-800 shadow-2xs transition"
                                title="Click to view hardware serial lifecycle"
                              >
                                <div>
                                  <div className="font-mono font-bold text-slate-900 dark:text-white">
                                    {d.serial}
                                  </div>
                                  <div className="text-[10px] text-slate-500 mt-0.5">
                                    {d.type} · {d.model} {d.merchantName ? `· ${d.merchantName}` : ''}
                                  </div>
                                </div>
                                <span className={`text-[10px] px-2 py-0.5 rounded border ${STAGE_META[d.stage]?.badgeClassLight || 'bg-slate-100 text-slate-700 border-slate-200 font-semibold'}`}>
                                  {STAGE_META[d.stage].short}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Footer */}
                  <div
                    className={`px-6 py-4 flex items-center justify-between text-xs border-t shrink-0 ${
                      isLight ? 'bg-slate-50 border-slate-200/90' : 'bg-[#0f121a] border-slate-800'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setInspectedBranchCode(null)}
                      className={`px-4 py-2.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
                        isLight
                          ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300 shadow-2xs'
                          : 'bg-[#181c26] hover:bg-[#202534] text-slate-300 border-slate-700 shadow-2xs'
                      }`}
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setInspectedBranchCode(null);
                        onSelectBranchFilter(inspectedBranch.code);
                      }}
                      className="px-5 py-2.5 rounded-xl text-xs font-bold bg-[#003857] hover:bg-[#002a42] text-white shadow-xs active:scale-[0.98] transition-all cursor-pointer flex items-center gap-2 border border-white/10"
                    >
                      <ArrowUpRight className="w-4 h-4 text-sky-300" />
                      <span>View Branch in Stock Ledger ({inspectedBranch.devices.length})</span>
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
};

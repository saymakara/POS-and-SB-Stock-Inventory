import React, { useState, useMemo, useCallback } from 'react';
import {
  Layers, Search, Cpu, Volume2, QrCode, CreditCard, ClipboardList,
  FileSpreadsheet, ArrowUpDown, ArrowUp, ArrowDown, X, Filter
} from 'lucide-react';
import { KpiCategory, KpiPeriod, KpiPointRule, KpiRawCounts, rulePts } from '../services/kpiService';
import { Branch } from '../types';
import { downloadCsv } from '../utils/exportCsv';

function cleanBranchName(name: string): string {
  return (name || '').replace(/^Code\s+\d+\s*[·-]\s*/i, '').trim();
}

export interface BreakdownStaffItem extends KpiRawCounts {
  staffId: string;
  staffName: string;
  branchId: string;
  branchName: string;
  position?: string;
  isManagement?: boolean;
  totalTasks: number;
  totalPoints: number;
  targetPct: number;
}

export interface KpiTaskBreakdownDef {
  key: keyof KpiRawCounts;
  ruleCode: string;
  name: string;
  category: KpiCategory;
  defaultPoints: number;
  unit: string;
}

export const KPI_BREAKDOWN_TASK_DEFS: KpiTaskBreakdownDef[] = [
  { key: 'khqrInstall', ruleCode: 'KHQR_INSTALL', name: 'STATIC QR INSTALLATION (NEW)', category: 'KHQR', defaultPoints: 4, unit: 'merchant' },
  { key: 'khqrReplace', ruleCode: 'KHQR_REPLACE', name: 'STATIC QR REPLACEMENT', category: 'KHQR', defaultPoints: 2, unit: 'merchant' },
  { key: 'khqrMaterials', ruleCode: 'KHQR_MATERIAL', name: 'PRINT STATIC QR / QR MATERIAL SCANNED', category: 'KHQR', defaultPoints: 0.5, unit: 'item' },
  { key: 'posInstall', ruleCode: 'POS_INSTALL', name: 'POS/SB INSTALLATION SETUP & TRAINING (POS)', category: 'POS Terminal', defaultPoints: 10, unit: 'terminal' },
  { key: 'posReplace', ruleCode: 'POS_REPLACE', name: 'POS/SB RETURN & REPLACEMENT (POS)', category: 'POS Terminal', defaultPoints: 5, unit: 'terminal' },
  { key: 'posBattery', ruleCode: 'POS_BATTERY', name: 'POS BATTERY REPLACEMENT', category: 'POS Terminal', defaultPoints: 3, unit: 'battery' },
  { key: 'sbInstall', ruleCode: 'SB_INSTALL', name: 'POS/SB INSTALLATION SETUP & TRAINING (SB)', category: 'Sound Box', defaultPoints: 8, unit: 'device' },
  { key: 'sbReplace', ruleCode: 'SB_REPLACE', name: 'POS/SB RETURN & REPLACEMENT (SB)', category: 'Sound Box', defaultPoints: 4, unit: 'device' },
  { key: 'sbMaint', ruleCode: 'SB_MAINT', name: 'POS/SB MAINTENANCE PER TERMINAL (VISIT)', category: 'Sound Box', defaultPoints: 3, unit: 'visit' },
  { key: 'sbReturn', ruleCode: 'SB_RETURN', name: 'PROCESS POS/SB RETURN/TERMINATION (TO STOCK)', category: 'Sound Box', defaultPoints: 2, unit: 'unit' },
  { key: 'ccPrimary', ruleCode: 'CC_PRIMARY', name: 'ONBOARDED CREDIT CARD MERCHANT (PRIMARY)', category: 'Credit Card', defaultPoints: 15, unit: 'card' },
  { key: 'ccSupp', ruleCode: 'CC_SUPP', name: 'ONBOARDED CREDIT CARD (SUPPLEMENTARY)', category: 'Credit Card', defaultPoints: 8, unit: 'card' },
];

const CAT_COLORS: Record<KpiCategory, { hex: string; badge: string; text: string; Icon: React.ElementType }> = {
  'POS Terminal': { hex: '#006BA6', badge: 'bg-[#006BA6]/10 text-[#006BA6] border-[#006BA6]/20', text: 'text-[#006BA6]', Icon: Cpu },
  'Sound Box': { hex: '#4F518C', badge: 'bg-[#4F518C]/10 text-[#4F518C] border-[#4F518C]/20', text: 'text-[#4F518C]', Icon: Volume2 },
  KHQR: { hex: '#0d9488', badge: 'bg-teal-50 text-teal-700 border-teal-200/90', text: 'text-teal-600', Icon: QrCode },
  'Credit Card': { hex: '#f59e0b', badge: 'bg-amber-50 text-amber-700 border-amber-200/90', text: 'text-amber-600', Icon: CreditCard },
  'Merchant Visit': { hex: '#0284c7', badge: 'bg-sky-50 text-sky-700 border-sky-200/90', text: 'text-sky-700', Icon: ClipboardList },
  Other: { hex: '#64748b', badge: 'bg-slate-50 text-slate-600 border-slate-200', text: 'text-slate-600', Icon: Layers },
};

const NF_INT = new Intl.NumberFormat('en-US');
const fmtInt = (n: number) => NF_INT.format(n);
const NF_PTS = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 });   // reused (same text as toLocaleString)
const fmtPts = (n: number) => NF_PTS.format(n);

interface Props {
  filteredStaff: BreakdownStaffItem[];
  branches: Branch[];
  ruleMap: Map<string, KpiPointRule>;
  period: KpiPeriod;
  onToast: (msg: string, type?: 'success' | 'warn' | 'info') => void;
}

export const KpiDetailBreakdown: React.FC<Props> = ({
  filteredStaff,
  branches,
  ruleMap,
  period,
  onToast,
}) => {
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortKey, setSortKey] = useState<'points' | 'count' | 'name' | 'category' | 'unitPoints' | 'taskPct' | 'pointsPct'>('points');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Filter pool based on selections
  const activeStaffPool = useMemo(() => {
    if (selectedStaffId) {
      return filteredStaff.filter((s) => s.staffId === selectedStaffId);
    }
    if (selectedBranchId) {
      return filteredStaff.filter((s) => s.branchId === selectedBranchId);
    }
    return filteredStaff;
  }, [filteredStaff, selectedStaffId, selectedBranchId]);

  // Compute breakdown tasks rows
  const taskRows = useMemo(() => {
    const rows = KPI_BREAKDOWN_TASK_DEFS.map((def) => {
      const count = activeStaffPool.reduce((sum, s) => sum + (Number(s[def.key]) || 0), 0);
      const unitPoints = rulePts(ruleMap, def.ruleCode) || def.defaultPoints;
      const totalPoints = Math.round(count * unitPoints * 10) / 10;
      return {
        ...def,
        count,
        unitPoints,
        totalPoints,
      };
    });
    // (4 Nov 2026) the active rules added for the Merchant Visit app (POS maintenance / return, merchant visits)
    const extraCodes = new Set<string>();
    activeStaffPool.forEach((s) => Object.keys(s.extra || {}).forEach((k) => extraCodes.add(k)));
    extraCodes.forEach((code) => {
      const rule = ruleMap.get(code);
      if (!rule || !rule.active) return;
      const count = activeStaffPool.reduce((sum, s) => sum + ((s.extra || {})[code] || 0), 0);
      rows.push({
        key: 'extra' as keyof KpiRawCounts, ruleCode: code, name: rule.subCategory.toUpperCase(), category: rule.category,
        defaultPoints: 0, unit: rule.unit.replace(/^per\s+/i, '') || 'task', count, unitPoints: rule.points,
        totalPoints: Math.round(count * rule.points * 10) / 10,
      });
    });

    const grandTotalTasks = rows.reduce((sum, r) => sum + r.count, 0);
    const grandTotalPoints = rows.reduce((sum, r) => sum + r.totalPoints, 0);

    const enriched = rows.map((r) => {
      const taskPct = grandTotalTasks > 0 ? (r.count / grandTotalTasks) * 100 : 0;
      const pointsPct = grandTotalPoints > 0 ? (r.totalPoints / grandTotalPoints) * 100 : 0;
      return {
        ...r,
        taskPct: Math.round(taskPct * 10) / 10,
        pointsPct: Math.round(pointsPct * 10) / 10,
      };
    });

    enriched.sort((a, b) => {
      let diff = 0;
      if (sortKey === 'points') diff = a.totalPoints - b.totalPoints;
      else if (sortKey === 'count') diff = a.count - b.count;
      else if (sortKey === 'name') diff = a.name.localeCompare(b.name);
      else if (sortKey === 'category') diff = a.category.localeCompare(b.category);
      else if (sortKey === 'unitPoints') diff = a.unitPoints - b.unitPoints;
      else if (sortKey === 'taskPct') diff = a.taskPct - b.taskPct;
      else if (sortKey === 'pointsPct') diff = a.pointsPct - b.pointsPct;
      return sortDir === 'desc' ? -diff : diff;
    });

    return {
      rows: enriched,
      grandTotalTasks,
      grandTotalPoints,
    };
  }, [activeStaffPool, ruleMap, sortKey, sortDir]);

  // Search filter for tasks
  const displayedRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return taskRows.rows;
    return taskRows.rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q)
    );
  }, [taskRows.rows, searchQuery]);

  // Summary Metrics
  const summaryMetrics = useMemo(() => {
    const staffCount = activeStaffPool.length;
    const { grandTotalTasks, grandTotalPoints } = taskRows;
    const nonMgmt = activeStaffPool.filter((s) => !s.isManagement);
    const avgAchievement =
      nonMgmt.length > 0
        ? Math.round(nonMgmt.reduce((sum, s) => sum + (s.targetPct || 0), 0) / nonMgmt.length)
        : 0;
    const avgPtsPerStaff = staffCount > 0 ? Math.round(grandTotalPoints / staffCount) : 0;

    let targetLabel = `All Staff (${staffCount})`;
    if (selectedStaffId) {
      const staffMember = filteredStaff.find((s) => s.staffId === selectedStaffId);
      targetLabel = staffMember
        ? `${staffMember.staffName} (Code ${staffMember.branchId})`
        : '1 Staff Member';
    } else if (selectedBranchId) {
      const branchObj = branches.find((b) => b.id === selectedBranchId);
      targetLabel = branchObj
        ? `Branch ${selectedBranchId} · ${cleanBranchName(branchObj.name)}`
        : `Branch Code ${selectedBranchId}`;
    }

    return {
      staffCount,
      targetLabel,
      grandTotalPoints,
      grandTotalTasks,
      avgAchievement,
      avgPtsPerStaff,
    };
  }, [activeStaffPool, taskRows, selectedStaffId, selectedBranchId, filteredStaff, branches]);

  // Achievement Tone
  const achievementTone = useMemo(() => {
    const a = summaryMetrics.avgAchievement;
    if (a >= 120) {
      return {
        label: 'Outstanding',
        badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
      };
    }
    if (a >= 100) {
      return {
        label: 'Meet Target',
        badgeClass: 'bg-teal-50 text-teal-800 border-teal-300 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-800',
      };
    }
    if (a >= 80) {
      return {
        label: 'Near Target',
        badgeClass: 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
      };
    }
    return {
      label: 'Needs Imp.',
      badgeClass: 'bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
    };
  }, [summaryMetrics.avgAchievement]);

  // Sort toggle handler
  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  // CSV Export
  const handleExportCsv = useCallback(() => {
    const tag = selectedStaffId
      ? `Staff_${selectedStaffId}`
      : selectedBranchId
      ? `Branch_${selectedBranchId}`
      : 'All_Staff_Branches';

    downloadCsv(
      `KPI_Detail_Breakdown_${tag}_${period}`,
      ['Rank', 'KPI Task', 'Category', 'Unit Points', 'Task Count', '% of Tasks', 'Total Points', 'Points Percentage'],
      taskRows.rows.map((r, i) => [
        i + 1,
        r.name,
        r.category,
        r.unitPoints,
        r.count,
        `${r.taskPct}%`,
        r.totalPoints,
        `${r.pointsPct}%`,
      ])
    );
    onToast(`Exported Action Breakdown table to CSV (${taskRows.rows.length} actions)`);
  }, [selectedStaffId, selectedBranchId, period, taskRows, onToast]);

  const resetAllFilters = () => {
    setSelectedStaffId('');
    setSelectedBranchId('');
    setSearchQuery('');
  };

  const isFiltered = Boolean(selectedStaffId || selectedBranchId || searchQuery);

  const sortedBranches = useMemo(
    () => [...branches].sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true })),
    [branches]
  );

  const sortedStaff = useMemo(
    () => [...filteredStaff].sort((a, b) => a.staffName.localeCompare(b.staffName)),
    [filteredStaff]
  );

  return (
    <div className="w-full flex flex-col">
      {/* ───────────── Sub-bar: Filters & KPI Metrics Strip ───────────── */}
      <div className="px-5 py-2.5 bg-slate-50/70 dark:bg-slate-800/50 border-b border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Left: Filter Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-slate-500 font-semibold text-[11px] uppercase tracking-wider mr-1">
            <Filter className="w-3.5 h-3.5 text-[#003857] dark:text-[#5cc8ff]" />
            <span className="hidden sm:inline">Filter By:</span>
          </div>

          {/* Staff Select */}
          <select
            value={selectedStaffId}
            onChange={(e) => {
              setSelectedStaffId(e.target.value);
              if (e.target.value) setSelectedBranchId('');
            }}
            aria-label="Filter by Staff"
            className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-normal text-slate-800 dark:text-slate-200 shadow-2xs outline-none cursor-pointer max-w-[190px] truncate"
          >
            <option value="">All Staff ({filteredStaff.length})</option>
            {sortedStaff.map((s) => (
              <option key={s.staffId} value={s.staffId}>
                {s.staffName} ({s.staffId})
              </option>
            ))}
          </select>

          {/* Branch Select */}
          <select
            value={selectedBranchId}
            onChange={(e) => {
              setSelectedBranchId(e.target.value);
              if (e.target.value) setSelectedStaffId('');
            }}
            aria-label="Filter by Branch"
            className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-normal text-slate-800 dark:text-slate-200 shadow-2xs outline-none cursor-pointer max-w-[190px] truncate"
          >
            <option value="">All Branches ({branches.length})</option>
            {sortedBranches.map((b) => (
              <option key={b.id} value={b.id}>
                Code {b.id} · {cleanBranchName(b.name)}
              </option>
            ))}
          </select>

          {/* Task Search Input */}
          <div className="relative w-40 sm:w-48">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search actions..."
              className="w-full pl-7 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-[#003857] shadow-2xs"
            />
          </div>

          {isFiltered && (
            <button
              type="button"
              onClick={resetAllFilters}
              className="px-2.5 py-1.5 rounded-xl text-xs font-bold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 border border-rose-200 dark:border-rose-900 cursor-pointer transition shadow-2xs inline-flex items-center gap-1"
              title="Reset all filters to show all actions"
            >
              <X className="w-3 h-3" />
              <span>Clear</span>
            </button>
          )}
        </div>

        {/* Right: Quick Summary Metrics Chips & Export */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 shadow-2xs font-figure text-[11.5px]">
            <span className="text-slate-500 font-medium">Tasks:</span>
            <strong className="text-slate-900 dark:text-white tabular-nums">{fmtInt(taskRows.grandTotalTasks)}</strong>
          </div>

          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 shadow-2xs font-figure text-[11.5px]">
            <span className="text-slate-500 font-medium">Points:</span>
            <strong className="text-[#003857] dark:text-[#5cc8ff] tabular-nums">{fmtPts(taskRows.grandTotalPoints)} pts</strong>
          </div>

          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 shadow-2xs font-figure text-[11.5px]">
            <span className="text-slate-500 font-medium">Avg Target:</span>
            <span className={`px-1.5 py-0.2 rounded font-bold text-[10.5px] border ${achievementTone.badgeClass}`}>
              {summaryMetrics.avgAchievement}%
            </span>
          </div>

          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 shadow-2xs font-figure text-[11.5px] hidden sm:inline-flex">
            <span className="text-slate-500 font-medium">Pts/Staff:</span>
            <strong className="text-slate-900 dark:text-white tabular-nums">{fmtInt(summaryMetrics.avgPtsPerStaff)}</strong>
          </div>

          <button
            type="button"
            onClick={handleExportCsv}
            className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 shadow-2xs cursor-pointer transition ml-0.5"
            title="Export Action Breakdown table to CSV"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span className="hidden md:inline">Export CSV</span>
          </button>
        </div>
      </div>

      {/* ───────────── Full-Width Action Breakdown Table ───────────── */}
      <div className="overflow-x-auto w-full overscroll-x-contain">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="navy-header-bar bg-[#003857] text-white text-xs font-semibold normal-case tracking-normal select-none">
              <th className="py-2.5 px-3.5 text-center w-12 border-b border-white/20">No.</th>

              <th
                className="py-2.5 px-4 cursor-pointer hover:bg-white/10 transition-colors border-b border-white/20 min-w-[280px]"
                onClick={() => handleSort('name')}
              >
                <div className="flex items-center gap-1.5">
                  <span>KPI Operational Task</span>
                  {sortKey === 'name' ? (
                    sortDir === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-sky-300" /> : <ArrowDown className="w-3.5 h-3.5 text-sky-300" />
                  ) : (
                    <ArrowUpDown className="w-3 h-3 text-white/40" />
                  )}
                </div>
              </th>

              <th
                className="py-2.5 px-3 text-center cursor-pointer hover:bg-white/10 transition-colors border-b border-white/20 min-w-[130px]"
                onClick={() => handleSort('category')}
              >
                <div className="flex items-center justify-center gap-1.5">
                  <span>Category</span>
                  {sortKey === 'category' ? (
                    sortDir === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-sky-300" /> : <ArrowDown className="w-3.5 h-3.5 text-sky-300" />
                  ) : (
                    <ArrowUpDown className="w-3 h-3 text-white/40" />
                  )}
                </div>
              </th>

              <th
                className="py-2.5 px-3 text-center cursor-pointer hover:bg-white/10 transition-colors border-b border-white/20 min-w-[120px]"
                onClick={() => handleSort('unitPoints')}
              >
                <div className="flex items-center justify-center gap-1.5">
                  <span>Points / Unit</span>
                  {sortKey === 'unitPoints' ? (
                    sortDir === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-sky-300" /> : <ArrowDown className="w-3.5 h-3.5 text-sky-300" />
                  ) : (
                    <ArrowUpDown className="w-3 h-3 text-white/40" />
                  )}
                </div>
              </th>

              <th
                className="py-2.5 px-4 text-right cursor-pointer hover:bg-white/10 transition-colors border-b border-white/20 min-w-[110px]"
                onClick={() => handleSort('count')}
              >
                <div className="flex items-center justify-end gap-1.5">
                  <span>Task Count</span>
                  {sortKey === 'count' ? (
                    sortDir === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-sky-300" /> : <ArrowDown className="w-3.5 h-3.5 text-sky-300" />
                  ) : (
                    <ArrowUpDown className="w-3 h-3 text-white/40" />
                  )}
                </div>
              </th>

              <th
                className="py-2.5 px-4 text-right cursor-pointer hover:bg-white/10 transition-colors border-b border-white/20 min-w-[130px]"
                onClick={() => handleSort('taskPct')}
              >
                <div className="flex items-center justify-end gap-1.5">
                  <span>% of Tasks</span>
                  {sortKey === 'taskPct' ? (
                    sortDir === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-sky-300" /> : <ArrowDown className="w-3.5 h-3.5 text-sky-300" />
                  ) : (
                    <ArrowUpDown className="w-3 h-3 text-white/40" />
                  )}
                </div>
              </th>

              <th
                className="py-2.5 px-4 text-right cursor-pointer hover:bg-white/10 transition-colors border-b border-white/20 min-w-[130px]"
                onClick={() => handleSort('points')}
              >
                <div className="flex items-center justify-end gap-1.5">
                  <span>Total Points</span>
                  {sortKey === 'points' ? (
                    sortDir === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-sky-300" /> : <ArrowDown className="w-3.5 h-3.5 text-sky-300" />
                  ) : (
                    <ArrowUpDown className="w-3 h-3 text-white/40" />
                  )}
                </div>
              </th>

              <th
                className="py-2.5 px-4 text-right cursor-pointer hover:bg-white/10 transition-colors border-b border-white/20 min-w-[130px]"
                onClick={() => handleSort('pointsPct')}
              >
                <div className="flex items-center justify-end gap-1.5">
                  <span>Points Share</span>
                  {sortKey === 'pointsPct' ? (
                    sortDir === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-sky-300" /> : <ArrowDown className="w-3.5 h-3.5 text-sky-300" />
                  ) : (
                    <ArrowUpDown className="w-3 h-3 text-white/40" />
                  )}
                </div>
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-200/90 dark:divide-slate-800 font-medium">
            {displayedRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-500 text-xs">
                  No operational actions match &quot;{searchQuery}&quot;
                </td>
              </tr>
            ) : (
              displayedRows.map((row, idx) => {
                const cat = CAT_COLORS[row.category];
                const Icon = cat.Icon;
                return (
                  <tr
                    key={row.key}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors text-[13px] text-slate-700 dark:text-slate-300"
                  >
                    {/* Rank */}
                    <td className="py-3 px-3.5 text-center text-slate-400 font-figure tabular-nums font-bold text-xs">
                      {idx + 1}
                    </td>

                    {/* Task Name */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border shadow-2xs ${cat.badge}`}>
                          <Icon className="w-3.5 h-3.5" />
                        </span>
                        <span className="font-bold text-slate-900 dark:text-white tracking-tight leading-snug">
                          {row.name}
                        </span>
                      </div>
                    </td>

                    {/* Category */}
                    <td className="py-3 px-3 text-center whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-semibold border ${cat.badge}`}>
                        {row.category}
                      </span>
                    </td>

                    {/* Unit Points */}
                    <td className="py-3 px-3 text-center whitespace-nowrap">
                      <span className="font-mono text-xs font-semibold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                        {row.unitPoints} pts / {row.unit}
                      </span>
                    </td>

                    {/* Task Count */}
                    <td className="py-3 px-4 text-right font-figure tabular-nums text-slate-900 dark:text-white font-bold text-xs">
                      {fmtInt(row.count)}
                    </td>

                    {/* % of Tasks */}
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2 justify-end">
                        <span className="w-14 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden hidden sm:inline-block">
                          <span
                            className="h-full block rounded-full bg-slate-500"
                            style={{ width: `${Math.min(100, Math.max(3, row.taskPct))}%` }}
                          />
                        </span>
                        <span className="font-figure tabular-nums text-slate-700 dark:text-slate-300 w-11 text-right text-xs">
                          {row.taskPct}%
                        </span>
                      </div>
                    </td>

                    {/* Total Points */}
                    <td className="py-3 px-4 text-right font-figure tabular-nums text-[#003857] dark:text-[#5cc8ff] font-extrabold text-[13px]">
                      {fmtPts(row.totalPoints)} pts
                    </td>

                    {/* Points Share */}
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2 justify-end">
                        <span className="w-14 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden hidden sm:inline-block">
                          <span
                            className="h-full block rounded-full bg-[#003857] dark:bg-[#5cc8ff]"
                            style={{ width: `${Math.min(100, Math.max(3, row.pointsPct))}%` }}
                          />
                        </span>
                        <span className="font-figure tabular-nums font-bold text-slate-900 dark:text-white w-11 text-right text-xs">
                          {row.pointsPct}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>

          {/* Table Footer Totals */}
          <tfoot>
            <tr className="bg-slate-100/90 dark:bg-slate-800/80 font-bold text-slate-900 dark:text-white border-t-2 border-slate-300 dark:border-slate-700">
              <td colSpan={4} className="py-3 px-4 uppercase tracking-wider text-xs">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-[#003857] dark:text-[#5cc8ff]" />
                  <span>Total All Operational Actions ({taskRows.rows.length} Actions)</span>
                </div>
              </td>
              <td className="py-3 px-4 text-right font-figure tabular-nums font-black text-sm">
                {fmtInt(taskRows.grandTotalTasks)}
              </td>
              <td className="py-3 px-4 text-right font-figure tabular-nums text-xs font-bold">
                100.0%
              </td>
              <td className="py-3 px-4 text-right font-figure tabular-nums font-black text-[#003857] dark:text-[#5cc8ff] text-sm">
                {fmtPts(taskRows.grandTotalPoints)} pts
              </td>
              <td className="py-3 px-4 text-right font-figure tabular-nums text-xs font-bold">
                100.0%
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};

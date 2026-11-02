import React, { useState, useMemo, useCallback } from 'react';
import {
  Layers, Search, Users, Cpu, Volume2, QrCode, CreditCard,
  Check, FileSpreadsheet, ArrowUpDown, ArrowUp, ArrowDown
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
  'POS Terminal': { hex: '#0284c7', badge: 'bg-sky-50 text-sky-700 border-sky-200/90', text: 'text-sky-600', Icon: Cpu },
  'Sound Box': { hex: '#8b5cf6', badge: 'bg-purple-50 text-purple-700 border-purple-200/90', text: 'text-purple-600', Icon: Volume2 },
  KHQR: { hex: '#0d9488', badge: 'bg-teal-50 text-teal-700 border-teal-200/90', text: 'text-teal-600', Icon: QrCode },
  'Credit Card': { hex: '#f59e0b', badge: 'bg-amber-50 text-amber-700 border-amber-200/90', text: 'text-amber-600', Icon: CreditCard },
  Other: { hex: '#64748b', badge: 'bg-slate-50 text-slate-600 border-slate-200', text: 'text-slate-600', Icon: Layers },
};

const fmtInt = (n: number) => n.toLocaleString('en-US');
const fmtPts = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 });

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
  const [sidebarTab, setSidebarTab] = useState<'staff' | 'branch'>('staff');
  const [sidebarSearch, setSidebarSearch] = useState<string>('');
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
      const count = activeStaffPool.reduce((sum, s) => sum + (s[def.key] || 0), 0);
      const unitPoints = rulePts(ruleMap, def.ruleCode) || def.defaultPoints;
      const totalPoints = Math.round(count * unitPoints * 10) / 10;
      return {
        ...def,
        count,
        unitPoints,
        totalPoints,
      };
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

  // Summary Metrics Bar
  const summaryMetrics = useMemo(() => {
    const staffCount = activeStaffPool.length;
    const { grandTotalTasks, grandTotalPoints } = taskRows;
    const nonMgmt = activeStaffPool.filter((s) => !s.isManagement);
    const avgAchievement =
      nonMgmt.length > 0
        ? Math.round(nonMgmt.reduce((sum, s) => sum + (s.targetPct || 0), 0) / nonMgmt.length)
        : 0;
    const avgPtsPerStaff = staffCount > 0 ? Math.round(grandTotalPoints / staffCount) : 0;

    let targetLabel = `${staffCount} Staff Selected (All Available)`;
    let selectedBadge = `${staffCount}`;
    if (selectedStaffId) {
      const staffMember = filteredStaff.find((s) => s.staffId === selectedStaffId);
      selectedBadge = '1';
      targetLabel = staffMember
        ? `${staffMember.staffName} (Code ${staffMember.branchId})`
        : '1 Staff Member';
    } else if (selectedBranchId) {
      const branchObj = branches.find((b) => b.id === selectedBranchId);
      selectedBadge = '1';
      targetLabel = branchObj
        ? `Branch ${selectedBranchId} · ${cleanBranchName(branchObj.name)} (${staffCount} staff)`
        : `Branch Code ${selectedBranchId}`;
    }

    return {
      staffCount,
      selectedBadge,
      targetLabel,
      grandTotalPoints,
      grandTotalTasks,
      avgAchievement,
      avgPtsPerStaff,
    };
  }, [activeStaffPool, taskRows, selectedStaffId, selectedBranchId, filteredStaff, branches]);

  // Achievement Tone Classifier
  const achievementTone = useMemo(() => {
    const a = summaryMetrics.avgAchievement;
    if (a >= 120) {
      return {
        label: 'Outstanding',
        icon: '🚀',
        badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
      };
    }
    if (a >= 100) {
      return {
        label: 'Meet Target',
        icon: '✅',
        badgeClass: 'bg-teal-50 text-teal-800 border-teal-300 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-800',
      };
    }
    if (a >= 80) {
      return {
        label: 'Near/Below',
        icon: '◇',
        badgeClass: 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
      };
    }
    return {
      label: 'Needs Improvement',
      icon: '✕',
      badgeClass: 'bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
    };
  }, [summaryMetrics.avgAchievement]);

  // Sidebar list filters
  const filteredSidebarStaff = useMemo(() => {
    const q = sidebarSearch.trim().toLowerCase();
    if (!q) return filteredStaff;
    return filteredStaff.filter(
      (s) =>
        s.staffName.toLowerCase().includes(q) ||
        s.staffId.toLowerCase().includes(q) ||
        s.branchId.toLowerCase().includes(q) ||
        s.branchName.toLowerCase().includes(q)
    );
  }, [filteredStaff, sidebarSearch]);

  const filteredSidebarBranches = useMemo(() => {
    const q = sidebarSearch.trim().toLowerCase();
    const sorted = [...branches].sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true }));
    if (!q) return sorted;
    return sorted.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        String(b.id).toLowerCase().includes(q)
    );
  }, [branches, sidebarSearch]);

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
    onToast(`Exported KPI Task Breakdown table to CSV (${taskRows.rows.length} actions)`);
  }, [selectedStaffId, selectedBranchId, period, taskRows, onToast]);

  const resetAllFilters = () => {
    setSelectedStaffId('');
    setSelectedBranchId('');
    setSidebarSearch('');
    onToast('Reset filters to show all staff and branch breakdown');
  };

  return (
    <div className="space-y-5 p-4 sm:p-6 bg-slate-50/50 dark:bg-slate-900/30 rounded-2xl">
      {/* ───────────── Header Bar (Spreadsheet Style) ───────────── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-5 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#003857] text-white flex items-center justify-center shrink-0 shadow-2xs">
              <Search className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black tracking-tight text-[#003857] dark:text-[#5cc8ff]">
                KPI DETAIL — Individual &amp; Branch Breakdown
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                Sort/filter the table by any column. Auto-syncs live from KPI &amp; Performance.
              </p>
            </div>
          </div>
        </div>

        {/* Top-right "TYPE TO SEARCH (no scrolling)" */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <span className="text-slate-500 text-[11px] font-bold uppercase tracking-wider hidden sm:inline">Type to Search:</span>
            
            {/* Staff Dropdown */}
            <select
              value={selectedStaffId}
              onChange={(e) => {
                setSelectedStaffId(e.target.value);
                if (e.target.value) setSelectedBranchId('');
              }}
              aria-label="Filter by Staff"
              className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 shadow-2xs outline-none cursor-pointer max-w-[180px] truncate"
            >
              <option value="">Staff: All ({filteredStaff.length})</option>
              {filteredStaff.map((s) => (
                <option key={s.staffId} value={s.staffId}>
                  {s.staffName} ({s.staffId})
                </option>
              ))}
            </select>

            {/* Branch Dropdown */}
            <select
              value={selectedBranchId}
              onChange={(e) => {
                setSelectedBranchId(e.target.value);
                if (e.target.value) setSelectedStaffId('');
              }}
              aria-label="Filter by Branch"
              className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 shadow-2xs outline-none cursor-pointer max-w-[180px] truncate"
            >
              <option value="">Branch: All ({branches.length})</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  Code {b.id} · {cleanBranchName(b.name)}
                </option>
              ))}
            </select>

            {(selectedStaffId || selectedBranchId) && (
              <button
                type="button"
                onClick={resetAllFilters}
                className="px-2.5 py-1.5 rounded-xl text-xs font-bold text-rose-600 hover:bg-rose-50 border border-rose-200 cursor-pointer transition shadow-2xs"
                title="Clear selected staff or branch filter"
              >
                Clear
              </button>
            )}

            <button
              type="button"
              onClick={handleExportCsv}
              className="btn btn-secondary px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-2xs cursor-pointer ml-1"
              title="Export Breakdown Table to CSV"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>
      </div>

      {/* ───────────── Top Metrics Summary Bar (Navy Excel Style) ───────────── */}
      <div className="rounded-2xl border border-[#002a42] bg-[#003857] text-white p-4 sm:p-5 shadow-sm">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 divide-y sm:divide-y-0 sm:divide-x divide-white/10">
          {/* Card 1 */}
          <div className="pt-2 sm:pt-0 sm:px-3 text-center">
            <div className="text-[11px] font-bold text-sky-200 uppercase tracking-wider">
              Staff / Branch Selected
            </div>
            <div className="text-2xl sm:text-3xl font-black mt-1 font-figure tracking-tight">
              {summaryMetrics.selectedBadge}
            </div>
            <div className="text-[11px] text-sky-100/80 truncate mt-0.5 font-medium" title={summaryMetrics.targetLabel}>
              {summaryMetrics.targetLabel}
            </div>
          </div>

          {/* Card 2 */}
          <div className="pt-2 sm:pt-0 sm:px-3 text-center">
            <div className="text-[11px] font-bold text-sky-200 uppercase tracking-wider">
              Total Points
            </div>
            <div className="text-2xl sm:text-3xl font-black mt-1 font-figure tracking-tight text-white">
              {fmtPts(summaryMetrics.grandTotalPoints)}
            </div>
            <div className="text-[11px] text-sky-100/80 mt-0.5 font-medium">
              Overall points accrued
            </div>
          </div>

          {/* Card 3 */}
          <div className="pt-2 sm:pt-0 sm:px-3 text-center">
            <div className="text-[11px] font-bold text-sky-200 uppercase tracking-wider">
              Total Tasks
            </div>
            <div className="text-2xl sm:text-3xl font-black mt-1 font-figure tracking-tight text-white">
              {fmtInt(summaryMetrics.grandTotalTasks)}
            </div>
            <div className="text-[11px] text-sky-100/80 mt-0.5 font-medium">
              Actions taken across tasks
            </div>
          </div>

          {/* Card 4 */}
          <div className="pt-2 sm:pt-0 sm:px-3 text-center">
            <div className="text-[11px] font-bold text-sky-200 uppercase tracking-wider">
              Avg Achievement
            </div>
            <div className="mt-1">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xl sm:text-2xl font-black font-figure border shadow-xs ${achievementTone.badgeClass}`}>
                <span>{summaryMetrics.avgAchievement}%</span>
              </span>
            </div>
            <div className="text-[11px] text-sky-100/80 mt-1 font-medium">
              {achievementTone.icon} {achievementTone.label}
            </div>
          </div>

          {/* Card 5 */}
          <div className="pt-2 sm:pt-0 sm:px-3 text-center col-span-2 sm:col-span-1">
            <div className="text-[11px] font-bold text-sky-200 uppercase tracking-wider">
              Avg Pts / Staff
            </div>
            <div className="text-2xl sm:text-3xl font-black mt-1 font-figure tracking-tight text-white">
              {fmtInt(summaryMetrics.avgPtsPerStaff)}
            </div>
            <div className="text-[11px] text-sky-100/80 mt-0.5 font-medium">
              Points per team member
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="mt-4 pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-[11px] text-sky-100/80">
          <span className="font-semibold text-white/90">Avg Achievement Tone Scale:</span>
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1 font-medium">
              <span>🚀</span> <strong>&ge; 120%</strong> Outstanding
            </span>
            <span className="inline-flex items-center gap-1 font-medium">
              <span>✅</span> <strong>100–120%</strong> Meet Target
            </span>
            <span className="inline-flex items-center gap-1 font-medium">
              <span>◇</span> <strong>80–100%</strong> Near/Below
            </span>
            <span className="inline-flex items-center gap-1 font-medium">
              <span>✕</span> <strong>&lt; 80%</strong> Needs Improvement
            </span>
          </div>
        </div>
      </div>

      {/* ───────────── Main Content: Ranking Table + Quick Filter Sidebar ───────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column (Table) - 8 cols */}
        <div className="lg:col-span-8 xl:col-span-9 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-2xs overflow-hidden">
          <div className="overflow-x-auto w-full overscroll-x-contain">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="navy-header-bar bg-[#003857] text-white text-xs font-semibold select-none">
                  <th className="py-3 px-3 text-center w-10">No.</th>
                  
                  <th
                    className="py-3 px-3.5 cursor-pointer hover:bg-white/10 transition-colors"
                    onClick={() => handleSort('name')}
                  >
                    <div className="flex items-center gap-1.5">
                      <span>KPI Task</span>
                      {sortKey === 'name' ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3 text-sky-300" /> : <ArrowDown className="w-3 h-3 text-sky-300" />) : <ArrowUpDown className="w-3 h-3 text-white/40" />}
                    </div>
                  </th>

                  <th
                    className="py-3 px-3 text-center cursor-pointer hover:bg-white/10 transition-colors"
                    onClick={() => handleSort('category')}
                  >
                    <div className="flex items-center justify-center gap-1.5">
                      <span>Category</span>
                      {sortKey === 'category' ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3 text-sky-300" /> : <ArrowDown className="w-3 h-3 text-sky-300" />) : <ArrowUpDown className="w-3 h-3 text-white/40" />}
                    </div>
                  </th>

                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:bg-white/10 transition-colors"
                    onClick={() => handleSort('count')}
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Task Count</span>
                      {sortKey === 'count' ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3 text-sky-300" /> : <ArrowDown className="w-3 h-3 text-sky-300" />) : <ArrowUpDown className="w-3 h-3 text-white/40" />}
                    </div>
                  </th>

                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:bg-white/10 transition-colors"
                    onClick={() => handleSort('taskPct')}
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      <span>% of Tasks</span>
                      {sortKey === 'taskPct' ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3 text-sky-300" /> : <ArrowDown className="w-3 h-3 text-sky-300" />) : <ArrowUpDown className="w-3 h-3 text-white/40" />}
                    </div>
                  </th>

                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:bg-white/10 transition-colors"
                    onClick={() => handleSort('points')}
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Total Points</span>
                      {sortKey === 'points' ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3 text-sky-300" /> : <ArrowDown className="w-3 h-3 text-sky-300" />) : <ArrowUpDown className="w-3 h-3 text-white/40" />}
                    </div>
                  </th>

                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:bg-white/10 transition-colors"
                    onClick={() => handleSort('pointsPct')}
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Points %</span>
                      {sortKey === 'pointsPct' ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3 text-sky-300" /> : <ArrowDown className="w-3 h-3 text-sky-300" />) : <ArrowUpDown className="w-3 h-3 text-white/40" />}
                    </div>
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                {taskRows.rows.map((row, idx) => {
                  const cat = CAT_COLORS[row.category];
                  const Icon = cat.Icon;
                  return (
                    <tr
                      key={row.key}
                      className="hover:bg-slate-50/80 dark:hover:bg-white/[0.03] transition-colors"
                    >
                      <td className="py-2.5 px-3 text-center text-slate-400 font-figure tabular-nums font-bold">
                        {idx + 1}
                      </td>

                      <td className="py-2.5 px-3.5">
                        <div className="flex items-center gap-2">
                          <span className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 border ${cat.badge}`}>
                            <Icon className="w-3.5 h-3.5" />
                          </span>
                          <span className="font-bold text-slate-800 dark:text-slate-100 tracking-tight">
                            {row.name}
                          </span>
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-semibold border ${cat.badge}`}>
                          {row.category}
                        </span>
                      </td>

                      <td className="py-2.5 px-3 text-right font-figure tabular-nums text-slate-800 dark:text-slate-200 font-bold">
                        {fmtInt(row.count)}
                      </td>

                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          <span className="w-12 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden hidden sm:inline-block">
                            <span
                              className="h-full block rounded-full bg-slate-500"
                              style={{ width: `${Math.min(100, Math.max(3, row.taskPct))}%` }}
                            />
                          </span>
                          <span className="font-figure tabular-nums text-slate-600 dark:text-slate-300 w-10 text-right">
                            {row.taskPct}%
                          </span>
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-right font-figure tabular-nums text-[#003857] dark:text-[#5cc8ff] font-extrabold text-[13px]">
                        {fmtPts(row.totalPoints)} pts
                      </td>

                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          <span className="w-12 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden hidden sm:inline-block">
                            <span
                              className="h-full block rounded-full bg-[#003857] dark:bg-[#5cc8ff]"
                              style={{ width: `${Math.min(100, Math.max(3, row.pointsPct))}%` }}
                            />
                          </span>
                          <span className="font-figure tabular-nums font-bold text-slate-800 dark:text-slate-200 w-10 text-right">
                            {row.pointsPct}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>

              {/* Table Footer Totals */}
              <tfoot>
                <tr className="bg-slate-100 dark:bg-slate-800/80 font-bold text-slate-900 dark:text-white border-t-2 border-slate-300 dark:border-slate-700">
                  <td colSpan={3} className="py-3 px-3.5 uppercase tracking-wider text-xs">
                    Total All Operational Actions
                  </td>
                  <td className="py-3 px-3 text-right font-figure tabular-nums font-black text-sm">
                    {fmtInt(taskRows.grandTotalTasks)}
                  </td>
                  <td className="py-3 px-3 text-right font-figure tabular-nums text-xs">
                    100.0%
                  </td>
                  <td className="py-3 px-3 text-right font-figure tabular-nums font-black text-[#003857] dark:text-[#5cc8ff] text-sm">
                    {fmtPts(taskRows.grandTotalPoints)} pts
                  </td>
                  <td className="py-3 px-3 text-right font-figure tabular-nums text-xs font-bold">
                    100.0%
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Right Column (Quick Selection & Search Sidebar) - 4 cols */}
        <div className="lg:col-span-4 xl:col-span-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-4 shadow-2xs space-y-3.5">
          {/* Tabs: Staff vs Branch */}
          <div className="flex items-center justify-between gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-bold">
            <button
              type="button"
              onClick={() => { setSidebarTab('staff'); setSidebarSearch(''); }}
              className={`flex-1 py-1.5 px-2 rounded-lg transition-all text-center cursor-pointer ${
                sidebarTab === 'staff'
                  ? 'bg-white dark:bg-slate-700 text-[#003857] dark:text-white shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              Staff ({filteredStaff.length})
            </button>
            <button
              type="button"
              onClick={() => { setSidebarTab('branch'); setSidebarSearch(''); }}
              className={`flex-1 py-1.5 px-2 rounded-lg transition-all text-center cursor-pointer ${
                sidebarTab === 'branch'
                  ? 'bg-white dark:bg-slate-700 text-[#003857] dark:text-white shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              Branches ({branches.length})
            </button>
          </div>

          {/* Search Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={sidebarSearch}
              onChange={(e) => setSidebarSearch(e.target.value)}
              placeholder={`Search ${sidebarTab === 'staff' ? 'staff name or ID' : 'branch name or code'}...`}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[#003857]"
            />
          </div>

          {/* Scrollable list */}
          <div className="space-y-1.5 max-h-[460px] overflow-y-auto pr-1 custom-scrollbar text-xs">
            {/* "All" reset option */}
            <button
              type="button"
              onClick={() => {
                setSelectedStaffId('');
                setSelectedBranchId('');
              }}
              className={`w-full text-left p-2.5 rounded-xl border transition-all flex items-center justify-between cursor-pointer ${
                !selectedStaffId && !selectedBranchId
                  ? 'bg-[#003857] text-white border-[#003857] shadow-xs'
                  : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200/80 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100'
              }`}
            >
              <div className="font-bold flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />
                <span>All {sidebarTab === 'staff' ? 'Staff Members' : 'Branches'}</span>
              </div>
              {!selectedStaffId && !selectedBranchId && (
                <Check className="w-3.5 h-3.5 text-sky-300 shrink-0" />
              )}
            </button>

            {sidebarTab === 'staff' ? (
              filteredSidebarStaff.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  No staff members matching &quot;{sidebarSearch}&quot;
                </div>
              ) : (
                filteredSidebarStaff.map((s) => {
                  const isSelected = selectedStaffId === s.staffId;
                  return (
                    <button
                      key={s.staffId}
                      type="button"
                      onClick={() => {
                        setSelectedStaffId(isSelected ? '' : s.staffId);
                        setSelectedBranchId('');
                      }}
                      className={`w-full text-left p-2.5 rounded-xl border transition-all flex items-center justify-between gap-2 cursor-pointer ${
                        isSelected
                          ? 'bg-[#003857] text-white border-[#003857] shadow-xs'
                          : 'bg-white dark:bg-slate-800/60 border-slate-200/80 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="font-bold truncate text-xs">
                          {s.staffName}
                        </div>
                        <div className={`text-[10.5px] truncate font-mono ${isSelected ? 'text-sky-200' : 'text-slate-500'}`}>
                          ID {s.staffId} · Code {s.branchId}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`font-figure font-bold text-xs ${isSelected ? 'text-white' : 'text-[#003857] dark:text-[#5cc8ff]'}`}>
                          {fmtPts(s.totalPoints)} pts
                        </div>
                        <div className={`text-[10px] ${isSelected ? 'text-sky-200' : 'text-slate-400'}`}>
                          {fmtInt(s.totalTasks)} tasks
                        </div>
                      </div>
                    </button>
                  );
                })
              )
            ) : (
              filteredSidebarBranches.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  No branches matching &quot;{sidebarSearch}&quot;
                </div>
              ) : (
                filteredSidebarBranches.map((b) => {
                  const isSelected = selectedBranchId === b.id;
                  const bStaffCount = filteredStaff.filter((s) => s.branchId === b.id).length;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => {
                        setSelectedBranchId(isSelected ? '' : b.id);
                        setSelectedStaffId('');
                      }}
                      className={`w-full text-left p-2.5 rounded-xl border transition-all flex items-center justify-between gap-2 cursor-pointer ${
                        isSelected
                          ? 'bg-[#003857] text-white border-[#003857] shadow-xs'
                          : 'bg-white dark:bg-slate-800/60 border-slate-200/80 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="font-bold truncate text-xs">
                          {cleanBranchName(b.name)}
                        </div>
                        <div className={`text-[10.5px] truncate font-mono ${isSelected ? 'text-sky-200' : 'text-slate-500'}`}>
                          Code {b.id} · {bStaffCount} staff
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {isSelected && <Check className="w-4 h-4 text-sky-300" />}
                      </div>
                    </button>
                  );
                })
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

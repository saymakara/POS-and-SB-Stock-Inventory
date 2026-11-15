import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useKeptMemo } from '../utils/useKeptMemo';
import { useSort, SortTh, type SortState } from '../utils/sort';
import {
  Device,
  Branch,
  Requisition,
  User,
  UserRole,
  ThemeMode,
  LifecycleStage,
  getBatteryLifecycleStatus,
} from '../types';
import { STAGE_META } from '../data/initialData';
import { GroupedBarChart, CrossChannelVelocityChart, CrossChannelDayPoint } from './Charts';
import { Odometer } from './Odometer';
import { PillMotion } from './PillMotion';
import { todayPP, lastMonthsPP } from '../utils/time';
import { fmtNum } from '../utils/format';
import { SPRING_TAB_PILL } from '../utils/animationRules';
import { buildPpDirectoryScope } from '../utils/fieldScope';
import { isSupabaseConfigured } from '../lib/supabase';
import { getCachedStaff, loadStaff, onStaffList } from '../services/staffCache';
import type { StaffAccount } from '../services/supabaseService';
import {
  KpiPeriod,
  KpiDashboardData,
  KpiRawCounts,
  KpiPointRule,
  kpiPeriodRange,
  computeKpiPoints,
  addExtraCounts,
  fetchKpiSummary,
  getCachedKpiSummary,
} from '../services/kpiService';
import { fetchCcCounts, getCachedCcCounts, type CcCounts } from '../services/ccService';
import {
  fetchMaterialBalances,
  fetchSerialsPage,
  fetchSerialStatusCounts,
  getCachedMaterialBalances,
  getCachedSerialsPage,
  getCachedSerialStatusCounts,
  MATERIALS,
  type MaterialBalance,
  type MaterialSerial,
  type SerialStatus,
} from '../services/materialsService';
import {
  BarChart3,
  TrendingUp,
  CheckCircle2,
  ArrowUpRight,
  Cpu,
  Volume2,
  QrCode,
  Store,
  CreditCard,
  Smartphone,
  BatteryCharging,
  FileSpreadsheet,
  Building2,
  ScrollText,
  Package,
  RefreshCw,
  AlertCircle,
  Boxes,
  ChevronRight,
  MapPin,
} from 'lucide-react';

/** Battery policy defaults (same values as AppSettings defaults). App can pass the live settings values as props. */
export const DEFAULT_BATTERY_LIFESPAN_MONTHS = 24;
export const DEFAULT_BATTERY_WARNING_MONTHS = 21;

export interface DashboardActionQueues {
  posFieldPending: number;
  sbFieldPending: number;
  ccPending: number;
  pushPosPending?: number;
  pushSbPending?: number;
  lostPos?: number;
  lostSb?: number;
  lostSim?: number;
}

interface DashboardTabProps {
  devices: Device[];
  allDevices: Device[];
  branches: Branch[];
  requisitions: Requisition[];
  users?: User[];
  excludedDeviceSerials?: Set<string>;
  role: UserRole;
  selectedBranch: string;
  theme?: ThemeMode;
  onSelectDevice: (serial: string) => void;
  onOpenExportModal: () => void;
  onNavigateTab?: (tab: string) => void;
  /** Battery change interval in months (AppSettings.batteryLifespanMonths). Default 24. */
  batteryLifespanMonths?: number;
  /** "Due soon" threshold in months (AppSettings.batteryWarningMonths). Default 21. */
  batteryWarningMonths?: number;
  serverTotalDevices?: number | null;
  serverStageCounts?: Record<LifecycleStage, number>;
  actionQueues?: DashboardActionQueues;
}

type DashPeriod = Extract<KpiPeriod, 'TODAY' | 'WEEK' | 'MONTH' | 'ALL'>;
type ChartMode = 'VELOCITY' | 'HARDWARE_MONTHLY';
type ActivityPanelMode = 'REQUISITIONS' | 'SERIALS';
type TimeHorizon = '3M' | '6M' | '12M';

const PERIOD_OPTIONS: { id: DashPeriod; label: string }[] = [
  { id: 'TODAY', label: 'Today' },
  { id: 'WEEK', label: 'Week' },
  { id: 'MONTH', label: 'Month' },
  { id: 'ALL', label: 'All' },
];

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtShortDay(ymd: string): string {
  const parts = ymd.split('-');
  if (parts.length !== 3) return ymd;
  const mIdx = Number(parts[1]) - 1;
  return `${SHORT_MONTHS[mIdx] || parts[1]} ${parts[2]}`;
}

function addDaysYmd(ymd: string, delta: number): string {
  const t = Date.parse(`${ymd}T00:00:00Z`);
  if (Number.isNaN(t)) return ymd;
  return new Date(t + delta * 86400000).toISOString().slice(0, 10);
}

function buildEmptyRawCounts(): KpiRawCounts {
  return {
    posInstall: 0,
    posReplace: 0,
    posBattery: 0,
    sbInstall: 0,
    sbReplace: 0,
    sbMaint: 0,
    sbReturn: 0,
    khqrInstall: 0,
    khqrReplace: 0,
    khqrMaterials: 0,
    ccPrimary: 0,
    ccSupp: 0,
  };
}

function sumRawInto(target: KpiRawCounts, src: KpiRawCounts): void {
  target.posInstall += src.posInstall;
  target.posReplace += src.posReplace;
  target.posBattery += src.posBattery;
  target.sbInstall += src.sbInstall;
  target.sbReplace += src.sbReplace;
  target.sbMaint += src.sbMaint;
  target.sbReturn += src.sbReturn;
  target.khqrInstall += src.khqrInstall;
  target.khqrReplace += src.khqrReplace;
  target.khqrMaterials += src.khqrMaterials;
  target.ccPrimary += src.ccPrimary;
  target.ccSupp += src.ccSupp;
  addExtraCounts(target, src);
}

const DONUT_RADIUS = 72;
const DONUT_CIRC = 2 * Math.PI * DONUT_RADIUS;

interface ChannelSliceItem {
  id: string;
  label: string;
  shortLabel: string;
  tab: string;
  hexColor: string;
  primaryValue: number;
  meta: string;
  sharePct: number;
  dash: number;
  offset: number;
}

interface BranchPerfRow {
  code: string;
  name: string;
  pos: number;
  sb: number;
  khqr: number;
  mv: number;
  cc: number;
  totalTasks: number;
  reserve: number;
  installed: number;
}

interface ChannelMixCardProps {
  isLight: boolean;
  cardClass: string;
  donutSlices: ChannelSliceItem[];
  leadChannel: ChannelSliceItem | undefined;
  totalTasks: number;
  ccSubmittedShow: number;
  onNavigateTab?: (tab: string) => void;
}

const ChannelMixCard = React.memo<ChannelMixCardProps>(({
  isLight,
  cardClass,
  donutSlices,
  leadChannel,
  totalTasks,
  ccSubmittedShow,
  onNavigateTab,
}) => {
  const [hoveredChannelId, setHoveredChannelId] = useState<string | null>(null);
  const focusedChannel = useMemo(
    () => (hoveredChannelId ? donutSlices.find((s) => s.id === hoveredChannelId) : undefined) || leadChannel,
    [hoveredChannelId, donutSlices, leadChannel]
  );

  return (
    <section className={`lg:col-span-5 ${cardClass} overflow-hidden flex flex-col justify-between`}>
      <div className="px-6 pt-5 pb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className={`text-sm sm:text-[15px] font-bold tracking-tight truncate ${isLight ? 'text-slate-900' : 'text-white'}`}>
            Channel Mix
          </h3>
          <p className="text-xs text-slate-500 truncate">
            5-channel contribution breakdown
          </p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <span
            className={`text-[11px] font-figure font-semibold px-2.5 py-0.5 rounded-full whitespace-nowrap ${
              isLight ? 'bg-slate-100/90 text-slate-600' : 'bg-slate-800 text-slate-300'
            }`}
          >
            {fmtNum(totalTasks)} tasks
          </span>
          {onNavigateTab && (
            <button
              type="button"
              onClick={() => onNavigateTab('kpi_performance')}
              className={`text-xs font-semibold inline-flex items-center gap-1 shrink-0 cursor-pointer transition-colors duration-150 ${
                isLight ? 'text-[#004e75] hover:text-[#003857]' : 'text-sky-400 hover:text-sky-300'
              }`}
            >
              Full KPI <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="px-6 pt-3 pb-6 flex-1 flex flex-col justify-center">
        <div className="flex flex-col sm:flex-row items-center gap-4 xl:gap-5">
          <div className="relative w-[176px] h-[176px] xl:w-[196px] xl:h-[196px] shrink-0 flex items-center justify-center">
            <svg
              viewBox="0 0 180 180"
              className="w-full h-full overflow-visible"
              role="img"
              aria-label="5-Channel Contribution Donut Chart"
              data-testid="channel-mix-donut"
            >
              <circle
                cx="90"
                cy="90"
                r={DONUT_RADIUS}
                fill="none"
                stroke={isLight ? 'rgba(15,23,42,0.045)' : '#1e293b'}
                strokeWidth="15"
              />
              {totalTasks > 0 &&
                donutSlices.map((slice) => {
                  if (slice.dash <= 0) return null;
                  const isFocused = focusedChannel?.id === slice.id && hoveredChannelId === slice.id;
                  const visibleDash = slice.dash > 2.4 ? slice.dash - 1.8 : slice.dash;
                  return (
                    <circle
                      key={slice.id}
                      cx="90"
                      cy="90"
                      r={DONUT_RADIUS}
                      fill="none"
                      stroke={slice.hexColor}
                      strokeWidth={isFocused ? 18 : 15}
                      strokeDasharray={`${visibleDash} ${DONUT_CIRC}`}
                      strokeDashoffset={-slice.offset}
                      transform="rotate(-90 90 90)"
                      opacity={hoveredChannelId && hoveredChannelId !== slice.id ? 0.42 : 1}
                      className="cursor-pointer transition-[stroke-width,opacity] duration-150"
                      onMouseEnter={() => setHoveredChannelId(slice.id)}
                      onMouseLeave={() => setHoveredChannelId(null)}
                      onClick={() => onNavigateTab?.(slice.tab)}
                    >
                      <title>{`${slice.label}: ${fmtNum(slice.primaryValue)} (${slice.sharePct}%)`}</title>
                    </circle>
                  );
                })}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-5">
              <span className={`text-[28px] xl:text-[31px] font-bold font-figure leading-none tracking-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>
                {focusedChannel ? `${focusedChannel.sharePct}%` : '0%'}
              </span>
              <span className="text-[10px] font-semibold tracking-wider uppercase text-slate-400 mt-1.5 truncate max-w-[116px]">
                {focusedChannel ? `${focusedChannel.shortLabel} SHARE` : 'NO TASKS'}
              </span>
            </div>
          </div>

          <div className={`w-full sm:w-auto sm:flex-1 min-w-0 divide-y ${isLight ? 'divide-slate-100/85' : 'divide-slate-800/70'}`}>
            {donutSlices.map((row) => {
              const isHovered = hoveredChannelId === row.id;
              const isDimmed = hoveredChannelId !== null && hoveredChannelId !== row.id;
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => onNavigateTab?.(row.tab)}
                  onMouseEnter={() => setHoveredChannelId(row.id)}
                  onMouseLeave={() => setHoveredChannelId(null)}
                  title={row.meta}
                  className={`w-full flex items-center justify-between gap-2 px-1.5 py-2.5 rounded-xl text-left transition-all duration-150 cursor-pointer ${
                    isHovered
                      ? isLight
                        ? 'bg-slate-50/95'
                        : 'bg-slate-800/60'
                      : ''
                  } ${isDimmed ? 'opacity-50' : 'opacity-100'}`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: row.hexColor }}
                    />
                    <span className={`text-[12.5px] font-medium truncate ${isLight ? 'text-slate-700' : 'text-slate-200'}`}>
                      {row.shortLabel === 'Visit'
                        ? 'Merchant Visit'
                        : row.shortLabel === 'CC'
                        ? 'Credit Card'
                        : row.shortLabel === 'POS'
                        ? 'POS Terminal'
                        : row.shortLabel}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] font-figure text-slate-400 tabular-nums">
                      {row.sharePct}%
                    </span>
                    <span className={`text-[12.5px] font-figure font-semibold tabular-nums text-right ${isLight ? 'text-slate-900' : 'text-white'}`}>
                      {row.id === 'cc' && ccSubmittedShow > 0
                        ? `${fmtNum(row.primaryValue)}/${fmtNum(ccSubmittedShow)}`
                        : fmtNum(row.primaryValue)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
});

interface TopBranchesCardProps {
  isLight: boolean;
  cardClass: string;
  segWrapClass: string;
  activePeriodLabel: string;
  branchViewMode: 'GRAPH' | 'TABLE';
  setBranchViewMode: (m: 'GRAPH' | 'TABLE') => void;
  sortedBranches: BranchPerfRow[];
  maxBranchTasks: number;
  brSort: SortState | null;
  brToggle: (k: string) => void;
  onNavigateTab?: (tab: string) => void;
}

const TopBranchesCard = React.memo<TopBranchesCardProps>(({
  isLight,
  cardClass,
  segWrapClass,
  activePeriodLabel,
  branchViewMode,
  setBranchViewMode,
  sortedBranches,
  maxBranchTasks,
  brSort,
  brToggle,
  onNavigateTab,
}) => {
  const [hoveredBranchCode, setHoveredBranchCode] = useState<string | null>(null);
  const hoveredBranch = useMemo(
    () => (hoveredBranchCode ? sortedBranches.find((b) => b.code === hoveredBranchCode) || null : null),
    [hoveredBranchCode, sortedBranches]
  );

  return (
    <section className={`lg:col-span-7 ${cardClass} overflow-hidden flex flex-col`}>
      <div className="px-6 pt-5 pb-3 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <Building2 className={`w-4 h-4 shrink-0 ${isLight ? 'text-[#003857]' : 'text-sky-300'}`} aria-hidden="true" />
          <div className="min-w-0">
            <h3 className={`text-sm sm:text-[15px] font-bold tracking-tight truncate ${isLight ? 'text-slate-900' : 'text-white'}`}>
              {branchViewMode === 'GRAPH'
                ? 'Top Branches — Visual Performance Graph'
                : 'Top Active Branches (All Channels)'}
            </h3>
            <p className="text-xs text-slate-500 truncate">
              {branchViewMode === 'GRAPH'
                ? `${activePeriodLabel} stacked cross-channel output · hover or click bar for detail`
                : `${activePeriodLabel} cross-channel volume alongside current branch hardware reserve`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <div className={segWrapClass} role="tablist" aria-label="Branch View Mode">
            {([
              { id: 'GRAPH' as const, label: 'Graph View' },
              { id: 'TABLE' as const, label: 'Table' },
            ]).map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={branchViewMode === m.id}
                onClick={() => setBranchViewMode(m.id)}
                className={`px-3 py-1 rounded-full font-semibold cursor-pointer transition-colors duration-150 whitespace-nowrap ${
                  branchViewMode === m.id
                    ? isLight
                      ? 'bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,0.08)]'
                      : 'bg-slate-800 text-white'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {onNavigateTab && (
            <button
              type="button"
              onClick={() => onNavigateTab('branches')}
              className="text-xs font-semibold text-[#004e75] hover:text-[#003857] inline-flex items-center gap-1 shrink-0 cursor-pointer transition-colors duration-150"
            >
              All Branches <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {branchViewMode === 'GRAPH' ? (
        <div className="flex-1 flex flex-col justify-between px-6 pb-5 pt-1 gap-3">
          <div className={`flex flex-wrap items-center justify-between gap-2 text-[11px] pb-2.5 border-b ${isLight ? 'border-slate-100' : 'border-slate-800'}`}>
            <div className="flex flex-wrap items-center gap-3 text-slate-500">
              <span className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-[#003857] inline-block" />KHQR</span>
              <span className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-[#3b6992] inline-block" />POS</span>
              <span className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-[#64748b] inline-block" />Sound Box</span>
              <span className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-[#a3b3c6] inline-block" />Visit</span>
              <span className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-[#b99763] inline-block" />CC</span>
            </div>
            <div className="text-[11px] font-medium text-slate-500 truncate max-w-full">
              {hoveredBranch ? (
                <span className="font-figure text-slate-700">
                  <strong className="text-slate-900">Code {hoveredBranch.code}</strong> ·{' '}
                  KHQR {fmtNum(hoveredBranch.khqr)} · POS {fmtNum(hoveredBranch.pos)} · SB {fmtNum(hoveredBranch.sb)} ·{' '}
                  MV {fmtNum(hoveredBranch.mv)} · CC {fmtNum(hoveredBranch.cc)} · Res {fmtNum(hoveredBranch.reserve)}
                </span>
              ) : (
                <span>Top {sortedBranches.length} Phnom Penh branches · scaled to peak branch</span>
              )}
            </div>
          </div>

          {sortedBranches.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400">
              No branch activity found for the selected scope.
            </div>
          ) : (
            <div className="space-y-2 flex-1 flex flex-col justify-center">
              {sortedBranches.map((b, i) => {
                const totalBarPct = b.totalTasks > 0 ? Math.max(1.5, (b.totalTasks / maxBranchTasks) * 100) : 0;
                const brTot = Math.max(1, b.totalTasks);
                const segs = [
                  { key: 'khqr', val: b.khqr, color: 'bg-[#003857]' },
                  { key: 'pos', val: b.pos, color: 'bg-[#3b6992]' },
                  { key: 'sb', val: b.sb, color: 'bg-[#64748b]' },
                  { key: 'mv', val: b.mv, color: 'bg-[#a3b3c6]' },
                  { key: 'cc', val: b.cc, color: 'bg-[#b99763]' },
                ].filter((s) => s.val > 0);
                const isHovered = hoveredBranchCode === b.code;

                return (
                  <button
                    key={b.code}
                    type="button"
                    data-branch-bar={b.code}
                    onMouseEnter={() => setHoveredBranchCode(b.code)}
                    onMouseLeave={() => setHoveredBranchCode(null)}
                    onClick={() => onNavigateTab?.('branches')}
                    title={`${b.name} (Code ${b.code}) — Total: ${fmtNum(b.totalTasks)} · KHQR ${fmtNum(b.khqr)} · POS ${fmtNum(b.pos)} · SB ${fmtNum(b.sb)} · MV ${fmtNum(b.mv)} · CC ${fmtNum(b.cc)} · Reserve ${fmtNum(b.reserve)}`}
                    className={`w-full flex items-center gap-3 px-2 py-1 rounded-xl transition-colors duration-150 cursor-pointer group ${
                      isHovered
                        ? isLight
                          ? 'bg-[#f3f6f9]'
                          : 'bg-slate-800/70'
                        : isLight
                        ? 'hover:bg-slate-50/70'
                        : 'hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="w-[170px] sm:w-[215px] shrink-0 text-left flex items-center gap-2 min-w-0">
                      <span
                        className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-figure font-bold shrink-0 ${
                          i === 0
                            ? 'bg-[#003857] text-white'
                            : i < 3
                            ? 'bg-slate-200/80 text-slate-700'
                            : 'text-slate-400'
                        }`}
                      >
                        {i + 1}
                      </span>
                      <span className={`text-[12px] font-semibold group-hover:text-[#004e75] transition-colors truncate ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                        {b.name}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400 shrink-0 hidden sm:inline">
                        Code {b.code}
                      </span>
                    </div>

                    <div className={`flex-1 h-2.5 rounded-full overflow-hidden flex items-center ${isLight ? 'bg-slate-100' : 'bg-slate-800'}`}>
                      {totalBarPct > 0 && (
                        <div
                          className="h-full rounded-full overflow-hidden flex gap-px transition-[width] duration-200"
                          style={{ width: `${totalBarPct}%` }}
                        >
                          {segs.map((seg) => (
                            <div
                              key={seg.key}
                              className={`h-full ${seg.color}`}
                              style={{ width: `${(seg.val / brTot) * 100}%` }}
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    <div className={`w-[54px] shrink-0 text-right font-figure text-[12.5px] font-bold tabular-nums ${isLight ? 'text-slate-900' : 'text-white'}`}>
                      {fmtNum(b.totalTasks)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto flex-1">
          <table className="dash-light-table w-full text-left border-collapse text-xs">
            <thead>
              <tr className="text-[10.5px] tracking-wider uppercase font-bold">
                <th className="py-2.5 pl-6 pr-2 w-10">#</th>
                <SortTh k="name" sort={brSort} onSort={brToggle} className="py-2.5 px-2 font-bold">Branch</SortTh>
                <SortTh k="khqr" sort={brSort} onSort={brToggle} align="right" className="py-2.5 px-2 font-bold">KHQR</SortTh>
                <SortTh k="pos" sort={brSort} onSort={brToggle} align="right" className="py-2.5 px-2 font-bold">POS</SortTh>
                <SortTh k="sb" sort={brSort} onSort={brToggle} align="right" className="py-2.5 px-2 font-bold">SB</SortTh>
                <SortTh k="mv" sort={brSort} onSort={brToggle} align="right" className="py-2.5 px-2 font-bold">MV</SortTh>
                <SortTh k="cc" sort={brSort} onSort={brToggle} align="right" className="py-2.5 px-2 font-bold">CC</SortTh>
                <SortTh k="reserve" sort={brSort} onSort={brToggle} align="right" className="py-2.5 px-2 font-bold">Reserve</SortTh>
                <SortTh k="total" sort={brSort} onSort={brToggle} align="right" className="py-2.5 pl-2 pr-6 font-bold">Tasks</SortTh>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedBranches.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-400">
                    No branch activity found for the selected scope.
                  </td>
                </tr>
              ) : (
                sortedBranches.map((b, i) => (
                  <tr key={b.code} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-2.5 pl-6 pr-2">
                      <span
                        className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10.5px] font-figure font-bold ${
                          i === 0
                            ? 'bg-[#003857] text-white'
                            : i < 3
                            ? 'bg-slate-200/80 text-slate-700'
                            : 'text-slate-400'
                        }`}
                      >
                        {i + 1}
                      </span>
                    </td>
                    <td className="py-2.5 px-2">
                      <div className="font-bold text-slate-900 truncate max-w-[180px]">{b.name}</div>
                      <div className="text-[10.5px] font-mono text-slate-400">Code {b.code}</div>
                    </td>
                    <td className="py-2.5 px-2 text-right font-figure text-[#003857] font-semibold">{fmtNum(b.khqr)}</td>
                    <td className="py-2.5 px-2 text-right font-figure text-[#3b6992] font-semibold">{fmtNum(b.pos)}</td>
                    <td className="py-2.5 px-2 text-right font-figure text-slate-600 font-semibold">{fmtNum(b.sb)}</td>
                    <td className="py-2.5 px-2 text-right font-figure text-slate-500 font-semibold">{fmtNum(b.mv)}</td>
                    <td className="py-2.5 px-2 text-right font-figure text-[#8a6a3b] font-semibold">{fmtNum(b.cc)}</td>
                    <td className="py-2.5 px-2 text-right font-figure text-slate-500">{fmtNum(b.reserve)}</td>
                    <td className="py-2.5 pl-2 pr-6 text-right font-figure font-extrabold text-slate-900">
                      {fmtNum(b.totalTasks)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
});

export const DashboardTab: React.FC<DashboardTabProps> = ({
  devices,
  allDevices,
  branches,
  requisitions,
  users = [],
  excludedDeviceSerials,
  role,
  selectedBranch,
  theme = 'light',
  onSelectDevice,
  onOpenExportModal,
  onNavigateTab,
  batteryLifespanMonths = DEFAULT_BATTERY_LIFESPAN_MONTHS,
  batteryWarningMonths = DEFAULT_BATTERY_WARNING_MONTHS,
  serverTotalDevices,
  serverStageCounts,
  actionQueues,
}) => {
  const today = todayPP();
  const isAdminLike = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const branchScopedId = !isAdminLike ? (selectedBranch || '') : '';

  const [period, setPeriod] = useState<DashPeriod>('MONTH');
  const [chartMode, setChartMode] = useState<ChartMode>('VELOCITY');
  const [timeHorizon, setTimeHorizon] = useState<TimeHorizon>('6M');
  const [activityPanel, setActivityPanel] = useState<ActivityPanelMode>('REQUISITIONS');
  const [branchViewMode, setBranchViewMode] = useState<'GRAPH' | 'TABLE'>('GRAPH');
  const [assetViewMode, setAssetViewMode] = useState<'ALLOCATION' | 'SERIALS'>('ALLOCATION');

  const [cachedStaff, setCachedStaff] = useState<StaffAccount[] | null>(() => getCachedStaff());
  useEffect(() => {
    const unsub = onStaffList(setCachedStaff);
    if (isAdminLike && isSupabaseConfigured && !getCachedStaff()) {
      void loadStaff({ maxAgeMs: 30000 }).then((x) => {
        if (x) setCachedStaff(x);
      });
    }
    return unsub;
  }, [isAdminLike]);

  // Dashboard always follows Phnom Penh + Active Staff Directory (matching KPI Performance & Inventory)
  const directoryUsers =
    isAdminLike || Boolean(cachedStaff?.length) || !isSupabaseConfigured ? users : [];
  const ppDirectoryScope = useMemo(
    () => buildPpDirectoryScope(branches, directoryUsers, cachedStaff),
    [branches, directoryUsers, cachedStaff]
  );

  const range = useMemo(() => kpiPeriodRange(period), [period]);

  const [kpiData, setKpiData] = useState<KpiDashboardData | null>(
    () => getCachedKpiSummary(range.from, range.to) || getCachedKpiSummary(null, null) || null
  );
  const [ccCounts, setCcCounts] = useState<CcCounts | null>(
    () => getCachedCcCounts(`${range.from || ''}|${range.to || ''}`) || null
  );
  // Instant 0ms cache hydration for materials & SIMs on tab revisit
  const [matBalances, setMatBalances] = useState<MaterialBalance[]>(
    () => getCachedMaterialBalances() || []
  );
  const [simRows, setSimRows] = useState<MaterialSerial[] | null>(
    () =>
      getCachedSerialsPage({
        code: 'SIM',
        branchId: branchScopedId || undefined,
        page: 1,
        pageSize: 1000,
      })?.rows || null
  );
  const [simFallbackCounts, setSimFallbackCounts] = useState<Record<SerialStatus, number> | null>(
    () => getCachedSerialStatusCounts('SIM', branchScopedId || undefined) || null
  );
  const [syncing, setSyncing] = useState(false);

  const periodSeqRef = useRef(0);
  const assetSeqRef = useRef(0);

  // Decoupled period metrics loader: period changes never refetch inventory/SIM pools
  const loadPeriodMetrics = useCallback(
    async (force = false) => {
      const seq = ++periodSeqRef.current;
      const isActive = () => seq === periodSeqRef.current;
      const hitKpi = !force ? getCachedKpiSummary(range.from, range.to) : undefined;
      const hitCc = !force ? getCachedCcCounts(`${range.from || ''}|${range.to || ''}`) : undefined;
      if (hitKpi) setKpiData(hitKpi);
      if (hitCc) setCcCounts(hitCc);
      setSyncing(!hitKpi || force);

      const kpiTask = fetchKpiSummary(range.from, range.to, force)
        .catch(() => fetchKpiSummary(range.from, range.to, true))
        .then((val) => {
          if (isActive() && val) setKpiData(val);
        });
      const ccTask = fetchCcCounts(range.from, range.to, force ? 0 : 45000).then((val) => {
        if (isActive() && val) setCcCounts(val);
      });

      await Promise.allSettled([kpiTask, ccTask]);
      if (isActive()) setSyncing(false);
    },
    [range.from, range.to]
  );

  // Period-independent material & SIM fleet loader
  const loadInventoryAndSims = useCallback(
    async (force = false) => {
      const seq = ++assetSeqRef.current;
      const isActive = () => seq === assetSeqRef.current;
      const simBranchArg = branchScopedId || undefined;

      const matTask = fetchMaterialBalances(force).then((val) => {
        if (isActive()) setMatBalances(val);
      });
      const simTask = fetchSerialsPage({ code: 'SIM', branchId: simBranchArg, page: 1, pageSize: 1000 }, force).then(
        async (res) => {
          if (!isActive()) return;
          if (res.total <= res.rows.length) {
            setSimRows(res.rows);
            setSimFallbackCounts(null);
          } else {
            setSimRows(null);
            const fallback = await fetchSerialStatusCounts('SIM', simBranchArg, force);
            if (isActive()) setSimFallbackCounts(fallback);
          }
        }
      );

      await Promise.allSettled([matTask, simTask]);
    },
    [branchScopedId]
  );

  const handleSyncAll = useCallback(async () => {
    setSyncing(true);
    await Promise.allSettled([loadPeriodMetrics(true), loadInventoryAndSims(true)]);
    setSyncing(false);
  }, [loadPeriodMetrics, loadInventoryAndSims]);

  useEffect(() => {
    void loadPeriodMetrics(false);
  }, [loadPeriodMetrics]);

  useEffect(() => {
    void loadInventoryAndSims(false);
  }, [loadInventoryAndSims]);

  // Idle background warm-up of sibling periods so Today/Week switches swap in 0ms
  useEffect(() => {
    if (!isSupabaseConfigured || !kpiData || syncing) return;
    let cancelled = false;
    const warm = () => {
      if (cancelled) return;
      for (const p of ['TODAY', 'WEEK'] as const) {
        if (p === period) continue;
        const r = kpiPeriodRange(p);
        if (!getCachedKpiSummary(r.from, r.to)) {
          void fetchKpiSummary(r.from, r.to, false).catch(() => {});
        }
        if (!getCachedCcCounts(`${r.from || ''}|${r.to || ''}`)) {
          void fetchCcCounts(r.from, r.to, 45000).catch(() => {});
        }
      }
    };
    const w = window as any;
    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(warm, { timeout: 1800 });
      return () => {
        cancelled = true;
        w.cancelIdleCallback?.(id);
      };
    }
    const timer = window.setTimeout(warm, 900);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [kpiData, syncing, period]);

  // Rule lookup map for KPI point valuation
  const ruleMap = useMemo(() => {
    const m = new Map<string, KpiPointRule>();
    for (const r of kpiData?.rules || []) m.set(r.code, r);
    return m;
  }, [kpiData]);

  // Scoped cross-channel KPI totals strictly matching Active Phnom Penh Staff Directory
  const scopedKpiTotals = useMemo(() => {
    const raw = buildEmptyRawCounts();
    let ccSubmitted = 0;
    let khqrFailed = 0;
    const activeBranches = new Set<string>();
    const activeStaff = new Set<string>();

    for (const s of kpiData?.staff || []) {
      const dir = ppDirectoryScope.resolveKpiStaff(s.staffId, s.staffName, s.branchId, s.branchName);
      if (!dir) continue;
      if (branchScopedId && dir.branchId !== branchScopedId) continue;

      sumRawInto(raw, s);
      ccSubmitted += s.ccSubmitted || 0;
      khqrFailed += s.khqrFailed || 0;
      const pts = computeKpiPoints(s, ruleMap);
      if (pts.totalTasks > 0) {
        const staffKey = dir.empId || dir.name.toLowerCase();
        if (staffKey) activeStaff.add(staffKey);
        if (dir.branchId && dir.branchId !== 'UNASSIGNED') activeBranches.add(dir.branchId);
      }
    }

    const computed = computeKpiPoints(raw, ruleMap);
    return {
      raw,
      computed,
      ccSubmitted,
      khqrFailed,
      activeBranchCount: activeBranches.size,
      activeStaffCount: activeStaff.size,
    };
  }, [kpiData, ppDirectoryScope, branchScopedId, ruleMap]);

  // 14-day / window Daily Cross-Channel Velocity time series (matches KPI Performance daily totals)
  const velocitySeries: CrossChannelDayPoint[] = useMemo(() => {
    const fallbackKpi = !kpiData?.dailyStaff?.length
      ? getCachedKpiSummary(kpiPeriodRange('MONTH').from, kpiPeriodRange('MONTH').to) ??
        getCachedKpiSummary(null, null)
      : undefined;
    const dailyStaff = (kpiData?.dailyStaff?.length ? kpiData.dailyStaff : fallbackKpi?.dailyStaff) || [];
    const fromYmd = range.from ? range.from.slice(0, 10) : '';
    const toYmd = range.to ? range.to.slice(0, 10) : '';
    const byDay = new Map<
      string,
      {
        pos: number;
        sb: number;
        khqr: number;
        mv: number;
        cc: number;
        staff: Set<string>;
        branches: Set<string>;
        staffCountHint?: number;
        branchCountHint?: number;
      }
    >();

    for (const ds of dailyStaff) {
      if (!ds.day) continue;
      if (fromYmd && ds.day < fromYmd) continue;
      if (toYmd && ds.day >= toYmd) continue;
      const dir = ppDirectoryScope.resolveKpiStaff(ds.staffId, ds.staffName, ds.branchId, ds.branchName);
      if (!dir) continue;
      if (branchScopedId && dir.branchId !== branchScopedId) continue;

      let b = byDay.get(ds.day);
      if (!b) {
        b = { pos: 0, sb: 0, khqr: 0, mv: 0, cc: 0, staff: new Set(), branches: new Set() };
        byDay.set(ds.day, b);
      }
      b.pos += Number(ds.posTasks) || 0;
      b.sb += Number(ds.sbTasks) || 0;
      b.khqr += Number(ds.khqrTasks) || 0;
      b.mv += Number(ds.mvTasks) || 0;
      b.cc += Number(ds.ccTasks) || 0;
      if ((ds.totalTasks || 0) > 0) {
        const staffKey = dir.empId || dir.name.toLowerCase();
        if (staffKey) b.staff.add(staffKey);
        if (dir.branchId && dir.branchId !== 'UNASSIGNED') b.branches.add(dir.branchId);
      }
    }

    // Only use pre-aggregated daily buckets if per-staff data & directory filtering are both unavailable
    if (dailyStaff.length === 0 && !ppDirectoryScope.hasDirectory && !branchScopedId) {
      const dailyBuckets = (kpiData?.daily?.length ? kpiData.daily : fallbackKpi?.daily) || [];
      for (const bucket of dailyBuckets) {
        if (!bucket.period) continue;
        if (fromYmd && bucket.period < fromYmd) continue;
        if (toYmd && bucket.period >= toYmd) continue;
        const pts = computeKpiPoints(bucket, ruleMap);
        if (pts.totalTasks <= 0 && (bucket.activeStaff || 0) <= 0) continue;
        byDay.set(bucket.period, {
          pos: pts.posTasks,
          sb: pts.sbTasks,
          khqr: pts.khqrTasks,
          mv: pts.mvTasks,
          cc: pts.ccTasks,
          staff: new Set(),
          branches: new Set(),
          staffCountHint: Number(bucket.activeStaff) || 0,
          branchCountHint: Number(bucket.activeBranches) || 0,
        });
      }
    }

    // Build contiguous 14-day window ending today (or last recorded day in range) for crisp chart spacing
    const endYmd = period === 'ALL' || !toYmd ? today : addDaysYmd(toYmd, -1);
    const windowDays = period === 'TODAY' ? 1 : period === 'WEEK' || period === 'ALL' ? 14 : 15;
    const daysOut: string[] = [];
    for (let i = windowDays - 1; i >= 0; i--) {
      const ymd = addDaysYmd(endYmd, -i);
      if (fromYmd && ymd < fromYmd) continue;
      daysOut.push(ymd);
    }

    return daysOut.map((ymd) => {
      const hit = byDay.get(ymd);
      return {
        label: fmtShortDay(ymd),
        fullLabel: ymd,
        pos: hit?.pos || 0,
        sb: hit?.sb || 0,
        khqr: hit?.khqr || 0,
        mv: hit?.mv || 0,
        cc: hit?.cc || 0,
        activeStaff: hit ? (hit.staffCountHint ?? hit.staff.size) : 0,
        activeBranches: hit ? (hit.branchCountHint ?? hit.branches.size) : 0,
      };
    });
  }, [kpiData, range.from, range.to, period, today, ppDirectoryScope, branchScopedId, ruleMap]);

  // Hardware & Inventory metrics (already scoped by App.tsx to Phnom Penh + Active Staff Directory)
  const hardwareSource = useMemo(
    () => (branchScopedId ? devices : allDevices.length > 0 ? allDevices : devices),
    [branchScopedId, allDevices, devices]
  );
  const activeDevices = useMemo(() => hardwareSource.filter((d) => !d.archived), [hardwareSource]);

  const hardwareSummary = useMemo(() => {
    let pos = 0;
    let sb = 0;
    const localStages: Record<LifecycleStage, number> = {
      HQ_STOCK: 0,
      BRANCH_RESERVE: 0,
      CONFIGURING: 0,
      COMPLETE: 0,
      FAULTY: 0,
      LOST: 0,
    };

    for (const d of activeDevices) {
      if (d.type === 'Sound Box') sb++;
      else pos++;
      if (d.stage in localStages) localStages[d.stage]++;
    }

    const stages = serverStageCounts || localStages;
    const total =
      typeof serverTotalDevices === 'number' && serverTotalDevices >= activeDevices.length
        ? serverTotalDevices
        : activeDevices.length;

    return {
      total,
      pos,
      sb,
      hq: stages.HQ_STOCK || 0,
      reserve: stages.BRANCH_RESERVE || 0,
      config: stages.CONFIGURING || 0,
      installed: stages.COMPLETE || 0,
      faulty: stages.FAULTY || 0,
      lost: stages.LOST || 0,
    };
  }, [activeDevices, serverStageCounts, serverTotalDevices]);

  // Monthly hardware install chart series (secondary toggle on chart panel)
  const monthlyHardwareChart = useMemo(() => {
    const months = lastMonthsPP(12);
    const map = new Map<string, { label: string; pos: number; sb: number }>();
    const list = months.map((m) => {
      const entry = { key: m.key, label: `${m.label.slice(0, 3)} ${m.label.slice(-2)}`, pos: 0, sb: 0 };
      map.set(m.key, entry);
      return entry;
    });
    for (const d of activeDevices) {
      if (d.stage !== 'COMPLETE' || !d.deployedDate) continue;
      const b = map.get(d.deployedDate.slice(0, 7));
      if (!b) continue;
      if (d.type === 'Sound Box') b.sb++;
      else b.pos++;
    }
    const sliced = timeHorizon === '3M' ? list.slice(-3) : timeHorizon === '6M' ? list.slice(-6) : list;
    return {
      labels: sliced.map((x) => x.label),
      pos: sliced.map((x) => x.pos),
      sb: sliced.map((x) => x.sb),
    };
  }, [activeDevices, timeHorizon]);

  // 24-Month POS Battery lifecycle health
  const batterySummary = useMemo(() => {
    let healthy = 0;
    let replaceSoon = 0;
    let critical = 0;
    let noDate = 0;
    for (const d of activeDevices) {
      if (d.type !== 'POS Terminal') continue;
      if (!d.batteryInstalledDate && !d.stockInDate && !d.deployedDate) {
        noDate++;
        continue;
      }
      const used = getBatteryLifecycleStatus(d, today).monthsUsed;
      if (used >= batteryLifespanMonths) critical++;
      else if (used >= batteryWarningMonths) replaceSoon++;
      else healthy++;
    }
    return { healthy, replaceSoon, critical, noDate, total: healthy + replaceSoon + critical };
  }, [activeDevices, today, batteryLifespanMonths, batteryWarningMonths]);

  // Scoped SIM counts following Phnom Penh + Active Staff Directory (same rules as SimCardTab)
  const simCounts = useMemo<Record<SerialStatus, number> | null>(() => {
    if (!simRows) return simFallbackCounts;
    const counts: Record<SerialStatus, number> = {
      HQ_STOCK: 0,
      IN_TRANSIT: 0,
      BRANCH_RESERVE: 0,
      AT_MERCHANT: 0,
      LOST: 0,
      FAULTY: 0,
      WRITTEN_OFF: 0,
    };
    for (const r of simRows) {
      if (branchScopedId && r.branchId !== branchScopedId) continue;
      if (!ppDirectoryScope.isBranchInScope(r.branchId)) continue;
      if (r.deviceSerial && excludedDeviceSerials?.has(r.deviceSerial.toUpperCase())) continue;
      if (r.status in counts) counts[r.status] += 1;
    }
    return counts;
  }, [simRows, simFallbackCounts, branchScopedId, ppDirectoryScope, excludedDeviceSerials]);

  // SIM & Materials Stock Summary
  const materialsSummary = useMemo(() => {
    const sim = simCounts || {
      HQ_STOCK: 0,
      IN_TRANSIT: 0,
      BRANCH_RESERVE: 0,
      AT_MERCHANT: 0,
      LOST: 0,
      FAULTY: 0,
      WRITTEN_OFF: 0,
    };
    const simOnHand = (sim.HQ_STOCK || 0) + (sim.BRANCH_RESERVE || 0);
    const simInTransit = sim.IN_TRANSIT || 0;
    const simAtMerchant = sim.AT_MERCHANT || 0;
    const simTotal = simOnHand + simInTransit + simAtMerchant + (sim.LOST || 0) + (sim.FAULTY || 0);

    let kitOnHand = 0;
    let kitInTransit = 0;
    let kitAtMerchant = 0;
    for (const row of matBalances) {
      if (row.code === 'SIM') continue;
      if (branchScopedId && row.branchId !== branchScopedId) continue;
      if (row.branchId !== '100' && !ppDirectoryScope.isBranchInScope(row.branchId)) continue;
      kitOnHand += row.onHand || 0;
      kitInTransit += row.inTransit || 0;
      kitAtMerchant += row.atMerchant || 0;
    }

    return {
      simTotal,
      simOnHand,
      simInTransit,
      simAtMerchant,
      kitOnHand,
      kitInTransit,
      kitAtMerchant,
      activeTypesCount: MATERIALS.length,
    };
  }, [simCounts, matBalances, branchScopedId, ppDirectoryScope]);

  // Requisitions & Action Queue totals
  const reqStats = useMemo(() => {
    const pending = requisitions.filter((r) => r.status === 'PENDING_ADMIN');
    const received = requisitions.filter((r) => r.status === 'RECEIVED').length;
    const rejected = requisitions.filter((r) => r.status === 'REJECTED').length;
    return { pending, received, rejected, total: requisitions.length };
  }, [requisitions]);

  const queues = useMemo(() => {
    const posField = actionQueues?.posFieldPending ?? 0;
    const sbField = actionQueues?.sbFieldPending ?? 0;
    const ccPend = Math.max(actionQueues?.ccPending ?? 0, ccCounts?.pendingAll ?? ccCounts?.pending ?? 0);
    const reqPend = reqStats.pending.length;
    const pushPend = (actionQueues?.pushPosPending ?? 0) + (actionQueues?.pushSbPending ?? 0);
    const lostOpen = (actionQueues?.lostPos ?? 0) + (actionQueues?.lostSb ?? 0) + (actionQueues?.lostSim ?? 0);
    const appTotal = posField + sbField + ccPend;
    return {
      posField,
      sbField,
      ccPend,
      reqPend,
      pushPend,
      lostOpen,
      appTotal,
      total: appTotal + reqPend,
    };
  }, [actionQueues, ccCounts, reqStats.pending.length]);

  // Strictly scoped 5-channel breakdown from Phnom Penh + Active Staff Directory KPI totals
  const channelActivity = useMemo(() => {
    const { computed, raw } = scopedKpiTotals;
    const khqrCount = computed.khqrTasks;
    const sbCount = computed.sbTasks;
    const posCount = computed.posTasks;
    const mvCount = computed.mvTasks;
    const ccCount = computed.ccTasks;
    const ccSubmittedShow = Math.max(scopedKpiTotals.ccSubmitted, ccCount);

    const totalTasks = khqrCount + sbCount + posCount + mvCount + ccCount;
    const pctOfTotal = (n: number) =>
      totalTasks > 0 ? Math.max(0, Number(((n / totalTasks) * 100).toFixed(1))) : 0;

    return {
      totalTasks,
      totalPoints: computed.totalPoints,
      khqrCount,
      khqrNew: raw.khqrInstall,
      khqrReplace: raw.khqrReplace,
      khqrMaterials: raw.khqrMaterials,
      sbCount,
      posCount,
      mvCount,
      ccCount,
      ccSubmittedShow,
      rows: [
        {
          id: 'khqr',
          label: 'KHQR Onboarding & Replace',
          shortLabel: 'KHQR',
          tab: 'mobile_sync_khqr',
          icon: QrCode,
          iconWrap: 'bg-[#003857]/10 text-[#003857]',
          barColor: 'bg-[#003857]',
          hexColor: '#003857',
          primaryValue: khqrCount,
          primaryUnit: 'tasks',
          meta: `${fmtNum(raw.khqrInstall)} new · ${fmtNum(raw.khqrReplace)} replace${raw.khqrMaterials > 0 ? ` · ${fmtNum(raw.khqrMaterials)} QR items` : ''}`,
          sharePct: pctOfTotal(khqrCount),
        },
        {
          id: 'sb',
          label: 'Sound Box Field & Stock',
          shortLabel: 'Sound Box',
          tab: 'mobile_sync_sb',
          icon: Volume2,
          iconWrap: 'bg-slate-500/10 text-slate-600',
          barColor: 'bg-[#64748b]',
          hexColor: '#64748b',
          primaryValue: sbCount,
          primaryUnit: 'tasks',
          meta: `${fmtNum(hardwareSummary.sb)} units in stock · ${fmtNum(queues.sbField)} awaiting review`,
          sharePct: pctOfTotal(sbCount),
        },
        {
          id: 'pos',
          label: 'POS Terminal Field & Stock',
          shortLabel: 'POS Terminal',
          tab: 'mobile_sync',
          icon: Cpu,
          iconWrap: 'bg-[#3b6992]/10 text-[#3b6992]',
          barColor: 'bg-[#3b6992]',
          hexColor: '#3b6992',
          primaryValue: posCount,
          primaryUnit: 'tasks',
          meta: `${fmtNum(hardwareSummary.pos)} units in stock · ${fmtNum(queues.posField)} awaiting review`,
          sharePct: pctOfTotal(posCount),
        },
        {
          id: 'mv',
          label: 'Merchant Visit',
          shortLabel: 'Merchant Visit',
          tab: 'mobile_sync_visit',
          icon: Store,
          iconWrap: 'bg-slate-400/15 text-slate-600',
          barColor: 'bg-[#a3b3c6]',
          hexColor: '#a3b3c6',
          primaryValue: mvCount,
          primaryUnit: 'visits',
          meta: 'Merchant check-ins & field onboarding visits',
          sharePct: pctOfTotal(mvCount),
        },
        {
          id: 'cc',
          label: 'Credit Card Acquisition',
          shortLabel: 'Credit Card',
          tab: 'mobile_sync_cc',
          icon: CreditCard,
          iconWrap: 'bg-[#b99763]/15 text-[#8a6a3b]',
          barColor: 'bg-[#b99763]',
          hexColor: '#b99763',
          primaryValue: ccCount,
          primaryUnit: 'onboarded',
          meta: `${fmtNum(ccSubmittedShow)} applications · ${fmtNum(queues.ccPend)} pending${ccCounts?.waitingDocs ? ` · ${fmtNum(ccCounts.waitingDocs)} waiting docs` : ''}`,
          sharePct: pctOfTotal(ccCount),
        },
      ],
    };
  }, [scopedKpiTotals, ccCounts, hardwareSummary.sb, hardwareSummary.pos, queues]);

  // Top Active Branches across ALL channels (merging branch stock counts alongside KPI activity!)
  const branchLeaderboard = useMemo(() => {
    const stockByBranch = new Map<string, { reserve: number; installed: number; totalDevices: number; name: string }>();
    const branchSrc = isAdminLike ? allDevices : devices;
    for (const b of branches) {
      stockByBranch.set(b.code, { reserve: 0, installed: 0, totalDevices: 0, name: b.name });
    }
    for (const d of branchSrc) {
      if (d.archived) continue;
      const cur = stockByBranch.get(d.branchId) || { reserve: 0, installed: 0, totalDevices: 0, name: `Branch ${d.branchId}` };
      cur.totalDevices++;
      if (d.stage === 'BRANCH_RESERVE') cur.reserve++;
      else if (d.stage === 'COMPLETE') cur.installed++;
      stockByBranch.set(d.branchId, cur);
    }

    const agg = new Map<
      string,
      {
        code: string;
        name: string;
        pos: number;
        sb: number;
        khqr: number;
        mv: number;
        cc: number;
        totalTasks: number;
        reserve: number;
        installed: number;
      }
    >();

    for (const s of kpiData?.staff || []) {
      const dir = ppDirectoryScope.resolveKpiStaff(s.staffId, s.staffName, s.branchId, s.branchName);
      if (!dir) continue;
      const code = dir.branchId || 'UNASSIGNED';
      if (code === 'UNASSIGNED') continue;
      if (branchScopedId && code !== branchScopedId) continue;
      const pts = computeKpiPoints(s, ruleMap);
      const stock = stockByBranch.get(code);
      const row = agg.get(code) || {
        code,
        name: stock?.name || s.branchName || `Branch ${code}`,
        pos: 0,
        sb: 0,
        khqr: 0,
        mv: 0,
        cc: 0,
        totalTasks: 0,
        reserve: stock?.reserve || 0,
        installed: stock?.installed || 0,
      };
      row.pos += pts.posTasks;
      row.sb += pts.sbTasks;
      row.khqr += pts.khqrTasks;
      row.mv += pts.mvTasks;
      row.cc += pts.ccTasks;
      row.totalTasks += pts.totalTasks;
      agg.set(code, row);
    }

    // Ensure branches with stock (or fallback offline mode) still appear if KPI list is sparse
    if (agg.size === 0) {
      for (const b of branches) {
        if (b.code === '100' || !ppDirectoryScope.isBranchInScope(b.code, b.name)) continue;
        if (branchScopedId && b.code !== branchScopedId) continue;
        const st = stockByBranch.get(b.code);
        agg.set(b.code, {
          code: b.code,
          name: b.name,
          pos: 0,
          sb: 0,
          khqr: 0,
          mv: 0,
          cc: 0,
          totalTasks: 0,
          reserve: st?.reserve || 0,
          installed: st?.installed || 0,
        });
      }
    }

    return Array.from(agg.values())
      .sort((a, b) => b.totalTasks - a.totalTasks || b.installed - a.installed || b.reserve - a.reserve)
      .slice(0, 8);
  }, [kpiData, branches, allDevices, devices, isAdminLike, ppDirectoryScope, ruleMap, branchScopedId]);

  const { sorted: sortedBranches, sort: brSort, toggle: brToggle } = useSort<(typeof branchLeaderboard)[number]>(
    branchLeaderboard,
    {
      code: (b) => Number(b.code) || b.code,
      name: (b) => b.name,
      pos: (b) => b.pos,
      sb: (b) => b.sb,
      khqr: (b) => b.khqr,
      mv: (b) => b.mv,
      cc: (b) => b.cc,
      total: (b) => b.totalTasks,
      reserve: (b) => b.reserve,
    }
  );

  // Recent updated serials (fast O(N) top-6 single-pass scan preserved)
  const recentDevices = useKeptMemo('dash.recent', () => {
    const getSortKey = (d: Device) => `${d.updatedAt || d.deployedDate || d.pushDate || d.stockInDate || ''}__${d.serial}`;
    const top: Device[] = [];
    const keys: string[] = [];
    for (let i = 0; i < activeDevices.length; i++) {
      const dev = activeDevices[i];
      const key = getSortKey(dev);
      if (top.length < 6) {
        top.push(dev);
        keys.push(key);
        if (top.length === 6) {
          for (let m = 0; m < 5; m++) {
            for (let n = m + 1; n < 6; n++) {
              if (keys[m].localeCompare(keys[n]) < 0) {
                [top[m], top[n]] = [top[n], top[m]];
                [keys[m], keys[n]] = [keys[n], keys[m]];
              }
            }
          }
        }
      } else if (key.localeCompare(keys[5]) > 0) {
        top[5] = dev;
        keys[5] = key;
        for (let m = 5; m > 0; m--) {
          if (keys[m].localeCompare(keys[m - 1]) > 0) {
            [top[m], top[m - 1]] = [top[m - 1], top[m]];
            [keys[m], keys[m - 1]] = [keys[m - 1], keys[m]];
          } else break;
        }
      }
    }
    return top;
  }, [activeDevices]);

  const activePeriodLabel = PERIOD_OPTIONS.find((p) => p.id === period)?.label || 'This Month';
  const branchScopeDisplay = branchScopedId
    ? `Branch Code ${branchScopedId}`
    : `Phnom Penh · ${fmtNum(branches.length)} branches`;

  const reachTotal =
    channelActivity.khqrCount + channelActivity.mvCount + channelActivity.ccSubmittedShow;
  const reachSharePct =
    channelActivity.totalTasks > 0
      ? Math.min(100, Math.round(((channelActivity.khqrCount + channelActivity.mvCount + channelActivity.ccCount) / channelActivity.totalTasks) * 100))
      : 0;

  const velocityPeak = useMemo(() => {
    let peakVal = 0;
    let peakLabel = '';
    let sumStaff = 0;
    let activeDays = 0;
    for (const pt of velocitySeries) {
      const tot = pt.pos + pt.sb + pt.khqr + pt.mv + pt.cc;
      if (tot > peakVal) {
        peakVal = tot;
        peakLabel = pt.label;
      }
      if (pt.activeStaff > 0) {
        sumStaff += pt.activeStaff;
        activeDays++;
      }
    }
    return {
      peakVal,
      peakLabel,
      avgStaff: activeDays > 0 ? Math.round(sumStaff / activeDays) : 0,
    };
  }, [velocitySeries]);

  const { donutSlices, leadChannel } = useMemo(() => {
    const total = channelActivity.totalTasks;
    let accOffset = 0;
    const slices: ChannelSliceItem[] = channelActivity.rows.map((r) => {
      const dash = total > 0 && r.primaryValue > 0 ? (r.primaryValue / total) * DONUT_CIRC : 0;
      const slice: ChannelSliceItem = {
        id: r.id,
        label: r.label,
        shortLabel: r.shortLabel,
        tab: r.tab,
        hexColor: r.hexColor,
        primaryValue: r.primaryValue,
        meta: r.meta,
        sharePct: r.sharePct,
        dash,
        offset: accOffset,
      };
      accOffset += dash;
      return slice;
    });
    const lead =
      [...slices].sort((a, b) => b.primaryValue - a.primaryValue)[0] || slices[0];
    return { donutSlices: slices, leadChannel: lead };
  }, [channelActivity.rows, channelActivity.totalTasks]);

  const maxBranchTasks = useMemo(
    () => Math.max(1, ...sortedBranches.map((b) => b.totalTasks)),
    [sortedBranches]
  );

  const allocationRows = useMemo(() => {
    const hwTot = Math.max(1, hardwareSummary.total);
    const simTot = Math.max(1, materialsSummary.simTotal);
    const batTot = Math.max(1, batterySummary.total);
    const pct = (part: number, whole: number) => Math.round((part / Math.max(1, whole)) * 100);
    return [
      {
        id: 'hardware',
        title: `Hardware Stock Allocation (${fmtNum(hardwareSummary.total)} units)`,
        rightText:
          hardwareSummary.total > 0
            ? `${pct(hardwareSummary.hq, hwTot)}% HQ · ${pct(hardwareSummary.reserve, hwTot)}% Res · ${pct(hardwareSummary.config, hwTot)}% Cfg`
            : 'No units tracked',
        subtext: `HQ ${fmtNum(hardwareSummary.hq)} · Reserve ${fmtNum(hardwareSummary.reserve)} · Config ${fmtNum(hardwareSummary.config)} · Live ${fmtNum(hardwareSummary.installed)}`,
        icon: Boxes,
        iconClass: 'text-slate-500',
        segments:
          hardwareSummary.total > 0
            ? [
                { key: 'hq', label: 'HQ', val: hardwareSummary.hq, pct: (hardwareSummary.hq / hwTot) * 100, color: 'bg-[#003857]' },
                { key: 'res', label: 'Reserve', val: hardwareSummary.reserve, pct: (hardwareSummary.reserve / hwTot) * 100, color: 'bg-[#4f789d]' },
                { key: 'cfg', label: 'Config', val: hardwareSummary.config, pct: (hardwareSummary.config / hwTot) * 100, color: 'bg-[#a3b3c6]' },
                { key: 'live', label: 'Live', val: hardwareSummary.installed, pct: (hardwareSummary.installed / hwTot) * 100, color: 'bg-[#4a7369]' },
              ]
            : [],
      },
      {
        id: 'sim',
        title: `SIM Card Fleet Distribution (${fmtNum(materialsSummary.simTotal)} tracked)`,
        rightText:
          materialsSummary.simTotal > 0
            ? `${pct(materialsSummary.simAtMerchant, simTot)}% Merchant Live`
            : '0 tracked',
        subtext: `${fmtNum(materialsSummary.simOnHand)} in stock · ${fmtNum(materialsSummary.simInTransit)} in transit · ${fmtNum(materialsSummary.simAtMerchant)} at merchant`,
        icon: Smartphone,
        iconClass: 'text-slate-500',
        onClickTab: 'sim_cards',
        segments:
          materialsSummary.simTotal > 0
            ? [
                { key: 'stock', label: 'In Stock', val: materialsSummary.simOnHand, pct: (materialsSummary.simOnHand / simTot) * 100, color: 'bg-[#3b6992]' },
                { key: 'transit', label: 'In Transit', val: materialsSummary.simInTransit, pct: (materialsSummary.simInTransit / simTot) * 100, color: 'bg-[#b99763]' },
                { key: 'merchant', label: 'At Merchant', val: materialsSummary.simAtMerchant, pct: (materialsSummary.simAtMerchant / simTot) * 100, color: 'bg-[#003857]' },
              ]
            : [],
      },
      {
        id: 'battery',
        title: `${batteryLifespanMonths}M POS Battery SLA Compliance`,
        rightText:
          batterySummary.total > 0
            ? `${pct(batterySummary.healthy, batTot)}% Healthy (${fmtNum(batterySummary.healthy)})`
            : '0 dated',
        subtext: `Healthy <${batteryWarningMonths}M: ${fmtNum(batterySummary.healthy)} · Due Soon: ${fmtNum(batterySummary.replaceSoon)} · Replace >=${batteryLifespanMonths}M: ${fmtNum(batterySummary.critical)}`,
        icon: BatteryCharging,
        iconClass: 'text-slate-500',
        segments:
          batterySummary.total > 0
            ? [
                { key: 'healthy', label: 'Healthy', val: batterySummary.healthy, pct: (batterySummary.healthy / batTot) * 100, color: 'bg-[#4a7369]' },
                { key: 'soon', label: 'Due Soon', val: batterySummary.replaceSoon, pct: (batterySummary.replaceSoon / batTot) * 100, color: 'bg-[#b99763]' },
                { key: 'critical', label: 'Replace', val: batterySummary.critical, pct: (batterySummary.critical / batTot) * 100, color: 'bg-[#9e535c]' },
              ]
            : [],
      },
    ];
  }, [hardwareSummary, materialsSummary, batterySummary, batteryLifespanMonths, batteryWarningMonths]);

  const isLight = theme !== 'dark';
  const iosCardClass = isLight
    ? 'rounded-[22px] bg-white border border-slate-200/70 shadow-[0_1px_10px_rgba(15,23,42,0.025)] text-slate-900'
    : 'rounded-[22px] bg-[#161a24] border border-slate-800 text-slate-100';
  const iosSegWrapClass = isLight
    ? 'inline-flex items-center p-0.5 rounded-full bg-slate-100/90 border border-slate-200/50 text-[11px] shrink-0'
    : 'inline-flex items-center p-0.5 rounded-full bg-slate-900/80 border border-slate-700/80 text-[11px] shrink-0';
  const kpiCardClass = isLight
    ? 'bg-[#f8f9fb] border border-slate-200/55 text-[#0f172a]'
    : 'bg-[#1e2330] border border-slate-800 text-slate-100';
  const kpiHeadingClass = isLight ? 'text-[#0f172a]' : 'text-white';
  const kpiSubtextClass = isLight ? 'text-slate-500' : 'text-slate-400';
  const kpiFooterBorderClass = isLight ? 'border-slate-200/50' : 'border-slate-800/80';

  return (
    <div className="space-y-5 apple-tab-panel" aria-label="Executive Operations Overview">
      {/* ───────────── 1 & 2. iOS MINIMAL HERO + 4 INSET KPI SQUIRCLES ───────────── */}
      <div
        data-hero-backdrop="dashboard"
        className={`relative overflow-hidden rounded-3xl p-5 sm:p-6 border ${
          isLight
            ? 'bg-white border-slate-200/75 text-slate-900 shadow-[0_1px_10px_rgba(15,23,42,0.025)]'
            : 'bg-[#161a24] border-slate-800 text-slate-100'
        }`}
      >
        <div className="relative z-10 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <h1 className={`text-2xl sm:text-[26px] font-bold tracking-tight flex items-center gap-2.5 leading-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>
              <BarChart3 className={`w-6 h-6 sm:w-7 sm:h-7 shrink-0 ${isLight ? 'text-[#003857]' : 'text-sky-300'}`} aria-hidden="true" />
              <span>
                {branchScopedId
                  ? `Branch Code ${branchScopedId} Operations Overview`
                  : 'Executive Operations Overview'}
              </span>
            </h1>
            <p className={`text-sm leading-relaxed ${isLight ? 'text-slate-500' : 'text-slate-300'}`}>
              <span className={`font-semibold ${isLight ? 'text-slate-700' : 'text-slate-200'}`}>{branchScopeDisplay}</span>
              <span className="mx-1.5 text-slate-400" aria-hidden="true">·</span>
              <span>{fmtNum(scopedKpiTotals.activeStaffCount)} active staff across 5 field channels</span>
            </p>
          </div>

          <div className="flex flex-wrap xl:flex-nowrap xl:justify-end items-center gap-2 shrink-0">
            {/* iOS Period Pill Switcher */}
            <div
              className={`inline-flex items-center p-1 rounded-full border gap-0.5 ${
                isLight
                  ? 'bg-slate-100/90 border-slate-200/60'
                  : 'bg-slate-900/80 border-slate-700'
              }`}
              role="tablist"
              aria-label="Dashboard Time Period"
            >
              {PERIOD_OPTIONS.map((opt) => {
                const active = period === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setPeriod(opt.id)}
                    className={`relative px-3 py-1 rounded-full text-xs cursor-pointer transition-colors duration-150 ${
                      active
                        ? isLight
                          ? 'text-slate-900 font-bold'
                          : 'text-white font-bold'
                        : `${isLight ? 'text-slate-500 hover:text-slate-900' : 'text-slate-300 hover:text-white'} font-medium`
                    }`}
                  >
                    {active && (
                      <PillMotion
                        layoutId="dash-period-pill"
                        transition={SPRING_TAB_PILL}
                        className={`absolute inset-0 rounded-full pointer-events-none ${
                          isLight
                            ? 'bg-white shadow-[0_1px_4px_rgba(15,23,42,0.09)]'
                            : 'bg-slate-800 shadow-2xs'
                        }`}
                      />
                    )}
                    <span className="relative z-10">{opt.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Directory Scope Badge (Admin HQ) */}
            {isAdminLike && !branchScopedId && (
              <span
                className={`inline-flex items-center gap-1.5 text-xs rounded-full border px-3.5 py-1.5 font-semibold whitespace-nowrap ${
                  isLight
                    ? 'border-slate-200/70 bg-[#f8f9fb] text-slate-700'
                    : 'border-slate-700 bg-slate-900/80 text-slate-200'
                }`}
                title="Scoped to active Phnom Penh staff from the Staff Directory"
              >
                <MapPin className={`w-3.5 h-3.5 shrink-0 ${isLight ? 'text-[#003857]' : 'text-sky-300'}`} aria-hidden="true" />
                <span>Phnom Penh · Staff Directory</span>
              </span>
            )}

            <button
              type="button"
              onClick={() => void handleSyncAll()}
              className={`btn-press px-3.5 py-1.5 rounded-full text-xs font-semibold border inline-flex items-center gap-1.5 cursor-pointer transition-colors duration-150 ${
                isLight
                  ? 'border-slate-200/70 bg-[#f8f9fb] hover:bg-slate-100 text-slate-700'
                  : 'border-slate-700 bg-slate-900/80 hover:bg-slate-800 text-slate-200'
              }`}
              title="Refresh live summary counts"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLight ? 'text-slate-500' : 'text-slate-400'} ${syncing ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>Sync</span>
            </button>

            {isAdminLike && (
              <button
                type="button"
                onClick={onOpenExportModal}
                className={`btn-press px-3.5 py-1.5 rounded-full text-xs font-semibold border inline-flex items-center gap-1.5 cursor-pointer transition-colors duration-150 ${
                  isLight
                    ? 'border-slate-200/70 bg-[#f8f9fb] hover:bg-slate-100 text-slate-800'
                    : 'border-slate-700 bg-slate-900/80 hover:bg-slate-800 text-slate-100'
                }`}
                title="Export Reports & Data"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" />
                <span>Export</span>
              </button>
            )}
          </div>
        </div>

        {/* 4 Inset iOS KPI Squircles */}
        <section
          className="relative z-10 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5 mt-5"
          aria-label="Key portal metrics"
        >
          {/* KPI 1: Field Tasks */}
          <div className={`${kpiCardClass} rounded-[18px] px-4 py-3.5 flex flex-col justify-between min-w-0`}>
            <div>
              <div className="flex items-center justify-between gap-2">
                <span data-kpi-title className={`text-xs font-semibold ${kpiSubtextClass}`}>
                  Field Tasks · {activePeriodLabel}
                </span>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isLight ? 'bg-slate-200/70 text-slate-700' : 'bg-slate-800 text-slate-300'}`}>
                  <TrendingUp className="w-3.5 h-3.5" aria-hidden="true" />
                </div>
              </div>
              <div className={`text-2xl sm:text-[28px] font-bold font-figure tabular-nums tracking-tight mt-2 leading-tight ${kpiHeadingClass}`}>
                <Odometer value={channelActivity.totalTasks} format duration={220} />
              </div>
            </div>
            <div className={`flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px] ${kpiSubtextClass} mt-2.5 pt-2 border-t ${kpiFooterBorderClass}`}>
              <span>{fmtNum(scopedKpiTotals.activeBranchCount || branches.length)} branches · {fmtNum(scopedKpiTotals.activeStaffCount)} staff</span>
              <span className={`font-semibold whitespace-nowrap ${isLight ? 'text-[#003857]' : 'text-slate-200'}`}>{fmtNum(Math.round(channelActivity.totalPoints))} pts</span>
            </div>
          </div>

          {/* KPI 2: Pending Approvals */}
          <div className={`${kpiCardClass} rounded-[18px] px-4 py-3.5 flex flex-col justify-between min-w-0`}>
            <div>
              <div className="flex items-center justify-between gap-2">
                <span data-kpi-title className={`text-xs font-semibold ${kpiSubtextClass}`}>
                  Pending Approvals
                </span>
                {queues.total > 0 ? (
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isLight ? 'bg-[#b99763]/15 text-[#8a6a3b]' : 'bg-[#b99763]/20 text-[#d4b078]'}`}>
                    <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
                  </div>
                ) : (
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isLight ? 'bg-slate-200/70 text-slate-700' : 'bg-slate-800 text-slate-300'}`}>
                    <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </div>
                )}
              </div>
              <div className={`text-2xl sm:text-[28px] font-bold font-figure tabular-nums tracking-tight mt-2 leading-tight ${kpiHeadingClass}`}>
                <Odometer value={queues.total} format duration={220} />
              </div>
            </div>
            <div className={`flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px] ${kpiSubtextClass} mt-2.5 pt-2 border-t ${kpiFooterBorderClass}`}>
              <span>{fmtNum(queues.appTotal)} App · {fmtNum(queues.reqPend)} Stock Req</span>
              {queues.total > 0 ? (
                <span className={`font-semibold whitespace-nowrap ${isLight ? 'text-[#8a6a3b]' : 'text-[#d4b078]'}`}>Action needed</span>
              ) : (
                <span className={`font-semibold whitespace-nowrap ${isLight ? 'text-[#4a7369]' : 'text-slate-300'}`}>All clear</span>
              )}
            </div>
          </div>

          {/* KPI 3: Hardware Pool */}
          <div className={`${kpiCardClass} rounded-[18px] px-4 py-3.5 flex flex-col justify-between min-w-0`}>
            <div>
              <div className="flex items-center justify-between gap-2">
                <span data-kpi-title className={`text-xs font-semibold ${kpiSubtextClass}`}>
                  Hardware Pool
                </span>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isLight ? 'bg-slate-200/70 text-slate-700' : 'bg-slate-800 text-slate-300'}`}>
                  <Boxes className="w-3.5 h-3.5" aria-hidden="true" />
                </div>
              </div>
              <div className={`text-2xl sm:text-[28px] font-bold font-figure tabular-nums tracking-tight mt-2 leading-tight ${kpiHeadingClass}`}>
                <Odometer value={hardwareSummary.total} format duration={220} />
              </div>
            </div>
            <div className={`flex flex-wrap items-center justify-between gap-x-1.5 gap-y-0.5 text-[11px] ${kpiSubtextClass} mt-2.5 pt-2 border-t ${kpiFooterBorderClass}`}>
              <span>{fmtNum(hardwareSummary.hq)} HQ · {fmtNum(hardwareSummary.reserve)} Res · {fmtNum(hardwareSummary.installed)} Live</span>
              {queues.pushPend > 0 ? (
                <button
                  type="button"
                  onClick={() => onNavigateTab?.('push_configuring')}
                  className={`font-semibold hover:underline cursor-pointer whitespace-nowrap ${isLight ? 'text-[#003857]' : 'text-slate-200'}`}
                >
                  {fmtNum(queues.pushPend)} push
                </button>
              ) : (
                <span className={`font-semibold whitespace-nowrap ${isLight ? 'text-slate-700' : 'text-slate-200'}`}>
                  {fmtNum(materialsSummary.simTotal)} SIM
                </span>
              )}
            </div>
          </div>

          {/* KPI 4: Merchant Outreach */}
          <div className={`${kpiCardClass} rounded-[18px] px-4 py-3.5 flex flex-col justify-between min-w-0`}>
            <div>
              <div className="flex items-center justify-between gap-2">
                <span data-kpi-title className={`text-xs font-semibold ${kpiSubtextClass}`}>
                  Merchant Outreach
                </span>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isLight ? 'bg-slate-200/70 text-slate-700' : 'bg-slate-800 text-slate-300'}`}>
                  <Store className="w-3.5 h-3.5" aria-hidden="true" />
                </div>
              </div>
              <div className={`text-2xl sm:text-[28px] font-bold font-figure tabular-nums tracking-tight mt-2 leading-tight ${kpiHeadingClass}`}>
                <Odometer value={reachTotal} format duration={220} />
              </div>
            </div>
            <div className={`flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px] ${kpiSubtextClass} mt-2.5 pt-2 border-t ${kpiFooterBorderClass}`}>
              <span>{fmtNum(channelActivity.khqrCount)} KHQR · {fmtNum(channelActivity.mvCount)} Visits · {fmtNum(channelActivity.ccCount)}/{fmtNum(channelActivity.ccSubmittedShow)} CC</span>
              <span className={`font-semibold whitespace-nowrap ${isLight ? 'text-[#003857]' : 'text-slate-200'}`}>{reachSharePct}%</span>
            </div>
          </div>
        </section>
      </div>

      {/* ───────────── 3. ROW 1: CROSS-CHANNEL DAILY VELOCITY + CHANNEL SHARE DONUT & QUEUE LOAD ───────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left 7 Cols: Cross-Channel Daily Velocity & Active Staff */}
        <section className={`lg:col-span-7 ${iosCardClass} overflow-hidden flex flex-col`}>
          <div className="px-6 pt-5 pb-2.5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                  isLight ? 'bg-[#003857]/8 text-[#003857]' : 'bg-sky-500/15 text-sky-400'
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3
                  className={`text-[15px] font-bold tracking-[-0.015em] truncate ${
                    isLight ? 'text-slate-900' : 'text-white'
                  }`}
                >
                  {chartMode === 'VELOCITY'
                    ? 'Cross-Channel Daily Velocity & Active Staff'
                    : 'Monthly Hardware Deployments (POS vs SB)'}
                </h3>
                <p
                  className={`text-[12px] truncate ${
                    isLight ? 'text-slate-500' : 'text-slate-400'
                  }`}
                >
                  {chartMode === 'VELOCITY'
                    ? 'Daily 5-channel volume trajectory with active staff trendline'
                    : 'Completed merchant installs over selected horizon'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {chartMode === 'HARDWARE_MONTHLY' && (
                <div className={`${iosSegWrapClass} text-[11px] shrink-0`}>
                  {(['3M', '6M', '12M'] as TimeHorizon[]).map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setTimeHorizon(h)}
                      className={`px-2.5 py-1 rounded-full font-semibold cursor-pointer transition-all duration-150 whitespace-nowrap ${
                        timeHorizon === h
                          ? 'bg-[#003857] text-white shadow-2xs'
                          : isLight
                          ? 'text-slate-600 hover:text-slate-900'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {h}
                    </button>
                  ))}
                </div>
              )}

              <div
                className={`${iosSegWrapClass} text-[11px] shrink-0`}
                role="tablist"
                aria-label="Chart View Mode"
              >
                {([
                  { id: 'VELOCITY' as const, label: '5 Channels' },
                  { id: 'HARDWARE_MONTHLY' as const, label: 'Monthly Hardware' },
                ]).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="tab"
                    aria-selected={chartMode === m.id}
                    onClick={() => setChartMode(m.id)}
                    className={`px-3 py-1 rounded-full font-semibold cursor-pointer transition-all duration-150 whitespace-nowrap ${
                      chartMode === m.id
                        ? isLight
                          ? 'bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,0.08)]'
                          : 'bg-slate-700 text-white shadow-xs'
                        : isLight
                        ? 'text-slate-500 hover:text-slate-900'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="px-6 pt-1 pb-5 flex-1 flex flex-col justify-between">
            {chartMode === 'VELOCITY' && (
              <div
                className={`flex flex-wrap items-center justify-between gap-2 pb-2.5 text-[11px] ${
                  isLight ? 'text-slate-500' : 'text-slate-400'
                }`}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-[#3b6992] inline-block" />POS</span>
                  <span className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-[#64748b] inline-block" />Sound Box</span>
                  <span className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-[#003857] inline-block" />KHQR</span>
                  <span className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-[#a3b3c6] inline-block" />Merchant Visit</span>
                  <span className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-[#b99763] inline-block" />Credit Card</span>
                </div>
                <div className="flex items-center gap-3">
                  {velocityPeak.peakVal > 0 && (
                    <span className="hidden xl:inline-flex items-center gap-1 font-medium">
                      Peak{' '}
                      <strong className={`font-figure ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>
                        {fmtNum(velocityPeak.peakVal)}
                      </strong>{' '}
                      ({velocityPeak.peakLabel})
                    </span>
                  )}
                  <span
                    className={`inline-flex items-center gap-1.5 font-semibold ${
                      isLight ? 'text-slate-700' : 'text-slate-300'
                    }`}
                  >
                    <span
                      className={`w-3.5 border-t-2 border-dashed inline-block ${
                        isLight ? 'border-slate-700' : 'border-slate-300'
                      }`}
                    />
                    Active staff
                  </span>
                </div>
              </div>
            )}

            {chartMode === 'VELOCITY' ? (
              <CrossChannelVelocityChart items={velocitySeries} height={248} theme={theme} />
            ) : (
              <GroupedBarChart
                labels={monthlyHardwareChart.labels}
                series1Label="POS Terminal Installed"
                series1Data={monthlyHardwareChart.pos}
                series1Color="#003857"
                series2Label="Sound Box Installed"
                series2Data={monthlyHardwareChart.sb}
                series2Color="#889bae"
                height={248}
                theme={theme}
              />
            )}
          </div>
        </section>

        {/* Right 5 Cols: Memoized Channel Mix Donut */}
        <ChannelMixCard
          isLight={isLight}
          cardClass={iosCardClass}
          donutSlices={donutSlices}
          leadChannel={leadChannel}
          totalTasks={channelActivity.totalTasks}
          ccSubmittedShow={channelActivity.ccSubmittedShow}
          onNavigateTab={onNavigateTab}
        />
      </div>

      {/* ───────────── 4. ROW 2: TOP BRANCHES PERFORMANCE GRAPH + HARDWARE & SLA ALLOCATION ANALYTICS ───────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left 7 Cols: Memoized Top Branches Performance Graph + Table */}
        <TopBranchesCard
          isLight={isLight}
          cardClass={iosCardClass}
          segWrapClass={iosSegWrapClass}
          activePeriodLabel={activePeriodLabel}
          branchViewMode={branchViewMode}
          setBranchViewMode={setBranchViewMode}
          sortedBranches={sortedBranches}
          maxBranchTasks={maxBranchTasks}
          brSort={brSort}
          brToggle={brToggle}
          onNavigateTab={onNavigateTab}
        />

        {/* Right 5 Cols: Hardware & SLA Allocation Analytics (with Stock Requests / Serials Toggle) */}
        <section className={`lg:col-span-5 ${iosCardClass} overflow-hidden flex flex-col justify-between`}>
          <div className="px-6 pt-5 pb-3 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h3
                className={`text-[15px] font-bold tracking-[-0.015em] truncate ${
                  isLight ? 'text-slate-900' : 'text-white'
                }`}
              >
                Hardware &amp; SLA Allocation
              </h3>
              <p
                className={`text-[12px] truncate ${
                  isLight ? 'text-slate-500' : 'text-slate-400'
                }`}
              >
                Stock pool, SIM fleet &amp; {batteryLifespanMonths}M battery SLA
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <div
                className={`${iosSegWrapClass} text-[11px] shrink-0`}
                role="tablist"
                aria-label="Asset View Mode"
              >
                {([
                  { id: 'ALLOCATION' as const, label: 'Analytics' },
                  { id: 'SERIALS' as const, label: 'Serials' },
                ]).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="tab"
                    aria-selected={assetViewMode === m.id}
                    onClick={() => setAssetViewMode(m.id)}
                    className={`px-2.5 py-1 rounded-full font-semibold cursor-pointer transition-all duration-150 whitespace-nowrap ${
                      assetViewMode === m.id
                        ? isLight
                          ? 'bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,0.08)]'
                          : 'bg-slate-700 text-white shadow-xs'
                        : isLight
                        ? 'text-slate-500 hover:text-slate-900'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {onNavigateTab && (
                <button
                  type="button"
                  onClick={() =>
                    onNavigateTab(
                      assetViewMode === 'SERIALS' && activityPanel === 'REQUISITIONS'
                        ? 'requisitions'
                        : 'inventory'
                    )
                  }
                  className={`text-xs font-semibold inline-flex items-center gap-1 shrink-0 cursor-pointer transition ${
                    isLight
                      ? 'text-[#004e75] hover:text-[#003857]'
                      : 'text-sky-400 hover:text-sky-300'
                  }`}
                >
                  Stock <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          {assetViewMode === 'ALLOCATION' ? (
            <>
              <div
                className={`divide-y ${
                  isLight ? 'divide-slate-100/90' : 'divide-slate-800/70'
                } flex-1 flex flex-col justify-center`}
              >
                {allocationRows.map((row) => {
                  const Icon = row.icon;
                  const inner = (
                    <>
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span
                          className={`font-semibold flex items-center gap-2 min-w-0 truncate ${
                            isLight ? 'text-slate-900' : 'text-slate-100'
                          }`}
                        >
                          <Icon className={`w-4 h-4 shrink-0 ${row.iconClass}`} aria-hidden="true" />
                          <span className="truncate">{row.title}</span>
                        </span>
                        <span
                          className={`font-figure font-semibold text-[11px] whitespace-nowrap shrink-0 ${
                            isLight ? 'text-slate-600' : 'text-slate-300'
                          }`}
                        >
                          {row.rightText}
                        </span>
                      </div>

                      <div
                        className={`h-2 w-full rounded-full ${
                          isLight ? 'bg-slate-100' : 'bg-slate-800'
                        } overflow-hidden flex gap-0.5`}
                      >
                        {row.segments.length > 0 ? (
                          row.segments.map((seg) =>
                            seg.val > 0 ? (
                              <div
                                key={seg.key}
                                className={`h-full first:rounded-l-full last:rounded-r-full transition-all duration-300 ${seg.color}`}
                                style={{ width: `${Math.max(1.5, seg.pct)}%` }}
                                title={`${seg.label}: ${fmtNum(seg.val)} (${Math.round(seg.pct)}%)`}
                              />
                            ) : null
                          )
                        ) : (
                          <div
                            className={`h-full w-full rounded-full ${
                              isLight ? 'bg-slate-200/70' : 'bg-slate-700/60'
                            }`}
                          />
                        )}
                      </div>

                      <div
                        className={`flex flex-wrap items-center justify-between gap-2 text-[11px] ${
                          isLight ? 'text-slate-500' : 'text-slate-400'
                        }`}
                      >
                        <span className="truncate">{row.subtext}</span>
                        {row.segments.length > 0 && (
                          <div className="flex items-center gap-2 shrink-0">
                            {row.segments.map((seg) => (
                              <span key={seg.key} className="inline-flex items-center gap-1 text-[10.5px]">
                                <i className={`w-1.5 h-1.5 rounded-full inline-block ${seg.color}`} />
                                {seg.label}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  );

                  return row.onClickTab ? (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => onNavigateTab?.(row.onClickTab)}
                      className={`w-full text-left px-6 py-4 space-y-2 transition cursor-pointer group ${
                        isLight ? 'hover:bg-slate-50/75' : 'hover:bg-slate-800/40'
                      }`}
                    >
                      {inner}
                    </button>
                  ) : (
                    <div key={row.id} className="px-6 py-4 space-y-2">
                      {inner}
                    </div>
                  );
                })}
              </div>

              {/* Footer Summary Strip */}
              <div
                className={`px-6 py-3 border-t flex flex-wrap items-center justify-between gap-2 text-[11.5px] ${
                  isLight
                    ? 'border-slate-100 bg-[#f9fafb]/80 text-slate-500'
                    : 'border-slate-800/70 bg-slate-900/50 text-slate-400'
                }`}
              >
                <span>
                  Materials:{' '}
                  <strong className={`font-figure ${isLight ? 'text-slate-900' : 'text-white'}`}>
                    {fmtNum(materialsSummary.kitOnHand)}
                  </strong>{' '}
                  on hand ·{' '}
                  <strong className={`font-figure ${isLight ? 'text-slate-900' : 'text-white'}`}>
                    {fmtNum(materialsSummary.kitInTransit)}
                  </strong>{' '}
                  transit
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setAssetViewMode('SERIALS');
                    setActivityPanel('REQUISITIONS');
                  }}
                  className={`font-semibold cursor-pointer transition inline-flex items-center gap-1 ${
                    isLight
                      ? 'text-slate-700 hover:text-[#004e75]'
                      : 'text-slate-300 hover:text-sky-400'
                  }`}
                >
                  <span>Stock Requests:</span>
                  <strong className={`font-figure ${isLight ? 'text-slate-900' : 'text-white'}`}>
                    {fmtNum(reqStats.pending.length)}
                  </strong>
                  <span>open</span>
                </button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col">
              <div
                className={`px-6 py-2.5 border-y flex items-center justify-between gap-2 ${
                  isLight
                    ? 'border-slate-100 bg-[#f9fafb]/70'
                    : 'border-slate-800/70 bg-slate-900/40'
                }`}
              >
                <div
                  className={`${iosSegWrapClass} text-xs`}
                  role="tablist"
                  aria-label="Recent Requests or Serials"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activityPanel === 'REQUISITIONS'}
                    onClick={() => setActivityPanel('REQUISITIONS')}
                    className={`px-2.5 py-1 rounded-full font-semibold cursor-pointer transition-all duration-150 inline-flex items-center gap-1.5 ${
                      activityPanel === 'REQUISITIONS'
                        ? isLight
                          ? 'bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,0.08)]'
                          : 'bg-slate-700 text-white shadow-xs'
                        : isLight
                        ? 'text-slate-500 hover:text-slate-900'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <ScrollText className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Stock Requests ({fmtNum(requisitions.length)})</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activityPanel === 'SERIALS'}
                    onClick={() => setActivityPanel('SERIALS')}
                    className={`px-2.5 py-1 rounded-full font-semibold cursor-pointer transition-all duration-150 inline-flex items-center gap-1.5 ${
                      activityPanel === 'SERIALS'
                        ? isLight
                          ? 'bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,0.08)]'
                          : 'bg-slate-700 text-white shadow-xs'
                        : isLight
                        ? 'text-slate-500 hover:text-slate-900'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Package className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Updated Serials</span>
                  </button>
                </div>

                {onNavigateTab && (
                  <button
                    type="button"
                    onClick={() => onNavigateTab(activityPanel === 'REQUISITIONS' ? 'requisitions' : 'inventory')}
                    className={`text-[11.5px] font-semibold inline-flex items-center gap-1 shrink-0 cursor-pointer transition ${
                      isLight
                        ? 'text-[#004e75] hover:text-[#003857]'
                        : 'text-sky-400 hover:text-sky-300'
                    }`}
                  >
                    View All <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
                  </button>
                )}
              </div>

              <div
                className={`divide-y ${
                  isLight ? 'divide-slate-100/90' : 'divide-slate-800/70'
                } flex-1 flex flex-col justify-center`}
              >
                {activityPanel === 'REQUISITIONS' ? (
                  requisitions.length === 0 ? (
                    <div className="py-12 px-6 text-center text-xs text-slate-400">
                      No stock requisitions submitted yet.
                    </div>
                  ) : (
                    requisitions.slice(0, 7).map((req) => (
                      <button
                        key={req.reqId}
                        type="button"
                        onClick={() => onNavigateTab?.('requisitions')}
                        className={`w-full text-left px-6 py-3 transition flex items-center justify-between gap-3 cursor-pointer group ${
                          isLight ? 'hover:bg-slate-50/75' : 'hover:bg-slate-800/40'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            <span
                              className={`font-mono font-bold transition ${
                                isLight
                                  ? 'text-slate-900 group-hover:text-[#004e75]'
                                  : 'text-white group-hover:text-sky-400'
                              }`}
                            >
                              {req.reqId}
                            </span>
                            <span className={isLight ? 'text-slate-300' : 'text-slate-600'}>·</span>
                            <span className={`font-medium truncate ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
                              {req.branchName} ({req.branchId})
                            </span>
                          </div>
                          <div className={`text-[11.5px] truncate mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                            <strong className={`font-semibold ${isLight ? 'text-slate-700' : 'text-slate-200'}`}>
                              {req.posQty}x POS · {req.sbQty}x Sound Box
                            </strong>
                            {req.reason ? ` — ${req.reason}` : ''}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                              req.status === 'RECEIVED'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200/80'
                                : req.status === 'REJECTED'
                                ? 'bg-rose-50 text-rose-700 border-rose-200/80'
                                : req.status === 'PENDING_ADMIN'
                                ? 'bg-amber-50 text-amber-800 border-amber-200/80'
                                : 'bg-slate-100 text-slate-700 border-slate-200'
                            }`}
                          >
                            {req.status}
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-[#004e75] transition" aria-hidden="true" />
                        </div>
                      </button>
                    ))
                  )
                ) : recentDevices.length === 0 ? (
                  <div className="py-12 px-6 text-center text-xs text-slate-400">
                    No hardware serial updates recorded yet.
                  </div>
                ) : (
                  recentDevices.slice(0, 7).map((dev) => {
                    const meta = STAGE_META[dev.stage];
                    const cycleCount = (dev.history || []).length;
                    return (
                      <button
                        key={dev.serial}
                        type="button"
                        onClick={() => onSelectDevice(dev.serial)}
                        aria-label={`Open serial ${dev.serial}`}
                        className={`w-full text-left px-6 py-2.5 flex items-center justify-between gap-3 transition cursor-pointer group ${
                          isLight ? 'hover:bg-slate-50/75' : 'hover:bg-slate-800/40'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                              isLight ? 'bg-slate-100/90' : 'bg-slate-800'
                            }`}
                          >
                            {dev.type === 'POS Terminal' ? (
                              <Cpu className="w-4 h-4 text-[#004e75]" aria-hidden="true" />
                            ) : (
                              <Volume2 className="w-4 h-4 text-[#4F518C]" aria-hidden="true" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 text-xs">
                              <span
                                className={`font-mono font-bold transition ${
                                  isLight
                                    ? 'text-slate-900 group-hover:text-[#004e75]'
                                    : 'text-white group-hover:text-sky-400'
                                }`}
                              >
                                {dev.serial}
                              </span>
                              <span className={isLight ? 'text-slate-300' : 'text-slate-600'}>·</span>
                              <span className={`font-mono text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                                Code {dev.branchId}
                              </span>
                              <span className={isLight ? 'text-slate-300' : 'text-slate-600'}>·</span>
                              <span className="text-[11px] text-slate-400">{cycleCount} events</span>
                            </div>
                            <div className={`text-[11px] truncate mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                              {dev.merchantName
                                ? `${dev.merchantName}${dev.mid ? ` (${dev.mid})` : ''}`
                                : dev.model}
                            </div>
                          </div>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${meta?.badgeClassLight || ''}`}>
                          {meta?.short || dev.stage}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

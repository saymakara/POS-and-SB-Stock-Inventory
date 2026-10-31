import React, { useState, useMemo } from 'react';
import { useKeptMemo } from '../utils/useKeptMemo';
import { useSort, SortTh } from '../utils/sort';
import {
  Device,
  Branch,
  Requisition,
  UserRole,
  ThemeMode,
  LifecycleStage,
  getBatteryLifecycleStatus,
} from '../types';
import { STAGE_META } from '../data/initialData';
import { GroupedBarChart } from './Charts';
import { Odometer } from './Odometer';
import { todayPP, lastMonthsPP } from '../utils/time';
import { motion, AnimatePresence } from 'motion/react';
import {
  BarChart3,
  TrendingUp,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  Cpu,
  Volume2,
  BatteryCharging,
  Calendar,
  FileSpreadsheet,
  Building2,
  ScrollText,
  Package,
} from 'lucide-react';
import { fmtNum } from '../utils/format';

/** Battery policy defaults (same values as AppSettings defaults). App can pass the live settings values as props. */
export const DEFAULT_BATTERY_LIFESPAN_MONTHS = 24;
export const DEFAULT_BATTERY_WARNING_MONTHS = 21;

interface DashboardTabProps {
  devices: Device[];
  allDevices: Device[];
  branches: Branch[];
  requisitions: Requisition[];
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
}

type PerformanceViewMode =
  | 'MONTHLY_INSTALLS'
  | 'HARDWARE_MIX'
  | 'BRANCH_LEADERBOARD'
  | 'SLA_CYCLE';
type TimeHorizon = '6M' | '12M' | '3M';

interface MonthlyBucket {
  monthKey: string;
  label: string;
  shortLabel: string;
  posInstalled: number;
  sbInstalled: number;
  faulty: number;
  total: number;
  /** Stock-in → install days, summed over installs this month that have both dates. */
  cycleDaysSum: number;
  cycleMeasured: number;
}

/** Whole days between two YYYY-MM-DD(...) dates, or null when either is missing/invalid or negative. */
function daysBetween(fromStr: string | undefined, toStr: string | undefined): number | null {
  const a = (fromStr || '').slice(0, 10);
  const b = (toStr || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb) || tb < ta) return null;
  return Math.round((tb - ta) / 86400000);
}

const pctOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

const fmtHours = (h: number) => (h >= 48 ? `${(h / 24).toFixed(1)} days` : `${h.toFixed(1)} hrs`);

export const DashboardTab: React.FC<DashboardTabProps> = ({
  devices,
  allDevices,
  branches,
  requisitions,
  role,
  selectedBranch,
  onSelectDevice,
  onOpenExportModal,
  onNavigateTab,
  batteryLifespanMonths = DEFAULT_BATTERY_LIFESPAN_MONTHS,
  batteryWarningMonths = DEFAULT_BATTERY_WARNING_MONTHS,
  serverTotalDevices,
  serverStageCounts,
}) => {
  const today = todayPP();
  const currentMonthKey = today.slice(0, 7);

  const [perfViewMode, setPerfViewMode] =
    useState<PerformanceViewMode>('MONTHLY_INSTALLS');
  const [timeHorizon, setTimeHorizon] = useState<TimeHorizon>('6M');
  const [selectedMonthKey, setSelectedMonthKey] = useState<string>(currentMonthKey);

  const isAdminLike = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const activeDevices = useKeptMemo('dash.active', () => devices.filter((d) => !d.archived), [devices]);

  const monthlyData: MonthlyBucket[] = useKeptMemo('dash.monthly', () => {
    // Months in Phnom Penh time, oldest first.
    const months = lastMonthsPP(12);
    const bucketMap = new Map<string, MonthlyBucket>();
    const buckets: MonthlyBucket[] = months.map((m) => {
      const b: MonthlyBucket = {
        monthKey: m.key,
        label: m.label,
        shortLabel: `${m.label.slice(0, 3)} ${m.label.slice(-2)}`,
        posInstalled: 0,
        sbInstalled: 0,
        faulty: 0,
        total: 0,
        cycleDaysSum: 0,
        cycleMeasured: 0,
      };
      bucketMap.set(m.key, b);
      return b;
    });

    for (let i = 0; i < activeDevices.length; i++) {
      const d = activeDevices[i];
      if (d.stage === 'COMPLETE') {
        // An install is counted in the month of its recorded install date only.
        const b = d.deployedDate ? bucketMap.get(d.deployedDate.slice(0, 7)) : undefined;
        if (!b) continue;
        if (d.type === 'POS Terminal') b.posInstalled++;
        else if (d.type === 'Sound Box') b.sbInstalled++;
        b.total++;
        const days = daysBetween(d.stockInDate, d.deployedDate);
        if (days !== null) {
          b.cycleDaysSum += days;
          b.cycleMeasured++;
        }
      } else if (d.stage === 'FAULTY') {
        const b = d.updatedAt ? bucketMap.get(d.updatedAt.slice(0, 7)) : undefined;
        if (b) b.faulty++;
      }
    }

    if (timeHorizon === '6M') return buckets.slice(-6);
    if (timeHorizon === '3M') return buckets.slice(-3);
    return buckets;
  }, [activeDevices, timeHorizon, currentMonthKey]);

  const selectedMonthStats: MonthlyBucket = useMemo(() => {
    return (
      monthlyData.find((m) => m.monthKey === selectedMonthKey) ||
      monthlyData[monthlyData.length - 1] || {
        monthKey: currentMonthKey,
        label: 'Current Month',
        shortLabel: 'Now',
        posInstalled: 0,
        sbInstalled: 0,
        faulty: 0,
        total: 0,
        cycleDaysSum: 0,
        cycleMeasured: 0,
      }
    );
  }, [monthlyData, selectedMonthKey, currentMonthKey]);

  // Chart series built once per data change (not on every render).
  const monthlyChart = useMemo(
    () => ({
      labels: monthlyData.map((m) => m.shortLabel),
      pos: monthlyData.map((m) => m.posInstalled),
      sb: monthlyData.map((m) => m.sbInstalled),
    }),
    [monthlyData]
  );
  const periodInstallTotal = useMemo(
    () => monthlyData.reduce((acc, m) => acc + m.total, 0),
    [monthlyData]
  );

  // Current pipeline snapshot (not per month): units with a branch that are not yet installed vs installed.
  const pipeline = useKeptMemo('dash.pipeline', () => {
    let reserve = 0;
    let configuring = 0;
    let complete = 0;
    for (const d of activeDevices) {
      if (d.stage === 'BRANCH_RESERVE') reserve++;
      else if (d.stage === 'CONFIGURING') configuring++;
      else if (d.stage === 'COMPLETE') complete++;
    }
    const atBranches = reserve + configuring + complete;
    return { reserve, configuring, complete, atBranches };
  }, [activeDevices]);

  // Stage ageing computed from each unit's stored hours-in-stage, plus stock-in → install days.
  const stageAgeing = useKeptMemo('dash.ageing', () => {
    const stages: { stage: 'HQ_STOCK' | 'BRANCH_RESERVE' | 'CONFIGURING'; title: string }[] = [
      { stage: 'HQ_STOCK', title: 'Waiting in HQ Stock' },
      { stage: 'BRANCH_RESERVE', title: 'Waiting in Branch Reserve' },
      { stage: 'CONFIGURING', title: 'Configuring at Merchant' },
    ];
    const rows = stages.map(({ stage, title }) => {
      let n = 0;
      let sum = 0;
      let max = 0;
      for (const d of activeDevices) {
        if (d.stage !== stage) continue;
        const h = Number(d.hoursInStage);
        if (!Number.isFinite(h) || h < 0) continue;
        n++;
        sum += h;
        if (h > max) max = h;
      }
      return { key: stage, title, count: n, avg: n > 0 ? fmtHours(sum / n) : '—', detail: n > 0 ? `Longest: ${fmtHours(max)}` : 'No units in this stage' };
    });
    let n = 0;
    let sum = 0;
    for (const d of activeDevices) {
      if (d.stage !== 'COMPLETE') continue;
      const days = daysBetween(d.stockInDate, d.deployedDate);
      if (days === null) continue;
      n++;
      sum += days;
    }
    const all: { key: string; title: string; count: number; avg: string; detail: string }[] = rows;
    all.push({
      key: 'STOCKIN_TO_INSTALL',
      title: 'Stock-In → Installed (all installed units)',
      count: n,
      avg: n > 0 ? `${(sum / n).toFixed(1)} days` : '—',
      detail: n > 0 ? 'Based on stock-in and install dates' : 'No units with both dates',
    });
    return all;
  }, [activeDevices]);

  // Branch matrix: HQ sees every branch; a branch user only sees its own scoped devices.
  const matrixSource = isAdminLike ? allDevices : devices;
  const branchVelocity = useKeptMemo('dash.branches', () => {
    const stats = new Map<
      string,
      { complete: number; reserve: number; inFlight: number; posCount: number; sbCount: number; total: number }
    >();

    for (let i = 0; i < branches.length; i++) {
      if (branches[i].code !== '100') {
        stats.set(branches[i].code, {
          complete: 0,
          reserve: 0,
          inFlight: 0,
          posCount: 0,
          sbCount: 0,
          total: 0,
        });
      }
    }

    for (let i = 0; i < matrixSource.length; i++) {
      const d = matrixSource[i];
      if (d.archived) continue;
      const bStat = stats.get(d.branchId);
      if (!bStat) continue;

      bStat.total++;
      if (d.stage === 'COMPLETE') bStat.complete++;
      else if (d.stage === 'BRANCH_RESERVE') bStat.reserve++;
      else if (d.stage === 'CONFIGURING') bStat.inFlight++;

      if (d.type === 'POS Terminal') bStat.posCount++;
      else if (d.type === 'Sound Box') bStat.sbCount++;
    }

    return branches
      .filter((b) => b.code !== '100')
      .map((b) => {
        const s = stats.get(b.code) || {
          complete: 0,
          reserve: 0,
          inFlight: 0,
          posCount: 0,
          sbCount: 0,
          total: 0,
        };
        return {
          code: b.code,
          name: b.name,
          ...s,
          conversion: pctOf(s.complete, s.total),
        };
      })
      .filter((b) => isAdminLike || b.total > 0)
      .sort((a, b) => b.total - a.total || b.complete - a.complete);
  }, [branches, matrixSource, isAdminLike]);

  // the 8 busiest branches; click a heading to sort them (ascending / descending)
  const topBranches = useMemo(() => branchVelocity.slice(0, 8), [branchVelocity]);
  const { sorted: sortedTopBranches, sort: dbSort, toggle: dbToggle } = useSort<(typeof branchVelocity)[number]>(topBranches, {
    code: (b) => Number(b.code) || b.code, name: (b) => b.name, pos: (b) => b.posCount, sb: (b) => b.sbCount,
    reserve: (b) => b.reserve, installed: (b) => b.complete, rate: (b) => b.conversion,
  });

  // Battery figures: POS Terminals only (Sound Boxes have no replaceable 24M battery). Units without any date are
  // reported separately instead of being given an invented install date.
  const batterySummary = useKeptMemo('dash.battery', () => {
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

  const pendingReqs = useMemo(
    () => requisitions.filter((r) => r.status === 'PENDING_ADMIN'),
    [requisitions]
  );

  const recentDevices = useKeptMemo('dash.recent', () => {
    // Deterministic key: most recent timestamp (updatedAt -> deployedDate -> pushDate -> stockInDate),
    // and secondary tie-breaker on serial (descending) so order is 100% stable and never flips.
    const getSortKey = (d: Device) => {
      const ts = d.updatedAt || d.deployedDate || d.pushDate || d.stockInDate || '';
      return `${ts}__${d.serial}`;
    };

    if (activeDevices.length <= 6) {
      return [...activeDevices].sort((a, b) => getSortKey(b).localeCompare(getSortKey(a)));
    }

    // High-performance single-pass O(N) top-6 scan instead of O(N log N) 45,000-item array copy & full sort.
    const top: Device[] = [];
    const topKeys: string[] = [];

    for (let i = 0; i < activeDevices.length; i++) {
      const dev = activeDevices[i];
      const key = getSortKey(dev);

      if (top.length < 6) {
        top.push(dev);
        topKeys.push(key);
        if (top.length === 6) {
          for (let m = 0; m < 5; m++) {
            for (let n = m + 1; n < 6; n++) {
              if (topKeys[m].localeCompare(topKeys[n]) < 0) {
                const tempDev = top[m]; top[m] = top[n]; top[n] = tempDev;
                const tempKey = topKeys[m]; topKeys[m] = topKeys[n]; topKeys[n] = tempKey;
              }
            }
          }
        }
      } else {
        if (key.localeCompare(topKeys[5]) > 0) {
          top[5] = dev;
          topKeys[5] = key;
          for (let m = 5; m > 0; m--) {
            if (topKeys[m].localeCompare(topKeys[m - 1]) > 0) {
              const tempDev = top[m]; top[m] = top[m - 1]; top[m - 1] = tempDev;
              const tempKey = topKeys[m]; topKeys[m] = topKeys[m - 1]; topKeys[m - 1] = tempKey;
            } else {
              break;
            }
          }
        }
      }
    }

    return top;
  }, [activeDevices]);

  // Classic GroupedBarChart series for Branch / Lifecycle distribution
  const topBranchesChart = useMemo(() => {
    const top = branchVelocity.slice(0, 8);
    return {
      labels: top.map((b) => `Code ${b.code}`),
      posSeries: top.map((b) => b.posCount),
      sbSeries: top.map((b) => b.sbCount),
    };
  }, [branchVelocity]);

  const selectedAvgCycle =
    selectedMonthStats.cycleMeasured > 0
      ? (selectedMonthStats.cycleDaysSum / selectedMonthStats.cycleMeasured).toFixed(1)
      : null;

  return (
    <div className="space-y-6">
      {/* Classic Institutional Header & Export Bar */}
      <div className="surface-card shadow-md p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-[#003857] flex items-center justify-center text-white shadow-sm shrink-0">
            <BarChart3 className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-base sm:text-lg font-extrabold tracking-tight text-zinc-900">
                {isAdminLike
                  ? 'Head Office Stock & Branch Deployment Overview'
                  : `Branch Code ${selectedBranch} Stock & Installation Overview`}
              </h2>
              <span className="text-xs font-mono font-bold text-slate-500">
                · {typeof serverTotalDevices === 'number' ? serverTotalDevices.toLocaleString() : activeDevices.length.toLocaleString()} Active Units
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {isAdminLike
                ? 'All Branch Codes · Figures are computed from the current stock records'
                : `Branch Code ${selectedBranch} · Merchant installations, reserves and serial lifecycles from the current stock records`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {onNavigateTab && (
            <button
              type="button"
              onClick={() => onNavigateTab('inventory')}
              className="px-3.5 py-2 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition cursor-pointer shadow-2xs"
            >
              View Stock Inventory
            </button>
          )}
          {/* Export is limited to HQ admins (the export dialog also enforces this). */}
          {isAdminLike && (
            <button
              type="button"
              onClick={onOpenExportModal}
              className="px-3.5 py-2 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer transition shadow-2xs"
              title="Export Reports & Data"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <span>Export Report</span>
            </button>
          )}
        </div>
      </div>

      {/* MONTHLY PERFORMANCE & INTERACTIVE VIEW SELECTOR */}
      <div className="surface-card shadow-md overflow-hidden">
        <div className="sb-card-header-light px-6 py-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-zinc-800" />
              <h3 className="text-sm sm:text-base font-extrabold tracking-tight text-zinc-900">
                Monthly Performance &amp; Deployment View Selector
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Select view mode and time horizon to inspect POS Terminal &amp; Sound Box performance across Branch Codes
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="inline-flex p-1 rounded-lg bg-slate-200/75 border border-slate-300/70">
              {(
                [
                  { id: 'MONTHLY_INSTALLS', label: 'Monthly Installations' },
                  { id: 'HARDWARE_MIX', label: 'POS vs Soundbox Mix' },
                  { id: 'BRANCH_LEADERBOARD', label: 'Branch Code Velocity' },
                  { id: 'SLA_CYCLE', label: 'Stage Ageing' },
                ] as { id: PerformanceViewMode; label: string }[]
              ).map((mode) => {
                const active = perfViewMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setPerfViewMode(mode.id)}
                    aria-pressed={active}
                    className={`relative px-3 py-1.5 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                      active
                        ? 'text-white'
                        : 'text-slate-600 hover:text-zinc-900'
                    }`}
                  >
                    {active && (
                      <motion.div
                        layoutId="dashboardPerfViewPill"
                        transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                        className="absolute inset-0 rounded-md bg-[#004953] shadow-xs"
                      />
                    )}
                    <span className="relative z-10">{mode.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="inline-flex p-1 rounded-lg bg-slate-200/75 border border-slate-300/70">
              {(
                [
                  { id: '6M', label: '6 Months' },
                  { id: '12M', label: '12 Months' },
                  { id: '3M', label: '3 Months' },
                ] as { id: TimeHorizon; label: string }[]
              ).map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => setTimeHorizon(h.id)}
                  aria-pressed={timeHorizon === h.id}
                  className={`px-2.5 py-1.5 rounded-md text-[11px] font-bold transition cursor-pointer ${
                    timeHorizon === h.id
                      ? 'bg-white text-zinc-900 shadow-2xs'
                      : 'text-slate-600 hover:text-zinc-900'
                  }`}
                >
                  {h.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="p-6">
          {/* Selected Month Summary Metrics Strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="surface-inset-light p-4">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 mb-1">
                <span>SELECTED PERIOD</span>
                <Calendar className="w-3.5 h-3.5 text-[#003857]" aria-hidden="true" />
              </div>
              <div className="text-base sm:text-lg font-extrabold tracking-tight text-[#002f49]">
                {selectedMonthStats.label}
              </div>
              <div className="text-[11px] text-slate-600 font-semibold mt-0.5">
                Faulty units (last updated this month):{' '}
                <strong className="text-rose-700">{selectedMonthStats.faulty}</strong>
              </div>
            </div>

            <div className="surface-inset-light p-4">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 mb-1">
                <span>COMPLETED INSTALLS</span>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
              </div>
              <div className="text-2xl font-black font-figure tabular-nums text-zinc-900">
                <Odometer value={selectedMonthStats.total} format={selectedMonthStats.total >= 1000} duration={340} />{' '}
                <span className="text-xs font-normal text-slate-500">
                  ({pctOf(selectedMonthStats.total, periodInstallTotal)}% of {fmtNum(periodInstallTotal)} in period)
                </span>
              </div>
              <div className="text-[11px] text-slate-600 mt-0.5">
                POS: <strong className="text-slate-900">{fmtNum(selectedMonthStats.posInstalled)}</strong> · Sound Box:{' '}
                <strong className="text-slate-900">{fmtNum(selectedMonthStats.sbInstalled)}</strong>
              </div>
            </div>

            <div className="surface-inset-light p-4">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 mb-1">
                <span>AWAITING INSTALL (NOW)</span>
                <TrendingUp className="w-3.5 h-3.5 text-zinc-700" aria-hidden="true" />
              </div>
              <div className="text-2xl font-black font-figure tabular-nums text-zinc-900">
                <Odometer
                  value={
                    serverStageCounts
                      ? (serverStageCounts.BRANCH_RESERVE || 0) + (serverStageCounts.CONFIGURING || 0)
                      : pipeline.reserve + pipeline.configuring
                  }
                  format={
                    (serverStageCounts
                      ? (serverStageCounts.BRANCH_RESERVE || 0) + (serverStageCounts.CONFIGURING || 0)
                      : pipeline.reserve + pipeline.configuring) >= 1000
                  }
                  duration={340}
                />
              </div>
              <div className="text-[11px] text-slate-600 mt-0.5">
                Installed at branches:{' '}
                <strong className="text-slate-900">
                  {fmtNum(serverStageCounts ? serverStageCounts.COMPLETE || 0 : pipeline.complete)} /{' '}
                  {fmtNum(serverStageCounts
                    ? (serverStageCounts.COMPLETE || 0) + (serverStageCounts.BRANCH_RESERVE || 0) + (serverStageCounts.CONFIGURING || 0)
                    : pipeline.atBranches)}{' '}
                  (
                  {pctOf(
                    serverStageCounts ? serverStageCounts.COMPLETE || 0 : pipeline.complete,
                    serverStageCounts
                      ? (serverStageCounts.COMPLETE || 0) + (serverStageCounts.BRANCH_RESERVE || 0) + (serverStageCounts.CONFIGURING || 0)
                      : pipeline.atBranches
                  )}
                  %)
                </strong>
              </div>
            </div>

            <div className="surface-inset-light p-4">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 mb-1">
                <span>AVG STOCK-IN → INSTALL</span>
                <Clock className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" />
              </div>
              <div className="text-2xl font-black font-figure tabular-nums text-zinc-900">
                {selectedAvgCycle ?? '—'}{' '}
                {selectedAvgCycle && <span className="text-xs font-normal text-slate-500">days</span>}
              </div>
              <div className="text-[11px] text-slate-600 font-semibold mt-0.5">
                {selectedMonthStats.cycleMeasured > 0
                  ? `${selectedMonthStats.cycleMeasured} install${selectedMonthStats.cycleMeasured === 1 ? '' : 's'} with both dates`
                  : 'No installs with stock-in and install dates'}
              </div>
            </div>
          </div>

          {/* Dynamic View Content */}
          <AnimatePresence mode="wait">
            {perfViewMode === 'MONTHLY_INSTALLS' && (
              <motion.div
                key="MONTHLY_INSTALLS"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
              >
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                  <div className="lg:col-span-8">
                    <GroupedBarChart
                      labels={monthlyChart.labels}
                      series1Label="POS Terminal Installed"
                      series1Data={monthlyChart.pos}
                      series1Color="#003857"
                      series2Label="Sound Box Installed"
                      series2Data={monthlyChart.sb}
                      series2Color="#3b8fc4"
                      height={240}
                      theme="light"
                    />
                  </div>
                  <div className="lg:col-span-4 space-y-2">
                    <div className="text-xs font-extrabold uppercase tracking-wider text-slate-500 mb-2">
                      Select Month to Inspect
                    </div>
                    <div className="grid grid-cols-2 gap-2 max-h-[215px] overflow-y-auto pr-1 custom-scrollbar">
                      {monthlyData.map((m) => {
                        const isSel = m.monthKey === selectedMonthStats.monthKey;
                        return (
                          <button
                            key={m.monthKey}
                            type="button"
                            onClick={() => setSelectedMonthKey(m.monthKey)}
                            aria-pressed={isSel}
                            aria-label={`${m.label}: ${m.total} installed`}
                            className={`p-2.5 rounded-lg border text-left transition cursor-pointer ${
                              isSel
                                ? 'bg-[#003857] text-white border-[#003857] shadow-xs'
                                : 'bg-slate-50 hover:bg-slate-100 text-zinc-900 border-slate-200'
                            }`}
                          >
                            <div className="text-xs font-bold">{m.shortLabel}</div>
                            <div
                              className={`text-[11px] font-mono mt-0.5 ${
                                isSel ? 'text-slate-200' : 'text-slate-500'
                              }`}
                            >
                              {fmtNum(m.total)} installed
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {perfViewMode === 'HARDWARE_MIX' && (
              <motion.div
                key="HARDWARE_MIX"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
                className="space-y-3"
              >
                {periodInstallTotal === 0 && (
                  <div className="py-8 text-center text-xs text-slate-500">
                    No installations with an install date in this period.
                  </div>
                )}
                {periodInstallTotal > 0 && monthlyData.map((m) => {
                  const posPct = pctOf(m.posInstalled, m.total);
                  const sbPct = m.total > 0 ? 100 - posPct : 0;
                  return (
                    <button
                      type="button"
                      key={m.monthKey}
                      onClick={() => setSelectedMonthKey(m.monthKey)}
                      aria-pressed={m.monthKey === selectedMonthStats.monthKey}
                      className={`block w-full text-left p-3 rounded-lg border transition cursor-pointer ${
                        m.monthKey === selectedMonthStats.monthKey
                          ? 'bg-[#eef5f9] border-[#003857]'
                          : 'bg-slate-50/70 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs font-bold mb-1.5">
                        <span className="text-[#002f49]">{m.label}</span>
                        <div className="flex items-center gap-4 font-mono text-[11px] text-slate-600">
                          <span>
                            POS Terminal: <strong className="text-slate-900">{fmtNum(m.posInstalled)}</strong> ({posPct}%)
                          </span>
                          <span>
                            Sound Box: <strong className="text-slate-900">{fmtNum(m.sbInstalled)}</strong> ({sbPct}%)
                          </span>
                          <span className="text-[#002f49] font-extrabold">
                            Total: {m.total}
                          </span>
                        </div>
                      </div>
                      <div className="w-full h-2 rounded-full overflow-hidden flex bg-slate-200">
                        <div
                          style={{ width: `${posPct}%` }}
                          className="h-full bg-[#003857]"
                        />
                        <div
                          style={{ width: `${sbPct}%` }}
                          className="h-full bg-[#3b8fc4]"
                        />
                      </div>
                    </button>
                  );
                })}
              </motion.div>
            )}

            {perfViewMode === 'BRANCH_LEADERBOARD' && (
              <motion.div
                key="BRANCH_LEADERBOARD"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
              >
                <GroupedBarChart
                  labels={topBranchesChart.labels}
                  series1Label="POS Terminal Units"
                  series1Data={topBranchesChart.posSeries}
                  series1Color="#003857"
                  series2Label="Sound Box Units"
                  series2Data={topBranchesChart.sbSeries}
                  series2Color="#3b8fc4"
                  height={240}
                  theme="light"
                />
              </motion.div>
            )}

            {perfViewMode === 'SLA_CYCLE' && (
              <motion.div
                key="SLA_CYCLE"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
                className="grid grid-cols-1 md:grid-cols-4 gap-4"
              >
                {stageAgeing.map((row) => (
                  <div key={row.key} className="surface-inset-light p-4">
                    <div className="text-xs font-bold text-slate-500 mb-2">
                      {row.title}
                    </div>
                    <div className="text-2xl font-black font-figure text-zinc-900">
                      {row.avg}
                    </div>
                    <div className="flex items-center justify-between text-[11px] mt-2 pt-2 border-t border-slate-200">
                      <span className="text-slate-500">{row.detail}</span>
                      <span className="font-bold text-zinc-700">
                        {row.count} unit{row.count === 1 ? '' : 's'}
                      </span>
                    </div>
                  </div>
                ))}
                <p className="md:col-span-4 text-[11px] text-slate-500">
                  Averages for units currently in each stage, from the hours-in-stage value stored on each unit. No SLA target is applied here.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Classic Middle Split: Branch Code Stock Summary Table (Left 7 Cols) + Recent Serial Cycle History (Right 5 Cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 7 Cols: Branch Code Stock & Deployment Summary Table */}
        <div className="lg:col-span-7 surface-card shadow-md overflow-hidden flex flex-col">
          <div className="sb-card-header-light px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-zinc-800" />
              <div>
                <h3 className="text-sm sm:text-base font-extrabold text-zinc-900">
                  Branch Code Stock &amp; Deployment Matrix
                </h3>
                <p className="text-xs text-slate-500">
                  Current POS Terminal &amp; Sound Box counts by Branch Code (top 8 by units)
                </p>
              </div>
            </div>
            {onNavigateTab && (
              <button
                type="button"
                onClick={() => onNavigateTab('branches')}
                className="text-xs font-bold text-zinc-800 hover:text-zinc-950 hover:underline flex items-center gap-1 cursor-pointer"
              >
                All Branch Codes <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="glass-table-thead text-[11px] font-extrabold uppercase text-white">
                <tr>
                  <th className="py-3 px-3 w-10 text-right">No.</th>
                  <SortTh k="code" sort={dbSort} onSort={dbToggle} className="py-3 px-4">Branch Code</SortTh>
                  <SortTh k="name" sort={dbSort} onSort={dbToggle} className="py-3 px-4">Branch Name</SortTh>
                  <SortTh k="pos" sort={dbSort} onSort={dbToggle} align="center" className="py-3 px-3 text-center">POS Terminals</SortTh>
                  <SortTh k="sb" sort={dbSort} onSort={dbToggle} align="center" className="py-3 px-3 text-center">Sound Boxes</SortTh>
                  <SortTh k="reserve" sort={dbSort} onSort={dbToggle} align="center" className="py-3 px-3 text-center">Branch Reserve</SortTh>
                  <SortTh k="installed" sort={dbSort} onSort={dbToggle} align="center" className="py-3 px-3 text-center">Installed Units</SortTh>
                  <SortTh k="rate" sort={dbSort} onSort={dbToggle} align="right" className="py-3 px-4 text-right">Installed Rate</SortTh>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70">
                {branchVelocity.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500">
                      No branch stock recorded yet.
                    </td>
                  </tr>
                )}
                {sortedTopBranches.map((b, rowIdx) => (
                  <tr
                    key={b.code}
                    className="hover:bg-slate-50/90 transition-colors"
                  >
                    <td className="py-2.5 px-3 text-right text-slate-500 tabular-nums">{rowIdx + 1}</td>
                    <td className="py-2.5 px-4 font-mono font-bold text-zinc-900">
                      Code {b.code}
                    </td>
                    <td className="py-2.5 px-4 font-bold text-zinc-900">
                      {b.name}
                    </td>
                    <td className="py-2.5 px-3 text-center font-mono font-semibold text-slate-700">
                      {b.posCount}
                    </td>
                    <td className="py-2.5 px-3 text-center font-mono font-semibold text-slate-700">
                      {b.sbCount}
                    </td>
                    <td className="py-2.5 px-3 text-center font-mono font-semibold text-slate-600">
                      {b.reserve}
                    </td>
                    <td className="py-2.5 px-3 text-center font-mono font-bold text-emerald-700">
                      {b.complete}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-bold text-[#002f49]">
                      {b.conversion}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right 5 Cols: Recent Serial Cycle History & Installation Dates */}
        <div className="lg:col-span-5 surface-card shadow-md overflow-hidden flex flex-col">
          <div className="sb-card-header-light px-6 py-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm sm:text-base font-extrabold text-[#002f49]">
                Recently Updated Serials
              </h3>
              <p className="text-xs text-slate-500">
                Latest 6 by last update · Click a serial to inspect its history &amp; installation date
              </p>
            </div>
            {onNavigateTab && (
              <button
                type="button"
                onClick={() => onNavigateTab('inventory')}
                className="text-xs font-bold text-[#003857] hover:underline flex items-center gap-1 cursor-pointer"
              >
                Full Ledger <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="p-4 space-y-2.5 flex-1">
            {activeDevices.length === 0 ? (
              typeof serverTotalDevices === 'number' && serverTotalDevices > 0 ? (
                <div aria-busy="true" aria-label="Loading recent hardware" className="space-y-2.5">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className="p-3 rounded-xl border border-slate-200/60 bg-slate-50/50 flex items-center justify-between gap-3 animate-pulse"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-8 h-8 rounded-lg bg-slate-200 shrink-0" />
                        <div className="space-y-1.5 flex-1">
                          <div className="h-3.5 bg-slate-200 rounded w-1/2" />
                          <div className="h-2.5 bg-slate-100 rounded w-1/3" />
                        </div>
                      </div>
                      <div className="w-16 h-5 bg-slate-100 rounded" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-10 text-center text-slate-500 text-xs">
                  <Package className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                  <p className="font-bold text-slate-700">No Hardware Registered Yet</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">Use Batch Upload or New Stock Request to register hardware units.</p>
                </div>
              )
            ) : (
              recentDevices.map((dev) => {
              const meta = STAGE_META[dev.stage];
              const cycleCount = (dev.history || []).length;
              return (
                <button
                  type="button"
                  key={dev.serial}
                  onClick={() => onSelectDevice(dev.serial)}
                  aria-label={`Open serial ${dev.serial}`}
                  className="w-full text-left p-3 rounded-xl border bg-slate-50/70 hover:bg-white border-slate-200/80 hover:border-zinc-400 hover:shadow-xs flex items-center justify-between gap-3 transition cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-zinc-100 text-zinc-800 border border-zinc-200 flex items-center justify-center shrink-0">
                      {dev.type === 'POS Terminal' ? (
                        <Cpu className="w-4 h-4" />
                      ) : (
                        <Volume2 className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="font-mono font-extrabold text-zinc-900">
                          {dev.serial}
                        </span>
                        <span className="text-slate-400">·</span>
                        <span className="font-mono text-[11px] text-slate-600 font-semibold">
                          Branch Code {dev.branchId}
                        </span>
                        <span className="text-slate-400">·</span>
                        <span className="font-mono text-[11px] text-zinc-700 font-bold">
                          {cycleCount} History event{cycleCount === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 truncate mt-0.5">
                        {dev.merchantName
                          ? `${dev.merchantName}${dev.mid ? ` (${dev.mid})` : ' (no MID)'}`
                          : dev.model}{' '}
                        ·{' '}
                        {dev.deployedDate
                          ? `Install Date: ${dev.deployedDate}`
                          : `Stock-In: ${dev.stockInDate || '—'}`}
                      </div>
                    </div>
                  </div>

                  <span
                    className={`text-[10px] px-2 py-0.5 rounded border shrink-0 ${meta?.badgeClassLight || ''}`}
                  >
                    {meta?.short || dev.stage}
                  </span>
                </button>
              );
            })
          )}
          </div>
        </div>
      </div>

      {/* Bottom Split: Stock Requisition Alerts + 24-Month Battery Health */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 surface-card shadow-md overflow-hidden">
          <div className="sb-card-header-light px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ScrollText className="w-4 h-4 text-zinc-800" />
              <div>
                <h3 className="text-sm sm:text-base font-extrabold text-zinc-900">
                  Stock Requisition Alerts
                </h3>
                <p className="text-xs text-slate-500">
                  {requisitions.length > 0
                    ? `Showing ${Math.min(4, requisitions.length)} of ${fmtNum(requisitions.length)} stock requests`
                    : 'Stock requests from branches'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono font-bold text-zinc-800">
                {pendingReqs.length} Pending Approval
              </span>
              {onNavigateTab && (
                <button
                  type="button"
                  onClick={() => onNavigateTab('requisitions')}
                  className="text-xs font-bold text-zinc-800 hover:text-zinc-950 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  Manage <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="p-4">
            {requisitions.length === 0 ? (
              <div className="text-center py-6 text-xs text-slate-400">
                No stock requisitions submitted yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {requisitions.slice(0, 4).map((req) => (
                  <div
                    key={req.reqId}
                    className="surface-inset-light p-3.5 flex flex-col justify-between gap-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-extrabold text-zinc-900">
                        {req.reqId} · Branch Code {req.branchId}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                          req.status === 'RECEIVED'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : req.status === 'DISPATCHED'
                            ? 'bg-slate-100 text-slate-700 border-slate-300'
                            : 'bg-amber-50 text-amber-800 border-amber-200'
                        }`}
                      >
                        {req.status}
                      </span>
                    </div>
                    <div className="text-xs font-bold text-zinc-900">
                      Requesting {req.posQty}x POS &amp; {req.sbQty}x Sound Box ({req.branchName})
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {req.reason}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 surface-card shadow-md overflow-hidden flex flex-col justify-between">
          <div className="sb-card-header-light px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BatteryCharging className="w-4 h-4 text-zinc-800" aria-hidden="true" />
              <h3 className="text-sm sm:text-base font-extrabold text-zinc-900">
                {batteryLifespanMonths}-Month POS Battery Schedule
              </h3>
            </div>
            <span className="text-[11px] font-mono text-slate-500">
              POS Terminals only · {fmtNum(batterySummary.total)} units
            </span>
          </div>

          {batterySummary.total === 0 && batterySummary.noDate === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              No POS Terminals in this view.
            </div>
          ) : (
            <div className="p-6 pt-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="surface-inset-light p-3.5">
                  <div className="text-2xl font-black font-figure text-emerald-700">
                    <Odometer value={batterySummary.healthy} format={batterySummary.healthy >= 1000} duration={340} />
                  </div>
                  <div className="text-[11px] font-mono text-slate-500">
                    {pctOf(batterySummary.healthy, batterySummary.total)}%
                  </div>
                  <div className="text-[11px] font-bold text-slate-600 mt-1">
                    Healthy (&lt;{batteryWarningMonths}M)
                  </div>
                </div>
                <div className="surface-inset-light p-3.5">
                  <div className="text-2xl font-black font-figure text-amber-700">
                    <Odometer value={batterySummary.replaceSoon} format={batterySummary.replaceSoon >= 1000} duration={340} />
                  </div>
                  <div className="text-[11px] font-mono text-slate-500">
                    {pctOf(batterySummary.replaceSoon, batterySummary.total)}%
                  </div>
                  <div className="text-[11px] font-bold text-slate-600 mt-1">
                    Due Soon ({batteryWarningMonths}–{batteryLifespanMonths - 1}M)
                  </div>
                </div>
                <div className="surface-inset-light p-3.5">
                  <div className="text-2xl font-black font-figure text-rose-700">
                    <Odometer value={batterySummary.critical} format={batterySummary.critical >= 1000} duration={340} />
                  </div>
                  <div className="text-[11px] font-mono text-slate-500">
                    {pctOf(batterySummary.critical, batterySummary.total)}%
                  </div>
                  <div className="text-[11px] font-bold text-slate-600 mt-1">
                    Replace (≥{batteryLifespanMonths}M)
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 mt-3">
                Months counted from the battery install date (or stock-in / install date when none is recorded).
                {batterySummary.noDate > 0 &&
                  ` ${batterySummary.noDate} POS unit${batterySummary.noDate === 1 ? ' has' : 's have'} no date and ${batterySummary.noDate === 1 ? 'is' : 'are'} not counted.`}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

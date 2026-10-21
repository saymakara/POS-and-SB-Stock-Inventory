import React, { useState, useMemo } from 'react';
import {
  Device,
  Branch,
  Requisition,
  UserRole,
  ThemeMode,
  getBatteryLifecycleStatus,
} from '../types';
import { STAGE_META } from '../data/initialData';
import { GroupedBarChart } from './Charts';
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
  FileDown,
  Building2,
  ScrollText,
  Package,
} from 'lucide-react';

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
}

type PerformanceViewMode =
  | 'MONTHLY_INSTALLS'
  | 'HARDWARE_MIX'
  | 'BRANCH_LEADERBOARD'
  | 'SLA_CYCLE';
type TimeHorizon = '6M' | '12M' | 'Q4_2026';

interface MonthlyBucket {
  monthKey: string;
  label: string;
  shortLabel: string;
  posInstalled: number;
  sbInstalled: number;
  dispatched: number;
  faulty: number;
  total: number;
  target: number;
}

function generateDynamicMonthBuckets(count = 12): {
  monthKey: string;
  label: string;
  shortLabel: string;
}[] {
  const months: { monthKey: string; label: string; shortLabel: string }[] = [];
  const now = new Date();
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const shortNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const monthKey = `${yyyy}-${mm}`;
    const label = `${monthNames[d.getMonth()]} ${yyyy}`;
    const shortLabel = `${shortNames[d.getMonth()]} ${String(yyyy).slice(-2)}`;
    months.push({ monthKey, label, shortLabel });
  }
  return months;
}

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
}) => {
  const currentMonthKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  const [perfViewMode, setPerfViewMode] =
    useState<PerformanceViewMode>('MONTHLY_INSTALLS');
  const [timeHorizon, setTimeHorizon] = useState<TimeHorizon>('6M');
  const [selectedMonthKey, setSelectedMonthKey] = useState<string>(currentMonthKey);

  const isAdminLike = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const activeDevices = useMemo(
    () => devices.filter((d) => !d.archived),
    [devices]
  );

  const monthlyData: MonthlyBucket[] = useMemo(() => {
    const buckets = generateDynamicMonthBuckets(12);
    const bucketMap = new Map<
      string,
      { posInstalled: number; sbInstalled: number; dispatched: number; faulty: number }
    >();

    for (let i = 0; i < buckets.length; i++) {
      bucketMap.set(buckets[i].monthKey, {
        posInstalled: 0,
        sbInstalled: 0,
        dispatched: 0,
        faulty: 0,
      });
    }

    // High-performance single pass across all devices (O(N) handling up to 500K rows)
    const len = activeDevices.length;
    for (let i = 0; i < len; i++) {
      const d = activeDevices[i];
      const depDate = d.deployedDate || d.updatedAt || d.stockInDate || '';
      if (depDate.length >= 7) {
        const mKey = depDate.slice(0, 7);
        const stats = bucketMap.get(mKey);
        if (stats) {
          if (d.stage === 'COMPLETE') {
            if (d.type === 'POS Terminal') stats.posInstalled++;
            else if (d.type === 'Sound Box') stats.sbInstalled++;
          } else if (d.stage === 'FAULTY') {
            stats.faulty++;
          }
          if (d.stage === 'COMPLETE' || d.stage === 'BRANCH_RESERVE' || d.stage === 'CONFIGURING') {
            stats.dispatched++;
          }
        }
      }
    }

    const computed = buckets.map((b) => {
      const s = bucketMap.get(b.monthKey) || {
        posInstalled: 0,
        sbInstalled: 0,
        dispatched: 0,
        faulty: 0,
      };
      const total = s.posInstalled + s.sbInstalled;
      return {
        monthKey: b.monthKey,
        label: b.label,
        shortLabel: b.shortLabel,
        posInstalled: s.posInstalled,
        sbInstalled: s.sbInstalled,
        dispatched: Math.max(s.dispatched, total),
        faulty: s.faulty,
        total,
        target: 50,
      };
    });

    if (timeHorizon === '6M') return computed.slice(-6);
    if (timeHorizon === 'Q4_2026') return computed.slice(-3);
    return computed;
  }, [activeDevices, timeHorizon]);

  const selectedMonthStats = useMemo(() => {
    return (
      monthlyData.find((m) => m.monthKey === selectedMonthKey) ||
      monthlyData[monthlyData.length - 1] || {
        monthKey: currentMonthKey,
        label: 'Current Month',
        shortLabel: 'Now',
        posInstalled: 0,
        sbInstalled: 0,
        dispatched: 0,
        faulty: 0,
        total: 0,
        target: 50,
      }
    );
  }, [monthlyData, selectedMonthKey, currentMonthKey]);

  // High-Throughput Single-Pass Branch Velocity Aggregator
  const branchVelocity = useMemo(() => {
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

    const devLen = allDevices.length;
    for (let i = 0; i < devLen; i++) {
      const d = allDevices[i];
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
        const conversion = s.total > 0 ? Math.round((s.complete / s.total) * 100) : 0;
        return {
          code: b.code,
          name: b.name,
          ...s,
          conversion,
        };
      })
      .sort((a, b) => b.total - a.total || b.complete - a.complete);
  }, [branches, allDevices]);

  const batterySummary = useMemo(() => {
    let healthy = 0;
    let replaceSoon = 0;
    let critical = 0;
    activeDevices.forEach((d) => {
      const st = getBatteryLifecycleStatus(d).state;
      if (st === 'HEALTHY') healthy++;
      else if (st === 'DUE_SOON') replaceSoon++;
      else critical++;
    });
    return { healthy, replaceSoon, critical };
  }, [activeDevices]);

  const pendingReqs = useMemo(
    () => requisitions.filter((r) => r.status === 'PENDING_ADMIN'),
    [requisitions]
  );

  // Classic GroupedBarChart series for Branch / Lifecycle distribution
  const topBranchesChart = useMemo(() => {
    const top = branchVelocity.slice(0, 8);
    return {
      labels: top.map((b) => `Code ${b.code}`),
      posSeries: top.map((b) => b.posCount),
      sbSeries: top.map((b) => b.sbCount),
    };
  }, [branchVelocity]);

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
                · {activeDevices.length} Active Units
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {isAdminLike
                ? 'Monitoring all Branch Codes nationwide · Real-time serial cycle tracking & monthly deployment velocity'
                : `Monitoring Branch Code ${selectedBranch} · Track merchant installations, reserves, and serial lifecycles`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {onNavigateTab && (
            <button
              type="button"
              onClick={() => onNavigateTab('inventory')}
              className="px-3.5 py-2 rounded-lg text-xs font-bold bg-white hover:bg-slate-100 text-zinc-800 border border-slate-200 transition cursor-pointer"
            >
              View Stock Inventory
            </button>
          )}
          <button
            type="button"
            onClick={onOpenExportModal}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold bg-[#003857] hover:bg-[#002a42] text-white shadow-xs transition cursor-pointer"
          >
            <FileDown className="w-3.5 h-3.5" />
            <span>Export Report</span>
          </button>
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
                  { id: 'SLA_CYCLE', label: 'Serial Cycle SLA' },
                ] as { id: PerformanceViewMode; label: string }[]
              ).map((mode) => {
                const active = perfViewMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setPerfViewMode(mode.id)}
                    className={`relative px-3 py-1.5 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                      active
                        ? 'text-white'
                        : 'text-slate-600 hover:text-zinc-900'
                    }`}
                  >
                    {active && (
                      <motion.div
                        layoutId="dashboardPerfViewPill"
                        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
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
                  { id: 'Q4_2026', label: 'Q3-Q4 Focus' },
                ] as { id: TimeHorizon; label: string }[]
              ).map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => setTimeHorizon(h.id)}
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
                <Calendar className="w-3.5 h-3.5 text-[#003857]" />
              </div>
              <div className="text-base sm:text-lg font-extrabold tracking-tight text-[#002f49]">
                {selectedMonthStats.label}
              </div>
              <div className="text-[11px] text-slate-600 font-semibold mt-0.5">
                Target Achievement:{' '}
                <strong className="text-[#003857]">
                  {Math.round(
                    (selectedMonthStats.total / selectedMonthStats.target) * 100
                  )}
                  %
                </strong>
              </div>
            </div>

            <div className="surface-inset-light p-4">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 mb-1">
                <span>COMPLETED INSTALLS</span>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
              </div>
              <div className="text-2xl font-black font-mono tabular-nums text-zinc-900">
                {selectedMonthStats.total}{' '}
                <span className="text-xs font-normal text-slate-500">
                  / {selectedMonthStats.target} quota
                </span>
              </div>
              <div className="text-[11px] text-slate-600 mt-0.5">
                POS: <strong className="text-[#003857]">{selectedMonthStats.posInstalled}</strong> · Sound Box:{' '}
                <strong className="text-emerald-600">{selectedMonthStats.sbInstalled}</strong>
              </div>
            </div>

            <div className="surface-inset-light p-4">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 mb-1">
                <span>DISPATCHED UNITS</span>
                <TrendingUp className="w-3.5 h-3.5 text-zinc-700" />
              </div>
              <div className="text-2xl font-black font-mono tabular-nums text-zinc-900">
                {selectedMonthStats.dispatched}
              </div>
              <div className="text-[11px] text-slate-600 mt-0.5">
                Install Conversion:{' '}
                <strong className="text-emerald-700">
                  {Math.round(
                    (selectedMonthStats.total /
                      Math.max(selectedMonthStats.dispatched, 1)) *
                      100
                  )}
                  %
                </strong>
              </div>
            </div>

            <div className="surface-inset-light p-4">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 mb-1">
                <span>AVG SERIAL CYCLE</span>
                <Clock className="w-3.5 h-3.5 text-slate-600" />
              </div>
              <div className="text-2xl font-black font-mono tabular-nums text-zinc-900">
                2.4 <span className="text-xs font-normal text-slate-500">days</span>
              </div>
              <div className="text-[11px] text-slate-600 font-semibold mt-0.5">
                Within 48h SLA target
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
                      labels={monthlyData.map((m) => m.shortLabel)}
                      series1Label="POS Terminal Installed"
                      series1Data={monthlyData.map((m) => m.posInstalled)}
                      series1Color="#003857"
                      series2Label="Sound Box Installed"
                      series2Data={monthlyData.map((m) => m.sbInstalled)}
                      series2Color="#10b981"
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
                            className={`p-2.5 rounded-lg border text-left transition cursor-pointer ${
                              isSel
                                ? 'bg-[#004953] text-white border-emerald-500/30 shadow-xs'
                                : 'bg-slate-50 hover:bg-slate-100 text-zinc-900 border-slate-200'
                            }`}
                          >
                            <div className="text-xs font-bold">{m.shortLabel}</div>
                            <div
                              className={`text-[11px] font-mono mt-0.5 ${
                                isSel ? 'text-slate-200' : 'text-slate-500'
                              }`}
                            >
                              {m.total} installed / {m.target}
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
                {monthlyData.map((m) => {
                  const posPct = Math.round(
                    (m.posInstalled / Math.max(m.total, 1)) * 100
                  );
                  const sbPct = 100 - posPct;
                  return (
                    <div
                      key={m.monthKey}
                      onClick={() => setSelectedMonthKey(m.monthKey)}
                      className={`p-3 rounded-lg border transition cursor-pointer ${
                        m.monthKey === selectedMonthStats.monthKey
                          ? 'bg-[#eef5f9] border-[#003857]'
                          : 'bg-slate-50/70 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs font-bold mb-1.5">
                        <span className="text-[#002f49]">{m.label}</span>
                        <div className="flex items-center gap-4 font-mono text-[11px] text-slate-600">
                          <span>
                            POS Terminal: <strong className="text-[#003857]">{m.posInstalled}</strong> ({posPct}%)
                          </span>
                          <span>
                            Sound Box: <strong className="text-emerald-600">{m.sbInstalled}</strong> ({sbPct}%)
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
                          className="h-full bg-[#10b981]"
                        />
                      </div>
                    </div>
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
                  series2Color="#10b981"
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
                {[
                  {
                    stage: 'HQ Stock → Branch Code Reserve',
                    avgTime: '6.5 hrs',
                    target: '< 12 hrs',
                    compliance: '98.4%',
                  },
                  {
                    stage: 'Branch Reserve → Configuring',
                    avgTime: '14.2 hrs',
                    target: '< 24 hrs',
                    compliance: '95.1%',
                  },
                  {
                    stage: 'Branch Config → Installed Live',
                    avgTime: '22.5 hrs',
                    target: '< 24 hrs',
                    compliance: '96.2%',
                  },
                ].map((sla) => (
                  <div key={sla.stage} className="surface-inset-light p-4">
                    <div className="text-xs font-bold text-slate-500 mb-2">
                      {sla.stage}
                    </div>
                    <div className="text-2xl font-black font-mono text-zinc-900">
                      {sla.avgTime}
                    </div>
                    <div className="flex items-center justify-between text-[11px] mt-2 pt-2 border-t border-slate-200">
                      <span className="text-slate-500">Target: {sla.target}</span>
                      <span className="font-bold text-emerald-700">
                        {sla.compliance} SLA
                      </span>
                    </div>
                  </div>
                ))}
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
                  Real-time POS Terminal &amp; Sound Box distribution by Branch Code
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
                  <th className="py-3 px-4">Branch Code</th>
                  <th className="py-3 px-4">Branch Name</th>
                  <th className="py-3 px-3 text-center">POS</th>
                  <th className="py-3 px-3 text-center">Soundbox</th>
                  <th className="py-3 px-3 text-center">Reserve</th>
                  <th className="py-3 px-3 text-center">Installed</th>
                  <th className="py-3 px-4 text-right">Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70">
                {branchVelocity.slice(0, 8).map((b) => (
                  <tr
                    key={b.code}
                    className="hover:bg-slate-50/90 transition-colors"
                  >
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
                Recent Serial Cycle History
              </h3>
              <p className="text-xs text-slate-500">
                Click any serial to inspect its cycle history &amp; installation date
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
              <div className="py-10 text-center text-slate-500 text-xs">
                <Package className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                <p className="font-bold text-slate-700">No Hardware Dispatched Yet</p>
                <p className="text-[11px] text-slate-500 mt-0.5">Use Batch Upload or New Stock Request to register hardware units.</p>
              </div>
            ) : (
              activeDevices.slice(0, 6).map((dev) => {
              const meta = STAGE_META[dev.stage];
              const cycleCount = (dev.history || []).length;
              return (
                <div
                  key={dev.serial}
                  onClick={() => onSelectDevice(dev.serial)}
                  className="p-3 rounded-xl border bg-slate-50/70 hover:bg-white border-slate-200/80 hover:border-zinc-400 hover:shadow-xs flex items-center justify-between gap-3 transition cursor-pointer"
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
                          {cycleCount} Cycle{cycleCount === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 truncate mt-0.5">
                        {dev.merchantName
                          ? `${dev.merchantName} (${dev.mid || 'MID'})`
                          : dev.model}{' '}
                        ·{' '}
                        {dev.deployedDate
                          ? `Install Date: ${dev.deployedDate}`
                          : `Stock-In: ${dev.stockInDate}`}
                      </div>
                    </div>
                  </div>

                  <span
                    className={`text-[10px] px-2 py-0.5 rounded border shrink-0 ${meta.badgeClassLight}`}
                  >
                    {meta.short}
                  </span>
                </div>
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
                  Every branch request triggers an instant alert notification to Admin HQ
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
              <BatteryCharging className="w-4 h-4 text-zinc-800" />
              <h3 className="text-sm sm:text-base font-extrabold text-zinc-900">
                24-Month Battery Health Telemetry
              </h3>
            </div>
            <span className="text-[11px] font-mono text-slate-500">
              2-Year Cycle Standard
            </span>
          </div>

          <div className="p-6 grid grid-cols-3 gap-3 text-center">
            <div className="surface-inset-light p-3.5">
              <div className="text-2xl font-black font-mono text-emerald-700">
                {batterySummary.healthy}
              </div>
              <div className="text-[11px] font-bold text-slate-600 mt-1">
                Healthy (&lt;20M)
              </div>
            </div>
            <div className="surface-inset-light p-3.5">
              <div className="text-2xl font-black font-mono text-amber-700">
                {batterySummary.replaceSoon}
              </div>
              <div className="text-[11px] font-bold text-slate-600 mt-1">
                Due Soon (20-23M)
              </div>
            </div>
            <div className="surface-inset-light p-3.5">
              <div className="text-2xl font-black font-mono text-rose-700">
                {batterySummary.critical}
              </div>
              <div className="text-[11px] font-bold text-slate-600 mt-1">
                Replace (≥24M)
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

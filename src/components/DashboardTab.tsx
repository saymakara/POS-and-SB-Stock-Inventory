import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
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
import { GroupedBarChart, CrossChannelVelocityChart, CrossChannelDayPoint } from './Charts';
import { Odometer } from './Odometer';
import { PillMotion } from './PillMotion';
import { todayPP, lastMonthsPP } from '../utils/time';
import { fmtNum } from '../utils/format';
import { SPRING_TAB_PILL } from '../utils/animationRules';
import { isPhnomPenhBranch, type FieldScope } from '../utils/fieldScope';
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
  fetchQrSummary,
  fetchMvVisitSummary,
  type QrSummary,
  type MvVisitSummary,
} from '../services/supabaseService';
import {
  fetchMaterialBalances,
  fetchSerialStatusCounts,
  MATERIALS,
  type MaterialBalance,
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
  phoneReviewScope?: FieldScope;
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

export const DashboardTab: React.FC<DashboardTabProps> = ({
  devices,
  allDevices,
  branches,
  requisitions,
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
  phoneReviewScope = 'PHNOM_PENH',
  actionQueues,
}) => {
  const today = todayPP();
  const isAdminLike = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const branchScopedId = !isAdminLike ? (selectedBranch || '') : '';

  const [period, setPeriod] = useState<DashPeriod>('MONTH');
  const [adminScope, setAdminScope] = useState<FieldScope>(
    phoneReviewScope === 'ALL' ? 'ALL' : 'PHNOM_PENH'
  );
  const [chartMode, setChartMode] = useState<ChartMode>('VELOCITY');
  const [timeHorizon, setTimeHorizon] = useState<TimeHorizon>('6M');
  const [activityPanel, setActivityPanel] = useState<ActivityPanelMode>('REQUISITIONS');

  const effectiveScope: FieldScope = branchScopedId ? 'ALL' : isAdminLike ? adminScope : 'ALL';
  const range = useMemo(() => kpiPeriodRange(period), [period]);

  const [kpiData, setKpiData] = useState<KpiDashboardData | null>(
    () => getCachedKpiSummary(range.from, range.to) || getCachedKpiSummary(null, null) || null
  );
  const [ccCounts, setCcCounts] = useState<CcCounts | null>(
    () => getCachedCcCounts(`${range.from || ''}|${range.to || ''}`) || null
  );
  const [qrSummary, setQrSummary] = useState<QrSummary | null>(null);
  const [mvSummary, setMvSummary] = useState<MvVisitSummary | null>(null);
  const [matBalances, setMatBalances] = useState<MaterialBalance[]>([]);
  const [simCounts, setSimCounts] = useState<Record<SerialStatus, number> | null>(null);
  const [syncing, setSyncing] = useState(false);

  const loadSeqRef = useRef(0);

  const loadCrossPortalData = useCallback(
    async (force = false) => {
      const seq = ++loadSeqRef.current;
      const hitKpi = !force ? getCachedKpiSummary(range.from, range.to) : undefined;
      if (hitKpi) setKpiData(hitKpi);
      setSyncing(!hitKpi || force);

      const simBranchArg = branchScopedId || undefined;
      const [kpiRes, ccRes, qrRes, mvRes, matRes, simRes] = await Promise.allSettled([
        fetchKpiSummary(range.from, range.to, force),
        fetchCcCounts(range.from, range.to, force ? 0 : 45000),
        fetchQrSummary(range.from, range.to),
        fetchMvVisitSummary(range.from, range.to),
        fetchMaterialBalances(force),
        fetchSerialStatusCounts('SIM', simBranchArg, force),
      ]);

      if (seq !== loadSeqRef.current) return;
      if (kpiRes.status === 'fulfilled') setKpiData(kpiRes.value);
      if (ccRes.status === 'fulfilled' && ccRes.value) setCcCounts(ccRes.value);
      if (qrRes.status === 'fulfilled' && qrRes.value) setQrSummary(qrRes.value);
      if (mvRes.status === 'fulfilled' && mvRes.value) setMvSummary(mvRes.value);
      if (matRes.status === 'fulfilled') setMatBalances(matRes.value);
      if (simRes.status === 'fulfilled') setSimCounts(simRes.value);
      setSyncing(false);
    },
    [range.from, range.to, branchScopedId]
  );

  useEffect(() => {
    void loadCrossPortalData(false);
  }, [loadCrossPortalData]);

  // Helper matching a branch ID / name against the selected scope cleanly
  const isRowInScope = useCallback(
    (branchId?: string | null, branchName?: string | null): boolean => {
      const bid = String(branchId || '').trim();
      if (branchScopedId) return bid === branchScopedId;
      if (effectiveScope === 'ALL') return true;
      return isPhnomPenhBranch({ id: bid, code: bid, name: String(branchName || '') });
    },
    [branchScopedId, effectiveScope]
  );

  // Rule lookup map for KPI point valuation
  const ruleMap = useMemo(() => {
    const m = new Map<string, KpiPointRule>();
    for (const r of kpiData?.rules || []) m.set(r.code, r);
    return m;
  }, [kpiData]);

  // Scoped cross-channel KPI totals computed from unified server KPI summary
  const scopedKpiTotals = useMemo(() => {
    const raw = buildEmptyRawCounts();
    let ccSubmitted = 0;
    let khqrFailed = 0;
    const activeBranches = new Set<string>();
    const activeStaff = new Set<string>();

    const staffList = kpiData?.staff || [];
    for (const s of staffList) {
      if (!isRowInScope(s.branchId, s.branchName)) continue;
      sumRawInto(raw, s);
      ccSubmitted += s.ccSubmitted || 0;
      khqrFailed += s.khqrFailed || 0;
      const pts = computeKpiPoints(s, ruleMap);
      if (pts.totalTasks > 0) {
        activeStaff.add(s.staffId);
        if (s.branchId && s.branchId !== 'UNASSIGNED') activeBranches.add(s.branchId);
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
  }, [kpiData, isRowInScope, ruleMap]);

  // 14-day / window Daily Cross-Channel Velocity time series (matches KPI Performance daily totals)
  const velocitySeries: CrossChannelDayPoint[] = useMemo(() => {
    const dailyStaff = kpiData?.dailyStaff || [];
    const fromYmd = range.from ? range.from.slice(0, 10) : '';
    const toYmd = range.to ? range.to.slice(0, 10) : '';
    const byDay = new Map<
      string,
      { pos: number; sb: number; khqr: number; mv: number; cc: number; staff: Set<string>; branches: Set<string> }
    >();

    for (const ds of dailyStaff) {
      if (!ds.day) continue;
      if (fromYmd && ds.day < fromYmd) continue;
      if (toYmd && ds.day >= toYmd) continue;
      if (!isRowInScope(ds.branchId, ds.branchName)) continue;

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
        if (ds.staffId) b.staff.add(ds.staffId);
        if (ds.branchId && ds.branchId !== 'UNASSIGNED') b.branches.add(ds.branchId);
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
        activeStaff: hit?.staff.size || 0,
        activeBranches: hit?.branches.size || 0,
      };
    });
  }, [kpiData, range.from, range.to, period, today, isRowInScope]);

  // Hardware & Inventory metrics
  const hardwareSource = useMemo(
    () => (effectiveScope === 'ALL' && !branchScopedId && allDevices.length > 0 ? allDevices : devices),
    [effectiveScope, branchScopedId, allDevices, devices]
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
  }, [simCounts, matBalances, branchScopedId]);

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

  // Fallback-aware channel breakdown for display
  const channelActivity = useMemo(() => {
    const { computed, raw } = scopedKpiTotals;
    const useServerDirectFallback = effectiveScope === 'ALL' && !branchScopedId && !kpiData?.staff?.length;
    const khqrCount =
      computed.khqrTasks > 0
        ? computed.khqrTasks
        : useServerDirectFallback && qrSummary
        ? qrSummary.total
        : 0;
    const sbCount = computed.sbTasks;
    const posCount = computed.posTasks;
    const mvCount =
      computed.mvTasks > 0
        ? computed.mvTasks
        : useServerDirectFallback && mvSummary
        ? mvSummary.total
        : 0;
    const ccCount =
      computed.ccTasks > 0
        ? computed.ccTasks
        : ccCounts && !branchScopedId && effectiveScope === 'ALL'
        ? ccCounts.cards
        : 0;

    const ccSubmittedShow =
      !branchScopedId && effectiveScope === 'ALL' && ccCounts
        ? ccCounts.total
        : Math.max(scopedKpiTotals.ccSubmitted, ccCount);

    const maxVal = Math.max(1, khqrCount, sbCount, posCount, mvCount, ccSubmittedShow);

    return {
      totalTasks: khqrCount + sbCount + posCount + mvCount + ccCount,
      totalPoints: computed.totalPoints,
      khqrCount,
      khqrNew: raw.khqrInstall || (useServerDirectFallback && qrSummary ? qrSummary.install : 0),
      khqrReplace: raw.khqrReplace || (useServerDirectFallback && qrSummary ? qrSummary.replace : 0),
      khqrMaterials: raw.khqrMaterials || (useServerDirectFallback && qrSummary ? qrSummary.qr : 0),
      sbCount,
      posCount,
      mvCount,
      ccCount,
      ccSubmittedShow,
      rows: [
        {
          id: 'khqr',
          label: 'KHQR Onboarding & Replace',
          tab: 'mobile_sync_khqr',
          icon: QrCode,
          iconWrap: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
          barColor: 'bg-emerald-500',
          primaryValue: khqrCount,
          primaryUnit: 'tasks',
          meta: `${fmtNum(raw.khqrInstall)} new · ${fmtNum(raw.khqrReplace)} replace${raw.khqrMaterials > 0 ? ` · ${fmtNum(raw.khqrMaterials)} QR items` : ''}`,
          pct: Math.max(khqrCount > 0 ? 4 : 0, Math.round((khqrCount / maxVal) * 100)),
        },
        {
          id: 'sb',
          label: 'Sound Box Field & Stock',
          tab: 'mobile_sync_sb',
          icon: Volume2,
          iconWrap: 'bg-indigo-50 text-[#4F518C] border-indigo-200/80',
          barColor: 'bg-[#4F518C]',
          primaryValue: sbCount,
          primaryUnit: 'tasks',
          meta: `${fmtNum(hardwareSummary.sb)} units in stock · ${fmtNum(queues.sbField)} awaiting review`,
          pct: Math.max(sbCount > 0 ? 4 : 0, Math.round((sbCount / maxVal) * 100)),
        },
        {
          id: 'pos',
          label: 'POS Terminal Field & Stock',
          tab: 'mobile_sync',
          icon: Cpu,
          iconWrap: 'bg-sky-50 text-[#004e75] border-sky-200/80',
          barColor: 'bg-[#004e75]',
          primaryValue: posCount,
          primaryUnit: 'tasks',
          meta: `${fmtNum(hardwareSummary.pos)} units in stock · ${fmtNum(queues.posField)} awaiting review`,
          pct: Math.max(posCount > 0 ? 4 : 0, Math.round((posCount / maxVal) * 100)),
        },
        {
          id: 'mv',
          label: 'Merchant Visit',
          tab: 'mobile_sync_visit',
          icon: Store,
          iconWrap: 'bg-cyan-50 text-sky-700 border-cyan-200/80',
          barColor: 'bg-sky-500',
          primaryValue: mvCount,
          primaryUnit: 'visits',
          meta:
            mvSummary && mvSummary.total > 0 && effectiveScope === 'ALL'
              ? `${fmtNum(mvSummary.withGps)} GPS tagged · ${fmtNum(mvSummary.branches)} active branches`
              : 'Merchant check-ins & field onboarding visits',
          pct: Math.max(mvCount > 0 ? 4 : 0, Math.round((mvCount / maxVal) * 100)),
        },
        {
          id: 'cc',
          label: 'Credit Card Acquisition',
          tab: 'mobile_sync_cc',
          icon: CreditCard,
          iconWrap: 'bg-amber-50 text-amber-700 border-amber-200/80',
          barColor: 'bg-amber-500',
          primaryValue: ccCount,
          primaryUnit: 'onboarded',
          meta: `${fmtNum(ccSubmittedShow)} applications · ${fmtNum(queues.ccPend)} pending${ccCounts?.waitingDocs ? ` · ${fmtNum(ccCounts.waitingDocs)} waiting docs` : ''}`,
          pct: Math.max(ccCount > 0 || ccSubmittedShow > 0 ? 4 : 0, Math.round((Math.max(ccCount, ccSubmittedShow) / maxVal) * 100)),
        },
      ],
    };
  }, [scopedKpiTotals, effectiveScope, branchScopedId, kpiData, qrSummary, mvSummary, ccCounts, hardwareSummary.sb, hardwareSummary.pos, queues]);

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
      const code = s.branchId || 'UNASSIGNED';
      if (code === 'UNASSIGNED') continue;
      if (!isRowInScope(code, s.branchName)) continue;
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
        if (b.code === '100') continue;
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
  }, [kpiData, branches, allDevices, devices, isAdminLike, isRowInScope, ruleMap, branchScopedId]);

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
    : effectiveScope === 'PHNOM_PENH'
    ? `Phnom Penh · ${branches.length} branches`
    : `All Branches · ${scopedKpiTotals.activeBranchCount || branches.length} active`;

  const actionQueueRows = [
    {
      id: 'sb',
      label: 'Sound Box Field App',
      sub: 'Installations, swaps & operational support',
      count: queues.sbField,
      tab: 'mobile_sync_sb',
      badgeClass: queues.sbField > 0 ? 'bg-indigo-50 text-[#4F518C] border-indigo-200/80' : 'bg-emerald-50 text-emerald-700 border-emerald-200',
      dotClass: 'bg-[#4F518C]',
    },
    {
      id: 'pos',
      label: 'POS Terminal Field App',
      sub: 'Installations, battery changes & maintenance',
      count: queues.posField,
      tab: 'mobile_sync',
      badgeClass: queues.posField > 0 ? 'bg-sky-50 text-[#004e75] border-sky-200/80' : 'bg-emerald-50 text-emerald-700 border-emerald-200',
      dotClass: 'bg-[#004e75]',
    },
    {
      id: 'cc',
      label: 'Credit Card Review',
      sub: ccCounts?.waitingDocs ? `${fmtNum(ccCounts.waitingDocs)} waiting documents at HQ` : 'Pending Card Center & document verification',
      count: queues.ccPend,
      tab: 'mobile_sync_cc',
      badgeClass: queues.ccPend > 0 ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200',
      dotClass: 'bg-amber-500',
    },
    {
      id: 'req',
      label: 'Branch Stock Requests',
      sub: `${fmtNum(reqStats.received)} received · ${fmtNum(reqStats.rejected)} rejected`,
      count: queues.reqPend,
      tab: 'requisitions',
      badgeClass: queues.reqPend > 0 ? 'bg-teal-50 text-teal-800 border-teal-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200',
      dotClass: 'bg-teal-600',
    },
  ];

  const reachTotal =
    channelActivity.khqrCount + channelActivity.mvCount + channelActivity.ccSubmittedShow;

  return (
    <div className="space-y-5 apple-tab-panel" aria-label="Executive Operations Overview">
      {/* ───────────── 1. HEADER & PERIOD / SCOPE CONTROLS ───────────── */}
      <div className="surface-card px-5 py-4 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-3.5 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-[#003857] flex items-center justify-center text-white shadow-sm shrink-0">
            <BarChart3 className="w-5 h-5 text-white" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-extrabold tracking-tight text-slate-900">
              {branchScopedId
                ? `Branch Code ${branchScopedId} Operations Overview`
                : 'Executive Operations Overview'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              5 Field Channels, Hardware &amp; SIM Stock, Credit Cards &amp; Requests ·{' '}
              <span className="font-semibold text-slate-700">{branchScopeDisplay}</span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap xl:flex-nowrap xl:justify-end items-center gap-2 shrink-0">
          {/* Period Switcher */}
          <div
            className="inline-flex items-center p-1 rounded-xl bg-slate-100/90 border border-slate-200/80 gap-0.5"
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
                  className={`relative px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                    active ? 'text-white font-semibold' : 'text-slate-600 hover:text-slate-900 font-medium'
                  }`}
                >
                  {active && (
                    <PillMotion
                      layoutId="dash-period-pill"
                      transition={SPRING_TAB_PILL}
                      className="absolute inset-0 rounded-lg tab-active-blue shadow-2xs pointer-events-none"
                    />
                  )}
                  <span className="relative z-10">{opt.label}</span>
                </button>
              );
            })}
          </div>

          {/* Scope Toggle (Admin HQ only) */}
          {isAdminLike && !branchScopedId && (
            <div
              className="inline-flex items-center p-1 rounded-xl bg-slate-100/90 border border-slate-200/80 gap-0.5"
              role="tablist"
              aria-label="Branch Data Scope"
            >
              {([
                { id: 'PHNOM_PENH' as const, label: 'Phnom Penh' },
                { id: 'ALL' as const, label: 'All Branches' },
              ]).map((s) => {
                const active = adminScope === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setAdminScope(s.id)}
                    className={`relative px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                      active ? 'text-white font-semibold' : 'text-slate-600 hover:text-slate-900 font-medium'
                    }`}
                  >
                    {active && (
                      <PillMotion
                        layoutId="dash-scope-pill"
                        transition={SPRING_TAB_PILL}
                        className="absolute inset-0 rounded-lg tab-active-blue shadow-2xs pointer-events-none"
                      />
                    )}
                    <span className="relative z-10">{s.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          <button
            type="button"
            onClick={() => void loadCrossPortalData(true)}
            className="btn-press px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 inline-flex items-center gap-1.5 cursor-pointer transition shadow-2xs"
            title="Refresh live summary counts"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-slate-600 ${syncing ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Sync</span>
          </button>

          {isAdminLike && (
            <button
              type="button"
              onClick={onOpenExportModal}
              className="btn-press px-3 py-2 rounded-xl text-xs font-bold border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 inline-flex items-center gap-1.5 cursor-pointer transition shadow-2xs"
              title="Export Reports & Data"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
              <span>Export</span>
            </button>
          )}
        </div>
      </div>

      {/* ───────────── 2. UNIFIED 4-COLUMN HAIRLINE KPI STRIP (OPTION 1) ───────────── */}
      <section
        className="surface-card overflow-hidden grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200/80 sm:[&>*:nth-child(n+3)]:border-t sm:[&>*:nth-child(n+3)]:border-slate-200/80 xl:[&>*:nth-child(n+3)]:border-t-0"
        aria-label="Key portal metrics"
      >
        {/* KPI 1: Field Tasks */}
        <div className="p-5 flex flex-col justify-between gap-1.5">
          <div className="flex items-center justify-between gap-2 min-h-[24px]">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap">
              Field Tasks · {activePeriodLabel}
            </span>
            <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/70 whitespace-nowrap shrink-0">
              {fmtNum(Math.round(channelActivity.totalPoints))} pts
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-black font-figure text-slate-900 tracking-tight">
            <Odometer value={channelActivity.totalTasks} format duration={320} />
          </div>
          <div className="text-xs text-slate-500">
            {fmtNum(scopedKpiTotals.activeBranchCount || branches.length)} branches ·{' '}
            {fmtNum(scopedKpiTotals.activeStaffCount)} active staff
          </div>
        </div>

        {/* KPI 2: Pending Approvals */}
        <div className="p-5 flex flex-col justify-between gap-1.5">
          <div className="flex items-center justify-between gap-2 min-h-[24px]">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap">
              Pending Approvals
            </span>
            {queues.total > 0 ? (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200/80 whitespace-nowrap shrink-0">
                Action needed
              </span>
            ) : (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/80 whitespace-nowrap shrink-0">
                All clear
              </span>
            )}
          </div>
          <div
            className={`text-2xl sm:text-3xl font-black font-figure tracking-tight ${
              queues.total > 0 ? 'text-amber-700' : 'text-slate-900'
            }`}
          >
            <Odometer value={queues.total} format duration={320} />
          </div>
          <div className="text-xs text-slate-500">
            {fmtNum(queues.appTotal)} App Reviews · {fmtNum(queues.reqPend)} Stock Requests
          </div>
        </div>

        {/* KPI 3: Hardware & SIM Pool */}
        <div className="p-5 flex flex-col justify-between gap-1.5">
          <div className="flex items-center justify-between gap-2 min-h-[24px]">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap">
              Stock &amp; SIM Pool
            </span>
            {queues.pushPend > 0 && (
              <button
                type="button"
                onClick={() => onNavigateTab?.('push_configuring')}
                className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-sky-50 text-[#004e75] border border-sky-200/80 hover:bg-sky-100 cursor-pointer transition whitespace-nowrap shrink-0"
              >
                {fmtNum(queues.pushPend)} push due
              </button>
            )}
          </div>
          <div className="text-2xl sm:text-3xl font-black font-figure text-slate-900 tracking-tight">
            <Odometer value={hardwareSummary.total} format duration={320} />
          </div>
          <div className="text-xs text-slate-500">
            {fmtNum(hardwareSummary.hq)} HQ · {fmtNum(hardwareSummary.reserve)} Reserve ·{' '}
            {fmtNum(hardwareSummary.installed)} Live · {fmtNum(materialsSummary.simTotal)} SIM
          </div>
        </div>

        {/* KPI 4: KHQR, Visits & Credit Cards */}
        <div className="p-5 flex flex-col justify-between gap-1.5">
          <div className="flex items-center justify-between gap-2 min-h-[24px]">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap">
              Digital &amp; Reach
            </span>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200/80 whitespace-nowrap shrink-0">
              {activePeriodLabel}
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-black font-figure text-slate-900 tracking-tight">
            <Odometer value={reachTotal} format duration={320} />
          </div>
          <div className="text-xs text-slate-500">
            {fmtNum(channelActivity.khqrCount)} KHQR · {fmtNum(channelActivity.mvCount)} Visits ·{' '}
            {fmtNum(channelActivity.ccCount)}/{fmtNum(channelActivity.ccSubmittedShow)} Cards
          </div>
        </div>
      </section>

      {/* ───────────── 3. MIDDLE SPLIT: 5-CHANNEL HORIZONTAL MINI-BARS + ACTION QUEUE ───────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left 7 Cols: 5-Channel Portal Activity (Horizontal Mini-Bar Flat Rows) */}
        <section className="lg:col-span-7 surface-card overflow-hidden flex flex-col">
          <div className="sb-card-header-light px-5 py-3.5 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm sm:text-[15px] font-extrabold text-slate-900">
                5-Channel Portal Activity
              </h3>
              <p className="text-xs text-slate-500">
                Unified breakdown across KHQR, Sound Box, POS Terminal, Merchant Visit &amp; Credit Card · Click to open
              </p>
            </div>
            {onNavigateTab && (
              <button
                type="button"
                onClick={() => onNavigateTab('kpi_performance')}
                className="text-xs font-bold text-[#004e75] hover:underline inline-flex items-center gap-1 shrink-0 cursor-pointer"
              >
                Full KPI <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="divide-y divide-slate-100 px-5 py-1 flex-1 flex flex-col justify-center">
            {channelActivity.rows.map((row) => {
              const Icon = row.icon;
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => onNavigateTab?.(row.tab)}
                  className="w-full text-left py-3 group flex items-center gap-3.5 hover:bg-slate-50/80 -mx-2 px-2 rounded-xl transition cursor-pointer"
                >
                  <div className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${row.iconWrap}`}>
                    <Icon className="w-4 h-4" aria-hidden="true" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs sm:text-[13px] font-bold text-slate-900 group-hover:text-[#004e75] transition truncate">
                        {row.label}
                      </span>
                      <span className="text-xs font-figure font-extrabold text-slate-900 shrink-0">
                        {fmtNum(row.primaryValue)}{' '}
                        <span className="font-medium text-slate-500 text-[11px]">{row.primaryUnit}</span>
                      </span>
                    </div>

                    <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${row.barColor}`}
                        style={{ width: `${row.pct}%` }}
                      />
                    </div>

                    <div className="mt-1 text-[11px] text-slate-500 truncate">{row.meta}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Right 5 Cols: Action Queue — Needs Review */}
        <section className="lg:col-span-5 surface-card overflow-hidden flex flex-col justify-between">
          <div className="sb-card-header-light px-5 py-3.5 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm sm:text-[15px] font-extrabold text-slate-900">
                Action Queue — Needs Review
              </h3>
              <p className="text-xs text-slate-500">
                Pending approvals &amp; requisitions across the portal
              </p>
            </div>
            <span
              className={`text-xs font-figure font-bold px-2.5 py-0.5 rounded-full border ${
                queues.total > 0
                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}
            >
              {fmtNum(queues.total)} waiting
            </span>
          </div>

          <div className="p-4 space-y-2.5 flex-1">
            {actionQueueRows.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigateTab?.(item.tab)}
                className="w-full text-left p-3 rounded-xl border border-slate-200/80 bg-slate-50/60 hover:bg-white hover:border-slate-300 hover:shadow-2xs flex items-center justify-between gap-3 transition cursor-pointer"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${item.dotClass}`} />
                  <div className="min-w-0">
                    <div className="text-xs sm:text-[13px] font-bold text-slate-900 truncate">
                      {item.label}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">{item.sub}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className={`font-figure text-xs font-extrabold px-2.5 py-0.5 rounded-full border ${item.badgeClass}`}>
                    {fmtNum(item.count)}
                  </span>
                  <span className="text-xs font-bold text-[#004e75] inline-flex items-center gap-0.5">
                    Open <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </span>
                </div>
              </button>
            ))}
          </div>

          {/* Secondary Operational Alerts Strip (Push Config + Open Lost) */}
          <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/70 flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <button
              type="button"
              onClick={() => onNavigateTab?.('push_configuring')}
              className="inline-flex items-center gap-1.5 text-slate-600 hover:text-[#004e75] font-semibold cursor-pointer transition"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-[#004e75]" aria-hidden="true" />
              <span>Push Configuring Queue:</span>
              <strong className="font-figure text-slate-900">{fmtNum(queues.pushPend)}</strong>
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab?.(queues.lostOpen > 0 && (actionQueues?.lostSim || 0) > 0 ? 'sim_cards' : 'inventory')}
              className="inline-flex items-center gap-1.5 text-slate-600 hover:text-rose-700 font-semibold cursor-pointer transition"
            >
              <AlertCircle className={`w-3.5 h-3.5 ${queues.lostOpen > 0 ? 'text-rose-600' : 'text-slate-400'}`} aria-hidden="true" />
              <span>Open Lost Reports:</span>
              <strong className={`font-figure ${queues.lostOpen > 0 ? 'text-rose-700' : 'text-slate-900'}`}>
                {fmtNum(queues.lostOpen)}
              </strong>
            </button>
          </div>
        </section>
      </div>

      {/* ───────────── 4. THIRD SPLIT: CROSS-CHANNEL VELOCITY CHART + INVENTORY & SIM HEALTH ───────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left 7 Cols: Cross-Channel Velocity vs Monthly Hardware Installs */}
        <section className="lg:col-span-7 surface-card overflow-hidden flex flex-col">
          <div className="sb-card-header-light px-5 py-3.5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <TrendingUp className="w-4 h-4 text-[#003857] shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <h3 className="text-sm sm:text-[15px] font-extrabold text-slate-900 truncate">
                  {chartMode === 'VELOCITY'
                    ? 'Cross-Channel Daily Velocity & Active Staff'
                    : 'Monthly Hardware Deployments (POS vs SB)'}
                </h3>
                <p className="text-xs text-slate-500 truncate">
                  {chartMode === 'VELOCITY'
                    ? 'Daily 5-channel volume with active staff trendline'
                    : 'Completed merchant installs over selected horizon'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {chartMode === 'HARDWARE_MONTHLY' && (
                <div className="inline-flex items-center p-0.5 rounded-lg bg-white border border-slate-200 text-[11px] shrink-0">
                  {(['3M', '6M', '12M'] as TimeHorizon[]).map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setTimeHorizon(h)}
                      className={`px-2 py-1 rounded-md font-semibold cursor-pointer transition whitespace-nowrap ${
                        timeHorizon === h ? 'bg-[#003857] text-white' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {h}
                    </button>
                  ))}
                </div>
              )}

              <div
                className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 border border-slate-200/80 text-[11px] shrink-0"
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
                    className={`px-2.5 py-1 rounded-md font-semibold cursor-pointer transition whitespace-nowrap ${
                      chartMode === m.id ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="p-4 pt-3 flex-1 flex flex-col justify-between">
            {chartMode === 'VELOCITY' && (
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 text-[11px] text-slate-600">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-xs bg-[#004e75] inline-block" />POS</span>
                  <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-xs bg-[#4F518C] inline-block" />Sound Box</span>
                  <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-xs bg-emerald-500 inline-block" />KHQR</span>
                  <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-xs bg-sky-500 inline-block" />Merchant Visit</span>
                  <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-xs bg-amber-500 inline-block" />Credit Card</span>
                </div>
                <span className="inline-flex items-center gap-1.5 text-[#004e75] font-semibold">
                  <span className="w-4 border-t-2 border-dashed border-[#004e75] inline-block" />
                  Active staff (right axis)
                </span>
              </div>
            )}

            {chartMode === 'VELOCITY' ? (
              <CrossChannelVelocityChart items={velocitySeries} height={240} theme={theme} />
            ) : (
              <GroupedBarChart
                labels={monthlyHardwareChart.labels}
                series1Label="POS Terminal Installed"
                series1Data={monthlyHardwareChart.pos}
                series1Color="#004e75"
                series2Label="Sound Box Installed"
                series2Data={monthlyHardwareChart.sb}
                series2Color="#4F518C"
                height={240}
                theme={theme}
              />
            )}
          </div>
        </section>

        {/* Right 5 Cols: Inventory, SIM, Materials & Battery Health */}
        <section className="lg:col-span-5 surface-card overflow-hidden flex flex-col justify-between">
          <div className="sb-card-header-light px-5 py-3.5 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm sm:text-[15px] font-extrabold text-slate-900">
                Inventory, SIM &amp; Battery Health
              </h3>
              <p className="text-xs text-slate-500">
                Live stock allocation, materials &amp; {batteryLifespanMonths}-month POS battery SLA
              </p>
            </div>
            {onNavigateTab && (
              <button
                type="button"
                onClick={() => onNavigateTab('inventory')}
                className="text-xs font-bold text-[#004e75] hover:underline inline-flex items-center gap-1 shrink-0 cursor-pointer"
              >
                Stock <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="divide-y divide-slate-100 px-5 py-1 flex-1 flex flex-col justify-center">
            {/* Row 1: Hardware Pipeline */}
            <div className="py-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-900 flex items-center gap-1.5">
                  <Boxes className="w-3.5 h-3.5 text-[#004e75]" aria-hidden="true" />
                  POS &amp; Sound Box Pool
                </span>
                <span className="font-figure font-extrabold text-slate-900">
                  {fmtNum(hardwareSummary.total)} units
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden flex">
                {hardwareSummary.total > 0 && (
                  <>
                    <div
                      className="h-full bg-[#004e75]"
                      style={{ width: `${Math.max(2, (hardwareSummary.hq / hardwareSummary.total) * 100)}%` }}
                      title={`HQ Stock: ${fmtNum(hardwareSummary.hq)}`}
                    />
                    <div
                      className="h-full bg-sky-500"
                      style={{ width: `${Math.max(2, (hardwareSummary.reserve / hardwareSummary.total) * 100)}%` }}
                      title={`Branch Reserve: ${fmtNum(hardwareSummary.reserve)}`}
                    />
                    {hardwareSummary.installed > 0 && (
                      <div
                        className="h-full bg-emerald-500"
                        style={{ width: `${Math.max(2, (hardwareSummary.installed / hardwareSummary.total) * 100)}%` }}
                        title={`Installed Live: ${fmtNum(hardwareSummary.installed)}`}
                      />
                    )}
                  </>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                <span>HQ: <strong className="font-figure text-slate-700">{fmtNum(hardwareSummary.hq)}</strong></span>
                <span>Reserve: <strong className="font-figure text-slate-700">{fmtNum(hardwareSummary.reserve)}</strong></span>
                <span>Config: <strong className="font-figure text-slate-700">{fmtNum(hardwareSummary.config)}</strong></span>
                <span>Live: <strong className="font-figure text-emerald-700">{fmtNum(hardwareSummary.installed)}</strong></span>
              </div>
            </div>

            {/* Row 2: SIM Cards */}
            <button
              type="button"
              onClick={() => onNavigateTab?.('sim_cards')}
              className="w-full text-left py-3 hover:bg-slate-50/70 -mx-2 px-2 rounded-xl transition cursor-pointer"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-900 flex items-center gap-1.5">
                  <Smartphone className="w-3.5 h-3.5 text-teal-600" aria-hidden="true" />
                  SIM Card Control Hub
                </span>
                <span className="font-figure font-extrabold text-slate-900">
                  {fmtNum(materialsSummary.simTotal)} tracked
                </span>
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                {fmtNum(materialsSummary.simOnHand)} in stock · {fmtNum(materialsSummary.simInTransit)} in transit ·{' '}
                {fmtNum(materialsSummary.simAtMerchant)} at merchant
              </div>
            </button>

            {/* Row 3: Materials & Accessories */}
            <div className="py-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-900 flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5 text-[#4F518C]" aria-hidden="true" />
                  Kit Accessories &amp; Materials
                </span>
                <span className="font-figure font-extrabold text-slate-900">
                  {materialsSummary.activeTypesCount} catalog types
                </span>
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                Battery, AC Adaptors, Stands, Docks ·{' '}
                <strong className="font-figure text-slate-700">{fmtNum(materialsSummary.kitOnHand)}</strong> on hand ·{' '}
                <strong className="font-figure text-slate-700">{fmtNum(materialsSummary.kitInTransit)}</strong> in transit
              </div>
            </div>

            {/* Row 4: POS Battery SLA */}
            <div className="py-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-900 flex items-center gap-1.5">
                  <BatteryCharging className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                  POS Battery Health ({batteryLifespanMonths}M SLA)
                </span>
                <span className="text-[11px] font-mono text-slate-500">
                  {fmtNum(batterySummary.total)} dated
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center pt-0.5">
                <div className="rounded-lg bg-emerald-50/70 border border-emerald-200/70 px-2 py-1.5">
                  <div className="text-xs font-black font-figure text-emerald-700">{fmtNum(batterySummary.healthy)}</div>
                  <div className="text-[10px] font-semibold text-slate-600">Healthy (&lt;{batteryWarningMonths}M)</div>
                </div>
                <div className="rounded-lg bg-amber-50/70 border border-amber-200/70 px-2 py-1.5">
                  <div className="text-xs font-black font-figure text-amber-700">{fmtNum(batterySummary.replaceSoon)}</div>
                  <div className="text-[10px] font-semibold text-slate-600">Due Soon</div>
                </div>
                <div className="rounded-lg bg-rose-50/70 border border-rose-200/70 px-2 py-1.5">
                  <div className="text-xs font-black font-figure text-rose-700">{fmtNum(batterySummary.critical)}</div>
                  <div className="text-[10px] font-semibold text-slate-600">Replace (≥{batteryLifespanMonths}M)</div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ───────────── 5. BOTTOM SPLIT: TOP ACTIVE BRANCHES MATRIX + STOCK REQUESTS / RECENT SERIALS ───────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left 7 Cols: Top Active Branches Across All Channels */}
        <section className="lg:col-span-7 surface-card overflow-hidden flex flex-col">
          <div className="sb-card-header-light px-5 py-3.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-[#003857]" aria-hidden="true" />
              <div>
                <h3 className="text-sm sm:text-[15px] font-extrabold text-slate-900">
                  Top Active Branches (All Channels)
                </h3>
                <p className="text-xs text-slate-500">
                  {activePeriodLabel} cross-channel volume alongside current branch hardware reserve
                </p>
              </div>
            </div>
            {onNavigateTab && (
              <button
                type="button"
                onClick={() => onNavigateTab('branches')}
                className="text-xs font-bold text-[#004e75] hover:underline inline-flex items-center gap-1 shrink-0 cursor-pointer"
              >
                All Branches <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 text-[11px] uppercase">
                  <th className="py-2.5 pl-5 pr-2 font-bold">No.</th>
                  <SortTh k="name" sort={brSort} onSort={brToggle} className="py-2.5 px-2 font-bold">Branch</SortTh>
                  <SortTh k="khqr" sort={brSort} onSort={brToggle} align="right" className="py-2.5 px-2 font-bold">KHQR</SortTh>
                  <SortTh k="pos" sort={brSort} onSort={brToggle} align="right" className="py-2.5 px-2 font-bold">POS</SortTh>
                  <SortTh k="sb" sort={brSort} onSort={brToggle} align="right" className="py-2.5 px-2 font-bold">SB</SortTh>
                  <SortTh k="mv" sort={brSort} onSort={brToggle} align="right" className="py-2.5 px-2 font-bold">MV</SortTh>
                  <SortTh k="cc" sort={brSort} onSort={brToggle} align="right" className="py-2.5 px-2 font-bold">CC</SortTh>
                  <SortTh k="reserve" sort={brSort} onSort={brToggle} align="right" className="py-2.5 px-2 font-bold">Reserve</SortTh>
                  <SortTh k="total" sort={brSort} onSort={brToggle} align="right" className="py-2.5 pl-2 pr-5 font-bold">Tasks</SortTh>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedBranches.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-400">
                      No branch activity found for the selected scope.
                    </td>
                  </tr>
                ) : (
                  sortedBranches.map((b, i) => (
                    <tr key={b.code} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2.5 pl-5 pr-2 font-mono text-slate-400">{i + 1}</td>
                      <td className="py-2.5 px-2">
                        <div className="font-bold text-slate-900 truncate max-w-[175px]">{b.name}</div>
                        <div className="text-[10.5px] font-mono text-slate-400">Code {b.code}</div>
                      </td>
                      <td className="py-2.5 px-2 text-right font-figure text-emerald-700 font-semibold">{fmtNum(b.khqr)}</td>
                      <td className="py-2.5 px-2 text-right font-figure text-[#004e75] font-semibold">{fmtNum(b.pos)}</td>
                      <td className="py-2.5 px-2 text-right font-figure text-[#4F518C] font-semibold">{fmtNum(b.sb)}</td>
                      <td className="py-2.5 px-2 text-right font-figure text-sky-700 font-semibold">{fmtNum(b.mv)}</td>
                      <td className="py-2.5 px-2 text-right font-figure text-amber-700 font-semibold">{fmtNum(b.cc)}</td>
                      <td className="py-2.5 px-2 text-right font-figure text-slate-500">{fmtNum(b.reserve)}</td>
                      <td className="py-2.5 pl-2 pr-5 text-right font-figure font-extrabold text-slate-900">
                        {fmtNum(b.totalTasks)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Right 5 Cols: Latest Stock Requests & Recently Updated Serials */}
        <section className="lg:col-span-5 surface-card overflow-hidden flex flex-col">
          <div className="sb-card-header-light px-5 py-3.5 flex items-center justify-between gap-2">
            <div
              className="inline-flex items-center p-0.5 rounded-lg bg-white border border-slate-200/90 text-xs"
              role="tablist"
              aria-label="Recent Requests or Serials"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activityPanel === 'REQUISITIONS'}
                onClick={() => setActivityPanel('REQUISITIONS')}
                className={`px-2.5 py-1 rounded-md font-bold cursor-pointer transition inline-flex items-center gap-1.5 ${
                  activityPanel === 'REQUISITIONS'
                    ? 'bg-[#003857] text-white'
                    : 'text-slate-600 hover:text-slate-900'
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
                className={`px-2.5 py-1 rounded-md font-bold cursor-pointer transition inline-flex items-center gap-1.5 ${
                  activityPanel === 'SERIALS'
                    ? 'bg-[#003857] text-white'
                    : 'text-slate-600 hover:text-slate-900'
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
                className="text-xs font-bold text-[#004e75] hover:underline inline-flex items-center gap-1 shrink-0 cursor-pointer"
              >
                View All <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="p-4 space-y-2.5 flex-1">
            {activityPanel === 'REQUISITIONS' ? (
              requisitions.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-400">
                  No stock requisitions submitted yet.
                </div>
              ) : (
                requisitions.slice(0, 5).map((req) => (
                  <button
                    key={req.reqId}
                    type="button"
                    onClick={() => onNavigateTab?.('requisitions')}
                    className="w-full text-left p-3 rounded-xl border border-slate-200/80 bg-slate-50/60 hover:bg-white hover:border-slate-300 transition flex items-start justify-between gap-3 cursor-pointer"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="font-mono font-extrabold text-slate-900">{req.reqId}</span>
                        <span className="text-slate-300">·</span>
                        <span className="font-semibold text-slate-700 truncate">
                          {req.branchName} ({req.branchId})
                        </span>
                      </div>
                      <div className="text-xs font-semibold text-slate-800 mt-0.5">
                        {req.posQty}x POS · {req.sbQty}x Sound Box
                      </div>
                      {req.reason && (
                        <div className="text-[11px] text-slate-500 truncate mt-0.5">{req.reason}</div>
                      )}
                    </div>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded border shrink-0 ${
                        req.status === 'RECEIVED'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : req.status === 'REJECTED'
                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : req.status === 'PENDING_ADMIN'
                          ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : 'bg-slate-100 text-slate-700 border-slate-300'
                      }`}
                    >
                      {req.status}
                    </span>
                  </button>
                ))
              )
            ) : recentDevices.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-400">
                No hardware serial updates recorded yet.
              </div>
            ) : (
              recentDevices.map((dev) => {
                const meta = STAGE_META[dev.stage];
                const cycleCount = (dev.history || []).length;
                return (
                  <button
                    key={dev.serial}
                    type="button"
                    onClick={() => onSelectDevice(dev.serial)}
                    aria-label={`Open serial ${dev.serial}`}
                    className="w-full text-left p-2.5 rounded-xl border border-slate-200/80 bg-slate-50/60 hover:bg-white hover:border-slate-300 flex items-center justify-between gap-3 transition cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                        {dev.type === 'POS Terminal' ? (
                          <Cpu className="w-4 h-4 text-[#004e75]" aria-hidden="true" />
                        ) : (
                          <Volume2 className="w-4 h-4 text-[#4F518C]" aria-hidden="true" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="font-mono font-bold text-slate-900">{dev.serial}</span>
                          <span className="text-slate-300">·</span>
                          <span className="font-mono text-[11px] text-slate-600">Code {dev.branchId}</span>
                          <span className="text-slate-300">·</span>
                          <span className="text-[11px] text-slate-500">{cycleCount} events</span>
                        </div>
                        <div className="text-[11px] text-slate-500 truncate mt-0.5">
                          {dev.merchantName
                            ? `${dev.merchantName}${dev.mid ? ` (${dev.mid})` : ''}`
                            : dev.model}
                        </div>
                      </div>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded border shrink-0 ${meta?.badgeClassLight || ''}`}>
                      {meta?.short || dev.stage}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

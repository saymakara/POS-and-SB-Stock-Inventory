import React, { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, useTransition } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { buildAnnularArcPath } from './Charts';
import {
  Trophy, BarChart3, Building2, Users, Calendar, Layers, Award, Search, RefreshCw, Loader2,
  ChevronDown, ChevronLeft, ChevronRight, Cpu, Volume2, QrCode, CreditCard, TrendingUp, TrendingDown, Target,
  Sun, CheckSquare, Diamond, X, ArrowUpDown, ArrowUp, ArrowDown, ShieldCheck,
  ClipboardList, List, MapPin,
} from 'lucide-react';
import {
  Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid, ComposedChart, ReferenceArea,
} from 'recharts';
import { Branch, User, UserRole } from '../types';
import { Pager } from './Pager';
import { usePager } from '../utils/usePager';
import { ClearFiltersButton } from './ClearFiltersButton';
import { ExportCsvButton } from './ExportCsvButton';
import { downloadCsv } from '../utils/exportCsv';
import { getManagementExemptSet, isStaffManagementExempt, KPI_MANAGEMENT_EXEMPT_EVENT } from '../utils/kpiManagementUtils';
import { getCachedStaff, loadStaff, onStaffList } from '../services/staffCache';
import type { StaffAccount } from '../services/supabaseService';
import { normalizeStaffName } from '../utils/staffUtils';
import { isPhnomPenhBranch } from '../utils/fieldScope';
import {
  KpiCategory, KpiPeriod, KPI_PERIOD_LABEL, kpiPeriodRange, KpiPointRule, KpiDashboardData,
  KpiRawCounts, computeKpiPoints, addExtraCounts, rulePts, fetchKpiSummary, getCachedKpiSummary,
  KpiDailyBranchRaw, KpiDailyStaffRaw, KpiTimeBucketRaw,
} from '../services/kpiService';
import { getCambodiaHoliday, getMonthWorkDaysSummary, isWeekendDay } from '../utils/cambodiaHolidays';
import { todayPP } from '../utils/time';
import { SPRING_TAB_PILL, SHARED_LAYOUT_IDS, ACCORDION_EXPAND_VARIANTS } from '../utils/animationRules';
import {
  PillMotion,
  CAPSULE_TRACK_CLS,
  CAPSULE_TRACK_COMPACT_CLS,
  CAPSULE_PILL_CLS,
  CAPSULE_BTN_ACTIVE_CLS,
  CAPSULE_BTN_NAVY_ACTIVE_CLS,
  CAPSULE_BTN_INACTIVE_CLS,
  CAPSULE_COUNT_ACTIVE_CLS,
  CAPSULE_COUNT_INACTIVE_CLS,
} from './PillMotion';
import { AfterPaint } from './AfterPaint';
import { MeasuredChart } from './MeasuredChart';
import { onPortalSync, createRefreshScheduler } from '../utils/portalSync';

const SPRING = { type: 'spring', stiffness: 500, damping: 32, mass: 0.55 } as const;

type KpiView = 'all' | 'branches' | 'staff' | 'timeline' | 'top10';
type Granularity = 'daily' | 'weekly' | 'monthly' | 'quarterly';
type KpiRating = 'Outstanding' | 'Meet Target' | 'Near/Below Target' | 'Needs Improvement' | 'Management (Exempt)';

function getKpiRating(pct: number, isManagement = false): KpiRating {
  if (isManagement) return 'Management (Exempt)';
  if (pct >= 120) return 'Outstanding';
  if (pct >= 100) return 'Meet Target';
  if (pct >= 70) return 'Near/Below Target';
  return 'Needs Improvement';
}

const KPI_BRANCH_GRID =
  'grid items-center gap-x-1.5 grid-cols-[24px_minmax(130px,1.08fr)_minmax(40px,0.32fr)_minmax(88px,0.74fr)_minmax(84px,0.70fr)_minmax(80px,0.68fr)_minmax(88px,0.74fr)_minmax(96px,0.80fr)_minmax(72px,0.62fr)_minmax(48px,0.38fr)_minmax(92px,0.72fr)_minmax(84px,0.74fr)_minmax(114px,0.78fr)_14px]';

const KPI_STAFF_GRID =
  'grid items-center gap-x-1.5 grid-cols-[24px_minmax(130px,1.08fr)_minmax(122px,1.0fr)_minmax(90px,0.76fr)_minmax(86px,0.72fr)_minmax(82px,0.70fr)_minmax(90px,0.76fr)_minmax(98px,0.82fr)_minmax(48px,0.38fr)_minmax(92px,0.74fr)_minmax(86px,0.74fr)_minmax(114px,0.78fr)_14px]';

// Balanced proportional column widths for Top 10 Leaderboard tables (100% total prevents oversized text-column voids)
const TOP10_STAFF_COL_WIDTHS = [
  '2.5%', '10.5%', '4.8%', '12.8%', '6.4%',
  '8.6%', '8.0%', '7.6%', '8.4%', '8.9%',
  '7.2%', '7.0%', '7.3%',
] as const;

const TOP10_BRANCH_COL_WIDTHS = [
  '2.5%', '12.8%', '6.6%', '6.4%',
  '8.6%', '8.0%', '7.6%', '8.4%', '8.9%',
  '7.6%', '8.2%', '7.0%', '7.4%',
] as const;

const CAT_COLORS: Record<KpiCategory, { hex: string; badge: string; bar: string; dot: string; Icon: React.ElementType }> = {
  'POS Terminal': { hex: '#184e77', badge: 'bg-[#184e77]/10 text-[#184e77] border-[#184e77]/20 font-semibold', bar: 'bg-[#184e77]', dot: 'bg-[#184e77]', Icon: Cpu },
  'Sound Box': { hex: '#4F518C', badge: 'bg-[#4F518C]/10 text-[#4F518C] border-[#4F518C]/20', bar: 'bg-[#4F518C]', dot: 'bg-[#4F518C]', Icon: Volume2 },
  KHQR: { hex: '#1e6091', badge: 'bg-[#1e6091]/10 text-[#1e6091] border-[#1e6091]/20', bar: 'bg-[#1e6091]', dot: 'bg-[#1e6091]', Icon: QrCode },
  'Credit Card': { hex: '#f59e0b', badge: 'bg-amber-50 text-amber-700 border-amber-200/90', bar: 'bg-[#f59e0b]', dot: 'bg-[#f59e0b]', Icon: CreditCard },
  'Merchant Visit': { hex: '#2d6a4f', badge: 'bg-[#2d6a4f]/10 text-[#2d6a4f] border-[#2d6a4f]/20 font-semibold', bar: 'bg-[#2d6a4f]', dot: 'bg-[#2d6a4f]', Icon: ClipboardList },
  Other: { hex: '#64748b', badge: 'bg-slate-50 text-slate-600 border-slate-200', bar: 'bg-slate-500', dot: 'bg-slate-500', Icon: Layers },
};

const isPointsOnlyBonusRule = (code: string): boolean =>
  code === 'KHQR_PRINT_LAMINATE' || code === 'KHQR_MATERIAL';

const subCatTaskVolume = (sc: { code: string; count: number }): number =>
  isPointsOnlyBonusRule(sc.code) ? 0 : sc.count;

const formatSubCatSharePct = (v: number): string =>
  v >= 1 ? `${Math.round(v)}%` : v > 0 ? `${v.toFixed(1)}%` : '0%';

const STAFF_LOCATION_KEY = 'staff_locations_map_v1';

function loadLocationOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STAFF_LOCATION_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

interface PpDirMember {
  empId: string;
  name: string;
  branchId: string;
  position: string;
  role: string;
  isManagement: boolean;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return `${MONTH_NAMES[m - 1] || m} ${y}`;
}
function monthShortParts(ym: string): { shortMonth: string; year: string } {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return { shortMonth: ym, year: '' };
  return { shortMonth: MONTH_NAMES[m - 1] || String(m), year: String(y) };
}
function emptyRawCounts(): KpiRawCounts {
  return {
    posInstall: 0, posReplace: 0, posBattery: 0,
    sbInstall: 0, sbReplace: 0, sbMaint: 0, sbReturn: 0,
    khqrInstall: 0, khqrReplace: 0, khqrMaterials: 0,
    ccPrimary: 0, ccSupp: 0,
    adjPts: 0,
  };
}
function accumulateRawCounts(acc: KpiRawCounts, src: KpiRawCounts): void {
  acc.posInstall += src.posInstall || 0;
  acc.posReplace += src.posReplace || 0;
  acc.posBattery += src.posBattery || 0;
  acc.sbInstall += src.sbInstall || 0;
  acc.sbReplace += src.sbReplace || 0;
  acc.sbMaint += src.sbMaint || 0;
  acc.sbReturn += src.sbReturn || 0;
  acc.khqrInstall += src.khqrInstall || 0;
  acc.khqrReplace += src.khqrReplace || 0;
  acc.khqrMaterials += src.khqrMaterials || 0;
  acc.ccPrimary += src.ccPrimary || 0;
  acc.ccSupp += src.ccSupp || 0;
  acc.adjPts = (acc.adjPts || 0) + (src.adjPts || 0);
  addExtraCounts(acc, src);
}
function pickCategoryKpiVal(
  pts: ReturnType<typeof computeKpiPoints>,
  cat: 'ALL' | KpiCategory,
  isTask: boolean
): number {
  switch (cat) {
    case 'POS Terminal': return isTask ? pts.posTasks : pts.posPoints;
    case 'Sound Box': return isTask ? pts.sbTasks : pts.sbPoints;
    case 'KHQR': return isTask ? pts.khqrTasks : pts.khqrPoints;
    case 'Credit Card': return isTask ? pts.ccTasks : pts.ccPoints;
    case 'Merchant Visit': return isTask ? pts.mvTasks : pts.mvPoints;
    default: return isTask ? pts.totalTasks : pts.totalPoints;
  }
}
function fmtShortDate(ymd: string): string {
  const parts = ymd.split('-');
  if (parts.length !== 3) return ymd;
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!m || !d) return ymd;
  return `${MONTH_NAMES[m - 1] || parts[1]} ${String(d).padStart(2, '0')}`;
}

const NF_PTS = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 });   // reused (same text as toLocaleString)
const fmtPts = (n: number) => NF_PTS.format(n);
const NF_INT = new Intl.NumberFormat('en-US');
const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short' });
const fmtInt = (n: number) => NF_INT.format(n);

function cleanBranchName(name: string, _stripSuffix = false): string {
  const base = (name || '')
    .replace(/^Code\s+\d+\s*[·-]\s*|^\d{3}\s*[-·]\s*/i, '')
    .trim();
  if (!base || base.toLowerCase() === 'unassigned') return 'Unassigned';
  if (/^Branch\s+\d+/i.test(base) || /\bbranch$/i.test(base)) {
    return base;
  }
  return `${base} Branch`;
}

function fmtBranchLabel(branchId: string, branchName: string, _short = false): string {
  const clean = cleanBranchName(branchName);
  if (!branchId || branchId === 'UNASSIGNED') return clean;
  if (clean.endsWith(`(${branchId})`)) return clean;
  return `${clean} (${branchId})`;
}

function fmtBranchCode(id?: string | null): string {
  if (!id || id === 'UNASSIGNED' || id.toLowerCase() === 'unassigned') return '—';
  return id;
}

/**
 * Ensures that daily time-series data always contains every calendar date
 * in the requested period (or up to today), populating zero-activity placeholder
 * buckets so dates without data are never omitted from graphs and tables.
 */
function buildDailyContiguousSeries(
  rawDaily: KpiTimeBucketRaw[] | undefined,
  period: KpiPeriod,
  range: { from: string | null; to: string | null }
): KpiTimeBucketRaw[] {
  const today = todayPP(); // 'YYYY-MM-DD'
  const map = new Map<string, KpiTimeBucketRaw>();
  let minRecorded: string | null = null;
  let maxRecorded: string | null = null;

  for (const row of rawDaily || []) {
    if (row && row.period) {
      map.set(row.period, row);
      if (!minRecorded || row.period < minRecorded) minRecorded = row.period;
      if (!maxRecorded || row.period > maxRecorded) maxRecorded = row.period;
    }
  }

  // Determine start date
  let startIso: string;
  if (range.from) {
    startIso = range.from.split('T')[0];
  } else if (minRecorded) {
    startIso = minRecorded;
  } else {
    // Fallback: 29 days before today
    const [y, m, d] = today.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - 29);
    startIso = dt.toISOString().split('T')[0];
  }

  // Determine end date
  let endIso: string;
  if (range.to) {
    // range.to is an exclusive boundary; subtract 1 day
    const toDate = new Date(range.to);
    toDate.setUTCDate(toDate.getUTCDate() - 1);
    endIso = toDate.toISOString().split('T')[0];
  } else if (period === 'WEEK') {
    // Show entire week Monday through Sunday
    const [sy, sm, sd] = startIso.split('-').map(Number);
    const dt = new Date(Date.UTC(sy, sm - 1, sd));
    dt.setUTCDate(dt.getUTCDate() + 6);
    endIso = dt.toISOString().split('T')[0];
  } else {
    // Upper bound is at least today (or latest recorded date if in the future)
    endIso = maxRecorded && maxRecorded > today ? maxRecorded : today;
  }

  // Safety check: ensure startIso <= endIso
  if (startIso > endIso) {
    startIso = endIso;
  }

  // Generate contiguous dates from startIso to endIso
  const result: KpiTimeBucketRaw[] = [];
  const [sy, sm, sd] = startIso.split('-').map(Number);
  const cur = new Date(Date.UTC(sy, sm - 1, sd));

  while (true) {
    const curIso = cur.toISOString().split('T')[0];
    const existing = map.get(curIso);
    if (existing) {
      result.push(existing);
    } else {
      result.push({
        period: curIso,
        activeBranches: 0,
        activeStaff: 0,
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
      });
    }

    if (curIso >= endIso) break;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  // Return descending (newest first) to maintain compatibility with data.daily
  return result.reverse();
}

type KpiMetricMode = 'points' | 'tasks';

function remapMetricSortKey(key: string, next: KpiMetricMode, allowStaffPerRatio: boolean): string {
  if (next === 'tasks') {
    if (key === 'totalPoints') return 'totalTasks';
    if (key.endsWith('Points')) return key.replace(/Points$/, 'Tasks');
    if (allowStaffPerRatio && key === 'ptsPerStaff') return 'tasksPerStaff';
    return key;
  }
  if (key === 'totalTasks') return 'totalPoints';
  if (key.endsWith('Tasks')) return key.replace(/Tasks$/, 'Points');
  if (allowStaffPerRatio && key === 'tasksPerStaff') return 'ptsPerStaff';
  return key;
}

interface KpiTargetComparisonDonutProps {
  periodLabel: string;
  targetLabel: string;
  actualPoints: number;
  targetPoints: number;
  showPacing: boolean;
  pacingRatio: number;
  elapsedWorkDays: number;
  totalWorkDays: number;
}

const KT_VB_W = 568;
const KT_VB_H = 342;
const KT_CX = 284;
const KT_CY = 171;
const KT_R_INNER = 88;
const KT_R_OUTER = 104;
const KT_R_TRACK = (KT_R_INNER + KT_R_OUTER) / 2;
const KT_TRACK_W = KT_R_OUTER - KT_R_INNER;
const KT_R_TICK = KT_R_OUTER + 5;

const KpiTargetComparisonDonut = React.memo<KpiTargetComparisonDonutProps>(({
  periodLabel,
  targetLabel,
  actualPoints,
  targetPoints,
  showPacing,
  pacingRatio,
  elapsedWorkDays,
  totalWorkDays,
}) => {
  const [hoveredKey, setHoveredKey] = useState<'actual' | 'remaining' | 'pace' | 'target' | null>(null);
  const shadowFilterId = useId();
  const safeTarget = Math.max(0, targetPoints);
  const safeActual = Math.max(0, actualPoints);
  const gapPts = Math.max(0, safeTarget - safeActual);
  const surplusPts = Math.max(0, safeActual - safeTarget);
  const isMet = safeTarget > 0 && safeActual >= safeTarget;
  const achievementPct = safeTarget > 0 ? Math.min(999, Math.round((safeActual / safeTarget) * 1000) / 10) : 0;
  const gapPct = safeTarget > 0 ? Math.max(0, Math.round((gapPts / safeTarget) * 1000) / 10) : 0;

  const effectivePaceRatio = showPacing ? Math.min(1, Math.max(0.01, pacingRatio)) : 1;
  const expectedPacePct = Math.round(effectivePaceRatio * 1000) / 10;
  const expectedPacePts = Math.round(safeTarget * effectivePaceRatio * 10) / 10;
  const isAheadOfPace = safeTarget > 0 && safeActual >= expectedPacePts;

  const actualColor = isMet ? '#2d6a4f' : '#155484';
  const paceColor = isMet ? '#10b981' : isAheadOfPace ? '#0284c7' : '#f59e0b';
  const remainingColor = '#94a3b8';
  const actualFrac = safeTarget > 0 ? Math.min(1, safeActual / safeTarget) : 0;
  const paceFrac = showPacing ? Math.min(1, Math.max(0.01, effectivePaceRatio)) : 1;

  interface DonutSlice {
    key: 'actual' | 'pace' | 'remaining';
    f0: number;
    f1: number;
    color: string;
    title: string;
  }

  const ringSlices: DonutSlice[] = (() => {
    if (safeTarget <= 0 || actualFrac <= 0.002) {
      if (showPacing && paceFrac < 0.998) {
        return [
          {
            key: 'pace',
            f0: 0,
            f1: paceFrac,
            color: paceColor,
            title: `Expected Pace (Day ${elapsedWorkDays}/${totalWorkDays}): ${expectedPacePct}% (${fmtPts(expectedPacePts)} pts)`,
          },
          {
            key: 'remaining',
            f0: paceFrac,
            f1: 1,
            color: '#cbd5e1',
            title: `Remaining to Target: ${fmtPts(gapPts)} / ${fmtPts(safeTarget)} pts (${gapPct}% left)`,
          },
        ];
      }
      return [
        {
          key: 'remaining',
          f0: 0,
          f1: 1,
          color: '#cbd5e1',
          title: `Remaining to Target: ${fmtPts(gapPts)} / ${fmtPts(safeTarget)} pts`,
        },
      ];
    }

    if (isMet || actualFrac >= 0.998) {
      return [
        {
          key: 'actual',
          f0: 0,
          f1: 1,
          color: actualColor,
          title: `Actual Achievement: ${fmtPts(safeActual)} pts (${achievementPct}% of ${fmtPts(safeTarget)} target)`,
        },
      ];
    }

    const out: DonutSlice[] = [];
    if (showPacing && actualFrac < paceFrac - 0.004) {
      // Behind pace: Actual (navy) | Pace Gap (amber) | Remaining Beyond Pace (cool slate)
      out.push({
        key: 'actual',
        f0: 0,
        f1: actualFrac,
        color: actualColor,
        title: `Actual Achievement: ${fmtPts(safeActual)} pts (${achievementPct}% of ${fmtPts(safeTarget)} target)`,
      });
      out.push({
        key: 'pace',
        f0: actualFrac,
        f1: paceFrac,
        color: paceColor,
        title: `Pace Gap to Day ${elapsedWorkDays}/${totalWorkDays}: ${fmtPts(Math.max(0, expectedPacePts - safeActual))} pts (${expectedPacePct}% expected)`,
      });
      if (1 - paceFrac > 0.004) {
        out.push({
          key: 'remaining',
          f0: paceFrac,
          f1: 1,
          color: '#cbd5e1',
          title: `Remaining Beyond Pace: ${fmtPts(gapPts)} / ${fmtPts(safeTarget)} pts (${gapPct}% total left)`,
        });
      }
    } else if (showPacing && actualFrac > paceFrac + 0.004) {
      // Ahead of pace: Baseline up to Pace (navy) | Ahead-of-Pace Lead (sky) | Remaining (slate)
      out.push({
        key: 'actual',
        f0: 0,
        f1: paceFrac,
        color: actualColor,
        title: `Actual Achievement: ${fmtPts(safeActual)} pts (${achievementPct}% of ${fmtPts(safeTarget)} target)`,
      });
      out.push({
        key: 'pace',
        f0: paceFrac,
        f1: actualFrac,
        color: paceColor,
        title: `Ahead of Day ${elapsedWorkDays}/${totalWorkDays} Pace (+${fmtPts(safeActual - expectedPacePts)} pts vs ${expectedPacePct}%)`,
      });
      out.push({
        key: 'remaining',
        f0: actualFrac,
        f1: 1,
        color: '#cbd5e1',
        title: `Remaining to Target: ${fmtPts(gapPts)} / ${fmtPts(safeTarget)} pts (${gapPct}% left)`,
      });
    } else {
      out.push({
        key: 'actual',
        f0: 0,
        f1: actualFrac,
        color: actualColor,
        title: `Actual Achievement: ${fmtPts(safeActual)} pts (${achievementPct}% of ${fmtPts(safeTarget)} target)`,
      });
      out.push({
        key: 'remaining',
        f0: actualFrac,
        f1: 1,
        color: '#cbd5e1',
        title: `Remaining to Target: ${fmtPts(gapPts)} / ${fmtPts(safeTarget)} pts (${gapPct}% left)`,
      });
    }
    return out;
  })();

  const targetTitle = targetLabel === 'Monthly target' ? 'Monthly Target' : targetLabel;

  interface KpiCalloutSpec {
    key: 'actual' | 'pace' | 'remaining';
    rowKey: 'actual' | 'pace' | 'target';
    label: string;
    pctText: string;
    subText: string;
    color: string;
    pctColor: string;
    midFrac: number;
  }

  const calloutSpecs: KpiCalloutSpec[] = (() => {
    const sliceMid = (k: 'actual' | 'pace' | 'remaining', fallbackFrac: number) => {
      const s = ringSlices.find((sl) => sl.key === k);
      return s ? (s.f0 + s.f1) / 2 : fallbackFrac;
    };
    return [
      {
        key: 'actual',
        rowKey: 'actual',
        label: 'Actual',
        pctText: `${achievementPct}%`,
        subText: `${fmtPts(safeActual)} pts`,
        color: actualColor,
        pctColor: isMet ? '#047857' : '#1e6091',
        midFrac: isMet ? 0.25 : sliceMid('actual', Math.max(0.08, actualFrac / 2)),
      },
      {
        key: 'pace',
        rowKey: 'pace',
        label: showPacing ? `Pace (Day ${elapsedWorkDays}/${totalWorkDays})` : 'Target Pace',
        pctText: `${expectedPacePct}%`,
        subText: `${fmtPts(expectedPacePts)} pts`,
        color: paceColor,
        pctColor: isMet ? '#047857' : isAheadOfPace ? '#0284c7' : '#b45309',
        midFrac: sliceMid('pace', Math.min(0.92, effectivePaceRatio)),
      },
      {
        key: 'remaining',
        rowKey: 'target',
        label: isMet ? 'Surplus' : 'Remaining',
        pctText: isMet ? `+${fmtPts(surplusPts)}` : `${gapPct}%`,
        subText: isMet ? 'above target' : `${fmtPts(gapPts)} left`,
        color: isMet ? '#10b981' : remainingColor,
        pctColor: isMet ? '#047857' : '#475569',
        midFrac: isMet ? 0.85 : sliceMid('remaining', 0.9),
      },
    ];
  })();

  const calloutLayouts = (() => {
    const items = calloutSpecs.map((spec) => {
      const midAngle = -Math.PI / 2 + spec.midFrac * Math.PI * 2;
      const sx = KT_CX + KT_R_TICK * Math.cos(midAngle);
      const sy = KT_CY + KT_R_TICK * Math.sin(midAngle);
      const side: 'left' | 'right' = Math.cos(midAngle) >= 0 ? 'right' : 'left';
      const targetY = KT_CY + (KT_R_OUTER + 28) * Math.sin(midAngle);
      return { spec, sx, sy, side, targetY };
    });

    const CALLOUT_H = 42;
    const MIN_GAP = 56;
    const Y_MIN = 30;
    const Y_MAX = KT_VB_H - 30;

    const placeSide = (side: 'left' | 'right') => {
      const group = items
        .filter((it) => it.side === side)
        .sort((a, b) => a.targetY - b.targetY);
      if (!group.length) return [];

      const ys = group.map((g) => Math.max(Y_MIN, Math.min(Y_MAX, g.targetY)));
      for (let i = 1; i < ys.length; i++) {
        if (ys[i] - ys[i - 1] < MIN_GAP) ys[i] = ys[i - 1] + MIN_GAP;
      }
      if (ys[ys.length - 1] > Y_MAX) {
        ys[ys.length - 1] = Y_MAX;
        for (let i = ys.length - 2; i >= 0; i--) {
          if (ys[i + 1] - ys[i] < MIN_GAP) ys[i] = ys[i + 1] - MIN_GAP;
        }
      }
      for (let i = 0; i < ys.length; i++) {
        ys[i] = Math.max(Y_MIN, Math.min(Y_MAX, ys[i]));
      }

      return group.map((g, i) => {
        const ey = ys[i];
        const dyNearest =
          ey + CALLOUT_H / 2 < KT_CY
            ? KT_CY - (ey + CALLOUT_H / 2)
            : ey - CALLOUT_H / 2 > KT_CY
              ? ey - CALLOUT_H / 2 - KT_CY
              : 0;
        const minRingR = KT_R_TICK + 4;
        const clearDx =
          dyNearest >= minRingR
            ? 32
            : Math.sqrt(Math.max(0, minRingR * minRingR - dyNearest * dyNearest));
        const rawEx =
          side === 'left'
            ? Math.min(g.sx - 24, KT_CX - clearDx - 20)
            : Math.max(g.sx + 28, KT_CX + clearDx + 24);
        const ex =
          side === 'left'
            ? Math.max(156, Math.min(KT_CX - 28, rawEx))
            : Math.min(KT_VB_W - 144, Math.max(KT_CX + 28, rawEx));
        const qpx =
          side === 'left'
            ? Math.min(g.sx - 6, ex + 10)
            : Math.max(g.sx + 6, ex - 10);
        return { ...g, qpx, qpy: ey, ex, ey };
      });
    };

    return [...placeSide('left'), ...placeSide('right')];
  })();

  const isTargetHovered = hoveredKey === 'remaining' || hoveredKey === 'target';
  const centerReadout = (() => {
    if (hoveredKey === 'actual') {
      return {
        pct: `${achievementPct}%`,
        top: 'ACTUAL',
        sub: `${fmtPts(safeActual)} pts`,
        dot: actualColor,
        pillCls: 'bg-slate-100/95 text-slate-700',
      };
    }
    if (hoveredKey === 'pace') {
      return {
        pct: `${expectedPacePct}%`,
        top: showPacing ? `PACE · DAY ${elapsedWorkDays}/${totalWorkDays}` : 'TARGET PACE',
        sub: `${fmtPts(expectedPacePts)} pts`,
        dot: paceColor,
        pillCls: isMet ? 'bg-emerald-50 text-emerald-700' : isAheadOfPace ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-800',
      };
    }
    if (isTargetHovered) {
      return {
        pct: isMet ? `+${fmtPts(surplusPts)}` : `${gapPct}%`,
        top: isMet ? 'SURPLUS' : 'REMAINING',
        sub: `${fmtPts(gapPts)} left`,
        dot: isMet ? '#10b981' : remainingColor,
        pillCls: 'bg-slate-100/95 text-slate-700',
      };
    }
    return {
      pct: fmtPts(safeTarget),
      top: targetTitle.toUpperCase(),
      sub: '',
      dot: actualColor,
      pillCls: '',
    };
  })();

  const centerPctSizeCls =
    centerReadout.pct.length >= 8
      ? 'text-[16px] @[340px]:text-[20px] @[440px]:text-[24px]'
      : centerReadout.pct.length >= 6
        ? 'text-[19px] @[340px]:text-[24px] @[440px]:text-[30px]'
        : 'text-[21px] @[340px]:text-[27px] @[440px]:text-[34px]';

  return (
    <div
      data-testid="kpi-target-donut-card"
      className="min-w-0 @container bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden flex flex-col justify-between"
    >
      <div className="px-4 sm:px-5 pt-4 pb-2 border-b border-slate-100">
        <div className="min-w-0 flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-slate-900 truncate">
            {targetTitle} vs Actual Achievement{' '}
            <span className="text-slate-400 font-normal">· {periodLabel}</span>
          </h3>
        </div>
        <p className="text-[11px] text-slate-500 truncate mt-0.5">
          Achievement &amp; pace share · Target <span className="font-figure font-semibold text-slate-700">{fmtPts(safeTarget)} pts</span>
        </p>
      </div>

      <div className="px-1 sm:px-1.5 pt-1 pb-2 flex-1 flex items-center justify-center">
        {/* Dashboard-Style Slim Donut + Curved Leaders + 3 Floating Pill Callouts */}
        <div
          className="relative w-full max-w-[568px] aspect-[568/342] flex items-center justify-center"
          onMouseLeave={() => setHoveredKey(null)}
        >
          <svg
            viewBox={`0 0 ${KT_VB_W} ${KT_VB_H}`}
            className="w-full h-full overflow-visible"
            role="img"
            aria-label={`${targetTitle} vs Actual Achievement Donut: ${achievementPct}% achieved (${fmtPts(safeActual)} of ${fmtPts(safeTarget)} points), Expected pace ${expectedPacePct}%`}
            data-testid="kpi-target-donut-svg"
            onMouseLeave={() => setHoveredKey(null)}
          >
            <defs>
              <filter id={shadowFilterId} x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#1e6091" floodOpacity="0.16" />
              </filter>
            </defs>

            {/* Recessed donut track */}
            <circle
              cx={KT_CX}
              cy={KT_CY}
              r={KT_R_TRACK}
              fill="none"
              stroke="rgba(15, 23, 42, 0.045)"
              strokeWidth={KT_TRACK_W}
            />

            {/* Sculpted separated annular sectors */}
            <g filter={`url(#${shadowFilterId})`}>
              {ringSlices.length === 1 ? (
                <circle
                  data-kpi-target-slice={ringSlices[0].key}
                  cx={KT_CX}
                  cy={KT_CY}
                  r={KT_R_TRACK}
                  fill="none"
                  stroke={ringSlices[0].color}
                  strokeWidth={hoveredKey === ringSlices[0].key ? KT_TRACK_W + 4 : KT_TRACK_W}
                  className="cursor-pointer transition-all duration-150"
                  onMouseEnter={() => setHoveredKey(ringSlices[0].key)}
                  onMouseLeave={() => setHoveredKey(null)}
                >
                  <title>{ringSlices[0].title}</title>
                </circle>
              ) : (
                ringSlices.map((sl) => {
                  const isActive = hoveredKey === sl.key || (hoveredKey === 'target' && sl.key === 'remaining');
                  const isDimmed = hoveredKey !== null && !isActive;
                  const spanRad = (sl.f1 - sl.f0) * Math.PI * 2;
                  const gapTrim = Math.min(0.036, spanRad * 0.22);
                  const startRad = -Math.PI / 2 + sl.f0 * Math.PI * 2 + gapTrim / 2;
                  const endRad = startRad + spanRad - gapTrim;
                  const rInner = isActive ? KT_R_INNER - 3 : KT_R_INNER;
                  const rOuter = isActive ? KT_R_OUTER + 4 : KT_R_OUTER;
                  const d = buildAnnularArcPath(KT_CX, KT_CY, rInner, rOuter, startRad, endRad);
                  return (
                    <path
                      key={sl.key}
                      data-kpi-target-slice={sl.key}
                      d={d}
                      fill={sl.key === 'remaining' && isActive ? '#94a3b8' : sl.color}
                      opacity={isDimmed ? 0.32 : 1}
                      style={{
                        filter: isActive ? `drop-shadow(0 4px 10px ${sl.color}55)` : undefined,
                        transition: 'opacity 150ms ease, filter 150ms ease',
                      }}
                      className="cursor-pointer"
                      onMouseEnter={() => setHoveredKey(sl.key)}
                      onMouseLeave={() => setHoveredKey(null)}
                    >
                      <title>{sl.title}</title>
                    </path>
                  );
                })
              )}
            </g>

            {/* Smooth curved Bezier leader lines anchored at slice rim */}
            {calloutLayouts.map((c) => {
              const isActive = hoveredKey === c.spec.key || (hoveredKey === 'target' && c.spec.key === 'remaining');
              const isDimmed = hoveredKey !== null && !isActive;
              return (
                <g
                  key={`leader-${c.spec.key}`}
                  opacity={isDimmed ? 0.24 : isActive ? 1 : 0.72}
                  style={{ transition: 'opacity 150ms ease' }}
                >
                  <path
                    d={`M ${c.sx.toFixed(1)} ${c.sy.toFixed(1)} Q ${c.qpx.toFixed(1)} ${c.qpy.toFixed(1)} ${c.ex.toFixed(1)} ${c.ey.toFixed(1)}`}
                    fill="none"
                    stroke={c.spec.color}
                    strokeWidth={isActive ? 1.85 : 1.35}
                    strokeLinecap="round"
                  />
                  <circle
                    cx={c.sx}
                    cy={c.sy}
                    r={isActive ? 3.2 : 2.5}
                    fill={c.spec.color}
                  />
                </g>
              );
            })}

            {/* Elevated central frosted hub ring */}
            <circle
              cx={KT_CX}
              cy={KT_CY}
              r={KT_R_INNER - 5}
              fill="#ffffff"
              stroke="rgba(15, 23, 42, 0.08)"
              strokeWidth="1"
              onMouseEnter={() => setHoveredKey(null)}
            />
          </svg>

          {/* Center Interactive Focus Readout */}
          <div
            className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center pointer-events-none text-center px-1.5"
            style={{
              left: `${(KT_CX / KT_VB_W) * 100}%`,
              top: `${(KT_CY / KT_VB_H) * 100}%`,
              width: `${(((KT_R_INNER - 5) * 1.8) / KT_VB_W) * 100}%`,
            }}
          >
            <span className="inline-flex items-center gap-1 text-[7px] @[360px]:text-[8px] @[430px]:text-[9px] font-bold tracking-wide uppercase text-slate-500 whitespace-nowrap">
              <i
                className="w-1.5 h-1.5 rounded-full inline-block shrink-0"
                style={{ backgroundColor: centerReadout.dot }}
              />
              {centerReadout.top}
            </span>
            <span
              className={`font-bold font-figure leading-none tracking-tight mt-1 tabular-nums text-slate-900 ${centerPctSizeCls}`}
            >
              {centerReadout.pct}
            </span>
            {centerReadout.sub && (
              <span
                className={`text-[8.5px] @[360px]:text-[9.5px] @[430px]:text-[10.5px] font-figure font-semibold px-2 @[430px]:px-2.5 py-0.5 rounded-full mt-1.5 @[430px]:mt-2 tabular-nums whitespace-nowrap ${centerReadout.pillCls}`}
              >
                {centerReadout.sub}
              </span>
            )}
          </div>

          {/* 3 Floating Pill Callout Badges */}
          {calloutLayouts.map((c) => {
            const isActive = hoveredKey === c.spec.key || (hoveredKey === 'target' && c.spec.key === 'remaining');
            const isDimmed = hoveredKey !== null && !isActive;
            const posStyle: React.CSSProperties =
              c.side === 'left'
                ? {
                    right: `${((KT_VB_W - c.ex) / KT_VB_W) * 100}%`,
                    top: `${(c.ey / KT_VB_H) * 100}%`,
                    transform: 'translateY(-50%)',
                  }
                : {
                    left: `${(c.ex / KT_VB_W) * 100}%`,
                    top: `${(c.ey / KT_VB_H) * 100}%`,
                    transform: 'translateY(-50%)',
                  };

            return (
              <button
                key={c.spec.key}
                type="button"
                data-kpi-comparison-row={c.spec.rowKey}
                data-donut-callout={c.spec.key}
                onMouseEnter={() => setHoveredKey(c.spec.key)}
                onMouseLeave={() => setHoveredKey(null)}
                onFocus={() => setHoveredKey(c.spec.key)}
                onBlur={() => setHoveredKey(null)}
                style={{
                  ...posStyle,
                  ...(isActive
                    ? {
                        borderColor: c.spec.color,
                        backgroundColor: '#ffffff',
                      }
                    : undefined),
                }}
                className={`absolute px-1.5 py-0.5 @[440px]:px-2.5 @[440px]:py-1 rounded-xl border transition-all duration-150 cursor-pointer flex flex-col items-start text-left leading-tight ${
                  isActive
                    ? 'shadow-sm'
                    : 'bg-slate-50/95 border-slate-200/90 hover:bg-white shadow-[0_1px_3px_rgba(15,23,42,0.03)]'
                } ${isDimmed ? 'opacity-40' : ''}`}
              >
                <span className="inline-flex items-center gap-1 @[440px]:gap-1.5 text-[7.5px] @[340px]:text-[8.5px] @[440px]:text-[10.5px] font-bold whitespace-nowrap text-slate-900">
                  <span className="w-1.5 h-1.5 @[440px]:w-2 @[440px]:h-2 rounded-full shrink-0" style={{ backgroundColor: c.spec.color }} />
                  <span>{c.spec.label}</span>
                </span>
                <span className="text-[7px] @[340px]:text-[8px] @[440px]:text-[10px] font-figure font-semibold tabular-nums whitespace-nowrap pl-2.5 @[440px]:pl-3 text-slate-500">
                  <strong className="font-bold" style={{ color: c.spec.pctColor }}>
                    {c.spec.pctText}
                  </strong>{' '}
                  · {c.spec.subText}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
});

interface Props {
  role: UserRole;
  userBranchId?: string;
  branches: Branch[];
  users?: User[];
  triggerToast: (msg: string) => void;
  onNavigateToSettings?: (subTab?: string) => void;
}

export const KpiPerformanceTab: React.FC<Props> = ({ role, userBranchId, branches, users = [], triggerToast }) => {
  const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const [period, setPeriod] = useState<KpiPeriod>('ALL');
  const [metricMode, setMetricMode] = useState<KpiMetricMode>('points');
  const isTaskMode = metricMode === 'tasks';
  const [view, setView] = useState<KpiView>('all');
  const [granularity, setGranularity] = useState<Granularity>('daily');
  const [branchFilter, setBranchFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | KpiCategory>('ALL');
  const [query, setQuery] = useState('');
  const [cachedStaff, setCachedStaff] = useState<StaffAccount[] | null>(() => getCachedStaff());
  useEffect(() => {
    const unsub = onStaffList(setCachedStaff);
    if (!getCachedStaff() && isAdmin) {
      loadStaff({ maxAgeMs: 30000 }).then((x) => { if (x) setCachedStaff(x); });
    }
    return unsub;
  }, [isAdmin]);
  const deferredQuery = useDeferredValue(query);
  const [selectedTopMonth, setSelectedTopMonth] = useState<string>('ALL');
  const [leaderboardMode, setLeaderboardMode] = useState<'staff' | 'branch'>('staff');
  const [openBranch, setOpenBranch] = useState<string | null>(null);
  const [openStaff, setOpenStaff] = useState<string | null>(null);
  const [showSubCategories, setShowSubCategories] = useState(false);
  const [subCatSearch, setSubCatSearch] = useState('');
  const [subCatActiveOnly, setSubCatActiveOnly] = useState(true);
  const [subCatRankBy, setSubCatRankBy] = useState<'points' | 'tasks'>('points');
  const [subCatViewMode, setSubCatViewMode] = useState<'graph' | 'table'>('graph');
  const [hoveredSubCatCode, setHoveredSubCatCode] = useState<string | null>(null);

  useEffect(() => {
    setSubCatRankBy(metricMode);
  }, [metricMode]);
  const [tableMode, setTableMode] = useState<'branch' | 'staff'>('staff');
  const [branchSubView, setBranchSubView] = useState<'summary' | 'monthly' | 'daily'>('summary');
  const [staffSubView, setStaffSubView] = useState<'summary' | 'monthly' | 'daily'>('summary');
  const [isMatrixPending, startMatrixTransition] = useTransition();
  const [monthlySortKey, setMonthlySortKey] = useState<string>('total');
  const [monthlySortDir, setMonthlySortDir] = useState<'asc' | 'desc'>('desc');
  const [monthlyMatrixYear, setMonthlyMatrixYear] = useState<string>(() => todayPP().slice(0, 4));
  
  const [staffLevelFilter, setStaffLevelFilter] = useState<'all' | 'field' | 'management'>('all');
  const [statusFilter, setStatusFilter] = useState<'ALL' | KpiRating>('ALL');
  const [dailyMatrixMonth, setDailyMatrixMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [dailySortKey, setDailySortKey] = useState<string>('monthTotalTasks');
  const [dailySortDir, setDailySortDir] = useState<'asc' | 'desc'>('desc');
  const [dailyStaffSortKey, setDailyStaffSortKey] = useState<string>('monthTotalTasks');
  const [dailyStaffSortDir, setDailyStaffSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [timelineExpanded, setTimelineExpanded] = useState(false);

  // Management KPI Exemption reactive synchronization
  const [exemptVersion, setExemptVersion] = useState(0);
  useEffect(() => {
    const handler = () => setExemptVersion((v) => v + 1);
    window.addEventListener(KPI_MANAGEMENT_EXEMPT_EVENT, handler);
    return () => window.removeEventListener(KPI_MANAGEMENT_EXEMPT_EVENT, handler);
  }, []);
  const exemptSet = useMemo(() => getManagementExemptSet(), [exemptVersion]);

  const handleViewChange = useCallback((newView: KpiView) => {
    setSelectedCard(null);
    startMatrixTransition(() => {
      setView(newView);
      if (newView === 'branches') {
        setTableMode('branch');
        setBranchSubView('summary');
      }
      if (newView === 'staff') {
        setTableMode('staff');
        setStaffSubView('summary');
      }
    });
  }, []);

  const handleTableModeChange = useCallback(
    (mode: 'branch' | 'staff' | 'branch_monthly' | 'staff_monthly' | 'branch_daily' | 'staff_daily') => {
      startMatrixTransition(() => {
        if (mode === 'branch_daily') {
          setTableMode('branch');
          setBranchSubView('daily');
        } else if (mode === 'staff_daily') {
          setTableMode('staff');
          setStaffSubView('daily');
        } else if (mode === 'branch_monthly') {
          setTableMode('branch');
          setBranchSubView('monthly');
          setStatusFilter((prev) => (prev === 'Management (Exempt)' ? 'ALL' : prev));
        } else if (mode === 'staff_monthly') {
          setTableMode('staff');
          setStaffSubView('monthly');
        } else if (mode === 'branch') {
          setTableMode('branch');
          setBranchSubView('summary');
          setStatusFilter((prev) => (prev === 'Management (Exempt)' ? 'ALL' : prev));
        } else if (mode === 'staff') {
          setTableMode('staff');
          setStaffSubView('summary');
        }
      });
    },
    []
  );

  const handleCardClick = useCallback((cardKey: string, targetView: KpiView, mode?: 'branch' | 'staff') => {
    setSelectedCard((c) => (c === cardKey ? null : cardKey));
    startMatrixTransition(() => {
      setView(targetView);
      if (mode === 'branch') {
        setTableMode('branch');
        setBranchSubView('summary');
      } else if (mode === 'staff') {
        setTableMode('staff');
        setStaffSubView('summary');
      }
    });
  }, []);

  // Sorting state for tables
  const [branchSortKey, setBranchSortKey] = useState<string>('totalPoints');
  const [branchSortDir, setBranchSortDir] = useState<'asc' | 'desc'>('desc');
  const [staffSortKey, setStaffSortKey] = useState<string>('totalPoints');
  const [staffSortDir, setStaffSortDir] = useState<'asc' | 'desc'>('desc');
  const [timelineSortKey, setTimelineSortKey] = useState<string>('period');
  const [timelineSortDir, setTimelineSortDir] = useState<'asc' | 'desc'>('desc');

  const handleMetricModeChange = useCallback((next: KpiMetricMode) => {
    startMatrixTransition(() => {
      setMetricMode(next);
      setBranchSortKey((k) => remapMetricSortKey(k, next, true));
      setStaffSortKey((k) => remapMetricSortKey(k, next, false));
      setTimelineSortKey((k) => remapMetricSortKey(k, next, true));
    });
  }, []);

  const range = useMemo(() => kpiPeriodRange(period), [period]);
  const [data, setData] = useState<KpiDashboardData | null>(() => getCachedKpiSummary(range.from, range.to) || getCachedKpiSummary(null, null) || null);
  const [loading, setLoading] = useState(!data);
  const [loadError, setLoadError] = useState('');

  const seqRef = useRef(0);
  const loadImpl = useCallback(async (quiet: boolean, force = false) => {
    const seq = ++seqRef.current;
    const hit = getCachedKpiSummary(range.from, range.to);
    if (hit) setData(hit);
    setLoading((force || !hit) && !quiet);
    try {
      const res = await fetchKpiSummary(range.from, range.to, force);
      if (seq !== seqRef.current) return;
      setData(res);
      setLoadError('');
    } catch (e) {
      if (seq !== seqRef.current) return;
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [range.from, range.to]);
  const load = useCallback(() => loadImpl(false, false), [loadImpl]);
  const forceReload = useCallback(() => loadImpl(false, true), [loadImpl]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    // (25 Nov 2026) one shared refresh rule with the Dashboard (see createRefreshScheduler)
    const refresh = createRefreshScheduler(() => { void loadImpl(true); });
    const unsub = onPortalSync(
      ['kpi', 'field', 'qr', 'cc', 'mv', 'staff', 'branches', 'devices'],
      (_changed, info) => refresh.trigger(info)
    );
    return () => {
      refresh.dispose();
      unsub();
    };
  }, [loadImpl]);

  const branchNameMap = useMemo(() => {
    const m = new Map<string, string>();
    m.set('100', 'Head Office Branch');
    branches.forEach((b) => m.set(String(b.id), cleanBranchName(b.name)));
    return m;
  }, [branches]);

  // Active Phnom Penh staff scoped directly from the Staff Directory tab (live cache -> App users fallback)
  const ppDirectoryScope = useMemo(() => {
    const branchById = new Map<string, Branch>();
    branches.forEach((b) => {
      if (b.id) branchById.set(String(b.id).trim(), b);
      if (b.code) branchById.set(String(b.code).trim(), b);
    });

    const locOverrides = loadLocationOverrides();
    const byEmpId = new Map<string, PpDirMember>();
    const byName = new Map<string, PpDirMember>();
    const members: PpDirMember[] = [];

    const addIfEligible = (
      empIdRaw: string | null | undefined,
      nameRaw: string | null | undefined,
      branchIdRaw: string | null | undefined,
      positionRaw: string | null | undefined,
      roleRaw: string | null | undefined,
      locationRaw: string | null | undefined,
      active: boolean
    ) => {
      if (!active) return;
      const empId = String(empIdRaw || '').trim();
      const name = String(nameRaw || '').trim();
      const branchId = String(branchIdRaw || '').trim();
      if (!empId && !name) return;

      const loc = String((empId && locOverrides[empId]) || locationRaw || 'Phnom Penh').trim();
      if (loc && !/phnom\s*penh|head\s*office/i.test(loc)) return;

      const brObj = branchById.get(branchId);
      const isPPBranch = brObj
        ? isPhnomPenhBranch(brObj)
        : isPhnomPenhBranch({ id: branchId, code: branchId, name: '' });
      if (!isPPBranch) return;

      const isManagement = isStaffManagementExempt(empId, name, exemptSet);
      const entry: PpDirMember = {
        empId,
        name,
        branchId,
        position: String(positionRaw || '').trim() || (isManagement ? 'Management' : 'MS Officer'),
        role: String(roleRaw || 'BRANCH'),
        isManagement,
      };
      members.push(entry);
      if (empId) {
        byEmpId.set(empId, entry);
        byEmpId.set(empId.toLowerCase(), entry);
      }
      if (name) {
        const norm = normalizeStaffName(name).toLowerCase();
        if (norm) byName.set(norm, entry);
        byName.set(name.toLowerCase(), entry);
      }
    };

    const hasCached = Boolean(cachedStaff && cachedStaff.length > 0);
    const hasUsers = Boolean(users && users.length > 0);
    if (hasCached) {
      cachedStaff!.forEach((a) =>
        addIfEligible(a.empId, a.name, a.branchId, a.position, a.role, a.location, a.active !== false)
      );
    } else if (hasUsers) {
      users.forEach((u) =>
        addIfEligible(u.empId || u.uid, u.name, u.branchId, u.position, u.accessRole, u.location, u.status !== 'Suspended')
      );
    }

    const hasDirectory = hasCached || hasUsers;
    const matchPpStaff = (
      staffId?: string | null,
      staffName?: string | null,
      fallbackBranchId?: string | null,
      fallbackBranchName?: string | null
    ): PpDirMember | null => {
      const idKey = String(staffId || '').trim();
      const rawName = String(staffName || '').trim();
      const normName = normalizeStaffName(rawName).toLowerCase();
      const dirHit =
        (idKey && (byEmpId.get(idKey) || byEmpId.get(idKey.toLowerCase()))) ||
        (normName && byName.get(normName)) ||
        (rawName && byName.get(rawName.toLowerCase())) ||
        null;
      if (hasDirectory) return dirHit;

      const fbId = String(fallbackBranchId || '').trim();
      const fbBranch = branchById.get(fbId);
      const fbName = String(fallbackBranchName || '').trim();
      const isPPFallback = fbBranch
        ? isPhnomPenhBranch(fbBranch)
        : isPhnomPenhBranch({ id: fbId, code: fbId, name: fbName });
      if (!isPPFallback) return null;
      const isManagement = isStaffManagementExempt(idKey, rawName, exemptSet);
      return {
        empId: idKey,
        name: rawName || idKey,
        branchId: fbId,
        position: isManagement ? 'Management' : 'MS Officer',
        role: 'BRANCH',
        isManagement,
      };
    };

    return { hasDirectory, members, byEmpId, byName, matchPpStaff };
  }, [cachedStaff, users, branches, exemptSet]);

  const staffMetaMap = useMemo(() => {
    const map = new Map<string, { position: string; role: string; isManagement: boolean; name: string }>();

    // Populate from active Phnom Penh Staff Directory (and overlay branches.staffDetails if directory not loaded)
    if (!ppDirectoryScope.hasDirectory) {
      branches.filter((b) => isPhnomPenhBranch(b)).forEach((b) => {
        (b.staffDetails || []).forEach((u) => {
          const isMgt = isStaffManagementExempt(u.empId, u.name, exemptSet);
          const entry = {
            position: u.position || (isMgt ? 'Management' : 'MS Officer'),
            role: u.accessRole || 'BRANCH',
            isManagement: isMgt,
            name: u.name,
          };
          if (u.empId) map.set(u.empId, entry);
          if (u.name) map.set(u.name.toLowerCase(), entry);
        });
      });
    }

    ppDirectoryScope.members.forEach((m) => {
      const entry = {
        position: m.position,
        role: m.role,
        isManagement: m.isManagement,
        name: m.name,
      };
      if (m.empId) map.set(m.empId, entry);
      if (m.name) map.set(m.name.toLowerCase(), entry);
    });

    return map;
  }, [branches, exemptSet, ppDirectoryScope]);

  const ruleMap = useMemo(() => {
    const m = new Map<string, KpiPointRule>();
    (data?.rules || []).forEach((r) => m.set(r.code, r));
    return m;
  }, [data?.rules]);

  const activeTargets = useMemo(() => {
    const t = data?.targets;
    if (!t) return { branch: 500, staff: 120, label: 'Monthly target' };
    if (range.targetKind === 'daily') return { branch: t.branchDailyTarget, staff: t.staffDailyTarget, label: 'Daily target' };
    if (range.targetKind === 'weekly') return { branch: t.branchWeeklyTarget, staff: t.staffWeeklyTarget, label: 'Weekly target' };
    if (range.targetKind === 'quarterly') return { branch: t.branchQuarterlyTarget, staff: t.staffQuarterlyTarget, label: 'Quarterly target' };
    return { branch: t.branchMonthlyTarget, staff: t.staffMonthlyTarget, label: 'Monthly target' };
  }, [data?.targets, range.targetKind]);

  const monthWorkDaysSummary = useMemo(() => {
    const [yStr, mStr] = (dailyMatrixMonth || '').split('-');
    const year = parseInt(yStr, 10) || new Date().getFullYear();
    const month = parseInt(mStr, 10) || (new Date().getMonth() + 1);
    return getMonthWorkDaysSummary(year, month);
  }, [dailyMatrixMonth]);

  const matrixDays = useMemo(() => {
    const [yStr, mStr] = (dailyMatrixMonth || '').split('-');
    const year = parseInt(yStr, 10) || new Date().getFullYear();
    const month = parseInt(mStr, 10) || (new Date().getMonth() + 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const todayIso = todayPP();

    return Array.from({ length: daysInMonth }, (_, i) => {
      const dayNum = i + 1;
      const dateObj = new Date(year, month - 1, dayNum);
      const isoDay = `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      const dayOfWeek = WEEKDAY.format(dateObj);
      const isSunday = dateObj.getDay() === 0;
      const isSaturday = dateObj.getDay() === 6;
      // Saturdays and Sundays are excluded from KPI
      const isWeekend = isSunday || (data?.targets?.workingDaysMode === 'mon_sat' ? false : isSaturday);
      const holidayName = getCambodiaHoliday(isoDay);
      const isHoliday = Boolean(holidayName);
      // Day counts towards KPI only if it's not a weekend and not a Cambodian holiday (when excludeHolidays is true, default true)
      const excludeHolidays = data?.targets?.excludeHolidays !== false;
      const isWorkDay = !isWeekend && (!excludeHolidays || !isHoliday);
      const isToday = isoDay === todayIso;
      return {
        dayNum,
        isoDay,
        dayOfWeek,
        isSunday,
        isSaturday,
        isWeekend,
        isHoliday,
        holidayName,
        isWorkDay,
        isToday,
      };
    });
  }, [dailyMatrixMonth, data?.targets?.workingDaysMode, data?.targets?.excludeHolidays]);

  // Dynamic Pacing calculation: ratings count pacing so far (e.g. Day 1: 25 pts = 100% Meet Target)
  const pacingInfo = useMemo(() => {
    const totalWorkDays = monthWorkDaysSummary.workDays > 0 ? monthWorkDaysSummary.workDays : (data?.targets?.workDaysInMonth ?? 21);
    const [yStr, mStr] = (dailyMatrixMonth || '').split('-');
    const viewYear = parseInt(yStr, 10) || new Date().getFullYear();
    const viewMonth = parseInt(mStr, 10) || (new Date().getMonth() + 1);
    const today = todayPP();
    const [curYear, curMonth] = today.split('-').map(Number);

    const viewYm = `${viewYear}-${String(viewMonth).padStart(2, '0')}`;
    const curYm = `${curYear}-${String(curMonth).padStart(2, '0')}`;

    let elapsedWorkDays = 1;
    if (viewYm < curYm) {
      // Past month completed: all work days have passed
      elapsedWorkDays = totalWorkDays;
    } else if (viewYm > curYm) {
      // Future month: baseline 1 day
      elapsedWorkDays = 1;
    } else {
      // Current month: count work days up to today (at least 1)
      const workDaysSoFar = matrixDays.filter((d) => d.isWorkDay && d.isoDay <= today).length;
      elapsedWorkDays = Math.max(1, Math.min(totalWorkDays, workDaysSoFar));
    }

    const pacingRatio = Math.min(1, Math.max(0.01, elapsedWorkDays / totalWorkDays));
    return {
      totalWorkDays,
      elapsedWorkDays,
      pacingRatio,
    };
  }, [monthWorkDaysSummary.workDays, data?.targets?.workDaysInMonth, dailyMatrixMonth, matrixDays]);

  const enrichedStaff = useMemo(() => {
    if (!data) return [];

    // Strictly filter & canonicalize KPI staff against active Phnom Penh Staff Directory
    type RawStaffRow = (typeof data.staff)[number];
    const canonicalByStaff = new Map<string, RawStaffRow>();
    const existingStaffIds = new Set<string>();
    const existingStaffNames = new Set<string>();

    for (const s of data.staff) {
      const dir = ppDirectoryScope.matchPpStaff(s.staffId, s.staffName, s.branchId, s.branchName);
      if (!dir) continue;
      const canonId = dir.empId || s.staffId;
      const canonName = dir.name || s.staffName;
      const canonBranch = dir.branchId || s.branchId;
      const key = canonId || canonName.toLowerCase();
      if (canonId) existingStaffIds.add(canonId);
      if (canonName) existingStaffNames.add(canonName.toLowerCase());

      const prev = canonicalByStaff.get(key);
      if (!prev) {
        const extraClone = s.extra ? { ...s.extra } : undefined;
        canonicalByStaff.set(key, {
          ...s,
          staffId: canonId,
          staffName: canonName,
          branchId: canonBranch,
          branchName: branchNameMap.get(canonBranch) || s.branchName || canonBranch,
          extra: extraClone,
        });
      } else {
        prev.posInstall += s.posInstall;
        prev.posReplace += s.posReplace;
        prev.posBattery += s.posBattery;
        prev.sbInstall += s.sbInstall;
        prev.sbReplace += s.sbReplace;
        prev.sbMaint += s.sbMaint;
        prev.sbReturn += s.sbReturn;
        prev.khqrInstall += s.khqrInstall;
        prev.khqrReplace += s.khqrReplace;
        prev.khqrMaterials += s.khqrMaterials;
        prev.ccPrimary += s.ccPrimary;
        prev.ccSupp += s.ccSupp;
        prev.adjPts = (prev.adjPts || 0) + (s.adjPts || 0);
        prev.posSubmitted += s.posSubmitted;
        prev.posRejected += s.posRejected;
        prev.sbSubmitted += s.sbSubmitted;
        prev.sbRejected += s.sbRejected;
        prev.khqrFailed += s.khqrFailed;
        prev.ccSubmitted += s.ccSubmitted;
        prev.ccRejected += s.ccRejected;
        addExtraCounts(prev, s);
      }
    }

    // Supplement management staff from active Phnom Penh Staff Directory so management tier stays represented
    const managementRosterExtras: RawStaffRow[] = [];
    ppDirectoryScope.members.forEach((m) => {
      if (!m.isManagement) return;
      const empId = m.empId || '';
      const nameLower = (m.name || '').toLowerCase();
      if ((!empId || !existingStaffIds.has(empId)) && (!nameLower || !existingStaffNames.has(nameLower))) {
        if (empId) existingStaffIds.add(empId);
        if (nameLower) existingStaffNames.add(nameLower);
        managementRosterExtras.push({
          staffId: empId,
          staffName: m.name,
          branchId: m.branchId,
          branchName: branchNameMap.get(m.branchId) || m.branchId,
          posInstall: 0, posReplace: 0, posBattery: 0,
          sbInstall: 0, sbReplace: 0, sbMaint: 0, sbReturn: 0,
          khqrInstall: 0, khqrReplace: 0, khqrMaterials: 0,
          ccPrimary: 0, ccSupp: 0,
          posSubmitted: 0, posRejected: 0,
          sbSubmitted: 0, sbRejected: 0,
          khqrFailed: 0,
          ccSubmitted: 0, ccRejected: 0,
        });
      }
    });

    const combinedList = [...Array.from(canonicalByStaff.values()), ...managementRosterExtras];

    const base = combinedList
      .map((s) => {
        const meta = staffMetaMap.get(s.staffId) || staffMetaMap.get(s.staffName.toLowerCase());
        const isManagement = meta?.isManagement ?? isStaffManagementExempt(s.staffId, s.staffName, exemptSet);
        const position = meta?.position || (isManagement ? 'Management' : 'MS Officer');

        const pts = computeKpiPoints(s, ruleMap);
        const canonicalBranchName = branchNameMap.get(s.branchId) || s.branchName || s.branchId;
        const totalSubmitted = s.posSubmitted + s.sbSubmitted + pts.khqrTasks + s.ccSubmitted;
        const totalIssues = s.posRejected + s.sbRejected + s.khqrFailed + s.ccRejected;
        const qualityPct = totalSubmitted > 0 ? Math.max(0, Math.round(((totalSubmitted - totalIssues) / totalSubmitted) * 100)) : 100;
        return {
          ...s,
          position,
          isManagement,
          branchName: canonicalBranchName,
          isPP: true,
          ...pts,
          qualityPct,
        };
      })
      // Keep active field staff OR management level staff (to keep room for management level!)
      .filter((s) => s.totalTasks > 0 || s.posSubmitted > 0 || s.sbSubmitted > 0 || s.ccSubmitted > 0 || s.isManagement);

    // Calculate benchmark exclusively on field staff so management does not distort targets
    const fieldStaff = base.filter((s) => !s.isManagement);
    const totalFieldStaff = fieldStaff.length;
    const avgPts = totalFieldStaff > 0 ? fieldStaff.reduce((acc, s) => acc + s.totalPoints, 0) / totalFieldStaff : 0;
    const rawTargetHit = fieldStaff.filter((s) => s.totalPoints >= activeTargets.staff).length;
    const effectiveStaffTarget =
      totalFieldStaff > 0 && rawTargetHit / totalFieldStaff >= 0.08
        ? activeTargets.staff
        : Math.max(8, Math.round(avgPts) || activeTargets.staff);

    return base
      .map((s) => {
        const targetPct = s.isManagement
          ? (s.totalPoints > 0 && effectiveStaffTarget > 0 ? Math.min(999, Math.round((s.totalPoints / effectiveStaffTarget) * 1000) / 10) : 0)
          : (effectiveStaffTarget > 0 ? Math.min(999, Math.round((s.totalPoints / effectiveStaffTarget) * 1000) / 10) : 100);

        // Pacing target based on elapsed work days (e.g. Day 1: target = daily target)
        const pacingStaffTarget = Math.max(1, Math.round(effectiveStaffTarget * pacingInfo.pacingRatio));
        const pacingPct = s.isManagement
          ? (s.totalPoints > 0 && pacingStaffTarget > 0 ? Math.min(999, Math.round((s.totalPoints / pacingStaffTarget) * 1000) / 10) : 0)
          : (pacingStaffTarget > 0 ? Math.min(999, Math.round((s.totalPoints / pacingStaffTarget) * 1000) / 10) : 100);
        const rating = getKpiRating(pacingPct, s.isManagement);
        return {
          ...s,
          targetPct,
          pacingPct,
          pacingTarget: pacingStaffTarget,
          rating,
          effectiveTarget: s.isManagement ? 0 : effectiveStaffTarget,
        };
      })
      .sort((a, b) => {
        if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
        if (b.totalTasks !== a.totalTasks) return b.totalTasks - a.totalTasks;
        if (a.isManagement !== b.isManagement) return a.isManagement ? 1 : -1;
        return a.staffName.localeCompare(b.staffName);
      });
  }, [data, ruleMap, branchNameMap, activeTargets.staff, ppDirectoryScope, staffMetaMap, exemptSet, pacingInfo]);

  const branchRows = useMemo(() => {
    const map = new Map<string, {
      branchId: string;
      branchName: string;
      isPP: boolean;
      staffCount: number;
      kpiStaffCount: number;
      mgtStaffCount: number;
      staffList: typeof enrichedStaff;
      raw: KpiRawCounts;
      totalSubmitted: number;
      totalIssues: number;
    }>();

    enrichedStaff.forEach((s) => {
      const key = (s.branchId && s.branchId !== 'UNASSIGNED') ? s.branchId : (s.branchName || 'UNASSIGNED');
      let b = map.get(key);
      if (!b) {
        b = {
          branchId: s.branchId || 'UNASSIGNED',
          branchName: (s.branchId && branchNameMap.get(s.branchId)) || s.branchName || 'Unassigned',
          isPP: s.isPP,
          staffCount: 0,
          kpiStaffCount: 0,
          mgtStaffCount: 0,
          staffList: [],
          raw: {
            posInstall: 0, posReplace: 0, posBattery: 0,
            sbInstall: 0, sbReplace: 0, sbMaint: 0, sbReturn: 0,
            khqrInstall: 0, khqrReplace: 0, khqrMaterials: 0,
            ccPrimary: 0, ccSupp: 0,
          },
          totalSubmitted: 0,
          totalIssues: 0,
        };
        map.set(key, b);
      }
      b.staffCount += 1;
      if (s.isManagement) {
        b.mgtStaffCount += 1;
      } else {
        b.kpiStaffCount += 1;
      }
      b.staffList.push(s);
      b.raw.posInstall += s.posInstall;
      b.raw.posReplace += s.posReplace;
      b.raw.posBattery += s.posBattery;
      b.raw.sbInstall += s.sbInstall;
      b.raw.sbReplace += s.sbReplace;
      b.raw.sbMaint += s.sbMaint;
      b.raw.sbReturn += s.sbReturn;
      b.raw.khqrInstall += s.khqrInstall;
      b.raw.khqrReplace += s.khqrReplace;
      b.raw.khqrMaterials += s.khqrMaterials;
      b.raw.ccPrimary += s.ccPrimary;
      b.raw.ccSupp += s.ccSupp;
      b.raw.adjPts = (b.raw.adjPts || 0) + (s.adjPts || 0);
      addExtraCounts(b.raw, s);
      b.totalSubmitted += s.posSubmitted + s.sbSubmitted + s.khqrTasks + s.ccSubmitted;
      b.totalIssues += s.posRejected + s.sbRejected + s.khqrFailed + s.ccRejected;
    });

    const baseBranches = Array.from(map.values()).map((b) => {
      const pts = computeKpiPoints(b.raw, ruleMap);
      const kpiCount = b.kpiStaffCount > 0 ? b.kpiStaffCount : b.staffCount;
      const ptsPerStaff = kpiCount > 0 ? Math.round((pts.totalPoints / kpiCount) * 10) / 10 : 0;
      const tasksPerStaff = kpiCount > 0 ? Math.round((pts.totalTasks / kpiCount) * 10) / 10 : 0;
      const qualityPct = b.totalSubmitted > 0 ? Math.max(0, Math.round(((b.totalSubmitted - b.totalIssues) / b.totalSubmitted) * 100)) : 100;
      return {
        ...b,
        ...pts,
        ptsPerStaff,
        tasksPerStaff,
        qualityPct,
      };
    });

    return baseBranches
      .map((b) => {
        // Branch target auto-multiplies by active field officers only (Management is exempt from field KPIs)
        const targetStaffCount = Math.max(1, b.kpiStaffCount > 0 ? b.kpiStaffCount : b.staffCount);
        const dynamicBranchTarget = targetStaffCount * activeTargets.staff;
        const targetPct = dynamicBranchTarget > 0 ? Math.min(999, Math.round((b.totalPoints / dynamicBranchTarget) * 1000) / 10) : 100;

        // Pacing target based on elapsed work days (e.g. Day 1: 25 pts = 100% Meet Target)
        const pacingBranchTarget = Math.max(1, Math.round(dynamicBranchTarget * pacingInfo.pacingRatio));
        const pacingPct = pacingBranchTarget > 0 ? Math.min(999, Math.round((b.totalPoints / pacingBranchTarget) * 1000) / 10) : 100;
        const rating = getKpiRating(pacingPct, false);
        return {
          ...b,
          targetPct,
          pacingPct,
          pacingTarget: pacingBranchTarget,
          rating,
          effectiveTarget: dynamicBranchTarget,
        };
      })
      .sort((a, b) => b.totalPoints - a.totalPoints || b.totalTasks - a.totalTasks);
  }, [enrichedStaff, branchNameMap, ruleMap, activeTargets.staff, pacingInfo]);

  const filteredBranches = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const list = branchRows.filter((b) => {
      if (branchFilter && b.branchId !== branchFilter) return false;
      if (categoryFilter === 'POS Terminal' && b.posTasks === 0) return false;
      if (categoryFilter === 'Sound Box' && b.sbTasks === 0) return false;
      if (categoryFilter === 'KHQR' && b.khqrTasks === 0) return false;
      if (categoryFilter === 'Credit Card' && b.ccTasks === 0) return false;
      if (categoryFilter === 'Merchant Visit' && b.mvTasks === 0) return false;
      if (q && !`${b.branchId} ${b.branchName}`.toLowerCase().includes(q)) return false;
      return true;
    });

    return [...list].sort((a, b) => {
      let av: string | number = 0;
      let bv: string | number = 0;
      switch (branchSortKey) {
        case 'branchId':
          av = a.branchId;
          bv = b.branchId;
          break;
        case 'branchName':
          av = cleanBranchName(a.branchName);
          bv = cleanBranchName(b.branchName);
          break;
        case 'staffCount':
          av = a.staffCount;
          bv = b.staffCount;
          break;
        case 'posPoints':
          av = a.posPoints;
          bv = b.posPoints;
          break;
        case 'posTasks':
          av = a.posTasks;
          bv = b.posTasks;
          break;
        case 'sbPoints':
          av = a.sbPoints;
          bv = b.sbPoints;
          break;
        case 'sbTasks':
          av = a.sbTasks;
          bv = b.sbTasks;
          break;
        case 'khqrPoints':
          av = a.khqrPoints;
          bv = b.khqrPoints;
          break;
        case 'khqrTasks':
          av = a.khqrTasks;
          bv = b.khqrTasks;
          break;
        case 'ccPoints':
          av = a.ccPoints;
          bv = b.ccPoints;
          break;
        case 'ccTasks':
          av = a.ccTasks;
          bv = b.ccTasks;
          break;
        case 'mvPoints':
          av = a.mvPoints;
          bv = b.mvPoints;
          break;
        case 'mvTasks':
          av = a.mvTasks;
          bv = b.mvTasks;
          break;
        case 'ptsPerStaff':
          av = a.ptsPerStaff;
          bv = b.ptsPerStaff;
          break;
        case 'tasksPerStaff':
          av = a.tasksPerStaff;
          bv = b.tasksPerStaff;
          break;
        case 'totalTasks':
          av = a.totalTasks;
          bv = b.totalTasks;
          break;
        case 'targetPct':
          av = a.targetPct;
          bv = b.targetPct;
          break;
        case 'totalPoints':
        default:
          av = a.totalPoints;
          bv = b.totalPoints;
          break;
      }
      if (typeof av === 'string') {
        const cmp = String(av).localeCompare(String(bv), 'en', { numeric: true });
        return branchSortDir === 'asc' ? cmp : -cmp;
      }
      const numA = Number(av) || 0;
      const numB = Number(bv) || 0;
      return branchSortDir === 'asc' ? numA - numB : numB - numA;
    });
  }, [branchRows, branchFilter, categoryFilter, deferredQuery, branchSortKey, branchSortDir]);

  const filteredStaff = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const list = enrichedStaff.filter((s) => {
      if (!isAdmin && userBranchId && s.branchId !== userBranchId) return false;
      if (staffLevelFilter === 'field' && s.isManagement) return false;
      if (staffLevelFilter === 'management' && !s.isManagement) return false;
      if (branchFilter && s.branchId !== branchFilter) return false;
      if (categoryFilter === 'POS Terminal' && s.posTasks === 0) return false;
      if (categoryFilter === 'Sound Box' && s.sbTasks === 0) return false;
      if (categoryFilter === 'KHQR' && s.khqrTasks === 0) return false;
      if (categoryFilter === 'Credit Card' && s.ccTasks === 0) return false;
      if (categoryFilter === 'Merchant Visit' && s.mvTasks === 0) return false;
      if (q && !`${s.staffId} ${s.staffName} ${s.branchId} ${s.branchName} ${s.position || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });

    return [...list].sort((a, b) => {
      let av: string | number = 0;
      let bv: string | number = 0;
      switch (staffSortKey) {
        case 'staffId':
          av = a.staffId;
          bv = b.staffId;
          break;
        case 'staffName':
          av = a.staffName;
          bv = b.staffName;
          break;
        case 'branchId':
          av = a.branchId;
          bv = b.branchId;
          break;
        case 'branchName':
          av = cleanBranchName(a.branchName);
          bv = cleanBranchName(b.branchName);
          break;
        case 'posPoints':
          av = a.posPoints;
          bv = b.posPoints;
          break;
        case 'posTasks':
          av = a.posTasks;
          bv = b.posTasks;
          break;
        case 'sbPoints':
          av = a.sbPoints;
          bv = b.sbPoints;
          break;
        case 'sbTasks':
          av = a.sbTasks;
          bv = b.sbTasks;
          break;
        case 'khqrPoints':
          av = a.khqrPoints;
          bv = b.khqrPoints;
          break;
        case 'khqrTasks':
          av = a.khqrTasks;
          bv = b.khqrTasks;
          break;
        case 'ccPoints':
          av = a.ccPoints;
          bv = b.ccPoints;
          break;
        case 'ccTasks':
          av = a.ccTasks;
          bv = b.ccTasks;
          break;
        case 'mvPoints':
          av = a.mvPoints;
          bv = b.mvPoints;
          break;
        case 'mvTasks':
          av = a.mvTasks;
          bv = b.mvTasks;
          break;
        case 'qualityPct':
          av = a.qualityPct;
          bv = b.qualityPct;
          break;
        case 'totalTasks':
          av = a.totalTasks;
          bv = b.totalTasks;
          break;
        case 'targetPct':
          av = a.targetPct;
          bv = b.targetPct;
          break;
        case 'totalPoints':
        default:
          av = a.totalPoints;
          bv = b.totalPoints;
          break;
      }
      if (typeof av === 'string') {
        const cmp = String(av).localeCompare(String(bv), 'en', { numeric: true });
        return staffSortDir === 'asc' ? cmp : -cmp;
      }
      const numA = Number(av) || 0;
      const numB = Number(bv) || 0;
      return staffSortDir === 'asc' ? numA - numB : numB - numA;
    });
  }, [enrichedStaff, isAdmin, userBranchId, branchFilter, categoryFilter, deferredQuery, staffSortKey, staffSortDir, staffLevelFilter]);

  const statusFilteredBranches = useMemo(
    () => (statusFilter === 'ALL' ? filteredBranches : filteredBranches.filter((b) => b.rating === statusFilter)),
    [filteredBranches, statusFilter]
  );

  const statusFilteredStaff = useMemo(
    () => (statusFilter === 'ALL' ? filteredStaff : filteredStaff.filter((s) => s.rating === statusFilter)),
    [filteredStaff, statusFilter]
  );

  const totals = useMemo(() => {
    const raw: KpiRawCounts = {
      posInstall: 0, posReplace: 0, posBattery: 0,
      sbInstall: 0, sbReplace: 0, sbMaint: 0, sbReturn: 0,
      khqrInstall: 0, khqrReplace: 0, khqrMaterials: 0,
      ccPrimary: 0, ccSupp: 0,
    };
    let submitted = 0, issues = 0;
    filteredBranches.forEach((b) => {
      raw.posInstall += b.raw.posInstall;
      raw.posReplace += b.raw.posReplace;
      raw.posBattery += b.raw.posBattery;
      raw.sbInstall += b.raw.sbInstall;
      raw.sbReplace += b.raw.sbReplace;
      raw.sbMaint += b.raw.sbMaint;
      raw.sbReturn += b.raw.sbReturn;
      raw.khqrInstall += b.raw.khqrInstall;
      raw.khqrReplace += b.raw.khqrReplace;
      raw.khqrMaterials += b.raw.khqrMaterials;
      raw.ccPrimary += b.raw.ccPrimary;
      raw.ccSupp += b.raw.ccSupp;
      raw.adjPts = (raw.adjPts || 0) + (b.raw.adjPts || 0);
      addExtraCounts(raw, b.raw);
      submitted += b.totalSubmitted;
      issues += b.totalIssues;
    });
    const pts = computeKpiPoints(raw, ruleMap);
    const activeBranchCount = filteredBranches.length;
    const kpiStaffOnly = filteredStaff.filter((s) => !s.isManagement);
    const mgtStaffOnly = filteredStaff.filter((s) => s.isManagement);
    const activeStaffCount = kpiStaffOnly.length;
    const totalStaffCount = filteredStaff.length;
    const avgBranchPts = activeBranchCount > 0 ? Math.round((pts.totalPoints / activeBranchCount) * 10) / 10 : 0;
    const avgStaffPts = activeStaffCount > 0 ? Math.round((pts.totalPoints / activeStaffCount) * 10) / 10 : 0;
    const avgBranchTasks = activeBranchCount > 0 ? Math.round((pts.totalTasks / activeBranchCount) * 10) / 10 : 0;
    const avgStaffTasks = activeStaffCount > 0 ? Math.round((pts.totalTasks / activeStaffCount) * 10) / 10 : 0;
    const qualityPct = submitted > 0 ? Math.max(0, Math.round(((submitted - issues) / submitted) * 100)) : 100;
    const branchesOnTarget = filteredBranches.filter((b) => (b.pacingPct ?? b.targetPct) >= 100).length;
    const staffOnTarget = kpiStaffOnly.filter((s) => (s.pacingPct ?? s.targetPct) >= 100).length;
    const totalBranchTargetPoints = filteredBranches.reduce((acc, b) => acc + (b.effectiveTarget || (Math.max(1, b.staffCount) * activeTargets.staff)), 0);
    const targetAchievementPct = totalBranchTargetPoints > 0
      ? Math.min(999, Math.round((pts.totalPoints / totalBranchTargetPoints) * 100))
      : (activeBranchCount > 0 ? Math.round(filteredBranches.reduce((acc, b) => acc + b.targetPct, 0) / activeBranchCount) : 0);
    const topBranch = [...filteredBranches].sort((a, b) => b.totalPoints - a.totalPoints || b.totalTasks - a.totalTasks)[0] || null;
    const topTaskBranch = [...filteredBranches].sort((a, b) => b.totalTasks - a.totalTasks || b.totalPoints - a.totalPoints)[0] || null;
    const topStaff = [...filteredStaff].sort((a, b) => b.totalPoints - a.totalPoints || b.totalTasks - a.totalTasks)[0] || null;
    const topTaskStaff = [...filteredStaff].sort((a, b) => b.totalTasks - a.totalTasks || b.totalPoints - a.totalPoints)[0] || null;
    return {
      raw,
      ...pts,
      activeBranchCount,
      activeStaffCount,
      totalStaffCount,
      mgtStaffCount: mgtStaffOnly.length,
      avgBranchPts,
      avgStaffPts,
      avgBranchTasks,
      avgStaffTasks,
      qualityPct,
      branchesOnTarget,
      staffOnTarget,
      totalBranchTargetPoints,
      targetAchievementPct,
      topBranch,
      topTaskBranch,
      topStaff,
      topTaskStaff,
    };
  }, [filteredBranches, filteredStaff, ruleMap, activeTargets]);

  const timeSeries = useMemo(() => {
    if (!data) return [];

    type SeriesBucket = KpiTimeBucketRaw & {
      posPoints: number;
      sbPoints: number;
      khqrPoints: number;
      ccPoints: number;
      mvPoints: number;
      posTasks: number;
      sbTasks: number;
      khqrTasks: number;
      ccTasks: number;
      mvTasks: number;
      totalTasks: number;
      totalPoints: number;
    };

    const emptyRawBucket = (p: string): KpiTimeBucketRaw => ({
      period: p,
      activeBranches: 0,
      activeStaff: 0,
      posInstall: 0, posReplace: 0, posBattery: 0,
      sbInstall: 0, sbReplace: 0, sbMaint: 0, sbReturn: 0,
      khqrInstall: 0, khqrReplace: 0, khqrMaterials: 0,
      ccPrimary: 0, ccSupp: 0,
    });

    const weekStartIso = (ymd: string): string => {
      const [yy, mm, dd] = ymd.split('-').map(Number);
      if (!yy || !mm || !dd) return ymd;
      const d = new Date(Date.UTC(yy, mm - 1, dd));
      const offset = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() - offset);
      return d.toISOString().slice(0, 10);
    };

    const quarterOfMonth = (ym: string): string => {
      const [yy, mm] = ym.split('-').map(Number);
      if (!yy || !mm) return ym;
      return `${yy}-Q${Math.ceil(mm / 3)}`;
    };

    let enriched: SeriesBucket[] = [];

    if ((granularity === 'monthly' || granularity === 'quarterly') && Array.isArray(data.monthlyStaff) && data.monthlyStaff.length > 0) {
      const buckets = new Map<string, { raw: KpiTimeBucketRaw; branches: Set<string>; staff: Set<string> }>();
      for (const ms of data.monthlyStaff) {
        const dir = ppDirectoryScope.matchPpStaff(ms.staffId, ms.staffName, ms.branchId, ms.branchName);
        if (!dir) continue;
        if (!isAdmin && userBranchId && dir.branchId !== userBranchId) continue;
        if (branchFilter && dir.branchId !== branchFilter) continue;
        const pKey = granularity === 'quarterly' ? quarterOfMonth(ms.month) : ms.month;
        let b = buckets.get(pKey);
        if (!b) {
          b = { raw: emptyRawBucket(pKey), branches: new Set(), staff: new Set() };
          buckets.set(pKey, b);
        }
        b.branches.add(dir.branchId);
        b.staff.add(dir.empId || dir.name.toLowerCase());
        b.raw.posInstall += ms.posInstall;
        b.raw.posReplace += ms.posReplace;
        b.raw.posBattery += ms.posBattery;
        b.raw.sbInstall += ms.sbInstall;
        b.raw.sbReplace += ms.sbReplace;
        b.raw.sbMaint += ms.sbMaint;
        b.raw.sbReturn += ms.sbReturn;
        b.raw.khqrInstall += ms.khqrInstall;
        b.raw.khqrReplace += ms.khqrReplace;
        b.raw.khqrMaterials += ms.khqrMaterials;
        b.raw.ccPrimary += ms.ccPrimary;
        b.raw.ccSupp += ms.ccSupp;
        b.raw.adjPts = (b.raw.adjPts || 0) + (ms.adjPts || 0);
        addExtraCounts(b.raw, ms);
      }
      enriched = Array.from(buckets.values())
        .sort((a, b) => b.raw.period.localeCompare(a.raw.period))
        .map(({ raw, branches: bSet, staff: sSet }) => ({
          ...raw,
          activeBranches: bSet.size,
          activeStaff: sSet.size,
          ...computeKpiPoints(raw, ruleMap),
        }));
    } else if ((granularity === 'daily' || granularity === 'weekly') && Array.isArray(data.dailyStaff) && data.dailyStaff.length > 0) {
      const posRate = totals.posTasks > 0 ? totals.posPoints / totals.posTasks : (rulePts(ruleMap, 'POS_INSTALL') || 2);
      const sbRate = totals.sbTasks > 0 ? totals.sbPoints / totals.sbTasks : (rulePts(ruleMap, 'SB_INSTALL') || 1);
      const khqrRate = totals.khqrTasks > 0 ? totals.khqrPoints / totals.khqrTasks : (rulePts(ruleMap, 'KHQR_INSTALL') || 1);
      const ccRate = totals.ccTasks > 0 ? totals.ccPoints / totals.ccTasks : (rulePts(ruleMap, 'CC_PRIMARY') || 2);
      const mvRate = totals.mvTasks > 0 ? totals.mvPoints / totals.mvTasks : (rulePts(ruleMap, 'MV_VISIT') || 1);

      const buckets = new Map<string, {
        period: string;
        branches: Set<string>;
        staff: Set<string>;
        posTasks: number;
        sbTasks: number;
        khqrTasks: number;
        ccTasks: number;
        mvTasks: number;
      }>();

      for (const ds of data.dailyStaff) {
        if (!ds.day) continue;
        if (range.from && ds.day < range.from.slice(0, 10)) continue;
        if (range.to && ds.day >= range.to.slice(0, 10)) continue;
        const dir = ppDirectoryScope.matchPpStaff(ds.staffId, ds.staffName, ds.branchId, ds.branchName);
        if (!dir) continue;
        if (!isAdmin && userBranchId && dir.branchId !== userBranchId) continue;
        if (branchFilter && dir.branchId !== branchFilter) continue;
        const pKey = granularity === 'weekly' ? weekStartIso(ds.day) : ds.day;
        let b = buckets.get(pKey);
        if (!b) {
          b = { period: pKey, branches: new Set(), staff: new Set(), posTasks: 0, sbTasks: 0, khqrTasks: 0, ccTasks: 0, mvTasks: 0 };
          buckets.set(pKey, b);
        }
        if ((ds.totalTasks || 0) > 0) {
          b.branches.add(dir.branchId);
          b.staff.add(dir.empId || dir.name.toLowerCase());
        }
        b.posTasks += Number(ds.posTasks) || 0;
        b.sbTasks += Number(ds.sbTasks) || 0;
        b.khqrTasks += Number(ds.khqrTasks) || 0;
        b.ccTasks += Number(ds.ccTasks) || 0;
        b.mvTasks += Number(ds.mvTasks) || 0;
      }

      const toBucket = (p: string, b?: (typeof buckets extends Map<string, infer V> ? V : never)): SeriesBucket => {
        const posT = b?.posTasks || 0;
        const sbT = b?.sbTasks || 0;
        const khqrT = b?.khqrTasks || 0;
        const ccT = b?.ccTasks || 0;
        const mvT = b?.mvTasks || 0;
        const posPoints = Math.round(posT * posRate * 10) / 10;
        const sbPoints = Math.round(sbT * sbRate * 10) / 10;
        const khqrPoints = Math.round(khqrT * khqrRate * 10) / 10;
        const ccPoints = Math.round(ccT * ccRate * 10) / 10;
        const mvPoints = Math.round(mvT * mvRate * 10) / 10;
        const totalPoints = Math.round((posPoints + sbPoints + khqrPoints + ccPoints + mvPoints) * 10) / 10;
        return {
          ...emptyRawBucket(p),
          activeBranches: b?.branches.size || 0,
          activeStaff: b?.staff.size || 0,
          posPoints,
          sbPoints,
          khqrPoints,
          ccPoints,
          mvPoints,
          posTasks: posT,
          sbTasks: sbT,
          khqrTasks: khqrT,
          ccTasks: ccT,
          mvTasks: mvT,
          totalTasks: posT + sbT + khqrT + ccT + mvT,
          totalPoints,
        };
      };

      if (granularity === 'daily') {
        const contiguous = buildDailyContiguousSeries(
          Array.from(buckets.keys()).map((d) => emptyRawBucket(d)),
          period,
          range
        );
        enriched = contiguous.map((c) => toBucket(c.period, buckets.get(c.period)));
      } else {
        enriched = Array.from(buckets.values())
          .sort((a, b) => b.period.localeCompare(a.period))
          .map((b) => toBucket(b.period, b));
      }
    } else {
      const rawDailyFilled = buildDailyContiguousSeries(data.daily, period, range);
      const src =
        granularity === 'daily' ? rawDailyFilled :
        granularity === 'weekly' ? data.weekly :
        granularity === 'quarterly' ? data.quarterly :
        data.monthly;
      enriched = src.map((row) => ({
        ...row,
        ...computeKpiPoints(row, ruleMap),
      }));
    }
    const workingDaysMode = data?.targets?.workingDaysMode;
    const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
    const mapped = enriched.map((row, idx) => {
      const prev = enriched[idx + 1];
      const curMetric = isTaskMode ? row.totalTasks : row.totalPoints;
      const prevMetric = prev ? (isTaskMode ? prev.totalTasks : prev.totalPoints) : 0;
      const growthPct = prev && prevMetric > 0
        ? Math.round(((curMetric - prevMetric) / prevMetric) * 100)
        : null;
      const shortLabel =
        granularity === 'monthly' ? fmtMonth(row.period) :
        granularity === 'weekly' ? `Wk ${fmtShortDate(row.period)}` :
        granularity === 'daily' ? fmtShortDate(row.period) :
        row.period;
      const parsedMs = granularity === 'daily' && row.period.length >= 10 ? Date.parse(`${row.period.slice(0, 10)}T00:00:00Z`) : NaN;
      const utcDay = Number.isNaN(parsedMs) ? -1 : new Date(parsedMs).getUTCDay();
      const holidayName = granularity === 'daily' ? getCambodiaHoliday(row.period.slice(0, 10)) : null;
      const isHoliday = Boolean(holidayName);
      const isWeekend =
        granularity === 'daily' && utcDay >= 0
          ? workingDaysMode === 'mon_sat'
            ? utcDay === 0
            : isWeekendDay(row.period.slice(0, 10))
          : false;
      return {
        ...row,
        label: shortLabel,
        fullPeriod: row.period,
        growthPct,
        isWeekend,
        isHoliday,
        holidayName,
        dayOfWeek: utcDay >= 0 ? weekdayNames[utcDay] : undefined,
        ptsPerStaff: row.activeStaff > 0 ? Math.round((row.totalPoints / row.activeStaff) * 10) / 10 : 0,
        tasksPerStaff: row.activeStaff > 0 ? Math.round((row.totalTasks / row.activeStaff) * 10) / 10 : 0,
      };
    });

    const timelinePool = granularity === 'daily' ? mapped.slice(0, 30) : mapped;

    return [...timelinePool].sort((a, b) => {
      let av: string | number = 0;
      let bv: string | number = 0;
      switch (timelineSortKey) {
        case 'activeBranches':
          av = a.activeBranches;
          bv = b.activeBranches;
          break;
        case 'activeStaff':
          av = a.activeStaff;
          bv = b.activeStaff;
          break;
        case 'posPoints':
          av = a.posPoints;
          bv = b.posPoints;
          break;
        case 'posTasks':
          av = a.posTasks;
          bv = b.posTasks;
          break;
        case 'sbPoints':
          av = a.sbPoints;
          bv = b.sbPoints;
          break;
        case 'sbTasks':
          av = a.sbTasks;
          bv = b.sbTasks;
          break;
        case 'khqrPoints':
          av = a.khqrPoints;
          bv = b.khqrPoints;
          break;
        case 'khqrTasks':
          av = a.khqrTasks;
          bv = b.khqrTasks;
          break;
        case 'ccPoints':
          av = a.ccPoints;
          bv = b.ccPoints;
          break;
        case 'ccTasks':
          av = a.ccTasks;
          bv = b.ccTasks;
          break;
        case 'mvPoints':
          av = a.mvPoints;
          bv = b.mvPoints;
          break;
        case 'mvTasks':
          av = a.mvTasks;
          bv = b.mvTasks;
          break;
        case 'totalTasks':
          av = a.totalTasks;
          bv = b.totalTasks;
          break;
        case 'ptsPerStaff':
          av = a.ptsPerStaff;
          bv = b.ptsPerStaff;
          break;
        case 'tasksPerStaff':
          av = a.tasksPerStaff;
          bv = b.tasksPerStaff;
          break;
        case 'totalPoints':
          av = a.totalPoints;
          bv = b.totalPoints;
          break;
        case 'growthPct':
          av = a.growthPct ?? -9999;
          bv = b.growthPct ?? -9999;
          break;
        case 'period':
        default:
          av = a.period;
          bv = b.period;
          break;
      }
      if (typeof av === 'string') {
        const cmp = String(av).localeCompare(String(bv));
        return timelineSortDir === 'asc' ? cmp : -cmp;
      }
      const numA = Number(av) || 0;
      const numB = Number(bv) || 0;
      return timelineSortDir === 'asc' ? numA - numB : numB - numA;
    });
  }, [data, granularity, period, range, ruleMap, timelineSortKey, timelineSortDir, ppDirectoryScope, totals, isAdmin, userBranchId, branchFilter, isTaskMode]);

  const subCategoryBreakdown = useMemo(() => {
    const r = totals.raw;
    const items: { code: string; category: KpiCategory; label: string; count: number; unitPts: number; points: number; unit: string }[] = [
      { code: 'POS_INSTALL', category: 'POS Terminal', label: ruleMap.get('POS_INSTALL')?.subCategory || 'POS New Installation', count: r.posInstall, unitPts: rulePts(ruleMap, 'POS_INSTALL'), points: r.posInstall * rulePts(ruleMap, 'POS_INSTALL'), unit: 'terminals' },
      { code: 'POS_REPLACE', category: 'POS Terminal', label: ruleMap.get('POS_REPLACE')?.subCategory || 'POS Replacement / Swap', count: r.posReplace, unitPts: rulePts(ruleMap, 'POS_REPLACE'), points: r.posReplace * rulePts(ruleMap, 'POS_REPLACE'), unit: 'swaps' },
      { code: 'POS_BATTERY', category: 'POS Terminal', label: ruleMap.get('POS_BATTERY')?.subCategory || 'POS Battery Replacement', count: r.posBattery, unitPts: rulePts(ruleMap, 'POS_BATTERY'), points: r.posBattery * rulePts(ruleMap, 'POS_BATTERY'), unit: 'batteries' },
      { code: 'POS_MAINT', category: 'POS Terminal', label: ruleMap.get('POS_MAINT')?.subCategory || 'POS Operational Support', count: Number(r.extra?.['POS_MAINT']) || Number(r.posMaint) || 0, unitPts: rulePts(ruleMap, 'POS_MAINT'), points: (Number(r.extra?.['POS_MAINT']) || Number(r.posMaint) || 0) * rulePts(ruleMap, 'POS_MAINT'), unit: 'visits' },
      { code: 'POS_OP_INSPECT', category: 'POS Terminal', label: ruleMap.get('POS_OP_INSPECT')?.subCategory || 'POS Terminal Inspection', count: Number(r.extra?.['POS_OP_INSPECT']) || 0, unitPts: rulePts(ruleMap, 'POS_OP_INSPECT'), points: (Number(r.extra?.['POS_OP_INSPECT']) || 0) * rulePts(ruleMap, 'POS_OP_INSPECT'), unit: 'visits' },
      { code: 'POS_OP_TRAIN', category: 'POS Terminal', label: ruleMap.get('POS_OP_TRAIN')?.subCategory || 'Refreshment Training', count: Number(r.extra?.['POS_OP_TRAIN']) || 0, unitPts: rulePts(ruleMap, 'POS_OP_TRAIN'), points: (Number(r.extra?.['POS_OP_TRAIN']) || 0) * rulePts(ruleMap, 'POS_OP_TRAIN'), unit: 'visits' },
      { code: 'POS_OP_PAPER', category: 'POS Terminal', label: ruleMap.get('POS_OP_PAPER')?.subCategory || 'Request Paper Roll', count: Number(r.extra?.['POS_OP_PAPER']) || 0, unitPts: rulePts(ruleMap, 'POS_OP_PAPER'), points: (Number(r.extra?.['POS_OP_PAPER']) || 0) * rulePts(ruleMap, 'POS_OP_PAPER'), unit: 'visits' },
      { code: 'POS_OP_ADD_MAT', category: 'POS Terminal', label: ruleMap.get('POS_OP_ADD_MAT')?.subCategory || 'Request Add Material', count: Number(r.extra?.['POS_OP_ADD_MAT']) || 0, unitPts: rulePts(ruleMap, 'POS_OP_ADD_MAT'), points: (Number(r.extra?.['POS_OP_ADD_MAT']) || 0) * rulePts(ruleMap, 'POS_OP_ADD_MAT'), unit: 'visits' },
      { code: 'POS_OP_RET_MAT', category: 'POS Terminal', label: ruleMap.get('POS_OP_RET_MAT')?.subCategory || 'Request Return Materials', count: Number(r.extra?.['POS_OP_RET_MAT']) || 0, unitPts: rulePts(ruleMap, 'POS_OP_RET_MAT'), points: (Number(r.extra?.['POS_OP_RET_MAT']) || 0) * rulePts(ruleMap, 'POS_OP_RET_MAT'), unit: 'visits' },
      { code: 'POS_OP_OTHERS', category: 'POS Terminal', label: ruleMap.get('POS_OP_OTHERS')?.subCategory || 'Others (POS Support)', count: Number(r.extra?.['POS_OP_OTHERS']) || 0, unitPts: rulePts(ruleMap, 'POS_OP_OTHERS'), points: (Number(r.extra?.['POS_OP_OTHERS']) || 0) * rulePts(ruleMap, 'POS_OP_OTHERS'), unit: 'visits' },
      { code: 'POS_INACTIVE', category: 'POS Terminal', label: ruleMap.get('POS_INACTIVE')?.subCategory || 'POS In-Active Maintenance', count: Number(r.extra?.['POS_INACTIVE']) || Number(r.posInactive) || 0, unitPts: rulePts(ruleMap, 'POS_INACTIVE'), points: (Number(r.extra?.['POS_INACTIVE']) || Number(r.posInactive) || 0) * rulePts(ruleMap, 'POS_INACTIVE'), unit: 'visits' },
      { code: 'POS_RETURN', category: 'POS Terminal', label: ruleMap.get('POS_RETURN')?.subCategory || 'POS Return & Terminate', count: Number(r.extra?.['POS_RETURN']) || Number(r.posReturn) || 0, unitPts: rulePts(ruleMap, 'POS_RETURN'), points: (Number(r.extra?.['POS_RETURN']) || Number(r.posReturn) || 0) * rulePts(ruleMap, 'POS_RETURN'), unit: 'terminals' },
      { code: 'POS_ADAPTOR', category: 'POS Terminal', label: ruleMap.get('POS_ADAPTOR')?.subCategory || 'POS AC Adaptor Delivery', count: Number(r.extra?.['POS_ADAPTOR']) || Number(r.posAdaptor) || 0, unitPts: rulePts(ruleMap, 'POS_ADAPTOR'), points: (Number(r.extra?.['POS_ADAPTOR']) || Number(r.posAdaptor) || 0) * rulePts(ruleMap, 'POS_ADAPTOR'), unit: 'adaptors' },
      { code: 'POS_STAND', category: 'POS Terminal', label: ruleMap.get('POS_STAND')?.subCategory || 'POS Stand Setup', count: Number(r.extra?.['POS_STAND']) || Number(r.posStand) || 0, unitPts: rulePts(ruleMap, 'POS_STAND'), points: (Number(r.extra?.['POS_STAND']) || Number(r.posStand) || 0) * rulePts(ruleMap, 'POS_STAND'), unit: 'stands' },
      { code: 'POS_DOCK', category: 'POS Terminal', label: ruleMap.get('POS_DOCK')?.subCategory || 'Charging Dock Installation', count: Number(r.extra?.['POS_DOCK']) || Number(r.posDock) || 0, unitPts: rulePts(ruleMap, 'POS_DOCK'), points: (Number(r.extra?.['POS_DOCK']) || Number(r.posDock) || 0) * rulePts(ruleMap, 'POS_DOCK'), unit: 'docks' },
      { code: 'SB_INSTALL', category: 'Sound Box', label: ruleMap.get('SB_INSTALL')?.subCategory || 'Sound Box New Installation', count: r.sbInstall, unitPts: rulePts(ruleMap, 'SB_INSTALL'), points: r.sbInstall * rulePts(ruleMap, 'SB_INSTALL'), unit: 'units' },
      { code: 'SB_REPLACE', category: 'Sound Box', label: ruleMap.get('SB_REPLACE')?.subCategory || 'Sound Box Replacement / Swap', count: r.sbReplace, unitPts: rulePts(ruleMap, 'SB_REPLACE'), points: r.sbReplace * rulePts(ruleMap, 'SB_REPLACE'), unit: 'swaps' },
      { code: 'SB_MAINTENANCE', category: 'Sound Box', label: ruleMap.get('SB_MAINTENANCE')?.subCategory || 'Sound Box Maintenance', count: Number(r.extra?.['SB_MAINTENANCE']) || 0, unitPts: rulePts(ruleMap, 'SB_MAINTENANCE'), points: (Number(r.extra?.['SB_MAINTENANCE']) || 0) * rulePts(ruleMap, 'SB_MAINTENANCE'), unit: 'visits' },
      { code: 'SB_MAINT', category: 'Sound Box', label: ruleMap.get('SB_MAINT')?.subCategory || 'Sound Box Operational Support', count: r.sbMaint, unitPts: rulePts(ruleMap, 'SB_MAINT'), points: r.sbMaint * rulePts(ruleMap, 'SB_MAINT'), unit: 'visits' },
      { code: 'SB_OP_INSPECT', category: 'Sound Box', label: ruleMap.get('SB_OP_INSPECT')?.subCategory || 'SB Inspection', count: Number(r.extra?.['SB_OP_INSPECT']) || 0, unitPts: rulePts(ruleMap, 'SB_OP_INSPECT'), points: (Number(r.extra?.['SB_OP_INSPECT']) || 0) * rulePts(ruleMap, 'SB_OP_INSPECT'), unit: 'visits' },
      { code: 'SB_OP_TRAIN', category: 'Sound Box', label: ruleMap.get('SB_OP_TRAIN')?.subCategory || 'SB Refresh Training', count: Number(r.extra?.['SB_OP_TRAIN']) || 0, unitPts: rulePts(ruleMap, 'SB_OP_TRAIN'), points: (Number(r.extra?.['SB_OP_TRAIN']) || 0) * rulePts(ruleMap, 'SB_OP_TRAIN'), unit: 'visits' },
      { code: 'SB_OP_BATTERY', category: 'Sound Box', label: ruleMap.get('SB_OP_BATTERY')?.subCategory || 'Battery Replacement', count: Number(r.extra?.['SB_OP_BATTERY']) || 0, unitPts: rulePts(ruleMap, 'SB_OP_BATTERY'), points: (Number(r.extra?.['SB_OP_BATTERY']) || 0) * rulePts(ruleMap, 'SB_OP_BATTERY'), unit: 'batteries' },
      { code: 'SB_OP_ADD_MAT', category: 'Sound Box', label: ruleMap.get('SB_OP_ADD_MAT')?.subCategory || 'Add Material', count: Number(r.extra?.['SB_OP_ADD_MAT']) || 0, unitPts: rulePts(ruleMap, 'SB_OP_ADD_MAT'), points: (Number(r.extra?.['SB_OP_ADD_MAT']) || 0) * rulePts(ruleMap, 'SB_OP_ADD_MAT'), unit: 'visits' },
      { code: 'SB_OP_RET_MAT', category: 'Sound Box', label: ruleMap.get('SB_OP_RET_MAT')?.subCategory || 'Returns Material', count: Number(r.extra?.['SB_OP_RET_MAT']) || 0, unitPts: rulePts(ruleMap, 'SB_OP_RET_MAT'), points: (Number(r.extra?.['SB_OP_RET_MAT']) || 0) * rulePts(ruleMap, 'SB_OP_RET_MAT'), unit: 'visits' },
      { code: 'SB_OP_OTHERS', category: 'Sound Box', label: ruleMap.get('SB_OP_OTHERS')?.subCategory || 'Others (SB Support)', count: Number(r.extra?.['SB_OP_OTHERS']) || 0, unitPts: rulePts(ruleMap, 'SB_OP_OTHERS'), points: (Number(r.extra?.['SB_OP_OTHERS']) || 0) * rulePts(ruleMap, 'SB_OP_OTHERS'), unit: 'visits' },
      { code: 'SB_RETURN', category: 'Sound Box', label: ruleMap.get('SB_RETURN')?.subCategory || 'Sound Box Return / Recovery', count: r.sbReturn, unitPts: rulePts(ruleMap, 'SB_RETURN'), points: r.sbReturn * rulePts(ruleMap, 'SB_RETURN'), unit: 'units' },
      { code: 'SB_ADAPTOR', category: 'Sound Box', label: ruleMap.get('SB_ADAPTOR')?.subCategory || 'Sound Box AC Adaptor Delivery', count: Number(r.extra?.['SB_ADAPTOR']) || Number(r.sbAdaptor) || 0, unitPts: rulePts(ruleMap, 'SB_ADAPTOR'), points: (Number(r.extra?.['SB_ADAPTOR']) || Number(r.sbAdaptor) || 0) * rulePts(ruleMap, 'SB_ADAPTOR'), unit: 'adaptors' },
      { code: 'KHQR_INSTALL', category: 'KHQR', label: ruleMap.get('KHQR_INSTALL')?.subCategory || 'KHQR New Installation', count: r.khqrInstall, unitPts: rulePts(ruleMap, 'KHQR_INSTALL'), points: r.khqrInstall * rulePts(ruleMap, 'KHQR_INSTALL'), unit: 'merchants' },
      { code: 'KHQR_REPLACE', category: 'KHQR', label: ruleMap.get('KHQR_REPLACE')?.subCategory || 'KHQR Replacement', count: r.khqrReplace, unitPts: rulePts(ruleMap, 'KHQR_REPLACE'), points: r.khqrReplace * rulePts(ruleMap, 'KHQR_REPLACE'), unit: 'merchants' },
      { code: 'KHQR_MATERIAL', category: 'KHQR', label: ruleMap.get('KHQR_MATERIAL')?.subCategory || 'QR Material Scanned (Bonus)', count: r.khqrMaterials, unitPts: rulePts(ruleMap, 'KHQR_MATERIAL'), points: r.khqrMaterials * rulePts(ruleMap, 'KHQR_MATERIAL'), unit: 'QR items' },
      { code: 'KHQR_PRINT_LAMINATE', category: 'KHQR', label: ruleMap.get('KHQR_PRINT_LAMINATE')?.subCategory || 'KHQR Print & Laminate', count: r.khqrInstall + r.khqrReplace, unitPts: rulePts(ruleMap, 'KHQR_PRINT_LAMINATE'), points: (r.khqrInstall + r.khqrReplace) * rulePts(ruleMap, 'KHQR_PRINT_LAMINATE'), unit: 'submissions' },
      { code: 'KHQR_ONBOARD_FAIL', category: 'KHQR', label: ruleMap.get('KHQR_ONBOARD_FAIL')?.subCategory || 'KHQR Onboarding Failed', count: Number(r.extra?.['KHQR_ONBOARD_FAIL']) || 0, unitPts: rulePts(ruleMap, 'KHQR_ONBOARD_FAIL'), points: (Number(r.extra?.['KHQR_ONBOARD_FAIL']) || 0) * rulePts(ruleMap, 'KHQR_ONBOARD_FAIL'), unit: 'attempts' },
      { code: 'CC_PRIMARY', category: 'Credit Card', label: ruleMap.get('CC_PRIMARY')?.subCategory || 'Primary Credit Card Onboarded', count: r.ccPrimary, unitPts: rulePts(ruleMap, 'CC_PRIMARY'), points: r.ccPrimary * rulePts(ruleMap, 'CC_PRIMARY'), unit: 'cards' },
      { code: 'CC_SUPP', category: 'Credit Card', label: ruleMap.get('CC_SUPP')?.subCategory || 'Supplementary Card Onboarded', count: r.ccSupp, unitPts: rulePts(ruleMap, 'CC_SUPP'), points: r.ccSupp * rulePts(ruleMap, 'CC_SUPP'), unit: 'supp. cards' },
      { code: 'CC_ONBOARD_FAIL', category: 'Credit Card', label: ruleMap.get('CC_ONBOARD_FAIL')?.subCategory || 'Credit Card Onboarding Failed', count: Number(r.extra?.['CC_ONBOARD_FAIL']) || 0, unitPts: rulePts(ruleMap, 'CC_ONBOARD_FAIL'), points: (Number(r.extra?.['CC_ONBOARD_FAIL']) || 0) * rulePts(ruleMap, 'CC_ONBOARD_FAIL'), unit: 'applications' },
      { code: 'MV_ONBOARD_FAIL', category: 'Merchant Visit', label: ruleMap.get('MV_ONBOARD_FAIL')?.subCategory || 'Merchant Onboarding Failed', count: Number(r.extra?.['MV_ONBOARD_FAIL']) || 0, unitPts: rulePts(ruleMap, 'MV_ONBOARD_FAIL'), points: (Number(r.extra?.['MV_ONBOARD_FAIL']) || 0) * rulePts(ruleMap, 'MV_ONBOARD_FAIL'), unit: 'visits' },
    ];
    const seenCodes = new Set(items.map((it) => it.code));
    for (const [code, count] of Object.entries(r.extra || {})) {
      if (!count || seenCodes.has(code)) continue;
      const rule = ruleMap.get(code);
      const category: KpiCategory =
        rule?.category ||
        (code.startsWith('MV_')
          ? 'Merchant Visit'
          : code.startsWith('POS_')
          ? 'POS Terminal'
          : code.startsWith('SB_')
          ? 'Sound Box'
          : 'Other');
      const label = rule?.subCategory || code.replace(/^MV_|^POS_|^SB_/, '').replace(/_/g, ' ');
      const unitPts = rulePts(ruleMap, code) || (rule?.points ?? 1);
      const points = count * unitPts;
      const unit = rule?.unit || 'visits';
      items.push({ code, category, label, count, unitPts, points, unit });
    }
    // (22 Nov 2026) Booth Event / Standby VIP: the points that make each booth day follow the Settings rule (shared by tag,
    // or the higher of the booth points and own points). Negative when the tasks done at the booth were already counted above.
    const adj = Math.round((Number(r.adjPts) || 0) * 100) / 100;
    if (adj) items.push({ code: 'BOOTH_STANDBY_ADJ', category: 'Merchant Visit', label: 'Booth / Standby VIP sharing adjustment', count: 0, unitPts: 0, points: adj, unit: 'points' });
    return items
      .map((it) => ({ ...it, points: Math.round(it.points * 100) / 100 }))
      .sort((a, b) => b.points - a.points || b.count - a.count);
  }, [totals.raw, ruleMap]);

  const activeSubCategoryCount = useMemo(() => {
    const list = categoryFilter === 'ALL'
      ? subCategoryBreakdown
      : subCategoryBreakdown.filter((sc) => sc.category === categoryFilter);
    return list.filter((sc) => sc.points !== 0 || sc.count > 0).length;
  }, [subCategoryBreakdown, categoryFilter]);

  const totalInSelectedCategory = useMemo(() => {
    return categoryFilter === 'ALL'
      ? subCategoryBreakdown.length
      : subCategoryBreakdown.filter((sc) => sc.category === categoryFilter).length;
  }, [subCategoryBreakdown, categoryFilter]);

  const displayedSubCategories = useMemo(() => {
    if (!showSubCategories) return [];
    let list = subCategoryBreakdown;
    if (categoryFilter !== 'ALL') {
      list = list.filter((sc) => sc.category === categoryFilter);
    }
    if (subCatActiveOnly) {
      list = list.filter((sc) => sc.points !== 0 || sc.count > 0);
    }
    const q = subCatSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (sc) =>
          sc.label.toLowerCase().includes(q) ||
          sc.category.toLowerCase().includes(q) ||
          sc.code.toLowerCase().includes(q) ||
          sc.unit.toLowerCase().includes(q)
      );
    }
    if (subCatRankBy === 'tasks') {
      return [...list].sort(
        (a, b) => subCatTaskVolume(b) - subCatTaskVolume(a) || b.points - a.points || b.count - a.count
      );
    }
    return list;
  }, [showSubCategories, subCategoryBreakdown, categoryFilter, subCatActiveOnly, subCatSearch, subCatRankBy]);

  const displayedSubCategoryPoints = useMemo(() => {
    return displayedSubCategories.reduce((acc, sc) => acc + sc.points, 0);
  }, [displayedSubCategories]);

  const displayedSubCategoryTasks = useMemo(() => {
    return displayedSubCategories.reduce((acc, sc) => acc + subCatTaskVolume(sc), 0);
  }, [displayedSubCategories]);

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    (data?.monthly || []).forEach((m) => { if (m.period) set.add(m.period); });
    (data?.monthlyStaff || []).forEach((m) => { if (m.month) set.add(m.month); });
    (data?.dailyBranch || []).forEach((d) => {
      if (d.day && d.day.length >= 7) set.add(d.day.substring(0, 7));
    });
    (data?.dailyStaff || []).forEach((d) => {
      if (d.day && d.day.length >= 7) set.add(d.day.substring(0, 7));
    });
    const now = new Date();
    set.add(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [data?.monthly, data?.monthlyStaff, data?.dailyBranch, data?.dailyStaff]);

  const dailyBranchMap = useMemo(() => {
    const map = new Map<string, KpiDailyBranchRaw>();
    if (tableMode !== 'branch' || branchSubView !== 'daily') return map;
    if (Array.isArray(data?.dailyBranch)) {
      for (const item of data.dailyBranch) {
        map.set(`${item.branchId}__${item.day}`, item);
      }
    }
    return map;
  }, [tableMode, branchSubView, data?.dailyBranch]);

  const matrixDaysMap = useMemo(() => {
    const map = new Map<number, (typeof matrixDays)[number]>();
    for (const d of matrixDays) {
      map.set(d.dayNum, d);
    }
    return map;
  }, [matrixDays]);

  const dailyBranchRows = useMemo(() => {
    if (tableMode !== 'branch' || branchSubView !== 'daily') return [];
    // Effective work days in this selected month (Mon-Fri excluding Cambodian public holidays)
    const workDays = monthWorkDaysSummary.workDays > 0 ? monthWorkDaysSummary.workDays : (data?.targets?.workDaysInMonth ?? 21);
    const staffDailyTarget = data?.targets?.staffDailyTarget ?? 5;
    const staffMonthlyTarget = Math.round(staffDailyTarget * workDays);

    return filteredBranches.map((b) => {
      let monthTotal = 0; // KPI eligible tasks (only on official work days)
      let allDaysTotal = 0; // raw sum of all calendar days
      let weekendHolidayTasks = 0;

      const days = matrixDays.map((d) => {
        const item = dailyBranchMap.get(`${b.branchId}__${d.isoDay}`);
        const count = item?.totalTasks ?? 0;
        allDaysTotal += count;
        if (d.isWorkDay) {
          monthTotal += count;
        } else {
          weekendHolidayTasks += count;
        }
        return {
          dayNum: d.dayNum,
          isoDay: d.isoDay,
          count,
          raw: item,
          isWorkDay: d.isWorkDay,
          isWeekend: d.isWeekend,
          isHoliday: d.isHoliday,
          holidayName: d.holidayName,
        };
      });

      // Branch target dynamically follows Individual Target multiplied by number of staff in branch
      const staffCount = Math.max(1, b.staffCount);
      const bDailyTarget = staffDailyTarget * staffCount;
      const bMonthlyTarget = staffMonthlyTarget * staffCount;

      const dailyAvg = workDays > 0 ? Math.round((monthTotal / workDays) * 10) / 10 : 0;
      const targetPct = bMonthlyTarget > 0 ? Math.round((monthTotal / bMonthlyTarget) * 100) : 0;

      // Pacing target: elapsed work days × daily target (e.g. yesterday got 25 = 100% pacing -> Meet Target)
      const pacingTarget = Math.max(1, bDailyTarget * pacingInfo.elapsedWorkDays);
      const pacingPct = pacingTarget > 0 ? Math.round((monthTotal / pacingTarget) * 100) : 0;
      const rating = getKpiRating(pacingPct);

      return {
        branchId: b.branchId,
        branchName: b.branchName,
        staffCount: b.staffCount,
        days,
        monthTotalTasks: monthTotal,
        allDaysTotal,
        weekendHolidayTasks,
        dailyAvg,
        target: bMonthlyTarget,
        dailyTarget: bDailyTarget,
        pacingTarget,
        targetPct,
        pacingPct,
        rating,
      };
    });
  }, [tableMode, branchSubView, filteredBranches, matrixDays, dailyBranchMap, data?.targets, monthWorkDaysSummary, pacingInfo]);

  const matrixDayTotals = useMemo(() => {
    if (dailyBranchRows.length === 0) {
      return { totalsByDay: {}, allGrandTotal: 0, avgDailyTotal: 0 };
    }
    const totalsByDay: { [dayNum: number]: number } = {};
    let allGrandTotal = 0;
    matrixDays.forEach((d) => { totalsByDay[d.dayNum] = 0; });

    for (const row of dailyBranchRows) {
      allGrandTotal += row.monthTotalTasks;
      for (const d of row.days) {
        totalsByDay[d.dayNum] += d.count;
      }
    }

    const workDays = monthWorkDaysSummary.workDays > 0 ? monthWorkDaysSummary.workDays : (data?.targets?.workDaysInMonth ?? 21);
    const avgDailyTotal = workDays > 0 ? Math.round((allGrandTotal / workDays) * 10) / 10 : 0;

    return {
      totalsByDay,
      allGrandTotal,
      avgDailyTotal,
    };
  }, [dailyBranchRows, matrixDays, monthWorkDaysSummary, data?.targets?.workDaysInMonth]);

  const sortedDailyBranchRows = useMemo(() => {
    return [...dailyBranchRows].sort((a, b) => {
      let cmp = 0;
      if (dailySortKey.startsWith('day_')) {
        const dNum = parseInt(dailySortKey.replace('day_', ''), 10);
        const countA = a.days[dNum - 1]?.count ?? 0;
        const countB = b.days[dNum - 1]?.count ?? 0;
        cmp = countA - countB;
      } else if (dailySortKey === 'branchId') {
        cmp = a.branchId.localeCompare(b.branchId, 'en', { numeric: true });
      } else if (dailySortKey === 'branchName') {
        cmp = a.branchName.localeCompare(b.branchName);
      } else if (dailySortKey === 'dailyAvg') {
        cmp = a.dailyAvg - b.dailyAvg;
      } else if (dailySortKey === 'targetPct') {
        cmp = a.targetPct - b.targetPct;
      } else {
        cmp = a.monthTotalTasks - b.monthTotalTasks;
      }
      return dailySortDir === 'asc' ? cmp : -cmp;
    });
  }, [dailyBranchRows, dailySortKey, dailySortDir]);

  const dailyBranchPg = usePager(sortedDailyBranchRows.length, [dailyMatrixMonth, branchFilter, categoryFilter, deferredQuery]);

  const stepDailyMonth = (direction: -1 | 1) => {
    const [yStr, mStr] = (dailyMatrixMonth || '').split('-');
    const curYear = parseInt(yStr, 10) || new Date().getFullYear();
    const curMonth = parseInt(mStr, 10) || (new Date().getMonth() + 1);
    const dateObj = new Date(curYear, curMonth - 1 + direction, 1);
    const newMonthStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
    startMatrixTransition(() => setDailyMatrixMonth(newMonthStr));
  };

  const exportDailyBranchCsv = async () => {
    if (!filteredBranches.length) return 0;
    const header = [
      'No.',
      'Branch Name',
      'Branch Code',
      ...matrixDays.map((d) =>
        d.isHoliday
          ? `${d.dayNum} (${d.dayOfWeek} · HOL - ${d.holidayName})`
          : d.isWeekend
          ? `${d.dayNum} (${d.dayOfWeek} · Weekend)`
          : `${d.dayNum} (${d.dayOfWeek})`
      ),
      'Month KPI Tasks (Work Days)',
      'Daily Average (per work day)',
      'Monthly Target',
      'Achievement %',
      'Performance',
    ];
    const rows = sortedDailyBranchRows.map((r, i) => [
      i + 1,
      r.branchName,
      r.branchId,
      ...r.days.map((d) => d.count),
      r.monthTotalTasks,
      r.dailyAvg,
      r.target,
      `${r.targetPct}%`,
      r.rating,
    ]);

    // Footer summary row
    rows.push([
      'Total',
      'Total Across All Branches (Work Days KPI)',
      'ALL',
      ...matrixDays.map((d) => matrixDayTotals.totalsByDay[d.dayNum] || 0),
      matrixDayTotals.allGrandTotal,
      matrixDayTotals.avgDailyTotal,
      '',
      '',
      '',
    ]);

    downloadCsv(`KPI_Daily_Tasks_Branch_${dailyMatrixMonth}`, header, rows);
    return filteredBranches.length;
  };

  const dailyStaffMap = useMemo(() => {
    const map = new Map<string, KpiDailyStaffRaw>();
    if (tableMode !== 'staff' || staffSubView !== 'daily') return map;
    if (Array.isArray(data?.dailyStaff)) {
      for (const item of data.dailyStaff) {
        map.set(`${item.staffId}__${item.day}`, item);
      }
    }
    return map;
  }, [tableMode, staffSubView, data?.dailyStaff]);

  const dailyStaffRows = useMemo(() => {
    if (tableMode !== 'staff' || staffSubView !== 'daily') return [];
    const workDays = monthWorkDaysSummary.workDays > 0 ? monthWorkDaysSummary.workDays : (data?.targets?.workDaysInMonth ?? 21);
    const staffDailyTarget = data?.targets?.staffDailyTarget ?? 5;
    const monthlyTarget = Math.round(staffDailyTarget * workDays);

    return filteredStaff.map((s) => {
      let monthTotal = 0;
      let allDaysTotal = 0;
      let weekendHolidayTasks = 0;

      const days = matrixDays.map((d) => {
        const item = dailyStaffMap.get(`${s.staffId}__${d.isoDay}`);
        const count = item?.totalTasks ?? 0;
        allDaysTotal += count;
        if (d.isWorkDay) {
          monthTotal += count;
        } else {
          weekendHolidayTasks += count;
        }
        return {
          dayNum: d.dayNum,
          isoDay: d.isoDay,
          count,
          raw: item,
          isWorkDay: d.isWorkDay,
          isWeekend: d.isWeekend,
          isHoliday: d.isHoliday,
          holidayName: d.holidayName,
        };
      });

      const isManagement = s.isManagement;
      const dailyAvg = workDays > 0 ? Math.round((monthTotal / workDays) * 10) / 10 : 0;
      const targetPct = isManagement ? 0 : (monthlyTarget > 0 ? Math.round((monthTotal / monthlyTarget) * 100) : 0);

      // Pacing target: elapsed work days × daily target
      const pacingStaffTarget = Math.max(1, staffDailyTarget * pacingInfo.elapsedWorkDays);
      const pacingPct = isManagement ? 0 : (pacingStaffTarget > 0 ? Math.round((monthTotal / pacingStaffTarget) * 100) : 0);
      const rating = getKpiRating(pacingPct, isManagement);

      return {
        staffId: s.staffId,
        staffName: s.staffName,
        position: s.position,
        isManagement,
        branchId: s.branchId,
        branchName: s.branchName,
        days,
        monthTotalTasks: monthTotal,
        allDaysTotal,
        weekendHolidayTasks,
        dailyAvg,
        target: isManagement ? 0 : monthlyTarget,
        dailyTarget: staffDailyTarget,
        pacingTarget: pacingStaffTarget,
        targetPct,
        pacingPct,
        rating,
      };
    });
  }, [tableMode, staffSubView, filteredStaff, matrixDays, dailyStaffMap, data?.targets, monthWorkDaysSummary, pacingInfo]);

  const matrixStaffDayTotals = useMemo(() => {
    if (dailyStaffRows.length === 0) {
      return { totalsByDay: {}, allGrandTotal: 0, avgDailyTotal: 0 };
    }
    const totalsByDay: { [dayNum: number]: number } = {};
    let allGrandTotal = 0;
    matrixDays.forEach((d) => { totalsByDay[d.dayNum] = 0; });

    for (const row of dailyStaffRows) {
      allGrandTotal += row.monthTotalTasks;
      for (const d of row.days) {
        totalsByDay[d.dayNum] += d.count;
      }
    }

    const workDays = monthWorkDaysSummary.workDays > 0 ? monthWorkDaysSummary.workDays : (data?.targets?.workDaysInMonth ?? 21);
    const avgDailyTotal = workDays > 0 ? Math.round((allGrandTotal / workDays) * 10) / 10 : 0;

    return {
      totalsByDay,
      allGrandTotal,
      avgDailyTotal,
    };
  }, [dailyStaffRows, matrixDays, monthWorkDaysSummary, data?.targets?.workDaysInMonth]);

  const sortedDailyStaffRows = useMemo(() => {
    return [...dailyStaffRows].sort((a, b) => {
      let cmp = 0;
      if (dailyStaffSortKey.startsWith('day_')) {
        const dNum = parseInt(dailyStaffSortKey.replace('day_', ''), 10);
        const countA = a.days[dNum - 1]?.count ?? 0;
        const countB = b.days[dNum - 1]?.count ?? 0;
        cmp = countA - countB;
      } else if (dailyStaffSortKey === 'staffId') {
        cmp = a.staffId.localeCompare(b.staffId, 'en', { numeric: true });
      } else if (dailyStaffSortKey === 'staffName') {
        cmp = a.staffName.localeCompare(b.staffName);
      } else if (dailyStaffSortKey === 'branchId') {
        cmp = a.branchId.localeCompare(b.branchId, 'en', { numeric: true });
      } else if (dailyStaffSortKey === 'dailyAvg') {
        cmp = a.dailyAvg - b.dailyAvg;
      } else if (dailyStaffSortKey === 'targetPct') {
        cmp = a.targetPct - b.targetPct;
      } else {
        cmp = a.monthTotalTasks - b.monthTotalTasks;
      }
      return dailyStaffSortDir === 'asc' ? cmp : -cmp;
    });
  }, [dailyStaffRows, dailyStaffSortKey, dailyStaffSortDir]);

  const dailyStaffPg = usePager(sortedDailyStaffRows.length, [dailyMatrixMonth, branchFilter, categoryFilter, deferredQuery]);

  const exportDailyStaffCsv = async () => {
    if (!filteredStaff.length) return 0;
    const header = [
      'No.',
      'Staff Name',
      'Staff ID',
      'Position',
      'Role / Level',
      'Branch Name',
      'Branch Code',
      ...matrixDays.map((d) =>
        d.isHoliday
          ? `${d.dayNum} (${d.dayOfWeek} · HOL - ${d.holidayName})`
          : d.isWeekend
          ? `${d.dayNum} (${d.dayOfWeek} · Weekend)`
          : `${d.dayNum} (${d.dayOfWeek})`
      ),
      'Month KPI Tasks (Work Days)',
      'Daily Average (per work day)',
      'Monthly Target',
      'Achievement %',
      'Performance',
    ];
    const rows = sortedDailyStaffRows.map((r, i) => [
      i + 1,
      r.staffName,
      r.staffId,
      r.position || '—',
      r.isManagement ? 'Management (Exempt)' : 'Field Officer',
      cleanBranchName(r.branchName),
      r.branchId,
      ...r.days.map((d) => d.count),
      r.monthTotalTasks,
      r.dailyAvg,
      r.isManagement ? 'Exempt' : r.target,
      r.isManagement ? 'Exempt' : `${r.targetPct}%`,
      r.rating,
    ]);

    // Footer summary row
    rows.push([
      'Total',
      'ALL',
      'Total Across All Staff (Work Days KPI)',
      '',
      '',
      '',
      '',
      ...matrixDays.map((d) => matrixStaffDayTotals.totalsByDay[d.dayNum] || 0),
      matrixStaffDayTotals.allGrandTotal,
      matrixStaffDayTotals.avgDailyTotal,
      '',
      '',
      '',
    ]);

    downloadCsv(`KPI_Daily_Tasks_Staff_${dailyMatrixMonth}`, header, rows);
    return filteredStaff.length;
  };

  const top10Data = useMemo(() => {
    const rankCompare = (a: { totalPoints: number; totalTasks: number }, b: { totalPoints: number; totalTasks: number }) =>
      isTaskMode ? (b.totalTasks - a.totalTasks || b.totalPoints - a.totalPoints) : (b.totalPoints - a.totalPoints || b.totalTasks - a.totalTasks);

    if (selectedTopMonth === 'ALL' || !data) {
      const topBranches = isTaskMode ? [...branchRows].sort(rankCompare).slice(0, 10) : branchRows.slice(0, 10);
      const fieldOnly = enrichedStaff.filter((s) => !s.isManagement);
      const topStaff = isTaskMode ? [...fieldOnly].sort(rankCompare).slice(0, 10) : fieldOnly.slice(0, 10);
      return {
        branches: topBranches,
        staff: topStaff,
      };
    }
    const monthStaff = data.monthlyStaff
      .filter((ms) => ms.month === selectedTopMonth)
      .map((ms) => {
        const dir = ppDirectoryScope.matchPpStaff(ms.staffId, ms.staffName, ms.branchId, ms.branchName);
        if (!dir) return null;
        const canonBranch = dir.branchId || ms.branchId;
        const pts = computeKpiPoints(ms, ruleMap);
        return {
          ...ms,
          staffId: dir.empId || ms.staffId,
          staffName: dir.name || ms.staffName,
          branchId: canonBranch,
          branchName: branchNameMap.get(canonBranch) || ms.branchName || canonBranch,
          isManagement: dir.isManagement,
          ...pts,
        };
      })
      .filter((ms): ms is NonNullable<typeof ms> => ms !== null && ms.totalTasks > 0 && !ms.isManagement)
      .sort(rankCompare);

    const bMap = new Map<string, { branchId: string; branchName: string; staffCount: number; raw: KpiRawCounts }>();
    monthStaff.forEach((s) => {
      const k = s.branchId || 'UNASSIGNED';
      let b = bMap.get(k);
      if (!b) {
        b = {
          branchId: k,
          branchName: branchNameMap.get(k) || s.branchName || 'Unassigned',
          staffCount: 0,
          raw: {
            posInstall: 0, posReplace: 0, posBattery: 0,
            sbInstall: 0, sbReplace: 0, sbMaint: 0, sbReturn: 0,
            khqrInstall: 0, khqrReplace: 0, khqrMaterials: 0,
            ccPrimary: 0, ccSupp: 0,
          },
        };
        bMap.set(k, b);
      }
      b.staffCount += 1;
      b.raw.posInstall += s.posInstall;
      b.raw.posReplace += s.posReplace;
      b.raw.posBattery += s.posBattery;
      b.raw.sbInstall += s.sbInstall;
      b.raw.sbReplace += s.sbReplace;
      b.raw.sbMaint += s.sbMaint;
      b.raw.sbReturn += s.sbReturn;
      b.raw.khqrInstall += s.khqrInstall;
      b.raw.khqrReplace += s.khqrReplace;
      b.raw.khqrMaterials += s.khqrMaterials;
      b.raw.ccPrimary += s.ccPrimary;
      b.raw.ccSupp += s.ccSupp;
      b.raw.adjPts = (b.raw.adjPts || 0) + (s.adjPts || 0);
      addExtraCounts(b.raw, s);
    });

    const monthBranches = Array.from(bMap.values())
      .map((b) => {
        const pts = computeKpiPoints(b.raw, ruleMap);
        return {
          ...b,
          ...pts,
          ptsPerStaff: b.staffCount > 0 ? Math.round((pts.totalPoints / b.staffCount) * 10) / 10 : 0,
          tasksPerStaff: b.staffCount > 0 ? Math.round((pts.totalTasks / b.staffCount) * 10) / 10 : 0,
        };
      })
      .sort(rankCompare);

    return {
      branches: monthBranches.slice(0, 10),
      staff: monthStaff.slice(0, 10),
    };
  }, [selectedTopMonth, data, branchRows, enrichedStaff, ruleMap, branchNameMap, ppDirectoryScope, isTaskMode]);

  // ── Monthly KPI Matrix (12 calendar months Jan–Dec for the selected year, defaulting to current year) ──
  const availableMatrixYears = useMemo(() => {
    const curYear = todayPP().slice(0, 4);
    const yrs = new Set<string>([curYear]);
    (data?.monthlyStaff || []).forEach((m) => {
      if (m.month && /^\d{4}-\d{2}$/.test(m.month) && m.month.slice(0, 4) <= curYear) yrs.add(m.month.slice(0, 4));
    });
    availableMonths.forEach((m) => {
      if (m && /^\d{4}-\d{2}$/.test(m) && m.slice(0, 4) <= curYear) yrs.add(m.slice(0, 4));
    });
    return Array.from(yrs).sort((a, b) => a.localeCompare(b));
  }, [data?.monthlyStaff, availableMonths]);

  const stepMatrixYear = useCallback(
    (dir: -1 | 1) => {
      const idx = availableMatrixYears.indexOf(monthlyMatrixYear);
      const nextIdx = idx + dir;
      if (nextIdx >= 0 && nextIdx < availableMatrixYears.length) {
        startMatrixTransition(() => setMonthlyMatrixYear(availableMatrixYears[nextIdx]));
      }
    },
    [availableMatrixYears, monthlyMatrixYear]
  );

  const monthlyMatrixMonths = useMemo(() => {
    const curYear = todayPP().slice(0, 4);
    const yr = /^\d{4}$/.test(monthlyMatrixYear) ? monthlyMatrixYear : curYear;
    return Array.from({ length: 12 }, (_, idx) => `${yr}-${String(idx + 1).padStart(2, '0')}`);
  }, [monthlyMatrixYear]);

  const monthlyMatrixMeta = useMemo(() => {
    const curYm = todayPP().slice(0, 7);
    const yrPrefix = `${monthlyMatrixMonths[0]?.slice(0, 4) || curYm.slice(0, 4)}-`;
    const staffDailyTarget = data?.targets?.staffDailyTarget ?? 5;
    const configuredMonthlyPts = data?.targets?.staffMonthlyTarget || Math.round(staffDailyTarget * (data?.targets?.workDaysInMonth || 22));

    let firstDataYm = '';
    (data?.monthlyStaff || []).forEach((m) => {
      if (m.month && m.month.startsWith(yrPrefix) && m.month <= curYm) {
        if (!firstDataYm || m.month < firstDataYm) firstDataYm = m.month;
      }
    });

    return monthlyMatrixMonths.map((ym) => {
      const [yStr, mStr] = ym.split('-');
      const yr = parseInt(yStr, 10) || new Date().getFullYear();
      const mo = parseInt(mStr, 10) || (new Date().getMonth() + 1);
      const wd = getMonthWorkDaysSummary(yr, mo);
      const workDays = wd.workDays > 0 ? wd.workDays : (data?.targets?.workDaysInMonth ?? 21);
      const isCurrent = ym === curYm;
      const isFuture = ym > curYm;
      const isBeforeData = Boolean(firstDataYm && ym < firstDataYm);
      const isTrackedElapsed = !isFuture && !isBeforeData;
      const elapsedRatio = isFuture ? 0 : ym < curYm ? 1 : isCurrent ? pacingInfo.pacingRatio : 1;
      const staffTarget = isTaskMode ? Math.round(staffDailyTarget * workDays) : configuredMonthlyPts;
      const staffPacingTarget = Math.max(1, Math.round(staffTarget * (isFuture ? 1 : elapsedRatio)));
      const { shortMonth, year } = monthShortParts(ym);
      return {
        ym,
        shortMonth,
        year,
        fullLabel: fmtMonth(ym),
        workDays,
        isCurrent,
        isFuture,
        isBeforeData,
        isTrackedElapsed,
        elapsedRatio,
        staffTarget,
        staffPacingTarget,
      };
    });
  }, [monthlyMatrixMonths, data?.monthlyStaff, data?.targets, isTaskMode, pacingInfo.pacingRatio]);

  const trackedMatrixMonthCount = useMemo(() => {
    const n = monthlyMatrixMeta.filter((m) => m.isTrackedElapsed).length;
    return n > 0 ? n : Math.max(1, monthlyMatrixMeta.filter((m) => !m.isFuture).length || 1);
  }, [monthlyMatrixMeta]);

  interface MonthlyCellData {
    ym: string;
    val: number;
    points: number;
    tasks: number;
    pts: ReturnType<typeof computeKpiPoints>;
    pct: number;
    pacingPct: number;
    target: number;
  }
  interface MonthlyMatrixRow {
    id: string;
    name: string;
    subLabel: string;
    branchId: string;
    branchName: string;
    isManagement: boolean;
    staffCount: number;
    kpiStaffCount: number;
    cells: MonthlyCellData[];
    cellByMonth: Record<string, MonthlyCellData>;
    total: number;
    totalPoints: number;
    totalTasks: number;
    avgPerMonth: number;
    targetPerMonth: number;
    targetPct: number;
    pacingPct: number;
    cumulativeTarget: number;
    cumulativePacingTarget: number;
    rating: KpiRating;
    rawTotal: KpiRawCounts;
  }

  const isMonthlySubView =
    (tableMode === 'branch' && branchSubView === 'monthly') ||
    (tableMode === 'staff' && staffSubView === 'monthly');

  const monthlyMatrixData = useMemo(() => {
    const emptyRes = {
      allStaffRows: [] as MonthlyMatrixRow[],
      staffRows: [] as MonthlyMatrixRow[],
      branchRows: [] as MonthlyMatrixRow[],
      levelCounts: { all: 0, field: 0, management: 0 },
    };
    if (!data || !isMonthlySubView) return emptyRes;

    const monthSet = new Set(monthlyMatrixMeta.map((m) => m.ym));
    const latestMeta = monthlyMatrixMeta[monthlyMatrixMeta.length - 1];
    const staffBuckets = new Map<string, {
      staffId: string;
      staffName: string;
      branchId: string;
      branchName: string;
      position: string;
      isManagement: boolean;
      byMonth: Map<string, KpiRawCounts>;
    }>();

    const ensureStaffEntry = (
      empIdRaw: string,
      nameRaw: string,
      branchIdRaw: string,
      branchNameRaw: string,
      positionRaw?: string,
      isMgtOverride?: boolean
    ) => {
      const key = empIdRaw || nameRaw.toLowerCase();
      if (!key) return null;
      let entry = staffBuckets.get(key);
      if (!entry) {
        const meta = staffMetaMap.get(empIdRaw) || staffMetaMap.get(nameRaw.toLowerCase());
        const isManagement = isMgtOverride ?? meta?.isManagement ?? isStaffManagementExempt(empIdRaw, nameRaw, exemptSet);
        const position = positionRaw || meta?.position || (isManagement ? 'Management' : 'MS Officer');
        const branchId = branchIdRaw || 'UNASSIGNED';
        entry = {
          staffId: empIdRaw,
          staffName: nameRaw || empIdRaw,
          branchId,
          branchName: branchNameMap.get(branchId) || branchNameRaw || branchId,
          position,
          isManagement,
          byMonth: new Map(),
        };
        staffBuckets.set(key, entry);
      }
      return entry;
    };

    ppDirectoryScope.members.forEach((m) => {
      ensureStaffEntry(m.empId, m.name, m.branchId, branchNameMap.get(m.branchId) || m.branchId, m.position, m.isManagement);
    });

    (data.monthlyStaff || []).forEach((ms) => {
      if (!ms.month || !monthSet.has(ms.month)) return;
      const dir = ppDirectoryScope.matchPpStaff(ms.staffId, ms.staffName, ms.branchId, ms.branchName);
      if (!dir) return;
      const canonId = dir.empId || ms.staffId;
      const canonName = dir.name || ms.staffName;
      const canonBranch = dir.branchId || ms.branchId;
      const entry = ensureStaffEntry(canonId, canonName, canonBranch, branchNameMap.get(canonBranch) || ms.branchName || canonBranch, dir.position, dir.isManagement);
      if (!entry) return;
      let mRaw = entry.byMonth.get(ms.month);
      if (!mRaw) {
        mRaw = emptyRawCounts();
        entry.byMonth.set(ms.month, mRaw);
      }
      accumulateRawCounts(mRaw, ms);
    });

    // Also build full scoped staff rows (for branch rollup and Level pill counts)
    const builtStaffAll: MonthlyMatrixRow[] = [];
    const branchAccum = new Map<string, {
      branchId: string;
      branchName: string;
      staffCount: number;
      kpiStaffCount: number;
      byMonth: Map<string, KpiRawCounts>;
    }>();

    branches.filter((b) => isPhnomPenhBranch(b)).forEach((b) => {
      if (!isAdmin && userBranchId && b.id !== userBranchId) return;
      if (branchFilter && b.id !== branchFilter) return;
      branchAccum.set(b.id, {
        branchId: b.id,
        branchName: branchNameMap.get(b.id) || b.name,
        staffCount: 0,
        kpiStaffCount: 0,
        byMonth: new Map(),
      });
    });

    const q = deferredQuery.trim().toLowerCase();

    staffBuckets.forEach((s) => {
      if (!isAdmin && userBranchId && s.branchId !== userBranchId) return;
      if (branchFilter && s.branchId !== branchFilter) return;

      // Roll into branch metrics prior to staff-level/search filtering (unless branch itself was filtered)
      let br = branchAccum.get(s.branchId);
      if (!br && s.branchId) {
        br = {
          branchId: s.branchId,
          branchName: s.branchName,
          staffCount: 0,
          kpiStaffCount: 0,
          byMonth: new Map(),
        };
        branchAccum.set(s.branchId, br);
      }
      if (br) {
        br.staffCount += 1;
        if (!s.isManagement) br.kpiStaffCount += 1;
      }

      const rawTotal = emptyRawCounts();
      const cellByMonth: Record<string, MonthlyCellData> = {};
      let total = 0;
      let totalPoints = 0;
      let totalTasks = 0;
      let cumulativeTarget = 0;
      let cumulativePacingTarget = 0;

      const cells = monthlyMatrixMeta.map((m) => {
        const mRaw = s.byMonth.get(m.ym);
        if (mRaw) {
          accumulateRawCounts(rawTotal, mRaw);
          if (br) {
            let bMonthRaw = br.byMonth.get(m.ym);
            if (!bMonthRaw) {
              bMonthRaw = emptyRawCounts();
              br.byMonth.set(m.ym, bMonthRaw);
            }
            accumulateRawCounts(bMonthRaw, mRaw);
          }
        }
        const pts = computeKpiPoints(mRaw || emptyRawCounts(), ruleMap);
        const val = pickCategoryKpiVal(pts, categoryFilter, isTaskMode);
        const target = s.isManagement ? 0 : m.staffTarget;
        const mPacingTarget = s.isManagement ? 0 : m.staffPacingTarget;
        const pct = target > 0 ? Math.min(999, Math.round((val / target) * 1000) / 10) : 0;
        const pacingPct = mPacingTarget > 0 ? Math.min(999, Math.round((val / mPacingTarget) * 1000) / 10) : 0;

        total += val;
        totalPoints += pts.totalPoints;
        totalTasks += pts.totalTasks;
        if (m.isTrackedElapsed) {
          cumulativeTarget += target;
          cumulativePacingTarget += mPacingTarget;
        }

        const cell: MonthlyCellData = {
          ym: m.ym,
          val: Math.round(val * 100) / 100,
          points: pts.totalPoints,
          tasks: pts.totalTasks,
          pts,
          pct,
          pacingPct,
          target,
        };
        cellByMonth[m.ym] = cell;
        return cell;
      });

      if (q && !`${s.staffId} ${s.staffName} ${s.branchId} ${s.branchName} ${s.position}`.toLowerCase().includes(q)) {
        return;
      }
      if (categoryFilter !== 'ALL' && total === 0) {
        return;
      }

      const activeMeta = monthlyMatrixMeta.filter((m) => m.isTrackedElapsed);
      const refMeta = activeMeta[activeMeta.length - 1] || latestMeta;
      const targetPerMonth = s.isManagement ? 0 : (refMeta?.staffTarget ?? 0);
      const targetPct = s.isManagement
        ? (total > 0 && (refMeta?.staffTarget || 0) > 0 && trackedMatrixMonthCount > 0
            ? Math.min(999, Math.round((total / ((refMeta?.staffTarget || 1) * trackedMatrixMonthCount)) * 1000) / 10)
            : 0)
        : (cumulativeTarget > 0 ? Math.min(999, Math.round((total / cumulativeTarget) * 1000) / 10) : 100);
      const pacingPct = s.isManagement
        ? 0
        : (cumulativePacingTarget > 0 ? Math.min(999, Math.round((total / cumulativePacingTarget) * 1000) / 10) : 100);
      const rating = getKpiRating(pacingPct, s.isManagement);

      builtStaffAll.push({
        id: s.staffId || s.staffName,
        name: s.staffName,
        subLabel: s.position,
        branchId: s.branchId,
        branchName: s.branchName,
        isManagement: s.isManagement,
        staffCount: 1,
        kpiStaffCount: s.isManagement ? 0 : 1,
        cells,
        cellByMonth,
        total: Math.round(total * 100) / 100,
        totalPoints: Math.round(totalPoints * 100) / 100,
        totalTasks,
        avgPerMonth: Math.round((total / trackedMatrixMonthCount) * 10) / 10,
        targetPerMonth,
        targetPct,
        pacingPct,
        cumulativeTarget,
        cumulativePacingTarget,
        rating,
        rawTotal,
      });
    });

    const levelCounts = {
      all: builtStaffAll.length,
      field: builtStaffAll.filter((s) => !s.isManagement).length,
      management: builtStaffAll.filter((s) => s.isManagement).length,
    };

    const staffRows = builtStaffAll.filter((s) => {
      if (staffLevelFilter === 'field' && s.isManagement) return false;
      if (staffLevelFilter === 'management' && !s.isManagement) return false;
      return true;
    });

    const builtBranches: MonthlyMatrixRow[] = [];
    branchAccum.forEach((b) => {
      if (q && !`${b.branchId} ${b.branchName}`.toLowerCase().includes(q)) return;
      const targetStaffMult = Math.max(1, b.kpiStaffCount > 0 ? b.kpiStaffCount : b.staffCount);
      const rawTotal = emptyRawCounts();
      const cellByMonth: Record<string, MonthlyCellData> = {};
      let total = 0;
      let totalPoints = 0;
      let totalTasks = 0;
      let cumulativeTarget = 0;
      let cumulativePacingTarget = 0;

      const cells = monthlyMatrixMeta.map((m) => {
        const mRaw = b.byMonth.get(m.ym);
        if (mRaw) accumulateRawCounts(rawTotal, mRaw);
        const pts = computeKpiPoints(mRaw || emptyRawCounts(), ruleMap);
        const val = pickCategoryKpiVal(pts, categoryFilter, isTaskMode);
        const target = m.staffTarget * targetStaffMult;
        const mPacingTarget = m.staffPacingTarget * targetStaffMult;
        const pct = target > 0 ? Math.min(999, Math.round((val / target) * 1000) / 10) : 0;
        const pacingPct = mPacingTarget > 0 ? Math.min(999, Math.round((val / mPacingTarget) * 1000) / 10) : 0;

        total += val;
        totalPoints += pts.totalPoints;
        totalTasks += pts.totalTasks;
        if (m.isTrackedElapsed) {
          cumulativeTarget += target;
          cumulativePacingTarget += mPacingTarget;
        }

        const cell: MonthlyCellData = {
          ym: m.ym,
          val: Math.round(val * 100) / 100,
          points: pts.totalPoints,
          tasks: pts.totalTasks,
          pts,
          pct,
          pacingPct,
          target,
        };
        cellByMonth[m.ym] = cell;
        return cell;
      });

      if (categoryFilter !== 'ALL' && total === 0) return;

      const activeMeta = monthlyMatrixMeta.filter((m) => m.isTrackedElapsed);
      const refMeta = activeMeta[activeMeta.length - 1] || latestMeta;
      const targetPerMonth = (refMeta?.staffTarget ?? 0) * targetStaffMult;
      const targetPct = cumulativeTarget > 0 ? Math.min(999, Math.round((total / cumulativeTarget) * 1000) / 10) : 100;
      const pacingPct = cumulativePacingTarget > 0 ? Math.min(999, Math.round((total / cumulativePacingTarget) * 1000) / 10) : 100;
      const rating = getKpiRating(pacingPct, false);

      builtBranches.push({
        id: b.branchId,
        name: b.branchName,
        subLabel: `${b.staffCount} staff`,
        branchId: b.branchId,
        branchName: b.branchName,
        isManagement: false,
        staffCount: b.staffCount,
        kpiStaffCount: targetStaffMult,
        cells,
        cellByMonth,
        total: Math.round(total * 100) / 100,
        totalPoints: Math.round(totalPoints * 100) / 100,
        totalTasks,
        avgPerMonth: Math.round((total / trackedMatrixMonthCount) * 10) / 10,
        targetPerMonth,
        targetPct,
        pacingPct,
        cumulativeTarget,
        cumulativePacingTarget,
        rating,
        rawTotal,
      });
    });

    return {
      allStaffRows: builtStaffAll,
      staffRows,
      branchRows: builtBranches,
      levelCounts,
    };
  }, [
    data,
    isMonthlySubView,
    monthlyMatrixMeta,
    trackedMatrixMonthCount,
    ppDirectoryScope,
    staffMetaMap,
    exemptSet,
    branchNameMap,
    branches,
    isAdmin,
    userBranchId,
    branchFilter,
    deferredQuery,
    ruleMap,
    categoryFilter,
    isTaskMode,
    staffLevelFilter,
  ]);

  const activeMonthlyBaseRows = tableMode === 'branch' ? monthlyMatrixData.branchRows : monthlyMatrixData.staffRows;

  const matrixStatusCounts = useMemo(() => {
    const isMonthlyView =
      (tableMode === 'branch' && branchSubView === 'monthly') ||
      (tableMode === 'staff' && staffSubView === 'monthly');
    const base = isMonthlyView
      ? activeMonthlyBaseRows
      : tableMode === 'branch'
      ? filteredBranches
      : filteredStaff;
    const counts: Record<'ALL' | KpiRating, number> = {
      ALL: base.length,
      Outstanding: 0,
      'Meet Target': 0,
      'Near/Below Target': 0,
      'Needs Improvement': 0,
      'Management (Exempt)': 0,
    };
    for (const row of base) {
      counts[row.rating] = (counts[row.rating] || 0) + 1;
    }
    return counts;
  }, [tableMode, branchSubView, staffSubView, activeMonthlyBaseRows, filteredBranches, filteredStaff]);

  const statusFilteredMonthlyRows = useMemo(
    () => (statusFilter === 'ALL' ? activeMonthlyBaseRows : activeMonthlyBaseRows.filter((r) => r.rating === statusFilter)),
    [activeMonthlyBaseRows, statusFilter]
  );

  const sortedMonthlyRows = useMemo(() => {
    return [...statusFilteredMonthlyRows].sort((a, b) => {
      if (monthlySortKey.startsWith('m_')) {
        const ym = monthlySortKey.slice(2);
        const av = a.cellByMonth[ym]?.val ?? 0;
        const bv = b.cellByMonth[ym]?.val ?? 0;
        const cmp = av - bv;
        return monthlySortDir === 'asc' ? cmp : -cmp;
      }
      if (monthlySortKey === 'name') {
        const cmp = (tableMode === 'branch' ? cleanBranchName(a.name) : a.name).localeCompare(
          tableMode === 'branch' ? cleanBranchName(b.name) : b.name
        );
        return monthlySortDir === 'asc' ? cmp : -cmp;
      }
      if (monthlySortKey === 'branchId') {
        const cmp = a.branchId.localeCompare(b.branchId, 'en', { numeric: true });
        return monthlySortDir === 'asc' ? cmp : -cmp;
      }
      if (monthlySortKey === 'avg') {
        const cmp = a.avgPerMonth - b.avgPerMonth;
        return monthlySortDir === 'asc' ? cmp : -cmp;
      }
      if (monthlySortKey === 'oppositeTotal') {
        const getOpp = (r: typeof a) =>
          categoryFilter === 'ALL'
            ? (isTaskMode ? r.totalPoints : r.totalTasks)
            : r.cells.reduce((acc, c) => acc + pickCategoryKpiVal(c.pts, categoryFilter, !isTaskMode), 0);
        const cmp = getOpp(a) - getOpp(b);
        return monthlySortDir === 'asc' ? cmp : -cmp;
      }
      if (monthlySortKey === 'targetPct') {
        const cmp = a.targetPct - b.targetPct;
        return monthlySortDir === 'asc' ? cmp : -cmp;
      }
      const cmp = a.total - b.total || a.totalTasks - b.totalTasks;
      return monthlySortDir === 'asc' ? cmp : -cmp;
    });
  }, [statusFilteredMonthlyRows, monthlySortKey, monthlySortDir, tableMode, isTaskMode, categoryFilter]);

  const monthlyTotals = useMemo(() => {
    const byMonth: Record<string, number> = {};
    const byMonthPoints: Record<string, number> = {};
    const byMonthTasks: Record<string, number> = {};
    monthlyMatrixMeta.forEach((m) => {
      byMonth[m.ym] = 0;
      byMonthPoints[m.ym] = 0;
      byMonthTasks[m.ym] = 0;
    });
    let grandTotal = 0;
    let grandPoints = 0;
    let grandTasks = 0;
    let totalTargetPerMonth = 0;
    let totalCumulativeTarget = 0;
    let totalCumulativePacingTarget = 0;
    sortedMonthlyRows.forEach((r) => {
      grandTotal += r.total;
      if (!r.isManagement) {
        totalTargetPerMonth += r.targetPerMonth;
        totalCumulativeTarget += r.cumulativeTarget;
        totalCumulativePacingTarget += r.cumulativePacingTarget;
      }
      r.cells.forEach((c) => {
        const cPts = categoryFilter === 'ALL' ? c.points : pickCategoryKpiVal(c.pts, categoryFilter, false);
        const cTasks = categoryFilter === 'ALL' ? c.tasks : pickCategoryKpiVal(c.pts, categoryFilter, true);
        byMonth[c.ym] = (byMonth[c.ym] || 0) + c.val;
        byMonthPoints[c.ym] = (byMonthPoints[c.ym] || 0) + cPts;
        byMonthTasks[c.ym] = (byMonthTasks[c.ym] || 0) + cTasks;
        grandPoints += cPts;
        grandTasks += cTasks;
      });
    });
    const avgPerMonth = Math.round((grandTotal / trackedMatrixMonthCount) * 10) / 10;
    const avgPtsPerMonth = Math.round((grandPoints / trackedMatrixMonthCount) * 10) / 10;
    const avgTasksPerMonth = Math.round((grandTasks / trackedMatrixMonthCount) * 10) / 10;
    const pct = totalCumulativeTarget > 0 ? Math.round((grandTotal / totalCumulativeTarget) * 1000) / 10 : 0;
    return {
      byMonth,
      byMonthPoints,
      byMonthTasks,
      grandTotal: Math.round(grandTotal * 100) / 100,
      grandPoints: Math.round(grandPoints * 100) / 100,
      grandTasks,
      avgPerMonth,
      avgPtsPerMonth,
      avgTasksPerMonth,
      totalTargetPerMonth,
      totalCumulativeTarget,
      totalCumulativePacingTarget,
      pct,
    };
  }, [sortedMonthlyRows, monthlyMatrixMeta, trackedMatrixMonthCount, categoryFilter]);

  const monthlyPg = usePager(sortedMonthlyRows.length, [
    tableMode, branchSubView, staffSubView, branchFilter, categoryFilter, deferredQuery,
    staffLevelFilter, statusFilter, metricMode, monthlyMatrixYear,
  ]);

  const exportMonthlyCsv = async () => {
    if (!sortedMonthlyRows.length) return 0;
    const isBr = tableMode === 'branch';
    const unitTag = isTaskMode ? 'Tasks' : 'Points';
    const spanTag = monthlyMatrixYear || todayPP().slice(0, 4);
    const header = isBr
      ? [
          'No.', 'Branch Name', 'Branch Code', 'Active Staff',
          ...monthlyMatrixMeta.map((m) => `${m.fullLabel} (${unitTag})`),
          `Total ${unitTag}`, `Monthly Avg (${unitTag})`, `Target / Month (${unitTag})`, 'Achievement %', 'Performance',
        ]
      : [
          'No.', 'Staff Name', 'Staff ID', 'Position', 'Role / Level', 'Branch Name', 'Branch Code',
          ...monthlyMatrixMeta.map((m) => `${m.fullLabel} (${unitTag})`),
          `Total ${unitTag}`, `Monthly Avg (${unitTag})`, `Target / Month (${unitTag})`, 'Achievement %', 'Performance',
        ];

    const rows = sortedMonthlyRows.map((r, i) =>
      isBr
        ? [
            i + 1, cleanBranchName(r.name), r.branchId, r.staffCount,
            ...r.cells.map((c) => c.val),
            r.total, r.avgPerMonth, r.targetPerMonth, `${r.targetPct}%`, r.rating,
          ]
        : [
            i + 1, r.name, r.id, r.subLabel || 'MS Officer',
            r.isManagement ? 'Management (Exempt)' : 'Field Officer',
            cleanBranchName(r.branchName), r.branchId,
            ...r.cells.map((c) => c.val),
            r.total, r.avgPerMonth,
            r.isManagement ? 'Exempt' : r.targetPerMonth,
            r.isManagement ? 'Exempt' : `${r.targetPct}%`,
            r.rating,
          ]
    );

    rows.push(
      isBr
        ? [
            'Total', `All Branches (${sortedMonthlyRows.length})`, 'ALL', '',
            ...monthlyMatrixMeta.map((m) => Math.round((monthlyTotals.byMonth[m.ym] || 0) * 100) / 100),
            monthlyTotals.grandTotal, monthlyTotals.avgPerMonth, monthlyTotals.totalTargetPerMonth, `${monthlyTotals.pct}%`, '',
          ]
        : [
            'Total', `All Staff (${sortedMonthlyRows.length})`, '', '', '', '', '',
            ...monthlyMatrixMeta.map((m) => Math.round((monthlyTotals.byMonth[m.ym] || 0) * 100) / 100),
            monthlyTotals.grandTotal, monthlyTotals.avgPerMonth, monthlyTotals.totalTargetPerMonth, `${monthlyTotals.pct}%`, '',
          ]
    );

    downloadCsv(`KPI_Monthly_${isBr ? 'Branch' : 'Staff'}_${unitTag}_${spanTag}`, header, rows);
    return sortedMonthlyRows.length;
  };

  const branchPg = usePager(statusFilteredBranches.length, [period, branchFilter, categoryFilter, deferredQuery, statusFilter]);
  const staffPg = usePager(statusFilteredStaff.length, [period, branchFilter, categoryFilter, deferredQuery, staffLevelFilter, statusFilter]);

  const filtersActive = period !== 'ALL' || !!branchFilter || categoryFilter !== 'ALL' || !!query || statusFilter !== 'ALL';
  const clearAll = () => {
    setPeriod('ALL');
    setBranchFilter('');
    setCategoryFilter('ALL');
    setStatusFilter('ALL');
    setQuery('');
  };

  const exportBranchCsv = async () => {
    if (!statusFilteredBranches.length) return 0;
    const pTag = KPI_PERIOD_LABEL[period].replace(/[^A-Za-z0-9]+/g, '_');
    downloadCsv(
      `KPI_Branch_Performance_${pTag}`,
      ['Rank', 'Branch Name', 'Branch Code', 'Active Staff', 'POS Tasks', 'POS Points', 'Sound Box Tasks', 'Sound Box Points',
        'KHQR Tasks', 'QR Materials', 'KHQR Points', 'Credit Card Tasks', 'Credit Card Points', 'Merchant Visit Tasks', 'Merchant Visit Points', 'Total Tasks', 'Pts / Staff', 'Total KPI Points', 'Achievement %', 'Performance'],
      statusFilteredBranches.map((b, i) => [
        i + 1, cleanBranchName(b.branchName), b.branchId, b.staffCount, b.posTasks, b.posPoints, b.sbTasks, b.sbPoints,
        b.khqrTasks, b.khqrMaterials, b.khqrPoints, b.ccTasks, b.ccPoints, b.mvTasks, b.mvPoints, b.totalTasks, b.ptsPerStaff, b.totalPoints, `${b.targetPct}%`, b.rating,
      ])
    );
    return statusFilteredBranches.length;
  };

  const exportStaffCsv = async () => {
    if (!statusFilteredStaff.length) return 0;
    const pTag = KPI_PERIOD_LABEL[period].replace(/[^A-Za-z0-9]+/g, '_');
    downloadCsv(
      `KPI_Individual_Staff_${pTag}`,
      ['Rank', 'Staff Name', 'Staff ID', 'Position', 'Role / Level', 'Branch Name', 'Branch Code', 'POS Install', 'POS Replace', 'POS Battery', 'POS Operational Support', 'POS Points',
        'SB Install', 'SB Replace', 'SB Maintenance', 'SB Operational Support', 'SB Return', 'Sound Box Points', 'KHQR Install', 'KHQR Replace', 'QR Materials', 'KHQR Points',
        'CC Primary', 'CC Supplementary', 'Credit Card Points', 'Merchant Visit Tasks', 'Merchant Visit Points', 'Total Tasks', 'Total KPI Points', 'Achievement %', 'Performance'],
      statusFilteredStaff.map((s, i) => [
        i + 1, s.staffName, s.staffId, s.position || (s.isManagement ? 'Management' : 'MS Officer'), s.isManagement ? 'Management (Exempt)' : 'Field Officer', cleanBranchName(s.branchName), s.branchId,
        s.posInstall, s.posReplace, s.posBattery, Number(s.extra?.['POS_MAINT']) || Number(s.posMaint) || 0, s.posPoints,
        s.sbInstall, s.sbReplace, Number(s.extra?.['SB_MAINTENANCE']) || 0, s.sbMaint, s.sbReturn, s.sbPoints, s.khqrInstall, s.khqrReplace, s.khqrMaterials, s.khqrPoints,
        s.ccPrimary, s.ccSupp, s.ccPoints, s.mvTasks, s.mvPoints, s.totalTasks, s.totalPoints, s.isManagement ? 'Exempt' : `${s.targetPct}%`, s.rating,
      ])
    );
    return statusFilteredStaff.length;
  };
  

  const sortedBranches = useMemo(
    () =>
      [...branches]
        .filter((b) => isPhnomPenhBranch(b))
        .sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true })),
    [branches]
  );

  const navTabs: { id: KpiView; label: string; Icon: React.ElementType; accentColor: string; count?: number }[] = [
    { id: 'all', label: 'Overview', Icon: BarChart3, accentColor: 'text-[#002F4A]' },
    { id: 'staff', label: 'Staff KPI', Icon: Users, accentColor: 'text-sky-600', count: filteredStaff.length },
    { id: 'branches', label: 'Branch KPI', Icon: Building2, accentColor: 'text-emerald-600', count: filteredBranches.length },
    { id: 'timeline', label: 'Performance Trend', Icon: Calendar, accentColor: 'text-indigo-600' },
    { id: 'top10', label: 'Top 10 Leaderboard', Icon: Trophy, accentColor: 'text-amber-500' },
  ];

  const showSection = (sec: KpiView) => view === 'all' || view === sec;

  const chronologicalTimeSeries = useMemo(() => {
    const sorted = [...timeSeries].sort((a, b) => a.period.localeCompare(b.period));
    return granularity === 'daily' ? sorted.slice(-15) : sorted;
  }, [timeSeries, granularity]);
  const reversedTimeSeries = chronologicalTimeSeries;

  const velocitySummary = useMemo(() => {
    let total = 0;
    let staffSum = 0;
    let activePeriods = 0;
    let peakVal = 0;
    let peakLabel = '';
    for (const r of reversedTimeSeries) {
      const val = isTaskMode ? r.totalTasks : r.totalPoints;
      total += val;
      if (r.activeStaff > 0) {
        staffSum += r.activeStaff;
        activePeriods++;
      }
      if (val >= peakVal && val > 0) {
        peakVal = val;
        peakLabel = r.label;
      }
    }
    const avgStaff = activePeriods > 0 ? Math.round(staffSum / activePeriods) : 0;
    return { total, avgStaff, peakVal, peakLabel };
  }, [reversedTimeSeries, isTaskMode]);

  const velocityCalendar = useMemo(() => {
    const bandsByStartIdx = new Map<
      number,
      { kind: 'weekend' | 'holiday'; startIdx: number; endIdx: number; spanCount: number; holidayName?: string | null }
    >();
    const holidayDetails: string[] = [];
    let weekendCount = 0;
    let holidayCount = 0;

    if (granularity === 'daily' && reversedTimeSeries.length > 0) {
      let i = 0;
      while (i < reversedTimeSeries.length) {
        const cur = reversedTimeSeries[i];
        const kind: 'work' | 'weekend' | 'holiday' = cur.isHoliday
          ? 'holiday'
          : cur.isWeekend
            ? 'weekend'
            : 'work';
        if (cur.isHoliday) {
          holidayCount++;
          if (cur.holidayName) holidayDetails.push(`${cur.label}: ${cur.holidayName}`);
        } else if (cur.isWeekend) {
          weekendCount++;
        }
        if (kind === 'work') {
          i++;
          continue;
        }
        let j = i;
        while (j + 1 < reversedTimeSeries.length) {
          const nxt = reversedTimeSeries[j + 1];
          const nxtKind: 'work' | 'weekend' | 'holiday' = nxt.isHoliday
            ? 'holiday'
            : nxt.isWeekend
              ? 'weekend'
              : 'work';
          if (nxtKind !== kind) break;
          if (nxt.isHoliday) {
            holidayCount++;
            if (nxt.holidayName) holidayDetails.push(`${nxt.label}: ${nxt.holidayName}`);
          } else if (nxt.isWeekend) {
            weekendCount++;
          }
          j++;
        }
        bandsByStartIdx.set(i, {
          kind,
          startIdx: i,
          endIdx: j,
          spanCount: j - i + 1,
          holidayName: cur.holidayName,
        });
        i = j + 1;
      }
    }

    return {
      weekendCount,
      holidayCount,
      holidayTitle: holidayDetails.join(' · '),
      bandsByStartIdx,
    };
  }, [reversedTimeSeries, granularity]);

  return (
    <div className="flex flex-col gap-6 sm:gap-7 apple-tab-panel" aria-label="KPI Performance">
      {/* ───────────── 1. HERO HEADER & 6 BIG KPI CARDS (Push Configuring Hub Backdrop Style) ───────────── */}
      <section
        className="relative overflow-hidden rounded-3xl p-6 sm:p-8 border shadow-sm bg-slate-100 border-slate-200/90 text-slate-900"
        aria-label="KPI Performance statistics"
      >
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2 max-w-3xl">
            <h1 className="text-2xl sm:text-3xl lg:text-[32px] font-extrabold tracking-tight flex items-center gap-3 text-slate-900 leading-tight">
              <BarChart3 className="w-7 h-7 sm:w-8 sm:h-8 shrink-0 text-[#002F4A]" aria-hidden />
              <span>
                KPI Performance{' '}
                <span className="text-slate-500 font-semibold text-xl sm:text-2xl lg:text-[26px]">
                  · Branch &amp; Staff Analytics
                </span>
              </span>
            </h1>
            <p className="text-sm sm:text-base leading-relaxed text-slate-600">
              Live institutional performance tracking across field installations, KHQR merchant onboarding, and credit card acquisitions.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <div
              className={`${CAPSULE_TRACK_CLS} shrink-0 whitespace-nowrap`}
              role="tablist"
              aria-label="KPI metric mode"
            >
              {([
                { m: 'points' as const, label: 'By Points', Icon: Award, accent: 'text-amber-500' },
                { m: 'tasks' as const, label: 'Task Count', Icon: CheckSquare, accent: 'text-emerald-600' },
              ]).map(({ m, label, Icon, accent }) => {
                const active = metricMode === m;
                return (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => handleMetricModeChange(m)}
                    className={`relative px-3 py-1.5 rounded-full text-xs cursor-pointer transition-colors duration-150 inline-flex items-center gap-1.5 ${
                      active ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
                    }`}
                  >
                    {active && (
                      <PillMotion
                        layoutId="kpi-metric-mode-pill"
                        aria-hidden
                        transition={SPRING}
                        className={CAPSULE_PILL_CLS}
                      />
                    )}
                    <Icon className={`w-3.5 h-3.5 relative z-10 shrink-0 transition-colors ${accent}`} aria-hidden />
                    <span className="relative z-10">{label}</span>
                  </button>
                );
              })}
            </div>
            <select
              aria-label="Period"
              value={period}
              onChange={(e) => {
                const v = e.target.value as KpiPeriod;
                startMatrixTransition(() => setPeriod(v));
              }}
              className="btn-press px-3.5 py-2 rounded-xl text-xs sm:text-sm font-normal border bg-white hover:bg-slate-50 text-slate-800 border-slate-200/90 shadow-2xs outline-none focus:border-slate-400 cursor-pointer"
            >
              {(Object.keys(KPI_PERIOD_LABEL) as KpiPeriod[]).map((p) => (
                <option key={p} value={p}>{KPI_PERIOD_LABEL[p]}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={forceReload}
              aria-label="Refresh KPI Performance"
              title="Refresh KPI Performance"
              className="group relative inline-flex items-center gap-2 px-3.5 py-2 rounded-xl active:scale-[0.985] transition-all duration-150 font-semibold text-xs sm:text-sm border shadow-2xs cursor-pointer bg-white hover:bg-slate-50 text-slate-800 border-slate-200/90"
              data-allow-repeat
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin text-slate-700" />
              ) : (
                <RefreshCw className="w-4 h-4 text-slate-700 group-hover:rotate-180 transition-transform duration-300" />
              )}
              <span>Sync KPI</span>
            </button>
          </div>
        </div>

        {loadError && (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700">
            Could not load KPI summary: {loadError}{' '}
            <button type="button" onClick={load} className="underline cursor-pointer">Try again</button>
          </div>
        )}

        <div
          data-testid="kpi-summary-cards"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3.5 mt-4 pt-4 border-t border-slate-200/90"
        >
          {loading && !data ? (
            Array.from({ length: 5 }).map((_, i) => <KpiCardSkeleton key={i} />)
          ) : (
            <>
              {(() => {
                const leadBranch = isTaskMode ? totals.topTaskBranch : totals.topBranch;
                const leadStaff = isTaskMode ? totals.topTaskStaff : totals.topStaff;
                return (
                  <>
                    <BigKpiCard
                      label={isTaskMode ? 'Total KPI Tasks' : 'Total KPI Points'}
                      value={isTaskMode ? fmtInt(totals.totalTasks) : fmtPts(totals.totalPoints)}
                      sub={isTaskMode ? `Avg ${fmtPts(totals.avgBranchTasks)} tasks / branch` : `Avg ${fmtPts(totals.avgBranchPts)} pts / branch`}
                      icon={Trophy}
                      accentColor="blue"
                      badge={KPI_PERIOD_LABEL[period]}
                      onClick={() => handleCardClick('points', 'all')}
                      active={selectedCard === 'points'}
                      staggerIndex={0}
                    />
                    <BigKpiCard
                      label="Branches & Staff"
                      valueNode={
                        <span className="inline-flex items-center gap-3.5 sm:gap-4">
                          <span className="inline-flex flex-col">
                            <span className="text-[24px] xl:text-[26px] leading-none">{fmtInt(totals.activeBranchCount)}</span>
                            <span className="text-[10.5px] font-medium text-slate-500 tracking-normal mt-1">Branches</span>
                          </span>
                          <span className="h-8 w-px bg-slate-200/90 shrink-0" aria-hidden="true" />
                          <span className="inline-flex flex-col">
                            <span className="text-[24px] xl:text-[26px] leading-none">{fmtInt(totals.activeStaffCount)}</span>
                            <span className="text-[10.5px] font-medium text-slate-500 tracking-normal mt-1">Staff</span>
                          </span>
                        </span>
                      }
                      sub={
                        isTaskMode
                          ? (totals.mgtStaffCount > 0 ? `Avg ${fmtPts(totals.avgStaffTasks)} tasks/field (${totals.mgtStaffCount} mgt)` : `Avg ${fmtPts(totals.avgStaffTasks)} tasks/st`)
                          : (totals.mgtStaffCount > 0 ? `Avg ${fmtPts(totals.avgStaffPts)} pts/field (${totals.mgtStaffCount} mgt)` : `Avg ${fmtPts(totals.avgStaffPts)} pts/staff`)
                      }
                      icon={Users}
                      accentColor="violet"
                      badge={`${totals.staffOnTarget} on target`}
                      onClick={() => handleCardClick('staff', 'all', 'staff')}
                      active={selectedCard === 'staff' || selectedCard === 'branches'}
                      staggerIndex={1}
                    />
                    <BigKpiCard
                      label="Leading Branch"
                      value={leadBranch ? (isTaskMode ? `${fmtInt(leadBranch.totalTasks)} tasks` : `${fmtPts(leadBranch.totalPoints)} pts`) : '—'}
                      sub={leadBranch ? fmtBranchLabel(leadBranch.branchId, leadBranch.branchName, true) : 'No branch activity'}
                      icon={Award}
                      accentColor="emerald"
                      badge={leadBranch ? `${leadBranch.staffCount} staff` : undefined}
                      onClick={() => handleCardClick('leading-branch', 'all', 'branch')}
                      active={selectedCard === 'leading-branch'}
                      staggerIndex={2}
                    />
                    <BigKpiCard
                      label="Top Performer"
                      value={leadStaff ? (isTaskMode ? `${fmtInt(leadStaff.totalTasks)} tasks` : `${fmtPts(leadStaff.totalPoints)} pts`) : '—'}
                      sub={leadStaff ? `${leadStaff.staffName} (${leadStaff.staffId})` : 'No staff activity'}
                      icon={Award}
                      accentColor="blue"
                      badge={leadStaff ? cleanBranchName(leadStaff.branchName) : undefined}
                      onClick={() => handleCardClick('top-performer', 'top10')}
                      active={selectedCard === 'top-performer'}
                      staggerIndex={3}
                    />
                    <BigKpiCard
                      label="Target Achievement"
                      value={`${totals.targetAchievementPct}%`}
                      sub={`${totals.branchesOnTarget} branches · ${totals.staffOnTarget} staff on target`}
                      icon={Target}
                      accentColor={totals.targetAchievementPct >= 100 ? 'emerald' : totals.targetAchievementPct >= 75 ? 'blue' : 'amber'}
                      badge={activeTargets.label}
                      onClick={() => handleCardClick('achievement', 'all', 'branch')}
                      active={selectedCard === 'achievement'}
                      staggerIndex={4}
                    />
                  </>
                );
              })()}
            </>
          )}
        </div>
      </section>

      {/* ───────────── Navigation & Filter Bar ───────────── */}
      <section
        className="bg-white rounded-2xl border border-slate-200/90 px-3.5 py-2.5 shadow-2xs silk-lift"
        style={{ '--silk-i': 4 } as React.CSSProperties}
        aria-label="KPI Navigation and Filters"
      >
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="w-full sm:w-auto overflow-x-auto no-scrollbar py-0.5">
            <div className={`${CAPSULE_TRACK_CLS} shrink-0 whitespace-nowrap`} role="tablist" aria-label="KPI Views">
            {navTabs.map((t) => {
              const active = view === t.id;
              const Icon = t.Icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => handleViewChange(t.id)}
                  className={`relative px-3 py-1.5 rounded-full text-xs cursor-pointer transition-colors duration-150 inline-flex items-center gap-1.5 ${
                    active ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
                  }`}
                >
                  {active && (
                    <PillMotion
                      layoutId="kpi-view-pill"
                      aria-hidden
                      className={CAPSULE_PILL_CLS}
                      transition={SPRING}
                    />
                  )}
                  <Icon className={`w-3.5 h-3.5 relative z-10 shrink-0 transition-colors ${t.accentColor}`} aria-hidden />
                  <span className="relative z-10">{t.label}</span>
                  {t.count !== undefined && (
                    <span
                      className={`relative z-10 font-figure tabular-nums text-[10px] px-1.5 py-0.5 rounded-full leading-none transition-colors ${
                        active ? CAPSULE_COUNT_ACTIVE_CLS : CAPSULE_COUNT_INACTIVE_CLS
                      }`}
                    >
                      {t.count.toLocaleString()}
                    </span>
                  )}
                </button>
              );
            })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 flex-1 justify-start sm:justify-end w-full sm:w-auto">
              <span
                className="inline-flex items-center gap-1.5 text-xs rounded-xl border border-slate-200/90 bg-slate-100/80 px-2.5 py-1.5 text-slate-700 font-medium whitespace-nowrap"
                title="Scoped to active Phnom Penh Staff from the Staff Directory"
              >
                <MapPin className="w-3.5 h-3.5 text-[#155484] shrink-0" aria-hidden />
                <span>Phnom Penh · Staff Directory</span>
              </span>

              <select
                aria-label="Branch filter"
                value={branchFilter}
                onChange={(e) => {
                  const v = e.target.value;
                  startMatrixTransition(() => setBranchFilter(v));
                }}
                className="text-xs rounded-xl border border-slate-200/90 bg-slate-50/70 hover:bg-white px-2.5 py-1.5 cursor-pointer max-w-full sm:max-w-[175px] text-slate-800 font-normal outline-none focus:border-slate-400 transition min-w-[120px] flex-1 sm:flex-initial"
              >
                <option value="">All branches</option>
                <option value="100">Head Office (100)</option>
                {sortedBranches.filter((b) => String(b.id) !== '100').map((b) => (
                  <option key={b.id} value={b.id}>{fmtBranchLabel(String(b.id), b.name)}</option>
                ))}
              </select>

              <select
                aria-label="Category filter"
                value={categoryFilter}
                onChange={(e) => {
                  const v = e.target.value as 'ALL' | KpiCategory;
                  startMatrixTransition(() => setCategoryFilter(v));
                }}
                className="text-xs rounded-xl border border-slate-200/90 bg-slate-50/70 hover:bg-white px-2.5 py-1.5 cursor-pointer text-slate-800 font-normal outline-none focus:border-slate-400 transition"
              >
                <option value="ALL">All KPI types</option>
                <option value="POS Terminal">POS Terminal</option>
                <option value="Sound Box">Sound Box</option>
                <option value="KHQR">KHQR</option>
                <option value="Credit Card">Credit Card</option>
                <option value="Merchant Visit">Merchant Visit</option>
              </select>

              <div className="relative flex-1 min-w-[170px] max-w-[240px]">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
                <input
                  aria-label="Search branch or staff"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search branch or staff…"
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200/90 bg-slate-50/70 focus:bg-white outline-none focus:border-slate-400 text-slate-800 placeholder:text-slate-400 font-medium transition"
                />
              </div>
              {filtersActive && <ClearFiltersButton active={filtersActive} onClear={clearAll} />}
            </div>
        </div>
      </section>

      {/* ───────────── Executive Graphs & Charts (Push Configuring Hub Backdrop Style) ───────────── */}
      <div className={showSection('all') ? 'contents' : 'hidden'}>
        {loading && !data ? (
          <KpiChartsSkeleton />
        ) : (
          <AfterPaint order={1} minHeight={556}>
          <section
            className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden p-4 sm:p-5 space-y-4 silk-lift"
            style={{ '--silk-i': 5 } as React.CSSProperties}
            aria-label="Executive KPI Charts"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-sky-50 text-[#002F4A] border border-sky-100 flex items-center justify-center shrink-0">
                  <TrendingUp className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Performance Velocity &amp; Monthly Target Achievement</h3>
                  <p className="text-[11.5px] text-slate-500 font-medium">
                    {isTaskMode
                      ? 'Task count trajectory across time and actual vs target achievement'
                      : 'Point output trajectory across time and actual vs target achievement'}
                  </p>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] gap-5">
            {/* Chart 1 (~62%): Gradient Daily Columns alongside Monthly Target Donut */}
            <div
              data-testid="kpi-velocity-chart-card"
              className="min-w-0 bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden flex flex-col justify-between"
            >
              <div className="px-4 sm:px-5 pt-4 pb-3 border-b border-slate-100 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-[13px] font-semibold text-slate-900">
                      {isTaskMode ? 'KPI Task Velocity' : 'KPI Point Velocity'}
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      {granularity === 'daily'
                        ? (isTaskMode ? 'Daily task volume output' : 'Daily point velocity output')
                        : (isTaskMode ? 'Task volume output across period' : 'Point velocity output across period')}
                    </p>
                  </div>

                  <div className={`${CAPSULE_TRACK_CLS} shrink-0`} role="tablist" aria-label="Chart granularity">
                    {([
                      { g: 'daily' as const, label: 'Daily', dot: 'bg-sky-500' },
                      { g: 'weekly' as const, label: 'Weekly', dot: 'bg-emerald-500' },
                      { g: 'monthly' as const, label: 'Monthly', dot: 'bg-[#004e75]' },
                      { g: 'quarterly' as const, label: 'Quarterly', dot: 'bg-amber-500' },
                    ]).map(({ g, label, dot }) => {
                      const active = granularity === g;
                      return (
                        <button
                          key={g}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          onClick={() => startMatrixTransition(() => setGranularity(g))}
                          aria-pressed={active}
                          className={`relative px-3 py-1 rounded-full text-[11px] cursor-pointer transition-colors inline-flex items-center gap-1.5 ${
                            active ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
                          }`}
                        >
                          {active && (
                            <PillMotion
                              layoutId="kpi-chart-granularity-pill"
                              aria-hidden
                              transition={SPRING}
                              className={CAPSULE_PILL_CLS}
                            />
                          )}
                          <span className={`w-2 h-2 rounded-full relative z-10 shrink-0 ${dot}`} aria-hidden />
                          <span className="relative z-10">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Headline Metrics Row */}
                <div className="flex flex-wrap items-end justify-between gap-4 pt-1">
                  <div className="flex items-center gap-6">
                    <div>
                      <div className="font-figure text-2xl font-bold tracking-tight text-slate-900 tabular-nums leading-none">
                        {isTaskMode ? fmtInt(velocitySummary.total) : fmtPts(velocitySummary.total)}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        {isTaskMode ? 'Window Total Tasks' : 'Window Total Points'}
                      </p>
                    </div>
                    <div className="h-8 w-px bg-slate-200/80 hidden sm:block" aria-hidden />
                    <div>
                      <div className="font-figure text-2xl font-bold tracking-tight text-[#004e75] tabular-nums leading-none">
                        {fmtInt(velocitySummary.avgStaff)}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">Avg Active Staff</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-4 sm:px-5 pt-3 pb-4">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 pb-2.5 text-[11px] font-semibold text-slate-600">
                  <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
                    <span className="inline-flex items-center gap-1.5 text-[#155484]">
                      <span className="w-2.5 h-2.5 rounded-[3px] bg-[#155484] inline-block" aria-hidden />
                      <span>{isTaskMode ? 'Total Tasks (bars)' : 'Total Points (bars)'}</span>
                    </span>
                    {velocitySummary.peakLabel && (
                      <span className="inline-flex items-center gap-1.5 text-teal-700">
                        <span className="w-2.5 h-2.5 rounded-[3px] bg-teal-600 inline-block" aria-hidden />
                        <span>Peak ({velocitySummary.peakLabel})</span>
                      </span>
                    )}
                  </div>
                </div>

                <div className="h-[316px] w-full">
                  {reversedTimeSeries.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-xs text-slate-400">
                      No trend data available for this granularity.
                    </div>
                  ) : (
                    <MeasuredChart height={316}>{(chartW) => (
                      <ComposedChart width={chartW} height={316} data={reversedTimeSeries} margin={{ top: 32, right: 4, left: -14, bottom: 0 }}>
                        <defs>
                          <linearGradient id="kpiVelocityBarGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#155484" />
                            <stop offset="100%" stopColor="#5da9d9" />
                          </linearGradient>
                          <linearGradient id="kpiVelocityPeakGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#0d9488" />
                            <stop offset="100%" stopColor="#14b8a6" />
                          </linearGradient>
                          <linearGradient id="kpiVelocityWkndGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="rgba(100, 116, 139, 0.085)" />
                            <stop offset="100%" stopColor="rgba(100, 116, 139, 0.02)" />
                          </linearGradient>
                          <linearGradient id="kpiVelocityHolGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="rgba(245, 158, 11, 0.13)" />
                            <stop offset="100%" stopColor="rgba(245, 158, 11, 0.03)" />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 4" stroke="rgba(148, 163, 184, 0.25)" vertical={false} />
                        <XAxis
                          dataKey="label"
                          axisLine={{ stroke: '#cbd5e1' }}
                          tickLine={false}
                          interval={granularity === 'daily' ? 0 : Math.max(0, Math.ceil(chronologicalTimeSeries.length / 15) - 1)}
                          tick={(tickProps: { x?: number | string; y?: number | string; payload?: { value?: string | number; index?: number } }) => {
                            const tx = Number(tickProps.x || 0);
                            const ty = Number(tickProps.y || 0);
                            const idx = Number(tickProps.payload?.index ?? -1);
                            const row = idx >= 0 ? reversedTimeSeries[idx] : undefined;
                            const isHol = granularity === 'daily' && Boolean(row?.isHoliday);
                            const isWknd = granularity === 'daily' && Boolean(row?.isWeekend) && !isHol;
                            const fill = isHol ? '#d97706' : isWknd ? '#475569' : '#64748b';
                            return (
                              <g transform={`translate(${tx},${ty})`}>
                                <text
                                  x={0}
                                  y={4}
                                  dy={8}
                                  textAnchor="middle"
                                  fill={fill}
                                  fontSize={10}
                                  fontWeight={isHol ? 700 : 600}
                                >
                                  {tickProps.payload?.value}
                                </text>
                              </g>
                            );
                          }}
                        />
                        <YAxis
                          yAxisId="left"
                          axisLine={false}
                          tickLine={false}
                          tickCount={5}
                          domain={[0, (dataMax: number) => {
                            if (dataMax <= 0) return 10;
                            const raw = dataMax * 1.18;
                            const mag = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw / 4))));
                            const step = ([1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10].map((m) => m * mag).find((v) => v >= raw / 4) || 10 * mag);
                            return Math.ceil(raw / step) * step;
                          }]}
                          tick={{ fontSize: 11, fill: '#64748b' }}
                          tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))}
                        />
                        <Tooltip
                          content={<CustomTrendTooltip metricMode={metricMode} />}
                          cursor={{ fill: 'rgba(21, 84, 132, 0.05)' }}
                          isAnimationActive={false}
                        />
                        {granularity === 'daily' && velocityCalendar.bandsByStartIdx.size > 0 && reversedTimeSeries.length > 0 && (
                          <ReferenceArea
                            yAxisId="left"
                            x1={reversedTimeSeries[0].label}
                            x2={reversedTimeSeries[reversedTimeSeries.length - 1].label}
                            shape={(raProps: { x?: number; y?: number; width?: number; height?: number; viewBox?: { x?: number; y?: number; width?: number; height?: number } }) => {
                              const rawX = raProps.x ?? raProps.viewBox?.x;
                              const rawY = raProps.y ?? raProps.viewBox?.y;
                              const rawW = raProps.width ?? raProps.viewBox?.width;
                              const rawH = raProps.height ?? raProps.viewBox?.height;
                              const plotX = typeof rawX === 'number' && Number.isFinite(rawX) ? rawX : 46;
                              const plotY = typeof rawY === 'number' && Number.isFinite(rawY) ? rawY : 32;
                              const plotW = typeof rawW === 'number' && Number.isFinite(rawW) && rawW > 0 ? rawW : Math.max(200, chartW - 50);
                              const plotH = typeof rawH === 'number' && Number.isFinite(rawH) && rawH > 0 ? rawH : 254;
                              const count = Math.max(1, reversedTimeSeries.length);
                              const slotW = plotW / count;
                              const bandInset = slotW >= 14 ? 1.5 : 0.75;

                              return (
                                <g className="pointer-events-none">
                                  {Array.from(velocityCalendar.bandsByStartIdx.values()).map((band) => {
                                    const bandX = plotX + band.startIdx * slotW + bandInset;
                                    const bandW = Math.max(6, band.spanCount * slotW - bandInset * 2);
                                    const isHol = band.kind === 'holiday';

                                    const hasPeakInside = (() => {
                                      if (!velocitySummary.peakLabel || velocitySummary.peakVal <= 0) return false;
                                      for (let k = band.startIdx; k <= band.endIdx; k++) {
                                        if (reversedTimeSeries[k]?.label === velocitySummary.peakLabel) return true;
                                      }
                                      return false;
                                    })();

                                    const badgeLabel = isHol
                                      ? (bandW >= 78 && band.holidayName
                                          ? band.holidayName.replace(/\s*\(.*?\)/g, '').trim().slice(0, 14)
                                          : bandW >= 48
                                            ? 'Holiday'
                                            : bandW >= 28
                                              ? 'Hol'
                                              : 'H')
                                      : (bandW >= 54 ? 'Weekend' : bandW >= 36 ? 'Wknd' : 'W');
                                    const badgeW = Math.min(bandW + 6, badgeLabel.length * 5.2 + 10);
                                    const badgeX = bandX + bandW / 2 - badgeW / 2;
                                    const badgeY = Math.max(4, plotY - 20);

                                    return (
                                      <g key={`band-${band.kind}-${band.startIdx}`} data-kpi-band={band.kind}>
                                        <rect
                                          x={bandX}
                                          y={plotY}
                                          width={bandW}
                                          height={plotH}
                                          rx={4}
                                          fill={isHol ? 'url(#kpiVelocityHolGrad)' : 'url(#kpiVelocityWkndGrad)'}
                                          stroke={isHol ? 'rgba(217, 119, 6, 0.36)' : 'rgba(148, 163, 184, 0.24)'}
                                          strokeWidth={isHol ? 1 : 0.75}
                                          strokeDasharray={isHol ? '2.5 2.5' : undefined}
                                        />
                                        <rect
                                          x={bandX + 0.5}
                                          y={plotY}
                                          width={Math.max(2, bandW - 1)}
                                          height={isHol ? 2.5 : 2}
                                          rx={1.25}
                                          fill={isHol ? 'rgba(217, 119, 6, 0.85)' : 'rgba(100, 116, 139, 0.45)'}
                                        />
                                        {!hasPeakInside && (
                                          <g>
                                            <rect
                                              x={badgeX}
                                              y={badgeY}
                                              width={badgeW}
                                              height={14}
                                              rx={4}
                                              fill={isHol ? 'rgba(255, 251, 235, 0.96)' : 'rgba(248, 250, 252, 0.96)'}
                                              stroke={isHol ? 'rgba(245, 158, 11, 0.5)' : 'rgba(148, 163, 184, 0.42)'}
                                              strokeWidth={0.85}
                                            />
                                            <text
                                              x={bandX + bandW / 2}
                                              y={badgeY + 10}
                                              textAnchor="middle"
                                              fill={isHol ? '#b45309' : '#475569'}
                                              fontSize="8.5"
                                              fontWeight="700"
                                            >
                                              {badgeLabel}
                                            </text>
                                          </g>
                                        )}
                                      </g>
                                    );
                                  })}
                                </g>
                              );
                            }}
                          />
                        )}
                        <Bar
                          yAxisId="left"
                          dataKey={isTaskMode ? 'totalTasks' : 'totalPoints'}
                          name={isTaskMode ? 'Total Tasks' : 'Total Points'}
                          barSize={granularity === 'daily' ? 18 : 26}
                          radius={[4, 4, 2, 2]}
                          isAnimationActive={false}
                          label={(lblProps) => {
                            const val = Number(lblProps.value || 0);
                            if (val <= 0) return <g key={`v-zero-${lblProps.index}`} />;
                            const isPeak = velocitySummary.peakVal > 0 && Math.abs(val - velocitySummary.peakVal) < 0.05;
                            const slotW = (chartW - 40) / Math.max(1, reversedTimeSeries.length);
                            if (!isPeak && slotW < 24) return <g key={`v-skip-${lblProps.index}`} />;

                            const valLabel =
                              val >= 1_000_000
                                ? `${(val / 1_000_000).toFixed(1)}M`
                                : val >= 1000
                                  ? `${(val / 1000).toFixed(1)}k`
                                  : val >= 100 || Number.isInteger(val)
                                    ? String(Math.round(val))
                                    : val.toFixed(1);

                            const barY = Number(lblProps.y || 0);
                            const cx = Number(lblProps.x || 0) + Number(lblProps.width || 0) / 2;
                            const numY = Math.max(12, barY - 5);

                            if (!isPeak || !velocitySummary.peakLabel) {
                              return (
                                <text
                                  key={`v-lbl-${lblProps.index}`}
                                  x={cx}
                                  y={numY}
                                  textAnchor="middle"
                                  fill="#334155"
                                  fontSize="9.5"
                                  fontWeight="700"
                                >
                                  {valLabel}
                                </text>
                              );
                            }

                            const pillX = Math.max(46, Math.min(chartW - 46, cx));
                            const pillY = Math.max(2, numY - 26);
                            const pillText = `${velocitySummary.peakLabel} Peak`;
                            const pillW = Math.max(62, pillText.length * 5.6 + 14);
                            return (
                              <g key={`pk-lbl-${lblProps.index}`}>
                                <rect
                                  x={pillX - pillW / 2}
                                  y={pillY}
                                  width={pillW}
                                  height={14}
                                  rx={7}
                                  fill="#0d9488"
                                />
                                <text
                                  x={pillX}
                                  y={pillY + 10}
                                  textAnchor="middle"
                                  fill="#ffffff"
                                  fontSize="8.5"
                                  fontWeight="700"
                                >
                                  {pillText}
                                </text>
                                <text
                                  x={cx}
                                  y={numY}
                                  textAnchor="middle"
                                  fill="#0f766e"
                                  fontSize="9.5"
                                  fontWeight="800"
                                >
                                  {valLabel}
                                </text>
                              </g>
                            );
                          }}
                        >
                          {reversedTimeSeries.map((row) => {
                            const val = isTaskMode ? row.totalTasks : row.totalPoints;
                            const isPeak = velocitySummary.peakVal > 0 && Math.abs(val - velocitySummary.peakVal) < 0.05;
                            const fill = val <= 0
                              ? '#cbd5e1'
                              : isPeak
                                ? 'url(#kpiVelocityPeakGrad)'
                                : 'url(#kpiVelocityBarGrad)';
                            return <Cell key={`bar-${row.period}`} fill={fill} />;
                          })}
                        </Bar>
                      </ComposedChart>
                    )}</MeasuredChart>
                  )}
                </div>
              </div>
            </div>

            {/* Chart 2 (5 cols): Monthly Target vs Actual Achievement & Pace Donut */}
            <KpiTargetComparisonDonut
              periodLabel={KPI_PERIOD_LABEL[period]}
              targetLabel={activeTargets.label}
              actualPoints={totals.totalPoints}
              targetPoints={totals.totalBranchTargetPoints}
              showPacing={period === 'MONTH' || period === 'ALL'}
              pacingRatio={pacingInfo.pacingRatio}
              elapsedWorkDays={pacingInfo.elapsedWorkDays}
              totalWorkDays={pacingInfo.totalWorkDays}
            />
          </div>
        </section>
          </AfterPaint>
        )}
      </div>

      {/* ───────────── Most KPI Types Consumed (Push Configuring Hub Backdrop Style) ───────────── */}
      <div className={showSection('all') ? 'contents' : 'hidden'}>
        <AfterPaint order={2} minHeight={249}>
        <section
          className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden p-4 sm:p-5 space-y-4 silk-lift"
          style={{ '--silk-i': 6 } as React.CSSProperties}
          aria-label="Most KPI Types Consumed"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-sky-50 text-[#002F4A] border border-sky-100 flex items-center justify-center shrink-0">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  {isTaskMode ? 'KPI Types & Task Breakdown' : 'KPI Types & Point Breakdown'}
                </h3>
                <p className="text-[11.5px] text-slate-500 font-medium">Hardware deployments, QR merchant onboarding, and card acquisitions · click a category to filter</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowSubCategories((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold text-xs border shadow-2xs cursor-pointer bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-200/90 transition"
              >
                <span>{showSubCategories ? 'Hide sub-category tasks' : `Show ${subCategoryBreakdown.length} sub-category tasks (${activeSubCategoryCount} active)`}</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showSubCategories ? 'rotate-180' : ''}`} />
              </button>
            </div>
          </div>

          <div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3.5">
              {([
                { cat: 'KHQR' as KpiCategory, tasks: totals.khqrTasks, pts: totals.khqrPoints, extra: `${fmtInt(totals.raw.khqrInstall)} new · ${fmtInt(totals.raw.khqrReplace)} replaced · ${fmtInt(totals.khqrMaterials)} QR items` },
                { cat: 'Sound Box' as KpiCategory, tasks: totals.sbTasks, pts: totals.sbPoints, extra: `${fmtInt(totals.raw.sbInstall)} install · ${fmtInt(Number(totals.raw.extra?.['SB_MAINTENANCE']) || 0)} maint · ${fmtInt(totals.raw.sbMaint)} op. support` },
                { cat: 'Credit Card' as KpiCategory, tasks: totals.ccTasks, pts: totals.ccPoints, extra: `${fmtInt(totals.raw.ccPrimary)} primary · ${fmtInt(totals.raw.ccSupp)} supplementary` },
                { cat: 'POS Terminal' as KpiCategory, tasks: totals.posTasks, pts: totals.posPoints, extra: `${fmtInt(totals.raw.posInstall)} install · ${fmtInt(totals.raw.posReplace)} swap · ${fmtInt(Number(totals.raw.extra?.['POS_MAINT']) || Number(totals.raw.posMaint) || 0)} op. support` },
                { cat: 'Merchant Visit' as KpiCategory, tasks: totals.mvTasks, pts: totals.mvPoints, extra: `${fmtInt(totals.mvTasks)} field visits logged` },
              ]).map((item) => {
                const volShare = totals.totalTasks > 0 ? Math.round((item.tasks / totals.totalTasks) * 100) : 0;
                const ptShare = totals.totalPoints > 0 ? Math.round((item.pts / totals.totalPoints) * 100) : 0;
                const style = CAT_COLORS[item.cat];
                const Icon = style.Icon;
                const activeFilter = categoryFilter === item.cat;
                return (
                  <button
                    key={item.cat}
                    type="button"
                    onClick={() => {
                      setCategoryFilter((c) => (c === item.cat ? 'ALL' : item.cat));
                      setShowSubCategories(true);
                    }}
                    className={`text-left rounded-2xl border p-4 transition-all cursor-pointer shadow-2xs hover:shadow-md hover:-translate-y-0.5 bg-white ${
                      activeFilter ? 'border-[#1e5b88] ring-2 ring-sky-100' : 'border-slate-200/90 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2.5">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border ${style.badge}`}>
                        <Icon className="w-3.5 h-3.5" /> {item.cat}
                      </span>
                      <span className="font-figure text-xl font-bold text-slate-900 tabular-nums">
                        {isTaskMode ? (
                          <>{fmtInt(item.tasks)} <span className="text-xs font-medium text-slate-600">tasks</span></>
                        ) : (
                          <>{fmtPts(item.pts)} <span className="text-xs font-medium text-slate-600">pts</span></>
                        )}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 my-2.5 text-xs">
                      <div>
                        <div className="text-[11px] font-medium text-slate-600">Task volume</div>
                        <div className="font-semibold text-slate-900 tabular-nums mt-0.5">{fmtInt(item.tasks)} <span className="font-normal text-slate-600">({volShare}%)</span></div>
                      </div>
                      <div>
                        <div className="text-[11px] font-medium text-slate-600">{isTaskMode ? 'Points earned' : 'Point share'}</div>
                        <div className="font-semibold text-slate-900 tabular-nums mt-0.5">
                          {isTaskMode ? (
                            <>{fmtPts(item.pts)} <span className="font-normal text-slate-600">pts ({ptShare}%)</span></>
                          ) : (
                            <>{ptShare}% <span className="font-normal text-slate-600">of total</span></>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden mb-2.5">
                      <div className={`h-full rounded-full transition-all duration-300 ${style.bar}`} style={{ width: `${Math.max(4, isTaskMode ? volShare : ptShare)}%` }} />
                    </div>
                    <div className="pt-2 border-t border-slate-100 text-[11.5px] font-medium text-slate-700 truncate">{item.extra}</div>
                  </button>
                );
              })}
            </div>

            <AnimatePresence initial={false}>
              {showSubCategories && (
                <motion.div
                  variants={ACCORDION_EXPAND_VARIANTS}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                >
                  <div className="mt-4 rounded-2xl border border-slate-200/90 bg-white shadow-2xs overflow-hidden">
                    {/* Header Toolbar */}
                    <div className="bg-slate-50/90 border-b border-slate-200/90 p-3 sm:p-4 space-y-3">
                      {/* Top Row: Title, badges, and controls */}
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold uppercase tracking-wider text-slate-800">
                            Sub-Category Task Breakdown
                          </span>
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-200/80 text-slate-700">
                            {displayedSubCategories.length} {displayedSubCategories.length === 1 ? 'task' : 'tasks'}
                          </span>
                          {categoryFilter !== 'ALL' && (
                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${CAT_COLORS[categoryFilter].badge}`}>
                              <span>{categoryFilter}</span>
                              <button
                                type="button"
                                onClick={() => setCategoryFilter('ALL')}
                                className="hover:opacity-75 cursor-pointer ml-0.5 inline-flex items-center"
                                title="Clear category filter"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          )}
                        </div>

                        {/* View Options & Active Filter */}
                        <div className="flex flex-wrap items-center gap-2">
                          {/* Active Only Filter */}
                          <button
                            type="button"
                            onClick={() => setSubCatActiveOnly((v) => !v)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border shadow-2xs cursor-pointer transition ${
                              subCatActiveOnly
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100/80'
                                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                            }`}
                            title={subCatActiveOnly ? 'Click to show all rules (including 0 pts)' : 'Click to hide 0-pt standby rules'}
                          >
                            <span className={`w-2 h-2 rounded-full ${subCatActiveOnly ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                            <span>{subCatActiveOnly ? `Active Only (${activeSubCategoryCount})` : `All Rules (${totalInSelectedCategory})`}</span>
                          </button>

                          {/* Rank By Switcher */}
                          <div className={CAPSULE_TRACK_CLS} role="tablist" aria-label="Rank sub-categories by">
                            <button
                              type="button"
                              role="tab"
                              aria-selected={subCatRankBy === 'points'}
                              onClick={() => setSubCatRankBy('points')}
                              className={`relative px-3 py-1.5 rounded-full text-xs flex items-center gap-1.5 cursor-pointer transition-colors select-none outline-none ${
                                subCatRankBy === 'points' ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
                              }`}
                              title="Rank and chart by KPI Points"
                            >
                              {subCatRankBy === 'points' && (
                                <PillMotion
                                  layoutId={SHARED_LAYOUT_IDS.KPI_SUBCAT_RANK_PILL}
                                  aria-hidden
                                  transition={SPRING_TAB_PILL}
                                  className={CAPSULE_PILL_CLS}
                                />
                              )}
                              <Award className="w-3.5 h-3.5 relative z-10 text-amber-500" />
                              <span className="relative z-10">By Points</span>
                            </button>
                            <button
                              type="button"
                              role="tab"
                              aria-selected={subCatRankBy === 'tasks'}
                              onClick={() => setSubCatRankBy('tasks')}
                              className={`relative px-3 py-1.5 rounded-full text-xs flex items-center gap-1.5 cursor-pointer transition-colors select-none outline-none ${
                                subCatRankBy === 'tasks' ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
                              }`}
                              title="Rank and chart by Task Count"
                            >
                              {subCatRankBy === 'tasks' && (
                                <PillMotion
                                  layoutId={SHARED_LAYOUT_IDS.KPI_SUBCAT_RANK_PILL}
                                  aria-hidden
                                  transition={SPRING_TAB_PILL}
                                  className={CAPSULE_PILL_CLS}
                                />
                              )}
                              <CheckSquare className="w-3.5 h-3.5 relative z-10 text-emerald-600" />
                              <span className="relative z-10">Task Count</span>
                            </button>
                          </div>

                          {/* View Mode Switcher */}
                          <div className={CAPSULE_TRACK_CLS} role="tablist" aria-label="View mode">
                            <button
                              type="button"
                              role="tab"
                              aria-selected={subCatViewMode === 'graph'}
                              onClick={() => setSubCatViewMode('graph')}
                              className={`relative px-3 py-1.5 rounded-full text-xs flex items-center gap-1.5 cursor-pointer transition-colors select-none outline-none ${
                                subCatViewMode === 'graph' ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
                              }`}
                              title="Sorted Horizontal Bar Graph"
                            >
                              {subCatViewMode === 'graph' && (
                                <PillMotion
                                  layoutId={SHARED_LAYOUT_IDS.KPI_SUBCAT_VIEW_PILL}
                                  aria-hidden
                                  transition={SPRING_TAB_PILL}
                                  className={CAPSULE_PILL_CLS}
                                />
                              )}
                              <BarChart3 className="w-3.5 h-3.5 relative z-10 text-sky-600" />
                              <span className="hidden sm:inline relative z-10">Graph</span>
                            </button>
                            <button
                              type="button"
                              role="tab"
                              aria-selected={subCatViewMode === 'table'}
                              onClick={() => setSubCatViewMode('table')}
                              className={`relative px-3 py-1.5 rounded-full text-xs flex items-center gap-1.5 cursor-pointer transition-colors select-none outline-none ${
                                subCatViewMode === 'table' ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
                              }`}
                              title="Detailed Table View"
                            >
                              {subCatViewMode === 'table' && (
                                <PillMotion
                                  layoutId={SHARED_LAYOUT_IDS.KPI_SUBCAT_VIEW_PILL}
                                  aria-hidden
                                  transition={SPRING_TAB_PILL}
                                  className={CAPSULE_PILL_CLS}
                                />
                              )}
                              <List className="w-3.5 h-3.5 relative z-10 text-emerald-600" />
                              <span className="hidden sm:inline relative z-10">Table</span>
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Second Row: Category Pills + Search Filter */}
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 pt-2 border-t border-slate-200/60">
                        {/* Segmented Category Filter Tabs */}
                        <div
                          role="tablist"
                          aria-label="Filter tasks by category"
                          className={`${CAPSULE_TRACK_CLS} flex-wrap`}
                        >
                          {([
                            { id: 'ALL' as const, label: 'All', catStyle: null, count: subCategoryBreakdown.length },
                            ...(['KHQR', 'Sound Box', 'Credit Card', 'POS Terminal', 'Merchant Visit'] as KpiCategory[]).map((cat) => ({
                              id: cat,
                              label: cat,
                              catStyle: CAT_COLORS[cat],
                              count: subCatActiveOnly
                                ? subCategoryBreakdown.filter((sc) => sc.category === cat && (sc.points > 0 || sc.count > 0)).length
                                : subCategoryBreakdown.filter((sc) => sc.category === cat).length,
                            })),
                          ]).map(({ id, label, catStyle, count }) => {
                            const active = categoryFilter === id;
                            return (
                              <button
                                key={id}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                onClick={() => setCategoryFilter(active && id !== 'ALL' ? 'ALL' : id)}
                                className={`relative px-3 py-1.5 rounded-full text-xs transition-colors cursor-pointer select-none outline-none inline-flex items-center gap-1.5 ${
                                  active ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
                                }`}
                              >
                                {active && (
                                  <PillMotion
                                    layoutId={SHARED_LAYOUT_IDS.KPI_SUBCAT_CATEGORY_PILL}
                                    aria-hidden
                                    transition={SPRING_TAB_PILL}
                                    className={CAPSULE_PILL_CLS}
                                  />
                                )}
                                <span
                                  className={`w-2 h-2 rounded-full relative z-10 shrink-0 transition-colors ${
                                    catStyle ? catStyle.dot : 'bg-[#004e75]'
                                  }`}
                                />
                                <span className="relative z-10">{label}</span>
                                <span
                                  className={`relative z-10 text-[10.5px] px-1.5 py-0.2 rounded-full font-mono transition-colors ${
                                    active ? CAPSULE_COUNT_ACTIVE_CLS : CAPSULE_COUNT_INACTIVE_CLS
                                  }`}
                                >
                                  {count}
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        {/* Search Input */}
                        <div className="relative w-full sm:w-72 md:w-80 lg:w-96 shrink-0">
                          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                          <input
                            type="text"
                            value={subCatSearch}
                            onChange={(e) => setSubCatSearch(e.target.value)}
                            placeholder="Filter tasks (e.g. roll, swap)..."
                            className="w-full pl-10 pr-9 py-2.5 text-[13px] sm:text-sm rounded-xl border border-slate-200 bg-white shadow-2xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-500/20 transition-all"
                          />
                          {subCatSearch && (
                            <button
                              type="button"
                              onClick={() => setSubCatSearch('')}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                              title="Clear search"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Content: Empty State, Cards, or Table */}
                    {displayedSubCategories.length === 0 ? (
                      <div className="p-8 text-center bg-white">
                        <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-2">
                          <Search className="w-5 h-5" />
                        </div>
                        <p className="text-sm font-semibold text-slate-700">No sub-category tasks found</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          No tasks match your active filters {subCatActiveOnly ? '(0-pt standby rules are currently hidden)' : ''}.
                        </p>
                        <div className="mt-3.5 flex flex-wrap items-center justify-center gap-2">
                          {subCatSearch && (
                            <button
                              type="button"
                              onClick={() => setSubCatSearch('')}
                              className="px-3 py-1 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer"
                            >
                              Clear search query
                            </button>
                          )}
                          {categoryFilter !== 'ALL' && (
                            <button
                              type="button"
                              onClick={() => setCategoryFilter('ALL')}
                              className="px-3 py-1 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer"
                            >
                              Show all categories
                            </button>
                          )}
                          {subCatActiveOnly && (
                            <button
                              type="button"
                              onClick={() => setSubCatActiveOnly(false)}
                              className="px-3 py-1 rounded-lg text-xs font-semibold bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 transition cursor-pointer"
                            >
                              Show all {totalInSelectedCategory} rules
                            </button>
                          )}
                        </div>
                      </div>
                    ) : subCatViewMode === 'graph' ? (
                      (() => {
                        const isTaskRank = subCatRankBy === 'tasks';
                        const metricValOf = (item: typeof displayedSubCategories[number]) =>
                          isTaskRank ? subCatTaskVolume(item) : item.points;
                        const maxMetricVal = displayedSubCategories.reduce(
                          (m, item) => Math.max(m, metricValOf(item)),
                          0
                        );
                        const metricDenom = isTaskRank ? totals.totalTasks : totals.totalPoints;
                        const activeItem =
                          (hoveredSubCatCode
                            ? displayedSubCategories.find((item) => item.code === hoveredSubCatCode)
                            : null) ?? displayedSubCategories[0];
                        const activeRank = activeItem
                          ? displayedSubCategories.findIndex((item) => item.code === activeItem.code) + 1
                          : 0;
                        const activeMetricVal = activeItem ? metricValOf(activeItem) : 0;
                        const activePct = metricDenom > 0 ? (activeMetricVal / metricDenom) * 100 : 0;
                        const activePctDisplay = formatSubCatSharePct(activePct);
                        const fmtAxisTick = (val: number) => {
                          if (val <= 0) return '0';
                          if (val >= 1000) {
                            return `${(val / 1000).toFixed(val >= 10000 || val % 1000 === 0 ? 0 : 1)}k`;
                          }
                          return isTaskRank ? fmtInt(Math.round(val)) : fmtPts(val);
                        };
                        const scaleTicks = maxMetricVal > 0 ? [0, 0.25, 0.5, 0.75, 1] : [0];

                        return (
                          <div className="p-3.5 sm:p-5 bg-slate-50/50">
                            <div
                              data-testid="subcat-horizontal-graph"
                              className="rounded-xl border border-slate-200/85 bg-white px-3.5 py-4 sm:px-5 sm:py-5 shadow-2xs"
                            >
                              {/* Legend + Live Task Inspector */}
                              <div className="mb-4 pb-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2.5">
                                <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                                  <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                                    <span className="w-3 h-2.5 rounded-r-[3px] bg-[#0284c7] inline-block" />
                                    Top Contributor
                                  </span>
                                  <span className="inline-flex items-center gap-1.5">
                                    <span className="w-3 h-2.5 rounded-r-[3px] bg-[#94a3b8] inline-block" />
                                    {isTaskRank ? 'Sorted by Task Count (High → Low)' : 'Sorted High → Low'}
                                  </span>
                                </div>
                                {activeItem && (() => {
                                  const activeStyle = CAT_COLORS[activeItem.category];
                                  const ActiveIcon = activeStyle.Icon;
                                  return (
                                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] bg-slate-50 border border-slate-200/80 rounded-lg px-2.5 py-1 text-slate-600 tabular-nums">
                                      <span className="font-bold text-slate-800">{activeRank}.</span>
                                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.2 rounded border text-[10px] font-semibold ${activeStyle.badge}`}>
                                        <ActiveIcon className="w-2.5 h-2.5 shrink-0" />
                                        {activeItem.category}
                                      </span>
                                      <span className="font-semibold text-slate-800 max-w-[180px] sm:max-w-[240px] truncate">
                                        {activeItem.label}
                                      </span>
                                      <span className="text-slate-400">·</span>
                                      <span>
                                        <span className="font-semibold text-slate-700">{fmtInt(activeItem.count)}</span> {activeItem.unit} × {activeItem.unitPts} pt
                                      </span>
                                      <span className="text-slate-400">=</span>
                                      {isTaskRank ? (
                                        <>
                                          <span className="font-bold text-slate-900">
                                            {fmtInt(activeMetricVal)} tasks
                                          </span>
                                          <span className="text-slate-400">
                                            ({activePctDisplay} · {fmtPts(activeItem.points)} pts)
                                          </span>
                                        </>
                                      ) : (
                                        <>
                                          <span className="font-bold text-slate-900">
                                            {fmtPts(activeItem.points)} pts
                                          </span>
                                          <span className="text-slate-400">({activePctDisplay})</span>
                                        </>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>

                              {/* Sorted Horizontal Bars + Crisp Vertical Y-Axis Spine */}
                              <div className="relative flex flex-col">
                                {/* Vertical Y-axis spine + dashed X-axis gridlines aligned to bar scale */}
                                <div className="pointer-events-none absolute inset-0 flex">
                                  <div className="w-[132px] sm:w-[238px] md:w-[266px] shrink-0" />
                                  <div className="flex-1 min-w-0 relative mr-[76px] sm:mr-[136px]">
                                    <div className="absolute inset-y-0 left-0 border-l-2 border-slate-400/85 z-10" />
                                    {scaleTicks.slice(1).map((tick) => (
                                      <div
                                        key={tick}
                                        className={`absolute inset-y-0 border-l border-dashed border-slate-200/85 ${
                                          tick > 0 && tick < 1 ? 'hidden sm:block' : ''
                                        }`}
                                        style={{ left: `${tick * 100}%` }}
                                      />
                                    ))}
                                  </div>
                                </div>

                                <div className="relative z-10 py-1.5 space-y-1.5" role="list" aria-label="Sorted sub-category tasks bar graph">
                                  {displayedSubCategories.map((sc, i) => {
                                    const metricVal = metricValOf(sc);
                                    const pct = metricDenom > 0 ? (metricVal / metricDenom) * 100 : 0;
                                    const pctDisplay = formatSubCatSharePct(pct);
                                    const barPct = maxMetricVal > 0 ? (metricVal / maxMetricVal) * 100 : 0;
                                    const catStyle = CAT_COLORS[sc.category];
                                    const isBonusOnly = isTaskRank && isPointsOnlyBonusRule(sc.code);
                                    const isZero = metricVal === 0;
                                    const isTop = i === 0 && !isZero;
                                    const isHovered = hoveredSubCatCode === sc.code;
                                    const isHighlighted = !isZero && (isHovered || (isTop && !hoveredSubCatCode));

                                    return (
                                      <div
                                        key={sc.code}
                                        tabIndex={0}
                                        role="listitem"
                                        aria-label={`${i + 1} ${sc.label}, ${sc.category}, ${fmtInt(sc.count)} ${sc.unit}, ${
                                          isTaskRank
                                            ? `${fmtInt(metricVal)} tasks (${pctDisplay} task share)`
                                            : `${fmtPts(sc.points)} points (${pctDisplay} point share)`
                                        }`}
                                        title={`${sc.label} (${sc.category}) — ${fmtInt(sc.count)} ${sc.unit} × ${sc.unitPts} pt = ${fmtPts(sc.points)} pts${
                                          isBonusOnly ? ' (bonus multiplier — not counted as separate task)' : ''
                                        }`}
                                        onMouseEnter={() => setHoveredSubCatCode(sc.code)}
                                        onMouseLeave={() =>
                                          setHoveredSubCatCode((cur) => (cur === sc.code ? null : cur))
                                        }
                                        onFocus={() => setHoveredSubCatCode(sc.code)}
                                        onBlur={() =>
                                          setHoveredSubCatCode((cur) => (cur === sc.code ? null : cur))
                                        }
                                        className="group flex items-center rounded-md py-0.5 transition-colors hover:bg-sky-50/45 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
                                      >
                                        {/* Y-Axis Label (Aligned rank column + aligned category dot + clean left-aligned task name) */}
                                        <div className="w-[132px] sm:w-[238px] md:w-[266px] shrink-0 pl-1 sm:pl-1.5 pr-2.5 sm:pr-3.5 flex items-center gap-1.5 sm:gap-2 min-w-0">
                                          <span
                                            className={`hidden sm:inline-block w-5 text-right text-[11px] font-mono tabular-nums shrink-0 ${
                                              isTop
                                                ? 'font-bold text-sky-600'
                                                : isZero
                                                ? 'text-slate-300'
                                                : 'text-slate-400'
                                            }`}
                                          >
                                            {i + 1}
                                          </span>
                                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${catStyle.dot} ${isZero ? 'opacity-40' : ''}`} />
                                          <span
                                            className={`flex-1 min-w-0 text-left text-[11.5px] sm:text-[12.5px] truncate transition-colors ${
                                              isZero
                                                ? 'text-slate-400 font-normal'
                                                : isHighlighted
                                                ? 'font-semibold text-slate-900'
                                                : 'font-medium text-slate-600 group-hover:text-slate-900'
                                            }`}
                                          >
                                            {sc.label}
                                          </span>
                                        </div>

                                        {/* Plot Track + Flush Horizontal Bar + Inline Readout */}
                                        <div className="flex-1 min-w-0 pr-[76px] sm:pr-[136px]">
                                          <div className="relative h-6 sm:h-[26px] flex items-center">
                                            <div
                                              className={`h-full rounded-r-[4px] transition-all duration-300 shrink-0 ${
                                                isZero
                                                  ? 'bg-slate-200/90'
                                                  : isHovered
                                                  ? 'bg-[#0284c7] shadow-[0_1px_4px_rgba(2,132,199,0.28)]'
                                                  : isTop
                                                  ? hoveredSubCatCode
                                                    ? 'bg-[#0284c7]/70'
                                                    : 'bg-[#0284c7]'
                                                  : 'bg-[#94a3b8] group-hover:bg-[#0284c7]'
                                              }`}
                                              style={{
                                                width: isZero ? '3px' : `${Math.max(1.2, barPct)}%`,
                                              }}
                                            />
                                            <div className="ml-2 sm:ml-2.5 shrink-0 whitespace-nowrap tabular-nums text-[11px] sm:text-[11.5px] leading-none flex items-center gap-1.5">
                                              <span
                                                className={
                                                  isZero
                                                    ? 'text-slate-400 font-normal'
                                                    : isHighlighted
                                                    ? 'font-bold text-slate-900'
                                                    : 'font-semibold text-slate-700'
                                                }
                                              >
                                                {isTaskRank ? fmtInt(metricVal) : fmtPts(sc.points)}
                                                <span className="hidden sm:inline font-normal text-slate-400">
                                                  {isTaskRank ? ' tasks' : ' pts'}
                                                </span>
                                              </span>
                                              {!isZero ? (
                                                <span className="text-[10px] font-medium text-slate-400">
                                                  {pctDisplay}
                                                </span>
                                              ) : isBonusOnly && sc.count > 0 ? (
                                                <span className="hidden sm:inline text-[10px] font-normal text-slate-400">
                                                  (bonus)
                                                </span>
                                              ) : null}
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* X-Axis Metric Scale */}
                              <div className="mt-1 flex items-start">
                                <div className="w-[132px] sm:w-[238px] md:w-[266px] shrink-0 pr-2.5 sm:pr-3.5 pt-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                                  {isTaskRank ? 'Tasks' : 'Points'}
                                </div>
                                <div className="flex-1 min-w-0 pr-[76px] sm:pr-[136px]">
                                  <div className="relative h-5 border-t border-slate-200/80">
                                    {scaleTicks.map((tick) => (
                                      <span
                                        key={tick}
                                        className={`absolute top-1.5 text-[10px] font-medium text-slate-400 tabular-nums whitespace-nowrap ${
                                          tick === 0
                                            ? 'left-0'
                                            : tick === 1
                                            ? 'right-0'
                                            : 'hidden sm:inline -translate-x-1/2'
                                        }`}
                                        style={tick > 0 && tick < 1 ? { left: `${tick * 100}%` } : undefined}
                                      >
                                        {fmtAxisTick(maxMetricVal * tick)}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })()
                    ) : (() => {
                      return (
                        <div className="overflow-x-auto bg-white">
                          <table className="w-full text-left text-[13px] text-slate-700">
                            <thead className="bg-slate-50/90 text-[11.5px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                              <tr>
                                <th className="py-2.5 px-2.5 w-10 text-center">#</th>
                                <th className="py-2.5 px-2.5 whitespace-nowrap">Sub-Category Task</th>
                                <th className="py-2.5 px-2.5 whitespace-nowrap">Category</th>
                                <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Recorded Volume</th>
                                <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Weight</th>
                                <th className="py-2.5 px-2.5 text-right whitespace-nowrap">
                                  Task Count{subCatRankBy === 'tasks' ? ' ↓' : ''}
                                </th>
                                <th className="py-2.5 px-2.5 text-right w-32 whitespace-nowrap">Task Share</th>
                                <th className="py-2.5 px-2.5 text-right whitespace-nowrap">
                                  Total Points{subCatRankBy === 'points' ? ' ↓' : ''}
                                </th>
                                <th className="py-2.5 px-2.5 text-right w-32 whitespace-nowrap">Point Share</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                              {displayedSubCategories.map((sc, i) => {
                                const pct = totals.totalPoints > 0 ? (sc.points / totals.totalPoints) * 100 : 0;
                                const pctDisplay = formatSubCatSharePct(pct);
                                const isPointsOnlyRule = isPointsOnlyBonusRule(sc.code);
                                const taskCount = isPointsOnlyRule ? null : sc.count;
                                const taskPct =
                                  taskCount !== null && totals.totalTasks > 0
                                    ? (taskCount / totals.totalTasks) * 100
                                    : 0;
                                const taskPctDisplay = formatSubCatSharePct(taskPct);
                                const catStyle = CAT_COLORS[sc.category];
                                const isZero = sc.points === 0 && sc.count === 0;

                                return (
                                  <tr key={sc.code} className={`hover:bg-slate-50/80 transition-colors ${isZero ? 'opacity-50' : ''}`}>
                                    <td className="py-3 px-2.5 text-center font-mono text-[13px] text-slate-400 tabular-nums whitespace-nowrap">
                                      {i + 1}
                                    </td>
                                    <td className="py-3 px-2.5 font-semibold text-slate-900 whitespace-nowrap">
                                      {sc.label}
                                    </td>
                                    <td className="py-3 px-2.5 text-slate-600 whitespace-nowrap">
                                      {sc.category}
                                    </td>
                                    <td className="py-3 px-2.5 text-right font-medium text-slate-700 tabular-nums whitespace-nowrap">
                                      {fmtInt(sc.count)} <span className="text-slate-400 font-normal">{sc.unit}</span>
                                    </td>
                                    <td className="py-3 px-2.5 text-right text-slate-600 tabular-nums whitespace-nowrap">
                                      {sc.unitPts} pt
                                    </td>
                                    <td
                                      className="py-3 px-2.5 text-right font-semibold text-slate-900 tabular-nums text-[13.5px] whitespace-nowrap"
                                      title={isPointsOnlyRule ? 'Points-only bonus multiplier (counted under primary KHQR tasks)' : undefined}
                                    >
                                      {taskCount !== null ? fmtInt(taskCount) : <span className="text-slate-400 font-normal">—</span>}
                                    </td>
                                    <td className="py-3 px-2.5 text-right tabular-nums whitespace-nowrap">
                                      {taskCount !== null ? (
                                        <div className="flex items-center justify-end gap-2">
                                          <span className="font-semibold text-slate-700 text-[13px] min-w-[36px] text-right">{taskPctDisplay}</span>
                                          <div className="w-16 bg-slate-100 rounded-full h-2.5 overflow-hidden shrink-0">
                                            <div
                                              className={`h-full rounded-full ${catStyle.bar}`}
                                              style={{ width: `${Math.min(100, Math.max(taskCount === 0 ? 0 : 6, taskPct))}%` }}
                                            />
                                          </div>
                                        </div>
                                      ) : (
                                        <span className="text-slate-400 font-normal">—</span>
                                      )}
                                    </td>
                                    <td className="py-3 px-2.5 text-right font-bold text-slate-900 tabular-nums text-[13.5px] whitespace-nowrap">
                                      {fmtPts(sc.points)} pts
                                    </td>
                                    <td className="py-3 px-2.5 text-right tabular-nums whitespace-nowrap">
                                      <div className="flex items-center justify-end gap-2">
                                        <span className="font-semibold text-slate-700 text-[13px] min-w-[36px] text-right">{pctDisplay}</span>
                                        <div className="w-16 bg-slate-100 rounded-full h-2.5 overflow-hidden shrink-0">
                                          <div
                                            className={`h-full rounded-full ${catStyle.bar}`}
                                            style={{ width: `${Math.min(100, Math.max(sc.points === 0 ? 0 : 6, pct))}%` }}
                                          />
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                            {displayedSubCategories.length > 0 && (() => {
                              const totalSharePct =
                                totals.totalPoints > 0 ? (displayedSubCategoryPoints / totals.totalPoints) * 100 : 0;
                              const totalShareDisplay = formatSubCatSharePct(totalSharePct);
                              const totalTaskSharePct =
                                totals.totalTasks > 0 ? (displayedSubCategoryTasks / totals.totalTasks) * 100 : 0;
                              const totalTaskShareDisplay = formatSubCatSharePct(totalTaskSharePct);
                              const hasBonusOnlyRules = displayedSubCategories.some((sc) =>
                                isPointsOnlyBonusRule(sc.code)
                              );

                              return (
                                <tfoot>
                                  <tr className="bg-slate-50/95 border-t-2 border-slate-300 text-[13px] font-semibold text-slate-800 whitespace-nowrap">
                                    <td colSpan={3} className="py-3 px-2.5 text-slate-900">
                                      Total
                                      <span className="ml-1.5 font-normal text-slate-500">
                                        ({displayedSubCategories.length} sub-categories)
                                      </span>
                                    </td>
                                    <td className="py-3 px-2.5 text-right text-slate-400 font-normal">—</td>
                                    <td className="py-3 px-2.5 text-right text-slate-400 font-normal">—</td>
                                    <td
                                      className="py-3 px-2.5 text-right font-bold text-slate-900 tabular-nums text-[13.5px] whitespace-nowrap"
                                      title={
                                        hasBonusOnlyRules
                                          ? 'Sum of KPI tasks across displayed sub-categories (excludes points-only bonus multipliers such as Print & Laminate / QR Materials)'
                                          : 'Sum of KPI tasks across displayed sub-categories'
                                      }
                                    >
                                      {fmtInt(displayedSubCategoryTasks)} tasks
                                    </td>
                                    <td className="py-3 px-2.5 text-right tabular-nums whitespace-nowrap">
                                      <div className="flex items-center justify-end gap-2">
                                        <span className="font-bold text-slate-800 text-[13px] min-w-[36px] text-right">{totalTaskShareDisplay}</span>
                                        <div className="w-16 bg-slate-200/70 rounded-full h-2.5 overflow-hidden shrink-0">
                                          <div
                                            className="h-full rounded-full bg-slate-700"
                                            style={{ width: `${Math.min(100, Math.max(displayedSubCategoryTasks > 0 ? 6 : 0, totalTaskSharePct))}%` }}
                                          />
                                        </div>
                                      </div>
                                    </td>
                                    <td className="py-3 px-2.5 text-right font-bold text-slate-900 tabular-nums text-[13.5px] whitespace-nowrap">
                                      {fmtPts(displayedSubCategoryPoints)} pts
                                    </td>
                                    <td className="py-3 px-2.5 text-right tabular-nums whitespace-nowrap">
                                      <div className="flex items-center justify-end gap-2">
                                        <span className="font-bold text-slate-800 text-[13px] min-w-[36px] text-right">{totalShareDisplay}</span>
                                        <div className="w-16 bg-slate-200/70 rounded-full h-2.5 overflow-hidden shrink-0">
                                          <div
                                            className="h-full rounded-full bg-slate-700"
                                            style={{ width: `${Math.min(100, Math.max(displayedSubCategoryPoints > 0 ? 6 : 0, totalSharePct))}%` }}
                                          />
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                </tfoot>
                              );
                            })()}
                          </table>
                        </div>
                      );
                    })()}

                    {/* Footer Summary Bar */}
                    <div className="bg-slate-50 px-4 py-2.5 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                      <div>
                        {subCatActiveOnly ? (
                          <span>
                            Showing <strong>{displayedSubCategories.length}</strong> active tasks ({fmtPts(displayedSubCategoryPoints)} pts).
                            {totalInSelectedCategory - activeSubCategoryCount > 0 && (
                              <span className="text-slate-400"> · {totalInSelectedCategory - activeSubCategoryCount} standby rules with 0 pts hidden</span>
                            )}
                          </span>
                        ) : (
                          <span>
                            Showing all <strong>{displayedSubCategories.length}</strong> rules ({fmtPts(displayedSubCategoryPoints)} pts).
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 font-medium">
                        <button
                          type="button"
                          onClick={() => setSubCatActiveOnly((v) => !v)}
                          className="text-sky-700 hover:text-sky-800 hover:underline cursor-pointer"
                        >
                          {subCatActiveOnly ? `Show all ${totalInSelectedCategory} rules` : `Show active tasks only (${activeSubCategoryCount})`}
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>
        </AfterPaint>
      </div>

      {/* ───────────── Combined Institutional Leaderboard (Top 10 Staff & Branch Switchable) ───────────── */}
      <div className={showSection('all') || showSection('top10') ? 'contents' : 'hidden'}>
        <AfterPaint order={view === 'all' ? 2 : 1} minHeight={420}>
        <section
          className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden p-4 sm:p-5 space-y-4 silk-lift"
          style={{ '--silk-i': view === 'all' ? 6 : 4 } as React.CSSProperties}
          aria-label="Top 10 Institutional Leaderboard"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-700 border border-amber-100 flex items-center justify-center shrink-0">
                <Trophy className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Institutional Leaderboards</h3>
                <p className="text-[11.5px] text-slate-500 font-medium">
                  Top 10 institutional performers and branches ranked by {isTaskMode ? 'total task count' : 'KPI points'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {/* Switch View by Staff or Branch */}
              <div className={`${CAPSULE_TRACK_CLS} text-xs shrink-0 whitespace-nowrap`} role="tablist" aria-label="Leaderboard mode">
                <button
                  type="button"
                  role="tab"
                  aria-selected={leaderboardMode === 'staff'}
                  onClick={() => startMatrixTransition(() => setLeaderboardMode('staff'))}
                  className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full cursor-pointer transition-colors ${
                    leaderboardMode === 'staff' ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
                  }`}
                >
                  {leaderboardMode === 'staff' && (
                    <PillMotion
                      layoutId="kpi-top10-mode-pill"
                      aria-hidden
                      transition={SPRING}
                      className={CAPSULE_PILL_CLS}
                    />
                  )}
                  <Users className="w-3.5 h-3.5 relative z-10 text-sky-600" aria-hidden />
                  <span className="relative z-10">Top 10 Staff</span>
                  <span className={`relative z-10 text-[10px] px-1.5 py-0.2 rounded-full font-figure tabular-nums transition-colors ${leaderboardMode === 'staff' ? CAPSULE_COUNT_ACTIVE_CLS : CAPSULE_COUNT_INACTIVE_CLS}`}>
                    {top10Data.staff.length}
                  </span>
                </button>

                <button
                  type="button"
                  role="tab"
                  aria-selected={leaderboardMode === 'branch'}
                  onClick={() => startMatrixTransition(() => setLeaderboardMode('branch'))}
                  className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full cursor-pointer transition-colors ${
                    leaderboardMode === 'branch' ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
                  }`}
                >
                  {leaderboardMode === 'branch' && (
                    <PillMotion
                      layoutId="kpi-top10-mode-pill"
                      aria-hidden
                      transition={SPRING}
                      className={CAPSULE_PILL_CLS}
                    />
                  )}
                  <Building2 className="w-3.5 h-3.5 relative z-10 text-emerald-600" aria-hidden />
                  <span className="relative z-10">Top 10 Branches</span>
                  <span className={`relative z-10 text-[10px] px-1.5 py-0.2 rounded-full font-figure tabular-nums transition-colors ${leaderboardMode === 'branch' ? CAPSULE_COUNT_ACTIVE_CLS : CAPSULE_COUNT_INACTIVE_CLS}`}>
                    {top10Data.branches.length}
                  </span>
                </button>
              </div>

              {/* Month Selector Pills */}
              <div className={`${CAPSULE_TRACK_CLS} flex-wrap`} role="tablist" aria-label="Leaderboard month">
                <button
                  type="button"
                  role="tab"
                  aria-selected={selectedTopMonth === 'ALL'}
                  onClick={() => startMatrixTransition(() => setSelectedTopMonth('ALL'))}
                  className={`relative px-3 py-1 rounded-full text-[11px] cursor-pointer transition-colors ${
                    selectedTopMonth === 'ALL' ? CAPSULE_BTN_NAVY_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
                  }`}
                >
                  {selectedTopMonth === 'ALL' && (
                    <PillMotion
                      layoutId="kpi-top10-month-pill"
                      aria-hidden
                      transition={SPRING}
                      className={CAPSULE_PILL_CLS}
                    />
                  )}
                  <span className="relative z-10">{KPI_PERIOD_LABEL[period]}</span>
                </button>
                {availableMonths.slice(0, 6).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={selectedTopMonth === m}
                    onClick={() => startMatrixTransition(() => setSelectedTopMonth(m))}
                    className={`relative px-3 py-1 rounded-full text-[11px] cursor-pointer transition-colors ${
                      selectedTopMonth === m ? CAPSULE_BTN_NAVY_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
                    }`}
                  >
                    {selectedTopMonth === m && (
                      <PillMotion
                        layoutId="kpi-top10-month-pill"
                        aria-hidden
                        transition={SPRING}
                        className={CAPSULE_PILL_CLS}
                      />
                    )}
                    <span className="relative z-10">{fmtMonth(m)}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Unified Big Detailed Table */}
          <div className="rounded-2xl border border-slate-200/90 bg-white shadow-2xs overflow-hidden flex flex-col">
            <div className="bg-slate-50/90 border-b border-slate-200/90 px-4 h-[42px] flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider">
              <span className="inline-flex items-center gap-2 text-slate-900 font-bold">
                {leaderboardMode === 'staff' ? (
                  <>
                    <Users className="w-4 h-4 text-[#002F4A]" />
                    <span>Top 10 Individual Performers · {selectedTopMonth === 'ALL' ? KPI_PERIOD_LABEL[period] : fmtMonth(selectedTopMonth)}</span>
                  </>
                ) : (
                  <>
                    <Building2 className="w-4 h-4 text-[#002F4A]" />
                    <span>Top 10 Branches · {selectedTopMonth === 'ALL' ? KPI_PERIOD_LABEL[period] : fmtMonth(selectedTopMonth)}</span>
                  </>
                )}
              </span>
              <span className="text-slate-500 font-medium normal-case text-xs">
                {isTaskMode ? 'ranked by total task count' : 'ranked by total KPI points'}
              </span>
            </div>

            <div className="overflow-x-auto overflow-y-hidden w-full overscroll-x-contain">
              {(() => {
                const top10ChannelCols = [
                  { key: 'pos', label: 'POS Terminal' },
                  { key: 'sb', label: 'Sound Box' },
                  { key: 'khqr', label: 'KHQR' },
                  { key: 'cc', label: 'Credit Card' },
                  { key: 'mv', label: 'Merchant Visit' },
                ] as const;

                const renderMetricCell = (key: string, tasks: number, pts: number) => (
                  <td key={key} className="py-2.5 px-1.5 text-center tabular-nums whitespace-nowrap">
                    <TaskPtsCell tasks={tasks} pts={pts} mode={metricMode} align="center" />
                  </td>
                );

                const colWidths = leaderboardMode === 'staff' ? TOP10_STAFF_COL_WIDTHS : TOP10_BRANCH_COL_WIDTHS;

                return (
                  <table className="top10-table w-full min-w-[1200px] table-fixed text-left border-separate border-spacing-0 text-[13px]">
                    <colgroup>
                      {colWidths.map((w, idx) => (
                        <col key={idx} style={{ width: w }} />
                      ))}
                    </colgroup>
                    <thead>
                      <tr className="navy-header-bar bg-[#002F4A] text-white text-[11px] font-semibold uppercase tracking-wide select-none">
                        <th className="text-center border-b border-white/20">No.</th>
                        {leaderboardMode === 'staff' ? (
                          <>
                            <th className="text-left border-b border-white/20">Staff Name</th>
                            <th className="text-center border-b border-white/20">Staff ID</th>
                            <th className="text-left border-b border-white/20">Branch Name</th>
                            <th className="text-center border-b border-white/20">Branch Code</th>
                          </>
                        ) : (
                          <>
                            <th className="text-left border-b border-white/20">Branch Name</th>
                            <th className="text-center border-b border-white/20">Branch Code</th>
                            <th className="text-center border-b border-white/20">Active Staff</th>
                          </>
                        )}
                        {top10ChannelCols.map(({ key, label }) => (
                          <th key={key} className="text-center border-b border-white/20 whitespace-nowrap">
                            {label}
                          </th>
                        ))}
                        <th className="text-center border-b border-white/20 whitespace-nowrap">Category Mix</th>
                        {leaderboardMode === 'branch' && (
                          <th className="text-center border-b border-white/20 whitespace-nowrap">Avg / Staff</th>
                        )}
                        <th className="text-center border-b border-white/20 whitespace-nowrap">{isTaskMode ? 'Total Pts' : 'Total Tasks'}</th>
                        <th className="text-center border-b border-white/20 whitespace-nowrap">{isTaskMode ? 'Total Tasks' : 'Total Pts'}</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-100 text-[13px] text-slate-700">
                      {leaderboardMode === 'staff' ? (
                        top10Data.staff.length === 0 ? (
                          <tr>
                            <td colSpan={13} className="py-12 text-center text-xs text-slate-400">
                              No staff records in this period.
                            </td>
                          </tr>
                        ) : (
                          top10Data.staff.map((s, i) => (
                            <tr key={s.staffId} className="hover:bg-slate-50/80 transition-colors">
                              <td className="py-2.5 px-1.5 text-center">
                                <div className="flex justify-center items-center">
                                  <RankBadge rank={i + 1} />
                                </div>
                              </td>
                              <td className="py-2.5 px-1.5">
                                <span className="font-semibold text-slate-900 text-[13px] block truncate" title={s.staffName}>
                                  {s.staffName}
                                </span>
                              </td>
                              <td className="py-2.5 px-1.5 text-center">
                                <span className="font-mono text-xs text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200/80 tabular-nums whitespace-nowrap">
                                  {s.staffId || '—'}
                                </span>
                              </td>
                              <td className="py-2.5 px-1.5">
                                <span className="text-[13px] text-slate-800 font-medium truncate block" title={cleanBranchName(s.branchName)}>
                                  {cleanBranchName(s.branchName)}
                                </span>
                              </td>
                              <td className="py-2.5 px-1.5 text-center">
                                <span
                                  className="font-mono text-xs text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200/80 tabular-nums whitespace-nowrap"
                                  title={s.branchId === 'UNASSIGNED' ? 'Unassigned' : s.branchId}
                                >
                                  {fmtBranchCode(s.branchId)}
                                </span>
                              </td>
                              {renderMetricCell('pos', s.posTasks, s.posPoints)}
                              {renderMetricCell('sb', s.sbTasks, s.sbPoints)}
                              {renderMetricCell('khqr', s.khqrTasks, s.khqrPoints)}
                              {renderMetricCell('cc', s.ccTasks, s.ccPoints)}
                              {renderMetricCell('mv', s.mvTasks, s.mvPoints)}
                              <td className="py-2.5 px-1.5">
                                <div className="flex justify-center items-center">
                                  <MiniMixBar
                                    pos={isTaskMode ? s.posTasks : s.posPoints}
                                    sb={isTaskMode ? s.sbTasks : s.sbPoints}
                                    khqr={isTaskMode ? s.khqrTasks : s.khqrPoints}
                                    cc={isTaskMode ? s.ccTasks : s.ccPoints}
                                    mv={isTaskMode ? s.mvTasks : s.mvPoints}
                                    total={isTaskMode ? s.totalTasks : s.totalPoints}
                                  />
                                </div>
                              </td>
                              <td className="py-2.5 px-1.5 text-center tabular-nums text-slate-600 font-medium whitespace-nowrap">
                                {isTaskMode ? fmtPts(s.totalPoints) : fmtInt(s.totalTasks)}
                              </td>
                              <td className="py-2.5 px-1.5 text-center tabular-nums whitespace-nowrap">
                                <span className="font-bold text-[#002F4A] text-[13.5px]">
                                  {isTaskMode ? fmtInt(s.totalTasks) : fmtPts(s.totalPoints)}
                                </span>
                              </td>
                            </tr>
                          ))
                        )
                      ) : top10Data.branches.length === 0 ? (
                        <tr>
                          <td colSpan={13} className="py-12 text-center text-xs text-slate-400">
                            No branch records in this period.
                          </td>
                        </tr>
                      ) : (
                        top10Data.branches.map((b, i) => (
                          <tr key={b.branchId} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-2.5 px-1.5 text-center">
                              <div className="flex justify-center items-center">
                                <RankBadge rank={i + 1} />
                              </div>
                            </td>
                            <td className="py-2.5 px-1.5">
                              <span className="font-semibold text-slate-900 text-[13px] block truncate" title={cleanBranchName(b.branchName)}>
                                {cleanBranchName(b.branchName)}
                              </span>
                            </td>
                            <td className="py-2.5 px-1.5 text-center">
                              <span
                                className="font-mono text-xs text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200/80 tabular-nums whitespace-nowrap"
                                title={b.branchId === 'UNASSIGNED' ? 'Unassigned' : b.branchId}
                              >
                                {fmtBranchCode(b.branchId)}
                              </span>
                            </td>
                            <td className="py-2.5 px-1.5 text-center">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-normal bg-slate-100 text-slate-600 border border-slate-200/80 tabular-nums whitespace-nowrap">
                                {b.staffCount} staff
                              </span>
                            </td>
                            {renderMetricCell('pos', b.posTasks, b.posPoints)}
                            {renderMetricCell('sb', b.sbTasks, b.sbPoints)}
                            {renderMetricCell('khqr', b.khqrTasks, b.khqrPoints)}
                            {renderMetricCell('cc', b.ccTasks, b.ccPoints)}
                            {renderMetricCell('mv', b.mvTasks, b.mvPoints)}
                            <td className="py-2.5 px-1.5">
                              <div className="flex justify-center items-center">
                                <MiniMixBar
                                  pos={isTaskMode ? b.posTasks : b.posPoints}
                                  sb={isTaskMode ? b.sbTasks : b.sbPoints}
                                  khqr={isTaskMode ? b.khqrTasks : b.khqrPoints}
                                  cc={isTaskMode ? b.ccTasks : b.ccPoints}
                                  mv={isTaskMode ? b.mvTasks : b.mvPoints}
                                  total={isTaskMode ? b.totalTasks : b.totalPoints}
                                />
                              </div>
                            </td>
                            <td className="py-2.5 px-1.5 text-center tabular-nums whitespace-nowrap">
                              <TaskPtsCell tasks={b.tasksPerStaff} pts={b.ptsPerStaff} mode={metricMode} align="center" decimalTasks />
                            </td>
                            <td className="py-2.5 px-1.5 text-center tabular-nums text-slate-600 font-medium whitespace-nowrap">
                              {isTaskMode ? fmtPts(b.totalPoints) : fmtInt(b.totalTasks)}
                            </td>
                            <td className="py-2.5 px-1.5 text-center tabular-nums whitespace-nowrap">
                              <span className="font-bold text-[#002F4A] text-[13.5px]">
                                {isTaskMode ? fmtInt(b.totalTasks) : fmtPts(b.totalPoints)}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                );
              })()}
            </div>
          </div>
        </section>
        </AfterPaint>
      </div>

      {/* ───────────── Overall Performance Breakdown by Daily, Weekly, Monthly & Quarterly ───────────── */}
      <div className={showSection('all') || showSection('timeline') ? 'contents' : 'hidden'}>
        <AfterPaint order={view === 'all' ? 3 : 1} minHeight={timelineExpanded ? 1100 : 480}>
        <section
          className="fr-table-frame bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden silk-lift"
          style={{ '--silk-i': view === 'all' ? 7 : 4 } as React.CSSProperties}
          aria-label="Overall Performance by Period"
        >
          <div className="px-5 py-3.5 border-b border-slate-200/90 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-sky-50 text-[#002F4A] border border-sky-100 flex items-center justify-center shrink-0 shadow-2xs">
                <Calendar className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900 leading-snug">Overall Performance Timeline</h3>
                  <span className="text-[11.5px] text-slate-500 font-medium hidden sm:inline">
                    · {granularity === 'daily'
                      ? (timeSeries.length > 10 && !timelineExpanded
                        ? `Daily (${Math.min(10, timeSeries.length)} of ${timeSeries.length} days)`
                        : `Daily (last ${Math.min(30, timeSeries.length)} days)`)
                      : granularity === 'weekly' ? 'Weekly (last 12 weeks)' : granularity === 'quarterly' ? 'Quarterly (last 8 quarters)' : 'Monthly (last 12 months)'}
                  </span>
                </div>
                <p className="text-[11.5px] text-slate-500 font-medium">
                  {isTaskMode
                    ? 'Historical periodic trend of branch activity, staff deployment, and task volume'
                    : 'Historical periodic trend of branch activity, staff deployment, and point production'}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {granularity === 'daily' && timeSeries.length > 10 && (
                <button
                  type="button"
                  onClick={() => setTimelineExpanded((v) => !v)}
                  aria-expanded={timelineExpanded}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold border border-slate-200/90 bg-white text-[#002F4A] hover:bg-slate-50 shadow-2xs transition cursor-pointer"
                >
                  <span>{timelineExpanded ? 'Collapse (10d)' : `Expand (1 mo · ${Math.min(30, timeSeries.length)}d)`}</span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${timelineExpanded ? 'rotate-180' : ''}`} />
                </button>
              )}
              <div className={`${CAPSULE_TRACK_CLS} text-[11px]`} role="tablist" aria-label="Timeline granularity">
              {([
                { g: 'daily' as const, label: 'Daily', dot: 'bg-sky-500' },
                { g: 'weekly' as const, label: 'Weekly', dot: 'bg-emerald-500' },
                { g: 'monthly' as const, label: 'Monthly', dot: 'bg-[#004e75]' },
                { g: 'quarterly' as const, label: 'Quarterly', dot: 'bg-amber-500' },
              ]).map(({ g, label, dot }) => {
                const active = granularity === g;
                return (
                  <button
                    key={g}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => startMatrixTransition(() => setGranularity(g))}
                    className={`relative px-3 py-1 rounded-full cursor-pointer transition-colors inline-flex items-center gap-1.5 ${
                      active ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
                    }`}
                  >
                    {active && (
                      <PillMotion
                        layoutId="kpi-timeline-granularity-pill"
                        aria-hidden
                        transition={SPRING}
                        className={CAPSULE_PILL_CLS}
                      />
                    )}
                    <span className={`w-2 h-2 rounded-full relative z-10 shrink-0 ${dot}`} aria-hidden />
                    <span className="relative z-10">{label}</span>
                  </button>
                );
              })}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto overflow-y-hidden w-full overscroll-x-contain">
            <div className="min-w-[1140px] w-full">
              <div className="grid items-center gap-x-2 grid-cols-[minmax(88px,1fr)_minmax(60px,0.65fr)_minmax(50px,0.55fr)_minmax(96px,1.02fr)_minmax(92px,0.98fr)_minmax(86px,0.92fr)_minmax(94px,1fr)_minmax(102px,1.08fr)_minmax(86px,0.92fr)_minmax(82px,0.86fr)_minmax(88px,0.94fr)_minmax(58px,0.65fr)] glass-table-thead navy-header-bar bg-[#002F4A] text-white text-[11px] font-semibold normal-case tracking-normal px-3.5 py-2.5">
              <SortableHeader label="Period" sortKey="period" activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} />
              <SortableHeader label="Branches" sortKey="activeBranches" activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" />
              <SortableHeader label="Staff" sortKey="activeStaff" activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" />
              <SortableHeader label="POS Terminal" sortKey={isTaskMode ? 'posTasks' : 'posPoints'} activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
              <SortableHeader label="Sound Box" sortKey={isTaskMode ? 'sbTasks' : 'sbPoints'} activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
              <SortableHeader label="KHQR" sortKey={isTaskMode ? 'khqrTasks' : 'khqrPoints'} activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
              <SortableHeader label="Credit Card" sortKey={isTaskMode ? 'ccTasks' : 'ccPoints'} activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
              <SortableHeader label="Merchant Visit" sortKey={isTaskMode ? 'mvTasks' : 'mvPoints'} activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
              <SortableHeader label="Avg / Staff" sortKey={isTaskMode ? 'tasksPerStaff' : 'ptsPerStaff'} activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" />
              <SortableHeader label={isTaskMode ? 'Total Pts' : 'Total Tasks'} sortKey={isTaskMode ? 'totalPoints' : 'totalTasks'} activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" />
              <SortableHeader label={isTaskMode ? 'Total Tasks' : 'Total Pts'} sortKey={isTaskMode ? 'totalTasks' : 'totalPoints'} activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" />
              <SortableHeader label="Change" sortKey="growthPct" activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" />
            </div>
            <div className={`divide-y divide-slate-200/80 silk-rows table-quiet-body ${isMatrixPending || (loading && data) || query !== deferredQuery ? 'is-loading' : ''}`}>
              {timeSeries.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400">No historical records found.</div>
              ) : (
                (granularity === 'daily'
                  ? timeSeries.slice(0, timelineExpanded ? 30 : 10)
                  : timeSeries
                ).map((t) => (
                  <div
                    key={t.period}
                    className="grid items-center gap-x-2 grid-cols-[minmax(88px,1fr)_minmax(60px,0.65fr)_minmax(50px,0.55fr)_minmax(96px,1.02fr)_minmax(92px,0.98fr)_minmax(86px,0.92fr)_minmax(94px,1fr)_minmax(102px,1.08fr)_minmax(86px,0.92fr)_minmax(82px,0.86fr)_minmax(88px,0.94fr)_minmax(58px,0.65fr)] px-3.5 py-2.5 text-[13px] text-slate-700 hover:bg-slate-50/80 transition-colors"
                  >
                    <span className="font-normal text-slate-900 tabular-nums">{t.label}</span>
                    <span className="text-right tabular-nums font-normal text-slate-800">{fmtInt(t.activeBranches)}</span>
                    <span className="text-right tabular-nums font-normal text-slate-800">{fmtInt(t.activeStaff)}</span>
                    <span className="text-center tabular-nums"><TaskPtsCell tasks={t.posTasks} pts={t.posPoints} mode={metricMode} /></span>
                    <span className="text-center tabular-nums"><TaskPtsCell tasks={t.sbTasks} pts={t.sbPoints} mode={metricMode} /></span>
                    <span className="text-center tabular-nums"><TaskPtsCell tasks={t.khqrTasks} pts={t.khqrPoints} mode={metricMode} /></span>
                    <span className="text-center tabular-nums"><TaskPtsCell tasks={t.ccTasks} pts={t.ccPoints} mode={metricMode} /></span>
                    <span className="text-center tabular-nums"><TaskPtsCell tasks={t.mvTasks} pts={t.mvPoints} mode={metricMode} /></span>
                    <span className="text-right tabular-nums">
                      <TaskPtsCell tasks={t.tasksPerStaff} pts={t.ptsPerStaff} mode={metricMode} align="right" decimalTasks />
                    </span>
                    <span className="text-right tabular-nums font-normal text-slate-800">
                      {isTaskMode ? fmtPts(t.totalPoints) : fmtInt(t.totalTasks)}
                    </span>
                    <span className="text-right tabular-nums font-figure font-normal text-[#002F4A]">
                      {isTaskMode ? fmtInt(t.totalTasks) : fmtPts(t.totalPoints)}
                    </span>
                    <span className="text-right tabular-nums">
                      {t.growthPct === null ? (
                        <span className="text-xs text-slate-400 font-light">—</span>
                      ) : (
                        <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${t.growthPct >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {t.growthPct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {t.growthPct > 0 ? `+${t.growthPct}%` : `${t.growthPct}%`}
                        </span>
                      )}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
          </div>
          {granularity === 'daily' && timeSeries.length > 10 && (
            <div className="px-5 py-2.5 border-t border-slate-200/80 bg-slate-50/70 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-slate-500 font-medium">
                Showing <strong className="text-slate-800">{timelineExpanded ? Math.min(30, timeSeries.length) : Math.min(10, timeSeries.length)}</strong> of{' '}
                <strong className="text-slate-800">{Math.min(30, timeSeries.length)}</strong> days
                <span className="text-slate-400"> · min 10 days, max 1 month (30 days)</span>
              </span>
              <button
                type="button"
                onClick={() => setTimelineExpanded((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg font-bold text-[#002F4A] hover:bg-white border border-slate-200/90 bg-white/80 shadow-2xs transition cursor-pointer"
              >
                <span>{timelineExpanded ? 'Collapse to 10 Days' : `Expand to 1 Month (${Math.min(30, timeSeries.length)} Days)`}</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${timelineExpanded ? 'rotate-180' : ''}`} />
              </button>
            </div>
          )}
        </section>
        </AfterPaint>
      </div>

      {/* ───────────── KPI Performance by Branch & Staff (Switchable Combined Table) ───────────── */}
      <div className={showSection('all') || showSection('branches') || showSection('staff') ? 'contents' : 'hidden'}>
        <section
          className="fr-table-frame bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden relative silk-lift"
          style={{ '--silk-i': view === 'all' ? 7 : 4 } as React.CSSProperties}
          aria-label="KPI Performance Table"
        >

          {/* Section 7 Header Bar */}
          <div className="px-5 py-3.5 border-b border-slate-200/90 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-[#002F4A] text-white flex items-center justify-center shrink-0 shadow-2xs">
                <BarChart3 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 leading-snug">Branch &amp; Staff Performance Matrix</h3>
                <p className="text-[11.5px] text-slate-500 font-medium">Rankings, points, targets, monthly &amp; daily activity</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2 max-w-full ml-auto">
              <div className="overflow-x-auto no-scrollbar max-w-full py-0.5">
                <div className={`${CAPSULE_TRACK_CLS} text-[11px] shrink-0 whitespace-nowrap`} role="tablist" aria-label="Matrix mode">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tableMode === 'staff' && staffSubView === 'summary'}
                  onClick={() => handleTableModeChange('staff')}
                  className={`relative inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full cursor-pointer transition-colors ${
                    tableMode === 'staff' && staffSubView === 'summary' ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
                  }`}
                >
                  {tableMode === 'staff' && staffSubView === 'summary' && (
                    <PillMotion
                      layoutId="kpi-table-mode-pill"
                      aria-hidden
                      transition={SPRING}
                      className={CAPSULE_PILL_CLS}
                    />
                  )}
                  <Users className="w-3.5 h-3.5 relative z-10 text-sky-600" aria-hidden />
                  <span className="relative z-10">KPI by Staff</span>
                  <span className={`relative z-10 text-[10px] px-1.5 py-0.2 rounded-full font-figure tabular-nums transition-colors ${tableMode === 'staff' && staffSubView === 'summary' ? CAPSULE_COUNT_ACTIVE_CLS : CAPSULE_COUNT_INACTIVE_CLS}`}>
                    {statusFilteredStaff.length}
                  </span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tableMode === 'branch' && branchSubView === 'summary'}
                  onClick={() => handleTableModeChange('branch')}
                  className={`relative inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full cursor-pointer transition-colors ${
                    tableMode === 'branch' && branchSubView === 'summary' ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
                  }`}
                >
                  {tableMode === 'branch' && branchSubView === 'summary' && (
                    <PillMotion
                      layoutId="kpi-table-mode-pill"
                      aria-hidden
                      transition={SPRING}
                      className={CAPSULE_PILL_CLS}
                    />
                  )}
                  <Building2 className="w-3.5 h-3.5 relative z-10 text-emerald-600" aria-hidden />
                  <span className="relative z-10">KPI by Branch</span>
                  <span className={`relative z-10 text-[10px] px-1.5 py-0.2 rounded-full font-figure tabular-nums transition-colors ${tableMode === 'branch' && branchSubView === 'summary' ? CAPSULE_COUNT_ACTIVE_CLS : CAPSULE_COUNT_INACTIVE_CLS}`}>
                    {statusFilteredBranches.length}
                  </span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tableMode === 'staff' && staffSubView === 'monthly'}
                  onClick={() => handleTableModeChange('staff_monthly')}
                  className={`relative inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full cursor-pointer transition-colors ${
                    tableMode === 'staff' && staffSubView === 'monthly' ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
                  }`}
                >
                  {tableMode === 'staff' && staffSubView === 'monthly' && (
                    <PillMotion
                      layoutId="kpi-table-mode-pill"
                      aria-hidden
                      transition={SPRING}
                      className={CAPSULE_PILL_CLS}
                    />
                  )}
                  <Users className="w-3.5 h-3.5 relative z-10 text-teal-600" aria-hidden />
                  <span className="relative z-10">Staff Monthly KPI</span>
                  <span className={`relative z-10 text-[10px] px-1.5 py-0.2 rounded-full font-figure tabular-nums transition-colors ${tableMode === 'staff' && staffSubView === 'monthly' ? CAPSULE_COUNT_ACTIVE_CLS : CAPSULE_COUNT_INACTIVE_CLS}`}>
                    {monthlyMatrixYear}
                  </span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tableMode === 'branch' && branchSubView === 'monthly'}
                  onClick={() => handleTableModeChange('branch_monthly')}
                  className={`relative inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full cursor-pointer transition-colors ${
                    tableMode === 'branch' && branchSubView === 'monthly' ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
                  }`}
                >
                  {tableMode === 'branch' && branchSubView === 'monthly' && (
                    <PillMotion
                      layoutId="kpi-table-mode-pill"
                      aria-hidden
                      transition={SPRING}
                      className={CAPSULE_PILL_CLS}
                    />
                  )}
                  <Building2 className="w-3.5 h-3.5 relative z-10 text-cyan-600" aria-hidden />
                  <span className="relative z-10">Branch Monthly KPI</span>
                  <span className={`relative z-10 text-[10px] px-1.5 py-0.2 rounded-full font-figure tabular-nums transition-colors ${tableMode === 'branch' && branchSubView === 'monthly' ? CAPSULE_COUNT_ACTIVE_CLS : CAPSULE_COUNT_INACTIVE_CLS}`}>
                    {monthlyMatrixYear}
                  </span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tableMode === 'staff' && staffSubView === 'daily'}
                  onClick={() => handleTableModeChange('staff_daily')}
                  className={`relative inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full cursor-pointer transition-colors ${
                    tableMode === 'staff' && staffSubView === 'daily' ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
                  }`}
                >
                  {tableMode === 'staff' && staffSubView === 'daily' && (
                    <PillMotion
                      layoutId="kpi-table-mode-pill"
                      aria-hidden
                      transition={SPRING}
                      className={CAPSULE_PILL_CLS}
                    />
                  )}
                  <Calendar className="w-3.5 h-3.5 relative z-10 text-amber-500" aria-hidden />
                  <span className="relative z-10">Staff Daily Tasks</span>
                  <span className={`relative z-10 text-[10px] px-1.5 py-0.2 rounded-full font-figure tabular-nums transition-colors ${tableMode === 'staff' && staffSubView === 'daily' ? CAPSULE_COUNT_ACTIVE_CLS : CAPSULE_COUNT_INACTIVE_CLS}`}>
                    1–{matrixDays.length}d
                  </span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tableMode === 'branch' && branchSubView === 'daily'}
                  onClick={() => handleTableModeChange('branch_daily')}
                  className={`relative inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full cursor-pointer transition-colors ${
                    tableMode === 'branch' && branchSubView === 'daily' ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
                  }`}
                >
                  {tableMode === 'branch' && branchSubView === 'daily' && (
                    <PillMotion
                      layoutId="kpi-table-mode-pill"
                      aria-hidden
                      transition={SPRING}
                      className={CAPSULE_PILL_CLS}
                    />
                  )}
                  <Calendar className="w-3.5 h-3.5 relative z-10 text-indigo-600" aria-hidden />
                  <span className="relative z-10">Branch Daily Tasks</span>
                  <span className={`relative z-10 text-[10px] px-1.5 py-0.2 rounded-full font-figure tabular-nums transition-colors ${tableMode === 'branch' && branchSubView === 'daily' ? CAPSULE_COUNT_ACTIVE_CLS : CAPSULE_COUNT_INACTIVE_CLS}`}>
                    1–{matrixDays.length}d
                  </span>
                </button>

                </div>
              </div>

              <ExportCsvButton
                onExport={
                  tableMode === 'staff'
                    ? staffSubView === 'daily'
                      ? exportDailyStaffCsv
                      : staffSubView === 'monthly'
                      ? exportMonthlyCsv
                      : exportStaffCsv
                    : branchSubView === 'daily'
                    ? exportDailyBranchCsv
                    : branchSubView === 'monthly'
                    ? exportMonthlyCsv
                    : exportBranchCsv
                }
                toast={triggerToast}
                title={`Export ${
                  tableMode === 'staff'
                    ? staffSubView === 'daily'
                      ? `Daily Tasks Matrix (${fmtMonth(dailyMatrixMonth)}) by Staff`
                      : staffSubView === 'monthly'
                      ? 'Monthly KPI Matrix by Staff'
                      : 'KPI Performance by Staff'
                    : branchSubView === 'daily'
                    ? `Daily Tasks Matrix (${fmtMonth(dailyMatrixMonth)}) by Branch`
                    : branchSubView === 'monthly'
                    ? 'Monthly KPI Matrix by Branch'
                    : 'KPI Performance by Branch'
                } to CSV`}
              />
            </div>
          </div>

          {/* Sub-bar with Date picker / Work days badge or Target info */}
          <div className="px-5 py-2.5 bg-slate-50/40 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-2.5 text-xs">
            {(tableMode === 'branch' && branchSubView === 'daily') || (tableMode === 'staff' && staffSubView === 'daily') ? (
              <div className="flex flex-wrap items-center gap-2.5 w-full justify-between">
                <div className="inline-flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5 border border-slate-200 shadow-2xs">
                  <button
                    type="button"
                    onClick={() => stepDailyMonth(-1)}
                    title="Previous Month"
                    className="p-1 rounded hover:bg-white text-slate-700 transition cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <select
                    value={dailyMatrixMonth}
                    onChange={(e) => { const v = e.target.value; startMatrixTransition(() => setDailyMatrixMonth(v)); }}
                    className="bg-transparent text-xs font-normal text-slate-800 outline-none px-1.5 py-0.5 cursor-pointer"
                  >
                    {availableMonths.map((m) => (
                      <option key={m} value={m}>
                        {fmtMonth(m)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => stepDailyMonth(1)}
                    title="Next Month"
                    className="p-1 rounded hover:bg-white text-slate-700 transition cursor-pointer"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="text-xs font-medium text-slate-600 flex flex-wrap items-center gap-2">
                  <span>Work Days: <strong className="text-slate-800 font-semibold">{monthWorkDaysSummary.workDays} days</strong> ({monthWorkDaysSummary.daysInMonth}d total − {monthWorkDaysSummary.weekendDays} weekend − {monthWorkDaysSummary.weekdayHolidays} Cambodian hol.)</span>
                  <span className="text-slate-300">·</span>
                  <span>Month Tasks: <strong className="text-slate-800 font-semibold">{fmtInt(tableMode === 'staff' ? matrixStaffDayTotals.allGrandTotal : matrixDayTotals.allGrandTotal)} tasks</strong></span>
                  <span className="text-slate-300">·</span>
                  <span>Daily Avg: <strong className="text-slate-800 font-semibold">{tableMode === 'staff' ? matrixStaffDayTotals.avgDailyTotal : matrixDayTotals.avgDailyTotal} tasks/day</strong></span>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between w-full text-xs font-medium text-slate-600 gap-2">
                {(tableMode === 'branch' && branchSubView === 'monthly') || (tableMode === 'staff' && staffSubView === 'monthly') ? (
                  <div
                    className="flex flex-wrap items-center gap-2 text-slate-600"
                    title="Weekends (Sat/Sun) and Cambodian public holidays are excluded from KPI work days"
                  >
                    <div className="inline-flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5 border border-slate-200 shadow-2xs">
                      <button
                        type="button"
                        onClick={() => stepMatrixYear(-1)}
                        disabled={availableMatrixYears.indexOf(monthlyMatrixYear) <= 0}
                        title="Previous Year"
                        aria-label="Previous Year"
                        className="p-1 rounded hover:bg-white text-slate-700 disabled:opacity-35 disabled:cursor-not-allowed transition cursor-pointer"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      <select
                        aria-label="Select KPI year"
                        value={monthlyMatrixYear}
                        onChange={(e) => { const v = e.target.value; startMatrixTransition(() => setMonthlyMatrixYear(v)); }}
                        className="bg-transparent text-xs font-semibold text-slate-800 outline-none px-1.5 py-0.5 cursor-pointer tabular-nums"
                      >
                        {availableMatrixYears.map((yr) => (
                          <option key={yr} value={yr}>
                            {yr}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => stepMatrixYear(1)}
                        disabled={availableMatrixYears.indexOf(monthlyMatrixYear) >= availableMatrixYears.length - 1}
                        title="Next Year"
                        aria-label="Next Year"
                        className="p-1 rounded hover:bg-white text-slate-700 disabled:opacity-35 disabled:cursor-not-allowed transition cursor-pointer"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <span>
                      <strong className="font-semibold text-slate-800 tabular-nums">{sortedMonthlyRows.length}</strong>{' '}
                      {tableMode === 'branch' ? 'branches' : 'staff'}
                      {statusFilter !== 'ALL' && (
                        <span className="text-slate-400 font-normal"> of {activeMonthlyBaseRows.length}</span>
                      )}
                      <span className="mx-1.5 text-slate-300">·</span>
                      <span>
                        Jan – Dec {monthlyMatrixYear}
                        {trackedMatrixMonthCount < 12 && (
                          <span className="text-slate-400 font-normal"> ({trackedMatrixMonthCount} tracked)</span>
                        )}
                      </span>
                      <span className="mx-1.5 text-slate-300">·</span>
                      Target{' '}
                      <strong className="font-semibold text-slate-800 tabular-nums">
                        {fmtPts((monthlyMatrixMeta.filter((m) => m.isTrackedElapsed).slice(-1)[0] ?? monthlyMatrixMeta[monthlyMatrixMeta.length - 1])?.staffTarget ?? activeTargets.staff)}
                      </strong>{' '}
                      {isTaskMode ? 'tasks' : 'pts'}/staff{tableMode === 'branch' ? ' × active officers' : '/mo'}
                    </span>
                  </div>
                ) : (
                <span
                  className="text-slate-600"
                  title="Weekends (Sat/Sun) and Cambodian public holidays are excluded from KPI work days"
                >
                  {tableMode === 'branch' ? (
                    <>
                      <strong className="font-semibold text-slate-800 tabular-nums">{statusFilteredBranches.length}</strong> branches
                      {statusFilter !== 'ALL' && (
                        <span className="text-slate-400 font-normal"> of {filteredBranches.length}</span>
                      )}
                      <span className="mx-1.5 text-slate-300">·</span>
                      Target <strong className="font-semibold text-slate-800 tabular-nums">{fmtPts(activeTargets.staff)}</strong> pts/staff × active officers
                      <span className="text-slate-400 font-normal"> ({monthWorkDaysSummary.workDays} work days)</span>
                    </>
                  ) : (
                    <>
                      <strong className="font-semibold text-slate-800 tabular-nums">{statusFilteredStaff.length}</strong> staff
                      {statusFilter !== 'ALL' && (
                        <span className="text-slate-400 font-normal"> of {filteredStaff.length}</span>
                      )}
                      <span className="mx-1.5 text-slate-300">·</span>
                      Target <strong className="font-semibold text-slate-800 tabular-nums">{fmtPts(activeTargets.staff)}</strong> pts/staff
                      <span className="text-slate-400 font-normal"> ({monthWorkDaysSummary.workDays} work days)</span>
                    </>
                  )}
                </span>
                )}
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="inline-flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-500 font-medium">Status:</span>
                    <select
                      aria-label="Filter by performance status"
                      value={statusFilter}
                      onChange={(e) => { const v = e.target.value as 'ALL' | KpiRating; startMatrixTransition(() => setStatusFilter(v)); }}
                      className={`text-xs rounded-xl border px-2.5 py-1 cursor-pointer font-medium outline-none transition ${
                        statusFilter !== 'ALL'
                          ? 'border-[#004e75]/40 bg-sky-50/90 text-[#002F4A]'
                          : 'border-slate-200/90 bg-white hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <option value="ALL">All Statuses ({matrixStatusCounts.ALL})</option>
                      <option value="Outstanding">Outstanding ({matrixStatusCounts.Outstanding})</option>
                      <option value="Meet Target">Meet Target ({matrixStatusCounts['Meet Target']})</option>
                      <option value="Near/Below Target">Near/Below Target ({matrixStatusCounts['Near/Below Target']})</option>
                      <option value="Needs Improvement">Needs Improvement ({matrixStatusCounts['Needs Improvement']})</option>
                      {tableMode === 'staff' && (
                        <option value="Management (Exempt)">Management (Exempt) ({matrixStatusCounts['Management (Exempt)']})</option>
                      )}
                    </select>
                    {statusFilter !== 'ALL' && (
                      <button
                        type="button"
                        onClick={() => setStatusFilter('ALL')}
                        title="Clear status filter"
                        aria-label="Clear status filter"
                        className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" aria-hidden />
                      </button>
                    )}
                  </div>
                  {tableMode === 'staff' && (() => {
                    const isMon = staffSubView === 'monthly';
                    const allLvlCount = isMon ? monthlyMatrixData.levelCounts.all : enrichedStaff.length;
                    const fldLvlCount = isMon ? monthlyMatrixData.levelCounts.field : enrichedStaff.filter((s) => !s.isManagement).length;
                    const mgtLvlCount = isMon ? monthlyMatrixData.levelCounts.management : enrichedStaff.filter((s) => s.isManagement).length;
                    return (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-500 font-medium">Level:</span>
                      <div className={`${CAPSULE_TRACK_COMPACT_CLS} text-xs`} role="tablist" aria-label="Staff level filter">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={staffLevelFilter === 'all'}
                          onClick={() => startMatrixTransition(() => setStaffLevelFilter('all'))}
                          className={`relative px-2.5 py-1 rounded-full text-[11px] transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                            staffLevelFilter === 'all' ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
                          }`}
                        >
                          {staffLevelFilter === 'all' && (
                            <PillMotion
                              layoutId="kpi-staff-level-pill"
                              aria-hidden
                              transition={SPRING}
                              className={CAPSULE_PILL_CLS}
                            />
                          )}
                          <span className="w-2 h-2 rounded-full relative z-10 shrink-0 bg-[#004e75]" aria-hidden />
                          <span className="relative z-10">All ({allLvlCount})</span>
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={staffLevelFilter === 'field'}
                          onClick={() => startMatrixTransition(() => setStaffLevelFilter('field'))}
                          className={`relative px-2.5 py-1 rounded-full text-[11px] transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                            staffLevelFilter === 'field' ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
                          }`}
                        >
                          {staffLevelFilter === 'field' && (
                            <PillMotion
                              layoutId="kpi-staff-level-pill"
                              aria-hidden
                              transition={SPRING}
                              className={CAPSULE_PILL_CLS}
                            />
                          )}
                          <span className="w-2 h-2 rounded-full relative z-10 shrink-0 bg-emerald-500" aria-hidden />
                          <span className="relative z-10">Field Officers ({fldLvlCount})</span>
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={staffLevelFilter === 'management'}
                          onClick={() => startMatrixTransition(() => setStaffLevelFilter('management'))}
                          className={`relative px-2.5 py-1 rounded-full text-[11px] transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                            staffLevelFilter === 'management' ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
                          }`}
                          title="Management level staff (Branch Managers, Supervisors, Team Leads, Admins) who oversee operations and are exempt from field KPIs"
                        >
                          {staffLevelFilter === 'management' && (
                            <PillMotion
                              layoutId="kpi-staff-level-pill"
                              aria-hidden
                              transition={SPRING}
                              className={CAPSULE_PILL_CLS}
                            />
                          )}
                          <span className="w-2 h-2 rounded-full relative z-10 shrink-0 bg-amber-500" aria-hidden />
                          <span className="relative z-10">Management ({mgtLvlCount})</span>
                        </button>
                      </div>
                    </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>

          {loading && !data ? (
            <div className="p-4">
              <KpiTableSkeleton rows={8} />
            </div>
          ) : (
            <div className={`table-quiet-body ${isMatrixPending || (loading && data) || query !== deferredQuery ? 'is-loading' : ''}`}>
                {((tableMode === 'branch' && branchSubView === 'monthly') || (tableMode === 'staff' && staffSubView === 'monthly')) ? (
                  <>
                    <div className="overflow-x-auto overflow-y-hidden w-full overscroll-x-contain">
                      <table className="kpi-matrix-table w-full text-left border-separate border-spacing-0 text-[13px]">
                        <thead>
                          <tr className="navy-header-bar bg-[#002F4A] text-white text-[11px] font-semibold uppercase tracking-wider select-none">
                            <th className="sticky left-0 bg-[#002F4A] z-30 px-1.5 py-2.5 text-center w-[36px] min-w-[36px] font-semibold text-[11px] text-white/90 border-b border-white/20">
                              No.
                            </th>
                            <th
                              className={`sticky left-[36px] bg-[#002F4A] z-30 px-3 py-2.5 text-left ${tableMode === 'staff' ? 'w-[238px] min-w-[238px]' : 'w-[228px] min-w-[228px] border-r border-slate-700/90 shadow-[2px_0_5px_rgba(0,0,0,0.18)]'} cursor-pointer select-none hover:bg-white/10 transition-colors border-b border-white/20`}
                              onClick={() => {
                                setMonthlySortKey('name');
                                setMonthlySortDir((d) => (monthlySortKey === 'name' ? (d === 'asc' ? 'desc' : 'asc') : 'asc'));
                              }}
                            >
                              <div className="flex items-center gap-1 font-semibold text-[11px] text-white">
                                <span>{tableMode === 'branch' ? 'Branch' : 'Staff'}</span>
                                <SortIcon active={monthlySortKey === 'name'} dir={monthlySortDir} />
                              </div>
                            </th>
                            {tableMode === 'staff' && (
                              <th
                                className="sticky left-[274px] bg-[#002F4A] z-30 px-1.5 py-2.5 text-center w-[52px] min-w-[52px] cursor-pointer select-none hover:bg-white/10 transition-colors border-r border-slate-700/90 border-b border-white/20 shadow-[2px_0_5px_rgba(0,0,0,0.18)]"
                                onClick={() => {
                                  setMonthlySortKey('branchId');
                                  setMonthlySortDir((d) => (monthlySortKey === 'branchId' ? (d === 'asc' ? 'desc' : 'asc') : 'asc'));
                                }}
                              >
                                <div className="flex items-center justify-center gap-0.5 font-semibold text-[11px] text-white">
                                  <span>Code</span>
                                  <SortIcon active={monthlySortKey === 'branchId'} dir={monthlySortDir} />
                                </div>
                              </th>
                            )}

                            {monthlyMatrixMeta.map((m) => {
                              const sKey = `m_${m.ym}`;
                              return (
                                <th
                                  key={m.ym}
                                  onClick={() => {
                                    setMonthlySortKey(sKey);
                                    setMonthlySortDir((d) => (monthlySortKey === sKey ? (d === 'asc' ? 'desc' : 'asc') : 'desc'));
                                  }}
                                  title={`${m.fullLabel} (${m.workDays} official work days)${m.isCurrent ? ' · Current month-to-date' : m.isFuture ? ' · Upcoming month' : ''} — Click to sort`}
                                  className={`px-1 py-2 text-center min-w-[50px] cursor-pointer select-none transition-colors border-b border-white/20 ${
                                    m.isCurrent
                                      ? 'bg-sky-400/20 text-sky-100 hover:bg-sky-400/30'
                                      : m.isFuture
                                      ? 'text-white/50 hover:bg-white/10'
                                      : 'text-white hover:bg-white/10'
                                  }`}
                                >
                                  <div className="flex items-center justify-center gap-0.5">
                                    <div className="leading-tight flex flex-col items-center">
                                      <span className="text-[11px] font-semibold leading-none">{m.shortMonth}</span>
                                    </div>
                                    <SortIcon active={monthlySortKey === sKey} dir={monthlySortDir} />
                                  </div>
                                </th>
                              );
                            })}

                            <th
                              className="px-1.5 py-2.5 text-center w-[74px] min-w-[74px] cursor-pointer select-none hover:bg-white/10 transition-colors border-b border-white/20"
                              onClick={() => {
                                setMonthlySortKey('oppositeTotal');
                                setMonthlySortDir((d) => (monthlySortKey === 'oppositeTotal' ? (d === 'asc' ? 'desc' : 'asc') : 'desc'));
                              }}
                            >
                              <div className="flex items-center justify-center gap-1 font-medium text-[11px] text-white whitespace-nowrap">
                                <span>{isTaskMode ? 'Total Pts' : 'Total Tasks'}</span>
                                <SortIcon active={monthlySortKey === 'oppositeTotal'} dir={monthlySortDir} />
                              </div>
                            </th>
                            <th
                              className="px-1.5 py-2.5 text-center w-[82px] min-w-[82px] cursor-pointer select-none hover:bg-white/10 transition-colors border-b border-white/20"
                              onClick={() => {
                                setMonthlySortKey('total');
                                setMonthlySortDir((d) => (monthlySortKey === 'total' ? (d === 'asc' ? 'desc' : 'asc') : 'desc'));
                              }}
                            >
                              <div className="flex items-center justify-center gap-1 font-medium text-[11px] text-white whitespace-nowrap">
                                <span>{isTaskMode ? 'Total Tasks' : 'Total Pts'}</span>
                                <SortIcon active={monthlySortKey === 'total'} dir={monthlySortDir} />
                              </div>
                            </th>
                            <th
                              className="px-1.5 py-2.5 text-center w-[62px] min-w-[62px] cursor-pointer select-none hover:bg-white/10 transition-colors border-b border-white/20"
                              onClick={() => {
                                setMonthlySortKey('avg');
                                setMonthlySortDir((d) => (monthlySortKey === 'avg' ? (d === 'asc' ? 'desc' : 'asc') : 'desc'));
                              }}
                            >
                              <div className="flex items-center justify-center gap-1 font-medium text-[11px] text-white whitespace-nowrap">
                                <span>Avg/Mo</span>
                                <SortIcon active={monthlySortKey === 'avg'} dir={monthlySortDir} />
                              </div>
                            </th>
                            <th className="px-1.5 py-2.5 text-center w-[66px] min-w-[66px] font-medium text-[11px] text-white border-b border-white/20 whitespace-nowrap">
                              Target/Mo
                            </th>
                            <th
                              className="px-1.5 py-2.5 text-center w-[56px] min-w-[56px] cursor-pointer select-none hover:bg-white/10 transition-colors border-b border-white/20"
                              onClick={() => {
                                setMonthlySortKey('targetPct');
                                setMonthlySortDir((d) => (monthlySortKey === 'targetPct' ? (d === 'asc' ? 'desc' : 'asc') : 'desc'));
                              }}
                            >
                              <div className="flex items-center justify-center gap-1 font-medium text-[11px] text-white whitespace-nowrap">
                                <span>% Tgt</span>
                                <SortIcon active={monthlySortKey === 'targetPct'} dir={monthlySortDir} />
                              </div>
                            </th>
                            <th className="px-2 py-2.5 text-center w-[134px] min-w-[134px] font-medium text-[11px] text-white border-b border-white/20">
                              Performance
                            </th>
                          </tr>
                        </thead>

                        <tbody className="divide-y divide-slate-100 text-slate-700">
                          {sortedMonthlyRows.length === 0 ? (
                            <tr>
                              <td
                                colSpan={monthlyMatrixMeta.length + (tableMode === 'staff' ? 9 : 8)}
                                className="p-10 text-center text-sm text-slate-500"
                              >
                                No {tableMode === 'branch' ? 'branch' : 'staff'} records match the current filters.
                              </td>
                            </tr>
                          ) : (
                            sortedMonthlyRows.slice(monthlyPg.start, monthlyPg.drawEnd).map((row, idx) => {
                              const rank = monthlyPg.start + idx + 1;
                              return (
                                <tr key={row.id} className="group hover:bg-slate-50/80 transition-colors">
                                  <td className="sticky left-0 bg-white group-hover:bg-slate-50 z-10 px-1.5 py-2 text-center tabular-nums text-slate-400 text-xs border-r border-slate-100 font-normal">
                                    {rank}
                                  </td>
                                  {tableMode === 'branch' ? (
                                    <td
                                      className="sticky left-[36px] bg-white group-hover:bg-slate-50 z-10 px-3 py-2 text-slate-900 shadow-[2px_0_5px_rgba(15,23,42,0.06)] border-r border-slate-200/70 font-normal w-[228px] min-w-[228px] max-w-[248px]"
                                      title={`${cleanBranchName(row.name)} (${fmtBranchCode(row.branchId)})`}
                                    >
                                      <span className="block truncate font-medium text-slate-900 leading-snug">
                                        {cleanBranchName(row.name)}
                                      </span>
                                      <span className="block font-mono text-[11px] text-slate-400 tabular-nums leading-tight mt-0.5">
                                        {row.branchId && row.branchId !== 'UNASSIGNED' ? `Code ${fmtBranchCode(row.branchId)}` : 'Unassigned'} · {row.staffCount} staff
                                      </span>
                                    </td>
                                  ) : (
                                    <>
                                      <td
                                        className="sticky left-[36px] bg-white group-hover:bg-slate-50 z-10 px-3 py-2 text-slate-900 border-r border-slate-100 font-normal w-[238px] min-w-[238px] max-w-[260px]"
                                        title={`${row.name}${row.id ? ` (${row.id})` : ''}${row.subLabel ? ` · ${row.subLabel}` : ''}${row.branchName ? ` · ${cleanBranchName(row.branchName)}` : ''}`}
                                      >
                                        <span className="flex items-baseline gap-1.5 min-w-0">
                                          {row.isManagement && <ShieldCheck className="w-3.5 h-3.5 text-indigo-600 shrink-0 self-center" aria-hidden />}
                                          <span className="truncate font-medium text-slate-900 leading-snug">{row.name}</span>
                                          {row.id && (
                                            <span className="font-mono text-[11px] text-slate-400 tabular-nums shrink-0">
                                              {row.id}
                                            </span>
                                          )}
                                        </span>
                                        {row.subLabel && (
                                          <span className={`block text-[11px] truncate leading-tight mt-0.5 ${row.isManagement ? 'text-indigo-600 font-medium' : 'text-slate-500'}`}>
                                            {row.subLabel}
                                          </span>
                                        )}
                                      </td>
                                      <td
                                        className="sticky left-[274px] bg-white group-hover:bg-slate-50 z-10 px-1.5 py-2 text-center font-mono text-xs text-slate-600 shadow-[2px_0_5px_rgba(15,23,42,0.06)] border-r border-slate-200/70 font-normal w-[52px] min-w-[52px]"
                                        title={`${row.branchId} - ${cleanBranchName(row.branchName)}`}
                                      >
                                        {fmtBranchCode(row.branchId)}
                                      </td>
                                    </>
                                  )}

                                  {row.cells.map((c, mIdx) => {
                                    const meta = monthlyMatrixMeta[mIdx];
                                    const hasVal = c.val > 0;
                                    const paceRatio = c.pacingPct;
                                    const tip = `${tableMode === 'branch' ? cleanBranchName(row.name) : `${row.name} (${row.id})`} · ${meta.fullLabel}: ${
                                      meta.isFuture
                                        ? 'Upcoming month'
                                        : isTaskMode
                                        ? `${fmtInt(c.val)} tasks (${fmtPts(c.points)} pts)`
                                        : `${fmtPts(c.val)} pts (${fmtInt(c.tasks)} tasks)`
                                    }${!meta.isFuture && c.target > 0 ? `\nTarget: ${fmtPts(c.target)} (${c.pct}%${meta.isCurrent ? ` · MTD pace ${c.pacingPct}%` : ''})` : ''}${
                                      !meta.isFuture
                                        ? `\nPOS: ${c.pts.posTasks} (${fmtPts(c.pts.posPoints)} pts) · SB: ${c.pts.sbTasks} (${fmtPts(c.pts.sbPoints)} pts) · KHQR: ${c.pts.khqrTasks} (${fmtPts(c.pts.khqrPoints)} pts) · CC: ${c.pts.ccTasks} (${fmtPts(c.pts.ccPoints)} pts)${c.pts.mvTasks > 0 ? ` · MV: ${c.pts.mvTasks} (${fmtPts(c.pts.mvPoints)} pts)` : ''}`
                                        : ''
                                    }`;
                                    return (
                                      <td
                                        key={c.ym}
                                        title={tip}
                                        className={`px-1 py-1.5 text-center border-r border-slate-100 transition-colors ${
                                          meta.isCurrent ? 'bg-sky-50/40' : meta.isFuture ? 'bg-slate-50/35' : ''
                                        }`}
                                      >
                                        {hasVal ? (
                                          <span
                                            className={`inline-flex items-center justify-center min-w-[38px] h-[23px] px-1.5 rounded-md text-[11.5px] font-figure tabular-nums ${
                                              row.isManagement
                                                ? 'bg-indigo-50/80 text-indigo-700 font-medium'
                                                : paceRatio >= 100
                                                ? 'bg-[#eaf4f2] text-[#1d5c55] font-semibold'
                                                : paceRatio >= 70
                                                ? 'text-slate-600 font-normal'
                                                : 'text-slate-400 font-normal'
                                            }`}
                                          >
                                            {isTaskMode ? fmtInt(c.val) : fmtPts(c.val)}
                                          </span>
                                        ) : (
                                          <span className="text-slate-300 text-xs font-light select-none">
                                            {meta.isFuture ? '—' : '·'}
                                          </span>
                                        )}
                                      </td>
                                    );
                                  })}

                                  {(() => {
                                    const rowPts = categoryFilter === 'ALL'
                                      ? row.totalPoints
                                      : Math.round(row.cells.reduce((acc, c) => acc + pickCategoryKpiVal(c.pts, categoryFilter, false), 0) * 100) / 100;
                                    const rowTasks = categoryFilter === 'ALL'
                                      ? row.totalTasks
                                      : row.cells.reduce((acc, c) => acc + pickCategoryKpiVal(c.pts, categoryFilter, true), 0);
                                    return (
                                      <>
                                        <td className="px-1.5 py-2 text-center tabular-nums font-normal text-slate-600 border-l border-slate-200/60 whitespace-nowrap">
                                          {isTaskMode ? fmtPts(rowPts) : fmtInt(rowTasks)}
                                        </td>
                                        <td className="px-2 py-2 text-center tabular-nums font-figure font-medium text-[#002F4A] whitespace-nowrap">
                                          {isTaskMode ? fmtInt(row.total) : fmtPts(row.total)}
                                        </td>
                                        <td className="px-1.5 py-2 text-center tabular-nums font-normal text-slate-700">
                                          {fmtPts(row.avgPerMonth)}
                                        </td>
                                      </>
                                    );
                                  })()}
                                  <td className="px-1.5 py-2 text-center tabular-nums font-normal text-slate-500">
                                    {row.isManagement ? '—' : fmtPts(row.targetPerMonth)}
                                  </td>
                                  <td
                                    className="px-1.5 py-2 text-center tabular-nums font-normal text-slate-900"
                                    title={row.isManagement ? 'Exempt from field KPI target' : `Cumulative achievement: ${fmtPts(row.total)} / ${fmtPts(row.cumulativeTarget)} across ${trackedMatrixMonthCount} tracked month(s) (Pacing: ${row.pacingPct}%)`}
                                  >
                                    {row.isManagement ? (
                                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200/80">
                                        <ShieldCheck className="w-2.5 h-2.5 text-indigo-600 shrink-0" aria-hidden />
                                        <span>Exempt</span>
                                      </span>
                                    ) : (
                                      `${row.targetPct}%`
                                    )}
                                  </td>
                                  <td className="px-2 py-2 text-center whitespace-nowrap">
                                    <RatingBadge
                                      rating={row.rating}
                                      pacingPct={row.pacingPct}
                                      title={row.isManagement ? 'Management level staff are exempt from individual field KPIs' : `Pacing across ${trackedMatrixMonthCount} tracked month(s): ${row.pacingPct}% (${fmtPts(row.total)} / ${fmtPts(row.cumulativePacingTarget)} pacing target)`}
                                    />
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>

                        {sortedMonthlyRows.length > 0 && (
                          <tfoot>
                            <tr className="bg-slate-100/90 font-medium text-slate-800 border-t-2 border-slate-300 text-[12px]">
                              <td
                                colSpan={tableMode === 'staff' ? 3 : 2}
                                className="sticky left-0 bg-slate-100 z-10 px-3 py-2.5 text-left font-medium text-slate-900 shadow-[2px_0_5px_rgba(15,23,42,0.06)] border-r border-slate-300"
                              >
                                Total Across All {tableMode === 'branch' ? `Branches (${sortedMonthlyRows.length})` : `Staff (${sortedMonthlyRows.length})`}
                              </td>
                              {monthlyMatrixMeta.map((m) => {
                                const mSum = Math.round((monthlyTotals.byMonth[m.ym] || 0) * 100) / 100;
                                const mPts = Math.round((monthlyTotals.byMonthPoints[m.ym] || 0) * 100) / 100;
                                const mTasks = monthlyTotals.byMonthTasks[m.ym] || 0;
                                return (
                                  <td
                                    key={m.ym}
                                    className={`px-1 py-2 text-center tabular-nums text-[11.5px] font-figure border-r border-slate-200 ${
                                      m.isCurrent ? 'bg-sky-100/50 text-[#002F4A] font-medium' : mSum > 0 ? 'text-slate-900 font-medium' : 'text-slate-400 font-light'
                                    }`}
                                    title={`All ${tableMode === 'branch' ? 'branches' : 'staff'} in ${m.fullLabel}: ${m.isFuture ? 'Upcoming month' : `${fmtPts(mPts)} pts · ${fmtInt(mTasks)} tasks`}`}
                                  >
                                    {m.isFuture ? '—' : mSum > 0 ? (isTaskMode ? fmtInt(mSum) : fmtPts(mSum)) : '·'}
                                  </td>
                                );
                              })}
                              <td className="px-1.5 py-2.5 text-center tabular-nums font-normal text-slate-700 border-l border-slate-300 text-xs whitespace-nowrap">
                                {isTaskMode ? fmtPts(monthlyTotals.grandPoints) : fmtInt(monthlyTotals.grandTasks)}
                              </td>
                              <td className="px-2 py-2.5 text-center tabular-nums font-medium text-[#002F4A] text-xs whitespace-nowrap">
                                {isTaskMode ? fmtInt(monthlyTotals.grandTotal) : fmtPts(monthlyTotals.grandTotal)}
                              </td>
                              <td className="px-1.5 py-2.5 text-center tabular-nums font-normal text-slate-700 text-xs">
                                {fmtPts(monthlyTotals.avgPerMonth)}
                              </td>
                              <td className="px-1.5 py-2.5 text-center tabular-nums text-slate-500 text-xs">
                                {fmtPts(monthlyTotals.totalTargetPerMonth)}
                              </td>
                              <td className="px-1.5 py-2.5 text-center tabular-nums font-medium text-slate-900 text-xs">
                                {monthlyTotals.pct}%
                              </td>
                              <td className="px-2 py-2.5 text-center">
                                <span className="text-[11px] text-slate-500 font-medium">{monthlyMatrixYear} Total</span>
                              </td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                    <Pager pg={monthlyPg} label={tableMode === 'branch' ? 'branches' : 'staff members'} />
                  </>
                ) : tableMode === 'branch' ? (
                  branchSubView === 'daily' ? (
                    <>
                      <div className="overflow-x-auto overflow-y-hidden w-full overscroll-x-contain">
                        <table className="kpi-matrix-table w-full text-left border-separate border-spacing-0 text-[13px]">
                          <thead>
                            <tr className="navy-header-bar bg-[#002F4A] text-white text-[11px] font-semibold uppercase tracking-wider select-none">
                              <th className="sticky left-0 bg-[#002F4A] z-30 px-2 py-2.5 text-center w-[36px] min-w-[36px] font-semibold text-[11px] text-white/90 border-b border-white/20">
                                No.
                              </th>
                              <th
                                className="sticky left-[36px] bg-[#002F4A] z-30 px-3 py-2.5 text-left w-[210px] min-w-[210px] cursor-pointer select-none hover:bg-white/10 transition-colors border-r border-slate-700/90 border-b border-white/20 shadow-[2px_0_4px_rgba(0,0,0,0.18)]"
                                onClick={() => {
                                  setDailySortKey('branchName');
                                  setDailySortDir((d) => (dailySortKey === 'branchName' ? (d === 'asc' ? 'desc' : 'asc') : 'desc'));
                                }}
                              >
                                <div className="flex items-center gap-1 font-semibold text-[11px] text-white">
                                  <span>Branch</span>
                                  <SortIcon active={dailySortKey === 'branchName'} dir={dailySortDir} />
                                </div>
                              </th>

                              {/* Days 1..N */}
                              {matrixDays.map((d) => {
                                const isHol = d.isHoliday;
                                const isWk = d.isWeekend;
                                const titleText = isHol
                                  ? `🇰🇭 ${d.holidayName} · ${d.isoDay} (${d.dayOfWeek})\nOfficial Cambodian Public Holiday (Excluded from KPI count)`
                                  : isWk
                                  ? `Weekend · ${d.isoDay} (${d.dayOfWeek})\nExcluded from KPI count`
                                  : `${d.isoDay} (${d.dayOfWeek}) · Official Work Day\nClick to sort branches by tasks`;

                                return (
                                  <th
                                    key={d.dayNum}
                                    onClick={() => {
                                      const key = `day_${d.dayNum}`;
                                      setDailySortKey(key);
                                      setDailySortDir((dir) => (dailySortKey === key ? (dir === 'asc' ? 'desc' : 'asc') : 'desc'));
                                    }}
                                    title={titleText}
                                    className={`matrix-day-th px-0.5 py-1.5 text-center w-[36px] min-w-[36px] max-w-[36px] cursor-pointer select-none transition-colors border-b border-white/20 ${
                                      isHol || isWk
                                        ? 'bg-amber-400/20 text-amber-200 hover:bg-amber-400/30'
                                        : 'text-white hover:bg-white/10'
                                    }`}
                                  >
                                    <div className="leading-tight flex flex-col items-center justify-center">
                                      <span className={`block text-xs font-semibold tabular-nums leading-none ${isWk || isHol ? 'text-white font-bold' : 'text-white'}`}>
                                        {d.dayNum}
                                      </span>
                                      <span
                                        className={`block text-[10px] font-medium leading-none mt-1 ${
                                          isHol || d.isSunday || d.isSaturday
                                            ? 'text-amber-300 font-semibold tracking-wide'
                                            : 'text-sky-200/90 font-medium'
                                        }`}
                                      >
                                        {isHol ? 'Hol' : d.dayOfWeek}
                                      </span>
                                    </div>
                                  </th>
                                );
                              })}

                              {/* Summary Headers */}
                              <th
                                className="px-3 py-2.5 text-center w-[100px] min-w-[100px] cursor-pointer select-none hover:bg-white/10 transition-colors border-b border-white/20"
                                onClick={() => {
                                  setDailySortKey('monthTotalTasks');
                                  setDailySortDir((d) => (dailySortKey === 'monthTotalTasks' ? (d === 'asc' ? 'desc' : 'asc') : 'desc'));
                                }}
                              >
                                <div className="flex items-center justify-center gap-1 font-medium text-xs text-white">
                                  <span>Month Tasks</span>
                                  <SortIcon active={dailySortKey === 'monthTotalTasks'} dir={dailySortDir} />
                                </div>
                              </th>
                              <th
                                className="px-2.5 py-2.5 text-center w-[80px] min-w-[80px] cursor-pointer select-none hover:bg-white/10 transition-colors border-b border-white/20"
                                onClick={() => {
                                  setDailySortKey('dailyAvg');
                                  setDailySortDir((d) => (dailySortKey === 'dailyAvg' ? (d === 'asc' ? 'desc' : 'asc') : 'desc'));
                                }}
                              >
                                <div className="flex items-center justify-center gap-1 font-medium text-xs text-white">
                                  <span>Daily Avg</span>
                                  <SortIcon active={dailySortKey === 'dailyAvg'} dir={dailySortDir} />
                                </div>
                              </th>
                              <th className="px-2.5 py-2.5 text-center w-[75px] min-w-[75px] font-medium text-xs text-white border-b border-white/20">
                                Target
                              </th>
                              <th
                                className="px-2.5 py-2.5 text-center w-[85px] min-w-[85px] cursor-pointer select-none hover:bg-white/10 transition-colors border-b border-white/20"
                                onClick={() => {
                                  setDailySortKey('targetPct');
                                  setDailySortDir((d) => (dailySortKey === 'targetPct' ? (d === 'asc' ? 'desc' : 'asc') : 'desc'));
                                }}
                              >
                                <div className="flex items-center justify-center gap-1 font-medium text-xs text-white">
                                  <span>% Target</span>
                                  <SortIcon active={dailySortKey === 'targetPct'} dir={dailySortDir} />
                                </div>
                              </th>
                              <th className="px-3 py-2.5 text-center w-[152px] min-w-[152px] font-medium text-xs text-white border-b border-white/20">
                                Performance
                              </th>
                            </tr>
                          </thead>

                          <tbody className="divide-y divide-slate-100 text-slate-700">
                            {sortedDailyBranchRows.length === 0 ? (
                              <tr>
                                <td colSpan={matrixDays.length + 7} className="p-10 text-center text-sm text-slate-500">
                                  No branch records match the current filters.
                                </td>
                              </tr>
                            ) : (
                              sortedDailyBranchRows.slice(dailyBranchPg.start, dailyBranchPg.drawEnd).map((row, idx) => {
                                const rank = dailyBranchPg.start + idx + 1;
                                return (
                                  <tr key={row.branchId} className="group hover:bg-slate-50/80 transition-colors">
                                    <td className="sticky left-0 bg-white group-hover:bg-slate-50 z-10 px-2 py-2 text-center tabular-nums text-slate-400 text-xs border-r border-slate-100 font-normal">
                                      {rank}
                                    </td>
                                    <td
                                      className="sticky left-[36px] bg-white group-hover:bg-slate-50 z-10 px-3 py-2 text-slate-900 shadow-[2px_0_4px_rgba(0,0,0,0.06)] border-r border-slate-200/70 font-normal max-w-[210px]"
                                      title={`${cleanBranchName(row.branchName)} (${fmtBranchCode(row.branchId)})`}
                                    >
                                      <span className="block truncate font-medium text-slate-900 leading-snug">
                                        {cleanBranchName(row.branchName)}
                                      </span>
                                      <span className="block font-mono text-[11px] text-slate-400 tabular-nums leading-tight mt-0.5">
                                        {row.branchId && row.branchId !== 'UNASSIGNED' ? `Code ${fmtBranchCode(row.branchId)}` : 'Unassigned'}
                                      </span>
                                    </td>

                                    {/* Day cells 1..N */}
                                    {row.days.map((d) => {
                                      const dayMeta = matrixDaysMap.get(d.dayNum);
                                      const isHol = dayMeta?.isHoliday;
                                      const isWk = dayMeta?.isWeekend;
                                      const hasTasks = d.count > 0;

                                      let tooltip = '';
                                      if (isHol) {
                                        tooltip = hasTasks
                                          ? `🎉 ${cleanBranchName(row.branchName)} · ${d.isoDay} (${dayMeta?.dayOfWeek}): ${d.count} tasks completed\n🇰🇭 ${dayMeta?.holidayName} (Cambodian Public Holiday · Excluded from KPI count)\nPOS: ${d.raw?.posTasks || 0} · SB: ${d.raw?.sbTasks || 0} · KHQR: ${d.raw?.khqrTasks || 0} · CC: ${d.raw?.ccTasks || 0}${(d.raw?.mvTasks ?? 0) > 0 ? ` · MV: ${d.raw?.mvTasks}` : ''}`
                                          : `🎉 0 tasks · 🇰🇭 ${dayMeta?.holidayName} (Cambodian Public Holiday)`;
                                      } else if (isWk) {
                                        tooltip = hasTasks
                                          ? `⚠️ ${cleanBranchName(row.branchName)} · ${d.isoDay} (${dayMeta?.dayOfWeek}): ${d.count} tasks completed\nWeekend (${dayMeta?.dayOfWeek} · Excluded from KPI count)\nPOS: ${d.raw?.posTasks || 0} · SB: ${d.raw?.sbTasks || 0} · KHQR: ${d.raw?.khqrTasks || 0} · CC: ${d.raw?.ccTasks || 0}${(d.raw?.mvTasks ?? 0) > 0 ? ` · MV: ${d.raw?.mvTasks}` : ''}`
                                          : `Weekend (${dayMeta?.dayOfWeek} · Excluded from KPI)`;
                                      } else {
                                        tooltip = d.raw
                                          ? `${cleanBranchName(row.branchName)} · ${d.isoDay} (${dayMeta?.dayOfWeek}): ${d.count} tasks\nPOS: ${d.raw.posTasks} · SB: ${d.raw.sbTasks} · KHQR: ${d.raw.khqrTasks} · CC: ${d.raw.ccTasks}${(d.raw.mvTasks ?? 0) > 0 ? ` · MV: ${d.raw.mvTasks}` : ''}\nActive Staff: ${d.raw.activeStaff}`
                                          : `${cleanBranchName(row.branchName)} · ${d.isoDay} (${dayMeta?.dayOfWeek}): 0 tasks`;
                                      }

                                      return (
                                        <td
                                          key={d.dayNum}
                                          className={`px-0.5 py-1 text-center w-[36px] min-w-[36px] max-w-[36px] transition-colors ${
                                            isHol || isWk
                                              ? 'bg-amber-50/40 border-r border-slate-100'
                                              : 'border-r border-slate-100'
                                          }`}
                                          title={tooltip}
                                        >
                                          {hasTasks ? (
                                            <span
                                              className={`inline-flex items-center justify-center min-w-[26px] h-[22px] px-1 rounded-md text-[11.5px] tabular-nums ${
                                                isHol || isWk
                                                  ? 'bg-amber-100/80 text-amber-900 border border-amber-300 border-dashed font-normal'
                                                  : d.count >= 25
                                                  ? 'bg-[#eaf4f2] text-[#1d5c55] font-semibold'
                                                  : d.count >= 10
                                                  ? 'text-slate-600 font-normal'
                                                  : 'text-slate-400 font-normal'
                                              }`}
                                            >
                                              {d.count}
                                            </span>
                                          ) : (
                                            <span className="text-slate-300 text-xs font-light select-none" title={isHol ? (dayMeta?.holidayName || 'Holiday') : undefined}>·</span>
                                          )}
                                        </td>
                                      );
                                    })}

                                    {/* Summary Columns */}
                                    <td className="px-3 py-2 text-center tabular-nums font-normal text-slate-900 border-l border-slate-200/60">
                                      {fmtInt(row.monthTotalTasks)}
                                    </td>
                                    <td className="px-2 py-2 text-center tabular-nums font-normal text-slate-700">
                                      {row.dailyAvg}
                                    </td>
                                    <td className="px-2 py-2 text-center tabular-nums font-normal text-slate-500" title={`${row.staffCount} staff × ${Math.round((data?.targets?.staffDailyTarget ?? 5) * (monthWorkDaysSummary.workDays > 0 ? monthWorkDaysSummary.workDays : (data?.targets?.workDaysInMonth ?? 21)))} pts (${row.dailyTarget} pts/day)`}>
                                      {fmtInt(row.target)}
                                    </td>
                                    <td className="px-2 py-2 text-center tabular-nums font-normal text-slate-900" title={`Pacing target so far: ${row.pacingTarget} tasks (${row.pacingPct}% pacing for Day ${pacingInfo.elapsedWorkDays}/${pacingInfo.totalWorkDays})`}>
                                      {row.targetPct}%
                                    </td>
                                    <td className="px-3 py-2 text-center whitespace-nowrap">
                                      <RatingBadge rating={row.rating} pacingPct={row.pacingPct} title={`Pacing: ${row.pacingPct}% (${row.monthTotalTasks} / ${row.pacingTarget} tasks pacing target for Day ${pacingInfo.elapsedWorkDays}/${pacingInfo.totalWorkDays})`} />
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>

                          {sortedDailyBranchRows.length > 0 && (
                            <tfoot>
                              <tr className="bg-slate-100/90 font-medium text-slate-800 border-t-2 border-slate-300 text-[12px]">
                                <td
                                  colSpan={2}
                                  className="sticky left-0 bg-slate-100 z-10 px-3 py-2.5 text-left font-medium text-slate-900 shadow-[2px_0_4px_rgba(0,0,0,0.06)] border-r border-slate-300"
                                >
                                  Total Across All Branches ({sortedDailyBranchRows.length})
                                </td>

                                {matrixDays.map((d) => {
                                  const count = matrixDayTotals.totalsByDay[d.dayNum] || 0;
                                  return (
                                    <td
                                      key={d.dayNum}
                                      className={`px-0.5 py-2 text-center w-[36px] min-w-[36px] max-w-[36px] tabular-nums text-[11px] ${
                                        d.isHoliday || d.isWeekend
                                          ? 'bg-amber-100/50 text-amber-900 font-medium border-r border-slate-200'
                                          : 'border-r border-slate-200 ' + (count > 0 ? 'text-slate-900 font-medium' : 'text-slate-400 font-light')
                                      }`}
                                      title={`All branches on ${d.isoDay} (${d.dayOfWeek}${d.isHoliday ? ` · HOL: ${d.holidayName}` : ''}): ${count} tasks`}
                                    >
                                      {count > 0 ? count : '·'}
                                    </td>
                                  );
                                })}

                                <td className="px-3 py-2.5 text-center tabular-nums font-normal text-slate-800 border-l border-slate-300 text-xs" title="Total KPI-eligible tasks on official working days">
                                  {fmtInt(matrixDayTotals.allGrandTotal)}
                                </td>
                                <td className="px-2 py-2.5 text-center tabular-nums font-normal text-slate-700 text-xs" title="Average tasks per official working day">
                                  {matrixDayTotals.avgDailyTotal}
                                </td>
                                <td className="px-2 py-2.5 text-center tabular-nums text-slate-500 text-xs" title="Sum of all dynamic branch targets (Individual Target × Staff Count)">
                                  {fmtInt(sortedDailyBranchRows.reduce((acc, r) => acc + r.target, 0))}
                                </td>
                                <td className="px-2 py-2.5 text-center tabular-nums font-medium text-slate-900 text-xs">
                                  {(() => {
                                    const totalTarget = sortedDailyBranchRows.reduce((acc, r) => acc + r.target, 0);
                                    return totalTarget > 0 ? `${Math.round((matrixDayTotals.allGrandTotal / totalTarget) * 100)}%` : '0%';
                                  })()}
                                </td>
                                <td className="px-3 py-2.5 text-center">
                                  <span className="text-[11px] text-slate-500 font-medium">Month Total</span>
                                </td>
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      </div>
                      <Pager pg={dailyBranchPg} label="branches" />
                    </>
                  ) : (
            <>
              <div className="overflow-x-auto overflow-y-hidden w-full overscroll-x-contain">
                <div className="min-w-[1220px] w-full">
                <div className={`${KPI_BRANCH_GRID} glass-table-thead navy-header-bar bg-[#002F4A] text-white text-[10.5px] font-semibold uppercase tracking-wide px-3 py-2.5`}>
                  <span className="text-center text-white/80">No.</span>
                  <SortableHeader label="Branch" sortKey="branchName" activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} />
                  <SortableHeader label="Staff" sortKey="staffCount" activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader label="POS Terminal" title="Sort by POS Terminal" sortKey={isTaskMode ? 'posTasks' : 'posPoints'} activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader label="Sound Box" title="Sort by Sound Box" sortKey={isTaskMode ? 'sbTasks' : 'sbPoints'} activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader label="KHQR" title="Sort by KHQR" sortKey={isTaskMode ? 'khqrTasks' : 'khqrPoints'} activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader label="Credit Card" title="Sort by Credit Card" sortKey={isTaskMode ? 'ccTasks' : 'ccPoints'} activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader label="Merchant Visit" title="Sort by Merchant Visit" sortKey={isTaskMode ? 'mvTasks' : 'mvPoints'} activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader label="Avg" sortKey={isTaskMode ? 'tasksPerStaff' : 'ptsPerStaff'} activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" title="Average KPI points & tasks per active staff member in the branch" />
                  <SortableHeader label={isTaskMode ? 'Pts' : 'Tasks'} sortKey={isTaskMode ? 'totalPoints' : 'totalTasks'} activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader label={isTaskMode ? 'Total Tasks' : 'Total Pts'} sortKey={isTaskMode ? 'totalTasks' : 'totalPoints'} activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" className="pr-1" />
                  <SortableHeader label="Target" title={activeTargets.label} sortKey="targetPct" activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} className="pl-2.5 pr-1.5" />
                  <span className="text-slate-200 pl-2">Status</span>
                  <span />
                </div>

                <div className="divide-y divide-slate-100 silk-rows">
                  {statusFilteredBranches.length === 0 ? (
                    <div className="p-10 text-center text-sm text-slate-500">No branches match the current filters.</div>
                  ) : (
                    statusFilteredBranches.slice(branchPg.start, branchPg.drawEnd).map((b, i) => {
                      const rank = branchPg.start + i + 1;
                      const isOpen = openBranch === b.branchId;
                      return (
                        <div key={b.branchId} className="hover:bg-slate-50/80 transition-colors">
                          <button
                            type="button"
                            onClick={() => setOpenBranch((o) => (o === b.branchId ? null : b.branchId))}
                            aria-expanded={isOpen}
                            className={`${KPI_BRANCH_GRID} w-full text-left px-3 py-2.5 text-[13px] text-slate-700 cursor-pointer`}
                          >
                            <span className="text-center tabular-nums text-xs text-slate-400">{rank}</span>
                            <span className="min-w-0 block" title={`${cleanBranchName(b.branchName)} (${fmtBranchCode(b.branchId)})`}>
                              <span className="block text-slate-900 font-medium truncate leading-snug">
                                {cleanBranchName(b.branchName)}
                              </span>
                              <span className="block font-mono text-[11px] text-slate-400 tabular-nums leading-tight mt-0.5">
                                {b.branchId && b.branchId !== 'UNASSIGNED' ? `Code ${fmtBranchCode(b.branchId)}` : 'Unassigned'}
                              </span>
                            </span>
                            <span className="text-center tabular-nums text-slate-700">{b.staffCount}</span>
                            <span className="text-center tabular-nums"><TaskPtsCell tasks={b.posTasks} pts={b.posPoints} mode={metricMode} /></span>
                            <span className="text-center tabular-nums"><TaskPtsCell tasks={b.sbTasks} pts={b.sbPoints} mode={metricMode} /></span>
                            <span className="text-center tabular-nums"><TaskPtsCell tasks={b.khqrTasks} pts={b.khqrPoints} mode={metricMode} /></span>
                            <span className="text-center tabular-nums"><TaskPtsCell tasks={b.ccTasks} pts={b.ccPoints} mode={metricMode} /></span>
                            <span className="text-center tabular-nums"><TaskPtsCell tasks={b.mvTasks} pts={b.mvPoints} mode={metricMode} /></span>
                            <span className="text-center tabular-nums"><TaskPtsCell tasks={b.tasksPerStaff} pts={b.ptsPerStaff} mode={metricMode} decimalTasks /></span>
                            <span className="text-center tabular-nums text-slate-600">
                              {isTaskMode ? `${fmtPts(b.totalPoints)}` : fmtInt(b.totalTasks)}
                            </span>
                            <span className="text-right tabular-nums font-figure font-medium text-[#002F4A] whitespace-nowrap pr-1">
                              {isTaskMode ? fmtInt(b.totalTasks) : fmtPts(b.totalPoints)}
                            </span>
                            <span className="min-w-0 pl-2.5 pr-1.5"><TargetBar pct={b.targetPct} points={b.totalPoints} target={b.effectiveTarget} pacingPct={b.pacingPct} pacingTarget={b.pacingTarget} /></span>
                            <span className="min-w-0 pl-2 flex items-center"><RatingBadge rating={b.rating} pacingPct={b.pacingPct} title={`Pacing: ${b.pacingPct}% (${fmtPts(b.totalPoints)} / ${fmtPts(b.pacingTarget)} pts pacing target for Day ${pacingInfo.elapsedWorkDays}/${pacingInfo.totalWorkDays})`} /></span>
                            <ChevronDown className={`w-4 h-4 text-slate-400 justify-self-end transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                          </button>

                          <AnimatePresence initial={false}>
                            {isOpen && (
                              <motion.div
                                initial={{ opacity: 0, y: -6 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -6, transition: { duration: 0.14 } }}
                                transition={SPRING}
                                className="px-4 pb-4 pt-2 bg-slate-50/60 border-t border-slate-100"
                              >
                                <SubCategoryMiniGrid raw={b.raw} ruleMap={ruleMap} mode={metricMode} />
                                <div className="mt-3 rounded-xl border border-slate-200 bg-white overflow-hidden">
                                  <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-medium uppercase tracking-wider text-slate-500">
                                    Staff contributors in {cleanBranchName(b.branchName)} ({b.staffList.length})
                                  </div>
                                  <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto text-[13px] text-slate-700">
                                    {b.staffList.map((s, idx) => (
                                      <div key={s.staffId} className="px-3.5 py-2 flex items-center justify-between">
                                        <div>
                                          <span className="text-slate-400 font-mono mr-2">{idx + 1}.</span>
                                          <span className="font-medium text-slate-900">{s.staffName}</span>{' '}
                                          <span className="text-slate-500">({s.staffId})</span>
                                        </div>
                                        <div className="flex items-center gap-4 tabular-nums text-xs">
                                          <span className="text-slate-500">POS: {isTaskMode ? fmtInt(s.posTasks) : fmtPts(s.posPoints)}</span>
                                          <span className="text-slate-500">SB: {isTaskMode ? fmtInt(s.sbTasks) : fmtPts(s.sbPoints)}</span>
                                          <span className="text-slate-500">KHQR: {isTaskMode ? fmtInt(s.khqrTasks) : fmtPts(s.khqrPoints)}</span>
                                          <span className="text-slate-500">CC: {isTaskMode ? fmtInt(s.ccTasks) : fmtPts(s.ccPoints)}</span>
                                          <span className="text-slate-500">MV: {isTaskMode ? fmtInt(s.mvTasks) : fmtPts(s.mvPoints)}</span>
                                          <span className="font-medium text-slate-900">
                                            {isTaskMode ? `${fmtInt(s.totalTasks)} tasks` : `${fmtPts(s.totalPoints)} pts`}
                                          </span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
              </div>
              <Pager pg={branchPg} label="branches" />
            </>
          )
        ) : staffSubView === 'daily' ? (
          <>
            <div className="overflow-x-auto overflow-y-hidden w-full overscroll-x-contain">
              <table className="kpi-matrix-table w-full text-left border-separate border-spacing-0 text-[13px]">
                <thead>
                  <tr className="navy-header-bar bg-[#002F4A] text-white text-[11px] font-semibold uppercase tracking-wider select-none">
                    <th className="sticky left-0 bg-[#002F4A] z-30 px-2 py-2.5 text-center w-[36px] min-w-[36px] font-semibold text-[11px] text-white/90 border-b border-white/20">
                      No.
                    </th>
                    <th
                      className="sticky left-[36px] bg-[#002F4A] z-30 px-3 py-2.5 text-left w-[205px] min-w-[205px] cursor-pointer select-none hover:bg-white/10 transition-colors border-b border-white/20"
                      onClick={() => {
                        setDailyStaffSortKey('staffName');
                        setDailyStaffSortDir((d) => (dailyStaffSortKey === 'staffName' ? (d === 'asc' ? 'desc' : 'asc') : 'desc'));
                      }}
                    >
                      <div className="flex items-center gap-1 font-semibold text-[11px] text-white">
                        <span>Staff</span>
                        <SortIcon active={dailyStaffSortKey === 'staffName'} dir={dailyStaffSortDir} />
                      </div>
                    </th>
                    <th
                      className="sticky left-[241px] bg-[#002F4A] z-30 px-2.5 py-2.5 text-left w-[68px] min-w-[68px] cursor-pointer select-none hover:bg-white/10 transition-colors border-r border-slate-700/90 border-b border-white/20 shadow-[2px_0_4px_rgba(0,0,0,0.18)]"
                      onClick={() => {
                        setDailyStaffSortKey('branchId');
                        setDailyStaffSortDir((d) => (dailyStaffSortKey === 'branchId' ? (d === 'asc' ? 'desc' : 'asc') : 'desc'));
                      }}
                    >
                      <div className="flex items-center gap-1 font-semibold text-[11px] text-white">
                        <span>Code</span>
                        <SortIcon active={dailyStaffSortKey === 'branchId'} dir={dailyStaffSortDir} />
                      </div>
                    </th>

                    {/* Days 1..N */}
                    {matrixDays.map((d) => {
                      const isHol = d.isHoliday;
                      const isWk = d.isWeekend;
                      const titleText = isHol
                        ? `🇰🇭 ${d.holidayName} · ${d.isoDay} (${d.dayOfWeek})\nOfficial Cambodian Public Holiday (Excluded from KPI count)`
                        : isWk
                        ? `Weekend · ${d.isoDay} (${d.dayOfWeek})\nExcluded from KPI count`
                        : `${d.isoDay} (${d.dayOfWeek}) · Official Work Day\nClick to sort staff by tasks`;

                      return (
                        <th
                          key={d.dayNum}
                          onClick={() => {
                            const key = `day_${d.dayNum}`;
                            setDailyStaffSortKey(key);
                            setDailyStaffSortDir((dir) => (dailyStaffSortKey === key ? (dir === 'asc' ? 'desc' : 'asc') : 'desc'));
                          }}
                          title={titleText}
                          className={`matrix-day-th px-0.5 py-1.5 text-center w-[36px] min-w-[36px] max-w-[36px] cursor-pointer select-none transition-colors border-b border-white/20 ${
                            isHol || isWk
                                        ? 'bg-amber-400/20 text-amber-200 hover:bg-amber-400/30'
                                        : 'text-white hover:bg-white/10'
                          }`}
                        >
                          <div className="leading-tight flex flex-col items-center justify-center">
                            <span className={`block text-xs font-semibold tabular-nums leading-none ${isWk || isHol ? 'text-white font-bold' : 'text-white'}`}>
                              {d.dayNum}
                            </span>
                            <span
                              className={`block text-[10px] font-medium leading-none mt-1 ${
                                isHol || d.isSunday || d.isSaturday
                                            ? 'text-amber-300 font-semibold tracking-wide'
                                            : 'text-sky-200/90 font-medium'
                              }`}
                            >
                              {isHol ? 'Hol' : d.dayOfWeek}
                            </span>
                          </div>
                        </th>
                      );
                    })}

                    {/* Summary Headers */}
                    <th
                      className="px-3 py-2.5 text-center w-[100px] min-w-[100px] cursor-pointer select-none hover:bg-white/10 transition-colors border-b border-white/20"
                      onClick={() => {
                        setDailyStaffSortKey('monthTotalTasks');
                        setDailyStaffSortDir((d) => (dailyStaffSortKey === 'monthTotalTasks' ? (d === 'asc' ? 'desc' : 'asc') : 'desc'));
                      }}
                    >
                      <div className="flex items-center justify-center gap-1 font-medium text-xs text-white">
                        <span>Month Tasks</span>
                        <SortIcon active={dailyStaffSortKey === 'monthTotalTasks'} dir={dailyStaffSortDir} />
                      </div>
                    </th>
                    <th
                      className="px-2.5 py-2.5 text-center w-[80px] min-w-[80px] cursor-pointer select-none hover:bg-white/10 transition-colors border-b border-white/20"
                      onClick={() => {
                        setDailyStaffSortKey('dailyAvg');
                        setDailyStaffSortDir((d) => (dailyStaffSortKey === 'dailyAvg' ? (d === 'asc' ? 'desc' : 'asc') : 'desc'));
                      }}
                    >
                      <div className="flex items-center justify-center gap-1 font-medium text-xs text-white">
                        <span>Daily Avg</span>
                        <SortIcon active={dailyStaffSortKey === 'dailyAvg'} dir={dailyStaffSortDir} />
                      </div>
                    </th>
                    <th className="px-2.5 py-2.5 text-center w-[75px] min-w-[75px] font-medium text-xs text-white border-b border-white/20">
                      Target
                    </th>
                    <th
                      className="px-2.5 py-2.5 text-center w-[85px] min-w-[85px] cursor-pointer select-none hover:bg-white/10 transition-colors border-b border-white/20"
                      onClick={() => {
                        setDailyStaffSortKey('targetPct');
                        setDailyStaffSortDir((d) => (dailyStaffSortKey === 'targetPct' ? (d === 'asc' ? 'desc' : 'asc') : 'desc'));
                      }}
                    >
                      <div className="flex items-center justify-end gap-1 font-semibold text-xs text-white">
                        <span>% Target</span>
                        <SortIcon active={dailyStaffSortKey === 'targetPct'} dir={dailyStaffSortDir} />
                      </div>
                    </th>
                    <th className="px-3 py-2.5 text-center w-[152px] min-w-[152px] font-medium text-xs text-white border-b border-white/20">
                      Performance
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {sortedDailyStaffRows.length === 0 ? (
                    <tr>
                      <td colSpan={matrixDays.length + 8} className="p-10 text-center text-sm text-slate-500">
                        No staff records match the current filters.
                      </td>
                    </tr>
                  ) : (
                    sortedDailyStaffRows.slice(dailyStaffPg.start, dailyStaffPg.drawEnd).map((row, idx) => {
                      const rank = dailyStaffPg.start + idx + 1;
                      return (
                        <tr key={row.staffId} className="group hover:bg-slate-50/80 transition-colors">
                          <td className="sticky left-0 bg-white group-hover:bg-slate-50 z-10 px-2 py-2 text-center tabular-nums text-slate-400 text-xs border-r border-slate-100 font-normal">
                            {rank}
                          </td>
                          <td
                            className="sticky left-[36px] bg-white group-hover:bg-slate-50 z-10 px-3 py-2 text-slate-900 border-r border-slate-100 font-normal max-w-[205px]"
                            title={`${row.staffName}${row.staffId ? ` (${row.staffId})` : ''}${row.position ? ` · ${row.position}` : ''}`}
                          >
                            <span className="flex items-baseline gap-1.5 min-w-0">
                              {row.isManagement && <ShieldCheck className="w-3.5 h-3.5 text-indigo-600 shrink-0 self-center" aria-hidden />}
                              <span className="truncate font-medium text-slate-900 leading-snug">{row.staffName}</span>
                              {row.staffId && (
                                <span className="font-mono text-[11px] text-slate-400 tabular-nums shrink-0">{row.staffId}</span>
                              )}
                            </span>
                            {row.position && (
                              <span className={`block text-[11px] truncate leading-tight mt-0.5 ${row.isManagement ? 'text-indigo-600 font-medium' : 'text-slate-500'}`}>
                                {row.position}
                              </span>
                            )}
                          </td>
                          <td
                            className="sticky left-[241px] bg-white group-hover:bg-slate-50 z-10 px-2.5 py-2 font-mono text-xs text-slate-600 shadow-[2px_0_4px_rgba(0,0,0,0.06)] border-r border-slate-200/70 font-normal truncate max-w-[68px]"
                            title={`${row.branchId} - ${cleanBranchName(row.branchName)}`}
                          >
                            {fmtBranchCode(row.branchId)}
                          </td>

                          {/* Day cells 1..N */}
                          {row.days.map((d) => {
                            const dayMeta = matrixDaysMap.get(d.dayNum);
                            const isHol = dayMeta?.isHoliday;
                            const isWk = dayMeta?.isWeekend;
                            const hasTasks = d.count > 0;

                            let tooltip = '';
                            if (isHol) {
                              tooltip = hasTasks
                                ? `🎉 ${row.staffName} (ID: ${row.staffId}) · Branch ${row.branchId}\n${d.isoDay} (${dayMeta?.dayOfWeek}): ${d.count} tasks completed\n🇰🇭 ${dayMeta?.holidayName} (Cambodian Public Holiday · Excluded from KPI count)\nPOS: ${d.raw?.posTasks || 0} · SB: ${d.raw?.sbTasks || 0} · KHQR: ${d.raw?.khqrTasks || 0} · CC: ${d.raw?.ccTasks || 0}${(d.raw?.mvTasks ?? 0) > 0 ? ` · MV: ${d.raw?.mvTasks}` : ''}`
                                : `🎉 0 tasks · 🇰🇭 ${dayMeta?.holidayName} (Cambodian Public Holiday)`;
                            } else if (isWk) {
                              tooltip = hasTasks
                                ? `⚠️ ${row.staffName} (ID: ${row.staffId}) · Branch ${row.branchId}\n${d.isoDay} (${dayMeta?.dayOfWeek}): ${d.count} tasks completed\nWeekend (${dayMeta?.dayOfWeek} · Excluded from KPI count)\nPOS: ${d.raw?.posTasks || 0} · SB: ${d.raw?.sbTasks || 0} · KHQR: ${d.raw?.khqrTasks || 0} · CC: ${d.raw?.ccTasks || 0}${(d.raw?.mvTasks ?? 0) > 0 ? ` · MV: ${d.raw?.mvTasks}` : ''}`
                                : `Weekend (${dayMeta?.dayOfWeek} · Excluded from KPI)`;
                            } else {
                              tooltip = d.raw
                                ? `${row.staffName} (ID: ${row.staffId}) · Branch ${row.branchId}\n${d.isoDay} (${dayMeta?.dayOfWeek}): ${d.count} tasks\nPOS: ${d.raw.posTasks} · SB: ${d.raw.sbTasks} · KHQR: ${d.raw.khqrTasks} · CC: ${d.raw.ccTasks}${(d.raw.mvTasks ?? 0) > 0 ? ` · MV: ${d.raw.mvTasks}` : ''}`
                                : `${row.staffName} · ${d.isoDay} (${dayMeta?.dayOfWeek}): 0 tasks`;
                            }

                            return (
                              <td
                                key={d.dayNum}
                                className={`px-0.5 py-1 text-center w-[36px] min-w-[36px] max-w-[36px] transition-colors ${
                                  isHol || isWk
                                              ? 'bg-amber-50/40 border-r border-slate-100'
                                              : 'border-r border-slate-100'
                                }`}
                                title={tooltip}
                              >
                                {hasTasks ? (
                                  <span
                                    className={`inline-flex items-center justify-center min-w-[26px] h-[22px] px-1 rounded-md text-[11.5px] tabular-nums ${
                                      isHol || isWk
                                        ? 'bg-amber-100/80 text-amber-900 border border-amber-300 border-dashed font-normal'
                                        : d.count >= 25
                                        ? 'bg-[#eaf4f2] text-[#1d5c55] font-semibold'
                                        : d.count >= 10
                                        ? 'text-slate-600 font-normal'
                                        : 'text-slate-400 font-normal'
                                    }`}
                                  >
                                    {d.count}
                                  </span>
                                ) : (
                                  <span className="text-slate-300 text-xs font-light select-none" title={isHol ? (dayMeta?.holidayName || 'Holiday') : undefined}>·</span>
                                )}
                              </td>
                            );
                          })}

                          {/* Summary Columns */}
                          <td className="px-3 py-2 text-center tabular-nums font-normal text-slate-900 border-l border-slate-200/60">
                            {fmtInt(row.monthTotalTasks)}
                          </td>
                          <td className="px-2 py-2 text-center tabular-nums font-normal text-slate-700">
                            {row.dailyAvg}
                          </td>
                          <td className="px-2 py-2 text-center tabular-nums font-normal text-slate-500">
                            {row.isManagement ? '—' : fmtInt(row.target)}
                          </td>
                          <td className="px-2 py-2 text-center tabular-nums font-normal text-slate-900">
                            {row.isManagement ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200/80">
                                <ShieldCheck className="w-2.5 h-2.5 text-indigo-600 shrink-0" aria-hidden />
                                <span>Exempt</span>
                              </span>
                            ) : (
                              <span title={`Pacing target so far: ${row.pacingTarget} tasks (${row.pacingPct}% pacing for Day ${pacingInfo.elapsedWorkDays}/${pacingInfo.totalWorkDays})`}>
                                {row.targetPct}%
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center whitespace-nowrap">
                            <RatingBadge rating={row.rating} pacingPct={row.pacingPct} title={row.isManagement ? 'Management level staff are exempt from individual field KPIs' : `Pacing: ${row.pacingPct}% (${row.monthTotalTasks} / ${row.pacingTarget} tasks pacing target for Day ${pacingInfo.elapsedWorkDays}/${pacingInfo.totalWorkDays})`} />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>

                {sortedDailyStaffRows.length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-100/90 font-medium text-slate-800 border-t-2 border-slate-300 text-[12px]">
                      <td
                        colSpan={3}
                        className="sticky left-0 bg-slate-100 z-10 px-3 py-2.5 text-left font-medium text-slate-900 shadow-[2px_0_4px_rgba(0,0,0,0.06)] border-r border-slate-300"
                      >
                        Total Across All Staff ({sortedDailyStaffRows.length}{sortedDailyStaffRows.some((r) => r.isManagement) ? ` · ${sortedDailyStaffRows.filter((r) => !r.isManagement).length} Field Officers` : ''})
                      </td>

                      {matrixDays.map((d) => {
                        const count = matrixStaffDayTotals.totalsByDay[d.dayNum] || 0;
                        return (
                          <td
                            key={d.dayNum}
                            className={`px-0.5 py-2 text-center w-[36px] min-w-[36px] max-w-[36px] tabular-nums text-[11px] ${
                              d.isHoliday || d.isWeekend
                                          ? 'bg-amber-100/50 text-amber-900 font-medium border-r border-slate-200'
                                          : 'border-r border-slate-200 ' + (count > 0 ? 'text-slate-900 font-medium' : 'text-slate-400 font-light')
                            }`}
                            title={`All staff on ${d.isoDay} (${d.dayOfWeek}${d.isHoliday ? ` · HOL: ${d.holidayName}` : ''}): ${count} tasks`}
                          >
                            {count > 0 ? count : '·' }
                          </td>
                        );
                      })}

                      <td className="px-3 py-2.5 text-center tabular-nums font-normal text-slate-800 border-l border-slate-300 text-xs" title="Total KPI-eligible tasks on official working days">
                        {fmtInt(matrixStaffDayTotals.allGrandTotal)}
                      </td>
                      <td className="px-2 py-2.5 text-center tabular-nums font-normal text-slate-700 text-xs" title="Average tasks per official working day">
                        {matrixStaffDayTotals.avgDailyTotal}
                      </td>
                      {(() => {
                        const fieldStaffCount = sortedDailyStaffRows.filter((r) => !r.isManagement).length;
                        const totalFieldTarget = Math.round((data?.targets?.staffDailyTarget ?? 5) * (monthWorkDaysSummary.workDays) * fieldStaffCount);
                        return (
                          <>
                            <td className="px-2 py-2.5 text-center tabular-nums text-slate-500 text-xs" title={`Target based on ${fieldStaffCount} field officers (management exempt)`}>
                              {fmtInt(totalFieldTarget)}
                            </td>
                            <td className="px-2 py-2.5 text-center tabular-nums font-medium text-slate-900 text-xs">
                              {totalFieldTarget > 0
                                ? `${Math.round((matrixStaffDayTotals.allGrandTotal / totalFieldTarget) * 100)}%`
                                : '0%'}
                            </td>
                          </>
                        );
                      })()}
                      <td className="px-3 py-2.5 text-center">
                        <span className="text-[11px] text-slate-500 font-medium">Month Total</span>
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <Pager pg={dailyStaffPg} label="staff members" />
          </>
        ) : (
          <>
            <div className="overflow-x-auto overflow-y-hidden w-full overscroll-x-contain">
              <div className="min-w-[1220px] w-full">
                <div className={`${KPI_STAFF_GRID} glass-table-thead navy-header-bar bg-[#002F4A] text-white text-[10.5px] font-semibold uppercase tracking-wide px-3 py-2.5`}>
                  <span className="text-center text-white/80">No.</span>
                  <SortableHeader label="Staff" sortKey="staffName" activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} />
                  <SortableHeader label="Branch" sortKey="branchName" activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} />
                  <SortableHeader label="POS Terminal" title="Sort by POS Terminal" sortKey={isTaskMode ? 'posTasks' : 'posPoints'} activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader label="Sound Box" title="Sort by Sound Box" sortKey={isTaskMode ? 'sbTasks' : 'sbPoints'} activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader label="KHQR" title="Sort by KHQR" sortKey={isTaskMode ? 'khqrTasks' : 'khqrPoints'} activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader label="Credit Card" title="Sort by Credit Card" sortKey={isTaskMode ? 'ccTasks' : 'ccPoints'} activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader label="Merchant Visit" title="Sort by Merchant Visit" sortKey={isTaskMode ? 'mvTasks' : 'mvPoints'} activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader label={isTaskMode ? 'Pts' : 'Tasks'} sortKey={isTaskMode ? 'totalPoints' : 'totalTasks'} activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader label={isTaskMode ? 'Total Tasks' : 'Total Pts'} sortKey={isTaskMode ? 'totalTasks' : 'totalPoints'} activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" className="pr-1" />
                  <SortableHeader label="Target" title={activeTargets.label} sortKey="targetPct" activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} className="pl-2.5 pr-1.5" />
                  <span className="text-slate-200 pl-2">Status</span>
                  <span />
                </div>

                <div className="divide-y divide-slate-100 silk-rows">
                  {statusFilteredStaff.length === 0 ? (
                    <div className="p-10 text-center text-sm text-slate-500">No staff records match the current filters.</div>
                  ) : (
                    statusFilteredStaff.slice(staffPg.start, staffPg.drawEnd).map((s, i) => {
                      const rank = staffPg.start + i + 1;
                      const isOpen = openStaff === s.staffId;
                      return (
                        <div key={s.staffId} className="hover:bg-slate-50/80 transition-colors">
                          <button
                            type="button"
                            onClick={() => setOpenStaff((o) => (o === s.staffId ? null : s.staffId))}
                            aria-expanded={isOpen}
                            className={`${KPI_STAFF_GRID} w-full text-left px-3 py-2.5 text-[13px] text-slate-700 cursor-pointer`}
                          >
                            <span className="text-center tabular-nums text-xs text-slate-400">{rank}</span>
                            <span
                              className="min-w-0 block"
                              title={`${s.staffName}${s.staffId ? ` (${s.staffId})` : ''}${s.position ? ` · ${s.position}` : ''}`}
                            >
                              <span className="flex items-baseline gap-1.5 min-w-0">
                                {s.isManagement && (
                                  <ShieldCheck className="w-3.5 h-3.5 text-indigo-600 shrink-0 self-center" aria-hidden />
                                )}
                                <span className="text-slate-900 font-medium truncate leading-snug">{s.staffName}</span>
                                {s.staffId && (
                                  <span className="font-mono text-[11px] text-slate-400 tabular-nums shrink-0">{s.staffId}</span>
                                )}
                              </span>
                              {s.position && (
                                <span className={`text-[11px] truncate block leading-tight mt-0.5 ${s.isManagement ? 'text-indigo-600 font-medium' : 'text-slate-500'}`}>
                                  {s.position}
                                </span>
                              )}
                            </span>
                            <span
                              className="min-w-0 block"
                              title={`${cleanBranchName(s.branchName)}${s.branchId && s.branchId !== 'UNASSIGNED' ? ` (Code ${fmtBranchCode(s.branchId)})` : ''}`}
                            >
                              <span className="block truncate font-medium text-slate-900 leading-snug">
                                {cleanBranchName(s.branchName)}
                              </span>
                              <span className="block font-mono text-[11px] text-slate-400 tabular-nums leading-tight mt-0.5">
                                {s.branchId && s.branchId !== 'UNASSIGNED' ? `Code ${fmtBranchCode(s.branchId)}` : 'Unassigned'}
                              </span>
                            </span>
                            <span className="text-center tabular-nums"><TaskPtsCell tasks={s.posTasks} pts={s.posPoints} mode={metricMode} /></span>
                            <span className="text-center tabular-nums"><TaskPtsCell tasks={s.sbTasks} pts={s.sbPoints} mode={metricMode} /></span>
                            <span className="text-center tabular-nums"><TaskPtsCell tasks={s.khqrTasks} pts={s.khqrPoints} mode={metricMode} /></span>
                            <span className="text-center tabular-nums"><TaskPtsCell tasks={s.ccTasks} pts={s.ccPoints} mode={metricMode} /></span>
                            <span className="text-center tabular-nums"><TaskPtsCell tasks={s.mvTasks} pts={s.mvPoints} mode={metricMode} /></span>
                            <span className="text-center tabular-nums text-slate-600">
                              {isTaskMode ? fmtPts(s.totalPoints) : fmtInt(s.totalTasks)}
                            </span>
                            <span className="text-right tabular-nums font-figure font-medium text-[#002F4A] whitespace-nowrap pr-1">
                              {isTaskMode ? fmtInt(s.totalTasks) : fmtPts(s.totalPoints)}
                            </span>
                            <span className="min-w-0 pl-2.5 pr-1.5"><TargetBar pct={s.targetPct} points={s.totalPoints} target={s.effectiveTarget} pacingPct={s.pacingPct} pacingTarget={s.pacingTarget} isManagement={s.isManagement} /></span>
                            <span className="min-w-0 pl-2 flex items-center"><RatingBadge rating={s.rating} pacingPct={s.pacingPct} title={`Pacing: ${s.pacingPct}% (${fmtPts(s.totalPoints)} / ${fmtPts(s.pacingTarget)} pts pacing target for Day ${pacingInfo.elapsedWorkDays}/${pacingInfo.totalWorkDays})`} /></span>
                            <ChevronDown className={`w-4 h-4 text-slate-400 justify-self-end transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                          </button>

                          <AnimatePresence initial={false}>
                            {isOpen && (
                              <motion.div
                                initial={{ opacity: 0, y: -6 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -6, transition: { duration: 0.14 } }}
                                transition={SPRING}
                                className="px-4 pb-4 pt-2 bg-slate-50/60 border-t border-slate-100"
                              >
                                <SubCategoryMiniGrid raw={s} ruleMap={ruleMap} mode={metricMode} />
                                <div className="mt-2.5 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                                  <span>POS rejected: <span className="text-slate-800">{s.posRejected}</span> / {s.posSubmitted}</span>
                                  <span>Sound Box rejected: <span className="text-slate-800">{s.sbRejected}</span> / {s.sbSubmitted}</span>
                                  <span>KHQR blocked submits: <span className="text-slate-800">{s.khqrFailed}</span></span>
                                  <span>Credit Card rejected: <span className="text-slate-800">{s.ccRejected}</span> / {s.ccSubmitted}</span>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
              </div>
              <Pager pg={staffPg} label="staff members" />
            </>
          )}
        </div>
    )}
  </section>
      </div>


    </div>
  );
};

/* ───────────── Custom High-Readability Institutional Chart Tooltips & Axis Ticks ───────────── */

/* ───────────── Helper Sub-Components ───────────── */

const TaskPtsCell: React.FC<{
  tasks?: number;
  pts: number;
  mode?: KpiMetricMode;
  align?: 'center' | 'right';
  decimalTasks?: boolean;
  emphasis?: boolean;
}> = React.memo(({ tasks = 0, pts, mode = 'points', align = 'center', decimalTasks = false, emphasis = false }) => {
  const isTasks = mode === 'tasks';
  const val = isTasks ? tasks : pts;
  const alignCls = align === 'right' ? 'text-right' : 'text-center';
  if (val <= 0) {
    return (
      <span className={`text-slate-300 font-light block w-full select-none ${alignCls}`}>
        —
      </span>
    );
  }
  const taskStr = decimalTasks ? fmtPts(tasks) : fmtInt(tasks);
  const taskUnit = tasks === 1 ? 'task' : 'tasks';
  const ptsStr = fmtPts(pts);
  const primaryColor = emphasis ? 'text-[#002F4A] font-semibold' : 'text-slate-800 font-medium';
  return (
    <span
      className={`font-figure tabular-nums block w-full whitespace-nowrap ${alignCls} ${primaryColor}`}
      title={`${ptsStr} pts · ${taskStr} ${taskUnit}`}
    >
      {isTasks ? taskStr : ptsStr}
    </span>
  );
});
TaskPtsCell.displayName = 'TaskPtsCell';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const KpiTooltipCategories: React.FC<{ row: any; isTasks: boolean }> = ({ row, isTasks }) => {
  const fmt = (tasks: number, pts: number) => (isTasks ? `${fmtInt(tasks || 0)} tasks` : `${fmtPts(pts || 0)} pts`);
  const mvVal = isTasks ? (row.mvTasks ?? 0) : (row.mvPoints ?? 0);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-4">
        <span className="inline-flex items-center gap-1.5 text-slate-600"><span className="w-2 h-2 rounded-xs bg-[#184e77]" />POS Terminal</span>
        <span className="text-slate-900 tabular-nums">{fmt(row.posTasks, row.posPoints)}</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="inline-flex items-center gap-1.5 text-slate-600"><span className="w-2 h-2 rounded-xs bg-[#4F518C]" />Sound Box</span>
        <span className="text-slate-900 tabular-nums">{fmt(row.sbTasks, row.sbPoints)}</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="inline-flex items-center gap-1.5 text-slate-600"><span className="w-2 h-2 rounded-xs bg-[#1e6091]" />KHQR</span>
        <span className="text-slate-900 tabular-nums">{fmt(row.khqrTasks, row.khqrPoints)}</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="inline-flex items-center gap-1.5 text-slate-600"><span className="w-2 h-2 rounded-xs bg-[#f59e0b]" />Credit Card</span>
        <span className="text-slate-900 tabular-nums">{fmt(row.ccTasks, row.ccPoints)}</span>
      </div>
      {mvVal > 0 && (
        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 text-slate-600"><span className="w-2 h-2 rounded-xs bg-[#2d6a4f]" />Merchant Visit</span>
          <span className="text-slate-900 tabular-nums">{fmt(row.mvTasks, row.mvPoints)}</span>
        </div>
      )}
    </div>
  );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTrendTooltip: React.FC<any> = React.memo(({ active, payload, label, metricMode = 'points' }: any) => {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const isTasks = metricMode === 'tasks';
  const tasksPerStaff = row.activeStaff > 0 ? Math.round((row.totalTasks / row.activeStaff) * 10) / 10 : 0;
  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white/95 backdrop-blur-md p-3.5 shadow-xl text-xs min-w-[242px] pointer-events-none">
      <div className="flex items-center justify-between gap-4 pb-1.5 mb-2 border-b border-slate-100">
        <span className="font-semibold text-slate-900">{label}</span>
        <span className="font-figure font-bold text-[#004e75] tabular-nums">
          {isTasks ? `${fmtInt(row.totalTasks)} tasks` : `${fmtPts(row.totalPoints)} pts`}
        </span>
      </div>
      {(row.holidayName || row.isWeekend) && (
        <div
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 mb-2 rounded-md border text-[10.5px] font-semibold ${
            row.holidayName
              ? 'bg-amber-50 border-amber-200/90 text-amber-800'
              : 'bg-slate-100/90 border-slate-200/90 text-slate-600'
          }`}
        >
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: row.holidayName ? '#d97706' : '#64748b' }}
          />
          <span>
            {row.holidayName
              ? `Holiday${row.dayOfWeek ? ` (${row.dayOfWeek})` : ''} · ${row.holidayName}${row.isWeekend ? ' · Weekend' : ''}`
              : `Weekend${row.dayOfWeek ? ` · ${row.dayOfWeek}` : ''}`}
          </span>
        </div>
      )}
      <KpiTooltipCategories row={row} isTasks={isTasks} />
      <div className="mt-2 pt-1.5 border-t border-slate-100 flex items-center justify-between gap-4 text-[11px] text-slate-500">
        <span>{row.activeStaff} active staff · {row.activeBranches} branches</span>
        <span className="text-slate-700 font-medium shrink-0">
          {isTasks ? `${fmtPts(tasksPerStaff)} tasks/staff` : `${fmtPts(row.ptsPerStaff)} pts/staff`}
        </span>
      </div>
    </div>
  );
});
CustomTrendTooltip.displayName = 'CustomTrendTooltip';

/* ───────────── Helper Sub-Components ───────────── */

const KpiCardSkeleton: React.FC = () => (
  <div className="flex flex-col justify-between p-4.5 sm:p-5 rounded-2xl border border-slate-200/90 bg-white shadow-2xs min-h-[142px]">
    <div className="flex items-center justify-between gap-2.5">
      <div className="skeleton h-3.5 w-24 rounded-md" />
      <div className="skeleton w-9.5 h-9.5 rounded-xl shrink-0" />
    </div>
    <div className="my-2.5">
      <div className="skeleton h-7 w-28 rounded-lg" />
    </div>
    <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2">
      <div className="skeleton h-3 w-32 rounded-md" />
      <div className="skeleton h-4 w-14 rounded-md shrink-0" />
    </div>
  </div>
);

const KpiChartsSkeleton: React.FC = () => (
  <section className="relative overflow-hidden rounded-2xl p-4 border shadow-2xs bg-slate-100 border-slate-200/90" aria-label="Loading KPI charts">
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      <div className="lg:col-span-8 bg-white rounded-2xl border border-slate-200/90 p-4 min-h-[390px] flex flex-col justify-between">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="skeleton h-4 w-48 rounded-md" />
          <div className="skeleton h-6 w-32 rounded-lg" />
        </div>
        <div className="flex items-center gap-4 py-2">
          <div className="skeleton h-3 w-20 rounded" />
          <div className="skeleton h-3 w-20 rounded" />
          <div className="skeleton h-3 w-20 rounded" />
          <div className="skeleton h-3 w-20 rounded" />
        </div>
        <div className="h-[220px] w-full flex items-end gap-3 px-2 pt-4">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (   // (25 Nov 2026) axis labels only: no fake bars while loading
            <div key={i} className="flex-1 flex flex-col gap-1 items-center h-full justify-end">
              <div className="skeleton h-2.5 w-6 rounded mt-1" />
            </div>
          ))}
        </div>
      </div>
      <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200/90 p-4 min-h-[390px] flex flex-col justify-between">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="skeleton h-4 w-36 rounded-md" />
          <div className="skeleton h-3.5 w-16 rounded" />
        </div>
        <div className="space-y-3 py-3">
          {[88, 74, 65, 55, 48, 40, 32].map((w, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="skeleton h-3 w-20 rounded shrink-0" />
              <div className="skeleton h-4 rounded-md flex-1" style={{ width: `${w}%` }} />
              <div className="skeleton h-3 w-10 rounded shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  </section>
);

const KPI_SKEL_WIDTHS = ['76%', '84%', '78%', '66%', '80%', '72%', '82%', '68%'] as const;

const KpiTableSkeleton: React.FC<{ rows?: number }> = ({ rows = 8 }) => (
  <div className="divide-y divide-slate-100 loading-in" role="status" aria-label="Loading performance rows">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="px-4 py-3 flex items-center gap-4 min-h-[50px]">
        <div className="skeleton h-3 w-5 rounded shrink-0" />
        <div className="space-y-1.5 min-w-[160px] flex-1 max-w-[260px]">
          <div className="skeleton h-3.5 rounded" style={{ width: KPI_SKEL_WIDTHS[i % KPI_SKEL_WIDTHS.length] }} />
          <div className="skeleton h-2.5 w-24 rounded" />
        </div>
        <div className="skeleton h-3 w-10 rounded shrink-0 hidden md:block" />
        <div className="skeleton h-3 w-12 rounded shrink-0 hidden md:block" />
        <div className="skeleton h-3 w-12 rounded shrink-0 hidden md:block" />
        <div className="skeleton h-3 w-14 rounded shrink-0 hidden lg:block" />
        <div className="skeleton h-3.5 w-16 rounded shrink-0 ml-auto" />
        <div className="skeleton h-5 w-20 rounded-full shrink-0" />
      </div>
    ))}
  </div>
);

const BigKpiCard: React.FC<{
  label: string;
  value?: string;
  valueNode?: React.ReactNode;
  sub?: string;
  icon: React.ElementType;
  accentColor?: 'blue' | 'emerald' | 'amber' | 'violet';
  badge?: string;
  onClick?: () => void;
  active?: boolean;
  staggerIndex?: number;
}> = React.memo(({ label, value, valueNode, sub, icon: Icon, accentColor = 'blue', badge, onClick, active, staggerIndex = 0 }) => {
  const theme = {
    blue: {
      iconBg: 'bg-sky-50 text-sky-600 border-sky-100',
    },
    emerald: {
      iconBg: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    },
    violet: {
      iconBg: 'bg-violet-50 text-violet-600 border-violet-100',
    },
    amber: {
      iconBg: 'bg-amber-50 text-amber-600 border-amber-100',
    },
  }[accentColor];

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{ '--silk-i': staggerIndex } as React.CSSProperties}
      className={`relative flex flex-col justify-between p-4 2xl:p-5 rounded-2xl border bg-white shadow-2xs transition-all duration-200 text-left cursor-pointer min-h-[142px] hover:border-slate-300 hover:shadow-md hover:-translate-y-0.5 group silk-lift ${
        active ? 'border-[#1e5b88] ring-2 ring-sky-100' : 'border-slate-200/90'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide truncate">
          {label}
        </span>
        <div className={`w-8.5 h-8.5 2xl:w-9.5 2xl:h-9.5 rounded-xl flex items-center justify-center border shrink-0 transition-transform group-hover:scale-105 ${theme.iconBg}`}>
          <Icon className="w-4.5 h-4.5 2xl:w-5 2xl:h-5" />
        </div>
      </div>

      <div className="my-2">
        <div className="font-figure text-[26px] 2xl:text-[28px] font-semibold tracking-tight tabular-nums leading-tight text-slate-700 truncate">
          {valueNode ?? (value === undefined ? '—' : value)}
        </div>
      </div>

      <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2 text-xs text-slate-600">
        <span className="truncate font-medium text-slate-700" title={sub}>
          {sub || '—'}
        </span>
        {badge ? (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 shrink-0 border border-slate-200/60">
            {badge}
          </span>
        ) : null}
      </div>
    </button>
  );
});
BigKpiCard.displayName = 'BigKpiCard';

const RankBadge: React.FC<{ rank: number }> = ({ rank }) => {
  if (rank === 1) return <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-semibold text-xs tabular-nums shrink-0">1</span>;
  if (rank === 2) return <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 text-slate-700 border border-slate-200 font-semibold text-xs tabular-nums shrink-0">2</span>;
  if (rank === 3) return <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-orange-50 text-orange-700 border border-orange-200 font-semibold text-xs tabular-nums shrink-0">3</span>;
  return <span className="inline-flex items-center justify-center w-6 h-6 text-xs font-medium text-slate-500 tabular-nums shrink-0">{rank}</span>;
};

const MiniMixBar: React.FC<{ pos: number; sb: number; khqr: number; cc: number; mv?: number; total: number }> = ({ pos, sb, khqr, cc, mv = 0, total }) => {
  if (total <= 0) return null;
  const pPos = (pos / total) * 100;
  const pSb = (sb / total) * 100;
  const pKhqr = (khqr / total) * 100;
  const pCc = (cc / total) * 100;
  const pMv = (mv / total) * 100;
  return (
    <div
      className="w-20 h-2 rounded-full bg-slate-100 overflow-hidden flex gap-[1px]"
      title={`POS: ${fmtPts(pos)} pts · Sound Box: ${fmtPts(sb)} pts · KHQR: ${fmtPts(khqr)} pts · Credit Card: ${fmtPts(cc)} pts${mv > 0 ? ` · MV: ${fmtPts(mv)} pts` : ''}`}
    >
      {pPos > 0 && <div className="bg-[#184e77] h-full" style={{ width: `${pPos}%` }} />}
      {pSb > 0 && <div className="bg-[#4F518C] h-full" style={{ width: `${pSb}%` }} />}
      {pKhqr > 0 && <div className="bg-[#1e6091] h-full" style={{ width: `${pKhqr}%` }} />}
      {pCc > 0 && <div className="bg-[#f59e0b] h-full" style={{ width: `${pCc}%` }} />}
      {pMv > 0 && <div className="bg-[#2d6a4f] h-full" style={{ width: `${pMv}%` }} />}
    </div>
  );
};

const SortIcon: React.FC<{ active: boolean; dir: 'asc' | 'desc' }> = ({ active, dir }) => {
  if (!active) {
    return <ArrowUpDown className="w-2.5 h-2.5 opacity-0 group-hover:opacity-60 transition-opacity shrink-0" aria-hidden />;
  }
  return dir === 'asc' ? (
    <ArrowUp className="w-3 h-3 text-sky-300 shrink-0" aria-hidden />
  ) : (
    <ArrowDown className="w-3 h-3 text-sky-300 shrink-0" aria-hidden />
  );
};

const SortableHeader: React.FC<{
  label: string;
  sortKey: string;
  activeKey: string;
  dir: 'asc' | 'desc';
  onSort: (key: string) => void;
  align?: 'left' | 'right' | 'center';
  className?: string;
  title?: string;
  icon?: React.ReactNode;
}> = ({ label, sortKey, activeKey, dir, onSort, align = 'left', className = '', title, icon }) => {
  const active = activeKey === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      title={title || `Sort by ${label} (${active ? (dir === 'asc' ? 'ascending' : 'descending') : 'click to sort'})`}
      className={`inline-flex items-center gap-1 min-w-0 max-w-full overflow-hidden cursor-pointer select-none transition-colors group uppercase tracking-wide ${
        align === 'right' ? 'justify-end text-right w-full' : align === 'center' ? 'justify-center text-center w-full' : 'justify-start text-left w-full'
      } ${active ? 'text-white font-semibold' : 'text-white/85 hover:text-white font-semibold'} ${className}`}
    >
      {icon}
      <span className="truncate">{label}</span>
      {active ? (
        dir === 'asc' ? (
          <ArrowUp className="w-3 h-3 text-sky-300 shrink-0" aria-hidden />
        ) : (
          <ArrowDown className="w-3 h-3 text-sky-300 shrink-0" aria-hidden />
        )
      ) : (
        <ArrowUpDown className="w-2.5 h-2.5 hidden group-hover:inline-block opacity-75 transition-opacity shrink-0" aria-hidden />
      )}
    </button>
  );
};

const TargetBar: React.FC<{
  pct: number;
  points?: number;
  target?: number;
  pacingPct?: number;
  pacingTarget?: number;
  isManagement?: boolean;
  title?: string;
}> = React.memo(({ pct, points, target, pacingPct, pacingTarget, isManagement, title }) => {
  if (isManagement) {
    const mgtTooltip =
      title ||
      `Management level staff are exempt from individual field KPIs (Completed: ${points !== undefined ? fmtPts(points) : '0'} pts)`;
    return (
      <div className="flex items-center gap-1.5 min-w-0" title={mgtTooltip}>
        <span className="text-[11px] font-medium text-indigo-700 bg-indigo-50/90 px-1.5 py-0.5 rounded border border-indigo-200/80 whitespace-nowrap inline-flex items-center gap-1">
          <ShieldCheck className="w-2.5 h-2.5 text-indigo-600 shrink-0" aria-hidden />
          <span>Exempt</span>
        </span>
        {pct > 0 && <span className="text-[10px] text-slate-500 font-figure tabular-nums whitespace-nowrap">({pct}%)</span>}
      </div>
    );
  }
  const tooltip =
    title ||
    (points !== undefined && target !== undefined
      ? `${pct}% of target (${fmtPts(points)} / ${fmtPts(target)} pts)${pacingPct !== undefined && pacingTarget !== undefined ? ` · Pacing: ${pacingPct}% (${fmtPts(points)} / ${fmtPts(pacingTarget)} pts)` : ''}`
      : `${pct}% of target`);
  return (
    <div className="flex items-center gap-2 min-w-0" title={tooltip}>
      <div className="flex-1 min-w-[40px] h-1.5 rounded-full bg-slate-200/75 overflow-hidden">
        <div className="h-full rounded-full bg-[#1e5b88]" style={{ width: `${Math.min(100, Math.max(4, pct))}%` }} />
      </div>
      <span className="text-[11px] font-figure font-medium tabular-nums text-slate-700 min-w-[42px] shrink-0 text-right whitespace-nowrap">{pct}%</span>
    </div>
  );
});
TargetBar.displayName = 'TargetBar';

const RatingBadge: React.FC<{ rating: KpiRating; pacingPct?: number; title?: string }> = React.memo(({ rating, pacingPct, title }) => {
  const hoverTitle = title || (pacingPct !== undefined ? `Pacing: ${pacingPct}% against elapsed days` : undefined);
  if (rating === 'Management (Exempt)') {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap bg-indigo-50 text-indigo-700 border border-indigo-200/90"
        title={title || "Management level (Branch Manager, Supervisor, Team Lead, Head, Admin) — exempt from frontline field KPIs"}
      >
        <ShieldCheck className="w-3 h-3 text-indigo-600 shrink-0" aria-hidden />
        <span>Management (Exempt)</span>
      </span>
    );
  }
  if (rating === 'Outstanding') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap bg-emerald-50 text-emerald-700 border border-emerald-200/90" title={hoverTitle}>
        <Sun className="w-3 h-3 text-emerald-600 shrink-0" aria-hidden />
        <span>Outstanding</span>
      </span>
    );
  }
  if (rating === 'Meet Target') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap bg-teal-50 text-teal-700 border border-teal-200/90" title={hoverTitle}>
        <CheckSquare className="w-3 h-3 text-teal-600 shrink-0" aria-hidden />
        <span>Meet Target</span>
      </span>
    );
  }
  if (rating === 'Near/Below Target') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap bg-amber-50 text-amber-700 border border-amber-200/90" title={hoverTitle}>
        <Diamond className="w-3 h-3 text-amber-600 shrink-0" aria-hidden />
        <span>Near/Below Target</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap bg-rose-50 text-rose-700 border border-rose-200/90" title={hoverTitle}>
      <X className="w-3 h-3 text-rose-600 shrink-0" aria-hidden />
      <span>Needs Improvement</span>
    </span>
  );
});
RatingBadge.displayName = 'RatingBadge';

const SubCategoryMiniGrid: React.FC<{ raw: KpiRawCounts; ruleMap: Map<string, KpiPointRule>; mode?: KpiMetricMode }> = ({ raw, ruleMap, mode = 'points' }) => {
  const isTasks = mode === 'tasks';
  const posOpMaint = Number(raw.extra?.['POS_MAINT']) || Number(raw.posMaint) || 0;
  const sbMaintenanceCount = Number(raw.extra?.['SB_MAINTENANCE']) || 0;
  const cells = [
    { label: 'POS Install', n: raw.posInstall, pts: raw.posInstall * rulePts(ruleMap, 'POS_INSTALL') },
    { label: 'POS Replace', n: raw.posReplace, pts: raw.posReplace * rulePts(ruleMap, 'POS_REPLACE') },
    { label: 'POS Battery', n: raw.posBattery, pts: raw.posBattery * rulePts(ruleMap, 'POS_BATTERY') },
    { label: 'POS Op. Support', n: posOpMaint, pts: posOpMaint * rulePts(ruleMap, 'POS_MAINT') },
    { label: 'SB Install', n: raw.sbInstall, pts: raw.sbInstall * rulePts(ruleMap, 'SB_INSTALL') },
    { label: 'SB Replace', n: raw.sbReplace, pts: raw.sbReplace * rulePts(ruleMap, 'SB_REPLACE') },
    { label: 'SB Maintenance', n: sbMaintenanceCount, pts: sbMaintenanceCount * rulePts(ruleMap, 'SB_MAINTENANCE') },
    { label: 'SB Op. Support', n: raw.sbMaint, pts: raw.sbMaint * rulePts(ruleMap, 'SB_MAINT') },
    { label: 'SB Return', n: raw.sbReturn, pts: raw.sbReturn * rulePts(ruleMap, 'SB_RETURN') },
    { label: 'KHQR Install', n: raw.khqrInstall, pts: raw.khqrInstall * rulePts(ruleMap, 'KHQR_INSTALL') },
    { label: 'KHQR Replace', n: raw.khqrReplace, pts: raw.khqrReplace * rulePts(ruleMap, 'KHQR_REPLACE') },
    { label: 'QR Materials', n: raw.khqrMaterials, pts: raw.khqrMaterials * rulePts(ruleMap, 'KHQR_MATERIAL') },
    { label: 'KHQR Print & Laminate', n: raw.khqrInstall + raw.khqrReplace, pts: (raw.khqrInstall + raw.khqrReplace) * rulePts(ruleMap, 'KHQR_PRINT_LAMINATE') },
    { label: 'CC Primary', n: raw.ccPrimary, pts: raw.ccPrimary * rulePts(ruleMap, 'CC_PRIMARY') },
    { label: 'CC Supp.', n: raw.ccSupp, pts: raw.ccSupp * rulePts(ruleMap, 'CC_SUPP') },
  ];
  for (const [code, n] of Object.entries(raw.extra || {})) {
    if (!n || code === 'POS_MAINT' || code === 'SB_MAINTENANCE') continue;
    const rule = ruleMap.get(code);
    const label = rule?.subCategory || code.replace(/^MV_|^POS_|^SB_/, '').replace(/_/g, ' ');
    const pts = n * (rulePts(ruleMap, code) || (rule?.points ?? 1));
    cells.push({ label, n, pts });
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
      {cells.map((c) => (
        <div key={c.label} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">{c.label}</div>
          <div className="text-xs font-semibold text-slate-900 tabular-nums mt-0.5">
            {isTasks ? (
              <>{fmtInt(c.n)} <span className="text-[10.5px] font-normal text-slate-500">tasks</span></>
            ) : (
              <>{fmtPts(c.pts)} <span className="text-[10.5px] font-normal text-slate-500">pts</span></>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

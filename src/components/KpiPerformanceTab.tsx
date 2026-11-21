import React, { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Trophy, BarChart3, Building2, Users, Calendar, Layers, Award, Search, RefreshCw, Loader2,
  ChevronDown, ChevronLeft, ChevronRight, Cpu, Volume2, QrCode, CreditCard, TrendingUp, TrendingDown, Target,
  Sun, CheckSquare, Diamond, X, ArrowUpDown, ArrowUp, ArrowDown, ShieldCheck,
  ClipboardList, LayoutGrid, List, MapPin,
} from 'lucide-react';
import {
  Area, XAxis, YAxis, Tooltip, CartesianGrid, ComposedChart,
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
import { getCambodiaHoliday, getMonthWorkDaysSummary } from '../utils/cambodiaHolidays';
import { todayPP } from '../utils/time';
import { SPRING_TAB_PILL, SHARED_LAYOUT_IDS, ACCORDION_EXPAND_VARIANTS } from '../utils/animationRules';
import { PillMotion } from './PillMotion';
import { AfterPaint } from './AfterPaint';
import { MeasuredChart } from './MeasuredChart';
import { buildAnnularArcPath } from './Charts';

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
  'grid items-center gap-x-2 grid-cols-[28px_minmax(175px,1.3fr)_minmax(44px,0.4fr)_minmax(46px,0.42fr)_minmax(42px,0.38fr)_minmax(52px,0.48fr)_minmax(42px,0.38fr)_minmax(42px,0.38fr)_minmax(46px,0.42fr)_minmax(50px,0.45fr)_minmax(84px,0.72fr)_minmax(112px,0.92fr)_minmax(152px,0.92fr)_16px]';

const KPI_STAFF_GRID =
  'grid items-center gap-x-2 grid-cols-[28px_minmax(180px,1.28fr)_minmax(168px,1.15fr)_minmax(46px,0.42fr)_minmax(42px,0.38fr)_minmax(52px,0.48fr)_minmax(42px,0.38fr)_minmax(42px,0.38fr)_minmax(48px,0.44fr)_minmax(84px,0.72fr)_minmax(110px,0.92fr)_minmax(150px,0.92fr)_16px]';

const CAT_COLORS: Record<KpiCategory, { hex: string; badge: string; bar: string; dot: string; Icon: React.ElementType }> = {
  'POS Terminal': { hex: '#184e77', badge: 'bg-[#184e77]/10 text-[#184e77] border-[#184e77]/20 font-semibold', bar: 'bg-[#184e77]', dot: 'bg-[#184e77]', Icon: Cpu },
  'Sound Box': { hex: '#4F518C', badge: 'bg-[#4F518C]/10 text-[#4F518C] border-[#4F518C]/20', bar: 'bg-[#4F518C]', dot: 'bg-[#4F518C]', Icon: Volume2 },
  KHQR: { hex: '#1e6091', badge: 'bg-[#1e6091]/10 text-[#1e6091] border-[#1e6091]/20', bar: 'bg-[#1e6091]', dot: 'bg-[#1e6091]', Icon: QrCode },
  'Credit Card': { hex: '#f59e0b', badge: 'bg-amber-50 text-amber-700 border-amber-200/90', bar: 'bg-[#f59e0b]', dot: 'bg-[#f59e0b]', Icon: CreditCard },
  'Merchant Visit': { hex: '#2d6a4f', badge: 'bg-[#2d6a4f]/10 text-[#2d6a4f] border-[#2d6a4f]/20 font-semibold', bar: 'bg-[#2d6a4f]', dot: 'bg-[#2d6a4f]', Icon: ClipboardList },
  Other: { hex: '#64748b', badge: 'bg-slate-50 text-slate-600 border-slate-200', bar: 'bg-slate-500', dot: 'bg-slate-500', Icon: Layers },
};

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

const KT_VB_W = 440;
const KT_VB_H = 356;
const KT_CX = KT_VB_W / 2;
const KT_CY = KT_VB_H / 2 + 2;
const KT_R_OUTER = 118;
const KT_R_INNER = 94;
const KT_R_HUB = KT_R_INNER - 5;
const KT_R_TRACK = (KT_R_INNER + KT_R_OUTER) / 2;
const KT_TRACK_W = KT_R_OUTER - KT_R_INNER;

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
  const ktShadowId = useId();
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
  const paceDeltaPts = Math.round((safeActual - expectedPacePts) * 10) / 10;
  const paceAttainmentPct = expectedPacePts > 0
    ? Math.min(999, Math.round((safeActual / expectedPacePts) * 1000) / 10)
    : 0;
  const isAheadOfPace = safeTarget > 0 && safeActual >= expectedPacePts;

  const statusBadge = isMet
    ? { label: 'Target Met', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200/80', dot: '#2d6a4f' }
    : isAheadOfPace
      ? { label: 'Ahead of Pace', cls: 'bg-sky-50 text-[#1e6091] border-sky-200/80', dot: '#1e6091' }
      : { label: 'Behind Pace', cls: 'bg-amber-50 text-amber-700 border-amber-200/80', dot: '#f59e0b' };

  const actualColor = isMet ? '#2d6a4f' : '#1e6091';
  const denom = Math.max(safeTarget, safeActual);
  const actualFrac = safeTarget > 0 ? Math.min(1, safeActual / Math.max(safeTarget, safeActual)) : 0;
  const gapFrac = safeTarget > 0 && gapPts > 0 ? gapPts / denom : 0;

  const startAngle = -Math.PI / 2;
  const fullCircle = Math.PI * 2;
  const hasGapSlice = !isMet && gapFrac > 0.002 && actualFrac > 0.002;
  const gapTrim = hasGapSlice ? Math.min(0.026, actualFrac * fullCircle * 0.2, gapFrac * fullCircle * 0.2) : 0;

  const actualEndAngle = startAngle + actualFrac * fullCircle;
  const remainingStartAngle = actualEndAngle;
  const remainingEndAngle = startAngle + fullCircle;

  const pacingTickAngle = startAngle + effectivePaceRatio * fullCircle;
  const hasPacingTick = showPacing && safeTarget > 0 && effectivePaceRatio > 0 && effectivePaceRatio < 1;

  const centerReadout = (() => {
    if (hoveredKey === 'actual') {
      return {
        dot: actualColor,
        top: 'Actual',
        pct: `${achievementPct}%`,
        ratio: `${fmtPts(safeActual)} / ${fmtPts(safeTarget)} pts`,
        pill: { text: `${fmtPts(safeActual)} pts`, color: actualColor, bg: `${actualColor}18` },
      };
    }
    if (hoveredKey === 'remaining') {
      return {
        dot: '#94a3b8',
        top: 'Remaining',
        pct: `${gapPct}%`,
        ratio: `${fmtPts(gapPts)} of ${fmtPts(safeTarget)} pts`,
        pill: { text: `${fmtPts(gapPts)} left`, color: '#475569', bg: 'rgba(148, 163, 184, 0.16)' },
      };
    }
    if (hoveredKey === 'pace') {
      const paceCol = isAheadOfPace ? '#1e6091' : '#d97706';
      return {
        dot: '#0f172a',
        top: 'Pace Rate',
        pct: `${paceAttainmentPct}%`,
        ratio: `${fmtPts(safeActual)} vs ${fmtPts(expectedPacePts)} pts`,
        pill: {
          text: `${paceDeltaPts >= 0 ? '+' : '-'}${fmtPts(Math.abs(paceDeltaPts))} pts`,
          color: paceCol,
          bg: isAheadOfPace ? 'rgba(30, 96, 145, 0.12)' : 'rgba(245, 158, 11, 0.14)',
        },
      };
    }
    if (hoveredKey === 'target') {
      return {
        dot: '#475569',
        top: targetLabel === 'Monthly target' ? 'Monthly Target' : targetLabel,
        pct: '100%',
        ratio: `${fmtPts(safeTarget)} pts goal`,
        pill: { text: `${fmtPts(safeTarget)} pts`, color: '#334155', bg: 'rgba(15, 23, 42, 0.08)' },
      };
    }
    return {
      dot: statusBadge.dot,
      top: 'Achievement',
      pct: `${achievementPct}%`,
      ratio: `${fmtPts(safeActual)} / ${fmtPts(safeTarget)} pts`,
      pill: isMet
        ? { text: `+${fmtPts(surplusPts)} surplus`, color: '#2d6a4f', bg: 'rgba(45, 106, 79, 0.12)' }
        : { text: `${fmtPts(gapPts)} left`, color: '#1e6091', bg: 'rgba(30, 96, 145, 0.12)' },
    };
  })();

  const targetTitle = targetLabel === 'Monthly target' ? 'Monthly Target' : targetLabel;
  const paceLabel = showPacing ? `Expected Pace · Day ${elapsedWorkDays}/${totalWorkDays}` : 'Expected Pace';

  // Dashboard Style 1 curved Bezier leader coordinates framing the slim donut cleanly
  const targetAnchorAngle = -Math.PI * 0.7;
  const targetStart = {
    x: KT_CX + (KT_R_OUTER + 5) * Math.cos(targetAnchorAngle),
    y: KT_CY + (KT_R_OUTER + 5) * Math.sin(targetAnchorAngle),
  };
  const targetEnd = { x: 142, y: 38 };
  const targetControl = { x: Math.max(targetEnd.x + 12, targetStart.x), y: targetEnd.y };

  const actualRawMid = startAngle + actualFrac * fullCircle * 0.5;
  const actualAnchorAngle =
    isMet || actualFrac >= 0.56
      ? -Math.PI * 0.28
      : actualFrac > 0.01
        ? Math.max(startAngle + 0.18, Math.min(-Math.PI * 0.28, actualRawMid))
        : startAngle + 0.18;
  const actualStart = {
    x: KT_CX + (KT_R_OUTER + 5) * Math.cos(actualAnchorAngle),
    y: KT_CY + (KT_R_OUTER + 5) * Math.sin(actualAnchorAngle),
  };
  const actualEnd = { x: KT_VB_W - 142, y: 38 };
  const actualControl = { x: Math.min(actualEnd.x - 12, actualStart.x), y: actualEnd.y };

  const paceAnchorAngle = hasPacingTick ? pacingTickAngle : Math.PI * 0.72;
  const paceSide: 'left' | 'right' = Math.cos(paceAnchorAngle) > 0.12 ? 'right' : 'left';
  const paceStartR = hasPacingTick ? KT_R_OUTER + 6 : KT_R_OUTER + 5;
  const paceStart = {
    x: KT_CX + paceStartR * Math.cos(paceAnchorAngle),
    y: KT_CY + paceStartR * Math.sin(paceAnchorAngle),
  };
  const paceEnd = {
    x:
      paceSide === 'left'
        ? Math.min(138, Math.max(106, paceStart.x - 14))
        : Math.max(KT_VB_W - 138, Math.min(KT_VB_W - 106, paceStart.x + 14)),
    y: KT_VB_H - 38,
  };
  const paceControl =
    Math.sin(paceAnchorAngle) < 0
      ? {
          x: paceSide === 'right' ? Math.max(KT_CX + KT_R_OUTER + 46, paceStart.x + 28) : Math.min(KT_CX - KT_R_OUTER - 46, paceStart.x - 28),
          y: (paceStart.y + paceEnd.y) * 0.5,
        }
      : {
          x: paceSide === 'left' ? Math.max(paceEnd.x + 10, (paceStart.x + paceEnd.x) * 0.5) : Math.min(paceEnd.x - 10, (paceStart.x + paceEnd.x) * 0.5),
          y: paceEnd.y,
        };

  return (
    <div
      data-testid="kpi-target-donut-card"
      className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden flex flex-col justify-between"
    >
      <div className="px-4 sm:px-5 pt-4 pb-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-slate-900 truncate">
            {targetTitle} vs Actual Achievement{' '}
            <span className="text-slate-400 font-normal">· {periodLabel}</span>
          </h3>
          <p className="text-[11px] text-slate-500 truncate">
            Target attainment, achievement percentage &amp; expected pace
          </p>
        </div>
      </div>

      <div className="px-2 sm:px-3 py-1.5 flex-1 flex items-center justify-center">
        {/* Dashboard Style 1: Slim Sculpted Donut + Curved Bezier Leaders + Floating Pill Callouts */}
        <div className="relative w-full max-w-[460px] aspect-[440/356] flex items-center justify-center">
          <svg
            viewBox={`0 0 ${KT_VB_W} ${KT_VB_H}`}
            className="w-full h-full overflow-visible"
            role="img"
            aria-label={`${targetTitle} vs Actual Achievement Donut Chart: ${achievementPct}% achieved (${fmtPts(safeActual)} of ${fmtPts(safeTarget)} points), Expected pace ${expectedPacePct}%`}
            data-testid="kpi-target-donut-svg"
          >
            <defs>
              <filter id={ktShadowId} x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#1e6091" floodOpacity="0.16" />
              </filter>
            </defs>

            {/* Recessed Donut Track (100% Target Ring) */}
            <circle
              cx={KT_CX}
              cy={KT_CY}
              r={KT_R_TRACK}
              fill="none"
              stroke="rgba(15, 23, 42, 0.045)"
              strokeWidth={KT_TRACK_W}
            />

            {/* Sculpted Annular Arcs with Soft Drop Shadow */}
            <g filter={`url(#${ktShadowId})`}>
              {/* Full Ring when Target Met (>= 100%) */}
              {safeTarget > 0 && isMet && (
                <circle
                  data-kpi-target-slice="actual"
                  cx={KT_CX}
                  cy={KT_CY}
                  r={KT_R_TRACK}
                  fill="none"
                  stroke={actualColor}
                  strokeWidth={hoveredKey === 'actual' ? KT_TRACK_W + 5 : KT_TRACK_W}
                  className="cursor-pointer transition-all duration-150"
                  onMouseEnter={() => setHoveredKey('actual')}
                  onMouseLeave={() => setHoveredKey(null)}
                >
                  <title>{`Actual Achievement: ${fmtPts(safeActual)} pts (${achievementPct}% of ${fmtPts(safeTarget)} target)`}</title>
                </circle>
              )}

              {/* Split Actual Achievement vs Remaining Target Arcs */}
              {safeTarget > 0 && !isMet && (
                <>
                  {gapFrac > 0.002 && (
                    <path
                      data-kpi-target-slice="remaining"
                      d={buildAnnularArcPath(
                        KT_CX,
                        KT_CY,
                        hoveredKey === 'remaining' || hoveredKey === 'target' ? KT_R_INNER - 2 : KT_R_INNER,
                        hoveredKey === 'remaining' || hoveredKey === 'target' ? KT_R_OUTER + 4 : KT_R_OUTER,
                        remainingStartAngle + gapTrim / 2,
                        remainingEndAngle - gapTrim / 2
                      )}
                      fill="#e2e8f0"
                      opacity={hoveredKey !== null && hoveredKey !== 'remaining' && hoveredKey !== 'target' ? 0.42 : 1}
                      style={{ transition: 'opacity 150ms ease' }}
                      className="cursor-pointer"
                      onMouseEnter={() => setHoveredKey('remaining')}
                      onMouseLeave={() => setHoveredKey(null)}
                    >
                      <title>{`Remaining to Target: ${fmtPts(gapPts)} pts (${gapPct}%)`}</title>
                    </path>
                  )}

                  {actualFrac > 0.002 && (
                    <path
                      data-kpi-target-slice="actual"
                      d={buildAnnularArcPath(
                        KT_CX,
                        KT_CY,
                        hoveredKey === 'actual' ? KT_R_INNER - 3 : KT_R_INNER,
                        hoveredKey === 'actual' ? KT_R_OUTER + 4 : KT_R_OUTER,
                        startAngle + gapTrim / 2,
                        actualEndAngle - gapTrim / 2
                      )}
                      fill={actualColor}
                      opacity={hoveredKey !== null && hoveredKey !== 'actual' ? 0.35 : 1}
                      style={{
                        filter: hoveredKey === 'actual' ? `drop-shadow(0 4px 10px ${actualColor}55)` : undefined,
                        transition: 'opacity 150ms ease, filter 150ms ease',
                      }}
                      className="cursor-pointer"
                      onMouseEnter={() => setHoveredKey('actual')}
                      onMouseLeave={() => setHoveredKey(null)}
                    >
                      <title>{`Actual Achievement: ${fmtPts(safeActual)} pts (${achievementPct}% of ${fmtPts(safeTarget)} target)`}</title>
                    </path>
                  )}
                </>
              )}
            </g>

            {/* Expected Pace Benchmark Needle Marker on Ring */}
            {hasPacingTick && (
              <g
                className="cursor-pointer"
                onMouseEnter={() => setHoveredKey('pace')}
                onMouseLeave={() => setHoveredKey(null)}
              >
                <line
                  x1={KT_CX + (KT_R_INNER - 3) * Math.cos(pacingTickAngle)}
                  y1={KT_CY + (KT_R_INNER - 3) * Math.sin(pacingTickAngle)}
                  x2={KT_CX + (KT_R_OUTER + 5) * Math.cos(pacingTickAngle)}
                  y2={KT_CY + (KT_R_OUTER + 5) * Math.sin(pacingTickAngle)}
                  stroke="#0f172a"
                  strokeWidth={hoveredKey === 'pace' ? 3 : 2.25}
                  strokeLinecap="round"
                />
                <title>{`${paceLabel}: ${expectedPacePct}% (${fmtPts(expectedPacePts)} pts)`}</title>
              </g>
            )}

            {/* Smooth Curved Bezier Leader Lines Anchored at Rim (Matching Dashboard Style 1) */}
            <g opacity={hoveredKey !== null && hoveredKey !== 'target' ? 0.24 : hoveredKey === 'target' ? 1 : 0.72} style={{ transition: 'opacity 150ms ease' }}>
              <path
                d={`M ${targetStart.x.toFixed(1)} ${targetStart.y.toFixed(1)} Q ${targetControl.x.toFixed(1)} ${targetControl.y.toFixed(1)} ${targetEnd.x.toFixed(1)} ${targetEnd.y.toFixed(1)}`}
                fill="none"
                stroke="#64748b"
                strokeWidth={hoveredKey === 'target' ? 1.85 : 1.35}
                strokeLinecap="round"
              />
              <circle cx={targetStart.x} cy={targetStart.y} r={hoveredKey === 'target' ? 3.2 : 2.5} fill="#64748b" />
            </g>

            <g opacity={hoveredKey !== null && hoveredKey !== 'actual' ? 0.24 : hoveredKey === 'actual' ? 1 : 0.78} style={{ transition: 'opacity 150ms ease' }}>
              <path
                d={`M ${actualStart.x.toFixed(1)} ${actualStart.y.toFixed(1)} Q ${actualControl.x.toFixed(1)} ${actualControl.y.toFixed(1)} ${actualEnd.x.toFixed(1)} ${actualEnd.y.toFixed(1)}`}
                fill="none"
                stroke={actualColor}
                strokeWidth={hoveredKey === 'actual' ? 1.85 : 1.35}
                strokeLinecap="round"
              />
              <circle cx={actualStart.x} cy={actualStart.y} r={hoveredKey === 'actual' ? 3.2 : 2.5} fill={actualColor} />
            </g>

            <g opacity={hoveredKey !== null && hoveredKey !== 'pace' ? 0.24 : hoveredKey === 'pace' ? 1 : 0.72} style={{ transition: 'opacity 150ms ease' }}>
              <path
                d={`M ${paceStart.x.toFixed(1)} ${paceStart.y.toFixed(1)} Q ${paceControl.x.toFixed(1)} ${paceControl.y.toFixed(1)} ${paceEnd.x.toFixed(1)} ${paceEnd.y.toFixed(1)}`}
                fill="none"
                stroke="#0f172a"
                strokeDasharray={hasPacingTick ? undefined : '2.5 2.5'}
                strokeWidth={hoveredKey === 'pace' ? 1.85 : 1.35}
                strokeLinecap="round"
              />
              <circle cx={paceStart.x} cy={paceStart.y} r={hoveredKey === 'pace' ? 3.2 : 2.5} fill="#0f172a" />
            </g>

            {/* Elevated Center Hub (must remain the last <circle> inside SVG) */}
            <circle
              cx={KT_CX}
              cy={KT_CY}
              r={KT_R_HUB}
              fill="#ffffff"
              stroke="rgba(15, 23, 42, 0.08)"
              strokeWidth="1"
            />
          </svg>

          {/* Center Readout: Achievement % + Actual / Target pts + Left/Surplus */}
          <div
            className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center pointer-events-none text-center px-2"
            style={{
              left: `${(KT_CX / KT_VB_W) * 100}%`,
              top: `${(KT_CY / KT_VB_H) * 100}%`,
              width: `${((KT_R_HUB * 1.72) / KT_VB_W) * 100}%`,
            }}
          >
            <span className="inline-flex items-center gap-1 text-[10px] font-bold tracking-wider uppercase text-slate-500 max-w-full whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full inline-block shrink-0" style={{ backgroundColor: centerReadout.dot }} />
              <span>{centerReadout.top}</span>
            </span>
            <span className="text-[28px] sm:text-[32px] font-bold font-figure leading-none tracking-tight text-slate-900 mt-1 tabular-nums">
              {centerReadout.pct}
            </span>
            <span className="text-[10.5px] font-figure font-semibold text-slate-500 mt-1 tabular-nums whitespace-nowrap max-w-full">
              {centerReadout.ratio}
            </span>
            <span
              className="text-[9.5px] font-figure font-semibold px-2.5 py-0.5 rounded-full mt-1.5 tabular-nums whitespace-nowrap max-w-full"
              style={{ color: centerReadout.pill.color, backgroundColor: centerReadout.pill.bg }}
            >
              {centerReadout.pill.text}
            </span>
          </div>

          {/* 1. Monthly Target Floating Pill Callout (Upper-Left) */}
          <button
            type="button"
            data-kpi-comparison-row="target"
            onMouseEnter={() => setHoveredKey('target')}
            onMouseLeave={() => setHoveredKey(null)}
            onFocus={() => setHoveredKey('target')}
            onBlur={() => setHoveredKey(null)}
            style={{
              right: `${((KT_VB_W - targetEnd.x) / KT_VB_W) * 100}%`,
              top: `${(targetEnd.y / KT_VB_H) * 100}%`,
              transform: 'translateY(-50%)',
              ...(hoveredKey === 'target' ? { borderColor: '#64748b', backgroundColor: '#ffffff' } : undefined),
            }}
            className={`absolute px-2.5 py-1 rounded-xl border transition-all duration-150 cursor-pointer flex flex-col items-end text-right leading-tight ${
              hoveredKey === 'target'
                ? 'shadow-sm'
                : 'bg-slate-50/95 border-slate-200/90 hover:bg-white shadow-[0_1px_3px_rgba(15,23,42,0.03)]'
            } ${hoveredKey !== null && hoveredKey !== 'target' ? 'opacity-40' : ''}`}
          >
            <span className="inline-flex items-center gap-1.5 text-[9.5px] sm:text-[10px] font-bold text-slate-900 whitespace-nowrap">
              <span>{targetTitle}</span>
              <span className="w-1.5 h-1.5 rounded-full bg-slate-500 shrink-0" />
            </span>
            <span className="text-[11px] sm:text-[11.5px] font-figure font-bold text-slate-900 tabular-nums whitespace-nowrap mt-0.5">
              {fmtPts(safeTarget)} pts
            </span>
            <span className="text-[9px] sm:text-[9.5px] font-figure font-semibold text-slate-500 tabular-nums whitespace-nowrap">
              100% · {isMet ? `+${fmtPts(surplusPts)} surplus` : `${fmtPts(gapPts)} left`}
            </span>
          </button>

          {/* 2. Actual Achievement Floating Pill Callout (Upper-Right) */}
          <button
            type="button"
            data-kpi-comparison-row="actual"
            onMouseEnter={() => setHoveredKey('actual')}
            onMouseLeave={() => setHoveredKey(null)}
            onFocus={() => setHoveredKey('actual')}
            onBlur={() => setHoveredKey(null)}
            style={{
              left: `${(actualEnd.x / KT_VB_W) * 100}%`,
              top: `${(actualEnd.y / KT_VB_H) * 100}%`,
              transform: 'translateY(-50%)',
              ...(hoveredKey === 'actual' ? { borderColor: actualColor, backgroundColor: '#ffffff' } : undefined),
            }}
            className={`absolute px-2.5 py-1 rounded-xl border transition-all duration-150 cursor-pointer flex flex-col items-start text-left leading-tight ${
              hoveredKey === 'actual'
                ? 'shadow-sm'
                : 'bg-slate-50/95 border-slate-200/90 hover:bg-white shadow-[0_1px_3px_rgba(15,23,42,0.03)]'
            } ${hoveredKey !== null && hoveredKey !== 'actual' ? 'opacity-40' : ''}`}
          >
            <span className="inline-flex items-center gap-1.5 text-[9.5px] sm:text-[10px] font-bold text-slate-900 whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: actualColor }} />
              <span>Actual Achievement</span>
            </span>
            <span className="text-[11px] sm:text-[11.5px] font-figure font-bold text-slate-900 tabular-nums whitespace-nowrap mt-0.5">
              {fmtPts(safeActual)} pts
            </span>
            <span className="text-[9px] sm:text-[9.5px] font-figure font-bold tabular-nums whitespace-nowrap" style={{ color: actualColor }}>
              {achievementPct}% of target
            </span>
          </button>

          {/* 3. Pace Floating Pill Callout (Lower-Left or Lower-Right following Pace Needle) */}
          <button
            type="button"
            data-kpi-comparison-row="pace"
            onMouseEnter={() => setHoveredKey('pace')}
            onMouseLeave={() => setHoveredKey(null)}
            onFocus={() => setHoveredKey('pace')}
            onBlur={() => setHoveredKey(null)}
            style={{
              ...(paceSide === 'left'
                ? {
                    right: `${((KT_VB_W - paceEnd.x) / KT_VB_W) * 100}%`,
                    top: `${(paceEnd.y / KT_VB_H) * 100}%`,
                    transform: 'translateY(-50%)',
                  }
                : {
                    left: `${(paceEnd.x / KT_VB_W) * 100}%`,
                    top: `${(paceEnd.y / KT_VB_H) * 100}%`,
                    transform: 'translateY(-50%)',
                  }),
              ...(hoveredKey === 'pace' ? { borderColor: '#0f172a', backgroundColor: '#ffffff' } : undefined),
            }}
            className={`absolute px-2.5 py-1 rounded-xl border transition-all duration-150 cursor-pointer flex flex-col leading-tight ${
              paceSide === 'left' ? 'items-end text-right' : 'items-start text-left'
            } ${
              hoveredKey === 'pace'
                ? 'shadow-sm'
                : 'bg-slate-50/95 border-slate-200/90 hover:bg-white shadow-[0_1px_3px_rgba(15,23,42,0.03)]'
            } ${hoveredKey !== null && hoveredKey !== 'pace' ? 'opacity-40' : ''}`}
          >
            <span className="inline-flex items-center gap-1.5 text-[9.5px] sm:text-[10px] font-bold text-slate-900 whitespace-nowrap">
              {paceSide === 'right' && <span className="w-1.5 h-1.5 rounded-full bg-slate-900 shrink-0" />}
              <span>{showPacing ? `Pace (Day ${elapsedWorkDays}/${totalWorkDays})` : 'Expected Pace'}</span>
              {paceSide === 'left' && <span className="w-1.5 h-1.5 rounded-full bg-slate-900 shrink-0" />}
            </span>
            <span className="text-[11px] sm:text-[11.5px] font-figure font-bold text-slate-900 tabular-nums whitespace-nowrap mt-0.5">
              {fmtPts(expectedPacePts)} pts{' '}
              <span className="text-[9.5px] font-semibold text-slate-500">· {expectedPacePct}%</span>
            </span>
            <span
              className={`text-[9px] sm:text-[9.5px] font-figure font-bold tabular-nums whitespace-nowrap ${
                isAheadOfPace ? 'text-emerald-700' : 'text-amber-700'
              }`}
            >
              {paceAttainmentPct}% pace ({paceDeltaPts >= 0 ? `+${fmtPts(paceDeltaPts)}` : `-${fmtPts(Math.abs(paceDeltaPts))}`})
            </span>
          </button>
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
  const [subCatViewMode, setSubCatViewMode] = useState<'cards' | 'table'>('cards');
  const [tableMode, setTableMode] = useState<'branch' | 'staff'>('staff');
  const [branchSubView, setBranchSubView] = useState<'summary' | 'daily'>('summary');
  const [staffSubView, setStaffSubView] = useState<'summary' | 'daily'>('summary');
  
  const [staffLevelFilter, setStaffLevelFilter] = useState<'all' | 'field' | 'management'>('all');
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
    setView(newView);
    setSelectedCard(null);
    if (newView === 'branches') {
      setTableMode('branch');
      setBranchSubView('summary');
    }
    if (newView === 'staff') {
      setTableMode('staff');
      setStaffSubView('summary');
    }
  }, []);

  const handleTableModeChange = useCallback((mode: 'branch' | 'staff' | 'branch_daily' | 'staff_daily') => {
    if (mode === 'branch_daily') {
      setTableMode('branch');
      setBranchSubView('daily');
    } else if (mode === 'staff_daily') {
      setTableMode('staff');
      setStaffSubView('daily');
    } else if (mode === 'branch') {
      setTableMode('branch');
      setBranchSubView('summary');
    } else if (mode === 'staff') {
      setTableMode('staff');
      setStaffSubView('summary');
    }
  }, []);

  const handleCardClick = useCallback((cardKey: string, targetView: KpiView, mode?: 'branch' | 'staff') => {
    setSelectedCard((c) => (c === cardKey ? null : cardKey));
    setView(targetView);
    if (mode === 'branch') {
      setTableMode('branch');
      setBranchSubView('summary');
    } else if (mode === 'staff') {
      setTableMode('staff');
      setStaffSubView('summary');
    }
  }, []);

  // Sorting state for tables
  const [branchSortKey, setBranchSortKey] = useState<string>('totalPoints');
  const [branchSortDir, setBranchSortDir] = useState<'asc' | 'desc'>('desc');
  const [staffSortKey, setStaffSortKey] = useState<string>('totalPoints');
  const [staffSortDir, setStaffSortDir] = useState<'asc' | 'desc'>('desc');
  const [timelineSortKey, setTimelineSortKey] = useState<string>('period');
  const [timelineSortDir, setTimelineSortDir] = useState<'asc' | 'desc'>('desc');

  const handleMetricModeChange = useCallback((next: KpiMetricMode) => {
    setMetricMode(next);
    setBranchSortKey((k) => remapMetricSortKey(k, next, true));
    setStaffSortKey((k) => remapMetricSortKey(k, next, false));
    setTimelineSortKey((k) => remapMetricSortKey(k, next, true));
  }, []);

  const range = useMemo(() => kpiPeriodRange(period), [period]);
  const [data, setData] = useState<KpiDashboardData | null>(() => getCachedKpiSummary(range.from, range.to) || getCachedKpiSummary(null, null) || null);
  const [loading, setLoading] = useState(!data);
  const [loadError, setLoadError] = useState('');

  const seqRef = useRef(0);
  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    const hit = getCachedKpiSummary(range.from, range.to);
    if (hit) setData(hit);
    setLoading(!hit);
    try {
      const res = await fetchKpiSummary(range.from, range.to);
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

  useEffect(() => { load(); }, [load]);

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
      return {
        ...row,
        label: shortLabel,
        fullPeriod: row.period,
        growthPct,
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
      { code: 'POS_STAND', category: 'POS Terminal', label: ruleMap.get('POS_STAND')?.subCategory || 'POS Stand Holder Setup', count: Number(r.extra?.['POS_STAND']) || Number(r.posStand) || 0, unitPts: rulePts(ruleMap, 'POS_STAND'), points: (Number(r.extra?.['POS_STAND']) || Number(r.posStand) || 0) * rulePts(ruleMap, 'POS_STAND'), unit: 'stands' },
      { code: 'POS_DOCK', category: 'POS Terminal', label: ruleMap.get('POS_DOCK')?.subCategory || 'Charging Dock Installation', count: Number(r.extra?.['POS_DOCK']) || Number(r.posDock) || 0, unitPts: rulePts(ruleMap, 'POS_DOCK'), points: (Number(r.extra?.['POS_DOCK']) || Number(r.posDock) || 0) * rulePts(ruleMap, 'POS_DOCK'), unit: 'docks' },
      { code: 'SB_INSTALL', category: 'Sound Box', label: ruleMap.get('SB_INSTALL')?.subCategory || 'Sound Box New Installation', count: r.sbInstall, unitPts: rulePts(ruleMap, 'SB_INSTALL'), points: r.sbInstall * rulePts(ruleMap, 'SB_INSTALL'), unit: 'units' },
      { code: 'SB_REPLACE', category: 'Sound Box', label: ruleMap.get('SB_REPLACE')?.subCategory || 'Sound Box Replacement / Swap', count: r.sbReplace, unitPts: rulePts(ruleMap, 'SB_REPLACE'), points: r.sbReplace * rulePts(ruleMap, 'SB_REPLACE'), unit: 'swaps' },
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
    return items
      .map((it) => ({ ...it, points: Math.round(it.points * 100) / 100 }))
      .sort((a, b) => b.points - a.points || b.count - a.count);
  }, [totals.raw, ruleMap]);

  const activeSubCategoryCount = useMemo(() => {
    const list = categoryFilter === 'ALL'
      ? subCategoryBreakdown
      : subCategoryBreakdown.filter((sc) => sc.category === categoryFilter);
    return list.filter((sc) => sc.points > 0 || sc.count > 0).length;
  }, [subCategoryBreakdown, categoryFilter]);

  const totalInSelectedCategory = useMemo(() => {
    return categoryFilter === 'ALL'
      ? subCategoryBreakdown.length
      : subCategoryBreakdown.filter((sc) => sc.category === categoryFilter).length;
  }, [subCategoryBreakdown, categoryFilter]);

  const displayedSubCategories = useMemo(() => {
    let list = subCategoryBreakdown;
    if (categoryFilter !== 'ALL') {
      list = list.filter((sc) => sc.category === categoryFilter);
    }
    if (subCatActiveOnly) {
      list = list.filter((sc) => sc.points > 0 || sc.count > 0);
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
    return list;
  }, [subCategoryBreakdown, categoryFilter, subCatActiveOnly, subCatSearch]);

  const displayedSubCategoryPoints = useMemo(() => {
    return displayedSubCategories.reduce((acc, sc) => acc + sc.points, 0);
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
    if (Array.isArray(data?.dailyBranch)) {
      for (const item of data.dailyBranch) {
        map.set(`${item.branchId}__${item.day}`, item);
      }
    }
    return map;
  }, [data?.dailyBranch]);

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
    setDailyMatrixMonth(newMonthStr);
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
    if (Array.isArray(data?.dailyStaff)) {
      for (const item of data.dailyStaff) {
        map.set(`${item.staffId}__${item.day}`, item);
      }
    }
    return map;
  }, [data?.dailyStaff]);

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

  const branchPg = usePager(filteredBranches.length, [period, branchFilter, categoryFilter, deferredQuery]);
  const staffPg = usePager(filteredStaff.length, [period, branchFilter, categoryFilter, deferredQuery]);

  const filtersActive = period !== 'ALL' || !!branchFilter || categoryFilter !== 'ALL' || !!query;
  const clearAll = () => {
    setPeriod('ALL');
    setBranchFilter('');
    setCategoryFilter('ALL');
    setQuery('');
  };

  const exportBranchCsv = async () => {
    if (!filteredBranches.length) return 0;
    const pTag = KPI_PERIOD_LABEL[period].replace(/[^A-Za-z0-9]+/g, '_');
    downloadCsv(
      `KPI_Branch_Performance_${pTag}`,
      ['Rank', 'Branch Name', 'Branch Code', 'Active Staff', 'POS Tasks', 'POS Points', 'Sound Box Tasks', 'Sound Box Points',
        'KHQR Tasks', 'QR Materials', 'KHQR Points', 'Credit Card Tasks', 'Credit Card Points', 'Merchant Visit Tasks', 'Merchant Visit Points', 'Total Tasks', 'Pts / Staff', 'Total KPI Points', 'Achievement %', 'Performance'],
      filteredBranches.map((b, i) => [
        i + 1, cleanBranchName(b.branchName), b.branchId, b.staffCount, b.posTasks, b.posPoints, b.sbTasks, b.sbPoints,
        b.khqrTasks, b.khqrMaterials, b.khqrPoints, b.ccTasks, b.ccPoints, b.mvTasks, b.mvPoints, b.totalTasks, b.ptsPerStaff, b.totalPoints, `${b.targetPct}%`, b.rating,
      ])
    );
    return filteredBranches.length;
  };

  const exportStaffCsv = async () => {
    if (!filteredStaff.length) return 0;
    const pTag = KPI_PERIOD_LABEL[period].replace(/[^A-Za-z0-9]+/g, '_');
    downloadCsv(
      `KPI_Individual_Staff_${pTag}`,
      ['Rank', 'Staff Name', 'Staff ID', 'Position', 'Role / Level', 'Branch Name', 'Branch Code', 'POS Install', 'POS Replace', 'POS Battery', 'POS Operational Support', 'POS Points',
        'SB Install', 'SB Replace', 'SB Operational Support', 'SB Return', 'Sound Box Points', 'KHQR Install', 'KHQR Replace', 'QR Materials', 'KHQR Points',
        'CC Primary', 'CC Supplementary', 'Credit Card Points', 'Merchant Visit Tasks', 'Merchant Visit Points', 'Total Tasks', 'Total KPI Points', 'Achievement %', 'Performance'],
      filteredStaff.map((s, i) => [
        i + 1, s.staffName, s.staffId, s.position || (s.isManagement ? 'Management' : 'MS Officer'), s.isManagement ? 'Management (Exempt)' : 'Field Officer', cleanBranchName(s.branchName), s.branchId,
        s.posInstall, s.posReplace, s.posBattery, Number(s.extra?.['POS_MAINT']) || Number(s.posMaint) || 0, s.posPoints,
        s.sbInstall, s.sbReplace, s.sbMaint, s.sbReturn, s.sbPoints, s.khqrInstall, s.khqrReplace, s.khqrMaterials, s.khqrPoints,
        s.ccPrimary, s.ccSupp, s.ccPoints, s.mvTasks, s.mvPoints, s.totalTasks, s.totalPoints, s.isManagement ? 'Exempt' : `${s.targetPct}%`, s.rating,
      ])
    );
    return filteredStaff.length;
  };
  

  const sortedBranches = useMemo(
    () =>
      [...branches]
        .filter((b) => isPhnomPenhBranch(b))
        .sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true })),
    [branches]
  );

  const navTabs: { id: KpiView; label: string; Icon: React.ElementType; accentColor: string; count?: number }[] = [
    { id: 'all', label: 'Overview', Icon: BarChart3, accentColor: 'text-[#003857]' },
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
              <BarChart3 className="w-7 h-7 sm:w-8 sm:h-8 shrink-0 text-[#003857]" aria-hidden />
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
              className="inline-flex items-center p-1 rounded-xl bg-white border border-slate-200/90 shadow-2xs gap-0.5 shrink-0 whitespace-nowrap"
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
                    className={`relative px-3 py-1.5 rounded-lg text-xs cursor-pointer transition-colors duration-150 inline-flex items-center gap-1.5 ${
                      active ? 'text-white font-semibold' : 'text-slate-700 hover:text-slate-900 font-medium'
                    }`}
                  >
                    {active && (
                      <PillMotion
                        layoutId="kpi-metric-mode-pill"
                        transition={SPRING}
                        className="absolute inset-0 rounded-lg tab-active-blue shadow-2xs pointer-events-none"
                      />
                    )}
                    <Icon className={`w-3.5 h-3.5 relative z-10 shrink-0 transition-colors ${active ? 'text-white' : accent}`} aria-hidden />
                    <span className="relative z-10">{label}</span>
                  </button>
                );
              })}
            </div>
            <select
              aria-label="Period"
              value={period}
              onChange={(e) => setPeriod(e.target.value as KpiPeriod)}
              className="btn-press px-3.5 py-2 rounded-xl text-xs sm:text-sm font-normal border bg-white hover:bg-slate-50 text-slate-800 border-slate-200/90 shadow-2xs outline-none focus:border-slate-400 cursor-pointer"
            >
              {(Object.keys(KPI_PERIOD_LABEL) as KpiPeriod[]).map((p) => (
                <option key={p} value={p}>{KPI_PERIOD_LABEL[p]}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={load}
              aria-label="Refresh KPI Performance"
              title="Refresh KPI Performance"
              className="group relative inline-flex items-center gap-2 px-3.5 py-2 rounded-xl active:scale-[0.98] transition-all duration-150 font-semibold text-xs sm:text-sm border shadow-2xs cursor-pointer bg-white hover:bg-slate-50 text-slate-800 border-slate-200/90"
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

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-3.5 mt-4 pt-4 border-t border-slate-200/90">
          {loading && !data ? (
            Array.from({ length: 6 }).map((_, i) => <KpiCardSkeleton key={i} />)
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
                    />
                    <BigKpiCard
                      label="Active Branches"
                      value={fmtInt(totals.activeBranchCount)}
                      sub="Phnom Penh Branches"
                      icon={Building2}
                      accentColor="amber"
                      badge={`${totals.branchesOnTarget} on target`}
                      onClick={() => handleCardClick('branches', 'all', 'branch')}
                      active={selectedCard === 'branches'}
                    />
                    <BigKpiCard
                      label="Active Staff"
                      value={fmtInt(totals.activeStaffCount)}
                      sub={
                        isTaskMode
                          ? (totals.mgtStaffCount > 0 ? `Avg ${fmtPts(totals.avgStaffTasks)} tasks/field staff (${totals.mgtStaffCount} mgt exempt)` : `Avg ${fmtPts(totals.avgStaffTasks)} tasks / staff`)
                          : (totals.mgtStaffCount > 0 ? `Avg ${fmtPts(totals.avgStaffPts)} pts/field staff (${totals.mgtStaffCount} mgt exempt)` : `Avg ${fmtPts(totals.avgStaffPts)} pts / staff`)
                      }
                      icon={Users}
                      accentColor="violet"
                      badge={`${totals.staffOnTarget} on target`}
                      onClick={() => handleCardClick('staff', 'all', 'staff')}
                      active={selectedCard === 'staff'}
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
                    />
                  </>
                );
              })()}
            </>
          )}
        </div>
      </section>

      {/* ───────────── Navigation & Filter Bar ───────────── */}
      <section className="bg-white rounded-2xl border border-slate-200/90 px-3.5 py-2.5 shadow-2xs" aria-label="KPI Navigation and Filters">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="w-full sm:w-auto overflow-x-auto no-scrollbar py-0.5">
            <div className="inline-flex items-center p-1 rounded-xl bg-slate-100 border border-slate-200/90 gap-0.5 shrink-0 whitespace-nowrap" role="tablist" aria-label="KPI Views">
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
                  className={`relative px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors duration-150 inline-flex items-center gap-1.5 ${
                    active ? 'text-white font-semibold' : 'text-slate-700 hover:text-slate-900 font-medium'
                  }`}
                >
                  {active && (
                    <PillMotion
                      layoutId="kpi-view-pill"
                      className="absolute inset-0 rounded-lg tab-active-blue shadow-2xs"
                      transition={SPRING}
                    />
                  )}
                  <Icon className={`w-3.5 h-3.5 relative z-10 shrink-0 transition-colors ${active ? 'text-white' : t.accentColor}`} aria-hidden />
                  <span className="relative z-10">{t.label}</span>
                  {t.count !== undefined && (
                    <span
                      className={`relative z-10 font-figure tabular-nums text-[10px] px-1.5 py-0.5 rounded-full leading-none font-medium ${
                        active ? 'bg-white/20 text-white' : 'bg-white text-slate-700 border border-slate-200/80'
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
                onChange={(e) => setBranchFilter(e.target.value)}
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
                onChange={(e) => setCategoryFilter(e.target.value as 'ALL' | KpiCategory)}
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
          <AfterPaint order={1} minHeight={502}>
          <section
            className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden p-4 sm:p-5 space-y-4"
            aria-label="Executive KPI Charts"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-sky-50 text-[#003857] border border-sky-100 flex items-center justify-center shrink-0">
                  <TrendingUp className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Performance Velocity &amp; Monthly Target Attainment</h3>
                  <p className="text-[11.5px] text-slate-500 font-medium">
                    {isTaskMode
                      ? 'Task count trajectory across time and actual vs target attainment'
                      : 'Point output trajectory across time and actual vs target attainment'}
                  </p>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Chart 1 (7 cols): Style 1 — Twin Smooth Area Spline + Active Staff Ribbon */}
            <div
              data-testid="kpi-velocity-chart-card"
              className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden flex flex-col justify-between"
            >
              <div className="px-4 sm:px-5 pt-4 pb-3 border-b border-slate-100 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-[13px] font-semibold text-slate-900">
                      {isTaskMode ? 'KPI Task Velocity & Active Staff' : 'KPI Point Velocity & Active Staff'}
                    </h3>
                    <p className="text-[11px] text-slate-500">Executive velocity across selected granularity</p>
                  </div>

                  <div className="inline-flex p-1 rounded-xl bg-slate-100 border border-slate-200/90 gap-0.5" role="tablist" aria-label="Chart granularity">
                    {([
                      { g: 'daily' as const, label: 'Daily', dot: 'bg-sky-500' },
                      { g: 'weekly' as const, label: 'Weekly', dot: 'bg-emerald-500' },
                      { g: 'monthly' as const, label: 'Monthly', dot: 'bg-[#003857]' },
                      { g: 'quarterly' as const, label: 'Quarterly', dot: 'bg-amber-500' },
                    ]).map(({ g, label, dot }) => {
                      const active = granularity === g;
                      return (
                        <button
                          key={g}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          onClick={() => setGranularity(g)}
                          aria-pressed={active}
                          className={`relative px-2.5 py-1 rounded-lg text-[11px] cursor-pointer transition-colors inline-flex items-center gap-1.5 ${
                            active ? 'text-white font-semibold' : 'text-slate-700 hover:text-slate-900 font-medium'
                          }`}
                        >
                          {active && (
                            <PillMotion
                              layoutId="kpi-chart-granularity-pill"
                              transition={SPRING}
                              className="absolute inset-0 rounded-lg tab-active-blue shadow-2xs pointer-events-none"
                            />
                          )}
                          <span className={`w-1.5 h-1.5 rounded-full relative z-10 shrink-0 ${active ? 'bg-white' : dot}`} aria-hidden />
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
                      <div className="flex items-baseline gap-2">
                        <span className="font-figure text-2xl font-bold tracking-tight text-slate-900 tabular-nums leading-none">
                          {isTaskMode ? fmtInt(velocitySummary.total) : fmtPts(velocitySummary.total)}
                        </span>
                        {velocitySummary.peakLabel && (
                          <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200/70 tabular-nums">
                            Peak {velocitySummary.peakLabel}
                          </span>
                        )}
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
                    <span className="inline-flex items-center gap-1.5 text-[#1e6091]">
                      <span className="w-4 border-t-[2.5px] border-[#1e6091] inline-block rounded-full" aria-hidden />
                      <span>{isTaskMode ? 'Total Tasks (left)' : 'Total Points (left)'}</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-[#334155]">
                      <span className="w-4 border-t-2 border-dashed border-[#334155] inline-block" aria-hidden />
                      <span>Active staff (right)</span>
                    </span>
                  </div>
                </div>

                <div className="h-[268px] w-full">
                  {reversedTimeSeries.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-xs text-slate-400">
                      No trend data available for this granularity.
                    </div>
                  ) : (
                    <MeasuredChart height={268}>{(chartW) => (
                      <ComposedChart width={chartW} height={268} data={reversedTimeSeries} margin={{ top: 12, right: 6, left: -12, bottom: 0 }}>
                        <defs>
                          <linearGradient id="kpiSplineAreaGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#1e6091" stopOpacity={0.34} />
                            <stop offset="65%" stopColor="#1e6091" stopOpacity={0.1} />
                            <stop offset="100%" stopColor="#1e6091" stopOpacity={0.01} />
                          </linearGradient>
                          <linearGradient id="kpiStaffRibbonGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#334155" stopOpacity={0.08} />
                            <stop offset="100%" stopColor="#334155" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 4" stroke="rgba(148, 163, 184, 0.25)" vertical={false} />
                        <XAxis
                          dataKey="label"
                          axisLine={{ stroke: '#cbd5e1' }}
                          tickLine={false}
                          tick={{ fontSize: 11, fill: '#64748b' }}
                          dy={4}
                          interval={granularity === 'daily' ? 0 : Math.max(0, Math.ceil(chronologicalTimeSeries.length / 15) - 1)}
                        />
                        <YAxis
                          yAxisId="left"
                          axisLine={false}
                          tickLine={false}
                          tick={{ fontSize: 11, fill: '#64748b' }}
                          tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))}
                        />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          axisLine={false}
                          tickLine={false}
                          tick={{ fontSize: 11, fill: '#334155' }}
                          width={32}
                        />
                        <Tooltip
                          content={<CustomTrendTooltip metricMode={metricMode} />}
                          cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3', strokeWidth: 1.25 }}
                          isAnimationActive={false}
                        />
                        <Area
                          yAxisId="left"
                          type="monotone"
                          dataKey={isTaskMode ? 'totalTasks' : 'totalPoints'}
                          name={isTaskMode ? 'Total Tasks' : 'Total Points'}
                          stroke="#1e6091"
                          strokeWidth={2.5}
                          fill="url(#kpiSplineAreaGrad)"
                          dot={(dotProps: { cx?: number; cy?: number; value?: number; index?: number }) => {
                            const val = Number(dotProps.value || 0);
                            if (val <= 0 || dotProps.cx == null || dotProps.cy == null) {
                              return <g key={`pt-empty-${dotProps.index}`} />;
                            }
                            const isPeak = velocitySummary.peakVal > 0 && Math.abs(val - velocitySummary.peakVal) < 0.05;
                            return (
                              <circle
                                key={`pt-dot-${dotProps.index}`}
                                cx={dotProps.cx}
                                cy={dotProps.cy}
                                r={isPeak ? 4.2 : 3}
                                fill={isPeak ? '#1e6091' : '#ffffff'}
                                stroke={isPeak ? '#ffffff' : '#1e6091'}
                                strokeWidth={2}
                              />
                            );
                          }}
                          activeDot={{ r: 5.5, fill: '#1e6091', stroke: '#ffffff', strokeWidth: 2.5 }}
                          isAnimationActive={false}
                        />
                        <Area
                          yAxisId="right"
                          type="monotone"
                          dataKey="activeStaff"
                          name="Active Staff"
                          stroke="#334155"
                          strokeWidth={2}
                          strokeDasharray="5 4"
                          fill="url(#kpiStaffRibbonGrad)"
                          dot={(dotProps: { cx?: number; cy?: number; value?: number; index?: number }) => {
                            const val = Number(dotProps.value || 0);
                            if (val <= 0 || dotProps.cx == null || dotProps.cy == null) {
                              return <g key={`st-empty-${dotProps.index}`} />;
                            }
                            return (
                              <circle
                                key={`st-dot-${dotProps.index}`}
                                cx={dotProps.cx}
                                cy={dotProps.cy}
                                r={3}
                                fill="#ffffff"
                                stroke="#334155"
                                strokeWidth={1.8}
                              />
                            );
                          }}
                          activeDot={{ r: 5.2, fill: '#334155', stroke: '#ffffff', strokeWidth: 2.2 }}
                          isAnimationActive={false}
                        />
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
          className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden p-4 sm:p-5 space-y-4"
          aria-label="Most KPI Types Consumed"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-sky-50 text-[#003857] border border-sky-100 flex items-center justify-center shrink-0">
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
                { cat: 'Sound Box' as KpiCategory, tasks: totals.sbTasks, pts: totals.sbPoints, extra: `${fmtInt(totals.raw.sbInstall)} install · ${fmtInt(totals.raw.sbReplace)} swap · ${fmtInt(totals.raw.sbMaint)} op. support` },
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
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border shadow-2xs cursor-pointer transition ${
                              subCatActiveOnly
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100/80'
                                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                            }`}
                            title={subCatActiveOnly ? 'Click to show all rules (including 0 pts)' : 'Click to hide 0-pt standby rules'}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${subCatActiveOnly ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                            <span>{subCatActiveOnly ? `Active Only (${activeSubCategoryCount})` : `All Rules (${totalInSelectedCategory})`}</span>
                          </button>

                          {/* View Mode Switcher */}
                          <div className="relative inline-flex rounded-xl border border-slate-200/90 p-1 bg-slate-100/90 shadow-2xs gap-0.5" role="tablist" aria-label="View mode">
                            <button
                              type="button"
                              role="tab"
                              aria-selected={subCatViewMode === 'cards'}
                              onClick={() => setSubCatViewMode('cards')}
                              className={`relative px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-colors select-none outline-none ${
                                subCatViewMode === 'cards'
                                  ? 'text-white font-semibold'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                              title="Card Grid View"
                            >
                              {subCatViewMode === 'cards' && (
                                <PillMotion
                                  layoutId={SHARED_LAYOUT_IDS.KPI_SUBCAT_VIEW_PILL}
                                  transition={SPRING_TAB_PILL}
                                  className="absolute inset-0 rounded-lg tab-active-blue border border-white/10 shadow-xs z-0 pointer-events-none"
                                />
                              )}
                              <LayoutGrid className={`w-3.5 h-3.5 relative z-10 transition-colors ${subCatViewMode === 'cards' ? 'text-white' : 'text-sky-600'}`} />
                              <span className="hidden sm:inline relative z-10">Cards</span>
                            </button>
                            <button
                              type="button"
                              role="tab"
                              aria-selected={subCatViewMode === 'table'}
                              onClick={() => setSubCatViewMode('table')}
                              className={`relative px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-colors select-none outline-none ${
                                subCatViewMode === 'table'
                                  ? 'text-white font-semibold'
                                  : 'text-slate-700 hover:text-slate-900'
                              }`}
                              title="Detailed Table View"
                            >
                              {subCatViewMode === 'table' && (
                                <PillMotion
                                  layoutId={SHARED_LAYOUT_IDS.KPI_SUBCAT_VIEW_PILL}
                                  transition={SPRING_TAB_PILL}
                                  className="absolute inset-0 rounded-lg tab-active-blue border border-white/10 shadow-xs z-0 pointer-events-none"
                                />
                              )}
                              <List className={`w-3.5 h-3.5 relative z-10 transition-colors ${subCatViewMode === 'table' ? 'text-white' : 'text-emerald-600'}`} />
                              <span className="hidden sm:inline relative z-10">Table</span>
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Second Row: Category Pills + Search Filter */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-2 border-t border-slate-200/60">
                        {/* Segmented Category Filter Tabs */}
                        <div
                          role="tablist"
                          aria-label="Filter tasks by category"
                          className="relative inline-flex flex-wrap items-center p-1 rounded-xl bg-slate-100/90 border border-slate-200/90 shadow-2xs gap-0.5 select-none"
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
                                className={`relative px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer select-none outline-none inline-flex items-center gap-1.5 ${
                                  active
                                    ? 'text-white'
                                    : 'text-slate-600 hover:text-slate-900'
                                }`}
                              >
                                {active && (
                                  <PillMotion
                                    layoutId={SHARED_LAYOUT_IDS.KPI_SUBCAT_CATEGORY_PILL}
                                    transition={SPRING_TAB_PILL}
                                    className="absolute inset-0 rounded-lg tab-active-blue border border-white/10 shadow-xs z-0 pointer-events-none"
                                  />
                                )}
                                <span
                                  className={`w-2 h-2 rounded-full relative z-10 shrink-0 transition-colors ${
                                    active ? 'bg-white' : (catStyle ? catStyle.dot : 'bg-slate-400')
                                  }`}
                                />
                                <span className="relative z-10">{label}</span>
                                <span
                                  className={`relative z-10 text-[10.5px] px-1.5 py-0.2 rounded-md font-mono font-medium transition-colors ${
                                    active
                                      ? 'bg-white/20 text-white font-bold'
                                      : 'bg-white text-slate-600 border border-slate-200/80 shadow-2xs'
                                  }`}
                                >
                                  {count}
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        {/* Search Input */}
                        <div className="relative min-w-[200px] sm:w-64">
                          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                          <input
                            type="text"
                            value={subCatSearch}
                            onChange={(e) => setSubCatSearch(e.target.value)}
                            placeholder="Filter tasks (e.g. roll, swap)..."
                            className="w-full pl-8 pr-7 py-1 text-xs rounded-lg border border-slate-200/90 bg-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                          />
                          {subCatSearch && (
                            <button
                              type="button"
                              onClick={() => setSubCatSearch('')}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                              title="Clear search"
                            >
                              <X className="w-3 h-3" />
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
                    ) : subCatViewMode === 'cards' ? (
                      <div className="p-3.5 sm:p-4 bg-slate-50/50">
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                          {displayedSubCategories.map((sc, i) => {
                            const pct = totals.totalPoints > 0 ? (sc.points / totals.totalPoints) * 100 : 0;
                            const pctDisplay = pct >= 1 ? `${Math.round(pct)}%` : pct > 0 ? `${pct.toFixed(1)}%` : '0%';
                            const catStyle = CAT_COLORS[sc.category];
                            const Icon = catStyle.Icon;
                            const isZero = sc.points === 0;

                            const rankBadge =
                              i === 0 && !isZero
                                ? 'bg-amber-100 text-amber-900 border-amber-300 font-bold shadow-2xs'
                                : i === 1 && !isZero
                                ? 'bg-slate-200 text-slate-800 border-slate-300 font-bold'
                                : i === 2 && !isZero
                                ? 'bg-amber-50 text-amber-900 border-amber-200 font-bold'
                                : 'bg-slate-100 text-slate-500 border-slate-200';

                            return (
                              <div
                                key={sc.code}
                                className={`group rounded-xl border p-3.5 transition-all duration-150 flex flex-col justify-between ${
                                  isZero
                                    ? 'bg-white/80 border-slate-200/60 opacity-60 hover:opacity-100 hover:shadow-xs'
                                    : 'bg-white border-slate-200/90 shadow-2xs hover:shadow-md hover:border-slate-300'
                                }`}
                              >
                                <div>
                                  {/* Top Row: Rank + Category Badge + Points */}
                                  <div className="flex items-center justify-between gap-2 mb-2">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <span className={`inline-flex items-center justify-center w-5 h-5 rounded-md text-[10.5px] border ${rankBadge} shrink-0`}>
                                        {i + 1}
                                      </span>
                                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-semibold border ${catStyle.badge} truncate`}>
                                        <Icon className="w-3 h-3 shrink-0" />
                                        <span className="truncate">{sc.category}</span>
                                      </span>
                                    </div>
                                    <div className="text-right shrink-0 tabular-nums">
                                      <span className={`font-figure font-bold text-sm ${isZero ? 'text-slate-400' : 'text-slate-900'}`}>
                                        {fmtPts(sc.points)} <span className="text-[11px] font-normal text-slate-500">pts</span>
                                      </span>
                                    </div>
                                  </div>

                                  {/* Task Label */}
                                  <h4 className="text-[13px] font-semibold text-slate-900 leading-snug group-hover:text-sky-800 transition-colors line-clamp-1" title={sc.label}>
                                    {sc.label}
                                  </h4>

                                  {/* Metrics & Share */}
                                  <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-slate-500">
                                    <span className="truncate">
                                      <span className="font-semibold text-slate-700">{fmtInt(sc.count)}</span> {sc.unit} × {sc.unitPts} pt
                                    </span>
                                    <span className="shrink-0 font-medium text-slate-600 bg-slate-100 px-1.5 py-0.2 rounded text-[10.5px] tabular-nums">
                                      {pctDisplay} share
                                    </span>
                                  </div>
                                </div>

                                {/* Mini Progress Bar */}
                                <div className="mt-3 w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all duration-300 ${catStyle.bar}`}
                                    style={{ width: `${Math.min(100, Math.max(isZero ? 0 : 3, pct))}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="overflow-x-auto bg-white">
                        <table className="w-full text-left text-xs text-slate-700">
                          <thead className="bg-slate-50/90 text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                            <tr>
                              <th className="py-2.5 px-3.5 w-12 text-center">#</th>
                              <th className="py-2.5 px-3.5">Sub-Category Task</th>
                              <th className="py-2.5 px-3.5">Category</th>
                              <th className="py-2.5 px-3.5 text-right">Recorded Volume</th>
                              <th className="py-2.5 px-3.5 text-right">Weight (Rate)</th>
                              <th className="py-2.5 px-3.5 text-right">Total Points</th>
                              <th className="py-2.5 px-3.5 text-right w-28">Point Share</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {displayedSubCategories.map((sc, i) => {
                              const pct = totals.totalPoints > 0 ? (sc.points / totals.totalPoints) * 100 : 0;
                              const pctDisplay = pct >= 1 ? `${Math.round(pct)}%` : pct > 0 ? `${pct.toFixed(1)}%` : '0%';
                              const catStyle = CAT_COLORS[sc.category];
                              const Icon = catStyle.Icon;
                              const isZero = sc.points === 0;

                              return (
                                <tr key={sc.code} className={`hover:bg-slate-50/80 transition-colors ${isZero ? 'opacity-50' : ''}`}>
                                  <td className="py-2.5 px-3.5 text-center font-mono text-[11px] text-slate-400">
                                    {i + 1}
                                  </td>
                                  <td className="py-2.5 px-3.5 font-semibold text-slate-900">
                                    {sc.label}
                                  </td>
                                  <td className="py-2.5 px-3.5">
                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-semibold border ${catStyle.badge}`}>
                                      <Icon className="w-3 h-3 shrink-0" />
                                      {sc.category}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3.5 text-right font-medium text-slate-700 tabular-nums">
                                    {fmtInt(sc.count)} <span className="text-slate-400 font-normal">{sc.unit}</span>
                                  </td>
                                  <td className="py-2.5 px-3.5 text-right text-slate-600 tabular-nums">
                                    {sc.unitPts} pt
                                  </td>
                                  <td className="py-2.5 px-3.5 text-right font-bold text-slate-900 tabular-nums">
                                    {fmtPts(sc.points)} pts
                                  </td>
                                  <td className="py-2.5 px-3.5 text-right tabular-nums">
                                    <div className="flex items-center justify-end gap-2">
                                      <span className="font-semibold text-slate-700 text-[11px]">{pctDisplay}</span>
                                      <div className="w-12 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                        <div
                                          className={`h-full rounded-full ${catStyle.bar}`}
                                          style={{ width: `${Math.min(100, Math.max(isZero ? 0 : 5, pct))}%` }}
                                        />
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

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
          className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden p-4 sm:p-5 space-y-4"
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
              <div className="inline-flex p-1 rounded-xl bg-slate-100 border border-slate-200/90 gap-0.5 text-xs shrink-0 whitespace-nowrap" role="tablist" aria-label="Leaderboard mode">
                <button
                  type="button"
                  role="tab"
                  aria-selected={leaderboardMode === 'staff'}
                  onClick={() => setLeaderboardMode('staff')}
                  className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${
                    leaderboardMode === 'staff' ? 'text-white' : 'text-slate-700 hover:text-slate-900 font-medium'
                  }`}
                >
                  {leaderboardMode === 'staff' && (
                    <PillMotion
                      layoutId="kpi-top10-mode-pill"
                      transition={SPRING}
                      className="absolute inset-0 rounded-lg tab-active-blue shadow-2xs pointer-events-none"
                    />
                  )}
                  <Users className={`w-3.5 h-3.5 relative z-10 transition-colors ${leaderboardMode === 'staff' ? 'text-white' : 'text-sky-600'}`} aria-hidden />
                  <span className="relative z-10">Top 10 Staff</span>
                  <span className={`relative z-10 text-[10px] px-1.5 py-0.2 rounded-full font-figure tabular-nums font-medium ${leaderboardMode === 'staff' ? 'bg-white/20 text-white' : 'bg-white text-slate-700 border border-slate-200/80'}`}>
                    {top10Data.staff.length}
                  </span>
                </button>

                <button
                  type="button"
                  role="tab"
                  aria-selected={leaderboardMode === 'branch'}
                  onClick={() => setLeaderboardMode('branch')}
                  className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${
                    leaderboardMode === 'branch' ? 'text-white' : 'text-slate-700 hover:text-slate-900 font-medium'
                  }`}
                >
                  {leaderboardMode === 'branch' && (
                    <PillMotion
                      layoutId="kpi-top10-mode-pill"
                      transition={SPRING}
                      className="absolute inset-0 rounded-lg tab-active-blue shadow-2xs pointer-events-none"
                    />
                  )}
                  <Building2 className={`w-3.5 h-3.5 relative z-10 transition-colors ${leaderboardMode === 'branch' ? 'text-white' : 'text-emerald-600'}`} aria-hidden />
                  <span className="relative z-10">Top 10 Branches</span>
                  <span className={`relative z-10 text-[10px] px-1.5 py-0.2 rounded-full font-figure tabular-nums font-medium ${leaderboardMode === 'branch' ? 'bg-white/20 text-white' : 'bg-white text-slate-700 border border-slate-200/80'}`}>
                    {top10Data.branches.length}
                  </span>
                </button>
              </div>

              {/* Month Selector Pills */}
              <div className="inline-flex flex-wrap items-center gap-0.5 p-1 rounded-xl bg-slate-100 border border-slate-200/90" role="tablist" aria-label="Leaderboard month">
                <button
                  type="button"
                  role="tab"
                  aria-selected={selectedTopMonth === 'ALL'}
                  onClick={() => setSelectedTopMonth('ALL')}
                  className={`relative px-2.5 py-1 rounded-lg text-[11px] cursor-pointer transition-colors ${
                    selectedTopMonth === 'ALL' ? 'text-white font-semibold' : 'text-slate-700 hover:text-slate-900 font-medium'
                  }`}
                >
                  {selectedTopMonth === 'ALL' && (
                    <PillMotion
                      layoutId="kpi-top10-month-pill"
                      transition={SPRING}
                      className="absolute inset-0 rounded-lg tab-active-blue shadow-2xs pointer-events-none"
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
                    onClick={() => setSelectedTopMonth(m)}
                    className={`relative px-2.5 py-1 rounded-lg text-[11px] cursor-pointer transition-colors ${
                      selectedTopMonth === m ? 'text-white font-semibold' : 'text-slate-700 hover:text-slate-900 font-medium'
                    }`}
                  >
                    {selectedTopMonth === m && (
                      <PillMotion
                        layoutId="kpi-top10-month-pill"
                        transition={SPRING}
                        className="absolute inset-0 rounded-lg tab-active-blue shadow-2xs pointer-events-none"
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
                    <Users className="w-4 h-4 text-[#003857]" />
                    <span>Top 10 Individual Performers · {selectedTopMonth === 'ALL' ? KPI_PERIOD_LABEL[period] : fmtMonth(selectedTopMonth)}</span>
                  </>
                ) : (
                  <>
                    <Building2 className="w-4 h-4 text-[#003857]" />
                    <span>Top 10 Branches · {selectedTopMonth === 'ALL' ? KPI_PERIOD_LABEL[period] : fmtMonth(selectedTopMonth)}</span>
                  </>
                )}
              </span>
              <span className="text-slate-500 font-medium normal-case text-xs">
                {isTaskMode ? 'ranked by total task count' : 'ranked by total KPI points'}
              </span>
            </div>

            <div className="overflow-x-auto overflow-y-hidden w-full overscroll-x-contain">
              <table className="w-full text-left border-separate border-spacing-0 text-[13px]">
                {leaderboardMode === 'staff' ? (
                  <>
                    <thead>
                      <tr className="navy-header-bar bg-[#003857] text-white text-xs font-semibold normal-case tracking-normal select-none">
                        <th className="py-2.5 px-3 text-center w-14 border-b border-white/20">No.</th>
                        <th className="py-2.5 px-4 text-left min-w-[200px] border-b border-white/20">Staff Name</th>
                        <th className="py-2.5 px-3 text-center w-24 border-b border-white/20">Staff ID</th>
                        <th className="py-2.5 px-4 text-left min-w-[200px] border-b border-white/20">Branch Name</th>
                        <th className="py-2.5 px-3 text-center w-24 border-b border-white/20">Branch Code</th>
                        <th className="py-2.5 px-3 text-right w-28 border-b border-white/20">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <Cpu className="w-3.5 h-3.5 text-[#5cc8ff]" />
                            <span>{isTaskMode ? 'POS Tasks' : 'POS Pts'}</span>
                          </span>
                        </th>
                        <th className="py-2.5 px-3 text-right w-28 border-b border-white/20">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <Volume2 className="w-3.5 h-3.5 text-[#a2a5e0]" />
                            <span>{isTaskMode ? 'SB Tasks' : 'SB Pts'}</span>
                          </span>
                        </th>
                        <th className="py-2.5 px-3 text-right w-24 border-b border-white/20">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <QrCode className="w-3.5 h-3.5 text-[#74b9ff]" />
                            <span>{isTaskMode ? 'KHQR Tasks' : 'KHQR Pts'}</span>
                          </span>
                        </th>
                        <th className="py-2.5 px-3 text-right w-24 border-b border-white/20">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <CreditCard className="w-3.5 h-3.5 text-amber-300" />
                            <span>{isTaskMode ? 'CC Tasks' : 'CC Pts'}</span>
                          </span>
                        </th>
                        <th className="py-2.5 px-3 text-right w-24 border-b border-white/20">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <ClipboardList className="w-3.5 h-3.5 text-[#52b788]" />
                            <span>{isTaskMode ? 'MV Tasks' : 'MV Pts'}</span>
                          </span>
                        </th>
                        <th className="py-2.5 px-3 text-center w-28 border-b border-white/20">Category Mix</th>
                        <th className="py-2.5 px-3 text-right w-24 border-b border-white/20">{isTaskMode ? 'Total Points' : 'Total Tasks'}</th>
                        <th className="py-2.5 px-4 text-right w-32 border-b border-white/20">{isTaskMode ? 'Total Tasks' : 'Total Points'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-[13px] text-slate-700">
                      {top10Data.staff.length === 0 ? (
                        <tr>
                          <td colSpan={13} className="py-12 text-center text-xs text-slate-400">
                            No staff records in this period.
                          </td>
                        </tr>
                      ) : (
                        top10Data.staff.map((s, i) => (
                          <tr key={s.staffId} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-2.5 px-3 text-center">
                              <div className="flex justify-center items-center">
                                <RankBadge rank={i + 1} />
                              </div>
                            </td>
                            <td className="py-2.5 px-4">
                              <span className="font-semibold text-slate-900 text-[13px] block truncate" title={s.staffName}>
                                {s.staffName}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <span className="font-mono text-xs text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200/80 tabular-nums">
                                {s.staffId || '—'}
                              </span>
                            </td>
                            <td className="py-2.5 px-4">
                              <span className="text-[13px] text-slate-800 font-medium truncate block" title={cleanBranchName(s.branchName)}>
                                {cleanBranchName(s.branchName)}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <span
                                className="font-mono text-xs text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200/80 tabular-nums"
                                title={s.branchId === 'UNASSIGNED' ? 'Unassigned' : s.branchId}
                              >
                                {fmtBranchCode(s.branchId)}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-700 font-medium">
                              {isTaskMode ? <>{fmtInt(s.posTasks)} <span className="text-[11px] text-slate-400">tasks</span></> : <>{fmtPts(s.posPoints)} <span className="text-[11px] text-slate-400">pts</span></>}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-700 font-medium">
                              {isTaskMode ? <>{fmtInt(s.sbTasks)} <span className="text-[11px] text-slate-400">tasks</span></> : <>{fmtPts(s.sbPoints)} <span className="text-[11px] text-slate-400">pts</span></>}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-700 font-medium">
                              {isTaskMode ? <>{fmtInt(s.khqrTasks)} <span className="text-[11px] text-slate-400">tasks</span></> : <>{fmtPts(s.khqrPoints)} <span className="text-[11px] text-slate-400">pts</span></>}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-700 font-medium">
                              {isTaskMode ? <>{fmtInt(s.ccTasks)} <span className="text-[11px] text-slate-400">tasks</span></> : <>{fmtPts(s.ccPoints)} <span className="text-[11px] text-slate-400">pts</span></>}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-700 font-medium">
                              {isTaskMode ? <>{fmtInt(s.mvTasks)} <span className="text-[11px] text-slate-400">tasks</span></> : <>{fmtPts(s.mvPoints)} <span className="text-[11px] text-slate-400">pts</span></>}
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="flex justify-center items-center">
                                {isTaskMode ? (
                                  <MiniMixBar pos={s.posTasks} sb={s.sbTasks} khqr={s.khqrTasks} cc={s.ccTasks} mv={s.mvTasks} total={s.totalTasks} />
                                ) : (
                                  <MiniMixBar pos={s.posPoints} sb={s.sbPoints} khqr={s.khqrPoints} cc={s.ccPoints} mv={s.mvPoints} total={s.totalPoints} />
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-600 font-medium">
                              {isTaskMode ? <>{fmtPts(s.totalPoints)} pts</> : fmtInt(s.totalTasks)}
                            </td>
                            <td className="py-2.5 px-4 text-right tabular-nums">
                              <span className="font-bold text-[#003857] text-[13.5px]">
                                {isTaskMode ? <>{fmtInt(s.totalTasks)} <span className="text-xs font-semibold">tasks</span></> : <>{fmtPts(s.totalPoints)} <span className="text-xs font-semibold">pts</span></>}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </>
                ) : (
                  <>
                    <thead>
                      <tr className="navy-header-bar bg-[#003857] text-white text-xs font-semibold normal-case tracking-normal select-none">
                        <th className="py-2.5 px-3 text-center w-14 border-b border-white/20">No.</th>
                        <th className="py-2.5 px-4 text-left min-w-[220px] border-b border-white/20">Branch Name</th>
                        <th className="py-2.5 px-3 text-center w-24 border-b border-white/20">Branch Code</th>
                        <th className="py-2.5 px-3 text-center w-28 border-b border-white/20">Active Staff</th>
                        <th className="py-2.5 px-3 text-right w-28 border-b border-white/20">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <Cpu className="w-3.5 h-3.5 text-[#5cc8ff]" />
                            <span>{isTaskMode ? 'POS Tasks' : 'POS Pts'}</span>
                          </span>
                        </th>
                        <th className="py-2.5 px-3 text-right w-28 border-b border-white/20">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <Volume2 className="w-3.5 h-3.5 text-[#a2a5e0]" />
                            <span>{isTaskMode ? 'SB Tasks' : 'SB Pts'}</span>
                          </span>
                        </th>
                        <th className="py-2.5 px-3 text-right w-24 border-b border-white/20">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <QrCode className="w-3.5 h-3.5 text-[#74b9ff]" />
                            <span>{isTaskMode ? 'KHQR Tasks' : 'KHQR Pts'}</span>
                          </span>
                        </th>
                        <th className="py-2.5 px-3 text-right w-24 border-b border-white/20">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <CreditCard className="w-3.5 h-3.5 text-amber-300" />
                            <span>{isTaskMode ? 'CC Tasks' : 'CC Pts'}</span>
                          </span>
                        </th>
                        <th className="py-2.5 px-3 text-right w-24 border-b border-white/20">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <ClipboardList className="w-3.5 h-3.5 text-[#52b788]" />
                            <span>{isTaskMode ? 'MV Tasks' : 'MV Pts'}</span>
                          </span>
                        </th>
                        <th className="py-2.5 px-3 text-center w-28 border-b border-white/20">Category Mix</th>
                        <th className="py-2.5 px-3 text-right w-24 border-b border-white/20">{isTaskMode ? 'Tasks / Staff' : 'Pts / Staff'}</th>
                        <th className="py-2.5 px-3 text-right w-24 border-b border-white/20">{isTaskMode ? 'Total Points' : 'Total Tasks'}</th>
                        <th className="py-2.5 px-4 text-right w-32 border-b border-white/20">{isTaskMode ? 'Total Tasks' : 'Total Points'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-[13px] text-slate-700">
                      {top10Data.branches.length === 0 ? (
                        <tr>
                          <td colSpan={13} className="py-12 text-center text-xs text-slate-400">
                            No branch records in this period.
                          </td>
                        </tr>
                      ) : (
                        top10Data.branches.map((b, i) => (
                          <tr key={b.branchId} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-2.5 px-3 text-center">
                              <div className="flex justify-center items-center">
                                <RankBadge rank={i + 1} />
                              </div>
                            </td>
                            <td className="py-2.5 px-4">
                              <span className="font-semibold text-slate-900 text-[13px] block truncate" title={cleanBranchName(b.branchName)}>
                                {cleanBranchName(b.branchName)}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <span
                                className="font-mono text-xs text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200/80 tabular-nums"
                                title={b.branchId === 'UNASSIGNED' ? 'Unassigned' : b.branchId}
                              >
                                {fmtBranchCode(b.branchId)}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-normal bg-slate-100 text-slate-600 border border-slate-200/80 tabular-nums whitespace-nowrap">
                                {b.staffCount} staff
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-700 font-medium">
                              {isTaskMode ? <>{fmtInt(b.posTasks)} <span className="text-[11px] text-slate-400">tasks</span></> : <>{fmtPts(b.posPoints)} <span className="text-[11px] text-slate-400">pts</span></>}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-700 font-medium">
                              {isTaskMode ? <>{fmtInt(b.sbTasks)} <span className="text-[11px] text-slate-400">tasks</span></> : <>{fmtPts(b.sbPoints)} <span className="text-[11px] text-slate-400">pts</span></>}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-700 font-medium">
                              {isTaskMode ? <>{fmtInt(b.khqrTasks)} <span className="text-[11px] text-slate-400">tasks</span></> : <>{fmtPts(b.khqrPoints)} <span className="text-[11px] text-slate-400">pts</span></>}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-700 font-medium">
                              {isTaskMode ? <>{fmtInt(b.ccTasks)} <span className="text-[11px] text-slate-400">tasks</span></> : <>{fmtPts(b.ccPoints)} <span className="text-[11px] text-slate-400">pts</span></>}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-700 font-medium">
                              {isTaskMode ? <>{fmtInt(b.mvTasks)} <span className="text-[11px] text-slate-400">tasks</span></> : <>{fmtPts(b.mvPoints)} <span className="text-[11px] text-slate-400">pts</span></>}
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="flex justify-center items-center">
                                {isTaskMode ? (
                                  <MiniMixBar pos={b.posTasks} sb={b.sbTasks} khqr={b.khqrTasks} cc={b.ccTasks} mv={b.mvTasks} total={b.totalTasks} />
                                ) : (
                                  <MiniMixBar pos={b.posPoints} sb={b.sbPoints} khqr={b.khqrPoints} cc={b.ccPoints} mv={b.mvPoints} total={b.totalPoints} />
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-700 font-medium">
                              {isTaskMode ? <>{fmtPts(b.tasksPerStaff)} <span className="text-[11px] text-slate-400">tasks</span></> : <>{fmtPts(b.ptsPerStaff)} <span className="text-[11px] text-slate-400">pts</span></>}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-600 font-medium">
                              {isTaskMode ? <>{fmtPts(b.totalPoints)} pts</> : fmtInt(b.totalTasks)}
                            </td>
                            <td className="py-2.5 px-4 text-right tabular-nums">
                              <span className="font-bold text-[#003857] text-[13.5px]">
                                {isTaskMode ? <>{fmtInt(b.totalTasks)} <span className="text-xs font-semibold">tasks</span></> : <>{fmtPts(b.totalPoints)} <span className="text-xs font-semibold">pts</span></>}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </>
                )}
              </table>
            </div>
          </div>
        </section>
        </AfterPaint>
      </div>

      {/* ───────────── Overall Performance Breakdown by Daily, Weekly, Monthly & Quarterly ───────────── */}
      <div className={showSection('all') || showSection('timeline') ? 'contents' : 'hidden'}>
        <AfterPaint order={view === 'all' ? 3 : 1} minHeight={timelineExpanded ? 1100 : 480}>
        <section className="fr-table-frame bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden" aria-label="Overall Performance by Period">
          <div className="px-5 py-3.5 border-b border-slate-200/90 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-sky-50 text-[#003857] border border-sky-100 flex items-center justify-center shrink-0 shadow-2xs">
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
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold border border-slate-200/90 bg-white text-[#003857] hover:bg-slate-50 shadow-2xs transition cursor-pointer"
                >
                  <span>{timelineExpanded ? 'Collapse (10d)' : `Expand (1 mo · ${Math.min(30, timeSeries.length)}d)`}</span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${timelineExpanded ? 'rotate-180' : ''}`} />
                </button>
              )}
              <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200/90 text-[11px] gap-0.5" role="tablist" aria-label="Timeline granularity">
              {([
                { g: 'daily' as const, label: 'Daily', dot: 'bg-sky-500' },
                { g: 'weekly' as const, label: 'Weekly', dot: 'bg-emerald-500' },
                { g: 'monthly' as const, label: 'Monthly', dot: 'bg-[#003857]' },
                { g: 'quarterly' as const, label: 'Quarterly', dot: 'bg-amber-500' },
              ]).map(({ g, label, dot }) => {
                const active = granularity === g;
                return (
                  <button
                    key={g}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setGranularity(g)}
                    className={`relative px-3 py-1 rounded-lg cursor-pointer transition-colors inline-flex items-center gap-1.5 ${
                      active ? 'text-white font-semibold' : 'text-slate-700 hover:text-slate-900 font-medium'
                    }`}
                  >
                    {active && (
                      <PillMotion
                        layoutId="kpi-timeline-granularity-pill"
                        transition={SPRING}
                        className="absolute inset-0 rounded-lg tab-active-blue shadow-2xs pointer-events-none"
                      />
                    )}
                    <span className={`w-1.5 h-1.5 rounded-full relative z-10 shrink-0 ${active ? 'bg-white' : dot}`} aria-hidden />
                    <span className="relative z-10">{label}</span>
                  </button>
                );
              })}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto overflow-y-hidden w-full overscroll-x-contain">
            <div className="min-w-[1080px] w-full">
              <div className="grid items-center gap-x-4 grid-cols-[minmax(110px,1.2fr)_minmax(68px,0.75fr)_minmax(65px,0.7fr)_minmax(100px,1.1fr)_minmax(100px,1.1fr)_minmax(110px,1.2fr)_minmax(100px,1.1fr)_minmax(100px,1.1fr)_minmax(72px,0.8fr)_minmax(76px,0.85fr)_minmax(100px,1.1fr)_minmax(76px,0.85fr)] glass-table-thead navy-header-bar bg-[#003857] text-white text-xs font-semibold normal-case tracking-normal px-4 py-2.5">
              <SortableHeader label="Period" sortKey="period" activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} />
              <SortableHeader label="Branches" sortKey="activeBranches" activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" />
              <SortableHeader label="Staff" sortKey="activeStaff" activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" />
              <SortableHeader icon={<Cpu className="w-3.5 h-3.5 text-[#5cc8ff] shrink-0" aria-hidden />} label={isTaskMode ? 'POS Tasks' : 'POS Points'} sortKey={isTaskMode ? 'posTasks' : 'posPoints'} activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
              <SortableHeader icon={<Volume2 className="w-3.5 h-3.5 text-[#a2a5e0] shrink-0" aria-hidden />} label={isTaskMode ? 'SB Tasks' : 'SB Points'} sortKey={isTaskMode ? 'sbTasks' : 'sbPoints'} activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
              <SortableHeader icon={<QrCode className="w-3.5 h-3.5 text-[#74b9ff] shrink-0" aria-hidden />} label={isTaskMode ? 'KHQR Tasks' : 'KHQR Points'} sortKey={isTaskMode ? 'khqrTasks' : 'khqrPoints'} activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
              <SortableHeader icon={<CreditCard className="w-3.5 h-3.5 text-amber-300 shrink-0" aria-hidden />} label={isTaskMode ? 'CC Tasks' : 'CC Points'} sortKey={isTaskMode ? 'ccTasks' : 'ccPoints'} activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
              <SortableHeader icon={<ClipboardList className="w-3.5 h-3.5 text-[#52b788] shrink-0" aria-hidden />} label={isTaskMode ? 'MV Tasks' : 'MV Points'} sortKey={isTaskMode ? 'mvTasks' : 'mvPoints'} activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
              <SortableHeader label={isTaskMode ? 'Total Points' : 'Tasks'} sortKey={isTaskMode ? 'totalPoints' : 'totalTasks'} activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
              <SortableHeader label={isTaskMode ? 'Tasks/Staff' : 'Pts/Staff'} sortKey={isTaskMode ? 'tasksPerStaff' : 'ptsPerStaff'} activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" />
              <SortableHeader label={isTaskMode ? 'Total Tasks' : 'Total Points'} sortKey={isTaskMode ? 'totalTasks' : 'totalPoints'} activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" />
              <SortableHeader label="Change" sortKey="growthPct" activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" />
            </div>
            <div className="divide-y divide-slate-200/80">
              {timeSeries.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400">No historical records found.</div>
              ) : (
                (granularity === 'daily'
                  ? timeSeries.slice(0, timelineExpanded ? 30 : 10)
                  : timeSeries
                ).map((t) => (
                  <div
                    key={t.period}
                    className="grid items-center gap-x-4 grid-cols-[minmax(110px,1.2fr)_minmax(68px,0.75fr)_minmax(65px,0.7fr)_minmax(100px,1.1fr)_minmax(100px,1.1fr)_minmax(110px,1.2fr)_minmax(100px,1.1fr)_minmax(100px,1.1fr)_minmax(72px,0.8fr)_minmax(76px,0.85fr)_minmax(100px,1.1fr)_minmax(76px,0.85fr)] px-4 py-2.5 text-[13px] text-slate-700 hover:bg-slate-50/80 transition-colors"
                  >
                    <span className="font-normal text-slate-900 tabular-nums">{t.label}</span>
                    <span className="text-right tabular-nums font-normal text-slate-800">{fmtInt(t.activeBranches)}</span>
                    <span className="text-right tabular-nums font-normal text-slate-800">{fmtInt(t.activeStaff)}</span>
                    <span className="text-center tabular-nums"><TaskPtsCell tasks={t.posTasks} pts={t.posPoints} mode={metricMode} /></span>
                    <span className="text-center tabular-nums"><TaskPtsCell tasks={t.sbTasks} pts={t.sbPoints} mode={metricMode} /></span>
                    <span className="text-center tabular-nums"><TaskPtsCell tasks={t.khqrTasks} pts={t.khqrPoints} mode={metricMode} /></span>
                    <span className="text-center tabular-nums"><TaskPtsCell tasks={t.ccTasks} pts={t.ccPoints} mode={metricMode} /></span>
                    <span className="text-center tabular-nums"><TaskPtsCell tasks={t.mvTasks} pts={t.mvPoints} mode={metricMode} /></span>
                    <span className="text-center tabular-nums font-normal text-slate-800">
                      {isTaskMode ? `${fmtPts(t.totalPoints)} pts` : fmtInt(t.totalTasks)}
                    </span>
                    <span className="text-right tabular-nums font-normal text-slate-800">
                      {fmtPts(isTaskMode ? t.tasksPerStaff : t.ptsPerStaff)}
                    </span>
                    <span className="text-right tabular-nums font-figure font-normal text-[#003857]">
                      {isTaskMode ? `${fmtInt(t.totalTasks)} tasks` : `${fmtPts(t.totalPoints)} pts`}
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
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg font-bold text-[#003857] hover:bg-white border border-slate-200/90 bg-white/80 shadow-2xs transition cursor-pointer"
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
        <section className="fr-table-frame bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden relative" aria-label="KPI Performance Table">
          {loading && (
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-sky-400 via-[#1e5b88] to-teal-400 animate-pulse z-20" />
          )}

          {/* Section 7 Header Bar */}
          <div className="px-5 py-3.5 border-b border-slate-200/90 bg-slate-50/70 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-[#003857] text-white flex items-center justify-center shrink-0 shadow-2xs">
                <BarChart3 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 leading-snug">Branch &amp; Staff Performance Matrix</h3>
                <p className="text-[11.5px] text-slate-500 font-medium">Rankings, points, targets &amp; daily activity</p>
              </div>
            </div>

            <div className="flex flex-wrap xl:flex-nowrap items-center gap-2">
              <div className="overflow-x-auto no-scrollbar max-w-full py-0.5">
                <div className="inline-flex p-1 rounded-xl bg-slate-100 border border-slate-200/90 gap-0.5 text-xs shrink-0 whitespace-nowrap" role="tablist" aria-label="Matrix mode">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tableMode === 'staff' && staffSubView === 'summary'}
                  onClick={() => { handleTableModeChange('staff'); setStaffSubView('summary'); }}
                  className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${
                    tableMode === 'staff' && staffSubView === 'summary' ? 'text-white' : 'text-slate-700 hover:text-slate-900 font-medium'
                  }`}
                >
                  {tableMode === 'staff' && staffSubView === 'summary' && (
                    <PillMotion
                      layoutId="kpi-table-mode-pill"
                      transition={SPRING}
                      className="absolute inset-0 rounded-lg tab-active-blue shadow-2xs pointer-events-none"
                    />
                  )}
                  <Users className={`w-3.5 h-3.5 relative z-10 transition-colors ${tableMode === 'staff' && staffSubView === 'summary' ? 'text-white' : 'text-sky-600'}`} aria-hidden />
                  <span className="relative z-10">KPI by Staff</span>
                  <span className={`relative z-10 text-[10px] px-1.5 py-0.2 rounded-full font-figure tabular-nums ${tableMode === 'staff' && staffSubView === 'summary' ? 'bg-white/20 text-white' : 'bg-white text-slate-700 border border-slate-200/80 font-medium'}`}>
                    {filteredStaff.length}
                  </span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tableMode === 'branch' && branchSubView === 'summary'}
                  onClick={() => { handleTableModeChange('branch'); setBranchSubView('summary'); }}
                  className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${
                    tableMode === 'branch' && branchSubView === 'summary' ? 'text-white' : 'text-slate-700 hover:text-slate-900 font-medium'
                  }`}
                >
                  {tableMode === 'branch' && branchSubView === 'summary' && (
                    <PillMotion
                      layoutId="kpi-table-mode-pill"
                      transition={SPRING}
                      className="absolute inset-0 rounded-lg tab-active-blue shadow-2xs pointer-events-none"
                    />
                  )}
                  <Building2 className={`w-3.5 h-3.5 relative z-10 transition-colors ${tableMode === 'branch' && branchSubView === 'summary' ? 'text-white' : 'text-emerald-600'}`} aria-hidden />
                  <span className="relative z-10">KPI by Branch</span>
                  <span className={`relative z-10 text-[10px] px-1.5 py-0.2 rounded-full font-figure tabular-nums ${tableMode === 'branch' && branchSubView === 'summary' ? 'bg-white/20 text-white' : 'bg-white text-slate-700 border border-slate-200/80 font-medium'}`}>
                    {filteredBranches.length}
                  </span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tableMode === 'staff' && staffSubView === 'daily'}
                  onClick={() => { handleTableModeChange('staff'); setStaffSubView('daily'); }}
                  className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${
                    tableMode === 'staff' && staffSubView === 'daily' ? 'text-white' : 'text-slate-700 hover:text-slate-900 font-medium'
                  }`}
                >
                  {tableMode === 'staff' && staffSubView === 'daily' && (
                    <PillMotion
                      layoutId="kpi-table-mode-pill"
                      transition={SPRING}
                      className="absolute inset-0 rounded-lg tab-active-blue shadow-2xs pointer-events-none"
                    />
                  )}
                  <Calendar className={`w-3.5 h-3.5 relative z-10 transition-colors ${tableMode === 'staff' && staffSubView === 'daily' ? 'text-white' : 'text-amber-500'}`} aria-hidden />
                  <span className="relative z-10">Staff Daily Tasks</span>
                  <span className={`relative z-10 text-[10px] px-1.5 py-0.2 rounded-full font-figure tabular-nums ${tableMode === 'staff' && staffSubView === 'daily' ? 'bg-white/20 text-white' : 'bg-white text-slate-700 border border-slate-200/80 font-medium'}`}>
                    1–{matrixDays.length}d
                  </span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tableMode === 'branch' && branchSubView === 'daily'}
                  onClick={() => { handleTableModeChange('branch'); setBranchSubView('daily'); }}
                  className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${
                    tableMode === 'branch' && branchSubView === 'daily' ? 'text-white' : 'text-slate-700 hover:text-slate-900 font-medium'
                  }`}
                >
                  {tableMode === 'branch' && branchSubView === 'daily' && (
                    <PillMotion
                      layoutId="kpi-table-mode-pill"
                      transition={SPRING}
                      className="absolute inset-0 rounded-lg tab-active-blue shadow-2xs pointer-events-none"
                    />
                  )}
                  <Calendar className={`w-3.5 h-3.5 relative z-10 transition-colors ${tableMode === 'branch' && branchSubView === 'daily' ? 'text-white' : 'text-indigo-600'}`} aria-hidden />
                  <span className="relative z-10">Branch Daily Tasks</span>
                  <span className={`relative z-10 text-[10px] px-1.5 py-0.2 rounded-full font-figure tabular-nums ${tableMode === 'branch' && branchSubView === 'daily' ? 'bg-white/20 text-white' : 'bg-white text-slate-700 border border-slate-200/80 font-medium'}`}>
                    1–{matrixDays.length}d
                  </span>
                </button>
                
                </div>
              </div>

              <ExportCsvButton
                onExport={
                  tableMode === 'staff'
                    ? (staffSubView === 'daily' ? exportDailyStaffCsv : exportStaffCsv)
                    : branchSubView === 'daily'
                    ? exportDailyBranchCsv
                    : exportBranchCsv
                }
                toast={triggerToast}
                title={`Export ${
                  tableMode === 'staff'
                    ? (staffSubView === 'daily'
                        ? `Daily Tasks Matrix (${fmtMonth(dailyMatrixMonth)}) by Staff`
                        : 'KPI Performance by Staff')
                    : branchSubView === 'daily'
                    ? `Daily Tasks Matrix (${fmtMonth(dailyMatrixMonth)}) by Branch`
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
                    onChange={(e) => setDailyMatrixMonth(e.target.value)}
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
                <span
                  className="text-slate-600"
                  title="Weekends (Sat/Sun) and Cambodian public holidays are excluded from KPI work days"
                >
                  {tableMode === 'branch' ? (
                    <>
                      <strong className="font-semibold text-slate-800 tabular-nums">{filteredBranches.length}</strong> branches
                      <span className="mx-1.5 text-slate-300">·</span>
                      Target <strong className="font-semibold text-slate-800 tabular-nums">{fmtPts(activeTargets.staff)}</strong> pts/staff × active officers
                      <span className="text-slate-400 font-normal"> ({monthWorkDaysSummary.workDays} work days)</span>
                    </>
                  ) : (
                    <>
                      <strong className="font-semibold text-slate-800 tabular-nums">{filteredStaff.length}</strong> staff
                      <span className="mx-1.5 text-slate-300">·</span>
                      Target <strong className="font-semibold text-slate-800 tabular-nums">{fmtPts(activeTargets.staff)}</strong> pts/staff
                      <span className="text-slate-400 font-normal"> ({monthWorkDaysSummary.workDays} work days)</span>
                    </>
                  )}
                </span>
                {tableMode === 'staff' && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-500 font-medium">Level:</span>
                    <div className="inline-flex p-0.5 rounded-lg bg-slate-100 border border-slate-200 text-xs gap-0.5" role="tablist" aria-label="Staff level filter">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={staffLevelFilter === 'all'}
                        onClick={() => setStaffLevelFilter('all')}
                        className={`relative px-2 py-0.5 rounded-md text-[11px] font-semibold transition-colors cursor-pointer inline-flex items-center gap-1 ${
                          staffLevelFilter === 'all' ? 'text-white' : 'text-slate-700 hover:text-slate-900'
                        }`}
                      >
                        {staffLevelFilter === 'all' && (
                          <PillMotion
                            layoutId="kpi-staff-level-pill"
                            transition={SPRING}
                            className="absolute inset-0 rounded-md tab-active-blue shadow-2xs pointer-events-none"
                          />
                        )}
                        <span className={`w-1.5 h-1.5 rounded-full relative z-10 shrink-0 ${staffLevelFilter === 'all' ? 'bg-white' : 'bg-[#003857]'}`} aria-hidden />
                        <span className="relative z-10">All ({enrichedStaff.length})</span>
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={staffLevelFilter === 'field'}
                        onClick={() => setStaffLevelFilter('field')}
                        className={`relative px-2 py-0.5 rounded-md text-[11px] font-semibold transition-colors cursor-pointer inline-flex items-center gap-1 ${
                          staffLevelFilter === 'field' ? 'text-white' : 'text-slate-700 hover:text-slate-900'
                        }`}
                      >
                        {staffLevelFilter === 'field' && (
                          <PillMotion
                            layoutId="kpi-staff-level-pill"
                            transition={SPRING}
                            className="absolute inset-0 rounded-md tab-active-blue shadow-2xs pointer-events-none"
                          />
                        )}
                        <span className={`w-1.5 h-1.5 rounded-full relative z-10 shrink-0 ${staffLevelFilter === 'field' ? 'bg-white' : 'bg-emerald-500'}`} aria-hidden />
                        <span className="relative z-10">Field Officers ({enrichedStaff.filter((s) => !s.isManagement).length})</span>
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={staffLevelFilter === 'management'}
                        onClick={() => setStaffLevelFilter('management')}
                        className={`relative px-2 py-0.5 rounded-md text-[11px] font-semibold transition-colors cursor-pointer inline-flex items-center gap-1 ${
                          staffLevelFilter === 'management' ? 'text-white' : 'text-slate-700 hover:text-slate-900'
                        }`}
                        title="Management level staff (Branch Managers, Supervisors, Team Leads, Admins) who oversee operations and are exempt from field KPIs"
                      >
                        {staffLevelFilter === 'management' && (
                          <PillMotion
                            layoutId="kpi-staff-level-pill"
                            transition={SPRING}
                            className="absolute inset-0 rounded-md tab-active-blue shadow-2xs pointer-events-none"
                          />
                        )}
                        <span className={`w-1.5 h-1.5 rounded-full relative z-10 shrink-0 ${staffLevelFilter === 'management' ? 'bg-white' : 'bg-amber-500'}`} aria-hidden />
                        <span className="relative z-10">Management ({enrichedStaff.filter((s) => s.isManagement).length})</span>
                      </button>
                    </div>
                  </div>
                )}
                {tableMode === 'branch' && (
                  <span className="text-slate-400 text-[11px]">Click any branch row to view full details</span>
                )}
              </div>
            )}
          </div>

          {loading && !data ? (
            <div className="p-4">
              <KpiTableSkeleton rows={8} />
            </div>
          ) : (
            <div>
                {tableMode === 'branch' ? (
                  branchSubView === 'daily' ? (
                    <>
                      <div className="overflow-x-auto overflow-y-hidden w-full overscroll-x-contain">
                        <table className="kpi-matrix-table w-full text-left border-separate border-spacing-0 text-[13px]">
                          <thead>
                            <tr className="navy-header-bar bg-[#003857] text-white text-[11px] font-semibold uppercase tracking-wider select-none">
                              <th className="sticky left-0 bg-[#003857] z-30 px-2 py-2.5 text-center w-[36px] min-w-[36px] font-semibold text-[11px] text-white/90 border-b border-white/20">
                                No.
                              </th>
                              <th
                                className="sticky left-[36px] bg-[#003857] z-30 px-3 py-2.5 text-left w-[210px] min-w-[210px] cursor-pointer select-none hover:bg-white/10 transition-colors border-r border-slate-700/90 border-b border-white/20 shadow-[2px_0_4px_rgba(0,0,0,0.18)]"
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
                              sortedDailyBranchRows.slice(dailyBranchPg.start, dailyBranchPg.end).map((row, idx) => {
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
                                              className={`inline-flex items-center justify-center min-w-[24px] h-[21px] px-1 rounded text-[11px] tabular-nums font-normal ${
                                                isHol || isWk
                                                  ? 'bg-amber-100/80 text-amber-900 border border-amber-300 border-dashed'
                                                  : d.count >= 20
                                                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-300'
                                                  : d.count >= 10
                                                  ? 'bg-sky-50 text-sky-800 border border-sky-300'
                                                  : 'bg-slate-100 text-slate-800 border border-slate-200'
                                              }`}
                                            >
                                              {d.count}
                                            </span>
                                          ) : isHol ? (
                                            <span className="text-amber-500/70 text-[10px] select-none" title={dayMeta?.holidayName || 'Holiday'}>🎉</span>
                                          ) : (
                                            <span className="text-slate-300 text-xs font-light select-none">·</span>
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
                                  className="sticky left-0 bg-slate-100 z-10 px-3 py-2.5 text-left font-semibold text-slate-900 shadow-[2px_0_4px_rgba(0,0,0,0.06)] border-r border-slate-300"
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
                <div className="min-w-[1090px] w-full">
                <div className={`${KPI_BRANCH_GRID} glass-table-thead navy-header-bar bg-[#003857] text-white text-[11px] font-semibold uppercase tracking-wide px-3 py-2.5`}>
                  <span className="text-center text-white/80">No.</span>
                  <SortableHeader label="Branch" sortKey="branchName" activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} />
                  <SortableHeader label="Staff" sortKey="staffCount" activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader icon={<Cpu className="w-3.5 h-3.5 text-[#5cc8ff] shrink-0" aria-hidden />} label="POS" title={isTaskMode ? 'Sort by POS Tasks' : 'Sort by POS Points'} sortKey={isTaskMode ? 'posTasks' : 'posPoints'} activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader icon={<Volume2 className="w-3.5 h-3.5 text-[#a2a5e0] shrink-0" aria-hidden />} label="SB" title={isTaskMode ? 'Sort by Sound Box Tasks' : 'Sort by Sound Box Points'} sortKey={isTaskMode ? 'sbTasks' : 'sbPoints'} activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader icon={<QrCode className="w-3.5 h-3.5 text-[#74b9ff] shrink-0" aria-hidden />} label="KHQR" title={isTaskMode ? 'Sort by KHQR Tasks' : 'Sort by KHQR Points'} sortKey={isTaskMode ? 'khqrTasks' : 'khqrPoints'} activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader icon={<CreditCard className="w-3.5 h-3.5 text-amber-300 shrink-0" aria-hidden />} label="CC" title={isTaskMode ? 'Sort by Credit Card Tasks' : 'Sort by Credit Card Points'} sortKey={isTaskMode ? 'ccTasks' : 'ccPoints'} activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader icon={<ClipboardList className="w-3.5 h-3.5 text-[#52b788] shrink-0" aria-hidden />} label="MV" title={isTaskMode ? 'Sort by Merchant Visit Tasks' : 'Sort by Merchant Visit Points'} sortKey={isTaskMode ? 'mvTasks' : 'mvPoints'} activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader label="Avg" sortKey={isTaskMode ? 'tasksPerStaff' : 'ptsPerStaff'} activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" title={isTaskMode ? 'Average KPI tasks per active staff member in the branch' : 'Average KPI points per active staff member in the branch'} />
                  <SortableHeader label={isTaskMode ? 'Points' : 'Tasks'} sortKey={isTaskMode ? 'totalPoints' : 'totalTasks'} activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader label={isTaskMode ? 'Total Tasks' : 'Total Pts'} sortKey={isTaskMode ? 'totalTasks' : 'totalPoints'} activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" className="pr-1" />
                  <SortableHeader label="Target" title={activeTargets.label} sortKey="targetPct" activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} className="pl-2.5 pr-1.5" />
                  <span className="text-slate-200 pl-2">Status</span>
                  <span />
                </div>

                <div className="divide-y divide-slate-100">
                  {filteredBranches.length === 0 ? (
                    <div className="p-10 text-center text-sm text-slate-500">No branches match the current filters.</div>
                  ) : (
                    filteredBranches.slice(branchPg.start, branchPg.end).map((b, i) => {
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
                            <span className="text-center tabular-nums text-slate-700">{fmtPts(isTaskMode ? b.tasksPerStaff : b.ptsPerStaff)}</span>
                            <span className="text-center tabular-nums text-slate-600">
                              {isTaskMode ? `${fmtPts(b.totalPoints)}` : fmtInt(b.totalTasks)}
                            </span>
                            <span className="text-right tabular-nums font-figure font-semibold text-[#003857] whitespace-nowrap pr-1">
                              {isTaskMode ? `${fmtInt(b.totalTasks)} tasks` : `${fmtPts(b.totalPoints)} pts`}
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
                                          <span className="text-slate-900">{s.staffName}</span>{' '}
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
                  <tr className="navy-header-bar bg-[#003857] text-white text-[11px] font-semibold uppercase tracking-wider select-none">
                    <th className="sticky left-0 bg-[#003857] z-30 px-2 py-2.5 text-center w-[36px] min-w-[36px] font-semibold text-[11px] text-white/90 border-b border-white/20">
                      No.
                    </th>
                    <th
                      className="sticky left-[36px] bg-[#003857] z-30 px-3 py-2.5 text-left w-[205px] min-w-[205px] cursor-pointer select-none hover:bg-white/10 transition-colors border-b border-white/20"
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
                      className="sticky left-[241px] bg-[#003857] z-30 px-2.5 py-2.5 text-left w-[68px] min-w-[68px] cursor-pointer select-none hover:bg-white/10 transition-colors border-r border-slate-700/90 border-b border-white/20 shadow-[2px_0_4px_rgba(0,0,0,0.18)]"
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
                    sortedDailyStaffRows.slice(dailyStaffPg.start, dailyStaffPg.end).map((row, idx) => {
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
                                    className={`inline-flex items-center justify-center min-w-[24px] h-[21px] px-1 rounded text-[11px] tabular-nums font-normal ${
                                      isHol || isWk
                                        ? 'bg-amber-100/80 text-amber-900 border border-amber-300 border-dashed'
                                        : d.count >= 10
                                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-300'
                                        : d.count >= 5
                                        ? 'bg-sky-50 text-sky-800 border border-sky-300'
                                        : 'bg-slate-100 text-slate-800 border border-slate-200'
                                    }`}
                                  >
                                    {d.count}
                                  </span>
                                ) : isHol ? (
                                  <span className="text-amber-500/70 text-[10px] select-none" title={dayMeta?.holidayName || 'Holiday'}>🎉</span>
                                ) : (
                                  <span className="text-slate-300 text-xs font-light select-none">·</span>
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
                        className="sticky left-0 bg-slate-100 z-10 px-3 py-2.5 text-left font-semibold text-slate-900 shadow-[2px_0_4px_rgba(0,0,0,0.06)] border-r border-slate-300"
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
              <div className="min-w-[1128px] w-full">
                <div className={`${KPI_STAFF_GRID} glass-table-thead navy-header-bar bg-[#003857] text-white text-[11px] font-semibold uppercase tracking-wide px-3 py-2.5`}>
                  <span className="text-center text-white/80">No.</span>
                  <SortableHeader label="Staff" sortKey="staffName" activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} />
                  <SortableHeader label="Branch" sortKey="branchName" activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} />
                  <SortableHeader icon={<Cpu className="w-3.5 h-3.5 text-[#5cc8ff] shrink-0" aria-hidden />} label="POS" title={isTaskMode ? 'Sort by POS Tasks' : 'Sort by POS Points'} sortKey={isTaskMode ? 'posTasks' : 'posPoints'} activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader icon={<Volume2 className="w-3.5 h-3.5 text-[#a2a5e0] shrink-0" aria-hidden />} label="SB" title={isTaskMode ? 'Sort by Sound Box Tasks' : 'Sort by Sound Box Points'} sortKey={isTaskMode ? 'sbTasks' : 'sbPoints'} activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader icon={<QrCode className="w-3.5 h-3.5 text-[#74b9ff] shrink-0" aria-hidden />} label="KHQR" title={isTaskMode ? 'Sort by KHQR Tasks' : 'Sort by KHQR Points'} sortKey={isTaskMode ? 'khqrTasks' : 'khqrPoints'} activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader icon={<CreditCard className="w-3.5 h-3.5 text-amber-300 shrink-0" aria-hidden />} label="CC" title={isTaskMode ? 'Sort by Credit Card Tasks' : 'Sort by Credit Card Points'} sortKey={isTaskMode ? 'ccTasks' : 'ccPoints'} activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader icon={<ClipboardList className="w-3.5 h-3.5 text-[#52b788] shrink-0" aria-hidden />} label="MV" title={isTaskMode ? 'Sort by Merchant Visit Tasks' : 'Sort by Merchant Visit Points'} sortKey={isTaskMode ? 'mvTasks' : 'mvPoints'} activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader label={isTaskMode ? 'Points' : 'Tasks'} sortKey={isTaskMode ? 'totalPoints' : 'totalTasks'} activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader label={isTaskMode ? 'Total Tasks' : 'Total Pts'} sortKey={isTaskMode ? 'totalTasks' : 'totalPoints'} activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" className="pr-1" />
                  <SortableHeader label="Target" title={activeTargets.label} sortKey="targetPct" activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} className="pl-2.5 pr-1.5" />
                  <span className="text-slate-200 pl-2">Status</span>
                  <span />
                </div>

                <div className="divide-y divide-slate-100">
                  {filteredStaff.length === 0 ? (
                    <div className="p-10 text-center text-sm text-slate-500">No staff records match the current filters.</div>
                  ) : (
                    filteredStaff.slice(staffPg.start, staffPg.end).map((s, i) => {
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
                              <span className="block truncate text-slate-800 leading-snug">
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
                            <span className="text-right tabular-nums font-figure font-semibold text-[#003857] whitespace-nowrap pr-1">
                              {isTaskMode ? `${fmtInt(s.totalTasks)} tasks` : `${fmtPts(s.totalPoints)} pts`}
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

const TaskPtsCell: React.FC<{ tasks?: number; pts: number; mode?: KpiMetricMode }> = React.memo(({ tasks = 0, pts, mode = 'points' }) => {
  const isTasks = mode === 'tasks';
  const val = isTasks ? tasks : pts;
  if (val <= 0) {
    return <span className="text-slate-300 font-light block text-center w-full select-none">—</span>;
  }
  return (
    <span className="font-figure tabular-nums font-medium text-slate-800 block text-center w-full">
      {isTasks ? fmtInt(tasks) : fmtPts(pts)}
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
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
      <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/90 p-4 min-h-[340px] flex flex-col justify-between">
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
          {[45, 65, 80, 50, 92, 75, 60, 85, 95, 70].map((h, i) => (
            <div key={i} className="flex-1 flex flex-col gap-1 items-center h-full justify-end">
              <div className="skeleton w-full rounded-t-md" style={{ height: `${h}%` }} />
              <div className="skeleton h-2.5 w-6 rounded mt-1" />
            </div>
          ))}
        </div>
      </div>
      <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/90 p-4 min-h-[340px] flex flex-col justify-between">
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

const KpiTableSkeleton: React.FC<{ rows?: number }> = ({ rows = 8 }) => (
  <div className="divide-y divide-slate-100">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="px-4 py-3 flex items-center gap-4">
        <div className="skeleton h-3.5 w-6 rounded shrink-0" />
        <div className="skeleton w-7 h-7 rounded-lg shrink-0" />
        <div className="space-y-1 min-w-[140px] flex-1">
          <div className="skeleton h-3.5 w-32 rounded" />
          <div className="skeleton h-2.5 w-20 rounded" />
        </div>
        <div className="skeleton h-3.5 w-16 rounded shrink-0 hidden md:block" />
        <div className="skeleton h-3.5 w-20 rounded shrink-0 hidden md:block" />
        <div className="skeleton h-3.5 w-20 rounded shrink-0 hidden md:block" />
        <div className="skeleton h-3.5 w-20 rounded shrink-0 hidden md:block" />
        <div className="skeleton h-3.5 w-16 rounded shrink-0" />
        <div className="skeleton h-3.5 w-14 rounded shrink-0" />
        <div className="skeleton h-4 w-20 rounded-md shrink-0" />
      </div>
    ))}
  </div>
);

const BigKpiCard: React.FC<{
  label: string;
  value?: string;
  sub?: string;
  icon: React.ElementType;
  accentColor?: 'blue' | 'emerald' | 'amber' | 'violet';
  badge?: string;
  onClick?: () => void;
  active?: boolean;
}> = React.memo(({ label, value, sub, icon: Icon, accentColor = 'blue', badge, onClick, active }) => {
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
      className={`relative flex flex-col justify-between p-4.5 sm:p-5 rounded-2xl border bg-white shadow-2xs transition-all duration-200 text-left cursor-pointer min-h-[142px] hover:border-slate-300 hover:shadow-md hover:-translate-y-0.5 group ${
        active ? 'border-[#1e5b88] ring-2 ring-sky-100' : 'border-slate-200/90'
      }`}
    >
      <div className="flex items-center justify-between gap-2.5">
        <span className="text-[11.5px] font-semibold text-slate-600 uppercase tracking-wider truncate">
          {label}
        </span>
        <div className={`w-9.5 h-9.5 rounded-xl flex items-center justify-center border shrink-0 transition-transform group-hover:scale-105 ${theme.iconBg}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>

      <div className="my-2.5">
        <div className="font-figure text-[28px] font-bold tracking-tight tabular-nums leading-tight text-slate-900 truncate">
          {value === undefined ? '—' : value}
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
  const cells = [
    { label: 'POS Install', n: raw.posInstall, pts: raw.posInstall * rulePts(ruleMap, 'POS_INSTALL') },
    { label: 'POS Replace', n: raw.posReplace, pts: raw.posReplace * rulePts(ruleMap, 'POS_REPLACE') },
    { label: 'POS Battery', n: raw.posBattery, pts: raw.posBattery * rulePts(ruleMap, 'POS_BATTERY') },
    { label: 'POS Op. Support', n: posOpMaint, pts: posOpMaint * rulePts(ruleMap, 'POS_MAINT') },
    { label: 'SB Install', n: raw.sbInstall, pts: raw.sbInstall * rulePts(ruleMap, 'SB_INSTALL') },
    { label: 'SB Replace', n: raw.sbReplace, pts: raw.sbReplace * rulePts(ruleMap, 'SB_REPLACE') },
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
    if (!n || code === 'POS_MAINT') continue;
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

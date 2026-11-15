import React, { useState, useMemo, useEffect, useCallback, useRef, useId } from 'react';
import { useKeptMemo } from '../utils/useKeptMemo';
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
import {
  CrossChannelVelocityChart,
  CrossChannelDayPoint,
  CHANNEL_COLORS,
  buildAnnularArcPath,
  type VelocityChannelKey,
} from './Charts';
import { Odometer } from './Odometer';
import { PillMotion } from './PillMotion';
import { todayPP, lastMonthsPP } from '../utils/time';
import { fmtNum } from '../utils/format';
import { SPRING_TAB_PILL } from '../utils/animationRules';
import { buildPpDirectoryScope } from '../utils/fieldScope';
import { isSupabaseConfigured } from '../lib/supabase';
import { getCachedStaff, loadStaff, onStaffList } from '../services/staffCache';
import { getCachedAudit } from '../services/auditCache';
import { getPerfSnapshot, percentile } from '../utils/perfMonitor';
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
  type MaterialCode,
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
  Activity,
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

type TrendDirection = 'up' | 'down' | 'flat';

interface KpiSparkSummary {
  values: number[];
  direction: TrendDirection;
  badgeText: string;
  colorHex: string;
  tooltip: string;
}

function analyzeSparkTrend(
  rawValues: number[],
  options: { invertSentiment?: boolean; isLight?: boolean; unitLabel?: string } = {}
): KpiSparkSummary {
  const { invertSentiment = false, isLight = true, unitLabel = 'period' } = options;
  const values = rawValues.length >= 2 ? rawValues : rawValues.length === 1 ? [rawValues[0], rawValues[0]] : [0, 0];
  const n = values.length;
  const split = Math.max(1, Math.floor(n / 2));
  const firstSlice = values.slice(0, split);
  const secondSlice = values.slice(split);
  const prevAvg = firstSlice.reduce((s, v) => s + v, 0) / Math.max(1, firstSlice.length);
  const currAvg = secondSlice.reduce((s, v) => s + v, 0) / Math.max(1, secondSlice.length);
  const diff = currAvg - prevAvg;
  const eps = Math.max(0.01, Math.max(prevAvg, currAvg) * 0.002);

  let direction: TrendDirection = 'flat';
  if (diff > eps) direction = 'up';
  else if (diff < -eps) direction = 'down';

  let badgeText = '0.0%';
  if (direction !== 'flat') {
    if (prevAvg <= 0.5 && currAvg > 0) {
      badgeText = currAvg >= 1000 ? `+${(diff / 1000).toFixed(1)}k` : `+${fmtNum(Math.round(diff))}`;
    } else {
      const pct = ((currAvg - prevAvg) / Math.max(1, prevAvg)) * 100;
      const absPct = Math.abs(pct);
      if (absPct > 999) {
        badgeText = `${diff > 0 ? '+' : '-'}${Math.abs(diff) >= 1000 ? `${(Math.abs(diff) / 1000).toFixed(1)}k` : fmtNum(Math.round(Math.abs(diff)))}`;
      } else {
        badgeText = `${pct > 0 ? '+' : ''}${absPct >= 10 ? pct.toFixed(0) : pct.toFixed(1)}%`;
      }
    }
  }

  const upGoodHex = isLight ? '#2d6a4f' : '#34d399';
  const badHex = isLight ? '#e11d48' : '#fb7185';
  const flatHex = isLight ? '#64748b' : '#94a3b8';

  const colorHex =
    direction === 'flat'
      ? flatHex
      : invertSentiment
        ? direction === 'up'
          ? badHex
          : upGoodHex
        : direction === 'up'
          ? upGoodHex
          : badHex;

  const dirWord = direction === 'up' ? 'Increased' : direction === 'down' ? 'Decreased' : 'Steady';
  return {
    values,
    direction,
    badgeText,
    colorHex,
    tooltip: `${dirWord} ${badgeText} (${unitLabel} trajectory)`,
  };
}

function buildSmoothSparkPaths(values: number[], width = 100, height = 36): {
  linePath: string;
  areaPath: string;
  lastX: number;
  lastY: number;
} {
  const padX = 3;
  const padTop = 5;
  const padBottom = 4;
  const innerW = width - padX * 2;
  const innerH = height - padTop - padBottom;
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const span = maxVal - minVal;

  const pts = values.map((v, idx) => {
    const x = padX + (values.length <= 1 ? innerW : (idx / (values.length - 1)) * innerW);
    const norm = span > 0 ? (v - minVal) / span : v > 0 ? 0.5 : 0.15;
    const y = padTop + (1 - norm) * innerH;
    return { x, y };
  });

  if (pts.length === 0) {
    return { linePath: '', areaPath: '', lastX: padX, lastY: height - padBottom };
  }
  if (pts.length === 1) {
    const p = pts[0];
    return {
      linePath: `M ${p.x.toFixed(1)} ${p.y.toFixed(1)} L ${(width - padX).toFixed(1)} ${p.y.toFixed(1)}`,
      areaPath: `M ${p.x.toFixed(1)} ${height} L ${p.x.toFixed(1)} ${p.y.toFixed(1)} L ${(width - padX).toFixed(1)} ${p.y.toFixed(1)} L ${(width - padX).toFixed(1)} ${height} Z`,
      lastX: width - padX,
      lastY: p.y,
    };
  }

  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  const clampY = (y: number) => Math.max(padTop, Math.min(height - padBottom, y));
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = clampY(p1.y + (p2.y - p0.y) / 6);
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = clampY(p2.y - (p3.y - p1.y) / 6);
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }

  const first = pts[0];
  const last = pts[pts.length - 1];
  const areaPath = `${d} L ${last.x.toFixed(2)} ${height} L ${first.x.toFixed(2)} ${height} Z`;
  return { linePath: d, areaPath, lastX: last.x, lastY: last.y };
}

const KpiMiniSparkline: React.FC<{
  metricId: string;
  summary: KpiSparkSummary;
  cardBgHex: string;
}> = React.memo(({ metricId, summary, cardBgHex }) => {
  const reactId = useId();
  const gradId = `kpi-spark-${metricId}-${reactId.replace(/:/g, '')}`;
  const { linePath, areaPath, lastX, lastY } = useMemo(
    () => buildSmoothSparkPaths(summary.values, 100, 36),
    [summary.values]
  );

  return (
    <svg
      viewBox="0 0 100 36"
      className="w-[88px] sm:w-[98px] h-[36px] shrink-0 overflow-visible select-none"
      data-kpi-sparkline={metricId}
      aria-label={summary.tooltip}
      role="img"
    >
      <title>{summary.tooltip}</title>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={summary.colorHex} stopOpacity={0.28} />
          <stop offset="100%" stopColor={summary.colorHex} stopOpacity={0.01} />
        </linearGradient>
      </defs>
      {areaPath && <path d={areaPath} fill={`url(#${gradId})`} />}
      {linePath && (
        <path
          d={linePath}
          fill="none"
          stroke={summary.colorHex}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={summary.direction === 'flat' ? '3 3' : undefined}
        />
      )}
      <circle
        cx={lastX}
        cy={lastY}
        r={3}
        fill={summary.colorHex}
        stroke={cardBgHex}
        strokeWidth={1.5}
      />
    </svg>
  );
});

const DONUT_RADIUS = 116;
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

const CM_VB_W = 428;
const CM_VB_H = 342;
const CM_CX = CM_VB_W / 2;
const CM_CY = CM_VB_H / 2 + 1;
const CM_R_TICK = 122;
const CM_R_TRACK = 91;
const CM_TRACK_W = 38;

interface ChannelCalloutLayout {
  slice: ChannelSliceItem;
  side: 'left' | 'right';
  sx: number;
  sy: number;
  mx: number;
  my: number;
  ex: number;
  ey: number;
}

function formatChannelLabel(shortLabel: string): string {
  if (shortLabel === 'Visit') return 'Merchant Visit';
  if (shortLabel === 'CC') return 'Credit Card';
  if (shortLabel === 'POS') return 'POS Terminal';
  return shortLabel;
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

  const activeSlices = useMemo(() => donutSlices.filter((s) => s.dash > 0), [donutSlices]);

  const formatSliceCount = (slice: ChannelSliceItem) =>
    slice.id === 'cc' && ccSubmittedShow > 0
      ? `${fmtNum(slice.primaryValue)}/${fmtNum(ccSubmittedShow)}`
      : fmtNum(slice.primaryValue);

  const focusedAccent = focusedChannel
    ? !isLight && focusedChannel.id === 'khqr'
      ? '#38bdf8'
      : focusedChannel.hexColor
    : '#1e6091';

  const calloutLayouts = useMemo<ChannelCalloutLayout[]>(() => {
    const items = donutSlices.map((slice, idx) => {
      const hasSlice = totalTasks > 0 && slice.dash > 0;
      const midAngle = hasSlice
        ? -Math.PI / 2 + ((slice.offset + slice.dash * 0.5) / DONUT_CIRC) * Math.PI * 2
        : -Math.PI / 2 + (idx / Math.max(1, donutSlices.length)) * Math.PI * 2;
      const anchorR = hasSlice ? 108 : CM_R_TICK - 2;
      return {
        slice,
        midAngle,
        sx: CM_CX + anchorR * Math.cos(midAngle),
        sy: CM_CY + anchorR * Math.sin(midAngle),
        side: (Math.cos(midAngle) >= 0 ? 'right' : 'left') as 'left' | 'right',
        targetY: CM_CY + (CM_R_TICK + 28) * Math.sin(midAngle),
      };
    });

    // Balance sides if >= 4 callouts land on one hemisphere (e.g. KHQR > 50% dominates right+bottom).
    const leftItems = items.filter((it) => it.side === 'left');
    const rightItems = items.filter((it) => it.side === 'right');
    if (leftItems.length >= 4 && rightItems.length <= 1) {
      const topMost = [...leftItems].sort((a, b) => Math.abs(Math.cos(a.midAngle)) - Math.abs(Math.cos(b.midAngle)))[0];
      if (topMost) {
        topMost.side = 'right';
        topMost.targetY = topMost.sy < CM_CY ? 20 : CM_VB_H - 20;
      }
    } else if (rightItems.length >= 4 && leftItems.length <= 1) {
      const topMost = [...rightItems].sort((a, b) => Math.abs(Math.cos(a.midAngle)) - Math.abs(Math.cos(b.midAngle)))[0];
      if (topMost) {
        topMost.side = 'left';
        topMost.targetY = topMost.sy < CM_CY ? 20 : CM_VB_H - 20;
      }
    }

    const CALLOUT_H = 26;
    const MIN_GAP = 48;
    const Y_MIN = 20;
    const Y_MAX = CM_VB_H - 20;

    const placeSide = (side: 'left' | 'right'): ChannelCalloutLayout[] => {
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
          ey + CALLOUT_H / 2 < CM_CY
            ? CM_CY - (ey + CALLOUT_H / 2)
            : ey - CALLOUT_H / 2 > CM_CY
              ? ey - CALLOUT_H / 2 - CM_CY
              : 0;
        const minRingR = CM_R_TICK + 6;
        const clearDx =
          dyNearest >= minRingR
            ? 30
            : Math.sqrt(Math.max(0, minRingR * minRingR - dyNearest * dyNearest));
        const rawEx = side === 'left' ? CM_CX - clearDx - 4 : CM_CX + clearDx + 4;
        const ex =
          side === 'left'
            ? Math.max(88, Math.min(CM_CX - 30, rawEx))
            : Math.min(CM_VB_W - 88, Math.max(CM_CX + 30, rawEx));
        const mx = CM_CX + (CM_R_TICK + 6) * Math.cos(g.midAngle);
        const my = CM_CY + (CM_R_TICK + 6) * Math.sin(g.midAngle);
        return {
          slice: g.slice,
          side,
          sx: g.sx,
          sy: g.sy,
          mx,
          my,
          ex,
          ey,
        };
      });
    };

    return [...placeSide('left'), ...placeSide('right')];
  }, [donutSlices, totalTasks]);

  return (
    <section className={`lg:col-span-4 ${cardClass} overflow-hidden flex flex-col justify-between`}>
      <div className="px-5 pt-4 pb-1 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className={`text-sm sm:text-[14.5px] font-bold tracking-tight truncate ${isLight ? 'text-slate-900' : 'text-white'}`}>
            Channel Mix
          </h3>
          <p className="text-[11.5px] text-slate-500 truncate">
            5-channel share
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`text-[10.5px] font-figure font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
              isLight ? 'bg-slate-100/90 text-slate-600' : 'bg-slate-800 text-slate-300'
            }`}
          >
            {fmtNum(totalTasks)} tasks
          </span>
          {onNavigateTab && (
            <button
              type="button"
              onClick={() => onNavigateTab('kpi_performance')}
              className={`text-[11.5px] font-semibold inline-flex items-center gap-0.5 shrink-0 cursor-pointer transition-colors duration-150 ${
                isLight ? 'text-[#004e75] hover:text-[#003857]' : 'text-sky-400 hover:text-sky-300'
              }`}
            >
              Full KPI <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="px-2 sm:px-3 pt-1 pb-2 flex-1 flex items-center justify-center">
        {/* Enlarged Precision Donut Ring + Radial Callout Leaders (no bottom bar list) */}
        <div className="relative w-full max-w-[448px] aspect-[428/342] flex items-center justify-center">
          <svg
            viewBox={`0 0 ${CM_VB_W} ${CM_VB_H}`}
            className="w-full h-full overflow-visible"
            role="img"
            aria-label="5-Channel Performance Donut Chart"
            data-testid="channel-mix-donut"
          >
            {/* Outer precision gauge tick bezel */}
            <circle
              cx={CM_CX}
              cy={CM_CY}
              r={CM_R_TICK}
              fill="none"
              stroke={isLight ? 'rgba(15, 23, 42, 0.13)' : 'rgba(148, 163, 184, 0.22)'}
              strokeWidth="2.5"
              strokeDasharray="1.5 11.33"
            />

            {/* Recessed donut track */}
            <circle
              cx={CM_CX}
              cy={CM_CY}
              r={CM_R_TRACK}
              fill="none"
              stroke={isLight ? 'rgba(15, 23, 42, 0.045)' : 'rgba(148, 163, 184, 0.12)'}
              strokeWidth={CM_TRACK_W}
            />

            {/* Sculpted separated annular sectors */}
            {totalTasks > 0 && activeSlices.length === 1 && (
              <circle
                data-donut-slice={activeSlices[0].id}
                cx={CM_CX}
                cy={CM_CY}
                r={CM_R_TRACK}
                fill="none"
                stroke={activeSlices[0].hexColor}
                strokeWidth={hoveredChannelId === activeSlices[0].id ? CM_TRACK_W + 5 : CM_TRACK_W}
                className="cursor-pointer transition-all duration-150"
                onMouseEnter={() => setHoveredChannelId(activeSlices[0].id)}
                onMouseLeave={() => setHoveredChannelId(null)}
                onClick={() => onNavigateTab?.(activeSlices[0].tab)}
              />
            )}

            {totalTasks > 0 &&
              activeSlices.length > 1 &&
              activeSlices.map((slice) => {
                const isFocused = focusedChannel?.id === slice.id && hoveredChannelId === slice.id;
                const isDimmed = hoveredChannelId !== null && hoveredChannelId !== slice.id;
                const spanRad = (slice.dash / DONUT_CIRC) * Math.PI * 2;
                const gapTrim = Math.min(0.032, spanRad * 0.22);
                const startRad = -Math.PI / 2 + (slice.offset / DONUT_CIRC) * Math.PI * 2 + gapTrim / 2;
                const endRad = startRad + spanRad - gapTrim;
                const rInner = isFocused ? 68 : 72;
                const rOuter = isFocused ? 116 : 111;
                const d = buildAnnularArcPath(CM_CX, CM_CY, rInner, rOuter, startRad, endRad);
                return (
                  <path
                    key={slice.id}
                    data-donut-slice={slice.id}
                    d={d}
                    fill={slice.hexColor}
                    opacity={isDimmed ? 0.32 : 1}
                    style={{
                      filter: isFocused ? `drop-shadow(0 4px 10px ${slice.hexColor}55)` : undefined,
                      transition: 'opacity 150ms ease, filter 150ms ease',
                    }}
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredChannelId(slice.id)}
                    onMouseLeave={() => setHoveredChannelId(null)}
                    onClick={() => onNavigateTab?.(slice.tab)}
                  >
                    <title>{`${slice.label}: ${fmtNum(slice.primaryValue)} (${slice.sharePct}%)`}</title>
                  </path>
                );
              })}

            {/* Thin elbow leader lines to perimeter channel callouts */}
            {calloutLayouts.map((c) => {
              const isHovered = hoveredChannelId === c.slice.id;
              const isDimmed = hoveredChannelId !== null && hoveredChannelId !== c.slice.id;
              const lineColor = !isLight && c.slice.id === 'khqr' ? '#38bdf8' : c.slice.hexColor;
              return (
                <g
                  key={`leader-${c.slice.id}`}
                  opacity={isDimmed ? 0.25 : isHovered ? 1 : 0.78}
                  style={{ transition: 'opacity 150ms ease' }}
                >
                  <polyline
                    points={`${c.sx.toFixed(1)},${c.sy.toFixed(1)} ${c.mx.toFixed(1)},${c.my.toFixed(1)} ${c.ex.toFixed(1)},${c.ey.toFixed(1)}`}
                    fill="none"
                    stroke={lineColor}
                    strokeWidth={isHovered ? 1.8 : 1.15}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle
                    cx={c.ex}
                    cy={c.ey}
                    r={isHovered ? 3 : 2.25}
                    fill={lineColor}
                    stroke={isLight ? '#ffffff' : '#0f172a'}
                    strokeWidth="1"
                  />
                </g>
              );
            })}

            {/* Elevated central frosted hub ring */}
            <circle
              cx={CM_CX}
              cy={CM_CY}
              r={64}
              fill={isLight ? '#ffffff' : '#0f172a'}
              stroke={isLight ? 'rgba(15, 23, 42, 0.07)' : 'rgba(148, 163, 184, 0.16)'}
              strokeWidth="1.25"
            />
          </svg>

          {/* Center Interactive Focus Readout */}
          <div
            className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center pointer-events-none text-center px-2"
            style={{
              left: `${(CM_CX / CM_VB_W) * 100}%`,
              top: `${(CM_CY / CM_VB_H) * 100}%`,
              width: `${((64 * 1.72) / CM_VB_W) * 100}%`,
            }}
          >
            <span
              className={`inline-flex items-center gap-1 text-[9.5px] font-bold tracking-wider uppercase truncate max-w-full ${
                isLight ? 'text-slate-500' : 'text-slate-400'
              }`}
            >
              {focusedChannel && (
                <i
                  className="w-1.5 h-1.5 rounded-full inline-block shrink-0"
                  style={{ backgroundColor: focusedAccent }}
                />
              )}
              {focusedChannel ? formatChannelLabel(focusedChannel.shortLabel) : 'NO TASKS'}
            </span>
            <span
              className={`text-[26px] sm:text-[29px] font-bold font-figure leading-none tracking-tight mt-1 tabular-nums ${
                isLight ? 'text-slate-900' : 'text-white'
              }`}
            >
              {focusedChannel ? `${focusedChannel.sharePct}%` : '0%'}
            </span>
            {focusedChannel && totalTasks > 0 && (
              <span
                className="text-[10px] font-figure font-semibold px-2 py-0.5 rounded-full mt-1.5 tabular-nums whitespace-nowrap"
                style={{
                  color: focusedAccent,
                  backgroundColor: isLight ? `${focusedAccent}14` : `${focusedAccent}28`,
                }}
              >
                {formatSliceCount(focusedChannel)} tasks
              </span>
            )}
          </div>

          {/* 5 Perimeter Callout Badges (aligned directly to leader endpoints) */}
          {calloutLayouts.map((c) => {
            const isHovered = hoveredChannelId === c.slice.id;
            const isDimmed = hoveredChannelId !== null && hoveredChannelId !== c.slice.id;
            const label = formatChannelLabel(c.slice.shortLabel);
            const accent = !isLight && c.slice.id === 'khqr' ? '#38bdf8' : c.slice.hexColor;
            const posStyle: React.CSSProperties =
              c.side === 'left'
                ? {
                    right: `${((CM_VB_W - (c.ex - 4)) / CM_VB_W) * 100}%`,
                    top: `${(c.ey / CM_VB_H) * 100}%`,
                    transform: 'translateY(-50%)',
                  }
                : {
                    left: `${((c.ex + 4) / CM_VB_W) * 100}%`,
                    top: `${(c.ey / CM_VB_H) * 100}%`,
                    transform: 'translateY(-50%)',
                  };

            return (
              <button
                key={c.slice.id}
                type="button"
                data-donut-callout={c.slice.id}
                aria-label={`${label}: ${c.slice.sharePct}%, ${formatSliceCount(c.slice)}`}
                onMouseEnter={() => setHoveredChannelId(c.slice.id)}
                onMouseLeave={() => setHoveredChannelId(null)}
                onFocus={() => setHoveredChannelId(c.slice.id)}
                onBlur={() => setHoveredChannelId(null)}
                onClick={() => onNavigateTab?.(c.slice.tab)}
                style={{
                  ...posStyle,
                  ...(isHovered
                    ? {
                        borderColor: `${accent}55`,
                        backgroundColor: isLight ? `${accent}10` : `${accent}24`,
                      }
                    : undefined),
                }}
                className={`absolute px-1 py-0.5 rounded-md border transition-all duration-150 cursor-pointer flex flex-col leading-tight ${
                  c.side === 'left' ? 'items-end text-right' : 'items-start text-left'
                } ${
                  isHovered
                    ? isLight
                      ? 'shadow-2xs'
                      : 'shadow-sm'
                    : isLight
                      ? 'border-transparent hover:bg-slate-50/90'
                      : 'border-transparent hover:bg-slate-800/70'
                } ${isDimmed ? 'opacity-40' : ''}`}
              >
                <span
                  className={`inline-flex items-center gap-1 text-[9.5px] sm:text-[10px] font-semibold whitespace-nowrap ${
                    isLight ? 'text-slate-800' : 'text-slate-100'
                  }`}
                >
                  {c.side === 'right' && (
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: accent }} />
                  )}
                  <span>{label}</span>
                  {c.side === 'left' && (
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: accent }} />
                  )}
                </span>
                <span
                  className={`text-[9px] sm:text-[9.5px] font-figure font-semibold tabular-nums whitespace-nowrap ${
                    isLight ? 'text-slate-500' : 'text-slate-400'
                  }`}
                >
                  <strong className={isLight ? 'text-slate-900 font-bold' : 'text-white font-bold'}>
                    {c.slice.sharePct}%
                  </strong>{' '}
                  · {formatSliceCount(c.slice)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
});

interface TopBranchesCardProps {
  isLight: boolean;
  cardClass: string;
  activePeriodLabel: string;
  branches: BranchPerfRow[];
  maxBranchTasks: number;
  onNavigateTab?: (tab: string) => void;
}

const TopBranchesCard = React.memo<TopBranchesCardProps>(({
  isLight,
  cardClass,
  activePeriodLabel,
  branches,
  maxBranchTasks,
  onNavigateTab,
}) => {
  const [hoveredBranchCode, setHoveredBranchCode] = useState<string | null>(null);
  const hoveredBranch = useMemo(
    () => (hoveredBranchCode ? branches.find((b) => b.code === hoveredBranchCode) || null : null),
    [hoveredBranchCode, branches]
  );

  return (
    <section className={`lg:col-span-8 ${cardClass} overflow-hidden flex flex-col`}>
      <div className="px-6 pt-5 pb-3 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
              isLight ? 'bg-indigo-500/15 text-indigo-600' : 'bg-indigo-500/20 text-indigo-300'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h3 className={`text-sm sm:text-[15px] font-bold tracking-tight truncate ${isLight ? 'text-slate-900' : 'text-white'}`}>
              Top Branches — Visual Performance Graph
            </h3>
            <p className="text-xs text-slate-500 truncate">
              {activePeriodLabel} stacked cross-channel output · hover or click bar for detail
            </p>
          </div>
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

      <div className="flex-1 flex flex-col justify-between px-6 pb-5 pt-1 gap-3">
        <div className={`flex flex-wrap items-center justify-between gap-2 text-[11px] pb-2.5 border-b ${isLight ? 'border-slate-100' : 'border-slate-800'}`}>
          <div className="flex flex-wrap items-center gap-3 text-slate-500">
            <span className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: CHANNEL_COLORS.khqr }} />KHQR</span>
            <span className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: CHANNEL_COLORS.sb }} />Sound Box</span>
            <span className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: CHANNEL_COLORS.pos }} />POS Terminal</span>
            <span className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: CHANNEL_COLORS.mv }} />Merchant Visit</span>
            <span className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: CHANNEL_COLORS.cc }} />Credit Card</span>
          </div>
          <div className="text-[11px] font-medium text-slate-500 truncate max-w-full">
            {hoveredBranch ? (
              <span className="font-figure text-slate-700">
                <strong className="text-slate-900">Code {hoveredBranch.code}</strong> ·{' '}
                KHQR {fmtNum(hoveredBranch.khqr)} · POS Terminal {fmtNum(hoveredBranch.pos)} · Sound Box {fmtNum(hoveredBranch.sb)} ·{' '}
                Merchant Visit {fmtNum(hoveredBranch.mv)} · Credit Card {fmtNum(hoveredBranch.cc)} · Reserve {fmtNum(hoveredBranch.reserve)}
              </span>
            ) : (
              <span>Top {branches.length} Phnom Penh branches · scaled to peak branch</span>
            )}
          </div>
        </div>

        {branches.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-400">
            No branch activity found for the selected scope.
          </div>
        ) : (
          <div className="space-y-2 flex-1 flex flex-col justify-center">
            {branches.map((b, i) => {
              const totalBarPct = b.totalTasks > 0 ? Math.max(1.5, (b.totalTasks / maxBranchTasks) * 100) : 0;
              const brTot = Math.max(1, b.totalTasks);
              const segs = [
                { key: 'khqr', val: b.khqr, color: CHANNEL_COLORS.khqr },
                { key: 'sb', val: b.sb, color: CHANNEL_COLORS.sb },
                { key: 'pos', val: b.pos, color: CHANNEL_COLORS.pos },
                { key: 'mv', val: b.mv, color: CHANNEL_COLORS.mv },
                { key: 'cc', val: b.cc, color: CHANNEL_COLORS.cc },
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
                  title={`${b.name} (Code ${b.code}) — Total: ${fmtNum(b.totalTasks)} · KHQR ${fmtNum(b.khqr)} · POS Terminal ${fmtNum(b.pos)} · Sound Box ${fmtNum(b.sb)} · Merchant Visit ${fmtNum(b.mv)} · Credit Card ${fmtNum(b.cc)} · Reserve ${fmtNum(b.reserve)}`}
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
                  <div className="w-[175px] sm:w-[232px] xl:w-[248px] shrink-0 text-left flex items-center gap-2 min-w-0">
                    <span
                      className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-figure font-bold shrink-0 ${
                        i === 0
                          ? 'bg-[#1e6091] text-white'
                          : i < 3
                          ? 'bg-slate-200/80 text-slate-700'
                          : 'text-slate-400'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className={`text-[12px] font-semibold group-hover:text-[#1e6091] transition-colors truncate ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                      {b.name}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400 shrink-0 hidden sm:inline">
                      Code {b.code}
                    </span>
                  </div>

                  <div className="flex-1 h-2.5 rounded-full overflow-hidden flex items-center">
                    {totalBarPct > 0 && (
                      <div
                        className="h-full rounded-full overflow-hidden flex gap-px transition-[width] duration-200"
                        style={{ width: `${totalBarPct}%` }}
                      >
                        {segs.map((seg) => (
                          <div
                            key={seg.key}
                            className="h-full"
                            style={{ width: `${(seg.val / brTot) * 100}%`, backgroundColor: seg.color }}
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
    </section>
  );
});

type FocusedVelocityChannel = Exclude<VelocityChannelKey, 'ALL'>;

const VELOCITY_DOCK_CHANNELS: ReadonlyArray<{
  key: FocusedVelocityChannel;
  label: string;
  color: string;
}> = [
  { key: 'khqr', label: 'KHQR', color: CHANNEL_COLORS.khqr },
  { key: 'sb', label: 'Sound Box', color: CHANNEL_COLORS.sb },
  { key: 'pos', label: 'POS Terminal', color: CHANNEL_COLORS.pos },
  { key: 'mv', label: 'Merchant Visit', color: CHANNEL_COLORS.mv },
  { key: 'cc', label: 'Credit Card', color: CHANNEL_COLORS.cc },
];

function computeVelocityPrimaryMeta(
  series: CrossChannelDayPoint[],
  focusChannel: VelocityChannelKey,
  allPeak: { peakVal: number; peakLabel: string },
  isLight: boolean
) {
  if (focusChannel === 'ALL') {
    return {
      label: 'Total Volume',
      color: isLight ? CHANNEL_COLORS.khqr : '#38bdf8',
      peakVal: allPeak.peakVal,
      peakLabel: allPeak.peakLabel,
    };
  }
  const meta = VELOCITY_DOCK_CHANNELS.find((c) => c.key === focusChannel)!;
  let peakVal = 0;
  let peakLabel = '';
  for (const pt of series) {
    if (pt.isFuture) continue;
    const v = pt[focusChannel];
    if (v > peakVal) {
      peakVal = v;
      peakLabel = pt.label;
    }
  }
  return {
    label: meta.label,
    color: meta.color,
    peakVal,
    peakLabel,
  };
}

interface VelocityChannelDockProps {
  isLight: boolean;
  series: CrossChannelDayPoint[];
  totals: Record<FocusedVelocityChannel, number>;
  totalTasks: number;
  selectedChannel: VelocityChannelKey;
  onSelectChannel: (channel: VelocityChannelKey) => void;
}

const VelocityChannelDock = React.memo<VelocityChannelDockProps>(({
  isLight,
  series,
  totals,
  totalTasks,
  selectedChannel,
  onSelectChannel,
}) => {
  const reactId = useId();
  const nonFutureSeries = useMemo(() => series.filter((pt) => !pt.isFuture), [series]);

  const dockItems = useMemo(
    () =>
      VELOCITY_DOCK_CHANNELS.map((ch) => {
        const count = totals[ch.key];
        const sharePct = totalTasks > 0 ? Number(((count / totalTasks) * 100).toFixed(1)) : 0;
        const rawVals = nonFutureSeries.map((pt) => pt[ch.key]);
        const sparkVals =
          rawVals.length >= 2 ? rawVals : rawVals.length === 1 ? [rawVals[0], rawVals[0]] : [0, 0];
        return {
          ...ch,
          count,
          sharePct,
          paths: buildSmoothSparkPaths(sparkVals, 46, 18),
        };
      }),
    [nonFutureSeries, totals, totalTasks]
  );

  return (
    <div
      data-velocity-channel-dock="true"
      role="group"
      aria-label="Filter velocity trend by channel"
      className={`grid grid-cols-2 sm:grid-cols-5 gap-1.5 pt-2.5 border-t ${
        isLight ? 'border-slate-100' : 'border-slate-800/80'
      }`}
    >
      {dockItems.map((ch) => {
        const isSelected = selectedChannel === ch.key;
        const isDimmed = selectedChannel !== 'ALL' && !isSelected;
        const gradId = `vel-dock-${reactId}-${ch.key}`;
        return (
          <button
            key={ch.key}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelectChannel(isSelected ? 'ALL' : ch.key)}
            className={`group text-left rounded-xl px-2 py-2 border transition-all duration-150 cursor-pointer flex flex-col justify-between gap-1.5 min-w-0 ${
              isSelected
                ? isLight
                  ? 'shadow-xs'
                  : 'shadow-sm'
                : isLight
                  ? 'bg-slate-50/75 hover:bg-slate-50 border-slate-200/70 hover:border-slate-300/80'
                  : 'bg-slate-800/45 hover:bg-slate-800/75 border-slate-700/60 hover:border-slate-600'
            } ${isDimmed ? 'opacity-60 hover:opacity-100' : ''}`}
            style={
              isSelected
                ? {
                    borderColor: ch.color,
                    backgroundColor: isLight ? `${ch.color}12` : `${ch.color}24`,
                  }
                : undefined
            }
          >
            <div className="flex items-center justify-between gap-1 min-w-0">
              <span
                className={`inline-flex items-center gap-1.5 text-[10.5px] font-semibold min-w-0 ${
                  isLight ? 'text-slate-700' : 'text-slate-200'
                }`}
              >
                <i
                  className="w-2 h-2 rounded-full inline-block shrink-0"
                  style={{ backgroundColor: ch.color }}
                />
                <span className="truncate">{ch.label}</span>
              </span>
            </div>

            <div className="flex items-end justify-between gap-1.5 min-w-0">
              <div className="min-w-0 flex items-baseline gap-1.5 flex-wrap">
                <span
                  className={`text-[15px] font-bold font-figure leading-none tabular-nums ${
                    isLight ? 'text-slate-900' : 'text-white'
                  }`}
                >
                  {fmtNum(ch.count)}
                </span>
                <span
                  className={`text-[10px] font-figure font-semibold tabular-nums leading-none ${
                    isLight ? 'text-slate-500' : 'text-slate-400'
                  }`}
                  style={isSelected ? { color: isLight ? ch.color : undefined } : undefined}
                >
                  {ch.sharePct}%
                </span>
              </div>
              <svg
                width="42"
                height="18"
                viewBox="0 0 46 18"
                className="shrink-0 overflow-visible"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={ch.color} stopOpacity="0.24" />
                    <stop offset="100%" stopColor={ch.color} stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                {ch.paths.areaPath && (
                  <path d={ch.paths.areaPath} fill={`url(#${gradId})`} stroke="none" />
                )}
                {ch.paths.linePath && (
                  <path
                    d={ch.paths.linePath}
                    fill="none"
                    stroke={ch.color}
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
                <circle cx={ch.paths.lastX} cy={ch.paths.lastY} r="2" fill={ch.color} />
              </svg>
            </div>
          </button>
        );
      })}
    </div>
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
  const [velocityChannel, setVelocityChannel] = useState<VelocityChannelKey>('ALL');
  const [batteryViewMode, setBatteryViewMode] = useState<'STATUS' | 'WATCHLIST'>('STATUS');

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

  // Full-month (or period-scoped) Daily Cross-Channel Velocity time series (matches KPI Performance daily totals)
  const velocitySeries: CrossChannelDayPoint[] = useMemo(() => {
    const fallbackKpi = !kpiData?.dailyStaff?.length
      ? getCachedKpiSummary(kpiPeriodRange('MONTH').from, kpiPeriodRange('MONTH').to) ??
        getCachedKpiSummary(null, null)
      : undefined;
    const dailyStaff = (kpiData?.dailyStaff?.length ? kpiData.dailyStaff : fallbackKpi?.dailyStaff) || [];
    const fromYmd = range.from ? todayPP(new Date(range.from)) : '';
    const toYmd = range.to ? todayPP(new Date(range.to)) : '';
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

    // Build contiguous period window: full calendar month for MONTH (day 1 to last day of month),
    // full Mon–Sun week for WEEK, single day for TODAY, and rolling 30 days for ALL
    const daysOut: string[] = [];
    if (period === 'TODAY') {
      daysOut.push(today);
    } else if (period === 'WEEK') {
      const weekStart = fromYmd || addDaysYmd(today, -6);
      for (let i = 0; i < 7; i++) {
        daysOut.push(addDaysYmd(weekStart, i));
      }
    } else if (period === 'MONTH') {
      const [yy, mm] = today.split('-').map(Number);
      const daysInMonth =
        yy > 0 && mm >= 1 && mm <= 12 ? new Date(Date.UTC(yy, mm, 0)).getUTCDate() : 30;
      const monthPrefix = `${yy}-${String(mm).padStart(2, '0')}`;
      for (let d = 1; d <= daysInMonth; d++) {
        daysOut.push(`${monthPrefix}-${String(d).padStart(2, '0')}`);
      }
    } else {
      for (let i = 29; i >= 0; i--) {
        daysOut.push(addDaysYmd(today, -i));
      }
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
        isFuture: ymd > today,
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
    let posHq = 0;
    let posReserve = 0;
    let posConfig = 0;
    let posInstalled = 0;
    let posFaulty = 0;
    let posLost = 0;
    let sbHq = 0;
    let sbReserve = 0;
    let sbConfig = 0;
    let sbInstalled = 0;
    let sbFaulty = 0;
    let sbLost = 0;
    let boundDevices = 0;
    const uniqueMidSet = new Set<string>();
    const localStages: Record<LifecycleStage, number> = {
      HQ_STOCK: 0,
      BRANCH_RESERVE: 0,
      CONFIGURING: 0,
      COMPLETE: 0,
      FAULTY: 0,
      LOST: 0,
    };

    for (const d of activeDevices) {
      const isSb = d.type === 'Sound Box';
      if (isSb) {
        sb++;
        if (d.stage === 'HQ_STOCK') sbHq++;
        else if (d.stage === 'BRANCH_RESERVE') sbReserve++;
        else if (d.stage === 'CONFIGURING') sbConfig++;
        else if (d.stage === 'COMPLETE') sbInstalled++;
        else if (d.stage === 'FAULTY') sbFaulty++;
        else if (d.stage === 'LOST') sbLost++;
      } else {
        pos++;
        if (d.stage === 'HQ_STOCK') posHq++;
        else if (d.stage === 'BRANCH_RESERVE') posReserve++;
        else if (d.stage === 'CONFIGURING') posConfig++;
        else if (d.stage === 'COMPLETE') posInstalled++;
        else if (d.stage === 'FAULTY') posFaulty++;
        else if (d.stage === 'LOST') posLost++;
      }
      if (d.stage in localStages) localStages[d.stage]++;
      const merchantKey = (d.mid || d.merchantName || '').trim().toUpperCase();
      if (merchantKey) {
        boundDevices++;
        uniqueMidSet.add(merchantKey);
      }
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
      posHq,
      posReserve,
      posConfig,
      posInstalled,
      posFaulty,
      posLost,
      sbHq,
      sbReserve,
      sbConfig,
      sbInstalled,
      sbFaulty,
      sbLost,
      boundDevices,
      uniqueMerchants: uniqueMidSet.size,
      hq: stages.HQ_STOCK || 0,
      reserve: stages.BRANCH_RESERVE || 0,
      config: stages.CONFIGURING || 0,
      installed: stages.COMPLETE || 0,
      faulty: stages.FAULTY || 0,
      lost: stages.LOST || 0,
    };
  }, [activeDevices, serverStageCounts, serverTotalDevices]);

  // POS Terminal Battery lifecycle status (compliance, age cohorts, placement & oldest watchlist)
  const batterySummary = useMemo(() => {
    let healthy = 0;
    let replaceSoon = 0;
    let critical = 0;
    let noDate = 0;
    let fresh0to11 = 0;
    let mid12toWarn = 0;
    let deployedHealthy = 0;
    let deployedTotal = 0;
    let poolHealthy = 0;
    let poolTotal = 0;
    let withSerial = 0;
    let monthsSum = 0;
    const watchlist: {
      serial: string;
      branchId: string;
      model: string;
      batterySerial?: string;
      installedDate: string;
      monthsUsed: number;
      lifePercent: number;
      status: 'HEALTHY' | 'DUE_SOON' | 'EXPIRED';
    }[] = [];

    for (const d of activeDevices) {
      if (d.type !== 'POS Terminal') continue;
      if (d.batterySerial?.trim()) withSerial++;
      const isDeployed = d.stage === 'COMPLETE';
      if (isDeployed) deployedTotal++;
      else poolTotal++;

      if (!d.batteryInstalledDate && !d.stockInDate && !d.deployedDate) {
        noDate++;
        continue;
      }
      const st = getBatteryLifecycleStatus(d, today);
      const used = st.monthsUsed;
      const rem = Math.max(0, batteryLifespanMonths - used);
      const lifePercent = Math.max(0, Math.min(100, Math.round((rem / Math.max(1, batteryLifespanMonths)) * 100)));
      monthsSum += used;

      let status: 'HEALTHY' | 'DUE_SOON' | 'EXPIRED' = 'HEALTHY';
      if (used >= batteryLifespanMonths) {
        status = 'EXPIRED';
        critical++;
      } else if (used >= batteryWarningMonths) {
        status = 'DUE_SOON';
        replaceSoon++;
      } else {
        healthy++;
        if (used < 12) fresh0to11++;
        else mid12toWarn++;
        if (isDeployed) deployedHealthy++;
        else poolHealthy++;
      }

      if (watchlist.length < 7 || used > watchlist[watchlist.length - 1].monthsUsed) {
        watchlist.push({
          serial: d.serial,
          branchId: d.branchId,
          model: d.model,
          batterySerial: d.batterySerial,
          installedDate: st.installedDate,
          monthsUsed: used,
          lifePercent,
          status,
        });
        watchlist.sort((a, b) => b.monthsUsed - a.monthsUsed || a.serial.localeCompare(b.serial));
        if (watchlist.length > 7) watchlist.pop();
      }
    }

    const total = healthy + replaceSoon + critical;
    const avgMonthsUsed = total > 0 ? +(monthsSum / total).toFixed(1) : 0;
    const avgLifePct =
      total > 0
        ? Math.max(
            0,
            Math.min(100, Math.round(((batteryLifespanMonths - avgMonthsUsed) / Math.max(1, batteryLifespanMonths)) * 100))
          )
        : 0;

    return {
      fleetTotal: total + noDate,
      total,
      healthy,
      replaceSoon,
      critical,
      noDate,
      fresh0to11,
      mid12toWarn,
      deployedHealthy,
      deployedTotal,
      poolHealthy,
      poolTotal,
      withSerial,
      avgMonthsUsed,
      avgLifePct,
      watchlist,
    };
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
    const simHq = sim.HQ_STOCK || 0;
    const simReserve = sim.BRANCH_RESERVE || 0;
    const simOnHand = simHq + simReserve;
    const simInTransit = sim.IN_TRANSIT || 0;
    const simAtMerchant = sim.AT_MERCHANT || 0;
    const simFaulty = sim.FAULTY || 0;
    const simLost = sim.LOST || 0;
    const simWrittenOff = sim.WRITTEN_OFF || 0;
    const simBad = simFaulty + simLost + simWrittenOff;
    const simTotal = simOnHand + simInTransit + simAtMerchant + simBad;

    let kitOnHand = 0;
    let kitInTransit = 0;
    let kitAtMerchant = 0;
    const kitByCode = new Map<MaterialCode, { onHand: number; inTransit: number; atMerchant: number }>();
    for (const m of MATERIALS) {
      if (m.code !== 'SIM') {
        kitByCode.set(m.code, { onHand: 0, inTransit: 0, atMerchant: 0 });
      }
    }

    for (const row of matBalances) {
      if (row.code === 'SIM') continue;
      if (branchScopedId && row.branchId !== branchScopedId) continue;
      if (row.branchId !== '100' && !ppDirectoryScope.isBranchInScope(row.branchId)) continue;
      const oh = row.onHand || 0;
      const tr = row.inTransit || 0;
      const mch = row.atMerchant || 0;
      kitOnHand += oh;
      kitInTransit += tr;
      kitAtMerchant += mch;
      const entry = kitByCode.get(row.code);
      if (entry) {
        entry.onHand += oh;
        entry.inTransit += tr;
        entry.atMerchant += mch;
      }
    }

    const kitSkus = MATERIALS.filter((m) => m.code !== 'SIM').map((m) => {
      const c = kitByCode.get(m.code) || { onHand: 0, inTransit: 0, atMerchant: 0 };
      const total = c.onHand + c.inTransit + c.atMerchant;
      return {
        code: m.code,
        name: m.name,
        short: m.short,
        deviceType: m.deviceType,
        tracking: m.tracking,
        onHand: c.onHand,
        inTransit: c.inTransit,
        atMerchant: c.atMerchant,
        total,
      };
    });

    return {
      simTotal,
      simHq,
      simReserve,
      simOnHand,
      simInTransit,
      simAtMerchant,
      simFaulty,
      simLost,
      simWrittenOff,
      simBad,
      kitOnHand,
      kitInTransit,
      kitAtMerchant,
      kitTotal: kitOnHand + kitInTransit + kitAtMerchant,
      kitSkus,
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

  const systemTelemetry = useMemo(() => {
    const snap = getPerfSnapshot();
    const apiValid = snap.api.filter((c) => c.status !== -1);
    const times = apiValid.map((c) => c.ms);
    const apiMedianMs = percentile(times, 50);
    const apiP95Ms = percentile(times, 95);
    const apiErrors = apiValid.filter((c) => c.status === 0 || c.status >= 400).length;
    const auditRows = (getCachedAudit(50, 0) || []).slice(0, 3);
    return {
      apiCallsCount: apiValid.length,
      apiMedianMs,
      apiP95Ms,
      lcpMs: snap.lcp,
      errorCount: snap.errors.length + apiErrors,
      auditRows,
    };
  }, [kpiData, syncing, activeDevices.length, requisitions.length]);

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
          iconWrap: 'bg-[#1e6091]/10 text-[#1e6091]',
          barColor: 'bg-[#1e6091]',
          hexColor: CHANNEL_COLORS.khqr,
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
          iconWrap: 'bg-[#4F518C]/10 text-[#4F518C]',
          barColor: 'bg-[#4F518C]',
          hexColor: CHANNEL_COLORS.sb,
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
          iconWrap: 'bg-[#184e77]/10 text-[#184e77]',
          barColor: 'bg-[#184e77]',
          hexColor: CHANNEL_COLORS.pos,
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
          iconWrap: 'bg-[#2d6a4f]/12 text-[#2d6a4f]',
          barColor: 'bg-[#2d6a4f]',
          hexColor: CHANNEL_COLORS.mv,
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
          iconWrap: 'bg-[#f59e0b]/15 text-[#b45309]',
          barColor: 'bg-[#f59e0b]',
          hexColor: CHANNEL_COLORS.cc,
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
      .slice(0, 10);
  }, [kpiData, branches, allDevices, devices, isAdminLike, ppDirectoryScope, ruleMap, branchScopedId]);

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
    () => Math.max(1, ...branchLeaderboard.map((b) => b.totalTasks)),
    [branchLeaderboard]
  );

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

  const kpiSparklines = useMemo(() => {
    const activePeriodDays = velocitySeries.filter((p) => !p.isFuture);
    // When TODAY (1 day) is selected, build a trailing 14-day curve from cached monthly dailyStaff so the mini graph still displays movement
    let sparkDays = activePeriodDays;
    if (sparkDays.length <= 1) {
      const monthFallback =
        (kpiData?.dailyStaff?.length ? kpiData.dailyStaff : undefined) ??
        getCachedKpiSummary(kpiPeriodRange('MONTH').from, kpiPeriodRange('MONTH').to)?.dailyStaff ??
        getCachedKpiSummary(null, null)?.dailyStaff ??
        [];
      const byDayMap = new Map<string, CrossChannelDayPoint>();
      for (let i = 13; i >= 0; i--) {
        const ymd = addDaysYmd(today, -i);
        byDayMap.set(ymd, {
          label: fmtShortDay(ymd),
          fullLabel: ymd,
          pos: 0,
          sb: 0,
          khqr: 0,
          mv: 0,
          cc: 0,
          activeStaff: 0,
        });
      }
      for (const ds of monthFallback) {
        if (!ds.day || !byDayMap.has(ds.day)) continue;
        const dir = ppDirectoryScope.resolveKpiStaff(ds.staffId, ds.staffName, ds.branchId, ds.branchName);
        if (!dir) continue;
        if (branchScopedId && dir.branchId !== branchScopedId) continue;
        const row = byDayMap.get(ds.day)!;
        row.pos += Number(ds.posTasks) || 0;
        row.sb += Number(ds.sbTasks) || 0;
        row.khqr += Number(ds.khqrTasks) || 0;
        row.mv += Number(ds.mvTasks) || 0;
        row.cc += Number(ds.ccTasks) || 0;
      }
      sparkDays = Array.from(byDayMap.values());
    }

    const reqByDay = new Map<string, number>();
    for (const r of requisitions) {
      const ymd = (r.date || '').slice(0, 10);
      if (ymd) reqByDay.set(ymd, (reqByDay.get(ymd) || 0) + 1);
    }

    const tasksVals = sparkDays.map((p) => p.pos + p.sb + p.khqr + p.mv + p.cc);
    const approvalVals = sparkDays.map((p) => p.pos + p.sb + p.cc + (p.fullLabel ? reqByDay.get(p.fullLabel) || 0 : 0));
    const reachVals = sparkDays.map((p) => p.khqr + p.mv + p.cc);

    // Hardware Pool: 6-month cumulative stocked fleet growth (falls back to 6M hardware installs if stockInDate is uniform)
    const months6 = lastMonthsPP(6);
    const hwCumulative = months6.map((m) =>
      activeDevices.filter((d) => {
        const ym = (d.stockInDate || d.deployedDate || '').slice(0, 7);
        return ym ? ym <= m.key : true;
      }).length
    );
    const hwCumFlat = hwCumulative.every((v) => v === hwCumulative[0]);
    const hwMonthlyInstalls = months6.map((m) =>
      activeDevices.filter((d) => d.stage === 'COMPLETE' && (d.deployedDate || '').slice(0, 7) === m.key).length
    );
    const hwVals =
      activeDevices.length === 0
        ? [hardwareSummary.total, hardwareSummary.total]
        : !hwCumFlat
          ? hwCumulative
          : hwMonthlyInstalls.some((v) => v > 0)
            ? hwMonthlyInstalls
            : hwCumulative;

    return {
      tasks: analyzeSparkTrend(tasksVals, { isLight, unitLabel: 'field tasks' }),
      approvals: analyzeSparkTrend(approvalVals, { invertSentiment: true, isLight, unitLabel: 'queue intake' }),
      hardware: analyzeSparkTrend(hwVals, { isLight, unitLabel: '6M fleet' }),
      outreach: analyzeSparkTrend(reachVals, { isLight, unitLabel: 'merchant outreach' }),
    };
  }, [velocitySeries, kpiData?.dailyStaff, today, ppDirectoryScope, branchScopedId, requisitions, activeDevices, hardwareSummary.total, isLight]);

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
            <h1 className={`text-2xl sm:text-[26px] font-bold tracking-tight flex items-center gap-3 leading-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>
              <span
                className={`w-9 h-9 rounded-[11px] flex items-center justify-center shrink-0 shadow-xs ${
                  isLight
                    ? 'bg-gradient-to-br from-[#005bb5] to-[#0ea5e9] text-white'
                    : 'bg-gradient-to-br from-sky-500 to-indigo-500 text-white'
                }`}
              >
                <BarChart3 className="w-5 h-5" aria-hidden="true" />
              </span>
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
                <MapPin className={`w-3.5 h-3.5 shrink-0 ${isLight ? 'text-rose-500' : 'text-rose-400'}`} aria-hidden="true" />
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
              <RefreshCw className={`w-3.5 h-3.5 ${isLight ? 'text-sky-600' : 'text-sky-400'} ${syncing ? 'animate-spin' : ''}`} aria-hidden="true" />
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
                <FileSpreadsheet className={`w-3.5 h-3.5 ${isLight ? 'text-emerald-600' : 'text-emerald-400'}`} aria-hidden="true" />
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
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isLight ? 'bg-sky-500/15 text-sky-600' : 'bg-sky-500/20 text-sky-300'}`}>
                  <TrendingUp className="w-4 h-4" aria-hidden="true" />
                </div>
              </div>
              <div className="mt-2 flex items-end justify-between gap-2">
                <div className="min-w-0">
                  <div className={`text-2xl sm:text-[27px] font-bold font-figure tabular-nums tracking-tight leading-none ${kpiHeadingClass}`}>
                    <Odometer value={channelActivity.totalTasks} format duration={220} />
                  </div>
                  <span
                    data-kpi-delta="tasks"
                    className="mt-1.5 inline-flex items-center gap-1 px-1.5 py-[2px] rounded-full text-[10px] font-figure font-bold leading-none"
                    style={{
                      color: kpiSparklines.tasks.colorHex,
                      backgroundColor: `${kpiSparklines.tasks.colorHex}18`,
                    }}
                  >
                    {kpiSparklines.tasks.direction === 'up' ? '▲' : kpiSparklines.tasks.direction === 'down' ? '▼' : '●'}{' '}
                    {kpiSparklines.tasks.badgeText}
                  </span>
                </div>
                <KpiMiniSparkline
                  metricId="tasks"
                  summary={kpiSparklines.tasks}
                  cardBgHex={isLight ? '#f8f9fb' : '#1e2330'}
                />
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
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isLight ? 'bg-amber-500/15 text-amber-600' : 'bg-amber-500/20 text-amber-300'}`}>
                    <AlertCircle className="w-4 h-4" aria-hidden="true" />
                  </div>
                ) : (
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isLight ? 'bg-emerald-500/15 text-emerald-600' : 'bg-emerald-500/20 text-emerald-300'}`}>
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                  </div>
                )}
              </div>
              <div className="mt-2 flex items-end justify-between gap-2">
                <div className="min-w-0">
                  <div className={`text-2xl sm:text-[27px] font-bold font-figure tabular-nums tracking-tight leading-none ${kpiHeadingClass}`}>
                    <Odometer value={queues.total} format duration={220} />
                  </div>
                  <span
                    data-kpi-delta="approvals"
                    className="mt-1.5 inline-flex items-center gap-1 px-1.5 py-[2px] rounded-full text-[10px] font-figure font-bold leading-none"
                    style={{
                      color: kpiSparklines.approvals.colorHex,
                      backgroundColor: `${kpiSparklines.approvals.colorHex}18`,
                    }}
                  >
                    {kpiSparklines.approvals.direction === 'up' ? '▲' : kpiSparklines.approvals.direction === 'down' ? '▼' : '●'}{' '}
                    {kpiSparklines.approvals.badgeText}
                  </span>
                </div>
                <KpiMiniSparkline
                  metricId="approvals"
                  summary={kpiSparklines.approvals}
                  cardBgHex={isLight ? '#f8f9fb' : '#1e2330'}
                />
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
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isLight ? 'bg-emerald-500/15 text-emerald-600' : 'bg-emerald-500/20 text-emerald-300'}`}>
                  <Boxes className="w-4 h-4" aria-hidden="true" />
                </div>
              </div>
              <div className="mt-2 flex items-end justify-between gap-2">
                <div className="min-w-0">
                  <div className={`text-2xl sm:text-[27px] font-bold font-figure tabular-nums tracking-tight leading-none ${kpiHeadingClass}`}>
                    <Odometer value={hardwareSummary.total} format duration={220} />
                  </div>
                  <span
                    data-kpi-delta="hardware"
                    className="mt-1.5 inline-flex items-center gap-1 px-1.5 py-[2px] rounded-full text-[10px] font-figure font-bold leading-none"
                    style={{
                      color: kpiSparklines.hardware.colorHex,
                      backgroundColor: `${kpiSparklines.hardware.colorHex}18`,
                    }}
                  >
                    {kpiSparklines.hardware.direction === 'up' ? '▲' : kpiSparklines.hardware.direction === 'down' ? '▼' : '●'}{' '}
                    {kpiSparklines.hardware.badgeText}
                  </span>
                </div>
                <KpiMiniSparkline
                  metricId="hardware"
                  summary={kpiSparklines.hardware}
                  cardBgHex={isLight ? '#f8f9fb' : '#1e2330'}
                />
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
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isLight ? 'bg-violet-500/15 text-violet-600' : 'bg-violet-500/20 text-violet-300'}`}>
                  <Store className="w-4 h-4" aria-hidden="true" />
                </div>
              </div>
              <div className="mt-2 flex items-end justify-between gap-2">
                <div className="min-w-0">
                  <div className={`text-2xl sm:text-[27px] font-bold font-figure tabular-nums tracking-tight leading-none ${kpiHeadingClass}`}>
                    <Odometer value={reachTotal} format duration={220} />
                  </div>
                  <span
                    data-kpi-delta="outreach"
                    className="mt-1.5 inline-flex items-center gap-1 px-1.5 py-[2px] rounded-full text-[10px] font-figure font-bold leading-none"
                    style={{
                      color: kpiSparklines.outreach.colorHex,
                      backgroundColor: `${kpiSparklines.outreach.colorHex}18`,
                    }}
                  >
                    {kpiSparklines.outreach.direction === 'up' ? '▲' : kpiSparklines.outreach.direction === 'down' ? '▼' : '●'}{' '}
                    {kpiSparklines.outreach.badgeText}
                  </span>
                </div>
                <KpiMiniSparkline
                  metricId="outreach"
                  summary={kpiSparklines.outreach}
                  cardBgHex={isLight ? '#f8f9fb' : '#1e2330'}
                />
              </div>
            </div>
            <div className={`flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px] ${kpiSubtextClass} mt-2.5 pt-2 border-t ${kpiFooterBorderClass}`}>
              <span>{fmtNum(channelActivity.khqrCount)} KHQR · {fmtNum(channelActivity.mvCount)} Visits · {fmtNum(channelActivity.ccCount)}/{fmtNum(channelActivity.ccSubmittedShow)} CC</span>
              <span className={`font-semibold whitespace-nowrap ${isLight ? 'text-[#003857]' : 'text-slate-200'}`}>{reachSharePct}%</span>
            </div>
          </div>
        </section>
      </div>

      {/* ───────────── 3. ROW 1: CROSS-CHANNEL DAILY VELOCITY + CHANNEL SHARE DONUT ───────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left 8 Cols: Cross-Channel Daily Velocity & Active Staff */}
        <section className={`lg:col-span-8 ${iosCardClass} overflow-hidden flex flex-col`}>
          <div className="px-6 pt-5 pb-2.5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                  isLight ? 'bg-sky-500/15 text-sky-600' : 'bg-sky-500/20 text-sky-300'
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
                  Cross-Channel Daily Velocity & Active Staff
                </h3>
                <p
                  className={`text-[12px] truncate ${
                    isLight ? 'text-slate-500' : 'text-slate-400'
                  }`}
                >
                  Daily 5-channel volume trajectory with active staff trendline
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${
                  isLight ? 'bg-slate-100/90 text-slate-600' : 'bg-slate-800 text-slate-300'
                }`}
              >
                {activePeriodLabel}
              </span>
            </div>
          </div>

          <div className="px-6 pt-1 pb-4 flex-1 flex flex-col justify-between gap-2">
            {(() => {
              const channelTotals: Record<FocusedVelocityChannel, number> = {
                khqr: channelActivity.khqrCount,
                sb: channelActivity.sbCount,
                pos: channelActivity.posCount,
                mv: channelActivity.mvCount,
                cc: channelActivity.ccCount,
              };
              const primaryMeta = computeVelocityPrimaryMeta(
                velocitySeries,
                velocityChannel,
                velocityPeak,
                isLight
              );
              const primaryCount =
                velocityChannel === 'ALL'
                  ? channelActivity.totalTasks
                  : channelTotals[velocityChannel];
              const staffStrokeColor = isLight ? CHANNEL_COLORS.sb : '#a2a5e0';

              return (
                <>
                  <div
                    className={`flex flex-wrap items-center justify-between gap-2 pb-0.5 text-[11px] ${
                      isLight ? 'text-slate-600' : 'text-slate-300'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${
                          isLight
                            ? 'bg-slate-50/90 border-slate-200/80 text-slate-800'
                            : 'bg-slate-800/75 border-slate-700/80 text-slate-100'
                        }`}
                      >
                        <span className="relative inline-flex items-center justify-center w-3.5 h-2 shrink-0">
                          <span
                            className="w-3.5 border-t-[2px] inline-block"
                            style={{ borderColor: primaryMeta.color }}
                          />
                          <span
                            className={`w-1.5 h-1.5 rounded-full border-[1.5px] absolute ${
                              isLight ? 'bg-white' : 'bg-slate-900'
                            }`}
                            style={{ borderColor: primaryMeta.color }}
                          />
                        </span>
                        <span>{primaryMeta.label}</span>
                        <span
                          className={`font-figure font-bold tabular-nums ml-0.5 ${
                            isLight ? 'text-slate-900' : 'text-white'
                          }`}
                        >
                          {fmtNum(primaryCount)}
                        </span>
                      </span>

                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${
                          isLight
                            ? 'bg-white border-slate-200/80 text-slate-700'
                            : 'bg-slate-800/75 border-slate-700/80 text-slate-200'
                        }`}
                      >
                        <span className="relative inline-flex items-center justify-center w-3.5 h-2 shrink-0">
                          <span
                            className="w-3.5 border-t-[2px] border-dashed inline-block"
                            style={{ borderColor: staffStrokeColor }}
                          />
                          <span
                            className={`w-1.5 h-1.5 rounded-full border-[1.5px] absolute ${
                              isLight ? 'bg-white' : 'bg-slate-900'
                            }`}
                            style={{ borderColor: staffStrokeColor }}
                          />
                        </span>
                        Active staff
                      </span>

                      {velocityChannel !== 'ALL' && (
                        <button
                          type="button"
                          onClick={() => setVelocityChannel('ALL')}
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[11px] font-semibold cursor-pointer transition-colors duration-150 ${
                            isLight
                              ? 'bg-sky-50 border-sky-200 text-[#004e75] hover:bg-sky-100'
                              : 'bg-sky-900/40 border-sky-700/60 text-sky-300 hover:bg-sky-900/70'
                          }`}
                        >
                          All Channels ×
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {primaryMeta.peakVal > 0 && (
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${
                            isLight ? 'bg-slate-100/90 text-slate-600' : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          Peak{' '}
                          <strong className={`font-figure ${isLight ? 'text-slate-900' : 'text-white'}`}>
                            {fmtNum(primaryMeta.peakVal)}
                          </strong>{' '}
                          <span className="opacity-75">· {primaryMeta.peakLabel}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <CrossChannelVelocityChart
                    items={velocitySeries}
                    focusChannel={velocityChannel}
                    height={248}
                    theme={theme}
                  />

                  <VelocityChannelDock
                    isLight={isLight}
                    series={velocitySeries}
                    totals={channelTotals}
                    totalTasks={channelActivity.totalTasks}
                    selectedChannel={velocityChannel}
                    onSelectChannel={setVelocityChannel}
                  />
                </>
              );
            })()}
          </div>
        </section>

        {/* Right 4 Cols: Memoized Channel Mix Donut */}
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

      {/* ───────────── 4. ROW 2: TOP BRANCHES PERFORMANCE GRAPH + POS TERMINAL BATTERY STATUS ───────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left 8 Cols: Memoized Top Branches Performance Graph */}
        <TopBranchesCard
          isLight={isLight}
          cardClass={iosCardClass}
          activePeriodLabel={activePeriodLabel}
          branches={branchLeaderboard}
          maxBranchTasks={maxBranchTasks}
          onNavigateTab={onNavigateTab}
        />

        {/* Right 4 Cols: POS Terminal Battery Lifecycle Status */}
        <section className={`lg:col-span-4 ${iosCardClass} overflow-hidden flex flex-col justify-between`}>
          <div className="px-5 pt-4 pb-2.5 flex flex-wrap xl:flex-nowrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h3
                data-battery-card-title
                className={`text-[13.5px] font-bold tracking-[-0.015em] flex items-center gap-1.5 whitespace-nowrap ${
                  isLight ? 'text-slate-900' : 'text-white'
                }`}
              >
                <BatteryCharging
                  className={`w-4 h-4 shrink-0 ${
                    batterySummary.critical > 0
                      ? isLight ? 'text-rose-600' : 'text-rose-400'
                      : batterySummary.replaceSoon > 0
                        ? isLight ? 'text-amber-600' : 'text-amber-400'
                        : isLight ? 'text-[#2d6a4f]' : 'text-emerald-400'
                  }`}
                  aria-hidden="true"
                />
                <span>POS Battery Status</span>
              </h3>
              <p
                className={`text-[11px] truncate ${
                  isLight ? 'text-slate-500' : 'text-slate-400'
                }`}
              >
                {fmtNum(batterySummary.fleetTotal)} POS · {batteryLifespanMonths}M SLA
              </p>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <div
                className={`${iosSegWrapClass} text-[10px] shrink-0`}
                role="tablist"
                aria-label="Battery View Mode"
              >
                {([
                  { id: 'STATUS' as const, label: 'Status' },
                  { id: 'WATCHLIST' as const, label: 'Watchlist' },
                ]).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="tab"
                    aria-selected={batteryViewMode === m.id}
                    onClick={() => setBatteryViewMode(m.id)}
                    className={`px-2 py-0.5 rounded-full font-semibold cursor-pointer transition-all duration-150 whitespace-nowrap ${
                      batteryViewMode === m.id
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
                  onClick={() => onNavigateTab('inventory')}
                  className={`text-[11px] font-semibold inline-flex items-center gap-0.5 shrink-0 cursor-pointer transition ${
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

          {batteryViewMode === 'STATUS' ? (
            <>
              {(() => {
                const datedTot = Math.max(1, batterySummary.total);
                const pctOf = (v: number, tot = datedTot) =>
                  tot > 0 ? Math.round((v / tot) * 100) : 0;
                const healthyPct = batterySummary.total > 0 ? pctOf(batterySummary.healthy) : 0;
                const midLabelMax = Math.max(12, batteryWarningMonths - 1);
                const warnLabelMax = Math.max(batteryWarningMonths, batteryLifespanMonths - 1);
                const cohorts = [
                  {
                    key: 'fresh',
                    label: 'Fresh (0–11M)',
                    count: batterySummary.fresh0to11,
                    color: '#2d6a4f',
                  },
                  {
                    key: 'mid',
                    label: `Mid-Life (12–${midLabelMax}M)`,
                    count: batterySummary.mid12toWarn,
                    color: '#1e6091',
                  },
                  {
                    key: 'soon',
                    label: `Due Soon (${batteryWarningMonths}–${warnLabelMax}M)`,
                    count: batterySummary.replaceSoon,
                    color: '#f59e0b',
                  },
                  {
                    key: 'expired',
                    label: `Expired (${batteryLifespanMonths}M+)`,
                    count: batterySummary.critical,
                    color: '#dc2626',
                  },
                ];

                return (
                  <div
                    className={`divide-y ${
                      isLight ? 'divide-slate-100/90' : 'divide-slate-800/70'
                    } flex-1 flex flex-col justify-between`}
                  >
                    {/* Section 1: Compliance headline + stacked SLA bar + 3 status tiles */}
                    <div className="px-5 py-3 space-y-2.5">
                      <div className="flex items-end justify-between gap-2">
                        <div className="flex items-baseline gap-2">
                          <span
                            className={`text-[28px] font-bold font-figure leading-none tracking-tight ${
                              isLight ? 'text-slate-900' : 'text-white'
                            }`}
                          >
                            {healthyPct}%
                          </span>
                          <span
                            className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-full ${
                              batterySummary.critical > 0
                                ? isLight ? 'bg-rose-50 text-rose-700' : 'bg-rose-500/15 text-rose-300'
                                : batterySummary.replaceSoon > 0
                                  ? isLight ? 'bg-amber-50 text-amber-800' : 'bg-amber-500/15 text-amber-300'
                                  : isLight ? 'bg-[#2d6a4f]/10 text-[#2d6a4f]' : 'bg-emerald-500/15 text-emerald-300'
                            }`}
                          >
                            Healthy &lt;{batteryWarningMonths}M
                          </span>
                        </div>
                        <div className="text-right">
                          <div className={`text-[11px] font-figure font-semibold ${isLight ? 'text-slate-700' : 'text-slate-200'}`}>
                            {batterySummary.avgLifePct}% avg life
                          </div>
                          <div className={`text-[10px] font-figure ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                            Avg {batterySummary.avgMonthsUsed}M / {batteryLifespanMonths}M
                          </div>
                        </div>
                      </div>

                      <div
                        className={`h-2.5 w-full rounded-full ${
                          isLight ? 'bg-slate-100' : 'bg-slate-800'
                        } overflow-hidden flex gap-0.5`}
                      >
                        {batterySummary.total > 0 ? (
                          [
                            { key: 'healthy', val: batterySummary.healthy, color: '#2d6a4f', label: 'Healthy' },
                            { key: 'soon', val: batterySummary.replaceSoon, color: '#f59e0b', label: 'Due Soon' },
                            { key: 'expired', val: batterySummary.critical, color: '#dc2626', label: 'Expired' },
                          ].map((seg) =>
                            seg.val > 0 ? (
                              <div
                                key={seg.key}
                                className="h-full first:rounded-l-full last:rounded-r-full transition-all duration-300"
                                style={{
                                  width: `${Math.max(2, (seg.val / datedTot) * 100)}%`,
                                  backgroundColor: seg.color,
                                }}
                                title={`${seg.label}: ${fmtNum(seg.val)} (${pctOf(seg.val)}%)`}
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

                      <div className="grid grid-cols-3 gap-2">
                        {[
                          {
                            key: 'healthy',
                            label: 'Healthy',
                            count: batterySummary.healthy,
                            share: pctOf(batterySummary.healthy),
                            dot: '#2d6a4f',
                          },
                          {
                            key: 'soon',
                            label: 'Due Soon',
                            count: batterySummary.replaceSoon,
                            share: pctOf(batterySummary.replaceSoon),
                            dot: '#f59e0b',
                          },
                          {
                            key: 'expired',
                            label: 'Expired',
                            count: batterySummary.critical,
                            share: pctOf(batterySummary.critical),
                            dot: '#dc2626',
                          },
                        ].map((tile) => (
                          <div
                            key={tile.key}
                            className={`rounded-xl px-2.5 py-2 border ${
                              isLight
                                ? 'bg-slate-50/80 border-slate-200/60'
                                : 'bg-slate-800/45 border-slate-700/60'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 text-[10.5px] font-medium text-slate-500">
                              <i
                                className="w-1.5 h-1.5 rounded-full inline-block shrink-0"
                                style={{ backgroundColor: tile.dot }}
                              />
                              <span className="truncate">{tile.label}</span>
                            </div>
                            <div className="mt-1 flex items-baseline justify-between gap-1">
                              <span className={`text-[15px] font-bold font-figure leading-none ${isLight ? 'text-slate-900' : 'text-white'}`}>
                                {fmtNum(tile.count)}
                              </span>
                              <span className="text-[10px] font-figure text-slate-400">
                                {batterySummary.total > 0 ? `${tile.share}%` : '—'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Section 2: Age Cohort Breakdown */}
                    <div className="px-5 py-3 space-y-2">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className={`font-semibold ${isLight ? 'text-slate-700' : 'text-slate-200'}`}>
                          Age Distribution
                        </span>
                        <span className="font-figure text-slate-400">
                          {fmtNum(batterySummary.total)} dated
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {cohorts.map((c) => {
                          const share = batterySummary.total > 0 ? Math.round((c.count / datedTot) * 100) : 0;
                          const barW = c.count > 0 ? Math.max(3, (c.count / datedTot) * 100) : 0;
                          return (
                            <div key={c.key} className="space-y-0.5">
                              <div className="flex items-center justify-between text-[10.5px]">
                                <span className={isLight ? 'text-slate-600' : 'text-slate-300'}>
                                  {c.label}
                                </span>
                                <span className={`font-figure font-semibold ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>
                                  {fmtNum(c.count)}{' '}
                                  <span className="text-slate-400 font-normal">({share}%)</span>
                                </span>
                              </div>
                              <div className={`h-1.5 w-full rounded-full overflow-hidden ${isLight ? 'bg-slate-100' : 'bg-slate-800'}`}>
                                {barW > 0 && (
                                  <div
                                    className="h-full rounded-full transition-all duration-300"
                                    style={{ width: `${barW}%`, backgroundColor: c.color }}
                                  />
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Section 3: Placement split */}
                    <div className="px-5 py-2.5 grid grid-cols-2 gap-3 text-[11px]">
                      <div>
                        <div className="text-slate-400 text-[10px]">Deployed Live</div>
                        <div className={`font-figure font-semibold ${isLight ? 'text-slate-900' : 'text-white'}`}>
                          {fmtNum(batterySummary.deployedTotal)}{' '}
                          <span className="text-[10px] font-normal text-slate-500">
                            ({fmtNum(batterySummary.deployedHealthy)} OK)
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-slate-400 text-[10px]">Branch / HQ Pool</div>
                        <div className={`font-figure font-semibold ${isLight ? 'text-slate-900' : 'text-white'}`}>
                          {fmtNum(batterySummary.poolTotal)}{' '}
                          <span className="text-[10px] font-normal text-slate-500">
                            ({fmtNum(batterySummary.poolHealthy)} OK)
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Footer Summary Strip */}
              <div
                className={`px-5 py-2.5 border-t flex flex-wrap items-center justify-between gap-2 text-[11px] ${
                  isLight
                    ? 'border-slate-100 bg-[#f9fafb]/80 text-slate-500'
                    : 'border-slate-800/70 bg-slate-900/50 text-slate-400'
                }`}
              >
                <span>
                  {batterySummary.noDate > 0 ? (
                    <>
                      Undated:{' '}
                      <strong className={`font-figure ${isLight ? 'text-slate-900' : 'text-white'}`}>
                        {fmtNum(batterySummary.noDate)}
                      </strong>
                    </>
                  ) : (
                    <>
                      Battery S/N:{' '}
                      <strong className={`font-figure ${isLight ? 'text-slate-900' : 'text-white'}`}>
                        {fmtNum(batterySummary.withSerial)}
                      </strong>{' '}
                      recorded
                    </>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setBatteryViewMode('WATCHLIST')}
                  className={`font-semibold cursor-pointer transition inline-flex items-center gap-1 ${
                    isLight
                      ? 'text-[#004e75] hover:text-[#003857]'
                      : 'text-sky-400 hover:text-sky-300'
                  }`}
                >
                  <span>
                    {batterySummary.critical + batterySummary.replaceSoon > 0
                      ? `Action Needed (${fmtNum(batterySummary.critical + batterySummary.replaceSoon)})`
                      : `Oldest POS (${batterySummary.watchlist.length})`}
                  </span>
                  <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col">
              <div
                className={`px-5 py-2 border-y flex items-center justify-between gap-2 text-[11px] ${
                  isLight
                    ? 'border-slate-100 bg-[#f9fafb]/70 text-slate-500'
                    : 'border-slate-800/70 bg-slate-900/40 text-slate-400'
                }`}
              >
                <span>Oldest POS batteries ({fmtNum(batterySummary.total)} dated)</span>
                {onNavigateTab && (
                  <button
                    type="button"
                    onClick={() => onNavigateTab('inventory')}
                    className={`font-semibold inline-flex items-center gap-0.5 shrink-0 cursor-pointer transition ${
                      isLight
                        ? 'text-[#004e75] hover:text-[#003857]'
                        : 'text-sky-400 hover:text-sky-300'
                    }`}
                  >
                    Inventory <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
                  </button>
                )}
              </div>

              <div
                className={`divide-y ${
                  isLight ? 'divide-slate-100/90' : 'divide-slate-800/70'
                } flex-1 flex flex-col justify-center`}
              >
                {batterySummary.watchlist.length === 0 ? (
                  <div className="py-12 px-5 text-center text-xs text-slate-400">
                    No POS battery install dates recorded yet.
                  </div>
                ) : (
                  batterySummary.watchlist.map((item) => {
                    const pillCls =
                      item.status === 'EXPIRED'
                        ? isLight
                          ? 'bg-rose-50 text-rose-700 border-rose-200/80'
                          : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                        : item.status === 'DUE_SOON'
                          ? isLight
                            ? 'bg-amber-50 text-amber-800 border-amber-200/80'
                            : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                          : isLight
                            ? 'bg-[#2d6a4f]/10 text-[#2d6a4f] border-[#2d6a4f]/20'
                            : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
                    return (
                      <button
                        key={item.serial}
                        type="button"
                        onClick={() => onSelectDevice(item.serial)}
                        aria-label={`Open serial ${item.serial}`}
                        className={`w-full text-left px-5 py-2.5 flex items-center justify-between gap-2.5 transition cursor-pointer group ${
                          isLight ? 'hover:bg-slate-50/75' : 'hover:bg-slate-800/40'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-xs">
                            <span
                              className={`font-mono font-bold transition truncate ${
                                isLight
                                  ? 'text-slate-900 group-hover:text-[#004e75]'
                                  : 'text-white group-hover:text-sky-400'
                              }`}
                            >
                              {item.serial}
                            </span>
                            <span className={isLight ? 'text-slate-300' : 'text-slate-600'}>·</span>
                            <span className="font-mono text-[10.5px] text-slate-400 shrink-0">
                              Code {item.branchId}
                            </span>
                          </div>
                          <div className={`text-[10.5px] truncate mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                            Installed {item.installedDate || '—'}
                            {item.batterySerial ? ` · ${item.batterySerial}` : ` · ${item.model}`}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className={`text-[10px] font-figure font-semibold px-2 py-0.5 rounded-full border ${pillCls}`}>
                            {item.monthsUsed}M / {batteryLifespanMonths}M
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-[#004e75] transition" aria-hidden="true" />
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* ───────────── 5. ROW 3: SYSTEM WORKFLOW QUEUES, FLEET & COVERAGE, PLATFORM TELEMETRY ───────────── */}
      <div
        className="grid grid-cols-1 lg:grid-cols-12 gap-5"
        aria-label="System Operations & Telemetry"
      >
        {/* Card 3A: Hardware Stock Lifecycle & Product Mix Visualization */}
        <section
          data-stock-card="hardware"
          className={`lg:col-span-4 ${iosCardClass} overflow-hidden flex flex-col justify-between`}
        >
          <div className="px-6 pt-5 pb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                  isLight ? 'bg-[#184e77]/12 text-[#184e77]' : 'bg-[#184e77]/30 text-[#5cc8ff]'
                }`}
              >
                <Boxes className="w-3.5 h-3.5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 className={`text-[15px] font-bold tracking-[-0.015em] truncate ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  Hardware Stock Lifecycle
                </h3>
                <p className={`text-[12px] truncate ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  {fmtNum(hardwareSummary.total)} units · POS Terminal vs Sound Box
                </p>
              </div>
            </div>
            {onNavigateTab && (
              <button
                type="button"
                onClick={() => onNavigateTab('inventory')}
                className={`text-xs font-semibold inline-flex items-center gap-0.5 shrink-0 cursor-pointer transition ${
                  isLight ? 'text-[#004e75] hover:text-[#003857]' : 'text-sky-400 hover:text-sky-300'
                }`}
              >
                Stock <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="px-6 pb-5 flex-1 flex flex-col justify-between gap-3">
            {(() => {
              const splitTotal = hardwareSummary.pos + hardwareSummary.sb;
              const posShare = splitTotal > 0 ? Math.round((hardwareSummary.pos / splitTotal) * 100) : 0;
              const sbShare = splitTotal > 0 ? 100 - posShare : 0;
              const stages = [
                {
                  key: 'HQ_STOCK',
                  label: 'HQ Stock',
                  pos: hardwareSummary.posHq,
                  sb: hardwareSummary.sbHq,
                  total: hardwareSummary.hq,
                  dotColor: CHANNEL_COLORS.pos,
                  tab: 'inventory',
                },
                {
                  key: 'BRANCH_RESERVE',
                  label: 'Branch Reserve',
                  pos: hardwareSummary.posReserve,
                  sb: hardwareSummary.sbReserve,
                  total: hardwareSummary.reserve,
                  dotColor: CHANNEL_COLORS.khqr,
                  tab: 'inventory',
                },
                {
                  key: 'CONFIGURING',
                  label: 'Push Config',
                  pos: hardwareSummary.posConfig,
                  sb: hardwareSummary.sbConfig,
                  total: hardwareSummary.config,
                  dotColor: CHANNEL_COLORS.cc,
                  tab: 'push_configuring',
                },
                {
                  key: 'COMPLETE',
                  label: 'Deployed Live',
                  pos: hardwareSummary.posInstalled,
                  sb: hardwareSummary.sbInstalled,
                  total: hardwareSummary.installed,
                  dotColor: CHANNEL_COLORS.mv,
                  tab: 'merchants',
                },
                {
                  key: 'FAULTY',
                  label: 'Faulty Units',
                  pos: hardwareSummary.posFaulty,
                  sb: hardwareSummary.sbFaulty,
                  total: hardwareSummary.faulty,
                  dotColor: '#e11d48',
                  tab: 'inventory',
                },
                {
                  key: 'LOST',
                  label: 'Lost Units',
                  pos: hardwareSummary.posLost,
                  sb: hardwareSummary.sbLost,
                  total: hardwareSummary.lost,
                  dotColor: '#be123c',
                  tab: 'inventory',
                },
              ];
              const maxStage = Math.max(1, ...stages.map((s) => Math.max(s.total, s.pos + s.sb)));

              return (
                <>
                  {/* POS vs Sound Box fleet split */}
                  <div className={`${kpiCardClass} rounded-[14px] px-3.5 py-2.5 space-y-2`}>
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <button
                        type="button"
                        onClick={() => onNavigateTab?.('inventory_pos')}
                        className="inline-flex items-center gap-1.5 min-w-0 cursor-pointer group"
                      >
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: CHANNEL_COLORS.pos }} />
                        <span className={`font-semibold whitespace-nowrap transition ${isLight ? 'text-slate-700 group-hover:text-[#184e77]' : 'text-slate-200 group-hover:text-sky-300'}`}>
                          POS Terminal
                        </span>
                        <span className={`font-figure font-bold tabular-nums ${isLight ? 'text-slate-900' : 'text-white'}`}>
                          {fmtNum(hardwareSummary.pos)}
                        </span>
                        {splitTotal > 0 && (
                          <span className={`font-figure text-[10px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                            ({posShare}%)
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => onNavigateTab?.('inventory_sb')}
                        className="inline-flex items-center gap-1.5 min-w-0 cursor-pointer group"
                      >
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: CHANNEL_COLORS.sb }} />
                        <span className={`font-semibold whitespace-nowrap transition ${isLight ? 'text-slate-700 group-hover:text-[#4F518C]' : 'text-slate-200 group-hover:text-indigo-300'}`}>
                          Sound Box
                        </span>
                        <span className={`font-figure font-bold tabular-nums ${isLight ? 'text-slate-900' : 'text-white'}`}>
                          {fmtNum(hardwareSummary.sb)}
                        </span>
                        {splitTotal > 0 && (
                          <span className={`font-figure text-[10px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                            ({sbShare}%)
                          </span>
                        )}
                      </button>
                    </div>
                    {splitTotal > 0 && (
                      <div className="h-2 w-full flex items-center gap-[2px]">
                        {hardwareSummary.pos > 0 && (
                          <div
                            data-stock-bar="pos-split"
                            className="h-full rounded-l-full transition-all duration-300"
                            style={{
                              width: `${Math.max(3, (hardwareSummary.pos / splitTotal) * 100)}%`,
                              backgroundColor: CHANNEL_COLORS.pos,
                            }}
                            title={`POS Terminal: ${fmtNum(hardwareSummary.pos)} (${posShare}%)`}
                          />
                        )}
                        {hardwareSummary.sb > 0 && (
                          <div
                            data-stock-bar="sb-split"
                            className="h-full rounded-r-full transition-all duration-300"
                            style={{
                              width: `${Math.max(3, (hardwareSummary.sb / splitTotal) * 100)}%`,
                              backgroundColor: CHANNEL_COLORS.sb,
                            }}
                            title={`Sound Box: ${fmtNum(hardwareSummary.sb)} (${sbShare}%)`}
                          />
                        )}
                      </div>
                    )}
                  </div>

                  {/* 6-Stage Stacked Horizontal Bar Graph */}
                  <div className="space-y-2" aria-label="Hardware lifecycle stage chart">
                    {stages.map((st) => {
                      const rowCount = Math.max(st.total, st.pos + st.sb);
                      const hasTypeSplit = st.pos + st.sb > 0;
                      const posW = rowCount > 0 && st.pos > 0 ? Math.max(2, (st.pos / maxStage) * 100) : 0;
                      const sbW = rowCount > 0 && st.sb > 0 ? Math.max(2, (st.sb / maxStage) * 100) : 0;
                      const fallbackW = !hasTypeSplit && rowCount > 0 ? Math.max(2, (rowCount / maxStage) * 100) : 0;

                      return (
                        <button
                          key={st.key}
                          type="button"
                          onClick={() => onNavigateTab?.(st.tab)}
                          title={`${st.label}: ${fmtNum(rowCount)} units (${fmtNum(st.pos)} POS · ${fmtNum(st.sb)} SB)`}
                          className={`w-full text-left rounded-lg px-2 py-1 -mx-2 transition cursor-pointer group ${
                            isLight ? 'hover:bg-slate-50/90' : 'hover:bg-slate-800/45'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="inline-flex items-center gap-1.5 min-w-0">
                              <span
                                className="w-1.5 h-1.5 rounded-full shrink-0"
                                style={{ backgroundColor: st.dotColor }}
                              />
                              <span className={`font-semibold truncate ${isLight ? 'text-slate-700' : 'text-slate-200'}`}>
                                {st.label}
                              </span>
                            </span>
                            <span className="inline-flex items-center gap-2 shrink-0 tabular-nums font-figure">
                              {hasTypeSplit && (
                                <span className={`text-[10px] ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
                                  {fmtNum(st.pos)} POS · {fmtNum(st.sb)} SB
                                </span>
                              )}
                              <span
                                className={`font-bold ${
                                  rowCount === 0
                                    ? isLight
                                      ? 'text-slate-400'
                                      : 'text-slate-500'
                                    : isLight
                                      ? 'text-slate-900'
                                      : 'text-white'
                                }`}
                              >
                                {fmtNum(rowCount)}
                              </span>
                            </span>
                          </div>
                          {rowCount > 0 && (
                            <div
                              data-hardware-stage-bar={st.key}
                              className="mt-1 h-[6px] w-full flex items-center gap-[1.5px]"
                            >
                              {hasTypeSplit ? (
                                <>
                                  {st.pos > 0 && (
                                    <div
                                      className="h-full rounded-full transition-all duration-300"
                                      style={{ width: `${posW}%`, backgroundColor: CHANNEL_COLORS.pos }}
                                    />
                                  )}
                                  {st.sb > 0 && (
                                    <div
                                      className="h-full rounded-full transition-all duration-300"
                                      style={{ width: `${sbW}%`, backgroundColor: CHANNEL_COLORS.sb }}
                                    />
                                  )}
                                </>
                              ) : (
                                <div
                                  className="h-full rounded-full transition-all duration-300"
                                  style={{ width: `${fallbackW}%`, backgroundColor: st.dotColor }}
                                />
                              )}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Merchant binding & Push queue footer strip */}
                  <div className={`pt-2 border-t flex items-center justify-between gap-2 text-[11px] ${kpiFooterBorderClass}`}>
                    <button
                      type="button"
                      onClick={() => onNavigateTab?.('merchants')}
                      className={`inline-flex items-center gap-1 truncate cursor-pointer transition ${
                        isLight ? 'text-slate-600 hover:text-[#004e75]' : 'text-slate-300 hover:text-sky-300'
                      }`}
                    >
                      <Store className="w-3 h-3 shrink-0" aria-hidden="true" />
                      <span>
                        Bound: <strong className={`font-figure ${isLight ? 'text-slate-900' : 'text-white'}`}>{fmtNum(hardwareSummary.boundDevices)}</strong> ·{' '}
                        <strong className={`font-figure ${isLight ? 'text-slate-900' : 'text-white'}`}>{fmtNum(hardwareSummary.uniqueMerchants)}</strong> MIDs
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onNavigateTab?.('push_configuring')}
                      className={`font-figure font-semibold shrink-0 cursor-pointer transition ${
                        queues.pushPend > 0
                          ? isLight
                            ? 'text-amber-700 hover:text-amber-800'
                            : 'text-amber-300 hover:text-amber-200'
                          : isLight
                            ? 'text-emerald-700'
                            : 'text-emerald-300'
                      }`}
                    >
                      {fmtNum(queues.pushPend)} push queue
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </section>

        {/* Card 3B: SIM Card Fleet, Kit Materials & Stock Requisitions Visualization */}
        <section
          data-stock-card="materials"
          className={`lg:col-span-4 ${iosCardClass} overflow-hidden flex flex-col justify-between`}
        >
          <div className="px-6 pt-5 pb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                  isLight ? 'bg-[#2d6a4f]/15 text-[#2d6a4f]' : 'bg-emerald-500/20 text-emerald-300'
                }`}
              >
                <Package className="w-3.5 h-3.5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 className={`text-[15px] font-bold tracking-[-0.015em] truncate ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  SIM &amp; Materials Stock
                </h3>
                <p className={`text-[12px] truncate ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  SIM fleet, 5 kit SKUs &amp; requisitions
                </p>
              </div>
            </div>
            {onNavigateTab && (
              <div className="flex items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => onNavigateTab('sim_cards')}
                  className={`text-xs font-semibold inline-flex items-center gap-0.5 cursor-pointer transition ${
                    isLight ? 'text-[#004e75] hover:text-[#003857]' : 'text-sky-400 hover:text-sky-300'
                  }`}
                >
                  SIM <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => onNavigateTab('requisitions')}
                  className={`text-xs font-semibold inline-flex items-center gap-0.5 cursor-pointer transition ${
                    isLight ? 'text-[#004e75] hover:text-[#003857]' : 'text-sky-400 hover:text-sky-300'
                  }`}
                >
                  Req <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>

          <div className="px-6 pb-5 flex-1 flex flex-col justify-between gap-3">
            {(() => {
              const simSegs = [
                { key: 'HQ', label: 'HQ', count: materialsSummary.simHq, color: CHANNEL_COLORS.pos },
                { key: 'RES', label: 'Res', count: materialsSummary.simReserve, color: CHANNEL_COLORS.sb },
                { key: 'TR', label: 'Transit', count: materialsSummary.simInTransit, color: CHANNEL_COLORS.cc },
                { key: 'MCH', label: 'Merchant', count: materialsSummary.simAtMerchant, color: CHANNEL_COLORS.mv },
                { key: 'BAD', label: 'Lost/Faulty', count: materialsSummary.simBad, color: '#e11d48' },
              ];
              const simMerchantPct =
                materialsSummary.simTotal > 0
                  ? Math.round((materialsSummary.simAtMerchant / materialsSummary.simTotal) * 100)
                  : 0;
              const maxKitSku = Math.max(1, ...materialsSummary.kitSkus.map((s) => s.total));
              const reqPendingCount = reqStats.pending.length;

              return (
                <>
                  {/* SIM Card Fleet Stacked Distribution */}
                  <button
                    type="button"
                    onClick={() => onNavigateTab?.('sim_cards')}
                    className={`w-full text-left ${kpiCardClass} rounded-[14px] px-3.5 py-2.5 space-y-2 transition cursor-pointer ${
                      isLight ? 'hover:bg-slate-100/80' : 'hover:bg-slate-800/70'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className={`font-semibold truncate ${isLight ? 'text-slate-700' : 'text-slate-200'}`}>
                        SIM Card Fleet · <strong className={`font-figure ${isLight ? 'text-slate-900' : 'text-white'}`}>{fmtNum(materialsSummary.simTotal)}</strong> serials
                      </span>
                      <span className={`font-figure font-semibold shrink-0 ${isLight ? 'text-[#2d6a4f]' : 'text-emerald-300'}`}>
                        {simMerchantPct}% Live
                      </span>
                    </div>
                    {materialsSummary.simTotal > 0 && (
                      <div
                        data-stock-bar="sim-fleet"
                        className="h-2 w-full flex items-center gap-[1.5px]"
                      >
                        {simSegs.map(
                          (seg) =>
                            seg.count > 0 && (
                              <div
                                key={seg.key}
                                className="h-full rounded-full transition-all duration-300"
                                style={{
                                  width: `${Math.max(2, (seg.count / materialsSummary.simTotal) * 100)}%`,
                                  backgroundColor: seg.color,
                                }}
                                title={`${seg.label}: ${fmtNum(seg.count)}`}
                              />
                            )
                        )}
                      </div>
                    )}
                    <div className={`flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] font-figure tabular-nums ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                      {simSegs.map((seg) => (
                        <span key={seg.key} className="inline-flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
                          <span>{seg.label}</span>
                          <strong className={isLight ? 'text-slate-800' : 'text-slate-200'}>{fmtNum(seg.count)}</strong>
                        </span>
                      ))}
                    </div>
                  </button>

                  {/* Kit Materials Stock by SKU (5 SKUs) */}
                  <div className="space-y-1.5" aria-label="Kit materials stock chart">
                    <div className="flex items-center justify-between gap-2 text-[10.5px]">
                      <span className={`font-semibold ${isLight ? 'text-slate-700' : 'text-slate-200'}`}>
                        Kit Materials ({fmtNum(materialsSummary.kitTotal)} units)
                      </span>
                      <span className={`inline-flex items-center gap-2 shrink-0 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                        <span className="inline-flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: CHANNEL_COLORS.pos }} /> Stock
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: CHANNEL_COLORS.cc }} /> Transit
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: CHANNEL_COLORS.mv }} /> Merchant
                        </span>
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      {materialsSummary.kitSkus.map((sku) => {
                        const targetTab = sku.deviceType === 'SB' ? 'inventory_sb' : 'inventory_pos';
                        return (
                          <button
                            key={sku.code}
                            type="button"
                            onClick={() => onNavigateTab?.(targetTab)}
                            title={`${sku.name} (${sku.deviceType}): ${fmtNum(sku.onHand)} stock · ${fmtNum(sku.inTransit)} transit · ${fmtNum(sku.atMerchant)} merchant`}
                            className={`w-full text-left rounded-lg px-2 py-1 -mx-2 transition cursor-pointer ${
                              isLight ? 'hover:bg-slate-50/90' : 'hover:bg-slate-800/45'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 text-[11px]">
                              <span className="inline-flex items-center gap-1.5 min-w-0">
                                <span className={`font-semibold truncate ${isLight ? 'text-slate-700' : 'text-slate-200'}`}>
                                  {sku.name}
                                </span>
                                <span
                                  className={`text-[9px] font-bold px-1.5 py-[1px] rounded uppercase shrink-0 ${
                                    sku.deviceType === 'SB'
                                      ? isLight
                                        ? 'bg-[#4F518C]/12 text-[#4F518C]'
                                        : 'bg-[#4F518C]/30 text-[#a2a5e0]'
                                      : isLight
                                        ? 'bg-[#184e77]/12 text-[#184e77]'
                                        : 'bg-[#184e77]/30 text-[#5cc8ff]'
                                  }`}
                                >
                                  {sku.deviceType}
                                </span>
                              </span>
                              <span className="inline-flex items-center gap-2 shrink-0 tabular-nums font-figure">
                                {sku.total > 0 && (
                                  <span className={`text-[10px] ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
                                    {fmtNum(sku.onHand)} · {fmtNum(sku.inTransit)} tr · {fmtNum(sku.atMerchant)} mch
                                  </span>
                                )}
                                <span
                                  className={`font-bold ${
                                    sku.total === 0
                                      ? isLight
                                        ? 'text-slate-400'
                                        : 'text-slate-500'
                                      : isLight
                                        ? 'text-slate-900'
                                        : 'text-white'
                                  }`}
                                >
                                  {fmtNum(sku.total)}
                                </span>
                              </span>
                            </div>
                            {sku.total > 0 && (
                              <div
                                data-material-sku-bar={sku.code}
                                className="mt-1 h-[5.5px] w-full flex items-center gap-[1.5px]"
                              >
                                {sku.onHand > 0 && (
                                  <div
                                    className="h-full rounded-full transition-all duration-300"
                                    style={{
                                      width: `${Math.max(2, (sku.onHand / maxKitSku) * 100)}%`,
                                      backgroundColor: CHANNEL_COLORS.pos,
                                    }}
                                  />
                                )}
                                {sku.inTransit > 0 && (
                                  <div
                                    className="h-full rounded-full transition-all duration-300"
                                    style={{
                                      width: `${Math.max(2, (sku.inTransit / maxKitSku) * 100)}%`,
                                      backgroundColor: CHANNEL_COLORS.cc,
                                    }}
                                  />
                                )}
                                {sku.atMerchant > 0 && (
                                  <div
                                    className="h-full rounded-full transition-all duration-300"
                                    style={{
                                      width: `${Math.max(2, (sku.atMerchant / maxKitSku) * 100)}%`,
                                      backgroundColor: CHANNEL_COLORS.mv,
                                    }}
                                  />
                                )}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Stock Requisitions Pipeline Bar */}
                  <button
                    type="button"
                    onClick={() => onNavigateTab?.('requisitions')}
                    className={`w-full text-left pt-2 border-t space-y-1.5 cursor-pointer group ${kpiFooterBorderClass}`}
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className={`font-semibold inline-flex items-center gap-1.5 ${isLight ? 'text-slate-700 group-hover:text-[#004e75]' : 'text-slate-200 group-hover:text-sky-300'}`}>
                        <ScrollText className="w-3 h-3 shrink-0" aria-hidden="true" />
                        Stock Requisitions ({fmtNum(reqStats.total)})
                      </span>
                      <span className={`font-figure text-[10.5px] tabular-nums shrink-0 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                        <strong className={reqPendingCount > 0 ? (isLight ? 'text-amber-700' : 'text-amber-300') : ''}>{fmtNum(reqPendingCount)}</strong> pend ·{' '}
                        <strong className={isLight ? 'text-[#2d6a4f]' : 'text-emerald-300'}>{fmtNum(reqStats.received)}</strong> recv ·{' '}
                        <strong className={reqStats.rejected > 0 ? (isLight ? 'text-rose-600' : 'text-rose-400') : ''}>{fmtNum(reqStats.rejected)}</strong> rej
                      </span>
                    </div>
                    {reqStats.total > 0 && (
                      <div
                        data-stock-bar="requisitions"
                        className="h-1.5 w-full flex items-center gap-[1.5px]"
                      >
                        {reqPendingCount > 0 && (
                          <div
                            className="h-full rounded-full transition-all duration-300"
                            style={{
                              width: `${Math.max(3, (reqPendingCount / reqStats.total) * 100)}%`,
                              backgroundColor: CHANNEL_COLORS.cc,
                            }}
                          />
                        )}
                        {reqStats.received > 0 && (
                          <div
                            className="h-full rounded-full transition-all duration-300"
                            style={{
                              width: `${Math.max(3, (reqStats.received / reqStats.total) * 100)}%`,
                              backgroundColor: CHANNEL_COLORS.mv,
                            }}
                          />
                        )}
                        {reqStats.rejected > 0 && (
                          <div
                            className="h-full rounded-full transition-all duration-300"
                            style={{
                              width: `${Math.max(3, (reqStats.rejected / reqStats.total) * 100)}%`,
                              backgroundColor: '#e11d48',
                            }}
                          />
                        )}
                      </div>
                    )}
                  </button>
                </>
              );
            })()}
          </div>
        </section>

        {/* Card 3C: Platform Telemetry & Recent Activity */}
        <section className={`lg:col-span-4 ${iosCardClass} overflow-hidden flex flex-col justify-between`}>
          <div className="px-6 pt-5 pb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                  systemTelemetry.errorCount === 0
                    ? isLight
                      ? 'bg-emerald-500/15 text-emerald-600'
                      : 'bg-emerald-500/20 text-emerald-300'
                    : isLight
                      ? 'bg-rose-500/15 text-rose-600'
                      : 'bg-rose-500/20 text-rose-300'
                }`}
              >
                <Activity className="w-3.5 h-3.5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 className={`text-[15px] font-bold tracking-[-0.015em] truncate ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  Platform Health &amp; Activity
                </h3>
                <p className={`text-[12px] truncate ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Session speed, kits &amp; live events
                </p>
              </div>
            </div>
            {onNavigateTab && isAdminLike && (
              <button
                type="button"
                onClick={() => onNavigateTab(role === 'SUPER_ADMIN' ? 'settings' : 'audit_log')}
                className={`text-xs font-semibold inline-flex items-center gap-1 shrink-0 cursor-pointer transition ${
                  isLight ? 'text-[#004e75] hover:text-[#003857]' : 'text-sky-400 hover:text-sky-300'
                }`}
              >
                {role === 'SUPER_ADMIN' ? 'Health' : 'Audit'} <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="px-6 pb-5 space-y-3 flex-1 flex flex-col justify-between">
            <div className="grid grid-cols-3 gap-2">
              <div className={`${kpiCardClass} rounded-[14px] px-2.5 py-2`}>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Backend</div>
                <div className={`text-xs font-bold mt-0.5 inline-flex items-center gap-1.5 ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isSupabaseConfigured ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  {isSupabaseConfigured ? 'Cloud Live' : 'Local'}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                  {fmtNum(systemTelemetry.apiCallsCount)} calls
                </div>
              </div>

              <div className={`${kpiCardClass} rounded-[14px] px-2.5 py-2`}>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">API Speed</div>
                <div className={`text-xs font-bold font-figure tabular-nums mt-0.5 ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  {systemTelemetry.apiMedianMs !== null ? `${systemTelemetry.apiMedianMs} ms` : 'Cached'}
                </div>
                <div className="text-[10px] font-figure text-slate-400 mt-0.5 truncate">
                  P95 {systemTelemetry.apiP95Ms !== null ? `${systemTelemetry.apiP95Ms} ms` : '—'}
                </div>
              </div>

              <div className={`${kpiCardClass} rounded-[14px] px-2.5 py-2`}>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Errors / LCP</div>
                <div className={`text-xs font-bold font-figure tabular-nums mt-0.5 ${
                  systemTelemetry.errorCount === 0
                    ? isLight ? 'text-emerald-700' : 'text-emerald-300'
                    : isLight ? 'text-rose-600' : 'text-rose-400'
                }`}>
                  {systemTelemetry.errorCount} err
                </div>
                <div className="text-[10px] font-figure text-slate-400 mt-0.5 truncate">
                  {systemTelemetry.lcpMs !== null ? `${(systemTelemetry.lcpMs / 1000).toFixed(2)}s LCP` : 'Healthy'}
                </div>
              </div>
            </div>

            <div className={`${kpiCardClass} rounded-[14px] px-3 py-2 flex items-center justify-between gap-2 text-[11px]`}>
              <span className={`font-medium truncate ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
                QR Kits ({materialsSummary.activeTypesCount} SKUs): <strong className={`font-figure ${isLight ? 'text-slate-900' : 'text-white'}`}>{fmtNum(materialsSummary.kitOnHand)}</strong> stock · <strong className={`font-figure ${isLight ? 'text-slate-900' : 'text-white'}`}>{fmtNum(materialsSummary.kitAtMerchant)}</strong> merchant
              </span>
              <span className={`font-figure font-semibold shrink-0 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                {fmtNum(materialsSummary.kitInTransit)} transit
              </span>
            </div>

            <div className={`divide-y ${isLight ? 'divide-slate-100/85' : 'divide-slate-800/70'}`}>
              {systemTelemetry.auditRows.length > 0 ? (
                systemTelemetry.auditRows.map((ev) => (
                  <div key={ev.id} className="py-2 first:pt-0.5 last:pb-0 flex items-center justify-between gap-2.5">
                    <div className="min-w-0">
                      <div className={`text-xs font-semibold truncate ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                        {ev.title || ev.action || 'System event'}
                      </div>
                      <div className={`text-[11px] truncate ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                        {ev.actorName || ev.actorEmp || 'System'}{ev.branchId ? ` · Code ${ev.branchId}` : ''}{ev.target ? ` · ${ev.target}` : ''}
                      </div>
                    </div>
                    <span className={`text-[10px] font-mono shrink-0 px-2 py-0.5 rounded-full ${isLight ? 'bg-slate-100 text-slate-500' : 'bg-slate-800 text-slate-400'}`}>
                      {ev.createdAt ? ev.createdAt.slice(0, 10) : 'Audit'}
                    </span>
                  </div>
                ))
              ) : recentDevices.length > 0 ? (
                recentDevices.slice(0, 3).map((dev) => (
                  <button
                    key={dev.serial}
                    type="button"
                    onClick={() => onSelectDevice(dev.serial)}
                    className={`w-full text-left py-2 first:pt-0.5 last:pb-0 flex items-center justify-between gap-2.5 cursor-pointer group ${
                      isLight ? 'hover:bg-slate-50/70' : 'hover:bg-slate-800/30'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className={`text-xs font-mono font-bold truncate transition ${
                        isLight ? 'text-slate-900 group-hover:text-[#004e75]' : 'text-white group-hover:text-sky-400'
                      }`}>
                        {dev.serial} · {dev.type}
                      </div>
                      <div className={`text-[11px] truncate ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                        Code {dev.branchId}{dev.merchantName ? ` · ${dev.merchantName}` : ` · ${dev.model}`}
                      </div>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${STAGE_META[dev.stage]?.badgeClassLight || ''}`}>
                      {STAGE_META[dev.stage]?.short || dev.stage}
                    </span>
                  </button>
                ))
              ) : (
                <div className="py-4 text-center text-xs text-slate-400">
                  No recent system activity recorded yet.
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

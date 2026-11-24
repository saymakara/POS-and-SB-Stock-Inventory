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
import {
  GroupedBarChart,
  CrossChannelVelocityChart,
  CrossChannelDayPoint,
  CHANNEL_COLORS,
  buildAnnularArcPath,
  type VelocityChannelKey,
} from './Charts';
import { Odometer } from './Odometer';
import { PillMotion } from './PillMotion';
import { todayPP, lastMonthsPP } from '../utils/time';
import { getCambodiaHoliday, isWeekendDay } from '../utils/cambodiaHolidays';
import { fmtNum } from '../utils/format';
import { SPRING_TAB_PILL } from '../utils/animationRules';
import { buildPpDirectoryScope } from '../utils/fieldScope';
import { isSupabaseConfigured } from '../lib/supabase';
import { getCachedStaff, loadStaff, onStaffList } from '../services/staffCache';
import { getCachedAudit } from '../services/auditCache';
import { getPerfSnapshot, percentile } from '../utils/perfMonitor';
import { onPortalSync, type SyncDomain } from '../utils/portalSync';
import {
  fetchMonthlyInstallFieldEvents,
  fetchPosBatterySummary,
  getCachedMonthlyInstallBuckets,
  getCachedMonthlyInstallFieldEvents,
  getCachedMonthlyInstallFieldEventsCoveredDays,
  getCachedPosBatterySummary,
  setCachedMonthlyInstallBuckets,
  subscribeToFieldEvents,
  type FieldInstallSummaryRow,
  type MonthlyInstallSessionBucket,
  type PosBatterySummary,
  type StaffAccount,
} from '../services/supabaseService';
import {
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
  deriveDeviceKitMaterials,
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
  ArrowUpRight,
  Cpu,
  Volume2,
  QrCode,
  Store,
  CreditCard,
  BatteryCharging,
  FileSpreadsheet,
  Package,
  RefreshCw,
  Boxes,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Calendar,
  MapPin,
  Activity,
  Inbox,
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
  loading?: boolean;
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

type DashViewMode = 'DATE' | 'MONTH' | 'ALL';

const VIEW_MODE_OPTIONS: { id: DashViewMode; label: string }[] = [
  { id: 'DATE', label: 'Date' },
  { id: 'MONTH', label: 'Month' },
  { id: 'ALL', label: 'All' },
];

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** (23 Nov 2026) a figure that is still on its way: a placeholder of the same height, then the number fades in. */
const FigureSlot = ({ pending, children }: { pending: boolean; children: React.ReactNode }) =>
  pending
    ? <span className="skeleton block h-6 sm:h-[27px] w-16 rounded-md" aria-label="Loading" />
    : <span className="figure-in inline-block">{children}</span>;
/** (23 Nov 2026, speed) one shared collator: same order as String.prototype.localeCompare() with no arguments. */
const TEXT_ORDER = new Intl.Collator();

function fmtShortDay(ymd: string): string {
  const parts = ymd.split('-');
  if (parts.length !== 3) return ymd;
  const mIdx = Number(parts[1]) - 1;
  return `${SHORT_MONTHS[mIdx] || parts[1]} ${parts[2]}`;
}

function fmtDayOfMonth(ymd: string): string {
  const parts = ymd.split('-');
  return parts.length === 3 ? parts[2] : ymd;
}

function fmtLongDay(ymd: string): string {
  const parts = ymd.split('-');
  if (parts.length !== 3) return ymd;
  const mIdx = Number(parts[1]) - 1;
  return `${SHORT_MONTHS[mIdx] || parts[1]} ${parts[2]}, ${parts[0]}`;
}

function fmtMonthLabel(ym: string): string {
  const [yy, mm] = ym.split('-').map(Number);
  if (!yy || !mm || mm < 1 || mm > 12) return ym;
  return `${SHORT_MONTHS[mm - 1]} ${yy}`;
}

function addDaysYmd(ymd: string, delta: number): string {
  const t = Date.parse(`${ymd}T00:00:00Z`);
  if (Number.isNaN(t)) return ymd;
  return new Date(t + delta * 86400000).toISOString().slice(0, 10);
}

function diffDaysYmd(fromYmd: string, toYmd: string): number {
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

function shiftMonthYm(ym: string, delta: number): string {
  const [yy, mm] = ym.split('-').map(Number);
  if (!yy || !mm) return ym;
  const d = new Date(Date.UTC(yy, mm - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthDaysCount(ym: string): number {
  const [yy, mm] = ym.split('-').map(Number);
  if (!yy || mm < 1 || mm > 12) return 30;
  return new Date(Date.UTC(yy, mm, 0)).getUTCDate();
}

function weekMondayYmd(ymd: string): string {
  const [yy, mm, dd] = ymd.split('-').map(Number);
  const utc = new Date(Date.UTC(yy, mm - 1, dd));
  const mondayOffset = (utc.getUTCDay() + 6) % 7;
  return addDaysYmd(ymd, -mondayOffset);
}

function startOfPP(ymd: string): string {
  return new Date(`${ymd}T00:00:00+07:00`).toISOString();
}

function endOfDayPP(ymd: string): string {
  return new Date(`${ymd}T23:59:59+07:00`).toISOString();
}

function formatDateButtonLabel(fromYmd: string, toYmd: string, todayYmd: string): string {
  if (fromYmd === toYmd) {
    if (fromYmd === todayYmd) return `Today · ${fmtShortDay(fromYmd)}`;
    if (fromYmd === addDaysYmd(todayYmd, -1)) return `Yesterday · ${fmtShortDay(fromYmd)}`;
    return fmtLongDay(fromYmd);
  }
  if (fromYmd.slice(0, 4) === toYmd.slice(0, 4)) {
    return `${fmtShortDay(fromYmd)} – ${fmtShortDay(toYmd)}`;
  }
  return `${fmtLongDay(fromYmd)} – ${fmtLongDay(toYmd)}`;
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
  target.adjPts = (target.adjPts || 0) + (src.adjPts || 0);
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
  options: { invertSentiment?: boolean; isLight?: boolean; unitLabel?: string; negativeHex?: string } = {}
): KpiSparkSummary {
  const { invertSentiment = false, isLight = true, unitLabel = 'period', negativeHex } = options;
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
  const badHex = negativeHex || (isLight ? '#e11d48' : '#fb7185');
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

type InstallHorizon = '3M' | '6M' | '12M';

interface MonthlyInstallComparisonData {
  labels: string[];
  pos: number[];
  sb: number[];
  priorPos?: number;
  priorSb?: number;
  latestPosMomPct: number | null;
  latestPosMomText: string;
  latestSbMomPct: number | null;
  latestSbMomText: string;
  totalPos: number;
  totalSb: number;
  totalInstalls: number;
  pendingTotal: number;
  latestLabel: string;
  latestPos: number;
  latestSb: number;
  peakMonthLabel: string;
  peakMonthTotal: number;
  allBuckets?: MonthlyInstallSessionBucket[];
}

function fieldEventMonthPP(recordedAt?: string | null, receivedAt?: string | null): string {
  const raw = String(recordedAt || receivedAt || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.slice(0, 7);
  const ms = Date.parse(raw);
  if (!Number.isNaN(ms)) return todayPP(new Date(ms)).slice(0, 7);
  const m = raw.match(/^(\d{4}-\d{2})/);
  return m ? m[1] : '';
}

interface ChannelMixCardProps {
  isLight: boolean;
  cardClass: string;
  donutSlices: ChannelSliceItem[];
  leadChannel: ChannelSliceItem | undefined;
  totalTasks: number;
  ccSubmittedShow: number;
  loading?: boolean;
  onNavigateTab?: (tab: string) => void;
}

const CM_VB_W = 468;
const CM_VB_H = 356;
const CM_CX = 238;
const CM_CY = 180;
const CM_R_INNER = 92;
const CM_R_OUTER = 116;
const CM_R_TICK = CM_R_OUTER + 5;
const CM_R_TRACK = (CM_R_INNER + CM_R_OUTER) / 2;
const CM_TRACK_W = CM_R_OUTER - CM_R_INNER;

interface ChannelCalloutLayout {
  slice: ChannelSliceItem;
  side: 'left' | 'right';
  sx: number;
  sy: number;
  qpx: number;
  qpy: number;
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
  loading = false,
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
      const anchorR = hasSlice ? CM_R_OUTER + 5 : CM_R_OUTER;
      return {
        slice,
        midAngle,
        sx: CM_CX + anchorR * Math.cos(midAngle),
        sy: CM_CY + anchorR * Math.sin(midAngle),
        side: (Math.cos(midAngle) >= 0 ? 'right' : 'left') as 'left' | 'right',
        targetY: CM_CY + (CM_R_OUTER + 34) * Math.sin(midAngle),
      };
    });

    // Balance sides if >= 4 callouts land on one hemisphere (e.g. KHQR > 50% dominates right+bottom).
    const leftItems = items.filter((it) => it.side === 'left');
    const rightItems = items.filter((it) => it.side === 'right');
    if (leftItems.length >= 4 && rightItems.length <= 1) {
      const topMost = [...leftItems].sort((a, b) => Math.abs(Math.cos(a.midAngle)) - Math.abs(Math.cos(b.midAngle)))[0];
      if (topMost) {
        topMost.side = 'right';
        topMost.targetY = topMost.sy < CM_CY ? 24 : CM_VB_H - 24;
      }
    } else if (rightItems.length >= 4 && leftItems.length <= 1) {
      const topMost = [...rightItems].sort((a, b) => Math.abs(Math.cos(a.midAngle)) - Math.abs(Math.cos(b.midAngle)))[0];
      if (topMost) {
        topMost.side = 'left';
        topMost.targetY = topMost.sy < CM_CY ? 24 : CM_VB_H - 24;
      }
    }

    const CALLOUT_H = 30;
    const MIN_GAP = 42;
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
            ? 36
            : Math.sqrt(Math.max(0, minRingR * minRingR - dyNearest * dyNearest));
        const rawEx =
          side === 'left'
            ? Math.min(g.sx - 20, CM_CX - clearDx - 6)
            : Math.max(g.sx + 20, CM_CX + clearDx + 6);
        const ex =
          side === 'left'
            ? Math.max(98, Math.min(CM_CX - 34, rawEx))
            : Math.min(CM_VB_W - 98, Math.max(CM_CX + 34, rawEx));
        const qpx =
          side === 'left'
            ? Math.min(g.sx, Math.max(ex + 10, (g.sx + ex) / 2))
            : Math.max(g.sx, Math.min(ex - 10, (g.sx + ex) / 2));
        return {
          slice: g.slice,
          side,
          sx: g.sx,
          sy: g.sy,
          qpx,
          qpy: ey,
          ex,
          ey,
        };
      });
    };

    return [...placeSide('left'), ...placeSide('right')];
  }, [donutSlices, totalTasks]);

  const shadowFilterId = useId();

  return (
    <section
      className={`lg:col-span-4 ${cardClass} overflow-hidden flex flex-col justify-between silk-lift`}
      style={{ '--silk-i': 5 } as React.CSSProperties}
    >
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
          {loading ? (
            <span className="skeleton h-4 w-16 rounded-full inline-block" aria-hidden="true" />
          ) : (
            <span
              className={`text-[10.5px] font-figure font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
                isLight ? 'bg-slate-100/90 text-slate-600' : 'bg-slate-800 text-slate-300'
              }`}
            >
              {fmtNum(totalTasks)} tasks
            </span>
          )}
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

      <div className="px-1.5 sm:px-2 pt-0 pb-2 flex-1 flex items-center justify-center">
        {loading ? (
          <div className="relative w-full max-w-[500px] aspect-[468/356] flex items-center justify-center" role="status" aria-label="Loading channel mix">
            <div className="relative w-[196px] h-[196px] flex items-center justify-center">
              <div className="absolute inset-0 rounded-full skeleton" />
              <div className={`w-[144px] h-[144px] rounded-full flex flex-col items-center justify-center gap-2 z-10 ${isLight ? 'bg-white' : 'bg-[#0f172a]'}`}>
                <span className="skeleton h-2.5 w-14 rounded" />
                <span className="skeleton h-7 w-16 rounded-md" />
                <span className="skeleton h-3.5 w-20 rounded-full" />
              </div>
            </div>
          </div>
        ) : (
        /* Style 1: Slim Enlarged Donut + Curved Leaders + Floating Pill Callouts */
        <div className="relative w-full max-w-[500px] aspect-[468/356] flex items-center justify-center">
          <svg
            viewBox={`0 0 ${CM_VB_W} ${CM_VB_H}`}
            className="w-full h-full overflow-visible"
            role="img"
            aria-label="5-Channel Performance Donut Chart"
            data-testid="channel-mix-donut"
          >
            <defs>
              <filter id={shadowFilterId} x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#1e6091" floodOpacity={isLight ? '0.16' : '0.32'} />
              </filter>
            </defs>

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
            <g filter={`url(#${shadowFilterId})`}>
              {totalTasks > 0 && activeSlices.length === 1 && (
                <circle
                  data-donut-slice={activeSlices[0].id}
                  cx={CM_CX}
                  cy={CM_CY}
                  r={CM_R_TRACK}
                  fill="none"
                  stroke={activeSlices[0].hexColor}
                  strokeWidth={hoveredChannelId === activeSlices[0].id ? CM_TRACK_W + 4 : CM_TRACK_W}
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
                  const rInner = isFocused ? CM_R_INNER - 3 : CM_R_INNER;
                  const rOuter = isFocused ? CM_R_OUTER + 4 : CM_R_OUTER;
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
            </g>

            {/* Smooth curved Bezier leader lines anchored at slice rim */}
            {calloutLayouts.map((c) => {
              const isHovered = hoveredChannelId === c.slice.id;
              const isDimmed = hoveredChannelId !== null && hoveredChannelId !== c.slice.id;
              const lineColor = !isLight && c.slice.id === 'khqr' ? '#38bdf8' : c.slice.hexColor;
              return (
                <g
                  key={`leader-${c.slice.id}`}
                  opacity={isDimmed ? 0.24 : isHovered ? 1 : 0.72}
                  style={{ transition: 'opacity 150ms ease' }}
                >
                  <path
                    d={`M ${c.sx.toFixed(1)} ${c.sy.toFixed(1)} Q ${c.qpx.toFixed(1)} ${c.qpy.toFixed(1)} ${c.ex.toFixed(1)} ${c.ey.toFixed(1)}`}
                    fill="none"
                    stroke={lineColor}
                    strokeWidth={isHovered ? 1.85 : 1.35}
                    strokeLinecap="round"
                  />
                  <circle
                    cx={c.sx}
                    cy={c.sy}
                    r={isHovered ? 3.2 : 2.5}
                    fill={lineColor}
                  />
                </g>
              );
            })}

            {/* Elevated central frosted hub ring */}
            <circle
              cx={CM_CX}
              cy={CM_CY}
              r={CM_R_INNER - 5}
              fill={isLight ? '#ffffff' : '#0f172a'}
              stroke={isLight ? 'rgba(15, 23, 42, 0.08)' : 'rgba(148, 163, 184, 0.18)'}
              strokeWidth="1"
            />
          </svg>

          {/* Center Interactive Focus Readout */}
          <div
            className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center pointer-events-none text-center px-2"
            style={{
              left: `${(CM_CX / CM_VB_W) * 100}%`,
              top: `${(CM_CY / CM_VB_H) * 100}%`,
              width: `${(((CM_R_INNER - 5) * 1.72) / CM_VB_W) * 100}%`,
            }}
          >
            <span
              className={`inline-flex items-center gap-1 text-[10px] sm:text-[10.5px] font-bold tracking-wider uppercase truncate max-w-full ${
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
              className={`text-[28px] sm:text-[32px] font-bold font-figure leading-none tracking-tight mt-1 tabular-nums ${
                isLight ? 'text-slate-900' : 'text-white'
              }`}
            >
              {focusedChannel ? `${focusedChannel.sharePct}%` : '0%'}
            </span>
            {focusedChannel && totalTasks > 0 && (
              <span
                className={`text-[10.5px] font-figure font-semibold px-2.5 py-0.5 rounded-full mt-1.5 tabular-nums whitespace-nowrap ${
                  isLight ? 'bg-slate-100/95 text-slate-600' : 'bg-slate-800 text-slate-300'
                }`}
              >
                {formatSliceCount(focusedChannel)} tasks
              </span>
            )}
          </div>

          {/* 5 Floating Pill Callout Badges */}
          {calloutLayouts.map((c) => {
            const isHovered = hoveredChannelId === c.slice.id;
            const isDimmed = hoveredChannelId !== null && hoveredChannelId !== c.slice.id;
            const label = formatChannelLabel(c.slice.shortLabel);
            const accent = !isLight && c.slice.id === 'khqr' ? '#38bdf8' : c.slice.hexColor;
            const posStyle: React.CSSProperties =
              c.side === 'left'
                ? {
                    right: `${((CM_VB_W - c.ex) / CM_VB_W) * 100}%`,
                    top: `${(c.ey / CM_VB_H) * 100}%`,
                    transform: 'translateY(-50%)',
                  }
                : {
                    left: `${(c.ex / CM_VB_W) * 100}%`,
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
                        borderColor: accent,
                        backgroundColor: isLight ? '#ffffff' : `${accent}24`,
                      }
                    : undefined),
                }}
                className={`absolute px-2 py-1 rounded-xl border transition-all duration-150 cursor-pointer flex flex-col items-start text-left leading-tight ${
                  isHovered
                    ? 'shadow-sm'
                    : isLight
                      ? 'bg-slate-50/95 border-slate-200/90 hover:bg-white shadow-[0_1px_3px_rgba(15,23,42,0.03)]'
                      : 'bg-slate-800/90 border-slate-700/85 hover:bg-slate-800 shadow-xs'
                } ${isDimmed ? 'opacity-40' : ''}`}
              >
                <span
                  className={`inline-flex items-center gap-1.5 text-[9.5px] sm:text-[10px] font-bold whitespace-nowrap ${
                    isLight ? 'text-slate-900' : 'text-slate-100'
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: accent }} />
                  <span>{label}</span>
                </span>
                <span
                  className={`text-[9px] sm:text-[9.5px] font-figure font-semibold tabular-nums whitespace-nowrap pl-3 ${
                    isLight ? 'text-slate-500' : 'text-slate-400'
                  }`}
                >
                  <strong className="font-bold" style={{ color: isLight ? '#1e6091' : '#38bdf8' }}>
                    {c.slice.sharePct}%
                  </strong>{' '}
                  · {formatSliceCount(c.slice)}
                </span>
              </button>
            );
          })}
        </div>
        )}
      </div>
    </section>
  );
});

interface MonthlyInstallComparisonCardProps {
  isLight: boolean;
  theme?: ThemeMode;
  cardClass: string;
  horizon: InstallHorizon;
  onChangeHorizon: (horizon: InstallHorizon) => void;
  data: MonthlyInstallComparisonData;
  loading?: boolean;
  onNavigateTab?: (tab: string) => void;
}

const INSTALL_HORIZONS: InstallHorizon[] = ['3M', '6M', '12M'];

const MonthlyInstallComparisonCard = React.memo<MonthlyInstallComparisonCardProps>(({
  isLight,
  theme = 'light',
  cardClass,
  horizon,
  onChangeHorizon,
  data,
  loading = false,
  onNavigateTab,
}) => {
  const posColor = isLight ? CHANNEL_COLORS.pos : '#38bdf8';
  const sbColor = isLight ? CHANNEL_COLORS.sb : '#818cf8';
  const posShare = data.totalInstalls > 0 ? Math.round((data.totalPos / data.totalInstalls) * 100) : 0;
  const sbShare = data.totalInstalls > 0 ? 100 - posShare : 0;
  const horizonMonths = horizon === '3M' ? 3 : horizon === '6M' ? 6 : 12;

  return (
    <section
      data-testid="monthly-install-comparison-card"
      className={`lg:col-span-8 ${cardClass} overflow-hidden flex flex-col justify-between silk-lift`}
      style={{ '--silk-i': 6 } as React.CSSProperties}
    >
      <div className="px-6 pt-5 pb-2.5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
              isLight ? 'bg-[#184e77]/12 text-[#184e77]' : 'bg-sky-500/20 text-sky-300'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h3 className={`text-[15px] font-bold tracking-[-0.015em] truncate ${isLight ? 'text-slate-900' : 'text-white'}`}>
              Monthly POS &amp; Sound Box Installations
            </h3>
            <p className={`text-[12px] truncate ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              Merchant Visit app (approved &amp; pending) · trailing {horizonMonths} months
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <div
            className={`inline-flex items-center p-0.5 rounded-full border gap-0.5 ${
              isLight
                ? 'bg-slate-100/90 border-slate-200/90'
                : 'bg-slate-900/80 border-slate-700'
            }`}
            role="tablist"
            aria-label="Installation Comparison Horizon"
          >
            {INSTALL_HORIZONS.map((h) => {
              const active = horizon === h;
              return (
                <button
                  key={h}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onChangeHorizon(h)}
                  className={`relative px-2.5 py-1 rounded-full text-[11px] font-figure cursor-pointer transition-colors duration-150 ${
                    active
                      ? isLight
                        ? 'text-[#003857] font-bold'
                        : 'text-white font-bold'
                      : `${isLight ? 'text-slate-600 hover:text-slate-900' : 'text-slate-300 hover:text-white'} font-medium`
                  }`}
                >
                  {active && (
                    <PillMotion
                      layoutId="dash-hw-install-horizon-pill"
                      transition={SPRING_TAB_PILL}
                      className={`absolute inset-0 rounded-full pointer-events-none ${
                        isLight
                          ? 'bg-white shadow-[0_1px_3px_rgba(15,23,42,0.12)]'
                          : 'bg-slate-800 shadow-2xs'
                      }`}
                    />
                  )}
                  <span className="relative z-10">{h}</span>
                </button>
              );
            })}
          </div>

          {onNavigateTab && (
            <button
              type="button"
              onClick={() => onNavigateTab('mobile_sync')}
              className={`text-[11.5px] font-semibold inline-flex items-center gap-0.5 shrink-0 cursor-pointer transition-colors duration-150 ${
                isLight ? 'text-[#004e75] hover:text-[#003857]' : 'text-sky-400 hover:text-sky-300'
              }`}
            >
              App Review <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="px-6 pt-1 pb-2 flex-1 flex flex-col justify-between gap-2">
        <div
          className={`flex flex-wrap xl:flex-nowrap items-center justify-between gap-1.5 text-[10.5px] ${
            isLight ? 'text-slate-600' : 'text-slate-300'
          }`}
        >
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${
                isLight
                  ? 'bg-slate-50/90 border-slate-200/80 text-slate-800'
                  : 'bg-slate-800/75 border-slate-700/80 text-slate-100'
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ backgroundColor: posColor }} aria-hidden="true" />
              <span>POS Installation</span>
              <span className={`font-figure font-bold tabular-nums ml-0.5 ${isLight ? 'text-slate-900' : 'text-white'}`}>
                {loading ? '—' : fmtNum(data.totalPos)}
              </span>
              {!loading && data.latestPosMomText && (
                <span
                  className={`inline-flex items-center gap-1 font-figure font-semibold text-[10px] pl-1 ml-0.5 border-l ${
                    isLight ? 'border-slate-200' : 'border-slate-700'
                  } ${
                    data.latestPosMomPct === null
                      ? isLight ? 'text-sky-700' : 'text-sky-300'
                      : data.latestPosMomPct > 0
                        ? isLight ? 'text-emerald-700' : 'text-emerald-400'
                        : data.latestPosMomPct < 0
                          ? isLight ? 'text-rose-700' : 'text-rose-400'
                          : isLight ? 'text-slate-600' : 'text-slate-300'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      (data.latestPosMomPct ?? 0) > 0
                        ? isLight ? 'bg-emerald-600' : 'bg-emerald-400'
                        : (data.latestPosMomPct ?? 0) < 0
                          ? isLight ? 'bg-rose-600' : 'bg-rose-400'
                          : isLight ? 'bg-slate-600' : 'bg-slate-400'
                    }`}
                    aria-hidden="true"
                  />
                  {data.latestPosMomText}
                </span>
              )}
            </span>

            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${
                isLight
                  ? 'bg-slate-50/90 border-slate-200/80 text-slate-800'
                  : 'bg-slate-800/75 border-slate-700/80 text-slate-100'
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ backgroundColor: sbColor }} aria-hidden="true" />
              <span>Sound Box Installation</span>
              <span className={`font-figure font-bold tabular-nums ml-0.5 ${isLight ? 'text-slate-900' : 'text-white'}`}>
                {loading ? '—' : fmtNum(data.totalSb)}
              </span>
              {!loading && data.latestSbMomText && (
                <span
                  className={`inline-flex items-center gap-1 font-figure font-semibold text-[10px] pl-1 ml-0.5 border-l ${
                    isLight ? 'border-slate-200' : 'border-slate-700'
                  } ${
                    data.latestSbMomPct === null
                      ? isLight ? 'text-violet-700' : 'text-violet-300'
                      : data.latestSbMomPct > 0
                        ? isLight ? 'text-emerald-700' : 'text-emerald-400'
                        : data.latestSbMomPct < 0
                          ? isLight ? 'text-rose-700' : 'text-rose-400'
                          : isLight ? 'text-slate-600' : 'text-slate-300'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      (data.latestSbMomPct ?? 0) > 0
                        ? isLight ? 'bg-emerald-600' : 'bg-emerald-400'
                        : (data.latestSbMomPct ?? 0) < 0
                          ? isLight ? 'bg-rose-600' : 'bg-rose-400'
                          : isLight ? 'bg-slate-600' : 'bg-slate-400'
                    }`}
                    aria-hidden="true"
                  />
                  {data.latestSbMomText}
                </span>
              )}
            </span>
          </div>

          <span
            className={`text-[10.5px] font-figure font-semibold px-2.5 py-0.5 rounded-full whitespace-nowrap shrink-0 ${
              isLight ? 'bg-slate-100/90 text-slate-600' : 'bg-slate-800 text-slate-300'
            }`}
          >
            {loading
              ? 'Loading Merchant Visit records…'
              : `${horizonMonths}M · ${fmtNum(data.totalInstalls)}${data.pendingTotal > 0 ? ` (${fmtNum(data.pendingTotal)} pending)` : ' submitted'}`}
          </span>
        </div>

        {loading ? (
          <div
            className={`h-[292px] rounded-2xl border border-dashed flex flex-col items-center justify-center gap-3 ${
              isLight ? 'border-slate-200/80 bg-slate-50/60' : 'border-slate-800 bg-slate-900/40'
            }`}
            aria-busy="true"
            aria-label="Loading monthly installation chart"
          >
            <div className="flex items-end gap-2.5 h-16">
              {[0.38, 0.62, 0.45, 0.8, 0.55, 0.92].map((h, i) => (
                <div key={i} className="flex items-end gap-1">
                  <span
                    className={`w-2.5 rounded-t-sm animate-pulse ${isLight ? 'bg-slate-300/75' : 'bg-slate-700/75'}`}
                    style={{ height: `${Math.round(h * 46)}px` }}
                  />
                  <span
                    className={`w-2.5 rounded-t-sm animate-pulse ${isLight ? 'bg-slate-200/90' : 'bg-slate-800/90'}`}
                    style={{ height: `${Math.round(h * 60)}px` }}
                  />
                </div>
              ))}
            </div>
            <span className={`text-[12px] font-medium ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              Syncing Phnom Penh Merchant Visit installations…
            </span>
          </div>
        ) : (
          <GroupedBarChart
            labels={data.labels}
            series1Label="POS Installation"
            series1Data={data.pos}
            series1Color={posColor}
            series2Label="Sound Box Installation"
            series2Data={data.sb}
            series2Color={sbColor}
            height={292}
            showLegend={false}
            showMomChangeLine={true}
            priorSeries1Value={data.priorPos}
            priorSeries2Value={data.priorSb}
            theme={theme}
            ariaLabel={`Monthly POS Installation and Sound Box Installation comparison with month-to-month percentage change over trailing ${horizonMonths} months`}
          />
        )}
      </div>

      {/* Footer Summary Strip */}
      <div
        className={`px-6 py-2.5 border-t flex flex-wrap items-center justify-between gap-2 text-[11px] ${
          isLight
            ? 'border-slate-100 bg-[#f9fafb]/80 text-slate-500'
            : 'border-slate-800/70 bg-slate-900/50 text-slate-400'
        }`}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
          {!loading && data.latestLabel && (
            <span>
              Latest ({data.latestLabel}):{' '}
              <strong className={`font-figure ${isLight ? 'text-slate-900' : 'text-white'}`}>
                {fmtNum(data.latestPos)}
              </strong>{' '}
              POS ·{' '}
              <strong className={`font-figure ${isLight ? 'text-slate-900' : 'text-white'}`}>
                {fmtNum(data.latestSb)}
              </strong>{' '}
              SB
            </span>
          )}
          {!loading && data.peakMonthTotal > 0 && data.peakMonthLabel && (
            <>
              <span className={isLight ? 'text-slate-300' : 'text-slate-700'} aria-hidden="true">·</span>
              <span>
                Peak ({data.peakMonthLabel}):{' '}
                <strong className={`font-figure ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  {fmtNum(data.peakMonthTotal)}
                </strong>
              </span>
            </>
          )}
        </div>
        <span className="font-figure font-semibold whitespace-nowrap">
          {loading ? 'Loading…' : data.totalInstalls > 0 ? `POS ${posShare}% · Sound Box ${sbShare}%` : 'No installations in window'}
        </span>
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
      peakLabel = pt.fullLabel ? fmtShortDay(pt.fullLabel) : pt.label;
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
  const currentMonth = today.slice(0, 7);
  const isAdminLike = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const branchScopedId = !isAdminLike ? (selectedBranch || '') : '';

  const [viewMode, setViewMode] = useState<DashViewMode>('MONTH');
  const [selectedMonth, setSelectedMonth] = useState<string>(() => todayPP().slice(0, 7));
  const [dateFrom, setDateFrom] = useState<string>(() => todayPP());
  const [dateTo, setDateTo] = useState<string>(() => todayPP());
  const [dateMenuOpen, setDateMenuOpen] = useState(false);
  const datePickerRef = useRef<HTMLDivElement | null>(null);
  const [velocityChannel, setVelocityChannel] = useState<VelocityChannelKey>('ALL');
  const [installHorizon, setInstallHorizon] = useState<InstallHorizon>('6M');

  useEffect(() => {
    if (!dateMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (datePickerRef.current && !datePickerRef.current.contains(e.target as Node)) {
        setDateMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDateMenuOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [dateMenuOpen]);

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

  const [kpiData, setKpiData] = useState<KpiDashboardData | null>(
    () => getCachedKpiSummary(kpiPeriodRange('MONTH').from, null) || getCachedKpiSummary(null, null) || null
  );

  // Rule lookup map for KPI point valuation
  const ruleMap = useMemo(() => {
    const m = new Map<string, KpiPointRule>();
    for (const r of kpiData?.rules || []) m.set(r.code, r);
    return m;
  }, [kpiData]);

  // Only list calendar months (up to currentMonth) that have actual scoped KPI activity
  const availableMonths = useMemo(() => {
    const hasSeries = (src?: KpiDashboardData | null) =>
      Boolean(
        src &&
          ((src.dailyStaff?.length || 0) > 0 ||
            (src.monthlyStaff?.length || 0) > 0 ||
            (src.daily?.length || 0) > 0 ||
            (src.monthly?.length || 0) > 0)
      );
    const fallbackSeries = !hasSeries(kpiData) ? getCachedKpiSummary(null, null) : undefined;
    const src = kpiData && hasSeries(kpiData) ? kpiData : fallbackSeries || kpiData;

    const monthSet = new Set<string>();
    const dailyStaff = src?.dailyStaff || [];
    const monthlyStaff = src?.monthlyStaff || [];
    const t5mCutoff = shiftMonthYm(currentMonth, -5);

    for (const ds of dailyStaff) {
      if (!ds.day || ds.day.length < 7) continue;
      const total =
        (Number(ds.totalTasks) || 0) +
        (Number(ds.posTasks) || 0) +
        (Number(ds.sbTasks) || 0) +
        (Number(ds.khqrTasks) || 0) +
        (Number(ds.ccTasks) || 0) +
        (Number(ds.mvTasks) || 0);
      if (total <= 0) continue;
      const dir = ppDirectoryScope.resolveKpiStaff(ds.staffId, ds.staffName, ds.branchId, ds.branchName);
      if (!dir) continue;
      if (branchScopedId && dir.branchId !== branchScopedId) continue;
      const ym = ds.day.slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(ym) && ym <= currentMonth) monthSet.add(ym);
    }

    for (const ms of monthlyStaff) {
      if (!ms.month || ms.month.length < 7) continue;
      const pts = computeKpiPoints(ms, ruleMap);
      if (pts.totalTasks <= 0 && (ms.khqrMaterials || 0) <= 0) continue;
      const dir = ppDirectoryScope.resolveKpiStaff(ms.staffId, ms.staffName, ms.branchId, ms.branchName);
      if (!dir) continue;
      if (branchScopedId && dir.branchId !== branchScopedId) continue;
      const ym = ms.month.slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(ym) && ym <= currentMonth) monthSet.add(ym);
    }

    // Older history (7–12 months back, beyond per-staff t5m window) from monthly aggregates for admin views
    if (!branchScopedId) {
      for (const m of src?.monthly || []) {
        if (!m.period || !/^\d{4}-\d{2}$/.test(m.period) || m.period > currentMonth) continue;
        if (m.period >= t5mCutoff && (dailyStaff.length > 0 || monthlyStaff.length > 0 || ppDirectoryScope.hasDirectory)) continue;
        const pts = computeKpiPoints(m, ruleMap);
        if (pts.totalTasks > 0 || (m.khqrMaterials || 0) > 0 || (m.activeStaff || 0) > 0) {
          monthSet.add(m.period);
        }
      }
    }

    if (dailyStaff.length === 0 && monthlyStaff.length === 0 && !ppDirectoryScope.hasDirectory && !branchScopedId) {
      for (const d of src?.daily || []) {
        if (!d.period || d.period.length < 7) continue;
        const ym = d.period.slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(ym) || ym > currentMonth) continue;
        const pts = computeKpiPoints(d, ruleMap);
        if (pts.totalTasks > 0 || (d.khqrMaterials || 0) > 0 || (d.activeStaff || 0) > 0) monthSet.add(ym);
      }
    }

    if (monthSet.size === 0) {
      monthSet.add(currentMonth);
    }

    return Array.from(monthSet)
      .sort((a, b) => b.localeCompare(a))
      .map((key) => ({ key, label: fmtMonthLabel(key) }));
  }, [kpiData, ppDirectoryScope, branchScopedId, ruleMap, currentMonth]);

  const minMonthKey = availableMonths[availableMonths.length - 1]?.key || currentMonth;
  const maxMonthKey = availableMonths[0]?.key || currentMonth;

  const activeMonth = useMemo(() => {
    if (availableMonths.some((m) => m.key === selectedMonth)) return selectedMonth;
    return maxMonthKey;
  }, [availableMonths, selectedMonth, maxMonthKey]);

  const range = useMemo(() => {
    if (viewMode === 'ALL') {
      return {
        kpiFrom: null as string | null,
        kpiTo: null as string | null,
        ccFrom: null as string | null,
        ccTo: null as string | null,
        fromYmd: '',
        toYmd: '',
        label: 'All time',
      };
    }

    if (viewMode === 'MONTH') {
      const daysInMonth = monthDaysCount(activeMonth);
      const fromYmd = `${activeMonth}-01`;
      const toYmd = `${activeMonth}-${String(daysInMonth).padStart(2, '0')}`;
      const isCurrent = activeMonth === currentMonth;
      if (isCurrent) {
        const cur = kpiPeriodRange('MONTH');
        return {
          kpiFrom: cur.from,
          kpiTo: null,
          ccFrom: cur.from,
          ccTo: null,
          fromYmd,
          toYmd,
          label: fmtMonthLabel(activeMonth),
        };
      }
      const startIso = startOfPP(fromYmd);
      return {
        kpiFrom: startIso,
        kpiTo: endOfDayPP(toYmd),
        ccFrom: startIso,
        ccTo: startOfPP(addDaysYmd(toYmd, 1)),
        fromYmd,
        toYmd,
        label: fmtMonthLabel(activeMonth),
      };
    }

    const rawFrom = dateFrom || today;
    const rawTo = dateTo || rawFrom;
    const effFrom = rawFrom <= rawTo ? rawFrom : rawTo;
    const effTo = rawFrom <= rawTo ? rawTo : rawFrom;
    const startIso = startOfPP(effFrom);
    let label: string;
    if (effFrom === effTo) {
      if (effFrom === today) label = 'Today';
      else if (effFrom === addDaysYmd(today, -1)) label = 'Yesterday';
      else label = fmtLongDay(effFrom);
    } else if (effFrom.slice(0, 4) === effTo.slice(0, 4)) {
      label = `${fmtShortDay(effFrom)} – ${fmtShortDay(effTo)}`;
    } else {
      label = `${fmtLongDay(effFrom)} – ${fmtLongDay(effTo)}`;
    }

    return {
      kpiFrom: startIso,
      kpiTo: endOfDayPP(effTo),
      ccFrom: startIso,
      ccTo: startOfPP(addDaysYmd(effTo, 1)),
      fromYmd: effFrom,
      toYmd: effTo,
      label,
    };
  }, [viewMode, activeMonth, currentMonth, dateFrom, dateTo, today]);

  const [ccCounts, setCcCounts] = useState<CcCounts | null>(
    () => getCachedCcCounts(`${range.ccFrom || ''}|${range.ccTo || ''}`) || null
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
  const neededInstallDays = installHorizon === '12M' ? 430 : 220;
  const installScopeKey = `${branchScopedId || 'PP'}:${ppDirectoryScope.hasDirectory ? 'dir' : 'raw'}`;

  const [fieldInstalls, setFieldInstalls] = useState<FieldInstallSummaryRow[] | null>(
    () => getCachedMonthlyInstallFieldEvents()
  );
  const [fieldInstallsLoading, setFieldInstallsLoading] = useState<boolean>(
    () =>
      isSupabaseConfigured &&
      getCachedMonthlyInstallFieldEvents() === null &&
      getCachedMonthlyInstallBuckets(installScopeKey, neededInstallDays) === null
  );
  const [syncing, setSyncing] = useState(false);
  // (23 Nov 2026) until the first KPI answer the figure cards show a soft placeholder instead of a "0" that then jumps;
  // after a failed load they show 0 as before
  const [kpiSettled, setKpiSettled] = useState<boolean>(() => kpiData !== null);

  const periodSeqRef = useRef(0);
  const assetSeqRef = useRef(0);
  const fieldInstallsSeqRef = useRef(0);

  // Decoupled period metrics loader: period changes never refetch inventory/SIM pools
  const loadPeriodMetrics = useCallback(
    async (force = false) => {
      const seq = ++periodSeqRef.current;
      const isActive = () => seq === periodSeqRef.current;
      const hitKpi = !force ? getCachedKpiSummary(range.kpiFrom, range.kpiTo) : undefined;
      const hitCc = !force ? getCachedCcCounts(`${range.ccFrom || ''}|${range.ccTo || ''}`) : undefined;
      if (hitKpi) setKpiData(hitKpi);
      if (hitCc) setCcCounts(hitCc);
      setSyncing(!hitKpi || force);

      const kpiTask = fetchKpiSummary(range.kpiFrom, range.kpiTo, force)
        .then((val) => {
          if (isActive() && val) setKpiData(val);
        })
        .catch(() => {});
      const ccTask = fetchCcCounts(range.ccFrom, range.ccTo, force ? 0 : 45000).then((val) => {
        if (isActive() && val) setCcCounts(val);
      });

      await Promise.allSettled([kpiTask, ccTask]);
      setKpiSettled(true);
      if (isActive()) setSyncing(false);
    },
    [range.kpiFrom, range.kpiTo, range.ccFrom, range.ccTo]
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

  const loadFieldInstalls = useCallback(async (force = false, minDays = neededInstallDays, silent = false) => {
    const seq = ++fieldInstallsSeqRef.current;
    const cachedRows = getCachedMonthlyInstallFieldEvents();
    const cachedDays = getCachedMonthlyInstallFieldEventsCoveredDays();
    const hasSession = getCachedMonthlyInstallBuckets(installScopeKey, minDays) !== null;
    // (24 Nov 2026, egress) On F5 reload, reuse fresh sessionStorage monthly buckets (< 10 min) instead of
    // re-downloading 220 days of raw field_events rows; Realtime INSTALL events, 12M switch, or Sync still fetch fresh.
    if (!force && hasSession && !cachedRows) {
      setFieldInstallsLoading(false);
      return;
    }
    if (!silent && !hasSession && (!cachedRows || cachedDays < minDays)) {
      setFieldInstallsLoading(true);
    }
    const rows = await fetchMonthlyInstallFieldEvents(force, minDays);
    if (seq === fieldInstallsSeqRef.current) {
      if (rows !== null) setFieldInstalls(rows);
      setFieldInstallsLoading(false);
    }
  }, [installScopeKey, neededInstallDays]);

  const handleSyncAll = useCallback(async () => {
    setSyncing(true);
    await Promise.allSettled([
      loadPeriodMetrics(true),
      loadInventoryAndSims(true),
      loadFieldInstalls(true, neededInstallDays, true),
    ]);
    setSyncing(false);
  }, [loadPeriodMetrics, loadInventoryAndSims, loadFieldInstalls, neededInstallDays]);

  useEffect(() => {
    void loadPeriodMetrics(false);
  }, [loadPeriodMetrics]);

  useEffect(() => {
    void loadInventoryAndSims(false);
  }, [loadInventoryAndSims]);

  useEffect(() => {
    void loadFieldInstalls(false, neededInstallDays);
  }, [loadFieldInstalls, neededInstallDays]);

  // Live refresh when a staff member submits or updates an INSTALL record in the Merchant Visit app
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let timer = 0;
    const unsub = subscribeToFieldEvents((ev) => {
      if (ev.kind !== 'INSTALL') return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void loadFieldInstalls(true, neededInstallDays, true);
      }, 900);
    });
    return () => {
      window.clearTimeout(timer);
      unsub();
    };
  }, [loadFieldInstalls, neededInstallDays]);

  // Live dynamic sync across all portal domains when another user or phone app changes data
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let metricsTimer = 0;
    let assetsTimer = 0;
    let installsTimer = 0;
    const unsub = onPortalSync(
      ['kpi', 'cc', 'materials', 'devices', 'field', 'qr', 'mv', 'staff', 'branches', 'requisitions'],
      (changed: Set<SyncDomain>) => {
        if (
          changed.has('kpi') ||
          changed.has('cc') ||
          changed.has('field') ||
          changed.has('qr') ||
          changed.has('mv') ||
          changed.has('staff') ||
          changed.has('branches')
        ) {
          window.clearTimeout(metricsTimer);
          metricsTimer = window.setTimeout(() => {
            void loadPeriodMetrics(true);
          }, 700);
        }
        if (changed.has('materials') || changed.has('devices') || changed.has('requisitions')) {
          window.clearTimeout(assetsTimer);
          assetsTimer = window.setTimeout(() => {
            void loadInventoryAndSims(true);
          }, 500);
        }
        if (changed.has('field')) {
          window.clearTimeout(installsTimer);
          installsTimer = window.setTimeout(() => {
            void loadFieldInstalls(true, neededInstallDays, true);
          }, 800);
        }
      }
    );
    return () => {
      window.clearTimeout(metricsTimer);
      window.clearTimeout(assetsTimer);
      window.clearTimeout(installsTimer);
      unsub();
    };
  }, [loadPeriodMetrics, loadInventoryAndSims, loadFieldInstalls, neededInstallDays]);

  // Idle background warm-up of only the default KPI Performance slice (All time) after initial load settles
  // (avoids firing 6 speculative RPCs right after sign-in while stock & dashboard are loading)
  useEffect(() => {
    if (!isSupabaseConfigured || !kpiData || syncing) return;
    if (getCachedKpiSummary(null, null)) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled || getCachedKpiSummary(null, null)) return;
      void fetchKpiSummary(null, null, false).catch(() => {});
    }, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [kpiData, syncing]);

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

  // Full-month (or date/range-scoped) Daily Cross-Channel Velocity time series (matches KPI Performance daily totals)
  const velocitySeries: CrossChannelDayPoint[] = useMemo(() => {
    const fallbackKpi = !kpiData?.dailyStaff?.length
      ? getCachedKpiSummary(kpiPeriodRange('MONTH').from, kpiPeriodRange('MONTH').to) ??
        getCachedKpiSummary(null, null)
      : undefined;
    const dailyStaff = (kpiData?.dailyStaff?.length ? kpiData.dailyStaff : fallbackKpi?.dailyStaff) || [];
    const { fromYmd, toYmd } = range;
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
      if (toYmd && ds.day > toYmd) continue;
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
        if (toYmd && bucket.period > toYmd) continue;
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

    // Build contiguous period window: selected calendar month for MONTH (day 1 to last day of month),
    // selected date / range for DATE, and rolling 30 days for ALL
    const daysOut: string[] = [];
    if (viewMode === 'DATE') {
      const span = Math.max(0, diffDaysYmd(fromYmd, toYmd));
      const loopStart = span > 180 ? addDaysYmd(toYmd, -179) : fromYmd;
      const count = Math.max(0, diffDaysYmd(loopStart, toYmd));
      for (let i = 0; i <= count; i++) {
        daysOut.push(addDaysYmd(loopStart, i));
      }
    } else if (viewMode === 'MONTH') {
      const daysInMonth = monthDaysCount(activeMonth);
      for (let d = 1; d <= daysInMonth; d++) {
        daysOut.push(`${activeMonth}-${String(d).padStart(2, '0')}`);
      }
    } else {
      for (let i = 29; i >= 0; i--) {
        daysOut.push(addDaysYmd(today, -i));
      }
    }

    const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const workingDaysMode = kpiData?.targets?.workingDaysMode;

    return daysOut.map((ymd) => {
      const hit = byDay.get(ymd);
      const parsedMs = Date.parse(`${ymd}T00:00:00Z`);
      const utcDay = Number.isNaN(parsedMs) ? -1 : new Date(parsedMs).getUTCDay();
      const holidayName = getCambodiaHoliday(ymd);
      const isWeekend =
        utcDay >= 0
          ? workingDaysMode === 'mon_sat'
            ? utcDay === 0
            : isWeekendDay(ymd)
          : false;
      return {
        label: fmtDayOfMonth(ymd),
        fullLabel: ymd,
        pos: hit?.pos || 0,
        sb: hit?.sb || 0,
        khqr: hit?.khqr || 0,
        mv: hit?.mv || 0,
        cc: hit?.cc || 0,
        activeStaff: hit ? (hit.staffCountHint ?? hit.staff.size) : 0,
        activeBranches: hit ? (hit.branchCountHint ?? hit.branches.size) : 0,
        isFuture: ymd > today,
        isWeekend,
        holidayName,
        dayOfWeek: utcDay >= 0 ? weekdayNames[utcDay] : undefined,
      };
    });
  }, [kpiData, range.fromYmd, range.toYmd, viewMode, activeMonth, today, ppDirectoryScope, branchScopedId, ruleMap]);

  // Hardware & Inventory metrics (already scoped by App.tsx to Phnom Penh + Active Staff Directory)
  const hardwareSource = useMemo(
    () => (branchScopedId ? devices : allDevices.length > 0 ? allDevices : devices),
    [branchScopedId, allDevices, devices]
  );
  const activeDevices = useMemo(() => hardwareSource.filter((d) => !d.archived), [hardwareSource]);

  // Fast server-side POS Battery Summary so Dashboard never shows 0% / 0 POS while full 27k devices load on sign-in
  const batteryBranchIds = useMemo<string[] | null>(() => {
    if (branchScopedId) return [branchScopedId];
    const scoped = branches.filter((b) => ppDirectoryScope.isBranchInScope(b.id)).map((b) => b.id);
    return scoped.length > 0 ? scoped : null;
  }, [branchScopedId, branches, ppDirectoryScope]);
  const [serverBatterySummary, setServerBatterySummary] = useState<PosBatterySummary | null>(() =>
    getCachedPosBatterySummary(batteryBranchIds, batteryLifespanMonths, batteryWarningMonths)
  );
  const [batterySettled, setBatterySettled] = useState<boolean>(
    () => !isSupabaseConfigured || activeDevices.length > 0 || serverBatterySummary !== null
  );
  useEffect(() => {
    if (activeDevices.length > 0) {
      setBatterySettled(true);
      return;
    }
    if (!isSupabaseConfigured) return;
    let alive = true;
    const hit = getCachedPosBatterySummary(batteryBranchIds, batteryLifespanMonths, batteryWarningMonths);
    if (hit) {
      setServerBatterySummary(hit);
      setBatterySettled(true);
    }
    fetchPosBatterySummary(batteryBranchIds, batteryLifespanMonths, batteryWarningMonths)
      .then((res) => {
        if (!alive) return;
        if (res) setServerBatterySummary(res);
        setBatterySettled(true);
      })
      .catch(() => {
        if (alive) setBatterySettled(true);
      });
    return () => { alive = false; };
  }, [activeDevices.length, batteryBranchIds, batteryLifespanMonths, batteryWarningMonths]);

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
    const liveMidSet = new Set<string>();
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
        if (d.stage === 'COMPLETE') {
          liveMidSet.add(merchantKey);
        }
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
      liveUniqueMerchants: liveMidSet.size,
      hq: stages.HQ_STOCK || 0,
      reserve: stages.BRANCH_RESERVE || 0,
      config: stages.CONFIGURING || 0,
      installed: stages.COMPLETE || 0,
      faulty: stages.FAULTY || 0,
      lost: stages.LOST || 0,
    };
  }, [activeDevices, serverStageCounts, serverTotalDevices]);

  // POS Terminal Battery lifecycle status (compliance & age cohorts)
  const batterySummary = useMemo(() => {
    if (activeDevices.length === 0 && serverBatterySummary) {
      return serverBatterySummary;
    }
    let healthy = 0;
    let replaceSoon = 0;
    let critical = 0;
    let noDate = 0;
    let fresh0to11 = 0;
    let mid12toWarn = 0;
    let monthsSum = 0;

    for (const d of activeDevices) {
      if (d.type !== 'POS Terminal') continue;

      if (!d.batteryInstalledDate && !d.stockInDate && !d.deployedDate) {
        noDate++;
        continue;
      }
      const st = getBatteryLifecycleStatus(d, today);
      const used = st.monthsUsed;
      monthsSum += used;

      if (used >= batteryLifespanMonths) {
        critical++;
      } else if (used >= batteryWarningMonths) {
        replaceSoon++;
      } else {
        healthy++;
        if (used < 12) fresh0to11++;
        else mid12toWarn++;
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
      fresh0to11,
      mid12toWarn,
      avgMonthsUsed,
      avgLifePct,
    };
  }, [activeDevices, serverBatterySummary, today, batteryLifespanMonths, batteryWarningMonths]);

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

    // Merge kit items derived from active hardware (Battery, Adaptors, Stands, Docks) to match POS/SB tabs
    const derivedKits = deriveDeviceKitMaterials(activeDevices);
    for (const item of derivedKits) {
      if (item.code === 'SIM') continue;
      const entry = kitByCode.get(item.code);
      if (!entry) continue;
      if (item.status === 'HQ_STOCK' || item.status === 'BRANCH_RESERVE') {
        kitOnHand += 1;
        entry.onHand += 1;
      } else if (item.status === 'IN_TRANSIT') {
        kitInTransit += 1;
        entry.inTransit += 1;
      } else if (item.status === 'AT_MERCHANT') {
        kitAtMerchant += 1;
        entry.atMerchant += 1;
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
  }, [simCounts, matBalances, branchScopedId, ppDirectoryScope, activeDevices]);

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

  const sessionInstallBuckets = useMemo(
    () => (fieldInstalls === null ? getCachedMonthlyInstallBuckets(installScopeKey, neededInstallDays) : null),
    [fieldInstalls, installScopeKey, neededInstallDays]
  );

  // Latest-revision deduplicated POS & Sound Box INSTALL submissions (`APPROVED` + `PENDING`) from Merchant Visit review
  const scopedFieldInstalls = useMemo(() => {
    if (fieldInstalls === null) return null;
    const latestByRecord = new Map<string, FieldInstallSummaryRow>();
    for (let i = 0; i < fieldInstalls.length; i++) {
      const e = fieldInstalls[i];
      if (e.status !== 'APPROVED' && e.status !== 'PENDING') continue;
      const recKey = e.sourceRecordId ? `${e.sourceRecordId}::${e.unitNo}` : `id:${e.id}`;
      const prev = latestByRecord.get(recKey);
      if (!prev || e.revision > prev.revision || (e.revision === prev.revision && e.id > prev.id)) {
        latestByRecord.set(recKey, e);
      }
    }
    const rows: Array<FieldInstallSummaryRow & { recKey: string; ym: string; merchantKey: string }> = [];
    latestByRecord.forEach((e, recKey) => {
      const hasStaffMeta = Boolean((e.staffId || '').trim() || (e.staffName || '').trim());
      const dir = ppDirectoryScope.resolveKpiStaff(e.staffId, e.staffName, e.branchId, e.branchText);
      let resolvedBranchId = dir?.branchId || '';
      if (!dir) {
        if (hasStaffMeta && ppDirectoryScope.hasDirectory) return;
        const fbBranch = String(e.branchId || '').trim();
        if (!ppDirectoryScope.isBranchInScope(fbBranch, e.branchText)) return;
        resolvedBranchId = fbBranch;
      }
      if (branchScopedId && resolvedBranchId !== branchScopedId) return;
      const merchantKey = (e.mid || e.outletName || e.terminalName || '').trim().toUpperCase();
      rows.push({
        ...e,
        recKey,
        ym: fieldEventMonthPP(e.recordedAt, e.receivedAt),
        merchantKey,
      });
    });
    return rows;
  }, [fieldInstalls, ppDirectoryScope, branchScopedId]);

  // Hardware Deployments KPI: total POS + Sound Box installations from Merchant Visit review (approved + pending)
  const deploymentSummary = useMemo(() => {
    if (scopedFieldInstalls !== null) {
      let pos = 0;
      let sb = 0;
      let pendingTotal = 0;
      const merchantSet = new Set<string>();
      for (let i = 0; i < scopedFieldInstalls.length; i++) {
        const e = scopedFieldInstalls[i];
        if (e.deviceType === 'Sound Box') sb++;
        else pos++;
        if (e.status === 'PENDING') pendingTotal++;
        merchantSet.add(e.merchantKey || e.recKey);
      }
      const total = pos + sb;
      return {
        total,
        pos,
        sb,
        pendingTotal,
        approvedTotal: total - pendingTotal,
        uniqueMerchants: merchantSet.size,
        fromReview: true,
      };
    }
    if (sessionInstallBuckets) {
      let pos = 0;
      let sb = 0;
      let pendingTotal = 0;
      for (const b of sessionInstallBuckets.buckets) {
        pos += b.pos;
        sb += b.sb;
        pendingTotal += b.pendingPos + b.pendingSb;
      }
      const total = pos + sb;
      return {
        total,
        pos,
        sb,
        pendingTotal,
        approvedTotal: Math.max(0, total - pendingTotal),
        uniqueMerchants: sessionInstallBuckets.totalMerchants ?? hardwareSummary.uniqueMerchants,
        fromReview: true,
      };
    }
    if (!isSupabaseConfigured || !fieldInstallsLoading) {
      return {
        total: hardwareSummary.installed,
        pos: hardwareSummary.posInstalled,
        sb: hardwareSummary.sbInstalled,
        pendingTotal: 0,
        approvedTotal: hardwareSummary.installed,
        uniqueMerchants: hardwareSummary.uniqueMerchants,
        fromReview: false,
      };
    }
    return {
      total: 0,
      pos: 0,
      sb: 0,
      pendingTotal: 0,
      approvedTotal: 0,
      uniqueMerchants: 0,
      fromReview: true,
    };
  }, [scopedFieldInstalls, sessionInstallBuckets, fieldInstallsLoading, hardwareSummary]);

  // Monthly POS Installation vs Sound Box Installation from Merchant Visit app (approved + pending updates)
  const monthlyInstallComparison = useMemo<MonthlyInstallComparisonData>(() => {
    const months = lastMonthsPP(13);
    const map = new Map<
      string,
      { key: string; label: string; pos: number; sb: number; pendingPos: number; pendingSb: number }
    >();
    const list = months.map((m) => {
      const entry = {
        key: m.key,
        label: `${m.label.slice(0, 3)} ${m.label.slice(-2)}`,
        pos: 0,
        sb: 0,
        pendingPos: 0,
        pendingSb: 0,
      };
      map.set(m.key, entry);
      return entry;
    });

    if (scopedFieldInstalls !== null) {
      for (let i = 0; i < scopedFieldInstalls.length; i++) {
        const e = scopedFieldInstalls[i];
        const bucket = map.get(e.ym);
        if (!bucket) continue;
        if (e.deviceType === 'Sound Box') {
          bucket.sb++;
          if (e.status === 'PENDING') bucket.pendingSb++;
        } else {
          bucket.pos++;
          if (e.status === 'PENDING') bucket.pendingPos++;
        }
      }
    } else if (sessionInstallBuckets) {
      for (const b of sessionInstallBuckets.buckets) {
        const bucket = map.get(b.key);
        if (!bucket) continue;
        bucket.pos = b.pos;
        bucket.sb = b.sb;
        bucket.pendingPos = b.pendingPos;
        bucket.pendingSb = b.pendingSb;
      }
    } else if (!fieldInstallsLoading && kpiData?.monthlyStaff?.length) {
      // Fallback only if field_events fetch failed: aggregate strictly scoped Phnom Penh Staff Directory rows
      for (const ms of kpiData.monthlyStaff) {
        const dir = ppDirectoryScope.resolveKpiStaff(ms.staffId, ms.staffName, ms.branchId, ms.branchName);
        if (!dir) continue;
        if (branchScopedId && dir.branchId !== branchScopedId) continue;
        const bucket = map.get(ms.month);
        if (!bucket) continue;
        bucket.pos += Number(ms.posInstall) || 0;
        bucket.sb += Number(ms.sbInstall) || 0;
      }
    } else if (!fieldInstallsLoading && !ppDirectoryScope.hasDirectory && !branchScopedId && kpiData?.monthly?.length) {
      // Last-resort fallback only when Staff Directory scoping is completely unavailable
      for (const m of kpiData.monthly) {
        const bucket = map.get(m.period);
        if (!bucket) continue;
        bucket.pos += Number(m.posInstall) || 0;
        bucket.sb += Number(m.sbInstall) || 0;
      }
    }

    const horizonCount = installHorizon === '3M' ? 3 : installHorizon === '6M' ? 6 : 12;
    const sliced = list.slice(-horizonCount);
    const priorEntry = list[list.length - horizonCount - 1];
    let totalPos = 0;
    let totalSb = 0;
    let pendingTotal = 0;
    let peakMonthLabel = '';
    let peakMonthTotal = 0;
    for (const row of sliced) {
      totalPos += row.pos;
      totalSb += row.sb;
      pendingTotal += row.pendingPos + row.pendingSb;
      const tot = row.pos + row.sb;
      if (tot > peakMonthTotal) {
        peakMonthTotal = tot;
        peakMonthLabel = row.label;
      }
    }
    const latest = sliced[sliced.length - 1];
    const prevLatest = sliced.length >= 2 ? sliced[sliced.length - 2] : priorEntry;
    const calcSeriesMom = (cur: number, prev: number) => {
      if (prev > 0) {
        const pct = ((cur - prev) / prev) * 100;
        const rounded = Math.abs(pct) > 0 && Math.abs(pct) < 10 ? Number(pct.toFixed(1)) : Math.round(pct);
        return {
          pct,
          text: rounded > 0 ? `+${fmtNum(rounded)}%` : rounded < 0 ? `-${fmtNum(Math.abs(rounded))}%` : '0%',
        };
      }
      return { pct: null, text: '' };
    };
    const posMom = calcSeriesMom(latest?.pos || 0, prevLatest?.pos || 0);
    const sbMom = calcSeriesMom(latest?.sb || 0, prevLatest?.sb || 0);
    return {
      labels: sliced.map((x) => x.label),
      pos: sliced.map((x) => x.pos),
      sb: sliced.map((x) => x.sb),
      priorPos: priorEntry?.pos,
      priorSb: priorEntry?.sb,
      latestPosMomPct: posMom.pct,
      latestPosMomText: posMom.text,
      latestSbMomPct: sbMom.pct,
      latestSbMomText: sbMom.text,
      totalPos,
      totalSb,
      totalInstalls: totalPos + totalSb,
      pendingTotal,
      latestLabel: latest?.label || '',
      latestPos: latest?.pos || 0,
      latestSb: latest?.sb || 0,
      peakMonthLabel,
      peakMonthTotal,
      allBuckets: list.map(({ key, pos, sb, pendingPos, pendingSb }) => ({ key, pos, sb, pendingPos, pendingSb })),
    };
  }, [scopedFieldInstalls, fieldInstallsLoading, sessionInstallBuckets, kpiData, ppDirectoryScope, branchScopedId, installHorizon]);

  useEffect(() => {
    if (scopedFieldInstalls === null) return;
    const covered = getCachedMonthlyInstallFieldEventsCoveredDays();
    if (covered >= 220 && monthlyInstallComparison.allBuckets) {
      setCachedMonthlyInstallBuckets(installScopeKey, covered, monthlyInstallComparison.allBuckets, deploymentSummary.uniqueMerchants);
    }
  }, [scopedFieldInstalls, installScopeKey, monthlyInstallComparison, deploymentSummary.uniqueMerchants]);

  // Recent updated serials (fast O(N) top-6 single-pass scan preserved)
  const recentDevices = useKeptMemo('dash.recent', () => {
    const cmp = TEXT_ORDER.compare;   // (23 Nov 2026, speed) same order as localeCompare, without a new collator per call
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
              if (cmp(keys[m], keys[n]) < 0) {
                [top[m], top[n]] = [top[n], top[m]];
                [keys[m], keys[n]] = [keys[n], keys[m]];
              }
            }
          }
        }
      } else if (cmp(key, keys[5]) > 0) {
        top[5] = dev;
        keys[5] = key;
        for (let m = 5; m > 0; m--) {
          if (cmp(keys[m], keys[m - 1]) > 0) {
            [top[m], top[m - 1]] = [top[m - 1], top[m]];
            [keys[m], keys[m - 1]] = [keys[m - 1], keys[m]];
          } else break;
        }
      }
    }
    return top;
  }, [activeDevices]);

  const activePeriodLabel = range.label;
  const branchScopeDisplay = branchScopedId
    ? `Branch Code ${branchScopedId}`
    : `Phnom Penh · ${fmtNum(branches.length)} branches`;

  const kpiPending = isSupabaseConfigured && kpiData === null && !kpiSettled;
  const installsPending = isSupabaseConfigured && scopedFieldInstalls === null && fieldInstallsLoading;
  const queuesPending = Boolean(actionQueues?.loading);
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
        peakLabel = pt.fullLabel ? fmtShortDay(pt.fullLabel) : pt.label;
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

  const isLight = theme !== 'dark';
  const iosCardClass = isLight
    ? 'rounded-[22px] bg-white border border-slate-200/70 shadow-[0_1px_10px_rgba(15,23,42,0.025)] text-slate-900'
    : 'rounded-[22px] bg-[#161a24] border border-slate-800 text-slate-100';
  const kpiCardClass = isLight
    ? 'bg-[#f8f9fb] border border-slate-200/55 text-[#0f172a]'
    : 'bg-[#1e2330] border border-slate-800 text-slate-100';
  const kpiInteractiveClass = onNavigateTab
    ? isLight
      ? 'cursor-pointer group transition-[transform,box-shadow,border-color,background-color] duration-150 ease-out hover:-translate-y-[1.5px] hover:bg-white hover:border-[#155484]/35 hover:shadow-[0_8px_20px_-8px_rgba(21,84,132,0.18)] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#155484]/40'
      : 'cursor-pointer group transition-[transform,box-shadow,border-color,background-color] duration-150 ease-out hover:-translate-y-[1.5px] hover:border-sky-400/40 hover:bg-[#232938] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50'
    : '';
  const kpiHeadingClass = isLight ? 'text-slate-700' : 'text-white';
  const kpiSubtextClass = isLight ? 'text-slate-500' : 'text-slate-400';
  const kpiFooterBorderClass = isLight ? 'border-slate-200/50' : 'border-slate-800/80';

  const kpiSparklines = useMemo(() => {
    const activePeriodDays = velocitySeries.filter((p) => !p.isFuture);
    // When a single day is selected, build a trailing 14-day curve anchored on that date so the mini graph still displays movement
    let sparkDays = activePeriodDays;
    if (sparkDays.length <= 1) {
      const sparkAnchor = range.toYmd && range.toYmd < today ? range.toYmd : today;
      const monthFallback =
        (kpiData?.dailyStaff?.length ? kpiData.dailyStaff : undefined) ??
        getCachedKpiSummary(kpiPeriodRange('MONTH').from, kpiPeriodRange('MONTH').to)?.dailyStaff ??
        getCachedKpiSummary(null, null)?.dailyStaff ??
        [];
      const byDayMap = new Map<string, CrossChannelDayPoint>();
      for (let i = 13; i >= 0; i--) {
        const ymd = addDaysYmd(sparkAnchor, -i);
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

    const tasksVals = sparkDays.map((p) => p.pos + p.sb + p.khqr + p.mv + p.cc);
    const deploymentVals = sparkDays.map((p) => p.pos + p.sb);
    const reachVals = sparkDays.map((p) => p.khqr + p.mv + p.cc);

    // Approval Queue: trailing 6-month pending installation backlog trajectory (falls back to current queue total)
    const pendingHistVals = (monthlyInstallComparison.allBuckets || [])
      .slice(-6)
      .map((b) => b.pendingPos + b.pendingSb);
    const hasPendingHist = pendingHistVals.some((v) => v > 0);
    const queueVals = hasPendingHist ? pendingHistVals : [queues.total, queues.total];

    return {
      tasks: analyzeSparkTrend(tasksVals, { isLight, unitLabel: 'field tasks' }),
      deployments: analyzeSparkTrend(deploymentVals, { isLight, unitLabel: 'hardware ops' }),
      queue: analyzeSparkTrend(queueVals, {
        invertSentiment: true,
        isLight,
        unitLabel: 'approval queue',
        negativeHex: isLight ? '#d97706' : '#fbbf24',
      }),
      outreach: analyzeSparkTrend(reachVals, { isLight, unitLabel: 'merchant outreach' }),
    };
  }, [velocitySeries, kpiData?.dailyStaff, range.toYmd, today, ppDirectoryScope, branchScopedId, monthlyInstallComparison.allBuckets, queues.total, isLight]);

  const effDateFrom = range.fromYmd || today;
  const effDateTo = range.toYmd || effDateFrom;
  const isSingleDateSelected = viewMode === 'DATE' && effDateFrom === effDateTo;
  const dateStepDays = isSingleDateSelected ? 1 : Math.max(1, diffDaysYmd(effDateFrom, effDateTo) + 1);
  const canStepDateForward = isSingleDateSelected
    ? effDateTo < today
    : addDaysYmd(effDateFrom, dateStepDays) <= today;

  const stepSelectedDate = (direction: -1 | 1) => {
    const delta = direction * dateStepDays;
    if (isSingleDateSelected) {
      const candidate = addDaysYmd(effDateFrom, delta);
      const clamped = candidate > today ? today : candidate;
      setDateFrom(clamped);
      setDateTo(clamped);
      return;
    }
    const nextFrom = addDaysYmd(effDateFrom, delta);
    const nextTo = addDaysYmd(effDateTo, delta);
    if (direction > 0 && nextFrom > today) return;
    setDateFrom(nextFrom);
    setDateTo(nextTo > today ? today : nextTo);
  };

  const stepSelectedMonth = (direction: -1 | 1) => {
    const idx = availableMonths.findIndex((m) => m.key === activeMonth);
    if (idx < 0) return;
    const nextIdx = direction < 0 ? idx + 1 : idx - 1;
    if (nextIdx >= 0 && nextIdx < availableMonths.length) {
      setSelectedMonth(availableMonths[nextIdx].key);
    }
  };

  const dateButtonLabel = formatDateButtonLabel(effDateFrom, effDateTo, today);

  return (
    <div className="space-y-5 apple-tab-panel" aria-label="Executive Operations Overview">
      {/* ───────────── 1 & 2. iOS MINIMAL HERO + 4 INSET KPI SQUIRCLES ───────────── */}
      <div
        data-hero-backdrop="dashboard"
        className={`relative ${dateMenuOpen ? 'z-30' : ''} space-y-4`}
      >
        <div className="relative z-20 px-1 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className={`w-9 h-9 rounded-[11px] flex items-center justify-center shrink-0 shadow-xs ${
                isLight
                  ? 'bg-gradient-to-br from-[#005bb5] to-[#0ea5e9] text-white'
                  : 'bg-gradient-to-br from-sky-500 to-indigo-500 text-white'
              }`}
            >
              <BarChart3 className="w-5 h-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className={`text-xl sm:text-[22px] 2xl:text-[24px] sm:whitespace-nowrap font-extrabold tracking-[-0.025em] leading-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>
                {branchScopedId
                  ? `Branch Code ${branchScopedId} Operations Overview`
                  : 'Executive Operations Overview'}
              </h1>
              <p className={`text-[13px] leading-relaxed mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-300'}`}>
                <span className={`font-semibold ${isLight ? 'text-slate-700' : 'text-slate-200'}`}>{branchScopeDisplay}</span>
                <span className="mx-1.5 text-slate-400" aria-hidden="true">·</span>
                {kpiPending ? (
                  <span className="inline-block skeleton h-3.5 w-40 align-middle rounded" aria-hidden="true" />
                ) : (
                  <span>{fmtNum(scopedKpiTotals.activeStaffCount)} active staff across 5 field channels</span>
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap xl:flex-nowrap xl:justify-end items-center gap-1.5 shrink-0">
            {/* iOS View Mode Switcher: Date / Month (default: current month) / All */}
            <div
              className={`inline-flex items-center p-1 rounded-full border gap-0.5 ${
                isLight
                  ? 'bg-slate-200/75 border-slate-200/90'
                  : 'bg-slate-900/80 border-slate-700'
              }`}
              role="tablist"
              aria-label="Dashboard Time Period"
            >
              {VIEW_MODE_OPTIONS.map((opt) => {
                const active = viewMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      setViewMode(opt.id);
                      if (opt.id !== 'DATE') setDateMenuOpen(false);
                    }}
                    className={`relative px-3 py-1 rounded-full text-xs cursor-pointer transition-colors duration-150 ${
                      active
                        ? isLight
                          ? 'text-[#003857] font-bold'
                          : 'text-white font-bold'
                        : `${isLight ? 'text-slate-600 hover:text-slate-900' : 'text-slate-300 hover:text-white'} font-medium`
                    }`}
                  >
                    {active && (
                      <PillMotion
                        layoutId="dash-period-pill"
                        transition={SPRING_TAB_PILL}
                        className={`absolute inset-0 rounded-full pointer-events-none ${
                          isLight
                            ? 'bg-white shadow-[0_1px_4px_rgba(15,23,42,0.12)]'
                            : 'bg-slate-800 shadow-2xs'
                        }`}
                      />
                    )}
                    <span className="relative z-10">{opt.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Contextual Month Selector (shown when Month view is active) */}
            {viewMode === 'MONTH' && (
              <div
                className={`inline-flex items-center p-0.5 rounded-full border gap-0.5 ${
                  isLight
                    ? 'bg-white border-slate-200/90 text-slate-700 shadow-2xs'
                    : 'bg-slate-900/80 border-slate-700 text-slate-200'
                }`}
              >
                <button
                  type="button"
                  disabled={activeMonth <= minMonthKey}
                  onClick={() => stepSelectedMonth(-1)}
                  aria-label="Previous month"
                  title="Previous month"
                  className={`p-1 rounded-full transition-colors cursor-pointer disabled:opacity-35 disabled:pointer-events-none ${
                    isLight ? 'hover:bg-slate-200/70 text-slate-600' : 'hover:bg-slate-800 text-slate-300'
                  }`}
                >
                  <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
                <div className="relative inline-flex items-center">
                  <Calendar
                    className={`w-3.5 h-3.5 ml-1.5 pointer-events-none shrink-0 ${
                      isLight ? 'text-[#004e75]' : 'text-sky-400'
                    }`}
                    aria-hidden="true"
                  />
                  <select
                    aria-label="Select month"
                    value={activeMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    style={{ colorScheme: isLight ? 'light' : 'dark' }}
                    className={`appearance-none bg-transparent pl-1.5 pr-5 py-1 text-xs font-semibold outline-none cursor-pointer ${
                      isLight ? 'text-slate-800' : 'text-slate-100'
                    }`}
                  >
                    {availableMonths.map((m) => (
                      <option
                        key={m.key}
                        value={m.key}
                        className={isLight ? 'bg-white text-slate-800' : 'bg-slate-900 text-slate-100'}
                      >
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    className={`w-3 h-3 absolute right-1.5 pointer-events-none ${
                      isLight ? 'text-slate-500' : 'text-slate-400'
                    }`}
                    aria-hidden="true"
                  />
                </div>
                <button
                  type="button"
                  disabled={activeMonth >= maxMonthKey}
                  onClick={() => stepSelectedMonth(1)}
                  aria-label="Next month"
                  title="Next month"
                  className={`p-1 rounded-full transition-colors cursor-pointer disabled:opacity-35 disabled:pointer-events-none ${
                    isLight ? 'hover:bg-slate-200/70 text-slate-600' : 'hover:bg-slate-800 text-slate-300'
                  }`}
                >
                  <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            )}

            {/* Contextual Date / Date-Range Selector (shown when Date view is active) */}
            {viewMode === 'DATE' && (
              <div ref={datePickerRef} className="relative">
                <div
                  className={`inline-flex items-center p-0.5 rounded-full border gap-0.5 ${
                    isLight
                      ? 'bg-white border-slate-200/90 text-slate-700 shadow-2xs'
                      : 'bg-slate-900/80 border-slate-700 text-slate-200'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => stepSelectedDate(-1)}
                    aria-label="Previous date"
                    title="Previous date"
                    className={`p-1 rounded-full transition-colors cursor-pointer ${
                      isLight ? 'hover:bg-slate-200/70 text-slate-600' : 'hover:bg-slate-800 text-slate-300'
                    }`}
                  >
                    <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDateMenuOpen((v) => !v)}
                    aria-expanded={dateMenuOpen}
                    aria-haspopup="dialog"
                    aria-label="Select specific date or range"
                    className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${
                      isLight ? 'hover:bg-slate-200/60 text-slate-800' : 'hover:bg-slate-800 text-slate-100'
                    }`}
                  >
                    <Calendar
                      className={`w-3.5 h-3.5 shrink-0 ${isLight ? 'text-[#004e75]' : 'text-sky-400'}`}
                      aria-hidden="true"
                    />
                    <span>{dateButtonLabel}</span>
                    <ChevronDown
                      className={`w-3 h-3 shrink-0 transition-transform duration-150 ${
                        dateMenuOpen ? 'rotate-180' : ''
                      } ${isLight ? 'text-slate-500' : 'text-slate-400'}`}
                      aria-hidden="true"
                    />
                  </button>
                  <button
                    type="button"
                    disabled={!canStepDateForward}
                    onClick={() => stepSelectedDate(1)}
                    aria-label="Next date"
                    title="Next date"
                    className={`p-1 rounded-full transition-colors cursor-pointer disabled:opacity-35 disabled:pointer-events-none ${
                      isLight ? 'hover:bg-slate-200/70 text-slate-600' : 'hover:bg-slate-800 text-slate-300'
                    }`}
                  >
                    <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>

                {dateMenuOpen && (
                  <div
                    role="dialog"
                    aria-label="Select Dashboard Date"
                    className={`absolute left-0 sm:left-auto sm:right-0 top-full mt-2 w-[min(336px,calc(100vw-2.5rem))] rounded-2xl border shadow-xl p-3.5 z-50 space-y-3 ${
                      isLight
                        ? 'bg-white border-slate-200/90 text-slate-800'
                        : 'bg-[#1a1f2c] border-slate-700 text-slate-100'
                    }`}
                  >
                    <div>
                      <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                        Quick Picks
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(() => {
                          const yest = addDaysYmd(today, -1);
                          const wkStart = weekMondayYmd(today);
                          const wkEnd = addDaysYmd(wkStart, 6);
                          const presets = [
                            { label: 'Today', from: today, to: today },
                            { label: 'Yesterday', from: yest, to: yest },
                            { label: 'This Week', from: wkStart, to: wkEnd },
                            { label: 'Last 7 Days', from: addDaysYmd(today, -6), to: today },
                            { label: 'Last 30 Days', from: addDaysYmd(today, -29), to: today },
                          ];
                          return presets.map((p) => {
                            const active = effDateFrom === p.from && effDateTo === p.to;
                            return (
                              <button
                                key={p.label}
                                type="button"
                                onClick={() => {
                                  setDateFrom(p.from);
                                  setDateTo(p.to);
                                  setDateMenuOpen(false);
                                }}
                                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer ${
                                  active
                                    ? isLight
                                      ? 'bg-[#004e75] text-white border-[#004e75] font-semibold shadow-2xs'
                                      : 'bg-sky-600 text-white border-sky-500 font-semibold shadow-2xs'
                                    : isLight
                                      ? 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                                      : 'bg-slate-800/80 hover:bg-slate-800 text-slate-200 border-slate-700'
                                }`}
                              >
                                {p.label}
                              </button>
                            );
                          });
                        })()}
                      </div>
                    </div>

                    <div className={`pt-2.5 border-t ${isLight ? 'border-slate-100' : 'border-slate-800'}`}>
                      <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                        Select Specific Date
                      </div>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="date"
                          value={isSingleDateSelected ? effDateFrom : ''}
                          max={today}
                          aria-label="Select date"
                          style={{ colorScheme: isLight ? 'light' : 'dark' }}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (!v) return;
                            const clamped = v > today ? today : v;
                            setDateFrom(clamped);
                            setDateTo(clamped);
                          }}
                          className={`flex-1 min-w-0 px-2.5 py-1.5 rounded-xl text-xs font-mono border outline-none ${
                            isLight
                              ? 'border-slate-200 bg-slate-50 text-slate-800 focus:border-[#004e75]'
                              : 'border-slate-700 bg-slate-900 text-slate-100 focus:border-sky-500'
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setDateFrom(today);
                            setDateTo(today);
                          }}
                          className={`px-2.5 py-1.5 rounded-xl text-[11px] font-semibold border cursor-pointer shrink-0 ${
                            isLight
                              ? 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
                              : 'border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200'
                          }`}
                        >
                          Today
                        </button>
                      </div>
                    </div>

                    <div className={`pt-2.5 border-t ${isLight ? 'border-slate-100' : 'border-slate-800'}`}>
                      <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                        Custom Date Range
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">From</label>
                          <input
                            type="date"
                            value={dateFrom}
                            max={dateTo || today}
                            aria-label="From date"
                            style={{ colorScheme: isLight ? 'light' : 'dark' }}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (!v) return;
                              const clamped = v > today ? today : v;
                              setDateFrom(clamped);
                              if (clamped > dateTo) setDateTo(clamped);
                            }}
                            className={`w-full px-2 py-1.5 rounded-xl text-[11px] font-mono border outline-none ${
                              isLight
                                ? 'border-slate-200 bg-slate-50 text-slate-800 focus:border-[#004e75]'
                                : 'border-slate-700 bg-slate-900 text-slate-100 focus:border-sky-500'
                            }`}
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">To</label>
                          <input
                            type="date"
                            value={dateTo}
                            min={dateFrom || undefined}
                            max={today}
                            aria-label="To date"
                            style={{ colorScheme: isLight ? 'light' : 'dark' }}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (!v) return;
                              const clamped = v > today ? today : v;
                              setDateTo(clamped);
                              if (clamped < dateFrom) setDateFrom(clamped);
                            }}
                            className={`w-full px-2 py-1.5 rounded-xl text-[11px] font-mono border outline-none ${
                              isLight
                                ? 'border-slate-200 bg-slate-50 text-slate-800 focus:border-[#004e75]'
                                : 'border-slate-700 bg-slate-900 text-slate-100 focus:border-sky-500'
                            }`}
                          />
                        </div>
                      </div>
                    </div>

                    <div className={`pt-2 border-t flex items-center justify-between ${isLight ? 'border-slate-100' : 'border-slate-800'}`}>
                      <span className="text-[11px] text-slate-400 tabular-nums">
                        {dateButtonLabel}
                      </span>
                      <button
                        type="button"
                        onClick={() => setDateMenuOpen(false)}
                        className={`px-3 py-1 rounded-lg text-[11px] font-semibold cursor-pointer ${
                          isLight
                            ? 'bg-slate-900 text-white hover:bg-slate-800'
                            : 'bg-sky-600 text-white hover:bg-sky-500'
                        }`}
                      >
                        Done
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Directory Scope Badge (Admin HQ) */}
            {isAdminLike && !branchScopedId && (
              <span
                className={`inline-flex items-center gap-1.5 text-[11.5px] rounded-full border px-2.5 py-1 font-semibold whitespace-nowrap ${
                  isLight
                    ? 'border-slate-200/90 bg-white text-slate-700 shadow-2xs'
                    : 'border-slate-700 bg-slate-900/80 text-slate-200'
                }`}
                title="Scoped to active Phnom Penh staff from the Staff Directory"
              >
                <MapPin className={`w-3.5 h-3.5 shrink-0 ${isLight ? 'text-[#002F4A]' : 'text-sky-400'}`} aria-hidden="true" />
                <span>Phnom Penh · Staff Directory</span>
              </span>
            )}

            {/* Unified Utility Dock (Sync | Export) */}
            <div
              className={`inline-flex items-center p-0.5 rounded-full border ${
                isLight
                  ? 'border-slate-200/90 bg-white shadow-2xs'
                  : 'border-slate-700 bg-slate-900/80'
              }`}
            >
              <button
                type="button"
                onClick={() => void handleSyncAll()}
                className={`btn-press px-2.5 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors duration-150 ${
                  isLight
                    ? 'hover:bg-slate-100/80 text-slate-700'
                    : 'hover:bg-slate-800 text-slate-200'
                }`}
                title="Refresh live summary counts"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLight ? 'text-[#004e75]' : 'text-sky-400'} ${syncing ? 'animate-spin' : ''}`} aria-hidden="true" />
                <span>Sync</span>
              </button>

              {isAdminLike && (
                <>
                  <span className={`w-px h-3.5 ${isLight ? 'bg-slate-200' : 'bg-slate-700'}`} aria-hidden="true" />
                  <button
                    type="button"
                    onClick={onOpenExportModal}
                    className={`btn-press px-2.5 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors duration-150 ${
                      isLight
                        ? 'hover:bg-slate-100/80 text-slate-800'
                        : 'hover:bg-slate-800 text-slate-100'
                    }`}
                    title="Export Reports & Data"
                  >
                    <FileSpreadsheet className={`w-3.5 h-3.5 ${isLight ? 'text-[#2d6a4f]' : 'text-emerald-400'}`} aria-hidden="true" />
                    <span>Export</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 4 Inset iOS KPI Squircles inside Standalone White Shelf */}
        <div
          className={`relative z-10 rounded-3xl p-3.5 sm:p-4 border ${
            isLight
              ? 'bg-white border-slate-200/80 shadow-[0_1px_10px_rgba(15,23,42,0.025)]'
              : 'bg-[#161a24] border-slate-800'
          }`}
        >
        <section
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5"
          aria-label="Key portal metrics"
        >
          {/* KPI 1: Field Tasks */}
          <button
            type="button"
            onClick={() => onNavigateTab?.('kpi_performance')}
            title="Open KPI Performance"
            className={`${kpiCardClass} ${kpiInteractiveClass} rounded-[18px] px-4 py-3.5 flex flex-col justify-between min-w-0 w-full text-left silk-lift`}
            style={{ '--silk-i': 0 } as React.CSSProperties}
          >
            <div className="w-full">
              <div className="flex items-center justify-between gap-2">
                <span data-kpi-title className={`text-xs font-semibold ${kpiSubtextClass}`}>
                  Field Tasks · {activePeriodLabel}
                </span>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-transform duration-150 group-hover:scale-105 ${isLight ? 'bg-sky-500/15 text-sky-600' : 'bg-sky-500/20 text-sky-300'}`}>
                  <TrendingUp className="w-4 h-4" aria-hidden="true" />
                </div>
              </div>
              <div className="mt-2 flex items-end justify-between gap-2">
                <div className="min-w-0">
                  <div className={`text-2xl sm:text-[27px] font-bold font-figure tabular-nums tracking-tight leading-none ${kpiHeadingClass}`}>
                    <FigureSlot pending={kpiPending}><Odometer value={channelActivity.totalTasks} format duration={220} /></FigureSlot>
                  </div>
                  {kpiPending ? (
                    <span className="mt-1.5 inline-block skeleton h-4 w-12 rounded-full" aria-hidden="true" />
                  ) : (
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
                  )}
                </div>
                {kpiPending ? (
                  <div className="skeleton h-8 w-20 rounded-lg shrink-0" aria-hidden="true" />
                ) : (
                  <KpiMiniSparkline
                    metricId="tasks"
                    summary={kpiSparklines.tasks}
                    cardBgHex={isLight ? '#f8f9fb' : '#1e2330'}
                  />
                )}
              </div>
            </div>
            <div className={`w-full flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px] ${kpiSubtextClass} mt-2.5 pt-2 border-t ${kpiFooterBorderClass}`}>
              {kpiPending ? (
                <>
                  <span className="skeleton h-3 w-28 rounded inline-block" aria-hidden="true" />
                  <span className="skeleton h-3 w-12 rounded inline-block" aria-hidden="true" />
                </>
              ) : (
                <>
                  <span>{fmtNum(scopedKpiTotals.activeBranchCount || branches.length)} branches · {fmtNum(scopedKpiTotals.activeStaffCount)} staff</span>
                  <span className={`font-semibold whitespace-nowrap group-hover:underline ${isLight ? 'text-[#003857]' : 'text-slate-200'}`}>{fmtNum(Math.round(channelActivity.totalPoints))} pts</span>
                </>
              )}
            </div>
          </button>

          {/* KPI 2: Hardware Deployments */}
          <button
            type="button"
            onClick={() => onNavigateTab?.('merchants')}
            title={
              deploymentSummary.fromReview
                ? `Merchant Visit review deployments: ${fmtNum(deploymentSummary.approvedTotal)} approved · ${fmtNum(deploymentSummary.pendingTotal)} pending — open Merchant Deployment`
                : 'Open Merchant Deployment'
            }
            className={`${kpiCardClass} ${kpiInteractiveClass} rounded-[18px] px-4 py-3.5 flex flex-col justify-between min-w-0 w-full text-left silk-lift`}
            style={{ '--silk-i': 1 } as React.CSSProperties}
          >
            <div className="w-full">
              <div className="flex items-center justify-between gap-2">
                <span data-kpi-title className={`text-xs font-semibold ${kpiSubtextClass}`}>
                  Device Deployments
                </span>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-transform duration-150 group-hover:scale-105 ${isLight ? 'bg-indigo-500/15 text-indigo-600' : 'bg-indigo-500/20 text-indigo-300'}`}>
                  <Cpu className="w-4 h-4" aria-hidden="true" />
                </div>
              </div>
              <div className="mt-2 flex items-end justify-between gap-2">
                <div className="min-w-0">
                  <div className={`text-2xl sm:text-[27px] font-bold font-figure tabular-nums tracking-tight leading-none ${kpiHeadingClass}`}>
                    <FigureSlot pending={installsPending}><Odometer value={deploymentSummary.total} format duration={220} /></FigureSlot>
                  </div>
                  {installsPending ? (
                    <span className="mt-1.5 inline-block skeleton h-4 w-12 rounded-full" aria-hidden="true" />
                  ) : (
                    <span
                      data-kpi-delta="deployments"
                      className="mt-1.5 inline-flex items-center gap-1 px-1.5 py-[2px] rounded-full text-[10px] font-figure font-bold leading-none"
                      style={{
                        color: kpiSparklines.deployments.colorHex,
                        backgroundColor: `${kpiSparklines.deployments.colorHex}18`,
                      }}
                    >
                      {kpiSparklines.deployments.direction === 'up' ? '▲' : kpiSparklines.deployments.direction === 'down' ? '▼' : '●'}{' '}
                      {kpiSparklines.deployments.badgeText}
                    </span>
                  )}
                </div>
                {installsPending ? (
                  <div className="skeleton h-8 w-20 rounded-lg shrink-0" aria-hidden="true" />
                ) : (
                  <KpiMiniSparkline
                    metricId="deployments"
                    summary={kpiSparklines.deployments}
                    cardBgHex={isLight ? '#f8f9fb' : '#1e2330'}
                  />
                )}
              </div>
            </div>
            <div className={`w-full flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px] ${kpiSubtextClass} mt-2.5 pt-2 border-t ${kpiFooterBorderClass}`}>
              {installsPending ? (
                <>
                  <span className="skeleton h-3 w-24 rounded inline-block" aria-hidden="true" />
                  <span className="skeleton h-3 w-16 rounded inline-block" aria-hidden="true" />
                </>
              ) : (
                <>
                  <span>{fmtNum(deploymentSummary.pos)} POS · {fmtNum(deploymentSummary.sb)} SB</span>
                  <span className={`font-semibold group-hover:underline whitespace-nowrap ${isLight ? 'text-[#003857]' : 'text-slate-200'}`}>
                    {fmtNum(deploymentSummary.uniqueMerchants)} merchants
                  </span>
                </>
              )}
            </div>
          </button>

          {/* KPI 3: Approval Queue */}
          {(() => {
            const primaryQueueTab =
              queues.posField > 0
                ? 'mobile_sync'
                : queues.sbField > 0
                  ? 'mobile_sync_sb'
                  : queues.ccPend > 0
                    ? 'mobile_sync_cc'
                    : queues.reqPend > 0
                      ? 'requisitions'
                      : queues.pushPend > 0
                        ? 'push_configuring'
                        : 'mobile_sync';
            return (
          <div
            role={onNavigateTab ? 'button' : undefined}
            tabIndex={onNavigateTab ? 0 : undefined}
            onClick={() => onNavigateTab?.(primaryQueueTab)}
            onKeyDown={(e) => {
              if (!onNavigateTab) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onNavigateTab(primaryQueueTab);
              }
            }}
            title={`Pending approvals: ${fmtNum(queues.posField)} POS · ${fmtNum(queues.sbField)} SB · ${fmtNum(queues.ccPend)} CC · ${fmtNum(queues.reqPend)} Req${queues.pushPend > 0 ? ` · ${fmtNum(queues.pushPend)} push` : ''}`}
            className={`${kpiCardClass} ${kpiInteractiveClass} rounded-[18px] px-4 py-3.5 flex flex-col justify-between min-w-0 silk-lift`}
            style={{ '--silk-i': 2 } as React.CSSProperties}
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <span data-kpi-title className={`text-xs font-semibold ${kpiSubtextClass}`}>
                  Approval Queue
                </span>
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-transform duration-150 group-hover:scale-105 ${
                    queues.total > 0
                      ? isLight ? 'bg-amber-500/15 text-amber-600' : 'bg-amber-500/20 text-amber-300'
                      : isLight ? 'bg-emerald-500/15 text-emerald-600' : 'bg-emerald-500/20 text-emerald-300'
                  }`}
                >
                  <Inbox className="w-4 h-4" aria-hidden="true" />
                </div>
              </div>
              <div className="mt-2 flex items-end justify-between gap-2">
                <div className="min-w-0">
                  <div className={`text-2xl sm:text-[27px] font-bold font-figure tabular-nums tracking-tight leading-none ${kpiHeadingClass}`}>
                    <FigureSlot pending={queuesPending}><Odometer value={queues.total} format duration={220} /></FigureSlot>
                  </div>
                  {queuesPending ? (
                    <span className="mt-1.5 inline-block skeleton h-4 w-12 rounded-full" aria-hidden="true" />
                  ) : (
                    <span
                      data-kpi-delta="queue"
                      className="mt-1.5 inline-flex items-center gap-1 px-1.5 py-[2px] rounded-full text-[10px] font-figure font-bold leading-none"
                      style={{
                        color: kpiSparklines.queue.colorHex,
                        backgroundColor: `${kpiSparklines.queue.colorHex}18`,
                      }}
                    >
                      {kpiSparklines.queue.direction === 'up' ? '▲' : kpiSparklines.queue.direction === 'down' ? '▼' : '●'}{' '}
                      {kpiSparklines.queue.badgeText}
                    </span>
                  )}
                </div>
                {queuesPending ? (
                  <div className="skeleton h-8 w-20 rounded-lg shrink-0" aria-hidden="true" />
                ) : (
                  <KpiMiniSparkline
                    metricId="queue"
                    summary={kpiSparklines.queue}
                    cardBgHex={isLight ? '#f8f9fb' : '#1e2330'}
                  />
                )}
              </div>
            </div>
            <div className={`flex flex-wrap items-center justify-between gap-x-1.5 gap-y-0.5 text-[11px] ${kpiSubtextClass} mt-2.5 pt-2 border-t ${kpiFooterBorderClass}`}>
              {queuesPending ? (
                <>
                  <span className="skeleton h-3 w-28 rounded inline-block" aria-hidden="true" />
                  <span className="skeleton h-3 w-10 rounded inline-block" aria-hidden="true" />
                </>
              ) : (
                <>
                  <span>{fmtNum(queues.posField)} POS · {fmtNum(queues.sbField)} SB · {fmtNum(queues.ccPend)} CC</span>
                  {queues.reqPend > 0 ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onNavigateTab?.('requisitions');
                      }}
                      className={`font-semibold hover:underline cursor-pointer whitespace-nowrap ${isLight ? 'text-[#003857]' : 'text-slate-200'}`}
                    >
                      {fmtNum(queues.reqPend)} req
                    </button>
                  ) : queues.pushPend > 0 ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onNavigateTab?.('push_configuring');
                      }}
                      className={`font-semibold hover:underline cursor-pointer whitespace-nowrap ${isLight ? 'text-[#003857]' : 'text-slate-200'}`}
                    >
                      {fmtNum(queues.pushPend)} push
                    </button>
                  ) : (
                    <span className={`font-semibold whitespace-nowrap group-hover:underline ${queues.total === 0 ? (isLight ? 'text-emerald-700' : 'text-emerald-300') : (isLight ? 'text-slate-700' : 'text-slate-200')}`}>
                      {queues.total === 0 ? 'All clear' : '0 req'}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
            );
          })()}

          {/* KPI 4: Merchant Outreach */}
          <button
            type="button"
            onClick={() => onNavigateTab?.('mobile_sync_khqr')}
            title="Open KHQR Review"
            className={`${kpiCardClass} ${kpiInteractiveClass} rounded-[18px] px-4 py-3.5 flex flex-col justify-between min-w-0 w-full text-left silk-lift`}
            style={{ '--silk-i': 3 } as React.CSSProperties}
          >
            <div className="w-full">
              <div className="flex items-center justify-between gap-2">
                <span data-kpi-title className={`text-xs font-semibold ${kpiSubtextClass}`}>
                  Merchant Outreach
                </span>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-transform duration-150 group-hover:scale-105 ${isLight ? 'bg-violet-500/15 text-violet-600' : 'bg-violet-500/20 text-violet-300'}`}>
                  <Store className="w-4 h-4" aria-hidden="true" />
                </div>
              </div>
              <div className="mt-2 flex items-end justify-between gap-2">
                <div className="min-w-0">
                  <div className={`text-2xl sm:text-[27px] font-bold font-figure tabular-nums tracking-tight leading-none ${kpiHeadingClass}`}>
                    <FigureSlot pending={kpiPending}><Odometer value={reachTotal} format duration={220} /></FigureSlot>
                  </div>
                  {kpiPending ? (
                    <span className="mt-1.5 inline-block skeleton h-4 w-12 rounded-full" aria-hidden="true" />
                  ) : (
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
                  )}
                </div>
                {kpiPending ? (
                  <div className="skeleton h-8 w-20 rounded-lg shrink-0" aria-hidden="true" />
                ) : (
                  <KpiMiniSparkline
                    metricId="outreach"
                    summary={kpiSparklines.outreach}
                    cardBgHex={isLight ? '#f8f9fb' : '#1e2330'}
                  />
                )}
              </div>
            </div>
            <div className={`w-full flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px] ${kpiSubtextClass} mt-2.5 pt-2 border-t ${kpiFooterBorderClass}`}>
              {kpiPending ? (
                <>
                  <span className="skeleton h-3 w-32 rounded inline-block" aria-hidden="true" />
                  <span className="skeleton h-3 w-8 rounded inline-block" aria-hidden="true" />
                </>
              ) : (
                <>
                  <span>{fmtNum(channelActivity.khqrCount)} KHQR · {fmtNum(channelActivity.mvCount)} Visits · {fmtNum(channelActivity.ccCount)}/{fmtNum(channelActivity.ccSubmittedShow)} CC</span>
                  <span className={`font-semibold whitespace-nowrap group-hover:underline ${isLight ? 'text-[#003857]' : 'text-slate-200'}`}>{reachSharePct}%</span>
                </>
              )}
            </div>
          </button>
        </section>
        </div>
      </div>

      {/* ───────────── 3. ROW 1: CROSS-CHANNEL DAILY VELOCITY + CHANNEL SHARE DONUT ───────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left 8 Cols: Cross-Channel Daily Velocity & Active Staff */}
        <section
          className={`lg:col-span-8 ${iosCardClass} overflow-hidden flex flex-col silk-lift`}
          style={{ '--silk-i': 4 } as React.CSSProperties}
        >
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
                  Daily Volume &amp; Staff
                </h3>
                <p
                  className={`text-[12px] truncate ${
                    isLight ? 'text-slate-500' : 'text-slate-400'
                  }`}
                >
                  5-channel daily trend
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
                        {kpiPending ? (
                          <span className="skeleton h-3 w-10 rounded inline-block ml-0.5" aria-hidden="true" />
                        ) : (
                          <span
                            className={`font-figure font-bold tabular-nums ml-0.5 ${
                              isLight ? 'text-slate-900' : 'text-white'
                            }`}
                          >
                            {fmtNum(primaryCount)}
                          </span>
                        )}
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
                  </div>

                  {kpiPending ? (
                    <>
                      <div
                        className="w-full h-[248px] flex flex-col justify-end gap-3 px-2 py-4"
                        role="status"
                        aria-label="Loading daily volume chart"
                      >
                        <div className="flex-1 flex items-end gap-2.5 px-2">
                          {[38, 62, 54, 74, 48, 82, 68, 90, 58, 76, 64, 42].map((h, idx) => (
                            <div
                              key={idx}
                              className="flex-1 skeleton rounded-t-md"
                              style={{ height: `${h}%` }}
                            />
                          ))}
                        </div>
                        <div className="h-2.5 w-full skeleton rounded" />
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2" aria-hidden="true">
                        {[0, 1, 2, 3, 4].map((idx) => (
                          <div
                            key={idx}
                            className={`rounded-xl border px-3 py-2.5 space-y-2 ${
                              isLight ? 'bg-slate-50/70 border-slate-200/70' : 'bg-slate-800/40 border-slate-700/60'
                            }`}
                          >
                            <div className="skeleton h-2.5 w-14 rounded" />
                            <div className="skeleton h-4 w-12 rounded" />
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <>
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
                  )}
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
          loading={kpiPending}
          onNavigateTab={onNavigateTab}
        />
      </div>

      {/* ───────────── 4. ROW 2: MONTHLY POS VS SOUND BOX INSTALLATIONS + POS TERMINAL BATTERY STATUS ───────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left 8 Cols: Monthly POS Installation vs Sound Box Installation Bar Comparison */}
        <MonthlyInstallComparisonCard
          isLight={isLight}
          theme={theme}
          cardClass={iosCardClass}
          horizon={installHorizon}
          onChangeHorizon={setInstallHorizon}
          data={monthlyInstallComparison}
          loading={
            (fieldInstalls === null && sessionInstallBuckets === null && fieldInstallsLoading) ||
            (neededInstallDays > getCachedMonthlyInstallFieldEventsCoveredDays() && fieldInstallsLoading)
          }
          onNavigateTab={onNavigateTab}
        />

        {/* Right 4 Cols: POS Terminal Battery Lifecycle Status */}
        <section
          data-testid="pos-battery-status-card"
          className={`lg:col-span-4 @container ${iosCardClass} overflow-hidden flex flex-col silk-lift`}
          style={{ '--silk-i': 7 } as React.CSSProperties}
        >
          <div className="px-4 @[300px]:px-5 pt-5 pb-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h3
                data-battery-card-title
                className={`text-[14px] @[300px]:text-[14.5px] font-bold tracking-[-0.015em] flex items-center gap-1.5 whitespace-nowrap ${
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
                <span className="truncate">POS Battery Status</span>
              </h3>
              <p
                className={`text-[11.5px] truncate ${
                  isLight ? 'text-slate-500' : 'text-slate-400'
                }`}
              >
                {!batterySettled && batterySummary.fleetTotal === 0 ? 'Loading POS…' : `${fmtNum(batterySummary.fleetTotal)} POS`} · {batteryLifespanMonths}M SLA
              </p>
            </div>

            {onNavigateTab && (
              <button
                type="button"
                onClick={() => onNavigateTab('inventory_pos')}
                className={`text-[11.5px] font-semibold inline-flex items-center gap-0.5 shrink-0 whitespace-nowrap cursor-pointer transition ${
                  isLight
                    ? 'text-[#004e75] hover:text-[#003857]'
                    : 'text-sky-400 hover:text-sky-300'
                }`}
              >
                Stock <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          {(() => {
                const batteryPending = !batterySettled && batterySummary.fleetTotal === 0;
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
                    } flex-1 flex flex-col`}
                  >
                    {/* Section 1: Compliance headline + stacked SLA bar + 3 status tiles */}
                    <div className="px-4 @[300px]:px-5 py-4 space-y-3.5">
                      <div className="flex flex-wrap items-end justify-between gap-x-2 gap-y-1.5">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 min-w-0">
                          <span
                            className={`text-[28px] @[300px]:text-[30px] font-bold font-figure leading-none tracking-tight ${
                              isLight ? 'text-slate-900' : 'text-white'
                            }`}
                          >
                            <FigureSlot pending={batteryPending}>
                              {`${healthyPct}%`}
                            </FigureSlot>
                          </span>
                          <span
                            className={`text-[10.5px] @[300px]:text-[11px] font-semibold px-2 @[300px]:px-2.5 py-0.5 rounded-full whitespace-nowrap ${
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
                        <div className="text-right shrink-0 ml-auto">
                          {batteryPending ? (
                            <div className="space-y-1 flex flex-col items-end" aria-hidden="true">
                              <span className="skeleton h-3 w-16 rounded block" />
                              <span className="skeleton h-2.5 w-20 rounded block" />
                            </div>
                          ) : (
                            <>
                              <div className={`text-[11px] @[300px]:text-[11.5px] font-figure font-semibold whitespace-nowrap ${isLight ? 'text-slate-700' : 'text-slate-200'}`}>
                                {batterySummary.avgLifePct}% avg life
                              </div>
                              <div className={`text-[10px] @[300px]:text-[10.5px] font-figure whitespace-nowrap ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                                Avg {batterySummary.avgMonthsUsed}M / {batteryLifespanMonths}M
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      <div
                        className={`h-3 w-full rounded-full ${
                          isLight ? 'bg-slate-100' : 'bg-slate-800'
                        } overflow-hidden flex gap-0.5`}
                      >
                        {batteryPending ? (
                          <div className="h-full w-full rounded-full skeleton" />
                        ) : batterySummary.total > 0 ? (
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

                      <div className="grid grid-cols-1 @[290px]:grid-cols-3 gap-1.5 @[320px]:gap-2">
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
                            className={`rounded-xl px-2.5 @[290px]:px-2 py-2 @[290px]:py-2.5 border flex items-center justify-between @[290px]:block ${
                              isLight
                                ? 'bg-slate-50/80 border-slate-200/60'
                                : 'bg-slate-800/45 border-slate-700/60'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                              <i
                                className="w-1.5 h-1.5 rounded-full inline-block shrink-0"
                                style={{ backgroundColor: tile.dot }}
                              />
                              <span className="whitespace-nowrap">{tile.label}</span>
                            </div>
                            <div className="@[290px]:mt-1.5 flex items-baseline justify-end @[290px]:justify-between gap-1.5 @[290px]:gap-1">
                              {batteryPending ? (
                                <span className="skeleton h-4 w-12 rounded inline-block" aria-hidden="true" />
                              ) : (
                                <>
                                  <span className={`text-[14px] @[330px]:text-[15px] font-bold font-figure tabular-nums leading-none whitespace-nowrap ${isLight ? 'text-slate-900' : 'text-white'}`}>
                                    {fmtNum(tile.count)}
                                  </span>
                                  <span className="text-[10px] font-figure tabular-nums text-slate-400 whitespace-nowrap">
                                    {batterySummary.total > 0 ? `${tile.share}%` : '—'}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Section 2: Age Cohort Breakdown */}
                    <div className="px-4 @[300px]:px-5 pt-4 pb-5 flex-1 flex flex-col justify-between gap-3">
                      <div className="flex items-center justify-between text-[12px]">
                        <span className={`font-semibold ${isLight ? 'text-slate-700' : 'text-slate-200'}`}>
                          Age Distribution
                        </span>
                        {batteryPending ? (
                          <span className="skeleton h-3 w-14 rounded inline-block" aria-hidden="true" />
                        ) : (
                          <span className="font-figure text-slate-400">
                            {fmtNum(batterySummary.total)} dated
                          </span>
                        )}
                      </div>
                      <div className="flex-1 flex flex-col justify-between gap-3">
                        {cohorts.map((c) => {
                          const share = batterySummary.total > 0 ? Math.round((c.count / datedTot) * 100) : 0;
                          const barW = c.count > 0 ? Math.max(3, (c.count / datedTot) * 100) : 0;
                          return (
                            <div key={c.key} className="space-y-1">
                              <div className="flex items-center justify-between gap-2 text-[11.5px]">
                                <span className={`truncate ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
                                  {c.label}
                                </span>
                                {batteryPending ? (
                                  <span className="skeleton h-3 w-12 rounded inline-block shrink-0" aria-hidden="true" />
                                ) : (
                                  <span className={`font-figure font-semibold tabular-nums whitespace-nowrap shrink-0 ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>
                                    {fmtNum(c.count)}{' '}
                                    <span className="text-slate-400 font-normal">({share}%)</span>
                                  </span>
                                )}
                              </div>
                              <div className={`h-2 w-full rounded-full overflow-hidden ${isLight ? 'bg-slate-100' : 'bg-slate-800'}`}>
                                {batteryPending ? (
                                  <div className="h-full w-2/3 rounded-full skeleton" />
                                ) : barW > 0 && (
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
                  </div>
                );
              })()}
        </section>
      </div>

      {/* ───────────── 5. ROW 3: CLEAN MINIMAL STOCK SUMMARY + COMPACT PLATFORM TELEMETRY ───────────── */}
      <div className="space-y-5" aria-label="System Operations & Telemetry">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Card 3A: Hardware Summary */}
          <section
            data-stock-card="hardware"
            className={`${iosCardClass} overflow-hidden flex flex-col justify-between p-5 gap-3.5`}
          >
            {(() => {
              const readyTotal = hardwareSummary.hq + hardwareSummary.reserve;
              const readyPos = hardwareSummary.posHq + hardwareSummary.posReserve;
              const readySb = hardwareSummary.sbHq + hardwareSummary.sbReserve;
              return (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                          isLight ? 'bg-[#184e77]/12 text-[#184e77]' : 'bg-[#184e77]/30 text-[#5cc8ff]'
                        }`}
                      >
                        <Boxes className="w-3.5 h-3.5" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <h3 className={`text-[14px] font-bold tracking-[-0.015em] truncate ${isLight ? 'text-slate-900' : 'text-white'}`}>
                          Hardware Summary
                        </h3>
                        <p className={`text-[11.5px] truncate ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                          Warehouse vs deployed overview
                        </p>
                      </div>
                    </div>
                    {onNavigateTab && (
                      <button
                        type="button"
                        onClick={() => onNavigateTab('inventory_pos')}
                        className={`text-xs font-semibold inline-flex items-center gap-0.5 shrink-0 cursor-pointer transition ${
                          isLight ? 'text-[#004e75] hover:text-[#003857]' : 'text-sky-400 hover:text-sky-300'
                        }`}
                      >
                        Stock <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2.5">
                    <button
                      type="button"
                      onClick={() => onNavigateTab?.('inventory_pos')}
                      title={`HQ ${fmtNum(hardwareSummary.hq)} · Branches ${fmtNum(hardwareSummary.reserve)} (POS ${fmtNum(readyPos)} · SB ${fmtNum(readySb)})`}
                      className={`text-left ${kpiCardClass} rounded-[14px] px-3.5 py-2.5 cursor-pointer transition ${
                        isLight ? 'hover:border-slate-300 hover:bg-slate-100/70' : 'hover:border-slate-600'
                      }`}
                    >
                      <div className={`text-[10.5px] font-medium truncate ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                        Ready Stock
                      </div>
                      <div className={`text-[20px] font-extrabold font-figure tabular-nums leading-tight mt-0.5 ${isLight ? 'text-slate-900' : 'text-white'}`}>
                        {fmtNum(readyTotal)}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => onNavigateTab?.('push_configuring')}
                      title={`Configuring / Push: POS ${fmtNum(hardwareSummary.posConfig)} · SB ${fmtNum(hardwareSummary.sbConfig)}`}
                      className={`text-left ${kpiCardClass} rounded-[14px] px-3.5 py-2.5 cursor-pointer transition ${
                        isLight ? 'hover:border-slate-300 hover:bg-slate-100/70' : 'hover:border-slate-600'
                      }`}
                    >
                      <div className={`text-[10.5px] font-medium truncate ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                        Setup
                      </div>
                      <div
                        className={`text-[20px] font-extrabold font-figure tabular-nums leading-tight mt-0.5 ${
                          hardwareSummary.config > 0
                            ? isLight ? 'text-amber-700' : 'text-amber-300'
                            : isLight ? 'text-slate-500' : 'text-slate-400'
                        }`}
                      >
                        {fmtNum(hardwareSummary.config)}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => onNavigateTab?.('merchants')}
                      title={`Deployed Live: POS ${fmtNum(hardwareSummary.posInstalled)} · SB ${fmtNum(hardwareSummary.sbInstalled)} across ${fmtNum(hardwareSummary.liveUniqueMerchants)} active MIDs`}
                      className={`text-left rounded-[14px] px-3.5 py-2.5 border cursor-pointer transition ${
                        isLight
                          ? 'bg-emerald-50/75 border-emerald-200/80 hover:border-emerald-300 hover:bg-emerald-50'
                          : 'bg-emerald-500/10 border-emerald-500/30 hover:border-emerald-400/50'
                      }`}
                    >
                      <div className={`text-[10.5px] font-semibold truncate ${isLight ? 'text-emerald-700' : 'text-emerald-300'}`}>
                        Live MIDs
                      </div>
                      <div className={`text-[20px] font-extrabold font-figure tabular-nums leading-tight mt-0.5 ${isLight ? 'text-emerald-700' : 'text-emerald-300'}`}>
                        {fmtNum(hardwareSummary.installed)}
                      </div>
                    </button>
                  </div>
                </>
              );
            })()}
          </section>

          {/* Card 3B: Accessories & SIMs */}
          <section
            data-stock-card="materials"
            className={`${iosCardClass} overflow-hidden flex flex-col justify-between p-5 gap-3.5`}
          >
            {(() => {
              const batteriesTotal = materialsSummary.kitSkus.find((s) => s.code === 'BATTERY')?.total ?? 0;
              const adaptorsKitsTotal = materialsSummary.kitSkus
                .filter((s) => s.code !== 'BATTERY')
                .reduce((acc, s) => acc + s.total, 0);
              const openReqsCount = reqStats.pending.length;

              return (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                          isLight ? 'bg-[#2d6a4f]/15 text-[#2d6a4f]' : 'bg-emerald-500/20 text-emerald-300'
                        }`}
                      >
                        <Package className="w-3.5 h-3.5" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <h3 className={`text-[14px] font-bold tracking-[-0.015em] truncate ${isLight ? 'text-slate-900' : 'text-white'}`}>
                          Accessories &amp; SIMs
                        </h3>
                        <p className={`text-[11.5px] truncate ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                          Clean count summary
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

                  <div className="grid grid-cols-3 gap-2.5">
                    <button
                      type="button"
                      onClick={() => onNavigateTab?.('inventory_pos')}
                      title={`Batteries total: ${fmtNum(batteriesTotal)}`}
                      className={`text-left ${kpiCardClass} rounded-[14px] px-3.5 py-2.5 cursor-pointer transition ${
                        isLight ? 'hover:border-slate-300 hover:bg-slate-100/70' : 'hover:border-slate-600'
                      }`}
                    >
                      <div className={`text-[10.5px] font-medium truncate ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                        Batteries
                      </div>
                      <div className={`text-[20px] font-extrabold font-figure tabular-nums leading-tight mt-0.5 ${isLight ? 'text-slate-900' : 'text-white'}`}>
                        {fmtNum(batteriesTotal)}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => onNavigateTab?.('inventory_pos')}
                      title={`Adaptors & Kits: ${fmtNum(adaptorsKitsTotal)} · SIMs: ${fmtNum(materialsSummary.simTotal)}`}
                      className={`text-left ${kpiCardClass} rounded-[14px] px-3.5 py-2.5 cursor-pointer transition ${
                        isLight ? 'hover:border-slate-300 hover:bg-slate-100/70' : 'hover:border-slate-600'
                      }`}
                    >
                      <div className={`text-[10.5px] font-medium truncate ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                        Adaptors/Kits
                      </div>
                      <div className={`text-[20px] font-extrabold font-figure tabular-nums leading-tight mt-0.5 ${isLight ? 'text-slate-900' : 'text-white'}`}>
                        {fmtNum(adaptorsKitsTotal)}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => onNavigateTab?.('requisitions')}
                      title={`Pending: ${fmtNum(openReqsCount)} · Received: ${fmtNum(reqStats.received)} · Rejected: ${fmtNum(reqStats.rejected)}`}
                      className={`text-left ${kpiCardClass} rounded-[14px] px-3.5 py-2.5 cursor-pointer transition ${
                        isLight ? 'hover:border-slate-300 hover:bg-slate-100/70' : 'hover:border-slate-600'
                      }`}
                    >
                      <div className={`text-[10.5px] font-medium truncate ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                        Open Reqs
                      </div>
                      <div className={`text-[20px] font-extrabold font-figure tabular-nums leading-tight mt-0.5 ${isLight ? 'text-[#155484]' : 'text-sky-300'}`}>
                        {fmtNum(openReqsCount)}
                      </div>
                    </button>
                  </div>
                </>
              );
            })()}
          </section>
        </div>

        {/* Compact Platform Health & Activity Strip */}
        <section className={`${iosCardClass} px-5 py-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3`}>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 min-w-0">
            <div className="flex items-center gap-2.5">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                  systemTelemetry.errorCount === 0
                    ? isLight ? 'bg-emerald-500/15 text-emerald-600' : 'bg-emerald-500/20 text-emerald-300'
                    : isLight ? 'bg-rose-500/15 text-rose-600' : 'bg-rose-500/20 text-rose-300'
                }`}
              >
                <Activity className="w-3.5 h-3.5" aria-hidden="true" />
              </div>
              <div>
                <h3 className={`text-[13px] font-bold leading-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  Platform Health &amp; Activity
                </h3>
                <p className={`text-[11px] leading-tight ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  {isSupabaseConfigured ? 'Cloud Live' : 'Local'} · {fmtNum(systemTelemetry.apiCallsCount)} calls ·{' '}
                  {systemTelemetry.apiMedianMs !== null ? `${systemTelemetry.apiMedianMs} ms` : 'Cached'} ·{' '}
                  <span className={systemTelemetry.errorCount === 0 ? (isLight ? 'text-emerald-700 font-semibold' : 'text-emerald-300 font-semibold') : (isLight ? 'text-rose-600 font-semibold' : 'text-rose-400 font-semibold')}>
                    {systemTelemetry.errorCount} err
                  </span>
                </p>
              </div>
            </div>

            <div className={`hidden sm:block h-6 w-px ${isLight ? 'bg-slate-200/80' : 'bg-slate-700/70'}`} />

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] min-w-0">
              <span className={isLight ? 'text-slate-500' : 'text-slate-400'}>
                SIMs <strong className={`font-figure ${isLight ? 'text-slate-800' : 'text-white'}`}>{fmtNum(materialsSummary.simTotal)}</strong>
              </span>
              {systemTelemetry.auditRows.length > 0 ? (
                <span className={`truncate max-w-[380px] ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
                  Latest:{' '}
                  <strong className={isLight ? 'text-slate-900' : 'text-white'}>
                    {systemTelemetry.auditRows[0].title || systemTelemetry.auditRows[0].action || 'System event'}
                  </strong>
                  {systemTelemetry.auditRows[0].actorName ? ` · ${systemTelemetry.auditRows[0].actorName}` : ''}
                </span>
              ) : recentDevices.length > 0 ? (
                <button
                  type="button"
                  onClick={() => onSelectDevice(recentDevices[0].serial)}
                  className={`truncate max-w-[380px] text-left cursor-pointer transition ${
                    isLight ? 'text-slate-600 hover:text-[#004e75]' : 'text-slate-300 hover:text-sky-300'
                  }`}
                >
                  Latest unit:{' '}
                  <strong className="font-mono">{recentDevices[0].serial}</strong> · {recentDevices[0].type} (Code {recentDevices[0].branchId})
                </button>
              ) : null}
            </div>
          </div>

          {onNavigateTab && isAdminLike && (
            <button
              type="button"
              onClick={() => onNavigateTab(role === 'SUPER_ADMIN' ? 'settings' : 'audit_log')}
              className={`text-xs font-semibold inline-flex items-center gap-1 shrink-0 cursor-pointer transition self-start lg:self-auto ${
                isLight ? 'text-[#004e75] hover:text-[#003857]' : 'text-sky-400 hover:text-sky-300'
              }`}
            >
              {role === 'SUPER_ADMIN' ? 'Health' : 'Audit'} <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </section>
      </div>
    </div>
  );
};

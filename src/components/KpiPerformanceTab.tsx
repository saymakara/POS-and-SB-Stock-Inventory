import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Trophy, BarChart3, Building2, Users, Calendar, Layers, Award, Search, RefreshCw, Loader2,
  ChevronDown, ChevronLeft, ChevronRight, Cpu, Volume2, QrCode, CreditCard, TrendingUp, TrendingDown, Target,
  Sun, CheckSquare, Diamond, X, ArrowUpDown, ArrowUp, ArrowDown, ShieldCheck,
  ClipboardList,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ComposedChart, Line,
} from 'recharts';
import { Branch, UserRole } from '../types';
import { Pager } from './Pager';
import { usePager } from '../utils/usePager';
import { ClearFiltersButton } from './ClearFiltersButton';
import { ExportCsvButton } from './ExportCsvButton';
import { downloadCsv } from '../utils/exportCsv';
import { getManagementExemptSet, isStaffManagementExempt, KPI_MANAGEMENT_EXEMPT_EVENT } from '../utils/kpiManagementUtils';
import { getCachedStaff } from '../services/staffCache';
import {
  KpiCategory, KpiPeriod, KPI_PERIOD_LABEL, kpiPeriodRange, KpiPointRule, KpiDashboardData,
  KpiRawCounts, computeKpiPoints, addExtraCounts, rulePts, fetchKpiSummary, getCachedKpiSummary,
  KpiDailyBranchRaw, KpiDailyStaffRaw, KpiTimeBucketRaw,
} from '../services/kpiService';
import { getCambodiaHoliday, getMonthWorkDaysSummary } from '../utils/cambodiaHolidays';
import { todayPP } from '../utils/time';

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

const CAT_COLORS: Record<KpiCategory, { hex: string; badge: string; bar: string; dot: string; Icon: React.ElementType }> = {
  'POS Terminal': { hex: '#006BA6', badge: 'bg-[#006BA6]/10 text-[#006BA6] border-[#006BA6]/20', bar: 'bg-[#006BA6]', dot: 'bg-[#006BA6]', Icon: Cpu },
  'Sound Box': { hex: '#4F518C', badge: 'bg-[#4F518C]/10 text-[#4F518C] border-[#4F518C]/20', bar: 'bg-[#4F518C]', dot: 'bg-[#4F518C]', Icon: Volume2 },
  KHQR: { hex: '#0d9488', badge: 'bg-teal-50 text-teal-700 border-teal-200/90', bar: 'bg-teal-600', dot: 'bg-teal-600', Icon: QrCode },
  'Credit Card': { hex: '#f59e0b', badge: 'bg-amber-50 text-amber-700 border-amber-200/90', bar: 'bg-amber-500', dot: 'bg-amber-500', Icon: CreditCard },
  'Merchant Visit': { hex: '#A4133C', badge: 'bg-[#A4133C]/10 text-[#A4133C] border-[#A4133C]/20 font-semibold', bar: 'bg-[#A4133C]', dot: 'bg-[#A4133C]', Icon: ClipboardList },
  Other: { hex: '#64748b', badge: 'bg-slate-50 text-slate-600 border-slate-200', bar: 'bg-slate-500', dot: 'bg-slate-500', Icon: Layers },
};

const PHNOM_PENH_CODES = new Set([
  '100', '101', '102', '103', '104', '105', '106', '107', '108', '109',
  '110', '111', '112', '113', '114', '115', '116', '117', '118', '119',
  '120', '121', '122', '123', '124', '125', '126', '127', '128', '129',
  '130', '131', '132', '133', '134', '801',
]);

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
  const base = (name || '').replace(/^Code\s+\d+\s*[·-]\s*/i, '').trim();
  if (!base || base.toLowerCase() === 'unassigned') return 'Unassigned';
  if (/^Branch\s+\d+/i.test(base) || /\bbranch$/i.test(base)) {
    return base;
  }
  return `${base} Branch`;
}

function fmtBranchLabel(branchId: string, branchName: string, _short = false): string {
  const clean = cleanBranchName(branchName);
  if (!branchId || branchId === 'UNASSIGNED') return clean;
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

interface Props {
  role: UserRole;
  userBranchId?: string;
  branches: Branch[];
  triggerToast: (msg: string) => void;
  onNavigateToSettings?: (subTab?: string) => void;
}

export const KpiPerformanceTab: React.FC<Props> = ({ role, userBranchId, branches, triggerToast }) => {
  const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const [period, setPeriod] = useState<KpiPeriod>('ALL');
  const [view, setView] = useState<KpiView>('all');
  const [granularity, setGranularity] = useState<Granularity>('daily');
  const [regionFilter, setRegionFilter] = useState<'ALL' | 'PP' | 'PROV'>('ALL');
  const [branchFilter, setBranchFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | KpiCategory>('ALL');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [selectedTopMonth, setSelectedTopMonth] = useState<string>('ALL');
  const [leaderboardMode, setLeaderboardMode] = useState<'staff' | 'branch'>('staff');
  const [openBranch, setOpenBranch] = useState<string | null>(null);
  const [openStaff, setOpenStaff] = useState<string | null>(null);
  const [showSubCategories, setShowSubCategories] = useState(false);
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
  const [, startTransition] = useTransition();

  // Management KPI Exemption reactive synchronization
  const [exemptVersion, setExemptVersion] = useState(0);
  useEffect(() => {
    const handler = () => setExemptVersion((v) => v + 1);
    window.addEventListener(KPI_MANAGEMENT_EXEMPT_EVENT, handler);
    return () => window.removeEventListener(KPI_MANAGEMENT_EXEMPT_EVENT, handler);
  }, []);
  const exemptSet = useMemo(() => getManagementExemptSet(), [exemptVersion]);

  const handleViewChange = useCallback((newView: KpiView) => {
    startTransition(() => {
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
    });
  }, [startTransition]);

  const handleTableModeChange = useCallback((mode: 'branch' | 'staff' | 'branch_daily' | 'staff_daily') => {
    startTransition(() => {
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
    });
  }, [startTransition]);

  const handleCardClick = useCallback((cardKey: string, targetView: KpiView, mode?: 'branch' | 'staff') => {
    startTransition(() => {
      setSelectedCard((c) => (c === cardKey ? null : cardKey));
      setView(targetView);
      if (mode === 'branch') {
        setTableMode('branch');
        setBranchSubView('summary');
      } else if (mode === 'staff') {
        setTableMode('staff');
        setStaffSubView('summary');
      }
    });
  }, [startTransition]);

  // Sorting state for tables
  const [branchSortKey, setBranchSortKey] = useState<string>('totalPoints');
  const [branchSortDir, setBranchSortDir] = useState<'asc' | 'desc'>('desc');
  const [staffSortKey, setStaffSortKey] = useState<string>('totalPoints');
  const [staffSortDir, setStaffSortDir] = useState<'asc' | 'desc'>('desc');
  const [timelineSortKey, setTimelineSortKey] = useState<string>('period');
  const [timelineSortDir, setTimelineSortDir] = useState<'asc' | 'desc'>('desc');

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

  const staffMetaMap = useMemo(() => {
    const map = new Map<string, { position: string; role: string; isManagement: boolean; name: string }>();

    // 1. Populate from branches.staffDetails
    branches.forEach((b) => {
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

    // 2. Also overlay from getCachedStaff() if available
    const cached = getCachedStaff();
    if (cached) {
      cached.forEach((a) => {
        const isMgt = isStaffManagementExempt(a.empId, a.name, exemptSet);
        const entry = {
          position: a.position || (isMgt ? 'Management' : 'MS Officer'),
          role: a.role,
          isManagement: isMgt,
          name: a.name,
        };
        if (a.empId) map.set(a.empId, entry);
        if (a.name) map.set(a.name.toLowerCase(), entry);
      });
    }

    return map;
  }, [branches, exemptSet]);

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

    // Track existing staff from data.staff
    const existingStaffIds = new Set(data.staff.map((s) => s.staffId));
    const existingStaffNames = new Set(data.staff.map((s) => s.staffName.toLowerCase()));

    // Supplement management staff from branches so management level has room in the roster
    const managementRosterExtras: typeof data.staff = [];
    branches.forEach((b) => {
      (b.staffDetails || []).forEach((u) => {
        const isMgt = isStaffManagementExempt(u.empId, u.name, exemptSet);
        if (isMgt) {
          const empId = u.empId || '';
          const nameLower = (u.name || '').toLowerCase();
          if ((!empId || !existingStaffIds.has(empId)) && (!nameLower || !existingStaffNames.has(nameLower))) {
            if (empId) existingStaffIds.add(empId);
            if (nameLower) existingStaffNames.add(nameLower);
            managementRosterExtras.push({
              staffId: empId,
              staffName: u.name,
              branchId: b.id,
              branchName: b.name,
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
        }
      });
    });

    const combinedList = [...data.staff, ...managementRosterExtras];

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
        const isPP = PHNOM_PENH_CODES.has(s.branchId) || /phnom\s*penh|head\s*office/i.test(canonicalBranchName);
        return {
          ...s,
          position,
          isManagement,
          branchName: canonicalBranchName,
          isPP,
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
  }, [data, ruleMap, branchNameMap, activeTargets.staff, branches, staffMetaMap, exemptSet, pacingInfo]);

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
      const key = s.branchId || 'UNASSIGNED';
      let b = map.get(key);
      if (!b) {
        b = {
          branchId: key,
          branchName: branchNameMap.get(key) || s.branchName || 'Unassigned',
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
      const qualityPct = b.totalSubmitted > 0 ? Math.max(0, Math.round(((b.totalSubmitted - b.totalIssues) / b.totalSubmitted) * 100)) : 100;
      return {
        ...b,
        ...pts,
        ptsPerStaff,
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
      if (regionFilter === 'PP' && !b.isPP) return false;
      if (regionFilter === 'PROV' && b.isPP) return false;
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
        case 'sbPoints':
          av = a.sbPoints;
          bv = b.sbPoints;
          break;
        case 'khqrPoints':
          av = a.khqrPoints;
          bv = b.khqrPoints;
          break;
        case 'ccPoints':
          av = a.ccPoints;
          bv = b.ccPoints;
          break;
        case 'mvPoints':
          av = a.mvPoints;
          bv = b.mvPoints;
          break;
        case 'ptsPerStaff':
          av = a.ptsPerStaff;
          bv = b.ptsPerStaff;
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
  }, [branchRows, regionFilter, branchFilter, categoryFilter, deferredQuery, branchSortKey, branchSortDir]);

  const filteredStaff = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const list = enrichedStaff.filter((s) => {
      if (!isAdmin && userBranchId && s.branchId !== userBranchId) return false;
      if (staffLevelFilter === 'field' && s.isManagement) return false;
      if (staffLevelFilter === 'management' && !s.isManagement) return false;
      if (regionFilter === 'PP' && !s.isPP) return false;
      if (regionFilter === 'PROV' && s.isPP) return false;
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
        case 'sbPoints':
          av = a.sbPoints;
          bv = b.sbPoints;
          break;
        case 'khqrPoints':
          av = a.khqrPoints;
          bv = b.khqrPoints;
          break;
        case 'ccPoints':
          av = a.ccPoints;
          bv = b.ccPoints;
          break;
        case 'mvPoints':
          av = a.mvPoints;
          bv = b.mvPoints;
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
  }, [enrichedStaff, isAdmin, userBranchId, regionFilter, branchFilter, categoryFilter, deferredQuery, staffSortKey, staffSortDir, staffLevelFilter]);

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
    const qualityPct = submitted > 0 ? Math.max(0, Math.round(((submitted - issues) / submitted) * 100)) : 100;
    const branchesOnTarget = filteredBranches.filter((b) => (b.pacingPct ?? b.targetPct) >= 100).length;
    const staffOnTarget = kpiStaffOnly.filter((s) => (s.pacingPct ?? s.targetPct) >= 100).length;
    const totalBranchTargetPoints = filteredBranches.reduce((acc, b) => acc + (b.effectiveTarget || (Math.max(1, b.staffCount) * activeTargets.staff)), 0);
    const targetAchievementPct = totalBranchTargetPoints > 0
      ? Math.min(999, Math.round((pts.totalPoints / totalBranchTargetPoints) * 100))
      : (activeBranchCount > 0 ? Math.round(filteredBranches.reduce((acc, b) => acc + b.targetPct, 0) / activeBranchCount) : 0);
    return {
      raw,
      ...pts,
      activeBranchCount,
      activeStaffCount,
      totalStaffCount,
      mgtStaffCount: mgtStaffOnly.length,
      avgBranchPts,
      avgStaffPts,
      qualityPct,
      branchesOnTarget,
      staffOnTarget,
      targetAchievementPct,
      topBranch: filteredBranches[0] || null,
      topStaff: filteredStaff[0] || null,
    };
  }, [filteredBranches, filteredStaff, ruleMap, activeTargets]);

  const timeSeries = useMemo(() => {
    if (!data) return [];
    const rawDailyFilled = buildDailyContiguousSeries(data.daily, period, range);
    const src =
      granularity === 'daily' ? rawDailyFilled :
      granularity === 'weekly' ? data.weekly :
      granularity === 'quarterly' ? data.quarterly :
      data.monthly;
    const enriched = src.map((row) => ({
      ...row,
      ...computeKpiPoints(row, ruleMap),
    }));
    const mapped = enriched.map((row, idx) => {
      const prev = enriched[idx + 1];
      const growthPct = prev && prev.totalPoints > 0
        ? Math.round(((row.totalPoints - prev.totalPoints) / prev.totalPoints) * 100)
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
      };
    });

    return [...mapped].sort((a, b) => {
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
        case 'sbPoints':
          av = a.sbPoints;
          bv = b.sbPoints;
          break;
        case 'khqrPoints':
          av = a.khqrPoints;
          bv = b.khqrPoints;
          break;
        case 'ccPoints':
          av = a.ccPoints;
          bv = b.ccPoints;
          break;
        case 'mvPoints':
          av = a.mvPoints;
          bv = b.mvPoints;
          break;
        case 'totalTasks':
          av = a.totalTasks;
          bv = b.totalTasks;
          break;
        case 'ptsPerStaff':
          av = a.ptsPerStaff;
          bv = b.ptsPerStaff;
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
  }, [data, granularity, period, range, ruleMap, timelineSortKey, timelineSortDir]);

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

  const dailyBranchPg = usePager(sortedDailyBranchRows.length, [dailyMatrixMonth, regionFilter, branchFilter, categoryFilter, deferredQuery]);

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

  const dailyStaffPg = usePager(sortedDailyStaffRows.length, [dailyMatrixMonth, regionFilter, branchFilter, categoryFilter, deferredQuery]);

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
    if (selectedTopMonth === 'ALL' || !data) {
      return {
        branches: branchRows.slice(0, 10),
        staff: enrichedStaff.filter((s) => !s.isManagement).slice(0, 10),
      };
    }
    const monthStaff = data.monthlyStaff
      .filter((ms) => ms.month === selectedTopMonth)
      .map((ms) => {
        const pts = computeKpiPoints(ms, ruleMap);
        return {
          ...ms,
          branchName: branchNameMap.get(ms.branchId) || ms.branchName || ms.branchId,
          ...pts,
        };
      })
      .filter((ms) => ms.totalTasks > 0 && !staffMetaMap.get(ms.staffId)?.isManagement)
      .sort((a, b) => b.totalPoints - a.totalPoints || b.totalTasks - a.totalTasks);

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
        };
      })
      .sort((a, b) => b.totalPoints - a.totalPoints || b.totalTasks - a.totalTasks);

    return {
      branches: monthBranches.slice(0, 10),
      staff: monthStaff.slice(0, 10),
    };
  }, [selectedTopMonth, data, branchRows, enrichedStaff, ruleMap, branchNameMap]);

  const branchPg = usePager(filteredBranches.length, [period, regionFilter, branchFilter, categoryFilter, deferredQuery]);
  const staffPg = usePager(filteredStaff.length, [period, regionFilter, branchFilter, categoryFilter, deferredQuery]);

  const filtersActive = period !== 'ALL' || regionFilter !== 'ALL' || !!branchFilter || categoryFilter !== 'ALL' || !!query;
  const clearAll = () => {
    setPeriod('ALL');
    setRegionFilter('ALL');
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
    () => [...branches].sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true })),
    [branches]
  );

  const navTabs: { id: KpiView; label: string; Icon: React.ElementType; count?: number }[] = [
    { id: 'all', label: 'Overview', Icon: BarChart3 },
    { id: 'staff', label: 'Staff KPI', Icon: Users, count: filteredStaff.length },
    { id: 'branches', label: 'Branch KPI', Icon: Building2, count: filteredBranches.length },
    { id: 'timeline', label: 'Performance Trend', Icon: Calendar },
    { id: 'top10', label: 'Top 10 Leaderboard', Icon: Trophy },
  ];

  const showSection = (sec: KpiView) => view === 'all' || view === sec;

  const chronologicalTimeSeries = useMemo(() => {
    return [...timeSeries].sort((a, b) => a.period.localeCompare(b.period));
  }, [timeSeries]);
  const reversedTimeSeries = chronologicalTimeSeries;
  const topBranchChartData = useMemo(
    () =>
      filteredBranches.slice(0, 10).map((b) => ({
        name: fmtBranchLabel(b.branchId, b.branchName, true),
        branchName: cleanBranchName(b.branchName),
        branchCode: b.branchId && b.branchId !== 'UNASSIGNED' ? b.branchId : '',
        fullBranchName: fmtBranchLabel(b.branchId, b.branchName),
        posPoints: b.posPoints,
        sbPoints: b.sbPoints,
        khqrPoints: b.khqrPoints,
        ccPoints: b.ccPoints,
        mvPoints: b.mvPoints,
        totalPoints: b.totalPoints,
        staffCount: b.staffCount,
        totalTasks: b.totalTasks,
      })),
    [filteredBranches]
  );

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
              <BigKpiCard
                label="Total KPI Points"
                value={fmtPts(totals.totalPoints)}
                sub={`Avg ${fmtPts(totals.avgBranchPts)} pts / branch`}
                icon={Trophy}
                accentColor="blue"
                badge={KPI_PERIOD_LABEL[period]}
                onClick={() => handleCardClick('points', 'all')}
                active={selectedCard === 'points'}
              />
              <BigKpiCard
                label="Active Branches"
                value={fmtInt(totals.activeBranchCount)}
                sub="Phnom Penh & Provinces"
                icon={Building2}
                accentColor="amber"
                badge={`${totals.branchesOnTarget} on target`}
                onClick={() => handleCardClick('branches', 'all', 'branch')}
                active={selectedCard === 'branches'}
              />
              <BigKpiCard
                label="Active Staff"
                value={fmtInt(totals.activeStaffCount)}
                sub={totals.mgtStaffCount > 0 ? `Avg ${fmtPts(totals.avgStaffPts)} pts/field staff (${totals.mgtStaffCount} mgt exempt)` : `Avg ${fmtPts(totals.avgStaffPts)} pts / staff`}
                icon={Users}
                accentColor="violet"
                badge={`${totals.staffOnTarget} on target`}
                onClick={() => handleCardClick('staff', 'all', 'staff')}
                active={selectedCard === 'staff'}
              />
              <BigKpiCard
                label="Leading Branch"
                value={totals.topBranch ? `${fmtPts(totals.topBranch.totalPoints)} pts` : '—'}
                sub={totals.topBranch ? fmtBranchLabel(totals.topBranch.branchId, totals.topBranch.branchName, true) : 'No branch activity'}
                icon={Award}
                accentColor="emerald"
                badge={totals.topBranch ? `${totals.topBranch.staffCount} staff` : undefined}
                onClick={() => handleCardClick('leading-branch', 'all', 'branch')}
                active={selectedCard === 'leading-branch'}
              />
              <BigKpiCard
                label="Top Performer"
                value={totals.topStaff ? `${fmtPts(totals.topStaff.totalPoints)} pts` : '—'}
                sub={totals.topStaff ? `${totals.topStaff.staffName} (${totals.topStaff.staffId})` : 'No staff activity'}
                icon={Award}
                accentColor="blue"
                badge={totals.topStaff ? cleanBranchName(totals.topStaff.branchName) : undefined}
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
                    <motion.div
                      layoutId="kpi-view-pill"
                      className="absolute inset-0 rounded-lg tab-active-blue shadow-2xs"
                      transition={SPRING}
                    />
                  )}
                  <Icon className="w-3.5 h-3.5 relative z-10 shrink-0" aria-hidden />
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
              <select
                aria-label="Region filter"
                value={regionFilter}
                onChange={(e) => setRegionFilter(e.target.value as 'ALL' | 'PP' | 'PROV')}
                className="text-xs rounded-xl border border-slate-200/90 bg-slate-50/70 hover:bg-white px-2.5 py-1.5 cursor-pointer text-slate-800 font-normal outline-none focus:border-slate-400 transition"
              >
                <option value="ALL">All regions</option>
                <option value="PP">Phnom Penh</option>
                <option value="PROV">Provinces</option>
              </select>

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
      {showSection('all') && (
        loading && !data ? (
          <KpiChartsSkeleton />
        ) : (
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
                  <h3 className="text-sm font-bold text-slate-900">Performance Velocity &amp; Leading Branches</h3>
                  <p className="text-[11.5px] text-slate-500 font-medium">Point output trajectory across time and leading branch contributors</p>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
            {/* Chart 1 (7 cols): Interactive Daily / Weekly / Monthly / Quarterly Stacked Point Trend */}
            <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden flex flex-col justify-between">
              <div className="px-4 py-2.5 border-b border-slate-200/90 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-[#1e5b88] shrink-0" aria-hidden />
                  <h3 className="text-[13px] font-semibold text-slate-900">KPI Point Velocity &amp; Active Staff</h3>
                </div>

                <div className="inline-flex p-0.5 rounded-xl bg-slate-100 border border-slate-200/90 gap-0.5">
                  {([
                    ['daily', 'Daily'],
                    ['weekly', 'Weekly'],
                    ['monthly', 'Monthly'],
                    ['quarterly', 'Quarterly'],
                  ] as const).map(([g, label]) => {
                    const active = granularity === g;
                    return (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setGranularity(g)}
                        aria-pressed={active}
                        className={`relative px-2.5 py-1 rounded-lg text-[11px] cursor-pointer transition-colors ${
                          active ? 'text-white font-semibold' : 'text-slate-700 hover:text-slate-900 font-medium'
                        }`}
                      >
                        {active && (
                          <motion.div
                            layoutId="kpi-chart-granularity-pill"
                            transition={SPRING}
                            className="absolute inset-0 rounded-lg bg-[#003857] shadow-2xs"
                          />
                        )}
                        <span className="relative z-10">{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="px-4 pt-3 pb-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-2.5 text-[11px] font-semibold text-slate-700">
                  <span className="inline-flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-[#006BA6]" aria-hidden />
                    <span>POS Terminal</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5 text-[#4F518C]" aria-hidden />
                    <span>Sound Box</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <QrCode className="w-3.5 h-3.5 text-teal-600" aria-hidden />
                    <span>KHQR</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5 text-amber-600" aria-hidden />
                    <span>Credit Card</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <ClipboardList className="w-3.5 h-3.5 text-[#A4133C]" aria-hidden />
                    <span>Merchant Visit</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 ml-auto text-slate-600 font-medium">
                    <span className="w-3.5 h-0.5 bg-[#1e5b88] rounded-full inline-block" />
                    <Users className="w-3.5 h-3.5 text-[#1e5b88]" aria-hidden />
                    <span>Active staff (right axis)</span>
                  </span>
                </div>

                <div className="h-[280px] w-full">
                  {reversedTimeSeries.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-xs text-slate-400">
                      No trend data available for this granularity.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%" debounce={0}>
                      <ComposedChart data={reversedTimeSeries} margin={{ top: 8, right: 6, left: -14, bottom: 0 }} barGap={4}>
                        <defs>
                          <linearGradient id="kpiPosGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#258cc9" />
                            <stop offset="100%" stopColor="#006BA6" />
                          </linearGradient>
                          <linearGradient id="kpiSbGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#6c6eb0" />
                            <stop offset="100%" stopColor="#4F518C" />
                          </linearGradient>
                          <linearGradient id="kpiKhqrGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#14b8a6" />
                            <stop offset="100%" stopColor="#0d9488" />
                          </linearGradient>
                          <linearGradient id="kpiCcGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#fbbf24" />
                            <stop offset="100%" stopColor="#f59e0b" />
                          </linearGradient>
                          <linearGradient id="kpiMvGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#c73859" />
                            <stop offset="100%" stopColor="#A4133C" />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis
                          dataKey="label"
                          axisLine={{ stroke: '#e2e8f0' }}
                          tickLine={false}
                          tick={{ fontSize: 11, fill: '#64748b' }}
                          dy={4}
                          interval={chronologicalTimeSeries.length > 25 ? 'preserveStartEnd' : 0}
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
                          tick={{ fontSize: 11, fill: '#475569' }}
                          width={32}
                        />
                        <Tooltip content={<CustomTrendTooltip />} cursor={{ fill: 'rgba(0, 56, 87, 0.04)' }} isAnimationActive={false} />
                        <Bar yAxisId="left" dataKey="posPoints" name="POS Terminal" stackId="pts" fill="url(#kpiPosGrad)" stroke="#ffffff" strokeWidth={1} maxBarSize={32} isAnimationActive={false} />
                        <Bar yAxisId="left" dataKey="sbPoints" name="Sound Box" stackId="pts" fill="url(#kpiSbGrad)" stroke="#ffffff" strokeWidth={1} maxBarSize={32} isAnimationActive={false} />
                        <Bar yAxisId="left" dataKey="khqrPoints" name="KHQR" stackId="pts" fill="url(#kpiKhqrGrad)" stroke="#ffffff" strokeWidth={1} maxBarSize={32} isAnimationActive={false} />
                        <Bar yAxisId="left" dataKey="ccPoints" name="Credit Card" stackId="pts" fill="url(#kpiCcGrad)" stroke="#ffffff" strokeWidth={1} maxBarSize={32} isAnimationActive={false} />
                        <Bar yAxisId="left" dataKey="mvPoints" name="Merchant Visit" stackId="pts" fill="url(#kpiMvGrad)" stroke="#ffffff" strokeWidth={1} maxBarSize={32} isAnimationActive={false} />
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="activeStaff"
                          name="Active Staff"
                          stroke="#1e5b88"
                          strokeWidth={1.75}
                          dot={{ r: 3, fill: '#ffffff', stroke: '#1e5b88', strokeWidth: 1.75 }}
                          activeDot={{ r: 4.5, fill: '#1e5b88', stroke: '#ffffff', strokeWidth: 2 }}
                          isAnimationActive={false}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>

            {/* Chart 2 (5 cols): Top 10 Branches by KPI Point Mix */}
            <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden flex flex-col justify-between">
              <div className="px-4 py-2.5 border-b border-slate-200/90 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Building2 className="w-4 h-4 text-[#1e5b88] shrink-0" aria-hidden />
                  <h3 className="text-[13px] font-semibold text-slate-900">Leading Branches</h3>
                  <span className="text-[12px] text-slate-600 font-medium">· {KPI_PERIOD_LABEL[period]}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setView('branches')}
                  className="text-xs font-semibold text-[#1e5b88] hover:underline cursor-pointer"
                >
                  View all ({filteredBranches.length}) →
                </button>
              </div>

              <div className="px-4 pt-3 pb-4">
                <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 pb-2.5 text-[11px] font-semibold text-slate-700">
                  <span className="inline-flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-[#006BA6]" aria-hidden />
                    <span>POS</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5 text-[#4F518C]" aria-hidden />
                    <span>Sound Box</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <QrCode className="w-3.5 h-3.5 text-teal-600" aria-hidden />
                    <span>KHQR</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5 text-amber-600" aria-hidden />
                    <span>Credit Card</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <ClipboardList className="w-3.5 h-3.5 text-[#A4133C]" aria-hidden />
                    <span>Merchant Visit</span>
                  </span>
                </div>

                <div className="h-[280px] w-full">
                  {topBranchChartData.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-xs text-slate-400">
                      No branch activity matching current filters.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%" debounce={0}>
                      <BarChart
                        layout="vertical"
                        data={topBranchChartData}
                        margin={{ top: 4, right: 14, left: 0, bottom: 0 }}
                        barCategoryGap="24%"
                      >
                        <defs>
                          <linearGradient id="kpiBranchPosGrad" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#006BA6" />
                            <stop offset="100%" stopColor="#258cc9" />
                          </linearGradient>
                          <linearGradient id="kpiBranchSbGrad" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#4F518C" />
                            <stop offset="100%" stopColor="#6c6eb0" />
                          </linearGradient>
                          <linearGradient id="kpiBranchKhqrGrad" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#0d9488" />
                            <stop offset="100%" stopColor="#14b8a6" />
                          </linearGradient>
                          <linearGradient id="kpiBranchCcGrad" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#f59e0b" />
                            <stop offset="100%" stopColor="#fbbf24" />
                          </linearGradient>
                          <linearGradient id="kpiBranchMvGrad" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#A4133C" />
                            <stop offset="100%" stopColor="#c73859" />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                        <XAxis
                          type="number"
                          axisLine={{ stroke: '#e2e8f0' }}
                          tickLine={false}
                          tick={{ fontSize: 11, fill: '#64748b' }}
                          tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))}
                        />
                        <YAxis
                          type="category"
                          dataKey="name"
                          width={188}
                          axisLine={false}
                          tickLine={false}
                          interval={0}
                          tick={<BranchYAxisTick />}
                        />
                        <Tooltip content={<CustomBranchTooltip />} cursor={{ fill: 'rgba(0, 56, 87, 0.04)' }} isAnimationActive={false} />
                        <Bar dataKey="posPoints" name="POS Terminal" stackId="b" fill="url(#kpiBranchPosGrad)" stroke="#ffffff" strokeWidth={1} maxBarSize={14} isAnimationActive={false} />
                        <Bar dataKey="sbPoints" name="Sound Box" stackId="b" fill="url(#kpiBranchSbGrad)" stroke="#ffffff" strokeWidth={1} maxBarSize={14} isAnimationActive={false} />
                        <Bar dataKey="khqrPoints" name="KHQR" stackId="b" fill="url(#kpiBranchKhqrGrad)" stroke="#ffffff" strokeWidth={1} maxBarSize={14} isAnimationActive={false} />
                        <Bar dataKey="ccPoints" name="Credit Card" stackId="b" fill="url(#kpiBranchCcGrad)" stroke="#ffffff" strokeWidth={1} maxBarSize={14} isAnimationActive={false} />
                        <Bar dataKey="mvPoints" name="Merchant Visit" stackId="b" fill="url(#kpiBranchMvGrad)" stroke="#ffffff" strokeWidth={1} maxBarSize={14} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      ))}

      {/* ───────────── Most KPI Types Consumed (Push Configuring Hub Backdrop Style) ───────────── */}
      {showSection('all') && (
        <section
          className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden p-4 sm:p-5 space-y-4"
          aria-label="Most KPI Types Consumed"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-teal-50 text-teal-700 border border-teal-100 flex items-center justify-center shrink-0">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">KPI Types &amp; Point Breakdown</h3>
                <p className="text-[11.5px] text-slate-500 font-medium">Hardware deployments, QR merchant onboarding, and card acquisitions · click a category to filter</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowSubCategories((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold text-xs border shadow-2xs cursor-pointer bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-200/90 transition"
              >
                <span>{showSubCategories ? 'Hide' : 'Show'} {subCategoryBreakdown.length} sub-category tasks</span>
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
                    onClick={() => setCategoryFilter((c) => (c === item.cat ? 'ALL' : item.cat))}
                    className={`text-left rounded-2xl border p-4 transition-all cursor-pointer shadow-2xs hover:shadow-md hover:-translate-y-0.5 bg-white ${
                      activeFilter ? 'border-[#1e5b88] ring-2 ring-sky-100' : 'border-slate-200/90 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2.5">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border ${style.badge}`}>
                        <Icon className="w-3.5 h-3.5" /> {item.cat}
                      </span>
                      <span className="font-figure text-xl font-bold text-slate-900 tabular-nums">{fmtPts(item.pts)} <span className="text-xs font-medium text-slate-600">pts</span></span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 my-2.5 text-xs">
                      <div>
                        <div className="text-[11px] font-medium text-slate-600">Task volume</div>
                        <div className="font-semibold text-slate-900 tabular-nums mt-0.5">{fmtInt(item.tasks)} <span className="font-normal text-slate-600">({volShare}%)</span></div>
                      </div>
                      <div>
                        <div className="text-[11px] font-medium text-slate-600">Point share</div>
                        <div className="font-semibold text-slate-900 tabular-nums mt-0.5">{ptShare}% <span className="font-normal text-slate-600">of total</span></div>
                      </div>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden mb-2.5">
                      <div className={`h-full rounded-full transition-all duration-300 ${style.bar}`} style={{ width: `${Math.max(4, ptShare)}%` }} />
                    </div>
                    <div className="pt-2 border-t border-slate-100 text-[11.5px] font-medium text-slate-700 truncate">{item.extra}</div>
                  </button>
                );
              })}
            </div>

            <AnimatePresence initial={false}>
              {showSubCategories && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="mt-3.5 rounded-2xl border border-slate-200/90 bg-white shadow-2xs overflow-hidden">
                    <div className="bg-slate-50 px-3.5 py-2 border-b border-slate-200 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      <span>Sub-category task breakdown ({subCategoryBreakdown.length} tasks)</span>
                      <span>Volume · Weight · Total points</span>
                    </div>
                    <div className="divide-y divide-slate-100 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 text-[13px] text-slate-700">
                      {subCategoryBreakdown.map((sc, i) => {
                        const pct = totals.totalPoints > 0 ? Math.round((sc.points / totals.totalPoints) * 100) : 0;
                        const catStyle = CAT_COLORS[sc.category];
                        return (
                          <div key={sc.code} className="px-3.5 py-2.5 flex items-center justify-between gap-3 border-r border-slate-100 last:border-r-0">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] font-mono text-slate-400">{i + 1}.</span>
                                <span className="text-slate-900 truncate">{sc.label}</span>
                              </div>
                              <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                                <span className={`px-1.5 py-0.2 rounded border text-[10px] ${catStyle.badge}`}>{sc.category}</span>
                                <span>{fmtInt(sc.count)} {sc.unit} × {sc.unitPts} pt</span>
                              </div>
                            </div>
                            <div className="text-right shrink-0 tabular-nums">
                              <div className="text-slate-900 font-medium">{fmtPts(sc.points)} pts</div>
                              <div className="text-[11px] text-slate-500">{pct}% share</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>
      )}

      {/* ───────────── Combined Institutional Leaderboard (Top 10 Staff & Branch Switchable) ───────────── */}
      {(showSection('all') || showSection('top10')) && (
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
                <p className="text-[11.5px] text-slate-500 font-medium">Top 10 institutional performers and branches ranked by KPI points</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {/* Switch View by Staff or Branch */}
              <div className="inline-flex p-0.5 rounded-xl bg-slate-100 border border-slate-200/90 gap-0.5 text-xs shrink-0 whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => setLeaderboardMode('staff')}
                  className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${
                    leaderboardMode === 'staff' ? 'text-white' : 'text-slate-700 hover:text-slate-900 font-medium'
                  }`}
                >
                  {leaderboardMode === 'staff' && (
                    <motion.div
                      layoutId="kpi-top10-mode-pill"
                      transition={SPRING}
                      className="absolute inset-0 rounded-lg tab-active-blue shadow-2xs"
                    />
                  )}
                  <Users className="w-3.5 h-3.5 relative z-10" aria-hidden />
                  <span className="relative z-10">Top 10 Staff</span>
                  <span className={`relative z-10 text-[10px] px-1.5 py-0.2 rounded-full font-figure tabular-nums font-medium ${leaderboardMode === 'staff' ? 'bg-white/20 text-white' : 'bg-white text-slate-700 border border-slate-200/80'}`}>
                    {top10Data.staff.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setLeaderboardMode('branch')}
                  className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${
                    leaderboardMode === 'branch' ? 'text-white' : 'text-slate-700 hover:text-slate-900 font-medium'
                  }`}
                >
                  {leaderboardMode === 'branch' && (
                    <motion.div
                      layoutId="kpi-top10-mode-pill"
                      transition={SPRING}
                      className="absolute inset-0 rounded-lg tab-active-blue shadow-2xs"
                    />
                  )}
                  <Building2 className="w-3.5 h-3.5 relative z-10" aria-hidden />
                  <span className="relative z-10">Top 10 Branches</span>
                  <span className={`relative z-10 text-[10px] px-1.5 py-0.2 rounded-full font-figure tabular-nums font-medium ${leaderboardMode === 'branch' ? 'bg-white/20 text-white' : 'bg-white text-slate-700 border border-slate-200/80'}`}>
                    {top10Data.branches.length}
                  </span>
                </button>
              </div>

              {/* Month Selector Pills */}
              <div className="inline-flex flex-wrap items-center gap-0.5 p-0.5 rounded-xl bg-slate-100 border border-slate-200/90">
                <button
                  type="button"
                  onClick={() => setSelectedTopMonth('ALL')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] cursor-pointer transition ${
                    selectedTopMonth === 'ALL' ? 'bg-[#003857] text-white font-semibold shadow-2xs' : 'text-slate-700 hover:text-slate-900 font-medium'
                  }`}
                >
                  {KPI_PERIOD_LABEL[period]}
                </button>
                {availableMonths.slice(0, 6).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setSelectedTopMonth(m)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] cursor-pointer transition ${
                      selectedTopMonth === m ? 'bg-[#003857] text-white font-semibold shadow-2xs' : 'text-slate-700 hover:text-slate-900 font-medium'
                    }`}
                  >
                    {fmtMonth(m)}
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
              <span className="text-slate-500 font-medium normal-case text-xs">ranked by total KPI points</span>
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
                            <Cpu className="w-3.5 h-3.5 text-sky-400" />
                            <span>POS Pts</span>
                          </span>
                        </th>
                        <th className="py-2.5 px-3 text-right w-28 border-b border-white/20">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <Volume2 className="w-3.5 h-3.5 text-[#a2a5e0]" />
                            <span>SB Pts</span>
                          </span>
                        </th>
                        <th className="py-2.5 px-3 text-right w-24 border-b border-white/20">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <QrCode className="w-3.5 h-3.5 text-teal-300" />
                            <span>KHQR Pts</span>
                          </span>
                        </th>
                        <th className="py-2.5 px-3 text-right w-24 border-b border-white/20">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <CreditCard className="w-3.5 h-3.5 text-amber-300" />
                            <span>CC Pts</span>
                          </span>
                        </th>
                        <th className="py-2.5 px-3 text-right w-24 border-b border-white/20">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <ClipboardList className="w-3.5 h-3.5 text-[#34d399]" />
                            <span>MV Pts</span>
                          </span>
                        </th>
                        <th className="py-2.5 px-3 text-center w-28 border-b border-white/20">Category Mix</th>
                        <th className="py-2.5 px-3 text-right w-24 border-b border-white/20">Total Tasks</th>
                        <th className="py-2.5 px-4 text-right w-32 border-b border-white/20">Total Points</th>
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
                              {fmtPts(s.posPoints)} <span className="text-[11px] text-slate-400">pts</span>
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-700 font-medium">
                              {fmtPts(s.sbPoints)} <span className="text-[11px] text-slate-400">pts</span>
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-700 font-medium">
                              {fmtPts(s.khqrPoints)} <span className="text-[11px] text-slate-400">pts</span>
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-700 font-medium">
                              {fmtPts(s.ccPoints)} <span className="text-[11px] text-slate-400">pts</span>
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-700 font-medium">
                              {fmtPts(s.mvPoints)} <span className="text-[11px] text-slate-400">pts</span>
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="flex justify-center items-center">
                                <MiniMixBar pos={s.posPoints} sb={s.sbPoints} khqr={s.khqrPoints} cc={s.ccPoints} mv={s.mvPoints} total={s.totalPoints} />
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-600 font-medium">
                              {fmtInt(s.totalTasks)}
                            </td>
                            <td className="py-2.5 px-4 text-right tabular-nums">
                              <span className="font-bold text-[#003857] text-[13.5px]">
                                {fmtPts(s.totalPoints)} <span className="text-xs font-semibold">pts</span>
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
                            <Cpu className="w-3.5 h-3.5 text-sky-400" />
                            <span>POS Pts</span>
                          </span>
                        </th>
                        <th className="py-2.5 px-3 text-right w-28 border-b border-white/20">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <Volume2 className="w-3.5 h-3.5 text-[#a2a5e0]" />
                            <span>SB Pts</span>
                          </span>
                        </th>
                        <th className="py-2.5 px-3 text-right w-24 border-b border-white/20">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <QrCode className="w-3.5 h-3.5 text-teal-300" />
                            <span>KHQR Pts</span>
                          </span>
                        </th>
                        <th className="py-2.5 px-3 text-right w-24 border-b border-white/20">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <CreditCard className="w-3.5 h-3.5 text-amber-300" />
                            <span>CC Pts</span>
                          </span>
                        </th>
                        <th className="py-2.5 px-3 text-right w-24 border-b border-white/20">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <ClipboardList className="w-3.5 h-3.5 text-[#34d399]" />
                            <span>MV Pts</span>
                          </span>
                        </th>
                        <th className="py-2.5 px-3 text-center w-28 border-b border-white/20">Category Mix</th>
                        <th className="py-2.5 px-3 text-right w-24 border-b border-white/20">Pts / Staff</th>
                        <th className="py-2.5 px-3 text-right w-24 border-b border-white/20">Total Tasks</th>
                        <th className="py-2.5 px-4 text-right w-32 border-b border-white/20">Total Points</th>
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
                              {fmtPts(b.posPoints)} <span className="text-[11px] text-slate-400">pts</span>
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-700 font-medium">
                              {fmtPts(b.sbPoints)} <span className="text-[11px] text-slate-400">pts</span>
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-700 font-medium">
                              {fmtPts(b.khqrPoints)} <span className="text-[11px] text-slate-400">pts</span>
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-700 font-medium">
                              {fmtPts(b.ccPoints)} <span className="text-[11px] text-slate-400">pts</span>
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-700 font-medium">
                              {fmtPts(b.mvPoints)} <span className="text-[11px] text-slate-400">pts</span>
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="flex justify-center items-center">
                                <MiniMixBar pos={b.posPoints} sb={b.sbPoints} khqr={b.khqrPoints} cc={b.ccPoints} mv={b.mvPoints} total={b.totalPoints} />
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-700 font-medium">
                              {fmtPts(b.ptsPerStaff)} <span className="text-[11px] text-slate-400">pts</span>
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-600 font-medium">
                              {fmtInt(b.totalTasks)}
                            </td>
                            <td className="py-2.5 px-4 text-right tabular-nums">
                              <span className="font-bold text-[#003857] text-[13.5px]">
                                {fmtPts(b.totalPoints)} <span className="text-xs font-semibold">pts</span>
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
      )}

      {/* ───────────── Overall Performance Breakdown by Daily, Weekly, Monthly & Quarterly ───────────── */}
      {(showSection('all') || showSection('timeline')) && (
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
                    · {granularity === 'daily' ? 'Daily (last 30 days)' : granularity === 'weekly' ? 'Weekly (last 12 weeks)' : granularity === 'quarterly' ? 'Quarterly (last 8 quarters)' : 'Monthly (last 12 months)'}
                  </span>
                </div>
                <p className="text-[11.5px] text-slate-500 font-medium">Historical periodic trend of branch activity, staff deployment, and point production</p>
              </div>
            </div>
            <div className="inline-flex rounded-xl bg-slate-100 p-0.5 border border-slate-200/90 text-[11px] gap-0.5">
              {([
                ['daily', 'Daily'],
                ['weekly', 'Weekly'],
                ['monthly', 'Monthly'],
                ['quarterly', 'Quarterly'],
              ] as const).map(([g, label]) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGranularity(g)}
                  className={`px-3 py-1 rounded-lg cursor-pointer transition font-semibold ${
                    granularity === g ? 'bg-[#003857] text-white shadow-2xs' : 'text-slate-700 hover:text-slate-900 font-medium'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto overflow-y-hidden w-full overscroll-x-contain">
            <div className="min-w-[1080px] w-full">
              <div className="grid items-center gap-x-4 grid-cols-[minmax(110px,1.2fr)_minmax(68px,0.75fr)_minmax(65px,0.7fr)_minmax(100px,1.1fr)_minmax(100px,1.1fr)_minmax(110px,1.2fr)_minmax(100px,1.1fr)_minmax(100px,1.1fr)_minmax(72px,0.8fr)_minmax(76px,0.85fr)_minmax(100px,1.1fr)_minmax(76px,0.85fr)] glass-table-thead navy-header-bar bg-[#003857] text-white text-xs font-semibold normal-case tracking-normal px-4 py-2.5">
              <SortableHeader label="Period" sortKey="period" activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} />
              <SortableHeader label="Branches" sortKey="activeBranches" activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" />
              <SortableHeader label="Staff" sortKey="activeStaff" activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" />
              <SortableHeader icon={<Cpu className="w-3.5 h-3.5 text-sky-400 shrink-0" aria-hidden />} label="POS Points" sortKey="posPoints" activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
              <SortableHeader icon={<Volume2 className="w-3.5 h-3.5 text-[#a2a5e0] shrink-0" aria-hidden />} label="SB Points" sortKey="sbPoints" activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
              <SortableHeader icon={<QrCode className="w-3.5 h-3.5 text-teal-300 shrink-0" aria-hidden />} label="KHQR Points" sortKey="khqrPoints" activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
              <SortableHeader icon={<CreditCard className="w-3.5 h-3.5 text-amber-300 shrink-0" aria-hidden />} label="CC Points" sortKey="ccPoints" activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
              <SortableHeader icon={<ClipboardList className="w-3.5 h-3.5 text-[#A4133C] shrink-0" aria-hidden />} label="MV Points" sortKey="mvPoints" activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
              <SortableHeader label="Tasks" sortKey="totalTasks" activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
              <SortableHeader label="Pts/Staff" sortKey="ptsPerStaff" activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" />
              <SortableHeader label="Total Points" sortKey="totalPoints" activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" />
              <SortableHeader label="Change" sortKey="growthPct" activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" />
            </div>
            <div className="divide-y divide-slate-200/80">
              {timeSeries.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400">No historical records found.</div>
              ) : (
                timeSeries.map((t) => (
                  <div
                    key={t.period}
                    className="grid items-center gap-x-4 grid-cols-[minmax(110px,1.2fr)_minmax(68px,0.75fr)_minmax(65px,0.7fr)_minmax(100px,1.1fr)_minmax(100px,1.1fr)_minmax(110px,1.2fr)_minmax(100px,1.1fr)_minmax(100px,1.1fr)_minmax(72px,0.8fr)_minmax(76px,0.85fr)_minmax(100px,1.1fr)_minmax(76px,0.85fr)] px-4 py-2.5 text-[13px] text-slate-700 hover:bg-slate-50/80 transition-colors"
                  >
                    <span className="font-normal text-slate-900 tabular-nums">{t.label}</span>
                    <span className="text-right tabular-nums font-normal text-slate-800">{fmtInt(t.activeBranches)}</span>
                    <span className="text-right tabular-nums font-normal text-slate-800">{fmtInt(t.activeStaff)}</span>
                    <span className="text-center tabular-nums"><TaskPtsCell tasks={t.posTasks} pts={t.posPoints} /></span>
                    <span className="text-center tabular-nums"><TaskPtsCell tasks={t.sbTasks} pts={t.sbPoints} /></span>
                    <span className="text-center tabular-nums"><TaskPtsCell tasks={t.khqrTasks} pts={t.khqrPoints} /></span>
                    <span className="text-center tabular-nums"><TaskPtsCell tasks={t.ccTasks} pts={t.ccPoints} /></span>
                    <span className="text-center tabular-nums"><TaskPtsCell tasks={t.mvTasks} pts={t.mvPoints} /></span>
                    <span className="text-center tabular-nums font-normal text-slate-800">{fmtInt(t.totalTasks)}</span>
                    <span className="text-right tabular-nums font-normal text-slate-800">{fmtPts(t.ptsPerStaff)}</span>
                    <span className="text-right tabular-nums font-figure font-normal text-[#003857]">{fmtPts(t.totalPoints)} pts</span>
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
        </section>
      )}

      {/* ───────────── KPI Performance by Branch & Staff (Switchable Combined Table) ───────────── */}
      {(showSection('all') || showSection('branches') || showSection('staff')) && (
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
                <p className="text-[11.5px] text-slate-500 font-medium">Rankings, category points, target progress, and daily operational activity</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <div className="overflow-x-auto no-scrollbar max-w-full py-0.5">
                <div className="inline-flex p-0.5 rounded-xl bg-slate-100 border border-slate-200/90 gap-0.5 text-xs shrink-0 whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => { handleTableModeChange('staff'); setStaffSubView('summary'); }}
                  className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${
                    tableMode === 'staff' && staffSubView === 'summary' ? 'text-white' : 'text-slate-700 hover:text-slate-900 font-medium'
                  }`}
                >
                  {tableMode === 'staff' && staffSubView === 'summary' && (
                    <motion.div
                      layoutId="kpi-table-mode-pill"
                      transition={SPRING}
                      className="absolute inset-0 rounded-lg tab-active-blue shadow-2xs"
                    />
                  )}
                  <Users className="w-3.5 h-3.5 relative z-10" aria-hidden />
                  <span className="relative z-10">KPI by Staff</span>
                  <span className={`relative z-10 text-[10px] px-1.5 py-0.2 rounded-full font-figure tabular-nums ${tableMode === 'staff' && staffSubView === 'summary' ? 'bg-white/20 text-white' : 'bg-white text-slate-700 border border-slate-200/80 font-medium'}`}>
                    {filteredStaff.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => { handleTableModeChange('branch'); setBranchSubView('summary'); }}
                  className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${
                    tableMode === 'branch' && branchSubView === 'summary' ? 'text-white' : 'text-slate-700 hover:text-slate-900 font-medium'
                  }`}
                >
                  {tableMode === 'branch' && branchSubView === 'summary' && (
                    <motion.div
                      layoutId="kpi-table-mode-pill"
                      transition={SPRING}
                      className="absolute inset-0 rounded-lg tab-active-blue shadow-2xs"
                    />
                  )}
                  <Building2 className="w-3.5 h-3.5 relative z-10" aria-hidden />
                  <span className="relative z-10">KPI by Branch</span>
                  <span className={`relative z-10 text-[10px] px-1.5 py-0.2 rounded-full font-figure tabular-nums ${tableMode === 'branch' && branchSubView === 'summary' ? 'bg-white/20 text-white' : 'bg-white text-slate-700 border border-slate-200/80 font-medium'}`}>
                    {filteredBranches.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => { handleTableModeChange('staff'); setStaffSubView('daily'); }}
                  className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${
                    tableMode === 'staff' && staffSubView === 'daily' ? 'text-white' : 'text-slate-700 hover:text-slate-900 font-medium'
                  }`}
                >
                  {tableMode === 'staff' && staffSubView === 'daily' && (
                    <motion.div
                      layoutId="kpi-table-mode-pill"
                      transition={SPRING}
                      className="absolute inset-0 rounded-lg tab-active-blue shadow-2xs"
                    />
                  )}
                  <Calendar className="w-3.5 h-3.5 relative z-10" aria-hidden />
                  <span className="relative z-10">Staff Daily Tasks</span>
                  <span className={`relative z-10 text-[10px] px-1.5 py-0.2 rounded-full font-figure tabular-nums ${tableMode === 'staff' && staffSubView === 'daily' ? 'bg-white/20 text-white' : 'bg-white text-slate-700 border border-slate-200/80 font-medium'}`}>
                    1–{matrixDays.length}d
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => { handleTableModeChange('branch'); setBranchSubView('daily'); }}
                  className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${
                    tableMode === 'branch' && branchSubView === 'daily' ? 'text-white' : 'text-slate-700 hover:text-slate-900 font-medium'
                  }`}
                >
                  {tableMode === 'branch' && branchSubView === 'daily' && (
                    <motion.div
                      layoutId="kpi-table-mode-pill"
                      transition={SPRING}
                      className="absolute inset-0 rounded-lg tab-active-blue shadow-2xs"
                    />
                  )}
                  <Calendar className="w-3.5 h-3.5 relative z-10" aria-hidden />
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
                <span>
                  {tableMode === 'branch'
                    ? `Showing ${filteredBranches.length} branch records · Dynamic Target: ${fmtPts(activeTargets.staff)} pts/staff × Active Field Officers (${monthWorkDaysSummary.workDays} work days, Sat/Sun & holidays excluded)`
                    : `Showing ${filteredStaff.length} staff records · Individual Target: ${fmtPts(activeTargets.staff)} pts/staff (${monthWorkDaysSummary.workDays} work days, Sat/Sun & holidays excluded)`}
                </span>
                {tableMode === 'staff' && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-500 font-medium">Level:</span>
                    <div className="inline-flex p-0.5 rounded-lg bg-slate-100 border border-slate-200 text-xs">
                      <button
                        type="button"
                        onClick={() => setStaffLevelFilter('all')}
                        className={`px-2 py-0.5 rounded-md text-[11px] font-semibold transition cursor-pointer ${
                          staffLevelFilter === 'all' ? 'bg-[#003857] text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        All ({enrichedStaff.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setStaffLevelFilter('field')}
                        className={`px-2 py-0.5 rounded-md text-[11px] font-semibold transition cursor-pointer ${
                          staffLevelFilter === 'field' ? 'bg-[#003857] text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Field Officers ({enrichedStaff.filter((s) => !s.isManagement).length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setStaffLevelFilter('management')}
                        className={`px-2 py-0.5 rounded-md text-[11px] font-semibold transition cursor-pointer ${
                          staffLevelFilter === 'management' ? 'bg-[#003857] text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                        }`}
                        title="Management level staff (Branch Managers, Supervisors, Team Leads, Admins) who oversee operations and are exempt from field KPIs"
                      >
                        Management ({enrichedStaff.filter((s) => s.isManagement).length})
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
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`${tableMode}-${tableMode === 'branch' ? branchSubView : staffSubView}`}
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.12, ease: 'easeOut' }}
              >
                {tableMode === 'branch' ? (
                  branchSubView === 'daily' ? (
                    <>
                      <div className="overflow-x-auto overflow-y-hidden w-full overscroll-x-contain">
                        <table className="kpi-matrix-table w-full text-left border-separate border-spacing-0 text-[13px]">
                          <thead>
                            <tr className="navy-header-bar bg-[#003857] text-white text-xs font-medium normal-case tracking-normal select-none">
                              <th className="sticky left-0 bg-[#003857] z-30 px-2 py-2.5 text-center w-[44px] min-w-[44px] font-medium text-xs text-white border-b border-white/20">
                                No.
                              </th>
                              <th
                                className="sticky left-[44px] bg-[#003857] z-30 px-3 py-2.5 text-left w-[180px] min-w-[180px] cursor-pointer select-none hover:bg-white/10 transition-colors border-b border-white/20"
                                onClick={() => {
                                  setDailySortKey('branchName');
                                  setDailySortDir((d) => (dailySortKey === 'branchName' ? (d === 'asc' ? 'desc' : 'asc') : 'desc'));
                                }}
                              >
                                <div className="flex items-center gap-1 font-medium text-xs text-white">
                                  <span>Branch Name</span>
                                  <SortIcon active={dailySortKey === 'branchName'} dir={dailySortDir} />
                                </div>
                              </th>
                              <th
                                className="sticky left-[224px] bg-[#003857] z-30 px-2.5 py-2.5 text-left w-[105px] min-w-[105px] cursor-pointer select-none hover:bg-white/10 transition-colors border-r border-slate-700/90 border-b border-white/20 shadow-[2px_0_4px_rgba(0,0,0,0.18)]"
                                onClick={() => {
                                  setDailySortKey('branchId');
                                  setDailySortDir((d) => (dailySortKey === 'branchId' ? (d === 'asc' ? 'desc' : 'asc') : 'desc'));
                                }}
                              >
                                <div className="flex items-center gap-1 font-medium text-xs text-white">
                                  <span>Branch Code</span>
                                  <SortIcon active={dailySortKey === 'branchId'} dir={dailySortDir} />
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
                              <th className="px-3 py-2.5 text-center w-[130px] min-w-[130px] font-medium text-xs text-white border-b border-white/20">
                                Performance
                              </th>
                            </tr>
                          </thead>

                          <tbody className="divide-y divide-slate-200/90 text-slate-700">
                            {sortedDailyBranchRows.length === 0 ? (
                              <tr>
                                <td colSpan={matrixDays.length + 8} className="p-10 text-center text-sm text-slate-500">
                                  No branch records match the current filters.
                                </td>
                              </tr>
                            ) : (
                              sortedDailyBranchRows.slice(dailyBranchPg.start, dailyBranchPg.end).map((row, idx) => {
                                const rank = dailyBranchPg.start + idx + 1;
                                return (
                                  <tr key={row.branchId} className="group hover:bg-slate-50/80 transition-colors">
                                    <td className="sticky left-0 bg-white group-hover:bg-slate-50 z-10 px-2 py-2 text-center tabular-nums text-slate-500 text-xs border-r border-slate-200/60 font-normal">
                                      {rank}
                                    </td>
                                    <td
                                      className="sticky left-[44px] bg-white group-hover:bg-slate-50 z-10 px-3 py-2 text-slate-900 border-r border-slate-200/60 font-normal truncate max-w-[180px]"
                                      title={cleanBranchName(row.branchName)}
                                    >
                                      {cleanBranchName(row.branchName)}
                                    </td>
                                    <td
                                      className="sticky left-[224px] bg-white group-hover:bg-slate-50 z-10 px-2.5 py-2 font-mono text-xs text-slate-700 tabular-nums shadow-[2px_0_4px_rgba(0,0,0,0.06)] border-r border-slate-200/60 font-normal truncate max-w-[105px]"
                                      title={row.branchId}
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
                                  colSpan={3}
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
                <div className="min-w-[1360px] w-full">
                <div className="grid items-center gap-x-4 grid-cols-[40px_minmax(160px,1.3fr)_85px_minmax(50px,0.5fr)_minmax(96px,0.95fr)_minmax(96px,0.95fr)_minmax(104px,1fr)_minmax(96px,0.95fr)_minmax(96px,0.95fr)_minmax(68px,0.65fr)_minmax(68px,0.65fr)_minmax(96px,0.95fr)_minmax(105px,1fr)_135px_24px] glass-table-thead navy-header-bar bg-[#003857] text-white text-xs font-semibold normal-case tracking-normal px-4 py-2.5">
                  <span className="text-right">No.</span>
                  <SortableHeader label="Branch Name" sortKey="branchName" activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} />
                  <SortableHeader label="Branch Code" sortKey="branchId" activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} />
                  <SortableHeader label="Staff" sortKey="staffCount" activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader icon={<Cpu className="w-3.5 h-3.5 text-sky-400 shrink-0" aria-hidden />} label="POS Points" sortKey="posPoints" activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader icon={<Volume2 className="w-3.5 h-3.5 text-[#a2a5e0] shrink-0" aria-hidden />} label="SB Points" sortKey="sbPoints" activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader icon={<QrCode className="w-3.5 h-3.5 text-teal-300 shrink-0" aria-hidden />} label="KHQR Points" sortKey="khqrPoints" activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader icon={<CreditCard className="w-3.5 h-3.5 text-amber-300 shrink-0" aria-hidden />} label="CC Points" sortKey="ccPoints" activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader icon={<ClipboardList className="w-3.5 h-3.5 text-[#A4133C] shrink-0" aria-hidden />} label="MV Points" sortKey="mvPoints" activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader label="Pts/Staff" sortKey="ptsPerStaff" activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" title="Average KPI points per active staff member in the branch" />
                  <SortableHeader label="Total Tasks" sortKey="totalTasks" activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader label="Total Points" sortKey="totalPoints" activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" />
                  <SortableHeader label={activeTargets.label} sortKey="targetPct" activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} />
                  <span>Performance</span>
                  <span />
                </div>

                <div className="divide-y divide-slate-200/90">
                  {filteredBranches.length === 0 ? (
                    <div className="p-10 text-center text-sm text-slate-500">No branches match the current filters.</div>
                  ) : (
                    filteredBranches.slice(branchPg.start, branchPg.end).map((b, i) => {
                      const rank = branchPg.start + i + 1;
                      const isOpen = openBranch === b.branchId;
                      return (
                        <div key={b.branchId} className="hover:bg-slate-50/70">
                          <button
                            type="button"
                            onClick={() => setOpenBranch((o) => (o === b.branchId ? null : b.branchId))}
                            aria-expanded={isOpen}
                            className="grid items-center gap-x-4 grid-cols-[40px_minmax(160px,1.3fr)_85px_minmax(50px,0.5fr)_minmax(96px,0.95fr)_minmax(96px,0.95fr)_minmax(104px,1fr)_minmax(96px,0.95fr)_minmax(96px,0.95fr)_minmax(68px,0.65fr)_minmax(68px,0.65fr)_minmax(96px,0.95fr)_minmax(105px,1fr)_135px_24px] w-full text-left px-4 py-2.5 text-[13px] text-slate-700 cursor-pointer"
                          >
                            <span className="text-right tabular-nums text-slate-500">{rank}</span>
                            <span className="flex items-center gap-2 min-w-0">
                              <span className="w-6 h-6 rounded-md bg-slate-100 text-[#1e5b88] border border-slate-200/80 flex items-center justify-center shrink-0">
                                <Building2 className="w-3.5 h-3.5" aria-hidden />
                              </span>
                              <span className="block text-slate-900 truncate">
                                {cleanBranchName(b.branchName)}
                              </span>
                            </span>
                            <span className="font-mono text-xs text-slate-700 tabular-nums truncate block" title={b.branchId === 'UNASSIGNED' ? 'Unassigned' : b.branchId}>
                              {fmtBranchCode(b.branchId)}
                            </span>
                            <span className="text-center tabular-nums text-slate-800">{b.staffCount}</span>
                            <span className="text-center tabular-nums"><TaskPtsCell tasks={b.posTasks} pts={b.posPoints} /></span>
                            <span className="text-center tabular-nums"><TaskPtsCell tasks={b.sbTasks} pts={b.sbPoints} /></span>
                            <span className="text-center tabular-nums"><TaskPtsCell tasks={b.khqrTasks} pts={b.khqrPoints} /></span>
                            <span className="text-center tabular-nums"><TaskPtsCell tasks={b.ccTasks} pts={b.ccPoints} /></span>
                            <span className="text-center tabular-nums"><TaskPtsCell tasks={b.mvTasks} pts={b.mvPoints} /></span>
                            <span className="text-center tabular-nums text-slate-800">{fmtPts(b.ptsPerStaff)}</span>
                            <span className="text-center tabular-nums text-slate-800">{fmtInt(b.totalTasks)}</span>
                            <span className="text-right tabular-nums font-figure text-[#003857]">{fmtPts(b.totalPoints)} pts</span>
                            <span><TargetBar pct={b.targetPct} points={b.totalPoints} target={b.effectiveTarget} pacingPct={b.pacingPct} pacingTarget={b.pacingTarget} /></span>
                            <span><RatingBadge rating={b.rating} pacingPct={b.pacingPct} title={`Pacing: ${b.pacingPct}% (${fmtPts(b.totalPoints)} / ${fmtPts(b.pacingTarget)} pts pacing target for Day ${pacingInfo.elapsedWorkDays}/${pacingInfo.totalWorkDays})`} /></span>
                            <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
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
                                <SubCategoryMiniGrid raw={b.raw} ruleMap={ruleMap} />
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
                                          <span className="text-slate-500">POS: {fmtPts(s.posPoints)}</span>
                                          <span className="text-slate-500">SB: {fmtPts(s.sbPoints)}</span>
                                          <span className="text-slate-500">KHQR: {fmtPts(s.khqrPoints)}</span>
                                          <span className="text-slate-500">CC: {fmtPts(s.ccPoints)}</span>
                                          <span className="text-slate-500">MV: {fmtPts(s.mvPoints)}</span>
                                          <span className="font-medium text-slate-900">{fmtPts(s.totalPoints)} pts</span>
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
                  <tr className="navy-header-bar bg-[#003857] text-white text-xs font-medium normal-case tracking-normal select-none">
                    <th className="sticky left-0 bg-[#003857] z-30 px-2 py-2.5 text-center w-[44px] min-w-[44px] font-medium text-xs text-white border-b border-white/20">
                      No.
                    </th>
                    <th
                      className="sticky left-[44px] bg-[#003857] z-30 px-3 py-2.5 text-left w-[170px] min-w-[170px] cursor-pointer select-none hover:bg-white/10 transition-colors border-b border-white/20"
                      onClick={() => {
                        setDailyStaffSortKey('staffName');
                        setDailyStaffSortDir((d) => (dailyStaffSortKey === 'staffName' ? (d === 'asc' ? 'desc' : 'asc') : 'desc'));
                      }}
                    >
                      <div className="flex items-center gap-1 font-medium text-xs text-white">
                        <span>Staff Name</span>
                        <SortIcon active={dailyStaffSortKey === 'staffName'} dir={dailyStaffSortDir} />
                      </div>
                    </th>
                    <th
                      className="sticky left-[214px] bg-[#003857] z-30 px-2.5 py-2.5 text-left w-[68px] min-w-[68px] cursor-pointer select-none hover:bg-white/10 transition-colors border-b border-white/20"
                      onClick={() => {
                        setDailyStaffSortKey('staffId');
                        setDailyStaffSortDir((d) => (dailyStaffSortKey === 'staffId' ? (d === 'asc' ? 'desc' : 'asc') : 'desc'));
                      }}
                    >
                      <div className="flex items-center gap-1 font-medium text-xs text-white">
                        <span>Staff ID</span>
                        <SortIcon active={dailyStaffSortKey === 'staffId'} dir={dailyStaffSortDir} />
                      </div>
                    </th>
                    <th
                      className="sticky left-[282px] bg-[#003857] z-30 px-2.5 py-2.5 text-left w-[105px] min-w-[105px] cursor-pointer select-none hover:bg-white/10 transition-colors border-r border-slate-700/90 border-b border-white/20 shadow-[2px_0_4px_rgba(0,0,0,0.18)]"
                      onClick={() => {
                        setDailyStaffSortKey('branchId');
                        setDailyStaffSortDir((d) => (dailyStaffSortKey === 'branchId' ? (d === 'asc' ? 'desc' : 'asc') : 'desc'));
                      }}
                    >
                      <div className="flex items-center gap-1 font-medium text-xs text-white">
                        <span>Branch Code</span>
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
                    <th className="px-3 py-2.5 text-center w-[130px] min-w-[130px] font-medium text-xs text-white border-b border-white/20">
                      Performance
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-200/90 text-slate-700">
                  {sortedDailyStaffRows.length === 0 ? (
                    <tr>
                      <td colSpan={matrixDays.length + 9} className="p-10 text-center text-sm text-slate-500">
                        No staff records match the current filters.
                      </td>
                    </tr>
                  ) : (
                    sortedDailyStaffRows.slice(dailyStaffPg.start, dailyStaffPg.end).map((row, idx) => {
                      const rank = dailyStaffPg.start + idx + 1;
                      return (
                        <tr key={row.staffId} className="group hover:bg-slate-50/80 transition-colors">
                          <td className="sticky left-0 bg-white group-hover:bg-slate-50 z-10 px-2 py-2 text-center tabular-nums text-slate-500 text-xs border-r border-slate-200/60 font-normal">
                            {rank}
                          </td>
                          <td
                            className="sticky left-[44px] bg-white group-hover:bg-slate-50 z-10 px-3 py-2 text-slate-900 border-r border-slate-200/60 font-normal truncate max-w-[170px]"
                            title={`${row.staffName}${row.position ? ` · ${row.position}` : ''}`}
                          >
                            <span className="flex items-center gap-1.5 min-w-0">
                              {row.isManagement && <ShieldCheck className="w-3.5 h-3.5 text-indigo-600 shrink-0" aria-hidden />}
                              <span className="truncate">{row.staffName}</span>
                            </span>
                            {row.position && (
                              <span className={`block text-[10px] truncate ${row.isManagement ? 'text-indigo-600 font-semibold' : 'text-slate-400'}`}>
                                {row.position}
                              </span>
                            )}
                          </td>
                          <td className="sticky left-[214px] bg-white group-hover:bg-slate-50 z-10 px-2.5 py-2 font-mono text-xs text-slate-700 tabular-nums border-r border-slate-200/60 font-normal">
                            {row.staffId}
                          </td>
                          <td
                            className="sticky left-[282px] bg-white group-hover:bg-slate-50 z-10 px-2.5 py-2 font-mono text-xs text-slate-700 shadow-[2px_0_4px_rgba(0,0,0,0.06)] border-r border-slate-200/60 font-normal truncate max-w-[105px]"
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
                        colSpan={4}
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
              <div className="min-w-[1380px] w-full">
                <div className="grid items-center gap-x-4 grid-cols-[40px_minmax(150px,1.2fr)_68px_minmax(130px,1.05fr)_72px_minmax(96px,0.95fr)_minmax(96px,0.95fr)_minmax(104px,1fr)_minmax(96px,0.95fr)_minmax(96px,0.95fr)_minmax(68px,0.65fr)_minmax(92px,0.9fr)_minmax(105px,1fr)_135px_24px] glass-table-thead navy-header-bar bg-[#003857] text-white text-xs font-semibold normal-case tracking-normal px-4 py-2.5">
                  <span className="text-right">No.</span>
                  <SortableHeader label="Staff Name" sortKey="staffName" activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} />
                  <SortableHeader label="Staff ID" sortKey="staffId" activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} />
                  <SortableHeader label="Branch Name" sortKey="branchName" activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} />
                  <SortableHeader label="Branch Code" sortKey="branchId" activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} />
                  <SortableHeader icon={<Cpu className="w-3.5 h-3.5 text-sky-400 shrink-0" aria-hidden />} label="POS Points" sortKey="posPoints" activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader icon={<Volume2 className="w-3.5 h-3.5 text-[#a2a5e0] shrink-0" aria-hidden />} label="SB Points" sortKey="sbPoints" activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader icon={<QrCode className="w-3.5 h-3.5 text-teal-300 shrink-0" aria-hidden />} label="KHQR Points" sortKey="khqrPoints" activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader icon={<CreditCard className="w-3.5 h-3.5 text-amber-300 shrink-0" aria-hidden />} label="CC Points" sortKey="ccPoints" activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader icon={<ClipboardList className="w-3.5 h-3.5 text-[#A4133C] shrink-0" aria-hidden />} label="MV Points" sortKey="mvPoints" activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader label="Total Tasks" sortKey="totalTasks" activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="center" />
                  <SortableHeader label="Total Points" sortKey="totalPoints" activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" />
                  <SortableHeader label={activeTargets.label} sortKey="targetPct" activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} />
                  <span>Performance</span>
                  <span />
                </div>

                <div className="divide-y divide-slate-200/90">
                  {filteredStaff.length === 0 ? (
                    <div className="p-10 text-center text-sm text-slate-500">No staff records match the current filters.</div>
                  ) : (
                    filteredStaff.slice(staffPg.start, staffPg.end).map((s, i) => {
                      const rank = staffPg.start + i + 1;
                      const isOpen = openStaff === s.staffId;
                      return (
                        <div key={s.staffId} className="hover:bg-slate-50/70">
                          <button
                            type="button"
                            onClick={() => setOpenStaff((o) => (o === s.staffId ? null : s.staffId))}
                            aria-expanded={isOpen}
                            className="grid items-center gap-x-4 grid-cols-[40px_minmax(150px,1.2fr)_68px_minmax(130px,1.05fr)_72px_minmax(96px,0.95fr)_minmax(96px,0.95fr)_minmax(104px,1fr)_minmax(96px,0.95fr)_minmax(96px,0.95fr)_minmax(68px,0.65fr)_minmax(92px,0.9fr)_minmax(105px,1fr)_135px_24px] w-full text-left px-4 py-2.5 text-[13px] text-slate-700 cursor-pointer"
                          >
                            <span className="text-right tabular-nums text-slate-500">{rank}</span>
                            <span className="flex items-center gap-2 min-w-0">
                              <span className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 border ${s.isManagement ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-slate-100 text-[#1e5b88] border-slate-200/80'}`}>
                                {s.isManagement ? <ShieldCheck className="w-3.5 h-3.5" aria-hidden /> : <Users className="w-3.5 h-3.5" aria-hidden />}
                              </span>
                              <span className="min-w-0">
                                <span className="text-slate-900 font-medium truncate block">{s.staffName}</span>
                                {s.position && (
                                  <span className={`text-[10px] truncate block ${s.isManagement ? 'text-indigo-600 font-semibold' : 'text-slate-400'}`}>
                                    {s.position}
                                  </span>
                                )}
                              </span>
                            </span>
                            <span className="font-mono text-xs text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200/80 tabular-nums inline-block text-center w-fit truncate max-w-full" title={s.staffId}>
                              {s.staffId || '—'}
                            </span>
                            <span className="block truncate text-slate-800">
                              {cleanBranchName(s.branchName)}
                            </span>
                            <span className="font-mono text-xs text-slate-700 tabular-nums truncate block" title={s.branchId === 'UNASSIGNED' ? 'Unassigned' : s.branchId}>
                              {fmtBranchCode(s.branchId)}
                            </span>
                            <span className="text-center tabular-nums"><TaskPtsCell tasks={s.posTasks} pts={s.posPoints} /></span>
                            <span className="text-center tabular-nums"><TaskPtsCell tasks={s.sbTasks} pts={s.sbPoints} /></span>
                            <span className="text-center tabular-nums"><TaskPtsCell tasks={s.khqrTasks} pts={s.khqrPoints} /></span>
                            <span className="text-center tabular-nums"><TaskPtsCell tasks={s.ccTasks} pts={s.ccPoints} /></span>
                            <span className="text-center tabular-nums"><TaskPtsCell tasks={s.mvTasks} pts={s.mvPoints} /></span>
                            <span className="text-center tabular-nums text-slate-800">{fmtInt(s.totalTasks)}</span>
                            <span className="text-right tabular-nums font-figure font-normal text-[#003857]">{fmtPts(s.totalPoints)} pts</span>
                            <span><TargetBar pct={s.targetPct} points={s.totalPoints} target={s.effectiveTarget} pacingPct={s.pacingPct} pacingTarget={s.pacingTarget} isManagement={s.isManagement} /></span>
                            <span><RatingBadge rating={s.rating} pacingPct={s.pacingPct} title={`Pacing: ${s.pacingPct}% (${fmtPts(s.totalPoints)} / ${fmtPts(s.pacingTarget)} pts pacing target for Day ${pacingInfo.elapsedWorkDays}/${pacingInfo.totalWorkDays})`} /></span>
                            <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
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
                                <SubCategoryMiniGrid raw={s} ruleMap={ruleMap} />
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
        </motion.div>
      </AnimatePresence>
    )}
  </section>
)}


    </div>
  );
};

/* ───────────── Custom High-Readability Institutional Chart Tooltips & Axis Ticks ───────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BranchYAxisTick: React.FC<any> = React.memo(({ y, payload }: any) => {
  const raw = String(payload?.value || '');
  const p = payload?.payload;
  const name = p?.branchName || (raw.match(/^(.*)\s+\(([^)]+)\)$/)?.[1] ?? raw);
  const code = p?.branchCode || (raw.match(/^(.*)\s+\(([^)]+)\)$/)?.[2] ?? '');
  const displayName = name.length > 22 ? `${name.slice(0, 21)}…` : name;

  return (
    <g transform={`translate(0,${y})`}>
      {/* Branch Name left-aligned */}
      <text
        x={0}
        y={0}
        dy={3.5}
        textAnchor="start"
        fontSize={11}
        fill="#0f172a"
        fontWeight={500}
      >
        {displayName}
      </text>

      {/* Branch Code right-aligned in dedicated column for clean vertical alignment */}
      {code && (
        <text
          x={176}
          y={0}
          dy={3.5}
          textAnchor="end"
          fontSize={10.5}
          fill="#64748b"
          fontWeight={400}
          fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
        >
          {`(${code})`}
        </text>
      )}
    </g>
  );
});
BranchYAxisTick.displayName = 'BranchYAxisTick';

const TaskPtsCell: React.FC<{ tasks?: number; pts: number }> = React.memo(({ pts }) => {
  if (pts <= 0) {
    return <span className="text-slate-400 font-light block text-center w-full select-none">—</span>;
  }
  return (
    <span className="font-figure tabular-nums font-normal text-slate-900 block text-center w-full">
      {fmtPts(pts)}
    </span>
  );
});
TaskPtsCell.displayName = 'TaskPtsCell';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTrendTooltip: React.FC<any> = React.memo(({ active, payload, label }: any) => {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-xl border border-slate-200/90 bg-white p-3 shadow-xl text-xs min-w-[238px] pointer-events-none">
      <div className="flex items-center justify-between gap-4 pb-1.5 mb-2 border-b border-slate-100">
        <span className="font-medium text-slate-900">{label}</span>
        <span className="font-figure font-semibold text-[#003857] tabular-nums">{fmtPts(row.totalPoints)} pts</span>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 text-slate-600"><span className="w-2 h-2 rounded-xs bg-[#006BA6]" />POS Terminal</span>
          <span className="text-slate-900 tabular-nums">{fmtPts(row.posPoints)} pts</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 text-slate-600"><span className="w-2 h-2 rounded-xs bg-[#4F518C]" />Sound Box</span>
          <span className="text-slate-900 tabular-nums">{fmtPts(row.sbPoints)} pts</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 text-slate-600"><span className="w-2 h-2 rounded-xs bg-teal-600" />KHQR</span>
          <span className="text-slate-900 tabular-nums">{fmtPts(row.khqrPoints)} pts</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 text-slate-600"><span className="w-2 h-2 rounded-xs bg-amber-500" />Credit Card</span>
          <span className="text-slate-900 tabular-nums">{fmtPts(row.ccPoints)} pts</span>
        </div>
        {(row.mvPoints ?? 0) > 0 && (
          <div className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-1.5 text-slate-600"><span className="w-2 h-2 rounded-xs bg-[#A4133C]" />Merchant Visit</span>
            <span className="text-slate-900 tabular-nums">{fmtPts(row.mvPoints)} pts</span>
          </div>
        )}
      </div>
      <div className="mt-2 pt-1.5 border-t border-slate-100 flex items-center justify-between gap-4 text-[11px] text-slate-500">
        <span>{row.activeStaff} active staff · {row.activeBranches} branches</span>
        <span className="text-slate-700 shrink-0">{fmtPts(row.ptsPerStaff)} pts/staff</span>
      </div>
    </div>
  );
});
CustomTrendTooltip.displayName = 'CustomTrendTooltip';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomBranchTooltip: React.FC<any> = React.memo(({ active, payload }: any) => {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-xl border border-slate-200/90 bg-white p-3 shadow-xl text-xs min-w-[238px] pointer-events-none">
      <div className="flex items-center justify-between gap-4 pb-1.5 mb-2 border-b border-slate-100">
        <span className="font-medium text-slate-900 truncate max-w-[155px]">{row.fullBranchName}</span>
        <span className="font-figure font-semibold text-[#003857] tabular-nums">{fmtPts(row.totalPoints)} pts</span>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 text-slate-600"><span className="w-2 h-2 rounded-xs bg-[#006BA6]" />POS Terminal</span>
          <span className="text-slate-900 tabular-nums">{fmtPts(row.posPoints)} pts</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 text-slate-600"><span className="w-2 h-2 rounded-xs bg-[#4F518C]" />Sound Box</span>
          <span className="text-slate-900 tabular-nums">{fmtPts(row.sbPoints)} pts</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 text-slate-600"><span className="w-2 h-2 rounded-xs bg-teal-600" />KHQR</span>
          <span className="text-slate-900 tabular-nums">{fmtPts(row.khqrPoints)} pts</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 text-slate-600"><span className="w-2 h-2 rounded-xs bg-amber-500" />Credit Card</span>
          <span className="text-slate-900 tabular-nums">{fmtPts(row.ccPoints)} pts</span>
        </div>
        {(row.mvPoints ?? 0) > 0 && (
          <div className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-1.5 text-slate-600"><span className="w-2 h-2 rounded-xs bg-[#A4133C]" />Merchant Visit</span>
            <span className="text-slate-900 tabular-nums">{fmtPts(row.mvPoints)} pts</span>
          </div>
        )}
      </div>
      <div className="mt-2 pt-1.5 border-t border-slate-100 flex items-center justify-between gap-4 text-[11px] text-slate-500">
        <span>{row.staffCount} active staff</span>
        <span className="shrink-0 font-medium text-slate-700">{fmtPts(row.totalPoints)} total pts</span>
      </div>
    </div>
  );
});
CustomBranchTooltip.displayName = 'CustomBranchTooltip';

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
      {pPos > 0 && <div className="bg-sky-400 h-full" style={{ width: `${pPos}%` }} />}
      {pSb > 0 && <div className="bg-[#4F518C] h-full" style={{ width: `${pSb}%` }} />}
      {pKhqr > 0 && <div className="bg-teal-600 h-full" style={{ width: `${pKhqr}%` }} />}
      {pCc > 0 && <div className="bg-amber-500 h-full" style={{ width: `${pCc}%` }} />}
      {pMv > 0 && <div className="bg-[#A4133C] h-full" style={{ width: `${pMv}%` }} />}
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
      className={`inline-flex items-center gap-1.5 cursor-pointer select-none transition-colors group ${
        align === 'right' ? 'justify-end text-right w-full' : align === 'center' ? 'justify-center text-center w-full' : 'justify-start text-left'
      } ${active ? 'text-white font-medium' : 'text-slate-200 hover:text-white font-normal'} ${className}`}
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
        <ArrowUpDown className="w-2.5 h-2.5 opacity-0 group-hover:opacity-60 transition-opacity shrink-0" aria-hidden />
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
      <div className="flex items-center gap-1.5" title={mgtTooltip}>
        <span className="text-[11px] font-medium text-indigo-700 bg-indigo-50/90 px-1.5 py-0.2 rounded border border-indigo-200/80 whitespace-nowrap inline-flex items-center gap-1">
          <ShieldCheck className="w-2.5 h-2.5 text-indigo-600 shrink-0" aria-hidden />
          <span>Exempt</span>
        </span>
        {pct > 0 && <span className="text-[10px] text-slate-500 font-figure tabular-nums">({pct}%)</span>}
      </div>
    );
  }
  const tooltip =
    title ||
    (points !== undefined && target !== undefined
      ? `${pct}% of target (${fmtPts(points)} / ${fmtPts(target)} pts)${pacingPct !== undefined && pacingTarget !== undefined ? ` · Pacing: ${pacingPct}% (${fmtPts(points)} / ${fmtPts(pacingTarget)} pts)` : ''}`
      : `${pct}% of target`);
  return (
    <div className="flex items-center gap-1.5" title={tooltip}>
      <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full bg-[#1e5b88]" style={{ width: `${Math.min(100, Math.max(4, pct))}%` }} />
      </div>
      <span className="text-[11px] font-figure font-normal tabular-nums text-slate-700 w-9 text-right">{pct}%</span>
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

const SubCategoryMiniGrid: React.FC<{ raw: KpiRawCounts; ruleMap: Map<string, KpiPointRule> }> = ({ raw, ruleMap }) => {
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
            {fmtPts(c.pts)} <span className="text-[10.5px] font-normal text-slate-500">pts</span>
          </div>
        </div>
      ))}
    </div>
  );
};

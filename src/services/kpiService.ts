import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { todayPP } from '../utils/time';

export type KpiCategory = 'POS Terminal' | 'Sound Box' | 'KHQR' | 'Credit Card' | 'Other';

export type KpiPeriod =
  | 'ALL'
  | 'TODAY'
  | 'WEEK'
  | '7D'
  | 'MONTH'
  | 'LAST'
  | 'BOTH'
  | 'QUARTER'
  | 'LAST_QUARTER';

export const KPI_PERIOD_LABEL: Record<KpiPeriod, string> = {
  ALL: 'All time',
  TODAY: 'Today (Daily)',
  WEEK: 'This week (Weekly)',
  '7D': 'Last 7 days',
  MONTH: 'This month (Monthly)',
  LAST: 'Last month',
  BOTH: 'Last 2 months',
  QUARTER: 'This quarter (Quarterly)',
  LAST_QUARTER: 'Last quarter',
};

export function kpiPeriodRange(p: KpiPeriod): { from: string | null; to: string | null; targetKind: 'daily' | 'weekly' | 'monthly' | 'quarterly' } {
  if (p === 'ALL') return { from: null, to: null, targetKind: 'monthly' };
  const today = todayPP();
  const startOf = (ymd: string) => new Date(`${ymd}T00:00:00+07:00`);
  if (p === 'TODAY') return { from: startOf(today).toISOString(), to: null, targetKind: 'daily' };
  if (p === '7D') return { from: new Date(startOf(today).getTime() - 6 * 86400000).toISOString(), to: null, targetKind: 'weekly' };
  if (p === 'WEEK') {
    const d = startOf(today);
    const dow = (d.getUTCDay() + 6) % 7; // Monday = 0 in Phnom Penh (since 00:00+07:00 is 17:00 prev day UTC, use local date math)
    const [yy, mm, dd] = today.split('-').map(Number);
    const localDate = new Date(Date.UTC(yy, mm - 1, dd));
    const mondayOffset = (localDate.getUTCDay() + 6) % 7;
    void dow;
    return { from: new Date(d.getTime() - mondayOffset * 86400000).toISOString(), to: null, targetKind: 'weekly' };
  }
  const [y, m] = today.split('-').map(Number);
  const firstMonth = (back: number) => {
    let yy = y, mm = m - back;
    while (mm < 1) { mm += 12; yy -= 1; }
    return startOf(`${yy}-${String(mm).padStart(2, '0')}-01`).toISOString();
  };
  if (p === 'MONTH') return { from: firstMonth(0), to: null, targetKind: 'monthly' };
  if (p === 'LAST') return { from: firstMonth(1), to: firstMonth(0), targetKind: 'monthly' };
  if (p === 'BOTH') return { from: firstMonth(1), to: null, targetKind: 'monthly' };

  // Quarter calculations (Q1: Jan-Mar, Q2: Apr-Jun, Q3: Jul-Sep, Q4: Oct-Dec)
  const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
  const curQStart = startOf(`${y}-${String(qStartMonth).padStart(2, '0')}-01`).toISOString();
  if (p === 'QUARTER') return { from: curQStart, to: null, targetKind: 'quarterly' };
  let prevQY = y, prevQM = qStartMonth - 3;
  if (prevQM < 1) { prevQM += 12; prevQY -= 1; }
  const prevQStart = startOf(`${prevQY}-${String(prevQM).padStart(2, '0')}-01`).toISOString();
  return { from: prevQStart, to: curQStart, targetKind: 'quarterly' };
}

export interface KpiPointRule {
  code: string;
  category: KpiCategory;
  subCategory: string;
  description: string;
  points: number;
  unit: string;
  active: boolean;
  isSystem: boolean;
  sortOrder: number;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface KpiTargets {
  branchDailyTarget: number;
  branchWeeklyTarget: number;
  branchMonthlyTarget: number;
  branchQuarterlyTarget: number;
  staffDailyTarget: number;
  staffWeeklyTarget: number;
  staffMonthlyTarget: number;
  staffQuarterlyTarget: number;
  workDaysInMonth: number;
  excludeHolidays: boolean;
  holidayDaysCount: number;
  workingDaysMode: 'mon_fri' | 'mon_sat' | 'custom';
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface KpiRawCounts {
  posInstall: number;
  posReplace: number;
  posBattery: number;
  sbInstall: number;
  sbReplace: number;
  sbMaint: number;
  sbReturn: number;
  khqrInstall: number;
  khqrReplace: number;
  khqrMaterials: number;
  ccPrimary: number;
  ccSupp: number;
}

export interface KpiStaffRaw extends KpiRawCounts {
  staffId: string;
  staffName: string;
  branchId: string;
  branchName: string;
  posSubmitted: number;
  posRejected: number;
  sbSubmitted: number;
  sbRejected: number;
  khqrFailed: number;
  ccSubmitted: number;
  ccRejected: number;
}

export interface KpiTimeBucketRaw extends KpiRawCounts {
  period: string;
  activeBranches: number;
  activeStaff: number;
}

export interface KpiMonthlyStaffRaw extends KpiRawCounts {
  month: string;
  staffId: string;
  staffName: string;
  branchId: string;
  branchName: string;
}

export interface KpiDailyBranchRaw {
  day: string; // YYYY-MM-DD
  branchId: string;
  activeStaff: number;
  totalTasks: number;
  posTasks: number;
  sbTasks: number;
  khqrTasks: number;
  ccTasks: number;
}

export interface KpiDailyStaffRaw {
  day: string; // YYYY-MM-DD
  staffId: string;
  staffName: string;
  branchId: string;
  branchName: string;
  totalTasks: number;
  posTasks: number;
  sbTasks: number;
  khqrTasks: number;
  ccTasks: number;
}

export interface KpiDashboardData {
  rules: KpiPointRule[];
  targets: KpiTargets;
  staff: KpiStaffRaw[];
  daily: KpiTimeBucketRaw[];
  weekly: KpiTimeBucketRaw[];
  monthly: KpiTimeBucketRaw[];
  quarterly: KpiTimeBucketRaw[];
  monthlyStaff: KpiMonthlyStaffRaw[];
  dailyBranch?: KpiDailyBranchRaw[];
  dailyStaff?: KpiDailyStaffRaw[];
}

export interface ComputedPoints {
  posTasks: number;
  posPoints: number;
  sbTasks: number;
  sbPoints: number;
  khqrTasks: number;
  khqrMaterials: number;
  khqrPoints: number;
  ccTasks: number;
  ccPoints: number;
  totalTasks: number;
  totalPoints: number;
}

export function rulePts(map: Map<string, KpiPointRule>, code: string): number {
  const r = map.get(code);
  return r && r.active ? r.points : 0;
}

export function computeKpiPoints(c: KpiRawCounts, ruleMap: Map<string, KpiPointRule>): ComputedPoints {
  const posTasks = c.posInstall + c.posReplace + c.posBattery;
  const posPoints =
    c.posInstall * rulePts(ruleMap, 'POS_INSTALL') +
    c.posReplace * rulePts(ruleMap, 'POS_REPLACE') +
    c.posBattery * rulePts(ruleMap, 'POS_BATTERY');

  const sbTasks = c.sbInstall + c.sbReplace + c.sbMaint + c.sbReturn;
  const sbPoints =
    c.sbInstall * rulePts(ruleMap, 'SB_INSTALL') +
    c.sbReplace * rulePts(ruleMap, 'SB_REPLACE') +
    c.sbMaint * rulePts(ruleMap, 'SB_MAINT') +
    c.sbReturn * rulePts(ruleMap, 'SB_RETURN');

  const khqrTasks = c.khqrInstall + c.khqrReplace;
  const khqrPoints =
    c.khqrInstall * rulePts(ruleMap, 'KHQR_INSTALL') +
    c.khqrReplace * rulePts(ruleMap, 'KHQR_REPLACE') +
    c.khqrMaterials * rulePts(ruleMap, 'KHQR_MATERIAL');

  const ccTasks = c.ccPrimary + c.ccSupp;
  const ccPoints =
    c.ccPrimary * rulePts(ruleMap, 'CC_PRIMARY') +
    c.ccSupp * rulePts(ruleMap, 'CC_SUPP');

  const totalTasks = posTasks + sbTasks + khqrTasks + ccTasks;
  const totalPoints = Math.round((posPoints + sbPoints + khqrPoints + ccPoints) * 100) / 100;

  return {
    posTasks,
    posPoints: Math.round(posPoints * 100) / 100,
    sbTasks,
    sbPoints: Math.round(sbPoints * 100) / 100,
    khqrTasks,
    khqrMaterials: c.khqrMaterials,
    khqrPoints: Math.round(khqrPoints * 100) / 100,
    ccTasks,
    ccPoints: Math.round(ccPoints * 100) / 100,
    totalTasks,
    totalPoints,
  };
}

// ───────────── In-memory cache (0ms tab opening & instant period switching) ─────────────
const summaryCache = new Map<string, KpiDashboardData>();
let owner: string | null | undefined;

export function clearKpiCache(): void {
  summaryCache.clear();
}

if (isSupabaseConfigured) {
  try {
    supabase.auth.onAuthStateChange((_e, s) => {
      const id = s?.user?.id ?? null;
      if (owner !== undefined && id !== owner) clearKpiCache();
      owner = id;
    });
  } catch { /* ignore */ }
}

export const kpiCacheKey = (from: string | null, to: string | null) => `${from || ''}|${to || ''}`;
export const getCachedKpiSummary = (from: string | null, to: string | null) => summaryCache.get(kpiCacheKey(from, to));
export const setCachedKpiSummary = (from: string | null, to: string | null, d: KpiDashboardData) => {
  summaryCache.set(kpiCacheKey(from, to), d);
};

export function patchCachedKpiRule(rule: KpiPointRule): void {
  summaryCache.forEach((v, k) => {
    const exists = v.rules.some((r) => r.code === rule.code);
    const rules = exists
      ? v.rules.map((r) => (r.code === rule.code ? rule : r))
      : [...v.rules, rule].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
    summaryCache.set(k, { ...v, rules });
  });
}

export function patchCachedKpiTargets(targets: KpiTargets): void {
  summaryCache.forEach((v, k) => {
    summaryCache.set(k, { ...v, targets });
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRule(r: any): KpiPointRule {
  return {
    code: String(r.code || ''),
    category: (r.category || 'Other') as KpiCategory,
    subCategory: String(r.sub_category || ''),
    description: String(r.description || ''),
    points: Number(r.points) || 0,
    unit: String(r.unit || 'per task'),
    active: r.active !== false,
    isSystem: !!r.is_system,
    sortOrder: Number(r.sort_order) || 100,
    updatedBy: r.updated_by || null,
    updatedAt: r.updated_at || null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapTargets(t: any): KpiTargets {
  return {
    branchDailyTarget: Number(t?.branch_daily_target) || 25,
    branchWeeklyTarget: Number(t?.branch_weekly_target) || 125,
    branchMonthlyTarget: Number(t?.branch_monthly_target) || 550,
    branchQuarterlyTarget: Number(t?.branch_quarterly_target) || 1650,
    staffDailyTarget: Number(t?.staff_daily_target) || 5,
    staffWeeklyTarget: Number(t?.staff_weekly_target) || 25,
    staffMonthlyTarget: Number(t?.staff_monthly_target) || 110,
    staffQuarterlyTarget: Number(t?.staff_quarterly_target) || 330,
    workDaysInMonth: Number(t?.work_days_in_month) || 22,
    excludeHolidays: t?.exclude_holidays !== undefined ? Boolean(t.exclude_holidays) : true,
    holidayDaysCount: Number(t?.holiday_days_count) || 0,
    workingDaysMode: (t?.working_days_mode as any) || 'mon_fri',
    updatedBy: t?.updated_by || null,
    updatedAt: t?.updated_at || null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRawCounts(r: any): KpiRawCounts {
  return {
    posInstall: Number(r.pos_install) || 0,
    posReplace: Number(r.pos_replace) || 0,
    posBattery: Number(r.pos_battery) || 0,
    sbInstall: Number(r.sb_install) || 0,
    sbReplace: Number(r.sb_replace) || 0,
    sbMaint: Number(r.sb_maint) || 0,
    sbReturn: Number(r.sb_return) || 0,
    khqrInstall: Number(r.khqr_install) || 0,
    khqrReplace: Number(r.khqr_replace) || 0,
    khqrMaterials: Number(r.khqr_materials) || 0,
    ccPrimary: Number(r.cc_primary) || 0,
    ccSupp: Number(r.cc_supp) || 0,
  };
}

export async function fetchKpiSummary(from: string | null, to: string | null): Promise<KpiDashboardData> {
  if (!isSupabaseConfigured) {
    return {
      rules: [],
      targets: mapTargets(null),
      staff: [],
      daily: [],
      weekly: [],
      monthly: [],
      quarterly: [],
      monthlyStaff: [],
      dailyBranch: [],
    };
  }
  const { data, error } = await supabase.rpc('kpi_dashboard_summary', { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d: any = data || {};
  const out: KpiDashboardData = {
    rules: Array.isArray(d.rules) ? d.rules.map(mapRule) : [],
    targets: mapTargets(d.targets),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    staff: Array.isArray(d.staff) ? d.staff.map((r: any) => ({
      ...mapRawCounts(r),
      staffId: String(r.staff_id || ''),
      staffName: String(r.staff_name || r.staff_id || ''),
      branchId: String(r.branch_id || 'UNASSIGNED'),
      branchName: String(r.branch_name || 'Unassigned'),
      posSubmitted: Number(r.pos_submitted) || 0,
      posRejected: Number(r.pos_rejected) || 0,
      sbSubmitted: Number(r.sb_submitted) || 0,
      sbRejected: Number(r.sb_rejected) || 0,
      khqrFailed: Number(r.khqr_failed) || 0,
      ccSubmitted: Number(r.cc_submitted) || 0,
      ccRejected: Number(r.cc_rejected) || 0,
    })) : [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    daily: Array.isArray(d.daily) ? d.daily.map((r: any) => ({
      ...mapRawCounts(r),
      period: String(r.period || ''),
      activeBranches: Number(r.active_branches) || 0,
      activeStaff: Number(r.active_staff) || 0,
    })) : [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    weekly: Array.isArray(d.weekly) ? d.weekly.map((r: any) => ({
      ...mapRawCounts(r),
      period: String(r.period || ''),
      activeBranches: Number(r.active_branches) || 0,
      activeStaff: Number(r.active_staff) || 0,
    })) : [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    monthly: Array.isArray(d.monthly) ? d.monthly.map((r: any) => ({
      ...mapRawCounts(r),
      period: String(r.period || ''),
      activeBranches: Number(r.active_branches) || 0,
      activeStaff: Number(r.active_staff) || 0,
    })) : [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    quarterly: Array.isArray(d.quarterly) ? d.quarterly.map((r: any) => ({
      ...mapRawCounts(r),
      period: String(r.period || ''),
      activeBranches: Number(r.active_branches) || 0,
      activeStaff: Number(r.active_staff) || 0,
    })) : [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    monthlyStaff: Array.isArray(d.monthly_staff) ? d.monthly_staff.map((r: any) => ({
      ...mapRawCounts(r),
      month: String(r.month || ''),
      staffId: String(r.staff_id || ''),
      staffName: String(r.staff_name || r.staff_id || ''),
      branchId: String(r.branch_id || 'UNASSIGNED'),
      branchName: String(r.branch_name || 'Unassigned'),
    })) : [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dailyBranch: Array.isArray(d.daily_branch) ? d.daily_branch.map((r: any) => ({
      day: String(r.day || ''),
      branchId: String(r.branch_id || 'UNASSIGNED'),
      activeStaff: Number(r.active_staff) || 0,
      totalTasks: Number(r.total_tasks) || 0,
      posTasks: Number(r.pos_tasks) || 0,
      sbTasks: Number(r.sb_tasks) || 0,
      khqrTasks: Number(r.khqr_tasks) || 0,
      ccTasks: Number(r.cc_tasks) || 0,
    })) : [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dailyStaff: Array.isArray(d.daily_staff) ? d.daily_staff.map((r: any) => ({
      day: String(r.day || ''),
      staffId: String(r.staff_id || ''),
      staffName: String(r.staff_name || r.staff_id || ''),
      branchId: String(r.branch_id || 'UNASSIGNED'),
      branchName: String(r.branch_name || 'Unassigned'),
      totalTasks: Number(r.total_tasks) || 0,
      posTasks: Number(r.pos_tasks) || 0,
      sbTasks: Number(r.sb_tasks) || 0,
      khqrTasks: Number(r.khqr_tasks) || 0,
      ccTasks: Number(r.cc_tasks) || 0,
    })) : [],
  };
  setCachedKpiSummary(from, to, out);
  return out;
}

export async function saveKpiRuleOnServer(rule: {
  code: string;
  category: KpiCategory;
  subCategory: string;
  description: string;
  points: number;
  unit: string;
  active: boolean;
  sortOrder?: number;
}): Promise<KpiPointRule> {
  const { data, error } = await supabase.rpc('kpi_save_rule', {
    p: {
      code: rule.code,
      category: rule.category,
      sub_category: rule.subCategory,
      description: rule.description,
      points: rule.points,
      unit: rule.unit,
      active: rule.active,
      sort_order: rule.sortOrder ?? 100,
    },
  });
  if (error) throw new Error(error.message);
  const mapped = mapRule(data);
  patchCachedKpiRule(mapped);
  return mapped;
}

export async function saveKpiTargetsOnServer(targets: {
  branchDailyTarget: number;
  branchWeeklyTarget: number;
  branchMonthlyTarget: number;
  branchQuarterlyTarget: number;
  staffDailyTarget: number;
  staffWeeklyTarget: number;
  staffMonthlyTarget: number;
  staffQuarterlyTarget: number;
  workDaysInMonth?: number;
  excludeHolidays?: boolean;
  holidayDaysCount?: number;
  workingDaysMode?: 'mon_fri' | 'mon_sat' | 'custom';
}): Promise<KpiTargets> {
  const { data, error } = await supabase.rpc('kpi_save_targets', {
    p: {
      branch_daily_target: targets.branchDailyTarget,
      branch_weekly_target: targets.branchWeeklyTarget,
      branch_monthly_target: targets.branchMonthlyTarget,
      branch_quarterly_target: targets.branchQuarterlyTarget,
      staff_daily_target: targets.staffDailyTarget,
      staff_weekly_target: targets.staffWeeklyTarget,
      staff_monthly_target: targets.staffMonthlyTarget,
      staff_quarterly_target: targets.staffQuarterlyTarget,
      work_days_in_month: targets.workDaysInMonth ?? 24,
      exclude_holidays: targets.excludeHolidays ?? true,
      holiday_days_count: targets.holidayDaysCount ?? 0,
      working_days_mode: targets.workingDaysMode ?? 'mon_sat',
    },
  });
  if (error) throw new Error(error.message);
  const mapped = mapTargets(data);
  patchCachedKpiTargets(mapped);
  return mapped;
}

let inflight: Promise<KpiDashboardData | null> | null = null;
let lastPrefetch = 0;

export function prefetchKpi(force = false): Promise<KpiDashboardData | null> {
  if (!isSupabaseConfigured) return Promise.resolve(null);
  if (inflight) return inflight;
  if (!force && Date.now() - lastPrefetch < 25000 && getCachedKpiSummary(null, null)) {
    return Promise.resolve(getCachedKpiSummary(null, null) || null);
  }
  inflight = fetchKpiSummary(null, null)
    .then((d) => {
      lastPrefetch = Date.now();
      return d;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

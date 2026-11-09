import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { todayPP } from '../utils/time';

export type KpiCategory = 'POS Terminal' | 'Sound Box' | 'KHQR' | 'Credit Card' | 'Merchant Visit' | 'Other';

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
  posMaint?: number;
  posInactive?: number;
  posReturn?: number;
  posAdaptor?: number;
  posStand?: number;
  posDock?: number;
  sbInstall: number;
  sbReplace: number;
  sbMaint: number;
  sbReturn: number;
  sbAdaptor?: number;
  khqrInstall: number;
  khqrReplace: number;
  khqrMaterials: number;
  ccPrimary: number;
  ccSupp: number;
  /** (4 Nov 2026) tasks of the rules added for the Merchant Visit app (POS_MAINT, POS_INACTIVE, POS_RETURN, MV_<activity>):
   *  { rule code: count }. The server counts only active rules. */
  extra?: Record<string, number>;
}

/** Adds the "extra" counts of `src` into `target` (branch and grand totals). */
export function addExtraCounts(target: KpiRawCounts, src: KpiRawCounts): void {
  if (!src.extra) return;
  const t = target.extra || (target.extra = {});
  for (const [k, n] of Object.entries(src.extra)) t[k] = (t[k] || 0) + (Number(n) || 0);
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
  mvTasks?: number;
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
  mvTasks?: number;
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
  mvTasks: number;
  mvPoints: number;
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

  // (4 Nov 2026) the rules added for the Merchant Visit app & new tasks: counted per rule code, points from Settings
  let xPosTasks = 0, xPosPoints = 0, xSbTasks = 0, xSbPoints = 0, xCcTasks = 0, xCcPoints = 0, xKhqrTasks = 0, xKhqrPoints = 0, mvTasks = 0, mvPoints = 0, xOtherTasks = 0, xOtherPoints = 0;
  
  // Count direct task properties if provided and not already in c.extra
  if (c.posMaint && !c.extra?.['POS_MAINT']) {
    xPosTasks += c.posMaint;
    xPosPoints += c.posMaint * rulePts(ruleMap, 'POS_MAINT');
  }
  if (c.posInactive && !c.extra?.['POS_INACTIVE']) {
    xPosTasks += c.posInactive;
    xPosPoints += c.posInactive * rulePts(ruleMap, 'POS_INACTIVE');
  }
  if (c.posReturn && !c.extra?.['POS_RETURN']) {
    xPosTasks += c.posReturn;
    xPosPoints += c.posReturn * rulePts(ruleMap, 'POS_RETURN');
  }
  if (c.posAdaptor && !c.extra?.['POS_ADAPTOR']) {
    xPosTasks += c.posAdaptor;
    xPosPoints += c.posAdaptor * rulePts(ruleMap, 'POS_ADAPTOR');
  }
  if (c.posStand && !c.extra?.['POS_STAND']) {
    xPosTasks += c.posStand;
    xPosPoints += c.posStand * rulePts(ruleMap, 'POS_STAND');
  }
  if (c.posDock && !c.extra?.['POS_DOCK']) {
    xPosTasks += c.posDock;
    xPosPoints += c.posDock * rulePts(ruleMap, 'POS_DOCK');
  }
  if (c.sbAdaptor && !c.extra?.['SB_ADAPTOR']) {
    xSbTasks += c.sbAdaptor;
    xSbPoints += c.sbAdaptor * rulePts(ruleMap, 'SB_ADAPTOR');
  }

  for (const [code, raw] of Object.entries(c.extra || {})) {
    const n = Number(raw) || 0, rule = ruleMap.get(code);
    if (!n) continue;
    if (rule && rule.active) {
      const pts = n * rule.points;
      if (rule.category === 'POS Terminal') { xPosTasks += n; xPosPoints += pts; }
      else if (rule.category === 'Sound Box') { xSbTasks += n; xSbPoints += pts; }
      else if (rule.category === 'Credit Card') { xCcTasks += n; xCcPoints += pts; }
      else if (rule.category === 'KHQR') { xKhqrTasks += n; xKhqrPoints += pts; }
      else if (rule.category === 'Merchant Visit') { mvTasks += n; mvPoints += pts; }
      else { xOtherTasks += n; xOtherPoints += pts; }
    } else if (code.startsWith('MV_')) {
      mvTasks += n;
      if (rule && rule.points > 0) mvPoints += n * rule.points;
    } else if (code.startsWith('POS_')) {
      xPosTasks += n;
      if (rule && rule.points > 0) xPosPoints += n * rule.points;
    } else if (code.startsWith('SB_')) {
      xSbTasks += n;
      if (rule && rule.points > 0) xSbPoints += n * rule.points;
    } else if (code.startsWith('CC_')) {
      xCcTasks += n;
      if (rule && rule.points > 0) xCcPoints += n * rule.points;
    } else if (code.startsWith('KHQR_')) {
      xKhqrTasks += n;
      if (rule && rule.points > 0) xKhqrPoints += n * rule.points;
    }
  }

  const totalTasks = posTasks + xPosTasks + sbTasks + xSbTasks + khqrTasks + xKhqrTasks + ccTasks + xCcTasks + mvTasks + xOtherTasks;
  const totalPoints = Math.round((posPoints + xPosPoints + sbPoints + xSbPoints + khqrPoints + xKhqrPoints + ccPoints + xCcPoints + mvPoints + xOtherPoints) * 100) / 100;

  return {
    posTasks: posTasks + xPosTasks,
    posPoints: Math.round((posPoints + xPosPoints) * 100) / 100,
    sbTasks: sbTasks + xSbTasks,
    sbPoints: Math.round((sbPoints + xSbPoints) * 100) / 100,
    khqrTasks: khqrTasks + xKhqrTasks,
    khqrMaterials: c.khqrMaterials,
    khqrPoints: Math.round((khqrPoints + xKhqrPoints) * 100) / 100,
    ccTasks: ccTasks + xCcTasks,
    ccPoints: Math.round((ccPoints + xCcPoints) * 100) / 100,
    mvTasks,
    mvPoints: Math.round(mvPoints * 100) / 100,
    totalTasks,
    totalPoints,
  };
}

// ───────────── In-memory & Session cache (0ms instant tab opening & instant switching) ─────────────
const summaryCache = new Map<string, KpiDashboardData>();
const SESSION_CACHE_PREFIX = 'kpi_summary_cache_v2_';
let owner: string | null | undefined;

export interface KpiSettingsData {
  rules: KpiPointRule[];
  targets: KpiTargets;
}

export const DEFAULT_KPI_RULES: KpiPointRule[] = [
  { code: 'POS_INSTALL', category: 'POS Terminal', subCategory: 'POS New Installation', description: 'Approved new POS Terminal installation at merchant', points: 5, unit: 'per terminal', active: true, isSystem: true, sortOrder: 10, updatedBy: null, updatedAt: null },
  { code: 'POS_REPLACE', category: 'POS Terminal', subCategory: 'POS Replacement / Swap', description: 'Approved POS Terminal replacement or hardware swap', points: 5, unit: 'per swap', active: true, isSystem: true, sortOrder: 20, updatedBy: null, updatedAt: null },
  { code: 'POS_BATTERY', category: 'POS Terminal', subCategory: 'POS Battery Replacement', description: 'Approved POS Terminal battery replacement in the field', points: 3, unit: 'per battery', active: true, isSystem: true, sortOrder: 30, updatedBy: null, updatedAt: null },
  { code: 'POS_MAINT', category: 'POS Terminal', subCategory: 'POS Operational Support', description: 'Merchant Visit app: POS Operational Support (inspection, paperroll, materials...)', points: 2, unit: 'per visit', active: true, isSystem: true, sortOrder: 32, updatedBy: null, updatedAt: null },
  { code: 'POS_OP_INSPECT', category: 'POS Terminal', subCategory: 'POS Terminal Inspection', description: 'POS Operational Support: POS Terminal Inspection at merchant', points: 2, unit: 'per visit', active: true, isSystem: true, sortOrder: 33, updatedBy: null, updatedAt: null },
  { code: 'POS_OP_TRAIN', category: 'POS Terminal', subCategory: 'Refreshment Training', description: 'POS Operational Support: Merchant staff refreshment training', points: 2, unit: 'per visit', active: true, isSystem: true, sortOrder: 34, updatedBy: null, updatedAt: null },
  { code: 'POS_OP_PAPER', category: 'POS Terminal', subCategory: 'Request Paper Roll', description: 'POS Operational Support: Request paper roll delivery to merchant', points: 1, unit: 'per visit', active: true, isSystem: true, sortOrder: 35, updatedBy: null, updatedAt: null },
  { code: 'POS_OP_ADD_MAT', category: 'POS Terminal', subCategory: 'Request Add Material', description: 'POS Operational Support: Request additional POS materials/collateral', points: 1, unit: 'per visit', active: true, isSystem: true, sortOrder: 36, updatedBy: null, updatedAt: null },
  { code: 'POS_OP_RET_MAT', category: 'POS Terminal', subCategory: 'Request Return Materials', description: 'POS Operational Support: Request return of POS materials', points: 1, unit: 'per visit', active: true, isSystem: true, sortOrder: 37, updatedBy: null, updatedAt: null },
  { code: 'POS_OP_OTHERS', category: 'POS Terminal', subCategory: 'Others (POS Support)', description: 'POS Operational Support: Other field operational requests', points: 1, unit: 'per visit', active: true, isSystem: true, sortOrder: 38, updatedBy: null, updatedAt: null },
  { code: 'POS_INACTIVE', category: 'POS Terminal', subCategory: 'POS In-Active Maintenance', description: 'Merchant Visit app: POS In-Active Maintenance at dormant merchant', points: 2, unit: 'per visit', active: true, isSystem: true, sortOrder: 39, updatedBy: null, updatedAt: null },
  { code: 'POS_RETURN', category: 'POS Terminal', subCategory: 'POS Return & Terminate', description: 'Merchant Visit app: POS Return & Terminate (terminal de-installed & taken back)', points: 3, unit: 'per terminal', active: true, isSystem: true, sortOrder: 40, updatedBy: null, updatedAt: null },
  { code: 'POS_ADAPTOR', category: 'POS Terminal', subCategory: 'POS AC Adaptor Delivery', description: 'Delivery or replacement of POS AC Adaptor in the field', points: 1, unit: 'per adaptor', active: true, isSystem: true, sortOrder: 41, updatedBy: null, updatedAt: null },
  { code: 'POS_STAND', category: 'POS Terminal', subCategory: 'POS Stand Holder Setup', description: 'Setup or replacement of POS Stand Holder at merchant counter', points: 1, unit: 'per stand', active: true, isSystem: true, sortOrder: 42, updatedBy: null, updatedAt: null },
  { code: 'POS_DOCK', category: 'POS Terminal', subCategory: 'Charging Dock Installation', description: 'Installation or replacement of POS Charging Dock', points: 1, unit: 'per dock', active: true, isSystem: true, sortOrder: 43, updatedBy: null, updatedAt: null },
  { code: 'SB_INSTALL', category: 'Sound Box', subCategory: 'Sound Box New Installation', description: 'Approved new Sound Box installation at merchant', points: 5, unit: 'per unit', active: true, isSystem: true, sortOrder: 50, updatedBy: null, updatedAt: null },
  { code: 'SB_REPLACE', category: 'Sound Box', subCategory: 'Sound Box Replacement / Swap', description: 'Approved Sound Box replacement or swap', points: 4, unit: 'per swap', active: true, isSystem: true, sortOrder: 52, updatedBy: null, updatedAt: null },
  { code: 'SB_MAINT', category: 'Sound Box', subCategory: 'Sound Box Operational Support', description: 'Sound Box operational support, sound check & QR stand inspection', points: 2, unit: 'per visit', active: true, isSystem: true, sortOrder: 60, updatedBy: null, updatedAt: null },
  { code: 'SB_OP_INSPECT', category: 'Sound Box', subCategory: 'SB Inspection', description: 'Sound Box Operational Support: SB Inspection at merchant counter', points: 2, unit: 'per visit', active: true, isSystem: true, sortOrder: 61, updatedBy: null, updatedAt: null },
  { code: 'SB_OP_TRAIN', category: 'Sound Box', subCategory: 'SB Refresh Training', description: 'Sound Box Operational Support: SB Refresh Training for merchant staff', points: 2, unit: 'per visit', active: true, isSystem: true, sortOrder: 62, updatedBy: null, updatedAt: null },
  { code: 'SB_OP_BATTERY', category: 'Sound Box', subCategory: 'Battery Replacement', description: 'Sound Box Operational Support: Battery replacement in the field', points: 2, unit: 'per battery', active: true, isSystem: true, sortOrder: 63, updatedBy: null, updatedAt: null },
  { code: 'SB_OP_ADD_MAT', category: 'Sound Box', subCategory: 'Add Material', description: 'Sound Box Operational Support: Add Sound Box material / QR collateral', points: 1, unit: 'per visit', active: true, isSystem: true, sortOrder: 64, updatedBy: null, updatedAt: null },
  { code: 'SB_OP_RET_MAT', category: 'Sound Box', subCategory: 'Returns Material', description: 'Sound Box Operational Support: Returns of Sound Box material', points: 1, unit: 'per visit', active: true, isSystem: true, sortOrder: 65, updatedBy: null, updatedAt: null },
  { code: 'SB_OP_OTHERS', category: 'Sound Box', subCategory: 'Others (SB Support)', description: 'Sound Box Operational Support: Other Sound Box field requests', points: 1, unit: 'per visit', active: true, isSystem: true, sortOrder: 66, updatedBy: null, updatedAt: null },
  { code: 'SB_RETURN', category: 'Sound Box', subCategory: 'Sound Box Return / Recovery', description: 'Approved Sound Box retrieval and recovery', points: 3, unit: 'per unit', active: true, isSystem: true, sortOrder: 70, updatedBy: null, updatedAt: null },
  { code: 'SB_ADAPTOR', category: 'Sound Box', subCategory: 'Sound Box AC Adaptor Delivery', description: 'Delivery or replacement of Sound Box AC Adaptor', points: 1, unit: 'per adaptor', active: true, isSystem: true, sortOrder: 75, updatedBy: null, updatedAt: null },
  { code: 'KHQR_INSTALL', category: 'KHQR', subCategory: 'KHQR New Installation', description: 'Merchant onboarded with new ABA KHQR kit', points: 1, unit: 'per merchant', active: true, isSystem: true, sortOrder: 80, updatedBy: null, updatedAt: null },
  { code: 'KHQR_REPLACE', category: 'KHQR', subCategory: 'KHQR Replacement', description: 'Damaged or old KHQR stand replaced', points: 1, unit: 'per merchant', active: true, isSystem: true, sortOrder: 90, updatedBy: null, updatedAt: null },
  { code: 'KHQR_MATERIAL', category: 'KHQR', subCategory: 'QR Material Scanned (Bonus)', description: 'Additional collateral or decals scanned during setup', points: 0, unit: 'per QR item', active: true, isSystem: true, sortOrder: 100, updatedBy: null, updatedAt: null },
  { code: 'KHQR_ONBOARD_FAIL', category: 'KHQR', subCategory: 'KHQR Onboarding Failed', description: 'Merchant KHQR onboarding attempt failed or rejected', points: 0, unit: 'per attempt', active: true, isSystem: true, sortOrder: 105, updatedBy: null, updatedAt: null },
  { code: 'CC_PRIMARY', category: 'Credit Card', subCategory: 'Primary Credit Card Onboarded', description: 'Approved primary credit card application', points: 15, unit: 'per card', active: true, isSystem: true, sortOrder: 110, updatedBy: null, updatedAt: null },
  { code: 'CC_SUPP', category: 'Credit Card', subCategory: 'Supplementary Card Onboarded', description: 'Approved supplementary credit card application', points: 5, unit: 'per supp. card', active: true, isSystem: true, sortOrder: 120, updatedBy: null, updatedAt: null },
  { code: 'CC_ONBOARD_FAIL', category: 'Credit Card', subCategory: 'Credit Card Onboarding Failed', description: 'Credit card onboarding attempt marked as Onboarding Failed', points: 0, unit: 'per application', active: true, isSystem: true, sortOrder: 125, updatedBy: null, updatedAt: null },
  { code: 'MV_ACCOUNT_OPENING', category: 'Merchant Visit', subCategory: 'Account Opening', description: 'Merchant Visit app: Account Opening', points: 0, unit: 'per visit', active: true, isSystem: true, sortOrder: 131, updatedBy: null, updatedAt: null },
  { code: 'MV_QR_MERCHANT_ONBOARDING', category: 'Merchant Visit', subCategory: 'QR Merchant Onboarding', description: 'Merchant Visit app: QR Merchant Onboarding', points: 0, unit: 'per visit', active: true, isSystem: true, sortOrder: 132, updatedBy: null, updatedAt: null },
  { code: 'MV_DECLINED_CASH_ONLY_NO_QR', category: 'Merchant Visit', subCategory: 'Declined – Cash Only (No QR)', description: 'Merchant Visit app: Declined – Cash Only (No QR)', points: 0, unit: 'per visit', active: true, isSystem: true, sortOrder: 133, updatedBy: null, updatedAt: null },
  { code: 'MV_ONBOARD_FAIL', category: 'Merchant Visit', subCategory: 'Merchant Onboarding Failed', description: 'Merchant Visit app: Onboarding attempt failed or declined', points: 0, unit: 'per visit', active: true, isSystem: true, sortOrder: 134, updatedBy: null, updatedAt: null },
  { code: 'MV_KHQR_ISSUE', category: 'Merchant Visit', subCategory: 'KHQR Issue', description: 'Merchant Visit app: KHQR Issue', points: 0, unit: 'per visit', active: true, isSystem: true, sortOrder: 135, updatedBy: null, updatedAt: null },
  { code: 'MV_ABA_MOBILE_SUPPORT', category: 'Merchant Visit', subCategory: 'ABA Mobile Support', description: 'Merchant Visit app: ABA Mobile Support', points: 0, unit: 'per visit', active: true, isSystem: true, sortOrder: 136, updatedBy: null, updatedAt: null },
  { code: 'MV_OTHER_BANK_S_PROMO', category: 'Merchant Visit', subCategory: "Other Bank's Promo", description: "Merchant Visit app: Other Bank's Promo", points: 0, unit: 'per visit', active: true, isSystem: true, sortOrder: 137, updatedBy: null, updatedAt: null },
  { code: 'MV_ABA_QR_IN_GOOD_CONDITION', category: 'Merchant Visit', subCategory: 'ABA QR in Good Condition', description: 'Merchant Visit app: ABA QR in Good Condition', points: 0, unit: 'per visit', active: true, isSystem: true, sortOrder: 138, updatedBy: null, updatedAt: null },
  { code: 'MV_KEY_MERCHANT_VISIT', category: 'Merchant Visit', subCategory: 'Key Merchant Visit', description: 'Merchant Visit app: Key Merchant Visit', points: 0, unit: 'per visit', active: true, isSystem: true, sortOrder: 139, updatedBy: null, updatedAt: null },
  { code: 'MV_PAYSOUND_ALERT_TELEGRAM', category: 'Merchant Visit', subCategory: 'PaySound / Alert Telegram', description: 'Merchant Visit app: PaySound / Alert Telegram', points: 0, unit: 'per visit', active: true, isSystem: true, sortOrder: 140, updatedBy: null, updatedAt: null },
  { code: 'MV_ON_SITE_ATM_LOCATION', category: 'Merchant Visit', subCategory: 'On-site ATM Location', description: 'Merchant Visit app: On-site ATM Location', points: 0, unit: 'per visit', active: true, isSystem: true, sortOrder: 141, updatedBy: null, updatedAt: null },
  { code: 'MV_BRING_DOCUMENT_TO_MERCHANT', category: 'Merchant Visit', subCategory: 'Bring Document to Merchant', description: 'Merchant Visit app: Bring Document to Merchant', points: 0, unit: 'per visit', active: true, isSystem: true, sortOrder: 142, updatedBy: null, updatedAt: null },
  { code: 'MV_MARKET_COVERAGE', category: 'Merchant Visit', subCategory: 'Market Coverage', description: 'Merchant Visit app: Market Coverage', points: 0, unit: 'per visit', active: true, isSystem: true, sortOrder: 143, updatedBy: null, updatedAt: null },
  { code: 'MV_REVIEW_GIANT_QR', category: 'Merchant Visit', subCategory: 'Review Giant QR', description: 'Merchant Visit app: Review Giant QR', points: 0, unit: 'per visit', active: true, isSystem: true, sortOrder: 144, updatedBy: null, updatedAt: null },
  { code: 'MV_ABA_GASOLINE_LOGO', category: 'Merchant Visit', subCategory: 'ABA Gasoline Logo', description: 'Merchant Visit app: ABA Gasoline Logo', points: 0, unit: 'per visit', active: true, isSystem: true, sortOrder: 145, updatedBy: null, updatedAt: null },
  { code: 'MV_PAYWAY_INSPECTION', category: 'Merchant Visit', subCategory: 'Payway Inspection', description: 'Merchant Visit app: Payway Inspection', points: 0, unit: 'per visit', active: true, isSystem: true, sortOrder: 146, updatedBy: null, updatedAt: null },
];

export const DEFAULT_KPI_TARGETS: KpiTargets = {
  branchDailyTarget: 125,
  branchWeeklyTarget: 625,
  branchMonthlyTarget: 2250,
  branchQuarterlyTarget: 6750,
  staffDailyTarget: 25,
  staffWeeklyTarget: 125,
  staffMonthlyTarget: 450,
  staffQuarterlyTarget: 1350,
  workDaysInMonth: 22,
  excludeHolidays: true,
  holidayDaysCount: 4,
  workingDaysMode: 'mon_fri',
  updatedBy: null,
  updatedAt: null,
};

let cachedSettings: KpiSettingsData | null = null;

export function getCachedKpiSettings(): KpiSettingsData {
  if (cachedSettings) return cachedSettings;
  const summary = getCachedKpiSummary(null, null);
  if (summary && summary.rules && summary.rules.length > 0) {
    cachedSettings = { rules: summary.rules, targets: summary.targets };
    return cachedSettings;
  }
  return { rules: DEFAULT_KPI_RULES, targets: DEFAULT_KPI_TARGETS };
}

export function clearKpiCache(): void {
  cachedSettings = null;
  summaryCache.clear();
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith(SESSION_CACHE_PREFIX)) {
        sessionStorage.removeItem(key);
      }
    }
  } catch { /* ignore */ }
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

export const getCachedKpiSummary = (from: string | null, to: string | null): KpiDashboardData | undefined => {
  const key = kpiCacheKey(from, to);
  const mem = summaryCache.get(key);
  if (mem) return mem;
  try {
    const raw = sessionStorage.getItem(SESSION_CACHE_PREFIX + key);
    if (raw) {
      const parsed = JSON.parse(raw) as KpiDashboardData;
      summaryCache.set(key, parsed);
      return parsed;
    }
  } catch { /* ignore storage errors */ }
  return undefined;
};

export const setCachedKpiSummary = (from: string | null, to: string | null, d: KpiDashboardData): void => {
  const key = kpiCacheKey(from, to);
  summaryCache.set(key, d);
  try {
    sessionStorage.setItem(SESSION_CACHE_PREFIX + key, JSON.stringify(d));
  } catch { /* ignore quota errors */ }
};

export function patchCachedKpiRule(rule: KpiPointRule): void {
  if (cachedSettings) {
    const exists = cachedSettings.rules.some((r) => r.code === rule.code);
    const rules = exists
      ? cachedSettings.rules.map((r) => (r.code === rule.code ? rule : r))
      : [...cachedSettings.rules, rule].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
    cachedSettings = { ...cachedSettings, rules };
  }
  summaryCache.forEach((v, k) => {
    const exists = v.rules.some((r) => r.code === rule.code);
    const rules = exists
      ? v.rules.map((r) => (r.code === rule.code ? rule : r))
      : [...v.rules, rule].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
    summaryCache.set(k, { ...v, rules });
  });
}

export function patchCachedKpiTargets(targets: KpiTargets): void {
  if (cachedSettings) {
    cachedSettings = { ...cachedSettings, targets };
  }
  summaryCache.forEach((v, k) => {
    summaryCache.set(k, { ...v, targets });
  });
}

/**
 * Ultra-fast settings fetcher for Settings -> Management KPI tab (0-15ms vs 2500ms).
 * Checks memory cache first, then calls the dedicated RPC or table queries.
 */
export async function fetchFastKpiSettings(): Promise<KpiSettingsData> {
  const existing = getCachedKpiSettings();
  if (cachedSettings && cachedSettings.rules.length > 0) {
    return cachedSettings;
  }

  if (!isSupabaseConfigured) {
    cachedSettings = { rules: DEFAULT_KPI_RULES, targets: DEFAULT_KPI_TARGETS };
    return cachedSettings;
  }

  try {
    const { data, error } = await supabase.rpc('kpi_get_settings_fast');
    if (!error && data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d: any = data;
      const res: KpiSettingsData = {
        rules: Array.isArray(d.rules) ? d.rules.map(mapRule) : DEFAULT_KPI_RULES,
        targets: mapTargets(d.targets),
      };
      cachedSettings = res;
      summaryCache.forEach((v, k) => {
        summaryCache.set(k, { ...v, rules: res.rules, targets: res.targets });
      });
      return res;
    }
  } catch {
    // fall through
  }

  try {
    const [rulesRes, targetsRes] = await Promise.all([
      supabase.from('kpi_point_rules').select('*').order('sort_order', { ascending: true }),
      supabase.from('kpi_settings').select('*').limit(1).maybeSingle(),
    ]);

    if (!rulesRes.error && rulesRes.data && rulesRes.data.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: KpiSettingsData = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rules: (rulesRes.data as any[]).map(mapRule),
        targets: mapTargets(targetsRes.data),
      };
      cachedSettings = res;
      summaryCache.forEach((v, k) => {
        summaryCache.set(k, { ...v, rules: res.rules, targets: res.targets });
      });
      return res;
    }
  } catch {
    // fallback
  }

  return existing;
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
    extra: r.extra && typeof r.extra === 'object'
      ? Object.fromEntries(Object.entries(r.extra).map(([k, v]) => [k, Number(v) || 0]))
      : {},
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
      mvTasks: Number(r.mv_tasks) || 0,
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
      mvTasks: Number(r.mv_tasks) || 0,
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

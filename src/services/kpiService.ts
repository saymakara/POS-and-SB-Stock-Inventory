import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { unpackKpiLists } from '../utils/kpiPack';
import { todayPP, addDaysYmd, diffDaysYmd } from '../utils/time';
import { emitPortalSync, registerPortalCacheInvalidator } from '../utils/portalSync';
import { clearOnUserChange, cacheOwner } from '../utils/userScopedCache';
import { persistGet, persistPut } from '../utils/persistCache';

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
  | 'LAST_QUARTER'
  | 'CUSTOM';

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
  CUSTOM: 'Selected date',
};

/** Half-open Phnom Penh (+07:00) ISO range for any single date or inclusive date range. */
export function kpiCustomRange(
  fromYmd: string,
  toYmd?: string | null,
): { from: string | null; to: string | null; targetKind: 'daily' | 'weekly' | 'monthly' | 'quarterly' } {
  const start = (fromYmd || todayPP()).slice(0, 10);
  const rawEnd = (toYmd || start).slice(0, 10);
  const lo = start <= rawEnd ? start : rawEnd;
  const hi = start <= rawEnd ? rawEnd : start;
  const startOf = (ymd: string) => new Date(`${ymd}T00:00:00+07:00`);
  const nextDay = addDaysYmd(hi, 1);
  const spanDays = Math.max(1, diffDaysYmd(lo, hi) + 1);
  const targetKind: 'daily' | 'weekly' | 'monthly' | 'quarterly' =
    spanDays <= 1 ? 'daily' : spanDays <= 10 ? 'weekly' : spanDays <= 45 ? 'monthly' : 'quarterly';
  return {
    from: startOf(lo).toISOString(),
    to: startOf(nextDay).toISOString(),
    targetKind,
  };
}

export function kpiPeriodRange(p: KpiPeriod): { from: string | null; to: string | null; targetKind: 'daily' | 'weekly' | 'monthly' | 'quarterly' } {
  if (p === 'ALL') return { from: null, to: null, targetKind: 'monthly' };
  const today = todayPP();
  if (p === 'CUSTOM') return kpiCustomRange(today, today);
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
  /** (22 Nov 2026) Booth Event / Standby VIP: points the server adds or takes away so the day follows the booth rules
   *  (shared by Booth Tag, or the higher of the booth points and the staff member's own) - Settings > KPI. */
  adjPts?: number;
  /** (27 Nov 2026) the Booth Event part of adjPts (the rest is Standby VIP). KPI Performance shows Booth Event apart. */
  adjBooth?: number;
  /** (27 Nov 2026) points of the tasks done at a booth, per category (POS / Sound Box / KHQR / Credit Card / Merchant
   *  Visit). KPI Performance counts them under Booth Event, so that column shows the real booth points. */
  boPos?: number; boSb?: number; boKhqr?: number; boCc?: number; boMv?: number;
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
  /** (27 Nov 2026) Booth Event days, a part of mvTasks */
  boothTasks?: number;
  /** (27 Nov 2026) KPI points of the day (sharing of Booth Event / Standby VIP included) */
  totalPts?: number;
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
  /** (27 Nov 2026) Booth Event days, a part of mvTasks */
  boothTasks?: number;
  /** (27 Nov 2026) KPI points of the day (sharing of Booth Event / Standby VIP included) */
  totalPts?: number;
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
  /** (26 Nov 2026) first day held in dailyStaff / dailyBranch (the server keeps about 3 months of day-by-day rows;
   *  months, quarters and totals stay complete). Empty / missing: every day is held. */
  dailyFrom?: string | null;
}

// (27 Nov 2026) the points calculation lives in utils/kpiPoints (no database import, so it can be unit-tested)
export { computeKpiPoints, rulePts, isBoothEventCode, type ComputedPoints } from '../utils/kpiPoints';

// ───────────── In-memory & Session cache (0ms instant tab opening & instant switching) ─────────────
interface KpiSeriesBundle {
  dateKey: string;
  fetchedAt: number;
  daily: KpiTimeBucketRaw[];
  weekly: KpiTimeBucketRaw[];
  monthly: KpiTimeBucketRaw[];
  quarterly: KpiTimeBucketRaw[];
  monthlyStaff: KpiMonthlyStaffRaw[];
  dailyBranch: KpiDailyBranchRaw[];
  dailyStaff: KpiDailyStaffRaw[];
  dailyFrom?: string | null;
}

const summaryCache = new Map<string, KpiDashboardData>();
const SESSION_CACHE_PREFIX = 'kpi_summary_slice_v8_';   // (27 Nov 2026) v8: adj_booth, booth_tasks, bo_*, total_pts
const SESSION_SERIES_PREFIX = 'kpi_series_cache_v8_';
let latestSeries: KpiSeriesBundle | null = null;
let staffSliceRpcSupported: boolean | null = null;

/**
 * (25 Nov 2026, speed) The KPI summary in its compact form (SQL 20261125_03_kpi_lite.sql): the same values, ~3.3x smaller
 * (each list is { k: keys, n: names, r: rows as arrays }; a staff / branch name is sent once and referred to by number).
 * Turned back here into exactly the rows the full summary has. When the database does not have the compact functions
 * yet, the full ones are used, as before.
 */
let liteRpcSupported: boolean | null = null;
const isMissingRpc = (msg: string | undefined) => /PGRST202|42883|does not exist|not in the stand-in|schema cache/i.test(msg || '');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function kpiRpc(full: 'kpi_dashboard_summary' | 'kpi_dashboard_staff_slice', args: Record<string, unknown>): Promise<{ data: any; error: { message: string } | null }> {
  if (liteRpcSupported !== false) {
    const res = await supabase.rpc(`${full}_lite`, args);
    if (!res.error) { liteRpcSupported = true; return { data: unpackKpiLists(res.data), error: null }; }
    if (!isMissingRpc(res.error.message)) return { data: null, error: res.error };
    liteRpcSupported = false;
  }
  const res = await supabase.rpc(full, args);
  return { data: res.data, error: res.error };
}
let pendingStorageTimer: number | null = null;
const pendingSlicesToPersist = new Map<string, { rules: KpiPointRule[]; targets: KpiTargets; staff: KpiStaffRaw[]; fetchedAt?: number }>();
let pendingSeriesToPersist = false;

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
  { code: 'POS_STAND', category: 'POS Terminal', subCategory: 'POS Stand Setup', description: 'Setup or replacement of POS Stand at merchant counter', points: 1, unit: 'per stand', active: true, isSystem: true, sortOrder: 42, updatedBy: null, updatedAt: null },
  { code: 'POS_DOCK', category: 'POS Terminal', subCategory: 'Charging Dock Installation', description: 'Installation or replacement of POS Charging Dock', points: 1, unit: 'per dock', active: true, isSystem: true, sortOrder: 43, updatedBy: null, updatedAt: null },
  { code: 'SB_INSTALL', category: 'Sound Box', subCategory: 'Sound Box New Installation', description: 'Approved new Sound Box installation at merchant', points: 5, unit: 'per unit', active: true, isSystem: true, sortOrder: 50, updatedBy: null, updatedAt: null },
  { code: 'SB_REPLACE', category: 'Sound Box', subCategory: 'Sound Box Replacement / Swap', description: 'Approved Sound Box replacement or swap', points: 4, unit: 'per swap', active: true, isSystem: true, sortOrder: 52, updatedBy: null, updatedAt: null },
  { code: 'SB_MAINTENANCE', category: 'Sound Box', subCategory: 'Sound Box Maintenance', description: 'Approved Sound Box maintenance / troubleshooting visit (SBM-)', points: 2, unit: 'per visit', active: true, isSystem: true, sortOrder: 58, updatedBy: null, updatedAt: null },
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
  { code: 'KHQR_PRINT_LAMINATE', category: 'KHQR', subCategory: 'KHQR Print & Laminate', description: 'KHQR Installation (New Installation or QR Replacement): printing and laminating the QR materials - per submission, the installer', points: 0, unit: 'per submission', active: true, isSystem: true, sortOrder: 23, updatedBy: null, updatedAt: null },
  { code: 'CC_PRIMARY', category: 'Credit Card', subCategory: 'Primary Credit Card Onboarded', description: 'Approved primary credit card application', points: 15, unit: 'per card', active: true, isSystem: true, sortOrder: 110, updatedBy: null, updatedAt: null },
  { code: 'CC_SUPP', category: 'Credit Card', subCategory: 'Supplementary Card Onboarded', description: 'Approved supplementary credit card application', points: 5, unit: 'per supp. card', active: true, isSystem: true, sortOrder: 120, updatedBy: null, updatedAt: null },
  { code: 'CC_ONBOARD_FAIL', category: 'Credit Card', subCategory: 'Credit Card Onboarding Failed', description: 'Credit card onboarding attempt marked as Onboarding Failed', points: 0, unit: 'per application', active: true, isSystem: true, sortOrder: 125, updatedBy: null, updatedAt: null },
  { code: 'MV_ACCOUNT_OPENING', category: 'Merchant Visit', subCategory: 'Account Opening', description: 'Merchant Visit app: Account Opening', points: 0, unit: 'per visit', active: true, isSystem: true, sortOrder: 131, updatedBy: null, updatedAt: null },
  { code: 'MV_QR_MERCHANT_ONBOARDING', category: 'Merchant Visit', subCategory: 'QR Merchant Onboarding', description: 'Merchant Visit app: QR Merchant Onboarding', points: 0, unit: 'per visit', active: true, isSystem: true, sortOrder: 132, updatedBy: null, updatedAt: null },
  { code: 'MV_DECLINED_CASH_ONLY_NO_QR', category: 'Merchant Visit', subCategory: 'Declined – Cash Only (No QR)', description: 'Merchant Visit app: Declined – Cash Only (No QR)', points: 0, unit: 'per visit', active: true, isSystem: true, sortOrder: 133, updatedBy: null, updatedAt: null },
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
  { code: 'MV_QR_REFRESHMENT', category: 'Merchant Visit', subCategory: 'QR Refreshment', description: 'Merchant Visit app: QR Refreshment', points: 0, unit: 'per visit', active: true, isSystem: true, sortOrder: 147, updatedBy: null, updatedAt: null },
  { code: 'MV_BOOTH_EVENT_FULL_DAY', category: 'Merchant Visit', subCategory: 'Booth Event - Full Day', description: 'Merchant Visit app: Booth Event, full day', points: 0, unit: 'per booth', active: true, isSystem: true, sortOrder: 148, updatedBy: null, updatedAt: null },
  { code: 'MV_BOOTH_EVENT_HALF_DAY', category: 'Merchant Visit', subCategory: 'Booth Event - Half Day', description: 'Merchant Visit app: Booth Event, half day', points: 0, unit: 'per booth', active: true, isSystem: true, sortOrder: 149, updatedBy: null, updatedAt: null },
  { code: 'MV_STANDBY_VIP_FULL_DAY', category: 'Merchant Visit', subCategory: 'Standby VIP - Full Day', description: 'Merchant Visit app: Standby VIP Merchant, full day', points: 0, unit: 'per standby', active: true, isSystem: true, sortOrder: 150, updatedBy: null, updatedAt: null },
  { code: 'MV_STANDBY_VIP_HALF_DAY', category: 'Merchant Visit', subCategory: 'Standby VIP - Half Day', description: 'Merchant Visit app: Standby VIP Merchant, half day', points: 0, unit: 'per standby', active: true, isSystem: true, sortOrder: 151, updatedBy: null, updatedAt: null },
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
  latestSeries = null;
  olderDaysCache.clear();
  summaryCache.clear();
  kpiBorn.clear();
  pendingSlicesToPersist.clear();
  pendingSeriesToPersist = false;
  diskSlices.clear();
  hydrated = null;
  staleAt = 0;
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key && (key.startsWith(SESSION_CACHE_PREFIX) || key.startsWith(SESSION_SERIES_PREFIX) || key.startsWith('kpi_summary_cache_v3_'))) {
        sessionStorage.removeItem(key);
      }
    }
  } catch { /* ignore */ }
}

/**
 * (26 Nov 2026, speed) A change to KPI data (a KHQR entry, a review, a rule...) no longer throws the kept figures away:
 * they stay on screen and are marked out of date, so the next screen that asks shows them at once and reads the new
 * figures in the background (stale while revalidate). Before, every change anywhere - every few seconds on a busy day -
 * emptied the copy, so opening Dashboard or KPI Performance showed a loading state and read everything again.
 * Only another person signing in empties the copy (clearKpiCache).
 */
let staleAt = 0;
function readStaleAt(): number {
  if (staleAt) return staleAt;
  try { staleAt = Number(sessionStorage.getItem('kpi_stale_at') || 0) || 0; } catch { /* */ }
  return staleAt;
}
export function markKpiStale(): void {
  cachedSettings = null;
  kpiBorn.clear();
  olderDaysCache.clear();
  staleAt = Date.now();
  try { sessionStorage.setItem('kpi_stale_at', String(staleAt)); } catch { /* */ }
}
// Routine device stock moves do not alter KPI points; only KPI-producing domains mark the kept summaries out of date.
registerPortalCacheInvalidator(['kpi', 'field', 'qr', 'cc', 'mv', 'staff'], markKpiStale);

clearOnUserChange(clearKpiCache);

function getSeriesBundle(): KpiSeriesBundle | null {
  const today = todayPP();
  if (latestSeries && latestSeries.dateKey === today) return latestSeries;
  try {
    const raw = sessionStorage.getItem(SESSION_SERIES_PREFIX + today);
    if (raw) {
      const parsed = JSON.parse(raw) as KpiSeriesBundle;
      if (parsed && parsed.dateKey === today) {
        latestSeries = parsed;
        return parsed;
      }
    }
  } catch { /* ignore storage errors */ }
  return null;
}

/** (26 Nov 2026) the summaries of today kept on disk for this person (persistCache): at most the 6 latest periods */
const diskSlices = new Map<string, { rules: KpiPointRule[]; targets: KpiTargets; staff: KpiStaffRaw[]; fetchedAt?: number }>();
const KPI_DISK_KEY = 'kpi_summary_v4';   // (27 Nov 2026) v4: adj_booth, booth_tasks, bo_*, total_pts
interface KpiDiskCopy { day: string; series: KpiSeriesBundle | null; slices: [string, { rules: KpiPointRule[]; targets: KpiTargets; staff: KpiStaffRaw[]; fetchedAt?: number }][] }

function flushKpiStorageWrites(): void {
  pendingStorageTimer = null;
  const owner = cacheOwner();
  if (owner && (pendingSeriesToPersist || pendingSlicesToPersist.size) && latestSeries && latestSeries.dateKey === todayPP()) {
    pendingSlicesToPersist.forEach((slice, key) => rememberSlice(key, slice));
    persistPut<KpiDiskCopy>(owner, KPI_DISK_KEY, { day: latestSeries.dateKey, series: latestSeries, slices: Array.from(diskSlices.entries()) });
  }
  try {
    if (pendingSeriesToPersist && latestSeries) {
      pendingSeriesToPersist = false;
      sessionStorage.setItem(SESSION_SERIES_PREFIX + latestSeries.dateKey, JSON.stringify(latestSeries));
    }
    pendingSlicesToPersist.forEach((slice, key) => {
      sessionStorage.setItem(SESSION_CACHE_PREFIX + key, JSON.stringify(slice));
    });
    pendingSlicesToPersist.clear();
  } catch { /* ignore quota errors */ }
}

function scheduleKpiStorageFlush(): void {
  if (pendingStorageTimer !== null) return;
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) {
    pendingStorageTimer = w.requestIdleCallback(flushKpiStorageWrites, { timeout: 1500 });
  } else {
    pendingStorageTimer = window.setTimeout(flushKpiStorageWrites, 600);
  }
}

function rememberSlice(key: string, slice: { rules: KpiPointRule[]; targets: KpiTargets; staff: KpiStaffRaw[]; fetchedAt?: number }): void {
  diskSlices.delete(key);
  diskSlices.set(key, slice);
  while (diskSlices.size > 6) diskSlices.delete(diskSlices.keys().next().value as string);
}

/**
 * (26 Nov 2026, speed) Opening the portal again the same day: today's KPI figures saved on disk for this person are
 * put back in memory, so Dashboard and KPI Performance show them at once. They count as out of date: the screens read
 * the current figures straight away, as before, and replace them. Figures of an earlier day are never shown.
 */
let hydrated: Promise<boolean> | null = null;
export function hydrateKpiFromDisk(owner: string): Promise<boolean> {
  if (hydrated) return hydrated;
  hydrated = (async () => {
    const today = todayPP();
    if (latestSeries && latestSeries.dateKey === today) return false;
    const copy = await persistGet<KpiDiskCopy>(owner, KPI_DISK_KEY, 18 * 3600_000);
    if (!copy || copy.day !== today || !copy.series || copy.series.dateKey !== today) return false;
    if (latestSeries && latestSeries.dateKey === today) return false;      // the database answered first
    latestSeries = copy.series;
    for (const [key, slice] of copy.slices || []) {
      rememberSlice(key, slice);
      if (summaryCache.has(key)) continue;
      summaryCache.set(key, {
        rules: slice.rules || [], targets: slice.targets || mapTargets(null), staff: slice.staff || [],
        daily: copy.series.daily || [], weekly: copy.series.weekly || [], monthly: copy.series.monthly || [],
        quarterly: copy.series.quarterly || [], monthlyStaff: copy.series.monthlyStaff || [],
        dailyBranch: copy.series.dailyBranch || [], dailyStaff: copy.series.dailyStaff || [], dailyFrom: copy.series.dailyFrom ?? null,
      });
    }
    try { window.dispatchEvent(new Event('portal:kpi-restored')); } catch { /* */ }
    return true;
  })().catch(() => false);
  return hydrated;
}

export const kpiCacheKey = (from: string | null, to: string | null) => `${from || ''}|${to || ''}`;

export const getCachedKpiSummary = (from: string | null, to: string | null): KpiDashboardData | undefined => {
  const key = kpiCacheKey(from, to);
  const mem = summaryCache.get(key);
  if (mem) return mem;
  try {
    const rawSlice = sessionStorage.getItem(SESSION_CACHE_PREFIX + key);
    if (rawSlice) {
      const slice = JSON.parse(rawSlice) as { rules: KpiPointRule[]; targets: KpiTargets; staff: KpiStaffRaw[]; fetchedAt?: number };
      const series = getSeriesBundle();
      const merged: KpiDashboardData = {
        rules: slice.rules || [],
        targets: slice.targets || mapTargets(null),
        staff: slice.staff || [],
        daily: series?.daily || [],
        weekly: series?.weekly || [],
        monthly: series?.monthly || [],
        quarterly: series?.quarterly || [],
        monthlyStaff: series?.monthlyStaff || [],
        dailyBranch: series?.dailyBranch || [],
        dailyStaff: series?.dailyStaff || [],
        dailyFrom: series?.dailyFrom ?? null,
      };
      summaryCache.set(key, merged);
      // Restore freshness timestamp across F5 refresh so a recently fetched KPI payload (< 5 min old) is reused at 0ms
      if (slice.fetchedAt && !kpiBorn.has(key) && Date.now() - slice.fetchedAt < 300_000 && slice.fetchedAt > readStaleAt()) {
        kpiBorn.set(key, slice.fetchedAt);
      }
      return merged;
    }
  } catch { /* ignore storage errors */ }
  return undefined;
};

export const setCachedKpiSummary = (from: string | null, to: string | null, d: KpiDashboardData): void => {
  const key = kpiCacheKey(from, to);
  summaryCache.set(key, d);
  const hasSeries = (d.daily && d.daily.length > 0) || (d.monthly && d.monthly.length > 0) || (d.dailyStaff && d.dailyStaff.length > 0);
  if (hasSeries) {
    latestSeries = {
      dateKey: todayPP(),
      fetchedAt: Date.now(),
      daily: d.daily || [],
      weekly: d.weekly || [],
      monthly: d.monthly || [],
      quarterly: d.quarterly || [],
      monthlyStaff: d.monthlyStaff || [],
      dailyBranch: d.dailyBranch || [],
      dailyStaff: d.dailyStaff || [],
      dailyFrom: d.dailyFrom ?? null,
    };
    pendingSeriesToPersist = true;
  }
  pendingSlicesToPersist.set(key, { rules: d.rules, targets: d.targets, staff: d.staff, fetchedAt: Date.now() });
  scheduleKpiStorageFlush();
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

export function removeCachedKpiRule(code: string): void {
  if (cachedSettings) {
    cachedSettings = {
      ...cachedSettings,
      rules: cachedSettings.rules.filter((r) => r.code !== code),
    };
  }
  summaryCache.forEach((v, k) => {
    summaryCache.set(k, {
      ...v,
      rules: v.rules.filter((r) => r.code !== code),
    });
  });
  kpiBorn.clear();
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const storageKey = sessionStorage.key(i);
      if (storageKey && storageKey.startsWith(SESSION_CACHE_PREFIX)) {
        const raw = sessionStorage.getItem(storageKey);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as { rules?: KpiPointRule[]; targets?: KpiTargets; staff?: KpiStaffRaw[] };
        if (Array.isArray(parsed.rules)) {
          sessionStorage.setItem(
            storageKey,
            JSON.stringify({ ...parsed, rules: parsed.rules.filter((r) => r.code !== code) })
          );
        }
      }
    }
  } catch { /* ignore storage errors */ }
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
    adjPts: Number(r.adj_pts) || 0,
    adjBooth: Number(r.adj_booth) || 0,
    boPos: Number(r.bo_pos) || 0, boSb: Number(r.bo_sb) || 0, boKhqr: Number(r.bo_khqr) || 0, boCc: Number(r.bo_cc) || 0, boMv: Number(r.bo_mv) || 0,
    extra: r.extra && typeof r.extra === 'object'
      ? Object.fromEntries(Object.entries(r.extra).map(([k, v]) => [k, Number(v) || 0]))
      : {},
  };
}

const kpiInflight = new Map<string, Promise<KpiDashboardData>>();
/** Phnom Penh calendar day of an ISO time ("2026-10-31T17:00:00.000Z" -> "2026-11-01"). */
export const ppYmdOf = (iso: string): string => { const t = Date.parse(iso); return Number.isFinite(t) ? todayPP(new Date(t)) : iso.slice(0, 10); };

/**
 * (26 Nov 2026) Day-by-day rows before `before` (the first day a summary holds), from `fromYmd` on - read only when a
 * screen shows an older day (the daily table of an older month). One request per start day, then kept in memory.
 */
const olderDaysCache = new Map<string, Promise<{ dailyFrom: string; dailyStaff: KpiDailyStaffRaw[]; dailyBranch: KpiDailyBranchRaw[] }>>();
export function fetchKpiOlderDays(fromYmd: string, before: string): Promise<{ dailyFrom: string; dailyStaff: KpiDailyStaffRaw[]; dailyBranch: KpiDailyBranchRaw[] }> {
  const key = `${fromYmd}|${before}|${todayPP()}`;
  let p = olderDaysCache.get(key);
  if (!p) {
    p = fetchKpiSummary(new Date(`${fromYmd}T00:00:00+07:00`).toISOString(), null).then((r) => ({
      dailyFrom: r.dailyFrom || fromYmd,
      dailyStaff: (r.dailyStaff || []).filter((x) => x.day && x.day < before),
      dailyBranch: (r.dailyBranch || []).filter((x) => x.day && x.day < before),
    }));
    p.catch(() => { if (olderDaysCache.get(key) === p) olderDaysCache.delete(key); });
    olderDaysCache.set(key, p);
  }
  return p;
}
const kpiBorn = new Map<string, number>();

export async function fetchKpiSummary(from: string | null, to: string | null, force = false): Promise<KpiDashboardData> {
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
  const key = `${from || ''}|${to || ''}`;
  const hit = !force ? getCachedKpiSummary(from, to) : undefined;
  if (hit && Date.now() - (kpiBorn.get(key) || 0) < 300_000) return hit;
  const running = !force ? kpiInflight.get(key) : undefined;
  if (running) return running;

  const p = (async () => {
    const seriesBundle = !force ? getSeriesBundle() : null;
    const canSlice =
      Boolean(seriesBundle) &&
      staffSliceRpcSupported !== false &&
      Date.now() - (seriesBundle?.fetchedAt || 0) < 900_000 &&
      ((seriesBundle?.daily.length || 0) > 0 || (seriesBundle?.monthly.length || 0) > 0) &&
      // (26 Nov 2026) the kept day-by-day rows must reach back to the start of the period asked for
      (!seriesBundle?.dailyFrom || !from || ppYmdOf(from) >= seriesBundle.dailyFrom);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let d: any = null;
    let usedSlice = false;
    if (canSlice) {
      const sliceRes = await kpiRpc('kpi_dashboard_staff_slice', { p_from: from, p_to: to });
      if (!sliceRes.error && sliceRes.data && typeof sliceRes.data === 'object') {
        staffSliceRpcSupported = true;
        d = sliceRes.data;
        usedSlice = true;
      } else if (/PGRST202|42883|does not exist|not in the stand-in/i.test(sliceRes.error?.message || '')) {
        staffSliceRpcSupported = false;
      }
    }

    if (!d) {
      const fullRes = await kpiRpc('kpi_dashboard_summary', { p_from: from, p_to: to });
      if (fullRes.error) throw new Error(fullRes.error.message);
      d = fullRes.data || {};
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapStaffList = (list: any[]) =>
      list.map((r: any) => ({
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
      }));

    const out: KpiDashboardData = usedSlice && seriesBundle
      ? {
          rules: Array.isArray(d.rules) ? d.rules.map(mapRule) : [],
          targets: mapTargets(d.targets),
          staff: Array.isArray(d.staff) ? mapStaffList(d.staff) : [],
          daily: seriesBundle.daily,
          weekly: seriesBundle.weekly,
          monthly: seriesBundle.monthly,
          quarterly: seriesBundle.quarterly,
          monthlyStaff: seriesBundle.monthlyStaff,
          dailyBranch: seriesBundle.dailyBranch,
          dailyStaff: seriesBundle.dailyStaff,
          dailyFrom: seriesBundle.dailyFrom ?? null,
        }
      : {
          rules: Array.isArray(d.rules) ? d.rules.map(mapRule) : [],
          targets: mapTargets(d.targets),
          staff: Array.isArray(d.staff) ? mapStaffList(d.staff) : [],
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
            boothTasks: Number(r.booth_tasks) || 0,
            totalPts: Number(r.total_pts) || 0,
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
            boothTasks: Number(r.booth_tasks) || 0,
            totalPts: Number(r.total_pts) || 0,
          })) : [],
          dailyFrom: typeof d.daily_from === 'string' && d.daily_from ? d.daily_from : null,
        };
    setCachedKpiSummary(from, to, out);
    kpiBorn.set(key, Date.now());
    return out;
  })().finally(() => {
    if (kpiInflight.get(key) === p) kpiInflight.delete(key);
  });

  kpiInflight.set(key, p);
  return p;
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
  emitPortalSync(['kpi'], { broadcast: true, skipInvalidate: true });
  return mapped;
}

export async function deleteKpiRuleOnServer(code: string): Promise<void> {
  const { error } = await supabase.rpc('kpi_delete_rule', { p_code: code });
  if (error) throw new Error(error.message);
  removeCachedKpiRule(code);
  emitPortalSync(['kpi'], { broadcast: true, skipInvalidate: true });
}

/** (22 Nov 2026) A Merchant Visit activity that has no KPI task yet (found by Sync). */
export interface KpiSyncCandidate {
  code: string;
  activity: string;
  subCategory: string;
  category: KpiCategory;
  visits: number;
  lastSeen: string | null;
  deletedAt?: string | null;
  deletedBy?: string | null;
}
export interface KpiSyncResult {
  applied: boolean;
  added: number;
  candidates: KpiSyncCandidate[];
  deletedSkipped: KpiSyncCandidate[];
  activitiesChecked: number;
  alreadyHaveRule: number;
  rules: KpiPointRule[];
}

/**
 * (22 Nov 2026) Sync KPI tasks from the Merchant Visit app (migration 20261122_02, Super Admin). `apply` false only lists the
 * activities the app has sent that have no KPI task yet; `apply` true adds them (0 pts, inactive - a task deleted before comes
 * back as it was when `includeDeleted`). Tasks you deleted are left out unless `includeDeleted`.
 */
export async function syncKpiFromMerchantVisit(apply: boolean, includeDeleted = false): Promise<KpiSyncResult> {
  const { data, error } = await supabase.rpc('kpi_sync_from_mv', { p: { apply, include_deleted: includeDeleted } });
  if (error) {
    if (/PGRST202|42883|does not exist|Could not find the function/i.test(error.message)) {
      throw new Error('the server is not updated yet (run SQL 20261122_02)');
    }
    throw new Error(error.message);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = (data || {}) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cand = (e: any): KpiSyncCandidate => ({
    code: String(e.code || ''),
    activity: String(e.activity || ''),
    subCategory: String(e.sub_category || e.activity || ''),
    category: (e.category || 'Merchant Visit') as KpiCategory,
    visits: Number(e.visits) || 0,
    lastSeen: e.last_seen || null,
    deletedAt: e.deleted_at || null,
    deletedBy: e.deleted_by || null,
  });
  const rules = (Array.isArray(d.rules) ? d.rules : []).map(mapRule);
  rules.forEach(patchCachedKpiRule);
  return {
    applied: !!d.applied,
    added: Number(d.added) || 0,
    candidates: (Array.isArray(d.new) ? d.new : []).map(cand),
    deletedSkipped: (Array.isArray(d.deleted_skipped) ? d.deleted_skipped : []).map(cand),
    activitiesChecked: Number(d.activities_checked) || 0,
    alreadyHaveRule: Number(d.already_have_rule) || 0,
    rules,
  };
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
  emitPortalSync(['kpi'], { broadcast: true, skipInvalidate: true });
  return mapped;
}

let inflight: Promise<KpiDashboardData | null> | null = null;
let lastPrefetch = 0;

export function prefetchKpi(force = false): Promise<KpiDashboardData | null> {
  if (!isSupabaseConfigured) return Promise.resolve(null);
  if (inflight) return inflight;
  if (!force && Date.now() - lastPrefetch < 300_000 && getCachedKpiSummary(null, null)) {
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

// ───────────── (22 Nov 2026) Booth Event / Standby VIP rules and per-submission counting (Settings > KPI, Super Admin) ─────────────
export type BoothMode = 'fixed' | 'higher' | 'shared';
export type StandbyMode = 'fixed' | 'higher';
export interface KpiEventSettings {
  installPerSubmission: boolean;
  boothMode: BoothMode;
  standbyMode: StandbyMode;
  halfDayWeight: number;
  updatedBy: string | null;
  updatedAt: string | null;
}
export const DEFAULT_KPI_EVENT_SETTINGS: KpiEventSettings = {
  installPerSubmission: true, boothMode: 'shared', standbyMode: 'higher', halfDayWeight: 0.5, updatedBy: null, updatedAt: null,
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapEventSettings(d: any): KpiEventSettings {
  if (!d) return DEFAULT_KPI_EVENT_SETTINGS;
  return {
    installPerSubmission: d.install_per_submission !== false,
    boothMode: (['fixed', 'higher', 'shared'].includes(d.booth_mode) ? d.booth_mode : 'shared') as BoothMode,
    standbyMode: (d.standby_mode === 'fixed' ? 'fixed' : 'higher') as StandbyMode,
    halfDayWeight: Number(d.half_day_weight) || 0.5,
    updatedBy: d.updated_by || null,
    updatedAt: d.updated_at || null,
  };
}
/** null when the server has no such setting yet (SQL 20261122_03 not run). */
export async function fetchKpiEventSettings(): Promise<KpiEventSettings | null> {
  if (!isSupabaseConfigured) return DEFAULT_KPI_EVENT_SETTINGS;
  const { data, error } = await supabase.from('kpi_event_settings').select('*').eq('id', 1).maybeSingle();
  if (error) return null;
  return mapEventSettings(data);
}
export async function saveKpiEventSettings(s: Omit<KpiEventSettings, 'updatedBy' | 'updatedAt'>): Promise<KpiEventSettings> {
  const { data, error } = await supabase.rpc('kpi_save_event_settings', {
    p: { install_per_submission: s.installPerSubmission, booth_mode: s.boothMode, standby_mode: s.standbyMode, half_day_weight: s.halfDayWeight },
  });
  if (error) throw new Error(/PGRST202|42883|does not exist|Could not find the function/i.test(error.message) ? 'the server is not updated yet (run SQL 20261122_03)' : error.message);
  summaryCache.clear();
  return mapEventSettings(data);
}

import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Trophy, BarChart3, Building2, Users, Calendar, Layers, Award, Settings2, Search, RefreshCw, Loader2,
  ChevronDown, CheckCircle2, Cpu, Volume2, QrCode, CreditCard, Plus, Save, TrendingUp, TrendingDown, Target, ShieldCheck,
  Sun, CheckSquare, Diamond, X, ArrowUpDown, ArrowUp, ArrowDown,
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
import {
  KpiCategory, KpiPeriod, KPI_PERIOD_LABEL, kpiPeriodRange, KpiPointRule, KpiTargets, KpiDashboardData,
  KpiRawCounts, computeKpiPoints, rulePts, fetchKpiSummary, getCachedKpiSummary, saveKpiRuleOnServer, saveKpiTargetsOnServer,
} from '../services/kpiService';

const SPRING = { type: 'spring', stiffness: 500, damping: 32, mass: 0.55 } as const;
const CHART_TRANSITION = { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const };

type KpiView = 'all' | 'branches' | 'staff' | 'timeline' | 'top10' | 'rules';
type Granularity = 'daily' | 'weekly' | 'monthly' | 'quarterly';
type KpiRating = 'Outstanding' | 'Meet Target' | 'Near/Below Target' | 'Needs Improvement';

function getKpiRating(pct: number): KpiRating {
  if (pct >= 120) return 'Outstanding';
  if (pct >= 100) return 'Meet Target';
  if (pct >= 70) return 'Near/Below Target';
  return 'Needs Improvement';
}

const CAT_COLORS: Record<KpiCategory, { hex: string; badge: string; bar: string; dot: string; Icon: React.ElementType }> = {
  'POS Terminal': { hex: '#0ea5e9', badge: 'bg-sky-50 text-sky-700 border-sky-200/90', bar: 'bg-sky-500', dot: 'bg-sky-500', Icon: Cpu },
  'Sound Box': { hex: '#1e5b88', badge: 'bg-[#eef5f9] text-[#1e5b88] border-[#cfe0ea]', bar: 'bg-[#1e5b88]', dot: 'bg-[#1e5b88]', Icon: Volume2 },
  KHQR: { hex: '#0d9488', badge: 'bg-teal-50 text-teal-700 border-teal-200/90', bar: 'bg-teal-600', dot: 'bg-teal-600', Icon: QrCode },
  'Credit Card': { hex: '#f59e0b', badge: 'bg-amber-50 text-amber-700 border-amber-200/90', bar: 'bg-amber-500', dot: 'bg-amber-500', Icon: CreditCard },
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

const fmtPts = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
const fmtInt = (n: number) => n.toLocaleString('en-US');

function cleanBranchName(name: string, stripSuffix = true): string {
  const base = (name || '').replace(/^Code\s+\d+\s*[·-]\s*/i, '').trim();
  const out = stripSuffix ? base.replace(/\s*Branch$/i, '').trim() : base;
  return out || 'Unassigned';
}

function fmtBranchLabel(branchId: string, branchName: string, short = false): string {
  const clean = cleanBranchName(branchName, short);
  if (!branchId || branchId === 'UNASSIGNED') return clean;
  return `${clean} (${branchId})`;
}

interface Props {
  role: UserRole;
  userBranchId?: string;
  branches: Branch[];
  triggerToast: (msg: string) => void;
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
  const [openBranch, setOpenBranch] = useState<string | null>(null);
  const [openStaff, setOpenStaff] = useState<string | null>(null);
  const [showSubCategories, setShowSubCategories] = useState(false);
  const [tableMode, setTableMode] = useState<'branch' | 'staff'>('branch');

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
    m.set('100', 'Head Office');
    branches.forEach((b) => m.set(String(b.id), b.name));
    return m;
  }, [branches]);

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

  const enrichedStaff = useMemo(() => {
    if (!data) return [];
    const base = data.staff
      .map((s) => {
        const pts = computeKpiPoints(s, ruleMap);
        const canonicalBranchName = branchNameMap.get(s.branchId) || s.branchName || s.branchId;
        const totalSubmitted = s.posSubmitted + s.sbSubmitted + pts.khqrTasks + s.ccSubmitted;
        const totalIssues = s.posRejected + s.sbRejected + s.khqrFailed + s.ccRejected;
        const qualityPct = totalSubmitted > 0 ? Math.max(0, Math.round(((totalSubmitted - totalIssues) / totalSubmitted) * 100)) : 100;
        const isPP = PHNOM_PENH_CODES.has(s.branchId) || /phnom\s*penh|head\s*office/i.test(canonicalBranchName);
        return {
          ...s,
          branchName: canonicalBranchName,
          isPP,
          ...pts,
          qualityPct,
        };
      })
      .filter((s) => s.totalTasks > 0 || s.posSubmitted > 0 || s.sbSubmitted > 0 || s.ccSubmitted > 0);

    const totalStaff = base.length;
    const avgPts = totalStaff > 0 ? base.reduce((acc, s) => acc + s.totalPoints, 0) / totalStaff : 0;
    const rawTargetHit = base.filter((s) => s.totalPoints >= activeTargets.staff).length;
    const effectiveStaffTarget =
      totalStaff > 0 && rawTargetHit / totalStaff >= 0.08
        ? activeTargets.staff
        : Math.max(8, Math.round(avgPts) || activeTargets.staff);

    return base
      .map((s) => {
        const targetPct = effectiveStaffTarget > 0 ? Math.min(999, Math.round((s.totalPoints / effectiveStaffTarget) * 1000) / 10) : 100;
        const rating = getKpiRating(targetPct);
        return {
          ...s,
          targetPct,
          rating,
          effectiveTarget: effectiveStaffTarget,
        };
      })
      .sort((a, b) => b.totalPoints - a.totalPoints || b.totalTasks - a.totalTasks);
  }, [data, ruleMap, branchNameMap, activeTargets.staff]);

  const branchRows = useMemo(() => {
    const map = new Map<string, {
      branchId: string;
      branchName: string;
      isPP: boolean;
      staffCount: number;
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
      b.totalSubmitted += s.posSubmitted + s.sbSubmitted + s.khqrTasks + s.ccSubmitted;
      b.totalIssues += s.posRejected + s.sbRejected + s.khqrFailed + s.ccRejected;
    });

    const baseBranches = Array.from(map.values()).map((b) => {
      const pts = computeKpiPoints(b.raw, ruleMap);
      const ptsPerStaff = b.staffCount > 0 ? Math.round((pts.totalPoints / b.staffCount) * 10) / 10 : 0;
      const qualityPct = b.totalSubmitted > 0 ? Math.max(0, Math.round(((b.totalSubmitted - b.totalIssues) / b.totalSubmitted) * 100)) : 100;
      return {
        ...b,
        ...pts,
        ptsPerStaff,
        qualityPct,
      };
    });

    const totalBranches = baseBranches.length;
    const avgBranchPts = totalBranches > 0 ? baseBranches.reduce((acc, b) => acc + b.totalPoints, 0) / totalBranches : 0;
    const rawBranchHit = baseBranches.filter((b) => b.totalPoints >= activeTargets.branch).length;
    const effectiveBranchTarget =
      totalBranches > 0 && rawBranchHit / totalBranches >= 0.08
        ? activeTargets.branch
        : Math.max(20, Math.round(avgBranchPts) || activeTargets.branch);

    return baseBranches
      .map((b) => {
        const targetPct = effectiveBranchTarget > 0 ? Math.min(999, Math.round((b.totalPoints / effectiveBranchTarget) * 1000) / 10) : 100;
        const rating = getKpiRating(targetPct);
        return {
          ...b,
          targetPct,
          rating,
          effectiveTarget: effectiveBranchTarget,
        };
      })
      .sort((a, b) => b.totalPoints - a.totalPoints || b.totalTasks - a.totalTasks);
  }, [enrichedStaff, branchNameMap, ruleMap, activeTargets.branch]);

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
      if (regionFilter === 'PP' && !s.isPP) return false;
      if (regionFilter === 'PROV' && s.isPP) return false;
      if (branchFilter && s.branchId !== branchFilter) return false;
      if (categoryFilter === 'POS Terminal' && s.posTasks === 0) return false;
      if (categoryFilter === 'Sound Box' && s.sbTasks === 0) return false;
      if (categoryFilter === 'KHQR' && s.khqrTasks === 0) return false;
      if (categoryFilter === 'Credit Card' && s.ccTasks === 0) return false;
      if (q && !`${s.staffId} ${s.staffName} ${s.branchId} ${s.branchName}`.toLowerCase().includes(q)) return false;
      return true;
    });

    return [...list].sort((a, b) => {
      let av: string | number = 0;
      let bv: string | number = 0;
      switch (staffSortKey) {
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
  }, [enrichedStaff, isAdmin, userBranchId, regionFilter, branchFilter, categoryFilter, deferredQuery, staffSortKey, staffSortDir]);

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
      submitted += b.totalSubmitted;
      issues += b.totalIssues;
    });
    const pts = computeKpiPoints(raw, ruleMap);
    const activeBranchCount = filteredBranches.length;
    const activeStaffCount = filteredBranches.reduce((acc, b) => acc + b.staffCount, 0);
    const avgBranchPts = activeBranchCount > 0 ? Math.round((pts.totalPoints / activeBranchCount) * 10) / 10 : 0;
    const avgStaffPts = activeStaffCount > 0 ? Math.round((pts.totalPoints / activeStaffCount) * 10) / 10 : 0;
    const qualityPct = submitted > 0 ? Math.max(0, Math.round(((submitted - issues) / submitted) * 100)) : 100;
    const branchesOnTarget = filteredBranches.filter((b) => b.targetPct >= 100).length;
    const staffOnTarget = filteredStaff.filter((s) => s.targetPct >= 100).length;
    return {
      raw,
      ...pts,
      activeBranchCount,
      activeStaffCount,
      avgBranchPts,
      avgStaffPts,
      qualityPct,
      branchesOnTarget,
      staffOnTarget,
      topBranch: filteredBranches[0] || null,
      topStaff: filteredStaff[0] || null,
    };
  }, [filteredBranches, filteredStaff, ruleMap]);

  const timeSeries = useMemo(() => {
    if (!data) return [];
    const src =
      granularity === 'daily' ? data.daily :
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
  }, [data, granularity, ruleMap, timelineSortKey, timelineSortDir]);

  const subCategoryBreakdown = useMemo(() => {
    const r = totals.raw;
    const items: { code: string; category: KpiCategory; label: string; count: number; unitPts: number; points: number; unit: string }[] = [
      { code: 'POS_INSTALL', category: 'POS Terminal', label: ruleMap.get('POS_INSTALL')?.subCategory || 'POS New Installation', count: r.posInstall, unitPts: rulePts(ruleMap, 'POS_INSTALL'), points: r.posInstall * rulePts(ruleMap, 'POS_INSTALL'), unit: 'terminals' },
      { code: 'POS_REPLACE', category: 'POS Terminal', label: ruleMap.get('POS_REPLACE')?.subCategory || 'POS Replacement / Swap', count: r.posReplace, unitPts: rulePts(ruleMap, 'POS_REPLACE'), points: r.posReplace * rulePts(ruleMap, 'POS_REPLACE'), unit: 'swaps' },
      { code: 'POS_BATTERY', category: 'POS Terminal', label: ruleMap.get('POS_BATTERY')?.subCategory || 'POS Battery Replacement', count: r.posBattery, unitPts: rulePts(ruleMap, 'POS_BATTERY'), points: r.posBattery * rulePts(ruleMap, 'POS_BATTERY'), unit: 'batteries' },
      { code: 'SB_INSTALL', category: 'Sound Box', label: ruleMap.get('SB_INSTALL')?.subCategory || 'Sound Box New Installation', count: r.sbInstall, unitPts: rulePts(ruleMap, 'SB_INSTALL'), points: r.sbInstall * rulePts(ruleMap, 'SB_INSTALL'), unit: 'units' },
      { code: 'SB_REPLACE', category: 'Sound Box', label: ruleMap.get('SB_REPLACE')?.subCategory || 'Sound Box Replacement / Swap', count: r.sbReplace, unitPts: rulePts(ruleMap, 'SB_REPLACE'), points: r.sbReplace * rulePts(ruleMap, 'SB_REPLACE'), unit: 'swaps' },
      { code: 'SB_MAINT', category: 'Sound Box', label: ruleMap.get('SB_MAINT')?.subCategory || 'Sound Box Maintenance', count: r.sbMaint, unitPts: rulePts(ruleMap, 'SB_MAINT'), points: r.sbMaint * rulePts(ruleMap, 'SB_MAINT'), unit: 'visits' },
      { code: 'SB_RETURN', category: 'Sound Box', label: ruleMap.get('SB_RETURN')?.subCategory || 'Sound Box Return / Recovery', count: r.sbReturn, unitPts: rulePts(ruleMap, 'SB_RETURN'), points: r.sbReturn * rulePts(ruleMap, 'SB_RETURN'), unit: 'units' },
      { code: 'KHQR_INSTALL', category: 'KHQR', label: ruleMap.get('KHQR_INSTALL')?.subCategory || 'KHQR New Installation', count: r.khqrInstall, unitPts: rulePts(ruleMap, 'KHQR_INSTALL'), points: r.khqrInstall * rulePts(ruleMap, 'KHQR_INSTALL'), unit: 'merchants' },
      { code: 'KHQR_REPLACE', category: 'KHQR', label: ruleMap.get('KHQR_REPLACE')?.subCategory || 'KHQR Replacement', count: r.khqrReplace, unitPts: rulePts(ruleMap, 'KHQR_REPLACE'), points: r.khqrReplace * rulePts(ruleMap, 'KHQR_REPLACE'), unit: 'merchants' },
      { code: 'KHQR_MATERIAL', category: 'KHQR', label: ruleMap.get('KHQR_MATERIAL')?.subCategory || 'QR Material Scanned (Bonus)', count: r.khqrMaterials, unitPts: rulePts(ruleMap, 'KHQR_MATERIAL'), points: r.khqrMaterials * rulePts(ruleMap, 'KHQR_MATERIAL'), unit: 'QR items' },
      { code: 'CC_PRIMARY', category: 'Credit Card', label: ruleMap.get('CC_PRIMARY')?.subCategory || 'Primary Credit Card Onboarded', count: r.ccPrimary, unitPts: rulePts(ruleMap, 'CC_PRIMARY'), points: r.ccPrimary * rulePts(ruleMap, 'CC_PRIMARY'), unit: 'cards' },
      { code: 'CC_SUPP', category: 'Credit Card', label: ruleMap.get('CC_SUPP')?.subCategory || 'Supplementary Card Onboarded', count: r.ccSupp, unitPts: rulePts(ruleMap, 'CC_SUPP'), points: r.ccSupp * rulePts(ruleMap, 'CC_SUPP'), unit: 'supp. cards' },
    ];
    return items
      .map((it) => ({ ...it, points: Math.round(it.points * 100) / 100 }))
      .sort((a, b) => b.points - a.points || b.count - a.count);
  }, [totals.raw, ruleMap]);

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    (data?.monthly || []).forEach((m) => { if (m.period) set.add(m.period); });
    (data?.monthlyStaff || []).forEach((m) => { if (m.month) set.add(m.month); });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [data?.monthly, data?.monthlyStaff]);

  const top10Data = useMemo(() => {
    if (selectedTopMonth === 'ALL' || !data) {
      return {
        branches: branchRows.slice(0, 10),
        staff: enrichedStaff.slice(0, 10),
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
      .filter((ms) => ms.totalTasks > 0)
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
      ['Rank', 'Branch Code', 'Branch Name', 'Active Staff', 'POS Tasks', 'POS Points', 'Sound Box Tasks', 'Sound Box Points',
        'KHQR Tasks', 'QR Materials', 'KHQR Points', 'Credit Card Tasks', 'Credit Card Points', 'Total Tasks', 'Pts / Staff', 'Total KPI Points', 'Achievement %', 'Rating'],
      filteredBranches.map((b, i) => [
        i + 1, b.branchId, b.branchName, b.staffCount, b.posTasks, b.posPoints, b.sbTasks, b.sbPoints,
        b.khqrTasks, b.khqrMaterials, b.khqrPoints, b.ccTasks, b.ccPoints, b.totalTasks, b.ptsPerStaff, b.totalPoints, `${b.targetPct}%`, b.rating,
      ])
    );
    return filteredBranches.length;
  };

  const exportStaffCsv = async () => {
    if (!filteredStaff.length) return 0;
    const pTag = KPI_PERIOD_LABEL[period].replace(/[^A-Za-z0-9]+/g, '_');
    downloadCsv(
      `KPI_Individual_Staff_${pTag}`,
      ['Rank', 'Staff ID', 'Staff Name', 'Branch Code', 'Branch Name', 'POS Install', 'POS Replace', 'POS Battery', 'POS Points',
        'SB Install', 'SB Replace', 'SB Maint', 'SB Return', 'Sound Box Points', 'KHQR Install', 'KHQR Replace', 'QR Materials', 'KHQR Points',
        'CC Primary', 'CC Supplementary', 'Credit Card Points', 'Quality %', 'Total Tasks', 'Total KPI Points', 'Achievement %', 'Rating'],
      filteredStaff.map((s, i) => [
        i + 1, s.staffId, s.staffName, s.branchId, s.branchName, s.posInstall, s.posReplace, s.posBattery, s.posPoints,
        s.sbInstall, s.sbReplace, s.sbMaint, s.sbReturn, s.sbPoints, s.khqrInstall, s.khqrReplace, s.khqrMaterials, s.khqrPoints,
        s.ccPrimary, s.ccSupp, s.ccPoints, `${s.qualityPct}%`, s.totalTasks, s.totalPoints, `${s.targetPct}%`, s.rating,
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
    { id: 'branches', label: 'Branch KPI', Icon: Building2, count: filteredBranches.length },
    { id: 'staff', label: 'Staff KPI', Icon: Users, count: filteredStaff.length },
    { id: 'timeline', label: 'Performance Trend', Icon: Calendar },
    { id: 'top10', label: 'Top 10 Leaderboard', Icon: Trophy },
    { id: 'rules', label: 'KPI Point Rules', Icon: Settings2, count: (data?.rules || []).length || undefined },
  ];

  const showSection = (sec: KpiView) => view === 'all' || view === sec;

  const reversedTimeSeries = useMemo(() => [...timeSeries].reverse(), [timeSeries]);
  const topBranchChartData = useMemo(
    () =>
      filteredBranches.slice(0, 10).map((b) => ({
        name: fmtBranchLabel(b.branchId, b.branchName, true),
        fullBranchName: fmtBranchLabel(b.branchId, b.branchName),
        posPoints: b.posPoints,
        sbPoints: b.sbPoints,
        khqrPoints: b.khqrPoints,
        ccPoints: b.ccPoints,
        totalPoints: b.totalPoints,
        staffCount: b.staffCount,
        totalTasks: b.totalTasks,
      })),
    [filteredBranches]
  );

  return (
    <div className="flex flex-col gap-3.5 apple-tab-panel" aria-label="KPI Performance">
      {/* ───────────── 1. HERO HEADER & 6 BIG KPI CARDS (Push Configuring Hub Backdrop Style) ───────────── */}
      <section
        className="relative overflow-hidden rounded-2xl p-5 sm:p-6 lg:p-7 border shadow-2xs bg-slate-100 border-slate-200/90 text-slate-900"
        aria-label="KPI Performance statistics"
      >
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5 max-w-3xl">
            <h1 className="text-xl sm:text-2xl lg:text-[26px] font-extrabold tracking-tight flex items-center gap-2.5 text-slate-900 leading-tight">
              <BarChart3 className="w-6 h-6 sm:w-7 sm:h-7 shrink-0 text-[#003857]" aria-hidden />
              <span>KPI Performance <span className="text-slate-600 font-medium text-base sm:text-lg lg:text-xl">· Branch &amp; Staff Analytics</span></span>
            </h1>
            <p className="text-xs sm:text-sm leading-relaxed text-slate-600">
              Live institutional performance tracking across field installations, KHQR merchant onboarding, and credit card acquisitions.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <select
              aria-label="Period"
              value={period}
              onChange={(e) => setPeriod(e.target.value as KpiPeriod)}
              className="btn-press px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold border bg-white hover:bg-slate-50 text-slate-800 border-slate-200/90 shadow-2xs outline-none focus:border-slate-400 cursor-pointer"
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
          <BigKpiCard
            label="Total KPI Points"
            value={fmtPts(totals.totalPoints)}
            sub={`Avg ${fmtPts(totals.avgBranchPts)} pts / branch`}
            icon={Trophy}
            accentColor="blue"
            badge={KPI_PERIOD_LABEL[period]}
            onClick={() => setView('all')}
            active={view === 'all'}
          />
          <BigKpiCard
            label="Active Branches"
            value={fmtInt(totals.activeBranchCount)}
            sub="Phnom Penh & Provinces"
            icon={Building2}
            accentColor="amber"
            badge={`${totals.branchesOnTarget} on target`}
            onClick={() => { setView('all'); setTableMode('branch'); }}
            active={view === 'branches' || (view === 'all' && tableMode === 'branch')}
          />
          <BigKpiCard
            label="Active Staff"
            value={fmtInt(totals.activeStaffCount)}
            sub={`Avg ${fmtPts(totals.avgStaffPts)} pts / staff`}
            icon={Users}
            accentColor="violet"
            badge={`${totals.staffOnTarget} on target`}
            onClick={() => { setView('all'); setTableMode('staff'); }}
            active={view === 'staff' || (view === 'all' && tableMode === 'staff')}
          />
          <BigKpiCard
            label="Leading Branch"
            value={totals.topBranch ? `${fmtPts(totals.topBranch.totalPoints)} pts` : '—'}
            sub={totals.topBranch ? fmtBranchLabel(totals.topBranch.branchId, totals.topBranch.branchName, true) : 'No branch activity'}
            icon={Award}
            accentColor="emerald"
            badge={totals.topBranch ? `${totals.topBranch.staffCount} staff` : undefined}
            onClick={() => { setView('all'); setTableMode('branch'); }}
            active={false}
          />
          <BigKpiCard
            label="Top Performer"
            value={totals.topStaff ? `${fmtPts(totals.topStaff.totalPoints)} pts` : '—'}
            sub={totals.topStaff ? `${totals.topStaff.staffName} (${totals.topStaff.staffId})` : 'No staff activity'}
            icon={Award}
            accentColor="blue"
            badge={totals.topStaff ? cleanBranchName(totals.topStaff.branchName) : undefined}
            onClick={() => setView('top10')}
            active={view === 'top10'}
          />
          <BigKpiCard
            label="Quality Rate"
            value={`${totals.qualityPct}%`}
            sub="First-time right submissions"
            icon={ShieldCheck}
            accentColor="emerald"
            badge={`${(data?.rules || []).filter((r) => r.active).length} rules`}
            onClick={() => setView('rules')}
            active={view === 'rules'}
          />
        </div>
      </section>

      {/* ───────────── Navigation & Filter Bar ───────────── */}
      <section className="bg-white rounded-2xl border border-slate-200/90 px-3.5 py-2.5 shadow-2xs" aria-label="KPI Navigation and Filters">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex flex-wrap items-center p-1 rounded-xl bg-slate-100 border border-slate-200/90 gap-0.5" role="tablist" aria-label="KPI Views">
            {navTabs.map((t) => {
              const active = view === t.id;
              const Icon = t.Icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setView(t.id);
                    if (t.id === 'branches') setTableMode('branch');
                    if (t.id === 'staff') setTableMode('staff');
                  }}
                  className={`relative px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors duration-150 inline-flex items-center gap-1.5 ${
                    active ? 'text-white font-semibold' : 'text-slate-700 hover:text-slate-900 font-medium'
                  }`}
                >
                  {active && <motion.div layoutId="kpi-view-pill" className="absolute inset-0 rounded-lg bg-[#1e5b88] shadow-2xs" transition={SPRING} />}
                  <Icon className="w-3.5 h-3.5 relative z-10" aria-hidden />
                  <span className="relative z-10">{t.label}</span>
                  {t.count !== undefined && (
                    <span className={`relative z-10 font-figure tabular-nums text-[10px] px-1.5 py-0.5 rounded-full leading-none ${active ? 'bg-white/20 text-white' : 'bg-white text-slate-700 border border-slate-200/80 font-medium'}`}>
                      {t.count.toLocaleString()}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {view !== 'rules' && (
            <div className="flex flex-wrap items-center gap-1.5 flex-1 justify-end min-w-[280px]">
              <select
                aria-label="Region filter"
                value={regionFilter}
                onChange={(e) => setRegionFilter(e.target.value as 'ALL' | 'PP' | 'PROV')}
                className="text-xs rounded-xl border border-slate-200/90 bg-slate-50/70 hover:bg-white px-2.5 py-1.5 cursor-pointer text-slate-800 font-medium outline-none focus:border-slate-400 transition"
              >
                <option value="ALL">All regions</option>
                <option value="PP">Phnom Penh</option>
                <option value="PROV">Provinces</option>
              </select>

              <select
                aria-label="Branch filter"
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="text-xs rounded-xl border border-slate-200/90 bg-slate-50/70 hover:bg-white px-2.5 py-1.5 cursor-pointer max-w-[175px] text-slate-800 font-medium outline-none focus:border-slate-400 transition"
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
                className="text-xs rounded-xl border border-slate-200/90 bg-slate-50/70 hover:bg-white px-2.5 py-1.5 cursor-pointer text-slate-800 font-medium outline-none focus:border-slate-400 transition"
              >
                <option value="ALL">All KPI types</option>
                <option value="POS Terminal">POS Terminal</option>
                <option value="Sound Box">Sound Box</option>
                <option value="KHQR">KHQR</option>
                <option value="Credit Card">Credit Card</option>
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
          )}
        </div>
      </section>

      {/* ───────────── Executive Graphs & Charts (Push Configuring Hub Backdrop Style) ───────────── */}
      {showSection('all') && (
        <section
          className="relative overflow-hidden rounded-2xl p-4 border shadow-2xs bg-slate-100 border-slate-200/90 text-slate-900"
          aria-label="Executive KPI Charts"
        >
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
            {/* Chart 1 (7 cols): Interactive Daily / Weekly / Monthly / Quarterly Stacked Point Trend */}
            <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden flex flex-col justify-between">
              <div className="px-4 py-2.5 border-b border-slate-200/90 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-[#1e5b88] shrink-0" aria-hidden />
                  <h3 className="text-[13px] font-semibold text-slate-900">KPI Point Velocity &amp; Active Staff</h3>
                  <span className="text-[12px] text-slate-600 font-medium">· weighted points &amp; participation</span>
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
                            className="absolute inset-0 rounded-lg bg-[#1e5b88] shadow-2xs"
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
                    <Cpu className="w-3.5 h-3.5 text-sky-600" aria-hidden />
                    <span>POS Terminal</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5 text-[#1e5b88]" aria-hidden />
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
                  <span className="inline-flex items-center gap-1.5 ml-auto text-slate-600 font-medium">
                    <span className="w-3.5 h-0.5 bg-[#1e5b88] rounded-full inline-block" />
                    <Users className="w-3.5 h-3.5 text-[#1e5b88]" aria-hidden />
                    <span>Active staff (right axis)</span>
                  </span>
                </div>

                <div className="h-[264px] w-full">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={granularity}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={CHART_TRANSITION}
                      className="w-full h-full"
                    >
                      {reversedTimeSeries.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-xs text-slate-400">
                          No trend data available for this granularity.
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={reversedTimeSeries} margin={{ top: 8, right: 6, left: -14, bottom: 0 }} barGap={4}>
                            <defs>
                              <linearGradient id="kpiPosGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#38bdf8" />
                                <stop offset="100%" stopColor="#0ea5e9" />
                              </linearGradient>
                              <linearGradient id="kpiSbGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#2e77ad" />
                                <stop offset="50%" stopColor="#1e5b88" />
                                <stop offset="100%" stopColor="#15466b" />
                              </linearGradient>
                              <linearGradient id="kpiKhqrGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#14b8a6" />
                                <stop offset="100%" stopColor="#0d9488" />
                              </linearGradient>
                              <linearGradient id="kpiCcGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#fbbf24" />
                                <stop offset="100%" stopColor="#f59e0b" />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                            <XAxis
                              dataKey="label"
                              axisLine={{ stroke: '#e2e8f0' }}
                              tickLine={false}
                              tick={{ fontSize: 11, fill: '#64748b' }}
                              dy={4}
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
                            <Tooltip content={<CustomTrendTooltip />} cursor={{ fill: 'rgba(0, 56, 87, 0.04)' }} />
                            <Bar yAxisId="left" dataKey="posPoints" name="POS Terminal" stackId="pts" fill="url(#kpiPosGrad)" stroke="#ffffff" strokeWidth={1} maxBarSize={32} animationDuration={360} animationEasing="ease-out" />
                            <Bar yAxisId="left" dataKey="sbPoints" name="Sound Box" stackId="pts" fill="url(#kpiSbGrad)" stroke="#ffffff" strokeWidth={1} maxBarSize={32} animationDuration={360} animationEasing="ease-out" />
                            <Bar yAxisId="left" dataKey="khqrPoints" name="KHQR" stackId="pts" fill="url(#kpiKhqrGrad)" stroke="#ffffff" strokeWidth={1} maxBarSize={32} animationDuration={360} animationEasing="ease-out" />
                            <Bar yAxisId="left" dataKey="ccPoints" name="Credit Card" stackId="pts" fill="url(#kpiCcGrad)" stroke="#ffffff" strokeWidth={1} maxBarSize={32} animationDuration={360} animationEasing="ease-out" />
                            <Line
                              yAxisId="right"
                              type="monotone"
                              dataKey="activeStaff"
                              name="Active Staff"
                              stroke="#1e5b88"
                              strokeWidth={1.75}
                              dot={{ r: 3, fill: '#ffffff', stroke: '#1e5b88', strokeWidth: 1.75 }}
                              activeDot={{ r: 4.5, fill: '#1e5b88', stroke: '#ffffff', strokeWidth: 2 }}
                              animationDuration={400}
                            />
                          </ComposedChart>
                        </ResponsiveContainer>
                      )}
                    </motion.div>
                  </AnimatePresence>
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
                    <Cpu className="w-3.5 h-3.5 text-sky-600" aria-hidden />
                    <span>POS</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5 text-[#1e5b88]" aria-hidden />
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
                </div>

                <div className="h-[264px] w-full">
                  {topBranchChartData.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-xs text-slate-400">
                      No branch activity matching current filters.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        layout="vertical"
                        data={topBranchChartData}
                        margin={{ top: 4, right: 14, left: 0, bottom: 0 }}
                        barCategoryGap="24%"
                      >
                        <defs>
                          <linearGradient id="kpiBranchPosGrad" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#0ea5e9" />
                            <stop offset="100%" stopColor="#38bdf8" />
                          </linearGradient>
                          <linearGradient id="kpiBranchSbGrad" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#15466b" />
                            <stop offset="50%" stopColor="#1e5b88" />
                            <stop offset="100%" stopColor="#2e77ad" />
                          </linearGradient>
                          <linearGradient id="kpiBranchKhqrGrad" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#0d9488" />
                            <stop offset="100%" stopColor="#14b8a6" />
                          </linearGradient>
                          <linearGradient id="kpiBranchCcGrad" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#f59e0b" />
                            <stop offset="100%" stopColor="#fbbf24" />
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
                          width={148}
                          axisLine={false}
                          tickLine={false}
                          interval={0}
                          tick={<BranchYAxisTick />}
                        />
                        <Tooltip content={<CustomBranchTooltip />} cursor={{ fill: 'rgba(0, 56, 87, 0.04)' }} />
                        <Bar dataKey="posPoints" name="POS Terminal" stackId="b" fill="url(#kpiBranchPosGrad)" stroke="#ffffff" strokeWidth={1} maxBarSize={14} background={{ fill: '#f1f5f9', radius: 4 }} animationDuration={360} />
                        <Bar dataKey="sbPoints" name="Sound Box" stackId="b" fill="url(#kpiBranchSbGrad)" stroke="#ffffff" strokeWidth={1} maxBarSize={14} animationDuration={360} />
                        <Bar dataKey="khqrPoints" name="KHQR" stackId="b" fill="url(#kpiBranchKhqrGrad)" stroke="#ffffff" strokeWidth={1} maxBarSize={14} animationDuration={360} />
                        <Bar dataKey="ccPoints" name="Credit Card" stackId="b" fill="url(#kpiBranchCcGrad)" stroke="#ffffff" strokeWidth={1} maxBarSize={14} animationDuration={360} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ───────────── Most KPI Types Consumed (Push Configuring Hub Backdrop Style) ───────────── */}
      {showSection('all') && (
        <section
          className="relative overflow-hidden rounded-2xl p-4 border shadow-2xs bg-slate-100 border-slate-200/90 text-slate-900"
          aria-label="Most KPI Types Consumed"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Layers className="w-4 h-4 text-[#1e5b88] shrink-0" aria-hidden />
              <h3 className="text-[13px] font-semibold text-slate-900">Most KPI Types Consumed</h3>
              <span className="text-[12px] text-slate-600 font-medium">· click a category to filter tables below</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowSubCategories((v) => !v)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium text-xs border shadow-2xs cursor-pointer bg-white hover:bg-slate-50 text-slate-800 border-slate-200/90 transition"
              >
                <span>{showSubCategories ? 'Hide' : 'Show'} 12 sub-category tasks</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showSubCategories ? 'rotate-180' : ''}`} />
              </button>
              <button
                type="button"
                onClick={() => setView('rules')}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium text-xs shadow-2xs cursor-pointer bg-[#003857] hover:bg-[#002a42] text-white border border-[#002a42] transition"
              >
                <Settings2 className="w-3.5 h-3.5" />
                <span>Point rules</span>
              </button>
            </div>
          </div>

          <div className="mt-3 pt-3 border-t border-slate-200/90">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
              {([
                { cat: 'KHQR' as KpiCategory, tasks: totals.khqrTasks, pts: totals.khqrPoints, extra: `${fmtInt(totals.raw.khqrInstall)} new · ${fmtInt(totals.raw.khqrReplace)} replaced · ${fmtInt(totals.khqrMaterials)} QR items` },
                { cat: 'Sound Box' as KpiCategory, tasks: totals.sbTasks, pts: totals.sbPoints, extra: `${fmtInt(totals.raw.sbInstall)} install · ${fmtInt(totals.raw.sbReplace)} swap · ${fmtInt(totals.raw.sbMaint)} maint` },
                { cat: 'Credit Card' as KpiCategory, tasks: totals.ccTasks, pts: totals.ccPoints, extra: `${fmtInt(totals.raw.ccPrimary)} primary · ${fmtInt(totals.raw.ccSupp)} supplementary` },
                { cat: 'POS Terminal' as KpiCategory, tasks: totals.posTasks, pts: totals.posPoints, extra: `${fmtInt(totals.raw.posInstall)} install · ${fmtInt(totals.raw.posReplace)} swap · ${fmtInt(totals.raw.posBattery)} battery` },
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
                      <span>Sub-category task breakdown (12 tasks)</span>
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

      {/* ───────────── Top 10 Branch and Staff Leaderboard Each Month (Push Configuring Hub Backdrop Style) ───────────── */}
      {(showSection('all') || showSection('top10')) && (
        <section
          className="relative overflow-hidden rounded-2xl p-4 border shadow-2xs bg-slate-100 border-slate-200/90 text-slate-900"
          aria-label="Top 10 Branch and Staff by Month"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Trophy className="w-4 h-4 text-[#1e5b88] shrink-0" aria-hidden />
              <h3 className="text-[13px] font-semibold text-slate-900">Top 10 Branches &amp; Individual Staff</h3>
              <span className="text-[12px] text-slate-600 font-medium">· monthly and all-time leaderboard</span>
            </div>

            <div className="inline-flex flex-wrap items-center gap-0.5 p-0.5 rounded-xl bg-white border border-slate-200/90 shadow-2xs">
              <button
                type="button"
                onClick={() => setSelectedTopMonth('ALL')}
                className={`px-2.5 py-1 rounded-lg text-[11px] cursor-pointer transition ${
                  selectedTopMonth === 'ALL' ? 'bg-[#1e5b88] text-white font-semibold shadow-2xs' : 'text-slate-700 hover:text-slate-900 font-medium'
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
                    selectedTopMonth === m ? 'bg-[#1e5b88] text-white font-semibold shadow-2xs' : 'text-slate-700 hover:text-slate-900 font-medium'
                  }`}
                >
                  {fmtMonth(m)}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 pt-3 border-t border-slate-200/90 grid grid-cols-1 lg:grid-cols-2 gap-3.5">
            {/* Top 10 Branches */}
            <div className="rounded-2xl border border-slate-200/90 bg-white shadow-2xs overflow-hidden">
              <div className="bg-slate-50/90 border-b border-slate-200/90 text-slate-800 px-4 py-2.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider">
                <span className="inline-flex items-center gap-1.5 text-slate-900">
                  <Building2 className="w-3.5 h-3.5 text-[#1e5b88]" />
                  <span>Top 10 Branches · {selectedTopMonth === 'ALL' ? KPI_PERIOD_LABEL[period] : fmtMonth(selectedTopMonth)}</span>
                </span>
                <span className="text-slate-600 font-medium">Mix · Points</span>
              </div>
              <div className="divide-y divide-slate-100 text-[13px] text-slate-700">
                {top10Data.branches.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-400">No branch records in this period.</div>
                ) : (
                  top10Data.branches.map((b, i) => (
                    <div key={b.branchId} className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50/80 transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <RankBadge rank={i + 1} />
                        <div className="min-w-0 leading-snug">
                          <div className="font-semibold text-slate-900 truncate">
                            {fmtBranchLabel(b.branchId, b.branchName)}
                          </div>
                          <div className="text-[11px] font-medium text-slate-600">
                            {b.staffCount} active staff · {fmtPts(b.ptsPerStaff)} pts/staff
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3.5 shrink-0">
                        <MiniMixBar pos={b.posPoints} sb={b.sbPoints} khqr={b.khqrPoints} cc={b.ccPoints} total={b.totalPoints} />
                        <div className="text-right min-w-[78px] tabular-nums leading-snug">
                          <div className="font-figure font-bold text-[#003857]">{fmtPts(b.totalPoints)} pts</div>
                          <div className="text-[11px] font-medium text-slate-600">{fmtInt(b.totalTasks)} tasks</div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Top 10 Individual Staff */}
            <div className="rounded-2xl border border-slate-200/90 bg-white shadow-2xs overflow-hidden">
              <div className="bg-slate-50/90 border-b border-slate-200/90 text-slate-800 px-4 py-2.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider">
                <span className="inline-flex items-center gap-1.5 text-slate-900">
                  <Users className="w-3.5 h-3.5 text-[#1e5b88]" />
                  <span>Top 10 Staff · {selectedTopMonth === 'ALL' ? KPI_PERIOD_LABEL[period] : fmtMonth(selectedTopMonth)}</span>
                </span>
                <span className="text-slate-600 font-medium">Mix · Points</span>
              </div>
              <div className="divide-y divide-slate-100 text-[13px] text-slate-700">
                {top10Data.staff.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-400">No staff records in this period.</div>
                ) : (
                  top10Data.staff.map((s, i) => (
                    <div key={s.staffId} className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50/80 transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <RankBadge rank={i + 1} />
                        <div className="min-w-0 leading-snug">
                          <div className="font-semibold text-slate-900 truncate">
                            {s.staffName} <span className="font-normal font-mono text-slate-500 text-xs">({s.staffId})</span>
                          </div>
                          <div className="text-[11px] font-medium text-slate-600 truncate">
                            {fmtBranchLabel(s.branchId, s.branchName)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3.5 shrink-0">
                        <MiniMixBar pos={s.posPoints} sb={s.sbPoints} khqr={s.khqrPoints} cc={s.ccPoints} total={s.totalPoints} />
                        <div className="text-right min-w-[78px] tabular-nums leading-snug">
                          <div className="font-figure font-bold text-[#003857]">{fmtPts(s.totalPoints)} pts</div>
                          <div className="text-[11px] font-medium text-slate-600">{fmtInt(s.totalTasks)} tasks</div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ───────────── Overall Performance Breakdown by Daily, Weekly, Monthly & Quarterly ───────────── */}
      {(showSection('all') || showSection('timeline')) && (
        <section className="fr-table-frame bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-x-auto" aria-label="Overall Performance by Period">
          <div className="px-4 py-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Calendar className="w-4 h-4 text-[#1e5b88] shrink-0" aria-hidden />
              <h3 className="text-[13px] font-semibold text-slate-900">Overall Performance Timeline</h3>
              <span className="text-[12px] text-slate-600 font-medium">
                · {granularity === 'daily' ? 'daily (last 30 days)' : granularity === 'weekly' ? 'weekly (last 12 weeks)' : granularity === 'quarterly' ? 'quarterly (last 8 quarters)' : 'monthly (last 12 months)'}
              </span>
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
                  className={`px-2.5 py-1 rounded-lg cursor-pointer transition ${
                    granularity === g ? 'bg-[#1e5b88] text-white font-semibold shadow-2xs' : 'text-slate-700 hover:text-slate-900 font-medium'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="min-w-[980px] w-full">
            <div className="grid items-center gap-x-4 grid-cols-[minmax(115px,1.25fr)_minmax(72px,0.8fr)_minmax(68px,0.75fr)_minmax(110px,1.15fr)_minmax(110px,1.15fr)_minmax(124px,1.25fr)_minmax(110px,1.15fr)_minmax(76px,0.85fr)_minmax(80px,0.9fr)_minmax(105px,1.1fr)_minmax(80px,0.9fr)] glass-table-thead navy-header-bar bg-[#003857] text-white text-[11px] font-semibold uppercase tracking-wider px-4 py-2.5">
              <SortableHeader label="Period" sortKey="period" activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} icon={Calendar} />
              <SortableHeader label="Branches" sortKey="activeBranches" activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" />
              <SortableHeader label="Staff" sortKey="activeStaff" activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" />
              <SortableHeader label="POS (Tasks/Pts)" sortKey="posPoints" activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" icon={Cpu} />
              <SortableHeader label="SB (Tasks/Pts)" sortKey="sbPoints" activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" icon={Volume2} />
              <SortableHeader label="KHQR (Tasks/Pts)" sortKey="khqrPoints" activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" icon={QrCode} />
              <SortableHeader label="CC (Cards/Pts)" sortKey="ccPoints" activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" icon={CreditCard} />
              <SortableHeader label="Tasks" sortKey="totalTasks" activeKey={timelineSortKey} dir={timelineSortDir} onSort={(k) => { setTimelineSortKey(k); setTimelineSortDir((d) => (timelineSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" />
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
                    className="grid items-center gap-x-4 grid-cols-[minmax(115px,1.25fr)_minmax(72px,0.8fr)_minmax(68px,0.75fr)_minmax(110px,1.15fr)_minmax(110px,1.15fr)_minmax(124px,1.25fr)_minmax(110px,1.15fr)_minmax(76px,0.85fr)_minmax(80px,0.9fr)_minmax(105px,1.1fr)_minmax(80px,0.9fr)] px-4 py-2.5 text-[13px] text-slate-700 hover:bg-slate-50/80 transition-colors"
                  >
                    <span className="font-semibold text-slate-900 tabular-nums">{t.label}</span>
                    <span className="text-right tabular-nums font-medium text-slate-800">{fmtInt(t.activeBranches)}</span>
                    <span className="text-right tabular-nums font-medium text-slate-800">{fmtInt(t.activeStaff)}</span>
                    <span className="text-right tabular-nums"><TaskPtsCell tasks={t.posTasks} pts={t.posPoints} /></span>
                    <span className="text-right tabular-nums"><TaskPtsCell tasks={t.sbTasks} pts={t.sbPoints} /></span>
                    <span className="text-right tabular-nums"><TaskPtsCell tasks={t.khqrTasks} pts={t.khqrPoints} /></span>
                    <span className="text-right tabular-nums"><TaskPtsCell tasks={t.ccTasks} pts={t.ccPoints} /></span>
                    <span className="text-right tabular-nums font-medium text-slate-800">{fmtInt(t.totalTasks)}</span>
                    <span className="text-right tabular-nums font-medium text-slate-800">{fmtPts(t.ptsPerStaff)}</span>
                    <span className="text-right tabular-nums font-figure font-bold text-[#003857]">{fmtPts(t.totalPoints)} pts</span>
                    <span className="text-right tabular-nums">
                      {t.growthPct === null ? (
                        <span className="text-xs text-slate-400 font-light">—</span>
                      ) : (
                        <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${t.growthPct >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
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
        </section>
      )}

      {/* ───────────── KPI Performance by Branch & Staff (Switchable Combined Table) ───────────── */}
      {(showSection('all') || showSection('branches') || showSection('staff')) && (
        <section className="fr-table-frame bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-x-auto" aria-label="KPI Performance Table">
          <div className="px-4 py-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex p-0.5 rounded-xl bg-slate-100 border border-slate-200/90 gap-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setTableMode('branch')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${
                    tableMode === 'branch' ? 'bg-[#1e5b88] text-white shadow-2xs' : 'text-slate-700 hover:text-slate-900 font-medium'
                  }`}
                >
                  <Building2 className="w-3.5 h-3.5" aria-hidden />
                  <span>KPI by Branch</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-figure tabular-nums ${tableMode === 'branch' ? 'bg-white/20 text-white' : 'bg-white text-slate-700 border border-slate-200/80 font-medium'}`}>
                    {filteredBranches.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setTableMode('staff')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${
                    tableMode === 'staff' ? 'bg-[#1e5b88] text-white shadow-2xs' : 'text-slate-700 hover:text-slate-900 font-medium'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" aria-hidden />
                  <span>KPI by Staff</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-figure tabular-nums ${tableMode === 'staff' ? 'bg-white/20 text-white' : 'bg-white text-slate-700 border border-slate-200/80 font-medium'}`}>
                    {filteredStaff.length}
                  </span>
                </button>
              </div>

              <span className="text-xs font-medium text-slate-600 hidden sm:inline">
                {tableMode === 'branch'
                  ? `· ${filteredBranches.length} branches · ${activeTargets.label}: ${fmtPts(activeTargets.branch)} pts`
                  : `· ${filteredStaff.length} staff · ${activeTargets.label}: ${fmtPts(activeTargets.staff)} pts`}
              </span>
            </div>

            <ExportCsvButton
              onExport={tableMode === 'branch' ? exportBranchCsv : exportStaffCsv}
              toast={triggerToast}
              title={`Export KPI Performance by ${tableMode === 'branch' ? 'Branch' : 'Staff'} to CSV`}
            />
          </div>

          {tableMode === 'branch' ? (
            <>
              <div className="min-w-[1180px] w-full">
                <div className="grid items-center gap-x-4 grid-cols-[40px_75px_minmax(160px,1.4fr)_minmax(55px,0.55fr)_minmax(104px,1fr)_minmax(104px,1fr)_minmax(114px,1.1fr)_minmax(104px,1fr)_minmax(72px,0.7fr)_minmax(72px,0.7fr)_minmax(96px,0.95fr)_minmax(105px,1fr)_120px_24px] glass-table-thead navy-header-bar bg-[#003857] text-white text-[11px] font-semibold uppercase tracking-wider px-4 py-2.5">
                  <span className="text-right">No.</span>
                  <SortableHeader label="Code" sortKey="branchId" activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} />
                  <SortableHeader label="Branch Name" sortKey="branchName" activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} icon={Building2} />
                  <SortableHeader label="Staff" sortKey="staffCount" activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" />
                  <SortableHeader label="POS (Tasks/Pts)" sortKey="posPoints" activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" icon={Cpu} />
                  <SortableHeader label="SB (Tasks/Pts)" sortKey="sbPoints" activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" icon={Volume2} />
                  <SortableHeader label="KHQR (Tasks/Pts)" sortKey="khqrPoints" activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" icon={QrCode} />
                  <SortableHeader label="CC (Cards/Pts)" sortKey="ccPoints" activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" icon={CreditCard} />
                  <SortableHeader label="Pts/Staff" sortKey="ptsPerStaff" activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" title="Average KPI points per active staff member in the branch" />
                  <SortableHeader label="Total Tasks" sortKey="totalTasks" activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" />
                  <SortableHeader label="Total Points" sortKey="totalPoints" activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" />
                  <SortableHeader label={activeTargets.label} sortKey="targetPct" activeKey={branchSortKey} dir={branchSortDir} onSort={(k) => { setBranchSortKey(k); setBranchSortDir((d) => (branchSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} />
                  <span>Rating</span>
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
                            className="grid items-center gap-x-4 grid-cols-[40px_75px_minmax(160px,1.4fr)_minmax(55px,0.55fr)_minmax(104px,1fr)_minmax(104px,1fr)_minmax(114px,1.1fr)_minmax(104px,1fr)_minmax(72px,0.7fr)_minmax(72px,0.7fr)_minmax(96px,0.95fr)_minmax(105px,1fr)_120px_24px] w-full text-left px-4 py-2.5 text-[13px] text-slate-700 cursor-pointer"
                          >
                            <span className="text-right tabular-nums text-slate-500 font-medium">{rank}</span>
                            <span className="font-mono text-xs font-semibold text-slate-700 tabular-nums">
                              {b.branchId}
                            </span>
                            <span className="flex items-center gap-2 min-w-0">
                              <span className="w-6 h-6 rounded-md bg-slate-100 text-[#1e5b88] border border-slate-200/80 flex items-center justify-center shrink-0">
                                <Building2 className="w-3.5 h-3.5" aria-hidden />
                              </span>
                              <span className="block font-semibold text-slate-900 truncate">
                                {cleanBranchName(b.branchName)}
                              </span>
                            </span>
                            <span className="text-right tabular-nums font-medium text-slate-800">{b.staffCount}</span>
                            <span className="text-right tabular-nums"><TaskPtsCell tasks={b.posTasks} pts={b.posPoints} /></span>
                            <span className="text-right tabular-nums"><TaskPtsCell tasks={b.sbTasks} pts={b.sbPoints} /></span>
                            <span className="text-right tabular-nums"><TaskPtsCell tasks={b.khqrTasks} pts={b.khqrPoints} /></span>
                            <span className="text-right tabular-nums"><TaskPtsCell tasks={b.ccTasks} pts={b.ccPoints} /></span>
                            <span className="text-right tabular-nums font-medium text-slate-800">{fmtPts(b.ptsPerStaff)}</span>
                            <span className="text-right tabular-nums font-medium text-slate-800">{fmtInt(b.totalTasks)}</span>
                            <span className="text-right tabular-nums font-figure font-bold text-[#003857]">{fmtPts(b.totalPoints)} pts</span>
                            <span><TargetBar pct={b.targetPct} /></span>
                            <span><RatingBadge rating={b.rating} /></span>
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
                                    Staff contributors in {b.branchName} ({b.staffList.length})
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
              <Pager pg={branchPg} label="branches" />
            </>
          ) : (
            <>
              <div className="min-w-[1180px] w-full">
                <div className="grid items-center gap-x-4 grid-cols-[40px_minmax(170px,1.3fr)_75px_minmax(140px,1.1fr)_minmax(104px,1fr)_minmax(104px,1fr)_minmax(114px,1.1fr)_minmax(104px,1fr)_minmax(64px,0.6fr)_minmax(68px,0.65fr)_minmax(92px,0.9fr)_minmax(105px,1fr)_120px_24px] glass-table-thead navy-header-bar bg-[#003857] text-white text-[11px] font-semibold uppercase tracking-wider px-4 py-2.5">
                  <span className="text-right">No.</span>
                  <SortableHeader label="Staff Name" sortKey="staffName" activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} icon={Users} />
                  <SortableHeader label="Branch Code" sortKey="branchId" activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} />
                  <SortableHeader label="Branch Name" sortKey="branchName" activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} icon={Building2} />
                  <SortableHeader label="POS (Tasks/Pts)" sortKey="posPoints" activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" icon={Cpu} />
                  <SortableHeader label="SB (Tasks/Pts)" sortKey="sbPoints" activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" icon={Volume2} />
                  <SortableHeader label="KHQR (Tasks/Pts)" sortKey="khqrPoints" activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" icon={QrCode} />
                  <SortableHeader label="CC (Cards/Pts)" sortKey="ccPoints" activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" icon={CreditCard} />
                  <SortableHeader label="Quality" sortKey="qualityPct" activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" />
                  <SortableHeader label="Total Tasks" sortKey="totalTasks" activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" />
                  <SortableHeader label="Total Points" sortKey="totalPoints" activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} align="right" />
                  <SortableHeader label={activeTargets.label} sortKey="targetPct" activeKey={staffSortKey} dir={staffSortDir} onSort={(k) => { setStaffSortKey(k); setStaffSortDir((d) => (staffSortKey === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc')); }} />
                  <span>Rating</span>
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
                            className="grid items-center gap-x-4 grid-cols-[40px_minmax(170px,1.3fr)_75px_minmax(140px,1.1fr)_minmax(104px,1fr)_minmax(104px,1fr)_minmax(114px,1.1fr)_minmax(104px,1fr)_minmax(64px,0.6fr)_minmax(68px,0.65fr)_minmax(92px,0.9fr)_minmax(105px,1fr)_120px_24px] w-full text-left px-4 py-2.5 text-[13px] text-slate-700 cursor-pointer"
                          >
                            <span className="text-right tabular-nums text-slate-500 font-medium">{rank}</span>
                            <span className="flex items-center gap-2.5 min-w-0">
                              <span className="w-7 h-7 rounded-lg bg-slate-100 text-[#1e5b88] border border-slate-200/80 flex items-center justify-center shrink-0">
                                <Users className="w-3.5 h-3.5" aria-hidden />
                              </span>
                              <span className="min-w-0 leading-snug">
                                <span className="block font-semibold text-slate-900 truncate">{s.staffName}</span>
                                <span className="block text-[11px] font-mono text-slate-500">ID: {s.staffId}</span>
                              </span>
                            </span>
                            <span className="font-mono text-xs font-semibold text-slate-700 tabular-nums">
                              {s.branchId}
                            </span>
                            <span className="block truncate font-medium text-slate-800">
                              {cleanBranchName(s.branchName)}
                            </span>
                            <span className="text-right tabular-nums"><TaskPtsCell tasks={s.posTasks} pts={s.posPoints} /></span>
                            <span className="text-right tabular-nums"><TaskPtsCell tasks={s.sbTasks} pts={s.sbPoints} /></span>
                            <span className="text-right tabular-nums"><TaskPtsCell tasks={s.khqrTasks} pts={s.khqrPoints} /></span>
                            <span className="text-right tabular-nums"><TaskPtsCell tasks={s.ccTasks} pts={s.ccPoints} /></span>
                            <span className="text-right tabular-nums">
                              <span className={`px-1.5 py-0.5 rounded font-semibold text-[11px] border ${s.qualityPct >= 95 ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : s.qualityPct >= 80 ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
                                {s.qualityPct}%
                              </span>
                            </span>
                            <span className="text-right tabular-nums font-medium text-slate-800">{fmtInt(s.totalTasks)}</span>
                            <span className="text-right tabular-nums font-figure font-bold text-[#003857]">{fmtPts(s.totalPoints)} pts</span>
                            <span><TargetBar pct={s.targetPct} /></span>
                            <span><RatingBadge rating={s.rating} /></span>
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
              <Pager pg={staffPg} label="staff members" />
            </>
          )}
        </section>
      )}

      {/* ───────────── Management KPI and KPI Point Table (Set by Admin) ───────────── */}
      {(showSection('all') || showSection('rules')) && data && (
        <KpiRulesAdminSection
          isAdmin={isAdmin}
          rules={data.rules}
          targets={data.targets}
          onRuleSaved={(updated) => {
            setData((prev) => {
              if (!prev) return prev;
              const exists = prev.rules.some((r) => r.code === updated.code);
              const nextRules = exists
                ? prev.rules.map((r) => (r.code === updated.code ? updated : r))
                : [...prev.rules, updated].sort((a, b) => a.sortOrder - b.sortOrder);
              return { ...prev, rules: nextRules };
            });
          }}
          onTargetsSaved={(nextTargets) => {
            setData((prev) => (prev ? { ...prev, targets: nextTargets } : prev));
          }}
          toast={triggerToast}
        />
      )}
    </div>
  );
};

/* ───────────── Custom High-Readability Institutional Chart Tooltips & Axis Ticks ───────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BranchYAxisTick: React.FC<any> = ({ y, payload }) => {
  const raw = String(payload?.value || '');
  const match = raw.match(/^(.*)\s+\(([^)]+)\)$/);
  const name = match ? match[1] : raw;
  const code = match ? match[2] : '';
  const displayName = name.length > 18 ? `${name.slice(0, 17)}…` : name;

  return (
    <g transform={`translate(0,${y})`}>
      <text
        x={0}
        y={0}
        dy={3.5}
        textAnchor="start"
        fontSize={11}
        fill="#334155"
      >
        <tspan fill="#0f172a" fontWeight={500}>{displayName}</tspan>
        {code && <tspan fill="#64748b"> ({code})</tspan>}
      </text>
    </g>
  );
};

const TaskPtsCell: React.FC<{ tasks: number; pts: number }> = ({ tasks, pts }) => {
  if (tasks <= 0 && pts <= 0) {
    return <span className="text-slate-400 font-light">—</span>;
  }
  return (
    <span className="inline-flex items-center justify-end gap-1 font-figure tabular-nums">
      <span className="text-slate-700 font-normal">{fmtInt(tasks)}</span>
      <span className="text-slate-400 font-semibold text-[10px]">·</span>
      <span className="font-semibold text-slate-900">{fmtPts(pts)}</span>
    </span>
  );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTrendTooltip: React.FC<any> = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white/98 backdrop-blur-md p-3 shadow-lg text-xs min-w-[238px]">
      <div className="flex items-center justify-between gap-4 pb-1.5 mb-2 border-b border-slate-100">
        <span className="font-medium text-slate-900">{label}</span>
        <span className="font-figure font-semibold text-[#003857] tabular-nums">{fmtPts(row.totalPoints)} pts</span>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 text-slate-600"><span className="w-2 h-2 rounded-xs bg-sky-500" />POS Terminal</span>
          <span className="text-slate-900 tabular-nums">{fmtPts(row.posPoints)} pts <span className="text-slate-400">({row.posTasks})</span></span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 text-slate-600"><span className="w-2 h-2 rounded-xs bg-[#1e5b88]" />Sound Box</span>
          <span className="text-slate-900 tabular-nums">{fmtPts(row.sbPoints)} pts <span className="text-slate-400">({row.sbTasks})</span></span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 text-slate-600"><span className="w-2 h-2 rounded-xs bg-teal-600" />KHQR</span>
          <span className="text-slate-900 tabular-nums">{fmtPts(row.khqrPoints)} pts <span className="text-slate-400">({row.khqrTasks})</span></span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 text-slate-600"><span className="w-2 h-2 rounded-xs bg-amber-500" />Credit Card</span>
          <span className="text-slate-900 tabular-nums">{fmtPts(row.ccPoints)} pts <span className="text-slate-400">({row.ccTasks})</span></span>
        </div>
      </div>
      <div className="mt-2 pt-1.5 border-t border-slate-100 flex items-center justify-between gap-4 text-[11px] text-slate-500">
        <span>{row.activeStaff} active staff · {row.activeBranches} branches</span>
        <span className="text-slate-700 shrink-0">{fmtPts(row.ptsPerStaff)} pts/staff</span>
      </div>
    </div>
  );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomBranchTooltip: React.FC<any> = ({ active, payload }) => {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white/98 backdrop-blur-md p-3 shadow-lg text-xs min-w-[238px]">
      <div className="flex items-center justify-between gap-4 pb-1.5 mb-2 border-b border-slate-100">
        <span className="font-medium text-slate-900 truncate max-w-[155px]">{row.fullBranchName}</span>
        <span className="font-figure font-semibold text-[#003857] tabular-nums">{fmtPts(row.totalPoints)} pts</span>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 text-slate-600"><span className="w-2 h-2 rounded-xs bg-sky-500" />POS Terminal</span>
          <span className="text-slate-900 tabular-nums">{fmtPts(row.posPoints)} pts</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 text-slate-600"><span className="w-2 h-2 rounded-xs bg-[#1e5b88]" />Sound Box</span>
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
      </div>
      <div className="mt-2 pt-1.5 border-t border-slate-100 flex items-center justify-between gap-4 text-[11px] text-slate-500">
        <span>{row.staffCount} active staff</span>
        <span className="shrink-0">{fmtInt(row.totalTasks)} total tasks</span>
      </div>
    </div>
  );
};

/* ───────────── Helper Sub-Components ───────────── */

const BigKpiCard: React.FC<{
  label: string;
  value?: string;
  sub?: string;
  icon: React.ElementType;
  accentColor?: 'blue' | 'emerald' | 'amber' | 'violet';
  badge?: string;
  onClick?: () => void;
  active?: boolean;
}> = ({ label, value, sub, icon: Icon, accentColor = 'blue', badge, onClick, active }) => {
  const theme = {
    blue: {
      iconBg: 'bg-sky-50 text-sky-600 border-sky-100',
      hoverStyle: 'hover:border-sky-300 hover:ring-2 hover:ring-sky-100/80',
    },
    emerald: {
      iconBg: 'bg-emerald-50 text-emerald-600 border-emerald-100',
      hoverStyle: 'hover:border-emerald-300 hover:ring-2 hover:ring-emerald-100/80',
    },
    violet: {
      iconBg: 'bg-violet-50 text-violet-600 border-violet-100',
      hoverStyle: 'hover:border-violet-300 hover:ring-2 hover:ring-violet-100/80',
    },
    amber: {
      iconBg: 'bg-amber-50 text-amber-600 border-amber-100',
      hoverStyle: 'hover:border-amber-300 hover:ring-2 hover:ring-amber-100/80',
    },
  }[accentColor];

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`relative flex flex-col justify-between p-4.5 sm:p-5 rounded-2xl border bg-white shadow-2xs transition-all duration-200 text-left cursor-pointer min-h-[142px] ${theme.hoverStyle} hover:shadow-md hover:-translate-y-0.5 group ${
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
};

const RankBadge: React.FC<{ rank: number }> = ({ rank }) => {
  if (rank === 1) return <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-semibold text-xs tabular-nums shrink-0">1</span>;
  if (rank === 2) return <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 text-slate-700 border border-slate-200 font-semibold text-xs tabular-nums shrink-0">2</span>;
  if (rank === 3) return <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-orange-50 text-orange-700 border border-orange-200 font-semibold text-xs tabular-nums shrink-0">3</span>;
  return <span className="inline-flex items-center justify-center w-6 h-6 text-xs font-medium text-slate-500 tabular-nums shrink-0">{rank}</span>;
};

const MiniMixBar: React.FC<{ pos: number; sb: number; khqr: number; cc: number; total: number }> = ({ pos, sb, khqr, cc, total }) => {
  if (total <= 0) return null;
  const pPos = (pos / total) * 100;
  const pSb = (sb / total) * 100;
  const pKhqr = (khqr / total) * 100;
  const pCc = (cc / total) * 100;
  return (
    <div
      className="w-24 h-2 rounded-full bg-slate-100 overflow-hidden flex gap-[1px]"
      title={`POS: ${fmtPts(pos)} pts · Sound Box: ${fmtPts(sb)} pts · KHQR: ${fmtPts(khqr)} pts · Credit Card: ${fmtPts(cc)} pts`}
    >
      {pPos > 0 && <div className="bg-sky-500 h-full" style={{ width: `${pPos}%` }} />}
      {pSb > 0 && <div className="bg-[#1e5b88] h-full" style={{ width: `${pSb}%` }} />}
      {pKhqr > 0 && <div className="bg-teal-600 h-full" style={{ width: `${pKhqr}%` }} />}
      {pCc > 0 && <div className="bg-amber-500 h-full" style={{ width: `${pCc}%` }} />}
    </div>
  );
};

const SortableHeader: React.FC<{
  label: string;
  sortKey: string;
  activeKey: string;
  dir: 'asc' | 'desc';
  onSort: (key: string) => void;
  align?: 'left' | 'right' | 'center';
  icon?: React.ElementType;
  className?: string;
  title?: string;
}> = ({ label, sortKey, activeKey, dir, onSort, align = 'left', icon: Icon, className = '', title }) => {
  const active = activeKey === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      title={title || `Sort by ${label} (${active ? (dir === 'asc' ? 'ascending' : 'descending') : 'click to sort'})`}
      className={`inline-flex items-center gap-1 cursor-pointer select-none transition-colors group ${
        align === 'right' ? 'justify-end text-right' : align === 'center' ? 'justify-center text-center' : 'justify-start text-left'
      } ${active ? 'text-white font-bold' : 'text-slate-200 hover:text-white'} ${className}`}
    >
      {Icon && <Icon className="w-3 h-3 opacity-80 shrink-0" aria-hidden />}
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

const TargetBar: React.FC<{ pct: number }> = ({ pct }) => {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full bg-[#1e5b88]" style={{ width: `${Math.min(100, Math.max(4, pct))}%` }} />
      </div>
      <span className="text-[11px] font-figure font-semibold tabular-nums text-slate-700 w-9 text-right">{pct}%</span>
    </div>
  );
};

const RatingBadge: React.FC<{ rating: KpiRating }> = ({ rating }) => {
  if (rating === 'Outstanding') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
        <Sun className="w-3 h-3 text-amber-600 shrink-0" aria-hidden />
        <span className="truncate">Outstanding</span>
      </span>
    );
  }
  if (rating === 'Meet Target') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200">
        <CheckSquare className="w-3 h-3 text-emerald-600 shrink-0" aria-hidden />
        <span className="truncate">Meet Target</span>
      </span>
    );
  }
  if (rating === 'Near/Below Target') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-orange-50 text-orange-800 border border-orange-200">
        <Diamond className="w-3 h-3 text-orange-600 shrink-0" aria-hidden />
        <span className="truncate">Near/Below</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-rose-50 text-rose-800 border border-rose-200">
      <X className="w-3 h-3 text-rose-600 shrink-0" aria-hidden />
      <span className="truncate">Needs Impr.</span>
    </span>
  );
};

const SubCategoryMiniGrid: React.FC<{ raw: KpiRawCounts; ruleMap: Map<string, KpiPointRule> }> = ({ raw, ruleMap }) => {
  const cells = [
    { label: 'POS Install', n: raw.posInstall, pts: raw.posInstall * rulePts(ruleMap, 'POS_INSTALL') },
    { label: 'POS Replace', n: raw.posReplace, pts: raw.posReplace * rulePts(ruleMap, 'POS_REPLACE') },
    { label: 'POS Battery', n: raw.posBattery, pts: raw.posBattery * rulePts(ruleMap, 'POS_BATTERY') },
    { label: 'SB Install', n: raw.sbInstall, pts: raw.sbInstall * rulePts(ruleMap, 'SB_INSTALL') },
    { label: 'SB Replace', n: raw.sbReplace, pts: raw.sbReplace * rulePts(ruleMap, 'SB_REPLACE') },
    { label: 'SB Maint', n: raw.sbMaint, pts: raw.sbMaint * rulePts(ruleMap, 'SB_MAINT') },
    { label: 'SB Return', n: raw.sbReturn, pts: raw.sbReturn * rulePts(ruleMap, 'SB_RETURN') },
    { label: 'KHQR Install', n: raw.khqrInstall, pts: raw.khqrInstall * rulePts(ruleMap, 'KHQR_INSTALL') },
    { label: 'KHQR Replace', n: raw.khqrReplace, pts: raw.khqrReplace * rulePts(ruleMap, 'KHQR_REPLACE') },
    { label: 'QR Materials', n: raw.khqrMaterials, pts: raw.khqrMaterials * rulePts(ruleMap, 'KHQR_MATERIAL') },
    { label: 'CC Primary', n: raw.ccPrimary, pts: raw.ccPrimary * rulePts(ruleMap, 'CC_PRIMARY') },
    { label: 'CC Supp.', n: raw.ccSupp, pts: raw.ccSupp * rulePts(ruleMap, 'CC_SUPP') },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
      {cells.map((c) => (
        <div key={c.label} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">{c.label}</div>
          <div className="text-xs text-slate-900 tabular-nums mt-0.5">
            {fmtInt(c.n)} <span className="text-slate-500">({fmtPts(c.pts)} pts)</span>
          </div>
        </div>
      ))}
    </div>
  );
};

/* ───────────── Management KPI Task & Point Table + D/W/M/Q Targets ───────────── */

const KpiRulesAdminSection = memo(function KpiRulesAdminSection({
  isAdmin,
  rules,
  targets,
  onRuleSaved,
  onTargetsSaved,
  toast,
}: {
  isAdmin: boolean;
  rules: KpiPointRule[];
  targets: KpiTargets;
  onRuleSaved: (r: KpiPointRule) => void;
  onTargetsSaved: (t: KpiTargets) => void;
  toast: (m: string) => void;
}) {
  const [catFilter, setCatFilter] = useState<'ALL' | KpiCategory>('ALL');
  const [draftPts, setDraftPts] = useState<Record<string, string>>({});
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newCat, setNewCat] = useState<KpiCategory>('POS Terminal');
  const [newSub, setNewSub] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPts, setNewPts] = useState('5');
  const [newUnit, setNewUnit] = useState('per task');

  const [tForm, setTForm] = useState(targets);
  const [savingTargets, setSavingTargets] = useState(false);
  useEffect(() => { setTForm(targets); }, [targets]);

  const filteredRules = useMemo(
    () => rules.filter((r) => catFilter === 'ALL' || r.category === catFilter),
    [rules, catFilter]
  );

  const saveRule = async (r: KpiPointRule, nextPoints?: number, nextActive?: boolean) => {
    setSavingCode(r.code);
    try {
      const saved = await saveKpiRuleOnServer({
        code: r.code,
        category: r.category,
        subCategory: r.subCategory,
        description: r.description,
        points: nextPoints !== undefined ? nextPoints : r.points,
        unit: r.unit,
        active: nextActive !== undefined ? nextActive : r.active,
        sortOrder: r.sortOrder,
      });
      onRuleSaved(saved);
      toast(`Saved ${saved.subCategory}: ${saved.points} pts (${saved.active ? 'Active' : 'Inactive'})`);
    } catch (e) {
      toast(`Could not save KPI rule: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingCode(null);
    }
  };

  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCode.trim() || !newSub.trim()) {
      toast('Enter both a Task Code and Sub-Category name.');
      return;
    }
    setSavingCode('NEW');
    try {
      const saved = await saveKpiRuleOnServer({
        code: newCode.trim().toUpperCase(),
        category: newCat,
        subCategory: newSub.trim(),
        description: newDesc.trim(),
        points: Math.max(0, Number(newPts) || 0),
        unit: newUnit.trim() || 'per task',
        active: true,
        sortOrder: 200,
      });
      onRuleSaved(saved);
      setShowAdd(false);
      setNewCode('');
      setNewSub('');
      setNewDesc('');
      toast(`Added KPI task "${saved.subCategory}" (${saved.points} pts)`);
    } catch (err) {
      toast(`Could not add KPI task: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingCode(null);
    }
  };

  const handleSaveTargets = async () => {
    setSavingTargets(true);
    try {
      const saved = await saveKpiTargetsOnServer(tForm);
      onTargetsSaved(saved);
      toast('Updated Daily, Weekly, Monthly & Quarterly KPI targets.');
    } catch (err) {
      toast(`Could not save targets: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingTargets(false);
    }
  };

  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden" aria-label="Management KPI and KPI Point Settings">
      <div className="px-4 py-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Settings2 className="w-4 h-4 text-[#1e5b88] shrink-0" aria-hidden />
          <h3 className="text-[13px] font-semibold text-slate-900">Management KPI &amp; KPI Point Matrix</h3>
          <span className="text-[12px] text-slate-600 font-medium">
            · {isAdmin ? 'admin editable point weights & targets' : 'official scoring guide'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl bg-slate-100 p-0.5 border border-slate-200/90 text-[11px] gap-0.5">
            {(['ALL', 'POS Terminal', 'Sound Box', 'KHQR', 'Credit Card'] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCatFilter(c)}
                className={`px-2.5 py-1 rounded-lg cursor-pointer transition ${
                  catFilter === c ? 'bg-[#003857] text-white font-medium shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {c === 'ALL' ? 'All categories' : c}
              </button>
            ))}
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowAdd((s) => !s)}
              className="btn btn-primary text-xs py-1.5 px-3"
            >
              <Plus className="w-3.5 h-3.5" /> Add KPI Task
            </button>
          )}
        </div>
      </div>

      <div className="p-4 flex flex-col gap-3.5">
        {isAdmin && showAdd && (
          <form onSubmit={handleAddRule} className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 items-end">
            <div>
              <label className="block text-[11px] text-slate-600 mb-1">Task Code</label>
              <input
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                placeholder="e.g. POS_TRAINING"
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white font-mono uppercase"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-600 mb-1">Category</label>
              <select
                value={newCat}
                onChange={(e) => setNewCat(e.target.value as KpiCategory)}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white"
              >
                <option value="POS Terminal">POS Terminal</option>
                <option value="Sound Box">Sound Box</option>
                <option value="KHQR">KHQR</option>
                <option value="Credit Card">Credit Card</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-600 mb-1">Sub-Category / Task Name</label>
              <input
                value={newSub}
                onChange={(e) => setNewSub(e.target.value)}
                placeholder="e.g. Merchant Staff Training"
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-600 mb-1">Description / Rule</label>
              <input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="How this task is verified"
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-slate-600 mb-1">KPI Points</label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={newPts}
                  onChange={(e) => setNewPts(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-600 mb-1">Unit</label>
                <input
                  value={newUnit}
                  onChange={(e) => setNewUnit(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="submit" disabled={savingCode === 'NEW'} className="btn btn-primary text-xs py-1.5 px-3 flex-1 justify-center">
                {savingCode === 'NEW' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
              </button>
              <button type="button" onClick={() => setShowAdd(false)} className="btn btn-secondary text-xs py-1.5 px-2.5">Cancel</button>
            </div>
          </form>
        )}

        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-800">
              <Target className="w-4 h-4 text-[#003857]" />
              Daily, Weekly, Monthly &amp; Quarterly Target Points
            </div>
            {isAdmin && (
              <button
                type="button"
                disabled={savingTargets}
                onClick={handleSaveTargets}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#003857] hover:bg-[#002b44] text-white text-xs font-medium cursor-pointer disabled:opacity-50"
              >
                {savingTargets ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save targets
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
            {([
              ['branchDailyTarget', 'Branch · Daily'],
              ['branchWeeklyTarget', 'Branch · Weekly'],
              ['branchMonthlyTarget', 'Branch · Monthly'],
              ['branchQuarterlyTarget', 'Branch · Quarterly'],
              ['staffDailyTarget', 'Staff · Daily'],
              ['staffWeeklyTarget', 'Staff · Weekly'],
              ['staffMonthlyTarget', 'Staff · Monthly'],
              ['staffQuarterlyTarget', 'Staff · Quarterly'],
            ] as const).map(([key, label]) => (
              <div key={key} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
                <label className="block text-[10px] uppercase tracking-wider text-slate-500">{label}</label>
                {isAdmin ? (
                  <input
                    type="number"
                    min="0"
                    step="5"
                    value={tForm[key]}
                    onChange={(e) => setTForm((prev) => ({ ...prev, [key]: Number(e.target.value) || 0 }))}
                    className="w-full mt-0.5 text-xs font-medium text-slate-900 tabular-nums border-b border-transparent focus:border-slate-400 outline-none"
                  />
                ) : (
                  <div className="text-xs font-medium text-slate-900 tabular-nums mt-0.5">{fmtPts(tForm[key])} pts</div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[820px]">
            <thead>
              <tr className="glass-table-thead navy-header-bar bg-[#003857] text-white text-[11px] font-medium uppercase tracking-wider">
                <th className="py-2.5 px-3.5 text-right w-12">No.</th>
                <th className="py-2.5 px-3.5">Category</th>
                <th className="py-2.5 px-3.5">Sub-Category / KPI Task</th>
                <th className="py-2.5 px-3.5">Verification &amp; Source Rule</th>
                <th className="py-2.5 px-3.5">Unit</th>
                <th className="py-2.5 px-3.5 text-right">KPI Point</th>
                <th className="py-2.5 px-3.5 text-center">Status</th>
                {isAdmin && <th className="py-2.5 px-3.5 text-right">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/90 text-[13px] text-slate-700">
              {filteredRules.map((r, i) => {
                const catStyle = CAT_COLORS[r.category] || CAT_COLORS.Other;
                const CatIcon = catStyle.Icon;
                const curDraft = draftPts[r.code] !== undefined ? draftPts[r.code] : String(r.points);
                const changed = Number(curDraft) !== r.points && !isNaN(Number(curDraft));
                const busy = savingCode === r.code;
                return (
                  <tr key={r.code} className={`hover:bg-slate-50/70 ${!r.active ? 'opacity-60' : ''}`}>
                    <td className="py-2.5 px-3.5 text-right tabular-nums text-slate-500">{i + 1}</td>
                    <td className="py-2.5 px-3.5">
                      <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-lg border ${catStyle.badge}`}>
                        <CatIcon className="w-3.5 h-3.5" /> {r.category}
                      </span>
                    </td>
                    <td className="py-2.5 px-3.5 leading-tight">
                      <div className="text-slate-900">{r.subCategory}</div>
                      <div className="text-[11px] font-mono text-slate-500">{r.code}</div>
                    </td>
                    <td className="py-2.5 px-3.5 text-xs text-slate-600">
                      <span className="inline-flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        {r.description || 'Verified system record'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3.5 text-xs text-slate-500">{r.unit}</td>
                    <td className="py-2.5 px-3.5 text-right">
                      {isAdmin ? (
                        <div className="inline-flex items-center justify-end gap-1">
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            max="10000"
                            aria-label={`Points for ${r.subCategory}`}
                            value={curDraft}
                            onChange={(e) => setDraftPts((prev) => ({ ...prev, [r.code]: e.target.value }))}
                            className="w-20 px-2 py-1 text-right font-figure font-medium text-slate-900 rounded-lg border border-slate-200 bg-white tabular-nums"
                          />
                          <span className="text-xs text-slate-500">pts</span>
                        </div>
                      ) : (
                        <span className="font-figure font-medium text-slate-900 tabular-nums">{fmtPts(r.points)} pts</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3.5 text-center">
                      {isAdmin ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => saveRule(r, undefined, !r.active)}
                          className={`px-2.5 py-0.5 rounded-full text-[11px] border cursor-pointer ${
                            r.active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}
                        >
                          {r.active ? 'Active' : 'Inactive'}
                        </button>
                      ) : (
                        <span className={`px-2.5 py-0.5 rounded-full text-[11px] border ${
                          r.active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}>
                          {r.active ? 'Active' : 'Inactive'}
                        </span>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="py-2.5 px-3.5 text-right">
                        <button
                          type="button"
                          disabled={busy || !changed}
                          onClick={() => saveRule(r, Math.max(0, Number(curDraft) || 0))}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs cursor-pointer transition ${
                            changed ? 'bg-[#003857] text-white hover:bg-[#002b44]' : 'bg-slate-100 text-slate-400 cursor-default'
                          }`}
                        >
                          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />} Save
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
});

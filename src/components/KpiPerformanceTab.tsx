import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Trophy, BarChart3, Building2, Users, Calendar, Layers, Award, Settings2, Search, RefreshCw, Loader2,
  ChevronDown, CheckCircle2, Cpu, Volume2, QrCode, CreditCard, Plus, Save, TrendingUp, TrendingDown, Target, Sparkles, ShieldCheck,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ComposedChart, Line,
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

type KpiView = 'all' | 'branches' | 'staff' | 'timeline' | 'top10' | 'rules';
type Granularity = 'daily' | 'weekly' | 'monthly' | 'quarterly';

const VIEW_TABS: { id: KpiView; label: string; Icon: React.ElementType }[] = [
  { id: 'all', label: 'Executive Overview (All 6)', Icon: BarChart3 },
  { id: 'branches', label: '1. By Branch', Icon: Building2 },
  { id: 'staff', label: '2. By Individual', Icon: Users },
  { id: 'timeline', label: '3. D / W / M / Q Trends', Icon: Calendar },
  { id: 'top10', label: '5. Top 10 Monthly', Icon: Trophy },
  { id: 'rules', label: 'KPI Point Settings', Icon: Settings2 },
];

const CAT_COLORS: Record<KpiCategory, { hex: string; badge: string; bar: string; Icon: React.ElementType }> = {
  'POS Terminal': { hex: '#0284c7', badge: 'bg-sky-50 text-sky-700 border-sky-200', bar: 'bg-sky-500', Icon: Cpu },
  'Sound Box': { hex: '#7c3aed', badge: 'bg-violet-50 text-violet-700 border-violet-200', bar: 'bg-violet-500', Icon: Volume2 },
  KHQR: { hex: '#059669', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', bar: 'bg-emerald-500', Icon: QrCode },
  'Credit Card': { hex: '#d97706', badge: 'bg-amber-50 text-amber-700 border-amber-200', bar: 'bg-amber-500', Icon: CreditCard },
  Other: { hex: '#64748b', badge: 'bg-slate-100 text-slate-700 border-slate-200', bar: 'bg-slate-500', Icon: Layers },
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

const fmtPts = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
const fmtInt = (n: number) => n.toLocaleString('en-US');

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
  const [granularity, setGranularity] = useState<Granularity>('monthly');
  const [regionFilter, setRegionFilter] = useState<'ALL' | 'PP' | 'PROV'>('ALL');
  const [branchFilter, setBranchFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | KpiCategory>('ALL');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [selectedTopMonth, setSelectedTopMonth] = useState<string>('ALL');
  const [openBranch, setOpenBranch] = useState<string | null>(null);
  const [openStaff, setOpenStaff] = useState<string | null>(null);

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

  // Active target for the selected period kind (Daily / Weekly / Monthly / Quarterly)
  const activeTargets = useMemo(() => {
    const t = data?.targets;
    if (!t) return { branch: 500, staff: 120, label: 'Monthly Target' };
    if (range.targetKind === 'daily') return { branch: t.branchDailyTarget, staff: t.staffDailyTarget, label: 'Daily Target' };
    if (range.targetKind === 'weekly') return { branch: t.branchWeeklyTarget, staff: t.staffWeeklyTarget, label: 'Weekly Target' };
    if (range.targetKind === 'quarterly') return { branch: t.branchQuarterlyTarget, staff: t.staffQuarterlyTarget, label: 'Quarterly Target' };
    return { branch: t.branchMonthlyTarget, staff: t.staffMonthlyTarget, label: 'Monthly Target' };
  }, [data?.targets, range.targetKind]);

  // Enrich staff rows with computed points and quality score
  const enrichedStaff = useMemo(() => {
    if (!data) return [];
    return data.staff
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
          targetPct: activeTargets.staff > 0 ? Math.min(999, Math.round((pts.totalPoints / activeTargets.staff) * 100)) : 100,
        };
      })
      .filter((s) => s.totalTasks > 0 || s.posSubmitted > 0 || s.sbSubmitted > 0 || s.ccSubmitted > 0)
      .sort((a, b) => b.totalPoints - a.totalPoints || b.totalTasks - a.totalTasks);
  }, [data, ruleMap, branchNameMap, activeTargets.staff]);

  // Aggregate Branch KPI rows from enrichedStaff
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

    return Array.from(map.values())
      .map((b) => {
        const pts = computeKpiPoints(b.raw, ruleMap);
        const ptsPerStaff = b.staffCount > 0 ? Math.round((pts.totalPoints / b.staffCount) * 10) / 10 : 0;
        const qualityPct = b.totalSubmitted > 0 ? Math.max(0, Math.round(((b.totalSubmitted - b.totalIssues) / b.totalSubmitted) * 100)) : 100;
        const targetPct = activeTargets.branch > 0 ? Math.min(999, Math.round((pts.totalPoints / activeTargets.branch) * 100)) : 100;
        return {
          ...b,
          ...pts,
          ptsPerStaff,
          qualityPct,
          targetPct,
        };
      })
      .sort((a, b) => b.totalPoints - a.totalPoints || b.totalTasks - a.totalTasks);
  }, [enrichedStaff, branchNameMap, ruleMap, activeTargets.branch]);

  // Filtered Branch & Staff lists
  const filteredBranches = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return branchRows.filter((b) => {
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
  }, [branchRows, regionFilter, branchFilter, categoryFilter, deferredQuery]);

  const filteredStaff = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return enrichedStaff.filter((s) => {
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
  }, [enrichedStaff, isAdmin, userBranchId, regionFilter, branchFilter, categoryFilter, deferredQuery]);

  // Overall Totals for the top KPI cards & Section 4 Product Consumption
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
    const branchesOnTarget = filteredBranches.filter((b) => b.totalPoints >= activeTargets.branch).length;
    return {
      raw,
      ...pts,
      activeBranchCount,
      activeStaffCount,
      avgBranchPts,
      avgStaffPts,
      qualityPct,
      branchesOnTarget,
      topBranch: filteredBranches[0] || null,
      topStaff: filteredStaff[0] || null,
    };
  }, [filteredBranches, filteredStaff, ruleMap, activeTargets.branch]);

  // Section 3: Time-series buckets (Daily / Weekly / Monthly / Quarterly) with computed points & MoM/WoW/DoD growth %
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
    return enriched.map((row, idx) => {
      const prev = enriched[idx + 1];
      const growthPct = prev && prev.totalPoints > 0
        ? Math.round(((row.totalPoints - prev.totalPoints) / prev.totalPoints) * 100)
        : null;
      return {
        ...row,
        label: granularity === 'monthly' ? fmtMonth(row.period) : granularity === 'weekly' ? `Wk of ${row.period.slice(5)}` : row.period,
        growthPct,
        ptsPerStaff: row.activeStaff > 0 ? Math.round((row.totalPoints / row.activeStaff) * 10) / 10 : 0,
      };
    });
  }, [data, granularity, ruleMap]);

  // Section 4: 12 Sub-Category Pareto Breakdown
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

  // Section 5: Available months & Top 10 Branches + Top 10 Staff for the selected month
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

  const exportCsv = async () => {
    const pTag = KPI_PERIOD_LABEL[period].replace(/[^A-Za-z0-9]+/g, '_');
    if (view === 'staff') {
      if (!filteredStaff.length) return 0;
      downloadCsv(
        `KPI_Individual_Staff_${pTag}`,
        ['Rank', 'Staff ID', 'Staff Name', 'Branch Code', 'Branch Name', 'POS Install', 'POS Replace', 'POS Battery', 'POS Points',
          'SB Install', 'SB Replace', 'SB Maint', 'SB Return', 'Sound Box Points', 'KHQR Install', 'KHQR Replace', 'QR Materials', 'KHQR Points',
          'CC Primary', 'CC Supplementary', 'Credit Card Points', 'Quality %', 'Total Tasks', 'Total KPI Points', 'Target %'],
        filteredStaff.map((s, i) => [
          i + 1, s.staffId, s.staffName, s.branchId, s.branchName, s.posInstall, s.posReplace, s.posBattery, s.posPoints,
          s.sbInstall, s.sbReplace, s.sbMaint, s.sbReturn, s.sbPoints, s.khqrInstall, s.khqrReplace, s.khqrMaterials, s.khqrPoints,
          s.ccPrimary, s.ccSupp, s.ccPoints, `${s.qualityPct}%`, s.totalTasks, s.totalPoints, `${s.targetPct}%`,
        ])
      );
      return filteredStaff.length;
    }
    if (view === 'timeline') {
      if (!timeSeries.length) return 0;
      downloadCsv(
        `KPI_${granularity.toUpperCase()}_Trend`,
        ['Period', 'Active Branches', 'Active Staff', 'POS Tasks', 'POS Points', 'Sound Box Tasks', 'Sound Box Points',
          'KHQR Tasks', 'QR Materials', 'KHQR Points', 'Credit Card Tasks', 'Credit Card Points', 'Total Tasks', 'Total KPI Points', 'Pts / Staff', 'Growth %'],
        timeSeries.map((t) => [
          t.label, t.activeBranches, t.activeStaff, t.posTasks, t.posPoints, t.sbTasks, t.sbPoints,
          t.khqrTasks, t.khqrMaterials, t.khqrPoints, t.ccTasks, t.ccPoints, t.totalTasks, t.totalPoints, t.ptsPerStaff,
          t.growthPct === null ? '—' : `${t.growthPct > 0 ? '+' : ''}${t.growthPct}%`,
        ])
      );
      return timeSeries.length;
    }
    // Default: Export Branch KPI table
    if (!filteredBranches.length) return 0;
    downloadCsv(
      `KPI_Branch_Performance_${pTag}`,
      ['Rank', 'Branch Code', 'Branch Name', 'Active Staff', 'POS Tasks', 'POS Points', 'Sound Box Tasks', 'Sound Box Points',
        'KHQR Tasks', 'QR Materials', 'KHQR Points', 'Credit Card Tasks', 'Credit Card Points', 'Total Tasks', 'Pts / Staff', 'Total KPI Points', 'Target %'],
      filteredBranches.map((b, i) => [
        i + 1, b.branchId, b.branchName, b.staffCount, b.posTasks, b.posPoints, b.sbTasks, b.sbPoints,
        b.khqrTasks, b.khqrMaterials, b.khqrPoints, b.ccTasks, b.ccPoints, b.totalTasks, b.ptsPerStaff, b.totalPoints, `${b.targetPct}%`,
      ])
    );
    return filteredBranches.length;
  };

  const sortedBranches = useMemo(
    () => [...branches].sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true })),
    [branches]
  );

  const showSection = (sec: KpiView) => view === 'all' || view === sec;

  return (
    <div className="flex flex-col gap-4 apple-tab-panel" aria-label="KPI Performance">
      {/* ───────────── Top Header & Executive Summary Strip ───────────── */}
      <section className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#003857] text-white flex items-center justify-center shadow-xs">
              <Trophy className="w-5 h-5" aria-hidden />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-extrabold tracking-tight text-slate-900">
                  KPI Performance<span className="text-slate-500 font-semibold"> · Branch &amp; Staff Analytics</span>
                </h2>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <Sparkles className="w-3 h-3" /> Live Point Engine
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Unified Daily, Weekly, Monthly &amp; Quarterly KPI scoring across POS Terminal, Sound Box, KHQR, and Credit Card.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Period"
              value={period}
              onChange={(e) => setPeriod(e.target.value as KpiPeriod)}
              className="text-xs font-medium rounded-xl border border-slate-200 bg-white px-3 py-2 cursor-pointer text-slate-800 hover:bg-slate-50"
            >
              {(Object.keys(KPI_PERIOD_LABEL) as KpiPeriod[]).map((p) => (
                <option key={p} value={p}>{KPI_PERIOD_LABEL[p]}</option>
              ))}
            </select>
            <ExportCsvButton onExport={exportCsv} toast={triggerToast} />
            <button
              type="button"
              onClick={load}
              aria-label="Refresh KPI Performance"
              title="Refresh KPI Performance"
              className="btn-press p-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 cursor-pointer transition"
              data-allow-repeat
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {loadError && (
          <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700">
            Could not load KPI summary: {loadError}{' '}
            <button type="button" onClick={load} className="underline font-semibold cursor-pointer">Try again</button>
          </div>
        )}

        {/* 5 Executive Minimalist Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <SummaryCard
            label="Total KPI Points"
            value={fmtPts(totals.totalPoints)}
            sub={`Avg ${fmtPts(totals.avgBranchPts)} pts / branch · ${KPI_PERIOD_LABEL[period]}`}
            Icon={Trophy}
            tone="navy"
            badge={`${ (data?.rules || []).filter((r) => r.active).length } active rules`}
          />
          <SummaryCard
            label="Verified Tasks"
            value={fmtInt(totals.totalTasks)}
            sub={`POS ${fmtInt(totals.posTasks)} · SB ${fmtInt(totals.sbTasks)} · KHQR ${fmtInt(totals.khqrTasks)} · CC ${fmtInt(totals.ccTasks)}`}
            Icon={Layers}
            tone="sky"
            badge={totals.khqrMaterials > 0 ? `+${fmtInt(totals.khqrMaterials)} QR items` : undefined}
          />
          <SummaryCard
            label="Active Branches & Staff"
            value={`${totals.activeBranchCount} / ${totals.activeStaffCount}`}
            sub={`Avg ${fmtPts(totals.avgStaffPts)} pts per active staff`}
            Icon={Users}
            tone="emerald"
            badge={`${totals.branchesOnTarget} on target`}
          />
          <SummaryCard
            label="Top Branch Leader"
            value={totals.topBranch ? `${fmtPts(totals.topBranch.totalPoints)} pts` : '—'}
            sub={totals.topBranch ? `Code ${totals.topBranch.branchId} · ${totals.topBranch.branchName}` : 'No activity in period'}
            Icon={Building2}
            tone="amber"
            onClick={() => setView('branches')}
          />
          <SummaryCard
            label="Top Individual Staff"
            value={totals.topStaff ? `${fmtPts(totals.topStaff.totalPoints)} pts` : '—'}
            sub={totals.topStaff ? `${totals.topStaff.staffName} (${totals.topStaff.staffId}) · ${totals.qualityPct}% quality` : 'No activity in period'}
            Icon={Award}
            tone="violet"
            onClick={() => setView('staff')}
          />
        </div>
      </section>

      {/* ───────────── Navigation & Filter Bar ───────────── */}
      <section className="bg-white rounded-2xl border border-slate-200 px-4 py-3 shadow-2xs" aria-label="KPI Navigation and Filters">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Spring-animated section tabs */}
          <div className="inline-flex flex-wrap items-center p-1 rounded-xl bg-slate-100/90 border border-slate-200/90 gap-1" role="tablist" aria-label="KPI Sections">
            {VIEW_TABS.map((t) => {
              const active = view === t.id;
              const Icon = t.Icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setView(t.id)}
                  className={`relative px-3 py-1.5 rounded-lg text-xs cursor-pointer transition-colors duration-150 inline-flex items-center gap-1.5 ${
                    active ? 'text-white font-semibold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {active && <motion.div layoutId="kpi-view-pill" className="absolute inset-0 rounded-lg tab-active-blue" transition={SPRING} />}
                  <Icon className="w-3.5 h-3.5 relative z-10" aria-hidden />
                  <span className="relative z-10">{t.label}</span>
                </button>
              );
            })}
          </div>

          {/* Filters */}
          {view !== 'rules' && (
            <div className="flex flex-wrap items-center gap-2 flex-1 justify-end min-w-[260px]">
              <select
                aria-label="Region filter"
                value={regionFilter}
                onChange={(e) => setRegionFilter(e.target.value as 'ALL' | 'PP' | 'PROV')}
                className="text-xs rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 cursor-pointer"
              >
                <option value="ALL">All regions</option>
                <option value="PP">Phnom Penh only</option>
                <option value="PROV">Provinces only</option>
              </select>

              <select
                aria-label="Branch filter"
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="text-xs rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 cursor-pointer max-w-[190px]"
              >
                <option value="">All branches</option>
                <option value="100">Code 100 · Head Office</option>
                {sortedBranches.filter((b) => String(b.id) !== '100').map((b) => (
                  <option key={b.id} value={b.id}>Code {b.id} · {b.name}</option>
                ))}
              </select>

              <select
                aria-label="Category filter"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as 'ALL' | KpiCategory)}
                className="text-xs rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 cursor-pointer"
              >
                <option value="ALL">All KPI types</option>
                <option value="POS Terminal">POS Terminal</option>
                <option value="Sound Box">Sound Box</option>
                <option value="KHQR">KHQR</option>
                <option value="Credit Card">Credit Card</option>
              </select>

              <div className="relative min-w-[200px] flex-1 max-w-xs">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
                <input
                  aria-label="Search branch or staff"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search branch, staff ID or name…"
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-white"
                />
              </div>
              <ClearFiltersButton active={filtersActive} onClear={clearAll} />
            </div>
          )}
        </div>
      </section>

      {/* ───────────── SECTION 4: Most KPI Types Consumed (POS, Sound Box, KHQR, Credit Card) ───────────── */}
      {showSection('all') && (
        <section className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs" aria-label="Section 4: Most KPI Types Consumed">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h3 className="text-sm font-extrabold text-slate-900">Section 4 · Most KPI Types Consumed (Volume vs. Weighted Points)</h3>
              <p className="text-xs text-slate-500">
                Comparison of task volume share (%) versus weighted KPI point contribution (%) across all 4 product pillars and 12 sub-categories.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setView('rules')}
              className="text-xs font-semibold text-[#003857] hover:underline inline-flex items-center gap-1 cursor-pointer"
            >
              <Settings2 className="w-3.5 h-3.5" /> Configure Point Weights →
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
            {([
              { cat: 'KHQR' as KpiCategory, tasks: totals.khqrTasks, pts: totals.khqrPoints, extra: `${fmtInt(totals.raw.khqrInstall)} new · ${fmtInt(totals.raw.khqrReplace)} repl · ${fmtInt(totals.khqrMaterials)} QR items` },
              { cat: 'POS Terminal' as KpiCategory, tasks: totals.posTasks, pts: totals.posPoints, extra: `${fmtInt(totals.raw.posInstall)} install · ${fmtInt(totals.raw.posReplace)} swap · ${fmtInt(totals.raw.posBattery)} battery` },
              { cat: 'Sound Box' as KpiCategory, tasks: totals.sbTasks, pts: totals.sbPoints, extra: `${fmtInt(totals.raw.sbInstall)} install · ${fmtInt(totals.raw.sbReplace)} swap · ${fmtInt(totals.raw.sbMaint)} maint` },
              { cat: 'Credit Card' as KpiCategory, tasks: totals.ccTasks, pts: totals.ccPoints, extra: `${fmtInt(totals.raw.ccPrimary)} primary · ${fmtInt(totals.raw.ccSupp)} supplementary` },
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
                  className={`text-left rounded-2xl border p-3.5 transition-all cursor-pointer hover:shadow-sm ${
                    activeFilter ? 'border-[#003857] ring-2 ring-sky-100 bg-slate-50/50' : 'border-slate-200/90 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg border ${style.badge}`}>
                      <Icon className="w-3.5 h-3.5" /> {item.cat}
                    </span>
                    <span className="font-figure text-lg font-extrabold text-slate-900 tabular-nums">{fmtPts(item.pts)} pts</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 my-2 text-xs">
                    <div>
                      <div className="text-[11px] text-slate-500">Task Volume</div>
                      <div className="font-bold text-slate-900 tabular-nums">{fmtInt(item.tasks)} <span className="text-slate-500 font-normal">({volShare}%)</span></div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Point Share</div>
                      <div className="font-bold text-slate-900 tabular-nums">{ptShare}% <span className="text-slate-500 font-normal">of total pts</span></div>
                    </div>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden mb-2">
                    <div className={`h-full rounded-full ${style.bar}`} style={{ width: `${Math.max(3, ptShare)}%` }} />
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">{item.extra}</div>
                </button>
              );
            })}
          </div>

          {/* 12 Sub-Categories Ranked Strip */}
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-50 px-3.5 py-2 border-b border-slate-200 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <span>Sub-Category Consumption Ranking (All 12 KPI Tasks)</span>
              <span>Volume · Unit Weight · Total Points</span>
            </div>
            <div className="divide-y divide-slate-100 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
              {subCategoryBreakdown.map((sc, i) => {
                const pct = totals.totalPoints > 0 ? Math.round((sc.points / totals.totalPoints) * 100) : 0;
                const catStyle = CAT_COLORS[sc.category];
                return (
                  <div key={sc.code} className="px-3.5 py-2.5 flex items-center justify-between gap-3 border-r border-slate-100 last:border-r-0">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-mono text-slate-400">#{i + 1}</span>
                        <span className="text-xs font-semibold text-slate-900 truncate">{sc.label}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                        <span className={`px-1.5 py-0.2 rounded border text-[10px] ${catStyle.badge}`}>{sc.category}</span>
                        <span>{fmtInt(sc.count)} {sc.unit} × {sc.unitPts} pt</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-figure text-xs font-extrabold text-slate-900 tabular-nums">{fmtPts(sc.points)} pts</div>
                      <div className="text-[10px] text-slate-500 tabular-nums">{pct}% share</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ───────────── SECTION 6: Executive Graphs & Charts ───────────── */}
      {showSection('all') && (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4" aria-label="Section 6: Executive Charts">
          {/* Chart 1: Interactive Daily / Weekly / Monthly / Quarterly Stacked Point Trend */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">Section 6A · KPI Points &amp; Active Staff Trend</h3>
                <p className="text-xs text-slate-500">Stacked KPI points by product line + active staff count line</p>
              </div>
              <div className="inline-flex rounded-xl bg-slate-100 p-0.5 border border-slate-200 text-[11px]">
                {(['daily', 'weekly', 'monthly', 'quarterly'] as Granularity[]).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGranularity(g)}
                    className={`px-2.5 py-1 rounded-lg capitalize cursor-pointer transition ${
                      granularity === g ? 'bg-[#003857] text-white font-semibold' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-[270px] w-full">
              {timeSeries.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-slate-400">No trend data for this range.</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={[...timeSeries].reverse()} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#64748b' }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#0f172a' }} />
                    <Tooltip
                      contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="left" dataKey="posPoints" name="POS Pts" stackId="pts" fill="#0284c7" radius={[0, 0, 0, 0]} />
                    <Bar yAxisId="left" dataKey="sbPoints" name="Sound Box Pts" stackId="pts" fill="#7c3aed" />
                    <Bar yAxisId="left" dataKey="khqrPoints" name="KHQR Pts" stackId="pts" fill="#059669" />
                    <Bar yAxisId="left" dataKey="ccPoints" name="Credit Card Pts" stackId="pts" fill="#d97706" radius={[4, 4, 0, 0]} />
                    <Line yAxisId="right" type="monotone" dataKey="activeStaff" name="Active Staff" stroke="#0f172a" strokeWidth={2} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Chart 2: Top 10 Branches Stacked Point Breakdown */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">Section 6B · Top 10 Branches by KPI Point Mix</h3>
                <p className="text-xs text-slate-500">How each leading branch earned its points across POS, Sound Box, KHQR &amp; Credit Card</p>
              </div>
              <span className="text-[11px] font-medium text-slate-500">{KPI_PERIOD_LABEL[period]}</span>
            </div>
            <div className="h-[270px] w-full">
              {filteredBranches.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-slate-400">No branch data matching filters.</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    layout="vertical"
                    data={filteredBranches.slice(0, 10).map((b) => ({
                      name: b.branchId === 'UNASSIGNED' ? 'Unassigned' : `${b.branchId} ${b.branchName.replace(/Branch$/i, '').trim().slice(0, 14)}`,
                      posPoints: b.posPoints,
                      sbPoints: b.sbPoints,
                      khqrPoints: b.khqrPoints,
                      ccPoints: b.ccPoints,
                    }))}
                    margin={{ top: 4, right: 16, left: 24, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} />
                    <YAxis type="category" dataKey="name" width={115} tick={{ fontSize: 11, fill: '#334155' }} />
                    <Tooltip contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="posPoints" name="POS Pts" stackId="b" fill="#0284c7" />
                    <Bar dataKey="sbPoints" name="Sound Box Pts" stackId="b" fill="#7c3aed" />
                    <Bar dataKey="khqrPoints" name="KHQR Pts" stackId="b" fill="#059669" />
                    <Bar dataKey="ccPoints" name="Credit Card Pts" stackId="b" fill="#d97706" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ───────────── SECTION 5: Top 10 Branch and Staff by KPI Performance Each Month ───────────── */}
      {(showSection('all') || showSection('top10')) && (
        <section className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs" aria-label="Section 5: Top 10 Branch and Staff by Month">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center">
                <Trophy className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">Section 5 · Top 10 Branches &amp; Individual Staff Leaderboard</h3>
                <p className="text-xs text-slate-500">Select any month (or All Time) to inspect the top 10 branches and top 10 field staff.</p>
              </div>
            </div>

            <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-xl bg-slate-100 border border-slate-200">
              <button
                type="button"
                onClick={() => setSelectedTopMonth('ALL')}
                className={`px-2.5 py-1 rounded-lg text-xs cursor-pointer transition ${
                  selectedTopMonth === 'ALL' ? 'bg-[#003857] text-white font-semibold' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {KPI_PERIOD_LABEL[period]}
              </button>
              {availableMonths.slice(0, 6).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setSelectedTopMonth(m)}
                  className={`px-2.5 py-1 rounded-lg text-xs cursor-pointer transition ${
                    selectedTopMonth === m ? 'bg-[#003857] text-white font-semibold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {fmtMonth(m)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top 10 Branches */}
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="bg-[#003857] text-white px-3.5 py-2.5 flex items-center justify-between text-xs font-bold uppercase tracking-wider">
                <span>Top 10 Branches · {selectedTopMonth === 'ALL' ? KPI_PERIOD_LABEL[period] : fmtMonth(selectedTopMonth)}</span>
                <span>Mix · Total Points</span>
              </div>
              <div className="divide-y divide-slate-100">
                {top10Data.branches.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-400">No branch records in this month.</div>
                ) : (
                  top10Data.branches.map((b, i) => (
                    <div key={b.branchId} className="px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50/80">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <RankBadge rank={i + 1} />
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-slate-900 truncate">
                            {b.branchId !== 'UNASSIGNED' ? `Code ${b.branchId} · ` : ''}{b.branchName}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {b.staffCount} active staff · {fmtInt(b.totalTasks)} tasks · {fmtPts(b.ptsPerStaff)} pts/staff
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <MiniMixBar pos={b.posPoints} sb={b.sbPoints} khqr={b.khqrPoints} cc={b.ccPoints} total={b.totalPoints} />
                        <div className="text-right min-w-[72px]">
                          <div className="font-figure text-sm font-extrabold text-slate-900 tabular-nums">{fmtPts(b.totalPoints)}</div>
                          <div className="text-[10px] text-slate-500">KPI pts</div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Top 10 Individual Staff */}
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="bg-[#003857] text-white px-3.5 py-2.5 flex items-center justify-between text-xs font-bold uppercase tracking-wider">
                <span>Top 10 Staff · {selectedTopMonth === 'ALL' ? KPI_PERIOD_LABEL[period] : fmtMonth(selectedTopMonth)}</span>
                <span>Mix · Total Points</span>
              </div>
              <div className="divide-y divide-slate-100">
                {top10Data.staff.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-400">No staff records in this month.</div>
                ) : (
                  top10Data.staff.map((s, i) => (
                    <div key={s.staffId} className="px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50/80">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <RankBadge rank={i + 1} />
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-slate-900 truncate">
                            {s.staffName} <span className="font-mono text-[11px] font-normal text-slate-500">({s.staffId})</span>
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">
                            {s.branchId !== 'UNASSIGNED' ? `Code ${s.branchId} · ` : ''}{s.branchName} · {fmtInt(s.totalTasks)} tasks
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <MiniMixBar pos={s.posPoints} sb={s.sbPoints} khqr={s.khqrPoints} cc={s.ccPoints} total={s.totalPoints} />
                        <div className="text-right min-w-[72px]">
                          <div className="font-figure text-sm font-extrabold text-slate-900 tabular-nums">{fmtPts(s.totalPoints)}</div>
                          <div className="text-[10px] text-slate-500">KPI pts</div>
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

      {/* ───────────── SECTION 3: Overall Performance by Daily, Weekly, Monthly & Quarterly ───────────── */}
      {(showSection('all') || showSection('timeline')) && (
        <section className="fr-table-frame bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-x-auto" aria-label="Section 3: Overall Performance by Period">
          <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-extrabold text-slate-900">
                Section 3 · Overall Performance Breakdown ({granularity === 'daily' ? 'Daily · Last 30 Days' : granularity === 'weekly' ? 'Weekly · Last 12 Weeks' : granularity === 'quarterly' ? 'Quarterly · Last 8 Quarters' : 'Monthly · Last 12 Months'})
              </h3>
              <p className="text-xs text-slate-500">
                Switch between Daily, Weekly, Monthly, and Quarterly views to track branch and staff momentum over time.
              </p>
            </div>
            <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200 text-xs gap-1">
              {([
                ['daily', 'Daily (30d)'],
                ['weekly', 'Weekly (12w)'],
                ['monthly', 'Monthly (12m)'],
                ['quarterly', 'Quarterly (8q)'],
              ] as const).map(([g, label]) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGranularity(g)}
                  className={`px-3 py-1 rounded-lg cursor-pointer transition ${
                    granularity === g ? 'bg-[#003857] text-white font-semibold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="min-w-[980px]">
            <div className="grid items-center gap-x-3 grid-cols-[120px_76px_76px_115px_115px_130px_115px_85px_85px_110px_80px] bg-[#003857] text-white text-[11px] font-medium uppercase tracking-wider px-3.5 py-2.5">
              <span>Period</span>
              <span className="text-right">Branches</span>
              <span className="text-right">Staff</span>
              <span className="text-right">POS (Tasks/Pts)</span>
              <span className="text-right">SB (Tasks/Pts)</span>
              <span className="text-right">KHQR (Tasks/Pts)</span>
              <span className="text-right">CC (Cards/Pts)</span>
              <span className="text-right">Tasks</span>
              <span className="text-right">Pts/Staff</span>
              <span className="text-right">Total Points</span>
              <span className="text-right">Change</span>
            </div>
            <div className="divide-y divide-slate-200/90">
              {timeSeries.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400">No historical records found.</div>
              ) : (
                timeSeries.map((t) => (
                  <div
                    key={t.period}
                    className="grid items-center gap-x-3 grid-cols-[120px_76px_76px_115px_115px_130px_115px_85px_85px_110px_80px] px-3.5 py-2.5 text-[13px] text-slate-700 hover:bg-slate-50/70"
                  >
                    <span className="font-semibold text-slate-900 tabular-nums">{t.label}</span>
                    <span className="text-right tabular-nums">{fmtInt(t.activeBranches)}</span>
                    <span className="text-right tabular-nums">{fmtInt(t.activeStaff)}</span>
                    <span className="text-right tabular-nums">{fmtInt(t.posTasks)} <span className="text-slate-400">·</span> <span className="font-medium text-sky-700">{fmtPts(t.posPoints)}</span></span>
                    <span className="text-right tabular-nums">{fmtInt(t.sbTasks)} <span className="text-slate-400">·</span> <span className="font-medium text-violet-700">{fmtPts(t.sbPoints)}</span></span>
                    <span className="text-right tabular-nums">{fmtInt(t.khqrTasks)} <span className="text-slate-400">·</span> <span className="font-medium text-emerald-700">{fmtPts(t.khqrPoints)}</span></span>
                    <span className="text-right tabular-nums">{fmtInt(t.ccTasks)} <span className="text-slate-400">·</span> <span className="font-medium text-amber-700">{fmtPts(t.ccPoints)}</span></span>
                    <span className="text-right tabular-nums font-medium">{fmtInt(t.totalTasks)}</span>
                    <span className="text-right tabular-nums text-slate-600">{fmtPts(t.ptsPerStaff)}</span>
                    <span className="text-right tabular-nums font-extrabold text-slate-900">{fmtPts(t.totalPoints)} pts</span>
                    <span className="text-right tabular-nums">
                      {t.growthPct === null ? (
                        <span className="text-xs text-slate-400">—</span>
                      ) : (
                        <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${t.growthPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
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

      {/* ───────────── SECTION 1: KPI Performance by Branch & Statistics ───────────── */}
      {(showSection('all') || showSection('branches')) && (
        <section className="fr-table-frame bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-x-auto" aria-label="Section 1: KPI Performance by Branch">
          <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-extrabold text-slate-900">
                Section 1 · KPI Performance by Branch &amp; Statistics ({filteredBranches.length} Branches)
              </h3>
              <p className="text-xs text-slate-500">
                Click any branch row to inspect its 12 sub-category breakdown and individual staff contributors. {activeTargets.label}: <strong>{fmtPts(activeTargets.branch)} pts</strong>.
              </p>
            </div>
          </div>

          <div className="min-w-[1040px]">
            <div className="grid items-center gap-x-3 grid-cols-[44px_minmax(190px,1.4fr)_64px_115px_115px_125px_115px_85px_110px_110px_20px] bg-[#003857] text-white text-[11px] font-medium uppercase tracking-wider px-3.5 py-2.5">
              <span className="text-right">Rank</span>
              <span>Branch Code &amp; Name</span>
              <span className="text-right">Staff</span>
              <span className="text-right">POS (Tasks/Pts)</span>
              <span className="text-right">SB (Tasks/Pts)</span>
              <span className="text-right">KHQR (Tasks/Pts)</span>
              <span className="text-right">CC (Cards/Pts)</span>
              <span className="text-right" title="Average KPI points per active staff member in the branch">Pts/Staff</span>
              <span className="text-right">Total Points</span>
              <span>{activeTargets.label}</span>
              <span />
            </div>

            <div className="divide-y divide-slate-200/90">
              {filteredBranches.length === 0 ? (
                <div className="p-10 text-center text-sm font-semibold text-slate-500">No branches match the current filters.</div>
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
                        className="grid items-center gap-x-3 grid-cols-[44px_minmax(190px,1.4fr)_64px_115px_115px_125px_115px_85px_110px_110px_20px] w-full text-left px-3.5 py-2.5 text-[13px] text-slate-700 cursor-pointer"
                      >
                        <span className="text-right"><RankBadge rank={rank} /></span>
                        <span className="min-w-0 leading-tight">
                          <span className="block font-bold text-slate-900 truncate">
                            {b.branchId !== 'UNASSIGNED' ? `Code ${b.branchId} · ` : ''}{b.branchName}
                          </span>
                          <span className="block text-[11px] text-slate-500">
                            {b.isPP ? 'Phnom Penh' : 'Province'} · {fmtInt(b.totalTasks)} total tasks · {b.qualityPct}% quality
                          </span>
                        </span>
                        <span className="text-right tabular-nums font-medium">{b.staffCount}</span>
                        <span className="text-right tabular-nums">{fmtInt(b.posTasks)} <span className="text-slate-400">·</span> <span className="font-semibold text-sky-700">{fmtPts(b.posPoints)}</span></span>
                        <span className="text-right tabular-nums">{fmtInt(b.sbTasks)} <span className="text-slate-400">·</span> <span className="font-semibold text-violet-700">{fmtPts(b.sbPoints)}</span></span>
                        <span className="text-right tabular-nums">{fmtInt(b.khqrTasks)} <span className="text-slate-400">·</span> <span className="font-semibold text-emerald-700">{fmtPts(b.khqrPoints)}</span></span>
                        <span className="text-right tabular-nums">{fmtInt(b.ccTasks)} <span className="text-slate-400">·</span> <span className="font-semibold text-amber-700">{fmtPts(b.ccPoints)}</span></span>
                        <span className="text-right tabular-nums text-slate-600">{fmtPts(b.ptsPerStaff)}</span>
                        <span className="text-right tabular-nums font-extrabold text-slate-900">{fmtPts(b.totalPoints)} pts</span>
                        <span><TargetBar pct={b.targetPct} /></span>
                        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      </button>

                      <AnimatePresence initial={false}>
                        {isOpen && (
                          <motion.div
                            initial={{ opacity: 0, y: -6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6, transition: { duration: 0.14 } }}
                            transition={SPRING}
                            className="px-4 pb-4 pt-2 bg-slate-50/70 border-t border-slate-100"
                          >
                            <SubCategoryMiniGrid raw={b.raw} ruleMap={ruleMap} />
                            <div className="mt-3 rounded-xl border border-slate-200 bg-white overflow-hidden">
                              <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                Staff Contributors in {b.branchName} ({b.staffList.length})
                              </div>
                              <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
                                {b.staffList.map((s, idx) => (
                                  <div key={s.staffId} className="px-3 py-2 flex items-center justify-between text-xs">
                                    <div>
                                      <span className="text-slate-400 font-mono mr-2">#{idx + 1}</span>
                                      <span className="font-semibold text-slate-900">{s.staffName}</span>{' '}
                                      <span className="font-mono text-slate-500">({s.staffId})</span>
                                    </div>
                                    <div className="flex items-center gap-4 tabular-nums">
                                      <span className="text-slate-500">POS: {fmtPts(s.posPoints)}</span>
                                      <span className="text-slate-500">SB: {fmtPts(s.sbPoints)}</span>
                                      <span className="text-slate-500">KHQR: {fmtPts(s.khqrPoints)}</span>
                                      <span className="text-slate-500">CC: {fmtPts(s.ccPoints)}</span>
                                      <span className="font-extrabold text-slate-900">{fmtPts(s.totalPoints)} pts</span>
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
        </section>
      )}

      {/* ───────────── SECTION 2: KPI Performance by Individual & Statistics ───────────── */}
      {(showSection('all') || showSection('staff')) && (
        <section className="fr-table-frame bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-x-auto" aria-label="Section 2: KPI Performance by Individual">
          <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-extrabold text-slate-900">
                Section 2 · KPI Performance by Individual Staff &amp; Statistics ({filteredStaff.length} Staff)
              </h3>
              <p className="text-xs text-slate-500">
                Click any staff member to view their 12 sub-category task breakdown and submission quality metrics. Individual {activeTargets.label}: <strong>{fmtPts(activeTargets.staff)} pts</strong>.
              </p>
            </div>
          </div>

          <div className="min-w-[1040px]">
            <div className="grid items-center gap-x-3 grid-cols-[44px_minmax(190px,1.3fr)_minmax(150px,1.1fr)_110px_110px_120px_110px_76px_110px_110px_20px] bg-[#003857] text-white text-[11px] font-medium uppercase tracking-wider px-3.5 py-2.5">
              <span className="text-right">Rank</span>
              <span>Staff Name &amp; ID</span>
              <span>Branch</span>
              <span className="text-right">POS (Tasks/Pts)</span>
              <span className="text-right">SB (Tasks/Pts)</span>
              <span className="text-right">KHQR (Tasks/Pts)</span>
              <span className="text-right">CC (Cards/Pts)</span>
              <span className="text-right">Quality</span>
              <span className="text-right">Total Points</span>
              <span>{activeTargets.label}</span>
              <span />
            </div>

            <div className="divide-y divide-slate-200/90">
              {filteredStaff.length === 0 ? (
                <div className="p-10 text-center text-sm font-semibold text-slate-500">No staff records match the current filters.</div>
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
                        className="grid items-center gap-x-3 grid-cols-[44px_minmax(190px,1.3fr)_minmax(150px,1.1fr)_110px_110px_120px_110px_76px_110px_110px_20px] w-full text-left px-3.5 py-2.5 text-[13px] text-slate-700 cursor-pointer"
                      >
                        <span className="text-right"><RankBadge rank={rank} /></span>
                        <span className="min-w-0 leading-tight">
                          <span className="block font-bold text-slate-900 truncate">{s.staffName}</span>
                          <span className="block text-[11px] font-mono text-slate-500">ID: {s.staffId} · {fmtInt(s.totalTasks)} tasks</span>
                        </span>
                        <span className="min-w-0 leading-tight">
                          <span className="block truncate text-slate-800">{s.branchName}</span>
                          <span className="block text-[11px] text-slate-500">{s.branchId !== 'UNASSIGNED' ? `Code ${s.branchId}` : 'Unassigned'}</span>
                        </span>
                        <span className="text-right tabular-nums">{fmtInt(s.posTasks)} <span className="text-slate-400">·</span> <span className="font-semibold text-sky-700">{fmtPts(s.posPoints)}</span></span>
                        <span className="text-right tabular-nums">{fmtInt(s.sbTasks)} <span className="text-slate-400">·</span> <span className="font-semibold text-violet-700">{fmtPts(s.sbPoints)}</span></span>
                        <span className="text-right tabular-nums">{fmtInt(s.khqrTasks)} <span className="text-slate-400">·</span> <span className="font-semibold text-emerald-700">{fmtPts(s.khqrPoints)}</span></span>
                        <span className="text-right tabular-nums">{fmtInt(s.ccTasks)} <span className="text-slate-400">·</span> <span className="font-semibold text-amber-700">{fmtPts(s.ccPoints)}</span></span>
                        <span className="text-right tabular-nums">
                          <span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${s.qualityPct >= 95 ? 'bg-emerald-50 text-emerald-700' : s.qualityPct >= 80 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>
                            {s.qualityPct}%
                          </span>
                        </span>
                        <span className="text-right tabular-nums font-extrabold text-slate-900">{fmtPts(s.totalPoints)} pts</span>
                        <span><TargetBar pct={s.targetPct} /></span>
                        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      </button>

                      <AnimatePresence initial={false}>
                        {isOpen && (
                          <motion.div
                            initial={{ opacity: 0, y: -6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6, transition: { duration: 0.14 } }}
                            transition={SPRING}
                            className="px-4 pb-4 pt-2 bg-slate-50/70 border-t border-slate-100"
                          >
                            <SubCategoryMiniGrid raw={s} ruleMap={ruleMap} />
                            <div className="mt-2.5 flex flex-wrap items-center gap-4 text-xs text-slate-600">
                              <span>POS Rejected: <strong>{s.posRejected}</strong> / {s.posSubmitted}</span>
                              <span>Sound Box Rejected: <strong>{s.sbRejected}</strong> / {s.sbSubmitted}</span>
                              <span>KHQR Blocked Submits: <strong>{s.khqrFailed}</strong></span>
                              <span>Credit Card Rejected: <strong>{s.ccRejected}</strong> / {s.ccSubmitted}</span>
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
        </section>
      )}

      {/* ───────────── PART 2: Management KPI and KPI Point Table (Set by Admin) ───────────── */}
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

/* ───────────── Helper Sub-Components ───────────── */

const SummaryCard: React.FC<{
  label: string;
  value: string;
  sub: string;
  Icon: React.ElementType;
  tone: 'navy' | 'sky' | 'emerald' | 'amber' | 'violet';
  badge?: string;
  onClick?: () => void;
}> = ({ label, value, sub, Icon, tone, badge, onClick }) => {
  const tones = {
    navy: 'bg-slate-100 text-[#003857] border-slate-200',
    sky: 'bg-sky-50 text-sky-600 border-sky-100',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    amber: 'bg-amber-50 text-amber-600 border-amber-100',
    violet: 'bg-violet-50 text-violet-600 border-violet-100',
  }[tone];
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button', onClick } : {})}
      className={`text-left p-4 rounded-2xl border border-slate-200/90 bg-white shadow-2xs flex flex-col justify-between transition-all ${
        onClick ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5 hover:border-slate-300' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider truncate">{label}</span>
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center border shrink-0 ${tones}`}>
          <Icon className="w-4.5 h-4.5" aria-hidden />
        </span>
      </div>
      <div className="font-figure text-2xl sm:text-3xl font-extrabold tabular-nums text-slate-900 my-2 truncate">{value}</div>
      <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-xs text-slate-500">
        <span className="truncate" title={sub}>{sub}</span>
        {badge && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 shrink-0">{badge}</span>}
      </div>
    </Tag>
  );
};

const RankBadge: React.FC<{ rank: number }> = ({ rank }) => {
  if (rank === 1) return <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-100 text-amber-800 border border-amber-300 font-bold text-xs">1</span>;
  if (rank === 2) return <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-200 text-slate-800 border border-slate-300 font-bold text-xs">2</span>;
  if (rank === 3) return <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-orange-100 text-orange-800 border border-orange-300 font-bold text-xs">3</span>;
  return <span className="text-xs font-mono text-slate-500 tabular-nums">{rank}</span>;
};

const MiniMixBar: React.FC<{ pos: number; sb: number; khqr: number; cc: number; total: number }> = ({ pos, sb, khqr, cc, total }) => {
  if (total <= 0) return null;
  const pPos = (pos / total) * 100;
  const pSb = (sb / total) * 100;
  const pKhqr = (khqr / total) * 100;
  const pCc = (cc / total) * 100;
  return (
    <div
      className="w-20 h-2 rounded-full bg-slate-100 overflow-hidden flex"
      title={`POS: ${fmtPts(pos)} pts · Sound Box: ${fmtPts(sb)} pts · KHQR: ${fmtPts(khqr)} pts · Credit Card: ${fmtPts(cc)} pts`}
    >
      {pPos > 0 && <div className="bg-sky-500 h-full" style={{ width: `${pPos}%` }} />}
      {pSb > 0 && <div className="bg-violet-500 h-full" style={{ width: `${pSb}%` }} />}
      {pKhqr > 0 && <div className="bg-emerald-500 h-full" style={{ width: `${pKhqr}%` }} />}
      {pCc > 0 && <div className="bg-amber-500 h-full" style={{ width: `${pCc}%` }} />}
    </div>
  );
};

const TargetBar: React.FC<{ pct: number }> = ({ pct }) => {
  const color = pct >= 100 ? 'bg-emerald-500' : pct >= 60 ? 'bg-sky-500' : 'bg-amber-500';
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, Math.max(4, pct))}%` }} />
      </div>
      <span className="text-[11px] font-mono tabular-nums text-slate-600 w-9 text-right">{pct}%</span>
    </div>
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
          <div className="text-xs font-bold text-slate-900 tabular-nums">
            {fmtInt(c.n)} <span className="text-slate-400 font-normal">({fmtPts(c.pts)} pts)</span>
          </div>
        </div>
      ))}
    </div>
  );
};

/* ───────────── Part 2: Management KPI Task & Point Table + D/W/M/Q Targets ───────────── */

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

  // Target state
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
    <section className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs flex flex-col gap-4" aria-label="Management KPI and KPI Point Settings">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[#003857] text-white flex items-center justify-center">
            <Settings2 className="w-4.5 h-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-extrabold text-slate-900">
              Management KPI &amp; KPI Point Matrix by Category and Sub-Category {isAdmin ? '(Admin Editable)' : '(Scoring Guide)'}
            </h3>
            <p className="text-xs text-slate-500">
              {isAdmin
                ? 'Adjust KPI points per task or Daily/Weekly/Monthly/Quarterly targets. All rankings and charts recalculate immediately.'
                : 'Official KPI point weights and performance targets defined by Head Office Management.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200 text-xs gap-1">
            {(['ALL', 'POS Terminal', 'Sound Box', 'KHQR', 'Credit Card'] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCatFilter(c)}
                className={`px-2.5 py-1 rounded-lg cursor-pointer transition ${
                  catFilter === c ? 'bg-[#003857] text-white font-semibold' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {c === 'ALL' ? 'All Categories' : c}
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

      {/* Add Custom KPI Task Form (Admin Only) */}
      {isAdmin && showAdd && (
        <form onSubmit={handleAddRule} className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 items-end">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Task Code</label>
            <input
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              placeholder="e.g. POS_TRAINING"
              className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white font-mono uppercase"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Category</label>
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
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Sub-Category / Task Name</label>
            <input
              value={newSub}
              onChange={(e) => setNewSub(e.target.value)}
              placeholder="e.g. Merchant Staff Training"
              className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Description / Rule</label>
            <input
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="How this task is verified"
              className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">KPI Points</label>
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
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Unit</label>
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

      {/* Daily, Weekly, Monthly, Quarterly Target Settings Card */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
            <Target className="w-4 h-4 text-[#003857]" />
            Daily, Weekly, Monthly &amp; Quarterly Target Points (Used for Target % Progress Bars)
          </div>
          {isAdmin && (
            <button
              type="button"
              disabled={savingTargets}
              onClick={handleSaveTargets}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#003857] hover:bg-[#002b44] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
            >
              {savingTargets ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save Targets
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
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</label>
              {isAdmin ? (
                <input
                  type="number"
                  min="0"
                  step="5"
                  value={tForm[key]}
                  onChange={(e) => setTForm((prev) => ({ ...prev, [key]: Number(e.target.value) || 0 }))}
                  className="w-full mt-0.5 text-xs font-extrabold text-slate-900 tabular-nums border-b border-transparent focus:border-slate-400 outline-none"
                />
              ) : (
                <div className="text-xs font-extrabold text-slate-900 tabular-nums mt-0.5">{fmtPts(tForm[key])} pts</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Table of KPI Tasks and KPI Points defined by Management */}
      <div className="rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[820px]">
          <thead>
            <tr className="bg-[#003857] text-white text-[11px] font-medium uppercase tracking-wider">
              <th className="py-2.5 px-3.5">#</th>
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
                <tr key={r.code} className={`hover:bg-slate-50/80 ${!r.active ? 'opacity-60' : ''}`}>
                  <td className="py-2.5 px-3.5 tabular-nums text-slate-400">{i + 1}</td>
                  <td className="py-2.5 px-3.5">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-lg border ${catStyle.badge}`}>
                      <CatIcon className="w-3.5 h-3.5" /> {r.category}
                    </span>
                  </td>
                  <td className="py-2.5 px-3.5">
                    <div className="font-bold text-slate-900">{r.subCategory}</div>
                    <div className="text-[11px] font-mono text-slate-400">{r.code}</div>
                  </td>
                  <td className="py-2.5 px-3.5 text-xs text-slate-600">
                    <span className="inline-flex items-center gap-1">
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
                          className="w-20 px-2 py-1 text-right font-figure font-extrabold text-slate-900 rounded-lg border border-slate-200 bg-white tabular-nums"
                        />
                        <span className="text-xs text-slate-500">pts</span>
                      </div>
                    ) : (
                      <span className="font-figure font-extrabold text-slate-900 tabular-nums">{fmtPts(r.points)} pts</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3.5 text-center">
                    {isAdmin ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => saveRule(r, undefined, !r.active)}
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border cursor-pointer ${
                          r.active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        {r.active ? 'Active' : 'Inactive'}
                      </button>
                    ) : (
                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
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
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer transition ${
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
    </section>
  );
});

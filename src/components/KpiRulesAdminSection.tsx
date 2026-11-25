import React, { memo, useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useSort, SortTh } from '../utils/sort';
import {
  Settings2,
  Target,
  Calendar,
  ShieldCheck,
  Save,
  Plus,
  Loader2,
  CheckCircle2,
  Calculator,
  Cpu,
  Volume2,
  QrCode,
  CreditCard,
  Layers,
  Trash2,
  Search,
  Users,
  ClipboardList,
  AlertTriangle,
  X,
  RefreshCw,
} from 'lucide-react';
import {
  KpiPointRule,
  KpiTargets,
  KpiCategory,
  saveKpiRuleOnServer,
  deleteKpiRuleOnServer,
  saveKpiTargetsOnServer,
  syncKpiFromMerchantVisit,
  type KpiSyncResult,
} from '../services/kpiService';
import { Branch } from '../types';
import {
  ManagementExemptStaff,
  getManagementExemptStaff,
  addManagementExemptStaff,
  removeManagementExemptStaff,
} from '../utils/kpiManagementUtils';
import { getCachedStaff } from '../services/staffCache';
import { RAW_BRANCHES } from '../data/initialData';
import {
  PillMotion,
  CAPSULE_TRACK_COMPACT_CLS,
  CAPSULE_PILL_CLS,
  CAPSULE_BTN_ACTIVE_CLS,
  CAPSULE_BTN_INACTIVE_CLS,
} from './PillMotion';
import { SPRING_TAB_PILL } from '../utils/animationRules';
import { KpiEventSettingsCard } from './KpiEventSettingsCard';

export const CAT_COLORS: Record<KpiCategory, { hex: string; badge: string; bar: string; dot: string; Icon: React.ElementType }> = {
  'POS Terminal': { hex: '#184e77', badge: 'bg-[#184e77]/10 text-[#184e77] border-[#184e77]/20 font-semibold', bar: 'bg-[#184e77]', dot: 'bg-[#184e77]', Icon: Cpu },
  'Sound Box': { hex: '#4F518C', badge: 'bg-[#4F518C]/10 text-[#4F518C] border-[#4F518C]/20', bar: 'bg-[#4F518C]', dot: 'bg-[#4F518C]', Icon: Volume2 },
  KHQR: { hex: '#1e6091', badge: 'bg-[#1e6091]/10 text-[#1e6091] border-[#1e6091]/20', bar: 'bg-[#1e6091]', dot: 'bg-[#1e6091]', Icon: QrCode },
  'Credit Card': { hex: '#f59e0b', badge: 'bg-amber-50 text-amber-700 border-amber-200/90', bar: 'bg-[#f59e0b]', dot: 'bg-[#f59e0b]', Icon: CreditCard },
  'Merchant Visit': { hex: '#2d6a4f', badge: 'bg-[#2d6a4f]/10 text-[#2d6a4f] border-[#2d6a4f]/20 font-semibold', bar: 'bg-[#2d6a4f]', dot: 'bg-[#2d6a4f]', Icon: ClipboardList },
  Other: { hex: '#64748b', badge: 'bg-slate-50 text-slate-600 border-slate-200', bar: 'bg-slate-500', dot: 'bg-slate-500', Icon: Layers },
};

/** The KPI rule code of a Merchant Visit activity, as the server counts it: "Account Opening" -> MV_ACCOUNT_OPENING. */
export const mvCodeOf = (activity: string): string =>
  ('MV_' + (activity.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'OTHER')).slice(0, 40);

const NF_PTS = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 });   // reused (same text as toLocaleString)
const fmtPts = (n: number) => NF_PTS.format(n);

export interface KpiRulesAdminSectionProps {
  isAdmin: boolean;
  rules: KpiPointRule[];
  targets: KpiTargets;
  onRuleSaved: (r: KpiPointRule) => void;
  onRuleDeleted?: (code: string) => void;
  onTargetsSaved: (t: KpiTargets) => void;
  toast: (m: string) => void;
  branches?: Branch[];
}

interface KpiRuleRowProps {
  rule: KpiPointRule;
  index: number;
  isAdmin: boolean;
  onSaveRule: (r: KpiPointRule, nextPoints?: number, nextActive?: boolean) => Promise<void>;
  onRequestDelete: (r: KpiPointRule) => void;
  savingCode: string | null;
  deletingCode: string | null;
  /** Added by "Sync from Merchant Visit" in this session: highlighted until the points are set. */
  isNew?: boolean;
}

const KpiRuleRow = memo(function KpiRuleRow({
  rule,
  index,
  isAdmin,
  onSaveRule,
  onRequestDelete,
  savingCode,
  deletingCode,
  isNew,
}: KpiRuleRowProps) {
  const [draft, setDraft] = useState(String(rule.points));
  useEffect(() => {
    setDraft(String(rule.points));
  }, [rule.points]);

  const catStyle = CAT_COLORS[rule.category] || CAT_COLORS.Other;
  const CatIcon = catStyle.Icon;
  const changed = Number(draft) !== rule.points && !isNaN(Number(draft));
  const busy = savingCode === rule.code || deletingCode === rule.code;

  return (
    <tr className={`hover:bg-slate-50/70 transition-colors ${isNew ? 'bg-sky-50/70' : !rule.active ? 'opacity-60' : ''}`}>
      <td className="py-2.5 px-3.5 text-right tabular-nums text-slate-500">{index + 1}</td>
      <td className="py-2.5 px-3.5">
        <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-lg border ${catStyle.badge}`}>
          <CatIcon className="w-3.5 h-3.5" /> {rule.category}
        </span>
      </td>
      <td className="py-2.5 px-3.5 leading-tight">
        <div className="text-slate-900" title={rule.code}>
          {rule.subCategory}
          {isNew && <span className="ml-1.5 align-middle text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-sky-100 text-sky-700 border border-sky-200">New · set points</span>}
        </div>
      </td>
      <td className="py-2.5 px-3.5 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          {rule.description || 'Verified system record'}
        </span>
      </td>
      <td className="py-2.5 px-3.5 text-xs text-slate-500">{rule.unit}</td>
      <td className="py-2.5 px-3.5 text-right">
        {isAdmin ? (
          <div className="inline-flex items-center justify-end gap-1">
            <input
              type="number"
              step="0.5"
              min="0"
              max="10000"
              aria-label={`Points for ${rule.subCategory}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-20 px-2 py-1 text-right font-figure font-medium text-slate-900 rounded-lg border border-slate-200 bg-white tabular-nums focus:ring-1 focus:ring-[#002F4A] outline-none"
            />
            <span className="text-xs text-slate-500">pts</span>
          </div>
        ) : (
          <span className="font-figure font-medium text-slate-900 tabular-nums">{fmtPts(rule.points)} pts</span>
        )}
      </td>
      <td className="py-2.5 px-3.5 text-center">
        {isAdmin ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onSaveRule(rule, undefined, !rule.active)}
            className={`px-2.5 py-0.5 rounded-full text-[11px] border cursor-pointer transition ${
              rule.active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'
            }`}
          >
            {rule.active ? 'Active' : 'Inactive'}
          </button>
        ) : (
          <span className={`px-2.5 py-0.5 rounded-full text-[11px] border ${
            rule.active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'
          }`}>
            {rule.active ? 'Active' : 'Inactive'}
          </span>
        )}
      </td>
      {isAdmin && (
        <td className="py-2.5 px-3.5 text-right">
          <div className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap">
            <button
              type="button"
              disabled={busy || !changed}
              onClick={() => onSaveRule(rule, Math.max(0, Number(draft) || 0))}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs cursor-pointer transition border ${
                changed ? 'bg-[#eaf4f2] hover:bg-[#d5eae6] text-[#1d5c55] hover:text-[#144741] border-[#c3e0da] hover:border-[#9fd0c7]' : 'bg-slate-100 text-slate-400 border-transparent cursor-default'
              }`}
            >
              {savingCode === rule.code ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Save
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onRequestDelete(rule)}
              data-kpi-delete-rule={rule.code}
              aria-label={`Delete ${rule.subCategory}`}
              title={`Delete ${rule.subCategory} (${rule.code})`}
              className="inline-flex items-center justify-center p-1.5 rounded-lg border border-rose-200/75 bg-rose-50/40 text-rose-600 hover:bg-rose-50 hover:border-rose-300 disabled:opacity-50 cursor-pointer transition"
            >
              {deletingCode === rule.code ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        </td>
      )}
    </tr>
  );
});

export const KpiRulesAdminSection = memo(function KpiRulesAdminSection({
  isAdmin,
  rules,
  targets,
  onRuleSaved,
  onRuleDeleted,
  onTargetsSaved,
  toast,
  branches = [],
}: KpiRulesAdminSectionProps) {
  const [catFilter, setCatFilter] = useState<'ALL' | KpiCategory>('ALL');
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [deletingCode, setDeletingCode] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<KpiPointRule | null>(null);
  // (22 Nov 2026) Sync from Merchant Visit: the preview, the "also bring back deleted" choice, and the tasks just added
  const [syncPreview, setSyncPreview] = useState<KpiSyncResult | null>(null);
  const [syncBusy, setSyncBusy] = useState<'' | 'check' | 'apply'>('');
  const [syncIncludeDeleted, setSyncIncludeDeleted] = useState(false);
  const [newlySynced, setNewlySynced] = useState<Set<string>>(new Set());
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

  // ───────────── Management KPI Exemption State ─────────────
  const [exemptStaff, setExemptStaff] = useState<ManagementExemptStaff[]>(() => getManagementExemptStaff());
  const [selectedStaffKey, setSelectedStaffKey] = useState<string>('');
  const [exemptFilter, setExemptFilter] = useState<string>('');
  const [showCustomAdd, setShowCustomAdd] = useState(false);
  const [customStaffName, setCustomStaffName] = useState('');
  const [customStaffId, setCustomStaffId] = useState('');
  const [customStaffPos, setCustomStaffPos] = useState('Management');
  const [customStaffBranch, setCustomStaffBranch] = useState('100');

  // Compile full staff directory from branches, cached staff and initial data
  const allAvailableStaff = useMemo(() => {
    const list: Array<{ staffId: string; staffName: string; position: string; branchId: string; branchName: string }> = [];
    const seen = new Set<string>();

    const addStaff = (id: string, name: string, pos: string, bId: string, bName: string) => {
      const cleanId = (id || '').trim();
      const cleanName = (name || '').trim();
      const key = (cleanId || cleanName).toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      list.push({
        staffId: cleanId,
        staffName: cleanName,
        position: pos || 'MS Officer',
        branchId: bId || '100',
        branchName: bName || 'Head Office',
      });
    };

    // 1. From branches prop
    (branches || []).forEach((b) => {
      (b.staffDetails || []).forEach((u) => {
        addStaff(u.empId || '', u.name, u.position || '', b.id, b.name);
      });
    });

    // 2. From getCachedStaff()
    const cached = getCachedStaff();
    if (cached) {
      cached.forEach((a) => {
        addStaff(a.empId || '', a.name, a.position || '', a.branchId || '100', `Branch ${a.branchId || '100'}`);
      });
    }

    // 3. Fallback from RAW_BRANCHES
    RAW_BRANCHES.forEach((b: { id: string; name: string; st: [string, string, string, string, string][] }) => {
      (b.st || []).forEach((row: [string, string, string, string, string]) => {
        const [id, name, pos] = row;
        addStaff(id, name, pos, b.id, b.name);
      });
    });

    return list.sort((a, b) => a.staffName.localeCompare(b.staffName));
  }, [branches]);

  // Exclude staff that are already in the exempt roster
  const availableSelectableStaff = useMemo(() => {
    const exemptSet = new Set(
      exemptStaff.map((s) => (s.staffId || s.staffName).toLowerCase())
    );
    return allAvailableStaff.filter(
      (s) => !exemptSet.has((s.staffId || s.staffName).toLowerCase())
    );
  }, [allAvailableStaff, exemptStaff]);

  const filteredExemptStaff = useMemo(() => {
    if (!exemptFilter.trim()) return exemptStaff;
    const q = exemptFilter.toLowerCase();
    return exemptStaff.filter(
      (s) =>
        s.staffName.toLowerCase().includes(q) ||
        s.staffId.toLowerCase().includes(q) ||
        (s.position && s.position.toLowerCase().includes(q)) ||
        (s.branchId && s.branchId.toLowerCase().includes(q)) ||
        (s.branchName && s.branchName.toLowerCase().includes(q))
    );
  }, [exemptStaff, exemptFilter]);

  const handleAddSelectedStaff = () => {
    if (!selectedStaffKey) return;
    const target = allAvailableStaff.find(
      (s) => (s.staffId || s.staffName).toLowerCase() === selectedStaffKey.toLowerCase()
    );
    if (!target) return;
    const newEntry: ManagementExemptStaff = {
      staffId: target.staffId,
      staffName: target.staffName,
      position: target.position,
      branchId: target.branchId,
      branchName: target.branchName,
      addedAt: new Date().toISOString(),
      addedBy: 'Admin',
    };
    addManagementExemptStaff(newEntry);
    setExemptStaff(getManagementExemptStaff());
    setSelectedStaffKey('');
    toast(`Added ${target.staffName} (${target.staffId || target.position}) to Management (Exempt from KPI).`);
  };

  const handleAddCustomStaff = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customStaffName.trim()) {
      toast('Please enter a staff name.');
      return;
    }
    const newEntry: ManagementExemptStaff = {
      staffId: customStaffId.trim(),
      staffName: customStaffName.trim(),
      position: customStaffPos.trim() || 'Management',
      branchId: customStaffBranch.trim() || '100',
      branchName: customStaffBranch.trim() === '100' ? 'Head Office' : `Branch ${customStaffBranch.trim()}`,
      addedAt: new Date().toISOString(),
      addedBy: 'Admin',
    };
    addManagementExemptStaff(newEntry);
    setExemptStaff(getManagementExemptStaff());
    setCustomStaffName('');
    setCustomStaffId('');
    setShowCustomAdd(false);
    toast(`Added ${newEntry.staffName} to Management (Exempt from KPI).`);
  };

  const handleRemoveExemptStaff = (staffIdOrName: string, name: string) => {
    removeManagementExemptStaff(staffIdOrName);
    setExemptStaff(getManagementExemptStaff());
    toast(`Removed ${name} from Management exemption. Staff will now be tracked for KPI.`);
  };

  const filteredRules = useMemo(
    () =>
      rules
        .filter((r) => catFilter === 'ALL' || r.category === catFilter)
        .sort((a, b) => (a.sortOrder - b.sortOrder) || a.code.localeCompare(b.code)),
    [rules, catFilter]
  );

  const { sorted: sortedRules, sort: ruleSort, toggle: toggleRuleSort } = useSort<KpiPointRule>(filteredRules, {
    category: (r) => r.category,
    subCategory: (r) => r.subCategory,
    description: (r) => r.description,
    unit: (r) => r.unit,
    points: (r) => r.points,
    status: (r) => (r.active ? 'Active' : 'Inactive'),
  });

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
      if (saved.active && saved.points > 0) {
        setNewlySynced((prev) => {
          if (!prev.has(saved.code)) return prev;
          const next = new Set(prev);
          next.delete(saved.code);
          return next;
        });
      }
      toast(`Saved ${saved.subCategory}: ${saved.points} pts (${saved.active ? 'Active' : 'Inactive'})`);
    } catch (e) {
      toast(`Could not save KPI rule: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingCode(null);
    }
  };

  useEffect(() => {
    if (!deleteTarget) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !deletingCode) setDeleteTarget(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [deleteTarget, deletingCode]);

  const handleConfirmDeleteRule = async () => {
    if (!deleteTarget || deletingCode) return;
    const target = deleteTarget;
    setDeletingCode(target.code);
    try {
      await deleteKpiRuleOnServer(target.code);
      onRuleDeleted?.(target.code);
      setDeleteTarget(null);
      toast(`Deleted KPI type "${target.subCategory}" (${target.code}).`);
    } catch (e) {
      toast(`Could not delete KPI type: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDeletingCode(null);
    }
  };

  const handleSyncCheck = async () => {
    if (syncBusy) return;
    setSyncBusy('check');
    try {
      const r = await syncKpiFromMerchantVisit(false);
      if (!r.candidates.length && !r.deletedSkipped.length) {
        toast(`Up to date: all ${r.activitiesChecked} Merchant Visit tasks already have a KPI task.`);
      } else {
        setSyncIncludeDeleted(false);
        setSyncPreview(r);
      }
    } catch (e) {
      toast(`Could not check Merchant Visit tasks: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncBusy('');
    }
  };

  const handleSyncApply = async () => {
    if (syncBusy || !syncPreview) return;
    setSyncBusy('apply');
    try {
      const r = await syncKpiFromMerchantVisit(true, syncIncludeDeleted);
      r.rules.forEach((rule) => onRuleSaved(rule));
      setNewlySynced((prev) => {
        const next = new Set(prev);
        r.rules.filter((rule) => !rule.active || rule.points === 0).forEach((rule) => next.add(rule.code));
        return next;
      });
      setSyncPreview(null);
      if (r.rules.length) setCatFilter('ALL');
      toast(
        r.added
          ? `Added ${r.added} KPI task(s) from Merchant Visit. New tasks start at 0 pts and Inactive: set the points, Save, then switch them to Active.`
          : 'Nothing to add: the KPI tasks are already up to date.'
      );
    } catch (e) {
      toast(`Could not sync KPI tasks: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncBusy('');
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

  const effectiveWorkDays = useMemo(() => {
    const baseDays = Math.max(1, Number(tForm.workDaysInMonth) || 24);
    if (!tForm.excludeHolidays) return baseDays;
    const holidays = Math.max(0, Number(tForm.holidayDaysCount) || 0);
    return Math.max(1, baseDays - holidays);
  }, [tForm.workDaysInMonth, tForm.excludeHolidays, tForm.holidayDaysCount]);

  const handleAutoCalculateTargets = () => {
    const eff = effectiveWorkDays;
    const staffDaily = Math.max(0, Number(tForm.staffDailyTarget) || 5);
    const staffPerBranchMultiplier = 5;
    const branchDaily = staffDaily * staffPerBranchMultiplier;
    const weeklyDays = tForm.workingDaysMode === 'mon_fri' ? 5 : 6;

    const staffMonthly = Math.round(staffDaily * eff);
    const staffWeekly = Math.round(staffDaily * weeklyDays);
    const staffQuarterly = staffMonthly * 3;

    const branchMonthly = Math.round(branchDaily * eff);
    const branchWeekly = Math.round(branchDaily * weeklyDays);
    const branchQuarterly = branchMonthly * 3;

    setTForm((prev) => ({
      ...prev,
      branchDailyTarget: branchDaily,
      branchMonthlyTarget: branchMonthly,
      branchWeeklyTarget: branchWeekly,
      branchQuarterlyTarget: branchQuarterly,
      staffDailyTarget: staffDaily,
      staffMonthlyTarget: staffMonthly,
      staffWeeklyTarget: staffWeekly,
      staffQuarterlyTarget: staffQuarterly,
    }));
    toast(`Targets auto-calculated: Branch Daily ${branchDaily} pts (${branchMonthly} pts/mo) · Staff Daily ${staffDaily} pts (${staffMonthly} pts/mo) based on ${eff} work days.`);
  };

  const handleScheduleModeChange = (mode: 'mon_fri' | 'mon_sat' | 'custom') => {
    let defaultDays = 24;
    if (mode === 'mon_fri') defaultDays = 22;
    else if (mode === 'mon_sat') defaultDays = 26;
    setTForm((prev) => ({
      ...prev,
      workingDaysMode: mode,
      workDaysInMonth: mode === 'custom' ? prev.workDaysInMonth : defaultDays,
    }));
  };

  const handleSaveTargets = async () => {
    setSavingTargets(true);
    try {
      const saved = await saveKpiTargetsOnServer(tForm);
      onTargetsSaved(saved);
      toast(`Updated KPI targets: Staff ${saved.staffMonthlyTarget} pts/mo · Branch ${saved.branchMonthlyTarget} pts/mo (${saved.workDaysInMonth} work days, holidays ${saved.excludeHolidays ? 'excluded' : 'included'}).`);
    } catch (err) {
      toast(`Could not save targets: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingTargets(false);
    }
  };

  return (
    <div className="space-y-5" aria-label="Management KPI and KPI Point Settings">
      {/* ───────────── 1. Booth Event, Standby VIP & Per-Submission Rules ───────────── */}
      {isAdmin && <KpiEventSettingsCard toast={toast} />}

      {/* ───────────── 2. KPI Target Points, Work Days & Holiday Settings ───────────── */}
      <section className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden" aria-label="KPI Target Points, Work Days and Holiday Settings">
        <div className="px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[13.5px] font-semibold text-slate-900">
            <Target className="w-4 h-4 text-[#002F4A]" />
            <span>KPI Target Points, Work Days &amp; Holiday Settings</span>
          </div>
          {isAdmin && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleAutoCalculateTargets}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-50 text-[#1e5b88] border border-sky-200 hover:bg-sky-100 text-xs font-medium cursor-pointer transition"
                title="Auto-calculate Monthly & Quarterly targets: Daily target × Effective Work Days"
              >
                <Calculator className="w-3.5 h-3.5" />
                <span>Auto-calculate targets ({effectiveWorkDays}d)</span>
              </button>
              <button
                type="button"
                disabled={savingTargets}
                onClick={handleSaveTargets}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#eaf4f2] hover:bg-[#d5eae6] text-[#1d5c55] hover:text-[#144741] border border-[#c3e0da] hover:border-[#9fd0c7] text-xs font-medium cursor-pointer disabled:opacity-50 transition"
                >
                  {savingTargets ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save targets
                </button>
              </div>
            )}
          </div>

          <div className="p-5 bg-slate-50/40 space-y-3.5">
          {/* Working Days in Month & Exclude/Include Holiday Rules */}
          <div className="rounded-xl border border-slate-200 bg-white p-3 grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
            {/* Work Days & Schedule (5 cols) */}
            <div className="md:col-span-5 space-y-1.5 border-b md:border-b-0 md:border-r border-slate-100 pb-2.5 md:pb-0 md:pr-3">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[11px] font-semibold text-slate-700 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-[#1e5b88]" />
                  <span>Work Days in Month</span>
                </label>
                {isAdmin && (
                  <div className={`${CAPSULE_TRACK_COMPACT_CLS} text-[10.5px] shrink-0`} role="tablist" aria-label="Working days mode">
                    {([
                      { id: 'mon_fri' as const, label: 'Mon–Fri (22d)' },
                      { id: 'mon_sat' as const, label: 'Mon–Sat (26d)' },
                      { id: 'custom' as const, label: 'Custom' },
                    ]).map(({ id, label }) => {
                      const active = tForm.workingDaysMode === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          onClick={() => handleScheduleModeChange(id)}
                          className={`relative px-2 py-0.5 rounded-full cursor-pointer transition-colors whitespace-nowrap ${
                            active ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
                          }`}
                        >
                          {active && (
                            <PillMotion
                              layoutId="kpi-rules-workdays-pill"
                              aria-hidden
                              transition={SPRING_TAB_PILL}
                              className={CAPSULE_PILL_CLS}
                            />
                          )}
                          <span className="relative z-10">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {isAdmin ? (
                  <div className="relative flex-1">
                    <input
                      type="number"
                      min="1"
                      max="31"
                      step="0.5"
                      value={tForm.workDaysInMonth}
                      onChange={(e) => setTForm((prev) => ({ ...prev, workDaysInMonth: Math.max(1, Number(e.target.value) || 0) }))}
                      className="w-full px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-slate-50 focus:bg-white text-slate-900 tabular-nums outline-none focus:border-[#1e5b88]"
                    />
                    <span className="absolute right-2.5 top-1.5 text-xs text-slate-400 pointer-events-none">days / mo</span>
                  </div>
                ) : (
                  <span className="text-xs font-semibold text-slate-800 tabular-nums">{tForm.workDaysInMonth} days / month</span>
                )}
              </div>
            </div>

            {/* Public Holiday Configuration (Exclude or Include Holiday) (4 cols) */}
            <div className="md:col-span-4 space-y-1.5 border-b md:border-b-0 md:border-r border-slate-100 pb-2.5 md:pb-0 md:pr-3">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[11px] font-semibold text-slate-700">Public Holidays</label>
                {isAdmin ? (
                  <div className={`${CAPSULE_TRACK_COMPACT_CLS} text-[10.5px] shrink-0`} role="tablist" aria-label="Public holidays mode">
                    {([
                      { id: true, label: 'Exclude Holidays' },
                      { id: false, label: 'Include Holidays' },
                    ] as const).map(({ id, label }) => {
                      const active = tForm.excludeHolidays === id;
                      return (
                        <button
                          key={label}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          onClick={() => setTForm((prev) => ({ ...prev, excludeHolidays: id }))}
                          className={`relative px-2 py-0.5 rounded-full cursor-pointer transition-colors whitespace-nowrap ${
                            active ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
                          }`}
                        >
                          {active && (
                            <PillMotion
                              layoutId="kpi-rules-holidays-pill"
                              aria-hidden
                              transition={SPRING_TAB_PILL}
                              className={CAPSULE_PILL_CLS}
                            />
                          )}
                          <span className="relative z-10">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                    {tForm.excludeHolidays ? 'Excluded' : 'Included'}
                  </span>
                )}
              </div>

              {tForm.excludeHolidays ? (
                <div className="flex items-center gap-2">
                  {isAdmin ? (
                    <div className="relative flex-1">
                      <input
                        type="number"
                        min="0"
                        max="15"
                        step="0.5"
                        value={tForm.holidayDaysCount}
                        onChange={(e) => setTForm((prev) => ({ ...prev, holidayDaysCount: Math.max(0, Number(e.target.value) || 0) }))}
                        className="w-full px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-slate-50 focus:bg-white text-slate-900 tabular-nums outline-none focus:border-[#1e5b88]"
                      />
                      <span className="absolute right-2.5 top-1.5 text-xs text-slate-400 pointer-events-none">holidays deducted</span>
                    </div>
                  ) : (
                    <span className="text-xs text-rose-600 font-medium tabular-nums">-{tForm.holidayDaysCount} days deducted</span>
                  )}
                </div>
              ) : (
                <div className="text-xs text-slate-600 py-1.5">No public holidays deducted from target days.</div>
              )}
            </div>

            {/* Effective Target Days Summary (3 cols) */}
            <div className="md:col-span-3 bg-slate-50 rounded-lg p-2.5 border border-slate-100 flex flex-col justify-center">
              <div className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-600">Effective Workdays</div>
              <div className="text-lg font-bold text-[#002F4A] tabular-nums leading-tight">
                {effectiveWorkDays} <span className="text-xs font-normal text-slate-600">days in month</span>
              </div>
              <div className="text-[10.5px] text-slate-600">
                {tForm.excludeHolidays && tForm.holidayDaysCount > 0
                  ? `${tForm.workDaysInMonth} days - ${tForm.holidayDaysCount} holidays`
                  : `${tForm.workDaysInMonth} days full count`}
              </div>
            </div>
          </div>

          {/* D / M Targets Grid (4 Clean Cards: Staff base first, Branch dynamically follows) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 pt-1">
            {([
              { key: 'staffDailyTarget', label: 'Staff · Daily (Individual)', unit: 'pts/day', helper: 'Individual base daily target' },
              { key: 'staffMonthlyTarget', label: 'Staff · Monthly (Individual)', unit: 'pts/mo', helper: `Daily × Work Days (${tForm.staffDailyTarget * effectiveWorkDays} pts)` },
              { key: 'branchDailyTarget', label: 'Branch · Daily (Benchmark)', unit: 'pts/day', helper: `Dynamic: Staff Daily (${tForm.staffDailyTarget} pts) × 5 staff benchmark` },
              { key: 'branchMonthlyTarget', label: 'Branch · Monthly (Benchmark)', unit: 'pts/mo', helper: `Dynamic: Staff Monthly (${tForm.staffMonthlyTarget} pts) × 5 staff benchmark` },
            ] as const).map(({ key, label, unit, helper }) => (
              <div key={key} className="bg-white rounded-lg border border-slate-200 p-2.5">
                <div className="flex items-center justify-between gap-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">{label}</label>
                  <span className="text-[10px] font-medium text-slate-500">{unit}</span>
                </div>
                {isAdmin ? (
                  <div className="relative mt-1">
                    <input
                      type="number"
                      min="0"
                      step={key.includes('Daily') ? '1' : '5'}
                      value={tForm[key]}
                      onChange={(e) => {
                        const val = Math.max(0, Number(e.target.value) || 0);
                        setTForm((prev) => {
                          const next = { ...prev, [key]: val };
                          const eff = effectiveWorkDays;
                          const weeklyDays = prev.workingDaysMode === 'mon_fri' ? 5 : 6;
                          const staffPerBranchMultiplier = 5;

                          if (key === 'staffDailyTarget') {
                            next.staffMonthlyTarget = Math.round(val * eff);
                            next.staffWeeklyTarget = Math.round(val * weeklyDays);
                            next.staffQuarterlyTarget = next.staffMonthlyTarget * 3;
                            // Branch target dynamically follows individual target (auto-multiplies by staff benchmark)
                            next.branchDailyTarget = val * staffPerBranchMultiplier;
                            next.branchMonthlyTarget = next.staffMonthlyTarget * staffPerBranchMultiplier;
                            next.branchWeeklyTarget = next.staffWeeklyTarget * staffPerBranchMultiplier;
                            next.branchQuarterlyTarget = next.staffQuarterlyTarget * staffPerBranchMultiplier;
                          } else if (key === 'staffMonthlyTarget') {
                            next.staffDailyTarget = eff > 0 ? Math.round(val / eff) : val;
                            next.staffWeeklyTarget = Math.round(next.staffDailyTarget * weeklyDays);
                            next.staffQuarterlyTarget = val * 3;
                            // Branch target dynamically follows individual target
                            next.branchMonthlyTarget = val * staffPerBranchMultiplier;
                            next.branchDailyTarget = next.staffDailyTarget * staffPerBranchMultiplier;
                            next.branchWeeklyTarget = next.staffWeeklyTarget * staffPerBranchMultiplier;
                            next.branchQuarterlyTarget = next.branchMonthlyTarget * 3;
                          } else if (key === 'branchDailyTarget') {
                            next.branchMonthlyTarget = Math.round(val * eff);
                            next.branchWeeklyTarget = Math.round(val * weeklyDays);
                            next.branchQuarterlyTarget = next.branchMonthlyTarget * 3;
                          } else if (key === 'branchMonthlyTarget') {
                            next.branchQuarterlyTarget = val * 3;
                          }
                          return next;
                        });
                      }}
                      className="w-full text-base font-bold text-[#002F4A] tabular-nums px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:border-[#1e5b88] outline-none"
                    />
                  </div>
                ) : (
                  <div className="text-base font-bold text-[#002F4A] tabular-nums mt-1">{fmtPts(tForm[key])} <span className="text-xs font-normal text-slate-500">pts</span></div>
                )}
                <p className="text-[11px] text-slate-500 mt-1 leading-tight">{helper}</p>
              </div>
            ))}
          </div>

          <div className="text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/60">
            <span>
              Individual Target: Daily (<strong>{tForm.staffDailyTarget} pts</strong>) × {effectiveWorkDays} work days = <strong className="text-slate-800">{Math.round(tForm.staffDailyTarget * effectiveWorkDays)} pts/mo</strong>
            </span>
            <span>
              Branch Target: Dynamically multiplies Individual Target by the number of staff in each branch (Benchmark 5 staff: <strong className="text-slate-800">{Math.round(tForm.staffDailyTarget * effectiveWorkDays * 5)} pts/mo</strong>)
            </span>
          </div>
          </div>
      </section>

      {/* ───────────── 3. Management Level KPI Exemption (User-Defined) ───────────── */}
      <section className="rounded-2xl border border-indigo-200/80 bg-gradient-to-br from-indigo-50/40 via-white to-slate-50/50 p-5 space-y-3.5 shadow-2xs" aria-label="Management Level KPI Exemption">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-700 border border-indigo-200 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-4 h-4" aria-hidden />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-xs sm:text-sm font-bold text-slate-900">Management Level KPI Exemption (0 Target · Non-Mandatory)</h4>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 border border-indigo-200/80 tabular-nums">
                    {exemptStaff.length} defined
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Define staff members who are management level. Personnel added here do not count towards mandatory frontline KPI targets (assigned 0 target with &quot;Management (Exempt)&quot; rating).
                </p>
              </div>
            </div>

            {isAdmin && (
              <button
                type="button"
                onClick={() => setShowCustomAdd((v) => !v)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-white text-indigo-700 border border-indigo-200 hover:bg-indigo-50 cursor-pointer shadow-2xs transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{showCustomAdd ? 'Close Custom Entry' : 'Add Custom / Unlisted Staff'}</span>
              </button>
            )}
          </div>

          {/* Quick Staff Selector (Add from Directory) */}
          {isAdmin && (
            <div className="bg-white rounded-xl border border-slate-200/90 p-3 shadow-2xs">
              <div className="text-[11px] font-semibold text-slate-700 mb-2 flex items-center justify-between">
                <span>Select staff from bank directory to add to Management Exemption:</span>
                <span className="text-[10px] text-slate-400 font-normal">Only defined staff will be exempt from KPI</span>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="relative flex-1">
                  <select
                    value={selectedStaffKey}
                    onChange={(e) => setSelectedStaffKey(e.target.value)}
                    className="w-full text-xs rounded-lg border border-slate-200/90 bg-slate-50/60 focus:bg-white px-3 py-2 cursor-pointer text-slate-800 font-normal outline-none focus:border-indigo-400 transition"
                  >
                    <option value="">— Select a staff member to exempt ({availableSelectableStaff.length} available) —</option>
                    {availableSelectableStaff.map((s) => (
                      <option key={(s.staffId || s.staffName).toLowerCase()} value={(s.staffId || s.staffName).toLowerCase()}>
                        {s.staffName} (ID: {s.staffId || '—'}) — {s.position} · Branch {s.branchId} ({s.branchName})
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  disabled={!selectedStaffKey}
                  onClick={handleAddSelectedStaff}
                  className={`inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold shrink-0 cursor-pointer transition shadow-2xs ${
                    selectedStaffKey
                      ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                      : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add to Management (Exempt)</span>
                </button>
              </div>

              {/* Custom / Unlisted Staff Form */}
              {showCustomAdd && (
                <form onSubmit={handleAddCustomStaff} className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-600 mb-1">Staff Name *</label>
                    <input
                      required
                      value={customStaffName}
                      onChange={(e) => setCustomStaffName(e.target.value)}
                      placeholder="e.g. NGET Monioudom"
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-600 mb-1">Staff ID (Optional)</label>
                    <input
                      value={customStaffId}
                      onChange={(e) => setCustomStaffId(e.target.value)}
                      placeholder="e.g. 10764"
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-600 mb-1">Position / Title</label>
                    <input
                      value={customStaffPos}
                      onChange={(e) => setCustomStaffPos(e.target.value)}
                      placeholder="e.g. MS Team Leader"
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-600 mb-1">Branch Code</label>
                    <input
                      value={customStaffBranch}
                      onChange={(e) => setCustomStaffBranch(e.target.value)}
                      placeholder="e.g. 100"
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white font-mono"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="submit"
                      className="btn btn-primary text-xs py-1.5 px-3 flex-1 justify-center"
                    >
                      <Plus className="w-3.5 h-3.5" /> Save Exempt Staff
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCustomAdd(false)}
                      className="btn btn-secondary text-xs py-1.5 px-2"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* List of Defined Management Exempt Personnel */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
            <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                <Users className="w-3.5 h-3.5 text-indigo-600" />
                <span>Defined Management Roster ({exemptStaff.length})</span>
              </div>
              {exemptStaff.length > 3 && (
                <div className="relative min-w-[180px]">
                  <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={exemptFilter}
                    onChange={(e) => setExemptFilter(e.target.value)}
                    placeholder="Filter exempt staff…"
                    className="w-full pl-7 pr-2.5 py-1 text-xs rounded-lg border border-slate-200 bg-white outline-none"
                  />
                </div>
              )}
            </div>

            {exemptStaff.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                <ShieldCheck className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="font-medium text-slate-700">No management staff defined yet.</p>
                <p className="text-slate-500 text-[11px] mt-0.5">
                  All staff members are currently tracked for mandatory KPI targets. Select a staff member above to designate them as Management (Exempt from KPI).
                </p>
              </div>
            ) : filteredExemptStaff.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-400">
                No exempt staff matching &quot;{exemptFilter}&quot;.
              </div>
            ) : (
              <div className="overflow-x-auto overflow-y-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-600 text-[11px] font-semibold uppercase tracking-wider">
                      <th className="py-2 px-3 w-10 text-center">#</th>
                      <th className="py-2 px-3 w-24">Staff ID</th>
                      <th className="py-2 px-3">Staff Name</th>
                      <th className="py-2 px-3">Position</th>
                      <th className="py-2 px-3">Branch</th>
                      <th className="py-2 px-3 text-center">KPI Status</th>
                      {isAdmin && <th className="py-2 px-3 text-right w-24">Action</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {filteredExemptStaff.map((s, idx) => (
                      <tr key={s.staffId || s.staffName} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2 px-3 text-center text-slate-400 font-mono text-[11px]">{idx + 1}</td>
                        <td className="py-2 px-3 font-mono font-medium text-slate-700">
                          <span className="bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 text-[11px]">
                            {s.staffId || '—'}
                          </span>
                        </td>
                        <td className="py-2 px-3 font-medium text-slate-900">
                          <span className="inline-flex items-center gap-1.5">
                            <ShieldCheck className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                            <span>{s.staffName}</span>
                          </span>
                        </td>
                        <td className="py-2 px-3 text-slate-600">{s.position || 'Management'}</td>
                        <td className="py-2 px-3 text-slate-600">
                          {s.branchId ? `${s.branchId} · ${s.branchName || 'Branch'}` : '—'}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                            <ShieldCheck className="w-3 h-3" /> Exempt (0 Target)
                          </span>
                        </td>
                        {isAdmin && (
                          <td className="py-2 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => handleRemoveExemptStaff(s.staffId || s.staffName, s.staffName)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded text-rose-600 hover:text-rose-700 hover:bg-rose-50 text-[11px] font-medium cursor-pointer transition"
                              title="Remove from Management exemption (will count for KPI)"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Remove</span>
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
      </section>

      {/* ───────────── 4. KPI Point Matrix ───────────── */}
      <section className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden" aria-label="KPI Point Matrix">
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Settings2 className="w-4 h-4 text-[#1e5b88] shrink-0" aria-hidden />
            <h3 className="text-[13.5px] font-semibold text-slate-900">KPI Point Matrix</h3>
            <span className="text-[12px] text-slate-500 font-medium">
              · {isAdmin ? 'admin editable point weights' : 'official scoring guide'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className={`${CAPSULE_TRACK_COMPACT_CLS} text-[11px] flex-wrap`} role="tablist" aria-label="KPI category filter">
              {(['ALL', 'POS Terminal', 'Sound Box', 'KHQR', 'Credit Card', 'Merchant Visit'] as const).map((c) => {
                const active = catFilter === c;
                return (
                  <button
                    key={c}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setCatFilter(c)}
                    className={`relative px-2.5 py-1 rounded-full cursor-pointer transition-colors whitespace-nowrap ${
                      active ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
                    }`}
                  >
                    {active && (
                      <PillMotion
                        layoutId="kpi-rules-cat-pill"
                        aria-hidden
                        transition={SPRING_TAB_PILL}
                        className={CAPSULE_PILL_CLS}
                      />
                    )}
                    <span className="relative z-10">{c === 'ALL' ? 'All categories' : c}</span>
                  </button>
                );
              })}
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={handleSyncCheck}
                disabled={Boolean(syncBusy)}
                data-kpi-sync
                title="Find Merchant Visit app tasks that have no KPI task yet and add them"
                className="btn btn-secondary text-xs py-1.5 px-3 cursor-pointer disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncBusy === 'check' ? 'animate-spin' : ''}`} /> Sync from Merchant Visit
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                onClick={() => setShowAdd((s) => !s)}
                className="btn btn-primary text-xs py-1.5 px-3 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Add KPI Task
              </button>
            )}
          </div>
        </div>

        {isAdmin && showAdd && (
          <div className="p-4 border-b border-slate-200 bg-slate-50/70">
            <form onSubmit={handleAddRule} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 items-end">
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
                  onChange={(e) => {
                    const c = e.target.value as KpiCategory;
                    setNewCat(c);
                    if (c === 'Merchant Visit' && newSub.trim()) setNewCode(mvCodeOf(newSub));
                  }}
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white"
                >
                  <option value="POS Terminal">POS Terminal</option>
                  <option value="Sound Box">Sound Box</option>
                  <option value="KHQR">KHQR</option>
                  <option value="Credit Card">Credit Card</option>
                  <option value="Merchant Visit">Merchant Visit</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-600 mb-1">Sub-Category / Task Name</label>
                <input
                  value={newSub}
                  onChange={(e) => {
                    setNewSub(e.target.value);
                    if (newCat === 'Merchant Visit') setNewCode(mvCodeOf(e.target.value));
                  }}
                  placeholder={newCat === 'Merchant Visit' ? 'The activity name, exactly as in the app (e.g. Account Opening)' : 'e.g. Merchant Staff Training'}
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
          </div>
        )}

        <div className="overflow-x-auto overflow-y-hidden min-h-[380px] transition-all">
          <table className="w-full text-left border-collapse min-w-[820px]">
            <thead>
              <tr className="glass-table-thead navy-header-bar bg-[#002F4A] text-white text-[11px] font-medium uppercase tracking-wider">
                <th className="py-2.5 px-3.5 text-right w-12">No.</th>
                <SortTh k="category" sort={ruleSort} onSort={toggleRuleSort} className="py-2.5 px-3.5 whitespace-nowrap">Category</SortTh>
                <SortTh k="subCategory" sort={ruleSort} onSort={toggleRuleSort} className="py-2.5 px-3.5 whitespace-nowrap">Sub-Category / KPI Task</SortTh>
                <SortTh k="description" sort={ruleSort} onSort={toggleRuleSort} className="py-2.5 px-3.5 whitespace-nowrap">Verification &amp; Source Rule</SortTh>
                <SortTh k="unit" sort={ruleSort} onSort={toggleRuleSort} className="py-2.5 px-3.5 whitespace-nowrap">Unit</SortTh>
                <SortTh k="points" sort={ruleSort} onSort={toggleRuleSort} align="right" className="py-2.5 px-3.5 text-right whitespace-nowrap">KPI Point</SortTh>
                <SortTh k="status" sort={ruleSort} onSort={toggleRuleSort} align="center" className="py-2.5 px-3.5 text-center whitespace-nowrap">Status</SortTh>
                {isAdmin && <th className="py-2.5 px-3.5 text-right">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/90 text-[13px] text-slate-700 silk-rows">
              {sortedRules.map((r, i) => (
                <KpiRuleRow
                  key={r.code}
                  rule={r}
                  index={i}
                  isAdmin={isAdmin}
                  onSaveRule={saveRule}
                  onRequestDelete={setDeleteTarget}
                  savingCode={savingCode}
                  deletingCode={deletingCode}
                  isNew={newlySynced.has(r.code)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {syncPreview && (
        createPortal(
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="kpi-sync-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !syncBusy) setSyncPreview(null);
          }}
        >
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-700 shrink-0">
                  <RefreshCw className="w-4 h-4" />
                </div>
                <div>
                  <h3 id="kpi-sync-title" className="text-sm font-bold text-slate-900">Sync KPI tasks from Merchant Visit</h3>
                  <p className="text-[11px] text-slate-500">
                    {syncPreview.activitiesChecked} task type(s) in the app · {syncPreview.alreadyHaveRule} already have a KPI task
                  </p>
                </div>
              </div>
              <button type="button" aria-label="Close" disabled={Boolean(syncBusy)} onClick={() => setSyncPreview(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer disabled:opacity-50">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 overflow-y-auto flex flex-col gap-3 text-xs">
              {syncPreview.candidates.length > 0 ? (
                <>
                  <p className="text-slate-600">
                    These Merchant Visit tasks have <span className="font-semibold">no KPI task yet</span>, so they give no points today.
                    They will be added at <span className="font-semibold">0 pts and Inactive</span>: no KPI total changes until you set the points and switch them on.
                  </p>
                  <ul className="rounded-xl border border-slate-200 divide-y divide-slate-100" data-kpi-sync-list>
                    {syncPreview.candidates.map((c) => (
                      <li key={c.code} className="px-3 py-2 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 truncate">{c.subCategory}</div>
                          <div className="text-[11px] text-slate-500 font-mono truncate">{c.code} · {c.category}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-semibold text-slate-800 tabular-nums">{c.visits.toLocaleString('en-US')} visit(s)</div>
                          {c.lastSeen && <div className="text-[11px] text-slate-500">last {new Date(c.lastSeen).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</div>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-slate-600">Every Merchant Visit task already has a KPI task, except the ones you deleted.</p>
              )}
              {syncPreview.deletedSkipped.length > 0 && (
                <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5 cursor-pointer">
                  <input type="checkbox" checked={syncIncludeDeleted} onChange={(e) => setSyncIncludeDeleted(e.target.checked)} className="mt-0.5" data-kpi-sync-include-deleted />
                  <span className="text-amber-900">
                    Also bring back {syncPreview.deletedSkipped.length} task(s) you deleted, with their old points and setting:{' '}
                    <span className="font-semibold">{syncPreview.deletedSkipped.map((d) => d.subCategory).join(', ')}</span>
                  </span>
                </label>
              )}
            </div>
            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setSyncPreview(null)} disabled={Boolean(syncBusy)}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-50 cursor-pointer">
                Cancel
              </button>
              <button type="button" onClick={handleSyncApply} data-kpi-sync-apply
                disabled={Boolean(syncBusy) || (!syncPreview.candidates.length && !syncIncludeDeleted)}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-[#eaf4f2] hover:bg-[#d5eae6] text-[#1d5c55] hover:text-[#144741] border border-[#c3e0da] hover:border-[#9fd0c7] disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer transition">
                {syncBusy === 'apply' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Add {syncPreview.candidates.length + (syncIncludeDeleted ? syncPreview.deletedSkipped.length : 0)} KPI task(s)
              </button>
            </div>
          </div>
        </div>,
        document.body
        )
      )}

      {deleteTarget && (
        createPortal(
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-kpi-rule-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !deletingCode) setDeleteTarget(null);
          }}
        >
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 shrink-0">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <h3 id="delete-kpi-rule-title" className="text-sm font-bold text-slate-900">
                    Delete KPI Type
                  </h3>
                  <p className="text-[11px] text-slate-500">Permanent rule removal</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !deletingCode && setDeleteTarget(null)}
                disabled={Boolean(deletingCode)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
                aria-label="Close delete dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3.5">
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 text-xs space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-900 text-sm">{deleteTarget.subCategory}</span>
                  <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border shrink-0 ${(CAT_COLORS[deleteTarget.category] || CAT_COLORS.Other).badge}`}>
                    {deleteTarget.category}
                  </span>
                </div>
                <div className="text-slate-600">
                  Code: <span className="font-mono font-semibold text-slate-800">{deleteTarget.code}</span>
                  {' · '}
                  Weight: <span className="font-semibold text-slate-800 tabular-nums">{fmtPts(deleteTarget.points)} pts</span>{' '}
                  <span className="text-slate-500">({deleteTarget.unit})</span>
                </div>
                {deleteTarget.description && (
                  <div className="text-[11px] text-slate-500 leading-snug">{deleteTarget.description}</div>
                )}
              </div>

              <p className="text-xs text-slate-600 leading-relaxed">
                This permanently removes <span className="font-semibold text-slate-800">{deleteTarget.subCategory}</span> from KPI Points &amp; Rules and stops counting it toward KPI points and tasks. Underlying activity submissions and the Audit Trail are preserved. &quot;Sync from Merchant Visit&quot; will not add it back unless you choose to.
              </p>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={Boolean(deletingCode)}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                data-kpi-confirm-delete={deleteTarget.code}
                onClick={handleConfirmDeleteRule}
                disabled={Boolean(deletingCode)}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-60 inline-flex items-center gap-1.5 cursor-pointer"
              >
                {deletingCode ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                {deletingCode ? 'Deleting...' : 'Delete KPI Type'}
              </button>
            </div>
          </div>
        </div>,
        document.body
        )
      )}
    </div>
  );
});

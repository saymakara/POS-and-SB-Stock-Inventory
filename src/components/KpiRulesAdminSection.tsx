import React, { memo, useState, useEffect, useMemo } from 'react';
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
} from 'lucide-react';
import {
  KpiPointRule,
  KpiTargets,
  KpiCategory,
  saveKpiRuleOnServer,
  saveKpiTargetsOnServer,
} from '../services/kpiService';

export const CAT_COLORS: Record<KpiCategory, { hex: string; badge: string; bar: string; dot: string; Icon: React.ElementType }> = {
  'POS Terminal': { hex: '#38bdf8', badge: 'bg-sky-50 text-sky-700 border-sky-200/90', bar: 'bg-sky-400', dot: 'bg-sky-400', Icon: Cpu },
  'Sound Box': { hex: '#003857', badge: 'bg-blue-50 text-[#003857] border-blue-200/90', bar: 'bg-[#003857]', dot: 'bg-[#003857]', Icon: Volume2 },
  KHQR: { hex: '#0d9488', badge: 'bg-teal-50 text-teal-700 border-teal-200/90', bar: 'bg-teal-600', dot: 'bg-teal-600', Icon: QrCode },
  'Credit Card': { hex: '#f59e0b', badge: 'bg-amber-50 text-amber-700 border-amber-200/90', bar: 'bg-amber-500', dot: 'bg-amber-500', Icon: CreditCard },
  Other: { hex: '#64748b', badge: 'bg-slate-50 text-slate-600 border-slate-200', bar: 'bg-slate-500', dot: 'bg-slate-500', Icon: Layers },
};

const fmtPts = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 });

export interface KpiRulesAdminSectionProps {
  isAdmin: boolean;
  rules: KpiPointRule[];
  targets: KpiTargets;
  onRuleSaved: (r: KpiPointRule) => void;
  onTargetsSaved: (t: KpiTargets) => void;
  toast: (m: string) => void;
}

export const KpiRulesAdminSection = memo(function KpiRulesAdminSection({
  isAdmin,
  rules,
  targets,
  onRuleSaved,
  onTargetsSaved,
  toast,
}: KpiRulesAdminSectionProps) {
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

  const effectiveWorkDays = useMemo(() => {
    const baseDays = Math.max(1, Number(tForm.workDaysInMonth) || 24);
    if (!tForm.excludeHolidays) return baseDays;
    const holidays = Math.max(0, Number(tForm.holidayDaysCount) || 0);
    return Math.max(1, baseDays - holidays);
  }, [tForm.workDaysInMonth, tForm.excludeHolidays, tForm.holidayDaysCount]);

  const handleAutoCalculateTargets = () => {
    const eff = effectiveWorkDays;
    const staffDaily = Math.max(0, Number(tForm.staffDailyTarget) || 5);
    const branchDaily = Math.max(0, Number(tForm.branchDailyTarget) || 25);
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
              className="btn btn-primary text-xs py-1.5 px-3 cursor-pointer"
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

        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
              <Target className="w-4 h-4 text-[#003857]" />
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
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#003857] hover:bg-[#002b44] text-white text-xs font-medium cursor-pointer disabled:opacity-50 transition"
                >
                  {savingTargets ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save targets
                </button>
              </div>
            )}
          </div>

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
                  <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200 text-[10px] gap-0.5">
                    <button
                      type="button"
                      onClick={() => handleScheduleModeChange('mon_fri')}
                      className={`px-1.5 py-0.5 rounded cursor-pointer transition ${tForm.workingDaysMode === 'mon_fri' ? 'bg-[#003857] text-white font-medium shadow-2xs' : 'text-slate-600 hover:text-slate-900'}`}
                    >
                      Mon–Fri (22d)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleScheduleModeChange('mon_sat')}
                      className={`px-1.5 py-0.5 rounded cursor-pointer transition ${tForm.workingDaysMode === 'mon_sat' ? 'bg-[#003857] text-white font-medium shadow-2xs' : 'text-slate-600 hover:text-slate-900'}`}
                    >
                      Mon–Sat (26d)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleScheduleModeChange('custom')}
                      className={`px-1.5 py-0.5 rounded cursor-pointer transition ${tForm.workingDaysMode === 'custom' ? 'bg-[#003857] text-white font-medium shadow-2xs' : 'text-slate-600 hover:text-slate-900'}`}
                    >
                      Custom
                    </button>
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
                  <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200 text-[10px] gap-0.5">
                    <button
                      type="button"
                      onClick={() => setTForm((prev) => ({ ...prev, excludeHolidays: true }))}
                      className={`px-2 py-0.5 rounded cursor-pointer transition ${tForm.excludeHolidays ? 'bg-rose-600 text-white font-medium shadow-2xs' : 'text-slate-600 hover:text-slate-900'}`}
                    >
                      Exclude Holidays
                    </button>
                    <button
                      type="button"
                      onClick={() => setTForm((prev) => ({ ...prev, excludeHolidays: false }))}
                      className={`px-2 py-0.5 rounded cursor-pointer transition ${!tForm.excludeHolidays ? 'bg-[#003857] text-white font-medium shadow-2xs' : 'text-slate-600 hover:text-slate-900'}`}
                    >
                      Include Holidays
                    </button>
                  </div>
                ) : (
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${tForm.excludeHolidays ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-slate-100 text-slate-700'}`}>
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
              <div className="text-lg font-bold text-[#003857] tabular-nums leading-tight">
                {effectiveWorkDays} <span className="text-xs font-normal text-slate-600">days in month</span>
              </div>
              <div className="text-[10.5px] text-slate-600">
                {tForm.excludeHolidays && tForm.holidayDaysCount > 0
                  ? `${tForm.workDaysInMonth} days - ${tForm.holidayDaysCount} holidays`
                  : `${tForm.workDaysInMonth} days full count`}
              </div>
            </div>
          </div>

          {/* D / M Targets Grid (4 Clean Cards: Day and Month only) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 pt-1">
            {([
              { key: 'branchDailyTarget', label: 'Branch · Daily', unit: 'pts/day', helper: 'Standard: 25 pts/day' },
              { key: 'branchMonthlyTarget', label: 'Branch · Monthly', unit: 'pts/mo', helper: `Daily × Work Days (${tForm.branchDailyTarget * effectiveWorkDays} pts)` },
              { key: 'staffDailyTarget', label: 'Staff · Daily', unit: 'pts/day', helper: 'Standard: 5 pts/day' },
              { key: 'staffMonthlyTarget', label: 'Staff · Monthly', unit: 'pts/mo', helper: `Daily × Work Days (${tForm.staffDailyTarget * effectiveWorkDays} pts)` },
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
                          if (key === 'branchDailyTarget') {
                            next.branchMonthlyTarget = Math.round(val * eff);
                            next.branchWeeklyTarget = Math.round(val * weeklyDays);
                            next.branchQuarterlyTarget = next.branchMonthlyTarget * 3;
                          } else if (key === 'staffDailyTarget') {
                            next.staffMonthlyTarget = Math.round(val * eff);
                            next.staffWeeklyTarget = Math.round(val * weeklyDays);
                            next.staffQuarterlyTarget = next.staffMonthlyTarget * 3;
                          } else if (key === 'branchMonthlyTarget') {
                            next.branchQuarterlyTarget = val * 3;
                          } else if (key === 'staffMonthlyTarget') {
                            next.staffQuarterlyTarget = val * 3;
                          }
                          return next;
                        });
                      }}
                      className="w-full text-base font-bold text-[#003857] tabular-nums px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:border-[#1e5b88] outline-none"
                    />
                  </div>
                ) : (
                  <div className="text-base font-bold text-[#003857] tabular-nums mt-1">{fmtPts(tForm[key])} <span className="text-xs font-normal text-slate-500">pts</span></div>
                )}
                <p className="text-[11px] text-slate-500 mt-1 leading-tight">{helper}</p>
              </div>
            ))}
          </div>

          <div className="text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200/60">
            <span>
              Target formula: Staff Monthly = Daily ({tForm.staffDailyTarget} pts) × {effectiveWorkDays} work days = <strong className="text-slate-800">{Math.round(tForm.staffDailyTarget * effectiveWorkDays)} pts</strong>
            </span>
            <span>
              Branch Monthly = Daily ({tForm.branchDailyTarget} pts) × {effectiveWorkDays} work days = <strong className="text-slate-800">{Math.round(tForm.branchDailyTarget * effectiveWorkDays)} pts</strong>
            </span>
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
                      <div className="text-slate-900" title={r.code}>{r.subCategory}</div>
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
                          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Save
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

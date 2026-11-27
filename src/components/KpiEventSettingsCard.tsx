import { memo, useEffect, useState } from 'react';
import { Loader2, Save, Tent, Info } from 'lucide-react';
import {
  KpiEventSettings,
  BoothMode,
  StandbyMode,
  DEFAULT_KPI_EVENT_SETTINGS,
  fetchKpiEventSettings,
  saveKpiEventSettings,
} from '../services/kpiService';

/**
 * (22 Nov 2026) Settings > KPI Points & Rules (Super Admin): how Booth Event and Standby VIP (AEON) points are worked out,
 * and whether POS Terminal / Sound Box installs and replacements count once per submission or once per device.
 * The default points themselves are the KPI tasks "Booth Event - Full Day / Half Day" and "Standby VIP - Full Day / Half Day".
 */
interface Props { toast: (m: string) => void; onChanged?: () => void }

const BOOTH_OPTIONS: { v: BoothMode; title: string; text: string }[] = [
  { v: 'shared', title: 'Shared by Booth Tag (recommended)', text: 'Staff with the same Booth Tag on the same day: each gets the booth points or their own points, whichever is higher. When the booth\'s tasks together earn more than the booth points of all its staff, everyone gets an equal share instead. Half-day staff count only the tasks done in their hours.' },
  { v: 'higher', title: 'Higher of booth points or own points', text: 'Each staff member alone: the booth points, or the points of their own tasks that day if higher. No sharing.' },
  { v: 'fixed', title: 'Fixed booth points (as before)', text: 'The booth points are added on top of the tasks done that day.' },
];
const STANDBY_OPTIONS: { v: StandbyMode; title: string; text: string }[] = [
  { v: 'higher', title: 'Higher of standby points or own points (recommended)', text: 'Individual, never shared: the standby points, or the points of the staff member\'s own tasks in the standby hours if higher.' },
  { v: 'fixed', title: 'Fixed standby points (as before)', text: 'The standby points are added on top of the tasks done that day.' },
];

export const KpiEventSettingsCard = memo(function KpiEventSettingsCard({ toast, onChanged }: Props) {
  const [saved, setSaved] = useState<KpiEventSettings | null>(null);
  const [form, setForm] = useState<KpiEventSettings>(DEFAULT_KPI_EVENT_SETTINGS);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetchKpiEventSettings().then((s) => {
      if (!live) return;
      if (!s) { setMissing(true); return; }
      setSaved(s); setForm(s);
    });
    return () => { live = false; };
  }, []);

  const changed = !!saved && (form.boothMode !== saved.boothMode || form.standbyMode !== saved.standbyMode
    || form.halfDayWeight !== saved.halfDayWeight || form.installPerSubmission !== saved.installPerSubmission);

  const save = async () => {
    setBusy(true);
    try {
      const s = await saveKpiEventSettings(form);
      setSaved(s); setForm(s);
      toast('Booth / Standby KPI rules saved. Every KPI figure is worked out again with the new rules.');
      onChanged?.();
    } catch (e) {
      toast(`Not saved: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const radio = 'mt-0.5 accent-[#002F4A] cursor-pointer';
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-2xs overflow-hidden" aria-label="Booth Event and Standby VIP KPI" data-kpi-event-settings>
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Tent className="w-4 h-4 text-[#1e5b88]" aria-hidden />
          <h4 className="text-[13.5px] font-semibold text-slate-900">Booth Event, Standby VIP &amp; per-submission KPI</h4>
        </div>
        <button type="button" onClick={save} disabled={!changed || busy || missing} data-kpi-event-save
          className="btn btn-primary text-xs py-1.5 px-3 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save rules
        </button>
      </div>
      {missing ? (
        <p className="px-5 py-3.5 text-xs text-amber-700">These settings need the server update (SQL 20261122_03) before they can be used.</p>
      ) : (
        <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-[12px] font-semibold text-slate-800 mb-1">Booth Event</legend>
            {BOOTH_OPTIONS.map((o) => (
              <label key={o.v} className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer ${form.boothMode === o.v ? 'border-[#002F4A]/40 bg-sky-50/60' : 'border-slate-200'}`}>
                <input type="radio" name="booth-mode" className={radio} checked={form.boothMode === o.v} onChange={() => setForm({ ...form, boothMode: o.v })} data-booth-mode={o.v} />
                <span><span className="font-semibold text-slate-900">{o.title}</span><br /><span className="text-slate-600">{o.text}</span></span>
              </label>
            ))}
            {form.boothMode === 'shared' && (
              <label className="flex items-center gap-2 text-slate-700">
                A half-day staff member counts as
                <select value={String(form.halfDayWeight)} onChange={(e) => setForm({ ...form, halfDayWeight: Number(e.target.value) })} data-half-weight
                  className="px-2 py-1 rounded-lg border border-slate-200 bg-white">
                  {[0.25, 0.5, 0.75, 1].map((w) => <option key={w} value={w}>{w === 1 ? '1 person' : `${w} person`}</option>)}
                </select>
                in the full-day share
              </label>
            )}
          </fieldset>
          <div className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-2">
              <legend className="text-[12px] font-semibold text-slate-800 mb-1">Standby VIP (AEON)</legend>
              {STANDBY_OPTIONS.map((o) => (
                <label key={o.v} className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer ${form.standbyMode === o.v ? 'border-[#002F4A]/40 bg-sky-50/60' : 'border-slate-200'}`}>
                  <input type="radio" name="standby-mode" className={radio} checked={form.standbyMode === o.v} onChange={() => setForm({ ...form, standbyMode: o.v })} data-standby-mode={o.v} />
                  <span><span className="font-semibold text-slate-900">{o.title}</span><br /><span className="text-slate-600">{o.text}</span></span>
                </label>
              ))}
            </fieldset>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-[12px] font-semibold text-slate-800 mb-1">POS Terminal &amp; Sound Box installation / replacement</legend>
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 px-3 py-2 cursor-pointer">
                <input type="checkbox" className={radio} checked={form.installPerSubmission} onChange={(e) => setForm({ ...form, installPerSubmission: e.target.checked })} data-per-submission />
                <span><span className="font-semibold text-slate-900">Once per submission (outlet)</span><br />
                  <span className="text-slate-600">3 terminals installed in one submission = 1 KPI task. Untick to count every device.</span></span>
              </label>
            </fieldset>
          </div>
          <p className="lg:col-span-2 flex items-start gap-2 text-[11px] text-slate-500 leading-relaxed">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              The booth and standby points are the KPI tasks <b>Booth Event - Full Day / Half Day</b> and <b>Standby VIP - Full Day / Half Day</b> in the table below.
              Example (shared, 30 pts full day): 4 staff on tag MA-168 earn 200 pts of tasks together → each gets 50; if they earn 100 → each gets 30.
              Half day uses the Booth / VIP Hours on the form (e.g. 08:00–12:00): 100 pts in the morning by 4 staff → 25 each (or the half-day points if higher).
              {saved?.updatedBy ? ` Last changed by ${saved.updatedBy}.` : ''}
            </span>
          </p>
        </div>
      )}
    </section>
  );
});

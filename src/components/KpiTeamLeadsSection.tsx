import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Users, Plus, Pencil, Trash2, Loader2, Save, X } from 'lucide-react';
import { Branch } from '../types';
import { KpiTeamLead, deleteTeamLead, fetchTeamLeads, saveTeamLead } from '../services/kpiTeamLeadService';

/**
 * (11 Nov 2026) Settings → KPI: Team leads. A team lead (Merchant Visit Staff ID) sees "Team KPI" in the phone app: today's and
 * this month's KPI of the staff in the chosen branches, plus the Staff IDs added by hand. Everyone else sees their own KPI only.
 */
interface Props { canEdit: boolean; branches: Branch[]; toast: (m: string) => void }
type Draft = { staffId: string; staffName: string; branchIds: string[]; members: string; active: boolean; isNew: boolean };
const empty: Draft = { staffId: '', staffName: '', branchIds: [], members: '', active: true, isNew: true };

export const KpiTeamLeadsSection = memo(function KpiTeamLeadsSection({ canEdit, branches, toast }: Props) {
  const [rows, setRows] = useState<KpiTeamLead[] | null>(null);
  const [err, setErr] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useMemo(() => branches.filter((b) => b.id !== '100').sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true })), [branches]);
  const nameOf = useCallback((id: string) => (branches.find((b) => b.id === id) || { name: id }).name, [branches]);
  const load = useCallback(async () => {
    try { setRows(await fetchTeamLeads()); setErr(''); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!draft) return;
    const memberIds = draft.members.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    if (!/^[A-Za-z0-9._-]{1,40}$/.test(draft.staffId.trim())) { toast('Enter the team lead\'s Staff ID.'); return; }
    if (!draft.branchIds.length && !memberIds.length) { toast('Choose at least one branch or add a Staff ID to the team.'); return; }
    setBusy(true);
    try {
      await saveTeamLead({ staffId: draft.staffId, staffName: draft.staffName, branchIds: draft.branchIds, memberIds, active: draft.active });
      toast(`Team lead ${draft.staffName || draft.staffId} saved · they see Team KPI in the phone app.`);
      setDraft(null); await load();
    } catch (e) { toast(`Not saved: ${e instanceof Error ? e.message : String(e)}`); } finally { setBusy(false); }
  };
  const remove = async (t: KpiTeamLead) => {
    if (!window.confirm(`Remove ${t.staffName || t.staffId} as team lead? They will see their own KPI only.`)) return;
    setBusy(true);
    try { await deleteTeamLead(t.staffId); toast(`${t.staffName || t.staffId} is no longer a team lead.`); await load(); }
    catch (e) { toast(`Not removed: ${e instanceof Error ? e.message : String(e)}`); } finally { setBusy(false); }
  };
  const toggleBranch = (id: string) => setDraft((d) => d && ({ ...d, branchIds: d.branchIds.includes(id) ? d.branchIds.filter((x) => x !== id) : [...d.branchIds, id] }));

  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden" aria-label="KPI team leads">
      <div className="px-4 py-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-[#1e5b88] shrink-0" aria-hidden />
          <h3 className="text-[13px] font-semibold text-slate-900">Team leads (Merchant Visit app · Team KPI)</h3>
        </div>
        {canEdit && !draft && (
          <button type="button" onClick={() => setDraft({ ...empty })} className="btn btn-secondary" data-testid="tl-add"><Plus className="w-3.5 h-3.5" aria-hidden />Add team lead</button>
        )}
      </div>
      <div className="p-4">
        <p className="text-[12px] text-slate-600 mb-3">Every staff member sees their own KPI in the app (More → My KPI). A team lead also sees the KPI of the staff in the branches below (More → Team KPI). Figures are the same as on the KPI page.</p>
        {err && <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-[12px] px-3 py-2 mb-3">{err}</div>}
        {draft && (
          <div className="rounded-xl border border-slate-300 p-3 mb-4" aria-label={draft.isNew ? 'New team lead' : 'Edit team lead'}>
            <div className="grid sm:grid-cols-2 gap-3 mb-3">
              <label className="text-[12px] text-slate-700">Staff ID (as in the Merchant Visit app)
                <input value={draft.staffId} disabled={!draft.isNew} onChange={(e) => setDraft({ ...draft, staffId: e.target.value })} maxLength={40} placeholder="e.g. 8986"
                  className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-slate-200 disabled:bg-slate-50" data-testid="tl-id" />
              </label>
              <label className="text-[12px] text-slate-700">Name
                <input value={draft.staffName} onChange={(e) => setDraft({ ...draft, staffName: e.target.value })} maxLength={120} placeholder="e.g. SAY Chanmakara"
                  className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-slate-200" data-testid="tl-name" />
              </label>
            </div>
            <div className="text-[12px] text-slate-700 mb-1.5">Branches of the team ({draft.branchIds.length} chosen)</div>
            <div className="flex flex-wrap gap-1.5 mb-3 max-h-48 overflow-y-auto">
              {list.map((b) => (
                <button key={b.id} type="button" onClick={() => toggleBranch(b.id)} aria-pressed={draft.branchIds.includes(b.id)} data-allow-repeat
                  className={`px-2.5 py-1 rounded-lg border text-[12px] cursor-pointer ${draft.branchIds.includes(b.id) ? 'bg-[#1e5b88] text-white border-[#1e5b88]' : 'bg-white border-slate-200 hover:bg-slate-50'}`}>
                  {b.id} · {b.name}
                </button>
              ))}
            </div>
            <label className="block text-[12px] text-slate-700 mb-3">Other Staff IDs in the team (optional, separated by commas)
              <input value={draft.members} onChange={(e) => setDraft({ ...draft, members: e.target.value })} placeholder="e.g. 27121, 10386"
                className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-slate-200" data-testid="tl-members" />
            </label>
            <label className="inline-flex items-center gap-2 text-[12px] text-slate-700 mb-3">
              <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />Active
            </label>
            <div className="flex items-center gap-2">
              <button type="button" disabled={busy} onClick={save} className="btn btn-primary" data-testid="tl-save">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}Save</button>
              <button type="button" onClick={() => setDraft(null)} className="btn btn-secondary"><X className="w-3.5 h-3.5" />Cancel</button>
            </div>
          </div>
        )}
        {rows === null ? (
          <div className="text-[12px] text-slate-500 py-4 text-center"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading team leads…</div>
        ) : !rows.length ? (
          <div className="text-[12px] text-slate-500 py-4 text-center">No team leads yet.</div>
        ) : (
          <table className="w-full text-[12.5px]">
            <thead><tr className="text-left text-slate-500 border-b border-slate-200"><th className="py-1.5 pr-3 font-medium">Team lead</th><th className="py-1.5 pr-3 font-medium">Branches</th><th className="py-1.5 pr-3 font-medium">Other staff</th><th className="py-1.5 pr-3 font-medium">Status</th>{canEdit && <th />}</tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.staffId} className="border-b border-slate-100 align-top">
                  <td className="py-2 pr-3"><span className="font-medium text-slate-900">{t.staffName || '—'}</span><span className="block text-[11px] text-slate-500">Staff ID {t.staffId}</span></td>
                  <td className="py-2 pr-3">{t.branchIds.length ? t.branchIds.map((b) => `${b} ${nameOf(b)}`).join(', ') : '—'}</td>
                  <td className="py-2 pr-3">{t.memberIds.length ? t.memberIds.join(', ') : '—'}</td>
                  <td className="py-2 pr-3">{t.active ? <span className="chip chip-green">Active</span> : <span className="chip chip-slate">Off</span>}</td>
                  {canEdit && (
                    <td className="py-2 text-right whitespace-nowrap">
                      <button type="button" aria-label={`Edit ${t.staffId}`} onClick={() => setDraft({ staffId: t.staffId, staffName: t.staffName, branchIds: t.branchIds, members: t.memberIds.join(', '), active: t.active, isNew: false })}
                        className="p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer"><Pencil className="w-3.5 h-3.5" /></button>
                      <button type="button" aria-label={`Remove ${t.staffId}`} disabled={busy} onClick={() => remove(t)} className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-600 cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
});

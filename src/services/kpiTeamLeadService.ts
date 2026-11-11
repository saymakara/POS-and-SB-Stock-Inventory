import { supabase } from '../lib/supabase';

/**
 * (11 Nov 2026) KPI team leads: who sees "Team KPI" in the Merchant Visit app (More → Team KPI) and for which staff -
 * the staff of the chosen branches plus Staff IDs added by hand. Kept by Admin HQ through kpi_team_lead_* (Admin only).
 */
export interface KpiTeamLead { staffId: string; staffName: string; branchIds: string[]; memberIds: string[]; active: boolean; updatedBy: string | null; updatedAt: string | null }

const missing = (m: string) => /kpi_team_lead|PGRST202|does not exist|schema cache/i.test(m);
const SETUP = 'The database needs the update 20261111_02_kpi_team_leads.sql first.';

export async function fetchTeamLeads(): Promise<KpiTeamLead[]> {
  const { data, error } = await supabase.rpc('kpi_team_lead_list');
  if (error) throw new Error(missing(error.message) ? SETUP : error.message);
  return (Array.isArray(data) ? data : []).map((r: any) => ({
    staffId: String(r.staff_id), staffName: r.staff_name || '', branchIds: Array.isArray(r.branch_ids) ? r.branch_ids.map(String) : [],
    memberIds: Array.isArray(r.member_ids) ? r.member_ids.map(String) : [], active: r.active !== false, updatedBy: r.updated_by ?? null, updatedAt: r.updated_at ?? null,
  }));
}
export async function saveTeamLead(t: { staffId: string; staffName: string; branchIds: string[]; memberIds: string[]; active: boolean }): Promise<void> {
  const { error } = await supabase.rpc('kpi_team_lead_save', { p: { staff_id: t.staffId.trim(), staff_name: t.staffName.trim(), branch_ids: t.branchIds, member_ids: t.memberIds, active: t.active } });
  if (error) throw new Error(missing(error.message) ? SETUP : error.message);
}
export async function deleteTeamLead(staffId: string): Promise<void> {
  const { error } = await supabase.rpc('kpi_team_lead_delete', { p_staff_id: staffId });
  if (error) throw new Error(missing(error.message) ? SETUP : error.message);
}

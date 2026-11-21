-- ============================================================================================================================
-- 21 Nov 2026 - Allow Super Admin to permanently delete any unused KPI rule / type from KPI Points & Rules.
--
-- Previously, public.kpi_delete_rule(p_code) refused rows with is_system = true, which included all seeded KPI types
-- (such as legacy Booth Event, Standby VIP Merchant, or unused Merchant Visit activities). Removing a rule deletes it
-- from public.kpi_point_rules and stops counting it toward KPI points/tasks while leaving underlying records
-- (field_events, mv_visits, cc_entries, qr_installations) and historical audit logs intact.
-- Clears app.kpi_summary_cache so the portal KPI dashboard and phone My KPI reflect the change immediately.
-- Safe to run twice.
-- ============================================================================================================================

create or replace function public.kpi_delete_rule(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.staff_profiles;
  r public.kpi_point_rules;
  v_code text := upper(btrim(coalesce(p_code, '')));
begin
  select * into me
    from public.staff_profiles
   where user_id = auth.uid()
     and active
     and not must_change_password;

  if not found or me.role <> 'SUPER_ADMIN' then
    raise exception 'Only a Super Admin can delete KPI point rules.' using errcode = '42501';
  end if;

  if v_code = '' then
    raise exception 'KPI rule code is required.' using errcode = '22023';
  end if;

  select * into r from public.kpi_point_rules where code = v_code for update;
  if not found then
    return jsonb_build_object('ok', true, 'code', v_code);
  end if;

  delete from public.kpi_point_rules where code = v_code;

  if to_regclass('app.kpi_summary_cache') is not null then
    delete from app.kpi_summary_cache;
  end if;

  insert into public.audit_logs (title, detail, branch_id, action, target, actor_id, actor_emp, actor_name, role, status)
  values (
    'KPI Rule Deleted',
    r.code || ' · ' || r.category || ' · ' || r.sub_category || ' (' || r.points || ' pts)',
    '100',
    'KPI_RULE_DELETE',
    r.code,
    me.user_id,
    me.emp_id,
    me.name,
    me.role,
    'Success'
  );

  return jsonb_build_object('ok', true, 'code', r.code, 'sub_category', r.sub_category);
end $$;

revoke all on function public.kpi_delete_rule(text) from public, anon;
grant execute on function public.kpi_delete_rule(text) to authenticated, service_role;

notify pgrst, 'reload schema';

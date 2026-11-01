-- =====================================================================================================================
-- 16 (1 Nov 2026) KPI Work Days in Month & Exclude/Include Public Holiday Settings
-- =====================================================================================================================

alter table public.kpi_settings
  add column if not exists work_days_in_month numeric(5, 1) not null default 24,
  add column if not exists exclude_holidays boolean not null default true,
  add column if not exists holiday_days_count numeric(5, 1) not null default 0,
  add column if not exists working_days_mode text not null default 'mon_sat';

create or replace function public.kpi_save_targets(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.kpi_settings; v_by text := app.label();
begin
  if not app.is_admin() then
    raise exception 'Only Admin HQ can change KPI targets.' using errcode = '42501';
  end if;
  update public.kpi_settings set
    branch_daily_target     = greatest(0, coalesce((p->>'branch_daily_target')::numeric, branch_daily_target)),
    branch_weekly_target    = greatest(0, coalesce((p->>'branch_weekly_target')::numeric, branch_weekly_target)),
    branch_monthly_target   = greatest(0, coalesce((p->>'branch_monthly_target')::numeric, branch_monthly_target)),
    branch_quarterly_target = greatest(0, coalesce((p->>'branch_quarterly_target')::numeric, branch_quarterly_target)),
    staff_daily_target      = greatest(0, coalesce((p->>'staff_daily_target')::numeric, staff_daily_target)),
    staff_weekly_target     = greatest(0, coalesce((p->>'staff_weekly_target')::numeric, staff_weekly_target)),
    staff_monthly_target    = greatest(0, coalesce((p->>'staff_monthly_target')::numeric, staff_monthly_target)),
    staff_quarterly_target  = greatest(0, coalesce((p->>'staff_quarterly_target')::numeric, staff_quarterly_target)),
    work_days_in_month      = greatest(1, coalesce((p->>'work_days_in_month')::numeric, work_days_in_month)),
    exclude_holidays        = coalesce((p->>'exclude_holidays')::boolean, exclude_holidays),
    holiday_days_count      = greatest(0, coalesce((p->>'holiday_days_count')::numeric, holiday_days_count)),
    working_days_mode       = coalesce(p->>'working_days_mode', working_days_mode),
    updated_by              = v_by,
    updated_at              = now()
  where id = 1
  returning * into r;

  insert into public.audit_logs (title, detail, action, target, branch_id)
  values ('KPI Targets Updated',
          'Branch: ' || r.branch_monthly_target || ' · Staff: ' || r.staff_monthly_target || ' · Work Days: ' || r.work_days_in_month || ' (Holidays ' || case when r.exclude_holidays then 'Excluded' else 'Included' end || ')',
          'KPI_TARGETS_SAVE', 'KPI_SETTINGS', '100');
  return to_jsonb(r);
end $$;

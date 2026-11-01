-- =====================================================================================================================
-- 21 (1 Nov 2026) KPI Targets: Count by Daily Target 25 Pts/Day, Keep Only Day & Month Targets
-- =====================================================================================================================

alter table public.kpi_settings
  alter column branch_daily_target set default 25,
  alter column branch_monthly_target set default 550;

update public.kpi_settings set
  branch_daily_target = 25,
  branch_monthly_target = 25 * greatest(1, (work_days_in_month - case when exclude_holidays then holiday_days_count else 0 end)),
  staff_daily_target = greatest(1, coalesce(staff_daily_target, 5)),
  staff_monthly_target = greatest(1, coalesce(staff_daily_target, 5)) * greatest(1, (work_days_in_month - case when exclude_holidays then holiday_days_count else 0 end)),
  updated_at = now()
where id = 1;

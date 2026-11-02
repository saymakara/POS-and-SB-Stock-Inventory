-- Migration: 20261102_02_kpi_count_pending_tasks.sql
-- Description: Count submitted tasks even when not yet approved (status in 'APPROVED', 'PENDING').
-- Deduct tasks only if explicitly REJECTED.
-- Applies to POS Terminal, Sound Box (field_events) and Credit Card (cc_entries).

create or replace function public.kpi_dashboard_summary(p_since date default null, p_until date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_rules jsonb;
  v_targets jsonb;
  v_staff jsonb;
  v_daily jsonb;
  v_weekly jsonb;
  v_monthly jsonb;
  v_quarterly jsonb;
  v_monthly_staff jsonb;
  v_daily_branch jsonb;
  v_daily_staff jsonb;
  v_keep timestamptz := now() - interval '90 days';
  v_exclude_weekend boolean := true;
  v_exclude_holiday boolean := true;
begin
  -- Rules
  select coalesce(jsonb_agg(to_jsonb(r) order by r.sort_order, r.code), '[]'::jsonb)
    into v_rules
    from public.kpi_point_rules r;

  -- Targets
  select to_jsonb(s) into v_targets from public.kpi_settings s where s.id = 1;
  if v_targets is null then
    v_targets := jsonb_build_object(
      'branch_daily_target', 20,
      'branch_weekly_target', 100,
      'branch_monthly_target', 420,
      'branch_quarterly_target', 1260,
      'staff_daily_target', 5,
      'staff_weekly_target', 25,
      'staff_monthly_target', 105,
      'staff_quarterly_target', 315,
      'work_days_in_month', 21,
      'exclude_holidays', true,
      'holiday_days_count', 0,
      'working_days_mode', 'mon_fri'
    );
  end if;

  v_exclude_weekend := coalesce(v_targets->>'working_days_mode', 'mon_fri') = 'mon_fri';
  v_exclude_holiday := coalesce((v_targets->>'exclude_holidays')::boolean, true);

  -- 1) Staff raw aggregated counts over period
  -- Count submitted tasks (APPROVED or PENDING) on working days
  with raw_events as (
    select
      coalesce(nullif(trim(fe.staff_id), ''), 'UNKNOWN') as staff_id,
      nullif(trim(fe.staff_name), '') as staff_name,
      coalesce(fe.branch_id, app.resolve_branch(fe.branch_text), 'UNASSIGNED') as branch_id,
      nullif(trim(fe.branch_text), '') as branch_text,
      (case when coalesce(fe.device_type, 'POS Terminal') <> 'Sound Box' and fe.kind = 'INSTALL' and fe.status in ('APPROVED', 'PENDING') then 1 else 0 end) as pos_install,
      (case when coalesce(fe.device_type, 'POS Terminal') <> 'Sound Box' and fe.kind = 'REPLACE' and fe.status in ('APPROVED', 'PENDING') then 1 else 0 end) as pos_replace,
      (case when coalesce(fe.device_type, 'POS Terminal') <> 'Sound Box' and fe.kind = 'BATTERY' and fe.status in ('APPROVED', 'PENDING') then 1 else 0 end) as pos_battery,
      (case when fe.device_type = 'Sound Box' and fe.kind = 'INSTALL' and fe.status in ('APPROVED', 'PENDING') then 1 else 0 end) as sb_install,
      (case when fe.device_type = 'Sound Box' and fe.kind = 'REPLACE' and fe.status in ('APPROVED', 'PENDING') then 1 else 0 end) as sb_replace,
      (case when fe.device_type = 'Sound Box' and fe.kind = 'SB_MAINT' and fe.status in ('APPROVED', 'PENDING') then 1 else 0 end) as sb_maint,
      (case when fe.device_type = 'Sound Box' and fe.kind = 'SB_RETURN' and fe.status in ('APPROVED', 'PENDING') then 1 else 0 end) as sb_return,
      0 as khqr_install, 0 as khqr_replace, 0 as khqr_materials,
      0 as cc_primary, 0 as cc_supp,
      (case when coalesce(fe.device_type, 'POS Terminal') <> 'Sound Box' then 1 else 0 end) as pos_submitted,
      (case when coalesce(fe.device_type, 'POS Terminal') <> 'Sound Box' and fe.status = 'REJECTED' then 1 else 0 end) as pos_rejected,
      (case when fe.device_type = 'Sound Box' then 1 else 0 end) as sb_submitted,
      (case when fe.device_type = 'Sound Box' and fe.status = 'REJECTED' then 1 else 0 end) as sb_rejected,
      0 as khqr_failed,
      0 as cc_submitted, 0 as cc_rejected
    from public.field_events fe
    where (p_since is null or (coalesce(fe.recorded_at, fe.received_at) at time zone 'Asia/Phnom_Penh')::date >= p_since)
      and (p_until is null or (coalesce(fe.recorded_at, fe.received_at) at time zone 'Asia/Phnom_Penh')::date <= p_until)
      and (not v_exclude_weekend or extract(isodow from (coalesce(fe.recorded_at, fe.received_at) at time zone 'Asia/Phnom_Penh')::date) not in (6, 7))
      and (not v_exclude_holiday or public.get_cambodia_holiday_name((coalesce(fe.recorded_at, fe.received_at) at time zone 'Asia/Phnom_Penh')::date) is null)

    union all

    select
      coalesce(nullif(trim(q.staff_id), ''), 'UNKNOWN') as staff_id,
      nullif(trim(q.staff_name), '') as staff_name,
      coalesce(q.branch_id, app.resolve_branch(q.branch_text), 'UNASSIGNED') as branch_id,
      nullif(trim(q.branch_text), '') as branch_text,
      0, 0, 0, 0, 0, 0, 0,
      (case when q.activity = 'NEW_INSTALLATION' then 1 else 0 end) as khqr_install,
      (case when q.activity = 'QR_REPLACEMENT' then 1 else 0 end) as khqr_replace,
      coalesce(q.qr_count, 0)::int as khqr_materials,
      0, 0,
      0, 0, 0, 0,
      (case when q.activity = 'SUBMITTED' then 1 else 0 end) as khqr_failed,
      0, 0
    from public.qr_installations q
    where (p_since is null or (q.submitted_at at time zone 'Asia/Phnom_Penh')::date >= p_since)
      and (p_until is null or (q.submitted_at at time zone 'Asia/Phnom_Penh')::date <= p_until)
      and (not v_exclude_weekend or extract(isodow from (q.submitted_at at time zone 'Asia/Phnom_Penh')::date) not in (6, 7))
      and (not v_exclude_holiday or public.get_cambodia_holiday_name((q.submitted_at at time zone 'Asia/Phnom_Penh')::date) is null)

    union all

    select
      coalesce(nullif(trim(c.staff_id), ''), 'UNKNOWN') as staff_id,
      nullif(trim(c.staff_name), '') as staff_name,
      coalesce(c.branch_id, app.resolve_branch(c.branch_text), 'UNASSIGNED') as branch_id,
      nullif(trim(c.branch_text), '') as branch_text,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      (case when c.request_type <> 'Add Supplementary Only' and c.card_status = 'Onboarded Successfully' then 1 else 0 end) as cc_primary,
      coalesce(jsonb_array_length(c.supplementary), 0)::int as cc_supp,
      0, 0, 0, 0, 0,
      1 as cc_submitted,
      (case when c.card_status in ('Rejected by Card Center', 'Duplicate Application') or c.review_status = 'REJECTED' then 1 else 0 end) as cc_rejected
    from public.cc_entries c
    where c.review_status in ('CONFIRMED', 'PENDING')
      and (p_since is null or (c.submitted_at at time zone 'Asia/Phnom_Penh')::date >= p_since)
      and (p_until is null or (c.submitted_at at time zone 'Asia/Phnom_Penh')::date <= p_until)
      and (not v_exclude_weekend or extract(isodow from (c.submitted_at at time zone 'Asia/Phnom_Penh')::date) not in (6, 7))
      and (not v_exclude_holiday or public.get_cambodia_holiday_name((c.submitted_at at time zone 'Asia/Phnom_Penh')::date) is null)
  ),
  grouped_staff as (
    select
      r.staff_id,
      coalesce(max(sp.name), max(r.staff_name), r.staff_id) as staff_name,
      coalesce(max(sp.branch_id), max(r.branch_id), 'UNASSIGNED') as branch_id,
      coalesce(max(b.name), max(r.branch_text), 'Unassigned') as branch_name,
      sum(r.pos_install)::int as pos_install, sum(r.pos_replace)::int as pos_replace, sum(r.pos_battery)::int as pos_battery,
      sum(r.sb_install)::int as sb_install, sum(r.sb_replace)::int as sb_replace, sum(r.sb_maint)::int as sb_maint, sum(r.sb_return)::int as sb_return,
      sum(r.khqr_install)::int as khqr_install, sum(r.khqr_replace)::int as khqr_replace, sum(r.khqr_materials)::int as khqr_materials,
      sum(r.cc_primary)::int as cc_primary, sum(r.cc_supp)::int as cc_supp,
      sum(r.pos_submitted)::int as pos_submitted, sum(r.pos_rejected)::int as pos_rejected,
      sum(r.sb_submitted)::int as sb_submitted, sum(r.sb_rejected)::int as sb_rejected,
      sum(r.khqr_failed)::int as khqr_failed,
      sum(r.cc_submitted)::int as cc_submitted, sum(r.cc_rejected)::int as cc_rejected
    from raw_events r
    left join public.staff_profiles sp on sp.emp_id = r.staff_id
    left join public.branches b on b.id = coalesce(sp.branch_id, r.branch_id)
    where r.staff_id <> 'UNKNOWN'
    group by r.staff_id
  )
  select coalesce(jsonb_agg(to_jsonb(s) order by s.branch_name asc, s.staff_name asc), '[]'::jsonb)
    into v_staff
    from grouped_staff s;

  -- 2) Time-bucketed historical trends across all devices and channels
  with timed_events as (
    select
      (coalesce(fe.recorded_at, fe.received_at) at time zone 'Asia/Phnom_Penh')::date as d,
      coalesce(nullif(trim(fe.staff_id), ''), 'UNKNOWN') as staff_id,
      nullif(trim(fe.staff_name), '') as staff_name,
      coalesce(fe.branch_id, app.resolve_branch(fe.branch_text), 'UNASSIGNED') as branch_id,
      nullif(trim(fe.branch_text), '') as branch_text,
      (case when coalesce(fe.device_type, 'POS Terminal') <> 'Sound Box' and fe.kind = 'INSTALL' and fe.status in ('APPROVED', 'PENDING') then 1 else 0 end) as pos_install,
      (case when coalesce(fe.device_type, 'POS Terminal') <> 'Sound Box' and fe.kind = 'REPLACE' and fe.status in ('APPROVED', 'PENDING') then 1 else 0 end) as pos_replace,
      (case when coalesce(fe.device_type, 'POS Terminal') <> 'Sound Box' and fe.kind = 'BATTERY' and fe.status in ('APPROVED', 'PENDING') then 1 else 0 end) as pos_battery,
      (case when fe.device_type = 'Sound Box' and fe.kind = 'INSTALL' and fe.status in ('APPROVED', 'PENDING') then 1 else 0 end) as sb_install,
      (case when fe.device_type = 'Sound Box' and fe.kind = 'REPLACE' and fe.status in ('APPROVED', 'PENDING') then 1 else 0 end) as sb_replace,
      (case when fe.device_type = 'Sound Box' and fe.kind = 'SB_MAINT' and fe.status in ('APPROVED', 'PENDING') then 1 else 0 end) as sb_maint,
      (case when fe.device_type = 'Sound Box' and fe.kind = 'SB_RETURN' and fe.status in ('APPROVED', 'PENDING') then 1 else 0 end) as sb_return,
      0 as khqr_install, 0 as khqr_replace, 0 as khqr_materials,
      0 as cc_primary, 0 as cc_supp
    from public.field_events fe
    where fe.recorded_at >= (date_trunc('month', now() at time zone 'Asia/Phnom_Penh') - interval '24 months') at time zone 'Asia/Phnom_Penh'

    union all

    select
      (q.submitted_at at time zone 'Asia/Phnom_Penh')::date as d,
      coalesce(nullif(trim(q.staff_id), ''), 'UNKNOWN') as staff_id,
      nullif(trim(q.staff_name), '') as staff_name,
      coalesce(q.branch_id, app.resolve_branch(q.branch_text), 'UNASSIGNED') as branch_id,
      nullif(trim(q.branch_text), '') as branch_text,
      0, 0, 0, 0, 0, 0, 0,
      (case when q.activity = 'NEW_INSTALLATION' then 1 else 0 end) as khqr_install,
      (case when q.activity = 'QR_REPLACEMENT' then 1 else 0 end) as khqr_replace,
      coalesce(q.qr_count, 0)::int as khqr_materials,
      0, 0
    from public.qr_installations q
    where q.submitted_at >= (date_trunc('month', now() at time zone 'Asia/Phnom_Penh') - interval '24 months') at time zone 'Asia/Phnom_Penh'

    union all

    select
      (c.submitted_at at time zone 'Asia/Phnom_Penh')::date as d,
      coalesce(nullif(trim(c.staff_id), ''), 'UNKNOWN') as staff_id,
      nullif(trim(c.staff_name), '') as staff_name,
      coalesce(c.branch_id, app.resolve_branch(c.branch_text), 'UNASSIGNED') as branch_id,
      nullif(trim(c.branch_text), '') as branch_text,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      (case when c.request_type <> 'Add Supplementary Only' and c.card_status = 'Onboarded Successfully' then 1 else 0 end) as cc_primary,
      coalesce(jsonb_array_length(c.supplementary), 0)::int as cc_supp
    from public.cc_entries c
    where c.review_status in ('CONFIRMED', 'PENDING')
      and c.submitted_at >= (date_trunc('month', now() at time zone 'Asia/Phnom_Penh') - interval '24 months') at time zone 'Asia/Phnom_Penh'
  ),
  daily_agg as (
    select
      d::text as period,
      count(distinct branch_id)::int as active_branches,
      count(distinct staff_id)::int as active_staff,
      sum(pos_install)::int as pos_install, sum(pos_replace)::int as pos_replace, sum(pos_battery)::int as pos_battery,
      sum(sb_install)::int as sb_install, sum(sb_replace)::int as sb_replace, sum(sb_maint)::int as sb_maint, sum(sb_return)::int as sb_return,
      sum(khqr_install)::int as khqr_install, sum(khqr_replace)::int as khqr_replace, sum(khqr_materials)::int as khqr_materials,
      sum(cc_primary)::int as cc_primary, sum(cc_supp)::int as cc_supp
    from timed_events
    where d >= ((now() at time zone 'Asia/Phnom_Penh')::date - 89)
    group by d
    order by d desc
  ),
  weekly_agg as (
    select
      date_trunc('week', d::timestamp)::date::text as period,
      count(distinct branch_id)::int as active_branches,
      count(distinct staff_id)::int as active_staff,
      sum(pos_install)::int as pos_install, sum(pos_replace)::int as pos_replace, sum(pos_battery)::int as pos_battery,
      sum(sb_install)::int as sb_install, sum(sb_replace)::int as sb_replace, sum(sb_maint)::int as sb_maint, sum(sb_return)::int as sb_return,
      sum(khqr_install)::int as khqr_install, sum(khqr_replace)::int as khqr_replace, sum(khqr_materials)::int as khqr_materials,
      sum(cc_primary)::int as cc_primary, sum(cc_supp)::int as cc_supp
    from timed_events
    where d >= (date_trunc('week', now() at time zone 'Asia/Phnom_Penh')::date - interval '11 weeks')::date
    group by date_trunc('week', d::timestamp)::date
    order by 1 desc
  ),
  monthly_agg as (
    select
      to_char(d, 'YYYY-MM') as period,
      count(distinct branch_id)::int as active_branches,
      count(distinct staff_id)::int as active_staff,
      sum(pos_install)::int as pos_install, sum(pos_replace)::int as pos_replace, sum(pos_battery)::int as pos_battery,
      sum(sb_install)::int as sb_install, sum(sb_replace)::int as sb_replace, sum(sb_maint)::int as sb_maint, sum(sb_return)::int as sb_return,
      sum(khqr_install)::int as khqr_install, sum(khqr_replace)::int as khqr_replace, sum(khqr_materials)::int as khqr_materials,
      sum(cc_primary)::int as cc_primary, sum(cc_supp)::int as cc_supp
    from timed_events
    where d >= (date_trunc('month', now() at time zone 'Asia/Phnom_Penh')::date - interval '11 months')::date
    group by to_char(d, 'YYYY-MM')
    order by 1 desc
  ),
  quarterly_agg as (
    select
      to_char(date_trunc('quarter', d::timestamp)::date, 'YYYY-"Q"Q') as period,
      count(distinct branch_id)::int as active_branches,
      count(distinct staff_id)::int as active_staff,
      sum(pos_install)::int as pos_install, sum(pos_replace)::int as pos_replace, sum(pos_battery)::int as pos_battery,
      sum(sb_install)::int as sb_install, sum(sb_replace)::int as sb_replace, sum(sb_maint)::int as sb_maint, sum(sb_return)::int as sb_return,
      sum(khqr_install)::int as khqr_install, sum(khqr_replace)::int as khqr_replace, sum(khqr_materials)::int as khqr_materials,
      sum(cc_primary)::int as cc_primary, sum(cc_supp)::int as cc_supp
    from timed_events
    where d >= (date_trunc('quarter', now() at time zone 'Asia/Phnom_Penh')::date - interval '21 months')::date
    group by to_char(date_trunc('quarter', d::timestamp)::date, 'YYYY-"Q"Q')
    order by 1 desc
  ),
  monthly_staff_agg as (
    select
      to_char(t.d, 'YYYY-MM') as month,
      t.staff_id,
      coalesce(max(sp.name), max(t.staff_name), t.staff_id) as staff_name,
      coalesce(max(sp.branch_id), max(t.branch_id), 'UNASSIGNED') as branch_id,
      coalesce(max(b.name), max(t.branch_text), 'Unassigned') as branch_name,
      sum(t.pos_install)::int as pos_install, sum(t.pos_replace)::int as pos_replace, sum(t.pos_battery)::int as pos_battery,
      sum(t.sb_install)::int as sb_install, sum(t.sb_replace)::int as sb_replace, sum(t.sb_maint)::int as sb_maint, sum(t.sb_return)::int as sb_return,
      sum(t.khqr_install)::int as khqr_install, sum(t.khqr_replace)::int as khqr_replace, sum(t.khqr_materials)::int as khqr_materials,
      sum(t.cc_primary)::int as cc_primary, sum(t.cc_supp)::int as cc_supp
    from timed_events t
    left join public.staff_profiles sp on sp.emp_id = t.staff_id
    left join public.branches b on b.id = coalesce(sp.branch_id, t.branch_id)
    where t.d >= (date_trunc('month', now() at time zone 'Asia/Phnom_Penh')::date - interval '5 months')::date
      and (not v_exclude_weekend or extract(isodow from t.d) not in (6, 7))
      and (not v_exclude_holiday or public.get_cambodia_holiday_name(t.d) is null)
    group by to_char(t.d, 'YYYY-MM'), t.staff_id
    order by 1 desc, 2 asc
  ),
  daily_branch_agg as (
    select
      t.d::text as day,
      t.branch_id,
      count(distinct t.staff_id)::int as active_staff,
      (sum(t.pos_install) + sum(t.pos_replace) + sum(t.pos_battery) +
       sum(t.sb_install) + sum(t.sb_replace) + sum(t.sb_maint) + sum(t.sb_return) +
       sum(t.khqr_install) + sum(t.khqr_replace) + sum(t.khqr_materials) +
       sum(t.cc_primary) + sum(t.cc_supp))::int as total_tasks,
      (sum(t.pos_install) + sum(t.pos_replace) + sum(t.pos_battery))::int as pos_tasks,
      (sum(t.sb_install) + sum(t.sb_replace) + sum(t.sb_maint) + sum(t.sb_return))::int as sb_tasks,
      (sum(t.khqr_install) + sum(t.khqr_replace) + sum(t.khqr_materials))::int as khqr_tasks,
      (sum(t.cc_primary) + sum(t.cc_supp))::int as cc_tasks
    from timed_events t
    where t.d >= (date_trunc('month', now() at time zone 'Asia/Phnom_Penh')::date - interval '5 months')::date
    group by t.d, t.branch_id
    order by t.d desc, t.branch_id asc
  ),
  daily_staff_agg as (
    select
      t.d::text as day,
      t.staff_id,
      coalesce(max(sp.name), max(t.staff_name), t.staff_id) as staff_name,
      coalesce(max(sp.branch_id), max(t.branch_id), 'UNASSIGNED') as branch_id,
      coalesce(max(b.name), max(t.branch_text), 'Unassigned') as branch_name,
      (sum(t.pos_install) + sum(t.pos_replace) + sum(t.pos_battery) +
       sum(t.sb_install) + sum(t.sb_replace) + sum(t.sb_maint) + sum(t.sb_return) +
       sum(t.khqr_install) + sum(t.khqr_replace) + sum(t.khqr_materials) +
       sum(t.cc_primary) + sum(t.cc_supp))::int as total_tasks,
      (sum(t.pos_install) + sum(t.pos_replace) + sum(t.pos_battery))::int as pos_tasks,
      (sum(t.sb_install) + sum(t.sb_replace) + sum(t.sb_maint) + sum(t.sb_return))::int as sb_tasks,
      (sum(t.khqr_install) + sum(t.khqr_replace) + sum(t.khqr_materials))::int as khqr_tasks,
      (sum(t.cc_primary) + sum(t.cc_supp))::int as cc_tasks
    from timed_events t
    left join public.staff_profiles sp on sp.emp_id = t.staff_id
    left join public.branches b on b.id = coalesce(sp.branch_id, t.branch_id)
    where t.d >= (date_trunc('month', now() at time zone 'Asia/Phnom_Penh')::date - interval '5 months')::date
    group by t.d, t.staff_id
    order by t.d desc, t.staff_id asc
  )
  select
    (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from daily_agg a),
    (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from weekly_agg a),
    (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from monthly_agg a),
    (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from quarterly_agg a),
    (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from monthly_staff_agg a),
    (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from daily_branch_agg a),
    (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from daily_staff_agg a)
  into v_daily, v_weekly, v_monthly, v_quarterly, v_monthly_staff, v_daily_branch, v_daily_staff;

  return jsonb_build_object(
    'rules', v_rules,
    'targets', v_targets,
    'staff', v_staff,
    'daily', v_daily,
    'weekly', v_weekly,
    'monthly', v_monthly,
    'quarterly', v_quarterly,
    'monthly_staff', v_monthly_staff,
    'daily_branch', v_daily_branch,
    'daily_staff', v_daily_staff
  );
end $$;

-- Overload forwarding from timestamptz to canonical date implementation
create or replace function public.kpi_dashboard_summary(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language sql
security definer
set search_path = public, app, pg_temp
as $$
  select public.kpi_dashboard_summary(
    case when p_from is not null then (p_from at time zone 'Asia/Phnom_Penh')::date else null end,
    case when p_to is not null then (p_to at time zone 'Asia/Phnom_Penh')::date else null end
  );
$$;

revoke all on function public.kpi_dashboard_summary(date, date) from public, anon;
grant execute on function public.kpi_dashboard_summary(date, date) to authenticated, service_role;

revoke all on function public.kpi_dashboard_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.kpi_dashboard_summary(timestamptz, timestamptz) to authenticated, service_role;

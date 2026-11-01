-- ============================================================================
-- Migration: 20261101_17_kpi_daily_branch.sql
-- Description: Add daily branch task matrix support to public.kpi_dashboard_summary RPC
-- ============================================================================

create or replace function public.kpi_dashboard_summary(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
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
  v_keep timestamptz := public.qr_keep_from();
begin
  -- Ensure settings exist
  if not exists (select 1 from public.kpi_settings where id = 1) then
    insert into public.kpi_settings (id) values (1) on conflict do nothing;
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.sort_order, r.code), '[]'::jsonb)
    into v_rules from public.kpi_point_rules r;

  select to_jsonb(s) into v_targets from public.kpi_settings s where s.id = 1;

  -- 1) Staff-level unified task aggregation for the selected period [p_from, p_to)
  with raw_events as (
    -- POS Terminal & Sound Box field events
    select
      coalesce(nullif(trim(fe.staff_id), ''), 'UNKNOWN') as staff_id,
      nullif(trim(fe.staff_name), '') as staff_name,
      coalesce(fe.branch_id, app.resolve_branch(fe.branch_text)) as branch_id,
      nullif(trim(fe.branch_text), '') as branch_text,
      count(*) filter (where coalesce(fe.device_type, 'POS Terminal') <> 'Sound Box' and fe.kind = 'INSTALL' and fe.status = 'APPROVED')::int as pos_install,
      count(*) filter (where coalesce(fe.device_type, 'POS Terminal') <> 'Sound Box' and fe.kind = 'REPLACE' and fe.status = 'APPROVED')::int as pos_replace,
      count(*) filter (where coalesce(fe.device_type, 'POS Terminal') <> 'Sound Box' and fe.kind = 'BATTERY' and fe.status = 'APPROVED')::int as pos_battery,
      count(*) filter (where coalesce(fe.device_type, 'POS Terminal') <> 'Sound Box' and fe.status in ('APPROVED', 'REJECTED', 'PENDING'))::int as pos_submitted,
      count(*) filter (where coalesce(fe.device_type, 'POS Terminal') <> 'Sound Box' and fe.status = 'REJECTED')::int as pos_rejected,
      count(*) filter (where fe.device_type = 'Sound Box' and fe.kind = 'INSTALL' and fe.status = 'APPROVED')::int as sb_install,
      count(*) filter (where fe.device_type = 'Sound Box' and fe.kind = 'REPLACE' and fe.status = 'APPROVED')::int as sb_replace,
      count(*) filter (where fe.device_type = 'Sound Box' and fe.kind = 'SB_MAINT' and fe.status = 'APPROVED')::int as sb_maint,
      count(*) filter (where fe.device_type = 'Sound Box' and fe.kind = 'SB_RETURN' and fe.status = 'APPROVED')::int as sb_return,
      count(*) filter (where fe.device_type = 'Sound Box' and fe.status in ('APPROVED', 'REJECTED', 'PENDING'))::int as sb_submitted,
      count(*) filter (where fe.device_type = 'Sound Box' and fe.status = 'REJECTED')::int as sb_rejected,
      0::int as khqr_install,
      0::int as khqr_replace,
      0::int as khqr_materials,
      0::int as khqr_failed,
      0::int as cc_primary,
      0::int as cc_supp,
      0::int as cc_submitted,
      0::int as cc_rejected
    from public.field_events fe
    where (p_from is null or coalesce(fe.recorded_at, fe.received_at) >= p_from)
      and (p_to is null or coalesce(fe.recorded_at, fe.received_at) < p_to)
    group by 1, 2, 3, 4

    union all

    -- KHQR live entries
    select
      coalesce(nullif(trim(q.staff_id), ''), 'UNKNOWN') as staff_id,
      nullif(trim(q.staff_name), '') as staff_name,
      coalesce(q.branch_id, app.resolve_branch(q.branch_text)) as branch_id,
      nullif(trim(q.branch_text), '') as branch_text,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      count(*) filter (where q.activity = 'NEW_INSTALLATION')::int as khqr_install,
      count(*) filter (where q.activity = 'QR_REPLACEMENT')::int as khqr_replace,
      coalesce(sum(q.qr_count), 0)::int as khqr_materials,
      count(*) filter (where coalesce(q.failed_attempts, 0) > 0 or q.status in ('FAILED', 'REJECTED', 'INVALID'))::int as khqr_failed,
      0, 0, 0, 0
    from public.qr_installations q
    where (p_from is null or q.submitted_at >= p_from)
      and (p_to is null or q.submitted_at < p_to)
    group by 1, 2, 3, 4

    union all

    -- KHQR archived monthly summaries (for months older than qr_keep_from)
    select
      coalesce(nullif(trim(s.staff_id), ''), 'UNKNOWN') as staff_id,
      nullif(trim(s.staff_name), '') as staff_name,
      coalesce(s.branch_id, app.resolve_branch(s.branch_text)) as branch_id,
      nullif(trim(s.branch_text), '') as branch_text,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      coalesce(sum(s.install), 0)::int as khqr_install,
      coalesce(sum(s.replace), 0)::int as khqr_replace,
      coalesce(sum(s.qr), 0)::int as khqr_materials,
      coalesce(sum(s.attempts), 0)::int as khqr_failed,
      0, 0, 0, 0
    from public.qr_monthly_summary s
    where s.month < (v_keep at time zone 'Asia/Phnom_Penh')::date
      and (p_from is null or (s.month::timestamp at time zone 'Asia/Phnom_Penh') >= p_from)
      and (p_to is null or (s.month::timestamp at time zone 'Asia/Phnom_Penh') < p_to)
    group by 1, 2, 3, 4

    union all

    -- Credit Card entries
    select
      coalesce(nullif(trim(c.staff_id), ''), 'UNKNOWN') as staff_id,
      nullif(trim(c.staff_name), '') as staff_name,
      coalesce(c.branch_id, app.resolve_branch(c.branch_text)) as branch_id,
      nullif(trim(c.branch_text), '') as branch_text,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      count(*) filter (where c.review_status = 'CONFIRMED' and c.request_type <> 'Add Supplementary Only' and c.card_status = 'Onboarded Successfully')::int as cc_primary,
      coalesce(sum(jsonb_array_length(c.supplementary)) filter (where c.review_status = 'CONFIRMED'), 0)::int as cc_supp,
      count(*)::int as cc_submitted,
      count(*) filter (where c.review_status = 'REJECTED')::int as cc_rejected
    from public.cc_entries c
    where (p_from is null or c.submitted_at >= p_from)
      and (p_to is null or c.submitted_at < p_to)
    group by 1, 2, 3, 4
  ),
  grouped_staff as (
    select
      r.staff_id,
      coalesce(max(sp.name), max(r.staff_name), r.staff_id) as staff_name,
      coalesce(max(sp.branch_id), max(r.branch_id), 'UNASSIGNED') as branch_id,
      coalesce(max(b.name), max(r.branch_text), 'Unassigned') as branch_name,
      sum(r.pos_install)::int as pos_install,
      sum(r.pos_replace)::int as pos_replace,
      sum(r.pos_battery)::int as pos_battery,
      sum(r.pos_submitted)::int as pos_submitted,
      sum(r.pos_rejected)::int as pos_rejected,
      sum(r.sb_install)::int as sb_install,
      sum(r.sb_replace)::int as sb_replace,
      sum(r.sb_maint)::int as sb_maint,
      sum(r.sb_return)::int as sb_return,
      sum(r.sb_submitted)::int as sb_submitted,
      sum(r.sb_rejected)::int as sb_rejected,
      sum(r.khqr_install)::int as khqr_install,
      sum(r.khqr_replace)::int as khqr_replace,
      sum(r.khqr_materials)::int as khqr_materials,
      sum(r.khqr_failed)::int as khqr_failed,
      sum(r.cc_primary)::int as cc_primary,
      sum(r.cc_supp)::int as cc_supp,
      sum(r.cc_submitted)::int as cc_submitted,
      sum(r.cc_rejected)::int as cc_rejected
    from raw_events r
    left join public.staff_profiles sp on sp.emp_id = r.staff_id
    left join public.branches b on b.id = coalesce(sp.branch_id, r.branch_id)
    group by r.staff_id
  )
  select coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb) into v_staff from grouped_staff g;

  -- 2) All time-bucketed events over the last 24 months for Daily (30d), Weekly (12w), Monthly (12m), Quarterly (8q), Daily Branch
  with timed_events as (
    select
      (coalesce(fe.recorded_at, fe.received_at) at time zone 'Asia/Phnom_Penh')::date as d,
      coalesce(nullif(trim(fe.staff_id), ''), 'UNKNOWN') as staff_id,
      nullif(trim(fe.staff_name), '') as staff_name,
      coalesce(fe.branch_id, app.resolve_branch(fe.branch_text), 'UNASSIGNED') as branch_id,
      nullif(trim(fe.branch_text), '') as branch_text,
      (case when coalesce(fe.device_type, 'POS Terminal') <> 'Sound Box' and fe.kind = 'INSTALL' and fe.status = 'APPROVED' then 1 else 0 end) as pos_install,
      (case when coalesce(fe.device_type, 'POS Terminal') <> 'Sound Box' and fe.kind = 'REPLACE' and fe.status = 'APPROVED' then 1 else 0 end) as pos_replace,
      (case when coalesce(fe.device_type, 'POS Terminal') <> 'Sound Box' and fe.kind = 'BATTERY' and fe.status = 'APPROVED' then 1 else 0 end) as pos_battery,
      (case when fe.device_type = 'Sound Box' and fe.kind = 'INSTALL' and fe.status = 'APPROVED' then 1 else 0 end) as sb_install,
      (case when fe.device_type = 'Sound Box' and fe.kind = 'REPLACE' and fe.status = 'APPROVED' then 1 else 0 end) as sb_replace,
      (case when fe.device_type = 'Sound Box' and fe.kind = 'SB_MAINT' and fe.status = 'APPROVED' then 1 else 0 end) as sb_maint,
      (case when fe.device_type = 'Sound Box' and fe.kind = 'SB_RETURN' and fe.status = 'APPROVED' then 1 else 0 end) as sb_return,
      0 as khqr_install, 0 as khqr_replace, 0 as khqr_materials,
      0 as cc_primary, 0 as cc_supp
    from public.field_events fe
    where fe.status = 'APPROVED'
      and coalesce(fe.recorded_at, fe.received_at) >= (date_trunc('month', now() at time zone 'Asia/Phnom_Penh') - interval '24 months') at time zone 'Asia/Phnom_Penh'

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
      s.month as d,
      coalesce(nullif(trim(s.staff_id), ''), 'UNKNOWN') as staff_id,
      nullif(trim(s.staff_name), '') as staff_name,
      coalesce(s.branch_id, app.resolve_branch(s.branch_text), 'UNASSIGNED') as branch_id,
      nullif(trim(s.branch_text), '') as branch_text,
      0, 0, 0, 0, 0, 0, 0,
      s.install, s.replace, s.qr,
      0, 0
    from public.qr_monthly_summary s
    where s.month < (v_keep at time zone 'Asia/Phnom_Penh')::date
      and s.month >= (date_trunc('month', now() at time zone 'Asia/Phnom_Penh') - interval '24 months')::date

    union all

    select
      (c.submitted_at at time zone 'Asia/Phnom_Penh')::date as d,
      coalesce(nullif(trim(c.staff_id), ''), 'UNKNOWN') as staff_id,
      nullif(trim(c.staff_name), '') as staff_name,
      coalesce(c.branch_id, app.resolve_branch(c.branch_text), 'UNASSIGNED') as branch_id,
      nullif(trim(c.branch_text), '') as branch_text,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      (case when c.request_type <> 'Add Supplementary Only' and c.card_status = 'Onboarded Successfully' then 1 else 0 end) as cc_primary,
      jsonb_array_length(c.supplementary) as cc_supp
    from public.cc_entries c
    where c.review_status = 'CONFIRMED'
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
    where d >= ((now() at time zone 'Asia/Phnom_Penh')::date - 29)
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
    group by 1
    order by 1 desc
  ),
  monthly_agg as (
    select
      to_char(date_trunc('month', d::timestamp), 'YYYY-MM') as period,
      count(distinct branch_id)::int as active_branches,
      count(distinct staff_id)::int as active_staff,
      sum(pos_install)::int as pos_install, sum(pos_replace)::int as pos_replace, sum(pos_battery)::int as pos_battery,
      sum(sb_install)::int as sb_install, sum(sb_replace)::int as sb_replace, sum(sb_maint)::int as sb_maint, sum(sb_return)::int as sb_return,
      sum(khqr_install)::int as khqr_install, sum(khqr_replace)::int as khqr_replace, sum(khqr_materials)::int as khqr_materials,
      sum(cc_primary)::int as cc_primary, sum(cc_supp)::int as cc_supp
    from timed_events
    where d >= (date_trunc('month', now() at time zone 'Asia/Phnom_Penh')::date - interval '11 months')::date
    group by 1
    order by 1 desc
  ),
  quarterly_agg as (
    select
      to_char(date_trunc('quarter', d::timestamp), 'YYYY-"Q"Q') as period,
      count(distinct branch_id)::int as active_branches,
      count(distinct staff_id)::int as active_staff,
      sum(pos_install)::int as pos_install, sum(pos_replace)::int as pos_replace, sum(pos_battery)::int as pos_battery,
      sum(sb_install)::int as sb_install, sum(sb_replace)::int as sb_replace, sum(sb_maint)::int as sb_maint, sum(sb_return)::int as sb_return,
      sum(khqr_install)::int as khqr_install, sum(khqr_replace)::int as khqr_replace, sum(khqr_materials)::int as khqr_materials,
      sum(cc_primary)::int as cc_primary, sum(cc_supp)::int as cc_supp
    from timed_events
    group by 1
    order by 1 desc
    limit 8
  ),
  m_staff as (
    select
      to_char(date_trunc('month', t.d::timestamp), 'YYYY-MM') as month,
      t.staff_id,
      coalesce(max(sp.name), max(t.staff_name), t.staff_id) as staff_name,
      coalesce(max(sp.branch_id), max(nullif(t.branch_id, 'UNASSIGNED')), 'UNASSIGNED') as branch_id,
      coalesce(max(b.name), max(t.branch_text), 'Unassigned') as branch_name,
      sum(t.pos_install)::int as pos_install, sum(t.pos_replace)::int as pos_replace, sum(t.pos_battery)::int as pos_battery,
      sum(t.sb_install)::int as sb_install, sum(t.sb_replace)::int as sb_replace, sum(t.sb_maint)::int as sb_maint, sum(t.sb_return)::int as sb_return,
      sum(t.khqr_install)::int as khqr_install, sum(t.khqr_replace)::int as khqr_replace, sum(t.khqr_materials)::int as khqr_materials,
      sum(t.cc_primary)::int as cc_primary, sum(t.cc_supp)::int as cc_supp
    from timed_events t
    left join public.staff_profiles sp on sp.emp_id = t.staff_id
    left join public.branches b on b.id = coalesce(sp.branch_id, nullif(t.branch_id, 'UNASSIGNED'))
    where t.d >= (date_trunc('month', now() at time zone 'Asia/Phnom_Penh')::date - interval '11 months')::date
    group by 1, 2
  ),
  daily_branch_agg as (
    select
      t.d::text as day,
      coalesce(sp.branch_id, nullif(t.branch_id, 'UNASSIGNED'), 'UNASSIGNED') as branch_id,
      count(distinct t.staff_id)::int as active_staff,
      (sum(t.pos_install) + sum(t.pos_replace) + sum(t.pos_battery) +
       sum(t.sb_install) + sum(t.sb_replace) + sum(t.sb_maint) + sum(t.sb_return) +
       sum(t.khqr_install) + sum(t.khqr_replace) +
       sum(t.cc_primary) + sum(t.cc_supp))::int as total_tasks,
      (sum(t.pos_install) + sum(t.pos_replace) + sum(t.pos_battery))::int as pos_tasks,
      (sum(t.sb_install) + sum(t.sb_replace) + sum(t.sb_maint) + sum(t.sb_return))::int as sb_tasks,
      (sum(t.khqr_install) + sum(t.khqr_replace) + sum(t.khqr_materials))::int as khqr_tasks,
      (sum(t.cc_primary) + sum(t.cc_supp))::int as cc_tasks
    from timed_events t
    left join public.staff_profiles sp on sp.emp_id = t.staff_id
    where t.d >= (date_trunc('month', now() at time zone 'Asia/Phnom_Penh') - interval '6 months')::date
    group by t.d, 2
    order by t.d desc
  )
  select
    coalesce((select jsonb_agg(to_jsonb(x)) from daily_agg x), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(x)) from weekly_agg x), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(x)) from monthly_agg x), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(x)) from quarterly_agg x), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(x)) from m_staff x), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(x)) from daily_branch_agg x), '[]'::jsonb)
  into v_daily, v_weekly, v_monthly, v_quarterly, v_monthly_staff, v_daily_branch;

  return jsonb_build_object(
    'rules', v_rules,
    'targets', v_targets,
    'staff', v_staff,
    'daily', v_daily,
    'weekly', v_weekly,
    'monthly', v_monthly,
    'quarterly', v_quarterly,
    'monthly_staff', v_monthly_staff,
    'daily_branch', v_daily_branch
  );
end $$;

revoke all on function public.kpi_dashboard_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.kpi_dashboard_summary(timestamptz, timestamptz) to authenticated, service_role;

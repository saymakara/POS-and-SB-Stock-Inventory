-- ============================================================================================================================
-- 15 Nov 2026 - Prevent KPI summary statement timeouts & eliminate cold-cache stampedes.
--
-- Root cause observed in Supabase logs (2026-11-15T07:52:38Z..07:53:21Z):
--   1. The `authenticated` role has `statement_timeout = 8s`. When app.kpi_summary_cache missed or expired (>45s after writes),
--      cold execution of public.kpi_dashboard_summary() exceeded 8s on simultaneous requests and aborted with SQL 57014 / HTTP 500,
--      leaving Dashboard KPI points and Cross-Channel Daily Velocity empty.
--   2. app.kpi_dashboard_summary_compute created temporary table `kpi_x` + truncated on every cold build (firing Supabase's
--      `rls_auto_enable` DDL event trigger), resolved `app.resolve_branch()` row-by-row across 4 tables, and called
--      `public.get_cambodia_holiday_name()` PL/pgSQL per row.
--   3. public.kpi_dashboard_summary_base scanned all ~17,640 rows twice for `branch_id is null` branch text mapping and
--      evaluated PL/pgSQL `get_cambodia_holiday_name()` and timezone casts per row instead of SARGable range bounds.
--   4. Concurrent requests hitting an expired cache entry all recomputed simultaneously without coordination.
--
-- Safe, zero-behavior-change fixes:
--   - Partial indexes for `branch_id is null` rows and non-base / failed KPI scans.
--   - Precomputed holiday array & single `bmap` distinct-text resolution in both `kpi_dashboard_summary_base` and
--     `app.kpi_dashboard_summary_compute`, plus pure-CTE `kpi_x` (no temp table DDL / no `rls_auto_enable` trigger).
--   - `SET statement_timeout = '30s'` and transaction advisory lock per cache key on `public.kpi_dashboard_summary`.
-- ============================================================================================================================

-- 1. Partial indexes so `bmap` (`where branch_id is null`) and KPI filtered scans avoid full-table heap scans
create index if not exists field_events_null_branch_text_idx
  on public.field_events (branch_text) where branch_id is null;
create index if not exists qr_inst_null_branch_text_idx
  on public.qr_installations (branch_text) where branch_id is null;
create index if not exists cc_entries_null_branch_text_idx
  on public.cc_entries (branch_text) where branch_id is null;
create index if not exists mv_visits_null_branch_text_idx
  on public.mv_visits (branch_text) where branch_id is null;
create index if not exists qr_inst_submitted_or_failed_idx
  on public.qr_installations (submitted_at)
  where (activity = 'SUBMITTED' or status = 'FAILED_ATTEMPT');
create index if not exists field_events_nonbase_kpi_idx
  on public.field_events ((coalesce(recorded_at, received_at)))
  where kind not in ('INSTALL', 'REPLACE', 'BATTERY', 'SB_RETURN') and status in ('APPROVED', 'PENDING');

-- 2. Fast `public.kpi_dashboard_summary_base(date, date)` — exact same output semantics
create or replace function public.kpi_dashboard_summary_base(p_since date default null, p_until date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
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
  v_daily_staff jsonb;
  v_exclude_weekend boolean := true;
  v_exclude_holiday boolean := true;
  v_today date := (now() at time zone 'Asia/Phnom_Penh')::date;
  v_from24_ts timestamptz := (date_trunc('month', now() at time zone 'Asia/Phnom_Penh') - interval '24 months') at time zone 'Asia/Phnom_Penh';
  v_since_ts timestamptz := case when p_since is not null then (p_since::timestamp at time zone 'Asia/Phnom_Penh') else null end;
  v_until_ts timestamptz := case when p_until is not null then ((p_until + 1)::timestamp at time zone 'Asia/Phnom_Penh') else null end;
  v_hol_dates date[] := '{}'::date[];
begin
  -- KPI_ACTIVE_USER_ONLY (03 Nov 2026): deactivated / first-password accounts cannot read KPI figures
  if auth.uid() is not null and (select app.role()) is null then
    raise exception 'Your account is not active. Ask Admin HQ to restore access.' using errcode = '42501';
  end if;

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

  if v_exclude_holiday then
    select coalesce(array_agg(g.d::date), '{}'::date[])
      into v_hol_dates
      from generate_series(date '2024-01-01', v_today + 365, interval '1 day') as g(d)
     where public.get_cambodia_holiday_name(g.d::date) is not null;
  end if;

  -- 1) Staff raw aggregated counts over period (single bmap resolution + precomputed holiday lookup)
  with bmap as materialized (
    select s.t, app.resolve_branch(s.t) as bid
      from (
        select fe0.branch_text as t from public.field_events fe0 where fe0.branch_id is null and nullif(trim(fe0.branch_text), '') is not null
        union select q0.branch_text from public.qr_installations q0 where q0.branch_id is null and nullif(trim(q0.branch_text), '') is not null
        union select c0.branch_text from public.cc_entries c0 where c0.branch_id is null and nullif(trim(c0.branch_text), '') is not null
      ) s
  ),
  raw_events as (
    select
      coalesce(nullif(trim(fe.staff_id), ''), 'UNKNOWN') as staff_id,
      nullif(trim(fe.staff_name), '') as staff_name,
      coalesce(fe.branch_id, bm.bid, 'UNASSIGNED') as branch_id,
      nullif(trim(fe.branch_text), '') as branch_text,
      (coalesce(fe.recorded_at, fe.received_at) at time zone 'Asia/Phnom_Penh')::date as d,
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
    left join bmap bm on fe.branch_id is null and bm.t = fe.branch_text
    where (v_since_ts is null or coalesce(fe.recorded_at, fe.received_at) >= v_since_ts)
      and (v_until_ts is null or coalesce(fe.recorded_at, fe.received_at) < v_until_ts)

    union all

    select
      coalesce(nullif(trim(q.staff_id), ''), 'UNKNOWN') as staff_id,
      nullif(trim(q.staff_name), '') as staff_name,
      coalesce(q.branch_id, bm.bid, 'UNASSIGNED') as branch_id,
      nullif(trim(q.branch_text), '') as branch_text,
      (q.submitted_at at time zone 'Asia/Phnom_Penh')::date as d,
      0, 0, 0, 0, 0, 0, 0,
      (case when q.activity = 'NEW_INSTALLATION' then 1 else 0 end) as khqr_install,
      (case when q.activity = 'QR_REPLACEMENT' then 1 else 0 end) as khqr_replace,
      coalesce(q.qr_count, 0)::int as khqr_materials,
      0, 0,
      0, 0, 0, 0,
      (case when q.activity = 'SUBMITTED' then 1 else 0 end) as khqr_failed,
      0, 0
    from public.qr_installations q
    left join bmap bm on q.branch_id is null and bm.t = q.branch_text
    where (v_since_ts is null or q.submitted_at >= v_since_ts)
      and (v_until_ts is null or q.submitted_at < v_until_ts)

    union all

    select
      coalesce(nullif(trim(c.staff_id), ''), 'UNKNOWN') as staff_id,
      nullif(trim(c.staff_name), '') as staff_name,
      coalesce(c.branch_id, bm.bid, 'UNASSIGNED') as branch_id,
      nullif(trim(c.branch_text), '') as branch_text,
      (c.submitted_at at time zone 'Asia/Phnom_Penh')::date as d,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      (case when c.request_type <> 'Add Supplementary Only' and c.card_status = 'Onboarded Successfully' then 1 else 0 end) as cc_primary,
      coalesce(jsonb_array_length(c.supplementary), 0)::int as cc_supp,
      0, 0, 0, 0, 0,
      1 as cc_submitted,
      (case when c.card_status in ('Rejected by Card Center', 'Duplicate Application') or c.review_status = 'REJECTED' then 1 else 0 end) as cc_rejected
    from public.cc_entries c
    left join bmap bm on c.branch_id is null and bm.t = c.branch_text
    where c.review_status in ('CONFIRMED', 'PENDING')
      and (v_since_ts is null or c.submitted_at >= v_since_ts)
      and (v_until_ts is null or c.submitted_at < v_until_ts)
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
      and (not v_exclude_weekend or extract(isodow from r.d) not in (6, 7))
      and (not v_exclude_holiday or not (r.d = any(v_hol_dates) or (r.d < date '2024-01-01' and public.get_cambodia_holiday_name(r.d) is not null)))
    group by r.staff_id
  )
  select coalesce(jsonb_agg(to_jsonb(s) order by s.branch_name asc, s.staff_name asc), '[]'::jsonb)
    into v_staff
    from grouped_staff s;

  -- 2) Time-bucketed historical trends across all devices and channels
  with bmap as materialized (
    select s.t, app.resolve_branch(s.t) as bid
      from (
        select fe0.branch_text as t from public.field_events fe0 where fe0.branch_id is null and nullif(trim(fe0.branch_text), '') is not null
        union select q0.branch_text from public.qr_installations q0 where q0.branch_id is null and nullif(trim(q0.branch_text), '') is not null
        union select c0.branch_text from public.cc_entries c0 where c0.branch_id is null and nullif(trim(c0.branch_text), '') is not null
      ) s
  ),
  timed_events as materialized (
    select
      (coalesce(fe.recorded_at, fe.received_at) at time zone 'Asia/Phnom_Penh')::date as d,
      coalesce(nullif(trim(fe.staff_id), ''), 'UNKNOWN') as staff_id,
      nullif(trim(fe.staff_name), '') as staff_name,
      coalesce(fe.branch_id, bm.bid, 'UNASSIGNED') as branch_id,
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
    left join bmap bm on fe.branch_id is null and bm.t = fe.branch_text
    where fe.recorded_at >= v_from24_ts

    union all

    select
      (q.submitted_at at time zone 'Asia/Phnom_Penh')::date as d,
      coalesce(nullif(trim(q.staff_id), ''), 'UNKNOWN') as staff_id,
      nullif(trim(q.staff_name), '') as staff_name,
      coalesce(q.branch_id, bm.bid, 'UNASSIGNED') as branch_id,
      nullif(trim(q.branch_text), '') as branch_text,
      0, 0, 0, 0, 0, 0, 0,
      (case when q.activity = 'NEW_INSTALLATION' then 1 else 0 end) as khqr_install,
      (case when q.activity = 'QR_REPLACEMENT' then 1 else 0 end) as khqr_replace,
      coalesce(q.qr_count, 0)::int as khqr_materials,
      0, 0
    from public.qr_installations q
    left join bmap bm on q.branch_id is null and bm.t = q.branch_text
    where q.submitted_at >= v_from24_ts

    union all

    select
      (c.submitted_at at time zone 'Asia/Phnom_Penh')::date as d,
      coalesce(nullif(trim(c.staff_id), ''), 'UNKNOWN') as staff_id,
      nullif(trim(c.staff_name), '') as staff_name,
      coalesce(c.branch_id, bm.bid, 'UNASSIGNED') as branch_id,
      nullif(trim(c.branch_text), '') as branch_text,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      (case when c.request_type <> 'Add Supplementary Only' and c.card_status = 'Onboarded Successfully' then 1 else 0 end) as cc_primary,
      coalesce(jsonb_array_length(c.supplementary), 0)::int as cc_supp
    from public.cc_entries c
    left join bmap bm on c.branch_id is null and bm.t = c.branch_text
    where c.review_status in ('CONFIRMED', 'PENDING')
      and c.submitted_at >= v_from24_ts
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
    where d >= (v_today - 89)
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
    where d >= (date_trunc('week', v_today::timestamp)::date - interval '11 weeks')::date
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
    where d >= (date_trunc('month', v_today::timestamp)::date - interval '11 months')::date
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
    where d >= (date_trunc('quarter', v_today::timestamp)::date - interval '21 months')::date
    group by to_char(date_trunc('quarter', d::timestamp)::date, 'YYYY-"Q"Q')
    order by 1 desc
  ),
  t5m as materialized (
    select * from timed_events
     where d >= (date_trunc('month', v_today::timestamp)::date - interval '5 months')::date
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
    from t5m t
    left join public.staff_profiles sp on sp.emp_id = t.staff_id
    left join public.branches b on b.id = coalesce(sp.branch_id, t.branch_id)
    where (not v_exclude_weekend or extract(isodow from t.d) not in (6, 7))
      and (not v_exclude_holiday or not (t.d = any(v_hol_dates) or (t.d < date '2024-01-01' and public.get_cambodia_holiday_name(t.d) is not null)))
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
       sum(t.khqr_install) + sum(t.khqr_replace) +
       sum(t.cc_primary) + sum(t.cc_supp))::int as total_tasks,
      (sum(t.pos_install) + sum(t.pos_replace) + sum(t.pos_battery))::int as pos_tasks,
      (sum(t.sb_install) + sum(t.sb_replace) + sum(t.sb_maint) + sum(t.sb_return))::int as sb_tasks,
      (sum(t.khqr_install) + sum(t.khqr_replace))::int as khqr_tasks,
      (sum(t.cc_primary) + sum(t.cc_supp))::int as cc_tasks
    from t5m t
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
       sum(t.khqr_install) + sum(t.khqr_replace) +
       sum(t.cc_primary) + sum(t.cc_supp))::int as total_tasks,
      (sum(t.pos_install) + sum(t.pos_replace) + sum(t.pos_battery))::int as pos_tasks,
      (sum(t.sb_install) + sum(t.sb_replace) + sum(t.sb_maint) + sum(t.sb_return))::int as sb_tasks,
      (sum(t.khqr_install) + sum(t.khqr_replace))::int as khqr_tasks,
      (sum(t.cc_primary) + sum(t.cc_supp))::int as cc_tasks
    from t5m t
    left join public.staff_profiles sp on sp.emp_id = t.staff_id
    left join public.branches b on b.id = coalesce(sp.branch_id, t.branch_id)
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
revoke all on function public.kpi_dashboard_summary_base(date, date) from public, anon, authenticated;

-- 3. Temp-table-free & single-bmap `app.kpi_dashboard_summary_compute(date, date)`
create or replace function app.kpi_dashboard_summary_compute(p_since date default null, p_until date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb := public.kpi_dashboard_summary_base(p_since, p_until);
  t jsonb := coalesce(v->'targets', '{}'::jsonb);
  v_wk boolean := coalesce(t->>'working_days_mode', 'mon_fri') = 'mon_fri';
  v_hol boolean := coalesce((t->>'exclude_holidays')::boolean, true);
  v_today date := (now() at time zone 'Asia/Phnom_Penh')::date;
  v_from24 timestamptz := (date_trunc('month', now() at time zone 'Asia/Phnom_Penh') - interval '24 months') at time zone 'Asia/Phnom_Penh';
  v_from5m date := (date_trunc('month', now() at time zone 'Asia/Phnom_Penh')::date - interval '5 months')::date;
  v_zero jsonb := '{"pos_install":0,"pos_replace":0,"pos_battery":0,"sb_install":0,"sb_replace":0,"sb_maint":0,"sb_return":0,"khqr_install":0,"khqr_replace":0,"khqr_materials":0,"cc_primary":0,"cc_supp":0}'::jsonb;
  v_hol_dates date[] := '{}'::date[];
  v_staff jsonb; v_daily jsonb; v_weekly jsonb; v_monthly jsonb; v_quarterly jsonb; v_ms jsonb; v_db jsonb; v_ds jsonb;
begin
  if v_hol then
    select coalesce(array_agg(g.d::date), '{}'::date[])
      into v_hol_dates
      from generate_series((v_from24 at time zone 'Asia/Phnom_Penh')::date - 2, v_today + 2, interval '1 day') as g(d)
     where public.get_cambodia_holiday_name(g.d::date) is not null;
  end if;

  with bmap as materialized (
    select s.t, app.resolve_branch(s.t) as bid
      from (
        select fe0.branch_text as t from public.field_events fe0 where fe0.branch_id is null and nullif(trim(fe0.branch_text), '') is not null
        union select m0.branch_text from public.mv_visits m0 where m0.branch_id is null and nullif(trim(m0.branch_text), '') is not null
        union select c0.branch_text from public.cc_entries c0 where c0.branch_id is null and nullif(trim(c0.branch_text), '') is not null
        union select q0.branch_text from public.qr_installations q0 where q0.branch_id is null and nullif(trim(q0.branch_text), '') is not null
      ) s
  ),
  kpi_x as materialized (
    select e.staff_id, e.staff_name, e.branch_id, e.branch_text, e.d, e.code, r.category as cat
      from (
        -- 1. Field events (non-base and mapped operational support sub-tasks)
        select coalesce(nullif(trim(fe.staff_id), ''), 'UNKNOWN') staff_id,
               nullif(trim(fe.staff_name), '') staff_name,
               coalesce(fe.branch_id, bm.bid, 'UNASSIGNED') branch_id,
               nullif(trim(fe.branch_text), '') branch_text,
               (coalesce(fe.recorded_at, fe.received_at) at time zone 'Asia/Phnom_Penh')::date d,
               case
                 when fe.kind in ('POS_MAINT', 'MAINT') or (coalesce(fe.device_type, '') = 'POS Terminal' and fe.kind ilike '%maint%') then
                   case
                     when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type', fe.remarks) ilike '%inspect%' then 'POS_OP_INSPECT'
                     when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type', fe.remarks) ilike '%train%' then 'POS_OP_TRAIN'
                     when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type', fe.remarks) ilike '%paper%' then 'POS_OP_PAPER'
                     when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type', fe.remarks) ilike '%add%mat%' then 'POS_OP_ADD_MAT'
                     when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type', fe.remarks) ilike '%return%mat%' then 'POS_OP_RET_MAT'
                     when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type') ilike '%other%' then 'POS_OP_OTHERS'
                     else 'POS_MAINT'
                   end
                 when fe.kind in ('SB_MAINT') or (fe.device_type = 'Sound Box' and fe.kind ilike '%maint%') then
                   case
                     when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type', fe.remarks) ilike '%inspect%' then 'SB_OP_INSPECT'
                     when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type', fe.remarks) ilike '%train%' then 'SB_OP_TRAIN'
                     when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type', fe.remarks) ilike '%battery%' then 'SB_OP_BATTERY'
                     when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type', fe.remarks) ilike '%add%mat%' then 'SB_OP_ADD_MAT'
                     when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type', fe.remarks) ilike '%return%mat%' then 'SB_OP_RET_MAT'
                     when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type') ilike '%other%' then 'SB_OP_OTHERS'
                     else 'SB_MAINT'
                   end
                 else fe.kind
               end code
          from public.field_events fe
          left join bmap bm on fe.branch_id is null and bm.t = fe.branch_text
         where fe.kind not in ('INSTALL', 'REPLACE', 'BATTERY', 'SB_RETURN')
           and fe.status in ('APPROVED', 'PENDING')
           and not (fe.kind = 'SB_MAINT' and coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type') is null)
           and coalesce(fe.recorded_at, fe.received_at) >= v_from24 - interval '1 day'

        union all

        -- 2. Merchant Visits (including mapped sub-types for POS/SB operational support)
        select coalesce(nullif(trim(m.staff_id), ''), 'UNKNOWN'),
               nullif(trim(m.staff_name), ''),
               coalesce(m.branch_id, bm.bid, 'UNASSIGNED'),
               nullif(trim(m.branch_text), ''),
               (m.submitted_at at time zone 'Asia/Phnom_Penh')::date,
               case
                 when m.activity ilike '%POS Operational Support%' or m.activity ilike '%POS Request%' then
                   case
                     when coalesce(m.answers->>'Request Type', m.answers->>'request_type', m.remarks) ilike '%inspect%' then 'POS_OP_INSPECT'
                     when coalesce(m.answers->>'Request Type', m.answers->>'request_type', m.remarks) ilike '%train%' then 'POS_OP_TRAIN'
                     when coalesce(m.answers->>'Request Type', m.answers->>'request_type', m.remarks) ilike '%paper%' then 'POS_OP_PAPER'
                     when coalesce(m.answers->>'Request Type', m.answers->>'request_type', m.remarks) ilike '%add%mat%' then 'POS_OP_ADD_MAT'
                     when coalesce(m.answers->>'Request Type', m.answers->>'request_type', m.remarks) ilike '%return%mat%' then 'POS_OP_RET_MAT'
                     when coalesce(m.answers->>'Request Type', m.answers->>'request_type', m.remarks) ilike '%other%' then 'POS_OP_OTHERS'
                     else 'POS_MAINT'
                   end
                 when m.activity ilike '%SB Operational Support%' or m.activity ilike '%Sound Box Operational%' or m.activity ilike '%Sound Box Request%' then
                   case
                     when coalesce(m.answers->>'Request Type', m.answers->>'request_type', m.remarks) ilike '%inspect%' then 'SB_OP_INSPECT'
                     when coalesce(m.answers->>'Request Type', m.answers->>'request_type', m.remarks) ilike '%train%' then 'SB_OP_TRAIN'
                     when coalesce(m.answers->>'Request Type', m.answers->>'request_type', m.remarks) ilike '%battery%' then 'SB_OP_BATTERY'
                     when coalesce(m.answers->>'Request Type', m.answers->>'request_type', m.remarks) ilike '%add%mat%' then 'SB_OP_ADD_MAT'
                     when coalesce(m.answers->>'Request Type', m.answers->>'request_type', m.remarks) ilike '%return%mat%' then 'SB_OP_RET_MAT'
                     when coalesce(m.answers->>'Request Type', m.answers->>'request_type', m.remarks) ilike '%other%' then 'SB_OP_OTHERS'
                     else 'SB_MAINT'
                   end
                 when m.activity = 'POS Terminal Inspection' then 'POS_OP_INSPECT'
                 when m.activity in ('POS Refreshment Training', 'Refreshment Training') then 'POS_OP_TRAIN'
                 when m.activity = 'Request Paper Roll' then 'POS_OP_PAPER'
                 when m.activity = 'Request Add Material' then 'POS_OP_ADD_MAT'
                 when m.activity = 'Request Return Materials' then 'POS_OP_RET_MAT'
                 when m.activity = 'SB Inspection' then 'SB_OP_INSPECT'
                 when m.activity = 'SB Refresh Training' then 'SB_OP_TRAIN'
                 when m.activity = 'Battery Replacement' and (m.answers->>'Sound Box Request' is not null or m.activity ilike '%SB%') then 'SB_OP_BATTERY'
                 when m.activity = 'Add Material' and (m.answers->>'Sound Box Request' is not null or m.activity ilike '%SB%') then 'SB_OP_ADD_MAT'
                 when m.activity = 'Returns Material' and (m.answers->>'Sound Box Request' is not null or m.activity ilike '%SB%') then 'SB_OP_RET_MAT'
                 when m.activity in ('Declined – Cash Only (No QR)', 'Declined - Cash Only (No QR)') then 'MV_DECLINED_CASH_ONLY_NO_QR'
                 else app.kpi_mv_code(m.activity)
               end
          from public.mv_visits m
          left join bmap bm on m.branch_id is null and bm.t = m.branch_text
         where m.submitted_at >= v_from24 - interval '1 day'

        union all

        -- 3. Credit Card Onboarding Failed
        select coalesce(nullif(trim(c.staff_id), ''), 'UNKNOWN'),
               nullif(trim(c.staff_name), ''),
               coalesce(c.branch_id, bm.bid, 'UNASSIGNED'),
               nullif(trim(c.branch_text), ''),
               (c.submitted_at at time zone 'Asia/Phnom_Penh')::date,
               'CC_ONBOARD_FAIL'
          from public.cc_entries c
          left join bmap bm on c.branch_id is null and bm.t = c.branch_text
         where (c.card_status = 'Onboarding Failed' or c.review_status = 'NO_REVIEW')
           and c.submitted_at >= v_from24 - interval '1 day'

        union all

        -- 4. KHQR Onboarding Failed
        select coalesce(nullif(trim(q.staff_id), ''), 'UNKNOWN'),
               nullif(trim(q.staff_name), ''),
               coalesce(q.branch_id, bm.bid, 'UNASSIGNED'),
               nullif(trim(q.branch_text), ''),
               (q.submitted_at at time zone 'Asia/Phnom_Penh')::date,
               'KHQR_ONBOARD_FAIL'
          from public.qr_installations q
          left join bmap bm on q.branch_id is null and bm.t = q.branch_text
         where (q.activity = 'SUBMITTED' or q.status = 'FAILED_ATTEMPT')
           and q.submitted_at >= v_from24 - interval '1 day'
      ) e
      join public.kpi_point_rules r on r.code = e.code and r.active
     where e.staff_id <> 'UNKNOWN'
  ),
  -- Staff of the chosen period (same date and working-day rules as the base)
  st_x as (
    select * from kpi_x k
     where (p_since is null or k.d >= p_since) and (p_until is null or k.d <= p_until)
       and (not v_wk or extract(isodow from k.d) not in (6, 7))
       and (not v_hol or not (k.d = any(v_hol_dates)))
  ),
  st_ex as (
    select s.staff_id, jsonb_object_agg(s.code, s.n) extra, max(s.staff_name) staff_name, max(s.branch_id) branch_id, max(s.branch_text) branch_text
      from (select staff_id, code, count(*) n, max(staff_name) staff_name, max(branch_id) branch_id, max(branch_text) branch_text from st_x group by 1, 2) s
     group by 1
  ),
  st_base as (
    select e.value obj, e.value->>'staff_id' k, e.ordinality o
      from jsonb_array_elements(coalesce(v->'staff', '[]'::jsonb)) with ordinality e
  ),
  -- Shared 5-month slice
  k5m as materialized (
    select * from kpi_x k where k.d >= v_from5m
  ),
  -- Monthly staff (5 months, working days only)
  ms_x as (
    select * from k5m k
     where (not v_wk or extract(isodow from k.d) not in (6, 7))
       and (not v_hol or not (k.d = any(v_hol_dates)))
  ),
  ms_ex as (
    select s.m, s.staff_id, jsonb_object_agg(s.code, s.n) extra, max(s.staff_name) staff_name, max(s.branch_id) branch_id, max(s.branch_text) branch_text
      from (select to_char(d, 'YYYY-MM') m, staff_id, code, count(*) n, max(staff_name) staff_name, max(branch_id) branch_id, max(branch_text) branch_text
              from ms_x group by 1, 2, 3) s
     group by 1, 2
  ),
  ms_base as (
    select e.value obj, e.value->>'month' m, e.value->>'staff_id' k, e.ordinality o
      from jsonb_array_elements(coalesce(v->'monthly_staff', '[]'::jsonb)) with ordinality e
  ),
  -- Daily branch (5 months)
  db_ex as (
    select d::text as day, branch_id, count(*) n,
           count(*) filter (where cat = 'POS Terminal') pos_n,
           count(*) filter (where cat = 'Sound Box') sb_n,
           count(*) filter (where cat = 'Credit Card') cc_n,
           count(*) filter (where cat = 'KHQR') khqr_n,
           count(*) filter (where cat = 'Merchant Visit') mv_n,
           count(distinct staff_id) staff_n
      from k5m
     group by 1, 2
  ),
  db_base as (
    select e.value obj, e.value->>'day' dy, e.value->>'branch_id' k, e.ordinality o
      from jsonb_array_elements(coalesce(v->'daily_branch', '[]'::jsonb)) with ordinality e
  ),
  -- Daily staff (5 months)
  ds_ex as (
    select d::text as day, staff_id, count(*) n,
           count(*) filter (where cat = 'POS Terminal') pos_n,
           count(*) filter (where cat = 'Sound Box') sb_n,
           count(*) filter (where cat = 'Credit Card') cc_n,
           count(*) filter (where cat = 'KHQR') khqr_n,
           count(*) filter (where cat = 'Merchant Visit') mv_n,
           max(staff_name) staff_name, max(branch_id) branch_id, max(branch_text) branch_text
      from k5m
     group by 1, 2
  ),
  ds_base as (
    select e.value obj, e.value->>'day' dy, e.value->>'staff_id' k
      from jsonb_array_elements(coalesce(v->'daily_staff', '[]'::jsonb)) e
  )
  select
    (select coalesce(jsonb_agg(
              case when b.obj is not null then b.obj || jsonb_build_object('extra', coalesce(ex.extra, '{}'::jsonb))
                   else v_zero || jsonb_build_object('staff_id', ex.staff_id, 'staff_name', coalesce(sp.name, ex.staff_name, ex.staff_id),
                     'branch_id', coalesce(sp.branch_id, ex.branch_id, 'UNASSIGNED'), 'branch_name', coalesce(br.name, ex.branch_text, 'Unassigned'),
                     'pos_submitted', 0, 'pos_rejected', 0, 'sb_submitted', 0, 'sb_rejected', 0, 'khqr_failed', 0, 'cc_submitted', 0, 'cc_rejected', 0,
                     'extra', ex.extra) end
              order by b.o nulls last, coalesce(sp.name, ex.staff_name)), '[]'::jsonb)
       from st_base b full join st_ex ex on ex.staff_id = b.k
       left join public.staff_profiles sp on b.obj is null and sp.emp_id = ex.staff_id
       left join public.branches br on b.obj is null and br.id = coalesce(sp.branch_id, ex.branch_id)),
    public.kpi_extra_merge(v->'daily', 'period', (select jsonb_object_agg(p, e) from (select p, jsonb_object_agg(code, n) e from (
      select k.d::text p, code, count(*) n from kpi_x k where k.d >= v_today - 89 group by 1, 2) a group by p) z), v_zero),
    public.kpi_extra_merge(v->'weekly', 'period', (select jsonb_object_agg(p, e) from (select p, jsonb_object_agg(code, n) e from (
      select date_trunc('week', k.d::timestamp)::date::text p, code, count(*) n from kpi_x k
       where k.d >= (date_trunc('week', v_today::timestamp)::date - interval '11 weeks')::date group by 1, 2) a group by p) z), v_zero),
    public.kpi_extra_merge(v->'monthly', 'period', (select jsonb_object_agg(p, e) from (select p, jsonb_object_agg(code, n) e from (
      select to_char(k.d, 'YYYY-MM') p, code, count(*) n from kpi_x k
       where k.d >= (date_trunc('month', v_today::timestamp)::date - interval '11 months')::date group by 1, 2) a group by p) z), v_zero),
    public.kpi_extra_merge(v->'quarterly', 'period', (select jsonb_object_agg(p, e) from (select p, jsonb_object_agg(code, n) e from (
      select to_char(date_trunc('quarter', k.d::timestamp)::date, 'YYYY-"Q"Q') p, code, count(*) n from kpi_x k
       where k.d >= (date_trunc('quarter', v_today::timestamp)::date - interval '21 months')::date group by 1, 2) a group by p) z), v_zero),
    (select coalesce(jsonb_agg(
              case when b.obj is not null then b.obj || jsonb_build_object('extra', coalesce(ex.extra, '{}'::jsonb))
                   else v_zero || jsonb_build_object('month', ex.m, 'staff_id', ex.staff_id, 'staff_name', coalesce(sp.name, ex.staff_name, ex.staff_id),
                     'branch_id', coalesce(sp.branch_id, ex.branch_id, 'UNASSIGNED'), 'branch_name', coalesce(br.name, ex.branch_text, 'Unassigned'), 'extra', ex.extra) end
              order by coalesce(b.m, ex.m) desc, coalesce(b.k, ex.staff_id)), '[]'::jsonb)
       from ms_base b full join ms_ex ex on ex.m = b.m and ex.staff_id = b.k
       left join public.staff_profiles sp on b.obj is null and sp.emp_id = ex.staff_id
       left join public.branches br on b.obj is null and br.id = coalesce(sp.branch_id, ex.branch_id)),
    (select coalesce(jsonb_agg(
              case when b.obj is not null then b.obj || jsonb_build_object(
                     'total_tasks', (b.obj->>'total_tasks')::int + coalesce(ex.n, 0),
                     'pos_tasks', (b.obj->>'pos_tasks')::int + coalesce(ex.pos_n, 0),
                     'sb_tasks', (b.obj->>'sb_tasks')::int + coalesce(ex.sb_n, 0),
                     'cc_tasks', (coalesce(b.obj->>'cc_tasks', '0'))::int + coalesce(ex.cc_n, 0),
                     'khqr_tasks', (coalesce(b.obj->>'khqr_tasks', '0'))::int + coalesce(ex.khqr_n, 0),
                     'mv_tasks', (coalesce(b.obj->>'mv_tasks', '0'))::int + coalesce(ex.mv_n, 0))
                   else jsonb_build_object('day', ex.day, 'branch_id', ex.branch_id, 'active_staff', ex.staff_n,
                     'total_tasks', ex.n, 'pos_tasks', ex.pos_n, 'sb_tasks', ex.sb_n, 'khqr_tasks', ex.khqr_n, 'cc_tasks', ex.cc_n, 'mv_tasks', ex.mv_n) end
              order by coalesce(b.dy, ex.day) desc, coalesce(b.k, ex.branch_id)), '[]'::jsonb)
       from db_base b full join db_ex ex on ex.day = b.dy and ex.branch_id = b.k),
    (select coalesce(jsonb_agg(
              case when b.obj is not null then b.obj || jsonb_build_object(
                     'total_tasks', (b.obj->>'total_tasks')::int + coalesce(ex.n, 0),
                     'pos_tasks', (b.obj->>'pos_tasks')::int + coalesce(ex.pos_n, 0),
                     'sb_tasks', (b.obj->>'sb_tasks')::int + coalesce(ex.sb_n, 0),
                     'cc_tasks', (coalesce(b.obj->>'cc_tasks', '0'))::int + coalesce(ex.cc_n, 0),
                     'khqr_tasks', (coalesce(b.obj->>'khqr_tasks', '0'))::int + coalesce(ex.khqr_n, 0),
                     'mv_tasks', (coalesce(b.obj->>'mv_tasks', '0'))::int + coalesce(ex.mv_n, 0))
                   else jsonb_build_object('day', ex.day, 'staff_id', ex.staff_id, 'staff_name', coalesce(sp.name, ex.staff_name, ex.staff_id),
                     'branch_id', coalesce(sp.branch_id, ex.branch_id, 'UNASSIGNED'), 'branch_name', coalesce(br.name, ex.branch_text, 'Unassigned'),
                     'total_tasks', ex.n, 'pos_tasks', ex.pos_n, 'sb_tasks', ex.sb_n, 'khqr_tasks', ex.khqr_n, 'cc_tasks', ex.cc_n, 'mv_tasks', ex.mv_n) end
              order by coalesce(b.dy, ex.day) desc, coalesce(b.k, ex.staff_id)), '[]'::jsonb)
       from ds_base b full join ds_ex ex on ex.day = b.dy and ex.staff_id = b.k
       left join public.staff_profiles sp on b.obj is null and sp.emp_id = ex.staff_id
       left join public.branches br on b.obj is null and br.id = coalesce(sp.branch_id, ex.branch_id))
    into v_staff, v_daily, v_weekly, v_monthly, v_quarterly, v_ms, v_db, v_ds;

  return v || jsonb_build_object(
    'staff', v_staff, 'daily', v_daily, 'weekly', v_weekly, 'monthly', v_monthly, 'quarterly', v_quarterly,
    'monthly_staff', v_ms, 'daily_branch', v_db, 'daily_staff', v_ds
  );
end $$;
revoke all on function app.kpi_dashboard_summary_compute(date, date) from public, anon, authenticated;

-- 4. Guard public wrappers with 30s statement_timeout + advisory lock to prevent concurrent cache-miss stampedes
create or replace function public.kpi_dashboard_summary(p_since date default null, p_until date default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
declare
  v_ver bigint;
  v_key text := coalesce(p_since::text, '-') || '|' || coalesce(p_until::text, '-') || '|' || (now() at time zone 'Asia/Phnom_Penh')::date::text;
  v_res jsonb;
begin
  if auth.uid() is not null and (select app.role()) is null then
    raise exception 'Your account is not active. Ask Admin HQ to restore access.' using errcode = '42501';
  end if;

  select last_value + is_called::int into v_ver from app.kpi_data_seq;
  select c.result into v_res from app.kpi_summary_cache c
   where c.k = v_key
     and ((c.ver = v_ver and c.built_at > now() - interval '10 minutes') or c.built_at > now() - interval '45 seconds');
  if v_res is not null then
    return v_res;
  end if;

  -- Serialize cache rebuilds per key so simultaneous loads share one computation
  perform pg_advisory_xact_lock(hashtext('kpi_summary:' || v_key));

  select last_value + is_called::int into v_ver from app.kpi_data_seq;
  select c.result into v_res from app.kpi_summary_cache c
   where c.k = v_key
     and ((c.ver = v_ver and c.built_at > now() - interval '10 minutes') or c.built_at > now() - interval '45 seconds');
  if v_res is not null then
    return v_res;
  end if;

  v_res := app.kpi_dashboard_summary_compute(p_since, p_until);
  insert into app.kpi_summary_cache as c (k, ver, built_at, result) values (v_key, v_ver, now(), v_res)
    on conflict (k) do update set ver = excluded.ver, built_at = excluded.built_at, result = excluded.result;
  return v_res;
end $$;
revoke all on function public.kpi_dashboard_summary(date, date) from public, anon;
grant execute on function public.kpi_dashboard_summary(date, date) to authenticated, service_role;

create or replace function public.kpi_dashboard_summary(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language sql
volatile
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
  select public.kpi_dashboard_summary(
    case when p_from is not null then (p_from at time zone 'Asia/Phnom_Penh')::date else null end,
    case when p_to is not null then (p_to at time zone 'Asia/Phnom_Penh')::date else null end
  );
$$;
revoke all on function public.kpi_dashboard_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.kpi_dashboard_summary(timestamptz, timestamptz) to authenticated, service_role;

-- Bump cache sequence so subsequent reads compute with the optimized functions
do $$
begin
  if to_regclass('app.kpi_data_seq') is not null then
    perform nextval('app.kpi_data_seq');
  end if;
end $$;

notify pgrst, 'reload schema';

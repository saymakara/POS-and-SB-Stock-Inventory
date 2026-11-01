-- =====================================================================================================================
-- 19 (1 Nov 2026) Cambodian National Holidays & Weekend Exclusion from KPI
-- Official Royal Government of Cambodia Sub-Decrees & National Bank of Cambodia (NBC) Public Holidays
-- =====================================================================================================================

-- 1. Helper function: Returns the Cambodian National Holiday name if the date is an official holiday, or null
create or replace function public.get_cambodia_holiday_name(p_date date)
returns text language plpgsql immutable as $$
declare
  v_iso text := to_char(p_date, 'YYYY-MM-DD');
  v_mmdd text := to_char(p_date, 'MM-DD');
begin
  -- 2025 Official Public Holidays (Royal Decree No. 204)
  case v_iso
    when '2025-01-01' then return 'International New Year''s Day';
    when '2025-01-07' then return 'Victory over Genocide Day';
    when '2025-03-08' then return 'International Women''s Day';
    when '2025-04-14' then return 'Khmer New Year (Day 1)';
    when '2025-04-15' then return 'Khmer New Year (Day 2)';
    when '2025-04-16' then return 'Khmer New Year (Day 3)';
    when '2025-05-01' then return 'International Labour Day';
    when '2025-05-11' then return 'Visak Bochea Day';
    when '2025-05-14' then return 'King Norodom Sihamoni''s Birthday';
    when '2025-05-15' then return 'Royal Ploughing Ceremony';
    when '2025-06-18' then return 'Queen Mother Norodom Monineath Sihanouk''s Birthday';
    when '2025-09-21' then return 'Pchum Ben Festival (Day 1)';
    when '2025-09-22' then return 'Pchum Ben Festival (Day 2)';
    when '2025-09-23' then return 'Pchum Ben Festival (Day 3)';
    when '2025-09-24' then return 'National Constitution Day';
    when '2025-10-15' then return 'Commemoration Day of King-Father Norodom Sihanouk';
    when '2025-10-29' then return 'King Norodom Sihamoni''s Coronation Day';
    when '2025-11-04' then return 'Water Festival (Bon Om Touk Day 1)';
    when '2025-11-05' then return 'Water Festival (Bon Om Touk Day 2)';
    when '2025-11-06' then return 'Water Festival (Bon Om Touk Day 3)';
    when '2025-11-09' then return 'National Independence Day';
    when '2025-12-29' then return 'Peace Day in Cambodia';
    else null;
  end case;

  -- 2026 Official Public Holidays (Sub-Decree No. 167)
  case v_iso
    when '2026-01-01' then return 'International New Year''s Day';
    when '2026-01-07' then return 'Victory over Genocide Day';
    when '2026-03-08' then return 'International Women''s Day';
    when '2026-04-14' then return 'Khmer New Year (Day 1)';
    when '2026-04-15' then return 'Khmer New Year (Day 2)';
    when '2026-04-16' then return 'Khmer New Year (Day 3)';
    when '2026-05-01' then return 'International Labour Day & Visak Bochea';
    when '2026-05-05' then return 'Royal Ploughing Ceremony';
    when '2026-05-14' then return 'King Norodom Sihamoni''s Birthday';
    when '2026-06-18' then return 'Queen Mother Norodom Monineath Sihanouk''s Birthday';
    when '2026-09-24' then return 'National Constitution Day';
    when '2026-10-10' then return 'Pchum Ben Festival (Day 1)';
    when '2026-10-11' then return 'Pchum Ben Festival (Day 2)';
    when '2026-10-12' then return 'Pchum Ben Festival (Day 3)';
    when '2026-10-15' then return 'Commemoration Day of King-Father Norodom Sihanouk';
    when '2026-10-29' then return 'King Norodom Sihamoni''s Coronation Day';
    when '2026-11-09' then return 'National Independence Day';
    when '2026-11-23' then return 'Water Festival (Bon Om Touk Day 1)';
    when '2026-11-24' then return 'Water Festival (Bon Om Touk Day 2)';
    when '2026-11-25' then return 'Water Festival (Bon Om Touk Day 3)';
    when '2026-12-29' then return 'Peace Day in Cambodia';
    else null;
  end case;

  -- 2027 Official Public Holidays
  case v_iso
    when '2027-01-01' then return 'International New Year''s Day';
    when '2027-01-07' then return 'Victory over Genocide Day';
    when '2027-03-08' then return 'International Women''s Day';
    when '2027-04-14' then return 'Khmer New Year (Day 1)';
    when '2027-04-15' then return 'Khmer New Year (Day 2)';
    when '2027-04-16' then return 'Khmer New Year (Day 3)';
    when '2027-05-01' then return 'International Labour Day';
    when '2027-05-14' then return 'King Norodom Sihamoni''s Birthday';
    when '2027-05-20' then return 'Visak Bochea Day';
    when '2027-05-24' then return 'Royal Ploughing Ceremony';
    when '2027-06-18' then return 'Queen Mother Norodom Monineath Sihanouk''s Birthday';
    when '2027-09-24' then return 'National Constitution Day';
    when '2027-09-29' then return 'Pchum Ben Festival (Day 1)';
    when '2027-09-30' then return 'Pchum Ben Festival (Day 2)';
    when '2027-10-01' then return 'Pchum Ben Festival (Day 3)';
    when '2027-10-15' then return 'Commemoration Day of King-Father Norodom Sihanouk';
    when '2027-10-29' then return 'King Norodom Sihamoni''s Coronation Day';
    when '2027-11-09' then return 'National Independence Day';
    when '2027-11-12' then return 'Water Festival (Bon Om Touk Day 1)';
    when '2027-11-13' then return 'Water Festival (Bon Om Touk Day 2)';
    when '2027-11-14' then return 'Water Festival (Bon Om Touk Day 3)';
    when '2027-12-29' then return 'Peace Day in Cambodia';
    else null;
  end case;

  -- Annual recurring fixed holidays
  case v_mmdd
    when '01-01' then return 'International New Year''s Day';
    when '01-07' then return 'Victory over Genocide Day';
    when '03-08' then return 'International Women''s Day';
    when '04-14' then return 'Khmer New Year (Day 1)';
    when '04-15' then return 'Khmer New Year (Day 2)';
    when '04-16' then return 'Khmer New Year (Day 3)';
    when '05-01' then return 'International Labour Day';
    when '05-14' then return 'King Norodom Sihamoni''s Birthday';
    when '06-18' then return 'Queen Mother Norodom Monineath Sihanouk''s Birthday';
    when '09-24' then return 'National Constitution Day';
    when '10-15' then return 'Commemoration Day of King-Father Norodom Sihanouk';
    when '10-29' then return 'King Norodom Sihamoni''s Coronation Day';
    when '11-09' then return 'National Independence Day';
    when '12-29' then return 'Peace Day in Cambodia';
    else null;
  end case;

  return null;
end $$;

-- 2. Helper function: Checks if a date is a standard working day (Monday–Friday non-holiday)
create or replace function public.is_cambodia_workday(p_date date)
returns boolean language plpgsql immutable as $$
declare
  v_dow int := extract(isodow from p_date);
begin
  -- Exclude Saturday (6) and Sunday (7)
  if v_dow in (6, 7) then
    return false;
  end if;
  -- Exclude Cambodian Public Holidays
  if public.get_cambodia_holiday_name(p_date) is not null then
    return false;
  end if;
  return true;
end $$;

-- 3. Update default KPI settings to strictly exclude Weekend (Saturday & Sunday) and Cambodian holidays
update public.kpi_settings
set working_days_mode = 'mon_fri',
    exclude_holidays = true,
    work_days_in_month = 21,
    branch_monthly_target = 420,
    staff_monthly_target = 105
where id = 1;

-- 4. Update kpi_dashboard_summary RPC to respect weekend & holiday exclusion
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
  -- Only count approved events that occurred on working days (excluding weekends and Cambodian holidays)
  with raw_events as (
    select
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
      (case when c.card_status = 'Rejected' then 1 else 0 end) as cc_rejected
    from public.cc_entries c
    where c.review_status = 'CONFIRMED'
      and (p_since is null or (c.submitted_at at time zone 'Asia/Phnom_Penh')::date >= p_since)
      and (p_until is null or (c.submitted_at at time zone 'Asia/Phnom_Penh')::date <= p_until)
      and (not v_exclude_weekend or extract(isodow from (c.submitted_at at time zone 'Asia/Phnom_Penh')::date) not in (6, 7))
      and (not v_exclude_holiday or public.get_cambodia_holiday_name((c.submitted_at at time zone 'Asia/Phnom_Penh')::date) is null)
  ),
  grouped_staff as (
    select
      r.staff_id,
      coalesce(max(sp.full_name), max(r.staff_name), r.staff_id) as staff_name,
      coalesce(max(sp.branch_id), max(r.branch_id), 'UNASSIGNED') as branch_id,
      coalesce(max(b.name), max(r.branch_text), 'Unassigned') as branch_name,
      sum(r.pos_install)::int as pos_install,
      sum(r.pos_replace)::int as pos_replace,
      sum(r.pos_battery)::int as pos_battery,
      sum(r.sb_install)::int as sb_install,
      sum(r.sb_replace)::int as sb_replace,
      sum(r.sb_maint)::int as sb_maint,
      sum(r.sb_return)::int as sb_return,
      sum(r.khqr_install)::int as khqr_install,
      sum(r.khqr_replace)::int as khqr_replace,
      sum(r.khqr_materials)::int as khqr_materials,
      sum(r.cc_primary)::int as cc_primary,
      sum(r.cc_supp)::int as cc_supp,
      sum(r.pos_submitted)::int as pos_submitted,
      sum(r.pos_rejected)::int as pos_rejected,
      sum(r.sb_submitted)::int as sb_submitted,
      sum(r.sb_rejected)::int as sb_rejected,
      sum(r.khqr_failed)::int as khqr_failed,
      sum(r.cc_submitted)::int as cc_submitted,
      sum(r.cc_rejected)::int as cc_rejected
    from raw_events r
    left join public.staff_profiles sp on sp.emp_id = r.staff_id
    left join public.branches b on b.id = coalesce(sp.branch_id, r.branch_id)
    group by r.staff_id
  )
  select coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb) into v_staff from grouped_staff g;

  -- 2) Time-bucketed events over last 24 months
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
      coalesce(jsonb_array_length(c.supplementary), 0)::int as cc_supp
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
      and (not v_exclude_weekend or extract(isodow from d) not in (6, 7))
      and (not v_exclude_holiday or public.get_cambodia_holiday_name(d) is null)
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
      and (not v_exclude_weekend or extract(isodow from d) not in (6, 7))
      and (not v_exclude_holiday or public.get_cambodia_holiday_name(d) is null)
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
      and (not v_exclude_weekend or extract(isodow from d) not in (6, 7))
      and (not v_exclude_holiday or public.get_cambodia_holiday_name(d) is null)
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
      and (not v_exclude_weekend or extract(isodow from d) not in (6, 7))
      and (not v_exclude_holiday or public.get_cambodia_holiday_name(d) is null)
    group by to_char(date_trunc('quarter', d::timestamp)::date, 'YYYY-"Q"Q')
    order by 1 desc
  ),
  monthly_staff_agg as (
    select
      to_char(t.d, 'YYYY-MM') as month,
      t.staff_id,
      coalesce(max(sp.full_name), max(t.staff_name), t.staff_id) as staff_name,
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
      coalesce(max(sp.full_name), max(t.staff_name), t.staff_id) as staff_name,
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

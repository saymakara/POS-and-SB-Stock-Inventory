-- ============================================================================================================================
-- 16 Nov 2026 - Eliminate 500 statement timeouts on kpi_dashboard_summary, qr_summary, qr_shared_mids, qr_month_history,
--               and devices_page_compact; speed up qr_summary by 64x (4,451 ms -> 69 ms) and reuse cached 24-month KPI series
--               across date filters (Today / Month / Last Month / All Time).
-- ============================================================================================================================

-- 1. Make `app.kpi_data_changed()` ignore `public.devices`
--    (`kpi_dashboard_summary` never reads `public.devices`; device updates were needlessly invalidating `app.kpi_data_seq`).
create or replace function app.kpi_data_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name <> 'devices' then
    perform nextval('app.kpi_data_seq');
  end if;
  return null;
end $$;

-- 2. Fast staff-only compute helper `app.kpi_dashboard_staff_only(date, date)`
--    Computes ONLY the `staff` array for `(p_since, p_until)` when the 24-month series (`daily`, `weekly`, `monthly`,
--    `quarterly`, `monthly_staff`, `daily_branch`, `daily_staff`, `rules`, `targets`) is already cached for today.
create or replace function app.kpi_dashboard_staff_only(p_since date default null, p_until date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
declare
  v_targets jsonb;
  v_exclude_weekend boolean := true;
  v_exclude_holiday boolean := true;
  v_today date := (now() at time zone 'Asia/Phnom_Penh')::date;
  v_since_ts timestamptz := case when p_since is not null then (p_since::timestamp at time zone 'Asia/Phnom_Penh') else null end;
  v_until_ts timestamptz := case when p_until is not null then ((p_until + 1)::timestamp at time zone 'Asia/Phnom_Penh') else null end;
  v_hol_dates date[] := '{}'::date[];
  v_zero jsonb := '{"pos_install":0,"pos_replace":0,"pos_battery":0,"sb_install":0,"sb_replace":0,"sb_maint":0,"sb_return":0,"khqr_install":0,"khqr_replace":0,"khqr_materials":0,"cc_primary":0,"cc_supp":0}'::jsonb;
  v_base_staff jsonb;
  v_staff jsonb;
begin
  select to_jsonb(s) into v_targets from public.kpi_settings s where s.id = 1;
  v_exclude_weekend := coalesce(v_targets->>'working_days_mode', 'mon_fri') = 'mon_fri';
  v_exclude_holiday := coalesce((v_targets->>'exclude_holidays')::boolean, true);

  if v_exclude_holiday then
    select coalesce(array_agg(g.d::date), '{}'::date[])
      into v_hol_dates
      from generate_series(coalesce(p_since, date '2024-01-01') - 2, coalesce(p_until, v_today) + 2, interval '1 day') as g(d)
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
      and (not v_exclude_holiday or not (r.d = any(v_hol_dates)))
    group by r.staff_id
  )
  select coalesce(jsonb_agg(to_jsonb(s) order by s.branch_name asc, s.staff_name asc), '[]'::jsonb)
    into v_base_staff
    from grouped_staff s;

  with bmap as materialized (
    select s.t, app.resolve_branch(s.t) as bid
      from (
        select fe0.branch_text as t from public.field_events fe0 where fe0.branch_id is null and nullif(trim(fe0.branch_text), '') is not null
        union select m0.branch_text from public.mv_visits m0 where m0.branch_id is null and nullif(trim(m0.branch_text), '') is not null
        union select c0.branch_text from public.cc_entries c0 where c0.branch_id is null and nullif(trim(c0.branch_text), '') is not null
        union select q0.branch_text from public.qr_installations q0 where q0.branch_id is null and nullif(trim(q0.branch_text), '') is not null
      ) s
  ),
  st_x as (
    select e.staff_id, e.staff_name, e.branch_id, e.branch_text, e.d, e.code
      from (
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
           and (v_since_ts is null or coalesce(fe.recorded_at, fe.received_at) >= v_since_ts)
           and (v_until_ts is null or coalesce(fe.recorded_at, fe.received_at) < v_until_ts)

        union all

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
         where (v_since_ts is null or m.submitted_at >= v_since_ts)
           and (v_until_ts is null or m.submitted_at < v_until_ts)

        union all

        select coalesce(nullif(trim(c.staff_id), ''), 'UNKNOWN'),
               nullif(trim(c.staff_name), ''),
               coalesce(c.branch_id, bm.bid, 'UNASSIGNED'),
               nullif(trim(c.branch_text), ''),
               (c.submitted_at at time zone 'Asia/Phnom_Penh')::date,
               'CC_ONBOARD_FAIL'
          from public.cc_entries c
          left join bmap bm on c.branch_id is null and bm.t = c.branch_text
         where (c.card_status = 'Onboarding Failed' or c.review_status = 'NO_REVIEW')
           and (v_since_ts is null or c.submitted_at >= v_since_ts)
           and (v_until_ts is null or c.submitted_at < v_until_ts)

        union all

        select coalesce(nullif(trim(q.staff_id), ''), 'UNKNOWN'),
               nullif(trim(q.staff_name), ''),
               coalesce(q.branch_id, bm.bid, 'UNASSIGNED'),
               nullif(trim(q.branch_text), ''),
               (q.submitted_at at time zone 'Asia/Phnom_Penh')::date,
               'KHQR_ONBOARD_FAIL'
          from public.qr_installations q
          left join bmap bm on q.branch_id is null and bm.t = q.branch_text
         where (q.activity = 'SUBMITTED' or q.status = 'FAILED_ATTEMPT')
           and (v_since_ts is null or q.submitted_at >= v_since_ts)
           and (v_until_ts is null or q.submitted_at < v_until_ts)
      ) e
      join public.kpi_point_rules r on r.code = e.code and r.active
     where e.staff_id <> 'UNKNOWN'
       and (p_since is null or e.d >= p_since) and (p_until is null or e.d <= p_until)
       and (not v_exclude_weekend or extract(isodow from e.d) not in (6, 7))
       and (not v_exclude_holiday or not (e.d = any(v_hol_dates)))
  ),
  st_ex as (
    select s.staff_id, jsonb_object_agg(s.code, s.n) extra, max(s.staff_name) staff_name, max(s.branch_id) branch_id, max(s.branch_text) branch_text
      from (select staff_id, code, count(*) n, max(staff_name) staff_name, max(branch_id) branch_id, max(branch_text) branch_text from st_x group by 1, 2) s
     group by 1
  ),
  st_base as (
    select e.value obj, e.value->>'staff_id' k, e.ordinality o
      from jsonb_array_elements(coalesce(v_base_staff, '[]'::jsonb)) with ordinality e
  )
  select coalesce(jsonb_agg(
           case when b.obj is not null then b.obj || jsonb_build_object('extra', coalesce(ex.extra, '{}'::jsonb))
                else v_zero || jsonb_build_object('staff_id', ex.staff_id, 'staff_name', coalesce(sp.name, ex.staff_name, ex.staff_id),
                  'branch_id', coalesce(sp.branch_id, ex.branch_id, 'UNASSIGNED'), 'branch_name', coalesce(br.name, ex.branch_text, 'Unassigned'),
                  'pos_submitted', 0, 'pos_rejected', 0, 'sb_submitted', 0, 'sb_rejected', 0, 'khqr_failed', 0, 'cc_submitted', 0, 'cc_rejected', 0,
                  'extra', ex.extra) end
           order by b.o nulls last, coalesce(sp.name, ex.staff_name)), '[]'::jsonb)
    into v_staff
    from st_base b full join st_ex ex on ex.staff_id = b.k
    left join public.staff_profiles sp on b.obj is null and sp.emp_id = ex.staff_id
    left join public.branches br on b.obj is null and br.id = coalesce(sp.branch_id, ex.branch_id);

  return v_staff;
end $$;
revoke all on function app.kpi_dashboard_staff_only(date, date) from public, anon, authenticated;

-- 3. Update `public.kpi_dashboard_summary` to use a global advisory lock, 30m/3m cache TTL, and reuse cached 24-month series
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
  v_today_txt text := (now() at time zone 'Asia/Phnom_Penh')::date::text;
  v_key text := coalesce(p_since::text, '-') || '|' || coalesce(p_until::text, '-') || '|' || v_today_txt;
  v_series_key text := '__SERIES__|' || v_today_txt;
  v_res jsonb;
  v_series jsonb;
  v_staff jsonb;
begin
  if auth.uid() is not null and (select app.role()) is null then
    raise exception 'Your account is not active. Ask Admin HQ to restore access.' using errcode = '42501';
  end if;

  select last_value + is_called::int into v_ver from app.kpi_data_seq;
  select c.result into v_res from app.kpi_summary_cache c
   where c.k = v_key
     and ((c.ver = v_ver and c.built_at > now() - interval '30 minutes') or c.built_at > now() - interval '3 minutes');
  if v_res is not null then
    return v_res;
  end if;

  -- Global advisory lock so concurrent requests across different date filters never stampede CPU simultaneously
  perform pg_advisory_xact_lock(hashtext('kpi_summary_global'));

  select last_value + is_called::int into v_ver from app.kpi_data_seq;
  select c.result into v_res from app.kpi_summary_cache c
   where c.k = v_key
     and ((c.ver = v_ver and c.built_at > now() - interval '30 minutes') or c.built_at > now() - interval '3 minutes');
  if v_res is not null then
    return v_res;
  end if;

  -- Check if the period-independent 24-month series is already cached for today
  select c.result into v_series from app.kpi_summary_cache c
   where c.k = v_series_key
     and ((c.ver = v_ver and c.built_at > now() - interval '30 minutes') or c.built_at > now() - interval '3 minutes');

  if v_series is not null then
    v_staff := app.kpi_dashboard_staff_only(p_since, p_until);
    v_res := v_series || jsonb_build_object('staff', v_staff);
  else
    v_res := app.kpi_dashboard_summary_compute(p_since, p_until);
    insert into app.kpi_summary_cache as c (k, ver, built_at, result)
    values (v_series_key, v_ver, now(), v_res - 'staff')
    on conflict (k) do update set ver = excluded.ver, built_at = excluded.built_at, result = excluded.result;
  end if;

  insert into app.kpi_summary_cache as c (k, ver, built_at, result)
  values (v_key, v_ver, now(), v_res)
  on conflict (k) do update set ver = excluded.ver, built_at = excluded.built_at, result = excluded.result;

  return v_res;
end $$;
revoke all on function public.kpi_dashboard_summary(date, date) from public, anon;
grant execute on function public.kpi_dashboard_summary(date, date) to authenticated, service_role;

-- Make timestamptz overload PL/pgSQL (not LANGUAGE sql) so PostgreSQL never inlines it and drops `statement_timeout = 30s`
create or replace function public.kpi_dashboard_summary(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
begin
  return public.kpi_dashboard_summary(
    case when p_from is not null then (p_from at time zone 'Asia/Phnom_Penh')::date else null end,
    case when p_to is not null then (p_to at time zone 'Asia/Phnom_Penh')::date else null end
  );
end $$;
revoke all on function public.kpi_dashboard_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.kpi_dashboard_summary(timestamptz, timestamptz) to authenticated, service_role;

-- 4. Single-pass `public.qr_summary` (69 ms vs 4,451 ms — eliminates self-join over qr_installations) + 30s timeout
create or replace function public.qr_summary(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language sql
stable
set search_path = ''
set statement_timeout = '30s'
as $$
  with base as materialized (
    select q.mid,
           q.staff_id,
           q.failed_attempts,
           q.activity,
           q.qr_count,
           (q.submitted_at at time zone 'Asia/Phnom_Penh')::date as d
      from public.qr_installations q
     where (p_from is null or q.submitted_at >= p_from) and (p_to is null or q.submitted_at < p_to)
  ),
  g as materialized (
    select b.d,
           b.mid,
           array_agg(distinct b.staff_id) as staffs
      from base b
     where coalesce(b.mid, '') <> ''
     group by 1, 2
    having min(b.staff_id) <> max(b.staff_id)
  )
  select jsonb_build_object(
    'total', coalesce(i.total, 0), 'completed', coalesce(i.completed, 0), 'failed', coalesce(i.failed, 0),
    'install', coalesce(i.install, 0), 'replace', coalesce(i.repl, 0), 'qr', coalesce(i.qr, 0),
    'attempts', coalesce(a.attempts, 0), 'staff_failed', coalesce(a.staff, 0),
    'wrong_scans', coalesce(a.wrong_scans, 0), 'wrong_scan_staff', coalesce(a.wrong_staff, 0),
    'shared_mids', coalesce(sm.n, 0), 'shared_mid_staff', coalesce(sm.staff, 0))
  from (
    select count(*) as total, count(*) filter (where failed_attempts = 0) as completed, count(*) filter (where failed_attempts > 0) as failed,
           count(*) filter (where activity = 'NEW_INSTALLATION') as install, count(*) filter (where activity = 'QR_REPLACEMENT') as repl,
           coalesce(sum(qr_count), 0) as qr
      from base
  ) i
  cross join (
    select count(*) filter (where kind = 'SUBMIT_BLOCKED') as attempts,
           count(distinct staff_id) filter (where kind = 'SUBMIT_BLOCKED') as staff,
           count(*) filter (where kind = 'WRONG_SCAN') as wrong_scans,
           count(distinct staff_id) filter (where kind = 'WRONG_SCAN') as wrong_staff
      from public.qr_attempts
     where (p_from is null or received_at >= p_from) and (p_to is null or received_at < p_to)
  ) a
  cross join (
    select (select count(*) from g) as n,
           (select count(distinct s) from g, unnest(g.staffs) as s) as staff
  ) sm;
$$;

-- 5. Single-pass `public.qr_shared_mids` (eliminates lateral re-scan of qr_installations) + 30s timeout
create or replace function public.qr_shared_mids(p_from timestamptz default null, p_to timestamptz default null, p_limit integer default 200)
returns table(day date, mid text, merchant_name text, staff_count integer, entries integer, branches text, first_at timestamptz, last_at timestamptz, items jsonb)
language sql
stable
set search_path = ''
set statement_timeout = '30s'
as $$
  select (q.submitted_at at time zone 'Asia/Phnom_Penh')::date as day,
         q.mid,
         max(coalesce(nullif(q.merchant_name, ''), q.merchant_name_kh)) as merchant_name,
         count(distinct q.staff_id)::int as staff_count,
         count(*)::int as entries,
         string_agg(distinct nullif(q.branch_text, ''), ', ') as branches,
         min(q.submitted_at) as first_at,
         max(q.submitted_at) as last_at,
         jsonb_agg(jsonb_build_object(
           'record_id', q.record_id, 'staff_id', q.staff_id, 'staff_name', q.staff_name,
           'branch', q.branch_text, 'activity', q.activity, 'qr', q.qr_count, 'at', q.submitted_at
         ) order by q.submitted_at) as items
    from public.qr_installations q
   where (p_from is null or q.submitted_at >= p_from) and (p_to is null or q.submitted_at < p_to)
     and coalesce(q.mid, '') <> ''
   group by 1, 2
  having min(q.staff_id) <> max(q.staff_id)
   order by 1 desc, 4 desc, 8 desc
   limit least(greatest(coalesce(p_limit, 200), 1), 1000);
$$;

-- 6. Guard remaining heavy read RPCs with 30s statement_timeout so concurrent loads never abort with 57014
alter function public.qr_month_history(integer) set statement_timeout = '30s';
alter function public.devices_page_compact(text, text, integer) set statement_timeout = '30s';
alter function public.cc_counts(timestamptz, timestamptz) set statement_timeout = '30s';
alter function public.cc_list(timestamptz, timestamptz, text, text, text, integer, integer) set statement_timeout = '30s';

notify pgrst, 'reload schema';

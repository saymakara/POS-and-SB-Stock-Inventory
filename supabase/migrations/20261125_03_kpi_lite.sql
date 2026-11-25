-- 25 Nov 2026 (speed, less egress): the KPI summary in a compact form.
--
-- The full KPI summary (kpi_dashboard_summary) is ~1.4 MB of JSON: its day-by-day lists repeat every key, staff name and
-- branch name in each of ~3,400 rows. Moving that took ~1.8 s per sign-in and per KPI page open. The compact form holds
-- exactly the same values (nothing dropped or rounded): each list becomes { k: keys, n: names, r: rows as arrays }, and a
-- staff / branch name is sent once and referred to by its number. ~0.4 MB instead of ~1.4 MB.
--
--   kpi_dashboard_summary_lite(p_from, p_to)      = kpi_dashboard_summary(p_from, p_to) packed
--   kpi_dashboard_staff_slice_lite(p_from, p_to)  = kpi_dashboard_staff_slice(p_from, p_to) packed
--
-- Same access rule, same kept copies and freshness as the full functions (they are called inside). The packed copy of a
-- range is kept next to the full copy and used only while it is not older than the full copy. The portal falls back to
-- the full functions when these are missing, so the order of SQL / portal update does not matter.
-- Also: the month-to-date range the Dashboard opens with at sign-in is kept ready during working hours (the 2-minute
-- warm-up), so the first sign-in after a quiet spell no longer waits ~0.6 s for it to be worked out.

-- 1. packing: an array of objects -> { k: [keys], n: [names], r: [[values in key order], ...] }
--    staff_name / branch_name values become the position of the name in n. Other values are copied as they are.
create or replace function app.kpi_pack(a jsonb)
returns jsonb
language sql
stable
set search_path to ''
as $$
  with rows as (
    select e, n
      from jsonb_array_elements(case when jsonb_typeof(a) = 'array' then a else '[]'::jsonb end) with ordinality t(e, n)
     where jsonb_typeof(e) = 'object'
  ), keys as (
    select coalesce(array_agg(k order by k), '{}'::text[]) ks
      from (select distinct jsonb_object_keys(e) k from rows) x
  ), names as (
    select coalesce(array_agg(v order by v), '{}'::text[]) vs
      from (select distinct r.e->>f v from rows r cross join unnest(array['staff_name', 'branch_name']) f
             where jsonb_typeof(r.e->f) = 'string') d
  ), idx as (
    select coalesce(jsonb_object_agg(v, o - 1), '{}'::jsonb) m
      from names cross join unnest(names.vs) with ordinality u(v, o)
  )
  select jsonb_build_object(
    'k', to_jsonb(keys.ks),
    'n', to_jsonb(names.vs),
    'r', coalesce((
      select jsonb_agg((
               select jsonb_agg(case when u.f in ('staff_name', 'branch_name') and jsonb_typeof(r.e->u.f) = 'string'
                                     then idx.m->(r.e->>u.f)
                                     else coalesce(r.e->u.f, 'null'::jsonb) end
                                order by u.o)
                 from unnest(keys.ks) with ordinality u(f, o)) order by r.n)
        from rows r), '[]'::jsonb))
  from keys, names, idx
$$;
revoke all on function app.kpi_pack(jsonb) from public, anon, authenticated;

create or replace function app.kpi_pack_lists(x jsonb, lists text[])
returns jsonb
language plpgsql
stable
set search_path to ''
as $$
declare
  f text;
  out jsonb := coalesce(x, '{}'::jsonb);
begin
  foreach f in array lists loop
    if jsonb_typeof(out->f) = 'array' then
      out := out || jsonb_build_object(f, app.kpi_pack(out->f));
    end if;
  end loop;
  return out || jsonb_build_object('packed', to_jsonb(lists));
end $$;
revoke all on function app.kpi_pack_lists(jsonb, text[]) from public, anon, authenticated;

-- 2. the packed summary of a range, kept next to the full copy (date form, as kpi_dashboard_summary(date, date))
create or replace function app.kpi_lite_for(p_since date, p_until date)
returns jsonb
language plpgsql
security definer
set search_path to ''
set statement_timeout to '30s'
as $$
declare
  v_today_txt text := (now() at time zone 'Asia/Phnom_Penh')::date::text;
  v_key text := coalesce(p_since::text, '-') || '|' || coalesce(p_until::text, '-') || '|' || v_today_txt;
  v_full jsonb;
  v_full_at timestamptz;
  v_res jsonb;
begin
  v_full := public.kpi_dashboard_summary(p_since, p_until);          -- access rule, demand note and kept copy as before
  select c.built_at into v_full_at from app.kpi_summary_cache c where c.k = v_key;
  if v_full_at is not null then
    select c.result into v_res from app.kpi_summary_cache c
     where c.k = 'LITE|' || v_key and c.built_at >= v_full_at;
    if v_res is not null then return v_res; end if;
  end if;
  v_res := app.kpi_pack_lists(v_full, array['daily_staff', 'daily_branch', 'monthly_staff', 'staff']);
  if v_full_at is not null then
    delete from app.kpi_summary_cache c where c.k like 'LITE|%' and c.k not like '%|' || v_today_txt;   -- earlier days
    insert into app.kpi_summary_cache as c (k, ver, built_at, result)
    select 'LITE|' || v_key, s.ver, s.built_at, v_res from app.kpi_summary_cache s where s.k = v_key
    on conflict (k) do update set ver = excluded.ver, built_at = excluded.built_at, result = excluded.result;
  end if;
  return v_res;
end $$;
revoke all on function app.kpi_lite_for(date, date) from public, anon, authenticated;

-- 3. what the portal calls
create or replace function public.kpi_dashboard_summary_lite(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
set statement_timeout to '30s'
as $$
begin
  if auth.uid() is not null and (select app.role()) is null then
    raise exception 'Your account is not active. Ask Admin HQ to restore access.' using errcode = '42501';
  end if;
  return app.kpi_lite_for(
    case when p_from is not null then (p_from at time zone 'Asia/Phnom_Penh')::date else null end,
    case when p_to is not null then (p_to at time zone 'Asia/Phnom_Penh')::date else null end);
end $$;
revoke all on function public.kpi_dashboard_summary_lite(timestamptz, timestamptz) from public, anon;
grant execute on function public.kpi_dashboard_summary_lite(timestamptz, timestamptz) to authenticated, service_role;

create or replace function public.kpi_dashboard_staff_slice_lite(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
set statement_timeout to '30s'
as $$
begin
  return app.kpi_pack_lists(public.kpi_dashboard_staff_slice(p_from, p_to), array['staff']);   -- (its own access rule)
end $$;
revoke all on function public.kpi_dashboard_staff_slice_lite(timestamptz, timestamptz) from public, anon;
grant execute on function public.kpi_dashboard_staff_slice_lite(timestamptz, timestamptz) to authenticated, service_role;

-- 4. the 2-minute warm-up: the ranges in use are kept ready in the packed form too, and the Dashboard's month-to-date
--    range (what sign-in opens) is always kept ready from 06:00 to 21:59
create or replace function app.kpi_mv_prewarm()
returns void
language plpgsql
security definer
set search_path to ''
set statement_timeout to '90s'
as $$
declare
  v_today date := (now() at time zone 'Asia/Phnom_Penh')::date;
  v_m0 date := date_trunc('month', now() at time zone 'Asia/Phnom_Penh')::date;
  v_ver bigint;
  v_d date;
  v_k text;
  r record;
begin
  -- Merchant Visit (mv_kpi_me): the month so far and today, at most 5 minutes old (as 20261123_02)
  foreach v_d in array array[v_m0, v_today] loop
    v_k := v_d::text || '|' || v_today::text || '|' || v_today::text;
    if not exists (select 1 from app.kpi_summary_cache c where c.k = v_k and c.built_at > now() - interval '5 minutes') then
      delete from app.kpi_summary_cache c where c.k = v_k;
      perform public.kpi_dashboard_summary(v_d, v_today);
    end if;
  end loop;
  perform public.mv_kpi_me(jsonb_build_object('staff_id', '__warm__'));      -- the 6 past days (kept for the day)

  -- the portal: ranges opened in the last 20 minutes and (25 Nov 2026) the Dashboard's month-to-date range, remade before
  -- the portal's own rule would reject them (it accepts a copy under 3 minutes old, or under 30 minutes when no data changed)
  select last_value + is_called::int into v_ver from app.kpi_data_seq;
  for r in
    select x.since, x.until from (
      select d.since, d.until, d.last_at from app.kpi_demand d where d.last_at > now() - interval '20 minutes'
      union all
      select v_m0, null::date, now() + interval '1 day'
    ) x
    group by x.since, x.until
    order by max(x.last_at) desc
    limit 8
  loop
    v_k := coalesce(r.since::text, '-') || '|' || coalesce(r.until::text, '-') || '|' || v_today::text;
    if not exists (select 1 from app.kpi_summary_cache c where c.k = v_k
                    and ((c.ver = v_ver and c.built_at > now() - interval '25 minutes') or c.built_at > now() - interval '90 seconds')) then
      delete from app.kpi_summary_cache c where c.k = v_k;
    end if;
    perform app.kpi_lite_for(r.since, r.until);                         -- full copy (when needed) + packed copy (when needed)
  end loop;
  delete from app.kpi_demand d where d.last_at < now() - interval '2 days';
end $$;
revoke all on function app.kpi_mv_prewarm() from public, anon, authenticated;   -- (as before: the timer only)

-- 5. (speed) POS battery card on the Dashboard: ~360 ms -> ~6 ms, the same figures (checked against the old function for
--    all branches, a list of branches, one branch, an empty list and an unknown branch). The ~9,700 POS rows share only a
--    handful of different dates, so each date's age is worked out once and counted for every unit that has it (before:
--    once per unit, with a text pattern check each time); and the branch condition can use the battery index.
create or replace function public.get_pos_battery_summary(p_branch_ids text[] default null::text[], p_lifespan_months integer default 24, p_warning_months integer default 21)
returns jsonb
language sql
stable
set search_path to ''
as $function$
  with params as (
    select
      greatest(1, coalesce(p_lifespan_months, 24)) as lifespan,
      greatest(1, coalesce(p_warning_months, 21)) as warn,
      (now() at time zone 'Asia/Phnom_Penh')::date as ref_date
  ),
  pos as (
    select coalesce(nullif(btrim(d.battery_installed_date), ''), nullif(btrim(d.stock_in_date), ''), nullif(btrim(d.deployed_date), '')) as dt_str
      from public.devices d
     where coalesce(d.archived, false) = false and d.type = 'POS Terminal'
       and (p_branch_ids is null or cardinality(p_branch_ids) = 0)
    union all
    select coalesce(nullif(btrim(d.battery_installed_date), ''), nullif(btrim(d.stock_in_date), ''), nullif(btrim(d.deployed_date), ''))
      from public.devices d
     where coalesce(d.archived, false) = false and d.type = 'POS Terminal'
       and cardinality(p_branch_ids) > 0 and d.branch_id = any(p_branch_ids)
  ),
  src as (
    select dt_str, count(*)::int as n from pos group by dt_str           -- each different date once, with how many units have it
  ),
  calc as (
    select
      s.n,
      case
        when s.dt_str is null or s.dt_str = '' then null
        when s.dt_str ~ '^\d{4}-\d{2}-\d{2}' then
          greatest(
            0,
            (extract(year from p.ref_date)::int - substring(s.dt_str from 1 for 4)::int) * 12
            + (extract(month from p.ref_date)::int - substring(s.dt_str from 6 for 2)::int)
            + case when extract(day from p.ref_date)::int >= substring(s.dt_str from 9 for 2)::int then 0 else -1 end
          )
        else 0
      end as months_used,
      (s.dt_str is not null and s.dt_str <> '') as has_date,
      p.lifespan,
      p.warn
    from src s
    cross join params p
  ),
  agg as (
    select
      coalesce(sum(n), 0)::int as fleet_total,
      coalesce(sum(n) filter (where has_date), 0)::int as total,
      coalesce(sum(n) filter (where has_date and months_used >= lifespan), 0)::int as critical,
      coalesce(sum(n) filter (where has_date and months_used >= warn and months_used < lifespan), 0)::int as replace_soon,
      coalesce(sum(n) filter (where has_date and months_used < warn), 0)::int as healthy,
      coalesce(sum(n) filter (where has_date and months_used < 12 and months_used < warn), 0)::int as fresh_0_to_11,
      coalesce(sum(n) filter (where has_date and months_used >= 12 and months_used < warn), 0)::int as mid_12_to_warn,
      coalesce(sum(months_used::numeric * n) filter (where has_date), 0)::numeric as months_sum,
      (select lifespan from params)::int as lifespan
    from calc
  )
  select jsonb_build_object(
    'fleetTotal', a.fleet_total,
    'total', a.total,
    'healthy', a.healthy,
    'replaceSoon', a.replace_soon,
    'critical', a.critical,
    'fresh0to11', a.fresh_0_to_11,
    'mid12toWarn', a.mid_12_to_warn,
    'avgMonthsUsed', case when a.total > 0 then round(a.months_sum / a.total, 1) else 0 end,
    'avgLifePct', case
      when a.total > 0 then
        greatest(0, least(100, round(((a.lifespan - round(a.months_sum / a.total, 1)) / greatest(1, a.lifespan)) * 100)::int))
      else 0
    end
  )
  from agg a;
$function$;

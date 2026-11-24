-- ============================================================================================================================
-- 24 Nov 2026 - Fast sign-in & refresh boot optimization:
-- 1. Partial covering index for active POS Terminal battery dates so Dashboard POS Battery Status loads in ~5-15ms
--    without waiting for the full 27k-row devices download.
-- 2. Lightweight RPC public.get_pos_battery_summary (SECURITY INVOKER, RLS enforced) returning exact battery lifecycle
--    cohorts matching client-side getBatteryLifecycleStatus().
-- 3. Allow device_page_bounds(p_size) up to 2500 (devices_page_compact already allows up to 5000) to halve full-fleet
--    device RPC round-trips on cold sign-in.
-- ============================================================================================================================

create index if not exists idx_devices_pos_battery_cov
  on public.devices (branch_id)
  include (battery_installed_date, stock_in_date, deployed_date)
  where coalesce(archived, false) = false and type = 'POS Terminal';

create or replace function public.get_pos_battery_summary(
  p_branch_ids text[] default null,
  p_lifespan_months integer default 24,
  p_warning_months integer default 21
)
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
  src as (
    select
      coalesce(
        nullif(btrim(d.battery_installed_date), ''),
        nullif(btrim(d.stock_in_date), ''),
        nullif(btrim(d.deployed_date), '')
      ) as dt_str
    from public.devices d
    where coalesce(d.archived, false) = false
      and d.type = 'POS Terminal'
      and (
        p_branch_ids is null
        or cardinality(p_branch_ids) = 0
        or d.branch_id = any(p_branch_ids)
      )
  ),
  calc as (
    select
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
      count(*)::int as fleet_total,
      count(*) filter (where has_date)::int as total,
      count(*) filter (where has_date and months_used >= lifespan)::int as critical,
      count(*) filter (where has_date and months_used >= warn and months_used < lifespan)::int as replace_soon,
      count(*) filter (where has_date and months_used < warn)::int as healthy,
      count(*) filter (where has_date and months_used < 12 and months_used < warn)::int as fresh_0_to_11,
      count(*) filter (where has_date and months_used >= 12 and months_used < warn)::int as mid_12_to_warn,
      coalesce(sum(months_used) filter (where has_date), 0)::numeric as months_sum,
      max(lifespan)::int as lifespan
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

revoke all on function public.get_pos_battery_summary(text[], integer, integer) from public, anon;
grant execute on function public.get_pos_battery_summary(text[], integer, integer) to authenticated, service_role;

create or replace function public.device_page_bounds(p_size integer default 1000)
returns jsonb
language sql
stable
set search_path to ''
as $function$
  with x as (select d.serial, (row_number() over (order by d.serial)) - 1 as rn from public.devices d)
  select jsonb_build_object(
    'total', (select count(*) from public.devices),
    'bounds', coalesce((
      select jsonb_agg(x.serial order by x.serial)
      from x
      where x.rn % greatest(least(coalesce(p_size, 1000), 2500), 100) = 0
    ), '[]'::jsonb)
  );
$function$;

notify pgrst, 'reload schema';

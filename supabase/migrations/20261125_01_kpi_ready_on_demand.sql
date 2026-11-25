-- ============================================================================================================================
-- 25 Nov 2026 - Portal Dashboard / KPI Performance charts ready before they are opened. No figure or rule changes. Safe to
-- run twice.
--
-- The portal's charts ask for "this month up to now" and "all time" (kpi_dashboard_summary / kpi_dashboard_staff_slice).
-- Those were worked out while the person waited (1-3 s, up to 5 s) whenever the kept copy was older than the usual rule
-- (3 minutes, or 30 minutes when no data changed) - most openings during the working day. The warm-up job only kept the
-- Merchant Visit app's ranges ready.
--
-- 1. app.kpi_demand: which ranges people have opened (written at most once a minute per range).
-- 2. The warm-up (every 2 minutes, 06:00-21:59) also keeps ready, under the SAME freshness rule the portal uses, every range
--    opened in the last 20 minutes - and nothing else, so a quiet portal costs nothing (free-plan friendly).
-- 3. kpi_dashboard_staff_slice keeps what it works out (it read kept copies but never kept its own answer, so the next
--    person asking for the same range waited again).
-- ============================================================================================================================

-- ---- 1. ranges people open ------------------------------------------------------------------------------------------------
create table if not exists app.kpi_demand (
  k text primary key,                                              -- since|until ('-' = open)
  since date,
  until date,
  last_at timestamptz not null default now()
);
revoke all on table app.kpi_demand from public, anon, authenticated;

create or replace function app.kpi_note_demand(p_since date, p_until date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into app.kpi_demand as d (k, since, until, last_at)
  values (coalesce(p_since::text, '-') || '|' || coalesce(p_until::text, '-'), p_since, p_until, now())
  on conflict (k) do update set last_at = excluded.last_at
   where d.last_at < now() - interval '1 minute';                 -- at most one write a minute per range
exception when others then null;                                   -- a note never stops the answer
end $$;
revoke all on function app.kpi_note_demand(date, date) from public, anon, authenticated;

-- ---- 2. kpi_dashboard_summary: notes the range when a person asks (otherwise exactly as 20261123_01) ---------------------
create or replace function public.kpi_dashboard_summary(p_since date default null::date, p_until date default null::date)
returns jsonb
language plpgsql
security definer
set search_path to ''
set statement_timeout to '30s'
as $function$
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
  if auth.uid() is not null then perform app.kpi_note_demand(p_since, p_until); end if;   -- (25 Nov 2026) kept ready while in use

  select last_value + is_called::int into v_ver from app.kpi_data_seq;
  select c.result into v_res from app.kpi_summary_cache c
   where c.k = v_key
     and ((c.ver = v_ver and c.built_at > now() - interval '30 minutes') or c.built_at > now() - interval '3 minutes');
  if v_res is not null then
    return v_res;
  end if;

  select c.result into v_series from app.kpi_summary_cache c
   where c.k = v_series_key
     and ((c.ver = v_ver and c.built_at > now() - interval '30 minutes') or c.built_at > now() - interval '3 minutes');

  if v_series is null then
    -- (23 Nov 2026) only building the shared series waits in line; a second request finds it built when its turn comes
    perform pg_advisory_xact_lock(hashtext('kpi_summary_global'));
    select last_value + is_called::int into v_ver from app.kpi_data_seq;
    select c.result into v_series from app.kpi_summary_cache c
     where c.k = v_series_key
       and ((c.ver = v_ver and c.built_at > now() - interval '30 minutes') or c.built_at > now() - interval '3 minutes');
  end if;

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
end $function$;
revoke all on function public.kpi_dashboard_summary(date, date) from public, anon;
grant execute on function public.kpi_dashboard_summary(date, date) to authenticated, service_role;

-- ---- 3. kpi_dashboard_staff_slice keeps its own answer (same rules, targets and staff figures as before) -----------------
create or replace function public.kpi_dashboard_staff_slice(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
set statement_timeout to '30s'
as $function$
declare
  v_since date := case when p_from is not null then (p_from at time zone 'Asia/Phnom_Penh')::date else null end;
  v_until date := case when p_to is not null then (p_to at time zone 'Asia/Phnom_Penh')::date else null end;
  v_today_txt text := (now() at time zone 'Asia/Phnom_Penh')::date::text;
  v_key text := coalesce(v_since::text, '-') || '|' || coalesce(v_until::text, '-') || '|' || v_today_txt;
  v_ver bigint;
  v_cached jsonb;
  v_rules jsonb;
  v_targets jsonb;
  v_staff jsonb;
  v_out jsonb;
begin
  if auth.uid() is not null and (select app.role()) is null then
    raise exception 'Your account is not active. Ask Admin HQ to restore access.' using errcode = '42501';
  end if;
  if auth.uid() is not null then perform app.kpi_note_demand(v_since, v_until); end if;   -- (25 Nov 2026) kept ready while in use

  select last_value + is_called::int into v_ver from app.kpi_data_seq;
  -- the full summary of the same range, or (25 Nov 2026) this function's own kept answer
  select c.result into v_cached from app.kpi_summary_cache c
   where c.k in (v_key, 'SLICE|' || v_key)
     and ((c.ver = v_ver and c.built_at > now() - interval '30 minutes') or c.built_at > now() - interval '3 minutes')
   order by c.built_at desc
   limit 1;
  if v_cached is not null then
    return jsonb_build_object(
      'rules', v_cached->'rules',
      'targets', v_cached->'targets',
      'staff', v_cached->'staff'
    );
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.sort_order, r.code), '[]'::jsonb)
    into v_rules
    from public.kpi_point_rules r;

  select to_jsonb(s) into v_targets from public.kpi_settings s where s.id = 1;
  if v_targets is null then
    v_targets := jsonb_build_object(
      'branch_daily_target', 20, 'branch_weekly_target', 100, 'branch_monthly_target', 420, 'branch_quarterly_target', 1260,
      'staff_daily_target', 5, 'staff_weekly_target', 25, 'staff_monthly_target', 105, 'staff_quarterly_target', 315,
      'work_days_in_month', 21, 'exclude_holidays', true, 'holiday_days_count', 0, 'working_days_mode', 'mon_fri'
    );
  end if;

  v_staff := app.kpi_dashboard_staff_only(v_since, v_until);
  v_out := jsonb_build_object('rules', v_rules, 'targets', v_targets, 'staff', v_staff);
  insert into app.kpi_summary_cache as c (k, ver, built_at, result)
  values ('SLICE|' || v_key, v_ver, now(), v_out)
  on conflict (k) do update set ver = excluded.ver, built_at = excluded.built_at, result = excluded.result;
  return v_out;
end
$function$;
revoke all on function public.kpi_dashboard_staff_slice(timestamptz, timestamptz) from public, anon;
grant execute on function public.kpi_dashboard_staff_slice(timestamptz, timestamptz) to authenticated, service_role;

-- ---- 4. warm-up: the Merchant Visit ranges (as before) + the ranges opened in the portal in the last 20 minutes --------
create or replace function app.kpi_mv_prewarm()
returns void
language plpgsql
security definer
set search_path = ''
set statement_timeout = '90s'
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

  -- the portal: ranges opened in the last 20 minutes, remade before the portal's own rule would reject them
  -- (it accepts a copy under 3 minutes old, or under 30 minutes when no data changed)
  select last_value + is_called::int into v_ver from app.kpi_data_seq;
  for r in select d.since, d.until from app.kpi_demand d where d.last_at > now() - interval '20 minutes' order by d.last_at desc limit 8 loop
    v_k := coalesce(r.since::text, '-') || '|' || coalesce(r.until::text, '-') || '|' || v_today::text;
    if not exists (select 1 from app.kpi_summary_cache c where c.k = v_k
                    and ((c.ver = v_ver and c.built_at > now() - interval '25 minutes') or c.built_at > now() - interval '90 seconds')) then
      delete from app.kpi_summary_cache c where c.k = v_k;
      perform public.kpi_dashboard_summary(r.since, r.until);
    end if;
  end loop;
  delete from app.kpi_demand d where d.last_at < now() - interval '2 days';
end $$;
revoke all on function app.kpi_mv_prewarm() from public, anon, authenticated;

-- every 2 minutes, 06:00-21:59 Phnom Penh (pg_cron times are UTC: 23:00-14:59)
select cron.schedule('kpi-warm', '*/2 23,0-14 * * *', 'select app.kpi_mv_prewarm()');

notify pgrst, 'reload schema';

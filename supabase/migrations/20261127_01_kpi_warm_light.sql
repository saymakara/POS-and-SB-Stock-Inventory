-- (27 Nov 2026) The portal froze for 3-12 seconds whenever the KPI warm-up job was running.
--
-- What was measured on production (27 Nov, 16:42 and 16:50 Phnom Penh time):
--   * the same portal page load took 0.05-0.2 s per request when the job was idle, and 3-12 s per request (even the
--     tiny branches list) while the job `kpi-warm` (every 2 minutes) was rebuilding the KPI figures;
--   * the rebuild used both CPU cores of the server (a parallel plan), and ran almost every 2 minutes because any new
--     record anywhere made the 90-second-old copy "stale".
--
-- What changes (figures and rules stay exactly the same):
--   1. Every KPI calculation uses one CPU core, never two, so the other core stays free for people using the portal
--      and the phones. Measured: the month rebuild takes 1.3 s on one core vs 1.6-1.8 s on two.
--   2. The warm-up job steps aside when people are loading pages (2 or more requests running): it simply waits for
--      its next turn 2 minutes later, and stops between rebuilds if requests arrive meanwhile.
--   3. Rebuilds are less frequent: a portal copy is remade when older than 4.5 minutes (was 90 seconds), the phone
--      app's month copy when older than 8 minutes (was 5; the app already shows "up to 10 minutes behind").
--   4. The portal accepts a KPI copy up to 6 minutes old when data has changed (was 3), or 30 minutes when nothing
--      changed (as before). KPI figures can therefore be up to 6 minutes behind instead of 3.
--
-- Safe to run more than once. To undo point 1 only: alter function ... reset max_parallel_workers_per_gather.

-- 1. One core for every KPI calculation (applies to everything these functions call)
alter function public.kpi_dashboard_summary(date, date) set max_parallel_workers_per_gather = 0;
alter function app.kpi_dashboard_summary_compute(date, date) set max_parallel_workers_per_gather = 0;
alter function app.kpi_dashboard_staff_only(date, date) set max_parallel_workers_per_gather = 0;
alter function app.kpi_lite_for(date, date) set max_parallel_workers_per_gather = 0;
alter function public.mv_kpi_me(jsonb) set max_parallel_workers_per_gather = 0;
alter function public.kpi_dashboard_staff_slice(timestamptz, timestamptz) set max_parallel_workers_per_gather = 0;

-- 2. "Are people loading pages right now?" - requests from the portal and the phone app all arrive as `authenticator`
create or replace function app.db_busy(p_max integer default 1)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) > p_max
    from pg_catalog.pg_stat_activity a
   where a.backend_type = 'client backend'
     and a.state = 'active'
     and a.usename = 'authenticator'
     and a.pid <> pg_catalog.pg_backend_pid();
$$;
revoke all on function app.db_busy(integer) from public;

-- 3. The warm-up job: steps aside when busy, rebuilds less often, one core
create or replace function app.kpi_mv_prewarm()
returns void
language plpgsql
security definer
set search_path = ''
set statement_timeout = '90s'
set max_parallel_workers_per_gather = 0
as $function$
declare
  v_today date := (now() at time zone 'Asia/Phnom_Penh')::date;
  v_m0 date := date_trunc('month', now() at time zone 'Asia/Phnom_Penh')::date;
  v_ver bigint;
  v_d date;
  v_k text;
  r record;
begin
  -- (27 Nov 2026) people are loading pages: leave the server to them and try again at the next run (2 minutes)
  if app.db_busy(1) then return; end if;

  -- Merchant Visit (mv_kpi_me): the month so far and today, remade when older than 8 minutes (the app accepts 10)
  foreach v_d in array array[v_m0, v_today] loop
    v_k := v_d::text || '|' || v_today::text || '|' || v_today::text;
    if not exists (select 1 from app.kpi_summary_cache c where c.k = v_k and c.built_at > now() - interval '8 minutes') then
      if app.db_busy(1) then return; end if;
      delete from app.kpi_summary_cache c where c.k = v_k;
      perform public.kpi_dashboard_summary(v_d, v_today);
    end if;
  end loop;
  perform public.mv_kpi_me(jsonb_build_object('staff_id', '__warm__'));      -- the 6 past days (kept for the day)

  -- the portal: ranges opened in the last 20 minutes and the Dashboard's month-to-date range, remade when older than
  -- 4.5 minutes and data changed (the portal accepts a copy under 6 minutes old, or under 30 minutes when nothing changed)
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
                    and ((c.ver = v_ver and c.built_at > now() - interval '25 minutes') or c.built_at > now() - interval '270 seconds')) then
      if app.db_busy(1) then return; end if;
      delete from app.kpi_summary_cache c where c.k = v_k;
    end if;
    perform app.kpi_lite_for(r.since, r.until);                         -- full copy (when needed) + packed copy (when needed)
  end loop;
  delete from app.kpi_demand d where d.last_at < now() - interval '2 days';
end $function$;
revoke all on function app.kpi_mv_prewarm() from public, anon, authenticated;   -- the 2-minute job only (as before)

-- 4. The portal's KPI summary: a copy under 6 minutes old is used as it is (was 3); otherwise unchanged
create or replace function public.kpi_dashboard_summary(p_since date default null::date, p_until date default null::date)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '30s'
set max_parallel_workers_per_gather = 0
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
     and ((c.ver = v_ver and c.built_at > now() - interval '30 minutes') or c.built_at > now() - interval '6 minutes');
  if v_res is not null then
    return v_res;
  end if;

  select c.result into v_series from app.kpi_summary_cache c
   where c.k = v_series_key
     and ((c.ver = v_ver and c.built_at > now() - interval '30 minutes') or c.built_at > now() - interval '6 minutes');

  if v_series is null then
    -- (23 Nov 2026) only building the shared series waits in line; a second request finds it built when its turn comes
    perform pg_advisory_xact_lock(hashtext('kpi_summary_global'));
    select last_value + is_called::int into v_ver from app.kpi_data_seq;
    select c.result into v_series from app.kpi_summary_cache c
     where c.k = v_series_key
       and ((c.ver = v_ver and c.built_at > now() - interval '30 minutes') or c.built_at > now() - interval '6 minutes');
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
revoke all on function public.kpi_dashboard_summary(date, date) from public, anon;   -- signed-in users only (as before)
grant execute on function public.kpi_dashboard_summary(date, date) to authenticated, service_role;

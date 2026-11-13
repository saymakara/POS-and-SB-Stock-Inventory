-- ============================================================================================================================
-- 13 Nov 2026 - Portal speed (database side). Measured on the live database before this change (pg_stat_statements):
--   kpi_dashboard_summary   2,339 calls, 871 ms on average (up to 7.1 s), 930 KB result     -> cached (below)
--   qr_shared_mids          7,958 calls, 127 ms (171 ms measured)                           -> about 33 ms, same rows
--   qr_summary              9,004 calls,  83 ms (317 ms measured)                           -> about 42 ms, same result
--   device_page_bounds        148 calls, 347 ms ( 92 ms measured)                           -> about 21 ms, same result
-- Only additions and same-signature replacements: no table, column or row is changed or removed, every function keeps its
-- name, arguments, result and grants. Safe to run twice.
-- ============================================================================================================================

-- ---------------------------------------------------------------------------------------------------------------------------
-- 1. KPI summary: the result is kept and given again until the data behind it changes (or for at most 45 seconds while staff
--    keep submitting), instead of being worked out again (about 1 second, 24 months of entries) for every manager.
--    The figures are the same for every signed-in user (only the "account not active" check depends on the caller, and it
--    still runs on every call before anything is returned).
-- ---------------------------------------------------------------------------------------------------------------------------
create schema if not exists app;

create table if not exists app.kpi_summary_cache (
  k        text primary key,             -- period from | period to | the day in Phnom Penh (the 90-day / 24-month windows move daily)
  ver      bigint not null,              -- the data version the result was worked out from
  built_at timestamptz not null default now(),
  result   jsonb not null
);
alter table app.kpi_summary_cache enable row level security;      -- only the functions below (owner) read and write it
revoke all on app.kpi_summary_cache from public, anon, authenticated;

-- the data version: one step on every insert / update / delete statement in a table the summary reads (a sequence never
-- waits for other sessions, so saving an entry is not slowed down)
create sequence if not exists app.kpi_data_seq;
revoke all on sequence app.kpi_data_seq from public, anon, authenticated;

create or replace function app.kpi_data_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform nextval('app.kpi_data_seq');
  return null;
end $$;
revoke all on function app.kpi_data_changed() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['field_events', 'mv_visits', 'cc_entries', 'qr_installations', 'devices', 'kpi_point_rules',
                           'kpi_settings', 'staff_profiles', 'branches', 'branch_aliases'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists kpi_data_changed on public.%I', t);
      execute format('create trigger kpi_data_changed after insert or update or delete on public.%I
                        for each statement execute function app.kpi_data_changed()', t);
      execute format('drop trigger if exists kpi_data_truncated on public.%I', t);
      execute format('create trigger kpi_data_truncated after truncate on public.%I
                        for each statement execute function app.kpi_data_changed()', t);
    end if;
  end loop;
end $$;

-- the full calculation moves to app.kpi_dashboard_summary_compute (unchanged); public.kpi_dashboard_summary becomes the cache
do $$
begin
  if to_regprocedure('app.kpi_dashboard_summary_compute(date,date)') is null then
    alter function public.kpi_dashboard_summary(date, date) set schema app;
    alter function app.kpi_dashboard_summary(date, date) rename to kpi_dashboard_summary_compute;
  end if;
end $$;
revoke all on function app.kpi_dashboard_summary_compute(date, date) from public, anon, authenticated;

create or replace function public.kpi_dashboard_summary(p_since date default null, p_until date default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_ver bigint;
  v_key text := coalesce(p_since::text, '-') || '|' || coalesce(p_until::text, '-') || '|' || (now() at time zone 'Asia/Phnom_Penh')::date::text;
  v_res jsonb;
begin
  -- the same rule as the calculation itself: deactivated / first-password accounts cannot read KPI figures
  if auth.uid() is not null and (select app.role()) is null then
    raise exception 'Your account is not active. Ask Admin HQ to restore access.' using errcode = '42501';
  end if;
  select last_value + is_called::int into v_ver from app.kpi_data_seq;   -- (is_called: the very first change leaves last_value at 1)
  -- the kept result: worked out from this data version (at most 10 minutes ago), or worked out less than 45 seconds ago
  select c.result into v_res from app.kpi_summary_cache c
   where c.k = v_key
     and ((c.ver = v_ver and c.built_at > now() - interval '10 minutes') or c.built_at > now() - interval '45 seconds');
  if v_res is not null then
    return v_res;
  end if;
  v_res := app.kpi_dashboard_summary_compute(p_since, p_until);
  insert into app.kpi_summary_cache as c (k, ver, built_at, result) values (v_key, v_ver, now(), v_res)
    on conflict (k) do update set ver = excluded.ver, built_at = excluded.built_at, result = excluded.result;
  delete from app.kpi_summary_cache where built_at < now() - interval '2 days';   -- earlier days' periods
  return v_res;
end $$;
revoke all on function public.kpi_dashboard_summary(date, date) from public, anon;
grant execute on function public.kpi_dashboard_summary(date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 2. KHQR "same MID": first the few (day, MID) groups with more than one staff member (a light pass, no per-entry details),
--    then the details of those groups only, through qr_inst_mid_time_idx. Before, the details of all ~12,700 groups of the
--    month were built and then all but a handful thrown away (and the sort spilled to disk).
--    min(staff_id) <> max(staff_id) is "two or more different staff" (both ignore empty staff, as count(distinct) did).
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace function public.qr_shared_mids(p_from timestamptz default null, p_to timestamptz default null, p_limit integer default 200)
returns table(day date, mid text, merchant_name text, staff_count integer, entries integer, branches text,
              first_at timestamptz, last_at timestamptz, items jsonb)
language sql stable set search_path = '' as $$
  with g as materialized (
    select (q.submitted_at at time zone 'Asia/Phnom_Penh')::date as day, q.mid
      from public.qr_installations q
     where (p_from is null or q.submitted_at >= p_from) and (p_to is null or q.submitted_at < p_to)
       and coalesce(q.mid, '') <> ''
     group by 1, 2
    having min(q.staff_id) <> max(q.staff_id)
  )
  select g.day, g.mid, x.merchant_name, x.staff_count, x.entries, x.branches, x.first_at, x.last_at, x.items
    from g
    cross join lateral (
      select max(coalesce(nullif(q.merchant_name, ''), q.merchant_name_kh)) as merchant_name,
             count(distinct q.staff_id)::int as staff_count,
             count(*)::int as entries,
             string_agg(distinct nullif(q.branch_text, ''), ', ') as branches,
             min(q.submitted_at) as first_at,
             max(q.submitted_at) as last_at,
             jsonb_agg(jsonb_build_object('record_id', q.record_id, 'staff_id', q.staff_id, 'staff_name', q.staff_name,
                       'branch', q.branch_text, 'activity', q.activity, 'qr', q.qr_count, 'at', q.submitted_at)
                       order by q.submitted_at) as items
        from public.qr_installations q
       where q.mid = g.mid
         and q.submitted_at >= greatest(coalesce(p_from, '-infinity'::timestamptz), (g.day::timestamp at time zone 'Asia/Phnom_Penh'))
         and q.submitted_at <  least(coalesce(p_to, 'infinity'::timestamptz), ((g.day + 1)::timestamp at time zone 'Asia/Phnom_Penh'))
    ) x
   order by 1 desc, 4 desc, 8 desc
   limit least(greatest(coalesce(p_limit, 200), 1), 1000);
$$;

create or replace function public.qr_summary(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language sql stable set search_path = '' as $$
  with g as materialized (
    select (q.submitted_at at time zone 'Asia/Phnom_Penh')::date as d, q.mid
      from public.qr_installations q
     where (p_from is null or q.submitted_at >= p_from) and (p_to is null or q.submitted_at < p_to)
       and coalesce(q.mid, '') <> ''
     group by 1, 2
    having min(q.staff_id) <> max(q.staff_id)
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
      from public.qr_installations
     where (p_from is null or submitted_at >= p_from) and (p_to is null or submitted_at < p_to)
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
           (select count(distinct q.staff_id)
              from g join public.qr_installations q
                on q.mid = g.mid
               and q.submitted_at >= greatest(coalesce(p_from, '-infinity'::timestamptz), (g.d::timestamp at time zone 'Asia/Phnom_Penh'))
               and q.submitted_at <  least(coalesce(p_to, 'infinity'::timestamptz), ((g.d + 1)::timestamp at time zone 'Asia/Phnom_Penh'))) as staff
  ) sm;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 3. Stock list page starts: one pass over the serial index; the total is a plain count (was: the largest row number).
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace function public.device_page_bounds(p_size integer default 1000)
returns jsonb
language sql stable set search_path = '' as $$
  with x as (select d.serial, (row_number() over (order by d.serial)) - 1 as rn from public.devices d)
  select jsonb_build_object(
           'total', (select count(*) from public.devices),
           'bounds', coalesce((select jsonb_agg(x.serial order by x.serial) from x
                                where x.rn % greatest(least(coalesce(p_size, 1000), 1000), 100) = 0), '[]'::jsonb));
$$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 4. Supabase advisor: the material_lost -> material_types foreign key had no index (slow deletes / joins on materials).
-- ---------------------------------------------------------------------------------------------------------------------------
create index if not exists material_lost_material_code_idx on public.material_lost (material_code);

notify pgrst, 'reload schema';

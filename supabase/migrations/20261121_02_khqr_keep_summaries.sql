-- ============================================================================================================================
-- 21 Nov 2026 - KHQR: KPI Performance and the dashboards keep their numbers after the KHQR details are deleted.
--
-- Why: to keep the database small, the nightly job "khqr-retention" deletes KHQR Installation details (qr_installations) and
-- wrong-scan / blocked-submit records (qr_attempts) older than the start of last month (1 Dec deletes October). Until now:
--   * KPI Performance (and My KPI in the phone app) counted KHQR New Installation / QR Replacement / QR count / failed
--     onboarding from the details only -> October's KHQR points would have dropped to 0 on 1 December;
--   * KHQR page summary cards (totals, completed / failed, attempts, wrong scans, shared MIDs) -> 0 for deleted months;
--   * the phone app's Management Dashboard (KHQR in Merchant Visits, this and last month) -> could lose last month's KHQR.
--   (The KHQR month-trend chart was already safe: it reads qr_monthly_summary.)
--
-- What this file does (nothing is deleted by it; checked 21 Nov: no KHQR detail has been deleted yet - oldest 30 Oct):
--   1. Three small daily summary tables, filled by the nightly job just BEFORE it deletes details:
--        qr_daily_entries      - per day, staff, branch, activity, status: entries, QR count, failed (had failed attempts)
--        qr_daily_attempts     - per day, staff, branch, kind (blocked submit / wrong scan): count
--        qr_daily_shared_mids  - per day, each MID entered by 2+ staff (and who)
--      About 4 MB a year (the details are ~375 MB a year). Same reading rule as the details: admins all, branch staff their
--      branch only (RLS).
--   2. Two read-only views: details + daily summaries as one list (a summary line counts as its number of entries, so every
--      total, count and per-staff / per-day split is EXACTLY what the details gave).
--   3. KPI Performance / My KPI (3 calculation functions), the KHQR summary cards (qr_summary) and the app's Management
--      Dashboard (qr_dash_counts) read those views instead of the details only. Their results are unchanged while the
--      details exist; they stay the same after the details are deleted.
--   4. The nightly job also writes the daily summaries (it still writes qr_monthly_summary for the trend chart).
-- What cannot be kept (by design - those details are deleted): the record list, merchant names, photos, GPS, the
-- shared-MID merchant list and per-record exports for deleted months.
-- Safe to run twice.
-- ============================================================================================================================

-- 1. Daily summaries ---------------------------------------------------------------------------------------------------------
create table if not exists public.qr_daily_entries (
  day date not null, staff_id text not null default '', staff_name text not null default '',
  branch_id text not null default '', branch_text text not null default '',
  activity text not null default '', status text not null default '', failed boolean not null default false,
  entries integer not null default 0, qr integer not null default 0, updated_at timestamptz not null default now(),
  primary key (day, staff_id, staff_name, branch_id, branch_text, activity, status, failed)
);
create table if not exists public.qr_daily_attempts (
  day date not null, staff_id text not null default '', staff_name text not null default '',
  branch_id text not null default '', branch_text text not null default '', kind text not null default '',
  n integer not null default 0, updated_at timestamptz not null default now(),
  primary key (day, staff_id, staff_name, branch_id, branch_text, kind)
);
create table if not exists public.qr_daily_shared_mids (
  day date not null, mid text not null, staffs text[] not null default '{}', branch_ids text[] not null default '{}',
  updated_at timestamptz not null default now(), primary key (day, mid)
);
alter table public.qr_daily_entries enable row level security;
alter table public.qr_daily_attempts enable row level security;
alter table public.qr_daily_shared_mids enable row level security;
drop policy if exists qr_daily_entries_read on public.qr_daily_entries;
create policy qr_daily_entries_read on public.qr_daily_entries for select to authenticated
  using ((select app.is_admin()) or branch_id = (select app.branch()));
drop policy if exists qr_daily_attempts_read on public.qr_daily_attempts;
create policy qr_daily_attempts_read on public.qr_daily_attempts for select to authenticated
  using ((select app.is_admin()) or branch_id = (select app.branch()));
drop policy if exists qr_daily_shared_read on public.qr_daily_shared_mids;
create policy qr_daily_shared_read on public.qr_daily_shared_mids for select to authenticated
  using ((select app.is_admin()) or (select app.branch()) = any(branch_ids));
revoke all on public.qr_daily_entries, public.qr_daily_attempts, public.qr_daily_shared_mids from public, anon, authenticated;
grant select on public.qr_daily_entries, public.qr_daily_attempts, public.qr_daily_shared_mids to authenticated;

-- 2. Details + daily summaries as one list (read with the reader's own rights: security_invoker) -----------------------------
--    A summary line is repeated "entries" times; its QR count is carried on the first copy, so sums stay exact. Its time is
--    midday of its Phnom Penh day (every report groups or filters by Phnom Penh day).
create or replace view app.qr_entries_all with (security_invoker = true) as
  select q.mid, q.staff_id, q.staff_name, q.branch_id::text as branch_id, q.branch_text, q.activity, q.status,
         q.qr_count::int as qr_count, q.failed_attempts::int as failed_attempts, q.submitted_at
    from public.qr_installations q
  union all
  select null::text, nullif(s.staff_id, ''), nullif(s.staff_name, ''), nullif(s.branch_id, ''), nullif(s.branch_text, ''),
         nullif(s.activity, ''), nullif(s.status, ''), case when g = 1 then s.qr else 0 end, case when s.failed then 1 else 0 end,
         ((s.day + time '12:00') at time zone 'Asia/Phnom_Penh')
    from public.qr_daily_entries s cross join lateral generate_series(1, s.entries) g;
create or replace view app.qr_attempts_all with (security_invoker = true) as
  select a.staff_id, a.staff_name, a.branch_id::text as branch_id, a.branch_text, a.kind, a.received_at
    from public.qr_attempts a
  union all
  select nullif(s.staff_id, ''), nullif(s.staff_name, ''), nullif(s.branch_id, ''), nullif(s.branch_text, ''), nullif(s.kind, ''),
         ((s.day + time '12:00') at time zone 'Asia/Phnom_Penh')
    from public.qr_daily_attempts s cross join lateral generate_series(1, s.n) g;
revoke all on app.qr_entries_all, app.qr_attempts_all from public, anon, authenticated;
grant select on app.qr_entries_all, app.qr_attempts_all to authenticated;

-- 3a. KPI Performance / My KPI: the 3 calculation functions read details + summaries (only that line changes) ----------------
do $mig$
declare f text; d text; n text;
begin
  foreach f in array array['public.kpi_dashboard_summary_base(date, date)', 'app.kpi_dashboard_summary_compute(date, date)',
                            'app.kpi_dashboard_staff_only(date, date)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position('app.qr_entries_all' in d) > 0 then continue; end if;   -- done before
    n := regexp_replace(d, 'from public\.qr_installations (q0?)\M', 'from app.qr_entries_all \1', 'g');
    if n = d or position('public.qr_installations' in n) > 0 then
      raise exception '%: the KHQR reading lines were not found as expected - not changed', f;
    end if;
    execute n;
  end loop;
end $mig$;

-- 3b. KHQR summary cards (same results while the details exist; kept after they are deleted) ------------------------------
create or replace function public.qr_summary(p_from timestamptz default null, p_to timestamptz default null) returns jsonb
language sql stable set search_path = '' set statement_timeout = '30s' as $$
  with base as materialized (
    select q.mid, q.staff_id, q.failed_attempts, q.activity, q.qr_count, (q.submitted_at at time zone 'Asia/Phnom_Penh')::date as d
      from app.qr_entries_all q
     where (p_from is null or q.submitted_at >= p_from) and (p_to is null or q.submitted_at < p_to)
  ),
  g as materialized (                                              -- MIDs entered by 2+ staff the same day
    select x.d, x.mid, array_agg(distinct x.staff_id) as staffs
      from (select b.d, b.mid, b.staff_id from base b where coalesce(b.mid, '') <> ''
            union all                                               -- (21 Nov 2026) + days whose details were deleted
            select s.day, s.mid, st from public.qr_daily_shared_mids s, unnest(s.staffs) st
             where (p_from is null or ((s.day + time '12:00') at time zone 'Asia/Phnom_Penh') >= p_from)
               and (p_to is null or ((s.day + time '12:00') at time zone 'Asia/Phnom_Penh') < p_to)) x
     group by 1, 2 having min(x.staff_id) <> max(x.staff_id)
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
      from app.qr_attempts_all
     where (p_from is null or received_at >= p_from) and (p_to is null or received_at < p_to)
  ) a
  cross join (
    select (select count(*) from g) as n, (select count(distinct s) from g, unnest(g.staffs) as s) as staff
  ) sm;
$$;
revoke all on function public.qr_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.qr_summary(timestamptz, timestamptz) to authenticated, service_role;

-- 3c. The phone app's Management Dashboard (KHQR in Merchant Visits: this month and last month) ----------------------------
create or replace function public.qr_dash_counts(p jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('d', t.d, 'br', t.branch_text, 'sid', t.staff_id, 'a', t.activity, 'n', t.n)), '[]'::jsonb)
    from (select (q.submitted_at at time zone 'Asia/Phnom_Penh')::date as d, q.branch_text, q.staff_id, q.activity, count(*) as n
            from app.qr_entries_all q
           where q.submitted_at >= coalesce((p->>'from')::timestamptz, now() - interval '62 days')
           group by 1, 2, 3, 4) t;
$$;
revoke all on function public.qr_dash_counts(jsonb) from public, anon, authenticated;
grant execute on function public.qr_dash_counts(jsonb) to service_role;

-- 4. The nightly job: daily summaries (and the month summary, as before) BEFORE the details are deleted -------------------
create or replace function public.qr_retention_run(p_max integer default 50000) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_cut timestamptz := public.qr_keep_from(); v_e integer := 0; v_a integer := 0; v_n integer := greatest(1, least(coalesce(p_max, 50000), 200000));
begin
  -- MIDs entered by 2+ staff on a day being deleted (read from ALL that day's details, before any is deleted)
  with pick as materialized (select id, (submitted_at at time zone 'Asia/Phnom_Penh')::date as d
                               from public.qr_installations where submitted_at < v_cut order by id limit v_n),
       days as (select distinct d from pick)
  insert into public.qr_daily_shared_mids as s (day, mid, staffs, branch_ids)
  select x.d, x.mid, array_agg(distinct x.staff_id) filter (where x.staff_id is not null),
         array_agg(distinct x.branch_id) filter (where x.branch_id is not null)
    from (select (q.submitted_at at time zone 'Asia/Phnom_Penh')::date as d, q.mid, q.staff_id, q.branch_id::text as branch_id
            from public.qr_installations q
           where q.submitted_at < v_cut and coalesce(q.mid, '') <> ''
             and (q.submitted_at at time zone 'Asia/Phnom_Penh')::date in (select d from days)) x
   group by 1, 2 having min(x.staff_id) <> max(x.staff_id)
  on conflict (day, mid) do update
    set staffs = (select array_agg(distinct v) from unnest(s.staffs || excluded.staffs) v),
        branch_ids = (select array_agg(distinct v) from unnest(s.branch_ids || excluded.branch_ids) v), updated_at = now();

  with del as (
    delete from public.qr_installations q
     where q.id in (select id from public.qr_installations where submitted_at < v_cut order by id limit v_n)
    returning q.submitted_at, q.staff_id, q.staff_name, q.branch_text, q.branch_id, q.activity, q.status, q.qr_count, q.failed_attempts
  ), daily as (                                                     -- (21 Nov 2026) KPI / summary cards / Management Dashboard
    insert into public.qr_daily_entries as s (day, staff_id, staff_name, branch_id, branch_text, activity, status, failed, entries, qr)
    select (submitted_at at time zone 'Asia/Phnom_Penh')::date, coalesce(staff_id, ''), coalesce(staff_name, ''), coalesce(branch_id::text, ''),
           coalesce(branch_text, ''), coalesce(activity, ''), coalesce(status, ''), coalesce(failed_attempts, 0) > 0,
           count(*)::int, coalesce(sum(qr_count), 0)::int
      from del group by 1, 2, 3, 4, 5, 6, 7, 8
    on conflict (day, staff_id, staff_name, branch_id, branch_text, activity, status, failed) do update
      set entries = s.entries + excluded.entries, qr = s.qr + excluded.qr, updated_at = now()
    returning 1
  ), agg as (                                                       -- the month trend chart (as before)
    select date_trunc('month', submitted_at at time zone 'Asia/Phnom_Penh')::date as month, staff_id,
           max(staff_name) as staff_name, max(branch_text) as branch_text, max(branch_id) as branch_id,
           count(*)::int as entries, (count(*) filter (where activity = 'NEW_INSTALLATION'))::int as install,
           (count(*) filter (where activity = 'QR_REPLACEMENT'))::int as replace, coalesce(sum(qr_count), 0)::int as qr
      from del group by 1, 2
  ), ins as (
    insert into public.qr_monthly_summary as s (month, staff_id, staff_name, branch_text, branch_id, entries, install, replace, qr)
    select month, staff_id, staff_name, branch_text, branch_id, entries, install, replace, qr from agg
    on conflict (month, staff_id) do update
      set entries = s.entries + excluded.entries, install = s.install + excluded.install, replace = s.replace + excluded.replace,
          qr = s.qr + excluded.qr, staff_name = coalesce(excluded.staff_name, s.staff_name),
          branch_text = coalesce(excluded.branch_text, s.branch_text), branch_id = coalesce(excluded.branch_id, s.branch_id), updated_at = now()
    returning 1
  )
  select coalesce(sum(entries), 0) into v_e from agg;

  with del as (
    delete from public.qr_attempts a
     where a.id in (select id from public.qr_attempts where received_at < v_cut order by id limit v_n)
    returning a.received_at, a.staff_id, a.staff_name, a.branch_text, a.branch_id, a.kind
  ), daily as (
    insert into public.qr_daily_attempts as s (day, staff_id, staff_name, branch_id, branch_text, kind, n)
    select (received_at at time zone 'Asia/Phnom_Penh')::date, coalesce(staff_id, ''), coalesce(staff_name, ''), coalesce(branch_id::text, ''),
           coalesce(branch_text, ''), coalesce(kind, ''), count(*)::int
      from del group by 1, 2, 3, 4, 5, 6
    on conflict (day, staff_id, staff_name, branch_id, branch_text, kind) do update set n = s.n + excluded.n, updated_at = now()
    returning 1
  ), agg as (
    select date_trunc('month', received_at at time zone 'Asia/Phnom_Penh')::date as month, staff_id,
           max(staff_name) as staff_name, max(branch_text) as branch_text, max(branch_id) as branch_id,
           (count(*) filter (where kind = 'SUBMIT_BLOCKED'))::int as attempts,
           (count(*) filter (where kind = 'WRONG_SCAN'))::int as wrong_scans
      from del group by 1, 2
  ), ins as (
    insert into public.qr_monthly_summary as s (month, staff_id, staff_name, branch_text, branch_id, attempts, wrong_scans)
    select month, staff_id, staff_name, branch_text, branch_id, attempts, wrong_scans from agg
    on conflict (month, staff_id) do update
      set attempts = s.attempts + excluded.attempts, wrong_scans = s.wrong_scans + excluded.wrong_scans,
          staff_name = coalesce(s.staff_name, excluded.staff_name),
          branch_text = coalesce(s.branch_text, excluded.branch_text), branch_id = coalesce(s.branch_id, excluded.branch_id), updated_at = now()
    returning 1
  )
  select coalesce(sum(attempts + wrong_scans), 0) into v_a from agg;

  return jsonb_build_object('kept_from', v_cut, 'entries_removed', v_e, 'attempts_removed', v_a);
end $$;
revoke all on function public.qr_retention_run(integer) from public, anon, authenticated;
grant execute on function public.qr_retention_run(integer) to service_role;

notify pgrst, 'reload schema';

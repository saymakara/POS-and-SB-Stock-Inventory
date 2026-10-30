-- 08 (30 Oct 2026) KHQR: two kinds of failed attempt
--   SUBMIT_BLOCKED : the staff tapped Submit and the app blocked it (what was recorded until now; unchanged)
--   WRONG_SCAN     : a QR with another MID was scanned, recorded silently at scan time, whether or not Submit was tapped
-- Existing rows become SUBMIT_BLOCKED. Every existing number keeps its meaning (it counts SUBMIT_BLOCKED only);
-- wrong scans get their own counts. Safe to run more than once.

-- 1) the kind of each attempt
alter table public.qr_attempts
  add column if not exists kind text not null default 'SUBMIT_BLOCKED';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'qr_attempts_kind_check') then
    alter table public.qr_attempts add constraint qr_attempts_kind_check check (kind in ('SUBMIT_BLOCKED', 'WRONG_SCAN'));
  end if;
end $$;
-- one wrong-scan record per scan session and wrong MID (the camera may read the same QR many times)
create unique index if not exists qr_att_wrong_scan_once_idx
  on public.qr_attempts (session_id, got_mid) where kind = 'WRONG_SCAN';
create index if not exists qr_att_kind_time_idx on public.qr_attempts (kind, received_at desc);

-- 2) monthly totals kept after the details are removed
alter table public.qr_monthly_summary
  add column if not exists wrong_scans integer not null default 0;

-- 3) the phone app's server records either kind ("kind": "WRONG_SCAN"; anything else = SUBMIT_BLOCKED, as before)
create or replace function public.qr_log_attempt(p jsonb)
 returns jsonb language plpgsql security definer set search_path to '' as $function$
declare v_id bigint; v_kind text;
begin
  if coalesce(p->>'event_id', '') = '' or coalesce(p->>'session_id', '') = '' or coalesce(p->>'staff_id', '') = '' then
    raise exception 'event_id, session_id and staff_id are required' using errcode = '22023';
  end if;
  v_kind := case when upper(coalesce(p->>'kind', '')) = 'WRONG_SCAN' then 'WRONG_SCAN' else 'SUBMIT_BLOCKED' end;
  insert into public.qr_attempts (event_id, session_id, activity, staff_id, staff_name, branch_text, branch_id,
    expected_mid, got_mid, got_name, scanned_count, client_at, kind)
  values (left(p->>'event_id', 80), left(p->>'session_id', 80), left(p->>'activity', 40), left(p->>'staff_id', 40),
    left(p->>'staff_name', 120), left(p->>'branch', 120), app.resolve_branch(p->>'branch'),
    left(p->>'expected_mid', 20), left(p->>'got_mid', 20), left(p->>'got_name', 160),
    least(greatest(coalesce((p->>'scanned_count')::int, 0), 0), 50),
    case when (p->>'client_at') ~ '^\d{4}-\d{2}-\d{2}T' then (p->>'client_at')::timestamptz end,
    v_kind)
  on conflict do nothing                       -- same event sent twice, or the same wrong scan again: kept once
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'kind', v_kind, 'duplicate', v_id is null);
end $function$;

-- 4) a saved entry counts only the blocked Submits as its failed attempts (wrong scans are tracked separately)
create or replace function public.qr_submit(p jsonb)
 returns jsonb language plpgsql security definer set search_path to '' as $function$
declare r public.qr_installations; v_failed int; v_logged int; v_id bigint; v_at timestamptz; v_att jsonb;
begin
  if coalesce(p->>'request_id', '') = '' or coalesce(p->>'session_id', '') = '' or coalesce(p->>'staff_id', '') = '' then
    raise exception 'request_id, session_id and staff_id are required' using errcode = '22023';
  end if;
  select * into r from public.qr_installations where request_id = p->>'request_id';
  if found then
    return jsonb_build_object('record_id', r.record_id, 'id', r.id, 'status', r.status, 'failed_attempts', r.failed_attempts, 'duplicate', true);
  end if;
  select count(*) into v_logged from public.qr_attempts where session_id = p->>'session_id' and kind = 'SUBMIT_BLOCKED';
  v_failed := greatest(coalesce((p->>'failed_attempts')::int, 0), v_logged);
  -- the mismatch details: the phone's list, or the server's log when the phone lost some of them
  v_att := case when jsonb_typeof(p->'attempts') = 'array' then p->'attempts' else '[]'::jsonb end;
  if jsonb_array_length(v_att) < v_logged then
    select coalesce(jsonb_agg(jsonb_build_object('at', coalesce(a.client_at, a.received_at), 'expected_mid', a.expected_mid,
             'got_mid', a.got_mid, 'got_name', a.got_name) order by a.received_at), '[]'::jsonb)
      into v_att from public.qr_attempts a where a.session_id = p->>'session_id' and a.kind = 'SUBMIT_BLOCKED';
  end if;
  v_at := case when (p->>'captured_at') ~ '^\d{4}-\d{2}-\d{2}T' then (p->>'captured_at')::timestamptz end;
  insert into public.qr_installations (request_id, session_id, activity, staff_id, staff_name, branch_text, branch_id,
    merchant_name, merchant_name_kh, mid, qr_expected, qr_count, qr_scans, failed_attempts, attempts,
    location, khan, latitude, longitude, gps_accuracy, remark, photo_count, app_version, captured_at)
  values (left(p->>'request_id', 120), left(p->>'session_id', 80), p->>'activity', left(p->>'staff_id', 40),
    left(p->>'staff_name', 120), left(p->>'branch', 120), app.resolve_branch(p->>'branch'),
    left(p->>'merchant_name', 160), nullif(left(p->>'merchant_name_kh', 160), ''), p->>'mid',
    (p->>'qr_expected')::int, (p->>'qr_count')::int, coalesce(p->'qr_scans', '[]'::jsonb), least(v_failed, 999),
    v_att,
    nullif(left(p->>'location', 80), ''), nullif(left(p->>'khan', 80), ''),
    (p->>'latitude')::double precision, (p->>'longitude')::double precision, (p->>'gps_accuracy')::real,
    nullif(left(p->>'remark', 1000), ''), coalesce((p->>'photo_count')::int, 0), left(p->>'app_version', 40), v_at)
  returning id into v_id;
  update public.qr_installations
     set record_id = 'QR-' || to_char(coalesce(v_at, now()) at time zone 'Asia/Phnom_Penh', 'YYYYMMDD') || '-' || lpad(v_id::text, 6, '0')
   where id = v_id
  returning * into r;
  return jsonb_build_object('record_id', r.record_id, 'id', r.id, 'status', r.status, 'failed_attempts', r.failed_attempts, 'duplicate', false);
end $function$;

-- 5) statistics: 'attempts' / 'staff_failed' keep their meaning (blocked Submits); wrong scans are added
create or replace function public.qr_summary(p_from timestamptz default null, p_to timestamptz default null)
 returns jsonb language sql stable set search_path to '' as $function$
  SELECT jsonb_build_object(
    'total', coalesce(i.total, 0),
    'completed', coalesce(i.completed, 0),
    'failed', coalesce(i.failed, 0),
    'install', coalesce(i.install, 0),
    'replace', coalesce(i.repl, 0),
    'qr', coalesce(i.qr, 0),
    'attempts', coalesce(a.attempts, 0),
    'staff_failed', coalesce(a.staff, 0),
    'wrong_scans', coalesce(a.wrong_scans, 0),
    'wrong_scan_staff', coalesce(a.wrong_staff, 0)
  )
  FROM (
    SELECT count(*) AS total,
           count(*) FILTER (WHERE failed_attempts = 0) AS completed,
           count(*) FILTER (WHERE failed_attempts > 0) AS failed,
           count(*) FILTER (WHERE activity = 'NEW_INSTALLATION') AS install,
           count(*) FILTER (WHERE activity = 'QR_REPLACEMENT') AS repl,
           coalesce(sum(qr_count), 0) AS qr
      FROM public.qr_installations
     WHERE (p_from IS NULL OR submitted_at >= p_from)
       AND (p_to IS NULL OR submitted_at < p_to)
  ) i
  CROSS JOIN (
    SELECT count(*) FILTER (WHERE kind = 'SUBMIT_BLOCKED') AS attempts,
           count(DISTINCT staff_id) FILTER (WHERE kind = 'SUBMIT_BLOCKED') AS staff,
           count(*) FILTER (WHERE kind = 'WRONG_SCAN') AS wrong_scans,
           count(DISTINCT staff_id) FILTER (WHERE kind = 'WRONG_SCAN') AS wrong_staff
      FROM public.qr_attempts
     WHERE (p_from IS NULL OR received_at >= p_from)
       AND (p_to IS NULL OR received_at < p_to)
  ) a;
$function$;

-- 6) monthly history gains a wrong_scans column (a new result shape needs drop + create)
drop function if exists public.qr_month_history(integer);
create function public.qr_month_history(p_months integer default 12)
 returns table(month date, entries bigint, install bigint, replace bigint, qr bigint, attempts bigint, staff_failed bigint, detailed boolean, wrong_scans bigint)
 language sql stable set search_path to '' as $function$
  WITH months AS (
    SELECT (date_trunc('month', now() AT TIME ZONE 'Asia/Phnom_Penh') - (n || ' month')::interval)::date AS month
    FROM generate_series(0, greatest(1, least(coalesce(p_months, 12), 36)) - 1) n
  ),
  live_e AS (
    SELECT date_trunc('month', submitted_at AT TIME ZONE 'Asia/Phnom_Penh')::date AS month,
           count(*) AS entries,
           count(*) FILTER (WHERE activity = 'NEW_INSTALLATION') AS install,
           count(*) FILTER (WHERE activity = 'QR_REPLACEMENT') AS replace,
           coalesce(sum(qr_count), 0) AS qr
    FROM public.qr_installations
    WHERE submitted_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Phnom_Penh') - (p_months || ' month')::interval)
    GROUP BY 1
  ),
  live_a AS (
    SELECT date_trunc('month', received_at AT TIME ZONE 'Asia/Phnom_Penh')::date AS month,
           count(*) FILTER (WHERE kind = 'SUBMIT_BLOCKED') AS attempts,
           count(DISTINCT staff_id) FILTER (WHERE kind = 'SUBMIT_BLOCKED') AS staff_failed,
           count(*) FILTER (WHERE kind = 'WRONG_SCAN') AS wrong_scans
    FROM public.qr_attempts
    WHERE received_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Phnom_Penh') - (p_months || ' month')::interval)
    GROUP BY 1
  ),
  summ AS (
    SELECT s.month,
           sum(s.entries)::bigint AS entries,
           sum(s.install)::bigint AS install,
           sum(s.replace)::bigint AS replace,
           sum(s.qr)::bigint AS qr,
           sum(s.attempts)::bigint AS attempts,
           count(DISTINCT s.staff_id) FILTER (WHERE s.attempts > 0)::bigint AS staff_failed,
           sum(s.wrong_scans)::bigint AS wrong_scans
    FROM public.qr_monthly_summary s
    WHERE s.month >= (date_trunc('month', now() AT TIME ZONE 'Asia/Phnom_Penh') - (p_months || ' month')::interval)::date
    GROUP BY s.month
  )
  SELECT m.month,
         (coalesce(e.entries, 0) + coalesce(s.entries, 0))::bigint AS entries,
         (coalesce(e.install, 0) + coalesce(s.install, 0))::bigint AS install,
         (coalesce(e.replace, 0) + coalesce(s.replace, 0))::bigint AS replace,
         (coalesce(e.qr, 0) + coalesce(s.qr, 0))::bigint AS qr,
         (coalesce(a.attempts, 0) + coalesce(s.attempts, 0))::bigint AS attempts,
         greatest(coalesce(a.staff_failed, 0), coalesce(s.staff_failed, 0))::bigint AS staff_failed,
         (m.month >= public.qr_keep_from()::date) AS detailed,
         (coalesce(a.wrong_scans, 0) + coalesce(s.wrong_scans, 0))::bigint AS wrong_scans
  FROM months m
  LEFT JOIN live_e e ON e.month = m.month
  LEFT JOIN live_a a ON a.month = m.month
  LEFT JOIN summ s ON s.month = m.month
  ORDER BY m.month DESC;
$function$;
revoke all on function public.qr_month_history(integer) from public, anon;
grant execute on function public.qr_month_history(integer) to authenticated, service_role;

-- 7) retention: old blocked Submits and old wrong scans are each kept as monthly totals
create or replace function public.qr_retention_run(p_max integer default 50000)
 returns jsonb language plpgsql security definer set search_path to '' as $function$
declare v_cut timestamptz := public.qr_keep_from(); v_e integer := 0; v_a integer := 0; v_n integer := greatest(1, least(coalesce(p_max, 50000), 200000));
begin
  with del as (
    delete from public.qr_installations q
     where q.id in (select id from public.qr_installations where submitted_at < v_cut order by id limit v_n)
    returning q.submitted_at, q.staff_id, q.staff_name, q.branch_text, q.branch_id, q.activity, q.qr_count
  ), agg as (
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
end $function$;

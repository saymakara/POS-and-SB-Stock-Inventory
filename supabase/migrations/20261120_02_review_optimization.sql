-- ============================================================================================================================
-- 20 Nov 2026 - Merchant App Review (KHQR, POS Terminal / Sound Box, Credit Card, Merchant Visits): less space, less work,
-- now and as the data grows. ONE file - run it once in the SQL Editor (at a quiet time, e.g. after 18:00).
--
-- Measured on 20 Nov (statistics since 29 Oct; database 86 MB):
--   qr_installations (KHQR)  26,713 rows in 3 weeks (~1,270 a day): 34 MB = 13 MB data + 21 MB indexes.
--     * Each new entry is written TWICE (the insert, then an update that adds its record number) and a third time when the
--       Telegram link is added: 77,946 updates for 26,733 entries; 64% of them copied the row into every index.
--     * Every one of those updates also told the KPI page that the KPI data changed (its saved results were thrown away).
--     * 4 indexes do the same job (read the entries by date): 12.3 MB.
--     * The portal looks entries up by session 7,311 times with no index: each one reads the whole table (35 ms).
--     * The month history read 2 months when the page asked for 1.
--   field_events (POS Terminal / Sound Box)  3 indexes never used (0 reads since 29 Oct).
--   qr_attempts  1 index never used.
--
-- What this file does (in order):
--   1. KHQR: one index instead of 4 (same speed - checked with hypothetical indexes on the live database: every KHQR query
--      keeps its cost within 2-10%; the 30-day summary was timed 9.7 ms vs 10.0 ms), + an index for the session look-up.
--   2. KHQR save (qr_submit): the record number is written in the insert itself - one write instead of two. Everything
--      else is exactly as before: the same checks, the same values, the same record number (QR-YYYYMMDD-000123), the same
--      answer to the app, the same "already saved" (duplicate) answer.
--   3. KHQR Telegram link (qr_set_post): a call that changes nothing no longer rewrites the row.
--   4. KPI: only a change to a column the KPI counts (activity, branch, QR count, staff, failed attempts = status, time)
--      marks the KPI data as changed - not the Telegram link or the photo count.
--   5. KHQR rows keep 10% room on each data page: the later link update stays inside the page (no index copies).
--   6. KHQR month history: reads only the months asked for (same answer).
--   7. Unused indexes removed: 3 on field_events (tid, old_serial, recorded_at), 1 on qr_attempts.
--      (field_events "mid" index is KEPT although unused - the MID checks are never touched.)
--   8. The 3 KHQR ID indexes are rebuilt (gaps from the double writes); statistics refreshed.
--   9. Clean-up runs sooner on the fast-growing tables (keeps their counts fast).
--
-- NOT changed: no table, column, row of data, policy, permission or KHQR rule (MID check, wrong-scan check, failed
-- attempts, duplicates). Each step holds new submissions for about a second (they wait - none is lost). Safe to run twice.
-- ============================================================================================================================

-- 1. KHQR indexes ---------------------------------------------------------------------------------------------------------
create index if not exists qr_inst_time_cov_idx
  on public.qr_installations (submitted_at desc, id desc)
  include (staff_id, mid, activity, failed_attempts, qr_count);
drop index if exists public.qr_inst_time_idx;
drop index if exists public.idx_qr_inst_submitted_cov_all;
drop index if exists public.qr_inst_submitted_covering_idx;
drop index if exists public.qr_inst_activity_time_idx;
create index if not exists qr_inst_session_idx on public.qr_installations (session_id);

-- 2. KHQR save: one write instead of two (identical result) ----------------------------------------------------------------
create or replace function public.qr_submit(p jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $function$
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
  -- (20 Nov 2026) the row's number is taken first, so the record number is written in the same insert (it used to be a
  -- second write of the whole row). Same number, same record number.
  v_id := nextval('public.qr_installations_id_seq'::regclass);
  insert into public.qr_installations (id, record_id, request_id, session_id, activity, staff_id, staff_name, branch_text, branch_id,
    merchant_name, merchant_name_kh, mid, qr_expected, qr_count, qr_scans, failed_attempts, attempts,
    location, khan, latitude, longitude, gps_accuracy, remark, photo_count, app_version, captured_at)
  overriding system value
  values (v_id, 'QR-' || to_char(coalesce(v_at, now()) at time zone 'Asia/Phnom_Penh', 'YYYYMMDD') || '-' || lpad(v_id::text, 6, '0'),
    left(p->>'request_id', 120), left(p->>'session_id', 80), p->>'activity', left(p->>'staff_id', 40),
    left(p->>'staff_name', 120), left(p->>'branch', 120), app.resolve_branch(p->>'branch'),
    left(p->>'merchant_name', 160), nullif(left(p->>'merchant_name_kh', 160), ''), p->>'mid',
    (p->>'qr_expected')::int, (p->>'qr_count')::int, app.qr_scans_compact(p->'qr_scans'), least(v_failed, 999),
    v_att,
    nullif(left(p->>'location', 80), ''), nullif(left(p->>'khan', 80), ''),
    (p->>'latitude')::double precision, (p->>'longitude')::double precision, (p->>'gps_accuracy')::real,
    nullif(left(p->>'remark', 1000), ''), coalesce((p->>'photo_count')::int, 0), left(p->>'app_version', 40), v_at)
  returning * into r;
  -- (a record deleted by an admin is not saved again: the answer is then the same empty one as before)
  return jsonb_build_object('record_id', r.record_id, 'id', r.id, 'status', r.status, 'failed_attempts', r.failed_attempts, 'duplicate', false);
end $function$;
revoke all on function public.qr_submit(jsonb) from public, anon, authenticated;
grant execute on function public.qr_submit(jsonb) to service_role;

-- 3. KHQR Telegram link: no rewrite when nothing changes ------------------------------------------------------------------
create or replace function public.qr_set_post(p jsonb)
returns void
language sql security definer set search_path = '' as $function$
  update public.qr_installations
     set telegram_link = left(p->>'link', 300), photo_count = coalesce((p->>'photo_count')::int, photo_count)
   where record_id = p->>'record_id'
     and (telegram_link is distinct from left(p->>'link', 300)
          or photo_count is distinct from coalesce((p->>'photo_count')::int, photo_count));
$function$;
revoke all on function public.qr_set_post(jsonb) from public, anon, authenticated;
grant execute on function public.qr_set_post(jsonb) to service_role;

-- 4. KPI: only the columns the KPI counts mark the KPI data as changed (inserts and deletes always do) ------------------------
drop trigger if exists kpi_data_changed on public.qr_installations;
create trigger kpi_data_changed
  after insert or delete or update of activity, branch_id, branch_text, qr_count, staff_id, staff_name, failed_attempts, submitted_at
  on public.qr_installations for each statement execute function app.kpi_data_changed();

-- 5. + 9. room for the link update in each page; clean-up sooner (new pages only - nothing is rewritten now) ------------------
alter table public.qr_installations set (fillfactor = 90, autovacuum_vacuum_insert_scale_factor = 0.05, autovacuum_vacuum_scale_factor = 0.05);
alter table public.field_events set (autovacuum_vacuum_insert_scale_factor = 0.05, autovacuum_vacuum_scale_factor = 0.05);
alter table public.mv_visits set (autovacuum_vacuum_insert_scale_factor = 0.05, autovacuum_vacuum_scale_factor = 0.05);

-- 6. KHQR month history: only the months asked for (the answer is the same) -------------------------------------------------
create or replace function public.qr_month_history(p_months integer default 12)
returns table(month date, entries bigint, install bigint, replace bigint, qr bigint, attempts bigint, staff_failed bigint, detailed boolean, wrong_scans bigint)
language sql stable set search_path = '' set statement_timeout = '30s' as $function$
  with bounds as (
    select least(greatest(coalesce(p_months, 12), 1), 36) as m_cnt,
           date_trunc('month', now() at time zone 'Asia/Phnom_Penh')::date as cur_m,
           -- (20 Nov 2026) the first month shown, not one month before it
           ((date_trunc('month', now() at time zone 'Asia/Phnom_Penh') - make_interval(months => least(greatest(coalesce(p_months, 12), 1), 36) - 1)) at time zone 'Asia/Phnom_Penh') as since_ts
  ),
  months as (
    select (b.cur_m - make_interval(months => n))::date as month
      from bounds b,
           generate_series(0, b.m_cnt - 1) n
  ),
  live_e as (
    select date_trunc('month', q.submitted_at at time zone 'Asia/Phnom_Penh')::date as month,
           count(*) as entries,
           count(*) filter (where q.activity = 'NEW_INSTALLATION') as install,
           count(*) filter (where q.activity = 'QR_REPLACEMENT') as replace,
           coalesce(sum(q.qr_count), 0) as qr
      from public.qr_installations q, bounds b
     where q.submitted_at >= b.since_ts
     group by 1
  ),
  live_a as (
    select date_trunc('month', a.received_at at time zone 'Asia/Phnom_Penh')::date as month,
           count(*) filter (where a.kind = 'SUBMIT_BLOCKED') as attempts,
           count(distinct a.staff_id) filter (where a.kind = 'SUBMIT_BLOCKED') as staff_failed,
           count(*) filter (where a.kind = 'WRONG_SCAN') as wrong_scans
      from public.qr_attempts a, bounds b
     where a.received_at >= b.since_ts
     group by 1
  ),
  summ as (
    select s.month,
           sum(s.entries)::bigint as entries,
           sum(s.install)::bigint as install,
           sum(s.replace)::bigint as replace,
           sum(s.qr)::bigint as qr,
           sum(s.attempts)::bigint as attempts,
           count(distinct s.staff_id) filter (where s.attempts > 0)::bigint as staff_failed,
           sum(s.wrong_scans)::bigint as wrong_scans
      from public.qr_monthly_summary s, bounds b
     where s.month >= (b.cur_m - make_interval(months => b.m_cnt))::date
     group by s.month
  )
  select m.month,
         (coalesce(e.entries, 0) + coalesce(s.entries, 0))::bigint as entries,
         (coalesce(e.install, 0) + coalesce(s.install, 0))::bigint as install,
         (coalesce(e.replace, 0) + coalesce(s.replace, 0))::bigint as replace,
         (coalesce(e.qr, 0) + coalesce(s.qr, 0))::bigint as qr,
         (coalesce(a.attempts, 0) + coalesce(s.attempts, 0))::bigint as attempts,
         greatest(coalesce(a.staff_failed, 0), coalesce(s.staff_failed, 0))::bigint as staff_failed,
         (m.month >= public.qr_keep_from()::date) as detailed,
         (coalesce(a.wrong_scans, 0) + coalesce(s.wrong_scans, 0))::bigint as wrong_scans
    from months m
    left join live_e e on e.month = m.month
    left join live_a a on a.month = m.month
    left join summ s on s.month = m.month
   order by m.month desc;
$function$;
revoke all on function public.qr_month_history(integer) from public, anon;
grant execute on function public.qr_month_history(integer) to authenticated, service_role;

-- 7. indexes never used (0 reads since 29 Oct 2026) ------------------------------------------------------------------------
drop index if exists public.idx_field_events_tid;
drop index if exists public.idx_field_events_old_serial;
drop index if exists public.idx_field_events_recorded_at;
drop index if exists public.qr_att_received_covering_idx;

-- 8. rebuild the KHQR ID indexes (the same indexes, without the gaps); fresh statistics -----------------------------------
reindex index public.qr_installations_record_id_key;
reindex index public.qr_installations_request_id_key;
reindex index public.qr_installations_pkey;
analyze public.qr_installations;
analyze public.field_events;
analyze public.qr_attempts;

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------------------------------------------------------
-- OPTIONAL, run AFTER the file above, as ONE line on its own (the SQL Editor cannot run it together with other lines):
--   vacuum (full, analyze) app.kpi_summary_cache;
-- The KPI page's saved results: 17 rows that take 3.7 MB on disk (old copies). Rebuilt in under a second; the KPI page
-- simply works its figures out again once.
--
-- Check (optional): KHQR before 13 MB data + 21 MB indexes
--   select pg_size_pretty(pg_table_size('public.qr_installations')) as data, pg_size_pretty(pg_indexes_size('public.qr_installations')) as indexes;
-- ============================================================================================================================

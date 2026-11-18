-- ============================================================================================================================
-- 18 Nov 2026 - KHQR Installation: qr_scans kept in a compact form (option B1).
--
-- Each scanned QR was kept as {"n":1,"at":"2026-...T...Z","crc":"2991"}: 212 bytes a row on average (37% of a row's data).
-- Now only its number and checksum are kept, as text "n:crc": ["1:2991","2:2991"] - 33 bytes a row (measured on 2,000 rows).
-- The per-scan time is dropped (the entry keeps its own captured_at / submitted_at). Nothing in the portal or the database
-- reads qr_scans (checked: only qr_submit writes it), so no page, export, KPI or summary changes.
--
-- 1. app.qr_scans_compact(): the conversion (an entry already compact is returned as it is; safe to run twice).
-- 2. qr_submit: new entries are saved compact from now on (the same function as before, with that one change).
-- 3. The entries already saved are converted AT NIGHT (1:00-4:50 Phnom Penh, with the existing KHQR clean-up): 3,000
--    every 10 minutes, so the KHQR page of anyone still signed in never receives thousands of live updates at once.
--    The night job removes itself when nothing is left (about 21,500 entries: one night).
-- No table, column, index or policy is changed. Safe to run twice.
-- ============================================================================================================================

-- 1. the conversion
create or replace function app.qr_scans_compact(s jsonb)
returns jsonb
language sql immutable set search_path = '' as $$
  select case
    when s is null or jsonb_typeof(s) <> 'array' then '[]'::jsonb
    when not exists (select 1 from jsonb_array_elements(s) e where jsonb_typeof(e) = 'object') then s
    else coalesce((select jsonb_agg(case when jsonb_typeof(e) = 'object'
                                         then to_jsonb(coalesce(e->>'n', o::text) || ':' || coalesce(e->>'crc', ''))
                                         else e end order by o)
                     from jsonb_array_elements(s) with ordinality x(e, o)), '[]'::jsonb)
  end;
$$;
revoke all on function app.qr_scans_compact(jsonb) from public, anon, authenticated;

-- 2. new entries: saved compact (qr_submit as before; only qr_scans goes through app.qr_scans_compact)
create or replace function public.qr_submit(p jsonb)
returns jsonb
language plpgsql security definer set search_path to '' as $function$
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
    (p->>'qr_expected')::int, (p->>'qr_count')::int, app.qr_scans_compact(p->'qr_scans'), least(v_failed, 999),
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

-- 3. the entries already saved: converted at night, in steps; the job removes itself when done
create or replace function app.qr_scans_compact_run(p_max integer default 3000)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v integer;
begin
  update public.qr_installations q
     set qr_scans = app.qr_scans_compact(q.qr_scans)
   where q.id in (select id from public.qr_installations
                   where jsonb_typeof(qr_scans->0) = 'object'
                   order by id limit greatest(1, least(coalesce(p_max, 3000), 20000)));
  get diagnostics v = row_count;
  if v = 0 then
    perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'khqr-compact-scans';
  end if;
  return v;
end $$;
revoke all on function app.qr_scans_compact_run(integer) from public, anon, authenticated;

-- 18:00-21:50 UTC = 1:00-4:50 Phnom Penh (the existing khqr-retention job runs in the same hours)
select cron.unschedule(jobid) from cron.job where jobname = 'khqr-compact-scans';
select cron.schedule('khqr-compact-scans', '*/10 18-21 * * *', 'select app.qr_scans_compact_run(3000)');

-- Check (optional, the next morning): 0 = all converted; the night job is then gone from cron.job
-- select count(*) from public.qr_installations where jsonb_typeof(qr_scans->0) = 'object';
-- select jobname, schedule from cron.job;

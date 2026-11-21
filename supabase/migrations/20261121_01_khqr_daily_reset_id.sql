-- ============================================================================================================================
-- 21 Nov 2026 - KHQR Installation ID (record_id): reset daily counter each Phnom Penh day instead of counting straight
-- across days via the global identity primary key.
--
-- Previously:
--   qr_submit() formatted record_id as 'QR-' || YYYYMMDD || '-' || lpad(v_id::text, 6, '0'), where v_id came from the
--   global monotonic public.qr_installations_id_seq (so 2026-11-21 produced QR-20261121-026738 .. QR-20261121-026805
--   right after 2026-11-20's 026737).
--
-- Now:
--   1. app.qr_daily_seq(day date primary key, last_no bigint not null) keeps an atomic per-day sequence in Asia/Phnom_Penh
--      (resetting to 1 -> 000001 every new calendar day).
--   2. Existing rows stay untouched so previously issued Telegram posts / phone app caches keep working; seeding from
--      existing qr_installations counts puts the rest of today at its true daily count (e.g. 000069+) and every new day
--      starts at 000001.
--   3. Safe against concurrent submissions (atomic single-row upsert) and duplicate/tombstone retries (checked before
--      bumping the counter).
-- Safe to run twice.
-- ============================================================================================================================

-- 1. Atomic per-day sequence table (internal schema only) -------------------------------------------------------------------
create table if not exists app.qr_daily_seq (
  day     date primary key,
  last_no bigint not null check (last_no >= 0)
);
alter table app.qr_daily_seq enable row level security;
revoke all on table app.qr_daily_seq from public, anon, authenticated;

-- Seed from existing qr_installations (by the YYYYMMDD date stamped on each record_id) so today continues from its
-- current daily count without colliding, and any offline sync for a past day gets the next number for that day.
insert into app.qr_daily_seq as s (day, last_no)
select to_date(substring(record_id from 4 for 8), 'YYYYMMDD') as day,
       count(*)::bigint as last_no
  from public.qr_installations
 where record_id ~ '^QR-\d{8}-\d+$'
 group by 1
on conflict (day) do update
  set last_no = greatest(s.last_no, excluded.last_no);

-- 2. Updated qr_submit: uses daily-resetting sequence instead of global v_id ------------------------------------------------
create or replace function public.qr_submit(p jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare
  r        public.qr_installations;
  v_failed int;
  v_logged int;
  v_id     bigint;
  v_at     timestamptz;
  v_att    jsonb;
  v_day    date;
  v_seq    bigint;
  v_prefix text;
  v_rec    text;
begin
  if coalesce(p->>'request_id', '') = '' or coalesce(p->>'session_id', '') = '' or coalesce(p->>'staff_id', '') = '' then
    raise exception 'request_id, session_id and staff_id are required' using errcode = '22023';
  end if;

  select * into r from public.qr_installations where request_id = p->>'request_id';
  if found then
    return jsonb_build_object('record_id', r.record_id, 'id', r.id, 'status', r.status, 'failed_attempts', r.failed_attempts, 'duplicate', true);
  end if;

  -- Check tombstones before allocating an id / daily sequence number when a deleted phone record retries.
  if exists (select 1 from public.deleted_phone_records d where d.request_id = left(p->>'request_id', 120)) then
    return jsonb_build_object('record_id', null, 'id', null, 'status', null, 'failed_attempts', null, 'duplicate', false);
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
  v_day := (coalesce(v_at, now()) at time zone 'Asia/Phnom_Penh')::date;
  v_prefix := 'QR-' || to_char(v_day, 'YYYYMMDD') || '-';

  -- Atomic daily counter in app.qr_daily_seq; loop skips any pre-existing or tombstoned ID (e.g. from older dates).
  loop
    insert into app.qr_daily_seq as s (day, last_no)
    values (v_day, 1)
    on conflict (day) do update set last_no = s.last_no + 1
    returning last_no into v_seq;
    v_rec := v_prefix || lpad(v_seq::text, greatest(6, length(v_seq::text)), '0');
    exit when not exists (select 1 from public.qr_installations q where q.record_id = v_rec)
          and not exists (select 1 from public.deleted_phone_records d where d.record_id = v_rec);
  end loop;

  v_id := nextval('public.qr_installations_id_seq'::regclass);
  insert into public.qr_installations (id, record_id, request_id, session_id, activity, staff_id, staff_name, branch_text, branch_id,
    merchant_name, merchant_name_kh, mid, qr_expected, qr_count, qr_scans, failed_attempts, attempts,
    location, khan, latitude, longitude, gps_accuracy, remark, photo_count, app_version, captured_at)
  overriding system value
  values (v_id, v_rec,
    left(p->>'request_id', 120), left(p->>'session_id', 80), p->>'activity', left(p->>'staff_id', 40),
    left(p->>'staff_name', 120), left(p->>'branch', 120), app.resolve_branch(p->>'branch'),
    left(p->>'merchant_name', 160), nullif(left(p->>'merchant_name_kh', 160), ''), p->>'mid',
    (p->>'qr_expected')::int, (p->>'qr_count')::int, app.qr_scans_compact(p->'qr_scans'), least(v_failed, 999),
    v_att,
    nullif(left(p->>'location', 80), ''), nullif(left(p->>'khan', 80), ''),
    (p->>'latitude')::double precision, (p->>'longitude')::double precision, (p->>'gps_accuracy')::real,
    nullif(left(p->>'remark', 1000), ''), coalesce((p->>'photo_count')::int, 0), left(p->>'app_version', 40), v_at)
  returning * into r;

  return jsonb_build_object('record_id', r.record_id, 'id', r.id, 'status', r.status, 'failed_attempts', r.failed_attempts, 'duplicate', false);
end $function$;

revoke all on function public.qr_submit(jsonb) from public, anon, authenticated;
grant execute on function public.qr_submit(jsonb) to service_role;

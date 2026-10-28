-- 28 Oct 2026 · KHQR Installation / QR Replacement from the Merchant Visit phone app.
-- Up to ~50,000 entries a month, stored here only (not in Google Sheets). Written ONLY by the phone app's Apps Script
-- backend (service key) through qr_submit / qr_log_attempt / qr_set_post; read by the dashboard (Phone App Review → KHQR).
--
-- Status: COMPLETED when every QR of the scanning session carried the same MID at the first try; FAILED_ATTEMPT when
-- the staff member scanned a QR with another MID at least once before submitting. The number of failed attempts is the
-- larger of what the phone reports and what the server logged while it happened (qr_attempts), so clearing the phone
-- cannot hide a failure.

create table if not exists public.qr_installations (
  id               bigint generated always as identity primary key,
  record_id        text unique,
  request_id       text not null unique,                     -- staff id + the phone's request id: a retry never saves twice
  session_id       text not null,
  activity         text not null check (activity in ('NEW_INSTALLATION', 'QR_REPLACEMENT')),
  staff_id         text not null,
  staff_name       text,
  branch_text      text,
  branch_id        varchar references public.branches(id) on update cascade on delete set null,
  merchant_name    text not null,
  merchant_name_kh text,
  mid              text not null check (mid ~ '^\d{15}$'),
  qr_expected      smallint not null check (qr_expected between 1 and 50),
  qr_count         smallint not null check (qr_count between 1 and 50),
  qr_scans         jsonb not null default '[]'::jsonb,       -- [{ "n": 1, "crc": "A1B2", "at": "…" }] (compact: no full QR text)
  failed_attempts  smallint not null default 0 check (failed_attempts >= 0),
  status           text generated always as (case when failed_attempts = 0 then 'COMPLETED' else 'FAILED_ATTEMPT' end) stored,
  attempts         jsonb not null default '[]'::jsonb,       -- each mismatch: { "at", "expected_mid", "got_mid", "got_name" }
  latitude         double precision check (latitude between -90 and 90),
  longitude        double precision check (longitude between -180 and 180),
  gps_accuracy     real,
  remark           text check (char_length(remark) <= 1000),
  photo_count      smallint not null default 0,
  telegram_link    text,
  app_version      text,
  captured_at      timestamptz,                              -- the phone's time (an entry kept offline is sent later)
  submitted_at     timestamptz not null default now(),
  review_status    text not null default 'PENDING' check (review_status in ('PENDING', 'CHECKED', 'ESCALATED')),
  reviewed_by      uuid,
  reviewed_by_name text,
  reviewed_at      timestamptz,
  review_note      text check (char_length(review_note) <= 500)
);
create index if not exists qr_inst_time_idx    on public.qr_installations (submitted_at desc, id desc);
create index if not exists qr_inst_branch_idx  on public.qr_installations (branch_id, submitted_at desc);
create index if not exists qr_inst_mid_idx     on public.qr_installations (mid);
create index if not exists qr_inst_staff_idx   on public.qr_installations (staff_id, submitted_at desc);
create index if not exists qr_inst_flag_idx    on public.qr_installations (submitted_at desc) where failed_attempts > 0 and review_status = 'PENDING';

create table if not exists public.qr_attempts (
  id              bigint generated always as identity primary key,
  event_id        text not null unique,                     -- made on the phone: a retry is stored once
  session_id      text not null,
  activity        text,
  staff_id        text not null,
  staff_name      text,
  branch_text     text,
  branch_id       varchar references public.branches(id) on update cascade on delete set null,
  expected_mid    text,
  got_mid         text,
  got_name        text,
  scanned_count   smallint,
  client_at       timestamptz,
  received_at     timestamptz not null default now()
);
create index if not exists qr_att_session_idx on public.qr_attempts (session_id);
create index if not exists qr_att_time_idx    on public.qr_attempts (received_at desc);

alter table public.qr_installations enable row level security;
alter table public.qr_attempts enable row level security;
revoke all on public.qr_installations, public.qr_attempts from anon;
revoke insert, update, delete on public.qr_installations, public.qr_attempts from authenticated;
grant select on public.qr_installations, public.qr_attempts to authenticated;
drop policy if exists qr_inst_read on public.qr_installations;
create policy qr_inst_read on public.qr_installations for select to authenticated
  using ((select app.is_admin()) or (branch_id)::text = (select app.branch()));
drop policy if exists qr_att_read on public.qr_attempts;
create policy qr_att_read on public.qr_attempts for select to authenticated
  using ((select app.is_admin()) or (branch_id)::text = (select app.branch()));

-- A failed attempt, logged the moment it happens (Apps Script, service key).
create or replace function public.qr_log_attempt(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if coalesce(p->>'event_id', '') = '' or coalesce(p->>'session_id', '') = '' or coalesce(p->>'staff_id', '') = '' then
    raise exception 'event_id, session_id and staff_id are required' using errcode = '22023';
  end if;
  insert into public.qr_attempts (event_id, session_id, activity, staff_id, staff_name, branch_text, branch_id,
    expected_mid, got_mid, got_name, scanned_count, client_at)
  values (left(p->>'event_id', 80), left(p->>'session_id', 80), left(p->>'activity', 40), left(p->>'staff_id', 40),
    left(p->>'staff_name', 120), left(p->>'branch', 120), app.resolve_branch(p->>'branch'),
    left(p->>'expected_mid', 20), left(p->>'got_mid', 20), left(p->>'got_name', 160),
    least(greatest(coalesce((p->>'scanned_count')::int, 0), 0), 50),
    case when (p->>'client_at') ~ '^\d{4}-\d{2}-\d{2}T' then (p->>'client_at')::timestamptz end)
  on conflict (event_id) do nothing
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'duplicate', v_id is null);
end $$;

-- A finished entry (Apps Script, service key). The Apps Script has already checked every QR (KHQR format + CRC) and
-- that all MIDs are the same; the database checks the shape again and counts the failed attempts it logged.
create or replace function public.qr_submit(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.qr_installations; v_failed int; v_logged int; v_id bigint; v_at timestamptz; v_att jsonb;
begin
  if coalesce(p->>'request_id', '') = '' or coalesce(p->>'session_id', '') = '' or coalesce(p->>'staff_id', '') = '' then
    raise exception 'request_id, session_id and staff_id are required' using errcode = '22023';
  end if;
  select * into r from public.qr_installations where request_id = p->>'request_id';
  if found then
    return jsonb_build_object('record_id', r.record_id, 'id', r.id, 'status', r.status, 'failed_attempts', r.failed_attempts, 'duplicate', true);
  end if;
  select count(*) into v_logged from public.qr_attempts where session_id = p->>'session_id';
  v_failed := greatest(coalesce((p->>'failed_attempts')::int, 0), v_logged);
  -- the mismatch details: the phone's list, or the server's log when the phone lost some of them
  v_att := case when jsonb_typeof(p->'attempts') = 'array' then p->'attempts' else '[]'::jsonb end;
  if jsonb_array_length(v_att) < v_logged then
    select coalesce(jsonb_agg(jsonb_build_object('at', coalesce(a.client_at, a.received_at), 'expected_mid', a.expected_mid,
             'got_mid', a.got_mid, 'got_name', a.got_name) order by a.received_at), '[]'::jsonb)
      into v_att from public.qr_attempts a where a.session_id = p->>'session_id';
  end if;
  v_at := case when (p->>'captured_at') ~ '^\d{4}-\d{2}-\d{2}T' then (p->>'captured_at')::timestamptz end;
  insert into public.qr_installations (request_id, session_id, activity, staff_id, staff_name, branch_text, branch_id,
    merchant_name, merchant_name_kh, mid, qr_expected, qr_count, qr_scans, failed_attempts, attempts,
    latitude, longitude, gps_accuracy, remark, photo_count, app_version, captured_at)
  values (left(p->>'request_id', 120), left(p->>'session_id', 80), p->>'activity', left(p->>'staff_id', 40),
    left(p->>'staff_name', 120), left(p->>'branch', 120), app.resolve_branch(p->>'branch'),
    left(p->>'merchant_name', 160), nullif(left(p->>'merchant_name_kh', 160), ''), p->>'mid',
    (p->>'qr_expected')::int, (p->>'qr_count')::int, coalesce(p->'qr_scans', '[]'::jsonb), least(v_failed, 999),
    v_att,
    (p->>'latitude')::double precision, (p->>'longitude')::double precision, (p->>'gps_accuracy')::real,
    nullif(left(p->>'remark', 1000), ''), coalesce((p->>'photo_count')::int, 0), left(p->>'app_version', 40), v_at)
  returning id into v_id;
  update public.qr_installations
     set record_id = 'QR-' || to_char(coalesce(v_at, now()) at time zone 'Asia/Phnom_Penh', 'YYYYMMDD') || '-' || lpad(v_id::text, 6, '0')
   where id = v_id
  returning * into r;
  return jsonb_build_object('record_id', r.record_id, 'id', r.id, 'status', r.status, 'failed_attempts', r.failed_attempts, 'duplicate', false);
end $$;

-- The Telegram post link, added after the photos were posted (Apps Script, service key).
create or replace function public.qr_set_post(p jsonb)
returns void language sql security definer set search_path = '' as $$
  update public.qr_installations set telegram_link = left(p->>'link', 300), photo_count = coalesce((p->>'photo_count')::int, photo_count)
   where record_id = p->>'record_id';
$$;

-- Totals of a period for the dashboard (one request). SECURITY INVOKER: the reader's branch rules (RLS) apply.
create or replace function public.qr_summary(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'total', count(*),
    'completed', count(*) filter (where failed_attempts = 0),
    'failed', count(*) filter (where failed_attempts > 0),
    'needs_review', count(*) filter (where failed_attempts > 0 and review_status = 'PENDING'),
    'install', count(*) filter (where activity = 'NEW_INSTALLATION'),
    'replace', count(*) filter (where activity = 'QR_REPLACEMENT'),
    'qr', coalesce(sum(qr_count), 0))
  from public.qr_installations
  where (p_from is null or submitted_at >= p_from) and (p_to is null or submitted_at < p_to);
$$;

-- Admin review of a flagged entry (dashboard).
create or replace function public.qr_review(p_id bigint, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.qr_installations;
begin
  if not app.is_admin() then raise exception 'Only HQ admins can review KHQR entries.' using errcode = '42501'; end if;
  if p_status not in ('PENDING', 'CHECKED', 'ESCALATED') then raise exception 'Unknown review status %.', p_status using errcode = '22023'; end if;
  update public.qr_installations
     set review_status = p_status, review_note = nullif(left(btrim(coalesce(p_note, '')), 500), ''),
         reviewed_by = case when p_status = 'PENDING' then null else auth.uid() end,
         reviewed_by_name = case when p_status = 'PENDING' then null else app.label() end,
         reviewed_at = case when p_status = 'PENDING' then null else now() end
   where id = p_id
  returning * into r;
  if not found then raise exception 'Entry % not found.', p_id; end if;
  insert into public.audit_logs (title, detail, branch_id, action, target)
  values ('KHQR Entry Reviewed', r.record_id || ' (' || r.merchant_name || ', MID ' || r.mid || '): ' || p_status
          || coalesce(' – ' || r.review_note, ''), r.branch_id, 'QR_REVIEW', r.record_id);
  return jsonb_build_object('id', r.id, 'review_status', r.review_status);
end $$;

revoke all on function public.qr_log_attempt(jsonb), public.qr_submit(jsonb), public.qr_set_post(jsonb) from public, anon, authenticated;
grant execute on function public.qr_log_attempt(jsonb), public.qr_submit(jsonb), public.qr_set_post(jsonb) to service_role;
revoke all on function public.qr_review(bigint, text, text) from public, anon;
grant execute on function public.qr_review(bigint, text, text) to authenticated;
revoke all on function public.qr_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.qr_summary(timestamptz, timestamptz) to authenticated;

-- live list in the dashboard (new entries and review changes)
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'qr_installations') then
    execute 'alter publication supabase_realtime add table public.qr_installations';
  end if;
end $$;

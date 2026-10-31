-- 11 (31 Oct 2026) Credit Card entries from the Merchant Visit phone app → Phone App Review → Credit Card.
--
-- The phone app's Apps Script (service key) sends every NEW Credit Card entry here after it is saved in the Google Sheet
-- (cc_submit; an edit within the 8-hour edit time sends it again). Head Office reviews each successful onboarding:
-- Confirm, or Reject with a reason (e.g. adverse CBC record). The result is then replied by the Merchant Visit bot in
-- the staff group, under the entry's own group post: the database asks the Apps Script to do it (pg_net → web app
-- ?cc=<key>), and a timer every 5 minutes asks again for any reply not yet confirmed as sent.
-- A failed onboarding needs no review (shown as "No review needed").
--
-- Personal data: names, phone, marital status, account numbers, credit limit. Admins (Head Office) see full account
-- numbers; branch staff see only their own branch, with account numbers masked (****1234). The table itself cannot be
-- read directly from the dashboard: only through cc_list, which applies those rules.

create table if not exists public.cc_entries (
  id              bigint generated always as identity primary key,
  record_id       text not null unique check (record_id ~ '^CC-\d{8}-\d{3,}$'),
  request_type    text not null,                       -- New Credit Card Request / Add Supplementary Only
  card_status     text,                                -- Onboarded Successfully / Onboarding Failed
  fail_reason     text,
  full_name       text,
  contact         text,
  marital         text,
  primary_acc     text,
  mid_or_acc      text,
  limit_usd       numeric(12, 2),
  repayment       text,
  email           text,
  supplementary   jsonb not null default '[]'::jsonb,  -- [{ full_name, marital, account, email }]
  remarks         text check (char_length(remarks) <= 2000),
  photo_count     smallint not null default 0,
  staff_id        text not null,
  staff_name      text,
  branch_text     text,
  branch_id       varchar references public.branches(id) on update cascade on delete set null,
  submitted_at    timestamptz not null,
  edited_at       timestamptz,
  app_version     text,
  review_status   text not null default 'PENDING' check (review_status in ('PENDING', 'CONFIRMED', 'REJECTED', 'NO_REVIEW')),
  review_reason   text,
  review_note     text check (char_length(review_note) <= 1000),
  reviewed_by     text,                                -- "Name (emp id)"
  reviewed_at     timestamptz,
  review_history  jsonb not null default '[]'::jsonb,  -- every review / resubmission, oldest first
  tg_chat         text,                                -- the staff group and the entry's post there (reply goes under it)
  tg_msg          bigint,
  notify_state    text check (notify_state in ('PENDING', 'SENDING', 'SENT', 'FAILED')),
  notify_tries    smallint not null default 0,
  notify_taken_at timestamptz,
  notified_at     timestamptz,
  notify_error    text,
  received_at     timestamptz not null default now()
);
create index if not exists cc_entries_time_idx    on public.cc_entries (submitted_at desc, id desc);
create index if not exists cc_entries_review_idx  on public.cc_entries (review_status, submitted_at desc);
create index if not exists cc_entries_branch_idx  on public.cc_entries (branch_id, submitted_at desc);
create index if not exists cc_entries_notify_idx  on public.cc_entries (notify_state) where notify_state in ('PENDING', 'SENDING');

alter table public.cc_entries enable row level security;
revoke all on public.cc_entries from anon, authenticated;   -- read only through cc_list (masking); written only by functions

-- Settings the Apps Script registers itself (its web app address for the reply request). Never readable from the dashboard.
create table if not exists public.cc_settings (key text primary key, value text not null, updated_at timestamptz not null default now());
alter table public.cc_settings enable row level security;
revoke all on public.cc_settings from anon, authenticated;

create or replace function app.mask_acc(t text) returns text language sql immutable set search_path = '' as $$
  select case when t is null or t = '' then t when length(t) <= 4 then '****' else '****' || right(t, 4) end
$$;

-- Asks the Apps Script (once, without waiting) to post the review replies that are due.
create or replace function app.cc_ping() returns void language plpgsql security definer set search_path = '' as $$
declare v_url text;
begin
  select value into v_url from public.cc_settings where key = 'notify_url';
  if v_url is null then return; end if;
  perform net.http_post(url := v_url, body := '{}'::jsonb, headers := '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds := 20000);
exception when others then
  null;                                                    -- the 5-minute timer asks again
end $$;

-- ───────────── Apps Script (service key) ─────────────
create or replace function public.cc_submit(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.cc_entries; v_ok boolean; v_review text; v_at timestamptz; v_url text; v_resub boolean := false;
begin
  if coalesce(p->>'record_id', '') !~ '^CC-\d{8}-\d{3,}$' or coalesce(p->>'staff_id', '') = '' then
    raise exception 'record_id (CC-YYYYMMDD-NNNN) and staff_id are required' using errcode = '22023';
  end if;
  v_url := p->>'notify_url';
  if v_url ~ '^https://script\.google\.com/(a/macros/[A-Za-z0-9.-]+|macros)/s/[A-Za-z0-9_-]+/exec\?cc=[A-Za-z0-9]{24,64}$' then
    insert into public.cc_settings (key, value) values ('notify_url', v_url)
    on conflict (key) do update set value = excluded.value, updated_at = now() where public.cc_settings.value <> excluded.value;
  end if;
  v_ok := p->>'request_type' = 'Add Supplementary Only' or p->>'card_status' = 'Onboarded Successfully';
  v_review := case when v_ok then 'PENDING' else 'NO_REVIEW' end;
  v_at := case when (p->>'submitted_at') ~ '^\d{4}-\d{2}-\d{2}T' then (p->>'submitted_at')::timestamptz else now() end;
  select * into r from public.cc_entries where record_id = p->>'record_id' for update;
  if not found then
    insert into public.cc_entries (record_id, request_type, card_status, fail_reason, full_name, contact, marital, primary_acc, mid_or_acc,
      limit_usd, repayment, email, supplementary, remarks, photo_count, staff_id, staff_name, branch_text, branch_id, submitted_at,
      app_version, review_status, tg_chat, tg_msg)
    values (p->>'record_id', left(coalesce(p->>'request_type', ''), 60), nullif(left(p->>'card_status', 60), ''), nullif(left(p->>'fail_reason', 120), ''),
      nullif(left(p->>'full_name', 160), ''), nullif(left(p->>'contact', 40), ''), nullif(left(p->>'marital', 30), ''),
      nullif(left(p->>'primary_acc', 30), ''), nullif(left(p->>'mid_or_acc', 30), ''),
      case when (p->>'limit_usd') ~ '^\d+(\.\d+)?$' then (p->>'limit_usd')::numeric end, nullif(left(p->>'repayment', 60), ''),
      nullif(left(p->>'email', 160), ''), case when jsonb_typeof(p->'supplementary') = 'array' then p->'supplementary' else '[]'::jsonb end,
      nullif(left(p->>'remarks', 2000), ''), least(greatest(coalesce((p->>'photo_count')::int, 0), 0), 20),
      left(p->>'staff_id', 40), left(p->>'staff_name', 120), left(p->>'branch', 120), app.resolve_branch(p->>'branch'), v_at,
      left(p->>'app_version', 40), v_review, nullif(left(p->>'tg_chat', 40), ''),
      case when (p->>'tg_msg') ~ '^\d+$' then (p->>'tg_msg')::bigint end)
    returning * into r;
    return jsonb_build_object('ok', true, 'record_id', r.record_id, 'review_status', r.review_status, 'new', true);
  end if;
  -- the same entry again: an edit within the edit time (or a retry). A reviewed entry that is changed is reviewed again.
  if p->>'edited' = 'true' and r.review_status in ('CONFIRMED', 'REJECTED') and v_ok then v_resub := true; end if;
  update public.cc_entries set
    request_type = left(coalesce(p->>'request_type', request_type), 60), card_status = nullif(left(p->>'card_status', 60), ''),
    fail_reason = nullif(left(p->>'fail_reason', 120), ''), full_name = nullif(left(p->>'full_name', 160), ''),
    contact = nullif(left(p->>'contact', 40), ''), marital = nullif(left(p->>'marital', 30), ''),
    primary_acc = nullif(left(p->>'primary_acc', 30), ''), mid_or_acc = nullif(left(p->>'mid_or_acc', 30), ''),
    limit_usd = case when (p->>'limit_usd') ~ '^\d+(\.\d+)?$' then (p->>'limit_usd')::numeric end, repayment = nullif(left(p->>'repayment', 60), ''),
    email = nullif(left(p->>'email', 160), ''), supplementary = case when jsonb_typeof(p->'supplementary') = 'array' then p->'supplementary' else '[]'::jsonb end,
    remarks = nullif(left(p->>'remarks', 2000), ''),
    edited_at = case when p->>'edited' = 'true' then now() else edited_at end,
    tg_chat = coalesce(nullif(left(p->>'tg_chat', 40), ''), tg_chat),
    tg_msg = coalesce(case when (p->>'tg_msg') ~ '^\d+$' then (p->>'tg_msg')::bigint end, tg_msg),
    review_status = case when v_resub then 'PENDING' when review_status in ('PENDING', 'NO_REVIEW') then v_review else review_status end,
    review_history = case when v_resub then review_history || jsonb_build_object('at', now(), 'action', 'RESUBMITTED', 'by', staff_name,
                       'was', review_status, 'reason', review_reason) else review_history end,
    review_reason = case when v_resub then null else review_reason end,
    review_note = case when v_resub then null else review_note end
  where id = r.id returning * into r;
  return jsonb_build_object('ok', true, 'record_id', r.record_id, 'review_status', r.review_status, 'new', false, 'resubmitted', v_resub);
end $$;

-- The replies due (Apps Script): marked as being sent, so two runs never post the same reply twice.
create or replace function public.cc_outbox_take(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  with due as (
    select id from public.cc_entries
     where notify_state = 'PENDING' or (notify_state = 'SENDING' and notify_taken_at < now() - interval '5 minutes')
     order by reviewed_at limit 20 for update skip locked),
  taken as (
    update public.cc_entries e set notify_state = 'SENDING', notify_taken_at = now()
      from due where e.id = due.id
    returning e.*)
  select coalesce(jsonb_agg(jsonb_build_object('record_id', record_id, 'action', review_status, 'reason', review_reason, 'note', review_note,
           'by', reviewed_by, 'at', reviewed_at, 'staff_id', staff_id, 'staff_name', staff_name, 'name', full_name,
           'request_type', request_type, 'chat', tg_chat, 'msg', tg_msg) order by reviewed_at), '[]'::jsonb)
    into v from taken;
  return v;
end $$;

-- After a reply (Apps Script): { record_id, ok, error }. A failure is tried again (up to 5 times).
create or replace function public.cc_outbox_done(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update public.cc_entries set
    notify_state = case when (p->>'ok')::boolean then 'SENT' when notify_tries + 1 >= 5 then 'FAILED' else 'PENDING' end,
    notify_tries = notify_tries + 1,
    notified_at = case when (p->>'ok')::boolean then now() else notified_at end,
    notify_error = case when (p->>'ok')::boolean then null else left(p->>'error', 300) end
  where record_id = p->>'record_id' and notify_state = 'SENDING';
  return jsonb_build_object('ok', true);
end $$;

-- ───────────── Dashboard (signed-in staff) ─────────────
create or replace function public.cc_list(p_from timestamptz default null, p_to timestamptz default null, p_review text default null,
  p_branch text default null, p_search text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_admin boolean := app.is_admin(); v_branch text := app.branch(); v_total int; v_rows jsonb; v_q text;
begin
  if not v_admin and v_branch is null then raise exception 'Not signed in.' using errcode = '42501'; end if;
  v_q := nullif(trim(coalesce(p_search, '')), '');
  with f as (
    select * from public.cc_entries e
     where (v_admin or e.branch_id::text = v_branch)
       and (p_from is null or e.submitted_at >= p_from) and (p_to is null or e.submitted_at < p_to)
       and (p_review is null or p_review = '' or e.review_status = p_review)
       and (p_branch is null or p_branch = '' or e.branch_id::text = p_branch)
       and (v_q is null or e.record_id ilike '%' || v_q || '%' or e.full_name ilike '%' || v_q || '%' or e.staff_name ilike '%' || v_q || '%'
            or e.staff_id = v_q or e.contact like '%' || v_q || '%' or (v_admin and e.primary_acc like '%' || v_q || '%')))
  select (select count(*) from f),
         coalesce((select jsonb_agg(x order by x->>'submitted_at' desc, (x->>'id')::bigint desc) from (
           select jsonb_build_object('id', id, 'record_id', record_id, 'request_type', request_type, 'card_status', card_status,
             'fail_reason', fail_reason, 'full_name', full_name, 'contact', contact, 'marital', marital,
             'primary_acc', case when v_admin then primary_acc else app.mask_acc(primary_acc) end,
             'mid_or_acc', case when v_admin or mid_or_acc ~ '^\d{15}$' then mid_or_acc else app.mask_acc(mid_or_acc) end,
             'limit_usd', limit_usd, 'repayment', repayment, 'email', email,
             'supplementary', case when v_admin then supplementary else coalesce((select jsonb_agg(s || jsonb_build_object('account', app.mask_acc(s->>'account')))
                                 from jsonb_array_elements(supplementary) s), '[]'::jsonb) end,
             'remarks', remarks, 'photo_count', photo_count, 'staff_id', staff_id, 'staff_name', staff_name, 'branch_text', branch_text,
             'branch_id', branch_id, 'submitted_at', submitted_at, 'edited_at', edited_at, 'review_status', review_status,
             'review_reason', review_reason, 'review_note', review_note, 'reviewed_by', reviewed_by, 'reviewed_at', reviewed_at,
             'review_history', review_history, 'notify_state', notify_state, 'notified_at', notified_at,
             'telegram_link', case when tg_chat ~ '^-100\d+$' and tg_msg is not null then 'https://t.me/c/' || substr(tg_chat, 5) || '/' || tg_msg end) x
             from f order by submitted_at desc, id desc limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) t), '[]'::jsonb)
    into v_total, v_rows;
  return jsonb_build_object('total', v_total, 'rows', v_rows, 'masked', not v_admin);
end $$;

create or replace function public.cc_counts(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('total', count(*), 'pending', count(*) filter (where review_status = 'PENDING'),
    'confirmed', count(*) filter (where review_status = 'CONFIRMED'), 'rejected', count(*) filter (where review_status = 'REJECTED'),
    'no_review', count(*) filter (where review_status = 'NO_REVIEW'),
    'cards', coalesce(sum(case when request_type = 'Add Supplementary Only' then 0 when card_status = 'Onboarded Successfully' then 1 else 0 end
                          + jsonb_array_length(supplementary)), 0),
    'pending_all', (select count(*) from public.cc_entries x where x.review_status = 'PENDING'
                      and (app.is_admin() or x.branch_id::text = app.branch())))
    from public.cc_entries e
   where (app.is_admin() or e.branch_id::text = app.branch())
     and (p_from is null or e.submitted_at >= p_from) and (p_to is null or e.submitted_at < p_to)
$$;

-- Confirm or Reject (Admin HQ only). Only an entry waiting for review; the reply goes to the staff group.
create or replace function public.cc_review(p_record_id text, p_action text, p_reason text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.cc_entries; v_by text := app.label(); v_status text;
begin
  if not app.is_admin() then raise exception 'Only Admin HQ can review credit card entries.' using errcode = '42501'; end if;
  v_status := case upper(coalesce(p_action, '')) when 'CONFIRM' then 'CONFIRMED' when 'REJECT' then 'REJECTED' end;
  if v_status is null then raise exception 'Action must be CONFIRM or REJECT.' using errcode = '22023'; end if;
  if v_status = 'REJECTED' and coalesce(trim(p_reason), '') = '' then raise exception 'Please choose or write the reason for rejecting.' using errcode = '22023'; end if;
  select * into r from public.cc_entries where record_id = p_record_id for update;
  if not found then raise exception 'Entry % not found.', p_record_id using errcode = 'P0002'; end if;
  if r.review_status <> 'PENDING' then
    raise exception 'Entry % was already %.', p_record_id, lower(case r.review_status when 'NO_REVIEW' then 'not for review' else r.review_status end)
      || coalesce(' by ' || r.reviewed_by, '') using errcode = 'PT409';
  end if;
  update public.cc_entries set review_status = v_status,
    review_reason = case when v_status = 'REJECTED' then left(trim(p_reason), 200) end,
    review_note = nullif(left(trim(coalesce(p_note, '')), 1000), ''),
    reviewed_by = v_by, reviewed_at = now(),
    review_history = review_history || jsonb_build_object('at', now(), 'action', v_status, 'by', v_by, 'reason', nullif(trim(coalesce(p_reason, '')), ''),
                       'note', nullif(trim(coalesce(p_note, '')), '')),
    notify_state = 'PENDING', notify_tries = 0, notify_error = null
  where id = r.id returning * into r;
  insert into public.audit_logs (title, detail, action, target, branch_id)
  values (case v_status when 'CONFIRMED' then 'Credit Card Confirmed' else 'Credit Card Rejected' end,
          r.record_id || ' · ' || coalesce(r.full_name, '') || coalesce(' · ' || r.review_reason, ''), 'CC_' || v_status, r.record_id, r.branch_id);
  perform app.cc_ping();
  return jsonb_build_object('ok', true, 'record_id', r.record_id, 'review_status', r.review_status, 'reviewed_by', r.reviewed_by, 'reviewed_at', r.reviewed_at);
end $$;

revoke all on function public.cc_submit(jsonb), public.cc_outbox_take(jsonb), public.cc_outbox_done(jsonb) from public, anon, authenticated;
grant execute on function public.cc_submit(jsonb), public.cc_outbox_take(jsonb), public.cc_outbox_done(jsonb) to service_role;
revoke all on function public.cc_list(timestamptz, timestamptz, text, text, text, integer, integer), public.cc_counts(timestamptz, timestamptz),
  public.cc_review(text, text, text, text) from public, anon;
grant execute on function public.cc_list(timestamptz, timestamptz, text, text, text, integer, integer), public.cc_counts(timestamptz, timestamptz),
  public.cc_review(text, text, text, text) to authenticated, service_role;
revoke all on function app.cc_ping(), app.mask_acc(text) from public, anon, authenticated;

-- A reply that could not be posted at once (Apps Script busy, network): asked again every 5 minutes.
select cron.unschedule('cc-review-replies') where exists (select 1 from cron.job where jobname = 'cc-review-replies');
select cron.schedule('cc-review-replies', '*/5 * * * *',
  $c$select app.cc_ping() where exists (select 1 from public.cc_entries where notify_state = 'PENDING' or (notify_state = 'SENDING' and notify_taken_at < now() - interval '5 minutes'))$c$);

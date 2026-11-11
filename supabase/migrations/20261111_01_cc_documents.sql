-- 11 Nov 2026 · Phone App Review → Credit Card: "Well Received" and "Follow Up" (documents to Head Office).
-- Not yet applied: run in the Supabase SQL Editor (safe to run again). Needs Merchant Visit 3.99 for the group replies.
--
-- A successful onboarding (review PENDING) can be marked by Admin HQ:
--   WELL_RECEIVED - the entry is acknowledged; Head Office now waits for the staff member to bring the documents
--                   (doc_status = WAITING). The bot replies under the staff member's post: "Well received by Head Office ...".
--   FOLLOW_UP     - while WAITING: a reminder under the same post ("documents not received yet"), counted (doc_followups);
--                   at most one every 10 minutes per entry.
-- Confirm (cc_review) stays the final decision: confirming an entry that was WAITING marks its documents RECEIVED.
-- Additive only: four new columns (+ notify_kind) on cc_entries; no existing value changes. The review list gets a
-- "Waiting for documents" filter (p_review = 'WAITING_DOCS') and the counts a waiting_docs figure.
-- The phone app takes these replies only when it asks for them ({"docs": true}, Merchant Visit 3.99): an older app
-- never posts them (they wait), so it can never post a document reminder as a decision.

alter table public.cc_entries add column if not exists doc_status text;
alter table public.cc_entries add column if not exists doc_since timestamptz;
alter table public.cc_entries add column if not exists doc_followups smallint not null default 0;
alter table public.cc_entries add column if not exists doc_last_followup timestamptz;
alter table public.cc_entries add column if not exists notify_kind text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cc_entries_doc_status_check') then
    alter table public.cc_entries add constraint cc_entries_doc_status_check check (doc_status is null or doc_status in ('WAITING', 'RECEIVED'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cc_entries_notify_kind_check') then
    alter table public.cc_entries add constraint cc_entries_notify_kind_check check (notify_kind is null or notify_kind in ('WELL_RECEIVED', 'FOLLOW_UP'));
  end if;
end $$;
create index if not exists cc_entries_doc_waiting_idx on public.cc_entries (submitted_at desc) where doc_status = 'WAITING';

-- Well Received / Follow Up (Admin HQ only)
create or replace function public.cc_docs(p_record_id text, p_action text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare r public.cc_entries; v_by text := app.label(); v_act text := upper(btrim(coalesce(p_action, ''))); v_note text := nullif(left(btrim(coalesce(p_note, '')), 1000), '');
begin
  if not app.is_admin() then raise exception 'Only Admin HQ can mark credit card documents.' using errcode = '42501'; end if;
  if v_act not in ('WELL_RECEIVED', 'FOLLOW_UP') then raise exception 'Action must be WELL_RECEIVED or FOLLOW_UP.' using errcode = '22023'; end if;
  select * into r from public.cc_entries where record_id = p_record_id for update;
  if not found then raise exception 'Entry % not found.', p_record_id using errcode = 'P0002'; end if;
  if r.review_status <> 'PENDING' then
    raise exception 'Entry % is % - only an entry waiting for review can be marked.', p_record_id, lower(replace(r.review_status, '_', ' ')) using errcode = 'PT409';
  end if;
  if v_act = 'WELL_RECEIVED' and r.doc_status is not null then
    raise exception 'Entry % is already well received.', p_record_id using errcode = 'PT409';
  end if;
  if v_act = 'FOLLOW_UP' then
    if r.doc_status is distinct from 'WAITING' then raise exception 'Mark entry % as Well Received first.', p_record_id using errcode = 'PT409'; end if;
    if r.doc_last_followup > now() - interval '10 minutes' then
      raise exception 'A follow-up for % was sent less than 10 minutes ago.', p_record_id using errcode = 'PT409';
    end if;
  end if;
  update public.cc_entries set
    doc_status = 'WAITING',
    doc_since = case when v_act = 'WELL_RECEIVED' then now() else doc_since end,
    doc_followups = doc_followups + case when v_act = 'FOLLOW_UP' then 1 else 0 end,
    doc_last_followup = case when v_act = 'FOLLOW_UP' then now() else doc_last_followup end,
    review_history = review_history || jsonb_build_object('at', now(), 'action', v_act, 'by', v_by, 'note', v_note),
    notify_kind = v_act, notify_state = 'PENDING', notify_tries = 0, notify_error = null
  where id = r.id returning * into r;
  insert into public.audit_logs (title, detail, action, target, branch_id)
  values (case when v_act = 'WELL_RECEIVED' then 'Credit Card Well Received' else 'Credit Card Documents Follow Up' end,
          r.record_id || case when v_act = 'FOLLOW_UP' then ' · follow-up ' || r.doc_followups else ' · waiting for documents' end || coalesce(' · ' || v_note, ''),
          'CC_' || v_act, r.record_id, r.branch_id);
  perform app.cc_ping();
  return jsonb_build_object('ok', true, 'record_id', r.record_id, 'doc_status', r.doc_status, 'doc_since', r.doc_since,
                            'doc_followups', r.doc_followups, 'doc_last_followup', r.doc_last_followup, 'by', v_by, 'at', now());
end $$;
revoke all on function public.cc_docs(text, text, text) from public, anon;
grant execute on function public.cc_docs(text, text, text) to authenticated, service_role;

-- cc_review: as before; a decision is a review notice (notify_kind cleared); confirming a WAITING entry = documents received
create or replace function public.cc_review(p_record_id text, p_action text, p_reason text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare r public.cc_entries; v_by text := app.label(); v_status text; v_prev text;
begin
  if not app.is_admin() then raise exception 'Only Admin HQ can review credit card entries.' using errcode = '42501'; end if;
  v_status := case upper(coalesce(p_action, '')) when 'CONFIRM' then 'CONFIRMED' when 'REJECT' then 'REJECTED' end;
  if v_status is null then raise exception 'Action must be CONFIRM or REJECT.' using errcode = '22023'; end if;
  if v_status = 'REJECTED' and coalesce(trim(p_reason), '') = '' then raise exception 'Please choose or write the reason for rejecting.' using errcode = '22023'; end if;
  select * into r from public.cc_entries where record_id = p_record_id for update;
  if not found then raise exception 'Entry % not found.', p_record_id using errcode = 'P0002'; end if;
  if r.review_status = 'NO_REVIEW' then raise exception 'Entry % is a failed onboarding: no review.', p_record_id using errcode = 'PT409'; end if;
  if r.review_status = v_status and (v_status = 'CONFIRMED' or coalesce(r.review_reason, '') = left(trim(p_reason), 200))
     and coalesce(r.review_note, '') = coalesce(nullif(left(trim(coalesce(p_note, '')), 1000), ''), '') then
    raise exception 'Entry % is already %.', p_record_id, lower(v_status) using errcode = 'PT409';
  end if;
  v_prev := case when r.review_status in ('CONFIRMED', 'REJECTED') then r.review_status end;
  update public.cc_entries set review_status = v_status, review_prev = v_prev,
    review_reason = case when v_status = 'REJECTED' then left(trim(p_reason), 200) end,
    review_note = nullif(left(trim(coalesce(p_note, '')), 1000), ''),
    reviewed_by = v_by, reviewed_at = now(),
    review_history = review_history || jsonb_build_object('at', now(), 'action', v_status, 'by', v_by, 'was', v_prev,
                       'reason', nullif(trim(coalesce(p_reason, '')), ''), 'note', nullif(trim(coalesce(p_note, '')), '')),
    doc_status = case when v_status = 'CONFIRMED' and doc_status = 'WAITING' then 'RECEIVED' else doc_status end,
    notify_kind = null, notify_state = 'PENDING', notify_tries = 0, notify_error = null
  where id = r.id returning * into r;
  insert into public.audit_logs (title, detail, action, target, branch_id)
  values (case when v_prev is not null then 'Credit Card Decision Changed' when v_status = 'CONFIRMED' then 'Credit Card Confirmed' else 'Credit Card Rejected' end,
          r.record_id || ' · ' || lower(v_status) || coalesce(' (was ' || lower(v_prev) || ')', '') || coalesce(' · ' || r.review_reason, ''),
          'CC_' || v_status, r.record_id, r.branch_id);
  perform app.cc_ping();
  return jsonb_build_object('ok', true, 'record_id', r.record_id, 'review_status', r.review_status, 'was', v_prev, 'reviewed_by', r.reviewed_by, 'reviewed_at', r.reviewed_at,
                            'doc_status', r.doc_status);
end $$;
revoke all on function public.cc_review(text, text, text, text) from public, anon;
grant execute on function public.cc_review(text, text, text, text) to authenticated, service_role;

-- the phone app takes the due replies; document notices only when it asks for them (3.99+)
create or replace function public.cc_outbox_take(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v jsonb; v_docs boolean := coalesce(p->>'docs', '') = 'true';
begin
  with due as (
    select id from public.cc_entries
     where (notify_state = 'PENDING' or (notify_state = 'SENDING' and notify_taken_at < now() - interval '5 minutes'))
       and (v_docs or notify_kind is null)
     order by coalesce(doc_last_followup, doc_since, reviewed_at) limit 20 for update skip locked),
  taken as (
    update public.cc_entries e set notify_state = 'SENDING', notify_taken_at = now() from due where e.id = due.id returning e.*)
  select coalesce(jsonb_agg(jsonb_build_object('record_id', record_id, 'kind', coalesce(notify_kind, 'REVIEW'), 'action', review_status, 'was', review_prev,
           'reason', review_reason, 'note', case when notify_kind is null then review_note else (review_history->-1)->>'note' end,
           'by', case when notify_kind is null then reviewed_by else (review_history->-1)->>'by' end,
           'at', case when notify_kind is null then reviewed_at else ((review_history->-1)->>'at')::timestamptz end,
           'staff_id', staff_id, 'staff_name', staff_name, 'name', full_name, 'request_type', request_type, 'chat', tg_chat, 'msg', tg_msg,
           'followups', doc_followups, 'doc_since', doc_since)), '[]'::jsonb)
    into v from taken;
  return v;
end $$;
revoke all on function public.cc_outbox_take(jsonb) from public, anon, authenticated;
grant execute on function public.cc_outbox_take(jsonb) to service_role;

-- the review list: the document fields, and the "Waiting for documents" filter
create or replace function public.cc_list(p_from timestamptz default null, p_to timestamptz default null, p_review text default null, p_branch text default null,
                                          p_search text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_admin boolean := app.is_admin(); v_branch text := app.branch(); v_total int; v_rows jsonb; v_q text;
begin
  if not v_admin and v_branch is null then raise exception 'Not signed in.' using errcode = '42501'; end if;
  v_q := nullif(trim(coalesce(p_search, '')), '');
  with f as (
    select * from public.cc_entries e
     where (v_admin or e.branch_id::text = v_branch)
       and (p_from is null or e.submitted_at >= p_from) and (p_to is null or e.submitted_at < p_to)
       and (p_review is null or p_review = '' or (p_review = 'WAITING_DOCS' and e.review_status = 'PENDING' and e.doc_status = 'WAITING') or e.review_status = p_review)
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
             'doc_status', doc_status, 'doc_since', doc_since, 'doc_followups', doc_followups, 'doc_last_followup', doc_last_followup,
             'telegram_link', case when tg_chat ~ '^-100\d+$' and tg_msg is not null then 'https://t.me/c/' || substr(tg_chat, 5) || '/' || tg_msg end) x
             from f order by submitted_at desc, id desc limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) t), '[]'::jsonb)
    into v_total, v_rows;
  return jsonb_build_object('total', v_total, 'rows', v_rows, 'masked', not v_admin);
end $$;

create or replace function public.cc_counts(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total', count(*),
    'pending', count(*) filter (where review_status = 'PENDING'),
    'waiting_docs', count(*) filter (where review_status = 'PENDING' and doc_status = 'WAITING'),
    'confirmed', count(*) filter (where review_status = 'CONFIRMED'),
    'rejected', count(*) filter (where review_status = 'REJECTED'),
    'no_review', count(*) filter (where review_status = 'NO_REVIEW'),
    'cards', coalesce(sum(
      case when review_status <> 'CONFIRMED' then 0
           else (case when request_type = 'Add Supplementary Only' then 0 else 1 end) +
                coalesce(case when jsonb_typeof(supplementary) = 'array' then jsonb_array_length(supplementary) else 0 end, 0)
      end
    ), 0),
    'primary_cards', coalesce(sum(
      case when review_status = 'CONFIRMED' and request_type <> 'Add Supplementary Only' then 1 else 0 end
    ), 0),
    'supp_cards', coalesce(sum(
      case when review_status = 'CONFIRMED' then
        coalesce(case when jsonb_typeof(supplementary) = 'array' then jsonb_array_length(supplementary) else 0 end, 0)
      else 0 end
    ), 0),
    'pending_all', (select count(*) from public.cc_entries x where x.review_status = 'PENDING' and (app.is_admin() or x.branch_id::text = app.branch()))
  )
  from public.cc_entries e
  where (app.is_admin() or e.branch_id::text = app.branch())
    and (p_from is null or e.submitted_at >= p_from) and (p_to is null or e.submitted_at < p_to);
$$;

-- 12 (31 Oct 2026) Credit Card review, after first use:
--  · "Cards onboarded" counts only entries CONFIRMED by Head Office (primary card + supplementary cards).
--  · Admin HQ can change a decision (Confirmed ↔ Rejected, or a rejection's reason). The bot posts the change under the
--    entry's group post ("Decision changed … (was …)"). Every decision stays in review_history.
alter table public.cc_entries add column if not exists review_prev text;   -- the decision before the latest one (for the reply)

create or replace function public.cc_counts(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('total', count(*), 'pending', count(*) filter (where review_status = 'PENDING'),
    'confirmed', count(*) filter (where review_status = 'CONFIRMED'), 'rejected', count(*) filter (where review_status = 'REJECTED'),
    'no_review', count(*) filter (where review_status = 'NO_REVIEW'),
    'cards', coalesce(sum(case when review_status <> 'CONFIRMED' then 0
                               else (case when request_type = 'Add Supplementary Only' then 0 else 1 end) + jsonb_array_length(supplementary) end), 0),
    'pending_all', (select count(*) from public.cc_entries x where x.review_status = 'PENDING' and (app.is_admin() or x.branch_id::text = app.branch())))
    from public.cc_entries e
   where (app.is_admin() or e.branch_id::text = app.branch())
     and (p_from is null or e.submitted_at >= p_from) and (p_to is null or e.submitted_at < p_to) $$;

create or replace function public.cc_review(p_record_id text, p_action text, p_reason text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
    notify_state = 'PENDING', notify_tries = 0, notify_error = null
  where id = r.id returning * into r;
  insert into public.audit_logs (title, detail, action, target, branch_id)
  values (case when v_prev is not null then 'Credit Card Decision Changed' when v_status = 'CONFIRMED' then 'Credit Card Confirmed' else 'Credit Card Rejected' end,
          r.record_id || ' · ' || lower(v_status) || coalesce(' (was ' || lower(v_prev) || ')', '') || coalesce(' · ' || r.review_reason, ''),
          'CC_' || v_status, r.record_id, r.branch_id);
  perform app.cc_ping();
  return jsonb_build_object('ok', true, 'record_id', r.record_id, 'review_status', r.review_status, 'was', v_prev, 'reviewed_by', r.reviewed_by, 'reviewed_at', r.reviewed_at);
end $$;

-- the reply also says what the decision was before
create or replace function public.cc_outbox_take(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  with due as (
    select id from public.cc_entries
     where notify_state = 'PENDING' or (notify_state = 'SENDING' and notify_taken_at < now() - interval '5 minutes')
     order by reviewed_at limit 20 for update skip locked),
  taken as (
    update public.cc_entries e set notify_state = 'SENDING', notify_taken_at = now() from due where e.id = due.id returning e.*)
  select coalesce(jsonb_agg(jsonb_build_object('record_id', record_id, 'action', review_status, 'was', review_prev, 'reason', review_reason, 'note', review_note,
           'by', reviewed_by, 'at', reviewed_at, 'staff_id', staff_id, 'staff_name', staff_name, 'name', full_name,
           'request_type', request_type, 'chat', tg_chat, 'msg', tg_msg) order by reviewed_at), '[]'::jsonb)
    into v from taken;
  return v;
end $$;

-- a correction by staff clears the "was" (the next decision is a fresh review)
create or replace function app.cc_clear_prev() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.review_status = 'PENDING' and old.review_status <> 'PENDING' then new.review_prev := null; end if;
  return new;
end $$;
drop trigger if exists cc_clear_prev on public.cc_entries;
create trigger cc_clear_prev before update on public.cc_entries for each row execute function app.cc_clear_prev();

revoke all on function public.cc_outbox_take(jsonb) from public, anon, authenticated;
grant execute on function public.cc_outbox_take(jsonb) to service_role;
revoke all on function public.cc_counts(timestamptz, timestamptz), public.cc_review(text, text, text, text) from public, anon;
grant execute on function public.cc_counts(timestamptz, timestamptz), public.cc_review(text, text, text, text) to authenticated, service_role;
revoke all on function app.cc_clear_prev() from public, anon, authenticated;

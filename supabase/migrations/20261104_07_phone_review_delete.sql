-- 04 Nov 2026 · Phone App Review: permanent delete (Super Admin only).
--
-- admin_delete_phone_records(p) {source, ids, reason}
--   source  FIELD (POS Terminal / Sound Box records, field_events), KHQR (qr_installations), CC (cc_entries),
--           VISIT (mv_visits)
--   ids     the rows' id (as the review pages show them), at most 500 per call
--   -> {deleted, refused: [{id, record, why}], not_found}
-- Rules: only an active Super Admin. POS / Sound Box records already APPROVED are refused (they changed the stock;
-- deleting the record would not undo that). Every call is written to the Audit Trail.
--
-- A deleted record never comes back: its Record ID goes on public.deleted_phone_records, and a check on each table
-- quietly ignores any later re-send of that ID (the Merchant Visit app re-sends what the portal does not have: daily
-- check, "check & resend", an edit). field_known_records reports those IDs as known, so the app stops trying.
-- For POS / Sound Box the Record ID is listed once none of its rows are left (deleting one device of a multi-device
-- entry, or one revision, leaves the rest in place).
-- The Google Sheet of the Merchant Visit app is not touched: the entry stays there.

create table if not exists public.deleted_phone_records (
  record_id   text primary key,
  request_id  text,
  source      text not null check (source in ('FIELD', 'KHQR', 'CC', 'VISIT')),
  deleted_by  text,
  deleted_at  timestamptz not null default now(),
  reason      text
);
create index if not exists deleted_phone_records_request_idx on public.deleted_phone_records (request_id) where request_id is not null;
alter table public.deleted_phone_records enable row level security;
drop policy if exists deleted_phone_records_read on public.deleted_phone_records;
create policy deleted_phone_records_read on public.deleted_phone_records for select to authenticated using ((select app.is_admin()));
revoke all on public.deleted_phone_records from anon;
revoke insert, update, delete, truncate on public.deleted_phone_records from authenticated;
grant select on public.deleted_phone_records to authenticated;

-- a re-send of a deleted record: the row is silently not added (the sending function carries on without an error)
create or replace function app.block_deleted_phone_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'field_events' then
    if exists (select 1 from public.deleted_phone_records d where d.record_id = new.source_record_id) then return null; end if;
  elsif tg_table_name = 'qr_installations' then
    if exists (select 1 from public.deleted_phone_records d
                where (new.request_id is not null and d.request_id = new.request_id)
                   or (new.record_id is not null and d.record_id = new.record_id)) then return null; end if;
  else
    if exists (select 1 from public.deleted_phone_records d where d.record_id = new.record_id) then return null; end if;
  end if;
  return new;
end $$;
revoke all on function app.block_deleted_phone_record() from public, anon, authenticated;

drop trigger if exists block_deleted_record on public.field_events;
create trigger block_deleted_record before insert on public.field_events for each row execute function app.block_deleted_phone_record();
drop trigger if exists block_deleted_record on public.qr_installations;
create trigger block_deleted_record before insert on public.qr_installations for each row execute function app.block_deleted_phone_record();
drop trigger if exists block_deleted_record on public.cc_entries;
create trigger block_deleted_record before insert on public.cc_entries for each row execute function app.block_deleted_phone_record();
drop trigger if exists block_deleted_record on public.mv_visits;
create trigger block_deleted_record before insert on public.mv_visits for each row execute function app.block_deleted_phone_record();

create or replace function public.admin_delete_phone_records(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_src    text := upper(btrim(coalesce(p->>'source', '')));
  v_reason text := nullif(left(btrim(coalesce(p->>'reason', '')), 300), '');
  v_by     text := app.label();
  v_ids    bigint[];
  v_del    int := 0;
  v_recs   text[];
  v_ref    jsonb := '[]'::jsonb;
  v_label  text;
begin
  if coalesce(app.role(), '') <> 'SUPER_ADMIN' then
    raise exception 'Only a Super Admin can delete phone app records.' using errcode = '42501';
  end if;
  if v_src not in ('FIELD', 'KHQR', 'CC', 'VISIT') then
    raise exception 'INPUT: unknown record type.' using errcode = '22023';
  end if;
  select array_agg(distinct x::bigint) into v_ids
    from jsonb_array_elements_text(case when jsonb_typeof(p->'ids') = 'array' then p->'ids' else '[]'::jsonb end) x
   where x ~ '^\d{1,18}$';
  if v_ids is null then raise exception 'INPUT: choose at least one record.' using errcode = '22023'; end if;
  if cardinality(v_ids) > 500 then raise exception 'INPUT: at most 500 records at a time.' using errcode = '22023'; end if;

  if v_src = 'FIELD' then
    v_label := 'POS Terminal / Sound Box';
    select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'record', e.source_record_id,
             'why', 'Approved: it already changed the stock, so it cannot be deleted.')), '[]'::jsonb)
      into v_ref from public.field_events e where e.id = any(v_ids) and e.status = 'APPROVED';
    with d as (delete from public.field_events e where e.id = any(v_ids) and e.status <> 'APPROVED' returning e.source_record_id)
    select count(*), array_agg(distinct d.source_record_id) into v_del, v_recs from d;
    -- the whole entry is gone (no device / revision left): never accepted again
    insert into public.deleted_phone_records (record_id, source, deleted_by, reason)
    select r, 'FIELD', v_by, v_reason from unnest(coalesce(v_recs, '{}'::text[])) r
     where not exists (select 1 from public.field_events e where e.source_record_id = r)
    on conflict (record_id) do nothing;

  elsif v_src = 'KHQR' then
    v_label := 'KHQR';
    with d as (delete from public.qr_installations q where q.id = any(v_ids) returning q.id, q.record_id, q.request_id),
    t as (insert into public.deleted_phone_records (record_id, request_id, source, deleted_by, reason)
          select coalesce(d.record_id, 'QR-ROW-' || d.id), d.request_id, 'KHQR', v_by, v_reason from d
          on conflict (record_id) do nothing returning 1)
    select count(*), array_agg(coalesce(d.record_id, 'QR-ROW-' || d.id)) into v_del, v_recs from d;

  elsif v_src = 'CC' then
    v_label := 'Credit Card';
    with d as (delete from public.cc_entries c where c.id = any(v_ids) returning c.record_id),
    t as (insert into public.deleted_phone_records (record_id, source, deleted_by, reason)
          select d.record_id, 'CC', v_by, v_reason from d where d.record_id is not null
          on conflict (record_id) do nothing returning 1)
    select count(*), array_agg(d.record_id) into v_del, v_recs from d;

  else
    v_label := 'Merchant Visit';
    with d as (delete from public.mv_visits m where m.id = any(v_ids) returning m.record_id),
    t as (insert into public.deleted_phone_records (record_id, source, deleted_by, reason)
          select d.record_id, 'VISIT', v_by, v_reason from d
          on conflict (record_id) do nothing returning 1)
    select count(*), array_agg(d.record_id) into v_del, v_recs from d;
  end if;

  if v_del > 0 then
    insert into public.audit_logs (title, detail, action, target, branch_id, actor_name)
    values ('Phone Records Deleted', v_label || ': ' || v_del || ' record(s) deleted permanently'
            || coalesce(' · Reason: ' || v_reason, '') || ' · ' || left(array_to_string(v_recs, ', '), 1500),
            'PHONE_RECORD_DELETE', v_src, '100', v_by);
  end if;
  return jsonb_build_object('deleted', v_del, 'refused', v_ref,
                            'not_found', greatest(cardinality(v_ids) - v_del - jsonb_array_length(v_ref), 0));
end $$;
revoke all on function public.admin_delete_phone_records(jsonb) from public, anon;
grant execute on function public.admin_delete_phone_records(jsonb) to authenticated;

-- the Merchant Visit app's "check & resend": a deleted record counts as known, so it is not sent again
create or replace function public.field_known_records(p jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with ids as (select distinct jsonb_array_elements_text(case when jsonb_typeof(p->'ids') = 'array' then p->'ids' else '[]'::jsonb end) as id)
  select jsonb_build_object('known', coalesce(jsonb_agg(ids.id), '[]'::jsonb))
    from ids
   where exists (select 1 from public.field_events e where e.source_record_id = ids.id)
      or exists (select 1 from public.cc_entries c where c.record_id = ids.id)
      or exists (select 1 from public.mv_visits v where v.record_id = ids.id)
      or exists (select 1 from public.deleted_phone_records x where x.record_id = ids.id)
$$;

-- 04 Nov 2026 · Permanent delete, part 2: every KHQR view.
--   KHQR_ATTEMPT  failed attempts and wrong scans (qr_attempts), by their id. The attempt's event_id goes on the deleted
--                 list and a re-sent copy of the same event is ignored.
--   KHQR          entries can now also be named by Record ID (p.record_ids) - the "Same MID by 2+ staff" view lists them so.
-- Same rules as before: Super Admin only, Audit Trail, 500 per call.

alter table public.deleted_phone_records drop constraint if exists deleted_phone_records_source_check;
alter table public.deleted_phone_records add constraint deleted_phone_records_source_check
  check (source in ('FIELD', 'KHQR', 'KHQR_ATTEMPT', 'CC', 'VISIT'));

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
  elsif tg_table_name = 'qr_attempts' then
    if exists (select 1 from public.deleted_phone_records d where d.record_id = 'ATTEMPT:' || new.event_id) then return null; end if;
  else
    if exists (select 1 from public.deleted_phone_records d where d.record_id = new.record_id) then return null; end if;
  end if;
  return new;
end $$;
revoke all on function app.block_deleted_phone_record() from public, anon, authenticated;
drop trigger if exists block_deleted_record on public.qr_attempts;
create trigger block_deleted_record before insert on public.qr_attempts for each row execute function app.block_deleted_phone_record();

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
  v_names  int := 0;
begin
  if coalesce(app.role(), '') <> 'SUPER_ADMIN' then
    raise exception 'Only a Super Admin can delete phone app records.' using errcode = '42501';
  end if;
  if v_src not in ('FIELD', 'KHQR', 'KHQR_ATTEMPT', 'CC', 'VISIT') then
    raise exception 'INPUT: unknown record type.' using errcode = '22023';
  end if;
  select array_agg(distinct x::bigint) into v_ids
    from jsonb_array_elements_text(case when jsonb_typeof(p->'ids') = 'array' then p->'ids' else '[]'::jsonb end) x
   where x ~ '^\d{1,18}$';
  -- KHQR entries named by Record ID
  if v_src = 'KHQR' and jsonb_typeof(p->'record_ids') = 'array' then
    select count(*) into v_names from jsonb_array_elements_text(p->'record_ids');
    select array_agg(distinct q.id) into v_ids
      from (select unnest(coalesce(v_ids, '{}'::bigint[])) as id
            union select q2.id from public.qr_installations q2
             where q2.record_id in (select jsonb_array_elements_text(p->'record_ids'))) q;
  end if;
  if v_ids is null then raise exception 'INPUT: choose at least one record.' using errcode = '22023'; end if;
  if cardinality(v_ids) > 500 then raise exception 'INPUT: at most 500 records at a time.' using errcode = '22023'; end if;

  if v_src = 'FIELD' then
    v_label := 'POS Terminal / Sound Box';
    select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'record', e.source_record_id,
             'why', 'Approved: it already changed the stock, so it cannot be deleted.')), '[]'::jsonb)
      into v_ref from public.field_events e where e.id = any(v_ids) and e.status = 'APPROVED';
    with d as (delete from public.field_events e where e.id = any(v_ids) and e.status <> 'APPROVED' returning e.source_record_id)
    select count(*), array_agg(distinct d.source_record_id) into v_del, v_recs from d;
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

  elsif v_src = 'KHQR_ATTEMPT' then
    v_label := 'KHQR failed attempts / wrong scans';
    with d as (delete from public.qr_attempts a where a.id = any(v_ids) returning a.id, a.event_id, a.kind, a.got_mid),
    t as (insert into public.deleted_phone_records (record_id, source, deleted_by, reason)
          select 'ATTEMPT:' || d.event_id, 'KHQR_ATTEMPT', v_by, v_reason from d where d.event_id is not null
          on conflict (record_id) do nothing returning 1)
    select count(*), array_agg(initcap(replace(d.kind, '_', ' ')) || ' ' || coalesce(d.got_mid, '#' || d.id)) into v_del, v_recs from d;

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
                            'not_found', greatest(greatest(cardinality(v_ids), v_names) - v_del - jsonb_array_length(v_ref), 0));
end $$;
revoke all on function public.admin_delete_phone_records(jsonb) from public, anon;
grant execute on function public.admin_delete_phone_records(jsonb) to authenticated;

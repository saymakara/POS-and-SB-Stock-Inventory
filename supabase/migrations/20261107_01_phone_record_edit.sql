-- 07 Nov 2026 · Phone App Review: Admin / Super Admin can correct a record's details (every field).
--
-- admin_edit_phone_record(p) {source, id, changes, reason}
--   source   FIELD (POS Terminal / Sound Box records, field_events), VISIT (mv_visits), CC (cc_entries), KHQR (qr_installations)
--   id       the row's id, as the review pages show it
--   changes  { column: new value } - only the columns listed below; values equal to the current ones are ignored
--   reason   optional, kept in the Audit Trail
--   -> {changed: [columns], record, sheet: 'PENDING' | 'NOT_NEEDED'}
--
-- Rules
--   * Active Admin or Super Admin only. Every saved change goes to the Audit Trail (old -> new).
--   * POS Terminal / Sound Box records already APPROVED changed the stock: their serial numbers, MID, TID and batteries
--     cannot be changed here (the stock would not follow). Reject and redo the entry, or fix the unit in Stock Inventory.
--   * POS Terminal / Sound Box: Terminal Name, MID, TID and the serials belong to the one device (row); Outlet Name,
--     Remarks, location and the details (request type, returned items, checks, feedback) belong to the whole entry and
--     change on all its devices.
--   * The Merchant Visit app's Google Sheet is the record of origin for FIELD, VISIT and CC: each saved change is also
--     queued in public.phone_record_edits; the Merchant Visit app (3.81 or later) reads the queue every few minutes,
--     writes the change into the same row of the Sheet, and reports back (APPLIED / FAILED). KHQR records live only in
--     the portal (sheet = NOT_NEEDED).
--
-- mv_edits_pending(p) {limit}            service key only: the queued changes, oldest first
-- mv_edits_done(p) {results: [{id, ok, note}]}  service key only: APPLIED, or FAILED after 5 tries (note kept)

create table if not exists public.phone_record_edits (
  id            bigint generated always as identity primary key,
  source        text not null check (source in ('FIELD', 'VISIT', 'CC', 'KHQR')),
  row_id        bigint not null,                 -- the review page's row id
  record_id     text not null,                   -- the phone app's Record ID (KHQR: record id or QR-ROW-<id>)
  unit_no       int,                             -- FIELD: Device No of the row edited
  kind          text,                            -- FIELD: field_events.kind (the Sheet tab); CC / VISIT / KHQR: null
  changes       jsonb not null,                  -- { column: new value }
  old_values    jsonb not null default '{}'::jsonb,
  reason        text,
  edited_by     text,
  edited_at     timestamptz not null default now(),
  sheet_status  text not null default 'PENDING' check (sheet_status in ('PENDING', 'APPLIED', 'FAILED', 'NOT_NEEDED')),
  sheet_tries   int not null default 0,
  sheet_note    text,
  sheet_at      timestamptz
);
create index if not exists phone_record_edits_pending_idx on public.phone_record_edits (id) where sheet_status = 'PENDING';
create index if not exists phone_record_edits_record_idx on public.phone_record_edits (source, row_id, edited_at desc);
alter table public.phone_record_edits enable row level security;
drop policy if exists phone_record_edits_read on public.phone_record_edits;
create policy phone_record_edits_read on public.phone_record_edits for select to authenticated using ((select app.is_admin()));
revoke all on public.phone_record_edits from anon;
revoke insert, update, delete, truncate on public.phone_record_edits from authenticated;
grant select on public.phone_record_edits to authenticated;

-- a text value from the changes: trimmed, at most n characters ('' = cleared)
create or replace function app.edit_text(v jsonb, n int) returns text language sql immutable set search_path = '' as $$
  select left(btrim(case when v is null or jsonb_typeof(v) = 'null' then '' when jsonb_typeof(v) = 'string' then v #>> '{}' else v::text end), n)
$$;
revoke all on function app.edit_text(jsonb, int) from public, anon, authenticated;

create or replace function public.admin_edit_phone_record(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_src     text := upper(btrim(coalesce(p->>'source', '')));
  v_id      bigint;
  v_ch      jsonb := case when jsonb_typeof(p->'changes') = 'object' then p->'changes' else '{}'::jsonb end;
  v_reason  text := nullif(left(btrim(coalesce(p->>'reason', '')), 300), '');
  v_by      text := app.label();
  v_new     jsonb := '{}'::jsonb;      -- the columns that really change: new values
  v_old     jsonb := '{}'::jsonb;      --                                  old values
  v_rec     text;
  v_unit    int;
  v_kind    text;
  v_label   text;
  v_sheet   text := 'PENDING';
  k         text;
  v         jsonb;
  t         text;
  e         public.field_events;
  m         public.mv_visits;
  c         public.cc_entries;
  q         public.qr_installations;
  v_allowed text[];
  v_locked  text[] := '{}';
  v_det     jsonb;
  v_ans     jsonb;
begin
  if not coalesce(app.is_admin(), false) then
    raise exception 'Only an Admin or Super Admin can edit phone app records.' using errcode = '42501';
  end if;
  if coalesce(p->>'id', '') !~ '^\d{1,18}$' then raise exception 'INPUT: the record is missing.' using errcode = '22023'; end if;
  v_id := (p->>'id')::bigint;
  if v_ch = '{}'::jsonb then raise exception 'INPUT: nothing to change.' using errcode = '22023'; end if;

  if v_src = 'FIELD' then
    v_allowed := array['terminal_name', 'outlet_name', 'mid', 'tid', 'serial', 'old_serial', 'old_battery', 'new_battery', 'remarks',
                       'latitude', 'longitude', 'details', 'checks', 'feedback'];
    select * into e from public.field_events where id = v_id for update;
    if not found then raise exception 'INPUT: the record was not found (it may have been deleted).' using errcode = '22023'; end if;
    v_rec := e.source_record_id; v_unit := e.unit_no; v_kind := e.kind; v_label := e.device_type;
    for k, v in select * from jsonb_each(v_ch) loop
      if not (k = any(v_allowed)) then raise exception 'INPUT: % cannot be edited.', k using errcode = '22023'; end if;
      if k in ('details', 'checks') then
        if jsonb_typeof(v) <> 'object' then raise exception 'INPUT: % must be a list of answers.', k using errcode = '22023'; end if;
        v_det := coalesce(case when k = 'details'
                   then (select jsonb_object_agg(d->>'k', d->>'v') from jsonb_array_elements(coalesce(e.payload->'entry'->'details', '[]'::jsonb)) d where d ? 'k')
                   else e.payload->'entry'->'checks' end, '{}'::jsonb);
        -- only the answers that really change (and only answers the entry already has)
        select coalesce(jsonb_object_agg(x.key, app.edit_text(x.value, 200)), '{}'::jsonb) into v
          from jsonb_each(v) x where v_det ? x.key and app.edit_text(x.value, 200) is distinct from (v_det->>x.key);
        if v = '{}'::jsonb then continue; end if;
        v_new := v_new || jsonb_build_object(k, v);
        v_old := v_old || jsonb_build_object(k, (select jsonb_object_agg(x.key, v_det->x.key) from jsonb_each(v) x));
        continue;
      end if;
      if k in ('latitude', 'longitude') then
        t := app.edit_text(v, 30);
        if t <> '' and (t !~ '^-?\d{1,3}(\.\d+)?$' or abs(t::numeric) > case when k = 'latitude' then 90 else 180 end) then
          raise exception 'INPUT: % must be a number.', initcap(k) using errcode = '22023';
        end if;
        if nullif(t, '')::double precision is not distinct from (case when k = 'latitude' then e.latitude else e.longitude end) then continue; end if;
        v_new := v_new || jsonb_build_object(k, nullif(t, ''));
        v_old := v_old || jsonb_build_object(k, case when k = 'latitude' then e.latitude else e.longitude end);
        continue;
      end if;
      t := app.edit_text(v, case when k in ('remarks', 'feedback') then 1000 else 160 end);
      if k in ('serial', 'old_serial', 'old_battery', 'new_battery') then t := upper(replace(t, ' ', '')); end if;
      if k = 'mid' then t := regexp_replace(t, '\s', '', 'g'); if t <> '' and t !~ '^\d{9,15}$' then raise exception 'INPUT: the MID must be digits only (9 to 15).' using errcode = '22023'; end if; end if;
      if k = 'tid' then t := regexp_replace(t, '\s', '', 'g'); if t <> '' and t !~ '^\d{8}$' then raise exception 'INPUT: the TID must be 8 digits.' using errcode = '22023'; end if; end if;
      if k = 'serial' and t = '' then raise exception 'INPUT: the serial number cannot be empty.' using errcode = '22023'; end if;
      if t is not distinct from coalesce(case k when 'terminal_name' then e.terminal_name when 'outlet_name' then e.outlet_name when 'mid' then e.mid
            when 'tid' then e.tid when 'serial' then e.serial when 'old_serial' then e.old_serial when 'old_battery' then e.old_battery
            when 'new_battery' then e.new_battery when 'remarks' then e.remarks when 'feedback' then e.payload->'entry'->>'feedback' end, '') then continue; end if;
      if e.status = 'APPROVED' and k in ('serial', 'old_serial', 'mid', 'tid', 'old_battery', 'new_battery') then
        v_locked := v_locked || k; continue;
      end if;
      v_new := v_new || jsonb_build_object(k, t);
      v_old := v_old || jsonb_build_object(k, case k when 'terminal_name' then e.terminal_name when 'outlet_name' then e.outlet_name when 'mid' then e.mid
            when 'tid' then e.tid when 'serial' then e.serial when 'old_serial' then e.old_serial when 'old_battery' then e.old_battery
            when 'new_battery' then e.new_battery when 'remarks' then e.remarks when 'feedback' then e.payload->'entry'->>'feedback' end);
    end loop;
    if cardinality(v_locked) > 0 then
      raise exception 'APPROVED: % cannot be changed on an approved record - it already changed the stock. Reject and redo the entry, or fix the unit in Stock Inventory.',
        array_to_string(v_locked, ', ') using errcode = 'P0001';
    end if;
    if v_new = '{}'::jsonb then return jsonb_build_object('changed', '[]'::jsonb, 'record', v_rec, 'sheet', 'NOT_NEEDED'); end if;

    -- this device (row)
    update public.field_events f set
      terminal_name = case when v_new ? 'terminal_name' then nullif(v_new->>'terminal_name', '') else f.terminal_name end,
      mid           = case when v_new ? 'mid' then nullif(v_new->>'mid', '') else f.mid end,
      tid           = case when v_new ? 'tid' then nullif(v_new->>'tid', '') else f.tid end,
      serial        = case when v_new ? 'serial' then v_new->>'serial' else f.serial end,
      old_serial    = case when v_new ? 'old_serial' then nullif(v_new->>'old_serial', '') else f.old_serial end,
      old_battery   = case when v_new ? 'old_battery' then nullif(v_new->>'old_battery', '') else f.old_battery end,
      new_battery   = case when v_new ? 'new_battery' then nullif(v_new->>'new_battery', '') else f.new_battery end,
      payload       = jsonb_set(f.payload, '{unit}', coalesce(f.payload->'unit', '{}'::jsonb)
                        || (v_new - array['outlet_name', 'remarks', 'latitude', 'longitude', 'details', 'checks', 'feedback'])),
      updated_at    = now()
     where f.id = e.id;
    -- the whole entry (every device of this revision)
    if v_new ?| array['outlet_name', 'remarks', 'latitude', 'longitude', 'details', 'checks', 'feedback'] then
      update public.field_events f set
        outlet_name = case when v_new ? 'outlet_name' then nullif(v_new->>'outlet_name', '') else f.outlet_name end,
        remarks     = case when v_new ? 'remarks' then nullif(v_new->>'remarks', '') else f.remarks end,
        latitude    = case when v_new ? 'latitude' then (v_new->>'latitude')::double precision else f.latitude end,
        longitude   = case when v_new ? 'longitude' then (v_new->>'longitude')::double precision else f.longitude end,
        payload     = jsonb_set(f.payload, '{entry}', (coalesce(f.payload->'entry', '{}'::jsonb)
                        || (v_new - array['terminal_name', 'mid', 'tid', 'serial', 'old_serial', 'old_battery', 'new_battery', 'details', 'checks'])
                        || case when v_new ? 'checks' then jsonb_build_object('checks', coalesce(f.payload->'entry'->'checks', '{}'::jsonb) || (v_new->'checks')) else '{}'::jsonb end
                        || case when v_new ? 'details' then (
                             with d as (select x.ord, x.d->>'k' as dk, coalesce(v_new->'details'->>(x.d->>'k'), x.d->>'v') as dv
                                          from jsonb_array_elements(coalesce(f.payload->'entry'->'details', '[]'::jsonb)) with ordinality x(d, ord))
                             select jsonb_build_object(
                               'details', coalesce((select jsonb_agg(jsonb_build_object('k', dk, 'v', dv) order by ord) from d), '[]'::jsonb),
                               'summary', case when f.kind = 'POS_RETURN'
                                 then (select string_agg(case when dk = 'Product Name' then 'Product ' || coalesce(nullif(dv, ''), '—') else dk || ': ' || coalesce(nullif(dv, ''), '—') end, ' · ' order by ord) from d)
                                 else (select string_agg(dv, ' · ' order by ord) from d where coalesce(dv, '') <> '') end))
                           else '{}'::jsonb end)),
        updated_at  = now()
       where f.source_record_id = e.source_record_id and f.revision = e.revision;
    end if;

  elsif v_src = 'VISIT' then
    v_label := 'Merchant Visit';
    select * into m from public.mv_visits where id = v_id for update;
    if not found then raise exception 'INPUT: the record was not found (it may have been deleted).' using errcode = '22023'; end if;
    v_rec := m.record_id;
    if not (v_ch ? 'answers') or jsonb_typeof(v_ch->'answers') <> 'object' or (v_ch - 'answers') <> '{}'::jsonb then
      raise exception 'INPUT: a visit is edited through its answers.' using errcode = '22023';
    end if;
    v_ans := coalesce(m.answers, '{}'::jsonb);
    for k, v in select * from jsonb_each(v_ch->'answers') loop
      if length(k) > 80 or k ~ '[\x00-\x1F]' then raise exception 'INPUT: unknown question %.', left(k, 40) using errcode = '22023'; end if;
      t := app.edit_text(v, case when lower(k) in ('remarks', 'address') then 1000 else 300 end);
      if lower(k) in ('latitude', 'longitude') and t <> '' and t !~ '^-?\d{1,3}(\.\d+)?$' then raise exception 'INPUT: % must be a number.', k using errcode = '22023'; end if;
      if t is not distinct from coalesce(v_ans->>k, '') then continue; end if;
      v_new := v_new || jsonb_build_object(k, t);
      v_old := v_old || jsonb_build_object(k, coalesce(v_ans->>k, ''));
    end loop;
    if v_new = '{}'::jsonb then return jsonb_build_object('changed', '[]'::jsonb, 'record', v_rec, 'sheet', 'NOT_NEEDED'); end if;
    v_ans := v_ans || v_new;
    update public.mv_visits set
      answers       = (select coalesce(jsonb_object_agg(a.key, a.value), '{}'::jsonb) from jsonb_each(v_ans) a where a.value <> '""'::jsonb),
      activity      = case when v_new ? 'Activity Type' then nullif(v_new->>'Activity Type', '') else activity end,
      merchant_name = case when v_new ? 'Merchant Name' then nullif(v_new->>'Merchant Name', '') else merchant_name end,
      mid           = case when v_new ? 'MID or Acc Number' then nullif(regexp_replace(v_new->>'MID or Acc Number', '\s', '', 'g'), '')
                           when v_new ? 'MID' then nullif(regexp_replace(v_new->>'MID', '\s', '', 'g'), '') else mid end,
      location      = case when v_new ? 'Location' then nullif(v_new->>'Location', '') else location end,
      khan          = case when v_new ? 'Khan' then nullif(v_new->>'Khan', '') else khan end,
      remarks       = case when v_new ? 'Remarks' then nullif(v_new->>'Remarks', '') else remarks end,
      latitude      = case when v_new ? 'Latitude' then nullif(v_new->>'Latitude', '')::double precision else latitude end,
      longitude     = case when v_new ? 'Longitude' then nullif(v_new->>'Longitude', '')::double precision else longitude end,
      edited_at     = now(),
      updated_at    = now()
     where id = m.id;
    v_new := jsonb_build_object('answers', v_new); v_old := jsonb_build_object('answers', v_old);

  elsif v_src = 'CC' then
    v_label := 'Credit Card';
    v_allowed := array['card_status', 'fail_reason', 'full_name', 'contact', 'marital', 'primary_acc', 'mid_or_acc', 'limit_usd',
                       'repayment', 'email', 'remarks', 'supplementary'];
    select * into c from public.cc_entries where id = v_id for update;
    if not found then raise exception 'INPUT: the record was not found (it may have been deleted).' using errcode = '22023'; end if;
    v_rec := c.record_id;
    for k, v in select * from jsonb_each(v_ch) loop
      if not (k = any(v_allowed)) then raise exception 'INPUT: % cannot be edited.', k using errcode = '22023'; end if;
      if k = 'supplementary' then
        if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) <> jsonb_array_length(c.supplementary) then
          raise exception 'INPUT: supplementary cards can be corrected, not added or removed.' using errcode = '22023';
        end if;
        select coalesce(jsonb_agg(jsonb_build_object('full_name', app.edit_text(x.s->'full_name', 160), 'marital', app.edit_text(x.s->'marital', 40),
                 'account', regexp_replace(app.edit_text(x.s->'account', 40), '\s', '', 'g'), 'email', app.edit_text(x.s->'email', 160)) order by x.ord), '[]'::jsonb)
          into v from jsonb_array_elements(v) with ordinality x(s, ord);
        if v is not distinct from c.supplementary then continue; end if;
        v_new := v_new || jsonb_build_object(k, v); v_old := v_old || jsonb_build_object(k, c.supplementary);
        continue;
      end if;
      t := app.edit_text(v, case when k = 'remarks' then 2000 else 160 end);
      if k in ('primary_acc', 'mid_or_acc', 'contact') then t := regexp_replace(t, '\s', '', 'g'); end if;
      if k = 'limit_usd' then
        t := regexp_replace(t, '[^0-9.]', '', 'g');
        if t <> '' and t !~ '^\d{1,10}(\.\d{1,2})?$' then raise exception 'INPUT: the limit must be an amount in USD.' using errcode = '22023'; end if;
        if nullif(t, '')::numeric is not distinct from c.limit_usd then continue; end if;
        v_new := v_new || jsonb_build_object(k, nullif(t, '')); v_old := v_old || jsonb_build_object(k, c.limit_usd);
        continue;
      end if;
      if t is not distinct from coalesce(case k when 'card_status' then c.card_status when 'fail_reason' then c.fail_reason when 'full_name' then c.full_name
            when 'contact' then c.contact when 'marital' then c.marital when 'primary_acc' then c.primary_acc when 'mid_or_acc' then c.mid_or_acc
            when 'repayment' then c.repayment when 'email' then c.email when 'remarks' then c.remarks end, '') then continue; end if;
      v_new := v_new || jsonb_build_object(k, t);
      v_old := v_old || jsonb_build_object(k, case k when 'card_status' then c.card_status when 'fail_reason' then c.fail_reason when 'full_name' then c.full_name
            when 'contact' then c.contact when 'marital' then c.marital when 'primary_acc' then c.primary_acc when 'mid_or_acc' then c.mid_or_acc
            when 'repayment' then c.repayment when 'email' then c.email when 'remarks' then c.remarks end);
    end loop;
    if v_new = '{}'::jsonb then return jsonb_build_object('changed', '[]'::jsonb, 'record', v_rec, 'sheet', 'NOT_NEEDED'); end if;
    update public.cc_entries set
      card_status   = case when v_new ? 'card_status' then nullif(v_new->>'card_status', '') else card_status end,
      fail_reason   = case when v_new ? 'fail_reason' then nullif(v_new->>'fail_reason', '') else fail_reason end,
      full_name     = case when v_new ? 'full_name' then nullif(v_new->>'full_name', '') else full_name end,
      contact       = case when v_new ? 'contact' then nullif(v_new->>'contact', '') else contact end,
      marital       = case when v_new ? 'marital' then nullif(v_new->>'marital', '') else marital end,
      primary_acc   = case when v_new ? 'primary_acc' then nullif(v_new->>'primary_acc', '') else primary_acc end,
      mid_or_acc    = case when v_new ? 'mid_or_acc' then nullif(v_new->>'mid_or_acc', '') else mid_or_acc end,
      limit_usd     = case when v_new ? 'limit_usd' then (v_new->>'limit_usd')::numeric else limit_usd end,
      repayment     = case when v_new ? 'repayment' then nullif(v_new->>'repayment', '') else repayment end,
      email         = case when v_new ? 'email' then nullif(v_new->>'email', '') else email end,
      remarks       = case when v_new ? 'remarks' then nullif(v_new->>'remarks', '') else remarks end,
      supplementary = case when v_new ? 'supplementary' then v_new->'supplementary' else supplementary end,
      edited_at     = now()
     where id = c.id;

  elsif v_src = 'KHQR' then
    v_label := 'KHQR'; v_sheet := 'NOT_NEEDED';
    v_allowed := array['merchant_name', 'merchant_name_kh', 'mid', 'activity', 'location', 'khan', 'remark', 'latitude', 'longitude'];
    select * into q from public.qr_installations where id = v_id for update;
    if not found then raise exception 'INPUT: the record was not found (it may have been deleted).' using errcode = '22023'; end if;
    v_rec := coalesce(q.record_id, 'QR-ROW-' || q.id);
    for k, v in select * from jsonb_each(v_ch) loop
      if not (k = any(v_allowed)) then raise exception 'INPUT: % cannot be edited.', k using errcode = '22023'; end if;
      t := app.edit_text(v, case when k = 'remark' then 1000 else 160 end);
      if k = 'mid' then t := regexp_replace(t, '\s', '', 'g'); if t !~ '^\d{15}$' then raise exception 'INPUT: the MID must be 15 digits.' using errcode = '22023'; end if; end if;
      if k = 'activity' and t not in ('NEW_INSTALLATION', 'QR_REPLACEMENT') then raise exception 'INPUT: choose New Installation or QR Replacement.' using errcode = '22023'; end if;
      if k = 'merchant_name' and t = '' then raise exception 'INPUT: the merchant name cannot be empty.' using errcode = '22023'; end if;
      if k in ('latitude', 'longitude') then
        if t <> '' and (t !~ '^-?\d{1,3}(\.\d+)?$' or abs(t::numeric) > case when k = 'latitude' then 90 else 180 end) then
          raise exception 'INPUT: % must be a number.', initcap(k) using errcode = '22023';
        end if;
        if nullif(t, '')::double precision is not distinct from (case when k = 'latitude' then q.latitude else q.longitude end) then continue; end if;
        v_new := v_new || jsonb_build_object(k, nullif(t, '')); v_old := v_old || jsonb_build_object(k, case when k = 'latitude' then q.latitude else q.longitude end);
        continue;
      end if;
      if t is not distinct from coalesce(case k when 'merchant_name' then q.merchant_name when 'merchant_name_kh' then q.merchant_name_kh when 'mid' then q.mid
            when 'activity' then q.activity when 'location' then q.location when 'khan' then q.khan when 'remark' then q.remark end, '') then continue; end if;
      v_new := v_new || jsonb_build_object(k, t);
      v_old := v_old || jsonb_build_object(k, case k when 'merchant_name' then q.merchant_name when 'merchant_name_kh' then q.merchant_name_kh when 'mid' then q.mid
            when 'activity' then q.activity when 'location' then q.location when 'khan' then q.khan when 'remark' then q.remark end);
    end loop;
    if v_new = '{}'::jsonb then return jsonb_build_object('changed', '[]'::jsonb, 'record', v_rec, 'sheet', 'NOT_NEEDED'); end if;
    update public.qr_installations set
      merchant_name    = case when v_new ? 'merchant_name' then v_new->>'merchant_name' else merchant_name end,
      merchant_name_kh = case when v_new ? 'merchant_name_kh' then nullif(v_new->>'merchant_name_kh', '') else merchant_name_kh end,
      mid              = case when v_new ? 'mid' then v_new->>'mid' else mid end,
      activity         = case when v_new ? 'activity' then v_new->>'activity' else activity end,
      location         = case when v_new ? 'location' then nullif(v_new->>'location', '') else location end,
      khan             = case when v_new ? 'khan' then nullif(v_new->>'khan', '') else khan end,
      remark           = case when v_new ? 'remark' then nullif(v_new->>'remark', '') else remark end,
      latitude         = case when v_new ? 'latitude' then (v_new->>'latitude')::double precision else latitude end,
      longitude        = case when v_new ? 'longitude' then (v_new->>'longitude')::double precision else longitude end
     where id = q.id;
  else
    raise exception 'INPUT: unknown record type.' using errcode = '22023';
  end if;

  insert into public.phone_record_edits (source, row_id, record_id, unit_no, kind, changes, old_values, reason, edited_by, sheet_status)
  values (v_src, v_id, v_rec, v_unit, v_kind, v_new, v_old, v_reason, v_by, v_sheet);

  insert into public.audit_logs (title, detail, action, target, branch_id, actor_name)
  values ('Phone Record Edited', v_label || ' ' || v_rec || coalesce(' (device ' || v_unit || ')', '') || ': '
            || left((select string_agg(x.key || ' ' || coalesce(v_old->>x.key, '—') || ' → ' || coalesce(x.value #>> '{}', '—'), ' · ')
                       from jsonb_each(case when v_src = 'VISIT' then v_new->'answers' else v_new end) x), 1500)
            || coalesce(' · Reason: ' || v_reason, ''),
          'PHONE_RECORD_EDIT', v_rec, '100', v_by);

  return jsonb_build_object('changed', (select jsonb_agg(x) from jsonb_object_keys(case when v_src = 'VISIT' then v_new->'answers' else v_new end) x),
                            'record', v_rec, 'sheet', v_sheet);
end $$;
revoke all on function public.admin_edit_phone_record(jsonb) from public, anon;
grant execute on function public.admin_edit_phone_record(jsonb) to authenticated;

-- the Merchant Visit app (service key): the changes waiting for the Google Sheet, oldest first
create or replace function public.mv_edits_pending(p jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('edits', coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'source', x.source, 'record_id', x.record_id, 'unit_no', x.unit_no,
           'kind', x.kind, 'changes', x.changes, 'edited_by', x.edited_by, 'edited_at', x.edited_at, 'tries', x.sheet_tries) order by x.id), '[]'::jsonb))
    from (select * from public.phone_record_edits e where e.sheet_status = 'PENDING' order by e.id
           limit least(greatest(coalesce((p->>'limit')::int, 50), 1), 200)) x
$$;
revoke all on function public.mv_edits_pending(jsonb) from public, anon, authenticated;
grant execute on function public.mv_edits_pending(jsonb) to service_role;

-- the Merchant Visit app (service key): which changes are in the Sheet now; a failure is tried again (5 tries)
create or replace function public.mv_edits_done(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare r jsonb; n_ok int := 0; n_fail int := 0;
begin
  for r in select * from jsonb_array_elements(case when jsonb_typeof(p->'results') = 'array' then p->'results' else '[]'::jsonb end) loop
    if coalesce(r->>'id', '') !~ '^\d{1,18}$' then continue; end if;
    if coalesce((r->>'ok')::boolean, false) then
      update public.phone_record_edits set sheet_status = 'APPLIED', sheet_at = now(), sheet_note = nullif(left(coalesce(r->>'note', ''), 300), ''),
             sheet_tries = sheet_tries + 1
       where id = (r->>'id')::bigint and sheet_status = 'PENDING';
      if found then n_ok := n_ok + 1; end if;
    else
      update public.phone_record_edits set sheet_tries = sheet_tries + 1, sheet_note = left(coalesce(r->>'note', 'not applied'), 300),
             sheet_status = case when sheet_tries + 1 >= 5 then 'FAILED' else 'PENDING' end, sheet_at = now()
       where id = (r->>'id')::bigint and sheet_status = 'PENDING';
      if found then n_fail := n_fail + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('applied', n_ok, 'failed', n_fail);
end $$;
revoke all on function public.mv_edits_done(jsonb) from public, anon, authenticated;
grant execute on function public.mv_edits_done(jsonb) to service_role;

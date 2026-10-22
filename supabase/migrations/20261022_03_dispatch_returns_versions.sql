-- =====================================================================================================================
-- 22 Oct 2026 · Part 5: requests keep their type, stock moves only through checked database functions, stale saves
-- are refused, and a first password must be changed before any data can be read.
-- Safe to run more than once. Contains no DROP statements.
-- =====================================================================================================================

-- 1. Requests: stock request or stock return, and the units a branch asks to return
alter table public.requisitions add column if not exists type varchar not null default 'STOCK_REQUEST';
alter table public.requisitions add column if not exists return_serials jsonb not null default '[]'::jsonb;

-- 2. Devices: a version number, so a save made from an out-of-date screen cannot overwrite a newer change.
--    The refusal uses SQLSTATE PT409 (HTTP 409). Never 40001: PostgREST retries 40001 automatically, endlessly.
alter table public.devices add column if not exists row_version bigint not null default 1;

create or replace function app.devices_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_trusted boolean := coalesce(current_setting('app.trusted_change', true), '') = 'on';
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.row_version := 1;
    return new;
  end if;
  if not v_trusted and new.row_version is distinct from old.row_version then
    raise exception 'STALE_ROW: device % was changed by someone else just now (server version %, your copy %).',
      old.serial, old.row_version, new.row_version using errcode = 'PT409';
  end if;
  new.row_version := old.row_version + 1;
  if auth.uid() is not null and not app.is_admin() and not v_trusted then
    if new.serial is distinct from old.serial or new.type is distinct from old.type
       or new.archived is distinct from old.archived or new.branch_id is distinct from old.branch_id then
      raise exception 'Branch staff cannot change the serial, type, branch or archive state of a device.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- 3. A first (temporary) password gives no access to data until it is changed
create or replace function app.role() returns text
language sql stable security definer set search_path = '' as $$
  select p.role from public.staff_profiles p where p.user_id = auth.uid() and p.active and not p.must_change_password
$$;
create or replace function app.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.role in ('SUPER_ADMIN', 'ADMIN') from public.staff_profiles p
                   where p.user_id = auth.uid() and p.active and not p.must_change_password), false)
$$;
create or replace function app.branch() returns text
language sql stable security definer set search_path = '' as $$
  select p.branch_id::text from public.staff_profiles p where p.user_id = auth.uid() and p.active and not p.must_change_password
$$;

-- 4. Requests change status only through the functions below (dispatch, receipt, return)
create or replace function app.requisitions_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if coalesce(current_setting('app.trusted_change', true), '') = 'on' or auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'PENDING_ADMIN' then
      raise exception 'A new request must start as pending.' using errcode = '42501';
    end if;
    new.arranged_devices := '[]'::jsonb;
    if new.type not in ('STOCK_REQUEST', 'STOCK_RETURN') then
      raise exception 'Unknown request type %.', new.type using errcode = '22023';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status or new.arranged_devices is distinct from old.arranged_devices
     or new.type is distinct from old.type or new.return_serials is distinct from old.return_serials
     or new.branch_id is distinct from old.branch_id then
    raise exception 'Use Dispatch, Confirm Receipt or Approve Return to change a request.' using errcode = '42501';
  end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'requisitions_guard' and tgrelid = 'public.requisitions'::regclass) then
    create trigger requisitions_guard before insert or update on public.requisitions
      for each row execute function app.requisitions_guard();
  end if;
end $$;

-- 5. Dispatch: HQ chooses units for a pending stock request. Every unit must be in HQ stock, not archived, listed once,
--    not allocated to another request, and no more than requested. The units stay in HQ stock (allocated) until the
--    branch confirms receipt.
create or replace function public.admin_dispatch_requisition(p_req_id text, p_serials text[], p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.requisitions; d public.devices; s text; v_items jsonb := '[]'::jsonb;
        v_pos int := 0; v_sb int := 0; v_seen text[] := '{}'; v_err text[] := '{}';
begin
  if not app.is_admin() then raise exception 'Only HQ admins can dispatch stock.' using errcode = '42501'; end if;
  perform set_config('app.trusted_change', 'on', true);
  select * into r from public.requisitions where req_id = p_req_id for update;
  if not found then raise exception 'Request % not found.', p_req_id; end if;
  if coalesce(r.type, 'STOCK_REQUEST') <> 'STOCK_REQUEST' then raise exception 'Request % is a stock return, not a stock request.', p_req_id; end if;
  if r.status <> 'PENDING_ADMIN' then raise exception 'Request % is already % and cannot be dispatched again.', p_req_id, r.status; end if;
  if coalesce(cardinality(p_serials), 0) = 0 then raise exception 'Choose at least one unit to dispatch.'; end if;
  foreach s in array p_serials loop
    s := upper(btrim(coalesce(s, '')));
    if s = '' then v_err := v_err || 'a blank serial'::text; continue; end if;
    if s = any(v_seen) then v_err := v_err || (s || ' is listed twice'); continue; end if;
    v_seen := v_seen || s;
    select * into d from public.devices where upper(serial) = s for update;
    if not found then v_err := v_err || (s || ' is not in the inventory'); continue; end if;
    if d.stage <> 'HQ_STOCK' or coalesce(d.archived, false) then
      v_err := v_err || (s || ' is not in HQ stock (' || d.stage || case when d.archived then ', archived' else '' end || ')'); continue;
    end if;
    if coalesce(d.custom_fields->>'allocatedTo', '') not in ('', r.req_id) then
      v_err := v_err || (s || ' is already allocated to ' || (d.custom_fields->>'allocatedTo')); continue;
    end if;
    if d.type = 'Sound Box' then v_sb := v_sb + 1; else v_pos := v_pos + 1; end if;
    v_items := v_items || jsonb_build_object('serial', d.serial, 'batterySerial', coalesce(d.battery_serial, ''), 'type', d.type, 'model', d.model);
  end loop;
  if v_pos > coalesce(r.pos_qty, 0) or v_sb > coalesce(r.sb_qty, 0) then
    v_err := v_err || format('more units than requested (POS %s of %s, Sound Box %s of %s)', v_pos, coalesce(r.pos_qty, 0), v_sb, coalesce(r.sb_qty, 0));
  end if;
  if cardinality(v_err) > 0 then
    raise exception 'Not dispatched: %.', array_to_string(v_err, '; ') using errcode = '22023';
  end if;
  update public.devices
     set custom_fields = coalesce(custom_fields, '{}'::jsonb) || jsonb_build_object('allocatedTo', r.req_id),
         history = jsonb_build_array(app.stamp() || ' | Dispatched from HQ | Request ' || r.req_id || ' to Branch Code ' || r.branch_id
                                     || ' by ' || coalesce(app.label(), 'admin')) || coalesce(history, '[]'::jsonb)
   where serial in (select x->>'serial' from jsonb_array_elements(v_items) x);
  update public.requisitions set status = 'DISPATCHED', arranged_devices = v_items where req_id = r.req_id;
  insert into public.audit_logs (title, detail, branch_id, action, target)
  values ('Requisition Dispatched', 'Request ' || r.req_id || ': ' || jsonb_array_length(v_items) || ' unit(s) to Branch Code ' || r.branch_id
          || coalesce('; ' || nullif(btrim(p_note), ''), ''), r.branch_id, 'STOCK_DISPATCH', r.req_id);
  return jsonb_build_object('arranged', v_items);
end $$;

-- 6. Receipt: the branch confirms; only units allocated to this request (still in HQ stock) move to the branch
create or replace function public.branch_confirm_receipt(p_req_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.requisitions; v_branch text := app.branch(); v_moved text[] := '{}'; v_skip text[] := '{}'; it jsonb; d public.devices;
begin
  if app.role() is null then raise exception 'Not signed in.' using errcode = '42501'; end if;
  perform set_config('app.trusted_change', 'on', true);
  select * into r from public.requisitions where req_id = p_req_id for update;
  if not found then raise exception 'Request % not found.', p_req_id; end if;
  if not app.is_admin() and r.branch_id is distinct from v_branch then raise exception 'This request belongs to another branch.' using errcode = '42501'; end if;
  if coalesce(r.type, 'STOCK_REQUEST') <> 'STOCK_REQUEST' then raise exception 'Request % is a stock return.', p_req_id; end if;
  if r.status <> 'DISPATCHED' then raise exception 'Request % is not dispatched (status %).', p_req_id, r.status; end if;
  for it in select * from jsonb_array_elements(coalesce(r.arranged_devices, '[]'::jsonb)) loop
    select * into d from public.devices where serial = it->>'serial' for update;
    if found and d.stage = 'HQ_STOCK' and not coalesce(d.archived, false)
       and coalesce(d.custom_fields->>'allocatedTo', r.req_id) = r.req_id then
      update public.devices set stage = 'BRANCH_RESERVE', branch_id = r.branch_id, branch_name = r.branch_name,
        mid = null, tid = null, merchant_name = null, merchant_phone = null, address = null,
        deployment_status = 'In-Stock (Reserve)', stock_status = 'In-Stock',
        custom_fields = coalesce(custom_fields, '{}'::jsonb) - 'allocatedTo',
        history = jsonb_build_array(app.stamp() || ' | Received at Branch | Request ' || r.req_id || ' confirmed by ' || coalesce(app.label(), 'staff'))
                  || coalesce(history, '[]'::jsonb)
      where serial = d.serial;
      v_moved := v_moved || d.serial;
    else
      v_skip := v_skip || (it->>'serial');
    end if;
  end loop;
  update public.requisitions set status = 'RECEIVED' where req_id = r.req_id;
  insert into public.audit_logs (title, detail, branch_id, action, target)
  values ('Stock Received', 'Request ' || r.req_id || ': ' || cardinality(v_moved) || ' unit(s) received'
          || case when cardinality(v_skip) > 0 then '; not moved (no longer allocated in HQ stock): ' || array_to_string(v_skip, ', ') else '' end,
          r.branch_id, 'STOCK_RECEIVE', r.req_id);
  return jsonb_build_object('moved', to_jsonb(v_moved), 'skipped', to_jsonb(v_skip));
end $$;

-- 7. Return: HQ approves a branch's pending return. Only units still at that branch and not at a merchant move.
--    A faulty unit stays "Faulty" (now at HQ); a working unit goes back to HQ stock.
create or replace function public.admin_receive_return(p_req_id text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.requisitions; s text; d public.devices; v_moved text[] := '{}'; v_skip text[] := '{}'; v_to text;
begin
  if not app.is_admin() then raise exception 'Only HQ admins can approve a return.' using errcode = '42501'; end if;
  perform set_config('app.trusted_change', 'on', true);
  select * into r from public.requisitions where req_id = p_req_id for update;
  if not found then raise exception 'Request % not found.', p_req_id; end if;
  if r.type <> 'STOCK_RETURN' then raise exception 'Request % is not a stock return.', p_req_id; end if;
  if r.status <> 'PENDING_ADMIN' then raise exception 'Return % is already %.', p_req_id, r.status; end if;
  for s in select jsonb_array_elements_text(coalesce(r.return_serials, '[]'::jsonb)) loop
    select * into d from public.devices where serial = s for update;
    if not found or d.branch_id is distinct from r.branch_id or d.stage not in ('BRANCH_RESERVE', 'CONFIGURING', 'FAULTY') then
      v_skip := v_skip || (s || case when not found then ' (not found)' else ' (' || d.stage || ', Branch Code ' || d.branch_id || ')' end);
      continue;
    end if;
    v_to := case when d.stage = 'FAULTY' then 'FAULTY' else 'HQ_STOCK' end;
    update public.devices set stage = v_to, branch_id = '100', branch_name = 'Head Office',
      mid = null, tid = null, merchant_name = null, merchant_phone = null, address = null,
      deployment_status = case when v_to = 'FAULTY' then 'Faulty / Returned' else 'In-Stock (Reserve)' end,
      stock_status = case when v_to = 'FAULTY' then 'Faulty' else 'In-Stock' end,
      note = nullif(btrim(regexp_replace(coalesce(note, ''), 'Pending Return Approval \([^)]*\)\.?', '', 'g')), ''),
      custom_fields = coalesce(custom_fields, '{}'::jsonb) - 'allocatedTo'
        || jsonb_build_object('returnedByStaff', coalesce(app.label(), 'HQ'), 'returnedDate', to_char(now() at time zone 'Asia/Phnom_Penh', 'YYYY-MM-DD')),
      history = jsonb_build_array(app.stamp() || ' | Returned to HQ | Return ' || r.req_id || ' approved by ' || coalesce(app.label(), 'admin')
                                  || coalesce(' — ' || nullif(btrim(p_note), ''), '')) || coalesce(history, '[]'::jsonb)
    where serial = d.serial;
    v_moved := v_moved || d.serial;
  end loop;
  update public.requisitions set status = 'RECEIVED' where req_id = r.req_id;
  insert into public.audit_logs (title, detail, branch_id, action, target)
  values ('Stock Return Received', 'Return ' || r.req_id || ': ' || cardinality(v_moved) || ' unit(s) received at HQ'
          || case when cardinality(v_skip) > 0 then '; not moved: ' || array_to_string(v_skip, ', ') else '' end,
          r.branch_id, 'STOCK_RETURN_RECEIVE', r.req_id);
  return jsonb_build_object('moved', to_jsonb(v_moved), 'skipped', to_jsonb(v_skip));
end $$;

revoke all on function public.admin_dispatch_requisition(text, text[], text) from public, anon;
revoke all on function public.admin_receive_return(text, text) from public, anon;
revoke all on function public.branch_confirm_receipt(text) from public, anon;
grant execute on function public.admin_dispatch_requisition(text, text[], text) to authenticated;
grant execute on function public.admin_receive_return(text, text) to authenticated;
grant execute on function public.branch_confirm_receipt(text) to authenticated;

create index if not exists idx_devices_allocated on public.devices ((custom_fields->>'allocatedTo')) where custom_fields ? 'allocatedTo';

-- 8. Merchant history keeps the officers (installed / replaced / returned by)
alter table public.historical_merchants add column if not exists installed_by_staff text;
alter table public.historical_merchants add column if not exists replaced_by_staff text;
alter table public.historical_merchants add column if not exists returned_by_staff text;

-- 9. A MID is digits only. This refuses Excel's shortened form (e.g. "1.00001E+14", where the real digits are lost).
--    NOT VALID: rows saved before this rule are kept (and shown as "check MID") until corrected.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'devices_mid_digits') then
    alter table public.devices add constraint devices_mid_digits check (mid is null or mid = '' or mid ~ '^[0-9]+$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hist_mid_digits') then
    alter table public.historical_merchants add constraint hist_mid_digits check (mid is null or mid = '' or mid ~ '^[0-9]+$') not valid;
  end if;
end $$;

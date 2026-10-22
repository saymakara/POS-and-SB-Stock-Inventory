-- =====================================================================================================================
-- POS & Sound Box Stock Inventory · 21 Oct 2026
-- 1. Real sign-in: staff_profiles linked to Supabase Auth (employee ID + password), roles SUPER_ADMIN / ADMIN / BRANCH
-- 2. Row-level security on every table: admins see all; branch staff see and change only their own branch
-- 3. Trustworthy audit log: actor stamped by the database, append-only
-- 4. field_events: records sent by the Merchant Visit phone app (installations, replacements, battery replacements,
--    sound box maintenance / returns). They wait in a review queue; stock changes only when an admin approves.
-- Safe to run more than once.
-- =====================================================================================================================

create schema if not exists app;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Staff accounts
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  emp_id text not null unique,
  name text not null,
  role text not null check (role in ('SUPER_ADMIN', 'ADMIN', 'BRANCH')),
  branch_id varchar(16) not null references public.branches(id) on update cascade,
  position text,
  contact text,
  active boolean not null default true,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.staff_profiles enable row level security;

-- the signed-in staff member (active only); used by every policy
create or replace function app.role() returns text language sql stable security definer set search_path = '' as $$
  select p.role from public.staff_profiles p where p.user_id = auth.uid() and p.active
$$;
create or replace function app.branch() returns text language sql stable security definer set search_path = '' as $$
  select p.branch_id::text from public.staff_profiles p where p.user_id = auth.uid() and p.active
$$;
create or replace function app.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.role in ('SUPER_ADMIN', 'ADMIN') from public.staff_profiles p where p.user_id = auth.uid() and p.active), false)
$$;
create or replace function app.label() returns text language sql stable security definer set search_path = '' as $$
  select p.name || ' (' || p.emp_id || ')' from public.staff_profiles p where p.user_id = auth.uid()
$$;
create or replace function app.stamp() returns text language sql stable set search_path = '' as $$
  select to_char(now() at time zone 'Asia/Phnom_Penh', 'YYYY-MM-DD HH24:MI')
$$;
create or replace function app.today() returns text language sql stable set search_path = '' as $$
  select to_char(now() at time zone 'Asia/Phnom_Penh', 'YYYY-MM-DD')
$$;
-- "Toul Kork", "Toul Kork Branch", "105", "BR-105", "105 Toul Kork" → comparable text
create or replace function app.norm(t text) returns text language sql immutable set search_path = '' as $$
  select regexp_replace(regexp_replace(lower(coalesce(t, '')), '\m(branch|br)\M', '', 'g'), '[^a-z0-9]', '', 'g')
$$;
create or replace function app.norm_serial(t text) returns text language sql immutable set search_path = '' as $$
  select nullif(upper(regexp_replace(coalesce(t, ''), '\s', '', 'g')), '')
$$;
revoke all on function app.role(), app.branch(), app.is_admin(), app.label(), app.stamp(), app.today(), app.norm(text), app.norm_serial(text) from public;
grant execute on function app.role(), app.branch(), app.is_admin(), app.label(), app.stamp(), app.today(), app.norm(text), app.norm_serial(text) to authenticated, service_role;

drop policy if exists staff_read on public.staff_profiles;
create policy staff_read on public.staff_profiles for select to authenticated using (user_id = auth.uid() or app.is_admin());
revoke all on public.staff_profiles from anon, authenticated;
grant select on public.staff_profiles to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Old "anyone can read/write" policies (already neutralised during the emergency lock-down): removed for good
-- ---------------------------------------------------------------------------------------------------------------------
drop policy if exists "Permissive read for audit_logs" on public.audit_logs;
drop policy if exists "Permissive write for audit_logs" on public.audit_logs;
drop policy if exists "Permissive read for all users" on public.branches;
drop policy if exists "Permissive write for all users" on public.branches;
drop policy if exists "Permissive read for devices" on public.devices;
drop policy if exists "Permissive write for devices" on public.devices;
drop policy if exists "Permissive read for historical_merchants" on public.historical_merchants;
drop policy if exists "Permissive write for historical_merchants" on public.historical_merchants;
drop policy if exists "Permissive read for requisitions" on public.requisitions;
drop policy if exists "Permissive write for requisitions" on public.requisitions;

revoke all on public.branches, public.devices, public.requisitions, public.historical_merchants, public.audit_logs from anon;
revoke truncate, trigger, references on public.branches, public.devices, public.requisitions, public.historical_merchants, public.audit_logs from authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Branches: everyone signed in reads; admins change
-- ---------------------------------------------------------------------------------------------------------------------
drop policy if exists branches_read on public.branches;
drop policy if exists branches_admin on public.branches;
create policy branches_read on public.branches for select to authenticated using (app.role() is not null);
create policy branches_admin on public.branches for all to authenticated using (app.is_admin()) with check (app.is_admin());

-- branch names as the phone app writes them (learned when an admin assigns the branch of a record)
create table if not exists public.branch_aliases (
  alias_norm text primary key,
  branch_id varchar(16) not null references public.branches(id) on update cascade on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.branch_aliases enable row level security;
drop policy if exists aliases_read on public.branch_aliases;
drop policy if exists aliases_admin on public.branch_aliases;
create policy aliases_read on public.branch_aliases for select to authenticated using (app.is_admin());
create policy aliases_admin on public.branch_aliases for all to authenticated using (app.is_admin()) with check (app.is_admin());
revoke all on public.branch_aliases from anon;

create or replace function app.resolve_branch(t text) returns varchar language plpgsql stable security definer set search_path = '' as $$
declare v_code text; v_id varchar;
begin
  if coalesce(trim(t), '') = '' then return null; end if;
  v_code := substring(t from '(\d{3})');                       -- "105", "BR-105", "105 Toul Kork"
  if v_code is not null then
    select b.id into v_id from public.branches b where b.id = v_code or b.code = v_code limit 1;
    if v_id is not null then return v_id; end if;
  end if;
  select a.branch_id into v_id from public.branch_aliases a where a.alias_norm = app.norm(t);
  if v_id is not null then return v_id; end if;
  select b.id into v_id from public.branches b where app.norm(b.name) = app.norm(t) limit 1;
  return v_id;
end $$;
revoke all on function app.resolve_branch(text) from public;
grant execute on function app.resolve_branch(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Devices: admins all; branch staff their own branch (cannot move a unit to another branch, rename or archive it)
-- ---------------------------------------------------------------------------------------------------------------------
drop policy if exists devices_read on public.devices;
drop policy if exists devices_insert on public.devices;
drop policy if exists devices_update on public.devices;
drop policy if exists devices_delete on public.devices;
create policy devices_read on public.devices for select to authenticated using (app.is_admin() or branch_id = app.branch());
create policy devices_insert on public.devices for insert to authenticated with check (app.is_admin());
create policy devices_update on public.devices for update to authenticated
  using (app.is_admin() or branch_id = app.branch()) with check (app.is_admin() or branch_id = app.branch());
create policy devices_delete on public.devices for delete to authenticated using (app.role() = 'SUPER_ADMIN');

create or replace function app.devices_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and auth.uid() is not null and not app.is_admin()
     and coalesce(current_setting('app.trusted_change', true), '') <> 'on' then
    if new.serial is distinct from old.serial or new.type is distinct from old.type
       or new.archived is distinct from old.archived or new.branch_id is distinct from old.branch_id then
      raise exception 'Branch staff cannot change the serial, type, branch or archive state of a device.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists devices_guard on public.devices;
create trigger devices_guard before insert or update on public.devices for each row execute function app.devices_guard();

-- ---------------------------------------------------------------------------------------------------------------------
-- Requisitions: branch staff file and see their own; admins all
-- ---------------------------------------------------------------------------------------------------------------------
drop policy if exists req_read on public.requisitions;
drop policy if exists req_insert on public.requisitions;
drop policy if exists req_update on public.requisitions;
drop policy if exists req_delete on public.requisitions;
create policy req_read on public.requisitions for select to authenticated using (app.is_admin() or branch_id = app.branch());
create policy req_insert on public.requisitions for insert to authenticated
  with check (app.is_admin() or (branch_id = app.branch() and status = 'PENDING_ADMIN'));
create policy req_update on public.requisitions for update to authenticated using (app.is_admin()) with check (app.is_admin());
create policy req_delete on public.requisitions for delete to authenticated using (app.role() = 'SUPER_ADMIN');

-- a branch confirms receipt of a dispatched request: only units in HQ stock or already sent to that branch move
create or replace function public.branch_confirm_receipt(p_req_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.requisitions; v_branch text := app.branch(); v_moved text[] := '{}'; v_skip text[] := '{}'; it jsonb; d public.devices;
begin
  if app.role() is null then raise exception 'Not signed in.' using errcode = '42501'; end if;
  perform set_config('app.trusted_change', 'on', true);             -- this function checks the branch itself
  select * into r from public.requisitions where req_id = p_req_id for update;
  if not found then raise exception 'Request % not found.', p_req_id; end if;
  if not app.is_admin() and r.branch_id is distinct from v_branch then raise exception 'This request belongs to another branch.' using errcode = '42501'; end if;
  if r.status <> 'DISPATCHED' then raise exception 'Request % is not dispatched (status %).', p_req_id, r.status; end if;
  for it in select * from jsonb_array_elements(coalesce(r.arranged_devices, '[]'::jsonb)) loop
    select * into d from public.devices where serial = it->>'serial' for update;
    if found and d.stage in ('HQ_STOCK', 'BRANCH_RESERVE') and (d.stage = 'HQ_STOCK' or d.branch_id = r.branch_id) then
      update public.devices set stage = 'BRANCH_RESERVE', branch_id = r.branch_id, branch_name = r.branch_name,
        mid = null, tid = null, merchant_name = null, merchant_phone = null,
        deployment_status = 'In-Stock (Reserve)', stock_status = 'In-Stock',
        history = jsonb_build_array(app.stamp() || ' | Received at Branch | Request ' || r.req_id || ' confirmed by ' || coalesce(app.label(), 'staff'))
                  || coalesce(history, '[]'::jsonb)
      where serial = d.serial;
      v_moved := v_moved || d.serial;
    else
      v_skip := v_skip || (it->>'serial');
    end if;
  end loop;
  update public.requisitions set status = 'RECEIVED', updated_at = now() where req_id = r.req_id;
  insert into public.audit_logs (title, detail, branch_id, action, target)
  values ('Stock Received', 'Request ' || r.req_id || ': ' || cardinality(v_moved) || ' unit(s) received'
          || case when cardinality(v_skip) > 0 then '; not moved (not in HQ stock): ' || array_to_string(v_skip, ', ') else '' end,
          r.branch_id, 'STOCK_RECEIVE', r.req_id);
  return jsonb_build_object('moved', to_jsonb(v_moved), 'skipped', to_jsonb(v_skip));
end $$;
revoke all on function public.branch_confirm_receipt(text) from public, anon;
grant execute on function public.branch_confirm_receipt(text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Merchant history (terminated / returned units)
-- ---------------------------------------------------------------------------------------------------------------------
drop policy if exists hist_read on public.historical_merchants;
drop policy if exists hist_insert on public.historical_merchants;
drop policy if exists hist_admin on public.historical_merchants;
drop policy if exists hist_delete on public.historical_merchants;
create policy hist_read on public.historical_merchants for select to authenticated using (app.is_admin() or branch_id = app.branch());
create policy hist_insert on public.historical_merchants for insert to authenticated with check (app.is_admin() or branch_id = app.branch());
create policy hist_admin on public.historical_merchants for update to authenticated using (app.is_admin()) with check (app.is_admin());
create policy hist_delete on public.historical_merchants for delete to authenticated using (app.role() = 'SUPER_ADMIN');

-- ---------------------------------------------------------------------------------------------------------------------
-- Audit log: the database stamps who and when; nobody can edit or delete an entry
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.audit_logs add column if not exists actor_id uuid;
alter table public.audit_logs add column if not exists actor_emp text;
alter table public.audit_logs add column if not exists actor_name text;
alter table public.audit_logs add column if not exists action text;
alter table public.audit_logs add column if not exists target text;
create index if not exists idx_audit_logs_action on public.audit_logs(action);

create or replace function app.audit_stamp() returns trigger language plpgsql security definer set search_path = '' as $$
declare p public.staff_profiles;
begin
  new.created_at := now();
  new.actor_id := auth.uid();
  if new.actor_id is not null then
    select * into p from public.staff_profiles where user_id = new.actor_id;
    new.actor_emp := p.emp_id; new.actor_name := p.name; new.role := p.role;
    if new.branch_id is null then new.branch_id := p.branch_id; end if;
  elsif new.actor_name is null then
    new.actor_name := 'System';
  end if;
  return new;
end $$;
drop trigger if exists audit_stamp on public.audit_logs;
create trigger audit_stamp before insert on public.audit_logs for each row execute function app.audit_stamp();

drop policy if exists audit_read on public.audit_logs;
drop policy if exists audit_insert on public.audit_logs;
create policy audit_read on public.audit_logs for select to authenticated using (app.is_admin() or branch_id = app.branch());
create policy audit_insert on public.audit_logs for insert to authenticated with check (app.role() is not null);
revoke update, delete on public.audit_logs from authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Records from the Merchant Visit phone app, waiting for an admin's review
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.field_events (
  id bigint generated always as identity primary key,
  source_record_id text not null,                 -- the phone app's Record ID (POS-…, SB-…, BAT-…, SBM-…)
  unit_no int not null default 1,                 -- Device No within the entry
  revision int not null default 1,                -- an entry edited after review arrives as a new revision
  kind text not null check (kind in ('INSTALL', 'REPLACE', 'BATTERY', 'SB_MAINT', 'SB_RETURN')),
  device_type text not null check (device_type in ('POS Terminal', 'Sound Box')),
  serial text not null,
  old_serial text,
  old_battery text,
  new_battery text,
  mid text,
  tid text,
  terminal_name text,
  outlet_name text,
  branch_text text,
  branch_id varchar(16) references public.branches(id) on update cascade,
  staff_id text,
  staff_name text,
  recorded_at timestamptz not null,
  latitude double precision,
  longitude double precision,
  remarks text,
  payload jsonb not null default '{}'::jsonb,
  payload_hash text not null,
  issues jsonb not null default '[]'::jsonb,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'CANCELLED')),
  reviewed_by uuid,
  reviewed_by_name text,
  reviewed_at timestamptz,
  review_note text,
  applied jsonb,
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_record_id, unit_no, revision)
);
create index if not exists idx_field_events_status on public.field_events(status, received_at desc);
create index if not exists idx_field_events_serial on public.field_events(serial);
create index if not exists idx_field_events_branch on public.field_events(branch_id);
alter table public.field_events enable row level security;
drop policy if exists fe_read on public.field_events;
create policy fe_read on public.field_events for select to authenticated using (app.is_admin() or branch_id = app.branch());
revoke all on public.field_events from anon, authenticated;
grant select on public.field_events to authenticated;

-- What is wrong with a serial for this kind of record (shown to the field staff, and to the admin who reviews)
-- level 'block' = cannot be applied as it is; 'warn' = the admin decides
create or replace function app.field_issues(p_kind text, p_type text, p_serial text, p_old text, p_mid text, p_tid text,
                                            p_branch varchar, p_record text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb := '[]'::jsonb; d public.devices; o public.devices; x public.devices; v_dup int;
begin
  if p_serial is null then
    return jsonb_build_array(jsonb_build_object('code', 'SERIAL_MISSING', 'level', 'block', 'text', 'No serial number was recorded.'));
  end if;
  select * into d from public.devices where upper(serial) = p_serial;
  if not found then
    v := v || jsonb_build_object('code', 'SERIAL_UNKNOWN', 'level', 'block', 'text', 'Serial ' || p_serial || ' is not in the inventory.');
  else
    if d.type <> p_type then
      v := v || jsonb_build_object('code', 'TYPE_MISMATCH', 'level', 'block', 'text', 'Serial ' || p_serial || ' is a ' || d.type || ' in the inventory, not a ' || p_type || '.');
    end if;
    if coalesce(d.archived, false) then
      v := v || jsonb_build_object('code', 'ARCHIVED', 'level', 'warn', 'text', 'Serial ' || p_serial || ' is archived.');
    end if;
    if p_kind in ('INSTALL', 'REPLACE') then
      if d.stage = 'COMPLETE' and coalesce(d.mid, '') <> coalesce(p_mid, '') then
        v := v || jsonb_build_object('code', 'ALREADY_INSTALLED', 'level', 'warn',
          'text', 'Serial ' || p_serial || ' is already installed at ' || coalesce(nullif(d.merchant_name, ''), 'another merchant') || ' (MID ' || coalesce(d.mid, '—') || ').');
      elsif d.stage in ('FAULTY', 'LOST') then
        v := v || jsonb_build_object('code', 'DEVICE_' || d.stage, 'level', 'warn', 'text', 'Serial ' || p_serial || ' is marked ' || initcap(d.stage) || ' in the inventory.');
      elsif d.stage = 'HQ_STOCK' then
        v := v || jsonb_build_object('code', 'NOT_DISPATCHED', 'level', 'warn', 'text', 'Serial ' || p_serial || ' is still in HQ stock (not yet sent to a branch).');
      end if;
      if p_branch is not null and d.stage <> 'HQ_STOCK' and d.branch_id is distinct from p_branch then
        v := v || jsonb_build_object('code', 'OTHER_BRANCH', 'level', 'warn',
          'text', 'Serial ' || p_serial || ' belongs to ' || coalesce(d.branch_name, 'branch ' || d.branch_id) || ', not this staff member''s branch.');
      end if;
      if coalesce(p_tid, '') <> '' then
        select * into x from public.devices where tid = p_tid and stage = 'COMPLETE' and upper(serial) <> p_serial
          and (p_old is null or upper(serial) <> p_old) limit 1;
        if found then
          v := v || jsonb_build_object('code', 'TID_IN_USE', 'level', 'warn', 'text', 'TID ' || p_tid || ' is already used by serial ' || x.serial || '.');
        end if;
      end if;
    else
      if d.stage <> 'COMPLETE' then
        v := v || jsonb_build_object('code', 'NOT_INSTALLED', 'level', 'warn', 'text', 'Serial ' || p_serial || ' is not installed at a merchant in the inventory (' || initcap(replace(d.stage, '_', ' ')) || ').');
      end if;
      if p_kind = 'BATTERY' and coalesce(p_tid, '') <> '' and coalesce(d.tid, '') <> '' and d.tid <> p_tid then
        v := v || jsonb_build_object('code', 'TID_MISMATCH', 'level', 'warn', 'text', 'The inventory has TID ' || d.tid || ' for serial ' || p_serial || ', not ' || p_tid || '.');
      end if;
      if p_kind in ('SB_MAINT', 'SB_RETURN') and coalesce(p_mid, '') <> '' and coalesce(d.mid, '') <> '' and d.mid <> p_mid then
        v := v || jsonb_build_object('code', 'MID_MISMATCH', 'level', 'warn', 'text', 'The inventory has MID ' || d.mid || ' for SN ' || p_serial || ', not ' || p_mid || '.');
      end if;
    end if;
  end if;
  if p_kind = 'REPLACE' then
    if p_old is null then
      v := v || jsonb_build_object('code', 'OLD_SERIAL_MISSING', 'level', 'warn', 'text', 'The serial of the device taken out was not recorded.');
    elsif p_old = p_serial then
      v := v || jsonb_build_object('code', 'SAME_SERIAL', 'level', 'block', 'text', 'The old and the new serial are the same.');
    else
      select * into o from public.devices where upper(serial) = p_old;
      if not found then
        v := v || jsonb_build_object('code', 'OLD_SERIAL_UNKNOWN', 'level', 'warn', 'text', 'Old serial ' || p_old || ' is not in the inventory.');
      elsif o.stage <> 'COMPLETE' then
        v := v || jsonb_build_object('code', 'OLD_NOT_INSTALLED', 'level', 'warn', 'text', 'Old serial ' || p_old || ' is not installed at a merchant in the inventory.');
      end if;
    end if;
  end if;
  if p_kind in ('INSTALL', 'REPLACE') and p_branch is null then
    v := v || jsonb_build_object('code', 'BRANCH_UNKNOWN', 'level', 'warn', 'text', 'The staff member''s branch could not be matched to an inventory branch.');
  end if;
  select count(*) into v_dup from public.field_events e
   where e.status = 'PENDING' and upper(e.serial) = p_serial and (p_record is null or e.source_record_id <> p_record);
  if v_dup > 0 then
    v := v || jsonb_build_object('code', 'DUPLICATE_PENDING', 'level', 'warn', 'text', 'Another record for serial ' || p_serial || ' is waiting for review.');
  end if;
  return v;
end $$;
revoke all on function app.field_issues(text, text, text, text, text, text, varchar, text) from public;
grant execute on function app.field_issues(text, text, text, text, text, text, varchar, text) to authenticated, service_role;

-- The phone app asks while staff fill the form: what is wrong with this serial? (service key only, from Apps Script)
create or replace function public.field_check_serial(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_kind text := upper(coalesce(p->>'kind', 'INSTALL')); v_serial text := app.norm_serial(p->>'serial');
  v_old text := app.norm_serial(p->>'old_serial'); v_branch varchar := app.resolve_branch(p->>'branch');
  d public.devices; v_type text := coalesce(p->>'device_type', 'POS Terminal');
begin
  if v_kind not in ('INSTALL', 'REPLACE', 'BATTERY', 'SB_MAINT', 'SB_RETURN') then raise exception 'Unknown kind %', v_kind; end if;
  select * into d from public.devices where upper(serial) = v_serial;
  return jsonb_build_object(
    'serial', v_serial,
    'found', found,
    'stage', d.stage,
    'branch', d.branch_name,
    'issues', app.field_issues(v_kind, v_type, v_serial, v_old, p->>'mid', p->>'tid', v_branch, p->>'record_id'));
end $$;

-- The phone app sends one saved (or edited, or deleted) entry with all its devices. Idempotent: sending the same entry
-- again changes nothing; an edit updates a record still waiting, or adds a new revision of one already reviewed.
create or replace function public.field_sync_record(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rec text := nullif(trim(p->>'record_id'), ''); u jsonb; v_out jsonb := '[]'::jsonb; v_units int[] := '{}';
  v_kind text; v_type text; v_serial text; v_old text; v_branch varchar; v_hash text; v_issues jsonb; v_unit int;
  cur public.field_events; v_has boolean; v_id bigint; v_status text; v_at timestamptz;
begin
  if v_rec is null then raise exception 'record_id is required'; end if;
  if coalesce((p->>'deleted')::boolean, false) then
    update public.field_events set status = 'CANCELLED', updated_at = now(), review_note = coalesce(review_note, 'Deleted in the phone app')
     where source_record_id = v_rec and status = 'PENDING';
    return jsonb_build_object('record_id', v_rec, 'cancelled', true);
  end if;
  v_branch := app.resolve_branch(p->>'branch');
  for u in select * from jsonb_array_elements(coalesce(p->'units', '[]'::jsonb)) loop
    v_unit := coalesce((u->>'unit_no')::int, 1);
    v_units := v_units || v_unit;
    v_kind := upper(coalesce(u->>'kind', p->>'kind'));
    if v_kind not in ('INSTALL', 'REPLACE', 'BATTERY', 'SB_MAINT', 'SB_RETURN') then raise exception 'Unknown kind % in %', v_kind, v_rec; end if;
    v_type := coalesce(u->>'device_type', p->>'device_type');
    if v_type not in ('POS Terminal', 'Sound Box') then raise exception 'Unknown device type % in %', v_type, v_rec; end if;
    v_serial := app.norm_serial(u->>'serial');
    v_old := app.norm_serial(u->>'old_serial');
    v_at := coalesce((p->>'recorded_at')::timestamptz, now());
    v_hash := md5(jsonb_build_object('p', p - 'units' - 'sent_at', 'u', u)::text);
    select * into cur from public.field_events where source_record_id = v_rec and unit_no = v_unit order by revision desc limit 1;
    v_has := found;
    if v_has and cur.payload_hash = v_hash then                       -- the same entry sent again
      v_out := v_out || jsonb_build_object('unit_no', v_unit, 'id', cur.id, 'status', cur.status, 'issues', cur.issues, 'unchanged', true);
      continue;
    end if;
    v_issues := app.field_issues(v_kind, v_type, v_serial, v_old, u->>'mid', u->>'tid', v_branch, v_rec);
    if v_has and cur.status = 'PENDING' then                          -- edited before review: updated in place
      update public.field_events set kind = v_kind, device_type = v_type, serial = coalesce(v_serial, ''), old_serial = v_old,
        old_battery = app.norm_serial(u->>'old_battery'), new_battery = app.norm_serial(u->>'new_battery'),
        mid = nullif(trim(u->>'mid'), ''), tid = nullif(trim(u->>'tid'), ''), terminal_name = nullif(trim(u->>'terminal_name'), ''),
        outlet_name = nullif(trim(p->>'outlet_name'), ''), branch_text = p->>'branch', branch_id = v_branch,
        staff_id = p->>'staff_id', staff_name = p->>'staff_name', recorded_at = v_at,
        latitude = (p->>'latitude')::double precision, longitude = (p->>'longitude')::double precision,
        remarks = coalesce(u->>'remarks', p->>'remarks'), payload = jsonb_build_object('entry', p - 'units', 'unit', u),
        payload_hash = v_hash, issues = v_issues, updated_at = now()
      where id = cur.id;
      v_id := cur.id; v_status := 'PENDING';
    else
      if v_has and cur.status = 'APPROVED' then
        v_issues := v_issues || jsonb_build_object('code', 'EDITED_AFTER_REVIEW', 'level', 'warn',
          'text', 'This entry was edited in the phone app after revision ' || cur.revision || ' was approved.');
      end if;
      insert into public.field_events (source_record_id, unit_no, revision, kind, device_type, serial, old_serial, old_battery, new_battery,
        mid, tid, terminal_name, outlet_name, branch_text, branch_id, staff_id, staff_name, recorded_at, latitude, longitude, remarks,
        payload, payload_hash, issues)
      values (v_rec, v_unit, case when v_has then cur.revision + 1 else 1 end, v_kind, v_type, coalesce(v_serial, ''), v_old,
        app.norm_serial(u->>'old_battery'), app.norm_serial(u->>'new_battery'),
        nullif(trim(u->>'mid'), ''), nullif(trim(u->>'tid'), ''), nullif(trim(u->>'terminal_name'), ''), nullif(trim(p->>'outlet_name'), ''),
        p->>'branch', v_branch, p->>'staff_id', p->>'staff_name', v_at,
        (p->>'latitude')::double precision, (p->>'longitude')::double precision, coalesce(u->>'remarks', p->>'remarks'),
        jsonb_build_object('entry', p - 'units', 'unit', u), v_hash, v_issues)
      returning id into v_id;
      v_status := 'PENDING';
    end if;
    v_out := v_out || jsonb_build_object('unit_no', v_unit, 'id', v_id, 'status', v_status, 'issues', v_issues);
  end loop;
  -- devices removed from the entry while still waiting: withdrawn
  update public.field_events set status = 'CANCELLED', updated_at = now(), review_note = 'Removed from the entry in the phone app'
   where source_record_id = v_rec and status = 'PENDING' and not (unit_no = any(v_units));
  return jsonb_build_object('record_id', v_rec, 'units', v_out);
end $$;

revoke all on function public.field_check_serial(jsonb), public.field_sync_record(jsonb) from public, anon, authenticated;
grant execute on function public.field_check_serial(jsonb), public.field_sync_record(jsonb) to service_role;

-- An admin approves a record: the stock is updated in one step (or nothing is, on any error)
-- p_opt: { "branch_id": "105" (when the branch was not matched), "return_stage": "FAULTY" | "BRANCH_RESERVE" (the unit taken
--          out / returned), "acknowledge": true (required when the record has warnings) }
create or replace function public.field_approve(p_id bigint, p_note text default null, p_opt jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.field_events; d public.devices; o public.devices; v_issues jsonb; v_block jsonb; v_branch varchar; v_bname text;
  v_ret text := coalesce(p_opt->>'return_stage', ''); v_day text; v_who text; v_line text; v_applied jsonb := '{}'::jsonb;
  v_merchant text; v_rid text;
begin
  if not app.is_admin() then raise exception 'Only an admin can approve phone app records.' using errcode = '42501'; end if;
  select * into e from public.field_events where id = p_id for update;
  if not found then raise exception 'Record % not found.', p_id; end if;
  if e.status <> 'PENDING' then raise exception 'This record was already %.', lower(e.status); end if;

  v_branch := coalesce(nullif(p_opt->>'branch_id', ''), e.branch_id);
  if v_branch is not null then
    select name into v_bname from public.branches where id = v_branch;
    if v_bname is null then raise exception 'Branch % does not exist.', v_branch; end if;
    if e.branch_id is null and coalesce(e.branch_text, '') <> '' then        -- remember the phone app's spelling of this branch
      insert into public.branch_aliases (alias_norm, branch_id) values (app.norm(e.branch_text), v_branch)
      on conflict (alias_norm) do update set branch_id = excluded.branch_id;
    end if;
  end if;

  -- checked again now: the stock may have changed since the record arrived
  v_issues := app.field_issues(e.kind, e.device_type, e.serial, e.old_serial, e.mid, e.tid, v_branch, e.source_record_id);
  select coalesce(jsonb_agg(i), '[]'::jsonb) into v_block from jsonb_array_elements(v_issues) i where i->>'level' = 'block';
  if jsonb_array_length(v_block) > 0 then
    raise exception 'Cannot approve: %', (select string_agg(i->>'text', ' ') from jsonb_array_elements(v_block) i);
  end if;
  if jsonb_array_length(v_issues) > 0 and not coalesce((p_opt->>'acknowledge')::boolean, false) then
    raise exception 'This record has warnings. Review them and confirm to approve.';
  end if;
  if e.kind in ('INSTALL', 'REPLACE') and v_branch is null then
    raise exception 'Choose the branch of this record before approving.';
  end if;

  v_day := to_char(e.recorded_at at time zone 'Asia/Phnom_Penh', 'YYYY-MM-DD');
  v_who := coalesce(e.staff_name, '') || case when coalesce(e.staff_id, '') <> '' then ' (' || e.staff_id || ')' else '' end;
  v_rid := e.source_record_id || case when e.unit_no > 1 then ' #' || e.unit_no else '' end;
  v_merchant := coalesce(e.outlet_name, e.terminal_name);
  select * into d from public.devices where upper(serial) = e.serial for update;

  if e.kind in ('INSTALL', 'REPLACE') then
    if e.kind = 'REPLACE' and e.old_serial is not null then
      select * into o from public.devices where upper(serial) = e.old_serial for update;
      if found then
        if v_ret = '' then v_ret := 'FAULTY'; end if;
        if v_ret not in ('FAULTY', 'BRANCH_RESERVE', 'HQ_STOCK') then raise exception 'Return stage % is not allowed.', v_ret; end if;
        if o.stage = 'COMPLETE' and coalesce(o.mid, '') <> '' then
          insert into public.historical_merchants (record_id, merchant_name, merchant_phone, address, mid, tid, device_type, model, serial,
            battery_serial, branch_id, branch_name, installed_date, returned_date, active_duration_months, return_reason, status, handled_by_staff, notes)
          values ('HM-' || e.id, coalesce(nullif(o.merchant_name, ''), v_merchant, 'Merchant'), o.merchant_phone, o.address, o.mid, coalesce(o.tid, ''),
            o.type, o.model, o.serial, o.battery_serial, o.branch_id, o.branch_name,
            case when o.deployed_date ~ '^\d{4}-\d{2}-\d{2}' then left(o.deployed_date, 10)::date end, v_day::date,
            greatest(1, case when o.deployed_date ~ '^\d{4}-\d{2}-\d{2}' then ((v_day::date - left(o.deployed_date, 10)::date) / 30) else 1 end),
            'Replaced by ' || e.serial || ' (' || v_rid || ')', 'RETURNED', v_who, e.remarks)
          on conflict (record_id) do nothing;
        end if;
        update public.devices set stage = v_ret, mid = null, tid = null, merchant_name = null, merchant_phone = null,
          return_reason = 'Replaced by ' || e.serial || ' on ' || v_day,
          deployment_status = case when v_ret = 'FAULTY' then 'Faulty / Repair' else 'In-Stock (Reserve)' end,
          stock_status = case when v_ret = 'FAULTY' then 'Faulty' else 'In-Stock' end,
          custom_fields = coalesce(custom_fields, '{}'::jsonb) || jsonb_build_object('returnedByStaff', v_who, 'returnedDate', v_day),
          history = jsonb_build_array(app.stamp() || ' | Replaced at Merchant | Taken out at ' || coalesce(o.merchant_name, v_merchant, 'merchant')
                    || ' (MID ' || coalesce(o.mid, '—') || '), replaced by ' || e.serial || ' → ' || initcap(replace(v_ret, '_', ' '))
                    || ' · ' || v_rid || ' by ' || v_who) || coalesce(history, '[]'::jsonb)
        where serial = o.serial;
        v_applied := v_applied || jsonb_build_object('old_serial', o.serial, 'old_stage', o.stage, 'old_new_stage', v_ret);
      end if;
    end if;
    v_line := app.stamp() || ' | ' || case when e.kind = 'REPLACE' then 'Installed (Replacement)' else 'Installed at Merchant' end
      || ' | ' || coalesce(v_merchant, 'Merchant') || ' · MID ' || coalesce(e.mid, '—') || ' · TID ' || coalesce(e.tid, '—')
      || case when e.kind = 'REPLACE' and e.old_serial is not null then ' · replaces ' || e.old_serial else '' end
      || ' · ' || v_rid || ' by ' || v_who;
    update public.devices set stage = 'COMPLETE', mid = e.mid, tid = e.tid, merchant_name = v_merchant,
      branch_id = v_branch, branch_name = v_bname, deployed_date = v_day, staff = v_who,
      deployment_status = 'Deployed', stock_status = 'At Merchant', return_reason = null, archived = false,
      redeploy_count = coalesce(redeploy_count, 0) + case when coalesce(deployed_date, '') <> '' then 1 else 0 end,
      custom_fields = coalesce(custom_fields, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'terminalName', e.terminal_name, 'installedByStaff', case when e.kind = 'INSTALL' then v_who end,
        'replacedByStaff', case when e.kind = 'REPLACE' then v_who end,
        'replacedFromSerial', case when e.kind = 'REPLACE' then e.old_serial end,
        'replacementDate', case when e.kind = 'REPLACE' then v_day end,
        'latitude', e.latitude, 'longitude', e.longitude)),
      history = jsonb_build_array(v_line) || coalesce(history, '[]'::jsonb)
    where serial = d.serial;
    v_applied := v_applied || jsonb_build_object('serial', d.serial, 'from_stage', d.stage, 'to_stage', 'COMPLETE', 'branch_id', v_branch);

  elsif e.kind = 'BATTERY' then
    update public.devices set battery_serial = coalesce(e.new_battery, battery_serial), battery_installed_date = v_day,
      history = jsonb_build_array(app.stamp() || ' | Battery Replacement | New battery ' || coalesce(e.new_battery, '—')
                || ' (replaced ' || coalesce(e.old_battery, d.battery_serial, '—') || ') · 24-month cycle restarted · ' || v_rid || ' by ' || v_who)
                || coalesce(history, '[]'::jsonb)
    where serial = d.serial;
    v_applied := jsonb_build_object('serial', d.serial, 'battery_from', d.battery_serial, 'battery_to', e.new_battery, 'battery_date', v_day);

  elsif e.kind = 'SB_MAINT' then
    update public.devices set
      history = jsonb_build_array(app.stamp() || ' | Sound Box Maintenance | ' || coalesce(nullif(e.remarks, ''), 'Maintenance done')
                || ' · ' || v_rid || ' by ' || v_who) || coalesce(history, '[]'::jsonb)
    where serial = d.serial;
    v_applied := jsonb_build_object('serial', d.serial, 'maintenance', v_day);

  elsif e.kind = 'SB_RETURN' then
    if v_ret = '' then v_ret := 'BRANCH_RESERVE'; end if;
    if v_ret not in ('FAULTY', 'BRANCH_RESERVE', 'HQ_STOCK') then raise exception 'Return stage % is not allowed.', v_ret; end if;
    if d.stage = 'COMPLETE' and coalesce(d.mid, '') <> '' then
      insert into public.historical_merchants (record_id, merchant_name, merchant_phone, address, mid, tid, device_type, model, serial,
        battery_serial, branch_id, branch_name, installed_date, returned_date, active_duration_months, return_reason, status, handled_by_staff, notes)
      values ('HM-' || e.id, coalesce(nullif(d.merchant_name, ''), v_merchant, 'Merchant'), d.merchant_phone, d.address, d.mid, coalesce(d.tid, ''),
        d.type, d.model, d.serial, d.battery_serial, d.branch_id, d.branch_name,
        case when d.deployed_date ~ '^\d{4}-\d{2}-\d{2}' then left(d.deployed_date, 10)::date end, v_day::date,
        greatest(1, case when d.deployed_date ~ '^\d{4}-\d{2}-\d{2}' then ((v_day::date - left(d.deployed_date, 10)::date) / 30) else 1 end),
        coalesce(nullif(e.remarks, ''), 'Merchant returned the sound box'), 'TERMINATED', v_who, v_rid)
      on conflict (record_id) do nothing;
    end if;
    update public.devices set stage = v_ret, mid = null, tid = null, merchant_name = null, merchant_phone = null,
      return_reason = coalesce(nullif(e.remarks, ''), 'Returned to bank'),
      deployment_status = case when v_ret = 'FAULTY' then 'Faulty / Repair' else 'In-Stock (Reserve)' end,
      stock_status = case when v_ret = 'FAULTY' then 'Faulty' else 'In-Stock' end,
      custom_fields = coalesce(custom_fields, '{}'::jsonb) || jsonb_build_object('returnedByStaff', v_who, 'returnedDate', v_day),
      history = jsonb_build_array(app.stamp() || ' | Returned to Bank | ' || coalesce(d.merchant_name, 'Merchant') || ' (MID ' || coalesce(d.mid, '—')
                || ') returned the sound box → ' || initcap(replace(v_ret, '_', ' ')) || ' · ' || v_rid || ' by ' || v_who) || coalesce(history, '[]'::jsonb)
    where serial = d.serial;
    v_applied := jsonb_build_object('serial', d.serial, 'from_stage', d.stage, 'to_stage', v_ret);
  end if;

  update public.field_events set status = 'APPROVED', reviewed_by = auth.uid(), reviewed_by_name = app.label(), reviewed_at = now(),
    review_note = nullif(trim(coalesce(p_note, '')), ''), applied = v_applied, issues = v_issues, branch_id = coalesce(v_branch, branch_id),
    updated_at = now()
  where id = e.id;
  -- older revisions of the same device of this entry are no longer relevant
  update public.field_events set status = 'SUPERSEDED', updated_at = now()
   where source_record_id = e.source_record_id and unit_no = e.unit_no and revision < e.revision and status = 'PENDING';
  insert into public.audit_logs (title, detail, branch_id, action, target)
  values ('Phone Record Approved', initcap(replace(e.kind, '_', ' ')) || ' · ' || e.serial || ' · ' || v_rid
          || case when nullif(trim(coalesce(p_note, '')), '') is not null then ' · Note: ' || trim(p_note) else '' end,
          coalesce(v_branch, e.branch_id), 'FIELD_APPROVE', e.serial);
  return jsonb_build_object('id', e.id, 'status', 'APPROVED', 'applied', v_applied);
end $$;

create or replace function public.field_reject(p_id bigint, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.field_events;
begin
  if not app.is_admin() then raise exception 'Only an admin can reject phone app records.' using errcode = '42501'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Give the reason for rejecting.'; end if;
  select * into e from public.field_events where id = p_id for update;
  if not found then raise exception 'Record % not found.', p_id; end if;
  if e.status <> 'PENDING' then raise exception 'This record was already %.', lower(e.status); end if;
  update public.field_events set status = 'REJECTED', reviewed_by = auth.uid(), reviewed_by_name = app.label(), reviewed_at = now(),
    review_note = trim(p_note), updated_at = now() where id = p_id;
  insert into public.audit_logs (title, detail, branch_id, action, target)
  values ('Phone Record Rejected', initcap(replace(e.kind, '_', ' ')) || ' · ' || e.serial || ' · ' || e.source_record_id || ' · Reason: ' || trim(p_note),
          e.branch_id, 'FIELD_REJECT', e.serial);
  return jsonb_build_object('id', p_id, 'status', 'REJECTED');
end $$;

-- the warnings of a waiting record, checked against the stock as it is now (shown when the admin opens it)
create or replace function public.field_recheck(p_id bigint, p_branch varchar default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.field_events;
begin
  if not app.is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  select * into e from public.field_events where id = p_id;
  if not found then raise exception 'Record % not found.', p_id; end if;
  return app.field_issues(e.kind, e.device_type, e.serial, e.old_serial, e.mid, e.tid, coalesce(p_branch, e.branch_id), e.source_record_id);
end $$;

revoke all on function public.field_approve(bigint, text, jsonb), public.field_reject(bigint, text), public.field_recheck(bigint, varchar) from public, anon;
grant execute on function public.field_approve(bigint, text, jsonb), public.field_reject(bigint, text), public.field_recheck(bigint, varchar) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Account management (Accounts & Access): sign-in = employee ID + password
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.login_email(p_emp text) returns text language sql immutable set search_path = '' as $$
  select lower(regexp_replace(trim(p_emp), '[^A-Za-z0-9._-]', '', 'g')) || '@staff.pos-sb-inventory.internal'
$$;
grant execute on function app.login_email(text) to authenticated, service_role;

create or replace function public.admin_save_staff(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me public.staff_profiles; cur public.staff_profiles; v_emp text := trim(coalesce(p->>'emp_id', ''));
  v_role text := upper(coalesce(p->>'role', 'BRANCH')); v_pw text := p->>'password'; v_uid uuid; v_email text;
  v_active boolean := coalesce((p->>'active')::boolean, true); v_supers int;
begin
  select * into me from public.staff_profiles where user_id = auth.uid() and active;
  if not found or me.role not in ('SUPER_ADMIN', 'ADMIN') then raise exception 'Only an admin can manage accounts.' using errcode = '42501'; end if;
  if v_emp !~ '^[A-Za-z0-9._-]{2,32}$' then raise exception 'Employee ID must be 2–32 letters or digits.'; end if;
  if v_role not in ('SUPER_ADMIN', 'ADMIN', 'BRANCH') then raise exception 'Unknown role %.', v_role; end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Name is required.'; end if;
  if not exists (select 1 from public.branches where id = p->>'branch_id') then raise exception 'Branch % does not exist.', p->>'branch_id'; end if;
  select * into cur from public.staff_profiles where lower(emp_id) = lower(v_emp);
  if me.role = 'ADMIN' and (v_role <> 'BRANCH' or (cur.user_id is not null and cur.role <> 'BRANCH')) then
    raise exception 'Only a Super Admin can create or change admin accounts.' using errcode = '42501';
  end if;
  if cur.user_id = me.user_id and (v_role <> me.role or not v_active) then
    raise exception 'You cannot change your own role or deactivate your own account.' using errcode = '42501';
  end if;
  if v_pw is not null and length(v_pw) < 8 then raise exception 'The password must be at least 8 characters.'; end if;

  if cur.user_id is null then
    if v_pw is null then raise exception 'Set a first password for the new account.'; end if;
    v_email := app.login_email(v_emp);
    if exists (select 1 from auth.users where email = v_email) then raise exception 'A sign-in for % already exists.', v_emp; end if;
    v_uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
      extensions.crypt(v_pw, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('emp_id', v_emp), now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_uid, jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
      'email', v_uid::text, null, now(), now());
    insert into public.staff_profiles (user_id, emp_id, name, role, branch_id, position, contact, active, must_change_password)
    values (v_uid, v_emp, trim(p->>'name'), v_role, p->>'branch_id', p->>'position', p->>'contact', v_active, true);
  else
    v_uid := cur.user_id;
    update public.staff_profiles set name = trim(p->>'name'), role = v_role, branch_id = p->>'branch_id', position = p->>'position',
      contact = p->>'contact', active = v_active, updated_at = now(),
      must_change_password = case when v_pw is not null then true else must_change_password end
    where user_id = v_uid;
    if v_pw is not null then
      update auth.users set encrypted_password = extensions.crypt(v_pw, extensions.gen_salt('bf')), updated_at = now() where id = v_uid;
    end if;
  end if;
  -- an inactive account cannot sign in at all
  update auth.users set banned_until = case when v_active then null else now() + interval '100 years' end where id = v_uid;
  select count(*) into v_supers from public.staff_profiles where role = 'SUPER_ADMIN' and active;
  if v_supers = 0 then raise exception 'At least one active Super Admin must remain.'; end if;
  insert into public.audit_logs (title, detail, branch_id, action, target)
  values (case when cur.user_id is null then 'Account Created' else 'Account Updated' end,
          v_emp || ' · ' || trim(p->>'name') || ' · ' || v_role || ' · Branch ' || (p->>'branch_id') || case when v_active then '' else ' · DEACTIVATED' end
          || case when v_pw is not null then ' · password set' else '' end,
          p->>'branch_id', 'USER_UPDATE', v_emp);
  return (select to_jsonb(s) from public.staff_profiles s where user_id = v_uid);
end $$;
revoke all on function public.admin_save_staff(jsonb) from public, anon;
grant execute on function public.admin_save_staff(jsonb) to authenticated;

-- after the staff member chose their own password (supabase.auth.updateUser)
create or replace function public.password_changed() returns void language sql security definer set search_path = '' as $$
  update public.staff_profiles set must_change_password = false, updated_at = now() where user_id = auth.uid();
$$;
revoke all on function public.password_changed() from public, anon;
grant execute on function public.password_changed() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Live updates in the dashboard
-- ---------------------------------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'field_events') then
    alter publication supabase_realtime add table public.field_events;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'audit_logs') then
    alter publication supabase_realtime add table public.audit_logs;
  end if;
end $$;

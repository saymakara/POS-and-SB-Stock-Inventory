-- 22 Oct 2026 (part 4): a pending stock request can be edited by HQ or by the branch that made it.
-- Quantity, reason and requester can change only while the request is still pending; status, units, type and branch
-- keep their existing protection.
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
  if (new.pos_qty is distinct from old.pos_qty or new.sb_qty is distinct from old.sb_qty
      or new.reason is distinct from old.reason or new.staff is distinct from old.staff) then
    if old.status <> 'PENDING_ADMIN' then
      raise exception 'A request can be edited only while it is pending.' using errcode = '42501';
    end if;
    if coalesce(new.pos_qty, 0) + coalesce(new.sb_qty, 0) <= 0 then
      raise exception 'Enter at least one POS Terminal or Sound Box.' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'requisitions' and policyname = 'req_update_own') then
    create policy req_update_own on public.requisitions for update to authenticated
      using (branch_id = app.branch() and status = 'PENDING_ADMIN' and coalesce(type, 'STOCK_REQUEST') = 'STOCK_REQUEST')
      with check (branch_id = app.branch() and status = 'PENDING_ADMIN' and coalesce(type, 'STOCK_REQUEST') = 'STOCK_REQUEST');
  end if;
end $$;

-- Branch staff cannot change the merchant details of a unit that stays installed (HQ admins can). Moving a unit
-- (return, terminate, replace) and adding details while installing are not affected.
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
    if old.stage = 'COMPLETE' and new.stage = 'COMPLETE'
       and (coalesce(old.mid, '') <> '' or coalesce(old.merchant_name, '') <> '')
       and (new.mid is distinct from old.mid or new.tid is distinct from old.tid
            or new.merchant_name is distinct from old.merchant_name or new.merchant_phone is distinct from old.merchant_phone
            or new.address is distinct from old.address) then
      raise exception 'The merchant details of an installed unit can be changed by Admin HQ only.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- The only Sound Box model is Q161 Pro
update public.devices set model = 'Q161 Pro' where type = 'Sound Box' and model is distinct from 'Q161 Pro';

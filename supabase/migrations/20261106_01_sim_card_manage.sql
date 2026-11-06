-- 06 Nov 2026 · Manage SIM (portal, SIM Card page) and Battery for Sound Box.  Run once in the SQL Editor; safe to run again.
-- Needs 20261105_01_materials_and_kits.sql (applied 5 Nov 2026).
--
-- admin_sim_update(p jsonb): Admin HQ changes one SIM from the Manage SIM panel. It follows the same stock rules as the
-- rest of the materials:
--   * SIM numbers are written the portal's way (012 345 678), so "012345678" and "+855 12 345 678" are the same SIM.
--   * A SIM put in a unit at a merchant goes into that merchant's kit (the Merchant Kit card shows it). A SIM already in
--     that kit is returned to the branch reserve. A SIM that is not registered yet can be recorded only this way
--     (a SIM already at a merchant before the register existed); new SIMs for stock go through Stock In.
--   * Back to Branch Reserve / HQ Stock takes it out of the kit. Lost opens a Lost item (Lost Materials list), with a
--     remark. Written off only for a SIM that is Lost or Faulty. A lost or written-off SIM cannot be put back in use
--     here (Recover it in Lost Materials first).
--   * Every change is kept in material_movements and the Audit Trail. The function does not change the devices table
--     (the portal saves the unit itself), so a unit is never changed twice at the same moment.
-- {serial, new_serial?, status?, branch_id?, device_serial?, blocked_with_carrier?, note?}

update public.material_types set device_type = 'BOTH' where code = 'BATTERY';

create or replace function public.admin_sim_update(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_serial text := app.mat_serial('SIM', p->>'serial');
  v_new    text;
  v_status text := upper(nullif(btrim(coalesce(p->>'status', '')), ''));
  v_dev    varchar := nullif(btrim(coalesce(p->>'device_serial', '')), '');
  v_note   text := nullif(btrim(coalesce(p->>'note', '')), '');
  v_blocked boolean;
  v_branch varchar;
  v_target text;
  v_other  text;
  v_lost   bigint;
  s public.material_serials;
  d public.devices;
  v_before text;
begin
  if not app.is_admin() then
    raise exception 'Only Admin HQ can manage SIM cards in the portal.' using errcode = '42501';
  end if;
  if v_serial is null then
    raise exception 'INPUT: "%" is not a valid SIM number (e.g. 012 345 678).', coalesce(p->>'serial', '') using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p->>'new_serial', '')), '') is not null then
    v_new := app.mat_serial('SIM', p->>'new_serial');
    if v_new is null then
      raise exception 'INPUT: "%" is not a valid SIM number (e.g. 012 345 678).', p->>'new_serial' using errcode = '22023';
    end if;
  end if;
  if v_status is not null and v_status not in ('HQ_STOCK', 'IN_TRANSIT', 'BRANCH_RESERVE', 'AT_MERCHANT', 'LOST', 'FAULTY', 'WRITTEN_OFF') then
    raise exception 'INPUT: unknown SIM status "%".', v_status using errcode = '22023';
  end if;
  begin
    v_blocked := (p->>'blocked_with_carrier')::boolean;
  exception when others then
    raise exception 'INPUT: blocked_with_carrier must be true or false.' using errcode = '22023';
  end;
  if v_dev is not null then
    select * into d from public.devices where serial = v_dev;
    if not found then raise exception 'INPUT: unit % is not in the inventory.', v_dev using errcode = '22023'; end if;
  end if;

  select * into s from public.material_serials where material_code = 'SIM' and serial = v_serial for update;

  -- Not registered: only a SIM that is already in a unit at a merchant can be recorded here.
  if not found then
    if v_dev is null or coalesce(v_status, 'AT_MERCHANT') <> 'AT_MERCHANT' then
      raise exception 'STOCK: SIM % is not registered. Add new SIM cards with Stock In.', v_serial using errcode = '22023';
    end if;
    select x->>'serial' into v_other from public.device_kits k, jsonb_array_elements(k.items) x
     where k.device_serial = d.serial and x->>'code' = 'SIM' limit 1;
    if v_other is not null then
      perform app.kit_remove(d.serial, 'SIM', 1, v_other, 'RETURNED', 'Replaced by SIM ' || v_serial, 'Manage SIM', null);
    end if;
    perform app.kit_add(d.serial, 'SIM', 1, v_serial, false, coalesce(v_note, 'Recorded in Manage SIM'), null);
    update public.material_serials set blocked_with_carrier = coalesce(v_blocked, false), note = coalesce(v_note, note)
     where material_code = 'SIM' and serial = v_serial
    returning * into s;
    perform app.mat_audit('SIM Recorded at Merchant', 'SIM ' || v_serial || ' · unit ' || d.serial || coalesce(' · ' || d.merchant_name, '')
                          || coalesce(' (MID ' || d.mid || ')', ''), d.branch_id, 'SIM_MANAGE', v_serial);
    return to_jsonb(s);
  end if;

  v_before := s.status || coalesce(' / ' || s.device_serial, '');

  -- 1. New number (a typing mistake corrected): every record of this SIM follows.
  if v_new is not null and v_new <> s.serial then
    if exists (select 1 from public.material_serials where material_code = 'SIM' and serial = v_new) then
      raise exception 'INPUT: SIM % is already registered.', v_new using errcode = '22023';
    end if;
    update public.material_serials set serial = v_new, updated_at = now(), updated_by = app.label()
     where material_code = 'SIM' and serial = s.serial;
    update public.device_kits k
       set items = (select coalesce(jsonb_agg(case when x->>'code' = 'SIM' and x->>'serial' = s.serial
                                                 then x || jsonb_build_object('serial', v_new) else x end), '[]'::jsonb)
                      from jsonb_array_elements(k.items) x),
           updated_at = now(), updated_by = app.label()
     where exists (select 1 from jsonb_array_elements(k.items) x where x->>'code' = 'SIM' and x->>'serial' = s.serial);
    update public.material_lost set serial = v_new where material_code = 'SIM' and serial = s.serial;
    perform app.mat_log('SIM_RENAME', 'SIM', v_new, 1, s.branch_id, s.branch_id, s.branch_id, null, s.device_serial, s.mid,
                        'Number corrected from ' || s.serial);
    v_serial := v_new;
    select * into s from public.material_serials where material_code = 'SIM' and serial = v_serial for update;
  end if;

  v_target := coalesce(v_status, case when v_dev is not null then 'AT_MERCHANT' else s.status end);

  if v_target <> s.status and s.status = 'LOST' and v_target <> 'WRITTEN_OFF' then
    raise exception 'STOCK: SIM % is lost. Recover it in Lost Materials first.', v_serial using errcode = '22023';
  end if;
  if v_target <> s.status and s.status = 'WRITTEN_OFF' then
    raise exception 'STOCK: SIM % is written off and cannot be used again.', v_serial using errcode = '22023';
  end if;

  -- 2. The status asked for.
  if v_target = 'AT_MERCHANT' then
    if v_dev is null then v_dev := s.device_serial; end if;
    if v_dev is null then
      raise exception 'INPUT: choose the unit (terminal / sound box) this SIM is in.' using errcode = '22023';
    end if;
    select * into d from public.devices where serial = v_dev;
    if not found then raise exception 'INPUT: unit % is not in the inventory.', v_dev using errcode = '22023'; end if;
    if not exists (select 1 from public.device_kits k, jsonb_array_elements(k.items) x
                    where k.device_serial = d.serial and x->>'code' = 'SIM' and x->>'serial' = v_serial) then
      -- out of the kit it is in now (another merchant)
      if s.status = 'AT_MERCHANT' and s.device_serial is not null and exists (
           select 1 from public.device_kits k, jsonb_array_elements(k.items) x
            where k.device_serial = s.device_serial and x->>'code' = 'SIM' and x->>'serial' = v_serial) then
        perform app.kit_remove(s.device_serial, 'SIM', 1, v_serial, 'RETURNED', coalesce(v_note, 'Moved to unit ' || d.serial), 'Manage SIM', null);
      end if;
      -- the SIM this unit had goes back to the branch reserve
      select x->>'serial' into v_other from public.device_kits k, jsonb_array_elements(k.items) x
       where k.device_serial = d.serial and x->>'code' = 'SIM' limit 1;
      if v_other is not null then
        perform app.kit_remove(d.serial, 'SIM', 1, v_other, 'RETURNED', 'Replaced by SIM ' || v_serial, 'Manage SIM', null);
      end if;
      update public.material_serials set status = 'BRANCH_RESERVE', device_serial = null, mid = null, merchant_name = null,
             updated_at = now(), updated_by = app.label()
       where material_code = 'SIM' and status = 'AT_MERCHANT' and device_serial = d.serial and serial <> v_serial;
      -- into the unit's branch reserve first (a move from HQ / another branch is recorded), then into the kit
      select * into s from public.material_serials where material_code = 'SIM' and serial = v_serial for update;
      if s.status in ('FAULTY') then
        raise exception 'STOCK: SIM % is faulty; put it back in stock first.', v_serial using errcode = '22023';
      end if;
      if s.status <> 'BRANCH_RESERVE' or s.branch_id is distinct from d.branch_id then
        perform app.mat_log('SIM_MOVE', 'SIM', v_serial, 1, s.branch_id, d.branch_id, d.branch_id, null, null, null,
                            'From ' || lower(replace(s.status, '_', ' ')) || ' at ' || app.mat_where(s.branch_id) || ' (Manage SIM)');
        update public.material_serials set status = 'BRANCH_RESERVE', branch_id = d.branch_id, device_serial = null, mid = null,
               merchant_name = null, req_id = null, updated_at = now(), updated_by = app.label()
         where material_code = 'SIM' and serial = v_serial;
      end if;
      perform app.kit_add(d.serial, 'SIM', 1, v_serial, true, v_note, null);
    end if;

  elsif v_target in ('BRANCH_RESERVE', 'HQ_STOCK', 'IN_TRANSIT') then
    v_branch := case when v_target = 'HQ_STOCK' then '100'
                     else app.mat_branch(coalesce(nullif(btrim(coalesce(p->>'branch_id', '')), ''), s.branch_id)) end;
    if s.status = 'AT_MERCHANT' and s.device_serial is not null and exists (
         select 1 from public.device_kits k, jsonb_array_elements(k.items) x
          where k.device_serial = s.device_serial and x->>'code' = 'SIM' and x->>'serial' = v_serial) then
      perform app.kit_remove(s.device_serial, 'SIM', 1, v_serial, 'RETURNED', coalesce(v_note, 'Taken out in Manage SIM'), 'Manage SIM', null);
      select * into s from public.material_serials where material_code = 'SIM' and serial = v_serial for update;
    end if;
    if s.status is distinct from v_target or s.branch_id is distinct from v_branch or s.device_serial is not null then
      perform app.mat_log('SIM_MOVE', 'SIM', v_serial, 1, s.branch_id, v_branch, v_branch, null, s.device_serial, s.mid,
                          coalesce(v_note, initcap(replace(v_target, '_', ' ')) || ' (Manage SIM)'));
      update public.material_serials
         set status = v_target, branch_id = v_branch,
             -- a SIM kept inside a unit that is still in the reserve stays paired with it (not a merchant kit)
             device_serial = case when v_target = 'BRANCH_RESERVE' and v_dev is not null then v_dev end,
             mid = null, merchant_name = null, updated_at = now(), updated_by = app.label()
       where material_code = 'SIM' and serial = v_serial;
    end if;

  elsif v_target = 'LOST' then
    if s.status <> 'LOST' then
      if char_length(coalesce(v_note, '')) < 3 then
        raise exception 'INPUT: write a remark for the lost SIM.' using errcode = '22023';
      end if;
      if s.status = 'AT_MERCHANT' and s.device_serial is not null and exists (
           select 1 from public.device_kits k, jsonb_array_elements(k.items) x
            where k.device_serial = s.device_serial and x->>'code' = 'SIM' and x->>'serial' = v_serial) then
        perform app.kit_remove(s.device_serial, 'SIM', 1, v_serial, 'LOST', v_note, 'Reported', null);   -- opens the Lost item
      else
        update public.material_serials set status = 'LOST', updated_at = now(), updated_by = app.label()
         where material_code = 'SIM' and serial = v_serial;
        insert into public.material_lost (material_code, serial, qty, branch_id, device_serial, mid, merchant_name, source, remark, reported_by)
        values ('SIM', v_serial, 1, coalesce(s.branch_id, '100'), s.device_serial, s.mid, s.merchant_name, 'Reported', left(v_note, 500), app.label())
        returning id into v_lost;
        perform app.mat_log('LOST', 'SIM', v_serial, 1, s.branch_id, null, s.branch_id, v_lost::text, s.device_serial, s.mid, v_note);
      end if;
    end if;
    if v_blocked then
      update public.material_lost set blocked_with_carrier = true where material_code = 'SIM' and serial = v_serial and status = 'OPEN';
    end if;

  elsif v_target = 'FAULTY' then
    if s.status <> 'FAULTY' then
      if s.status = 'AT_MERCHANT' and s.device_serial is not null and exists (
           select 1 from public.device_kits k, jsonb_array_elements(k.items) x
            where k.device_serial = s.device_serial and x->>'code' = 'SIM' and x->>'serial' = v_serial) then
        perform app.kit_remove(s.device_serial, 'SIM', 1, v_serial, 'FAULTY', v_note, 'Manage SIM', null);
      else
        perform app.mat_log('FAULTY', 'SIM', v_serial, 1, s.branch_id, '100', s.branch_id, null, s.device_serial, s.mid, v_note);
        update public.material_serials set status = 'FAULTY', branch_id = '100', device_serial = null, mid = null, merchant_name = null,
               updated_at = now(), updated_by = app.label()
         where material_code = 'SIM' and serial = v_serial;
      end if;
    end if;

  elsif v_target = 'WRITTEN_OFF' then
    if s.status <> 'WRITTEN_OFF' then
      if s.status not in ('LOST', 'FAULTY') then
        raise exception 'STOCK: only a lost or faulty SIM can be written off (SIM % is %).', v_serial, lower(replace(s.status, '_', ' ')) using errcode = '22023';
      end if;
      if char_length(coalesce(v_note, '')) < 3 then
        raise exception 'INPUT: write the reason for the write-off.' using errcode = '22023';
      end if;
      update public.material_lost set status = 'WRITTEN_OFF', resolution = v_note, resolved_by = app.label(), resolved_at = now()
       where material_code = 'SIM' and serial = v_serial and status = 'OPEN';
      update public.material_serials set status = 'WRITTEN_OFF', updated_at = now(), updated_by = app.label()
       where material_code = 'SIM' and serial = v_serial;
      perform app.mat_log('WRITE_OFF', 'SIM', v_serial, 1, s.branch_id, null, s.branch_id, null, s.device_serial, s.mid, v_note);
    end if;
  end if;

  -- 3. Carrier block and note.
  update public.material_serials
     set blocked_with_carrier = coalesce(v_blocked, blocked_with_carrier),
         note = case when p ? 'note' then v_note else note end,
         updated_at = now(), updated_by = app.label()
   where material_code = 'SIM' and serial = v_serial
  returning * into s;

  perform app.mat_audit('SIM Card Updated', 'SIM ' || v_serial || ': ' || v_before || ' → ' || s.status || coalesce(' / ' || s.device_serial, '')
                        || ' · ' || app.mat_where(s.branch_id) || coalesce(' · ' || v_note, ''), s.branch_id, 'SIM_MANAGE', v_serial);
  return to_jsonb(s);
end $$;

revoke all on function public.admin_sim_update(jsonb) from public, anon;
grant execute on function public.admin_sim_update(jsonb) to authenticated;

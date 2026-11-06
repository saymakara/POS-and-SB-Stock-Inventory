-- Migration 20261106_01_sim_card_manage.sql
-- Manage SIM cards dynamically with device linkage, status transitions, and audit logging.

update public.material_types set device_type = 'BOTH' where code = 'BATTERY';

create or replace function public.admin_sim_update(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_serial text := upper(btrim(coalesce(p->>'serial', '')));
  v_new_serial text := upper(nullif(btrim(coalesce(p->>'new_serial', '')), ''));
  v_status text := upper(nullif(btrim(coalesce(p->>'status', '')), ''));
  v_branch varchar := nullif(btrim(coalesce(p->>'branch_id', '')), '');
  v_dev varchar := nullif(btrim(coalesce(p->>'device_serial', '')), '');
  v_mid varchar := nullif(btrim(coalesce(p->>'mid', '')), '');
  v_merchant text := nullif(btrim(coalesce(p->>'merchant_name', '')), '');
  v_note text := nullif(btrim(coalesce(p->>'note', '')), '');
  v_blocked boolean := (p->>'blocked_with_carrier')::boolean;
  v_final_serial text;
  s public.material_serials;
  d public.devices;
begin
  if not app.is_admin() then
    raise exception 'Only Admin HQ can manage SIM card lifecycle in the portal.' using errcode = '42501';
  end if;

  if v_serial is null or char_length(v_serial) < 3 then
    raise exception 'INPUT: Invalid SIM serial number.' using errcode = '22023';
  end if;

  select * into s from public.material_serials where material_code = 'SIM' and serial = v_serial for update;
  if not found then
    v_final_serial := coalesce(v_new_serial, v_serial);
    insert into public.material_serials (material_code, serial, status, branch_id, device_serial, mid, merchant_name, blocked_with_carrier, note, updated_by)
    values ('SIM', v_final_serial, coalesce(v_status, 'BRANCH_RESERVE'), coalesce(v_branch, '100'), v_dev, v_mid, v_merchant, coalesce(v_blocked, false), v_note, app.label())
    returning * into s;
  else
    v_final_serial := coalesce(v_new_serial, s.serial);
    -- If renaming serial
    if v_new_serial is not null and v_new_serial <> s.serial then
      update public.material_serials
      set serial = v_new_serial
      where material_code = 'SIM' and serial = s.serial;
    end if;

    -- If assigning to a device, unlink any other SIM previously assigned to this device
    if v_dev is not null then
      update public.material_serials
      set device_serial = null, mid = null, merchant_name = null, status = 'BRANCH_RESERVE', updated_at = now(), updated_by = app.label()
      where material_code = 'SIM' and device_serial = v_dev and serial <> v_final_serial;
    end if;

    -- Update the SIM record
    update public.material_serials
    set status = coalesce(v_status, status),
        branch_id = coalesce(v_branch, branch_id),
        device_serial = case when p ? 'device_serial' then v_dev else device_serial end,
        mid = case when p ? 'mid' then v_mid else mid end,
        merchant_name = case when p ? 'merchant_name' then v_merchant else merchant_name end,
        blocked_with_carrier = coalesce(v_blocked, blocked_with_carrier),
        note = coalesce(v_note, note),
        updated_at = now(),
        updated_by = app.label()
    where material_code = 'SIM' and serial = v_final_serial
    returning * into s;
  end if;

  -- Dynamic sync with devices table if device_serial is involved
  if v_dev is not null then
    select * into d from public.devices where serial = v_dev;
    if found then
      -- Sync customFields.simCard on device
      update public.devices
      set custom_fields = jsonb_set(coalesce(custom_fields, '{}'::jsonb), '{simCard}', to_jsonb(v_final_serial)),
          updated_at = now()
      where serial = v_dev;
    end if;
  end if;

  perform app.mat_log('SIM_MANAGE', 'SIM', v_final_serial, 1, s.branch_id, s.branch_id, s.branch_id, null, v_dev, v_mid, coalesce(v_note, 'SIM lifecycle updated'));
  perform app.mat_audit('SIM Lifecycle Managed', 'SIM ' || v_final_serial || ' updated: ' || s.status || coalesce(' (Unit ' || v_dev || ')', ''), s.branch_id, 'SIM_MANAGE', v_final_serial);

  return jsonb_build_object(
    'serial', s.serial,
    'status', s.status,
    'branch_id', s.branch_id,
    'device_serial', s.device_serial,
    'mid', s.mid,
    'merchant_name', s.merchant_name,
    'blocked_with_carrier', s.blocked_with_carrier,
    'updated_at', s.updated_at
  );
end $$;

grant execute on function public.admin_sim_update(jsonb) to authenticated;

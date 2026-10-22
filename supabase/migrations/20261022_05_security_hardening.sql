-- 22 Oct 2026 · Security hardening found in the penetration review.
-- 1. password_changed(): could be called without changing the password, which ended the forced first-password change
--    (first password = Employee ID). It now refuses while the password is still the Employee ID.
-- 2. devices_guard: Branch Staff could rewrite or erase a unit's history, change HQ allocation marks, or move a unit
--    to any stage. History is now append-only for them, the allocation mark is HQ-only, and stage moves follow the life cycle.
-- 3. audit_stamp: a branch user could file an audit entry under another branch. Their entries now always carry their branch.
-- 4. admin_save_staff: an admin still on a first password could manage accounts. Now refused until the password is changed.
-- 5. Clean-up: the backup table is closed to the API; legacy "service_role false" policies (no effect) are removed.
--
-- STATUS (22 Oct 2026): parts 1-4 are APPLIED on the live database. Part 5 (the last two blocks of this file) is NOT yet
-- applied – it needs the owner's approval. It is low risk either way (the backup table already has row security with no
-- policy, so nobody can read it through the API). To apply: Supabase → SQL Editor → paste the two blocks under PART 5.

create or replace function public.password_changed()
returns void language plpgsql security definer set search_path = '' as $$
declare v_emp text; v_hash text;
begin
  select p.emp_id, u.encrypted_password into v_emp, v_hash
  from public.staff_profiles p join auth.users u on u.id = p.user_id where p.user_id = auth.uid();
  if not found then raise exception 'No staff profile for this sign-in.' using errcode = '42501'; end if;
  if v_hash is not null and v_hash = extensions.crypt(v_emp, v_hash) then
    raise exception 'The new password cannot be your Employee ID. Choose a different password.' using errcode = '22023';
  end if;
  update public.staff_profiles set must_change_password = false, updated_at = now() where user_id = auth.uid();
end $$;
revoke all on function public.password_changed() from public, anon;
grant execute on function public.password_changed() to authenticated;

create or replace function app.devices_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
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
    if not (coalesce(new.history, '[]'::jsonb) @> coalesce(old.history, '[]'::jsonb)) then
      raise exception 'The history of a unit can only be added to, never changed or removed.' using errcode = '42501';
    end if;
    if (new.custom_fields->>'allocatedTo') is distinct from (old.custom_fields->>'allocatedTo') then
      raise exception 'Only Admin HQ can allocate a unit to a request.' using errcode = '42501';
    end if;
    if new.stage is distinct from old.stage and not (
         (old.stage = 'BRANCH_RESERVE' and new.stage in ('CONFIGURING', 'COMPLETE', 'LOST'))
      or (old.stage = 'CONFIGURING'    and new.stage in ('COMPLETE', 'BRANCH_RESERVE', 'LOST'))
      or (old.stage = 'COMPLETE'       and new.stage in ('BRANCH_RESERVE', 'LOST'))
      or (old.stage = 'FAULTY'         and new.stage in ('BRANCH_RESERVE', 'LOST'))
      or (old.stage = 'LOST'           and new.stage = 'BRANCH_RESERVE')) then
      raise exception 'A unit cannot go from % to % from a branch. Use a stock request or stock return.', old.stage, new.stage using errcode = '42501';
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

create or replace function app.audit_stamp()
returns trigger language plpgsql security definer set search_path = '' as $$
declare p public.staff_profiles;
begin
  new.created_at := now();
  new.actor_id := auth.uid();
  if new.actor_id is not null then
    select * into p from public.staff_profiles where user_id = new.actor_id;
    new.actor_emp := p.emp_id; new.actor_name := p.name; new.role := p.role;
    if new.branch_id is null or p.role is null or p.role not in ('SUPER_ADMIN', 'ADMIN') then
      new.branch_id := p.branch_id;                    -- branch users always log under their own branch
    end if;
  elsif new.actor_name is null then
    new.actor_name := 'System';
  end if;
  return new;
end $$;

-- admin_save_staff: the caller must have finished the first-password change (same rule as every other admin action)
do $$
declare d text := pg_get_functiondef('public.admin_save_staff(jsonb)'::regprocedure);
begin
  if position('where user_id = auth.uid() and active;' in d) > 0 then
    d := replace(d, 'where user_id = auth.uid() and active;', 'where user_id = auth.uid() and active and not must_change_password;');
    execute d;
  end if;
end $$;

-- PART 5 · the backup table is for recovery by the owner only
revoke all on table public.historical_merchants_backup_20261022 from anon, authenticated;

-- legacy policies granted to service_role with "false" (service_role bypasses RLS anyway): no effect, removed for clarity
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and roles = '{service_role}' and qual = 'false' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

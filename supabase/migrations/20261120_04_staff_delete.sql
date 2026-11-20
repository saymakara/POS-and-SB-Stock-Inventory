-- ============================================================================================================================
-- 20 Nov 2026 - Staff Directory: Delete User works (Accounts & Access).
--
-- Found on 20 Nov: the portal's "Delete User" button calls public.admin_delete_staff, but that function is NOT in the live
-- database (20261114_01_admin_delete_staff.sql was never run) - every delete stopped with "Database migration required".
-- This file creates it (it replaces 20261114_01; running both is also fine), with two improvements:
--   * the Audit Trail entry says WHO deleted the account (actor) and is marked Success (the table's default is "Error");
--   * the same locked-down settings as the 20 Nov security review (fixed search_path, signed-in admins only).
--
-- Rules (unchanged from 14 Nov):
--   * only an active Super Admin or Admin can delete; an Admin can delete Branch staff only (a Super Admin anyone);
--   * nobody can delete their own account; the last active Super Admin cannot be deleted.
-- What is removed: the person's sign-in (auth.users, with its sessions) and their Staff Directory row (staff_profiles).
-- What stays: everything they did - devices, KHQR / POS / Sound Box / Credit Card / visit records, KPI history, the Audit
-- Trail (checked on 20 Nov: no other table is linked to the account; their Staff ID stays on every record as text).
-- Safe to run twice.
-- ============================================================================================================================

create or replace function public.admin_delete_staff(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me public.staff_profiles;
  cur public.staff_profiles;
  v_emp text := btrim(coalesce(p->>'emp_id', ''));
  v_reason text := nullif(left(btrim(coalesce(p->>'reason', '')), 300), '');
  v_supers int;
begin
  select * into me from public.staff_profiles where user_id = auth.uid() and active and not must_change_password;
  if not found or me.role not in ('SUPER_ADMIN', 'ADMIN') then
    raise exception 'Only an admin can delete accounts.' using errcode = '42501';
  end if;
  if v_emp = '' then
    raise exception 'Employee ID is required.' using errcode = '22023';
  end if;

  select * into cur from public.staff_profiles where lower(emp_id) = lower(v_emp) for update;
  if not found then
    raise exception 'Staff account % not found.', v_emp using errcode = 'P0002';
  end if;
  if cur.user_id = me.user_id then
    raise exception 'You cannot delete your own account.' using errcode = '42501';
  end if;
  if me.role = 'ADMIN' and cur.role <> 'BRANCH' then
    raise exception 'Only a Super Admin can delete admin accounts.' using errcode = '42501';
  end if;
  if cur.role = 'SUPER_ADMIN' and cur.active then
    select count(*) into v_supers from public.staff_profiles where role = 'SUPER_ADMIN' and active and user_id <> cur.user_id;
    if v_supers = 0 then
      raise exception 'At least one active Super Admin must remain.' using errcode = '42501';
    end if;
  end if;

  insert into public.audit_logs (title, detail, branch_id, action, target, actor_id, actor_emp, actor_name, role, status)
  values ('Account Deleted',
          cur.emp_id || ' · ' || cur.name || ' · ' || cur.role || ' · Branch ' || coalesce(cur.branch_id, '-') || ' · ' || coalesce(v_reason, 'Staff resigned'),
          cur.branch_id, 'USER_DELETE', cur.emp_id, me.user_id, me.emp_id, me.name, me.role, 'Success');

  delete from auth.users where id = cur.user_id;                       -- its sessions go with it; staff_profiles too (cascade)
  delete from public.staff_profiles where user_id = cur.user_id;       -- (in case the link was missing)

  return jsonb_build_object('deleted', true, 'emp_id', cur.emp_id, 'name', cur.name);
end $$;

revoke all on function public.admin_delete_staff(jsonb) from public, anon;
grant execute on function public.admin_delete_staff(jsonb) to authenticated;

notify pgrst, 'reload schema';

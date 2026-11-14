-- 14 Nov 2026: Allow Super Admin / Admin to permanently delete a resigned staff account.
-- Removes auth.users row (cascading to auth.identities, auth.sessions, and public.staff_profiles),
-- records a USER_DELETE audit entry, blocks self-deletion, Admin-deleting-Admin, and deleting the last active Super Admin.

create or replace function public.admin_delete_staff(p jsonb) returns jsonb
language plpgsql security definer set search_path = 'public', 'pg_temp' as $$
declare
  me public.staff_profiles;
  cur public.staff_profiles;
  v_emp text := trim(coalesce(p->>'emp_id', ''));
  v_reason text := nullif(trim(coalesce(p->>'reason', '')), '');
  v_supers int;
begin
  select * into me from public.staff_profiles where user_id = auth.uid() and active and not must_change_password;
  if not found or me.role not in ('SUPER_ADMIN', 'ADMIN') then
    raise exception 'Only an admin can delete accounts.' using errcode = '42501';
  end if;

  if v_emp = '' then
    raise exception 'Employee ID is required.';
  end if;

  select * into cur from public.staff_profiles where lower(emp_id) = lower(v_emp);
  if not found then
    raise exception 'Staff account % not found.', v_emp;
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
      raise exception 'At least one active Super Admin must remain.';
    end if;
  end if;

  insert into public.audit_logs (title, detail, branch_id, action, target)
  values (
    'Account Deleted',
    cur.emp_id || ' · ' || cur.name || ' · ' || cur.role || ' · Branch ' || cur.branch_id
      || ' · ' || coalesce(v_reason, 'Staff resigned'),
    cur.branch_id,
    'USER_DELETE',
    cur.emp_id
  );

  delete from auth.users where id = cur.user_id;
  delete from public.staff_profiles where user_id = cur.user_id;

  return jsonb_build_object('deleted', true, 'emp_id', cur.emp_id, 'name', cur.name);
end $$;

revoke all on function public.admin_delete_staff(jsonb) from public, anon;
grant execute on function public.admin_delete_staff(jsonb) to authenticated;

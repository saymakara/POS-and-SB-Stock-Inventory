-- Migration: 20261025_02_staff_telegram_username.sql
-- Add telegram_username to staff_profiles for Telegram @mention push notifications

ALTER TABLE public.staff_profiles ADD COLUMN IF NOT EXISTS telegram_username text;

CREATE OR REPLACE FUNCTION public.admin_save_staff(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me public.staff_profiles; cur public.staff_profiles; v_emp text := trim(coalesce(p->>'emp_id', ''));
  v_role text := upper(coalesce(p->>'role', 'BRANCH')); v_pw text := p->>'password'; v_uid uuid; v_email text;
  v_active boolean := coalesce((p->>'active')::boolean, true); v_supers int;
  v_tg text := nullif(trim(coalesce(p->>'telegram_username', '')), '');
begin
  select * into me from public.staff_profiles where user_id = auth.uid() and active and not must_change_password;
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
    insert into public.staff_profiles (user_id, emp_id, name, role, branch_id, position, contact, telegram_username, active, must_change_password)
    values (v_uid, v_emp, trim(p->>'name'), v_role, p->>'branch_id', p->>'position', p->>'contact', v_tg, v_active, true);
  else
    v_uid := cur.user_id;
    update public.staff_profiles set name = trim(p->>'name'), role = v_role, branch_id = p->>'branch_id', position = p->>'position',
      contact = p->>'contact', telegram_username = v_tg, active = v_active, updated_at = now(),
      must_change_password = case when v_pw is not null then true else must_change_password end
    where user_id = v_uid;
    if v_pw is not null then
      update auth.users set encrypted_password = extensions.crypt(v_pw, extensions.gen_salt('bf')), updated_at = now() where id = v_uid;
    end if;
  end if;
  update auth.users set banned_until = case when v_active then null else now() + interval '100 years' end where id = v_uid;
  select count(*) into v_supers from public.staff_profiles where role = 'SUPER_ADMIN' and active;
  if v_supers = 0 then raise exception 'At least one active Super Admin must remain.'; end if;
  insert into public.audit_logs (title, detail, branch_id, action, target)
  values (case when cur.user_id is null then 'Account Created' else 'Account Updated' end,
          v_emp || ' · ' || trim(p->>'name') || ' · ' || v_role || ' · Branch ' || (p->>'branch_id') || case when v_active then '' else ' · DEACTIVATED' end
          || case when v_pw is not null then ' · password set' else '' end
          || case when v_tg is not null then ' · TG: ' || v_tg else '' end,
          p->>'branch_id', 'USER_UPDATE', v_emp);
  return (select to_jsonb(s) from public.staff_profiles s where user_id = v_uid);
end $function$;

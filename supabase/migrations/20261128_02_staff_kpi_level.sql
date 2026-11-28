-- (28 Nov 2026) Staff Directory -> KPI level: Branch Staff (default, not stored) / HO Support / Management Level.
--   * HO Support: Head Office staff who support the branches. Full KPI target, like Branch Staff; the KPI page shows
--     "HO Support" as their position.
--   * Management Level: 0 target, non-mandatory (as before).
-- The list public.kpi_management_staff (20261128_01) gets a column `level`; everyone already in it stays Management.
-- kpi_management_list returns the level; kpi_management_set takes {"level": "HO_SUPPORT" | "MANAGEMENT"} per staff member.
-- Safe to run more than once.

alter table public.kpi_management_staff add column if not exists level text not null default 'MANAGEMENT';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'kpi_management_staff_level_chk') then
    alter table public.kpi_management_staff add constraint kpi_management_staff_level_chk check (level in ('MANAGEMENT', 'HO_SUPPORT'));
  end if;
end $$;

create or replace function public.kpi_management_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if (select app.role()) is null then
    raise exception 'Your account is not active. Ask Admin HQ to restore access.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('staff_id', m.staff_id, 'staff_name', m.staff_name, 'level', m.level,
                                                       'updated_by', m.updated_by, 'updated_at', m.updated_at) order by m.staff_name, m.staff_id)
                     from public.kpi_management_staff m), '[]'::jsonb);
end $function$;
revoke all on function public.kpi_management_list() from public, anon;
grant execute on function public.kpi_management_list() to authenticated, service_role;

-- p = {"items": [{"staff_id": "8986", "staff_name": "...", "on": true, "level": "HO_SUPPORT"}, ...]}
--   on = false (or level "BRANCH_STAFF") removes the staff member from the list: Branch Staff again
create or replace function public.kpi_management_set(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  e jsonb; v_id text; v_on boolean; v_level text; v_set int := 0; v_off int := 0; v_names text := '';
begin
  if not app.is_admin() then raise exception 'Only Admin HQ can change the KPI level of staff.' using errcode = '42501'; end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') > 500 then
    raise exception 'Send a list of up to 500 staff.' using errcode = '22023';
  end if;
  for e in select x from jsonb_array_elements(p->'items') x loop
    v_id := btrim(coalesce(e->>'staff_id', ''));
    if v_id !~ '^[A-Za-z0-9._-]{1,40}$' then raise exception 'Not a Staff ID: %', left(v_id, 40) using errcode = '22023'; end if;
    v_level := upper(coalesce(nullif(btrim(e->>'level'), ''), 'MANAGEMENT'));
    v_on := coalesce((e->>'on')::boolean, true) and v_level <> 'BRANCH_STAFF';
    if v_on and v_level not in ('MANAGEMENT', 'HO_SUPPORT') then
      raise exception 'Unknown KPI level: %', left(v_level, 20) using errcode = '22023';
    end if;
    if v_on then
      insert into public.kpi_management_staff (staff_id, staff_name, level, updated_by, updated_at)
      values (v_id, left(btrim(coalesce(e->>'staff_name', '')), 120), v_level, app.label(), now())
      on conflict (staff_id) do update set staff_name = case when excluded.staff_name <> '' then excluded.staff_name else public.kpi_management_staff.staff_name end,
                                           level = excluded.level, updated_by = excluded.updated_by, updated_at = now();
      v_set := v_set + 1;
    else
      delete from public.kpi_management_staff where staff_id = v_id;
      if found then v_off := v_off + 1; end if;
    end if;
    v_names := v_names || case when v_names = '' then '' else ', ' end || v_id || ' ' || case when v_on then v_level else 'BRANCH_STAFF' end;
  end loop;
  if v_set + v_off > 0 then
    insert into public.audit_logs (title, detail, action, target, branch_id)
    values ('KPI Staff Level Changed', left(v_names, 1000), 'KPI_MANAGEMENT_SET', 'kpi_management_staff', '100');
  end if;
  return jsonb_build_object('ok', true, 'set', v_set, 'removed', v_off, 'levels', true);
end $function$;
revoke all on function public.kpi_management_set(jsonb) from public, anon;
grant execute on function public.kpi_management_set(jsonb) to authenticated, service_role;

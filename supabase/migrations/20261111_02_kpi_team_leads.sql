-- 11 Nov 2026 · KPI in the Merchant Visit app: My KPI (every staff member, own figures only) and Team KPI (team leads).
-- Not yet applied: run in the Supabase SQL Editor (safe to run again).
--
-- kpi_team_leads: who is a team lead (Merchant Visit Staff ID) and whose KPI they see - the staff of the chosen branches
-- (branches.id), plus any Staff IDs added by hand (e.g. staff of provincial branches not in the branch list).
-- Kept by Admin HQ in Settings → KPI (kpi_team_lead_list / kpi_team_lead_save / kpi_team_lead_delete, Admin only).
-- mv_kpi(p): for the Merchant Visit server only (service key). Uses the same kpi_dashboard_summary as the KPI page, so
-- the app shows exactly the portal's figures: today and this month (Phnom Penh dates) for p.staff_id, the rules and the
-- targets; for a team lead also each team member's today / month counts. Points are computed by the app from the rules
-- (the same formula as the portal). Nothing is written.

create table if not exists public.kpi_team_leads (
  staff_id   text primary key check (staff_id ~ '^[A-Za-z0-9._-]{1,40}$'),
  staff_name text not null default '' check (char_length(staff_name) <= 120),
  branch_ids text[] not null default '{}',
  member_ids text[] not null default '{}',
  active     boolean not null default true,
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.kpi_team_leads enable row level security;
revoke all on public.kpi_team_leads from anon, authenticated;

create or replace function public.kpi_team_lead_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_admin() then raise exception 'Only Admin HQ can see the team leads.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('staff_id', t.staff_id, 'staff_name', t.staff_name, 'branch_ids', to_jsonb(t.branch_ids),
            'member_ids', to_jsonb(t.member_ids), 'active', t.active, 'updated_by', t.updated_by, 'updated_at', t.updated_at) order by t.staff_name, t.staff_id)
            from public.kpi_team_leads t), '[]'::jsonb);
end $$;

create or replace function public.kpi_team_lead_save(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_id text := btrim(coalesce(p->>'staff_id', '')); v_name text := left(btrim(coalesce(p->>'staff_name', '')), 120);
  v_br text[]; v_mem text[]; v_bad text; r public.kpi_team_leads;
begin
  if not app.is_admin() then raise exception 'Only Admin HQ can change the team leads.' using errcode = '42501'; end if;
  if v_id !~ '^[A-Za-z0-9._-]{1,40}$' then raise exception 'Enter the team lead''s Staff ID (letters and digits).' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct btrim(x) order by btrim(x)), '{}') into v_br
    from jsonb_array_elements_text(case when jsonb_typeof(p->'branch_ids') = 'array' then p->'branch_ids' else '[]'::jsonb end) x where btrim(x) <> '';
  select string_agg(b, ', ') into v_bad from unnest(v_br) b where not exists (select 1 from public.branches x where x.id = b);
  if v_bad is not null then raise exception 'Unknown branch: %.', v_bad using errcode = '22023'; end if;
  select coalesce(array_agg(distinct btrim(x) order by btrim(x)), '{}') into v_mem
    from jsonb_array_elements_text(case when jsonb_typeof(p->'member_ids') = 'array' then p->'member_ids' else '[]'::jsonb end) x where btrim(x) ~ '^[A-Za-z0-9._-]{1,40}$';
  if cardinality(v_br) = 0 and cardinality(v_mem) = 0 then raise exception 'Choose at least one branch or add a Staff ID to the team.' using errcode = '22023'; end if;
  insert into public.kpi_team_leads (staff_id, staff_name, branch_ids, member_ids, active, updated_by, updated_at)
  values (v_id, v_name, v_br, v_mem, coalesce((p->>'active')::boolean, true), app.label(), now())
  on conflict (staff_id) do update set staff_name = excluded.staff_name, branch_ids = excluded.branch_ids, member_ids = excluded.member_ids,
    active = excluded.active, updated_by = excluded.updated_by, updated_at = now()
  returning * into r;
  insert into public.audit_logs (title, detail, action, target, branch_id)
  values ('KPI Team Lead Saved', r.staff_name || ' (' || r.staff_id || ') · branches ' || coalesce(nullif(array_to_string(r.branch_ids, ', '), ''), '—') ||
          case when cardinality(r.member_ids) > 0 then ' · + ' || cardinality(r.member_ids) || ' staff' else '' end, 'KPI_TEAM_LEAD_SAVE', r.staff_id, '100');
  return jsonb_build_object('ok', true, 'staff_id', r.staff_id);
end $$;

create or replace function public.kpi_team_lead_delete(p_staff_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_admin() then raise exception 'Only Admin HQ can change the team leads.' using errcode = '42501'; end if;
  delete from public.kpi_team_leads where staff_id = btrim(coalesce(p_staff_id, ''));
  if not found then raise exception 'Team lead % not found.', p_staff_id using errcode = 'P0002'; end if;
  insert into public.audit_logs (title, detail, action, target, branch_id) values ('KPI Team Lead Removed', p_staff_id, 'KPI_TEAM_LEAD_DELETE', p_staff_id, '100');
  return jsonb_build_object('ok', true);
end $$;

-- the Merchant Visit server (service key): My KPI and, for a team lead, Team KPI
create or replace function public.mv_kpi(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sid text := left(btrim(coalesce(p->>'staff_id', '')), 40);
  v_today date := (now() at time zone 'Asia/Phnom_Penh')::date;
  v_m0 date := date_trunc('month', (now() at time zone 'Asia/Phnom_Penh'))::date;
  v_month jsonb; v_day jsonb; tl public.kpi_team_leads; v_team jsonb := null;
  v_zero jsonb := '{}'::jsonb;
begin
  if v_sid = '' then raise exception 'INPUT: staff_id is required.' using errcode = '22023'; end if;
  v_month := public.kpi_dashboard_summary(v_m0, v_today);
  v_day := public.kpi_dashboard_summary(v_today, v_today);
  select * into tl from public.kpi_team_leads where staff_id = v_sid and active;
  if found then
    with ms as (select x from jsonb_array_elements(coalesce(v_month->'staff', '[]'::jsonb)) x),
         ds as (select x from jsonb_array_elements(coalesce(v_day->'staff', '[]'::jsonb)) x),
         ids as (select x->>'staff_id' id, x->>'staff_name' nm, x->>'branch_id' bid, x->>'branch_name' bn from ms
                 union select x->>'staff_id', x->>'staff_name', x->>'branch_id', x->>'branch_name' from ds),
         mine as (select distinct on (id) id, nm, bid, bn from ids
                   where id <> v_sid and (id = any(tl.member_ids) or bid = any(tl.branch_ids) or app.resolve_branch(bn) = any(tl.branch_ids))
                   order by id)
    select coalesce(jsonb_agg(jsonb_build_object('staff_id', m.id, 'staff_name', m.nm, 'branch_id', m.bid, 'branch_name', m.bn,
             'today', coalesce((select x from ds where x->>'staff_id' = m.id limit 1), v_zero),
             'month', coalesce((select x from ms where x->>'staff_id' = m.id limit 1), v_zero)) order by m.bn, m.nm), '[]'::jsonb)
      into v_team from mine m;
    -- team members without any activity yet (added by hand): listed with zero
    v_team := v_team || coalesce((select jsonb_agg(jsonb_build_object('staff_id', u, 'staff_name', '', 'branch_id', null, 'branch_name', '', 'today', v_zero, 'month', v_zero))
                from unnest(tl.member_ids) u where u <> v_sid and not exists (select 1 from jsonb_array_elements(v_team) t where t->>'staff_id' = u)), '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'day', v_today, 'month_start', v_m0,
    'rules', (select coalesce(jsonb_agg(jsonb_build_object('code', r->>'code', 'category', r->>'category', 'sub', r->>'sub_category', 'points', (r->>'points')::numeric, 'active', (r->>'active')::boolean)), '[]'::jsonb)
                from jsonb_array_elements(coalesce(v_month->'rules', '[]'::jsonb)) r),
    'targets', v_month->'targets',
    'me', jsonb_build_object('today', coalesce((select x from jsonb_array_elements(coalesce(v_day->'staff', '[]'::jsonb)) x where x->>'staff_id' = v_sid limit 1), v_zero),
                             'month', coalesce((select x from jsonb_array_elements(coalesce(v_month->'staff', '[]'::jsonb)) x where x->>'staff_id' = v_sid limit 1), v_zero)),
    'lead', case when tl.staff_id is null then null else jsonb_build_object('branch_ids', to_jsonb(tl.branch_ids),
              'branches', (select coalesce(jsonb_agg(b.name order by b.id), '[]'::jsonb) from public.branches b where b.id = any(tl.branch_ids)), 'team', v_team) end);
end $$;

revoke all on function public.kpi_team_lead_list() from public, anon;
revoke all on function public.kpi_team_lead_save(jsonb) from public, anon;
revoke all on function public.kpi_team_lead_delete(text) from public, anon;
grant execute on function public.kpi_team_lead_list() to authenticated, service_role;
grant execute on function public.kpi_team_lead_save(jsonb) to authenticated, service_role;
grant execute on function public.kpi_team_lead_delete(text) to authenticated, service_role;
revoke all on function public.mv_kpi(jsonb) from public, anon, authenticated;
grant execute on function public.mv_kpi(jsonb) to service_role;

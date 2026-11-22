-- ============================================================================================================================
-- 22 Nov 2026 - KPI Points & Rules: delete a KPI task you do not need, and "Sync from Merchant Visit".
--
-- 1. Delete (Super Admin). public.kpi_delete_rule(p_code) removes any KPI task, system ones included (this is the function
--    of 20261121_03, which was never run on the server - this file contains it, so 20261121_03 need not be run). The visit /
--    installation records and the Audit Trail are kept; the task simply stops giving points. A deleted task is remembered
--    with its settings (app.kpi_rule_dismissed) so Sync does not add it back - unless asked, and then exactly as it was.
-- 2. Sync from Merchant Visit (Super Admin). public.kpi_sync_from_mv(p) looks at every activity the Merchant Visit app has sent
--    (public.mv_visits), works out the KPI task code exactly as the KPI dashboard counts it, and lists the ones that have no
--    KPI task yet. With p.apply = true it adds them: 0 points and Inactive, so no KPI total changes until you set the
--    points and switch them on. p.include_deleted = true also brings back tasks you deleted.
--    A new Merchant Visit activity appears here after its first visit reaches the portal.
-- Safe to run twice.
-- ============================================================================================================================

create table if not exists app.kpi_rule_dismissed (
  code text primary key,
  sub_category text,
  category text,
  deleted_at timestamptz not null default now(),
  deleted_by text
);
alter table app.kpi_rule_dismissed add column if not exists rule jsonb;           -- the whole task as it was, to bring it back
alter table app.kpi_rule_dismissed enable row level security;           -- no policy: only the functions below use it
revoke all on app.kpi_rule_dismissed from public, anon, authenticated;

-- ---- 1. delete ------------------------------------------------------------------------------------------------------------
create or replace function public.kpi_delete_rule(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.staff_profiles;
  r public.kpi_point_rules;
  v_code text := upper(btrim(coalesce(p_code, '')));
begin
  select * into me from public.staff_profiles where user_id = auth.uid() and active and not must_change_password;
  if not found or me.role <> 'SUPER_ADMIN' then
    raise exception 'Only a Super Admin can delete KPI point rules.' using errcode = '42501';
  end if;
  if v_code = '' then
    raise exception 'KPI rule code is required.' using errcode = '22023';
  end if;

  select * into r from public.kpi_point_rules where code = v_code for update;
  if not found then
    return jsonb_build_object('ok', true, 'code', v_code);
  end if;

  delete from public.kpi_point_rules where code = v_code;
  insert into app.kpi_rule_dismissed (code, sub_category, category, deleted_at, deleted_by, rule)
  values (r.code, r.sub_category, r.category, now(), me.name, to_jsonb(r))
  on conflict (code) do update set sub_category = excluded.sub_category, category = excluded.category,
                                   deleted_at = excluded.deleted_at, deleted_by = excluded.deleted_by, rule = excluded.rule;

  if to_regclass('app.kpi_summary_cache') is not null then
    delete from app.kpi_summary_cache;
  end if;

  insert into public.audit_logs (title, detail, branch_id, action, target, actor_id, actor_emp, actor_name, role, status)
  values ('KPI Rule Deleted', r.code || ' · ' || r.category || ' · ' || r.sub_category || ' (' || r.points || ' pts)',
          '100', 'KPI_RULE_DELETE', r.code, me.user_id, me.emp_id, me.name, me.role, 'Success');

  return jsonb_build_object('ok', true, 'code', r.code, 'sub_category', r.sub_category);
end $$;
revoke all on function public.kpi_delete_rule(text) from public, anon;
grant execute on function public.kpi_delete_rule(text) to authenticated, service_role;

-- ---- 2. the KPI task code of a Merchant Visit record: the same mapping as app.kpi_dashboard_summary_compute ------------------
create or replace function app.kpi_mv_rule_code(p_activity text, p_answers jsonb, p_remarks text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_activity ilike '%POS Operational Support%' or p_activity ilike '%POS Request%' then
      case
        when coalesce(p_answers->>'Request Type', p_answers->>'request_type', p_remarks) ilike '%inspect%' then 'POS_OP_INSPECT'
        when coalesce(p_answers->>'Request Type', p_answers->>'request_type', p_remarks) ilike '%train%' then 'POS_OP_TRAIN'
        when coalesce(p_answers->>'Request Type', p_answers->>'request_type', p_remarks) ilike '%paper%' then 'POS_OP_PAPER'
        when coalesce(p_answers->>'Request Type', p_answers->>'request_type', p_remarks) ilike '%add%mat%' then 'POS_OP_ADD_MAT'
        when coalesce(p_answers->>'Request Type', p_answers->>'request_type', p_remarks) ilike '%return%mat%' then 'POS_OP_RET_MAT'
        when coalesce(p_answers->>'Request Type', p_answers->>'request_type', p_remarks) ilike '%other%' then 'POS_OP_OTHERS'
        else 'POS_MAINT'
      end
    when p_activity ilike '%SB Operational Support%' or p_activity ilike '%Sound Box Operational%' or p_activity ilike '%Sound Box Request%' then
      case
        when coalesce(p_answers->>'Request Type', p_answers->>'request_type', p_remarks) ilike '%inspect%' then 'SB_OP_INSPECT'
        when coalesce(p_answers->>'Request Type', p_answers->>'request_type', p_remarks) ilike '%train%' then 'SB_OP_TRAIN'
        when coalesce(p_answers->>'Request Type', p_answers->>'request_type', p_remarks) ilike '%battery%' then 'SB_OP_BATTERY'
        when coalesce(p_answers->>'Request Type', p_answers->>'request_type', p_remarks) ilike '%add%mat%' then 'SB_OP_ADD_MAT'
        when coalesce(p_answers->>'Request Type', p_answers->>'request_type', p_remarks) ilike '%return%mat%' then 'SB_OP_RET_MAT'
        when coalesce(p_answers->>'Request Type', p_answers->>'request_type', p_remarks) ilike '%other%' then 'SB_OP_OTHERS'
        else 'SB_MAINT'
      end
    when p_activity = 'POS Terminal Inspection' then 'POS_OP_INSPECT'
    when p_activity in ('POS Refreshment Training', 'Refreshment Training') then 'POS_OP_TRAIN'
    when p_activity = 'Request Paper Roll' then 'POS_OP_PAPER'
    when p_activity = 'Request Add Material' then 'POS_OP_ADD_MAT'
    when p_activity = 'Request Return Materials' then 'POS_OP_RET_MAT'
    when p_activity = 'SB Inspection' then 'SB_OP_INSPECT'
    when p_activity = 'SB Refresh Training' then 'SB_OP_TRAIN'
    when p_activity = 'Battery Replacement' and (p_answers->>'Sound Box Request' is not null or p_activity ilike '%SB%') then 'SB_OP_BATTERY'
    when p_activity = 'Add Material' and (p_answers->>'Sound Box Request' is not null or p_activity ilike '%SB%') then 'SB_OP_ADD_MAT'
    when p_activity = 'Returns Material' and (p_answers->>'Sound Box Request' is not null or p_activity ilike '%SB%') then 'SB_OP_RET_MAT'
    when p_activity in ('Declined – Cash Only (No QR)', 'Declined - Cash Only (No QR)') then 'MV_DECLINED_CASH_ONLY_NO_QR'
    else app.kpi_visit_code(p_activity, p_answers)
  end
$$;

-- ---- 3. sync --------------------------------------------------------------------------------------------------------------
create or replace function public.kpi_sync_from_mv(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
declare
  me public.staff_profiles;
  v_apply boolean := coalesce((p->>'apply')::boolean, false);
  v_incl boolean := coalesce((p->>'include_deleted')::boolean, false);
  v_new jsonb; v_deleted jsonb; v_known int; v_sort int; v_added int := 0;
begin
  select * into me from public.staff_profiles where user_id = auth.uid() and active and not must_change_password;
  if not found or me.role <> 'SUPER_ADMIN' then
    raise exception 'Only a Super Admin can sync KPI tasks.' using errcode = '42501';
  end if;

  drop table if exists pg_temp._mvk;
  create temp table _mvk on commit drop as
  select app.kpi_mv_rule_code(m.activity, m.answers, m.remarks) as code,
         min(m.activity) as activity, count(*)::int as visits,
         max(m.submitted_at) as last_seen,
         bool_or(m.activity = 'Booth Event') as booth, bool_or(m.activity = 'Standby VIP Merchant') as standby
    from public.mv_visits m
   group by 1;

  select count(*) into v_known from _mvk k where exists (select 1 from public.kpi_point_rules r where r.code = k.code);

  select coalesce(jsonb_agg(jsonb_build_object(
           'code', k.code, 'activity', k.activity, 'visits', k.visits, 'last_seen', k.last_seen,
           'category', case when k.code like 'POS\_%' then 'POS Terminal' when k.code like 'SB\_%' then 'Sound Box' else 'Merchant Visit' end,
           'sub_category', case
             when k.code like '%\_HALF\_DAY' then k.activity || ' - Half Day'
             when k.code like '%\_FULL\_DAY' then k.activity || ' - Full Day'
             else k.activity end
         ) order by k.visits desc, k.code), '[]'::jsonb)
    into v_new
    from _mvk k
   where not exists (select 1 from public.kpi_point_rules r where r.code = k.code)
     and (v_incl or not exists (select 1 from app.kpi_rule_dismissed d where d.code = k.code));

  select coalesce(jsonb_agg(jsonb_build_object('code', k.code, 'activity', k.activity, 'visits', k.visits,
                                               'deleted_at', d.deleted_at, 'deleted_by', d.deleted_by) order by k.visits desc), '[]'::jsonb)
    into v_deleted
    from _mvk k join app.kpi_rule_dismissed d on d.code = k.code
   where not exists (select 1 from public.kpi_point_rules r where r.code = k.code);

  if v_apply and jsonb_array_length(v_new) > 0 then
    select coalesce(max(sort_order), 0) into v_sort from public.kpi_point_rules;
    insert into public.kpi_point_rules (code, category, sub_category, description, points, unit, active, is_system, sort_order, updated_by, updated_at)
    -- a task deleted before comes back exactly as it was; a new one comes at 0 points, inactive
    select e->>'code',
           coalesce(d.rule->>'category', e->>'category'),
           left(coalesce(d.rule->>'sub_category', e->>'sub_category'), 120),
           coalesce(d.rule->>'description', 'Merchant Visit app: ' || (e->>'activity') || ' - added by Sync; set the points, then switch it on'),
           coalesce((d.rule->>'points')::numeric, 0), coalesce(d.rule->>'unit', 'per visit'),
           coalesce((d.rule->>'active')::boolean, false), coalesce((d.rule->>'is_system')::boolean, false),
           coalesce((d.rule->>'sort_order')::int, v_sort + 10 * (row_number() over (order by (e->>'visits')::int desc, e->>'code'))::int),
           me.name, now()
      from jsonb_array_elements(v_new) e
      left join app.kpi_rule_dismissed d on d.code = e->>'code'
    on conflict (code) do nothing;
    get diagnostics v_added = row_count;
    delete from app.kpi_rule_dismissed d where d.code in (select e->>'code' from jsonb_array_elements(v_new) e);
    if to_regclass('app.kpi_summary_cache') is not null then
      delete from app.kpi_summary_cache;
    end if;
    insert into public.audit_logs (title, detail, branch_id, action, target, actor_id, actor_emp, actor_name, role, status)
    values ('KPI Tasks Synced from Merchant Visit',
            'Added ' || v_added || ' task(s): ' || (select string_agg(e->>'sub_category', ', ') from jsonb_array_elements(v_new) e),
            '100', 'KPI_RULE_SYNC', 'kpi_point_rules', me.user_id, me.emp_id, me.name, me.role, 'Success');
  end if;

  return jsonb_build_object(
    'applied', v_apply, 'added', v_added, 'new', v_new, 'deleted_skipped', case when v_incl then '[]'::jsonb else v_deleted end,
    'activities_checked', (select count(*) from _mvk), 'already_have_rule', v_known,
    'rules', case when v_apply then (select coalesce(jsonb_agg(to_jsonb(r) order by r.sort_order), '[]'::jsonb)
                                       from public.kpi_point_rules r where r.code in (select e->>'code' from jsonb_array_elements(v_new) e))
                  else '[]'::jsonb end);
end $$;
revoke all on function public.kpi_sync_from_mv(jsonb) from public, anon;
grant execute on function public.kpi_sync_from_mv(jsonb) to authenticated;

notify pgrst, 'reload schema';

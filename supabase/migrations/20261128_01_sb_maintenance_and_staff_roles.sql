-- (28 Nov 2026) 1. Sound Box Maintenance becomes its own KPI task   2. "Sync POS & Sound Box" finds form tasks with no KPI task
--               3. Management Level (KPI exemption) is kept in the database and set in the Staff Directory
--
-- 1. Sound Box Maintenance (SBM-, the checklist visit) and SB Operational Support (SBO-) are both saved as SB_MAINT, so the
--    KPI page counted every Sound Box Maintenance visit under "Sound Box Operational Support". Nothing changes until the
--    KPI task "Sound Box Maintenance" (code SB_MAINTENANCE) exists and is Active: press "Sync POS & Sound Box" in
--    Settings -> KPI Points & Rules, check the points (it starts at the points these visits earn today), switch it on.
--    From then on the SBM- visits count under Sound Box Maintenance; SB Operational Support keeps the SBO- visits.
--    Every other figure stays exactly as it is.
-- 2. public.kpi_sync_from_mv takes {"source": "field"}: the tasks of the POS Terminal and Sound Box forms (Merchant Visit app)
--    instead of the visit activities. The existing "Sync from Merchant Visit" button is unchanged.
-- 3. The Management Level list (0 target, non-mandatory) was kept in each browser only (another computer did not see it).
--    It is now a database list: public.kpi_management_list() (any signed-in user, for the KPI page) and
--    public.kpi_management_set() (Admin HQ, from the Staff Directory). The portal copies a browser's old list in once.
--
-- Safe to run more than once. Nothing is deleted.

-- ── 1a. Which KPI task a POS / Sound Box form record counts as ─────────────────────────────────────────────────────
-- p_on: the Active KPI task codes (as JSON keys); null = every specific task (used by Sync to find what is missing).
-- Same results as before for every record, except SBM- visits -> SB_MAINTENANCE when that task is Active.
-- A plain SQL expression on purpose (no SET options): PostgreSQL copies it into the KPI queries, so it costs nothing extra.
create or replace function app.kpi_field_code(p_kind text, p_device text, p_rec text, p_payload jsonb, p_remarks text, p_on jsonb)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when p_kind = 'SB_MAINT' and (p_rec ilike 'SBM-%' or (p_payload -> 'entry') ? 'checks')
     and (p_on is null or p_on ? 'SB_MAINTENANCE') then 'SB_MAINTENANCE'
    when p_kind in ('POS_MAINT', 'MAINT') or (coalesce(p_device, '') = 'POS Terminal' and p_kind ilike '%maint%') then
      case
        when coalesce(p_payload->>'request_type', p_payload->'entry'->>'request_type', p_payload->'unit'->>'request_type', p_remarks) ilike '%inspect%' then 'POS_OP_INSPECT'
        when coalesce(p_payload->>'request_type', p_payload->'entry'->>'request_type', p_payload->'unit'->>'request_type', p_remarks) ilike '%train%' then 'POS_OP_TRAIN'
        when coalesce(p_payload->>'request_type', p_payload->'entry'->>'request_type', p_payload->'unit'->>'request_type', p_remarks) ilike '%paper%' then 'POS_OP_PAPER'
        when coalesce(p_payload->>'request_type', p_payload->'entry'->>'request_type', p_payload->'unit'->>'request_type', p_remarks) ilike '%add%mat%' then 'POS_OP_ADD_MAT'
        when coalesce(p_payload->>'request_type', p_payload->'entry'->>'request_type', p_payload->'unit'->>'request_type', p_remarks) ilike '%return%mat%' then 'POS_OP_RET_MAT'
        when coalesce(p_payload->>'request_type', p_payload->'entry'->>'request_type', p_payload->'unit'->>'request_type') ilike '%other%' then 'POS_OP_OTHERS'
        else 'POS_MAINT'
      end
    when p_kind = 'SB_MAINT' or (p_device = 'Sound Box' and p_kind ilike '%maint%') then
      case
        when coalesce(p_payload->>'request_type', p_payload->'entry'->>'request_type', p_payload->'unit'->>'request_type') is null then 'SB_MAINT'
        when coalesce(p_payload->>'request_type', p_payload->'entry'->>'request_type', p_payload->'unit'->>'request_type', p_remarks) ilike '%inspect%' then 'SB_OP_INSPECT'
        when coalesce(p_payload->>'request_type', p_payload->'entry'->>'request_type', p_payload->'unit'->>'request_type', p_remarks) ilike '%train%' then 'SB_OP_TRAIN'
        when coalesce(p_payload->>'request_type', p_payload->'entry'->>'request_type', p_payload->'unit'->>'request_type', p_remarks) ilike '%battery%' then 'SB_OP_BATTERY'
        when coalesce(p_payload->>'request_type', p_payload->'entry'->>'request_type', p_payload->'unit'->>'request_type', p_remarks) ilike '%add%mat%' then 'SB_OP_ADD_MAT'
        when coalesce(p_payload->>'request_type', p_payload->'entry'->>'request_type', p_payload->'unit'->>'request_type', p_remarks) ilike '%return%mat%' then 'SB_OP_RET_MAT'
        when coalesce(p_payload->>'request_type', p_payload->'entry'->>'request_type', p_payload->'unit'->>'request_type') ilike '%other%' then 'SB_OP_OTHERS'
        else 'SB_MAINT'
      end
    else p_kind
  end
$$;
revoke all on function app.kpi_field_code(text, text, text, jsonb, text, jsonb) from public, anon, authenticated;

-- ── 1b. The KPI calculations use it (the live function text is patched; each change is checked before it is saved) ──
do $patch$
declare
  f text; t text; t0 text; s int; e int; n int;
  v_call text;
  v_block text;
begin
  -- the two KPI summaries (staff table, series): a variable with the Active task codes, the Sound Box column, the task code
  foreach f in array array['app.kpi_dashboard_staff_only(date,date)', 'app.kpi_dashboard_summary_compute(date,date)'] loop
    t := pg_get_functiondef(f::regprocedure);
    if position('app.kpi_field_code(' in t) > 0 then
      raise notice '% already uses app.kpi_field_code', f;
      continue;
    end if;
    t0 := t;
    v_call := 'app.kpi_field_code(fe.kind, fe.device_type, fe.source_record_id, fe.payload, fe.remarks, v_fc_on)';
    -- (a) the variable
    if regexp_count(t, '\mdeclare\s', 1, 'i') < 1 then raise exception '%: no declare section', f; end if;
    t := regexp_replace(t, '(\mdeclare\s)',
      E'\\1  v_fc_on jsonb := (select coalesce(jsonb_object_agg(r.code, true), ''{}''::jsonb) from public.kpi_point_rules r where r.active);   -- (28 Nov 2026)\n', 'i');
    -- (b) the Sound Box Operational Support column keeps only what still counts as SB_MAINT
    n := regexp_count(t, $re$\(case when fe\.device_type = 'Sound Box' and fe\.kind = 'SB_MAINT' and fe\.status in \('APPROVED', 'PENDING'\) then 1 else 0 end\) as sb_maint$re$);
    if n <> 1 then raise exception '%: Sound Box column found % times (expected 1)', f, n; end if;
    t := regexp_replace(t, $re$\(case when fe\.device_type = 'Sound Box' and fe\.kind = 'SB_MAINT' and fe\.status in \('APPROVED', 'PENDING'\) then 1 else 0 end\) as sb_maint$re$,
      '(case when fe.device_type = ''Sound Box'' and fe.kind = ''SB_MAINT'' and fe.status in (''APPROVED'', ''PENDING'') and ' || v_call || ' = ''SB_MAINT'' then 1 else 0 end) as sb_maint');
    -- (c) the task code of the record
    n := regexp_count(t, $re$when fe\.kind not in \('INSTALL', 'REPLACE', 'BATTERY', 'SB_RETURN'\)$re$);
    if n <> 1 then raise exception '%: task code block found % times (expected 1)', f, n; end if;
    s := regexp_instr(t, $re$when fe\.kind not in \('INSTALL', 'REPLACE', 'BATTERY', 'SB_RETURN'\)$re$);
    e := regexp_instr(t, $re$else fe\.kind\s+end$re$, s, 1, 1);
    if e = 0 or e - s > 9000 then raise exception '%: end of the task code block not found', f; end if;
    v_block := 'when fe.kind not in (''INSTALL'', ''REPLACE'', ''BATTERY'', ''SB_RETURN'') and fe.status in (''APPROVED'', ''PENDING'')'
            || E'\n         and ' || v_call || ' <> ''SB_MAINT''   -- (28 Nov 2026) app.kpi_field_code'
            || E'\n        then ' || v_call;
    t := substr(t, 1, s - 1) || v_block || substr(t, e);
    if t = t0 then raise exception '%: nothing changed', f; end if;
    execute t;
    raise notice '% updated', f;
  end loop;

  -- the points per record (booth share, Booth Event column)
  foreach f in array array['app.kpi_event_points(timestamptz,timestamptz,text[])', 'app.kpi_event_points_cat(timestamptz,timestamptz,text[])'] loop
    t := pg_get_functiondef(f::regprocedure);
    if position('app.kpi_field_code(' in t) > 0 then
      raise notice '% already uses app.kpi_field_code', f;
      continue;
    end if;
    t0 := t;
    v_call := 'app.kpi_field_code(fe.kind, fe.device_type, fe.source_record_id, fe.payload, fe.remarks, m)';
    n := regexp_count(t, $re$when fe\.device_type = 'Sound Box' and fe\.kind = 'SB_MAINT' then coalesce\(\(m->>'SB_MAINT'\)::numeric, 0\)$re$);
    if n <> 1 then raise exception '%: Sound Box points found % times (expected 1)', f, n; end if;
    t := regexp_replace(t, $re$when fe\.device_type = 'Sound Box' and fe\.kind = 'SB_MAINT' then coalesce\(\(m->>'SB_MAINT'\)::numeric, 0\)$re$,
      'when fe.device_type = ''Sound Box'' and fe.kind = ''SB_MAINT'' and ' || v_call || ' = ''SB_MAINT'' then coalesce((m->>''SB_MAINT'')::numeric, 0)');
    n := regexp_count(t, $re$when fe\.kind not in \('INSTALL', 'REPLACE', 'BATTERY', 'SB_RETURN'\)$re$);
    if n <> 1 then raise exception '%: task code block found % times (expected 1)', f, n; end if;
    s := regexp_instr(t, $re$when fe\.kind not in \('INSTALL', 'REPLACE', 'BATTERY', 'SB_RETURN'\)$re$);
    e := regexp_instr(t, $re$else fe\.kind\s+end$re$, s, 1, 1);
    if e = 0 or e - s > 9000 then raise exception '%: end of the task code block not found', f; end if;
    v_block := 'when fe.kind not in (''INSTALL'', ''REPLACE'', ''BATTERY'', ''SB_RETURN'') and fe.status in (''APPROVED'', ''PENDING'')'
            || E'\n           and ' || v_call || ' <> ''SB_MAINT''   -- (28 Nov 2026) app.kpi_field_code'
            || E'\n          then ' || v_call;
    t := substr(t, 1, s - 1) || v_block || substr(t, e);
    if t = t0 then raise exception '%: nothing changed', f; end if;
    execute t;
    raise notice '% updated', f;
  end loop;
end $patch$;

-- ── 2. Sync: {"source": "field"} = the POS Terminal / Sound Box form tasks ───────────────────────────────────────────
create or replace function public.kpi_sync_from_mv(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '30s'
as $function$
declare
  me public.staff_profiles;
  v_apply boolean := coalesce((p->>'apply')::boolean, false);
  v_incl boolean := coalesce((p->>'include_deleted')::boolean, false);
  v_field boolean := coalesce(p->>'source', 'mv') = 'field';
  v_src text;
  v_new jsonb; v_deleted jsonb; v_known int; v_sort int; v_added int := 0;
begin
  select * into me from public.staff_profiles where user_id = auth.uid() and active and not must_change_password;
  if not found or me.role <> 'SUPER_ADMIN' then
    raise exception 'Only a Super Admin can sync KPI tasks.' using errcode = '42501';
  end if;
  v_src := case when v_field then 'POS & Sound Box forms' else 'Merchant Visit' end;

  drop table if exists pg_temp._mvk;
  if v_field then
    -- (28 Nov 2026) the POS Terminal and Sound Box forms: the task each record would count as when its task exists
    -- (dflt = the points the record earns today, so a new task starts with the same points)
    create temp table _mvk on commit drop as
    select x.code,
           min(case when x.code = 'SB_MAINTENANCE' then 'Sound Box Maintenance'
                    else coalesce(x.rt, initcap(replace(lower(x.code), '_', ' '))) end) as activity,
           count(*)::int as visits, max(x.ts) as last_seen, false as booth, false as standby,
           max(r.points) as dflt
      from (select app.kpi_field_code(fe.kind, fe.device_type, fe.source_record_id, fe.payload, fe.remarks, null) as code,
                   app.kpi_field_code(fe.kind, fe.device_type, fe.source_record_id, fe.payload, fe.remarks, '{}'::jsonb) as today_code,
                   coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type') as rt,
                   coalesce(fe.recorded_at, fe.received_at) as ts
              from public.field_events fe
             where fe.kind not in ('INSTALL', 'REPLACE', 'BATTERY', 'POS_OFFLINE')
               and fe.status in ('APPROVED', 'PENDING')) x
      left join public.kpi_point_rules r on r.code = x.today_code
     group by x.code;
  else
    create temp table _mvk on commit drop as
    select app.kpi_mv_rule_code(m.activity, m.answers, m.remarks) as code,
           min(m.activity) as activity, count(*)::int as visits,
           max(m.submitted_at) as last_seen,
           bool_or(m.activity = 'Booth Event') as booth, bool_or(m.activity = 'Standby VIP Merchant') as standby,
           null::numeric as dflt
      from public.mv_visits m
     group by 1;
  end if;

  select count(*) into v_known from _mvk k where exists (select 1 from public.kpi_point_rules r where r.code = k.code);

  select coalesce(jsonb_agg(jsonb_build_object(
           'code', k.code, 'activity', k.activity, 'visits', k.visits, 'last_seen', k.last_seen, 'points', coalesce(k.dflt, 0),
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
    -- a task deleted before comes back exactly as it was; a new one comes inactive (form tasks at the points they earn today, visits at 0)
    select e->>'code',
           coalesce(d.rule->>'category', e->>'category'),
           left(coalesce(d.rule->>'sub_category', e->>'sub_category'), 120),
           coalesce(d.rule->>'description', case when v_field
             then 'POS / Sound Box form: ' || (e->>'activity') || ' - added by Sync; check the points, then switch it on'
             else 'Merchant Visit app: ' || (e->>'activity') || ' - added by Sync; set the points, then switch it on' end),
           coalesce((d.rule->>'points')::numeric, (e->>'points')::numeric, 0), coalesce(d.rule->>'unit', 'per visit'),
           coalesce((d.rule->>'active')::boolean, false), coalesce((d.rule->>'is_system')::boolean, false),
           coalesce((d.rule->>'sort_order')::int, v_sort + 10 * (row_number() over (order by (e->>'visits')::int desc, e->>'code'))::int),
           me.name, now()
      from jsonb_array_elements(v_new) e
      left join app.kpi_rule_dismissed d on d.code = e->>'code'
    on conflict (code) do nothing;
    get diagnostics v_added = row_count;
    delete from app.kpi_rule_dismissed d where d.code in (select e->>'code' from jsonb_array_elements(v_new) e);
    if to_regclass('app.kpi_summary_cache') is not null then
      delete from app.kpi_summary_cache where true;
    end if;
    insert into public.audit_logs (title, detail, branch_id, action, target, actor_id, actor_emp, actor_name, role, status)
    values ('KPI Tasks Synced from ' || v_src,
            'Added ' || v_added || ' task(s): ' || (select string_agg(e->>'sub_category', ', ') from jsonb_array_elements(v_new) e),
            '100', 'KPI_RULE_SYNC', 'kpi_point_rules', me.user_id, me.emp_id, me.name, me.role, 'Success');
  end if;

  return jsonb_build_object(
    'applied', v_apply, 'added', v_added, 'new', v_new, 'deleted_skipped', case when v_incl then '[]'::jsonb else v_deleted end,
    'activities_checked', (select count(*) from _mvk), 'already_have_rule', v_known, 'source', case when v_field then 'field' else 'mv' end,
    'rules', case when v_apply then (select coalesce(jsonb_agg(to_jsonb(r) order by r.sort_order), '[]'::jsonb)
                                       from public.kpi_point_rules r where r.code in (select e->>'code' from jsonb_array_elements(v_new) e))
                  else '[]'::jsonb end);
end $function$;
revoke all on function public.kpi_sync_from_mv(jsonb) from public, anon;
grant execute on function public.kpi_sync_from_mv(jsonb) to authenticated, service_role;

-- ── 3. Management Level (KPI exemption: 0 target, non-mandatory), set in the Staff Directory ─────────────────────────
create table if not exists public.kpi_management_staff (
  staff_id   text primary key check (staff_id ~ '^[A-Za-z0-9._-]{1,40}$'),
  staff_name text not null default '' check (char_length(staff_name) <= 120),
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.kpi_management_staff enable row level security;
revoke all on public.kpi_management_staff from anon, authenticated;

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
  return coalesce((select jsonb_agg(jsonb_build_object('staff_id', m.staff_id, 'staff_name', m.staff_name,
                                                       'updated_by', m.updated_by, 'updated_at', m.updated_at) order by m.staff_name, m.staff_id)
                     from public.kpi_management_staff m), '[]'::jsonb);
end $function$;
revoke all on function public.kpi_management_list() from public, anon;
grant execute on function public.kpi_management_list() to authenticated, service_role;

-- p = {"items": [{"staff_id": "8986", "staff_name": "...", "on": true}, ...]}   (on = false removes)
create or replace function public.kpi_management_set(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  e jsonb; v_id text; v_on boolean; v_set int := 0; v_off int := 0; v_names text := '';
begin
  if not app.is_admin() then raise exception 'Only Admin HQ can change the Management Level list.' using errcode = '42501'; end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') > 500 then
    raise exception 'Send a list of up to 500 staff.' using errcode = '22023';
  end if;
  for e in select x from jsonb_array_elements(p->'items') x loop
    v_id := btrim(coalesce(e->>'staff_id', ''));
    if v_id !~ '^[A-Za-z0-9._-]{1,40}$' then raise exception 'Not a Staff ID: %', left(v_id, 40) using errcode = '22023'; end if;
    v_on := coalesce((e->>'on')::boolean, true);
    if v_on then
      insert into public.kpi_management_staff (staff_id, staff_name, updated_by, updated_at)
      values (v_id, left(btrim(coalesce(e->>'staff_name', '')), 120), app.label(), now())
      on conflict (staff_id) do update set staff_name = case when excluded.staff_name <> '' then excluded.staff_name else public.kpi_management_staff.staff_name end,
                                           updated_by = excluded.updated_by, updated_at = now();
      v_set := v_set + 1;
    else
      delete from public.kpi_management_staff where staff_id = v_id;
      if found then v_off := v_off + 1; end if;
    end if;
    v_names := v_names || case when v_names = '' then '' else ', ' end || v_id || case when v_on then ' on' else ' off' end;
  end loop;
  if v_set + v_off > 0 then
    insert into public.audit_logs (title, detail, action, target, branch_id)
    values ('KPI Management Level Changed', left(v_names, 1000), 'KPI_MANAGEMENT_SET', 'kpi_management_staff', '100');
  end if;
  return jsonb_build_object('ok', true, 'set', v_set, 'removed', v_off);
end $function$;
revoke all on function public.kpi_management_set(jsonb) from public, anon;
grant execute on function public.kpi_management_set(jsonb) to authenticated, service_role;

-- the KPI figures are rebuilt on the next request (the Sound Box column may change once SB_MAINTENANCE is Active)
delete from app.kpi_summary_cache where true;

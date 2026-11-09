-- 20261109_03_kpi_sb_operational_support_and_all_types.sql
-- Renames "Sound Box Maintenance" (SB_MAINT) to "Sound Box Operational Support" to match POS Operational Support,
-- ensures all POS Terminal and Sound Box task types are active in KPI rules,
-- and enhances public.kpi_dashboard_summary to track all POS & SB field activity kinds and daily totals.

-- 1. Rename SB_MAINT in public.kpi_point_rules
update public.kpi_point_rules
   set sub_category = 'Sound Box Operational Support',
       description  = 'Sound Box operational support, sound check & QR stand inspection',
       updated_by   = 'system',
       updated_at   = now()
 where code = 'SB_MAINT';

-- 2. Ensure all POS and Sound Box tasks are active
update public.kpi_point_rules
   set active = true
 where code in (
   'POS_INSTALL', 'POS_REPLACE', 'POS_BATTERY', 'POS_MAINT', 'POS_INACTIVE', 'POS_RETURN', 'POS_ADAPTOR', 'POS_STAND', 'POS_DOCK',
   'SB_INSTALL', 'SB_REPLACE', 'SB_MAINT', 'SB_RETURN', 'SB_ADAPTOR'
 );

-- 3. Enhance public.kpi_dashboard_summary to count all non-base field event kinds and include Sound Box tasks in daily branch & staff totals
create or replace function public.kpi_dashboard_summary(p_since date default null, p_until date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb := public.kpi_dashboard_summary_base(p_since, p_until);   -- (also checks the reader's account)
  t jsonb := coalesce(v->'targets', '{}'::jsonb);
  v_wk boolean := coalesce(t->>'working_days_mode', 'mon_fri') = 'mon_fri';
  v_hol boolean := coalesce((t->>'exclude_holidays')::boolean, true);
  v_today date := (now() at time zone 'Asia/Phnom_Penh')::date;
  v_from24 timestamptz := (date_trunc('month', now() at time zone 'Asia/Phnom_Penh') - interval '24 months') at time zone 'Asia/Phnom_Penh';
  v_zero jsonb := '{"pos_install":0,"pos_replace":0,"pos_battery":0,"sb_install":0,"sb_replace":0,"sb_maint":0,"sb_return":0,"khqr_install":0,"khqr_replace":0,"khqr_materials":0,"cc_primary":0,"cc_supp":0}'::jsonb;
  v_staff jsonb; v_daily jsonb; v_weekly jsonb; v_monthly jsonb; v_quarterly jsonb; v_ms jsonb; v_db jsonb; v_ds jsonb;
begin
  -- the new activities (active rules only), one row per task
  create temporary table if not exists kpi_x (staff_id text, staff_name text, branch_id text, branch_text text, d date, code text, cat text) on commit drop;
  truncate kpi_x;
  insert into kpi_x
  select e.staff_id, e.staff_name, e.branch_id, e.branch_text, e.d, e.code, r.category
    from (
      select coalesce(nullif(trim(fe.staff_id), ''), 'UNKNOWN') staff_id, nullif(trim(fe.staff_name), '') staff_name,
             coalesce(fe.branch_id, app.resolve_branch(fe.branch_text), 'UNASSIGNED') branch_id, nullif(trim(fe.branch_text), '') branch_text,
             (coalesce(fe.recorded_at, fe.received_at) at time zone 'Asia/Phnom_Penh')::date d, fe.kind code
        from public.field_events fe
       where fe.kind not in ('INSTALL', 'REPLACE', 'BATTERY', 'SB_MAINT', 'SB_RETURN') and fe.status in ('APPROVED', 'PENDING')
         and coalesce(fe.recorded_at, fe.received_at) >= v_from24 - interval '1 day'
      union all
      select coalesce(nullif(trim(m.staff_id), ''), 'UNKNOWN'), nullif(trim(m.staff_name), ''),
             coalesce(m.branch_id, app.resolve_branch(m.branch_text), 'UNASSIGNED'), nullif(trim(m.branch_text), ''),
             (m.submitted_at at time zone 'Asia/Phnom_Penh')::date, app.kpi_mv_code(m.activity)
        from public.mv_visits m
       where m.submitted_at >= v_from24 - interval '1 day'
    ) e
    join public.kpi_point_rules r on r.code = e.code and r.active
   where e.staff_id <> 'UNKNOWN';

  -- staff of the chosen period (same date and working-day rules as the base)
  with x as (
    select * from kpi_x k
     where (p_since is null or k.d >= p_since) and (p_until is null or k.d <= p_until)
       and (not v_wk or extract(isodow from k.d) not in (6, 7))
       and (not v_hol or public.get_cambodia_holiday_name(k.d) is null)),
  ex as (
    select s.staff_id, jsonb_object_agg(s.code, s.n) extra, max(s.staff_name) staff_name, max(s.branch_id) branch_id, max(s.branch_text) branch_text
      from (select staff_id, code, count(*) n, max(staff_name) staff_name, max(branch_id) branch_id, max(branch_text) branch_text from x group by 1, 2) s group by 1),
  base as (select e.value obj, e.value->>'staff_id' k, e.ordinality o from jsonb_array_elements(coalesce(v->'staff', '[]'::jsonb)) with ordinality e)
  select coalesce(jsonb_agg(
           case when b.obj is not null then b.obj || jsonb_build_object('extra', coalesce(ex.extra, '{}'::jsonb))
                else v_zero || jsonb_build_object('staff_id', ex.staff_id, 'staff_name', coalesce(sp.name, ex.staff_name, ex.staff_id),
                  'branch_id', coalesce(sp.branch_id, ex.branch_id, 'UNASSIGNED'), 'branch_name', coalesce(br.name, ex.branch_text, 'Unassigned'),
                  'pos_submitted', 0, 'pos_rejected', 0, 'sb_submitted', 0, 'sb_rejected', 0, 'khqr_failed', 0, 'cc_submitted', 0, 'cc_rejected', 0,
                  'extra', ex.extra) end
           order by b.o nulls last, coalesce(sp.name, ex.staff_name)), '[]'::jsonb)
    into v_staff
    from base b full join ex on ex.staff_id = b.k
    left join public.staff_profiles sp on b.obj is null and sp.emp_id = ex.staff_id
    left join public.branches br on b.obj is null and br.id = coalesce(sp.branch_id, ex.branch_id);

  -- periods (same windows as the base)
  select public.kpi_extra_merge(v->'daily', 'period', (select jsonb_object_agg(p, e) from (select p, jsonb_object_agg(code, n) e from (
      select k.d::text p, code, count(*) n from kpi_x k where k.d >= v_today - 89 group by 1, 2) a group by p) z), v_zero) into v_daily;
  select public.kpi_extra_merge(v->'weekly', 'period', (select jsonb_object_agg(p, e) from (select p, jsonb_object_agg(code, n) e from (
      select date_trunc('week', k.d::timestamp)::date::text p, code, count(*) n from kpi_x k
       where k.d >= (date_trunc('week', now() at time zone 'Asia/Phnom_Penh')::date - interval '11 weeks')::date group by 1, 2) a group by p) z), v_zero) into v_weekly;
  select public.kpi_extra_merge(v->'monthly', 'period', (select jsonb_object_agg(p, e) from (select p, jsonb_object_agg(code, n) e from (
      select to_char(k.d, 'YYYY-MM') p, code, count(*) n from kpi_x k
       where k.d >= (date_trunc('month', now() at time zone 'Asia/Phnom_Penh')::date - interval '11 months')::date group by 1, 2) a group by p) z), v_zero) into v_monthly;
  select public.kpi_extra_merge(v->'quarterly', 'period', (select jsonb_object_agg(p, e) from (select p, jsonb_object_agg(code, n) e from (
      select to_char(date_trunc('quarter', k.d::timestamp)::date, 'YYYY-"Q"Q') p, code, count(*) n from kpi_x k
       where k.d >= (date_trunc('quarter', now() at time zone 'Asia/Phnom_Penh')::date - interval '21 months')::date group by 1, 2) a group by p) z), v_zero) into v_quarterly;

  -- staff per month (5 months, working days only, as the base)
  with x as (
    select * from kpi_x k where k.d >= (date_trunc('month', now() at time zone 'Asia/Phnom_Penh')::date - interval '5 months')::date
       and (not v_wk or extract(isodow from k.d) not in (6, 7)) and (not v_hol or public.get_cambodia_holiday_name(k.d) is null)),
  ex as (
    select s.m, s.staff_id, jsonb_object_agg(s.code, s.n) extra, max(s.staff_name) staff_name, max(s.branch_id) branch_id, max(s.branch_text) branch_text
      from (select to_char(d, 'YYYY-MM') m, staff_id, code, count(*) n, max(staff_name) staff_name, max(branch_id) branch_id, max(branch_text) branch_text
              from x group by 1, 2, 3) s group by 1, 2),
  base as (select e.value obj, e.value->>'month' m, e.value->>'staff_id' k, e.ordinality o from jsonb_array_elements(coalesce(v->'monthly_staff', '[]'::jsonb)) with ordinality e)
  select coalesce(jsonb_agg(
           case when b.obj is not null then b.obj || jsonb_build_object('extra', coalesce(ex.extra, '{}'::jsonb))
                else v_zero || jsonb_build_object('month', ex.m, 'staff_id', ex.staff_id, 'staff_name', coalesce(sp.name, ex.staff_name, ex.staff_id),
                  'branch_id', coalesce(sp.branch_id, ex.branch_id, 'UNASSIGNED'), 'branch_name', coalesce(br.name, ex.branch_text, 'Unassigned'), 'extra', ex.extra) end
           order by coalesce(b.m, ex.m) desc, coalesce(b.k, ex.staff_id)), '[]'::jsonb)
    into v_ms
    from base b full join ex on ex.m = b.m and ex.staff_id = b.k
    left join public.staff_profiles sp on b.obj is null and sp.emp_id = ex.staff_id
    left join public.branches br on b.obj is null and br.id = coalesce(sp.branch_id, ex.branch_id);

  -- daily task totals per branch and per staff (5 months)
  with x as (select * from kpi_x k where k.d >= (date_trunc('month', now() at time zone 'Asia/Phnom_Penh')::date - interval '5 months')::date),
  ex as (select d::text as day, branch_id, count(*) n,
                count(*) filter (where cat = 'POS Terminal') pos_n,
                count(*) filter (where cat = 'Sound Box') sb_n,
                count(*) filter (where cat = 'Merchant Visit') mv_n,
                count(distinct staff_id) staff_n from x group by 1, 2),
  base as (select e.value obj, e.value->>'day' dy, e.value->>'branch_id' k, e.ordinality o from jsonb_array_elements(coalesce(v->'daily_branch', '[]'::jsonb)) with ordinality e)
  select coalesce(jsonb_agg(
           case when b.obj is not null then b.obj || jsonb_build_object(
                  'total_tasks', (b.obj->>'total_tasks')::int + coalesce(ex.n, 0),
                  'pos_tasks', (b.obj->>'pos_tasks')::int + coalesce(ex.pos_n, 0),
                  'sb_tasks', (b.obj->>'sb_tasks')::int + coalesce(ex.sb_n, 0),
                  'mv_tasks', coalesce(ex.mv_n, 0))
                else jsonb_build_object('day', ex.day, 'branch_id', ex.branch_id, 'active_staff', ex.staff_n,
                  'total_tasks', ex.n, 'pos_tasks', ex.pos_n, 'sb_tasks', ex.sb_n, 'khqr_tasks', 0, 'cc_tasks', 0, 'mv_tasks', ex.mv_n) end
           order by coalesce(b.dy, ex.day) desc, coalesce(b.k, ex.branch_id)), '[]'::jsonb)
    into v_db
    from base b full join ex on ex.day = b.dy and ex.branch_id = b.k;

  with x as (select * from kpi_x k where k.d >= (date_trunc('month', now() at time zone 'Asia/Phnom_Penh')::date - interval '5 months')::date),
  ex as (select d::text as day, staff_id, count(*) n,
                count(*) filter (where cat = 'POS Terminal') pos_n,
                count(*) filter (where cat = 'Sound Box') sb_n,
                count(*) filter (where cat = 'Merchant Visit') mv_n,
                max(staff_name) staff_name, max(branch_id) branch_id, max(branch_text) branch_text from x group by 1, 2),
  base as (select e.value obj, e.value->>'day' dy, e.value->>'staff_id' k from jsonb_array_elements(coalesce(v->'daily_staff', '[]'::jsonb)) e)
  select coalesce(jsonb_agg(
           case when b.obj is not null then b.obj || jsonb_build_object(
                  'total_tasks', (b.obj->>'total_tasks')::int + coalesce(ex.n, 0),
                  'pos_tasks', (b.obj->>'pos_tasks')::int + coalesce(ex.pos_n, 0),
                  'sb_tasks', (b.obj->>'sb_tasks')::int + coalesce(ex.sb_n, 0),
                  'mv_tasks', coalesce(ex.mv_n, 0))
                else jsonb_build_object('day', ex.day, 'staff_id', ex.staff_id, 'staff_name', coalesce(sp.name, ex.staff_name, ex.staff_id),
                  'branch_id', coalesce(sp.branch_id, ex.branch_id, 'UNASSIGNED'), 'branch_name', coalesce(br.name, ex.branch_text, 'Unassigned'),
                  'total_tasks', ex.n, 'pos_tasks', ex.pos_n, 'sb_tasks', ex.sb_n, 'khqr_tasks', 0, 'cc_tasks', 0, 'mv_tasks', ex.mv_n) end
           order by coalesce(b.dy, ex.day) desc, coalesce(b.k, ex.staff_id)), '[]'::jsonb)
    into v_ds
    from base b full join ex on ex.day = b.dy and ex.staff_id = b.k
    left join public.staff_profiles sp on b.obj is null and sp.emp_id = ex.staff_id
    left join public.branches br on b.obj is null and br.id = coalesce(sp.branch_id, ex.branch_id);

  return v || jsonb_build_object('staff', v_staff, 'daily', v_daily, 'weekly', v_weekly, 'monthly', v_monthly, 'quarterly', v_quarterly,
                                 'monthly_staff', v_ms, 'daily_branch', v_db, 'daily_staff', v_ds);
end $$;

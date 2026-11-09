-- 20261109_04_kpi_operational_subtypes_and_onboarding_fail.sql
-- 1. Defines granular KPI Sub-Categories / KPI Tasks for POS and Sound Box Operational Support request types:
--    - POS Operational Support: POS Terminal Inspection, Refreshment Training, Request Paper Roll, Request Add Material, Request Return Materials, Others
--    - Sound Box Operational Support: SB Inspection, SB Refresh Training, Battery Replacement, Add Material, Returns Material, Others
-- 2. Defines Onboarding Failed KPI Sub-Categories:
--    - Credit Card Onboarding Failed (CC_ONBOARD_FAIL)
--    - KHQR Onboarding Failed (KHQR_ONBOARD_FAIL)
--    - Merchant Onboarding Failed (MV_ONBOARD_FAIL)
-- 3. Updates public.kpi_dashboard_summary to track and aggregate all these sub-tasks into extra, daily branch, and daily staff totals.

-- Step 1: Adjust sort order of later POS tasks to accommodate POS Operational sub-tasks cleanly
update public.kpi_point_rules set sort_order = 39 where code = 'POS_INACTIVE';
update public.kpi_point_rules set sort_order = 40 where code = 'POS_RETURN';
update public.kpi_point_rules set sort_order = 41 where code = 'POS_ADAPTOR';
update public.kpi_point_rules set sort_order = 42 where code = 'POS_STAND';
update public.kpi_point_rules set sort_order = 43 where code = 'POS_DOCK';

-- Step 2: Insert/Upsert new sub-category rules into public.kpi_point_rules
insert into public.kpi_point_rules (code, category, sub_category, description, points, unit, active, is_system, sort_order)
values
  -- POS Operational Support Sub-tasks
  ('POS_OP_INSPECT', 'POS Terminal', 'POS Terminal Inspection', 'POS Operational Support: POS Terminal Inspection at merchant', 2.0, 'per visit', true, true, 33),
  ('POS_OP_TRAIN', 'POS Terminal', 'Refreshment Training', 'POS Operational Support: Merchant staff refreshment training', 2.0, 'per visit', true, true, 34),
  ('POS_OP_PAPER', 'POS Terminal', 'Request Paper Roll', 'POS Operational Support: Request paper roll delivery to merchant', 1.0, 'per visit', true, true, 35),
  ('POS_OP_ADD_MAT', 'POS Terminal', 'Request Add Material', 'POS Operational Support: Request additional POS materials/collateral', 1.0, 'per visit', true, true, 36),
  ('POS_OP_RET_MAT', 'POS Terminal', 'Request Return Materials', 'POS Operational Support: Request return of POS materials', 1.0, 'per visit', true, true, 37),
  ('POS_OP_OTHERS', 'POS Terminal', 'Others (POS Support)', 'POS Operational Support: Other field operational requests', 1.0, 'per visit', true, true, 38),

  -- Sound Box Operational Support Sub-tasks
  ('SB_OP_INSPECT', 'Sound Box', 'SB Inspection', 'Sound Box Operational Support: SB Inspection at merchant counter', 2.0, 'per visit', true, true, 61),
  ('SB_OP_TRAIN', 'Sound Box', 'SB Refresh Training', 'Sound Box Operational Support: SB Refresh Training for merchant staff', 2.0, 'per visit', true, true, 62),
  ('SB_OP_BATTERY', 'Sound Box', 'Battery Replacement', 'Sound Box Operational Support: Battery replacement in the field', 2.0, 'per battery', true, true, 63),
  ('SB_OP_ADD_MAT', 'Sound Box', 'Add Material', 'Sound Box Operational Support: Add Sound Box material / QR collateral', 1.0, 'per visit', true, true, 64),
  ('SB_OP_RET_MAT', 'Sound Box', 'Returns Material', 'Sound Box Operational Support: Returns of Sound Box material', 1.0, 'per visit', true, true, 65),
  ('SB_OP_OTHERS', 'Sound Box', 'Others (SB Support)', 'Sound Box Operational Support: Other Sound Box field requests', 1.0, 'per visit', true, true, 66),

  -- Onboarding Fail rules
  ('KHQR_ONBOARD_FAIL', 'KHQR', 'KHQR Onboarding Failed', 'Merchant KHQR onboarding attempt failed or rejected', 0.0, 'per attempt', true, true, 105),
  ('CC_ONBOARD_FAIL', 'Credit Card', 'Credit Card Onboarding Failed', 'Credit card onboarding attempt marked as Onboarding Failed', 0.0, 'per application', true, true, 125),
  ('MV_ONBOARD_FAIL', 'Merchant Visit', 'Merchant Onboarding Failed', 'Merchant Visit app: Onboarding attempt failed or declined', 0.0, 'per visit', true, true, 134)
on conflict (code) do update set
  category = excluded.category,
  sub_category = excluded.sub_category,
  description = excluded.description,
  points = case when kpi_point_rules.points is not null and kpi_point_rules.points > 0 then kpi_point_rules.points else excluded.points end,
  unit = excluded.unit,
  sort_order = excluded.sort_order;

-- Step 3: Enhance public.kpi_dashboard_summary to aggregate new sub-tasks and onboarding failures
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
      -- 1. Field events (non-base and mapped operational support sub-tasks)
      select coalesce(nullif(trim(fe.staff_id), ''), 'UNKNOWN') staff_id, nullif(trim(fe.staff_name), '') staff_name,
             coalesce(fe.branch_id, app.resolve_branch(fe.branch_text), 'UNASSIGNED') branch_id, nullif(trim(fe.branch_text), '') branch_text,
             (coalesce(fe.recorded_at, fe.received_at) at time zone 'Asia/Phnom_Penh')::date d,
             case
               when fe.kind in ('POS_MAINT', 'MAINT') or (coalesce(fe.device_type, '') = 'POS Terminal' and fe.kind ilike '%maint%') then
                 case
                   when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type', fe.remarks) ilike '%inspect%' then 'POS_OP_INSPECT'
                   when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type', fe.remarks) ilike '%train%' then 'POS_OP_TRAIN'
                   when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type', fe.remarks) ilike '%paper%' then 'POS_OP_PAPER'
                   when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type', fe.remarks) ilike '%add%mat%' then 'POS_OP_ADD_MAT'
                   when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type', fe.remarks) ilike '%return%mat%' then 'POS_OP_RET_MAT'
                   when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type') ilike '%other%' then 'POS_OP_OTHERS'
                   else 'POS_MAINT'
                 end
               when fe.kind in ('SB_MAINT') or (fe.device_type = 'Sound Box' and fe.kind ilike '%maint%') then
                 case
                   when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type', fe.remarks) ilike '%inspect%' then 'SB_OP_INSPECT'
                   when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type', fe.remarks) ilike '%train%' then 'SB_OP_TRAIN'
                   when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type', fe.remarks) ilike '%battery%' then 'SB_OP_BATTERY'
                   when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type', fe.remarks) ilike '%add%mat%' then 'SB_OP_ADD_MAT'
                   when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type', fe.remarks) ilike '%return%mat%' then 'SB_OP_RET_MAT'
                   when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type') ilike '%other%' then 'SB_OP_OTHERS'
                   else 'SB_MAINT'
                 end
               else fe.kind
             end code
        from public.field_events fe
       where fe.kind not in ('INSTALL', 'REPLACE', 'BATTERY', 'SB_RETURN') and fe.status in ('APPROVED', 'PENDING')
         -- Note: if general SB_MAINT has no sub request_type, it is already counted in base sb_maint
         and not (fe.kind = 'SB_MAINT' and coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type') is null)
         and coalesce(fe.recorded_at, fe.received_at) >= v_from24 - interval '1 day'
      union all
      -- 2. Merchant Visits (including mapped sub-types for POS/SB operational support)
      select coalesce(nullif(trim(m.staff_id), ''), 'UNKNOWN'), nullif(trim(m.staff_name), ''),
             coalesce(m.branch_id, app.resolve_branch(m.branch_text), 'UNASSIGNED'), nullif(trim(m.branch_text), ''),
             (m.submitted_at at time zone 'Asia/Phnom_Penh')::date,
             case
               when m.activity ilike '%POS Operational Support%' or m.activity ilike '%POS Request%' then
                 case
                   when coalesce(m.answers->>'Request Type', m.answers->>'request_type', m.remarks) ilike '%inspect%' then 'POS_OP_INSPECT'
                   when coalesce(m.answers->>'Request Type', m.answers->>'request_type', m.remarks) ilike '%train%' then 'POS_OP_TRAIN'
                   when coalesce(m.answers->>'Request Type', m.answers->>'request_type', m.remarks) ilike '%paper%' then 'POS_OP_PAPER'
                   when coalesce(m.answers->>'Request Type', m.answers->>'request_type', m.remarks) ilike '%add%mat%' then 'POS_OP_ADD_MAT'
                   when coalesce(m.answers->>'Request Type', m.answers->>'request_type', m.remarks) ilike '%return%mat%' then 'POS_OP_RET_MAT'
                   when coalesce(m.answers->>'Request Type', m.answers->>'request_type', m.remarks) ilike '%other%' then 'POS_OP_OTHERS'
                   else 'POS_MAINT'
                 end
               when m.activity ilike '%SB Operational Support%' or m.activity ilike '%Sound Box Operational%' or m.activity ilike '%Sound Box Request%' then
                 case
                   when coalesce(m.answers->>'Request Type', m.answers->>'request_type', m.remarks) ilike '%inspect%' then 'SB_OP_INSPECT'
                   when coalesce(m.answers->>'Request Type', m.answers->>'request_type', m.remarks) ilike '%train%' then 'SB_OP_TRAIN'
                   when coalesce(m.answers->>'Request Type', m.answers->>'request_type', m.remarks) ilike '%battery%' then 'SB_OP_BATTERY'
                   when coalesce(m.answers->>'Request Type', m.answers->>'request_type', m.remarks) ilike '%add%mat%' then 'SB_OP_ADD_MAT'
                   when coalesce(m.answers->>'Request Type', m.answers->>'request_type', m.remarks) ilike '%return%mat%' then 'SB_OP_RET_MAT'
                   when coalesce(m.answers->>'Request Type', m.answers->>'request_type', m.remarks) ilike '%other%' then 'SB_OP_OTHERS'
                   else 'SB_MAINT'
                 end
               when m.activity = 'POS Terminal Inspection' then 'POS_OP_INSPECT'
               when m.activity in ('POS Refreshment Training', 'Refreshment Training') then 'POS_OP_TRAIN'
               when m.activity = 'Request Paper Roll' then 'POS_OP_PAPER'
               when m.activity = 'Request Add Material' then 'POS_OP_ADD_MAT'
               when m.activity = 'Request Return Materials' then 'POS_OP_RET_MAT'
               when m.activity = 'SB Inspection' then 'SB_OP_INSPECT'
               when m.activity = 'SB Refresh Training' then 'SB_OP_TRAIN'
               when m.activity = 'Battery Replacement' and (m.answers->>'Sound Box Request' is not null or m.activity ilike '%SB%') then 'SB_OP_BATTERY'
               when m.activity = 'Add Material' and (m.answers->>'Sound Box Request' is not null or m.activity ilike '%SB%') then 'SB_OP_ADD_MAT'
               when m.activity = 'Returns Material' and (m.answers->>'Sound Box Request' is not null or m.activity ilike '%SB%') then 'SB_OP_RET_MAT'
               when m.activity in ('Declined – Cash Only (No QR)', 'Declined - Cash Only (No QR)') then 'MV_DECLINED_CASH_ONLY_NO_QR'
               else app.kpi_mv_code(m.activity)
             end
        from public.mv_visits m
       where m.submitted_at >= v_from24 - interval '1 day'
      union all
      -- 3. Credit Card Onboarding Failed
      select coalesce(nullif(trim(c.staff_id), ''), 'UNKNOWN'), nullif(trim(c.staff_name), ''),
             coalesce(c.branch_id, app.resolve_branch(c.branch_text), 'UNASSIGNED'), nullif(trim(c.branch_text), ''),
             (c.submitted_at at time zone 'Asia/Phnom_Penh')::date,
             'CC_ONBOARD_FAIL'
        from public.cc_entries c
       where (c.card_status = 'Onboarding Failed' or c.review_status = 'NO_REVIEW')
         and c.submitted_at >= v_from24 - interval '1 day'
      union all
      -- 4. KHQR Onboarding Failed
      select coalesce(nullif(trim(q.staff_id), ''), 'UNKNOWN'), nullif(trim(q.staff_name), ''),
             coalesce(q.branch_id, app.resolve_branch(q.branch_text), 'UNASSIGNED'), nullif(trim(q.branch_text), ''),
             (q.submitted_at at time zone 'Asia/Phnom_Penh')::date,
             'KHQR_ONBOARD_FAIL'
        from public.qr_installations q
       where (q.activity = 'SUBMITTED' or q.status = 'FAILED_ATTEMPT')
         and q.submitted_at >= v_from24 - interval '1 day'
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
                count(*) filter (where cat = 'Credit Card') cc_n,
                count(*) filter (where cat = 'KHQR') khqr_n,
                count(*) filter (where cat = 'Merchant Visit') mv_n,
                count(distinct staff_id) staff_n from x group by 1, 2),
  base as (select e.value obj, e.value->>'day' dy, e.value->>'branch_id' k, e.ordinality o from jsonb_array_elements(coalesce(v->'daily_branch', '[]'::jsonb)) with ordinality e)
  select coalesce(jsonb_agg(
           case when b.obj is not null then b.obj || jsonb_build_object(
                  'total_tasks', (b.obj->>'total_tasks')::int + coalesce(ex.n, 0),
                  'pos_tasks', (b.obj->>'pos_tasks')::int + coalesce(ex.pos_n, 0),
                  'sb_tasks', (b.obj->>'sb_tasks')::int + coalesce(ex.sb_n, 0),
                  'cc_tasks', (coalesce(b.obj->>'cc_tasks', '0'))::int + coalesce(ex.cc_n, 0),
                  'khqr_tasks', (coalesce(b.obj->>'khqr_tasks', '0'))::int + coalesce(ex.khqr_n, 0),
                  'mv_tasks', (coalesce(b.obj->>'mv_tasks', '0'))::int + coalesce(ex.mv_n, 0))
                else jsonb_build_object('day', ex.day, 'branch_id', ex.branch_id, 'active_staff', ex.staff_n,
                  'total_tasks', ex.n, 'pos_tasks', ex.pos_n, 'sb_tasks', ex.sb_n, 'khqr_tasks', ex.khqr_n, 'cc_tasks', ex.cc_n, 'mv_tasks', ex.mv_n) end
           order by coalesce(b.dy, ex.day) desc, coalesce(b.k, ex.branch_id)), '[]'::jsonb)
    into v_db
    from base b full join ex on ex.day = b.dy and ex.branch_id = b.k;

  with x as (select * from kpi_x k where k.d >= (date_trunc('month', now() at time zone 'Asia/Phnom_Penh')::date - interval '5 months')::date),
  ex as (select d::text as day, staff_id, count(*) n,
                count(*) filter (where cat = 'POS Terminal') pos_n,
                count(*) filter (where cat = 'Sound Box') sb_n,
                count(*) filter (where cat = 'Credit Card') cc_n,
                count(*) filter (where cat = 'KHQR') khqr_n,
                count(*) filter (where cat = 'Merchant Visit') mv_n,
                max(staff_name) staff_name, max(branch_id) branch_id, max(branch_text) branch_text from x group by 1, 2),
  base as (select e.value obj, e.value->>'day' dy, e.value->>'staff_id' k from jsonb_array_elements(coalesce(v->'daily_staff', '[]'::jsonb)) e)
  select coalesce(jsonb_agg(
           case when b.obj is not null then b.obj || jsonb_build_object(
                  'total_tasks', (b.obj->>'total_tasks')::int + coalesce(ex.n, 0),
                  'pos_tasks', (b.obj->>'pos_tasks')::int + coalesce(ex.pos_n, 0),
                  'sb_tasks', (b.obj->>'sb_tasks')::int + coalesce(ex.sb_n, 0),
                  'cc_tasks', (coalesce(b.obj->>'cc_tasks', '0'))::int + coalesce(ex.cc_n, 0),
                  'khqr_tasks', (coalesce(b.obj->>'khqr_tasks', '0'))::int + coalesce(ex.khqr_n, 0),
                  'mv_tasks', (coalesce(b.obj->>'mv_tasks', '0'))::int + coalesce(ex.mv_n, 0))
                else jsonb_build_object('day', ex.day, 'staff_id', ex.staff_id, 'staff_name', coalesce(sp.name, ex.staff_name, ex.staff_id),
                  'branch_id', coalesce(sp.branch_id, ex.branch_id, 'UNASSIGNED'), 'branch_name', coalesce(br.name, ex.branch_text, 'Unassigned'),
                  'total_tasks', ex.n, 'pos_tasks', ex.pos_n, 'sb_tasks', ex.sb_n, 'khqr_tasks', ex.khqr_n, 'cc_tasks', ex.cc_n, 'mv_tasks', ex.mv_n) end
           order by coalesce(b.dy, ex.day) desc, coalesce(b.k, ex.staff_id)), '[]'::jsonb)
    into v_ds
    from base b full join ex on ex.day = b.dy and ex.staff_id = b.k
    left join public.staff_profiles sp on b.obj is null and sp.emp_id = ex.staff_id
    left join public.branches br on b.obj is null and br.id = coalesce(sp.branch_id, ex.branch_id);

  return v || jsonb_build_object('staff', v_staff, 'daily', v_daily, 'weekly', v_weekly, 'monthly', v_monthly, 'quarterly', v_quarterly,
                                 'monthly_staff', v_ms, 'daily_branch', v_db, 'daily_staff', v_ds);
end $$;

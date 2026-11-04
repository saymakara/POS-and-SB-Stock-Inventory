-- 04 Nov 2026 · KPI points for the new Merchant Visit app activities.
--
-- Settings > KPI rules gets ready-made rules (INACTIVE, 0 points - Admin HQ sets the points and switches them on):
--   POS Terminal    POS_MAINT     POS Active Maintenance        (per visit)
--                   POS_INACTIVE  POS In-Active Maintenance     (per visit)
--                   POS_RETURN    POS Return & Terminate        (per terminal)
--   Merchant Visit  MV_<ACTIVITY> one rule per visit activity, e.g. MV_ACCOUNT_OPENING, MV_KHQR_ISSUE (per visit)
-- A new category "Merchant Visit". A rule added later in Settings with code MV_ + the activity name (letters and digits,
-- the rest as _) counts that activity automatically (app.kpi_mv_code gives the code of an activity).
--
-- Counting: the existing kpi_dashboard_summary(date, date) is kept as it is (renamed kpi_dashboard_summary_base) and a
-- wrapper with the same name adds an "extra" object { rule code: count } to every staff / period / month row, and the
-- new tasks to the daily task totals. Only ACTIVE rules count, so nothing changes until a rule is switched on.
-- Same rules as the existing counts: POS records waiting or approved (not rejected), the same dates, the same weekend /
-- holiday exclusions, the same branch matching.

-- 1. category
alter table public.kpi_point_rules drop constraint if exists kpi_point_rules_category_check;
alter table public.kpi_point_rules add constraint kpi_point_rules_category_check
  check (category = any (array['POS Terminal', 'Sound Box', 'KHQR', 'Credit Card', 'Merchant Visit', 'Other']));
do $mig$
declare v_src text; v_new text;
begin
  v_src := pg_get_functiondef('public.kpi_save_rule(jsonb)'::regprocedure);
  v_new := replace(v_src, $a$if v_cat not in ('POS Terminal', 'Sound Box', 'KHQR', 'Credit Card', 'Other') then$a$,
                          $a$if v_cat not in ('POS Terminal', 'Sound Box', 'KHQR', 'Credit Card', 'Merchant Visit', 'Other') then$a$);
  if v_new = v_src then raise exception 'kpi_save_rule: expected text not found'; end if;
  execute v_new;
end $mig$;

-- 2. the rule code of a merchant visit activity: "Account Opening" -> MV_ACCOUNT_OPENING
create or replace function app.kpi_mv_code(p_activity text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left('MV_' || coalesce(nullif(trim(both '_' from upper(regexp_replace(coalesce(p_activity, ''), '[^A-Za-z0-9]+', '_', 'g'))), ''), 'OTHER'), 40)
$$;
revoke all on function app.kpi_mv_code(text) from public;
grant execute on function app.kpi_mv_code(text) to authenticated, service_role;

-- 3. ready-made rules (inactive, 0 points; never overwrite a rule that already exists)
insert into public.kpi_point_rules (code, category, sub_category, description, points, unit, active, is_system, sort_order, updated_by, updated_at)
values
  ('POS_MAINT', 'POS Terminal', 'POS Active Maintenance', 'Merchant Visit app: POS Active Maintenance (inspection, paper roll, materials ...)', 0, 'per visit', false, true, 32, 'system', now()),
  ('POS_INACTIVE', 'POS Terminal', 'POS In-Active Maintenance', 'Merchant Visit app: POS In-Active Maintenance (1st / 2nd, onsite or remote)', 0, 'per visit', false, true, 34, 'system', now()),
  ('POS_RETURN', 'POS Terminal', 'POS Return & Terminate', 'Merchant Visit app: POS Return & Terminate (terminal taken back from the merchant)', 0, 'per terminal', false, true, 36, 'system', now())
on conflict (code) do nothing;
insert into public.kpi_point_rules (code, category, sub_category, description, points, unit, active, is_system, sort_order, updated_by, updated_at)
select app.kpi_mv_code(a), 'Merchant Visit', a, 'Merchant Visit app: visits with the activity "' || a || '"', 0, 'per visit', false, true, 130 + n, 'system', now()
  from unnest(array['Account Opening', 'QR Merchant Onboarding', 'Declined – Cash Only (No QR)', 'KHQR Issue', 'ABA Mobile Support',
                    'Other Bank''s Promo', 'ABA QR in Good Condition', 'Key Merchant Visit', 'PaySound / Alert Telegram',
                    'On-site ATM Location', 'Bring Document to Merchant']) with ordinality as t(a, n)
on conflict (code) do nothing;

-- 4. counting: the existing function becomes the base, the wrapper adds the new activities
do $mig$
begin
  if to_regprocedure('public.kpi_dashboard_summary_base(date,date)') is null then
    alter function public.kpi_dashboard_summary(date, date) rename to kpi_dashboard_summary_base;
  end if;
end $mig$;
revoke all on function public.kpi_dashboard_summary_base(date, date) from public, anon, authenticated;

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
       where fe.kind in ('POS_MAINT', 'POS_INACTIVE', 'POS_RETURN') and fe.status in ('APPROVED', 'PENDING')
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
  ex as (select d::text as day, branch_id, count(*) n, count(*) filter (where cat = 'POS Terminal') pos_n, count(*) filter (where cat = 'Merchant Visit') mv_n,
                count(distinct staff_id) staff_n from x group by 1, 2),
  base as (select e.value obj, e.value->>'day' dy, e.value->>'branch_id' k, e.ordinality o from jsonb_array_elements(coalesce(v->'daily_branch', '[]'::jsonb)) with ordinality e)
  select coalesce(jsonb_agg(
           case when b.obj is not null then b.obj || jsonb_build_object('total_tasks', (b.obj->>'total_tasks')::int + coalesce(ex.n, 0),
                  'pos_tasks', (b.obj->>'pos_tasks')::int + coalesce(ex.pos_n, 0), 'mv_tasks', coalesce(ex.mv_n, 0))
                else jsonb_build_object('day', ex.day, 'branch_id', ex.branch_id, 'active_staff', ex.staff_n, 'total_tasks', ex.n, 'pos_tasks', ex.pos_n,
                  'sb_tasks', 0, 'khqr_tasks', 0, 'cc_tasks', 0, 'mv_tasks', ex.mv_n) end
           order by coalesce(b.dy, ex.day) desc, coalesce(b.k, ex.branch_id)), '[]'::jsonb)
    into v_db
    from base b full join ex on ex.day = b.dy and ex.branch_id = b.k;

  with x as (select * from kpi_x k where k.d >= (date_trunc('month', now() at time zone 'Asia/Phnom_Penh')::date - interval '5 months')::date),
  ex as (select d::text as day, staff_id, count(*) n, count(*) filter (where cat = 'POS Terminal') pos_n, count(*) filter (where cat = 'Merchant Visit') mv_n,
                max(staff_name) staff_name, max(branch_id) branch_id, max(branch_text) branch_text from x group by 1, 2),
  base as (select e.value obj, e.value->>'day' dy, e.value->>'staff_id' k from jsonb_array_elements(coalesce(v->'daily_staff', '[]'::jsonb)) e)
  select coalesce(jsonb_agg(
           case when b.obj is not null then b.obj || jsonb_build_object('total_tasks', (b.obj->>'total_tasks')::int + coalesce(ex.n, 0),
                  'pos_tasks', (b.obj->>'pos_tasks')::int + coalesce(ex.pos_n, 0), 'mv_tasks', coalesce(ex.mv_n, 0))
                else jsonb_build_object('day', ex.day, 'staff_id', ex.staff_id, 'staff_name', coalesce(sp.name, ex.staff_name, ex.staff_id),
                  'branch_id', coalesce(sp.branch_id, ex.branch_id, 'UNASSIGNED'), 'branch_name', coalesce(br.name, ex.branch_text, 'Unassigned'),
                  'total_tasks', ex.n, 'pos_tasks', ex.pos_n, 'sb_tasks', 0, 'khqr_tasks', 0, 'cc_tasks', 0, 'mv_tasks', ex.mv_n) end
           order by coalesce(b.dy, ex.day) desc, coalesce(b.k, ex.staff_id)), '[]'::jsonb)
    into v_ds
    from base b full join ex on ex.day = b.dy and ex.staff_id = b.k
    left join public.staff_profiles sp on b.obj is null and sp.emp_id = ex.staff_id
    left join public.branches br on b.obj is null and br.id = coalesce(sp.branch_id, ex.branch_id);

  return v || jsonb_build_object('staff', v_staff, 'daily', v_daily, 'weekly', v_weekly, 'monthly', v_monthly, 'quarterly', v_quarterly,
                                 'monthly_staff', v_ms, 'daily_branch', v_db, 'daily_staff', v_ds);
end $$;
revoke all on function public.kpi_dashboard_summary(date, date) from public, anon;
grant execute on function public.kpi_dashboard_summary(date, date) to authenticated, service_role;

-- a period list + { period: { code: n } } -> every row gets "extra"; a period only in the extras is added with zero counts
create or replace function public.kpi_extra_merge(p_rows jsonb, p_key text, p_extra jsonb, p_zero jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with base as (select e.value obj, e.value->>p_key k from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) e),
  ex as (select key k, value extra from jsonb_each(coalesce(p_extra, '{}'::jsonb)))
  select coalesce(jsonb_agg(
           case when b.obj is not null then b.obj || jsonb_build_object('extra', coalesce(ex.extra, '{}'::jsonb))
                else p_zero || jsonb_build_object(p_key, ex.k, 'active_branches', 0, 'active_staff', 0, 'extra', ex.extra) end
           order by coalesce(b.k, ex.k) desc), '[]'::jsonb)
    from base b full join ex on ex.k = b.k
$$;
revoke all on function public.kpi_extra_merge(jsonb, text, jsonb, jsonb) from public, anon, authenticated;

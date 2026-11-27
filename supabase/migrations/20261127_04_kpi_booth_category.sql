-- (27 Nov 2026) KPI Performance: "Booth Event" becomes its own category (its own card, column, filter and export).
--
-- The server already counts Booth Event days (KPI tasks MV_BOOTH_EVENT_FULL_DAY / _HALF_DAY). What was missing:
--   * the sharing adjustment (adj_pts) was one number for Booth Event and Standby VIP together. It is now also given
--     for Booth Event alone (adj_booth), so the Booth Event column shows the booth's own points and Standby VIP stays in
--     Merchant Visit;
--   * the day-by-day rows (daily_branch, daily_staff) now also carry booth_tasks (booth days), a part of mv_tasks.
-- Nothing else changes: mv_tasks, adj_pts, totals and points are exactly as before, so the Dashboard, the Merchant Visit
-- app (My KPI) and every existing figure are unaffected. The KPI Performance page (portal update) shows Booth Event
-- separately by taking it out of Merchant Visit.
--
-- How: 1. app.kpi_event_adjust_split() = the booth / standby rule (unchanged) giving adj and adj_booth;
--         app.kpi_event_adjust() now reads it (same answer as before).
--      2. the two KPI functions are edited in place (a check stops everything if their text is not as expected).
--      3. every KPI figure is worked out again.
-- Safe to run more than once.

-- 1. the booth / standby rule, also giving the Booth Event part
create or replace function app.kpi_event_adjust_split(p_from date, p_to date)
returns table(d date, staff_id text, adj numeric, adj_booth numeric)
language plpgsql
security definer
set search_path to ''
as $function$
#variable_conflict use_column
declare s public.kpi_event_settings; m jsonb; v_staff text[];
begin
  select * into s from public.kpi_event_settings where id = 1;
  if not found then s.booth_mode := 'shared'; s.standby_mode := 'higher'; s.half_day_weight := 0.5; end if;
  if s.booth_mode = 'fixed' and s.standby_mode = 'fixed' then return; end if;
  select coalesce(jsonb_object_agg(r.code, r.points), '{}'::jsonb) into m from public.kpi_point_rules r where r.active;

  drop table if exists pg_temp._ke_rec;
  create temp table _ke_rec on commit drop as
  with rec as (
    select v.id, (v.submitted_at at time zone 'Asia/Phnom_Penh')::date as d, trim(v.staff_id) as staff_id,
           case when v.activity = 'Booth Event' then 'B' else 'S' end as typ,
           app.kpi_visit_code(v.activity, v.answers) as code,
           upper(btrim(coalesce(v.answers->>'Booth Tag', ''))) as tag,
           regexp_match(coalesce(v.answers->>'Booth Hours', v.answers->>'VIP Hours', ''), '(\d{1,2})[:.](\d{2})\D+(\d{1,2})[:.](\d{2})') as hm,
           (v.submitted_at at time zone 'Asia/Phnom_Penh') as local_ts
      from public.mv_visits v
     where v.activity in ('Booth Event', 'Standby VIP Merchant') and coalesce(trim(v.staff_id), '') <> ''
       and v.submitted_at >= (p_from::timestamp at time zone 'Asia/Phnom_Penh')
       and v.submitted_at < ((p_to + 1)::timestamp at time zone 'Asia/Phnom_Penh')
  ), r2 as (
    select r.*, r.code like '%\_HALF\_DAY' as half, (m->>r.code)::numeric as dflt,
           case when r.hm is not null and r.hm[1]::int < 24 and r.hm[3]::int <= 24 and r.hm[2]::int < 60 and r.hm[4]::int < 60
                     and (r.hm[3]::int * 60 + r.hm[4]::int) > (r.hm[1]::int * 60 + r.hm[2]::int)
                then r.hm[1]::int * 60 + r.hm[2]::int end as h_from,
           case when r.hm is not null and r.hm[1]::int < 24 and r.hm[3]::int <= 24 and r.hm[2]::int < 60 and r.hm[4]::int < 60
                     and (r.hm[3]::int * 60 + r.hm[4]::int) > (r.hm[1]::int * 60 + r.hm[2]::int)
                then r.hm[3]::int * 60 + r.hm[4]::int end as h_to
      from rec r
  ), r3 as (
    -- the window: full day = the whole day; half day = its hours, else the half it was sent in
    select r.*,
           ((r.d::timestamp + make_interval(mins => case when not r.half then 0 when r.h_from is not null then r.h_from
                                                         when r.local_ts::time < time '12:00' then 0 else 720 end))
             at time zone 'Asia/Phnom_Penh') as ws,
           ((r.d::timestamp + make_interval(mins => case when not r.half then 1440 when r.h_to is not null then r.h_to
                                                         when r.local_ts::time < time '12:00' then 720 else 1440 end))
             at time zone 'Asia/Phnom_Penh') as we
      from r2 r
     where r.dflt is not null                                                         -- the KPI task exists and is Active
       and ((r.typ = 'B' and s.booth_mode <> 'fixed') or (r.typ = 'S' and s.standby_mode <> 'fixed'))
  ), r4 as (
    -- one record per staff, day and window; a booth that day replaces a standby; a full day replaces half days
    select distinct on (r.staff_id, r.d, r.typ, r.ws, r.we) r.*
      from r3 r
     where not (r.typ = 'S' and exists (select 1 from r3 b where b.typ = 'B' and b.staff_id = r.staff_id and b.d = r.d))
       and not (r.half and exists (select 1 from r3 f where not f.half and f.typ = r.typ and f.staff_id = r.staff_id and f.d = r.d))
     order by r.staff_id, r.d, r.typ, r.ws, r.we, r.id desc
  )
  select * from r4;

  select coalesce(array_agg(distinct k.staff_id), '{}') into v_staff from _ke_rec k;
  if cardinality(v_staff) = 0 then return; end if;

  return query
  with ev as materialized (
    select * from app.kpi_event_points((p_from::timestamp at time zone 'Asia/Phnom_Penh'), ((p_to + 1)::timestamp at time zone 'Asia/Phnom_Penh'), v_staff)
  ), own as (
    select k.id, coalesce((select sum(e.pts) from ev e where e.staff_id = k.staff_id and e.ts >= k.ws and e.ts < k.we), 0) as own_in
      from _ke_rec k
  ), shared as (
    select k.id,
      case
        when k.typ = 'B' and s.booth_mode = 'shared' and k.tag <> '' and not k.half then
          (select sum(o2.own_in) / nullif(sum(case when k2.half then s.half_day_weight else 1 end), 0)
             from _ke_rec k2 join own o2 on o2.id = k2.id
            where k2.typ = 'B' and k2.d = k.d and k2.tag = k.tag)
        when k.typ = 'B' and s.booth_mode = 'shared' and k.tag <> '' and k.half then
          (select coalesce(sum((select coalesce(sum(e.pts), 0) from ev e where e.staff_id = k2.staff_id
                                 and e.ts >= greatest(k.ws, k2.ws) and e.ts < least(k.we, k2.we))), 0) / nullif(count(*), 0)
             from _ke_rec k2
            where k2.typ = 'B' and k2.d = k.d and k2.tag = k.tag and k2.ws < k.we and k2.we > k.ws)
        else null
      end as share
      from _ke_rec k
  ), fin as (
    -- shared booth: everyone gets the equal share, or the booth points when the share is lower;
    -- a booth without a tag, a standby, or mode "higher": the booth / standby points or own points, whichever is higher
    select k.d, k.staff_id, k.typ, k.dflt, o.own_in,
           greatest(k.dflt, coalesce(sh.share, o.own_in)) as total
      from _ke_rec k join own o on o.id = k.id join shared sh on sh.id = k.id
  )
  -- adj: booth + standby (as before); adj_booth: the Booth Event part only (27 Nov 2026, KPI Performance "Booth Event")
  select f.d, f.staff_id,
         round(sum(f.total - f.dflt - f.own_in), 2) as adj,
         round(coalesce(sum(f.total - f.dflt - f.own_in) filter (where f.typ = 'B'), 0), 2) as adj_booth
    from fin f
   group by f.d, f.staff_id
  having round(sum(f.total - f.dflt - f.own_in), 2) <> 0
      or round(coalesce(sum(f.total - f.dflt - f.own_in) filter (where f.typ = 'B'), 0), 2) <> 0;
end $function$;

revoke all on function app.kpi_event_adjust_split(date, date) from public;

-- the existing function gives the same answer as before, from the one rule above
create or replace function app.kpi_event_adjust(p_from date, p_to date)
returns table(d date, staff_id text, adj numeric)
language sql
security definer
set search_path to ''
as $$
  select s.d, s.staff_id, s.adj from app.kpi_event_adjust_split(p_from, p_to) s where s.adj <> 0;
$$;
revoke all on function app.kpi_event_adjust(date, date) from public;

-- 2. the two KPI functions: add adj_booth next to adj_pts, and booth_tasks next to mv_tasks
do $patch$
declare
  v text;
  procedure_oid regprocedure;
begin
  -- each edit is made only when the text is found exactly as expected; otherwise nothing is changed
  -- 2a. staff totals (one row per staff member)
  procedure_oid := 'app.kpi_dashboard_staff_only(date,date)'::regprocedure;
  v := pg_get_functiondef(procedure_oid);
  if position('kpi_event_adjust_split' in v) = 0 then
    if (length(v) - length(replace(v, $a$'adj_pts', coalesce(aj.v, 0))$a$, ''))) / length($a$'adj_pts', coalesce(aj.v, 0))$a$) <> 1
       or position($a$select a.staff_id, sum(a.adj) as v$a$ in v) = 0
       or position($a$from app.kpi_event_adjust(coalesce(p_since$a$ in v) = 0 then
      raise exception 'kpi_dashboard_staff_only is not as expected - nothing was changed';
    end if;
    v := replace(v, $a$'adj_pts', coalesce(aj.v, 0))$a$, $b$'adj_pts', coalesce(aj.v, 0), 'adj_booth', coalesce(aj.b, 0))$b$);
    v := replace(v, $a$select a.staff_id, sum(a.adj) as v$a$, $b$select a.staff_id, sum(a.adj) as v, sum(a.adj_booth) as b$b$);
    v := replace(v, $a$from app.kpi_event_adjust(coalesce(p_since$a$, $b$from app.kpi_event_adjust_split(coalesce(p_since$b$);
    execute v;
  end if;

  -- 2b. network, monthly staff and day-by-day rows
  procedure_oid := 'app.kpi_dashboard_summary_compute(date,date)'::regprocedure;
  v := pg_get_functiondef(procedure_oid);
  if position('kpi_event_adjust_split' in v) = 0 then
    if (length(v) - length(replace(v, $a$sum(a.adj) as v from adj a group by 1)$a$, ''))) / length($a$sum(a.adj) as v from adj a group by 1)$a$) <> 4
       or (length(v) - length(replace(v, $a$'adj_pts', coalesce(aj.v, 0))$a$, ''))) / length($a$'adj_pts', coalesce(aj.v, 0))$a$) <> 5
       or (length(v) - length(replace(v, $a$coalesce(sum(t.extra_cnt) filter (where t.act_cat = 'Merchant Visit'), 0)::int as mv_tasks$a$, '')))
            / length($a$coalesce(sum(t.extra_cnt) filter (where t.act_cat = 'Merchant Visit'), 0)::int as mv_tasks$a$) <> 2
       or (length(v) - length(replace(v, $a$a.total_tasks, a.pos_tasks, a.sb_tasks, a.khqr_tasks, a.cc_tasks, a.mv_tasks$a$, '')))
            / length($a$a.total_tasks, a.pos_tasks, a.sb_tasks, a.khqr_tasks, a.cc_tasks, a.mv_tasks$a$) <> 1
       or (length(v) - length(replace(v, $a$'mv_tasks', a.mv_tasks$a$, ''))) / length($a$'mv_tasks', a.mv_tasks$a$) <> 1
       or position($a$select a.d, a.staff_id, a.adj from app.kpi_event_adjust($a$ in v) = 0
       or position($a$select to_char(a.d, 'YYYY-MM') as m, a.staff_id, sum(a.adj) as v from adj a$a$ in v) = 0 then
      raise exception 'kpi_dashboard_summary_compute is not as expected - nothing was changed';
    end if;
    v := replace(v, $a$select a.d, a.staff_id, a.adj from app.kpi_event_adjust($a$,
                    $b$select a.d, a.staff_id, a.adj, a.adj_booth from app.kpi_event_adjust_split($b$);
    v := replace(v, $a$sum(a.adj) as v from adj a group by 1)$a$, $b$sum(a.adj) as v, sum(a.adj_booth) as b from adj a group by 1)$b$);
    v := replace(v, $a$select to_char(a.d, 'YYYY-MM') as m, a.staff_id, sum(a.adj) as v from adj a$a$,
                    $b$select to_char(a.d, 'YYYY-MM') as m, a.staff_id, sum(a.adj) as v, sum(a.adj_booth) as b from adj a$b$);
    v := replace(v, $a$'adj_pts', coalesce(aj.v, 0))$a$, $b$'adj_pts', coalesce(aj.v, 0), 'adj_booth', coalesce(aj.b, 0))$b$);
    v := replace(v, $a$coalesce(sum(t.extra_cnt) filter (where t.act_cat = 'Merchant Visit'), 0)::int as mv_tasks$a$,
                    $b$coalesce(sum(t.extra_cnt) filter (where t.act_cat = 'Merchant Visit'), 0)::int as mv_tasks,
        coalesce(sum(t.extra_cnt) filter (where t.act_code like 'MV\_BOOTH\_EVENT\_%'), 0)::int as booth_tasks$b$);
    v := replace(v, $a$a.total_tasks, a.pos_tasks, a.sb_tasks, a.khqr_tasks, a.cc_tasks, a.mv_tasks$a$,
                    $b$a.total_tasks, a.pos_tasks, a.sb_tasks, a.khqr_tasks, a.cc_tasks, a.mv_tasks, a.booth_tasks$b$);
    v := replace(v, $a$'mv_tasks', a.mv_tasks$a$, $b$'mv_tasks', a.mv_tasks, 'booth_tasks', a.booth_tasks$b$);
    execute v;
  end if;
end $patch$;

-- 3. every KPI figure (portal and Merchant Visit app) is worked out again
delete from app.kpi_summary_cache where true;

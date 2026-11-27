-- (27 Nov 2026, late) KPI Performance, Booth Event column: the real booth points (e.g. 30), not a minus figure.
--
-- On a booth day, the tasks a staff member does at the booth (KHQR, POS, Sound Box, Credit Card, visits) are part of
-- the booth's shared points. The server now also gives, per staff and day, the points of those tasks per category
-- (bo_pos, bo_sb, bo_khqr, bo_cc, bo_mv). KPI Performance moves them from their own column into Booth Event:
--   booth 271126, 27 Nov - MOK ChanvouchEng: KHQR 188.4 -> 139.2, Booth Event -19.2 -> 30, total 169.2 (unchanged).
-- Totals, mv_tasks, adj_pts and adj_booth are unchanged; the Dashboard and the Merchant Visit app are unaffected.
-- Run after 20261127_04. Safe to run more than once.

-- 1. the task points with their category (a copy of app.kpi_event_points with one more column; that one is kept)
do $cat$
declare v text;
begin
  if to_regprocedure('app.kpi_event_points_cat(timestamptz,timestamptz,text[])') is not null then return; end if;
  v := pg_get_functiondef('app.kpi_event_points(timestamptz,timestamptz,text[])'::regprocedure);
  if position('FUNCTION app.kpi_event_points(' in v) = 0
     or position('RETURNS TABLE(staff_id text, ts timestamp with time zone, pts numeric)' in v) = 0
     or position('select x.staff_id, x.ts, x.pts from (' in v) = 0
     or v !~ 'as pts\s+from app\.kpi_field_events fe'
     or v !~ 'else 0 end\s+from app\.qr_entries_all q'
     or v !~ 'else 0 end\)\s+from public\.cc_entries c'
     or v !~ 'coalesce\(\(m->>k\.code\)::numeric, 0\)\s+from public\.mv_visits v' then
    raise exception 'app.kpi_event_points is not as expected - nothing was changed';
  end if;
  v := replace(v, 'FUNCTION app.kpi_event_points(', 'FUNCTION app.kpi_event_points_cat(');
  v := replace(v, 'RETURNS TABLE(staff_id text, ts timestamp with time zone, pts numeric)', 'RETURNS TABLE(staff_id text, ts timestamp with time zone, pts numeric, cat text)');
  v := replace(v, 'select x.staff_id, x.ts, x.pts from (', 'select x.staff_id, x.ts, x.pts, x.cat from (');
  v := regexp_replace(v, 'as pts(\s+from app\.kpi_field_events fe)', $r$as pts, case when fe.device_type = 'Sound Box' then 'SB' else 'POS' end as cat\1$r$);
  v := regexp_replace(v, 'else 0 end(\s+from app\.qr_entries_all q)', $r$else 0 end, 'KHQR'\1$r$);
  v := regexp_replace(v, 'else 0 end\)(\s+from public\.cc_entries c)', $r$else 0 end), 'CC'\1$r$);
  v := regexp_replace(v, 'coalesce\(\(m->>k\.code\)::numeric, 0\)(\s+from public\.mv_visits v)',
         $r$coalesce((m->>k.code)::numeric, 0),
      coalesce((select case r.category when 'POS Terminal' then 'POS' when 'Sound Box' then 'SB' when 'KHQR' then 'KHQR'
                                        when 'Credit Card' then 'CC' end from public.kpi_point_rules r where r.code = k.code), 'MV')\1$r$);
  execute v;
end $cat$;
revoke all on function app.kpi_event_points_cat(timestamptz, timestamptz, text[]) from public;

-- 2. the booth / standby rule (unchanged), now also giving the booth's task points per category
drop function if exists app.kpi_event_adjust_split(date, date);
create function app.kpi_event_adjust_split(p_from date, p_to date)
returns table(d date, staff_id text, adj numeric, adj_booth numeric,
              bo_pos numeric, bo_sb numeric, bo_khqr numeric, bo_cc numeric, bo_mv numeric)
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
    select * from app.kpi_event_points_cat((p_from::timestamp at time zone 'Asia/Phnom_Penh'), ((p_to + 1)::timestamp at time zone 'Asia/Phnom_Penh'), v_staff)
  ), own as (
    -- the staff member's own task points inside the window, in total and (27 Nov 2026) per category
    select k.id, coalesce(sum(e.pts), 0) as own_in,
           coalesce(sum(e.pts) filter (where e.cat = 'POS'), 0) as o_pos, coalesce(sum(e.pts) filter (where e.cat = 'SB'), 0) as o_sb,
           coalesce(sum(e.pts) filter (where e.cat = 'KHQR'), 0) as o_khqr, coalesce(sum(e.pts) filter (where e.cat = 'CC'), 0) as o_cc,
           coalesce(sum(e.pts) filter (where e.cat = 'MV'), 0) as o_mv
      from _ke_rec k left join ev e on e.staff_id = k.staff_id and e.ts >= k.ws and e.ts < k.we
     group by k.id
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
    select k.d, k.staff_id, k.typ, k.dflt, o.own_in, o.o_pos, o.o_sb, o.o_khqr, o.o_cc, o.o_mv,
           greatest(k.dflt, coalesce(sh.share, o.own_in)) as total
      from _ke_rec k join own o on o.id = k.id join shared sh on sh.id = k.id
  )
  -- adj: booth + standby (as before); adj_booth: the Booth Event part only (27 Nov 2026, KPI Performance "Booth Event")
  select f.d, f.staff_id,
         round(sum(f.total - f.dflt - f.own_in), 2) as adj,
         round(coalesce(sum(f.total - f.dflt - f.own_in) filter (where f.typ = 'B'), 0), 2) as adj_booth,
         -- (27 Nov 2026) the points of the tasks done at the booth, per category (KPI Performance counts them under Booth Event)
         round(coalesce(sum(f.o_pos) filter (where f.typ = 'B'), 0), 2) as bo_pos,
         round(coalesce(sum(f.o_sb) filter (where f.typ = 'B'), 0), 2) as bo_sb,
         round(coalesce(sum(f.o_khqr) filter (where f.typ = 'B'), 0), 2) as bo_khqr,
         round(coalesce(sum(f.o_cc) filter (where f.typ = 'B'), 0), 2) as bo_cc,
         round(coalesce(sum(f.o_mv) filter (where f.typ = 'B'), 0), 2) as bo_mv
    from fin f
   group by f.d, f.staff_id
  having round(sum(f.total - f.dflt - f.own_in), 2) <> 0
      or round(coalesce(sum(f.total - f.dflt - f.own_in) filter (where f.typ = 'B'), 0), 2) <> 0
      or round(coalesce(sum(f.own_in) filter (where f.typ = 'B'), 0), 2) <> 0;
end $function$;

revoke all on function app.kpi_event_adjust_split(date, date) from public;

create or replace function app.kpi_event_adjust(p_from date, p_to date)
returns table(d date, staff_id text, adj numeric)
language sql
security definer
set search_path to ''
as $$
  select s.d, s.staff_id, s.adj from app.kpi_event_adjust_split(p_from, p_to) s where s.adj <> 0;
$$;
revoke all on function app.kpi_event_adjust(date, date) from public;

-- 3. the two KPI functions: bo_pos ... bo_mv next to adj_booth (staff, monthly staff and network rows)
do $patch$
declare v text; procedure_oid regprocedure;
begin
  procedure_oid := 'app.kpi_dashboard_staff_only(date,date)'::regprocedure;
  v := pg_get_functiondef(procedure_oid);
  if position($a$'bo_pos'$a$ in v) = 0 then
    if (length(v) - length(replace(v, $a$'adj_booth', coalesce(aj.b, 0))$a$, ''))) / length($a$'adj_booth', coalesce(aj.b, 0))$a$) <> 1
       or position($a$select a.staff_id, sum(a.adj) as v, sum(a.adj_booth) as b$a$ in v) = 0 then
      raise exception 'kpi_dashboard_staff_only is not as expected (run 20261127_04 first) - nothing was changed';
    end if;
    v := replace(v, $a$'adj_booth', coalesce(aj.b, 0))$a$, $b$'adj_booth', coalesce(aj.b, 0), 'bo_pos', coalesce(aj.bp, 0), 'bo_sb', coalesce(aj.bs, 0), 'bo_khqr', coalesce(aj.bk, 0), 'bo_cc', coalesce(aj.bc, 0), 'bo_mv', coalesce(aj.bm, 0))$b$);
    v := replace(v, $a$select a.staff_id, sum(a.adj) as v, sum(a.adj_booth) as b$a$,
                    $b$select a.staff_id, sum(a.adj) as v, sum(a.adj_booth) as b, sum(a.bo_pos) as bp, sum(a.bo_sb) as bs, sum(a.bo_khqr) as bk, sum(a.bo_cc) as bc, sum(a.bo_mv) as bm$b$);
    execute v;
  end if;

  procedure_oid := 'app.kpi_dashboard_summary_compute(date,date)'::regprocedure;
  v := pg_get_functiondef(procedure_oid);
  if position($a$'bo_pos'$a$ in v) = 0 then
    if (length(v) - length(replace(v, $a$'adj_booth', coalesce(aj.b, 0))$a$, ''))) / length($a$'adj_booth', coalesce(aj.b, 0))$a$) <> 5
       or (length(v) - length(replace(v, $a$sum(a.adj) as v, sum(a.adj_booth) as b from adj a$a$, ''))) / length($a$sum(a.adj) as v, sum(a.adj_booth) as b from adj a$a$) <> 5
       or position($a$select a.d, a.staff_id, a.adj, a.adj_booth from app.kpi_event_adjust_split($a$ in v) = 0 then
      raise exception 'kpi_dashboard_summary_compute is not as expected (run 20261127_04 first) - nothing was changed';
    end if;
    v := replace(v, $a$select a.d, a.staff_id, a.adj, a.adj_booth from app.kpi_event_adjust_split($a$,
                    $b$select a.d, a.staff_id, a.adj, a.adj_booth, a.bo_pos, a.bo_sb, a.bo_khqr, a.bo_cc, a.bo_mv from app.kpi_event_adjust_split($b$);
    v := replace(v, $a$sum(a.adj) as v, sum(a.adj_booth) as b from adj a$a$,
                    $b$sum(a.adj) as v, sum(a.adj_booth) as b, sum(a.bo_pos) as bp, sum(a.bo_sb) as bs, sum(a.bo_khqr) as bk, sum(a.bo_cc) as bc, sum(a.bo_mv) as bm from adj a$b$);
    v := replace(v, $a$'adj_booth', coalesce(aj.b, 0))$a$, $b$'adj_booth', coalesce(aj.b, 0), 'bo_pos', coalesce(aj.bp, 0), 'bo_sb', coalesce(aj.bs, 0), 'bo_khqr', coalesce(aj.bk, 0), 'bo_cc', coalesce(aj.bc, 0), 'bo_mv', coalesce(aj.bm, 0))$b$);
    execute v;
  end if;
end $patch$;

-- 4. every KPI figure is worked out again
delete from app.kpi_summary_cache where true;

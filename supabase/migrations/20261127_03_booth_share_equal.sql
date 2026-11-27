-- (27 Nov 2026, evening) Booth Event, mode "Shared by Booth Tag": back to the equal share, as confirmed by management.
--
--   Staff with the same Booth Tag on the same day share the booth's points EQUALLY, whoever did more or less:
--     * booth total / number of staff is 30 or less (total 120 or less for 4 full-day staff) -> everyone gets 30;
--     * above that -> everyone gets the equal share (e.g. total 160 / 4 staff = 40 each).
--   Example, booth 271126 on 27 Nov: 120 / 4 = 30 -> 30 each (MOK ChanvouchEng 30, CHHEN Punleu 30).
--   This undoes 20261127_02 (which kept each staff member's own points when higher). Half-day staff, booths without a
--   tag, Standby VIP and the "Higher" / "Fixed" modes are unchanged. Every KPI figure is worked out again.
--   Safe to run more than once.

create or replace function app.kpi_event_adjust(p_from date, p_to date)
returns table(d date, staff_id text, adj numeric)
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
    select k.d, k.staff_id, k.dflt, o.own_in,
           greatest(k.dflt, coalesce(sh.share, o.own_in)) as total
      from _ke_rec k join own o on o.id = k.id join shared sh on sh.id = k.id
  )
  select f.d, f.staff_id, round(sum(f.total - f.dflt - f.own_in), 2) as adj
    from fin f
   group by f.d, f.staff_id
  having round(sum(f.total - f.dflt - f.own_in), 2) <> 0;
end $function$;

revoke all on function app.kpi_event_adjust(date, date) from public;

-- every KPI figure (portal and Merchant Visit app) is worked out again
delete from app.kpi_summary_cache where true;

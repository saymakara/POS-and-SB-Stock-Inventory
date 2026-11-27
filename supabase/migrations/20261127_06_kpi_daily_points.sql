-- (27 Nov 2026, late) KPI Performance, "Staff Daily Tasks" and "Branch Daily Tasks": follow the By Points / Task Count
-- switch. The day-by-day rows (daily_staff, daily_branch) carried task counts only; they now also carry total_pts =
-- the KPI points of that staff member / branch on that day, worked out exactly as the other KPI figures:
--   each task x its point rule (Settings > KPI), KHQR Print & Laminate and QR materials, the extra task rules, and the
--   Booth Event / Standby VIP sharing of that day.
-- Nothing else changes (existing fields, totals, the Dashboard and the Merchant Visit app are unaffected).
-- Run after 20261127_05. Safe to run more than once.

do $patch$
declare
  v text; m text;
  procedure_oid regprocedure := 'app.kpi_dashboard_summary_compute(date,date)'::regprocedure;
  -- (27 Nov 2026) patterns ignore spaces and line breaks (a copy pasted on Windows may change them)
  r_ev5m constant text := 'ev_5m as materialized \(\s*select \* from ev where d >= v_from5m\s*\),';
  r_booth constant text := 'coalesce\(sum\(t\.extra_cnt\) filter \(where t\.act_code like ''MV\\_BOOTH\\_EVENT\\_%''\), 0\)::int as booth_tasks';
  r_ds constant text := 'a\.mv_tasks, a\.booth_tasks\s+from \(';
  r_db constant text := '''booth_tasks'', a\.booth_tasks';
  r_dbagg constant text := 'db_agg as \(\s*select\s+t\.d::text as day,';
begin
  v := pg_get_functiondef(procedure_oid);
  if position('total_pts' in v) > 0 then return; end if;                       -- already done
  if regexp_count(v, r_ev5m) <> 1 or regexp_count(v, r_booth) <> 2 or regexp_count(v, r_ds) <> 1
     or regexp_count(v, r_db) <> 1 or regexp_count(v, r_dbagg) <> 1 then
    raise exception 'kpi_dashboard_summary_compute is not as expected (run 20261127_04 and _05 first) - nothing was changed (% % % % %)',
      regexp_count(v, r_ev5m), regexp_count(v, r_booth), regexp_count(v, r_ds), regexp_count(v, r_db), regexp_count(v, r_dbagg);
  end if;

  -- 1. the points of every pre-counted row (the same rules as the KPI figures; extra tasks by their own rule)
  m := substring(v from r_ev5m);
  v := replace(v, m, $b$ev_5m as materialized (
    -- (27 Nov 2026) pts: the KPI points of the row (daily points for "Staff / Branch Daily" in points mode)
    select ev.*,
      (ev.pos_install * coalesce((rp.m->>'POS_INSTALL')::numeric, 0) + ev.pos_replace * coalesce((rp.m->>'POS_REPLACE')::numeric, 0)
       + ev.pos_battery * coalesce((rp.m->>'POS_BATTERY')::numeric, 0)
       + ev.sb_install * coalesce((rp.m->>'SB_INSTALL')::numeric, 0) + ev.sb_replace * coalesce((rp.m->>'SB_REPLACE')::numeric, 0)
       + ev.sb_maint * coalesce((rp.m->>'SB_MAINT')::numeric, 0) + ev.sb_return * coalesce((rp.m->>'SB_RETURN')::numeric, 0)
       + ev.khqr_install * (coalesce((rp.m->>'KHQR_INSTALL')::numeric, 0) + coalesce((rp.m->>'KHQR_PRINT_LAMINATE')::numeric, 0))
       + ev.khqr_replace * (coalesce((rp.m->>'KHQR_REPLACE')::numeric, 0) + coalesce((rp.m->>'KHQR_PRINT_LAMINATE')::numeric, 0))
       + ev.khqr_materials * coalesce((rp.m->>'KHQR_MATERIAL')::numeric, 0)
       + ev.cc_primary * coalesce((rp.m->>'CC_PRIMARY')::numeric, 0) + ev.cc_supp * coalesce((rp.m->>'CC_SUPP')::numeric, 0)
       + case when ev.act_code is not null then ev.extra_cnt * coalesce((rp.m->>ev.act_code)::numeric, 0) else 0 end) as pts
      from ev
     cross join (select coalesce(jsonb_object_agg(r.code, r.points), '{}'::jsonb) as m from public.kpi_point_rules r where r.active) rp
     where ev.d >= v_from5m
  ),$b$);
  -- 2. the day sums (branch and staff)
  m := substring(v from r_booth);
  v := replace(v, m, m || ',
        sum(t.pts) as pts_raw');
  -- 3. Booth Event / Standby VIP sharing of the day: per staff, and per branch (the staff member's branch that day)
  m := substring(v from r_dbagg);
  v := replace(v, m, $b$adj_br as (
    select x.d::text as day, b.branch_id, sum(x.adj) as v
      from adj x
     cross join lateral (select max(e.branch_id) as branch_id from ev_5m e where e.d = x.d and e.staff_id = x.staff_id) b
     group by 1, 2
  ),
  $b$ || m);
  m := substring(v from r_ds);
  v := replace(v, m, $b$a.mv_tasks, a.booth_tasks,
      round(a.pts_raw + coalesce((select sum(x.adj) from adj x where x.d::text = a.day and x.staff_id = a.staff_id), 0), 2) as total_pts
    from ($b$);
  m := substring(v from r_db);
  v := replace(v, m, $b$'booth_tasks', a.booth_tasks,
              'total_pts', round(a.pts_raw + coalesce((select sum(x.v) from adj_br x where x.day = a.day and x.branch_id = a.branch_id), 0), 2)$b$);
  if regexp_count(v, 'total_pts') <> 2 or regexp_count(v, 'pts_raw') <> 4 then
    raise exception 'the edit did not go as expected - nothing was changed';
  end if;
  execute v;
end $patch$;

-- every KPI figure is worked out again
delete from app.kpi_summary_cache where true;

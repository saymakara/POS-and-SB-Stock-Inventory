-- 03 Nov 2026 · KPI summary: ~3x faster + active-account guard.
--
-- Why (performance): public.kpi_dashboard_summary(date, date) called app.resolve_branch() (PL/pgSQL, up to three
-- lookups with regex normalisation) once for EVERY field_events / qr_installations / cc_entries row whose branch_id is
-- empty - about 1,000 calls per request (0.28 ms each). The KPI tab averaged 388 ms per call (max 2.4 s) and was the
-- most expensive application query in pg_stat_statements.
-- How: each of the two statements now resolves the DISTINCT branch texts once (CTE "bmap", ~20 rows) and looks the
-- result up. resolve_branch() is STABLE, so the result is identical. Verified on production data inside a rolled-back
-- transaction: output jsonb equal for (all time), (last 30 days) and (October 2026); 3 calls 1,574 ms -> 536 ms.
--
-- Why (security): the function is SECURITY DEFINER and had no caller check, so a DEACTIVATED account or one that still
-- must change its first password (both treated as "not signed in" everywhere else via app.role()) could still read
-- every branch's staff KPI figures, including credit-card counts from the otherwise locked cc_entries table.
-- How: a signed-in caller without an active profile now gets error 42501. Active staff of every role keep exactly the
-- access they have today (the KPI tab is shown to all roles). Server-side callers without a user (auth.uid() null:
-- SQL editor, cron) are unaffected.
--
-- Same pattern as 20261029_04: the change is applied to the CURRENT live body, nothing else in the function changes.
-- Safe to run more than once (marker comment).

do $$
declare
  v_def text;
  v_new text;
  v_bmap text := E'bmap as (\n'
    || E'    -- KPI_PERF_20261103: resolve each distinct free-text branch once instead of once per row\n'
    || E'    select s.t, app.resolve_branch(s.t) as bid from (\n'
    || E'      select fe0.branch_text as t from public.field_events fe0 where fe0.branch_id is null\n'
    || E'      union select q0.branch_text from public.qr_installations q0 where q0.branch_id is null\n'
    || E'      union select c0.branch_text from public.cc_entries c0 where c0.branch_id is null) s\n'
    || E'  ),\n  ';
begin
  v_def := pg_get_functiondef('public.kpi_dashboard_summary(date,date)'::regprocedure);
  if position('KPI_PERF_20261103' in v_def) > 0 then
    raise notice 'kpi_dashboard_summary already optimised';
    return;
  end if;

  v_new := replace(v_def, 'with raw_events as (', 'with ' || v_bmap || 'raw_events as (');
  v_new := replace(v_new, 'with timed_events as (', 'with ' || v_bmap || 'timed_events as (');
  v_new := replace(v_new, 'app.resolve_branch(fe.branch_text)', '(select bm.bid from bmap bm where bm.t is not distinct from fe.branch_text)');
  v_new := replace(v_new, 'app.resolve_branch(q.branch_text)',  '(select bm.bid from bmap bm where bm.t is not distinct from q.branch_text)');
  v_new := replace(v_new, 'app.resolve_branch(c.branch_text)',  '(select bm.bid from bmap bm where bm.t is not distinct from c.branch_text)');

  -- the body's own BEGIN is the first one alone on a line
  v_new := regexp_replace(v_new, E'\nbegin\n',
    E'\nbegin\n'
    || E'  -- KPI_ACTIVE_USER_ONLY (03 Nov 2026): deactivated / first-password accounts cannot read KPI figures\n'
    || E'  if auth.uid() is not null and (select app.role()) is null then\n'
    || E'    raise exception ''Your account is not active. Ask Admin HQ to restore access.'' using errcode = ''42501'';\n'
    || E'  end if;\n');

  if (length(v_new) - length(replace(v_new, 'KPI_PERF_20261103', ''))) / length('KPI_PERF_20261103') <> 2
     or position('app.resolve_branch(fe.branch_text)' in v_new) > 0
     or position('app.resolve_branch(q.branch_text)' in v_new) > 0
     or position('app.resolve_branch(c.branch_text)' in v_new) > 0
     or position('KPI_ACTIVE_USER_ONLY' in v_new) = 0 then
    raise exception 'kpi_dashboard_summary did not have the expected shape - nothing changed.';
  end if;

  execute v_new;
  raise notice 'kpi_dashboard_summary optimised and guarded';
end $$;

-- Check (optional):
-- select position('KPI_PERF_20261103' in pg_get_functiondef('public.kpi_dashboard_summary(date,date)'::regprocedure)) > 0;

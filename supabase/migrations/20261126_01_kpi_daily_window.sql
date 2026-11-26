-- (26 Nov 2026) KPI answer: day-by-day lists only for the window in use
--
-- The compact KPI answer (kpi_dashboard_summary_lite) carried every day since the start for every staff member and
-- branch (daily_staff, daily_branch). That part grows by about 250 KB a month and is sent on every KPI load.
-- From now on those two lists hold the days from the 1st of the month two months back (about 3 months), or from the
-- start of the period asked for when that is earlier. Months, quarters, weeks, the daily totals and the staff list are
-- unchanged and complete. The answer says from which day its day-by-day lists start ("daily_from"); the portal reads
-- earlier days only when a screen shows them (All time, an older month in the daily table).
-- Safe to run more than once. Nothing else changes: same access rule, same kept copies, same warm-up.

create or replace function app.kpi_lite_for(p_since date, p_until date)
returns jsonb
language plpgsql
security definer
set search_path to ''
set statement_timeout to '30s'
as $$
declare
  v_today date := (now() at time zone 'Asia/Phnom_Penh')::date;
  v_today_txt text := v_today::text;
  v_key text := coalesce(p_since::text, '-') || '|' || coalesce(p_until::text, '-') || '|' || v_today_txt;
  v_from text := least((date_trunc('month', v_today) - interval '2 months')::date, coalesce(p_since, v_today))::text;
  v_full jsonb;
  v_full_at timestamptz;
  v_res jsonb;
begin
  v_full := public.kpi_dashboard_summary(p_since, p_until);          -- access rule, demand note and kept copy as before
  select c.built_at into v_full_at from app.kpi_summary_cache c where c.k = v_key;
  if v_full_at is not null then
    select c.result into v_res from app.kpi_summary_cache c
     where c.k = 'LITE2|' || v_key and c.built_at >= v_full_at;
    if v_res is not null then return v_res; end if;
  end if;
  v_full := v_full || jsonb_build_object(
    'daily_staff', coalesce((select jsonb_agg(t.e order by t.n) from jsonb_array_elements(coalesce(v_full->'daily_staff', '[]'::jsonb)) with ordinality t(e, n)
                              where coalesce(t.e->>'day', '') >= v_from), '[]'::jsonb),
    'daily_branch', coalesce((select jsonb_agg(t.e order by t.n) from jsonb_array_elements(coalesce(v_full->'daily_branch', '[]'::jsonb)) with ordinality t(e, n)
                              where coalesce(t.e->>'day', '') >= v_from), '[]'::jsonb),
    'daily_from', v_from);
  v_res := app.kpi_pack_lists(v_full, array['daily_staff', 'daily_branch', 'monthly_staff', 'staff']);
  if v_full_at is not null then
    delete from app.kpi_summary_cache c where (c.k like 'LITE|%') or (c.k like 'LITE2|%' and c.k not like '%|' || v_today_txt);
    insert into app.kpi_summary_cache as c (k, ver, built_at, result)
    select 'LITE2|' || v_key, s.ver, s.built_at, v_res from app.kpi_summary_cache s where s.k = v_key
    on conflict (k) do update set ver = excluded.ver, built_at = excluded.built_at, result = excluded.result;
  end if;
  return v_res;
end $$;
revoke all on function app.kpi_lite_for(date, date) from public, anon, authenticated;

-- ============================================================================================================================
-- 23 Nov 2026 - Merchant Visit app: My KPI ready before it is opened. No figure or rule changes. Safe to run twice.
--
-- mv_kpi_me (My KPI / Team-lead KPI in the app) answers in ~0.01 s from copies made in the last 10 minutes, but took
-- 0.7-2 s whenever one was missing: the month so far, today, and the 6 past days. The old "kpi-warm" job (every 10 min,
-- 08:00-18:59 Mon-Sat) did not keep them under 10 minutes old (a copy still valid for the dashboard was not remade), and
-- never made the past days, so many openings still waited for the whole calculation.
-- Now every 4 minutes from 06:00 to 21:59 (Phnom Penh), every day: the month and today copies are remade when over
-- 5 minutes old, and any missing past day is made (once a day). About 1.5 s of database work every 4 minutes.
-- ============================================================================================================================

create or replace function app.kpi_mv_prewarm()
returns void
language plpgsql
security definer
set search_path = ''
set statement_timeout = '60s'
as $$
declare
  v_today date := (now() at time zone 'Asia/Phnom_Penh')::date;
  v_m0 date := date_trunc('month', now() at time zone 'Asia/Phnom_Penh')::date;
  v_d date;
  v_k text;
begin
  -- the month so far and today, under the same names mv_kpi_me reads (it takes a copy at most 10 minutes old)
  foreach v_d in array array[v_m0, v_today] loop
    v_k := v_d::text || '|' || v_today::text || '|' || v_today::text;
    if not exists (select 1 from app.kpi_summary_cache c where c.k = v_k and c.built_at > now() - interval '5 minutes') then
      delete from app.kpi_summary_cache c where c.k = v_k;     -- remade now (until this commits, others keep reading the old copy)
      perform public.kpi_dashboard_summary(v_d, v_today);
    end if;
  end loop;
  -- the 6 past days (kept for the day): mv_kpi_me makes any that are missing
  perform public.mv_kpi_me(jsonb_build_object('staff_id', '__warm__'));
end $$;
revoke all on function app.kpi_mv_prewarm() from public, anon, authenticated;

-- replaces the old job of the same name (pg_cron times are UTC: 23:00-14:59 UTC = 06:00-21:59 Phnom Penh)
select cron.schedule('kpi-warm', '*/4 23,0-14 * * *', 'select app.kpi_mv_prewarm()');

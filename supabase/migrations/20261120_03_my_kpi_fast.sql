-- ============================================================================================================================
-- 20 Nov 2026 - My KPI in the Merchant Visit app opens faster (mv_kpi_me).
--
-- Measured on 20 Nov: mv_kpi_me took 1.4 s on average (up to 2.8 s). It reads the portal's KPI summary of this month and
-- of today. That summary is kept 3 minutes only, because every new entry anywhere (KHQR, POS, visits: about one a minute)
-- marks the KPI data as changed - so almost every My KPI open worked the whole month out again.
--
-- 1. mv_kpi_me uses a summary made in the last 10 minutes as it is. The app already tells staff that today's figures can
--    be up to 10 minutes behind (and keeps them 10 minutes itself), so nothing they see changes - only the wait.
-- 2. During working hours (Mon-Sat 08:00-18:59 Phnom Penh) the month and today summaries are made every 10 minutes in the
--    background, so a My KPI open almost always finds them ready (about 20 ms instead of 1.4 s). This is work in the
--    database only: NO Google Apps Script call and no change to the app's quota. It also makes the portal's KPI page
--    open faster. To stop it: select cron.unschedule('kpi-warm');
--
-- Nothing else changes: the same figures, the same rules, the same permissions (service key only). Safe to run twice.
-- ============================================================================================================================

create or replace function public.mv_kpi_me(p jsonb)
returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare
  v_sid text := left(btrim(coalesce(p->>'staff_id', '')), 40);
  v_today date := (now() at time zone 'Asia/Phnom_Penh')::date;
  v_m0 date := date_trunc('month', (now() at time zone 'Asia/Phnom_Penh'))::date;
  v_month jsonb; v_staff jsonb; v_days jsonb := '[]'::jsonb; d date; v_k text;
  v_zero jsonb := '{}'::jsonb;
begin
  if v_sid = '' then raise exception 'INPUT: staff_id is required.' using errcode = '22023'; end if;
  -- (20 Nov 2026) a month summary made in the last 10 minutes is used as it is (the app already shows today's figures as
  -- "up to 10 minutes behind"); before, any new entry anywhere made it work the month out again (1.4 s, up to 2.8 s)
  select c.result into v_month from app.kpi_summary_cache c
   where c.k = v_m0::text || '|' || v_today::text || '|' || v_today::text and c.built_at > now() - interval '10 minutes';
  if v_month is null then v_month := public.kpi_dashboard_summary(v_m0, v_today); end if;
  delete from app.kpi_summary_cache where k like 'MV_KPI_PAST|%' and k not like '%|' || v_today::text;   -- yesterday's
  for d in select generate_series(v_today - 6, v_today, interval '1 day')::date loop
    if d = v_today then
      v_staff := case when v_m0 = v_today then v_month->'staff' else
        coalesce((select c.result from app.kpi_summary_cache c where c.k = d::text || '|' || d::text || '|' || v_today::text and c.built_at > now() - interval '10 minutes'),
                 public.kpi_dashboard_summary(d, d))->'staff' end;
    else
      v_k := 'MV_KPI_PAST|' || d::text || '|' || v_today::text;
      select c.result into v_staff from app.kpi_summary_cache c where c.k = v_k;
      if v_staff is null then
        v_staff := coalesce(public.kpi_dashboard_summary(d, d)->'staff', '[]'::jsonb);
        insert into app.kpi_summary_cache as c (k, ver, built_at, result) values (v_k, 0, now(), v_staff)
        on conflict (k) do update set built_at = excluded.built_at, result = excluded.result;
      end if;
    end if;
    v_days := v_days || jsonb_build_array(jsonb_build_object('day', d,
      'row', coalesce((select x from jsonb_array_elements(coalesce(v_staff, '[]'::jsonb)) x where x->>'staff_id' = v_sid limit 1), v_zero)));
  end loop;
  return jsonb_build_object(
    'day', v_today, 'month_start', v_m0,
    'rules', (select coalesce(jsonb_agg(jsonb_build_object('code', r->>'code', 'category', r->>'category', 'sub', r->>'sub_category', 'points', (r->>'points')::numeric, 'active', (r->>'active')::boolean)), '[]'::jsonb)
                from jsonb_array_elements(coalesce(v_month->'rules', '[]'::jsonb)) r),
    'targets', v_month->'targets',
    'me', jsonb_build_object(
      'today', v_days->6->'row',
      'month', coalesce((select x from jsonb_array_elements(coalesce(v_month->'staff', '[]'::jsonb)) x where x->>'staff_id' = v_sid limit 1), v_zero),
      'days', v_days));
end $function$;
revoke all on function public.mv_kpi_me(jsonb) from public, anon, authenticated;
grant execute on function public.mv_kpi_me(jsonb) to service_role;

-- 2. ready in advance during working hours (UTC 01:00-11:59 = 08:00-18:59 Phnom Penh), Monday to Saturday
select cron.unschedule(j.jobid) from cron.job j where j.jobname = 'kpi-warm';
select cron.schedule('kpi-warm', '*/10 1-11 * * 1-6', $cron$
  select public.kpi_dashboard_summary(date_trunc('month', now() at time zone 'Asia/Phnom_Penh')::date, (now() at time zone 'Asia/Phnom_Penh')::date),
         public.kpi_dashboard_summary((now() at time zone 'Asia/Phnom_Penh')::date, (now() at time zone 'Asia/Phnom_Penh')::date);
$cron$);

notify pgrst, 'reload schema';

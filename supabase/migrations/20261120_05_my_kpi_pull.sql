-- ============================================================================================================================
-- 20 Nov 2026 - My KPI: pull down to refresh (Merchant Visit app 4.09.3). OPTIONAL - the app works without it.
--
-- The app's pull down to refresh on My KPI asks with "fresh". With this file, such a request uses KPI summaries at most
-- 2 minutes old (otherwise up to 10 minutes, as in 20261120_03). The portal's own summary is at most 3 minutes old, so a
-- pull shows figures at most about 2-3 minutes behind - e.g. right after a staff member saved an entry.
-- A pull reaches the portal at most once a minute per staff member (the app's server checks it). Every other request is
-- exactly as before. Same permissions (service key only). Safe to run twice.
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
  -- (20 Nov 2026, app 4.09.3) a pull down to refresh sends fresh: summaries at most 2 minutes old (else 10, as before)
  v_tol interval := case when lower(coalesce(p->>'fresh', '')) in ('true', '1') then interval '2 minutes' else interval '10 minutes' end;
begin
  if v_sid = '' then raise exception 'INPUT: staff_id is required.' using errcode = '22023'; end if;
  -- (20 Nov 2026) a month summary made in the last 10 minutes is used as it is (the app already shows today's figures as
  -- "up to 10 minutes behind"); before, any new entry anywhere made it work the month out again (1.4 s, up to 2.8 s)
  select c.result into v_month from app.kpi_summary_cache c
   where c.k = v_m0::text || '|' || v_today::text || '|' || v_today::text and c.built_at > now() - v_tol;
  if v_month is null then v_month := public.kpi_dashboard_summary(v_m0, v_today); end if;
  delete from app.kpi_summary_cache where k like 'MV_KPI_PAST|%' and k not like '%|' || v_today::text;   -- yesterday's
  for d in select generate_series(v_today - 6, v_today, interval '1 day')::date loop
    if d = v_today then
      v_staff := case when v_m0 = v_today then v_month->'staff' else
        coalesce((select c.result from app.kpi_summary_cache c where c.k = d::text || '|' || d::text || '|' || v_today::text and c.built_at > now() - v_tol),
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

notify pgrst, 'reload schema';

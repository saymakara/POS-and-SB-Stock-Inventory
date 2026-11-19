-- ============================================================================================================================
-- 19 Nov 2026 - Phase A (Merchant Visit 4.09.0): KPI items agreed in the improvement plan.
--
-- 1. KHQR Print & Laminate: a NEW rule KHQR_PRINT_LAMINATE, "per submission", for both KHQR New Installation and QR
--    Replacement, given to the installer who submits the entry (one count per entry, however many QR materials).
--    Nothing in the KHQR data, the KHQR app flow or the existing KHQR rules (KHQR_INSTALL, KHQR_REPLACE, KHQR_MATERIAL,
--    KHQR_ONBOARD_FAIL) changes: the portal and the app add (KHQR New Installation + QR Replacement) x its points, the same
--    way KHQR_MATERIAL is added today. Points start at 0 - set them in KPI Rules.
-- 2. Booth Event / Standby VIP Merchant: Full Day and Half Day counted separately - 4 rules (points start at 0):
--      MV_BOOTH_EVENT_FULL_DAY, MV_BOOTH_EVENT_HALF_DAY, MV_STANDBY_VIP_FULL_DAY, MV_STANDBY_VIP_HALF_DAY.
--    The type comes from the entry: Booth Event "Booth Duration" (new in the app 4.09.0; entries before it count as Full Day),
--    Standby VIP "Standby Type". The two single rules of 4.08 (MV_BOOTH_EVENT, MV_STANDBY_VIP_MERCHANT) are switched off -
--    no entry is counted under them any more (their history is counted under the new rules).
--    Only one expression changes in the two KPI counting functions: app.kpi_mv_code(m.activity) becomes
--    app.kpi_visit_code(m.activity, m.answers) - the same code for every other activity.
-- 3. My KPI in the app: public.mv_kpi_me(p) - one staff member's today, last 7 days (one per day) and this month, from the
--    portal's own KPI summary (cached; the same figures as the KPI page). Service key only (the Merchant Visit server).
--
-- No table, column, row of data or policy is changed. Safe to run twice.
-- ============================================================================================================================

-- 2a. the KPI code of a visit: Booth Event / Standby VIP Merchant by their Full / Half Day
create or replace function app.kpi_visit_code(p_activity text, p_answers jsonb)
returns text
language sql immutable set search_path = '' as $$
  select case
    when p_activity = 'Booth Event' then
      case when lower(coalesce(p_answers->>'Booth Duration', '')) like 'half%' then 'MV_BOOTH_EVENT_HALF_DAY' else 'MV_BOOTH_EVENT_FULL_DAY' end
    when p_activity = 'Standby VIP Merchant' then
      case when lower(coalesce(p_answers->>'Standby Type', '')) like 'half%' then 'MV_STANDBY_VIP_HALF_DAY' else 'MV_STANDBY_VIP_FULL_DAY' end
    else app.kpi_mv_code(p_activity)
  end;
$$;
revoke all on function app.kpi_visit_code(text, jsonb) from public;
grant execute on function app.kpi_visit_code(text, jsonb) to authenticated, service_role;

-- 2b. the two KPI counting functions use it (the one expression replaced in place; a second run finds nothing to replace)
do $$
declare f text; d text; n int;
begin
  foreach f in array array['app.kpi_dashboard_staff_only(date,date)', 'app.kpi_dashboard_summary_compute(date,date)'] loop
    d := pg_get_functiondef(f::regprocedure);
    n := (length(d) - length(replace(d, 'app.kpi_mv_code(m.activity)', ''))) / length('app.kpi_mv_code(m.activity)');
    if n = 1 then
      execute replace(d, 'app.kpi_mv_code(m.activity)', 'app.kpi_visit_code(m.activity, m.answers)');
      raise notice '% updated', f;
    elsif position('app.kpi_visit_code(m.activity, m.answers)' in d) > 0 then
      raise notice '% already updated', f;
    else
      raise exception '% : expected the visit code expression once, found % - nothing changed', f, n;
    end if;
  end loop;
end $$;

-- 1 + 2c. the rules (0 points to start; Admin sets the points in KPI Rules)
insert into public.kpi_point_rules (code, category, sub_category, description, points, unit, active, is_system, sort_order, updated_by, updated_at)
values
  ('KHQR_PRINT_LAMINATE', 'KHQR', 'KHQR Print & Laminate', 'KHQR Installation (New Installation or QR Replacement): printing and laminating the QR materials - per submission, the installer', 0, 'per submission', true, true, 23, 'system', now()),
  ('MV_BOOTH_EVENT_FULL_DAY', 'Merchant Visit', 'Booth Event - Full Day', 'Merchant Visit app: Booth Event, full day', 0, 'per booth', true, true, 148, 'system', now()),
  ('MV_BOOTH_EVENT_HALF_DAY', 'Merchant Visit', 'Booth Event - Half Day', 'Merchant Visit app: Booth Event, half day', 0, 'per booth', true, true, 149, 'system', now()),
  ('MV_STANDBY_VIP_FULL_DAY', 'Merchant Visit', 'Standby VIP - Full Day', 'Merchant Visit app: Standby VIP Merchant, full day', 0, 'per standby', true, true, 150, 'system', now()),
  ('MV_STANDBY_VIP_HALF_DAY', 'Merchant Visit', 'Standby VIP - Half Day', 'Merchant Visit app: Standby VIP Merchant, half day', 0, 'per standby', true, true, 151, 'system', now())
on conflict (code) do nothing;
update public.kpi_point_rules set active = false, updated_by = 'system', updated_at = now()
 where code in ('MV_BOOTH_EVENT', 'MV_STANDBY_VIP_MERCHANT') and active;

-- 3. My KPI (Merchant Visit app): one staff member - today, the last 7 days, this month
create or replace function public.mv_kpi_me(p jsonb)
returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare
  v_sid text := left(btrim(coalesce(p->>'staff_id', '')), 40);
  v_today date := (now() at time zone 'Asia/Phnom_Penh')::date;
  v_m0 date := date_trunc('month', (now() at time zone 'Asia/Phnom_Penh'))::date;
  v_month jsonb; v_s jsonb; v_days jsonb := '[]'::jsonb; d date;
  v_zero jsonb := '{}'::jsonb;
begin
  if v_sid = '' then raise exception 'INPUT: staff_id is required.' using errcode = '22023'; end if;
  v_month := public.kpi_dashboard_summary(v_m0, v_today);
  for d in select generate_series(v_today - 6, v_today, interval '1 day')::date loop
    v_s := case when d = v_today and v_m0 = v_today then v_month else public.kpi_dashboard_summary(d, d) end;
    v_days := v_days || jsonb_build_array(jsonb_build_object('day', d,
      'row', coalesce((select x from jsonb_array_elements(coalesce(v_s->'staff', '[]'::jsonb)) x where x->>'staff_id' = v_sid limit 1), v_zero)));
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

-- the KPI summaries kept from before this change are dropped (they are worked out again on the next read)
delete from app.kpi_summary_cache;

notify pgrst, 'reload schema';

-- ============================================================================================================================
-- 23 Nov 2026 - Speed after sign-in, and the KPI Delete / Sync / Save-rules fix. No figure or rule changes. Safe to run twice.
--
-- 1. Fix: KPI Points & Rules "Delete", "Sync from Merchant Visit" and the Booth / Standby "Save rules" failed from the portal
--    with "DELETE requires a WHERE clause": the API's safety guard refuses a DELETE without WHERE, and these three cleared the
--    KPI cache with one. They now say "where true" (same effect).
-- 2. field_events.updated_at is set on every change (trigger), and an index on it for Merchant Visit installs: the Dashboard
--    now asks only for the install records changed since its last look instead of downloading 430 days of them again on
--    every new install anywhere (it was ~1,000 downloads a day).
-- 3. KPI summary: only working out the shared 24-month series waits in line (one at a time, as before); the staff figures for
--    a date range no longer wait behind other people's requests. Same cache, same freshness (3 minutes / data version).
-- ============================================================================================================================

-- ---- 1. DELETE ... WHERE true ------------------------------------------------------------------------------------------
do $fix$
declare f text; d text;
begin
  foreach f in array array['public.kpi_delete_rule(text)', 'public.kpi_sync_from_mv(jsonb)', 'public.kpi_save_event_settings(jsonb)'] loop
    if to_regprocedure(f) is null then continue; end if;
    d := pg_get_functiondef(f::regprocedure);
    if position('delete from app.kpi_summary_cache;' in d) > 0 then
      execute replace(d, 'delete from app.kpi_summary_cache;', 'delete from app.kpi_summary_cache where true;');
    end if;
  end loop;
end $fix$;

-- ---- 2. updated_at always set, and indexed for installs ----------------------------------------------------------------
create or replace function app.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists field_events_touch on public.field_events;
create trigger field_events_touch before update on public.field_events for each row execute function app.touch_updated_at();
create index if not exists idx_field_events_install_updated on public.field_events (updated_at) where kind = 'INSTALL';

-- ---- 3. KPI summary: lock only to build the shared series ----------------------------------------------------------------
create or replace function public.kpi_dashboard_summary(p_since date default null::date, p_until date default null::date)
returns jsonb
language plpgsql
security definer
set search_path to ''
set statement_timeout to '30s'
as $function$
declare
  v_ver bigint;
  v_today_txt text := (now() at time zone 'Asia/Phnom_Penh')::date::text;
  v_key text := coalesce(p_since::text, '-') || '|' || coalesce(p_until::text, '-') || '|' || v_today_txt;
  v_series_key text := '__SERIES__|' || v_today_txt;
  v_res jsonb;
  v_series jsonb;
  v_staff jsonb;
begin
  if auth.uid() is not null and (select app.role()) is null then
    raise exception 'Your account is not active. Ask Admin HQ to restore access.' using errcode = '42501';
  end if;

  select last_value + is_called::int into v_ver from app.kpi_data_seq;
  select c.result into v_res from app.kpi_summary_cache c
   where c.k = v_key
     and ((c.ver = v_ver and c.built_at > now() - interval '30 minutes') or c.built_at > now() - interval '3 minutes');
  if v_res is not null then
    return v_res;
  end if;

  select c.result into v_series from app.kpi_summary_cache c
   where c.k = v_series_key
     and ((c.ver = v_ver and c.built_at > now() - interval '30 minutes') or c.built_at > now() - interval '3 minutes');

  if v_series is null then
    -- (23 Nov 2026) only building the shared series waits in line; a second request finds it built when its turn comes
    perform pg_advisory_xact_lock(hashtext('kpi_summary_global'));
    select last_value + is_called::int into v_ver from app.kpi_data_seq;
    select c.result into v_series from app.kpi_summary_cache c
     where c.k = v_series_key
       and ((c.ver = v_ver and c.built_at > now() - interval '30 minutes') or c.built_at > now() - interval '3 minutes');
  end if;

  if v_series is not null then
    v_staff := app.kpi_dashboard_staff_only(p_since, p_until);
    v_res := v_series || jsonb_build_object('staff', v_staff);
  else
    v_res := app.kpi_dashboard_summary_compute(p_since, p_until);
    insert into app.kpi_summary_cache as c (k, ver, built_at, result)
    values (v_series_key, v_ver, now(), v_res - 'staff')
    on conflict (k) do update set ver = excluded.ver, built_at = excluded.built_at, result = excluded.result;
  end if;

  insert into app.kpi_summary_cache as c (k, ver, built_at, result)
  values (v_key, v_ver, now(), v_res)
  on conflict (k) do update set ver = excluded.ver, built_at = excluded.built_at, result = excluded.result;

  return v_res;
end $function$;
revoke all on function public.kpi_dashboard_summary(date, date) from public, anon;
grant execute on function public.kpi_dashboard_summary(date, date) to authenticated, service_role;

notify pgrst, 'reload schema';

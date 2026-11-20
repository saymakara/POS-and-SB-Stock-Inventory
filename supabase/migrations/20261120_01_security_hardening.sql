-- ============================================================================================================================
-- 20 Nov 2026 - Security review: close database functions that could be called WITHOUT signing in.
--
-- Found with the Supabase security advisor and checked against each function's code (read-only, 20 Nov 2026):
--   1. HIGH  public.kpi_dashboard_staff_slice - anyone on the internet with the portal's public key could call it and
--            download every staff member's KPI figures (names, branches, task counts). Its guard only stops a signed-in
--            account that was switched off; a caller who is not signed in passed straight through.
--   2. LOW   public.kpi_get_settings_fast - the KPI point rules and targets, readable without signing in; and its
--            search_path was not fixed (a SECURITY DEFINER function should always fix it).
--   3. LOW   public.pending_field_event_groups - callable without signing in (it returned nothing to such a caller, but
--            it should not be open).
--   4. INFO  public.kpi_dummy_test - a leftover test function ("select 2"), callable by anyone: removed.
--   ROOT CAUSE: PostgreSQL lets EVERYONE (the role PUBLIC, which includes "anon") run a new function unless it is revoked
--            by hand, and that default cannot be changed for one schema only. So every new migration must revoke it:
--            tests/static_guards.cjs now refuses a migration (from this one on) that creates a SECURITY DEFINER function
--            without "revoke ... from public".
--
-- Who keeps access: signed-in portal users (authenticated) and the Merchant Visit server (service_role) - the portal
-- pages that use these functions only call them after sign-in. Nothing else changes: no table, row or policy.
-- Safe to run twice.
-- ============================================================================================================================

-- 1. KPI per staff member: signed-in users only
revoke execute on function public.kpi_dashboard_staff_slice(timestamptz, timestamptz) from public, anon;
grant execute on function public.kpi_dashboard_staff_slice(timestamptz, timestamptz) to authenticated, service_role;

-- 2. KPI rules and targets: signed-in users only; fixed search_path (the body names every table with its schema)
alter function public.kpi_get_settings_fast() set search_path = '';
revoke execute on function public.kpi_get_settings_fast() from public, anon;
grant execute on function public.kpi_get_settings_fast() to authenticated, service_role;

-- 3. Pending phone app records by branch: signed-in users only
revoke execute on function public.pending_field_event_groups() from public, anon;
grant execute on function public.pending_field_event_groups() to authenticated, service_role;

-- 4. Leftover test function
drop function if exists public.kpi_dummy_test();

-- Check (optional): should return no rows - SECURITY DEFINER functions in "public" that anyone can call without signing in
-- select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');

notify pgrst, 'reload schema';

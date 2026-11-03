-- Migration: 20261103_01_search_path_and_rls_hardening.sql
-- 1. Pin mutable search_path on Cambodian calendar functions to prevent search path hijacking
ALTER FUNCTION public.get_cambodia_holiday_name(date) SET search_path = public, pg_temp;
ALTER FUNCTION public.is_cambodia_workday(date) SET search_path = public, pg_temp;

-- 2. Explicit deny-by-default client policies for cc_entries and cc_settings
-- Satisfies security linter (rls_enabled_no_policy) and guarantees direct table access from client
-- is rejected (all access is strictly channeled through security-definer RPCs: cc_list, cc_counts, cc_review).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cc_entries' AND policyname = 'cc_entries_no_direct_client_access'
  ) THEN
    CREATE POLICY cc_entries_no_direct_client_access ON public.cc_entries FOR ALL TO authenticated USING (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cc_settings' AND policyname = 'cc_settings_no_direct_client_access'
  ) THEN
    CREATE POLICY cc_settings_no_direct_client_access ON public.cc_settings FOR ALL TO authenticated USING (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'kpi_settings' AND policyname = 'kpi_settings_read'
  ) THEN
    CREATE POLICY kpi_settings_read ON public.kpi_settings FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

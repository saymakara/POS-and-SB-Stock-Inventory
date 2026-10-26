-- ==============================================================================
-- Migration: 20261027_01_security_and_performance_optimization.sql
-- Production Readiness, Security Hardening & Performance Optimization
--
-- 1. function_search_path_mutable:
--    Explicitly set search_path on public.admin_save_staff(jsonb) to avoid mutable search_path warning.
-- 2. auth_rls_initplan:
--    Wrap auth.uid() and app functions in (select ...) in staff_profiles RLS policy for query InitPlan optimization.
-- 3. multiple_permissive_policies:
--    Deduplicate permissive policies on branch_aliases, branches, and requisitions.
-- 4. primary_key:
--    Add primary key to historical_merchants_backup_20261022.
-- ==============================================================================

-- 1. Pin search_path for admin_save_staff
ALTER FUNCTION public.admin_save_staff(jsonb) SET search_path = public, pg_temp;

-- 2. Staff profiles InitPlan optimization
DROP POLICY IF EXISTS staff_read ON public.staff_profiles;
CREATE POLICY staff_read ON public.staff_profiles 
  FOR SELECT TO authenticated 
  USING (user_id = (SELECT auth.uid()) OR (SELECT app.is_admin()));

-- 3. Branch aliases: deduplicate permissive policies
DROP POLICY IF EXISTS aliases_read ON public.branch_aliases;
DROP POLICY IF EXISTS aliases_admin ON public.branch_aliases;
CREATE POLICY aliases_admin ON public.branch_aliases 
  FOR ALL TO authenticated 
  USING ((SELECT app.is_admin())) 
  WITH CHECK ((SELECT app.is_admin()));

-- 4. Branches: separate write vs read policies to eliminate duplicate permissive SELECT
DROP POLICY IF EXISTS branches_admin ON public.branches;
DROP POLICY IF EXISTS branches_read ON public.branches;
CREATE POLICY branches_read ON public.branches 
  FOR SELECT TO authenticated 
  USING ((SELECT app.role()) IS NOT NULL);
CREATE POLICY branches_admin ON public.branches 
  FOR INSERT, UPDATE, DELETE TO authenticated 
  USING ((SELECT app.is_admin())) 
  WITH CHECK ((SELECT app.is_admin()));

-- 5. Requisitions: merge duplicate UPDATE policies into one with InitPlan
DROP POLICY IF EXISTS req_update_own ON public.requisitions;
DROP POLICY IF EXISTS req_update ON public.requisitions;
CREATE POLICY req_update ON public.requisitions 
  FOR UPDATE TO authenticated 
  USING (
    (SELECT app.is_admin()) 
    OR (branch_id = (SELECT app.branch()) AND status = 'PENDING_ADMIN' AND COALESCE(type, 'STOCK_REQUEST') = 'STOCK_REQUEST')
  ) 
  WITH CHECK (
    (SELECT app.is_admin()) 
    OR (branch_id = (SELECT app.branch()) AND status = 'PENDING_ADMIN' AND COALESCE(type, 'STOCK_REQUEST') = 'STOCK_REQUEST')
  );

-- 6. Add primary key to backup table
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_schema = 'public' 
      AND table_name = 'historical_merchants_backup_20261022' 
      AND constraint_type = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE public.historical_merchants_backup_20261022 ADD COLUMN IF NOT EXISTS backup_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY;
  END IF;
END $$;

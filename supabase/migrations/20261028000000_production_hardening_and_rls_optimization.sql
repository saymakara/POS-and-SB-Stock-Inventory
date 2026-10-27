-- ==============================================================================
-- Migration: 20261028000000_production_hardening_and_rls_optimization.sql
-- Production Hardening, Telegram RPC Access Lockdown & RLS Performance Optimization
-- ==============================================================================

-- 1. Telegram RPC Access Control: Revoke anonymous public execution
REVOKE EXECUTE ON FUNCTION public.rpc_send_telegram_document(text, text, text, text, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_detect_telegram_chats(text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_send_telegram_message(text, text, text, text) FROM anon, PUBLIC;

GRANT EXECUTE ON FUNCTION public.rpc_send_telegram_document(text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_detect_telegram_chats(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_send_telegram_message(text, text, text, text) TO authenticated;

-- 2. Function search_path mutable fix
ALTER FUNCTION public.admin_save_staff(jsonb) SET search_path = public, pg_temp;

-- 3. Staff Profiles InitPlan optimization
DROP POLICY IF EXISTS staff_read ON public.staff_profiles;
CREATE POLICY staff_read ON public.staff_profiles 
  FOR SELECT TO authenticated 
  USING (user_id = (SELECT auth.uid()) OR (SELECT app.is_admin()));

-- 4. Branch aliases: deduplicate permissive policies
DROP POLICY IF EXISTS aliases_admin ON public.branch_aliases;
DROP POLICY IF EXISTS aliases_read ON public.branch_aliases;
DROP POLICY IF EXISTS aliases_insert ON public.branch_aliases;
DROP POLICY IF EXISTS aliases_update ON public.branch_aliases;
DROP POLICY IF EXISTS aliases_delete ON public.branch_aliases;

CREATE POLICY aliases_read ON public.branch_aliases 
  FOR SELECT TO authenticated 
  USING ((SELECT app.role()) IS NOT NULL);
CREATE POLICY aliases_insert ON public.branch_aliases 
  FOR INSERT TO authenticated 
  WITH CHECK ((SELECT app.is_admin()));
CREATE POLICY aliases_update ON public.branch_aliases 
  FOR UPDATE TO authenticated 
  USING ((SELECT app.is_admin())) 
  WITH CHECK ((SELECT app.is_admin()));
CREATE POLICY aliases_delete ON public.branch_aliases 
  FOR DELETE TO authenticated 
  USING ((SELECT app.is_admin()));

-- 5. Branches: separate write vs read policies to eliminate duplicate permissive SELECT
DROP POLICY IF EXISTS branches_admin ON public.branches;
DROP POLICY IF EXISTS branches_read ON public.branches;
DROP POLICY IF EXISTS branches_insert ON public.branches;
DROP POLICY IF EXISTS branches_update ON public.branches;
DROP POLICY IF EXISTS branches_delete ON public.branches;

CREATE POLICY branches_read ON public.branches 
  FOR SELECT TO authenticated 
  USING ((SELECT app.role()) IS NOT NULL);
CREATE POLICY branches_insert ON public.branches 
  FOR INSERT TO authenticated 
  WITH CHECK ((SELECT app.is_admin()));
CREATE POLICY branches_update ON public.branches 
  FOR UPDATE TO authenticated 
  USING ((SELECT app.is_admin())) 
  WITH CHECK ((SELECT app.is_admin()));
CREATE POLICY branches_delete ON public.branches 
  FOR DELETE TO authenticated 
  USING ((SELECT app.is_admin()));

-- 6. Requisitions: merge duplicate UPDATE policies into one with InitPlan
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

-- 7. Add primary key to backup table
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'historical_merchants_backup_20261022'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_schema = 'public' 
      AND table_name = 'historical_merchants_backup_20261022' 
      AND constraint_type = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE public.historical_merchants_backup_20261022 ADD COLUMN IF NOT EXISTS backup_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY;
  END IF;
END $$;

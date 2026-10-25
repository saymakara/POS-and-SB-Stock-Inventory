-- ==============================================================================
-- Migration: 20261025_03_security_advisor_fixes.sql
-- Resolution for Supabase Security Advisor warnings:
-- 1. function_search_path_mutable (public.get_device_stage_counts)
-- 2. extension_in_public (pg_trgm moved to extensions schema)
-- 3. anon_security_definer_function_executable (rpc_detect_telegram_chats & rpc_send_telegram_message)
-- 4. authenticated_security_definer_function_executable (switched non-privileged RPCs to SECURITY INVOKER)
-- 5. rls_enabled_no_policy (public.historical_merchants_backup_20261022)
-- ==============================================================================

-- 1. Pin search_path for get_device_stage_counts to prevent mutable search_path hijacking
ALTER FUNCTION public.get_device_stage_counts(text) SET search_path = public, pg_temp;

-- 2. Move pg_trgm extension out of public schema into extensions schema
ALTER EXTENSION pg_trgm SET SCHEMA extensions;

-- 3. Telegram Relay RPCs: Switch from SECURITY DEFINER to SECURITY INVOKER.
-- These RPCs only make external HTTP requests (http_get / http_post) and do not access internal tables.
-- Running as SECURITY INVOKER with search_path pinned avoids elevating database privileges.
ALTER FUNCTION public.rpc_detect_telegram_chats(text) SECURITY INVOKER;
ALTER FUNCTION public.rpc_detect_telegram_chats(text) SET search_path = public, extensions;
REVOKE ALL ON FUNCTION public.rpc_detect_telegram_chats(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_detect_telegram_chats(text) TO authenticated;

ALTER FUNCTION public.rpc_send_telegram_message(text, text, text, text) SECURITY INVOKER;
ALTER FUNCTION public.rpc_send_telegram_message(text, text, text, text) SET search_path = public, extensions;
REVOKE ALL ON FUNCTION public.rpc_send_telegram_message(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_send_telegram_message(text, text, text, text) TO authenticated;

-- 4. field_recheck: Read-only validation calculation for admins.
-- Switched to SECURITY INVOKER since admins already have full read permissions under RLS.
ALTER FUNCTION public.field_recheck(bigint, character varying) SECURITY INVOKER;
ALTER FUNCTION public.field_recheck(bigint, character varying) SET search_path = public, app, extensions;
REVOKE ALL ON FUNCTION public.field_recheck(bigint, character varying) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.field_recheck(bigint, character varying) TO authenticated;

-- 5. Add RLS policy for backup table historical_merchants_backup_20261022
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'historical_merchants_backup_20261022' 
      AND policyname = 'hm_backup_super_admin'
  ) THEN
    CREATE POLICY hm_backup_super_admin ON public.historical_merchants_backup_20261022
      FOR ALL TO authenticated
      USING (app.role() = 'SUPER_ADMIN')
      WITH CHECK (app.role() = 'SUPER_ADMIN');
  END IF;
END $$;

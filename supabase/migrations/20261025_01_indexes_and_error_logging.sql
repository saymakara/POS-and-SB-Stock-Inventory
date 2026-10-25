-- =====================================================================================================================
-- POS & Sound Box Stock Inventory · 25 Oct 2026
-- 1. Clean up existing 'Success' / 'Info' rows in public.audit_logs (Error-Only Logging Retention)
-- 2. Add comprehensive B-Tree Indexes on frequently searched, filtered, and foreign-key columns
-- 3. Add 500K-row covering B-Tree indexes and server-side KPI / Pipeline stage count aggregation RPC
-- =====================================================================================================================

-- ---------------------------------------------------------------------------------------------------------------------
-- PART 1: Error-Only Audit Log Schema & Cleanup of 'Success' / 'Info' Rows
-- ---------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS status VARCHAR(24) NOT NULL DEFAULT 'Error';

-- Delete all rows in audit_logs where status is 'Success' or 'Info' (or legacy non-error activity rows)
DELETE FROM public.audit_logs
WHERE status IN ('Success', 'Info')
   OR (
     coalesce(action, '') NOT ILIKE '%ERROR%'
     AND coalesce(title, '') NOT ILIKE '%Error%'
     AND coalesce(title, '') NOT ILIKE '%Fail%'
   );

-- ---------------------------------------------------------------------------------------------------------------------
-- PART 2: B-Tree Indexes for Searching, Filtering, and Foreign Key Relationships (500K-Row Scale)
-- ---------------------------------------------------------------------------------------------------------------------

-- 1. Devices Table (Branch IDs, Serial Numbers, Merchant IDs, Terminal IDs, Staff IDs, Stage, Type)
CREATE INDEX IF NOT EXISTS idx_devices_branch_id ON public.devices USING btree (branch_id);
CREATE INDEX IF NOT EXISTS idx_devices_branch_stage ON public.devices USING btree (branch_id, stage);
CREATE INDEX IF NOT EXISTS idx_devices_stage ON public.devices USING btree (stage);
CREATE INDEX IF NOT EXISTS idx_devices_type ON public.devices USING btree (type);
CREATE INDEX IF NOT EXISTS idx_devices_serial_upper ON public.devices USING btree (upper(serial));
CREATE INDEX IF NOT EXISTS idx_devices_battery_serial ON public.devices USING btree (battery_serial);
CREATE INDEX IF NOT EXISTS idx_devices_mid_btree ON public.devices USING btree (mid);
CREATE INDEX IF NOT EXISTS idx_devices_tid_btree ON public.devices USING btree (tid);
CREATE INDEX IF NOT EXISTS idx_devices_merchant_name ON public.devices USING btree (merchant_name);
CREATE INDEX IF NOT EXISTS idx_devices_staff ON public.devices USING btree (staff);
CREATE INDEX IF NOT EXISTS idx_devices_archived_branch_stage ON public.devices USING btree (archived, branch_id, stage);
CREATE INDEX IF NOT EXISTS idx_devices_archived_branch_stage_type ON public.devices USING btree (archived, branch_id, stage, type);
CREATE INDEX IF NOT EXISTS idx_devices_archived_branch_stage_serial ON public.devices USING btree (archived, branch_id, stage, serial);
CREATE INDEX IF NOT EXISTS idx_devices_updated_at ON public.devices USING btree (updated_at DESC);

-- 2. Staff Profiles Table (Branch ID FK, Employee/Staff ID, Role)
CREATE INDEX IF NOT EXISTS idx_staff_profiles_branch_id ON public.staff_profiles USING btree (branch_id);
CREATE INDEX IF NOT EXISTS idx_staff_profiles_emp_id ON public.staff_profiles USING btree (emp_id);
CREATE INDEX IF NOT EXISTS idx_staff_profiles_role_active ON public.staff_profiles USING btree (role, active);

-- 3. Field Events Table (Serial Numbers, Branch IDs, Merchant IDs, Staff IDs, Review Status)
CREATE INDEX IF NOT EXISTS idx_field_events_status ON public.field_events USING btree (status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_field_events_serial ON public.field_events USING btree (serial);
CREATE INDEX IF NOT EXISTS idx_field_events_serial_upper ON public.field_events USING btree (upper(serial));
CREATE INDEX IF NOT EXISTS idx_field_events_old_serial ON public.field_events USING btree (old_serial);
CREATE INDEX IF NOT EXISTS idx_field_events_branch ON public.field_events USING btree (branch_id);
CREATE INDEX IF NOT EXISTS idx_field_events_mid ON public.field_events USING btree (mid);
CREATE INDEX IF NOT EXISTS idx_field_events_tid ON public.field_events USING btree (tid);
CREATE INDEX IF NOT EXISTS idx_field_events_staff_id ON public.field_events USING btree (staff_id);
CREATE INDEX IF NOT EXISTS idx_field_events_source_record_id ON public.field_events USING btree (source_record_id);

-- 4. Requisitions Table (Branch ID FK, Status, Staff, Date)
CREATE INDEX IF NOT EXISTS idx_requisitions_branch ON public.requisitions USING btree (branch_id);
CREATE INDEX IF NOT EXISTS idx_requisitions_status ON public.requisitions USING btree (status);
CREATE INDEX IF NOT EXISTS idx_requisitions_branch_status ON public.requisitions USING btree (branch_id, status);
CREATE INDEX IF NOT EXISTS idx_requisitions_staff ON public.requisitions USING btree (staff);
CREATE INDEX IF NOT EXISTS idx_requisitions_date ON public.requisitions USING btree (date DESC);

-- 5. Historical Merchants Table (Branch ID FK, MID, TID, Serial Number, Staff, Returned Date)
CREATE INDEX IF NOT EXISTS idx_hist_merchants_branch_id ON public.historical_merchants USING btree (branch_id);
CREATE INDEX IF NOT EXISTS idx_hist_merchants_mid ON public.historical_merchants USING btree (mid);
CREATE INDEX IF NOT EXISTS idx_hist_merchants_tid ON public.historical_merchants USING btree (tid);
CREATE INDEX IF NOT EXISTS idx_hist_merchants_serial ON public.historical_merchants USING btree (serial);
CREATE INDEX IF NOT EXISTS idx_hist_merchants_handled_by_staff ON public.historical_merchants USING btree (handled_by_staff);
CREATE INDEX IF NOT EXISTS idx_hist_merchants_returned_date ON public.historical_merchants USING btree (returned_date DESC);

-- 6. Audit Logs Table (Status, Created At, Branch ID, Staff Employee ID, Target Serial/MID)
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_status ON public.audit_logs USING btree (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_branch_id ON public.audit_logs USING btree (branch_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_emp ON public.audit_logs USING btree (actor_emp);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON public.audit_logs USING btree (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON public.audit_logs USING btree (target);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs USING btree (action);

-- 7. Branch Aliases Table (Branch ID FK)
CREATE INDEX IF NOT EXISTS idx_branch_aliases_branch_id ON public.branch_aliases USING btree (branch_id);

-- ---------------------------------------------------------------------------------------------------------------------
-- PART 3: 500K-Row Server-Side Stage & Hardware Type Aggregation RPC
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_device_stage_counts(p_branch_id TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH filtered AS (
    SELECT stage, type, COALESCE(archived, false) AS is_archived
    FROM public.devices
    WHERE (p_branch_id IS NULL OR p_branch_id = 'ALL' OR branch_id = p_branch_id)
  ),
  active_agg AS (
    SELECT
      stage,
      COUNT(*)::bigint AS total_count,
      COUNT(*) FILTER (WHERE type = 'POS Terminal')::bigint AS pos_count,
      COUNT(*) FILTER (WHERE type = 'Sound Box')::bigint AS sb_count
    FROM filtered
    WHERE NOT is_archived
    GROUP BY stage
  ),
  archived_agg AS (
    SELECT COUNT(*)::bigint AS archived_count
    FROM filtered
    WHERE is_archived
  )
  SELECT jsonb_build_object(
    'archived', COALESCE((SELECT archived_count FROM archived_agg), 0),
    'stages', COALESCE(
      (
        SELECT jsonb_object_agg(
          stage,
          jsonb_build_object(
            'count', total_count,
            'posCount', pos_count,
            'sbCount', sb_count
          )
        )
        FROM active_agg
      ),
      '{}'::jsonb
    )
  );
$$;

-- 08 Nov 2026 · "POS Active Maintenance" is now called "POS Operational Support" (Merchant Visit 3.86).
-- Not yet applied: run in the Supabase SQL Editor (safe to run again).
-- Only the name shown changes: the kind stays POS_MAINT, so existing records, KPI points and history are untouched.
-- The KPI rule's names are changed only while they still hold the original wording (a name an admin edited is kept).
update public.kpi_point_rules
   set sub_category = 'POS Operational Support',
       description  = replace(description, 'POS Active Maintenance', 'POS Operational Support'),
       updated_by   = 'system', updated_at = now()
 where code = 'POS_MAINT'
   and (sub_category = 'POS Active Maintenance' or description like '%POS Active Maintenance%');

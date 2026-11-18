-- ============================================================================================================================
-- 18 Nov 2026 - KHQR Installation (public.qr_installations): remove 6 indexes that are never used.
--
-- Measured on 18 Nov (21,525 rows): 1.86 KB per row = 0.59 KB data + 1.27 KB indexes (indexes were 68% of the table).
-- Each index below shows 0 uses in pg_stat_user_indexes since the statistics started (29 Oct 2026):
--   idx_qr_inst_nonempty_mid_sub   4.8 MB   (made outside the migrations; nothing queries it)
--   qr_inst_record_id_trgm_idx     2.5 MB   \
--   qr_inst_merchant_trgm_idx      2.0 MB    |  text search: the portal's KHQR search also searches staff_id (no such index),
--   qr_inst_staff_name_trgm_idx    1.9 MB    |  so the planner reads by date (qr_inst_time_idx) and never uses these
--   qr_inst_merchant_kh_trgm_idx   0.5 MB   /   (checked with EXPLAIN on 18 Nov)
--   qr_inst_failed_idx             16 kB    (qr_inst_submitted_or_failed_idx serves the failed entries)
-- Saves about 11.4 MB now; a row becomes about 1.30 KB (-30%).
--
-- Only indexes are removed: no table, column, row, function or policy changes. Searches and pages work as before.
-- Safe to run twice. To undo, re-run the CREATE INDEX lines from 20261028_02 / 20261029_02 (seconds on this table).
-- ============================================================================================================================

drop index if exists public.idx_qr_inst_nonempty_mid_sub;
drop index if exists public.qr_inst_record_id_trgm_idx;
drop index if exists public.qr_inst_merchant_trgm_idx;
drop index if exists public.qr_inst_staff_name_trgm_idx;
drop index if exists public.qr_inst_merchant_kh_trgm_idx;
drop index if exists public.qr_inst_failed_idx;

-- Check (optional): the table's size after the change
-- select pg_size_pretty(pg_table_size('public.qr_installations')) as data, pg_size_pretty(pg_indexes_size('public.qr_installations')) as indexes;

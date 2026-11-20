-- ============================================================================================================================
-- 20 Nov 2026 - KHQR Installation (public.qr_installations): less space for the same speed.
--
-- Measured on 20 Nov (26,713 rows, 3 weeks of entries): 34 MB = 13 MB data + 21 MB indexes. The indexes take MORE space
-- than the data. Four of them do the same job (read the entries by date):
--   qr_inst_time_idx                (submitted_at desc, id desc)                                            1.7 MB  10,539 uses
--   idx_qr_inst_submitted_cov_all   (submitted_at desc) + staff_id, mid, activity, failed_attempts, qr_count 4.7 MB   1,034 uses
--   qr_inst_submitted_covering_idx  (submitted_at)      + activity, failed_attempts, qr_count                2.8 MB   3,136 uses
--   qr_inst_activity_time_idx       (activity, submitted_at desc, id desc)                                  3.1 MB       6 uses
-- They are replaced by ONE index that does all four jobs (about 4.8 MB):
--   qr_inst_time_cov_idx            (submitted_at desc, id desc) + staff_id, mid, activity, failed_attempts, qr_count
-- Checked on 20 Nov with hypothetical indexes (hypopg - nothing changed on the live database): the review list, the list by
-- activity, the summaries by date, staff counts and today's count all read the new index; the cost of each query stays the
-- same (within 2-10%). The 30-day summary (the whole table today) was timed both ways: 9.7 ms vs 10.0 ms.
-- Then the 3 ID indexes are rebuilt (random keys leave gaps: about 1-1.5 MB).
--
-- Saves about 8-9 MB now (34 MB -> about 25-26 MB, -25%); about 1.3 KB -> 1.0 KB per entry. The nightly KHQR clean-up keeps
-- 2 months (about 77,000 entries at today's pace), so at its largest the table is about 75 MB instead of about 100 MB.
--
-- NOT changed: no table, column, row, function, policy or KHQR rule. The MID check (qr_inst_mid_time_idx), the unique
-- record / request IDs and the staff / branch indexes stay as they are.
-- Run it at a quiet time (e.g. after 18:00): each step holds new KHQR submissions for about a second (they wait, none is lost).
-- Safe to run twice. To undo: re-create the 4 indexes from 20261028_02 / 20261029_02 (seconds on this table).
-- ============================================================================================================================

-- 1. the one index for reading by date (made first, so the pages never lose their index)
create index if not exists qr_inst_time_cov_idx
  on public.qr_installations (submitted_at desc, id desc)
  include (staff_id, mid, activity, failed_attempts, qr_count);

-- 2. the four it replaces
drop index if exists public.qr_inst_time_idx;
drop index if exists public.idx_qr_inst_submitted_cov_all;
drop index if exists public.qr_inst_submitted_covering_idx;
drop index if exists public.qr_inst_activity_time_idx;

-- 3. rebuild the ID indexes (the same indexes, without the gaps)
reindex index public.qr_installations_record_id_key;
reindex index public.qr_installations_request_id_key;
reindex index public.qr_installations_pkey;

analyze public.qr_installations;

-- Check (optional): before about 13 MB data + 21 MB indexes
-- select pg_size_pretty(pg_table_size('public.qr_installations')) as data, pg_size_pretty(pg_indexes_size('public.qr_installations')) as indexes;

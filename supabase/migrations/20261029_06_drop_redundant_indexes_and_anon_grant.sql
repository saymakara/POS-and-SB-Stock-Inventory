-- 29 Oct 2026 · Remove four indexes that another index already covers (less work on every device save and bulk upload;
-- reads are unchanged because the covering index answers the same queries). Safe to run more than once.
-- Run in the Supabase SQL editor. To undo, re-create an index with the definition shown in the comment next to it.
drop index if exists public.idx_devices_archived_branch_stage;   -- prefix of idx_devices_archived_branch_stage_serial / _type  (archived, branch_id, stage)
drop index if exists public.idx_devices_branch_id;               -- prefix of idx_devices_branch_stage                          (branch_id)
drop index if exists public.idx_devices_mid_btree;               -- same column as idx_devices_mid, never used                  (mid)
drop index if exists public.idx_devices_tid_btree;               -- same column as idx_devices_tid, never used                  (tid)

-- the stage-count function is for signed-in users only
revoke execute on function public.get_device_stage_counts(text) from anon, public;
grant execute on function public.get_device_stage_counts(text) to authenticated;

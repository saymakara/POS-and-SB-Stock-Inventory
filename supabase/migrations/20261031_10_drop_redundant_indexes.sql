-- 10 (31 Oct 2026) Remove 5 indexes that are exact copies or leading parts of another index on the same table.
-- Every query these could serve is served equally by the index kept (listed on the right), so reads are unchanged;
-- each insert/update now maintains fewer indexes. No data is touched. Approved by the owner on 31 Oct 2026.
-- Undo: the CREATE INDEX lines at the bottom.
drop index if exists public.idx_staff_profiles_emp_id;           -- same as staff_profiles_emp_id_key (unique, emp_id)
drop index if exists public.idx_field_events_source_record_id;   -- leading part of field_events_source_record_id_unit_no_revision_key
drop index if exists public.idx_requisitions_branch;             -- leading part of idx_requisitions_branch_status (branch_id, status)
drop index if exists public.qr_inst_branch_idx;                  -- leading part of qr_inst_branch_time_idx (branch_id, submitted_at desc, id desc)
drop index if exists public.qr_inst_mid_idx;                     -- leading part of qr_inst_mid_time_idx (mid, submitted_at)

-- Undo (only if ever needed):
-- create index idx_staff_profiles_emp_id on public.staff_profiles (emp_id);
-- create index idx_field_events_source_record_id on public.field_events (source_record_id);
-- create index idx_requisitions_branch on public.requisitions (branch_id);
-- create index qr_inst_branch_idx on public.qr_installations (branch_id, submitted_at desc);
-- create index qr_inst_mid_idx on public.qr_installations (mid);

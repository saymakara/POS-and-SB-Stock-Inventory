-- 29 Oct 2026 · Row-level security: check the signed-in user ONCE per query, not once per row.
--
-- Why: the policies below called app.is_admin() / app.branch() / app.role() directly, so Postgres ran them for every
-- row it looked at (each call = one staff_profiles lookup). Reading one 1,000-row page of devices took ~300 ms of which
-- almost all was these repeated checks (live database, 29 Oct: ~208 million staff_profiles lookups since 2 Oct).
-- Wrapped in (select ...), the check runs once per query as an "InitPlan": the same page took ~12 ms.
--
-- Who may see or change what is EXACTLY the same as before: only the way the same rule is evaluated changes.
-- The functions are STABLE and take no row values, so one answer per query is the same answer for every row.
-- Safe to run more than once. Run in the Supabase SQL editor (whole file, one go).

begin;

-- devices
alter policy devices_read   on public.devices using ((select app.is_admin()) or (branch_id)::text = (select app.branch()));
alter policy devices_update on public.devices using ((select app.is_admin()) or (branch_id)::text = (select app.branch()))
                                              with check ((select app.is_admin()) or (branch_id)::text = (select app.branch()));
alter policy devices_insert on public.devices with check ((select app.is_admin()));
alter policy devices_delete on public.devices using ((select app.is_admin()));

-- audit_logs
alter policy audit_read   on public.audit_logs using ((select app.is_admin()) or (branch_id)::text = (select app.branch()));
alter policy audit_insert on public.audit_logs with check ((select app.role()) is not null);

-- field_events (Phone App Review)
alter policy fe_read on public.field_events using ((select app.is_admin()) or (branch_id)::text = (select app.branch()));

-- historical_merchants
alter policy hist_read   on public.historical_merchants using ((select app.is_admin()) or (branch_id)::text = (select app.branch()));
alter policy hist_insert on public.historical_merchants with check ((select app.is_admin()) or (branch_id)::text = (select app.branch()));
alter policy hist_admin  on public.historical_merchants using ((select app.is_admin())) with check ((select app.is_admin()));
alter policy hist_delete on public.historical_merchants using ((select app.role()) = 'SUPER_ADMIN');

-- historical_merchants_backup_20261022 (Super Admin only)
alter policy hm_backup_super_admin on public.historical_merchants_backup_20261022
  using ((select app.role()) = 'SUPER_ADMIN') with check ((select app.role()) = 'SUPER_ADMIN');

-- requisitions (req_update was already in this form)
alter policy req_read   on public.requisitions using ((select app.is_admin()) or (branch_id)::text = (select app.branch()));
alter policy req_insert on public.requisitions with check ((select app.is_admin())
  or ((branch_id)::text = (select app.branch()) and (status)::text = 'PENDING_ADMIN'));
alter policy req_delete on public.requisitions using ((select app.role()) = 'SUPER_ADMIN');

-- KHQR: foreign keys without an index (Supabase performance advisor). Small today; keeps branch deletes/joins fast later.
create index if not exists qr_attempts_branch_id_idx        on public.qr_attempts (branch_id);
create index if not exists qr_monthly_summary_branch_id_idx on public.qr_monthly_summary (branch_id);

commit;

-- Check (optional, after running): every row should show "(SELECT app...." in using_/check_.
-- select tablename, policyname, qual as using_, with_check as check_ from pg_policies
-- where schemaname = 'public' and tablename in ('devices','audit_logs','field_events','historical_merchants','requisitions')
-- order by 1, 2;

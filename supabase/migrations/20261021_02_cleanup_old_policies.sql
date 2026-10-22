-- Optional clean-up (21 Oct 2026): the old "Permissive …" policies were switched off during the emergency lock-down
-- (now limited to the service role with USING (false)). This removes them for good. Safe to run more than once.
drop policy if exists "Permissive read for audit_logs" on public.audit_logs;
drop policy if exists "Permissive write for audit_logs" on public.audit_logs;
drop policy if exists "Permissive read for all users" on public.branches;
drop policy if exists "Permissive write for all users" on public.branches;
drop policy if exists "Permissive read for devices" on public.devices;
drop policy if exists "Permissive write for devices" on public.devices;
drop policy if exists "Permissive read for historical_merchants" on public.historical_merchants;
drop policy if exists "Permissive write for historical_merchants" on public.historical_merchants;
drop policy if exists "Permissive read for requisitions" on public.requisitions;
drop policy if exists "Permissive write for requisitions" on public.requisitions;

-- ============================================================================================================================
-- 13 Nov 2026 - Portal speed, phase 2: the stock list download in a compact form.
-- The portal reads the whole stock list (27,649 units) when it signs in for the first time in 12 hours. As table rows every
-- unit repeats all 29 column names: 23 MB of JSON. As arrays in a fixed column order the same data is 11 MB, and the browser
-- reads it faster (no column names to parse).
--
-- One new read-only function. Nothing is changed or removed: no table, column, row, policy or existing function.
-- It runs with the caller's own rights (SECURITY INVOKER), so the row-level security of public.devices applies exactly as
-- for the normal table read (a branch account still sees only its own branch's units).
-- The portal uses it when it exists and reads the table as before when it does not, so the order of deployment is free.
-- Safe to run twice.
--
-- The column order below is a contract with src/services/supabaseService.ts (DEVICE_COMPACT_COLUMNS): add new columns only at
-- the END, in both places.
-- ============================================================================================================================

create or replace function public.devices_page_compact(p_from text default '', p_to text default null, p_limit integer default 2000)
returns json
language sql stable security invoker set search_path = '' as $$
  select coalesce(json_agg(json_build_array(
           d.serial, d.type, d.model, d.stage, d.branch_id, d.branch_name, d.stock_in_date, d.deployed_date,
           d.battery_installed_date, d.battery_serial, d.redeploy_count, d.staff, d.merchant_name, d.merchant_phone,
           d.location, d.address, d.mid, d.tid, d.note, d.history, d.archived, d.custom_fields, d.return_reason,
           d.deployment_status, d.stock_status, d.hours_in_stage, d.integrity_hash, d.updated_at, d.row_version)
         order by d.serial), '[]'::json)
    from (select x.*
            from public.devices x
           where x.serial >= coalesce(p_from, '')
             and (p_to is null or x.serial < p_to)
           order by x.serial
           limit least(greatest(coalesce(p_limit, 2000), 1), 5000)) d;
$$;

revoke all on function public.devices_page_compact(text, text, integer) from public, anon;
grant execute on function public.devices_page_compact(text, text, integer) to authenticated, service_role;

notify pgrst, 'reload schema';

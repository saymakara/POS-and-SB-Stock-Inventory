-- 14 (31 Oct 2026, speed) Full stock list read by serial ranges instead of OFFSET.
-- The dashboard read the ~27,600 units as 28 pages "ORDER BY serial OFFSET n": a deep page cost up to 0.6 s of database
-- time (all rows before it are walked through), and 8 at once slowed every other request. This returns the first serial of
-- every page (one index-only pass, ~15 ms); each page is then a direct index range read (~6 ms).
-- SECURITY INVOKER: the reader's own row rules apply (a branch account gets the bounds of its own units only).
create or replace function public.device_page_bounds(p_size integer default 1000)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with x as (select d.serial, row_number() over (order by d.serial) as rn from public.devices d)
  select jsonb_build_object('total', coalesce(max(rn), 0),
           'bounds', coalesce(jsonb_agg(serial order by serial) filter (where (rn - 1) % greatest(least(coalesce(p_size, 1000), 1000), 100) = 0), '[]'::jsonb))
    from x
$$;
revoke all on function public.device_page_bounds(integer) from public, anon;
grant execute on function public.device_page_bounds(integer) to authenticated, service_role;

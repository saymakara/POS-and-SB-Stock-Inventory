-- 04 Nov 2026 · Merchant Visits page: totals of a period. SECURITY INVOKER: the reader's row rules apply (admins: all,
-- branch users: their branch), so it never shows more than the list itself.
create or replace function public.mv_visit_summary(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with v as (
    select activity, staff_id, branch_id, merchant_name, latitude from public.mv_visits
     where (p_from is null or submitted_at >= p_from) and (p_to is null or submitted_at < p_to))
  select jsonb_build_object(
    'total', (select count(*) from v),
    'staff', (select count(distinct staff_id) from v),
    'branches', (select count(distinct branch_id) from v where branch_id is not null),
    'no_branch', (select count(*) from v where branch_id is null),
    'with_gps', (select count(*) from v where latitude is not null),
    'by_activity', coalesce((select jsonb_agg(jsonb_build_object('activity', a, 'n', n) order by n desc, a)
                               from (select coalesce(nullif(activity, ''), '(none)') a, count(*) n from v group by 1) x), '[]'::jsonb))
$$;
revoke all on function public.mv_visit_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.mv_visit_summary(timestamptz, timestamptz) to authenticated;

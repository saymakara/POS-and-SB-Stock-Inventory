-- =====================================================================================================================
-- 20 (1 Nov 2026) Credit Card: Exact Cards Onboarded (Primary + Supplementary after confirmation)
-- =====================================================================================================================

create or replace function public.cc_counts(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'total', count(*),
    'pending', count(*) filter (where review_status = 'PENDING'),
    'confirmed', count(*) filter (where review_status = 'CONFIRMED'),
    'rejected', count(*) filter (where review_status = 'REJECTED'),
    'no_review', count(*) filter (where review_status = 'NO_REVIEW'),
    'cards', coalesce(sum(
      case when review_status <> 'CONFIRMED' then 0
           else (case when request_type = 'Add Supplementary Only' then 0 else 1 end) +
                coalesce(case when jsonb_typeof(supplementary) = 'array' then jsonb_array_length(supplementary) else 0 end, 0)
      end
    ), 0),
    'primary_cards', coalesce(sum(
      case when review_status = 'CONFIRMED' and request_type <> 'Add Supplementary Only' then 1 else 0 end
    ), 0),
    'supp_cards', coalesce(sum(
      case when review_status = 'CONFIRMED' then
        coalesce(case when jsonb_typeof(supplementary) = 'array' then jsonb_array_length(supplementary) else 0 end, 0)
      else 0 end
    ), 0),
    'pending_all', (select count(*) from public.cc_entries x where x.review_status = 'PENDING' and (app.is_admin() or x.branch_id::text = app.branch()))
  )
  from public.cc_entries e
  where (app.is_admin() or e.branch_id::text = app.branch())
    and (p_from is null or e.submitted_at >= p_from) and (p_to is null or e.submitted_at < p_to);
$$;

revoke all on function public.cc_counts(timestamptz, timestamptz) from public, anon;
grant execute on function public.cc_counts(timestamptz, timestamptz) to authenticated, service_role;

-- =============================================================================
-- Migration: 20261101_16_kpi_timeline_all_history.sql
-- Purpose  : Delegate date-based kpi_dashboard_summary(p_since, p_until) overload
--            to the canonical kpi_dashboard_summary(p_from timestamptz, p_to timestamptz).
-- =============================================================================

create or replace function public.kpi_dashboard_summary(p_since date default null, p_until date default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.kpi_dashboard_summary(
    case when p_since is not null then (p_since::timestamp at time zone 'Asia/Phnom_Penh') else null::timestamptz end,
    case when p_until is not null then ((p_until + 1)::timestamp at time zone 'Asia/Phnom_Penh') else null::timestamptz end
  );
$$;

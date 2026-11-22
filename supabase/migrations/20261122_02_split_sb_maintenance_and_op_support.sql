-- ============================================================================================================================
-- 22 Nov 2026: Split Sound Box Maintenance (SBM-) and Sound Box Operational Support (SBO-) into separate KPI rules & counts.
--
-- Previously both SBM- (phone app "SB Maintenance") and SBO- ("SB Operational Support") were stored with kind = 'SB_MAINT'
-- and aggregated together under SB_MAINT ("Sound Box Operational Support").
-- Now:
--   - SBM- entries (source_record_id ~* '^SBM-') count under extra['SB_MAINTENANCE'] -> "Sound Box Maintenance".
--   - Non-SBM SB_MAINT entries (SBO-) remain in sb_maint (SB_MAINT) -> "Sound Box Operational Support".
-- Safe to run twice (idempotent).
-- ============================================================================================================================

-- 1. Add SB_MAINTENANCE rule (matching current SB_MAINT points weight by default)
insert into public.kpi_point_rules (code, category, sub_category, description, points, unit, active, is_system, sort_order, updated_by, updated_at)
values (
  'SB_MAINTENANCE',
  'Sound Box',
  'Sound Box Maintenance',
  'Approved Sound Box maintenance / troubleshooting visit (SBM-)',
  coalesce((select points from public.kpi_point_rules where code = 'SB_MAINT' limit 1), 2.00),
  'per visit',
  true,
  true,
  58,
  'system',
  now()
)
on conflict (code) do nothing;

-- 2. Split SBM- into extra['SB_MAINTENANCE'] and keep SBO- in sb_maint inside both live KPI RPC helpers
do $$
declare
  f text;
  d text;
  old_sb_maint text := $q$(case when fe.device_type = 'Sound Box' and fe.kind = 'SB_MAINT' and fe.status in ('APPROVED', 'PENDING') then 1 else 0 end) as sb_maint,$q$;
  new_sb_maint text := $q$(case when fe.device_type = 'Sound Box' and fe.kind = 'SB_MAINT' and fe.status in ('APPROVED', 'PENDING') and coalesce(fe.source_record_id, '') !~* '^SBM-' then 1 else 0 end) as sb_maint,$q$;
  old_extra text := $q$      case
        when fe.kind not in ('INSTALL', 'REPLACE', 'BATTERY', 'SB_RETURN')
         and fe.status in ('APPROVED', 'PENDING')
         and not (fe.kind = 'SB_MAINT' and coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type') is null)
        then$q$;
  new_extra text := $q$      case
        when fe.kind = 'SB_MAINT' and coalesce(fe.source_record_id, '') ~* '^SBM-' and fe.status in ('APPROVED', 'PENDING')
          then 'SB_MAINTENANCE'
        when fe.kind not in ('INSTALL', 'REPLACE', 'BATTERY', 'SB_RETURN')
         and fe.status in ('APPROVED', 'PENDING')
         and not (fe.kind = 'SB_MAINT' and coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type') is null)
        then$q$;
begin
  foreach f in array array['app.kpi_dashboard_staff_only(date,date)', 'app.kpi_dashboard_summary_compute(date,date)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position(old_sb_maint in d) > 0 and position(old_extra in d) > 0 then
      d := replace(d, old_sb_maint, new_sb_maint);
      d := replace(d, old_extra, new_extra);
      execute d;
      raise notice '% updated to split SB_MAINTENANCE from SB_MAINT', f;
    elsif position('SB_MAINTENANCE' in d) > 0 and position('!~* ''^SBM-''' in d) > 0 then
      raise notice '% already splits SB_MAINTENANCE from SB_MAINT', f;
    else
      raise exception '%: expected sb_maint / extra expressions not found — nothing changed', f;
    end if;
  end loop;
end $$;

-- 3. Flush cached KPI summaries and bump sequence so portal and mobile pick up the split immediately
truncate table app.kpi_summary_cache;
select nextval('app.kpi_data_seq');

notify pgrst, 'reload schema';

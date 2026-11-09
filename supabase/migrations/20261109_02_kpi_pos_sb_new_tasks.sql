-- 20261109_02_kpi_pos_sb_new_tasks.sql
-- Registers POS Terminal & Sound Box accessories & new tasks into public.kpi_point_rules,
-- and creates a dedicated ultra-fast public.kpi_get_settings_fast() RPC for Settings KPI.

insert into public.kpi_point_rules (code, category, sub_category, description, points, unit, active, is_system, sort_order)
values
  ('POS_ADAPTOR', 'POS Terminal', 'POS AC Adaptor Delivery', 'Delivery or replacement of POS AC Adaptor in the field', 1.0, 'per adaptor', true, true, 37),
  ('POS_STAND', 'POS Terminal', 'POS Stand Holder Setup', 'Setup or replacement of POS Stand Holder at merchant counter', 1.0, 'per stand', true, true, 38),
  ('POS_DOCK', 'POS Terminal', 'Charging Dock Installation', 'Installation or replacement of POS Charging Dock', 1.0, 'per dock', true, true, 39),
  ('SB_ADAPTOR', 'Sound Box', 'Sound Box AC Adaptor Delivery', 'Delivery or replacement of Sound Box AC Adaptor', 1.0, 'per adaptor', true, true, 75)
on conflict (code) do update set
  category = excluded.category,
  sub_category = excluded.sub_category,
  description = excluded.description,
  points = case when kpi_point_rules.points is not null and kpi_point_rules.points > 0 then kpi_point_rules.points else excluded.points end,
  unit = excluded.unit,
  sort_order = excluded.sort_order;

-- Ultra-fast lightweight RPC for Settings KPI tab (0-15ms vs 2500ms full dashboard aggregation)
create or replace function public.kpi_get_settings_fast()
returns jsonb language sql stable security definer as $$
  select jsonb_build_object(
    'rules', (
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
      from (select * from public.kpi_point_rules order by sort_order, code) r
    ),
    'targets', (
      select coalesce(to_jsonb(s), '{}'::jsonb)
      from public.kpi_settings s
      where id = 1
    )
  );
$$;

grant execute on function public.kpi_get_settings_fast() to authenticated, anon;

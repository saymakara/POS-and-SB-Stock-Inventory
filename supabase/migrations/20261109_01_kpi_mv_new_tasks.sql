-- 09 Nov 2026 · Ensure all Merchant Visit activities (including new activities) are tracked in KPI rules and counting
insert into public.kpi_point_rules (code, category, sub_category, description, points, unit, active, is_system, sort_order, updated_by, updated_at)
values
  ('MV_MARKET_COVERAGE', 'Merchant Visit', 'Market Coverage', 'Merchant Visit app: visits with the activity "Market Coverage"', 0, 'per visit', true, true, 142, 'system', now()),
  ('MV_REVIEW_GIANT_QR', 'Merchant Visit', 'Review Giant QR', 'Merchant Visit app: visits with the activity "Review Giant QR"', 0, 'per visit', true, true, 143, 'system', now()),
  ('MV_ABA_GASOLINE_LOGO', 'Merchant Visit', 'ABA Gasoline Logo', 'Merchant Visit app: visits with the activity "ABA Gasoline Logo"', 0, 'per visit', true, true, 144, 'system', now()),
  ('MV_PAYWAY_INSPECTION', 'Merchant Visit', 'Payway Inspection', 'Merchant Visit app: visits with the activity "Payway Inspection"', 0, 'per visit', true, true, 145, 'system', now())
on conflict (code) do update set active = true;

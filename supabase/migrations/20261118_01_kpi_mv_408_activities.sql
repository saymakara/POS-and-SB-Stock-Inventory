-- 18 Nov 2026 · Merchant Visit app 4.08.0: three activities are counted in KPI.
--   QR Refreshment (new, a quick button beside KHQR Installation), Booth Event and Standby VIP Merchant (back, opened from More).
-- Codes follow app.kpi_mv_code(activity). Points start at 0 (set them in KPI Rules). Adds rows only; safe to run twice.
insert into public.kpi_point_rules (code, category, sub_category, description, points, unit, active, is_system, sort_order, updated_by, updated_at)
values
  ('MV_QR_REFRESHMENT', 'Merchant Visit', 'QR Refreshment', 'Merchant Visit app: visits with the activity "QR Refreshment"', 0, 'per visit', true, true, 147, 'system', now()),
  ('MV_BOOTH_EVENT', 'Merchant Visit', 'Booth Event', 'Merchant Visit app: visits with the activity "Booth Event"', 0, 'per visit', true, true, 148, 'system', now()),
  ('MV_STANDBY_VIP_MERCHANT', 'Merchant Visit', 'Standby VIP Merchant', 'Merchant Visit app: visits with the activity "Standby VIP Merchant"', 0, 'per visit', true, true, 149, 'system', now())
on conflict (code) do update set active = true;

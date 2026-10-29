-- 29 Oct 2026 · KHQR numbers for the Merchant Visit phone app (Apps Script, service key only):
--   qr_staff_stats  – one staff member's New Installation / QR Replacement today and this month, and the last 5 entries
--                     (the app's "Visits today / this month" cards and "My recent activities")
--   qr_dash_counts  – every KHQR entry since a date, counted per day, branch, staff member and activity
--                     (the management dashboard's Merchant Visits card)
-- Days and months are Phnom Penh days and months.

create or replace function public.qr_staff_stats(p jsonb)
returns jsonb language sql stable security definer set search_path = '' as $$
  with b as (
    select (date_trunc('day', now() at time zone 'Asia/Phnom_Penh')) at time zone 'Asia/Phnom_Penh' as day0,
           (date_trunc('month', now() at time zone 'Asia/Phnom_Penh')) at time zone 'Asia/Phnom_Penh' as mon0
  ), m as (
    select q.activity, q.submitted_at >= b.day0 as today
      from public.qr_installations q, b
     where q.staff_id = p->>'staff_id' and q.submitted_at >= b.mon0
  )
  select jsonb_build_object(
    'today_new', (select count(*) from m where today and activity = 'NEW_INSTALLATION'),
    'today_rep', (select count(*) from m where today and activity = 'QR_REPLACEMENT'),
    'month_new', (select count(*) from m where activity = 'NEW_INSTALLATION'),
    'month_rep', (select count(*) from m where activity = 'QR_REPLACEMENT'),
    'recent', (select coalesce(jsonb_agg(jsonb_build_object('record_id', r.record_id, 'submitted_at', r.submitted_at,
                 'merchant_name', r.merchant_name, 'activity', r.activity) order by r.submitted_at desc), '[]'::jsonb)
                 from (select record_id, submitted_at, merchant_name, activity from public.qr_installations
                        where staff_id = p->>'staff_id' order by submitted_at desc limit 5) r));
$$;

create or replace function public.qr_dash_counts(p jsonb)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('d', t.d, 'br', t.branch_text, 'sid', t.staff_id, 'a', t.activity, 'n', t.n)), '[]'::jsonb)
    from (select (q.submitted_at at time zone 'Asia/Phnom_Penh')::date as d, q.branch_text, q.staff_id, q.activity, count(*) as n
            from public.qr_installations q
           where q.submitted_at >= coalesce((p->>'from')::timestamptz, now() - interval '62 days')
           group by 1, 2, 3, 4) t;
$$;

revoke all on function public.qr_staff_stats(jsonb), public.qr_dash_counts(jsonb) from public, anon, authenticated;
grant execute on function public.qr_staff_stats(jsonb), public.qr_dash_counts(jsonb) to service_role;

-- 29 Oct 2026 · Optimize KHQR SQL queries and indexes for high-speed loading.
-- Up to ~50,000 entries/month: add covering indexes, trigram GIN indexes, and streamline qr_summary and qr_month_history.

-- 1. Covering & Composite Indexes for instantaneous range summaries and pagination
CREATE INDEX IF NOT EXISTS qr_inst_submitted_covering_idx
  ON public.qr_installations (submitted_at)
  INCLUDE (activity, failed_attempts, qr_count);

CREATE INDEX IF NOT EXISTS qr_att_received_covering_idx
  ON public.qr_attempts (received_at)
  INCLUDE (staff_id);

CREATE INDEX IF NOT EXISTS qr_inst_activity_time_idx
  ON public.qr_installations (activity, submitted_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS qr_inst_branch_time_idx
  ON public.qr_installations (branch_id, submitted_at DESC, id DESC);

-- 2. Trigram GIN indexes for fast ILIKE substring searches (instant merchant/staff/record searches)
CREATE INDEX IF NOT EXISTS qr_inst_merchant_trgm_idx
  ON public.qr_installations USING gin (merchant_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS qr_inst_merchant_kh_trgm_idx
  ON public.qr_installations USING gin (merchant_name_kh gin_trgm_ops);

CREATE INDEX IF NOT EXISTS qr_inst_staff_name_trgm_idx
  ON public.qr_installations USING gin (staff_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS qr_inst_record_id_trgm_idx
  ON public.qr_installations USING gin (record_id gin_trgm_ops);

-- 3. High-performance rewrite of qr_summary: runs via index-only scans with COALESCE guarantees
CREATE OR REPLACE FUNCTION public.qr_summary(p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'total', coalesce(i.total, 0),
    'completed', coalesce(i.completed, 0),
    'failed', coalesce(i.failed, 0),
    'install', coalesce(i.install, 0),
    'replace', coalesce(i.repl, 0),
    'qr', coalesce(i.qr, 0),
    'attempts', coalesce(a.attempts, 0),
    'staff_failed', coalesce(a.staff, 0)
  )
  FROM (
    SELECT count(*) AS total,
           count(*) FILTER (WHERE failed_attempts = 0) AS completed,
           count(*) FILTER (WHERE failed_attempts > 0) AS failed,
           count(*) FILTER (WHERE activity = 'NEW_INSTALLATION') AS install,
           count(*) FILTER (WHERE activity = 'QR_REPLACEMENT') AS repl,
           coalesce(sum(qr_count), 0) AS qr
      FROM public.qr_installations
     WHERE (p_from IS NULL OR submitted_at >= p_from)
       AND (p_to IS NULL OR submitted_at < p_to)
  ) i
  CROSS JOIN (
    SELECT count(*) AS attempts,
           count(DISTINCT staff_id) AS staff
      FROM public.qr_attempts
     WHERE (p_from IS NULL OR received_at >= p_from)
       AND (p_to IS NULL OR received_at < p_to)
  ) a;
$$;

-- 4. High-performance rewrite of qr_month_history: direct monthly aggregation with bounded 12-month interval
CREATE OR REPLACE FUNCTION public.qr_month_history(p_months integer DEFAULT 12)
RETURNS TABLE (
  month date,
  entries bigint,
  install bigint,
  replace bigint,
  qr bigint,
  attempts bigint,
  staff_failed bigint,
  detailed boolean
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH months AS (
    SELECT (date_trunc('month', now() AT TIME ZONE 'Asia/Phnom_Penh') - (n || ' month')::interval)::date AS month
    FROM generate_series(0, greatest(1, least(coalesce(p_months, 12), 36)) - 1) n
  ),
  live_e AS (
    SELECT date_trunc('month', submitted_at AT TIME ZONE 'Asia/Phnom_Penh')::date AS month,
           count(*) AS entries,
           count(*) FILTER (WHERE activity = 'NEW_INSTALLATION') AS install,
           count(*) FILTER (WHERE activity = 'QR_REPLACEMENT') AS replace,
           coalesce(sum(qr_count), 0) AS qr
    FROM public.qr_installations
    WHERE submitted_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Phnom_Penh') - (p_months || ' month')::interval)
    GROUP BY 1
  ),
  live_a AS (
    SELECT date_trunc('month', received_at AT TIME ZONE 'Asia/Phnom_Penh')::date AS month,
           count(*) AS attempts,
           count(DISTINCT staff_id) AS staff_failed
    FROM public.qr_attempts
    WHERE received_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Phnom_Penh') - (p_months || ' month')::interval)
    GROUP BY 1
  ),
  summ AS (
    SELECT s.month,
           sum(s.entries)::bigint AS entries,
           sum(s.install)::bigint AS install,
           sum(s.replace)::bigint AS replace,
           sum(s.qr)::bigint AS qr,
           sum(s.attempts)::bigint AS attempts,
           count(DISTINCT s.staff_id) FILTER (WHERE s.attempts > 0)::bigint AS staff_failed
    FROM public.qr_monthly_summary s
    WHERE s.month >= (date_trunc('month', now() AT TIME ZONE 'Asia/Phnom_Penh') - (p_months || ' month')::interval)::date
    GROUP BY s.month
  )
  SELECT m.month,
         (coalesce(e.entries, 0) + coalesce(s.entries, 0))::bigint AS entries,
         (coalesce(e.install, 0) + coalesce(s.install, 0))::bigint AS install,
         (coalesce(e.replace, 0) + coalesce(s.replace, 0))::bigint AS replace,
         (coalesce(e.qr, 0) + coalesce(s.qr, 0))::bigint AS qr,
         (coalesce(a.attempts, 0) + coalesce(s.attempts, 0))::bigint AS attempts,
         greatest(coalesce(a.staff_failed, 0), coalesce(s.staff_failed, 0))::bigint AS staff_failed,
         (m.month >= public.qr_keep_from()::date) AS detailed
  FROM months m
  LEFT JOIN live_e e ON e.month = m.month
  LEFT JOIN live_a a ON a.month = m.month
  LEFT JOIN summ s ON s.month = m.month
  ORDER BY m.month DESC;
$$;

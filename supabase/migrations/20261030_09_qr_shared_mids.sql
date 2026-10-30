-- 09 (30 Oct 2026) KHQR: one MID entered by two or more staff on the same day (Phnom Penh time)
-- Read-only: a list function and one more number in the KHQR statistics. Branch rules apply (the reader's own rights).

create or replace function public.qr_shared_mids(p_from timestamptz default null, p_to timestamptz default null, p_limit integer default 200)
 returns table(day date, mid text, merchant_name text, staff_count integer, entries integer, branches text,
               first_at timestamptz, last_at timestamptz, items jsonb)
 language sql stable set search_path to '' as $function$
  SELECT (q.submitted_at AT TIME ZONE 'Asia/Phnom_Penh')::date AS day,
         q.mid,
         max(coalesce(nullif(q.merchant_name, ''), q.merchant_name_kh)) AS merchant_name,
         count(DISTINCT q.staff_id)::int AS staff_count,
         count(*)::int AS entries,
         string_agg(DISTINCT nullif(q.branch_text, ''), ', ') AS branches,
         min(q.submitted_at) AS first_at,
         max(q.submitted_at) AS last_at,
         jsonb_agg(jsonb_build_object('record_id', q.record_id, 'staff_id', q.staff_id, 'staff_name', q.staff_name,
                   'branch', q.branch_text, 'activity', q.activity, 'qr', q.qr_count, 'at', q.submitted_at)
                   ORDER BY q.submitted_at) AS items
    FROM public.qr_installations q
   WHERE (p_from IS NULL OR q.submitted_at >= p_from)
     AND (p_to IS NULL OR q.submitted_at < p_to)
     AND coalesce(q.mid, '') <> ''
   GROUP BY 1, 2
  HAVING count(DISTINCT q.staff_id) > 1
   ORDER BY 1 DESC, 4 DESC, 8 DESC
   LIMIT least(greatest(coalesce(p_limit, 200), 1), 1000);
$function$;
revoke all on function public.qr_shared_mids(timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.qr_shared_mids(timestamptz, timestamptz, integer) to authenticated, service_role;

-- the statistics gain 'shared_mids' (how many MID-days) and 'shared_mid_staff' (staff involved in them)
create or replace function public.qr_summary(p_from timestamptz default null, p_to timestamptz default null)
 returns jsonb language sql stable set search_path to '' as $function$
  SELECT jsonb_build_object(
    'total', coalesce(i.total, 0), 'completed', coalesce(i.completed, 0), 'failed', coalesce(i.failed, 0),
    'install', coalesce(i.install, 0), 'replace', coalesce(i.repl, 0), 'qr', coalesce(i.qr, 0),
    'attempts', coalesce(a.attempts, 0), 'staff_failed', coalesce(a.staff, 0),
    'wrong_scans', coalesce(a.wrong_scans, 0), 'wrong_scan_staff', coalesce(a.wrong_staff, 0),
    'shared_mids', coalesce(sm.n, 0), 'shared_mid_staff', coalesce(sm.staff, 0))
  FROM (
    SELECT count(*) AS total, count(*) FILTER (WHERE failed_attempts = 0) AS completed, count(*) FILTER (WHERE failed_attempts > 0) AS failed,
           count(*) FILTER (WHERE activity = 'NEW_INSTALLATION') AS install, count(*) FILTER (WHERE activity = 'QR_REPLACEMENT') AS repl,
           coalesce(sum(qr_count), 0) AS qr
      FROM public.qr_installations
     WHERE (p_from IS NULL OR submitted_at >= p_from) AND (p_to IS NULL OR submitted_at < p_to)
  ) i
  CROSS JOIN (
    SELECT count(*) FILTER (WHERE kind = 'SUBMIT_BLOCKED') AS attempts,
           count(DISTINCT staff_id) FILTER (WHERE kind = 'SUBMIT_BLOCKED') AS staff,
           count(*) FILTER (WHERE kind = 'WRONG_SCAN') AS wrong_scans,
           count(DISTINCT staff_id) FILTER (WHERE kind = 'WRONG_SCAN') AS wrong_staff
      FROM public.qr_attempts
     WHERE (p_from IS NULL OR received_at >= p_from) AND (p_to IS NULL OR received_at < p_to)
  ) a
  CROSS JOIN (
    WITH g AS (
      SELECT (submitted_at AT TIME ZONE 'Asia/Phnom_Penh')::date AS d, mid, array_agg(DISTINCT staff_id) AS st
        FROM public.qr_installations
       WHERE (p_from IS NULL OR submitted_at >= p_from) AND (p_to IS NULL OR submitted_at < p_to) AND coalesce(mid, '') <> ''
       GROUP BY 1, 2
      HAVING count(DISTINCT staff_id) > 1
    )
    SELECT (SELECT count(*) FROM g) AS n,
           (SELECT count(DISTINCT s) FROM g, unnest(g.st) AS s) AS staff
  ) sm;
$function$;

-- same-day MID lookups
create index if not exists qr_inst_mid_time_idx on public.qr_installations (mid, submitted_at);

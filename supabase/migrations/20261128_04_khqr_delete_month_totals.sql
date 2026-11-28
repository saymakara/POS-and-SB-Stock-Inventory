-- (28 Nov 2026, owner) Settings -> KHQR Installation data kept -> Delete: a deleted month is deleted completely.
--
-- Before: "Delete details" removed the entries of the month but kept its daily / monthly totals, so the KHQR page
-- (cards), KPI Performance and the Dashboard still counted the month (October 2026: 454 entries, deleted on 21 Nov,
-- still shown as 454 entries and 1,304 QR materials).
-- Now: deleting a month removes the entries AND the totals of that month (daily entries, failed attempts / wrong scans,
-- same MID by 2+ staff, monthly history). The month then counts 0 everywhere: KHQR page, KPI Performance and Dashboard.
-- This cannot be undone.
--
-- Unchanged: the automatic night clean-up (keep N months) still deletes only the details of older months and keeps
-- their totals; such a month shows "Totals only" in Settings and now has a "Delete" button to remove the totals too.
--
-- Also done once here: October 2026 (and any other month already deleted with the Delete button) loses its totals.
-- Safe to run more than once.

create or replace function app.qr_delete_month_totals(p_month date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_to date := (p_month + interval '1 month')::date; a int; b int; c int; d int;
begin
  delete from public.qr_daily_entries where day >= p_month and day < v_to;      get diagnostics a = row_count;
  delete from public.qr_daily_attempts where day >= p_month and day < v_to;     get diagnostics b = row_count;
  delete from public.qr_daily_shared_mids where day >= p_month and day < v_to;  get diagnostics c = row_count;
  delete from public.qr_monthly_summary where month = p_month;                  get diagnostics d = row_count;
  if a + b + c + d > 0 and to_regclass('app.kpi_summary_cache') is not null then
    delete from app.kpi_summary_cache where true;                               -- KPI figures are rebuilt without the month
  end if;
  return jsonb_build_object('daily_rows', a, 'attempt_rows', b, 'shared_mid_rows', c, 'monthly_rows', d);
end $function$;
revoke all on function app.qr_delete_month_totals(date) from public, anon, authenticated;

create or replace function public.qr_delete_month(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '60s'
as $function$
declare me public.staff_profiles := app.qr_super_admin(); v_m date; v_from timestamptz; v_to timestamptz; r jsonb; t jsonb := '{}'::jsonb;
  v_entries bigint := 0;
begin
  if me.user_id is null then raise exception 'Only a Super Admin can delete KHQR data.' using errcode = '42501'; end if;
  begin v_m := to_date(p->>'month', 'YYYY-MM'); exception when others then v_m := null; end;
  if v_m is null or p->>'month' !~ '^\d{4}-\d{2}$' then raise exception 'Choose a month (YYYY-MM).' using errcode = '22023'; end if;
  if v_m >= date_trunc('month', now() at time zone 'Asia/Phnom_Penh')::date then
    raise exception 'The current month cannot be deleted.' using errcode = '22023';
  end if;
  v_from := v_m::timestamp at time zone 'Asia/Phnom_Penh'; v_to := (v_m + interval '1 month')::timestamp at time zone 'Asia/Phnom_Penh';
  r := app.qr_archive_range(v_from, v_to, least(greatest(coalesce((p->>'max')::integer, 5000), 100), 20000));
  -- (28 Nov 2026) the last part: the totals of the month go too (they were just updated by the parts above)
  if coalesce((r->>'remaining')::bigint, 0) = 0 then
    select coalesce(sum(entries), 0) into v_entries from public.qr_monthly_summary where month = v_m;
    t := app.qr_delete_month_totals(v_m);
  end if;
  if (r->>'entries_removed')::integer + (r->>'attempts_removed')::integer > 0
     or coalesce((t->>'daily_rows')::int, 0) + coalesce((t->>'monthly_rows')::int, 0) + coalesce((t->>'attempt_rows')::int, 0) > 0 then
    insert into public.audit_logs (title, detail, branch_id, action, target, actor_id, actor_emp, actor_name, role, status)
    values ('KHQR Month Deleted', 'KHQR Installation of ' || to_char(v_m, 'Mon YYYY') || ': ' || (r->>'entries_removed') || ' entries, '
              || (r->>'attempts_removed') || ' attempts deleted'
              || case when (r->>'remaining')::bigint > 0 then ' - continuing'
                      else ' · totals deleted too (' || v_entries || ' entries no longer counted in KHQR, KPI Performance and Dashboard)' end,
            me.branch_id, 'QR_DELETE_MONTH', to_char(v_m, 'YYYY-MM'), me.user_id, me.emp_id, me.name, me.role, 'Success');
  end if;
  return r || jsonb_build_object('month', to_char(v_m, 'YYYY-MM'), 'totals_removed', t, 'entries_uncounted', v_entries);
end $function$;
revoke all on function public.qr_delete_month(jsonb) from public, anon;
grant execute on function public.qr_delete_month(jsonb) to authenticated, service_role;

-- once: months already deleted with the Delete button (October 2026) lose their totals too
do $$
declare m record; t jsonb;
begin
  for m in
    select distinct to_date(a.target, 'YYYY-MM') as month
      from public.audit_logs a
     where a.action = 'QR_DELETE_MONTH' and a.target ~ '^\d{4}-\d{2}$'
  loop
    if not exists (select 1 from public.qr_installations q
                    where q.submitted_at >= m.month::timestamp at time zone 'Asia/Phnom_Penh'
                      and q.submitted_at < (m.month + interval '1 month')::timestamp at time zone 'Asia/Phnom_Penh') then
      t := app.qr_delete_month_totals(m.month);
      raise notice 'KHQR % totals deleted: %', to_char(m.month, 'Mon YYYY'), t;
      if coalesce((t->>'daily_rows')::int, 0) + coalesce((t->>'monthly_rows')::int, 0) > 0 then
        insert into public.audit_logs (title, detail, branch_id, action, target, status)
        values ('KHQR Month Totals Deleted', 'KHQR Installation of ' || to_char(m.month, 'Mon YYYY')
                || ': totals deleted (the month was deleted before; it no longer counts in KHQR, KPI Performance and Dashboard)',
                '100', 'QR_DELETE_MONTH_TOTALS', to_char(m.month, 'YYYY-MM'), 'Success');
      end if;
    end if;
  end loop;
end $$;

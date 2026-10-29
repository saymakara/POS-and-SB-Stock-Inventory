-- 29 Oct 2026 · KHQR: keep only the current and the previous month (Phnom Penh calendar months).
-- Every night a scheduled job (pg_cron) moves older KHQR entries and failed attempts into a small monthly summary
-- (per staff member: entries, New Installation, QR Replacement, QR materials, failed attempts) and deletes them.
-- The summary is kept for good, so monthly totals and trends stay available. Nothing else is touched.
-- Also: qr_month_history (dashboard: monthly totals) and qr_export (phone app: CSV exports, service key only).

create table if not exists public.qr_monthly_summary (
  month        date not null,                     -- first day of the month (Phnom Penh)
  staff_id     text not null,
  staff_name   text,
  branch_text  text,
  branch_id    varchar references public.branches(id) on update cascade on delete set null,
  entries      integer not null default 0,
  install      integer not null default 0,
  replace      integer not null default 0,
  qr           integer not null default 0,
  attempts     integer not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (month, staff_id)
);
alter table public.qr_monthly_summary enable row level security;
revoke all on public.qr_monthly_summary from anon;
revoke insert, update, delete on public.qr_monthly_summary from authenticated;
grant select on public.qr_monthly_summary to authenticated;
drop policy if exists qr_sum_read on public.qr_monthly_summary;
create policy qr_sum_read on public.qr_monthly_summary for select to authenticated
  using ((select app.is_admin()) or (branch_id)::text = (select app.branch()));

-- The first moment that is kept: the 1st of the previous month, 00:00 Phnom Penh time.
create or replace function public.qr_keep_from()
returns timestamptz language sql stable set search_path = '' as $$
  select (date_trunc('month', now() at time zone 'Asia/Phnom_Penh') - interval '1 month') at time zone 'Asia/Phnom_Penh';
$$;

-- Moves up to p_max older entries and p_max older failed attempts into the summary, then deletes them (one transaction:
-- a row is either still in its table or counted in the summary, never both and never lost). Run again until 0.
create or replace function public.qr_retention_run(p_max integer default 50000)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_cut timestamptz := public.qr_keep_from(); v_e integer := 0; v_a integer := 0; v_n integer := greatest(1, least(coalesce(p_max, 50000), 200000));
begin
  with del as (
    delete from public.qr_installations q
     where q.id in (select id from public.qr_installations where submitted_at < v_cut order by id limit v_n)
    returning q.submitted_at, q.staff_id, q.staff_name, q.branch_text, q.branch_id, q.activity, q.qr_count
  ), agg as (
    select date_trunc('month', submitted_at at time zone 'Asia/Phnom_Penh')::date as month, staff_id,
           max(staff_name) as staff_name, max(branch_text) as branch_text, max(branch_id) as branch_id,
           count(*)::int as entries, (count(*) filter (where activity = 'NEW_INSTALLATION'))::int as install,
           (count(*) filter (where activity = 'QR_REPLACEMENT'))::int as replace, coalesce(sum(qr_count), 0)::int as qr
      from del group by 1, 2
  ), ins as (
    insert into public.qr_monthly_summary as s (month, staff_id, staff_name, branch_text, branch_id, entries, install, replace, qr)
    select month, staff_id, staff_name, branch_text, branch_id, entries, install, replace, qr from agg
    on conflict (month, staff_id) do update
      set entries = s.entries + excluded.entries, install = s.install + excluded.install, replace = s.replace + excluded.replace,
          qr = s.qr + excluded.qr, staff_name = coalesce(excluded.staff_name, s.staff_name),
          branch_text = coalesce(excluded.branch_text, s.branch_text), branch_id = coalesce(excluded.branch_id, s.branch_id), updated_at = now()
    returning 1
  )
  select coalesce(sum(entries), 0) into v_e from agg;

  with del as (
    delete from public.qr_attempts a
     where a.id in (select id from public.qr_attempts where received_at < v_cut order by id limit v_n)
    returning a.received_at, a.staff_id, a.staff_name, a.branch_text, a.branch_id
  ), agg as (
    select date_trunc('month', received_at at time zone 'Asia/Phnom_Penh')::date as month, staff_id,
           max(staff_name) as staff_name, max(branch_text) as branch_text, max(branch_id) as branch_id, count(*)::int as attempts
      from del group by 1, 2
  ), ins as (
    insert into public.qr_monthly_summary as s (month, staff_id, staff_name, branch_text, branch_id, attempts)
    select month, staff_id, staff_name, branch_text, branch_id, attempts from agg
    on conflict (month, staff_id) do update
      set attempts = s.attempts + excluded.attempts, staff_name = coalesce(s.staff_name, excluded.staff_name),
          branch_text = coalesce(s.branch_text, excluded.branch_text), branch_id = coalesce(s.branch_id, excluded.branch_id), updated_at = now()
    returning 1
  )
  select coalesce(sum(attempts), 0) into v_a from agg;

  return jsonb_build_object('kept_from', v_cut, 'entries_removed', v_e, 'attempts_removed', v_a);
end $$;

-- Monthly totals for the dashboard: summarized months + the months still kept in detail (SECURITY INVOKER: RLS applies).
create or replace function public.qr_month_history(p_months integer default 12)
returns table (month date, entries bigint, install bigint, replace bigint, qr bigint, attempts bigint, staff_failed bigint, detailed boolean)
language sql stable security invoker set search_path = '' as $$
  with live_e as (
    select date_trunc('month', submitted_at at time zone 'Asia/Phnom_Penh')::date as month, staff_id,
           count(*) as entries, count(*) filter (where activity = 'NEW_INSTALLATION') as install,
           count(*) filter (where activity = 'QR_REPLACEMENT') as replace, coalesce(sum(qr_count), 0) as qr, 0::bigint as attempts
      from public.qr_installations group by 1, 2
  ), live_a as (
    select date_trunc('month', received_at at time zone 'Asia/Phnom_Penh')::date as month, staff_id,
           0::bigint, 0::bigint, 0::bigint, 0::bigint, count(*) as attempts
      from public.qr_attempts group by 1, 2
  ), summ as (
    select s.month, s.staff_id, s.entries::bigint, s.install::bigint, s.replace::bigint, s.qr::bigint, s.attempts::bigint from public.qr_monthly_summary s
  ), per_staff as (
    select u.month, u.staff_id, sum(u.entries) as entries, sum(u.install) as install, sum(u.replace) as replace, sum(u.qr) as qr, sum(u.attempts) as attempts
      from (select * from live_e union all select * from live_a union all select * from summ) u
     group by 1, 2
  )
  select p.month, sum(p.entries)::bigint, sum(p.install)::bigint, sum(p.replace)::bigint, sum(p.qr)::bigint, sum(p.attempts)::bigint,
         (count(*) filter (where p.attempts > 0))::bigint,
         p.month >= (public.qr_keep_from() at time zone 'Asia/Phnom_Penh')::date
    from per_staff p
   group by p.month
   order by p.month desc
   limit greatest(1, least(coalesce(p_months, 12), 60));
$$;

-- CSV exports of the phone app (Apps Script, service key): one page of entries, oldest first.
-- p: { from, to (ISO), staff_id?, branches? (array, compared without case), offset?, limit? (max 5000) }
create or replace function public.qr_export(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_lim integer := greatest(1, least(coalesce((p->>'limit')::int, 5000), 5000)); v_off integer := greatest(0, coalesce((p->>'offset')::int, 0));
        v_br text[]; v_out jsonb;
begin
  if jsonb_typeof(p->'branches') = 'array' then
    select array_agg(lower(btrim(x))) into v_br from jsonb_array_elements_text(p->'branches') x;
  end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.submitted_at, t.id), '[]'::jsonb) into v_out from (
    select q.id, q.record_id, q.submitted_at, q.captured_at, q.activity, q.merchant_name, q.merchant_name_kh, q.mid, q.qr_count,
           q.location, q.khan, q.latitude, q.longitude, q.remark, q.photo_count, q.telegram_link, q.staff_id, q.staff_name, q.branch_text
      from public.qr_installations q
     where (p->>'from' is null or q.submitted_at >= (p->>'from')::timestamptz)
       and (p->>'to' is null or q.submitted_at < (p->>'to')::timestamptz)
       and (coalesce(p->>'staff_id', '') = '' or q.staff_id = p->>'staff_id')
       and (v_br is null or lower(btrim(coalesce(q.branch_text, ''))) = any (v_br))
     order by q.submitted_at, q.id
     offset v_off limit v_lim) t;
  return v_out;
end $$;

revoke all on function public.qr_retention_run(integer), public.qr_export(jsonb) from public, anon, authenticated;
grant execute on function public.qr_retention_run(integer), public.qr_export(jsonb) to service_role;
revoke all on function public.qr_month_history(integer) from public, anon;
grant execute on function public.qr_month_history(integer) to authenticated;
grant execute on function public.qr_keep_from() to authenticated, service_role;

-- The nightly job: every 20 minutes between 01:00 and 04:59 Phnom Penh time (18:00–21:59 UTC), up to 50,000 rows each.
create extension if not exists pg_cron with schema pg_catalog;
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'khqr-retention';
  perform cron.schedule('khqr-retention', '*/20 18-21 * * *', 'select public.qr_retention_run(50000)');
end $$;

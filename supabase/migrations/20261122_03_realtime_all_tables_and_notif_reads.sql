-- ============================================================================================================================
-- 22 Nov 2026:
--   1. Ensure ALL active portal tables belong to the `supabase_realtime` publication so changes made by any user
--      stream dynamically to every connected session without reloading the page.
--   2. Persist per-user read notifications (`public.notification_reads`) and helper RPC (`public.mark_notifications_read`)
--      so notifications already read stay marked read across sign-out / re-sign-in and across browsers/devices.
-- Safe to run multiple times (idempotent).
-- ============================================================================================================================

-- 1. Persistent per-user notification read receipts
create table if not exists public.notification_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  notif_id text not null,
  read_at timestamptz not null default now(),
  primary key (user_id, notif_id)
);

create index if not exists idx_notification_reads_user_time
  on public.notification_reads (user_id, read_at desc);

alter table public.notification_reads enable row level security;

grant select, insert, update, delete on table public.notification_reads to authenticated;
grant all on table public.notification_reads to service_role;

drop policy if exists "notification_reads_select_own" on public.notification_reads;
create policy "notification_reads_select_own"
  on public.notification_reads for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "notification_reads_insert_own" on public.notification_reads;
create policy "notification_reads_insert_own"
  on public.notification_reads for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "notification_reads_update_own" on public.notification_reads;
create policy "notification_reads_update_own"
  on public.notification_reads for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "notification_reads_delete_own" on public.notification_reads;
create policy "notification_reads_delete_own"
  on public.notification_reads for delete to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.mark_notifications_read(p_notif_ids text[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer := 0;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  if p_notif_ids is null or coalesce(array_length(p_notif_ids, 1), 0) = 0 then
    return 0;
  end if;

  with inserted as (
    insert into public.notification_reads (user_id, notif_id, read_at)
    select distinct v_uid, btrim(x), now()
    from unnest(p_notif_ids) as t(x)
    where btrim(coalesce(x, '')) <> ''
    on conflict (user_id, notif_id)
    do update set read_at = excluded.read_at
    returning 1
  )
  select count(*)::integer into v_count from inserted;

  return v_count;
end;
$$;

revoke all on function public.mark_notifications_read(text[]) from public, anon;
grant execute on function public.mark_notifications_read(text[]) to authenticated, service_role;

-- 2. Add every portal table to supabase_realtime publication if it exists and is not yet included
do $$
declare
  v_table text;
  v_tables text[] := array[
    'devices',
    'requisitions',
    'historical_merchants',
    'audit_logs',
    'branches',
    'branch_aliases',
    'staff_profiles',
    'field_events',
    'qr_installations',
    'qr_attempts',
    'cc_entries',
    'cc_settings',
    'mv_visits',
    'phone_record_edits',
    'deleted_phone_records',
    'material_types',
    'material_qty',
    'material_lost',
    'material_movements',
    'material_serials',
    'material_counts',
    'device_kits',
    'kpi_point_rules',
    'kpi_settings',
    'kpi_team_leads',
    'notification_reads'
  ];
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping publication registration';
    return;
  end if;

  foreach v_table in array v_tables loop
    if exists (
      select 1 from pg_tables
      where schemaname = 'public' and tablename = v_table
    ) and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
      raise notice 'Added public.% to supabase_realtime', v_table;
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';

-- 04 Nov 2026 · Every Merchant Visit app submission reaches the In-Store Management Portal.
--
-- 1. POS maintenance / return (Merchant Visit 3.68): three more phone-record kinds in field_events, reviewed and approved
--    in Phone App Review > POS Terminal like the others:
--      POS_MAINT     POS Active Maintenance      approve: a line in the device history
--      POS_INACTIVE  POS In-Active Maintenance   approve: a line in the device history
--      POS_RETURN    POS Return & Terminate      approve: like a Sound Box return - the terminal leaves the merchant
--                                                (Merchant History: TERMINATED) and goes to the chosen stage
--                                                (branch reserve by default, HQ stock or faulty).
--    The details (request type, 1st / 2nd, onsite / remote, product, returned items) travel in payload.entry.summary.
-- 2. Merchant visits (Account Opening, QR Merchant Onboarding, KHQR Issue, ...): new table mv_visits, one row per visit,
--    filled by mv_visit_sync (service key only, as field_sync_record). Read: admins all, branch users their branch.
--    field_known_records also knows visits, so "check & resend missing entries" covers them.
--
-- The existing functions are changed by exact text replacement: if any expected text is not found the migration stops
-- and nothing is changed. Nothing existing is removed; the five existing kinds behave exactly as before.

alter table public.field_events drop constraint if exists field_events_kind_check;
alter table public.field_events add constraint field_events_kind_check
  check (kind = any (array['INSTALL', 'REPLACE', 'BATTERY', 'SB_MAINT', 'SB_RETURN', 'POS_MAINT', 'POS_INACTIVE', 'POS_RETURN']));

do $mig$
declare v_src text; v_new text;
begin
  -- 1a. field_sync_record: accept the three POS kinds
  v_src := pg_get_functiondef('public.field_sync_record(jsonb)'::regprocedure);
  v_new := replace(v_src, $a$if v_kind not in ('INSTALL', 'REPLACE', 'BATTERY', 'SB_MAINT', 'SB_RETURN') then$a$,
                          $a$if v_kind not in ('INSTALL', 'REPLACE', 'BATTERY', 'SB_MAINT', 'SB_RETURN', 'POS_MAINT', 'POS_INACTIVE', 'POS_RETURN') then$a$);
  if v_new = v_src then raise exception 'field_sync_record: expected text not found'; end if;
  execute v_new;

  -- 1b. field_issues: the MID check of a service visit also for the POS kinds
  v_src := pg_get_functiondef('app.field_issues(text,text,text,text,text,text,character varying,text)'::regprocedure);
  v_new := replace(v_src, $a$if p_kind in ('SB_MAINT', 'SB_RETURN') and coalesce(p_mid, '') <> ''$a$,
                          $a$if p_kind in ('SB_MAINT', 'SB_RETURN', 'POS_MAINT', 'POS_INACTIVE', 'POS_RETURN') and coalesce(p_mid, '') <> ''$a$);
  if v_new = v_src then raise exception 'field_issues: expected text not found'; end if;
  execute v_new;

  -- 1c. field_approve: what approving a POS maintenance / return does
  v_src := pg_get_functiondef('public.field_approve(bigint,text,jsonb)'::regprocedure);
  v_new := replace(v_src, $a$  end if;

  update public.field_events set status = 'APPROVED'$a$, $a$  elsif e.kind in ('POS_MAINT', 'POS_INACTIVE') then
    update public.devices set
      history = jsonb_build_array(app.stamp() || ' | ' || case when e.kind = 'POS_MAINT' then 'POS Active Maintenance' else 'POS In-Active Maintenance' end
                || ' | ' || coalesce(nullif(e.payload->'entry'->>'summary', ''), 'Maintenance visit')
                || coalesce(' · ' || nullif(e.remarks, ''), '') || ' · ' || v_rid || ' by ' || v_who) || coalesce(history, '[]'::jsonb)
    where serial = d.serial;
    v_applied := jsonb_build_object('serial', d.serial, 'maintenance', v_day);

  elsif e.kind = 'POS_RETURN' then
    if v_ret = '' then v_ret := 'BRANCH_RESERVE'; end if;
    if v_ret not in ('FAULTY', 'BRANCH_RESERVE', 'HQ_STOCK') then raise exception 'Return stage % is not allowed.', v_ret; end if;
    if d.stage = 'COMPLETE' and coalesce(d.mid, '') <> '' then
      insert into public.historical_merchants (record_id, merchant_name, merchant_phone, address, mid, tid, device_type, model, serial,
        battery_serial, branch_id, branch_name, installed_date, returned_date, active_duration_months, return_reason, status, handled_by_staff, notes)
      values ('HM-' || e.id, coalesce(nullif(d.merchant_name, ''), v_merchant, 'Merchant'), d.merchant_phone, d.address, d.mid, coalesce(d.tid, ''),
        d.type, d.model, d.serial, d.battery_serial, d.branch_id, d.branch_name,
        case when d.deployed_date ~ '^\d{4}-\d{2}-\d{2}' then left(d.deployed_date, 10)::date end, v_day::date,
        greatest(1, case when d.deployed_date ~ '^\d{4}-\d{2}-\d{2}' then ((v_day::date - left(d.deployed_date, 10)::date) / 30) else 1 end),
        coalesce(nullif(e.remarks, ''), 'Merchant returned the POS terminal (Return & Terminate)'), 'TERMINATED', v_who,
        v_rid || coalesce(' · ' || nullif(e.payload->'entry'->>'summary', ''), ''))
      on conflict (record_id) do nothing;
    end if;
    update public.devices set stage = v_ret, branch_id = case when v_ret = 'HQ_STOCK' then '100' else branch_id end, branch_name = case when v_ret = 'HQ_STOCK' then 'Head Office' else branch_name end, mid = null, tid = null, merchant_name = null, merchant_phone = null,
      return_reason = coalesce(nullif(e.remarks, ''), 'Returned to bank (Return & Terminate)'),
      deployment_status = case when v_ret = 'FAULTY' then 'Faulty / Repair' else 'In-Stock (Reserve)' end,
      stock_status = case when v_ret = 'FAULTY' then 'Faulty' else 'In-Stock' end,
      custom_fields = coalesce(custom_fields, '{}'::jsonb) || jsonb_build_object('returnedByStaff', v_who, 'returnedDate', v_day),
      history = jsonb_build_array(app.stamp() || ' | Returned to Bank | ' || coalesce(d.merchant_name, 'Merchant') || ' (MID ' || coalesce(d.mid, '—')
                || ') returned the POS terminal → ' || initcap(replace(v_ret, '_', ' '))
                || coalesce(' · ' || nullif(e.payload->'entry'->>'summary', ''), '') || ' · ' || v_rid || ' by ' || v_who) || coalesce(history, '[]'::jsonb)
    where serial = d.serial;
    v_applied := jsonb_build_object('serial', d.serial, 'from_stage', d.stage, 'to_stage', v_ret);
  end if;

  update public.field_events set status = 'APPROVED'$a$);
  if v_new = v_src then raise exception 'field_approve: expected text not found'; end if;
  execute v_new;
end $mig$;

-- 2. merchant visits
create table if not exists public.mv_visits (
  id            bigserial primary key,
  record_id     text not null unique,
  activity      text,
  merchant_name text,
  mid           text,
  location      text,
  khan          text,
  latitude      double precision,
  longitude     double precision,
  remarks       text,
  answers       jsonb not null default '{}'::jsonb,   -- every answer of the visit form (the Fields tab decides the questions)
  photo_link    text,
  staff_id      text,
  staff_name    text,
  branch_text   text,
  branch_id     varchar,
  submitted_at  timestamptz,
  edited_at     timestamptz,
  payload_hash  text,
  received_at   timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists mv_visits_submitted_idx on public.mv_visits (submitted_at desc);
create index if not exists mv_visits_branch_idx on public.mv_visits (branch_id, submitted_at desc);
create index if not exists mv_visits_staff_idx on public.mv_visits (staff_id, submitted_at desc);
alter table public.mv_visits enable row level security;
drop policy if exists mv_visits_read on public.mv_visits;
create policy mv_visits_read on public.mv_visits for select to authenticated
  using ((select app.is_admin()) or (branch_id)::text = (select app.branch()));
revoke all on public.mv_visits from anon;
revoke insert, update, delete, truncate on public.mv_visits from authenticated;
grant select on public.mv_visits to authenticated;

create or replace function public.mv_visit_sync(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rec  text := nullif(btrim(coalesce(p->>'record_id', '')), '');
  v_hash text := md5((p - 'sent_at')::text);
  v_bid  varchar := app.resolve_branch(p->>'branch');
  v_num  constant text := '^-?[0-9]+(\.[0-9]+)?$';
  v_old  public.mv_visits;
begin
  if v_rec is null or v_rec !~ '^[A-Z0-9]+-\d{8}-\d{3,}$' then raise exception 'INPUT: a valid record_id is required.' using errcode = '22023'; end if;
  select * into v_old from public.mv_visits where record_id = v_rec;
  if found and v_old.payload_hash = v_hash then
    return jsonb_build_object('record_id', v_rec, 'branch_id', v_old.branch_id, 'unchanged', true);
  end if;
  insert into public.mv_visits as m (record_id, activity, merchant_name, mid, location, khan, latitude, longitude, remarks, answers, photo_link,
    staff_id, staff_name, branch_text, branch_id, submitted_at, payload_hash)
  values (v_rec, left(p->>'activity', 200), left(p->>'merchant_name', 300), left(p->>'mid', 40), left(p->>'location', 120), left(p->>'khan', 120),
    case when p->>'latitude' ~ v_num then (p->>'latitude')::double precision end,
    case when p->>'longitude' ~ v_num then (p->>'longitude')::double precision end,
    left(p->>'remarks', 2000), case when jsonb_typeof(p->'answers') = 'object' then p->'answers' else '{}'::jsonb end, left(p->>'photo_link', 500),
    left(p->>'staff_id', 40), left(p->>'staff_name', 120), left(p->>'branch', 200), v_bid,
    coalesce(nullif(p->>'submitted_at', '')::timestamptz, now()), v_hash)
  on conflict (record_id) do update set
    activity = excluded.activity, merchant_name = excluded.merchant_name, mid = excluded.mid, location = excluded.location, khan = excluded.khan,
    latitude = excluded.latitude, longitude = excluded.longitude, remarks = excluded.remarks, answers = excluded.answers,
    photo_link = coalesce(excluded.photo_link, m.photo_link), staff_id = excluded.staff_id, staff_name = excluded.staff_name,
    branch_text = excluded.branch_text, branch_id = excluded.branch_id, submitted_at = excluded.submitted_at,
    payload_hash = excluded.payload_hash, edited_at = now(), updated_at = now();
  return jsonb_build_object('record_id', v_rec, 'branch_id', v_bid, 'updated', v_old.id is not null);
end $$;
revoke all on function public.mv_visit_sync(jsonb) from public, anon, authenticated;
grant execute on function public.mv_visit_sync(jsonb) to service_role;

-- "check & resend missing entries": visits too
create or replace function public.field_known_records(p jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with ids as (select distinct jsonb_array_elements_text(case when jsonb_typeof(p->'ids') = 'array' then p->'ids' else '[]'::jsonb end) as id)
  select jsonb_build_object('known', coalesce(jsonb_agg(ids.id), '[]'::jsonb))
    from ids
   where exists (select 1 from public.field_events e where e.source_record_id = ids.id)
      or exists (select 1 from public.cc_entries c where c.record_id = ids.id)
      or exists (select 1 from public.mv_visits v where v.record_id = ids.id)
$$;

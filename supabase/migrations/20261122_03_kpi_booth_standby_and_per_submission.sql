-- ============================================================================================================================
-- 22 Nov 2026 - KPI: Booth Event / Standby VIP points, and POS / Sound Box installs counted per submission.
-- Run AFTER 20261122_02 (KPI delete + Sync). Safe to run twice.
--
-- A. POS Terminal and Sound Box Installation / Replacement: one KPI task per SUBMISSION (one outlet visit), however many
--    devices it had (3 terminals installed in one submission = 1 task, not 3). View app.kpi_field_events marks the 2nd,
--    3rd... approved/pending unit of the same submission as not counted; both KPI functions read it. Submitted / rejected
--    rates still count every unit. Setting: per submission (default) or per device.
--
-- B. Booth Event and Standby VIP (Super Admin settings, card "Booth Event & Standby VIP KPI"):
--    Default = the points of the KPI tasks "Booth Event - Full Day / Half Day" and "Standby VIP - Full Day / Half Day".
--    Booth Event, mode "shared" (default):
--      1. A staff member never gets less than the booth points, and gets more when the tasks of the booth earn more.
--      2. Staff with the same Booth Tag on the same day share the booth's points equally: full-day staff get
--         (all points of the tag's staff that day) / (full-day staff + 0.5 x half-day staff), or the booth points if higher.
--      3. Half-day staff get (points of the tag's staff inside their own hours, e.g. 08:00-12:00) / (staff present in
--         those hours), or the half-day booth points if higher; tasks they do outside those hours count normally on top.
--      A booth without a tag is worked out for the staff member alone (rule 1).
--    Booth Event, mode "higher": rule 1 only (no sharing). Mode "fixed": booth points added on top of the tasks (as before).
--    Standby VIP (AEON), mode "higher" (default): individual - the higher of the standby points or the staff member's own
--    points in the standby hours (full day = the whole day). Mode "fixed": as before.
--    The hours come from "Booth Hours" / "VIP Hours" on the form; a half day without hours = the half it was sent in.
--    How it reaches every KPI figure: app.kpi_event_adjust() works out, per staff per day, the difference between the
--    points above and "booth points + own tasks", and the KPI functions add it as adj_pts to every row (network, monthly
--    staff, staff totals). The portal and the Merchant Visit app (4.10.3) add adj_pts to the points.
-- ============================================================================================================================

-- ---- settings ----------------------------------------------------------------------------------------------------------
create table if not exists public.kpi_event_settings (
  id smallint primary key default 1 check (id = 1),
  install_per_submission boolean not null default true,
  booth_mode text not null default 'shared' check (booth_mode in ('fixed', 'higher', 'shared')),
  standby_mode text not null default 'higher' check (standby_mode in ('fixed', 'higher')),
  half_day_weight numeric(4, 2) not null default 0.5 check (half_day_weight > 0 and half_day_weight <= 1),
  updated_by text, updated_at timestamptz default now()
);
insert into public.kpi_event_settings (id) values (1) on conflict (id) do nothing;
alter table public.kpi_event_settings enable row level security;
drop policy if exists kpi_event_settings_read on public.kpi_event_settings;
create policy kpi_event_settings_read on public.kpi_event_settings for select to authenticated using (true);
revoke all on public.kpi_event_settings from anon;
revoke insert, update, delete on public.kpi_event_settings from authenticated;

create or replace function public.kpi_save_event_settings(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me public.staff_profiles; s public.kpi_event_settings;
begin
  select * into me from public.staff_profiles where user_id = auth.uid() and active and not must_change_password;
  if not found or me.role <> 'SUPER_ADMIN' then
    raise exception 'Only a Super Admin can change these KPI settings.' using errcode = '42501';
  end if;
  update public.kpi_event_settings set
    install_per_submission = coalesce((p->>'install_per_submission')::boolean, install_per_submission),
    booth_mode = coalesce(nullif(p->>'booth_mode', ''), booth_mode),
    standby_mode = coalesce(nullif(p->>'standby_mode', ''), standby_mode),
    half_day_weight = coalesce((p->>'half_day_weight')::numeric, half_day_weight),
    updated_by = me.name, updated_at = now()
  where id = 1 returning * into s;
  delete from app.kpi_summary_cache;                                       -- every KPI figure is worked out again
  insert into public.audit_logs (title, detail, branch_id, action, target, actor_id, actor_emp, actor_name, role, status)
  values ('KPI Booth / Standby Settings', 'Booth: ' || s.booth_mode || ' (half day ' || s.half_day_weight || ') · Standby VIP: '
          || s.standby_mode || ' · Installs: ' || case when s.install_per_submission then 'per submission' else 'per device' end,
          '100', 'KPI_EVENT_SETTINGS', 'kpi_event_settings', me.user_id, me.emp_id, me.name, me.role, 'Success');
  return to_jsonb(s);
end $$;
revoke all on function public.kpi_save_event_settings(jsonb) from public, anon;
grant execute on function public.kpi_save_event_settings(jsonb) to authenticated;

-- ---- A. one task per submission ----------------------------------------------------------------------------------------
create or replace view app.kpi_field_events as
select fe.id, fe.source_record_id, fe.unit_no, fe.revision, fe.kind, fe.device_type, fe.serial, fe.old_serial, fe.old_battery,
       fe.new_battery, fe.mid, fe.tid, fe.terminal_name, fe.outlet_name, fe.branch_text, fe.branch_id, fe.staff_id, fe.staff_name,
       fe.recorded_at, fe.latitude, fe.longitude, fe.remarks, fe.payload, fe.payload_hash, fe.issues,
       case when fe.kind in ('INSTALL', 'REPLACE') and fe.status in ('APPROVED', 'PENDING')
                 and coalesce((select s.install_per_submission from public.kpi_event_settings s where s.id = 1), true)
                 and row_number() over (partition by coalesce(fe.source_record_id, fe.id::text), fe.kind, coalesce(fe.device_type, 'POS Terminal'),
                                                     (fe.status in ('APPROVED', 'PENDING'))
                                        order by fe.unit_no nulls last, fe.id) > 1
            then 'SAME_SUBMISSION' else fe.status end as status,
       fe.reviewed_by, fe.reviewed_by_name, fe.reviewed_at, fe.review_note, fe.applied, fe.received_at, fe.updated_at
  from public.field_events fe;
revoke all on app.kpi_field_events from public, anon, authenticated;

-- ---- the KPI task code of a Merchant Visit record (same as 20261122_02; repeated so this file stands alone) --------------
create or replace function app.kpi_mv_rule_code(p_activity text, p_answers jsonb, p_remarks text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_activity ilike '%POS Operational Support%' or p_activity ilike '%POS Request%' then
      case
        when coalesce(p_answers->>'Request Type', p_answers->>'request_type', p_remarks) ilike '%inspect%' then 'POS_OP_INSPECT'
        when coalesce(p_answers->>'Request Type', p_answers->>'request_type', p_remarks) ilike '%train%' then 'POS_OP_TRAIN'
        when coalesce(p_answers->>'Request Type', p_answers->>'request_type', p_remarks) ilike '%paper%' then 'POS_OP_PAPER'
        when coalesce(p_answers->>'Request Type', p_answers->>'request_type', p_remarks) ilike '%add%mat%' then 'POS_OP_ADD_MAT'
        when coalesce(p_answers->>'Request Type', p_answers->>'request_type', p_remarks) ilike '%return%mat%' then 'POS_OP_RET_MAT'
        when coalesce(p_answers->>'Request Type', p_answers->>'request_type', p_remarks) ilike '%other%' then 'POS_OP_OTHERS'
        else 'POS_MAINT'
      end
    when p_activity ilike '%SB Operational Support%' or p_activity ilike '%Sound Box Operational%' or p_activity ilike '%Sound Box Request%' then
      case
        when coalesce(p_answers->>'Request Type', p_answers->>'request_type', p_remarks) ilike '%inspect%' then 'SB_OP_INSPECT'
        when coalesce(p_answers->>'Request Type', p_answers->>'request_type', p_remarks) ilike '%train%' then 'SB_OP_TRAIN'
        when coalesce(p_answers->>'Request Type', p_answers->>'request_type', p_remarks) ilike '%battery%' then 'SB_OP_BATTERY'
        when coalesce(p_answers->>'Request Type', p_answers->>'request_type', p_remarks) ilike '%add%mat%' then 'SB_OP_ADD_MAT'
        when coalesce(p_answers->>'Request Type', p_answers->>'request_type', p_remarks) ilike '%return%mat%' then 'SB_OP_RET_MAT'
        when coalesce(p_answers->>'Request Type', p_answers->>'request_type', p_remarks) ilike '%other%' then 'SB_OP_OTHERS'
        else 'SB_MAINT'
      end
    when p_activity = 'POS Terminal Inspection' then 'POS_OP_INSPECT'
    when p_activity in ('POS Refreshment Training', 'Refreshment Training') then 'POS_OP_TRAIN'
    when p_activity = 'Request Paper Roll' then 'POS_OP_PAPER'
    when p_activity = 'Request Add Material' then 'POS_OP_ADD_MAT'
    when p_activity = 'Request Return Materials' then 'POS_OP_RET_MAT'
    when p_activity = 'SB Inspection' then 'SB_OP_INSPECT'
    when p_activity = 'SB Refresh Training' then 'SB_OP_TRAIN'
    when p_activity = 'Battery Replacement' and (p_answers->>'Sound Box Request' is not null or p_activity ilike '%SB%') then 'SB_OP_BATTERY'
    when p_activity = 'Add Material' and (p_answers->>'Sound Box Request' is not null or p_activity ilike '%SB%') then 'SB_OP_ADD_MAT'
    when p_activity = 'Returns Material' and (p_answers->>'Sound Box Request' is not null or p_activity ilike '%SB%') then 'SB_OP_RET_MAT'
    when p_activity in ('Declined – Cash Only (No QR)', 'Declined - Cash Only (No QR)') then 'MV_DECLINED_CASH_ONLY_NO_QR'
    else app.kpi_visit_code(p_activity, p_answers)
  end
$$;

-- ---- B1. every KPI point a staff member earned, with its time (the same counting as the KPI functions) ------------------
create or replace function app.kpi_event_points(p_from timestamptz, p_to timestamptz, p_staff text[])
returns table (staff_id text, ts timestamptz, pts numeric)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare m jsonb;
begin
  select coalesce(jsonb_object_agg(r.code, r.points), '{}'::jsonb) into m from public.kpi_point_rules r where r.active;
  return query
  select x.staff_id, x.ts, x.pts from (
    select trim(fe.staff_id) as staff_id, coalesce(fe.recorded_at, fe.received_at) as ts,
      (case when fe.status in ('APPROVED', 'PENDING') then
         case
           when coalesce(fe.device_type, 'POS Terminal') <> 'Sound Box' and fe.kind = 'INSTALL' then coalesce((m->>'POS_INSTALL')::numeric, 0)
           when coalesce(fe.device_type, 'POS Terminal') <> 'Sound Box' and fe.kind = 'REPLACE' then coalesce((m->>'POS_REPLACE')::numeric, 0)
           when coalesce(fe.device_type, 'POS Terminal') <> 'Sound Box' and fe.kind = 'BATTERY' then coalesce((m->>'POS_BATTERY')::numeric, 0)
           when fe.device_type = 'Sound Box' and fe.kind = 'INSTALL' then coalesce((m->>'SB_INSTALL')::numeric, 0)
           when fe.device_type = 'Sound Box' and fe.kind = 'REPLACE' then coalesce((m->>'SB_REPLACE')::numeric, 0)
           when fe.device_type = 'Sound Box' and fe.kind = 'SB_MAINT' then coalesce((m->>'SB_MAINT')::numeric, 0)
           when fe.device_type = 'Sound Box' and fe.kind = 'SB_RETURN' then coalesce((m->>'SB_RETURN')::numeric, 0)
           else 0 end
       else 0 end)
      + coalesce((m->>(
        case
          when fe.kind not in ('INSTALL', 'REPLACE', 'BATTERY', 'SB_RETURN')
           and fe.status in ('APPROVED', 'PENDING')
           and not (fe.kind = 'SB_MAINT' and coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type') is null)
          then
            case
              when fe.kind in ('POS_MAINT', 'MAINT') or (coalesce(fe.device_type, '') = 'POS Terminal' and fe.kind ilike '%maint%') then
                case
                  when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type', fe.remarks) ilike '%inspect%' then 'POS_OP_INSPECT'
                  when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type', fe.remarks) ilike '%train%' then 'POS_OP_TRAIN'
                  when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type', fe.remarks) ilike '%paper%' then 'POS_OP_PAPER'
                  when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type', fe.remarks) ilike '%add%mat%' then 'POS_OP_ADD_MAT'
                  when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type', fe.remarks) ilike '%return%mat%' then 'POS_OP_RET_MAT'
                  when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type') ilike '%other%' then 'POS_OP_OTHERS'
                  else 'POS_MAINT'
                end
              when fe.kind in ('SB_MAINT') or (fe.device_type = 'Sound Box' and fe.kind ilike '%maint%') then
                case
                  when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type', fe.remarks) ilike '%inspect%' then 'SB_OP_INSPECT'
                  when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type', fe.remarks) ilike '%train%' then 'SB_OP_TRAIN'
                  when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type', fe.remarks) ilike '%battery%' then 'SB_OP_BATTERY'
                  when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type', fe.remarks) ilike '%add%mat%' then 'SB_OP_ADD_MAT'
                  when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type', fe.remarks) ilike '%return%mat%' then 'SB_OP_RET_MAT'
                  when coalesce(fe.payload->>'request_type', fe.payload->'entry'->>'request_type', fe.payload->'unit'->>'request_type') ilike '%other%' then 'SB_OP_OTHERS'
                  else 'SB_MAINT'
                end
              else fe.kind
            end
        end))::numeric, 0) as pts
    from app.kpi_field_events fe
    where coalesce(fe.recorded_at, fe.received_at) >= p_from and coalesce(fe.recorded_at, fe.received_at) < p_to
      and trim(fe.staff_id) = any(p_staff)

    union all
    select trim(q.staff_id), q.submitted_at,
      (case when q.activity = 'NEW_INSTALLATION' then coalesce((m->>'KHQR_INSTALL')::numeric, 0) + coalesce((m->>'KHQR_PRINT_LAMINATE')::numeric, 0)
            when q.activity = 'QR_REPLACEMENT' then coalesce((m->>'KHQR_REPLACE')::numeric, 0) + coalesce((m->>'KHQR_PRINT_LAMINATE')::numeric, 0)
            else 0 end)
      + coalesce(q.qr_count, 0) * coalesce((m->>'KHQR_MATERIAL')::numeric, 0)
      + case when (q.activity = 'SUBMITTED' or q.status = 'FAILED_ATTEMPT') then coalesce((m->>'KHQR_ONBOARD_FAIL')::numeric, 0) else 0 end
    from app.qr_entries_all q
    where q.submitted_at >= p_from and q.submitted_at < p_to and trim(q.staff_id) = any(p_staff)

    union all
    select trim(c.staff_id), c.submitted_at,
      (case when c.review_status in ('CONFIRMED', 'PENDING') and c.request_type <> 'Add Supplementary Only' and c.card_status = 'Onboarded Successfully'
            then coalesce((m->>'CC_PRIMARY')::numeric, 0) else 0 end)
      + (case when c.review_status in ('CONFIRMED', 'PENDING') then coalesce(jsonb_array_length(c.supplementary), 0) * coalesce((m->>'CC_SUPP')::numeric, 0) else 0 end)
      + (case when (c.card_status = 'Onboarding Failed' or c.review_status = 'NO_REVIEW') then coalesce((m->>'CC_ONBOARD_FAIL')::numeric, 0) else 0 end)
    from public.cc_entries c
    where (c.review_status in ('CONFIRMED', 'PENDING') or c.card_status = 'Onboarding Failed' or c.review_status = 'NO_REVIEW')
      and c.submitted_at >= p_from and c.submitted_at < p_to and trim(c.staff_id) = any(p_staff)

    union all
    select trim(v.staff_id), v.submitted_at, coalesce((m->>k.code)::numeric, 0)
    from public.mv_visits v
    cross join lateral (select app.kpi_mv_rule_code(v.activity, v.answers, v.remarks) as code) k
    where v.submitted_at >= p_from and v.submitted_at < p_to and trim(v.staff_id) = any(p_staff)
      and v.activity not in ('Booth Event', 'Standby VIP Merchant')                 -- the booth / standby points themselves
  ) x
  where x.pts <> 0;
end $$;
revoke all on function app.kpi_event_points(timestamptz, timestamptz, text[]) from public, anon, authenticated;

-- ---- B2. the Booth / Standby difference per staff per day ----------------------------------------------------------------
create or replace function app.kpi_event_adjust(p_from date, p_to date)
returns table (d date, staff_id text, adj numeric)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare s public.kpi_event_settings; m jsonb; v_staff text[];
begin
  select * into s from public.kpi_event_settings where id = 1;
  if not found then s.booth_mode := 'shared'; s.standby_mode := 'higher'; s.half_day_weight := 0.5; end if;
  if s.booth_mode = 'fixed' and s.standby_mode = 'fixed' then return; end if;
  select coalesce(jsonb_object_agg(r.code, r.points), '{}'::jsonb) into m from public.kpi_point_rules r where r.active;

  drop table if exists pg_temp._ke_rec;
  create temp table _ke_rec on commit drop as
  with rec as (
    select v.id, (v.submitted_at at time zone 'Asia/Phnom_Penh')::date as d, trim(v.staff_id) as staff_id,
           case when v.activity = 'Booth Event' then 'B' else 'S' end as typ,
           app.kpi_visit_code(v.activity, v.answers) as code,
           upper(btrim(coalesce(v.answers->>'Booth Tag', ''))) as tag,
           regexp_match(coalesce(v.answers->>'Booth Hours', v.answers->>'VIP Hours', ''), '(\d{1,2})[:.](\d{2})\D+(\d{1,2})[:.](\d{2})') as hm,
           (v.submitted_at at time zone 'Asia/Phnom_Penh') as local_ts
      from public.mv_visits v
     where v.activity in ('Booth Event', 'Standby VIP Merchant') and coalesce(trim(v.staff_id), '') <> ''
       and v.submitted_at >= (p_from::timestamp at time zone 'Asia/Phnom_Penh')
       and v.submitted_at < ((p_to + 1)::timestamp at time zone 'Asia/Phnom_Penh')
  ), r2 as (
    select r.*, r.code like '%\_HALF\_DAY' as half, (m->>r.code)::numeric as dflt,
           case when r.hm is not null and r.hm[1]::int < 24 and r.hm[3]::int <= 24 and r.hm[2]::int < 60 and r.hm[4]::int < 60
                     and (r.hm[3]::int * 60 + r.hm[4]::int) > (r.hm[1]::int * 60 + r.hm[2]::int)
                then r.hm[1]::int * 60 + r.hm[2]::int end as h_from,
           case when r.hm is not null and r.hm[1]::int < 24 and r.hm[3]::int <= 24 and r.hm[2]::int < 60 and r.hm[4]::int < 60
                     and (r.hm[3]::int * 60 + r.hm[4]::int) > (r.hm[1]::int * 60 + r.hm[2]::int)
                then r.hm[3]::int * 60 + r.hm[4]::int end as h_to
      from rec r
  ), r3 as (
    -- the window: full day = the whole day; half day = its hours, else the half it was sent in
    select r.*,
           ((r.d::timestamp + make_interval(mins => case when not r.half then 0 when r.h_from is not null then r.h_from
                                                         when r.local_ts::time < time '12:00' then 0 else 720 end))
             at time zone 'Asia/Phnom_Penh') as ws,
           ((r.d::timestamp + make_interval(mins => case when not r.half then 1440 when r.h_to is not null then r.h_to
                                                         when r.local_ts::time < time '12:00' then 720 else 1440 end))
             at time zone 'Asia/Phnom_Penh') as we
      from r2 r
     where r.dflt is not null                                                         -- the KPI task exists and is Active
       and ((r.typ = 'B' and s.booth_mode <> 'fixed') or (r.typ = 'S' and s.standby_mode <> 'fixed'))
  ), r4 as (
    -- one record per staff, day and window; a booth that day replaces a standby; a full day replaces half days
    select distinct on (r.staff_id, r.d, r.typ, r.ws, r.we) r.*
      from r3 r
     where not (r.typ = 'S' and exists (select 1 from r3 b where b.typ = 'B' and b.staff_id = r.staff_id and b.d = r.d))
       and not (r.half and exists (select 1 from r3 f where not f.half and f.typ = r.typ and f.staff_id = r.staff_id and f.d = r.d))
     order by r.staff_id, r.d, r.typ, r.ws, r.we, r.id desc
  )
  select * from r4;

  select coalesce(array_agg(distinct k.staff_id), '{}') into v_staff from _ke_rec k;
  if cardinality(v_staff) = 0 then return; end if;

  return query
  with ev as materialized (
    select * from app.kpi_event_points((p_from::timestamp at time zone 'Asia/Phnom_Penh'), ((p_to + 1)::timestamp at time zone 'Asia/Phnom_Penh'), v_staff)
  ), own as (
    select k.id, coalesce((select sum(e.pts) from ev e where e.staff_id = k.staff_id and e.ts >= k.ws and e.ts < k.we), 0) as own_in
      from _ke_rec k
  ), shared as (
    select k.id,
      case
        when k.typ = 'B' and s.booth_mode = 'shared' and k.tag <> '' and not k.half then
          (select sum(o2.own_in) / nullif(sum(case when k2.half then s.half_day_weight else 1 end), 0)
             from _ke_rec k2 join own o2 on o2.id = k2.id
            where k2.typ = 'B' and k2.d = k.d and k2.tag = k.tag)
        when k.typ = 'B' and s.booth_mode = 'shared' and k.tag <> '' and k.half then
          (select coalesce(sum((select coalesce(sum(e.pts), 0) from ev e where e.staff_id = k2.staff_id
                                 and e.ts >= greatest(k.ws, k2.ws) and e.ts < least(k.we, k2.we))), 0) / nullif(count(*), 0)
             from _ke_rec k2
            where k2.typ = 'B' and k2.d = k.d and k2.tag = k.tag and k2.ws < k.we and k2.we > k.ws)
        else null
      end as share
      from _ke_rec k
  )
  select k.d, k.staff_id, round(sum(greatest(k.dflt, coalesce(sh.share, o.own_in)) - k.dflt - o.own_in), 2) as adj
    from _ke_rec k join own o on o.id = k.id join shared sh on sh.id = k.id
   group by k.d, k.staff_id
  having round(sum(greatest(k.dflt, coalesce(sh.share, o.own_in)) - k.dflt - o.own_in), 2) <> 0;
end $$;
revoke all on function app.kpi_event_adjust(date, date) from public, anon, authenticated;

-- ---- B3. the KPI functions read the view and add adj_pts (patched in place; skipped when already done) ------------------
do $patch$
declare d text; n int;
begin
  -- the network / monthly-staff summary
  d := pg_get_functiondef('app.kpi_dashboard_summary_compute(date,date)'::regprocedure);
  if position('adj_pts' in d) = 0 then
    n := (length(d) - length(replace(d, 'from public.field_events fe', ''))) / length('from public.field_events fe');
    if n <> 1 then raise exception 'compute: field_events found % times', n; end if;
    d := replace(d, 'from public.field_events fe', 'from app.kpi_field_events fe');
    n := (length(d) - length(replace(d, E'ev_5m as materialized (\n    select * from ev where d >= v_from5m\n  ),', ''))) / length(E'ev_5m as materialized (\n    select * from ev where d >= v_from5m\n  ),');
    if n <> 1 then raise exception 'compute: ev_5m found % times', n; end if;
    d := replace(d, E'ev_5m as materialized (\n    select * from ev where d >= v_from5m\n  ),', E'ev_5m as materialized (\n    select * from ev where d >= v_from5m\n  ),
  -- (22 Nov 2026) Booth Event / Standby VIP: the difference per staff per day (app.kpi_event_adjust)
  adj as materialized (
    select a.d, a.staff_id, a.adj from app.kpi_event_adjust((v_from24_ts at time zone ''Asia/Phnom_Penh'')::date, v_today) a
  ),
  aj_daily as (select a.d::text as p, sum(a.adj) as v from adj a group by 1),
  aj_weekly as (select date_trunc(''week'', a.d::timestamp)::date::text as p, sum(a.adj) as v from adj a group by 1),
  aj_monthly as (select to_char(a.d, ''YYYY-MM'') as p, sum(a.adj) as v from adj a group by 1),
  aj_quarterly as (select to_char(date_trunc(''quarter'', a.d::timestamp)::date, ''YYYY-"Q"Q'') as p, sum(a.adj) as v from adj a group by 1),
  aj_ms as (select to_char(a.d, ''YYYY-MM'') as m, a.staff_id, sum(a.adj) as v from adj a
             where a.d >= v_from5m and (not v_wk or extract(isodow from a.d) not in (6, 7)) and (not v_hol or not (a.d = any(v_hol_dates)))
             group by 1, 2),');
    n := (length(d) - length(replace(d, $q$jsonb_build_object('extra', coalesce(ex.extra, '{}'::jsonb))$q$, ''))) / length($q$jsonb_build_object('extra', coalesce(ex.extra, '{}'::jsonb))$q$);
    if n <> 5 then raise exception 'compute: extra object found % times', n; end if;
    d := replace(d, $q$jsonb_build_object('extra', coalesce(ex.extra, '{}'::jsonb))$q$, $q$jsonb_build_object('extra', coalesce(ex.extra, '{}'::jsonb), 'adj_pts', coalesce(aj.v, 0))$q$);
    if position('from daily_base a left join daily_extra ex on ex.p = a.period)' in d) = 0
       or position('from weekly_base a left join weekly_extra ex on ex.p = a.period)' in d) = 0
       or position('from monthly_base a left join monthly_extra ex on ex.p = a.period)' in d) = 0
       or position('from quarterly_base a left join quarterly_extra ex on ex.p = a.period)' in d) = 0
       or position('from ms_base a left join ms_extra ex on ex.m = a.month and ex.staff_id = a.staff_id)' in d) = 0 then
      raise exception 'compute: a period join was not found';
    end if;
    d := replace(d, 'from daily_base a left join daily_extra ex on ex.p = a.period)', 'from daily_base a left join daily_extra ex on ex.p = a.period left join aj_daily aj on aj.p = a.period)');
    d := replace(d, 'from weekly_base a left join weekly_extra ex on ex.p = a.period)', 'from weekly_base a left join weekly_extra ex on ex.p = a.period left join aj_weekly aj on aj.p = a.period)');
    d := replace(d, 'from monthly_base a left join monthly_extra ex on ex.p = a.period)', 'from monthly_base a left join monthly_extra ex on ex.p = a.period left join aj_monthly aj on aj.p = a.period)');
    d := replace(d, 'from quarterly_base a left join quarterly_extra ex on ex.p = a.period)', 'from quarterly_base a left join quarterly_extra ex on ex.p = a.period left join aj_quarterly aj on aj.p = a.period)');
    d := replace(d, 'from ms_base a left join ms_extra ex on ex.m = a.month and ex.staff_id = a.staff_id)', 'from ms_base a left join ms_extra ex on ex.m = a.month and ex.staff_id = a.staff_id left join aj_ms aj on aj.m = a.month and aj.staff_id = a.staff_id)');
    execute d;
  end if;

  -- the staff totals for a period
  d := pg_get_functiondef('app.kpi_dashboard_staff_only(date,date)'::regprocedure);
  if position('adj_pts' in d) = 0 then
    n := (length(d) - length(replace(d, 'from public.field_events fe', ''))) / length('from public.field_events fe');
    if n <> 1 then raise exception 'staff_only: field_events found % times', n; end if;
    d := replace(d, 'from public.field_events fe', 'from app.kpi_field_events fe');
    if position($q$(to_jsonb(g) || jsonb_build_object('extra', coalesce(ex.extra, '{}'::jsonb)))$q$ in d) = 0
       or position('left join extra_agg ex on ex.staff_id = g.staff_id;' in d) = 0 then
      raise exception 'staff_only: the final select was not found';
    end if;
    d := replace(d, $q$(to_jsonb(g) || jsonb_build_object('extra', coalesce(ex.extra, '{}'::jsonb)))$q$,
                    $q$(to_jsonb(g) || jsonb_build_object('extra', coalesce(ex.extra, '{}'::jsonb), 'adj_pts', coalesce(aj.v, 0)))$q$);
    d := replace(d, 'left join extra_agg ex on ex.staff_id = g.staff_id;', $q$left join extra_agg ex on ex.staff_id = g.staff_id
    left join (select a.staff_id, sum(a.adj) as v
                 from app.kpi_event_adjust(coalesce(p_since, date '2024-01-01'), coalesce(p_until, v_today)) a
                where (not v_exclude_weekend or extract(isodow from a.d) not in (6, 7))
                  and (not v_exclude_holiday or not (a.d = any(v_hol_dates)))
                group by 1) aj on aj.staff_id = g.staff_id;$q$);
    execute d;
  end if;
end $patch$;

delete from app.kpi_summary_cache;                                         -- every KPI figure is worked out again
notify pgrst, 'reload schema';

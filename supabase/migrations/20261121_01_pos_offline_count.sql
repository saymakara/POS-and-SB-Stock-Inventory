-- ============================================================================================================================
-- 21 Nov 2026 - POS Offline Count on the POS Terminal review page (Phone App Review > POS Terminal).
--
-- Until now the phone app sent POS Offline Count (POC-) entries to Merchant Visits only (no stock moves), so they never
-- appeared on the POS Terminal page with the other POS tasks. This file adds a 7th POS record type, POS_OFFLINE:
--   * the phone app (Merchant Visit 4.10.2) sends each POS of an Offline Count entry here, like Operational Support;
--   * NO APPROVAL NEEDED (owner, 21 Nov 2026): an Offline Count is a record only - it is saved as Approved the moment it
--     arrives ("Recorded automatically - no approval needed"), never waits in Waiting, and moves NO stock;
--   * an edit in the phone app replaces its line (the earlier one becomes Superseded); a deletion in the phone app takes it
--     off the page (Cancelled) - as for the other types;
--   * no serial number (the form asks Terminal Name, MID, TID only), so the serial checks are skipped; a note shows when
--     the TID is not on an installed POS terminal in the inventory, or its MID differs (for information only). Checked
--     21 Nov: the 23 existing Offline Count terminals are not in the inventory yet (older terminals);
--   * KPI: unchanged (no KPI rule uses Offline Count; the KPI does not read this new type);
--   * the 23 Offline Count entries already in Merchant Visits are copied here, as Approved (they also stay in Merchant
--     Visits - nothing is deleted).
-- Also (section 5): the label behind the POS Terminal page's "Integrated installation" filter.
-- Safe to run twice. Run it BEFORE installing Merchant Visit 4.10.2 (otherwise new Offline Count entries wait in the app's
-- send queue until this is run - nothing is lost).
-- ============================================================================================================================

-- 1. The new record type is allowed ---------------------------------------------------------------------------------------
alter table public.field_events drop constraint if exists field_events_kind_check;
alter table public.field_events add constraint field_events_kind_check
  check (kind = any (array['INSTALL', 'REPLACE', 'BATTERY', 'SB_MAINT', 'SB_RETURN', 'POS_MAINT', 'POS_INACTIVE', 'POS_RETURN', 'POS_OFFLINE']));

-- 2. The review checks of an Offline Count (no serial): TID on an installed POS? MID the same? ----------------------------
create or replace function app.field_offline_issues(p_mid text, p_tid text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb := '[]'::jsonb; d public.devices;
begin
  if coalesce(p_tid, '') = '' and coalesce(p_mid, '') = '' then
    return jsonb_build_array(jsonb_build_object('code', 'NO_TERMINAL', 'level', 'warn', 'text', 'No MID or TID was recorded.'));
  end if;
  if coalesce(p_tid, '') <> '' then
    select * into d from public.devices where tid = p_tid and type = 'POS Terminal' and stage = 'COMPLETE'
     order by (coalesce(mid, '') = coalesce(p_mid, '')) desc limit 1;
    if not found then
      v := v || jsonb_build_object('code', 'TID_UNKNOWN', 'level', 'warn', 'text', 'TID ' || p_tid || ' is not on an installed POS terminal in the inventory (for information - nothing to do).');
    elsif coalesce(p_mid, '') <> '' and coalesce(d.mid, '') <> '' and d.mid <> p_mid then
      v := v || jsonb_build_object('code', 'MID_MISMATCH', 'level', 'warn', 'text', 'The inventory has MID ' || d.mid || ' for TID ' || p_tid || ', not ' || p_mid || '.');
    end if;
  end if;
  return v;
end $$;
revoke all on function app.field_offline_issues(text, text) from public, anon, authenticated;

-- 3. The three live functions learn the new type (each changed in place, only the lines below; skipped when already done)
do $mig$
declare d text; n text;
begin
  -- 3a. field_sync_record (the phone app sends records): POS_OFFLINE is a known type
  d := pg_get_functiondef('public.field_sync_record(jsonb)'::regprocedure);
  if position('POS_OFFLINE' in d) = 0 then
    n := replace(d, $a$'POS_INACTIVE', 'POS_RETURN') then raise exception 'Unknown kind$a$,
                    $a$'POS_INACTIVE', 'POS_RETURN', 'POS_OFFLINE') then raise exception 'Unknown kind$a$);
    if n = d then raise exception 'field_sync_record: the kind list was not found - not changed'; end if;
    execute n;
  end if;

  -- 3b. app.field_issues (review checks): an Offline Count uses its own checks (no serial)
  d := pg_get_functiondef('app.field_issues(text, text, text, text, text, text, character varying, text)'::regprocedure);
  if position('POS_OFFLINE' in d) = 0 then
    n := replace(d, E'begin\n  if p_serial is null then',
                    E'begin\n  if p_kind = ''POS_OFFLINE'' then return app.field_offline_issues(p_mid, p_tid); end if;   -- (21 Nov 2026) no serial\n  if p_serial is null then');
    if n = d then raise exception 'field_issues: the start of the checks was not found - not changed'; end if;
    execute n;
  end if;

  -- 3c. field_approve: approving an Offline Count moves no stock; a line in the terminal's history (found by TID)
  d := pg_get_functiondef('public.field_approve(bigint, text, jsonb)'::regprocedure);
  if position('POS_OFFLINE' in d) = 0 then
    n := replace(d, E'  elsif e.kind = ''POS_RETURN'' then',
E'  elsif e.kind = ''POS_OFFLINE'' then                                      -- (21 Nov 2026) no stock move
    select * into d from public.devices where coalesce(e.tid, '''') <> '''' and tid = e.tid and type = ''POS Terminal'' and stage = ''COMPLETE''
     order by (coalesce(mid, '''') = coalesce(e.mid, '''')) desc limit 1 for update;
    if found then
      update public.devices set
        history = jsonb_build_array(app.stamp() || '' | POS Offline Count | '' || coalesce(v_merchant, ''Merchant'') || '' · MID '' || coalesce(e.mid, ''—'')
                  || '' · TID '' || coalesce(e.tid, ''—'') || coalesce('' · '' || nullif(e.remarks, ''''), '''') || '' · '' || v_rid || '' by '' || v_who)
                  || coalesce(history, ''[]''::jsonb)
      where serial = d.serial;
      v_applied := jsonb_build_object(''serial'', d.serial, ''offline_count'', v_day);
    else
      v_applied := jsonb_build_object(''offline_count'', v_day);
    end if;

  elsif e.kind = ''POS_RETURN'' then');
    if n = d then raise exception 'field_approve: the Return & Terminate step was not found - not changed'; end if;
    execute n;
  end if;
end $mig$;

-- 3d. A deletion in the phone app (or a POS removed from the entry) also takes an automatic Offline Count off the page
do $mig2$
declare d text; n text;
begin
  d := pg_get_functiondef('public.field_sync_record(jsonb)'::regprocedure);
  if position('reviewed_by is null' in d) = 0 then
    n := replace(d, $a$where source_record_id = v_rec and status = 'PENDING';$a$,
      $a$where source_record_id = v_rec and (status = 'PENDING' or (kind = 'POS_OFFLINE' and status = 'APPROVED' and reviewed_by is null));$a$);
    n := replace(n, $a$where source_record_id = v_rec and status = 'PENDING' and not (unit_no = any(v_units));$a$,
      $a$where source_record_id = v_rec and (status = 'PENDING' or (kind = 'POS_OFFLINE' and status = 'APPROVED' and reviewed_by is null)) and not (unit_no = any(v_units));$a$);
    if (length(n) - length(replace(n, 'reviewed_by is null', ''))) / length('reviewed_by is null') <> 2 then   -- both found
      raise exception 'field_sync_record: the two "cancel" steps were not found as expected - not changed';
    end if;
    execute n;
  end if;
end $mig2$;

-- 3e. No approval needed: an Offline Count is saved as Approved the moment it arrives (no stock move). An automatic approval
--     has no reviewer (reviewed_by is null); an admin's approval always has one.
create or replace function app.field_offline_auto() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'POS_OFFLINE' and new.status = 'PENDING' then
    new.status := 'APPROVED';
    new.reviewed_by := null; new.reviewed_by_name := null; new.reviewed_at := now();
    new.review_note := 'Recorded automatically - no approval needed';
    new.applied := jsonb_build_object('offline_count', to_char(new.recorded_at at time zone 'Asia/Phnom_Penh', 'YYYY-MM-DD'));
    new.issues := (select coalesce(jsonb_agg(i), '[]'::jsonb) from jsonb_array_elements(coalesce(new.issues, '[]'::jsonb)) i
                    where i->>'code' <> 'EDITED_AFTER_REVIEW');      -- (an edit from the phone app is normal here)
  end if;
  return new;
end $$;
revoke all on function app.field_offline_auto() from public, anon, authenticated;
create or replace function app.field_offline_superseded() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'POS_OFFLINE' then                                   -- an edit from the phone app: the earlier line is replaced
    update public.field_events set status = 'SUPERSEDED', updated_at = now()
     where source_record_id = new.source_record_id and unit_no = new.unit_no and revision < new.revision
       and (status = 'PENDING' or (status = 'APPROVED' and reviewed_by is null));
  end if;
  return null;
end $$;
revoke all on function app.field_offline_superseded() from public, anon, authenticated;
drop trigger if exists field_offline_auto on public.field_events;       -- (runs after block_deleted_record: triggers go by name)
create trigger field_offline_auto before insert on public.field_events for each row execute function app.field_offline_auto();
drop trigger if exists field_offline_superseded on public.field_events;
create trigger field_offline_superseded after insert on public.field_events for each row execute function app.field_offline_superseded();
-- (an Offline Count still waiting from before this file - none expected - is approved now)
update public.field_events set status = 'APPROVED', reviewed_at = now(), review_note = 'Recorded automatically - no approval needed',
       applied = jsonb_build_object('offline_count', to_char(recorded_at at time zone 'Asia/Phnom_Penh', 'YYYY-MM-DD'))
 where kind = 'POS_OFFLINE' and status = 'PENDING';

-- 4. The Offline Count entries already in Merchant Visits: copied here (saved as Approved - 3e; one line per POS) --------
with v as (
  select * from public.mv_visits m
   where m.activity = 'POS Offline Count'
     and not exists (select 1 from public.field_events f where f.source_record_id = m.record_id)
), a as (                                                     -- answers: "MID" / "TID" / "Terminal Name", or "POS 2 · MID" …
  select v.record_id, coalesce((substring(k from '^POS (\d+) · '))::int, 1) as unit_no, regexp_replace(k, '^POS \d+ · ', '') as fld, val
    from v, jsonb_each_text(coalesce(v.answers, '{}'::jsonb)) as x(k, val)
), u as (
  select record_id, unit_no,
         nullif(trim(max(val) filter (where fld = 'MID')), '') as mid,
         nullif(trim(max(val) filter (where fld = 'TID')), '') as tid,
         nullif(trim(max(val) filter (where fld = 'Terminal Name')), '') as terminal_name
    from a group by record_id, unit_no
), units as (                                                 -- an entry without answers still gets its line (from the entry)
  select v.*, coalesce(u.unit_no, 1) as unit_no, coalesce(u.mid, nullif(v.mid, '')) as u_mid, u.tid as u_tid,
         coalesce(u.terminal_name, nullif(v.merchant_name, '')) as u_terminal
    from v left join u on u.record_id = v.record_id
)
insert into public.field_events (source_record_id, unit_no, revision, kind, device_type, serial, mid, tid, terminal_name, outlet_name,
  branch_text, branch_id, staff_id, staff_name, recorded_at, latitude, longitude, remarks, payload, payload_hash, issues)
select x.record_id, x.unit_no, 1, 'POS_OFFLINE', 'POS Terminal', '', x.u_mid, x.u_tid, x.u_terminal, nullif(x.merchant_name, ''),
       x.branch_text, x.branch_id, x.staff_id, x.staff_name, x.submitted_at, x.latitude, x.longitude, nullif(x.remarks, ''),
       jsonb_build_object('entry', jsonb_build_object('record_id', x.record_id, 'summary', 'POS Offline Count', 'copied_from', 'Merchant Visits'),
                          'unit', jsonb_build_object('unit_no', x.unit_no, 'mid', x.u_mid, 'tid', x.u_tid, 'terminal_name', x.u_terminal)),
       'copied:' || md5(x.record_id || ':' || x.unit_no), app.field_issues('POS_OFFLINE', 'POS Terminal', null, null, x.u_mid, x.u_tid, x.branch_id, x.record_id)
  from units x
on conflict do nothing;

-- 5. Integrated Installation filter (POS Terminal page): which Installations were "Integrated Installation" ------------------
--    New entries carry it (Merchant Visit 4.10.2 sends request_type with every installation / replacement). The ones sent
--    before are tagged ONCE by the app (its nightly check, or Sheet menu "check & resend missing entries"): it lists their
--    Record IDs and this function writes the label into those Installation lines only. Nothing else changes (status, stock,
--    the record's check value) - a label for the filter. Only the phone app's server key may call it.
create or replace function public.field_tag_request_type(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_type text := left(btrim(coalesce(p->>'request_type', '')), 60); v_ids text[]; n int;
begin
  if v_type = '' then raise exception 'request_type is required' using errcode = '22023'; end if;
  select coalesce(array_agg(left(btrim(x), 60)), '{}') into v_ids from jsonb_array_elements_text(coalesce(p->'ids', '[]'::jsonb)) x
   where btrim(x) <> '';
  if cardinality(v_ids) > 2000 then raise exception 'at most 2000 Record IDs at a time' using errcode = '22023'; end if;
  update public.field_events
     set payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{entry}', coalesce(payload->'entry', '{}'::jsonb) || jsonb_build_object('request_type', v_type))
   where source_record_id = any(v_ids) and kind = 'INSTALL'
     and coalesce(payload->'entry'->>'request_type', '') = '';
  get diagnostics n = row_count;
  return jsonb_build_object('tagged', n);
end $$;
revoke all on function public.field_tag_request_type(jsonb) from public, anon, authenticated;
grant execute on function public.field_tag_request_type(jsonb) to service_role;

notify pgrst, 'reload schema';

-- Self-test of the permanent delete (migration 20261104_07). SAFE TO RUN in the SQL Editor: everything is undone at the
-- end (it finishes with a deliberate error "TESTRESULT ..." which rolls back the sample records and the deletes).
-- It acts as the active Super Admin, adds one sample record of each kind, deletes them, then sends them again.
-- Expected: deleted 1/1/1/1, approved_refused = 1, tombstones = 4, resend_blocked all true, known = 4 IDs,
--           admin_refused = true, audit_rows = 4.
do $t$
declare
  v_sa uuid := (select user_id from public.staff_profiles where role = 'SUPER_ADMIN' and active and not must_change_password limit 1);
  v_ad uuid := (select user_id from public.staff_profiles where role = 'ADMIN' and active and not must_change_password limit 1);
  f1 bigint; f2 bigint; q1 bigint; c1 bigint; m1 bigint;
  r_field jsonb; r_khqr jsonb; r_cc jsonb; r_visit jsonb; admin_refused boolean := false;
  audit_before int := (select count(*) from public.audit_logs where action = 'PHONE_RECORD_DELETE');
begin
  insert into public.field_events (source_record_id, unit_no, revision, kind, device_type, serial, staff_id, staff_name, recorded_at, status, payload, issues)
  values ('POS-SELFTEST-0001', 1, 1, 'INSTALL', 'POS Terminal', 'WPSELFTEST1', 'STF1', 'Tester', now(), 'REJECTED', '{}', '[]') returning id into f1;
  insert into public.field_events (source_record_id, unit_no, revision, kind, device_type, serial, staff_id, staff_name, recorded_at, status, payload, issues)
  values ('POS-SELFTEST-0002', 1, 1, 'INSTALL', 'POS Terminal', 'WPSELFTEST2', 'STF1', 'Tester', now(), 'APPROVED', '{}', '[]') returning id into f2;
  insert into public.qr_installations (request_id, session_id, activity, staff_id, staff_name, merchant_name, mid, qr_expected, qr_count, record_id)
  values ('SELFTEST-REQ-1', 'SELFTEST-S1', 'NEW_INSTALLATION', 'STF1', 'Tester', 'Test Shop', '123456789012345', 1, 1, 'QR-SELFTEST-000001') returning id into q1;
  insert into public.cc_entries (record_id, request_type, staff_id, staff_name, submitted_at, review_status)
  values ('CC-SELFTEST-0001', 'New Credit Card Request', 'STF1', 'Tester', now(), 'PENDING') returning id into c1;
  insert into public.mv_visits (record_id, activity, staff_id, staff_name, submitted_at) values ('REG-20261104-9991', 'KHQR Issue', 'STF1', 'Tester', now()) returning id into m1;

  -- an Admin (not Super Admin) is refused
  if v_ad is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_ad, 'role', 'authenticated')::text, true);
    begin perform public.admin_delete_phone_records(jsonb_build_object('source', 'VISIT', 'ids', jsonb_build_array(m1)));
    exception when others then admin_refused := sqlerrm like 'Only a Super Admin%'; end;
  end if;
  -- the Super Admin deletes
  perform set_config('request.jwt.claims', json_build_object('sub', v_sa, 'role', 'authenticated')::text, true);
  r_field := public.admin_delete_phone_records(jsonb_build_object('source', 'FIELD', 'ids', jsonb_build_array(f1, f2), 'reason', 'self-test'));
  r_khqr  := public.admin_delete_phone_records(jsonb_build_object('source', 'KHQR', 'ids', jsonb_build_array(q1)));
  r_cc    := public.admin_delete_phone_records(jsonb_build_object('source', 'CC', 'ids', jsonb_build_array(c1)));
  r_visit := public.admin_delete_phone_records(jsonb_build_object('source', 'VISIT', 'ids', jsonb_build_array(m1)));

  -- the app sends them again: nothing comes back
  perform public.field_sync_record(jsonb_build_object('record_id', 'POS-SELFTEST-0001', 'kind', 'INSTALL', 'device_type', 'POS Terminal',
    'staff_id', 'STF1', 'units', jsonb_build_array(jsonb_build_object('unit_no', 1, 'serial', 'WPSELFTEST1'))));
  insert into public.qr_installations (request_id, session_id, activity, staff_id, merchant_name, mid, qr_expected, qr_count)
  values ('SELFTEST-REQ-1', 'SELFTEST-S1', 'NEW_INSTALLATION', 'STF1', 'Test Shop', '123456789012345', 1, 1);
  insert into public.cc_entries (record_id, request_type, staff_id, submitted_at, review_status) values ('CC-SELFTEST-0001', 'New Credit Card Request', 'STF1', now(), 'PENDING');
  perform public.mv_visit_sync(jsonb_build_object('record_id', 'REG-20261104-9991', 'activity', 'KHQR Issue', 'staff_id', 'STF1'));

  raise exception 'TESTRESULT %', jsonb_build_object(
    'deleted', jsonb_build_array(r_field->'deleted', r_khqr->'deleted', r_cc->'deleted', r_visit->'deleted'),
    'approved_refused', jsonb_array_length(r_field->'refused'),
    'approved_still_there', exists (select 1 from public.field_events where id = f2),
    'tombstones', (select count(*) from public.deleted_phone_records where record_id in ('POS-SELFTEST-0001', 'QR-SELFTEST-000001', 'CC-SELFTEST-0001', 'REG-20261104-9991')),
    'resend_blocked', jsonb_build_object(
       'pos', not exists (select 1 from public.field_events where source_record_id = 'POS-SELFTEST-0001'),
       'khqr', not exists (select 1 from public.qr_installations where request_id = 'SELFTEST-REQ-1'),
       'cc', not exists (select 1 from public.cc_entries where record_id = 'CC-SELFTEST-0001'),
       'visit', not exists (select 1 from public.mv_visits where record_id = 'REG-20261104-9991')),
    'known', public.field_known_records('{"ids":["POS-SELFTEST-0001","CC-SELFTEST-0001","REG-20261104-9991","QR-SELFTEST-000001","NOPE-20261104-0001"]}')->'known',
    'admin_refused', admin_refused,
    'audit_rows', (select count(*) from public.audit_logs where action = 'PHONE_RECORD_DELETE') - audit_before);
end $t$;

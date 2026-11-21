-- Self-test of daily resetting KHQR Installation IDs (migration 20261121_01_khqr_daily_reset_id).
-- SAFE TO RUN in SQL Editor: finishes with a deliberate exception so every inserted test row and counter rolls back.
do $t$
declare
  r1 jsonb;
  r2 jsonb;
  r2_dup jsonb;
  r3 jsonb;
  r4 jsonb;
  r_midnight jsonb;
  seq_d1 bigint;
begin
  -- Day 1 (2099-01-02 Phnom Penh)
  r1 := public.qr_submit(jsonb_build_object(
    'request_id', 'SELFTEST-QR-DAY-1A',
    'session_id', 'SELFTEST-S-1A',
    'activity', 'NEW_INSTALLATION',
    'staff_id', 'STF1',
    'staff_name', 'Tester',
    'merchant_name', 'Shop Day 1 A',
    'mid', '200000000000001',
    'qr_expected', 1,
    'qr_count', 1,
    'captured_at', '2099-01-02T09:00:00+07:00'
  ));

  r2 := public.qr_submit(jsonb_build_object(
    'request_id', 'SELFTEST-QR-DAY-1B',
    'session_id', 'SELFTEST-S-1B',
    'activity', 'NEW_INSTALLATION',
    'staff_id', 'STF1',
    'staff_name', 'Tester',
    'merchant_name', 'Shop Day 1 B',
    'mid', '200000000000002',
    'qr_expected', 1,
    'qr_count', 1,
    'captured_at', '2099-01-02T14:30:00+07:00'
  ));

  -- Duplicate retry of r2: must return same record_id without advancing the counter
  r2_dup := public.qr_submit(jsonb_build_object(
    'request_id', 'SELFTEST-QR-DAY-1B',
    'session_id', 'SELFTEST-S-1B',
    'activity', 'NEW_INSTALLATION',
    'staff_id', 'STF1',
    'merchant_name', 'Shop Day 1 B',
    'mid', '200000000000002',
    'qr_expected', 1,
    'qr_count', 1,
    'captured_at', '2099-01-02T14:30:00+07:00'
  ));

  select last_no into seq_d1 from app.qr_daily_seq where day = date '2099-01-02';

  -- Day 2 before Phnom Penh midnight (2099-01-03 23:59:59+07 = 2099-01-03T16:59:59Z) -> resets to 000001
  r3 := public.qr_submit(jsonb_build_object(
    'request_id', 'SELFTEST-QR-DAY-2A',
    'session_id', 'SELFTEST-S-2A',
    'activity', 'QR_REPLACEMENT',
    'staff_id', 'STF1',
    'merchant_name', 'Shop Day 2 A',
    'mid', '200000000000003',
    'qr_expected', 1,
    'qr_count', 1,
    'captured_at', '2099-01-03T16:59:59Z'
  ));

  -- Crossing Phnom Penh midnight (2099-01-03T17:00:00Z = 2099-01-04 00:00:00+07) -> resets to 000001 on 20990104
  r_midnight := public.qr_submit(jsonb_build_object(
    'request_id', 'SELFTEST-QR-DAY-3A',
    'session_id', 'SELFTEST-S-3A',
    'activity', 'NEW_INSTALLATION',
    'staff_id', 'STF1',
    'merchant_name', 'Shop Day 3 Midnight',
    'mid', '200000000000004',
    'qr_expected', 1,
    'qr_count', 1,
    'captured_at', '2099-01-03T17:00:00Z'
  ));

  -- Day 2 second submission still gets 000002 cleanly
  r4 := public.qr_submit(jsonb_build_object(
    'request_id', 'SELFTEST-QR-DAY-2B',
    'session_id', 'SELFTEST-S-2B',
    'activity', 'NEW_INSTALLATION',
    'staff_id', 'STF1',
    'merchant_name', 'Shop Day 2 B',
    'mid', '200000000000005',
    'qr_expected', 1,
    'qr_count', 1,
    'captured_at', '2099-01-03T10:00:00+07:00'
  ));

  raise exception 'TESTRESULT %', jsonb_build_object(
    'd1_first', r1->>'record_id',
    'd1_second', r2->>'record_id',
    'd1_dup', r2_dup->>'record_id',
    'd1_dup_flag', r2_dup->'duplicate',
    'd1_seq_after_dup', seq_d1,
    'd2_before_midnight', r3->>'record_id',
    'd2_second', r4->>'record_id',
    'd3_after_midnight', r_midnight->>'record_id',
    'anon_can_exec', has_function_privilege('anon', 'public.qr_submit(jsonb)'::regprocedure, 'execute'),
    'auth_can_exec', has_function_privilege('authenticated', 'public.qr_submit(jsonb)'::regprocedure, 'execute'),
    'service_can_exec', has_function_privilege('service_role', 'public.qr_submit(jsonb)'::regprocedure, 'execute'),
    'all_ok', (
      r1->>'record_id' = 'QR-20990102-000001' and
      r2->>'record_id' = 'QR-20990102-000002' and
      r2_dup->>'record_id' = 'QR-20990102-000002' and
      (r2_dup->>'duplicate')::boolean = true and
      seq_d1 = 2 and
      r3->>'record_id' = 'QR-20990103-000001' and
      r4->>'record_id' = 'QR-20990103-000002' and
      r_midnight->>'record_id' = 'QR-20990104-000001' and
      not has_function_privilege('anon', 'public.qr_submit(jsonb)'::regprocedure, 'execute') and
      not has_function_privilege('authenticated', 'public.qr_submit(jsonb)'::regprocedure, 'execute') and
      has_function_privilege('service_role', 'public.qr_submit(jsonb)'::regprocedure, 'execute')
    )
  );
end $t$;

-- Self-test of the KPI counting for the new activities (migration 20261104_06). SAFE TO RUN: everything is undone at the
-- end (it finishes with a deliberate error "TESTRESULT ..." which rolls back the rule changes and the sample records).
-- Expected: staff_extra = {"POS_RETURN": 1, "MV_KHQR_ISSUE": 3} - the rejected return, the Account Opening visit (its
-- rule is off) and the Sunday 1 Nov visit are NOT counted (with working days Mon-Fri; with Mon-Sat the Sunday counts: 4),
-- new_staff_listed = true, daily_has_extra = {"POS_RETURN": 1, "MV_KHQR_ISSUE": 3} for 3 Nov.
do $t$
declare w jsonb; s jsonb; v_staff text := (select emp_id from public.staff_profiles where active and emp_id ~ '^\d+$' order by emp_id limit 1);
begin
  update public.kpi_point_rules set active = true, points = 4 where code = 'POS_RETURN';
  update public.kpi_point_rules set active = true, points = 1.5 where code = 'MV_KHQR_ISSUE';
  insert into public.field_events (source_record_id, unit_no, revision, kind, device_type, serial, branch_text, branch_id, staff_id, staff_name, recorded_at, status, payload, issues)
  values ('PRT-SELFTEST-1', 1, 1, 'POS_RETURN', 'POS Terminal', 'WPSELFTEST1', 'x', '105', v_staff, 'Tester', '2026-11-03 10:00+07', 'PENDING', '{}', '[]'),
         ('PRT-SELFTEST-2', 1, 1, 'POS_RETURN', 'POS Terminal', 'WPSELFTEST2', 'x', '105', v_staff, 'Tester', '2026-11-03 11:00+07', 'REJECTED', '{}', '[]');
  insert into public.mv_visits (record_id, activity, staff_id, staff_name, branch_id, submitted_at)
  values ('REG-20261103-9901', 'KHQR Issue', v_staff, 'Tester', '105', '2026-11-03 09:00+07'),
         ('REG-20261103-9902', 'KHQR Issue', v_staff, 'Tester', '105', '2026-11-03 09:30+07'),
         ('REG-20261102-9903', 'KHQR Issue', v_staff, 'Tester', '105', '2026-11-02 09:30+07'),
         ('REG-20261101-9904', 'KHQR Issue', v_staff, 'Tester', '105', '2026-11-01 09:30+07'),
         ('REG-20261103-9905', 'Account Opening', v_staff, 'Tester', '105', '2026-11-03 09:40+07'),
         ('REG-20261103-9906', 'KHQR Issue', 'SELFTEST99', 'Brand New', '105', '2026-11-03 09:40+07');
  w := public.kpi_dashboard_summary('2026-11-01'::date, null::date);
  select e into s from jsonb_array_elements(w->'staff') e where e->>'staff_id' = v_staff;
  raise exception 'TESTRESULT %', jsonb_build_object(
    'staff_extra', s->'extra',
    'new_staff_listed', exists (select 1 from jsonb_array_elements(w->'staff') e where e->>'staff_id' = 'SELFTEST99'),
    'daily_has_extra', (select e->'extra' from jsonb_array_elements(w->'daily') e where e->>'period' = '2026-11-03'),
    'working_days_mode', w->'targets'->>'working_days_mode');
end $t$;

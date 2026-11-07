-- Self-test of 20261107_01_phone_record_edit.sql (Phone App Review: edit a record). Run in the Supabase SQL Editor AFTER the
-- migration: everything happens inside one transaction that is rolled back at the end, so no data is left behind.
-- Expected last line:  TESTRESULT: all checks passed (n)
-- Uses its own test accounts and test records (TST-…); real data is never touched.
begin;

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
  perform set_config('request.jwt.claims', case when p is null then '' else json_build_object('sub', p, 'role', 'authenticated')::text end, true);
  perform set_config('test.uid', coalesce(p::text, ''), true);
end $$;
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return ''; exception when others then return sqlerrm; end $$;

do $t$
declare
  a  uuid := '00000000-0000-4000-8000-0000000000e1';   -- Admin
  sa uuid := '00000000-0000-4000-8000-0000000000e2';   -- Super Admin
  b  uuid := '00000000-0000-4000-8000-0000000000e3';   -- branch staff
  n int := 0; v jsonb; e text; f1 bigint; f2 bigint; f3 bigint; fa bigint; vi bigint; cc bigint; qi bigint; r record; i int;
begin
  if to_regclass('auth.users') is not null then
    execute 'insert into auth.users (id, aud, role, email) values ($1, ''authenticated'', ''authenticated'', ''t-e1@test.invalid''),
               ($2, ''authenticated'', ''authenticated'', ''t-e2@test.invalid''), ($3, ''authenticated'', ''authenticated'', ''t-e3@test.invalid'') on conflict (id) do nothing' using a, sa, b;
  end if;
  insert into public.staff_profiles (user_id, emp_id, name, role, branch_id, active) values
    (a, 'T-E1', 'TEST Admin', 'ADMIN', '100', true), (sa, 'T-E2', 'TEST Super', 'SUPER_ADMIN', '100', true), (b, 'T-E3', 'TEST Branch', 'BRANCH', '100', true)
    on conflict (user_id) do nothing;

  -- a two-device POS installation (pending), an approved one, a POS return with details
  insert into public.field_events (source_record_id, unit_no, kind, device_type, serial, mid, tid, terminal_name, outlet_name, remarks, payload, payload_hash, recorded_at)
  values ('TST-POS-20261107-001', 1, 'INSTALL', 'POS Terminal', 'TSTSER001', '226110554113027', '54113027', 'Counter 1', 'Test Mart', 'ok',
          '{"entry":{"outlet_name":"Test Mart","remarks":"ok"},"unit":{"serial":"TSTSER001","mid":"226110554113027"}}', 'h', now())
  returning id into f1;
  insert into public.field_events (source_record_id, unit_no, kind, device_type, serial, mid, tid, terminal_name, outlet_name, remarks, payload, payload_hash, recorded_at)
  values ('TST-POS-20261107-001', 2, 'INSTALL', 'POS Terminal', 'TSTSER002', '226110554113028', '54113028', 'Counter 2', 'Test Mart', 'ok', '{"entry":{},"unit":{}}', 'h', now())
  returning id into f2;
  insert into public.field_events (source_record_id, unit_no, kind, device_type, serial, mid, tid, terminal_name, status, payload, payload_hash, recorded_at)
  values ('TST-POS-20261107-002', 1, 'INSTALL', 'POS Terminal', 'TSTSER003', '226110554113029', '54113029', 'Front', 'APPROVED', '{}', 'h', now())
  returning id into fa;
  insert into public.field_events (source_record_id, unit_no, kind, device_type, serial, mid, tid, payload, payload_hash, recorded_at)
  values ('TST-PRT-20261107-001', 1, 'POS_RETURN', 'POS Terminal', 'TSTSER004', '226110554113030', '54113030',
          '{"entry":{"details":[{"k":"Product Name","v":"Q2PRO"},{"k":"SIM Card","v":"1"},{"k":"Charging Dock","v":"Lost"}],"summary":"x"},"unit":{}}', 'h', now())
  returning id into f3;
  insert into public.mv_visits (record_id, activity, merchant_name, mid, location, khan, answers, submitted_at)
  values ('TST-REG-20261107-001', 'Market Coverage', 'Test Shop', '226110554113031', 'Phnom Penh', 'Tuol Kouk',
          '{"Activity Type":"Market Coverage","Tag":"Riverside","Merchant Name":"Test Shop","MID or Acc Number":"226110554113031","Location":"Phnom Penh","Khan":"Tuol Kouk"}', now())
  returning id into vi;
  insert into public.cc_entries (record_id, request_type, card_status, full_name, contact, limit_usd, supplementary, staff_id, submitted_at)
  values ('CC-20261107-901', 'New Credit Card Request', 'Onboarded Successfully', 'TEST NAME', '012345678', 1000,
          '[{"full_name":"SUPP ONE","marital":"Single","account":"000111222","email":""}]', 'T-E3', now())
  returning id into cc;
  insert into public.qr_installations (record_id, request_id, session_id, activity, staff_id, merchant_name, mid, location)
  values ('TST-QR-20261107-001', 'tst:req1', 's1', 'NEW_INSTALLATION', 'T-E3', 'Test QR Shop', '226110554113032', 'Phnom Penh')
  returning id into qi;

  -- 1. who may edit
  perform pg_temp.as_user(b);
  e := pg_temp.err(format('select public.admin_edit_phone_record(%L)', jsonb_build_object('source', 'FIELD', 'id', f1, 'changes', '{"terminal_name":"X"}'::jsonb)));
  if e !~ 'Only an Admin or Super Admin' then raise exception 'FAIL 1: branch staff could edit (%)', e; end if; n := n + 1;
  perform pg_temp.as_user(null);
  e := pg_temp.err(format('select public.admin_edit_phone_record(%L)', jsonb_build_object('source', 'FIELD', 'id', f1, 'changes', '{"terminal_name":"X"}'::jsonb)));
  if e !~ 'Only an Admin' then raise exception 'FAIL 2: signed-out call could edit'; end if; n := n + 1;

  -- 2. POS: device fields on this row only, entry fields on every device
  perform pg_temp.as_user(a);
  v := public.admin_edit_phone_record(jsonb_build_object('source', 'FIELD', 'id', f1, 'reason', 'typo',
         'changes', '{"terminal_name":"Counter One","serial":"tstser001x","outlet_name":"Test Mart 2","remarks":"fixed","tid":"54113027"}'::jsonb));
  if (v->'changed') @> '["tid"]' or not (v->'changed') @> '["terminal_name","serial","outlet_name","remarks"]' or v->>'sheet' <> 'PENDING' then
    raise exception 'FAIL 3: changed list %', v; end if; n := n + 1;
  select * into r from public.field_events where id = f1;
  if r.terminal_name <> 'Counter One' or r.serial <> 'TSTSER001X' or r.outlet_name <> 'Test Mart 2' or r.payload->'unit'->>'serial' <> 'TSTSER001X'
     or r.payload->'entry'->>'outlet_name' <> 'Test Mart 2' then raise exception 'FAIL 4: device row %', row_to_json(r); end if; n := n + 1;
  select * into r from public.field_events where id = f2;
  if r.terminal_name <> 'Counter 2' or r.serial <> 'TSTSER002' or r.outlet_name <> 'Test Mart 2' or r.remarks <> 'fixed' then
    raise exception 'FAIL 5: the other device %', row_to_json(r); end if; n := n + 1;
  select * into r from public.phone_record_edits where source = 'FIELD' and row_id = f1 order by id desc limit 1;
  if r.record_id <> 'TST-POS-20261107-001' or r.unit_no <> 1 or r.kind <> 'INSTALL' or r.changes->>'serial' <> 'TSTSER001X' or r.old_values->>'serial' <> 'TSTSER001'
     or r.sheet_status <> 'PENDING' or r.reason <> 'typo' or r.edited_by <> 'TEST Admin (T-E1)' then raise exception 'FAIL 6: queue row %', row_to_json(r); end if; n := n + 1;
  if not exists (select 1 from public.audit_logs l where l.action = 'PHONE_RECORD_EDIT' and l.target = 'TST-POS-20261107-001'
                   and l.detail like '%serial TSTSER001 → TSTSER001X%' and l.detail like '%Reason: typo%') then raise exception 'FAIL 7: audit trail'; end if; n := n + 1;

  -- 3. checks on values
  e := pg_temp.err(format('select public.admin_edit_phone_record(%L)', jsonb_build_object('source', 'FIELD', 'id', f1, 'changes', '{"tid":"123"}'::jsonb)));
  if e !~ 'TID must be 8 digits' then raise exception 'FAIL 8: bad TID accepted (%)', e; end if; n := n + 1;
  e := pg_temp.err(format('select public.admin_edit_phone_record(%L)', jsonb_build_object('source', 'FIELD', 'id', f1, 'changes', '{"mid":"12ab"}'::jsonb)));
  if e !~ 'MID must be digits' then raise exception 'FAIL 9: bad MID accepted'; end if; n := n + 1;
  e := pg_temp.err(format('select public.admin_edit_phone_record(%L)', jsonb_build_object('source', 'FIELD', 'id', f1, 'changes', '{"status":"APPROVED"}'::jsonb)));
  if e !~ 'cannot be edited' then raise exception 'FAIL 10: status editable'; end if; n := n + 1;
  v := public.admin_edit_phone_record(jsonb_build_object('source', 'FIELD', 'id', f1, 'changes', '{"terminal_name":"Counter One"}'::jsonb));
  if jsonb_array_length(coalesce(v->'changed', '[]')) <> 0 then raise exception 'FAIL 11: unchanged value queued'; end if; n := n + 1;

  -- 4. approved: stock fields locked, the rest editable
  e := pg_temp.err(format('select public.admin_edit_phone_record(%L)', jsonb_build_object('source', 'FIELD', 'id', fa, 'changes', '{"serial":"NEWSER","mid":"226110554113099"}'::jsonb)));
  if e !~ 'approved record' or e !~ 'serial' or e !~ 'mid' then raise exception 'FAIL 12: approved serial changed (%)', e; end if; n := n + 1;
  if (select serial from public.field_events where id = fa) <> 'TSTSER003' then raise exception 'FAIL 13: approved row touched'; end if; n := n + 1;
  v := public.admin_edit_phone_record(jsonb_build_object('source', 'FIELD', 'id', fa, 'changes', '{"terminal_name":"Front Desk"}'::jsonb));
  if (select terminal_name from public.field_events where id = fa) <> 'Front Desk' then raise exception 'FAIL 14: approved name not editable'; end if; n := n + 1;

  -- 5. POS return: details (returned items) and the summary
  v := public.admin_edit_phone_record(jsonb_build_object('source', 'FIELD', 'id', f3, 'changes', '{"details":{"Charging Dock":"1","Unknown":"x"}}'::jsonb));
  select * into r from public.field_events where id = f3;
  if r.payload->'entry'->'details'->2->>'v' <> '1' or r.payload->'entry'->>'summary' <> 'Product Q2PRO · SIM Card: 1 · Charging Dock: 1'
     or jsonb_array_length(r.payload->'entry'->'details') <> 3 then raise exception 'FAIL 15: details %', r.payload; end if; n := n + 1;

  -- 6. Merchant Visit: answers (incl. the new Tag) and the columns that follow them
  v := public.admin_edit_phone_record(jsonb_build_object('source', 'VISIT', 'id', vi, 'changes', '{"answers":{"Tag":"Phsar Thmey","Merchant Name":"Test Shop 2","Khan":"Daun Penh"}}'::jsonb));
  select * into r from public.mv_visits where id = vi;
  if r.answers->>'Tag' <> 'Phsar Thmey' or r.merchant_name <> 'Test Shop 2' or r.khan <> 'Daun Penh' or r.edited_at is null then raise exception 'FAIL 16: visit %', row_to_json(r); end if; n := n + 1;
  if (select changes->'answers'->>'Tag' from public.phone_record_edits where source = 'VISIT' and row_id = vi order by id desc limit 1) <> 'Phsar Thmey' then raise exception 'FAIL 17: visit queue'; end if; n := n + 1;
  e := pg_temp.err(format('select public.admin_edit_phone_record(%L)', jsonb_build_object('source', 'VISIT', 'id', vi, 'changes', '{"merchant_name":"x"}'::jsonb)));
  if e !~ 'answers' then raise exception 'FAIL 18: visit column edit accepted'; end if; n := n + 1;

  -- 7. Credit Card: fields and supplementary cards (corrected, not added)
  perform pg_temp.as_user(sa);
  v := public.admin_edit_phone_record(jsonb_build_object('source', 'CC', 'id', cc, 'changes',
         '{"full_name":"TEST NAME 2","limit_usd":"1,500","supplementary":[{"full_name":"SUPP UNO","marital":"Married","account":"000 111 222","email":"a@b.c"}]}'::jsonb));
  select * into r from public.cc_entries where id = cc;
  if r.full_name <> 'TEST NAME 2' or r.limit_usd <> 1500 or r.supplementary->0->>'full_name' <> 'SUPP UNO' or r.supplementary->0->>'account' <> '000111222' then
    raise exception 'FAIL 19: cc %', row_to_json(r); end if; n := n + 1;
  e := pg_temp.err(format('select public.admin_edit_phone_record(%L)', jsonb_build_object('source', 'CC', 'id', cc, 'changes', '{"supplementary":[]}'::jsonb)));
  if e !~ 'not added or removed' then raise exception 'FAIL 20: card removed'; end if; n := n + 1;

  -- 8. KHQR: portal only (no Sheet), MID checked
  v := public.admin_edit_phone_record(jsonb_build_object('source', 'KHQR', 'id', qi, 'changes', '{"merchant_name":"Test QR Shop 2","activity":"QR_REPLACEMENT"}'::jsonb));
  if v->>'sheet' <> 'NOT_NEEDED' or (select activity from public.qr_installations where id = qi) <> 'QR_REPLACEMENT' then raise exception 'FAIL 21: khqr %', v; end if; n := n + 1;
  if (select sheet_status from public.phone_record_edits where source = 'KHQR' and row_id = qi order by id desc limit 1) <> 'NOT_NEEDED' then raise exception 'FAIL 22: khqr queued for the Sheet'; end if; n := n + 1;
  e := pg_temp.err(format('select public.admin_edit_phone_record(%L)', jsonb_build_object('source', 'KHQR', 'id', qi, 'changes', '{"mid":"123"}'::jsonb)));
  if e !~ '15 digits' then raise exception 'FAIL 23: bad khqr MID accepted'; end if; n := n + 1;

  -- 9. the Merchant Visit app's queue (service key) - not readable / callable by a signed-in user
  e := pg_temp.err('select public.mv_edits_pending(''{}'')');
  if to_regrole('authenticated') is not null and has_function_privilege('authenticated', 'public.mv_edits_pending(jsonb)', 'execute') then raise exception 'FAIL 24: queue open to users'; end if; n := n + 1;
  v := public.mv_edits_pending('{"limit":200}');
  if not exists (select 1 from jsonb_array_elements(v->'edits') x where x->>'record_id' = 'TST-POS-20261107-001')
     or exists (select 1 from jsonb_array_elements(v->'edits') x where x->>'source' = 'KHQR') then raise exception 'FAIL 25: pending list'; end if; n := n + 1;
  select id into f1 from public.phone_record_edits where source = 'VISIT' and row_id = vi order by id desc limit 1;
  select id into f2 from public.phone_record_edits where source = 'CC' and row_id = cc order by id desc limit 1;
  v := public.mv_edits_done(jsonb_build_object('results', jsonb_build_array(jsonb_build_object('id', f1, 'ok', true), jsonb_build_object('id', f2, 'ok', false, 'note', 'row not found'))));
  if (select sheet_status from public.phone_record_edits where id = f1) <> 'APPLIED' or (select sheet_status from public.phone_record_edits where id = f2) <> 'PENDING'
     or (select sheet_tries from public.phone_record_edits where id = f2) <> 1 then raise exception 'FAIL 26: done %', v; end if; n := n + 1;
  for i in 1..4 loop perform public.mv_edits_done(jsonb_build_object('results', jsonb_build_array(jsonb_build_object('id', f2, 'ok', false, 'note', 'row not found')))); end loop;
  if (select sheet_status from public.phone_record_edits where id = f2) <> 'FAILED' then raise exception 'FAIL 27: not failed after 5 tries'; end if; n := n + 1;

  raise notice 'TESTRESULT: all checks passed (%)', n;
end $t$;

rollback;

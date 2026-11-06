-- Self-test of 20261105_01_materials_and_kits.sql. Run in the Supabase SQL Editor AFTER the migration: everything
-- happens inside one transaction that is rolled back at the end, so no data is left behind. Expected last line:
--   TESTRESULT: all checks passed (n)
-- It signs in as three test accounts it creates itself (Admin HQ, branch 905 staff, branch 906 staff) on two test
-- branches (905, 906), so it never touches real branches, devices or materials.
begin;

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
  perform set_config('request.jwt.claims', case when p is null then '' else json_build_object('sub', p, 'role', 'authenticated')::text end, true);
  perform set_config('test.uid', coalesce(p::text, ''), true);
end $$;
-- runs a statement and returns its error message ('' when it succeeded)
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return ''; exception when others then return sqlerrm; end $$;

do $t$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a1';   -- Admin HQ
  b uuid := '00000000-0000-4000-8000-0000000000b5';   -- branch 905
  c uuid := '00000000-0000-4000-8000-0000000000b6';   -- branch 906
  n int := 0; v jsonb; e text; q int; s text; k public.device_kits; lid bigint; cid bigint;
  procedure_ok boolean;
begin
  -- test data -----------------------------------------------------------------------------------------------------
  insert into public.branches (id, name, code) values ('905', 'Test Branch 905', '905'), ('906', 'Test Branch 906', '906') on conflict do nothing;
  -- staff profiles belong to a login account (rolled back with everything else)
  if to_regclass('auth.users') is not null then
    execute 'insert into auth.users (id, aud, role, email) values ($1, ''authenticated'', ''authenticated'', ''t-adm@test.invalid''),
               ($2, ''authenticated'', ''authenticated'', ''t-905@test.invalid''), ($3, ''authenticated'', ''authenticated'', ''t-906@test.invalid'') on conflict (id) do nothing'
      using a, b, c;
  end if;
  insert into public.staff_profiles (user_id, emp_id, name, role, branch_id, active, must_change_password) values
    (a, 'T-ADM', 'TEST Admin', 'ADMIN', '100', true, false),
    (b, 'T-905', 'TEST Staff905', 'BRANCH', '905', true, false),
    (c, 'T-906', 'TEST Staff906', 'BRANCH', '906', true, false) on conflict do nothing;
  insert into public.devices (serial, type, model, stage, branch_id, branch_name, mid, merchant_name, archived, custom_fields, history) values
    ('TST-POS-1', 'POS Terminal', 'Q2PRO', 'COMPLETE', '905', 'Test Branch 905', '209900000000001', 'Test Mart', false, '{}', '[]'),
    ('TST-POS-2', 'POS Terminal', 'Q2PRO', 'COMPLETE', '905', 'Test Branch 905', '209900000000002', 'Test Shop', false, '{}', '[]'),
    ('TST-SB-1',  'Sound Box',    'SB',    'COMPLETE', '905', 'Test Branch 905', '209900000000003', 'Test Cafe', false, '{}', '[]'),
    ('TST-HQ-1',  'POS Terminal', 'Q2PRO', 'HQ_STOCK', '100', 'Head Office', null, null, false, '{}', '[]');

  -- 1. SIM numbers ------------------------------------------------------------------------------------------------
  if app.norm_sim('096 555 0142') = '096 555 0142' and app.norm_sim('0965550142') = '096 555 0142' and app.norm_sim('+855 96 555 0142') = '096 555 0142'
     and app.norm_sim('012345678') = '012 345 678' and app.norm_sim('12345') is null and app.norm_sim('abc') is null then n := n + 1;
  else raise exception 'FAIL 1 SIM numbers are not normalised'; end if;

  -- 2. stock in (Admin HQ only) -----------------------------------------------------------------------------------
  perform pg_temp.as_user(b);
  e := pg_temp.err($$select public.admin_material_stock_in('{"code":"POS_ADAPTOR","qty":5}')$$);
  if e not like 'Only Admin HQ%' then raise exception 'FAIL 2a branch staff could add stock: %', e; end if; n := n + 1;
  perform pg_temp.as_user(a);
  v := public.admin_material_stock_in('{"code":"POS_ADAPTOR","qty":100,"note":"test"}');
  v := public.admin_material_stock_in('{"code":"DOCK","qty":3}');
  v := public.admin_material_stock_in('{"code":"SIM","serials":["090 000 0001","0900000001","+855 90 000 0002","abc","090000003"]}');
  if (v->>'added')::int <> 3 or jsonb_array_length(v->'refused') <> 2 then raise exception 'FAIL 2b SIM stock in: %', v; end if; n := n + 1;   -- 090000003 is a valid 9-digit number
  v := public.admin_material_stock_in('{"code":"BATTERY","serials":["tbat-1","TBAT-2"]}');
  if (select qty from public.material_qty where material_code = 'POS_ADAPTOR' and branch_id = '100') < 100
     or (select count(*) from public.material_serials where serial in ('090 000 0001', '090 000 0002', 'TBAT-1', 'TBAT-2') and status = 'HQ_STOCK') <> 4 then
    raise exception 'FAIL 2c HQ stock not recorded'; end if; n := n + 1;

  -- 3. opening stock: quantities set, numbers registered, bad rows refused with a reason ----------------------------
  v := public.admin_material_opening($j${"qty":[{"branch":"905","code":"POS_ADAPTOR","qty":10},{"branch":"Test Branch 906","code":"SB_ADAPTOR","qty":4},
          {"branch":"999","code":"STAND","qty":1},{"branch":"905","code":"SIM","qty":3}],
          "serials":[{"branch":"905","code":"SIM","serial":"091 111 1111"},{"branch":"905","code":"SIM","serial":"091 111 1112"},{"branch":"905","code":"BATTERY","serial":"TBAT-9"},
          {"branch":"905","code":"SIM","serial":"090 000 0001"}]}$j$);
  if (v->>'qty_lines')::int <> 2 or (v->>'serials')::int <> 3 or jsonb_array_length(v->'refused') <> 3 then raise exception 'FAIL 3a opening: %', v; end if;
  if (select qty from public.material_qty where material_code = 'SB_ADAPTOR' and branch_id = '906') <> 4 then raise exception 'FAIL 3b branch by name'; end if;
  n := n + 2;

  -- 4. Stock Request with materials: branch staff request, edit while pending; cannot touch what was sent --------------
  perform pg_temp.as_user(b);
  set local role authenticated;
  insert into public.requisitions (req_id, date, branch_id, branch_name, staff, pos_qty, sb_qty, reason, status, type, materials)
  values ('TST-REQ-1', '2026-11-05', '905', 'Test Branch 905', 'TEST Staff905', 1, 0, 'test', 'PENDING_ADMIN', 'STOCK_REQUEST', '{"POS_ADAPTOR":5,"SIM":1}'),
         ('TST-REQ-2', '2026-11-05', '905', 'Test Branch 905', 'TEST Staff905', 0, 0, 'materials only', 'PENDING_ADMIN', 'STOCK_REQUEST', '{"DOCK":1}');
  update public.requisitions set materials = '{"POS_ADAPTOR":6,"SIM":1}' where req_id = 'TST-REQ-1';
  e := pg_temp.err($$update public.requisitions set materials_sent = '{"qty":{"POS_ADAPTOR":6}}' where req_id = 'TST-REQ-1'$$);
  if e not like 'Use Dispatch%' then raise exception 'FAIL 4a branch could set materials_sent: %', e; end if;
  e := pg_temp.err($$update public.requisitions set materials = '{}', pos_qty = 0 where req_id = 'TST-REQ-1'$$);
  if e not like 'Enter at least one%' then raise exception 'FAIL 4b empty request accepted: %', e; end if;
  e := pg_temp.err($$insert into public.material_qty (material_code, branch_id, qty) values ('DOCK', '905', 99)$$);
  if e not like 'permission denied%' then raise exception 'FAIL 4c direct write allowed: %', e; end if;
  reset role;
  n := n + 3;

  -- 5. dispatch: all or nothing; over-request and missing stock refused ------------------------------------------------
  perform pg_temp.as_user(a);
  e := pg_temp.err($$select public.admin_dispatch_request('{"req_id":"TST-REQ-1","serials":["TST-HQ-1"],"materials":{"qty":{"POS_ADAPTOR":7}}}')$$);
  if e not like '%7 POS AC Adaptor sent but 6 requested%' then raise exception 'FAIL 5a over-request: %', e; end if;
  e := pg_temp.err($$select public.admin_dispatch_request('{"req_id":"TST-REQ-1","serials":["TST-HQ-1"],"materials":{"qty":{"POS_ADAPTOR":6},"serials":{"SIM":["091 111 1111"]}}}')$$);
  if e not like '%not in Head Office stock%' then raise exception 'FAIL 5b SIM from a branch dispatched: %', e; end if;
  if (select status from public.requisitions where req_id = 'TST-REQ-1') <> 'PENDING_ADMIN'
     or (select qty from public.material_qty where material_code = 'POS_ADAPTOR' and branch_id = '100') < 100 then
    raise exception 'FAIL 5c a refused dispatch changed something'; end if;
  v := public.admin_dispatch_request('{"req_id":"TST-REQ-1","serials":["TST-HQ-1"],"materials":{"qty":{"POS_ADAPTOR":6},"serials":{"SIM":["0900000001"]}}}');
  if (select status from public.requisitions where req_id = 'TST-REQ-1') <> 'DISPATCHED'
     or (select status from public.material_serials where material_code = 'SIM' and serial = '090 000 0001') <> 'IN_TRANSIT' then
    raise exception 'FAIL 5d dispatch: %', v; end if;
  v := public.admin_dispatch_request('{"req_id":"TST-REQ-2","materials":{"qty":{"DOCK":1}}}');
  if (select status from public.requisitions where req_id = 'TST-REQ-2') <> 'DISPATCHED' then raise exception 'FAIL 5e materials-only dispatch'; end if;
  n := n + 5;

  -- 6. receipt (portal and Merchant Visit app) moves materials into the branch, once ------------------------------------
  perform pg_temp.as_user(b);
  v := public.branch_confirm_receipt('TST-REQ-1');
  if (select qty from public.material_qty where material_code = 'POS_ADAPTOR' and branch_id = '905') <> 16
     or (select status || branch_id from public.material_serials where material_code = 'SIM' and serial = '090 000 0001') <> 'BRANCH_RESERVE905'
     or (select stage from public.devices where serial = 'TST-HQ-1') <> 'BRANCH_RESERVE' then
    raise exception 'FAIL 6a receipt did not move devices and materials'; end if;
  perform pg_temp.as_user(null);
  v := public.mv_req_confirm('{"req_id":"TST-REQ-2","branch":"905","staff_name":"TEST","staff_id":"T-905"}');
  v := public.mv_req_confirm('{"req_id":"TST-REQ-2","branch":"905","staff_name":"TEST","staff_id":"T-905"}');   -- twice: no double count
  if (select qty from public.material_qty where material_code = 'DOCK' and branch_id = '905') <> 1 then raise exception 'FAIL 6b app receipt'; end if;
  n := n + 2;

  -- 7. kits: issue from stock (all or nothing), wrong device type, baseline, duplicates, Wi-Fi ----------------------------
  perform pg_temp.as_user(b);
  e := pg_temp.err($$select public.admin_kit_add('{"device_serial":"TST-POS-1","items":[{"code":"POS_ADAPTOR","qty":1}]}')$$);
  if e not like 'Only Admin HQ%' then raise exception 'FAIL 7a branch changed a kit in the portal: %', e; end if;
  perform pg_temp.as_user(a);
  e := pg_temp.err($$select public.admin_kit_add('{"device_serial":"TST-POS-1","connection":"SIM","items":[{"code":"SIM","serial":"0900000001"},{"code":"POS_ADAPTOR","qty":1},{"code":"STAND","qty":1}]}')$$);
  if e not like '%not enough POS Stand Holder%' then raise exception 'FAIL 7b missing stand not refused: %', e; end if;
  if (select status from public.material_serials where material_code = 'SIM' and serial = '090 000 0001') <> 'BRANCH_RESERVE' then raise exception 'FAIL 7c partial kit kept'; end if;
  v := public.admin_material_stock_in('{"code":"STAND","qty":2,"branch_id":"905"}');
  v := public.admin_kit_add('{"device_serial":"TST-POS-1","connection":"SIM","items":[{"code":"SIM","serial":"0900000001"},{"code":"POS_ADAPTOR","qty":1},{"code":"STAND","qty":1},{"code":"BATTERY","serial":"tbat-9"}]}');
  select * into k from public.device_kits where device_serial = 'TST-POS-1';
  if k.connection <> 'SIM' or jsonb_array_length(k.items) <> 4
     or (select status || coalesce(device_serial, '') from public.material_serials where material_code = 'SIM' and serial = '090 000 0001') <> 'AT_MERCHANTTST-POS-1'
     or (select qty from public.material_qty where material_code = 'POS_ADAPTOR' and branch_id = '905') <> 15 then raise exception 'FAIL 7d kit issued: %', k; end if;
  -- (since 20261106_01 a Battery also goes with a Sound Box; a POS AC Adaptor still does not)
  e := pg_temp.err($$select public.admin_kit_add('{"device_serial":"TST-SB-1","items":[{"code":"POS_ADAPTOR","qty":1}]}')$$);
  if e not like '%does not go with a Sound Box%' then raise exception 'FAIL 7e POS adaptor on a Sound Box: %', e; end if;
  e := pg_temp.err($$select public.admin_kit_add('{"device_serial":"TST-POS-2","from_stock":false,"items":[{"code":"SIM","serial":"090 000 0001"}]}')$$);
  if e not like '%already at another merchant%' then raise exception 'FAIL 7f SIM on two merchants: %', e; end if;
  e := pg_temp.err($$select public.admin_kit_add('{"device_serial":"TST-POS-2","connection":"WIFI","items":[{"code":"SIM","serial":"099 999 9999"}]}')$$);
  if e not like '%Wi-Fi merchant gets no SIM%' then raise exception 'FAIL 7g SIM for Wi-Fi: %', e; end if;
  v := public.admin_kit_add('{"device_serial":"TST-POS-2","from_stock":false,"connection":"SIM","items":[{"code":"SIM","serial":"092 222 2222"},{"code":"POS_ADAPTOR","qty":1}]}');
  if (select status from public.material_serials where serial = '092 222 2222') <> 'AT_MERCHANT'
     or (select qty from public.material_qty where material_code = 'POS_ADAPTOR' and branch_id = '905') <> 15 then raise exception 'FAIL 7h baseline moved stock'; end if;
  v := public.admin_kit_add('{"device_serial":"TST-SB-1","items":[{"code":"SIM","serial":"091 111 1112"}]}');
  e := pg_temp.err($$select public.admin_kit_add('{"device_serial":"TST-SB-1","items":[{"code":"SIM","serial":"091 111 1111"}]}')$$);
  if e not like '%already has a SIM Card%' then raise exception 'FAIL 7i second SIM: %', e; end if;
  n := n + 9;

  -- 8. replacement and return ---------------------------------------------------------------------------------------------
  v := public.admin_kit_replace('{"device_serial":"TST-POS-1","code":"POS_ADAPTOR","old_result":"FAULTY","remark":"broken plug"}');
  if (select qty from public.material_qty where material_code = 'POS_ADAPTOR' and branch_id = '905') <> 14 then raise exception 'FAIL 8a replacement stock'; end if;
  e := pg_temp.err($$select public.admin_kit_return('{"device_serial":"TST-POS-1","items":[{"code":"STAND","result":"LOST"}]}')$$);
  if e not like '%write a remark%' then raise exception 'FAIL 8b lost without remark: %', e; end if;
  v := public.admin_kit_return('{"device_serial":"TST-POS-1","items":[{"code":"SIM","result":"RETURNED"},{"code":"POS_ADAPTOR","qty":1,"result":"LOST","remark":"merchant lost it"},{"code":"STAND","qty":1,"result":"RETURNED"},{"code":"BATTERY","result":"RETURNED"}]}');
  select * into k from public.device_kits where device_serial = 'TST-POS-1';
  if jsonb_array_length(k.items) <> 0 or k.connection is not null
     or (select status || branch_id from public.material_serials where material_code = 'SIM' and serial = '090 000 0001') <> 'BRANCH_RESERVE905'
     or (select qty from public.material_qty where material_code = 'STAND' and branch_id = '905') <> 2
     or (select qty from public.material_qty where material_code = 'POS_ADAPTOR' and branch_id = '905') <> 14
     or not exists (select 1 from public.material_lost where device_serial = 'TST-POS-1' and material_code = 'POS_ADAPTOR' and status = 'OPEN') then
    raise exception 'FAIL 8c return: %', k; end if;
  n := n + 3;

  -- 9. lost items: recover, write off (reason), SIM blocked with the carrier ----------------------------------------------
  select id into lid from public.material_lost where device_serial = 'TST-POS-1' and material_code = 'POS_ADAPTOR';
  v := public.admin_material_lost_action(jsonb_build_object('id', lid, 'action', 'RECOVER', 'reason', 'found at the shop'));
  if (select qty from public.material_qty where material_code = 'POS_ADAPTOR' and branch_id = '905') <> 15 then raise exception 'FAIL 9a recover'; end if;
  v := public.admin_kit_return('{"device_serial":"TST-SB-1","items":[{"code":"SIM","result":"LOST","remark":"merchant lost the SIM"}]}');
  select id into lid from public.material_lost where device_serial = 'TST-SB-1' and material_code = 'SIM';
  e := pg_temp.err(format($$select public.admin_material_lost_action('{"id":%s,"action":"WRITE_OFF"}')$$, lid));
  if e not like '%reason for the write-off%' then raise exception 'FAIL 9b write-off without reason: %', e; end if;
  v := public.admin_material_lost_action(jsonb_build_object('id', lid, 'action', 'BLOCKED'));
  v := public.admin_material_lost_action(jsonb_build_object('id', lid, 'action', 'WRITE_OFF', 'reason', 'not found'));
  if (select status || blocked_with_carrier::text from public.material_serials where material_code = 'SIM' and serial = '091 111 1112') <> 'WRITTEN_OFFtrue' then
    raise exception 'FAIL 9c SIM write-off / block'; end if;
  n := n + 3;

  -- 10. monthly count: own branch only, differences, approval corrects stock and records missing numbers Lost --------------
  perform pg_temp.as_user(c);
  e := pg_temp.err($$select public.material_count_submit('{"branch_id":"905","month":"2026-11","lines":[{"code":"DOCK","counted":1}]}')$$);
  if e not like 'You can count only your own branch%' then raise exception 'FAIL 10a counted another branch: %', e; end if;
  perform pg_temp.as_user(b);
  v := public.material_count_submit('{"month":"2026-11","lines":[{"code":"POS_ADAPTOR","counted":14,"remark":"one given, not recorded"},{"code":"SIM","present":["0911111111"],"remark":"090 000 0001 not found"},{"code":"DOCK","counted":1}]}');
  cid := (v->>'id')::bigint;
  if (v->>'differences')::int <> 2 then raise exception 'FAIL 10b differences: %', v; end if;
  perform pg_temp.as_user(a);
  v := public.admin_material_count_review(jsonb_build_object('id', cid, 'action', 'APPROVE'));
  if (select qty from public.material_qty where material_code = 'POS_ADAPTOR' and branch_id = '905') <> 14
     or (select status from public.material_serials where material_code = 'SIM' and serial = '090 000 0001') <> 'LOST'
     or not exists (select 1 from public.material_lost where serial = '090 000 0001' and source = 'Monthly count') then raise exception 'FAIL 10c approve: %', v; end if;
  perform pg_temp.as_user(b);
  e := pg_temp.err($$select public.material_count_submit('{"month":"2026-11","lines":[{"code":"DOCK","counted":1}]}')$$);
  if e not like '%already approved%' then raise exception 'FAIL 10d recount after approval: %', e; end if;
  n := n + 4;

  -- 11. who sees what -----------------------------------------------------------------------------------------------------
  perform pg_temp.as_user(c);
  set local role authenticated;
  if (select count(*) from public.material_qty where branch_id = '905') <> 0 or (select count(*) from public.material_serials where branch_id = '905') <> 0
     or (select count(*) from public.device_kits where device_serial like 'TST-%') <> 0 or (select count(*) from public.material_lost where branch_id = '905') <> 0 then
    raise exception 'FAIL 11a branch 906 sees branch 905'; end if;
  reset role;
  perform pg_temp.as_user(b);
  set local role authenticated;
  if (select count(*) from public.material_qty where branch_id = '905') = 0 or (select count(*) from public.device_kits where device_serial like 'TST-%') = 0
     or (select count(*) from public.material_qty where branch_id = '100') <> 0 then raise exception 'FAIL 11b branch 905 own view'; end if;
  reset role;
  if (select count(*) from public.material_movements where branch_id = '905') < 10
     or (select count(*) from public.audit_logs where action like 'MATERIAL_%') < 8 then raise exception 'FAIL 11c history not kept'; end if;
  perform pg_temp.as_user(b);
  set local role authenticated;
  if (select coalesce(sum(on_hand), 0) from public.material_balances where material_code = 'SIM') <> 1
     or (select count(*) from public.material_balances where branch_id <> '905') <> 0 then raise exception 'FAIL 11d balances view'; end if;
  reset role;
  n := n + 4;

  raise exception 'TESTRESULT: all checks passed (%)', n;
end $t$;
rollback;

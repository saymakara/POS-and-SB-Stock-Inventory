-- Self-test of 20261106_01_sim_card_manage.sql (Manage SIM). Run in the Supabase SQL Editor AFTER the migration:
-- everything happens inside one transaction that is rolled back at the end, so no data is left behind.
-- Expected last line:  TESTRESULT: all checks passed (n)
-- Uses its own test accounts, test branches 905 / 906 and test units TST-*; real data is never touched.
begin;

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
  perform set_config('request.jwt.claims', case when p is null then '' else json_build_object('sub', p, 'role', 'authenticated')::text end, true);
  perform set_config('test.uid', coalesce(p::text, ''), true);
end $$;
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return ''; exception when others then return sqlerrm; end $$;
create or replace function pg_temp.sim(p text) returns public.material_serials language sql as $$
  select * from public.material_serials where material_code = 'SIM' and serial = p $$;
create or replace function pg_temp.kit_sim(p varchar) returns text language sql as $$
  select x->>'serial' from public.device_kits k, jsonb_array_elements(k.items) x where k.device_serial = p and x->>'code' = 'SIM' limit 1 $$;

do $t$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  b uuid := '00000000-0000-4000-8000-0000000000b5';
  n int := 0; v jsonb; e text; s public.material_serials;
begin
  insert into public.branches (id, name, code) values ('905', 'Test Branch 905', '905'), ('906', 'Test Branch 906', '906') on conflict do nothing;
  if to_regclass('auth.users') is not null then
    execute 'insert into auth.users (id, aud, role, email) values ($1, ''authenticated'', ''authenticated'', ''t-adm@test.invalid''),
               ($2, ''authenticated'', ''authenticated'', ''t-905@test.invalid'') on conflict (id) do nothing' using a, b;
  end if;
  insert into public.staff_profiles (user_id, emp_id, name, role, branch_id, active, must_change_password) values
    (a, 'T-ADM', 'TEST Admin', 'ADMIN', '100', true, false),
    (b, 'T-905', 'TEST Staff905', 'BRANCH', '905', true, false) on conflict do nothing;
  insert into public.devices (serial, type, model, stage, branch_id, branch_name, mid, merchant_name, archived, custom_fields, history) values
    ('TST-POS-1', 'POS Terminal', 'Q2PRO', 'COMPLETE', '905', 'Test Branch 905', '209900000000001', 'Test Mart', false, '{}', '[]'),
    ('TST-POS-2', 'POS Terminal', 'Q2PRO', 'COMPLETE', '906', 'Test Branch 906', '209900000000002', 'Test Shop', false, '{}', '[]'),
    ('TST-SB-1',  'Sound Box',    'SB',    'COMPLETE', '905', 'Test Branch 905', '209900000000003', 'Test Cafe', false, '{}', '[]');

  perform pg_temp.as_user(a);
  v := public.admin_material_stock_in('{"code":"SIM","serials":["091 000 0001","091 000 0002","091 000 0003"]}');
  v := public.admin_material_stock_in('{"code":"BATTERY","serials":["TSB-BAT-1"],"branch_id":"905"}');

  -- 1. Admin HQ only
  perform pg_temp.as_user(b);
  e := pg_temp.err($$select public.admin_sim_update('{"serial":"091 000 0001","status":"BRANCH_RESERVE","branch_id":"905"}')$$);
  if e not like 'Only Admin HQ%' then raise exception 'FAIL 1 branch staff could manage a SIM: %', e; end if; n := n + 1;
  perform pg_temp.as_user(a);

  -- 2. bad input is refused with a clear message
  e := pg_temp.err($$select public.admin_sim_update('{"serial":"abc"}')$$);
  if e not like 'INPUT:%not a valid SIM number%' then raise exception 'FAIL 2a %', e; end if;
  e := pg_temp.err($$select public.admin_sim_update('{"serial":"091 000 0001","status":"SOLD"}')$$);
  if e not like 'INPUT: unknown SIM status%' then raise exception 'FAIL 2b %', e; end if;
  e := pg_temp.err($$select public.admin_sim_update('{"serial":"091 000 0001","blocked_with_carrier":"maybe"}')$$);
  if e not like 'INPUT: blocked_with_carrier%' then raise exception 'FAIL 2c %', e; end if; n := n + 1;

  -- 3. a new SIM for stock is refused (Stock In), not created at Head Office
  e := pg_temp.err($$select public.admin_sim_update('{"serial":"091 999 0000","status":"BRANCH_RESERVE","branch_id":"905"}')$$);
  if e not like 'STOCK:%not registered%Stock In%' or pg_temp.sim('091 999 0000') is not null then raise exception 'FAIL 3 %', e; end if; n := n + 1;

  -- 4. HQ stock -> unit at a merchant: moved to the unit's branch, then into the merchant kit; number typed another way
  v := public.admin_sim_update('{"serial":"0910000001","status":"AT_MERCHANT","device_serial":"TST-POS-1","note":"installed"}');
  s := pg_temp.sim('091 000 0001');
  if s.status <> 'AT_MERCHANT' or s.device_serial <> 'TST-POS-1' or s.branch_id <> '905' or pg_temp.kit_sim('TST-POS-1') <> '091 000 0001'
     or (select count(*) from public.material_serials where material_code = 'SIM' and serial like '%0910000001%') <> 0
     or not exists (select 1 from public.material_movements where serial = '091 000 0001' and kind = 'SIM_MOVE' and to_branch = '905')
     or not exists (select 1 from public.material_movements where serial = '091 000 0001' and kind = 'KIT_ADD' and device_serial = 'TST-POS-1') then
    raise exception 'FAIL 4 %', to_jsonb(s); end if; n := n + 1;

  -- 5. another SIM into the same unit: the first one goes back to the branch reserve and out of the kit
  v := public.admin_sim_update('{"serial":"091 000 0002","device_serial":"TST-POS-1"}');
  if pg_temp.kit_sim('TST-POS-1') <> '091 000 0002' or (pg_temp.sim('091 000 0001')).status <> 'BRANCH_RESERVE'
     or (pg_temp.sim('091 000 0001')).device_serial is not null or (pg_temp.sim('091 000 0001')).branch_id <> '905' then
    raise exception 'FAIL 5 kit %, old %', pg_temp.kit_sim('TST-POS-1'), to_jsonb(pg_temp.sim('091 000 0001')); end if; n := n + 1;

  -- 6. the same request again changes nothing (the portal may send it twice)
  v := public.admin_sim_update('{"serial":"091 000 0002","device_serial":"TST-POS-1","status":"AT_MERCHANT"}');
  if (select jsonb_array_length(items) from public.device_kits where device_serial = 'TST-POS-1') <> 1
     or (select count(*) from public.material_movements where serial = '091 000 0002' and kind = 'KIT_ADD') <> 1 then
    raise exception 'FAIL 6 not idempotent'; end if; n := n + 1;

  -- 7. moved to a unit of another merchant / branch: out of the old kit, into the new one
  v := public.admin_sim_update('{"serial":"091 000 0002","device_serial":"TST-POS-2","status":"AT_MERCHANT"}');
  if pg_temp.kit_sim('TST-POS-1') is not null or pg_temp.kit_sim('TST-POS-2') <> '091 000 0002' or (pg_temp.sim('091 000 0002')).branch_id <> '906' then
    raise exception 'FAIL 7 %', to_jsonb(pg_temp.sim('091 000 0002')); end if; n := n + 1;

  -- 8. back to HQ stock: out of the kit, at Head Office
  v := public.admin_sim_update('{"serial":"091 000 0002","status":"HQ_STOCK"}');
  s := pg_temp.sim('091 000 0002');
  if s.status <> 'HQ_STOCK' or s.branch_id <> '100' or s.device_serial is not null or pg_temp.kit_sim('TST-POS-2') is not null then
    raise exception 'FAIL 8 %', to_jsonb(s); end if; n := n + 1;

  -- 9. Lost needs a remark; from a merchant kit it opens a Lost item; carrier block is kept on it
  v := public.admin_sim_update('{"serial":"091 000 0003","device_serial":"TST-SB-1"}');
  if pg_temp.kit_sim('TST-SB-1') <> '091 000 0003' then raise exception 'FAIL 9a SIM not in Sound Box kit'; end if;
  e := pg_temp.err($$select public.admin_sim_update('{"serial":"091 000 0003","status":"LOST"}')$$);
  if e not like 'INPUT: write a remark%' then raise exception 'FAIL 9b %', e; end if;
  v := public.admin_sim_update('{"serial":"091 000 0003","status":"LOST","note":"merchant closed, SIM missing","blocked_with_carrier":true}');
  if (pg_temp.sim('091 000 0003')).status <> 'LOST' or pg_temp.kit_sim('TST-SB-1') is not null
     or not exists (select 1 from public.material_lost where serial = '091 000 0003' and status = 'OPEN' and blocked_with_carrier and device_serial = 'TST-SB-1') then
    raise exception 'FAIL 9c lost item not opened'; end if; n := n + 1;

  -- 10. a lost SIM cannot be put back in use here
  e := pg_temp.err($$select public.admin_sim_update('{"serial":"091 000 0003","status":"BRANCH_RESERVE","branch_id":"905"}')$$);
  if e not like 'STOCK:%lost%Recover it in Lost Materials%' then raise exception 'FAIL 10 %', e; end if; n := n + 1;

  -- 11. written off: only lost / faulty, with a reason; closes the open Lost item; then never used again
  e := pg_temp.err($$select public.admin_sim_update('{"serial":"091 000 0001","status":"WRITTEN_OFF","note":"old"}')$$);
  if e not like 'STOCK: only a lost or faulty SIM%' then raise exception 'FAIL 11a %', e; end if;
  v := public.admin_sim_update('{"serial":"091 000 0003","status":"WRITTEN_OFF","note":"not found after 30 days"}');
  if (pg_temp.sim('091 000 0003')).status <> 'WRITTEN_OFF'
     or not exists (select 1 from public.material_lost where serial = '091 000 0003' and status = 'WRITTEN_OFF' and resolution = 'not found after 30 days') then
    raise exception 'FAIL 11b'; end if;
  e := pg_temp.err($$select public.admin_sim_update('{"serial":"091 000 0003","device_serial":"TST-POS-1"}')$$);
  if e not like 'STOCK:%written off%' then raise exception 'FAIL 11c %', e; end if; n := n + 1;

  -- 12. number corrected: the kit and lost records follow; a number already registered is refused
  v := public.admin_sim_update('{"serial":"091 000 0001","device_serial":"TST-POS-1"}');
  v := public.admin_sim_update('{"serial":"091 000 0001","new_serial":"091 000 0011"}');
  if pg_temp.sim('091 000 0001') is not null or (pg_temp.sim('091 000 0011')).status <> 'AT_MERCHANT' or pg_temp.kit_sim('TST-POS-1') <> '091 000 0011' then
    raise exception 'FAIL 12a rename'; end if;
  e := pg_temp.err($$select public.admin_sim_update('{"serial":"091 000 0011","new_serial":"091 000 0002"}')$$);
  if e not like 'INPUT: SIM 091 000 0002 is already registered%' then raise exception 'FAIL 12b %', e; end if; n := n + 1;

  -- 13. a SIM already at a merchant before the register existed can be recorded on its unit (no stock movement)
  v := public.admin_sim_update('{"serial":"092 000 0009","device_serial":"TST-POS-2","status":"AT_MERCHANT"}');
  if (pg_temp.sim('092 000 0009')).status <> 'AT_MERCHANT' or pg_temp.kit_sim('TST-POS-2') <> '092 000 0009'
     or not exists (select 1 from public.material_movements where serial = '092 000 0009' and kind = 'KIT_BASELINE') then
    raise exception 'FAIL 13'; end if; n := n + 1;

  -- 14. at a merchant needs a unit; an unknown unit is refused
  v := public.admin_sim_update('{"serial":"091 000 0002","status":"BRANCH_RESERVE","branch_id":"905"}');
  e := pg_temp.err($$select public.admin_sim_update('{"serial":"091 000 0002","status":"AT_MERCHANT"}')$$);
  if e not like 'INPUT: choose the unit%' then raise exception 'FAIL 14a %', e; end if;
  e := pg_temp.err($$select public.admin_sim_update('{"serial":"091 000 0002","device_serial":"NOPE-1"}')$$);
  if e not like 'INPUT: unit NOPE-1 is not in the inventory%' then raise exception 'FAIL 14b %', e; end if; n := n + 1;

  -- 15. Battery goes with a Sound Box now
  v := public.admin_kit_add('{"device_serial":"TST-SB-1","items":[{"code":"BATTERY","serial":"TSB-BAT-1"}]}');
  if not exists (select 1 from public.device_kits k, jsonb_array_elements(k.items) x where k.device_serial = 'TST-SB-1' and x->>'serial' = 'TSB-BAT-1') then
    raise exception 'FAIL 15 battery not added to Sound Box'; end if; n := n + 1;

  -- 16. every change is in the Audit Trail; nobody can write the SIM table directly
  if (select count(*) from public.audit_logs where action = 'SIM_MANAGE') < 10 then raise exception 'FAIL 16a audit'; end if;
  if has_table_privilege('authenticated', 'public.material_serials', 'UPDATE') or has_function_privilege('anon', 'public.admin_sim_update(jsonb)', 'EXECUTE') then
    raise exception 'FAIL 16b privileges'; end if; n := n + 1;

  raise notice 'TESTRESULT: all checks passed (%)', n;
end $t$;

rollback;

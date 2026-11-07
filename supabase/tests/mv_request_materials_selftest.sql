-- Self-test of 20261107_02_mv_request_materials.sql. Run in the Supabase SQL Editor AFTER the migration: everything
-- happens inside one transaction that is rolled back at the end, so no data is left behind. Expected:
--   NOTICE: TESTRESULT: all checks passed (16)
-- It uses a test branch 905 it creates itself, so it never touches real branches or requests.
begin;
insert into public.branches (id, name, code) values ('905', 'Self-test Branch 905', '905') on conflict (id) do nothing;
create or replace function pg_temp.err(q text) returns text language plpgsql as $$ begin execute q; return ''; exception when others then return sqlerrm; end $$;
do $t$
declare r jsonb; l jsonb; n int := 0; e text; v_before int := (select count(*) from public.requisitions where branch_id = '905');
begin
  -- 1. units only (old app call): works as before
  r := public.mv_req_submit('{"request_id":"a1","staff_id":"SELFTEST905","staff_name":"Staff","branch":"905","pos_qty":2,"sb_qty":0}');
  assert r->>'status' = 'PENDING_ADMIN' and r->'materials' = '{}'::jsonb, 'units only'; n := n + 1;
  -- 2. materials only
  r := public.mv_req_submit('{"request_id":"a2","staff_id":"SELFTEST905","staff_name":"Staff","branch":"905","materials":{"sim":"3","DOCK":2,"STAND":0,"SB_ADAPTOR":1}}');
  assert r->'materials' = '{"SIM":3,"DOCK":2,"SB_ADAPTOR":1}'::jsonb, 'materials only: ' || (r->'materials')::text; n := n + 1;
  assert (select materials from public.requisitions where req_id = r->>'req_id') = '{"SIM":3,"DOCK":2,"SB_ADAPTOR":1}'::jsonb, 'stored'; n := n + 1;
  assert (select detail from public.audit_logs where target = r->>'req_id') like '%Materials: SIM Card 3, Charging Dock 2, Sound Box AC Adaptor 1%', 'audit text'; n := n + 1;
  -- 3. both, and a retry gives the same request (no duplicate)
  r := public.mv_req_submit('{"request_id":"a3","staff_id":"SELFTEST905","staff_name":"Staff","branch":"905","pos_qty":1,"sb_qty":1,"materials":{"BATTERY":2,"POS_ADAPTOR":1}}');
  l := public.mv_req_submit('{"request_id":"a3","staff_id":"SELFTEST905","staff_name":"Staff","branch":"905","pos_qty":1,"sb_qty":1,"materials":{"BATTERY":2,"POS_ADAPTOR":1}}');
  assert (l->>'duplicate')::boolean and l->>'req_id' = r->>'req_id' and (select count(*) from public.requisitions where branch_id = '905') = v_before + 3, 'retry'; n := n + 1;
  -- 4. refusals
  e := pg_temp.err($$select public.mv_req_submit('{"request_id":"b1","staff_id":"SELFTEST905","branch":"905"}')$$);
  assert e like '%at least one POS Terminal, Sound Box or material%', 'empty: ' || e; n := n + 1;
  e := pg_temp.err($$select public.mv_req_submit('{"request_id":"b2","staff_id":"SELFTEST905","branch":"905","materials":{"DOCK":0,"SIM":0}}')$$);
  assert e like '%at least one%', 'all zero'; n := n + 1;
  e := pg_temp.err($$select public.mv_req_submit('{"request_id":"b5","staff_id":"SELFTEST905","branch":"905","materials":{"DOCK":101}}')$$);
  assert e like '%at most 100 Charging Dock%', 'cap: ' || e; n := n + 1;
  e := pg_temp.err($$select public.mv_req_submit('{"request_id":"b6","staff_id":"SELFTEST905","branch":"905","materials":{"DOCK":"-2"}}')$$);
  assert e like '%whole number%', 'negative: ' || e; n := n + 1;
  e := pg_temp.err($$select public.mv_req_submit('{"request_id":"b7","staff_id":"SELFTEST905","branch":"905","materials":{"DOCK":"1.5"}}')$$);
  assert e like '%whole number%', 'decimal'; n := n + 1;
  r := public.mv_req_submit('{"request_id":"b8","staff_id":"SELFTEST905","staff_name":"Staff","branch":"905","pos_qty":1,"materials":"bad"}');
  assert r->'materials' = '{}'::jsonb, 'non-object materials ignored'; n := n + 1;
  assert (select count(*) from public.requisitions where branch_id = '905') = v_before + 4, 'refused requests not saved'; n := n + 1;
  -- 5. list: materials, materials_sent, catalogue (active only, in order)
  update public.requisitions set materials_sent = '{"qty":{"DOCK":2},"serials":{"SIM":["096 555 0142"]}}' where branch_id = '905' and materials ? 'DOCK';
  l := public.mv_req_list('{"branch":"905"}');
  assert jsonb_array_length(l->'requests') = v_before + 4, 'list count'; n := n + 1;
  assert (select count(*) from jsonb_array_elements(l->'requests') x where x->'materials' ? 'DOCK' and x->'materials_sent'->'qty'->>'DOCK' = '2') = 1, 'list materials + sent'; n := n + 1;
  assert (select string_agg(x->>'code', ',') from jsonb_array_elements(l->'materials') x) = 'SIM,BATTERY,POS_ADAPTOR,STAND,DOCK,SB_ADAPTOR', 'catalogue'; n := n + 1;
  assert l->'materials'->0->>'device' = 'BOTH' and l->'materials'->5->>'device' = 'SB', 'catalogue device'; n := n + 1;
  raise notice 'TESTRESULT: all checks passed (%)', n;
end $t$;
rollback;

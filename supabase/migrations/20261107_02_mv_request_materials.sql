-- 07 Nov 2026 · Merchant Visit app → Request: branch staff can also request the POS / Sound Box materials.
-- Not yet applied: run in the Supabase SQL Editor (safe to run again).
--
-- The portal already keeps materials on a stock request (requisitions.materials {CODE: qty}), dispatches them with
-- admin_dispatch_request and moves them into the branch reserve on receipt (mv_req_confirm → app.material_receive).
-- Only the app's request functions did not know them. This update:
--   mv_req_submit  + materials {CODE: qty} (active catalogue items only, 0..100 each). A request may be units only,
--                    materials only, or both. A call without materials (Merchant Visit before 3.84) works as before.
--   mv_req_list    + each request's materials and materials_sent, and the catalogue (what the app offers).
-- No table change. Both functions stay service-key only (the Merchant Visit server), as before.

create or replace function public.mv_req_submit(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req   text := left(btrim(coalesce(p->>'request_id', '')), 80);
  v_sid   text := left(btrim(coalesce(p->>'staff_id', '')), 40);
  v_sname text := left(btrim(coalesce(p->>'staff_name', '')), 120);
  v_bid   varchar := app.resolve_branch(p->>'branch');
  v_bname text;
  v_pos   int := least(greatest(coalesce(nullif(p->>'pos_qty', '')::int, 0), 0), 50);
  v_sb    int := least(greatest(coalesce(nullif(p->>'sb_qty', '')::int, 0), 0), 50);
  v_reason text := left(btrim(coalesce(p->>'reason', '')), 500);
  v_in    jsonb := case when jsonb_typeof(p->'materials') = 'object' then p->'materials' else '{}'::jsonb end;
  v_mat   jsonb := '{}'::jsonb;
  v_mtxt  text := '';
  k text; v text; n int; t public.material_types;
  v_id    text;
  v_new   boolean := false;
  r public.requisitions;
begin
  if v_sid = '' or v_req = '' then raise exception 'INPUT: staff and request id are required.' using errcode = '22023'; end if;
  if v_bid is null then raise exception 'BRANCH_UNKNOWN: branch "%" is not in the inventory.', p->>'branch' using errcode = '22023'; end if;
  -- materials: known, active catalogue items; a whole number 0..100 each; zeros dropped
  for k, v in select upper(btrim(key)), btrim(value) from jsonb_each_text(v_in) loop
    if v !~ '^\d{1,4}$' then raise exception 'INPUT: the quantity of % must be a whole number.', k using errcode = '22023'; end if;
    n := v::int;
    if n = 0 then continue; end if;
    select * into t from public.material_types m where m.code = k and coalesce(m.active, true);
    if not found then raise exception 'INPUT: % is not a material that can be requested.', k using errcode = '22023'; end if;
    if n > 100 then raise exception 'INPUT: at most 100 % per request.', t.name using errcode = '22023'; end if;
    v_mat := v_mat || jsonb_build_object(t.code, n);
  end loop;
  if v_pos + v_sb <= 0 and v_mat = '{}'::jsonb then
    raise exception 'INPUT: enter at least one POS Terminal, Sound Box or material.' using errcode = '22023';
  end if;
  select coalesce(string_agg(m.name || ' ' || (v_mat->>m.code), ', ' order by m.sort), '') into v_mtxt
    from public.material_types m where v_mat ? m.code;
  select b.name into v_bname from public.branches b where b.id = v_bid;
  -- the same phone request always gets the same id: a retry (weak signal) never creates a second request
  v_id := 'REQ-' || to_char(now() at time zone 'Asia/Phnom_Penh', 'YYYYMMDD') || '-' || upper(substr(md5(v_sid || '|' || v_req), 1, 6));
  insert into public.requisitions (req_id, date, branch_id, branch_name, staff, pos_qty, sb_qty, reason, status, type, materials)
  values (v_id, app.stamp(), v_bid, coalesce(v_bname, 'Branch ' || v_bid), v_sname || ' (' || v_sid || ')', v_pos, v_sb,
          coalesce(nullif(v_reason, ''), 'Branch reserve stock replenishment'), 'PENDING_ADMIN', 'STOCK_REQUEST', v_mat)
  on conflict (req_id) do nothing
  returning true into v_new;
  select * into r from public.requisitions where req_id = v_id;
  if coalesce(v_new, false) then
    insert into public.audit_logs (title, detail, branch_id, action, target, actor_name)
    values ('Stock Request (Merchant Visit app)', 'Request ' || v_id || ': POS ' || v_pos || ', Sound Box ' || v_sb
            || coalesce(' · Materials: ' || nullif(v_mtxt, ''), '')
            || ' for Branch Code ' || v_bid || coalesce(' · ' || nullif(v_reason, ''), ''), v_bid, 'STOCK_REQUEST', v_id,
            v_sname || ' (' || v_sid || ') via Merchant Visit');
  end if;
  return jsonb_build_object('req_id', r.req_id, 'status', r.status, 'duplicate', not coalesce(v_new, false),
                            'branch_id', r.branch_id, 'branch_name', r.branch_name, 'date', r.date,
                            'materials', coalesce(r.materials, '{}'::jsonb));
end $$;

create or replace function public.mv_req_list(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_bid varchar := app.resolve_branch(p->>'branch');
  v_lim int := least(greatest(coalesce(nullif(p->>'limit', '')::int, 15), 1), 40);
  v_rows jsonb;
  v_cat jsonb;
begin
  if v_bid is null then raise exception 'BRANCH_UNKNOWN: branch "%" is not in the inventory.', p->>'branch' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into v_rows from (
    select r.req_id, r.date, r.status, r.pos_qty, r.sb_qty, r.reason, r.staff, r.reject_reason, r.created_at, r.updated_at,
           coalesce((select jsonb_agg(jsonb_build_object('serial', a->>'serial', 'type', a->>'type'))
                       from jsonb_array_elements(coalesce(r.arranged_devices, '[]'::jsonb)) a), '[]'::jsonb) as devices,
           coalesce(r.materials, '{}'::jsonb) as materials,
           coalesce(r.materials_sent, '{}'::jsonb) as materials_sent
      from public.requisitions r
     where r.branch_id = v_bid and coalesce(r.type, 'STOCK_REQUEST') = 'STOCK_REQUEST'
     order by r.created_at desc nulls last
     limit v_lim) x;
  select coalesce(jsonb_agg(jsonb_build_object('code', m.code, 'name', m.name, 'device', m.device_type, 'tracking', m.tracking) order by m.sort), '[]'::jsonb)
    into v_cat from public.material_types m where coalesce(m.active, true);
  return jsonb_build_object('branch_id', v_bid, 'branch_name', (select b.name from public.branches b where b.id = v_bid),
                            'requests', v_rows, 'materials', v_cat);
end $$;

revoke all on function public.mv_req_submit(jsonb), public.mv_req_list(jsonb) from public, anon, authenticated;
grant execute on function public.mv_req_submit(jsonb), public.mv_req_list(jsonb) to service_role;

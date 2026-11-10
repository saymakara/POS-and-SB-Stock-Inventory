-- 10 Nov 2026 · Merchant Visit app (3.97) → Request: each staff member sees and handles only their OWN stock requests.
-- Not yet applied: run in the Supabase SQL Editor (safe to run again). Needs 20261108_02_mv_request_edit.sql first.
--
-- A request made in the app stores its requester as "NAME (STAFF_ID)" in requisitions.staff (mv_req_submit).
--  - mv_req_list:    with p.staff_id, only that staff member's requests of the branch (the latest 40 of THEIR requests).
--                    Without staff_id (Merchant Visit 3.96 and older) it still lists the branch, as before.
--  - mv_req_edit:    only the requester may correct a waiting request (OTHER_STAFF otherwise).
--  - mv_req_confirm: only the requester may confirm receipt in the app (OTHER_STAFF otherwise). Admin HQ can still
--                    mark any request as received in the portal (Stock Requests), e.g. when the requester is absent.
-- No table change; the portal screens are not affected. Service-key only, as the other mv_req_* functions.

create or replace function app.mv_req_is_own(p_staff text, p_sid text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(btrim(p_sid), '') <> ''
     and right(coalesce(p_staff, ''), length(btrim(p_sid)) + 3) = ' (' || btrim(p_sid) || ')';
$$;
revoke all on function app.mv_req_is_own(text, text) from public, anon, authenticated;
grant execute on function app.mv_req_is_own(text, text) to service_role;

create or replace function public.mv_req_list(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_bid varchar := app.resolve_branch(p->>'branch');
  v_sid text := left(btrim(coalesce(p->>'staff_id', '')), 40);
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
       and (v_sid = '' or app.mv_req_is_own(r.staff, v_sid))
     order by r.created_at desc nulls last
     limit v_lim) x;
  select coalesce(jsonb_agg(jsonb_build_object('code', m.code, 'name', m.name, 'device', m.device_type, 'tracking', m.tracking) order by m.sort), '[]'::jsonb)
    into v_cat from public.material_types m where coalesce(m.active, true);
  return jsonb_build_object('branch_id', v_bid, 'branch_name', (select b.name from public.branches b where b.id = v_bid),
                            'requests', v_rows, 'materials', v_cat, 'own', v_sid <> '');
end $$;

create or replace function public.mv_req_edit(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    text := left(btrim(coalesce(p->>'req_id', '')), 40);
  v_sid   text := left(btrim(coalesce(p->>'staff_id', '')), 40);
  v_sname text := left(btrim(coalesce(p->>'staff_name', '')), 120);
  v_bid   varchar := app.resolve_branch(p->>'branch');
  v_pos   int := least(greatest(coalesce(nullif(p->>'pos_qty', '')::int, 0), 0), 50);
  v_sb    int := least(greatest(coalesce(nullif(p->>'sb_qty', '')::int, 0), 0), 50);
  v_reason text := left(btrim(coalesce(p->>'reason', '')), 500);
  v_in    jsonb := case when jsonb_typeof(p->'materials') = 'object' then p->'materials' else '{}'::jsonb end;
  v_mat   jsonb := '{}'::jsonb;
  k text; v text; n int; t public.material_types;
  r public.requisitions;
  v_was text; v_now text;
begin
  if v_sid = '' or v_id = '' then raise exception 'INPUT: staff and request id are required.' using errcode = '22023'; end if;
  if v_bid is null then raise exception 'BRANCH_UNKNOWN: branch "%" is not in the inventory.', p->>'branch' using errcode = '22023'; end if;
  select * into r from public.requisitions where req_id = v_id for update;
  if not found or r.branch_id is distinct from v_bid or coalesce(r.type, 'STOCK_REQUEST') <> 'STOCK_REQUEST' then
    raise exception 'NOT_FOUND: request % is not a stock request of this branch.', v_id using errcode = '22023';
  end if;
  if not app.mv_req_is_own(r.staff, v_sid) then
    raise exception 'OTHER_STAFF: request % was made by another staff member.', v_id using errcode = '42501';
  end if;
  if r.status <> 'PENDING_ADMIN' then
    raise exception 'STATE: request % is already % - it can no longer be changed.', v_id, r.status using errcode = '22023';
  end if;
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
  v_was := 'POS ' || coalesce(r.pos_qty, 0) || ', Sound Box ' || coalesce(r.sb_qty, 0) || coalesce(' · ' || nullif((
             select string_agg(m.name || ' ' || (coalesce(r.materials, '{}'::jsonb)->>m.code), ', ' order by m.sort)
               from public.material_types m where coalesce(r.materials, '{}'::jsonb) ? m.code), ''), '');
  v_now := 'POS ' || v_pos || ', Sound Box ' || v_sb || coalesce(' · ' || nullif((
             select string_agg(m.name || ' ' || (v_mat->>m.code), ', ' order by m.sort)
               from public.material_types m where v_mat ? m.code), ''), '');
  update public.requisitions
     set pos_qty = v_pos, sb_qty = v_sb, materials = v_mat,
         reason = coalesce(nullif(v_reason, ''), r.reason), updated_at = now()
   where req_id = v_id
  returning * into r;
  insert into public.audit_logs (title, detail, branch_id, action, target, actor_name, status)
  values ('Stock Request corrected (Merchant Visit app)', 'Request ' || v_id || ': ' || v_was || ' → ' || v_now
          || coalesce(' · ' || nullif(v_reason, ''), ''), v_bid, 'STOCK_REQUEST_EDIT', v_id,
          v_sname || ' (' || v_sid || ') via Merchant Visit', 'Success');
  return jsonb_build_object('req_id', r.req_id, 'status', r.status, 'branch_id', r.branch_id, 'date', r.date,
                            'pos_qty', r.pos_qty, 'sb_qty', r.sb_qty, 'reason', r.reason,
                            'materials', coalesce(r.materials, '{}'::jsonb));
end $$;

create or replace function public.mv_req_confirm(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id  text := btrim(coalesce(p->>'req_id', ''));
  v_sid text := left(btrim(coalesce(p->>'staff_id', '')), 40);
  v_bid varchar := app.resolve_branch(p->>'branch');
  v_by  text := left(btrim(coalesce(p->>'staff_name', '')), 120) || ' (' || v_sid || ')';
  r public.requisitions; d public.devices; it jsonb;
  v_moved text[] := '{}'; v_skip text[] := '{}';
begin
  if v_bid is null then raise exception 'BRANCH_UNKNOWN: branch "%" is not in the inventory.', p->>'branch' using errcode = '22023'; end if;
  perform set_config('app.trusted_change', 'on', true);
  select * into r from public.requisitions where req_id = v_id for update;
  if not found then raise exception 'NOT_FOUND: request % not found.', v_id using errcode = '22023'; end if;
  if r.branch_id is distinct from v_bid then raise exception 'OTHER_BRANCH: this request belongs to another branch.' using errcode = '42501'; end if;
  if coalesce(r.type, 'STOCK_REQUEST') <> 'STOCK_REQUEST' then raise exception 'NOT_REQUEST: request % is a stock return.', v_id using errcode = '22023'; end if;
  if not app.mv_req_is_own(r.staff, v_sid) then
    raise exception 'OTHER_STAFF: request % was made by another staff member.', v_id using errcode = '42501';
  end if;
  if r.status = 'RECEIVED' then return jsonb_build_object('moved', '[]'::jsonb, 'skipped', '[]'::jsonb, 'already', true); end if;
  if r.status <> 'DISPATCHED' then raise exception 'NOT_DISPATCHED: request % is not dispatched yet (status %).', v_id, r.status using errcode = '22023'; end if;
  for it in select * from jsonb_array_elements(coalesce(r.arranged_devices, '[]'::jsonb)) loop
    select * into d from public.devices where serial = it->>'serial' for update;
    if found and d.stage = 'HQ_STOCK' and not coalesce(d.archived, false)
       and coalesce(d.custom_fields->>'allocatedTo', r.req_id) = r.req_id then
      update public.devices set stage = 'BRANCH_RESERVE', branch_id = r.branch_id, branch_name = r.branch_name,
        mid = null, tid = null, merchant_name = null, merchant_phone = null, address = null,
        deployment_status = 'In-Stock (Reserve)', stock_status = 'In-Stock',
        custom_fields = coalesce(custom_fields, '{}'::jsonb) - 'allocatedTo',
        history = jsonb_build_array(app.stamp() || ' | Received at Branch | Request ' || r.req_id || ' confirmed by ' || v_by || ' (Merchant Visit app)')
                  || coalesce(history, '[]'::jsonb)
      where serial = d.serial;
      v_moved := v_moved || d.serial;
    else
      v_skip := v_skip || (it->>'serial');
    end if;
  end loop;
  perform app.material_receive(r.req_id, v_by || ' (Merchant Visit app)');
  update public.requisitions set status = 'RECEIVED' where req_id = r.req_id;
  insert into public.audit_logs (title, detail, branch_id, action, target, actor_name)
  values ('Stock Received (Merchant Visit app)', 'Request ' || r.req_id || ': ' || cardinality(v_moved) || ' unit(s) received'
          || case when cardinality(v_skip) > 0 then '; not moved (no longer allocated in HQ stock): ' || array_to_string(v_skip, ', ') else '' end,
          r.branch_id, 'STOCK_RECEIVE', r.req_id, v_by || ' via Merchant Visit');
  return jsonb_build_object('moved', to_jsonb(v_moved), 'skipped', to_jsonb(v_skip));
end $$;

revoke all on function public.mv_req_list(jsonb) from public, anon, authenticated;
revoke all on function public.mv_req_edit(jsonb) from public, anon, authenticated;
revoke all on function public.mv_req_confirm(jsonb) from public, anon, authenticated;
grant execute on function public.mv_req_list(jsonb) to service_role;
grant execute on function public.mv_req_edit(jsonb) to service_role;
grant execute on function public.mv_req_confirm(jsonb) to service_role;

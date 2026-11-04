-- 04 Nov 2026 · Stock requests from the Merchant Visit app (Telegram form) into Stock Requests.
--
-- Branch staff can now ask for POS Terminals / Sound Boxes from the Merchant Visit app, see the status of their branch's
-- requests (waiting / dispatched with serials / received / rejected) and confirm receipt there. Admin HQ dispatches in
-- the inventory dashboard exactly as before (admin_dispatch_requisition) - the request is an ordinary STOCK_REQUEST row.
--
-- Three functions, called ONLY by the Merchant Visit server (Apps Script) with the service key, never by a browser:
-- EXECUTE is revoked from PUBLIC / anon / authenticated, as for qr_submit and cc_submit. The Merchant Visit server checks
-- the staff member's session first and passes the branch from its Staff tab; the branch is resolved here with
-- app.resolve_branch (code or name), so a staff member only ever sees and confirms their own branch's requests.
--
--   mv_req_submit(p)  {request_id, staff_id, staff_name, branch, pos_qty, sb_qty, reason}
--                     -> {req_id, status, duplicate}. Same request_id again: the same request (never twice).
--   mv_req_list(p)    {branch, limit} -> {branch_id, branch_name, requests: [...]} (newest first, stock requests only)
--   mv_req_confirm(p) {req_id, branch, staff_id, staff_name} -> {moved, skipped}: the same rules as
--                     branch_confirm_receipt (only units still allocated to this request in HQ stock move to the branch).
-- Additive only: no table or existing function is changed.

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
  v_id    text;
  v_new   boolean := false;
  r public.requisitions;
begin
  if v_sid = '' or v_req = '' then raise exception 'INPUT: staff and request id are required.' using errcode = '22023'; end if;
  if v_bid is null then raise exception 'BRANCH_UNKNOWN: branch "%" is not in the inventory.', p->>'branch' using errcode = '22023'; end if;
  if v_pos + v_sb <= 0 then raise exception 'INPUT: enter at least one POS Terminal or Sound Box.' using errcode = '22023'; end if;
  select b.name into v_bname from public.branches b where b.id = v_bid;
  -- the same phone request always gets the same id: a retry (weak signal) never creates a second request
  v_id := 'REQ-' || to_char(now() at time zone 'Asia/Phnom_Penh', 'YYYYMMDD') || '-' || upper(substr(md5(v_sid || '|' || v_req), 1, 6));
  insert into public.requisitions (req_id, date, branch_id, branch_name, staff, pos_qty, sb_qty, reason, status, type)
  values (v_id, app.stamp(), v_bid, coalesce(v_bname, 'Branch ' || v_bid), v_sname || ' (' || v_sid || ')', v_pos, v_sb,
          coalesce(nullif(v_reason, ''), 'Branch reserve stock replenishment'), 'PENDING_ADMIN', 'STOCK_REQUEST')
  on conflict (req_id) do nothing
  returning true into v_new;
  select * into r from public.requisitions where req_id = v_id;
  if coalesce(v_new, false) then
    insert into public.audit_logs (title, detail, branch_id, action, target, actor_name)
    values ('Stock Request (Merchant Visit app)', 'Request ' || v_id || ': POS ' || v_pos || ', Sound Box ' || v_sb
            || ' for Branch Code ' || v_bid || coalesce(' · ' || nullif(v_reason, ''), ''), v_bid, 'STOCK_REQUEST', v_id,
            v_sname || ' (' || v_sid || ') via Merchant Visit');
  end if;
  return jsonb_build_object('req_id', r.req_id, 'status', r.status, 'duplicate', not coalesce(v_new, false),
                            'branch_id', r.branch_id, 'branch_name', r.branch_name, 'date', r.date);
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
begin
  if v_bid is null then raise exception 'BRANCH_UNKNOWN: branch "%" is not in the inventory.', p->>'branch' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into v_rows from (
    select r.req_id, r.date, r.status, r.pos_qty, r.sb_qty, r.reason, r.staff, r.reject_reason, r.created_at, r.updated_at,
           coalesce((select jsonb_agg(jsonb_build_object('serial', a->>'serial', 'type', a->>'type'))
                       from jsonb_array_elements(coalesce(r.arranged_devices, '[]'::jsonb)) a), '[]'::jsonb) as devices
      from public.requisitions r
     where r.branch_id = v_bid and coalesce(r.type, 'STOCK_REQUEST') = 'STOCK_REQUEST'
     order by r.created_at desc nulls last
     limit v_lim) x;
  return jsonb_build_object('branch_id', v_bid, 'branch_name', (select b.name from public.branches b where b.id = v_bid), 'requests', v_rows);
end $$;

create or replace function public.mv_req_confirm(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id  text := btrim(coalesce(p->>'req_id', ''));
  v_bid varchar := app.resolve_branch(p->>'branch');
  v_by  text := left(btrim(coalesce(p->>'staff_name', '')), 120) || ' (' || left(btrim(coalesce(p->>'staff_id', '')), 40) || ')';
  r public.requisitions; d public.devices; it jsonb;
  v_moved text[] := '{}'; v_skip text[] := '{}';
begin
  if v_bid is null then raise exception 'BRANCH_UNKNOWN: branch "%" is not in the inventory.', p->>'branch' using errcode = '22023'; end if;
  perform set_config('app.trusted_change', 'on', true);
  select * into r from public.requisitions where req_id = v_id for update;
  if not found then raise exception 'NOT_FOUND: request % not found.', v_id using errcode = '22023'; end if;
  if r.branch_id is distinct from v_bid then raise exception 'OTHER_BRANCH: this request belongs to another branch.' using errcode = '42501'; end if;
  if coalesce(r.type, 'STOCK_REQUEST') <> 'STOCK_REQUEST' then raise exception 'NOT_REQUEST: request % is a stock return.', v_id using errcode = '22023'; end if;
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
  update public.requisitions set status = 'RECEIVED' where req_id = r.req_id;
  insert into public.audit_logs (title, detail, branch_id, action, target, actor_name)
  values ('Stock Received (Merchant Visit app)', 'Request ' || r.req_id || ': ' || cardinality(v_moved) || ' unit(s) received'
          || case when cardinality(v_skip) > 0 then '; not moved (no longer allocated in HQ stock): ' || array_to_string(v_skip, ', ') else '' end,
          r.branch_id, 'STOCK_RECEIVE', r.req_id, v_by || ' via Merchant Visit');
  return jsonb_build_object('moved', to_jsonb(v_moved), 'skipped', to_jsonb(v_skip));
end $$;

revoke all on function public.mv_req_submit(jsonb), public.mv_req_list(jsonb), public.mv_req_confirm(jsonb) from public, anon, authenticated;
grant execute on function public.mv_req_submit(jsonb), public.mv_req_list(jsonb), public.mv_req_confirm(jsonb) to service_role;

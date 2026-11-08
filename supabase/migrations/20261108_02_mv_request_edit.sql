-- 08 Nov 2026 · Merchant Visit app (3.95) → Request: branch staff can correct a stock request that is still waiting.
-- Not yet applied: run in the Supabase SQL Editor (safe to run again).
--
-- mv_req_edit(p) changes POS / Sound Box quantities, materials and the reason of a request that is still PENDING_ADMIN,
-- for the same branch only (the Merchant Visit server checks the staff member's session first). The same rules as a
-- new request (mv_req_submit): POS / Sound Box 0..50, materials = active catalogue items 0..100 each, at least one thing.
-- Once Admin HQ has dispatched or rejected a request it can no longer be changed (STATE error). Every change is written
-- to audit_logs with the old and new lines. No table change; service-key only (the Merchant Visit server), as the
-- other mv_req_* functions.

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

revoke all on function public.mv_req_edit(jsonb) from public, anon, authenticated;
grant execute on function public.mv_req_edit(jsonb) to service_role;

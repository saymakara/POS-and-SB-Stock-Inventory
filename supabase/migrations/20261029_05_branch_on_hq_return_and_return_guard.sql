-- 29 Oct 2026 · Two logic fixes found in the system review. Safe to run more than once.
--
-- 1) field_approve: when a returned Sound Box (SB_RETURN) or a replaced POS/Sound Box (REPLACE, old unit) is sent to HQ_STOCK,
--    the unit kept its old branch (e.g. "Borei Keyla"), so it was counted under that branch although it was at Head Office.
--    It now moves to Branch Code 100 / Head Office, the same as a return approved in admin_receive_return.
-- 2) admin_receive_return: a return where NO unit could be moved (all skipped) was still marked RECEIVED and the branch
--    believed it was done. It now stays PENDING_ADMIN with a clear message, so the admin can fix it or reject it.
--    Also a request without a type can no longer be treated as a return.
do $do$
declare
  d text; n int;
  p1 constant text := 'set stage = v_ret, mid = null';
  r1 constant text := 'set stage = v_ret, branch_id = case when v_ret = ''HQ_STOCK'' then ''100'' else branch_id end, branch_name = case when v_ret = ''HQ_STOCK'' then ''Head Office'' else branch_name end, mid = null';
  p2 constant text := 'if r.type <> ''STOCK_RETURN'' then';
  r2 constant text := 'if coalesce(r.type, '''') <> ''STOCK_RETURN'' then';
  p3 constant text := 'update public.requisitions set status = ''RECEIVED'' where req_id = r.req_id;';
  r3 constant text := 'if cardinality(v_moved) = 0 then raise exception ''Nothing was received: %.'', coalesce(nullif(array_to_string(v_skip, ''; ''), ''''), ''the return lists no units'') using errcode = ''22023''; end if;' || chr(10) || '  ' || 'update public.requisitions set status = ''RECEIVED'' where req_id = r.req_id;';
begin
  d := pg_get_functiondef('public.field_approve(bigint,text,jsonb)'::regprocedure);
  if position('branch_name = case when v_ret' in d) = 0 then
    n := (length(d) - length(replace(d, p1, ''))) / length(p1);
    if n <> 2 then raise exception 'field_approve: expected 2 places, found %', n; end if;
    execute replace(d, p1, r1);
  end if;

  d := pg_get_functiondef('public.admin_receive_return(text,text)'::regprocedure);
  if position('Nothing was received' in d) = 0 then
    if position(p2 in d) = 0 or position(p3 in d) = 0 then raise exception 'admin_receive_return: text to change not found'; end if;
    execute replace(replace(d, p2, r2), p3, r3);
  end if;
end $do$;

-- data fix: the one unit that was already in this state (HQ stock but listed under a branch)
update public.devices
   set branch_id = '100', branch_name = 'Head Office',
       history = jsonb_build_array(to_char(now() at time zone 'Asia/Phnom_Penh', 'YYYY-MM-DD HH24:MI') || ' | Branch corrected | Unit is in HQ stock: moved to Branch Code 100 (Head Office) by system review') || coalesce(history, '[]'::jsonb)
 where serial = '00078077638' and stage = 'HQ_STOCK' and branch_id <> '100';

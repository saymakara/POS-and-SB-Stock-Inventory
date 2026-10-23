-- 23 Oct 2026 · Admin HQ can reject a pending stock request (no stock, or another proper reason).
-- A rejected request keeps the reason, who rejected it and when; it can no longer be dispatched. Audit entry written.
alter table public.requisitions
  add column if not exists reject_reason text,
  add column if not exists rejected_by text,
  add column if not exists rejected_at timestamptz;

create or replace function public.admin_reject_requisition(p_req_id text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.requisitions; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not app.is_admin() then raise exception 'Only HQ admins can reject a request.' using errcode = '42501'; end if;
  if char_length(v_reason) < 3 then raise exception 'Write the reason for rejecting this request.' using errcode = '22023'; end if;
  perform set_config('app.trusted_change', 'on', true);
  select * into r from public.requisitions where req_id = p_req_id for update;
  if not found then raise exception 'Request % not found.', p_req_id; end if;
  if r.status <> 'PENDING_ADMIN' then raise exception 'Request % is already % and cannot be rejected.', p_req_id, r.status; end if;
  update public.requisitions
     set status = 'REJECTED', reject_reason = left(v_reason, 500), rejected_by = coalesce(app.label(), 'admin'), rejected_at = now()
   where req_id = r.req_id;
  insert into public.audit_logs (title, detail, branch_id, action, target)
  values ('Requisition Rejected', 'Request ' || r.req_id || ' from Branch Code ' || r.branch_id || ' rejected: ' || left(v_reason, 500),
          r.branch_id, 'STOCK_REJECT', r.req_id);
  return jsonb_build_object('status', 'REJECTED');
end $$;
revoke all on function public.admin_reject_requisition(text, text) from public, anon;
grant execute on function public.admin_reject_requisition(text, text) to authenticated;

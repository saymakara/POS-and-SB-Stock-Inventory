-- (19 Nov 2026) Allow cc_list p_branch to filter by Phnom Penh ('__PHNOM_PENH__') or Regional ('__REGIONAL__') branches
create or replace function public.cc_list(
  p_from timestamp with time zone default null::timestamp with time zone,
  p_to timestamp with time zone default null::timestamp with time zone,
  p_review text default null::text,
  p_branch text default null::text,
  p_search text default null::text,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
set statement_timeout to '30s'
as $function$
declare
  v_admin boolean := app.is_admin();
  v_branch text := app.branch();
  v_total int;
  v_rows jsonb;
  v_q text;
  v_pp_codes text[] := array[
    '100','101','102','103','104','105','106','107','108','109',
    '110','111','112','113','114','115','116','117','118','119',
    '120','121','122','123','124','125','126','127','128','129',
    '130','131','132','133','134','801'
  ];
begin
  if not v_admin and v_branch is null then raise exception 'Not signed in.' using errcode = '42501'; end if;
  v_q := nullif(trim(coalesce(p_search, '')), '');
  with f as (
    select * from public.cc_entries e
     where (v_admin or e.branch_id::text = v_branch)
       and (p_from is null or e.submitted_at >= p_from) and (p_to is null or e.submitted_at < p_to)
       and (p_review is null or p_review = '' or (p_review = 'WAITING_DOCS' and e.review_status = 'PENDING' and e.doc_status = 'WAITING') or e.review_status = p_review)
       and (
         p_branch is null or p_branch = ''
         or (p_branch = '__PHNOM_PENH__' and e.branch_id::text = any(v_pp_codes))
         or (p_branch = '__REGIONAL__' and (e.branch_id is null or not (e.branch_id::text = any(v_pp_codes))))
         or e.branch_id::text = p_branch
       )
       and (v_q is null or e.record_id ilike '%' || v_q || '%' or e.full_name ilike '%' || v_q || '%' or e.staff_name ilike '%' || v_q || '%'
            or e.staff_id = v_q or e.contact like '%' || v_q || '%' or (v_admin and e.primary_acc like '%' || v_q || '%')))
  select (select count(*) from f),
         coalesce((select jsonb_agg(x order by x->>'submitted_at' desc, (x->>'id')::bigint desc) from (
           select jsonb_build_object('id', id, 'record_id', record_id, 'request_type', request_type, 'card_status', card_status,
             'fail_reason', fail_reason, 'full_name', full_name, 'contact', contact, 'marital', marital,
             'primary_acc', case when v_admin then primary_acc else app.mask_acc(primary_acc) end,
             'mid_or_acc', case when v_admin or mid_or_acc ~ '^\d{15}$' then mid_or_acc else app.mask_acc(mid_or_acc) end,
             'limit_usd', limit_usd, 'repayment', repayment, 'email', email,
             'supplementary', case when v_admin then supplementary else coalesce((select jsonb_agg(s || jsonb_build_object('account', app.mask_acc(s->>'account')))
                                 from jsonb_array_elements(supplementary) s), '[]'::jsonb) end,
             'remarks', remarks, 'photo_count', photo_count, 'staff_id', staff_id, 'staff_name', staff_name, 'branch_text', branch_text,
             'branch_id', branch_id, 'submitted_at', submitted_at, 'edited_at', edited_at, 'review_status', review_status,
             'review_reason', review_reason, 'review_note', review_note, 'reviewed_by', reviewed_by, 'reviewed_at', reviewed_at,
             'review_history', review_history, 'notify_state', notify_state, 'notified_at', notified_at,
             'doc_status', doc_status, 'doc_since', doc_since, 'doc_followups', doc_followups, 'doc_last_followup', doc_last_followup,
             'telegram_link', case when tg_chat ~ '^-100\d+$' and tg_msg is not null then 'https://t.me/c/' || substr(tg_chat, 5) || '/' || tg_msg end) x
             from f order by submitted_at desc, id desc limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) t), '[]'::jsonb)
    into v_total, v_rows;
  return jsonb_build_object('total', v_total, 'rows', v_rows, 'masked', not v_admin);
end $function$;

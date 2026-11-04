-- 04 Nov 2026 · Merchant visits in batches: the daily "check & resend" (and the first catch-up after deploying) sends many
-- visits at once; one call per visit would exceed Google's 6-minute limit. {items: [visit, ...]} (max 200) -> {done, failed}.
-- Each item goes through mv_visit_sync (same rules); one bad item never stops the others. Service key only.
create or replace function public.mv_visit_sync_many(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare it jsonb; v_done int := 0; v_failed jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p->'items') <> 'array' then raise exception 'INPUT: items must be a list.' using errcode = '22023'; end if;
  if jsonb_array_length(p->'items') > 200 then raise exception 'INPUT: at most 200 visits per call.' using errcode = '22023'; end if;
  for it in select * from jsonb_array_elements(p->'items') loop
    begin
      perform public.mv_visit_sync(it);
      v_done := v_done + 1;
    exception when others then
      v_failed := v_failed || jsonb_build_object('record_id', it->>'record_id', 'error', left(sqlerrm, 200));
    end;
  end loop;
  return jsonb_build_object('done', v_done, 'failed', v_failed);
end $$;
revoke all on function public.mv_visit_sync_many(jsonb) from public, anon, authenticated;
grant execute on function public.mv_visit_sync_many(jsonb) to service_role;

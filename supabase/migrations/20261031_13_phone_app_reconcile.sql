-- 13 (31 Oct 2026) Phone app ↔ inventory check. The Merchant Visit Apps Script (service key) asks which of its recent
-- Record IDs the inventory already has, and sends again the ones that are missing (menu "Stock inventory: check & resend
-- missing entries", and every night). Read-only: returns only Record IDs.
create or replace function public.field_known_records(p jsonb)
returns jsonb language sql stable security definer set search_path = '' as $$
  with ids as (select distinct jsonb_array_elements_text(case when jsonb_typeof(p->'ids') = 'array' then p->'ids' else '[]'::jsonb end) as id)
  select jsonb_build_object('known', coalesce(jsonb_agg(ids.id), '[]'::jsonb))
    from ids
   where exists (select 1 from public.field_events e where e.source_record_id = ids.id)
      or exists (select 1 from public.cc_entries c where c.record_id = ids.id)
$$;
revoke all on function public.field_known_records(jsonb) from public, anon, authenticated;
grant execute on function public.field_known_records(jsonb) to service_role;

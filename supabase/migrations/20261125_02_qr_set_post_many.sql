-- Merchant Visit 4.10.5: KHQR "sent to Telegram" status arrives in batches.
-- One call carries up to 200 installs instead of one call per install,
-- which saves Google UrlFetch quota. Same update rule as qr_set_post
-- (only writes when something changed). Service role only.
create or replace function public.qr_set_post_many(p jsonb)
returns integer
language sql
security definer
set search_path to ''
as $$
  with items as (
    select distinct on (i->>'record_id')
           i->>'record_id' as record_id,
           left(i->>'link', 300) as link,
           nullif(i->>'photo_count', '')::int as photo_count
      from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) with ordinality as t(i, n)
     where coalesce(i->>'record_id', '') <> ''
     order by i->>'record_id', n desc
     limit 200
  ), upd as (
    update public.qr_installations q
       set telegram_link = it.link,
           photo_count   = coalesce(it.photo_count, q.photo_count)
      from items it
     where q.record_id = it.record_id
       and (q.telegram_link is distinct from it.link
            or q.photo_count is distinct from coalesce(it.photo_count, q.photo_count))
    returning 1
  )
  select count(*)::int from upd;
$$;

revoke all on function public.qr_set_post_many(jsonb) from public, anon, authenticated;
grant execute on function public.qr_set_post_many(jsonb) to service_role;

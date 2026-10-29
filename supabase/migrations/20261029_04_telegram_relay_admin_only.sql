-- 29 Oct 2026 · Telegram relay functions: admins only.
--
-- Why: rpc_send_telegram_message, rpc_send_telegram_document and rpc_detect_telegram_chats make the DATABASE call
-- api.telegram.org with whatever bot token the caller sends. Any signed-in user (including branch staff) could use the
-- database as a Telegram relay. Only admins set up and send Telegram alerts (Settings / Push Configuring).
-- After this, a non-admin call returns {"ok": false, "error": "..."}; the dashboard then tries its direct browser send,
-- exactly as it already does when the relay is unavailable, so no screen breaks.
--
-- How: the check is inserted as the first statement of each function's CURRENT live body (read from the database),
-- so nothing else in the functions changes. Safe to run more than once (a marker comment prevents a second insert).
-- Run in the Supabase SQL editor (whole file, one go).

do $$
declare
  f record;
  v_def text;
  v_new text;
begin
  for f in
    select p.oid, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('rpc_send_telegram_message', 'rpc_send_telegram_document', 'rpc_detect_telegram_chats')
  loop
    v_def := pg_get_functiondef(f.oid);
    if position('ADMIN_ONLY_TELEGRAM' in v_def) > 0 then
      raise notice '% already admin-only', f.proname;
      continue;
    end if;
    -- the body's own BEGIN is the first one at the start of a line (inner blocks are indented)
    v_new := regexp_replace(v_def, E'\nBEGIN\n',
      E'\nBEGIN\n'
      || E'  -- ADMIN_ONLY_TELEGRAM (29 Oct 2026): only an admin may use the database to send Telegram messages\n'
      || E'  IF NOT coalesce((select app.is_admin()), false) THEN\n'
      || E'    RETURN jsonb_build_object(''ok'', false, ''error'', ''Only an admin can send Telegram messages through the server.'');\n'
      || E'  END IF;\n');
    if v_new = v_def then
      raise exception 'Could not find the start of % (nothing changed).', f.proname;
    end if;
    execute v_new;
    raise notice '% is now admin-only', f.proname;
  end loop;
end $$;

-- Check (optional): each of the three should show true.
-- select p.proname, position('ADMIN_ONLY_TELEGRAM' in pg_get_functiondef(p.oid)) > 0 as admin_only
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname like 'rpc\_%telegram%';

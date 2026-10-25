-- ==============================================================================
-- Telegram Cloud Relay RPC via http extension
-- Routes Telegram API calls through Supabase backend to bypass ISP / browser blocks
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.rpc_detect_telegram_chats(
  p_bot_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_clean_token text;
  v_me_res http_response;
  v_me_json jsonb;
  v_bot_username text;
  v_upd_res http_response;
  v_upd_json jsonb;
  v_results jsonb;
  v_elem jsonb;
  v_chat jsonb;
  v_chat_id text;
  v_chat_title text;
  v_chat_type text;
  v_chats jsonb := '[]'::jsonb;
  v_seen_ids text[] := ARRAY[]::text[];
BEGIN
  v_clean_token := trim(both '"''' FROM trim(p_bot_token));
  IF v_clean_token ~* '^bot' THEN
    v_clean_token := substring(v_clean_token from 4);
  END IF;

  IF v_clean_token IS NULL OR v_clean_token = '' OR v_clean_token !~ '^\d+:[A-Za-z0-9_-]+$' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Please paste a valid Bot Token from @BotFather (format: 123456789:AAH...).'
    );
  END IF;

  -- 1. Check getMe
  BEGIN
    v_me_res := extensions.http_get('https://api.telegram.org/bot' || v_clean_token || '/getMe');
    v_me_json := v_me_res.content::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cloud server connection error: ' || SQLERRM);
  END;

  IF v_me_res.status != 200 OR NOT COALESCE((v_me_json->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', COALESCE(v_me_json->>'description', 'Invalid Bot Token (HTTP ' || v_me_res.status || '). Verify your token from @BotFather.')
    );
  END IF;

  v_bot_username := v_me_json->'result'->>'username';

  -- 2. Check getUpdates
  BEGIN
    v_upd_res := extensions.http_get(
      'https://api.telegram.org/bot' || v_clean_token || '/getUpdates?limit=100&allowed_updates=["message","edited_message","my_chat_member","chat_member"]'
    );
    IF v_upd_res.status = 409 THEN
      PERFORM extensions.http_get('https://api.telegram.org/bot' || v_clean_token || '/deleteWebhook?drop_pending_updates=false');
      v_upd_res := extensions.http_get(
        'https://api.telegram.org/bot' || v_clean_token || '/getUpdates?limit=100&allowed_updates=["message","edited_message","my_chat_member","chat_member"]'
      );
    END IF;
    v_upd_json := v_upd_res.content::jsonb;
  EXCEPTION WHEN OTHERS THEN
    v_upd_json := NULL;
  END;

  v_results := COALESCE(v_upd_json->'result', '[]'::jsonb);
  IF jsonb_typeof(v_results) = 'array' AND jsonb_array_length(v_results) > 0 THEN
    FOR i IN REVERSE jsonb_array_length(v_results) - 1 .. 0 LOOP
      v_elem := v_results->i;
      v_chat := COALESCE(
        v_elem->'message'->'chat',
        v_elem->'my_chat_member'->'chat',
        v_elem->'chat_member'->'chat',
        v_elem->'channel_post'->'chat',
        v_elem->'edited_message'->'chat'
      );
      IF v_chat IS NOT NULL AND v_chat ? 'id' THEN
        v_chat_id := v_chat->>'id';
        IF NOT (v_chat_id = ANY(v_seen_ids)) THEN
          v_seen_ids := array_append(v_seen_ids, v_chat_id);
          v_chat_title := COALESCE(
            v_chat->>'title',
            v_chat->>'username',
            v_chat->>'first_name',
            'Telegram Chat'
          );
          v_chat_type := COALESCE(v_chat->>'type', 'group');
          v_chats := v_chats || jsonb_build_object(
            'id', v_chat_id,
            'title', v_chat_title,
            'type', v_chat_type
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- Confirmation ping if chat detected
  IF jsonb_array_length(v_chats) > 0 THEN
    BEGIN
      PERFORM extensions.http_post(
        'https://api.telegram.org/bot' || v_clean_token || '/sendMessage',
        jsonb_build_object(
          'chat_id', v_chats->0->>'id',
          'text', '✅ *POS & Sound Box Inventory Connected!*' || chr(10) ||
                  '• *Bot:* @' || v_bot_username || chr(10) ||
                  '• *Linked Chat:* ' || (v_chats->0->>'title') || ' (`' || (v_chats->0->>'id') || '`)' || chr(10) ||
                  '• *Active Alerts:* POS & Sound Box Under Configuring (App Push Alerts)',
          'parse_mode', 'Markdown'
        )::text,
        'application/json'
      );
    EXCEPTION WHEN OTHERS THEN
      -- ignore ping error
    END;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'botUsername', v_bot_username,
    'chats', v_chats
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_send_telegram_message(
  p_bot_token text,
  p_chat_id text,
  p_text text,
  p_parse_mode text DEFAULT 'Markdown'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_clean_token text;
  v_clean_chat_id text;
  v_candidate_ids text[] := ARRAY[]::text[];
  v_candidate text;
  v_post_res http_response;
  v_res_json jsonb;
  v_last_error text := '';
  v_plain_text text;
BEGIN
  v_clean_token := trim(both '"''' FROM trim(p_bot_token));
  IF v_clean_token ~* '^bot' THEN
    v_clean_token := substring(v_clean_token from 4);
  END IF;

  v_clean_chat_id := trim(p_chat_id);

  IF v_clean_token IS NULL OR v_clean_token = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bot Token is required.');
  END IF;

  IF v_clean_chat_id IS NULL OR v_clean_chat_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Group Chat ID is required.');
  END IF;

  v_candidate_ids := array_append(v_candidate_ids, v_clean_chat_id);
  IF v_clean_chat_id LIKE '-100%' THEN
    v_candidate_ids := array_append(v_candidate_ids, '-' || substring(v_clean_chat_id from 5));
  ELSIF v_clean_chat_id LIKE '-%' THEN
    v_candidate_ids := array_append(v_candidate_ids, '-100' || substring(v_clean_chat_id from 2));
  ELSE
    v_candidate_ids := array_append(v_candidate_ids, '-' || v_clean_chat_id);
    v_candidate_ids := array_append(v_candidate_ids, '-100' || v_clean_chat_id);
  END IF;

  v_plain_text := regexp_replace(p_text, '[*_`\[\]]', '', 'g');

  FOREACH v_candidate IN ARRAY v_candidate_ids LOOP
    BEGIN
      v_post_res := extensions.http_post(
        'https://api.telegram.org/bot' || v_clean_token || '/sendMessage',
        jsonb_build_object(
          'chat_id', v_candidate,
          'text', p_text,
          'parse_mode', COALESCE(p_parse_mode, 'Markdown')
        )::text,
        'application/json'
      );
      v_res_json := v_post_res.content::jsonb;

      IF v_post_res.status = 200 AND COALESCE((v_res_json->>'ok')::boolean, false) THEN
        RETURN jsonb_build_object('ok', true, 'resolvedChatId', v_candidate);
      END IF;

      IF v_res_json->>'description' ~* 'parse entities|markdown' THEN
        v_post_res := extensions.http_post(
          'https://api.telegram.org/bot' || v_clean_token || '/sendMessage',
          jsonb_build_object(
            'chat_id', v_candidate,
            'text', v_plain_text
          )::text,
          'application/json'
        );
        v_res_json := v_post_res.content::jsonb;
        IF v_post_res.status = 200 AND COALESCE((v_res_json->>'ok')::boolean, false) THEN
          RETURN jsonb_build_object('ok', true, 'resolvedChatId', v_candidate);
        END IF;
      END IF;

      v_last_error := COALESCE(v_res_json->>'description', 'HTTP ' || v_post_res.status);

      IF NOT (v_res_json->>'description' ~* 'chat not found') THEN
        EXIT;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_last_error := SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', false, 'error', v_last_error);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_detect_telegram_chats(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_send_telegram_message(text, text, text, text) TO anon, authenticated, service_role;

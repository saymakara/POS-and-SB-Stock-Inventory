-- =============================================================================
-- Migration: Telegram Document Relay RPC
-- Authorizes sending configuration CSV documents directly to Telegram Bot API
-- via Supabase server-side HTTP relay, bypassing browser CORS restrictions.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.rpc_send_telegram_document(
  p_bot_token text,
  p_chat_id text,
  p_file_content text,
  p_file_name text,
  p_caption text DEFAULT '',
  p_parse_mode text DEFAULT 'HTML'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
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
  v_boundary text := '----TelegramBoundary' || to_hex(trunc(random()*1000000000)::bigint);
  v_body text;
  v_safe_caption text;
  v_safe_filename text;
  v_req http_request;
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

  v_safe_filename := COALESCE(NULLIF(trim(p_file_name), ''), 'document.csv');
  v_safe_caption := COALESCE(p_caption, '');
  IF length(v_safe_caption) > 1000 THEN
    v_safe_caption := substring(v_safe_caption from 1 for 990) || '...';
  END IF;

  FOREACH v_candidate IN ARRAY v_candidate_ids LOOP
    BEGIN
      -- Build multipart/form-data payload with proper CRLF boundaries
      v_body := '--' || v_boundary || E'\r\n' ||
                'Content-Disposition: form-data; name="chat_id"' || E'\r\n\r\n' ||
                v_candidate || E'\r\n' ||
                '--' || v_boundary || E'\r\n' ||
                'Content-Disposition: form-data; name="caption"' || E'\r\n\r\n' ||
                v_safe_caption || E'\r\n' ||
                '--' || v_boundary || E'\r\n' ||
                'Content-Disposition: form-data; name="parse_mode"' || E'\r\n\r\n' ||
                COALESCE(p_parse_mode, 'HTML') || E'\r\n' ||
                '--' || v_boundary || E'\r\n' ||
                'Content-Disposition: form-data; name="document"; filename="' || v_safe_filename || '"' || E'\r\n' ||
                'Content-Type: text/csv; charset=utf-8' || E'\r\n\r\n' ||
                E'\xEF\xBB\xBF' || p_file_content || E'\r\n' ||
                '--' || v_boundary || '--' || E'\r\n';

      v_req.method := 'POST';
      v_req.uri := 'https://api.telegram.org/bot' || v_clean_token || '/sendDocument';
      v_req.headers := ARRAY[http_header('Content-Type', 'multipart/form-data; boundary=' || v_boundary)];
      v_req.content_type := 'multipart/form-data; boundary=' || v_boundary;
      v_req.content := v_body;

      v_post_res := extensions.http(v_req);
      v_res_json := v_post_res.content::jsonb;

      IF v_post_res.status = 200 AND COALESCE((v_res_json->>'ok')::boolean, false) THEN
        RETURN jsonb_build_object('ok', true, 'resolvedChatId', v_candidate);
      END IF;

      -- If markdown parsing failed, retry with plain text caption
      IF v_res_json->>'description' ~* 'parse entities|markdown' THEN
        v_body := '--' || v_boundary || E'\r\n' ||
                  'Content-Disposition: form-data; name="chat_id"' || E'\r\n\r\n' ||
                  v_candidate || E'\r\n' ||
                  '--' || v_boundary || E'\r\n' ||
                  'Content-Disposition: form-data; name="caption"' || E'\r\n\r\n' ||
                  regexp_replace(v_safe_caption, '<[^>]+>', '', 'g') || E'\r\n' ||
                  '--' || v_boundary || E'\r\n' ||
                  'Content-Disposition: form-data; name="document"; filename="' || v_safe_filename || '"' || E'\r\n' ||
                  'Content-Type: text/csv; charset=utf-8' || E'\r\n\r\n' ||
                  E'\xEF\xBB\xBF' || p_file_content || E'\r\n' ||
                  '--' || v_boundary || '--' || E'\r\n';

        v_req.content := v_body;
        v_post_res := extensions.http(v_req);
        v_res_json := v_post_res.content::jsonb;

        IF v_post_res.status = 200 AND COALESCE((v_res_json->>'ok')::boolean, false) THEN
          RETURN jsonb_build_object('ok', true, 'resolvedChatId', v_candidate);
        END IF;
      END IF;

      v_last_error := COALESCE(v_res_json->>'description', 'HTTP ' || v_post_res.status::text);
      IF v_last_error !~* 'chat not found' THEN
        EXIT;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_last_error := SQLERRM;
      EXIT;
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', false, 'error', COALESCE(v_last_error, 'Failed to send document to Telegram'));
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_send_telegram_document(text, text, text, text, text, text) TO authenticated, anon, service_role;

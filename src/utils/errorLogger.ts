import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { stampSecPP } from './time';

export interface ErrorLoggerContext {
  staffId: string;
  staffName: string;
  role: string;
  branchId: string;
}

export interface TechnicalErrorPopupPayload {
  id: string;
  code: string;
  operation: string;
  message: string;
  staffId: string;
  staffName: string;
  branchId: string;
  timestamp: string;
  target?: string;
  telegramSent?: boolean;
}

const STORAGE_KEY_TG_WEBHOOK = 'crm_telegram_webhook_url_v1';
const STORAGE_KEY_TG_BOT_TOKEN = 'crm_telegram_bot_token_v1';
const STORAGE_KEY_TG_CHAT_ID = 'crm_telegram_chat_id_v1';
const STORAGE_KEY_TG_CONFIG_CHAT_ID = 'crm_telegram_config_chat_id_v1';

let currentContext: ErrorLoggerContext = {
  staffId: 'UNKNOWN_STAFF',
  staffName: 'Field / Workstation Staff',
  role: 'BRANCH',
  branchId: '100',
};

type PopupListener = (payload: TechnicalErrorPopupPayload) => void;
const popupListeners = new Set<PopupListener>();

export function setErrorLoggerContext(ctx: Partial<ErrorLoggerContext>): void {
  currentContext = {
    ...currentContext,
    ...Object.fromEntries(Object.entries(ctx).filter(([, v]) => v !== undefined && v !== '')),
  };
}

export function getErrorLoggerContext(): ErrorLoggerContext {
  return currentContext;
}

export function subscribeTechnicalErrorPopup(listener: PopupListener): () => void {
  popupListeners.add(listener);
  return () => {
    popupListeners.delete(listener);
  };
}

export function triggerTechnicalErrorPopup(payload: TechnicalErrorPopupPayload): void {
  popupListeners.forEach((listener) => {
    try {
      listener(payload);
    } catch {
      // ignore listener errors
    }
  });
}

export function getTelegramWebhookConfig(): {
  webhookUrl: string;
  botToken: string;
  chatId: string;
  configChatId: string;
} {
  let storedWebhook = '';
  let storedToken = '';
  let storedChatId = '';
  let storedConfigChatId = '';
  try {
    if (typeof localStorage !== 'undefined') {
      storedWebhook = localStorage.getItem(STORAGE_KEY_TG_WEBHOOK) || '';
      storedToken = localStorage.getItem(STORAGE_KEY_TG_BOT_TOKEN) || '';
      storedChatId = localStorage.getItem(STORAGE_KEY_TG_CHAT_ID) || '';
      storedConfigChatId = localStorage.getItem(STORAGE_KEY_TG_CONFIG_CHAT_ID) || '';
    }
  } catch {
    // ignore storage access errors
  }
  const env = (import.meta as any).env || {};
  const primaryChatId = (storedChatId || env.VITE_TELEGRAM_CHAT_ID || '').trim();
  const cfgChatId = (storedConfigChatId || env.VITE_TELEGRAM_CONFIG_CHAT_ID || primaryChatId).trim();
  return {
    webhookUrl: (storedWebhook || env.VITE_TELEGRAM_WEBHOOK_URL || '').trim(),
    botToken: (storedToken || env.VITE_TELEGRAM_BOT_TOKEN || '').trim(),
    chatId: primaryChatId || cfgChatId,
    configChatId: cfgChatId || primaryChatId,
  };
}

export function saveTelegramWebhookConfig(config: {
  webhookUrl?: string;
  botToken?: string;
  chatId?: string;
  configChatId?: string;
}): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (config.webhookUrl !== undefined) {
      localStorage.setItem(STORAGE_KEY_TG_WEBHOOK, config.webhookUrl.trim());
    }
    if (config.botToken !== undefined) {
      localStorage.setItem(STORAGE_KEY_TG_BOT_TOKEN, config.botToken.trim());
    }
    if (config.chatId !== undefined) {
      localStorage.setItem(STORAGE_KEY_TG_CHAT_ID, config.chatId.trim());
    }
    if (config.configChatId !== undefined) {
      localStorage.setItem(STORAGE_KEY_TG_CONFIG_CHAT_ID, config.configChatId.trim());
    }
  } catch {
    // ignore storage errors
  }
}

/**
 * Extracts a standardized technical error code and message from any thrown error or Supabase PostgREST error.
 */
export function extractTechnicalError(
  err: unknown,
  fallbackCode = 'ERR_DB_OPERATION'
): { code: string; message: string } {
  if (!err) {
    return { code: fallbackCode, message: 'Unknown technical error' };
  }
  if (typeof err === 'string') {
    const codeMatch = err.match(/\b(PGRST\d+|PT\d+|\d{5}|42501|23505|23503|22P02|STALE_ROW|HTTP_\d+)\b/i);
    return {
      code: codeMatch ? `ERR-${codeMatch[1].toUpperCase()}` : fallbackCode,
      message: err,
    };
  }
  if (typeof err === 'object') {
    const anyErr = err as Record<string, unknown>;
    const rawCode = String(anyErr.code || anyErr.status || anyErr.error_code || '').trim();
    const rawMessage = String(
      anyErr.message || anyErr.error_description || anyErr.details || anyErr.hint || 'Database / API request failed'
    ).trim();
    const inferredMatch = rawMessage.match(/\b(PGRST\d+|PT\d+|\d{5}|42501|23505|23503|22P02|STALE_ROW)\b/i);
    const finalCode = rawCode
      ? `ERR-${rawCode.toUpperCase()}`
      : inferredMatch
      ? `ERR-${inferredMatch[1].toUpperCase()}`
      : fallbackCode;
    return { code: finalCode, message: rawMessage };
  }
  return { code: fallbackCode, message: String(err) };
}

/**
 * Sends the exact error message, technical error code, and staff ID to the configured Telegram webhook.
 */
export async function sendTelegramErrorAlert(_payload: TechnicalErrorPopupPayload): Promise<boolean> {
  // System error alerts to Telegram disabled per user policy: alerts reserved strictly for POS and Sound Box Under Configuring
  return false;
}

/**
 * Error-Only Logger + Temporary Telegram Debugging + Mobile UI Technical Error Popup.
 * Called ONLY inside catch blocks when an API call or database operation fails.
 * Successful operations MUST NOT call this function.
 */
export async function reportCaughtError(
  operation: string,
  err: unknown,
  options?: {
    code?: string;
    target?: string;
    staffId?: string;
    branchId?: string;
    showPopup?: boolean;
    skipDbLog?: boolean;
  }
): Promise<TechnicalErrorPopupPayload> {
  const { code, message } = extractTechnicalError(err, options?.code || 'ERR_SUPABASE_API');
  const staffId = options?.staffId || currentContext.staffId || 'UNKNOWN_STAFF';
  const staffName = currentContext.staffName || staffId;
  const branchId = options?.branchId || currentContext.branchId || '100';
  const timestamp = stampSecPP();

  const payload: TechnicalErrorPopupPayload = {
    id: `ERR-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    code,
    operation,
    message,
    staffId,
    staffName,
    branchId,
    timestamp,
    target: options?.target,
  };

  // 1. Trigger UI technical error popup immediately so mobile/field staff can screenshot it
  if (options?.showPopup !== false) {
    triggerTechnicalErrorPopup(payload);
  }

  // 2. Error-Only Database Audit Log (only write to Supabase on actual failure, with circuit guard against recursion)
  if (isSupabaseConfigured && !options?.skipDbLog && operation !== 'writeErrorAuditLog') {
    try {
      await supabase.from('audit_logs').insert({
        title: `[ERROR] ${operation}`.slice(0, 160),
        detail: `[${code}] Staff ${staffId}: ${message}`.slice(0, 1000),
        action: 'ERROR',
        target: options?.target || code,
      });
    } catch {
      // Do not re-throw if the database log quota or connection is down; Telegram & UI popup already captured it
    }
  }

  return payload;
}

/**
 * Policy #11: Sends a Telegram Group notification when Admin finishes setting up a Merchant Profile
 * on an Under Configuring device, alerting the assigned staff to open the POS Terminal / device
 * and wait for pushing the app to the device.
 */
export async function sendDeviceConfigTelegramAlert(
  info: DeviceConfigTelegramAlertInfo
): Promise<DeviceConfigTelegramAlertResult> {
  const { webhookUrl, botToken, chatId, configChatId } = getTelegramWebhookConfig();
  let cleanToken = botToken.trim().replace(/^["']|["']$/g, '');
  const match = cleanToken.match(/(?:bot)?(\d+:[A-Za-z0-9_-]+)/);
  if (match) cleanToken = match[1];

  const primaryChatId = (configChatId || chatId || '').trim();
  const timestamp = stampSecPP();

  const devType = info.type || info.deviceType || 'Device';
  const devModel = info.model ? ` · ${info.model}` : '';
  const assignedStaff = info.staff || info.staffName || 'Branch Officer';
  const branchName = info.branchName || 'Branch';
  const branchId = info.branchId || '100';
  const merchantName = info.merchantName || 'Configured Merchant';
  const actor = info.actor || info.adminOperator || 'System Admin';

  const formattedText = [
    `📲 *Under Configuring — Ready for App Push*`,
    `• *Action Required:* Please *OPEN the device* and connect to network to wait for pushing the app!`,
    `• *Assigned Staff:* *${assignedStaff}*`,
    `• *Branch:* Code \`${branchId}\` (${branchName})`,
    `• *Hardware Serial:* \`${info.serial}\` (${devType}${devModel})`,
    `• *Merchant Name:* *${merchantName}*`,
    `• *MID:* \`${info.mid || '—'}\`  |  *TID:* \`${info.tid || '—'}\``,
    `• *Configured By:* ${actor}`,
    `• *Timestamp:* ${timestamp}`,
  ].join('\n');

  let lastError = '';

  // 1. Primary: Use Supabase Cloud Relay (immune to browser/adblocker/ISP restrictions)
  if (isSupabaseConfigured && cleanToken && primaryChatId) {
    try {
      const { data, error } = await supabase.rpc('rpc_send_telegram_message', {
        p_bot_token: cleanToken,
        p_chat_id: primaryChatId,
        p_text: formattedText,
        p_parse_mode: 'Markdown',
      });
      if (!error && data && data.ok) {
        if (data.resolvedChatId && data.resolvedChatId !== primaryChatId) {
          saveTelegramWebhookConfig({ configChatId: data.resolvedChatId, chatId: data.resolvedChatId });
        }
        return { ok: true, resolvedChatId: data.resolvedChatId || primaryChatId };
      }
      if (data?.error) {
        lastError = data.error;
      } else if (error?.message) {
        lastError = error.message;
      }
    } catch (err: any) {
      lastError = err?.message || 'Cloud relay error';
    }
  }

  // 2. Direct browser fallback if Supabase RPC was not used or failed
  const candidateChatIds: string[] = [];
  if (primaryChatId) {
    candidateChatIds.push(primaryChatId);
    if (primaryChatId.startsWith('-100')) {
      candidateChatIds.push('-' + primaryChatId.slice(4));
    } else if (primaryChatId.startsWith('-')) {
      candidateChatIds.push('-100' + primaryChatId.slice(1));
    } else {
      candidateChatIds.push('-' + primaryChatId);
      candidateChatIds.push('-100' + primaryChatId);
    }
  }

  if (cleanToken && candidateChatIds.length > 0) {
    const tgUrl = `https://api.telegram.org/bot${cleanToken}/sendMessage`;
    for (const testChatId of candidateChatIds) {
      try {
        const params = new URLSearchParams({
          chat_id: testChatId,
          text: formattedText,
          parse_mode: 'Markdown',
        });
        const res = await fetch(tgUrl, {
          method: 'POST',
          body: params,
        });

        const data = await res.json().catch(() => null);

        if (res.ok && data?.ok) {
          if (testChatId !== primaryChatId) {
            saveTelegramWebhookConfig({ configChatId: testChatId, chatId: testChatId });
          }
          return { ok: true, resolvedChatId: testChatId };
        }

        if (data?.description && /can't parse entities|entities|markdown/i.test(data.description)) {
          const retryParams = new URLSearchParams({
            chat_id: testChatId,
            text: formattedText.replace(/[*_`\[\]]/g, ''),
          });
          const retryRes = await fetch(tgUrl, {
            method: 'POST',
            body: retryParams,
          });
          const retryData = await retryRes.json().catch(() => null);
          if (retryRes.ok && retryData?.ok) {
            if (testChatId !== primaryChatId) {
              saveTelegramWebhookConfig({ configChatId: testChatId, chatId: testChatId });
            }
            return { ok: true, resolvedChatId: testChatId };
          }
        }

        lastError = data?.description || `HTTP ${res.status}`;
        if (data?.description && /chat not found/i.test(data.description)) {
          continue;
        }
      } catch (err: any) {
        const isFetch = err?.message?.toLowerCase().includes('fetch') || err?.name === 'TypeError';
        lastError = isFetch
          ? 'Browser network blocked api.telegram.org. If you use Brave or an AdBlocker, please allow this site.'
          : (err?.message || 'Network error connecting to Telegram');
      }
    }
  }

  // 3. Webhook fallback
  if (webhookUrl) {
    let urlChatId = primaryChatId;
    try {
      const parsedUrl = new URL(webhookUrl);
      if (!urlChatId && parsedUrl.searchParams.get('chat_id')) {
        urlChatId = parsedUrl.searchParams.get('chat_id') || '';
      }
    } catch {
      // ignore
    }
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: urlChatId || undefined,
          text: formattedText,
          type: 'DEVICE_CONFIG_APP_PUSH',
          ...info,
          timestamp,
        }),
      });
      if (res.ok) return { ok: true, resolvedChatId: urlChatId };
      lastError = `Webhook HTTP ${res.status}`;
    } catch (err: any) {
      lastError = err?.message || 'Webhook failed';
    }
  }

  return {
    ok: false,
    error: lastError || 'Check Bot Token & Group Chat ID (ensure bot has been added to the Telegram group).',
  };
}

/**
 * Queries Telegram Bot API via Supabase Cloud Relay (or direct fallback) to automatically
 * discover Group Chat IDs where the bot has been added on Telegram Desktop / Mobile.
 */
export async function detectTelegramGroupChats(
  botTokenInput: string
): Promise<{
  ok: boolean;
  botUsername: string;
  error?: string;
  chats: { id: string; title: string; type: string }[];
}> {
  let cleanToken = botTokenInput.trim().replace(/^["']|["']$/g, '');
  const match = cleanToken.match(/(?:bot)?(\d+:[A-Za-z0-9_-]+)/);
  if (match) cleanToken = match[1];
  if (!cleanToken) {
    return {
      ok: false,
      botUsername: '',
      error: 'Please paste a valid Bot Token from @BotFather (e.g. 7891234567:AAHxxxxxxxxxxxx). If you need help finding it, see the instructions below.',
      chats: [],
    };
  }

  // 1. Primary: Use Supabase Cloud Relay (immune to ISP / browser blocks)
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabase.rpc('rpc_detect_telegram_chats', {
        p_bot_token: cleanToken,
      });
      if (!error && data) {
        if (data.ok) {
          const chatsList = Array.isArray(data.chats) ? data.chats : [];
          return {
            ok: true,
            botUsername: data.botUsername || '',
            chats: chatsList,
          };
        }
        return {
          ok: false,
          botUsername: data.botUsername || '',
          error: data.error || 'Failed to detect chats via cloud relay.',
          chats: [],
        };
      }
    } catch {
      // Fallback to direct fetch
    }
  }

  // 2. Direct browser fetch fallback
  try {
    const meRes = await fetch(`https://api.telegram.org/bot${cleanToken}/getMe`);
    const meJson = await meRes.json().catch(() => null);
    if (!meRes.ok || !meJson?.ok) {
      return {
        ok: false,
        botUsername: '',
        error: meJson?.description || `Invalid Bot Token (HTTP ${meRes.status}). Verify your token from @BotFather.`,
        chats: [],
      };
    }
    const botUsername = String(meJson.result?.username || '');

    let res = await fetch(
      `https://api.telegram.org/bot${cleanToken}/getUpdates?limit=100&allowed_updates=["message","edited_message","my_chat_member","chat_member"]`
    );
    if (res.status === 409) {
      await fetch(`https://api.telegram.org/bot${cleanToken}/deleteWebhook?drop_pending_updates=false`);
      res = await fetch(
        `https://api.telegram.org/bot${cleanToken}/getUpdates?limit=100&allowed_updates=["message","edited_message","my_chat_member","chat_member"]`
      );
    }
    if (!res.ok) {
      return {
        ok: true,
        botUsername,
        error: `Could not read updates (HTTP ${res.status}).`,
        chats: [],
      };
    }
    const data = await res.json();
    const list: { id: string; title: string; type: string }[] = [];
    const seen = new Set<string>();
    const results = Array.isArray(data?.result) ? data.result : [];
    for (let i = results.length - 1; i >= 0; i--) {
      const u = results[i];
      const chat =
        u?.message?.chat ||
        u?.my_chat_member?.chat ||
        u?.chat_member?.chat ||
        u?.channel_post?.chat ||
        u?.edited_message?.chat;
      if (chat && chat.id !== undefined) {
        const idStr = String(chat.id);
        if (!seen.has(idStr)) {
          seen.add(idStr);
          list.push({
            id: idStr,
            title: String(chat.title || chat.username || chat.first_name || 'Telegram Chat'),
            type: String(chat.type || 'group'),
          });
        }
      }
    }

    list.sort((a, b) => {
      const aIsGroup = a.id.startsWith('-') ? 0 : 1;
      const bIsGroup = b.id.startsWith('-') ? 0 : 1;
      return aIsGroup - bIsGroup;
    });

    if (list.length > 0) {
      const target = list[0];
      const confirmParams = new URLSearchParams({
        chat_id: target.id,
        text: [
          `✅ *POS & Sound Box Inventory Connected!*`,
          `• *Bot:* @${botUsername}`,
          `• *Linked Chat:* ${target.title} (\`${target.id}\`)`,
          `• *Active Alerts:* POS & Sound Box Under Configuring (App Push Alerts)`,
        ].join('\n'),
        parse_mode: 'Markdown',
      });
      await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
        method: 'POST',
        body: confirmParams,
      }).catch(() => undefined);
    }

    return { ok: true, botUsername, chats: list };
  } catch (e: any) {
    const isFetchErr = e?.message?.toLowerCase().includes('fetch') || e?.name === 'TypeError';
    const errorMsg = isFetchErr
      ? 'Browser cannot reach api.telegram.org ("Failed to fetch"). If your browser uses an AdBlocker (uBlock, AdGuard, or Brave Shields), please pause it for this site, or manually enter the Group ID below.'
      : (e?.message || 'Network error connecting to api.telegram.org.');
    return {
      ok: false,
      botUsername: '',
      error: errorMsg,
      chats: [],
    };
  }
}

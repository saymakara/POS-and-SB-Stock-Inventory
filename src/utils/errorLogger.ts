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
export async function sendDeviceConfigTelegramAlert(info: {
  serial: string;
  type: string;
  model: string;
  mid: string;
  tid: string;
  merchantName: string;
  branchId: string;
  branchName: string;
  staff: string;
  actor: string;
}): Promise<boolean> {
  const { webhookUrl, botToken, chatId, configChatId } = getTelegramWebhookConfig();
  const targetChatId = configChatId || chatId;
  const timestamp = stampSecPP();
  const formattedText = [
    `📲 *Under Configuring — Ready for App Push*`,
    `• *Action Required:* Please *OPEN the device* and connect to network to wait for pushing the app!`,
    `• *Assigned Staff:* *${info.staff || 'Branch Officer'}*`,
    `• *Branch:* Code \`${info.branchId}\` (${info.branchName})`,
    `• *Hardware Serial:* \`${info.serial}\` (${info.type} · ${info.model})`,
    `• *Merchant Name:* *${info.merchantName || 'Configured Merchant'}*`,
    `• *MID:* \`${info.mid || '—'}\`  |  *TID:* \`${info.tid || '—'}\``,
    `• *Configured By:* ${info.actor}`,
    `• *Timestamp:* ${timestamp}`,
  ].join('\n');

  try {
    if (botToken && targetChatId) {
      const tgUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const res = await fetch(tgUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: targetChatId,
          text: formattedText,
          parse_mode: 'Markdown',
        }),
      });
      if (res.ok) return true;
    }

    if (webhookUrl) {
      let urlChatId = targetChatId;
      try {
        const parsedUrl = new URL(webhookUrl);
        if (!urlChatId && parsedUrl.searchParams.get('chat_id')) {
          urlChatId = parsedUrl.searchParams.get('chat_id') || '';
        }
      } catch {
        // ignore URL parse error
      }
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: urlChatId || undefined,
          text: formattedText,
          parse_mode: 'Markdown',
          type: 'DEVICE_CONFIG_APP_PUSH',
          ...info,
          timestamp,
        }),
      });
      if (res.ok) return true;
    }
  } catch {
    // Non-blocking notification
  }
  return false;
}

/**
 * Queries Telegram Bot API (`getMe`, `deleteWebhook` if needed, and `getUpdates`) to automatically
 * discover Group Chat IDs where the bot has been added on Telegram Desktop / Mobile, and sends
 * an instant confirmation ping to the detected chat.
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
    return { ok: false, botUsername: '', error: 'Please paste a valid Bot Token from @BotFather.', chats: [] };
  }

  try {
    // 1. Verify Bot Token via getMe
    const meRes = await fetch(`https://api.telegram.org/bot${cleanToken}/getMe`);
    const meJson = await meRes.json().catch(() => null);
    if (!meRes.ok || !meJson?.ok) {
      return {
        ok: false,
        botUsername: '',
        error: meJson?.description || `Invalid Bot Token (HTTP ${meRes.status}). Check your token from @BotFather.`,
        chats: [],
      };
    }
    const botUsername = String(meJson.result?.username || '');

    // 2. Fetch getUpdates (if 409 Conflict because a webhook was set previously, clear webhook so getUpdates works)
    let res = await fetch(`https://api.telegram.org/bot${cleanToken}/getUpdates?limit=100`);
    if (res.status === 409) {
      await fetch(`https://api.telegram.org/bot${cleanToken}/deleteWebhook?drop_pending_updates=false`);
      res = await fetch(`https://api.telegram.org/bot${cleanToken}/getUpdates?limit=100`);
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

    // Prioritize group / supergroup / channel chats (negative IDs) over private 1-on-1 chats
    list.sort((a, b) => {
      const aIsGroup = a.id.startsWith('-') ? 0 : 1;
      const bIsGroup = b.id.startsWith('-') ? 0 : 1;
      return aIsGroup - bIsGroup;
    });

    // 3. If we found at least one chat, send an immediate confirmation message so the user sees it in Telegram!
    if (list.length > 0) {
      const target = list[0];
      await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: target.id,
          text: [
            `✅ *POS & Sound Box Inventory Connected!*`,
            `• *Bot:* @${botUsername}`,
            `• *Linked Chat:* ${target.title} (\`${target.id}\`)`,
            `• *Active Alerts:* POS & Sound Box Under Configuring (App Push Alerts)`,
          ].join('\n'),
          parse_mode: 'Markdown',
        }),
      }).catch(() => undefined);
    }

    return { ok: true, botUsername, chats: list };
  } catch (e: any) {
    return {
      ok: false,
      botUsername: '',
      error: e?.message || 'Network error connecting to api.telegram.org.',
      chats: [],
    };
  }
}

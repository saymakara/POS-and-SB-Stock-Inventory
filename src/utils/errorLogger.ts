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
} {
  let storedWebhook = '';
  let storedToken = '';
  let storedChatId = '';
  try {
    if (typeof localStorage !== 'undefined') {
      storedWebhook = localStorage.getItem(STORAGE_KEY_TG_WEBHOOK) || '';
      storedToken = localStorage.getItem(STORAGE_KEY_TG_BOT_TOKEN) || '';
      storedChatId = localStorage.getItem(STORAGE_KEY_TG_CHAT_ID) || '';
    }
  } catch {
    // ignore storage access errors
  }
  const env = (import.meta as any).env || {};
  return {
    webhookUrl: (storedWebhook || env.VITE_TELEGRAM_WEBHOOK_URL || '').trim(),
    botToken: (storedToken || env.VITE_TELEGRAM_BOT_TOKEN || '').trim(),
    chatId: (storedChatId || env.VITE_TELEGRAM_CHAT_ID || '').trim(),
  };
}

export function saveTelegramWebhookConfig(config: {
  webhookUrl?: string;
  botToken?: string;
  chatId?: string;
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
export async function sendTelegramErrorAlert(payload: TechnicalErrorPopupPayload): Promise<boolean> {
  const { webhookUrl, botToken, chatId } = getTelegramWebhookConfig();
  const formattedText = [
    `🚨 *POS & Sound Box Inventory — Technical Error*`,
    `• *Error Code:* \`${payload.code}\``,
    `• *Operation:* ${payload.operation}`,
    `• *Staff ID:* \`${payload.staffId}\` (${payload.staffName})`,
    `• *Branch Code:* \`${payload.branchId}\``,
    payload.target ? `• *Target Serial/ID:* \`${payload.target}\`` : '',
    `• *Timestamp:* ${payload.timestamp}`,
    `• *Error Message:* \`${payload.message}\``,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    // 1. Direct Telegram Bot Token + Chat ID
    if (botToken && chatId) {
      const tgUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const res = await fetch(tgUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: formattedText,
          parse_mode: 'Markdown',
        }),
      });
      if (res.ok) return true;
    }

    // 2. Direct Webhook URL (Telegram sendMessage URL or custom webhook endpoint)
    if (webhookUrl) {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId || undefined,
          text: formattedText,
          errorCode: payload.code,
          operation: payload.operation,
          errorMessage: payload.message,
          staffId: payload.staffId,
          staffName: payload.staffName,
          branchId: payload.branchId,
          target: payload.target,
          timestamp: payload.timestamp,
        }),
      });
      if (res.ok) return true;
    }

    // 3. Fallback to backend /api/v1/debug/telegram webhook relay when running with local Express server
    if (typeof window !== 'undefined' && !isSupabaseConfigured) {
      const res = await fetch('/api/v1/debug/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: formattedText,
          errorCode: payload.code,
          operation: payload.operation,
          errorMessage: payload.message,
          staffId: payload.staffId,
          staffName: payload.staffName,
          branchId: payload.branchId,
          target: payload.target,
          timestamp: payload.timestamp,
        }),
      });
      if (res.ok) return true;
    }
  } catch {
    // Never throw from inside the error webhook reporter
  }
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

  // 2. Dispatch error details + staffId to the Telegram debug webhook asynchronously
  void sendTelegramErrorAlert(payload).then((sent) => {
    payload.telegramSent = sent;
  });

  // 3. Error-Only Database Audit Log (only write to Supabase on actual failure, with circuit guard against recursion)
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

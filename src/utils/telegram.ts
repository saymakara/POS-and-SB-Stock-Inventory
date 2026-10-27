/**
 * Telegram integration for "Under Configuring — Ready for App Push" alerts.
 *
 * Delivery order for every message:
 *   1. Supabase cloud relay RPC (`rpc_send_telegram_message`) — immune to browser CORS / ad-blockers / ISP blocks
 *   2. Direct browser call to api.telegram.org (tries both `-123…` and `-100123…` group ID formats)
 *   3. Optional custom webhook URL
 *
 * Regional routing: each branch can be mapped to a regional team's Telegram group. Devices whose branch is not
 * mapped fall back to the default group chat ID.
 */
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { stampSecPP } from './time';
import type { Branch, TelegramRegionalGroup } from '../types';

// -----------------------------------------------------------------------------
// Configuration storage
// -----------------------------------------------------------------------------

const STORAGE_KEY_TG_WEBHOOK = 'crm_telegram_webhook_url_v1';
const STORAGE_KEY_TG_BOT_TOKEN = 'crm_telegram_bot_token_v1';
const STORAGE_KEY_TG_CHAT_ID = 'crm_telegram_chat_id_v1';
const STORAGE_KEY_TG_CONFIG_CHAT_ID = 'crm_telegram_config_chat_id_v1';
const STORAGE_KEY_TG_REGIONAL_GROUPS = 'crm_telegram_regional_groups_v1';
const STORAGE_KEY_TG_DETECTED_CHATS = 'crm_telegram_detected_chats_v1';
const STORAGE_KEY_TG_BOT_USERNAME = 'crm_telegram_bot_username_v1';

/** Default staff group used when nothing else is configured. */
export const DEFAULT_TELEGRAM_CHAT_ID = '-5428585935';

export interface TelegramConfig {
  webhookUrl: string;
  botToken: string;
  chatId: string;
  configChatId: string;
  regionalGroups: TelegramRegionalGroup[];
}

const readStorage = (key: string): string => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) || '' : '';
  } catch {
    return '';
  }
};

const writeStorage = (key: string, value: string): void => {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    // storage full / disabled: ignore
  }
};

export function getTelegramDetectedChats(): DetectedTelegramChat[] {
  const raw = readStorage(STORAGE_KEY_TG_DETECTED_CHATS);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveTelegramDetectedChats(chats: DetectedTelegramChat[]): void {
  writeStorage(STORAGE_KEY_TG_DETECTED_CHATS, JSON.stringify(chats));
}

export function getTelegramBotUsername(): string {
  return readStorage(STORAGE_KEY_TG_BOT_USERNAME);
}

export function saveTelegramBotUsername(username: string): void {
  writeStorage(STORAGE_KEY_TG_BOT_USERNAME, username.trim());
}

/** Clears all stored Telegram connection credentials, tokens, webhooks, and detected chats */
export function clearTelegramConnection(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY_TG_WEBHOOK);
      localStorage.removeItem(STORAGE_KEY_TG_BOT_TOKEN);
      localStorage.removeItem(STORAGE_KEY_TG_CHAT_ID);
      localStorage.removeItem(STORAGE_KEY_TG_CONFIG_CHAT_ID);
      localStorage.removeItem(STORAGE_KEY_TG_DETECTED_CHATS);
      localStorage.removeItem(STORAGE_KEY_TG_BOT_USERNAME);
    }
  } catch {
    // ignore
  }
}

export function getTelegramRegionalGroups(): TelegramRegionalGroup[] {
  const raw = readStorage(STORAGE_KEY_TG_REGIONAL_GROUPS);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveTelegramRegionalGroups(groups: TelegramRegionalGroup[]): void {
  writeStorage(STORAGE_KEY_TG_REGIONAL_GROUPS, JSON.stringify(groups));
}

export function getTelegramWebhookConfig(): TelegramConfig {
  const env = (import.meta as any).env || {};
  const primaryChatId = (readStorage(STORAGE_KEY_TG_CHAT_ID) || env.VITE_TELEGRAM_CHAT_ID || '').trim();
  const cfgChatId = (readStorage(STORAGE_KEY_TG_CONFIG_CHAT_ID) || env.VITE_TELEGRAM_CONFIG_CHAT_ID || primaryChatId).trim();
  return {
    webhookUrl: (readStorage(STORAGE_KEY_TG_WEBHOOK) || env.VITE_TELEGRAM_WEBHOOK_URL || '').trim(),
    botToken: (readStorage(STORAGE_KEY_TG_BOT_TOKEN) || env.VITE_TELEGRAM_BOT_TOKEN || '').trim(),
    chatId: primaryChatId || cfgChatId || DEFAULT_TELEGRAM_CHAT_ID,
    configChatId: cfgChatId || primaryChatId || DEFAULT_TELEGRAM_CHAT_ID,
    regionalGroups: getTelegramRegionalGroups(),
  };
}

export function saveTelegramWebhookConfig(config: Partial<TelegramConfig>): void {
  if (config.webhookUrl !== undefined) writeStorage(STORAGE_KEY_TG_WEBHOOK, config.webhookUrl.trim());
  if (config.botToken !== undefined) writeStorage(STORAGE_KEY_TG_BOT_TOKEN, config.botToken.trim());
  if (config.chatId !== undefined) writeStorage(STORAGE_KEY_TG_CHAT_ID, config.chatId.trim());
  if (config.configChatId !== undefined) writeStorage(STORAGE_KEY_TG_CONFIG_CHAT_ID, config.configChatId.trim());
  if (config.regionalGroups !== undefined) saveTelegramRegionalGroups(config.regionalGroups);
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Extracts the bare `123456:ABC…` token from whatever the user pasted (quotes, `bot` prefix, full URL…). */
export function cleanBotToken(input: string): string {
  const stripped = (input || '').trim().replace(/^["']|["']$/g, '');
  const match = stripped.match(/(?:bot)?(\d+:[A-Za-z0-9_-]+)/);
  return match ? match[1] : stripped;
}

/** Telegram groups can be addressed as `-123…` (basic group) or `-100123…` (supergroup); try both. */
function chatIdVariants(chatId: string): string[] {
  const id = chatId.trim();
  if (!id) return [];
  if (id.startsWith('-100')) return [id, '-' + id.slice(4)];
  if (id.startsWith('-')) return [id, '-100' + id.slice(1)];
  return [id, '-' + id, '-100' + id];
}

export interface ResolvedTelegramChat {
  chatId: string;
  groupName: string;
  isRegional: boolean;
}

/**
 * Resolves the destination Telegram chat for a branch.
 * Priority: branch-level `telegramChatId` → regional group containing the branch → default group.
 */
export function resolveTelegramChatForBranch(
  branchId?: string,
  regionalGroups?: TelegramRegionalGroup[],
  branches?: Branch[],
  config: TelegramConfig = getTelegramWebhookConfig()
): ResolvedTelegramChat {
  const fallback: ResolvedTelegramChat = {
    chatId: (config.configChatId || config.chatId || DEFAULT_TELEGRAM_CHAT_ID).trim(),
    groupName: 'Default Staff Telegram Group',
    isRegional: false,
  };
  const bId = (branchId || '').trim();
  if (!bId) return fallback;

  const branch = branches?.find((b) => String(b.code).trim() === bId);
  if (branch?.telegramChatId?.trim()) {
    return { chatId: branch.telegramChatId.trim(), groupName: `${branch.name} Direct Telegram`, isRegional: true };
  }

  const groups = regionalGroups ?? config.regionalGroups;
  const group = groups.find((g) => g.chatId?.trim() && g.branchCodes?.some((c) => String(c).trim() === bId));
  if (group) {
    return { chatId: group.chatId.trim(), groupName: group.name || 'Regional Team Group', isRegional: true };
  }
  return fallback;
}

// -----------------------------------------------------------------------------
// Transport
// -----------------------------------------------------------------------------

export interface TelegramDispatchResult {
  ok: boolean;
  resolvedChatId?: string;
  error?: string;
}

/** Fast timeout wrapper to prevent hanging cloud RPCs or unresponsive network calls */
async function withTimeout<T = any>(
  promise: PromiseLike<T> | Promise<T>,
  timeoutMs: number,
  timeoutMsg = 'Operation timed out'
): Promise<T> {
  let timer: any;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMsg)), timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeoutPromise]).finally(() => clearTimeout(timer));
}

/** Sends a Markdown message using relay → direct → webhook, returning the chat ID that accepted it. */
export async function dispatchTelegramMessage(
  botToken: string,
  targetChatId: string,
  webhookUrl: string,
  text: string
): Promise<TelegramDispatchResult> {
  const token = cleanBotToken(botToken);
  const chatId = (targetChatId || '').trim();
  let lastError = '';

  // 1. Supabase cloud relay with fast 5s timeout
  if (isSupabaseConfigured && token && chatId) {
    try {
      const { data, error } = await withTimeout(
        supabase.rpc('rpc_send_telegram_message', {
          p_bot_token: token,
          p_chat_id: chatId,
          p_text: text,
          p_parse_mode: 'HTML',
        }),
        5000,
        'Cloud relay timeout'
      );
      if (!error && data?.ok) return { ok: true, resolvedChatId: data.resolvedChatId || chatId };
      lastError = data?.error || error?.message || lastError;
    } catch (err: any) {
      lastError = err?.message || 'Cloud relay error';
    }
  }

  // 2. Direct browser call. Form-encoded body avoids a CORS preflight.
  if (token) {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const post = async (params: Record<string, string>) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(url, {
          method: 'POST',
          body: new URLSearchParams(params),
          signal: controller.signal,
        });
        return { res, data: await res.json().catch(() => null) };
      } finally {
        clearTimeout(timer);
      }
    };
    for (const candidate of chatIdVariants(chatId)) {
      try {
        let { res, data } = await post({ chat_id: candidate, text, parse_mode: 'HTML' });
        if (res.ok && data?.ok) return { ok: true, resolvedChatId: candidate };

        // Handle Telegram 429 rate limit gracefully with short retry
        if (res.status === 429) {
          const retrySecs = Math.min(Number(data?.parameters?.retry_after) || 1, 3);
          await new Promise((r) => setTimeout(r, retrySecs * 1000));
          ({ res, data } = await post({ chat_id: candidate, text, parse_mode: 'HTML' }));
          if (res.ok && data?.ok) return { ok: true, resolvedChatId: candidate };
        }

        // If entity parsing failed: resend as plain text without parse_mode (never strip underscores!)
        if (data?.description && /can't parse entities|html|markdown/i.test(data.description)) {
          ({ res, data } = await post({ chat_id: candidate, text: text.replace(/<[^>]+>/g, '') }));
          if (res.ok && data?.ok) return { ok: true, resolvedChatId: candidate };
        }
        lastError = data?.description || `HTTP ${res.status}`;
        if (!/chat not found/i.test(lastError)) break; // only a wrong ID format is worth retrying
      } catch (err: any) {
        const blocked = err?.name === 'TypeError' || /fetch/i.test(err?.message || '');
        lastError = blocked
          ? 'Browser network blocked api.telegram.org. If you use Brave or an AdBlocker, please allow this site.'
          : err?.message || 'Network error connecting to Telegram';
        break;
      }
    }
  }

  // 3. Custom webhook
  if (webhookUrl) {
    let hookChatId = chatId;
    try {
      hookChatId = hookChatId || new URL(webhookUrl).searchParams.get('chat_id') || '';
    } catch {
      // not a valid URL: send anyway
    }
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: hookChatId || undefined, text, type: 'DEVICE_CONFIG_APP_PUSH' }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) return { ok: true, resolvedChatId: hookChatId };
      lastError = `Webhook HTTP ${res.status}`;
    } catch (err: any) {
      lastError = err?.message || 'Webhook failed';
    }
  }

  return {
    ok: false,
    error: lastError || 'Check Bot Token & Group Chat ID (ensure the bot has been added to the Telegram group).',
  };
}

/**
 * Sends a document file (e.g. CSV device configuration queue) with caption to Telegram using sendDocument.
 * If document dispatch fails or is blocked, falls back gracefully to dispatchTelegramMessage.
 */
export async function dispatchTelegramDocument(
  botToken: string,
  targetChatId: string,
  webhookUrl: string,
  fileContent: string,
  fileName: string,
  caption: string
): Promise<TelegramDispatchResult> {
  const token = cleanBotToken(botToken);
  const chatId = (targetChatId || '').trim();
  let lastError = '';

  // 1. Supabase cloud relay RPC with fast 6s timeout (immune to browser CORS / ad-blockers, sends real CSV document to Telegram)
  if (isSupabaseConfigured && token && chatId) {
    try {
      const { data, error } = await withTimeout(
        supabase.rpc('rpc_send_telegram_document', {
          p_bot_token: token,
          p_chat_id: chatId,
          p_file_content: fileContent,
          p_file_name: fileName,
          p_caption: caption,
          p_parse_mode: 'HTML',
        }),
        6000,
        'Cloud document relay timeout'
      );
      if (!error && data?.ok) return { ok: true, resolvedChatId: data.resolvedChatId || chatId };
      lastError = data?.error || error?.message || lastError;
    } catch (err: any) {
      lastError = err?.message || 'Cloud document relay error';
    }
  }

  // 2. Direct browser call to Telegram Bot API sendDocument (fallback if Supabase not configured)
  if (token && chatId) {
    const url = `https://api.telegram.org/bot${token}/sendDocument`;
    for (const candidate of chatIdVariants(chatId)) {
      try {
        const blob = new Blob(['\uFEFF' + fileContent], { type: 'text/csv;charset=utf-8;' });
        const formData = new FormData();
        formData.append('chat_id', candidate);
        formData.append('document', blob, fileName);
        if (caption) {
          // Telegram caption limit is 1024 characters
          const safeCaption = caption.length > 1000 ? `${caption.slice(0, 990)}...` : caption;
          formData.append('caption', safeCaption);
          formData.append('parse_mode', 'HTML');
        }

        let res = await fetch(url, { method: 'POST', body: formData, signal: AbortSignal.timeout(10000) });
        let data = await res.json().catch(() => null);

        if (res.ok && data?.ok) return { ok: true, resolvedChatId: candidate };

        // Handle Telegram 429 rate limit
        if (res.status === 429) {
          const retrySecs = Math.min(Number(data?.parameters?.retry_after) || 1, 3);
          await new Promise((r) => setTimeout(r, retrySecs * 1000));
          res = await fetch(url, { method: 'POST', body: formData, signal: AbortSignal.timeout(10000) });
          data = await res.json().catch(() => null);
          if (res.ok && data?.ok) return { ok: true, resolvedChatId: candidate };
        }

        // If HTML entities failed in caption, retry with clean plain text caption without parse_mode (never strip underscores!)
        if (data?.description && /can't parse entities|html|markdown/i.test(data.description)) {
          const plainFormData = new FormData();
          plainFormData.append('chat_id', candidate);
          plainFormData.append('document', blob, fileName);
          if (caption) {
            plainFormData.append('caption', caption.replace(/<[^>]+>/g, '').slice(0, 1000));
          }
          res = await fetch(url, { method: 'POST', body: plainFormData, signal: AbortSignal.timeout(10000) });
          data = await res.json().catch(() => null);
          if (res.ok && data?.ok) return { ok: true, resolvedChatId: candidate };
        }

        lastError = data?.description || `HTTP ${res.status}`;
        if (!/chat not found/i.test(lastError)) break;
      } catch (err: any) {
        lastError = err?.message || 'Failed to send document via Telegram API';
        break;
      }
    }
  }

  // 3. Custom Webhook with file payload
  if (webhookUrl) {
    let hookChatId = chatId;
    try {
      hookChatId = hookChatId || new URL(webhookUrl).searchParams.get('chat_id') || '';
    } catch {
      // not a valid URL
    }
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: hookChatId || undefined,
          text: caption,
          fileName,
          fileContent,
          type: 'DEVICE_CONFIG_FILE',
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) return { ok: true, resolvedChatId: hookChatId };
      lastError = `Webhook HTTP ${res.status}`;
    } catch (err: any) {
      lastError = err?.message || 'Webhook failed';
    }
  }

  // 4. Fallback to sending standard message with formatted device queue
  return dispatchTelegramMessage(botToken, chatId, webhookUrl, caption);
}

// -----------------------------------------------------------------------------
// App push alerts
// -----------------------------------------------------------------------------


/** Escapes HTML special characters for Telegram HTML parse mode */
export function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Normalizes a Telegram username or User ID to ensure valid mention syntax:
 * - If numeric ID (e.g. 634628318): returns <a href="tg://user?id=634628318">@name</a>
 * - If username (e.g. @Sokheng_MerchantSupport or Sokheng_MerchantSupport):
 *   preserves all characters including underscores!
 * - returns formatted `@username`
 */
export function formatTelegramMention(raw?: string | null, staffDisplayName?: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  const numericMatch = trimmed.match(/^(?:id:)?(\d{5,15})$/i);
  if (numericMatch) {
    const userId = numericMatch[1];
    const label = staffDisplayName ? `@${staffDisplayName.replace(/\s+/g, '_')}` : `@user_${userId}`;
    return `<a href="tg://user?id=${userId}">${escapeHtml(label)}</a>`;
  }
  const clean = trimmed.replace(/^@/, '');
  if (!clean || !/^[A-Za-z0-9_]{3,32}$/.test(clean)) return '';
  return `@${clean}`;
}

/**
 * Generates a unique, human-friendly Push Tracking ID (e.g. PUSH-261025-4819).
 * Format: PUSH-YYMMDD-XXXX (4-digit random number)
 * Super easy to search and find in Telegram search!
 */
export function generatePushTrackingId(): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `PUSH-${yy}${mm}${dd}-${rand}`;
}

export interface DeviceConfigTelegramAlertInfo {
  serial: string;
  type?: string;
  deviceType?: string;
  model?: string;
  mid?: string;
  tid?: string;
  merchantName?: string;
  branchId?: string;
  branchName?: string;
  staff?: string;
  staffName?: string;
  staffTelegram?: string;
  actor?: string;
  adminOperator?: string;
  /** Unique Tracking ID generated for this push alert (e.g. PUSH-261025-4819). Searchable in Telegram. */
  pushId?: string;
  pushTrackingId?: string;
  /** Send to this chat instead of resolving one from the branch (used by "Test Group"). */
  targetChatId?: string;
  targetGroupName?: string;
  regionalGroups?: TelegramRegionalGroup[];
  branches?: Branch[];
}

export interface DeviceConfigTelegramAlertResult {
  ok: boolean;
  resolvedChatId?: string;
  groupName?: string;
  pushId?: string;
  error?: string;
}

/** Single-device "Open the device and wait for app push" alert, routed to the branch's regional group. */
export async function sendDeviceConfigTelegramAlert(
  info: DeviceConfigTelegramAlertInfo
): Promise<DeviceConfigTelegramAlertResult> {
  const config = getTelegramWebhookConfig();
  const target: ResolvedTelegramChat = info.targetChatId?.trim()
    ? { chatId: info.targetChatId.trim(), groupName: info.targetGroupName || 'Target Group', isRegional: true }
    : resolveTelegramChatForBranch(info.branchId, info.regionalGroups, info.branches, config);

  const devType = info.type || info.deviceType || 'Device';
  const devModel = info.model ? ` · ${info.model}` : '';
  const isSoundBox = /sound\s*box|speaker/i.test(devType);
  const isPos = /pos/i.test(devType);
  const devEmoji = isSoundBox ? '🔊' : isPos ? '💳' : '📦';
  const typeHeader = isSoundBox ? 'Sound Box · Ready for App Push' : isPos ? 'POS Terminal · Ready for App Push' : `${devType} · Ready for App Push`;
  const staffDisplay = info.staff || info.staffName || 'Branch Officer';
  const mention = formatTelegramMention(info.staffTelegram, staffDisplay);
  const pushId = info.pushId || info.pushTrackingId || generatePushTrackingId();
  const text = [
    `${devEmoji} <b>${escapeHtml(typeHeader)}</b>`,
    `🆔 <b>Push Tracking ID:</b> <code>${escapeHtml(pushId)}</code>`,
    `• <b>Assigned Staff:</b> <b>${escapeHtml(staffDisplay)}</b>${mention ? ` (${mention})` : ''}`,
    `• <b>Assigned By:</b> <b>${escapeHtml(info.actor || info.adminOperator || 'System Admin')}</b>`,
    `• <b>Branch:</b> Code <code>${escapeHtml(info.branchId || '100')}</code> (${escapeHtml(info.branchName || 'Branch')})`,
    target.isRegional ? `• <b>Destination Group:</b> <b>${escapeHtml(target.groupName)}</b>` : null,
    `• <b>Serial Number:</b> <code>${escapeHtml(info.serial)}</code> (${escapeHtml(devType)}${escapeHtml(devModel)})`,
    `• <b>Merchant Name:</b> <b>${escapeHtml(info.merchantName || 'Configured Merchant')}</b>`,
    `• <b>MID:</b> <code>${escapeHtml(info.mid || '—')}</code>  |  <b>TID:</b> <code>${escapeHtml(info.tid || '—')}</code>`,
    `• <b>Action:</b> Please power ON device to wait for App Push.`,
    `• <b>Timestamp:</b> ${stampSecPP()}`,
  ]
    .filter(Boolean)
    .join('\n');

  const res = await dispatchTelegramMessage(config.botToken, target.chatId, config.webhookUrl, text);
  return {
    ok: res.ok,
    resolvedChatId: res.resolvedChatId || target.chatId,
    groupName: target.groupName,
    pushId,
    error: res.ok ? undefined : res.error || 'Failed to dispatch Telegram alert',
  };
}

export interface BatchDeviceConfigItem {
  serial: string;
  type?: string;
  deviceType?: string;
  model?: string;
  mid?: string;
  tid?: string;
  merchantName?: string;
  branchId?: string;
  branchName?: string;
  staff?: string;
  staffName?: string;
  staffTelegram?: string;
  pushId?: string;
  pushTrackingId?: string;
}

export interface BatchDeviceConfigTelegramAlertInfo {
  devices: BatchDeviceConfigItem[];
  adminOperator?: string;
  actor?: string;
  regionalGroups?: TelegramRegionalGroup[];
  branches?: Branch[];
  /** Optional pre-generated Batch Push Tracking ID (e.g. PUSH-261025-4819). */
  pushId?: string;
  pushTrackingId?: string;
  /** When true or default, consolidates devices by Assigned Staff + Chat so each technician gets 1 message with their merchants */
  groupByStaff?: boolean;
  targetStaffName?: string;
  targetStaffTelegram?: string;
}

export interface BatchDeviceConfigTelegramAlertResult {
  ok: boolean;
  totalUnits: number;
  groupsSent: number;
  pushId?: string;
  details: Array<{ chatId: string; groupName: string; units: number; ok: boolean; error?: string }>;
  error?: string;
}

/**
 * Builds a clean, comma-separated CSV string for a batch of devices in a branch queue.
 */
export function buildDeviceConfigCsv(
  devices: BatchDeviceConfigItem[],
  branchId?: string,
  actor?: string,
  batchPushId?: string
): string {
  const headers = [
    'No.',
    'Tracking ID',
    'Serial Number',
    'Device Type',
    'Model',
    'Merchant Name',
    'MID',
    'TID',
    'Configure By (Staff)',
    'Assigned By',
    'Branch Code',
    'Branch Name',
    'Action Required',
  ];

  const rows = devices.map((d, idx) => {
    const rowPushId = d.pushTrackingId || d.pushId || batchPushId || '—';
    return [
      String(idx + 1),
      rowPushId,
      d.serial,
      d.deviceType || d.type || 'POS Terminal',
      d.model || '—',
      d.merchantName || '—',
      d.mid || '—',
      d.tid || '—',
      d.staff || d.staffName || 'Assigned Branch Staff',
      actor || 'System Admin',
      d.branchId || branchId || '100',
      d.branchName || `Branch ${d.branchId || branchId || '100'}`,
      'Open device and connect to network to wait for App Push',
    ];
  });

  return [headers, ...rows]
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
}

/**
 * Batch alert for Under Configuring devices (e.g. up to 10 devices per staff member or branch).
 * Sends 1 consolidated Telegram notification with attached configuration file (.csv) to open,
 * instead of sending 10 individual spam messages in the group.
 * Grouped per staff member so each technician (e.g. Khon Rithy) receives 1 message + their total file.
 */
export async function sendBatchDeviceConfigTelegramAlert(
  info: BatchDeviceConfigTelegramAlertInfo
): Promise<BatchDeviceConfigTelegramAlertResult> {
  if (!info.devices?.length) {
    return { ok: false, totalUnits: 0, groupsSent: 0, details: [], error: 'No devices provided for batch alert.' };
  }
  const config = getTelegramWebhookConfig();
  const timestamp = stampSecPP();
  const actor = info.actor || info.adminOperator || 'System Admin';
  const batchPushId = info.pushId || info.pushTrackingId || generatePushTrackingId();
  const groupByStaff = info.groupByStaff !== false;

  interface DestinationGroup {
    chatId: string;
    names: Set<string>;
    isRegional: boolean;
    staffName: string;
    staffTelegram?: string;
    devices: BatchDeviceConfigItem[];
  }

  // Group destinations by Chat + Staff (so each staff member like Khon Rithy gets exactly 1 message with their 10 merchants file)
  const destinations = new Map<string, DestinationGroup>();

  for (const d of info.devices) {
    const r = resolveTelegramChatForBranch(d.branchId, info.regionalGroups, info.branches, config);
    const rawStaff = d.staff || d.staffName || info.targetStaffName || 'Assigned Branch Staff';
    const staffKey = rawStaff.toLowerCase().trim();
    const destKey = groupByStaff ? `${r.chatId}___${staffKey}` : r.chatId;

    let dest = destinations.get(destKey);
    if (!dest) {
      const tgHandle =
        d.staffTelegram ||
        (info.targetStaffName && staffKey === info.targetStaffName.toLowerCase().trim() ? info.targetStaffTelegram : undefined);

      dest = {
        chatId: r.chatId,
        names: new Set(),
        isRegional: false,
        staffName: rawStaff,
        staffTelegram: tgHandle,
        devices: [],
      };
      destinations.set(destKey, dest);
    }

    dest.names.add(r.groupName);
    dest.isRegional = dest.isRegional || r.isRegional;
    if (!dest.staffTelegram && d.staffTelegram) {
      dest.staffTelegram = d.staffTelegram;
    }
    dest.devices.push(d);
  }

  // Parallel concurrent dispatch across all destination groups/staff for maximum speed and stability
  const destList = Array.from(destinations.values());
  const details = await Promise.all(
    destList.map(async (dest) => {
      const groupName = Array.from(dest.names).join(' + ');
      const sampleBranch = dest.devices[0]?.branchId || '100';
      const sampleBranchName = dest.devices[0]?.branchName || groupName;

      // Distinct staff members and telegram handles
      const uniqueStaffList = Array.from(
        new Set(dest.devices.map((d) => (d.staff || d.staffName || '').trim()).filter(Boolean))
      );
      const uniqueMentions = Array.from(
        new Set(
          dest.devices
            .map((d) => formatTelegramMention(d.staffTelegram, d.staff || d.staffName || ''))
            .filter(Boolean)
        )
      );

      const isAllStaffMode = !groupByStaff && uniqueStaffList.length > 1;
      const cleanStaff = isAllStaffMode
        ? 'All_Staff'
        : (dest.staffName || 'Staff')
            .replace(/[^a-zA-Z0-9]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');

      // Device type label for filename
      const devTypes = new Set(dest.devices.map((d) => (d.deviceType || d.type || '').toLowerCase()));
      let devTypeLabel = 'Devices';
      if (devTypes.size === 1) {
        if (devTypes.has('sound box')) devTypeLabel = 'SoundBox';
        else if (devTypes.has('pos terminal')) devTypeLabel = 'POSTerminal';
      }

      const fileName = `${cleanStaff}_${devTypeLabel}_Total_${dest.devices.length}_Merchants_${batchPushId}.csv`;
      const fileCsv = buildDeviceConfigCsv(dest.devices, sampleBranch, actor, batchPushId);

      const staffDisplayName = isAllStaffMode
        ? uniqueStaffList.join(', ')
        : dest.staffName;
      const staffMentionStr = isAllStaffMode
        ? (uniqueMentions.length > 0 ? ` (${uniqueMentions.join(' ')})` : '')
        : (formatTelegramMention(dest.staffTelegram, dest.staffName)
            ? ` (${formatTelegramMention(dest.staffTelegram, dest.staffName)})`
            : '');

      const isAllSoundBox = devTypes.size === 1 && Array.from(devTypes).some((t) => /sound\s*box|speaker/i.test(t));
      const isAllPos = devTypes.size === 1 && Array.from(devTypes).some((t) => /pos/i.test(t));
      const batchEmoji = isAllSoundBox ? '🔊' : isAllPos ? '💳' : '📦';
      const batchTypeHeader = isAllSoundBox ? 'Sound Box' : isAllPos ? 'POS Terminal' : 'Batch Devices';

      // Build consolidated Telegram notification (Mandatory data only - HTML formatted, preserves underscores in mentions)
      const lines: string[] = [
        isAllStaffMode
          ? `${batchEmoji} <b>${batchTypeHeader} · Ready for App Push (All Staff Master File)</b>`
          : `${batchEmoji} <b>${batchTypeHeader} · Ready for App Push</b>`,
        `🆔 <b>Push Tracking ID:</b> <code>${escapeHtml(batchPushId)}</code>`,
        `• <b>Assigned Staff${isAllStaffMode ? ` (${uniqueStaffList.length})` : ''}:</b> <b>${escapeHtml(staffDisplayName)}</b>${staffMentionStr}`,
        `• <b>Assigned By:</b> <b>${escapeHtml(actor)}</b>`,
        `• <b>Branch:</b> Code <code>${escapeHtml(sampleBranch)}</code> (${escapeHtml(sampleBranchName)})`,
        dest.isRegional ? `• <b>Destination Group:</b> <b>${escapeHtml(groupName)}</b>` : null,
        `• <b>Total Devices:</b> <b>${dest.devices.length} unit${dest.devices.length === 1 ? '' : 's'}${isAllStaffMode ? ' (All staff included in 1 file)' : ''}</b> (Details in attached CSV)`,
        `• <b>Action:</b> Please power ON device${dest.devices.length === 1 ? '' : 's'} to wait for App Push.`,
        `• <b>Timestamp:</b> ${timestamp}`,
      ].filter(Boolean) as string[];

      const res = await dispatchTelegramDocument(
        config.botToken,
        dest.chatId,
        config.webhookUrl,
        fileCsv,
        fileName,
        lines.join('\n')
      );
      return { chatId: dest.chatId, groupName, units: dest.devices.length, ok: res.ok, error: res.error };
    })
  );

  const groupsSent = details.filter((d) => d.ok).length;
  return {
    ok: groupsSent > 0,
    totalUnits: info.devices.length,
    groupsSent,
    pushId: batchPushId,
    details,
    error: groupsSent > 0 ? undefined : details.find((d) => d.error)?.error || 'All regional group dispatches failed.',
  };
}

// -----------------------------------------------------------------------------
// Group chat discovery
// -----------------------------------------------------------------------------

export interface DetectedTelegramChat {
  id: string;
  title: string;
  type: string;
}

export interface DetectTelegramChatsResult {
  ok: boolean;
  botUsername: string;
  error?: string;
  chats: DetectedTelegramChat[];
}

/** Lists chats the bot has seen (via relay, or getUpdates directly) so the user can pick a group ID. */
export async function detectTelegramGroupChats(botTokenInput: string): Promise<DetectTelegramChatsResult> {
  const token = cleanBotToken(botTokenInput);
  if (!token) {
    return {
      ok: false,
      botUsername: '',
      error: 'Please paste a valid Bot Token from @BotFather (e.g. 7891234567:AAHxxxxxxxxxxxx).',
      chats: [],
    };
  }

  // 1. Supabase cloud relay with fast 5s timeout
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await withTimeout(
        supabase.rpc('rpc_detect_telegram_chats', { p_bot_token: token }),
        5000,
        'Cloud chat detection timeout'
      );
      if (!error && data) {
        return data.ok
          ? { ok: true, botUsername: data.botUsername || '', chats: Array.isArray(data.chats) ? data.chats : [] }
          : { ok: false, botUsername: data.botUsername || '', error: data.error || 'Failed to detect chats via cloud relay.', chats: [] };
      }
    } catch {
      // fall through to direct fetch
    }
  }

  // 2. Direct browser fallback
  const api = `https://api.telegram.org/bot${token}`;
  try {
    const meRes = await fetch(`${api}/getMe`, { signal: AbortSignal.timeout(6000) });
    const me = await meRes.json().catch(() => null);
    if (!meRes.ok || !me?.ok) {
      return {
        ok: false,
        botUsername: '',
        error: me?.description || `Invalid Bot Token (HTTP ${meRes.status}). Verify your token from @BotFather.`,
        chats: [],
      };
    }
    const botUsername = String(me.result?.username || '');

    const updatesUrl = `${api}/getUpdates?limit=100&allowed_updates=["message","edited_message","my_chat_member","chat_member"]`;
    let res = await fetch(updatesUrl, { signal: AbortSignal.timeout(6000) });
    if (res.status === 409) {
      // a webhook is set on the bot, which blocks getUpdates
      await fetch(`${api}/deleteWebhook?drop_pending_updates=false`, { signal: AbortSignal.timeout(6000) });
      res = await fetch(updatesUrl, { signal: AbortSignal.timeout(6000) });
    }
    if (!res.ok) return { ok: true, botUsername, error: `Could not read updates (HTTP ${res.status}).`, chats: [] };

    const results: any[] = (await res.json())?.result || [];
    const seen = new Map<string, DetectedTelegramChat>();
    for (let i = results.length - 1; i >= 0; i--) {
      const u = results[i];
      const chat = u?.message?.chat || u?.my_chat_member?.chat || u?.chat_member?.chat || u?.channel_post?.chat || u?.edited_message?.chat;
      if (chat?.id === undefined) continue;
      const id = String(chat.id);
      if (!seen.has(id)) {
        seen.set(id, { id, title: String(chat.title || chat.username || chat.first_name || 'Telegram Chat'), type: String(chat.type || 'group') });
      }
    }
    // groups (negative IDs) first
    const chats = Array.from(seen.values()).sort((a, b) => Number(!a.id.startsWith('-')) - Number(!b.id.startsWith('-')));

    if (chats.length) {
      const target = chats[0];
      const confirm = [
        `✅ *POS & Sound Box Inventory Connected!*`,
        `• *Bot:* @${botUsername}`,
        `• *Linked Chat:* ${target.title} (\`${target.id}\`)`,
        `• *Active Alerts:* POS & Sound Box Under Configuring (App Push Alerts)`,
      ].join('\n');
      await fetch(`${api}/sendMessage`, {
        method: 'POST',
        body: new URLSearchParams({ chat_id: target.id, text: confirm, parse_mode: 'Markdown' }),
        signal: AbortSignal.timeout(6000),
      }).catch(() => undefined);
    }
    return { ok: true, botUsername, chats };
  } catch (e: any) {
    const blocked = e?.name === 'TypeError' || /fetch/i.test(e?.message || '');
    return {
      ok: false,
      botUsername: '',
      error: blocked
        ? 'Browser cannot reach api.telegram.org ("Failed to fetch"). If you use an AdBlocker (uBlock, AdGuard, Brave Shields), pause it for this site, or enter the Group ID manually below.'
        : e?.message || 'Network error connecting to api.telegram.org.',
      chats: [],
    };
  }
}

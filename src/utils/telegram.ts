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

  // 1. Supabase cloud relay
  if (isSupabaseConfigured && token && chatId) {
    try {
      const { data, error } = await supabase.rpc('rpc_send_telegram_message', {
        p_bot_token: token,
        p_chat_id: chatId,
        p_text: text,
        p_parse_mode: 'Markdown',
      });
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
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams(params) });
      return { res, data: await res.json().catch(() => null) };
    };
    for (const candidate of chatIdVariants(chatId)) {
      try {
        let { res, data } = await post({ chat_id: candidate, text, parse_mode: 'Markdown' });
        if (res.ok && data?.ok) return { ok: true, resolvedChatId: candidate };
        // Markdown rejected (e.g. an underscore in a name): resend as plain text
        if (data?.description && /can't parse entities|markdown/i.test(data.description)) {
          ({ res, data } = await post({ chat_id: candidate, text: text.replace(/[*_`[\]]/g, '') }));
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

  // 1. Direct browser call to Telegram Bot API sendDocument
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
          formData.append('parse_mode', 'Markdown');
        }

        let res = await fetch(url, { method: 'POST', body: formData });
        let data = await res.json().catch(() => null);

        if (res.ok && data?.ok) return { ok: true, resolvedChatId: candidate };

        // If Markdown entities failed in caption, retry with clean plain text caption
        if (data?.description && /can't parse entities|markdown/i.test(data.description)) {
          const plainFormData = new FormData();
          plainFormData.append('chat_id', candidate);
          plainFormData.append('document', blob, fileName);
          if (caption) {
            plainFormData.append('caption', caption.replace(/[*_`[\]]/g, '').slice(0, 1000));
          }
          res = await fetch(url, { method: 'POST', body: plainFormData });
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

  // 2. Custom Webhook with file payload
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
      });
      if (res.ok) return { ok: true, resolvedChatId: hookChatId };
      lastError = `Webhook HTTP ${res.status}`;
    } catch (err: any) {
      lastError = err?.message || 'Webhook failed';
    }
  }

  // 3. Fallback to sending standard message with formatted device queue
  return dispatchTelegramMessage(botToken, chatId, webhookUrl, caption);
}

// -----------------------------------------------------------------------------
// App push alerts
// -----------------------------------------------------------------------------


/**
 * Normalizes a Telegram username to ensure valid mention syntax:
 * - strips leading @
 * - validates telegram username format (alphanumeric + underscores, 3-32 chars)
 * - returns formatted `@username`
 */
export function formatTelegramMention(raw?: string | null): string {
  if (!raw) return '';
  const clean = raw.trim().replace(/^@/, '');
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
  const mention = formatTelegramMention(info.staffTelegram);
  const staffDisplay = info.staff || info.staffName || 'Branch Officer';
  const pushId = info.pushId || info.pushTrackingId || generatePushTrackingId();
  const text = [
    `📲 *Under Configuring — Ready for App Push*`,
    `🆔 *Push Tracking ID:* \`${pushId}\``,
    `• *Action Required:* Please *OPEN the device* and connect to network to wait for pushing the app!`,
    `• *Assigned By:* *${info.actor || info.adminOperator || 'System Admin'}*`,
    `• *Configure By:* *${staffDisplay}*`,
    `• *Branch:* Code \`${info.branchId || '100'}\` (${info.branchName || 'Branch'})`,
    target.isRegional ? `• *Destination Regional Group:* *${target.groupName}*` : null,
    `• *Hardware Serial:* \`${info.serial}\` (${devType}${devModel})`,
    `• *Merchant Name:* *${info.merchantName || 'Configured Merchant'}*`,
    `• *MID:* \`${info.mid || '—'}\`  |  *TID:* \`${info.tid || '—'}\``,
    mention ? `\n👉 *Attention ${mention}:* Please power ON and open device \`${info.serial}\` now to wait for app push! (Ref: \`${pushId}\`)` : null,
    `• *Timestamp:* ${stampSecPP()}`,
    `🔎 *Search in Telegram:* \`${pushId}\``,
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
    'Push Tracking ID',
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
 * Batch alert for Under Configuring devices (e.g. up to 10 devices per branch).
 * Sends 1 consolidated Telegram notification with attached configuration file (.csv) to open,
 * instead of 10 individual pop-up messages.
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

  // chat ID → devices (+ every group name that routes there, so a shared chat is labelled correctly)
  const destinations = new Map<string, { names: Set<string>; isRegional: boolean; devices: BatchDeviceConfigItem[] }>();
  for (const d of info.devices) {
    const r = resolveTelegramChatForBranch(d.branchId, info.regionalGroups, info.branches, config);
    let dest = destinations.get(r.chatId);
    if (!dest) destinations.set(r.chatId, (dest = { names: new Set(), isRegional: false, devices: [] }));
    dest.names.add(r.groupName);
    dest.isRegional = dest.isRegional || r.isRegional;
    dest.devices.push(d);
  }

  const details: BatchDeviceConfigTelegramAlertResult['details'] = [];
  for (const [chatId, dest] of destinations) {
    const groupName = Array.from(dest.names).join(' + ');
    const sampleBranch = dest.devices[0]?.branchId || '100';
    const sampleBranchName = dest.devices[0]?.branchName || groupName;
    const fileName = `Branch_${sampleBranch}_Config_Queue_${batchPushId}.csv`;
    const fileCsv = buildDeviceConfigCsv(dest.devices, sampleBranch, actor, batchPushId);

    // Build 1 consolidated Telegram notification (instead of 10 separate pop-up messages!)
    const lines = [
      `📲 *Branch Code ${sampleBranch} (${sampleBranchName}) — Configuration Queue*`,
      `🆔 *Batch Push Tracking ID:* \`${batchPushId}\``,
      `• *${dest.isRegional ? 'Regional Group' : 'Destination'}:* *${groupName}*`,
      `• *Total Devices:* *${dest.devices.length} units to configure*`,
      `• *Assigned By:* *${actor}*`,
      `• *Action Required:* Assigned officers please *OPEN devices* and connect to network to wait for App Push!`,
      `• *Attached File:* 📁 \`${fileName}\` (tap file to open device & merchant list)`,
      ``,
      `📋 *Device Queue (${dest.devices.length} units) — [Ref: \`${batchPushId}\`]:*`,
    ];

    // List all devices (up to 10) with full details
    const maxListed = Math.min(dest.devices.length, 10);
    for (let i = 0; i < maxListed; i++) {
      const d = dest.devices[i];
      const devType = d.deviceType || d.type || 'Device';
      const mName = d.merchantName ? `*${d.merchantName}*` : 'Merchant Profile Pending';
      const midTid = d.mid || d.tid ? ` (MID: \`${d.mid || '—'}\` | TID: \`${d.tid || '—'}\`)` : '';
      const stf = d.staff || d.staffName ? ` · Configure By: *${d.staff || d.staffName}*` : '';
      lines.push(`${i + 1}. 🔹 \`${d.serial}\` (${devType})${stf}\n   └ ${mName}${midTid}`);
    }
    if (dest.devices.length > 10) {
      lines.push(`... and ${dest.devices.length - 10} more units in attached configuration file.`);
    }

    lines.push(
      ``,
      `🔎 *Search in Telegram:* \`${batchPushId}\``,
      `• *Timestamp:* ${timestamp}`
    );

    const res = await dispatchTelegramDocument(
      config.botToken,
      chatId,
      config.webhookUrl,
      fileCsv,
      fileName,
      lines.join('\n')
    );
    details.push({ chatId, groupName, units: dest.devices.length, ok: res.ok, error: res.error });
  }

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

  // 1. Supabase cloud relay
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabase.rpc('rpc_detect_telegram_chats', { p_bot_token: token });
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
    const meRes = await fetch(`${api}/getMe`);
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
    let res = await fetch(updatesUrl);
    if (res.status === 409) {
      // a webhook is set on the bot, which blocks getUpdates
      await fetch(`${api}/deleteWebhook?drop_pending_updates=false`);
      res = await fetch(updatesUrl);
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

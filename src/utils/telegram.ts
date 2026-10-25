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
  const text = [
    `📲 *Under Configuring — Ready for App Push*`,
    `• *Action Required:* Please *OPEN the device* and connect to network to wait for pushing the app!`,
    `• *Assigned By:* *${info.actor || info.adminOperator || 'System Admin'}*`,
    `• *Configure By:* *${staffDisplay}*`,
    `• *Branch:* Code \`${info.branchId || '100'}\` (${info.branchName || 'Branch'})`,
    target.isRegional ? `• *Destination Regional Group:* *${target.groupName}*` : null,
    `• *Hardware Serial:* \`${info.serial}\` (${devType}${devModel})`,
    `• *Merchant Name:* *${info.merchantName || 'Configured Merchant'}*`,
    `• *MID:* \`${info.mid || '—'}\`  |  *TID:* \`${info.tid || '—'}\``,
    mention ? `\n👉 *Attention ${mention}:* Please power ON and open device \`${info.serial}\` now to wait for app push!` : null,
    `• *Timestamp:* ${stampSecPP()}`,
  ]
    .filter(Boolean)
    .join('\n');

  const res = await dispatchTelegramMessage(config.botToken, target.chatId, config.webhookUrl, text);
  return {
    ok: res.ok,
    resolvedChatId: res.resolvedChatId || target.chatId,
    groupName: target.groupName,
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
}

export interface BatchDeviceConfigTelegramAlertInfo {
  devices: BatchDeviceConfigItem[];
  adminOperator?: string;
  actor?: string;
  regionalGroups?: TelegramRegionalGroup[];
  branches?: Branch[];
}

export interface BatchDeviceConfigTelegramAlertResult {
  ok: boolean;
  totalUnits: number;
  groupsSent: number;
  details: Array<{ chatId: string; groupName: string; units: number; ok: boolean; error?: string }>;
  error?: string;
}

const groupBy = <T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> => {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
};

/**
 * Batch alert for many Under Configuring devices (~200/day). Devices are partitioned by destination chat so each
 * regional team only receives its own hardware; within a message, devices are grouped by assigned staff.
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
    const byStaff = groupBy(dest.devices, (d) => {
      const branch = d.branchName ? ` (${d.branchName})` : d.branchId ? ` (Branch ${d.branchId})` : '';
      return `${d.staff || d.staffName || 'Branch Staff'}${branch}`;
    });

    const lines = [
      `📲 *Batch Under Configuring — Ready for App Push*`,
      `• *${dest.isRegional ? 'Regional Destination' : 'Destination'}:* *${groupName}*`,
      `• *Total Devices:* *${dest.devices.length} units*`,
      `• *Assigned By:* *${actor}*`,
      `• *Action Required:* Assigned teams please *OPEN devices* and connect to network to wait for pushing the app!`,
      ``,
      `👥 *Configure By (Assigned Staff / Teams):*`,
    ];
    for (const [team, items] of byStaff) {
      const sample = items.slice(0, 4).map((x) => `\`${x.serial}\``).join(', ');
      const more = items.length > 4 ? ` (+${items.length - 4} more)` : '';
      lines.push(`• *${team}*: *${items.length} units*`, `  └ Serials: ${sample}${more}`);
    }
    lines.push(``, `• *Timestamp:* ${timestamp}`);

    const res = await dispatchTelegramMessage(config.botToken, chatId, config.webhookUrl, lines.join('\n'));
    details.push({ chatId, groupName, units: dest.devices.length, ok: res.ok, error: res.error });
  }

  const groupsSent = details.filter((d) => d.ok).length;
  return {
    ok: groupsSent > 0,
    totalUnits: info.devices.length,
    groupsSent,
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

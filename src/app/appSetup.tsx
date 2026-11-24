// (07 Nov 2026, refactor) Setup of the portal shell, moved out of App.tsx unchanged: lazy page registry, storage keys,
// tab lists, the saved sign-in session and small helpers used by App.
import React from 'react';
import { Device, UserRole, User, MobileWebhookEvent, SystemNotification, HistoricalMerchantRecord } from '../types';
import { todayPP } from '../utils/time';
import { newRecordId } from '../utils/ids';
import type { SettingsSubTab } from '../components/SettingsTab';
import { isSupabaseConfigured } from '../lib/supabase';
import { fetchAuditLogs, StaffAccount } from '../services/supabaseService';


/** (31 Oct 2026) True when a save failed because there is no connection (not because the server refused it). */
export const isNetworkFailure = (err?: string): boolean =>
  (typeof navigator !== 'undefined' && navigator.onLine === false) ||
  /failed to fetch|networkerror|network request failed|load failed|fetch failed|offline/i.test(err || '');

// (22 Oct 2026, review) Screens other than the Dashboard and Stock Inventory are loaded when first opened, and fetched
// quietly in the background right after start-up, so the app opens faster and switching tabs is still instant.
export const tabLoaders: Array<() => Promise<unknown>> = [];
const tabLoaderById = new Map<string, () => Promise<unknown>>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyTab<C extends React.ComponentType<any>>(load: () => Promise<{ default: C }>, ids?: string[]) {
  // (7 Nov 2026) one download shared by the background fetch and the screen; once it is here the screen is drawn at once
  // (React.lazy alone showed its loading placeholder for a frame the first time, even when already downloaded - a flicker)
  let loaded: C | null = null;
  let pending: Promise<{ default: C }> | null = null;
  const once = () => (pending ??= load().then((m) => { loaded = m.default; return m; }, (e) => { pending = null; throw e; }));
  tabLoaders.push(once);
  if (ids) ids.forEach((id) => tabLoaderById.set(id, once));
  const Lazy = React.lazy(once);
  const Tab = (props: React.ComponentProps<C>) => React.createElement((loaded || Lazy) as React.ComponentType<any>, props);
  return Tab as unknown as C;
}
/** Pre-downloads a specific tab's static JS chunk on sidebar hover/pointerdown/focus so click is 0ms instant. */
export function prefetchTabChunk(tabId: string): void {
  const fn = tabLoaderById.get(tabId);
  if (fn) void fn().catch(() => {});
}
export function prefetchTabs(): void {
  // (24 Nov 2026, speed) Preload only static JS chunks in fast idle batches (most-used tabs first) so switching
  // tabs is instant without firing unrequested background database RPCs.
  let i = 0;
  const BATCH = 5;
  const next = () => {
    const slice = tabLoaders.slice(i, i + BATCH);
    i += BATCH;
    slice.forEach((load) => { load().catch(() => { /* loaded again when opened */ }); });
    if (i < tabLoaders.length) {
      window.setTimeout(next, 120);
    }
  };
  next();
}
// Most-visited operational tabs first so background chunk warm-up hits them within ~150ms of Dashboard paint
export const KpiPerformanceTab = lazyTab(() => import('../components/KpiPerformanceTab').then((m) => ({ default: m.KpiPerformanceTab })), ['kpi_performance']);
export const FieldReviewTab = lazyTab(() => import('../components/FieldReviewTab').then((m) => ({ default: m.FieldReviewTab })), ['mobile_sync', 'mobile_sync_sb']);
export const KhqrReviewTab = lazyTab(() => import('../components/KhqrReviewTab').then((m) => ({ default: m.KhqrReviewTab })), ['mobile_sync_khqr']);
export const CreditCardReviewTab = lazyTab(() => import('../components/CreditCardReviewTab').then((m) => ({ default: m.CreditCardReviewTab })), ['mobile_sync_cc']);
export const MerchantVisitTab = lazyTab(() => import('../components/MerchantVisitTab').then((m) => ({ default: m.MerchantVisitTab })), ['mobile_sync_visit']);
export const SettingsTab = lazyTab(() => import('../components/SettingsTab').then((m) => ({ default: m.SettingsTab })), ['settings', 'brand_logo']);
export const SimCardTab = lazyTab(() => import('../components/SimCardTab').then((m) => ({ default: m.SimCardTab })), ['sim_cards']);
export const RequisitionsTab = lazyTab(() => import('../components/RequisitionsTab').then((m) => ({ default: m.RequisitionsTab })), ['requisitions']);
export const MerchantsCrmTab = lazyTab(() => import('../components/MerchantsCrmTab').then((m) => ({ default: m.MerchantsCrmTab })), ['merchants']);
export const MerchantHistoryTab = lazyTab(() => import('../components/MerchantHistoryTab').then((m) => ({ default: m.MerchantHistoryTab })), ['merchant_history']);
export const BranchesTab = lazyTab(() => import('../components/BranchesTab').then((m) => ({ default: m.BranchesTab })), ['branches']);
export const StaffAccountsTab = lazyTab(() => import('../components/StaffAccountsTab').then((m) => ({ default: m.StaffAccountsTab })), ['users']);
export const AuditLogTab = lazyTab(() => import('../components/AuditLogTab').then((m) => ({ default: m.AuditLogTab })), ['audit_log']);
export const PushConfiguringTab = lazyTab(() => import('../components/PushConfiguringTab').then((m) => ({ default: m.PushConfiguringTab })), ['push_configuring']);
export const IamUsersTab = lazyTab(() => import('../components/IamUsersTab').then((m) => ({ default: m.IamUsersTab })), ['iam']);
export const MobileSyncTab = lazyTab(() => import('../components/MobileSyncTab').then((m) => ({ default: m.MobileSyncTab })));
export const LogoPageTab = lazyTab(() => import('../components/LogoPageTab').then((m) => ({ default: m.LogoPageTab })));
export const TraceModal = lazyTab(() => import('../components/TraceModal').then((m) => ({ default: m.TraceModal })));
export const ChangeBatteryModal = lazyTab(() => import('../components/ChangeBatteryModal').then((m) => ({ default: m.ChangeBatteryModal })));
export const ExportDataModal = lazyTab(() => import('../components/ExportDataModal').then((m) => ({ default: m.ExportDataModal })));
export const BatchUploadModal = lazyTab(() => import('../components/BatchUploadModal').then((m) => ({ default: m.BatchUploadModal })));
export const RequestStockModal = lazyTab(() => import('../components/RequestStockModal').then((m) => ({ default: m.RequestStockModal })));

// (29 Oct 2026, speed review) "reload only what changed": after the first full load the browser keeps its copy of the stock
// (IndexedDB) and asks the server only for units changed since. A full reload still happens when there is no usable copy, when the
// unit count does not match the server, after a refused save, or every 12 hours. Set to false to always reload everything.
// (24 Nov 2026, egress) Delta sync already verifies exact server row count and automatically falls back to full reload
// if any row was missed, so a 7-day full-reload ceiling avoids redundant daily 28-page downloads of all ~28k devices.
export const DELTA_SYNC_ENABLED = true;
export const KEY_DEVICES_FULL_AT = 'crm_pos_devices_full_at_v1';
export const DELTA_FULL_RELOAD_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
export const DELTA_OVERLAP_MS = 10 * 60 * 1000;     // a change committed late still carries its (older) start time: look back 10 minutes
export const DELTA_MAX_ROWS = 3000;
// resolved when the saved copy has been read, so the first reload can start from it
export let markCacheHydrated: () => void = () => {};
export const cacheHydrated: Promise<void> = new Promise<void>((resolve) => { markCacheHydrated = resolve; });
// (13 Nov 2026, speed) resolved when the first stock load has finished: the other screens' data (KPI, KHQR, Credit Card,
// SIM, field events, audit) is fetched only then, so it no longer competes with the stock list for the network and the
// database while the Dashboard is getting ready
export let markStockLoaded: () => void = () => {};
export const stockLoaded: Promise<void> = new Promise<void>((resolve) => { markStockLoaded = resolve; });
export type DeviceLoad = { list: Device[] | null; delta?: boolean; unchanged?: boolean };

export const STORAGE_KEY_DEVICES = 'crm_pos_devices_v20';
export const STORAGE_KEY_REQS = 'crm_pos_reqs_v20';
export const STORAGE_KEY_BRANCHES = 'crm_pos_branches_v20';
export const STORAGE_KEY_USERS = 'crm_pos_users_v20';
export const STORAGE_KEY_LOGS = 'crm_pos_logs_v20';
export const STORAGE_KEY_WEBHOOKS = 'crm_pos_mobile_webhooks_v20';
export const STORAGE_KEY_NOTIFS = 'crm_pos_notifs_v20';
export const STORAGE_KEY_HISTORICAL_MERCHANTS = 'crm_pos_historical_merchants_v20';
export const STORAGE_KEY_STAGE_SUMMARY = 'crm_pos_stage_summary_v20';
export const STORAGE_KEY_SETTINGS = 'crm_pos_settings_v20';
export const STORAGE_KEY_AUTH_SESSION = 'crm_pos_auth_session_v20';
export const STORAGE_KEY_PUSHED_CONFIGURING = 'crm_pos_pushed_configuring_serials_v1';
export const STORAGE_KEY_PUSH_TRACKING = 'crm_pos_push_tracking_v1';
export const STORAGE_KEY_ACTIVE_TAB = 'crm_pos_active_tab_v20';
export const STORAGE_KEY_SETTINGS_SUB_TAB = 'crm_pos_settings_sub_tab_v20';

export const VALID_TABS = new Set([
  'dashboard',
  'merchants',
  'merchant_history',
  'mobile_sync',
  'mobile_sync_sb',
  'mobile_sync_khqr',
  'mobile_sync_cc',
  'mobile_sync_visit',
  'kpi_performance',
  'inventory',
  'inventory_pos',
  'inventory_sb',
  'sim_cards',
  'push_configuring',
  'requisitions',
  'branches',
  'users',
  'iam',
  'audit_log',
  'settings',
  'brand_logo',
]);

export const HIDE_STAGE_HEADER_TABS = new Set([
  'dashboard',
  'kpi_performance',
  'mobile_sync',       // (5 Nov 2026) POS / Sound Box review: own header with the phone app figures, like KHQR
  'mobile_sync_sb',
  'sim_cards',
  'merchants',
  'merchant_history',
  'push_configuring',
  'requisitions',
  'mobile_sync_khqr',
  'mobile_sync_cc',
  'mobile_sync_visit',
  'users',
  'iam',
  'audit_log',
  'settings',
  'branches',
]);

export const VALID_SETTINGS_SUB_TABS = new Set<SettingsSubTab>([
  'policy',
  'brand_logo',
  'hardware',
  'sla',
  'customFields',
  'data',
  'security',
  'health',
]);

export interface StoredAuthSession {
  role: UserRole;
  operatorLabel: string;
  branchId: string;
  username: string;
}

export const getInitialAuthSession = (): StoredAuthSession | null => {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY_AUTH_SESSION) ||
      sessionStorage.getItem(STORAGE_KEY_AUTH_SESSION);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.role && parsed.operatorLabel) {
        // Banking Security Hardening (local preview only): with the shared database the role comes from the server's
        // staff profile and the database's access rules enforce it, so no browser-side whitelist applies there
        if (!isSupabaseConfigured && parsed.role === 'SUPER_ADMIN') {
          const isWhitelisted =
            parsed.username === '8986' ||
            parsed.username === '5546' ||
            parsed.operatorLabel?.includes('8986') ||
            parsed.operatorLabel?.includes('5546');
          if (!isWhitelisted) {
            console.warn('[Security Audit] Unauthorized SUPER_ADMIN session downgraded to BRANCH officer.');
            parsed.role = 'BRANCH';
          }
        }
        return parsed;
      }
    }
  } catch (e) {
    console.error('Failed to parse initial auth session:', e);
  }
  return null;
};

export const INITIAL_WEBHOOK_EVENTS: MobileWebhookEvent[] = [];

/** Whole months between two YYYY-MM-DD dates (0 when a date is missing). */
export const monthsBetween = (from?: string, to?: string): number => {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(from || ''); const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(to || '');
  if (!a || !b) return 0;
  const m = (+b[1] - +a[1]) * 12 + (+b[2] - +a[2]) - (+b[3] < +a[3] ? 1 : 0);
  return Math.max(0, m);
};
/** A merchant-history record made from the unit's real details (22 Oct 2026: nothing is filled in with sample values). */
export const historyRecordFor = (
  d: Device,
  o: { reason: string; status: HistoricalMerchantRecord['status']; actor: string; notes?: string; date?: string }
): HistoricalMerchantRecord => {
  const returnedDate = o.date || todayPP();
  const installedDate = d.deployedDate || '';
  return {
    recordId: newRecordId('MREC'),
    merchantName: d.merchantName || '',
    merchantPhone: d.merchantPhone || '',
    address: d.address || '',
    mid: d.mid,
    tid: d.tid || '',
    deviceType: d.type,
    model: d.model,
    serial: d.serial,
    batterySerial: d.batterySerial,
    branchId: d.branchId,
    branchName: d.branchName,
    installedDate,
    returnedDate,
    activeDurationMonths: monthsBetween(installedDate, returnedDate),
    returnReason: o.reason.replace(/^Returned:\s*/i, ''),
    status: o.status,
    handledByStaff: o.actor,
    installedByStaff: d.installedByStaff || undefined,
    replacedByStaff: d.replacedByStaff,
    returnedByStaff: o.actor,
    settlementFinalized: false,
    notes: o.notes || '',
  };
};
/** Shown for a moment while a screen opened for the first time is fetched; reserves viewport height to prevent footer CLS. */
// (23 Nov 2026) the shape of a portal screen (title, figure cards, list) with soft placeholders; it appears only when a
// screen's code takes longer than 120 ms to arrive, so a quick switch never flashes it
export const TabLoading = () => (
  <div className="space-y-4 min-h-[calc(100vh-11rem)] loading-in" aria-busy="true" aria-label="Loading">
    <div className="skeleton h-9 rounded-xl w-1/3" />
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3.5">
      {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-[92px] rounded-[18px]" />)}
    </div>
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 space-y-3">
      {[92, 80, 86, 74, 88, 70].map((w, i) => <div key={i} className="skeleton h-4 rounded" style={{ width: `${w}%` }} />)}
    </div>
  </div>
);
export const loadServerAuditLogs = (limit = 50, offset = 0) => fetchAuditLogs(limit, offset);
/** A server staff account in the shape the screens use (no password: sign-in is handled by the server). */
export const staffToUser = (a: StaffAccount, branchName?: string): User => {
  let location = 'Phnom Penh';
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('staff_locations_map_v1') : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && typeof parsed[a.empId] === 'string' && parsed[a.empId].trim()) {
        location = parsed[a.empId].trim();
      }
    }
  } catch {
    // ignore storage errors
  }
  return {
    uid: a.userId, empId: a.empId, name: a.name, label: `${a.name} (${a.empId})`, accessRole: a.role,
    branchId: a.branchId, branchName: a.branchId === '100' ? 'Head Office' : branchName || `Branch ${a.branchId}`,
    position: a.position || '', contact: a.contact || '', telegramUsername: a.telegramUsername || undefined,
    location,
    status: a.active ? (a.mustChangePassword ? 'Pending' : 'Operating') : 'Suspended',
    updatedAt: (a.updatedAt || '').slice(0, 10),
  };
};


export const INITIAL_NOTIFICATIONS: SystemNotification[] = [];

/** The signed-in staff profile, given by AuthGate when the shared database is configured. */
export interface AppProfile { user_id: string; emp_id: string; name: string; role: UserRole; branch_id: string }
export const sessionFromProfile = (p: AppProfile): StoredAuthSession => ({ role: p.role, operatorLabel: `${p.name} (${p.emp_id})`, branchId: p.branch_id, username: p.emp_id });

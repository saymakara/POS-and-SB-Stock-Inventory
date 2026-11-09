// (07 Nov 2026, refactor) Setup of the portal shell, moved out of App.tsx unchanged: lazy page registry, storage keys,
// tab lists, the saved sign-in session and small helpers used by App.
import React from 'react';
import { Device, UserRole, User, MobileWebhookEvent, SystemNotification, HistoricalMerchantRecord } from '../types';
import { todayPP } from '../utils/time';
import { newRecordId } from '../utils/ids';
import type { SettingsSubTab } from '../components/SettingsTab';
import { prefetchKhqr } from '../services/khqrCache';
import { prefetchCc } from '../services/ccService';
import { prefetchKpi } from '../services/kpiService';
import { prefetchSims } from '../services/materialsService';
import { isSupabaseConfigured } from '../lib/supabase';
import { fetchAuditLogs, StaffAccount } from '../services/supabaseService';


/** (31 Oct 2026) True when a save failed because there is no connection (not because the server refused it). */
export const isNetworkFailure = (err?: string): boolean =>
  (typeof navigator !== 'undefined' && navigator.onLine === false) ||
  /failed to fetch|networkerror|network request failed|load failed|fetch failed|offline/i.test(err || '');

// (22 Oct 2026, review) Screens other than the Dashboard and Stock Inventory are loaded when first opened, and fetched
// quietly in the background right after start-up, so the app opens faster and switching tabs is still instant.
export const tabLoaders: Array<() => Promise<unknown>> = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyTab<C extends React.ComponentType<any>>(load: () => Promise<{ default: C }>) {
  // (7 Nov 2026) one download shared by the background fetch and the screen; once it is here the screen is drawn at once
  // (React.lazy alone showed its loading placeholder for a frame the first time, even when already downloaded - a flicker)
  let loaded: C | null = null;
  let pending: Promise<{ default: C }> | null = null;
  const once = () => (pending ??= load().then((m) => { loaded = m.default; return m; }, (e) => { pending = null; throw e; }));
  tabLoaders.push(once);
  const Lazy = React.lazy(once);
  const Tab = (props: React.ComponentProps<C>) => React.createElement((loaded || Lazy) as React.ComponentType<any>, props);
  return Tab as unknown as C;
}
export function prefetchTabs(): void {
  tabLoaders.forEach((load) => { load().catch(() => { /* loaded again when opened */ }); });
  prefetchKhqr();                                                   // (29 Oct 2026) the KHQR screen opens with its data already here
  prefetchCc();                                                     // (1 Nov 2026) the Credit Card screen opens with its data already here
  prefetchKpi();
  prefetchSims();                                                    // (1 Nov 2026) the KPI Performance screen opens with its data already here
}
export const BranchesTab = lazyTab(() => import('../components/BranchesTab').then((m) => ({ default: m.BranchesTab })));
export const IamUsersTab = lazyTab(() => import('../components/IamUsersTab').then((m) => ({ default: m.IamUsersTab })));
export const MerchantsCrmTab = lazyTab(() => import('../components/MerchantsCrmTab').then((m) => ({ default: m.MerchantsCrmTab })));
export const MerchantHistoryTab = lazyTab(() => import('../components/MerchantHistoryTab').then((m) => ({ default: m.MerchantHistoryTab })));
export const RequisitionsTab = lazyTab(() => import('../components/RequisitionsTab').then((m) => ({ default: m.RequisitionsTab })));
export const MobileSyncTab = lazyTab(() => import('../components/MobileSyncTab').then((m) => ({ default: m.MobileSyncTab })));
export const LogoPageTab = lazyTab(() => import('../components/LogoPageTab').then((m) => ({ default: m.LogoPageTab })));
export const AuditLogTab = lazyTab(() => import('../components/AuditLogTab').then((m) => ({ default: m.AuditLogTab })));
export const SettingsTab = lazyTab(() => import('../components/SettingsTab').then((m) => ({ default: m.SettingsTab })));
export const FieldReviewTab = lazyTab(() => import('../components/FieldReviewTab').then((m) => ({ default: m.FieldReviewTab })));
export const KhqrReviewTab = lazyTab(() => import('../components/KhqrReviewTab').then((m) => ({ default: m.KhqrReviewTab })));
export const CreditCardReviewTab = lazyTab(() => import('../components/CreditCardReviewTab').then((m) => ({ default: m.CreditCardReviewTab })));
// (5 Nov 2026) Stock Inventory → POS Terminal / Sound Box (units + materials), SIM Card
export const SimCardTab = lazyTab(() => import('../components/SimCardTab').then((m) => ({ default: m.SimCardTab })));
export const MerchantVisitTab = lazyTab(() => import('../components/MerchantVisitTab').then((m) => ({ default: m.MerchantVisitTab })));
export const KpiPerformanceTab = lazyTab(() => import('../components/KpiPerformanceTab').then((m) => ({ default: m.KpiPerformanceTab })));
export const StaffAccountsTab = lazyTab(() => import('../components/StaffAccountsTab').then((m) => ({ default: m.StaffAccountsTab })));
export const PushConfiguringTab = lazyTab(() => import('../components/PushConfiguringTab').then((m) => ({ default: m.PushConfiguringTab })));
export const TraceModal = lazyTab(() => import('../components/TraceModal').then((m) => ({ default: m.TraceModal })));
export const WorkflowModal = lazyTab(() => import('../components/WorkflowModal').then((m) => ({ default: m.WorkflowModal })));
export const ChangeBatteryModal = lazyTab(() => import('../components/ChangeBatteryModal').then((m) => ({ default: m.ChangeBatteryModal })));
export const ExportDataModal = lazyTab(() => import('../components/ExportDataModal').then((m) => ({ default: m.ExportDataModal })));
export const BatchUploadModal = lazyTab(() => import('../components/BatchUploadModal').then((m) => ({ default: m.BatchUploadModal })));
export const RequestStockModal = lazyTab(() => import('../components/RequestStockModal').then((m) => ({ default: m.RequestStockModal })));

// (29 Oct 2026, speed review) "reload only what changed": after the first full load the browser keeps its copy of the stock
// (IndexedDB) and asks the server only for units changed since. A full reload still happens when there is no usable copy, when the
// unit count does not match the server, after a refused save, or every 12 hours. Set to false to always reload everything.
export const DELTA_SYNC_ENABLED = true;
export const KEY_DEVICES_FULL_AT = 'crm_pos_devices_full_at_v1';
export const DELTA_FULL_RELOAD_AFTER_MS = 12 * 60 * 60 * 1000;
export const DELTA_OVERLAP_MS = 10 * 60 * 1000;     // a change committed late still carries its (older) start time: look back 10 minutes
export const DELTA_MAX_ROWS = 3000;
// resolved when the saved copy has been read, so the first reload can start from it
export let markCacheHydrated: () => void = () => {};
export const cacheHydrated: Promise<void> = new Promise<void>((resolve) => { markCacheHydrated = resolve; });
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
/** Shown for a moment while a screen opened for the first time is fetched. */
export const TabLoading = () => (
  <div className="space-y-3" aria-busy="true" aria-label="Loading">
    <div className="skeleton h-10 rounded-xl w-1/3" />
    <div className="skeleton h-64 rounded-2xl" />
  </div>
);
export const loadServerAuditLogs = (limit = 50, offset = 0) => fetchAuditLogs(limit, offset);
/** A server staff account in the shape the screens use (no password: sign-in is handled by the server). */
export const staffToUser = (a: StaffAccount, branchName?: string): User => ({
  uid: a.userId, empId: a.empId, name: a.name, label: `${a.name} (${a.empId})`, accessRole: a.role,
  branchId: a.branchId, branchName: a.branchId === '100' ? 'Head Office' : branchName || `Branch ${a.branchId}`,
  position: a.position || '', contact: a.contact || '', telegramUsername: a.telegramUsername || undefined, status: a.active ? (a.mustChangePassword ? 'Pending' : 'Operating') : 'Suspended',
  updatedAt: (a.updatedAt || '').slice(0, 10),
});


export const INITIAL_NOTIFICATIONS: SystemNotification[] = [];

/** The signed-in staff profile, given by AuthGate when the shared database is configured. */
export interface AppProfile { user_id: string; emp_id: string; name: string; role: UserRole; branch_id: string }
export const sessionFromProfile = (p: AppProfile): StoredAuthSession => ({ role: p.role, operatorLabel: `${p.name} (${p.emp_id})`, branchId: p.branch_id, username: p.emp_id });

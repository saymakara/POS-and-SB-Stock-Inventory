import React, { Suspense, useState, useMemo, useEffect, useCallback, useDeferredValue } from 'react';
import {
  Device,
  Branch,
  Requisition,
  UserRole,
  LifecycleStage,
  User,
  UserStatus,
  ThemeMode,
  MobileWebhookEvent,
  MobileInstallSyncPayload,
  SystemNotification,
  ArrangedDeviceItem,
  HistoricalMerchantRecord,
  AppSettings,
} from './types';
import {
  buildInitialBranches,
  buildInitialDevices,
  createInitialRequisitions,
  buildInitialUsers,
  STAGE_META,
} from './data/initialData';
import {
  INITIAL_HISTORICAL_MERCHANTS,
  DEFAULT_APP_SETTINGS,
} from './data/historicalMerchantsData';
import { todayPP, stampPP, stampSecPP } from './utils/time';
import { newRecordId } from './utils/ids';
import { canMove, moveError, statusOf, onMove } from './utils/stages';
import { csvFile } from './utils/csv';
import { tidFromMid } from './utils/tid';
import { TraceModal } from './components/TraceModal';
import { SaveGuard, throttled, watchNewVersion } from './utils/saveGuard';
import { phoneFor } from './utils/privacy';
import type { MerchantBindPayload } from './components/MerchantsCrmTab';
import { Header, Sidebar } from './components/Header';
import { PipelineBar } from './components/PipelineBar';
import { KpiCards } from './components/KpiCards';
import { DashboardTab } from './components/DashboardTab';
import { InventoryTab } from './components/InventoryTab';
import { WorkflowModal } from './components/WorkflowModal';
import { ChangeBatteryModal } from './components/ChangeBatteryModal';
import { ExportDataModal } from './components/ExportDataModal';
import { BatchUploadModal } from './components/BatchUploadModal';
import { RequestStockModal } from './components/RequestStockModal';
import { SessionLockModal } from './components/SessionLockModal';
import type { SettingsSubTab } from './components/SettingsTab';
import { SignInPage } from './components/SignInPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { motion, AnimatePresence } from 'motion/react';

// (22 Oct 2026, review) Screens other than the Dashboard and Stock Inventory are loaded when first opened, and fetched
// quietly in the background right after start-up, so the app opens faster and switching tabs is still instant.
const tabLoaders: Array<() => Promise<unknown>> = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyTab<C extends React.ComponentType<any>>(load: () => Promise<{ default: C }>) {
  tabLoaders.push(load);
  return React.lazy(load);
}
export function prefetchTabs(): void {
  tabLoaders.forEach((load) => { load().catch(() => { /* loaded again when opened */ }); });
}
const BranchesTab = lazyTab(() => import('./components/BranchesTab').then((m) => ({ default: m.BranchesTab })));
const IamUsersTab = lazyTab(() => import('./components/IamUsersTab').then((m) => ({ default: m.IamUsersTab })));
const MerchantsCrmTab = lazyTab(() => import('./components/MerchantsCrmTab').then((m) => ({ default: m.MerchantsCrmTab })));
const MerchantHistoryTab = lazyTab(() => import('./components/MerchantHistoryTab').then((m) => ({ default: m.MerchantHistoryTab })));
const RequisitionsTab = lazyTab(() => import('./components/RequisitionsTab').then((m) => ({ default: m.RequisitionsTab })));
const MobileSyncTab = lazyTab(() => import('./components/MobileSyncTab').then((m) => ({ default: m.MobileSyncTab })));
const LogoPageTab = lazyTab(() => import('./components/LogoPageTab').then((m) => ({ default: m.LogoPageTab })));
const AuditLogTab = lazyTab(() => import('./components/AuditLogTab').then((m) => ({ default: m.AuditLogTab })));
const SettingsTab = lazyTab(() => import('./components/SettingsTab').then((m) => ({ default: m.SettingsTab })));
const FieldReviewTab = lazyTab(() => import('./components/FieldReviewTab').then((m) => ({ default: m.FieldReviewTab })));
const StaffAccountsTab = lazyTab(() => import('./components/StaffAccountsTab').then((m) => ({ default: m.StaffAccountsTab })));

import { SendHorizontal, Lock } from 'lucide-react';
import { isSupabaseConfigured } from './lib/supabase';
import {
  fetchDevicesFromSupabase,
  fetchDevicesPageFromSupabase,
  fetchDeviceStageCountsFromSupabase,
  type DeviceStageSummary,
  type DeviceQueryParams,
  fetchRequisitionsFromSupabase,
  subscribeToRealtimeChanges,
  saveDevicesStrict,
  saveRequisitionStrict,
  deleteDevicesOnServer,
  confirmReceiptOnServer,
  writeAuditLog,
  fetchHistoricalMerchantsFromSupabase,
  insertHistoricalMerchantToSupabase,
  deleteAllHistoricalMerchantsOnServer,
  countPendingFieldEvents,
  fetchAuditLogs,
  subscribeToFieldEvents,
  dispatchRequisitionOnServer,
  rejectRequisitionOnServer,
  receiveReturnOnServer,
  fetchBranchesFromSupabase,
  saveBranchOnServer,
  fetchStaffAccounts,
  StaffAccount,
  renameDeviceSerialOnServer,
  subscribeToOnlinePresence,
  measureSupabasePingMs,
  OnlineOperatorPresence,
} from './services/supabaseService';
import { signOutEverywhere, clearLocalCaches } from './components/AuthGate';
import {
  setErrorLoggerContext,
  subscribeTechnicalErrorPopup,
  TechnicalErrorPayload,
  sendDeviceConfigTelegramAlert,
} from './utils/errorLogger';
import { SetupAlert } from './components/SetupAlert';
import {
  loadDevicesFromIdb,
  saveDevicesToIdb,
  clearDevicesFromIdb,
} from './utils/idbStorage';

const STORAGE_KEY_DEVICES = 'crm_pos_devices_v20';
const STORAGE_KEY_REQS = 'crm_pos_reqs_v20';
const STORAGE_KEY_BRANCHES = 'crm_pos_branches_v20';
const STORAGE_KEY_USERS = 'crm_pos_users_v20';
const STORAGE_KEY_LOGS = 'crm_pos_logs_v20';
const STORAGE_KEY_WEBHOOKS = 'crm_pos_mobile_webhooks_v20';
const STORAGE_KEY_NOTIFS = 'crm_pos_notifs_v20';
const STORAGE_KEY_HISTORICAL_MERCHANTS = 'crm_pos_historical_merchants_v20';
const STORAGE_KEY_SETTINGS = 'crm_pos_settings_v20';
const STORAGE_KEY_AUTH_SESSION = 'crm_pos_auth_session_v20';

interface StoredAuthSession {
  role: UserRole;
  operatorLabel: string;
  branchId: string;
  username: string;
}

const getInitialAuthSession = (): StoredAuthSession | null => {
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

const INITIAL_WEBHOOK_EVENTS: MobileWebhookEvent[] = [];

/** Whole months between two YYYY-MM-DD dates (0 when a date is missing). */
const monthsBetween = (from?: string, to?: string): number => {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(from || ''); const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(to || '');
  if (!a || !b) return 0;
  const m = (+b[1] - +a[1]) * 12 + (+b[2] - +a[2]) - (+b[3] < +a[3] ? 1 : 0);
  return Math.max(0, m);
};
/** A merchant-history record made from the unit's real details (22 Oct 2026: nothing is filled in with sample values). */
const historyRecordFor = (
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
const TabLoading = () => (
  <div className="space-y-3" aria-busy="true" aria-label="Loading">
    <div className="skeleton h-10 rounded-xl w-1/3" />
    <div className="skeleton h-64 rounded-2xl" />
  </div>
);
const TERMINATION_REASON = /clos|terminat|franchise|seasonal|cancel/i;
const loadServerAuditLogs = (limit = 50, offset = 0) => fetchAuditLogs(limit, offset);
/** A server staff account in the shape the screens use (no password: sign-in is handled by the server). */
const staffToUser = (a: StaffAccount, branchName?: string): User => ({
  uid: a.userId, empId: a.empId, name: a.name, label: `${a.name} (${a.empId})`, accessRole: a.role,
  branchId: a.branchId, branchName: a.branchId === '100' ? 'Head Office' : branchName || `Branch ${a.branchId}`,
  position: a.position || '', contact: a.contact || '', status: a.active ? (a.mustChangePassword ? 'Pending' : 'Operating') : 'Suspended',
  updatedAt: (a.updatedAt || '').slice(0, 10),
});


const INITIAL_NOTIFICATIONS: SystemNotification[] = [];

/** The signed-in staff profile, given by AuthGate when the shared database is configured. */
export interface AppProfile { user_id: string; emp_id: string; name: string; role: UserRole; branch_id: string }
const sessionFromProfile = (p: AppProfile): StoredAuthSession => ({ role: p.role, operatorLabel: `${p.name} (${p.emp_id})`, branchId: p.branch_id, username: p.emp_id });

export function App({ profile }: { profile?: AppProfile | null } = {}) {
  // (22 Oct 2026) with the shared database the session is the server profile (never the browser's stored copy)
  const bootSession = React.useRef<StoredAuthSession | null | undefined>(undefined);
  if (bootSession.current === undefined) bootSession.current = profile ? sessionFromProfile(profile) : getInitialAuthSession();
  const getBootSession = () => bootSession.current || null;
  // Always use Light Mode (Single theme as before)
  const theme: ThemeMode = 'light';

  useEffect(() => {                                                  // the other screens arrive while the first one is in use
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    const t = w.requestIdleCallback ? w.requestIdleCallback(prefetchTabs, { timeout: 2500 }) : window.setTimeout(prefetchTabs, 1200);
    return () => { if (!w.requestIdleCallback) window.clearTimeout(t); };
  }, []);

  useEffect(() => {
    try {
      localStorage.removeItem('pos_apple_glass_theme');
    } catch {}
    document.documentElement.removeAttribute('data-apple-theme');
    document.documentElement.classList.remove('dark');
  }, []);

  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return Boolean(getBootSession());
  });
  const [isSessionLocked, setIsSessionLocked] = useState<boolean>(false);
  const [authUsername, setAuthUsername] = useState<string>(() => {
    return getBootSession()?.operatorLabel || '';
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState<boolean>(false);

  const handleToggleSidebar = useCallback(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setMobileDrawerOpen((prev) => !prev);
    } else {
      setSidebarCollapsed((prev) => !prev);
    }
  }, []);

  const [users, setUsers] = useState<User[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_USERS);
      if (saved) {
        const parsed: User[] = JSON.parse(saved);
        return parsed.map((u) => ({
          ...u,
          branchName: u.branchId === '100' ? 'Head Office' : u.branchName,
          password: u.password || u.empId,
        }));
      }
    } catch (e) {
      console.error(e);
    }
    return buildInitialUsers();
  });

  const [branches, setBranches] = useState<Branch[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_BRANCHES);
      if (saved) {
        const parsed: Branch[] = JSON.parse(saved);
        return parsed.map((b) => ({
          ...b,
          name: b.id === '100' ? 'Head Office' : b.name,
        }));
      }
    } catch (e) {
      console.error(e);
    }
    return buildInitialBranches(buildInitialUsers());
  });

  const [devices, setDevices] = useState<Device[]>(() => {
    if (isSupabaseConfigured) return [];                               // (21 Oct 2026) the stock comes from the database only
    try {
      // Purge any legacy benchmark cache
      localStorage.removeItem('crm_pos_devices_v11');
      const saved = localStorage.getItem(STORAGE_KEY_DEVICES);
      if (saved) {
        const parsed: Device[] = JSON.parse(saved);
        return parsed.map((d, idx) => {
          const isSoundBox = d.type === 'Sound Box';
          // Normalize serial to WP5400PQ format if old POS-
          const serial = d.serial.startsWith('POS-')
            ? `WP5400PQ${23200297 + idx}`
            : d.serial;
          // Ensure 15-digit MID
          let mid = d.mid || '';
          if (mid && !/^\d{15}$/.test(mid)) {
            const digits = mid.replace(/\D/g, '');
            mid = `100000880${d.branchId || '101'}${digits.slice(-3).padStart(3, '0')}`;
          }
          // Normalize battery serial to standard format
          const batterySerial = !d.batterySerial || d.batterySerial.startsWith('BAT-')
            ? (isSoundBox ? `SB-BAT-${serial}` : `160525A${String(5709 + idx).padStart(7, '0')}`)
            : d.batterySerial;
          const stage = ((d.stage as string) === 'OUT_FOR_INSTALL'
            ? 'CONFIGURING'
            : d.serial === 'WP5400PQ23200305' || (d.stage === 'FAULTY' && !d.merchantName && d.returnReason === 'Merchant Closed Business')
            ? 'BRANCH_RESERVE'
            : d.stage) as LifecycleStage;
          return {
            ...d,
            serial,
            batterySerial,
            mid,
            stage,
            type: (isSoundBox ? 'Sound Box' : 'POS Terminal') as Device['type'],
            model: d.model || (isSoundBox ? 'Aisino S90' : 'Wizar POS Q2 Pro'),
            branchName: d.branchId === '100' ? 'Head Office' : d.branchName,
          };
        });
      }
    } catch (e) {
      console.error(e);
    }
    return buildInitialDevices(buildInitialBranches(buildInitialUsers()));
  });

  const [requisitions, setRequisitions] = useState<Requisition[]>(() => {
    if (isSupabaseConfigured) return [];
    try {
      const saved = localStorage.getItem(STORAGE_KEY_REQS);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return createInitialRequisitions();
  });

  const [traceQuery, setTraceQuery] = useState('');
  const [workflowPreset, setWorkflowPreset] = useState<'' | 'RETURN'>('');
  const [auditLogs, setAuditLogs] = useState<string[]>(() => {
    try {
      if (isSupabaseConfigured) return [];                             // (review) the server keeps the audit log
      const saved = localStorage.getItem(STORAGE_KEY_LOGS);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return [];
  });

  const [webhookEvents, setWebhookEvents] = useState<MobileWebhookEvent[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_WEBHOOKS);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return INITIAL_WEBHOOK_EVENTS;
  });

  const [notifications, setNotifications] = useState<SystemNotification[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_NOTIFS);
      if (saved) {
        const parsed: SystemNotification[] = JSON.parse(saved);
        const filtered = parsed.filter((n) => n.category === 'REQUEST');
        if (filtered.length > 0) return filtered;
      }
    } catch (e) {
      console.error(e);
    }
    return INITIAL_NOTIFICATIONS;
  });

  const [historicalMerchants, setHistoricalMerchants] = useState<HistoricalMerchantRecord[]>(() => {
    if (isSupabaseConfigured) return [];
    try {
      const saved = localStorage.getItem(STORAGE_KEY_HISTORICAL_MERCHANTS);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return INITIAL_HISTORICAL_MERCHANTS;
  });

  const [appSettings, setAppSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SETTINGS);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...DEFAULT_APP_SETTINGS,
          ...parsed,
          logoPresetId:
            !parsed.logoPresetId || parsed.logoPresetId === 'fintech-pulse'
              ? 'quantum-sound'
              : parsed.logoPresetId,
          customFields:
            parsed.customFields && Array.isArray(parsed.customFields) && parsed.customFields.length > 0
              ? parsed.customFields
              : DEFAULT_APP_SETTINGS.customFields,
        };
      }
    } catch (e) {
      console.error(e);
    }
    return DEFAULT_APP_SETTINGS;
  });

  const [sseConnected, setSseConnected] = useState<boolean>(true);

  useEffect(() => {
    if (isSupabaseConfigured) return;
    try {
      localStorage.setItem(
        STORAGE_KEY_HISTORICAL_MERCHANTS,
        JSON.stringify(historicalMerchants)
      );
    } catch (e) {
      console.error(e);
    }
  }, [historicalMerchants]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(appSettings));
    } catch (e) {
      console.error(e);
    }

    try {
      if (appSettings.customLogoUrl) {
        let link: HTMLLinkElement | null = document.querySelector("link[rel*='icon']");
        if (!link) {
          link = document.createElement('link');
          link.type = 'image/svg+xml';
          link.rel = 'icon';
          document.head.appendChild(link);
        }
        link.href = appSettings.customLogoUrl;
      }
    } catch (e) {
      // ignore
    }
  }, [appSettings]);

  useEffect(() => {
    // (21 Oct 2026) the phone app's records come through the database (Phone App Review); the old /api/v1 stream needs a
    // server that GitHub Pages cannot run, so it is only used in the local preview
    if (isSupabaseConfigured) { setSseConnected(false); return; }
    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/v1/stream');
      es.onopen = () => setSseConnected(true);
      es.onerror = () => setSseConnected(false);
      es.addEventListener('installation:updated', (evt: MessageEvent) => {
        try {
          const incoming: MobileWebhookEvent = JSON.parse(evt.data);
          setWebhookEvents((prev) => {
            if (prev.some((e) => e.eventId === incoming.eventId)) return prev;
            return [incoming, ...prev.slice(0, 99)];
          });
        } catch {
          // ignore malformed event
        }
      });
    } catch {
      setSseConnected(false);
    }
    return () => {
      es?.close();
    };
  }, []);


  // (21 Oct 2026) The shared database is the record. Everything is loaded from it (nothing from this browser is pushed
  // up), live changes come in from it, and every change made here goes back to it (see the change watchers below).
  const syncedDevices = React.useRef<Map<string, Device>>(new Map());
  const syncedReqs = React.useRef<Map<string, Requisition>>(new Map());
  const syncedHist = React.useRef<Set<string>>(new Set());
  // (22 Oct 2026, review) every copy that came FROM the server (load or live feed). Such a copy is never sent back:
  // before, a screen update that was still running with the previous list could send a unit's old copy back right after
  // another user changed it – the server refused it as stale, a "changed by someone else" message appeared and the
  // whole stock was reloaded on every viewer's screen.
  const serverCopies = React.useRef<WeakSet<object>>(new WeakSet());
  const [serverReady, setServerReady] = useState<boolean>(false);
  const [serverError, setServerError] = useState<string>('');
  const [pendingFieldCount, setPendingFieldCount] = useState<number>(0);
  const [onlineOperators, setOnlineOperators] = useState<OnlineOperatorPresence[]>([]);
  const [pingMs, setPingMs] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    measureSupabasePingMs().then((ms) => {
      if (alive && ms !== null) setPingMs(ms);
    });
    const pingTimer = window.setInterval(() => {
      measureSupabasePingMs().then((ms) => {
        if (alive && ms !== null) setPingMs(ms);
      });
    }, 45000);
    const unsubPresence = subscribeToOnlinePresence(
      {
        id: profile?.emp_id || authUsername || 'OP-100',
        name: profile?.name || authUsername || 'System Operator',
        role: profile?.role || 'SUPER_ADMIN',
        branchId: profile?.branch_id || '100',
        location: 'Phnom Penh',
      },
      (list) => {
        if (alive) setOnlineOperators(list);
      }
    );
    return () => {
      alive = false;
      window.clearInterval(pingTimer);
      unsubPresence();
    };
  }, [profile?.emp_id, profile?.name, profile?.role, profile?.branch_id, authUsername]);
  const [serverDeviceTotal, setServerDeviceTotal] = useState<number | null>(null);
  const [serverStageSummary, setServerStageSummary] = useState<DeviceStageSummary | null>(null);

  // versions this browser's own saves produced (serial → sent version → new version): a later edit of the same unit
  // made from the older copy is sent with the right version, while a change by someone else is still refused
  const versionAlias = React.useRef<Map<string, Map<number, number>>>(new Map());
  const reloadFromServer = useCallback(async (): Promise<boolean> => {
    versionAlias.current = new Map();
    const isAdminProfile = profile?.role === 'SUPER_ADMIN' || profile?.role === 'ADMIN';
    const [devs, reqs, hist, srvBranches, staff] = await Promise.all([
      fetchDevicesFromSupabase(1000, 0, (firstBatch, total) => {
        setServerDeviceTotal(total);
        syncedDevices.current = new Map(firstBatch.map((d) => [d.serial, d]));
        firstBatch.forEach((d) => serverCopies.current.add(d));
        setDevices(firstBatch);
        setServerReady(true);
      }),
      fetchRequisitionsFromSupabase(),
      fetchHistoricalMerchantsFromSupabase(),
      fetchBranchesFromSupabase(),
      Promise.resolve(null),
    ]);
    if (isAdminProfile) {
      fetchStaffAccounts().then((staffList) => {
        if (staffList) {
          const bn = new Map((srvBranches || []).map((b) => [b.id, b.name]));
          setUsers(staffList.map((a: StaffAccount) => staffToUser(a, bn.get(a.branchId))));
        }
      });
    }
    const _unusedEnd = ([0, 1][0] && [
    ]);
    // (22 Oct 2026, review) the branch list and the staff are the server's: before, both came from a list built into
    // the app, so a branch added by one admin was never seen by another and the staff counts were not the real accounts
    if (srvBranches && srvBranches.length) {
      setBranches((prev) => {
        const local = new Map(prev.map((b) => [b.id, b]));
        return srvBranches.map((b) => ({ ...(local.get(b.id) || { staff: [], staffDetails: [] }), id: b.id, code: b.code, name: b.id === '100' ? 'Head Office' : b.name }));
      });
    }
    if (staff) {
      const bn = new Map((srvBranches || []).map((b) => [b.id, b.name]));
      setUsers(staff.map((a: StaffAccount) => staffToUser(a, bn.get(a.branchId))));
    }
    if (devs) {
      const devRows = devs;
      setServerDeviceTotal(devRows.length);
      syncedDevices.current = new Map(devRows.map((d) => [d.serial, d]));
      devRows.forEach((d) => serverCopies.current.add(d));
      setDevices(devRows);
      if (devRows.length >= 10000) {
        fetchDeviceStageCountsFromSupabase().then((summary) => {
          if (summary) {
            setServerStageSummary(summary);
            setServerDeviceTotal(summary.all + summary.archived);
          }
        });
      } else {
        setServerStageSummary(null);
      }
    }
    if (reqs) {
      syncedReqs.current = new Map(reqs.map((r) => [r.reqId, r]));
      reqs.forEach((r) => serverCopies.current.add(r));
      setRequisitions(reqs);
    }
    if (hist) {
      syncedHist.current = new Set(hist.map((h) => h.recordId));
      setHistoricalMerchants(hist);
    }
    return Boolean(devs && reqs && hist);
  }, [profile?.role]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let alive = true;
    let unsubscribe: () => void = () => {};
    let unsubscribeField: () => void = () => {};
    const countPending = () =>
      countPendingFieldEvents().then((n) => {
        if (alive && n !== null) setPendingFieldCount(n);
      });
    // (22 Oct 2026) a burst of phone records is counted once, at most every 15 seconds (fewer server requests)
    let countTimer: ReturnType<typeof setTimeout> | null = null;
    const countPendingSoon = () => {
      if (countTimer) return;
      countTimer = setTimeout(() => { countTimer = null; countPending(); }, 15000);
    };
    // (22 Oct 2026, review) Live changes are collected and applied together once per frame: a burst of changes
    // (a dispatch of 50 units, a bulk approval) is one screen update, not 50 copies of the whole list. The feed is
    // opened BEFORE the first load, so a change made while the stock is loading is not lost; an older copy of a unit
    // (lower version) never replaces a newer one.
    let loadedOnce = false;
    const pendingDev = new Map<string, Device | null>();               // serial → new copy, or null = deleted
    const pendingReq = new Map<string, Requisition | null>();
    let flushHandle: number | null = null;
    const flush = () => {
      flushHandle = null;
      if (!alive || !loadedOnce) return;
      if (pendingDev.size) {
        const batch = new Map(pendingDev); pendingDev.clear();
        batch.forEach((d, serial) => { if (d) syncedDevices.current.set(serial, d); else syncedDevices.current.delete(serial); });
        setDevices((prev) => {
          const next: Device[] = [];
          const seen = new Set<string>();
          for (const d of prev) {
            if (!batch.has(d.serial)) { next.push(d); continue; }
            seen.add(d.serial);
            const inc = batch.get(d.serial);
            if (!inc) continue;                                         // deleted on the server
            if ((d.rowVersion || 0) > (inc.rowVersion || 0)) {
              next.push(d);                                             // this copy is newer: keep it, and do not send it again
              syncedDevices.current.set(d.serial, d);
            } else next.push(inc);
          }
          const added: Device[] = [];
          batch.forEach((d, serial) => { if (d && !seen.has(serial)) added.push(d); });
          return added.length ? [...added, ...next] : next;
        });
      }
      if (pendingReq.size) {
        const batch = new Map(pendingReq); pendingReq.clear();
        batch.forEach((r, id) => { if (r) syncedReqs.current.set(id, r); else syncedReqs.current.delete(id); });
        setRequisitions((prev) => {
          const seen = new Set<string>();
          const next = prev.flatMap((r) => {
            if (!batch.has(r.reqId)) return [r];
            seen.add(r.reqId);
            const inc = batch.get(r.reqId);
            return inc ? [inc] : [];
          });
          const added: Requisition[] = [];
          batch.forEach((r, id) => { if (r && !seen.has(id)) added.push(r); });
          return added.length ? [...added, ...next] : next;
        });
      }
    };
    const scheduleFlush = () => {
      if (flushHandle !== null || !loadedOnce) return;
      flushHandle = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(flush) : (setTimeout(flush, 16) as unknown as number);
    };
    unsubscribe = subscribeToRealtimeChanges(
      (d) => { serverCopies.current.add(d); pendingDev.set(d.serial, d); scheduleFlush(); },
      (r) => { serverCopies.current.add(r); pendingReq.set(r.reqId, r); scheduleFlush(); },
      {
        onDeviceDelete: (serial) => { pendingDev.set(serial, null); scheduleFlush(); },
        onRequisitionDelete: (reqId) => { pendingReq.set(reqId, null); scheduleFlush(); },
        onHistoryInsert: (rec) => {
          syncedHist.current.add(rec.recordId);                         // (came from the server: not sent back)
          setHistoricalMerchants((prev) => (prev.some((h) => h.recordId === rec.recordId) ? prev : [rec, ...prev]));
        },
        onReconnect: () => {
          // the live feed was down for a while: changes made meanwhile were missed
          reloadFromServer().then((ok) => setServerError(ok ? '' : 'The connection to the server is unstable. Please reload the page.'));
        },
      }
    );
    (async () => {
      const loaded = await reloadFromServer();
      if (!alive) return;
      if (!loaded) {
        setServerError('The stock could not be loaded from the server. Nothing you change now is saved – please reload the page.');
        return;
      }
      setServerReady(true);
      loadedOnce = true;
      // changes that arrived while loading: keep only those newer than what was loaded
      pendingDev.forEach((d, serial) => {
        const have = syncedDevices.current.get(serial);
        if (d && have && (have.rowVersion || 0) >= (d.rowVersion || 0)) pendingDev.delete(serial);
      });
      scheduleFlush();
      countPending();
      unsubscribeField = subscribeToFieldEvents(() => countPendingSoon());
    })();

    return () => {
      alive = false;
      if (countTimer) clearTimeout(countTimer);
      if (flushHandle !== null) { try { cancelAnimationFrame(flushHandle); } catch { /* not a frame */ } }
      unsubscribe();
      unsubscribeField();
    };
  }, [reloadFromServer]);

  // High-Volume Device Hydration from IndexedDB (supports up to 500,000+ rows)
  useEffect(() => {
    if (isSupabaseConfigured) return;                                  // (21 Oct 2026) the database is the record
    let isMounted = true;
    loadDevicesFromIdb()
      .then((idbDevices) => {
        if (!isMounted) return;
        if (idbDevices && idbDevices.length > 0) {
          setDevices(idbDevices);
        }
      })
      .catch((err) => {
        console.warn('[IndexedDB Load Devices Warning]', err);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (isSupabaseConfigured) return;                                  // (22 Oct 2026) stock data is never cached in the browser
    if (devices.length > 0) {
      saveDevicesToIdb(devices).catch((err) =>
        console.warn('[IndexedDB Save Devices Warning]', err)
      );
    } else {
      clearDevicesFromIdb().catch(() => {});
    }

    try {
      if (devices.length <= 5000) {
        localStorage.setItem(STORAGE_KEY_DEVICES, JSON.stringify(devices));
      } else {
        localStorage.removeItem(STORAGE_KEY_DEVICES);
      }
    } catch (e) {
      // LocalStorage Quota Exceeded (Gracefully handled; IndexedDB stores up to 500K)
    }
  }, [devices]);

  useEffect(() => {
    if (isSupabaseConfigured) return;
    try {
      localStorage.setItem(STORAGE_KEY_REQS, JSON.stringify(requisitions));
    } catch (e) {
      console.error(e);
    }
  }, [requisitions]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_BRANCHES, JSON.stringify(branches));
    } catch (e) {
      console.error(e);
    }
  }, [branches]);

  useEffect(() => {
    if (isSupabaseConfigured) return;                                  // accounts live on the server (no passwords in the browser)
    try {
      localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(users));
    } catch (e) {
      console.error(e);
    }
  }, [users]);

  useEffect(() => {
    if (isSupabaseConfigured) return;                                  // (review) never left in a shared browser
    try {
      localStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(auditLogs));
    } catch (e) {
      console.error(e);
    }
  }, [auditLogs]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_WEBHOOKS, JSON.stringify(webhookEvents));
    } catch (e) {
      console.error(e);
    }
  }, [webhookEvents]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_NOTIFS, JSON.stringify(notifications));
    } catch (e) {
      console.error(e);
    }
  }, [notifications]);

  const [role, setRole] = useState<UserRole>(() => {
    return getBootSession()?.role || 'BRANCH';
  });
  const [selectedBranch, setSelectedBranch] = useState<string>(() => {
    return getBootSession()?.branchId || '105';
  });
  const [selectedStaffUser, setSelectedStaffUser] = useState<string>(() => {
    const session = getBootSession();
    if (session && session.role === 'BRANCH') {
      return session.operatorLabel;
    }
    return '';
  });
  const [activeAdminStaff, setActiveAdminStaff] = useState<string>(() => {
    const session = getBootSession();
    if (session && session.role !== 'BRANCH') {
      return session.operatorLabel;
    }
    return '';
  });
  const [activeTab, setActiveTabRaw] = useState<string>('dashboard');
  // (22 Oct 2026) changing page glides: the browser morphs the old page into the new one (View Transitions);
  // older browsers get a short CSS glide-in instead. Respects "reduce motion".
  const setActiveTab = useCallback((tab: string) => setActiveTabRaw(tab), []);
  // (23 Oct 2026) the menu highlight moves at once; the new page is prepared in the background (React keeps drawing
  // frames meanwhile, so nothing freezes) and glides in when ready
  const shownTab = useDeferredValue(activeTab);
  const [settingsSubTab, setSettingsSubTab] = useState<SettingsSubTab>('policy');

  const handleSelectTab = (tabId: string, subTab?: string) => {
    if ((tabId === 'settings' || tabId === 'brand_logo') && role !== 'SUPER_ADMIN') {
      triggerToast('Access Restricted: Settings is only accessible by Super Admin.');
      return;
    }
    if (tabId === 'brand_logo') {
      setSettingsSubTab('brand_logo');
      setActiveTab('settings');
      setMobileDrawerOpen(false);
      return;
    }
    if (tabId === 'settings' && subTab) {
      setSettingsSubTab(subTab as any);
    }
    setActiveTab(tabId);
    setMobileDrawerOpen(false);
  };

  useEffect(() => {
    if ((activeTab === 'settings' || activeTab === 'brand_logo') && role !== 'SUPER_ADMIN') {
      setActiveTabRaw('dashboard');
    } else if (activeTab === 'brand_logo') {
      setSettingsSubTab('brand_logo');
      setActiveTabRaw('settings');
    }
  }, [activeTab, role]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [activeAlertNotif, setActiveAlertNotif] = useState<SystemNotification | null>(null);

  // Inventory Filters
  const [stageFilter, setStageFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [branchFilter, setBranchFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals
  const [editingDeviceSerial, setEditingDeviceSerial] = useState<string | null>(null);
  const [batteryModalDevice, setBatteryModalDevice] = useState<Device | null>(null);
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [isReqModalOpen, setIsReqModalOpen] = useState(false);
  const [fulfillingRequisition, setFulfillingRequisition] = useState<Requisition | null>(null);
  const [stagedFulfillmentItems, setStagedFulfillmentItems] = useState<ArrangedDeviceItem[] | null>(null);
  const [isNewBranchModalOpen, setIsNewBranchModalOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  // Branch & User Modal Form State
  const [branchCodeInput, setBranchCodeInput] = useState('');
  const [branchNameInput, setBranchNameInput] = useState('');
  const [branchStaffInput, setBranchStaffInput] = useState('');

  const [userEmpIdInput, setUserEmpIdInput] = useState('');
  const [userNameInput, setUserNameInput] = useState('');
  const [userTitleInput, setUserTitleInput] = useState('MS Officer');
  const [userBranchInput, setUserBranchInput] = useState('105');
  const [userRoleInput, setUserRoleInput] = useState<UserRole>('BRANCH');
  const [userStatusInput, setUserStatusInput] = useState<UserStatus>('Operating');
  const [userPasswordInput, setUserPasswordInput] = useState('');

  const triggerToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 4000);
  }, []);

  const addNotification = useCallback(
    (
      title: string,
      message: string,
      category: SystemNotification['category'],
      branchId: string,
      targetTab?: string
    ) => {
      // Notification alert only when having request from branch
      if (category !== 'REQUEST') {
        return;
      }

      const notif: SystemNotification = {
        id: newRecordId('NOTIF'),
        title,
        message,
        category,
        timestamp: stampSecPP(),
        read: false,
        branchId,
        targetTab: targetTab || 'requisitions',
      };
      setNotifications((prev) => [notif, ...prev.slice(0, 59)]);
      setActiveAlertNotif(notif);
      setTimeout(() => {
        setActiveAlertNotif((prev) => (prev?.id === notif.id ? null : prev));
      }, 7000);
    },
    []
  );

  // (22 Oct 2026) the signed-in person, and what a branch account may act on (its own branch only)
  const operatorLabel = role === 'BRANCH' ? selectedStaffUser : activeAdminStaff || authUsername;
  const [techErrorPopup, setTechErrorPopup] = useState<TechnicalErrorPayload | null>(null);

  useEffect(() => {
    setErrorLoggerContext({
      staffId: profile?.emp_id || operatorLabel || authUsername || 'UNKNOWN_STAFF',
      staffName: profile?.name || operatorLabel || authUsername || 'Staff',
      role,
      branchId: selectedBranch,
    });
  }, [profile?.emp_id, profile?.name, operatorLabel, authUsername, role, selectedBranch]);

  useEffect(() => {
    return subscribeTechnicalErrorPopup((payload) => {
      setTechErrorPopup(payload);
    });
  }, []);
  const inScope = useCallback((d: Device | undefined) => Boolean(d) && (role !== 'BRANCH' || d!.branchId === selectedBranch), [role, selectedBranch]);

  const addAuditLog = useCallback(
    (actionTitle: string, detailText: string, customRole?: UserRole) => {
      const now = stampSecPP();
      const activeRole = customRole || role;
      const actorDesc =
        activeRole === 'SUPER_ADMIN'
          ? `Super Admin ${authUsername}`
          : activeRole === 'ADMIN'
          ? `Admin HQ ${activeAdminStaff}`
          : `Branch Code ${selectedBranch} (${selectedStaffUser || 'Staff'})`;
      setAuditLogs((prev) => [
        `${now} | ${actionTitle} | ${actorDesc} — ${detailText}`,
        ...prev.slice(0, 199),
      ]);
      // (21 Oct 2026) also in the server's audit log, where the database stamps who and when (nobody can edit it)
      // Error-Only Server Logging: only write to Supabase audit_logs when an actual error occurs
      if (/error|fail/i.test(actionTitle)) {
        void writeAuditLog(actionTitle, detailText, undefined, 'Error');
      }
    },
    [role, authUsername, activeAdminStaff, selectedBranch, selectedStaffUser]
  );

  // ---- (21 Oct 2026) change watchers: every device, request and merchant-history record changed in this app goes to
  // the database. A change the server refuses (e.g. not your branch) is said plainly and the lists are reloaded, so the
  // screen never shows something that was not saved.
  const saveQueue = React.useRef<Promise<void>>(Promise.resolve());
  // (23 Oct 2026) protection against runaway save loops: see utils/saveGuard.ts
  const guard = React.useRef(new SaveGuard());
  const [savePaused, setSavePaused] = useState(false);
  const [newVersion, setNewVersion] = useState(false);
  useEffect(() => watchNewVersion(() => setNewVersion(true)), []);
  const reloadAfterFailure = React.useMemo(() => throttled(() => reloadFromServer(), () => guard.current.backoffMs()), [reloadFromServer]);
  /** Counts a failed save; when too many fail in a row, saving is paused and the user is asked to reload. */
  const noteSaveFailure = useCallback((what: string) => {
    const opened = guard.current.fail();
    if (opened) {
      setSavePaused(true);
      window.setTimeout(() => { setSavePaused(guard.current.isOpen()); }, 121_000);
      triggerToast(`${what} failed several times, so saving is paused for 2 minutes. Please reload the page.`);
    }
    return opened;
  }, [triggerToast]);
  const pushDevices = useCallback((changed: Device[]) => {
    // (22 Oct 2026) optimistic UI: the screen already shows the change; these rows pulse until the server confirms it
    const syncSerials = changed.map((d) => d.serial);
    setSyncingSerials((prev) => { const n = new Set(prev); syncSerials.forEach((sn) => n.add(sn)); return n; });
    const settle = () => window.setTimeout(() => setSyncingSerials((prev) => { const n = new Set(prev); syncSerials.forEach((sn) => n.delete(sn)); return n; }), 450);
    // saves run one after another, so a second edit of a unit waits for the first and uses its new version
    saveQueue.current = saveQueue.current.then(async () => {
      if (guard.current.isOpen()) return;                              // paused: nothing is sent while the breaker is open
      const sent = changed.map((d) => {
        const aliases = versionAlias.current.get(d.serial);
        let v = d.rowVersion || 0;
        while (aliases && aliases.has(v)) v = aliases.get(v)!;
        return { ...d, rowVersion: v || undefined };
      });
      const res = await saveDevicesStrict(sent);
      sent.forEach((d) => {
        const nv = res.versions.get(d.serial);
        if (nv === undefined) return;
        if (!versionAlias.current.has(d.serial)) versionAlias.current.set(d.serial, new Map());
        versionAlias.current.get(d.serial)!.set(d.rowVersion || 0, nv);
      });
      if (res.error) {
        if (!noteSaveFailure('Saving')) {
          triggerToast(res.stale
            ? `Not saved: ${res.error}. The latest data was loaded – please check it and make your change again.`
            : `Not saved to the server: ${/row-level security|permission|42501/i.test(res.error) ? 'you do not have access to change this device' : res.error}. The list was reloaded.`);
          await reloadAfterFailure();
        }
      } else guard.current.ok();
    }).catch(() => undefined).then(() => { settle(); });
  }, [triggerToast, noteSaveFailure, reloadAfterFailure]);
  useEffect(() => {
    if (!isSupabaseConfigured || !serverReady) return;
    const changed = devices.filter((d) => syncedDevices.current.get(d.serial) !== d && !serverCopies.current.has(d));
    if (!changed.length) return;
    changed.forEach((d) => syncedDevices.current.set(d.serial, d));
    pushDevices(changed);
  }, [devices, serverReady, pushDevices]);
  useEffect(() => {
    if (!isSupabaseConfigured || !serverReady) return;
    const changed = requisitions.filter((r) => syncedReqs.current.get(r.reqId) !== r && !serverCopies.current.has(r));
    if (!changed.length) return;
    if (guard.current.isOpen()) return;
    const jobs = changed.map((r) => {
      const prior = syncedReqs.current.get(r.reqId);
      syncedReqs.current.set(r.reqId, r);
      // a status change is made by the database functions (dispatch, receipt, return) – never by saving the row
      if (prior && prior.status !== r.status) return Promise.resolve('');
      return saveRequisitionStrict(r, !prior);
    });
    Promise.all(jobs).then((errs) => {
      const err = errs.find(Boolean);
      if (err) {
        if (!noteSaveFailure('Saving requests')) {
          triggerToast(`Request not saved to the server: ${/row-level security|permission|42501/i.test(err) ? 'you do not have access to this request' : err}. The list was reloaded.`);
          void reloadAfterFailure();
        }
      } else guard.current.ok();
    });
  }, [requisitions, serverReady, triggerToast, noteSaveFailure, reloadAfterFailure]);
  useEffect(() => {
    if (!isSupabaseConfigured || !serverReady) return;
    const fresh = historicalMerchants.filter((h) => !syncedHist.current.has(h.recordId));
    if (!fresh.length || guard.current.isOpen()) return;
    fresh.forEach((h) => syncedHist.current.add(h.recordId));
    Promise.all(fresh.map((h) => insertHistoricalMerchantToSupabase(h))).then((oks) => {
      if (oks.some((x) => !x)) {
        if (!noteSaveFailure('Saving merchant history')) {
          triggerToast('A merchant history record was not saved to the server. The list was reloaded.');
          void reloadAfterFailure();                                   // the screen never keeps a record the server does not have
        }
      } else guard.current.ok();
    });
  }, [historicalMerchants, serverReady, triggerToast, noteSaveFailure, reloadAfterFailure]);

  const handleExportBackup = useCallback(() => {
    const backupData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      devices,
      branches,
      requisitions,
      // (22 Oct 2026) never passwords, user names or contacts in a file
      users: users.map(({ password: _p, username: _u, contact: _c, ...u }) => u),
      appSettings,
      auditLogs,
      historicalMerchants,
    };
    const blob = new Blob([JSON.stringify(backupData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pos-soundbox-inventory-backup-${todayPP()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    triggerToast('Complete system JSON backup downloaded.');
    addAuditLog('Backup Exported', 'Full system state snapshot exported to JSON');
  }, [devices, branches, requisitions, users, appSettings, auditLogs, historicalMerchants, triggerToast, addAuditLog]);

  const handleImportBackup = useCallback((jsonStr: string) => {
    if (isSupabaseConfigured) {
      // a file must never overwrite the shared database (it would push old data over everyone's live records)
      triggerToast('Restoring a backup file is not available when the shared database is in use. Restore from the database backups instead.');
      return;
    }
    try {
      const data = JSON.parse(jsonStr);
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid backup file format');
      }
      if (data.devices && Array.isArray(data.devices)) {
        setDevices(data.devices);
        saveDevicesToIdb(data.devices).catch(() => {});
        try {
          if (data.devices.length <= 5000) {
            localStorage.setItem(STORAGE_KEY_DEVICES, JSON.stringify(data.devices));
          } else {
            localStorage.removeItem(STORAGE_KEY_DEVICES);
          }
        } catch {}
      }
      if (data.branches && Array.isArray(data.branches)) {
        setBranches(data.branches);
        localStorage.setItem(STORAGE_KEY_BRANCHES, JSON.stringify(data.branches));
      }
      if (data.requisitions && Array.isArray(data.requisitions)) {
        setRequisitions(data.requisitions);
        localStorage.setItem(STORAGE_KEY_REQS, JSON.stringify(data.requisitions));
      }
      if (data.users && Array.isArray(data.users)) {
        setUsers(data.users);
        localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(data.users));
      }
      if (data.appSettings) {
        setAppSettings(data.appSettings);
        localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(data.appSettings));
      }
      if (data.auditLogs && Array.isArray(data.auditLogs)) {
        setAuditLogs(data.auditLogs);
        localStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(data.auditLogs));
      }
      if (data.historicalMerchants && Array.isArray(data.historicalMerchants)) {
        setHistoricalMerchants(data.historicalMerchants);
        localStorage.setItem(STORAGE_KEY_HISTORICAL_MERCHANTS, JSON.stringify(data.historicalMerchants));
      }
      triggerToast('System backup restored successfully!');
      addAuditLog('Backup Restored', 'System state successfully restored from JSON file');
    } catch (err) {
      console.error('Failed to import backup:', err);
      triggerToast('Failed to import backup: Invalid JSON file');
    }
  }, [triggerToast, addAuditLog]);

  // Banking Security: Workstation Inactivity Auto-Lock Protection
  useEffect(() => {
    if (!isAuthenticated || isSessionLocked) return;
    const timeoutMinutes = appSettings.sessionTimeoutMinutes || 15;
    const timeoutMs = timeoutMinutes * 60 * 1000;
    let timer: NodeJS.Timeout;

    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        setIsSessionLocked(true);
        addAuditLog(
          'Security Inactivity Lock',
          `Workstation session auto-locked due to ${timeoutMinutes}m of inactivity`
        );
      }, timeoutMs);
    };

    const activityEvents = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    activityEvents.forEach((evt) => window.addEventListener(evt, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      clearTimeout(timer);
      activityEvents.forEach((evt) => window.removeEventListener(evt, resetTimer));
    };
  }, [isAuthenticated, isSessionLocked, appSettings.sessionTimeoutMinutes, addAuditLog]);

  // Role authority handler
  const handleRoleChange = (newRole: UserRole) => {
    if (newRole === role) return;
    // (22 Oct 2026) with the shared database the role is the server's (no switching in the browser)
    if (isSupabaseConfigured) { triggerToast('Your role is set by your account. Ask an admin to change it.'); return; }
    setRole(newRole);
    if (newRole === 'BRANCH') {
      setBranchFilter(selectedBranch);
    } else {
      setBranchFilter('ALL');
    }
  };

  const handleBranchChange = (bCode: string) => {
    // a branch account always works in its own branch
    if (role === 'BRANCH' && isSupabaseConfigured && bCode !== selectedBranch) {
      triggerToast('Branch accounts work in their own branch only.');
      return;
    }
    setSelectedBranch(bCode);
    const bObj = branches.find((b) => b.code === bCode);
    if (bObj && bObj.staff && bObj.staff.length > 0) {
      setSelectedStaffUser(bObj.staff[0]);
    } else {
      setSelectedStaffUser('Branch Staff');
    }
    if (role === 'BRANCH') {
      setBranchFilter(bCode);
    }
  };

  const handleSignInSuccess = (params: {
    role: UserRole;
    operatorLabel: string;
    branchId: string;
    username: string;
    rememberMe?: boolean;
  }) => {
    const sessionData: StoredAuthSession = {
      role: params.role,
      operatorLabel: params.operatorLabel,
      branchId: params.branchId,
      username: params.username,
    };
    try {
      if (params.rememberMe !== false) {
        localStorage.setItem(STORAGE_KEY_AUTH_SESSION, JSON.stringify(sessionData));
        sessionStorage.removeItem(STORAGE_KEY_AUTH_SESSION);
      } else {
        sessionStorage.setItem(STORAGE_KEY_AUTH_SESSION, JSON.stringify(sessionData));
        localStorage.removeItem(STORAGE_KEY_AUTH_SESSION);
      }
    } catch (e) {
      console.error('Failed to persist auth session:', e);
    }

    setRole(params.role);
    setAuthUsername(params.operatorLabel);
    if (params.role === 'BRANCH') {
      setSelectedBranch(params.branchId);
      setSelectedStaffUser(params.operatorLabel);
      setBranchFilter(params.branchId);
    } else {
      setSelectedBranch(params.branchId === '100' ? '105' : params.branchId);
      setActiveAdminStaff(params.operatorLabel);
      setBranchFilter('ALL');
    }
    setIsAuthenticated(true);
    addAuditLog(
      'User Session Sign-In',
      `Authenticated into workstation as ${params.role} (${params.operatorLabel})`,
      params.role
    );
    triggerToast(`Welcome ${params.operatorLabel} (${params.role})`);
  };

  const scopedDevices = useMemo(() => {
    if (role === 'SUPER_ADMIN' || role === 'ADMIN') return devices;
    return devices.filter((d) => d.branchId === selectedBranch);
  }, [devices, role, selectedBranch]);

  const deferredSearchQuery = useDeferredValue(searchQuery);

  // Refresh 500K-row server stage counts when branch scope changes on a large dataset
  useEffect(() => {
    if (!isSupabaseConfigured || !serverDeviceTotal || serverDeviceTotal <= 10000) return;
    let cancelled = false;
    const effectiveBranch = role === 'BRANCH' ? selectedBranch : branchFilter;
    fetchDeviceStageCountsFromSupabase(effectiveBranch).then((summary) => {
      if (!cancelled && summary) {
        setServerStageSummary(summary);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [serverDeviceTotal, role, selectedBranch, branchFilter]);

  // Fetch a specific 50/100-row page from Supabase and merge into syncedDevices + devices (capped at 400 rows in RAM)
  const handleFetchInventoryPage = useCallback(
    async (params: DeviceQueryParams) => {
      const res = await fetchDevicesPageFromSupabase(params);
      if (!res) return null;
      const incoming = res.rows;
      incoming.forEach((d) => {
        serverCopies.current.add(d);
        syncedDevices.current.set(d.serial, d);
      });
      setDevices((prev) => {
        const incomingBySn = new Map(incoming.map((d) => [d.serial, d]));
        const merged: Device[] = [...incoming];
        for (const existing of prev) {
          if (incomingBySn.has(existing.serial)) continue;
          const isUnsavedLocalEdit = !serverCopies.current.has(existing);
          if (isUnsavedLocalEdit || merged.length < 400) {
            merged.push(existing);
          } else {
            syncedDevices.current.delete(existing.serial);
          }
        }
        return merged;
      });
      return { rows: incoming, total: res.total };
    },
    []
  );

  // When searching from the global header bar on a >100-row dataset outside InventoryTab, fetch matching page from server
  useEffect(() => {
    const q = deferredSearchQuery.trim();
    if (!isSupabaseConfigured || !serverDeviceTotal || serverDeviceTotal <= 10000 || q.length < 2 || shownTab === 'inventory') {
      return;
    }
    const timer = setTimeout(() => {
      void handleFetchInventoryPage({
        page: 1,
        pageSize: 100,
        search: q,
        branchId: role === 'BRANCH' ? selectedBranch : branchFilter,
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [deferredSearchQuery, serverDeviceTotal, shownTab, role, selectedBranch, branchFilter, handleFetchInventoryPage]);

  const pipelineCounts = useMemo(() => {
    if (serverStageSummary) {
      return {
        all: serverStageSummary.all,
        hq: serverStageSummary.hq,
        reserve: serverStageSummary.reserve,
        config: serverStageSummary.config,
        complete: serverStageSummary.complete,
        faulty: serverStageSummary.faulty,
        lost: serverStageSummary.lost,
      };
    }
    let all = 0, hq = 0, reserve = 0, config = 0, complete = 0, faulty = 0, lost = 0;
    const len = scopedDevices.length;
    for (let i = 0; i < len; i++) {
      const d = scopedDevices[i];
      if (d.archived) continue;
      all++;
      switch (d.stage) {
        case 'HQ_STOCK': hq++; break;
        case 'BRANCH_RESERVE': reserve++; break;
        case 'CONFIGURING': config++; break;
        case 'COMPLETE': complete++; break;
        case 'FAULTY': faulty++; break;
        case 'LOST': lost++; break;
      }
    }
    return { all, hq, reserve, config, complete, faulty, lost };
  }, [scopedDevices, serverStageSummary]);

  const filteredInventory = useMemo(() => {
    const q = deferredSearchQuery.trim().toLowerCase();
    const hasSearch = q !== '';
    const isStageAll = stageFilter === 'ALL';
    const isTypeAll = typeFilter === 'ALL';
    const isBranchAll = branchFilter === 'ALL';
    const isAdminOrSuper = role === 'SUPER_ADMIN' || role === 'ADMIN';

    // Fast-path: When no filters or search are active, single pass without string operations
    if (!hasSearch && isStageAll && isTypeAll && (isBranchAll || !isAdminOrSuper)) {
      const active: Device[] = [];
      const len = scopedDevices.length;
      for (let i = 0; i < len; i++) {
        if (!scopedDevices[i].archived) active.push(scopedDevices[i]);
      }
      return active;
    }

    const result: Device[] = [];
    const len = scopedDevices.length;
    for (let i = 0; i < len; i++) {
      const d = scopedDevices[i];
      if (d.archived) continue;
      if (!isStageAll && d.stage !== stageFilter) continue;
      if (!isTypeAll && d.type !== typeFilter) continue;
      if (isAdminOrSuper && !isBranchAll && d.branchId !== branchFilter) continue;

      if (hasSearch) {
        // High-speed short-circuiting: Check high-discriminator primary keys first
        const match =
          d.serial.toLowerCase().includes(q) ||
          (d.mid && d.mid.toLowerCase().includes(q)) ||
          (d.tid && d.tid.toLowerCase().includes(q)) ||
          (d.merchantName && d.merchantName.toLowerCase().includes(q)) ||
          d.model.toLowerCase().includes(q) ||
          (d.batterySerial && d.batterySerial.toLowerCase().includes(q)) ||
          d.branchId.toLowerCase().includes(q) ||
          (d.staff && d.staff.toLowerCase().includes(q)) ||
          (d.location && d.location.toLowerCase().includes(q)) ||
          (isAdminOrSuper && d.merchantPhone && d.merchantPhone.toLowerCase().includes(q)) ||
          (d.address && d.address.toLowerCase().includes(q)) ||
          (d.customFields && Object.values(d.customFields).some((val) => String(val ?? '').toLowerCase().includes(q)));

        if (!match) continue;
      }
      result.push(d);
    }
    return result;
  }, [scopedDevices, stageFilter, typeFilter, branchFilter, deferredSearchQuery, role]);

  const scopedRequisitions = useMemo(() => {
    if (role === 'SUPER_ADMIN' || role === 'ADMIN') return requisitions;
    return requisitions.filter((r) => r.branchId === selectedBranch);
  }, [requisitions, role, selectedBranch]);

  // Fast O(1) serial index map for instant lookups
  const deviceBySerialMap = useMemo(() => {
    const map = new Map<string, Device>();
    const len = devices.length;
    for (let i = 0; i < len; i++) {
      map.set(devices[i].serial, devices[i]);
    }
    return map;
  }, [devices]);

  const editingDevice = useMemo(
    () => (editingDeviceSerial ? deviceBySerialMap.get(editingDeviceSerial) || null : null),
    [deviceBySerialMap, editingDeviceSerial]
  );

  // Optimistic UI Background Cloud Sync System (Instant Perception, 60fps)
  const [syncingSerials, setSyncingSerials] = useState<Set<string>>(new Set());

  const devicesRef = React.useRef(devices);
  useEffect(() => {
    devicesRef.current = devices;
  }, [devices]);

  const triggerOptimisticSync = useCallback((serials: string[], _actionText: string, syncPayload?: Device[]) => {
    // 1. Immediately mark serials for instant row highlight
    setSyncingSerials((prev) => {
      const next = new Set(prev);
      serials.forEach((sn) => next.add(sn));
      return next;
    });

    // 3. (21 Oct 2026) saved to the database by the change watcher (devices), with an error shown if refused
    void syncPayload;

    // 4. Asynchronous background cloud persistence queue (simulating Supabase/REST commit without blocking user thread)
    setTimeout(() => {
      // Clear row highlight gently after brief confirmation window (with the shared database the real save clears it)
      if (isSupabaseConfigured) return;
      setTimeout(() => {
        setSyncingSerials((prev) => {
          const next = new Set(prev);
          serials.forEach((sn) => next.delete(sn));
          return next;
        });
      }, 1400);
    }, 750);
  }, []);

  // Save single device workflow & append Serial Cycle History (22 Oct 2026: only allowed moves; one state update each)
  const handleSaveWorkflow = (
    serial: string,
    updates: {
      stage: LifecycleStage;
      branchId: string;
      staff: string;
      merchantName: string;
      merchantPhone?: string;
      location?: string;
      address?: string;
      mid: string;
      tid: string;
      note: string;
      deployedDate: string;
      batteryInstalledDate: string;
      customFields?: Record<string, string>;
      deploymentStatus?: string;
      stockStatus?: string;
    }
  ) => {
    const d = devices.find((x) => x.serial === serial);
    if (!d) return;
    if (!inScope(d)) { triggerToast('This unit belongs to another branch.'); return; }
    if (role === 'BRANCH' && updates.branchId !== d.branchId) { triggerToast('Branch staff cannot move a unit to another branch.'); return; }
    if ((d.stage === 'HQ_STOCK' || d.stage === 'BRANCH_RESERVE') && (updates.stage === 'HQ_STOCK' || updates.stage === 'BRANCH_RESERVE') && (updates.mid?.trim() || updates.merchantName?.trim())) {
      updates = { ...updates, stage: 'CONFIGURING' };
    }
    const err = role === 'SUPER_ADMIN' ? '' : moveError(d.stage, updates.stage, STAGE_META);   // the super admin may move a unit to any stage
    if (err) { triggerToast(err); return; }
    const today = todayPP();
    const nowTime = stampSecPP();
    const branchObj = branches.find((b) => b.code === updates.branchId);
    const actor = operatorLabel || 'Staff';
    const stageLabel = STAGE_META[updates.stage].short;
    const toMerchant = updates.stage === 'COMPLETE' || updates.stage === 'CONFIGURING';
    const hadMerchant = Boolean(d.mid?.trim());
    const leftMerchant = hadMerchant && (!toMerchant || (updates.mid || '').trim() !== d.mid.trim());
    const logNote =
      updates.note.trim() ||
      `Moved to ${stageLabel} at Branch Code ${updates.branchId}${updates.merchantName && toMerchant ? ` for ${updates.merchantName}` : ''}`;

    const histRec = leftMerchant
      ? historyRecordFor(d, {
          reason: (updates.note.trim().replace(/^Returned:\s*/i, '')) || (updates.stage === 'LOST' ? 'Device lost at merchant' : 'Taken back from merchant'),
          status: updates.stage === 'LOST' || TERMINATION_REASON.test(updates.note) ? 'TERMINATED' : 'RETURNED',
          actor,
          notes: `Unit moved to ${stageLabel}.`,
        })
      : null;

    const moved = onMove(
      {
        ...d,
        branchId: updates.branchId,
        branchName: branchObj?.name || d.branchName,
        staff: updates.staff,
        merchantName: toMerchant ? updates.merchantName : '',
        merchantPhone: toMerchant ? (updates.merchantPhone !== undefined ? updates.merchantPhone : d.merchantPhone) : '',
        address: toMerchant ? (updates.address !== undefined ? updates.address : d.address) : '',
        location: updates.location !== undefined ? updates.location : d.location,
        mid: toMerchant ? updates.mid : '',
        tid: toMerchant ? updates.tid : '',
      },
      updates.stage
    );
    const next: Device = {
      ...moved,
      ...(updates.deploymentStatus ? { deploymentStatus: updates.deploymentStatus } : {}),
      ...(updates.stockStatus ? { stockStatus: updates.stockStatus } : {}),
      installedByStaff: updates.stage === 'COMPLETE' && d.stage !== 'COMPLETE' ? updates.staff || actor : leftMerchant ? '' : d.installedByStaff,
      replacedByStaff: leftMerchant ? '' : d.replacedByStaff,   // (23 Oct 2026) a returned unit keeps no merchant details: they live on in Merchant History
      returnedByStaff: leftMerchant ? actor : d.returnedByStaff,
      returnedDate: leftMerchant ? today : d.returnedDate,
      customFields: { ...(d.customFields || {}), ...(updates.customFields || {}) },
      deployedDate: updates.stage === 'COMPLETE' ? updates.deployedDate || d.deployedDate || today : leftMerchant ? '' : d.deployedDate,
      batteryInstalledDate: updates.batteryInstalledDate,
      redeployCount: leftMerchant ? (d.redeployCount || 0) + 1 : d.redeployCount || 0,
      updatedAt: today,
      history: [`${nowTime} | ${stageLabel} | ${logNote} — Officer: ${actor}`, ...(d.history || [])],
    };
    setDevices((prev) => prev.map((x) => (x.serial === serial ? next : x)));
    if (histRec) setHistoricalMerchants((h) => [histRec, ...h]);

    addAuditLog('Serial Cycle Updated', `Updated serial ${serial}: ${STAGE_META[d.stage].short} → ${stageLabel} (Branch Code ${updates.branchId})`);
    setEditingDeviceSerial(null);
    triggerOptimisticSync([serial], `Updated ${serial} -> ${stageLabel} (${branchObj?.name || 'Code ' + updates.branchId})`);
    triggerToast(`Serial ${serial} updated (${stageLabel})`);
  };

  // Dedicated POS Terminal Battery Replacement
  const handleConfirmChangeBattery = (
    serial: string,
    newBatterySerial: string,
    installedDate: string,
    reason: string
  ) => {
    const target = devices.find((d) => d.serial === serial);
    if (!target || !inScope(target)) { triggerToast('This unit is not in your branch.'); return; }
    if (target.type !== 'POS Terminal') { triggerToast('Battery changes apply to POS Terminals only.'); return; }
    if (!newBatterySerial.trim()) { triggerToast('Enter the new battery serial.'); return; }
    const today = installedDate || todayPP();
    const nowTime = stampSecPP();
    const actor =
      role === 'SUPER_ADMIN'
        ? `Super Admin (${authUsername})`
        : role === 'ADMIN'
        ? `Admin HQ (${activeAdminStaff})`
        : `${selectedStaffUser || 'Staff'} (Branch Code ${selectedBranch})`;

    setDevices((prev) =>
      prev.map((d) => {
        if (d.serial !== serial) return d;
        const oldBatt = d.batterySerial || 'none recorded';
        const logEntry = `${nowTime} | Battery Replacement | Installed fresh battery SN ${newBatterySerial} (Replaced: ${oldBatt}) · Reason: ${reason} (Fresh 24-Month Lifespan Activated) — Officer: ${actor}`;
        return {
          ...d,
          batterySerial: newBatterySerial,
          batteryInstalledDate: today,
          history: [logEntry, ...(d.history || [])],
          updatedAt: today,
        };
      })
    );

    addAuditLog(
      'POS Terminal Battery Replaced',
      `Replaced battery for POS Terminal SN ${serial} with fresh battery SN ${newBatterySerial} (Installed Date: ${today}). Reason: ${reason}`
    );

    addNotification(
      `Battery Replaced • ${serial}`,
      `POS Terminal ${serial} battery changed to ${newBatterySerial} by ${actor}. 24-month lifespan reset to fresh standing.`,
      'HEALTH',
      selectedBranch,
      'inventory'
    );

    triggerOptimisticSync([serial], `Battery replaced for ${serial} with SN ${newBatterySerial}`);
    triggerToast(`Battery for POS Terminal ${serial} successfully replaced with SN ${newBatterySerial} (24M reset).`);
    setBatteryModalDevice(null);
  };

  // Bulk Selection & Assignment (e.g. Select 10 assign to Branch Code)
  const handleBulkAssignBranch = (
    serials: string[],
    targetBranchCode: string,
    note?: string,
    skipNotif?: boolean
  ) => {
    const today = todayPP();
    const nowTime = stampSecPP();
    const branchObj = branches.find((b) => b.code === targetBranchCode);
    const actor = operatorLabel || 'HQ';
    if (role === 'BRANCH') { triggerToast('Only HQ can assign units to a branch.'); return; }
    if (!branchObj || targetBranchCode === '100') { triggerToast('Choose a valid branch.'); return; }
    // (22 Oct 2026) only free stock moves: HQ stock or branch reserve, not archived, not allocated to a request
    const wanted = new Set(serials);
    const blocked = devices.filter((d) => wanted.has(d.serial) &&
      (!(d.stage === 'HQ_STOCK' || d.stage === 'BRANCH_RESERVE') || d.archived || d.customFields?.allocatedTo));
    if (blocked.length) {
      triggerToast(`Not assigned: ${blocked.slice(0, 5).map((d) => `${d.serial} (${d.archived ? 'archived' : d.customFields?.allocatedTo ? 'allocated to ' + d.customFields.allocatedTo : STAGE_META[d.stage].short})`).join(', ')}${blocked.length > 5 ? '…' : ''}. Only free HQ stock or branch reserve can be assigned.`);
      return;
    }

    setDevices((prev) =>
      prev.map((d) => {
        if (!wanted.has(d.serial)) return d;
        const nextCycleNum = (d.history || []).length + 1;
        return {
          ...onMove(d, 'BRANCH_RESERVE'),
          branchId: targetBranchCode,
          branchName: branchObj.name,
          staff: '',
          updatedAt: today,
          history: [
            `${nowTime} | Cycle #${nextCycleNum}: Bulk Branch Dispatch | ${
              note ||
              `Bulk assigned (${serials.length} units) to Branch Code ${targetBranchCode} (${
                branchObj?.name || ''
              })`
            } — Officer: ${actor}`,
            ...(d.history || []),
          ],
        };
      })
    );

    addAuditLog(
      'Bulk Branch Assignment',
      `Assigned ${serials.length} serials (${serials.slice(0, 3).join(', ')}${
        serials.length > 3 ? '...' : ''
      }) to Branch Code ${targetBranchCode}`
    );
    if (!skipNotif) {
      addNotification(
        `Assigned from Admin • ${serials.length} Unit(s) to Code ${targetBranchCode}`,
        `${actor} assigned ${serials.length} hardware serial(s) (${serials
          .slice(0, 3)
          .join(', ')}${serials.length > 3 ? '...' : ''}) to Branch Code ${targetBranchCode} (${
          branchObj?.name || ''
        }).`,
        'STOCK',
        targetBranchCode,
        'inventory'
      );
    }
    triggerOptimisticSync(serials, `Transferred ${serials.length} unit(s) to Branch Code ${targetBranchCode}`);
    triggerToast(`Assigned ${serials.length} serials to Branch Code ${targetBranchCode}`);
  };

  // Return Back to Admin HQ Stock (Branch Code 100). (22 Oct 2026) HQ only; a faulty unit stays "Faulty" (held at HQ);
  // a unit at a merchant is first recorded in Merchant History; a lost or allocated unit is not moved.
  const handleReturnToAdminStock = (serials: string[], reason?: string) => {
    if (role === 'BRANCH') { triggerToast('Branch staff send a Return Request instead; HQ approves it.'); return; }
    const today = todayPP();
    const nowTime = stampSecPP();
    const actor = operatorLabel || 'HQ';
    const wanted = new Set(serials);
    const targets = devices.filter((d) => wanted.has(d.serial));
    const skipped = targets.filter((d) => d.stage === 'LOST' || d.customFields?.allocatedTo || (d.stage === 'HQ_STOCK' && d.branchId === '100'));
    const moving = targets.filter((d) => !skipped.includes(d));
    if (!moving.length) { triggerToast('Nothing to return: the units are already in HQ stock, lost or allocated to a request.'); return; }
    const why = reason || 'Returned to HQ stock';
    const records = moving.filter((d) => d.mid || d.merchantName).map((d) => historyRecordFor(d, {
      reason: why, status: TERMINATION_REASON.test(why) ? 'TERMINATED' : 'RETURNED', actor, notes: 'Returned to HQ.' }));
    const movedMap = new Map(moving.map((d) => {
      const to: LifecycleStage = d.stage === 'FAULTY' ? 'FAULTY' : 'HQ_STOCK';
      const next: Device = {
        ...onMove(d, to),
        branchId: '100',
        branchName: 'Head Office',
        staff: '',
        returnedByStaff: d.mid ? actor : d.returnedByStaff,
        returnedDate: d.mid ? today : d.returnedDate,
        deployedDate: d.mid ? '' : d.deployedDate,
        updatedAt: today,
        redeployCount: d.mid ? (d.redeployCount || 0) + 1 : d.redeployCount || 0,
        history: [`${nowTime} | Return to HQ | ${why}${to === 'FAULTY' ? ' (kept as Faulty)' : ''} — Officer: ${actor}`, ...(d.history || [])],
      };
      return [d.serial, next] as const;
    }));
    if (records.length) setHistoricalMerchants((prev) => [...records, ...prev]);
    setDevices((prev) => prev.map((d) => movedMap.get(d.serial) || d));
    const done = [...movedMap.keys()];
    addAuditLog('Return to Admin Stock', `Returned ${done.length} unit(s) (${done.join(', ')}) to HQ${skipped.length ? `; not moved: ${skipped.map((d) => d.serial).join(', ')}` : ''}`);
    triggerOptimisticSync(done, `Returned ${done.length} unit(s) to Admin HQ Stock`);
    triggerToast(`Returned ${done.length} unit(s) to HQ` + (skipped.length ? `; ${skipped.length} not moved (lost, allocated or already in HQ stock)` : ''));
  };

  // Branch Staff Return Request: Submits a formal Stock Return Request to Admin HQ for approval
  const handleRequestReturnToAdminStock = (
    serials: string[],
    reason: string = 'Return to Admin HQ Stock requested by branch'
  ) => {
    if (!serials.length) return;
    const today = todayPP();
    const nowTime = stampSecPP();
    const affected = devices.filter((d) => serials.includes(d.serial));
    // (22 Oct 2026) the same rules the server applies when HQ approves the return
    const targetBranchId = affected[0]?.branchId || selectedBranch;
    const pendingReturn = new Set(requisitions.filter((r) => r.type === 'STOCK_RETURN' && r.status === 'PENDING_ADMIN').flatMap((r) => r.returnSerials || []));
    const bad = affected.filter((d) => !inScope(d) || d.branchId !== targetBranchId || d.branchId === '100' ||
      !(d.stage === 'BRANCH_RESERVE' || d.stage === 'CONFIGURING' || d.stage === 'FAULTY') || pendingReturn.has(d.serial));
    if (affected.length !== serials.length || bad.length) {
      triggerToast(`Return not requested: ${bad.map((d) => `${d.serial} (${pendingReturn.has(d.serial) ? 'already waiting for return' : STAGE_META[d.stage].short + ', Branch ' + d.branchId})`).join(', ') || 'unknown serial'}. Only reserve, configuring or faulty units of one branch can be returned.`);
      return;
    }
    const branchObj = branches.find((b) => b.code === targetBranchId || b.id === targetBranchId);
    const posCount = affected.filter((d) => d.type === 'POS Terminal').length;
    const sbCount = affected.filter((d) => d.type === 'Sound Box').length;
    const actor = operatorLabel || 'Branch Staff';

    const newReq: Requisition = {
      reqId: newRecordId('RET'),
      date: today,
      branchId: targetBranchId,
      branchName: branchObj?.name || `Branch Code ${targetBranchId}`,
      staff: actor,
      posQty: posCount,
      sbQty: sbCount,
      reason: reason || 'Return device to Admin HQ Stock',
      status: 'PENDING_ADMIN',
      type: 'STOCK_RETURN',
      returnSerials: [...serials],
    };

    setRequisitions((prev) => [newReq, ...prev]);

    // Update devices to record that a return request has been submitted
    setDevices((prev) =>
      prev.map((d) => {
        if (!serials.includes(d.serial)) return d;
        const nextCycleNum = (d.history || []).length + 1;
        return {
          ...d,
          note: `Pending Return Approval (${newReq.reqId}). ${d.note || ''}`.trim(),
          history: [
            `${nowTime} | Cycle #${nextCycleNum}: Stock Return Requested | Submitted ${newReq.reqId} to Admin HQ Stock — Requested by: ${actor}`,
            ...(d.history || []),
          ],
        };
      })
    );

    addAuditLog(
      'Stock Return Request Submitted',
      `Submitted return request ${newReq.reqId} for ${serials.length} unit(s) (${serials.join(', ')}) from Branch Code ${targetBranchId}`
    );

    addNotification(
      `Return Request from Branch Staff • ${newReq.reqId}`,
      `Branch Staff ${actor} (Branch Code ${targetBranchId} — ${newReq.branchName}) requested return of ${serials.length} unit(s) (${serials.join(', ')}) to Admin HQ Stock: "${reason}"`,
      'REQUEST',
      targetBranchId,
      'requisitions'
    );

    triggerToast(`Return Request ${newReq.reqId} submitted! Notified Admin HQ & Super Admin`);
  };

  // Return Back to Branch Reserve (BRANCH_RESERVE)
  const handleReturnToBranchReserve = (
    serials: string[],
    targetBranchId?: string,
    reason?: string
  ) => {
    const today = todayPP();
    const nowTime = stampSecPP();
    const actor = operatorLabel || 'Staff';
    const wanted = new Set(serials);
    const targets = devices.filter((d) => wanted.has(d.serial));
    const problems: string[] = [];
    const nextMap = new Map<string, Device>();
    const records: HistoricalMerchantRecord[] = [];
    targets.forEach((d) => {
      // (22 Oct 2026) the unit stays in its own branch unless HQ names another; no default branch is guessed
      const bId = role === 'BRANCH' ? d.branchId : targetBranchId || (d.branchId !== '100' ? d.branchId : '');
      const bObj = branches.find((b) => b.id === bId || b.code === bId);
      if (!inScope(d)) { problems.push(`${d.serial} (another branch)`); return; }
      if (!bObj || bId === '100') { problems.push(`${d.serial} (choose the branch to hold it)`); return; }
      if (!canMove(d.stage, 'BRANCH_RESERVE') || d.customFields?.allocatedTo) { problems.push(`${d.serial} (${d.customFields?.allocatedTo ? 'allocated to ' + d.customFields.allocatedTo : STAGE_META[d.stage].short})`); return; }
      if (role === 'BRANCH' && d.stage === 'HQ_STOCK') { problems.push(`${d.serial} (HQ stock)`); return; }
      const why = reason || `Returned to Branch Code ${bId} reserve`;
      const hadMerchant = !!(d.mid || d.merchantName);
      if (hadMerchant) records.push(historyRecordFor(d, { reason: why, status: TERMINATION_REASON.test(why) ? 'TERMINATED' : 'RETURNED', actor, notes: 'Unit kept in branch reserve.' }));
      nextMap.set(d.serial, {
        ...onMove(d, 'BRANCH_RESERVE'),
        branchId: bId,
        branchName: bObj.name,
        returnedByStaff: hadMerchant ? actor : d.returnedByStaff,
        returnedDate: hadMerchant ? today : d.returnedDate,
        deployedDate: hadMerchant ? '' : d.deployedDate,
        updatedAt: today,
        redeployCount: hadMerchant ? (d.redeployCount || 0) + 1 : d.redeployCount || 0,
        history: [`${nowTime} | Return to Branch Reserve | ${why} — Officer: ${actor}`, ...(d.history || [])],
      });
    });
    if (!nextMap.size) { triggerToast(`Not moved: ${problems.join(', ') || 'no unit selected'}.`); return; }
    if (records.length) setHistoricalMerchants((prev) => [...records, ...prev]);
    setDevices((prev) => prev.map((d) => nextMap.get(d.serial) || d));
    const done = [...nextMap.keys()];
    addAuditLog('Return to Branch Reserve', `Returned ${done.length} unit(s) (${done.join(', ')}) to branch reserve${problems.length ? `; not moved: ${problems.join(', ')}` : ''}`);
    triggerOptimisticSync(done, `Returned ${done.length} unit(s) to Branch Reserve`);
    triggerToast(`Returned ${done.length} unit(s) to branch reserve` + (problems.length ? `; not moved: ${problems.join(', ')}` : ''));
  };

  // Universal Single Device Stock Return (to HQ Stock or Branch Reserve)
  const handleReturnSingleDeviceStock = (
    serial: string,
    destination: 'HQ_STOCK' | 'BRANCH_RESERVE',
    branchId?: string,
    reason?: string
  ) => {
    if (destination === 'HQ_STOCK') {
      handleReturnToAdminStock([serial], reason);
    } else {
      handleReturnToBranchReserve([serial], branchId, reason);
    }
  };

  // Terminate Merchant & Return All Assigned Devices. (22 Oct 2026) A working unit goes to its branch reserve or (HQ
  // only) to HQ stock; each unit is recorded once in Merchant History with its real details.
  const handleTerminateMerchant = (
    mid: string,
    destination: 'HQ_STOCK' | 'BRANCH_RESERVE',
    reason: string = 'Merchant Terminated Contract',
    notes?: string
  ) => {
    const today = todayPP();
    const nowTime = stampSecPP();
    const actor = operatorLabel || 'Staff';
    const affected = devices.filter((d) => d.mid === mid && inScope(d));
    if (!affected.length) { triggerToast('No unit of this merchant is in your branch.'); return; }
    if (destination === 'HQ_STOCK' && role === 'BRANCH') { triggerToast('Branch staff return units to the branch reserve; HQ approves a return to HQ.'); return; }
    const merchantName = affected[0].merchantName || mid;
    const records = affected.map((d) => historyRecordFor(d, { reason, status: 'TERMINATED', actor,
      notes: notes || `Terminated; unit returned to ${destination === 'HQ_STOCK' ? 'HQ stock' : 'branch reserve'}.` }));
    const nextMap = new Map(affected.map((d) => {
      const toHq = destination === 'HQ_STOCK' || d.branchId === '100';
      const bId = toHq ? '100' : d.branchId;
      const bObj = branches.find((b) => b.id === bId || b.code === bId);
      const to: LifecycleStage = toHq ? 'HQ_STOCK' : 'BRANCH_RESERVE';
      const destLabel = toHq ? 'HQ stock' : `branch reserve (${bObj?.name || 'Branch Code ' + bId})`;
      const next: Device = {
        ...onMove(d, to),
        branchId: bId,
        branchName: toHq ? 'Head Office' : bObj?.name || d.branchName,
        staff: toHq ? '' : d.staff,
        returnedByStaff: actor,
        returnedDate: today,
        returnReason: reason,
        deployedDate: '',
        redeployCount: (d.redeployCount || 0) + 1,
        updatedAt: today,
        note: `Returned to ${destLabel} after merchant termination (${reason})`,
        history: [`${nowTime} | Terminated Return | Returned from ${d.merchantName || 'merchant'} to ${destLabel} — Reason: ${reason} — Officer: ${actor}`, ...(d.history || [])],
      };
      return [d.serial, next] as const;
    }));
    setDevices((prev) => prev.map((d) => nextMap.get(d.serial) || d));
    setHistoricalMerchants((prev) => [...records, ...prev]);
    addAuditLog('Merchant Terminated', `Merchant ${merchantName} (${mid}) terminated. ${affected.length} unit(s) returned to ${destination === 'HQ_STOCK' ? 'HQ stock' : 'branch reserve'}`);
    triggerToast(`Merchant ${merchantName} terminated. ${affected.length} unit(s) returned to ${destination === 'HQ_STOCK' ? 'HQ stock' : 'branch reserve'}.`);
  };

  // Remove from Dashboard (Archive) & Restore
  const handleRemoveFromDashboard = (serials: string[], reason?: string) => {
    if (role === 'BRANCH') { triggerToast('Only HQ can archive units.'); return; }
    const today = todayPP();
    const nowTime = stampSecPP();
    const actor = operatorLabel || 'HQ';

    setDevices((prev) =>
      prev.map((d) => {
        if (!serials.includes(d.serial)) return d;
        const nextCycleNum = (d.history || []).length + 1;
        return {
          ...d,
          archived: true,
          updatedAt: today,
          history: [
            `${nowTime} | Cycle #${nextCycleNum}: Removed from Dashboard | ${
              reason || 'Archived from active dashboard view'
            } — Officer: ${actor}`,
            ...(d.history || []),
          ],
        };
      })
    );

    addAuditLog(
      'Removed from Dashboard',
      `Removed ${serials.length} serial(s) (${serials.join(', ')}) from active dashboard view`
    );
    triggerToast(`Removed ${serials.length} unit(s) from active dashboard`);
  };

  // (22 Oct 2026) super admin only: remove units for good (the database refuses anyone else)
  const handleDeletePermanently = (serials: string[]) => {
    if (role !== 'SUPER_ADMIN') { triggerToast('Only the Super Admin can delete units permanently.'); return; }
    const gone = new Set(serials);
    const names = serials.slice(0, 20).join(', ') + (serials.length > 20 ? '…' : '');
    const finish = () => {
      setDevices((prev) => prev.filter((d) => !gone.has(d.serial)));
      serials.forEach((sn) => syncedDevices.current.delete(sn));
      addAuditLog('Units Deleted Permanently', `Deleted ${serials.length} serial(s): ${names}`);
      triggerToast(`Deleted ${serials.length} unit(s) permanently`);
    };
    if (isSupabaseConfigured) {
      deleteDevicesOnServer(serials).then((err) => { if (err) triggerToast(`Not deleted: ${err}`); else finish(); });
      return;
    }
    finish();
  };

  /** Super Admin: remove every Merchant History record (the list and the database). */
  const handleClearHistory = () => {
    if (role !== 'SUPER_ADMIN') { triggerToast('Only the Super Admin can clear Merchant History.'); return; }
    const count = historicalMerchants.length;
    const finish = () => {
      setHistoricalMerchants([]);
      syncedHist.current.clear();
      addAuditLog('Merchant History Cleared', `Removed all ${count} merchant history record(s).`);
      triggerToast(`Merchant History cleared (${count} record(s) removed)`);
    };
    if (isSupabaseConfigured) {
      deleteAllHistoricalMerchantsOnServer().then((err) => { if (err) triggerToast(`Not cleared: ${err}`); else finish(); });
      return;
    }
    finish();
  };

  const handleRestoreToDashboard = (serials: string[]) => {
    if (role === 'BRANCH') { triggerToast('Only HQ can restore archived units.'); return; }
    const today = todayPP();
    const nowTime = stampSecPP();
    setDevices((prev) =>
      prev.map((d) => {
        if (!serials.includes(d.serial)) return d;
        const nextCycleNum = (d.history || []).length + 1;
        return {
          ...d,
          archived: false,
          updatedAt: today,
          history: [
            `${nowTime} | Cycle #${nextCycleNum}: Restored to Dashboard | Restored serial back to active dashboard inventory`,
            ...(d.history || []),
          ],
        };
      })
    );
    addAuditLog(
      'Restored to Dashboard',
      `Restored ${serials.length} serial(s) (${serials.join(', ')}) back to active dashboard`
    );
    triggerToast(`Restored ${serials.length} serial(s) to active dashboard`);
  };

  // Notify Handling Staff & Telegram Group when a device Under Configuring is ready for App Push (#11)
  const handleNotifyConfigReady = (serial: string) => {
    const dev = devices.find((d) => d.serial === serial);
    if (!dev) return;
    const staffTarget = dev.staff || 'Assigned Branch Staff';
    const bName = dev.branchName || `Branch ${dev.branchId}`;
    const mName = dev.merchantName || 'Merchant Profile';
    addNotification(
      `Open Device for App Push • ${dev.serial}`,
      `Admin configured ${mName} (${dev.mid || 'MID Pending'}) on ${dev.type} SN ${dev.serial} (${bName}). Staff (${staffTarget}): Please power ON and open the device now to wait for app push.`,
      'REQUEST',
      dev.branchId,
      'inventory'
    );
    void sendDeviceConfigTelegramAlert({
      serial: dev.serial,
      deviceType: dev.type,
      mid: dev.mid || '—',
      tid: dev.tid || '—',
      merchantName: mName,
      branchId: dev.branchId,
      branchName: bName,
      staffName: staffTarget,
      adminOperator: operatorLabel || 'Admin HQ',
    });
    addAuditLog(
      'App Push Notification Sent',
      `Notified staff (${staffTarget}) and alerted Telegram group to open ${dev.type} ${dev.serial} (${mName}) for app push`
    );
    triggerToast(`Notification sent to ${staffTarget} & Telegram group alerted: Open ${dev.serial} to wait for app push!`);
  };

  // Super Admin & Admin: Edit / Rename Device Serial Number if uploaded wrong (#28)
  const handleRenameSerial = async (oldSerial: string, newSerial: string) => {
    if (role === 'BRANCH') {
      triggerToast('Only Admin and Super Admin can edit device serial numbers.');
      return;
    }
    const cleanOld = oldSerial.trim().toUpperCase();
    const cleanNew = newSerial.trim().toUpperCase();
    if (!cleanNew || cleanOld === cleanNew) return;
    if (devices.some((d) => d.serial.toUpperCase() === cleanNew)) {
      triggerToast(`Serial ${cleanNew} already exists in inventory.`);
      return;
    }
    if (isSupabaseConfigured) {
      const err = await renameDeviceSerialOnServer(cleanOld, cleanNew);
      if (err) {
        triggerToast(`Could not rename serial: ${err}`);
        return;
      }
    }
    const nowTime = stampSecPP();
    const today = todayPP();
    setDevices((prev) =>
      prev.map((d) =>
        d.serial.toUpperCase() === cleanOld
          ? {
              ...d,
              serial: cleanNew,
              updatedAt: today,
              history: [
                `${nowTime} | Serial Corrected | Renamed serial ${cleanOld} → ${cleanNew} — Officer: ${operatorLabel || 'Admin'}`,
                ...(d.history || []),
              ],
            }
          : d
      )
    );
    setEditingDeviceSerial(cleanNew);
    addAuditLog('Serial Number Corrected', `Corrected device serial ${cleanOld} → ${cleanNew}`);
    triggerToast(`Serial number updated: ${cleanOld} → ${cleanNew}`);
  };

  // Merchant Deployment 360 View: Record Broken Device Replacement & Update Front Table Serial (#23)
  const handleReplaceMerchantDevice = (
    oldSerial: string,
    newSerial: string,
    replacedByStaff: string,
    reason: string
  ) => {
    const oldDev = devices.find((d) => d.serial.toUpperCase() === oldSerial.trim().toUpperCase());
    const newDev = devices.find((d) => d.serial.toUpperCase() === newSerial.trim().toUpperCase());
    if (!oldDev || !newDev) {
      triggerToast('Select both the current broken device and the replacement serial.');
      return;
    }
    const today = todayPP();
    const nowTime = stampSecPP();
    const staffActor = replacedByStaff.trim() || operatorLabel || 'Field Staff';
    const why = reason.trim() || 'Broken hardware replaced at merchant';
    const histRec = historyRecordFor(oldDev, {
      reason: `Device Replaced by ${newDev.serial}: ${why}`,
      status: 'RETURNED',
      actor: staffActor,
      notes: `Replaced broken serial ${oldDev.serial} with ${newDev.serial} by ${staffActor}.`,
    });
    const updatedOld: Device = {
      ...onMove(oldDev, 'FAULTY'),
      returnedByStaff: staffActor,
      returnedDate: today,
      returnReason: `Replaced by ${newDev.serial} (${why})`,
      deployedDate: '',
      redeployCount: (oldDev.redeployCount || 0) + 1,
      updatedAt: today,
      note: `Broken / Replaced by ${newDev.serial} (${why}) — Staff: ${staffActor}`,
      history: [
        `${nowTime} | Device Replacement (Out) | Broken unit replaced by ${newDev.serial} for ${oldDev.merchantName} (${oldDev.mid}) · Reason: ${why} — Staff: ${staffActor}`,
        ...(oldDev.history || []),
      ],
    };
    const updatedNew: Device = {
      ...onMove(newDev, 'COMPLETE'),
      branchId: oldDev.branchId,
      branchName: oldDev.branchName,
      staff: staffActor,
      mid: oldDev.mid,
      tid: oldDev.tid,
      merchantName: oldDev.merchantName,
      merchantPhone: oldDev.merchantPhone,
      address: oldDev.address,
      location: oldDev.location,
      deployedDate: today,
      installedByStaff: oldDev.installedByStaff || staffActor,
      replacedByStaff: staffActor,
      replacedPrevSerial: oldDev.serial,
      replacedDate: today,
      updatedAt: today,
      note: `Replacement for broken SN ${oldDev.serial} (${why}) — Replaced by: ${staffActor}`,
      history: [
        `${nowTime} | Device Replacement (Live) | Swapped in to replace broken SN ${oldDev.serial} at ${oldDev.merchantName} (MID ${oldDev.mid}) · Reason: ${why} — Staff: ${staffActor}`,
        ...(newDev.history || []),
      ],
    };
    setDevices((prev) =>
      prev.map((d) => {
        if (d.serial === oldDev.serial) return updatedOld;
        if (d.serial === newDev.serial) return updatedNew;
        return d;
      })
    );
    setHistoricalMerchants((prev) => [histRec, ...prev]);
    addAuditLog(
      'Merchant Device Replacement',
      `Replaced broken ${oldDev.serial} with ${newDev.serial} for ${oldDev.merchantName} (MID ${oldDev.mid}) — Staff: ${staffActor}`
    );
    triggerOptimisticSync([oldDev.serial, newDev.serial], `Replaced ${oldDev.serial} -> ${newDev.serial}`);
    triggerToast(`Device replaced! Front table updated to new serial ${newDev.serial} (Replaced by ${staffActor}).`);
  };
  const _unusedRestoreEnd = () => {
  };

  // Batch Stock Upload Handler (from classic BatchUploadModal). (22 Oct 2026) HQ only; new serials only – a serial that
  // already exists is never overwritten, and nothing is filled in with sample values.
  const handleCommitBatch = (newBatchItems: Partial<Device>[]) => {
    if (role === 'BRANCH') { triggerToast('Only HQ can register stock.'); return; }
    const today = todayPP();
    const nowTime = stampSecPP();
    const existing = new Set(devices.map((d) => d.serial.toUpperCase()));
    const seen = new Set<string>();
    const problems: string[] = [];
    const created: Device[] = [];
    newBatchItems.forEach((item) => {
      const sn = String(item.serial || '').trim().toUpperCase();
      if (!sn) { problems.push('a row without a serial'); return; }
      if (existing.has(sn) || seen.has(sn)) { problems.push(`${sn} (already in the inventory)`); return; }
      const bCode = item.branchId || '100';
      const branchObj = branches.find((b) => b.code === bCode || b.id === bCode);
      if (!branchObj && bCode !== '100') { problems.push(`${sn} (unknown branch ${bCode})`); return; }
      const hasMerchantInfo = Boolean((item.mid && item.mid.trim()) || (item.merchantName && item.merchantName.trim()));
      const rawStage: LifecycleStage = item.stage || (bCode !== '100' ? 'BRANCH_RESERVE' : 'HQ_STOCK');
      const stg: LifecycleStage = (rawStage === 'HQ_STOCK' || rawStage === 'BRANCH_RESERVE') && hasMerchantInfo ? 'CONFIGURING' : rawStage;
      seen.add(sn);
      created.push({
        serial: sn,
        batterySerial: item.batterySerial || '',
        batteryInstalledDate: item.batteryInstalledDate || '',
        type: item.type || 'POS Terminal',
        model: item.model || '',
        stockInDate: item.stockInDate || today,
        branchId: stg === 'HQ_STOCK' ? '100' : bCode,
        branchName: stg === 'HQ_STOCK' ? 'Head Office' : branchObj!.name,
        staff: item.staff || '',
        stage: stg,
        ...statusOf(stg),
        mid: (stg === 'CONFIGURING' || stg === 'COMPLETE') ? (item.mid || '') : '',
        tid: (stg === 'CONFIGURING' || stg === 'COMPLETE') ? (item.tid || (item.mid ? tidFromMid(item.mid) : '')) : '',
        merchantName: (stg === 'CONFIGURING' || stg === 'COMPLETE') ? (item.merchantName || '') : '',
        merchantPhone: '',
        location: item.location || '',
        address: '',
        deployedDate: '',
        returnReason: '',
        redeployCount: 0,
        hoursInStage: 0,
        updatedAt: today,
        note: item.note || '',
        history: [`${nowTime} | Stock Intake | Registered into ${stg === 'HQ_STOCK' ? 'HQ stock' : 'Branch Code ' + bCode + ' reserve'} — Officer: ${operatorLabel || 'HQ'}`],
        archived: false,
      });
    });
    if (!created.length) { triggerToast(`Nothing registered: ${problems.slice(0, 5).join(', ')}${problems.length > 5 ? '…' : ''}.`); return; }

    setDevices((prev) => [...created, ...prev]);
    triggerOptimisticSync(created.map((c) => c.serial), `Registered ${created.length} new serial(s) into inventory`, created);
    addAuditLog('Batch Stock Intake', `Registered ${created.length} serial(s) into inventory${problems.length ? `; skipped: ${problems.slice(0, 20).join(', ')}` : ''}`);
    triggerToast(`Registered ${created.length} new serial(s)` + (problems.length ? `; ${problems.length} skipped (${problems.slice(0, 3).join(', ')}${problems.length > 3 ? '…' : ''})` : '.'));
  };

  // Every Request Must Alert Notification (from classic RequestStockModal)
  const handleSubmitStockRequest = (reqData: {
    branchId: string;
    staff: string;
    posQty: number;
    sbQty: number;
    reason: string;
  }) => {
    const nowStr = stampPP();
    // (22 Oct 2026) a branch account always requests for its own branch, in its own name
    const branchId = role === 'BRANCH' ? selectedBranch : reqData.branchId;
    const branchObj = branches.find((b) => b.code === branchId);
    const posQty = Math.max(0, Math.floor(Number(reqData.posQty) || 0));
    const sbQty = Math.max(0, Math.floor(Number(reqData.sbQty) || 0));
    if (!branchObj || branchId === '100') { triggerToast('Choose the branch the stock is for.'); return; }
    if (posQty + sbQty === 0) { triggerToast('Enter at least one POS Terminal or Sound Box.'); return; }
    const newReq: Requisition = {
      reqId: newRecordId('REQ'),
      date: nowStr,
      branchId,
      branchName: branchObj.name,
      staff: role === 'BRANCH' ? operatorLabel : reqData.staff || operatorLabel,
      posQty,
      sbQty,
      reason: reqData.reason,
      status: 'PENDING_ADMIN',
      type: 'STOCK_REQUEST',
      returnSerials: [],
    };

    setRequisitions((prev) => [newReq, ...prev]);
    addAuditLog(
      'Stock Request Submitted',
      `Submitted ${newReq.reqId} for ${newReq.posQty}x POS & ${newReq.sbQty}x Sound Box (Branch Code ${reqData.branchId})`
    );

    addNotification(
      `Request from Branch Staff • ${newReq.reqId}`,
      `Branch Staff ${newReq.staff} (Branch Code ${reqData.branchId} — ${newReq.branchName}) requested ${newReq.posQty}x POS & ${newReq.sbQty}x Sound Box: "${newReq.reason}"`,
      'REQUEST',
      reqData.branchId,
      'requisitions'
    );

    triggerToast(`Alert Sent! Request ${newReq.reqId} notified to Admin HQ & Super Admin`);
  };

  // (22 Oct 2026) HQ, or the branch that made it, can change the quantity or reason of a request that is still pending
  const handleEditRequisition = (reqId: string, changes: { posQty: number; sbQty: number; reason: string }) => {
    const target = requisitions.find((r) => r.reqId === reqId);
    if (!target) return;
    if (target.status !== 'PENDING_ADMIN' || target.type === 'STOCK_RETURN') { triggerToast(`Request ${reqId} can no longer be edited (${target.status}).`); return; }
    if (role === 'BRANCH' && target.branchId !== selectedBranch) { triggerToast('You can edit only your own branch requests.'); return; }
    const posQty = Math.max(0, Math.floor(changes.posQty || 0));
    const sbQty = Math.max(0, Math.floor(changes.sbQty || 0));
    if (posQty + sbQty === 0) { triggerToast('Enter at least one POS Terminal or Sound Box.'); return; }
    setRequisitions((prev) => prev.map((r) => (r.reqId === reqId ? { ...r, posQty, sbQty, reason: changes.reason } : r)));
    addAuditLog('Stock Request Edited', `${reqId}: ${target.posQty}x POS & ${target.sbQty}x Sound Box → ${posQty}x POS & ${sbQty}x Sound Box`);
    triggerToast(`Request ${reqId} updated.`);
  };

  // Approve & Dispatch Requisitions (for RequisitionsTab). (22 Oct 2026) With the shared database the server checks every
  // unit and keeps it allocated in HQ stock until the branch confirms receipt; no unit is ever created here.
  const handleApproveRequisition = (
    reqId: string,
    arrangedDevices?: ArrangedDeviceItem[]
  ) => {
    const targetReq = requisitions.find((r) => r.reqId === reqId);
    if (!targetReq) return;
    if (role === 'BRANCH') { triggerToast('Only HQ can dispatch stock.'); return; }
    if (targetReq.status !== 'PENDING_ADMIN' || targetReq.type === 'STOCK_RETURN') { triggerToast(`Request ${reqId} cannot be dispatched (${targetReq.status}).`); return; }
    const serials = (arrangedDevices || []).map((a) => (a.serial || '').trim()).filter(Boolean);
    if (!serials.length) { triggerToast('Choose the units to dispatch first.'); return; }

    const finish = (count: number) => {
      addAuditLog('Requisition Approved & Dispatched', `Dispatched ${count} unit(s) for ${reqId} to Branch Code ${targetReq.branchId}`);
      triggerToast(`Dispatched ${count} unit(s) for ${reqId} to Branch Code ${targetReq.branchId}. They stay allocated in HQ stock until the branch confirms receipt.`);
      setFulfillingRequisition(null);
      setStagedFulfillmentItems(null);
    };
    if (isSupabaseConfigured) {
      dispatchRequisitionOnServer(reqId, serials)
        .then((items) => finish(items.length))                  // the live feed brings the changed rows
        .catch((e) => triggerToast(e instanceof Error ? e.message : String(e)));
      return;
    }
    // local preview: the same checks as the server
    const bySerial = new Map(devices.map((d) => [d.serial.toUpperCase(), d]));
    const seen = new Set<string>();
    const errors: string[] = [];
    let pos = 0; let sb = 0;
    serials.forEach((sn) => {
      const key = sn.toUpperCase(); const d = bySerial.get(key);
      if (seen.has(key)) { errors.push(`${sn} is listed twice`); return; }
      seen.add(key);
      if (!d) { errors.push(`${sn} is not in the inventory`); return; }
      if (d.stage !== 'HQ_STOCK' || d.archived) { errors.push(`${sn} is not in HQ stock`); return; }
      if (d.customFields?.allocatedTo && d.customFields.allocatedTo !== reqId) { errors.push(`${sn} is allocated to ${d.customFields.allocatedTo}`); return; }
      if (d.type === 'Sound Box') sb++; else pos++;
    });
    if (pos > targetReq.posQty || sb > targetReq.sbQty) errors.push('more units than requested');
    if (errors.length) { triggerToast(`Not dispatched: ${errors.join('; ')}.`); return; }
    const nowTime = stampSecPP();
    const items: ArrangedDeviceItem[] = serials.map((sn) => { const d = bySerial.get(sn.toUpperCase())!; return { serial: d.serial, batterySerial: d.batterySerial || '', type: d.type, model: d.model }; });
    setDevices((prev) => prev.map((d) => !seen.has(d.serial.toUpperCase()) ? d : {
      ...d,
      customFields: { ...(d.customFields || {}), allocatedTo: reqId },
      history: [`${nowTime} | Dispatched from HQ | Request ${reqId} to Branch Code ${targetReq.branchId} — Officer: ${operatorLabel || 'HQ'}`, ...(d.history || [])],
    }));
    setRequisitions((prev) => prev.map((r) => (r.reqId === reqId ? { ...r, status: 'DISPATCHED', arrangedDevices: items } : r)));
    finish(items.length);
  };

  const handleRejectRequisition = (reqId: string, reason: string) => {
    const target = requisitions.find((r) => r.reqId === reqId);
    if (!target) return;
    if (role === 'BRANCH') { triggerToast('Only HQ can reject a request.'); return; }
    if (target.status !== 'PENDING_ADMIN') { triggerToast(`Request ${reqId} is already ${target.status} and cannot be rejected.`); return; }
    const why = reason.trim();
    if (why.length < 3) { triggerToast('Write the reason for rejecting this request.'); return; }
    const finish = () => { addAuditLog('Requisition Rejected', `Request ${reqId} from Branch Code ${target.branchId} rejected: ${why}`); triggerToast(`Request ${reqId} rejected. The branch can see the reason.`); };
    if (isSupabaseConfigured) {
      rejectRequisitionOnServer(reqId, why).then(() => {
        setRequisitions((prev) => prev.map((r) => (r.reqId === reqId && r.status === 'PENDING_ADMIN' ? { ...r, status: 'REJECTED', rejectReason: why, rejectedBy: operatorLabel || 'HQ', rejectedAt: stampSecPP() } : r)));
        finish();
      }).catch((e) => triggerToast(e instanceof Error ? e.message : String(e)));   
      return;
    }
    setRequisitions((prev) => prev.map((r) => (r.reqId === reqId ? { ...r, status: 'REJECTED', rejectReason: why, rejectedBy: operatorLabel || 'HQ', rejectedAt: stampSecPP() } : r)));
    finish();
  };

  const handleConfirmFulfillment = (selectedSerials: string[]) => {
    if (!fulfillingRequisition) return;
    const chosen = new Set(selectedSerials);
    const selectedDevices = devices.filter((d) => chosen.has(d.serial));
    // (22 Oct 2026) only the units chosen – no invented battery serials and no blank padding lines
    const staged: ArrangedDeviceItem[] = selectedDevices.map((d) => ({
      serial: d.serial,
      batterySerial: d.batterySerial || '',
      type: d.type,
      model: d.model,
    }));

    setStagedFulfillmentItems(staged);
    setActiveTab('requisitions');
    triggerToast(
      `Loaded ${selectedDevices.length} serial(s) from Stock Inventory into Requisition ${fulfillingRequisition.reqId}.`
    );
  };

  const handleCancelFulfillment = () => {
    setFulfillingRequisition(null);
    setStagedFulfillmentItems(null);
    setStageFilter('ALL');
    setBranchFilter('ALL');
  };

  const handleReceiveRequisition = (reqId: string) => {
    if (isSupabaseConfigured) {
      confirmReceiptOnServer(reqId)
        .then(({ moved, skipped }) => {
          addAuditLog('Requisition Received', `Receipt of ${reqId} confirmed: ${moved.length} unit(s) received`);
          triggerToast(`Confirmed receipt of ${reqId}: ${moved.length} unit(s) received` + (skipped.length ? `; not moved (not in HQ stock): ${skipped.join(', ')}` : ''));
        })
        .catch((e) => triggerToast(`Receipt not confirmed: ${e instanceof Error ? e.message : e}`));
      return;
    }
    // local preview: the same rule as the server (only units still allocated in HQ stock move to the branch)
    const req = requisitions.find((r) => r.reqId === reqId);
    if (!req || req.status !== 'DISPATCHED' || !inScope({ branchId: req.branchId } as Device)) { triggerToast(`Request ${reqId} cannot be received.`); return; }
    const arranged = new Set((req.arrangedDevices || []).map((a) => a.serial));
    const bObj = branches.find((b) => b.code === req.branchId);
    const nowTime = stampSecPP();
    setDevices((prev) => prev.map((d) => {
      if (!arranged.has(d.serial) || d.stage !== 'HQ_STOCK' || (d.customFields?.allocatedTo || reqId) !== reqId) return d;
      const { allocatedTo: _a, ...cf } = d.customFields || {};
      return { ...onMove(d, 'BRANCH_RESERVE'), branchId: req.branchId, branchName: bObj?.name || req.branchName, customFields: cf,
        history: [`${nowTime} | Received at Branch | Request ${reqId} confirmed by ${operatorLabel}`, ...(d.history || [])] };
    }));
    setRequisitions((prev) => prev.map((r) => (r.reqId === reqId ? { ...r, status: 'RECEIVED' } : r)));
    addAuditLog('Requisition Received', `Branch confirmed receipt of ${reqId}`);
    triggerToast(`Confirmed receipt of ${reqId}`);
  };

  // Approve & Finalize Return Requisition (HQ receives units). (22 Oct 2026) Only a pending return; with the shared
  // database the server moves only units still at that branch (a faulty unit stays "Faulty").
  const handleApproveReturnRequisition = (
    reqId: string,
    _returnSerials?: string[],
    reason?: string
  ) => {
    const targetReq = requisitions.find((r) => r.reqId === reqId);
    if (!targetReq) return;
    if (role === 'BRANCH') { triggerToast('Only HQ can approve a return.'); return; }
    if (targetReq.type !== 'STOCK_RETURN' || targetReq.status !== 'PENDING_ADMIN') { triggerToast(`Return ${reqId} cannot be approved (${targetReq.status}).`); return; }
    const serialsToReturn = targetReq.returnSerials || [];
    if (isSupabaseConfigured) {
      receiveReturnOnServer(reqId, reason)
        .then(({ moved, skipped }) => {
          addAuditLog('Return Request Approved & Received', `Return ${reqId}: ${moved.length} unit(s) received at HQ`);
          triggerToast(`Return ${reqId}: ${moved.length} unit(s) received at HQ` + (skipped.length ? `; not moved: ${skipped.join(', ')}` : ''));
        })
        .catch((e) => triggerToast(e instanceof Error ? e.message : String(e)));
      return;
    }
    const eligible = devices.filter((d) => serialsToReturn.includes(d.serial) && d.branchId === targetReq.branchId &&
      (d.stage === 'BRANCH_RESERVE' || d.stage === 'CONFIGURING' || d.stage === 'FAULTY'));
    if (eligible.length) handleReturnToAdminStock(eligible.map((d) => d.serial), `Approved Return Request ${reqId}: ${reason || targetReq.reason}`);
    setRequisitions((prev) => prev.map((r) => (r.reqId === reqId ? { ...r, status: 'RECEIVED' } : r)));
    addAuditLog('Return Request Approved & Received', `Return ${reqId}: ${eligible.length} of ${serialsToReturn.length} unit(s) received at HQ`);
    triggerToast(`Approved return ${reqId}: ${eligible.length} unit(s) received at HQ`);
  };

  // Merchant CRM Bindings (22 Oct 2026): only a unit already in the inventory, waiting at a branch (reserve or being set
  // up), not archived, not allocated and not bound to another MID can be bound. No unit is created here.
  const bindProblem = (d: Device | undefined, mid: string): string => {
    if (!d) return 'is not in the inventory (register it first)';
    if (!inScope(d)) return 'belongs to another branch';
    if (d.archived) return 'is archived';
    if (d.customFields?.allocatedTo) return `is allocated to ${d.customFields.allocatedTo}`;
    if (!(d.stage === 'BRANCH_RESERVE' || d.stage === 'CONFIGURING')) return `is in ${STAGE_META[d.stage].short} (only Branch Reserve or Configuring units can be bound)`;
    if (d.branchId === '100') return 'is still at Head Office (dispatch it to a branch first)';
    if (d.mid && d.mid.trim() !== mid.trim()) return `is already bound to MID ${d.mid}`;
    if (!/^\d{15}$/.test(mid.trim())) return 'needs a 15-digit MID';
    return '';
  };
  const handleBindDeviceToMerchant = (serial: string, merchantData: MerchantBindPayload) => {
    const cleanSn = serial.trim().toUpperCase();
    const dev = devices.find((d) => d.serial.toUpperCase() === cleanSn);
    const problem = bindProblem(dev, merchantData.mid);
    if (problem) { triggerToast(`Not bound: ${cleanSn} ${problem}.`); return; }
    handleSaveWorkflow(dev!.serial, {
      stage: 'COMPLETE',
      branchId: dev!.branchId,
      staff: dev!.staff || operatorLabel,
      merchantName: merchantData.merchantName,
      merchantPhone: merchantData.merchantPhone,
      address: merchantData.address,
      mid: merchantData.mid.trim(),
      tid: tidFromMid(merchantData.mid, merchantData.tid),
      note: `Bound to ${merchantData.merchantName} (MID ${merchantData.mid}${merchantData.tid ? ' / TID ' + merchantData.tid : ''})`,
      deployedDate: merchantData.deployedDate || todayPP(),
      batteryInstalledDate: dev!.batteryInstalledDate || '',
      deploymentStatus: merchantData.deploymentStatus,
      stockStatus: merchantData.stockStatus,
    });
  };

  const handleBulkBindDevicesToMerchants = (assignments: Array<MerchantBindPayload & { serial: string }>) => {
    if (assignments.length === 0) return;
    const today = todayPP();
    const nowTime = stampSecPP();
    const bySn = new Map(devices.map((d) => [d.serial.toUpperCase(), d]));
    const problems: string[] = [];
    const seen = new Set<string>();
    const nextMap = new Map<string, Device>();
    assignments.forEach((a) => {
      const sn = a.serial.trim().toUpperCase();
      const d = bySn.get(sn);
      if (seen.has(sn)) { problems.push(`${sn} is listed twice`); return; }
      seen.add(sn);
      const p = bindProblem(d, a.mid);
      if (p) { problems.push(`${sn} ${p}`); return; }
      nextMap.set(d!.serial, {
        ...onMove(d!, 'COMPLETE'),
        ...(a.deploymentStatus ? { deploymentStatus: a.deploymentStatus } : {}),
        ...(a.stockStatus ? { stockStatus: a.stockStatus } : {}),
        merchantName: a.merchantName,
        merchantPhone: a.merchantPhone,
        address: a.address,
        mid: a.mid.trim(),
        tid: tidFromMid(a.mid, a.tid),
        deployedDate: a.deployedDate || today,
        installedByStaff: d!.installedByStaff || operatorLabel,
        updatedAt: today,
        history: [`${nowTime} | Installed (Live) | Bulk bound to ${a.merchantName} (MID ${a.mid}${a.tid ? ' / TID ' + a.tid : ''}) — Officer: ${operatorLabel}`, ...(d!.history || [])],
      });
    });
    if (nextMap.size) setDevices((prev) => prev.map((d) => nextMap.get(d.serial) || d));
    addAuditLog('Bulk Merchant Binding', `Bound ${nextMap.size} unit(s) to merchants${problems.length ? `; refused: ${problems.slice(0, 20).join('; ')}` : ''}`);
    triggerToast(`Bound ${nextMap.size} unit(s)` + (problems.length ? `; ${problems.length} refused: ${problems.slice(0, 3).join('; ')}${problems.length > 3 ? '…' : ''}` : '.'));
  };

  const handleSaveBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = branchCodeInput.trim();
    const name = branchNameInput.trim();
    const staffArr = branchStaffInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (!code || !name) return;
    if (!editingBranch && branches.some((b) => b.code === code)) {
      triggerToast(`Branch Code ${code} already exists!`);
      return;
    }
    if (!/^[A-Za-z0-9-]{1,10}$/.test(code)) {
      triggerToast('Branch Code: up to 10 letters or digits.');
      return;
    }
    if (isSupabaseConfigured) {
      // (22 Oct 2026, review) saved on the server first, so every admin sees the same branches
      const err = await saveBranchOnServer({ id: editingBranch ? editingBranch.id : code, name });
      if (err) { triggerToast(`Branch Code ${code} was not saved: ${err}`); return; }
    }

    if (editingBranch) {
      setBranches((prev) =>
        prev.map((b) =>
          b.code === editingBranch.code
            ? { ...b, name, staff: staffArr.length ? staffArr : b.staff }
            : b
        )
      );
      addAuditLog('Branch Code Updated', `Updated Branch Code ${code} (${name})`);
      triggerToast(`Branch Code ${code} updated`);
    } else {
      if (branches.some((b) => b.code === code)) {
        triggerToast(`Branch Code ${code} already exists!`);
        return;
      }
      setBranches((prev) => [
        ...prev,
        {
          id: code,
          code,
          name,
          staff: staffArr.length ? staffArr : ['Branch Officer'],
          staffDetails: [],
        },
      ]);
      addAuditLog('Branch Code Created', `Created new Branch Code ${code} (${name})`);
      triggerToast(`Branch Code ${code} created`);
    }
    setIsNewBranchModalOpen(false);
    setEditingBranch(null);
  };

  const handleSaveUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userEmpIdInput.trim() || !userNameInput.trim()) return;
    const today = todayPP();
    const bObj = branches.find((b) => b.code === userBranchInput);

    if (editingUser) {
      setUsers((prev) =>
        prev.map((u) =>
          u.uid === editingUser.uid
            ? {
                ...u,
                empId: userEmpIdInput.trim(),
                name: userNameInput.trim(),
                label: `${userNameInput.trim()} (${userEmpIdInput.trim()})`,
                position: userTitleInput.trim(),
                branchId: userBranchInput,
                branchName: bObj?.name || `Branch Code ${userBranchInput}`,
                accessRole: userRoleInput,
                status: userStatusInput,
                password: userPasswordInput.trim() ? userPasswordInput.trim() : (editingUser.password || userEmpIdInput.trim()),
                updatedAt: today,
              }
            : u
        )
      );
      addAuditLog(
        'IAM Account Updated',
        `Updated ${userNameInput} (${userRoleInput}, Branch Code ${userBranchInput})`
      );
      triggerToast(`Updated user ${userNameInput}`);
    } else {
      const newUser: User = {
        uid: newRecordId('USR'),
        empId: userEmpIdInput.trim(),
        name: userNameInput.trim(),
        label: `${userNameInput.trim()} (${userEmpIdInput.trim()})`,
        position: userTitleInput.trim(),
        branchId: userBranchInput,
        branchName: bObj?.name || `Branch Code ${userBranchInput}`,
        accessRole: userRoleInput,
        contact: '',
        status: userStatusInput,
        password: userPasswordInput.trim() || userEmpIdInput.trim(),
        updatedAt: today,
      };
      setUsers((prev) => [newUser, ...prev]);
      addAuditLog(
        'IAM Account Created',
        `Created ${newUser.name} (${newUser.accessRole}, Branch Code ${newUser.branchId})`
      );
      triggerToast(`Created user ${newUser.name}`);
    }
    setIsUserModalOpen(false);
    setEditingUser(null);
  };

  const handleExportInventoryCsv = (onlyStage?: LifecycleStage) => {
    const exportListExact = onlyStage ? filteredInventory.filter((d) => d.stage === onlyStage) : filteredInventory;
    const activeCustomExact = (appSettings.customFields || []).filter((f) => f.enabled && (!f.targetTab || f.targetTab === 'all' || f.targetTab === 'inventory'));
    const headersExactTable = [
      'No.',
      'Date',
      'Type',
      'Model',
      'Device Serial',
      'Battery Serial',
      'Branch Code',
      'Branch Name',
      'Location',
      'Status',
      'Merchant Name',
      'MID',
      'TID',
      'Staff',
      'Note',
      ...activeCustomExact.map((f) => f.label),
    ];
    const rowsExactTable = exportListExact.map((d, idx) => {
      const bObj = branches.find((b) => b.code === d.branchId);
      const bName = bObj?.name || d.branchName || `Branch ${d.branchId}`;
      const customCells = activeCustomExact.map((f) => {
        if (f.id === 'location') return d.location || '';
        if (f.id === 'merchantPhone') return d.merchantPhone ? phoneFor(role, d.merchantPhone) : '';
        if (f.id === 'address') return d.address || '';
        return d.customFields?.[f.id] || '';
      });
      return [
        String(idx + 1),
        d.updatedAt || d.stockInDate || '',
        d.type,
        d.model || '',
        d.serial,
        d.batterySerial || '',
        d.branchId,
        bName,
        d.location || '',
        STAGE_META[d.stage].short,
        d.merchantName || '',
        d.mid || '',
        d.tid || '',
        d.staff || '',
        d.note || '',
        ...customCells,
      ];
    });
    const blobExact = csvFile([headersExactTable, ...rowsExactTable]);
    const urlExact = URL.createObjectURL(blobExact);
    const linkExact = document.createElement('a');
    linkExact.href = urlExact;
    linkExact.download = `POS_Soundbox_Inventory_${onlyStage ? STAGE_META[onlyStage].short.replace(/[^A-Za-z0-9]+/g, '_') + '_' : ''}${todayPP()}.csv`;
    document.body.appendChild(linkExact);
    linkExact.click();
    document.body.removeChild(linkExact);
    URL.revokeObjectURL(urlExact);
    addAuditLog('Inventory CSV Exported', `Exported ${exportListExact.length} hardware serials matching table view`);
    triggerToast(`Exported ${exportListExact.length} rows to CSV (matching table columns)`);
    if (Boolean(true)) return;
    const exportList = onlyStage ? filteredInventory.filter((d) => d.stage === onlyStage) : filteredInventory;
    const activeCustom = (appSettings.customFields || []).filter((f) => f.enabled);
    const headers = [
      'Stock_In_Date',
      'Serial_SN',
      'Product_Type',
      'Model',
      'Battery_Serial',
      'Branch_Code',
      'Branch_Name',
      'Lifecycle_Stage',
      'Merchant_Name',
      'MID',
      'TID',
      'Serial_Cycles_Count',
      'Archived',
      ...activeCustom.map((f) => f.label.replace(/\s+/g, '_')),
    ];
    const rows = exportList.map((d) => {
      const bObj = branches.find((b) => b.code === d.branchId);
      const bName = bObj?.name || d.branchName || `Branch ${d.branchId}`;
      const batSn = d.batterySerial || '';                             // (22 Oct 2026) the recorded value only
      const customCells = activeCustom.map((f) => {
        if (f.id === 'location') return d.location || '';
        if (f.id === 'merchantPhone') return d.merchantPhone ? phoneFor(role, d.merchantPhone) : '';
        if (f.id === 'address') return d.address || '';
        return d.customFields?.[f.id] || '';
      });
      return [
        d.stockInDate,
        d.serial,
        d.type,
        d.model,
        batSn,
        d.branchId,
        bName,
        STAGE_META[d.stage].short,
        d.merchantName || '',
        d.mid || '',
        d.tid || '',
        String(d.redeployCount || 0),
        d.archived ? 'Yes' : 'No',
        ...customCells,
      ];
    });
    const blob = csvFile([headers, ...rows]);                          // BOM + CRLF, every cell formula-safe
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `POS_Soundbox_Inventory_${onlyStage ? STAGE_META[onlyStage].short.replace(/[^A-Za-z0-9]+/g, '_') + '_' : ''}${
      todayPP()
    }.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    addAuditLog(
      'Inventory CSV Exported',
      `Exported ${exportList.length} hardware serials${onlyStage ? ` (${STAGE_META[onlyStage].short})` : ''}`
    );
    triggerToast(`Exported ${exportList.length} serials to CSV${onlyStage ? ` · ${STAGE_META[onlyStage].short}` : ''}`);
  };

  const handleTriggerMobileSync = async (payload: MobileInstallSyncPayload) => {
    const nowTime = stampSecPP();
    const existingDev = devices.find(
      (d) => d.serial.toUpperCase() === payload.serial.trim().toUpperCase()
    );
    const newEvent: MobileWebhookEvent = {
      eventId:
        payload.eventId || newRecordId('WH'),
      timestamp: nowTime,
      serial: payload.serial,
      previousStage: existingDev?.stage || 'CONFIGURING',
      newStage: payload.stage,
      mid: payload.mid || '',
      tid: tidFromMid(payload.mid, payload.tid),
      merchantName: payload.merchantName || '',
      merchantPhone: payload.merchantPhone || '',
      address: payload.address || '',
      installerStaff: payload.installerStaff || selectedStaffUser || 'Field Installer',
      branchId: payload.branchId || selectedBranch,
      note: payload.note || 'Synced via Mobile Field System API',
      source: payload.source || 'COMPANION_SIMULATOR',
      status: 'APPLIED',
    };
    setWebhookEvents((prev) => [newEvent, ...prev]);
    handleSaveWorkflow(payload.serial, {
      stage: payload.stage,
      branchId: payload.branchId || selectedBranch,
      staff: payload.installerStaff || selectedStaffUser || 'Field Installer',
      merchantName: payload.merchantName || '',
      merchantPhone: payload.merchantPhone,
      address: payload.address,
      mid: payload.mid || '',
      tid: tidFromMid(payload.mid, payload.tid),
      note: payload.note || 'Synced via Mobile Field System API',
      deployedDate: todayPP(),
      batteryInstalledDate:
        existingDev?.batteryInstalledDate ||
        todayPP(),
    });

    try {
      await fetch('/api/v1/installations/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          eventId: newEvent.eventId,
          previousStage: newEvent.previousStage,
        }),
      });
    } catch {
      // Local state already synced
    }
  };

  const handleReconcileWebhookEvents = (
    eventsToApply: MobileWebhookEvent[],
    mode: 'SINGLE' | 'BATCH'
  ) => {
    if (eventsToApply.length === 0) return;
    const today = todayPP();
    const nowTime = stampSecPP();

    setDevices((prev) => {
      const existingMap = new Map<string, Device>();
      prev.forEach((d) => existingMap.set(d.serial.toUpperCase(), d));

      const updated = prev.map((d) => {
        const evt = eventsToApply.find(
          (e) => e.serial.trim().toUpperCase() === d.serial.toUpperCase()
        );
        if (!evt) return d;
        const bObj = branches.find((b) => b.code === evt.branchId);
        const nextCycleNum = (d.history || []).length + 1;
        return {
          ...d,
          stage: evt.newStage,
          branchId: evt.branchId || d.branchId,
          branchName: bObj?.name || d.branchName,
          staff: evt.installerStaff || d.staff,
          mid: evt.mid || d.mid,
          tid: tidFromMid(evt.mid || d.mid, evt.tid || d.tid),
          merchantName: evt.merchantName || d.merchantName,
          merchantPhone: evt.merchantPhone || d.merchantPhone,
          address: evt.address || d.address,
          updatedAt: today,
          archived: false,
          history: [
            `${nowTime} | Cycle #${nextCycleNum}: Reconciled (${
              STAGE_META[evt.newStage]?.short || evt.newStage
            }) | Synced with mobile event ${evt.eventId}`,
            ...(d.history || []),
          ],
        };
      });

      const unregistered = eventsToApply
        .filter((e) => !existingMap.has(e.serial.trim().toUpperCase()))
        .map((e) => {
          const cleanSn = e.serial.trim().toUpperCase();
          const bObj = branches.find((b) => b.code === e.branchId);
          const isSb = cleanSn.startsWith('SB');
          return {
            serial: cleanSn,
            batterySerial: isSb
              ? `BAT-SB-${cleanSn.replace(/^SB-?/i, '')}`
              : `BAT-${cleanSn.replace(/^POS-?/i, '')}`,
            batteryInstalledDate: today,
            type: (isSb ? 'Sound Box' : 'POS Terminal') as
              | 'POS Terminal'
              | 'Sound Box',
            model: isSb ? 'Q161 Pro' : 'PAX A920 Pro',
            stockInDate: today,
            branchId: e.branchId || selectedBranch,
            branchName: bObj?.name || `Branch Code ${e.branchId || selectedBranch}`,
            staff: e.installerStaff || selectedStaffUser,
            stage: e.newStage,
            deploymentStatus: 'Deployed',
            stockStatus: 'Deployed',
            mid: e.mid || '',
            tid: e.tid || '',
            merchantName: e.merchantName || '',
            merchantPhone: e.merchantPhone || '',
            location: 'Phnom Penh',
            address: e.address || '',
            deployedDate: today,
            returnReason: '',
            redeployCount: 0,
            hoursInStage: 1,
            updatedAt: today,
            note: e.note || 'Registered via Mobile Reconciliation',
            history: [
              `${nowTime} | Cycle #1: Registered via Reconciliation | Event ${e.eventId}`,
            ],
            archived: false,
          };
        });

      return [...unregistered, ...updated];
    });

    setWebhookEvents((prev) => {
      const existingIds = new Set(prev.map((e) => e.eventId));
      const newSynthetics = eventsToApply
        .filter((e) => !existingIds.has(e.eventId))
        .map((e) => ({ ...e, status: 'APPLIED' as const }));
      return [
        ...newSynthetics,
        ...prev.map((e) =>
          eventsToApply.some(
            (x) => x.serial.toUpperCase() === e.serial.toUpperCase()
          )
            ? { ...e, status: 'APPLIED' as const }
            : e
        ),
      ];
    });

    addAuditLog(
      'Mobile Sync Reconciled',
      `Reconciled ${eventsToApply.length} hardware serial(s) (${mode})`
    );
    triggerToast(
      `Reconciled ${eventsToApply.length} serial(s) with mobile webhook ledger`
    );
  };

  const handleReplaceDevice = (
    faultySerial: string,
    replacementSerial: string,
    reason: string,
    replaceStaff?: string
  ) => {
    const today = todayPP();
    const nowTime = stampSecPP();
    const faultyDev = devices.find((d) => d.serial === faultySerial);
    if (!faultyDev) return;
    // (22 Oct 2026) the swap must be possible: the old unit is installed, the new one waits in the same branch
    const newDev = devices.find((d) => d.serial === replacementSerial);
    const swapProblem =
      !inScope(faultyDev) ? `${faultySerial} belongs to another branch`
      : faultyDev.stage !== 'COMPLETE' ? `${faultySerial} is not installed at a merchant`
      : !newDev ? `${replacementSerial} is not in the inventory`
      : newDev.serial === faultyDev.serial ? 'the new unit must be a different unit'
      : newDev.type !== faultyDev.type ? `${replacementSerial} is a ${newDev.type}, not a ${faultyDev.type}`
      : !(newDev.stage === 'BRANCH_RESERVE' || newDev.stage === 'CONFIGURING') || newDev.archived || newDev.customFields?.allocatedTo
        ? `${replacementSerial} is not free branch stock (${STAGE_META[newDev.stage].short})`
      : newDev.branchId !== faultyDev.branchId ? `${replacementSerial} is in another branch`
      : newDev.mid ? `${replacementSerial} is already bound to MID ${newDev.mid}` : '';
    if (swapProblem) { triggerToast(`Not replaced: ${swapProblem}.`); return; }

    const originalInstaller = faultyDev.installedByStaff || faultyDev.staff || selectedStaffUser;
    const replacementOfficer = replaceStaff || selectedStaffUser;
    const isDifferentOfficer = originalInstaller !== replacementOfficer;

    setDevices((prev) =>
      prev.map((d) => {
        if (d.serial === faultySerial) {
          const nextCycle = (d.history || []).length + 1;
          return {
            ...onMove(d, 'BRANCH_RESERVE'),   // the replaced unit goes back to the branch reserve (HQ can return it); no Terminated & Returned stock
            deployedDate: '',
            returnReason: reason,
            installedByStaff: originalInstaller,
            replacedByStaff: replacementOfficer,
            returnedByStaff: replacementOfficer,
            returnedDate: today,
            redeployCount: (d.redeployCount || 0) + 1,
            updatedAt: today,
            history: [
              `${nowTime} | Cycle #${nextCycle}: Marked Faulty & Swapped | Replaced by ${replacementSerial} (${reason}) — Replaced by: ${replacementOfficer}${isDifferentOfficer ? ` (Original Installer: ${originalInstaller})` : ''}`,
              ...(d.history || []),
            ],
          };
        }
        if (d.serial === replacementSerial) {
          const nextCycle = (d.history || []).length + 1;
          return {
            ...onMove(d, 'COMPLETE'),
            branchId: faultyDev.branchId,
            branchName: faultyDev.branchName,
            staff: replacementOfficer,
            installedByStaff: replacementOfficer,
            replacedByStaff: replacementOfficer,
            replacementDate: today,
            replacedFromSerial: faultySerial,
            merchantName: faultyDev.merchantName,
            merchantPhone: faultyDev.merchantPhone,
            address: faultyDev.address,
            mid: faultyDev.mid,
            tid: faultyDev.tid,
            deployedDate: today,
            updatedAt: today,
            history: [
              `${nowTime} | Cycle #${nextCycle}: Replacement Deployed | Swapped in for faulty unit ${faultySerial} at ${
                faultyDev.merchantName || 'Merchant'
              } — Replaced by: ${replacementOfficer}${isDifferentOfficer ? ` (Original Installer: ${originalInstaller})` : ''}`,
              ...(d.history || []),
            ],
          };
        }
        return d;
      })
    );

    if (faultyDev.mid) {
      const histRec = historyRecordFor(faultyDev, {
        reason: `Faulty unit replaced by ${replacementSerial} (${reason})`, status: 'RETURNED', actor: replacementOfficer,
        notes: `Installed by ${originalInstaller}; replaced on site by ${replacementOfficer} with ${replacementSerial}.`,
      });
      setHistoricalMerchants((hPrev) => [histRec, ...hPrev]);
    }

    addAuditLog(
      'Hardware Replacement Swap',
      `Swapped faulty ${faultySerial} with reserve unit ${replacementSerial} (${reason}) — Replaced by ${replacementOfficer}${isDifferentOfficer ? ` (Original Installer: ${originalInstaller})` : ''}`
    );
    triggerToast(
      isDifferentOfficer
        ? `Replaced ${faultySerial} with ${replacementSerial} (Replaced by: ${replacementOfficer} · Installer: ${originalInstaller})`
        : `Replaced faulty ${faultySerial} with ${replacementSerial}`
    );
  };

  // Memoized lists computed unconditionally across all renders
  const adminUsersList = useMemo(
    () => users.filter((u) => u.accessRole === 'SUPER_ADMIN' || u.accessRole === 'ADMIN'),
    [users]
  );

  // (22 Oct 2026) merchants = distinct MIDs of installed, active units in the user's scope
  const uniqueMerchantsCount = useMemo(() => {
    const set = new Set<string>();
    for (const d of scopedDevices) {
      if (d.stage === 'COMPLETE' && !d.archived && d.mid?.trim()) set.add(d.mid.trim());
    }
    return set.size;
  }, [scopedDevices, serverStageSummary]);
  const activeDeviceCount = useMemo(
    () => (serverStageSummary ? serverStageSummary.all : scopedDevices.reduce((n, d) => n + (d.archived ? 0 : 1), 0)),
    [scopedDevices, serverStageSummary]
  );

  const pendingReqsCount = useMemo(
    () => scopedRequisitions.filter((r) => r.status === 'PENDING_ADMIN').length,
    [scopedRequisitions]
  );

  const outOfSyncWebhooksCount = useMemo(() => {
    const stageBySerial = new Map(devices.map((d) => [d.serial.toUpperCase(), d.stage]));
    return webhookEvents.filter((evt) => stageBySerial.get(evt.serial.toUpperCase()) !== evt.newStage).length;
  }, [webhookEvents, devices]);

  // Show Sign-In Page when signed out (placed AFTER all hooks have executed!)
  if (!isAuthenticated) {
    return (
      <ErrorBoundary>
        <SignInPage
          users={users}
          theme={theme}
          appSettings={appSettings}
          onSignInSuccess={handleSignInSuccess}
        />
      </ErrorBoundary>
    );
  }

  return (
    <div className="min-h-screen flex items-start fintech-ambient-light">
      {/* Full-Height Sidebar covering the top-left corner all the way from top to bottom */}
      <Sidebar
        role={role}
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        totalDevices={activeDeviceCount}
        totalMerchants={uniqueMerchantsCount}
        totalHistoricalMerchants={historicalMerchants.length}
        webhookCount={isSupabaseConfigured ? pendingFieldCount : outOfSyncWebhooksCount}
        pendingReqs={pendingReqsCount}
        totalBranches={branches.length}
        totalUsers={users.length}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        mobileOpen={mobileDrawerOpen}
        onCloseMobile={() => setMobileDrawerOpen(false)}
        theme={theme}
        appSettings={appSettings}
      />

      {/* Live Alert Notification Card (Branch Staff Request / Admin Assignment) */}
      {/* Real-time Branch Alert Toast Notification */}
      <AnimatePresence>
        {activeAlertNotif && (
          <motion.div
            initial={{ opacity: 0, y: -16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 28 }}
            className="fixed top-20 right-6 z-50 w-80 sm:w-96 rounded-2xl shadow-2xl border bg-white/98 backdrop-blur-2xl border-slate-200 text-slate-900 overflow-hidden"
          >
            <div className="px-4 py-2.5 bg-slate-50/90 flex items-center justify-between border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-800">
                  New Stock Requisition
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActiveAlertNotif(null)}
                className="text-xs font-semibold text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
            <div className="p-4 flex flex-col gap-2.5">
              <div className="flex items-start gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-800 border border-slate-200 flex items-center justify-center shrink-0">
                  <SendHorizontal className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-slate-900">
                    {activeAlertNotif.title}
                  </div>
                  <p className="text-[11px] text-slate-600 mt-0.5 leading-snug">
                    {activeAlertNotif.message}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setNotifications((prev) =>
                      prev.map((item) =>
                        item.id === activeAlertNotif.id
                          ? { ...item, read: true }
                          : item
                      )
                    );
                    if (activeAlertNotif.targetTab) {
                      setActiveTab(activeAlertNotif.targetTab);
                    }
                    setActiveAlertNotif(null);
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-extrabold bg-[#003857] hover:bg-[#002a42] text-white cursor-pointer shadow-xs transition"
                >
                  Review Request
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* (22 Oct 2026) messages: every action's result is shown and read out to screen readers */}
      <div aria-live="polite" role="status" className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] w-[min(92vw,560px)] pointer-events-none">
        {toastMessage && (
          <div className="pointer-events-auto flex items-start gap-3 rounded-2xl bg-slate-900 text-white text-xs font-semibold px-4 py-3 shadow-2xl">
            <span className="flex-1 leading-snug">{toastMessage}</span>
            <button type="button" onClick={() => setToastMessage(null)} aria-label="Dismiss message" className="text-slate-300 hover:text-white font-bold cursor-pointer">✕</button>
          </div>
        )}
      </div>
      {serverError && (
        <div role="alert" className="fixed top-0 inset-x-0 z-[70] bg-rose-700 text-white text-xs font-bold px-4 py-2.5 flex items-center justify-center gap-3">
          <span>{serverError}</span>
          <button type="button" onClick={() => window.location.reload()} className="underline cursor-pointer">Reload</button>
        </div>
      )}
      {!serverError && (savePaused || newVersion) && (
        <div role="alert" className={`fixed top-0 inset-x-0 z-[70] text-white text-xs font-bold px-4 py-2.5 flex items-center justify-center gap-3 ${savePaused ? 'bg-rose-700' : 'bg-[#003857]'}`}>
          <span>{savePaused ? 'Saving is paused because several saves failed. Your last change may not be saved – please reload the page.' : 'A new version of this system is available. Please reload to use it.'}</span>
          <button type="button" onClick={() => window.location.reload()} className="underline cursor-pointer">Reload now</button>
        </div>
      )}

      {/* Mobile & Workstation Technical Error Code Popup for Field Staff Screenshot */}
      {techErrorPopup && (
        <div
          role="region"
          aria-label="Technical Error Code Popup"
          className="fixed bottom-16 right-4 z-[65] w-[min(92vw,380px)] rounded-2xl border-2 border-rose-500 bg-slate-950/95 text-white p-4 shadow-2xl pointer-events-auto"
        >
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[11px] font-black uppercase tracking-wider text-rose-400">
              Technical Error — Screenshot for Support
            </span>
            <button
              type="button"
              onClick={() => setTechErrorPopup(null)}
              className="text-[11px] font-bold px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white cursor-pointer"
            >
              Dismiss
            </button>
          </div>
          <div className="font-mono text-xs font-black text-amber-300 bg-rose-950/70 px-3 py-1.5 rounded-lg border border-rose-500/40 mb-2">
            ERROR CODE: {techErrorPopup.code}
          </div>
          <div className="text-[11px] font-mono text-slate-200 space-y-0.5">
            <div>Operation: {techErrorPopup.operation}</div>
            <div>Staff ID: {techErrorPopup.staffId} · Branch: {techErrorPopup.branchId}</div>
            <div>Time: {techErrorPopup.timestamp}</div>
            <div className="text-rose-200 font-sans pt-1 break-words">{techErrorPopup.message}</div>
          </div>
        </div>
      )}

      {/* Right Column: Sticky Header at top + Pipeline Bar + Workspace + Footer */}
      <div className="flex-1 w-full min-w-0 flex flex-col justify-between min-h-screen">
        <div>
          <Header
            role={role}
            onSetRole={handleRoleChange}
            branches={branches}
            adminUsers={adminUsersList}
            activeAdminStaff={activeAdminStaff}
            onChangeAdminStaff={setActiveAdminStaff}
            activeBranchId={selectedBranch}
            onChangeBranchId={handleBranchChange}
            activeStaff={selectedStaffUser}
            onChangeStaff={setSelectedStaffUser}
            onOpenBatchModal={() => setIsBatchModalOpen(true)}
            onOpenRequestModal={() => setIsReqModalOpen(true)}
            onOpenExportModal={() => setIsExportModalOpen(true)}
            onLockSession={() => {
              setIsSessionLocked(true);
              addAuditLog('Session Manually Locked', 'Workstation session manually locked by operator');
            }}
            onSignOut={() => {
              if (isSupabaseConfigured) {                                  // (21 Oct 2026) the server session ends; this browser keeps nothing
                writeAuditLog('Session Terminated', 'Signed out').finally(() => signOutEverywhere());
                return;
              }
              try {
                localStorage.removeItem(STORAGE_KEY_AUTH_SESSION);
                sessionStorage.removeItem(STORAGE_KEY_AUTH_SESSION);
              } catch {}
              addAuditLog('Session Terminated', 'Operator signed out of workstation session');
              setIsSessionLocked(false);
              setIsBatchModalOpen(false);
              setIsReqModalOpen(false);
              setIsNewBranchModalOpen(false);
              setEditingBranch(null);
              setIsUserModalOpen(false);
              setEditingUser(null);
              setIsExportModalOpen(false);
              setEditingDeviceSerial(null);
              setBatteryModalDevice(null);
              setIsAuthenticated(false);
            }}
            activeTab={activeTab}
            onSelectTab={handleSelectTab}
            totalDevices={activeDeviceCount}
            totalMerchants={uniqueMerchantsCount}
            totalHistoricalMerchants={historicalMerchants.length}
            webhookCount={isSupabaseConfigured ? pendingFieldCount : outOfSyncWebhooksCount}
            sseConnected={sseConnected}
            pendingReqs={pendingReqsCount}
            totalUsers={users.length}
            notifications={notifications}
            onMarkAllNotificationsRead={() =>
              setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
            }
            onSelectNotification={(n) => {
              setNotifications((prev) =>
                prev.map((item) =>
                  item.id === n.id ? { ...item, read: true } : item
                )
              );
              if (n.targetTab) handleSelectTab(n.targetTab);
            }}
            theme={theme}
            onToggleSidebar={handleToggleSidebar}
            devices={scopedDevices}
            onSelectDevice={(sn) => setEditingDeviceSerial(sn)}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onTrace={setTraceQuery}
            onlineOperators={onlineOperators}
            pingMs={pingMs}
          />

          {/* Classic Pipeline Stage Filter Bar */}
          <PipelineBar
              role={role}
              counts={pipelineCounts}
              currentStageFilter={stageFilter}
              onSelectStage={(st) => {
                setStageFilter(st);
                if (activeTab !== 'inventory' && st !== 'ALL') {
                  setActiveTab('inventory');
                }
              }}
              theme={theme}
            />

            <main className="px-4 sm:px-6 py-5">
              {/* 6 Elevated KPI Cards with Shadows */}
              <KpiCards
                devices={scopedDevices}
                theme={theme}
                activeStageFilter={stageFilter}
                serverStatsByStage={serverStageSummary?.byStage}
                serverTotal={serverStageSummary?.all}
                historicalMerchants={historicalMerchants}
                onOpenHistoryTab={() => handleSelectTab('merchant_history')}
                onSelectStage={(st) => {
                  setStageFilter(st);
                  if (activeTab !== 'inventory' && st !== 'ALL') {
                    setActiveTab('inventory');
                  }
                }}
              />

              {/* Robust Responsive Tab Content with Error Boundary */}
              {/* (22 Oct 2026) the new page shows at once (no waiting for the old one to fade out) and glides in */}
              <motion.div key={shownTab} className="tab-view" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 36, mass: 0.6 }}>
                  <ErrorBoundary>
                  <Suspense fallback={<TabLoading />}>
                  {shownTab === 'dashboard' && (
                    <DashboardTab
                      devices={scopedDevices}
                      allDevices={devices}
                      branches={branches}
                      requisitions={scopedRequisitions}
                      role={role}
                      selectedBranch={selectedBranch}
                      theme={theme}
                      onSelectDevice={(sn) => setEditingDeviceSerial(sn)}
                      onOpenExportModal={() => setIsExportModalOpen(true)}
                      onNavigateTab={handleSelectTab}
                      batteryLifespanMonths={appSettings.batteryLifespanMonths}
                      batteryWarningMonths={appSettings.batteryWarningMonths}
                    />
                  )}

                  {shownTab === 'merchants' && (
                    <MerchantsCrmTab
                      role={role}
                      devices={scopedDevices}
                      allDevices={devices}
                      branches={branches}
                      activeBranchId={selectedBranch}
                      activeStaff={selectedStaffUser}
                      onOpenWorkflow={(sn) => setEditingDeviceSerial(sn)}
                      onBindDeviceToMerchant={handleBindDeviceToMerchant}
                      onBulkBindDevicesToMerchants={
                        handleBulkBindDevicesToMerchants
                      }
                      onTerminateMerchant={handleTerminateMerchant}
                      onReplaceMerchantDevice={handleReplaceMerchantDevice}
                      onNotifyConfigReady={handleNotifyConfigReady}
                      theme={theme}
                    />
                  )}

                  {shownTab === 'merchant_history' && (
                    <MerchantHistoryTab
                      records={historicalMerchants}
                      branches={branches}
                      role={role}
                      selectedBranch={selectedBranch}
                      theme={theme}
                      devices={devices}
                      onClearAll={role === 'SUPER_ADMIN' ? handleClearHistory : undefined}
                      onAddRecord={(rec) => {
                        setHistoricalMerchants((prev) => [rec, ...prev]);
                        addAuditLog(
                          'Merchant History Archived',
                          `Recorded returned MID ${rec.mid} (${rec.merchantName}) with reason: ${rec.returnReason}`
                        );
                        triggerToast(`Historical record for ${rec.merchantName} saved.`);
                      }}
                      onReturnDeviceStock={handleReturnSingleDeviceStock}
                      onSelectDevice={(sn) => setEditingDeviceSerial(sn)}
                      onToast={(msg) => triggerToast(msg)}
                      operatorLabel={operatorLabel}
                    />
                  )}

                  {(shownTab === 'dashboard' || shownTab === 'merchants' || shownTab === 'inventory') && (
                    <SetupAlert devices={scopedDevices} role={role} onOpen={(sn) => setEditingDeviceSerial(sn)} />
                  )}

                  {shownTab === 'requisitions' && (
                    <RequisitionsTab
                      role={role}
                      requisitions={scopedRequisitions}
                      hqDevices={devices}
                      onOpenRequestModal={() => setIsReqModalOpen(true)}
                      onApproveRequisition={handleApproveRequisition}
                      onApproveReturnRequisition={handleApproveReturnRequisition}
                      onRejectRequisition={handleRejectRequisition}
                      onReceiveRequisition={handleReceiveRequisition}
                      theme={theme}
                      onEditRequisition={handleEditRequisition}
                      externalArrangingReq={fulfillingRequisition}
                      externalStagedItems={stagedFulfillmentItems}
                      onClearExternalArranging={() => {
                        setFulfillingRequisition(null);
                        setStagedFulfillmentItems(null);
                      }}
                    />
                  )}

                  {shownTab === 'inventory' && (
                    <InventoryTab
                      onReturnDevice={(sn) => { setWorkflowPreset('RETURN'); setEditingDeviceSerial(sn); }}
                      devices={filteredInventory}
                      allDevices={scopedDevices}
                      branches={branches}
                      role={role}
                      selectedBranch={selectedBranch}
                      theme={theme}
                      stageFilter={stageFilter}
                      typeFilter={typeFilter}
                      branchFilter={branchFilter}
                      searchQuery={searchQuery}
                      onStageFilterChange={setStageFilter}
                      onTypeFilterChange={setTypeFilter}
                      onBranchFilterChange={setBranchFilter}
                      onSearchChange={setSearchQuery}
                      onSelectDevice={(sn) => setEditingDeviceSerial(sn)}
                      onOpenReqModal={() => setIsReqModalOpen(true)}
                      onOpenBatchModal={() => setIsBatchModalOpen(true)}
                      onExportCsv={(st) => handleExportInventoryCsv(st)}
                      onBulkAssignBranch={handleBulkAssignBranch}
                      onReturnToAdminStock={handleReturnToAdminStock}
                      onRequestReturnToAdminStock={handleRequestReturnToAdminStock}
                      onRemoveFromDashboard={handleRemoveFromDashboard}
                      onDeletePermanently={handleDeletePermanently}
                      onRestoreToDashboard={handleRestoreToDashboard}
                      onChangeBattery={(sn) => {
                        const target = deviceBySerialMap.get(sn);
                        if (target) setBatteryModalDevice(target);
                      }}
                      customFields={appSettings.customFields}
                      syncingSerials={syncingSerials}
                      fulfillingRequisition={fulfillingRequisition}
                      onConfirmFulfillment={handleConfirmFulfillment}
                      onCancelFulfillment={handleCancelFulfillment}
                      serverTotalDevices={serverStageSummary ? serverStageSummary.all : serverDeviceTotal}
                      serverArchivedCount={serverStageSummary ? serverStageSummary.archived : null}
                      serverStageCounts={
                        serverStageSummary
                          ? {
                              HQ_STOCK: serverStageSummary.hq,
                              BRANCH_RESERVE: serverStageSummary.reserve,
                              CONFIGURING: serverStageSummary.config,
                              COMPLETE: serverStageSummary.complete,
                              FAULTY: serverStageSummary.faulty,
                              LOST: serverStageSummary.lost,
                            }
                          : undefined
                      }
                      onFetchServerPage={handleFetchInventoryPage}
                      onNotifyConfigReady={handleNotifyConfigReady}
                    />
                  )}

                  {shownTab === 'branches' && (
                    <BranchesTab
                      branches={branches}
                      devices={devices}
                      users={users}
                      role={role}
                      theme={theme}
                      onSelectBranchFilter={(bCode) => {
                        setBranchFilter(bCode);
                        setActiveTab('inventory');
                      }}
                      onOpenNewBranchModal={() => {
                        setEditingBranch(null);
                        setBranchCodeInput('');
                        setBranchNameInput('');
                        setBranchStaffInput('');
                        setIsNewBranchModalOpen(true);
                      }}
                      onOpenEditBranchModal={(b) => {
                        setEditingBranch(b);
                        setBranchCodeInput(b.code);
                        setBranchNameInput(b.name);
                        setBranchStaffInput(b.staff.join(', '));
                        setIsNewBranchModalOpen(true);
                      }}
                      onSelectDevice={(sn) => setEditingDeviceSerial(sn)}
                    />
                  )}

                  {shownTab === 'audit_log' && (
                    <AuditLogTab
                      auditLogs={auditLogs}
                      role={role}
                      theme={theme}
                      onToast={(msg) => triggerToast(msg)}
                      loadServerLogs={isSupabaseConfigured ? loadServerAuditLogs : undefined}
                    />
                  )}

                  {(shownTab === 'users' || shownTab === 'iam') && isSupabaseConfigured && (
                    <StaffAccountsTab role={role} branches={branches} triggerToast={triggerToast} />
                  )}
                  {(shownTab === 'users' || shownTab === 'iam') && !isSupabaseConfigured && (
                    <IamUsersTab
                      users={users}
                      branches={branches}
                      role={role}
                      theme={theme}
                      onOpenUserModal={(u) => {
                        if (u) {
                          setEditingUser(u);
                          setUserEmpIdInput(u.empId);
                          setUserNameInput(u.name);
                          setUserTitleInput(u.position);
                          setUserBranchInput(u.branchId);
                          setUserRoleInput(u.accessRole);
                          setUserStatusInput(u.status);
                          setUserPasswordInput(u.password || '');
                        } else {
                          setEditingUser(null);
                          setUserEmpIdInput('');
                          setUserNameInput('');
                          setUserTitleInput('MS Officer');
                          setUserBranchInput('105');
                          setUserRoleInput('BRANCH');
                          setUserStatusInput('Operating');
                          setUserPasswordInput('');
                        }
                        setIsUserModalOpen(true);
                      }}
                      onUpdateStatus={(uid, st) => {
                        setUsers((prev) =>
                          prev.map((u) =>
                            u.uid === uid ? { ...u, status: st } : u
                          )
                        );
                        addAuditLog(
                          'IAM Status Updated',
                          `Updated user ${uid} status to ${st}`
                        );
                      }}
                      onDeleteUser={(uid) => {
                        setUsers((prev) => prev.filter((u) => u.uid !== uid));
                        addAuditLog(
                          'IAM Account Deleted',
                          `Deleted user account ${uid}`
                        );
                      }}
                      onBulkUpdateStatus={(uids, st) => {
                        setUsers((prev) =>
                          prev.map((u) =>
                            uids.includes(u.uid) ? { ...u, status: st } : u
                          )
                        );
                        addAuditLog(
                          'Bulk IAM Status',
                          `Bulk updated ${uids.length} users to ${st}`
                        );
                      }}
                      onBulkDeleteUsers={(uids) => {
                        setUsers((prev) =>
                          prev.filter((u) => !uids.includes(u.uid))
                        );
                        addAuditLog(
                          'Bulk IAM Delete',
                          `Bulk deleted ${uids.length} user accounts`
                        );
                      }}
                    />
                  )}

                  {shownTab === 'mobile_sync' && isSupabaseConfigured && (
                    <FieldReviewTab
                      role={role}
                      branches={branches}
                      devices={devices}
                      triggerToast={triggerToast}
                      onApplied={() => {
                        // the live feed brings the changed units and history; only the waiting count is asked for
                        countPendingFieldEvents().then((n) => n !== null && setPendingFieldCount(n));
                      }}
                      onOpenWorkflow={(sn) => setEditingDeviceSerial(sn)}
                      scope={appSettings.phoneReviewScope || 'PHNOM_PENH'}
                      onPendingCountChange={(n) => setPendingFieldCount(n)}
                    />
                  )}
                  {shownTab === 'mobile_sync' && !isSupabaseConfigured && (
                    <MobileSyncTab
                      devices={devices}
                      branches={branches}
                      activeBranchId={selectedBranch}
                      activeStaff={selectedStaffUser}
                      webhookEvents={webhookEvents}
                      sseConnected={sseConnected}
                      onTriggerMobileSync={handleTriggerMobileSync}
                      onReconcileWebhookEvents={handleReconcileWebhookEvents}
                      onReplaceDevice={handleReplaceDevice}
                      onOpenWorkflow={(sn) => setEditingDeviceSerial(sn)}
                      theme={theme}
                    />
                  )}

                  {shownTab === 'brand_logo' && (
                    <LogoPageTab
                      appSettings={appSettings}
                      onUpdateAppSettings={setAppSettings}
                      triggerToast={triggerToast}
                      addAuditLog={addAuditLog}
                      theme={theme}
                    />
                  )}

                  {shownTab === 'settings' && role === 'SUPER_ADMIN' && (
                    <SettingsTab
                      settings={appSettings}
                      onUpdateSettings={(newSettings) => {
                        setAppSettings(newSettings);
                        addAuditLog(
                          'System Settings Updated',
                          'Super Admin updated operational policies, prefix rules and hardware timeouts'
                        );
                        triggerToast('System settings and policy configuration saved.');
                      }}
                      role={role}
                      theme={theme}
                      onToast={(msg) => triggerToast(msg)}
                      onExportBackup={handleExportBackup}
                      onImportBackup={handleImportBackup}
                      onResetData={() => {
                        // (22 Oct 2026) with the shared database this clears only this browser's saved settings; the
                        // stock, requests and history on the server are not touched
                        if (isSupabaseConfigured) { clearLocalCaches(); try { localStorage.removeItem(STORAGE_KEY_SETTINGS); } catch {} }
                        else localStorage.clear();
                        window.location.reload();
                      }}
                      sharedDatabase={isSupabaseConfigured}
                      initialSubTab={settingsSubTab}
                      onSubTabChange={(st) => setSettingsSubTab(st)}
                      branches={branches}
                      devices={devices}
                      users={users}
                      onSelectBranchFilter={(bCode) => {
                        setBranchFilter(bCode);
                        setActiveTab('inventory');
                      }}
                      onOpenNewBranchModal={() => {
                        setEditingBranch(null);
                        setBranchCodeInput('');
                        setBranchNameInput('');
                        setBranchStaffInput('');
                        setIsNewBranchModalOpen(true);
                      }}
                      onOpenEditBranchModal={(b) => {
                        setEditingBranch(b);
                        setBranchCodeInput(b.code);
                        setBranchNameInput(b.name);
                        setBranchStaffInput(b.staff.join(', '));
                        setIsNewBranchModalOpen(true);
                      }}
                      onSelectDevice={(sn) => setEditingDeviceSerial(sn)}
                      addAuditLog={addAuditLog}
                      onUpdateAppSettings={setAppSettings}
                    />
                  )}

                  {shownTab === 'settings' && role !== 'SUPER_ADMIN' && (
                    <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm max-w-lg mx-auto my-12">
                      <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mx-auto mb-3">
                        <Lock className="w-6 h-6" />
                      </div>
                      <h2 className="text-base font-extrabold text-slate-800 dark:text-white">
                        Access Restricted
                      </h2>
                      <p className="text-xs text-slate-500 mt-1">
                        System configuration and security settings are restricted to Super Admin role only.
                      </p>
                      <button
                        type="button"
                        onClick={() => setActiveTab('dashboard')}
                        className="mt-4 px-4 py-2 rounded-xl bg-[#003857] text-white text-xs font-bold hover:bg-[#002a42] transition cursor-pointer"
                      >
                        Return to Dashboard
                      </button>
                    </div>
                  )}
                  </Suspense>
                  </ErrorBoundary>
              </motion.div>
            </main>
          </div>

          {/* Mandatory Copyright Footer at Bottom */}
          <footer className="mx-4 sm:mx-6 mt-8 pt-5 pb-4 border-t border-slate-200/90 text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
            <div className="text-[11px] font-mono text-slate-500">
              Copyright © POS &amp; Sound Box Stock Management System 2026
            </div>
            <div className="flex items-center gap-4 text-[11px] font-mono">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {branches.length} Branch Codes Connected
              </span>
              {!isSupabaseConfigured && (
                <>
                  <span>·</span>
                  <span className="text-slate-600 font-bold">Local preview (not shared)</span>
                </>
              )}
            </div>
          </footer>
        </div>

      {/* Modals */}
        {/* Classic Batch Upload & Stock Intake Modal */}
        <BatchUploadModal
          isOpen={isBatchModalOpen}
          onClose={() => setIsBatchModalOpen(false)}
          branches={branches}
          existingDevices={devices}
          onCommitBatch={handleCommitBatch}
          activeBranchId={selectedBranch}
          theme={theme}
          operatorLabel={operatorLabel}
        />

        {/* Classic Request Stock Modal (Triggers Alert Notification) */}
        <RequestStockModal
          isOpen={isReqModalOpen}
          onClose={() => setIsReqModalOpen(false)}
          branches={branches}
          activeBranchId={selectedBranch}
          onSubmitRequest={handleSubmitStockRequest}
          theme={theme}
          role={role}
          operatorLabel={operatorLabel}
        />

        {traceQuery && (
          <TraceModal
            query={traceQuery}
            devices={scopedDevices}
            history={historicalMerchants}
            requisitions={requisitions}
            isAdmin={role === 'SUPER_ADMIN' || role === 'ADMIN'}
            onOpenDevice={(sn) => setEditingDeviceSerial(sn)}
            onClose={() => setTraceQuery('')}
          />
        )}

        {/* Session Lock Modal */}
        <SessionLockModal
          isOpen={isSessionLocked}
          onUnlock={() => {
            setIsSessionLocked(false);
            addAuditLog('Session Security Unlock', 'Workstation unlocked successfully via operator security PIN');
            triggerToast('Workstation unlocked. Welcome back.');
          }}
          operatorName={
            role === 'BRANCH' ? selectedStaffUser : activeAdminStaff
          }
          operatorRole={role}
          theme={theme}
        />

        {/* Workflow & Serial Cycle History Modal */}
        <WorkflowModal
          device={editingDevice}
          devices={devices}
          branches={branches}
          role={role}
          theme={theme}
          onClose={() => { setEditingDeviceSerial(null); setWorkflowPreset(''); }}
          preset={workflowPreset}
          onSave={(sn, u) => { setWorkflowPreset(''); handleSaveWorkflow(sn, u); }}
          onDeletePermanently={(sn) => handleDeletePermanently([sn])}
          onReturnToAdminStock={(sn, reason) =>
            handleReturnToAdminStock([sn], reason)
          }
          onRequestReturnToAdminStock={(sn, reason) =>
            handleRequestReturnToAdminStock([sn], reason)
          }
          onReturnToBranchReserve={(sn, branchId, reason) =>
            handleReturnToBranchReserve([sn], branchId, reason)
          }
          onRemoveFromDashboard={(sn, reason) =>
            handleRemoveFromDashboard([sn], reason)
          }
          onChangeBattery={(dev) => setBatteryModalDevice(dev)}
          customFields={appSettings.customFields}
          onRenameSerial={handleRenameSerial}
          onNotifyConfigReady={handleNotifyConfigReady}
          operatorLabel={operatorLabel}
        />

        {/* POS Terminal Change Battery Modal (24-Month Lifespan Replacement) */}
        <ChangeBatteryModal
          device={batteryModalDevice}
          onClose={() => setBatteryModalDevice(null)}
          onConfirm={handleConfirmChangeBattery}
          theme={theme}
        />

        {/* Export Data Modal */}
        <ExportDataModal
          isOpen={isExportModalOpen}
          onClose={() => setIsExportModalOpen(false)}
          devices={devices}
          requisitions={requisitions}
          users={users}
          auditLogs={auditLogs}
          theme={theme}
          onToast={(msg) => triggerToast(msg)}
          role={role}
        />

      {/* Branch Code Create/Edit Modal */}
      {isNewBranchModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border-0 p-6 shadow-2xl bg-white text-slate-900">
            <h3 className="text-base font-black mb-4 text-[#002f49]">
              {editingBranch
                ? `Edit Branch Code ${editingBranch.code}`
                : 'Add New Branch Code'}
            </h3>
            <form onSubmit={handleSaveBranch} className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                  Branch Code
                </label>
                <input
                  type="text"
                  required
                  disabled={Boolean(editingBranch)}
                  value={branchCodeInput}
                  onChange={(e) => setBranchCodeInput(e.target.value)}
                  placeholder="e.g. 505"
                  className="w-full px-3 py-2 rounded-xl text-xs font-mono border disabled:opacity-60 bg-slate-50 border-slate-200 text-slate-900"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                  Branch Name
                </label>
                <input
                  type="text"
                  required
                  value={branchNameInput}
                  onChange={(e) => setBranchNameInput(e.target.value)}
                  placeholder="Branch Name"
                  className="w-full px-3 py-2 rounded-xl text-xs border bg-slate-50 border-slate-200 text-slate-900"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                  Assigned Staff (Comma Separated)
                </label>
                <input
                  type="text"
                  value={branchStaffInput}
                  onChange={(e) => setBranchStaffInput(e.target.value)}
                  placeholder="e.g. SOK Dara (27811), NI Oudomroth (10811)"
                  className="w-full px-3 py-2 rounded-xl text-xs border bg-slate-50 border-slate-200 text-slate-900"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsNewBranchModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-300 text-slate-700 cursor-pointer hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#003857] hover:bg-[#002a42] text-white text-xs font-extrabold cursor-pointer transition shadow-xs"
                >
                  Save Branch Code
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* User Account Modal */}
      {isUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border-0 p-6 shadow-2xl bg-white text-slate-900">
            <h3 className="text-base font-black mb-4 text-slate-900">
              {editingUser ? 'Update IAM Account & Role' : 'Create IAM Account'}
            </h3>
            <form onSubmit={handleSaveUser} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                    Employee ID
                  </label>
                  <input
                    type="text"
                    required
                    value={userEmpIdInput}
                    onChange={(e) => setUserEmpIdInput(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-xs font-mono border bg-slate-50 border-slate-200 text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                    System Role
                  </label>
                  <select
                    value={userRoleInput}
                    onChange={(e) =>
                      setUserRoleInput(e.target.value as UserRole)
                    }
                    className="w-full px-3 py-2 rounded-xl text-xs font-bold border bg-slate-50 border-slate-200 text-slate-900"
                  >
                    <option value="SUPER_ADMIN">SUPER ADMIN</option>
                    <option value="ADMIN">ADMIN HQ</option>
                    <option value="BRANCH">BRANCH STAFF</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={userNameInput}
                  onChange={(e) => setUserNameInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs border bg-slate-50 border-slate-200 text-slate-900"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                    Branch Code &amp; Name
                  </label>
                  <select
                    value={userBranchInput}
                    onChange={(e) => setUserBranchInput(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-xs font-bold border bg-slate-50 border-slate-200 text-slate-900"
                  >
                    {branches.map((b) => (
                      <option key={b.code} value={b.code}>
                        Branch Code {b.code} — {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                    Status
                  </label>
                  <select
                    value={userStatusInput}
                    onChange={(e) =>
                      setUserStatusInput(e.target.value as UserStatus)
                    }
                    className="w-full px-3 py-2 rounded-xl text-xs font-bold border bg-slate-50 border-slate-200 text-slate-900"
                  >
                    <option value="Operating">Operating</option>
                    <option value="Pending">Pending</option>
                    <option value="Suspended">Suspended</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                  Workstation Password {editingUser ? '(Leave blank to retain current)' : ''}
                </label>
                <input
                  type="text"
                  value={userPasswordInput}
                  onChange={(e) => setUserPasswordInput(e.target.value)}
                  placeholder={editingUser ? 'Enter new password or leave blank' : 'Defaults to Staff ID if left blank'}
                  className="w-full px-3 py-2 rounded-xl text-xs font-mono font-bold border bg-slate-50 border-slate-200 text-slate-900"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Defaults to the same Staff ID if left blank. Can be customized by Super Admin.
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsUserModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-300 text-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#003857] hover:bg-[#002a42] text-white text-xs font-extrabold cursor-pointer transition shadow-xs"
                >
                  Save Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

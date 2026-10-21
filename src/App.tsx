import React, { useState, useMemo, useEffect, useCallback, useDeferredValue } from 'react';
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
  deriveBatterySerial,
  STAGE_META,
} from './data/initialData';
import {
  INITIAL_HISTORICAL_MERCHANTS,
  DEFAULT_APP_SETTINGS,
} from './data/historicalMerchantsData';
import { escapeCsvCell } from './utils/crmUtils';
import { Header, Sidebar } from './components/Header';
import { PipelineBar } from './components/PipelineBar';
import { KpiCards } from './components/KpiCards';
import { DashboardTab } from './components/DashboardTab';
import { InventoryTab } from './components/InventoryTab';
import { BranchesTab } from './components/BranchesTab';
import { IamUsersTab } from './components/IamUsersTab';
import { MerchantsCrmTab } from './components/MerchantsCrmTab';
import { MerchantHistoryTab } from './components/MerchantHistoryTab';
import { RequisitionsTab } from './components/RequisitionsTab';
import { WorkflowModal } from './components/WorkflowModal';
import { ChangeBatteryModal } from './components/ChangeBatteryModal';
import { ExportDataModal } from './components/ExportDataModal';
import { BatchUploadModal } from './components/BatchUploadModal';
import { RequestStockModal } from './components/RequestStockModal';
import { SessionLockModal } from './components/SessionLockModal';
import { MobileSyncTab } from './components/MobileSyncTab';
import { SettingsTab, SettingsSubTab } from './components/SettingsTab';
import { LogoPageTab } from './components/LogoPageTab';
import { AuditLogTab } from './components/AuditLogTab';
import { SignInPage } from './components/SignInPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { motion, AnimatePresence } from 'motion/react';
import { SendHorizontal, Lock } from 'lucide-react';
import { isSupabaseConfigured, checkSupabaseConnection } from './lib/supabase';
import {
  fetchDevicesFromSupabase,
  upsertDeviceToSupabase,
  bulkUpsertDevicesToSupabase,
  bulkUpsertBranchesToSupabase,
  fetchRequisitionsFromSupabase,
  upsertRequisitionToSupabase,
  subscribeToRealtimeChanges,
} from './services/supabaseService';
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
        // Banking Security Hardening: Only whitelisted Super Admin staff can possess SUPER_ADMIN role
        if (parsed.role === 'SUPER_ADMIN') {
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

const INITIAL_NOTIFICATIONS: SystemNotification[] = [];

export function App() {
  // Always use Light Mode (Single theme as before)
  const theme: ThemeMode = 'light';

  useEffect(() => {
    try {
      localStorage.removeItem('pos_apple_glass_theme');
    } catch {}
    document.documentElement.removeAttribute('data-apple-theme');
    document.documentElement.classList.remove('dark');
  }, []);

  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return Boolean(getInitialAuthSession());
  });
  const [isSessionLocked, setIsSessionLocked] = useState<boolean>(false);
  const [authUsername, setAuthUsername] = useState<string>(() => {
    return getInitialAuthSession()?.operatorLabel || '';
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
    try {
      const saved = localStorage.getItem(STORAGE_KEY_REQS);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return createInitialRequisitions();
  });

  const [auditLogs, setAuditLogs] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_LOGS);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return [
      '2026-10-21 08:00:00 | System Initialized | Immutable security audit ledger verified across all 34 Branch Codes',
    ];
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

  const [supabaseConnected, setSupabaseConnected] = useState<boolean>(false);
  const [supabaseLatency, setSupabaseLatency] = useState<number | undefined>();

  // Supabase Cloud Realtime & Initial Data Hydration
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    async function initSupabase() {
      if (!isSupabaseConfigured) return;

      const conn = await checkSupabaseConnection();
      setSupabaseConnected(conn.connected);
      if (conn.latencyMs !== undefined) {
        setSupabaseLatency(conn.latencyMs);
      }

      if (conn.connected) {
        // 0. Ensure all branches exist in Supabase first
        if (branches.length > 0) {
          await bulkUpsertBranchesToSupabase(branches);
        }

        // 1. Fetch remote devices from Supabase & merge
        const remoteDevices = await fetchDevicesFromSupabase();
        if (remoteDevices && remoteDevices.length > 0) {
          setDevices((prev) => {
            const map = new Map<string, Device>();
            prev.forEach((d) => map.set(d.serial, d));
            remoteDevices.forEach((d) => map.set(d.serial, d));
            return Array.from(map.values());
          });
        } else if (remoteDevices && remoteDevices.length === 0 && devices.length > 0) {
          bulkUpsertDevicesToSupabase(devices).catch((err) =>
            console.warn('[Supabase Seed Devices Error]', err)
          );
        }

        // 2. Fetch remote requisitions from Supabase & merge
        const remoteReqs = await fetchRequisitionsFromSupabase();
        if (remoteReqs && remoteReqs.length > 0) {
          setRequisitions((prev) => {
            const map = new Map<string, Requisition>();
            prev.forEach((r) => map.set(r.reqId, r));
            remoteReqs.forEach((r) => map.set(r.reqId, r));
            return Array.from(map.values());
          });
        } else if (remoteReqs && remoteReqs.length === 0 && requisitions.length > 0) {
          requisitions.forEach((r) => {
            upsertRequisitionToSupabase(r).catch((err) =>
              console.warn('[Supabase Seed Requisition Error]', err)
            );
          });
        }

        // 3. Attach Postgres CDC WebSocket Realtime listener
        unsubscribe = subscribeToRealtimeChanges(
          (updatedDevice) => {
            setDevices((prev) => {
              const idx = prev.findIndex((d) => d.serial === updatedDevice.serial);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = updatedDevice;
                return next;
              }
              return [updatedDevice, ...prev];
            });
          },
          (updatedReq) => {
            setRequisitions((prev) => {
              const idx = prev.findIndex((r) => r.reqId === updatedReq.reqId);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = updatedReq;
                return next;
              }
              return [updatedReq, ...prev];
            });
          }
        );
      }
    }

    initSupabase();

    return () => {
      unsubscribe?.();
    };
  }, []);

  // High-Volume Device Hydration from IndexedDB (supports up to 500,000+ rows)
  useEffect(() => {
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
    try {
      localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(users));
    } catch (e) {
      console.error(e);
    }
  }, [users]);

  useEffect(() => {
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
    return getInitialAuthSession()?.role || 'BRANCH';
  });
  const [selectedBranch, setSelectedBranch] = useState<string>(() => {
    return getInitialAuthSession()?.branchId || '105';
  });
  const [selectedStaffUser, setSelectedStaffUser] = useState<string>(() => {
    const session = getInitialAuthSession();
    if (session && session.role === 'BRANCH') {
      return session.operatorLabel;
    }
    return 'NI Oudomroth (10811)';
  });
  const [activeAdminStaff, setActiveAdminStaff] = useState<string>(() => {
    const session = getInitialAuthSession();
    if (session && session.role !== 'BRANCH') {
      return session.operatorLabel;
    }
    return 'SAY Chanmakara (8986)';
  });
  const [activeTab, setActiveTab] = useState<string>('dashboard');
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
      setActiveTab('dashboard');
    } else if (activeTab === 'brand_logo') {
      setSettingsSubTab('brand_logo');
      setActiveTab('settings');
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
        id: `NOTIF-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title,
        message,
        category,
        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
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

  const addAuditLog = useCallback(
    (actionTitle: string, detailText: string, customRole?: UserRole) => {
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
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
    },
    [role, authUsername, activeAdminStaff, selectedBranch, selectedStaffUser]
  );

  const handleExportBackup = useCallback(() => {
    const backupData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      devices,
      branches,
      requisitions,
      users,
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
    a.download = `pos-soundbox-inventory-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    triggerToast('Complete system JSON backup downloaded.');
    addAuditLog('Backup Exported', 'Full system state snapshot exported to JSON');
  }, [devices, branches, requisitions, users, appSettings, auditLogs, historicalMerchants, triggerToast, addAuditLog]);

  const handleImportBackup = useCallback((jsonStr: string) => {
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
    setRole(newRole);
    if (newRole === 'BRANCH') {
      setBranchFilter(selectedBranch);
    } else {
      setBranchFilter('ALL');
    }
  };

  const handleBranchChange = (bCode: string) => {
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

  const pipelineCounts = useMemo(() => {
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
  }, [scopedDevices]);

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
          (d.merchantPhone && d.merchantPhone.toLowerCase().includes(q)) ||
          (d.address && d.address.toLowerCase().includes(q)) ||
          (d.customFields && Object.values(d.customFields).some((val) => (val || '').toLowerCase().includes(q)));

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
  const [optimisticSyncState, setOptimisticSyncState] = useState<{
    isSyncing: boolean;
    pendingCount: number;
    lastActionText: string;
    lastSyncedTime: string | null;
  }>({
    isSyncing: false,
    pendingCount: 0,
    lastActionText: '',
    lastSyncedTime: null,
  });

  const devicesRef = React.useRef(devices);
  useEffect(() => {
    devicesRef.current = devices;
  }, [devices]);

  const triggerOptimisticSync = useCallback((serials: string[], actionText: string, syncPayload?: Device[]) => {
    // 1. Immediately mark serials for instant row highlight
    setSyncingSerials((prev) => {
      const next = new Set(prev);
      serials.forEach((sn) => next.add(sn));
      return next;
    });

    // 2. Set background syncing state (instant UI perception, non-blocking)
    setOptimisticSyncState((prev) => ({
      isSyncing: true,
      pendingCount: prev.pendingCount + serials.length,
      lastActionText: actionText,
      lastSyncedTime: prev.lastSyncedTime,
    }));

    // 3. Fire-and-forget background push to Supabase if configured
    if (isSupabaseConfigured) {
      const itemsToSync = syncPayload || devicesRef.current.filter((d) => serials.includes(d.serial));
      if (itemsToSync.length > 0) {
        bulkUpsertDevicesToSupabase(itemsToSync).catch((err) => {
          console.warn('[Supabase Sync Error]', err);
        });
      }
    }

    // 4. Asynchronous background cloud persistence queue (simulating Supabase/REST commit without blocking user thread)
    setTimeout(() => {
      setOptimisticSyncState((prev) => {
        const nextCount = Math.max(0, prev.pendingCount - serials.length);
        return {
          isSyncing: nextCount > 0,
          pendingCount: nextCount,
          lastActionText: actionText,
          lastSyncedTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        };
      });

      // Clear row highlight gently after brief confirmation window
      setTimeout(() => {
        setSyncingSerials((prev) => {
          const next = new Set(prev);
          serials.forEach((sn) => next.delete(sn));
          return next;
        });
      }, 1400);
    }, 750);
  }, []);

  // Save single device workflow & append Serial Cycle History
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
    }
  ) => {
    const today = new Date().toISOString().split('T')[0];
    const nowTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const branchObj = branches.find((b) => b.code === updates.branchId);
    const actor =
      role === 'SUPER_ADMIN'
        ? `Super Admin (${authUsername})`
        : role === 'ADMIN'
        ? `Admin HQ (${activeAdminStaff})`
        : `${selectedStaffUser || 'Staff'} (Branch Code ${selectedBranch})`;

    setDevices((prev) =>
      prev.map((d) => {
        if (d.serial !== serial) return d;
        const stageLabel = STAGE_META[updates.stage].short;
        const nextCycleNum = (d.history || []).length + 1;
        const logNote =
          updates.note.trim() ||
          `Transitioned to ${stageLabel} at Branch Code ${updates.branchId}${
            updates.merchantName ? ` for ${updates.merchantName}` : ''
          } (Install Date: ${updates.deployedDate || today}) — Officer: ${actor}`;

        const hadMerchant =
          Boolean(d.merchantName?.trim()) || d.stage === 'COMPLETE';
        const isReturnedFromMerchant =
          hadMerchant &&
          (updates.stage === 'BRANCH_RESERVE' ||
            updates.stage === 'HQ_STOCK' ||
            updates.stage === 'FAULTY' ||
            updates.stage === 'LOST' ||
            !updates.merchantName.trim());
        const isChangedMerchant =
          Boolean(d.merchantName?.trim()) &&
          Boolean(updates.merchantName.trim()) &&
          d.merchantName.trim().toLowerCase() !==
            updates.merchantName.trim().toLowerCase();

        const nextRedeployCount =
          isReturnedFromMerchant || isChangedMerchant
            ? (d.redeployCount || 0) + 1
            : d.redeployCount || 0;

        // Automatically archive to historical ledger when merchant returns or loses device
        if (hadMerchant && isReturnedFromMerchant && d.mid) {
          const histRec: HistoricalMerchantRecord = {
            recordId: `MREC-${Date.now().toString().slice(-6)}`,
            merchantName: d.merchantName || 'Merchant',
            merchantPhone: d.merchantPhone || '012 000 000',
            address: d.address || 'Phnom Penh, Cambodia',
            mid: d.mid,
            tid: d.tid || `TID-${d.branchId}01`,
            deviceType: d.type,
            model: d.model,
            serial: d.serial,
            batterySerial: d.batterySerial,
            branchId: d.branchId,
            branchName: d.branchName,
            installedDate: d.deployedDate || d.stockInDate || today,
            returnedDate: today,
            activeDurationMonths: 6,
            returnReason:
              updates.note ||
              (updates.stage === 'LOST'
                ? 'Device Lost / Missing from Merchant'
                : 'Merchant Terminated Contract — Returned Hardware'),
            status: updates.stage === 'LOST' ? 'TERMINATED' : 'TERMINATED',
            handledByStaff: updates.staff || actor,
            installedByStaff: d.installedByStaff || d.staff || actor,
            replacedByStaff: d.replacedByStaff,
            returnedByStaff: updates.staff || actor,
            settlementFinalized: true,
            notes:
              updates.stage === 'LOST'
                ? 'Marked as Device Lost in system inventory.'
                : `Device returned to ${
                    updates.stage === 'HQ_STOCK' ? 'Admin HQ Stock' : 'Branch Reserve'
                  }.`,
          };
          setHistoricalMerchants((hPrev) => [histRec, ...hPrev]);
        }

        // When returned/terminated, ensure merchant info is cleared and stage is active stock
        const effectiveStage: LifecycleStage =
          updates.stage === 'FAULTY'
            ? updates.branchId === '100'
              ? 'HQ_STOCK'
              : 'BRANCH_RESERVE'
            : updates.stage;
        const effectiveMerchantName = isReturnedFromMerchant ? '' : updates.merchantName;
        const effectiveMid = isReturnedFromMerchant ? '' : updates.mid;
        const effectiveTid = isReturnedFromMerchant ? '' : updates.tid;

        return {
          ...d,
          stage: effectiveStage,
          branchId: updates.branchId,
          branchName: branchObj?.name || d.branchName,
          staff: updates.staff,
          installedByStaff: d.installedByStaff || (updates.stage === 'COMPLETE' ? (updates.staff || actor) : undefined),
          replacedByStaff: isReturnedFromMerchant ? undefined : d.replacedByStaff,
          returnedByStaff: isReturnedFromMerchant ? (updates.staff || actor) : (updates.stage === 'COMPLETE' ? undefined : d.returnedByStaff),
          returnedDate: isReturnedFromMerchant ? today : (updates.stage === 'COMPLETE' ? undefined : d.returnedDate),
          merchantName: effectiveMerchantName,
          merchantPhone:
            updates.merchantPhone !== undefined
              ? updates.merchantPhone
              : isReturnedFromMerchant
              ? ''
              : d.merchantPhone,
          location:
            updates.location !== undefined
              ? updates.location
              : isReturnedFromMerchant
              ? ''
              : d.location,
          address: updates.address !== undefined ? updates.address : isReturnedFromMerchant ? '' : d.address,
          customFields: {
            ...(d.customFields || {}),
            ...(updates.customFields || {}),
          },
          mid: effectiveMid,
          tid: effectiveTid,
          deployedDate: updates.deployedDate || d.deployedDate || today,
          batteryInstalledDate: updates.batteryInstalledDate,
          redeployCount: nextRedeployCount,
          updatedAt: today,
          archived: false,
          history: [
            `${nowTime} | Cycle #${nextCycleNum}: ${stageLabel} | ${logNote}`,
            ...(d.history || []),
          ],
        };
      })
    );

    addAuditLog(
      'Serial Cycle Updated',
      `Updated serial ${serial} -> ${STAGE_META[updates.stage].short} (Branch Code ${
        updates.branchId
      }, Install Date: ${updates.deployedDate || today})`
    );
    if (role === 'SUPER_ADMIN' || role === 'ADMIN') {
      addNotification(
        `Assigned from Admin • ${serial} (Code ${updates.branchId})`,
        `${actor} assigned ${serial} (${STAGE_META[updates.stage].short}) to Branch Code ${
          updates.branchId
        } (${branchObj?.name || ''}) — Staff: ${updates.staff}.`,
        'STOCK',
        updates.branchId,
        'inventory'
      );
    }
    setEditingDeviceSerial(null);
    triggerOptimisticSync(
      [serial],
      `Updated ${serial} -> ${STAGE_META[updates.stage].short} (${branchObj?.name || 'Code ' + updates.branchId})`
    );
    triggerToast(`Serial ${serial} cycle committed (${STAGE_META[updates.stage].short})`);
  };

  // Dedicated POS Terminal Battery Replacement
  const handleConfirmChangeBattery = (
    serial: string,
    newBatterySerial: string,
    installedDate: string,
    reason: string
  ) => {
    const today = installedDate || new Date().toISOString().split('T')[0];
    const nowTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const actor =
      role === 'SUPER_ADMIN'
        ? `Super Admin (${authUsername})`
        : role === 'ADMIN'
        ? `Admin HQ (${activeAdminStaff})`
        : `${selectedStaffUser || 'Staff'} (Branch Code ${selectedBranch})`;

    setDevices((prev) =>
      prev.map((d) => {
        if (d.serial !== serial) return d;
        const oldBatt = d.batterySerial || '160525A0005709';
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
    const today = new Date().toISOString().split('T')[0];
    const nowTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const branchObj = branches.find((b) => b.code === targetBranchCode);
    const defaultStaff =
      branchObj && branchObj.staff.length > 0 ? branchObj.staff[0] : 'Branch Officer';
    const actor = role === 'SUPER_ADMIN' ? 'Super Admin' : 'Admin HQ';

    setDevices((prev) =>
      prev.map((d) => {
        if (!serials.includes(d.serial)) return d;
        const nextCycleNum = (d.history || []).length + 1;
        return {
          ...d,
          stage: 'BRANCH_RESERVE',
          branchId: targetBranchCode,
          branchName: branchObj?.name || `Branch Code ${targetBranchCode}`,
          staff: defaultStaff,
          updatedAt: today,
          archived: false,
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

  // Return Back to Admin HQ Stock (Branch Code 100 / HQ_STOCK)
  const handleReturnToAdminStock = (serials: string[], reason?: string) => {
    const today = new Date().toISOString().split('T')[0];
    const nowTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const actor =
      role === 'SUPER_ADMIN'
        ? 'Super Admin'
        : role === 'ADMIN'
        ? 'Admin HQ'
        : `Branch Code ${selectedBranch}`;

    const retiringDevices = devices.filter(
      (d) => serials.includes(d.serial) && d.mid && d.merchantName
    );
    if (retiringDevices.length > 0) {
      const records: HistoricalMerchantRecord[] = retiringDevices.map((d, idx) => ({
        recordId: `MREC-${Date.now().toString().slice(-6)}-${idx}`,
        merchantName: d.merchantName || 'Merchant',
        merchantPhone: d.merchantPhone || '012 000 000',
        address: d.address || 'Phnom Penh, Cambodia',
        mid: d.mid,
        tid: d.tid || `TID-${d.branchId}01`,
        deviceType: d.type,
        model: d.model,
        serial: d.serial,
        batterySerial: d.batterySerial,
        branchId: d.branchId,
        branchName: d.branchName,
        installedDate: d.deployedDate || d.stockInDate || today,
        returnedDate: today,
        activeDurationMonths: 6,
        returnReason: reason || 'Returned back to Admin HQ Stock (Branch Code 100)',
        status: 'RETURNED',
        handledByStaff: actor,
        installedByStaff: d.installedByStaff || d.staff || actor,
        replacedByStaff: d.replacedByStaff,
        returnedByStaff: actor,
        settlementFinalized: true,
        notes: `Returned to Admin HQ Stock. ${reason || ''}`.trim(),
      }));
      setHistoricalMerchants((prev) => [...records, ...prev]);
    }

    setDevices((prev) =>
      prev.map((d) => {
        if (!serials.includes(d.serial)) return d;
        const nextCycleNum = (d.history || []).length + 1;
        const wasAtMerchant =
          Boolean(d.merchantName?.trim()) ||
          d.stage === 'COMPLETE' ||
          d.stage === 'FAULTY';
        return {
          ...d,
          stage: 'HQ_STOCK',
          branchId: '100',
          branchName: 'Head Office (In-Store MS Unit)',
          staff: 'SAY Chanmakara (8986)',
          merchantName: '',
          mid: '',
          tid: '',
          returnedByStaff: actor,
          returnedDate: today,
          updatedAt: today,
          redeployCount: wasAtMerchant
            ? (d.redeployCount || 0) + 1
            : d.redeployCount || 0,
          archived: false,
          history: [
            `${nowTime} | Cycle #${nextCycleNum}: Return to Admin HQ Stock | ${
              reason || 'Returned back to Admin HQ Stock (Branch Code 100)'
            } — Officer: ${actor}`,
            ...(d.history || []),
          ],
        };
      })
    );

    addAuditLog(
      'Return to Admin Stock',
      `Returned ${serials.length} serial(s) (${serials.join(', ')}) back to Admin HQ Stock (Branch Code 100)`
    );
    addNotification(
      `Stock Returned to Admin HQ • ${serials.length} Unit(s)`,
      `${serials.join(', ')} returned to Central HQ Stock (Branch Code 100).`,
      'STOCK',
      '100',
      'inventory'
    );
    triggerOptimisticSync(serials, `Returned ${serials.length} unit(s) to Admin HQ Stock`);
    triggerToast(`Returned ${serials.length} unit(s) back to Admin HQ Stock`);
  };

  // Branch Staff Return Request: Submits a formal Stock Return Request to Admin HQ for approval
  const handleRequestReturnToAdminStock = (
    serials: string[],
    reason: string = 'Return to Admin HQ Stock requested by branch'
  ) => {
    if (!serials.length) return;
    const today = new Date().toISOString().split('T')[0];
    const nowTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const affected = devices.filter((d) => serials.includes(d.serial));
    const targetBranchId = affected[0]?.branchId || selectedBranch;
    const branchObj = branches.find((b) => b.code === targetBranchId || b.id === targetBranchId);
    const posCount = affected.filter((d) => d.type === 'POS Terminal').length;
    const sbCount = affected.filter((d) => d.type === 'Sound Box').length;
    const actor =
      selectedStaffUser ||
      (branchObj && branchObj.staff.length > 0 ? branchObj.staff[0] : 'Branch Staff');

    const newReq: Requisition = {
      reqId: `RET-${Date.now().toString().slice(-6)}`,
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
    if (isSupabaseConfigured) {
      upsertRequisitionToSupabase(newReq).catch((err) =>
        console.warn('[Supabase Return Requisition Error]', err)
      );
    }

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
    const today = new Date().toISOString().split('T')[0];
    const nowTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const actor =
      role === 'SUPER_ADMIN'
        ? 'Super Admin'
        : role === 'ADMIN'
        ? 'Admin HQ'
        : `Branch Code ${selectedBranch}`;

    const retiringDevices = devices.filter(
      (d) => serials.includes(d.serial) && d.mid && d.merchantName
    );
    if (retiringDevices.length > 0) {
      const records: HistoricalMerchantRecord[] = retiringDevices.map((d, idx) => ({
        recordId: `MREC-${Date.now().toString().slice(-6)}-${idx}`,
        merchantName: d.merchantName || 'Merchant',
        merchantPhone: d.merchantPhone || '012 000 000',
        address: d.address || 'Phnom Penh, Cambodia',
        mid: d.mid,
        tid: d.tid || `TID-${d.branchId}01`,
        deviceType: d.type,
        model: d.model,
        serial: d.serial,
        batterySerial: d.batterySerial,
        branchId: d.branchId,
        branchName: d.branchName,
        installedDate: d.deployedDate || d.stockInDate || today,
        returnedDate: today,
        activeDurationMonths: 6,
        returnReason: reason || `Returned back to Branch Code ${targetBranchId || d.branchId} Reserve`,
        status: 'RETURNED',
        handledByStaff: actor,
        installedByStaff: d.installedByStaff || d.staff || actor,
        replacedByStaff: d.replacedByStaff,
        returnedByStaff: actor,
        settlementFinalized: true,
        notes: `Returned to Branch Reserve. ${reason || ''}`.trim(),
      }));
      setHistoricalMerchants((prev) => [...records, ...prev]);
    }

    setDevices((prev) =>
      prev.map((d) => {
        if (!serials.includes(d.serial)) return d;
        const bId =
          targetBranchId ||
          (d.branchId && d.branchId !== '100' ? d.branchId : '105');
        const bObj =
          branches.find((b) => b.id === bId || b.code === bId) || branches[0];
        const nextCycleNum = (d.history || []).length + 1;
        const wasAtMerchant =
          Boolean(d.merchantName?.trim()) ||
          d.stage === 'COMPLETE' ||
          d.stage === 'FAULTY';

        return {
          ...d,
          stage: 'BRANCH_RESERVE',
          branchId: bId,
          branchName: bObj.name,
          staff: bObj.staff?.[0] || d.staff || 'Branch Officer',
          merchantName: '',
          mid: '',
          tid: '',
          merchantPhone: '',
          address: '',
          returnedByStaff: actor,
          returnedDate: today,
          updatedAt: today,
          redeployCount: wasAtMerchant
            ? (d.redeployCount || 0) + 1
            : d.redeployCount || 0,
          archived: false,
          history: [
            `${nowTime} | Cycle #${nextCycleNum}: Return to Branch Reserve | ${
              reason || `Returned back to Branch Code ${bId} Reserve`
            } — Officer: ${actor}`,
            ...(d.history || []),
          ],
        };
      })
    );

    addAuditLog(
      'Return to Branch Reserve',
      `Returned ${serials.length} serial(s) (${serials.join(', ')}) back to Branch Reserve`
    );
    triggerOptimisticSync(serials, `Returned ${serials.length} unit(s) to Branch Reserve`);
    triggerToast(`Returned ${serials.length} unit(s) back to Branch Reserve`);
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

  // Terminate Merchant & Return All Assigned Devices to Admin HQ Stock or Branch Reserve
  const handleTerminateMerchant = (
    mid: string,
    destination: 'HQ_STOCK' | 'BRANCH_RESERVE',
    reason: string = 'Merchant Terminated Contract',
    notes?: string
  ) => {
    const today = new Date().toISOString().split('T')[0];
    const nowTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const actor =
      role === 'SUPER_ADMIN'
        ? 'Super Admin'
        : role === 'ADMIN'
        ? 'Admin HQ'
        : (selectedStaffUser || 'Staff Officer');
    const affectedDevices = devices.filter((d) => d.mid === mid);
    const merchantName = affectedDevices[0]?.merchantName || 'Merchant';
    const branchId = affectedDevices[0]?.branchId || selectedBranch;

    // 1. Return all devices belonging to this merchant to chosen destination
    setDevices((prev) =>
      prev.map((d) => {
        if (d.mid !== mid) return d;
        const targetBranchId =
          destination === 'HQ_STOCK'
            ? '100'
            : d.branchId && d.branchId !== '100'
            ? d.branchId
            : branchId || '105';
        const bObj =
          branches.find(
            (b) => b.id === targetBranchId || b.code === targetBranchId
          ) || branches[0];
        const nextCycle = (d.history || []).length + 1;
        const destLabel =
          destination === 'HQ_STOCK'
            ? 'Admin HQ Stock (Branch Code 100)'
            : `Branch Reserve (${bObj.name})`;
        const logEntry = `${nowTime} | Cycle #${nextCycle}: Terminated Return | Returned from ${
          d.merchantName || 'merchant'
        } to ${destLabel} — Reason: ${reason}`;

        return {
          ...d,
          stage: destination,
          branchId: targetBranchId,
          branchName: bObj.name,
          staff:
            destination === 'HQ_STOCK'
              ? 'SAY Chanmakara (8986)'
              : bObj.staff?.[0] || d.staff,
          merchantName: '',
          mid: '',
          tid: '',
          merchantPhone: '',
          address: '',
          returnedByStaff: actor,
          returnedDate: today,
          returnReason: reason,
          redeployCount: (d.redeployCount || 0) + 1,
          updatedAt: today,
          note: `Returned to ${destLabel} after merchant termination (${reason})`,
          history: [logEntry, ...(d.history || [])],
        };
      })
    );

    // 2. Archive to historical merchants ledger
    if (affectedDevices.length > 0) {
      affectedDevices.forEach((dev, idx) => {
        const rec: HistoricalMerchantRecord = {
          recordId: `MREC-${Date.now().toString().slice(-6)}-${idx}`,
          merchantName: dev.merchantName || merchantName,
          merchantPhone: dev.merchantPhone || '012 000 000',
          address: dev.address || 'Phnom Penh, Cambodia',
          mid: dev.mid || mid,
          tid: dev.tid || `TID-${dev.branchId}01`,
          deviceType: dev.type,
          model: dev.model,
          serial: dev.serial,
          batterySerial: dev.batterySerial,
          branchId: dev.branchId,
          branchName: dev.branchName,
          installedDate: dev.deployedDate || dev.stockInDate || today,
          returnedDate: today,
          activeDurationMonths: 6,
          returnReason: reason,
          status: 'TERMINATED',
          handledByStaff: dev.staff || selectedStaffUser || 'Staff Officer',
          installedByStaff: dev.installedByStaff || dev.staff || selectedStaffUser || 'Staff Officer',
          replacedByStaff: dev.replacedByStaff,
          returnedByStaff: actor,
          settlementFinalized: true,
          notes:
            notes ||
            `Terminated and hardware returned to ${
              destination === 'HQ_STOCK'
                ? 'Admin HQ Stock'
                : 'Branch Reserve'
            }.`,
        };
        setHistoricalMerchants((prev) => [rec, ...prev]);
      });
    }

    addAuditLog(
      'Merchant Terminated',
      `Merchant ${merchantName} (${mid}) terminated. ${affectedDevices.length} device(s) returned to ${
        destination === 'HQ_STOCK'
          ? 'Admin HQ Stock (Code 100)'
          : `Branch Reserve (Code ${branchId})`
      }`
    );

    triggerToast(
      `Merchant ${merchantName} terminated. Hardware returned to ${
        destination === 'HQ_STOCK' ? 'Admin HQ Stock' : 'Branch Reserve'
      }.`
    );
  };

  // Remove from Dashboard (Archive) & Restore
  const handleRemoveFromDashboard = (serials: string[], reason?: string) => {
    const today = new Date().toISOString().split('T')[0];
    const nowTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const actor = role === 'SUPER_ADMIN' ? 'Super Admin' : 'Admin HQ';

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

  const handleRestoreToDashboard = (serials: string[]) => {
    const today = new Date().toISOString().split('T')[0];
    const nowTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
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

  // Batch Stock Upload Handler (from classic BatchUploadModal)
  const handleCommitBatch = (newBatchItems: Partial<Device>[]) => {
    const today = new Date().toISOString().split('T')[0];
    const nowTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const created: Device[] = newBatchItems.map((item, idx) => {
      const sn = (item.serial || `POS-A920-${Date.now()}-${idx}`).toUpperCase();
      const bCode = item.branchId || '100';
      const branchObj = branches.find((b) => b.code === bCode || b.id === bCode);
      const stg = item.stage || (bCode === '100' ? 'HQ_STOCK' : 'BRANCH_RESERVE');
      return {
        serial: sn,
        batterySerial: item.batterySerial || (item.type === 'Sound Box' ? `SB-BAT-${sn.replace(/^SB-/i, '')}` : `160525A${String(5709 + idx).padStart(7, '0')}`),
        batteryInstalledDate: item.batteryInstalledDate || item.stockInDate || today,
        type: item.type || 'POS Terminal',
        model: item.model || (item.type === 'Sound Box' ? 'SB-Pro' : 'Wizar POS Q2 Pro'),
        stockInDate: item.stockInDate || today,
        branchId: bCode,
        branchName: item.branchName || branchObj?.name || 'Head Office (In-Store MS Unit)',
        staff: item.staff || (branchObj?.staff?.[0] || 'Head Office Admin'),
        stage: stg,
        deploymentStatus: item.deploymentStatus || (stg === 'COMPLETE' ? 'Deployed (Active)' : 'In-Stock (Reserve)'),
        stockStatus: item.stockStatus || (stg === 'COMPLETE' ? 'Deployed' : 'In-Stock'),
        mid: item.mid || '',
        tid: item.tid || '',
        merchantName: item.merchantName || '',
        merchantPhone: item.merchantPhone || '',
        location: item.location || 'Phnom Penh',
        address: item.address || '',
        deployedDate: item.deployedDate || today,
        returnReason: item.returnReason || '',
        redeployCount: item.redeployCount !== undefined ? item.redeployCount : 0,
        hoursInStage: item.hoursInStage || 1,
        updatedAt: today,
        note: item.note || `Batch registered into Branch Code ${bCode}`,
        history: item.history || [
          `${nowTime} | Cycle #1: Batch Stock Intake | Registered into Branch Code ${bCode} (${
            branchObj?.name || 'HQ'
          }) — Officer: ${authUsername}`,
        ],
        archived: false,
      };
    });

    setDevices((prev) => [...created, ...prev]);
    triggerOptimisticSync(
      created.map((c) => c.serial),
      `Registered ${created.length} new serial(s) into inventory`,
      created
    );
    addAuditLog(
      'Batch Stock Intake',
      `Registered ${created.length} hardware serials into inventory`
    );
    const targetBranch = created[0]?.branchId || '100';
    addNotification(
      targetBranch !== '100'
        ? `Assigned from Admin • ${created.length} Serial(s) to Code ${targetBranch}`
        : `Batch Stock Intake • ${created.length} Serials Added`,
      `${authUsername} registered and assigned ${created.length} hardware serial(s) to Branch Code ${targetBranch}.`,
      'STOCK',
      targetBranch,
      'inventory'
    );
    triggerToast(`Registered ${created.length} new hardware serials!`);
  };

  // Every Request Must Alert Notification (from classic RequestStockModal)
  const handleSubmitStockRequest = (reqData: {
    branchId: string;
    staff: string;
    posQty: number;
    sbQty: number;
    reason: string;
  }) => {
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 16);
    const branchObj = branches.find((b) => b.code === reqData.branchId);
    const newReq: Requisition = {
      reqId: `REQ-2026-${String(106 + requisitions.length)}`,
      date: nowStr,
      branchId: reqData.branchId,
      branchName: branchObj?.name || `Branch Code ${reqData.branchId}`,
      staff: reqData.staff || 'Branch Officer',
      posQty: Number(reqData.posQty) || 0,
      sbQty: Number(reqData.sbQty) || 0,
      reason: reqData.reason,
      status: 'PENDING_ADMIN',
    };

    setRequisitions((prev) => [newReq, ...prev]);
    if (isSupabaseConfigured) {
      upsertRequisitionToSupabase(newReq).catch((err) =>
        console.warn('[Supabase Requisition Error]', err)
      );
    }
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

  // Approve & Receive Requisitions (for RequisitionsTab)
  const handleApproveRequisition = (
    reqId: string,
    arrangedDevices?: ArrangedDeviceItem[]
  ) => {
    const targetReq = requisitions.find((r) => r.reqId === reqId);
    if (!targetReq) return;

    const updatedReq: Requisition = { ...targetReq, status: 'DISPATCHED', arrangedDevices };
    setRequisitions((prev) =>
      prev.map((r) =>
        r.reqId === reqId ? updatedReq : r
      )
    );
    if (isSupabaseConfigured) {
      upsertRequisitionToSupabase(updatedReq).catch((err) =>
        console.warn('[Supabase Requisition Dispatch Error]', err)
      );
    }

    if (arrangedDevices && arrangedDevices.length > 0) {
      const today = new Date().toISOString().split('T')[0];
      const nowTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
      const branchObj = branches.find((b) => b.code === targetReq.branchId);
      const defaultStaff =
        branchObj && branchObj.staff.length > 0 ? branchObj.staff[0] : 'Branch Officer';
      const actor = role === 'SUPER_ADMIN' ? 'Super Admin' : 'Admin HQ';

      setDevices((prev) => {
        const existingMap = new Map(prev.map((d) => [d.serial.toUpperCase(), d]));
        const updatedList: Device[] = prev.map((d) => {
          const matchedArranged = arrangedDevices.find(
            (a) => a.serial.toUpperCase() === d.serial.toUpperCase()
          );
          if (!matchedArranged) return d;
          const nextCycleNum = (d.history || []).length + 1;
          return {
            ...d,
            stage: 'BRANCH_RESERVE',
            branchId: targetReq.branchId,
            branchName: branchObj?.name || `Branch Code ${targetReq.branchId}`,
            staff: defaultStaff,
            updatedAt: today,
            archived: false,
            batterySerial: matchedArranged.batterySerial || d.batterySerial,
            model: matchedArranged.model || d.model,
            history: [
              `${nowTime} | Cycle #${nextCycleNum}: HQ Stock Requisition Dispatch | Dispatched for ${targetReq.reqId} to Branch Code ${targetReq.branchId} (${branchObj?.name || ''}) — Officer: ${actor}`,
              ...(d.history || []),
            ],
          };
        });

        // Add any arranged devices that did not previously exist in devices
        arrangedDevices.forEach((item) => {
          if (!existingMap.has(item.serial.toUpperCase())) {
            updatedList.push({
              serial: item.serial,
              batterySerial: item.batterySerial,
              batteryInstalledDate: today,
              model: item.model,
              type: item.type,
              stockInDate: today,
              branchId: targetReq.branchId,
              branchName: branchObj?.name || `Branch Code ${targetReq.branchId}`,
              stage: 'BRANCH_RESERVE',
              staff: defaultStaff,
              deploymentStatus: 'In-Stock (Reserve)',
              stockStatus: 'In-Stock',
              mid: '',
              tid: '',
              merchantName: '',
              merchantPhone: '',
              location: 'Phnom Penh',
              address: '',
              deployedDate: '',
              returnReason: '',
              redeployCount: 0,
              hoursInStage: 0,
              updatedAt: today,
              note: `Dispatched from HQ for Requisition ${targetReq.reqId}`,
              history: [
                `${nowTime} | Cycle #1: HQ Stock Requisition Dispatch | Dispatched for ${targetReq.reqId} to Branch Code ${targetReq.branchId} (${branchObj?.name || ''}) — Officer: ${actor}`,
              ],
              archived: false,
            });
          }
        });

        return updatedList;
      });
    }

    addAuditLog(
      'Requisition Approved & Dispatched',
      `Approved ${reqId} for Branch Code ${targetReq.branchId}`
    );
    addNotification(
      `Assigned from Admin • ${reqId} Dispatched to Code ${targetReq.branchId}`,
      `Admin HQ arranged & assigned ${
        arrangedDevices?.length || targetReq.posQty + targetReq.sbQty
      } unit(s) for ${reqId} to Branch Staff at Branch Code ${targetReq.branchId} (${
        targetReq.branchName
      }).`,
      'STOCK',
      targetReq.branchId,
      'requisitions'
    );
    triggerToast(`Dispatched requisition ${reqId} to Branch Code ${targetReq.branchId}`);
    setFulfillingRequisition(null);
    setStagedFulfillmentItems(null);
  };

  const handleDirectToStockInventory = (
    req: Requisition,
    _currentStaged?: ArrangedDeviceItem[]
  ) => {
    setFulfillingRequisition(req);
    setStageFilter('HQ_STOCK');
    setBranchFilter('100');
    setActiveTab('inventory');
    triggerToast(
      `Directing to Stock Inventory: Select ${req.posQty} POS & ${req.sbQty} Sound Box for Requisition ${req.reqId}`
    );
  };

  const handleConfirmFulfillment = (selectedSerials: string[]) => {
    if (!fulfillingRequisition) return;
    const selectedDevices = devices.filter((d) => selectedSerials.includes(d.serial));
    const staged: ArrangedDeviceItem[] = selectedDevices.map((d, idx) => ({
      serial: d.serial,
      batterySerial:
        d.batterySerial || deriveBatterySerial(d.serial, d.type === 'POS Terminal', idx),
      type: d.type,
      model: d.model,
    }));

    // Pad remaining quotas if fewer than required were selected
    const posChosen = staged.filter((s) => s.type === 'POS Terminal').length;
    for (let i = posChosen; i < fulfillingRequisition.posQty; i++) {
      staged.push({
        serial: '',
        batterySerial: '',
        type: 'POS Terminal',
        model: 'Wizar POS Q2 Pro',
      });
    }
    const sbChosen = staged.filter((s) => s.type === 'Sound Box').length;
    for (let i = sbChosen; i < fulfillingRequisition.sbQty; i++) {
      staged.push({
        serial: '',
        batterySerial: '',
        type: 'Sound Box',
        model: 'Sound Box',
      });
    }

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
    let updated: Requisition | null = null;
    setRequisitions((prev) =>
      prev.map((r) => {
        if (r.reqId === reqId) {
          updated = { ...r, status: 'RECEIVED' };
          return updated;
        }
        return r;
      })
    );
    if (isSupabaseConfigured && updated) {
      upsertRequisitionToSupabase(updated).catch((err) =>
        console.warn('[Supabase Requisition Receive Error]', err)
      );
    }
    addAuditLog('Requisition Received', `Branch confirmed receipt of ${reqId}`);
    triggerToast(`Confirmed receipt of ${reqId}`);
  };

  // Approve & Finalize Return Requisition (Admin / Super Admin receives units into Admin HQ Stock)
  const handleApproveReturnRequisition = (
    reqId: string,
    returnSerials?: string[],
    reason?: string
  ) => {
    const targetReq = requisitions.find((r) => r.reqId === reqId);
    if (!targetReq) return;

    const serialsToReturn = returnSerials || targetReq.returnSerials || [];
    if (serialsToReturn.length > 0) {
      handleReturnToAdminStock(
        serialsToReturn,
        `Approved Return Request ${reqId}: ${reason || targetReq.reason}`
      );
    }

    const updatedReq: Requisition = { ...targetReq, status: 'RECEIVED' };
    setRequisitions((prev) =>
      prev.map((r) => (r.reqId === reqId ? updatedReq : r))
    );
    if (isSupabaseConfigured) {
      upsertRequisitionToSupabase(updatedReq).catch((err) =>
        console.warn('[Supabase Return Requisition Approve Error]', err)
      );
    }

    addAuditLog(
      'Return Request Approved & Received',
      `Admin approved return request ${reqId} for ${serialsToReturn.length} serials back to Admin HQ Stock`
    );

    addNotification(
      `Return Approved • ${reqId} Received into Admin HQ`,
      `Admin received ${serialsToReturn.length} returned unit(s) from Branch Code ${targetReq.branchId} (${targetReq.branchName}) into Central HQ Stock.`,
      'STOCK',
      targetReq.branchId,
      'requisitions'
    );

    triggerToast(`Approved return ${reqId}! Units received into Admin HQ Stock`);
  };

  // Merchant CRM Bindings (for MerchantsCrmTab - supports both existing & newly created serials)
  const handleBindDeviceToMerchant = (
    serial: string,
    merchantData: {
      mid: string;
      tid: string;
      merchantName: string;
      merchantPhone: string;
      address: string;
    }
  ) => {
    const cleanSn = serial.trim().toUpperCase();
    const dev = devices.find((d) => d.serial.toUpperCase() === cleanSn);
    const today = new Date().toISOString().split('T')[0];
    const nowTime = new Date().toISOString().replace('T', ' ').substring(0, 19);

    if (dev) {
      handleSaveWorkflow(dev.serial, {
        stage: 'COMPLETE',
        branchId: dev.branchId === '100' ? selectedBranch : dev.branchId,
        staff: dev.staff || selectedStaffUser,
        merchantName: merchantData.merchantName,
        merchantPhone: merchantData.merchantPhone,
        address: merchantData.address,
        mid: merchantData.mid,
        tid: merchantData.tid,
        note: `Bound to ${merchantData.merchantName} (${merchantData.mid} / ${merchantData.tid})`,
        deployedDate: today,
        batteryInstalledDate: dev.batteryInstalledDate || dev.stockInDate,
      });
      return;
    }

    // Create & bind new hardware serial if not yet in inventory
    const midBranchMatch = /^MID-880(\d{3})/.exec(merchantData.mid);
    const targetBranch = midBranchMatch?.[1] || selectedBranch || '105';
    const branchObj = branches.find((b) => b.code === targetBranch);
    const isSb = cleanSn.startsWith('SB');
    const newDev: Device = {
      serial: cleanSn,
      batterySerial: isSb
        ? `BAT-SB-${cleanSn.replace(/^SB-?/i, '')}`
        : `BAT-${cleanSn.replace(/^POS-?/i, '')}`,
      batteryInstalledDate: today,
      type: isSb ? 'Sound Box' : 'POS Terminal',
      model: isSb ? 'SB-Pro' : 'PAX A920 Pro',
      stockInDate: today,
      branchId: targetBranch,
      branchName: branchObj?.name || `Branch Code ${targetBranch}`,
      staff: branchObj?.staff[0] || selectedStaffUser || authUsername,
      stage: 'COMPLETE',
      deploymentStatus: 'Deployed (Live)',
      stockStatus: 'Deployed',
      mid: merchantData.mid,
      tid: merchantData.tid,
      merchantName: merchantData.merchantName,
      merchantPhone: merchantData.merchantPhone,
      location: 'Phnom Penh',
      address: merchantData.address,
      deployedDate: today,
      returnReason: '',
      redeployCount: 0,
      hoursInStage: 1,
      updatedAt: today,
      note: `Bound to ${merchantData.merchantName} (${merchantData.mid} / ${merchantData.tid})`,
      history: [
        `${nowTime} | Cycle #1: Installed (Live) | Registered & bound to ${merchantData.merchantName} (${merchantData.mid} / ${merchantData.tid})`,
      ],
      archived: false,
    };

    setDevices((prev) => [newDev, ...prev]);
    addAuditLog(
      'Merchant Hardware Bound',
      `Registered & bound ${cleanSn} to ${merchantData.merchantName} (${merchantData.mid} / ${merchantData.tid})`
    );
    triggerToast(`Bound ${cleanSn} to ${merchantData.merchantName}`);
  };

  const handleBulkBindDevicesToMerchants = (
    assignments: Array<{
      serial: string;
      mid: string;
      tid: string;
      merchantName: string;
      merchantPhone: string;
      address: string;
    }>
  ) => {
    if (assignments.length === 0) return;
    const today = new Date().toISOString().split('T')[0];
    const nowTime = new Date().toISOString().replace('T', ' ').substring(0, 19);

    setDevices((prev) => {
      const mapBySn = new Map<string, Device>();
      prev.forEach((d) => mapBySn.set(d.serial.toUpperCase(), d));

      const updatedExisting = prev.map((d) => {
        const match = assignments.find(
          (a) => a.serial.trim().toUpperCase() === d.serial.toUpperCase()
        );
        if (!match) return d;
        const midBranchMatch = /^MID-880(\d{3})/.exec(match.mid);
        const targetBranch =
          d.branchId !== '100'
            ? d.branchId
            : midBranchMatch?.[1] || selectedBranch || '105';
        const branchObj = branches.find((b) => b.code === targetBranch);
        const nextCycleNum = (d.history || []).length + 1;
        const hadPrevMerchant =
          Boolean(d.merchantName?.trim()) &&
          d.merchantName.trim().toLowerCase() !==
            match.merchantName.trim().toLowerCase();
        return {
          ...d,
          stage: 'COMPLETE' as LifecycleStage,
          branchId: targetBranch,
          branchName: branchObj?.name || d.branchName,
          merchantName: match.merchantName,
          merchantPhone: match.merchantPhone,
          address: match.address,
          mid: match.mid,
          tid: match.tid,
          deployedDate: today,
          redeployCount: hadPrevMerchant
            ? (d.redeployCount || 0) + 1
            : d.redeployCount || 0,
          updatedAt: today,
          archived: false,
          history: [
            `${nowTime} | Cycle #${nextCycleNum}: Installed (Live) | Bulk bound to ${match.merchantName} (${match.mid} / ${match.tid})`,
            ...(d.history || []),
          ],
        };
      });

      const newlyCreated: Device[] = assignments
        .filter((a) => !mapBySn.has(a.serial.trim().toUpperCase()))
        .map((a) => {
          const cleanSn = a.serial.trim().toUpperCase();
          const midBranchMatch = /^MID-880(\d{3})/.exec(a.mid);
          const targetBranch = midBranchMatch?.[1] || selectedBranch || '105';
          const branchObj = branches.find((b) => b.code === targetBranch);
          const isSb = cleanSn.startsWith('SB');
          return {
            serial: cleanSn,
            batterySerial: isSb
              ? `BAT-SB-${cleanSn.replace(/^SB-?/i, '')}`
              : `BAT-${cleanSn.replace(/^POS-?/i, '')}`,
            batteryInstalledDate: today,
            type: isSb ? 'Sound Box' : 'POS Terminal',
            model: isSb ? 'SB-Pro' : 'PAX A920 Pro',
            stockInDate: today,
            branchId: targetBranch,
            branchName: branchObj?.name || `Branch Code ${targetBranch}`,
            staff: branchObj?.staff[0] || selectedStaffUser || authUsername,
            stage: 'COMPLETE' as LifecycleStage,
            deploymentStatus: 'Deployed (Live)',
            stockStatus: 'Deployed',
            mid: a.mid,
            tid: a.tid,
            merchantName: a.merchantName,
            merchantPhone: a.merchantPhone,
            location: 'Phnom Penh',
            address: a.address,
            deployedDate: today,
            returnReason: '',
            redeployCount: 0,
            hoursInStage: 1,
            updatedAt: today,
            note: `Bulk bound to ${a.merchantName}`,
            history: [
              `${nowTime} | Cycle #1: Installed (Live) | Bulk bound to ${a.merchantName} (${a.mid} / ${a.tid})`,
            ],
            archived: false,
          };
        });

      return [...newlyCreated, ...updatedExisting];
    });

    addAuditLog(
      'Bulk Merchant Binding',
      `Bound ${assignments.length} hardware serial(s) to production merchant MIDs/TIDs`
    );
    triggerToast(`Assigned ${assignments.length} validated merchant hardware record(s)`);
  };

  const handleSaveBranch = (e: React.FormEvent) => {
    e.preventDefault();
    const code = branchCodeInput.trim();
    const name = branchNameInput.trim();
    const staffArr = branchStaffInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (!code || !name) return;

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
    const today = new Date().toISOString().split('T')[0];
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
        uid: `USR-${Date.now()}`,
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

  const handleExportInventoryCsv = () => {
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
      ...activeCustom.map((f) => f.label.replace(/\s+/g, '_')),
    ];
    const rows = filteredInventory.map((d) => {
      const bObj = branches.find((b) => b.code === d.branchId);
      const bName = bObj?.name || d.branchName || `Branch ${d.branchId}`;
      const batSn =
        d.batterySerial && !d.batterySerial.startsWith('BAT-')
          ? d.batterySerial
          : (d.type === 'POS Terminal'
            ? deriveBatterySerial(d.serial, true)
            : `SB-BAT-${d.serial.replace(/^SB-/i, '')}`);
      const customCells = activeCustom.map((f) => {
        if (f.id === 'location') return d.location || '';
        if (f.id === 'merchantPhone') return d.merchantPhone || '';
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
        ...customCells,
      ]
        .map(escapeCsvCell)
        .join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `POS_Soundbox_BranchCode_Inventory_${
      new Date().toISOString().split('T')[0]
    }.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    addAuditLog(
      'Inventory CSV Exported',
      `Exported ${filteredInventory.length} hardware serials`
    );
    triggerToast(`Exported ${filteredInventory.length} serials to CSV`);
  };

  const handleTriggerMobileSync = async (payload: MobileInstallSyncPayload) => {
    const nowTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const existingDev = devices.find(
      (d) => d.serial.toUpperCase() === payload.serial.trim().toUpperCase()
    );
    const newEvent: MobileWebhookEvent = {
      eventId:
        payload.eventId || `WH-2026-${Math.floor(1000 + Math.random() * 9000)}`,
      timestamp: nowTime,
      serial: payload.serial,
      previousStage: existingDev?.stage || 'CONFIGURING',
      newStage: payload.stage,
      mid: payload.mid || '',
      tid: payload.tid || '',
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
      tid: payload.tid || '',
      note: payload.note || 'Synced via Mobile Field System API',
      deployedDate: new Date().toISOString().split('T')[0],
      batteryInstalledDate:
        existingDev?.batteryInstalledDate ||
        new Date().toISOString().split('T')[0],
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
    const today = new Date().toISOString().split('T')[0];
    const nowTime = new Date().toISOString().replace('T', ' ').substring(0, 19);

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
          tid: evt.tid || d.tid,
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
            model: isSb ? 'SB-Pro' : 'PAX A920 Pro',
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
    const today = new Date().toISOString().split('T')[0];
    const nowTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const faultyDev = devices.find((d) => d.serial === faultySerial);
    if (!faultyDev) return;

    const originalInstaller = faultyDev.installedByStaff || faultyDev.staff || selectedStaffUser;
    const replacementOfficer = replaceStaff || selectedStaffUser;
    const isDifferentOfficer = originalInstaller !== replacementOfficer;

    setDevices((prev) =>
      prev.map((d) => {
        if (d.serial === faultySerial) {
          const nextCycle = (d.history || []).length + 1;
          return {
            ...d,
            stage: 'FAULTY',
            merchantName: '',
            mid: '',
            tid: '',
            merchantPhone: '',
            address: '',
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
            ...d,
            stage: 'COMPLETE',
            branchId: faultyDev.branchId,
            branchName: faultyDev.branchName,
            staff: replacementOfficer,
            installedByStaff: originalInstaller,
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

    if (faultyDev.mid && faultyDev.merchantName) {
      const histRec: HistoricalMerchantRecord = {
        recordId: `MREC-${Date.now().toString().slice(-6)}`,
        merchantName: faultyDev.merchantName,
        merchantPhone: faultyDev.merchantPhone || '012 000 000',
        address: faultyDev.address || 'Phnom Penh, Cambodia',
        mid: faultyDev.mid,
        tid: faultyDev.tid || `TID-${faultyDev.branchId}01`,
        deviceType: faultyDev.type,
        model: faultyDev.model,
        serial: faultyDev.serial,
        batterySerial: faultyDev.batterySerial,
        branchId: faultyDev.branchId,
        branchName: faultyDev.branchName,
        installedDate: faultyDev.deployedDate || faultyDev.stockInDate || today,
        returnedDate: today,
        activeDurationMonths: 6,
        returnReason: `Faulty hardware replaced by unit ${replacementSerial} (${reason})`,
        status: 'RETURNED',
        handledByStaff: replacementOfficer,
        installedByStaff: originalInstaller,
        replacedByStaff: replacementOfficer,
        returnedByStaff: replacementOfficer,
        settlementFinalized: true,
        notes: `Device ${faultySerial} installed by ${originalInstaller}, replaced on-site by ${replacementOfficer} with unit ${replacementSerial}.${isDifferentOfficer ? ` [Personnel Distinction: Installer (${originalInstaller}) ≠ Replacer (${replacementOfficer})]` : ''}`,
      };
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

  const uniqueMerchantsCount = useMemo(() => {
    const set = new Set<string>();
    const len = devices.length;
    for (let i = 0; i < len; i++) {
      const name = devices[i].merchantName;
      if (name) set.add(name);
    }
    return set.size;
  }, [devices]);

  const pendingReqsCount = useMemo(
    () => requisitions.filter((r) => r.status === 'PENDING_ADMIN').length,
    [requisitions]
  );

  const outOfSyncWebhooksCount = useMemo(() => {
    return webhookEvents.filter((evt) => {
      const dev = devices.find((d) => d.serial.toUpperCase() === evt.serial.toUpperCase());
      return !dev || dev.stage !== evt.newStage;
    }).length;
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
        totalDevices={filteredInventory.length}
        totalMerchants={uniqueMerchantsCount}
        totalHistoricalMerchants={historicalMerchants.length}
        webhookCount={outOfSyncWebhooksCount}
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
            totalDevices={filteredInventory.length}
            totalMerchants={uniqueMerchantsCount}
            totalHistoricalMerchants={historicalMerchants.length}
            webhookCount={outOfSyncWebhooksCount}
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
            devices={devices}
            onSelectDevice={(sn) => setEditingDeviceSerial(sn)}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
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
                onSelectStage={(st) => {
                  setStageFilter(st);
                  if (activeTab !== 'inventory' && st !== 'ALL') {
                    setActiveTab('inventory');
                  }
                }}
              />

              {/* Robust Responsive Tab Content with Error Boundary */}
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12, ease: 'easeOut' }}
                >
                  <ErrorBoundary>
                  {activeTab === 'dashboard' && (
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
                    />
                  )}

                  {activeTab === 'merchants' && (
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
                      theme={theme}
                    />
                  )}

                  {activeTab === 'merchant_history' && (
                    <MerchantHistoryTab
                      records={historicalMerchants}
                      branches={branches}
                      role={role}
                      selectedBranch={selectedBranch}
                      theme={theme}
                      devices={devices}
                      onAddRecord={(rec) => {
                        setHistoricalMerchants((prev) => [rec, ...prev]);
                        addAuditLog(
                          'Merchant History Archived',
                          `Recorded returned MID ${rec.mid} (${rec.merchantName}) with reason: ${rec.returnReason}`
                        );
                        setToastMessage(`Historical record for ${rec.merchantName} saved.`);
                      }}
                      onReturnDeviceStock={handleReturnSingleDeviceStock}
                      onSelectDevice={(sn) => setEditingDeviceSerial(sn)}
                      onToast={(msg) => setToastMessage(msg)}
                    />
                  )}

                  {activeTab === 'requisitions' && (
                    <RequisitionsTab
                      role={role}
                      requisitions={scopedRequisitions}
                      hqDevices={devices}
                      onOpenRequestModal={() => setIsReqModalOpen(true)}
                      onApproveRequisition={handleApproveRequisition}
                      onApproveReturnRequisition={handleApproveReturnRequisition}
                      onReceiveRequisition={handleReceiveRequisition}
                      theme={theme}
                      onDirectToStockInventory={handleDirectToStockInventory}
                      externalArrangingReq={fulfillingRequisition}
                      externalStagedItems={stagedFulfillmentItems}
                      onClearExternalArranging={() => {
                        setFulfillingRequisition(null);
                        setStagedFulfillmentItems(null);
                      }}
                    />
                  )}

                  {activeTab === 'inventory' && (
                    <InventoryTab
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
                      onExportCsv={handleExportInventoryCsv}
                      onBulkAssignBranch={handleBulkAssignBranch}
                      onReturnToAdminStock={handleReturnToAdminStock}
                      onRequestReturnToAdminStock={handleRequestReturnToAdminStock}
                      onRemoveFromDashboard={handleRemoveFromDashboard}
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
                    />
                  )}

                  {activeTab === 'branches' && (
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

                  {activeTab === 'audit_log' && (
                    <AuditLogTab
                      auditLogs={auditLogs}
                      role={role}
                      theme={theme}
                      onToast={(msg) => triggerToast(msg)}
                    />
                  )}

                  {(activeTab === 'users' || activeTab === 'iam') && (
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

                  {activeTab === 'mobile_sync' && (
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

                  {activeTab === 'brand_logo' && (
                    <LogoPageTab
                      appSettings={appSettings}
                      onUpdateAppSettings={setAppSettings}
                      triggerToast={triggerToast}
                      addAuditLog={addAuditLog}
                      theme={theme}
                    />
                  )}

                  {activeTab === 'settings' && role === 'SUPER_ADMIN' && (
                    <SettingsTab
                      settings={appSettings}
                      onUpdateSettings={(newSettings) => {
                        setAppSettings(newSettings);
                        addAuditLog(
                          'System Settings Updated',
                          'Super Admin updated operational policies, prefix rules and hardware timeouts'
                        );
                        setToastMessage('System settings and policy configuration saved.');
                      }}
                      role={role}
                      theme={theme}
                      onToast={(msg) => setToastMessage(msg)}
                      onExportBackup={handleExportBackup}
                      onImportBackup={handleImportBackup}
                      onResetData={() => {
                        localStorage.clear();
                        window.location.reload();
                      }}
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

                  {activeTab === 'settings' && role !== 'SUPER_ADMIN' && (
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
                  </ErrorBoundary>
                </motion.div>
              </AnimatePresence>
            </main>
          </div>

          {/* Mandatory Copyright Footer at Bottom */}
          <footer className="mx-4 sm:mx-6 mt-8 pt-5 pb-4 border-t border-slate-200/90 text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
            <div className="text-[11px] font-mono text-slate-500">
              Copyright © POS &amp; Sound Box Stock Management System 2026
            </div>
            <div className="flex items-center gap-4 text-[11px] font-mono">
              <span>{branches.length} Branch Codes Connected</span>
              <span>·</span>
              <span className="text-emerald-700 font-bold">
                System Integrity Protected
              </span>
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
        />

        {/* Classic Request Stock Modal (Triggers Alert Notification) */}
        <RequestStockModal
          isOpen={isReqModalOpen}
          onClose={() => setIsReqModalOpen(false)}
          branches={branches}
          activeBranchId={selectedBranch}
          onSubmitRequest={handleSubmitStockRequest}
          theme={theme}
        />

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
          onClose={() => setEditingDeviceSerial(null)}
          onSave={handleSaveWorkflow}
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

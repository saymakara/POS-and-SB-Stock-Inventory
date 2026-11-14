import { csvFile } from '../utils/csv';
import React, { useState, useMemo, useEffect, useCallback, useRef, useDeferredValue } from 'react';
import { usePager } from '../utils/usePager';
import { Pager } from './Pager';
import { createPortal } from 'react-dom';
import { Device, Branch, UserRole, ThemeMode, TelegramRegionalGroup, User as AppUser } from '../types';
import { resolveTelegramChatForBranch } from '../utils/errorLogger';
import { generatePushTrackingId } from '../utils/telegram';
import { normalizeStaffName, resolveStaffFromDirectory } from '../utils/staffUtils';
import { hasKhmer } from '../utils/display';
const dash = (v: string | null | undefined) => (String(v || '').trim() ? String(v) : '—');
import { todayPP, stampSecPP, clockPP } from '../utils/time';
import { motion, AnimatePresence } from 'motion/react';
import { DRAWER_VARIANTS, BACKDROP_VARIANTS, SPRING_TAB_PILL, SHARED_LAYOUT_IDS } from '../utils/animationRules';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import {
  Minus,
  SendHorizontal,
  Building2,
  Users,
  Search,
  Boxes,
  Send,
  Lock,
  ShieldCheck,
  AlertTriangle,
  Eye,
  EyeOff,
  X,
  AlertCircle,
  KeyRound,
  User,
  FileSpreadsheet,
  CheckCircle2,
  RotateCw,
  Copy,
  Check,
} from 'lucide-react';
import { formatBranchName, fmtNum } from '../utils/format';
import { PillMotion } from './PillMotion';

interface PushConfiguringTabProps {
  devices: Device[];
  branches: Branch[];
  role?: UserRole;
  operatorLabel?: string;
  onNotifyConfigReady?: (
    serialOrSerials: string | string[],
    options?: {
      forceCsvFile?: boolean;
      combineAllStaffCsv?: boolean;
      targetStaffName?: string;
      targetStaffTelegram?: string;
      pushTrackingId?: string;
    }
  ) => void;
  onSelectDevice?: (serial: string) => void;
  onCompleteDeployment?: (serial: string) => void;
  onReturnToReserve?: (serial: string, branchId: string, reason?: string) => void;
  onAssignStaff?: (serials: string[], staffName: string) => void;
  regionalGroups?: TelegramRegionalGroup[];
  theme?: ThemeMode;
  users?: AppUser[];
  pushedSerials?: Set<string>;
  onMarkPushed?: (serials: string[]) => void;
  onRefreshQueue?: () => Promise<void> | void;
  /** (5 Nov 2026) inside the POS Terminal / Sound Box page: this product only (the type list is hidden) */
  lockType?: 'POS Terminal' | 'Sound Box';
  hideHero?: boolean;
  viewToggle?: React.ReactNode;
}

export const PushConfiguringTab: React.FC<PushConfiguringTabProps> = React.memo(({
  lockType,
  hideHero = false,
  viewToggle,
  devices,
  branches,
  role = 'SUPER_ADMIN',
  operatorLabel = 'System Admin',
  onNotifyConfigReady,
  onSelectDevice,
  onAssignStaff,
  regionalGroups,
  theme = 'light',
  users = [],
  pushedSerials,
  onMarkPushed,
  onRefreshQueue,
}) => {
  const isLight = theme === 'light';
  const isAdminLike = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const cardClass = isLight ? 'surface-card-light text-[#002f49]' : 'surface-card-dark text-slate-100';

  const [isRefreshingQueue, setIsRefreshingQueue] = useState(false);
  const handleManualRefreshQueue = async () => {
    if (!onRefreshQueue || isRefreshingQueue) return;
    setIsRefreshingQueue(true);
    try {
      await onRefreshQueue();
    } finally {
      setIsRefreshingQueue(false);
    }
  };

  // 1. Filter only devices in CONFIGURING stage
  const configuringDevices = useMemo(() => {
    return devices.filter((d) => d.stage === 'CONFIGURING' && !d.archived);
  }, [devices]);

  // 2. Local filter states
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);                     // typing stays instant; the list follows a moment later
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [typeFilterState, setTypeFilterState] = useState<string>(lockType || 'ALL');
  const typeFilter = lockType || typeFilterState;
  const setTypeFilter: React.Dispatch<React.SetStateAction<string>> = lockType ? () => undefined : setTypeFilterState;
  const [pushStatusFilter, setPushStatusFilter] = useState<'ALL' | 'WAITING' | 'PUSHED'>('ALL');
  const [selectedSns, setSelectedSns] = useState<string[]>([]);
  const tableRef = useRef<HTMLDivElement>(null);

  // Push Mode:
  // - 'total_csv': Consolidated Total CSV per staff member (1 file/message per staff)
  // - 'total_csv_all': Total CSV file with all staff included together in one master file
  // - 'single_alert': Individual device text alerts
  const STORAGE_KEY_PUSH_MODE = 'crm_pos_push_mode_v1';
  const [pushMode, setPushMode] = useState<'total_csv' | 'total_csv_all' | 'single_alert'>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_PUSH_MODE);
      if (saved === 'single_alert' || saved === 'total_csv' || saved === 'total_csv_all') return saved;
    } catch (e) {
      // ignore
    }
    return 'total_csv';
  });

  const handleSetPushMode = (mode: 'total_csv' | 'total_csv_all' | 'single_alert') => {
    setPushMode(mode);
    try {
      localStorage.setItem(STORAGE_KEY_PUSH_MODE, mode);
    } catch (e) {
      // ignore
    }
  };

  // 3. Cooldown state for Telegram push (1-minute cooldown prevents accidental spam)
  const COOLDOWN_TIMEOUT_MS = 60000;

  const STORAGE_KEY_PUSHED_CONFIGURING = 'crm_pos_pushed_configuring_serials_v1';
  const STORAGE_KEY_PUSH_TIMESTAMPS = 'crm_pos_push_timestamps_v1';
  const STORAGE_KEY_PUSH_TRACKING = 'crm_pos_push_tracking_v1';

  const [pushTrackingMap, setPushTrackingMap] = useState<Record<string, { pushId: string; pushTime: string; pushedBy: string }>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_PUSH_TRACKING);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      // ignore
    }
    return {};
  });

  const [copiedPushId, setCopiedPushId] = useState<string | null>(null);

  const handleCopyPushId = (id: string) => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(id).catch(() => {});
    }
    setCopiedPushId(id);
    setTimeout(() => {
      setCopiedPushId((curr) => (curr === id ? null : curr));
    }, 2000);
  };

  const [pushedSerialsLocal, setPushedSerialsLocal] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_PUSHED_CONFIGURING);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return new Set(arr);
      }
    } catch (e) {
      // ignore
    }
    return new Set();
  });

  const [pushedCooldowns, setPushedCooldowns] = useState<Record<string, number>>({});
  const [pushTimestamps, setPushTimestamps] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_PUSH_TIMESTAMPS);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      // ignore
    }
    return {};
  });
  const [tickerNow, setTickerNow] = useState<number>(Date.now());

  // Synchronize local pushed serials whenever parent set updates
  useEffect(() => {
    if (!pushedSerials) return;
    if (isSupabaseConfigured) {
      setPushedSerialsLocal((prev) => {
        const same =
          pushedSerials.size === prev.size &&
          Array.from(pushedSerials).every((sn) => prev.has(sn));
        return same ? prev : new Set(pushedSerials);
      });
      return;
    }
    if (pushedSerials.size > 0) {
      setPushedSerialsLocal((prev) => {
        let changed = false;
        const next = new Set(prev);
        pushedSerials.forEach((sn) => {
          if (!next.has(sn)) {
            next.add(sn);
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }
  }, [pushedSerials]);

  // Synchronize push metadata and pushed serials directly from devices loaded from Supabase
  useEffect(() => {
    // Fast candidate filter: only scan devices with push metadata or in CONFIGURING stage (avoids 135k loop passes on 45k units)
    const candidateDevices: Device[] = [];
    const total = devices.length;
    for (let i = 0; i < total; i++) {
      const d = devices[i];
      if (d.pushTrackingId || d.pushDate || d.stage === 'CONFIGURING') {
        candidateDevices.push(d);
      }
    }
    if (candidateDevices.length === 0) return;

    let trackingChanged = false;
    let serialsChanged = false;
    let timestampsChanged = false;

    setPushTrackingMap((prev) => {
      const next = { ...prev };
      candidateDevices.forEach((d) => {
        if (d.pushTrackingId && !next[d.serial]) {
          next[d.serial] = {
            pushId: d.pushTrackingId,
            pushTime: d.pushDate || d.updatedAt || todayPP(),
            pushedBy: d.pushedBy || 'System Admin',
          };
          trackingChanged = true;
        }
      });
      if (trackingChanged) {
        try { localStorage.setItem(STORAGE_KEY_PUSH_TRACKING, JSON.stringify(next)); } catch (e) {}
        return next;
      }
      return prev;
    });

    setPushTimestamps((prev) => {
      const next = { ...prev };
      candidateDevices.forEach((d) => {
        if (d.pushDate && !next[d.serial]) {
          next[d.serial] = d.pushDate;
          timestampsChanged = true;
        }
      });
      if (timestampsChanged) {
        try { localStorage.setItem(STORAGE_KEY_PUSH_TIMESTAMPS, JSON.stringify(next)); } catch (e) {}
        return next;
      }
      return prev;
    });

    setPushedSerialsLocal((prev) => {
      const next = new Set(prev);
      candidateDevices.forEach((d) => {
        if (d.stage === 'CONFIGURING' && (d.pushTrackingId || d.pushDate)) {
          if (!next.has(d.serial)) {
            next.add(d.serial);
            serialsChanged = true;
          }
        }
      });
      if (serialsChanged) {
        try { localStorage.setItem(STORAGE_KEY_PUSHED_CONFIGURING, JSON.stringify([...next])); } catch (e) {}
        return next;
      }
      return prev;
    });
  }, [devices]);

  const recordPushedSerials = useCallback((serials: string[], batchId?: string) => {
    if (serials.length === 0) return;
    const nowStamp = stampSecPP();
    const assignedPushId = batchId || generatePushTrackingId();

    setPushTimestamps((prev) => {
      const next = { ...prev };
      serials.forEach((sn) => { next[sn] = nowStamp; });
      try {
        localStorage.setItem(STORAGE_KEY_PUSH_TIMESTAMPS, JSON.stringify(next));
      } catch (e) {
        // ignore
      }
      return next;
    });

    setPushTrackingMap((prev) => {
      const next = { ...prev };
      serials.forEach((sn) => {
        next[sn] = { pushId: assignedPushId, pushTime: nowStamp, pushedBy: operatorLabel || 'System Admin' };
      });
      try {
        localStorage.setItem(STORAGE_KEY_PUSH_TRACKING, JSON.stringify(next));
      } catch (e) {
        // ignore
      }
      return next;
    });

    setPushedSerialsLocal((prev) => {
      const next = new Set(prev);
      serials.forEach((sn) => next.add(sn));
      try {
        localStorage.setItem(STORAGE_KEY_PUSHED_CONFIGURING, JSON.stringify([...next]));
      } catch (e) {
        // ignore
      }
      return next;
    });

    onMarkPushed?.(serials);
  }, [onMarkPushed, operatorLabel]);

  const isDevicePushed = useCallback((serial: string, devObj?: Device): boolean => {
    const dev = devObj || devices.find((d) => d.serial === serial);
    if (dev?.pushTrackingId || dev?.pushDate) return true;
    if (pushedCooldowns[`sn_${serial}`] && pushedCooldowns[`sn_${serial}`] > Date.now()) return true;
    if (isSupabaseConfigured) {
      return Boolean(pushedSerials?.has(serial));
    }
    return (
      Boolean(pushedSerials?.has(serial)) ||
      Boolean(pushedSerialsLocal.has(serial)) ||
      Boolean(pushTimestamps[serial])
    );
  }, [devices, pushedSerials, pushedSerialsLocal, pushTimestamps, pushedCooldowns]);

  const getDevicePushId = useCallback((dev: Device): string | null => {
    if (dev.pushTrackingId) return dev.pushTrackingId;
    if (pushTrackingMap[dev.serial]?.pushId) return pushTrackingMap[dev.serial].pushId;
    if (isDevicePushed(dev.serial, dev)) {
      const existingDate = pushTimestamps[dev.serial] || dev.pushDate || dev.updatedAt;
      const dStr = existingDate ? existingDate.slice(2, 10).replace(/-/g, '') : todayPP().slice(2).replace(/-/g, '');
      let hash = 0;
      for (let i = 0; i < dev.serial.length; i++) {
        hash = ((hash << 5) - hash) + dev.serial.charCodeAt(i);
        hash |= 0;
      }
      const randCode = String(Math.abs(hash) % 9000 + 1000);
      return `PUSH-${dStr}-${randCode}`;
    }
    return null;
  }, [pushTrackingMap, isDevicePushed, pushTimestamps]);

  // Ticker for live 1-minute cooldown timers (prevents repeated spamming)
  useEffect(() => {
    const hasActiveTimer = Object.keys(pushedCooldowns).length > 0;
    if (!hasActiveTimer) return;

    const interval = setInterval(() => {
      const now = Date.now();
      setTickerNow(now);

      // Automatically prune expired cooldown entries
      setPushedCooldowns((prev) => {
        let changed = false;
        const next: Record<string, number> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (v > now) {
            next[k] = v;
          } else {
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [pushedCooldowns]);

  // 4. Push to All Password Verification Modal State
  const [isPushAllModalOpen, setIsPushAllModalOpen] = useState(false);
  const [pusherPassword, setPusherPassword] = useState('');
  const [showPusherPassword, setShowPusherPassword] = useState(false);
  const [pusherPasswordError, setPusherPasswordError] = useState('');
  const [isVerifyingPusher, setIsVerifyingPusher] = useState(false);

  // Guarantee PIN is always reset and not remembered whenever modal opens
  useEffect(() => {
    if (isPushAllModalOpen) {
      setPusherPassword('');
      setPusherPasswordError('');
      setShowPusherPassword(false);
    }
  }, [isPushAllModalOpen]);

  // 5. Filtered devices in view
  const filteredDevices = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return configuringDevices.filter((d) => {
      if (branchFilter !== 'ALL' && d.branchId !== branchFilter) return false;
      if (typeFilter !== 'ALL' && d.type !== typeFilter) return false;
      if (pushStatusFilter === 'WAITING' && isDevicePushed(d.serial, d)) return false;
      if (pushStatusFilter === 'PUSHED' && !isDevicePushed(d.serial, d)) return false;
      if (!q) return true;
      const pushId = (getDevicePushId(d) || '').toLowerCase();
      return (
        pushId.includes(q) ||
        d.serial.toLowerCase().includes(q) ||
        (d.merchantName || '').toLowerCase().includes(q) ||
        (d.mid || '').toLowerCase().includes(q) ||
        (d.tid || '').toLowerCase().includes(q) ||
        (d.staff || '').toLowerCase().includes(q) ||
        (d.installedByStaff || '').toLowerCase().includes(q) ||
        (d.branchName || '').toLowerCase().includes(q) ||
        d.branchId.toLowerCase().includes(q) ||
        (d.deployedDate || '').toLowerCase().includes(q) ||
        (d.stockInDate || '').toLowerCase().includes(q)
      );
    });
  }, [configuringDevices, deferredSearch, branchFilter, typeFilter, pushStatusFilter, isDevicePushed, getDevicePushId]);

  // Lookup map for staff Telegram handles
  const userTelegramMap = useMemo(() => {
    const map = new Map<string, string>();
    (users || []).forEach((u) => {
      if (u.telegramUsername) {
        const clean = u.telegramUsername.trim().replace(/^@/, '');
        if (clean) {
          map.set(u.name.toLowerCase().trim(), clean);
          map.set(u.empId.toLowerCase().trim(), clean);
          if (u.label) map.set(u.label.toLowerCase().trim(), clean);
        }
      }
    });
    return map;
  }, [users]);

  // 6. Grouped by Assigned Staff / Team
  const teamGroups = useMemo(() => {
    const map = new Map<string, { staff: string; staffTelegram?: string; branchId: string; branchName: string; devices: Device[] }>();
    for (const d of configuringDevices) {
      const rawStaff = d.staff || d.installedByStaff || 'Unassigned Staff';
      const staffName = normalizeStaffName(resolveStaffFromDirectory(rawStaff, d.branchId, users));
      const bObj = branches.find((b) => b.code === d.branchId);
      const bName = bObj ? bObj.name : (d.branchName || `Branch ${d.branchId}`);
      const key = `${staffName}__${d.branchId}`;
      if (!map.has(key)) {
        const tgHandle = d.staffTelegram || userTelegramMap.get(staffName.toLowerCase().trim());
        map.set(key, { staff: staffName, staffTelegram: tgHandle, branchId: d.branchId, branchName: bName, devices: [] });
      }
      map.get(key)!.devices.push(d);
    }
    return Array.from(map.values()).sort((a, b) => b.devices.length - a.devices.length);
  }, [configuringDevices, branches, userTelegramMap, users]);

  // Counts
  const posCount = useMemo(() => configuringDevices.filter((d) => d.type === 'POS Terminal').length, [configuringDevices]);
  const sbCount = useMemo(() => configuringDevices.filter((d) => d.type === 'Sound Box').length, [configuringDevices]);

  // Devices waiting to be pushed vs already pushed
  const waitingDevices = useMemo(() => {
    return configuringDevices.filter((d) => !isDevicePushed(d.serial, d));
  }, [configuringDevices, isDevicePushed]);

  const alreadyPushedDevices = useMemo(() => {
    return configuringDevices.filter((d) => isDevicePushed(d.serial, d));
  }, [configuringDevices, isDevicePushed]);

  const filteredWaitingCount = useMemo(() => {
    return filteredDevices.filter((d) => !isDevicePushed(d.serial, d)).length;
  }, [filteredDevices, isDevicePushed]);

  // Checkbox helpers
  const handleToggleSelectAll = () => {
    if (selectedSns.length === filteredDevices.length && filteredDevices.length > 0) {
      setSelectedSns([]);
    } else {
      setSelectedSns(filteredDevices.map((d) => d.serial));
    }
  };

  // Scroll and filter table when KPI mini-cards are clicked
  const handleCardClick = (target: 'WAITING' | 'POS' | 'SB' | 'ALL') => {
    if (target === 'WAITING') {
      if (waitingDevices.length === 0) {
        setPushStatusFilter('ALL');
      } else {
        setPushStatusFilter((prev) => (prev === 'WAITING' ? 'ALL' : 'WAITING'));
      }
    } else if (target === 'POS') {
      setTypeFilter((prev) => (prev === 'POS Terminal' ? 'ALL' : 'POS Terminal'));
    } else if (target === 'SB') {
      setTypeFilter((prev) => (prev === 'Sound Box' ? 'ALL' : 'Sound Box'));
    } else if (target === 'ALL') {
      setPushStatusFilter('ALL');
      setTypeFilter('ALL');
      setBranchFilter('ALL');
      setSearch('');
    }
    // Smooth scroll directly to the hardware queue table
    tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const lastPushSelectedIdxRef = useRef<number | null>(null);
  // (4 Nov 2026, speed) 50 / 100 rows per page like every other table. Before, every unit in the queue was drawn at once:
  // 2,857 units = 108,000 page elements, a freeze of several seconds when the tab opened and again when it was left.
  // Select all, the branch file and the push actions still work on the whole filtered list.
  const pg = usePager(filteredDevices.length, [search, typeFilter, branchFilter]);
  const pageDevices = useMemo(() => filteredDevices.slice(pg.start, pg.end), [filteredDevices, pg.start, pg.end]);
  const selectedSet = useMemo(() => new Set(selectedSns), [selectedSns]);   // one lookup per row instead of a scan

  const handleToggleSelectOne = (sn: string, index?: number, e?: React.MouseEvent) => {
    if (
      typeof index === 'number' &&
      e?.shiftKey &&
      lastPushSelectedIdxRef.current !== null &&
      lastPushSelectedIdxRef.current !== index
    ) {
      const start = Math.min(lastPushSelectedIdxRef.current, index);
      const end = Math.max(lastPushSelectedIdxRef.current, index);
      const rangeSns = filteredDevices.slice(start, end + 1).map((d) => d.serial);
      setSelectedSns((prev) => Array.from(new Set([...prev, ...rangeSns])));
      lastPushSelectedIdxRef.current = index;
      return;
    }
    if (typeof index === 'number') {
      lastPushSelectedIdxRef.current = index;
    }
    setSelectedSns((prev) =>
      prev.includes(sn) ? prev.filter((x) => x !== sn) : [...prev, sn]
    );
  };

  // Cooldown Seconds Helpers (1-minute live countdown after push)
  const getRowCooldownSecs = (serial: string): number => {
    const exp = pushedCooldowns[`sn_${serial}`];
    if (!exp || exp <= tickerNow) return 0;
    return Math.max(1, Math.ceil((exp - tickerNow) / 1000));
  };

  const getTeamCooldownSecs = (teamKey: string): number => {
    const exp = pushedCooldowns[`team_${teamKey}`];
    if (!exp || exp <= tickerNow) return 0;
    return Math.max(1, Math.ceil((exp - tickerNow) / 1000));
  };

  const getBatchCooldownSecs = (): number => {
    const exp = pushedCooldowns['batch'];
    if (!exp || exp <= tickerNow) return 0;
    return Math.max(1, Math.ceil((exp - tickerNow) / 1000));
  };

  // Helper to extract formatted Date and Time of Request Push
  const getRequestPushDateTime = (dev: Device): { full: string; date: string; time: string } => {
    // 0. If actively pushed and persisted to backend (matches PC across all devices)
    if (dev.pushDate) {
      const full = dev.pushDate;
      const [d, t] = full.split(' ');
      return { full, date: d || todayPP(), time: t || clockPP() };
    }

    // 1. If actively pushed in current session, use recorded push timestamp
    if (pushTimestamps[dev.serial]) {
      const full = pushTimestamps[dev.serial];
      const [d, t] = full.split(' ');
      return { full, date: d || todayPP(), time: t || clockPP() };
    }

    // 2. Check dev.history for the most recent cycle event timestamp (format: YYYY-MM-DD HH:mm:ss)
    if (Array.isArray(dev.history) && dev.history.length > 0) {
      for (const h of dev.history) {
        const match = typeof h === 'string' ? h.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)/) : null;
        if (match) {
          const d = match[1];
          let t = match[2];
          if (t.length === 5) t = `${t}:00`;
          return { full: `${d} ${t}`, date: d, time: t };
        }
      }
    }

    // 3. Check dev.updatedAt (Supabase ISO timestamp)
    if (dev.updatedAt) {
      if (dev.updatedAt.includes('T') || (dev.updatedAt.includes(':') && dev.updatedAt.includes('-'))) {
        const parsed = new Date(dev.updatedAt);
        if (!isNaN(parsed.getTime())) {
          const full = stampSecPP(parsed);
          const [d, t] = full.split(' ');
          return { full, date: d || dev.updatedAt.slice(0, 10), time: t || '08:30:00' };
        }
      } else if (/^\d{4}-\d{2}-\d{2}/.test(dev.updatedAt)) {
        const d = dev.updatedAt.slice(0, 10);
        return { full: `${d} 08:30:00`, date: d, time: '08:30:00' };
      }
    }

    // 4. Check dev.deployedDate
    if (dev.deployedDate) {
      if (dev.deployedDate.includes('T') || dev.deployedDate.includes(':')) {
        const parsed = new Date(dev.deployedDate);
        if (!isNaN(parsed.getTime())) {
          const full = stampSecPP(parsed);
          const [d, t] = full.split(' ');
          return { full, date: d, time: t };
        }
      }
      const d = dev.deployedDate.slice(0, 10);
      return { full: `${d} 09:00:00`, date: d, time: '09:00:00' };
    }

    // 5. Fallback to stockInDate or todayPP
    const d = dev.stockInDate ? dev.stockInDate.slice(0, 10) : todayPP();
    return { full: `${d} 08:30:00`, date: d, time: '08:30:00' };
  };

  // Helper to resolve the Authorizing Officer / Admin who assigned the device
  const getAssignedBy = (dev: Device): string => {
    if (Array.isArray(dev.history) && dev.history.length > 0) {
      for (const h of dev.history) {
        if (typeof h === 'string') {
          const officerMatch =
            h.match(/—\s*Officer:\s*([^|—\n]+)/i) ||
            h.match(/Officer:\s*([^|—\n]+)/i) ||
            h.match(/Assigned\s*(?:by|to)\s*:?\s*([^|—\n]+)/i);
          if (officerMatch && officerMatch[1]?.trim()) {
            return officerMatch[1].trim();
          }
        }
      }
    }
    return operatorLabel || 'System Admin';
  };

  // Single-click immediate push handlers with 1-minute anti-spam cooldown
  const handleTeamPushClick = (
    key: string,
    serials: string[],
    targetStaffName?: string,
    targetStaffTelegram?: string
  ) => {
    if (getTeamCooldownSecs(key) > 0 || serials.length === 0) return;

    // Record push timestamp and mark pushed for all units in team
    const pushId = generatePushTrackingId();
    recordPushedSerials(serials, pushId);

    // 1-minute cooldown for this team and all devices in it
    const cooldownExp = Date.now() + COOLDOWN_TIMEOUT_MS;
    setPushedCooldowns((prev) => {
      const next: Record<string, number> = { ...prev, [`team_${key}`]: cooldownExp };
      serials.forEach((sn) => {
        next[`sn_${sn}`] = cooldownExp;
      });
      return next;
    });

    onNotifyConfigReady?.(serials, {
      forceCsvFile: true,
      targetStaffName,
      targetStaffTelegram,
      pushTrackingId: pushId,
    });
  };

  const handleBatchPushClick = () => {
    if (getBatchCooldownSecs() > 0 || selectedSns.length === 0) return;

    // Record push timestamp and mark pushed for all selected units
    const pushId = generatePushTrackingId();
    recordPushedSerials(selectedSns, pushId);

    // 1-minute cooldown for batch and selected devices
    const cooldownExp = Date.now() + COOLDOWN_TIMEOUT_MS;
    setPushedCooldowns((prev) => {
      const next: Record<string, number> = { ...prev, batch: cooldownExp };
      selectedSns.forEach((sn) => {
        next[`sn_${sn}`] = cooldownExp;
      });
      return next;
    });

    onNotifyConfigReady?.(selectedSns, {
      forceCsvFile: pushMode === 'total_csv' || pushMode === 'total_csv_all',
      combineAllStaffCsv: pushMode === 'total_csv_all',
      pushTrackingId: pushId,
    });
    setSelectedSns([]);
  };

  // Single-row direct push and repush handler
  const handleRowPushClick = (dev: Device) => {
    if (getRowCooldownSecs(dev.serial) > 0) return;

    // Record push timestamp and mark pushed for this device with new push ID
    const pushId = generatePushTrackingId();
    recordPushedSerials([dev.serial], pushId);

    // 10-second anti-spam cooldown for single row push/repush
    const cooldownExp = Date.now() + 10000;
    setPushedCooldowns((prev) => ({
      ...prev,
      [`sn_${dev.serial}`]: cooldownExp,
    }));

    // Resolve staff name and Telegram handle if available
    const rawStaff = dev.staff || dev.installedByStaff || '';
    const staffName = normalizeStaffName(resolveStaffFromDirectory(rawStaff, dev.branchId, users));
    const staffTelegram = dev.staffTelegram || (staffName ? userTelegramMap.get(staffName.toLowerCase().trim()) : undefined);

    onNotifyConfigReady?.([dev.serial], {
      forceCsvFile: pushMode === 'total_csv' || pushMode === 'total_csv_all',
      combineAllStaffCsv: pushMode === 'total_csv_all',
      targetStaffName: staffName && staffName !== 'Unassigned Staff' ? staffName : undefined,
      targetStaffTelegram: staffTelegram,
      pushTrackingId: pushId,
    });
  };

  // PIN / Password verification for Push to All
  const handleConfirmPushAllWithPassword = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setPusherPasswordError('');
    const entered = pusherPassword.trim();
    if (!entered) {
      setPusherPasswordError('Please enter your PIN or password to authorize push to all.');
      return;
    }

    setIsVerifyingPusher(true);
    try {
      // 1. Check operator PIN / Employee ID / fallback PIN first (instant verification)
      const empIdMatch = operatorLabel.match(/\((\d+)\)/);
      const empId = empIdMatch ? empIdMatch[1] : '';

      const matchingUser = (users || []).find((u) => {
        const uEmp = (u.empId || '').toLowerCase().trim();
        const uName = (u.name || '').toLowerCase().trim();
        const opLower = operatorLabel.toLowerCase().trim();
        return (empId && uEmp === empId.toLowerCase()) || opLower.includes(uName) || opLower.includes(uEmp);
      });

      const validPins = [
        empId,
        matchingUser?.empId,
        '1234',
        matchingUser?.password,
      ].filter(Boolean);

      if (validPins.some((vp) => entered === vp)) {
        executePushAll();
        return;
      }

      // 2. If Supabase is connected, also allow verification via account password
      if (isSupabaseConfigured) {
        const { data: authData } = await supabase.auth.getUser();
        const email = authData?.user?.email;
        if (email) {
          const { error: signInErr } = await supabase.auth.signInWithPassword({
            email,
            password: entered,
          });
          if (!signInErr) {
            executePushAll();
            return;
          }
        }
      }

      setPusherPasswordError(`Incorrect PIN or password. Enter your Employee ID (${empId || '8986'}) or security PIN.`);
    } catch (err: any) {
      setPusherPasswordError(err?.message || 'Verification failed. Please try again.');
    } finally {
      setIsVerifyingPusher(false);
    }
  };

  const executePushAll = () => {
    setIsPushAllModalOpen(false);
    setPusherPassword('');
    setPusherPasswordError('');
    const allSerials = configuringDevices.map((d) => d.serial);
    const pushId = generatePushTrackingId();
    recordPushedSerials(allSerials, pushId);
    const cooldownExp = Date.now() + COOLDOWN_TIMEOUT_MS;
    setPushedCooldowns((prev) => {
      const next: Record<string, number> = { ...prev, batch: cooldownExp };
      allSerials.forEach((sn) => {
        next[`sn_${sn}`] = cooldownExp;
      });
      return next;
    });
    onNotifyConfigReady?.(allSerials, {
      forceCsvFile: pushMode === 'total_csv' || pushMode === 'total_csv_all',
      combineAllStaffCsv: pushMode === 'total_csv_all',
      pushTrackingId: pushId,
    });
    setSelectedSns([]);
  };

  const handleExportCsv = () => {
    if (filteredDevices.length === 0) return;
    const headers = [
      'No.',
      'Tracking ID',
      'Date & Time',
      'Serial & Model',
      'Merchant Name & MID',
      'Configure By (Staff)',
      'Branch',
      'Assigned By',
    ];
    const rows = filteredDevices.map((dev, idx) => {
      const bObj = branches.find((b) => b.code === dev.branchId);
      const bName = bObj ? bObj.name : (dev.branchName || `Branch ${dev.branchId}`);
      const devPushId = getDevicePushId(dev) || 'Pending Push';
      const reqInfo = getRequestPushDateTime(dev);
      const serialModel = `${dev.serial} (${dev.model || dev.type})`;
      const merchantMidTid = `${dev.merchantName || '—'} · MID: ${dev.mid || '—'}`;
      const staffName = resolveStaffFromDirectory(dev.staff || dev.installedByStaff, dev.branchId, users) || 'Assigned Branch Staff';
      const assignedBy = getAssignedBy(dev);
      const branchDisplay = `${dev.branchId} · ${formatBranchName(bName)}`;

      return [
        String(idx + 1),
        devPushId,
        reqInfo.full,
        serialModel,
        merchantMidTid,
        staffName,
        branchDisplay,
        assignedBy,
      ];
    });
    const url = URL.createObjectURL(csvFile([headers, ...rows]));
    const link = document.createElement('a');
    link.href = url;
    link.download = `Push_Configuring_Queue_${todayPP()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Download dedicated branch/team configuration queue file to open
  const handleDownloadTeamFile = (tg: { staff: string; branchId: string; branchName: string; devices: Device[] }) => {
    if (tg.devices.length === 0) return;
    const headers = [
      'No.',
      'Tracking ID',
      'Date & Time',
      'Serial & Model',
      'Merchant Name & MID',
      'Configure By (Staff)',
      'Assigned By',
      'Branch Name',
      'Branch Code',
      'Action Required',
    ];
    const rows = tg.devices.map((dev, idx) => {
      const bObj = branches.find((b) => b.code === dev.branchId);
      const bName = bObj ? bObj.name : (dev.branchName || `Branch ${dev.branchId}`);
      const devPushId = getDevicePushId(dev) || 'Pending Push';
      const reqInfo = getRequestPushDateTime(dev);
      const serialModel = `${dev.serial} (${dev.model || dev.type})`;
      const merchantMidTid = `${dev.merchantName || '—'} · MID: ${dev.mid || '—'}`;
      const staffName = dev.staff || dev.installedByStaff || tg.staff;
      const assignedBy = getAssignedBy(dev);
      return [
        String(idx + 1),
        devPushId,
        reqInfo.full,
        serialModel,
        merchantMidTid,
        staffName,
        assignedBy,
        bName,
        dev.branchId,
        'OPEN device and connect to network to wait for App Push',
      ];
    });
    const url = URL.createObjectURL(csvFile([headers, ...rows]));
    const link = document.createElement('a');
    link.href = url;
    const cleanStaff = normalizeStaffName(tg.staff).replace(/[^a-zA-Z0-9]/g, '_');
    link.download = `Branch_${tg.branchId}_${cleanStaff}_Config_Queue_${todayPP()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Download configuration file for user-selected batch of devices
  const handleDownloadSelectedFile = () => {
    if (selectedSns.length === 0) return;
    const selectedDevices = filteredDevices.filter((d) => selectedSns.includes(d.serial));
    if (selectedDevices.length === 0) return;
    const headers = [
      'No.',
      'Date & Time',
      'Serial & Model',
      'Merchant Name & MID',
      'Configure By (Staff)',
      'Assigned By',
      'Branch Name',
      'Branch Code',
      'Action Required',
    ];
    const rows = selectedDevices.map((dev, idx) => {
      const bObj = branches.find((b) => b.code === dev.branchId);
      const bName = bObj ? bObj.name : (dev.branchName || `Branch ${dev.branchId}`);
      const reqInfo = getRequestPushDateTime(dev);
      const serialModel = `${dev.serial} (${dev.model || dev.type})`;
      const merchantMidTid = `${dev.merchantName || '—'} · MID: ${dev.mid || '—'}`;
      const staffName = dev.staff || dev.installedByStaff || 'Assigned Branch Staff';
      const assignedBy = getAssignedBy(dev);
      return [
        String(idx + 1),
        reqInfo.full,
        serialModel,
        merchantMidTid,
        staffName,
        assignedBy,
        bName,
        dev.branchId,
        'OPEN device and connect to network to wait for App Push',
      ];
    });
    const url = URL.createObjectURL(csvFile([headers, ...rows]));
    const link = document.createElement('a');
    link.href = url;
    link.download = `Selected_Branch_Devices_Config_Queue_${todayPP()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const renderPushModeToggle = (layoutId: string) => (
    <div
      role="tablist"
      aria-label="CSV file selection mode"
      className={`relative inline-flex flex-wrap items-center p-1 rounded-xl border shadow-2xs select-none gap-0.5 ${
        isLight
          ? 'bg-slate-100/90 border-slate-200/90'
          : 'bg-slate-900/60 border-slate-800'
      }`}
    >
      {(
        [
          {
            mode: 'total_csv' as const,
            label: 'Total CSV by Staff',
            badge: '1 Msg',
            title: 'Consolidate devices per staff member into 1 Telegram message + CSV file',
            icon: 'csv' as const,
            activeIconCls: isLight ? 'text-white/90' : 'text-emerald-400',
          },
          {
            mode: 'total_csv_all' as const,
            label: 'Total CSV (All Staff)',
            badge: '1 File',
            title: 'Combine all devices across all staff into 1 single CSV file and message',
            icon: 'csv' as const,
            activeIconCls: isLight ? 'text-white/90' : 'text-teal-400',
          },
          {
            mode: 'single_alert' as const,
            label: 'Single Alert',
            badge: undefined,
            title: 'Send individual 1-device alert without attached CSV file',
            icon: 'send' as const,
            activeIconCls: isLight ? 'text-white/90' : 'text-sky-400',
          },
        ]
      ).map((opt) => {
        const active = pushMode === opt.mode;
        return (
          <button
            key={opt.mode}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => handleSetPushMode(opt.mode)}
            title={opt.title}
            className={`relative px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors duration-200 cursor-pointer select-none outline-none ${
              active
                ? isLight ? 'text-white' : 'text-sky-300'
                : isLight ? 'text-slate-600 hover:text-slate-900' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {active && (
              <PillMotion
                layoutId={layoutId}
                className={`absolute inset-0 rounded-lg shadow-xs ${
                  isLight
                    ? 'tab-active-blue border border-white/10'
                    : 'bg-slate-800 border border-slate-700/80'
                }`}
                transition={SPRING_TAB_PILL}
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {opt.icon === 'csv' ? (
                <FileSpreadsheet className={`w-3.5 h-3.5 transition-colors ${active ? opt.activeIconCls : 'text-slate-400'}`} />
              ) : (
                <Send className={`w-3 h-3 transition-colors ${active ? opt.activeIconCls : 'text-slate-400'}`} />
              )}
              <span>{opt.label}</span>
              {opt.badge && (
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold tabular-nums transition-colors ${
                  active
                    ? isLight ? 'bg-white/20 text-white' : 'bg-slate-700 text-sky-200'
                    : isLight ? 'bg-slate-200/80 text-slate-600' : 'bg-slate-800 text-slate-400'
                }`}>
                  {opt.badge}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );

return (
    <div className="space-y-4">
      {hideHero ? (
        <div className="surface-card rounded-2xl overflow-hidden border border-slate-200/90 shadow-sm">
          {/* Header */}
          <div className="bg-slate-100 dark:bg-slate-800/90 border-b border-slate-200/90 dark:border-slate-700/80 px-5 py-4 min-h-[78px] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 flex items-center justify-center shrink-0 shadow-2xs">
                <SendHorizontal className="w-5 h-5 text-sky-600 dark:text-sky-400" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base sm:text-lg font-extrabold tracking-tight text-slate-900 dark:text-white">
                    Push Configuring Hub
                  </h2>
                  <span className="px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-sky-100 text-sky-800 border border-sky-200">
                    {waitingDevices.length} Waiting
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Alert field technicians and branch officers to power ON devices and wait for application push
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {onRefreshQueue && (
                <button
                  type="button"
                  onClick={handleManualRefreshQueue}
                  disabled={isRefreshingQueue}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 shadow-2xs transition cursor-pointer disabled:opacity-50"
                  title="Refresh hardware configuring queue from database"
                >
                  <RotateCw className={`w-3.5 h-3.5 text-slate-600 dark:text-sky-300 ${isRefreshingQueue ? 'animate-spin' : ''}`} />
                  <span>Sync Queue</span>
                </button>
              )}
              {isAdminLike && onNotifyConfigReady && (
                <button
                  type="button"
                  disabled={configuringDevices.length === 0}
                  onClick={() => {
                    setPusherPassword('');
                    setPusherPasswordError('');
                    setIsPushAllModalOpen(true);
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold bg-[#003857] hover:bg-[#002a42] text-white shadow-2xs transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Push alerts to all devices (Requires Pusher Password verification)"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>{waitingDevices.length === 0 && configuringDevices.length > 0 ? 'Re-push All' : 'Notify All Ready'}</span>
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10.5px] font-mono bg-white/20 text-white">
                    {waitingDevices.length > 0 ? `${waitingDevices.length} Waiting` : 'Pushed'}
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* Filter & CSV Mode Toolbar */}
          <div className="p-4 bg-slate-50/70 border-b border-slate-200/90 space-y-3">
            {/* Row 1: Search + Push Status filter */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
              <div className="relative sm:col-span-2 md:col-span-2 lg:col-span-4">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search Push ID (PUSH-...), serial, MID, TID, staff, date..."
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl text-xs font-semibold border bg-white border-slate-200 text-zinc-900 placeholder:text-slate-400 focus:border-zinc-700 outline-none transition shadow-2xs"
                />
              </div>

              <div className="relative sm:col-span-1 md:col-span-1 lg:col-span-2">
                <select
                  value={pushStatusFilter}
                  onChange={(e) => setPushStatusFilter(e.target.value as any)}
                  className="w-full px-3 py-2.5 rounded-xl text-xs font-normal border bg-white border-slate-200 text-zinc-800 focus:border-zinc-700 outline-none cursor-pointer shadow-2xs"
                >
                  <option value="ALL">All Statuses ({configuringDevices.length})</option>
                  <option value="WAITING">Waiting Push ({waitingDevices.length})</option>
                  <option value="PUSHED">Already Pushed ({alreadyPushedDevices.length})</option>
                </select>
              </div>
            </div>

            {/* Row 2: Branch Filter on left, viewToggle in RED RECTANGLE on right! */}
            <div className="flex flex-wrap items-center justify-between gap-3 min-h-[42px]">
              <div className="flex-1 min-w-[220px] max-w-sm">
                <select
                  value={branchFilter}
                  onChange={(e) => setBranchFilter(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl text-xs font-normal border bg-white border-slate-200 text-zinc-800 focus:border-zinc-700 outline-none cursor-pointer shadow-2xs"
                >
                  <option value="ALL">All Branch Codes</option>
                  {branches.map((b) => (
                    <option key={b.code} value={b.code}>
                      Branch Code {b.code} — {b.name}
                    </option>
                  ))}
                </select>
              </div>
              {viewToggle && (
                <div className="flex items-center">
                  {viewToggle}
                </div>
              )}
            </div>

            {/* Row 3: CSV File Selection Modes Strip */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-slate-200/80 min-h-[36px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-500 inline-flex items-center gap-1.5">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-slate-500" />
                  <span>CSV File Selection</span>
                </span>
                {renderPushModeToggle(`${SHARED_LAYOUT_IDS.PUSH_MODE_PILL}-embedded`)}
              </div>

              {/* Clear filters & branch actions */}
              <div className="flex items-center gap-2">
                {branchFilter !== 'ALL' && filteredDevices.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      handleDownloadTeamFile({
                        staff: `Branch_${branchFilter}_Staff`,
                        branchId: branchFilter,
                        branchName: branches.find((b) => b.code === branchFilter)?.name || `Branch ${branchFilter}`,
                        devices: filteredDevices,
                      });
                    }}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 flex items-center gap-1.5 cursor-pointer shadow-2xs"
                    title="Download configuration file for this branch"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Open Branch File ({filteredDevices.length})</span>
                  </button>
                )}
                {(search || pushStatusFilter !== 'ALL' || branchFilter !== 'ALL') && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('');
                      setPushStatusFilter('ALL');
                      setBranchFilter('ALL');
                    }}
                    className="text-xs font-semibold text-rose-600 hover:text-rose-700 cursor-pointer px-2 py-1"
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
      {/* 1. HERO HEADER WITH LIVE PIPELINE STATS */}
      {lockType ? (
        /* (5 Nov 2026) Embedded in POS Terminal / Sound Box: sleek integrated summary matching Units & Material */
        <div className="flex flex-col gap-3.5">
          <div className={`flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl border shadow-2xs ${
            isLight ? 'bg-white border-slate-200/90' : 'bg-[#141822] border-slate-800'
          }`}>
            <div className="flex items-center gap-2.5">
              <div className={`p-2 rounded-xl ${isLight ? 'bg-sky-50 text-[#22577A]' : 'bg-sky-950 text-sky-400'}`}>
                <SendHorizontal className="w-4 h-4" />
              </div>
              <div>
                <h3 className={`text-sm font-bold flex items-center gap-2 ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  <span>Push Configuring Hub</span>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${isLight ? 'bg-slate-100 text-slate-700' : 'bg-slate-800 text-slate-300'}`}>
                    {lockType}
                  </span>
                </h3>
                <p className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Live queue for merchant setup. Alert field technicians and branch officers to power ON devices.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {onRefreshQueue && (
                <button
                  type="button"
                  onClick={handleManualRefreshQueue}
                  disabled={isRefreshingQueue}
                  className={`group relative inline-flex items-center gap-2 px-3 py-1.5 rounded-xl active:scale-[0.98] transition-all duration-150 font-bold text-xs border shadow-2xs cursor-pointer disabled:opacity-50 ${
                    isLight
                      ? 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200/90'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                  }`}
                  title="Refresh hardware configuring queue from database"
                >
                  <RotateCw
                    className={`w-3.5 h-3.5 ${isLight ? 'text-slate-600' : 'text-sky-300'} ${
                      isRefreshingQueue ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-300'
                    }`}
                  />
                  <span>Sync Queue</span>
                </button>
              )}
              {isAdminLike && onNotifyConfigReady && (
                <button
                  type="button"
                  disabled={configuringDevices.length === 0}
                  onClick={() => {
                    setPusherPassword('');
                    setPusherPasswordError('');
                    setIsPushAllModalOpen(true);
                  }}
                  className={`group relative inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl font-bold text-xs shadow-xs hover:shadow-sm active:scale-[0.98] transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border ${
                    isLight
                      ? 'bg-[#003857] hover:bg-[#002a42] text-white border-[#002a42]'
                      : 'bg-white hover:bg-slate-50 text-[#003857] border-white/90'
                  }`}
                  title="Push alerts to all devices (Requires Pusher Password verification)"
                >
                  <Lock
                    className={`w-3.5 h-3.5 shrink-0 group-hover:scale-110 transition-transform duration-150 ${
                      isLight ? 'text-white' : 'text-[#003857]'
                    }`}
                  />
                  <span className="tracking-tight font-bold">
                    {waitingDevices.length === 0 && configuringDevices.length > 0
                      ? 'Re-push All'
                      : 'Notify All Ready'}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 px-1.5 py-0.2 rounded-md text-[11px] font-mono font-bold ${
                      isLight
                        ? 'bg-white/20 text-white border border-white/30'
                        : 'bg-[#003857]/8 text-[#003857] border border-[#003857]/15'
                    }`}
                  >
                    {waitingDevices.length > 0 ? (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span>{waitingDevices.length} Waiting</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className={`w-3 h-3 ${isLight ? 'text-emerald-300' : 'text-emerald-600'}`} />
                        <span>{configuringDevices.length} Units</span>
                      </>
                    )}
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* Clean Integrated KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5">
            <button
              type="button"
              onClick={() => handleCardClick('WAITING')}
              className={`group p-3.5 rounded-2xl border transition-all duration-150 text-left cursor-pointer active:scale-[0.98] outline-none shadow-2xs ${
                pushStatusFilter === 'WAITING'
                  ? isLight
                    ? 'bg-white border-[#22577A] ring-2 ring-[#22577A]/30 shadow-sm'
                    : 'bg-slate-800 border-sky-400 ring-2 ring-sky-400/30 shadow-md'
                  : isLight
                    ? 'bg-white border-slate-200/90 hover:border-slate-300'
                    : 'bg-[#141822] border-slate-800 hover:border-slate-700'
              }`}
              title="Click to view table and filter waiting devices"
            >
              <div className={`text-[11px] font-semibold uppercase tracking-wider flex items-center justify-between ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
                <span>Total Waiting Push</span>
                <span className={`text-[10px] transition-colors ${isLight ? 'text-slate-400 group-hover:text-slate-700' : 'text-sky-300/70 group-hover:text-white'}`}>View Table ↓</span>
              </div>
              <div className={`text-2xl font-black mt-1 ${isLight ? 'text-slate-900' : 'text-white'}`}>{fmtNum(waitingDevices.length)}</div>
              <div className={`text-[10px] font-medium mt-0.5 truncate ${isLight ? 'text-slate-500' : 'text-sky-300'}`}>
                {alreadyPushedDevices.length > 0
                  ? `${fmtNum(alreadyPushedDevices.length)} already pushed (${fmtNum(configuringDevices.length)} total)`
                  : 'Click to view hardware queue'}
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleCardClick(lockType === 'POS Terminal' ? 'POS' : 'SB')}
              className={`group p-3.5 rounded-2xl border transition-all duration-150 text-left cursor-pointer active:scale-[0.98] outline-none shadow-2xs ${
                (lockType === 'POS Terminal' ? typeFilter === 'POS Terminal' : typeFilter === 'Sound Box')
                  ? isLight
                    ? 'bg-white border-[#22577A] ring-2 ring-[#22577A]/30 shadow-sm'
                    : 'bg-slate-800 border-[#22577A] ring-2 ring-[#22577A]/30 shadow-md'
                  : isLight
                    ? 'bg-white border-slate-200/90 hover:border-slate-300'
                    : 'bg-[#141822] border-slate-800 hover:border-slate-700'
              }`}
              title={`Click to view and filter ${lockType} in queue`}
            >
              <div className={`text-[11px] font-semibold uppercase tracking-wider flex items-center justify-between ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
                <span className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${lockType === 'POS Terminal' ? 'bg-[#22577A]' : 'bg-[#4F518C]'}`} />
                  {lockType === 'POS Terminal' ? 'POS Terminals' : 'Sound Boxes'}
                </span>
                <span className={`text-[10px] transition-colors ${isLight ? 'text-slate-400 group-hover:text-slate-700' : 'text-sky-300/70 group-hover:text-white'}`}>View Table ↓</span>
              </div>
              <div className={`text-2xl font-black mt-1 ${isLight ? 'text-slate-900' : 'text-white'}`}>
                {fmtNum(lockType === 'POS Terminal' ? posCount : sbCount)}
              </div>
              <div className={`text-[10px] font-medium mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>Under Configuring</div>
            </button>

            <button
              type="button"
              onClick={() => handleCardClick('ALL')}
              className={`group p-3.5 rounded-2xl border transition-all duration-150 text-left cursor-pointer active:scale-[0.98] outline-none shadow-2xs ${
                isLight
                  ? 'bg-white border-slate-200/90 hover:border-slate-300'
                  : 'bg-[#141822] border-slate-800 hover:border-slate-700'
              }`}
              title="Click to view all active teams in queue"
            >
              <div className={`text-[11px] font-semibold uppercase tracking-wider flex items-center justify-between ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
                <span className="flex items-center gap-1.5">
                  <Users className={`w-3.5 h-3.5 ${isLight ? 'text-slate-600' : 'text-sky-400'}`} />
                  Active Teams
                </span>
                <span className={`text-[10px] transition-colors ${isLight ? 'text-slate-400 group-hover:text-slate-700' : 'text-sky-300/70 group-hover:text-white'}`}>View Table ↓</span>
              </div>
              <div className={`text-2xl font-black mt-1 ${isLight ? 'text-slate-900' : 'text-white'}`}>{teamGroups.length}</div>
              <div className={`text-[10px] font-medium mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>Assigned branch teams</div>
            </button>
          </div>
        </div>
      ) : (
        <div
          className={`relative overflow-hidden rounded-3xl p-6 sm:p-8 border shadow-sm ${
            isLight
              ? 'bg-slate-100 border-slate-200/90 text-slate-900'
              : 'bg-[#161a24] border-slate-800 text-slate-100'
          }`}
        >
          <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="space-y-2 max-w-3xl">
              <h1 className={`text-2xl sm:text-3xl lg:text-[32px] font-extrabold tracking-tight flex items-center gap-3 ${isLight ? 'text-slate-900' : 'text-white'} leading-tight`}>
                <SendHorizontal className={`w-7 h-7 sm:w-8 sm:h-8 shrink-0 ${isLight ? 'text-[#003857]' : 'text-sky-300'}`} />
                <span>Push Configuring Hub</span>
              </h1>
              <p className={`text-sm sm:text-base leading-relaxed ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
                Live deployment queue for merchant setup. Alert field technicians and branch officers to power ON devices, connect to network, and wait for pushing the merchant application.
              </p>
            </div>

            {/* Quick Action Button for Entire Queue */}
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              {onRefreshQueue && (
                <button
                  type="button"
                  onClick={handleManualRefreshQueue}
                  disabled={isRefreshingQueue}
                  className={`group relative inline-flex items-center gap-2 px-3.5 py-2 rounded-xl active:scale-[0.98] transition-all duration-150 font-bold text-xs sm:text-sm border shadow-2xs cursor-pointer disabled:opacity-50 ${
                    isLight
                      ? 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200/90'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                  }`}
                  title="Refresh hardware configuring queue from database"
                >
                  <RotateCw
                    className={`w-3.5 h-3.5 ${isLight ? 'text-slate-600' : 'text-sky-300'} ${
                      isRefreshingQueue ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-300'
                    }`}
                  />
                  <span>Sync Queue</span>
                </button>
              )}
              {isAdminLike && onNotifyConfigReady && (
                <button
                  type="button"
                  disabled={configuringDevices.length === 0}
                  onClick={() => {
                    setPusherPassword('');
                    setPusherPasswordError('');
                    setIsPushAllModalOpen(true);
                  }}
                  className={`group relative inline-flex items-center gap-2.5 px-4 py-2 rounded-xl font-bold text-xs sm:text-sm shadow-sm hover:shadow-md active:scale-[0.98] transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border ${
                    isLight
                      ? 'bg-[#003857] hover:bg-[#002a42] text-white border-[#002a42]'
                      : 'bg-white hover:bg-slate-50 text-[#003857] border-white/90'
                  }`}
                  title="Push alerts to all devices (Requires Pusher Password verification)"
                >
                  <Lock
                    className={`w-4 h-4 shrink-0 group-hover:scale-110 transition-transform duration-150 ${
                      isLight ? 'text-white' : 'text-[#003857]'
                    }`}
                  />
                  <span className="tracking-tight font-bold">
                    {waitingDevices.length === 0 && configuringDevices.length > 0
                      ? 'Re-push All'
                      : 'Notify All Ready'}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-xs font-mono font-bold ${
                      isLight
                        ? 'bg-white/20 text-white border border-white/30'
                        : 'bg-[#003857]/8 text-[#003857] border border-[#003857]/15'
                    }`}
                  >
                    {waitingDevices.length > 0 ? (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span>
                          {waitingDevices.length} Waiting
                        </span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className={`w-3 h-3 ${isLight ? 'text-emerald-300' : 'text-emerald-600'}`} />
                        <span>
                          {configuringDevices.length} {configuringDevices.length === 1 ? 'Unit (Pushed)' : 'Units (Pushed)'}
                        </span>
                      </>
                    )}
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* KPI Mini-Cards (Clickable to view and filter queue table) */}
          <div className={`grid grid-cols-2 ${lockType ? 'sm:grid-cols-3' : 'sm:grid-cols-4'} gap-3 mt-6 pt-6 border-t ${isLight ? 'border-slate-200/90' : 'border-slate-800'}`}>
            <button
              type="button"
              onClick={() => handleCardClick('WAITING')}
              className={`group p-3.5 rounded-2xl border transition-all duration-150 text-left cursor-pointer active:scale-[0.98] outline-none ${
                pushStatusFilter === 'WAITING'
                  ? isLight
                    ? 'bg-white border-slate-400 ring-2 ring-slate-400/30 shadow-sm'
                    : 'bg-slate-800 border-sky-400 ring-2 ring-sky-400/30 shadow-md'
                  : isLight
                    ? 'bg-white border-slate-200/90 hover:border-slate-300 shadow-2xs'
                    : 'bg-slate-900/60 border-slate-800 hover:bg-slate-800 hover:border-slate-700'
              }`}
              title="Click to view table and filter waiting devices"
            >
              <div className={`text-[11px] font-semibold uppercase tracking-wider flex items-center justify-between ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
                <span>Total Waiting Push</span>
                <span className={`text-[10px] transition-colors ${isLight ? 'text-slate-400 group-hover:text-slate-700' : 'text-sky-300/70 group-hover:text-white'}`}>View Table ↓</span>
              </div>
              <div className={`text-2xl font-black mt-1 ${isLight ? 'text-slate-900' : 'text-white'}`}>{fmtNum(waitingDevices.length)}</div>
              <div className={`text-[10px] font-medium mt-0.5 truncate ${isLight ? 'text-slate-500' : 'text-sky-300'}`}>
                {alreadyPushedDevices.length > 0
                  ? `${fmtNum(alreadyPushedDevices.length)} already pushed (${fmtNum(configuringDevices.length)} total)`
                  : 'Click to view hardware queue'}
              </div>
            </button>

            {/* (5 Nov 2026) inside a product page only that product's card is shown */}
            {lockType !== 'Sound Box' && <button
              type="button"
              onClick={() => handleCardClick('POS')}
              className={`group p-3.5 rounded-2xl border transition-all duration-150 text-left cursor-pointer active:scale-[0.98] outline-none ${
                typeFilter === 'POS Terminal'
                  ? isLight
                    ? 'bg-white border-[#22577A] ring-2 ring-[#22577A]/30 shadow-sm'
                    : 'bg-slate-800 border-[#22577A] ring-2 ring-[#22577A]/30 shadow-md'
                  : isLight
                    ? 'bg-white border-slate-200/90 hover:border-slate-300 shadow-2xs'
                    : 'bg-slate-900/60 border-slate-800 hover:bg-slate-800 hover:border-slate-700'
              }`}
              title="Click to view and filter POS Terminals in queue"
            >
              <div className={`text-[11px] font-semibold uppercase tracking-wider flex items-center justify-between ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#22577A]" />
                  POS Terminals
                </span>
                <span className={`text-[10px] transition-colors ${isLight ? 'text-slate-400 group-hover:text-slate-700' : 'text-sky-300/70 group-hover:text-white'}`}>View Table ↓</span>
              </div>
              <div className={`text-2xl font-black mt-1 ${isLight ? 'text-slate-900' : 'text-white'}`}>{fmtNum(posCount)}</div>
              <div className={`text-[10px] font-medium mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>Under Configuring</div>
            </button>}

            {lockType !== 'POS Terminal' && <button
              type="button"
              onClick={() => handleCardClick('SB')}
              className={`group p-3.5 rounded-2xl border transition-all duration-150 text-left cursor-pointer active:scale-[0.98] outline-none ${
                typeFilter === 'Sound Box'
                  ? isLight
                    ? 'bg-white border-purple-400 ring-2 ring-purple-400/30 shadow-sm'
                    : 'bg-slate-800 border-purple-400 ring-2 ring-purple-400/30 shadow-md'
                  : isLight
                    ? 'bg-white border-slate-200/90 hover:border-slate-300 shadow-2xs'
                    : 'bg-slate-900/60 border-slate-800 hover:bg-slate-800 hover:border-slate-700'
              }`}
              title="Click to view and filter Sound Boxes in queue"
            >
              <div className={`text-[11px] font-semibold uppercase tracking-wider flex items-center justify-between ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#4F518C]" />
                  Sound Boxes
                </span>
                <span className={`text-[10px] transition-colors ${isLight ? 'text-slate-400 group-hover:text-slate-700' : 'text-sky-300/70 group-hover:text-white'}`}>View Table ↓</span>
              </div>
              <div className={`text-2xl font-black mt-1 ${isLight ? 'text-slate-900' : 'text-white'}`}>{fmtNum(sbCount)}</div>
              <div className={`text-[10px] font-medium mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>Under Configuring</div>
            </button>}

            <button
              type="button"
              onClick={() => handleCardClick('ALL')}
              className={`group p-3.5 rounded-2xl border transition-all duration-150 text-left cursor-pointer active:scale-[0.98] outline-none ${
                isLight
                  ? 'bg-white border-slate-200/90 hover:border-slate-300 shadow-2xs'
                  : 'bg-slate-900/60 border-slate-800 hover:bg-slate-800 hover:border-slate-700'
              }`}
              title="Click to view all active teams in queue"
            >
              <div className={`text-[11px] font-semibold uppercase tracking-wider flex items-center justify-between ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
                <span className="flex items-center gap-1.5">
                  <Users className={`w-3.5 h-3.5 ${isLight ? 'text-slate-600' : 'text-sky-400'}`} />
                  Active Teams
                </span>
                <span className={`text-[10px] transition-colors ${isLight ? 'text-slate-400 group-hover:text-slate-700' : 'text-sky-300/70 group-hover:text-white'}`}>View Table ↓</span>
              </div>
              <div className={`text-2xl font-black mt-1 ${isLight ? 'text-slate-900' : 'text-white'}`}>{teamGroups.length}</div>
              <div className={`text-[10px] font-medium mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>Assigned branch teams</div>
            </button>
          </div>
        </div>
      )}

      {/* 3. FILTER & SEARCH TOOLBAR */}
      <div className={`p-4 rounded-2xl border shadow-xs space-y-3 ${isLight ? 'bg-white border-slate-200/90' : 'bg-[#141822] border-slate-800'}`}>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Search Bar */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search Push ID (PUSH-...), serial, MID, TID, staff, date..."
              className={`w-full pl-9 pr-3 py-2 rounded-xl text-xs border outline-none transition-all duration-150 ${
                isLight
                  ? 'border-slate-200 bg-slate-50 text-zinc-900 focus:bg-white focus:border-[#003857]'
                  : 'border-slate-700 bg-[#0f121a] text-slate-100 focus:border-sky-400'
              }`}
            />
          </div>

          {/* Filters & Push Mode Toggle */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Push Mode Selector */}
            {renderPushModeToggle(SHARED_LAYOUT_IDS.PUSH_MODE_PILL)}

            {!lockType && <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className={`px-3 py-2 rounded-xl text-xs font-normal border outline-none cursor-pointer transition-all duration-150 ${
                isLight ? 'border-slate-200 bg-slate-50 text-zinc-800' : 'border-slate-700 bg-[#0f121a] text-slate-200'
              }`}
            >
              <option value="ALL">All Device Types</option>
              <option value="POS Terminal">POS Terminal</option>
              <option value="Sound Box">Sound Box</option>
            </select>}

            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className={`px-3 py-2 rounded-xl text-xs font-normal border outline-none cursor-pointer transition-all duration-150 ${
                isLight ? 'border-slate-200 bg-slate-50 text-zinc-800' : 'border-slate-700 bg-[#0f121a] text-slate-200'
              }`}
            >
              <option value="ALL">All Branches</option>
              {branches.map((b) => (
                <option key={b.code} value={b.code}>
                  Code {b.code} ({b.name})
                </option>
              ))}
            </select>

            {(search || (!lockType && typeFilter !== 'ALL') || branchFilter !== 'ALL' || pushStatusFilter !== 'ALL') && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setTypeFilter('ALL');
                  setBranchFilter('ALL');
                  setPushStatusFilter('ALL');
                }}
                className="px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer active:scale-[0.97] transition-all duration-150"
              >
                Clear Filters
              </button>
            )}
          </div>
        </div>

        {/* Branch Queue Quick Action: Send 1 File + Alert to Branch instead of 10 pop-ups */}
        {branchFilter !== 'ALL' && filteredDevices.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300">
              <Building2 className="w-4 h-4 text-[#003857] dark:text-sky-400 shrink-0" />
              <span>
                Branch Code {branchFilter} ({branches.find((b) => b.code === branchFilter)?.name || `Branch ${branchFilter}`}):{' '}
                <strong className="text-zinc-900 dark:text-white">{filteredDevices.length} Units to Config</strong>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  handleDownloadTeamFile({
                    staff: `Branch_${branchFilter}_Staff`,
                    branchId: branchFilter,
                    branchName: branches.find((b) => b.code === branchFilter)?.name || `Branch ${branchFilter}`,
                    devices: filteredDevices,
                  });
                }}
                className="px-3 py-1.5 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer shadow-2xs"
                title="Download and open configuration file for all devices in this branch"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Open Branch File ({filteredDevices.length})</span>
              </button>
              {isAdminLike && onNotifyConfigReady && (() => {
                const branchKey = `Branch_${branchFilter}`;
                const branchSerials = filteredDevices.map((d) => d.serial);
                const isBranchCooldown = getTeamCooldownSecs(branchKey) > 0;
                const isBranchAllPushed = filteredDevices.length > 0 && filteredDevices.every((d) => isDevicePushed(d.serial, d));

                if (isBranchCooldown) {
                  return (
                    <button
                      type="button"
                      disabled
                      className="px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 cursor-not-allowed opacity-90 shadow-2xs"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      <span>Queue &amp; File Sent · {getTeamCooldownSecs(branchKey)}s</span>
                    </button>
                  );
                }

                if (isBranchAllPushed) {
                  return (
                    <button
                      type="button"
                      onClick={() => handleTeamPushClick(branchKey, branchSerials)}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all duration-150 cursor-pointer flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/60 dark:text-emerald-300 border border-emerald-300/80 dark:border-emerald-700/60 shadow-2xs active:scale-[0.98]"
                      title="Re-push alert & file for this branch"
                    >
                      <RotateCw className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>Re-push Branch ({filteredDevices.length})</span>
                    </button>
                  );
                }

                return (
                  <button
                    type="button"
                    onClick={() => handleTeamPushClick(branchKey, branchSerials)}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all duration-150 cursor-pointer flex items-center gap-1.5 bg-[#003857] hover:bg-[#002a42] text-white shadow-2xs active:scale-[0.98]"
                    title="Sends 1 single Telegram notification with attached file for this branch"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Send Branch Alert &amp; File ({filteredDevices.length})</span>
                  </button>
                );
              })()}
            </div>
          </div>
        )}
      </div>

        </>
      )}
      {/* 4. HARDWARE QUEUE TABLE WITH DATE & TIME OF REQUEST PUSH */}
      <div ref={tableRef} className={`${cardClass} border border-slate-200/90 dark:border-slate-800 rounded-xl overflow-hidden scroll-mt-6`}>
        <div className="p-3.5 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-black uppercase tracking-wider text-[#003857] dark:text-sky-400">
              Queue Ready for App Push
            </span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${isLight ? 'bg-slate-100 text-slate-700 border border-slate-200' : 'bg-slate-800 text-slate-300 border border-slate-700'}`}>
              {filteredWaitingCount > 0
                ? `${filteredWaitingCount} waiting · ${filteredDevices.length} total`
                : `${filteredDevices.length} total (all pushed)`}
            </span>
            {selectedSns.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-sky-50 text-sky-700 border border-sky-200">
                {selectedSns.length} selected
              </span>
            )}
          </div>
          <div className="flex items-center gap-2.5">
            <div className="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:block">
              Assigned By: <strong className={isLight ? 'text-zinc-900' : 'text-white'}>{operatorLabel}</strong>
            </div>
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={filteredDevices.length === 0}
              className="btn btn-secondary"
              title="Export Push Queue Table to CSV (matching table columns)"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto overflow-y-hidden">
          <table className="data-table min-w-[960px]">
            <thead className="glass-table-thead">
              <tr>
                <th className="w-12 text-center p-0">
                  <button
                    type="button"
                    onClick={handleToggleSelectAll}
                    className="w-full h-full min-h-[34px] flex items-center justify-center py-1 px-2 text-white cursor-pointer hover:bg-white/10 transition-colors focus:outline-none"
                    title={
                      selectedSns.length === filteredDevices.length && filteredDevices.length > 0
                        ? 'Unselect all in queue'
                        : 'Select all in queue (or Shift+Click rows for range)'
                    }
                    aria-label="Select all in queue"
                  >
                    <div
                      className={`w-4.5 h-4.5 rounded-[4px] border-[1.5px] flex items-center justify-center transition-all duration-150 ${
                        selectedSns.length === filteredDevices.length && filteredDevices.length > 0
                          ? 'bg-white border-white text-[#003857] shadow-xs scale-105'
                          : selectedSns.length > 0
                          ? 'bg-white/20 border-white text-white shadow-xs'
                          : 'bg-white/10 border-white/60 hover:border-white hover:bg-white/20 shadow-2xs'
                      }`}
                    >
                      {selectedSns.length === filteredDevices.length && filteredDevices.length > 0 ? (
                        <Check className="w-3 h-3 text-[#003857] stroke-[3]" />
                      ) : selectedSns.length > 0 ? (
                        <Minus className="w-3 h-3 text-white stroke-[3]" />
                      ) : null}
                    </div>
                  </button>
                </th>
                <th>Tracking ID</th>
                <th>Date &amp; Time</th>
                <th>Serial &amp; Model</th>
                <th>Merchant Name &amp; MID</th>
                <th>Configure By (Staff)</th>
                <th>Branch</th>
                <th>Assigned By</th>
                <th className="text-right col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredDevices.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <Boxes className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="cell-main">No devices in Push Configuring queue</p>
                    <p className="cell-sub">
                      {search || typeFilter !== 'ALL' || branchFilter !== 'ALL'
                        ? 'Try clearing the search filters above.'
                        : 'When an admin configures a merchant profile on a device, it will appear here.'}
                    </p>
                  </td>
                </tr>
              ) : (
                pageDevices.map((dev, i) => {
                  const index = pg.start + i;                      // position in the whole list (Shift+Click ranges)
                  const isSelected = selectedSet.has(dev.serial);
                  const isPos = dev.type === 'POS Terminal';
                  const bObj = branches.find((b) => b.code === dev.branchId);
                  const bName = bObj ? bObj.name : (dev.branchName || `Branch ${dev.branchId}`);
                  const staffName = dev.staff || dev.installedByStaff || 'Assigned Branch Staff';
                  const assignedBy = getAssignedBy(dev);
                  const requestPushInfo = getRequestPushDateTime(dev);
                  const devPushId = getDevicePushId(dev);

                  return (
                    <tr
                      key={dev.serial}
                      className={`interactive-row ${isSelected ? '!bg-sky-50/70' : ''}`}
                    >
                      <td
                        className="w-12 text-center p-0 cursor-pointer select-none"
                        onClick={(e) => handleToggleSelectOne(dev.serial, index, e)}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleSelectOne(dev.serial, index, e);
                          }}
                          className="w-full h-full min-h-[46px] flex items-center justify-center p-2 cursor-pointer hover:bg-slate-200/50 dark:hover:bg-slate-700/50 transition-colors focus:outline-none"
                          title={isSelected ? 'Unselect serial (or Shift+Click for range)' : 'Select serial (or Shift+Click for range)'}
                          aria-label={`Select ${dev.serial}`}
                        >
                          <div
                            className={`w-5 h-5 rounded-[5px] border-2 flex items-center justify-center transition-all duration-150 ${
                              isSelected
                                ? 'bg-[#003857] border-[#003857] text-white shadow-xs scale-105'
                                : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-500 hover:border-[#003857] dark:hover:border-slate-300 shadow-2xs'
                            }`}
                          >
                            {isSelected && <Check className="w-3.5 h-3.5 text-white stroke-[3]" />}
                          </div>
                        </button>
                      </td>

                      {/* Push Tracking ID */}
                      <td className="whitespace-nowrap">
                        {devPushId ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopyPushId(devPushId);
                              }}
                              className="serial-btn font-mono"
                              title={`Tracking ID: #${devPushId} (Click to copy)`}
                            >
                              #{devPushId}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopyPushId(devPushId);
                              }}
                              className="p-1 rounded-md text-slate-400 hover:text-[#003857] hover:bg-slate-100 transition cursor-pointer"
                              title="Copy Tracking ID"
                            >
                              {copiedPushId === devPushId ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        ) : (
                          <span className="chip chip-slate">Pending Push</span>
                        )}
                      </td>

                      {/* Date & Time */}
                      <td className="whitespace-nowrap">
                        <div className="cell-mono">{requestPushInfo.date}</div>
                        <div className="cell-mono-sub">{requestPushInfo.time}</div>
                      </td>

                      {/* Serial & Model */}
                      <td className="whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              isPos ? 'bg-[#22577A]' : 'bg-[#4F518C]'
                            }`}
                            title={dev.type}
                          />
                          <span className="cell-mono font-normal text-slate-700 dark:text-slate-300">{dev.serial}</span>
                        </div>
                        <div className="cell-sub pl-3.5">
                          {dev.type} {dev.model ? `· ${dev.model}` : ''}
                        </div>
                      </td>

                      {/* Merchant Name & MID */}
                      <td>
                        <div className={`cell-main max-w-[200px] truncate ${hasKhmer(dev.merchantName) ? 'khmer' : ''}`} title={dev.merchantName || 'Merchant Profile Pending'}>
                          {dash(dev.merchantName)}
                        </div>
                        <div className="cell-mono-sub truncate">
                          MID: {dev.mid || '—'}
                        </div>
                      </td>

                      {/* Configure By (Staff) */}
                      <td>
                        <div className={`cell-main font-medium max-w-[190px] truncate ${hasKhmer(staffName) ? 'khmer' : ''}`} title={staffName}>
                          {staffName}
                        </div>
                        <div className="cell-sub max-w-[190px] truncate">
                          {userTelegramMap.get(staffName.toLowerCase().trim())
                            ? `@${userTelegramMap.get(staffName.toLowerCase().trim())}`
                            : 'Field Technician'}
                        </div>
                      </td>

                      {/* Branch */}
                      <td>
                        <div className="cell-main">Code {dev.branchId} · {formatBranchName(bName)}</div>
                        <div className="cell-sub text-sky-700 flex items-center gap-1 mt-0.5">
                          <Send className="w-2.5 h-2.5 text-sky-600 shrink-0" />
                          <span className="truncate max-w-[150px]">{resolveTelegramChatForBranch(dev.branchId, regionalGroups, branches).groupName}</span>
                        </div>
                      </td>

                      {/* Assigned By */}
                      <td>
                        <div className="cell-main flex items-center gap-1.5 truncate max-w-[170px]" title={assignedBy}>
                          <ShieldCheck className="w-3.5 h-3.5 text-[#003857] shrink-0" />
                          <span className="truncate">{assignedBy}</span>
                        </div>
                        <div className="cell-sub pl-5">Authorizing Admin</div>
                      </td>

                      {/* Row Actions */}
                      <td className="text-right col-actions">
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          {isAdminLike && (() => {
                            const devIsPushed = isDevicePushed(dev.serial, dev);
                            const cooldownSecs = getRowCooldownSecs(dev.serial);

                            if (cooldownSecs > 0) {
                              return (
                                <span className="chip chip-green opacity-80" title={`Pushed to Telegram! ${cooldownSecs}s cooldown active`}>
                                  <RotateCw className="w-3 h-3 text-emerald-500 animate-spin" />
                                  <span>Pushed · ${cooldownSecs}s</span>
                                </span>
                              );
                            }

                            if (devIsPushed) {
                              return (
                                <button
                                  type="button"
                                  onClick={() => handleRowPushClick(dev)}
                                  className="chip chip-green hover:!bg-emerald-100 cursor-pointer transition active:scale-95 group"
                                  title={`Status: Pushed to Telegram (${requestPushInfo.full}). Click to repush.`}
                                >
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600 group-hover:hidden" />
                                  <RotateCw className="w-3 h-3 text-emerald-700 hidden group-hover:inline group-hover:rotate-180 transition-transform duration-300" />
                                  <span className="group-hover:hidden">Pushed</span>
                                  <span className="hidden group-hover:inline">Repush</span>
                                </button>
                              );
                            }

                            return (
                              <button
                                type="button"
                                onClick={() => handleRowPushClick(dev)}
                                className="row-btn !text-sky-700 !bg-sky-50 !border-sky-200 hover:!bg-sky-600 hover:!text-white active:scale-95"
                                title="Device configured and ready. Click to push now or select checkbox for batch."
                              >
                                Push Now
                              </button>
                            );
                          })()}

                          {onSelectDevice && (
                            <button
                              type="button"
                              onClick={() => onSelectDevice(dev.serial)}
                              className="row-btn"
                              title="Manage device profile or complete deployment"
                            >
                              Manage
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <Pager pg={pg} label="units" />
      </div>

      {/* 5. FLOATING BATCH ACTION BAR WHEN ITEMS ARE CHECKED (Sleek System Design Language) */}
      <AnimatePresence>
        {selectedSns.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={{ type: 'spring', damping: 32, stiffness: 480, mass: 0.6 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-2xl bg-[#002238]/95 dark:bg-[#0c121e]/95 text-white shadow-2xl border border-white/15 dark:border-slate-700/80 backdrop-blur-xl flex items-center gap-2.5 sm:gap-3 max-w-[95vw] overflow-x-auto ring-1 ring-black/20"
          >
            {/* Selection Count Pill */}
            <div className="flex items-center gap-2 pr-2.5 border-r border-white/15 shrink-0">
              <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-sky-400/20 text-sky-300 font-mono text-xs font-black border border-sky-400/30">
                {selectedSns.length}
              </span>
              <span className="text-xs font-bold text-white whitespace-nowrap hidden sm:inline">
                {selectedSns.length === 1 ? 'Unit Selected' : 'Units Selected'}
              </span>
            </div>

            {/* Middle Controls */}
            <div className="flex items-center gap-2 shrink-0">
              {isAdminLike && onAssignStaff && (
                <div className="relative shrink-0">
                  <select
                    onChange={(e) => {
                      if (e.target.value) {
                        onAssignStaff(selectedSns, e.target.value);
                        setSelectedSns([]);
                      }
                    }}
                    defaultValue=""
                    aria-label="Assign to Staff"
                    className="w-36 sm:w-44 px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-normal text-white outline-none cursor-pointer truncate transition"
                  >
                    <option value="" disabled className="bg-slate-900 text-slate-300">Assign to Staff...</option>
                    {users.filter(u => u.status !== 'Suspended').map((u) => (
                      <option key={u.uid} value={u.name} className="bg-slate-900 text-white font-medium">
                        {u.name} (Code {u.branchId}){u.telegramUsername ? ` · @${u.telegramUsername.replace(/^@/, '')}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <button
                type="button"
                onClick={handleDownloadSelectedFile}
                className="px-3 py-1.5 rounded-xl border border-white/15 bg-white/10 hover:bg-white/15 text-xs font-bold text-white flex items-center gap-1.5 cursor-pointer active:scale-[0.98] transition shrink-0"
                title="Download & view CSV configuration file for selected devices"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="hidden sm:inline">Open File</span>
                <span className="sm:hidden">File</span>
                <span className="font-mono text-[11px] opacity-80">({selectedSns.length})</span>
              </button>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-1.5 ml-auto shrink-0">
              {isAdminLike && onNotifyConfigReady && (() => {
                const isBatchCooldown = getBatchCooldownSecs() > 0;
                const isBatchAllPushed = selectedSns.length > 0 && selectedSns.every((sn) => isDevicePushed(sn));

                if (isBatchCooldown) {
                  return (
                    <button
                      type="button"
                      disabled
                      className="px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 cursor-not-allowed opacity-90 shadow-2xs shrink-0"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>Sent · {getBatchCooldownSecs()}s</span>
                    </button>
                  );
                }

                return (
                  <button
                    type="button"
                    onClick={handleBatchPushClick}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all duration-150 cursor-pointer flex items-center gap-1.5 active:scale-[0.98] shadow-md shrink-0 ${
                      isBatchAllPushed
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                        : pushMode === 'total_csv_all'
                        ? 'bg-teal-600 hover:bg-teal-500 text-white'
                        : pushMode === 'total_csv'
                        ? 'bg-emerald-500 hover:bg-emerald-400 text-white'
                        : 'bg-sky-500 hover:bg-sky-400 text-white'
                    }`}
                    title={
                      isBatchAllPushed
                        ? 'Selected devices already pushed. Click to re-push'
                        : pushMode === 'total_csv_all'
                        ? 'Send 1 combined master CSV file for all staff members containing all selected devices'
                        : pushMode === 'total_csv'
                        ? 'Send consolidated Total CSV file per staff member with all their selected devices'
                        : 'Send single-unit text alerts for selected devices'
                    }
                  >
                    {isBatchAllPushed ? (
                      <>
                        <RotateCw className="w-3.5 h-3.5 text-white shrink-0" />
                        <span>Re-push ({selectedSns.length})</span>
                      </>
                    ) : (
                      <>
                        {pushMode === 'total_csv_all' || pushMode === 'total_csv' ? (
                          <FileSpreadsheet className="w-3.5 h-3.5 text-white shrink-0" />
                        ) : (
                          <Send className="w-3.5 h-3.5 shrink-0" />
                        )}
                        <span>
                          {pushMode === 'total_csv_all'
                            ? `Push All in 1 CSV (${selectedSns.length})`
                            : pushMode === 'total_csv'
                            ? `Push Total CSV (${selectedSns.length})`
                            : `Push Alerts (${selectedSns.length})`}
                        </span>
                      </>
                    )}
                  </button>
                );
              })()}

              <button
                type="button"
                onClick={() => setSelectedSns([])}
                className="p-1.5 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition-all cursor-pointer shrink-0 ml-0.5"
                title="Cancel selection"
                aria-label="Cancel selection"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 6. PUSH TO ALL PASSWORD/PIN VERIFICATION MODAL (Portaled with blur backdrop matching WorkflowModal) */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {isPushAllModalOpen && (
              <div className="fixed inset-0 z-[9999] flex justify-end overflow-hidden">
                {/* Backdrop with true background blur covering entire viewport */}
                <motion.div
                  variants={BACKDROP_VARIANTS}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  onClick={() => {
                    setIsPushAllModalOpen(false);
                    setPusherPassword('');
                    setPusherPasswordError('');
                  }}
                  className="fixed inset-0 bg-slate-950/55 will-change-[opacity]"
                />

                {/* Clean, Modern Slide-over Drawer */}
                <motion.div
                  variants={DRAWER_VARIANTS}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className={`relative w-full sm:max-w-[560px] md:max-w-[580px] h-full shadow-2xl z-10 flex flex-col my-0 overflow-hidden transform-gpu will-change-gpu gpu-modal-container rounded-l-lg ${
                    isLight ? 'bg-white text-slate-900' : 'bg-[#12151e] text-slate-100'
                  }`}
                >
                  {/* Clean Signature Navy Header Bar */}
                  <div className="navy-header-bar rounded-tl-lg px-6 py-4 flex items-center shrink-0 justify-between text-white border-b border-white/10 shrink-0">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center shrink-0 shadow-xs text-sky-300">
                        <Lock className="w-4.5 h-4.5" />
                      </div>
                      <div>
                        <h3 className="text-base font-extrabold text-white tracking-tight flex items-center gap-2">
                          <span>Confirm Telegram Broadcast</span>
                        </h3>
                        <p className="text-xs text-slate-200/90 font-medium mt-0.5">
                          Authorize deployment alert to branch technician groups
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsPushAllModalOpen(false);
                        setPusherPassword('');
                        setPusherPasswordError('');
                      }}
                      aria-label="Close"
                      className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition cursor-pointer shrink-0 ml-2"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Form & Modal Body */}
                  <form onSubmit={handleConfirmPushAllWithPassword} className="flex flex-col flex-1 overflow-hidden">
                    <div className="p-6 overflow-y-auto max-h-[70vh] space-y-4 text-xs">
                      {/* Metric Summary Grid */}
                      <div className="grid grid-cols-3 gap-2.5">
                        <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/60 flex flex-col">
                          <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Total Devices</span>
                          <span className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5 mt-1">
                            <SendHorizontal className="w-3.5 h-3.5 text-[#22577A]" />
                            {configuringDevices.length} {configuringDevices.length === 1 ? 'Unit' : 'Units'}
                          </span>
                          <span className="text-[10px] text-slate-500 mt-0.5">
                            {configuringDevices.filter((d) => d.type === 'POS Terminal').length} POS · {configuringDevices.filter((d) => d.type === 'Sound Box').length} Sound Box
                          </span>
                        </div>

                        <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/60 flex flex-col">
                          <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Branch Teams</span>
                          <span className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5 mt-1">
                            <Building2 className="w-3.5 h-3.5 text-indigo-500" />
                            {teamGroups.length} {teamGroups.length === 1 ? 'Team' : 'Teams'}
                          </span>
                          <span className="text-[10px] text-slate-500 mt-0.5 truncate" title={Array.from(new Set(configuringDevices.map((d) => `Code ${d.branchId}`))).join(', ')}>
                            {Array.from(new Set(configuringDevices.map((d) => `Code ${d.branchId}`))).slice(0, 3).join(', ')}
                            {new Set(configuringDevices.map((d) => d.branchId)).size > 3 ? '…' : ''}
                          </span>
                        </div>

                        <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/60 flex flex-col">
                          <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Alert Channel</span>
                          <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 mt-1">
                            <Users className="w-3.5 h-3.5" />
                            Telegram
                          </span>
                          <span className="text-[10px] text-slate-500 mt-0.5 truncate">
                            Field Technicians
                          </span>
                        </div>
                      </div>

                      {/* Clean Info Note */}
                      <div className="flex items-start gap-2.5 p-3 rounded-2xl bg-slate-100/70 dark:bg-slate-800/30 text-slate-600 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/40 text-[11px] leading-relaxed">
                        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                        <span>
                          Broadcasts configuration instructions to assigned branch Telegram groups so field technicians can power on and stage units.
                        </span>
                      </div>

                      {/* Operator Badge */}
                      <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/60 flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-xl bg-[#003857]/10 dark:bg-sky-500/15 flex items-center justify-center text-[#003857] dark:text-sky-300 shrink-0 font-bold">
                            <User className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                              Active Operator
                            </div>
                            <div className="text-xs font-extrabold text-slate-900 dark:text-white">
                              {operatorLabel}
                            </div>
                          </div>
                        </div>
                        <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600 shadow-2xs">
                          Authorized Admin
                        </span>
                      </div>

                      {/* PIN Input Field */}
                      <div className="flex flex-col gap-1.5 pt-1">
                        <div className="flex items-center justify-between">
                          <label
                            htmlFor="pusher_auth_pin_input"
                            className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200"
                          >
                            <KeyRound className="w-3.5 h-3.5 text-slate-500" />
                            <span>Employee PIN or Password</span>
                            <span className="text-rose-500 font-bold">*</span>
                          </label>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {operatorLabel.match(/\((\d+)\)/)?.[1] ? `Employee ID (${operatorLabel.match(/\((\d+)\)/)![1]})` : 'Employee ID'}
                          </span>
                        </div>

                        <div className="relative">
                          <input
                            id="pusher_auth_pin_input"
                            name="pusher_security_pin_field"
                            type={showPusherPassword ? 'text' : 'password'}
                            autoComplete="new-password"
                            autoCorrect="off"
                            autoCapitalize="off"
                            spellCheck={false}
                            data-form-type="other"
                            data-lpignore="true"
                            data-1p-ignore="true"
                            data-bwignore="true"
                            autoFocus
                            value={pusherPassword}
                            onChange={(e) => {
                              setPusherPassword(e.target.value);
                              if (pusherPasswordError) setPusherPasswordError('');
                            }}
                            placeholder="Enter Employee ID or Security PIN to confirm..."
                            className={`w-full pl-3.5 pr-10 py-2.5 rounded-xl text-xs font-mono font-medium border outline-none transition shadow-2xs ${
                              pusherPasswordError
                                ? 'border-rose-500 focus:border-rose-500 bg-rose-50/40 text-rose-900 dark:text-rose-200'
                                : isLight
                                ? 'bg-white hover:bg-slate-50/50 border-slate-200 text-slate-900 focus:ring-2 focus:ring-[#003857]/10 focus:border-[#003857]'
                                : 'bg-[#121620] hover:bg-[#181d2a] border-slate-700 text-white focus:ring-2 focus:ring-sky-500/20 focus:border-sky-400'
                            }`}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPusherPassword(!showPusherPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer p-1"
                            aria-label={showPusherPassword ? 'Hide PIN' : 'Show PIN'}
                          >
                            {showPusherPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>

                        {pusherPasswordError && (
                          <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 text-[11px] font-semibold flex items-center gap-1.5 mt-0.5">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-500" />
                            <span>{pusherPasswordError}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Footer Actions Strip */}
                    <div
                      className={`px-6 py-3.5 flex items-center justify-between text-xs border-t shrink-0 ${
                        isLight ? 'bg-slate-50 border-slate-200/90' : 'bg-[#0f121a] border-slate-800'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setIsPushAllModalOpen(false);
                          setPusherPassword('');
                          setPusherPasswordError('');
                        }}
                        className={`px-4 py-2.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                          isLight
                            ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300 shadow-2xs'
                            : 'bg-[#181c26] hover:bg-[#202534] text-slate-300 border-slate-700 shadow-2xs'
                        }`}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={isVerifyingPusher || !pusherPassword.trim()}
                        className="px-5 py-2.5 rounded-xl text-xs font-bold bg-[#003857] hover:bg-[#002a42] text-white shadow-xs active:scale-[0.98] transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed border border-white/10"
                      >
                        {isVerifyingPusher ? (
                          <>
                            <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            <span>Verifying…</span>
                          </>
                        ) : (
                          <>
                            <ShieldCheck className="w-4 h-4 text-sky-400" />
                            <span>Authorize &amp; Push All ({configuringDevices.length})</span>
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body
        )}


    </div>
  );
});

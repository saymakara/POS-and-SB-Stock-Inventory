import { csvFile } from '../utils/csv';
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Device, Branch, UserRole, ThemeMode, TelegramRegionalGroup, User as AppUser } from '../types';
import { resolveTelegramChatForBranch } from '../utils/errorLogger';
import { generatePushTrackingId } from '../utils/telegram';
import { normalizeStaffName, resolveStaffFromDirectory } from '../utils/staffUtils';
import { todayPP, stampSecPP, clockPP } from '../utils/time';
import { motion, AnimatePresence } from 'motion/react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import {
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
  Calendar,
  Clock,
  KeyRound,
  User,
  FileSpreadsheet,
  CheckCircle2,
  RotateCw,
  Copy,
  Check,
} from 'lucide-react';

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
}

export const PushConfiguringTab: React.FC<PushConfiguringTabProps> = React.memo(({
  devices,
  branches,
  role = 'SUPER_ADMIN',
  operatorLabel = 'System Admin',
  onNotifyConfigReady,
  onSelectDevice,
  onCompleteDeployment,
  onReturnToReserve,
  onAssignStaff,
  regionalGroups,
  theme = 'light',
  users = [],
  pushedSerials,
  onMarkPushed,
}) => {
  const isLight = theme === 'light';
  const isAdminLike = role === 'SUPER_ADMIN' || role === 'ADMIN';

  // 1. Filter only devices in CONFIGURING stage
  const configuringDevices = useMemo(() => {
    return devices.filter((d) => d.stage === 'CONFIGURING');
  }, [devices]);

  // 2. Local filter states
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
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
    if (pushedSerials && pushedSerials.size > 0) {
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
    let trackingChanged = false;
    let serialsChanged = false;
    let timestampsChanged = false;

    setPushTrackingMap((prev) => {
      const next = { ...prev };
      devices.forEach((d) => {
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
      devices.forEach((d) => {
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
      devices.forEach((d) => {
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
    return (
      Boolean(dev?.pushTrackingId) ||
      Boolean(dev?.pushDate) ||
      Boolean(pushedSerials?.has(serial)) ||
      Boolean(pushedSerialsLocal.has(serial)) ||
      Boolean(pushTimestamps[serial])
    );
  }, [devices, pushedSerials, pushedSerialsLocal, pushTimestamps]);

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
    const q = search.trim().toLowerCase();
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
  }, [configuringDevices, search, branchFilter, typeFilter, pushStatusFilter, isDevicePushed, getDevicePushId]);

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

  const handleToggleSelectOne = (sn: string) => {
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

  const handleBatchPushClick = (forceCsv = true) => {
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

  const executePushAll = (forceCsv = true) => {
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
      'Merchant Name & MID / TID',
      'Configure By (Staff)',
      'Assigned By',
      'Branch',
    ];
    const rows = filteredDevices.map((dev, idx) => {
      const bObj = branches.find((b) => b.code === dev.branchId);
      const bName = bObj ? bObj.name : (dev.branchName || `Branch ${dev.branchId}`);
      const devPushId = getDevicePushId(dev) || 'Pending Push';
      const reqInfo = getRequestPushDateTime(dev);
      const serialModel = `${dev.serial} (${dev.model || dev.type})`;
      const merchantMidTid = `${dev.merchantName || '—'} · MID: ${dev.mid || '—'} / TID: ${dev.tid || '—'}`;
      const staffName = resolveStaffFromDirectory(dev.staff || dev.installedByStaff, dev.branchId, users) || 'Assigned Branch Staff';
      const assignedBy = getAssignedBy(dev);
      const branchDisplay = `${dev.branchId} · ${bName.replace(' Branch', '')}`;

      return [
        String(idx + 1),
        devPushId,
        reqInfo.full,
        serialModel,
        merchantMidTid,
        staffName,
        assignedBy,
        branchDisplay,
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
      'Merchant Name & MID / TID',
      'Configure By (Staff)',
      'Assigned By',
      'Branch Code',
      'Branch Name',
      'Action Required',
    ];
    const rows = tg.devices.map((dev, idx) => {
      const bObj = branches.find((b) => b.code === dev.branchId);
      const bName = bObj ? bObj.name : (dev.branchName || `Branch ${dev.branchId}`);
      const devPushId = getDevicePushId(dev) || 'Pending Push';
      const reqInfo = getRequestPushDateTime(dev);
      const serialModel = `${dev.serial} (${dev.model || dev.type})`;
      const merchantMidTid = `${dev.merchantName || '—'} · MID: ${dev.mid || '—'} / TID: ${dev.tid || '—'}`;
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
        dev.branchId,
        bName,
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
      'Merchant Name & MID / TID',
      'Configure By (Staff)',
      'Assigned By',
      'Branch Code',
      'Branch Name',
      'Action Required',
    ];
    const rows = selectedDevices.map((dev, idx) => {
      const bObj = branches.find((b) => b.code === dev.branchId);
      const bName = bObj ? bObj.name : (dev.branchName || `Branch ${dev.branchId}`);
      const reqInfo = getRequestPushDateTime(dev);
      const serialModel = `${dev.serial} (${dev.model || dev.type})`;
      const merchantMidTid = `${dev.merchantName || '—'} · MID: ${dev.mid || '—'} / TID: ${dev.tid || '—'}`;
      const staffName = dev.staff || dev.installedByStaff || 'Assigned Branch Staff';
      const assignedBy = getAssignedBy(dev);
      return [
        String(idx + 1),
        reqInfo.full,
        serialModel,
        merchantMidTid,
        staffName,
        assignedBy,
        dev.branchId,
        bName,
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

return (
    <div className="space-y-6 pb-24">
      {/* 1. HERO HEADER WITH LIVE PIPELINE STATS */}
      <div className="relative overflow-hidden rounded-3xl p-6 sm:p-8 bg-linear-to-br from-[#002238] via-[#003857] to-[#004e75] text-white shadow-xl border border-white/10">
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold bg-sky-500/15 text-sky-200 border border-sky-400/30">
              <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
              <span>Dedicated App Push Pipeline</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center gap-3">
              <SendHorizontal className="w-8 h-8 text-[#7cc4ed] shrink-0" />
              <span>Push Configuring Hub</span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-200/90 leading-relaxed">
              Live deployment queue for merchant setup. Alert field technicians and branch officers to power ON devices, connect to network, and wait for pushing the merchant application.
            </p>
          </div>

          {/* Quick Action Button for Entire Queue */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {isAdminLike && onNotifyConfigReady && (
              <button
                type="button"
                disabled={configuringDevices.length === 0}
                onClick={() => {
                  setPusherPassword('');
                  setPusherPasswordError('');
                  setIsPushAllModalOpen(true);
                }}
                className="group relative inline-flex items-center gap-2.5 px-4 py-2 rounded-xl bg-white hover:bg-slate-50 text-[#003857] font-bold text-xs sm:text-sm shadow-md hover:shadow-lg active:scale-[0.98] transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border border-white/90"
                title="Push alerts to all devices (Requires Pusher Password verification)"
              >
                <Lock className="w-4 h-4 text-[#003857] shrink-0 group-hover:scale-110 transition-transform duration-150" />
                <span className="tracking-tight font-bold">
                  {waitingDevices.length === 0 && configuringDevices.length > 0
                    ? 'Re-push All'
                    : 'Notify All Ready'}
                </span>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-xs font-mono font-bold bg-[#003857]/8 text-[#003857] border border-[#003857]/15">
                  {waitingDevices.length > 0 ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span>
                        {waitingDevices.length} {waitingDevices.length === 1 ? 'Waiting' : 'Waiting'}
                      </span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-white/10">
          <button
            type="button"
            onClick={() => handleCardClick('WAITING')}
            className={`group p-3.5 rounded-2xl border backdrop-blur-xs transition-all duration-150 text-left cursor-pointer active:scale-[0.98] outline-none ${
              pushStatusFilter === 'WAITING'
                ? 'bg-white/20 border-white/40 ring-2 ring-sky-300 shadow-md'
                : 'bg-white/5 border-white/10 hover:bg-white/15 hover:border-white/25'
            }`}
            title="Click to view table and filter waiting devices"
          >
            <div className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider flex items-center justify-between">
              <span>Total Waiting Push</span>
              <span className="text-[10px] text-sky-200/70 group-hover:text-white transition-colors">View Table ↓</span>
            </div>
            <div className="text-2xl font-black text-white mt-1">{waitingDevices.length}</div>
            <div className="text-[10px] text-sky-300 font-medium mt-0.5 truncate">
              {alreadyPushedDevices.length > 0
                ? `${alreadyPushedDevices.length} already pushed (${configuringDevices.length} total)`
                : 'Click to view hardware queue'}
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleCardClick('POS')}
            className={`group p-3.5 rounded-2xl border backdrop-blur-xs transition-all duration-150 text-left cursor-pointer active:scale-[0.98] outline-none ${
              typeFilter === 'POS Terminal'
                ? 'bg-white/20 border-white/40 ring-2 ring-blue-300 shadow-md'
                : 'bg-white/5 border-white/10 hover:bg-white/15 hover:border-white/25'
            }`}
            title="Click to view and filter POS Terminals in queue"
          >
            <div className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-400" />
                POS Terminals
              </span>
              <span className="text-[10px] text-sky-200/70 group-hover:text-white transition-colors">View Table ↓</span>
            </div>
            <div className="text-2xl font-black text-white mt-1">{posCount}</div>
            <div className="text-[10px] text-slate-300 font-medium mt-0.5">Under Configuring</div>
          </button>

          <button
            type="button"
            onClick={() => handleCardClick('SB')}
            className={`group p-3.5 rounded-2xl border backdrop-blur-xs transition-all duration-150 text-left cursor-pointer active:scale-[0.98] outline-none ${
              typeFilter === 'Sound Box'
                ? 'bg-white/20 border-white/40 ring-2 ring-purple-300 shadow-md'
                : 'bg-white/5 border-white/10 hover:bg-white/15 hover:border-white/25'
            }`}
            title="Click to view and filter Sound Boxes in queue"
          >
            <div className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-purple-400" />
                Sound Boxes
              </span>
              <span className="text-[10px] text-sky-200/70 group-hover:text-white transition-colors">View Table ↓</span>
            </div>
            <div className="text-2xl font-black text-white mt-1">{sbCount}</div>
            <div className="text-[10px] text-slate-300 font-medium mt-0.5">Under Configuring</div>
          </button>

          <button
            type="button"
            onClick={() => handleCardClick('ALL')}
            className="group p-3.5 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xs hover:bg-white/15 hover:border-white/25 transition-all duration-150 text-left cursor-pointer active:scale-[0.98] outline-none"
            title="Click to view all active teams in queue"
          >
            <div className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-sky-300" />
                Active Teams
              </span>
              <span className="text-[10px] text-sky-200/70 group-hover:text-white transition-colors">View Table ↓</span>
            </div>
            <div className="text-2xl font-black text-white mt-1">{teamGroups.length}</div>
            <div className="text-[10px] text-sky-200 font-medium mt-0.5">Assigned branch teams</div>
          </button>
        </div>
      </div>

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
            <div className={`relative flex items-center gap-1 p-1 rounded-xl border transition-colors ${
              isLight ? 'bg-slate-100/90 border-slate-200/90' : 'bg-slate-900/60 border-slate-800'
            }`}>
              <button
                type="button"
                onClick={() => handleSetPushMode('total_csv')}
                className={`relative px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer select-none outline-none ${
                  pushMode === 'total_csv'
                    ? isLight ? 'text-[#003857]' : 'text-sky-300'
                    : isLight ? 'text-slate-600 hover:text-slate-900' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Consolidate devices per staff member into 1 Telegram message + CSV file (e.g. 10 merchants for Khon Rithy in 1 message, no spam)"
              >
                {pushMode === 'total_csv' && (
                  <motion.div
                    layoutId="activePushModeIndicator"
                    className={`absolute inset-0 rounded-lg shadow-xs ${
                      isLight
                        ? 'bg-white border border-slate-200/90'
                        : 'bg-slate-800 border border-slate-700/80'
                    }`}
                    transition={{ type: 'spring', stiffness: 500, damping: 32, mass: 0.55 }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5">
                  <FileSpreadsheet className={`w-3.5 h-3.5 transition-colors ${
                    pushMode === 'total_csv' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'
                  }`} />
                  <span>Total CSV by Staff</span>
                  <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono transition-colors ${
                    pushMode === 'total_csv'
                      ? isLight
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/70'
                        : 'bg-emerald-950/70 text-emerald-300 border border-emerald-800/80'
                      : isLight
                        ? 'bg-slate-200/60 text-slate-500'
                        : 'bg-slate-800 text-slate-400'
                  }`}>
                    1 Msg
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => handleSetPushMode('total_csv_all')}
                className={`relative px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer select-none outline-none ${
                  pushMode === 'total_csv_all'
                    ? isLight ? 'text-[#003857]' : 'text-sky-300'
                    : isLight ? 'text-slate-600 hover:text-slate-900' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Combine all devices across all staff into 1 single CSV file and message"
              >
                {pushMode === 'total_csv_all' && (
                  <motion.div
                    layoutId="activePushModeIndicator"
                    className={`absolute inset-0 rounded-lg shadow-xs ${
                      isLight
                        ? 'bg-white border border-slate-200/90'
                        : 'bg-slate-800 border border-slate-700/80'
                    }`}
                    transition={{ type: 'spring', stiffness: 500, damping: 32, mass: 0.55 }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5">
                  <FileSpreadsheet className={`w-3.5 h-3.5 transition-colors ${
                    pushMode === 'total_csv_all' ? 'text-teal-600 dark:text-teal-400' : 'text-slate-400'
                  }`} />
                  <span>Total CSV (All Staff)</span>
                  <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono transition-colors ${
                    pushMode === 'total_csv_all'
                      ? isLight
                        ? 'bg-teal-50 text-teal-700 border border-teal-200/70'
                        : 'bg-teal-950/70 text-teal-300 border border-teal-800/80'
                      : isLight
                        ? 'bg-slate-200/60 text-slate-500'
                        : 'bg-slate-800 text-slate-400'
                  }`}>
                    1 File
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => handleSetPushMode('single_alert')}
                className={`relative px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer select-none outline-none ${
                  pushMode === 'single_alert'
                    ? isLight ? 'text-[#003857]' : 'text-sky-300'
                    : isLight ? 'text-slate-600 hover:text-slate-900' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Send individual 1-device alert without attached CSV file"
              >
                {pushMode === 'single_alert' && (
                  <motion.div
                    layoutId="activePushModeIndicator"
                    className={`absolute inset-0 rounded-lg shadow-xs ${
                      isLight
                        ? 'bg-white border border-slate-200/90'
                        : 'bg-slate-800 border border-slate-700/80'
                    }`}
                    transition={{ type: 'spring', stiffness: 500, damping: 32, mass: 0.55 }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5">
                  <Send className={`w-3 h-3 transition-colors ${
                    pushMode === 'single_alert' ? 'text-sky-600 dark:text-sky-400' : 'text-slate-400'
                  }`} />
                  <span>Single Alerts</span>
                </span>
              </button>
            </div>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className={`px-3 py-2 rounded-xl text-xs font-bold border outline-none cursor-pointer transition-all duration-150 ${
                isLight ? 'border-slate-200 bg-slate-50 text-zinc-800' : 'border-slate-700 bg-[#0f121a] text-slate-200'
              }`}
            >
              <option value="ALL">All Device Types</option>
              <option value="POS Terminal">POS Terminal</option>
              <option value="Sound Box">Sound Box</option>
            </select>

            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className={`px-3 py-2 rounded-xl text-xs font-bold border outline-none cursor-pointer transition-all duration-150 ${
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

            {(search || typeFilter !== 'ALL' || branchFilter !== 'ALL' || pushStatusFilter !== 'ALL') && (
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

      {/* 4. HARDWARE QUEUE TABLE WITH DATE & TIME OF REQUEST PUSH */}
      <div ref={tableRef} className={`rounded-2xl border shadow-xs overflow-hidden scroll-mt-6 ${isLight ? 'border-slate-200/90 bg-white' : 'border-slate-800 bg-[#141822]'}`}>
        <div className={`p-4 border-b flex items-center justify-between gap-3 ${isLight ? 'border-slate-100 text-slate-700' : 'border-slate-800 text-slate-300'}`}>
          <div className="flex items-center gap-2">
            <span className="text-xs font-black uppercase tracking-wider">
              Queue Ready for App Push
            </span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${isLight ? 'bg-slate-100 text-slate-700 border border-slate-200' : 'bg-slate-800 text-slate-300 border border-slate-700'}`}>
              {filteredWaitingCount > 0
                ? `${filteredWaitingCount} waiting · ${filteredDevices.length} total`
                : `${filteredDevices.length} total (all pushed)`}
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:block">
              Assigned By: <strong className="text-zinc-900 dark:text-white">{operatorLabel}</strong>
            </div>
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={filteredDevices.length === 0}
              className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer transition shadow-2xs disabled:opacity-50"
              title="Export Push Queue Table to CSV (matching table columns)"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className={`border-b text-[11px] font-bold uppercase tracking-wider ${
                isLight
                  ? 'bg-slate-50/90 border-slate-200 text-slate-600'
                  : 'bg-slate-900/90 border-slate-800 text-slate-400'
              }`}>
                <th className="py-3 px-4 w-10">
                  <input
                    type="checkbox"
                    checked={selectedSns.length === filteredDevices.length && filteredDevices.length > 0}
                    onChange={handleToggleSelectAll}
                    aria-label="Select all in queue"
                    className="rounded border-slate-300 cursor-pointer accent-[#003857]"
                  />
                </th>
                <th className="py-3 px-4">Tracking ID &amp; TID</th>
                <th className="py-3 px-4">Date &amp; Time</th>
                <th className="py-3 px-4">Serial &amp; Model</th>
                <th className="py-3 px-4">Merchant Name &amp; MID / TID</th>
                <th className="py-3 px-4">Configure By (Staff)</th>
                <th className="py-3 px-4">Assigned By</th>
                <th className="py-3 px-4">Branch</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isLight ? 'divide-slate-100' : 'divide-slate-800/60'}`}>
              {filteredDevices.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <Boxes className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <div className="text-sm font-bold text-slate-600 dark:text-slate-300">No devices in Push Configuring queue</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {search || typeFilter !== 'ALL' || branchFilter !== 'ALL'
                        ? 'Try clearing the search filters above.'
                        : 'When an admin configures a merchant profile on a device, it will appear here.'}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredDevices.map((dev) => {
                  const isSelected = selectedSns.includes(dev.serial);
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
                      className={`transition-colors duration-150 ${
                        isLight
                          ? isSelected
                            ? 'bg-sky-50/70 hover:bg-sky-50'
                            : 'hover:bg-slate-50/70'
                          : isSelected
                          ? 'bg-sky-950/40 hover:bg-sky-950/50'
                          : 'hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="py-3 px-4">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelectOne(dev.serial)}
                          aria-label={`Select ${dev.serial}`}
                          className="rounded border-slate-300 cursor-pointer accent-[#003857]"
                        />
                      </td>

                      {/* Push Tracking ID & TID */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex flex-col gap-1 items-start">
                          {devPushId ? (
                            <div className="inline-flex items-center gap-1.5">
                              <span
                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-mono text-[11px] font-medium border transition shadow-2xs ${
                                  isLight
                                    ? 'bg-sky-50 text-sky-900 border-sky-200/90'
                                    : 'bg-sky-950/60 text-sky-200 border-sky-800'
                                }`}
                                title={`Tracking ID: ${devPushId} (Search in Telegram)`}
                              >
                                <span className="text-sky-600 dark:text-sky-400 font-bold">#</span>
                                <span>{devPushId}</span>
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCopyPushId(devPushId);
                                }}
                                className="p-1 rounded-md text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                                title="Copy Tracking ID (to find in Telegram)"
                              >
                                {copiedPushId === devPushId ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-medium bg-slate-100 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                              Pending Push
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Date & Time of Request Push */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className={`inline-flex flex-col gap-1 px-2.5 py-1.5 rounded-xl font-mono border transition-colors ${
                          isLight
                            ? 'bg-slate-100/90 text-slate-800 border-slate-200'
                            : 'bg-slate-800/80 text-slate-200 border-slate-700/80'
                        }`}>
                          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-200">
                            <Calendar className="w-3.5 h-3.5 text-[#003857] dark:text-sky-400 shrink-0" />
                            <span>{requestPushInfo.date}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-[11px] font-normal text-slate-500 dark:text-slate-400">
                            <Clock className="w-3 h-3 text-sky-600 dark:text-sky-400 shrink-0" />
                            <span>{requestPushInfo.time}</span>
                          </div>
                        </div>
                      </td>

                      {/* Serial & Model */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              isPos ? 'bg-blue-500' : 'bg-purple-500'
                            }`}
                            title={dev.type}
                          />
                          <span className="font-mono text-zinc-800 dark:text-slate-200">{dev.serial}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 pl-4">
                          {dev.type} {dev.model ? `· ${dev.model}` : ''}
                        </div>
                      </td>

                      {/* Merchant & MID / TID */}
                      <td className="py-3 px-4">
                        <div className="text-zinc-800 dark:text-slate-200 truncate max-w-[200px]" title={dev.merchantName}>
                          {dev.merchantName || 'Merchant Profile Pending'}
                        </div>
                        <div className="text-[10.5px] font-mono text-slate-500 dark:text-slate-400 mt-0.5 flex flex-col gap-0.5">
                          <div className="whitespace-nowrap">MID: {dev.mid || '—'}</div>
                          {dev.tid && <div className="whitespace-nowrap">TID: {dev.tid}</div>}
                        </div>
                      </td>

                      {/* Configure By (Staff) */}
                      <td className="py-3 px-4">
                        <div className="font-semibold text-zinc-800 dark:text-slate-200">{staffName}</div>
                        <div className="text-[10.5px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {userTelegramMap.get(staffName.toLowerCase().trim())
                            ? `@${userTelegramMap.get(staffName.toLowerCase().trim())}`
                            : 'Field Technician'}
                        </div>
                      </td>

                      {/* Assigned By (Admin / Operator) */}
                      <td className="py-3 px-4">
                        <div className="font-semibold text-zinc-800 dark:text-slate-200 flex items-center gap-1.5">
                          <ShieldCheck className="w-3.5 h-3.5 text-[#003857] dark:text-sky-400 shrink-0" />
                          <span className="truncate max-w-[150px]" title={assignedBy}>{assignedBy}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 pl-5">
                          Authorizing Admin
                        </div>
                      </td>

                      {/* Branch */}
                      <td className="py-3 px-4">
                        <div className="text-zinc-800 dark:text-slate-200 font-medium">Code {dev.branchId}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[140px]">{bName}</div>
                        <div className="text-[10px] text-sky-700 dark:text-sky-300 font-semibold flex items-center gap-1 mt-0.5">
                          <Send className="w-2.5 h-2.5 text-sky-600 dark:text-sky-400 shrink-0" />
                          <span className="truncate max-w-[140px]">{resolveTelegramChatForBranch(dev.branchId, regionalGroups, branches).groupName}</span>
                        </div>
                      </td>

                      {/* Row Actions */}
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          {isAdminLike && (() => {
                            const devIsPushed = isDevicePushed(dev.serial, dev);
                            const cooldownSecs = getRowCooldownSecs(dev.serial);

                            if (cooldownSecs > 0) {
                              return (
                                <button
                                  type="button"
                                  disabled
                                  className="px-2.5 py-1.5 rounded-lg font-medium text-[11px] inline-flex items-center gap-1.5 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 shadow-2xs opacity-80 cursor-not-allowed select-none"
                                  title={`Pushed to Telegram! ${cooldownSecs}s cooldown active`}
                                >
                                  <RotateCw className="w-3 h-3 text-emerald-500 animate-spin" />
                                  <span>Pushed · {cooldownSecs}s</span>
                                </button>
                              );
                            }

                            if (devIsPushed) {
                              return (
                                <button
                                  type="button"
                                  onClick={() => handleRowPushClick(dev)}
                                  className="group px-2.5 py-1.5 rounded-lg font-medium text-[11px] inline-flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-100/90 text-emerald-800 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/60 dark:text-emerald-300 border border-emerald-300/80 hover:border-emerald-400 dark:border-emerald-700/60 dark:hover:border-emerald-600 shadow-2xs active:scale-[0.97] transition-all cursor-pointer select-none"
                                  title={`Status: Pushed to Telegram (${requestPushInfo.full}). Click to repush to Telegram.`}
                                >
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0 group-hover:hidden transition-transform" />
                                  <RotateCw className="w-3 h-3 text-emerald-700 dark:text-emerald-300 shrink-0 hidden group-hover:inline group-hover:rotate-180 transition-transform duration-300" />
                                  <span className="group-hover:hidden">Pushed</span>
                                  <span className="hidden group-hover:inline">Repush</span>
                                </button>
                              );
                            }

                            return (
                              <button
                                type="button"
                                onClick={() => handleRowPushClick(dev)}
                                className="group px-2.5 py-1.5 rounded-lg font-medium text-[11px] inline-flex items-center gap-1.5 bg-sky-50 hover:bg-sky-100/90 text-sky-800 dark:bg-sky-950/40 dark:hover:bg-sky-900/60 dark:text-sky-300 border border-sky-200/90 hover:border-sky-300 dark:border-sky-800/60 dark:hover:border-sky-700 shadow-2xs active:scale-[0.97] transition-all cursor-pointer select-none"
                                title="Device configured and ready. Click to push now or select checkbox for batch."
                              >
                                <Clock className="w-3 h-3 text-sky-600 dark:text-sky-400 shrink-0 group-hover:hidden" />
                                <Send className="w-3 h-3 text-sky-700 dark:text-sky-300 shrink-0 hidden group-hover:inline" />
                                <span className="group-hover:hidden">Ready to Push</span>
                                <span className="hidden group-hover:inline">Push Now</span>
                              </button>
                            );
                          })()}

                          {onSelectDevice && (
                            <button
                              type="button"
                              onClick={() => onSelectDevice(dev.serial)}
                              className={`px-2.5 py-1.5 rounded-lg border font-semibold text-[11px] active:scale-[0.97] transition-all duration-150 cursor-pointer ${
                                isLight
                                  ? 'border-slate-200 bg-white hover:bg-slate-100 text-slate-700'
                                  : 'border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200'
                              }`}
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
                    className="w-36 sm:w-44 px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-medium text-white outline-none cursor-pointer truncate transition"
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
                    onClick={() => handleBatchPushClick(pushMode === 'total_csv' || pushMode === 'total_csv_all')}
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
              <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 overflow-y-auto">
                {/* Backdrop with true background blur covering entire viewport */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => {
                    setIsPushAllModalOpen(false);
                    setPusherPassword('');
                    setPusherPasswordError('');
                  }}
                  className="fixed inset-0 bg-slate-950/75 backdrop-blur-md"
                />

                {/* Modal Container in the exact style of WorkflowModal */}
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: 14 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 12 }}
                  transition={{ type: 'spring', damping: 32, stiffness: 480, mass: 0.6 }}
                  className={`relative w-full max-w-xl rounded-3xl shadow-2xl overflow-hidden my-auto z-10 border-0 flex flex-col transform-gpu will-change-gpu gpu-modal-container ${
                    isLight ? 'bg-white text-[#002f49]' : 'bg-[#12151e] text-slate-100'
                  }`}
                >
                  {/* Signature Navy Header Bar */}
                  <div className="navy-header-bar rounded-t-3xl px-6 py-4.5 flex items-center justify-between text-white border-b border-white/10 shrink-0">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center shrink-0 shadow-xs text-amber-300">
                        <Lock className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-base font-extrabold text-white tracking-tight flex items-center gap-2">
                          <span>Pusher Security Authorization</span>
                        </h3>
                        <p className="text-xs text-slate-200/90 font-medium mt-0.5">
                          PIN or password verification required before broadcasting deployment alerts
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

                  {/* Sub-Header Context Bar */}
                  <div
                    className={`px-6 py-2.5 border-b flex items-center justify-between text-xs shrink-0 ${
                      isLight ? 'bg-slate-50 border-slate-200 text-slate-700' : 'bg-[#151924] border-slate-800 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-[#003857] dark:text-sky-400" />
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        Two-Factor Broadcast Verification
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span>Double-Step Safeguard Active</span>
                    </div>
                  </div>

                  {/* Form & Modal Body */}
                  <form onSubmit={handleConfirmPushAllWithPassword} className="flex flex-col flex-1 overflow-hidden">
                    <div className="p-6 overflow-y-auto max-h-[70vh] space-y-4 text-xs">
                      {/* Section 1: Broadcast Impact & Queue Targets */}
                      <div className={`p-4 rounded-2xl border space-y-3 transition-colors ${
                        isLight ? 'bg-amber-50/60 border-amber-200/90' : 'bg-amber-950/20 border-amber-900/50'
                      }`}>
                        <div className="flex items-center justify-between pb-2.5 border-b border-amber-200/60 dark:border-amber-800/40">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0">
                              <AlertTriangle className="w-3.5 h-3.5" />
                            </div>
                            <div>
                              <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900 dark:text-amber-200">
                                1. Broadcast Safeguard &amp; Queue Targets
                              </h4>
                              <p className="text-[10.5px] text-amber-800/80 dark:text-amber-300/80">
                                High-impact deployment alert sent to branch Telegram groups
                              </p>
                            </div>
                          </div>
                          <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-800 dark:text-amber-200 border border-amber-500/30">
                            High Impact
                          </span>
                        </div>

                        {/* Metrics Grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          <div className="p-2.5 rounded-xl bg-white/95 dark:bg-[#121620] border border-amber-200/80 dark:border-amber-900/50 flex flex-col shadow-2xs">
                            <span className="text-[10px] uppercase font-bold text-slate-400">Total Devices</span>
                            <span className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5 mt-0.5">
                              <SendHorizontal className="w-3.5 h-3.5 text-[#003857] dark:text-sky-400" />
                              {configuringDevices.length} {configuringDevices.length === 1 ? 'Unit' : 'Units'}
                            </span>
                            <span className="text-[10px] text-slate-500 mt-0.5">
                              {configuringDevices.filter((d) => d.type === 'POS Terminal').length} POS · {configuringDevices.filter((d) => d.type === 'Sound Box').length} Sound Box
                            </span>
                          </div>

                          <div className="p-2.5 rounded-xl bg-white/95 dark:bg-[#121620] border border-amber-200/80 dark:border-amber-900/50 flex flex-col shadow-2xs">
                            <span className="text-[10px] uppercase font-bold text-slate-400">Branch Teams</span>
                            <span className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5 mt-0.5">
                              <Building2 className="w-3.5 h-3.5 text-indigo-500" />
                              {teamGroups.length} {teamGroups.length === 1 ? 'Team' : 'Teams'}
                            </span>
                            <span className="text-[10px] text-slate-500 mt-0.5 truncate">
                              {Array.from(new Set(configuringDevices.map((d) => `Code ${d.branchId}`))).slice(0, 3).join(', ')}
                              {new Set(configuringDevices.map((d) => d.branchId)).size > 3 ? '…' : ''}
                            </span>
                          </div>

                          <div className="p-2.5 rounded-xl bg-white/95 dark:bg-[#121620] border border-amber-200/80 dark:border-amber-900/50 flex flex-col col-span-2 sm:col-span-1 shadow-2xs">
                            <span className="text-[10px] uppercase font-bold text-slate-400">Alert Channel</span>
                            <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 mt-0.5">
                              <Users className="w-3.5 h-3.5" />
                              Telegram Broadcast
                            </span>
                            <span className="text-[10px] text-slate-500 mt-0.5 truncate">
                              Alerts Field Technicians
                            </span>
                          </div>
                        </div>

                        <p className="text-[11px] text-amber-900/90 dark:text-amber-200/90 leading-relaxed bg-amber-100/60 dark:bg-amber-900/30 p-2.5 rounded-xl border border-amber-300/40 dark:border-amber-800/40">
                          You are about to broadcast configuration alerts to all assigned branch Telegram groups. Field technicians will receive instructions to power ON units and stage them for app pushing.
                        </p>
                      </div>

                      {/* Section 2: Operator Security Authorization */}
                      <div className={`p-4 rounded-2xl border space-y-3.5 transition-colors ${
                        isLight ? 'bg-slate-100/90 border-slate-200 shadow-2xs' : 'bg-[#161a24] border-slate-700/70'
                      }`}>
                        <div className="flex items-center justify-between pb-2.5 border-b border-slate-200/60 dark:border-white/[0.06]">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-[#003857]/10 text-[#003857] dark:bg-sky-400/10 dark:text-sky-400 flex items-center justify-center shrink-0">
                              <KeyRound className="w-3.5 h-3.5" />
                            </div>
                            <div>
                              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                                2. Operator Security Authorization
                              </h4>
                              <p className="text-[10.5px] text-slate-500 dark:text-slate-400">
                                Verify employee PIN or password to authorize queue broadcast
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Active Pusher Operator Row */}
                        <div className="p-3 rounded-xl bg-white dark:bg-[#121620] border border-slate-200 dark:border-slate-800 flex items-center justify-between shadow-2xs">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-[#003857]/10 dark:bg-sky-950/50 flex items-center justify-center text-[#003857] dark:text-sky-400 shrink-0">
                              <User className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="text-[10px] uppercase font-bold text-slate-400">
                                Active Pusher Operator
                              </div>
                              <div className="text-xs font-extrabold text-slate-900 dark:text-white">
                                {operatorLabel}
                              </div>
                            </div>
                          </div>
                          <span className="text-[10px] font-mono px-2.5 py-1 rounded-full font-extrabold bg-[#003857]/10 text-[#003857] dark:bg-sky-500/20 dark:text-sky-300 border border-[#003857]/20 shadow-2xs">
                            Authorized Admin
                          </span>
                        </div>

                        {/* PIN Input Field */}
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center justify-between">
                            <label
                              htmlFor="pusher_auth_pin_input"
                              className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300"
                            >
                              <KeyRound className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />
                              <span>Enter Pusher PIN to Confirm</span>
                              <span className="text-rose-500 font-bold">*</span>
                            </label>
                            <span className="text-[10px] text-slate-400 font-mono">Employee ID or Security PIN</span>
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
                              placeholder="Enter your PIN (e.g. Employee ID)..."
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
                    </div>

                    {/* Footer Actions Strip */}
                    <div
                      className={`px-6 py-4 flex items-center justify-between text-xs border-t shrink-0 ${
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
                        className={`px-4 py-2.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
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

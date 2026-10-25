import { csvFile } from '../utils/csv';
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Device, Branch, UserRole, ThemeMode, TelegramRegionalGroup, User as AppUser } from '../types';
import { resolveTelegramChatForBranch } from '../utils/errorLogger';
import { normalizeStaffName } from '../utils/staffUtils';
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
} from 'lucide-react';

interface PushConfiguringTabProps {
  devices: Device[];
  branches: Branch[];
  role?: UserRole;
  operatorLabel?: string;
  onNotifyConfigReady?: (serialOrSerials: string | string[]) => void;
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
  const [selectedSns, setSelectedSns] = useState<string[]>([]);

  // 3. Double-click confirmation & 1-minute cooldown state for Telegram push
  // User has up to 1 minute (60s) to execute the 2nd confirmation click, and after pushing, a 1-minute cooldown prevents spam
  const CONFIRM_TIMEOUT_MS = 60000;
  const COOLDOWN_TIMEOUT_MS = 60000;

  const STORAGE_KEY_PUSHED_CONFIGURING = 'crm_pos_pushed_configuring_serials_v1';
  const STORAGE_KEY_PUSH_TIMESTAMPS = 'crm_pos_push_timestamps_v1';

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

  const [confirmingRowSerial, setConfirmingRowSerial] = useState<string | null>(null);
  const [confirmingTeamKey, setConfirmingTeamKey] = useState<string | null>(null);
  const [confirmingBatch, setConfirmingBatch] = useState(false);
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

  const recordPushedSerials = useCallback((serials: string[]) => {
    if (serials.length === 0) return;
    const nowStamp = stampSecPP();

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
  }, [onMarkPushed]);

  const isDevicePushed = useCallback((serial: string): boolean => {
    return (
      Boolean(pushedSerials?.has(serial)) ||
      Boolean(pushedSerialsLocal.has(serial)) ||
      Boolean(pushTimestamps[serial])
    );
  }, [pushedSerials, pushedSerialsLocal, pushTimestamps]);

  const rowTimerRef = useRef<NodeJS.Timeout | null>(null);
  const teamTimerRef = useRef<NodeJS.Timeout | null>(null);
  const batchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const rowConfirmExpiresRef = useRef<number>(0);
  const teamConfirmExpiresRef = useRef<number>(0);
  const batchConfirmExpiresRef = useRef<number>(0);

  // Ticker for live 1-minute confirmation countdown and 1-minute cooldown timers
  useEffect(() => {
    const hasActiveTimer =
      confirmingRowSerial !== null ||
      confirmingTeamKey !== null ||
      confirmingBatch ||
      Object.keys(pushedCooldowns).length > 0;

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
  }, [confirmingRowSerial, confirmingTeamKey, confirmingBatch, pushedCooldowns]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (rowTimerRef.current) clearTimeout(rowTimerRef.current);
      if (teamTimerRef.current) clearTimeout(teamTimerRef.current);
      if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
    };
  }, []);

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
      if (!q) return true;
      return (
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
  }, [configuringDevices, search, branchFilter, typeFilter]);

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
      const staffName = normalizeStaffName(rawStaff);
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
  }, [configuringDevices, branches, userTelegramMap]);

  // Counts
  const posCount = useMemo(() => configuringDevices.filter((d) => d.type === 'POS Terminal').length, [configuringDevices]);
  const sbCount = useMemo(() => configuringDevices.filter((d) => d.type === 'Sound Box').length, [configuringDevices]);

  // Devices waiting to be pushed vs already pushed
  const waitingDevices = useMemo(() => {
    return configuringDevices.filter((d) => !isDevicePushed(d.serial));
  }, [configuringDevices, isDevicePushed]);

  const alreadyPushedDevices = useMemo(() => {
    return configuringDevices.filter((d) => isDevicePushed(d.serial));
  }, [configuringDevices, isDevicePushed]);

  const filteredWaitingCount = useMemo(() => {
    return filteredDevices.filter((d) => !isDevicePushed(d.serial)).length;
  }, [filteredDevices, isDevicePushed]);

  // Checkbox helpers
  const handleToggleSelectAll = () => {
    if (selectedSns.length === filteredDevices.length && filteredDevices.length > 0) {
      setSelectedSns([]);
    } else {
      setSelectedSns(filteredDevices.map((d) => d.serial));
    }
  };

  const handleToggleSelectOne = (sn: string) => {
    setSelectedSns((prev) =>
      prev.includes(sn) ? prev.filter((x) => x !== sn) : [...prev, sn]
    );
  };

  // Countdown & Cooldown Seconds Helpers
  const getRowConfirmSecs = (serial: string): number => {
    if (confirmingRowSerial !== serial) return 0;
    return Math.max(1, Math.ceil((rowConfirmExpiresRef.current - tickerNow) / 1000));
  };

  const getRowCooldownSecs = (serial: string): number => {
    const exp = pushedCooldowns[`sn_${serial}`];
    if (!exp || exp <= tickerNow) return 0;
    return Math.max(1, Math.ceil((exp - tickerNow) / 1000));
  };

  const getTeamConfirmSecs = (teamKey: string): number => {
    if (confirmingTeamKey !== teamKey) return 0;
    return Math.max(1, Math.ceil((teamConfirmExpiresRef.current - tickerNow) / 1000));
  };

  const getTeamCooldownSecs = (teamKey: string): number => {
    const exp = pushedCooldowns[`team_${teamKey}`];
    if (!exp || exp <= tickerNow) return 0;
    return Math.max(1, Math.ceil((exp - tickerNow) / 1000));
  };

  const getBatchConfirmSecs = (): number => {
    if (!confirmingBatch) return 0;
    return Math.max(1, Math.ceil((batchConfirmExpiresRef.current - tickerNow) / 1000));
  };

  const getBatchCooldownSecs = (): number => {
    const exp = pushedCooldowns['batch'];
    if (!exp || exp <= tickerNow) return 0;
    return Math.max(1, Math.ceil((exp - tickerNow) / 1000));
  };

  // Helper to extract formatted Date and Time of Request Push
  const getRequestPushDateTime = (dev: Device): { full: string; date: string; time: string } => {
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

  // Double-click handlers for Telegram pushes (1-min confirmation window & 1-min cooldown)
  const handleRowPushClick = (serial: string) => {
    if (getRowCooldownSecs(serial) > 0) return;

    if (confirmingRowSerial === serial) {
      // 2nd click confirmed: execute push
      if (rowTimerRef.current) clearTimeout(rowTimerRef.current);
      setConfirmingRowSerial(null);
      rowConfirmExpiresRef.current = 0;

      // Record push timestamp and mark pushed
      recordPushedSerials([serial]);

      // 1-minute cooldown before another push
      const cooldownExp = Date.now() + COOLDOWN_TIMEOUT_MS;
      setPushedCooldowns((prev) => ({ ...prev, [`sn_${serial}`]: cooldownExp }));

      onNotifyConfigReady?.(serial);
    } else {
      // 1st click: prime confirmation state with 1-minute window
      setConfirmingRowSerial(serial);
      rowConfirmExpiresRef.current = Date.now() + CONFIRM_TIMEOUT_MS;
      if (rowTimerRef.current) clearTimeout(rowTimerRef.current);
      rowTimerRef.current = setTimeout(() => {
        setConfirmingRowSerial(null);
        rowConfirmExpiresRef.current = 0;
      }, CONFIRM_TIMEOUT_MS);
    }
  };

  const handleTeamPushClick = (key: string, serials: string[]) => {
    if (getTeamCooldownSecs(key) > 0) return;

    if (confirmingTeamKey === key) {
      // 2nd click confirmed: execute push
      if (teamTimerRef.current) clearTimeout(teamTimerRef.current);
      setConfirmingTeamKey(null);
      teamConfirmExpiresRef.current = 0;

      // Record push timestamp and mark pushed for all units in team
      recordPushedSerials(serials);

      // 1-minute cooldown for this team and all devices in it
      const cooldownExp = Date.now() + COOLDOWN_TIMEOUT_MS;
      setPushedCooldowns((prev) => {
        const next: Record<string, number> = { ...prev, [`team_${key}`]: cooldownExp };
        serials.forEach((sn) => {
          next[`sn_${sn}`] = cooldownExp;
        });
        return next;
      });

      onNotifyConfigReady?.(serials);
    } else {
      // 1st click: prime confirmation state with 1-minute window
      setConfirmingTeamKey(key);
      teamConfirmExpiresRef.current = Date.now() + CONFIRM_TIMEOUT_MS;
      if (teamTimerRef.current) clearTimeout(teamTimerRef.current);
      teamTimerRef.current = setTimeout(() => {
        setConfirmingTeamKey(null);
        teamConfirmExpiresRef.current = 0;
      }, CONFIRM_TIMEOUT_MS);
    }
  };

  const handleBatchPushClick = () => {
    if (getBatchCooldownSecs() > 0) return;

    if (confirmingBatch) {
      // 2nd click confirmed: execute push
      if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
      setConfirmingBatch(false);
      batchConfirmExpiresRef.current = 0;

      // Record push timestamp and mark pushed for all selected units
      recordPushedSerials(selectedSns);

      // 1-minute cooldown for batch and selected devices
      const cooldownExp = Date.now() + COOLDOWN_TIMEOUT_MS;
      setPushedCooldowns((prev) => {
        const next: Record<string, number> = { ...prev, batch: cooldownExp };
        selectedSns.forEach((sn) => {
          next[`sn_${sn}`] = cooldownExp;
        });
        return next;
      });

      onNotifyConfigReady?.(selectedSns);
      setSelectedSns([]);
    } else {
      // 1st click: prime confirmation state with 1-minute window
      setConfirmingBatch(true);
      batchConfirmExpiresRef.current = Date.now() + CONFIRM_TIMEOUT_MS;
      if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
      batchTimerRef.current = setTimeout(() => {
        setConfirmingBatch(false);
        batchConfirmExpiresRef.current = 0;
      }, CONFIRM_TIMEOUT_MS);
    }
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
    recordPushedSerials(allSerials);
    const cooldownExp = Date.now() + COOLDOWN_TIMEOUT_MS;
    setPushedCooldowns((prev) => {
      const next: Record<string, number> = { ...prev, batch: cooldownExp };
      allSerials.forEach((sn) => {
        next[`sn_${sn}`] = cooldownExp;
      });
      return next;
    });
    onNotifyConfigReady?.(allSerials);
    setSelectedSns([]);
  };

  const handleExportCsv = () => {
    if (filteredDevices.length === 0) return;
    const headers = [
      'No.',
      'Date & Time of Request Push',
      'Hardware Serial & Model',
      'Merchant Name & MID / TID',
      'Configure By (Staff)',
      'Assigned By',
      'Branch',
    ];
    const rows = filteredDevices.map((dev, idx) => {
      const bObj = branches.find((b) => b.code === dev.branchId);
      const bName = bObj ? bObj.name : (dev.branchName || `Branch ${dev.branchId}`);
      const reqInfo = getRequestPushDateTime(dev);
      const serialModel = `${dev.serial} (${dev.model || dev.type})`;
      const merchantMidTid = `${dev.merchantName || '—'} · MID: ${dev.mid || '—'} / TID: ${dev.tid || '—'}`;
      const staffName = dev.staff || dev.installedByStaff || 'Assigned Branch Staff';
      const assignedBy = getAssignedBy(dev);
      const branchDisplay = `${dev.branchId} · ${bName.replace(' Branch', '')}`;

      return [
        String(idx + 1),
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
      'Date & Time of Request Push',
      'Hardware Serial & Model',
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
      const reqInfo = getRequestPushDateTime(dev);
      const serialModel = `${dev.serial} (${dev.model || dev.type})`;
      const merchantMidTid = `${dev.merchantName || '—'} · MID: ${dev.mid || '—'} / TID: ${dev.tid || '—'}`;
      const staffName = dev.staff || dev.installedByStaff || tg.staff;
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
      'Date & Time of Request Push',
      'Hardware Serial & Model',
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
              Live deployment queue for merchant hardware setup. Alert field technicians and branch officers to power ON devices, connect to network, and wait for pushing the merchant application.
            </p>
          </div>

          {/* Quick Action Button for Entire Queue (Requires Password) */}
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {isAdminLike && onNotifyConfigReady && (
              <button
                type="button"
                disabled={configuringDevices.length === 0}
                onClick={() => {
                  setPusherPassword('');
                  setPusherPasswordError('');
                  setIsPushAllModalOpen(true);
                }}
                className="group relative inline-flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-[#005587] via-[#006ca7] to-[#0284c7] hover:from-[#00629b] hover:via-[#0284c7] hover:to-[#0396e6] text-white font-extrabold text-xs sm:text-sm shadow-md hover:shadow-xl hover:shadow-sky-500/25 active:scale-[0.98] transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border border-white/20 hover:border-white/35"
                title="Push alerts to all devices (Requires Pusher Password verification)"
              >
                <div className="w-7 h-7 rounded-xl bg-black/20 border border-white/15 flex items-center justify-center shrink-0 shadow-inner group-hover:scale-105 transition-transform duration-150">
                  <Lock className="w-3.5 h-3.5 text-sky-200" />
                </div>
                <span className="tracking-tight font-extrabold">
                  {waitingDevices.length === 0 && configuringDevices.length > 0
                    ? 'Re-push All'
                    : 'Notify All Ready'}
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-black bg-white/15 text-white border border-white/20 shadow-xs">
                  {waitingDevices.length > 0 ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span>
                        {waitingDevices.length} {waitingDevices.length === 1 ? 'Waiting' : 'Waiting'}
                      </span>
                    </>
                  ) : (
                    <span>
                      {configuringDevices.length} {configuringDevices.length === 1 ? 'Unit (Pushed)' : 'Units (Pushed)'}
                    </span>
                  )}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* KPI Mini-Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-white/10">
          <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xs hover:bg-white/10 transition-colors duration-150">
            <div className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">Total Waiting Push</div>
            <div className="text-2xl font-black text-white mt-1">{waitingDevices.length}</div>
            <div className="text-[10px] text-sky-300 font-medium mt-0.5">
              {alreadyPushedDevices.length > 0
                ? `${alreadyPushedDevices.length} already pushed (${configuringDevices.length} total)`
                : 'High-volume daily queue'}
            </div>
          </div>
          <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xs hover:bg-white/10 transition-colors duration-150">
            <div className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-400" />
              POS Terminals
            </div>
            <div className="text-2xl font-black text-white mt-1">{posCount}</div>
            <div className="text-[10px] text-slate-300 font-medium mt-0.5">Under Configuring</div>
          </div>
          <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xs hover:bg-white/10 transition-colors duration-150">
            <div className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-purple-400" />
              Sound Boxes
            </div>
            <div className="text-2xl font-black text-white mt-1">{sbCount}</div>
            <div className="text-[10px] text-slate-300 font-medium mt-0.5">Under Configuring</div>
          </div>
          <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xs hover:bg-white/10 transition-colors duration-150">
            <div className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-sky-300" />
              Active Teams
            </div>
            <div className="text-2xl font-black text-white mt-1">{teamGroups.length}</div>
            <div className="text-[10px] text-sky-200 font-medium mt-0.5">Assigned branch teams</div>
          </div>
        </div>
      </div>

      {/* 2. ASSIGNED TEAMS QUICK-ACTION CARDS (GROUPED BY CONFIGURE BY) */}
      {teamGroups.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-2">
              <Users className="w-4 h-4 text-[#003857] dark:text-sky-400" />
              <span>Assigned Teams &amp; Branches ({teamGroups.length})</span>
            </h2>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">Click &ldquo;Notify Team&rdquo; twice to alert only that group</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {teamGroups.map((tg) => {
              const teamKey = `${tg.staff}__${tg.branchId}`;
              const isConfirmingThisTeam = confirmingTeamKey === teamKey;
              const teamSerials = tg.devices.map((d) => d.serial);
              const isTeamAllPushed = teamSerials.length > 0 && teamSerials.every((sn) => isDevicePushed(sn));
              const teamChat = resolveTelegramChatForBranch(tg.branchId, regionalGroups, branches);

              return (
                <div
                  key={teamKey}
                  className={`p-4 rounded-2xl border shadow-2xs hover:shadow-md transition-all duration-150 flex flex-col justify-between gap-3 ${
                    isConfirmingThisTeam
                      ? 'border-amber-400 ring-2 ring-amber-400/50 bg-amber-50/20 dark:bg-amber-950/20'
                      : isLight
                      ? 'bg-white border-slate-200/90 text-zinc-900 hover:border-slate-300'
                      : 'bg-[#141822] border-slate-800 text-white hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-black text-[#003857] dark:text-sky-300 truncate" title={tg.staff}>
                          {tg.staff}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate flex items-center gap-1 mt-0.5">
                          <Building2 className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>Code {tg.branchId} ({tg.branchName})</span>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-full text-xs font-black bg-sky-50 text-sky-800 border border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800/60 shrink-0">
                        {tg.devices.length} Units
                      </span>
                    </div>

                    {/* Regional Telegram Group Routing Info */}
                    <div className="flex items-center gap-1.5 text-[10.5px] text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 px-2.5 py-1 rounded-lg border border-slate-200/90 dark:border-slate-700/60 mt-2 font-mono">
                      <Send className="w-3 h-3 text-[#003857] dark:text-sky-400 shrink-0" />
                      <span className="truncate">
                        Alert: <strong>{teamChat.groupName}</strong> ({teamChat.chatId})
                      </span>
                    </div>

                    <div className="mt-2 text-[10.5px] text-slate-500 dark:text-slate-400 font-mono truncate">
                      Sample: {tg.devices.slice(0, 2).map((x) => x.serial).join(', ')}
                      {tg.devices.length > 2 && ` (+${tg.devices.length - 2} more)`}
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => handleDownloadTeamFile(tg)}
                      className="w-full py-1.5 px-3 rounded-xl text-xs font-bold transition-all duration-150 cursor-pointer flex items-center justify-center gap-1.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 active:scale-[0.98] shadow-2xs"
                      title={`Download & open full configuration file for ${tg.staff} (${tg.devices.length} devices)`}
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>Open Config File ({tg.devices.length})</span>
                    </button>

                    {isAdminLike && onNotifyConfigReady && (
                      getTeamCooldownSecs(teamKey) > 0 ? (
                        <button
                          type="button"
                          disabled
                          className="w-full py-1.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 cursor-not-allowed opacity-90 shadow-2xs"
                          title={`Team pushed to Telegram! 1-minute cooldown active (${getTeamCooldownSecs(teamKey)}s remaining)`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                          <span>Queue &amp; File Sent · {getTeamCooldownSecs(teamKey)}s</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleTeamPushClick(teamKey, teamSerials)}
                          className={`w-full py-1.5 px-3 rounded-xl text-xs font-bold transition-all duration-150 cursor-pointer flex items-center justify-center gap-1.5 active:scale-[0.98] ${
                            isConfirmingThisTeam
                              ? 'bg-amber-600 hover:bg-amber-700 text-white animate-pulse shadow-sm ring-2 ring-amber-400'
                              : isTeamAllPushed
                              ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/60 dark:text-emerald-300 border border-emerald-300/80 dark:border-emerald-700/60 shadow-2xs group'
                              : 'bg-[#003857] hover:bg-[#002a42] text-white shadow-2xs'
                          }`}
                          title={
                            isConfirmingThisTeam
                              ? `Click 2nd time to ${isTeamAllPushed ? 're-push' : 'send'} 1 Telegram alert + file for this team (${getTeamConfirmSecs(teamKey)}s window)`
                              : isTeamAllPushed
                              ? 'Team already pushed. Click to initiate Re-push Telegram alert + file'
                              : 'Click once, then click 2nd time to send 1 Telegram alert + file (instead of 10 pop-up messages)'
                          }
                        >
                          {isConfirmingThisTeam ? (
                            <>
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-200" />
                              <span>{isTeamAllPushed ? 'Confirm Re-push' : 'Click 2nd Time'} to Send File ({getTeamConfirmSecs(teamKey)}s)</span>
                            </>
                          ) : isTeamAllPushed ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                              <span className="font-extrabold">Pushed</span>
                              <span className="text-[11px] border-l border-emerald-300 dark:border-emerald-700/60 pl-1.5 flex items-center gap-1 text-emerald-700/80 dark:text-emerald-300/80 group-hover:text-emerald-950 dark:group-hover:text-white">
                                <RotateCw className="w-3 h-3 group-hover:rotate-180 transition-transform duration-300" />
                                Re-push Team ({tg.devices.length})
                              </span>
                            </>
                          ) : (
                            <>
                              <Send className="w-3.5 h-3.5" />
                              <span>Push Queue &amp; Send File ({tg.devices.length})</span>
                            </>
                          )}
                        </button>
                      )
                    )}
                    <div className="text-[10px] text-slate-400 dark:text-slate-500 text-center">
                      1 Telegram alert + file (no separate popups)
                    </div>
                  </div>
                </div>
              );
            })}
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
              placeholder="Search serial, merchant, MID, TID, staff, date..."
              className={`w-full pl-9 pr-3 py-2 rounded-xl text-xs border outline-none transition-all duration-150 ${
                isLight
                  ? 'border-slate-200 bg-slate-50 text-zinc-900 focus:bg-white focus:border-[#003857]'
                  : 'border-slate-700 bg-[#0f121a] text-slate-100 focus:border-sky-400'
              }`}
            />
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
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

            {(search || typeFilter !== 'ALL' || branchFilter !== 'ALL') && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setTypeFilter('ALL');
                  setBranchFilter('ALL');
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
                const isConfirmingBranch = confirmingTeamKey === branchKey;
                const isBranchAllPushed = filteredDevices.length > 0 && filteredDevices.every((d) => isDevicePushed(d.serial));

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

                return (
                  <button
                    type="button"
                    onClick={() => handleTeamPushClick(branchKey, branchSerials)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all duration-150 cursor-pointer flex items-center gap-1.5 active:scale-[0.98] ${
                      isConfirmingBranch
                        ? 'bg-amber-600 hover:bg-amber-700 text-white animate-pulse shadow-sm ring-2 ring-amber-400'
                        : isBranchAllPushed
                        ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/60 dark:text-emerald-300 border border-emerald-300/80 dark:border-emerald-700/60 shadow-2xs group'
                        : 'bg-[#003857] hover:bg-[#002a42] text-white shadow-2xs'
                    }`}
                    title={
                      isConfirmingBranch
                        ? `Click 2nd time to ${isBranchAllPushed ? 're-push' : 'send'} 1 Telegram alert + file for this branch (${getTeamConfirmSecs(branchKey)}s window)`
                        : isBranchAllPushed
                        ? 'Branch already pushed. Click to initiate Re-push alert + file'
                        : 'Sends 1 single Telegram notification with attached file for this branch instead of separate popups'
                    }
                  >
                    {isConfirmingBranch ? (
                      <>
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-200" />
                        <span>{isBranchAllPushed ? 'Confirm Re-push' : 'Click 2nd Time'} ({getTeamConfirmSecs(branchKey)}s)</span>
                      </>
                    ) : isBranchAllPushed ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <span className="font-extrabold">Pushed</span>
                        <span className="text-[11px] border-l border-emerald-300 dark:border-emerald-700/60 pl-1.5 flex items-center gap-1 text-emerald-700/80 dark:text-emerald-300/80 group-hover:text-emerald-950 dark:group-hover:text-white">
                          <RotateCw className="w-3 h-3 group-hover:rotate-180 transition-transform duration-300" />
                          Re-push Branch ({filteredDevices.length})
                        </span>
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        <span>Send Branch Alert &amp; File ({filteredDevices.length})</span>
                      </>
                    )}
                  </button>
                );
              })()}
            </div>
          </div>
        )}
      </div>

      {/* 4. HARDWARE QUEUE TABLE WITH DATE & TIME OF REQUEST PUSH */}
      <div className={`rounded-2xl border shadow-xs overflow-hidden ${isLight ? 'border-slate-200/90 bg-white' : 'border-slate-800 bg-[#141822]'}`}>
        <div className={`p-4 border-b flex items-center justify-between gap-3 ${isLight ? 'border-slate-100 text-slate-700' : 'border-slate-800 text-slate-300'}`}>
          <div className="flex items-center gap-2">
            <span className="text-xs font-black uppercase tracking-wider">
              Hardware Queue Ready for App Push
            </span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${isLight ? 'bg-slate-100 text-slate-700 border border-slate-200' : 'bg-slate-800 text-slate-300 border border-slate-700'}`}>
              {filteredWaitingCount > 0
                ? `${filteredWaitingCount} waiting · ${filteredDevices.length} total`
                : `${filteredDevices.length} total (all pushed)`}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
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
                    aria-label="Select all hardware in queue"
                    className="rounded border-slate-300 cursor-pointer accent-[#003857]"
                  />
                </th>
                <th className="py-3 px-4">Date &amp; Time of Request Push</th>
                <th className="py-3 px-4">Hardware Serial &amp; Model</th>
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
                  <td colSpan={8} className="py-12 text-center text-slate-400">
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
                  const isConfirmingThisRow = confirmingRowSerial === dev.serial;
                  const isPos = dev.type === 'POS Terminal';
                  const bObj = branches.find((b) => b.code === dev.branchId);
                  const bName = bObj ? bObj.name : (dev.branchName || `Branch ${dev.branchId}`);
                  const staffName = dev.staff || dev.installedByStaff || 'Assigned Branch Staff';
                  const assignedBy = getAssignedBy(dev);
                  const requestPushInfo = getRequestPushDateTime(dev);

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

                      {/* Date & Time of Request Push */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className={`inline-flex flex-col gap-1 px-2.5 py-1.5 rounded-xl font-mono border transition-colors ${
                          isLight
                            ? 'bg-slate-100/90 text-slate-800 border-slate-200'
                            : 'bg-slate-800/80 text-slate-200 border-slate-700/80'
                        }`}>
                          <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-900 dark:text-white">
                            <Calendar className="w-3.5 h-3.5 text-[#003857] dark:text-sky-400 shrink-0" />
                            <span>{requestPushInfo.date}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
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
                          <span className="font-mono font-bold text-zinc-900 dark:text-white">{dev.serial}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 pl-4">
                          {dev.type} {dev.model ? `· ${dev.model}` : ''}
                        </div>
                      </td>

                      {/* Merchant & MID / TID */}
                      <td className="py-3 px-4">
                        <div className="font-bold text-zinc-900 dark:text-white truncate max-w-[200px]" title={dev.merchantName}>
                          {dev.merchantName || 'Merchant Profile Pending'}
                        </div>
                        <div className="text-[10.5px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                          MID: {dev.mid || '—'} {dev.tid ? `| TID: ${dev.tid}` : ''}
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

                      {/* Row Actions (Must Click 2 Times) */}
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          {isAdminLike && onNotifyConfigReady && (() => {
                            const devIsPushed = isDevicePushed(dev.serial);
                            const cooldownSecs = getRowCooldownSecs(dev.serial);
                            const confirmSecs = getRowConfirmSecs(dev.serial);

                            if (cooldownSecs > 0) {
                              return (
                                <button
                                  type="button"
                                  disabled
                                  className="px-2.5 py-1.5 rounded-lg font-bold text-[11px] flex items-center gap-1.5 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 cursor-not-allowed opacity-90 shadow-2xs"
                                  title={`Pushed to Telegram! 1-minute cooldown active (${cooldownSecs}s remaining)`}
                                >
                                  <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                  <span>Pushed · {cooldownSecs}s</span>
                                </button>
                              );
                            }

                            if (isConfirmingThisRow) {
                              return (
                                <button
                                  type="button"
                                  onClick={() => handleRowPushClick(dev.serial)}
                                  className="px-2.5 py-1.5 rounded-lg font-bold text-[11px] transition-all duration-150 cursor-pointer flex items-center gap-1.5 active:scale-[0.97] bg-amber-600 hover:bg-amber-700 text-white shadow-sm ring-2 ring-amber-400 animate-pulse"
                                  title={`Click 2nd time to confirm Telegram ${devIsPushed ? 're-push' : 'push'} (${confirmSecs}s window)`}
                                >
                                  <AlertTriangle className="w-3 h-3 text-amber-200" />
                                  <span>{devIsPushed ? 'Confirm Re-push' : 'Click 2nd Time'} ({confirmSecs}s)</span>
                                </button>
                              );
                            }

                            if (devIsPushed) {
                              return (
                                <button
                                  type="button"
                                  onClick={() => handleRowPushClick(dev.serial)}
                                  className="px-2.5 py-1.5 rounded-lg font-bold text-[11px] transition-all duration-150 cursor-pointer flex items-center gap-1.5 active:scale-[0.97] bg-emerald-50 hover:bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/60 dark:text-emerald-300 border border-emerald-300/80 dark:border-emerald-700/60 shadow-2xs hover:shadow-xs group"
                                  title="Status: Pushed to Telegram. Click once, then click 2nd time within 1 minute to re-push alert."
                                >
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                  <span className="font-extrabold">Pushed</span>
                                  <span className="text-[10px] text-emerald-700/80 dark:text-emerald-300/80 font-semibold border-l border-emerald-300 dark:border-emerald-700/60 pl-1.5 flex items-center gap-1 group-hover:text-emerald-950 dark:group-hover:text-white">
                                    <RotateCw className="w-2.5 h-2.5 opacity-70 group-hover:rotate-180 transition-transform duration-300" />
                                    Re-push
                                  </span>
                                </button>
                              );
                            }

                            return (
                              <button
                                type="button"
                                onClick={() => handleRowPushClick(dev.serial)}
                                className="px-2.5 py-1.5 rounded-lg font-bold text-[11px] transition-all duration-150 cursor-pointer flex items-center gap-1.5 active:scale-[0.97] bg-[#003857] hover:bg-[#002a42] text-white shadow-2xs hover:shadow-xs"
                                title="Click once, then click 2nd time within 1 minute to push to Telegram"
                              >
                                <Send className="w-3 h-3" />
                                <span>Notify &amp; Push</span>
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
                              title="Manage hardware profile or complete deployment"
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

      {/* 5. FLOATING BATCH ACTION BAR WHEN ITEMS ARE CHECKED (Must Click 2 Times) */}
      <AnimatePresence>
        {selectedSns.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3.5 rounded-2xl bg-[#18191e] text-white shadow-2xl border border-zinc-700/80 flex flex-wrap items-center gap-4 max-w-xl w-[90vw]"
          >
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-xl bg-white text-zinc-900 font-mono text-xs font-black shadow-2xs">
                {selectedSns.length}
              </span>
              <span className="text-xs font-bold text-white">Units Selected</span>
            </div>

            <div className="flex items-center gap-2 ml-auto">
              {isAdminLike && onAssignStaff && (
                <div className="relative">
                  <select
                    onChange={(e) => {
                      if (e.target.value) {
                        onAssignStaff(selectedSns, e.target.value);
                        setSelectedSns([]);
                      }
                    }}
                    defaultValue=""
                    className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-semibold text-white outline-none cursor-pointer"
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
                className="px-3 py-2 rounded-xl border border-white/20 bg-white/10 hover:bg-white/20 text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer active:scale-[0.97] transition-all"
                title="Download and open configuration file for selected devices"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                <span>Open File ({selectedSns.length})</span>
              </button>

              {isAdminLike && onNotifyConfigReady && (() => {
                const isBatchCooldown = getBatchCooldownSecs() > 0;
                const isBatchAllPushed = selectedSns.length > 0 && selectedSns.every((sn) => isDevicePushed(sn));

                if (isBatchCooldown) {
                  return (
                    <button
                      type="button"
                      disabled
                      className="px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 cursor-not-allowed opacity-90 shadow-2xs"
                      title={`Batch pushed to Telegram! 1-minute cooldown active (${getBatchCooldownSecs()}s remaining)`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>File &amp; Alert Sent · {getBatchCooldownSecs()}s</span>
                    </button>
                  );
                }

                return (
                  <button
                    type="button"
                    onClick={handleBatchPushClick}
                    className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all duration-150 cursor-pointer flex items-center gap-1.5 active:scale-[0.97] ${
                      confirmingBatch
                        ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-sm ring-2 ring-amber-400 animate-pulse'
                        : isBatchAllPushed
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs'
                        : 'bg-sky-600 hover:bg-sky-500 text-white shadow-xs'
                    }`}
                    title={
                      confirmingBatch
                        ? `Click 2nd time to ${isBatchAllPushed ? 're-push' : 'send'} 1 Telegram notification + attached file for selected devices (${getBatchConfirmSecs()}s window)`
                        : isBatchAllPushed
                        ? 'Selected devices already pushed. Click to initiate Re-push alert + file'
                        : 'Click once, then click 2nd time to send 1 Telegram notification + attached file instead of separate popups'
                    }
                  >
                    {confirmingBatch ? (
                      <>
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-200" />
                        <span>{isBatchAllPushed ? 'Confirm Re-push File' : 'Click 2nd Time to Push File'} ({selectedSns.length}) ({getBatchConfirmSecs()}s)</span>
                      </>
                    ) : isBatchAllPushed ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-200" />
                        <span>Re-push Queue &amp; File ({selectedSns.length})</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        <span>Push Queue &amp; File ({selectedSns.length})</span>
                      </>
                    )}
                  </button>
                );
              })()}

              <button
                type="button"
                onClick={() => {
                  setSelectedSns([]);
                  setConfirmingBatch(false);
                }}
                className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold text-slate-300 active:scale-[0.97] transition-all duration-150 cursor-pointer"
              >
                Cancel
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
                  transition={{ type: 'spring', damping: 28, stiffness: 340, mass: 0.75 }}
                  className={`relative w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden my-auto z-10 border border-slate-200/80 dark:border-slate-800 flex flex-col ${
                    isLight ? 'bg-white text-slate-800' : 'bg-[#12151e] text-slate-100'
                  }`}
                >
                  {/* Signature Navy Header Bar matching WorkflowModal */}
                  <div className="navy-header-bar rounded-t-2xl px-5 py-3.5 flex items-center justify-between text-white border-b border-white/10 shrink-0">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-white/10 border border-white/15 flex items-center justify-center shrink-0 shadow-xs text-white">
                        <Lock className="w-4 h-4 text-white" />
                      </div>
                      <div>
                        <h3 className="text-sm sm:text-base font-bold text-white tracking-tight flex items-center gap-2">
                          <span>Pusher Security Authorization</span>
                        </h3>
                        <p className="text-[11px] text-white/75 font-mono mt-0.5">
                          PIN or password required before pushing to all units
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
                      className="p-1.5 rounded-xl text-white/75 hover:text-white hover:bg-white/10 transition cursor-pointer shrink-0 ml-2"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Stepper Progress Bar (Double-Step Flow) */}
                  <div
                    className={`px-5 py-2.5 border-b flex items-center justify-between text-xs ${
                      isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#151924] border-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-4 h-4 rounded-full bg-[#004953] text-white flex items-center justify-center text-[10px] font-black">
                        1
                      </span>
                      <span className="font-bold text-slate-700 dark:text-slate-200">
                        Security Authorization
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      <ShieldCheck className="w-3.5 h-3.5 text-[#003857] dark:text-sky-400" />
                      <span>Double-Step Safeguard Active</span>
                    </div>
                  </div>

                  {/* Form Body */}
                  <form onSubmit={handleConfirmPushAllWithPassword} className="p-5 flex flex-col gap-3.5 text-xs">
                    {/* Warning Impact Banner */}
                    <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2.5">
                      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-extrabold text-[11.5px] uppercase tracking-wide">High-Impact Broadcast Safeguard</div>
                        <p className="text-[11px] opacity-90 mt-0.5 leading-relaxed">
                          You are about to send Telegram configuration alerts for <strong>{configuringDevices.length} device{configuringDevices.length === 1 ? '' : 's'}</strong> across <strong>{teamGroups.length} branch team{teamGroups.length === 1 ? '' : 's'}</strong>.
                        </p>
                      </div>
                    </div>

                    {/* Pusher Identity Box */}
                    <div
                      className={`p-3 rounded-xl border ${
                        isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#181c26] border-slate-700/80'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                        <span className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-[#003857] dark:text-sky-400" />
                          <span>Active Pusher Operator</span>
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full font-extrabold bg-[#003857]/10 text-[#003857] dark:bg-sky-500/20 dark:text-sky-300 border border-[#003857]/20">
                          Authorized Admin
                        </span>
                      </div>
                      <div className="text-xs font-bold text-slate-900 dark:text-white">
                        {operatorLabel}
                      </div>
                    </div>

                    {/* PIN Input Field */}
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="pusher_auth_pin_input"
                        className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300"
                      >
                        <span className="flex items-center gap-1.5">
                          <KeyRound className="w-3.5 h-3.5 text-[#003857] dark:text-sky-400" />
                          <span>Enter Pusher PIN to Confirm *</span>
                        </span>
                        <span className="text-[10px] text-slate-400">Employee ID or Security PIN</span>
                      </label>
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
                          className={`w-full pl-3.5 pr-10 py-2.5 rounded-xl text-xs font-mono border outline-none transition ${
                            pusherPasswordError
                              ? 'border-rose-500 focus:border-rose-500 bg-rose-50/40 text-rose-900 dark:text-rose-200'
                              : isLight
                              ? 'border-slate-200 bg-slate-50/70 text-slate-900 focus:bg-white focus:ring-2 focus:ring-[#003857]/20 focus:border-[#003857]'
                              : 'border-slate-700 bg-[#181c26] text-white focus:border-sky-400'
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
                        <div className="text-[11px] font-bold text-rose-600 dark:text-rose-400 mt-1 flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          <span>{pusherPasswordError}</span>
                        </div>
                      )}
                    </div>

                    {/* Footer Actions Strip matching WorkflowModal */}
                    <div
                      className={`px-5 py-3.5 -mx-5 -mb-5 mt-2 flex items-center justify-between text-xs border-t ${
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
                        className={`px-3.5 py-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                          isLight
                            ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
                            : 'bg-[#181c26] hover:bg-[#202534] text-slate-300 border-slate-700'
                        }`}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={isVerifyingPusher || !pusherPassword.trim()}
                        className="px-4 py-2 rounded-xl text-xs font-bold bg-[#003857] hover:bg-[#002a42] text-white shadow-sm active:scale-[0.98] transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed border border-white/10"
                      >
                        {isVerifyingPusher ? (
                          <span>Verifying...</span>
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

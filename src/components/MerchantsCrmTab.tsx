import { ClearFiltersButton } from './ClearFiltersButton';
import React, { useState, useMemo, useEffect, useDeferredValue } from 'react';
import { useSort, SortTh } from '../utils/sort';
import { createPortal } from 'react-dom';
import { Device, Branch, UserRole, ThemeMode, MerchantProfile } from '../types';
import { STAGE_META } from '../data/initialData';
import { motion, AnimatePresence } from 'motion/react';
import {
  Store,
  Search,
  Cpu,
  Volume2,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Plus,
  X,
  Building2,
  RotateCcw,
  Layers,
  ShieldCheck,
  FileSpreadsheet,
Check,
  AlertOctagon,
BarChart3,
ChevronLeft,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { csvFile } from '../utils/csv';
import { hasKhmer, isValidMidForType, midRuleError, normalizeMid } from '../utils/display';
import { lastMonthsPP, todayPP } from '../utils/time';
import { canSeeFullContact, phoneFor } from '../utils/privacy';
import { canMove, moveError, statusOf } from '../utils/stages';

/**
 * What the CRM sends with a bind (22 Oct 2026). The stage fields are what the move to "Installed Live" must set
 * (from statusOf/onMove) so the handler can apply them instead of choosing its own wording.
 */
export interface MerchantBindPayload {
  mid: string;
  tid: string;
  merchantName: string;
  merchantPhone: string;
  address: string;
  stage?: 'COMPLETE';
  deploymentStatus?: string;
  stockStatus?: string;
  deployedDate?: string;
}

/** Only units waiting at a branch (reserve or being set up) may be bound, and never one that belongs to another MID. */
const BINDABLE_STAGES = ['HQ_STOCK', 'BRANCH_RESERVE', 'CONFIGURING'] as const;
function bindBlockReason(d: Device | undefined, targetMid: string): string {
  if (!d) return 'Serial is not in the device list. Register the unit in stock first.';
  if (d.archived) return `Serial ${d.serial} is archived.`;
  if (!(BINDABLE_STAGES as readonly string[]).includes(d.stage)) {
    const why = moveError(d.stage, 'COMPLETE', STAGE_META);
    return `Serial ${d.serial} is in ${STAGE_META[d.stage]?.short || d.stage}. Only Branch Reserve or Configuring units can be bound.${why ? ' ' + why : ''}`;
  }
  if (!canMove(d.stage, 'COMPLETE')) return moveError(d.stage, 'COMPLETE', STAGE_META);
  const cur = (d.mid || '').trim();
  if (cur && targetMid && cur.toUpperCase() !== targetMid.trim().toUpperCase()) {
    return `Serial ${d.serial} is already bound to MID ${cur}${d.merchantName ? ` (${d.merchantName})` : ''}.`;
  }
  return '';
}
const bindStageFields = (): Pick<MerchantBindPayload, 'stage' | 'deploymentStatus' | 'stockStatus' | 'deployedDate'> => ({
  stage: 'COMPLETE',
  ...statusOf('COMPLETE'),
  deployedDate: todayPP(),
});

/** Placeholder contact values that must never be saved as real data (saved as '' and shown as "—"). */
const PLACEHOLDER_PHONE_DIGITS = new Set(['012345678', '012888100', '012889100', '012888900', '012990112', '012000000', '000000000']);
function cleanPhone(v: string | null | undefined): string {
  const s = String(v || '').trim();
  if (!s) return '';
  const d = s.replace(/\D/g, '');
  if (d.length < 8 || PLACEHOLDER_PHONE_DIGITS.has(d) || /^(\d)\1+$/.test(d)) return '';
  if (/^(n\/?a|none|null|tbd|unknown|-+|—)$/i.test(s)) return '';
  return s;
}
function cleanAddress(v: string | null | undefined): string {
  const s = String(v || '').trim();
  if (!s) return '';
  if (/^(n\/?a|none|null|tbd|unknown|-+|—)(\s+street)?$/i.test(s)) return '';
  return s;
}
const dash = (v: string | null | undefined) => (String(v || '').trim() ? String(v) : '—');

interface MerchantsCrmTabProps {
  role: UserRole;
  devices: Device[];
  allDevices: Device[];
  branches: Branch[];
  activeBranchId: string;
  activeStaff: string;
  onOpenWorkflow: (serial: string) => void;
  onBindDeviceToMerchant: (serial: string, merchantData: MerchantBindPayload) => void;
  onBulkBindDevicesToMerchants?: (
    assignments: Array<MerchantBindPayload & { serial: string }>
  ) => void;
  onTerminateMerchant?: (
    mid: string,
    destination: 'HQ_STOCK' | 'BRANCH_RESERVE',
    reason: string,
    notes?: string,
    targetBranchId?: string,
    returnedByStaff?: string
  ) => void;
  onReplaceMerchantDevice?: (
    oldSerial: string,
    newSerial: string,
    replacedByStaff: string,
    reason: string
  ) => void;
  theme?: ThemeMode;
}

// TID Format: TID-<3-digit branchId><2 to 5 digits> e.g. TID-10501
const TID_REGEX = /^TID-(\d{3})(\d{2,5})$/;

export const MerchantsCrmTab: React.FC<MerchantsCrmTabProps> = ({
  role,
  devices,
  allDevices,
  branches,
  activeBranchId,
  activeStaff,
  onReplaceMerchantDevice,
  onOpenWorkflow,
  onBindDeviceToMerchant,
  onTerminateMerchant,
  theme = 'dark',
}) => {
  const isLight = theme === 'light';

  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);                     // typing stays instant; the big list follows a moment later
  const [branchFilter, setBranchFilter] = useState(role === 'BRANCH' ? activeBranchId : 'ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'ONBOARDING' | 'ATTENTION'>('ALL');
  const [bundleFilter, setBundleFilter] = useState<'ALL' | 'BUNDLE_BOTH' | 'POS_ONLY' | 'SB_ONLY'>('ALL');
  const [deviceCountFilter, setDeviceCountFilter] = useState<'ALL' | '1' | '2+'>('ALL');
  const [selectedMid, setSelectedMid] = useState<string | null>(null);

  // Modal state for binding an additional reserve serial to a Merchant MID
  const [bindModalMerchant, setBindModalMerchant] = useState<MerchantProfile | null>(null);
  const [selectedReserveSerial, setSelectedReserveSerial] = useState<string>('');
  const [newTidInput, setNewTidInput] = useState<string>('');

  // Modal state for terminating a merchant & returning all hardware
  const [terminateModalMerchant, setTerminateModalMerchant] = useState<MerchantProfile | null>(null);
  const [terminateDestination, setTerminateDestination] = useState<'BRANCH_RESERVE' | 'HQ_STOCK'>('BRANCH_RESERVE');
  const [returnBranchId, setReturnBranchId] = useState<string>('');
  const [returnStaffName, setReturnStaffName] = useState<string>('');

  const returnStaffOptions = useMemo(() => {
    const list = new Set<string>();
    if (activeStaff) list.add(activeStaff);
    if (terminateModalMerchant?.accountOfficer) list.add(terminateModalMerchant.accountOfficer);
    const targetBranch = branches.find((b) => (b.code || b.id) === returnBranchId);
    (targetBranch?.staff || []).forEach((s) => list.add(s));
    (targetBranch?.staffDetails || []).forEach((u) => list.add(u.name));
    const curBranch = branches.find((b) => (b.code || b.id) === terminateModalMerchant?.branchId);
    (curBranch?.staff || []).forEach((s) => list.add(s));
    (curBranch?.staffDetails || []).forEach((u) => list.add(u.name));
    return Array.from(list).filter(Boolean);
  }, [activeStaff, terminateModalMerchant, returnBranchId, branches]);
  const [terminateReason, setTerminateReason] = useState<string>('Returned by Merchant');
  const [terminateNotes, setTerminateNotes] = useState<string>('');
  const [replaceModalDevice, setReplaceModalDevice] = useState<Device | null>(null);
  const [replaceNewSerial, setReplaceNewSerial] = useState<string>('');
  const [replaceStaffName, setReplaceStaffName] = useState<string>('');
  const [replaceReason, setReplaceReason] = useState<string>('Broken / Hardware Malfunction');

  // Modal state for onboarding a brand-new Merchant Profile with a reserve serial
  const [newMerchantModalOpen, setNewMerchantModalOpen] = useState(false);
  const [newMerchName, setNewMerchName] = useState('');
  const [newMerchMid, setNewMerchMid] = useState('');
  const [newMerchTid, setNewMerchTid] = useState('');
  const [newMerchPhone, setNewMerchPhone] = useState('');
  const [newMerchAddress, setNewMerchAddress] = useState('');
  const [newMerchSerial, setNewMerchSerial] = useState('');
  // --- Recharts Monthly Hardware Deployment Trend per Merchant MID State ---
  const [showTrendChart, setShowTrendChart] = useState<boolean>(false);
  const [selectedTrendMid, setSelectedTrendMid] = useState<string>('ALL');
  const [trendChartMode, setTrendChartMode] = useState<'POS_VS_SB' | 'BY_MID_STACKED'>('POS_VS_SB');
  const [trendHorizon, setTrendHorizon] = useState<'6M' | '12M'>('6M');

  // Aggregate Merchant 360 Profiles from device registry
  const merchantProfiles = useMemo<MerchantProfile[]>(() => {
    const map = new Map<string, MerchantProfile>();
    const len = devices.length;

    for (let i = 0; i < len; i++) {
      const d = devices[i];
      if (!d.mid && !d.merchantName) continue;
      const key = d.mid && d.mid.trim() !== '' ? d.mid.trim() : `MERCH-${d.merchantName.trim()}`;

      let prof = map.get(key);
      if (!prof) {
        prof = {
          mid: d.mid || key,
          merchantName: d.merchantName || '',
          merchantPhone: cleanPhone(d.merchantPhone),
          address: cleanAddress(d.address),
          location: d.location || '',
          branchId: d.branchId,
          branchName: d.branchName,
          accountOfficer: d.staff || '',
          devices: [],
          posCount: 0,
          sbCount: 0,
          liveCount: 0,
          pendingCount: 0,
          faultyCount: 0,
          crmStatus: 'ACTIVE',
          updatedAt: d.updatedAt || '',
        };
        map.set(key, prof);
      }

      prof.devices.push(d);
      if (d.type === 'POS Terminal') prof.posCount += 1;
      if (d.type === 'Sound Box') prof.sbCount += 1;
      if (d.stage === 'COMPLETE') prof.liveCount += 1;
      if (d.stage === 'CONFIGURING') prof.pendingCount += 1;
      if (d.stage === 'FAULTY') prof.faultyCount += 1;
      if (!prof.merchantPhone) prof.merchantPhone = cleanPhone(d.merchantPhone);
      if (!prof.address) prof.address = cleanAddress(d.address);
      if (!prof.merchantName && d.merchantName) prof.merchantName = d.merchantName;
      if (!prof.accountOfficer) prof.accountOfficer = d.staff || '';
    }

    const list: MerchantProfile[] = [];
    map.forEach((p) => {
      let crmStatus: 'ACTIVE' | 'ONBOARDING' | 'ATTENTION' = 'ACTIVE';
      if (p.faultyCount > 0) {
        crmStatus = 'ATTENTION';
      } else if (p.pendingCount > 0 && p.liveCount === 0) {
        crmStatus = 'ONBOARDING';
      }
      p.crmStatus = crmStatus;
      list.push(p);
    });

    return list.sort((a, b) => b.devices.length - a.devices.length);
  }, [devices]);

  // Existing system maps for fast duplicate & conflict lookup
  const existingTidMap = useMemo(() => {
    const map = new Map<string, Device[]>();
    allDevices.forEach((d) => {
      const t = (d.tid || '').trim().toUpperCase();
      if (!t) return;
      if (!map.has(t)) map.set(t, []);
      map.get(t)!.push(d);
    });
    return map;
  }, [allDevices]);

  const existingMidMap = useMemo(() => {
    const map = new Map<string, { merchantName: string; branchId: string; count: number }>();
    allDevices.forEach((d) => {
      const m = (d.mid || '').trim().toUpperCase();
      if (!m) return;
      if (!map.has(m)) {
        map.set(m, {
          merchantName: d.merchantName || '',
          branchId: d.branchId,
          count: 1,
        });
      } else {
        map.get(m)!.count += 1;
      }
    });
    return map;
  }, [allDevices]);
  // Units that may be bound: Branch Reserve or Configuring, not archived, not bound to any merchant yet
  // (HQ stock must be dispatched to a branch first – HQ_STOCK → COMPLETE is not an allowed move).
  const availableReserveDevices = useMemo(() => {
    return allDevices.filter(
      (d) =>
        !d.archived &&
        (BINDABLE_STAGES as readonly string[]).includes(d.stage) &&
        !(d.mid || '').trim() &&
        (role === 'SUPER_ADMIN' || role === 'ADMIN' || d.branchId === activeBranchId)
    );
  }, [allDevices, role, activeBranchId]);

  const deviceBySerial = useMemo(
    () => new Map<string, Device>(allDevices.map((d) => [d.serial.trim().toUpperCase(), d])),
    [allDevices]
  );
  // Real-time validation for the single Bind Modal & New Merchant Modal
  const singleBindValidation = useMemo(() => {
    if (!bindModalMerchant) return { valid: true, errors: [] as string[] };
    const errs: string[] = [];
    const targetBindDev = selectedReserveSerial ? deviceBySerial.get(selectedReserveSerial.trim().toUpperCase()) : undefined;
    if (!isValidMidForType(bindModalMerchant.mid.trim(), targetBindDev?.type)) {
      errs.push(midRuleError(bindModalMerchant.mid.trim(), targetBindDev?.type) || `This merchant's MID (${bindModalMerchant.mid}) is invalid.`);
    }
    if (!bindModalMerchant.merchantName.trim()) {
      errs.push('This merchant has no business name on record. Add it before binding.');
    }
    if (selectedReserveSerial) {
      const why = bindBlockReason(deviceBySerial.get(selectedReserveSerial.trim().toUpperCase()), bindModalMerchant.mid);
      if (why) errs.push(why);
    }
    const tidClean = newTidInput.trim().toUpperCase();
    if (!tidClean) {
      errs.push('Enter the Terminal ID (TID) issued for this unit.');
    } else if (!TID_REGEX.test(tidClean)) {
      errs.push(`TID format mismatch: expected TID-{Branch}{Seq} (e.g. branch ${bindModalMerchant.branchId}).`);
    }
    const existingWithTid = (existingTidMap.get(tidClean) || []).filter(
      (d) => d.serial.toUpperCase() !== selectedReserveSerial.trim().toUpperCase()
    );
    if (tidClean && existingWithTid.length > 0) {
      errs.push(`Duplicate TID: ${tidClean} is already bound to ${existingWithTid[0].serial}`);
    }
    return { valid: errs.length === 0, errors: errs };
  }, [bindModalMerchant, newTidInput, existingTidMap, selectedReserveSerial, deviceBySerial]);

  const singleNewMerchantValidation = useMemo(() => {
    const errs: string[] = [];
    const midClean = newMerchMid.trim().toUpperCase();
    const tidClean = newMerchTid.trim().toUpperCase();

    if (!midClean) {
      errs.push('MID is required (15 numeric digits).');
    } else if (!isValidMidForType(midClean, deviceBySerial.get(newMerchSerial.trim().toUpperCase())?.type)) {
      errs.push(midRuleError(midClean, deviceBySerial.get(newMerchSerial.trim().toUpperCase())?.type));
    }
    if (!tidClean) {
      errs.push('Terminal ID (TID) is required.');
    }
    const serialClean = newMerchSerial.trim().toUpperCase();
    if (!serialClean) {
      errs.push('Choose a hardware serial from the device list.');
    } else {
      const dev = deviceBySerial.get(serialClean);
      const why = role === 'BRANCH' && dev && dev.branchId !== activeBranchId
        ? `Serial ${dev.serial} belongs to branch ${dev.branchId}, not your branch.`
        : bindBlockReason(dev, midClean);
      if (why) errs.push(why);
    }
    if (tidClean && (existingTidMap.get(tidClean) || []).length > 0) {
      const collide = existingTidMap.get(tidClean)![0];
      errs.push(`Duplicate TID: ${tidClean} is already assigned to ${collide.serial} (${collide.merchantName})`);
    }
    const existingMidInfo = existingMidMap.get(midClean);
    if (
      existingMidInfo &&
      existingMidInfo.merchantName &&
      newMerchName.trim() &&
      existingMidInfo.merchantName.toLowerCase() !== newMerchName.trim().toLowerCase()
    ) {
      errs.push(`Duplicate MID conflict: ${midClean} is already registered to "${existingMidInfo.merchantName}"`);
    }
    return { valid: errs.length === 0, errors: errs };
  }, [newMerchMid, newMerchTid, newMerchName, newMerchSerial, deviceBySerial, existingTidMap, existingMidMap, role, activeBranchId]);

  const matchedMerchants = useMemo(() => {
    return merchantProfiles.filter((m) => {
      if (branchFilter !== 'ALL' && m.branchId !== branchFilter) return false;
      if (statusFilter !== 'ALL' && m.crmStatus !== statusFilter) return false;
      if (bundleFilter === 'BUNDLE_BOTH' && !m.devices.some((d) => Boolean(d.replacedByStaff || d.replacedPrevSerial))) return false;
      if (bundleFilter === 'POS_ONLY' && (m.posCount === 0 || m.sbCount > 0)) return false;
      if (bundleFilter === 'SB_ONLY' && (m.sbCount === 0 || m.posCount > 0)) return false;
      if (deviceCountFilter === '1' && m.devices.length !== 1) return false;
      if (deviceCountFilter === '2+' && m.devices.length < 2) return false;

      if (deferredSearch.trim()) {
        const q = deferredSearch.trim().toLowerCase();
        const serialsText = m.devices.map((d) => `${d.serial} ${d.tid} ${d.model}`).join(' ');
        // Branch staff cannot search by full phone number (it would reveal a masked number).
        const phoneText = canSeeFullContact(role) ? m.merchantPhone : '';
        const hay = `${m.mid} ${m.merchantName} ${phoneText} ${m.address} ${m.branchId} ${m.branchName} ${m.accountOfficer} ${serialsText}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [merchantProfiles, branchFilter, statusFilter, bundleFilter, deviceCountFilter, deferredSearch, role]);
  const { sorted: filteredMerchants, sort: crmSort, toggle: crmToggle } = useSort<MerchantProfile>(matchedMerchants, {
    mid: (m) => m.mid, merchant: (m) => m.merchantName, staff: (m) => m.accountOfficer,
    device: (m) => m.devices.length, serial: (m) => m.devices[0]?.serial,
    installed: (m) => m.devices.find((d) => Boolean(d.deployedDate))?.deployedDate, status: (m) => m.crmStatus,
  });

  const selectedMerchantProfile = useMemo(
    () => merchantProfiles.find((m) => m.mid === selectedMid) || null,
    [merchantProfiles, selectedMid]
  );

  // CRM KPI Metrics (Single pass, zero intermediate array allocations)
  const { totalMerchants, activeMerchants, bundleMerchants, onboardingMerchants, attentionMerchants } = useMemo(() => {
    let active = 0, bundle = 0, onboarding = 0, attention = 0;
    const len = merchantProfiles.length;
    for (let i = 0; i < len; i++) {
      const m = merchantProfiles[i];
      if (m.crmStatus === 'ACTIVE') active++;
      else if (m.crmStatus === 'ONBOARDING') onboarding++;
      else if (m.crmStatus === 'ATTENTION') attention++;
      if (m.devices.some((d) => Boolean(d.replacedByStaff || d.replacedPrevSerial))) bundle++;
    }
    return {
      totalMerchants: len,
      activeMerchants: active,
      bundleMerchants: bundle,
      onboardingMerchants: onboarding,
      attentionMerchants: attention,
    };
  }, [merchantProfiles]);

  // High-Throughput Merchant Pagination (Limits DOM elements to 25 / 50 / 100)
  const [merchantPage, setMerchantPage] = useState(1);
  const [merchantsPerPage, setMerchantsPerPage] = useState(50);

  const totalMerchantPages = Math.max(1, Math.ceil(filteredMerchants.length / merchantsPerPage));

  useEffect(() => {
    if (merchantPage > totalMerchantPages) {
      setMerchantPage(1);
    }
  }, [totalMerchantPages, merchantPage]);

  // (review) the MID picker lists at most 300 merchants (the selected one always included): a list of thousands of
  // options made the screen slow to open and could not be scrolled through anyway; the search narrows it
  const trendMidOptions = useMemo(() => {
    const top = merchantProfiles.slice(0, 300);
    if (selectedTrendMid !== 'ALL' && !top.some((m) => m.mid === selectedTrendMid)) {
      const sel = merchantProfiles.find((m) => m.mid === selectedTrendMid);
      if (sel) top.unshift(sel);
    }
    return top;
  }, [merchantProfiles, selectedTrendMid]);

  const pagedMerchants = useMemo(() => {
    const start = (merchantPage - 1) * merchantsPerPage;
    return filteredMerchants.slice(start, start + merchantsPerPage);
  }, [filteredMerchants, merchantPage, merchantsPerPage]);

  // --- Monthly Hardware Deployment Trends per Merchant MID (Recharts Data Engine) ---
  const MID_SERIES_COLORS = [
    '#003857', // ABA Navy Blue
    '#10b981', // Emerald
    '#005a8c', // ABA Interactive Navy
    '#004469', // ABA Medium Navy
    '#f59e0b', // Amber
    '#e41e26', // ABA Red Accent
  ];

  const topMerchantsForTrend = useMemo(() => {
    const source = filteredMerchants.length > 0 ? filteredMerchants : merchantProfiles;
    return source.slice(0, 6);
  }, [filteredMerchants, merchantProfiles]);

  // Real deployments only: a unit counts in the month of its deployedDate (Phnom Penh months). No invented history.
  const trendMonths = useMemo(() => lastMonthsPP(trendHorizon === '6M' ? 6 : 12), [trendHorizon]);

  const monthlyDeploymentTrendData = useMemo(() => {
    const months = trendMonths;
    const firstKey = months[0]?.key || '';
    const targetMerchants =
      selectedTrendMid === 'ALL'
        ? filteredMerchants.length > 0
          ? filteredMerchants
          : merchantProfiles
        : merchantProfiles.filter((m) => m.mid === selectedTrendMid);

    const index = new Map<string, number>(months.map((m, i) => [m.key, i]));
    const rows = months.map((mObj) => {
      const perMidCounts: Record<string, number> = {};
      topMerchantsForTrend.forEach((tm) => {
        perMidCounts[tm.mid] = 0;
      });
      return {
        month: mObj.label,
        monthKey: mObj.key,
        posDeployed: 0,
        sbDeployed: 0,
        monthlyTotal: 0,
        cumulativeFleet: 0,
        ...perMidCounts,
      } as { month: string; monthKey: string; posDeployed: number; sbDeployed: number; monthlyTotal: number; cumulativeFleet: number } & Record<string, number | string>;
    });

    let before = 0;
    targetMerchants.forEach((merch) => {
      merch.devices.forEach((dev) => {
        const key = (dev.deployedDate || '').slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(key)) return;
        if (key < firstKey) {
          before += 1;
          return;
        }
        const i = index.get(key);
        if (i === undefined) return;
        const row = rows[i];
        if (dev.type === 'POS Terminal') row.posDeployed += 1;
        else row.sbDeployed += 1;
        row.monthlyTotal += 1;
        if (typeof row[merch.mid] === 'number') row[merch.mid] = (row[merch.mid] as number) + 1;
      });
    });

    let running = before;
    rows.forEach((r) => {
      running += r.monthlyTotal;
      r.cumulativeFleet = running;
    });
    return rows;
  }, [filteredMerchants, merchantProfiles, selectedTrendMid, trendMonths, topMerchantsForTrend]);

  const trendHasData = useMemo(
    () => monthlyDeploymentTrendData.some((r) => r.monthlyTotal > 0),
    [monthlyDeploymentTrendData]
  );

  const cardClass = isLight
    ? 'surface-card-light text-[#002f49]'
    : 'surface-card-dark text-slate-100';
  const headingClass = isLight ? 'text-[#002f49]' : 'text-white';
  const subtextClass = isLight ? 'text-slate-500' : 'text-slate-400';
  const inputClass = isLight
    ? 'surface-inset-light text-[#002f49]'
    : 'surface-inset-dark text-white';

  const handleResetFilters = () => {
    setSearch('');
    setBranchFilter(role === 'BRANCH' ? activeBranchId : 'ALL');
    setStatusFilter('ALL');
    setBundleFilter('ALL');
    setDeviceCountFilter('ALL');
  };
  const handleOpenBindModal = (merchant: MerchantProfile) => {
    setBindModalMerchant(merchant);
    const branchRes = availableReserveDevices.filter((d) => d.branchId === merchant.branchId);
    const defaultDev = branchRes[0] || availableReserveDevices[0];
    setSelectedReserveSerial(defaultDev ? defaultDev.serial : '');
    // The TID is the one issued for the unit; it is typed in, never generated here.
    setNewTidInput('');
  };

  const handleConfirmBindDevice = (e: React.FormEvent) => {
    e.preventDefault();
    if (!bindModalMerchant || !selectedReserveSerial || !singleBindValidation.valid) return;
    onBindDeviceToMerchant(selectedReserveSerial, {
      mid: normalizeMid(bindModalMerchant.mid),
      tid: newTidInput.trim().toUpperCase(),
      merchantName: bindModalMerchant.merchantName.trim(),
      merchantPhone: cleanPhone(bindModalMerchant.merchantPhone),
      address: cleanAddress(bindModalMerchant.address),
      ...bindStageFields(),
    });
    setBindModalMerchant(null);
  };

  const handleOpenTerminateModal = (merchant: MerchantProfile) => {
    setTerminateModalMerchant(merchant);
    setTerminateDestination('BRANCH_RESERVE');
    const defaultBranch =
      (merchant.branchId && merchant.branchId !== '100')
        ? merchant.branchId
        : (activeBranchId && activeBranchId !== '100')
        ? activeBranchId
        : (branches.find((b) => (b.code || b.id) !== '100')?.code || '101');
    setReturnBranchId(defaultBranch);
    setReturnStaffName(activeStaff || merchant.accountOfficer || '');
    setTerminateReason('Returned by Merchant');
    setTerminateNotes('');
  };

  const handleConfirmTerminate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!terminateModalMerchant || !onTerminateMerchant) return;
    onTerminateMerchant(
      terminateModalMerchant.mid,
      terminateDestination,
      terminateReason,
      terminateNotes.trim(),
      terminateDestination === 'BRANCH_RESERVE' ? returnBranchId : undefined,
      returnStaffName.trim() || activeStaff || 'Staff'
    );
    setTerminateModalMerchant(null);
  };

  const handleCreateNewMerchant = (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !newMerchName.trim() ||
      !newMerchMid.trim() ||
      !newMerchSerial.trim() ||
      !singleNewMerchantValidation.valid
    )
      return;
    const dev = deviceBySerial.get(newMerchSerial.trim().toUpperCase());
    if (!dev) return;
    onBindDeviceToMerchant(dev.serial, {
      mid: normalizeMid(newMerchMid).toUpperCase(),
      tid: newMerchTid.trim().toUpperCase(),
      merchantName: newMerchName.trim(),
      merchantPhone: cleanPhone(newMerchPhone),
      address: cleanAddress(newMerchAddress),
      ...bindStageFields(),
    });
    setNewMerchantModalOpen(false);
  };

    const handleExportCsv = () => {
    if (filteredMerchants.length === 0) {
      return;
    }
    const headers = [
      'No.',
      'MID',
      'Merchant Name',
      'Staff Name',
      'Branch Code & Name',
      'Device Type',
      'Serial Number',
      'Installed Date',
      'Status',
    ];
    const rows = filteredMerchants.map((m, idx) => {
      const statusLabel = m.crmStatus === 'ONBOARDING' ? 'Pending install' : m.crmStatus === 'ATTENTION' ? 'Faulty / RMA' : 'Live';
      const installDate = m.devices.find((d) => Boolean(d.deployedDate))?.deployedDate || '—';
      const branchFormatted = `${m.branchId} · ${m.branchName.replace(' Branch', '')}`;
      const typeDisplay = [
        m.posCount > 0 ? `POS Terminal${m.posCount > 1 ? ` ×${m.posCount}` : ''}` : '',
        m.sbCount > 0 ? `Sound Box${m.sbCount > 1 ? ` ×${m.sbCount}` : ''}` : '',
      ].filter(Boolean).join(', ') || '-';
      const serials = m.devices.map((d) => d.serial).join(', ') || '-';

      return [
        String(idx + 1),
        m.mid,
        m.merchantName || '—',
        m.accountOfficer || '—',
        branchFormatted,
        typeDisplay,
        serials,
        installDate,
        statusLabel,
      ];
    });

    const url = URL.createObjectURL(csvFile([headers, ...rows]));
    const link = document.createElement('a');
    link.href = url;
    link.download = `Merchant_CRM_Registry_${todayPP()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

return (
    <div className="flex flex-col gap-4">
      {/* One shared list of bindable serials for every serial input on this tab */}
      <datalist id="crm-bindable-serials">
        {availableReserveDevices.map((d) => (
          <option key={d.serial} value={d.serial}>
            {d.model} ({d.type} • Code {d.branchId})
          </option>
        ))}
      </datalist>

      {/* Top CRM Banner */}
      <div
        className={`${cardClass} rounded-xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4`}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#003857]/12 text-[#003857] dark:text-[#7cc4ed] flex items-center justify-center shrink-0">
            <Store className="w-5 h-5" />
          </div>
          <div>
            <h2
              className={`text-base sm:text-lg font-bold tracking-tight ${headingClass}`}
            >
              Merchant Deployment &amp; Hardware Registry
            </h2>
            <p className={`text-xs ${subtextClass}`}>
              Manage merchant accounts (MID) and deployed POS Terminals &amp; Sound Boxes (TID)
            </p>
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowTrendChart((prev) => !prev)}
            className={`px-3 py-2 rounded-lg text-xs font-semibold border flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              showTrendChart
                ? 'bg-[#003857] text-white border-[#004469]'
                : isLight
                ? 'bg-slate-50 hover:bg-slate-100 text-[#003857] border-slate-300'
                : 'bg-[#001d2e] hover:bg-[#002a42] text-slate-200 border-[#003857]'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>{showTrendChart ? 'Hide Trends' : 'Trends Chart'}</span>
          </button>
        </div>
      </div>

      {/* 4 CRM Executive Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className={`${cardClass} rounded-xl p-4 flex flex-col justify-between`}>
          <div className="flex items-center justify-between">
            <span className={`text-xs font-semibold ${subtextClass}`}>
              Active Merchants
            </span>
            <div className="w-8 h-8 rounded-lg bg-[#003857]/12 text-[#003857] dark:text-[#7cc4ed] flex items-center justify-center">
              <Store className="w-4 h-4" />
            </div>
          </div>
          <div
            className={`text-2xl sm:text-3xl font-extrabold font-figure tabular-nums mt-2 ${headingClass}`}
          >
            {totalMerchants}
          </div>
          <div className="flex items-center justify-between text-xs text-slate-400 mt-2 pt-2 border-t border-slate-200/60 dark:border-slate-800/80">
            <span>Registered MIDs</span>
            <span className="text-emerald-400 font-semibold font-figure">{activeMerchants} Live</span>
          </div>
        </div>

        <div className={`${cardClass} rounded-xl p-4 flex flex-col justify-between`}>
          <div className="flex items-center justify-between">
            <span className={`text-xs font-semibold ${subtextClass}`}>
              Device Replacements &amp; Swaps
            </span>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/12 text-emerald-400 flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div
            className={`text-2xl sm:text-3xl font-extrabold font-figure tabular-nums mt-2 ${headingClass}`}
          >
            {bundleMerchants}
          </div>
          <div className="flex items-center justify-between text-xs text-slate-400 mt-2 pt-2 border-t border-slate-200/60 dark:border-slate-800/80">
            <span>POS (2…) &bull; SB (6…)</span>
            <span className="text-[#003857] dark:text-[#7cc4ed] font-semibold">Swapped Units</span>
            {/* Removed Full Suite */}
          </div>
        </div>

        <div className={`${cardClass} rounded-xl p-4 flex flex-col justify-between`}>
          <div className="flex items-center justify-between">
            <span className={`text-xs font-semibold ${subtextClass}`}>
              Pending Installation
            </span>
            <div className="w-8 h-8 rounded-lg bg-amber-500/12 text-amber-400 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div
            className={`text-2xl sm:text-3xl font-extrabold font-figure tabular-nums mt-2 ${headingClass}`}
          >
            {onboardingMerchants}
          </div>
          <div className="flex items-center justify-between text-xs text-slate-400 mt-2 pt-2 border-t border-slate-200/60 dark:border-slate-800/80">
            <span>Setup / Dispatch</span>
            <span className="text-amber-400 font-semibold">In Queue</span>
          </div>
        </div>

        <div className={`${cardClass} rounded-xl p-4 flex flex-col justify-between`}>
          <div className="flex items-center justify-between">
            <span className={`text-xs font-semibold ${subtextClass}`}>
              Support &amp; RMA
            </span>
            <div className="w-8 h-8 rounded-lg bg-rose-500/12 text-rose-400 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div
            className={`text-2xl sm:text-3xl font-extrabold font-figure tabular-nums mt-2 ${headingClass}`}
          >
            {attentionMerchants}
          </div>
          <div className="flex items-center justify-between text-xs text-slate-400 mt-2 pt-2 border-t border-slate-200/60 dark:border-slate-800/80">
            <span>Faulty / Swap</span>
            <span className="text-rose-400 font-semibold">Priority</span>
          </div>
        </div>
      </div>

      {/* Recharts Data Visualization Section: Monthly Hardware Deployment Trends per Merchant MID */}
      {showTrendChart && (
      <div className={`${cardClass} rounded-xl p-4 sm:p-5 flex flex-col gap-4`}>
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#003857]/12 text-[#003857] dark:text-[#7cc4ed] flex items-center justify-center shrink-0">
              <BarChart3 className="w-4.5 h-4.5" />
            </div>
            <div>
              <h3 className={`text-sm sm:text-base font-bold ${headingClass}`}>
                Monthly Hardware Deployment Trends
              </h3>
              <p className={`text-xs ${subtextClass}`}>
                {selectedTrendMid === 'ALL'
                  ? `Showing all ${filteredMerchants.length} filtered MIDs`
                  : `Focused MID: ${selectedTrendMid}`}
              </p>
            </div>
          </div>

          {/* Interactive Chart Controls */}
          <div className="flex items-center flex-wrap gap-2">
            {/* Merchant MID Selector */}
            <select
              value={selectedTrendMid}
              onChange={(e) => setSelectedTrendMid(e.target.value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-mono border focus:outline-none ${inputClass}`}
              title="Filter deployment trend by specific Merchant MID"
            >
              <option value="ALL">All Filtered Merchants (MID Aggregate)</option>
              {trendMidOptions.map((m) => (
                <option key={m.mid} value={m.mid}>
                  {m.mid} — {dash(m.merchantName)} ({m.posCount} POS / {m.sbCount} SB)
                </option>
              ))}
              {merchantProfiles.length > trendMidOptions.length && (
                <option disabled value="__more">… {merchantProfiles.length - trendMidOptions.length} more – use the search above to narrow the list</option>
              )}
            </select>

            {/* Chart Mode Toggle */}
            <div
              className={`flex items-center p-0.5 rounded-lg border text-xs ${
                isLight ? 'bg-slate-100 border-slate-200' : 'bg-[#001d2e] border-[#003857]'
              }`}
            >
              <button
                type="button"
                onClick={() => setTrendChartMode('POS_VS_SB')}
                className={`px-2.5 py-1 rounded-md font-semibold transition ${
                  trendChartMode === 'POS_VS_SB'
                    ? 'tab-active-blue text-white shadow-2xs'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                POS vs. Sound Box
              </button>
              <button
                type="button"
                onClick={() => setTrendChartMode('BY_MID_STACKED')}
                className={`px-2.5 py-1 rounded-md font-semibold transition ${
                  trendChartMode === 'BY_MID_STACKED'
                    ? 'tab-active-blue text-white shadow-2xs'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Per-MID Comparison
              </button>
            </div>

            {/* Time Horizon Toggle */}
            <div
              className={`flex items-center p-0.5 rounded-lg border text-xs font-mono ${
                isLight ? 'bg-slate-100 border-slate-200' : 'bg-[#001d2e] border-[#003857]'
              }`}
            >
              <button
                type="button"
                onClick={() => setTrendHorizon('6M')}
                className={`px-2.5 py-1 rounded-md font-bold transition ${
                  trendHorizon === '6M'
                    ? 'tab-active-blue text-white shadow-2xs'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                6M
              </button>
              <button
                type="button"
                onClick={() => setTrendHorizon('12M')}
                className={`px-2.5 py-1 rounded-md font-bold transition ${
                  trendHorizon === '12M'
                    ? 'tab-active-blue text-white shadow-2xs'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                12M
              </button>
            </div>
          </div>
        </div>

        {/* Quick MID Pill Selector Strip */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          <button
            type="button"
            onClick={() => setSelectedTrendMid('ALL')}
            className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-bold border transition shrink-0 ${
              selectedTrendMid === 'ALL'
                ? 'bg-[#003857] text-white border-[#005a8c]'
                : isLight
                ? 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                : 'bg-[#001d2e] text-slate-400 border-[#003857] hover:text-slate-200'
            }`}
          >
            All MIDs ({filteredMerchants.length})
          </button>
          {topMerchantsForTrend.map((m, idx) => {
            const active = selectedTrendMid === m.mid;
            const dotColor = MID_SERIES_COLORS[idx % MID_SERIES_COLORS.length];
            return (
              <button
                key={m.mid}
                type="button"
                onClick={() => setSelectedTrendMid(active ? 'ALL' : m.mid)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-mono border transition flex items-center gap-1.5 shrink-0 ${
                  active
                    ? 'bg-[#003857] text-white border-[#005a8c] font-bold'
                    : isLight
                    ? 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    : 'bg-[#001d2e] text-slate-300 border-[#003857] hover:border-[#005a8c]'
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: dotColor }}
                />
                <span>{m.mid}</span>
                <span className="text-[10px] opacity-70 truncate max-w-[110px]">
                  {dash(m.merchantName)}
                </span>
              </button>
            );
          })}
        </div>

        {/* Recharts Responsive Canvas */}
        {!trendHasData ? (
          <div className={`h-40 w-full flex flex-col items-center justify-center text-center rounded-xl border border-dashed ${isLight ? 'border-slate-300' : 'border-[#003857]'}`}>
            <BarChart3 className="w-5 h-5 text-slate-400 mb-1.5" />
            <p className={`text-xs font-semibold ${headingClass}`}>No deployments recorded in this period</p>
            <p className={`text-[11px] ${subtextClass}`}>
              Units are counted in the month of their installation date ({trendMonths[0]?.label} – {trendMonths[trendMonths.length - 1]?.label}).
            </p>
          </div>
        ) : (
        <div className="h-72 w-full pt-1">
          <ResponsiveContainer width="100%" height="100%">
            {trendChartMode === 'POS_VS_SB' ? (
              <ComposedChart
                data={monthlyDeploymentTrendData}
                margin={{ top: 10, right: 16, left: -12, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="cumFleetGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#005a8c" stopOpacity={0.32} />
                    <stop offset="95%" stopColor="#003857" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={isLight ? '#e2e8f0' : 'rgba(255,255,255,0.07)'}
                  vertical={false}
                />
                <XAxis
                  dataKey="month"
                  tick={{ fill: isLight ? '#002f49' : '#94a3b8', fontSize: 11, fontWeight: 600, fontFamily: 'Plus Jakarta Sans, sans-serif' }}
                  axisLine={{ stroke: isLight ? '#cbd8e3' : '#003857' }}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="left"
                  allowDecimals={false}
                  tick={{ fill: isLight ? '#5b7083' : '#94a3b8', fontSize: 11, fontWeight: 600, fontFamily: 'Plus Jakarta Sans, sans-serif' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  allowDecimals={false}
                  tick={{ fill: '#005a8c', fontSize: 11, fontWeight: 600, fontFamily: 'Plus Jakarta Sans, sans-serif' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: isLight ? '#ffffff' : '#001d2e',
                    borderColor: isLight ? '#cbd8e3' : '#003857',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontFamily: 'Plus Jakarta Sans, sans-serif',
                    fontWeight: 600,
                    color: isLight ? '#002f49' : '#f8fafc',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', fontWeight: 600, fontFamily: 'Plus Jakarta Sans, sans-serif', paddingTop: '8px' }} />
                <Area
                  yAxisId="right"
                  type="monotone"
                  dataKey="cumulativeFleet"
                  name="Cumulative Deployed Units"
                  stroke="#005a8c"
                  strokeWidth={2}
                  fill="url(#cumFleetGrad)"
                />
                <Bar
                  yAxisId="left"
                  dataKey="posDeployed"
                  name="POS Terminal Deployed"
                  fill="#003857"
                  radius={[5, 5, 0, 0]}
                  barSize={22}
                />
                <Bar
                  yAxisId="left"
                  dataKey="sbDeployed"
                  name="Sound Box Deployed"
                  fill="#10b981"
                  radius={[5, 5, 0, 0]}
                  barSize={22}
                />
              </ComposedChart>
            ) : (
              <BarChart
                data={monthlyDeploymentTrendData}
                margin={{ top: 10, right: 16, left: -12, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={isLight ? '#e2e8f0' : 'rgba(255,255,255,0.07)'}
                  vertical={false}
                />
                <XAxis
                  dataKey="month"
                  tick={{ fill: isLight ? '#002f49' : '#94a3b8', fontSize: 11, fontWeight: 600, fontFamily: 'Plus Jakarta Sans, sans-serif' }}
                  axisLine={{ stroke: isLight ? '#cbd8e3' : '#003857' }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: isLight ? '#5b7083' : '#94a3b8', fontSize: 11, fontWeight: 600, fontFamily: 'Plus Jakarta Sans, sans-serif' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: isLight ? '#ffffff' : '#001d2e',
                    borderColor: isLight ? '#cbd8e3' : '#003857',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontFamily: 'Plus Jakarta Sans, sans-serif',
                    fontWeight: 600,
                    color: isLight ? '#002f49' : '#f8fafc',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', fontWeight: 600, fontFamily: 'Plus Jakarta Sans, sans-serif', paddingTop: '8px' }} />
                {topMerchantsForTrend.map((m, idx) => (
                  <Bar
                    key={m.mid}
                    dataKey={m.mid}
                    name={`${m.mid} (${(m.merchantName || '—').slice(0, 16)})`}
                    stackId="midStack"
                    fill={MID_SERIES_COLORS[idx % MID_SERIES_COLORS.length]}
                    radius={idx === topMerchantsForTrend.length - 1 ? [5, 5, 0, 0] : [0, 0, 0, 0]}
                    barSize={28}
                  />
                ))}
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
        )}
      </div>
      )}

      {/* Filter & Search Bar */}
      <div
        className={`${cardClass} border rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5`}
      >
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={canSeeFullContact(role) ? 'Search MID, merchant, phone, serial...' : 'Search MID, merchant, serial...'}
            aria-label="Search merchants"
            className={`w-full rounded-xl pl-8 pr-3 py-2 text-xs border focus:outline-none ${inputClass}`}
          />
        </div>

        <select
          value={branchFilter}
          onChange={(e) => setBranchFilter(e.target.value)}
          disabled={role === 'BRANCH'}
          className={`rounded-xl px-3 py-2 text-xs border focus:outline-none ${inputClass}`}
        >
          <option value="ALL">All Branches (32 Branches)</option>
          {branches
            .filter((b) => b.id !== '100')
            .map((b) => (
              <option key={b.id} value={b.id}>
                Code {b.id} — {b.name.replace(' Branch', '')}
              </option>
            ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className={`rounded-xl px-3 py-2 text-xs border focus:outline-none ${inputClass}`}
        >
          <option value="ALL">All Support Statuses</option>
          <option value="ACTIVE">Installed &amp; Live</option>
          <option value="ONBOARDING">Pending Install / Setup</option>
          <option value="ATTENTION">Needs Support / Faulty</option>
        </select>

        <select
          value={bundleFilter}
          onChange={(e) => setBundleFilter(e.target.value as any)}
          className={`rounded-xl px-3 py-2 text-xs border focus:outline-none ${inputClass}`}
        >
          <option value="ALL">All Hardware Configurations</option>
          <option value="BUNDLE_BOTH">Replaced / Swapped Hardware</option>
          <option value="POS_ONLY">POS Terminal Only</option>
          <option value="SB_ONLY">Sound Box Only</option>
        </select>

        <select
          value={deviceCountFilter}
          onChange={(e) => setDeviceCountFilter(e.target.value as any)}
          className={`rounded-xl px-3 py-2 text-xs border focus:outline-none ${inputClass}`}
        >
          <option value="ALL">All Device Counts</option>
          <option value="1">1 Device per MID</option>
          <option value="2+">2+ Devices / In Swap</option>
        </select>

        <ClearFiltersButton active={!!search || branchFilter !== (role === 'BRANCH' ? activeBranchId : 'ALL') || statusFilter !== 'ALL' || bundleFilter !== 'ALL' || deviceCountFilter !== 'ALL'} onClear={handleResetFilters} />
      </div>

      {/* Merchant 360 Registry Table (22 Oct 2026: one clean style, Khmer in Battambang) */}
      <div className={`${cardClass} border rounded-xl overflow-hidden`}>
        <div className="p-3.5 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-black uppercase tracking-wider text-[#003857] dark:text-sky-400">
              Merchant 360 Registry
            </span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${isLight ? 'bg-slate-100 text-slate-700 border border-slate-200' : 'bg-slate-800 text-slate-300 border border-slate-700'}`}>
              {filteredMerchants.length} Merchant{filteredMerchants.length === 1 ? '' : 's'}
            </span>
          </div>
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={filteredMerchants.length === 0}
            className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer transition shadow-2xs disabled:opacity-50"
            title="Export Merchant 360 Registry Table to CSV (matching table columns)"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Export CSV</span>
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table min-w-[900px]">
            <thead className="glass-table-thead">
              <tr>
                <th className="col-no">No.</th>
                <SortTh k="mid" sort={crmSort} onSort={crmToggle}>MID</SortTh>
                <SortTh k="merchant" sort={crmSort} onSort={crmToggle}>Merchant Name</SortTh>
                <SortTh k="staff" sort={crmSort} onSort={crmToggle}>Staff Name</SortTh>
                <SortTh k="device" sort={crmSort} onSort={crmToggle}>Device Type</SortTh>
                <SortTh k="serial" sort={crmSort} onSort={crmToggle}>Serial Number</SortTh>
                <SortTh k="installed" sort={crmSort} onSort={crmToggle}>Installed Date</SortTh>
                <SortTh k="status" sort={crmSort} onSort={crmToggle}>Status</SortTh>
                <th className="text-right col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pagedMerchants.map((m, rowIdx) => {
                const chip = m.crmStatus === 'ONBOARDING' ? 'chip-amber' : m.crmStatus === 'ATTENTION' ? 'chip-red' : 'chip-green';
                const statusLabel = m.crmStatus === 'ONBOARDING' ? 'Pending install' : m.crmStatus === 'ATTENTION' ? 'Faulty / RMA' : 'Live';
                const installDate = m.devices.find((d) => Boolean(d.deployedDate))?.deployedDate || '—';
                const deviceCount = m.devices ? m.devices.length : 0;
                return (
                  <tr key={m.mid}>
                    <td className="col-no">{(merchantPage - 1) * merchantsPerPage + rowIdx + 1}</td>
                    <td className="whitespace-nowrap">
                      <div className={`cell-mono ${isValidMidForType(m.mid, m.devices[0]?.type) ? '' : 'warn-text'}`} title={isValidMidForType(m.mid, m.devices[0]?.type) ? `MID (${m.devices[0]?.type === 'Sound Box' ? 'Starts with 6' : 'Starts with 2'})` : midRuleError(m.mid, m.devices[0]?.type)}>
                        {m.mid}{isValidMidForType(m.mid, m.devices[0]?.type) ? '' : ' ⚠'}
                        {/* Validated by device type */}
                      </div>
                      {deviceCount > 1 && <div className="cell-sub">{deviceCount} units</div>}
                    </td>
                    <td>
                      <div className={`cell-main max-w-[230px] truncate ${hasKhmer(m.merchantName) ? 'khmer' : ''}`} title={m.merchantName}>
                        {dash(m.merchantName)}
                      </div>
                    </td>
                    <td>
                      <div className={`cell-main font-medium max-w-[190px] truncate ${hasKhmer(m.accountOfficer) ? 'khmer' : ''}`} title={m.accountOfficer}>
                        {dash(m.accountOfficer)}
                      </div>
                      <div className="cell-sub max-w-[190px] truncate">
                        Code {m.branchId} · {m.branchName.replace(' Branch', '')}
                      </div>
                    </td>
                    <td className="whitespace-nowrap">
                      {m.posCount > 0 && (
                        <div className="cell-main font-medium flex items-center gap-1.5">
                          <Cpu className="w-3.5 h-3.5 text-sky-600 shrink-0" aria-hidden />
                          POS Terminal{m.posCount > 1 ? ` ×${m.posCount}` : ''}
                        </div>
                      )}
                      {m.sbCount > 0 && (
                        <div className="cell-main font-medium flex items-center gap-1.5">
                          <Volume2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" aria-hidden />
                          Sound Box{m.sbCount > 1 ? ` ×${m.sbCount}` : ''}
                        </div>
                      )}
                      {m.posCount === 0 && m.sbCount === 0 && <span className="cell-sub">—</span>}
                    </td>
                    <td>
                      {deviceCount > 0 ? (
                        <div className="flex flex-wrap gap-1.5 max-w-[300px]">
                          {m.devices.map((dev) => (
                            <button
                              key={dev.serial}
                              type="button"
                              onClick={() => onOpenWorkflow(dev.serial)}
                              title={`Open ${dev.serial}${dev.model ? ` (${dev.model})` : ''}`}
                              className="serial-btn"
                            >
                              {dev.serial}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span className="cell-sub">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      <div className="cell-mono">{installDate}</div>
                    </td>
                    <td className="whitespace-nowrap">
                      <span className={`chip ${chip}`}>{statusLabel}</span>
                    </td>
                    <td className="text-right col-actions">
                      <button type="button" onClick={() => setSelectedMid(m.mid)} className="row-btn" title="Open the merchant's 360 view">
                        360 View
                      </button>
                    </td>
                  </tr>
                );
              })}

              {filteredMerchants.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-12 text-center">
                    <span className="cell-sub">No merchants match the search or filters.</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* High-Throughput Merchant Pagination Footer */}
        {filteredMerchants.length > 0 && (
          <div
            className={`px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3 border-t text-xs ${
              isLight
                ? 'bg-slate-50 border-slate-200 text-slate-600'
                : 'bg-white/[0.02] border-white/[0.08] text-slate-400'
            }`}
          >
            <div className="flex items-center gap-2">
              <span>
                Showing{' '}
                <strong className={isLight ? 'text-zinc-900' : 'text-white'}>
                  {((merchantPage - 1) * merchantsPerPage + 1).toLocaleString()}
                </strong>{' '}
                to{' '}
                <strong className={isLight ? 'text-zinc-900' : 'text-white'}>
                  {Math.min(merchantPage * merchantsPerPage, filteredMerchants.length).toLocaleString()}
                </strong>{' '}
                of{' '}
                <strong className={isLight ? 'text-zinc-900' : 'text-white'}>
                  {filteredMerchants.length.toLocaleString()}
                </strong>{' '}
                merchants
              </span>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px]">Rows per page:</span>
                <select
                  value={merchantsPerPage}
                  onChange={(e) => {
                    setMerchantsPerPage(Number(e.target.value));
                    setMerchantPage(1);
                  }}
                  className={`text-xs rounded-lg px-2 py-1 border outline-none font-semibold cursor-pointer ${
                    isLight
                      ? 'bg-white border-slate-300 text-slate-800'
                      : 'bg-zinc-800 border-white/10 text-slate-200'
                  }`}
                >
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setMerchantPage((p) => Math.max(1, p - 1))}
                  disabled={merchantPage <= 1}
                  className={`p-1.5 rounded-lg border transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                    isLight
                      ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                      : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                  }`}
                  title="Previous Page"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <span className="px-2 font-mono text-[11px] font-bold">
                  Page {merchantPage} of {totalMerchantPages}
                </span>

                <button
                  type="button"
                  onClick={() => setMerchantPage((p) => Math.min(totalMerchantPages, p + 1))}
                  disabled={merchantPage >= totalMerchantPages}
                  className={`p-1.5 rounded-lg border transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                    isLight
                      ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                      : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                  }`}
                  title="Next Page"
                  aria-label="Next page"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {/* Merchant 360 Detail Modal (Portaled to document.body like Stock Inventory Manage Modal) */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {selectedMerchantProfile && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setSelectedMid(null)}
                  className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm"
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: 14 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 12 }}
                  transition={{ type: 'spring', damping: 32, stiffness: 480, mass: 0.6 }}
                  className={`relative w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden my-auto max-h-[92vh] z-10 border-0 flex flex-col ${
                    isLight
                      ? 'bg-white text-slate-800'
                      : 'bg-[#12151e] text-slate-100'
                  }`}
                >
              <div className="navy-header-bar px-6 py-4 flex items-center justify-between text-white">
                <div>
                  <div className="flex items-center gap-2 text-xs text-cyan-400 font-mono">
                    <span>MERCHANT 360 PROFILE</span>
                    <span>&bull;</span>
                    <span>{selectedMerchantProfile.mid}</span>
                  </div>
                  <h3 className="text-lg font-extrabold tracking-tight mt-0.5">
                    {dash(selectedMerchantProfile.merchantName)}
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  {role !== 'BRANCH' && (
                    <button
                      type="button"
                      onClick={() => {
                        const target = selectedMerchantProfile;
                        setSelectedMid(null);
                        handleOpenBindModal(target);
                      }}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#004953] hover:bg-[#003840] text-emerald-200 border border-emerald-500/30 flex items-center gap-1.5 transition cursor-pointer shadow-sm hover:scale-[1.02]"
                      title="Bind an additional POS Terminal or Sound Box to this merchant store"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Bind Additional Unit</span>
                    </button>
                  )}
                  {onTerminateMerchant && (
                    <button
                      type="button"
                      onClick={() => {
                        const m = selectedMerchantProfile;
                        setSelectedMid(null);
                        handleOpenTerminateModal(m);
                      }}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 flex items-center gap-1.5 transition cursor-pointer shadow-sm"
                      title="Return assigned hardware units back to branch reserve or HQ stock"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Return Hardware</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSelectedMid(null)}
                    aria-label="Close merchant profile"
                    title="Close"
                    className="p-1.5 rounded-full text-slate-300 hover:text-white hover:bg-white/10 transition cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="p-6 flex flex-col gap-5 max-h-[80vh] overflow-y-auto custom-scrollbar">
                {/* Merchant Metadata Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div
                    className={`p-3.5 rounded-2xl border ${
                      isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#091729] border-[#1a355a]'
                    }`}
                  >
                    <div className="text-[11px] text-slate-400 font-semibold uppercase">
                      Contact
                    </div>
                    <div className="font-mono font-bold text-xs mt-1 text-cyan-400">
                      {phoneFor(role, selectedMerchantProfile.merchantPhone)}
                    </div>
                  </div>

                  <div
                    className={`p-3.5 rounded-2xl border ${
                      isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#091729] border-[#1a355a]'
                    }`}
                  >
                    <div className="text-[11px] text-slate-400 font-semibold uppercase">
                      Servicing Branch
                    </div>
                    <div className="font-bold text-xs mt-1 flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-cyan-400" />
                      <span>
                        Code {selectedMerchantProfile.branchId} —{' '}
                        {selectedMerchantProfile.branchName}
                      </span>
                    </div>
                    <div className="text-xs mt-0.5 opacity-85">
                      Staff Name: {dash(selectedMerchantProfile.accountOfficer)}
                    </div>
                  </div>

                  <div
                    className={`p-3.5 rounded-2xl border ${
                      isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#091729] border-[#1a355a]'
                    }`}
                  >
                    <div className="text-[11px] text-slate-400 font-semibold uppercase">
                      Hardware Summary
                    </div>
                    <div className="font-mono font-bold text-xs mt-1">
                      {selectedMerchantProfile.posCount} POS &bull;{' '}
                      {selectedMerchantProfile.sbCount} Sound Box
                    </div>
                    <div className="text-xs mt-0.5 text-emerald-400 font-semibold">
                      {selectedMerchantProfile.liveCount} Units Live at Store
                    </div>
                  </div>
                </div>

                {/* Assigned Hardware Units List */}
                <div>
                  <div className="flex items-center justify-between mb-2.5">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      Assigned Hardware Serials &amp; Terminal IDs (TID)
                    </h4>
                    <div className="flex items-center gap-3 flex-wrap">
                      {onReplaceMerchantDevice && selectedMerchantProfile.devices.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            const dev = selectedMerchantProfile.devices[0];
                            setReplaceModalDevice(dev);
                            const branchCandidates = availableReserveDevices.filter(
                              (c) => c.type === dev.type && c.branchId === dev.branchId
                            );
                            const fallbackCandidates = availableReserveDevices.filter(
                              (c) => c.type === dev.type
                            );
                            const firstPick = branchCandidates[0] || fallbackCandidates[0];
                            setReplaceNewSerial(firstPick ? firstPick.serial : '');
                            setReplaceStaffName(activeStaff || dev.staff || selectedMerchantProfile.accountOfficer || '');
                            setReplaceReason('Broken / Hardware Malfunction');
                          }}
                          className="px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Record Device Replacement (Broken / Swap)</span>
                        </button>
                      )}

                    </div>
                  </div>
                  {replaceModalDevice && onReplaceMerchantDevice && (
                    <div className={`mb-4 p-4 rounded-2xl border-2 border-amber-400/70 ${isLight ? 'bg-amber-50/90 text-slate-900' : 'bg-amber-950/30 text-slate-100'} flex flex-col gap-3`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-extrabold text-amber-700 dark:text-amber-300">
                          <RefreshCw className="w-4 h-4" />
                          <span>Device Replacement &amp; Broken Hardware Swap Tracker</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setReplaceModalDevice(null)}
                          className="text-xs font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                      <p className="text-[11px] opacity-85">
                        Swapping broken device <strong className="font-mono">{replaceModalDevice.serial}</strong> on MID <strong className="font-mono">{selectedMerchantProfile.mid}</strong>. The new serial will replace the broken serial on the front table while recording the staff member and previous serial in 360 history.
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 text-xs">
                        <div>
                          <label className="block text-[10px] font-bold uppercase mb-1">Broken Serial (Out)</label>
                          <select
                            value={replaceModalDevice.serial}
                            onChange={(e) => {
                              const found = selectedMerchantProfile.devices.find((d) => d.serial === e.target.value);
                              if (found) setReplaceModalDevice(found);
                            }}
                            className={`w-full rounded-xl px-2.5 py-1.5 border font-mono text-xs ${inputClass}`}
                          >
                            {selectedMerchantProfile.devices.map((d) => (
                              <option key={d.serial} value={d.serial}>{d.serial} ({d.type})</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold uppercase mb-1">New Replacement Serial (In) *</label>
                          <input
                            type="text"
                            list="crm-bindable-serials"
                            value={replaceNewSerial}
                            onChange={(e) => setReplaceNewSerial(e.target.value.toUpperCase())}
                            placeholder="Select or type new SN..."
                            className={`w-full rounded-xl px-2.5 py-1.5 border font-mono text-xs ${inputClass}`}
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold uppercase mb-1">Staff Who Replaced Device *</label>
                          <input
                            type="text"
                            value={replaceStaffName}
                            onChange={(e) => setReplaceStaffName(e.target.value)}
                            placeholder="Staff full name..."
                            className={`w-full rounded-xl px-2.5 py-1.5 border text-xs ${inputClass}`}
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold uppercase mb-1">Replacement Reason *</label>
                          <select
                            value={replaceReason}
                            onChange={(e) => setReplaceReason(e.target.value)}
                            className={`w-full rounded-xl px-2.5 py-1.5 border text-xs ${inputClass}`}
                          >
                            <option value="Broken / Hardware Malfunction">Broken / Hardware Malfunction</option>
                            <option value="Battery Degraded / Power Fault">Battery Degraded / Power Fault</option>
                            <option value="Screen / Printer / Audio Fault">Screen / Printer / Audio Fault</option>
                            <option value="Connectivity / SIM Module Fault">Connectivity / SIM Module Fault</option>
                          </select>
                        </div>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          disabled={!replaceNewSerial.trim() || !replaceStaffName.trim() || replaceNewSerial.trim().toUpperCase() === replaceModalDevice.serial.toUpperCase()}
                          onClick={() => {
                            onReplaceMerchantDevice(
                              replaceModalDevice.serial,
                              replaceNewSerial.trim().toUpperCase(),
                              replaceStaffName.trim(),
                              replaceReason
                            );
                            setReplaceModalDevice(null);
                          }}
                          className="px-4 py-1.5 rounded-xl text-xs font-extrabold bg-[#003857] hover:bg-[#002a42] text-white shadow-xs transition cursor-pointer disabled:opacity-40"
                        >
                          Confirm Device Replacement &amp; Update Front Table
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="hidden">
                    <h4>
                    </h4>
                    <button
                      type="button"
                      onClick={() => {
                        const target = selectedMerchantProfile;
                        setSelectedMid(null);
                        handleOpenBindModal(target);
                      }}
                      className="text-xs font-bold text-cyan-400 hover:underline flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Bind Additional Serial</span>
                    </button>
                  </div>

                  <div className="flex flex-col gap-2.5">
                    {selectedMerchantProfile.devices.map((dev) => {
                      const st = STAGE_META[dev.stage] || STAGE_META.BRANCH_RESERVE;
                      const badge = isLight ? st.badgeClassLight : st.badgeClassDark;
                      return (
                        <div
                          key={dev.serial}
                          className={`p-3.5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                            isLight
                              ? 'bg-slate-50 border-slate-200'
                              : 'bg-[#091729] border-[#1a355a]'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                              <Cpu className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs text-slate-700">
                                  {dev.serial}
                                </span>
                                <span className="text-xs text-slate-600">{dev.model}</span>
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${badge}`}
                                >
                                  {st.short}
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-400 mt-1 font-mono">
                                MID: {dash(dev.mid)} &bull; TID: {dash(dev.tid)} &bull;
                                Updated: {dash(dev.updatedAt)}
                              </div>
                              <div className="flex items-center gap-2 mt-1.5 text-[11px] flex-wrap">
                                <span className="text-slate-500">
                                  Installer:{' '}
                                  <strong className="text-slate-800 dark:text-slate-200">
                                    {dash(dev.installedByStaff || dev.staff || selectedMerchantProfile.accountOfficer)}
                                  </strong>
                                </span>
                                {dev.replacedByStaff && (
                                  <>
                                    <span className="text-slate-300 dark:text-slate-700">&bull;</span>
                                    <span className="text-slate-500">
                                      Replaced by:{' '}
                                      <strong
                                        className={
                                          dev.replacedByStaff !== (dev.installedByStaff || dev.staff || selectedMerchantProfile.accountOfficer)
                                            ? 'text-amber-700 dark:text-amber-400 font-bold'
                                            : 'text-slate-800 dark:text-slate-200'
                                        }
                                      >
                                        {dev.replacedByStaff}
                                      </strong>
                                    </span>
                                    {dev.replacedPrevSerial && (
                                      <span className="px-1.5 py-0.2 rounded text-[9.5px] font-mono font-bold bg-sky-50 text-sky-800 border border-sky-200 dark:bg-sky-500/20 dark:text-sky-300 dark:border-sky-500/30">
                                        Replaced Old SN: {dev.replacedPrevSerial}{dev.replacedDate ? ` (${dev.replacedDate})` : ''}
                                      </span>
                                    )}
                                    {dev.replacedByStaff !== (dev.installedByStaff || dev.staff || selectedMerchantProfile.accountOfficer) && (
                                      <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-amber-50 text-amber-800 border border-amber-300 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/30">
                                        Different Person
                                      </span>
                                    )}
                                  </>
                                )}
                                {dev.returnedByStaff && (
                                  <>
                                    <span className="text-slate-300 dark:text-slate-700">&bull;</span>
                                    <span className="text-slate-500">
                                      Returned by:{' '}
                                      <strong
                                        className={
                                          dev.returnedByStaff !== (dev.installedByStaff || dev.staff || selectedMerchantProfile.accountOfficer)
                                            ? 'text-indigo-700 dark:text-indigo-400 font-bold'
                                            : 'text-slate-800 dark:text-slate-200'
                                        }
                                      >
                                        {dev.returnedByStaff}
                                      </strong>
                                    </span>
                                    {dev.returnedByStaff !== (dev.installedByStaff || dev.staff || selectedMerchantProfile.accountOfficer) && (
                                      <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-indigo-50 text-indigo-800 border border-indigo-300 dark:bg-indigo-500/20 dark:text-indigo-300 dark:border-indigo-500/30">
                                        Different Person
                                      </span>
                                    )}
                                  </>
                                )}
                              </div>
                              {dev.note && (
                                <div className="text-[11px] text-slate-400 mt-0.5 italic">
                                  Note: {dev.note}
                                </div>
                              )}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setSelectedMid(null);
                              onOpenWorkflow(dev.serial);
                            }}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#003857] hover:bg-[#002a42] text-white transition shrink-0 cursor-pointer shadow-xs"
                          >
                            Update Lifecycle
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
          </AnimatePresence>,
          document.body
        )}

      {/* Bind Additional Hardware Serial Modal (with Real-Time TID Duplicate & Format Check) */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {bindModalMerchant && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-md">
                <motion.form
                  initial={{ opacity: 0, scale: 0.95, y: 14 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 12 }}
                  transition={{ type: 'spring', damping: 32, stiffness: 480, mass: 0.6 }}
                  onSubmit={handleConfirmBindDevice}
                  className={`w-full max-w-2xl rounded-3xl border overflow-hidden shadow-2xl transform-gpu will-change-gpu gpu-modal-container ${
                    isLight
                      ? 'bg-white border-slate-200 text-slate-800'
                      : 'bg-[#0c1a2e] border-[#1d3b66] text-slate-100'
                  }`}
                >
                  <div className="navy-header-bar px-6 py-4 flex items-center justify-between text-white">
                    <div>
                      <h3 className="text-sm font-bold">Bind Hardware Serial to Merchant</h3>
                      <p className="text-[11px] text-cyan-300 font-mono">
                        {bindModalMerchant.mid} — {dash(bindModalMerchant.merchantName)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setBindModalMerchant(null)}
                      aria-label="Close bind dialog"
                      title="Close"
                      className="p-1 rounded-full text-slate-300 hover:text-white"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="p-6 flex flex-col gap-4 text-xs">
                    <div>
                      <label htmlFor="crm-bind-serial" className="block font-semibold mb-1.5">
                        Select Reserve Serial (POS or Sound Box)
                      </label>
                      <select
                        id="crm-bind-serial"
                        value={selectedReserveSerial}
                        onChange={(e) => setSelectedReserveSerial(e.target.value)}
                        required
                        className={`w-full rounded-xl px-3 py-2 border font-mono ${inputClass}`}
                      >
                        {availableReserveDevices.length === 0 && (
                          <option value="">No Branch Reserve / Configuring units available</option>
                        )}
                        {availableReserveDevices.map((d) => (
                          <option key={d.serial} value={d.serial}>
                            {d.serial} — {d.model} (Code {d.branchId})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="crm-bind-tid" className="block font-semibold mb-1.5">
                        Assign Terminal ID (TID) — Validated for Format &amp; Uniqueness
                      </label>
                      <input
                        id="crm-bind-tid"
                        type="text"
                        value={newTidInput}
                        onChange={(e) => setNewTidInput(e.target.value)}
                        required
                        placeholder={`Issued TID, format TID-${bindModalMerchant.branchId}…`}
                        className={`w-full rounded-xl px-3 py-2 border font-mono ${
                          !singleBindValidation.valid ? 'border-rose-500' : ''
                        } ${inputClass}`}
                      />
                      {!singleBindValidation.valid ? (
                        <div className="mt-1.5 space-y-1">
                          {singleBindValidation.errors.map((err, i) => (
                            <div key={i} className="text-[11px] text-rose-400 flex items-center gap-1">
                              <AlertOctagon className="w-3.5 h-3.5 shrink-0" />
                              <span>{err}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-1.5 text-[11px] text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Unit, TID format and uniqueness verified</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200/90 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => setBindModalMerchant(null)}
                        className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 cursor-pointer transition shadow-2xs flex items-center gap-1.5"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Cancel</span>
                      </button>
                      <button
                        type="submit"
                        disabled={!selectedReserveSerial || !singleBindValidation.valid}
                        className="px-5 py-2 rounded-xl text-xs font-bold bg-[#004953] hover:bg-[#003b43] text-white border border-emerald-500/30 shadow-sm disabled:opacity-40 cursor-pointer flex items-center gap-1.5 transition"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Bind Serial to MID</span>
                      </button>
                    </div>
                  </div>
                </motion.form>
              </div>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Return Hardware from Merchant Modal */}
      {typeof document !== 'undefined' &&
        createPortal(
          <>
            <AnimatePresence>
        {terminateModalMerchant && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-md">
            <motion.form
              initial={{ opacity: 0, scale: 0.95, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ type: 'spring', damping: 32, stiffness: 480, mass: 0.6 }}
              onSubmit={handleConfirmTerminate}
              className={`w-full max-w-2xl rounded-3xl border overflow-hidden shadow-2xl transform-gpu will-change-gpu gpu-modal-container ${
                isLight
                  ? 'bg-white border-slate-200 text-slate-800'
                  : 'bg-[#0c1a2e] border-[#1d3b66] text-slate-100'
              }`}
            >
              <div className="navy-header-bar px-6 py-4 flex items-center justify-between text-white">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-white/10 text-cyan-300 border border-white/20 flex items-center justify-center shrink-0">
                    <RotateCcw className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      Return Hardware from Merchant
                    </h3>
                    <p className="text-[11px] text-cyan-300 font-mono">
                      {terminateModalMerchant.mid} — {dash(terminateModalMerchant.merchantName)}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setTerminateModalMerchant(null)}
                  aria-label="Close return dialog"
                  title="Close"
                  className="p-1 rounded-full text-slate-300 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-6 flex flex-col gap-4 text-xs">
                {/* Hardware Attached Notice (System Style) */}
                <div
                  className={`p-3.5 rounded-2xl border ${
                    isLight
                      ? 'bg-slate-50/90 border-slate-200/90 text-slate-800'
                      : 'bg-slate-900/60 border-slate-800 text-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-md bg-[#003857]/10 dark:bg-sky-500/20 text-[#003857] dark:text-sky-300 flex items-center justify-center shrink-0">
                        <RotateCcw className="w-3 h-3" />
                      </div>
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                        {terminateModalMerchant.devices.length} Physical Device(s) To Return
                      </span>
                    </div>
                    <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                      Stock Return Notice
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 mb-2 leading-relaxed">
                    Returning clears the merchant assignment from each serial in Stock Inventory, moves units back to stock, and records the return event in Merchant History:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {terminateModalMerchant.devices.map((d) => (
                      <span
                        key={d.serial}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-mono text-[11px] font-semibold border bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700 shadow-2xs"
                      >
                        <span className="font-bold">{d.serial}</span>
                        <span className="text-slate-400 dark:text-slate-500 text-[10px]">({d.model})</span>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Return Destination Picker */}
                <div>
                  <label className="block font-bold text-[11px] uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5">
                    Staff Action: Return Physical Devices To *
                  </label>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setTerminateDestination('BRANCH_RESERVE')}
                      className={`p-3 rounded-2xl border text-left flex flex-col gap-1 transition cursor-pointer ${
                        terminateDestination === 'BRANCH_RESERVE'
                          ? 'bg-[#003857] text-white border-[#003857] ring-2 ring-[#003857]/20 shadow-xs'
                          : isLight
                          ? 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
                          : 'bg-[#18191e] hover:bg-[#252730] text-slate-300 border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 shrink-0" />
                        <span className="font-bold text-xs">Branch Reserve</span>
                      </div>
                      <span
                        className={`text-[10px] ${
                          terminateDestination === 'BRANCH_RESERVE' ? 'text-sky-200' : 'text-slate-500'
                        }`}
                      >
                        Return to Branch {returnBranchId || terminateModalMerchant.branchId} Reserve for immediate redeployment.
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setTerminateDestination('HQ_STOCK')}
                      className={`p-3 rounded-2xl border text-left flex flex-col gap-1 transition cursor-pointer ${
                        terminateDestination === 'HQ_STOCK'
                          ? 'bg-[#003857] text-white border-[#003857] ring-2 ring-[#003857]/20 shadow-xs'
                          : isLight
                          ? 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
                          : 'bg-[#18191e] hover:bg-[#252730] text-slate-300 border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <RotateCcw className="w-4 h-4 shrink-0" />
                        <span className="font-bold text-xs">Admin HQ Stock</span>
                      </div>
                      <span
                        className={`text-[10px] ${
                          terminateDestination === 'HQ_STOCK' ? 'text-sky-200' : 'text-slate-500'
                        }`}
                      >
                        Return to Admin HQ Central Stock (Branch Code 100) warehouse.
                      </span>
                    </button>
                  </div>
                </div>

                {/* Receiving Branch Selection (when returning to Branch Reserve) */}
                {terminateDestination === 'BRANCH_RESERVE' && (
                  <div
                    className={`p-3 rounded-2xl border ${
                      isLight
                        ? 'bg-slate-50/70 border-slate-200/90 text-slate-800'
                        : 'bg-slate-900/50 border-slate-800 text-slate-200'
                    } space-y-1.5`}
                  >
                    <div className="flex items-center justify-between">
                      <label className="block font-bold text-[11px] uppercase tracking-wider text-slate-700 dark:text-slate-300">
                        Receiving Branch Reserve *
                      </label>
                      {terminateModalMerchant.branchId &&
                        terminateModalMerchant.branchId !== returnBranchId && (
                          <span className="text-[10px] text-sky-700 dark:text-sky-300 font-bold bg-sky-50 dark:bg-sky-950/50 px-2 py-0.5 rounded-full border border-sky-200 dark:border-sky-800">
                            Transferring to different branch
                          </span>
                        )}
                    </div>
                    <select
                      value={returnBranchId}
                      onChange={(e) => setReturnBranchId(e.target.value)}
                      className={`w-full rounded-xl px-3 py-2 border font-semibold text-xs ${inputClass}`}
                    >
                      {branches
                        .filter((b) => (b.code || b.id) !== '100')
                        .map((b) => {
                          const code = b.code || b.id;
                          const isCurrent = code === terminateModalMerchant.branchId;
                          return (
                            <option key={code} value={code}>
                              Branch Code {code} - {b.name} {isCurrent ? '(Current Servicing Branch)' : ''}
                            </option>
                          );
                        })}
                    </select>
                    <p className="text-[10.5px] text-slate-500 dark:text-slate-400">
                      Devices will be checked into{' '}
                      <strong className="text-slate-800 dark:text-slate-200">
                        Branch Code {returnBranchId}
                      </strong>{' '}
                      reserve stock for redeployment.
                    </p>
                  </div>
                )}

                {/* Staff Who Processed Return */}
                <div>
                  <label className="block font-bold text-[11px] uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1">
                    Returned By Staff / Officer *
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      required
                      list="return-staff-datalist"
                      value={returnStaffName}
                      onChange={(e) => setReturnStaffName(e.target.value)}
                      placeholder="Enter staff full name who received / processed return..."
                      className={`w-full rounded-xl px-3 py-2 border font-semibold ${inputClass}`}
                    />
                    <datalist id="return-staff-datalist">
                      {returnStaffOptions.map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                  </div>
                  <p className="text-[10.5px] text-slate-500 dark:text-slate-400 mt-1">
                    This staff officer will be recorded on the returned device and in Merchant History.
                  </p>
                </div>

                {/* Reason Selection */}
                <div>
                  <label className="block font-bold text-[11px] uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1">
                    Return Reason *
                  </label>
                  <select
                    value={terminateReason}
                    onChange={(e) => setTerminateReason(e.target.value)}
                    className={`w-full rounded-xl px-3 py-2 border font-semibold ${inputClass}`}
                  >
                    <option value="Returned by Merchant">Returned by Merchant</option>
                    <option value="Merchant Closed Business">Merchant Closed Business</option>
                    <option value="Hardware Malfunction / Replacement">Hardware Malfunction / Replacement</option>
                    <option value="Voluntary Return — Switch to Online KHQR Only">Voluntary Return — Switch to Online KHQR Only</option>
                    <option value="Upgraded from Sound Box to POS Terminal">Upgraded from Sound Box to POS Terminal</option>
                    <option value="Degraded Battery (≥24M) & Merchant Inactivity">Degraded Battery (≥24M) &amp; Merchant Inactivity</option>
                    <option value="Seasonal Return">Seasonal Return</option>
                    <option value="Merchant Relocated">Merchant Relocated</option>
                  </select>
                </div>

                {/* Notes */}
                <div>
                  <label className="block font-bold text-[11px] uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1">
                    Officer Notes / Hardware Clearance Remarks
                  </label>
                  <textarea
                    rows={2}
                    value={terminateNotes}
                    onChange={(e) => setTerminateNotes(e.target.value)}
                    placeholder="Physical condition, power adaptors returned, SIM card status, final settlement notes..."
                    className={`w-full rounded-xl px-3 py-2 border ${inputClass}`}
                  />
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200/90 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setTerminateModalMerchant(null)}
                    className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 cursor-pointer transition shadow-2xs flex items-center gap-1.5"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Cancel</span>
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-xl text-xs font-extrabold bg-[#003857] hover:bg-[#002a42] text-white shadow-xs flex items-center gap-1.5 cursor-pointer transition"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Confirm Hardware Return</span>
                  </button>
                </div>
              </div>
            </motion.form>
          </div>
        )}
      </AnimatePresence>

      {/* Assign Hardware to Merchant Modal (with Real-Time MID/TID Validator) */}
      <AnimatePresence>
        {newMerchantModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-md">
            <motion.form
              initial={{ opacity: 0, scale: 0.95, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ type: 'spring', damping: 32, stiffness: 480, mass: 0.6 }}
              onSubmit={handleCreateNewMerchant}
              className={`w-full max-w-2xl rounded-3xl border overflow-hidden shadow-2xl transform-gpu will-change-gpu gpu-modal-container ${
                isLight
                  ? 'bg-white border-slate-200 text-slate-800'
                  : 'bg-[#0c1a2e] border-[#1d3b66] text-slate-100'
              }`}
            >
              <div className="navy-header-bar px-6 py-4 flex items-center justify-between text-white">
                <div>
                  <h3 className="text-sm font-bold">Assign Hardware to Merchant (Support &amp; Setup)</h3>
                  <p className="text-[11px] text-slate-300">
                    Link an existing Merchant MID &amp; TID to a reserve POS Terminal or Sound Box
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setNewMerchantModalOpen(false)}
                  aria-label="Close assign hardware dialog"
                  title="Close"
                  className="p-1 rounded-full text-slate-300 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-6 flex flex-col gap-3.5 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="crm-new-name" className="block font-semibold mb-1">Merchant Business Name *</label>
                    <input
                      id="crm-new-name"
                      type="text"
                      value={newMerchName}
                      onChange={(e) => setNewMerchName(e.target.value)}
                      required
                      placeholder="e.g. Starbucks Reserve BKK1"
                      className={`w-full rounded-xl px-3 py-2 border ${inputClass}`}
                    />
                  </div>
                  <div>
                    <label htmlFor="crm-new-phone" className="block font-semibold mb-1">Merchant Phone</label>
                    <input
                      id="crm-new-phone"
                      type="tel"
                      value={newMerchPhone}
                      onChange={(e) => setNewMerchPhone(e.target.value)}
                      placeholder="Merchant contact number"
                      className={`w-full rounded-xl px-3 py-2 border font-mono ${inputClass}`}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label htmlFor="crm-new-mid" className="block font-semibold">MID *</label>
                    </div>
                    <input
                      id="crm-new-mid"
                      type="text"
                      inputMode="numeric"
                      value={newMerchMid}
                      onChange={(e) => setNewMerchMid(e.target.value.replace(/\D/g, '').slice(0, 15))}
                      maxLength={15}
                      required
                      placeholder="15-digit MID from the acquiring record"
                      className={`w-full rounded-xl px-3 py-2 border font-mono ${inputClass}`}
                    />
                    <div className="text-[10px] text-slate-400 mt-0.5 text-right font-mono">
                      {newMerchMid.length}/15 digits
                    </div>
                  </div>
                  <div>
                    <label htmlFor="crm-new-tid" className="block font-semibold mb-1">Terminal ID (TID) *</label>
                    <input
                      id="crm-new-tid"
                      type="text"
                      placeholder="Issued TID, e.g. TID-{Branch}{Seq}"
                      value={newMerchTid}
                      onChange={(e) => setNewMerchTid(e.target.value)}
                      required
                      className={`w-full rounded-xl px-3 py-2 border font-mono ${inputClass}`}
                    />
                  </div>
                </div>

                {/* Live Validation Feedback Box */}
                {!singleNewMerchantValidation.valid ? (
                  <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 space-y-1">
                    {singleNewMerchantValidation.errors.map((err, i) => (
                      <div key={i} className="text-[11px] text-rose-300 flex items-center gap-1.5">
                        <AlertOctagon className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                        <span>{err}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-[11px] text-emerald-400 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                    <span>MID &amp; TID format and registry uniqueness verified</span>
                  </div>
                )}

                <div>
                  <label htmlFor="crm-new-address" className="block font-semibold mb-1">Physical Store Address</label>
                  <input
                    id="crm-new-address"
                    type="text"
                    value={newMerchAddress}
                    onChange={(e) => setNewMerchAddress(e.target.value)}
                    placeholder="Street, Sangkat, Khan"
                    className={`w-full rounded-xl px-3 py-2 border ${inputClass}`}
                  />
                </div>

                <div>
                  <label htmlFor="crm-new-serial" className="block font-semibold mb-1">
                    POS Terminal / Hardware Serial (Branch Reserve or Configuring unit) *
                  </label>
                  <input
                    id="crm-new-serial"
                    type="text"
                    list="crm-bindable-serials"
                    value={newMerchSerial}
                    onChange={(e) => setNewMerchSerial(e.target.value)}
                    required
                    placeholder="Choose a serial from the device list"
                    className={`w-full rounded-xl px-3 py-2 border font-mono ${inputClass}`}
                  />
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200/90 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setNewMerchantModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 cursor-pointer transition shadow-2xs flex items-center gap-1.5"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Cancel</span>
                  </button>
                  <button
                    type="submit"
                    disabled={!singleNewMerchantValidation.valid}
                    className="px-5 py-2 rounded-xl text-xs font-bold bg-[#004953] hover:bg-[#003b43] text-white border border-emerald-500/30 shadow-sm disabled:opacity-40 cursor-pointer flex items-center gap-1.5 transition"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Save &amp; Assign Hardware</span>
                  </button>
                </div>
              </div>
            </motion.form>
          </div>
        )}
            </AnimatePresence>
          </>,
          document.body
        )}
    </div>
  );
};

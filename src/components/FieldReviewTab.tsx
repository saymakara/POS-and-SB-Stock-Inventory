import {
  ClearFiltersButton,
  REVIEW_FILTER_BAR_CLS,
  REVIEW_TAB_GROUP_CLS,
  REVIEW_SELECT_CLS,
  REVIEW_INPUT_CLS,
} from './ClearFiltersButton';
import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, startTransition } from 'react';
import { isFresh, markFresh } from '../utils/freshness';
import { useKeptMemo } from '../utils/useKeptMemo';
import { Search, RefreshCw, CheckCircle2, XCircle, Trash2, AlertTriangle, Ban, Loader2, ChevronDown, ChevronLeft, ChevronRight, Calendar, MapPin, ScanLine, Cpu, Volume2, ArrowDown, ArrowUp, ChevronsUpDown, Clock, Check, Copy, X, PencilLine, PackagePlus, ArrowLeftRight, BatteryCharging, Wrench, PauseCircle, RotateCcw, WifiOff, Settings2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Branch, Device, UserRole } from '../types';
import { useSort, SortState } from '../utils/sort';
import { usePager } from '../utils/usePager';
import { Pager } from './Pager';
import { STAGE_META } from '../data/initialData';
import {
  FieldEvent,
  FieldEventStatus,
  fetchBranchRegions,
  getCachedBranchRegions,
  fetchAllPendingFieldEvents,
  fetchReviewedFieldEvents,
  fetchAllFieldEvents,
  fetchFieldEventsByDateRange,
  subscribeToFieldEvents,
  approveFieldEvent,
  rejectFieldEvent,
} from '../services/supabaseService';
import { deletePhoneRecords } from '../services/supabaseService';
import { DeleteRecordsDialog, SelectBox } from './DeleteRecordsDialog';
import { getCachedFieldEvents, isFieldCacheComplete, isFieldReviewedReady, setCachedFieldEvents } from '../services/fieldCache';
import { onPortalSync } from '../utils/portalSync';
import { FieldScope, normalizeFieldDeviceType, buildPhnomPenhScopeSets, isFieldEventInScope } from '../utils/fieldScope';
import { ExportCsvButton } from './ExportCsvButton';
import { downloadCsv, csvTime } from '../utils/exportCsv';
import { CopyableRecordId, copyTextToClipboard } from './CopyableRecordId';
import { PhoneRecordEditDialog, EditField } from './PhoneRecordEditDialog';
import {
  PillMotion,
  CAPSULE_PILL_CLS,
  CAPSULE_BTN_ACTIVE_CLS,
  CAPSULE_BTN_INACTIVE_CLS,
  CAPSULE_COUNT_ACTIVE_CLS,
  CAPSULE_COUNT_WARN_ACTIVE_CLS,
  CAPSULE_COUNT_INACTIVE_CLS,
} from './PillMotion';
import { todayPP } from '../utils/time';

/**
 * Phone App Review.
 * Every POS / Sound Box record saved in the Merchant Visit phone app arrives here, one line per device. The stock does
 * not change until an admin approves it. The list is one clean line per record; tap a line to open its details and the
 * decision, which grow out of the line (morph). Waiting records load first and appear at once; reviewed records follow
 * in the background, and new records from the phone app appear live.
 */

/** (21 Nov 2026, owner) The record type as shown: SB Maintenance (phone app form "SB Maintenance", Record ID SBM-) has its own
 *  card, apart from SB Operational Support (SBO-). Both are SB_MAINT in the database (same review, same approval). */
type ViewKind = FieldEvent['kind'] | 'SB_MAINTENANCE';
const viewKind = (e: FieldEvent): ViewKind => (e.kind === 'SB_MAINT' && /^SBM-/i.test(String(e.sourceRecordId || '')) ? 'SB_MAINTENANCE' : e.kind);
const KIND_LABEL: Record<ViewKind, string> = {
  INSTALL: 'Installation',
  REPLACE: 'Replacement',
  BATTERY: 'Battery replacement',
  SB_MAINT: 'SB operational support',
  SB_MAINTENANCE: 'SB maintenance',
  SB_RETURN: 'Sound Box returned',
  POS_MAINT: 'POS operational support',
  POS_INACTIVE: 'POS in-active maintenance',
  POS_RETURN: 'POS returned & terminated',
  POS_OFFLINE: 'POS offline count',
};
const KIND_CARD_META: Record<
  string,
  {
    icon: React.ComponentType<{ className?: string }>;
    iconCls: string;
  }
> = {
  INSTALL: { icon: PackagePlus, iconCls: 'bg-emerald-50 text-emerald-600 border-emerald-200/80' },
  REPLACE: { icon: ArrowLeftRight, iconCls: 'bg-sky-50 text-sky-600 border-sky-200/80' },
  BATTERY: { icon: BatteryCharging, iconCls: 'bg-amber-50 text-amber-600 border-amber-200/80' },
  POS_MAINT: { icon: Wrench, iconCls: 'bg-violet-50 text-violet-600 border-violet-200/80' },
  POS_INACTIVE: { icon: PauseCircle, iconCls: 'bg-orange-50 text-orange-600 border-orange-200/80' },
  POS_RETURN: { icon: RotateCcw, iconCls: 'bg-rose-50 text-rose-600 border-rose-200/80' },
  POS_OFFLINE: { icon: WifiOff, iconCls: 'bg-slate-100 text-slate-600 border-slate-200/80' },   // (21 Nov 2026) no stock move
  SB_MAINT: { icon: Wrench, iconCls: 'bg-violet-50 text-violet-600 border-violet-200/80' },
  SB_RETURN: { icon: RotateCcw, iconCls: 'bg-rose-50 text-rose-600 border-rose-200/80' },
  SB_MAINTENANCE: { icon: Settings2, iconCls: 'bg-teal-50 text-teal-600 border-teal-200/80' },
};
import { ACCORDION_EXPAND_VARIANTS } from '../utils/animationRules';
const formatKindSummarySub = (stat?: { total: number; pending: number; approved: number; rejected: number }) => {
  if (!stat || stat.total === 0) return 'No records yet';
  const parts: string[] = [];
  if (stat.pending > 0 || (stat.approved === 0 && stat.rejected === 0)) parts.push(`${stat.pending.toLocaleString()} waiting`);
  if (stat.approved > 0) parts.push(`${stat.approved.toLocaleString()} approved`);
  else if (stat.rejected > 0) parts.push(`${stat.rejected.toLocaleString()} rejected`);
  return parts.join(' · ');
};
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Waiting',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  SUPERSEDED: 'Replaced by a newer edit',
  CANCELLED: 'Withdrawn in the phone app',
};
type Filter = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL';
type TypeFilter = 'ALL' | 'POS Terminal' | 'Sound Box';
type RecordTypeFilter = 'ALL' | ViewKind | 'INSTALL_INTEG';
/** (21 Nov 2026) Integrated Installation: an Installation the phone app marked "Integrated Installation" (payload.entry.request_type,
 *  Merchant Visit 4.10.2; older ones tagged once by the app). Only a filter - it is still an Installation everywhere else. */
const isIntegrated = (e: FieldEvent) => e.kind === 'INSTALL' && /^integrated/i.test(String(e.payload?.entry?.request_type || ''));
const kindMatches = (e: FieldEvent, f: RecordTypeFilter) => f === 'ALL' || (f === 'INSTALL_INTEG' ? isIntegrated(e) : viewKind(e) === f);
const DOT = { 'POS Terminal': 'bg-[#184e77]', 'Sound Box': 'bg-[#4F518C]' } as const;
/** POS Terminal unless the record says Sound Box (the same rule as the row label) */
const devType = (e: FieldEvent): 'POS Terminal' | 'Sound Box' => normalizeFieldDeviceType(e.deviceType);
const SPRING = { type: 'spring', stiffness: 500, damping: 32, mass: 0.55 } as const;
const GRID =
  'grid items-center gap-x-2.5 grid-cols-[32px_34px_96px_158px_150px_minmax(200px,1.45fr)_minmax(160px,1.25fr)_minmax(125px,1fr)_76px_84px]';
const CACHE_KEY = 'fe_review_cache_v6';

// one formatter, reused for every row (same text as toLocaleString with these options, ~20x faster)
const FMT_TIME = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Phnom_Penh',
});
const fmtTime = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : FMT_TIME.format(d);
};

const FMT_DAY_SHORT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const FMT_DAY_MONTH = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  timeZone: 'UTC',
});
const shiftYmd = (ymd: string, deltaDays: number): string => {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
};
const monthBoundsPP = (todayYmd: string, monthOffset: number): { from: string; to: string } => {
  const [y, m] = todayYmd.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1 + monthOffset, 1));
  const end = monthOffset === 0 ? null : new Date(Date.UTC(y, m + monthOffset, 0));
  const from = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const to = end
    ? `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}-${String(end.getUTCDate()).padStart(2, '0')}`
    : todayYmd;
  return { from, to };
};
const normalizeDateRange = (from: string, to: string): { from: string; to: string } => {
  if (from && to && from > to) return { from: to, to: from };
  return { from, to };
};
const formatYmd = (ymd: string, withYear = true): string => {
  if (!ymd) return '';
  const dt = new Date(`${ymd}T00:00:00Z`);
  if (isNaN(dt.getTime())) return ymd;
  return withYear ? FMT_DAY_SHORT.format(dt) : FMT_DAY_MONTH.format(dt);
};
const formatDateFilterLabel = (from: string, to: string, todayYmd: string): string => {
  if (!from && !to) return 'All Dates';
  const yest = shiftYmd(todayYmd, -1);
  if (from && from === to) {
    if (from === todayYmd) return `Today · ${formatYmd(from, false)}`;
    if (from === yest) return `Yesterday · ${formatYmd(from, false)}`;
    return formatYmd(from, true);
  }
  if (from && to) {
    const sameYear = from.slice(0, 4) === to.slice(0, 4);
    return `${formatYmd(from, !sameYear)} – ${formatYmd(to, true)}`;
  }
  return from ? `From ${formatYmd(from, true)}` : `Up to ${formatYmd(to, true)}`;
};

interface Props {
  role: UserRole;
  branches: Branch[];
  devices: Device[];
  triggerToast: (msg: string) => void;
  onApplied: () => void;
  onOpenWorkflow?: (serial: string) => void;
  /** Settings: show Phnom Penh staff only, or Phnom Penh and regional staff */
  scope?: FieldScope;
  /** (28 Oct 2026) the waiting count of each device type (badges of the Phone App Review sub-menus) */
  onPendingCountChange?: (counts: { pos: number; sb: number }) => void;
  /** (28 Oct 2026) Phone App Review sub-menu: show one device type only (POS Terminal or Sound Box) */
  deviceType?: 'POS Terminal' | 'Sound Box';
}

interface RowOpt {
  branchId?: string;
  returnStage?: string;
  note?: string;
  ack?: boolean;
}

const needsReturnOf = (e: FieldEvent) => (e.kind === 'REPLACE' && !!e.oldSerial) || e.kind === 'SB_RETURN' || e.kind === 'POS_RETURN';
const needsBranchOf = (e: FieldEvent) => e.kind === 'INSTALL' || e.kind === 'REPLACE';
const hasBlock = (e: FieldEvent) => e.issues.some((i) => i.level === 'block');
const hasWarn = (e: FieldEvent) => e.issues.some((i) => i.level === 'warn');
const resolve = (e: FieldEvent, o?: RowOpt) => ({
  branchId: o?.branchId ?? (e.branchId || ''),
  returnStage: o?.returnStage ?? 'HQ_STOCK',
  note: o?.note ?? '',
  ack: o?.ack ?? false,
});
/** How the phone app says the serial / MID was entered: unit.serial_input / unit.mid_input = "SCAN" or "TYPED" (missing = not reported). */
type How = 'SCAN' | 'TYPED' | '';
const howOf = (v: unknown): How => {
  const t = String(v ?? '').trim().toUpperCase();
  return t === 'SCAN' || t === 'SCANNED' || t === 'S' ? 'SCAN' : t === 'TYPED' || t === 'TYPE' || t === 'MANUAL' || t === 'T' ? 'TYPED' : '';
};
/** Maintenance / In-Active / Return forms: when the phone app scans the MID only and fills the
 *  serial, TID and terminal name from it, it may omit serial_input. A scanned MID means the unit was scanned. */
const MID_LOOKUP_KINDS = new Set(['POS_MAINT', 'POS_INACTIVE', 'POS_RETURN', 'SB_MAINT', 'SB_RETURN']);
/** (21 Nov 2026) The name of a record in messages: its serial, or (POS Offline Count: no serial) its TID / terminal / record. */
const recName = (e: FieldEvent) => e.serial || (e.tid ? `TID ${e.tid}` : '') || e.terminalName || e.sourceRecordId;
const entryOf = (e: FieldEvent): { serial: How; mid: How; oldSerial: How; oldBattery: How; newBattery: How; serialFromMid: boolean } => {
  const u = (e.payload && (e.payload.unit || e.payload)) || {};
  const serialReported = howOf(u.serial_input || u.serialInput || u.scan_type || u.scanType || e.payload?.serial_input);
  const mid = howOf(u.mid_input || u.midInput || e.payload?.mid_input);
  const serialFromMid = !serialReported && MID_LOOKUP_KINDS.has(e.kind) && mid !== '';
  return {
    serial: serialFromMid ? mid : serialReported,
    mid,
    oldSerial: howOf(u.old_serial_input || u.oldSerialInput || e.payload?.old_serial_input),
    oldBattery: howOf(u.old_battery_input || u.oldBatteryInput || e.payload?.old_battery_input),
    newBattery: howOf(u.new_battery_input || u.newBatteryInput || e.payload?.new_battery_input),
    serialFromMid,
  };
};
const howText = (h: How) => (h === 'SCAN' ? 'Scanned' : h === 'TYPED' ? 'Typed by hand' : 'Not reported');
/** Hover text for a serial / MID: says exactly what the phone reported (never claims "typed" when nothing was sent). */
const howTitle = (label: string, value: string, h: How, fromMid = false) =>
  fromMid
    ? `${label} ${value} (filled from the ${h === 'SCAN' ? 'scanned' : 'typed'} MID)`
    : h === 'SCAN'
      ? `${label} ${value} (Scanned via barcode scanner)`
      : h === 'TYPED'
        ? `${label} ${value} (Typed manually)`
        : `${label} ${value} (entry method not reported by the phone app)`;

const InputMethodBadge: React.FC<{
  method: How;
  titlePrefix?: string;
  size?: 'sm' | 'xs';
}> = ({ method, titlePrefix = 'Value', size = 'sm' }) => {
  if (method === 'SCAN') {
    const iconCls = size === 'xs' ? 'w-2.5 h-2.5' : 'w-3 h-3';
  return (
      <span
        title={`${titlePrefix} scanned with barcode scanner`}
        className="inline-flex items-center justify-center text-slate-500/85 dark:text-slate-400 shrink-0 select-none cursor-help"
        aria-label={`${titlePrefix} scanned`}
      >
        <ScanLine className={iconCls} aria-hidden="true" />
        <span className="sr-only">Scanned</span>
      </span>
    );
  }
  return null;
};

const CopySerialButton: React.FC<{ value: string; label?: string }> = ({ value, label = 'serial' }) => {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <button
      type="button"
      onClick={async (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        if (await copyTextToClipboard(value)) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1800);
        }
      }}
      aria-label={`Copy ${label} ${value}`}
      title={copied ? `Copied: ${value}` : `Copy ${value}`}
      className={`inline-flex items-center justify-center p-0.5 rounded transition cursor-pointer shrink-0 active:scale-95 ${
        copied
          ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-400'
          : 'text-slate-400 hover:text-[#002F4A] hover:bg-sky-50 dark:hover:bg-slate-700/60 dark:hover:text-sky-300 opacity-60 hover:opacity-100'
      }`}
    >
      {copied ? <Check className="w-3 h-3" aria-hidden /> : <Copy className="w-3 h-3" aria-hidden />}
    </button>
  );
};

/* (7 Nov 2026) Edit: the fields of a record for the edit window. An approved record changed the stock: its serials, MID,
   TID and batteries are shown locked. */
const STOCK_LOCK = 'Approved: this already changed the stock. Reject and redo the entry, or fix the unit in Stock Inventory.';
export function fieldEditFields(e: FieldEvent): EditField[] {
  const lock = e.status === 'APPROVED' ? STOCK_LOCK : undefined;
  const entryP = (e.payload && e.payload.entry) || {};
  const sb = e.deviceType === 'Sound Box';
  const serialLabel = e.kind === 'BATTERY' ? 'Terminal Serial' : e.kind === 'SB_MAINT' || e.kind === 'SB_RETURN' ? 'Sound Box SN'
    : e.kind.startsWith('POS_') ? 'Terminal SN' : sb ? 'Sound Box SN' : 'Terminal Serial';
  const sec = e.unitNo > 1 || e.kind === 'INSTALL' || e.kind === 'REPLACE' ? `Device ${e.unitNo}` : 'Device';
  // (7 Nov 2026) a Sound Box has no TID (Merchant Visit 3.85): identified by its MID only
  const noTid = sb || e.kind === 'SB_MAINT' || e.kind === 'SB_RETURN';
  const out: EditField[] = [
    { key: 'terminal_name', label: 'Terminal Name', value: e.terminalName, section: sec },
    { key: 'mid', label: 'MID', value: e.mid, locked: lock, numeric: true, section: sec },
    ...(noTid ? [] : [{ key: 'tid', label: 'TID', value: e.tid, locked: lock, numeric: true, hint: lock ? undefined : '8 digits', section: sec }]),
    ...(e.kind === 'POS_OFFLINE' ? [] : [{ key: 'serial', label: serialLabel, value: e.serial, locked: lock, section: sec }]),   // (21 Nov 2026) Offline Count: no serial
  ];
  const dev = out[0].section;
  if (e.kind === 'REPLACE') out.push({ key: 'old_serial', label: sb ? 'Old Sound Box SN' : 'Old Terminal Serial', value: e.oldSerial, locked: lock, section: dev });
  if (e.kind === 'BATTERY') out.push({ key: 'old_battery', label: 'Old Battery', value: e.oldBattery, locked: lock, section: dev },
    { key: 'new_battery', label: 'New Battery', value: e.newBattery, locked: lock, section: dev });
  const ent = 'Whole entry' + (e.unitNo > 1 || (e.kind === 'INSTALL' || e.kind === 'REPLACE') ? ' (all its devices)' : '');
  if (e.kind === 'INSTALL' || e.kind === 'REPLACE') out.push({ key: 'outlet_name', label: 'Outlet Name', value: e.outletName, section: ent });
  (Array.isArray(entryP.details) ? entryP.details : []).forEach((d: any) => {
    if (!d || !d.k) return;
    const item = /^(POS Terminal|AC Power Adaptor|AC Power Cable|Charging Dock|SIM Card|POS Stand Holder)$/.test(d.k);
    out.push({ key: 'details.' + d.k, label: d.k, value: d.v, section: ent, options: item ? ['1', 'N/a', 'Lost'] : undefined });
  });
  const checks = entryP.checks && typeof entryP.checks === 'object' ? entryP.checks : null;
  if (checks) Object.keys(checks).forEach((k) => out.push({ key: 'checks.' + k, label: k.charAt(0).toUpperCase() + k.slice(1), value: checks[k], section: ent,
    options: Object.values(checks).every((v) => /^(OK|Issue)$/i.test(String(v))) ? ['OK', 'Issue'] : undefined }));
  if (e.kind === 'POS_MAINT') out.push({ key: 'request_type', label: 'Request Type', value: entryP.request_type || e.payload?.request_type || 'POS Terminal Inspection', options: ['POS Terminal Inspection', 'Refreshment Training', 'Request Paper Roll', 'Request Add Material', 'Request Return Materials', 'Others'], section: ent });
  if (e.kind === 'SB_MAINT') out.push({ key: 'request_type', label: 'Request Type', value: entryP.request_type || e.payload?.request_type || 'SB Inspection', options: ['SB Inspection', 'SB Refresh Training', 'Battery Replacement', 'Add Material', 'Returns Material', 'Others'], section: ent });
  if (e.kind === 'SB_MAINT' || e.kind === 'SB_RETURN') out.push({ key: 'feedback', label: 'Merchant Feedback', value: entryP.feedback, multiline: true, section: ent });
  if (e.latitude != null || e.longitude != null) out.push({ key: 'latitude', label: 'Latitude', value: e.latitude, section: ent }, { key: 'longitude', label: 'Longitude', value: e.longitude, section: ent });
  out.push({ key: 'remarks', label: 'Remarks', value: e.remarks, multiline: true, section: ent });
  return out;
}

export const FieldReviewTab: React.FC<Props> = ({
  role,
  branches,
  devices,
  triggerToast,
  onApplied,
  onOpenWorkflow,
  scope = 'PHNOM_PENH',
  onPendingCountChange,
  deviceType,
}) => {
  const [activeScope, setActiveScope] = useState<FieldScope>(scope);
  useEffect(() => {
    setActiveScope(scope);
  }, [scope]);

  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const isSuper = role === 'SUPER_ADMIN';
  // (4 Nov 2026) Admins select waiting records to approve / reject; a Super Admin can also select rejected, withdrawn and
  // replaced records to delete them for good. Approved records are never selectable (they changed the stock).
  const selectable = useCallback((e: FieldEvent) => (isAdmin && e.status === 'PENDING') || (isSuper && e.status !== 'APPROVED'), [isAdmin, isSuper]);
  const [delOpen, setDelOpen] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  const initialSnapshot = useMemo(() => {
    const mem = getCachedFieldEvents();                              // fetched in the background after sign-in: no parsing, no waiting
    if (mem) return { events: mem, complete: isFieldCacheComplete() };
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return { events: null as FieldEvent[] | null, complete: false };
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return { events: parsed as FieldEvent[], complete: parsed.length < 1000 };
      if (parsed && Array.isArray(parsed.events)) return { events: parsed.events as FieldEvent[], complete: Boolean(parsed.complete) };
    } catch { /* storage blocked or corrupt */ }
    return { events: null as FieldEvent[] | null, complete: false };
  }, []);
  const [events, setEvents] = useState<FieldEvent[] | null>(initialSnapshot.events);
  const [pendingReady, setPendingReady] = useState<boolean>(initialSnapshot.complete);
  const [reviewedReady, setReviewedReady] = useState<boolean>(
    () => isFieldReviewedReady() || Boolean(initialSnapshot.events?.some((e) => e.status !== 'PENDING'))
  );
  const [reviewedLoading, setReviewedLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [live, setLive] = useState(false);
  const [filter, setFilter] = useState<Filter>('PENDING');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(deviceType || 'ALL');
  const [recordTypeFilter, setRecordTypeFilter] = useState<RecordTypeFilter>('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [dateMenuOpen, setDateMenuOpen] = useState(false);
  const [dateLoading, setDateLoading] = useState(false);
  const dateMenuRef = useRef<HTMLDivElement | null>(null);
  const reviewedCapHitRef = useRef<boolean>(false);
  const oldestReviewedYmdRef = useRef<string>('');
  const fetchedDateRangesRef = useRef<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<FieldEvent | null>(null);   // (7 Nov 2026) Edit details
  const [opts, setOpts] = useState<Record<number, RowOpt>>({});
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const [rowErr, setRowErr] = useState<Record<number, string>>({});
  const [bulkNote, setBulkNote] = useState('');
  const [bulkAck, setBulkAck] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<'' | 'approve' | 'reject'>('');
  const [bulkReport, setBulkReport] = useState<string[]>([]);
  const [regions, setRegions] = useState<Record<string, string>>(() => getCachedBranchRegions() || {});
  const [regionsReady, setRegionsReady] = useState<boolean>(() => Boolean(getCachedBranchRegions()));
  // the sub-menu decides the device type; the list already loaded is kept (no reload when switching)
  useEffect(() => {
    setTypeFilter(deviceType || 'ALL');
    setSelected(new Set());
    setOpen(null);
    setRecordTypeFilter('ALL');
  }, [deviceType]);

  useEffect(() => {
    fetchBranchRegions().then((g) => startTransition(() => { setRegions(g); setRegionsReady(true); }));
  }, []);

  useEffect(() => { if (events) setCachedFieldEvents(events, pendingReady, reviewedReady); }, [events, pendingReady, reviewedReady]);   // the next opening starts from the latest list

  // Cache recent snapshot so tab switches and refreshes paint quickly without freezing main thread on huge JSON writes
  useEffect(() => {
    if (!events || events.length === 0 || !pendingReady) return;
    const t = window.setTimeout(() => {
      try {
        const pendingOnly = events.filter((e) => e.status === 'PENDING');
        const reviewedCap = events.filter((e) => e.status !== 'PENDING').slice(0, 100);
        sessionStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ complete: pendingOnly.length <= 200, events: [...pendingOnly.slice(0, 200), ...reviewedCap] })
        );
      } catch {
        /* storage full or blocked: fine */
      }
    }, 1200);
  return () => window.clearTimeout(t);
  }, [events, pendingReady]);

  const load = useCallback(async () => {
    setLoadError('');
    setReviewedLoading(true);
    try {
      // Both lists are requested at the same time; page 1 of Waiting paints at once if >1,000 rows exist,
      // and all remaining Waiting pages finish before pendingReady enables sidebar count sync.
      const pendingReq = fetchAllPendingFieldEvents((firstPage) => {
        startTransition(() => {
          setEvents((prev) => (prev && prev.length ? prev : [...firstPage]));
        });
      });
      const reviewedReq = fetchReviewedFieldEvents(1000, 0);
      const pending = await pendingReq;
      if (pending) {
        startTransition(() => {
          setEvents((prev) => [...pending, ...(prev || []).filter((e) => e.status !== 'PENDING')]);
          setPendingReady(true);
        });
      }
      const reviewed = await reviewedReq;
      if (!pending && !reviewed) {
        setLoadError('The records could not be loaded. Please check the connection and tap Refresh.');
        return;
      }
      if (reviewed) {
        reviewedCapHitRef.current = reviewed.length >= 1000;
        let oldest = '';
        for (const ev of reviewed) {
          if (!ev.receivedAt) continue;
          const dt = new Date(ev.receivedAt);
          if (isNaN(dt.getTime())) continue;
          const ymd = todayPP(dt);
          if (!oldest || ymd < oldest) oldest = ymd;
        }
        oldestReviewedYmdRef.current = oldest;
        fetchedDateRangesRef.current.clear();
      }
      startTransition(() => {
        setEvents((prev) => {
          const keepPending = pending ?? (prev || []).filter((e) => e.status === 'PENDING');
          const keepReviewed = reviewed ?? (prev || []).filter((e) => e.status !== 'PENDING');
          return [...keepPending, ...keepReviewed];
        });
        if (pending) setPendingReady(true);
        setReviewedReady(true);
      });
      if (pending) markFresh('field');
    } catch {
      setLoadError('The records could not be loaded. Please check the connection and tap Refresh.');
    } finally {
      setReviewedLoading(false);
    }
  }, []);

  useEffect(() => {
    // Only reuse cached records if all PENDING + reviewed pages finished within the freshness window (realtime keeps them current)
    if (getCachedFieldEvents() && isFieldCacheComplete() && isFieldReviewedReady() && isFresh('field', 300000)) {
      setReviewedReady(true);
    } else {
      void load();
    }
    // (29 Oct 2026, speed review) live changes are collected and applied together once per frame: a burst of phone records
    // (or a bulk approval) is one screen update, not one per record
    const queued = new Map<number, FieldEvent>();
    let frame: number | null = null;
    const flushQueued = () => {
      frame = null;
      if (!queued.size) return;
      const batch = new Map(queued);
      queued.clear();
      setEvents((prev) => {
        if (!prev) return Array.from(batch.values());
        const seen = new Set<number>();
        const next = prev.map((x) => {
          const inc = batch.get(x.id);
          if (!inc) return x;
          seen.add(x.id);
          return inc;
        });
        const added: FieldEvent[] = [];
        batch.forEach((ev, id) => { if (!seen.has(id)) added.push(ev); });
        return added.length ? [...added.reverse(), ...next] : next;
      });
    };
    const unsub = subscribeToFieldEvents((e) => {
      setLive(true);
      queued.set(e.id, e);
      if (frame === null) frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(flushQueued) : (window.setTimeout(flushQueued, 16) as unknown as number);
    });
    let syncTimer = 0;
    const unsubSync = onPortalSync(['field'], () => {
      window.clearTimeout(syncTimer);
      syncTimer = window.setTimeout(() => {
        void load();
      }, 650);
    });
  return () => {
      unsub();
      unsubSync();
      window.clearTimeout(syncTimer);
      if (frame !== null) { try { cancelAnimationFrame(frame); } catch { /* not a frame */ } }
      queued.clear();
    };
  }, [load]);

  const deviceBySerial = useKeptMemo('field.bySerial', () => {
    const m = new Map<string, Device>();
    devices.forEach((d) => m.set(d.serial.toUpperCase(), d));
    return m;
  }, [devices]);

  // Build lookup set of known Phnom Penh branch codes and staff IDs from the 33 Phnom Penh branches
  const { ppBranchCodes, ppStaffEmpIds } = useMemo(() => buildPhnomPenhScopeSets(branches), [branches]);

  /**
   * Policy #8: Strict, zero-mistake Phnom Penh Staff filter.
   * Excludes any regional branch code (200–799 such as 404, 421, 423, 425, 443) or provincial/district/krong branch text,
   * even when `e.branchId` is null on the field event record.
   */
  const inScope = useCallback(
    (e: FieldEvent) => isFieldEventInScope(e, activeScope, ppBranchCodes, ppStaffEmpIds, regions),
    [activeScope, ppBranchCodes, ppStaffEmpIds, regions]
  );

  const scoped = useMemo(() => (events || []).filter(inScope), [events, inScope]);

  const todayYmd = todayPP();
  const effRange = useMemo(() => normalizeDateRange(dateFrom, dateTo), [dateFrom, dateTo]);
  const hasDateFilter = Boolean(effRange.from || effRange.to);
  const dateLabel = useMemo(
    () => formatDateFilterLabel(effRange.from, effRange.to, todayYmd),
    [effRange.from, effRange.to, todayYmd]
  );

  // Close date picker popover on outside pointerdown or Escape
  useEffect(() => {
    if (!dateMenuOpen) return;
    const onDown = (ev: MouseEvent) => {
      if (dateMenuRef.current && !dateMenuRef.current.contains(ev.target as Node)) {
        setDateMenuOpen(false);
      }
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setDateMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
  return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [dateMenuOpen]);

  // Precompute Phnom Penh YYYY-MM-DD per event id once when `events` changes
  const dateById = useKeptMemo('field.dateById', () => {
    const m = new Map<number, string>();
    (events || []).forEach((e) => {
      if (!e.receivedAt) return;
      const d = new Date(e.receivedAt);
      if (!isNaN(d.getTime())) m.set(e.id, todayPP(d));
    });
    return m;
  }, [events]);

  // If user selects an older date beyond the initial 1,000 reviewed cap, load that date window on demand
  useEffect(() => {
    if (!hasDateFilter) return;
    const needsFetch =
      reviewedCapHitRef.current &&
      (!effRange.from || !oldestReviewedYmdRef.current || effRange.from <= oldestReviewedYmdRef.current);
    if (!needsFetch) return;
    const key = `${effRange.from}|${effRange.to}`;
    if (fetchedDateRangesRef.current.has(key)) return;
    let alive = true;
    setDateLoading(true);
    fetchFieldEventsByDateRange(effRange.from || undefined, effRange.to || undefined, 'ALL')
      .then((rows) => {
        if (!alive) return;
        fetchedDateRangesRef.current.add(key);
        if (!rows || rows.length === 0) return;
        startTransition(() => {
          setEvents((prev) => {
            const list = prev || [];
            const seen = new Set(list.map((x) => x.id));
            const extra = rows.filter((r) => !seen.has(r.id));
            return extra.length ? [...list, ...extra] : list;
          });
        });
      })
      .finally(() => {
        if (alive) setDateLoading(false);
      });
  return () => {
      alive = false;
    };
  }, [hasDateFilter, effRange.from, effRange.to]);

  const dateScoped = useMemo(() => {
    if (!hasDateFilter) return scoped;
    const { from, to } = effRange;
    return scoped.filter((e) => {
      const ymd = dateById.get(e.id);
      if (!ymd) return false;
      if (from && ymd < from) return false;
      if (to && ymd > to) return false;
      return true;
    });
  }, [scoped, hasDateFilter, effRange, dateById]);

  const counts = useMemo(() => {
    const c = { PENDING: 0, APPROVED: 0, REJECTED: 0, ALL: 0 };
    dateScoped.forEach((e) => {
      if (deviceType && devType(e) !== deviceType) return;
      c.ALL++;
      if (e.status === 'PENDING' || e.status === 'APPROVED' || e.status === 'REJECTED') c[e.status]++;
    });
    return c;
  }, [dateScoped, deviceType]);

  // (5 Nov 2026) Record Type summary breakdown for the hero cards (active scope, selected date & device type)
  const hero = useMemo(() => {
    const byKind: Record<string, { total: number; pending: number; approved: number; rejected: number }> = {};
    let total = 0;
    const effectiveType = deviceType || (typeFilter !== 'ALL' ? typeFilter : undefined);
    dateScoped.forEach((e) => {
      if (effectiveType && devType(e) !== effectiveType) return;
      if (e.status !== 'APPROVED' && e.status !== 'PENDING' && e.status !== 'REJECTED') return;
      total++;
      const vk = viewKind(e), bucket = byKind[vk] || (byKind[vk] = { total: 0, pending: 0, approved: 0, rejected: 0 });
      bucket.total++;
      if (e.status === 'PENDING') bucket.pending++;
      else if (e.status === 'APPROVED') bucket.approved++;
      else if (e.status === 'REJECTED') bucket.rejected++;
    });
    let maxKind = 0;
    Object.values(byKind).forEach((s) => { if (s.total > maxKind) maxKind = s.total; });
    return { total, maxKind, byKind };
  }, [dateScoped, deviceType, typeFilter]);

  // Keep the sub-menu badges synchronized with the active scope's exact waiting count once full PENDING data + regions load
  const pendingByType = useMemo(() => {
    const c = { pos: 0, sb: 0 };
    scoped.forEach((e) => {
      if (e.status !== 'PENDING') return;
      if (e.deviceType === 'Sound Box') c.sb++;
      else c.pos++;
    });
    return c;
  }, [scoped]);
  useEffect(() => {
    if (events && pendingReady && regionsReady && onPendingCountChange) {
      onPendingCountChange(pendingByType);
    }
  }, [events, pendingReady, regionsReady, pendingByType, onPendingCountChange]);

  const availableKinds = useMemo(() => {
    const defaultKinds: ViewKind[] =
      deviceType === 'POS Terminal'
        ? ['INSTALL', 'REPLACE', 'BATTERY', 'POS_MAINT', 'POS_INACTIVE', 'POS_RETURN', 'POS_OFFLINE']
        : deviceType === 'Sound Box'
        ? ['INSTALL', 'REPLACE', 'SB_RETURN', 'SB_MAINT', 'SB_MAINTENANCE']
        : ['INSTALL', 'REPLACE', 'BATTERY', 'SB_MAINT', 'SB_MAINTENANCE', 'SB_RETURN', 'POS_MAINT', 'POS_INACTIVE', 'POS_RETURN', 'POS_OFFLINE'];
    const dynamicKinds = new Set<ViewKind>(defaultKinds);
    (scoped || []).forEach((e) => {
      if (deviceType && devType(e) !== deviceType) return;
      if (e.kind) dynamicKinds.add(viewKind(e));
    });
    return Array.from(dynamicKinds);
  }, [scoped, deviceType]);

  const kindCounts = useMemo(() => {
    const c: Record<string, number> = {
      ALL: 0,
      INSTALL: 0,
      REPLACE: 0,
      BATTERY: 0,
      SB_MAINT: 0,
      SB_RETURN: 0,
      POS_MAINT: 0,
      POS_INACTIVE: 0,
      POS_RETURN: 0,
      POS_OFFLINE: 0,
    };
    const len = dateScoped.length;
    for (let i = 0; i < len; i++) {
      const e = dateScoped[i];
      if (filter !== 'ALL' && e.status !== filter) continue;
      if (typeFilter !== 'ALL' && devType(e) !== typeFilter) continue;
      c.ALL++;
      const vk = viewKind(e);
      if (c[vk] !== undefined) c[vk]++;
      else c[vk] = 1;
      if (isIntegrated(e)) c.INSTALL_INTEG = (c.INSTALL_INTEG || 0) + 1;
    }
    return c;
  }, [dateScoped, filter, typeFilter]);

  const typeCounts = useMemo(() => {
    const c = { pos: 0, sb: 0 };
    const len = dateScoped.length;
    for (let i = 0; i < len; i++) {
      const e = dateScoped[i];
      if (filter !== 'ALL' && e.status !== filter) continue;
      if (!kindMatches(e, recordTypeFilter)) continue;
      if (e.deviceType === 'Sound Box') c.sb++;
      else c.pos++;
    }
    return c;
  }, [dateScoped, filter, recordTypeFilter]);

  const shownBase = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const hasQ = Boolean(q);
    const result: FieldEvent[] = [];
    const len = dateScoped.length;
    for (let i = 0; i < len; i++) {
      const e = dateScoped[i];
      if (filter !== 'ALL' && e.status !== filter) continue;
      if (!kindMatches(e, recordTypeFilter)) continue;
      if (typeFilter !== 'ALL' && devType(e) !== typeFilter) continue;
      if (hasQ) {
        const match =
          (e.serial && e.serial.toLowerCase().includes(q)) ||
          (e.mid && e.mid.toLowerCase().includes(q)) ||
          (e.tid && e.tid.toLowerCase().includes(q)) ||
          (e.outletName && e.outletName.toLowerCase().includes(q)) ||
          (e.staffName && e.staffName.toLowerCase().includes(q)) ||
          (e.staffId && e.staffId.toLowerCase().includes(q)) ||
          (e.branchText && e.branchText.toLowerCase().includes(q)) ||
          (e.oldSerial && e.oldSerial.toLowerCase().includes(q)) ||
          (e.sourceRecordId && e.sourceRecordId.toLowerCase().includes(q)) ||
          (e.terminalName && e.terminalName.toLowerCase().includes(q));
        if (!match) continue;
      }
      result.push(e);
    }
    return result.sort(
      (a, b) =>
        (b.receivedAt > a.receivedAt ? 1 : b.receivedAt < a.receivedAt ? -1 : 0) ||
        (b.sourceRecordId > a.sourceRecordId ? 1 : b.sourceRecordId < a.sourceRecordId ? -1 : 0) ||
        a.unitNo - b.unitNo
    );
  }, [dateScoped, filter, typeFilter, recordTypeFilter, deferredQuery]);

  const { sorted: shown, sort, toggle: toggleSort } = useSort(shownBase, {
    type: (e) => e.deviceType,
    kind: (e) => KIND_LABEL[viewKind(e)],
    serial: (e) => e.serial,
    merchant: (e) => e.terminalName || e.outletName,
    branch: (e) => e.branchText,
    staff: (e) => e.staffName,
    status: (e) => STATUS_LABEL[e.status],
    date: (e) => e.receivedAt,
  });

  const pg = usePager(shown.length, [filter, typeFilter, recordTypeFilter, deferredQuery, activeScope, effRange.from, effRange.to, sort]);

  // (31 Oct 2026) Export CSV: every record on the server that matches the filters (the screen keeps the latest 1,000)
  const exportCsv = useCallback(async () => {
    const all = hasDateFilter
      ? (await fetchFieldEventsByDateRange(effRange.from || undefined, effRange.to || undefined, filter === 'ALL' ? 'ALL' : filter)) || []
      : await fetchAllFieldEvents(filter === 'ALL' ? 'ALL' : filter);
    const q = query.trim().toLowerCase();
    const list = all
      .filter(inScope)
      .filter((e) => {
        if (!hasDateFilter) return true;
        if (!e.receivedAt) return false;
        const dt = new Date(e.receivedAt);
        if (isNaN(dt.getTime())) return false;
        const ymd = todayPP(dt);
        if (effRange.from && ymd < effRange.from) return false;
        if (effRange.to && ymd > effRange.to) return false;
        return true;
      })
      .filter((e) => kindMatches(e, recordTypeFilter))
      .filter((e) => typeFilter === 'ALL' || devType(e) === typeFilter)
      .filter((e) => !q || [e.serial, e.oldSerial, e.sourceRecordId, e.mid, e.tid, e.outletName, e.terminalName, e.staffName, e.staffId, e.branchText]
        .some((v) => String(v || '').toLowerCase().includes(q)));
    if (!list.length) return 0;
    downloadCsv(`Merchant_App_Review_${typeFilter === 'Sound Box' ? 'Sound_Box' : typeFilter === 'POS Terminal' ? 'POS_Terminal' : 'All'}`,
      ['Record ID', 'Device No', 'Revision', 'Date Sent', 'Recorded At', 'Device Type', 'Record Type', 'Serial', 'Old Serial', 'Old Battery', 'New Battery',
        'MID', 'TID', 'Terminal Name', 'Outlet Name', 'Staff ID', 'Staff Name', 'Branch', 'Branch Code', 'Latitude', 'Longitude', 'Warnings',
        'Status', 'Reviewed By', 'Reviewed At', 'Review Note', 'Remarks'],
      list.map((e) => [e.sourceRecordId, e.unitNo, e.revision, csvTime(e.receivedAt), csvTime(e.recordedAt), devType(e), KIND_LABEL[viewKind(e)] || e.kind,
        e.serial, e.oldSerial, e.oldBattery, e.newBattery, e.mid, e.tid, e.terminalName, e.outletName, e.staffId, e.staffName, e.branchText, e.branchId,
        e.latitude, e.longitude, (e.issues || []).map((i) => i.text).join(' | '), STATUS_LABEL[e.status] || e.status, e.reviewedByName,
        csvTime(e.reviewedAt), e.reviewNote, e.remarks]));
    return list.length;
  }, [filter, query, inScope, recordTypeFilter, typeFilter, hasDateFilter, effRange.from, effRange.to]);

  const shownPending = useMemo(() => shown.filter(selectable), [shown, selectable]);   // (the selectable rows shown)
  const selectedAll = useMemo(() => shownPending.filter((e) => selected.has(e.id)), [shownPending, selected]);
  const selectedShown = useMemo(() => selectedAll.filter((e) => e.status === 'PENDING'), [selectedAll]);   // approve / reject: waiting only
  const allSelected = shownPending.length > 0 && selectedAll.length === shownPending.length;

  const runDelete = async (reason: string) => {
    const list = selectedAll.filter((e) => e.status !== 'APPROVED');
    if (!list.length) return;
    setDelBusy(true);
    try {
      const res = await deletePhoneRecords('FIELD', list.map((e) => e.id), reason);
      const refused = new Set(res.refused.map((x) => x.id));
      const gone = new Set(list.filter((e) => !refused.has(e.id)).map((e) => e.id));
      setEvents((prev) => prev && prev.filter((x) => !gone.has(x.id)));
      setSelected(new Set());
      setDelOpen(false);
      setBulkReport(res.refused.length ? [`${res.deleted} deleted.`, ...res.refused.map((x) => `${x.record}: ${x.why}`)] : []);
      triggerToast(`${res.deleted} record(s) deleted permanently`);
    } catch (err) {
      triggerToast(`Not deleted: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDelBusy(false);
    }
  };

  const optsRef = useRef(opts);
  optsRef.current = opts;
  const setOpt = useCallback(
    (id: number, patch: Partial<RowOpt>) => setOpts((p) => ({ ...p, [id]: { ...p[id], ...patch } })),
    []
  );
  const toggle = useCallback(
    (id: number) =>
      setSelected((p) => {
        const n = new Set(p);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      }),
    []
  );
  const setBusy = (id: number, on: boolean) =>
    setBusyIds((p) => {
      const n = new Set(p);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const markDone = (id: number, st: FieldEventStatus) => {
    setEvents((prev) => prev && prev.map((x) => (x.id === id ? { ...x, status: st } : x)));
    setSelected((p) => {
      if (!p.has(id)) return p;
      const n = new Set(p);
      n.delete(id);
      return n;
    });
  };

  const approveOne = async (e: FieldEvent, ackAll: boolean): Promise<string> => {
    const o = resolve(e, optsRef.current[e.id]);
    if (hasBlock(e)) return 'cannot be approved as it is (see the red note)';
    if (needsBranchOf(e) && !o.branchId) return 'choose the branch first';
    const ack = ackAll || o.ack;
    if (hasWarn(e) && !ack) return 'tick "I checked the warnings" first';
    try {
      await approveFieldEvent(e.id, o.note, {
        branch_id: o.branchId || undefined,
        return_stage: needsReturnOf(e) ? o.returnStage : undefined,
        acknowledge: ack,
      });
      markDone(e.id, 'APPROVED');
      return '';
    } catch (x) {
      const m = x instanceof Error ? x.message : String(x);
      if (/warning/i.test(m)) setOpt(e.id, { ack: false });
      return m;
    }
  };
  const rejectOne = async (e: FieldEvent, reason: string): Promise<string> => {
    if (!reason.trim()) return 'write the reason to reject';
    try {
      await rejectFieldEvent(e.id, reason.trim());
      markDone(e.id, 'REJECTED');
      return '';
    } catch (x) {
      return x instanceof Error ? x.message : String(x);
    }
  };
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  const approveRow = useCallback(
    async (e: FieldEvent) => {
      setRowErr((p) => ({ ...p, [e.id]: '' }));
      setBusy(e.id, true);
      const err = await approveOne(e, false);
      setBusy(e.id, false);
      if (err) {
        setRowErr((p) => ({ ...p, [e.id]: cap(err) }));
        setOpen(e.id);
      } else {
        triggerToast(e.kind === 'POS_OFFLINE' ? `Approved · ${recName(e)}` : `Approved · ${recName(e)} · stock updated`);
        onApplied();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [triggerToast, onApplied]
  );

  const rejectRow = useCallback(
    async (e: FieldEvent) => {
      const note = resolve(e, optsRef.current[e.id]).note;
      if (!note.trim()) {
        setOpen(e.id);
        setRowErr((p) => ({ ...p, [e.id]: 'Write the reason to reject, then tap Reject again.' }));
        return;
      }
      setRowErr((p) => ({ ...p, [e.id]: '' }));
      setBusy(e.id, true);
      const err = await rejectOne(e, note);
      setBusy(e.id, false);
      if (err) setRowErr((p) => ({ ...p, [e.id]: cap(err) }));
      else triggerToast(`Rejected · ${recName(e)}`);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [triggerToast]
  );
  const toggleOpen = useCallback((id: number) => setOpen((p) => (p === id ? null : id)), []);

  const runBulk = async (mode: 'approve' | 'reject') => {
    const list = selectedShown.slice();
    if (!list.length) return;
    if (mode === 'reject' && !bulkNote.trim()) {
      setBulkReport(['Write the reason to reject the selected records.']);
      return;
    }
    setBulkBusy(mode);
    setBulkReport([]);
    let ok = 0;
    const problems: string[] = [];
    for (const e of list) {
      const err = mode === 'approve' ? await approveOne(e, bulkAck) : await rejectOne(e, bulkNote);
      if (err) problems.push(`${recName(e)}: ${err}`);
      else ok += 1;
    }
    setBulkBusy('');
    setBulkReport([`${ok} of ${list.length} ${mode === 'approve' ? 'approved' : 'rejected'}.`, ...problems]);
    if (ok) {
      triggerToast(`${ok} record(s) ${mode === 'approve' ? 'approved · stock updated' : 'rejected'}`);
      if (mode === 'approve') onApplied();
    }
    if (!problems.length) setBulkNote('');
  };

  const typePill = (t: TypeFilter, label: string, n: number) => {
    const active = typeFilter === t;
    return (
      <button
        key={t}
        type="button"
        onClick={() => setTypeFilter(t)}
        aria-pressed={active}
        className={`relative px-3 py-1.5 rounded-full text-xs flex items-center gap-1.5 transition-colors cursor-pointer select-none outline-none ${
          active ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
        }`}
      >
        {active && (
          <PillMotion
            layoutId="fr-type-pill"
            aria-hidden
            className={CAPSULE_PILL_CLS}
            transition={SPRING}
          />
        )}
        <span className="relative z-10 flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${t === 'ALL' ? 'bg-[#004e75]' : (DOT[t] || 'bg-slate-400')}`}
            aria-hidden
          />
          <span>{label}</span>{' '}
          <span
            className={`font-mono text-[10px] px-1.5 py-0.5 rounded-full transition-colors ${
              active ? CAPSULE_COUNT_ACTIVE_CLS : CAPSULE_COUNT_INACTIVE_CLS
            }`}
          >
            ({n})
          </span>
        </span>
      </button>
    );
  };

  const loadingFirst = !events && !loadError;
  const visibleRows = shown.slice(pg.start, pg.drawEnd);
  const unitCount = useMemo(() => {
    const m = new Map<string, number>();
    (events || []).forEach((x) => {
      if (x.status === 'CANCELLED' || x.status === 'SUPERSEDED') return;
      m.set(x.sourceRecordId, Math.max(m.get(x.sourceRecordId) || 0, x.unitNo));
    });
    return m;
  }, [events]);

  return (
    <div className="flex flex-col gap-3.5 apple-tab-panel">
      {/* (5 Nov 2026) Page header with the phone app figures: the same layout as KHQR */}
      <section className="relative overflow-hidden rounded-3xl p-6 sm:p-8 border shadow-sm bg-slate-100 border-slate-200/90 text-slate-900" aria-label={`${deviceType || 'Review'} statistics`}>
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2 max-w-3xl">
            <h1 className="text-2xl sm:text-3xl lg:text-[32px] font-extrabold tracking-tight flex flex-wrap items-center gap-3 text-slate-900 leading-tight">
              {deviceType === 'Sound Box'
                ? <Volume2 className="w-7 h-7 sm:w-8 sm:h-8 shrink-0 text-[#4F518C]" aria-hidden />
                : <Cpu className="w-7 h-7 sm:w-8 sm:h-8 shrink-0 text-[#184e77]" aria-hidden />}
              <span>{deviceType || 'Review'}</span>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-normal px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/90 tracking-normal"
                title="New records from the phone app appear here as they are saved">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden />
                {live ? 'Live' : 'Connected'}
              </span>
              {hasDateFilter && (
                <button
                  type="button"
                  onClick={() => setDateMenuOpen((o) => !o)}
                  title="Currently viewing records for this date filter — click to change or clear"
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[#004e75]/10 text-[#004e75] border border-[#004e75]/25 tracking-normal hover:bg-[#004e75]/15 transition-colors cursor-pointer"
                >
                  <Calendar className="w-3 h-3 shrink-0" aria-hidden />
                  <span>{dateLabel}</span>
                </button>
              )}
            </h1>
            <p className="text-sm sm:text-base leading-relaxed text-slate-600">
              {deviceType === 'Sound Box'
                ? 'Sound Box records from the Merchant Visit app: installations, replacements, maintenance and returns. Approve to update the stock, or reject with a reason.'
                : 'Merchant Visit app records. Approve to update stock, or reject. Offline counts need no approval.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <ExportCsvButton onExport={exportCsv} toast={triggerToast} title="Save the records that match the filters as a CSV file" />
            <button
              type="button"
              onClick={load}
              aria-label="Refresh"
              title="Refresh Merchant App Review records"
              className="group relative inline-flex items-center gap-2 px-3.5 py-2 rounded-xl active:scale-[0.98] transition-all font-semibold text-xs sm:text-sm border shadow-2xs cursor-pointer bg-white hover:bg-slate-50 text-slate-700 border-slate-200/90"
            >
              <RefreshCw className="w-3.5 h-3.5 text-slate-600 group-hover:rotate-180 transition-transform duration-300" />
              <span>Sync Stream</span>
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-2 mt-5 pt-5 border-t border-slate-200/90">
          {availableKinds.map((k) => {
            const stat = hero.byKind[k];
            const totalN = stat?.total || 0;
            const meta = KIND_CARD_META[k] || {
              icon: deviceType === 'Sound Box' ? Volume2 : Cpu,
              iconCls: 'bg-sky-50 text-sky-600 border-sky-200/80',
            };
            const Icon = meta.icon;
            const pct = hero.total > 0 && totalN > 0 ? Math.round((totalN / hero.total) * 100) : 0;
            const barWidth =
              !events || totalN === 0 || hero.maxKind === 0
                ? 0
                : Math.max(3, Math.round((totalN / hero.maxKind) * 100));
            const isActive = recordTypeFilter === k || (recordTypeFilter === 'INSTALL_INTEG' && k === 'INSTALL');   // (integrated: a part of Installation)
            const dimmed = recordTypeFilter !== 'ALL' && !isActive;

  return (
              <button
                key={k}
                type="button"
                aria-pressed={isActive}
                onClick={() => setRecordTypeFilter((prev) => (prev === k ? 'ALL' : k))}
                className={`group w-full text-left px-3 py-2.5 rounded-xl transition-all duration-200 cursor-pointer ${
                  isActive
                    ? 'bg-white shadow-sm ring-1 ring-[#004e75]/30'
                    : 'hover:bg-white/70'
                } ${dimmed ? 'opacity-75 hover:opacity-100' : ''}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`w-6.5 h-6.5 rounded-lg inline-flex items-center justify-center border shrink-0 transition-transform shadow-2xs ${meta.iconCls} ${
                        isActive ? 'scale-105' : 'group-hover:scale-105'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" aria-hidden />
                    </span>
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span
                        className={`text-[13px] tracking-[-0.01em] truncate ${
                          isActive ? 'font-bold text-[#004e75]' : 'font-semibold text-slate-800'
                        }`}
                      >
                        {KIND_LABEL[k] || k}
                      </span>
                      <span className="hidden sm:inline text-[11px] font-medium text-slate-400 truncate">
                        {events ? formatKindSummarySub(stat) : 'Loading…'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 font-figure tabular-nums">
                    <span className={`text-[15px] sm:text-base font-bold ${isActive ? 'text-[#004e75]' : 'text-slate-900'}`}>
                      {events ? totalN.toLocaleString() : '—'}
                    </span>
                    {events && hero.total > 0 ? (
                      <span
                        className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md min-w-[2.4rem] text-center transition-colors ${
                          isActive
                            ? 'bg-[#004e75]/10 text-[#004e75]'
                            : 'bg-slate-200/70 text-slate-600'
                        }`}
                      >
                        {pct}%
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="h-[7px] w-full rounded-full bg-slate-200/80 overflow-hidden mt-2">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      dimmed
                        ? 'bg-[#004e75]/30 group-hover:bg-[#004e75]/75'
                        : 'bg-gradient-to-r from-[#004e75] via-[#006494] to-[#0284c7] group-hover:brightness-110'
                    }`}
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Section 1 — Clean Filter & Bulk Decision Header */}
      <section
        className={`${REVIEW_FILTER_BAR_CLS} transition-all`}
        aria-label="Filters"
      >
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          {/* Segmented status tabs */}
          <div className={REVIEW_TAB_GROUP_CLS}>
            {([
              { f: 'PENDING' as Filter, label: 'Waiting', Icon: Clock, accent: 'text-amber-500' },
              { f: 'APPROVED' as Filter, label: 'Approved', Icon: CheckCircle2, accent: 'text-emerald-600' },
              { f: 'REJECTED' as Filter, label: 'Rejected', Icon: XCircle, accent: 'text-rose-600' },
              { f: 'ALL' as Filter, label: 'All', Icon: ScanLine, accent: 'text-[#002F4A]' },
            ]).map(({ f, label, Icon, accent }) => {
              const isActive = filter === f;
  return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  aria-pressed={isActive}
                  className={`relative h-[30px] px-2.5 rounded-full text-[11.5px] flex items-center gap-1 whitespace-nowrap transition-colors cursor-pointer select-none outline-none ${
                    isActive ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
                  }`}
                >
                  {isActive && (
                    <PillMotion
                      layoutId="fr-status-pill"
                      aria-hidden
                      className={CAPSULE_PILL_CLS}
                      transition={SPRING}
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-1.5">
                    <Icon className={`w-3.5 h-3.5 shrink-0 transition-colors ${accent}`} aria-hidden />
                    <span>{label}</span>
                    <span
                      className={`font-mono text-[10px] px-1.5 py-[1px] rounded-full transition-colors ${
                        isActive
                          ? f === 'PENDING'
                            ? CAPSULE_COUNT_WARN_ACTIVE_CLS
                            : CAPSULE_COUNT_ACTIVE_CLS
                          : CAPSULE_COUNT_INACTIVE_CLS
                      }`}
                    >
                      {counts[f].toLocaleString()}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* Segmented device type tabs (not shown when a sub-menu has chosen the device type) */}
          {!deviceType && (
            <div className={REVIEW_TAB_GROUP_CLS}>
              {typePill('ALL', 'All devices', typeCounts.pos + typeCounts.sb)}
              {typePill('POS Terminal', 'POS Terminal', typeCounts.pos)}
              {typePill('Sound Box', 'Sound Box', typeCounts.sb)}
            </div>
          )}

          {/* Region Scope Select: All Regions / Phnom Penh / Regional */}
          <div className="relative inline-flex items-center shrink-0">
            <MapPin className="w-3.5 h-3.5 text-slate-500 pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden />
            <select
              value={activeScope}
              onChange={(e) => setActiveScope(e.target.value as FieldScope)}
              aria-label="Filter by region"
              className={`${REVIEW_SELECT_CLS} !pl-7 max-w-[116px] ${
                activeScope !== 'ALL'
                  ? '!bg-sky-50/70 !text-[#155484] !border-[#155484]/35'
                  : ''
              }`}
              title="Filter records by Phnom Penh, Regional, or All Regions"
            >
              <option value="ALL">All Regions</option>
              <option value="PHNOM_PENH">Phnom Penh</option>
              <option value="REGIONAL">Regional</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute right-2 top-1/2 -translate-y-1/2" aria-hidden />
          </div>

          {/* Record Type Select Filter */}
          <div className="relative inline-flex items-center shrink-0">
            <select
              value={recordTypeFilter}
              onChange={(e) => setRecordTypeFilter(e.target.value as RecordTypeFilter)}
              aria-label="Filter by record type"
              className={`${REVIEW_SELECT_CLS} max-w-[132px] ${
                recordTypeFilter !== 'ALL' ? '!bg-sky-50/70 !text-[#155484] !border-[#155484]/35' : ''
              }`}
            >
              <option value="ALL">All Types ({kindCounts.ALL || 0})</option>
              {availableKinds.flatMap((k) => [
                <option key={k} value={k}>
                  {KIND_LABEL[k] || k} ({kindCounts[k] || 0})
                </option>,
                ...(k === 'INSTALL' && deviceType !== 'Sound Box'
                  ? [<option key="INSTALL_INTEG" value="INSTALL_INTEG">{'\u00a0\u00a0'}Integrated installation ({kindCounts.INSTALL_INTEG || 0})</option>]
                  : []),
              ])}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute right-2 top-1/2 -translate-y-1/2" aria-hidden />
          </div>

          {/* Date Selector & Quick Range Popover */}
          <div ref={dateMenuRef} className="relative inline-flex items-center shrink-0">
            <div className="inline-flex items-center">
              <button
                type="button"
                onClick={() => setDateMenuOpen((v) => !v)}
                aria-expanded={dateMenuOpen}
                aria-haspopup="dialog"
                aria-label="Filter by date"
                className={`btn-press inline-flex items-center gap-1.5 h-[34px] px-2.5 text-xs border transition-all cursor-pointer whitespace-nowrap ${
                  hasDateFilter
                    ? 'rounded-l-xl bg-[#004e75]/10 border-[#004e75]/35 text-[#004e75] font-semibold hover:bg-[#004e75]/15'
                    : 'rounded-xl bg-white hover:bg-slate-50 text-slate-700 border-slate-200 font-medium'
                }`}
              >
                {dateLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-[#004e75]" aria-hidden />
                ) : (
                  <Calendar className={`w-3.5 h-3.5 shrink-0 ${hasDateFilter ? 'text-[#004e75]' : 'text-slate-500'}`} aria-hidden />
                )}
                <span>{dateLabel}</span>
                <ChevronDown
                  className={`w-3.5 h-3.5 shrink-0 transition-transform duration-150 ${
                    dateMenuOpen ? 'rotate-180' : ''
                  } ${hasDateFilter ? 'text-[#004e75]/80' : 'text-slate-400'}`}
                  aria-hidden
                />
              </button>
              {hasDateFilter && (
                <button
                  type="button"
                  onClick={() => {
                    setDateFrom('');
                    setDateTo('');
                    setDateMenuOpen(false);
                  }}
                  aria-label="Clear date filter"
                  title="Show all dates"
                  className="btn-press h-[34px] px-2 rounded-r-xl border border-l-0 border-[#004e75]/35 bg-[#004e75]/10 text-[#004e75] hover:bg-[#004e75]/20 transition-colors cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" aria-hidden />
                </button>
              )}
            </div>

            {dateMenuOpen && (
              <div
                role="dialog"
                aria-label="Select date or date range"
                className="absolute left-0 top-full mt-2 w-[320px] sm:w-[348px] bg-white rounded-2xl border border-slate-200 shadow-xl p-3.5 z-40 space-y-3"
              >
                <div>
                  <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                    Quick View
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(() => {
                      const yest = shiftYmd(todayYmd, -1);
                      const w7 = shiftYmd(todayYmd, -6);
                      const thisM = monthBoundsPP(todayYmd, 0);
                      const lastM = monthBoundsPP(todayYmd, -1);
                      const presets = [
                        { label: 'All Dates', from: '', to: '' },
                        { label: 'Today', from: todayYmd, to: todayYmd },
                        { label: 'Yesterday', from: yest, to: yest },
                        { label: 'Last 7 Days', from: w7, to: todayYmd },
                        { label: 'This Month', from: thisM.from, to: thisM.to },
                        { label: 'Last Month', from: lastM.from, to: lastM.to },
                      ];
                      return presets.map((p) => {
                        const active =
                          (!p.from && !p.to && !hasDateFilter) ||
                          (Boolean(p.from) && effRange.from === p.from && effRange.to === p.to);
  return (
                          <button
                            key={p.label}
                            type="button"
                            onClick={() => {
                              setDateFrom(p.from);
                              setDateTo(p.to);
                            }}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer ${
                              active
                                ? 'bg-[#004e75] text-white border-[#004e75] font-semibold shadow-2xs'
                                : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                            }`}
                          >
                            {p.label}
                          </button>
                        );
                      });
                    })()}
                  </div>
                </div>

                <div className="pt-2.5 border-t border-slate-100">
                  <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                    Select Specific Date
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const base = effRange.from && effRange.from === effRange.to ? effRange.from : todayYmd;
                        const prevDay = shiftYmd(base, -1);
                        setDateFrom(prevDay);
                        setDateTo(prevDay);
                      }}
                      aria-label="Previous day"
                      title="Previous day"
                      className="p-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 transition-colors cursor-pointer shrink-0"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" aria-hidden />
                    </button>
                    <input
                      type="date"
                      value={effRange.from && effRange.from === effRange.to ? effRange.from : ''}
                      max={todayYmd}
                      onChange={(ev) => {
                        const v = ev.target.value;
                        setDateFrom(v);
                        setDateTo(v);
                      }}
                      aria-label="Select date"
                      className="flex-1 min-w-0 px-2.5 py-1.5 rounded-xl text-xs font-mono border border-slate-200 bg-slate-50 text-slate-800 outline-none focus:border-[#004e75] focus:ring-2 focus:ring-[#004e75]/10"
                    />
                    <button
                      type="button"
                      disabled={Boolean(effRange.from && effRange.from === effRange.to && effRange.from >= todayYmd)}
                      onClick={() => {
                        const base = effRange.from && effRange.from === effRange.to ? effRange.from : todayYmd;
                        const nextDay = shiftYmd(base, 1);
                        const clamped = nextDay > todayYmd ? todayYmd : nextDay;
                        setDateFrom(clamped);
                        setDateTo(clamped);
                      }}
                      aria-label="Next day"
                      title="Next day"
                      className="p-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none text-slate-600 transition-colors cursor-pointer shrink-0"
                    >
                      <ChevronRight className="w-3.5 h-3.5" aria-hidden />
                    </button>
                  </div>
                </div>

                <div className="pt-2.5 border-t border-slate-100">
                  <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                    Custom Date Range
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">From</label>
                      <input
                        type="date"
                        value={dateFrom}
                        max={dateTo || todayYmd}
                        onChange={(ev) => setDateFrom(ev.target.value)}
                        aria-label="From date"
                        className="w-full px-2 py-1.5 rounded-xl text-[11.5px] font-mono border border-slate-200 bg-slate-50 text-slate-800 outline-none focus:border-[#004e75] focus:ring-2 focus:ring-[#004e75]/10"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">To</label>
                      <input
                        type="date"
                        value={dateTo}
                        min={dateFrom || undefined}
                        max={todayYmd}
                        onChange={(ev) => setDateTo(ev.target.value)}
                        aria-label="To date"
                        className="w-full px-2 py-1.5 rounded-xl text-[11.5px] font-mono border border-slate-200 bg-slate-50 text-slate-800 outline-none focus:border-[#004e75] focus:ring-2 focus:ring-[#004e75]/10"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-slate-500 tabular-nums">
                    {dateLoading
                      ? 'Loading records…'
                      : `${counts.ALL.toLocaleString()} record${counts.ALL === 1 ? '' : 's'} matched`}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {hasDateFilter && (
                      <button
                        type="button"
                        onClick={() => {
                          setDateFrom('');
                          setDateTo('');
                        }}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-medium text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                      >
                        Reset
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setDateMenuOpen(false)}
                      className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-[#004e75] text-white hover:bg-[#003c5a] transition-colors cursor-pointer shadow-2xs"
                    >
                      Done
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="relative flex-1 min-w-[135px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search serial, MID, staff…"
              aria-label="Search records"
              className={REVIEW_INPUT_CLS}
            />
          </div>
          <ClearFiltersButton
            short
            active={!!query || typeFilter !== (deviceType || 'ALL') || filter !== 'PENDING' || recordTypeFilter !== 'ALL' || hasDateFilter}
            onClear={() => {
              setQuery('');
              setTypeFilter(deviceType || 'ALL');
              setFilter('PENDING');
              setRecordTypeFilter('ALL');
              setDateFrom('');
              setDateTo('');
              setDateMenuOpen(false);
            }}
          />

          {/* Inline Bulk Decision Actions */}
          {isAdmin && selectedAll.length > 0 && (
            <div
              className="flex items-center gap-1.5 shrink-0 bg-slate-50 border border-slate-200/90 rounded-xl px-2 py-1 ml-auto flex-nowrap"
              aria-label="Decide the selected records"
            >
              <span className="px-2 py-0.5 rounded-md bg-white text-slate-700 border border-slate-200 text-[11px] font-medium font-mono whitespace-nowrap">
                {selectedAll.length} Selected
              </span>
              {selectedShown.length > 0 && (
                <>
                  <input
                    value={bulkNote}
                    onChange={(e) => setBulkNote(e.target.value)}
                    maxLength={500}
                    placeholder="Reason (to reject)"
                    aria-label="Reason for the selected records"
                    className="w-[120px] xl:w-[140px] px-2 py-1 rounded-lg border border-slate-200 text-xs font-normal text-slate-800 outline-none focus:border-slate-400 bg-white"
                  />
                  {selectedShown.some(hasWarn) && (
                    <label className="flex items-center gap-1 text-[11px] font-normal text-slate-700 cursor-pointer whitespace-nowrap">
                      <input type="checkbox" checked={bulkAck} onChange={(e) => setBulkAck(e.target.checked)} /> Checked
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={() => runBulk('reject')}
                    disabled={!!bulkBusy}
                    className="btn-press px-2.5 py-1 rounded-lg text-xs font-semibold border border-rose-200/90 text-rose-700 bg-rose-50 hover:bg-rose-100 disabled:opacity-50 flex items-center gap-1 cursor-pointer shadow-2xs transition-all active:scale-[0.97] whitespace-nowrap"
                  >
                    {bulkBusy === 'reject' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-rose-600" aria-hidden="true" />
                    )}{' '}
                    Reject {selectedShown.length}
                  </button>
                  <button
                    type="button"
                    onClick={() => runBulk('approve')}
                    disabled={!!bulkBusy}
                    className="btn-press px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs hover:shadow border border-emerald-600/30 disabled:opacity-50 flex items-center gap-1 cursor-pointer transition-all active:scale-[0.97] whitespace-nowrap"
                  >
                    {bulkBusy === 'approve' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5 text-white" aria-hidden="true" />
                    )}{' '}
                    Approve {selectedShown.length}
                  </button>
                </>
              )}
              {isSuper && (
                <button
                  type="button"
                  onClick={() => setDelOpen(true)}
                  disabled={!!bulkBusy || delBusy}
                  className="btn-press px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-60 flex items-center gap-1 cursor-pointer shadow-2xs active:scale-[0.98] whitespace-nowrap"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete {selectedAll.length}
                </button>
              )}
            </div>
          )}
          {bulkReport.length > 0 && (
            <div role="status" className="basis-full text-xs text-rose-600 font-medium pt-1">
              {bulkReport[0]}
            </div>
          )}
        </div>
      </section>
      <DeleteRecordsDialog
        open={delOpen}
        count={selectedAll.length}
        what={deviceType === 'Sound Box' ? 'Sound Box records' : deviceType === 'POS Terminal' ? 'POS Terminal records' : 'phone app records'}
        sample={selectedAll.map((e) => e.sourceRecordId + (e.unitNo > 1 ? ' #' + e.unitNo : ''))}
        note={selectedAll.some((e) => e.status === 'PENDING') ? 'Waiting records are deleted without a review decision; the staff member is not told.' : undefined}
        busy={delBusy}
        onCancel={() => setDelOpen(false)}
        onConfirm={runDelete}
      />

      {loadError && (
        <div
          role="alert"
          className="text-xs font-bold text-rose-800 bg-rose-50 border border-rose-200 rounded-2xl px-4 py-3"
        >
          {loadError}
        </div>
      )}

      {/* Section 3 — Clean Table Frame */}
      <section
        className="fr-table-frame bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-x-auto overflow-y-hidden"
        aria-label="Records"
      >
        <div className="min-w-[1185px]">
          <div
            className={`${GRID} glass-table-thead navy-header-bar bg-[#002F4A] text-white border-b border-slate-300 text-[11px] font-medium uppercase tracking-wider px-3.5 py-2`}
            role="row"
          >
            <span className="flex justify-center">
              {isAdmin && shownPending.length > 0 && (
                <SelectBox
                  light
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(shownPending.map((e) => e.id)))}
                  label={allSelected ? 'Unselect all' : shownPending.every((x) => x.status === 'PENDING') ? 'Select all waiting' : 'Select all (not approved)'}
                />
              )}
            </span>
            <span className="text-center font-medium">No.</span>
            <SortBtn k="type" sort={sort} onSort={toggleSort}>
              Device Type
            </SortBtn>
            <SortBtn k="kind" sort={sort} onSort={toggleSort}>
              Record Type
            </SortBtn>
            <SortBtn k="date" sort={sort} onSort={toggleSort} className="pl-2">
              Date Sent
            </SortBtn>
            <SortBtn k="serial" sort={sort} onSort={toggleSort} className="pl-2">
              Serial Number
            </SortBtn>
            <SortBtn k="merchant" sort={sort} onSort={toggleSort} className="pl-2">
              Terminal / MID
            </SortBtn>
            <SortBtn k="branch" sort={sort} onSort={toggleSort}>
              Staff / Branch
            </SortBtn>
            <SortBtn k="status" sort={sort} onSort={toggleSort}>
              Status
            </SortBtn>
            <span className="text-right">Decision</span>
          </div>

          {loadingFirst && (
            <div aria-busy="true" aria-label="Loading">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-[54px] border-b border-slate-100 px-3.5 flex items-center">
                  <div className="skeleton h-3.5 rounded w-2/3" />
                </div>
              ))}
            </div>
          )}

          {events && shown.length === 0 && (
            <div className="p-10 text-center text-sm font-semibold text-slate-500 space-y-2">
              {dateLoading || (filter !== 'PENDING' && !reviewedReady) ? (
                <span>Loading earlier records…</span>
              ) : hasDateFilter && filter === 'PENDING' && counts.ALL > 0 ? (
                <div className="flex flex-col items-center gap-2.5">
                  <span>
                    No waiting records for <span className="text-slate-800 font-bold">{dateLabel}</span> —{' '}
                    {counts.ALL.toLocaleString()} reviewed record{counts.ALL === 1 ? '' : 's'} found.
                  </span>
                  <button
                    type="button"
                    onClick={() => setFilter('ALL')}
                    className="btn-press inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-[#004e75] text-white hover:bg-[#003c5a] transition-colors cursor-pointer shadow-2xs"
                  >
                    <span>View All ({counts.ALL.toLocaleString()})</span>
                  </button>
                </div>
              ) : filter === 'PENDING' ? (
                <span>Nothing is waiting for review in this view.</span>
              ) : (
                <span>No records match the current filters.</span>
              )}
            </div>
          )}

          <div
            data-page-content
            className={`divide-y divide-slate-200/90 silk-rows table-quiet-body ${(Boolean(events) && (dateLoading || (filter !== 'PENDING' && reviewedLoading && !reviewedReady))) || query !== deferredQuery ? 'is-loading' : ''}`}
          >
            {visibleRows.map((e, idx) => (
                <ReviewRow
                  key={e.id}
                  e={e}
                  units={unitCount.get(e.sourceRecordId) || 1}
                  no={pg.start + idx + 1}
                  isAdmin={isAdmin}
                  branches={branches}
                  o={opts[e.id]}
                  checked={selected.has(e.id)}
                  selectable={selectable(e)}
                  isOpen={open === e.id}
                  busy={busyIds.has(e.id) || !!bulkBusy}
                  err={rowErr[e.id] || ''}
                  device={deviceBySerial.get(e.serial.toUpperCase())}
                  oldDevice={e.oldSerial ? deviceBySerial.get(e.oldSerial.toUpperCase()) : undefined}
                  onOpt={setOpt}
                  onCheck={toggle}
                  onToggle={toggleOpen}
                  onApprove={approveRow}
                  onReject={rejectRow}
                  onOpenWorkflow={onOpenWorkflow}
                  onEdit={isAdmin ? setEditing : undefined}
                />
              ))}
          </div>
          <Pager pg={pg} label="records" />
        </div>
      </section>
      {editing && (
        <PhoneRecordEditDialog
          open={!!editing}
          source="FIELD"
          rowId={editing.id}
          title={`Edit ${editing.sourceRecordId}${editing.unitNo > 1 ? ' · device ' + editing.unitNo : ''}`}
          sub={`${editing.deviceType} · ${KIND_LABEL_EDIT[viewKind(editing)] || editing.kind} · ${editing.status === 'APPROVED' ? 'Approved' : editing.status === 'PENDING' ? 'Pending' : editing.status.charAt(0) + editing.status.slice(1).toLowerCase()}`}
          fields={fieldEditFields(editing)}
          note="Saved in the portal at once, and written to the same row of the Merchant Visit Google Sheet within a few minutes."
          onClose={() => setEditing(null)}
          onSaved={() => { load(); }}
          triggerToast={triggerToast}
        />
      )}
    </div>
  );
};
const KIND_LABEL_EDIT: Record<string, string> = { INSTALL: 'New Installation', REPLACE: 'Replacement', BATTERY: 'Battery Replacement', SB_MAINT: 'Sound Box Operational Support',
  SB_RETURN: 'Return', POS_MAINT: 'POS Operational Support', POS_INACTIVE: 'In-Active Maintenance', POS_RETURN: 'Return & Terminate', POS_OFFLINE: 'POS Offline Count', SB_MAINTENANCE: 'SB Maintenance' };

const SortBtn: React.FC<{
  k: string;
  sort: SortState | null;
  onSort: (k: string) => void;
  children: React.ReactNode;
  right?: boolean;
  className?: string;
}> = ({ k, sort, onSort, children, right, className = '' }) => {
  const a = sort?.key === k;
  const I = !a ? ChevronsUpDown : sort!.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      aria-sort={a ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      title="Sort: ascending, descending, original order"
      className={`inline-flex items-center gap-1 cursor-pointer uppercase font-medium tracking-wider whitespace-nowrap ${
        right ? 'justify-end' : ''
      } ${className}`}
    >
      <span>{children}</span>
      <I className={`w-3 h-3 shrink-0 ${a ? 'opacity-100 text-sky-300' : 'opacity-65'}`} aria-hidden />
    </button>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="min-w-0">
    <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-2">{title}</div>
    <div className="flex flex-col gap-1.5 text-xs text-slate-700 font-normal">{children}</div>
  </div>
);
const Line: React.FC<{ k: string; children: React.ReactNode; mono?: boolean }> = ({ k, children, mono }) => (
  <div className="flex gap-2">
    <span className="w-28 shrink-0 text-slate-500 font-normal">{k}</span>
    <span className={`min-w-0 break-words text-slate-800 font-normal ${mono ? 'font-mono' : ''}`}>
      {children || '—'}
    </span>
  </div>
);

interface RowProps {
  units?: number;
  e: FieldEvent;
  no: number;
  isAdmin: boolean;
  branches: Branch[];
  o?: RowOpt;
  checked: boolean;
  selectable: boolean;
  isOpen: boolean;
  busy: boolean;
  err: string;
  device?: Device;
  oldDevice?: Device;
  onOpt: (id: number, p: Partial<RowOpt>) => void;
  onCheck: (id: number) => void;
  onToggle: (id: number) => void;
  onApprove: (e: FieldEvent) => void;
  onReject: (e: FieldEvent) => void;
  onOpenWorkflow?: (serial: string) => void;
  onEdit?: (e: FieldEvent) => void;
}

const ReviewRow = memo(function ReviewRow({
  e,
  units = 1,
  no,
  isAdmin,
  branches,
  o,
  checked,
  selectable,
  isOpen,
  busy,
  err,
  device,
  oldDevice,
  onOpt,
  onCheck,
  onToggle,
  onApprove,
  onReject,
  onOpenWorkflow,
  onEdit,
}: RowProps) {
  const pending = e.status === 'PENDING';
  const type = e.deviceType === 'Sound Box' ? 'Sound Box' : 'POS Terminal';
  const r = resolve(e, o);
  const blocks = e.issues.filter((i) => i.level === 'block').length;
  const warns = e.issues.filter((i) => i.level === 'warn').length;
  const needsBranch = needsBranchOf(e);
  const needsReturn = needsReturnOf(e);
  const stageText = (d?: Device) =>
    d
      ? `${STAGE_META[d.stage]?.short || d.stage} · Branch ${d.branchId}${d.merchantName ? ' · ' + d.merchantName : ''}`
      : 'Not in the inventory';
  const merchant = [e.outletName, e.terminalName && e.terminalName !== e.outletName ? e.terminalName : '']
    .filter(Boolean)
    .join(' · ');
  const entry = entryOf(e);
  const canApprove = !blocks && !busy && (!needsBranch || !!r.branchId);

  const serialCls = 'font-mono text-xs tabular-nums whitespace-nowrap font-medium text-slate-800 dark:text-slate-200';
  return (
    <div
      className={`transition-colors border-b border-slate-200/90 ${
        checked ? 'bg-sky-50/80' : isOpen ? 'bg-slate-50/95' : 'bg-white hover:bg-slate-50/75'
      }`}
    >
      {/* Clean Row */}
      <div className={`${GRID} px-3.5 py-2.5 text-xs font-normal text-slate-700`}>
        <span className="flex justify-center">
          {selectable && <SelectBox checked={checked} onChange={() => onCheck(e.id)} label={`Select ${recName(e)}`} />}
        </span>
        <span className="text-center text-slate-500 font-mono font-normal tabular-nums">{no}</span>
        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap font-semibold ${type === 'Sound Box' ? 'text-[#4F518C]' : 'text-[#184e77]'}`}>
          {type === 'Sound Box' ? (
            <Volume2 className="w-3.5 h-3.5 text-[#4F518C] shrink-0" aria-hidden />
          ) : (
            <Cpu className="w-3.5 h-3.5 text-[#184e77] shrink-0" aria-hidden />
          )}
          <span>{type}</span>
        </span>
        <span className="whitespace-nowrap leading-snug font-normal text-slate-700" title={KIND_LABEL[viewKind(e)]}>
          {KIND_LABEL[viewKind(e)]}
          {units > 1 && (
            <span className="block text-[11px] font-normal text-slate-500">
              Device {e.unitNo} of {units}
            </span>
          )}
        </span>
        <span className="leading-snug min-w-0 pl-2">
          <span className="tabular-nums font-normal text-slate-600 whitespace-nowrap block" title={fmtTime(e.receivedAt)}>
            {fmtTime(e.receivedAt)}
          </span>
          {e.sourceRecordId && <CopyableRecordId id={e.sourceRecordId} />}
        </span>
        <div className="min-w-0 leading-snug pl-2 pr-1 space-y-0.5">
          <div className="flex items-center gap-1 min-w-0">
            <button
              type="button"
              onClick={() => onToggle(e.id)}
              aria-expanded={isOpen}
              className="text-left font-mono cursor-pointer hover:underline inline-flex items-center gap-1 group min-w-0 select-text"
              title={howTitle('Serial', e.serial, entry.serial, entry.serialFromMid)}
            >
              <ChevronDown
                className={`w-3.5 h-3.5 shrink-0 text-slate-400 transition-transform duration-300 ${
                  isOpen ? 'rotate-180 text-slate-700' : ''
                }`}
                aria-hidden
              />
              {e.serial ? (
                <span className={`${serialCls} select-text truncate group-hover:text-slate-950 dark:group-hover:text-white`}>
                  {e.serial}
                </span>
              ) : (
                /* (21 Nov 2026) POS Offline Count: the form asks no serial - the terminal is its TID */
                <span className="font-sans text-slate-500 dark:text-slate-400 italic truncate">{e.tid ? `TID ${e.tid}` : 'No serial'}</span>
              )}
            </button>
            {e.serial && (
              <span className="inline-flex items-center gap-1 shrink-0 ml-0.5">
                <CopySerialButton value={e.serial} label="serial" />
                <InputMethodBadge
                  method={entry.serial}
                  titlePrefix={entry.serialFromMid ? 'Serial (filled from MID)' : 'Serial'}
                />
              </span>
            )}
          </div>
          {e.oldSerial && (
            <div
              className="flex items-center gap-1 min-w-0"
              title={`Replaces old unit ${e.oldSerial} (${howText(entry.oldSerial)})`}
            >
              <span className="w-3.5 shrink-0 inline-flex items-center justify-center">
                <ArrowLeftRight className="w-3 h-3 text-amber-600 dark:text-amber-400" aria-hidden />
              </span>
              <span className={`${serialCls} select-text truncate`}>
                {e.oldSerial}
              </span>
              <span className="inline-flex items-center gap-1 shrink-0 ml-0.5">
                <CopySerialButton value={e.oldSerial} label="old serial" />
                <InputMethodBadge method={entry.oldSerial} titlePrefix="Old Serial" />
              </span>
            </div>
          )}
        </div>
        <span className="min-w-0 leading-snug pl-2" title={merchant}>
          <span className="block truncate khmer font-normal text-slate-800">
            {e.terminalName || e.outletName || '—'}
          </span>
          {e.mid && (
            <span
              className="flex items-center gap-1.5 truncate font-mono text-[11px] text-slate-500 dark:text-slate-400 font-normal"
              title={howTitle('MID', e.mid, entry.mid)}
            >
              <span className="truncate">{e.mid}</span>
              <InputMethodBadge method={entry.mid} titlePrefix="MID" size="xs" />
            </span>
          )}
        </span>
        <span className="truncate leading-snug" title={`${e.staffName || ''} · ${e.branchText || ''}`}>
          <span className="block truncate font-medium text-slate-800">{e.staffName || '—'}{e.staffId ? ` (${e.staffId})` : ''}</span>
          <span className="block text-[11px] font-normal text-slate-500 truncate">
            {e.branchText || '—'}

          </span>
        </span>
        <span className="leading-snug">
          <span
            className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-normal border ${
              e.status === 'PENDING'
                ? 'bg-slate-100 text-slate-700 border-slate-200'
                : e.status === 'APPROVED'
                ? 'bg-emerald-50/70 text-emerald-700 border-emerald-200/80'
                : e.status === 'REJECTED'
                ? 'bg-rose-50/70 text-rose-700 border-rose-200/80'
                : 'bg-slate-100 text-slate-600 border-slate-200'
            }`}
          >
            {STATUS_LABEL[e.status].length > 12 ? 'Closed' : STATUS_LABEL[e.status]}
          </span>
        </span>
        <span className="flex justify-end">
          <button
            type="button"
            onClick={() => onToggle(e.id)}
            className={`px-3 py-1 rounded-lg border text-xs font-medium transition-all cursor-pointer ${
              isOpen
                ? 'bg-[#d5eae6] text-[#144741] border-[#9fd0c7] shadow-2xs'
                : 'bg-[#eaf4f2] hover:bg-[#d5eae6] text-[#1d5c55] hover:text-[#144741] border-[#c3e0da] hover:border-[#9fd0c7]'
            }`}
          >
            {isOpen ? 'Hide' : 'Manage'}
          </button>
        </span>
      </div>

      {/* Expandable Detail Drawer */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="detail"
            variants={ACCORDION_EXPAND_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
            className="px-5 pb-4 pt-3 grid gap-x-10 gap-y-4 md:grid-cols-2 border-t border-slate-200 bg-slate-50/90"
          >
            {onEdit && (e.status === 'PENDING' || e.status === 'APPROVED' || e.status === 'REJECTED') && (
              <div className="md:col-span-2 flex justify-end -mb-2">
                <button type="button" onClick={() => onEdit(e)} data-testid="edit-record"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer shadow-2xs">
                  <PencilLine className="w-3.5 h-3.5" aria-hidden="true" />Edit details
                </button>
              </div>
            )}
            <Section title="Field Submission Details">
              <Line k="Record">
                <span className="inline-flex items-center gap-1.5 flex-wrap">
                  <CopyableRecordId id={e.sourceRecordId} variant="badge" />
                  {e.unitNo > 1 ? ` · unit ${e.unitNo}` : ''} · {fmtTime(e.recordedAt)}
                </span>
              </Line>
              <Line k="Staff">{e.staffName ? `${e.staffName}${e.staffId ? ` (${e.staffId})` : ''}` : ''}</Line>
              <Line k="Entered by">
                <span className="inline-flex items-center gap-1.5 flex-wrap">
                  <span className="inline-flex items-center gap-1">
                    Serial:{' '}
                    <span>
                      {entry.serialFromMid ? `Filled from ${entry.mid === 'SCAN' ? 'scanned' : 'typed'} MID` : howText(entry.serial)}
                    </span>
                    <InputMethodBadge method={entry.serial} titlePrefix={entry.serialFromMid ? 'Serial (filled from MID)' : 'Serial'} size="xs" />
                  </span>
                  {e.oldSerial && (
                    <span className="inline-flex items-center gap-1">
                      · Old Serial: <span>{howText(entry.oldSerial)}</span>
                      <InputMethodBadge method={entry.oldSerial} titlePrefix="Old Serial" size="xs" />
                    </span>
                  )}
                  {e.mid && (
                    <span className="inline-flex items-center gap-1">
                      · MID: <span>{howText(entry.mid)}</span>
                      <InputMethodBadge method={entry.mid} titlePrefix="MID" size="xs" />
                    </span>
                  )}
                  {e.newBattery && (
                    <span className="inline-flex items-center gap-1">
                      · Battery: <span>{howText(entry.oldBattery)}</span> → <span>{howText(entry.newBattery)}</span>
                    </span>
                  )}
                </span>
              </Line>
              <Line k="MID · TID" mono>
                <span className="inline-flex items-center gap-1.5 flex-wrap">
                  {e.mid && (
                    <span className="inline-flex items-center gap-1">
                      {e.mid}
                      <InputMethodBadge method={entry.mid} titlePrefix="MID" size="xs" />
                    </span>
                  )}
                  {e.mid && e.tid && <span className="text-slate-400">·</span>}
                  {e.tid && <span>{e.tid}</span>}
                </span>
              </Line>
              {e.oldSerial && (
                <Line k="Replaces" mono>
                  <span className="inline-flex items-center gap-1">
                    {e.oldSerial}
                    <CopySerialButton value={e.oldSerial} label="old serial" />
                    <InputMethodBadge method={entry.oldSerial} titlePrefix="Old Serial" size="xs" />
                  </span>
                </Line>
              )}
              {e.newBattery && (
                <Line k="Battery" mono>
                  <span className="inline-flex items-center gap-1.5 flex-wrap">
                    <span className="inline-flex items-center gap-1">
                      {e.oldBattery || '—'}
                      <InputMethodBadge method={entry.oldBattery} titlePrefix="Old Battery" size="xs" />
                    </span>
                    <span className="text-slate-400">→</span>
                    <span className="inline-flex items-center gap-1">
                      {e.newBattery}
                      <InputMethodBadge method={entry.newBattery} titlePrefix="New Battery" size="xs" />
                    </span>
                  </span>
                </Line>
              )}
              {Array.isArray(e.payload?.entry?.details) && e.payload.entry.details.length > 0 && (
                <Line k="Details">
                  {e.payload.entry.details
                    .map((d: { k: string; v: string }) => `${d.k}: ${d.v}`)
                    .join(' · ')}
                </Line>
              )}
              {e.remarks && <Line k="Remark">{e.remarks}</Line>}
              <Line k="In inventory">{stageText(device)}</Line>
              {e.oldSerial && <Line k="Old unit">{stageText(oldDevice)}</Line>}
              {e.issues.length > 0 && (
                <ul className="mt-1.5 flex flex-col gap-1">
                  {e.issues.map((i, k) => (
                    <li
                      key={k}
                      className={`flex items-start gap-1.5 font-semibold ${
                        i.level === 'block' ? 'text-rose-700' : 'text-amber-800'
                      }`}
                    >
                      {i.level === 'block' ? (
                        <Ban className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-600" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600" />
                      )}
                      <span>{i.text}</span>
                    </li>
                  ))}
                </ul>
              )}
              {device && onOpenWorkflow && (
                <button
                  type="button"
                  onClick={() => onOpenWorkflow(device.serial)}
                  className="self-start text-xs font-normal text-slate-700 hover:underline cursor-pointer mt-1.5"
                >
                  Open this device in Stock Inventory →
                </button>
              )}
            </Section>

            <Section title={pending && isAdmin ? 'Admin Decision' : 'Review Result'}>
              {pending && isAdmin ? (
                <>
                  {needsBranch && (
                    <label className="flex flex-col gap-1 text-slate-600 font-normal">
                      Branch of this installation
                      <select
                        value={r.branchId}
                        onChange={(x) => onOpt(e.id, { branchId: x.target.value })}
                        className="px-2.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-normal text-slate-800"
                      >
                        <option value="">Choose a branch…</option>
                        {branches.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.id} · {b.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {needsReturn && (
                    <label className="flex flex-col gap-1 text-slate-600 font-normal">
                      {e.kind === 'REPLACE' ? 'The old unit goes to' : e.kind === 'POS_RETURN' ? 'The returned POS terminal goes to' : 'The returned sound box goes to'}
                      <select
                        value={r.returnStage}
                        onChange={(x) => onOpt(e.id, { returnStage: x.target.value })}
                        className="px-2.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-normal text-slate-800"
                      >
                        <option value="HQ_STOCK">Back to HQ stock</option>
                        <option value="BRANCH_RESERVE">Branch reserve</option>
                      </select>
                    </label>
                  )}
                  <label className="flex flex-col gap-1 text-slate-600 font-normal">
                    Reason (required to reject)
                    <input
                      value={r.note}
                      onChange={(x) => onOpt(e.id, { note: x.target.value })}
                      maxLength={500}
                      className="px-2.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-normal text-slate-800"
                    />
                  </label>
                  {(warns > 0 || /warning/i.test(err)) && !blocks && (
                    <label className="flex items-center gap-1.5 text-slate-700 font-normal cursor-pointer">
                      <input
                        type="checkbox"
                        checked={r.ack}
                        onChange={(x) => onOpt(e.id, { ack: x.target.checked })}
                      />{' '}
                      I checked the warnings
                    </label>
                  )}
                  {err && (
                    <div role="alert" className="text-rose-600 font-normal">
                      {err}
                    </div>
                  )}
                  <div className="flex items-center gap-2 pt-1.5">
                    <button
                      type="button"
                      onClick={() => onReject(e)}
                      disabled={busy}
                      className="btn-press inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold tracking-normal border transition-all cursor-pointer bg-rose-50 hover:bg-rose-100/90 text-rose-700 border-rose-200/90 hover:border-rose-300 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs"
                    >
                      <X className="w-3.5 h-3.5 text-rose-600 stroke-[2.4]" aria-hidden="true" />
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => onApprove(e)}
                      disabled={!canApprove}
                      title={
                        blocks
                          ? 'Cannot approve while blocking issues exist'
                          : needsBranch && !r.branchId
                          ? 'Choose the branch first'
                          : undefined
                      }
                      className={`btn-press inline-flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold tracking-normal border transition-all active:scale-[0.97] ${
                        canApprove
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600/30 shadow-xs hover:shadow-sm cursor-pointer'
                          : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                      }`}
                    >
                      {busy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Check className={`w-3.5 h-3.5 stroke-[2.4] ${canApprove ? 'text-white' : 'text-slate-300'}`} aria-hidden="true" />
                      )}
                      Approve
                    </button>
                  </div>
                </>
              ) : (
                <div className="font-normal text-slate-700">
                  {STATUS_LABEL[e.status]}
                  {e.reviewedByName ? ` by ${e.reviewedByName}` : ''}
                  {e.reviewedAt ? ` · ${fmtTime(e.reviewedAt)}` : ''}
                  {e.reviewNote ? ` · ${e.reviewNote}` : ''}
                </div>
              )}
            </Section>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

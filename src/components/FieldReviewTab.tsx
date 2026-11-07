import { ClearFiltersButton } from './ClearFiltersButton';
import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, startTransition } from 'react';
import { isFresh, markFresh } from '../utils/freshness';
import { useKeptMemo } from '../utils/useKeptMemo';
import { Search, RefreshCw, CheckCircle2, XCircle, Trash2, AlertTriangle, Ban, Loader2, ChevronDown, MapPin, ScanLine, Cpu, Volume2, ArrowDown, ArrowUp, ChevronsUpDown, Clock, Users, Check, X, PencilLine } from 'lucide-react';
import { BigKpiCard } from './BigKpiCard';
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
  fetchPendingFieldEvents,
  fetchReviewedFieldEvents,
  fetchAllFieldEvents,
  subscribeToFieldEvents,
  approveFieldEvent,
  rejectFieldEvent,
} from '../services/supabaseService';
import { deletePhoneRecords } from '../services/supabaseService';
import { DeleteRecordsDialog, SelectBox } from './DeleteRecordsDialog';
import { getCachedFieldEvents, setCachedFieldEvents } from '../services/fieldCache';
import { ExportCsvButton } from './ExportCsvButton';
import { downloadCsv, csvTime } from '../utils/exportCsv';
import { CopyableRecordId } from './CopyableRecordId';
import { PhoneRecordEditDialog, EditField } from './PhoneRecordEditDialog';

/**
 * Phone App Review.
 * Every POS / Sound Box record saved in the Merchant Visit phone app arrives here, one line per device. The stock does
 * not change until an admin approves it. The list is one clean line per record; tap a line to open its details and the
 * decision, which grow out of the line (morph). Waiting records load first and appear at once; reviewed records follow
 * in the background, and new records from the phone app appear live.
 */

const KIND_LABEL: Record<FieldEvent['kind'], string> = {
  INSTALL: 'Installation',
  REPLACE: 'Replacement',
  BATTERY: 'Battery replacement',
  SB_MAINT: 'Sound Box maintenance',
  SB_RETURN: 'Sound Box returned',
  POS_MAINT: 'POS active maintenance',
  POS_INACTIVE: 'POS in-active maintenance',
  POS_RETURN: 'POS returned & terminated',
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
type RecordTypeFilter = 'ALL' | FieldEvent['kind'];
const DOT = { 'POS Terminal': 'bg-[#006BA6]', 'Sound Box': 'bg-[#4F518C]' } as const;
/** POS Terminal unless the record says Sound Box (the same rule as the row label) */
const devType = (e: FieldEvent): 'POS Terminal' | 'Sound Box' => (e.deviceType === 'Sound Box' ? 'Sound Box' : 'POS Terminal');
const SPRING = { type: 'spring', stiffness: 500, damping: 32, mass: 0.55 } as const;
const GRID =
  'grid items-center gap-x-2.5 grid-cols-[34px_38px_98px_104px_140px_minmax(125px,1.2fr)_minmax(120px,1.1fr)_minmax(120px,1.15fr)_84px_156px]';
const CACHE_KEY = 'fe_review_cache_v5';

/** Explicit Phnom Penh Branch Codes (100 Head Office + 101..134 + 801 Central Market). */
const PHNOM_PENH_BRANCH_CODES = new Set([
  '100', '101', '102', '103', '104', '105', '106', '107', '108', '109',
  '110', '111', '112', '113', '114', '115', '116', '117', '118', '119',
  '120', '121', '122', '123', '124', '125', '126', '127', '128', '129',
  '130', '131', '132', '133', '134', '801',
]);

/** Explicit Provincial / Regional keywords that must NEVER pass when querying Phnom Penh Staff only. */
const REGIONAL_KEYWORD_REGEX =
  /province|provincial|regional|district|krong|sihanouk|kampong|kompong|takeo|takéo|kampot|kep|siem\s*reap|battambang|kandal|ta\s*khmau|poipet|banteay|svay\s*rieng|ba\s*vet|prey\s*veng|kratie|ratanakiri|mondulkiri|pursat|koh\s*kong|pailin|oddar|preah\s*vihear|stung\s*treng|tbong|suong|bati|angkor\s*chey|kiri\s*vong|chbar\s*mon|moung\s*russei|kamrieng|peam|memot|snoul|skun|prey\s*nob|sre\s*ambel|tram\s*kak|kiri\s*rom|odongk|basedth|chhuk|kampong\s*trach|banteay\s*meas/i;

/** Positive Phnom Penh branch name patterns when no numeric code is present. */
const PHNOM_PENH_NAME_REGEX =
  /phnom\s*penh|head\s*office|\bhq\b|borei\s*keyla|mao\s*tse\s*toung|stade\s*chas|tuek\s*thla|tek\s*thla|toul\s*kork|tuol\s*kork|central\s*branch|central\s*market|stung\s*mean\s*chey|stueng\s*mean\s*chey|independent\s*monument|independence\s*monument|chbar\s*ampov|chaom\s*chau|choam\s*chao|samdach\s*sothearos|sothearos|ou\s*baek\s*k|obek\s*kaom|saensokh|sen\s*sok|russey\s*keo|russei\s*keo|phsar\s*derm\s*thkov|ph?sar\s*d(a|e)?e?u?r?m\s*th?kov|special\s*shift|psar\s*ដើមថ្កូវ|santhor\s*mok|chamkar\s*doung|chraoy\s*changvar|chroy\s*changvar|samdach\s*monireth|monireth|mittapheap|boeng\s*trabaek|boeng\s*trabek|samraong\s*kraom|grand\s*phnom\s*penh|praek\s*pnov|prek\s*pnov|kamboul|kambol|chamkar\s*mon|nirouth|niroth|bkk|daun\s*penh|7\s*makara|prampir\s*makara|dangkao|mean\s*chey|por\s*senchey|pur\s*senchey|chbar\s*ampov/i;

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

interface Props {
  role: UserRole;
  branches: Branch[];
  devices: Device[];
  triggerToast: (msg: string) => void;
  onApplied: () => void;
  onOpenWorkflow?: (serial: string) => void;
  /** Settings: show Phnom Penh staff only, or Phnom Penh and regional staff */
  scope?: 'PHNOM_PENH' | 'ALL';
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
  return t === 'SCAN' || t === 'SCANNED' ? 'SCAN' : t === 'TYPED' || t === 'TYPE' || t === 'MANUAL' ? 'TYPED' : '';
};
const entryOf = (e: FieldEvent): { serial: How; mid: How; oldSerial: How } => {
  const u = (e.payload && (e.payload.unit || e.payload)) || {};
  return {
    serial: howOf(u.serial_input || u.serialInput || u.scan_type || u.scanType || e.payload?.serial_input),
    mid: howOf(u.mid_input || u.midInput || e.payload?.mid_input),
    oldSerial: howOf(u.old_serial_input || u.oldSerialInput || e.payload?.old_serial_input),
  };
};
const howText = (h: How) => (h === 'SCAN' ? 'Scanned' : h === 'TYPED' ? 'Typed by hand' : 'Not reported');

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
        className="inline-flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0 select-none cursor-help"
        aria-label={`${titlePrefix} scanned`}
      >
        <ScanLine className={iconCls} aria-hidden="true" />
        <span className="sr-only">Scanned</span>
      </span>
    );
  }
  return null;
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
    { key: 'serial', label: serialLabel, value: e.serial, locked: lock, section: sec },
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
  const [activeScope, setActiveScope] = useState<'ALL' | 'PHNOM_PENH'>(scope === 'ALL' ? 'ALL' : 'PHNOM_PENH');
  useEffect(() => {
    setActiveScope(scope === 'ALL' ? 'ALL' : 'PHNOM_PENH');
  }, [scope]);

  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const isSuper = role === 'SUPER_ADMIN';
  // (4 Nov 2026) Admins select waiting records to approve / reject; a Super Admin can also select rejected, withdrawn and
  // replaced records to delete them for good. Approved records are never selectable (they changed the stock).
  const selectable = useCallback((e: FieldEvent) => (isAdmin && e.status === 'PENDING') || (isSuper && e.status !== 'APPROVED'), [isAdmin, isSuper]);
  const [delOpen, setDelOpen] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  const [events, setEvents] = useState<FieldEvent[] | null>(() => {
    const mem = getCachedFieldEvents();                              // fetched in the background after sign-in: no parsing, no waiting
    if (mem) return mem;
    try {
      const c = sessionStorage.getItem(CACHE_KEY);
      return c ? (JSON.parse(c) as FieldEvent[]) : null;
    } catch {
      return null;
    }
  });
  const [reviewedReady, setReviewedReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [live, setLive] = useState(false);
  const [filter, setFilter] = useState<Filter>('PENDING');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(deviceType || 'ALL');
  const [recordTypeFilter, setRecordTypeFilter] = useState<RecordTypeFilter>('ALL');
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
  const [regions, setRegions] = useState<Record<string, string>>({});
  // the sub-menu decides the device type; the list already loaded is kept (no reload when switching)
  useEffect(() => {
    setTypeFilter(deviceType || 'ALL');
    setSelected(new Set());
    setOpen(null);
    setRecordTypeFilter('ALL');
  }, [deviceType]);

  useEffect(() => {
    fetchBranchRegions().then((g) => startTransition(() => setRegions(g)));
  }, []);

  useEffect(() => { if (events) setCachedFieldEvents(events); }, [events]);   // the next opening starts from the latest list

  // Cache records so tab switches and page refreshes paint instantly (0ms)
  useEffect(() => {
    if (!events || events.length === 0) return;
    const t = window.setTimeout(() => {
      try {
        sessionStorage.setItem(
          CACHE_KEY,
          JSON.stringify(events.slice(0, 1000))
        );
      } catch {
        /* storage full or blocked: fine */
      }
    }, 1200);
    return () => window.clearTimeout(t);
  }, [events]);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      // (29 Oct 2026, speed review) both lists are requested at the same time, but the Waiting list (what is opened first)
      // is shown as soon as IT arrives; before, the screen waited for the slower of the two.
      const pendingReq = fetchPendingFieldEvents(1000, 0);
      const reviewedReq = fetchReviewedFieldEvents(1000, 0);
      const pending = await pendingReq;
      if (pending) {
        startTransition(() => {
          setEvents((prev) => [...pending, ...(prev || []).filter((e) => e.status !== 'PENDING')]);
        });
      }
      const reviewed = await reviewedReq;
      if (!pending && !reviewed) {
        setLoadError('The records could not be loaded. Please check the connection and tap Refresh.');
        return;
      }
      startTransition(() => {
        setEvents((prev) => {
          const keepPending = pending ?? (prev || []).filter((e) => e.status === 'PENDING');
          const keepReviewed = reviewed ?? (prev || []).filter((e) => e.status !== 'PENDING');
          return [...keepPending, ...keepReviewed];
        });
        setReviewedReady(true);
      });
      markFresh('field');
    } catch {
      setLoadError('The records could not be loaded. Please check the connection and tap Refresh.');
    }
  }, []);

  useEffect(() => {
    // (5 Nov 2026, speed) the records fetched in the last minute (sign-in warm-up, the other review page) are used as
    // they are: the live feed below keeps them current, Refresh fetches again
    if (!(getCachedFieldEvents() && isFresh('field', 60000))) load();
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
    return () => {
      unsub();
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
  const { ppBranchCodes, ppStaffEmpIds } = useMemo(() => {
    const codes = new Set<string>(PHNOM_PENH_BRANCH_CODES);
    const empIds = new Set<string>();
    branches.forEach((b) => {
      const code = String(b.code || b.id || '').trim();
      if (code && !/^[2-7]\d{2}$/.test(code) && !REGIONAL_KEYWORD_REGEX.test(b.name || '')) {
        codes.add(code);
      }
      (b.staffDetails || []).forEach((u) => {
        if (u.empId && (!u.location || /phnom\s*penh/i.test(u.location))) {
          empIds.add(String(u.empId).trim());
        }
      });
    });
    return { ppBranchCodes: codes, ppStaffEmpIds: empIds };
  }, [branches]);

  /**
   * Policy #8: Strict, zero-mistake Phnom Penh Staff filter.
   * Excludes any regional branch code (200–799 such as 404, 421, 423, 425, 443) or provincial/district/krong branch text,
   * even when `e.branchId` is null on the field event record.
   */
  const inScope = useCallback(
    (e: FieldEvent) => {
      if (activeScope !== 'PHNOM_PENH') return true;

      const rawId = String(e.branchId || '').trim();
      const rawText = String(e.branchText || '').trim();
      const combinedBranch = `${rawId} ${rawText}`.trim();

      // 1. Any explicit regional/provincial/district/krong keyword in branchText is immediately excluded
      if (REGIONAL_KEYWORD_REGEX.test(combinedBranch)) {
        return false;
      }

      // 2. Check any 3-digit branch code in branchId or at the start of branchText (e.g. "404-Kampong Speu Branch")
      const codeMatch = rawId.match(/^(\d{3})$/) || rawText.match(/^\s*(\d{3})\b/);
      if (codeMatch) {
        const code = codeMatch[1];
        // Branch codes 200-799 are Regional branches -> exclude immediately
        if (/^[2-7]\d{2}$/.test(code)) return false;
        // Must belong to our Phnom Penh branch set (100..134, 801)
        if (!ppBranchCodes.has(code)) return false;
        const r = regions[code];
        if (r !== undefined && r !== '' && !/phnom\s*penh|head\s*office/i.test(r)) {
          return false;
        }
        return true;
      }

      // 3. If branchText is provided without a 3-digit code, verify it matches a Phnom Penh branch name
      // (31 Oct 2026) … or that the staff member is a Phnom Penh staff member. Before, "Special Shift" (59 records) and
      // "Phsar Daeum Thkov Branch" (17) were hidden from the Phnom Penh list although they were in the system.
      if (rawText) {
        return PHNOM_PENH_NAME_REGEX.test(rawText) || (!!e.staffId && ppStaffEmpIds.has(String(e.staffId).trim()));
      }

      // 4. If neither branchId nor branchText is present, check if the staffId belongs to Phnom Penh staff
      if (e.staffId && ppStaffEmpIds.size > 0) {
        return ppStaffEmpIds.has(String(e.staffId).trim());
      }

      return true;
    },
    [activeScope, ppBranchCodes, ppStaffEmpIds, regions]
  );

  const scoped = useMemo(() => (events || []).filter(inScope), [events, inScope]);

  const counts = useMemo(() => {
    const c = { PENDING: 0, APPROVED: 0, REJECTED: 0, ALL: 0 };
    scoped.forEach((e) => {
      if (deviceType && devType(e) !== deviceType) return;
      c.ALL++;
      if (e.status === 'PENDING' || e.status === 'APPROVED' || e.status === 'REJECTED') c[e.status]++;
    });
    return c;
  }, [scoped, deviceType]);

  // (5 Nov 2026) the figures of the page header (same layout as KHQR): this device type, in the active scope
  const hero = useMemo(() => {
    const kinds = new Map<string, number>(); const staff = new Set<string>(); let warn = 0; let block = 0;
    scoped.forEach((e) => {
      if (deviceType && devType(e) !== deviceType) return;
      if (e.status !== 'APPROVED' && e.status !== 'PENDING' && e.status !== 'REJECTED') return;
      kinds.set(e.kind, (kinds.get(e.kind) || 0) + 1);
      if (e.staffId || e.staffName) staff.add(String(e.staffId || e.staffName));
      if (e.status === 'PENDING') { if (hasBlock(e)) block++; else if (hasWarn(e)) warn++; }
    });
    const top = Array.from(kinds.entries()).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, n]) => `${n.toLocaleString()} ${(KIND_LABEL[k as FieldEvent['kind']] || k).toLowerCase()}`);
    return { staff: staff.size, warn, block, top };
  }, [scoped, deviceType]);

  // Keep the sub-menu badges synchronized with the active scope's exact waiting count of each device type
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
    if (events && onPendingCountChange) {
      onPendingCountChange(pendingByType);
    }
  }, [events, pendingByType, onPendingCountChange]);

  const availableKinds = useMemo(() => {
    const defaultKinds: FieldEvent['kind'][] =
      deviceType === 'POS Terminal'
        ? ['INSTALL', 'REPLACE', 'BATTERY', 'POS_MAINT', 'POS_INACTIVE', 'POS_RETURN']
        : deviceType === 'Sound Box'
        ? ['INSTALL', 'REPLACE', 'SB_MAINT', 'SB_RETURN']
        : ['INSTALL', 'REPLACE', 'BATTERY', 'SB_MAINT', 'SB_RETURN', 'POS_MAINT', 'POS_INACTIVE', 'POS_RETURN'];
    const dynamicKinds = new Set<FieldEvent['kind']>(defaultKinds);
    (scoped || []).forEach((e) => {
      if (deviceType && devType(e) !== deviceType) return;
      if (e.kind) dynamicKinds.add(e.kind);
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
    };
    scoped
      .filter((e) => filter === 'ALL' || e.status === filter)
      .filter((e) => typeFilter === 'ALL' || devType(e) === typeFilter)
      .forEach((e) => {
        c.ALL++;
        if (c[e.kind] !== undefined) c[e.kind]++;
        else c[e.kind] = 1;
      });
    return c;
  }, [scoped, filter, typeFilter]);

  const typeCounts = useMemo(() => {
    const c = { pos: 0, sb: 0 };
    scoped
      .filter((e) => filter === 'ALL' || e.status === filter)
      .filter((e) => recordTypeFilter === 'ALL' || e.kind === recordTypeFilter)
      .forEach((e) => {
        if (e.deviceType === 'Sound Box') c.sb++;
        else c.pos++;
      });
    return c;
  }, [scoped, filter, recordTypeFilter]);


  const shownBase = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return scoped
      .filter((e) => filter === 'ALL' || e.status === filter)
      .filter((e) => recordTypeFilter === 'ALL' || e.kind === recordTypeFilter)
      .filter((e) => typeFilter === 'ALL' || devType(e) === typeFilter)
      .filter(
        (e) =>
          !q ||
          [
            e.serial,
            e.oldSerial,
            e.sourceRecordId,
            e.mid,
            e.tid,
            e.outletName,
            e.terminalName,
            e.staffName,
            e.staffId,
            e.branchText,
          ].some((v) => String(v || '').toLowerCase().includes(q))
      )
      .sort(
        (a, b) =>
          b.receivedAt.localeCompare(a.receivedAt) ||
          b.sourceRecordId.localeCompare(a.sourceRecordId) ||
          a.unitNo - b.unitNo
      );
  }, [scoped, filter, typeFilter, recordTypeFilter, deferredQuery]);

  const { sorted: shown, sort, toggle: toggleSort } = useSort(shownBase, {
    type: (e) => e.deviceType,
    kind: (e) => KIND_LABEL[e.kind],
    serial: (e) => e.serial,
    merchant: (e) => e.terminalName || e.outletName,
    branch: (e) => e.branchText,
    staff: (e) => e.staffName,
    status: (e) => STATUS_LABEL[e.status],
    date: (e) => e.receivedAt,
  });

  const pg = usePager(shown.length, [filter, typeFilter, recordTypeFilter, deferredQuery, activeScope, sort]);

  // (31 Oct 2026) Export CSV: every record on the server that matches the filters (the screen keeps the latest 1,000)
  const exportCsv = useCallback(async () => {
    const all = await fetchAllFieldEvents(filter === 'ALL' ? 'ALL' : filter);
    const q = query.trim().toLowerCase();
    const list = all
      .filter(inScope)
      .filter((e) => recordTypeFilter === 'ALL' || e.kind === recordTypeFilter)
      .filter((e) => typeFilter === 'ALL' || devType(e) === typeFilter)
      .filter((e) => !q || [e.serial, e.oldSerial, e.sourceRecordId, e.mid, e.tid, e.outletName, e.terminalName, e.staffName, e.staffId, e.branchText]
        .some((v) => String(v || '').toLowerCase().includes(q)));
    if (!list.length) return 0;
    downloadCsv(`Phone_App_Review_${typeFilter === 'Sound Box' ? 'Sound_Box' : typeFilter === 'POS Terminal' ? 'POS_Terminal' : 'All'}`,
      ['Record ID', 'Device No', 'Revision', 'Date Sent', 'Recorded At', 'Device Type', 'Record Type', 'Serial', 'Old Serial', 'Old Battery', 'New Battery',
        'MID', 'TID', 'Terminal Name', 'Outlet Name', 'Staff ID', 'Staff Name', 'Branch', 'Branch Code', 'Latitude', 'Longitude', 'Warnings',
        'Status', 'Reviewed By', 'Reviewed At', 'Review Note', 'Remarks'],
      list.map((e) => [e.sourceRecordId, e.unitNo, e.revision, csvTime(e.receivedAt), csvTime(e.recordedAt), devType(e), KIND_LABEL[e.kind] || e.kind,
        e.serial, e.oldSerial, e.oldBattery, e.newBattery, e.mid, e.tid, e.terminalName, e.outletName, e.staffId, e.staffName, e.branchText, e.branchId,
        e.latitude, e.longitude, (e.issues || []).map((i) => i.text).join(' | '), STATUS_LABEL[e.status] || e.status, e.reviewedByName,
        csvTime(e.reviewedAt), e.reviewNote, e.remarks]));
    return list.length;
  }, [filter, query, inScope, recordTypeFilter, typeFilter]);

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
        triggerToast(`Approved · ${e.serial} · stock updated`);
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
      else triggerToast(`Rejected · ${e.serial}`);
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
      if (err) problems.push(`${e.serial}: ${err}`);
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
        className={`relative px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer select-none outline-none ${
          active ? 'text-white font-semibold' : 'text-slate-600 hover:text-slate-900'
        }`}
      >
        {active && (
          <motion.div
            layoutId="fr-type-pill"
            aria-hidden
            className="absolute inset-0 rounded-lg tab-active-blue border border-white/10 shadow-xs"
            transition={SPRING}
          />
        )}
        <span className="relative z-10 flex items-center gap-1.5">
          {t !== 'ALL' && (
            <span
              className={`w-2 h-2 rounded-full ${active ? (t === 'POS Terminal' ? 'bg-sky-300' : 'bg-purple-300') : (DOT[t] || 'bg-slate-400')}`}
              aria-hidden
            />
          )}
          <span>{label}</span>{' '}
          <span
            className={`font-mono text-[10px] px-1.5 py-0.5 rounded-md transition-colors ${
              active
                ? 'bg-white/20 text-white font-bold'
                : 'bg-slate-200/60 text-slate-500'
            }`}
          >
            ({n})
          </span>
        </span>
      </button>
    );
  };

  const loadingFirst = !events && !loadError;
  const visibleRows = shown.slice(pg.start, pg.end);
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
                : <Cpu className="w-7 h-7 sm:w-8 sm:h-8 shrink-0 text-[#006BA6]" aria-hidden />}
              <span>{deviceType || 'Review'}</span>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-normal px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/90 tracking-normal"
                title="New records from the phone app appear here as they are saved">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden />
                {live ? 'Live' : 'Connected'}
              </span>
            </h1>
            <p className="text-sm sm:text-base leading-relaxed text-slate-600">
              {deviceType === 'Sound Box'
                ? 'Sound Box records from the Merchant Visit app: installations, replacements, maintenance and returns. Approve to update the stock, or reject with a reason.'
                : 'POS Terminal records from the Merchant Visit app: installations, replacements, battery changes, maintenance and returns. Approve to update the stock, or reject with a reason.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <ExportCsvButton onExport={exportCsv} toast={triggerToast} title="Save the records that match the filters as a CSV file" />
            <button
              type="button"
              onClick={load}
              aria-label="Refresh"
              title="Refresh Phone App Review records"
              className="group relative inline-flex items-center gap-2 px-3.5 py-2 rounded-xl active:scale-[0.98] transition-all font-semibold text-xs sm:text-sm border shadow-2xs cursor-pointer bg-white hover:bg-slate-50 text-slate-700 border-slate-200/90"
            >
              <RefreshCw className="w-3.5 h-3.5 text-slate-600 group-hover:rotate-180 transition-transform duration-300" />
              <span>Sync Stream</span>
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-3.5 mt-6 pt-6 border-t border-slate-200/90">
          <BigKpiCard label="Waiting review" value={events ? counts.PENDING : undefined} icon={Clock}
            sub={hero.block ? `${hero.block.toLocaleString()} blocked · ${hero.warn.toLocaleString()} with warnings` : hero.warn ? `${hero.warn.toLocaleString()} with warnings to check` : 'Approve or reject each record'}
            accentColor="amber" onClick={() => setFilter('PENDING')} actionLabel="Show" />
          <BigKpiCard label="Approved" value={events ? counts.APPROVED : undefined} icon={CheckCircle2} sub="Stock updated from the record" accentColor="emerald" onClick={() => setFilter('APPROVED')} actionLabel="Show" />
          <BigKpiCard label="Rejected" value={events ? counts.REJECTED : undefined} icon={XCircle} sub="Sent back with a reason" accentColor="rose" onClick={() => setFilter('REJECTED')} actionLabel="Show" />
          <BigKpiCard label="All records" value={events ? counts.ALL : undefined} icon={deviceType === 'Sound Box' ? Volume2 : Cpu}
            sub={hero.top.length ? hero.top.join(' · ') : 'Every record received'} accentColor="blue" onClick={() => setFilter('ALL')} actionLabel="Show" />
          <BigKpiCard label="With warnings" value={events ? hero.warn + hero.block : undefined} icon={AlertTriangle}
            sub="Waiting records the system flagged" accentColor="orange" badge={hero.block ? `${hero.block} blocked` : undefined} />
          <BigKpiCard label="Staff" value={events ? hero.staff : undefined} icon={Users} sub="Sent at least one record" accentColor="violet" />
        </div>
      </section>

      {/* Section 1 — Clean Filter Header */}
      <section
        className="bg-white rounded-2xl border border-slate-200 px-4 py-3 shadow-2xs transition-all"
        aria-label="Filters"
      >
        <div className="flex flex-wrap items-center gap-2">
          {/* Segmented status tabs */}
          <div className="relative inline-flex items-center p-1 rounded-xl bg-slate-100/90 border border-slate-200/90 gap-1 max-w-full overflow-x-auto no-scrollbar [&>*]:shrink-0">
            {(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as Filter[]).map((f) => {
              const isActive = filter === f;
              const label =
                f === 'PENDING' ? 'Waiting' : f === 'ALL' ? 'All' : f === 'APPROVED' ? 'Approved' : 'Rejected';
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  aria-pressed={isActive}
                  className={`relative px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer select-none outline-none ${
                    isActive ? 'text-white font-semibold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="fr-status-pill"
                      aria-hidden
                      className="absolute inset-0 rounded-lg tab-active-blue border border-white/10 shadow-xs"
                      transition={SPRING}
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-1.5">
                    <span>{label}</span>{' '}
                    <span
                      className={`font-mono text-[10px] px-1.5 py-0.5 rounded-md transition-colors ${
                        isActive
                          ? 'bg-white/20 text-white font-bold'
                          : 'bg-slate-200/60 text-slate-500'
                      }`}
                    >
                      ({counts[f]})
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <span className="hidden sm:block w-px h-5 bg-slate-200 mx-1" aria-hidden />

          {/* Segmented device type tabs (not shown when a sub-menu has chosen the device type) */}
          {!deviceType && (
            <div className="relative inline-flex items-center p-1 rounded-xl bg-slate-100/90 border border-slate-200/90 gap-1 max-w-full overflow-x-auto no-scrollbar [&>*]:shrink-0">
              {typePill('ALL', 'All devices', typeCounts.pos + typeCounts.sb)}
              {typePill('POS Terminal', 'POS Terminal', typeCounts.pos)}
              {typePill('Sound Box', 'Sound Box', typeCounts.sb)}
            </div>
          )}


          {/* Scope Toggle: Phnom Penh Staff Only vs All Branches */}
          <button
            type="button"
            onClick={() => setActiveScope((prev) => (prev === 'ALL' ? 'PHNOM_PENH' : 'ALL'))}
            className={`btn-press px-3 py-1.5 rounded-xl text-xs font-normal border inline-flex items-center gap-1.5 transition-all cursor-pointer ${
              activeScope === 'PHNOM_PENH'
                ? 'bg-slate-100 text-slate-800 border-slate-300'
                : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-200'
            }`}
            title="Click to switch between Phnom Penh staff only (33 Branches) and All Branches (Phnom Penh + Regional)"
          >
            <MapPin className="w-3.5 h-3.5 text-slate-500" />
            <span>
              {activeScope === 'PHNOM_PENH' ? 'Phnom Penh Staff Only' : 'All Branches'}
            </span>
          </button>

          {/* Record Type Select Filter */}
          <div className="relative inline-flex items-center">
            <select
              value={recordTypeFilter}
              onChange={(e) => setRecordTypeFilter(e.target.value as RecordTypeFilter)}
              aria-label="Filter by record type"
              className="btn-press px-3 py-1.5 rounded-xl text-xs font-normal border bg-white hover:bg-slate-50 text-slate-700 border-slate-200 outline-none focus:border-slate-400 transition-all cursor-pointer"
            >
              <option value="ALL">All Record Types ({kindCounts.ALL || 0})</option>
              {availableKinds.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k] || k} ({kindCounts[k] || 0})
                </option>
              ))}
            </select>
          </div>

          <div className="relative ml-auto w-full sm:w-60">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Serial, MID, Staff, Branch…"
              aria-label="Search records"
              className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs font-normal text-slate-800 placeholder:text-slate-400 outline-none focus:border-slate-400 transition-all"
            />
          </div>
          <ClearFiltersButton
            className="!py-1.5"
            active={!!query || typeFilter !== (deviceType || 'ALL') || filter !== 'PENDING' || recordTypeFilter !== 'ALL'}
            onClear={() => {
              setQuery('');
              setTypeFilter(deviceType || 'ALL');
              setFilter('PENDING');
              setRecordTypeFilter('ALL');
            }}
          />
        </div>
      </section>

      {/* Section 2 — Bulk Decision Bar */}
      <AnimatePresence initial={false}>
        {isAdmin && selectedAll.length > 0 && (
          <motion.section
            key="bulk"
            initial={{ opacity: 0, y: -10, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.99 }}
            transition={SPRING}
            className="sticky top-2 z-10 bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200 shadow-sm px-4 py-3 flex flex-wrap items-center gap-3"
            aria-label="Decide the selected records"
          >
            <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 text-xs font-normal font-mono">
              {selectedAll.length} Selected
            </span>
            {selectedShown.length > 0 && (<>
            <input
              value={bulkNote}
              onChange={(e) => setBulkNote(e.target.value)}
              maxLength={500}
              placeholder="Reason (required to reject selected records)"
              aria-label="Reason for the selected records"
              className="flex-1 min-w-[180px] px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-normal text-slate-800 outline-none focus:border-slate-400"
            />
            {selectedShown.some(hasWarn) && (
              <label className="flex items-center gap-1.5 text-xs font-normal text-slate-700 cursor-pointer">
                <input type="checkbox" checked={bulkAck} onChange={(e) => setBulkAck(e.target.checked)} /> I checked
                the warnings
              </label>
            )}
            <button
              type="button"
              onClick={() => runBulk('reject')}
              disabled={!!bulkBusy}
              className="btn-press px-3.5 py-1.5 rounded-xl text-xs font-semibold border border-rose-200/90 text-rose-700 bg-rose-50 hover:bg-rose-100 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer shadow-2xs transition-all active:scale-[0.97]"
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
              className="btn-press px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs hover:shadow border border-emerald-600/30 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer transition-all active:scale-[0.97]"
            >
              {bulkBusy === 'approve' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5 text-white" aria-hidden="true" />
              )}{' '}
              Approve {selectedShown.length}
            </button>
            </>)}
            {isSuper && (
              <button
                type="button"
                onClick={() => setDelOpen(true)}
                disabled={!!bulkBusy || delBusy}
                className="btn-press px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-60 flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete {selectedAll.length}
              </button>
            )}
            {bulkReport.length > 0 && (
              <ul role="status" className="basis-full text-[11px] space-y-0.5 pt-1 border-t border-slate-100">
                {bulkReport.slice(0, 8).map((l, i) => (
                  <li key={i} className={i === 0 ? 'font-bold text-slate-800' : 'text-rose-700 font-medium'}>
                    {l}
                  </li>
                ))}
                {bulkReport.length > 8 && <li className="text-rose-700 font-bold">…and {bulkReport.length - 8} more.</li>}
              </ul>
            )}
          </motion.section>
        )}
      </AnimatePresence>
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
        className="fr-table-frame bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-x-auto"
        aria-label="Records"
      >
        <div className="min-w-[1020px]">
          <div
            className={`${GRID} glass-table-thead navy-header-bar bg-[#003857] text-white border-b border-slate-300 text-[11px] font-medium uppercase tracking-wider px-3.5 py-2`}
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
            <SortBtn k="date" sort={sort} onSort={toggleSort}>
              Date Sent
            </SortBtn>
            <SortBtn k="serial" sort={sort} onSort={toggleSort} className="pl-3">
              Serial Number
            </SortBtn>
            <SortBtn k="merchant" sort={sort} onSort={toggleSort}>
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
            <div className="p-10 text-center text-sm font-semibold text-slate-500">
              {filter !== 'PENDING' && !reviewedReady
                ? 'Loading earlier records…'
                : filter === 'PENDING'
                ? 'Nothing is waiting for review in this view.'
                : 'No records match the current filters.'}
            </div>
          )}

          <div
            data-page-content
            key={`${filter}-${typeFilter}-${activeScope}`}
            className="divide-y divide-slate-200/90 page-glide-in"
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
          sub={`${editing.deviceType} · ${KIND_LABEL_EDIT[editing.kind] || editing.kind} · ${editing.status === 'APPROVED' ? 'Approved' : editing.status === 'PENDING' ? 'Pending' : editing.status.charAt(0) + editing.status.slice(1).toLowerCase()}`}
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
const KIND_LABEL_EDIT: Record<string, string> = { INSTALL: 'New Installation', REPLACE: 'Replacement', BATTERY: 'Battery Replacement', SB_MAINT: 'Maintenance',
  SB_RETURN: 'Return', POS_MAINT: 'Active Maintenance', POS_INACTIVE: 'In-Active Maintenance', POS_RETURN: 'Return & Terminate' };

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

  return (
    <div
      className={`transition-colors border-b border-slate-200/90 ${
        checked ? 'bg-sky-50/80' : isOpen ? 'bg-slate-50/95' : 'bg-white hover:bg-slate-50/75'
      }`}
    >
      {/* Clean Row */}
      <div className={`${GRID} px-3.5 py-2.5 text-xs font-normal text-slate-700`}>
        <span className="flex justify-center">
          {selectable && <SelectBox checked={checked} onChange={() => onCheck(e.id)} label={`Select ${e.serial}`} />}
        </span>
        <span className="text-center text-slate-500 font-mono font-normal tabular-nums">{no}</span>
        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap font-semibold ${type === 'Sound Box' ? 'text-[#4F518C]' : 'text-[#006BA6]'}`}>
          {type === 'Sound Box' ? (
            <Volume2 className="w-3.5 h-3.5 text-[#4F518C] shrink-0" aria-hidden />
          ) : (
            <Cpu className="w-3.5 h-3.5 text-[#006BA6] shrink-0" aria-hidden />
          )}
          <span>{type}</span>
        </span>
        <span className="truncate leading-snug font-normal text-slate-700" title={KIND_LABEL[e.kind]}>
          {KIND_LABEL[e.kind]}
          {units > 1 && (
            <span className="block text-[11px] font-normal text-slate-500">
              Device {e.unitNo} of {units}
            </span>
          )}
        </span>
        <span className="leading-tight min-w-0">
          <span className="tabular-nums font-normal text-slate-600 whitespace-nowrap block" title={fmtTime(e.receivedAt)}>
            {fmtTime(e.receivedAt)}
          </span>
          {e.sourceRecordId && <CopyableRecordId id={e.sourceRecordId} />}
        </span>
        <div className="flex flex-col min-w-0 pl-3 pr-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => onToggle(e.id)}
              aria-expanded={isOpen}
              className="text-left font-mono truncate cursor-pointer hover:underline inline-flex items-center gap-1.5 group shrink-0"
              title={
                entry.serial === 'SCAN'
                  ? `Serial ${e.serial} (Scanned via barcode scanner)`
                  : `Serial ${e.serial} (Typed manually)`
              }
            >
              <ChevronDown
                className={`w-3.5 h-3.5 shrink-0 text-slate-400 transition-transform duration-300 ${
                  isOpen ? 'rotate-180 text-slate-700' : ''
                }`}
                aria-hidden
              />
              <span
                className={`font-normal tabular-nums tracking-tight ${
                  entry.serial === 'SCAN'
                    ? 'text-emerald-600 dark:text-emerald-400 group-hover:text-emerald-700 dark:group-hover:text-emerald-300'
                    : 'text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-slate-100'
                }`}
              >
                {e.serial}
              </span>
            </button>
            <InputMethodBadge method={entry.serial} titlePrefix="Serial" />
          </div>

          {e.oldSerial && (
            <div className="pl-5 mt-0.5 flex items-center gap-1.5">
              <span
                className={`text-[10px] font-mono inline-flex items-center gap-1 truncate ${
                  entry.oldSerial === 'SCAN'
                    ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
                title={`Replaces old unit ${e.oldSerial} (${entry.oldSerial === 'SCAN' ? 'Scanned' : 'Typed manually'})`}
              >
                <span className="text-slate-400 font-bold">←</span>
                <span className="truncate">{e.oldSerial}</span>
                {entry.oldSerial && (
                  <InputMethodBadge method={entry.oldSerial} titlePrefix="Old Serial" size="xs" />
                )}
              </span>
            </div>
          )}
        </div>
        <span className="min-w-0 leading-snug" title={merchant}>
          <span className="block truncate khmer font-normal text-slate-800">
            {e.terminalName || e.outletName || '—'}
          </span>
          {e.mid && (
            <span
              className={`flex items-center gap-1.5 truncate font-mono text-[11px] ${
                entry.mid === 'SCAN'
                  ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                  : 'text-slate-500 dark:text-slate-400 font-normal'
              }`}
              title={
                entry.mid === 'SCAN'
                  ? `MID ${e.mid} (Scanned via barcode scanner)`
                  : `MID ${e.mid} (Typed manually)`
              }
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
        <span className="flex justify-end gap-1.5">
          {pending && isAdmin ? (
            <>
              <button
                type="button"
                onClick={() => onReject(e)}
                disabled={busy}
                className="btn-press inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold tracking-normal border transition-all cursor-pointer bg-rose-50 hover:bg-rose-100/90 text-rose-700 border-rose-200/90 hover:border-rose-300 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs"
              >
                <X className="w-3 h-3 text-rose-600 stroke-[2.4]" aria-hidden="true" />
                Reject
              </button>
              <button
                type="button"
                onClick={() => onApprove(e)}
                disabled={!canApprove}
                title={
                  blocks
                    ? 'Open the line to see what must be fixed'
                    : needsBranch && !r.branchId
                    ? 'Open the line and choose the branch'
                    : undefined
                }
                className={`btn-press inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold tracking-normal border transition-all active:scale-[0.97] ${
                  canApprove
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600/30 shadow-xs hover:shadow-sm cursor-pointer'
                    : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                }`}
              >
                {busy ? (
                  <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                ) : (
                  <Check className={`w-3 h-3 stroke-[2.4] ${canApprove ? 'text-white' : 'text-slate-300'}`} aria-hidden="true" />
                )}
                Approve
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => onToggle(e.id)}
              className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-normal text-slate-600 cursor-pointer"
            >
              {isOpen ? 'Hide' : 'Details'}
            </button>
          )}
        </span>
      </div>

      {/* Expandable Detail Drawer */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="detail"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8, transition: { duration: 0.14 } }}
            transition={SPRING}
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
              <Line k="Entered by">{`Serial: ${howText(entry.serial)} · MID: ${howText(entry.mid)}`}</Line>
              <Line k="MID · TID" mono>
                {[e.mid, e.tid].filter(Boolean).join(' · ')}
              </Line>
              {e.oldSerial && (
                <Line k="Replaces" mono>
                  {e.oldSerial}
                </Line>
              )}
              {e.newBattery && (
                <Line k="Battery" mono>
                  {`${e.oldBattery || '—'} → ${e.newBattery}`}
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

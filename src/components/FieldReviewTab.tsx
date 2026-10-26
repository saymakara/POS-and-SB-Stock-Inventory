import { ClearFiltersButton } from './ClearFiltersButton';
import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, startTransition } from 'react';
import { Search, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Ban, Loader2, CheckSquare, Square, ChevronDown, MapPin, ScanLine } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Branch, Device, UserRole } from '../types';
import { useSort, SortState } from '../utils/sort';
import { usePager } from '../utils/usePager';
import { Pager } from './Pager';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { STAGE_META } from '../data/initialData';
import {
  FieldEvent,
  FieldEventStatus,
  fetchBranchRegions,
  fetchPendingFieldEvents,
  fetchReviewedFieldEvents,
  subscribeToFieldEvents,
  approveFieldEvent,
  rejectFieldEvent,
} from '../services/supabaseService';

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
const DOT = { 'POS Terminal': 'bg-sky-500', 'Sound Box': 'bg-violet-500' } as const;
const SPRING = { type: 'spring', stiffness: 460, damping: 36, mass: 0.65 } as const;
const FRAME_SPRING = { type: 'spring', stiffness: 380, damping: 34, mass: 0.7 } as const;
const GRID =
  'grid items-center gap-x-3 grid-cols-[24px_30px_104px_112px_128px_minmax(150px,1.1fr)_minmax(130px,1.1fr)_minmax(130px,1.15fr)_96px_138px]';
const CACHE_KEY = 'fe_review_cache_v3';

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
  /phnom\s*penh|head\s*office|\bhq\b|borei\s*keyla|mao\s*tse\s*toung|stade\s*chas|tuek\s*thla|tek\s*thla|toul\s*kork|tuol\s*kork|central\s*branch|central\s*market|stung\s*mean\s*chey|stueng\s*mean\s*chey|independent\s*monument|independence\s*monument|chbar\s*ampov|chaom\s*chau|choam\s*chao|samdach\s*sothearos|sothearos|ou\s*baek\s*k|obek\s*kaom|saensokh|sen\s*sok|russey\s*keo|russei\s*keo|phsar\s*derm\s*thkov|psar\s*ដើមថ្កូវ|santhor\s*mok|chamkar\s*doung|chraoy\s*changvar|chroy\s*changvar|samdach\s*monireth|monireth|mittapheap|boeng\s*trabaek|boeng\s*trabek|samraong\s*kraom|grand\s*phnom\s*penh|praek\s*pnov|prek\s*pnov|kamboul|kambol|chamkar\s*mon|nirouth|niroth|bkk|daun\s*penh|7\s*makara|prampir\s*makara|dangkao|mean\s*chey|por\s*senchey|pur\s*senchey|chbar\s*ampov/i;

const fmtTime = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Phnom_Penh',
      });
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
  onPendingCountChange?: (count: number) => void;
}

interface RowOpt {
  branchId?: string;
  returnStage?: string;
  note?: string;
  ack?: boolean;
}

const needsReturnOf = (e: FieldEvent) => (e.kind === 'REPLACE' && !!e.oldSerial) || e.kind === 'SB_RETURN';
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
  showFallback?: boolean;
}> = ({ method, titlePrefix = 'Value', showFallback = false }) => {
  if (method === 'SCAN') {
    return (
      <span
        title={`${titlePrefix} was scanned using mobile barcode scanner`}
        className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-normal bg-emerald-50 text-emerald-700 border border-emerald-200/90 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/80 whitespace-nowrap shadow-2xs"
      >
        <ScanLine className="w-2.5 h-2.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        <span>Scan</span>
      </span>
    );
  }
  if (method === 'TYPED') {
    return (
      <span
        title={`${titlePrefix} was typed manually by hand on mobile keyboard`}
        className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-normal bg-slate-100 text-slate-700 border border-slate-200/90 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 whitespace-nowrap shadow-2xs"
      >
        <span>Typed</span>
      </span>
    );
  }
  if (showFallback) {
    return (
      <span
        title={`${titlePrefix} scan type not reported`}
        className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-normal bg-slate-50 text-slate-500 border border-slate-200/80 dark:bg-slate-800/60 dark:text-slate-400 dark:border-slate-700/80 whitespace-nowrap"
      >
        <span>Not reported</span>
      </span>
    );
  }
  return null;
};

export const FieldReviewTab: React.FC<Props> = ({
  role,
  branches,
  devices,
  triggerToast,
  onApplied,
  onOpenWorkflow,
  scope = 'PHNOM_PENH',
  onPendingCountChange,
}) => {
  const [activeScope, setActiveScope] = useState<'ALL' | 'PHNOM_PENH'>(scope === 'ALL' ? 'ALL' : 'PHNOM_PENH');
  useEffect(() => {
    setActiveScope(scope === 'ALL' ? 'ALL' : 'PHNOM_PENH');
  }, [scope]);

  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const [events, setEvents] = useState<FieldEvent[] | null>(() => {
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
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [recordTypeFilter, setRecordTypeFilter] = useState<RecordTypeFilter>('ALL');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  const [opts, setOpts] = useState<Record<number, RowOpt>>({});
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const [rowErr, setRowErr] = useState<Record<number, string>>({});
  const [bulkNote, setBulkNote] = useState('');
  const [bulkAck, setBulkAck] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<'' | 'approve' | 'reject'>('');
  const [bulkReport, setBulkReport] = useState<string[]>([]);
  const [regions, setRegions] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchBranchRegions().then((g) => startTransition(() => setRegions(g)));
  }, []);

  // keep a small copy of the waiting records so the next visit paints instantly
  useEffect(() => {
    if (!events) return;
    const t = window.setTimeout(() => {
      try {
        sessionStorage.setItem(
          CACHE_KEY,
          JSON.stringify(events.filter((e) => e.status === 'PENDING').slice(0, 300))
        );
      } catch {
        /* storage full or blocked: fine */
      }
    }, 800);
    return () => window.clearTimeout(t);
  }, [events]);

  const merge = useCallback((pending: FieldEvent[] | null, reviewed: FieldEvent[] | null) => {
    startTransition(() =>
      setEvents((prev) => {
        const keepPending = pending ?? (prev || []).filter((e) => e.status === 'PENDING');
        const keepReviewed = reviewed ?? (prev || []).filter((e) => e.status !== 'PENDING');
        return [...keepPending, ...keepReviewed];
      })
    );
  }, []);

  const load = useCallback(async () => {
    setLoadError('');
    const pending = await fetchPendingFieldEvents(100, 0);
    if (!pending) {
      setLoadError('The records could not be loaded. Please check the connection and tap Refresh.');
      return;
    }
    merge(pending, null);
    const reviewed = await fetchReviewedFieldEvents(100, 0);
    if (reviewed) {
      merge(null, reviewed);
      startTransition(() => setReviewedReady(true));
    }
  }, [merge]);

  useEffect(() => {
    load();
    const unsub = subscribeToFieldEvents((e) => {
      setLive(true);
      setEvents((prev) => {
        if (!prev) return [e];
        const i = prev.findIndex((x) => x.id === e.id);
        if (i < 0) return [e, ...prev];
        const next = prev.slice();
        next[i] = e;
        return next;
      });
    });
    return unsub;
  }, [load]);

  const deviceBySerial = useMemo(() => {
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
      if (rawText) {
        return PHNOM_PENH_NAME_REGEX.test(rawText);
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
      c.ALL++;
      if (e.status === 'PENDING' || e.status === 'APPROVED' || e.status === 'REJECTED') c[e.status]++;
    });
    return c;
  }, [scoped]);

  // Keep parent badge count synchronized with the active scope's exact waiting count
  useEffect(() => {
    if (events && onPendingCountChange) {
      onPendingCountChange(counts.PENDING);
    }
  }, [events, counts.PENDING, onPendingCountChange]);

  const availableKinds = useMemo(() => {
    const defaultKinds: FieldEvent['kind'][] = ['INSTALL', 'REPLACE', 'BATTERY', 'SB_MAINT', 'SB_RETURN'];
    const dynamicKinds = new Set<FieldEvent['kind']>(defaultKinds);
    (scoped || []).forEach((e) => {
      if (e.kind) dynamicKinds.add(e.kind);
    });
    return Array.from(dynamicKinds);
  }, [scoped]);

  const kindCounts = useMemo(() => {
    const c: Record<string, number> = {
      ALL: 0,
      INSTALL: 0,
      REPLACE: 0,
      BATTERY: 0,
      SB_MAINT: 0,
      SB_RETURN: 0,
    };
    scoped
      .filter((e) => filter === 'ALL' || e.status === filter)
      .filter((e) => typeFilter === 'ALL' || e.deviceType === typeFilter)
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
      .filter((e) => typeFilter === 'ALL' || e.deviceType === typeFilter)
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

  const shownPending = useMemo(() => shown.filter((e) => e.status === 'PENDING'), [shown]);
  const selectedShown = useMemo(() => shownPending.filter((e) => selected.has(e.id)), [shownPending, selected]);
  const allSelected = shownPending.length > 0 && selectedShown.length === shownPending.length;

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
          active ? 'text-[#003857]' : 'text-slate-600 hover:text-slate-900'
        }`}
      >
        {active && (
          <motion.div
            layoutId="fr-type-pill"
            aria-hidden
            className="absolute inset-0 rounded-lg bg-white border border-slate-200/90 shadow-xs"
            transition={SPRING}
          />
        )}
        <span className="relative z-10 flex items-center gap-1.5">
          {t !== 'ALL' && (
            <span
              className={`w-2 h-2 rounded-full ${DOT[t] || 'bg-slate-400'}`}
              aria-hidden
            />
          )}
          <span>{label}</span>
          <span
            className={`font-mono text-[10px] px-1.5 py-0.5 rounded-md transition-colors ${
              active
                ? t === 'POS Terminal'
                  ? 'bg-sky-50 text-sky-700 border border-sky-200/70'
                  : t === 'Sound Box'
                  ? 'bg-purple-50 text-purple-700 border border-purple-200/70'
                  : 'bg-slate-100 text-slate-700 border border-slate-200/70'
                : 'bg-slate-200/60 text-slate-500'
            }`}
          >
            {n}
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
      {/* Section 1 — Clean Filter Header */}
      <section
        className="bg-white rounded-2xl border border-slate-200 px-4 py-3 shadow-2xs transition-all"
        aria-label="Filters"
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-2 flex items-center gap-2">
            <h2 className="text-sm font-medium text-slate-900">Phone App Review</h2>
            <span
              className="inline-flex items-center gap-1.5 text-[11px] font-normal px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/90"
              title="New records from the phone app appear here as they are saved"
            >
              <span
                className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"
                aria-hidden
              />
              {live ? 'Live' : 'Connected'}
            </span>
          </div>

          {/* Segmented status tabs */}
          <div className="relative inline-flex items-center p-1 rounded-xl bg-slate-100/90 border border-slate-200/90 gap-1">
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
                    isActive ? 'text-[#003857]' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="fr-status-pill"
                      aria-hidden
                      className="absolute inset-0 rounded-lg bg-white border border-slate-200/90 shadow-xs"
                      transition={SPRING}
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-1.5">
                    <span>{label}</span>
                    <span
                      className={`font-mono text-[10px] px-1.5 py-0.5 rounded-md transition-colors ${
                        isActive
                          ? f === 'PENDING'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200/70'
                            : f === 'APPROVED'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/70'
                            : f === 'REJECTED'
                            ? 'bg-rose-50 text-rose-700 border border-rose-200/70'
                            : 'bg-slate-100 text-slate-700 border border-slate-200/70'
                          : 'bg-slate-200/60 text-slate-500'
                      }`}
                    >
                      {counts[f]}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <span className="hidden sm:block w-px h-5 bg-slate-200 mx-1" aria-hidden />

          {/* Segmented device type tabs */}
          <div className="relative inline-flex items-center p-1 rounded-xl bg-slate-100/90 border border-slate-200/90 gap-1">
            {typePill('ALL', 'All devices', typeCounts.pos + typeCounts.sb)}
            {typePill('POS Terminal', 'POS Terminal', typeCounts.pos)}
            {typePill('Sound Box', 'Sound Box', typeCounts.sb)}
          </div>


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
            active={!!query || typeFilter !== 'ALL' || filter !== 'PENDING' || recordTypeFilter !== 'ALL'}
            onClear={() => {
              setQuery('');
              setTypeFilter('ALL');
              setFilter('PENDING');
              setRecordTypeFilter('ALL');
            }}
          />
          <button
            type="button"
            onClick={load}
            aria-label="Refresh"
            title="Refresh Phone App Review records"
            className="btn-press p-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 cursor-pointer transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </section>

      {/* Section 2 — Bulk Decision Bar */}
      <AnimatePresence initial={false}>
        {isAdmin && selectedShown.length > 0 && (
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
              {selectedShown.length} Selected
            </span>
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
              className="btn-press px-3.5 py-1.5 rounded-xl text-xs font-normal border border-slate-300 text-slate-700 bg-slate-100 hover:bg-slate-200 dark:border-slate-700 dark:text-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-60 flex items-center gap-1.5 cursor-pointer"
            >
              {bulkBusy === 'reject' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <XCircle className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
              )}{' '}
              Reject {selectedShown.length}
            </button>
            <button
              type="button"
              onClick={() => runBulk('approve')}
              disabled={!!bulkBusy}
              className="btn-press px-3.5 py-1.5 rounded-xl text-xs font-normal bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60 flex items-center gap-1.5 cursor-pointer"
            >
              {bulkBusy === 'approve' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}{' '}
              Approve {selectedShown.length}
            </button>
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
        <div className="min-w-[1040px]">
          <div
            className={`${GRID} navy-header-bar text-white border-b border-slate-300 text-[11px] font-medium uppercase tracking-wider px-3.5 py-3`}
            role="row"
          >
            <span>
              {isAdmin && shownPending.length > 0 && (
                <button
                  type="button"
                  aria-label={allSelected ? 'Unselect all' : 'Select all waiting'}
                  aria-pressed={allSelected}
                  onClick={() => setSelected(allSelected ? new Set() : new Set(shownPending.map((e) => e.id)))}
                  className="cursor-pointer flex text-white"
                >
                  {allSelected ? (
                    <CheckSquare className="w-4 h-4 text-emerald-300" />
                  ) : (
                    <Square className="w-4 h-4 text-white/75 hover:text-white" />
                  )}
                </button>
              )}
            </span>
            <span className="text-right">No.</span>
            <SortBtn k="type" sort={sort} onSort={toggleSort}>
              Device Type
            </SortBtn>
            <SortBtn k="kind" sort={sort} onSort={toggleSort}>
              Record Type
            </SortBtn>
            <SortBtn k="date" sort={sort} onSort={toggleSort}>
              Date Sent
            </SortBtn>
            <SortBtn k="serial" sort={sort} onSort={toggleSort}>
              Serial Number
            </SortBtn>
            <SortBtn k="merchant" sort={sort} onSort={toggleSort}>
              Terminal / MID
            </SortBtn>
            <SortBtn k="branch" sort={sort} onSort={toggleSort}>
              Branch / Staff
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

          <motion.div
            key={`${filter}-${typeFilter}-${activeScope}-${pg.page}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={FRAME_SPRING}
            className="divide-y divide-slate-200/90"
          >
            <AnimatePresence initial={false}>
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
                />
              ))}
            </AnimatePresence>
          </motion.div>
          <Pager pg={pg} label="records" />
        </div>
      </section>
    </div>
  );
};

const SortBtn: React.FC<{
  k: string;
  sort: SortState | null;
  onSort: (k: string) => void;
  children: React.ReactNode;
  right?: boolean;
}> = ({ k, sort, onSort, children, right }) => {
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
      }`}
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
}

const ReviewRow = memo(function ReviewRow({
  e,
  units = 1,
  no,
  isAdmin,
  branches,
  o,
  checked,
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
    <motion.div
      initial={false}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, x: 24, transition: { duration: 0.16 } }}
      transition={SPRING}
      className={`transition-colors ${
        checked ? 'bg-sky-50/80' : isOpen ? 'bg-slate-50/95' : 'bg-white hover:bg-slate-50/75'
      }`}
    >
      {/* Clean Row */}
      <div className={`${GRID} px-3.5 py-2.5 text-xs font-normal text-slate-700`}>
        <span>
          {isAdmin && pending && (
            <button
              type="button"
              onClick={() => onCheck(e.id)}
              aria-pressed={checked}
              aria-label={`Select ${e.serial}`}
              className="cursor-pointer flex"
            >
              {checked ? (
                <CheckSquare className="w-4 h-4 text-slate-800" />
              ) : (
                <Square className="w-4 h-4 text-slate-400 hover:text-slate-600" />
              )}
            </button>
          )}
        </span>
        <span className="text-right text-slate-500 font-mono font-normal tabular-nums">{no}</span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-normal text-slate-700">
          <span
            className={`w-2 h-2 rounded-full ${type === 'Sound Box' ? 'bg-violet-600' : 'bg-sky-600'}`}
            aria-hidden
          />
          {type}
        </span>
        <span className="truncate leading-snug font-normal text-slate-700" title={KIND_LABEL[e.kind]}>
          {KIND_LABEL[e.kind]}
          {units > 1 && (
            <span className="block text-[10.5px] font-normal text-slate-500">
              Device {e.unitNo} of {units}
            </span>
          )}
        </span>
        <span className="tabular-nums font-normal text-slate-600 whitespace-nowrap" title={fmtTime(e.receivedAt)}>
          {fmtTime(e.receivedAt)}
        </span>
        <div className="flex flex-col min-w-0 pr-1">
          <button
            type="button"
            onClick={() => onToggle(e.id)}
            aria-expanded={isOpen}
            className="text-left font-mono text-slate-800 truncate cursor-pointer hover:underline inline-flex items-center gap-1.5 group"
            title="Open record details"
          >
            <ChevronDown
              className={`w-3.5 h-3.5 shrink-0 text-slate-400 transition-transform duration-300 ${
                isOpen ? 'rotate-180 text-slate-700' : ''
              }`}
              aria-hidden
            />
            <span className="truncate font-semibold text-slate-900 group-hover:text-[#003857]">{e.serial}</span>
          </button>

          <div className="pl-5 mt-0.5 flex items-center gap-1.5 flex-wrap">
            <InputMethodBadge method={entry.serial} titlePrefix="Serial" showFallback />

            {e.oldSerial && (
              <span
                className="text-[10px] text-slate-400 font-mono inline-flex items-center gap-1 truncate"
                title={`Replaces old unit ${e.oldSerial}${entry.oldSerial ? ` (${entry.oldSerial === 'SCAN' ? 'Scanned' : 'Typed'})` : ''}`}
              >
                <span>←</span>
                <span className="truncate">{e.oldSerial}</span>
                {entry.oldSerial && (
                  <InputMethodBadge method={entry.oldSerial} titlePrefix="Old Serial" />
                )}
              </span>
            )}
          </div>
        </div>
        <span className="min-w-0 leading-snug" title={merchant}>
          <span className="block truncate khmer font-normal text-slate-800">
            {e.terminalName || e.outletName || '—'}
          </span>
          {e.mid && (
            <span className="flex items-center gap-1.5 truncate font-mono text-[11px] font-normal text-slate-500" title={`MID ${e.mid}`}>
              <span className="truncate">{e.mid}</span>
              <InputMethodBadge method={entry.mid} titlePrefix="MID" />
            </span>
          )}
        </span>
        <span className="truncate leading-snug" title={`${e.branchText || ''} · ${e.staffName || ''}`}>
          <span className="block truncate font-normal text-slate-800">{e.branchText || '—'}</span>
          <span className="block text-[11px] font-normal text-slate-500 truncate">
            {e.staffName || '—'}
            {e.staffId ? ` (${e.staffId})` : ''}
          </span>
        </span>
        <span className="leading-snug">
          <span
            className={`inline-block px-2 py-0.5 rounded-md text-[10.5px] font-normal border ${
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
                className="btn-press px-2.5 py-1 rounded-lg text-xs font-normal border border-slate-300 text-slate-700 bg-slate-100 hover:bg-slate-200 dark:border-slate-700 dark:text-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-60 cursor-pointer"
              >
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
                className="btn-press px-2.5 py-1 rounded-lg text-xs font-normal bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-45 cursor-pointer inline-flex items-center gap-1"
              >
                {busy && <Loader2 className="w-3 h-3 animate-spin" />}Approve
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
            <Section title="Field Submission Details">
              <Line k="Record">
                {e.sourceRecordId}
                {e.unitNo > 1 ? ` · unit ${e.unitNo}` : ''} · {fmtTime(e.recordedAt)}
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
                      {e.kind === 'REPLACE' ? 'The old unit goes to' : 'The returned sound box goes to'}
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
    </motion.div>
  );
});

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useFlip } from '../utils/useFlip';
import { usePager } from '../utils/usePager';
import { Pager } from './Pager';
import { useSort, SortTh } from '../utils/sort';
import { createPortal } from 'react-dom';
import { Requisition, Device, ArrangedDeviceItem, UserRole, ThemeMode } from '../types';
import { csvFile } from '../utils/csv';
import { todayPP } from '../utils/time';
import { motion, AnimatePresence } from 'motion/react';
import {
  SendHorizontal,
  CheckCircle2,
  Truck,
  ScrollText,
  BatteryCharging,
  Cpu,
  Volume2,
  X,
  Wand2,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  Upload,
  Pencil,
  Ban,
  FileSpreadsheet,
} from 'lucide-react';

interface RequisitionsTabProps {
  role: UserRole;
  requisitions: Requisition[];
  hqDevices?: Device[];
  onOpenRequestModal: () => void;
  onApproveRequisition: (reqId: string, arrangedDevices?: ArrangedDeviceItem[]) => void;
  onApproveReturnRequisition?: (reqId: string, returnSerials?: string[], reason?: string) => void;
  onRejectRequisition?: (reqId: string, reason: string) => void;
  onReceiveRequisition: (reqId: string) => void;
  onEditRequisition?: (reqId: string, changes: { posQty: number; sbQty: number; reason: string }) => void;
  theme?: ThemeMode;
  onDirectToStockInventory?: (req: Requisition, currentStaged?: ArrangedDeviceItem[]) => void;
  externalArrangingReq?: Requisition | null;
  externalStagedItems?: ArrangedDeviceItem[] | null;
  onClearExternalArranging?: () => void;
}

const norm = (s: string | null | undefined) => String(s || '').trim().toUpperCase();
/** Oldest stock-in first (FIFO); units with no stock-in date go last; serial breaks ties so the order is stable. */
const fifo = (a: Device, b: Device) => {
  const da = a.stockInDate || '9999-99-99';
  const db = b.stockInDate || '9999-99-99';
  return da === db ? a.serial.localeCompare(b.serial) : da < db ? -1 : 1;
};

export const RequisitionsTab: React.FC<RequisitionsTabProps> = ({
  role,
  requisitions,
  hqDevices = [],
  onOpenRequestModal,
  onApproveRequisition,
  onApproveReturnRequisition,
  onRejectRequisition,
  onReceiveRequisition,
  onEditRequisition,
  theme = 'light',
  externalArrangingReq,
  externalStagedItems,
  onClearExternalArranging,
}) => {
  const flipRef = useRef<HTMLTableSectionElement>(null);
  const { sorted: sortedReqs, sort: reqSort, toggle: reqToggle } = useSort<Requisition>(requisitions, {
    request: (r) => r.reqId, branch: (r) => Number(r.branchId) || r.branchId, qty: (r) => (r.posQty || 0) + (r.sbQty || 0),
    serials: (r) => (r.arrangedDevices || []).length, status: (r) => r.status, date: (r) => r.date, reason: (r) => r.reason || '',
  });
  // (review) long request lists are drawn progressively: 60 rows at once, more while scrolling
  const pg = usePager(sortedReqs.length, [reqSort]);
  const shownReqs = useMemo(() => sortedReqs.slice(pg.start, pg.end), [sortedReqs, pg.start, pg.end]);
  useFlip(flipRef, [shownReqs]);
  const isLight = theme === 'light';
  // Dispatching / approving moves Head Office stock: HQ roles only (the server enforces this too).
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const [arrangingReq, setArrangingReq] = useState<Requisition | null>(null);
  const [stagedItems, setStagedItems] = useState<ArrangedDeviceItem[]>([]);
  const [arrangeStep, setArrangeStep] = useState<'ARRANGE' | 'PREVIEW'>('ARRANGE');
  const [dispatchErrors, setDispatchErrors] = useState<string[]>([]);
  const [shortfall, setShortfall] = useState('');
  const [rejectingReq, setRejectingReq] = useState<Requisition | null>(null);
  const [rejectText, setRejectText] = useState('');

  useEffect(() => {
    if (externalArrangingReq && externalStagedItems) {
      if (isAdmin) {
        setArrangingReq(externalArrangingReq);
        setStagedItems(externalStagedItems);
        setArrangeStep('ARRANGE');
        setDispatchErrors([]);
        setShortfall('');
      }
      if (onClearExternalArranging) {
        onClearExternalArranging();
      }
    }
  }, [externalArrangingReq, externalStagedItems, onClearExternalArranging, isAdmin]);

  const deviceBySerial = useMemo(() => {
    const m = new Map<string, Device>();
    hqDevices.forEach((d) => m.set(norm(d.serial), d));
    return m;
  }, [hqDevices]);

  /** Serials already arranged on another requisition that is dispatched but not yet received. */
  const allocatedElsewhere = useMemo(() => {
    const m = new Map<string, string>();
    requisitions.forEach((r) => {
      if (r.status !== 'DISPATCHED' || r.reqId === arrangingReq?.reqId) return;
      (r.arrangedDevices || []).forEach((a) => {
        if (a.serial) m.set(norm(a.serial), r.reqId);
      });
    });
    // The server keeps dispatched units in HQ stock with customFields.allocatedTo = reqId until receipt.
    hqDevices.forEach((d) => {
      const to = String(d.customFields?.allocatedTo || '').trim();
      if (to && to !== arrangingReq?.reqId) m.set(norm(d.serial), to);
    });
    return m;
  }, [requisitions, hqDevices, arrangingReq?.reqId]);

  const availableHq = useMemo(
    () =>
      hqDevices
        .filter((d) => d.stage === 'HQ_STOCK' && !d.archived && !allocatedElsewhere.has(norm(d.serial)))
        .sort(fifo),
    [hqDevices, allocatedElsewhere]
  );
  const availableHqPos = useMemo(() => availableHq.filter((d) => d.type === 'POS Terminal'), [availableHq]);
  const availableHqSb = useMemo(() => availableHq.filter((d) => d.type === 'Sound Box'), [availableHq]);

  /**
   * Auto-match: for each requested row take the oldest HQ_STOCK unit (FIFO) of the same type (and the same model when
   * the row names one) that is not archived, not on another dispatched requisition and not already used in this list.
   * Rows that cannot be filled stay blank and a shortfall message is shown. Battery serials come only from the
   * unit's own record; nothing is invented.
   */
  const buildAutoMatch = (req: Requisition, rows?: ArrangedDeviceItem[]) => {
    const template: ArrangedDeviceItem[] =
      rows && rows.length
        ? rows.map((r) => ({ ...r }))
        : [
            ...Array.from({ length: req.posQty }, () => ({ serial: '', batterySerial: '', type: 'POS Terminal' as const, model: '' })),
            ...Array.from({ length: req.sbQty }, () => ({ serial: '', batterySerial: '', type: 'Sound Box' as const, model: '' })),
          ];
    const used = new Set<string>();
    const out = template.map((row) => {
      const pool = row.type === 'POS Terminal' ? availableHqPos : availableHqSb;
      const wantModel = norm(row.model);
      const hit = pool.find((d) => !used.has(norm(d.serial)) && (!wantModel || norm(d.model) === wantModel));
      if (!hit) return { ...row, serial: '', batterySerial: '' };
      used.add(norm(hit.serial));
      return { ...row, serial: hit.serial, batterySerial: hit.batterySerial || '', model: hit.model };
    });
    const missingPos = out.filter((r) => r.type === 'POS Terminal' && !r.serial).length;
    const missingSb = out.filter((r) => r.type === 'Sound Box' && !r.serial).length;
    const parts: string[] = [];
    if (missingPos) parts.push(`${missingPos} POS Terminal`);
    if (missingSb) parts.push(`${missingSb} Sound Box`);
    return {
      items: out,
      shortfall: parts.length
        ? `Not enough available Head Office stock: ${parts.join(' and ')} unit(s) could not be matched. Stock in more units or dispatch fewer.`
        : '',
    };
  };

  const openArrangeModal = (req: Requisition) => {
    if (!isAdmin) return;
    const { items, shortfall: sf } = buildAutoMatch(req);
    setStagedItems(items);
    setShortfall(sf);
    setDispatchErrors([]);
    setArrangingReq(req);
    setArrangeStep('ARRANGE');
    setSerialText('');
    setSerialReport([]);
  };

  const rerunAutoMatch = () => {
    if (!arrangingReq) return;
    // Keep each row's type; serial, battery and model are re-picked from the current HQ stock.
    const { items, shortfall: sf } = buildAutoMatch(
      arrangingReq,
      stagedItems.map((r) => ({ ...r, serial: '', batterySerial: '', model: '' }))
    );
    setStagedItems(items);
    setShortfall(sf);
    setDispatchErrors([]);
  };

  const handleUpdateStagedItem = (
    idx: number,
    field: keyof ArrangedDeviceItem,
    value: string
  ) => {
    setDispatchErrors([]);
    setStagedItems((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        const next = { ...item, [field]: value };
        if (field === 'serial') {
          const matchedHq = deviceBySerial.get(norm(value));
          // Battery serial and model come only from the unit's own record (blank if unknown: the admin fills it).
          next.batterySerial = matchedHq?.batterySerial || '';
          if (matchedHq) next.model = matchedHq.model;
        }
        return next;
      })
    );
  };

  /** Every reason this list cannot be dispatched (blank, unknown, duplicate, wrong stage/type, allocated elsewhere). */
  const validateDispatch = (items: ArrangedDeviceItem[]): string[] => {
    const errs: string[] = [];
    if (!items.length) errs.push('Nothing to dispatch: the list is empty.');
    const seen = new Map<string, number>();
    items.forEach((item, i) => {
      const line = `Line ${i + 1}`;
      const sn = norm(item.serial);
      if (!sn) {
        errs.push(`${line}: choose a device serial.`);
        return;
      }
      if (seen.has(sn)) {
        errs.push(`${line}: ${item.serial} is already on line ${seen.get(sn)! + 1}.`);
        return;
      }
      seen.set(sn, i);
      const dev = deviceBySerial.get(sn);
      if (!dev) {
        errs.push(`${line}: ${item.serial} is not a known serial.`);
        return;
      }
      if (dev.stage !== 'HQ_STOCK' || dev.archived) {
        errs.push(`${line}: ${item.serial} is not in Head Office stock (current stage ${dev.stage}${dev.archived ? ', archived' : ''}).`);
      }
      if (dev.type !== item.type) {
        errs.push(`${line}: ${item.serial} is a ${dev.type}, but this line needs a ${item.type}.`);
      }
      const other = allocatedElsewhere.get(sn);
      if (other) errs.push(`${line}: ${item.serial} is already arranged on requisition ${other}.`);
      if (item.type === 'POS Terminal' && !String(item.batterySerial || '').trim()) {
        errs.push(`${line}: enter the battery serial for POS Terminal ${item.serial}.`);
      }
    });
    if (arrangingReq) {
      const pos = items.filter((it) => it.type === 'POS Terminal').length;
      const sb = items.filter((it) => it.type === 'Sound Box').length;
      if (pos > arrangingReq.posQty) errs.push(`${pos} POS Terminal line(s) but only ${arrangingReq.posQty} requested.`);
      if (sb > arrangingReq.sbQty) errs.push(`${sb} Sound Box line(s) but only ${arrangingReq.sbQty} requested.`);
    }
    return errs;
  };

  const handleProceedToPreview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!arrangingReq || !isAdmin) return;
    const errs = validateDispatch(stagedItems);
    setDispatchErrors(errs);
    if (errs.length) return;
    setArrangeStep('PREVIEW');
  };

  const handleFinalDispatch = () => {
    if (!arrangingReq || !isAdmin) return;
    // Re-check at the moment of dispatch: stock may have changed while the preview was open.
    const errs = validateDispatch(stagedItems);
    if (errs.length) {
      setDispatchErrors(errs);
      setArrangeStep('ARRANGE');
      return;
    }
    onApproveRequisition(
      arrangingReq.reqId,
      stagedItems.map((it) => ({ ...it, serial: it.serial.trim(), batterySerial: String(it.batterySerial || '').trim(), model: it.model.trim() }))
    );
    setArrangingReq(null);
    setArrangeStep('ARRANGE');
    setDispatchErrors([]);
    setShortfall('');
  };

  // ---- serial list (paste or file): match many serials to the request lines at once
  const [serialText, setSerialText] = useState('');
  const [serialReport, setSerialReport] = useState<string[]>([]);
  const applySerialList = (text: string) => {
    if (!arrangingReq) return;
    const rows = text
      .split(/\r?\n|;/)
      .map((l) => l.split(/[,\t]/).map((c) => c.trim()))
      .filter((c) => c[0]);
    const problems: string[] = [];
    const seen = new Set<string>();
    const picked: { dev: Device; battery: string }[] = [];
    rows.forEach((cols, i) => {
      const sn = norm(cols[0]);
      if (i === 0 && /^(SERIAL|SN|SERIAL NUMBER)/.test(sn)) return;      // header row
      if (seen.has(sn)) { problems.push(`${cols[0]}: listed twice`); return; }
      seen.add(sn);
      const dev = deviceBySerial.get(sn);
      if (!dev) { problems.push(`${cols[0]}: not in the inventory`); return; }
      if (dev.stage !== 'HQ_STOCK' || dev.archived) { problems.push(`${dev.serial}: not in Head Office stock (${dev.stage}${dev.archived ? ', archived' : ''})`); return; }
      const other = allocatedElsewhere.get(sn);
      if (other) { problems.push(`${dev.serial}: already arranged on ${other}`); return; }
      picked.push({ dev, battery: cols[1] || '' });
    });
    // fill the blank lines of each type in order; lines already filled by hand are kept
    const next = stagedItems.map((r) => ({ ...r }));
    const used = new Set(next.map((r) => norm(r.serial)).filter(Boolean));
    let filled = 0;
    picked.forEach(({ dev, battery }) => {
      if (used.has(norm(dev.serial))) return;
      const line = next.find((r) => r.type === dev.type && !r.serial);
      if (!line) { problems.push(`${dev.serial}: no free ${dev.type} line (the request has ${dev.type === 'POS Terminal' ? arrangingReq.posQty : arrangingReq.sbQty})`); return; }
      line.serial = dev.serial;
      line.model = dev.model;
      line.batterySerial = dev.batterySerial || battery;
      used.add(norm(dev.serial));
      filled += 1;
    });
    setStagedItems(next);
    setDispatchErrors([]);
    setSerialReport([`${filled} serial(s) matched to the request.`, ...problems]);
    if (filled) setSerialText('');
  };
  const onSerialFile = (file: File | undefined) => {
    if (!file) return;
    file.text().then((t) => { setSerialText(t); applySerialList(t); }).catch(() => setSerialReport(['The file could not be read.']));
  };

  // ---- edit a pending request
  const [editingReq, setEditingReq] = useState<Requisition | null>(null);
  const [editPos, setEditPos] = useState('0');
  const [editSb, setEditSb] = useState('0');
  const [editReason, setEditReason] = useState('');
  const openEdit = (req: Requisition) => {
    setEditingReq(req);
    setEditPos(String(req.posQty));
    setEditSb(String(req.sbQty));
    setEditReason(req.reason || '');
  };
  const saveEdit = () => {
    if (!editingReq || !onEditRequisition) return;
    const posQty = Math.max(0, Math.floor(Number(editPos) || 0));
    const sbQty = Math.max(0, Math.floor(Number(editSb) || 0));
    if (posQty + sbQty === 0) return;
    onEditRequisition(editingReq.reqId, { posQty, sbQty, reason: editReason.trim() });
    setEditingReq(null);
  };

  /** Serials chosen on other lines of this list (hidden from a line's dropdown). */
  const chosenSerials = useMemo(() => new Set(stagedItems.map((it) => norm(it.serial)).filter(Boolean)), [stagedItems]);

  const cardClass = isLight
    ? 'surface-card-light text-zinc-900'
    : 'surface-card-dark text-slate-100';
  const cardHeaderClass = isLight
    ? 'sb-card-header-light'
    : 'sb-card-header-dark';

  const subtextClass = isLight ? 'text-zinc-500' : 'text-slate-300';
  const navyTitleClass = isLight ? 'text-zinc-900' : 'text-zinc-100';

    const handleExportCsv = () => {
    if (shownReqs.length === 0) return;
    const headers = [
      'No.',
      'Request ID',
      'Date',
      'Branch / Staff',
      'Quantity',
      'Serials',
      'Reason',
      'Status',
    ];
    const rows = shownReqs.map((r, idx) => {
      const bName = (r.branchName || `Branch ${r.branchId}`).replace(' Branch', '');
      const branchStaff = `${r.branchId} · ${bName} (${r.staff || '-'})`;
      const qtyFormatted = `POS: ${r.posQty || 0}, SB: ${r.sbQty || 0} (Total: ${(r.posQty || 0) + (r.sbQty || 0)})`;
      const serials = (r.arrangedDevices || []).map((ad) => ad.serial).join(', ') || '-';
      const statusLabel = r.status === 'RECEIVED' ? 'Received' : r.status === 'DISPATCHED' ? 'Dispatched' : r.status === 'REJECTED' ? 'Rejected' : 'Pending';

      return [
        String(idx + 1),
        r.reqId,
        r.date,
        branchStaff,
        qtyFormatted,
        serials,
        r.reason || '-',
        statusLabel,
      ];
    });
    const url = URL.createObjectURL(csvFile([headers, ...rows]));
    const link = document.createElement('a');
    link.href = url;
    link.download = `Branch_Stock_Requests_${todayPP()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Requisitions DataTable Card */}
      <div className={`${cardClass} overflow-hidden`}>
        <div
          className={`${cardHeaderClass} px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3`}
        >
          <div className="flex items-center gap-2">
            <h2
              className={`text-base font-extrabold ${navyTitleClass} flex items-center gap-2`}
            >
              <ScrollText className="w-4.5 h-4.5" />
              <span>Branch Stock Requests &amp; Dispatch</span>
            </h2>
            <span className={`text-xs font-semibold ${subtextClass}`}>
              ({requisitions.length} Record(s) · HQ Stock: {availableHqPos.length} POS, {availableHqSb.length} SB)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <motion.button
              whileTap={{ scale: 0.95 }}
              type="button"
              onClick={handleExportCsv}
              disabled={shownReqs.length === 0}
              className="px-3 py-1.5 rounded-md text-xs font-bold border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-1.5 whitespace-nowrap cursor-pointer shadow-2xs transition disabled:opacity-50"
              title="Export Stock Requests Table to CSV (matching table columns)"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              <span>Export CSV</span>
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              type="button"
              onClick={onOpenRequestModal}
              className="px-3 py-1.5 rounded-md text-xs font-bold bg-[#003857] hover:bg-[#002a42] text-white flex items-center gap-1.5 whitespace-nowrap cursor-pointer shadow-xs transition"
            >
              <SendHorizontal className="w-3.5 h-3.5" />
              <span>New Stock Request</span>
            </motion.button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="data-table min-w-[900px]">
            <thead className="glass-table-thead">
              <tr>
                <th className="col-no">No.</th>
                <SortTh k="request" sort={reqSort} onSort={reqToggle}>Request ID</SortTh>
                <SortTh k="date" sort={reqSort} onSort={reqToggle}>Date</SortTh>
                <SortTh k="branch" sort={reqSort} onSort={reqToggle}>Branch / Staff</SortTh>
                <SortTh k="qty" sort={reqSort} onSort={reqToggle}>Quantity</SortTh>
                <SortTh k="serials" sort={reqSort} onSort={reqToggle}>Serials</SortTh>
                <SortTh k="reason" sort={reqSort} onSort={reqToggle}>Reason</SortTh>
                <SortTh k="status" sort={reqSort} onSort={reqToggle}>Status</SortTh>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody ref={flipRef}>
              {shownReqs.map((req, rowIdx) => {
                const isReturnReq = req.type === 'STOCK_RETURN';
                const arranged = req.arrangedDevices || [];
                let chip = 'chip-amber';
                let statusLabel = 'Pending';
                let actionBtn: React.ReactNode = null;
                const canEdit = Boolean(onEditRequisition) && req.status === 'PENDING_ADMIN' && !isReturnReq;
                const editBtn = canEdit ? (
                  <button type="button" onClick={() => openEdit(req)} className="row-btn inline-flex items-center !px-2" title="Edit the quantity or reason" aria-label="Edit">
                    <Pencil className="w-3.5 h-3.5" aria-hidden />
                  </button>
                ) : null;

                const rejectBtn = isAdmin && onRejectRequisition && req.status === 'PENDING_ADMIN' ? (
                  <button type="button" onClick={() => { setRejectingReq(req); setRejectText(''); }} className="row-btn inline-flex items-center !px-2" title="Reject this request with a reason (for example no stock)" aria-label="Reject">
                    <Ban className="w-3.5 h-3.5" aria-hidden />
                  </button>
                ) : null;

                if (req.status === 'PENDING_ADMIN') {
                  if (isReturnReq) {
                    statusLabel = 'Return pending';
                    actionBtn = isAdmin ? (
                      <div className="inline-flex items-center gap-1.5">
                        {rejectBtn}
                        <button
                          type="button"
                          onClick={() => onApproveReturnRequisition?.(req.reqId, req.returnSerials, req.reason)}
                          className="row-btn inline-flex items-center gap-1"
                          title="Approve and receive the returned units into Head Office stock"
                        >
                          <CheckCircle2 className="w-3 h-3" aria-hidden />
                          <span>Approve &amp; Receive</span>
                        </button>
                      </div>
                    ) : <span className="cell-sub">Awaiting HQ</span>;
                  } else {
                    actionBtn = (
                      <div className="inline-flex items-center gap-1.5">
                        {editBtn}
                        {rejectBtn}
                        {isAdmin ? (
                          <button type="button" onClick={() => openArrangeModal(req)} className="row-btn inline-flex items-center gap-1 !px-2.5" title="Choose the serials and dispatch to the branch" aria-label="Dispatch">
                            <Truck className="w-3.5 h-3.5" aria-hidden />
                            <span className="hidden 2xl:inline">Dispatch</span>
                          </button>
                        ) : <span className="cell-sub">Awaiting HQ</span>}
                      </div>
                    );
                  }
                } else if (req.status === 'DISPATCHED') {
                  chip = 'chip-slate';
                  statusLabel = 'Dispatched';
                  actionBtn = (
                    <button type="button" onClick={() => onReceiveRequisition(req.reqId)} className="row-btn inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" aria-hidden />
                      <span>Confirm Receipt</span>
                    </button>
                  );
                } else if (req.status === 'REJECTED') {
                  chip = 'chip-red';
                  statusLabel = 'Rejected';
                } else if (req.status === 'RECEIVED') {
                  chip = 'chip-green';
                  statusLabel = isReturnReq ? 'Received at HQ' : 'Received';
                }

                const serialList = isReturnReq ? (req.returnSerials || []) : arranged.map((a) => a.serial);
                return (
                  <tr key={req.reqId} data-flip={req.reqId}>
                    <td className="col-no">{pg.start + rowIdx + 1}</td>
                    <td>
                      <div className="cell-mono whitespace-nowrap">{req.reqId}</div>
                      <div className="cell-sub whitespace-nowrap">{isReturnReq ? 'Stock return' : 'Stock request'}</div>
                    </td>
                    <td className="whitespace-nowrap tabular-nums text-[12px] text-slate-700">{req.date}</td>
                    <td>
                      <div className="cell-main max-w-[170px] truncate" title={`Code ${req.branchId} · ${req.branchName}`}>
                        {req.branchId} · {req.branchName.replace(' Branch', '')}
                      </div>
                      <div className="cell-sub max-w-[170px] truncate">{req.staff}</div>
                    </td>
                    <td className="whitespace-nowrap">
                      {req.posQty > 0 && <div className="cell-main flex items-center gap-1.5"><Cpu className="w-3.5 h-3.5 text-sky-600 shrink-0" aria-hidden />POS Terminal × {req.posQty}</div>}
                      {req.sbQty > 0 && <div className="cell-main flex items-center gap-1.5"><Volume2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" aria-hidden />Sound Box × {req.sbQty}</div>}
                    </td>
                    <td className="whitespace-nowrap">
                      {serialList.length > 0 ? (
                        <div className="flex flex-nowrap items-center gap-1 whitespace-nowrap" title={serialList.join(', ')}>
                          {serialList.slice(0, 1).map((sn) => (
                            <span key={sn} className="cell-mono text-[11px] px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50">{sn}</span>
                          ))}
                          {serialList.length > 1 && <span className="cell-sub !mt-0 pl-0.5">+{serialList.length - 1} more</span>}
                        </div>
                      ) : (
                        <span className="cell-sub">{isReturnReq ? 'No serials listed' : 'Not arranged yet'}</span>
                      )}
                    </td>
                    <td>
                      <div className="khmer max-w-[128px] truncate" title={req.reason || ''}>{req.reason || <span className="cell-sub">—</span>}</div>
                      {req.status === 'REJECTED' && (
                        <div className="cell-sub khmer max-w-[128px] truncate" title={`Rejected: ${req.rejectReason || 'no reason recorded'}${req.rejectedBy ? ` · by ${req.rejectedBy}` : ''}`}>
                          Rejected: {req.rejectReason || 'no reason recorded'}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap"><span className={`chip ${chip}`}>{statusLabel}</span></td>
                    <td className="text-right whitespace-nowrap">{actionBtn}</td>
                  </tr>
                );
              })}

              {requisitions.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-10 text-center"><span className="cell-sub">No stock requests found.</span></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager pg={pg} label="requests" />
      </div>

      {/* Reject a pending request */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {rejectingReq && (
              <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setRejectingReq(null); }}>
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 12 }}
                  transition={{ type: 'spring', damping: 28, stiffness: 340, mass: 0.75 }}
                  className="w-full max-w-md rounded-2xl bg-white text-slate-900 shadow-2xl overflow-hidden" role="dialog" aria-modal="true" aria-label="Reject request"
                >
                  <div className="navy-header-bar px-5 py-3.5 flex items-center justify-between text-white">
                    <div>
                      <div className="text-sm font-semibold">Reject {rejectingReq.type === 'STOCK_RETURN' ? 'stock return' : 'stock request'}</div>
                      <div className="text-xs text-white/75 font-mono">{rejectingReq.reqId} · Code {rejectingReq.branchId}</div>
                    </div>
                    <button type="button" onClick={() => setRejectingReq(null)} aria-label="Close" className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer"><X className="w-4 h-4" /></button>
                  </div>
                  <div className="p-5 flex flex-col gap-3 text-xs">
                    <div className="text-slate-600">The branch will see this reason. A rejected request cannot be dispatched.</div>
                    <div className="flex flex-wrap gap-1.5">
                      {['No stock available at Head Office', 'Quantity is more than the branch needs', 'Request is not clear, please submit again', 'Not approved by management'].map((t) => (
                        <button key={t} type="button" onClick={() => setRejectText(t)} className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 cursor-pointer">{t}</button>
                      ))}
                    </div>
                    <label className="flex flex-col gap-1">
                      <span className="text-slate-500">Reason (required)</span>
                      <textarea rows={3} maxLength={500} value={rejectText} onChange={(e) => setRejectText(e.target.value)} className="khmer rounded-lg border border-slate-300 px-3 py-2" />
                    </label>
                    <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                      <button type="button" onClick={() => setRejectingReq(null)} className="px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 cursor-pointer">Cancel</button>
                      <button type="button" disabled={rejectText.trim().length < 3}
                        onClick={() => { onRejectRequisition?.(rejectingReq.reqId, rejectText.trim()); setRejectingReq(null); }}
                        className="px-4 py-2 rounded-lg bg-rose-700 hover:bg-rose-800 disabled:opacity-45 text-white cursor-pointer">Reject request</button>
                    </div>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Edit a pending request */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {editingReq && (
              <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: 12 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 12 }}
                  transition={{ type: 'spring', damping: 28, stiffness: 340, mass: 0.75 }}
                  className="w-full max-w-md rounded-2xl bg-white text-slate-900 shadow-2xl overflow-hidden"
                >
                  <div className="navy-header-bar px-5 py-3.5 flex items-center justify-between text-white">
                    <div>
                      <div className="text-sm font-semibold">Edit stock request</div>
                      <div className="text-xs text-white/75 font-mono">{editingReq.reqId} · Code {editingReq.branchId}</div>
                    </div>
                    <button type="button" onClick={() => setEditingReq(null)} aria-label="Close" className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer"><X className="w-4 h-4" /></button>
                  </div>
                  <div className="p-5 flex flex-col gap-3 text-xs">
                    <div className="grid grid-cols-2 gap-3">
                      <label className="flex flex-col gap-1">
                        <span className="text-slate-500">POS Terminal quantity</span>
                        <input type="number" min={0} inputMode="numeric" value={editPos} onChange={(e) => setEditPos(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2" />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-slate-500">Sound Box quantity</span>
                        <input type="number" min={0} inputMode="numeric" value={editSb} onChange={(e) => setEditSb(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2" />
                      </label>
                    </div>
                    <label className="flex flex-col gap-1">
                      <span className="text-slate-500">Reason</span>
                      <textarea rows={3} value={editReason} onChange={(e) => setEditReason(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2" />
                    </label>
                    {(Math.floor(Number(editPos) || 0) + Math.floor(Number(editSb) || 0)) === 0 && (
                      <div role="alert" className="text-rose-700">Enter at least one POS Terminal or Sound Box.</div>
                    )}
                    <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                      <button type="button" onClick={() => setEditingReq(null)} className="px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 cursor-pointer">Cancel</button>
                      <button type="button" onClick={saveEdit} className="px-4 py-2 rounded-lg bg-[#003857] hover:bg-[#002a42] text-white cursor-pointer">Save changes</button>
                    </div>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Step 3 & 4 Modal: Head Office Admin Arrange POS Serial + Battery Serial + Sound Box Serial to Branch */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {arrangingReq && isAdmin && (
              <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-md overflow-y-auto p-4 flex justify-center items-start sm:items-center">
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: 14 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 12 }}
                  transition={{ type: 'spring', damping: 28, stiffness: 340, mass: 0.75 }}
                  className={`my-auto border-0 rounded-3xl w-full max-w-5xl xl:max-w-6xl shadow-2xl overflow-hidden flex flex-col transform-gpu will-change-gpu gpu-modal-container ${
                    isLight
                      ? 'bg-white text-slate-900'
                      : 'bg-[#121622] text-slate-100'
                  }`}
                >
              <div className="navy-header-bar rounded-t-3xl px-6 py-4.5 flex items-center justify-between text-white border-b border-white/10">
                <div>
                  <h3 className="text-base font-bold flex items-center gap-2">
                    <BatteryCharging className="w-5 h-5 text-sky-400" />
                    <span>
                      Arrange Hardware &amp; Battery Serials for Branch
                    </span>
                  </h3>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Requisition {arrangingReq.reqId} · Assign to Code {arrangingReq.branchId} ({arrangingReq.branchName}) · {arrangingReq.posQty} POS &amp; {arrangingReq.sbQty} Sound Box
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setArrangingReq(null)}
                  aria-label="Close"
                  className="p-1.5 rounded-xl text-white/80 hover:text-white hover:bg-white/10 transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Stepper Progress Bar */}
              <div
                className={`px-6 py-3 border-b flex items-center justify-between text-xs ${
                  isLight
                    ? 'bg-slate-50/90 border-slate-200 text-slate-700'
                    : 'bg-[#151922] border-slate-800 text-slate-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setArrangeStep('ARRANGE')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold transition cursor-pointer ${
                      arrangeStep === 'ARRANGE'
                        ? 'bg-[#004953] text-white shadow-xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <span className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-black">
                      1
                    </span>
                    <span>Arrange Serials</span>
                  </button>

                  <ArrowRight className="w-3.5 h-3.5 text-slate-400" />

                  <button
                    type="button"
                    onClick={() => {
                      const errs = validateDispatch(stagedItems);
                      setDispatchErrors(errs);
                      if (!errs.length) setArrangeStep('PREVIEW');
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold transition ${
                      arrangeStep === 'PREVIEW'
                        ? 'bg-[#004953] text-white shadow-xs'
                        : 'text-slate-400 opacity-70'
                    }`}
                  >
                    <span className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-black">
                      2
                    </span>
                    <span>Dispatch Impact Preview</span>
                  </button>
                </div>

                <div className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#1e5b88]" />
                  <span>Double-Step Safeguard</span>
                </div>
              </div>

              {arrangeStep === 'ARRANGE' ? (
                <form onSubmit={handleProceedToPreview} className="p-6 flex flex-col gap-4 text-xs">
                  <div
                    className={`p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-3 ${
                      isLight
                        ? 'bg-slate-50/70 border-slate-200'
                        : 'bg-[#18191e] border-white/10'
                    }`}
                  >
                    <div>
                      <span className="font-bold text-sm">
                        Target Branch: Code {arrangingReq.branchId} — {arrangingReq.branchName}
                      </span>
                      <span className={`block text-xs mt-0.5 ${subtextClass}`}>
                        Requested by {arrangingReq.staff} · Reason: {arrangingReq.reason}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={rerunAutoMatch}
                        title="Fill each line with the oldest available Head Office unit of that type (FIFO)"
                        className="px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 cursor-pointer bg-[#003857] hover:bg-[#002a42] text-white transition shadow-xs text-xs"
                      >
                        <Wand2 className="w-3.5 h-3.5" />
                        <span>Auto-Match from HO Stock</span>
                      </button>
                    </div>
                  </div>

                  <div className={`p-3.5 rounded-xl border flex flex-col gap-2 ${isLight ? 'bg-white border-slate-200' : 'bg-[#18191e] border-white/10'}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">Upload or paste the serial list</span>
                      <label className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 cursor-pointer inline-flex items-center gap-1.5">
                        <Upload className="w-3.5 h-3.5" aria-hidden />
                        <span>Choose CSV / TXT file</span>
                        <input type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={(e) => { onSerialFile(e.target.files?.[0]); e.target.value = ''; }} />
                      </label>
                    </div>
                    <textarea
                      rows={3}
                      value={serialText}
                      onChange={(e) => setSerialText(e.target.value)}
                      placeholder={'One serial per line. For a POS Terminal you can add the battery serial after a comma, for example:\nP12345678, B98765432'}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[11px] ${subtextClass}`}>Serials fill the free lines by type. Units not in Head Office stock are reported, not added.</span>
                      <button type="button" disabled={!serialText.trim()} onClick={() => applySerialList(serialText)} className="px-3 py-1.5 rounded-lg bg-[#003857] hover:bg-[#002a42] text-white disabled:opacity-40 cursor-pointer">Match serials</button>
                    </div>
                    {serialReport.length > 0 && (
                      <ul role="status" className="text-[11px] space-y-0.5">
                        {serialReport.slice(0, 8).map((l, i) => <li key={i} className={i === 0 ? 'text-emerald-700' : 'text-amber-700'}>{l}</li>)}
                        {serialReport.length > 8 && <li className="text-amber-700">…and {serialReport.length - 8} more.</li>}
                      </ul>
                    )}
                  </div>

                  {shortfall && (
                    <div role="status" className="p-3 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-700 dark:text-amber-300 font-semibold flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{shortfall}</span>
                    </div>
                  )}

                  {dispatchErrors.length > 0 && (
                    <div role="alert" className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 font-semibold">
                      <div className="flex items-center gap-2 mb-1">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>Fix these before dispatching:</span>
                      </div>
                      <ul className="list-disc pl-6 space-y-0.5 font-medium">
                        {dispatchErrors.slice(0, 12).map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                        {dispatchErrors.length > 12 && <li>…and {dispatchErrors.length - 12} more.</li>}
                      </ul>
                    </div>
                  )}

                  <div className="overflow-x-auto max-h-[520px] rounded-xl border border-slate-200 dark:border-[#003b5c] shadow-2xs">
                    <table className="w-full text-left text-xs">
                      <thead className="glass-table-thead text-[11px] uppercase font-extrabold sticky top-0 z-10 shadow-xs">
                        <tr>
                          <th className="py-3 px-3.5 w-12 text-center">No.</th>
                          <th className="py-3 px-4 w-36">Device Type</th>
                          <th className="py-3 px-4 w-44">Model</th>
                          <th className="py-3 px-4 min-w-[280px]">Arranged Device Serial *</th>
                          <th className="py-3 px-4 w-56">Arranged Battery Serial *</th>
                        </tr>
                      </thead>
                      <tbody
                        className={`divide-y ${
                          isLight ? 'divide-[#d8e2ea]' : 'divide-[#003b5c]'
                        }`}
                      >
                        {stagedItems.map((item, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/80 dark:hover:bg-white/5 transition-colors">
                            <td className="py-2.5 px-3.5 font-mono font-bold text-center text-slate-500">
                              {idx + 1}
                            </td>
                            <td className="py-2.5 px-4 font-bold">
                              {item.type === 'POS Terminal' ? (
                                <span className={navyTitleClass}>POS Terminal</span>
                              ) : (
                                <span className="text-[#1cc88a]">Sound Box</span>
                              )}
                            </td>
                            <td className="py-2.5 px-4">
                              <input
                                type="text"
                                aria-label={`Model for line ${idx + 1}`}
                                value={item.model}
                                onChange={(e) =>
                                  handleUpdateStagedItem(idx, 'model', e.target.value)
                                }
                                className={`w-full rounded-lg px-3 py-2 text-xs border ${
                                  isLight
                                    ? 'bg-white border-slate-300 text-[#002f49] focus:border-[#003857]'
                                    : 'bg-[#001a2c] border-[#003b5c] text-white focus:border-sky-400'
                                }`}
                              />
                            </td>
                            <td className="py-2.5 px-4">
                              {(() => {
                                const availableForType =
                                  (item.type === 'POS Terminal' ? availableHqPos : availableHqSb).filter(
                                    (d) => norm(d.serial) === norm(item.serial) || !chosenSerials.has(norm(d.serial))
                                  );
                                return (
                                  <select
                                    required
                                    aria-label={`Device serial for line ${idx + 1}`}
                                    value={item.serial}
                                    onChange={(e) =>
                                      handleUpdateStagedItem(idx, 'serial', e.target.value)
                                    }
                                    className={`w-full rounded-lg px-3 py-2 text-xs font-mono font-bold border ${
                                      isLight
                                        ? 'bg-white border-slate-300 text-[#002f49] focus:border-[#003857]'
                                        : 'bg-[#001a2c] border-[#003b5c] text-white focus:border-sky-400'
                                    }`}
                                  >
                                    <option value="">-- Select from Stock Inventory --</option>
                                    {availableForType.map((d) => (
                                      <option key={d.serial} value={d.serial}>
                                        {d.serial} — {d.model} {d.batterySerial ? `(Bat: ${d.batterySerial})` : ''}
                                      </option>
                                    ))}
                                    {item.serial &&
                                      !availableForType.some((d) => d.serial === item.serial) && (
                                        <option value={item.serial}>
                                          {item.serial} (not available in HQ stock)
                                        </option>
                                      )}
                                  </select>
                                );
                              })()}
                            </td>
                            <td className="py-2.5 px-4">
                              <input
                                type="text"
                                required={item.type === 'POS Terminal'}
                                aria-label={`Battery serial for line ${idx + 1}`}
                                placeholder={item.type === 'POS Terminal' ? 'Battery serial on the unit' : 'Optional'}
                                value={item.batterySerial}
                                onChange={(e) =>
                                  handleUpdateStagedItem(
                                    idx,
                                    'batterySerial',
                                    e.target.value
                                  )
                                }
                                className={`w-full rounded-lg px-3 py-2 text-xs font-mono font-bold border ${
                                  isLight
                                    ? 'bg-white border-slate-300 text-slate-900 focus:border-[#003857]'
                                    : 'bg-black/20 border-white/10 text-white focus:border-sky-400'
                                }`}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-[#003b5c]">
                    <button
                      type="button"
                      onClick={() => setArrangingReq(null)}
                      className="px-4 py-2 rounded-lg text-xs font-semibold border bg-white hover:bg-slate-100 text-slate-700 border-slate-300 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2 rounded-lg text-xs font-bold bg-[#003857] hover:bg-[#002a42] text-white shadow-xs cursor-pointer flex items-center gap-2 transition"
                    >
                      <span>Review Dispatch (Step 2 Preview)</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </form>
              ) : (
                /* STEP 2: DISPATCH PREVIEW & VERIFICATION */
                <div className="p-6 flex flex-col gap-4 text-xs">
                  {/* Alert Banner */}
                  <div className="p-3.5 rounded-xl border bg-amber-50 border-amber-200 text-amber-900 flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-extrabold text-xs block">
                        Verify Stock Transfer Custody Before Dispatching
                      </span>
                      <p className="text-[11px] mt-0.5 opacity-90 leading-relaxed">
                        Dispatching allocates <strong>{stagedItems.length} hardware unit(s)</strong> in Head Office Admin Stock (Code 100) to <strong>Branch Code {arrangingReq.branchId} ({arrangingReq.branchName})</strong>. Custody moves to the branch when the branch confirms receipt.
                      </p>
                    </div>
                  </div>

                  {/* Summary Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 rounded-xl border bg-slate-50 border-slate-200">
                      <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">Requisition ID</span>
                      <span className="font-mono font-bold text-xs text-slate-800 mt-0.5 block">{arrangingReq.reqId}</span>
                    </div>

                    <div className="p-3 rounded-xl border bg-slate-50 border-slate-200">
                      <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">Target Branch</span>
                      <span className="font-bold text-xs text-slate-800 mt-0.5 block truncate">Code {arrangingReq.branchId} — {arrangingReq.branchName}</span>
                    </div>

                    <div className="p-3 rounded-xl border bg-slate-50 border-slate-200">
                      <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">Requested By</span>
                      <span className="font-medium text-xs text-slate-800 mt-0.5 block truncate">{arrangingReq.staff}</span>
                    </div>

                    <div className="p-3 rounded-xl border bg-slate-50 border-slate-200">
                      <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">Total Dispatched</span>
                      <span className="font-bold text-xs text-emerald-700 mt-0.5 block">{stagedItems.filter((it) => it.type === 'POS Terminal').length} POS · {stagedItems.filter((it) => it.type === 'Sound Box').length} SB</span>
                    </div>
                  </div>

                  {/* Arranged Items Preview Table */}
                  <div className="overflow-x-auto max-h-[460px] rounded-xl border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="glass-table-thead text-[11px] uppercase font-extrabold sticky top-0 z-10 shadow-xs">
                        <tr>
                          <th className="py-2.5 px-3.5 w-12 text-center">No.</th>
                          <th className="py-2.5 px-4 w-36">Device Type</th>
                          <th className="py-2.5 px-4 w-44">Model</th>
                          <th className="py-2.5 px-4 min-w-[280px]">Serial Number</th>
                          <th className="py-2.5 px-4 w-56">Battery Serial</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 bg-white">
                        {stagedItems.map((item, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="py-2 px-3.5 font-mono font-bold text-center text-slate-500">{idx + 1}</td>
                            <td className="py-2 px-4 font-semibold text-slate-800">{item.type}</td>
                            <td className="py-2 px-4 text-slate-600">{item.model}</td>
                            <td className="py-2 px-4 font-mono font-bold text-[#1e5b88]">{item.serial}</td>
                            <td className="py-2 px-4 font-mono text-slate-700">{item.batterySerial}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Branch personnel will receive an automated dispatch notification to acknowledge physical receipt.</span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-between pt-3 border-t border-slate-200">
                    <button
                      type="button"
                      onClick={() => setArrangeStep('ARRANGE')}
                      className="px-4 py-2 rounded-lg text-xs font-semibold border bg-white hover:bg-slate-100 text-slate-700 border-slate-300 cursor-pointer flex items-center gap-1.5"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Back to Edit Serials</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleFinalDispatch}
                      className="px-5 py-2 rounded-lg text-xs font-bold bg-[#003857] hover:bg-[#002a42] text-white shadow-xs cursor-pointer flex items-center gap-2 transition"
                    >
                      <Truck className="w-3.5 h-3.5" />
                      <span>Confirm &amp; Dispatch to Branch Code {arrangingReq.branchId}</span>
                    </button>
                  </div>
                </div>
              )}
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
};


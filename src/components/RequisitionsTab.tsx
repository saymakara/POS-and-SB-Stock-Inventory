import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Requisition, Device, ArrangedDeviceItem, UserRole, ThemeMode } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import {
  SendHorizontal,
  CheckCircle2,
  Truck,
  Check,
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
  RotateCcw,
  Package,
} from 'lucide-react';

interface RequisitionsTabProps {
  role: UserRole;
  requisitions: Requisition[];
  hqDevices?: Device[];
  onOpenRequestModal: () => void;
  onApproveRequisition: (reqId: string, arrangedDevices?: ArrangedDeviceItem[]) => void;
  onApproveReturnRequisition?: (reqId: string, returnSerials?: string[], reason?: string) => void;
  onReceiveRequisition: (reqId: string) => void;
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
  onReceiveRequisition,
  theme = 'light',
  onDirectToStockInventory,
  externalArrangingReq,
  externalStagedItems,
  onClearExternalArranging,
}) => {
  const isLight = theme === 'light';
  // Dispatching / approving moves Head Office stock: HQ roles only (the server enforces this too).
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const [arrangingReq, setArrangingReq] = useState<Requisition | null>(null);
  const [stagedItems, setStagedItems] = useState<ArrangedDeviceItem[]>([]);
  const [arrangeStep, setArrangeStep] = useState<'ARRANGE' | 'PREVIEW'>('ARRANGE');
  const [dispatchErrors, setDispatchErrors] = useState<string[]>([]);
  const [shortfall, setShortfall] = useState('');

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

  /** Serials chosen on other lines of this list (hidden from a line's dropdown). */
  const chosenSerials = useMemo(() => new Set(stagedItems.map((it) => norm(it.serial)).filter(Boolean)), [stagedItems]);

  const cardClass = isLight
    ? 'surface-card-light text-zinc-900'
    : 'surface-card-dark text-slate-100';
  const cardHeaderClass = isLight
    ? 'sb-card-header-light'
    : 'sb-card-header-dark';

  const headingClass = isLight ? 'text-zinc-900' : 'text-white';
  const subtextClass = isLight ? 'text-zinc-500' : 'text-slate-300';
  const navyTitleClass = isLight ? 'text-zinc-900' : 'text-zinc-100';

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
              onClick={onOpenRequestModal}
              className="px-3 py-1.5 rounded-md text-xs font-bold bg-[#003857] hover:bg-[#002a42] text-white flex items-center gap-1.5 whitespace-nowrap cursor-pointer shadow-xs transition"
            >
              <SendHorizontal className="w-3.5 h-3.5" />
              <span>New Stock Request</span>
            </motion.button>
          </div>
        </div>

        <div className="p-4 overflow-x-auto">
          <table
            className={`w-full text-left text-xs border ${
              isLight ? 'border-[#d8e2ea]' : 'border-[#003b5c]'
            }`}
          >
            <thead className="glass-table-thead text-[11px] font-extrabold uppercase">
              <tr>
                <th className="py-3 px-3.5">Request ID</th>
                <th className="py-3 px-3.5">Branch</th>
                <th className="py-3 px-3.5">Requested By</th>
                <th className="py-3 px-3.5">Requested Qty</th>
                <th className="py-3 px-3.5">Arranged POS, Battery &amp; Sound Box Serials</th>
                <th className="py-3 px-3.5">Notes</th>
                <th className="py-3 px-3.5">Status</th>
                <th className="py-3 px-3.5 text-right">Workflow Action</th>
              </tr>
            </thead>
            <tbody
              className={`divide-y ${
                isLight ? 'divide-[#d8e2ea]' : 'divide-[#003b5c]'
              }`}
            >
              {requisitions.map((req) => {
                let statusColor = 'text-[#d99b00] dark:text-[#f6c23e]';
                let statusLabel = 'Pending Approval';
                let actionBtn: React.ReactNode = null;

                const isReturnReq = req.type === 'STOCK_RETURN';

                if (req.status === 'PENDING_ADMIN') {
                  if (isReturnReq) {
                    statusColor = 'text-amber-600 dark:text-amber-400';
                    statusLabel = 'Pending Return Approval';
                    actionBtn =
                      isAdmin ? (
                        <motion.button
                          whileTap={{ scale: 0.95 }}
                          type="button"
                          onClick={() =>
                            onApproveReturnRequisition?.(
                              req.reqId,
                              req.returnSerials,
                              req.reason
                            )
                          }
                          className="px-3 py-1.5 rounded-md text-xs font-bold bg-[#1cc88a] hover:bg-[#17a673] text-white flex items-center gap-1.5 ml-auto cursor-pointer whitespace-nowrap shadow-xs transition"
                          title="Approve and receive returned hardware units into Head Office Admin Stock"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Approve &amp; Receive to HQ</span>
                        </motion.button>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400 font-semibold text-xs flex items-center gap-1 justify-end">
                          <span>Awaiting Admin Approval</span>
                        </span>
                      );
                  } else {
                    statusColor = 'text-[#d99b00] dark:text-[#f6c23e]';
                    statusLabel = 'Pending Approval';
                    actionBtn = !isAdmin ? (
                      <span className="text-[#d99b00] dark:text-[#f6c23e] font-semibold text-xs flex items-center gap-1 justify-end">
                        <span>Awaiting HQ Dispatch</span>
                      </span>
                    ) : (
                      <div className="flex items-center gap-1.5 justify-end">
                        {onDirectToStockInventory && (
                          <motion.button
                            whileTap={{ scale: 0.95 }}
                            type="button"
                            onClick={() => onDirectToStockInventory(req)}
                            className="px-2.5 py-1.5 rounded-md text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1 cursor-pointer whitespace-nowrap shadow-xs transition"
                            title="Direct to Stock Inventory to select serial numbers first"
                          >
                            <Package className="w-3.5 h-3.5" />
                            <span>Select in Stock</span>
                          </motion.button>
                        )}
                        <motion.button
                          whileTap={{ scale: 0.95 }}
                          type="button"
                          onClick={() => openArrangeModal(req)}
                          className="px-3 py-1.5 rounded-md text-xs font-bold bg-[#003857] hover:bg-[#002a42] text-white flex items-center gap-1.5 cursor-pointer whitespace-nowrap shadow-xs transition"
                        >
                          <Truck className="w-3.5 h-3.5" />
                          <span>Arrange &amp; Dispatch</span>
                        </motion.button>
                      </div>
                    );
                  }
                } else if (req.status === 'DISPATCHED') {
                  statusColor = navyTitleClass;
                  statusLabel = 'Dispatched';
                  actionBtn = (
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      type="button"
                      onClick={() => onReceiveRequisition(req.reqId)}
                      className="px-3 py-1.5 rounded-md text-xs font-bold bg-[#1cc88a] hover:bg-[#17a673] text-white flex items-center gap-1.5 ml-auto cursor-pointer whitespace-nowrap"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Confirm Receipt</span>
                    </motion.button>
                  );
                } else if (req.status === 'RECEIVED') {
                  statusColor = 'text-[#1cc88a]';
                  statusLabel = isReturnReq ? 'Returned to HQ Stock' : 'Received';
                  actionBtn = (
                    <span className="text-[#1cc88a] font-bold flex items-center gap-1 justify-end whitespace-nowrap">
                      <Check className="w-3.5 h-3.5" />
                      <span>{isReturnReq ? 'Received in HQ' : 'Confirmed'}</span>
                    </span>
                  );
                }

                const arranged = req.arrangedDevices || [];

                return (
                  <tr
                    key={req.reqId}
                    className={
                      isLight
                        ? 'hover:bg-[#f6f9fb]'
                        : 'hover:bg-white/[0.03]'
                    }
                  >
                    <td className="py-3 px-3.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-mono font-bold ${headingClass}`}>
                          {req.reqId}
                        </span>
                        {isReturnReq ? (
                          <span className="px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300/80">
                            Return
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300 border border-sky-300/80">
                            Request
                          </span>
                        )}
                      </div>
                      <div className={`text-[10px] font-mono ${subtextClass}`}>
                        {req.date}
                      </div>
                    </td>
                    <td className={`py-3 px-3.5 font-bold ${headingClass}`}>
                      Code {req.branchId} · {req.branchName.replace(' Branch', '')}
                    </td>
                    <td className="py-3 px-3.5 font-semibold">
                      {req.staff}
                    </td>
                    <td className="py-3 px-3.5">
                      <div className={`font-mono font-bold ${navyTitleClass} tabular-nums`}>
                        {req.posQty} POS Terminal
                      </div>
                      <div className="font-mono font-bold text-[#1cc88a] tabular-nums">
                        {req.sbQty} Sound Box
                      </div>
                    </td>
                    <td className="py-3 px-3.5 max-w-[300px]">
                      {isReturnReq ? (
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1">
                            <RotateCcw className="w-3 h-3" />
                            <span>Returning Serials ({req.returnSerials?.length || req.posQty + req.sbQty}):</span>
                          </span>
                          {req.returnSerials && req.returnSerials.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {req.returnSerials.map((sn) => (
                                <span
                                  key={sn}
                                  className="px-1.5 py-0.5 rounded font-mono text-[11px] font-bold bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200"
                                >
                                  {sn}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className={`text-[11px] ${subtextClass}`}>
                              {req.posQty}x POS · {req.sbQty}x Sound Box
                            </span>
                          )}
                        </div>
                      ) : arranged.length > 0 ? (
                        <div className="flex flex-col gap-1">
                          {arranged.slice(0, 4).map((item, i) => (
                            <div
                              key={i}
                              className="flex items-center gap-1.5 text-[11px] font-mono"
                            >
                              {item.type === 'POS Terminal' ? (
                                <Cpu className={`w-3 h-3 ${navyTitleClass} shrink-0`} />
                              ) : (
                                <Volume2 className="w-3 h-3 text-[#1cc88a] shrink-0" />
                              )}
                              <span className={`font-bold ${headingClass}`}>
                                {item.serial}
                              </span>
                              <span className={`text-[10px] ${subtextClass}`}>
                                · Bat: {item.batterySerial}
                              </span>
                            </div>
                          ))}
                          {arranged.length > 4 && (
                            <span className={`text-[10px] font-semibold ${subtextClass}`}>
                              +{arranged.length - 4} more arranged unit(s)
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className={`text-[11px] ${subtextClass}`}>
                          Awaiting HO Admin POS Serial &amp; Battery Serial arrangement
                        </span>
                      )}
                    </td>
                    <td className={`py-3 px-3.5 max-w-[200px] ${subtextClass}`}>
                      {req.reason}
                    </td>
                    <td className="py-3 px-3.5">
                      <span className={`font-bold ${statusColor}`}>
                        {statusLabel}
                      </span>
                    </td>
                    <td className="py-3 px-3.5 text-right">{actionBtn}</td>
                  </tr>
                );
              })}

              {requisitions.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className={`py-10 text-center ${subtextClass} text-xs`}
                  >
                    No stock requests found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

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
                      {onDirectToStockInventory && (
                        <button
                          type="button"
                          onClick={() => onDirectToStockInventory(arrangingReq, stagedItems)}
                          className="px-3.5 py-1.5 rounded-lg font-bold flex items-center gap-1.5 cursor-pointer bg-emerald-600 hover:bg-emerald-700 text-white transition shadow-xs text-xs"
                          title="Direct to Stock Inventory tab to select serial numbers from Head Office stock"
                        >
                          <Package className="w-3.5 h-3.5" />
                          <span>Direct to Stock Inventory to Select SN</span>
                        </button>
                      )}
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
                          <th className="py-3 px-3.5 w-12 text-center">#</th>
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
                          <th className="py-2.5 px-3.5 w-12 text-center">#</th>
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


import React, { useState, useMemo, useDeferredValue } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { WHILE_TAP_BUTTON } from '../utils/animationRules';
import {
  RightDrawerFrame,
  SIM_HEADER_CLS,
  SIM_ICON_BOX_CLS,
  SIM_HEADER_TAG_CLS,
  SIM_HEADER_SUBTAG_CLS,
  SIM_CLOSE_BTN_CLS,
  SIM_SUBHEADER_CLS,
  SIM_BODY_CLS,
  SIM_CARD_CLS,
  SIM_FOOTER_CLS,
  SIM_BTN_CANCEL_CLS,
  SIM_BTN_PRIMARY_CLS,
  simStepPillCls,
  simStepNumCls,
  getCachedDeviceBySerialMap,
} from './RightDrawerShell';
import {
  CreditCard, X, Check, Copy, ArrowRight, ArrowLeft, RefreshCw,
  Cpu, Volume2, AlertTriangle, Layers, Building2,
  Radio, Smartphone, AlertCircle, Sparkles,
  Pencil, ChevronDown, Search
} from 'lucide-react';
import { Branch, Device, User, UserRole } from '../types';
import { MaterialSerial, SerialStatus, SERIAL_STATUS_LABEL, placeName } from '../services/materialsService';
import { todayPP } from '../utils/time';

export interface ManageSimModalProps {
  sim: MaterialSerial | null;
  isOpen: boolean;
  onClose: () => void;
  branches: Branch[];
  users?: User[];
  devices?: Device[];
  role: UserRole;
  myBranch: string;
  onSave: (payload: {
    serial: string;
    newSerial?: string;
    status: SerialStatus;
    branchId: string;
    deviceSerial: string | null;
    mid: string | null;
    merchantName: string | null;
    staff: string | null;
    deployedDate: string | null;
    blockedWithCarrier: boolean;
    note: string | null;
  }) => Promise<void>;
}

const SIM_PRIMARY_STEPS: { value: SerialStatus; step: string; title: string; subtitle: string }[] = [
  { value: 'HQ_STOCK', step: '1', title: 'Available In Stock', subtitle: 'Head Office (100)' },
  { value: 'BRANCH_RESERVE', step: '2', title: 'Branch Reserve', subtitle: 'Ready on branch shelf' },
  { value: 'AT_MERCHANT', step: '3', title: 'Bundled with Device', subtitle: 'Follows Serial & MID' },
];
const SIM_OTHER_STATUSES: { value: SerialStatus; label: string }[] = [
  { value: 'IN_TRANSIT', label: 'In Transit' },
  { value: 'LOST', label: 'Lost / Missing' },
  { value: 'WRITTEN_OFF', label: 'Written Off' },
];
const SIM_STEP_LABEL: Record<SerialStatus, string> = {
  HQ_STOCK: 'Available In Stock',
  BRANCH_RESERVE: 'Branch Reserve',
  AT_MERCHANT: 'Bundled with Device (Live)',
  IN_TRANSIT: 'In Transit',
  LOST: 'Lost / Missing',
  FAULTY: 'Faulty',
  WRITTEN_OFF: 'Written Off',
};

const ManageSimModalComponent: React.FC<ManageSimModalProps> = ({
  sim,
  isOpen,
  onClose,
  branches,
  users: _users = [],
  devices = [],
  role,
  myBranch,
  onSave,
}) => {
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';

  // Fast O(1) WeakMap-cached Serial Map for instant lookups across 26,000+ devices (0ms on drawer open)
  const deviceBySerialMap = useMemo(() => getCachedDeviceBySerialMap(devices), [devices]);

  const initialDev = sim?.deviceSerial ? deviceBySerialMap.get(sim.deviceSerial.toUpperCase()) : null;

  // Step state
  const [step, setStep] = useState<'CONFIG' | 'REVIEW'>('CONFIG');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Form Fields initialized directly so frame 0 renders once without a post-mount useEffect double-render
  const [simSerial, setSimSerial] = useState(() => sim?.serial || '');
  const [isRenaming, setIsRenaming] = useState(false);
  const [newSerialInput, setNewSerialInput] = useState(() => sim?.serial || '');

  const [status, setStatus] = useState<SerialStatus>(() => sim?.status || 'BRANCH_RESERVE');
  const [branchId, setBranchId] = useState(() => sim?.branchId || (isAdmin ? '100' : myBranch));
  const [assignedDeviceSerial, setAssignedDeviceSerial] = useState<string>(() => sim?.deviceSerial || '');
  const [deviceSearch, setDeviceSearch] = useState('');

  const [staff, setStaff] = useState(
    () => initialDev?.staff || initialDev?.installedByStaff || sim?.updatedBy || '',
  );
  const [deployedDate, setDeployedDate] = useState(
    () => initialDev?.deployedDate || (sim?.status === 'AT_MERCHANT' ? todayPP() : ''),
  );
  const [merchantName, setMerchantName] = useState(() => sim?.merchantName || initialDev?.merchantName || '');
  const [mid, setMid] = useState(() => sim?.mid || initialDev?.mid || '');
  const [tid, setTid] = useState(() => initialDev?.tid || '');
  const [blockedWithCarrier, setBlockedWithCarrier] = useState(() => Boolean(sim?.blocked));
  const [note, setNote] = useState(() => sim?.note || '');

  // Synchronously sync state during render when a new SIM is opened (avoids frame-1 double render)
  const [syncedSimKey, setSyncedSimKey] = useState<string>(() =>
    sim && isOpen ? `${sim.serial}|${sim.status}|${sim.branchId}|${sim.deviceSerial || ''}` : '',
  );
  const currentSimKey = sim && isOpen ? `${sim.serial}|${sim.status}|${sim.branchId}|${sim.deviceSerial || ''}` : '';
  if (currentSimKey !== syncedSimKey) {
    setSyncedSimKey(currentSimKey);
    if (sim && isOpen) {
      const dev = sim.deviceSerial ? deviceBySerialMap.get(sim.deviceSerial.toUpperCase()) : null;
      setStep('CONFIG');
      setSaving(false);
      setErrorMsg('');
      setIsRenaming(false);
      setNewSerialInput(sim.serial);
      setSimSerial(sim.serial);
      setStatus(sim.status);
      setBranchId(sim.branchId || (isAdmin ? '100' : myBranch));
      setAssignedDeviceSerial(sim.deviceSerial || '');
      setMerchantName(sim.merchantName || dev?.merchantName || '');
      setMid(sim.mid || dev?.mid || '');
      setTid(dev?.tid || '');
      setStaff(dev?.staff || dev?.installedByStaff || sim.updatedBy || '');
      setDeployedDate(dev?.deployedDate || (sim.status === 'AT_MERCHANT' ? todayPP() : ''));
      setBlockedWithCarrier(Boolean(sim.blocked));
      setNote(sim.note || '');
      setDeviceSearch('');
    }
  }

  // Find assigned device in devices pool in O(1)
  const assignedDevice = useMemo(() => {
    if (!assignedDeviceSerial) return null;
    return deviceBySerialMap.get(assignedDeviceSerial.toUpperCase()) || null;
  }, [assignedDeviceSerial, deviceBySerialMap]);

  // Deferred search term to keep keyboard input at crisp 120fps
  const deferredSearch = useDeferredValue(deviceSearch);

  // Instant search by Serial or MID (returns top 10 matches only when user types)
  const matchedDevices = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return [];
    const results: Device[] = [];
    for (let i = 0; i < devices.length; i++) {
      const d = devices[i];
      if (!d) continue;
      if (d.serial.toLowerCase().includes(q) || (d.mid || '').toLowerCase().includes(q)) {
        results.push(d);
        if (results.length >= 10) break;
      }
    }
    return results;
  }, [devices, deferredSearch]);

  const handleSelectStep = (nextStatus: SerialStatus) => {
    setErrorMsg('');
    setStatus(nextStatus);
    if (nextStatus === 'HQ_STOCK') {
      setBranchId('100');
      setAssignedDeviceSerial('');
      setMerchantName('');
      setMid('');
      setTid('');
      setStaff('');
      setDeployedDate('');
    } else if (nextStatus === 'BRANCH_RESERVE') {
      if (branchId === '100' && myBranch && myBranch !== '100') {
        setBranchId(myBranch);
      }
      setAssignedDeviceSerial('');
      setMerchantName('');
      setMid('');
      setTid('');
      setStaff('');
      setDeployedDate('');
    } else if (nextStatus === 'LOST') {
      setBlockedWithCarrier(true);
    }
  };

  // When a user selects a device from dropdown, dynamically populate merchant and branch details
  const handleSelectDevice = (devSerial: string) => {
    setAssignedDeviceSerial(devSerial);
    if (!devSerial) {
      setMerchantName('');
      setMid('');
      setTid('');
      setStaff('');
      setDeployedDate('');
      if (status === 'AT_MERCHANT') {
        setStatus('BRANCH_RESERVE');
      }
      return;
    }

    const dev = deviceBySerialMap.get(devSerial.toUpperCase());
    if (dev) {
      if (dev.branchId) setBranchId(dev.branchId);
      setMerchantName(dev.merchantName || '');
      setMid(dev.mid || '');
      setTid(dev.tid || '');
      setStaff(dev.staff || dev.installedByStaff || '');
      setDeployedDate(dev.deployedDate || '');
      // A SIM paired with a device always follows the device
      setStatus('AT_MERCHANT');
    }
  };

  const handleCopySerial = () => {
    if (!simSerial) return;
    navigator.clipboard.writeText(simSerial).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleApplyRename = () => {
    const trimmed = newSerialInput.trim();
    if (!trimmed || trimmed.length < 3) {
      setErrorMsg('SIM number must be at least 3 characters.');
      return;
    }
    setSimSerial(trimmed);
    setIsRenaming(false);
    setErrorMsg('');
  };

  const handleQuickReturnHq = () => {
    setStatus('HQ_STOCK');
    setBranchId('100');
    setAssignedDeviceSerial('');
    setMerchantName('');
    setMid('');
    setTid('');
    setNote((prev) => (prev ? `${prev} | Returned to HQ Stock` : 'Returned to HQ Stock'));
  };

  const handleQuickBranchReserve = () => {
    setStatus('BRANCH_RESERVE');
    setAssignedDeviceSerial('');
    setMerchantName('');
    setMid('');
    setTid('');
    setNote((prev) => (prev ? `${prev} | Moved to Branch Reserve` : 'Moved to Branch Reserve'));
  };

  const handleQuickMarkLost = () => {
    setStatus('LOST');
    setBlockedWithCarrier(true);
    setNote((prev) => (prev ? `${prev} | Marked as Lost & Blocked` : 'Marked as Lost & Blocked'));
  };

  const handleProceedToReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (status === 'AT_MERCHANT' && !assignedDeviceSerial) {
      setErrorMsg('SIM cards cannot go live alone. Select a POS Terminal or Sound Box (Serial & MID) to bundle this SIM with.');
      return;
    }
    if ((status === 'LOST' || status === 'WRITTEN_OFF') && status !== sim?.status && note.trim().length < 3) {
      setErrorMsg(status === 'LOST' ? 'Write a remark for the lost SIM (what happened).' : 'Write the reason for the write-off.');
      return;
    }
    setErrorMsg('');
    setStep('REVIEW');
  };

  const handleConfirmSave = async () => {
    if (!sim) return;
    setSaving(true);
    setErrorMsg('');
    try {
      await onSave({
        serial: sim.serial,
        newSerial: simSerial !== sim.serial ? simSerial : undefined,
        status,
        branchId,
        deviceSerial: assignedDeviceSerial ? assignedDeviceSerial : null,
        mid: mid.trim() || null,
        merchantName: merchantName.trim() || null,
        staff: staff.trim() || null,
        deployedDate: deployedDate || null,
        blockedWithCarrier,
        note: note.trim() || null,
      });
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to update SIM card.');
    } finally {
      setSaving(false);
    }
  };

  const branchNameDisplay = placeName(branchId, branches);

  return (
    <AnimatePresence>
      {isOpen && sim ? (
      <RightDrawerFrame
        key="sim-drawer"
        onClose={onClose}
        zClass="z-50"
        busy={saving}
        ariaLabel={`Manage SIM Card ${simSerial}`}
      >
          {/* 1. NAVY HEADER BAR */}
          <div className={SIM_HEADER_CLS}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className={SIM_ICON_BOX_CLS}>
                  <CreditCard className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono text-base font-bold tracking-tight text-white truncate">
                      {simSerial}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopySerial}
                      className="p-1 rounded-md hover:bg-white/15 text-slate-300 hover:text-white transition cursor-pointer"
                      title="Copy SIM Number"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsRenaming((v) => !v);
                          setNewSerialInput(simSerial);
                        }}
                        className={`p-1 rounded-md transition cursor-pointer ${
                          isRenaming
                            ? 'bg-sky-400/25 text-sky-200'
                            : 'hover:bg-white/15 text-slate-300 hover:text-white'
                        }`}
                        title="Correct SIM Serial Number"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <span className={SIM_HEADER_TAG_CLS}>
                      SIM Card
                    </span>
                    <span className={SIM_HEADER_SUBTAG_CLS}>
                      {SIM_STEP_LABEL[status] || SERIAL_STATUS_LABEL[status]}
                    </span>
                  </div>
                  <p className="text-[11.5px] text-slate-200/85 truncate mt-0.5">
                    Custody: {branchNameDisplay} · {assignedDevice ? `${assignedDevice.type} (${assignedDevice.serial})` : 'Unassigned Pool'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className={SIM_CLOSE_BTN_CLS}
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Inline SIM Serial Number Correction (Toggled from Header Pencil Icon) */}
            {isAdmin && isRenaming && (
              <div className="mt-3 pt-2.5 border-t border-white/15 flex items-center gap-2">
                <span className="text-[11px] font-medium text-sky-200 shrink-0">Correct SIM:</span>
                <input
                  type="text"
                  value={newSerialInput}
                  onChange={(e) => setNewSerialInput(e.target.value)}
                  placeholder="Corrected SIM Number"
                  className="flex-1 min-w-0 px-2.5 py-1 rounded-lg bg-white/10 border border-white/20 text-xs font-mono font-bold text-white placeholder:text-slate-400 outline-none focus:border-sky-300"
                />
                <button
                  type="button"
                  onClick={handleApplyRename}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-sky-500 hover:bg-sky-400 text-slate-950 transition cursor-pointer shrink-0"
                >
                  Apply
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsRenaming(false);
                    setNewSerialInput(simSerial);
                  }}
                  className="px-2 py-1 rounded-lg text-[11px] font-medium text-slate-300 hover:bg-white/10 transition cursor-pointer shrink-0"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* 2. SUBHEADER STEPPER & QUICK LIFECYCLE BAR */}
          <div className={SIM_SUBHEADER_CLS}>
            <div className="flex items-center gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => setStep('CONFIG')}
                className={simStepPillCls(step === 'CONFIG')}
              >
                <span className={simStepNumCls(step === 'CONFIG')}>1</span>
                <span>Configure</span>
              </button>
              <ArrowRight className="w-3 h-3 text-slate-300" />
              <button
                type="button"
                onClick={() => setStep('REVIEW')}
                className={simStepPillCls(step === 'REVIEW')}
              >
                <span className={simStepNumCls(step === 'REVIEW')}>2</span>
                <span>Impact Review</span>
              </button>
            </div>

            {step === 'CONFIG' && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {isAdmin && (
                  <button
                    type="button"
                    onClick={handleQuickReturnHq}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200/80 transition cursor-pointer inline-flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3 text-amber-600" />
                    <span>Return to HQ Stock</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleQuickBranchReserve}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200/80 transition cursor-pointer inline-flex items-center gap-1"
                >
                  <Layers className="w-3 h-3 text-emerald-600" />
                  <span>Move to Reserve</span>
                </button>
                <button
                  type="button"
                  onClick={handleQuickMarkLost}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/80 transition cursor-pointer inline-flex items-center gap-1"
                >
                  <AlertTriangle className="w-3 h-3 text-rose-600" />
                  <span>Mark Lost</span>
                </button>
              </div>
            )}
          </div>

          {/* 3. ERROR ALERT */}
          {errorMsg && (
            <div className="mx-5 mt-3.5 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span className="flex-1">{errorMsg}</span>
            </div>
          )}

          {/* 4. MODAL CONTENT BODY */}
          <div className={SIM_BODY_CLS}>
            {step === 'CONFIG' ? (
              <form id="sim-manage-form" onSubmit={handleProceedToReview} className="space-y-3.5">
                {/* 1. 3-STEP SIM CONTROL */}
                <div className={SIM_CARD_CLS}>
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-700/60">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-[#155484] dark:text-sky-400" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                        1. Choose SIM Step
                      </h3>
                    </div>
                    <span className="text-[10.5px] text-slate-500">
                      Never goes live alone — follows paired device
                    </span>
                  </div>

                  {/* 3 Primary Step Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {SIM_PRIMARY_STEPS.map((item) => {
                      const active = status === item.value;
                      return (
                        <button
                          key={item.value}
                          type="button"
                          onClick={() => handleSelectStep(item.value)}
                          className={`text-left p-2.5 rounded-xl border transition cursor-pointer ${
                            active
                              ? 'bg-[#155484] text-white border-[#155484] shadow-xs'
                              : 'bg-slate-50/70 hover:bg-slate-100 text-slate-700 border-slate-200'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 mb-1">
                            <span
                              className={`w-4 h-4 rounded-full text-[10px] font-bold inline-flex items-center justify-center ${
                                active ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
                              }`}
                            >
                              {item.step}
                            </span>
                            <span className="text-[11.5px] font-bold leading-tight">{item.title}</span>
                          </div>
                          <p className={`text-[10.5px] leading-tight ${active ? 'text-sky-100' : 'text-slate-500'}`}>
                            {item.subtitle}
                          </p>
                        </button>
                      );
                    })}
                  </div>

                  {/* Secondary Exception Statuses */}
                  <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
                    <span className="text-[10.5px] font-medium text-slate-400">Other status:</span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {SIM_OTHER_STATUSES.map((opt) => {
                        const active = status === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => handleSelectStep(opt.value)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition cursor-pointer ${
                              active
                                ? 'bg-slate-800 text-white border-slate-800'
                                : 'bg-white hover:bg-slate-50 text-slate-500 border-slate-200'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Branch Custody (shown when not HQ_STOCK and not auto-locked to paired device) */}
                  {status !== 'HQ_STOCK' && status !== 'AT_MERCHANT' && (
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-700/60">
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                        Branch Custody <span className="text-rose-500">*</span>
                      </label>
                      <div className="relative">
                        <select
                          value={branchId}
                          onChange={(e) => setBranchId(e.target.value)}
                          disabled={!isAdmin && branchId !== myBranch}
                          className="w-full appearance-none pl-3 pr-8 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs font-medium text-slate-800 dark:text-slate-100 cursor-pointer outline-none focus:border-[#155484] focus:ring-2 focus:ring-[#155484]/10 transition-all disabled:bg-slate-100 disabled:text-slate-400"
                        >
                          <option value="100">100 · Head Office</option>
                          {branches
                            .filter((b) => b.id !== '100')
                            .map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.id} · {b.name}
                              </option>
                            ))}
                        </select>
                        <ChevronDown className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" />
                      </div>
                    </div>
                  )}

                  {status === 'HQ_STOCK' && (
                    <div className="px-3 py-2 rounded-xl bg-blue-50/70 border border-blue-200/80 text-[11px] text-[#155484] flex items-center gap-2">
                      <Building2 className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        <strong>Available In Stock (Head Office 100)</strong> — Unassigned and ready to be dispatched to any branch.
                      </span>
                    </div>
                  )}
                </div>

                {/* 2. BUNDLE WITH HARDWARE DEVICE (Only when Bundled / AT_MERCHANT, or quick-pair from Reserve) */}
                {(status === 'AT_MERCHANT' || status === 'BRANCH_RESERVE') && (
                  <div className="p-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 shadow-2xs space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-700/60">
                      <div className="flex items-center gap-2">
                        <Smartphone className="w-4 h-4 text-purple-600" />
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                          2. Bundle with Device (Serial &amp; MID)
                        </h3>
                      </div>
                      {assignedDevice && (
                        <button
                          type="button"
                          onClick={() => handleSelectDevice('')}
                          className="text-[11px] font-semibold text-rose-600 hover:text-rose-700 hover:underline cursor-pointer"
                        >
                          Unlink Device
                        </button>
                      )}
                    </div>

                    {/* Simple Search by Serial or MID */}
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={deviceSearch}
                        onChange={(e) => setDeviceSearch(e.target.value)}
                        aria-label="Search device by Serial or MID"
                        placeholder="Search by Serial Number or MID..."
                        className="w-full pl-9 pr-8 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900 text-xs font-mono outline-none focus:bg-white focus:border-[#155484] focus:ring-2 focus:ring-[#155484]/10 transition-all"
                      />
                      {deviceSearch && (
                        <button
                          type="button"
                          onClick={() => setDeviceSearch('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                          aria-label="Clear search"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Instant Search Results List (shown only while searching) */}
                    {deferredSearch.trim().length > 0 && (
                      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800 max-h-56 overflow-y-auto shadow-xs">
                        {matchedDevices.length === 0 ? (
                          <div className="px-3 py-3 text-xs text-slate-500 text-center">
                            No device found matching &ldquo;{deferredSearch.trim()}&rdquo;
                          </div>
                        ) : (
                          matchedDevices.map((d) => {
                            const selected = d.serial.toUpperCase() === assignedDeviceSerial.toUpperCase();
                            return (
                              <button
                                key={d.serial}
                                type="button"
                                onClick={() => {
                                  handleSelectDevice(d.serial);
                                  setDeviceSearch('');
                                }}
                                className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 transition cursor-pointer ${
                                  selected ? 'bg-sky-50 text-[#155484]' : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    {d.type === 'Sound Box' ? (
                                      <Volume2 className="w-3.5 h-3.5 text-[#4F518C] dark:text-[#a2a5e0] shrink-0" />
                                    ) : (
                                      <Cpu className="w-3.5 h-3.5 text-[#184e77] dark:text-[#5cc8ff] shrink-0" />
                                    )}
                                    <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">
                                      {d.serial}
                                    </span>
                                    {d.mid && (
                                      <span className="text-[11px] font-mono text-slate-500">
                                        · MID: {d.mid}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-slate-500 truncate mt-0.5">
                                    {d.merchantName || 'No merchant'} · {d.branchName || `Branch ${d.branchId}`}
                                  </p>
                                </div>
                                <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 shrink-0">
                                  {selected ? 'Bundled' : 'Select'}
                                </span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    )}

                    {/* Selected Device Live Detail Card (Follows Device Automatically) */}
                    {assignedDevice ? (
                      <div className="p-3 rounded-xl bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200/80 dark:border-sky-800 space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            {assignedDevice.type === 'Sound Box' ? (
                              <Volume2 className="w-4 h-4 text-[#4F518C] dark:text-[#a2a5e0]" />
                            ) : (
                              <Cpu className="w-4 h-4 text-[#184e77] dark:text-[#5cc8ff]" />
                            )}
                            <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">
                              {assignedDevice.serial}
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-white text-slate-800 border border-slate-200 shadow-2xs">
                              {assignedDevice.type}
                            </span>
                          </div>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                            Follows Device ({assignedDevice.stage})
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 dark:text-slate-300 pt-1.5 border-t border-sky-100 dark:border-sky-900/60">
                          <div>
                            <span className="text-slate-400 block text-[10px]">Merchant</span>
                            <span className="font-medium text-slate-900 dark:text-white truncate block">
                              {assignedDevice.merchantName || merchantName || '—'}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[10px]">MID / TID</span>
                            <span className="font-mono font-medium text-slate-900 dark:text-white truncate block">
                              {assignedDevice.mid || mid || '—'} {assignedDevice.tid || tid ? `(${assignedDevice.tid || tid})` : ''}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[10px]">Branch</span>
                            <span className="font-medium text-slate-800 dark:text-slate-200 truncate block">
                              {assignedDevice.branchName || placeName(assignedDevice.branchId, branches)}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[10px]">Assigned Staff</span>
                            <span className="font-medium text-slate-800 dark:text-slate-200 truncate block">
                              {assignedDevice.staff || assignedDevice.installedByStaff || staff || '—'}
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200/80 dark:border-slate-800 text-[11px] text-slate-500 flex items-center gap-2">
                        <Layers className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>
                          {status === 'AT_MERCHANT'
                            ? 'Select the POS Terminal or Sound Box above — Merchant, MID, Branch, and Staff follow it automatically.'
                            : 'Under Branch Reserve — pick a device above whenever you are ready to bundle it live.'}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* 3. CARRIER NETWORK & REMARKS */}
                <div className="p-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 shadow-2xs space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-700/60">
                    <div className="flex items-center gap-2">
                      <Radio className="w-4 h-4 text-sky-600" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                        {status === 'AT_MERCHANT' || status === 'BRANCH_RESERVE' ? '3. Carrier & Remarks' : '2. Carrier & Remarks'}
                      </h3>
                    </div>
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                        Blocked with Carrier
                      </span>
                      <input
                        type="checkbox"
                        checked={blockedWithCarrier}
                        onChange={(e) => setBlockedWithCarrier(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="relative w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#155484]"></div>
                    </label>
                  </div>

                  {blockedWithCarrier && (
                    <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>Warning: Line is recorded as inactive / blocked with carrier. Cannot serve merchants.</span>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      Operational Remarks / Audit Note{' '}
                      {status === 'LOST' || status === 'WRITTEN_OFF' ? (
                        <span className="text-rose-500">*</span>
                      ) : (
                        <span className="text-slate-400 font-normal">(Optional)</span>
                      )}
                    </label>
                    <input
                      type="text"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Add context or remarks regarding this SIM card update..."
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-100 outline-none focus:border-[#155484] focus:ring-2 focus:ring-[#155484]/10 transition-all"
                    />
                  </div>
                </div>
              </form>
            ) : (
              /* STEP 2: IMPACT REVIEW */
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-sky-50/80 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 flex items-start gap-3">
                  <Sparkles className="w-5 h-5 text-sky-700 dark:text-sky-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-sky-900 dark:text-sky-200 space-y-1">
                    <p className="font-bold">Dynamic Fleet Relative Synchronization</p>
                    <p className="text-[11.5px] leading-relaxed text-sky-800 dark:text-sky-300">
                      Confirming this update will save the SIM card record, dynamically update the assigned hardware unit (POS Terminal / Sound Box) in the fleet inventory, and recalculate branch material balances in real time.
                    </p>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xs space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 pb-2 border-b border-slate-100 dark:border-slate-700">
                    Configuration Change Summary
                  </h4>

                  <div className="overflow-x-auto overflow-y-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[10.5px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 dark:border-slate-700">
                          <th className="py-2">Attribute</th>
                          <th className="py-2">Previous Value</th>
                          <th className="py-2">Updated Value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        <tr>
                          <td className="py-2.5 font-medium text-slate-500">SIM Number</td>
                          <td className="py-2.5 font-mono text-slate-700 dark:text-slate-300">{sim.serial}</td>
                          <td className="py-2.5 font-mono font-bold text-[#155484] dark:text-sky-300">{simSerial}</td>
                        </tr>
                        <tr>
                          <td className="py-2.5 font-medium text-slate-500">Status Stage</td>
                          <td className="py-2.5 text-slate-700 dark:text-slate-300">{SERIAL_STATUS_LABEL[sim.status]}</td>
                          <td className="py-2.5 font-bold text-emerald-700 dark:text-emerald-400">
                            {SERIAL_STATUS_LABEL[status]}
                          </td>
                        </tr>
                        <tr>
                          <td className="py-2.5 font-medium text-slate-500">Branch Custody</td>
                          <td className="py-2.5 text-slate-700 dark:text-slate-300">{placeName(sim.branchId, branches)}</td>
                          <td className="py-2.5 font-bold text-slate-900 dark:text-white">{branchNameDisplay}</td>
                        </tr>
                        <tr>
                          <td className="py-2.5 font-medium text-slate-500">Assigned Hardware</td>
                          <td className="py-2.5 text-slate-700 dark:text-slate-300">{sim.deviceSerial || 'Unassigned'}</td>
                          <td className="py-2.5 font-bold text-[#4F518C] dark:text-[#a2a5e0]">
                            {assignedDeviceSerial ? `${assignedDevice?.type || 'Device'} (${assignedDeviceSerial})` : 'Unassigned (Pool)'}
                          </td>
                        </tr>
                        <tr>
                          <td className="py-2.5 font-medium text-slate-500">Merchant / MID</td>
                          <td className="py-2.5 text-slate-700 dark:text-slate-300">
                            {sim.merchantName || '—'} {sim.mid ? `(${sim.mid})` : ''}
                          </td>
                          <td className="py-2.5 font-medium text-slate-900 dark:text-white">
                            {merchantName || '—'} {mid ? `(${mid})` : ''}
                          </td>
                        </tr>
                        <tr>
                          <td className="py-2.5 font-medium text-slate-500">Carrier Status</td>
                          <td className="py-2.5 text-slate-700 dark:text-slate-300">{sim.blocked ? 'Blocked' : 'Active'}</td>
                          <td className="py-2.5 font-medium">
                            {blockedWithCarrier ? (
                              <span className="text-rose-600 font-bold">Blocked with Carrier</span>
                            ) : (
                              <span className="text-emerald-600 font-bold">Active Cellular Line</span>
                            )}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 5. MODAL FOOTER ACTIONS */}
          <div className={SIM_FOOTER_CLS}>
            {step === 'CONFIG' ? (
              <>
                <motion.button
                  whileTap={WHILE_TAP_BUTTON}
                  type="button"
                  onClick={onClose}
                  className={SIM_BTN_CANCEL_CLS}
                >
                  Cancel
                </motion.button>
                <motion.button
                  whileTap={WHILE_TAP_BUTTON}
                  type="submit"
                  form="sim-manage-form"
                  className={SIM_BTN_PRIMARY_CLS}
                >
                  <span>Review Impact</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </motion.button>
              </>
            ) : (
              <>
                <motion.button
                  whileTap={WHILE_TAP_BUTTON}
                  type="button"
                  onClick={() => setStep('CONFIG')}
                  disabled={saving}
                  className={`${SIM_BTN_CANCEL_CLS} flex items-center gap-1.5`}
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to Edit</span>
                </motion.button>
                <motion.button
                  whileTap={WHILE_TAP_BUTTON}
                  type="button"
                  onClick={handleConfirmSave}
                  disabled={saving}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving & Synchronizing...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Confirm & Synchronize All</span>
                    </>
                  )}
                </motion.button>
              </>
            )}
          </div>
      </RightDrawerFrame>
      ) : null}
    </AnimatePresence>
  );
};


export const ManageSimModal = React.memo(ManageSimModalComponent);

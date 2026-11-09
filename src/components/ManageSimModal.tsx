import React, { useState, useEffect, useMemo, useDeferredValue } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { DRAWER_VARIANTS, BACKDROP_VARIANTS, WHILE_TAP_BUTTON } from '../utils/animationRules';
import {
  CreditCard, X, Check, Copy, ArrowRight, ArrowLeft, RefreshCw,
  Cpu, Volume2, ShieldCheck, AlertTriangle, Layers, Building2,
  UserCheck, Store, Radio, Smartphone, AlertCircle, Sparkles
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

const LIFECYCLE_OPTIONS: { value: SerialStatus; label: string; desc: string }[] = [
  { value: 'HQ_STOCK', label: 'HQ Stock (Central Warehouse)', desc: 'Stored at Head Office central depot (Branch 100)' },
  { value: 'BRANCH_RESERVE', label: 'Branch Reserve', desc: 'Ready on branch shelf for merchant deployment' },
  { value: 'AT_MERCHANT', label: 'At Merchant (Live Deployment)', desc: 'Active in a merchant store paired with hardware' },
  { value: 'IN_TRANSIT', label: 'In Transit', desc: 'En route between Head Office and branch' },
  { value: 'LOST', label: 'Lost / Missing', desc: 'Reported lost or missing from store/branch' },
  { value: 'WRITTEN_OFF', label: 'Written Off', desc: 'Permanently decommissioned or retired' },
];

const ManageSimModalComponent: React.FC<ManageSimModalProps> = ({
  sim,
  isOpen,
  onClose,
  branches,
  users = [],
  devices = [],
  role,
  myBranch,
  onSave,
}) => {
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';

  // Step state
  const [step, setStep] = useState<'CONFIG' | 'REVIEW'>('CONFIG');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Form Fields
  const [simSerial, setSimSerial] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [newSerialInput, setNewSerialInput] = useState('');

  const [status, setStatus] = useState<SerialStatus>('BRANCH_RESERVE');
  const [branchId, setBranchId] = useState('100');
  const [assignedDeviceSerial, setAssignedDeviceSerial] = useState<string>('');
  const [deviceFilterType, setDeviceFilterType] = useState<'ALL' | 'POS' | 'SOUND_BOX'>('ALL');
  const [deviceSearch, setDeviceSearch] = useState('');

  const [staff, setStaff] = useState('');
  const [deployedDate, setDeployedDate] = useState('');
  const [merchantName, setMerchantName] = useState('');
  const [mid, setMid] = useState('');
  const [tid, setTid] = useState('');
  const [blockedWithCarrier, setBlockedWithCarrier] = useState(false);
  const [note, setNote] = useState('');

  // Find assigned device in devices pool
    // Fast O(1) Serial Map for instant lookups across 10,000+ devices
  const deviceBySerialMap = useMemo(() => {
    const map = new Map<string, Device>();
    for (let i = 0; i < devices.length; i++) {
      const d = devices[i];
      if (d && d.serial) {
        map.set(d.serial.toUpperCase(), d);
      }
    }
    return map;
  }, [devices]);

  // Find assigned device in devices pool in O(1)
  const assignedDevice = useMemo(() => {
    if (!assignedDeviceSerial) return null;
    return deviceBySerialMap.get(assignedDeviceSerial.toUpperCase()) || null;
  }, [assignedDeviceSerial, deviceBySerialMap]);

  // Deferred search term to keep keyboard input at crisp 120fps
  const deferredSearch = useDeferredValue(deviceSearch);

  // Available devices in branch/fleet (Optimized with early exit to keep render instant)
  const eligibleDevices = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    const results: Device[] = [];
    const maxMatches = 60;

    for (let i = 0; i < devices.length; i++) {
      const d = devices[i];
      if (deviceFilterType === 'POS' && d.type !== 'POS Terminal') continue;
      if (deviceFilterType === 'SOUND_BOX' && d.type !== 'Sound Box') continue;
      if (q) {
        const match =
          d.serial.toLowerCase().includes(q) ||
          (d.merchantName || '').toLowerCase().includes(q) ||
          (d.mid || '').toLowerCase().includes(q) ||
          (d.staff || '').toLowerCase().includes(q);
        if (!match) continue;
      }
      results.push(d);
      if (q && results.length >= maxMatches) break;
      if (!q && results.length >= 100) break;
    }
    return results;
  }, [devices, deviceFilterType, deferredSearch]);

  // Display devices ensuring current assignedDevice is always present
  const displayDevices = useMemo(() => {
    const maxShow = 60;
    const list = eligibleDevices.slice(0, maxShow);
    if (assignedDevice && !list.some((d) => d.serial.toUpperCase() === assignedDevice.serial.toUpperCase())) {
      list.unshift(assignedDevice);
    }
    return list;
  }, [eligibleDevices, assignedDevice]);

  // Filter branch users for datalist
  const branchUsers = useMemo(() => {
    return users
      .filter((u) => !branchId || branchId === '100' || u.branchId === branchId)
      .slice(0, 100);
  }, [users, branchId]);

  // Initialize state when modal opens with a SIM
  useEffect(() => {
    if (sim && isOpen) {
      setStep('CONFIG');
      setSaving(false);
      setErrorMsg('');
      setIsRenaming(false);
      setNewSerialInput(sim.serial);
      setSimSerial(sim.serial);
      setStatus(sim.status);
      setBranchId(sim.branchId || (isAdmin ? '100' : myBranch));
      setAssignedDeviceSerial(sim.deviceSerial || '');

      const dev = sim.deviceSerial ? deviceBySerialMap.get(sim.deviceSerial.toUpperCase()) : null;

      setMerchantName(sim.merchantName || dev?.merchantName || '');
      setMid(sim.mid || dev?.mid || '');
      setTid(dev?.tid || '');
      setStaff(dev?.staff || dev?.installedByStaff || sim.updatedBy || '');
      setDeployedDate(dev?.deployedDate || (sim.status === 'AT_MERCHANT' ? todayPP() : ''));
      setBlockedWithCarrier(Boolean(sim.blocked));
      setNote(sim.note || '');
    }
  }, [sim, isOpen, deviceBySerialMap, isAdmin, myBranch]);

  // When a user selects a device from dropdown, dynamically populate merchant and branch details
  const handleSelectDevice = (devSerial: string) => {
    setAssignedDeviceSerial(devSerial);
    if (!devSerial) {
      // Unassigned
      if (status === 'AT_MERCHANT') {
        setStatus('BRANCH_RESERVE');
      }
      return;
    }

    const dev = deviceBySerialMap.get(devSerial.toUpperCase());
    if (dev) {
      if (dev.branchId) setBranchId(dev.branchId);
      if (dev.merchantName) setMerchantName(dev.merchantName);
      if (dev.mid) setMid(dev.mid);
      if (dev.tid) setTid(dev.tid);
      if (dev.staff || dev.installedByStaff) setStaff(dev.staff || dev.installedByStaff || '');
      if (dev.deployedDate) setDeployedDate(dev.deployedDate);

      // Automatically upgrade status to AT_MERCHANT if device is active/complete or configuring
      if (dev.stage === 'COMPLETE' || dev.stage === 'CONFIGURING' || dev.mid) {
        setStatus('AT_MERCHANT');
      }
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
      setErrorMsg('Choose the unit (POS Terminal / Sound Box) this SIM is in: a SIM at a merchant goes into that merchant\'s kit.');
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

  if (!isOpen || !sim) return null;

  const branchNameDisplay = placeName(branchId, branches);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
        {/* Backdrop dismiss */}
        <motion.div
          variants={BACKDROP_VARIANTS}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs"
          onClick={onClose}
          aria-hidden
        />

        <motion.div
          variants={DRAWER_VARIANTS}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="relative w-full sm:max-w-[460px] md:max-w-[480px] bg-white dark:bg-slate-900 shadow-2xl z-10 flex flex-col h-full rounded-l-lg overflow-hidden"
        >
          {/* 1. NAVY HEADER BAR */}
          <div className="bg-[#003857] rounded-tl-lg text-white px-5 py-4 flex items-center justify-between shrink-0 shadow-sm border-b border-white/10">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 rounded-xl bg-white/10 text-[#5cc8ff] shrink-0 border border-white/10 shadow-xs">
                <CreditCard className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-base font-bold tracking-tight text-white truncate">
                    {simSerial}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopySerial}
                    className="p-1 rounded hover:bg-white/15 text-slate-300 hover:text-white transition cursor-pointer"
                    title="Copy SIM Number"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-200 border border-sky-400/30">
                    SIM Card
                  </span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/15 text-white">
                    {SERIAL_STATUS_LABEL[status]}
                  </span>
                </div>
                <p className="text-xs text-slate-300 truncate mt-0.5">
                  Custody: {branchNameDisplay} · {assignedDevice ? `${assignedDevice.type} (${assignedDevice.serial})` : 'Unassigned Pool'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 hover:text-white transition cursor-pointer"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* 2. SUBHEADER STEPPER & SAFEGUARD */}
          <div className="px-5 py-2.5 bg-slate-100 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0 text-xs gap-2 flex-wrap">
            <div className="flex items-center gap-2 font-semibold">
              <button
                type="button"
                onClick={() => setStep('CONFIG')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition ${
                  step === 'CONFIG'
                    ? 'bg-white dark:bg-slate-700 text-[#003857] dark:text-sky-300 shadow-2xs font-bold'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <span className="w-4 h-4 rounded-full bg-[#003857] text-white flex items-center justify-center text-[10px]">1</span>
                <span>Configure</span>
              </button>
              <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
              <button
                type="button"
                onClick={() => setStep('REVIEW')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition ${
                  step === 'REVIEW'
                    ? 'bg-white dark:bg-slate-700 text-[#003857] dark:text-sky-300 shadow-2xs font-bold'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <span className="w-4 h-4 rounded-full bg-slate-400 text-white flex items-center justify-center text-[10px]">2</span>
                <span>Impact Review</span>
              </button>
            </div>

            <div className="flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Relative Dynamic Sync Active</span>
            </div>
          </div>

          {/* 3. ERROR ALERT */}
          {errorMsg && (
            <div className="mx-5 mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span className="flex-1">{errorMsg}</span>
            </div>
          )}

          {/* 4. MODAL CONTENT BODY */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {step === 'CONFIG' ? (
              <form id="sim-manage-form" onSubmit={handleProceedToReview} className="space-y-4">
                {/* QUICK LIFECYCLE ACTIONS BAR */}
                <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/90 dark:border-slate-800 flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Quick Lifecycle Shortcuts
                  </span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={handleQuickReturnHq}
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-100 transition cursor-pointer flex items-center gap-1"
                      >
                        <RefreshCw className="w-3 h-3 text-sky-600" />
                        <span>Return to HQ Stock</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleQuickBranchReserve}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-100 transition cursor-pointer flex items-center gap-1"
                    >
                      <Layers className="w-3 h-3 text-emerald-600" />
                      <span>Move to Reserve</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleQuickMarkLost}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition cursor-pointer flex items-center gap-1"
                    >
                      <AlertTriangle className="w-3 h-3 text-rose-600" />
                      <span>Mark Lost</span>
                    </button>
                  </div>
                </div>

                {/* SIM SERIAL NUMBER CORRECTION (ADMIN ONLY) */}
                {isAdmin && (
                  <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xs space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CreditCard className="w-4 h-4 text-sky-600" />
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                          SIM Serial Number Correction
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">Typo correction for Super Admin / Admin</span>
                    </div>

                    {isRenaming ? (
                      <div className="flex items-center gap-2 mt-1">
                        <input
                          type="text"
                          value={newSerialInput}
                          onChange={(e) => setNewSerialInput(e.target.value)}
                          placeholder="Corrected SIM Number"
                          className="flex-1 px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs font-mono font-bold text-slate-900 dark:text-white outline-none focus:border-[#003857]"
                        />
                        <button
                          type="button"
                          onClick={handleApplyRename}
                          className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#003857] text-white hover:bg-[#002b43] transition cursor-pointer"
                        >
                          Apply
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsRenaming(false);
                            setNewSerialInput(simSerial);
                          }}
                          className="px-2.5 py-1.5 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between pt-1">
                        <span className="font-mono text-sm font-bold text-slate-800 dark:text-slate-100">
                          {simSerial}
                        </span>
                        <button
                          type="button"
                          onClick={() => setIsRenaming(true)}
                          className="text-xs font-semibold text-sky-700 hover:text-sky-800 hover:underline cursor-pointer"
                        >
                          Change / Correct Number
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* 1. LIFECYCLE & BRANCH CUSTODY */}
                <div className="p-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xs space-y-3">
                  <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-700/60">
                    <Building2 className="w-4 h-4 text-[#003857] dark:text-sky-400" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                      1. Lifecycle & Branch Custody
                    </h3>
                  </div>

                  <div className="grid grid-cols-1 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Lifecycle Status Stage <span className="text-rose-500">*</span>
                      </label>
                      <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value as SerialStatus)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs font-medium text-slate-800 dark:text-slate-100 cursor-pointer outline-none focus:border-[#003857]"
                      >
                        {LIFECYCLE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <p className="text-[10.5px] text-slate-500 mt-1">
                        {LIFECYCLE_OPTIONS.find((o) => o.value === status)?.desc}
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Assigned Branch Custody <span className="text-rose-500">*</span>
                      </label>
                      <select
                        value={branchId}
                        onChange={(e) => setBranchId(e.target.value)}
                        disabled={!isAdmin && branchId !== myBranch}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs font-medium text-slate-800 dark:text-slate-100 cursor-pointer outline-none focus:border-[#003857] disabled:bg-slate-100 disabled:text-slate-400"
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
                      <p className="text-[10.5px] text-slate-500 mt-1">
                        Physical custody location for stock accounting.
                      </p>
                    </div>
                  </div>
                </div>

                {/* 2. ASSIGNED HARDWARE DEVICE & LINKAGE */}
                <div className="p-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xs space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-700/60">
                    <div className="flex items-center gap-2">
                      <Smartphone className="w-4 h-4 text-purple-600" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                        2. Assigned Hardware Device (Relative Link)
                      </h3>
                    </div>
                    <span className="text-[10.5px] font-semibold text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/50 px-2 py-0.5 rounded-full border border-purple-200 dark:border-purple-800">
                      Auto-Syncs Hardware Fleet
                    </span>
                  </div>

                  {/* Device Type Filters & Search */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-900 rounded-lg text-xs">
                      <button
                        type="button"
                        onClick={() => setDeviceFilterType('ALL')}
                        className={`px-2 py-1 rounded-md transition font-medium cursor-pointer ${
                          deviceFilterType === 'ALL'
                            ? 'bg-[#003857] text-white shadow-2xs font-bold'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeviceFilterType('POS')}
                        className={`px-2 py-1 rounded-md transition font-medium cursor-pointer flex items-center gap-1 ${
                          deviceFilterType === 'POS'
                            ? 'bg-[#003857] text-white shadow-2xs font-bold'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        <Cpu className="w-3 h-3" />
                        <span>POS</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeviceFilterType('SOUND_BOX')}
                        className={`px-2 py-1 rounded-md transition font-medium cursor-pointer flex items-center gap-1 ${
                          deviceFilterType === 'SOUND_BOX'
                            ? 'bg-[#003857] text-white shadow-2xs font-bold'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        <Volume2 className="w-3 h-3" />
                        <span>Sound Box</span>
                      </button>
                    </div>

                    <input
                      type="text"
                      value={deviceSearch}
                      onChange={(e) => setDeviceSearch(e.target.value)}
                      placeholder="Search device serial, merchant, MID..."
                      className="flex-1 min-w-[170px] px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs outline-none focus:border-[#003857]"
                    />
                  </div>

                  {/* Device Dropdown Selector */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Choose Device to Assign
                      </label>
                      {eligibleDevices.length > 0 && (
                        <span className="text-[10px] text-slate-400 font-mono">
                          {eligibleDevices.length >= 60 ? 'Showing top 60 matches' : `${eligibleDevices.length} available`}
                        </span>
                      )}
                    </div>
                    <select
                      value={assignedDeviceSerial}
                      onChange={(e) => handleSelectDevice(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs font-mono font-medium text-slate-800 dark:text-slate-100 cursor-pointer outline-none focus:border-[#003857]"
                    >
                      <option value="">-- Unassigned (Available Pool / No Device) --</option>
                      {displayDevices.map((d) => (
                        <option key={d.serial} value={d.serial}>
                          [{d.type === 'Sound Box' ? 'SB' : 'POS'}] {d.serial} {d.merchantName ? `· ${d.merchantName}` : ''} {d.mid ? `(MID: ${d.mid})` : ''} · {d.branchName || 'Branch ' + d.branchId}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Selected Device Live Detail Card */}
                  {assignedDevice ? (
                    <div className="p-3 rounded-xl bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200/80 dark:border-sky-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {assignedDevice.type === 'Sound Box' ? (
                            <Volume2 className="w-4 h-4 text-purple-600" />
                          ) : (
                            <Cpu className="w-4 h-4 text-sky-600" />
                          )}
                          <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">
                            {assignedDevice.serial}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-white text-slate-800 border border-slate-200 shadow-2xs">
                            {assignedDevice.type}
                          </span>
                        </div>
                        <span className="text-[10px] font-bold text-sky-800 dark:text-sky-300 uppercase tracking-wider">
                          Stage: {assignedDevice.stage}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 dark:text-slate-300 pt-1 border-t border-sky-100 dark:border-sky-900/60">
                        <div>
                          <span className="text-slate-400 block text-[10px]">Merchant</span>
                          <span className="font-medium text-slate-900 dark:text-white truncate block">
                            {assignedDevice.merchantName || '—'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px]">MID / TID</span>
                          <span className="font-mono font-medium text-slate-900 dark:text-white truncate block">
                            {assignedDevice.mid || '—'} {assignedDevice.tid ? `(${assignedDevice.tid})` : ''}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px]">Servicing Branch</span>
                          <span className="font-medium text-slate-800 dark:text-slate-200 truncate block">
                            {assignedDevice.branchName || placeName(assignedDevice.branchId, branches)}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px]">Assigned Staff</span>
                          <span className="font-medium text-slate-800 dark:text-slate-200 truncate block">
                            {assignedDevice.staff || assignedDevice.installedByStaff || '—'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 text-[11.5px] text-slate-500 flex items-center gap-2">
                      <Layers className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>
                        This SIM card is in the <strong>Available Pool</strong>. It can be dynamically assigned to any POS Terminal or Sound Box.
                      </span>
                    </div>
                  )}
                </div>

                {/* 3. FIELD STAFF & DEPLOYMENT SCHEDULE */}
                <div className="p-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xs space-y-3">
                  <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-700/60">
                    <UserCheck className="w-4 h-4 text-emerald-600" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                      3. Field Staff & Deployment Schedule
                    </h3>
                  </div>

                  <div className="grid grid-cols-1 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Assigned Branch Staff Officer
                      </label>
                      <input
                        type="text"
                        list="sim-branch-staff-list"
                        value={staff}
                        onChange={(e) => setStaff(e.target.value)}
                        placeholder="e.g. SOK Dara (33105)"
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-100 outline-none focus:border-[#003857]"
                      />
                      <datalist id="sim-branch-staff-list">
                        {branchUsers.map((u) => (
                          <option key={u.empId || u.name} value={`${u.name} (${u.empId})`} />
                        ))}
                      </datalist>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Installation / Deployment Date
                      </label>
                      <div className="relative">
                        <input
                          type="date"
                          value={deployedDate}
                          onChange={(e) => setDeployedDate(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs font-mono text-slate-800 dark:text-slate-100 outline-none focus:border-[#003857]"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 4. MERCHANT & TERMINAL SETUP */}
                <div className="p-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xs space-y-3">
                  <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-700/60">
                    <Store className="w-4 h-4 text-amber-600" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                      4. Merchant & Terminal Setup
                    </h3>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Merchant Name
                      </label>
                      <input
                        type="text"
                        value={merchantName}
                        onChange={(e) => setMerchantName(e.target.value)}
                        placeholder="e.g. Lucky Mart / Heng Heng Coffee"
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-100 outline-none focus:border-[#003857]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        MID (Merchant ID)
                      </label>
                      <input
                        type="text"
                        value={mid}
                        onChange={(e) => setMid(e.target.value)}
                        placeholder="e.g. 200100000000001"
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs font-mono text-slate-800 dark:text-slate-100 outline-none focus:border-[#003857]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Terminal ID (TID)
                      </label>
                      <input
                        type="text"
                        value={tid}
                        onChange={(e) => setTid(e.target.value)}
                        placeholder="e.g. 12321323"
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs font-mono text-slate-800 dark:text-slate-100 outline-none focus:border-[#003857]"
                      />
                    </div>
                  </div>
                </div>

                {/* 5. CARRIER SECURITY & REMARKS */}
                <div className="p-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xs space-y-3">
                  <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-700/60">
                    <Radio className="w-4 h-4 text-sky-600" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                      5. Carrier Network & Operational Remarks
                    </h3>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <div>
                      <span className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                        Blocked with Telecom Carrier
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Flag cellular SIM as disabled/blocked by telecom provider (Smart, Cellcard, Metfone)
                      </span>
                    </div>

                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={blockedWithCarrier}
                        onChange={(e) => setBlockedWithCarrier(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-10 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#003857]"></div>
                    </label>
                  </div>

                  {blockedWithCarrier && (
                    <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>Warning: Line is recorded as inactive / blocked with carrier. Cannot serve merchants.</span>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Operational Remarks / Audit Log Note
                    </label>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={2}
                      placeholder="Add any specific context or remarks regarding this SIM card update..."
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-100 outline-none focus:border-[#003857]"
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

                  <div className="overflow-x-auto">
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
                          <td className="py-2.5 font-mono font-bold text-[#003857] dark:text-sky-300">{simSerial}</td>
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
                          <td className="py-2.5 font-bold text-purple-700 dark:text-purple-400">
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
          <div className="p-4 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
            {step === 'CONFIG' ? (
              <>
                <motion.button
                  whileTap={WHILE_TAP_BUTTON}
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition cursor-pointer"
                >
                  Cancel
                </motion.button>
                <motion.button
                  whileTap={WHILE_TAP_BUTTON}
                  type="submit"
                  form="sim-manage-form"
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-[#003857] hover:bg-[#002b43] text-white shadow-xs transition flex items-center gap-1.5 cursor-pointer"
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
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition cursor-pointer flex items-center gap-1.5"
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
        </motion.div>
      </div>
    </AnimatePresence>
  );
};


export const ManageSimModal = React.memo(ManageSimModalComponent);

import React, { useState, useEffect, useMemo, useDeferredValue } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { DRAWER_VARIANTS, BACKDROP_VARIANTS, WHILE_TAP_BUTTON } from '../utils/animationRules';
import {
  Boxes, Battery, Plug, Smartphone, Dock, X, Check, Copy, ArrowRight, ArrowLeft,
  RefreshCw, Cpu, Volume2, AlertTriangle, Layers, Building2, AlertCircle, Search
} from 'lucide-react';
import { Branch, Device, UserRole } from '../types';
import { MaterialSerial, SerialStatus, materialByCode, materialName, placeName } from '../services/materialsService';

export interface ManageMaterialModalProps {
  item: MaterialSerial | null;
  isOpen: boolean;
  onClose: () => void;
  branches: Branch[];
  devices?: Device[];
  role: UserRole;
  myBranch: string;
  onSave: (payload: {
    item: MaterialSerial;
    status: SerialStatus;
    branchId: string;
    deviceSerial: string | null;
    note: string | null;
  }) => Promise<void>;
}

const MATERIAL_PRIMARY_STEPS: { value: SerialStatus; step: string; title: string; subtitle: string }[] = [
  { value: 'HQ_STOCK', step: '1', title: 'Available In Stock', subtitle: 'Head Office (100)' },
  { value: 'BRANCH_RESERVE', step: '2', title: 'Branch Reserve', subtitle: 'Ready on branch shelf' },
  { value: 'AT_MERCHANT', step: '3', title: 'Bundled with Device', subtitle: 'Follows Serial & MID' },
];

const MATERIAL_OTHER_STATUSES: { value: SerialStatus; label: string }[] = [
  { value: 'IN_TRANSIT', label: 'In Transit' },
  { value: 'LOST', label: 'Lost / Missing' },
  { value: 'WRITTEN_OFF', label: 'Written Off' },
];

const MATERIAL_STEP_LABEL: Record<SerialStatus, string> = {
  HQ_STOCK: 'Available In Stock',
  BRANCH_RESERVE: 'Branch Reserve',
  AT_MERCHANT: 'Bundled with Device (Live)',
  IN_TRANSIT: 'In Transit',
  LOST: 'Lost / Missing',
  FAULTY: 'Faulty',
  WRITTEN_OFF: 'Written Off',
};

const ManageMaterialModalComponent: React.FC<ManageMaterialModalProps> = ({
  item,
  isOpen,
  onClose,
  branches,
  devices = [],
  role,
  myBranch,
  onSave,
}) => {
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';

  const [step, setStep] = useState<'CONFIG' | 'REVIEW'>('CONFIG');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [status, setStatus] = useState<SerialStatus>('BRANCH_RESERVE');
  const [branchId, setBranchId] = useState('100');
  const [assignedDeviceSerial, setAssignedDeviceSerial] = useState('');
  const [deviceSearch, setDeviceSearch] = useState('');
  const [note, setNote] = useState('');

  const meta = item ? materialByCode.get(item.code) : undefined;
  const targetDeviceType = meta?.deviceType === 'SB' ? 'Sound Box' : meta?.deviceType === 'POS' ? 'POS Terminal' : null;

  const deviceBySerialMap = useMemo(() => {
    const map = new Map<string, Device>();
    for (let i = 0; i < devices.length; i++) {
      const d = devices[i];
      map.set(d.serial.toUpperCase(), d);
    }
    return map;
  }, [devices]);

  const assignedDevice = useMemo(
    () => (assignedDeviceSerial ? deviceBySerialMap.get(assignedDeviceSerial.toUpperCase()) : undefined),
    [deviceBySerialMap, assignedDeviceSerial],
  );

  useEffect(() => {
    if (item && isOpen) {
      setStep('CONFIG');
      setErrorMsg('');
      setStatus(item.status);
      setBranchId(item.branchId || myBranch || '100');
      setAssignedDeviceSerial(item.deviceSerial || '');
      setDeviceSearch('');
      setNote(item.note || '');
    }
  }, [item, isOpen, myBranch]);

  const deferredSearch = useDeferredValue(deviceSearch);
  const matchedDevices = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return [];
    const results: Device[] = [];
    for (let i = 0; i < devices.length; i++) {
      const d = devices[i];
      if (targetDeviceType && d.type !== targetDeviceType) continue;
      if (
        d.serial.toLowerCase().includes(q) ||
        (d.mid && d.mid.toLowerCase().includes(q))
      ) {
        results.push(d);
        if (results.length >= 10) break;
      }
    }
    return results;
  }, [devices, deferredSearch, targetDeviceType]);

  const handleSelectDevice = (serial: string) => {
    setAssignedDeviceSerial(serial);
    setDeviceSearch('');
    if (!serial) {
      if (status === 'AT_MERCHANT') setStatus('BRANCH_RESERVE');
      return;
    }
    const dev = deviceBySerialMap.get(serial.toUpperCase());
    if (dev) {
      setStatus('AT_MERCHANT');
      setBranchId(dev.branchId || branchId);
    }
  };

  const applyQuickAction = (action: 'RETURN_HQ' | 'MOVE_RESERVE' | 'MARK_LOST') => {
    if (action === 'RETURN_HQ') {
      setStatus('HQ_STOCK');
      setBranchId('100');
      setAssignedDeviceSerial('');
    } else if (action === 'MOVE_RESERVE') {
      setStatus('BRANCH_RESERVE');
      if (branchId === '100' && myBranch && myBranch !== '100') {
        setBranchId(myBranch);
      }
      setAssignedDeviceSerial('');
    } else if (action === 'MARK_LOST') {
      setStatus('LOST');
    }
  };

  const handleCopy = () => {
    if (!item) return;
    navigator.clipboard?.writeText(item.serial);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const validateAndProceed = () => {
    setErrorMsg('');
    if (status === 'AT_MERCHANT' && !assignedDeviceSerial) {
      setErrorMsg('Please select a device by Serial Number or MID before bundling.');
      return;
    }
    if ((status === 'LOST' || status === 'WRITTEN_OFF') && (!note || note.trim().length < 3)) {
      setErrorMsg('Please provide a remark (at least 3 characters) when marking Lost or Written Off.');
      return;
    }
    setStep('REVIEW');
  };

  const handleSave = async () => {
    if (!item) return;
    setSaving(true);
    setErrorMsg('');
    try {
      await onSave({
        item,
        status,
        branchId: status === 'HQ_STOCK' ? '100' : branchId,
        deviceSerial: assignedDeviceSerial || null,
        note: note.trim() || null,
      });
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(msg || 'Failed to update material item.');
    } finally {
      setSaving(false);
    }
  };

  const MaterialIcon =
    item?.code === 'BATTERY' ? Battery :
    item?.code === 'STAND' ? Smartphone :
    item?.code === 'DOCK' ? Dock :
    item?.code === 'POS_ADAPTOR' || item?.code === 'SB_ADAPTOR' ? Plug :
    Boxes;

  const branchLabel = placeName(branchId, branches);

  return (
    <AnimatePresence>
      {isOpen && item && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <motion.div
            variants={BACKDROP_VARIANTS}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={onClose}
            className="fixed inset-0 bg-slate-900/55 will-change-[opacity]"
          />

          <motion.aside
            variants={DRAWER_VARIANTS}
            initial="hidden"
            animate="visible"
            exit="exit"
            role="dialog"
            aria-modal="true"
            aria-label={`Manage ${materialName(item.code)} ${item.serial}`}
            className="relative z-10 w-full max-w-xl bg-white dark:bg-slate-900 h-full shadow-2xl border-l border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden transform-gpu will-change-transform"
          >
            {/* Dark Navy Header */}
            <div className="bg-[#003857] text-white px-5 py-4 flex items-start justify-between gap-3 shrink-0">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center shrink-0">
                  <MaterialIcon className="w-5 h-5 text-white" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-bold text-base tracking-tight truncate">{item.serial}</span>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="p-1 rounded-md hover:bg-white/15 text-white/80 hover:text-white transition cursor-pointer"
                      title="Copy identifier"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                    <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-white/15 border border-white/20">
                      {materialName(item.code)}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-sky-400/20 text-sky-100 border border-sky-300/30">
                      {MATERIAL_STEP_LABEL[status]}
                    </span>
                  </div>
                  <p className="text-xs text-slate-200 mt-1 truncate">
                    Custody: {branchLabel} · {assignedDevice ? `${assignedDevice.type} (${assignedDevice.serial})` : 'Unassigned Pool'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Stepper Header */}
            <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2 text-xs shrink-0">
              <div className="flex items-center gap-2 font-semibold">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${step === 'CONFIG' ? 'bg-[#003857] text-white' : 'bg-emerald-50 text-emerald-700'}`}>
                  <span>1</span> Configure
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${step === 'REVIEW' ? 'bg-[#003857] text-white' : 'bg-slate-200/70 text-slate-600'}`}>
                  <span>2</span> Impact Review
                </span>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50/40">
              {errorMsg && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {step === 'CONFIG' ? (
                <>
                  {/* Quick Lifecycle Shortcuts */}
                  {isAdmin && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => applyQuickAction('RETURN_HQ')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 transition cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" /> Return to HQ Stock
                      </button>
                      <button
                        type="button"
                        onClick={() => applyQuickAction('MOVE_RESERVE')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 transition cursor-pointer"
                      >
                        <Layers className="w-3.5 h-3.5" /> Move to Reserve
                      </button>
                      <button
                        type="button"
                        onClick={() => applyQuickAction('MARK_LOST')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition cursor-pointer"
                      >
                        <AlertTriangle className="w-3.5 h-3.5" /> Mark Lost
                      </button>
                    </div>
                  )}

                  {/* 1. Choose Material Step */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-2xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-slate-800">
                        <Building2 className="w-4 h-4 text-[#003857]" />
                        <span>1. Choose Material Step</span>
                      </div>
                      <span className="text-[11px] text-slate-500">Follows paired device & MID</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {MATERIAL_PRIMARY_STEPS.map((s) => {
                        const active = status === s.value;
                        return (
                          <button
                            key={s.value}
                            type="button"
                            disabled={!isAdmin}
                            onClick={() => {
                              setStatus(s.value);
                              if (s.value === 'HQ_STOCK') {
                                setBranchId('100');
                                setAssignedDeviceSerial('');
                              } else if (s.value === 'BRANCH_RESERVE') {
                                setAssignedDeviceSerial('');
                              }
                            }}
                            className={`text-left p-3 rounded-xl border transition cursor-pointer ${
                              active
                                ? 'bg-[#003857] text-white border-[#003857] shadow-xs'
                                : 'bg-slate-50/70 hover:bg-slate-100/80 text-slate-800 border-slate-200'
                            }`}
                          >
                            <div className="flex items-center gap-1.5">
                              <span className={`w-4 h-4 rounded-full text-[10px] font-bold inline-flex items-center justify-center ${
                                active ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
                              }`}>{s.step}</span>
                              <span className="text-xs font-bold">{s.title}</span>
                            </div>
                            <div className={`text-[11px] mt-1 ${active ? 'text-slate-200' : 'text-slate-500'}`}>
                              {s.subtitle}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                      <span className="text-[11px] text-slate-500">Other status:</span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {MATERIAL_OTHER_STATUSES.map((o) => {
                          const active = status === o.value;
                          return (
                            <button
                              key={o.value}
                              type="button"
                              disabled={!isAdmin}
                              onClick={() => setStatus(o.value)}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition cursor-pointer ${
                                active
                                  ? 'bg-slate-800 text-white border-slate-800'
                                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                              }`}
                            >
                              {o.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {status === 'BRANCH_RESERVE' && (
                      <div className="pt-2">
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          Assigned Branch Custody
                        </label>
                        <select
                          value={branchId}
                          disabled={!isAdmin}
                          onChange={(e) => setBranchId(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 bg-white text-slate-800 outline-none focus:border-[#003857]"
                        >
                          <option value="100">100 · Head Office</option>
                          {branches
                            .filter((b) => b.id !== '100' && b.code !== '100')
                            .map((b) => (
                              <option key={b.code || b.id} value={b.code || b.id}>
                                {b.code || b.id} · {b.name}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* 2. Bundle with Device (Serial & MID) — Simple Search Only */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-2xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-slate-800">
                        <Smartphone className="w-4 h-4 text-[#003857]" />
                        <span>2. Bundle with Device (Serial & MID)</span>
                      </div>
                    </div>

                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={deviceSearch}
                        onChange={(e) => setDeviceSearch(e.target.value)}
                        placeholder="Search by Serial Number or MID..."
                        aria-label="Search device by Serial or MID"
                        disabled={!isAdmin}
                        className="w-full pl-9 pr-8 py-2 rounded-xl text-xs font-semibold border border-slate-200 bg-white text-slate-800 placeholder:text-slate-400 focus:border-[#003857] outline-none transition"
                      />
                      {deviceSearch && (
                        <button
                          type="button"
                          onClick={() => setDeviceSearch('')}
                          aria-label="Clear search"
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {deferredSearch.trim() && (
                      <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-52 overflow-y-auto">
                        {matchedDevices.length === 0 ? (
                          <div className="px-3 py-3 text-xs text-slate-500 text-center">
                            No matching {targetDeviceType || 'device'} found for "{deferredSearch}".
                          </div>
                        ) : (
                          matchedDevices.map((d) => {
                            const selected = d.serial.toUpperCase() === assignedDeviceSerial.toUpperCase();
                            return (
                              <button
                                key={d.serial}
                                type="button"
                                onClick={() => handleSelectDevice(d.serial)}
                                className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-xs transition cursor-pointer ${
                                  selected ? 'bg-sky-50 text-[#003857] font-semibold' : 'hover:bg-slate-50 text-slate-700'
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className="font-mono font-bold text-slate-900 truncate">
                                    {d.type === 'Sound Box' ? '[SB]' : '[POS]'} {d.serial}
                                  </div>
                                  <div className="text-[11px] text-slate-500 truncate">
                                    {d.merchantName || 'Unassigned Merchant'} {d.mid ? `· MID: ${d.mid}` : ''} · {d.branchName || placeName(d.branchId, branches)}
                                  </div>
                                </div>
                                <span className="text-[11px] font-bold text-[#003857] shrink-0">
                                  {selected ? 'Selected' : 'Select'}
                                </span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    )}

                    {assignedDevice ? (
                      <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200 flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                            {assignedDevice.type === 'Sound Box' ? <Volume2 className="w-4 h-4" /> : <Cpu className="w-4 h-4" />}
                          </div>
                          <div className="min-w-0 text-xs">
                            <div className="font-mono font-bold text-slate-900 truncate">
                              {assignedDevice.type} · {assignedDevice.serial}
                            </div>
                            <div className="text-slate-600 truncate">
                              {assignedDevice.merchantName || 'Branch Unit'} {assignedDevice.mid ? `· MID: ${assignedDevice.mid}` : ''}
                            </div>
                            <div className="text-[11px] text-slate-500 truncate">
                              {assignedDevice.branchName || placeName(assignedDevice.branchId, branches)}
                            </div>
                          </div>
                        </div>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => handleSelectDevice('')}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-white border border-emerald-200 text-rose-700 hover:bg-rose-50 transition cursor-pointer shrink-0"
                          >
                            Unlink Device
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
                        Not bundled with a device yet. Search by <b>Serial Number</b> or <b>MID</b> above to link it.
                      </div>
                    )}
                  </div>

                  {/* 3. Remark */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2 shadow-2xs">
                    <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-800">
                      3. Movement / Action Remark
                    </label>
                    <input
                      type="text"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Optional note or reason for change..."
                      disabled={!isAdmin}
                      className="w-full px-3 py-2 rounded-xl text-xs font-medium border border-slate-200 bg-white text-slate-800 placeholder:text-slate-400 focus:border-[#003857] outline-none"
                    />
                  </div>
                </>
              ) : (
                /* Impact Review Step */
                <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-2xs text-xs">
                  <h3 className="font-extrabold text-sm text-slate-900">Confirm Material Update</h3>
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                    <div className="px-3.5 py-2.5 flex justify-between gap-3">
                      <span className="text-slate-500">Material & Identifier</span>
                      <span className="font-mono font-bold text-slate-900">{materialName(item.code)} · {item.serial}</span>
                    </div>
                    <div className="px-3.5 py-2.5 flex justify-between gap-3">
                      <span className="text-slate-500">New Lifecycle Step</span>
                      <span className="font-bold text-[#003857]">{MATERIAL_STEP_LABEL[status]}</span>
                    </div>
                    <div className="px-3.5 py-2.5 flex justify-between gap-3">
                      <span className="text-slate-500">Branch Custody</span>
                      <span className="font-semibold text-slate-800">{status === 'HQ_STOCK' ? 'Head Office (100)' : branchLabel}</span>
                    </div>
                    <div className="px-3.5 py-2.5 flex justify-between gap-3">
                      <span className="text-slate-500">Bundled Device</span>
                      <span className="font-mono font-semibold text-slate-800">
                        {assignedDevice ? `${assignedDevice.serial}${assignedDevice.mid ? ` (MID: ${assignedDevice.mid})` : ''}` : 'None (Unassigned)'}
                      </span>
                    </div>
                    {note.trim() && (
                      <div className="px-3.5 py-2.5 flex justify-between gap-3">
                        <span className="text-slate-500">Remark</span>
                        <span className="text-slate-700">{note.trim()}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3.5 bg-white border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
              {step === 'CONFIG' ? (
                <>
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  {isAdmin && (
                    <motion.button
                      whileTap={WHILE_TAP_BUTTON}
                      type="button"
                      onClick={validateAndProceed}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-[#003857] hover:bg-[#002a42] text-white transition cursor-pointer shadow-xs"
                    >
                      <span>Review Impact</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </motion.button>
                  )}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setStep('CONFIG')}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Back</span>
                  </button>
                  <motion.button
                    whileTap={WHILE_TAP_BUTTON}
                    type="button"
                    disabled={saving}
                    onClick={handleSave}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white transition cursor-pointer shadow-xs"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{saving ? 'Saving...' : 'Confirm & Save'}</span>
                  </motion.button>
                </>
              )}
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
};

export const ManageMaterialModal = React.memo(ManageMaterialModalComponent);

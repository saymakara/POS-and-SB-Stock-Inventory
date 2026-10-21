import React, { useState, useEffect, useMemo } from 'react';
import {
  Device,
  Branch,
  UserRole,
  LifecycleStage,
  STAGE_ORDER,
  getBatteryLifecycleStatus,
  ThemeMode,
  CustomFieldDefinition,
  DEFAULT_CUSTOM_FIELDS,
} from '../types';
import { STAGE_META } from '../data/initialData';
import { findMidDuplicateDevices } from '../utils/crmUtils';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  RotateCcw,
  Trash2,
  Calendar,
  Cpu,
  Volume2,
  BatteryCharging,
  Building2,
  User,
  Store,
  ChevronDown,
  Check,
  AlertTriangle,
  Clock,
  Sparkles,
  FileText,
  SearchX,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  CheckCircle2,
  SlidersHorizontal,
  MapPin,
  Phone,
  Hash,
  Type,
} from 'lucide-react';

interface WorkflowModalProps {
  device: Device | null;
  devices?: Device[];
  branches: Branch[];
  role: UserRole;
  theme?: ThemeMode;
  customFields?: CustomFieldDefinition[];
  onClose: () => void;
  onSave: (
    serial: string,
    updates: {
      stage: LifecycleStage;
      branchId: string;
      staff: string;
      merchantName: string;
      merchantPhone?: string;
      location?: string;
      address?: string;
      mid: string;
      tid: string;
      note: string;
      deployedDate: string;
      batteryInstalledDate: string;
      batterySerial?: string;
      customFields?: Record<string, string>;
    }
  ) => void;
  onReturnToAdminStock?: (serial: string, reason: string) => void;
  onRequestReturnToAdminStock?: (serial: string, reason: string) => void;
  onReturnToBranchReserve?: (serial: string, branchId: string, reason: string) => void;
  onRemoveFromDashboard?: (serial: string, reason: string) => void;
  onChangeBattery?: (device: Device) => void;
}

export const WorkflowModal: React.FC<WorkflowModalProps> = ({
  device,
  devices = [],
  branches,
  role,
  theme = 'light',
  customFields = DEFAULT_CUSTOM_FIELDS,
  onClose,
  onSave,
  onReturnToAdminStock,
  onRequestReturnToAdminStock,
  onReturnToBranchReserve,
  onRemoveFromDashboard,
  onChangeBattery,
}) => {
  const [stage, setStage] = useState<LifecycleStage>('HQ_STOCK');
  const [terminateDestination, setTerminateDestination] =
    useState<'BRANCH_RESERVE' | 'HQ_STOCK'>('BRANCH_RESERVE');
  const [branchId, setBranchId] = useState('100');
  const [staff, setStaff] = useState('');
  const [merchantName, setMerchantName] = useState('');
  const [mid, setMid] = useState('');
  const [tid, setTid] = useState('');
  const [deployedDate, setDeployedDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [note, setNote] = useState('');
  const [batteryInstalledDate, setBatteryInstalledDate] =
    useState('2026-01-15');
  const [batterySerial, setBatterySerial] = useState('');
  const [midError, setMidError] = useState('');

  // Dynamic Custom Fields State
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});

  // One MID One Serial conflict detection
  const conflictingDevices = useMemo(() => {
    return findMidDuplicateDevices(mid, devices, device?.serial);
  }, [mid, devices, device?.serial]);

  // Double-Step Verification State
  const [modalStep, setModalStep] = useState<'EDIT' | 'PREVIEW'>('EDIT');
  interface PendingPayload {
    actionType: 'SAVE' | 'RETURN_BRANCH_RESERVE' | 'RETURN_ADMIN_STOCK' | 'REMOVE_DASHBOARD';
    actionTitle: string;
    stage: LifecycleStage;
    branchId: string;
    branchName: string;
    staff: string;
    merchantName: string;
    merchantPhone?: string;
    location?: string;
    address?: string;
    mid: string;
    tid: string;
    note: string;
    deployedDate: string;
    batteryInstalledDate: string;
    batterySerial: string;
    isBatteryChanged: boolean;
    customFields?: Record<string, string>;
  }
  const [pendingPayload, setPendingPayload] = useState<PendingPayload | null>(null);

  const isLight = theme === 'light';
  const isAdminLike = role === 'SUPER_ADMIN' || role === 'ADMIN';

  const activeCustomFields = useMemo(() => {
    return (customFields || []).filter((f) => f.enabled);
  }, [customFields]);

  useEffect(() => {
    if (device) {
      setStage(device.stage);
      setBranchId(device.branchId);
      setStaff(device.staff || '');
      setMerchantName(device.merchantName || '');
      setMid(device.mid || '');
      setTid(device.tid || '');
      setDeployedDate(device.deployedDate || device.updatedAt || new Date().toISOString().split('T')[0]);
      setNote('');
      setMidError('');
      setBatterySerial(device.batterySerial || '160525A0005709');
      setBatteryInstalledDate(
        device.batteryInstalledDate || device.stockInDate || '2026-01-15'
      );

      // Initialize custom field values from standard device attributes or customFields record
      const initialCustomValues: Record<string, string> = {
        location: device.location || '',
        merchantPhone: device.merchantPhone || '',
        address: device.address || '',
        ...(device.customFields || {}),
      };
      setCustomFieldValues(initialCustomValues);

      setModalStep('EDIT');
      setPendingPayload(null);
    }
  }, [device]);

  if (!device) return null;

  const selectedBranchObj = branches.find((b) => b.code === branchId);
  const availableStaff = selectedBranchObj ? selectedBranchObj.staff : [];

  const handleStageChange = (newStage: LifecycleStage) => {
    setStage(newStage);
    if (newStage === 'HQ_STOCK') {
      setBranchId('100');
      setStaff('SAY Chanmakara (8986)');
    } else if (newStage === 'COMPLETE' && !deployedDate) {
      setDeployedDate(new Date().toISOString().split('T')[0]);
    }
  };

  const handleBranchChange = (newBranchCode: string) => {
    setBranchId(newBranchCode);
    const bObj = branches.find((b) => b.code === newBranchCode);
    if (bObj && bObj.staff && bObj.staff.length > 0) {
      setStaff(bObj.staff[0]);
    } else {
      setStaff('');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (stage !== 'FAULTY' && stage !== 'LOST' && mid.trim() && !/^\d{15}$/.test(mid.trim())) {
      setMidError('MID must be exactly 15 numeric digits (e.g. 100000880101001).');
      return;
    }
    setMidError('');

    let finalStage: LifecycleStage = stage;
    let finalBranchId = branchId;
    let finalStaff = staff;
    let finalMerchantName = merchantName;
    let finalMid = mid;
    let finalTid = tid;

    if (stage === 'FAULTY') {
      finalStage = terminateDestination;
      finalMerchantName = '';
      finalMid = '';
      finalTid = '';
      if (terminateDestination === 'HQ_STOCK') {
        finalBranchId = '100';
        finalStaff = 'SAY Chanmakara (8986)';
      }
    } else if (stage === 'LOST') {
      finalMerchantName = '';
      finalMid = '';
      finalTid = '';
    }

    const targetBranch = branches.find((b) => b.code === finalBranchId);
    const isBatteryChanged =
      batterySerial !== (device.batterySerial || '160525A0005709') ||
      batteryInstalledDate !== (device.batteryInstalledDate || device.stockInDate || '2026-01-15');

    const generatedNote =
      note.trim() ||
      (stage === 'FAULTY'
        ? `Device terminated & returned to ${
            finalStage === 'HQ_STOCK'
              ? 'Admin HQ Stock (Branch Code 100)'
              : `Branch Reserve (Code ${finalBranchId})`
          }`
        : stage === 'LOST'
        ? 'Device marked as Device Lost in system inventory'
        : 'Device details and lifecycle updated');

    // Validate required custom fields
    for (const f of activeCustomFields) {
      if (f.required && !customFieldValues[f.id]?.trim()) {
        setMidError(`Attribute "${f.label}" is required by system settings.`);
        return;
      }
    }

    const locVal = customFieldValues['location'] || device.location || '';
    const phoneVal = customFieldValues['merchantPhone'] || device.merchantPhone || '';
    const addrVal = customFieldValues['address'] || device.address || '';

    setPendingPayload({
      actionType: 'SAVE',
      actionTitle: 'Save Device Lifecycle & Custody Updates',
      stage: finalStage,
      branchId: finalBranchId,
      branchName: targetBranch ? targetBranch.name : `Branch Code ${finalBranchId}`,
      staff: finalStaff,
      merchantName: finalMerchantName,
      merchantPhone: phoneVal,
      location: locVal,
      address: addrVal,
      mid: finalMid,
      tid: finalTid,
      note: generatedNote,
      deployedDate,
      batteryInstalledDate,
      batterySerial,
      isBatteryChanged,
      customFields: customFieldValues,
    });
    setModalStep('PREVIEW');
  };

  const handleFinalCommit = () => {
    if (!pendingPayload || !device) return;

    if (pendingPayload.actionType === 'RETURN_BRANCH_RESERVE') {
      if (onReturnToBranchReserve) {
        onReturnToBranchReserve(
          device.serial,
          pendingPayload.branchId,
          pendingPayload.note
        );
      } else {
        onSave(device.serial, {
          stage: pendingPayload.stage,
          branchId: pendingPayload.branchId,
          staff: pendingPayload.staff,
          merchantName: pendingPayload.merchantName,
          merchantPhone: pendingPayload.merchantPhone,
          location: pendingPayload.location,
          address: pendingPayload.address,
          mid: pendingPayload.mid,
          tid: pendingPayload.tid,
          note: pendingPayload.note,
          deployedDate: pendingPayload.deployedDate,
          batteryInstalledDate: pendingPayload.batteryInstalledDate,
          batterySerial: pendingPayload.batterySerial,
          customFields: pendingPayload.customFields,
        });
      }
      onClose();
      return;
    }

    if (pendingPayload.actionType === 'RETURN_ADMIN_STOCK') {
      if (onReturnToAdminStock) {
        onReturnToAdminStock(device.serial, pendingPayload.note);
      } else {
        onSave(device.serial, {
          stage: pendingPayload.stage,
          branchId: pendingPayload.branchId,
          staff: pendingPayload.staff,
          merchantName: pendingPayload.merchantName,
          merchantPhone: pendingPayload.merchantPhone,
          location: pendingPayload.location,
          address: pendingPayload.address,
          mid: pendingPayload.mid,
          tid: pendingPayload.tid,
          note: pendingPayload.note,
          deployedDate: pendingPayload.deployedDate,
          batteryInstalledDate: pendingPayload.batteryInstalledDate,
          batterySerial: pendingPayload.batterySerial,
          customFields: pendingPayload.customFields,
        });
      }
      onClose();
      return;
    }

    if (pendingPayload.actionType === 'REMOVE_DASHBOARD') {
      if (onRemoveFromDashboard) {
        onRemoveFromDashboard(device.serial, pendingPayload.note);
      }
      onClose();
      return;
    }

    // Default SAVE
    onSave(device.serial, {
      stage: pendingPayload.stage,
      branchId: pendingPayload.branchId,
      staff: pendingPayload.staff,
      merchantName: pendingPayload.merchantName,
      merchantPhone: pendingPayload.merchantPhone,
      location: pendingPayload.location,
      address: pendingPayload.address,
      mid: pendingPayload.mid,
      tid: pendingPayload.tid,
      note: pendingPayload.note,
      deployedDate: pendingPayload.deployedDate,
      batteryInstalledDate: pendingPayload.batteryInstalledDate,
      batterySerial: pendingPayload.batterySerial,
      customFields: pendingPayload.customFields,
    });
    onClose();
  };

  const previewBatteryInfo = getBatteryLifecycleStatus({
    batteryInstalledDate,
    stockInDate: device.stockInDate,
    deployedDate,
  });

  const hasQuickActions =
    device.merchantName ||
    device.stage === 'COMPLETE' ||
    (device.stage !== 'HQ_STOCK' && onReturnToAdminStock) ||
    (isAdminLike && onRemoveFromDashboard);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm"
        />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 14 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 12 }}
          transition={{ type: 'spring', damping: 28, stiffness: 340, mass: 0.75 }}
          className={`relative w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden my-auto max-h-[88vh] z-10 border-0 flex flex-col ${
            isLight
              ? 'bg-white text-slate-800'
              : 'bg-[#12151e] text-slate-100'
          }`}
        >
          {/* Header */}
          <div className="navy-header-bar rounded-t-2xl px-5 py-3 flex items-center justify-between text-white border-b border-white/10 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-white/10 border border-white/15 flex items-center justify-center shrink-0 shadow-xs text-white">
                {device.type === 'POS Terminal' ? (
                  <Cpu className="w-4 h-4 text-white" />
                ) : (
                  <Volume2 className="w-4 h-4 text-white" />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-sm sm:text-base font-bold text-white tracking-tight truncate">
                    {device.serial}
                  </span>
                  <span className="text-[10px] font-mono font-medium px-1.5 py-0.2 rounded bg-white/15 text-white border border-white/20">
                    {device.type}
                  </span>
                  <span className="text-[10px] font-mono font-medium px-1.5 py-0.2 rounded bg-white/10 text-white/90 border border-white/15">
                    Branch Code {device.branchId}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[11px] text-white/75 truncate">
                  <span className="font-mono text-white/90 font-medium">
                    {device.batterySerial && !device.batterySerial.startsWith('BAT-')
                      ? device.batterySerial
                      : '160525A0005709'}
                  </span>
                  <span className="text-white/30">•</span>
                  <span>{device.model}</span>
                  <span className="text-white/30">•</span>
                  <span>Stock-In: {device.stockInDate}</span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-white/75 hover:text-white hover:bg-white/10 transition cursor-pointer shrink-0 ml-2"
              title="Close Modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Stepper Progress Bar (Double-Step Flow) */}
          <div
            className={`px-5 py-2 border-b flex items-center justify-between text-xs shrink-0 ${
              isLight
                ? 'bg-slate-50 border-slate-200 text-slate-700'
                : 'bg-[#151922] border-slate-800 text-slate-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setModalStep('EDIT')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-bold transition cursor-pointer text-xs ${
                  modalStep === 'EDIT'
                    ? 'bg-[#004953] text-white shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'
                }`}
              >
                <span className="w-3.5 h-3.5 rounded-full bg-white/20 flex items-center justify-center text-[9px] font-black">
                  1
                </span>
                <span>Configure &amp; Edit Details</span>
              </button>

              <ArrowRight className="w-3 h-3 text-slate-400" />

              <button
                type="button"
                onClick={() => {
                  if (pendingPayload) setModalStep('PREVIEW');
                }}
                disabled={!pendingPayload}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-bold transition text-xs ${
                  modalStep === 'PREVIEW'
                    ? 'bg-[#004953] text-white shadow-xs'
                    : pendingPayload
                    ? 'text-slate-600 hover:text-slate-900 dark:hover:text-white cursor-pointer'
                    : 'text-slate-400 opacity-60 cursor-not-allowed'
                }`}
              >
                <span className="w-3.5 h-3.5 rounded-full bg-white/20 flex items-center justify-center text-[9px] font-black">
                  2
                </span>
                <span>Impact Review &amp; Before/After Diff</span>
              </button>
            </div>

            <div className="hidden sm:flex items-center gap-1 text-[10.5px] font-medium text-slate-500 dark:text-slate-400">
              <ShieldCheck className="w-3.5 h-3.5 text-[#1e5b88] dark:text-sky-400" />
              <span>Double-Step Safeguard Active</span>
            </div>
          </div>

          {modalStep === 'EDIT' ? (
            <>
              {/* Quick Action Toolbar Strip */}
              {hasQuickActions && (
                <div
                  className={`px-5 py-2 border-b flex items-center justify-between flex-wrap gap-2 text-xs shrink-0 ${
                    isLight
                      ? 'bg-slate-50/90 border-slate-200/80 text-slate-600'
                      : 'bg-[#181c26] border-slate-700/80 text-slate-300'
                  }`}
                >
                  <span className="text-[10.5px] font-semibold text-slate-400 uppercase tracking-wider">
                    Lifecycle Actions
                  </span>
                  <div className="flex items-center gap-2 flex-wrap">
                    {(device.merchantName || device.stage === 'COMPLETE') && (
                      <button
                        type="button"
                        onClick={() => {
                          const targetCode = device.branchId === '100' ? '105' : device.branchId;
                          const targetBranch = branches.find((b) => b.code === targetCode);
                          setPendingPayload({
                            actionType: 'RETURN_BRANCH_RESERVE',
                            actionTitle: 'Return Unit from Merchant to Branch Reserve',
                            stage: 'BRANCH_RESERVE',
                            branchId: targetCode,
                            branchName: targetBranch ? targetBranch.name : `Branch Code ${targetCode}`,
                            staff: device.staff || '',
                            merchantName: '',
                            mid: '',
                            tid: '',
                            note:
                              note.trim() ||
                              `Returned from merchant ${
                                device.merchantName || 'Merchant'
                              } back to Branch Reserve`,
                            deployedDate: device.deployedDate || device.stockInDate,
                            batteryInstalledDate,
                            batterySerial,
                            isBatteryChanged: false,
                          });
                          setModalStep('PREVIEW');
                        }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition cursor-pointer ${
                          isLight
                            ? 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800'
                            : 'border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300'
                        }`}
                        title="Return unit from merchant to Branch Reserve"
                      >
                        <Building2 className="w-3.5 h-3.5" />
                        <span>Return to Branch Reserve</span>
                      </button>
                    )}

                    {device.stage !== 'HQ_STOCK' && (
                      <button
                        type="button"
                        onClick={() => {
                          if (isAdminLike && onReturnToAdminStock) {
                            const targetBranch = branches.find((b) => b.code === '100');
                            setPendingPayload({
                              actionType: 'RETURN_ADMIN_STOCK',
                              actionTitle: 'Return Unit to Head Office Admin Stock (Code 100)',
                              stage: 'HQ_STOCK',
                              branchId: '100',
                              branchName: targetBranch ? targetBranch.name : 'Head Office Stock',
                              staff: 'SAY Chanmakara (8986)',
                              merchantName: '',
                              mid: '',
                              tid: '',
                              note:
                                note.trim() || 'Returned back to Admin HQ Stock (Branch Code 100)',
                              deployedDate: device.deployedDate || device.stockInDate,
                              batteryInstalledDate,
                              batterySerial,
                              isBatteryChanged: false,
                            });
                            setModalStep('PREVIEW');
                          } else if (onRequestReturnToAdminStock) {
                            onRequestReturnToAdminStock(
                              device.serial,
                              note.trim() || `Branch requested return of ${device.serial} to Admin Stock`
                            );
                            onClose();
                          }
                        }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition cursor-pointer ${
                          isLight
                            ? 'border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-800'
                            : 'border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300'
                        }`}
                        title={
                          isAdminLike
                            ? 'Return unit back to Head Office Admin Stock'
                            : 'Submit a return request to Admin HQ for approval'
                        }
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>
                          {isAdminLike
                            ? 'Return to Admin Stock'
                            : 'Request Return to Admin Stock'}
                        </span>
                      </button>
                    )}

                    {isAdminLike && onRemoveFromDashboard && (
                      <button
                        type="button"
                        onClick={() => {
                          setPendingPayload({
                            actionType: 'REMOVE_DASHBOARD',
                            actionTitle: 'Remove Unit from Active Dashboard Inventory',
                            stage: device.stage,
                            branchId: device.branchId,
                            branchName:
                              branches.find((b) => b.code === device.branchId)?.name ||
                              `Branch Code ${device.branchId}`,
                            staff: device.staff || '',
                            merchantName: device.merchantName || '',
                            mid: device.mid || '',
                            tid: device.tid || '',
                            note: note.trim() || 'Removed from active dashboard inventory',
                            deployedDate,
                            batteryInstalledDate,
                            batterySerial,
                            isBatteryChanged: false,
                          });
                          setModalStep('PREVIEW');
                        }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition cursor-pointer ${
                          isLight
                            ? 'border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700'
                            : 'border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300'
                        }`}
                        title="Remove unit from dashboard"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Remove from Dashboard</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Form Body */}
              <form onSubmit={handleSubmit} className="p-4 sm:p-5 flex flex-col gap-3 overflow-y-auto max-h-[calc(88vh-130px)] custom-scrollbar">
            {/* Row 1: Lifecycle Stage & Assigned Branch */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Lifecycle Status Stage *
                </label>
                <div className="relative">
                  <select
                    value={stage}
                    onChange={(e) =>
                      handleStageChange(e.target.value as LifecycleStage)
                    }
                    className={`w-full appearance-none rounded-xl px-3 py-2 text-xs font-medium border focus:outline-none transition cursor-pointer pr-10 ${
                      isLight
                        ? 'bg-slate-50/80 hover:bg-slate-50 border-slate-200 text-slate-900 focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-700'
                        : 'bg-[#181c26] hover:bg-[#1e2330] border-slate-700/80 text-white focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500'
                    }`}
                  >
                    {STAGE_ORDER.map((s) => {
                      if (role === 'BRANCH' && s === 'HQ_STOCK') return null;
                      return (
                        <option
                          key={s}
                          value={s}
                          className={
                            isLight
                              ? 'bg-white text-slate-900'
                              : 'bg-slate-900 text-white'
                          }
                        >
                          {STAGE_META[s].label}
                        </option>
                      );
                    })}
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <Building2 className="w-3.5 h-3.5 text-zinc-600 dark:text-zinc-400" />
                  <span>Assigned Branch Code *</span>
                </label>
                <div className="relative">
                  <select
                    value={branchId}
                    onChange={(e) => handleBranchChange(e.target.value)}
                    disabled={role === 'BRANCH' || stage === 'HQ_STOCK'}
                    className={`w-full appearance-none rounded-xl px-3 py-2 text-xs font-medium border focus:outline-none transition cursor-pointer pr-10 disabled:opacity-60 disabled:cursor-not-allowed ${
                      isLight
                        ? 'bg-slate-50/80 hover:bg-slate-50 border-slate-200 text-slate-900 focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-700'
                        : 'bg-[#181c26] hover:bg-[#1e2330] border-slate-700/80 text-white focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500'
                    }`}
                  >
                    {branches.map((b) => (
                      <option
                        key={b.code}
                        value={b.code}
                        className={
                          isLight
                            ? 'bg-white text-slate-900'
                            : 'bg-slate-900 text-white'
                        }
                      >
                        Branch Code {b.code} — {b.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>
            </div>

            {/* When Terminate / Return is selected, staff must return device to physical stock */}
            {stage === 'FAULTY' && (
              <div
                className={`p-3.5 rounded-xl border flex flex-col gap-2.5 ${
                  isLight
                    ? 'bg-amber-50/70 border-amber-200 text-slate-800'
                    : 'bg-amber-950/20 border-amber-800/60 text-slate-100'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                  <RotateCcw className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Physical Hardware Return Destination (Mandatory) *</span>
                </div>
                <p className="text-[11.5px] text-slate-600 dark:text-slate-300">
                  After terminating merchant deployment, staff must physically return this hardware unit into stock:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTerminateDestination('BRANCH_RESERVE')}
                    className={`px-3 py-2 rounded-xl text-xs font-semibold border flex items-center justify-center gap-2 transition cursor-pointer ${
                      terminateDestination === 'BRANCH_RESERVE'
                        ? 'bg-[#004953] text-white border-emerald-500/30 shadow-xs'
                        : isLight
                        ? 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
                        : 'bg-[#181c26] hover:bg-[#202534] text-slate-300 border-slate-700'
                    }`}
                  >
                    <Building2 className="w-3.5 h-3.5" />
                    <span>Return to Branch Reserve</span>
                  </button>
                  {isAdminLike ? (
                    <button
                      type="button"
                      onClick={() => setTerminateDestination('HQ_STOCK')}
                      className={`px-3 py-2 rounded-xl text-xs font-semibold border flex items-center justify-center gap-2 transition cursor-pointer ${
                        terminateDestination === 'HQ_STOCK'
                          ? 'bg-[#004953] text-white border-emerald-500/30 shadow-xs'
                          : isLight
                          ? 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
                          : 'bg-[#181c26] hover:bg-[#202534] text-slate-300 border-slate-700'
                      }`}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Return to Admin HQ Stock</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="px-3 py-2 rounded-xl text-xs font-semibold border flex items-center justify-center gap-2 transition opacity-50 cursor-not-allowed bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700"
                      title="Only Admin & Super Admin can return directly to HQ Stock. Units must be returned to Branch Reserve first, then submitted as a Return Request."
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Return to Admin HQ Stock (Admin Only)</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {stage === 'LOST' && (
              <div
                className={`p-3.5 rounded-xl border flex flex-col gap-2 ${
                  isLight
                    ? 'bg-amber-50/70 border-amber-200 text-slate-800'
                    : 'bg-amber-950/20 border-amber-800/60 text-slate-100'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                  <SearchX className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Device Status: Device Lost / Missing</span>
                </div>
                <p className="text-[11.5px] text-slate-600 dark:text-slate-300">
                  This terminal or sound box will be flagged as <strong>Device Lost</strong> in the system inventory. Active merchant assignments will be detached and recorded in the audit trail.
                </p>
              </div>
            )}

            {/* Row 2: Staff Officer & Deployment Date */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <User className="w-3.5 h-3.5 text-zinc-600 dark:text-zinc-400" />
                  <span>Assigned Branch Staff Officer</span>
                </label>
                <div className="relative">
                  <select
                    value={staff}
                    onChange={(e) => setStaff(e.target.value)}
                    className={`w-full appearance-none rounded-xl px-3 py-2 text-xs font-medium border focus:outline-none transition cursor-pointer pr-10 ${
                      isLight
                        ? 'bg-slate-50/80 hover:bg-slate-50 border-slate-200 text-slate-900 focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-700'
                        : 'bg-[#181c26] hover:bg-[#1e2330] border-slate-700/80 text-white focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500'
                    }`}
                  >
                    <option
                      value=""
                      className={
                        isLight
                          ? 'bg-white text-slate-500'
                          : 'bg-slate-900 text-slate-400'
                      }
                    >
                      -- Unassigned --
                    </option>
                    {availableStaff.map((st) => (
                      <option
                        key={st}
                        value={st}
                        className={
                          isLight
                            ? 'bg-white text-slate-900'
                            : 'bg-slate-900 text-white'
                        }
                      >
                        {st}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <Calendar className="w-3.5 h-3.5 text-zinc-600 dark:text-zinc-400" />
                  <span>Installation / Deployment Date</span>
                </label>
                <input
                  type="date"
                  value={deployedDate}
                  onChange={(e) => setDeployedDate(e.target.value)}
                  className={`w-full rounded-xl px-3 py-2 text-xs font-mono font-medium border focus:outline-none transition ${
                    isLight
                      ? 'bg-slate-50/80 hover:bg-slate-50 border-slate-200 text-slate-900 focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-700'
                      : 'bg-[#181c26] hover:bg-[#1e2330] border-slate-700/80 text-white focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500'
                  }`}
                />
              </div>
            </div>

            {/* Row 3: Merchant Name, MID, TID */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="flex flex-col gap-1 sm:col-span-1">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <Store className="w-3.5 h-3.5 text-zinc-600 dark:text-zinc-400" />
                  <span>Merchant DBA Name</span>
                </label>
                <input
                  type="text"
                  value={merchantName}
                  onChange={(e) => setMerchantName(e.target.value)}
                  placeholder="e.g. Brown Coffee BKK"
                  className={`w-full rounded-xl px-3 py-2 text-xs font-medium border focus:outline-none transition ${
                    isLight
                      ? 'bg-slate-50/80 hover:bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-700'
                      : 'bg-[#181c26] hover:bg-[#1e2330] border-slate-700/80 text-white placeholder:text-slate-500 focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500'
                  }`}
                />
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Merchant ID (MID)
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const cleanBranch = branchId.padStart(3, '0').slice(-3);
                      const rand = Math.floor(100 + Math.random() * 900);
                      setMid(`100000880${cleanBranch}${rand}`);
                      setMidError('');
                    }}
                    className="text-[10px] font-medium text-zinc-800 dark:text-zinc-300 hover:underline cursor-pointer flex items-center gap-1 font-bold"
                  >
                    <Sparkles className="w-2.5 h-2.5 text-amber-500" />
                    <span>Auto-Gen 15D</span>
                  </button>
                </div>
                <input
                  type="text"
                  value={mid}
                  onChange={(e) => {
                    const clean = e.target.value.replace(/\D/g, '').slice(0, 15);
                    setMid(clean);
                    if (midError) setMidError('');
                  }}
                  maxLength={15}
                  placeholder="e.g. 100000880101001"
                  className={`w-full rounded-xl px-3 py-2 text-xs font-mono font-medium border focus:outline-none transition ${
                    midError
                      ? 'border-rose-500 ring-2 ring-rose-500/20 bg-rose-50/50'
                      : isLight
                      ? 'bg-slate-50/80 hover:bg-slate-50 border-slate-200 text-slate-900 focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-700'
                      : 'bg-[#181c26] hover:bg-[#1e2330] border-slate-700/80 text-white focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500'
                  }`}
                />
                <div className="flex items-center justify-between text-[10px] px-0.5">
                  {midError ? (
                    <span className="text-rose-600 font-semibold">{midError}</span>
                  ) : (
                    <span className="text-slate-400">Must be 15 numeric digits</span>
                  )}
                  <span className="font-mono text-slate-400">{mid.length}/15</span>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Terminal ID (TID)
                </label>
                <input
                  type="text"
                  value={tid}
                  onChange={(e) => setTid(e.target.value)}
                  placeholder="e.g. TID-10101"
                  className={`w-full rounded-xl px-3 py-2 text-xs font-mono font-medium border focus:outline-none transition ${
                    isLight
                      ? 'bg-slate-50/80 hover:bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-700'
                      : 'bg-[#181c26] hover:bg-[#1e2330] border-slate-700/80 text-white placeholder:text-slate-500 focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500'
                  }`}
                />
              </div>
            </div>

            {/* Dynamic Custom & Additional Fields Section */}
            {activeCustomFields.length > 0 && (
              <div
                className={`p-3 rounded-xl border flex flex-col gap-2.5 transition-colors ${
                  isLight
                    ? 'bg-slate-50/70 border-slate-200'
                    : 'bg-[#181c26] border-slate-700/80'
                }`}
              >
                <div className="flex items-center justify-between pb-1 border-b border-slate-200/50 dark:border-white/[0.06]">
                  <div className="flex items-center gap-1.5">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                      Additional Attributes ({activeCustomFields.length})
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-medium font-mono">
                    Configured in Settings
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {activeCustomFields.map((field) => {
                    const val = customFieldValues[field.id] ?? '';
                    const getFieldIcon = () => {
                      if (field.id === 'location') return <MapPin className="w-3.5 h-3.5 text-emerald-500 shrink-0" />;
                      if (field.id === 'merchantPhone' || field.type === 'phone') return <Phone className="w-3.5 h-3.5 text-sky-500 shrink-0" />;
                      if (field.id === 'address') return <Building2 className="w-3.5 h-3.5 text-amber-500 shrink-0" />;
                      if (field.type === 'number') return <Hash className="w-3.5 h-3.5 text-indigo-500 shrink-0" />;
                      return <Type className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
                    };

                    return (
                      <div key={field.id} className="flex flex-col gap-1">
                        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                          <span className="flex items-center gap-1.5">
                            {getFieldIcon()}
                            <span>{field.label}</span>
                            {field.required && <span className="text-rose-500 font-bold">*</span>}
                          </span>
                          <span className="font-mono text-[9px] uppercase px-1.5 py-0.2 rounded bg-slate-200/70 dark:bg-white/10 text-slate-500">
                            {field.type}
                          </span>
                        </label>

                        {field.type === 'select' && field.options && field.options.length > 0 ? (
                          <div className="relative">
                            <select
                              value={val}
                              onChange={(e) =>
                                setCustomFieldValues((prev) => ({
                                  ...prev,
                                  [field.id]: e.target.value,
                                }))
                              }
                              required={field.required}
                              className={`w-full appearance-none rounded-xl px-3 py-2 text-xs font-medium border focus:outline-none transition cursor-pointer pr-8 ${
                                isLight
                                  ? 'bg-white hover:bg-slate-50 border-slate-200 text-slate-900 focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-700'
                                  : 'bg-[#121620] hover:bg-[#1a202e] border-slate-700 text-white focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500'
                              }`}
                            >
                              <option value="">-- {field.placeholder || 'Select Option'} --</option>
                              {field.options.map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-2.5 pointer-events-none" />
                          </div>
                        ) : field.type === 'date' ? (
                          <input
                            type="date"
                            value={val}
                            onChange={(e) =>
                              setCustomFieldValues((prev) => ({
                                ...prev,
                                [field.id]: e.target.value,
                              }))
                            }
                            required={field.required}
                            className={`w-full rounded-xl px-3 py-2 text-xs font-medium border focus:outline-none transition ${
                              isLight
                                ? 'bg-white hover:bg-slate-50 border-slate-200 text-slate-900 focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-700'
                                : 'bg-[#121620] hover:bg-[#1a202e] border-slate-700 text-white focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500'
                            }`}
                          />
                        ) : field.type === 'number' ? (
                          <input
                            type="number"
                            value={val}
                            onChange={(e) =>
                              setCustomFieldValues((prev) => ({
                                ...prev,
                                [field.id]: e.target.value,
                              }))
                            }
                            placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
                            required={field.required}
                            className={`w-full rounded-xl px-3 py-2 text-xs font-medium border focus:outline-none transition ${
                              isLight
                                ? 'bg-white hover:bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-700'
                                : 'bg-[#121620] hover:bg-[#1a202e] border-slate-700 text-white placeholder:text-slate-500 focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500'
                            }`}
                          />
                        ) : (
                          <input
                            type="text"
                            value={val}
                            onChange={(e) =>
                              setCustomFieldValues((prev) => ({
                                ...prev,
                                [field.id]: e.target.value,
                              }))
                            }
                            placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
                            required={field.required}
                            className={`w-full rounded-xl px-3 py-2 text-xs font-medium border focus:outline-none transition ${
                              isLight
                                ? 'bg-white hover:bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-700'
                                : 'bg-[#121620] hover:bg-[#1a202e] border-slate-700 text-white placeholder:text-slate-500 focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500'
                            }`}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Row 4: 24-Month POS Battery Lifecycle Card */}
            <div
              className={`p-3 rounded-xl border flex flex-col gap-2.5 transition-colors ${
                previewBatteryInfo.state === 'EXPIRED'
                  ? isLight
                    ? 'bg-rose-50/60 border-rose-200'
                    : 'bg-rose-950/20 border-rose-800/60'
                  : previewBatteryInfo.state === 'DUE_SOON'
                  ? isLight
                    ? 'bg-amber-50/60 border-amber-200'
                    : 'bg-amber-950/20 border-amber-800/60'
                  : isLight
                  ? 'bg-slate-50/70 border-slate-200'
                  : 'bg-[#181c26] border-slate-700/80'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <BatteryCharging
                    className={`w-3.5 h-3.5 ${
                      previewBatteryInfo.state === 'EXPIRED'
                        ? 'text-rose-600'
                        : previewBatteryInfo.state === 'DUE_SOON'
                        ? 'text-amber-600'
                        : 'text-emerald-600'
                    }`}
                  />
                  <span>POS Terminal Battery (24-Month Cycle Standard)</span>
                </span>
                <span
                  className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded-full border ${
                    previewBatteryInfo.state === 'EXPIRED'
                      ? 'bg-rose-100/90 text-rose-800 border-rose-300'
                      : previewBatteryInfo.state === 'DUE_SOON'
                      ? 'bg-amber-100/90 text-amber-800 border-amber-300'
                      : 'bg-emerald-100/90 text-emerald-800 border-emerald-300'
                  }`}
                >
                  {previewBatteryInfo.state === 'EXPIRED'
                    ? 'EXPIRED — 24M Change Required'
                    : previewBatteryInfo.state === 'DUE_SOON'
                    ? 'Due Soon (<3M Left)'
                    : 'Active / Healthy'}
                </span>
              </div>

              {/* Status Message Banner */}
              <div
                className={`px-2.5 py-1.5 rounded-lg text-[11px] flex items-center gap-2 border ${
                  previewBatteryInfo.state === 'EXPIRED'
                    ? 'bg-rose-100/70 border-rose-200 text-rose-800 font-medium'
                    : previewBatteryInfo.state === 'DUE_SOON'
                    ? 'bg-amber-100/70 border-amber-200 text-amber-800 font-medium'
                    : isLight
                    ? 'bg-white border-slate-200 text-slate-600'
                    : 'bg-white/[0.04] border-white/10 text-slate-300'
                }`}
              >
                {previewBatteryInfo.state === 'EXPIRED' ? (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                    <span>
                      Battery reached {previewBatteryInfo.monthsUsed} months of service (&ge; 24-month limit). Replacement is required immediately!
                    </span>
                  </>
                ) : previewBatteryInfo.state === 'DUE_SOON' ? (
                  <>
                    <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span>
                      Battery is {previewBatteryInfo.monthsUsed} months old with {previewBatteryInfo.monthsRemaining} months remaining until 24-month expiration.
                    </span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>
                      Battery in good standing ({previewBatteryInfo.monthsUsed} of 24 months elapsed · {previewBatteryInfo.monthsRemaining} months remaining).
                    </span>
                  </>
                )}
              </div>

              {/* Battery Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                      Battery Serial Number
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const rand = Math.floor(5730 + Math.random() * 3000);
                        setBatterySerial(`160525A${String(rand).padStart(7, '0')}`);
                      }}
                      className="text-[10px] font-medium text-slate-700 dark:text-slate-300 hover:underline cursor-pointer"
                    >
                      Auto-Gen 160525A
                    </button>
                  </div>
                  <input
                    type="text"
                    value={batterySerial}
                    onChange={(e) => setBatterySerial(e.target.value)}
                    placeholder="e.g. 160525A0005709"
                    className={`w-full rounded-xl px-3 py-1.5 text-xs font-mono font-medium border focus:outline-none transition ${
                      isLight
                        ? 'bg-white border-slate-200 text-slate-900 focus:ring-2 focus:ring-slate-400/20 focus:border-slate-400'
                        : 'bg-black/20 border-slate-700 text-white focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500'
                    }`}
                  />
                  <span className="text-[10px] text-slate-400 font-mono px-0.5">
                    Format: 160525A + 7 digits
                  </span>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                    Battery Installed / Commissioned Date
                  </label>
                  <input
                    type="date"
                    value={batteryInstalledDate}
                    onChange={(e) => setBatteryInstalledDate(e.target.value)}
                    className={`w-full rounded-xl px-3 py-1.5 text-xs font-mono font-medium border focus:outline-none transition ${
                      isLight
                        ? 'bg-white border-slate-200 text-slate-900 focus:ring-2 focus:ring-slate-400/20 focus:border-slate-400'
                        : 'bg-black/20 border-slate-700 text-white focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500'
                    }`}
                  />
                  <span className="text-[10px] text-slate-400 font-mono px-0.5">
                    24M Expiry Date: <strong className="text-slate-700 dark:text-slate-200">{previewBatteryInfo.dueDate}</strong>
                  </span>
                </div>
              </div>

              {/* Battery Actions */}
              <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-200/60 dark:border-slate-700/60">
                {onChangeBattery && device && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onChangeBattery(device);
                    }}
                    className={`px-3 py-1.5 rounded-xl border text-xs font-medium flex items-center justify-center gap-1.5 transition cursor-pointer ${
                      isLight
                        ? 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700 shadow-2xs'
                        : 'bg-white/10 hover:bg-white/15 border-white/15 text-white'
                    }`}
                    title="Open battery replacement wizard"
                  >
                    <BatteryCharging className="w-3.5 h-3.5 text-[#133e5e] dark:text-sky-400" />
                    <span>Battery Replacement Wizard</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const today = new Date().toISOString().split('T')[0];
                    const rand = Math.floor(5730 + Math.random() * 3000);
                    const newBatt = `160525A${String(rand).padStart(7, '0')}`;
                    setBatterySerial(newBatt);
                    setBatteryInstalledDate(today);
                    setNote((prev) =>
                      prev
                        ? `${prev} | Battery changed to ${newBatt} (fresh 24-month cycle)`
                        : `Battery changed to ${newBatt} (fresh 24-month cycle)`
                    );
                  }}
                  className="px-3.5 py-1.5 rounded-xl bg-[#003857] hover:bg-[#002a42] text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs"
                  title="Install fresh battery with new serial and reset the 24-month countdown"
                >
                  <BatteryCharging className="w-3.5 h-3.5" />
                  <span>Change Battery (Install New &amp; Reset 24M)</span>
                </button>
              </div>
            </div>

            {/* Row 5: Audit Note */}
            <div className="flex flex-col gap-1">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <FileText className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
                <span>Audit Note / Update Reason</span>
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Describe reason for stage change, merchant deployment, or branch transfer..."
                className={`w-full rounded-xl px-3 py-2 text-xs font-medium border focus:outline-none transition ${
                  isLight
                    ? 'bg-slate-50/80 hover:bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-slate-400/20 focus:border-slate-400'
                    : 'bg-[#181c26] hover:bg-[#1e2330] border-slate-700/80 text-white placeholder:text-slate-500 focus:ring-2 focus:ring-slate-400/20 focus:border-slate-500'
                }`}
              />
            </div>

            {/* Footer */}
            <div
              className={`flex items-center justify-end gap-2 pt-2.5 border-t ${
                isLight ? 'border-slate-100' : 'border-slate-800/80'
              }`}
            >
              <motion.button
                whileTap={{ scale: 0.96 }}
                type="button"
                onClick={onClose}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                  isLight
                    ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                    : 'bg-[#181c26] hover:bg-[#202534] text-slate-300 border-slate-700'
                }`}
              >
                Cancel
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.96 }}
                type="submit"
                className="px-4 py-1.5 rounded-xl bg-[#003857] hover:bg-[#002a42] text-white text-xs font-semibold shadow-xs transition cursor-pointer flex items-center gap-1.5"
              >
                <span>Review Changes (Step 2 Preview)</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </motion.button>
            </div>
          </form>
        </>
      ) : (
        /* STEP 2: IMPACT PREVIEW & BEFORE/AFTER DIFF CONFIRMATION */
        pendingPayload && (
          <div className="p-4 sm:p-5 flex flex-col gap-3 max-h-[calc(88vh-130px)] overflow-y-auto custom-scrollbar">
            {/* Impact Notice Alert Banner */}
            <div
              className={`p-3 rounded-xl border flex items-start gap-2.5 ${
                isLight
                  ? 'bg-amber-50/90 border-amber-200 text-amber-900'
                  : 'bg-amber-950/30 border-amber-800/60 text-amber-200'
              }`}
            >
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-extrabold text-xs flex flex-wrap items-center gap-2">
                  <span>{pendingPayload.actionTitle}</span>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-amber-200/90 text-amber-950 dark:bg-amber-800/80 dark:text-amber-100">
                    Step 2 Verification
                  </span>
                </div>
                <p className="text-[11px] mt-0.5 opacity-90 leading-relaxed">
                  Carefully verify the before-and-after state differences below. Data mutations and lifecycle transitions will only take effect once you click <strong>Confirm &amp; Commit Changes</strong>.
                </p>
              </div>
            </div>

            {/* Before vs After Diff Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Left Column: Live Record (Before) */}
              <div
                className={`p-3.5 rounded-xl border flex flex-col gap-2.5 ${
                  isLight
                    ? 'bg-slate-50 border-slate-200/90 text-slate-800'
                    : 'bg-slate-900/60 border-slate-800 text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-200/80 dark:border-slate-800">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                    Current Record (Before)
                  </span>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-slate-200/80 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    LIVE SYSTEM
                  </span>
                </div>

                <div className="space-y-2.5 text-xs">
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">
                      Lifecycle Stage
                    </span>
                    <div className="mt-1 font-bold flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full inline-block shrink-0"
                        style={{ backgroundColor: STAGE_META[device.stage].color }}
                      />
                      <span>{STAGE_META[device.stage].label}</span>
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">
                      Assigned Branch Custody
                    </span>
                    <div className="mt-1 font-bold text-slate-800 dark:text-slate-100">
                      Branch Code {device.branchId} — {branches.find((b) => b.code === device.branchId)?.name || 'Branch'}
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">
                      Staff &amp; Accountability
                    </span>
                    <div className="mt-1 space-y-1">
                      <div className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300">
                        <span className="text-slate-400 font-medium">Installer:</span>
                        <strong className="text-slate-900 dark:text-slate-100">
                          {device.installedByStaff || device.staff || <span className="text-slate-400 italic">None</span>}
                        </strong>
                      </div>
                      {device.replacedByStaff && (
                        <div className="flex items-center gap-1.5 text-xs flex-wrap">
                          <span className="text-slate-400 font-medium">Replaced by:</span>
                          <strong
                            className={
                              device.replacedByStaff !== (device.installedByStaff || device.staff)
                                ? 'text-amber-700 dark:text-amber-400 font-bold'
                                : 'text-slate-900 dark:text-slate-100'
                            }
                          >
                            {device.replacedByStaff}
                          </strong>
                          {device.replacedByStaff !== (device.installedByStaff || device.staff) && (
                            <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-amber-50 text-amber-800 border border-amber-300 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/30">
                              Different Person
                            </span>
                          )}
                        </div>
                      )}
                      {device.returnedByStaff && (
                        <div className="flex items-center gap-1.5 text-xs flex-wrap">
                          <span className="text-slate-400 font-medium">Returned by:</span>
                          <strong
                            className={
                              device.returnedByStaff !== (device.installedByStaff || device.staff)
                                ? 'text-indigo-700 dark:text-indigo-400 font-bold'
                                : 'text-slate-900 dark:text-slate-100'
                            }
                          >
                            {device.returnedByStaff}
                          </strong>
                          {device.returnedByStaff !== (device.installedByStaff || device.staff) && (
                            <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-indigo-50 text-indigo-800 border border-indigo-300 dark:bg-indigo-500/20 dark:text-indigo-300 dark:border-indigo-500/30">
                              Different Person
                            </span>
                          )}
                          {device.returnedDate && (
                            <span className="text-[10px] text-slate-400 font-mono">
                              ({device.returnedDate})
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">
                      Merchant Deployment
                    </span>
                    <div className="mt-1">
                      {device.merchantName ? (
                        <>
                          <div className="font-bold text-slate-900 dark:text-slate-100">{device.merchantName}</div>
                          <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                            MID: {device.mid || '-'} · TID: {device.tid || '-'}
                          </div>
                        </>
                      ) : (
                        <span className="text-slate-400 italic">Unassigned (In Stock)</span>
                      )}
                    </div>
                  </div>

                  {activeCustomFields.length > 0 && (
                    <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800 space-y-1.5">
                      <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">
                        Configured Attributes
                      </span>
                      <div className="space-y-1">
                        {activeCustomFields.map((f) => {
                          const val =
                            f.id === 'location'
                              ? device.location
                              : f.id === 'merchantPhone'
                              ? device.merchantPhone
                              : f.id === 'address'
                              ? device.address
                              : device.customFields?.[f.id];
                          return (
                            <div
                              key={f.id}
                              className="flex items-center justify-between text-[11px] gap-2 py-0.5 border-b border-dashed border-slate-200/40 dark:border-slate-800/40 last:border-0"
                            >
                              <span className="text-slate-500 font-medium truncate shrink-0 max-w-[130px]">
                                {f.label}:
                              </span>
                              <span className="font-semibold text-slate-800 dark:text-slate-200 truncate text-right">
                                {val || <span className="text-slate-400 italic font-normal">Not set</span>}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">
                      Battery Serial &amp; Age
                    </span>
                    <div className="mt-1 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                      {device.batterySerial || '160525A0005709'}
                      <span className="text-slate-400 ml-1.5 font-sans text-[11px]">
                        (Installed: {device.batteryInstalledDate || device.stockInDate || '2026-01-15'})
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Proposed Mutation (After / Preview) */}
              <div
                className={`p-3.5 rounded-xl border flex flex-col gap-2.5 ${
                  isLight
                    ? 'bg-sky-50/40 border-sky-300 text-slate-800'
                    : 'bg-sky-950/20 border-sky-700/60 text-slate-100'
                }`}
              >
                <div className="flex items-center justify-between pb-1.5 border-b border-sky-200/80 dark:border-sky-800/80">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#1e5b88] dark:text-sky-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-sky-500" />
                    <span>Proposed Update (After / Preview)</span>
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-200/80 text-sky-950 dark:bg-sky-800/80 dark:text-sky-100 font-black">
                    PROPOSED
                  </span>
                </div>

                <div className="space-y-2.5 text-xs">
                  <div>
                    <span className="text-[10px] text-[#1e5b88] dark:text-sky-300 font-bold block uppercase tracking-wider">
                      Lifecycle Stage
                    </span>
                    <div className="mt-1 font-bold flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full inline-block shrink-0"
                        style={{ backgroundColor: STAGE_META[pendingPayload.stage].color }}
                      />
                      <span className={pendingPayload.stage !== device.stage ? 'text-[#1e5b88] dark:text-sky-300 font-extrabold' : ''}>
                        {STAGE_META[pendingPayload.stage].label}
                      </span>
                      {pendingPayload.stage !== device.stage && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200">
                          Changed
                        </span>
                      )}
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] text-[#1e5b88] dark:text-sky-300 font-bold block uppercase tracking-wider">
                      Assigned Branch Custody
                    </span>
                    <div className={`mt-1 font-bold ${pendingPayload.branchId !== device.branchId ? 'text-[#1e5b88] dark:text-sky-300 font-extrabold' : ''}`}>
                      Branch Code {pendingPayload.branchId} — {pendingPayload.branchName}
                      {pendingPayload.branchId !== device.branchId && (
                        <span className="text-[10px] font-bold ml-1.5 px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200">
                          Transferred
                        </span>
                      )}
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] text-[#1e5b88] dark:text-sky-300 font-bold block uppercase tracking-wider">
                      Assigned Staff
                    </span>
                    <div className="mt-1 font-medium">
                      {pendingPayload.staff || <span className="text-slate-400 italic">None</span>}
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] text-[#1e5b88] dark:text-sky-300 font-bold block uppercase tracking-wider">
                      Merchant Deployment
                    </span>
                    <div className="mt-1">
                      {pendingPayload.merchantName ? (
                        <>
                          <div className="font-bold text-sky-950 dark:text-white">{pendingPayload.merchantName}</div>
                          <div className="text-[11px] font-mono text-[#1e5b88] dark:text-sky-300 mt-0.5">
                            MID: {pendingPayload.mid || '-'} · TID: {pendingPayload.tid || '-'}
                          </div>
                        </>
                      ) : (
                        <span className="text-slate-400 italic">Unassigned (In Stock)</span>
                      )}
                    </div>
                  </div>

                  {activeCustomFields.length > 0 && (
                    <div className="pt-2 border-t border-sky-200/60 dark:border-sky-800/60 space-y-1.5">
                      <span className="text-[10px] text-[#1e5b88] dark:text-sky-300 font-bold block uppercase tracking-wider">
                        Configured Attributes
                      </span>
                      <div className="space-y-1">
                        {activeCustomFields.map((f) => {
                          const prevVal =
                            f.id === 'location'
                              ? device.location || ''
                              : f.id === 'merchantPhone'
                              ? device.merchantPhone || ''
                              : f.id === 'address'
                              ? device.address || ''
                              : device.customFields?.[f.id] || '';
                          const nextVal =
                            f.id === 'location'
                              ? pendingPayload.location || ''
                              : f.id === 'merchantPhone'
                              ? pendingPayload.merchantPhone || ''
                              : f.id === 'address'
                              ? pendingPayload.address || ''
                              : pendingPayload.customFields?.[f.id] || '';
                          const isChanged = prevVal.trim() !== nextVal.trim();
                          return (
                            <div
                              key={f.id}
                              className="flex items-center justify-between text-[11px] gap-2 py-0.5 border-b border-dashed border-sky-200/40 dark:border-sky-800/40 last:border-0"
                            >
                              <span className="text-slate-500 dark:text-slate-400 font-medium truncate shrink-0 max-w-[130px]">
                                {f.label}:
                              </span>
                              <span
                                className={`truncate text-right flex items-center justify-end gap-1.5 ${
                                  isChanged
                                    ? 'text-[#1e5b88] dark:text-sky-300 font-bold'
                                    : 'font-semibold text-slate-800 dark:text-slate-200'
                                }`}
                              >
                                <span>{nextVal || <span className="text-slate-400 italic font-normal">Not set</span>}</span>
                                {isChanged && (
                                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200">
                                    Changed
                                  </span>
                                )}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div>
                    <span className="text-[10px] text-[#1e5b88] dark:text-sky-300 font-bold block uppercase tracking-wider">
                      Battery Serial &amp; Age
                    </span>
                    <div className="mt-1 font-mono text-[11px] text-slate-800 dark:text-slate-100">
                      {pendingPayload.batterySerial}
                      <span className="text-slate-500 ml-1.5 font-sans text-[11px]">
                        (Installed: {pendingPayload.batteryInstalledDate})
                      </span>
                      {pendingPayload.isBatteryChanged && (
                        <span className="block mt-1 text-[10px] font-sans font-bold text-emerald-600 dark:text-emerald-400">
                          ⚡ Resets 24-month lifespan countdown from {pendingPayload.batteryInstalledDate}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Permanent Audit Log Entry Preview */}
            <div
              className={`p-2.5 rounded-xl border flex items-center gap-2.5 ${
                isLight
                  ? 'bg-slate-50 border-slate-200 text-slate-800'
                  : 'bg-slate-900/80 border-slate-800 text-slate-200'
              }`}
            >
              <FileText className="w-4 h-4 text-slate-500 shrink-0" />
              <div className="text-xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Permanent Audit Trail Entry
                </span>
                <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">
                  "{pendingPayload.note}"
                </span>
              </div>
            </div>

            {/* Preview Footer Actions */}
            <div
              className={`flex items-center justify-between gap-3 pt-2.5 border-t ${
                isLight ? 'border-slate-100' : 'border-slate-800/80'
              }`}
            >
              <motion.button
                whileTap={{ scale: 0.96 }}
                type="button"
                onClick={() => setModalStep('EDIT')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer flex items-center gap-1.5 ${
                  isLight
                    ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
                    : 'bg-[#181c26] hover:bg-[#202534] text-slate-300 border-slate-700'
                }`}
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back to Edit</span>
              </motion.button>

              <motion.button
                whileTap={{ scale: 0.96 }}
                type="button"
                onClick={handleFinalCommit}
                className="px-5 py-2 rounded-xl bg-[#003857] hover:bg-[#002a42] text-white text-xs font-bold shadow-md transition cursor-pointer flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Confirm &amp; Commit Changes</span>
              </motion.button>
            </div>
          </div>
        )
      )}
    </motion.div>
  </div>
</AnimatePresence>
);
};

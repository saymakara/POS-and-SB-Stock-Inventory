import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { User as AppUser } from '../types';
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
import { normalizeStaffName, extractEmpIdFromName, resolveStaffFromDirectory } from '../utils/staffUtils';
import { todayPP } from '../utils/time';
import { phoneFor, canSeeFullContact } from '../utils/privacy';
import { isValidMidForType, midRuleError } from '../utils/display';
import { ALLOWED_NEXT, canMove, moveError, onMove } from '../utils/stages';
import { motion, AnimatePresence } from 'motion/react';
import {
  Layers,
  UserCheck,
  X,
  RotateCcw,
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
  Search,
  SearchX,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  CheckCircle2,
  SlidersHorizontal,
  MapPin,
  Phone,
  AlertCircle,
  Hash,
  Type,
  Send,
  Pencil,
} from 'lucide-react';

interface WorkflowModalProps {
  device: Device | null;
  devices?: Device[];
  branches: Branch[];
  users?: AppUser[];
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
      /** Status texts that go with the stage (from utils/stages statusOf). */
      deploymentStatus?: string;
      stockStatus?: string;
    }
  ) => void;
  onReturnToAdminStock?: (serial: string, reason: string) => void;
  onRequestReturnToAdminStock?: (serial: string, reason: string) => void;
  onReturnToBranchReserve?: (serial: string, branchId: string, reason: string) => void;
  onRemoveFromDashboard?: (serial: string, reason: string) => void;
  onChangeBattery?: (device: Device) => void;
  onNotifyConfigReady?: (serialOrSerials: string | string[]) => void;
  onRenameSerial?: (oldSerial: string, newSerial: string) => Promise<string>;
  /** Super Admin only: delete this unit from the whole system (database included) */
  onDeletePermanently?: (serial: string) => void;
  /** Signed-in operator's name/label (recorded as custodian when a unit goes to HQ stock). */
  operatorLabel?: string;
  /** 'RETURN': open straight on Return (from the Return button in Stock Inventory) */
  preset?: '' | 'RETURN';
}

export const WorkflowModal: React.FC<WorkflowModalProps> = ({
  device,
  devices = [],
  branches,
  users = [],
  role,
  theme = 'light',
  customFields = DEFAULT_CUSTOM_FIELDS,
  onClose,
  onSave,
  onReturnToAdminStock,
  onRequestReturnToAdminStock,
  onReturnToBranchReserve,
  onRemoveFromDashboard,
  preset = '',
  onChangeBattery,
  onNotifyConfigReady,
  onRenameSerial,
  onDeletePermanently,
  operatorLabel = '',
}) => {
  const [stage, setStage] = useState<LifecycleStage>('HQ_STOCK');
  const [terminateDestination, setTerminateDestination] =
    useState<'BRANCH_RESERVE' | 'HQ_STOCK'>('BRANCH_RESERVE');
  const [branchId, setBranchId] = useState('100');
  const [staff, setStaff] = useState('');
  const [merchantName, setMerchantName] = useState('');
  const [mid, setMid] = useState('');
  const [tid, setTid] = useState('');
  const [deployedDate, setDeployedDate] = useState('');
  const [note, setNote] = useState('');
  const [batteryInstalledDate, setBatteryInstalledDate] = useState('');
  const [batterySerial, setBatterySerial] = useState('');
  const [midError, setMidError] = useState('');
  const [editedSerial, setEditedSerial] = useState('');
  const [renamingSerial, setRenamingSerial] = useState(false);
  const [serialRenameMsg, setSerialRenameMsg] = useState('');

  // Dynamic Custom Fields State
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  // Telegram notification double-click safeguard (1-min confirmation window & 1-min cooldown)
  const [confirmingNotify, setConfirmingNotify] = useState(false);
  const [notifyCooldownExpires, setNotifyCooldownExpires] = useState<number>(0);
  const notifyTimerRef = useRef<NodeJS.Timeout | null>(null);
  const notifyExpiresRef = useRef<number>(0);
  const [modalTickerNow, setModalTickerNow] = useState<number>(Date.now());

  useEffect(() => {
    const isConfirming = confirmingNotify;
    const isCooling = notifyCooldownExpires > modalTickerNow;
    if (!isConfirming && !isCooling) return;

    const interval = setInterval(() => {
      setModalTickerNow(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, [confirmingNotify, notifyCooldownExpires, modalTickerNow]);

  useEffect(() => {
    return () => {
      if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current);
    };
  }, []);

  const notifyConfirmSecs = confirmingNotify
    ? Math.max(1, Math.ceil((notifyExpiresRef.current - modalTickerNow) / 1000))
    : 0;
  const notifyCooldownSecs = notifyCooldownExpires > modalTickerNow
    ? Math.max(1, Math.ceil((notifyCooldownExpires - modalTickerNow) / 1000))
    : 0;

  const handleNotifyWith2Clicks = () => {
    if (notifyCooldownSecs > 0) return;

    if (confirmingNotify) {
      if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current);
      setConfirmingNotify(false);
      notifyExpiresRef.current = 0;
      setNotifyCooldownExpires(Date.now() + 60000);
      if (device) onNotifyConfigReady?.(device.serial);
    } else {
      setConfirmingNotify(true);
      notifyExpiresRef.current = Date.now() + 60000;
      if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current);
      notifyTimerRef.current = setTimeout(() => {
        setConfirmingNotify(false);
        notifyExpiresRef.current = 0;
      }, 60000);
    }
  };

  // Double-Step Verification State
  const [modalStep, setModalStep] = useState<'EDIT' | 'PREVIEW'>('EDIT');
  // (23 Oct 2026) Return: the merchant's details are removed (kept in Merchant History) and the unit goes back to stock
  const [returnMode, setReturnMode] = useState(false);
  const [returnTo, setReturnTo] = useState<'BRANCH_RESERVE' | 'HQ_STOCK'>('BRANCH_RESERVE');
  const [returnReason, setReturnReason] = useState('Merchant Closed Business');
  interface PendingPayload {
    actionType: 'SAVE' | 'RETURN_BRANCH_RESERVE' | 'RETURN_ADMIN_STOCK' | 'REMOVE_DASHBOARD';
    actionTitle: string;
    stage: LifecycleStage;
    deploymentStatus?: string;
    stockStatus?: string;
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
  // (22 Oct 2026) once a unit is installed, only Admin HQ can change the merchant's details (branch staff add them while installing)
  const merchantLocked = !isAdminLike;
  const showFullPhone = canSeeFullContact(role);

  const activeCustomFields = useMemo(() => {
    return (customFields || []).filter((f) => f.enabled);
  }, [customFields]);

  // Reset the form only when a different unit is opened (or the modal re-opens), not every time the parent
  // re-renders with a new copy of the same device object — that used to wipe what the operator was typing.
  const deviceSerial = device?.serial || '';
  useEffect(() => {
    if (device) {
      setStage(device.stage);
      setTerminateDestination('BRANCH_RESERVE');
      setBranchId(device.branchId);
      setStaff(device.staff ? resolveStaffFromDirectory(device.staff, device.branchId, users) : '');
      setMerchantName(device.merchantName || '');
      setMid(device.mid || '');
      setTid(device.tid || '');
      setDeployedDate(device.deployedDate || '');
      setNote('');
      setMidError('');
      setEditedSerial(device.serial);
      setSerialRenameMsg('');
      // Only the unit's own recorded battery data; blank when not recorded (never a made-up serial/date).
      setBatterySerial(device.batterySerial || '');
      setBatteryInstalledDate(device.batteryInstalledDate || device.stockInDate || '');

      // Initialize custom field values from standard device attributes or customFields record.
      // Branch staff do not get the full merchant phone in the form; they may type a new one to replace it.
      const initialCustomValues: Record<string, string> = {
        location: device.location || '',
        merchantPhone: showFullPhone ? device.merchantPhone || '' : '',
        address: device.address || '',
        ...(device.customFields || {}),
      };
      setCustomFieldValues(initialCustomValues);

      setModalStep('EDIT');
      setPendingPayload(null);
      const canRet = (device.stage === 'COMPLETE' || device.stage === 'CONFIGURING') && Boolean(device.mid || device.merchantName);
      setReturnMode(preset === 'RETURN' && canRet);
      setReturnTo('BRANCH_RESERVE');
      setReturnReason('Merchant Closed Business');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceSerial, preset]);

  // Synchronize battery serial and commissioning date when replaced via ChangeBatteryModal
  useEffect(() => {
    if (device) {
      setBatterySerial(device.batterySerial || '');
      setBatteryInstalledDate(device.batteryInstalledDate || device.stockInDate || '');
    }
  }, [device?.batterySerial, device?.batteryInstalledDate]);
  const canReturn = false;

  /** Stages this unit may move to from where it is now (plus staying put). Branch users never move a unit into HQ stock. */
  const stageOptions = useMemo(() => {
    if (!device) return [] as LifecycleStage[];
    const allowed = new Set<LifecycleStage>([device.stage, ...ALLOWED_NEXT[device.stage]]);
    return STAGE_ORDER.filter(
      (s) => allowed.has(s) && (s === device.stage || isAdminLike || s !== 'HQ_STOCK')
    );
  }, [device, isAdminLike]);

  // selectedBranchObj resolved dynamically
  const [staffQuery, setStaffQuery] = useState('');

  const allStaffOptions = useMemo(() => {
    const list: Array<{
      name: string;
      empId?: string;
      branchId: string;
      telegram?: string;
      label: string;
      isCurrentBranch: boolean;
    }> = [];
    const seenNames = new Set<string>();
    const seenEmpIds = new Set<string>();

    const targetBranchId = String(branchId || '').trim();

    // 1. Primary Staff Directory & IAM Accounts belonging ONLY to the selected branch
    if (users && users.length > 0) {
      for (const u of users) {
        if (u.status === 'Suspended') continue;
        const uBranch = String(u.branchId || '').trim();
        if (targetBranchId && uBranch !== targetBranchId) continue;

        const baseName = normalizeStaffName(u.name);
        if (!baseName) continue;
        const nameKey = baseName.toLowerCase();
        const empIdKey = u.empId?.trim().toLowerCase();

        if (seenNames.has(nameKey) || (empIdKey && seenEmpIds.has(empIdKey))) {
          continue;
        }
        seenNames.add(nameKey);
        if (empIdKey) seenEmpIds.add(empIdKey);

        list.push({
          name: baseName,
          empId: u.empId?.trim(),
          branchId: uBranch,
          telegram: u.telegramUsername?.trim(),
          label: `${baseName}${u.empId ? ` (${u.empId})` : ''}`,
          isCurrentBranch: true,
        });
      }
    }

    // 2. Branch staff fallback for ONLY the selected branch
    const currentBranchObj = branches.find((b) => String(b.code || b.id).trim() === targetBranchId);
    if (currentBranchObj) {
      for (const s of currentBranchObj.staff || []) {
        const baseName = normalizeStaffName(s);
        if (!baseName) continue;
        const nameKey = baseName.toLowerCase();
        const embeddedEmpId = extractEmpIdFromName(s)?.toLowerCase();

        if (seenNames.has(nameKey) || (embeddedEmpId && seenEmpIds.has(embeddedEmpId))) {
          continue;
        }
        seenNames.add(nameKey);
        if (embeddedEmpId) seenEmpIds.add(embeddedEmpId);

        list.push({
          name: baseName,
          empId: embeddedEmpId,
          branchId: targetBranchId,
          label: `${baseName}${embeddedEmpId ? ` (${embeddedEmpId})` : ''}`,
          isCurrentBranch: true,
        });
      }
    }

    // 3. Currently assigned staff on this device (if already recorded)
    if (staff) {
      const baseStaff = normalizeStaffName(resolveStaffFromDirectory(staff, targetBranchId, users));
      if (baseStaff && !seenNames.has(baseStaff.toLowerCase())) {
        list.push({
          name: baseStaff,
          branchId: targetBranchId,
          label: baseStaff,
          isCurrentBranch: true,
        });
      }
    }

    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [users, branches, branchId, staff]);

  const availableStaff = useMemo(() => {
    return allStaffOptions.map((s) => s.name);
  }, [allStaffOptions]);

  if (!device) return null;

  const handleStageChange = (newStage: LifecycleStage) => {
    setStage(newStage);
    setMidError('');
    if (newStage === 'HQ_STOCK') {
      setBranchId('100');
      setStaff(operatorLabel.trim());
    } else if (newStage === 'COMPLETE' && !deployedDate) {
      setDeployedDate(todayPP());
    }
  };

  const handleBranchChange = (newBranchCode: string) => {
    setBranchId(newBranchCode);
    // The officer is chosen explicitly; nobody is pre-selected on a branch change.
    setStaff('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const fail = (msg: string) => {
      setMidError(msg);
      return;
    };

    if (returnMode) {                                                   // Return: merchant details removed, unit back to stock
      const why = `Returned: ${returnReason}${note.trim() ? ' – ' + note.trim() : ''}`;
      if (returnTo === 'HQ_STOCK' && isAdminLike) {
        setPendingPayload({ ...quickMove('HQ_STOCK', 'RETURN_ADMIN_STOCK', 'Return to Stock · Admin HQ (Code 100)', '100', operatorLabel.trim(), why), note: why });
      } else {
        if (!device.branchId || device.branchId === '100') return fail('This unit has no branch to hold it. Return it to Admin HQ stock instead.');
        setPendingPayload({ ...quickMove('BRANCH_RESERVE', 'RETURN_BRANCH_RESERVE', `Return to Stock · Branch Code ${device.branchId} reserve`, device.branchId, device.staff || '', why), note: why });
      }
      setMidError('');
      setEditedSerial(device.serial);
      setSerialRenameMsg('');
      setModalStep('PREVIEW');
      return;
    }

    // 1. The move itself must be allowed by the device life cycle.
    const stageErr = role === 'SUPER_ADMIN' ? '' : moveError(device.stage, stage, STAGE_META);   // the super admin may move a unit to any stage
    if (stageErr) return fail(stageErr);
    if (!stageOptions.includes(stage)) return fail('Only Admin HQ can move a unit into Head Office stock.');

    if (stage !== 'FAULTY' && stage !== 'LOST' && mid.trim() && !isValidMidForType(mid.trim(), device.type)) {
      return fail(midRuleError(mid.trim(), device.type) || 'Invalid MID format.');
    }

    // FAULTY stays FAULTY (it is never converted to another stage here). The choice only says where the faulty unit
    // is held: at its branch, or (Admin HQ only) back at Head Office (Branch Code 100).
    let finalBranchId = branchId;
    let finalStaff = staff;
    if (stage === 'HQ_STOCK') {
      finalBranchId = '100';
      finalStaff = operatorLabel.trim() || staff;
    } else if (stage === 'FAULTY' && terminateDestination === 'HQ_STOCK' && isAdminLike) {
      finalBranchId = '100';
      finalStaff = operatorLabel.trim() || staff;
    }
    if ((stage === 'BRANCH_RESERVE' || stage === 'CONFIGURING' || stage === 'COMPLETE') && (!finalBranchId || finalBranchId === '100')) {
      return fail('Choose the branch that holds this unit (not Head Office Code 100).');
    }
    if (stage === 'COMPLETE') {
      if (!merchantName.trim()) return fail('Enter the merchant name for an installed unit.');
      if (!isValidMidForType(mid.trim(), device.type)) return fail(midRuleError(mid.trim(), device.type) || 'Enter a valid 15-digit MID for an installed unit.');
      if (!deployedDate) return fail('Choose the installation date.');
    }

    // Validate required custom fields (branch staff may leave the phone blank to keep the one on record).
    for (const f of activeCustomFields) {
      const v = customFieldValues[f.id]?.trim() || (f.id === 'merchantPhone' ? device.merchantPhone || '' : '');
      if (f.required && !v.trim()) return fail(`Attribute "${f.label}" is required by system settings.`);
    }

    const origBatterySerial = device.batterySerial || '';
    const origBatteryDate = device.batteryInstalledDate || device.stockInDate || '';
    const isBatteryChanged =
      batterySerial.trim() !== origBatterySerial || batteryInstalledDate !== origBatteryDate;
    if (isBatteryChanged && device.type === 'POS Terminal' && !batterySerial.trim()) {
      return fail('Enter the serial printed on the new battery (or use the Battery Replacement Wizard).');
    }
    if (batteryInstalledDate && batteryInstalledDate > todayPP()) return fail('The battery date cannot be in the future.');
    setMidError('');

    const locVal = customFieldValues['location'] ?? device.location ?? '';
    const phoneVal = customFieldValues['merchantPhone']?.trim() || device.merchantPhone || '';
    const addrVal = customFieldValues['address'] ?? device.address ?? '';

    // 2. Apply the move: status texts for the stage, and no merchant details once the unit leaves the merchant.
    const moved = onMove(
      {
        ...device,
        branchId: finalBranchId,
        merchantName: merchantName.trim(),
        mid: mid.trim(),
        tid: (/^\d{15}$/.test(mid.trim()) ? mid.trim().slice(-8) : tid.trim()),
        merchantPhone: phoneVal,
        location: locVal,
        address: addrVal,
      },
      stage
    );

    const targetBranch = branches.find((b) => b.code === finalBranchId);
    const leftMerchant = !!device.merchantName && !moved.merchantName;
    const generatedNote =
      note.trim() ||
      (stage === 'FAULTY'
        ? `Device marked faulty / returned${finalBranchId === '100' ? ' and held at Admin HQ (Branch Code 100)' : ` and held at Branch Code ${finalBranchId}`}`
        : stage === 'LOST'
        ? 'Device marked as Device Lost in system inventory'
        : stage !== device.stage
        ? `Stage changed from ${STAGE_META[device.stage].short} to ${STAGE_META[stage].short}${leftMerchant ? ` (merchant ${device.merchantName} detached)` : ''}`
        : 'Device details updated') +
        (isBatteryChanged && !note.trim() ? ` | Battery ${batterySerial.trim()} installed ${batteryInstalledDate}` : '');

    setPendingPayload({
      actionType: 'SAVE',
      actionTitle: 'Save Device Lifecycle & Custody Updates',
      stage: moved.stage,
      deploymentStatus: moved.deploymentStatus,
      stockStatus: moved.stockStatus,
      branchId: finalBranchId,
      branchName: targetBranch ? targetBranch.name : `Branch Code ${finalBranchId}`,
      staff: normalizeStaffName(finalStaff),
      merchantName: moved.merchantName,
      merchantPhone: moved.merchantPhone,
      location: moved.location,
      address: moved.address,
      mid: moved.mid,
      tid: moved.tid,
      note: generatedNote,
      deployedDate,
      batteryInstalledDate,
      batterySerial: batterySerial.trim(),
      isBatteryChanged,
      customFields: { ...customFieldValues, merchantPhone: moved.merchantPhone || '' },
    });
    setModalStep('PREVIEW');
  };

  /** Payload for a quick action that moves the unit (status texts and merchant clearing from onMove). */
  const quickMove = (
    to: LifecycleStage,
    actionType: PendingPayload['actionType'],
    actionTitle: string,
    targetCode: string,
    targetStaff: string,
    defaultNote: string
  ): PendingPayload => {
    const moved = onMove({ ...device, branchId: targetCode }, to);
    const targetBranch = branches.find((b) => b.code === targetCode);
    return {
      actionType,
      actionTitle,
      stage: moved.stage,
      deploymentStatus: moved.deploymentStatus,
      stockStatus: moved.stockStatus,
      branchId: targetCode,
      branchName: targetBranch ? targetBranch.name : `Branch Code ${targetCode}`,
      staff: targetStaff,
      merchantName: moved.merchantName,
      merchantPhone: moved.merchantPhone,
      location: moved.location,
      address: moved.address,
      mid: moved.mid,
      tid: moved.tid,
      note: note.trim() || defaultNote,
      deployedDate: device.deployedDate || '',
      batteryInstalledDate: device.batteryInstalledDate || device.stockInDate || '',
      batterySerial: device.batterySerial || '',
      isBatteryChanged: false,
    };
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
          deploymentStatus: pendingPayload.deploymentStatus,
          stockStatus: pendingPayload.stockStatus,
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
          deploymentStatus: pendingPayload.deploymentStatus,
          stockStatus: pendingPayload.stockStatus,
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
      deploymentStatus: pendingPayload.deploymentStatus,
      stockStatus: pendingPayload.stockStatus,
    });
    onClose();
  };

  const previewBatteryInfo = getBatteryLifecycleStatus(
    {
      batteryInstalledDate,
      stockInDate: device.stockInDate,
      deployedDate,
    },
    todayPP()
  );

  // Quick actions are offered only when the life cycle allows the move.
  const canReturnToReserve =
    (!!device.merchantName || device.stage === 'COMPLETE') &&
    device.branchId !== '100' &&
    (role === 'SUPER_ADMIN' || canMove(device.stage, 'BRANCH_RESERVE'));
  const canReturnToHq =
    device.stage !== 'HQ_STOCK' &&
    (role === 'SUPER_ADMIN' || canMove(device.stage, 'HQ_STOCK')) &&
    (isAdminLike ? !!onReturnToAdminStock : !!onRequestReturnToAdminStock);
  const hasQuickActions = canReturnToReserve || canReturnToHq || (isAdminLike && stage === 'CONFIGURING' && !!onNotifyConfigReady);

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
          className={`relative w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden my-auto max-h-[92vh] z-10 border-0 flex flex-col ${
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
                    {device.batterySerial || 'Battery serial not recorded'}
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
              aria-label="Close"
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
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-semibold tracking-wide transition cursor-pointer text-xs ${
                  modalStep === 'EDIT'
                    ? 'bg-[#004953] text-white shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'
                }`}
              >
                <span className="w-3.5 h-3.5 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-bold">
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
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-semibold tracking-wide transition text-xs ${
                  modalStep === 'PREVIEW'
                    ? 'bg-[#004953] text-white shadow-xs'
                    : pendingPayload
                    ? 'text-slate-600 hover:text-slate-900 dark:hover:text-white cursor-pointer'
                    : 'text-slate-400 opacity-60 cursor-not-allowed'
                }`}
              >
                <span className="w-3.5 h-3.5 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-bold">
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
                    {canReturnToReserve && (
                      <button
                        type="button"
                        onClick={() => {
                          setPendingPayload(
                            quickMove(
                              'BRANCH_RESERVE',
                              'RETURN_BRANCH_RESERVE',
                              'Return Unit from Merchant to Branch Reserve',
                              device.branchId,
                              device.staff || '',
                              `Returned from merchant ${device.merchantName || ''} back to Branch Reserve`.replace('  ', ' ')
                            )
                          );
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

                    {canReturnToHq && (
                      <button
                        type="button"
                        onClick={() => {
                          if (isAdminLike && onReturnToAdminStock) {
                            setPendingPayload(
                              quickMove(
                                'HQ_STOCK',
                                'RETURN_ADMIN_STOCK',
                                'Return Unit to Head Office Admin Stock (Code 100)',
                                '100',
                                operatorLabel.trim(),
                                'Returned back to Admin HQ Stock (Branch Code 100)'
                              )
                            );
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

                    {isAdminLike && stage === 'CONFIGURING' && onNotifyConfigReady && (
                      notifyCooldownSecs > 0 ? (
                        <button
                          type="button"
                          disabled
                          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 cursor-not-allowed opacity-90"
                          title={`Telegram alert sent! 1-minute cooldown active (${notifyCooldownSecs}s remaining)`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                          <span>Pushed · {notifyCooldownSecs}s</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleNotifyWith2Clicks}
                          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-150 cursor-pointer active:scale-[0.97] ${
                            confirmingNotify
                              ? 'bg-amber-600 hover:bg-amber-700 text-white ring-2 ring-amber-400 animate-pulse shadow-sm'
                              : 'bg-[#003857] hover:bg-[#002a42] text-white shadow-xs'
                          }`}
                          title={
                            confirmingNotify
                              ? `Click 2nd time to confirm Telegram notification (${notifyConfirmSecs}s window)`
                              : 'Click once, then click 2nd time within 1 minute to send Telegram alert'
                          }
                        >
                          {confirmingNotify ? (
                            <>
                              <AlertCircle className="w-3.5 h-3.5 text-amber-200" />
                              <span>Click 2nd Time to Confirm Push ({notifyConfirmSecs}s)</span>
                            </>
                          ) : (
                            <>
                              <Send className="w-3.5 h-3.5" />
                              <span>Notify Staff &amp; Alert Telegram (Open Device for App Push)</span>
                            </>
                          )}
                        </button>
                      )
                    )}

                  </div>
                </div>
              )}

              {/* Form Body */}
              <form onSubmit={handleSubmit} className="p-4 sm:p-5 flex flex-col gap-3 overflow-y-auto max-h-[calc(88vh-130px)] custom-scrollbar">
            {/* Section 0: Admin Serial Number Correction */}
            {isAdminLike && onRenameSerial && (
              <div className={`p-3.5 rounded-2xl border transition-colors ${
                isLight ? 'bg-slate-100/90 border-slate-200 shadow-2xs' : 'bg-[#181c26] border-slate-700/80'
              }`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-sky-100 text-[#003857] dark:bg-sky-950/60 dark:text-sky-300 flex items-center justify-center shrink-0">
                      <Pencil className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        Hardware Serial Correction
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Super Admin / Admin typo correction for uploaded or scanned hardware
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      type="text"
                      value={editedSerial}
                      onChange={(e) => {
                        setEditedSerial(e.target.value.toUpperCase());
                        setSerialRenameMsg('');
                      }}
                      aria-label="Edit hardware serial number"
                      className={`w-48 rounded-xl px-3 py-1.5 text-xs font-mono font-bold border focus:outline-none transition ${
                        isLight ? 'bg-white border-slate-300 text-slate-900 focus:border-[#003857]' : 'bg-[#121620] border-slate-700 text-white focus:border-sky-500'
                      }`}
                    />
                    <button
                      type="button"
                      disabled={renamingSerial || !editedSerial.trim() || editedSerial.trim().toUpperCase() === device.serial.toUpperCase()}
                      onClick={async () => {
                        const nextSn = editedSerial.trim().toUpperCase();
                        if (!nextSn || nextSn === device.serial.toUpperCase()) return;
                        setRenamingSerial(true);
                        setSerialRenameMsg('');
                        try {
                          const err = await onRenameSerial(device.serial, nextSn);
                          if (err) {
                            setSerialRenameMsg(err);
                          } else {
                            setSerialRenameMsg('Serial updated!');
                          }
                        } finally {
                          setRenamingSerial(false);
                        }
                      }}
                      className="px-3.5 py-1.5 rounded-xl bg-[#003857] hover:bg-[#002a42] text-white text-xs font-bold transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs"
                    >
                      {renamingSerial ? 'Updating…' : 'Update Serial'}
                    </button>
                  </div>
                </div>
                {serialRenameMsg && (
                  <div className={`text-[11px] font-semibold mt-2 ${serialRenameMsg === 'Serial updated!' ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {serialRenameMsg}
                  </div>
                )}
              </div>
            )}

            {/* Section 1: Lifecycle & Branch Assignment */}
            <div className={`p-4 rounded-2xl border space-y-3.5 transition-colors ${
              isLight ? 'bg-slate-100/90 border-slate-200 shadow-2xs' : 'bg-[#161a24] border-slate-700/70'
            }`}>
              <div className="flex items-center gap-2 pb-2.5 border-b border-slate-200/60 dark:border-white/[0.06]">
                <div className="w-7 h-7 rounded-lg bg-[#003857]/10 text-[#003857] dark:bg-sky-400/10 dark:text-sky-400 flex items-center justify-center shrink-0">
                  <Layers className="w-3.5 h-3.5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                    1. Lifecycle &amp; Branch Custody
                  </h4>
                  <p className="text-[10.5px] text-slate-500 dark:text-slate-400">
                    Current deployment status stage and holding branch assignment
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* Lifecycle Status Stage */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <span>Lifecycle Status Stage</span>
                    <span className="text-rose-500 font-bold">*</span>
                  </label>
                  <div className="relative">
                    <select
                      value={returnMode ? '__RETURN__' : stage}
                      aria-label="Lifecycle stage"
                      onChange={(e) => {
                        if (e.target.value === '__RETURN__') { setReturnMode(true); setMidError(''); return; }
                        setReturnMode(false);
                        handleStageChange(e.target.value as LifecycleStage);
                      }}
                      className={`w-full appearance-none rounded-xl px-3 py-2 text-xs font-medium border focus:outline-none transition cursor-pointer pr-10 ${
                        isLight
                          ? 'bg-white hover:bg-slate-50 border-slate-200 text-slate-900 focus:ring-2 focus:ring-[#003857]/10 focus:border-[#003857]'
                          : 'bg-[#121620] hover:bg-[#1a202e] border-slate-700 text-white focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500'
                      }`}
                    >
                      {stageOptions.map((s) => (
                        <option
                          key={s}
                          value={s}
                          className={isLight ? 'bg-white text-slate-900' : 'bg-slate-900 text-white'}
                        >
                          {STAGE_META[s].label}
                          {s === device.stage ? ' (current)' : ''}
                        </option>
                      ))}
                      {canReturn && (
                        <option value="__RETURN__" className={isLight ? 'bg-white text-slate-900' : 'bg-slate-900 text-white'}>
                          Return (remove merchant, back to stock)
                        </option>
                      )}
                    </select>
                    <ChevronDown className="w-4 h-4 text-slate-400 pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2" />
                  </div>
                </div>

                {/* Assigned Branch Code */}
                <div className="flex flex-col gap-1.5">
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                    <Building2 className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />
                    <span>Assigned Branch Code</span>
                    <span className="text-rose-500 font-bold">*</span>
                  </label>
                  <div className="relative">
                    <select
                      value={branchId}
                      onChange={(e) => handleBranchChange(e.target.value)}
                      aria-label="Assigned branch code"
                      disabled={!isAdminLike || stage === 'HQ_STOCK'}
                      className={`w-full appearance-none rounded-xl px-3 py-2 text-xs font-medium border focus:outline-none transition cursor-pointer pr-10 disabled:opacity-60 disabled:cursor-not-allowed ${
                        isLight
                          ? 'bg-white hover:bg-slate-50 border-slate-200 text-slate-900 focus:ring-2 focus:ring-[#003857]/10 focus:border-[#003857]'
                          : 'bg-[#121620] hover:bg-[#1a202e] border-slate-700 text-white focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500'
                      }`}
                    >
                      {branches.map((b) => (
                        <option
                          key={b.code}
                          value={b.code}
                          className={isLight ? 'bg-white text-slate-900' : 'bg-slate-900 text-white'}
                        >
                          Branch Code {b.code} — {b.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-4 h-4 text-slate-400 pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2" />
                  </div>
                </div>
              </div>

              {returnMode && (
                <div className={`p-3.5 rounded-xl border flex flex-col gap-2.5 ${isLight ? 'bg-amber-50/70 border-amber-200 text-slate-800' : 'bg-amber-950/20 border-amber-800/60 text-slate-100'}`}>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                    <RotateCcw className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Return to Stock</span>
                  </div>
                  <p className="text-[11.5px] text-slate-600 dark:text-slate-300">
                    The merchant's name, MID, TID, phone, address and installer are removed from this unit and kept in <strong>Merchant History</strong>. The unit goes back to stock:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button type="button" onClick={() => setReturnTo('BRANCH_RESERVE')} aria-pressed={returnTo === 'BRANCH_RESERVE'}
                      className={`px-3 py-2 rounded-xl text-xs font-semibold border flex items-center justify-center gap-2 cursor-pointer ${returnTo === 'BRANCH_RESERVE' ? 'bg-[#004953] text-white border-emerald-500/30 shadow-xs' : isLight ? 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300' : 'bg-[#181c26] hover:bg-[#202534] text-slate-300 border-slate-700'}`}>
                      <Building2 className="w-3.5 h-3.5" /><span>Branch Code {device.branchId} reserve</span>
                    </button>
                    {isAdminLike ? (
                      <button type="button" onClick={() => setReturnTo('HQ_STOCK')} aria-pressed={returnTo === 'HQ_STOCK'}
                        className={`px-3 py-2 rounded-xl text-xs font-semibold border flex items-center justify-center gap-2 cursor-pointer ${returnTo === 'HQ_STOCK' ? 'bg-[#004953] text-white border-emerald-500/30 shadow-xs' : isLight ? 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300' : 'bg-[#181c26] hover:bg-[#202534] text-slate-300 border-slate-700'}`}>
                        <RotateCcw className="w-3.5 h-3.5" /><span>Admin HQ stock (Code 100)</span>
                      </button>
                    ) : (
                      <span className="px-3 py-2 rounded-xl text-[11px] border border-dashed border-slate-300 text-slate-500 flex items-center justify-center text-center">To send it to HQ, use a stock return request afterwards</span>
                    )}
                  </div>
                  <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Reason for the return *
                    <select value={returnReason} onChange={(e) => setReturnReason(e.target.value)} aria-label="Reason for the return"
                      className={`w-full rounded-xl px-3 py-2 text-xs font-medium border focus:outline-none cursor-pointer ${isLight ? 'bg-white border-slate-200 text-slate-900' : 'bg-[#181c26] border-slate-700/80 text-white'}`}>
                      {['Merchant Closed Business', 'Merchant Relocated', 'Merchant Requested Return', 'Upgraded / Replaced Hardware', 'Voluntary KHQR Switch', 'Seasonal End', 'Other'].map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </label>
                </div>
              )}

              {stage === 'FAULTY' && (
                <div className={`p-3.5 rounded-xl border flex flex-col gap-2.5 ${
                  isLight ? 'bg-amber-50/70 border-amber-200 text-slate-800' : 'bg-amber-950/20 border-amber-800/60 text-slate-100'
                }`}>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                    <RotateCcw className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Where Is the Faulty Unit Held? *</span>
                  </div>
                  <p className="text-[11.5px] text-slate-600 dark:text-slate-300">
                    The unit is recorded as <strong>Faulty / Returned</strong> and its merchant details are detached. Choose where it is physically held now:
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
                      <span>Held at Branch Code {branchId}</span>
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
                        <span>Held at Admin HQ (Code 100)</span>
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
                <div className={`p-3.5 rounded-xl border flex flex-col gap-2 ${
                  isLight ? 'bg-amber-50/70 border-amber-200 text-slate-800' : 'bg-amber-950/20 border-amber-800/60 text-slate-100'
                }`}>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                    <SearchX className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Device Status: Device Lost / Missing</span>
                  </div>
                  <p className="text-[11.5px] text-slate-600 dark:text-slate-300">
                    This terminal or sound box will be flagged as <strong>Device Lost</strong> in the system inventory. Active merchant assignments will be detached and recorded in the audit trail.
                  </p>
                </div>
              )}
            </div>

            {/* (23 Oct 2026) Return: the merchant, officer and battery fields are not needed */}
            {!returnMode && (<>
              {/* Section 2: Staff Officer & Deployment Schedule */}
              <div className={`p-4 rounded-2xl border space-y-3.5 transition-colors ${
                isLight ? 'bg-slate-100/90 border-slate-200 shadow-2xs' : 'bg-[#161a24] border-slate-700/70'
              }`}>
                <div className="flex items-center justify-between pb-2.5 border-b border-slate-200/60 dark:border-white/[0.06]">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-[#003857]/10 text-[#003857] dark:bg-sky-400/10 dark:text-sky-400 flex items-center justify-center shrink-0">
                      <UserCheck className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                        2. Field Staff &amp; Deployment Schedule
                      </h4>
                      <p className="text-[10.5px] text-slate-500 dark:text-slate-400">
                        Technician responsible for configuration and scheduled installation date
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {/* Staff Officer */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                        <User className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />
                        <span>Assigned Branch Staff Officer</span>
                        <span className="text-rose-500 font-bold">*</span>
                      </label>
                      {staff && (
                        <button
                          type="button"
                          onClick={() => setStaff('')}
                          className="text-[11px] text-rose-500 hover:text-rose-600 font-medium cursor-pointer"
                        >
                          Clear
                        </button>
                      )}
                    </div>

                    {/* Quick Staff Search / Filter */}
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={staffQuery}
                        onChange={(e) => setStaffQuery(e.target.value)}
                        placeholder={`Search staff in Branch ${branchId || 'selected'}...`}
                        className={`w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border outline-none mb-1 ${
                          isLight
                            ? 'bg-white border-slate-200 text-slate-900 focus:border-[#003857]'
                            : 'bg-[#121620] border-slate-700 text-white focus:border-sky-500'
                        }`}
                      />
                    </div>

                    <div className="relative">
                      <select
                        value={staff}
                        aria-label="Assigned branch staff officer"
                        onChange={(e) => {
                          setStaff(e.target.value);
                          setStaffQuery('');
                        }}
                        className={`w-full appearance-none rounded-xl px-3 py-2 text-xs font-medium border focus:outline-none transition cursor-pointer pr-10 ${
                          isLight
                            ? 'bg-white hover:bg-slate-50 border-slate-200 text-slate-900 focus:ring-2 focus:ring-[#003857]/10 focus:border-[#003857]'
                            : 'bg-[#121620] hover:bg-[#1a202e] border-slate-700 text-white focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500'
                        }`}
                      >
                        <option value="" className={isLight ? 'bg-white text-slate-500' : 'bg-slate-900 text-slate-400'}>
                          -- Unassigned --
                        </option>
                        {staff && !availableStaff.includes(staff) && (
                          <option value={staff}>{staff} (Assigned)</option>
                        )}
                        {allStaffOptions
                          .filter((s) => !staffQuery || s.name.toLowerCase().includes(staffQuery.toLowerCase()) || (s.empId && s.empId.includes(staffQuery)) || (s.telegram && s.telegram.toLowerCase().includes(staffQuery.toLowerCase())))
                          .map((st) => (
                            <option
                              key={`${st.name}__${st.empId || ''}__${st.branchId}`}
                              value={st.name}
                              className={isLight ? 'bg-white text-slate-900' : 'bg-slate-900 text-white'}
                            >
                              {st.label}{st.telegram ? ` (@${st.telegram.replace(/^@/, '')})` : ''}
                            </option>
                          ))}
                        {allStaffOptions.length === 0 && (
                          <option disabled value="" className="text-slate-400 italic">
                            No staff assigned to Branch {branchId}
                          </option>
                        )}
                      </select>
                      <ChevronDown className="w-4 h-4 text-slate-400 pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2" />
                    </div>
                  </div>

                  {/* Installation / Deployment Date */}
                  <div className="flex flex-col gap-1.5">
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                      <Calendar className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />
                      <span>Installation / Deployment Date</span>
                      <span className="text-rose-500 font-bold">*</span>
                    </label>
                    <input
                      type="date"
                      value={deployedDate}
                      onChange={(e) => setDeployedDate(e.target.value)}
                      className={`w-full rounded-xl px-3 py-2 text-xs font-mono font-medium border focus:outline-none transition ${
                        isLight
                          ? 'bg-white hover:bg-slate-50 border-slate-200 text-slate-900 focus:ring-2 focus:ring-[#003857]/10 focus:border-[#003857]'
                          : 'bg-[#121620] hover:bg-[#1a202e] border-slate-700 text-white focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500'
                      }`}
                    />
                  </div>
                </div>
              </div>

              {/* Section 3: Merchant & Terminal Setup */}
              <div className={`p-4 rounded-2xl border space-y-3.5 transition-colors ${
                isLight ? 'bg-slate-100/90 border-slate-200 shadow-2xs' : 'bg-[#161a24] border-slate-700/70'
              }`}>
                <div className="flex items-center justify-between pb-2.5 border-b border-slate-200/60 dark:border-white/[0.06]">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-[#003857]/10 text-[#003857] dark:bg-sky-400/10 dark:text-sky-400 flex items-center justify-center shrink-0">
                      <Store className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                        3. Merchant &amp; Terminal Setup
                      </h4>
                      <p className="text-[10.5px] text-slate-500 dark:text-slate-400">
                        Merchant business name, 15-digit banking MID, and 8-digit Terminal ID
                      </p>
                    </div>
                  </div>
                </div>

                {merchantLocked && (
                  <div role="note" className="p-2.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-xs font-medium">
                    The merchant details of an installed unit can be changed by Admin HQ only. Please contact HQ if something is wrong.
                  </div>
                )}

                <fieldset disabled={merchantLocked} className="contents">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                    {/* Merchant Name */}
                    <div className="flex flex-col gap-1.5 sm:col-span-1">
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                        <Store className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />
                        <span>Merchant Name</span>
                        <span className="text-rose-500 font-bold">*</span>
                      </label>
                      <input
                        type="text"
                        value={merchantName}
                        onChange={(e) => {
                          const val = e.target.value;
                          setMerchantName(val);
                          if (isAdminLike && val.trim() && (stage === 'HQ_STOCK' || stage === 'BRANCH_RESERVE')) {
                            setStage('CONFIGURING');
                          }
                        }}
                        placeholder="e.g. Brown Coffee BKK"
                        className={`w-full rounded-xl px-3 py-2 text-xs font-medium border focus:outline-none transition ${
                          isLight
                            ? 'bg-white hover:bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-[#003857]/10 focus:border-[#003857]'
                            : 'bg-[#121620] hover:bg-[#1a202e] border-slate-700 text-white placeholder:text-slate-500 focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500'
                        }`}
                      />
                    </div>

                    {/* MID */}
                    <div className="flex flex-col gap-1.5">
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                        <span>Merchant ID (MID)</span>
                        <span className="text-rose-500 font-bold">*</span>
                      </label>
                      <input
                        type="text"
                        value={mid}
                        onChange={(e) => {
                          const clean = e.target.value.replace(/\D/g, '').slice(0, 15);
                          setMid(clean);
                          if (isAdminLike && clean.length > 0 && (stage === 'HQ_STOCK' || stage === 'BRANCH_RESERVE')) {
                            setStage('CONFIGURING');
                          }
                          setTid(clean.length >= 8 ? clean.slice(-8) : '');
                          if (midError) setMidError('');
                        }}
                        maxLength={15}
                        inputMode="numeric"
                        aria-label="Merchant ID (MID)"
                        placeholder="15-digit MID from merchant record"
                        className={`w-full rounded-xl px-3 py-2 text-xs font-mono font-medium border focus:outline-none transition ${
                          midError
                            ? 'border-rose-500 ring-2 ring-rose-500/20 bg-rose-50/50'
                            : isLight
                            ? 'bg-white hover:bg-slate-50 border-slate-200 text-slate-900 focus:ring-2 focus:ring-[#003857]/10 focus:border-[#003857]'
                            : 'bg-[#121620] hover:bg-[#1a202e] border-slate-700 text-white focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500'
                        }`}
                      />
                      <div className="flex items-center justify-between text-[10px] px-0.5">
                        {midError ? (
                          <span className="text-rose-600 font-semibold">{midError}</span>
                        ) : (
                          <span className="text-slate-400">
                            {device.type === 'Sound Box' ? '15 digits starting with 6' : '15 digits starting with 2'}
                          </span>
                        )}
                        <span className="font-mono text-slate-400">{mid.length}/15</span>
                      </div>
                    </div>

                    {/* TID */}
                    <div className="flex flex-col gap-1.5">
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                        <span>Terminal ID (TID)</span>
                        <span className="text-rose-500 font-bold">*</span>
                      </label>
                      <input
                        type="text"
                        value={mid.length >= 8 ? mid.slice(-8) : tid}
                        readOnly
                        title="Filled automatically: the last 8 digits of the MID"
                        placeholder="Automatic: last 8 digits of MID"
                        className={`w-full rounded-xl px-3 py-2 text-xs font-mono font-medium border focus:outline-none transition ${
                          isLight
                            ? 'bg-slate-200/60 border-slate-300/80 text-slate-700 placeholder:text-slate-400'
                            : 'bg-[#181c26] border-slate-700 text-white placeholder:text-slate-500'
                        }`}
                      />
                    </div>
                  </div>
                </fieldset>
              </div>

              {/* Dynamic Custom & Additional Fields Section */}
              {activeCustomFields.length > 0 && (
                <div
                  className={`p-4 rounded-2xl border flex flex-col gap-3 transition-colors ${
                    isLight
                      ? 'bg-slate-100/90 border-slate-200 shadow-2xs'
                      : 'bg-[#161a24] border-slate-700/70'
                  }`}
                >
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200/60 dark:border-white/[0.06]">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-[#003857]/10 text-[#003857] dark:bg-sky-400/10 dark:text-sky-400 flex items-center justify-center shrink-0">
                        <SlidersHorizontal className="w-3.5 h-3.5" />
                      </div>
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                        Additional Custom Attributes ({activeCustomFields.length})
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-medium font-mono">
                      Configured in Settings
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                        <div key={field.id} className="flex flex-col gap-1.5">
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
                                className={`w-full appearance-none rounded-xl px-3 py-2 text-xs font-medium border focus:outline-none transition cursor-pointer pr-10 ${
                                  isLight
                                    ? 'bg-white hover:bg-slate-50 border-slate-200 text-slate-900 focus:ring-2 focus:ring-[#003857]/10 focus:border-[#003857]'
                                    : 'bg-[#121620] hover:bg-[#1a202e] border-slate-700 text-white focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500'
                                }`}
                              >
                                <option value="">-- Choose {field.label} --</option>
                                {field.options.map((opt) => (
                                  <option key={opt} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                              <ChevronDown className="w-4 h-4 text-slate-400 pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2" />
                            </div>
                          ) : (
                            <input
                              type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                              value={val}
                              onChange={(e) =>
                                setCustomFieldValues((prev) => ({
                                  ...prev,
                                  [field.id]: e.target.value,
                                }))
                              }
                              placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}...`}
                              required={field.required && !(field.id === 'merchantPhone' && device.merchantPhone)}
                              className={`w-full rounded-xl px-3 py-2 text-xs font-medium border focus:outline-none transition ${
                                isLight
                                  ? 'bg-white hover:bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-[#003857]/10 focus:border-[#003857]'
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

              {/* Section 4: 24-Month POS Battery Lifecycle Card (Only displayed for POS Terminal or units with battery) */}
              {(device.type === 'POS Terminal' || (Boolean(device.batterySerial) && device.batterySerial?.trim() !== '' && device.batterySerial?.trim().toUpperCase() !== 'N/A')) && (
                <div
                  className={`p-4 rounded-2xl border flex flex-col gap-3 transition-colors ${
                    previewBatteryInfo.state === 'EXPIRED'
                      ? isLight
                        ? 'bg-rose-50/60 border-rose-200'
                        : 'bg-rose-950/20 border-rose-800/60'
                      : previewBatteryInfo.state === 'DUE_SOON'
                      ? isLight
                        ? 'bg-amber-50/60 border-amber-200'
                        : 'bg-amber-950/20 border-amber-800/60'
                      : isLight
                      ? 'bg-slate-100/90 border-slate-200 shadow-2xs'
                      : 'bg-[#161a24] border-slate-700/70'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-200/60 dark:border-white/[0.06]">
                    <div className="flex items-center gap-2">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                        previewBatteryInfo.state === 'EXPIRED'
                          ? 'bg-rose-100 text-rose-700'
                          : previewBatteryInfo.state === 'DUE_SOON'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        <BatteryCharging className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                          4. POS Terminal Battery Lifecycle (24-Month Standard)
                        </h4>
                        <p className="text-[10.5px] text-slate-500 dark:text-slate-400">
                          Track hardware battery health, age, and 24-month replacement standard
                        </p>
                      </div>
                    </div>
                    <span
                      className={`text-[10px] font-mono font-medium px-2.5 py-0.5 rounded-full border ${
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

                  {/* Status Message Banner with Direct "Replace Battery from Old to New" Button */}
                  <div
                    className={`p-2.5 sm:px-3.5 sm:py-2.5 rounded-xl text-[11px] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border ${
                      previewBatteryInfo.state === 'EXPIRED'
                        ? 'bg-rose-100/70 border-rose-200 text-rose-800 font-medium'
                        : previewBatteryInfo.state === 'DUE_SOON'
                        ? 'bg-amber-100/70 border-amber-200 text-amber-800 font-medium'
                        : isLight
                        ? 'bg-white border-slate-200 text-slate-600'
                        : 'bg-white/[0.04] border-white/10 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {previewBatteryInfo.state === 'EXPIRED' ? (
                        <>
                          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                          <span>
                            Battery reached {previewBatteryInfo.monthsUsed} months of service (&ge; 24-month limit). Replacement is required immediately!
                          </span>
                        </>
                      ) : previewBatteryInfo.state === 'DUE_SOON' ? (
                        <>
                          <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                          <span>
                            Battery is {previewBatteryInfo.monthsUsed} months old with {previewBatteryInfo.monthsRemaining} months remaining until 24-month expiration.
                          </span>
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span>
                            Battery in good standing ({previewBatteryInfo.monthsUsed} of 24 months elapsed · {previewBatteryInfo.monthsRemaining} months remaining).
                          </span>
                        </>
                      )}
                    </div>

                    {onChangeBattery && device && (
                      <button
                        type="button"
                        onClick={() => onChangeBattery(device)}
                        className="px-3.5 py-1.5 rounded-lg bg-[#003857] hover:bg-[#002a42] text-white text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs shrink-0 self-start sm:self-auto"
                        title="Click to replace battery from old to new"
                      >
                        <BatteryCharging className="w-3.5 h-3.5" />
                        <span>Replace Battery from Old to New</span>
                      </button>
                    )}
                  </div>

                  {/* Battery Fields */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                        <span>Battery Serial Number</span>
                        <span className="text-rose-500 font-bold">*</span>
                      </label>
                      <input
                        type="text"
                        value={batterySerial}
                        onChange={(e) => setBatterySerial(e.target.value)}
                        id="workflow-battery-serial"
                        aria-label="Battery serial number"
                        placeholder="Serial printed on battery (e.g. 160525A1234567)"
                        className={`w-full rounded-xl px-3 py-2 text-xs font-mono font-medium border focus:outline-none transition ${
                          isLight
                            ? 'bg-white hover:bg-slate-50 border-slate-200 text-slate-900 focus:ring-2 focus:ring-[#003857]/10 focus:border-[#003857]'
                            : 'bg-[#121620] hover:bg-[#1a202e] border-slate-700 text-white focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500'
                        }`}
                      />
                      <span className="text-[10px] text-slate-400 font-mono px-0.5">
                        Format: 160525A + 7 digits
                      </span>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                        <span>Battery Installed / Commissioned Date</span>
                        <span className="text-rose-500 font-bold">*</span>
                      </label>
                      <input
                        type="date"
                        value={batteryInstalledDate}
                        max={todayPP()}
                        aria-label="Battery installed date"
                        onChange={(e) => setBatteryInstalledDate(e.target.value)}
                        className={`w-full rounded-xl px-3 py-2 text-xs font-mono font-medium border focus:outline-none transition ${
                          isLight
                            ? 'bg-white hover:bg-slate-50 border-slate-200 text-slate-900 focus:ring-2 focus:ring-[#003857]/10 focus:border-[#003857]'
                            : 'bg-[#121620] hover:bg-[#1a202e] border-slate-700 text-white focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500'
                        }`}
                      />
                      <span className="text-[10px] text-slate-400 font-mono px-0.5">
                        24M Expiry Date: <strong className="text-slate-700 dark:text-slate-200">{previewBatteryInfo.dueDate}</strong>
                      </span>
                    </div>
                  </div>

                  {/* Battery Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-slate-200/60 dark:border-slate-700/60">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span>Currently Installed:</span>
                      <strong className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                        {device.batterySerial || 'Not recorded'}
                      </strong>
                    </div>

                    <div className="flex items-center gap-2">
                      {onChangeBattery && device && (
                        <button
                          type="button"
                          onClick={() => onChangeBattery(device)}
                          className="px-4 py-2 rounded-xl bg-[#003857] hover:bg-[#002a42] text-white text-xs font-bold tracking-wide flex items-center justify-center gap-2 transition cursor-pointer shadow-xs"
                          title="Open 2-step verification wizard to replace battery from old to new"
                        >
                          <BatteryCharging className="w-4 h-4" />
                          <span>Replace Battery from Old to New</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>)}

            {/* Section 5: Audit Note / Update Reason */}
            <div className={`p-4 rounded-2xl border space-y-2.5 transition-colors ${
              isLight ? 'bg-slate-100/90 border-slate-200 shadow-2xs' : 'bg-[#161a24] border-slate-700/70'
            }`}>
              <div className="flex items-center gap-2 pb-2 border-b border-slate-200/60 dark:border-white/[0.06]">
                <div className="w-7 h-7 rounded-lg bg-[#003857]/10 text-[#003857] dark:bg-sky-400/10 dark:text-sky-400 flex items-center justify-center shrink-0">
                  <FileText className="w-3.5 h-3.5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <span>Audit Note &amp; Update Reason</span>
                    <span className="text-rose-500 font-bold">*</span>
                  </h4>
                  <p className="text-[10.5px] text-slate-500 dark:text-slate-400">
                    Required note documenting reason for stage change, merchant deployment, or branch transfer
                  </p>
                </div>
              </div>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Describe reason for stage change, merchant deployment, or branch transfer..."
                className={`w-full rounded-xl px-3 py-2 text-xs font-medium border focus:outline-none transition ${
                  isLight
                    ? 'bg-white hover:bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-[#003857]/10 focus:border-[#003857]'
                    : 'bg-[#121620] hover:bg-[#1a202e] border-slate-700 text-white placeholder:text-slate-500 focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500'
                }`}
              />
            </div>

            {/* Footer */}
            <div
              className={`flex items-center justify-end gap-2 pt-2.5 border-t ${
                isLight ? 'border-slate-100' : 'border-slate-800/80'
              }`}
            >
              {role === 'SUPER_ADMIN' && onDeletePermanently && device && (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Delete ${device.serial} permanently from the whole system?\n\nThis removes the unit and its history. It cannot be undone.`)) {
                      onDeletePermanently(device.serial);
                      onClose();
                    }
                  }}
                  className="btn-press mr-auto px-3.5 py-1.5 rounded-xl text-xs font-semibold border border-rose-300 text-rose-700 bg-white hover:bg-rose-50 cursor-pointer"
                >
                  Delete Permanently
                </button>
              )}
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
                className="px-4 py-1.5 rounded-xl bg-[#003857] hover:bg-[#002a42] text-white text-xs font-semibold tracking-wide shadow-xs transition cursor-pointer flex items-center gap-1.5"
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
                <div className="font-bold text-xs flex flex-wrap items-center gap-2">
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
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
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
                                ? phoneFor(role, device.merchantPhone)
                                : ''
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
                      {device.batterySerial || 'Not recorded'}
                      <span className="text-slate-400 ml-1.5 font-sans text-[11px]">
                        (Installed: {device.batteryInstalledDate || device.stockInDate || '—'})
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
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#1e5b88] dark:text-sky-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-sky-500" />
                    <span>Proposed Update (After / Preview)</span>
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-200/80 text-sky-950 dark:bg-sky-800/80 dark:text-sky-100 font-bold">
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
                      <span className={pendingPayload.stage !== device.stage ? 'text-[#1e5b88] dark:text-sky-300 font-bold' : ''}>
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
                    <div className={`mt-1 font-bold ${pendingPayload.branchId !== device.branchId ? 'text-[#1e5b88] dark:text-sky-300' : ''}`}>
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
                                <span>
                                  {(f.id === 'merchantPhone' && nextVal ? phoneFor(role, nextVal) : nextVal) || (
                                    <span className="text-slate-400 italic font-normal">Not set</span>
                                  )}
                                </span>
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
                className="px-5 py-2 rounded-xl bg-[#003857] hover:bg-[#002a42] text-white text-xs font-semibold tracking-wide shadow-md transition cursor-pointer flex items-center gap-2"
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

import React, { useState, useEffect, useMemo } from 'react';
import {
  Device,
  Branch,
  LifecycleStage,
  ThemeMode,
  MobileWebhookEvent,
  MobileInstallSyncPayload,
} from '../types';
import { STAGE_META } from '../data/initialData';
import { motion, AnimatePresence } from 'motion/react';
import {
  Smartphone,
  Wifi,
  BatteryCharging,
  Send,
  CheckCircle2,
  MapPin,
  Store,
  Cpu,
  Volume2,
  Wrench,
  Truck,
  AlertTriangle,
  Shuffle,
  ArrowRight,
  Clock,
  Scale,
  RefreshCw,
  AlertOctagon,
  Check,
  Sparkles,
  FilePlus2,
  ChevronDown,
  ChevronUp,
  Hash,
  KeyRound,
  Phone,
  UserCheck,
  FileText,
  Signal,
  Building2,
  RotateCcw,
  SearchX,
  Copy,
  ExternalLink,
  Radio,
  Layers,
} from 'lucide-react';

interface MobileSyncTabProps {
  devices: Device[];
  branches: Branch[];
  activeBranchId: string;
  activeStaff: string;
  webhookEvents: MobileWebhookEvent[];
  sseConnected: boolean;
  onTriggerMobileSync: (payload: MobileInstallSyncPayload) => Promise<void>;
  onReconcileWebhookEvents?: (
    eventsToApply: MobileWebhookEvent[],
    mode: 'SINGLE' | 'BATCH'
  ) => void;
  onReplaceDevice?: (
    faultySerial: string,
    replacementSerial: string,
    reason: string,
    replaceStaff?: string
  ) => void;
  onOpenWorkflow: (serial: string) => void;
  theme?: ThemeMode;
}

export type DiscrepancyType =
  | 'UNREGISTERED_SERIAL'
  | 'STAGE_DRIFT'
  | 'MID_TID_MISMATCH'
  | 'BRANCH_MISMATCH'
  | 'MISSING_WEBHOOK';

export interface ReconciliationDiscrepancy {
  id: string;
  serial: string;
  type: DiscrepancyType;
  severity: 'CRITICAL' | 'WARNING';
  title: string;
  summary: string;
  webhookValue: string;
  registryValue: string;
  latestEvent?: MobileWebhookEvent;
  localDevice?: Device;
  canAutoResolve: boolean;
  syntheticEvent?: MobileWebhookEvent;
}

export const MobileSyncTab: React.FC<MobileSyncTabProps> = ({
  devices,
  branches,
  activeBranchId,
  activeStaff,
  webhookEvents,
  sseConnected,
  onTriggerMobileSync,
  onReconcileWebhookEvents,
  onReplaceDevice,
  onOpenWorkflow,
  theme = 'dark',
}) => {
  const isLight = theme === 'light';

  const installableDevices = devices.filter((d) => d.stage !== 'HQ_STOCK');
  const defaultDevice =
    installableDevices.find((d) => d.stage === 'CONFIGURING') ||
    installableDevices[0] ||
    devices[0];

  const [selectedSerial, setSelectedSerial] = useState<string>(
    defaultDevice?.serial || 'SB-00012'
  );
  const [stage, setStage] = useState<LifecycleStage>('COMPLETE');
  const [branchId, setBranchId] = useState<string>(
    defaultDevice?.branchId && defaultDevice.branchId !== '100'
      ? defaultDevice.branchId
      : activeBranchId
  );
  const [installerName, setInstallerName] = useState<string>(
    defaultDevice?.staff || activeStaff || 'SOK Dara (27811)'
  );
  const [mid, setMid] = useState<string>(defaultDevice?.mid || 'MID-880105-01');
  const [tid, setTid] = useState<string>(defaultDevice?.tid || 'TID-10501');
  const [merchantName, setMerchantName] = useState<string>(
    defaultDevice?.merchantName || 'Brown Coffee Norodom'
  );
  const [merchantPhone, setMerchantPhone] = useState<string>(
    defaultDevice?.merchantPhone || '012 889 102'
  );
  const [address, setAddress] = useState<string>(
    defaultDevice?.address || 'Preah Norodom Blvd, Phnom Penh'
  );
  const [gpsLocation, setGpsLocation] = useState<string>(
    defaultDevice?.location || '11.5621° N, 104.9260° E · Phnom Penh'
  );
  const [notes, setNotes] = useState<string>(
    'Verified QR audio & terminal network check on-site'
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dynamicIslandState, setDynamicIslandState] = useState<
    'IDLE' | 'SYNCING' | 'SUCCESS'
  >('IDLE');
  const [mobileTerminateDestination, setMobileTerminateDestination] = useState<
    'BRANCH_RESERVE' | 'HQ_STOCK'
  >('BRANCH_RESERVE');

  // Automated Reconciliation State
  const [reconciliationOpen, setReconciliationOpen] = useState<boolean>(false);
  const [isScanningReconciliation, setIsScanningReconciliation] =
    useState<boolean>(false);
  const [lastAuditTimestamp, setLastAuditTimestamp] = useState<string>(
    new Date().toISOString().slice(0, 19).replace('T', ' ')
  );
  const [reconciliationFilter, setReconciliationFilter] = useState<
    'ALL' | 'CRITICAL' | 'WARNING' | 'VERIFIED'
  >('ALL');

  // Live Field Feed Filter & Endpoint Copy State
  const [feedFilter, setFeedFilter] = useState<'ALL' | 'POS' | 'SB' | 'DRIFT'>('ALL');
  const [copiedEndpoint, setCopiedEndpoint] = useState<string | null>(null);

  const handleCopyEndpoint = (endpoint: string) => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(endpoint);
    }
    setCopiedEndpoint(endpoint);
    setTimeout(() => {
      setCopiedEndpoint((prev) => (prev === endpoint ? null : prev));
    }, 2000);
  };

  const currentDevice =
    devices.find((d) => d.serial === selectedSerial) || defaultDevice;

  useEffect(() => {
    const dev = devices.find((d) => d.serial === selectedSerial);
    if (!dev) return;

    const bCode =
      dev.branchId && dev.branchId !== '100' ? dev.branchId : activeBranchId;
    setBranchId(bCode);
    setInstallerName(dev.staff || activeStaff || 'Field Technician');

    const seq = dev.serial.slice(-2).replace(/\D/g, '') || '15';
    setMid(dev.mid && dev.mid.trim() !== '' ? dev.mid : `MID-880${bCode}-${seq}`);
    setTid(dev.tid && dev.tid.trim() !== '' ? dev.tid : `TID-${bCode}${seq}`);
    setMerchantName(
      dev.merchantName && dev.merchantName.trim() !== ''
        ? dev.merchantName
        : 'Lucky Supermarket BKK1'
    );
    setMerchantPhone(dev.merchantPhone || '012 990 315');
    setAddress(dev.address || 'St 51, Boeung Keng Kang 1, Phnom Penh');
    setGpsLocation(dev.location || '11.5540° N, 104.9282° E · Phnom Penh');

    if (dev.stage === 'BRANCH_RESERVE') {
      setStage('CONFIGURING');
    } else {
      setStage('COMPLETE');
    }
  }, [selectedSerial, devices, activeBranchId, activeStaff]);

  // Client-Side Cross-Check Engine
  const reconciliationReport = useMemo(() => {
    const deviceMap = new Map<string, Device>();
    devices.forEach((d) => {
      deviceMap.set(d.serial.trim().toUpperCase(), d);
    });

    const latestEventBySerial = new Map<string, MobileWebhookEvent>();
    webhookEvents.forEach((evt) => {
      const key = evt.serial.trim().toUpperCase();
      if (!latestEventBySerial.has(key)) {
        latestEventBySerial.set(key, evt);
      }
    });

    const discrepancies: ReconciliationDiscrepancy[] = [];
    const verifiedMatches: Array<{
      serial: string;
      event: MobileWebhookEvent;
      device: Device;
    }> = [];

    latestEventBySerial.forEach((evt, serialKey) => {
      const localDev = deviceMap.get(serialKey);

      if (!localDev) {
        discrepancies.push({
          id: `DISC-UNREG-${evt.serial}`,
          serial: evt.serial,
          type: 'UNREGISTERED_SERIAL',
          severity: 'CRITICAL',
          title: 'Unregistered Hardware Serial',
          summary: `Webhook ${evt.eventId} reported serial ${evt.serial}, which is missing from the local registry.`,
          webhookValue: `${evt.newStage} · ${evt.merchantName} (${evt.mid})`,
          registryValue: 'Not Registered',
          latestEvent: evt,
          canAutoResolve: true,
        });
        return;
      }

      let hasDiscrepancyForSerial = false;

      if (localDev.stage !== evt.newStage) {
        hasDiscrepancyForSerial = true;
        discrepancies.push({
          id: `DISC-STAGE-${evt.serial}`,
          serial: evt.serial,
          type: 'STAGE_DRIFT',
          severity: 'CRITICAL',
          title: 'Lifecycle Stage Drift',
          summary: `Mobile webhook reported "${STAGE_META[evt.newStage]?.short || evt.newStage}", while local registry is "${STAGE_META[localDev.stage]?.short || localDev.stage}".`,
          webhookValue: `${STAGE_META[evt.newStage]?.short || evt.newStage} (${evt.eventId})`,
          registryValue: `${STAGE_META[localDev.stage]?.short || localDev.stage}`,
          latestEvent: evt,
          localDevice: localDev,
          canAutoResolve: true,
        });
      }

      const evtMid = (evt.mid || '').trim().toUpperCase();
      const locMid = (localDev.mid || '').trim().toUpperCase();
      const evtTid = (evt.tid || '').trim().toUpperCase();
      const locTid = (localDev.tid || '').trim().toUpperCase();

      if ((evtMid && evtMid !== locMid) || (evtTid && evtTid !== locTid)) {
        hasDiscrepancyForSerial = true;
        discrepancies.push({
          id: `DISC-MIDTID-${evt.serial}`,
          serial: evt.serial,
          type: 'MID_TID_MISMATCH',
          severity: 'WARNING',
          title: 'MID / TID Binding Mismatch',
          summary: `Webhook MID/TID binding differs from local hardware registry.`,
          webhookValue: `${evt.mid || '—'} / ${evt.tid || '—'}`,
          registryValue: `${localDev.mid || 'Unbound'} / ${localDev.tid || 'Unbound'}`,
          latestEvent: evt,
          localDevice: localDev,
          canAutoResolve: true,
        });
      }

      if (
        evt.branchId &&
        localDev.branchId &&
        evt.branchId.trim() !== localDev.branchId.trim()
      ) {
        hasDiscrepancyForSerial = true;
        discrepancies.push({
          id: `DISC-BRANCH-${evt.serial}`,
          serial: evt.serial,
          type: 'BRANCH_MISMATCH',
          severity: 'WARNING',
          title: 'Branch Code Drift',
          summary: `Webhook logged under Branch ${evt.branchId}, but local serial is assigned to Branch ${localDev.branchId}.`,
          webhookValue: `Branch ${evt.branchId}`,
          registryValue: `Branch ${localDev.branchId} (${localDev.branchName})`,
          latestEvent: evt,
          localDevice: localDev,
          canAutoResolve: true,
        });
      }

      if (!hasDiscrepancyForSerial) {
        verifiedMatches.push({
          serial: evt.serial,
          event: evt,
          device: localDev,
        });
      }
    });

    const missingTelemetryUnits = devices.filter(
      (d) =>
        d.stage === 'CONFIGURING' &&
        !latestEventBySerial.has(d.serial.trim().toUpperCase())
    );

    missingTelemetryUnits.slice(0, 3).forEach((d) => {
      const bCode = d.branchId && d.branchId !== '100' ? d.branchId : '105';
      const seq = d.serial.slice(-2).replace(/\D/g, '') || '19';
      const synthEvent: MobileWebhookEvent = {
        eventId: `WHK-SYNC-${d.serial.slice(-4)}`,
        timestamp: new Date().toISOString().slice(0, 19).replace('T', ' '),
        serial: d.serial,
        previousStage: d.stage,
        newStage: d.stage,
        installerStaff: d.staff || 'Field Installer',
        branchId: bCode,
        mid: d.mid || `MID-880${bCode}-${seq}`,
        tid: d.tid || `TID-${bCode}${seq}`,
        merchantName: d.merchantName || 'Assigned Merchant',
        merchantPhone: d.merchantPhone || '012 889 100',
        address: d.address || 'Phnom Penh',
        source: 'COMPANION_SIMULATOR',
        note: 'Telemetry check-in generated via Automated Reconciliation',
        status: 'QUEUED',
      };

      discrepancies.push({
        id: `DISC-MISSING-WHK-${d.serial}`,
        serial: d.serial,
        type: 'MISSING_WEBHOOK',
        severity: 'WARNING',
        title: 'Missing Field Check-In',
        summary: `Serial ${d.serial} is in Branch Config for Branch ${d.branchId} with no webhook check-in.`,
        webhookValue: 'No Webhook Event',
        registryValue: `${STAGE_META[d.stage]?.short || d.stage} · Br.${d.branchId}`,
        localDevice: d,
        syntheticEvent: synthEvent,
        canAutoResolve: true,
      });
    });

    const criticalCount = discrepancies.filter(
      (d) => d.severity === 'CRITICAL'
    ).length;
    const warningCount = discrepancies.filter(
      (d) => d.severity === 'WARNING'
    ).length;

    return {
      discrepancies,
      verifiedMatches,
      criticalCount,
      warningCount,
      totalWebhookSerials: latestEventBySerial.size,
      totalDiscrepancies: discrepancies.length,
    };
  }, [devices, webhookEvents]);

  const feedCounts = useMemo(() => {
    let pos = 0;
    let sb = 0;
    let drift = 0;
    webhookEvents.forEach((evt) => {
      if (evt.serial.startsWith('POS')) pos++;
      if (evt.serial.startsWith('SB')) sb++;
      const matched = devices.find(
        (d) => d.serial.trim().toUpperCase() === evt.serial.trim().toUpperCase()
      );
      if (!matched || matched.stage !== evt.newStage) drift++;
    });
    return {
      all: webhookEvents.length,
      pos,
      sb,
      drift,
    };
  }, [webhookEvents, devices]);

  const filteredWebhooks = useMemo(() => {
    return webhookEvents.filter((evt) => {
      if (feedFilter === 'POS') return evt.serial.startsWith('POS');
      if (feedFilter === 'SB') return evt.serial.startsWith('SB');
      if (feedFilter === 'DRIFT') {
        const matched = devices.find(
          (d) => d.serial.trim().toUpperCase() === evt.serial.trim().toUpperCase()
        );
        return !matched || matched.stage !== evt.newStage;
      }
      return true;
    });
  }, [webhookEvents, feedFilter, devices]);

  const handleTriggerAutomatedReconciliation = () => {
    setReconciliationOpen(true);
    setIsScanningReconciliation(true);
    setTimeout(() => {
      setIsScanningReconciliation(false);
      setLastAuditTimestamp(
        new Date().toISOString().slice(0, 19).replace('T', ' ')
      );
    }, 220);
  };

  const handleResolveSingleDiscrepancy = (disc: ReconciliationDiscrepancy) => {
    const evtToApply = disc.latestEvent || disc.syntheticEvent;
    if (!evtToApply || !onReconcileWebhookEvents) return;
    onReconcileWebhookEvents([evtToApply], 'SINGLE');
    setLastAuditTimestamp(
      new Date().toISOString().slice(0, 19).replace('T', ' ')
    );
  };

  const handleAutoReconcileAll = () => {
    if (!onReconcileWebhookEvents) return;
    const uniqueEventsMap = new Map<string, MobileWebhookEvent>();
    reconciliationReport.discrepancies.forEach((d) => {
      const evt = d.latestEvent || d.syntheticEvent;
      if (evt) {
        uniqueEventsMap.set(evt.serial.trim().toUpperCase(), evt);
      }
    });
    const eventsList = Array.from(uniqueEventsMap.values());
    if (eventsList.length === 0) return;
    onReconcileWebhookEvents(eventsList, 'BATCH');
    setLastAuditTimestamp(
      new Date().toISOString().slice(0, 19).replace('T', ' ')
    );
  };

  const handlePickRandomFieldUnit = () => {
    const pool = installableDevices.filter(
      (d) => d.stage !== 'COMPLETE' && d.serial !== selectedSerial
    );
    const pick =
      pool[Math.floor(Math.random() * pool.length)] ||
      installableDevices[Math.floor(Math.random() * installableDevices.length)];
    if (pick) {
      setSelectedSerial(pick.serial);
    }
  };

  const [mobileSubAction, setMobileSubAction] = useState<
    'STANDARD' | 'STEP9_REPLACE' | 'STEP10_TERMINATE' | 'STEP11_REUSE'
  >('STANDARD');
  const [replacementSerial, setReplacementSerial] = useState<string>('');
  const [replaceStaffOfficer, setReplaceStaffOfficer] = useState<string>(activeStaff);
  const [returnStaffOfficer, setReturnStaffOfficer] = useState<string>(activeStaff);

  useEffect(() => {
    if (activeStaff) {
      setReplaceStaffOfficer(activeStaff);
      setReturnStaffOfficer(activeStaff);
    }
  }, [activeStaff]);

  const availableReserveForReplace = useMemo(() => {
    if (!currentDevice) return [];
    const sameBr = devices.filter(
      (d) =>
        d.serial !== currentDevice.serial &&
        d.stage === 'BRANCH_RESERVE' &&
        d.type === currentDevice.type &&
        d.branchId === branchId
    );
    if (sameBr.length > 0) return sameBr;
    return devices.filter(
      (d) =>
        d.serial !== currentDevice.serial &&
        d.stage === 'BRANCH_RESERVE' &&
        d.type === currentDevice.type
    );
  }, [currentDevice, devices, branchId]);

  useEffect(() => {
    setReplacementSerial(availableReserveForReplace[0]?.serial || '');
  }, [availableReserveForReplace]);

  // One MID One Serial conflict check for iPhone Simulator
  const conflictingMids = useMemo(() => {
    const clean = mid.trim().toUpperCase();
    if (!clean) return [];
    return devices.filter(
      (d) =>
        d.serial !== selectedSerial &&
        d.mid &&
        d.mid.trim().toUpperCase() === clean &&
        d.stage !== 'FAULTY' &&
        d.stage !== 'LOST'
    );
  }, [mid, devices, selectedSerial]);

  const handleSubmitMobileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSerial || isSubmitting) return;

    const isDecoupleAction =
      mobileSubAction === 'STEP10_TERMINATE' ||
      mobileSubAction === 'STEP11_REUSE' ||
      stage === 'LOST';

    setIsSubmitting(true);
    setDynamicIslandState('SYNCING');
    try {
      if (
        stage === 'FAULTY' &&
        mobileSubAction === 'STEP9_REPLACE' &&
        replacementSerial &&
        onReplaceDevice
      ) {
        onReplaceDevice(
          selectedSerial,
          replacementSerial,
          notes.trim() || 'Error after deploy — Replaced via Mobile App',
          replaceStaffOfficer || activeStaff
        );
      } else {
        const isTerminated = mobileSubAction === 'STEP10_TERMINATE';
        const isReused = mobileSubAction === 'STEP11_REUSE';
        const isLost = stage === 'LOST';
        const finalStage: LifecycleStage = isReused
          ? 'BRANCH_RESERVE'
          : isTerminated
          ? mobileTerminateDestination
          : stage;

        const finalBranchId =
          isTerminated && mobileTerminateDestination === 'HQ_STOCK'
            ? '100'
            : branchId;

        const isUnbound = isTerminated || isReused || isLost;

        const finalNote = isTerminated
          ? `Merchant terminated — Physical hardware returned to ${
              mobileTerminateDestination === 'HQ_STOCK'
                ? 'Admin HQ Stock (100)'
                : `Branch ${branchId} Reserve`
            } (${merchantName.trim()})`
          : isReused
          ? `Device cleared & returned to Branch Reserve for reuse`
          : isLost
          ? (notes.trim() || 'Device reported missing/lost in field')
          : notes.trim();

        await onTriggerMobileSync({
          serial: selectedSerial,
          stage: finalStage,
          branchId: finalBranchId,
          installerStaff: isTerminated ? (returnStaffOfficer || activeStaff) : installerName,
          mid: isUnbound ? '' : mid.trim(),
          tid: isUnbound ? '' : tid.trim(),
          merchantName: isUnbound ? '' : merchantName.trim(),
          merchantPhone: isUnbound ? '' : merchantPhone.trim(),
          address: isUnbound ? '' : address.trim(),
          location: gpsLocation.trim(),
          note: finalNote,
          source: 'COMPANION_SIMULATOR',
        });
      }
      setDynamicIslandState('SUCCESS');
      setTimeout(() => setDynamicIslandState('IDLE'), 2200);
    } finally {
      setIsSubmitting(false);
    }
  };

  const cardSurface = isLight
    ? 'surface-card-light text-zinc-900'
    : 'surface-card-dark text-slate-100';
  const headingClass = isLight ? 'text-zinc-900' : 'text-white';
  const subtextClass = isLight ? 'text-slate-500' : 'text-slate-300';
  const navyTitleClass = isLight ? 'text-zinc-900' : 'text-zinc-100';

  const isDecoupled =
    mobileSubAction === 'STEP10_TERMINATE' ||
    mobileSubAction === 'STEP11_REUSE' ||
    stage === 'LOST';

  const stageButtons: Array<{
    id: LifecycleStage;
    subMode: 'STANDARD' | 'STEP9_REPLACE' | 'STEP10_TERMINATE' | 'STEP11_REUSE';
    label: string;
    sub: string;
    icon: React.ElementType;
    activeClass: string;
  }> = [
    {
      id: 'CONFIGURING',
      subMode: 'STANDARD',
      label: 'Assign MID',
      sub: 'Config in Branch',
      icon: Wrench,
      activeClass: 'bg-amber-500 text-slate-950 border-amber-400 shadow-sm',
    },
    {
      id: 'COMPLETE',
      subMode: 'STANDARD',
      label: 'Completed',
      sub: 'Installed Live',
      icon: CheckCircle2,
      activeClass: 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-sm',
    },
    {
      id: 'FAULTY',
      subMode: 'STEP9_REPLACE',
      label: 'Replace Device',
      sub: 'Swap reserve unit',
      icon: AlertTriangle,
      activeClass: 'bg-[#e41e26] text-white border-rose-500 shadow-sm',
    },
    {
      id: 'FAULTY',
      subMode: 'STEP10_TERMINATE',
      label: 'Terminate',
      sub: 'Return to Bank',
      icon: RefreshCw,
      activeClass: 'bg-[#004953] text-white border-emerald-500/30 shadow-sm',
    },
    {
      id: 'LOST',
      subMode: 'STANDARD',
      label: 'Device Lost',
      sub: 'Report Missing',
      icon: SearchX,
      activeClass: 'bg-amber-600 text-white border-amber-500 shadow-sm',
    },
    {
      id: 'BRANCH_RESERVE',
      subMode: 'STEP11_REUSE',
      label: 'Reuse Device',
      sub: 'Return to Reserve',
      icon: Sparkles,
      activeClass: 'bg-[#1cc88a] text-white border-emerald-400 shadow-sm',
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Top Glassmorphic Telemetry Command Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Card 1: Real-time Gateway Channel */}
        <div className={`${cardSurface} p-4.5 rounded-2xl flex items-center justify-between relative overflow-hidden backdrop-blur-xl border border-white/10 shadow-sm transition-all`}>
          <div>
            <div className="flex items-center gap-1.5">
              <span className={`text-[11px] font-bold uppercase tracking-wider ${subtextClass}`}>Live Channel</span>
            </div>
            <div className={`text-lg font-black tracking-tight mt-1 flex items-center gap-2 ${headingClass}`}>
              <span>{sseConnected ? 'Real-Time SSE' : 'Local Sandbox'}</span>
            </div>
            <div className="flex items-center gap-1.5 mt-1.5">
              <span className="relative flex h-2 w-2">
                {sseConnected && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                )}
                <span className={`relative inline-flex rounded-full h-2 w-2 ${sseConnected ? 'bg-emerald-500' : 'bg-amber-400'}`} />
              </span>
              <span className={`text-[11px] font-semibold ${sseConnected ? 'text-emerald-500' : 'text-amber-500'}`}>
                {sseConnected ? 'Gateway Active (3000/stream)' : 'Local Simulation Active'}
              </span>
            </div>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 shadow-inner">
            <Radio className="w-5 h-5 animate-pulse" />
          </div>
        </div>

        {/* Card 2: Synced Updates */}
        <div className={`${cardSurface} p-4.5 rounded-2xl flex items-center justify-between relative overflow-hidden backdrop-blur-xl border border-white/10 shadow-sm transition-all`}>
          <div>
            <span className={`text-[11px] font-bold uppercase tracking-wider ${subtextClass}`}>Synced Events</span>
            <div className={`text-2xl font-black font-mono tabular-nums tracking-tight mt-1 ${headingClass}`}>
              {webhookEvents.length}
            </div>
            <span className={`text-[11px] font-medium mt-1 block ${subtextClass}`}>
              Field updates synchronized
            </span>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center shrink-0 shadow-inner">
            <Smartphone className="w-5 h-5" />
          </div>
        </div>

        {/* Card 3: Verified Serials */}
        <div className={`${cardSurface} p-4.5 rounded-2xl flex items-center justify-between relative overflow-hidden backdrop-blur-xl border border-white/10 shadow-sm transition-all`}>
          <div>
            <span className={`text-[11px] font-bold uppercase tracking-wider ${subtextClass}`}>Verified Serials</span>
            <div className={`text-2xl font-black font-mono tabular-nums tracking-tight mt-1 ${headingClass}`}>
              {reconciliationReport.verifiedMatches.length}
            </div>
            <span className="text-[11px] font-bold text-emerald-500 mt-1 block">
              100% matched with registry
            </span>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 shadow-inner">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>

        {/* Card 4: Automated Reconciliation Trigger */}
        <motion.button
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.98 }}
          type="button"
          onClick={handleTriggerAutomatedReconciliation}
          className={`${cardSurface} p-4.5 rounded-2xl text-left flex items-center justify-between cursor-pointer border transition-all duration-200 ${
            reconciliationReport.totalDiscrepancies > 0
              ? 'border-amber-500/40 bg-amber-500/[0.04]'
              : 'border-white/10 hover:border-white/20'
          }`}
        >
          <div>
            <div className="flex items-center gap-1.5">
              <span className={`text-[11px] font-bold uppercase tracking-wider ${subtextClass}`}>
                Automated Audit
              </span>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span
                className={`text-2xl font-black font-mono tabular-nums ${
                  reconciliationReport.totalDiscrepancies > 0
                    ? 'text-amber-500'
                    : 'text-emerald-400'
                }`}
              >
                {reconciliationReport.totalDiscrepancies}
              </span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
                reconciliationReport.totalDiscrepancies > 0
                  ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                  : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
              }`}>
                {reconciliationReport.totalDiscrepancies > 0
                  ? 'Drift Detected'
                  : 'In Sync'}
              </span>
            </div>
            <span className={`text-[11px] font-semibold mt-1 block ${navyTitleClass}`}>
              {reconciliationOpen ? 'Hide Audit Drawer ▴' : 'Inspect Cross-Check ▾'}
            </span>
          </div>
          <div
            className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border ${
              reconciliationReport.totalDiscrepancies > 0
                ? 'bg-amber-500/15 text-amber-400 border-amber-500/30 shadow-inner'
                : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20 shadow-inner'
            }`}
          >
            <Scale className="w-5 h-5" />
          </div>
        </motion.button>
      </div>

      {/* Expandable Automated Reconciliation Drawer */}
      <AnimatePresence>
        {reconciliationOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
            className={`${cardSurface} rounded-2xl p-5 flex flex-col gap-4 border border-white/10 dark:border-white/15 backdrop-blur-xl shadow-xl`}
          >
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-slate-200/70 dark:border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/15 text-amber-400 border border-amber-500/20 flex items-center justify-center shrink-0 shadow-inner">
                  <Scale className="w-5 h-5" />
                </div>
                <div>
                  <h3 className={`text-sm sm:text-base font-black ${headingClass}`}>
                    Serial Registry vs. Mobile Sync Cross-Check
                  </h3>
                  <p className={`text-xs ${subtextClass}`}>
                    Last checked: <span className="font-mono font-semibold">{lastAuditTimestamp}</span> ·{' '}
                    <strong className="text-amber-400">{reconciliationReport.totalDiscrepancies}</strong> flagged ·{' '}
                    <strong className="text-emerald-400">{reconciliationReport.verifiedMatches.length}</strong> aligned
                  </p>
                </div>
              </div>

              <div className="flex items-center flex-wrap gap-2">
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  type="button"
                  onClick={handleTriggerAutomatedReconciliation}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 cursor-pointer transition ${
                    isLight
                      ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
                      : 'bg-white/5 hover:bg-white/10 text-slate-200 border-white/10'
                  }`}
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 text-sky-400 ${
                      isScanningReconciliation ? 'animate-spin' : ''
                    }`}
                  />
                  <span>Re-Scan</span>
                </motion.button>

                {reconciliationReport.totalDiscrepancies > 0 && (
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    type="button"
                    onClick={handleAutoReconcileAll}
                    className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 cursor-pointer shadow-md"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>
                      Auto-Reconcile All ({reconciliationReport.totalDiscrepancies})
                    </span>
                  </motion.button>
                )}

                <button
                  type="button"
                  onClick={() => setReconciliationOpen(false)}
                  className="text-xs font-semibold text-slate-400 hover:text-white px-2.5 py-1 cursor-pointer transition"
                >
                  Close
                </button>
              </div>
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {[
                {
                  id: 'ALL',
                  label: `Flagged (${reconciliationReport.totalDiscrepancies})`,
                },
                {
                  id: 'CRITICAL',
                  label: `Critical (${reconciliationReport.criticalCount})`,
                },
                {
                  id: 'WARNING',
                  label: `Warnings (${reconciliationReport.warningCount})`,
                },
                {
                  id: 'VERIFIED',
                  label: `Aligned (${reconciliationReport.verifiedMatches.length})`,
                },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setReconciliationFilter(tab.id as any)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
                    reconciliationFilter === tab.id
                      ? 'bg-[#004953] text-white border-emerald-500/30 shadow-sm'
                      : isLight
                      ? 'bg-slate-100 hover:bg-slate-200 text-zinc-700 border-slate-200'
                      : 'bg-white/5 hover:bg-white/10 text-slate-300 border-white/10 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Discrepancy Items */}
            {reconciliationFilter === 'VERIFIED' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-[280px] overflow-y-auto custom-scrollbar pr-1">
                {reconciliationReport.verifiedMatches.map(({ serial, event, device }) => (
                  <div
                    key={serial}
                    className={`p-3 rounded-2xl border flex items-center justify-between gap-2 ${
                      isLight
                        ? 'bg-emerald-50/50 border-emerald-200'
                        : 'bg-emerald-500/[0.06] border-emerald-500/20'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span className={`font-mono font-bold text-xs ${headingClass}`}>
                          {serial}
                        </span>
                        <span className="text-xs text-emerald-400 font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                          {STAGE_META[device.stage]?.short}
                        </span>
                      </div>
                      <div className={`text-[11px] ${subtextClass} truncate mt-1`}>
                        {device.merchantName} ({device.mid}) · Event {event.eventId}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenWorkflow(serial)}
                      className="text-xs font-bold text-sky-400 hover:underline shrink-0 cursor-pointer"
                    >
                      Inspect
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 max-h-[320px] overflow-y-auto custom-scrollbar pr-1">
                {reconciliationReport.discrepancies
                  .filter((d) =>
                    reconciliationFilter === 'ALL'
                      ? true
                      : d.severity === reconciliationFilter
                  )
                  .map((disc) => {
                    const isCrit = disc.severity === 'CRITICAL';
                    return (
                      <div
                        key={disc.id}
                        className={`p-3.5 rounded-2xl border flex flex-col lg:flex-row lg:items-center justify-between gap-3 ${
                          isCrit
                            ? isLight
                              ? 'bg-rose-50/60 border-rose-200'
                              : 'bg-rose-500/[0.07] border-rose-500/25'
                            : isLight
                            ? 'bg-amber-50/60 border-amber-200'
                            : 'bg-amber-500/[0.07] border-amber-500/25'
                        }`}
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <AlertOctagon
                              className={`w-4 h-4 ${
                                isCrit ? 'text-rose-400' : 'text-amber-400'
                              }`}
                            />
                            <span className={`font-mono font-bold text-xs ${headingClass}`}>
                              {disc.serial}
                            </span>
                            <span
                              className={`text-xs font-bold ${
                                isCrit ? 'text-rose-400' : 'text-amber-400'
                              }`}
                            >
                              · {disc.title}
                            </span>
                          </div>
                          <p className={`text-xs ${subtextClass}`}>{disc.summary}</p>
                          <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono pt-1">
                            <span className="text-sky-400">
                              Mobile: <strong>{disc.webhookValue}</strong>
                            </span>
                            <span className="text-slate-500">vs.</span>
                            <span className="text-amber-400">
                              Registry: <strong>{disc.registryValue}</strong>
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <motion.button
                            whileTap={{ scale: 0.95 }}
                            type="button"
                            onClick={() => handleResolveSingleDiscrepancy(disc)}
                            className="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 cursor-pointer shadow-sm"
                          >
                            {disc.type === 'UNREGISTERED_SERIAL' ? (
                              <>
                                <FilePlus2 className="w-3.5 h-3.5" />
                                <span>Register Serial</span>
                              </>
                            ) : (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                <span>Sync Registry</span>
                              </>
                            )}
                          </motion.button>
                        </div>
                      </div>
                    );
                  })}

                {reconciliationReport.discrepancies.length === 0 && (
                  <div className="py-6 text-center text-xs text-emerald-400 font-semibold flex items-center justify-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      All hardware serials and mobile sync events are 100% aligned.
                    </span>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Split: iPhone 18 Pro Max Field UI (Left) + Live Sync Activity Stream (Right) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left 5 Cols: Authentic iPhone 18 Pro Max Deep Burgundy Hardware Mockup */}
        <div className="xl:col-span-5 flex flex-col items-center">
          {/* iPhone 18 Pro Max Spec Badge */}
          <div className="mb-3 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[11px] font-mono font-bold border bg-[#141518]/90 text-zinc-200 border-zinc-700/80 shadow-sm backdrop-blur-md">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>iPhone 18 Pro Max • 6.9&quot; Super Retina XDR • Space Black Titanium</span>
          </div>

          {/* Authentic Real iPhone 18 Pro Max Form Factor: 163.0mm × 77.6mm (1 : 2.1 Physical Aspect Ratio) */}
          <div className="relative w-full max-w-[380px] h-[798px]">
            {/* Precision Space Black Titanium Side Physical Buttons & Antenna Bands */}
            {/* Antenna Band Top Left */}
            <div
              aria-hidden="true"
              className="absolute -left-[1px] top-16 w-[2px] h-[4px] bg-[#222327]/90 rounded-xs pointer-events-none z-20"
            />
            {/* Haptic Solid-State Action Button */}
            <div
              aria-hidden="true"
              title="Action Button"
              className="absolute -left-[3.5px] top-28 w-[3.5px] h-[30px] rounded-l-[3px] iphone-titanium-btn-left z-10"
            />
            {/* Volume Up */}
            <div
              aria-hidden="true"
              title="Volume Up"
              className="absolute -left-[3.5px] top-42 w-[3.5px] h-[52px] rounded-l-[3px] iphone-titanium-btn-left z-10"
            />
            {/* Volume Down */}
            <div
              aria-hidden="true"
              title="Volume Down"
              className="absolute -left-[3.5px] top-58 w-[3.5px] h-[52px] rounded-l-[3px] iphone-titanium-btn-left z-10"
            />
            {/* Antenna Band Bottom Left */}
            <div
              aria-hidden="true"
              className="absolute -left-[1px] bottom-28 w-[2px] h-[4px] bg-[#222327]/90 rounded-xs pointer-events-none z-20"
            />

            {/* Antenna Band Top Right */}
            <div
              aria-hidden="true"
              className="absolute -right-[1px] top-16 w-[2px] h-[4px] bg-[#222327]/90 rounded-xs pointer-events-none z-20"
            />
            {/* Power / Siri Side Button */}
            <div
              aria-hidden="true"
              title="Side Button"
              className="absolute -right-[3.5px] top-42 w-[3.5px] h-[72px] rounded-r-[3px] iphone-titanium-btn-right z-10"
            />
            {/* Sapphire Capacitive Camera Control Button */}
            <div
              aria-hidden="true"
              title="Camera Control Capacitive Sensor"
              className="absolute -right-[2.5px] bottom-40 w-[2.5px] h-[64px] rounded-r-[2px] iphone-camera-control z-10"
            />
            {/* Antenna Band Bottom Right */}
            <div
              aria-hidden="true"
              className="absolute -right-[1px] bottom-28 w-[2px] h-[4px] bg-[#222327]/90 rounded-xs pointer-events-none z-20"
            />

            {/* iPhone 18 Pro Max Outer Grade-5 Space Black Titanium Frame */}
            <div className="relative iphone-18-pro-frame h-full flex flex-col">
              {/* Top Earpiece Micro-Speaker Slit */}
              <div
                aria-hidden="true"
                className="w-14 h-[2.5px] mx-auto mb-1 rounded-full bg-[#0a0a0d] border-b border-white/10 opacity-80 shrink-0"
              />

              {/* Inner 6.9-inch Ultra-Thin Bezel OLED Display */}
              <div
                className={`h-full rounded-[46px] overflow-hidden flex flex-col relative border border-black/90 shadow-[inset_0_0_4px_rgba(0,0,0,0.85)] ${
                  isLight
                    ? 'bg-[#f8f9fa] text-slate-900'
                    : 'bg-[#0c0d10] text-white'
                }`}
              >
                {/* Diagonal Glass Sheen Layer */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 z-30 rounded-[46px] overflow-hidden"
                >
                  <div className="absolute -top-[60%] -left-[60%] w-[220%] h-[220%] bg-gradient-to-tr from-transparent via-white/[0.03] to-white/[0.08] rotate-25 transform" />
                </div>

                {/* iOS Status Bar + Dynamic Island */}
                <div className="px-6 pt-3 pb-2 flex items-center justify-between select-none relative z-20 shrink-0">
                  <span className="text-[13px] font-semibold tracking-tight tabular-nums pl-1">
                    9:41
                  </span>

                  {/* iPhone 18 Pro Max Dynamic Island with TrueDepth Lens (Dead-center on iPhone Screen) */}
                  <motion.div
                    layout
                    transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                    className="absolute left-1/2 -translate-x-1/2 top-2.5 bg-black text-white px-3.5 py-1.5 rounded-full flex items-center gap-2 shadow-lg border border-white/10 z-30"
                  >
                    {/* TrueDepth Sapphire Front Camera Lens */}
                    <div className="relative w-2.5 h-2.5 rounded-full bg-[#080c18] ring-[0.5px] ring-white/15 flex items-center justify-center shrink-0">
                      <div className="w-1 h-1 rounded-full bg-[#172540]" />
                      <div className="absolute top-0.5 right-0.5 w-[1px] h-[1px] rounded-full bg-sky-300" />
                    </div>

                    {dynamicIslandState === 'SYNCING' ? (
                      <div className="flex items-center gap-1.5">
                        <RefreshCw className="w-3 h-3 text-sky-400 animate-spin" />
                        <span className="text-[10px] font-semibold text-sky-300 tracking-tight whitespace-nowrap">
                          Syncing CRM...
                        </span>
                      </div>
                    ) : dynamicIslandState === 'SUCCESS' ? (
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        <span className="text-[10px] font-semibold text-emerald-300 tracking-tight whitespace-nowrap">
                          Synced Live
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                        <span className="text-[10px] font-semibold text-slate-300 tracking-tight pr-0.5">
                          Ready
                        </span>
                      </div>
                    )}
                  </motion.div>

                  {/* iOS Native Status Icons: 4-Bar Staircase, 5G, Wi-Fi, Authentic Battery Capsule */}
                  <div className="flex items-center gap-1.5 pr-1">
                    {/* 4-bar iOS Signal Staircase */}
                    <svg className="w-3.5 h-3 shrink-0" viewBox="0 0 17 12" fill="currentColor">
                      <rect x="0.5" y="8.5" width="2.5" height="3" rx="0.75" />
                      <rect x="4.5" y="5.5" width="2.5" height="6" rx="0.75" />
                      <rect x="8.5" y="2.5" width="2.5" height="9" rx="0.75" />
                      <rect x="12.5" y="0" width="2.5" height="11.5" rx="0.75" />
                    </svg>

                    <span className="text-[10px] font-bold tracking-tight">5G</span>

                    <Wifi className="w-3.5 h-3.5 shrink-0" strokeWidth={2.4} />

                    {/* Authentic iOS Battery Capsule */}
                    <div className="flex items-center shrink-0">
                      <div className="w-[20px] h-[10.5px] rounded-[3.5px] border border-current p-[1.5px] flex items-center">
                        <div className="h-full w-full rounded-[1px] bg-emerald-500" />
                      </div>
                      <div className="w-[1.5px] h-[3.5px] rounded-r-xs bg-current" />
                    </div>
                  </div>
                </div>

                {/* iPhone App Content Body (Scrollable Screen) */}
                <form
                  onSubmit={handleSubmitMobileUpdate}
                  className="flex-1 overflow-y-auto px-4 py-2 flex flex-col gap-3 relative z-10 custom-scrollbar"
                >
                  {/* App Bar */}
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-[#141518] border border-zinc-700/80 text-zinc-200 flex items-center justify-center shadow-md">
                        <Smartphone className="w-4 h-4 text-zinc-300" />
                      </div>
                      <div>
                        <div className="text-sm font-black leading-tight tracking-tight">
                          POS &amp; Sound Box Install
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="px-1.5 py-0.2 rounded-full text-[9.5px] font-mono font-bold bg-zinc-800 text-zinc-300 border border-zinc-700">
                            Br. {branchId}
                          </span>
                          <span className="text-[10px] text-zinc-400 font-mono flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                            iPhone 18 Pro Max · Space Black Titanium
                          </span>
                        </div>
                      </div>
                    </div>

                    <motion.button
                      whileTap={{ scale: 0.93 }}
                      type="button"
                      onClick={handlePickRandomFieldUnit}
                      className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1 cursor-pointer border transition-all ${
                        isLight
                          ? 'bg-slate-100 border-slate-300 text-zinc-800 hover:bg-slate-200'
                          : 'bg-white/10 hover:bg-white/15 border-white/15 text-white shadow-sm'
                      }`}
                    >
                      <Shuffle className="w-3 h-3 text-sky-400" />
                      <span>Next Unit</span>
                    </motion.button>
                  </div>

                  {/* Hardware Unit Card */}
                  <div
                    className={`p-3 rounded-2xl border backdrop-blur-md transition-all ${
                      isLight
                        ? 'bg-white/80 border-slate-200/90 shadow-xs'
                        : 'bg-white/[0.04] border-white/10'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-bold text-slate-400 flex items-center gap-1.5">
                        {currentDevice?.type === 'POS Terminal' ? (
                          <Cpu className={`w-3.5 h-3.5 ${navyTitleClass}`} />
                        ) : (
                          <Volume2 className="w-3.5 h-3.5 text-[#1cc88a]" />
                        )}
                        <span>Hardware &amp; Battery Serial</span>
                      </span>
                      <span className={`text-[10px] font-mono ${navyTitleClass} font-bold px-1.5 py-0.2 rounded-full bg-black/20 border border-white/10`}>
                        Bat: {currentDevice?.batterySerial || `BAT-${selectedSerial.replace(/^(POS-|SB-)/i, '')}`}
                      </span>
                    </div>

                    <select
                      value={selectedSerial}
                      onChange={(e) => setSelectedSerial(e.target.value)}
                      className={`w-full rounded-xl px-3 py-2 text-xs font-mono font-bold border focus:outline-none focus:ring-2 focus:ring-sky-500/40 cursor-pointer transition ${
                        isLight
                          ? 'bg-slate-50 border-slate-300 text-zinc-900'
                          : 'bg-black/40 border-white/15 text-white'
                      }`}
                    >
                      {installableDevices.map((d) => (
                        <option key={d.serial} value={d.serial} className="bg-zinc-900 text-white">
                          {d.serial} · {d.model} ({STAGE_META[d.stage]?.short})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 2x3 Tactile Action Grid */}
                  <div>
                    <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 px-1 mb-1.5">
                      Update Device Status
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {stageButtons.map((btn) => {
                        const Icon = btn.icon;
                        const active =
                          stage === btn.id && mobileSubAction === btn.subMode;
                        return (
                          <motion.button
                            key={`${btn.id}-${btn.subMode}`}
                            whileTap={{ scale: 0.95 }}
                            type="button"
                            onClick={() => {
                              setStage(btn.id);
                              setMobileSubAction(btn.subMode);
                            }}
                            className={`p-2 rounded-2xl border text-left flex items-center gap-2 cursor-pointer transition-all ${
                              active
                                ? btn.activeClass
                                : isLight
                                ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 shadow-2xs'
                                : 'bg-white/[0.04] border-white/10 text-slate-300 hover:bg-white/[0.08] hover:text-white backdrop-blur-sm'
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5 shrink-0" />
                            <div className="min-w-0">
                              <div className="text-[11px] font-bold truncate">
                                {btn.label}
                              </div>
                              <div
                                className={`text-[9.5px] truncate ${
                                  active ? 'opacity-90' : 'text-slate-400'
                                }`}
                              >
                                {btn.sub}
                              </div>
                            </div>
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Replacement Selector inside iPhone UI */}
                  {mobileSubAction === 'STEP9_REPLACE' && (
                    <div
                      className={`p-2.5 rounded-2xl border text-xs backdrop-blur-md space-y-2.5 ${
                        isLight
                          ? 'bg-rose-50 border-rose-200 text-rose-900'
                          : 'bg-rose-500/[0.08] border-rose-500/25 text-rose-200'
                      }`}
                    >
                      <div>
                        <div className="text-[10px] font-extrabold uppercase mb-1 flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                          <span>Select Replacement {currentDevice?.type} from Reserve</span>
                        </div>
                        <select
                          value={replacementSerial}
                          onChange={(e) => setReplacementSerial(e.target.value)}
                          className={`w-full rounded-xl px-2.5 py-1.5 text-xs font-mono font-bold border focus:outline-none ${
                            isLight
                              ? 'bg-white border-rose-300 text-zinc-900'
                              : 'bg-black/40 border-rose-500/40 text-white'
                          }`}
                        >
                          {availableReserveForReplace.length === 0 ? (
                            <option value="" className="bg-zinc-900 text-white">No Reserve Unit Available</option>
                          ) : (
                            availableReserveForReplace.map((r) => (
                              <option key={r.serial} value={r.serial} className="bg-zinc-900 text-white">
                                Replace with: {r.serial} ({r.model})
                              </option>
                            ))
                          )}
                        </select>
                      </div>

                      {/* Personnel Distinction: Installer vs Replacement Person */}
                      <div className="pt-2 border-t border-rose-200/60 dark:border-rose-500/20 space-y-1">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="font-extrabold uppercase text-slate-600 dark:text-slate-400">
                            Replaced By (Swap Officer):
                          </span>
                          {replaceStaffOfficer &&
                            replaceStaffOfficer !== (currentDevice?.installedByStaff || currentDevice?.staff) && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                                Different Person
                              </span>
                            )}
                        </div>
                        <select
                          value={replaceStaffOfficer}
                          onChange={(e) => setReplaceStaffOfficer(e.target.value)}
                          className={`w-full rounded-xl px-2.5 py-1.5 text-xs font-bold border focus:outline-none ${
                            isLight
                              ? 'bg-white border-rose-300 text-zinc-900'
                              : 'bg-black/40 border-rose-500/40 text-white'
                          }`}
                        >
                          {(branches.find((b) => b.id === branchId)?.staff || [activeStaff]).map((st) => (
                            <option key={st} value={st} className="bg-zinc-900 text-white">
                              {st}
                            </option>
                          ))}
                        </select>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                          <span>Original Field Installer:</span>
                          <strong>{currentDevice?.installedByStaff || currentDevice?.staff || 'Field Technician'}</strong>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Terminate Destination Selector inside iPhone UI */}
                  {mobileSubAction === 'STEP10_TERMINATE' && (
                    <div
                      className={`p-2.5 rounded-2xl border text-xs backdrop-blur-md ${
                        isLight
                          ? 'bg-amber-50 border-amber-200 text-amber-900'
                          : 'bg-amber-500/[0.08] border-amber-500/25 text-amber-200'
                      }`}
                    >
                      <div className="text-[10px] font-extrabold uppercase mb-1.5 flex items-center gap-1.5">
                        <RefreshCw className="w-3 h-3 text-amber-500" />
                        <span>Physical Hardware Return Destination</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <motion.button
                          whileTap={{ scale: 0.95 }}
                          type="button"
                          onClick={() => setMobileTerminateDestination('BRANCH_RESERVE')}
                          className={`px-2 py-1.5 rounded-xl text-xs font-semibold border flex items-center justify-center gap-1.5 transition cursor-pointer ${
                            mobileTerminateDestination === 'BRANCH_RESERVE'
                              ? 'bg-[#004953] text-white border-emerald-500/30 shadow-xs'
                              : isLight
                              ? 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
                              : 'bg-black/40 hover:bg-black/60 text-slate-300 border-white/10'
                          }`}
                        >
                          <Building2 className="w-3.5 h-3.5" />
                          <span>Branch Reserve</span>
                        </motion.button>
                        <motion.button
                          whileTap={{ scale: 0.95 }}
                          type="button"
                          onClick={() => setMobileTerminateDestination('HQ_STOCK')}
                          className={`px-2 py-1.5 rounded-xl text-xs font-semibold border flex items-center justify-center gap-1.5 transition cursor-pointer ${
                            mobileTerminateDestination === 'HQ_STOCK'
                              ? 'bg-[#004953] text-white border-emerald-500/30 shadow-xs'
                              : isLight
                              ? 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
                              : 'bg-black/40 hover:bg-black/60 text-slate-300 border-white/10'
                          }`}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Admin HQ Stock</span>
                        </motion.button>
                      </div>
                      <div className="text-[10px] mt-1.5 opacity-80">
                        Device will decouple from {merchantName || 'merchant'} and return to{' '}
                        {mobileTerminateDestination === 'HQ_STOCK' ? 'Admin HQ Stock (100)' : `Branch ${branchId} Reserve`}.
                      </div>

                      {/* Personnel Tracking: Returned By */}
                      <div className="pt-2 border-t border-amber-300/40 dark:border-amber-500/20 space-y-1 mt-2">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="font-extrabold uppercase text-slate-600 dark:text-slate-400">
                            Returned By (Decommission Officer):
                          </span>
                          {returnStaffOfficer &&
                            returnStaffOfficer !== (currentDevice?.installedByStaff || currentDevice?.staff) && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                                Different Returner
                              </span>
                            )}
                        </div>
                        <select
                          value={returnStaffOfficer}
                          onChange={(e) => setReturnStaffOfficer(e.target.value)}
                          className={`w-full rounded-xl px-2.5 py-1.5 text-xs font-bold border focus:outline-none ${
                            isLight
                              ? 'bg-white border-amber-300 text-zinc-900'
                              : 'bg-black/40 border-amber-500/40 text-white'
                          }`}
                        >
                          {(branches.find((b) => b.id === branchId)?.staff || [activeStaff]).map((st) => (
                            <option key={st} value={st} className="bg-zinc-900 text-white">
                              {st}
                            </option>
                          ))}
                        </select>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                          <span>Original Field Installer:</span>
                          <strong>{currentDevice?.installedByStaff || currentDevice?.staff || 'Field Technician'}</strong>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Device Lost Alert inside iPhone UI */}
                  {stage === 'LOST' && (
                    <div
                      className={`p-2.5 rounded-2xl border text-xs backdrop-blur-md ${
                        isLight
                          ? 'bg-amber-50 border-amber-200 text-amber-900'
                          : 'bg-amber-500/[0.08] border-amber-500/25 text-amber-200'
                      }`}
                    >
                      <div className="text-[10px] font-extrabold uppercase mb-1 flex items-center gap-1.5">
                        <SearchX className="w-3.5 h-3.5 text-amber-500" />
                        <span>Report Device Lost / Missing</span>
                      </div>
                      <div className="text-[10px] opacity-80">
                        Device will be flagged as lost in central inventory. Associated merchant and terminal bindings will be unassigned.
                      </div>
                    </div>
                  )}

                  {/* iOS Cupertino Grouped Merchant & Location Fields */}
                  <div
                    className={`rounded-2xl border divide-y overflow-hidden backdrop-blur-md ${
                      isLight
                        ? 'bg-white/80 border-slate-200 divide-slate-100 shadow-xs'
                        : 'bg-white/[0.04] border-white/10 divide-white/5'
                    }`}
                  >
                    {/* Merchant Name */}
                    <div className="px-3 py-2 flex items-center gap-2.5">
                      <Store className="w-4 h-4 text-sky-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[9.5px] uppercase tracking-wider text-slate-400 font-bold">
                          Merchant Name
                        </div>
                        <input
                          type="text"
                          value={merchantName}
                          onChange={(e) => setMerchantName(e.target.value)}
                          required={!isDecoupled}
                          className="w-full text-xs font-semibold bg-transparent focus:outline-none truncate text-inherit"
                        />
                      </div>
                    </div>

                    {/* MID & TID Split Row */}
                    <div className="grid grid-cols-2 divide-x divide-slate-100 dark:divide-white/5">
                      <div className="px-3 py-2 flex items-center gap-2">
                        <Hash className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-[9.5px] uppercase tracking-wider text-slate-400 font-bold">
                            Merchant ID
                          </div>
                          <input
                            type="text"
                            value={mid}
                            onChange={(e) => setMid(e.target.value)}
                            required={!isDecoupled}
                            className="w-full text-xs font-mono font-bold bg-transparent focus:outline-none truncate text-inherit"
                          />
                        </div>
                      </div>

                      <div className="px-3 py-2 flex items-center gap-2">
                        <KeyRound className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-[9.5px] uppercase tracking-wider text-slate-400 font-bold">
                            Terminal ID
                          </div>
                          <input
                            type="text"
                            value={tid}
                            onChange={(e) => setTid(e.target.value)}
                            required={!isDecoupled}
                            className="w-full text-xs font-mono font-bold bg-transparent focus:outline-none truncate text-inherit"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Phone & Branch Split Row */}
                    <div className="grid grid-cols-2 divide-x divide-slate-100 dark:divide-white/5">
                      <div className="px-3 py-2 flex items-center gap-2">
                        <Phone className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-[9.5px] uppercase tracking-wider text-slate-400 font-bold">
                            Contact
                          </div>
                          <input
                            type="text"
                            value={merchantPhone}
                            onChange={(e) => setMerchantPhone(e.target.value)}
                            className="w-full text-xs font-mono bg-transparent focus:outline-none truncate text-inherit"
                          />
                        </div>
                      </div>

                      <div className="px-3 py-2 flex items-center gap-2">
                        <UserCheck className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-[9.5px] uppercase tracking-wider text-slate-400 font-bold">
                            Installer
                          </div>
                          <input
                            type="text"
                            value={installerName}
                            onChange={(e) => setInstallerName(e.target.value)}
                            className="w-full text-xs bg-transparent focus:outline-none truncate text-inherit"
                          />
                        </div>
                      </div>
                    </div>

                    {/* GPS Location */}
                    <div className="px-3 py-2 flex items-center gap-2.5">
                      <MapPin className="w-4 h-4 text-emerald-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[9.5px] uppercase tracking-wider text-slate-400 font-bold">
                          GPS Coordinates &amp; Address
                        </div>
                        <input
                          type="text"
                          value={gpsLocation}
                          onChange={(e) => setGpsLocation(e.target.value)}
                          className="w-full text-xs font-mono bg-transparent focus:outline-none truncate text-inherit"
                        />
                      </div>
                    </div>

                    {/* Note */}
                    <div className="px-3 py-2 flex items-center gap-2.5">
                      <FileText className="w-4 h-4 text-amber-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[9.5px] uppercase tracking-wider text-slate-400 font-bold">
                          Field Remark
                        </div>
                        <input
                          type="text"
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          className="w-full text-xs bg-transparent focus:outline-none truncate text-inherit"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Primary iOS Submit Button */}
                  <motion.button
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.96 }}
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-3.5 rounded-2xl text-xs font-black tracking-wide bg-gradient-to-r from-[#141518] to-[#25262c] hover:from-[#1e2025] hover:to-[#31333a] border border-white/15 text-white shadow-lg shadow-black/40 flex items-center justify-center gap-2 cursor-pointer mt-1 transition-all"
                  >
                    <Send className="w-3.5 h-3.5 text-emerald-400" />
                    <span>
                      {isSubmitting
                        ? 'Syncing to CRM...'
                        : stage === 'LOST'
                        ? 'Report Device Lost'
                        : mobileSubAction === 'STEP10_TERMINATE'
                        ? 'Confirm Device Termination'
                        : mobileSubAction === 'STEP11_REUSE'
                        ? 'Return to Branch Reserve'
                        : mobileSubAction === 'STEP9_REPLACE'
                        ? 'Execute Replacement Swap'
                        : 'Update Installation Status'}
                    </span>
                  </motion.button>
                </form>

                {/* iOS Home Indicator Bar */}
                <div className="pt-2 pb-2.5 flex justify-center shrink-0 relative z-20">
                  <div
                    className={`w-36 h-1 rounded-full ${
                      isLight ? 'bg-slate-900/40' : 'bg-white/40'
                    }`}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right 7 Cols: Live Field Activity Stream */}
        <div className={`xl:col-span-7 ${cardSurface} rounded-2xl border border-white/10 dark:border-white/10 backdrop-blur-xl flex flex-col overflow-hidden shadow-xl`}>
          {/* Header Bar */}
          <div className={`p-4 sm:p-5 border-b ${isLight ? 'sb-card-header-light' : 'sb-card-header-dark'} flex flex-col gap-3`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#18191e] border border-white/15 text-white flex items-center justify-center shrink-0 shadow-md">
                  <Smartphone className="w-4.5 h-4.5 text-sky-400" />
                </div>
                <div>
                  <h3 className={`text-sm sm:text-base font-black tracking-tight ${navyTitleClass}`}>
                    Live Field Installation Feed
                  </h3>
                  <p className={`text-xs ${subtextClass}`}>
                    Real-time status updates synced from mobile field installers
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                  sseConnected
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${sseConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                  <span>{sseConnected ? 'SSE Live' : 'Polling'}</span>
                </div>

                <motion.button
                  whileTap={{ scale: 0.95 }}
                  type="button"
                  onClick={() => setReconciliationOpen(!reconciliationOpen)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 cursor-pointer transition-all ${
                    reconciliationReport.totalDiscrepancies > 0
                      ? 'bg-amber-500/15 text-amber-400 border-amber-500/35 hover:bg-amber-500/25'
                      : isLight
                      ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                      : 'bg-white/5 hover:bg-white/10 text-slate-300 border-white/10'
                  }`}
                >
                  <Scale className="w-3.5 h-3.5" />
                  <span>Reconcile ({reconciliationReport.totalDiscrepancies})</span>
                  {reconciliationOpen ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </motion.button>
              </div>
            </div>

            {/* Apple Segmented Filter Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1">
              {[
                { id: 'ALL', label: 'All Events', count: feedCounts.all },
                { id: 'POS', label: 'POS Terminals', count: feedCounts.pos },
                { id: 'SB', label: 'Sound Boxes', count: feedCounts.sb },
                { id: 'DRIFT', label: 'Out-of-Sync Only', count: feedCounts.drift },
              ].map((tab) => {
                const active = feedFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFeedFilter(tab.id as any)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 whitespace-nowrap transition-all cursor-pointer ${
                      active
                        ? 'bg-[#004953] text-white border-emerald-500/30 shadow-sm'
                        : isLight
                        ? 'bg-slate-100/80 hover:bg-slate-200 text-slate-700 border-slate-200'
                        : 'bg-white/5 hover:bg-white/10 text-slate-300 border-white/10 hover:text-white'
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
                        active
                          ? 'bg-white/20 text-white'
                          : tab.id === 'DRIFT' && tab.count > 0
                          ? 'bg-amber-500/20 text-amber-400'
                          : 'bg-black/10 dark:bg-white/10 text-slate-400'
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Event Stream Body */}
          <div className="p-4 flex-1 flex flex-col gap-3 max-h-[640px] overflow-y-auto custom-scrollbar">
            {filteredWebhooks.length === 0 ? (
              <div className="py-16 flex flex-col items-center justify-center text-center gap-2">
                <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-400">
                  <Radio className="w-6 h-6 opacity-60" />
                </div>
                <div className={`text-sm font-bold ${headingClass}`}>No feed events found</div>
                <div className={`text-xs ${subtextClass} max-w-xs`}>
                  No webhook events match the current filter criteria. Choose another filter or trigger a sync from the simulator.
                </div>
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {filteredWebhooks.map((evt) => {
                  const prevMeta =
                    (evt.previousStage && STAGE_META[evt.previousStage as LifecycleStage]) ||
                    STAGE_META.CONFIGURING;
                  const newMeta =
                    STAGE_META[evt.newStage as LifecycleStage] ||
                    STAGE_META.COMPLETE;
                  const isPos = evt.serial.startsWith('POS');

                  const matchedDev = devices.find(
                    (d) =>
                      d.serial.trim().toUpperCase() ===
                      evt.serial.trim().toUpperCase()
                  );
                  const isOutOfSync =
                    !matchedDev || matchedDev.stage !== evt.newStage;

                  return (
                    <motion.div
                      key={evt.eventId}
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className={`p-4 rounded-2xl border flex flex-col gap-3 backdrop-blur-md transition-all ${
                        isOutOfSync
                          ? 'bg-amber-500/[0.06] border-amber-500/35 shadow-xs'
                          : isLight
                          ? 'bg-white/70 hover:bg-white border-slate-200/90 shadow-2xs'
                          : 'bg-white/[0.03] hover:bg-white/[0.05] border-white/10 shadow-xs'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                              isPos
                                ? 'bg-[#18191e] border-white/15 text-white shadow-xs'
                                : 'bg-emerald-500/15 border-emerald-500/25 text-emerald-400 shadow-xs'
                            }`}
                          >
                            {isPos ? (
                              <Cpu className="w-4 h-4 text-sky-400" />
                            ) : (
                              <Volume2 className="w-4 h-4 text-emerald-400" />
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className={`font-mono font-bold text-xs ${headingClass}`}>
                                {evt.serial}
                              </span>
                              <span className="text-slate-400 text-xs">·</span>
                              <span className={`text-xs font-bold ${navyTitleClass}`}>
                                {evt.merchantName}
                              </span>
                              {isOutOfSync && (
                                <span className="px-1.5 py-0.2 rounded-full text-[9.5px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                                  Out-of-Sync
                                </span>
                              )}
                              {evt.mid && (() => {
                                const count = devices.filter(
                                  (d) =>
                                    d.mid &&
                                    d.mid.trim().toUpperCase() ===
                                      evt.mid.trim().toUpperCase()
                                ).length;
                                return count >= 2 ? (
                                  <span className="px-1.5 py-0.2 rounded-full text-[9.5px] font-medium bg-blue-500/15 text-blue-400 border border-blue-500/25">
                                    {count} Devices
                                  </span>
                                ) : null;
                              })()}
                            </div>
                            <div className={`flex items-center gap-2 text-[11px] ${subtextClass} font-mono mt-0.5`}>
                              <span>{evt.mid}</span>
                              <span className="opacity-40">/</span>
                              <span>{evt.tid}</span>
                              <span className="opacity-40">·</span>
                              <span>Branch {evt.branchId}</span>
                            </div>
                          </div>
                        </div>

                        <div className={`flex items-center gap-1.5 text-[11px] ${subtextClass} font-mono px-2 py-1 rounded-lg bg-black/5 dark:bg-white/5 border border-white/5`}>
                          <Clock className="w-3 h-3 opacity-70" />
                          <span>{evt.timestamp}</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-slate-200/60 dark:border-white/5">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="px-2 py-0.5 rounded-full text-[10.5px] font-medium bg-black/5 dark:bg-white/5 text-slate-400 border border-white/5">
                            {prevMeta?.short || evt.previousStage || 'Branch Config'}
                          </span>
                          <ArrowRight className={`w-3.5 h-3.5 ${navyTitleClass}`} />
                          <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            {newMeta?.short || evt.newStage || 'Installed Live'}
                          </span>
                          <span className="text-slate-400">·</span>
                          <span className={`text-xs flex items-center gap-1 ${subtextClass}`}>
                            <UserCheck className="w-3 h-3 opacity-70" />
                            <span>{evt.installerStaff}</span>
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          {isOutOfSync && onReconcileWebhookEvents && (
                            <motion.button
                              whileTap={{ scale: 0.95 }}
                              type="button"
                              onClick={() =>
                                onReconcileWebhookEvents([evt], 'SINGLE')
                              }
                              className="px-3 py-1 rounded-xl text-[11px] font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 cursor-pointer shadow-sm"
                            >
                              Sync Now
                            </motion.button>
                          )}
                          <motion.button
                            whileTap={{ scale: 0.95 }}
                            type="button"
                            onClick={() => onOpenWorkflow(evt.serial)}
                            className="px-2.5 py-1 rounded-xl text-xs font-bold text-sky-400 hover:text-sky-300 hover:bg-sky-500/10 border border-sky-500/20 cursor-pointer transition-all flex items-center gap-1"
                          >
                            <span>Inspect</span>
                            <ExternalLink className="w-3 h-3" />
                          </motion.button>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            )}
          </div>

          {/* External Mobile System Developer Gateway Console */}
          <div className="p-4 sm:p-5 border-t border-slate-200/80 dark:border-white/10 bg-slate-50/60 dark:bg-black/20 backdrop-blur-md">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3.5">
              <div>
                <h4 className={`text-xs font-black uppercase tracking-wider ${navyTitleClass}`}>
                  Developer REST &amp; SSE Gateway
                </h4>
                <p className={`text-[11px] ${subtextClass}`}>
                  Link external iOS, Android, PAX Store, or field ERP mobile systems via REST &amp; SSE endpoints
                </p>
              </div>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 self-start sm:self-auto">
                CORS &amp; Bearer Auth Enabled
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-[11px] font-mono">
              {/* Endpoint 1: POST Sync */}
              <div className="p-3 rounded-2xl bg-white/80 dark:bg-white/[0.04] border border-slate-200/80 dark:border-white/10 backdrop-blur-md shadow-2xs flex flex-col justify-between gap-2 group">
                <div>
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="px-1.5 py-0.2 rounded-md text-[9.5px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                      POST
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyEndpoint('POST /api/v1/installations/sync')}
                      title="Copy Endpoint"
                      className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition cursor-pointer"
                    >
                      {copiedEndpoint === 'POST /api/v1/installations/sync' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                  <div className={`text-[11px] font-bold truncate ${headingClass}`}>
                    /api/v1/installations/sync
                  </div>
                </div>
                <div className={`text-[10.5px] ${subtextClass} font-sans leading-tight`}>
                  Push stage, Branch, MID, TID &amp; installer telemetry
                </div>
              </div>

              {/* Endpoint 2: GET Stream (SSE) */}
              <div className="p-3 rounded-2xl bg-white/80 dark:bg-white/[0.04] border border-slate-200/80 dark:border-white/10 backdrop-blur-md shadow-2xs flex flex-col justify-between gap-2 group">
                <div>
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="px-1.5 py-0.2 rounded-md text-[9.5px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      SSE
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyEndpoint('GET /api/v1/stream')}
                      title="Copy Endpoint"
                      className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition cursor-pointer"
                    >
                      {copiedEndpoint === 'GET /api/v1/stream' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                  <div className={`text-[11px] font-bold truncate ${headingClass}`}>
                    /api/v1/stream
                  </div>
                </div>
                <div className={`text-[10.5px] ${subtextClass} font-sans leading-tight`}>
                  Real-time Server-Sent Events stream for instant two-way sync
                </div>
              </div>

              {/* Endpoint 3: GET Webhooks */}
              <div className="p-3 rounded-2xl bg-white/80 dark:bg-white/[0.04] border border-slate-200/80 dark:border-white/10 backdrop-blur-md shadow-2xs flex flex-col justify-between gap-2 group">
                <div>
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="px-1.5 py-0.2 rounded-md text-[9.5px] font-bold bg-sky-500/15 text-sky-400 border border-sky-500/30">
                      GET
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyEndpoint('GET /api/v1/webhooks/logs')}
                      title="Copy Endpoint"
                      className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition cursor-pointer"
                    >
                      {copiedEndpoint === 'GET /api/v1/webhooks/logs' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                  <div className={`text-[11px] font-bold truncate ${headingClass}`}>
                    /api/v1/webhooks/logs
                  </div>
                </div>
                <div className={`text-[10.5px] ${subtextClass} font-sans leading-tight`}>
                  Retrieve authoritative webhook audit logs &amp; reconciliation
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

import { ClearFiltersButton } from './ClearFiltersButton';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useFlip } from '../utils/useFlip';
import { useSort, SortTh } from '../utils/sort';
import {
  Device,
  Branch,
  UserRole,
  ThemeMode,
  STAGE_ORDER,
  getBatteryLifecycleStatus,
  CustomFieldDefinition,
  Requisition,
  LifecycleStage,
} from '../types';
import { STAGE_META } from '../data/initialData';
import { detectDuplicateMids } from '../utils/crmUtils';
import { todayPP } from '../utils/time';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search,
  Filter,
  Plus,
  FileDown,
  CheckSquare,
  Square,
  Building2,
  RotateCcw,
  Trash2,
  History,
  Cpu,
  Volume2,
  Calendar,
  ArchiveRestore,
  Boxes,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  X,
  ArrowRight,
  Upload,
  Truck,
} from 'lucide-react';

interface InventoryTabProps {
  devices: Device[];
  allDevices?: Device[];
  branches: Branch[];
  /** Signed-in role (from the server). Defaults to the most restricted role. */
  role?: UserRole;
  selectedBranch: string;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  stageFilter: string;
  onStageFilterChange: (s: string) => void;
  typeFilter: string;
  onTypeFilterChange: (t: string) => void;
  branchFilter: string;
  onBranchFilterChange: (b: string) => void;
  onSelectDevice: (sn: string) => void;
  onOpenBatchModal?: () => void;
  onOpenImportModal?: () => void;
  onOpenNewStockModal?: () => void;
  onOpenReqModal: () => void;
  onExportCsv: (stage?: LifecycleStage) => void;
  onBulkAssignBranch?: (
    serials: string[],
    targetBranchCode: string,
    note?: string
  ) => void;
  onReturnToAdminStock?: (serials: string[], reason?: string) => void;
  onRequestReturnToAdminStock?: (serials: string[], reason?: string) => void;
  onRemoveFromDashboard?: (serials: string[], reason?: string) => void;
  onRestoreToDashboard?: (serials: string[]) => void;
  onDeletePermanently?: (serials: string[]) => void;
  onChangeBattery?: (serial: string) => void;
  theme?: ThemeMode;
  customFields?: CustomFieldDefinition[];
  syncingSerials?: Set<string>;
  fulfillingRequisition?: Requisition | null;
  onConfirmFulfillment?: (selectedSerials: string[]) => void;
  onCancelFulfillment?: () => void;
}

export const InventoryTab: React.FC<InventoryTabProps> = ({
  devices,
  allDevices = [],
  branches,
  role = 'BRANCH',
  selectedBranch,
  searchQuery,
  onSearchChange,
  stageFilter,
  onStageFilterChange,
  typeFilter,
  onTypeFilterChange,
  branchFilter,
  onBranchFilterChange,
  onSelectDevice,
  onOpenBatchModal,
  onOpenImportModal,
  onOpenReqModal,
  onExportCsv,
  onBulkAssignBranch,
  onReturnToAdminStock,
  onRequestReturnToAdminStock,
  onRemoveFromDashboard,
  onRestoreToDashboard,
  onDeletePermanently,
  onChangeBattery,
  theme,
  customFields,
  syncingSerials,
  fulfillingRequisition,
  onConfirmFulfillment,
  onCancelFulfillment,
}) => {
  const [selectedSns, setSelectedSns] = useState<string[]>([]);
  // No branch is pre-chosen for a bulk transfer: the admin picks the target explicitly.
  const [targetBulkBranch, setTargetBulkBranch] = useState<string>(fulfillingRequisition?.branchId || '');

  useEffect(() => {
    if (fulfillingRequisition?.branchId) {
      setTargetBulkBranch(fulfillingRequisition.branchId);
    }
  }, [fulfillingRequisition?.branchId]);
  const [showArchivedView, setShowArchivedView] = useState<boolean>(false);
  const [batteryFilter, setBatteryFilter] = useState<'ALL' | 'EXPIRED' | 'DUE_SOON' | 'HEALTHY'>('ALL');
  const [midDeviceFilter, setMidDeviceFilter] = useState<'ALL' | 'SINGLE' | 'MULTIPLE'>('ALL');
  const [rowsPerPage, setRowsPerPage] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);

  const isAdminLike = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const today = todayPP();
  const [showExportMenu, setShowExportMenu] = useState(false);
  const stageCounts = useMemo(() => {
    const c: Partial<Record<LifecycleStage, number>> = {};
    devices.forEach((d) => { c[d.stage] = (c[d.stage] || 0) + 1; });
    return c;
  }, [devices]);

  const duplicateMidsMap = useMemo(
    () => detectDuplicateMids(allDevices.length > 0 ? allDevices : devices),
    [allDevices, devices]
  );

  const branchNameByCode = useMemo(
    () => new Map(branches.map((b) => [b.code, b.name])),
    [branches]
  );

  const archivedCount = useMemo(() => {
    let count = 0;
    const len = allDevices.length;
    for (let i = 0; i < len; i++) {
      if (allDevices[i].archived) count++;
    }
    return count;
  }, [allDevices]);

  // High-Throughput Visible Devices Engine: Zero unnecessary array allocations
  const filteredDevices = useMemo(() => {
    const hasBatteryFilter = batteryFilter !== 'ALL';
    const hasMidDeviceFilter = midDeviceFilter !== 'ALL';
    if (!showArchivedView && !hasBatteryFilter && !hasMidDeviceFilter) {
      return devices;
    }

    const source = showArchivedView ? allDevices : devices;
    const result: Device[] = [];
    const len = source.length;

    for (let i = 0; i < len; i++) {
      const d = source[i];
      if (showArchivedView && !d.archived) continue;
      if (!showArchivedView && d.archived) continue;

      if (hasBatteryFilter) {
        const b = getBatteryLifecycleStatus(d, today);
        if (b.state !== batteryFilter) continue;
      }

      if (hasMidDeviceFilter) {
        const cleanMid = d.mid?.trim().toUpperCase();
        const hasMultiple = cleanMid ? duplicateMidsMap.has(cleanMid) : false;
        if (midDeviceFilter === 'SINGLE' && hasMultiple) continue;
        if (midDeviceFilter === 'MULTIPLE' && !hasMultiple) continue;
      }

      result.push(d);
    }
    return result;
  }, [devices, allDevices, showArchivedView, batteryFilter, midDeviceFilter, duplicateMidsMap, today]);
  // click a column heading to sort the whole list (ascending, descending, original order)
  const { sorted: visibleDevices, sort: invSort, toggle: invToggle } = useSort<Device>(filteredDevices, {
    stockIn: (d) => d.stockInDate, serial: (d) => d.serial, type: (d) => d.type, model: (d) => d.model,
    branch: (d) => Number(d.branchId) || d.branchId, stage: (d) => STAGE_META[d.stage]?.short || d.stage,
    merchant: (d) => d.merchantName, mid: (d) => d.mid, cycles: (d) => d.redeployCount || 0,
  });

  // Keep only selected serials that are still on screen after a filter / search / view change,
  // so a bulk action never touches units the operator can no longer see.
  const visibleSnSet = useMemo(() => new Set(visibleDevices.map((d) => d.serial)), [visibleDevices]);
  useEffect(() => {
    setSelectedSns((prev) => {
      const next = prev.filter((sn) => visibleSnSet.has(sn));
      return next.length === prev.length ? prev : next;
    });
  }, [visibleSnSet]);
  const selectedSet = useMemo(() => new Set(selectedSns), [selectedSns]);

  const totalPages = Math.max(1, Math.ceil(visibleDevices.length / rowsPerPage));

  // Auto-reset page if current page exceeds total pages
  React.useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(1);
    }
  }, [totalPages, currentPage]);

  // (23 Oct 2026) the next page is drawn in the background (the screen keeps moving), then glides in
  const shownPage = React.useDeferredValue(currentPage);
  const pagedDevices = useMemo(() => {
    const start = (shownPage - 1) * rowsPerPage;
    return visibleDevices.slice(start, start + rowsPerPage);
  }, [visibleDevices, shownPage, rowsPerPage]);

  const flipRef = useRef<HTMLTableSectionElement>(null);
  useFlip(flipRef, [pagedDevices]);

  // Combined single-pass calculation for POS and Sound Box counts
  const { posCount, sbCount } = useMemo(() => {
    let pos = 0;
    let sb = 0;
    const len = visibleDevices.length;
    for (let i = 0; i < len; i++) {
      const t = visibleDevices[i].type;
      if (t === 'POS Terminal') pos++;
      else if (t === 'Sound Box') sb++;
    }
    return { posCount: pos, sbCount: sb };
  }, [visibleDevices]);

  const allVisibleSelected =
    pagedDevices.length > 0 &&
    pagedDevices.every((d) => selectedSet.has(d.serial));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      const pageSns = new Set(pagedDevices.map((d) => d.serial));
      setSelectedSns((prev) => prev.filter((sn) => !pageSns.has(sn)));
    } else {
      setSelectedSns((prev) =>
        Array.from(new Set([...prev, ...pagedDevices.map((d) => d.serial)]))
      );
    }
  };

  const toggleSelectOne = (sn: string) => {
    setSelectedSns((prev) => {
      const set = new Set(prev);
      if (set.has(sn)) set.delete(sn);
      else set.add(sn);
      return Array.from(set);
    });
  };

  const handleSelectTenUnits = () => {
    const firstTen = pagedDevices.slice(0, 10).map((d) => d.serial);
    setSelectedSns(firstTen);
  };

  const { selectedPosCount, selectedSbCount, selectedNotEligible } = useMemo(() => {
    let pos = 0;
    let sb = 0;
    let notEligible = 0;
    for (const d of visibleDevices) {
      if (selectedSet.has(d.serial)) {
        if (d.type === 'POS Terminal') pos++;
        else if (d.type === 'Sound Box') sb++;
        // For a requisition only free Head Office stock can be picked (the server re-checks every unit).
        const allocatedTo = String(d.customFields?.allocatedTo || '').trim();
        if (
          d.stage !== 'HQ_STOCK' ||
          d.archived ||
          (allocatedTo && allocatedTo !== fulfillingRequisition?.reqId)
        )
          notEligible++;
      }
    }
    return { selectedPosCount: pos, selectedSbCount: sb, selectedNotEligible: notEligible };
  }, [selectedSet, visibleDevices, fulfillingRequisition?.reqId]);
  const fulfillmentError = fulfillingRequisition
    ? selectedNotEligible > 0
      ? `${selectedNotEligible} selected unit(s) are not free Head Office stock (wrong stage, archived or allocated to another request).`
      : selectedPosCount > fulfillingRequisition.posQty || selectedSbCount > fulfillingRequisition.sbQty
      ? 'More units selected than the branch requested.'
      : ''
    : '';

  // Double-Step Bulk Action State
  interface PendingBulkAction {
    type: 'ASSIGN' | 'RETURN_ADMIN' | 'REMOVE' | 'RESTORE' | 'DELETE';
    title: string;
    targetBranchId?: string;
    targetBranchName?: string;
    serials: string[];
    impactDescription: string;
  }
  const [pendingBulkAction, setPendingBulkAction] = useState<PendingBulkAction | null>(null);

  const handleOpenBulkAssign = () => {
    if (!selectedSns.length || !isAdminLike || !targetBulkBranch) return;
    const branchObj = branches.find((b) => b.code === targetBulkBranch);
    setPendingBulkAction({
      type: 'ASSIGN',
      title: `Bulk Stock Transfer to Branch Code ${targetBulkBranch}`,
      targetBranchId: targetBulkBranch,
      targetBranchName: branchObj ? branchObj.name : `Branch Code ${targetBulkBranch}`,
      serials: [...selectedSns],
      impactDescription: `You are about to transfer custody of ${selectedSns.length} hardware unit(s) to Branch Code ${targetBulkBranch} (${branchObj?.name || ''}). All assigned branch personnel will be granted access to these units in their Branch Reserve.`,
    });
  };

  const handleOpenBulkReturnAdmin = () => {
    if (!selectedSns.length) return;
    if (isAdminLike) {
      setPendingBulkAction({
        type: 'RETURN_ADMIN',
        title: 'Bulk Return to Head Office Admin Stock (Code 100)',
        targetBranchId: '100',
        targetBranchName: 'Head Office Admin Stock',
        serials: [...selectedSns],
        impactDescription: `You are about to return ${selectedSns.length} hardware unit(s) back to Head Office Admin Stock (Branch Code 100). Any active branch reservations or merchant bindings will be safely cleared.`,
      });
    } else {
      setPendingBulkAction({
        type: 'RETURN_ADMIN',
        title: 'Submit Return Request to Admin Stock',
        targetBranchId: '100',
        targetBranchName: 'Head Office Admin Stock (Pending Admin Approval)',
        serials: [...selectedSns],
        impactDescription: `You are about to submit a formal return request for ${selectedSns.length} hardware unit(s) to Head Office Admin Stock. Admin HQ will be notified to review and finalize this return into Admin Stock.`,
      });
    }
  };

  const handleOpenBulkRemove = () => {
    if (!selectedSns.length || !isAdminLike) return;
    setPendingBulkAction({
      type: 'REMOVE',
      title: 'Bulk Remove from Active Dashboard Inventory',
      serials: [...selectedSns],
      impactDescription: `You are about to archive ${selectedSns.length} hardware unit(s) from the active inventory ledger. They will be removed from live views and safely stored in the Removed / Archived tab for inspection or future restoration.`,
    });
  };

  const handleOpenBulkDelete = () => {
    if (!selectedSns.length || role !== 'SUPER_ADMIN') return;
    setPendingBulkAction({
      type: 'DELETE',
      title: 'Delete Permanently from the Shared Database',
      targetBranchName: 'Deleted (cannot be undone)',
      serials: [...selectedSns],
      impactDescription: `You are about to delete ${selectedSns.length} hardware unit(s) permanently from the shared database for every user. Their merchant history stays, but the units and their own history lines are lost. This cannot be undone. Use Remove from Dashboard instead if you may need them again.`,
    });
  };

  const handleOpenBulkRestore = () => {
    if (!selectedSns.length || !isAdminLike) return;
    setPendingBulkAction({
      type: 'RESTORE',
      title: 'Bulk Restore to Active Dashboard Inventory',
      serials: [...selectedSns],
      impactDescription: `You are about to reinstate ${selectedSns.length} archived hardware unit(s) back into the active multi-branch inventory ledger.`,
    });
  };

  const handleConfirmBulkAction = () => {
    if (!pendingBulkAction) return;

    if (pendingBulkAction.type === 'DELETE' && role !== 'SUPER_ADMIN') {
      setPendingBulkAction(null);
      return;
    }
    if (pendingBulkAction.type !== 'RETURN_ADMIN' && !isAdminLike) {
      setPendingBulkAction(null);
      return;
    }
    if (pendingBulkAction.type === 'ASSIGN' && onBulkAssignBranch && pendingBulkAction.targetBranchId) {
      onBulkAssignBranch(
        pendingBulkAction.serials,
        pendingBulkAction.targetBranchId,
        `Bulk Assigned ${pendingBulkAction.serials.length} units to Branch Code ${pendingBulkAction.targetBranchId}`
      );
    } else if (pendingBulkAction.type === 'RETURN_ADMIN') {
      if (isAdminLike && onReturnToAdminStock) {
        onReturnToAdminStock(
          pendingBulkAction.serials,
          'Bulk Return to Admin HQ Stock (Branch Code 100)'
        );
      } else if (!isAdminLike && onRequestReturnToAdminStock) {
        onRequestReturnToAdminStock(
          pendingBulkAction.serials,
          'Bulk Return to Admin HQ Stock requested by branch'
        );
      }
    } else if (pendingBulkAction.type === 'REMOVE' && onRemoveFromDashboard) {
      onRemoveFromDashboard(pendingBulkAction.serials, 'Removed from active dashboard ledger');
    } else if (pendingBulkAction.type === 'DELETE' && onDeletePermanently) {
      onDeletePermanently(pendingBulkAction.serials);
    } else if (pendingBulkAction.type === 'RESTORE' && onRestoreToDashboard) {
      onRestoreToDashboard(pendingBulkAction.serials);
    }

    setSelectedSns([]);
    setPendingBulkAction(null);
  };

  return (
    <div className="space-y-4">
      {/* Executive Glassmorphic Medium-Navy Serial Inventory Command Card */}
      <div className="surface-card rounded-2xl overflow-hidden border border-slate-200/90">
        {/* Top Glassmorphic Medium-Navy Header Strip (No Emerald Glass) */}
        <div className="navy-header-bar px-5 py-4 text-white flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-white/16 border border-white/25 flex items-center justify-center shrink-0 shadow-inner backdrop-blur-md">
              <Boxes className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base sm:text-lg font-extrabold tracking-tight text-white">
                  {showArchivedView
                    ? 'Removed / Archived Serials'
                    : 'Stock Inventory & Multi-Branch Ledger'}
                </h2>
                <span className="text-[11px] font-mono font-extrabold px-2.5 py-0.5 rounded-md bg-white text-zinc-900 shadow-2xs">
                  {visibleDevices.length.toLocaleString()} Active Units
                </span>
                <span className="hidden sm:inline-flex text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-white/14 text-white/95 border border-white/20">
                  {posCount.toLocaleString()} POS · {sbCount.toLocaleString()} Sound Box
                </span>
              </div>
              <p className="text-xs text-white/80 mt-0.5">
                Select multiple serials (e.g. Select 10) to batch-assign to a Branch Code or return to Admin HQ Stock
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">

            {!showArchivedView && visibleDevices.length > 0 && (
              <motion.button
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.97 }}
                onClick={handleSelectTenUnits}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold tracking-wide bg-white/16 hover:bg-white/24 text-white border border-white/25 transition cursor-pointer backdrop-blur-md"
                title="Quick-select 10 serials to assign to a Branch Code"
              >
                <CheckSquare className="w-3.5 h-3.5 text-white" />
                <span>Select 10 Units</span>
              </motion.button>
            )}

            <motion.button
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => {
                setShowArchivedView((prev) => !prev);
                setSelectedSns([]);
              }}
              title={showArchivedView ? 'Showing the units removed from the dashboard – tap to show the active stock again' : 'Show the units removed from the dashboard'}
              aria-pressed={showArchivedView}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold tracking-wide border transition cursor-pointer ${
                showArchivedView
                  ? 'bg-amber-400 text-zinc-900 border-amber-300'
                  : 'bg-white/12 hover:bg-white/20 text-white border-white/20'
              }`}
            >
              <ArchiveRestore className="w-3.5 h-3.5" />
              <span>
                {`Removed from Dashboard (${archivedCount})`}
              </span>
              {archivedCount > 0 && !showArchivedView && (
                <span className="w-2 h-2 rounded-full natural-red-point" />
              )}
            </motion.button>

            {!isAdminLike && (
              <motion.button
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.97 }}
                onClick={onOpenReqModal}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold tracking-wide bg-white hover:bg-slate-100 text-zinc-900 shadow-sm transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Request HQ Stock</span>
              </motion.button>
            )}

            <motion.button
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setShowExportMenu((v) => !v)}
              aria-expanded={showExportMenu}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold tracking-wide bg-white/12 hover:bg-white/20 text-white border border-white/20 transition cursor-pointer"
            >
              <FileDown className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </motion.button>

            {isAdminLike && (onOpenBatchModal || onOpenImportModal) && (
              <motion.button
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => {
                  if (onOpenBatchModal) onOpenBatchModal();
                  else if (onOpenImportModal) onOpenImportModal();
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-[#003857] hover:bg-[#002a42] text-white transition cursor-pointer shadow-sm"
                title="Upload CSV formatted as the inventory table"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Upload CSV</span>
              </motion.button>
            )}
          </div>
        </div>

        {/* Export by status */}
        <AnimatePresence initial={false}>
          {showExportMenu && (
            <motion.div
              initial={{ y: -8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -8, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 36, mass: 0.7 }}
              className="overflow-hidden border-b border-slate-200 bg-white"
            >
              <div className="px-4 py-3 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-600 mr-1">Export CSV for</span>
                <button type="button" onClick={() => { onExportCsv(); setShowExportMenu(false); }} className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#003857] bg-[#003857] text-white hover:bg-[#002a42] cursor-pointer">
                  All shown ({devices.length})
                </button>
                {STAGE_ORDER.map((s) => (
                  <button key={s} type="button" disabled={(stageCounts[s] || 0) === 0} onClick={() => { onExportCsv(s); setShowExportMenu(false); }}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 bg-white text-slate-800 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer">
                    {STAGE_META[s].short} ({stageCounts[s] || 0})
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Filter & Search Bar in Neutral Slate & Charcoal */}
        <div className="p-4 bg-slate-50/70 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                onSearchChange(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search Serial SN, Merchant, TID, Branch Code..."
              className="w-full pl-9 pr-3 py-2.5 rounded-xl text-xs font-semibold border bg-white border-slate-200 text-zinc-900 placeholder:text-slate-400 focus:border-zinc-700 outline-none transition shadow-2xs"
            />
          </div>

          <div className="relative">
            <select
              value={rowsPerPage}
              onChange={(e) => {
                setRowsPerPage(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="w-full px-3 py-2.5 rounded-xl text-xs font-bold border bg-white border-slate-200 text-zinc-800 focus:border-zinc-700 outline-none cursor-pointer shadow-2xs"
              title="Select view page (100 Row Max)"
            >
              <option value={50}>View: 50 Rows / Page</option>
              <option value={100}>View: 100 Rows / Page (Max)</option>
            </select>
          </div>

          <div className="relative">
            <Filter className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <select
              value={stageFilter}
              onChange={(e) => {
                onStageFilterChange(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full pl-8 pr-3 py-2.5 rounded-xl text-xs font-bold border bg-white border-slate-200 text-zinc-800 focus:border-zinc-700 outline-none cursor-pointer shadow-2xs"
            >
              <option value="ALL">All Lifecycle Stages</option>
              {STAGE_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STAGE_META[s].label}
                </option>
              ))}
            </select>
          </div>

          <select
            value={typeFilter}
            onChange={(e) => {
              onTypeFilterChange(e.target.value);
              setCurrentPage(1);
            }}
            className="px-3 py-2.5 rounded-xl text-xs font-bold border bg-white border-slate-200 text-zinc-800 focus:border-zinc-700 outline-none cursor-pointer shadow-2xs"
          >
            <option value="ALL">All Hardware Types</option>
            <option value="POS Terminal">POS Terminal (Wizar POS Q2 Pro)</option>
            <option value="Sound Box">Sound Box (QR Audio)</option>
          </select>

          <select
            value={midDeviceFilter}
            onChange={(e) => {
              setMidDeviceFilter(e.target.value as 'ALL' | 'SINGLE' | 'MULTIPLE');
              setCurrentPage(1);
            }}
            className="px-3 py-2.5 rounded-xl text-xs font-bold border bg-white border-slate-200 text-zinc-800 focus:border-zinc-700 outline-none cursor-pointer shadow-2xs"
            title="Filter by number of devices linked to MID"
          >
            <option value="ALL">All MIDs (Any Count)</option>
            <option value="SINGLE">1 Device per MID (Standard)</option>
            <option value="MULTIPLE">2+ Devices per MID (In Swap/Change)</option>
          </select>

          <select
            value={batteryFilter}
            onChange={(e) => {
              setBatteryFilter(e.target.value as any);
              setCurrentPage(1);
            }}
            className="px-3 py-2.5 rounded-xl text-xs font-bold border bg-white border-slate-200 text-zinc-800 focus:border-zinc-700 outline-none cursor-pointer shadow-2xs"
            title="Filter by POS Terminal 24-Month Battery Lifecycle"
          >
            <option value="ALL">All Battery Cycles</option>
            <option value="EXPIRED">🔴 Expired (&ge;24M Change Required)</option>
            <option value="DUE_SOON">🟡 Due Soon (21-23M)</option>
            <option value="HEALTHY">🟢 Healthy (&lt;21M)</option>
          </select>

          {isAdminLike ? (
            <select
              value={branchFilter}
              onChange={(e) => {
                onBranchFilterChange(e.target.value);
                setCurrentPage(1);
              }}
              className="px-3 py-2.5 rounded-xl text-xs font-bold border bg-white border-slate-200 text-zinc-800 focus:border-zinc-700 outline-none cursor-pointer shadow-2xs sm:col-span-2 md:col-span-3 lg:col-span-6"
            >
              <option value="ALL">All Branch Codes</option>
              {branches.map((b) => (
                <option key={b.code} value={b.code}>
                  Branch Code {b.code} — {b.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="px-3 py-2.5 rounded-xl text-xs font-mono font-bold border flex items-center gap-2 bg-zinc-900/5 border-zinc-300 text-zinc-900 sm:col-span-2 md:col-span-3 lg:col-span-6">
              <Building2 className="w-3.5 h-3.5" />
              <span>Scoped to Branch Code: {selectedBranch}</span>
            </div>
          )}
          <div className="sm:col-span-2 md:col-span-3 lg:col-span-6 flex justify-end">
            <ClearFiltersButton
              active={!!searchQuery || stageFilter !== 'ALL' || typeFilter !== 'ALL' || batteryFilter !== 'ALL' || midDeviceFilter !== 'ALL' || (isAdminLike && branchFilter !== 'ALL')}
              onClear={() => {
                onSearchChange(''); onStageFilterChange('ALL'); onTypeFilterChange('ALL');
                if (isAdminLike) onBranchFilterChange('ALL');
                setBatteryFilter('ALL'); setMidDeviceFilter('ALL'); setCurrentPage(1);
              }}
            />
          </div>
        </div>
      </div>

      {/* GUIDED REQUISITION FULFILLMENT BANNER */}
      {fulfillingRequisition && isAdminLike && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl p-4 border shadow-xl flex flex-col xl:flex-row xl:items-center justify-between gap-3 bg-[#003857] text-white border-sky-400/30"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-white shrink-0">
              <Truck className="w-5 h-5 text-sky-200" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-extrabold flex flex-wrap items-center gap-2">
                <span>Select Hardware for Requisition {fulfillingRequisition.reqId}</span>
                <span className="px-2 py-0.5 rounded text-[10px] bg-sky-400/20 text-sky-200 border border-sky-400/30 font-mono">
                  Target Branch Code {fulfillingRequisition.branchId} ({fulfillingRequisition.branchName.replace(' Branch', '')})
                </span>
              </div>
              <div className="text-xs text-sky-100/90 mt-1 flex flex-wrap items-center gap-2.5">
                <span>
                  Quota:{' '}
                  <strong>{fulfillingRequisition.posQty} POS</strong> &amp;{' '}
                  <strong>{fulfillingRequisition.sbQty} Sound Box</strong>
                </span>
                <span className="opacity-40">|</span>
                <span>
                  Selected:{' '}
                  <span
                    className={`font-mono font-extrabold ${
                      selectedPosCount === fulfillingRequisition.posQty
                        ? 'text-emerald-300'
                        : selectedPosCount > fulfillingRequisition.posQty
                        ? 'text-rose-300'
                        : 'text-amber-300'
                    }`}
                  >
                    {selectedPosCount}/{fulfillingRequisition.posQty} POS
                  </span>
                  {', '}
                  <span
                    className={`font-mono font-extrabold ${
                      selectedSbCount === fulfillingRequisition.sbQty
                        ? 'text-emerald-300'
                        : selectedSbCount > fulfillingRequisition.sbQty
                        ? 'text-rose-300'
                        : 'text-amber-300'
                    }`}
                  >
                    {selectedSbCount}/{fulfillingRequisition.sbQty} Sound Box
                  </span>
                  {' '}(Total: {selectedSns.length} units)
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {fulfillmentError && (
              <span role="alert" className="text-[11px] font-semibold text-rose-200 max-w-[260px]">
                {fulfillmentError}
              </span>
            )}
            {onCancelFulfillment && (
              <button
                type="button"
                onClick={onCancelFulfillment}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-white/10 hover:bg-white/20 text-white cursor-pointer transition border border-white/15"
              >
                Cancel Selection
              </button>
            )}
            {onConfirmFulfillment && (
              <button
                type="button"
                disabled={selectedSns.length === 0 || !!fulfillmentError}
                onClick={() => {
                  if (!fulfillmentError) onConfirmFulfillment(selectedSns);
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold tracking-wide bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-slate-950 flex items-center gap-1.5 shadow-md cursor-pointer transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Confirm Selection ({selectedSns.length}) &amp; Dispatch ➔</span>
              </button>
            )}
          </div>
        </motion.div>
      )}

      {/* MULTI-SELECTION & BULK ASSIGNMENT COMMAND BAR (Dark Charcoal matching Sidebar) */}
      <AnimatePresence>
        {selectedSns.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="rounded-2xl p-4 border shadow-xl flex flex-col xl:flex-row xl:items-center justify-between gap-3 bg-[#18191e] text-white border-zinc-700/80"
          >
            <div className="flex flex-wrap items-center gap-3">
              <span className="px-3 py-1 rounded-xl bg-white text-zinc-900 font-mono text-xs font-bold shadow-2xs">
                {selectedSns.length} Serial{selectedSns.length === 1 ? '' : 's'} Selected
              </span>
              {fulfillingRequisition && isAdminLike ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-md bg-sky-500/20 text-sky-300 font-mono text-[11px] font-bold border border-sky-400/30">
                    REQ {fulfillingRequisition.reqId}
                  </span>
                  <span className="text-xs font-semibold text-white">
                    Direct connect to Requester: <strong className="text-emerald-400 font-bold">Branch Code {fulfillingRequisition.branchId} ({fulfillingRequisition.branchName})</strong>
                  </span>
                </div>
              ) : (
                <span className="text-xs font-semibold text-white/90">
                  {isAdminLike
                    ? 'Batch assign selected units to a target Branch Code, return to Admin Stock, or remove from dashboard:'
                    : 'Request the return of the selected units to Head Office Admin Stock:'}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!showArchivedView ? (
                <>
                  {!isAdminLike ? null : fulfillingRequisition ? (
                    <div className="flex items-center bg-[#004953] rounded-xl p-1 border border-emerald-400/30 text-white shadow-xs">
                      <div className="px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 text-emerald-200">
                        <Building2 className="w-3.5 h-3.5 text-emerald-300" />
                        <span>Requester: Branch Code {fulfillingRequisition.branchId}</span>
                      </div>
                      <button
                        type="button"
                        disabled={!!fulfillmentError}
                        title={fulfillmentError || undefined}
                        onClick={() => {
                          if (fulfillmentError) return;
                          if (onConfirmFulfillment) {
                            onConfirmFulfillment(selectedSns);
                          } else {
                            handleOpenBulkAssign();
                          }
                        }}
                        className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold tracking-wide transition cursor-pointer flex items-center gap-1.5 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Assign {selectedSns.length} to Branch Code {fulfillingRequisition.branchId}</span>
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center bg-[#24262d] rounded-xl p-1 border border-white/15">
                      <select
                        value={targetBulkBranch}
                        onChange={(e) => setTargetBulkBranch(e.target.value)}
                        aria-label="Target branch for bulk transfer"
                        className="bg-transparent text-white text-xs font-semibold px-2.5 py-1.5 outline-none cursor-pointer"
                      >
                        <option value="" disabled className="bg-[#003857] text-white">
                          Choose target branch…
                        </option>
                        {branches
                          .filter((b) => b.code !== '100')
                          .map((b) => (
                            <option
                              key={b.code}
                              value={b.code}
                              className="bg-[#003857] text-white"
                            >
                              Assign to Branch Code {b.code} ({b.name})
                            </option>
                          ))}
                      </select>
                      <button
                        type="button"
                        onClick={handleOpenBulkAssign}
                        disabled={!targetBulkBranch}
                        className="px-3 py-1.5 rounded-lg bg-white text-zinc-900 hover:bg-slate-100 text-xs font-semibold tracking-wide transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {targetBulkBranch
                          ? `Assign ${selectedSns.length} to Branch Code ${targetBulkBranch}`
                          : 'Choose a branch first'}
                      </button>
                    </div>
                  )}

                  {!fulfillingRequisition && (
                    <button
                      onClick={handleOpenBulkReturnAdmin}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-zinc-900 text-xs font-semibold tracking-wide transition cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>{isAdminLike ? 'Return to Admin Stock' : 'Request Return to Admin Stock'}</span>
                    </button>
                  )}

                  {!fulfillingRequisition && isAdminLike && (
                    <button
                      onClick={handleOpenBulkRemove}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold tracking-wide transition cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Remove from Dashboard</span>
                    </button>
                  )}
                  {role === 'SUPER_ADMIN' && onDeletePermanently && (
                    <button
                      onClick={handleOpenBulkDelete}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-900 hover:bg-rose-800 text-white text-xs font-semibold tracking-wide transition cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete Permanently</span>
                    </button>
                  )}
                </>
              ) : !isAdminLike ? null : (
                <>
                {role === 'SUPER_ADMIN' && onDeletePermanently && (
                  <button
                    onClick={handleOpenBulkDelete}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-900 hover:bg-rose-800 text-white text-xs font-semibold tracking-wide transition cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Permanently</span>
                  </button>
                )}
                <button
                  onClick={handleOpenBulkRestore}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-100 text-[#133e5e] text-xs font-semibold tracking-wide transition cursor-pointer"
                >
                  <ArchiveRestore className="w-3.5 h-3.5" />
                  <span>Restore {selectedSns.length} to Active Dashboard</span>
                </button>
                </>
              )}

              <button
                onClick={() => setSelectedSns([])}
                className="px-2.5 py-2 rounded-xl bg-white/12 hover:bg-white/22 text-xs font-semibold tracking-wide transition cursor-pointer"
              >
                Clear
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Restyled Glassmorphic Medium-Navy Hardware Serial Ledger Table */}
      <div className="surface-card rounded-2xl border border-slate-200/90 overflow-hidden no-scrollbar">
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full min-w-[960px] text-left">
            <thead className="glass-table-thead text-[11px] font-extrabold uppercase tracking-wider text-white">
              <tr>
                <th className="py-2.5 px-3 w-10">
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="flex items-center justify-center text-white cursor-pointer"
                    title="Select All Visible Serials"
                    aria-label={allVisibleSelected ? 'Unselect all serials on this page' : 'Select all serials on this page'}
                    aria-pressed={allVisibleSelected}
                  >
                    {allVisibleSelected ? (
                      <CheckSquare className="w-4 h-4 text-white" />
                    ) : (
                      <Square className="w-4 h-4 text-white/75 hover:text-white" />
                    )}
                  </button>
                </th>
                <th className="py-2.5 px-3 w-10 text-right">No.</th>
                <SortTh k="stockIn" sort={invSort} onSort={invToggle} className="py-2.5 px-3">Stock-In Date</SortTh>
                <SortTh k="serial" sort={invSort} onSort={invToggle} className="py-2.5 px-3">Serial Number</SortTh>
                <SortTh k="type" sort={invSort} onSort={invToggle} className="py-2.5 px-3">Device Type</SortTh>
                <SortTh k="model" sort={invSort} onSort={invToggle} className="py-2.5 px-3">Model</SortTh>
                <SortTh k="branch" sort={invSort} onSort={invToggle} className="py-2.5 px-3">Branch Code &amp; Name</SortTh>
                <SortTh k="stage" sort={invSort} onSort={invToggle} className="py-2.5 px-3">Lifecycle Stage</SortTh>
                <SortTh k="merchant" sort={invSort} onSort={invToggle} className="py-2.5 px-3">Merchant Name</SortTh>
                <SortTh k="mid" sort={invSort} onSort={invToggle} className="py-2.5 px-3">Merchant ID (MID)</SortTh>
                <SortTh k="cycles" sort={invSort} onSort={invToggle} align="center" className="py-2.5 px-3 text-center">Serial Cycles</SortTh>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody ref={flipRef} className="divide-y divide-slate-200/80 text-xs bg-white">
              {pagedDevices.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-8 text-center text-slate-400">
                    No hardware serials match the current filters.
                  </td>
                </tr>
              ) : (
                pagedDevices.map((dev, index) => {
                  const isChecked = selectedSet.has(dev.serial);
                  const meta = STAGE_META[dev.stage];
                  const cycleCount = dev.redeployCount || 0;
                  const batt = getBatteryLifecycleStatus(dev, today);
                  const resolvedBranchName =
                    branchNameByCode.get(dev.branchId) ||
                    dev.branchName ||
                    `Branch ${dev.branchId}`;
                  // Only the unit's own recorded battery serial is shown; nothing is made up.
                  const formattedBatterySerial = dev.batterySerial?.trim() || 'No battery serial';

                  const isSyncingThisDevice = syncingSerials?.has(dev.serial);

                  return (
                    <tr
                      key={dev.serial}
                      data-flip={dev.serial}
                      className={`transition-colors interactive-row ${
                        isSyncingThisDevice ? 'optimistic-sync-active' : ''
                      } ${
                        isChecked
                          ? 'bg-zinc-100'
                          : index % 2 === 1
                          ? 'bg-slate-50/45 hover:bg-zinc-50'
                          : 'hover:bg-zinc-50'
                      }`}
                    >
                      <td className="py-2 px-3">
                        <button
                          type="button"
                          onClick={() => toggleSelectOne(dev.serial)}
                          className="flex items-center justify-center cursor-pointer"
                          aria-label={`${isChecked ? 'Unselect' : 'Select'} serial ${dev.serial}`}
                          aria-pressed={isChecked}
                        >
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-zinc-900" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400 hover:text-zinc-900" />
                          )}
                        </button>
                      </td>

                      <td className="py-2 px-3 text-right text-[11px] text-slate-500 tabular-nums">{(currentPage - 1) * rowsPerPage + index + 1}</td>

                      <td className="py-2 px-3 font-mono text-[11px] whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-900/5 text-zinc-800 border border-zinc-200 font-bold">
                          <Calendar className="w-3 h-3" />
                          <span>{dev.stockInDate}</span>
                        </span>
                      </td>

                      <td
                        onClick={() => onSelectDevice(dev.serial)}
                        className="py-2 px-3 cursor-pointer group"
                      >
                        <div className="font-mono text-xs text-slate-700 group-hover:underline">
                          {dev.serial}
                        </div>
                        {dev.type === 'POS Terminal' ? (
                          <div
                            onClick={(e) => {
                              if (onChangeBattery) {
                                e.stopPropagation();
                                onChangeBattery(dev.serial);
                              }
                            }}
                            title={`POS Terminal Battery: ${formattedBatterySerial} (${batt.monthsUsed}/24m · Click to Change Battery)`}
                            className="mt-0.5 font-mono text-[11px] text-slate-600 hover:text-zinc-900 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                          >
                            <span className="hover:underline">{formattedBatterySerial}</span>
                            {batt.state === 'EXPIRED' && (
                              <span
                                title={`Battery Expired (${batt.monthsUsed} months >= 24M limit) — Click to Change Battery`}
                                className="px-1.5 py-0.2 rounded text-[9px] bg-rose-100 text-rose-700 border border-rose-300 flex items-center gap-1 shrink-0"
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse inline-block" />
                                <span>Expired (≥24M)</span>
                              </span>
                            )}
                            {batt.state === 'DUE_SOON' && (
                              <span
                                title={`Battery Due Soon (${batt.monthsRemaining}m remaining) — Click to Change Battery`}
                                className="px-1.5 py-0.2 rounded text-[9px] bg-amber-100 text-amber-800 border border-amber-300 shrink-0"
                              >
                                Due Soon
                              </span>
                            )}
                          </div>
                        ) : dev.batterySerial ? (
                          <div className="mt-0.5 font-mono text-[11px] text-slate-500">
                            {dev.batterySerial}
                          </div>
                        ) : null}
                      </td>

                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                          {dev.type === 'POS Terminal' ? (
                            <Cpu className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                          ) : (
                            <Volume2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                          )}
                          <span className="text-slate-700 text-xs">
                            {dev.type}
                          </span>
                        </div>
                      </td>

                      <td className="py-2 px-3">
                        <div className="text-zinc-900 text-xs whitespace-nowrap">
                          {dev.model}
                        </div>
                      </td>

                      <td className="py-2 px-3">
                        <div className="khmer text-xs text-slate-700 max-w-[200px] leading-snug" title={`${dev.installedByStaff || dev.staff || '-'} · ${dev.branchId} · ${resolvedBranchName}`}>
                          <div className="truncate text-[11px] text-slate-500">{dev.installedByStaff || dev.staff || '-'}</div>
                          <div className="truncate">
                            <span className="font-mono text-[11px] text-slate-600">{dev.branchId}</span>
                            <span> · {resolvedBranchName.replace(' Branch', '')}</span>
                          </div>
                        </div>
                      </td>

                      <td className="py-2 px-3">
                        <span
                          className={`inline-block text-[10px] px-2 py-0.5 rounded-md border ${meta.badgeClassLight}`}
                        >
                          {meta.short}
                        </span>
                      </td>

                      <td className="py-2 px-3">
                        {dev.merchantName ? (
                          <div className="flex flex-col max-w-[175px]">
                            <span
                              className="khmer text-slate-700 text-xs font-normal truncate cursor-pointer"
                              title={`${dev.merchantName} · Installed: ${dev.installedByStaff || dev.staff || '-'}${dev.replacedByStaff ? ` · Replaced: ${dev.replacedByStaff}` : ''}${dev.returnedByStaff ? ` · Returned: ${dev.returnedByStaff}` : ''}`}
                            >
                              {dev.merchantName}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic text-[11px]">
                            Unassigned
                          </span>
                        )}
                      </td>

                      <td className="py-2 px-3 font-mono">
                        {dev.mid ? (
                          <div className="flex flex-col gap-1 items-start">
                            <div className="inline-flex items-center gap-1">
                              <span
                                className={`px-1.5 py-0.5 rounded border text-[10px] whitespace-nowrap ${
                                  /^\d{15}$/.test(dev.mid)
                                    ? 'text-slate-700 bg-slate-100/90 border-slate-200 dark:text-slate-200 dark:bg-white/10 dark:border-white/10'
                                    : 'text-rose-700 bg-rose-50 border-rose-300 dark:text-rose-300 dark:bg-rose-500/20 dark:border-rose-500/30'
                                }`}
                                title={
                                  /^\d{15}$/.test(dev.mid)
                                    ? `Merchant ID: ${dev.mid} (15 Digits Standard)`
                                    : `Invalid MID: ${dev.mid.length} digits (Policy requires 15 digits)`
                                }
                              >
                                {dev.mid}
                              </span>
                              {!/^\d{15}$/.test(dev.mid) && (
                                <span
                                  className="text-[9px] font-bold text-rose-600 bg-rose-100 px-1 py-0.2 rounded"
                                  title="MID must be exactly 15 numeric digits"
                                >
                                  !15D
                                </span>
                              )}
                            </div>
                            {duplicateMidsMap.has(dev.mid.trim().toUpperCase()) && (
                              <span
                                title={`Active Serials on this MID: ${duplicateMidsMap.get(dev.mid.trim().toUpperCase())?.serials.join(', ')} (Device swap / change in progress)`}
                                className="inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-semibold bg-slate-100 text-slate-700 border border-slate-200 dark:bg-white/10 dark:text-slate-300 dark:border-white/15 whitespace-nowrap"
                              >
                                <span>
                                  {duplicateMidsMap.get(dev.mid.trim().toUpperCase())?.serials.length} Serials
                                </span>
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 text-[11px]">-</span>
                        )}
                      </td>

                      <td className="py-2 px-3 text-center">
                        <button
                          onClick={() => onSelectDevice(dev.serial)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border font-mono text-[10px] transition cursor-pointer whitespace-nowrap bg-slate-100 hover:bg-[#003857] text-slate-700 hover:text-white border-slate-200"
                          title="Serial Cycle count after return from other merchant (click to view history)"
                        >
                          <History className="w-3 h-3" />
                          <span>
                            {cycleCount} Cycle{cycleCount === 1 ? '' : 's'}
                          </span>
                        </button>
                      </td>

                      <td className="py-2 px-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => onSelectDevice(dev.serial)}
                            className="px-2.5 py-1 rounded-md bg-[#003857] hover:bg-[#002a42] text-white text-[10px] font-medium shadow-2xs transition cursor-pointer whitespace-nowrap"
                          >
                            Manage
                          </button>

                          {!showArchivedView &&
                            isAdminLike &&
                            onRemoveFromDashboard && (
                              <button
                                onClick={() =>
                                  onRemoveFromDashboard(
                                    [dev.serial],
                                    'Removed from active dashboard view'
                                  )
                                }
                                className="p-1 rounded-md border bg-rose-50 hover:bg-rose-100 border-rose-200 text-rose-700 transition cursor-pointer"
                                title="Remove from Dashboard"
                                aria-label={`Remove ${dev.serial} from dashboard`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}

                          {showArchivedView && isAdminLike && onRestoreToDashboard && (
                            <button
                              onClick={() => onRestoreToDashboard([dev.serial])}
                              className="px-2.5 py-1.5 rounded-lg bg-[#003857] hover:bg-[#002a42] text-white text-[11px] font-bold cursor-pointer transition shadow-2xs"
                            >
                              Restore
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar with 100 Row Max */}
        <div className="p-4 bg-slate-50 border-t border-slate-200/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
          <div className="flex items-center gap-3">
            <span className="font-medium text-slate-500">
              Showing{' '}
              <strong className="text-zinc-900">
                {visibleDevices.length === 0 ? 0 : (currentPage - 1) * rowsPerPage + 1}
              </strong>{' '}
              –{' '}
              <strong className="text-zinc-900">
                {Math.min(currentPage * rowsPerPage, visibleDevices.length)}
              </strong>{' '}
              of <strong className="text-zinc-900">{visibleDevices.length}</strong> Serials
            </span>

            <div className="hidden md:flex items-center gap-1 pl-3 border-l border-slate-200">
              <span className="text-[11px] text-slate-400 font-semibold">Rows:</span>
              {[50, 100].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => {
                    setRowsPerPage(num);
                    setCurrentPage(1);
                  }}
                  className={`px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer transition ${
                    rowsPerPage === num
                      ? 'bg-[#004953] text-white shadow-2xs'
                      : 'bg-white hover:bg-slate-200 text-slate-600 border border-slate-200'
                  }`}
                >
                  {num}{num === 100 ? ' Max' : ''}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="p-1.5 rounded-lg border bg-white border-slate-200 text-slate-600 hover:text-zinc-900 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition"
              title="Previous Page"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <span className="font-mono text-xs font-bold px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-zinc-900">
              Page {currentPage} of {totalPages}
            </span>

            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="p-1.5 rounded-lg border bg-white border-slate-200 text-slate-600 hover:text-zinc-900 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition"
              title="Next Page"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* DOUBLE-STEP BULK ACTION CONFIRMATION & IMPACT PREVIEW MODAL */}
      <AnimatePresence>
        {pendingBulkAction && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPendingBulkAction(null)}
              className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs"
            />

            {/* Modal Window */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ type: 'spring', damping: 28, stiffness: 380 }}
              className="relative w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden my-6 z-10 border bg-white border-slate-200 text-slate-800"
            >
              {/* Navy Header */}
              <div className="navy-header-bar px-6 py-4 flex items-center justify-between text-white border-b border-white/10">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center text-white shadow-xs">
                    {pendingBulkAction.type === 'ASSIGN' ? (
                      <Building2 className="w-4.5 h-4.5" />
                    ) : pendingBulkAction.type === 'RETURN_ADMIN' ? (
                      <RotateCcw className="w-4.5 h-4.5" />
                    ) : pendingBulkAction.type === 'REMOVE' || pendingBulkAction.type === 'DELETE' ? (
                      <Trash2 className="w-4.5 h-4.5" />
                    ) : (
                      <ArchiveRestore className="w-4.5 h-4.5" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold tracking-tight text-white">
                      {pendingBulkAction.title}
                    </h3>
                    <p className="text-[11px] text-white/75 mt-0.5">
                      Step 2 of 2: Impact Review &amp; Batch Confirmation
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPendingBulkAction(null)}
                  aria-label="Close"
                  className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Stepper Progress Indicator */}
              <div className="px-6 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-slate-500 font-bold">
                    <span className="w-4 h-4 rounded-full bg-slate-200 flex items-center justify-center text-[10px] text-slate-700">1</span>
                    <span>{pendingBulkAction.serials.length} Units Selected</span>
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#004953] text-white font-bold shadow-2xs">
                    <span className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center text-[10px]">2</span>
                    <span>Review &amp; Execute</span>
                  </span>
                </div>

                <div className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#1e5b88]" />
                  <span>Double-Step Active</span>
                </div>
              </div>

              {/* Body */}
              <div className="p-6 space-y-4 text-xs">
                {/* Impact Banner */}
                <div className="p-3.5 rounded-xl border bg-amber-50/80 border-amber-200/80 text-amber-900 flex items-start gap-3">
                  <AlertTriangle className="w-4.5 h-4.5 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-xs leading-relaxed font-medium">
                    {pendingBulkAction.impactDescription}
                  </p>
                </div>

                {/* Key Impact Stats */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl border bg-slate-50 border-slate-200">
                    <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                      Total Devices Impacted
                    </span>
                    <span className="text-base font-extrabold text-slate-900 font-mono mt-0.5 block">
                      {pendingBulkAction.serials.length} Hardware Units
                    </span>
                  </div>

                  <div className="p-3 rounded-xl border bg-slate-50 border-slate-200">
                    <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                      Target Destination
                    </span>
                    <span className="text-xs font-bold text-slate-900 mt-1 block truncate">
                      {pendingBulkAction.targetBranchName || (pendingBulkAction.type === 'REMOVE' ? 'Removed Archive' : 'Active Inventory')}
                    </span>
                  </div>
                </div>

                {/* List of Affected Serials */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                      Staged Serial Numbers ({pendingBulkAction.serials.length})
                    </label>
                    <span className="text-[10px] text-slate-400 font-medium">
                      Scroll to inspect all
                    </span>
                  </div>
                  <div className="max-h-36 overflow-y-auto p-3 rounded-xl border bg-slate-50 border-slate-200 flex flex-wrap gap-1.5">
                    {pendingBulkAction.serials.map((sn) => (
                      <span
                        key={sn}
                        className="px-2.5 py-1 rounded-lg font-mono text-[11px] font-bold bg-white border border-slate-200/90 text-slate-800 shadow-2xs"
                      >
                        {sn}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Permanent Audit Log Notice */}
                <div className="text-[11px] text-slate-500 font-medium flex items-center gap-1.5 pt-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>
                    Each mutated device will record a verified entry in the tamper-evident audit ledger.
                  </span>
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setPendingBulkAction(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold border bg-white hover:bg-slate-100 text-slate-700 border-slate-300 transition cursor-pointer"
                >
                  Cancel / Go Back
                </button>
                <button
                  type="button"
                  onClick={handleConfirmBulkAction}
                  className="px-5 py-2 rounded-xl bg-[#003857] hover:bg-[#002a42] text-white text-xs font-bold shadow-xs transition cursor-pointer flex items-center gap-2"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Confirm &amp; Execute ({pendingBulkAction.serials.length} Units)</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

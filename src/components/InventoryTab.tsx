import { ClearFiltersButton } from './ClearFiltersButton';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSort, SortTh } from '../utils/sort';
import { useKeptMemo } from '../utils/useKeptMemo';
import { isFresh } from '../utils/freshness';
import { getCachedDevicePage, setCachedDevicePage, makeDevicePageKey } from '../services/inventoryCache';
import {
  Device,
  Branch,
  UserRole,
  ThemeMode,
  STAGE_ORDER,
  getBatteryLifecycleStatus,
  Requisition,
  LifecycleStage,
} from '../types';
import { STAGE_META } from '../data/initialData';
import { detectDuplicateMids } from '../utils/crmUtils';
import { hasKhmer, isValidMidForType, midRuleError } from '../utils/display';
const dash = (v: string | null | undefined) => (String(v || '').trim() ? String(v) : '—');
import { todayPP } from '../utils/time';
import { motion, AnimatePresence } from 'motion/react';
import {
  RightDrawerFrame,
  SIM_HEADER_CLS,
  SIM_ICON_BOX_CLS,
  SIM_CLOSE_BTN_CLS,
  SIM_SUBHEADER_CLS,
  SIM_BODY_CLS,
  SIM_FOOTER_CLS,
  SIM_BTN_CANCEL_CLS,
  SIM_BTN_PRIMARY_CLS,
  simStepPillCls,
  simStepNumCls,
} from './RightDrawerShell';
import {
  Check,
  Minus,
  Search,
  Filter,
  Plus,
  FileSpreadsheet,
  CheckSquare,
  Building2,
  RotateCcw,
  Trash2,
  History,
  Cpu,
  Volume2,

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
import { useDrawLimit } from '../utils/usePager';
import { formatBranchName, showDateTime } from '../utils/format';

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
  /** (5 Nov 2026) on the POS Terminal / Sound Box pages the product is fixed: the type list is hidden */
  lockType?: boolean;
  viewToggle?: React.ReactNode;
  stockScopeControl?: React.ReactNode;
  materialSummaryStrip?: React.ReactNode;
  branchFilter: string;
  onBranchFilterChange: (b: string) => void;
  onSelectDevice: (sn: string) => void;
  /** (23 Oct 2026) Return: the merchant's details are removed (kept in Merchant History) and the unit goes back to stock */
  onReturnDevice?: (sn: string) => void;
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
  syncingSerials?: Set<string>;
  fulfillingRequisition?: Requisition | null;
  onConfirmFulfillment?: (selectedSerials: string[]) => void;
  onCancelFulfillment?: () => void;
  serverTotalDevices?: number | null;
  serverArchivedCount?: number | null;
  serverStageCounts?: Partial<Record<LifecycleStage, number>>;
  onFetchServerPage?: (params: {
    page: number;
    pageSize: number;
    stage?: string;
    type?: string;
    branchId?: string;
    search?: string;
    archived?: boolean;
  }) => Promise<{ rows: Device[]; total: number } | null>;
  heroControlsContainer?: HTMLElement | null;
}

export const InventoryTab: React.FC<InventoryTabProps> = ({
  lockType,
  viewToggle,
  materialSummaryStrip,
  heroControlsContainer,
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
  syncingSerials,
  fulfillingRequisition,
  onConfirmFulfillment,
  onCancelFulfillment,
  serverTotalDevices = null,
  serverArchivedCount = null,
  serverStageCounts,
  onFetchServerPage,
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
  const effectiveBranch = role === 'BRANCH' ? selectedBranch : branchFilter;
  const pageCacheKey = useMemo(() => makeDevicePageKey({
    page: currentPage,
    pageSize: rowsPerPage,
    stage: stageFilter,
    type: typeFilter,
    branchId: effectiveBranch,
    search: searchQuery,
    archived: showArchivedView,
  }), [currentPage, rowsPerPage, stageFilter, typeFilter, effectiveBranch, searchQuery, showArchivedView]);

  const [serverPageRows, setServerPageRows] = useState<Device[] | null>(() => getCachedDevicePage(pageCacheKey)?.rows ?? null);
  const [serverMatchedTotal, setServerMatchedTotal] = useState<number | null>(() => getCachedDevicePage(pageCacheKey)?.total ?? null);

  const isServerPaginated = Boolean(
    onFetchServerPage && typeof serverTotalDevices === 'number' && serverTotalDevices > 10000 && allDevices.length < serverTotalDevices / 2
  );

  // Fetch the active server page when the dataset exceeds 100 rows (up to 500,000+ rows)
  useEffect(() => {
    if (!isServerPaginated || !onFetchServerPage) {
      setServerPageRows(null);
      setServerMatchedTotal(null);
      return;
    }
    const hit = getCachedDevicePage(pageCacheKey);
    if (hit) {
      setServerPageRows(hit.rows);
      setServerMatchedTotal(hit.total);
      if (isFresh('inv:p:' + pageCacheKey, 60000)) return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      onFetchServerPage({
        page: currentPage,
        pageSize: rowsPerPage,
        stage: stageFilter,
        type: typeFilter,
        branchId: effectiveBranch,
        search: searchQuery,
        archived: showArchivedView,
      }).then((res) => {
        if (!cancelled && res) {
          setServerPageRows(res.rows);
          setServerMatchedTotal(res.total);
          setCachedDevicePage(pageCacheKey, res);
        }
      });
    }, searchQuery.trim() ? 180 : 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    isServerPaginated,
    onFetchServerPage,
    pageCacheKey,
    currentPage,
    rowsPerPage,
    stageFilter,
    typeFilter,
    effectiveBranch,
    searchQuery,
    showArchivedView,
  ]);

  const isAdminLike = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const isLight = theme !== 'dark';
  const today = todayPP();
  const [showExportMenu, setShowExportMenu] = useState(false);
  const stageCounts = useMemo(() => {
    if (serverStageCounts) return serverStageCounts;
    const c: Partial<Record<LifecycleStage, number>> = {};
    devices.forEach((d) => { c[d.stage] = (c[d.stage] || 0) + 1; });
    return c;
  }, [devices, serverStageCounts]);

  // Avoid rebuilding 27k-row lookup maps on every filter/search change when allDevices is present
  const fallbackPool = allDevices.length > 0 ? null : devices;
  const latestBySerial = useKeptMemo(
    'inv.latestBySerial',
    () =>
      isServerPaginated
        ? new Map((allDevices.length > 0 ? allDevices : devices).map((d) => [d.serial, d]))
        : new Map<string, Device>(),
    [isServerPaginated, allDevices, fallbackPool]
  );

  const duplicateMidsMap = useKeptMemo(
    'inv.duplicateMids',
    () => detectDuplicateMids(allDevices.length > 0 ? allDevices : devices),
    [allDevices, fallbackPool]
  );

  const branchNameByCode = useMemo(
    () => new Map(branches.map((b) => [b.code, b.name])),
    [branches]
  );

  const archivedCount = useMemo(() => {
    if (typeof serverArchivedCount === 'number') return serverArchivedCount;
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
    if (!showArchivedView && !hasBatteryFilter && !hasMidDeviceFilter && !(isServerPaginated && serverPageRows !== null)) {
      return devices;
    }

    const source =
      isServerPaginated && serverPageRows !== null
        ? serverPageRows.map((d) => latestBySerial.get(d.serial) || d)
        : showArchivedView
        ? allDevices
        : devices;
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
  }, [devices, allDevices, showArchivedView, batteryFilter, midDeviceFilter, duplicateMidsMap, today, isServerPaginated, serverPageRows, latestBySerial]);
  // click a column heading to sort the whole list (ascending, descending, original order)
  const { sorted: visibleDevices, sort: invSort, toggle: invToggle } = useSort<Device>(filteredDevices, {
    stockIn: (d) => d.stockInDate, serial: (d) => d.serial, type: (d) => d.type, model: (d) => d.model,
    branch: (d) => Number(d.branchId) || d.branchId, stage: (d) => STAGE_META[d.stage]?.short || d.stage,
    merchant: (d) => d.merchantName, mid: (d) => d.mid, cycles: (d) => d.redeployCount || 0,
  });

  // Keep only selected serials that are still on screen after a filter / search / view change,
  // so a bulk action never touches units the operator can no longer see.
  // Performance optimization: Compute visibleSnSet only when items are actually selected (zero overhead during normal search/sort)
  const visibleSnSet = useMemo(() => {
    if (selectedSns.length === 0) return null;
    return new Set(visibleDevices.map((d) => d.serial));
  }, [visibleDevices, selectedSns.length]);

  useEffect(() => {
    if (selectedSns.length === 0 || !visibleSnSet) return;
    setSelectedSns((prev) => {
      const next = prev.filter((sn) => visibleSnSet.has(sn));
      return next.length === prev.length ? prev : next;
    });
  }, [visibleSnSet, selectedSns.length]);
  const selectedSet = useMemo(() => new Set(selectedSns), [selectedSns]);

  const effectiveTotalCount =
    isServerPaginated && serverPageRows !== null && batteryFilter === 'ALL' && midDeviceFilter === 'ALL'
      ? typeof serverMatchedTotal === 'number'
        ? serverMatchedTotal
        : serverTotalDevices || visibleDevices.length
      : visibleDevices.length;

  const totalPages = Math.max(1, Math.ceil(effectiveTotalCount / rowsPerPage));

  // Auto-reset page if current page exceeds total pages
  React.useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(1);
    }
  }, [totalPages, currentPage]);

  const pagedDevices = useMemo(() => {
    const start = isServerPaginated && serverPageRows !== null ? 0 : (currentPage - 1) * rowsPerPage;
    return visibleDevices.slice(start, start + rowsPerPage);
  }, [visibleDevices, currentPage, rowsPerPage, isServerPaginated, serverPageRows]);

  // (23 Nov 2026, smoothness) the first rows are drawn at once and the rest one frame later; selection uses the whole page
  const drawLimit = useDrawLimit(`${currentPage}|${rowsPerPage}`);
  const drawnDevices = useMemo(() => (drawLimit >= pagedDevices.length ? pagedDevices : pagedDevices.slice(0, drawLimit)), [pagedDevices, drawLimit]);

  const lastSelectedIdxRef = useRef<number | null>(null);

  const selectedOnPageCount = useMemo(
    () => pagedDevices.filter((d) => selectedSet.has(d.serial)).length,
    [pagedDevices, selectedSet]
  );

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

  const toggleSelectOne = (sn: string, index?: number, e?: React.MouseEvent) => {
    if (
      typeof index === 'number' &&
      e?.shiftKey &&
      lastSelectedIdxRef.current !== null &&
      lastSelectedIdxRef.current !== index
    ) {
      const start = Math.min(lastSelectedIdxRef.current, index);
      const end = Math.max(lastSelectedIdxRef.current, index);
      const rangeSns = pagedDevices.slice(start, end + 1).map((d) => d.serial);
      setSelectedSns((prev) => {
        const set = new Set(prev);
        rangeSns.forEach((s) => set.add(s));
        return Array.from(set);
      });
      lastSelectedIdxRef.current = index;
      return;
    }
    if (typeof index === 'number') {
      lastSelectedIdxRef.current = index;
    }
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


  const handleOpenBulkDelete = () => {
    if (!selectedSns.length || !isAdminLike) return;
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

    if (pendingBulkAction.type === 'DELETE' && !isAdminLike) {
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

  const actionButtons = (
    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
      {!showArchivedView && visibleDevices.length > 0 && (
        <motion.button
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.985 }}
          onClick={handleSelectTenUnits}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200/90 transition cursor-pointer shadow-2xs"
          title="Quick-select 10 serials to assign to a Branch Code"
        >
          <CheckSquare className="w-3.5 h-3.5 text-slate-600" />
          <span>Select 10 Units</span>
        </motion.button>
      )}

      {selectedSns.length > 0 && (
        <motion.button
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.985 }}
          onClick={() => setSelectedSns([])}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 transition cursor-pointer shadow-2xs"
          title="Clear all selected serials"
        >
          <X className="w-3.5 h-3.5" />
          <span>Clear ({selectedSns.length})</span>
        </motion.button>
      )}

      <motion.button
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.985 }}
        onClick={() => {
          setShowArchivedView((prev) => !prev);
          setSelectedSns([]);
        }}
        title={showArchivedView ? 'Showing the units removed from the dashboard – tap to show the active stock again' : 'Show the units removed from the dashboard'}
        data-archived={showArchivedView}
        className={`hidden ${
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
          whileTap={{ scale: 0.985 }}
          onClick={onOpenReqModal}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200/90 shadow-2xs transition cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 text-slate-600" />
          <span>Request HQ Stock</span>
        </motion.button>
      )}

      <motion.button
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.985 }}
        onClick={() => setShowExportMenu((v) => !v)}
        aria-expanded={showExportMenu}
        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200/90 transition cursor-pointer shadow-2xs"
      >
        <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
        <span>Export CSV</span>
      </motion.button>

      {isAdminLike && (onOpenBatchModal || onOpenImportModal) && (
        <motion.button
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.985 }}
          onClick={() => {
            if (onOpenBatchModal) onOpenBatchModal();
            else if (onOpenImportModal) onOpenImportModal();
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200/90 transition cursor-pointer shadow-2xs"
          title="Upload CSV formatted as the inventory table"
        >
          <Upload className="w-3.5 h-3.5 text-slate-600" />
          <span>Upload CSV</span>
        </motion.button>
      )}
    </div>
  );

  const exportMenuNode = (
    <AnimatePresence initial={false}>
      {showExportMenu && (
        <motion.div
          initial={{ y: -8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -8, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 32, mass: 0.55 }}
          className={`overflow-hidden ${
            heroControlsContainer
              ? 'rounded-xl border border-slate-200/90 bg-white shadow-2xs'
              : 'border-b border-slate-200 bg-white'
          }`}
        >
          <div className="px-4 py-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-600 mr-1">Export CSV for</span>
            <button type="button" onClick={() => { onExportCsv(); setShowExportMenu(false); }} className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#c3e0da] hover:border-[#9fd0c7] bg-[#eaf4f2] hover:bg-[#d5eae6] text-[#1d5c55] hover:text-[#144741] cursor-pointer transition">
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
  );

  const branchFilterControl = isAdminLike ? (
    <select
      value={branchFilter}
      onChange={(e) => {
        onBranchFilterChange(e.target.value);
        setCurrentPage(1);
      }}
      className="w-full px-3 py-2 rounded-xl text-xs font-normal border bg-white border-slate-200/90 text-zinc-800 focus:border-zinc-700 outline-none cursor-pointer shadow-2xs"
    >
      <option value="ALL">All Branch Codes</option>
      {branches.map((b) => (
        <option key={b.code} value={b.code}>
          Branch Code {b.code} — {b.name}
        </option>
      ))}
    </select>
  ) : (
    <div className="w-full px-3 py-2 rounded-xl text-xs font-mono font-bold border flex items-center gap-2 bg-white border-slate-200/90 text-zinc-900">
      <Building2 className="w-3.5 h-3.5" />
      <span>Scoped to Branch Code: {selectedBranch}</span>
    </div>
  );

  const filterBarNode = (
    <div className="space-y-2.5">
      {/* Row 1: Search + Dropdown Filters */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2 ${lockType ? 'lg:grid-cols-4' : 'md:grid-cols-3 lg:grid-cols-5'}`}>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              onSearchChange(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="Search Serial SN, Merchant, TID, Branch Code..."
            className="w-full pl-8 pr-2.5 py-2 rounded-xl text-xs font-semibold border bg-white border-slate-200/90 text-zinc-900 placeholder:text-slate-400 focus:border-zinc-700 outline-none transition shadow-2xs"
          />
        </div>

        {!lockType && (
          <div className="relative">
            <Filter className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <select
              value={stageFilter}
              onChange={(e) => {
                onStageFilterChange(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full pl-8 pr-2.5 py-2 rounded-xl text-xs font-normal border bg-white border-slate-200/90 text-zinc-800 focus:border-zinc-700 outline-none cursor-pointer shadow-2xs"
            >
              <option value="ALL">All Lifecycle Stages</option>
              {STAGE_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STAGE_META[s].label}
                </option>
              ))}
            </select>
          </div>
        )}

        {!lockType && (
          <select
            value={typeFilter}
            onChange={(e) => {
              onTypeFilterChange(e.target.value);
              setCurrentPage(1);
            }}
            className="px-3 py-2 rounded-xl text-xs font-normal border bg-white border-slate-200/90 text-zinc-800 focus:border-zinc-700 outline-none cursor-pointer shadow-2xs"
          >
            <option value="ALL">All Hardware Types</option>
            <option value="POS Terminal">POS Terminal (Wizar POS Q2 Pro)</option>
            <option value="Sound Box">Sound Box (QR Audio)</option>
          </select>
        )}

        <select
          value={midDeviceFilter}
          onChange={(e) => {
            setMidDeviceFilter(e.target.value as 'ALL' | 'SINGLE' | 'MULTIPLE');
            setCurrentPage(1);
          }}
          className="px-3 py-2 rounded-xl text-xs font-normal border bg-white border-slate-200/90 text-zinc-800 focus:border-zinc-700 outline-none cursor-pointer shadow-2xs"
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
          className="px-3 py-2 rounded-xl text-xs font-normal border bg-white border-slate-200/90 text-zinc-800 focus:border-zinc-700 outline-none cursor-pointer shadow-2xs"
          title="Filter by POS Terminal 24-Month Battery Lifecycle"
        >
          <option value="ALL">All Battery Cycles</option>
          <option value="EXPIRED">🔴 Expired (&ge;24M Change Required)</option>
          <option value="DUE_SOON">🟡 Due Soon (21-23M)</option>
          <option value="HEALTHY">🟢 Healthy (&lt;21M)</option>
        </select>

        {lockType && branchFilterControl}
      </div>

      {/* Row 2: Clear Filters (and Branch Filter when unlocked) on left, Action Buttons on right */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[240px]">
          {!lockType && (
            <div className="flex-1 min-w-[200px] max-w-xs">
              {branchFilterControl}
            </div>
          )}
          <ClearFiltersButton
            active={!!searchQuery || stageFilter !== 'ALL' || (!lockType && typeFilter !== 'ALL') || batteryFilter !== 'ALL' || midDeviceFilter !== 'ALL' || (isAdminLike && branchFilter !== 'ALL')}
            onClear={() => {
              onSearchChange(''); onStageFilterChange('ALL'); if (!lockType) onTypeFilterChange('ALL');
              if (isAdminLike) onBranchFilterChange('ALL');
              setBatteryFilter('ALL'); setMidDeviceFilter('ALL'); setCurrentPage(1);
            }}
          />
        </div>
        {heroControlsContainer ? actionButtons : (viewToggle && <div className="flex items-center">{viewToggle}</div>)}
      </div>
      {heroControlsContainer && exportMenuNode}
    </div>
  );

  return (
    <div className="space-y-3">
      {heroControlsContainer && createPortal(filterBarNode, heroControlsContainer)}

      {/* Executive Serial Inventory Command Card */}
      <div className="surface-card rounded-2xl overflow-hidden border border-slate-200/90 shadow-sm">
        {!heroControlsContainer && !lockType && (
          <>
            <div className="bg-slate-100 dark:bg-slate-800/90 border-b border-slate-200/90 dark:border-slate-700/80 px-4 py-2.5 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 flex items-center justify-center shrink-0 shadow-2xs">
                  <Boxes className="w-4 h-4 text-slate-700 dark:text-slate-200" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm sm:text-base font-extrabold tracking-tight text-slate-900 dark:text-white leading-tight">
                      {showArchivedView
                        ? 'Removed / Archived Serials'
                        : 'Stock Inventory & Multi-Branch Ledger'}
                    </h2>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Select multiple serials (e.g. Select 10) to batch-assign to a Branch Code or return to Admin HQ Stock
                  </p>
                </div>
              </div>
              {actionButtons}
            </div>
            {exportMenuNode}
            <div className="px-4 py-2.5 bg-slate-50/70 border-b border-slate-200/90">
              {filterBarNode}
            </div>
          </>
        )}
        {materialSummaryStrip}

      {/* GUIDED REQUISITION FULFILLMENT BANNER */}
      {fulfillingRequisition && isAdminLike && (
        <div className="p-3 bg-slate-50/60 border-b border-slate-200/90">
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl p-4 border shadow-md flex flex-col xl:flex-row xl:items-center justify-between gap-3 bg-[#002F4A] text-white border-sky-400/30"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-white shrink-0">
              <Truck className="w-5 h-5 text-sky-200" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-extrabold flex flex-wrap items-center gap-2">
                <span>Select Hardware for Requisition {fulfillingRequisition.reqId}</span>
                <span className="px-2 py-0.5 rounded text-[10px] bg-sky-400/20 text-sky-200 border border-sky-400/30 font-mono">
                  Target Branch Code {fulfillingRequisition.branchId} ({formatBranchName(fulfillingRequisition.branchName)})
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
        </div>
      )}

      {/* Clean Hardware Serial Ledger Table */}
        <div className="overflow-x-auto overflow-y-hidden">
          <table className="data-table min-w-[960px]">
            <thead className="glass-table-thead">
              <tr>
                <th className="w-12 text-center p-0">
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="w-full h-full min-h-[34px] flex items-center justify-center py-1 px-2 text-white cursor-pointer hover:bg-white/10 transition-colors focus:outline-none"
                    title={
                      allVisibleSelected
                        ? 'Unselect all serials on this page'
                        : 'Select all visible serials on this page (or Shift+Click rows for range selection)'
                    }
                    aria-label={allVisibleSelected ? 'Unselect all serials on this page' : 'Select all serials on this page'}
                    aria-pressed={allVisibleSelected}
                  >
                    <div
                      className={`w-4 h-4 rounded-[4px] border-[1.5px] flex items-center justify-center transition-colors duration-150 ${
                        allVisibleSelected
                          ? 'bg-white border-white text-[#155484] shadow-2xs'
                          : selectedOnPageCount > 0
                          ? 'bg-white/95 border-white text-[#155484] shadow-2xs'
                          : 'bg-transparent border-white/65 hover:border-white hover:bg-white/10'
                      }`}
                    >
                      {allVisibleSelected ? (
                        <Check className="w-2.5 h-2.5 text-[#155484] stroke-[3]" />
                      ) : selectedOnPageCount > 0 ? (
                        <Minus className="w-2.5 h-2.5 text-[#155484] stroke-[3]" />
                      ) : null}
                    </div>
                  </button>
                </th>
                <th className="col-no">No.</th>
                <SortTh k="stockIn" sort={invSort} onSort={invToggle}>Stock-In Date</SortTh>
                <SortTh k="serial" sort={invSort} onSort={invToggle}>Serial Number</SortTh>
                <SortTh k="type" sort={invSort} onSort={invToggle}>Device Type</SortTh>
                <SortTh k="model" sort={invSort} onSort={invToggle}>Model</SortTh>
                <SortTh k="branch" sort={invSort} onSort={invToggle}>Staff / Branch</SortTh>
                <SortTh k="stage" sort={invSort} onSort={invToggle}>Lifecycle Stage</SortTh>
                <SortTh k="merchant" sort={invSort} onSort={invToggle}>Merchant Name</SortTh>
                <SortTh k="mid" sort={invSort} onSort={invToggle}>MID</SortTh>
                <SortTh k="cycles" sort={invSort} onSort={invToggle} align="center" className="text-center">Cycles</SortTh>
                <th className="text-right col-actions">Actions</th>
              </tr>
            </thead>
            <tbody key={currentPage} className="page-glide-in">
              {pagedDevices.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center">
                    <p className="cell-main">No hardware serials match the current filters.</p>
                    <p className="cell-sub">Try clearing search terms or changing status filter.</p>
                  </td>
                </tr>
              ) : (
                drawnDevices.map((dev, index) => {
                  const isChecked = selectedSet.has(dev.serial);
                  const meta = STAGE_META[dev.stage];
                  const cycleCount = dev.redeployCount || 0;
                  const batt = getBatteryLifecycleStatus(dev, today);
                  const resolvedBranchName =
                    branchNameByCode.get(dev.branchId) ||
                    dev.branchName ||
                    `Branch ${dev.branchId}`;
                  const formattedBatterySerial = dev.batterySerial?.trim() || 'No battery serial';
                  const isSyncingThisDevice = syncingSerials?.has(dev.serial);

                  return (
                    <tr
                      key={dev.serial}
                      className={`${
                        isSyncingThisDevice ? 'optimistic-sync-active' : ''
                      } ${isChecked ? '!bg-sky-50/70' : ''}`.trim()}
                    >
                      <td
                        className="w-12 text-center p-0 cursor-pointer select-none"
                        onClick={(e) => toggleSelectOne(dev.serial, index, e)}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelectOne(dev.serial, index, e);
                          }}
                          className="w-full h-full min-h-[46px] flex items-center justify-center p-2 cursor-pointer hover:bg-slate-200/50 dark:hover:bg-slate-700/50 transition-colors focus:outline-none"
                          title={isChecked ? 'Unselect serial (or Shift+Click for range)' : 'Select serial (or Shift+Click for range)'}
                          aria-label={`${isChecked ? 'Unselect' : 'Select'} serial ${dev.serial}`}
                          aria-pressed={isChecked}
                        >
                          <div
                            className={`w-4 h-4 rounded-[4px] border-[1.5px] flex items-center justify-center transition-colors duration-150 ${
                              isChecked
                                ? 'bg-[#155484] border-[#155484] text-white shadow-2xs'
                                : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-500 hover:border-[#155484] dark:hover:border-slate-300'
                            }`}
                          >
                            {isChecked && <Check className="w-2.5 h-2.5 text-white stroke-[3]" />}
                          </div>
                        </button>
                      </td>

                      <td className="col-no">{(currentPage - 1) * rowsPerPage + index + 1}</td>

                      <td className="whitespace-nowrap">
                        <div className="cell-mono">{dev.stockInDate ? showDateTime(dev.stockInDate) : '—'}</div>
                      </td>

                      <td className="whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onSelectDevice(dev.serial)}
                          className="serial-btn font-mono"
                          title={`Open ${dev.serial}${dev.model ? ` (${dev.model})` : ''}`}
                        >
                          {dev.serial}
                        </button>
                        {dev.type === 'POS Terminal' && formattedBatterySerial !== 'No battery serial' ? (
                          <div
                            onClick={(e) => {
                              if (onChangeBattery) {
                                e.stopPropagation();
                                onChangeBattery(dev.serial);
                              }
                            }}
                            className="cell-sub flex items-center gap-1.5 hover:text-zinc-900 cursor-pointer"
                            title={`POS Terminal Battery: ${formattedBatterySerial} (${batt.monthsUsed}/24m · Click to Change Battery)`}
                          >
                            <span>{formattedBatterySerial}</span>
                            {batt.state === 'EXPIRED' && (
                              <span className="chip chip-red text-[9px] px-1.5 py-0 font-medium">Expired</span>
                            )}
                            {batt.state === 'DUE_SOON' && (
                              <span className="chip chip-amber text-[9px] px-1.5 py-0 font-medium">Due Soon</span>
                            )}
                          </div>
                        ) : dev.batterySerial ? (
                          <div className="cell-mono-sub">{dev.batterySerial}</div>
                        ) : null}
                      </td>

                      <td className="whitespace-nowrap">
                        <div className={`cell-main flex items-center gap-1.5 font-semibold ${dev.type === 'Sound Box' ? 'text-[#4F518C] dark:text-[#a2a5e0]' : dev.type === 'POS Terminal' ? 'text-[#184e77] dark:text-[#5cc8ff]' : ''}`}>
                          {dev.type === 'POS Terminal' ? (
                            <Cpu className="w-3.5 h-3.5 text-[#184e77] shrink-0" aria-hidden />
                          ) : (
                            <Volume2 className="w-3.5 h-3.5 text-[#4F518C] shrink-0" aria-hidden />
                          )}
                          <span>{dev.type}</span>
                        </div>
                      </td>

                      <td className="whitespace-nowrap">
                        <div className="cell-main">{dev.model}</div>
                      </td>

                      <td>
                        <div
                          className={`cell-main font-medium max-w-[190px] truncate ${hasKhmer(dev.installedByStaff || dev.staff) ? 'khmer' : ''}`}
                          title={dev.installedByStaff || dev.staff || '-'}
                        >
                          {dash(dev.installedByStaff || dev.staff || dev.customFields?.installedByStaff || (dev as any).custom_fields?.installedByStaff)}
                        </div>
                        <div className="cell-sub max-w-[190px] truncate">
                          Code {dev.branchId} · {formatBranchName(resolvedBranchName)}
                        </div>
                      </td>

                      <td className="whitespace-nowrap">
                        <span className={`chip ${meta.badgeClassLight}`}>
                          {meta.short}
                        </span>
                      </td>

                      <td>
                        <div
                          className={`cell-main max-w-[180px] truncate ${hasKhmer(dev.merchantName) ? 'khmer' : ''}`}
                          title={dev.merchantName || '-'}
                        >
                          {dash(dev.merchantName)}
                        </div>
                      </td>

                      <td className="whitespace-nowrap">
                        <div
                          className={`cell-mono ${!dev.mid ? 'cell-sub' : isValidMidForType(dev.mid, dev.type) ? '' : 'warn-text'}`}
                          title={dev.mid ? (isValidMidForType(dev.mid, dev.type) ? `MID: ${dev.mid}` : midRuleError(dev.mid, dev.type)) : '-'}
                        >
                          {dev.mid ? dev.mid : '—'}{dev.mid && !isValidMidForType(dev.mid, dev.type) ? ' ⚠' : ''}
                        </div>
                        {dev.mid && duplicateMidsMap.has(dev.mid.trim().toUpperCase()) && (
                          <div className="cell-sub">
                            {duplicateMidsMap.get(dev.mid.trim().toUpperCase())?.serials.length} units
                          </div>
                        )}
                      </td>

                      <td className="text-center whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onSelectDevice(dev.serial)}
                          className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-500 hover:text-[#002F4A] transition cursor-pointer"
                          title="Serial Cycle count after return from other merchant (click to view history)"
                        >
                          <History className="w-3 h-3 text-slate-400" />
                          <span>{cycleCount}</span>
                        </button>
                      </td>

                      <td className="text-right col-actions">
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          <button
                            type="button"
                            onClick={() => onSelectDevice(dev.serial)}
                            className="row-btn"
                            title="Manage hardware serial"
                          >
                            Manage
                          </button>
                          {showArchivedView && isAdminLike && onRestoreToDashboard && (
                            <button
                              type="button"
                              onClick={() => onRestoreToDashboard([dev.serial])}
                              className="row-btn !text-emerald-700 !bg-emerald-50 !border-emerald-200 hover:!bg-emerald-600 hover:!text-white"
                              title="Restore to dashboard"
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

        {/* Clean High-Throughput Pagination Footer */}
        <div
          className={`px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3 border-t text-xs ${
            isLight
              ? 'bg-slate-50 border-slate-200 text-slate-600'
              : 'bg-white/[0.02] border-white/[0.08] text-slate-400'
          }`}
        >
          <div className="flex items-center gap-2">
            <span>
              Showing{' '}
              <strong className={isLight ? 'text-zinc-900' : 'text-white'}>
                {effectiveTotalCount === 0 ? 0 : ((currentPage - 1) * rowsPerPage + 1).toLocaleString()}
              </strong>{' '}
              to{' '}
              <strong className={isLight ? 'text-zinc-900' : 'text-white'}>
                {Math.min(currentPage * rowsPerPage, effectiveTotalCount).toLocaleString()}
              </strong>{' '}
              of{' '}
              <strong className={isLight ? 'text-zinc-900' : 'text-white'}>
                {effectiveTotalCount.toLocaleString()}
              </strong>{' '}
              serials
            </span>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px]">Rows:</span>
              <select
                value={rowsPerPage}
                onChange={(e) => {
                  setRowsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className={`text-xs rounded-lg px-2 py-1 border outline-none font-normal cursor-pointer ${
                  isLight
                    ? 'bg-white border-slate-200 text-zinc-900'
                    : 'bg-slate-800 border-slate-700 text-white'
                }`}
              >
                {[25, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className={`p-1.5 rounded-lg border transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  isLight
                    ? 'bg-white border-slate-200 hover:bg-slate-100 text-zinc-800'
                    : 'bg-slate-800 border-slate-700 hover:bg-slate-700 text-white'
                }`}
                title="Previous page"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <span className="px-2.5 py-1 text-xs font-mono font-bold">
                {currentPage} / {totalPages}
              </span>

              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className={`p-1.5 rounded-lg border transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  isLight
                    ? 'bg-white border-slate-200 hover:bg-slate-100 text-zinc-800'
                    : 'bg-slate-800 border-slate-700 hover:bg-slate-700 text-white'
                }`}
                title="Next page"
                aria-label="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* MULTI-SELECTION & BULK ASSIGNMENT COMMAND BAR (Dark Charcoal matching Sidebar) */}
      <AnimatePresence>
        {selectedSns.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 28, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            transition={{ type: 'spring', damping: 32, stiffness: 480, mass: 0.6 }}
            role="region"
            aria-label="Selected units"
            className="sticky bottom-4 z-40 max-h-[45vh] overflow-y-auto rounded-2xl p-3.5 sm:p-4 border shadow-[0_16px_40px_-8px_rgba(0,34,56,0.65)] flex flex-col xl:flex-row xl:items-center justify-between gap-3 bg-gradient-to-r from-[#002238] via-[#002F4A] to-[#004e75] text-white border-white/20 ring-1 ring-white/10 transform-gpu"
          >
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white text-[#002F4A] font-mono text-xs font-bold shadow-xs shrink-0">
                <CheckSquare className="w-3.5 h-3.5 text-[#002F4A]" />
                <span>{selectedSns.length} Serial{selectedSns.length === 1 ? '' : 's'} Selected</span>
              </div>
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
                <span className="text-xs font-medium text-slate-200">
                  {isAdminLike
                    ? 'Batch assign selected units to a target Branch Code or return to Admin Stock:'
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
                    <div className="flex items-center bg-white/10 hover:bg-white/15 rounded-xl p-1 border border-white/20 transition-colors">
                      <Building2 className="w-3.5 h-3.5 text-sky-300 ml-2 shrink-0" />
                      <select
                        value={targetBulkBranch}
                        onChange={(e) => setTargetBulkBranch(e.target.value)}
                        aria-label="Target branch for bulk transfer"
                        className="bg-transparent text-white text-xs font-normal px-2 py-1.5 outline-none cursor-pointer max-w-[210px] truncate"
                      >
                        <option value="" disabled className="bg-[#002F4A] text-white">
                          Choose target branch…
                        </option>
                        {branches
                          .filter((b) => b.code !== '100')
                          .map((b) => (
                            <option
                              key={b.code}
                              value={b.code}
                              className="bg-[#002F4A] text-white"
                            >
                              Assign to Branch Code {b.code} ({b.name})
                            </option>
                          ))}
                      </select>
                      <button
                        type="button"
                        onClick={handleOpenBulkAssign}
                        disabled={!targetBulkBranch}
                        className="px-3.5 py-1.5 rounded-lg bg-white text-[#002F4A] hover:bg-slate-100 text-xs font-bold tracking-wide transition-all active:scale-[0.985] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
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
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-400/40 text-xs font-bold tracking-wide transition-all active:scale-[0.985] cursor-pointer shadow-xs"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-amber-300" />
                      <span>{isAdminLike ? 'Return to Admin Stock' : 'Request Return to Admin Stock'}</span>
                    </button>
                  )}

                  {isAdminLike && onDeletePermanently && (
                    <button
                      onClick={handleOpenBulkDelete}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-400/40 text-xs font-bold tracking-wide transition-all active:scale-[0.985] cursor-pointer shadow-xs"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-300" />
                      <span>Delete Permanently</span>
                    </button>
                  )}
                </>
              ) : !isAdminLike ? null : (
                <>
                {isAdminLike && onDeletePermanently && (
                  <button
                    onClick={handleOpenBulkDelete}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-400/40 text-xs font-bold tracking-wide transition-all active:scale-[0.985] cursor-pointer shadow-xs"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-300" />
                    <span>Delete Permanently</span>
                  </button>
                )}
                <button
                  onClick={handleOpenBulkRestore}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-100 text-[#002F4A] text-xs font-bold tracking-wide transition-all active:scale-[0.985] cursor-pointer shadow-xs"
                >
                  <ArchiveRestore className="w-3.5 h-3.5 text-[#002F4A]" />
                  <span>Restore {selectedSns.length} to Active Dashboard</span>
                </button>
                </>
              )}

              <button
                onClick={() => setSelectedSns([])}
                className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 hover:text-white border border-white/15 text-xs font-semibold tracking-wide transition-all active:scale-[0.985] cursor-pointer"
              >
                Clear
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* DOUBLE-STEP BULK ACTION CONFIRMATION & IMPACT PREVIEW MODAL */}
      <AnimatePresence>
        {pendingBulkAction && (
          <RightDrawerFrame
            onClose={() => setPendingBulkAction(null)}
            zClass="z-50"
            isLight={isLight}
            ariaLabel={pendingBulkAction.title}
          >
              {/* SIM-Style Header */}
              <div className={SIM_HEADER_CLS}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={SIM_ICON_BOX_CLS}>
                      {pendingBulkAction.type === 'ASSIGN' ? (
                        <Building2 className="w-4 h-4 text-[#5cc8ff]" />
                      ) : pendingBulkAction.type === 'RETURN_ADMIN' ? (
                        <RotateCcw className="w-4 h-4 text-[#5cc8ff]" />
                      ) : pendingBulkAction.type === 'REMOVE' || pendingBulkAction.type === 'DELETE' ? (
                        <Trash2 className="w-4 h-4 text-rose-300" />
                      ) : (
                        <ArchiveRestore className="w-4 h-4 text-[#5cc8ff]" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-base font-bold tracking-tight text-white truncate">
                        {pendingBulkAction.title}
                      </h3>
                      <p className="text-[11.5px] text-slate-300 mt-0.5 truncate">
                        Step 2 of 2: Impact Review &amp; Batch Confirmation
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPendingBulkAction(null)}
                    aria-label="Close"
                    className={SIM_CLOSE_BTN_CLS}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Stepper Progress Indicator matching SIM Card */}
              <div className={SIM_SUBHEADER_CLS}>
                <div className="flex items-center gap-1.5 text-xs">
                  <span className={simStepPillCls(false, false)}>
                    <span className={simStepNumCls(false)}>1</span>
                    <span>{pendingBulkAction.serials.length} Units Selected</span>
                  </span>
                  <ArrowRight className="w-3 h-3 text-slate-300 shrink-0" />
                  <span className={simStepPillCls(true, true)}>
                    <span className={simStepNumCls(true)}>2</span>
                    <span>Review &amp; Execute</span>
                  </span>
                </div>

                <div className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#1e5b88]" />
                  <span>Double-Step Active</span>
                </div>
              </div>

              {/* Body */}
              <div className={`${SIM_BODY_CLS} text-xs`}>
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
              <div className={SIM_FOOTER_CLS}>
                <button
                  type="button"
                  onClick={() => setPendingBulkAction(null)}
                  className={SIM_BTN_CANCEL_CLS}
                >
                  Cancel / Go Back
                </button>
                <button
                  type="button"
                  onClick={handleConfirmBulkAction}
                  className={SIM_BTN_PRIMARY_CLS}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />
                  <span>Confirm &amp; Execute ({pendingBulkAction.serials.length} Units)</span>
                </button>
              </div>
          </RightDrawerFrame>
        )}
      </AnimatePresence>
    </div>
  );
};

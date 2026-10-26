import { ClearFiltersButton } from './ClearFiltersButton';
import { usePager } from '../utils/usePager';
import { Pager } from './Pager';
import React, { useState, useMemo, useDeferredValue, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useFlip } from '../utils/useFlip';
import { useSort, SortTh } from '../utils/sort';
import {
  HistoricalMerchantRecord,
  Branch,
  UserRole,
  ThemeMode,
  Device,
} from '../types';
import { motion, AnimatePresence } from 'motion/react';
import {
  Store,
  Search,
  FileSpreadsheet,
  Building2,
  Clock,
  RotateCcw,
  Cpu,
  Volume2,
  X,
  Phone,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  UserCheck,
  Copy,
  Check,
  BatteryCharging,
  Hash,
  CreditCard,
  Wrench,
  Plus,
} from 'lucide-react';
import { csvFile } from '../utils/csv';
import { hasKhmer, isValidMid, serviceLength, statusText } from '../utils/display';
import { newRecordId } from '../utils/ids';
import { todayPP } from '../utils/time';
import { canSeeFullContact, phoneFor } from '../utils/privacy';

interface MerchantHistoryTabProps {
  records: HistoricalMerchantRecord[];
  branches: Branch[];
  role: UserRole;
  selectedBranch: string;
  theme?: ThemeMode;
  devices?: Device[];
  /** Name of the signed-in staff member, recorded as the officer who logged a return. */
  operatorLabel?: string;
  onAddRecord?: (record: HistoricalMerchantRecord) => void;
  /** Super Admin only: remove every record */
  onClearAll?: () => void;
  onReturnDeviceStock?: (
    serial: string,
    destination: 'HQ_STOCK' | 'BRANCH_RESERVE',
    branchId: string,
    reason: string
  ) => void;
  onSelectDevice?: (sn: string) => void;
  onToast?: (msg: string) => void;
}


/** Reasons that end the merchant relationship are TERMINATED; a unit handed back while the merchant stays is RETURNED. */
const TERMINATING_REASONS = [
  'Merchant Closed Business',
  'Terminated Contract — Merchant Relocated',
  'Franchise Ownership Transfer / Account Terminated',
  'Seasonal Merchant Termination',
];
const statusForReason = (reason: string): HistoricalMerchantRecord['status'] =>
  TERMINATING_REASONS.includes(reason) || /closed|terminat/i.test(reason) ? 'TERMINATED' : 'RETURNED';

const dash = (v: string | null | undefined) => (String(v || '').trim() ? String(v) : '—');

/** Whole months between two YYYY-MM-DD dates; 0 when either date is missing or the order is wrong. */
function monthsBetween(from: string, to: string): number {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from || '');
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to || '');
  if (!a || !b) return 0;
  let m = (+b[1] - +a[1]) * 12 + (+b[2] - +a[2]);
  if (+b[3] < +a[3]) m -= 1;
  return Math.max(0, m);
}

export const MerchantHistoryTab: React.FC<MerchantHistoryTabProps> = ({
  records,
  branches,
  role,
  selectedBranch,
  theme = 'light',
  devices = [],
  operatorLabel = '',
  onAddRecord,
  onClearAll,
  onReturnDeviceStock,
  onSelectDevice,
  onToast,
}) => {
  const isLight = theme === 'light';
  const showFullContact = canSeeFullContact(role);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleCopy = (text: string, fieldId: string) => {
    if (!text) return;
    navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopiedField(fieldId);
    setTimeout(() => setCopiedField(null), 2000);
    if (onToast) onToast(`Copied ${fieldId}: ${text}`);
  };
  const [searchQuery, setSearchQuery] = useState('');
  const deferredQuery = useDeferredValue(searchQuery);
  const [branchFilter, setBranchFilter] = useState(
    role === 'BRANCH' ? selectedBranch : 'ALL'
  );
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [reasonFilter, setReasonFilter] = useState<string>('ALL');
  const [selectedRecord, setSelectedRecord] =
    useState<HistoricalMerchantRecord | null>(null);
  const [isLogReturnModalOpen, setIsLogReturnModalOpen] = useState(false);

  const defaultFormBranch =
    role === 'BRANCH'
      ? selectedBranch
      : selectedBranch && selectedBranch !== 'ALL'
      ? selectedBranch
      : branches[0]?.code || '';

  // Form state for logging a historical return (every field starts empty – nothing is pre-filled with sample data)
  const [formMerchantName, setFormMerchantName] = useState('');
  const [formMid, setFormMid] = useState('');
  const [formTid, setFormTid] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formType, setFormType] = useState<'POS Terminal' | 'Sound Box'>('POS Terminal');
  const [formModel, setFormModel] = useState('');
  const [formSerial, setFormSerial] = useState('');
  const [formBatterySerial, setFormBatterySerial] = useState('');
  const [formBranchId, setFormBranchId] = useState(defaultFormBranch);
  const [formInstallDate, setFormInstallDate] = useState('');
  const [formReturnDate, setFormReturnDate] = useState(() => todayPP());
  const [formReturnDestination, setFormReturnDestination] = useState<'BRANCH_RESERVE' | 'HQ_STOCK'>('BRANCH_RESERVE');
  const [formReason, setFormReason] = useState('Merchant Closed Business');
  const [formNotes, setFormNotes] = useState('');
  const [formError, setFormError] = useState('');

  const deviceBySerial = useMemo(
    () => new Map<string, Device>(devices.map((d) => [d.serial.trim().toUpperCase(), d])),
    [devices]
  );
  const formDevice = deviceBySerial.get(formSerial.trim().toUpperCase());

  const resetForm = () => {
    setFormMerchantName('');
    setFormMid('');
    setFormTid('');
    setFormPhone('');
    setFormAddress('');
    setFormType('POS Terminal');
    setFormModel('');
    setFormSerial('');
    setFormBatterySerial('');
    setFormBranchId(defaultFormBranch);
    setFormInstallDate('');
    setFormReturnDate(todayPP());
    setFormReturnDestination('BRANCH_RESERVE');
    setFormReason('Merchant Closed Business');
    setFormNotes('');
    setFormError('');
  };

  const openLogReturn = () => {
    resetForm();
    setIsLogReturnModalOpen(true);
  };

  // Fill the form from the device list when the typed serial is a known unit (real data only).
  const fillFromDevice = () => {
    const d = formDevice;
    if (!d) return;
    setFormType(d.type);
    if (!formModel.trim()) setFormModel(d.model || '');
    if (!formBatterySerial.trim()) setFormBatterySerial(d.batterySerial || '');
    if (!formMerchantName.trim()) setFormMerchantName(d.merchantName || '');
    if (!formMid.trim()) setFormMid((d.mid || '').replace(/\D/g, '').slice(0, 15));
    if (!formTid.trim()) setFormTid(d.tid || '');
    if (!formPhone.trim()) setFormPhone(d.merchantPhone || '');
    if (!formAddress.trim()) setFormAddress(d.address || '');
    if (!formInstallDate && /^\d{4}-\d{2}-\d{2}/.test(d.deployedDate || '')) {
      setFormInstallDate(d.deployedDate.slice(0, 10));
    }
    if (role !== 'BRANCH' && d.branchId) setFormBranchId(d.branchId);
  };

  // Branch map
  const branchMap = useMemo(() => {
    const map = new Map<string, string>();
    branches.forEach((b) => map.set(b.id || b.code, b.name));
    return map;
  }, [branches]);

  // One row per return event: the same serial + MID + return date + status is the same return logged twice.
  const uniqueRecords = useMemo(() => {
    const seen = new Set<string>();
    const out: HistoricalMerchantRecord[] = [];
    for (const rec of records) {
      const key = [
        (rec.serial || '').trim().toUpperCase(),
        (rec.mid || '').trim().toUpperCase(),
        (rec.returnedDate || '').slice(0, 10),
        rec.status || '',
      ].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(rec);
    }
    return out;
  }, [records]);

  // Filtered records
  const matchedRecords = useMemo(() => {
    const q = deferredQuery.toLowerCase().trim();
    const reasonQ = reasonFilter.toLowerCase().slice(0, 15);
    return uniqueRecords.filter((rec) => {
      // Role scope
      if (role === 'BRANCH' && rec.branchId !== selectedBranch) {
        return false;
      }
      if (branchFilter !== 'ALL' && rec.branchId !== branchFilter) {
        return false;
      }
      if (typeFilter !== 'ALL' && rec.deviceType !== typeFilter) {
        return false;
      }
      if (reasonFilter !== 'ALL' && !(rec.returnReason || '').toLowerCase().includes(reasonQ)) {
        return false;
      }

      if (q) {
        const hay = [
          rec.merchantName,
          rec.mid,
          rec.tid,
          rec.serial,
          rec.batterySerial,
          // Branch staff cannot search by full phone number (it would reveal a masked number).
          showFullContact ? rec.merchantPhone : '',
          rec.returnReason,
        ]
          .map((v) => (v || '').toLowerCase())
          .join(' ');
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [uniqueRecords, role, selectedBranch, branchFilter, typeFilter, reasonFilter, deferredQuery, showFullContact]);
  const { sorted: filteredRecords, sort: histSort, toggle: histToggle } = useSort<HistoricalMerchantRecord>(matchedRecords, {
    returned: (r) => r.returnedDate, type: (r) => r.status, merchant: (r) => r.merchantName, mid: (r) => r.mid, serial: (r) => r.serial,
    branch: (r) => Number(r.branchId) || r.branchId, service: (r) => r.activeDurationMonths, reason: (r) => r.returnReason,
  });

  // Paging: back to page 1 whenever the filters or search change.
  const pg = usePager(filteredRecords.length, [deferredQuery, branchFilter, typeFilter, reasonFilter]);
  const pagedRecords = useMemo(() => filteredRecords.slice(pg.start, pg.end), [filteredRecords, pg.start, pg.end]);

  const flipRef = useRef<HTMLTableSectionElement>(null);
  useFlip(flipRef, [pagedRecords]);

  // Analytics KPIs (lifespan averages only records that have a known service length)
  const stats = useMemo(() => {
    const total = filteredRecords.length;
    let posCount = 0;
    let sbCount = 0;
    let closedCount = 0;
    let monthsSum = 0;
    let monthsN = 0;
    for (const r of filteredRecords) {
      if (r.deviceType === 'POS Terminal') posCount++;
      else if (r.deviceType === 'Sound Box') sbCount++;
      if ((r.returnReason || '').toLowerCase().includes('closed')) closedCount++;
      // (22 Oct 2026) from the two dates, never from a stored or assumed figure
      if (r.installedDate && r.returnedDate) {
        monthsSum += monthsBetween(r.installedDate.slice(0, 10), r.returnedDate.slice(0, 10));
        monthsN++;
      }
    }
    const avgDuration = monthsN > 0 ? Math.round(monthsSum / monthsN) : 0;
    return { total, posCount, sbCount, avgDuration, monthsN, closedCount };
  }, [filteredRecords]);

  // Export CSV (phone numbers masked for branch staff, the same as on screen)
  const handleExportCsv = () => {
    if (filteredRecords.length === 0) {
      if (onToast) onToast('No historical merchant records to export.');
      return;
    }
    const headers = [
      'No.',
      'Returned Date',
      'Record Type',
      'Merchant Name',
      'Merchant ID (MID)',
      'Serial Number',
      'Device Type & Model',
      'Branch / Staff',
      'In Service',
      'Return Reason',
    ];

    const rows = filteredRecords.map((r, idx) => {
      const bName = (branchMap.get(r.branchId) || r.branchName || `Branch ${r.branchId}`).replace(' Branch', '');
      const officer = r.returnedByStaff || r.handledByStaff || '-';
      const branchStaff = `${r.branchId} · ${bName} (${officer})`;
      const typeModel = `${r.deviceType}${r.model ? ' · ' + r.model : ''}`;
      const inService = r.installedDate
        ? `${serviceLength(r.installedDate, r.returnedDate)} (since ${r.installedDate})`
        : serviceLength(r.installedDate, r.returnedDate);

      return [
        String(idx + 1),
        r.returnedDate || '-',
        statusText(r.status),
        r.merchantName || '-',
        r.mid || '-',
        r.serial,
        typeModel,
        branchStaff,
        inService,
        r.returnReason || '-',
      ];
    });

    const url = URL.createObjectURL(csvFile([headers, ...rows]));
    const link = document.createElement('a');
    link.href = url;
    link.download = `Merchant_Decommission_History_${todayPP()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    if (onToast) {
      onToast(`Exported ${filteredRecords.length} historical merchant records matching table view.`);
    }
  };

  // Handle logging a new return record
  const handleLogSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formMerchantName.trim()) {
      setFormError('Please enter the merchant name.');
      return;
    }
    const cleanMid = formMid.replace(/\D/g, '').slice(0, 15);
    if (cleanMid.length !== 15) {
      setFormError('Merchant ID (MID) must be exactly 15 digits.');
      return;
    }
    const serial = formSerial.trim().toUpperCase();
    if (!serial) {
      setFormError('Please enter the terminal serial.');
      return;
    }
    if (!formReturnDate) {
      setFormError('Please enter the return date.');
      return;
    }
    if (formInstallDate && formInstallDate > formReturnDate) {
      setFormError('The installation date is after the return date.');
      return;
    }
    if (formReturnDate > todayPP()) {
      setFormError('The return date cannot be in the future.');
      return;
    }

    const newRecord: HistoricalMerchantRecord = {
      recordId: newRecordId('MREC'),
      merchantName: formMerchantName.trim(),
      merchantPhone: formPhone.trim(),
      address: formAddress.trim(),
      mid: cleanMid,
      tid: formTid.trim().toUpperCase(),
      deviceType: formType,
      model: formModel.trim() || formDevice?.model || '',
      serial: formDevice?.serial || serial,
      batterySerial: formType === 'POS Terminal' ? formBatterySerial.trim() || undefined : undefined,
      branchId: formBranchId,
      branchName: branchMap.get(formBranchId) || `Branch ${formBranchId}`,
      installedDate: formInstallDate,
      returnedDate: formReturnDate,
      activeDurationMonths: monthsBetween(formInstallDate, formReturnDate),
      returnReason: formReason,
      status: statusForReason(formReason),
      handledByStaff: operatorLabel.trim(),
      returnedByStaff: operatorLabel.trim() || undefined,
      // A return logged here is not yet settled; settlement is confirmed elsewhere.
      settlementFinalized: false,
      notes: formNotes.trim(),
    };

    if (onAddRecord) {
      onAddRecord(newRecord);
    }
    // Only a unit that exists in the device list is moved back to stock.
    if (formDevice && onReturnDeviceStock) {
      onReturnDeviceStock(
        formDevice.serial,
        formReturnDestination,
        formBranchId,
        formReason
      );
    }
    if (onToast) {
      onToast(
        formDevice
          ? `Logged return record for ${newRecord.merchantName} (${newRecord.mid})`
          : `Logged return record for ${newRecord.merchantName} (${newRecord.mid}). Serial ${serial} is not in the device list, so no stock was moved.`
      );
    }

    setIsLogReturnModalOpen(false);
    resetForm();
  };

  return (
    <div className="space-y-6">
      {/* Top Institutional Header */}
      <div className="surface-card shadow-md p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-[#003857] text-white flex items-center justify-center shadow-sm shrink-0">
            <Store className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-base sm:text-lg font-extrabold tracking-tight text-zinc-900 dark:text-white">
                Historical Merchant Records
              </h2>
              <span className="text-xs font-mono font-bold text-slate-500 dark:text-slate-400">
                · {filteredRecords.length} Terminated &amp; Returned Devices
              </span>
              <span className="text-[10px] font-mono font-extrabold px-2 py-0.5 rounded-full bg-[#eef5f9] text-[#003857] border border-[#003857]/20 dark:bg-white/10 dark:text-slate-300 dark:border-white/10">
                Archival Ledger
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Complete registry of merchants previously deployed with POS Terminals &amp; Sound Boxes that have since returned devices, closed business, or terminated service.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {onAddRecord && (
            <button
              type="button"
              onClick={openLogReturn}
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-[#003857] hover:bg-[#002a42] text-white shadow-2xs flex items-center gap-1.5 transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Log Return</span>
            </button>
          )}
          {onClearAll && records.length > 0 && (
            <button
              type="button"
              onClick={() => { if (window.confirm(`Delete all ${records.length} Merchant History record(s)?\n\nThis cannot be undone.`)) onClearAll(); }}
              className="btn-press px-3.5 py-2 rounded-xl text-xs font-bold bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 shadow-2xs flex items-center gap-1.5 cursor-pointer"
            >
              <span>Clear All History</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleExportCsv}
            className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer transition shadow-2xs"
            title="Export Merchant Decommission History Table to CSV (matching table columns)"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* 5 Analytical Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        <div className="surface-card p-4 rounded-2xl shadow-xs border border-slate-200/80">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Total Decommissioned
          </div>
          <div className="text-2xl font-black font-figure text-zinc-900 mt-1">
            {stats.total}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1">
            <RotateCcw className="w-3 h-3 text-amber-600" />
            <span>Historical returns ledger</span>
          </div>
        </div>

        <div className="surface-card p-4 rounded-2xl shadow-xs border border-slate-200/80">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            POS Terminals Returned
          </div>
          <div className="text-2xl font-black font-figure text-zinc-900 mt-1 flex items-center gap-1.5">
            <Cpu className="w-5 h-5 text-sky-600" />
            <span>{stats.posCount}</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            {stats.total > 0 ? `${Math.round((stats.posCount / stats.total) * 100)}% of returns` : 'No returns'}
          </div>
        </div>

        <div className="surface-card p-4 rounded-2xl shadow-xs border border-slate-200/80">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Sound Boxes Returned
          </div>
          <div className="text-2xl font-black font-figure text-zinc-900 mt-1 flex items-center gap-1.5">
            <Volume2 className="w-5 h-5 text-indigo-600" />
            <span>{stats.sbCount}</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            {stats.total > 0 ? `${Math.round((stats.sbCount / stats.total) * 100)}% of returns` : 'No returns'}
          </div>
        </div>

        <div className="surface-card p-4 rounded-2xl shadow-xs border border-slate-200/80">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Avg. Active Lifespan
          </div>
          <div className="text-2xl font-black font-figure text-emerald-700 mt-1">
            {stats.monthsN > 0 ? stats.avgDuration : '—'} <span className="text-sm font-bold text-slate-500">Months</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1">
            <Clock className="w-3 h-3 text-emerald-600" />
            <span>Average of {stats.monthsN} record(s) with dates</span>
          </div>
        </div>

        <div className="surface-card p-4 rounded-2xl shadow-xs border border-slate-200/80 col-span-2 sm:col-span-1">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Closed Business Ratio
          </div>
          <div className="text-2xl font-black font-figure text-rose-700 mt-1">
            {stats.total > 0
              ? `${Math.round((stats.closedCount / stats.total) * 100)}%`
              : '0%'}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            {stats.closedCount} merchant closures
          </div>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="surface-card p-4 rounded-2xl shadow-xs space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          {/* Search, with Clear filters right next to it */}
          <div className="md:col-span-5 flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={showFullContact ? 'Search historical merchant, 15D MID, hardware serial, phone...' : 'Search historical merchant, 15D MID, hardware serial...'}
              aria-label="Search historical merchant records"
              className="w-full pl-9 pr-3.5 py-2 rounded-xl text-xs font-medium border outline-none bg-slate-50 border-slate-200 text-zinc-900 focus:bg-white focus:border-zinc-700 transition"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                title="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>
            <ClearFiltersButton
              active={!!searchQuery || typeFilter !== 'ALL' || reasonFilter !== 'ALL' || branchFilter !== (role === 'BRANCH' ? selectedBranch : 'ALL')}
              onClear={() => { setSearchQuery(''); setTypeFilter('ALL'); setReasonFilter('ALL'); setBranchFilter(role === 'BRANCH' ? selectedBranch : 'ALL'); }} />
          </div>

          {/* Branch Code Filter */}
          <div className="md:col-span-3">
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              disabled={role === 'BRANCH'}
              aria-label="Branch filter"
              className="w-full px-3 py-2 rounded-xl text-xs font-bold border outline-none bg-slate-50 border-slate-200 text-zinc-800 focus:bg-white cursor-pointer disabled:opacity-60"
            >
              <option value="ALL">All Branch Codes (Nationwide)</option>
              {branches.map((b) => (
                <option key={b.code} value={b.code}>
                  Branch Code {b.code} — {b.name}
                </option>
              ))}
            </select>
          </div>

          {/* Device Type Filter */}
          <div className="md:col-span-2">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              aria-label="Device type filter"
              className="w-full px-3 py-2 rounded-xl text-xs font-bold border outline-none bg-slate-50 border-slate-200 text-zinc-800 focus:bg-white cursor-pointer"
            >
              <option value="ALL">All Devices</option>
              <option value="POS Terminal">POS Terminal</option>
              <option value="Sound Box">Sound Box</option>
            </select>
          </div>

          {/* Return Reason Filter */}
          <div className="md:col-span-2">
            <select
              value={reasonFilter}
              onChange={(e) => setReasonFilter(e.target.value)}
              aria-label="Return reason filter"
              className="w-full px-3 py-2 rounded-xl text-xs font-bold border outline-none bg-slate-50 border-slate-200 text-zinc-800 focus:bg-white cursor-pointer"
            >
              <option value="ALL">All Return Reasons</option>
              <option value="Closed">Merchant Closed</option>
              <option value="Relocated">Merchant Relocated</option>
              <option value="Upgraded">Upgraded Hardware</option>
              <option value="Voluntary">Voluntary KHQR Switch</option>
              <option value="Battery">Battery Expiry / Inactive</option>
              <option value="Seasonal">Seasonal End</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Historical Merchants Table (22 Oct 2026: one clean style, Khmer in Battambang, figures from real dates) */}
      <div className="surface-card shadow-md rounded-2xl overflow-hidden border border-slate-200/80">
        <div className="overflow-x-auto">
          <table className="data-table min-w-[900px]">
            <thead className="glass-table-thead">
              <tr>
                <th className="col-no">No.</th>
                <SortTh k="returned" sort={histSort} onSort={histToggle}>Returned Date</SortTh>
                <SortTh k="type" sort={histSort} onSort={histToggle}>Record Type</SortTh>
                <SortTh k="merchant" sort={histSort} onSort={histToggle}>Merchant Name</SortTh>
                <SortTh k="mid" sort={histSort} onSort={histToggle}>Merchant ID (MID)</SortTh>
                <SortTh k="serial" sort={histSort} onSort={histToggle}>Serial Number</SortTh>
                <SortTh k="branch" sort={histSort} onSort={histToggle}>Branch / Staff</SortTh>
                <SortTh k="service" sort={histSort} onSort={histToggle}>In Service</SortTh>
                <SortTh k="reason" sort={histSort} onSort={histToggle}>Return Reason</SortTh>
                <th className="text-right col-actions">Actions</th>
              </tr>
            </thead>
            <tbody ref={flipRef}>
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center">
                    <Store className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <p className="cell-main">No merchant history matches the search or filters.</p>
                    <p className="cell-sub">Adjust the search or filter options.</p>
                  </td>
                </tr>
              ) : (
                pagedRecords.map((rec, rowIdx) => {
                  const chip = rec.status === 'TERMINATED' ? 'chip-red' : rec.status === 'RETURNED' ? 'chip-amber' : 'chip-slate';
                  const midOk = isValidMid(rec.mid);
                  const officer = rec.returnedByStaff || rec.handledByStaff;
                  return (
                    <tr key={rec.recordId} data-flip={rec.recordId}>
                      <td className="col-no">{pg.start + rowIdx + 1}</td>
                      <td className="whitespace-nowrap">
                        <div className="cell-mono">{dash(rec.returnedDate)}</div>
                      </td>
                      <td className="whitespace-nowrap">
                        <span className={`chip ${chip}`}>{statusText(rec.status)}</span>
                      </td>
                      <td>
                        <div className={`cell-main max-w-[160px] truncate ${hasKhmer(rec.merchantName) ? 'khmer' : ''}`} title={rec.merchantName}>
                          {dash(rec.merchantName)}
                        </div>
                      </td>
                      <td className="whitespace-nowrap">
                        <div className={`cell-mono ${midOk ? '' : 'warn-text'}`} title={midOk ? 'Merchant ID' : 'This MID is not 15 digits (for example a number shortened by Excel). Please correct it.'}>
                          {dash(rec.mid)}{!midOk && rec.mid ? ' ⚠' : ''}
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => onSelectDevice?.(rec.serial)}
                          className="serial-btn"
                          title="Open this unit's history"
                        >
                          {rec.serial}
                        </button>
                        <div className="cell-sub flex items-center gap-1 max-w-[160px] truncate" title={`${rec.deviceType}${rec.model ? ' · ' + rec.model : ''}`}>
                          {rec.deviceType === 'POS Terminal' ? (
                            <Cpu className="w-3 h-3 text-sky-600 shrink-0" aria-hidden />
                          ) : (
                            <Volume2 className="w-3 h-3 text-indigo-600 shrink-0" aria-hidden />
                          )}
                          <span className="truncate">{rec.deviceType}{rec.model ? ` · ${rec.model}` : ''}</span>
                        </div>
                      </td>
                      <td>
                        <div className="cell-main max-w-[190px] truncate" title={`Code ${rec.branchId} · ${rec.branchName}`}>{rec.branchId} · {rec.branchName.replace(' Branch', '')}</div>
                        <div className={`cell-sub max-w-[190px] truncate ${hasKhmer(officer) ? 'khmer' : ''}`} title={officer}>{dash(officer)}</div>
                      </td>
                      <td className="whitespace-nowrap">
                        <div className="cell-main font-medium">{serviceLength(rec.installedDate, rec.returnedDate)}</div>
                        {rec.installedDate && <div className="cell-sub">since {rec.installedDate}</div>}
                      </td>
                      <td>
                        <div className="cell-main font-medium max-w-[170px] truncate" title={rec.returnReason}>{dash(rec.returnReason)}</div>
                      </td>
                      <td className="text-right col-actions">
                        <button type="button" onClick={() => setSelectedRecord(rec)} className="row-btn">
                          Details
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <Pager pg={pg} label="records" />
      </div>

      {/* Record Detail Modal (Portaled to document.body like Stock Inventory Manage Modal) */}
      {typeof document !== 'undefined' &&
        createPortal(
          <>
            <AnimatePresence>
              {selectedRecord && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setSelectedRecord(null)}
                    className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm"
                  />
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
              {/* Prestigious Navy Header Bar */}
              <div className="navy-header-bar rounded-t-2xl px-6 py-4.5 text-white flex items-center justify-between border-b border-white/10">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-11 h-11 rounded-2xl bg-white/15 border border-white/20 flex items-center justify-center text-white shrink-0 shadow-xs">
                    <Store className="w-5 h-5 text-white" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-bold text-white tracking-tight truncate">
                        {dash(selectedRecord.merchantName)}
                      </h3>
                      <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded-md bg-white/15 text-white border border-white/20">
                        {selectedRecord.recordId}
                      </span>
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-rose-500/30 text-rose-100 border border-rose-300/30">
                        Decommissioned
                      </span>
                    </div>
                    <p className="text-xs text-white/80 font-mono mt-1 truncate">
                      15D MID: {selectedRecord.mid} · Branch Code {selectedRecord.branchId} ({selectedRecord.branchName})
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedRecord(null)}
                  className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
                  title="Close modal"
                  aria-label="Close record details"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-6 space-y-4 text-xs overflow-y-auto custom-scrollbar flex-1">
                {/* Status banner */}
                <div
                  className={`p-4 rounded-2xl border flex items-center justify-between gap-3 ${
                    isLight
                      ? 'bg-amber-50/70 border-amber-200/90 text-amber-950'
                      : 'bg-amber-950/20 border-amber-800/40 text-amber-200'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                      <RotateCcw className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-extrabold text-sm text-slate-900 dark:text-white truncate">
                        Device Decommission &amp; Return Completed
                      </div>
                      <div className="text-xs text-amber-900/90 dark:text-amber-300/90 mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <span>
                          Active in service for{' '}
                          <strong>
                            {serviceLength(selectedRecord.installedDate, selectedRecord.returnedDate)}
                          </strong>
                        </span>
                        <span className="text-amber-400">•</span>
                        <span className="font-mono text-[11px]">
                          {dash(selectedRecord.installedDate)} &rarr; {dash(selectedRecord.returnedDate)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="px-3 py-1 rounded-full text-xs font-bold tracking-wide font-mono bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800 flex items-center gap-1.5 shadow-2xs">
                      <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />
                      <span>{dash(selectedRecord.status)}</span>
                    </span>
                  </div>
                </div>

                {/* 2-Column Info Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {/* Left Column: Merchant Profile */}
                  <div
                    className={`p-4 rounded-2xl border ${
                      isLight ? 'bg-slate-50/70 border-slate-200' : 'bg-white/5 border-white/10'
                    } space-y-3.5`}
                  >
                    <div className="flex items-center gap-2 pb-2.5 border-b border-slate-200 dark:border-white/10">
                      <div className="w-7 h-7 rounded-lg bg-[#003857]/10 dark:bg-sky-500/20 text-[#003857] dark:text-sky-300 flex items-center justify-center shrink-0">
                        <Store className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-100">
                          Merchant Profile
                        </h4>
                        <p className="text-[10px] text-slate-400">Account details &amp; store location</p>
                      </div>
                    </div>

                    {/* Merchant Name */}
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold uppercase text-slate-400">
                        Merchant Name
                      </span>
                      <div className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-1.5">
                        <Store className="w-3.5 h-3.5 text-[#003857] dark:text-sky-400 shrink-0" />
                        <span>{dash(selectedRecord.merchantName)}</span>
                      </div>
                    </div>

                    {/* MID & TID Row */}
                    <div className="grid grid-cols-2 gap-2">
                      <div
                        className={`p-2.5 rounded-xl border flex flex-col gap-1 ${
                          isLight ? 'bg-white border-slate-200/90' : 'bg-[#18191e] border-white/10'
                        }`}
                      >
                        <span className="text-[10px] font-semibold text-slate-400 uppercase flex items-center gap-1">
                          <Hash className="w-3 h-3 text-sky-500" /> MID (15D)
                        </span>
                        <div className="flex items-center justify-between gap-1">
                          <span
                            className="font-mono font-bold text-xs text-slate-800 dark:text-slate-200 truncate"
                            title={selectedRecord.mid}
                          >
                            {selectedRecord.mid}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopy(selectedRecord.mid, 'MID')}
                            title="Copy MID"
                            aria-label="Copy MID"
                            className="text-slate-400 hover:text-slate-700 dark:hover:text-white p-1 rounded hover:bg-slate-100 dark:hover:bg-white/10 transition cursor-pointer"
                          >
                            {copiedField === 'MID' ? (
                              <Check className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </div>

                      <div
                        className={`p-2.5 rounded-xl border flex flex-col gap-1 ${
                          isLight ? 'bg-white border-slate-200/90' : 'bg-[#18191e] border-white/10'
                        }`}
                      >
                        <span className="text-[10px] font-semibold text-slate-400 uppercase flex items-center gap-1">
                          <CreditCard className="w-3 h-3 text-indigo-500" /> TID
                        </span>
                        <div className="flex items-center justify-between gap-1">
                          <span
                            className="font-mono font-bold text-xs text-slate-800 dark:text-slate-200 truncate"
                            title={selectedRecord.tid || '—'}
                          >
                            {dash(selectedRecord.tid)}
                          </span>
                          {selectedRecord.tid && (
                            <button
                              type="button"
                              onClick={() => handleCopy(selectedRecord.tid, 'TID')}
                              title="Copy TID"
                              aria-label="Copy TID"
                              className="text-slate-400 hover:text-slate-700 dark:hover:text-white p-1 rounded hover:bg-slate-100 dark:hover:bg-white/10 transition cursor-pointer"
                            >
                              {copiedField === 'TID' ? (
                                <Check className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Contact Phone */}
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold uppercase text-slate-400">
                        Contact Phone
                      </span>
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
                        <Phone className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                        {selectedRecord.merchantPhone && showFullContact ? (
                          <a
                            href={`tel:${selectedRecord.merchantPhone}`}
                            className="hover:underline font-mono"
                          >
                            {phoneFor(role, selectedRecord.merchantPhone)}
                          </a>
                        ) : (
                          <span className="font-mono">{phoneFor(role, selectedRecord.merchantPhone)}</span>
                        )}
                      </div>
                    </div>

                    {/* Physical Address */}
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold uppercase text-slate-400">
                        Physical Address
                      </span>
                      <div className="flex items-start gap-1.5 text-xs text-slate-700 dark:text-slate-300">
                        <MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
                        <span className="leading-snug">{dash(selectedRecord.address)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Hardware & Servicing */}
                  <div
                    className={`p-4 rounded-2xl border ${
                      isLight ? 'bg-slate-50/70 border-slate-200' : 'bg-white/5 border-white/10'
                    } space-y-3.5`}
                  >
                    <div className="flex items-center gap-2 pb-2.5 border-b border-slate-200 dark:border-white/10">
                      <div className="w-7 h-7 rounded-lg bg-sky-500/10 dark:bg-sky-500/20 text-sky-600 dark:text-sky-300 flex items-center justify-center shrink-0">
                        <Cpu className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-100">
                          Hardware &amp; Servicing
                        </h4>
                        <p className="text-[10px] text-slate-400">Deployed unit &amp; custody log</p>
                      </div>
                    </div>

                    {/* Product Type & Model */}
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold uppercase text-slate-400">
                        Product Type &amp; Model
                      </span>
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-md bg-sky-100 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 flex items-center justify-center shrink-0">
                          {selectedRecord.deviceType === 'POS Terminal' ? (
                            <Cpu className="w-3.5 h-3.5" />
                          ) : (
                            <Volume2 className="w-3.5 h-3.5" />
                          )}
                        </div>
                        <span className="font-bold text-xs text-slate-900 dark:text-white">
                          {selectedRecord.deviceType} · {dash(selectedRecord.model)}
                        </span>
                      </div>
                    </div>

                    {/* Terminal Serial Highlight Card with Copy */}
                    <div
                      className={`p-2.5 rounded-xl border flex flex-col gap-1 ${
                        isLight ? 'bg-white border-slate-200/90' : 'bg-[#18191e] border-white/10'
                      }`}
                    >
                      <span className="text-[10px] font-semibold text-slate-400 uppercase flex items-center justify-between">
                        <span>Terminal Serial (SN)</span>
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800 font-bold">
                          Hardware Unit
                        </span>
                      </span>
                      <div className="flex items-center justify-between gap-1 mt-0.5">
                        <span className="font-mono font-bold text-xs text-zinc-900 dark:text-zinc-100 tracking-wide select-all">
                          {selectedRecord.serial}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopy(selectedRecord.serial, 'Serial')}
                          title="Copy Serial Number"
                          className="flex items-center gap-1 text-[11px] font-semibold text-sky-600 hover:text-sky-700 dark:text-sky-400 px-2 py-1 rounded-md hover:bg-sky-50 dark:hover:bg-white/10 transition cursor-pointer"
                        >
                          {copiedField === 'Serial' ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-600" />
                              <span className="text-emerald-600 font-bold">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Battery Serial & Branch Office */}
                    <div className="grid grid-cols-2 gap-2">
                      <div
                        className={`p-2.5 rounded-xl border flex flex-col gap-1 ${
                          isLight ? 'bg-white border-slate-200/90' : 'bg-[#18191e] border-white/10'
                        }`}
                      >
                        <span className="text-[10px] font-semibold text-slate-400 uppercase flex items-center gap-1">
                          <BatteryCharging className="w-3 h-3 text-amber-500" /> Battery SN
                        </span>
                        <span
                          className="font-mono font-bold text-[11px] text-slate-800 dark:text-slate-200 truncate"
                          title={selectedRecord.batterySerial || '—'}
                        >
                          {dash(selectedRecord.batterySerial)}
                        </span>
                      </div>

                      <div
                        className={`p-2.5 rounded-xl border flex flex-col gap-1 ${
                          isLight ? 'bg-white border-slate-200/90' : 'bg-[#18191e] border-white/10'
                        }`}
                      >
                        <span className="text-[10px] font-semibold text-slate-400 uppercase flex items-center gap-1">
                          <Building2 className="w-3 h-3 text-[#003857] dark:text-sky-400" /> Branch Office
                        </span>
                        <span
                          className="font-semibold text-[11px] text-slate-800 dark:text-slate-200 truncate"
                          title={`Branch Code ${selectedRecord.branchId} (${selectedRecord.branchName})`}
                        >
                          Code {selectedRecord.branchId}
                        </span>
                      </div>
                    </div>

                    {/* Field Officers Breakdown */}
                    <div
                      className={`p-2.5 rounded-xl border flex flex-col gap-1.5 ${
                        isLight ? 'bg-white border-slate-200/90' : 'bg-[#18191e] border-white/10'
                      }`}
                    >
                      <span className="text-[10px] font-semibold text-slate-400 uppercase">
                        Field Officers Custody
                      </span>

                      <div className="flex items-center justify-between gap-1 text-[11px]">
                        <span className="text-slate-500 flex items-center gap-1">
                          <UserCheck className="w-3 h-3 text-emerald-600" /> Installer:
                        </span>
                        <span
                          className="font-bold text-slate-800 dark:text-slate-200 truncate max-w-[140px]"
                          title={selectedRecord.installedByStaff || selectedRecord.handledByStaff}
                        >
                          {dash(selectedRecord.installedByStaff || selectedRecord.handledByStaff)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-1 text-[11px]">
                        <span className="text-slate-500 flex items-center gap-1">
                          <Wrench className="w-3 h-3 text-amber-500" /> Replaced by:
                        </span>
                        <div className="flex items-center gap-1">
                          <span
                            className={`font-semibold truncate max-w-[120px] ${
                              selectedRecord.replacedByStaff &&
                              selectedRecord.replacedByStaff !==
                                (selectedRecord.installedByStaff || selectedRecord.handledByStaff)
                                ? 'text-amber-800 dark:text-amber-300 font-bold'
                                : 'text-slate-700 dark:text-slate-300'
                            }`}
                            title={selectedRecord.replacedByStaff || 'None (Original unit)'}
                          >
                            {selectedRecord.replacedByStaff || (
                              <span className="text-slate-400 font-normal italic">None</span>
                            )}
                          </span>
                          {selectedRecord.replacedByStaff &&
                            selectedRecord.replacedByStaff !==
                              (selectedRecord.installedByStaff || selectedRecord.handledByStaff) && (
                              <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-700">
                                Diff
                              </span>
                            )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-1 text-[11px]">
                        <span className="text-slate-500 flex items-center gap-1">
                          <RotateCcw className="w-3 h-3 text-indigo-500" /> Returned by:
                        </span>
                        <div className="flex items-center gap-1">
                          <span
                            className={`font-semibold truncate max-w-[120px] ${
                              (selectedRecord.returnedByStaff || selectedRecord.handledByStaff) !==
                              (selectedRecord.installedByStaff || selectedRecord.handledByStaff)
                                ? 'text-indigo-800 dark:text-indigo-300 font-bold'
                                : 'text-slate-700 dark:text-slate-300'
                            }`}
                            title={
                              selectedRecord.returnedByStaff || selectedRecord.handledByStaff
                            }
                          >
                            {dash(selectedRecord.returnedByStaff || selectedRecord.handledByStaff)}
                          </span>
                          {(selectedRecord.returnedByStaff || selectedRecord.handledByStaff) !==
                            (selectedRecord.installedByStaff || selectedRecord.handledByStaff) && (
                            <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-indigo-100 text-indigo-900 border border-indigo-300 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-700">
                              Diff
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Multi-Officer Lifecycle Accountability (if differences exist) */}
                {(() => {
                  const inst = selectedRecord.installedByStaff || selectedRecord.handledByStaff;
                  const repl = selectedRecord.replacedByStaff;
                  const ret = selectedRecord.returnedByStaff || selectedRecord.handledByStaff;
                  const hasDifference = (repl && repl !== inst) || (ret && ret !== inst);

                  if (!hasDifference) return null;

                  return (
                    <div className="p-3.5 rounded-2xl border border-sky-200 bg-sky-50 dark:bg-sky-950/20 dark:border-sky-800/40 text-sky-950 dark:text-sky-200 text-xs space-y-1.5 font-medium">
                      <div className="flex items-center gap-2 font-bold text-sky-900 dark:text-sky-300 text-xs">
                        <UserCheck className="w-4 h-4 text-[#005a8c] dark:text-sky-400 shrink-0" />
                        <span>Multi-Officer Lifecycle Accountability Log</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-[11px]">
                        <div className="p-2.5 rounded-xl bg-white/80 dark:bg-white/5 border border-sky-100 dark:border-white/10 shadow-2xs">
                          <span className="text-[10px] text-slate-400 block font-semibold uppercase">
                            1. Field Installer
                          </span>
                          <strong className="text-slate-900 dark:text-white block mt-0.5">
                            {dash(inst)}
                          </strong>
                        </div>
                        <div className="p-2.5 rounded-xl bg-white/80 dark:bg-white/5 border border-sky-100 dark:border-white/10 shadow-2xs">
                          <span className="text-[10px] text-slate-400 block font-semibold uppercase">
                            2. Replacement Officer
                          </span>
                          <strong
                            className={`block mt-0.5 ${
                              repl && repl !== inst
                                ? 'text-amber-800 dark:text-amber-300 font-bold'
                                : 'text-slate-900 dark:text-white'
                            }`}
                          >
                            {repl || 'None (Original unit)'}
                          </strong>
                        </div>
                        <div className="p-2.5 rounded-xl bg-white/80 dark:bg-white/5 border border-sky-100 dark:border-white/10 shadow-2xs">
                          <span className="text-[10px] text-slate-400 block font-semibold uppercase">
                            3. Returned By
                          </span>
                          <strong
                            className={`block mt-0.5 ${
                              ret && ret !== inst
                                ? 'text-indigo-800 dark:text-indigo-300 font-bold'
                                : 'text-slate-900 dark:text-white'
                            }`}
                          >
                            {dash(ret)}
                          </strong>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Footer Handover & Close */}
                <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-white/10">
                  {selectedRecord.settlementFinalized ? (
                    <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-bold text-xs">
                      <div className="w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-950/60 flex items-center justify-center shrink-0">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <span>Settlement &amp; Inventory Handover Finalized</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-bold text-xs">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>Settlement not yet confirmed</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedRecord(null)}
                      className={`px-5 py-2.5 rounded-xl text-xs font-bold transition shadow-xs cursor-pointer ${
                        isLight
                          ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300'
                          : 'bg-white/10 hover:bg-white/15 text-white border border-white/15'
                      }`}
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Log Return Modal */}
      <AnimatePresence>
        {isLogReturnModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              className="w-full max-w-lg rounded-3xl border-0 shadow-2xl overflow-hidden my-8 bg-white text-zinc-900"
            >
              <div className="px-6 py-4.5 bg-[#003857] rounded-t-3xl border-b border-white/10 text-white flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <RotateCcw className="w-5 h-5 text-white" />
                  <h3 className="text-base font-extrabold text-white">
                    Log Merchant Device Return / Decommission
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsLogReturnModalOpen(false)}
                  aria-label="Close log return dialog"
                  title="Close"
                  className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleLogSubmit} className="p-6 space-y-3.5 text-xs">
                {formError && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-300 text-rose-700 font-bold text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{formError}</span>
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Merchant Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formMerchantName}
                    onChange={(e) => setFormMerchantName(e.target.value)}
                    placeholder="Merchant business name"
                    aria-label="Merchant name"
                    className="w-full px-3 py-2 rounded-xl text-xs font-medium border outline-none bg-slate-50 border-slate-200 text-zinc-900"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                      MID *
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={15}
                      value={formMid}
                      onChange={(e) => {
                        const clean = e.target.value.replace(/\D/g, '').slice(0, 15);
                        setFormMid(clean);
                      }}
                      placeholder="15-digit MID"
                      aria-label="MID"
                      className="w-full px-3 py-2 rounded-xl text-xs font-mono border outline-none bg-slate-50 border-slate-200 text-zinc-900"
                    />
                    <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                      {formMid.length}/15 digits
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                      Terminal ID (TID)
                    </label>
                    <input
                      type="text"
                      value={formTid}
                      onChange={(e) => setFormTid(e.target.value)}
                      placeholder="Issued TID (optional)"
                      aria-label="Terminal ID"
                      className="w-full px-3 py-2 rounded-xl text-xs font-mono border outline-none bg-slate-50 border-slate-200 text-zinc-900"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                      Device Type
                    </label>
                    <select
                      value={formType}
                      onChange={(e) => setFormType(e.target.value as 'POS Terminal' | 'Sound Box')}
                      aria-label="Device type"
                      className="w-full px-3 py-2 rounded-xl text-xs font-bold border outline-none bg-slate-50 border-slate-200 text-zinc-900"
                    >
                      <option value="POS Terminal">POS Terminal</option>
                      <option value="Sound Box">Sound Box</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                      Branch Code
                    </label>
                    <select
                      value={formBranchId}
                      onChange={(e) => setFormBranchId(e.target.value)}
                      disabled={role === 'BRANCH'}
                      aria-label="Branch code"
                      className="w-full px-3 py-2 rounded-xl text-xs font-bold border outline-none bg-slate-50 border-slate-200 text-zinc-900"
                    >
                      {branches.map((b) => (
                        <option key={b.code} value={b.code}>
                          Code {b.code} — {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                      Terminal Serial *
                    </label>
                    <input
                      type="text"
                      required
                      value={formSerial}
                      onChange={(e) => setFormSerial(e.target.value)}
                      onBlur={fillFromDevice}
                      list="history-device-serials"
                      placeholder="Unit serial number"
                      aria-label="Terminal serial"
                      className="w-full px-3 py-2 rounded-xl text-xs font-mono border outline-none bg-slate-50 border-slate-200 text-zinc-900"
                    />
                    <div className={`text-[10px] mt-0.5 ${formSerial.trim() && !formDevice ? 'text-amber-600' : 'text-slate-400'}`}>
                      {!formSerial.trim()
                        ? 'Pick a serial from the device list to fill in its details.'
                        : formDevice
                        ? `In device list: ${formDevice.model} (Code ${formDevice.branchId})`
                        : 'Not in device list — the record is saved, but no stock is moved.'}
                    </div>
                    <datalist id="history-device-serials">
                      {devices
                        .filter((d) => role !== 'BRANCH' || d.branchId === selectedBranch)
                        .map((d) => (
                          <option key={d.serial} value={d.serial}>
                            {d.model} • Code {d.branchId}
                          </option>
                        ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                      Model
                    </label>
                    <input
                      type="text"
                      value={formModel}
                      onChange={(e) => setFormModel(e.target.value)}
                      placeholder="Device model"
                      aria-label="Device model"
                      className="w-full px-3 py-2 rounded-xl text-xs border outline-none bg-slate-50 border-slate-200 text-zinc-900"
                    />
                  </div>
                  {formType === 'POS Terminal' && (
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                        Battery Serial Number
                      </label>
                      <input
                        type="text"
                        value={formBatterySerial}
                        onChange={(e) => setFormBatterySerial(e.target.value)}
                        placeholder="Battery serial (if known)"
                        aria-label="Battery serial"
                        className="w-full px-3 py-2 rounded-xl text-xs font-mono border outline-none bg-slate-50 border-slate-200 text-zinc-900"
                      />
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                      Installation Date
                    </label>
                    <input
                      type="date"
                      value={formInstallDate}
                      max={formReturnDate || todayPP()}
                      onChange={(e) => setFormInstallDate(e.target.value)}
                      aria-label="Installation date"
                      className="w-full px-3 py-2 rounded-xl text-xs font-mono border outline-none bg-slate-50 border-slate-200 text-zinc-900"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                      Return / Decommission Date
                    </label>
                    <input
                      type="date"
                      value={formReturnDate}
                      max={todayPP()}
                      required
                      onChange={(e) => setFormReturnDate(e.target.value)}
                      aria-label="Return date"
                      className="w-full px-3 py-2 rounded-xl text-xs font-mono border outline-none bg-slate-50 border-slate-200 text-zinc-900"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Return / Termination Reason
                  </label>
                  <select
                    value={formReason}
                    onChange={(e) => setFormReason(e.target.value)}
                    aria-label="Return reason"
                    className="w-full px-3 py-2 rounded-xl text-xs font-semibold border outline-none bg-slate-50 border-slate-200 text-zinc-900"
                  >
                    <option value="Merchant Closed Business">Merchant Closed Business</option>
                    <option value="Terminated Contract — Merchant Relocated">Terminated Contract — Merchant Relocated</option>
                    <option value="Upgraded from Sound Box to POS Terminal">Upgraded from Sound Box to POS Terminal</option>
                    <option value="Voluntary Return — Switch to Online KHQR Only">Voluntary Return — Switch to Online KHQR Only</option>
                    <option value="Degraded Battery (≥24M) & Merchant Inactivity">Degraded Battery (≥24M) &amp; Merchant Inactivity</option>
                    <option value="Franchise Ownership Transfer / Account Terminated">Franchise Ownership Transfer / Account Terminated</option>
                    <option value="Seasonal Merchant Termination">Seasonal Merchant Termination</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1.5">
                    Physical Hardware Return Destination *
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFormReturnDestination('BRANCH_RESERVE')}
                      className={`px-3 py-2 rounded-xl text-xs font-semibold border flex items-center justify-center gap-1.5 transition cursor-pointer ${
                        formReturnDestination === 'BRANCH_RESERVE'
                          ? 'bg-[#004953] text-white border-emerald-500/30 shadow-xs'
                          : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
                      }`}
                    >
                      <Building2 className="w-3.5 h-3.5" />
                      <span>Branch Reserve (Code {formBranchId})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormReturnDestination('HQ_STOCK')}
                      className={`px-3 py-2 rounded-xl text-xs font-semibold border flex items-center justify-center gap-1.5 transition cursor-pointer ${
                        formReturnDestination === 'HQ_STOCK'
                          ? 'bg-[#004953] text-white border-emerald-500/30 shadow-xs'
                          : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
                      }`}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Admin HQ Stock (Code 100)</span>
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">
                    Recorded as <strong>{statusForReason(formReason)}</strong>. Device will be cleared from active merchant and returned to {formReturnDestination === 'HQ_STOCK' ? 'HQ Central Warehouse (Branch 100)' : `Branch ${formBranchId} Reserve`}.
                  </p>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Notes / Inspection Remarks
                  </label>
                  <textarea
                    rows={2}
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    aria-label="Notes"
                    placeholder="Condition of hardware, accessories returned, power adaptor, clearance notes..."
                    className="w-full px-3 py-2 rounded-xl text-xs border outline-none bg-slate-50 border-slate-200 text-zinc-900"
                  />
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsLogReturnModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-xl text-xs font-extrabold bg-[#003857] hover:bg-[#002a42] text-white shadow-sm cursor-pointer transition"
                  >
                    Save Return Record
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
            </AnimatePresence>
          </>,
          document.body
        )}
    </div>
  );
};

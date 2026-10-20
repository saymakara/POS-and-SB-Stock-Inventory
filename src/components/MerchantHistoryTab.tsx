import React, { useState, useMemo } from 'react';
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
  Filter,
  FileDown,
  Building2,
  Calendar,
  Clock,
  RotateCcw,
  ShieldCheck,
  Cpu,
  Volume2,
  FileText,
  X,
  Phone,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  UserCheck,
  Copy,
  Check,
  BatteryCharging,
  Hash,
  CreditCard,
  Wrench,
} from 'lucide-react';
import { escapeCsvCell } from '../utils/crmUtils';

interface MerchantHistoryTabProps {
  records: HistoricalMerchantRecord[];
  branches: Branch[];
  role: UserRole;
  selectedBranch: string;
  theme?: ThemeMode;
  devices?: Device[];
  onAddRecord?: (record: HistoricalMerchantRecord) => void;
  onReturnDeviceStock?: (
    serial: string,
    destination: 'HQ_STOCK' | 'BRANCH_RESERVE',
    branchId: string,
    reason: string
  ) => void;
  onSelectDevice?: (sn: string) => void;
  onToast?: (msg: string) => void;
}

const COMMON_REASONS = [
  'ALL',
  'Merchant Closed Business',
  'Terminated Contract — Merchant Relocated',
  'Upgraded from Sound Box to POS Terminal',
  'Voluntary Return — Switch to Online KHQR Only',
  'Degraded Battery (≥24M) & Inactivity',
  'Franchise Ownership Transfer',
  'Seasonal Merchant Termination',
];

export const MerchantHistoryTab: React.FC<MerchantHistoryTabProps> = ({
  records,
  branches,
  role,
  selectedBranch,
  theme = 'light',
  devices = [],
  onAddRecord,
  onReturnDeviceStock,
  onSelectDevice,
  onToast,
}) => {
  const isLight = theme === 'light';
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleCopy = (text: string, fieldId: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedField(fieldId);
    setTimeout(() => setCopiedField(null), 2000);
    if (onToast) onToast(`Copied ${fieldId}: ${text}`);
  };
  const [searchQuery, setSearchQuery] = useState('');
  const [branchFilter, setBranchFilter] = useState(
    role === 'BRANCH' ? selectedBranch : 'ALL'
  );
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [reasonFilter, setReasonFilter] = useState<string>('ALL');
  const [selectedRecord, setSelectedRecord] =
    useState<HistoricalMerchantRecord | null>(null);
  const [isLogReturnModalOpen, setIsLogReturnModalOpen] = useState(false);

  // Form state for logging a historical return
  const [formMerchantName, setFormMerchantName] = useState('');
  const [formMid, setFormMid] = useState('');
  const [formTid, setFormTid] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formType, setFormType] = useState<'POS Terminal' | 'Sound Box'>('POS Terminal');
  const [formModel, setFormModel] = useState('Wizar POS Q2 Pro');
  const [formSerial, setFormSerial] = useState('WP5400PQ23200297');
  const [formBatterySerial, setFormBatterySerial] = useState('160525A0005709');
  const [formBranchId, setFormBranchId] = useState(
    role === 'BRANCH' ? selectedBranch : '101'
  );
  const [formInstallDate, setFormInstallDate] = useState('2024-05-10');
  const [formReturnDate, setFormReturnDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [formReturnDestination, setFormReturnDestination] = useState<'BRANCH_RESERVE' | 'HQ_STOCK'>('BRANCH_RESERVE');
  const [formReason, setFormReason] = useState('Merchant Closed Business');
  const [formNotes, setFormNotes] = useState('');
  const [formError, setFormError] = useState('');

  const isAdminLike = role === 'SUPER_ADMIN' || role === 'ADMIN';

  // Branch map
  const branchMap = useMemo(() => {
    const map = new Map<string, string>();
    branches.forEach((b) => map.set(b.id || b.code, b.name));
    return map;
  }, [branches]);

  // Filtered records
  const filteredRecords = useMemo(() => {
    return records.filter((rec) => {
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
      if (reasonFilter !== 'ALL') {
        if (!rec.returnReason.toLowerCase().includes(reasonFilter.toLowerCase().slice(0, 15))) {
          return false;
        }
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = rec.merchantName.toLowerCase().includes(q);
        const matchMid = rec.mid.toLowerCase().includes(q);
        const matchTid = (rec.tid || '').toLowerCase().includes(q);
        const matchSerial = rec.serial.toLowerCase().includes(q);
        const matchBat = (rec.batterySerial || '').toLowerCase().includes(q);
        const matchPhone = (rec.merchantPhone || '').toLowerCase().includes(q);
        const matchReason = rec.returnReason.toLowerCase().includes(q);
        if (
          !matchName &&
          !matchMid &&
          !matchTid &&
          !matchSerial &&
          !matchBat &&
          !matchPhone &&
          !matchReason
        ) {
          return false;
        }
      }

      return true;
    });
  }, [records, role, selectedBranch, branchFilter, typeFilter, reasonFilter, searchQuery]);

  // Analytics KPIs
  const stats = useMemo(() => {
    const total = filteredRecords.length;
    const posCount = filteredRecords.filter((r) => r.deviceType === 'POS Terminal').length;
    const sbCount = filteredRecords.filter((r) => r.deviceType === 'Sound Box').length;
    const avgDuration =
      total > 0
        ? Math.round(
            filteredRecords.reduce((acc, r) => acc + (r.activeDurationMonths || 24), 0) /
              total
          )
        : 0;
    const closedCount = filteredRecords.filter((r) =>
      r.returnReason.toLowerCase().includes('closed')
    ).length;

    return { total, posCount, sbCount, avgDuration, closedCount };
  }, [filteredRecords]);

  // Export CSV
  const handleExportCsv = () => {
    if (filteredRecords.length === 0) {
      if (onToast) onToast('No historical merchant records to export.');
      return;
    }
    const headers = [
      'Record ID',
      'Merchant Name',
      'MID',
      'TID',
      'Contact Phone',
      'Address',
      'Device Type',
      'Model',
      'Terminal Serial',
      'Battery Serial',
      'Branch Code',
      'Branch Name',
      'Installation Date',
      'Decommission / Return Date',
      'Active Months in Service',
      'Return / Termination Reason',
      'Status',
      'Installed By Officer',
      'Replaced By Officer',
      'Returned By Officer',
      'Officer in Charge',
      'Settlement Finalized',
      'Audit Notes',
    ];

    const rows = filteredRecords.map((r) => [
      r.recordId,
      r.merchantName,
      r.mid,
      r.tid,
      r.merchantPhone,
      r.address,
      r.deviceType,
      r.model,
      r.serial,
      r.batterySerial || '',
      r.branchId,
      branchMap.get(r.branchId) || r.branchName,
      r.installedDate,
      r.returnedDate,
      r.activeDurationMonths,
      r.returnReason,
      r.status,
      r.installedByStaff || r.handledByStaff,
      r.replacedByStaff || '',
      r.returnedByStaff || r.handledByStaff,
      r.handledByStaff,
      r.settlementFinalized ? 'Yes' : 'No',
      r.notes || '',
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' +
      [headers, ...rows]
        .map((row) => row.map(escapeCsvCell).join(','))
        .join('\r\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute(
      'download',
      `Merchant_Decommission_History_${new Date().toISOString().split('T')[0]}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    if (onToast) {
      onToast(`Exported ${filteredRecords.length} historical merchant records.`);
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

    const inst = new Date(formInstallDate);
    const ret = new Date(formReturnDate);
    const diffMonths = Math.max(
      1,
      (ret.getFullYear() - inst.getFullYear()) * 12 +
        (ret.getMonth() - inst.getMonth())
    );

    const newRecord: HistoricalMerchantRecord = {
      recordId: `MREC-${Date.now().toString().slice(-6)}`,
      merchantName: formMerchantName.trim(),
      merchantPhone: formPhone.trim() || '012 000 000',
      address: formAddress.trim() || 'Phnom Penh, Cambodia',
      mid: cleanMid,
      tid: formTid.trim() || `TID-${formBranchId}01`,
      deviceType: formType,
      model: formModel,
      serial: formSerial.trim(),
      batterySerial: formType === 'POS Terminal' ? formBatterySerial.trim() : undefined,
      branchId: formBranchId,
      branchName: branchMap.get(formBranchId) || `Branch ${formBranchId}`,
      installedDate: formInstallDate,
      returnedDate: formReturnDate,
      activeDurationMonths: diffMonths,
      returnReason: formReason,
      status: 'RETURNED',
      handledByStaff: 'Field Operations Officer',
      settlementFinalized: true,
      notes: formNotes.trim() || 'Logged via Historical Merchant Record Ledger.',
    };

    if (onAddRecord) {
      onAddRecord(newRecord);
    }
    if (formSerial.trim() && onReturnDeviceStock) {
      onReturnDeviceStock(
        formSerial.trim(),
        formReturnDestination,
        formBranchId,
        formReason
      );
    }
    if (onToast) {
      onToast(`Logged return record for ${newRecord.merchantName} (${newRecord.mid})`);
    }

    setIsLogReturnModalOpen(false);
    // Reset form
    setFormMerchantName('');
    setFormMid('');
    setFormPhone('');
    setFormAddress('');
    setFormNotes('');
    setFormError('');
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
          <button
            type="button"
            onClick={handleExportCsv}
            className="px-3.5 py-2 rounded-xl text-xs font-bold bg-white hover:bg-slate-50 text-zinc-800 border border-slate-200 shadow-2xs flex items-center gap-1.5 transition cursor-pointer"
          >
            <FileDown className="w-4 h-4 text-zinc-700" />
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
          <div className="text-2xl font-black font-mono text-zinc-900 mt-1">
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
          <div className="text-2xl font-black font-mono text-zinc-900 mt-1 flex items-center gap-1.5">
            <Cpu className="w-5 h-5 text-sky-600" />
            <span>{stats.posCount}</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            With 24M battery telemetry
          </div>
        </div>

        <div className="surface-card p-4 rounded-2xl shadow-xs border border-slate-200/80">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Sound Boxes Returned
          </div>
          <div className="text-2xl font-black font-mono text-zinc-900 mt-1 flex items-center gap-1.5">
            <Volume2 className="w-5 h-5 text-indigo-600" />
            <span>{stats.sbCount}</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            Returned or upgraded units
          </div>
        </div>

        <div className="surface-card p-4 rounded-2xl shadow-xs border border-slate-200/80">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Avg. Active Lifespan
          </div>
          <div className="text-2xl font-black font-mono text-emerald-700 mt-1">
            {stats.avgDuration} <span className="text-sm font-bold text-slate-500">Months</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1">
            <Clock className="w-3 h-3 text-emerald-600" />
            <span>Pre-termination average</span>
          </div>
        </div>

        <div className="surface-card p-4 rounded-2xl shadow-xs border border-slate-200/80 col-span-2 sm:col-span-1">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Closed Business Ratio
          </div>
          <div className="text-2xl font-black font-mono text-rose-700 mt-1">
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
          {/* Search */}
          <div className="md:col-span-5 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search historical merchant, 15D MID, hardware serial, phone..."
              className="w-full pl-9 pr-3.5 py-2 rounded-xl text-xs font-medium border outline-none bg-slate-50 border-slate-200 text-zinc-900 focus:bg-white focus:border-zinc-700 transition"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          {/* Branch Code Filter */}
          <div className="md:col-span-3">
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              disabled={role === 'BRANCH'}
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

      {/* Main Historical Merchants Table */}
      <div className="surface-card shadow-md rounded-2xl overflow-hidden border border-slate-200/80">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="glass-table-thead text-[11px] font-extrabold uppercase tracking-wider text-white">
              <tr>
                <th className="py-2.5 px-3">Decommission Date</th>
                <th className="py-2.5 px-3">Merchant Name</th>
                <th className="py-2.5 px-3">MID</th>
                <th className="py-2.5 px-3">TERMINAL SERIAL</th>
                <th className="py-2.5 px-3">Product Type</th>
                <th className="py-2.5 px-3">Branch Code</th>
                <th className="py-2.5 px-3 text-center">Service Lifespan</th>
                <th className="py-2.5 px-3">Termination Reason</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/80 text-xs bg-white">
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <Store className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <p className="font-semibold">No historical merchant records match the criteria.</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Adjust your search or filter options.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredRecords.map((rec, index) => {
                  return (
                    <tr
                      key={rec.recordId}
                      className={`transition-colors hover:bg-zinc-100/70 ${
                        index % 2 === 1 ? 'bg-slate-50/50' : 'bg-white'
                      }`}
                    >
                      {/* Decommission Date & Status */}
                      <td className="py-2 px-3 whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100 text-zinc-900 border border-slate-200 font-mono text-[11px] font-bold">
                          <Calendar className="w-3 h-3 text-slate-500" />
                          <span>{rec.returnedDate}</span>
                        </div>
                        <div className="mt-1">
                          <span
                            className={`inline-block text-[9px] font-mono font-extrabold px-1.5 py-0.2 rounded border ${
                              rec.status === 'TERMINATED'
                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                : rec.status === 'RETURNED'
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : 'bg-teal-50 text-teal-800 border-teal-200'
                            }`}
                          >
                            {rec.status}
                          </span>
                        </div>
                      </td>

                      {/* Merchant Name */}
                      <td className="py-2 px-3">
                        <div className="text-zinc-900 font-bold text-xs max-w-[190px] truncate" title={rec.merchantName}>
                          {rec.merchantName}
                        </div>
                      </td>

                      {/* MID */}
                      <td className="py-2 px-3 font-mono">
                        <div className="inline-flex items-center gap-1">
                          <span
                            className="px-1.5 py-0.5 rounded border text-[11px] whitespace-nowrap text-slate-800 bg-slate-100 border-slate-200"
                            title={`Merchant ID (MID): ${rec.mid}`}
                          >
                            {rec.mid}
                          </span>
                        </div>
                        {rec.tid && (
                          <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                            {rec.tid}
                          </div>
                        )}
                      </td>

                      {/* Hardware Serial & Battery Serial directly beneath (no wording) */}
                      <td className="py-2 px-3">
                        <div
                          onClick={() => {
                            if (onSelectDevice) onSelectDevice(rec.serial);
                          }}
                          className="font-mono text-xs text-zinc-900 font-bold hover:underline cursor-pointer"
                          title="Click to view hardware serial lifecycle"
                        >
                          {rec.serial}
                        </div>
                        {rec.batterySerial && (
                          <div className="mt-0.5 font-mono text-[11px] text-slate-600">
                            {rec.batterySerial}
                          </div>
                        )}
                      </td>

                      {/* Device Type & Model */}
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1.5">
                          {rec.deviceType === 'POS Terminal' ? (
                            <Cpu className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                          ) : (
                            <Volume2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                          )}
                          <span className="text-slate-700 text-xs">
                            {rec.deviceType}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          {rec.model}
                        </div>
                      </td>

                      {/* Branch Code */}
                      <td className="py-2 px-3">
                        <div className="inline-flex items-center gap-1 font-mono text-xs text-zinc-900">
                          <Building2 className="w-3 h-3 text-slate-400" />
                          <span>Code {rec.branchId}</span>
                        </div>
                        <div className="text-[10px] text-slate-500 max-w-[130px] truncate" title={rec.branchName}>
                          {rec.branchName}
                        </div>
                      </td>

                      {/* Active Duration */}
                      <td className="py-2 px-3 text-center whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-mono">
                          <Clock className="w-3 h-3" />
                          <span>{rec.activeDurationMonths} Months</span>
                        </span>
                        <div className="text-[9px] text-slate-400 mt-0.5">
                          {rec.installedDate} to {rec.returnedDate}
                        </div>
                      </td>

                      {/* Return Reason & Staff Accountability (Returned by only, no color accents) */}
                      <td className="py-2.5 px-3">
                        <div
                          className="text-xs text-slate-800 dark:text-slate-200 font-medium max-w-[220px] truncate"
                          title={rec.returnReason}
                        >
                          {rec.returnReason}
                        </div>
                        {(rec.returnedByStaff || rec.handledByStaff) && (
                          <div className="text-[10.5px] text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1">
                            <span className="font-medium text-slate-400 dark:text-slate-500">Returned by:</span>
                            <span className="font-medium text-slate-700 dark:text-slate-300">
                              {rec.returnedByStaff || rec.handledByStaff}
                            </span>
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-2 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedRecord(rec)}
                          className="px-2.5 py-1 rounded-md bg-[#003857] hover:bg-[#002a42] text-white text-[10px] font-extrabold shadow-2xs transition cursor-pointer whitespace-nowrap"
                        >
                          View Details
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Record Detail Modal */}
      <AnimatePresence>
        {selectedRecord && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ type: 'spring', damping: 28, stiffness: 340, mass: 0.75 }}
              className={`w-full max-w-2xl rounded-2xl border-0 shadow-2xl overflow-hidden my-8 transform-gpu will-change-gpu ${
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
                        {selectedRecord.merchantName}
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
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-6 space-y-4 text-xs">
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
                          <strong>{selectedRecord.activeDurationMonths} months</strong>
                        </span>
                        <span className="text-amber-400">•</span>
                        <span className="font-mono text-[11px]">
                          {selectedRecord.installedDate} &rarr; {selectedRecord.returnedDate}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="px-3 py-1 rounded-full text-xs font-bold tracking-wide font-mono bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800 flex items-center gap-1.5 shadow-2xs">
                      <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />
                      <span>{selectedRecord.status || 'TERMINATED'}</span>
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
                        <span>{selectedRecord.merchantName}</span>
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
                            title={selectedRecord.tid || 'N/A'}
                          >
                            {selectedRecord.tid || 'N/A'}
                          </span>
                          {selectedRecord.tid && (
                            <button
                              type="button"
                              onClick={() => handleCopy(selectedRecord.tid, 'TID')}
                              title="Copy TID"
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
                        {selectedRecord.merchantPhone ? (
                          <a
                            href={`tel:${selectedRecord.merchantPhone}`}
                            className="hover:underline font-mono"
                          >
                            {selectedRecord.merchantPhone}
                          </a>
                        ) : (
                          <span className="text-slate-400 italic">None provided</span>
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
                        <span className="leading-snug">{selectedRecord.address || 'N/A'}</span>
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
                          {selectedRecord.deviceType} · {selectedRecord.model}
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
                          title={selectedRecord.batterySerial || 'Integrated'}
                        >
                          {selectedRecord.batterySerial || 'Integrated'}
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
                          {selectedRecord.installedByStaff || selectedRecord.handledByStaff}
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
                            {selectedRecord.returnedByStaff || selectedRecord.handledByStaff}
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
                            {inst}
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
                            {ret}
                          </strong>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Return Reason & Clearance */}
                <div
                  className={`p-4 rounded-2xl border ${
                    isLight ? 'bg-slate-50/70 border-slate-200' : 'bg-white/5 border-white/10'
                  } space-y-2`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                      <FileText className="w-4 h-4 text-slate-500" />
                      <span>Return / Decommission Reason</span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-medium">
                      Physical Custody Transferred
                    </span>
                  </div>
                  <div className="font-bold text-slate-900 dark:text-white text-xs">
                    {selectedRecord.returnReason}
                  </div>
                  {selectedRecord.notes && (
                    <div
                      className={`text-xs p-3 rounded-xl border leading-relaxed ${
                        isLight
                          ? 'bg-white border-slate-200 text-slate-700'
                          : 'bg-[#18191e] border-white/10 text-slate-300'
                      }`}
                    >
                      <span className="text-[10px] font-semibold text-slate-400 block mb-0.5 uppercase">
                        Handover Memo / Return Note:
                      </span>
                      {selectedRecord.notes}
                    </div>
                  )}
                </div>

                {/* Footer Handover & Close */}
                <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-white/10">
                  <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-bold text-xs">
                    <div className="w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-950/60 flex items-center justify-center shrink-0">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <span>Settlement &amp; Inventory Handover Finalized</span>
                  </div>

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
                    placeholder="e.g. Sihanouk Blvd Minimart"
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
                      placeholder="100000880105001"
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
                      placeholder="TID-10501"
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
                      onChange={(e) => {
                        const val = e.target.value as 'POS Terminal' | 'Sound Box';
                        setFormType(val);
                        setFormModel(
                          val === 'POS Terminal'
                            ? 'Wizar POS Q2 Pro'
                            : 'Smart Sound Box SB-100'
                        );
                      }}
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
                      placeholder="WP5400PQ23200297"
                      className="w-full px-3 py-2 rounded-xl text-xs font-mono border outline-none bg-slate-50 border-slate-200 text-zinc-900"
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
                        placeholder="160525A0005709"
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
                      onChange={(e) => setFormInstallDate(e.target.value)}
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
                      onChange={(e) => setFormReturnDate(e.target.value)}
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
                    Device will be cleared from active merchant and returned to {formReturnDestination === 'HQ_STOCK' ? 'HQ Central Warehouse (Branch 100)' : `Branch ${formBranchId} Reserve`}.
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
    </div>
  );
};

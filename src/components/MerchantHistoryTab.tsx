import { ClearFiltersButton } from './ClearFiltersButton';
import { usePager } from '../utils/usePager';
import { Pager } from './Pager';
import React, { useState, useMemo, useDeferredValue } from 'react';
import { createPortal } from 'react-dom';
import { useSort, SortTh } from '../utils/sort';
import {
  HistoricalMerchantRecord,
  Branch,
  UserRole,
  ThemeMode,
  Device,
} from '../types';
import { AnimatePresence } from 'motion/react';
import {
  RightDrawerFrame,
  DossierChip,
  SIM_HEADER_CLS,
  SIM_ICON_BOX_CLS,
  SIM_CLOSE_BTN_CLS,
  SIM_BODY_CLS,
  SIM_FOOTER_CLS,
  SIM_BTN_CANCEL_CLS,
} from './RightDrawerShell';
import {
  Store,
  Calendar,
  Search,
  FileSpreadsheet,
  Clock,
  RotateCcw,
  Cpu,
  Volume2,
  X,
  Phone,
  MapPin,
} from 'lucide-react';
import { csvFile } from '../utils/csv';
import { hasKhmer, isValidMid, serviceLength, statusText } from '../utils/display';
import { CopyableRecordId } from './CopyableRecordId';
import { formatBranchName } from '../utils/format';
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
  onReturnDeviceStock?: (
    serial: string,
    destination: 'HQ_STOCK' | 'BRANCH_RESERVE',
    branchId: string,
    reason: string
  ) => void;
  onSelectDevice?: (sn: string) => void;
  onToast?: (msg: string) => void;
}


const dash = (v: string | null | undefined) => (String(v || '').trim() ? String(v) : '-');

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
  const { sorted: filteredRecords, sort: histSort, toggle: histToggle } = useSort<HistoricalMerchantRecord>(
    matchedRecords,
    {
      returned: (r) => `${r.returnedDate || ''}__${r.mid || ''}__${r.serial || ''}__${r.recordId}`,
      type: (r) => `${r.status || ''}__${r.returnedDate || ''}__${r.recordId}`,
      merchant: (r) => `${r.merchantName || ''}__${r.returnedDate || ''}__${r.recordId}`,
      mid: (r) => `${r.mid || ''}__${r.returnedDate || ''}__${r.recordId}`,
      serial: (r) => `${r.serial || ''}__${r.returnedDate || ''}__${r.recordId}`,
      branch: (r) => `${r.returnedByStaff || r.handledByStaff || ''}${r.branchId || ''}__${r.returnedDate || ''}__${r.recordId}`,
      service: (r) => r.activeDurationMonths ?? 0,
      reason: (r) => `${r.returnReason || ''}__${r.returnedDate || ''}__${r.recordId}`,
    },
    { key: 'returned', dir: 'desc' }
  );

  // Paging: back to page 1 whenever the filters, search or sort change.
  const pg = usePager(filteredRecords.length, [deferredQuery, branchFilter, typeFilter, reasonFilter, histSort]);
  const pagedRecords = useMemo(() => filteredRecords.slice(pg.start, pg.drawEnd), [filteredRecords, pg.start, pg.drawEnd]);

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
      'Merchant Name',
      'MID',
      'Serial Number',
      'Device Type & Model',
      'Staff / Branch',
      'In Service',
      'Return Reason',
      'Record Type',
    ];

    const rows = filteredRecords.map((r, idx) => {
      const bName = formatBranchName(branchMap.get(r.branchId) || r.branchName || `Branch ${r.branchId}`);
      const officer = r.returnedByStaff || r.handledByStaff || '-';
      const branchStaff = `${officer} (${r.branchId} · ${bName})`;
      const typeModel = `${r.deviceType}${r.model ? ' · ' + r.model : ''}`;
      const inService = r.installedDate
        ? `${serviceLength(r.installedDate, r.returnedDate)} (since ${r.installedDate})`
        : serviceLength(r.installedDate, r.returnedDate);

      return [
        String(idx + 1),
        r.returnedDate || '-',
        r.merchantName || '-',
        r.mid || '-',
        r.serial,
        typeModel,
        branchStaff,
        inService,
        r.returnReason || '-',
        statusText(r.status),
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

  return (
    <div className="flex flex-col gap-4">
      {/* Top Hero Banner & 5 Summary Cards (matching Merchant Deployment size & format) */}
      <section
        className={`relative overflow-hidden rounded-3xl p-6 sm:p-8 border shadow-sm ${
          isLight
            ? 'bg-slate-100 border-slate-200/90 text-slate-900'
            : 'bg-[#161a24] border-slate-800 text-slate-100'
        }`}
        aria-label="Historical Merchant Records header"
      >
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2 max-w-3xl">
            <h1 className={`text-2xl sm:text-3xl lg:text-[32px] font-extrabold tracking-tight flex items-center gap-3 ${isLight ? 'text-slate-900' : 'text-white'} leading-tight`}>
              <Store className={`w-7 h-7 sm:w-8 sm:h-8 shrink-0 ${isLight ? 'text-[#002F4A]' : 'text-sky-300'}`} aria-hidden />
              <span>Historical Merchant Records</span>
            </h1>

            <p className={`text-sm sm:text-base leading-relaxed ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
              Complete institutional registry of merchants previously deployed with POS Terminals &amp; Sound Boxes that have since returned devices or ceased operation.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleExportCsv}
              className="btn btn-secondary"
              title="Export Merchant Decommission History Table to CSV (matching table columns)"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* 5 Analytical Metric Cards (matching Merchant Deployment card format) */}
        <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5 mt-6 pt-6 border-t ${isLight ? 'border-slate-200/90' : 'border-slate-800'}`}>
          {/* Card 1: Total Decommissioned */}
          <div className={`rounded-2xl p-4 flex flex-col justify-between shadow-2xs border ${isLight ? 'bg-white border-slate-200/80' : 'bg-[#1e293b] border-slate-700/80'}`}>
            <div className="flex items-center justify-between">
              <span className={`text-xs font-semibold ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                Total Decommissioned
              </span>
              <div className="w-8 h-8 rounded-lg bg-[#002F4A]/12 text-[#002F4A] dark:text-[#7cc4ed] flex items-center justify-center shrink-0">
                <RotateCcw className="w-4 h-4" />
              </div>
            </div>
            <div className={`text-2xl sm:text-3xl font-bold font-figure tabular-nums mt-2 ${isLight ? 'text-slate-700' : 'text-white'}`}>
              {stats.total.toLocaleString()}
            </div>
            <div className="flex items-center justify-between text-xs text-slate-400 mt-2 pt-2 border-t border-slate-200/60 dark:border-slate-800/80">
              <span>Historical returns</span>
              <span className="text-[#002F4A] dark:text-[#7cc4ed] font-semibold">Archival</span>
            </div>
          </div>

          {/* Card 2: POS Terminals Returned */}
          <div className={`rounded-2xl p-4 flex flex-col justify-between shadow-2xs border ${isLight ? 'bg-white border-slate-200/80' : 'bg-[#1e293b] border-slate-700/80'}`}>
            <div className="flex items-center justify-between">
              <span className={`text-xs font-semibold ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                POS Terminals
              </span>
              <div className="w-8 h-8 rounded-lg bg-[#184e77]/12 text-[#184e77] dark:text-[#5cc8ff] flex items-center justify-center shrink-0">
                <Cpu className="w-4 h-4" />
              </div>
            </div>
            <div className={`text-2xl sm:text-3xl font-bold font-figure tabular-nums mt-2 ${isLight ? 'text-slate-700' : 'text-white'}`}>
              {stats.posCount.toLocaleString()}
            </div>
            <div className="flex items-center justify-between text-xs text-slate-400 mt-2 pt-2 border-t border-slate-200/60 dark:border-slate-800/80">
              <span>POS hardware units</span>
              <span className="text-[#184e77] dark:text-[#5cc8ff] font-semibold font-figure">
                {stats.total > 0 ? `${Math.round((stats.posCount / stats.total) * 100)}%` : '0%'}
              </span>
            </div>
          </div>

          {/* Card 3: Sound Boxes Returned */}
          <div className={`rounded-2xl p-4 flex flex-col justify-between shadow-2xs border ${isLight ? 'bg-white border-slate-200/80' : 'bg-[#1e293b] border-slate-700/80'}`}>
            <div className="flex items-center justify-between">
              <span className={`text-xs font-semibold ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                Sound Boxes
              </span>
              <div className="w-8 h-8 rounded-lg bg-[#4F518C]/12 text-[#4F518C] dark:text-[#a2a5e0] flex items-center justify-center shrink-0">
                <Volume2 className="w-4 h-4" />
              </div>
            </div>
            <div className={`text-2xl sm:text-3xl font-bold font-figure tabular-nums mt-2 ${isLight ? 'text-slate-700' : 'text-white'}`}>
              {stats.sbCount.toLocaleString()}
            </div>
            <div className="flex items-center justify-between text-xs text-slate-400 mt-2 pt-2 border-t border-slate-200/60 dark:border-slate-800/80">
              <span>Audio broadcast units</span>
              <span className="text-[#4F518C] dark:text-[#a2a5e0] font-semibold font-figure">
                {stats.total > 0 ? `${Math.round((stats.sbCount / stats.total) * 100)}%` : '0%'}
              </span>
            </div>
          </div>

          {/* Card 4: Avg. Active Lifespan */}
          <div className={`rounded-2xl p-4 flex flex-col justify-between shadow-2xs border ${isLight ? 'bg-white border-slate-200/80' : 'bg-[#1e293b] border-slate-700/80'}`}>
            <div className="flex items-center justify-between">
              <span className={`text-xs font-semibold ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                Avg. Active Lifespan
              </span>
              <div className="w-8 h-8 rounded-lg bg-emerald-500/12 text-emerald-500 flex items-center justify-center shrink-0">
                <Clock className="w-4 h-4" />
              </div>
            </div>
            <div className={`text-2xl sm:text-3xl font-bold font-figure tabular-nums mt-2 ${isLight ? 'text-slate-700' : 'text-white'}`}>
              {stats.monthsN > 0 ? stats.avgDuration : '—'}{' '}
              <span className="text-sm font-bold text-slate-400">Mos</span>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-400 mt-2 pt-2 border-t border-slate-200/60 dark:border-slate-800/80">
              <span>Average lifespan</span>
              <span className="text-emerald-500 font-semibold font-figure">{stats.monthsN} records</span>
            </div>
          </div>

          {/* Card 5: Closed Business Ratio */}
          <div className={`rounded-2xl p-4 flex flex-col justify-between shadow-2xs border col-span-2 sm:col-span-1 ${isLight ? 'bg-white border-slate-200/80' : 'bg-[#1e293b] border-slate-700/80'}`}>
            <div className="flex items-center justify-between">
              <span className={`text-xs font-semibold ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                Closure Ratio
              </span>
              <div className="w-8 h-8 rounded-lg bg-rose-500/12 text-rose-500 flex items-center justify-center shrink-0">
                <Store className="w-4 h-4" />
              </div>
            </div>
            <div className={`text-2xl sm:text-3xl font-bold font-figure tabular-nums mt-2 ${isLight ? 'text-slate-700' : 'text-white'}`}>
              {stats.total > 0
                ? `${Math.round((stats.closedCount / stats.total) * 100)}%`
                : '0%'}
            </div>
            <div className="flex items-center justify-between text-xs text-slate-400 mt-2 pt-2 border-t border-slate-200/60 dark:border-slate-800/80">
              <span>Ceased business</span>
              <span className="text-rose-500 font-semibold font-figure">{stats.closedCount} closures</span>
            </div>
          </div>
        </div>
      </section>

      {/* Filter & Search Bar (matching Merchant Deployment size & format) */}
      <div
        className={`border rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 ${
          isLight ? 'bg-white border-slate-200/80' : 'bg-[#1e293b] border-slate-700/80'
        }`}
      >
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={showFullContact ? 'Search historical merchant, 15D MID, serial, phone...' : 'Search historical merchant, 15D MID, serial...'}
            aria-label="Search historical merchant records"
            className={`w-full rounded-xl pl-8 pr-3 py-2 text-xs border focus:outline-none ${
              isLight ? 'bg-slate-50 border-slate-200 text-slate-900' : 'bg-slate-900 border-slate-700 text-white'
            }`}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              title="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>

        <select
          value={branchFilter}
          onChange={(e) => setBranchFilter(e.target.value)}
          disabled={role === 'BRANCH'}
          aria-label="Branch filter"
          className={`rounded-xl px-3 py-2 text-xs border focus:outline-none cursor-pointer disabled:opacity-60 ${
            isLight ? 'bg-slate-50 border-slate-200 text-slate-900' : 'bg-slate-900 border-slate-700 text-white'
          }`}
        >
          <option value="ALL">All Branch Codes (Nationwide)</option>
          {branches.map((b) => (
            <option key={b.code} value={b.code}>
              Branch Code {b.code} — {b.name}
            </option>
          ))}
        </select>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          aria-label="Device type filter"
          className={`rounded-xl px-3 py-2 text-xs border focus:outline-none cursor-pointer ${
            isLight ? 'bg-slate-50 border-slate-200 text-slate-900' : 'bg-slate-900 border-slate-700 text-white'
          }`}
        >
          <option value="ALL">All Devices</option>
          <option value="POS Terminal">POS Terminal</option>
          <option value="Sound Box">Sound Box</option>
        </select>

        <select
          value={reasonFilter}
          onChange={(e) => setReasonFilter(e.target.value)}
          aria-label="Return reason filter"
          className={`rounded-xl px-3 py-2 text-xs border focus:outline-none cursor-pointer ${
            isLight ? 'bg-slate-50 border-slate-200 text-slate-900' : 'bg-slate-900 border-slate-700 text-white'
          }`}
        >
          <option value="ALL">All Return Reasons</option>
          <option value="Closed">Merchant Closed</option>
          <option value="Relocated">Merchant Relocated</option>
          <option value="Upgraded">Upgraded Hardware</option>
          <option value="Voluntary">Voluntary KHQR Switch</option>
          <option value="Battery">Battery Expiry / Inactive</option>
          <option value="Seasonal">Seasonal End</option>
        </select>

        <ClearFiltersButton
          active={!!searchQuery || typeFilter !== 'ALL' || reasonFilter !== 'ALL' || branchFilter !== (role === 'BRANCH' ? selectedBranch : 'ALL')}
          onClear={() => { setSearchQuery(''); setTypeFilter('ALL'); setReasonFilter('ALL'); setBranchFilter(role === 'BRANCH' ? selectedBranch : 'ALL'); }}
        />
      </div>

      {/* Main Historical Merchants Table (22 Oct 2026: one clean style, Khmer in Battambang, figures from real dates) */}
      <div className={`border rounded-xl overflow-hidden ${isLight ? 'bg-white border-slate-200/80' : 'bg-[#1e293b] border-slate-700/80'}`}>
        <div className="overflow-x-auto overflow-y-hidden">
          <table className="data-table min-w-[900px]">
            <thead className="glass-table-thead">
              <tr>
                <th className="col-no">No.</th>
                <SortTh k="returned" sort={histSort} onSort={histToggle}>Returned Date</SortTh>
                <SortTh k="merchant" sort={histSort} onSort={histToggle}>Merchant Name</SortTh>
                <SortTh k="mid" sort={histSort} onSort={histToggle}>MID</SortTh>
                <SortTh k="serial" sort={histSort} onSort={histToggle}>Serial Number</SortTh>
                <SortTh k="branch" sort={histSort} onSort={histToggle}>Staff / Branch</SortTh>
                <SortTh k="reason" sort={histSort} onSort={histToggle}>Return Reason</SortTh>
                <SortTh k="type" sort={histSort} onSort={histToggle}>Record Type</SortTh>
                <th className="text-right col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center">
                    <Store className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <p className="cell-main">No merchant history matches the search or filters.</p>
                    <p className="cell-sub">Adjust the search or filter options.</p>
                  </td>
                </tr>
              ) : (
                pagedRecords.map((rec, rowIdx) => {
                  const chip = 'chip-amber';
                  const midOk = isValidMid(rec.mid);
                  const officer = rec.returnedByStaff || rec.handledByStaff;
                  return (
                    <tr key={rec.recordId}>
                      <td className="col-no">{pg.start + rowIdx + 1}</td>
                      <td className="whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100/80 text-slate-600 border border-slate-200/90 dark:bg-white/10 dark:text-slate-300 dark:border-white/10 font-mono text-[11px] font-normal">
                          <Calendar className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>{dash(rec.returnedDate)}</span>
                        </span>
                      </td>
                      <td>
                        <div className={`cell-main max-w-[160px] truncate ${hasKhmer(rec.merchantName) ? 'khmer' : ''}`} title={rec.merchantName}>
                          {dash(rec.merchantName)}
                        </div>
                      </td>
                      <td className="whitespace-nowrap">
                        <div className={`cell-mono ${midOk ? '' : 'warn-text'}`} title={midOk ? 'MID' : 'This MID is not 15 digits (for example a number shortened by Excel). Please correct it.'}>
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
                        <div className={`cell-sub flex items-center gap-1 max-w-[160px] truncate ${rec.deviceType === 'Sound Box' ? 'text-[#4F518C] dark:text-[#a2a5e0] font-medium' : rec.deviceType === 'POS Terminal' ? 'text-[#184e77] dark:text-[#5cc8ff] font-medium' : ''}`} title={`${rec.deviceType}${rec.model ? ' · ' + rec.model : ''}`}>
                          {rec.deviceType === 'POS Terminal' ? (
                            <Cpu className="w-3.5 h-3.5 text-[#184e77] dark:text-[#5cc8ff] shrink-0" aria-hidden />
                          ) : (
                            <Volume2 className="w-3.5 h-3.5 text-[#4F518C] dark:text-[#a2a5e0] shrink-0" aria-hidden />
                          )}
                          <span className="truncate">{rec.deviceType}{rec.model ? ` · ${rec.model}` : ''}</span>
                        </div>
                      </td>
                      <td>
                        <div className={`cell-main max-w-[190px] truncate ${hasKhmer(officer) ? 'khmer' : ''}`} title={officer}>{dash(officer)}</div>
                        <div className="cell-sub max-w-[190px] truncate" title={`Code ${rec.branchId} · ${rec.branchName}`}>{rec.branchId} · {formatBranchName(rec.branchName)}</div>
                      </td>
                      <td>
                        <div className="cell-main font-normal max-w-[170px] truncate" title={rec.returnReason}>{dash(rec.returnReason)}</div>
                      </td>
                      <td className="whitespace-nowrap">
                        <span className={`chip ${chip}`}>{statusText(rec.status) === 'Terminated' ? 'Returned' : statusText(rec.status)}</span>
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
                <RightDrawerFrame
                  onClose={() => setSelectedRecord(null)}
                  zClass="z-50"
                  isLight={isLight}
                  ariaLabel={`Merchant history ${selectedRecord.recordId}`}
                >
              {/* Header Bar */}
              <div className={SIM_HEADER_CLS}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={SIM_ICON_BOX_CLS}>
                      <Store className="w-4 h-4 text-[#5cc8ff]" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="text-base font-bold text-white tracking-tight truncate">
                          {dash(selectedRecord.merchantName)}
                        </h3>
                        <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-md bg-rose-500/30 text-rose-100 border border-rose-300/30">
                          {statusText(selectedRecord.status) === 'Terminated' ? 'Returned' : statusText(selectedRecord.status)}
                        </span>
                      </div>
                      <div className="text-[11.5px] text-sky-100/85 mt-0.5 flex flex-wrap items-center gap-1.5 font-mono">
                        <CopyableRecordId id={selectedRecord.recordId} variant="pill" onCopied={(id) => onToast?.(`Copied Record ID: ${id}`)} />
                        <span>·</span>
                        <span className="font-sans">Code {selectedRecord.branchId} ({selectedRecord.branchName})</span>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedRecord(null)}
                    className={SIM_CLOSE_BTN_CLS}
                    title="Close modal"
                    aria-label="Close record details"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className={`${SIM_BODY_CLS} text-xs`}>
                {(() => {
                  const inst = selectedRecord.installedByStaff || selectedRecord.handledByStaff;
                  const repl = selectedRecord.replacedByStaff;
                  const ret = selectedRecord.returnedByStaff || selectedRecord.handledByStaff;
                  const hasReplacement = Boolean(repl);
                  const batVal = String(selectedRecord.batterySerial || '').trim();
                  const showBattery = selectedRecord.deviceType === 'POS Terminal' || (batVal !== '' && !['N/A', '-', '—'].includes(batVal.toUpperCase()));
                  const hasPhone = Boolean(selectedRecord.merchantPhone && phoneFor(role, selectedRecord.merchantPhone) !== '—');
                  const hasAddr = Boolean(selectedRecord.address && selectedRecord.address.trim() && !['-', '—'].includes(selectedRecord.address.trim()));
                  const durationLabel = serviceLength(selectedRecord.installedDate, selectedRecord.returnedDate);

                  return (
                    <>
                      {/* Top Copyable Identifier Strip */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <DossierChip
                          label="MID 15D"
                          value={selectedRecord.mid}
                          onCopy={() => handleCopy(selectedRecord.mid, 'MID')}
                          copied={copiedField === 'MID'}
                        />
                        {selectedRecord.tid && (
                          <DossierChip
                            label="TID"
                            value={selectedRecord.tid}
                            onCopy={() => handleCopy(selectedRecord.tid || '', 'TID')}
                            copied={copiedField === 'TID'}
                          />
                        )}
                        <DossierChip
                          label="SN"
                          value={selectedRecord.serial}
                          onCopy={() => handleCopy(selectedRecord.serial, 'Serial')}
                          copied={copiedField === 'Serial'}
                        />
                        {showBattery && (
                          <DossierChip label="BAT" value={dash(selectedRecord.batterySerial)} />
                        )}
                      </div>

                      {/* Custody Timeline Card */}
                      <div
                        className={`rounded-xl border p-3.5 space-y-3 ${
                          isLight
                            ? 'bg-white border-slate-200/85 shadow-[0_1px_2px_rgba(15,23,42,0.03)]'
                            : 'bg-slate-800/95 border-slate-700/80'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${
                                selectedRecord.deviceType === 'POS Terminal'
                                  ? 'bg-[#184e77]/10 dark:bg-[#184e77]/30 text-[#184e77] dark:text-[#5cc8ff]'
                                  : 'bg-[#4F518C]/10 dark:bg-[#4F518C]/30 text-[#4F518C] dark:text-[#a2a5e0]'
                              }`}
                            >
                              {selectedRecord.deviceType === 'POS Terminal' ? (
                                <Cpu className="w-3.5 h-3.5" />
                              ) : (
                                <Volume2 className="w-3.5 h-3.5" />
                              )}
                            </span>
                            <div className="min-w-0">
                              <div className="font-bold text-xs text-slate-900 dark:text-white truncate">
                                Custody Timeline · {durationLabel}
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                {selectedRecord.deviceType} · {dash(selectedRecord.model)}
                              </div>
                            </div>
                          </div>
                          <span className="px-2.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-[10.5px] font-bold shrink-0">
                            Decommissioned
                          </span>
                        </div>

                        <div
                          className={`grid grid-cols-1 ${
                            hasReplacement ? 'sm:grid-cols-3' : 'sm:grid-cols-2'
                          } gap-3 pt-2.5 border-t border-slate-100 dark:border-slate-700/70`}
                        >
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                              <span>Active · {dash(selectedRecord.installedDate)}</span>
                            </div>
                            <div className="text-[11.5px] text-slate-600 dark:text-slate-300 mt-1">
                              Installed by{' '}
                              <strong className="text-slate-900 dark:text-white">{dash(inst)}</strong>
                            </div>
                          </div>

                          {hasReplacement && (
                            <div>
                              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                                <span>Replaced</span>
                              </div>
                              <div className="text-[11.5px] text-slate-600 dark:text-slate-300 mt-1 flex items-center gap-1.5 flex-wrap">
                                <span>
                                  By <strong className="text-slate-900 dark:text-white">{repl}</strong>
                                </span>
                                {repl !== inst && (
                                  <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-700">
                                    Diff
                                  </span>
                                )}
                              </div>
                            </div>
                          )}

                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400 flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                              <span>Returned · {dash(selectedRecord.returnedDate)}</span>
                            </div>
                            <div className="text-[11.5px] text-slate-600 dark:text-slate-300 mt-1 flex items-center gap-1.5 flex-wrap">
                              <span>
                                Returned by <strong className="text-slate-900 dark:text-white">{dash(ret)}</strong>
                              </span>
                              {ret !== inst && (
                                <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-indigo-100 text-indigo-900 border border-indigo-300 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-700">
                                  Diff
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {(hasPhone || hasAddr || selectedRecord.returnReason) && (
                          <div className="pt-2.5 border-t border-slate-100 dark:border-slate-700/70 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                            {hasPhone && (
                              <span className="inline-flex items-center gap-1 font-mono text-slate-700 dark:text-slate-200">
                                <Phone className="w-3 h-3 text-sky-600 shrink-0" />
                                {selectedRecord.merchantPhone && showFullContact ? (
                                  <a href={`tel:${selectedRecord.merchantPhone}`} className="hover:underline">
                                    {phoneFor(role, selectedRecord.merchantPhone)}
                                  </a>
                                ) : (
                                  <span>{phoneFor(role, selectedRecord.merchantPhone)}</span>
                                )}
                              </span>
                            )}
                            {hasAddr && (
                              <span className="inline-flex items-center gap-1">
                                <MapPin className="w-3 h-3 text-rose-500 shrink-0" />
                                <span>{selectedRecord.address}</span>
                              </span>
                            )}
                            {selectedRecord.returnReason && (
                              <span>
                                Reason: <strong className="text-slate-700 dark:text-slate-200 font-medium">{selectedRecord.returnReason}</strong>
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Footer Close */}
              <div className={`${SIM_FOOTER_CLS} justify-end`}>
                <button
                  type="button"
                  onClick={() => setSelectedRecord(null)}
                  className={SIM_BTN_CANCEL_CLS}
                >
                  Close
                </button>
              </div>
                </RightDrawerFrame>
              )}
            </AnimatePresence>
          </>,
          document.body
        )}
    </div>
  );
};

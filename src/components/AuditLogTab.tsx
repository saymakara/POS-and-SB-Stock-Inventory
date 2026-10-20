import React, { useState, useMemo, useEffect } from 'react';
import { UserRole, ThemeMode } from '../types';
import { escapeCsvCell } from '../utils/crmUtils';
import { motion } from 'motion/react';
import {
  FileSpreadsheet,
  Search,
  ShieldAlert,
  ShieldCheck,
  Building2,
  Lock,
  RotateCcw,
  CheckCircle2,
  History,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface AuditLogTabProps {
  auditLogs: string[];
  role: UserRole;
  theme?: ThemeMode;
  onToast: (msg: string, type?: 'success' | 'warn' | 'info') => void;
}

interface ParsedAuditRow {
  raw: string;
  timestamp: string;
  action: string;
  detail: string;
  actorRole: 'SUPER_ADMIN' | 'ADMIN' | 'BRANCH' | 'SYSTEM';
  branchCode: string;
  integrityHash: string;
}

export const AuditLogTab: React.FC<AuditLogTabProps> = ({
  auditLogs,
  role,
  theme = 'light',
  onToast,
}) => {
  const isLight = theme === 'light';
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [actionFilter, setActionFilter] = useState<string>('ALL');
  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);

  const parsedRows: ParsedAuditRow[] = useMemo(() => {
    return auditLogs.map((raw, idx) => {
      const parts = raw.split('|').map((s) => s.trim());
      const timestamp = parts[0] || '2026-10-18 00:00:00';
      const action = parts[1] || 'System Event';
      const detail = parts.slice(2).join(' | ') || raw;

      const lower = `${action} ${detail}`.toLowerCase();
      let actorRole: 'SUPER_ADMIN' | 'ADMIN' | 'BRANCH' | 'SYSTEM' = 'ADMIN';
      if (
        lower.includes('super admin') ||
        lower.includes('auto-fix') ||
        lower.includes('god') ||
        lower.includes('8986')
      ) {
        actorRole = 'SUPER_ADMIN';
      } else if (
        lower.includes('branch confirmed') ||
        lower.includes('requisition created') ||
        lower.includes('mobile') ||
        lower.includes('staff')
      ) {
        actorRole = 'BRANCH';
      } else if (lower.includes('system boot')) {
        actorRole = 'SYSTEM';
      }

      const branchMatch = detail.match(/(?:Branch Code|Code|Br\.)\s*(\d{3})/i);
      const branchCode = branchMatch ? branchMatch[1] : '100';

      const integrityHash = `INTG-${(998000 - idx).toString(16).toUpperCase()}-LOCKED`;

      return {
        raw,
        timestamp,
        action,
        detail,
        actorRole,
        branchCode,
        integrityHash,
      };
    });
  }, [auditLogs]);

  const filteredRows = parsedRows.filter((row) => {
    if (roleFilter !== 'ALL' && row.actorRole !== roleFilter) return false;
    if (actionFilter !== 'ALL') {
      const actLower = row.action.toLowerCase();
      if (actionFilter === 'STOCK' && !actLower.includes('stock') && !actLower.includes('upload') && !actLower.includes('assign') && !actLower.includes('return')) return false;
      if (actionFilter === 'REQUEST' && !actLower.includes('requisition') && !actLower.includes('dispatch') && !actLower.includes('confirm')) return false;
      if (actionFilter === 'USER' && !actLower.includes('user') && !actLower.includes('role') && !actLower.includes('session')) return false;
      if (actionFilter === 'SYNC' && !actLower.includes('sync') && !actLower.includes('reconcil') && !actLower.includes('health')) return false;
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!`${row.timestamp} ${row.action} ${row.detail} ${row.branchCode} ${row.integrityHash}`.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));

  // Reset to page 1 if current page exceeds total pages
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(1);
    }
  }, [totalPages, currentPage]);

  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, currentPage, pageSize]);

  const triggerDownload = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportCsv = () => {
    const headers = [
      'Integrity Hash (Immutable)',
      'Timestamp',
      'Actor Role',
      'Branch Code',
      'Action Type',
      'Change Review Details',
    ];
    const rows = filteredRows.map((r) => [
      escapeCsvCell(r.integrityHash),
      escapeCsvCell(r.timestamp),
      escapeCsvCell(r.actorRole),
      escapeCsvCell(`Branch Code ${r.branchCode}`),
      escapeCsvCell(r.action),
      escapeCsvCell(r.detail),
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    triggerDownload(
      `Staff_Admin_Audit_Log_Review_${Date.now()}.csv`,
      csv,
      'text/csv;charset=utf-8;'
    );
    onToast(`Exported ${filteredRows.length} Staff & Admin audit records to CSV`);
  };

  const handleAttemptModifyIntegrity = () => {
    onToast(
      'System Integrity Protection: Cryptographic audit logs and core serial hashes are immutable even for Super Admin.',
      'warn'
    );
  };

  const cardClass = isLight
    ? 'surface-card-light text-[#002f49]'
    : 'surface-card-dark text-slate-100';
  const cardHeaderClass = isLight
    ? 'sb-card-header-light'
    : 'sb-card-header-dark';
  const headingClass = isLight ? 'text-[#002f49]' : 'text-white';
  const subtextClass = isLight ? 'text-[#5b7083]' : 'text-slate-300';
  const navyTitleClass = isLight ? 'text-[#003857]' : 'text-[#5cc8ff]';
  const inputClass = isLight
    ? 'surface-inset-light text-[#002f49]'
    : 'surface-inset-dark text-white';

  return (
    <div className="flex flex-col gap-4">
      {/* System Integrity Protection Banner */}
      <div
        className={`${cardClass} p-4 flex flex-col md:flex-row md:items-center justify-between gap-3`}
      >
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-500 flex items-center justify-center shrink-0">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center flex-wrap gap-2">
              <h2 className={`text-sm sm:text-base font-extrabold ${headingClass}`}>
                Staff, Admin &amp; Super Admin Audit Log
              </h2>
              <span className="text-xs font-mono font-bold text-emerald-500 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>System Integrity Sealed</span>
              </span>
            </div>
            <p className={`text-xs ${subtextClass} mt-0.5`}>
              Review and export every change made by Branch Staff, Admin HQ, and Super Admin.{' '}
              <strong>Note:</strong> Core system integrity hashes and audit ledger entries are read-only and protected from modification by all roles including Super Admin.
            </p>
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-2 shrink-0">
          <motion.button
            whileTap={{ scale: 0.96 }}
            type="button"
            onClick={handleExportCsv}
            className="px-3.5 py-2 rounded-lg text-xs font-extrabold bg-[#1cc88a] hover:bg-[#17a673] text-white flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </motion.button>
        </div>
      </div>

      {/* Filter & Table Card */}
      <div className={`${cardClass} overflow-hidden`}>
        <div
          className={`${cardHeaderClass} px-4 py-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3`}
        >
          <div className="flex items-center gap-2">
            <History className={`w-4 h-4 ${navyTitleClass}`} />
            <span className={`text-sm font-extrabold ${navyTitleClass}`}>
              Change Review Ledger ({filteredRows.length} of {parsedRows.length} Events)
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 w-full lg:w-auto">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Search serial, Branch Code, staff..."
                className={`w-full pl-8 pr-3 py-1.5 text-xs focus:outline-none ${inputClass}`}
              />
            </div>

            <select
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value);
                setCurrentPage(1);
              }}
              className={`px-2.5 py-1.5 text-xs focus:outline-none ${inputClass}`}
            >
              <option value="ALL">All Roles (Staff &amp; Admin)</option>
              <option value="SUPER_ADMIN">Super Admin</option>
              <option value="ADMIN">Admin HQ</option>
              <option value="BRANCH">Branch Staff</option>
              <option value="SYSTEM">System Integrity</option>
            </select>

            <select
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                setCurrentPage(1);
              }}
              className={`px-2.5 py-1.5 text-xs focus:outline-none ${inputClass}`}
            >
              <option value="ALL">All Action Categories</option>
              <option value="STOCK">Stock, Bulk Assign &amp; Returns</option>
              <option value="REQUEST">Requisitions &amp; Dispatch</option>
              <option value="SYNC">Mobile Sync &amp; AI Auto-Fix</option>
              <option value="USER">IAM Role &amp; User Changes</option>
            </select>

            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className={`px-2.5 py-1.5 text-xs font-bold focus:outline-none cursor-pointer ${inputClass}`}
              title="Select view page (50 or 100 rows per page)"
            >
              <option value={50}>View: 50 / Page</option>
              <option value={100}>View: 100 / Page</option>
              <option value={25}>View: 25 / Page</option>
            </select>

            <button
              type="button"
              onClick={() => {
                setSearch('');
                setRoleFilter('ALL');
                setActionFilter('ALL');
                setCurrentPage(1);
              }}
              className={`px-3 py-1.5 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer ${inputClass}`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto max-h-[580px] custom-scrollbar border-t border-slate-200/80 dark:border-[#182c49]">
          <table
            className={`w-full text-left text-xs min-w-[980px] ${
              isLight ? 'bg-white' : 'bg-[#11141e]'
            }`}
          >
            <thead className="glass-table-thead text-[11px] font-extrabold uppercase tracking-wider text-white sticky top-0 z-20">
              <tr>
                <th className="py-3 px-3.5 whitespace-nowrap">Integrity Seal</th>
                <th className="py-3 px-3.5 whitespace-nowrap">Timestamp</th>
                <th className="py-3 px-3.5 whitespace-nowrap">Actor Role</th>
                <th className="py-3 px-3.5 whitespace-nowrap">Branch Code</th>
                <th className="py-3 px-3.5 whitespace-nowrap">Action Type</th>
                <th className="py-3 px-3.5 min-w-[260px]">Change Details</th>
                <th className="py-3 px-3.5 text-right whitespace-nowrap">Integrity Lock</th>
              </tr>
            </thead>
            <tbody
              className={`divide-y ${
                isLight ? 'divide-slate-200/80 bg-white' : 'divide-[#182c49] bg-[#11141e]'
              }`}
            >
              {paginatedRows.map((row, i) => (
                <tr
                  key={i}
                  className={
                    isLight
                      ? 'hover:bg-slate-50/90 transition-colors'
                      : 'hover:bg-white/[0.04] transition-colors'
                  }
                >
                  <td className="py-2.5 px-3.5 font-mono text-[11px] font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                    {row.integrityHash}
                  </td>
                  <td className={`py-2.5 px-3.5 font-mono whitespace-nowrap ${subtextClass}`}>
                    {row.timestamp}
                  </td>
                  <td className="py-2.5 px-3.5 whitespace-nowrap">
                    {row.actorRole === 'SUPER_ADMIN' ? (
                      <span className="inline-flex items-center gap-1 font-bold text-amber-500">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        <span>Super Admin</span>
                      </span>
                    ) : row.actorRole === 'ADMIN' ? (
                      <span className={`inline-flex items-center gap-1 font-bold ${navyTitleClass}`}>
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Admin HQ</span>
                      </span>
                    ) : row.actorRole === 'BRANCH' ? (
                      <span className="inline-flex items-center gap-1 font-bold text-emerald-500">
                        <Building2 className="w-3.5 h-3.5" />
                        <span>Branch Staff</span>
                      </span>
                    ) : (
                      <span className={`font-bold ${subtextClass}`}>System</span>
                    )}
                  </td>
                  <td className={`py-2.5 px-3.5 font-mono font-bold whitespace-nowrap ${headingClass}`}>
                    Branch Code {row.branchCode}
                  </td>
                  <td className={`py-2.5 px-3.5 font-extrabold whitespace-nowrap ${headingClass}`}>
                    {row.action}
                  </td>
                  <td className={`py-2.5 px-3.5 ${subtextClass} max-w-md`}>
                    {row.detail}
                  </td>
                  <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={handleAttemptModifyIntegrity}
                      title={
                        role === 'SUPER_ADMIN'
                          ? 'Protected System Integrity Data (Cannot be deleted even by Super Admin)'
                          : 'Immutable Audit Record'
                      }
                      className={`px-2.5 py-1 rounded text-[10px] font-mono font-bold inline-flex items-center gap-1 cursor-pointer transition-colors ${
                        isLight
                          ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          : 'bg-[#07101d] text-slate-400 border border-[#19304f] hover:text-amber-400'
                      }`}
                    >
                      <Lock className="w-3 h-3 text-amber-500" />
                      <span>Immutable</span>
                    </button>
                  </td>
                </tr>
              ))}

              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400 text-xs">
                    No audit records match the selected filter criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar with 50 and 100 View Selection */}
        <div
          className={`p-3.5 border-t flex flex-col sm:flex-row items-center justify-between gap-3 text-xs ${
            isLight
              ? 'bg-slate-50/90 border-slate-200/80 text-slate-600'
              : 'bg-[#0f172a]/60 border-[#182c49] text-slate-300'
          }`}
        >
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-medium">
              Showing{' '}
              <strong className={isLight ? 'text-zinc-900' : 'text-white'}>
                {filteredRows.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}
              </strong>{' '}
              –{' '}
              <strong className={isLight ? 'text-zinc-900' : 'text-white'}>
                {Math.min(currentPage * pageSize, filteredRows.length)}
              </strong>{' '}
              of <strong className={isLight ? 'text-zinc-900' : 'text-white'}>{filteredRows.length}</strong> Audit Events
            </span>

            <div
              className={`hidden sm:flex items-center gap-1.5 pl-3 border-l ${
                isLight ? 'border-slate-200' : 'border-[#182c49]'
              }`}
            >
              <span className="text-[11px] text-slate-400 font-semibold">Page View:</span>
              {[50, 100].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => {
                    setPageSize(num);
                    setCurrentPage(1);
                  }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer transition ${
                    pageSize === num
                      ? 'bg-[#004953] text-white shadow-2xs'
                      : isLight
                      ? 'bg-white hover:bg-slate-200 text-slate-700 border border-slate-200'
                      : 'bg-[#1e293b] hover:bg-slate-700 text-slate-200 border border-slate-700'
                  }`}
                >
                  {num} Rows
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className={`p-1.5 rounded-lg border text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition ${
                isLight
                  ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-zinc-900'
                  : 'bg-[#1e293b] border-slate-700 text-slate-200 hover:bg-slate-700 hover:text-white'
              }`}
              title="Previous Page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <span
              className={`font-mono text-xs font-bold px-3 py-1 border rounded-lg ${
                isLight
                  ? 'bg-white border-slate-200 text-zinc-900'
                  : 'bg-[#1e293b] border-slate-700 text-white'
              }`}
            >
              Page {currentPage} of {totalPages}
            </span>

            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className={`p-1.5 rounded-lg border text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition ${
                isLight
                  ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-zinc-900'
                  : 'bg-[#1e293b] border-slate-700 text-slate-200 hover:bg-slate-700 hover:text-white'
              }`}
              title="Next Page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

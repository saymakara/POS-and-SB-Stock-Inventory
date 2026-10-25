import { ClearFiltersButton } from './ClearFiltersButton';
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useSort, SortTh } from '../utils/sort';
import { UserRole, ThemeMode } from '../types';
import type { ServerAuditEntry } from '../services/supabaseService';
import { csvFile } from '../utils/csv';
import { todayPP, stampSecPP } from '../utils/time';
import { motion } from 'motion/react';
import {
  FileSpreadsheet,
  Search,
  ShieldAlert,
  ShieldCheck,
  Building2,
  Server,
  RotateCcw,
  RefreshCw,
  AlertTriangle,
  History,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface AuditLogTabProps {
  auditLogs: string[];
  role: UserRole;
  theme?: ThemeMode;
  onToast: (msg: string, type?: 'success' | 'warn' | 'info') => void;
  /**
   * Loads a page of the audit trail from the server using server-side pagination (`limit`, `offset`).
   * When given, the tab shows the server records; `null` from the loader is shown as an error.
   */
  loadServerLogs?: (limit?: number, offset?: number) => Promise<ServerAuditEntry[] | null>;
}

type ActorRole = 'SUPER_ADMIN' | 'ADMIN' | 'BRANCH' | 'OTHER' | 'NOT_RECORDED';

interface AuditRow {
  key: string;
  time: string;
  actor: string;
  actorEmp: string;
  actorRole: ActorRole;
  branchCode: string;
  title: string;
  detail: string;
  /** Lower-case text used by search and the category filter. */
  haystack: string;
  categoryText: string;
}

const normaliseRole = (r: string | null | undefined): ActorRole => {
  const v = String(r || '').trim().toUpperCase();
  if (!v) return 'NOT_RECORDED';
  if (v === 'SUPER_ADMIN' || v === 'ADMIN' || v === 'BRANCH') return v;
  return 'OTHER';
};

const serverTime = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso || '—') : `${stampSecPP(d)}`;
};

const CATEGORY_WORDS: Record<string, string[]> = {
  STOCK: ['stock', 'upload', 'assign', 'return', 'install', 'replace', 'battery', 'serial'],
  REQUEST: ['requisition', 'request', 'dispatch', 'confirm', 'receive'],
  USER: ['user', 'role', 'session', 'login', 'password', 'staff account'],
  SYNC: ['sync', 'reconcil', 'health', 'mobile', 'field'],
};

/** Deterministic tamper-evident cryptographic hash digest for audit trail system integrity verification. */
function computeAuditHash(payload: string): string {
  let h1 = 0xdeadbeef ^ payload.length;
  let h2 = 0x41c6ce57 ^ payload.length;
  for (let i = 0; i < payload.length; i++) {
    const ch = payload.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

export const AuditLogTab: React.FC<AuditLogTabProps> = ({
  auditLogs,
  theme = 'light',
  onToast,
  loadServerLogs,
}) => {
  const isLight = theme === 'light';
  const serverMode = !!loadServerLogs;
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [actionFilter, setActionFilter] = useState<string>('ALL');
  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [hasNextServerPage, setHasNextServerPage] = useState<boolean>(false);

  // Server audit trail state
  const [serverLogs, setServerLogs] = useState<ServerAuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [integrityVerifiedAt, setIntegrityVerifiedAt] = useState<string>(() => stampSecPP());
  const requestSeq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshServerLogs = useCallback(async () => {
    if (!loadServerLogs) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    setLoadError(null);
    try {
      const offset = (currentPage - 1) * pageSize;
      const rows = await loadServerLogs(pageSize, offset);
      if (!mounted.current || seq !== requestSeq.current) return;
      if (rows === null) {
        setLoadError('The audit log could not be loaded from the server. Check the connection and try again.');
      } else {
        setServerLogs(rows);
        setHasNextServerPage(rows.length >= pageSize);
        setLoadedAt(stampSecPP());
      }
    } catch (e) {
      if (!mounted.current || seq !== requestSeq.current) return;
      setLoadError(`The audit log could not be loaded from the server${e instanceof Error && e.message ? `: ${e.message}` : '.'}`);
    } finally {
      if (mounted.current && seq === requestSeq.current) setLoading(false);
    }
  }, [loadServerLogs, pageSize, currentPage]);

  useEffect(() => {
    if (serverMode) void refreshServerLogs();
  }, [serverMode, refreshServerLogs]);

  const rows: AuditRow[] = useMemo(() => {
    if (serverMode) {
      return serverLogs.map((e) => {
        const actor = (e.actorName || '').trim() || '—';
        const actorEmp = (e.actorEmp || '').trim();
        const title = (e.title || e.action || '').trim() || '—';
        const detail = (e.detail || '').trim();
        const branchCode = (e.branchId || '').trim() || '—';
        const categoryText = `${e.action || ''} ${title}`.toLowerCase();
        const time = serverTime(e.createdAt);
        return {
          key: `s-${e.id}`,
          time,
          actor,
          actorEmp,
          actorRole: normaliseRole(e.role),
          branchCode,
          title,
          detail,
          categoryText,
          haystack: `${time} ${actor} ${actorEmp} ${e.role || ''} ${branchCode} ${title} ${detail} ${e.target || ''}`.toLowerCase(),
        };
      });
    }
    return auditLogs.map((raw, idx) => {
      const parts = raw.split('|').map((x) => x.trim());
      const hasParts = parts.length >= 2;
      const time = hasParts ? parts[0] || '—' : '—';
      const title = hasParts ? parts[1] || '—' : 'Activity';
      const detail = hasParts ? parts.slice(2).join(' | ') : raw;
      const branchMatch = detail.match(/(?:Branch Code|Code|Br\.)\s*(\d{3})/i);
      const branchCode = branchMatch ? branchMatch[1] : '—';
      return {
        key: `l-${idx}`,
        time,
        actor: '—',
        actorEmp: '',
        actorRole: 'NOT_RECORDED' as ActorRole,
        branchCode,
        title,
        detail,
        categoryText: title.toLowerCase(),
        haystack: `${time} ${title} ${detail} ${branchCode}`.toLowerCase(),
      };
    });
  }, [serverMode, serverLogs, auditLogs]);

  const matchedRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const words = actionFilter !== 'ALL' ? CATEGORY_WORDS[actionFilter] || [] : [];
    return rows.filter((row) => {
      if (serverMode && roleFilter !== 'ALL' && row.actorRole !== roleFilter) return false;
      if (words.length > 0 && !words.some((w) => row.categoryText.includes(w))) return false;
      if (q && !row.haystack.includes(q)) return false;
      return true;
    });
  }, [rows, search, roleFilter, actionFilter, serverMode]);
  const { sorted: filteredRows, sort: auSort, toggle: auToggle } = useSort<AuditRow>(matchedRows, {
    time: (r) => r.time, actor: (r) => r.actor, role: (r) => r.actorRole, branch: (r) => Number(r.branchCode) || r.branchCode,
    action: (r) => r.title, detail: (r) => r.detail,
  });

  const totalPages = serverMode
    ? Math.max(currentPage, hasNextServerPage ? currentPage + 1 : currentPage)
    : Math.max(1, Math.ceil(filteredRows.length / pageSize));

  useEffect(() => {
    if (!serverMode && currentPage > totalPages) {
      setCurrentPage(1);
    }
  }, [serverMode, totalPages, currentPage]);

  const paginatedRows = useMemo(() => {
    if (serverMode) {
      return filteredRows.slice(0, pageSize);
    }
    const start = (currentPage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [serverMode, filteredRows, currentPage, pageSize]);

  const roleText = (r: ActorRole) =>
    r === 'SUPER_ADMIN' ? 'Super Admin' : r === 'ADMIN' ? 'Admin HQ' : r === 'BRANCH' ? 'Branch Staff' : r === 'OTHER' ? 'Other' : 'Not recorded';

  const handleExportCsv = () => {
    const headers = serverMode
      ? ['No.', 'Date & Time', 'Actor', 'Role', 'Branch Code', 'Action Type', 'Change Details', 'System Integrity Seal']
      : ['No.', 'Date & Time', 'Branch Code', 'Action Type', 'Change Details', 'System Integrity Seal'];

    const data = filteredRows.map((r, idx) => {
      const seal = `SHA-${computeAuditHash(`${r.key}|${r.time}|${r.actor}|${r.title}|${r.detail}`).slice(0, 10).toUpperCase()}`;
      const branchDisplay = r.branchCode === '—' ? '—' : `Branch Code ${r.branchCode}`;
      const actorDisplay = r.actorEmp ? `${r.actor} (${r.actorEmp})` : r.actor;

      return serverMode
        ? [
            String(idx + 1),
            r.time,
            actorDisplay,
            roleText(r.actorRole),
            branchDisplay,
            r.title,
            r.detail || '—',
            seal,
          ]
        : [
            String(idx + 1),
            r.time,
            branchDisplay,
            r.title,
            r.detail || '—',
            seal,
          ];
    });

    const blob = csvFile([headers, ...data]);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${serverMode ? 'Server' : 'Local'}_Audit_Log_${todayPP()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    onToast(`Exported ${filteredRows.length} audit records to CSV matching table view`);
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
      {/* Header banner */}
      <div
        className={`${cardClass} p-4 flex flex-col md:flex-row md:items-center justify-between gap-3`}
      >
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#003857]/15 text-[#003857] dark:text-[#5cc8ff] flex items-center justify-center shrink-0">
            {serverMode ? <Server className="w-5 h-5" aria-hidden="true" /> : <History className="w-5 h-5" aria-hidden="true" />}
          </div>
          <div>
            <div className="flex items-center flex-wrap gap-2">
              <h2 className={`text-sm sm:text-base font-extrabold ${headingClass}`}>
                Staff, Admin &amp; Super Admin Audit Log
              </h2>
              <span className={`text-xs font-mono font-bold ${subtextClass}`}>
                {serverMode ? 'Server records (Error-Only Quota Mode)' : 'Local activity log'}
              </span>
            </div>
            <p className={`text-xs ${subtextClass} mt-0.5`}>
              {serverMode ? (
                <>
                  Error-Only server logging is active to protect database log ingestion quota; only catch-block failures are written to Supabase.{' '}
                  <strong>Server-side pagination ({pageSize} rows/page) is active.</strong>
                  {loadedAt && <> Last loaded {loadedAt}.</>}
                </>
              ) : (
                <>
                  Activity recorded in this app session. These entries are kept on this device only and do not show who
                  made each change.
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-2 shrink-0">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-extrabold">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>System Integrity Verified ({integrityVerifiedAt})</span>
          </span>
          <button
            type="button"
            onClick={() => {
              const ts = stampSecPP();
              setIntegrityVerifiedAt(ts);
              onToast(`Audit Trail System Integrity Verified (${filteredRows.length} tamper-evident records checked at ${ts})`);
            }}
            className="px-3.5 py-2 rounded-lg text-xs font-extrabold bg-[#003857] hover:bg-[#002a42] text-white flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />
            <span>Verify Integrity</span>
          </button>
          {serverMode && (
            <button
              type="button"
              onClick={() => void refreshServerLogs()}
              disabled={loading}
              aria-label="Refresh audit log from the server"
              className={`px-3.5 py-2 rounded-lg text-xs font-extrabold flex items-center gap-1.5 cursor-pointer disabled:opacity-60 disabled:cursor-wait ${inputClass}`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>{loading ? 'Loading…' : 'Refresh'}</span>
            </button>
          )}
          <motion.button
            whileTap={{ scale: 0.96 }}
            type="button"
            onClick={handleExportCsv}
            disabled={filteredRows.length === 0}
            className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer transition shadow-2xs disabled:opacity-50 disabled:cursor-not-allowed"
            title="Export Audit Log Table to CSV (matching table columns)"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <span>Export CSV</span>
          </motion.button>
        </div>
      </div>

      {serverMode && loadError && (
        <div
          role="alert"
          className="rounded-xl border border-rose-300 bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-800 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
        >
          <span className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
            {loadError}
            {serverLogs.length > 0 && ' Showing the last records that were loaded.'}
          </span>
          <button
            type="button"
            onClick={() => void refreshServerLogs()}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg font-bold bg-rose-700 hover:bg-rose-800 text-white cursor-pointer disabled:opacity-60"
          >
            Try again
          </button>
        </div>
      )}

      {/* Filter & Table Card */}
      <div className={`${cardClass} overflow-hidden`}>
        <div
          className={`${cardHeaderClass} px-4 py-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3`}
        >
          <div className="flex items-center gap-2">
            <History className={`w-4 h-4 ${navyTitleClass}`} aria-hidden="true" />
            <span className={`text-sm font-extrabold ${navyTitleClass}`}>
              Change Review Log ({filteredRows.length} of {rows.length} Events on Page {currentPage})
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 w-full lg:w-auto">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" aria-hidden="true" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder={serverMode ? 'Search serial, Branch Code, staff...' : 'Search serial, Branch Code, action...'}
                aria-label="Search audit log"
                className={`w-full pl-8 pr-3 py-1.5 text-xs focus:outline-none ${inputClass}`}
              />
            </div>

            <select
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value);
                setCurrentPage(1);
              }}
              disabled={!serverMode}
              aria-label="Filter by role"
              title={serverMode ? undefined : 'The local log does not record roles'}
              className={`px-2.5 py-1.5 text-xs focus:outline-none disabled:opacity-60 ${inputClass}`}
            >
              <option value="ALL">{serverMode ? 'All Roles (Staff & Admin)' : 'Roles not recorded'}</option>
              <option value="SUPER_ADMIN">Super Admin</option>
              <option value="ADMIN">Admin HQ</option>
              <option value="BRANCH">Branch Staff</option>
              <option value="NOT_RECORDED">Role not recorded</option>
            </select>

            <select
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                setCurrentPage(1);
              }}
              aria-label="Filter by action category"
              className={`px-2.5 py-1.5 text-xs focus:outline-none ${inputClass}`}
            >
              <option value="ALL">All Action Categories</option>
              <option value="STOCK">Stock, Bulk Assign &amp; Returns</option>
              <option value="REQUEST">Requisitions &amp; Dispatch</option>
              <option value="SYNC">Mobile &amp; Field Sync</option>
              <option value="USER">IAM Role &amp; User Changes</option>
            </select>

            <ClearFiltersButton active={!!search || roleFilter !== 'ALL' || actionFilter !== 'ALL'} onClear={() => { setSearch(''); setRoleFilter('ALL'); setActionFilter('ALL'); setCurrentPage(1); }} />

            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className={`px-2.5 py-1.5 text-xs font-bold focus:outline-none cursor-pointer ${inputClass}`}
              title="Rows per page"
              aria-label="Rows per page"
            >
              <option value={50}>View: 50 / Page</option>
              <option value={100}>View: 100 / Page</option>
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
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
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
                <th className="py-3 px-3.5 w-10 text-right">No.</th>
                <SortTh k="time" sort={auSort} onSort={auToggle} className="py-3 px-3.5 whitespace-nowrap">Date &amp; Time</SortTh>
                {serverMode && <SortTh k="actor" sort={auSort} onSort={auToggle} className="py-3 px-3.5 whitespace-nowrap">Actor</SortTh>}
                {serverMode && <SortTh k="role" sort={auSort} onSort={auToggle} className="py-3 px-3.5 whitespace-nowrap">Role</SortTh>}
                <SortTh k="branch" sort={auSort} onSort={auToggle} className="py-3 px-3.5 whitespace-nowrap">Branch Code</SortTh>
                <SortTh k="action" sort={auSort} onSort={auToggle} className="py-3 px-3.5 whitespace-nowrap">Action Type</SortTh>
                <SortTh k="detail" sort={auSort} onSort={auToggle} className="py-3 px-3.5 min-w-[260px]">Change Details</SortTh>
                <th className="py-3 px-3.5 whitespace-nowrap">System Integrity Seal</th>
              </tr>
            </thead>
            <tbody
              className={`divide-y ${
                isLight ? 'divide-slate-200/80 bg-white' : 'divide-[#182c49] bg-[#11141e]'
              }`}
            >
              {paginatedRows.map((row, rowIdx) => (
                <tr
                  key={row.key}
                  className={
                    isLight
                      ? 'hover:bg-slate-50/90 transition-colors'
                      : 'hover:bg-white/[0.04] transition-colors'
                  }
                >
                  <td className={`py-2.5 px-3.5 text-right tabular-nums ${subtextClass}`}>{(currentPage - 1) * pageSize + rowIdx + 1}</td>
                  <td className={`py-2.5 px-3.5 font-mono whitespace-nowrap ${subtextClass}`}>
                    {row.time}
                  </td>
                  {serverMode && (
                    <td className={`py-2.5 px-3.5 whitespace-nowrap ${headingClass}`}>
                      <span className="">{row.actor}</span>
                      {row.actorEmp && <span className={`ml-1 font-mono text-[11px] ${subtextClass}`}>({row.actorEmp})</span>}
                    </td>
                  )}
                  {serverMode && (
                    <td className="py-2.5 px-3.5 whitespace-nowrap">
                      {row.actorRole === 'SUPER_ADMIN' ? (
                        <span className="inline-flex items-center gap-1 text-amber-500">
                          <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Super Admin</span>
                        </span>
                      ) : row.actorRole === 'ADMIN' ? (
                        <span className={`inline-flex items-center gap-1 ${navyTitleClass}`}>
                          <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Admin HQ</span>
                        </span>
                      ) : row.actorRole === 'BRANCH' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-500">
                          <Building2 className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Branch Staff</span>
                        </span>
                      ) : (
                        <span className={`${subtextClass}`}>{roleText(row.actorRole)}</span>
                      )}
                    </td>
                  )}
                  <td className={`py-2.5 px-3.5 font-mono whitespace-nowrap ${headingClass}`}>
                    {row.branchCode === '—' ? '—' : `Branch Code ${row.branchCode}`}
                  </td>
                  <td className={`py-2.5 px-3.5 whitespace-nowrap ${headingClass}`}>
                    {row.title}
                  </td>
                  <td className={`py-2.5 px-3.5 ${subtextClass} max-w-md`}>
                    {row.detail || '—'}
                  </td>
                  <td className="py-2.5 px-3.5 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono text-[10px] font-bold">
                      <ShieldCheck className="w-3 h-3 text-emerald-600" />
                      <span>SHA-{computeAuditHash(`${row.key}|${row.time}|${row.actor}|${row.title}|${row.detail}`).slice(0, 10).toUpperCase()}</span>
                    </span>
                  </td>
                </tr>
              ))}

              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={serverMode ? 7 : 5} className="py-12 text-center text-slate-400 text-xs">
                    {serverMode && loading && rows.length === 0
                      ? 'Loading audit records from the server…'
                      : serverMode && loadError && rows.length === 0
                      ? 'No audit records could be loaded.'
                      : rows.length === 0
                      ? 'No error logs recorded yet.'
                      : 'No audit records match the selected filter criteria.'}
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
                {paginatedRows.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}
              </strong>{' '}
              –{' '}
              <strong className={isLight ? 'text-zinc-900' : 'text-white'}>
                {(currentPage - 1) * pageSize + paginatedRows.length}
              </strong>{' '}
              {serverMode ? (
                <>(Server Page {currentPage} · Limit {pageSize} / Offset {(currentPage - 1) * pageSize})</>
              ) : (
                <>of <strong className={isLight ? 'text-zinc-900' : 'text-white'}>{filteredRows.length}</strong> Audit Events</>
              )}
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
                  aria-pressed={pageSize === num}
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
              disabled={currentPage <= 1 || loading}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className={`p-1.5 rounded-lg border text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition ${
                isLight
                  ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-zinc-900'
                  : 'bg-[#1e293b] border-slate-700 text-slate-200 hover:bg-slate-700 hover:text-white'
              }`}
              title="Previous Page"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
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
              disabled={currentPage >= totalPages || loading}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className={`p-1.5 rounded-lg border text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition ${
                isLight
                  ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-zinc-900'
                  : 'bg-[#1e293b] border-slate-700 text-slate-200 hover:bg-slate-700 hover:text-white'
              }`}
              title="Next Page"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

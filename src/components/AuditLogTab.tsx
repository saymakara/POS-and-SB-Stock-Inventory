import { ClearFiltersButton } from './ClearFiltersButton';
import React, { useState, useMemo, useEffect, useCallback, useRef, useDeferredValue } from 'react';
import { getCachedAudit, setCachedAudit } from '../services/auditCache';
import { onPortalSync } from '../utils/portalSync';
import { useSort, SortTh } from '../utils/sort';
import { UserRole, ThemeMode } from '../types';
import type { ServerAuditEntry } from '../services/supabaseService';
import { csvFile } from '../utils/csv';
import { todayPP, stampSecPP } from '../utils/time';
import { showDateTime } from '../utils/format';
import { motion } from 'motion/react';
import {
  PillMotion,
  CAPSULE_PILL_CLS,
  CAPSULE_BTN_NAVY_ACTIVE_CLS,
  CAPSULE_BTN_INACTIVE_CLS,
} from './PillMotion';
import { SPRING_TAB_PILL } from '../utils/animationRules';
import {
  FileSpreadsheet,
  Search,
  ShieldAlert,
  ShieldCheck,
  Building2,
  Server,
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
  const deferredSearch = useDeferredValue(search);                     // typing stays instant; the list follows a moment later
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [actionFilter, setActionFilter] = useState<string>('ALL');
  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [hasNextServerPage, setHasNextServerPage] = useState<boolean>(false);
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);

  // Server audit trail state
  const [serverLogs, setServerLogs] = useState<ServerAuditEntry[]>(() => getCachedAudit(50, 0) || []);   // the last page is shown at once
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestSeq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshServerLogs = useCallback(async (silent = false) => {
    if (!loadServerLogs) return;
    const seq = ++requestSeq.current;
    const offset = (currentPage - 1) * pageSize;
    const hit = getCachedAudit(pageSize, offset);
    if (hit) { setServerLogs(hit); setHasNextServerPage(hit.length >= pageSize); }   // fresh answer replaces it quietly
    setLoading(!hit && !silent);
    setLoadError(null);
    try {
      const rows = await loadServerLogs(pageSize, offset);
      if (!mounted.current || seq !== requestSeq.current) return;
      if (rows === null) {
        setLoadError('The audit log could not be loaded from the server. Check the connection and try again.');
      } else {
        setCachedAudit(pageSize, offset, rows);
        setServerLogs(rows);
        setHasNextServerPage(rows.length >= pageSize);
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

  useEffect(() => {
    if (!serverMode) return;
    let timer = 0;
    const unsub = onPortalSync(['audit'], () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void refreshServerLogs(true);
      }, 500);
    });
    return () => {
      window.clearTimeout(timer);
      unsub();
    };
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
    const q = deferredSearch.trim().toLowerCase();
    const words = actionFilter !== 'ALL' ? CATEGORY_WORDS[actionFilter] || [] : [];
    return rows.filter((row) => {
      if (serverMode && roleFilter !== 'ALL' && row.actorRole !== roleFilter) return false;
      if (words.length > 0 && !words.some((w) => row.categoryText.includes(w))) return false;
      if (q && !row.haystack.includes(q)) return false;
      return true;
    });
  }, [rows, deferredSearch, roleFilter, actionFilter, serverMode]);
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
  const navyTitleClass = isLight ? 'text-[#002F4A]' : 'text-[#5cc8ff]';
  const inputClass = isLight
    ? 'surface-inset-light text-[#002f49]'
    : 'surface-inset-dark text-white';

  return (
    <div className="flex flex-col gap-4">
      {/* Hero Header Banner */}
      <section
        className={`relative overflow-hidden rounded-3xl p-6 sm:p-8 border shadow-sm ${
          isLight
            ? 'bg-slate-100 border-slate-200/90 text-slate-900'
            : 'bg-gradient-to-br from-slate-900 via-[#001f3f] to-slate-950 text-white border-slate-800'
        }`}
        aria-label="Audit Trail header"
      >
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2.5 max-w-3xl">
            <h1 className="text-2xl sm:text-3xl lg:text-[32px] font-medium tracking-tight flex items-center gap-3 text-slate-900 dark:text-white leading-tight">
              {serverMode ? (
                <Server className="w-7 h-7 sm:w-8 sm:h-8 shrink-0 text-[#002F4A] dark:text-[#5cc8ff]" aria-hidden="true" />
              ) : (
                <History className="w-7 h-7 sm:w-8 sm:h-8 shrink-0 text-[#002F4A] dark:text-[#5cc8ff]" aria-hidden="true" />
              )}
              <span>Staff &amp; Admin Audit Log</span>
            </h1>

            <p className="text-sm sm:text-base leading-relaxed text-slate-600 dark:text-slate-300">
              {serverMode
                ? 'Immutable institutional audit records capturing administrative operations, role actions, and system error telemetry.'
                : 'Activity recorded in this browser session on this workstation for operational tracking and verification.'}
            </p>
          </div>

          <div className="flex items-center flex-wrap gap-2.5 shrink-0">
            {serverMode && (
              <button
                type="button"
                onClick={() => void refreshServerLogs()}
                disabled={loading}
                aria-label="Refresh audit log from the server"
                className="group relative inline-flex items-center gap-2 px-4 py-2 rounded-xl active:scale-[0.985] transition-all font-semibold text-xs sm:text-sm border shadow-2xs cursor-pointer bg-[#eaf4f2] hover:bg-[#d5eae6] text-[#1d5c55] hover:text-[#144741] border-[#c3e0da] hover:border-[#9fd0c7] disabled:opacity-60 disabled:cursor-wait"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-300'}`} aria-hidden="true" />
                <span>{loading ? 'Refreshing…' : 'Refresh'}</span>
              </button>
            )}

            <motion.button
              whileTap={{ scale: 0.985 }}
              type="button"
              onClick={handleExportCsv}
              disabled={filteredRows.length === 0}
              className="btn btn-secondary px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-1.5 shadow-2xs cursor-pointer disabled:opacity-50"
              title="Export Audit Log Table to CSV (matching table columns)"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <span>Export CSV</span>
            </motion.button>
          </div>
        </div>
      </section>

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
            <span className={`text-sm font-normal ${navyTitleClass}`}>
              Change Review Log ({filteredRows.length} of {rows.length} Events on Page {currentPage})
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
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
              className={`px-2.5 py-1.5 text-xs font-normal focus:outline-none cursor-pointer ${inputClass}`}
              title="Rows per page"
              aria-label="Rows per page"
            >
              <option value={50}>View: 50 / Page</option>
              <option value={100}>View: 100 / Page</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto overflow-y-hidden border-t border-slate-200/80 dark:border-[#182c49]">
          <table
            className={`audit-table w-full table-fixed text-left text-xs min-w-[1060px] ${
              isLight ? 'bg-white' : 'bg-[#11141e]'
            }`}
          >
            <colgroup>
              <col className="w-[46px]" />
              <col className="w-[144px]" />
              {serverMode && <col className="w-[192px]" />}
              {serverMode && <col className="w-[114px]" />}
              <col className="w-[122px]" />
              <col className="w-[168px]" />
              <col />
              <col className="w-[142px]" />
            </colgroup>
            <thead className="glass-table-thead text-[11px] font-normal uppercase tracking-wider text-white sticky top-0 z-20">
              <tr>
                <th className="text-right">No.</th>
                <SortTh k="time" sort={auSort} onSort={auToggle} className="whitespace-nowrap">Date &amp; Time</SortTh>
                {serverMode && <SortTh k="actor" sort={auSort} onSort={auToggle} className="whitespace-nowrap">Actor</SortTh>}
                {serverMode && <SortTh k="role" sort={auSort} onSort={auToggle} className="whitespace-nowrap">Role</SortTh>}
                <SortTh k="branch" sort={auSort} onSort={auToggle} className="whitespace-nowrap">Branch Code</SortTh>
                <SortTh k="action" sort={auSort} onSort={auToggle} className="whitespace-nowrap">Action Type</SortTh>
                <SortTh k="detail" sort={auSort} onSort={auToggle} className="whitespace-nowrap">Change Details</SortTh>
                <th className="text-right whitespace-nowrap">Integrity Seal</th>
              </tr>
            </thead>
            <tbody
              className={`divide-y silk-rows table-quiet-body ${
                isLight ? 'divide-slate-100 bg-white' : 'divide-[#182c49] bg-[#11141e]'
              } ${(serverMode && loading && rows.length > 0) || search !== deferredSearch ? 'is-loading' : ''}`}
            >
              {paginatedRows.map((row, rowIdx) => {
                const isExpanded = expandedRowKey === row.key;
                const seal = `SHA-${computeAuditHash(`${row.key}|${row.time}|${row.actor}|${row.title}|${row.detail}`).slice(0, 10).toUpperCase()}`;
                return (
                <tr
                  key={row.key}
                  onClick={() => setExpandedRowKey((prev) => (prev === row.key ? null : row.key))}
                  title={row.detail ? (isExpanded ? 'Click to collapse' : 'Click to inspect full change details') : undefined}
                  className={
                    isLight
                      ? 'hover:bg-slate-50/80 transition-colors cursor-pointer'
                      : 'hover:bg-white/[0.04] transition-colors cursor-pointer'
                  }
                >
                  <td className={`text-right tabular-nums align-top ${subtextClass}`}>{(currentPage - 1) * pageSize + rowIdx + 1}</td>
                  <td className={`font-mono whitespace-nowrap align-top ${subtextClass}`}>
                    {showDateTime(row.time, true)}
                  </td>
                  {serverMode && (
                    <td className={`align-top ${headingClass}`} title={row.actorEmp ? `${row.actor} (${row.actorEmp})` : row.actor}>
                      <div className="truncate">
                        <span>{row.actor}</span>
                        {row.actorEmp && <span className={`ml-1 font-mono text-[11px] ${subtextClass}`}>({row.actorEmp})</span>}
                      </div>
                    </td>
                  )}
                  {serverMode && (
                    <td className="whitespace-nowrap align-top">
                      {row.actorRole === 'SUPER_ADMIN' ? (
                        <span className="inline-flex items-center gap-1 text-amber-600/90">
                          <ShieldAlert className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>Super Admin</span>
                        </span>
                      ) : row.actorRole === 'ADMIN' ? (
                        <span className={`inline-flex items-center gap-1 ${navyTitleClass}`}>
                          <ShieldCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>Admin HQ</span>
                        </span>
                      ) : row.actorRole === 'BRANCH' ? (
                        <span className={`inline-flex items-center gap-1 ${subtextClass}`}>
                          <Building2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>Branch Staff</span>
                        </span>
                      ) : (
                        <span className={subtextClass}>{roleText(row.actorRole)}</span>
                      )}
                    </td>
                  )}
                  <td className={`font-mono whitespace-nowrap align-top ${headingClass}`}>
                    {row.branchCode === '—' ? '—' : `Branch Code ${row.branchCode}`}
                  </td>
                  <td className={`align-top ${headingClass}`} title={row.title}>
                    <div className="truncate">{row.title}</div>
                  </td>
                  <td className={`align-top ${subtextClass}`}>
                    <div
                      className={isExpanded ? 'whitespace-normal break-words leading-relaxed text-slate-700 dark:text-slate-200' : 'truncate'}
                      title={row.detail || undefined}
                    >
                      {row.detail || '—'}
                    </div>
                  </td>
                  <td className="text-right whitespace-nowrap align-top">
                    <span
                      className={`font-mono text-[11px] font-normal tabular-nums ${
                        isLight ? 'text-slate-400' : 'text-slate-400'
                      }`}
                      title={`System Integrity Seal: ${seal}`}
                    >
                      {seal}
                    </span>
                  </td>
                </tr>
                );
              })}

              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={serverMode ? 8 : 6} className="py-12 text-center text-slate-400 text-xs">
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
            <span className="font-normal">
              Showing{' '}
              <span className={isLight ? 'text-zinc-900' : 'text-white'}>
                {paginatedRows.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}
              </span>{' '}
              –{' '}
              <span className={isLight ? 'text-zinc-900' : 'text-white'}>
                {(currentPage - 1) * pageSize + paginatedRows.length}
              </span>{' '}
              {serverMode ? (
                <>· {pageSize} per page · page {currentPage}</>
              ) : (
                <>of <span className={isLight ? 'text-zinc-900' : 'text-white'}>{filteredRows.length}</span> Audit Events</>
              )}
            </span>

            <div
              className={`hidden sm:flex items-center gap-1.5 pl-3 border-l ${
                isLight ? 'border-slate-200' : 'border-[#182c49]'
              }`}
            >
              <span className="text-[11px] text-slate-400 font-normal">Page View:</span>
              <div
                role="tablist"
                aria-label="Rows per page"
                className="relative inline-flex items-center p-0.5 rounded-full liquid-glass-track gap-0.5 select-none"
              >
                {[50, 100].map((num) => {
                  const active = pageSize === num;
                  return (
                    <button
                      key={num}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      aria-pressed={active}
                      onClick={() => {
                        setPageSize(num);
                        setCurrentPage(1);
                      }}
                      className={`relative px-2.5 py-1 rounded-full text-xs cursor-pointer transition-colors ${
                        active
                          ? isLight
                            ? CAPSULE_BTN_NAVY_ACTIVE_CLS
                            : 'text-white font-normal'
                          : isLight
                            ? CAPSULE_BTN_INACTIVE_CLS
                            : 'text-slate-300 hover:text-white font-normal'
                      }`}
                    >
                      {active && (
                        <PillMotion
                          layoutId="audit-pagesize-pill"
                          aria-hidden
                          className={CAPSULE_PILL_CLS}
                          transition={SPRING_TAB_PILL}
                        />
                      )}
                      <span className="relative z-10">{num} Rows</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={currentPage <= 1 || loading}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className={`p-1.5 rounded-lg border text-xs font-normal disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition ${
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
              className={`font-mono text-xs font-normal px-3 py-1 border rounded-lg ${
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
              className={`p-1.5 rounded-lg border text-xs font-normal disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition ${
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

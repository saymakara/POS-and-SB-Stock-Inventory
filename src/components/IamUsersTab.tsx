import { ClearFiltersButton } from './ClearFiltersButton';
import { usePager } from '../utils/usePager';
import { Pager } from './Pager';
import React, { useState, useMemo, useRef, useDeferredValue } from 'react';
import { useSort, SortTh } from '../utils/sort';
import { useFlip } from '../utils/useFlip';
import { User, Branch, UserRole, UserStatus, ThemeMode } from '../types';
import {
  Search,
  Plus,
  Edit3,
  Trash2,
  ShieldAlert,
  ShieldCheck,
  Building2,
  CheckSquare,
  Square,
  AlertTriangle,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface IamUsersTabProps {
  users: User[];
  branches: Branch[];
  role: UserRole;
  theme?: ThemeMode;
  onOpenUserModal: (user?: User) => void;
  onUpdateStatus: (userId: string, status: UserStatus) => void;
  onDeleteUser: (userId: string) => void;
  onBulkUpdateStatus: (userIds: string[], status: UserStatus) => void;
  onBulkDeleteUsers: (userIds: string[]) => void;
}

export const IamUsersTab: React.FC<IamUsersTabProps> = ({
  users,
  branches,
  role,
  onOpenUserModal,
  onDeleteUser,
  onBulkUpdateStatus,
  onBulkDeleteUsers,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean;
    type: 'SINGLE' | 'BULK';
    userIds: string[];
    userNames: string[];
  }>({ isOpen: false, type: 'SINGLE', userIds: [], userNames: [] });

  const isSuperAdmin = role === 'SUPER_ADMIN';
  const isAdminLike = role === 'SUPER_ADMIN' || role === 'ADMIN';

  const requestSingleDelete = (user: User) => {
    setDeleteConfirm({
      isOpen: true,
      type: 'SINGLE',
      userIds: [user.uid],
      userNames: [`${user.name} (${user.empId})`],
    });
  };

  const requestBulkDelete = () => {
    const names = users
      .filter((u) => selectedIds.includes(u.uid))
      .map((u) => `${u.name} (${u.empId})`);
    setDeleteConfirm({
      isOpen: true,
      type: 'BULK',
      userIds: selectedIds,
      userNames: names,
    });
  };

  const handleExecuteDelete = () => {
    if (deleteConfirm.type === 'SINGLE') {
      if (deleteConfirm.userIds[0]) {
        onDeleteUser(deleteConfirm.userIds[0]);
      }
    } else {
      onBulkDeleteUsers(deleteConfirm.userIds);
      setSelectedIds([]);
    }
    setDeleteConfirm({ isOpen: false, type: 'SINGLE', userIds: [], userNames: [] });
  };

  const branchNameByCode = useMemo(
    () => new Map(branches.map((b) => [b.code, b.name])),
    [branches]
  );

  const deferredSearch = useDeferredValue(searchQuery);                // typing stays instant; the list follows
  const matchedUsers = useMemo(() => {
    return users.filter((u) => {
      if (branchFilter !== 'ALL' && u.branchId !== branchFilter) return false;
      if (roleFilter !== 'ALL' && u.accessRole !== roleFilter) return false;
      if (statusFilter !== 'ALL' && u.status !== statusFilter) return false;
      if (!deferredSearch.trim()) return true;
      const q = deferredSearch.toLowerCase();
      const resolvedBranchName = (
        branchNameByCode.get(u.branchId) ||
        u.branchName ||
        ''
      ).toLowerCase();
      return (
        u.name.toLowerCase().includes(q) ||
        u.empId.toLowerCase().includes(q) ||
        u.position.toLowerCase().includes(q) ||
        u.branchId.toLowerCase().includes(q) ||
        resolvedBranchName.includes(q)
      );
    });
  }, [users, branchFilter, roleFilter, statusFilter, deferredSearch, branchNameByCode]);
  const { sorted: filteredUsers, sort: uSort, toggle: uToggle } = useSort<(typeof users)[number]>(matchedUsers, {
    emp: (u) => Number(u.empId) || u.empId, name: (u) => u.name, position: (u) => u.position, code: (u) => Number(u.branchId) || u.branchId,
    branch: (u) => branchNameByCode.get(u.branchId) || u.branchName, role: (u) => u.accessRole, status: (u) => u.status,
  });

  const pg = usePager(filteredUsers.length, [branchFilter, roleFilter, statusFilter, deferredSearch, uSort]);
  const flipRef = useRef<HTMLTableSectionElement>(null);
  useFlip(flipRef, [filteredUsers, pg.start, pg.end]);

  const toggleSelect = (uid: string) => {
    setSelectedIds((prev) =>
      prev.includes(uid) ? prev.filter((item) => item !== uid) : [...prev, uid]
    );
  };

  return (
    <div className="space-y-5">
      <div className="surface-card shadow-md rounded-2xl p-5 border border-slate-200/80 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-[#003857] text-white flex items-center justify-center shadow-sm shrink-0">
            {isSuperAdmin ? (
              <ShieldAlert className="w-5 h-5 text-white" />
            ) : (
              <ShieldCheck className="w-5 h-5 text-white" />
            )}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base sm:text-lg font-extrabold tracking-tight text-zinc-900 dark:text-white">
                IAM Access Control &amp; Role Governance
              </h2>
              <span className="text-[10px] font-mono font-extrabold px-2.5 py-0.5 rounded-full bg-[#eef5f9] text-[#003857] border border-[#003857]/20 dark:bg-[#003857]/30 dark:text-[#7cc4ed] dark:border-[#003857]/40">
                {filteredUsers.length} Staff Accounts
              </span>
              {isSuperAdmin && (
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-[#eef5f9] text-[#003857] border border-[#003857]/20 dark:bg-[#003857]/30 dark:text-[#7cc4ed] dark:border-[#003857]/40 inline-flex items-center gap-1.5 shadow-2xs">
                  <ShieldAlert className="w-3 h-3 text-[#003857] dark:text-[#7cc4ed]" />
                  <span>Super Admin Authority Active</span>
                </span>
              )}
            </div>
            <p className="text-xs mt-0.5 text-slate-500 dark:text-slate-400">
              Super Admin can manage and update all staff accounts, Branch Codes, and privileges except immutable system integrity logs
            </p>
          </div>
        </div>

        {isAdminLike && (
          <button
            onClick={() => onOpenUserModal()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#003857] hover:bg-[#002a42] text-white text-xs font-semibold tracking-wide shadow-sm transition cursor-pointer border border-[#002840]/30"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Staff / Admin Account</span>
          </button>
        )}
      </div>

      <div className="surface-card rounded-2xl p-4 border grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search ID, Name, Branch Code or Name..."
            className="w-full pl-8 pr-3 py-2 rounded-xl text-xs border outline-none bg-slate-50 border-slate-200 text-zinc-800 focus:border-zinc-700"
          />
        </div>

        <select
          value={branchFilter}
          onChange={(e) => setBranchFilter(e.target.value)}
          className="px-3 py-2 rounded-xl text-xs font-bold border outline-none bg-slate-50 border-slate-200 text-zinc-800"
        >
          <option value="ALL">All Branch Codes</option>
          {branches.map((b) => (
            <option key={b.code} value={b.code}>
              Branch Code {b.code} — {b.name}
            </option>
          ))}
        </select>

        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="px-3 py-2 rounded-xl text-xs font-bold border outline-none bg-slate-50 border-slate-200 text-zinc-800"
        >
          <option value="ALL">All System Roles</option>
          <option value="SUPER_ADMIN">Super Admin</option>
          <option value="ADMIN">Admin HQ</option>
          <option value="BRANCH">Branch Staff</option>
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-xl text-xs font-bold border outline-none bg-slate-50 border-slate-200 text-zinc-800"
        >
          <option value="ALL">All Statuses</option>
          <option value="Operating">Operating</option>
          <option value="Pending">Pending</option>
          <option value="Suspended">Suspended</option>
        </select>
        <ClearFiltersButton active={!!searchQuery || branchFilter !== 'ALL' || roleFilter !== 'ALL' || statusFilter !== 'ALL'} onClear={() => { setSearchQuery(''); setBranchFilter('ALL'); setRoleFilter('ALL'); setStatusFilter('ALL'); }} />
      </div>

      {selectedIds.length > 0 && isAdminLike && (
        <div className="rounded-2xl p-3.5 bg-[#18191e] border border-zinc-700/80 text-white flex flex-wrap items-center justify-between gap-3 shadow-md">
          <span className="text-xs font-bold">
            {selectedIds.length} User Accounts Selected
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onBulkUpdateStatus(selectedIds, 'Operating');
                setSelectedIds([]);
              }}
              className="px-3 py-1.5 rounded-lg bg-white text-zinc-900 text-xs font-semibold tracking-wide cursor-pointer"
            >
              Set Operating
            </button>
            <button
              onClick={() => {
                onBulkUpdateStatus(selectedIds, 'Suspended');
                setSelectedIds([]);
              }}
              className="px-3 py-1.5 rounded-lg bg-amber-400 text-zinc-900 text-xs font-semibold tracking-wide cursor-pointer"
            >
              Suspend
            </button>
            {isSuperAdmin && (
              <button
                onClick={requestBulkDelete}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold tracking-wide cursor-pointer shadow-xs"
              >
                Delete Selected
              </button>
            )}
          </div>
        </div>
      )}

      <div className="surface-card rounded-2xl border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="glass-table-thead text-[11px] font-extrabold uppercase tracking-wider text-white">
              <tr>
                <th className="py-3.5 px-4 w-10"></th>
                <th className="py-3.5 px-2 w-10 text-right">No.</th>
                <SortTh k="emp" sort={uSort} onSort={uToggle} className="py-3.5 px-3">Employee ID</SortTh>
                <SortTh k="name" sort={uSort} onSort={uToggle} className="py-3.5 px-3">Staff Name</SortTh>
                <SortTh k="position" sort={uSort} onSort={uToggle} className="py-3.5 px-3">Position</SortTh>
                <SortTh k="code" sort={uSort} onSort={uToggle} className="py-3.5 px-3">Branch Code</SortTh>
                <SortTh k="branch" sort={uSort} onSort={uToggle} className="py-3.5 px-3">Branch Name</SortTh>
                <SortTh k="role" sort={uSort} onSort={uToggle} className="py-3.5 px-3">System Role</SortTh>
                <SortTh k="status" sort={uSort} onSort={uToggle} className="py-3.5 px-3">Account Status</SortTh>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody ref={flipRef} className="divide-y divide-slate-200/70 text-xs bg-white">
              {filteredUsers.slice(pg.start, pg.end).map((u, rowIdx) => {
                const isSelected = selectedIds.includes(u.uid);
                const resolvedBranchName =
                  branchNameByCode.get(u.branchId) ||
                  u.branchName ||
                  `Branch ${u.branchId}`;
                return (
                  <tr key={u.uid} data-flip={u.uid} className="hover:bg-slate-50/80">
                    <td className="py-3 px-4">
                      <button
                        onClick={() => toggleSelect(u.uid)}
                        className="cursor-pointer text-slate-400"
                      >
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-zinc-900" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    </td>
                    <td className="py-3 px-2 text-right text-slate-500 tabular-nums">{pg.start + rowIdx + 1}</td>
                    <td className="py-3 px-3 font-mono font-bold text-zinc-900">
                      {u.empId}
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-extrabold text-zinc-900">
                        {u.name}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <span className="text-xs font-semibold text-slate-600">
                        {u.position}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono font-bold text-zinc-900">
                      {u.branchId}
                    </td>
                    <td className="py-3 px-3 font-bold text-zinc-900">
                      {resolvedBranchName}
                    </td>
                    <td className="py-3 px-3">
                      {u.accessRole === 'SUPER_ADMIN' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-black bg-[#003857] text-white shadow-2xs">
                          <ShieldAlert className="w-3 h-3 text-sky-300" /> SUPER ADMIN
                        </span>
                      ) : u.accessRole === 'ADMIN' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-black bg-[#eef5f9] text-[#003857] border border-[#003857]/20">
                          <ShieldCheck className="w-3 h-3 text-[#003857]" /> ADMIN HQ
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                          <Building2 className="w-3 h-3" /> BRANCH STAFF
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-md ${
                          u.status === 'Operating'
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : u.status === 'Pending'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-rose-50 text-rose-700 border border-rose-200'
                        }`}
                      >
                        {u.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right space-x-1.5">
                      {isAdminLike && (
                        <>
                          <button
                            onClick={() => onOpenUserModal(u)}
                            className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-700 cursor-pointer"
                            title="Edit User Role & Branch Code"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          {isSuperAdmin && (
                            <button
                              onClick={() => requestSingleDelete(u)}
                              className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-600 cursor-pointer transition"
                              title="Delete User Account"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredUsers.length === 0 && (
                <tr><td colSpan={10} className="py-10 text-center text-xs text-slate-500">No staff match the search or filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager pg={pg} label="staff" />
      </div>

      {/* Double-Step Deletion Confirmation Modal */}
      <AnimatePresence>
        {deleteConfirm.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDeleteConfirm({ isOpen: false, type: 'SINGLE', userIds: [], userNames: [] })}
              className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              className="relative w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl p-6 z-10"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center shadow-xs">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-extrabold text-zinc-900">
                      Confirm Account Deletion
                    </h3>
                    <p className="text-xs text-slate-500">
                      Step 2 of 2: Final Verification
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDeleteConfirm({ isOpen: false, type: 'SINGLE', userIds: [], userNames: [] })}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-zinc-700 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-3.5 rounded-xl bg-rose-50/60 border border-rose-200/80 text-xs text-rose-900 mb-4">
                <p className="font-bold mb-1">
                  Are you sure you want to delete {deleteConfirm.userIds.length}{' '}
                  user account{deleteConfirm.userIds.length > 1 ? 's' : ''}?
                </p>
                <p className="text-[11px] text-rose-700 leading-relaxed">
                  This will immediately revoke their workstation login and system privileges.
                </p>
                <div className="mt-2.5 max-h-32 overflow-y-auto divide-y divide-rose-200/60 font-mono text-[11px] font-bold">
                  {deleteConfirm.userNames.map((name, i) => (
                    <div key={i} className="py-1 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                      <span className="truncate">{name}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setDeleteConfirm({ isOpen: false, type: 'SINGLE', userIds: [], userNames: [] })}
                  className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleExecuteDelete}
                  className="px-4 py-2 rounded-xl text-xs font-semibold tracking-wide bg-rose-600 hover:bg-rose-700 text-white shadow-md cursor-pointer flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Confirm Permanent Delete</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

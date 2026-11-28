import { ClearFiltersButton } from './ClearFiltersButton';
import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useSort, SortTh } from '../utils/sort';
import { usePager } from '../utils/usePager';
import { Pager } from './Pager';
import { UserCog, Plus, Search, Loader2, KeyRound, ShieldCheck, RefreshCw, MapPin, CheckCircle2, Ban, Trash2, AlertTriangle, X } from 'lucide-react';
import { Branch, UserRole } from '../types';
import { StaffAccount, saveStaffAccount, deleteStaffAccount, OnlineOperatorPresence } from '../services/supabaseService';
import { getCachedStaff, loadStaff, onStaffList, setCachedStaff } from '../services/staffCache';
import { saveStaffAlias } from '../utils/staffUtils';
import { KPI_MANAGEMENT_EXEMPT_EVENT, getManagementExemptStaff, loadManagementList, migrateLegacyManagementList, setManagementLevel } from '../utils/kpiManagementUtils';
import { KpiTeamLead, deleteTeamLead, fetchTeamLeads, saveTeamLead } from '../services/kpiTeamLeadService';
import { onPortalSync } from '../utils/portalSync';

/**
 * Accounts & Access / Staff Directory: sign-in accounts of the inventory dashboard, kept in the database.
 * Policy #21: Includes Location field (all current staff set to "Phnom Penh").
 * Policy #32: Shows live "Online Now" indicator next to staff currently using the system.
 */

const ROLE_LABEL: Record<string, string> = { SUPER_ADMIN: 'Super Admin', ADMIN: 'Admin (HQ)', BRANCH: 'Branch staff' };
/** (28 Nov 2026) KPI role of a staff member, set here instead of Settings -> KPI: Management Level (0 target) and Team lead. */
type KpiRoleForm = { mgmt: boolean; tl: boolean; tlBranches: string[]; tlMembers: string; tlActive: boolean };
const blankKpi: KpiRoleForm = { mgmt: false, tl: false, tlBranches: [], tlMembers: '', tlActive: true };
const idKey = (x: string) => String(x || '').trim().toLowerCase();
const blank = {
  emp_id: '',
  name: '',
  role: 'BRANCH',
  branch_id: '',
  position: '',
  contact: '',
  telegram_username: '',
  location: 'Phnom Penh',
  active: true,
  password: '',
};

function makePassword(): string {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789',
    bytes = new Uint32Array(10);
  crypto.getRandomValues(bytes);
  const s = Array.from(bytes, (n) => a[n % a.length]).join('');
  return s.slice(0, 5) + '-' + s.slice(5) + (/\d/.test(s) ? '' : '7');
}

const STAFF_LOCATION_KEY = 'staff_locations_map_v1';

function loadLocationMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STAFF_LOCATION_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export const StaffAccountsTab: React.FC<{
  role: UserRole;
  branches: Branch[];
  triggerToast: (m: string) => void;
  onlineOperators?: OnlineOperatorPresence[];
  onStaffUpdated?: () => void;
  currentEmpId?: string;
}> = ({ role, branches, triggerToast, onlineOperators = [], onStaffUpdated, currentEmpId }) => {
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const [list, setList] = useState<StaffAccount[] | null>(() => getCachedStaff());   // shown at once; the fresh list replaces it quietly
  const [locationMap, setLocationMap] = useState<Record<string, string>>(loadLocationMap);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ONLINE' | 'OFFLINE' | 'ACTIVE' | 'REVOKED'>('ALL');
  const [form, setForm] = useState<typeof blank | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [shownPassword, setShownPassword] = useState<{ emp: string; pw: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StaffAccount | null>(null);
  const [deleteReason, setDeleteReason] = useState('Staff resigned');
  const [deleting, setDeleting] = useState(false);

  // (28 Nov 2026) KPI roles: Management Level (database list) and Team leads (Team KPI in the Merchant Visit app)
  const [mgmtIds, setMgmtIds] = useState<Set<string>>(() => new Set(getManagementExemptStaff().map((m) => idKey(m.staffId)).filter(Boolean)));
  const [teamLeads, setTeamLeads] = useState<Map<string, KpiTeamLead>>(new Map());
  const [kpiForm, setKpiForm] = useState<KpiRoleForm>(blankKpi);
  const [kpiErr, setKpiErr] = useState('');
  const loadTeamLeads = useCallback(async () => {
    try {
      const rows = await fetchTeamLeads();
      setTeamLeads(new Map(rows.map((t) => [idKey(t.staffId), t])));
      setKpiErr('');
    } catch (e) { setKpiErr(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => {
    if (!isAdmin) return;
    const onMgmt = () => setMgmtIds(new Set(getManagementExemptStaff().map((m) => idKey(m.staffId)).filter(Boolean)));
    window.addEventListener(KPI_MANAGEMENT_EXEMPT_EVENT, onMgmt);
    void loadManagementList().catch((e) => setKpiErr(e instanceof Error ? e.message : String(e)));
    void loadTeamLeads();
    // a browser's old Management list (kept on this computer only before 28 Nov 2026) is copied to the database once
    void migrateLegacyManagementList()
      .then((r) => {
        if (r.copied) triggerToast(`Management Level: ${r.copied} staff copied from this browser to the database.`);
        if (r.skipped.length) triggerToast(`Management Level: set these in the staff form (no Staff ID saved): ${r.skipped.join(', ')}`);
      })
      .catch(() => undefined);
    let timer = 0;
    const unsub = onPortalSync(['kpi'], () => { window.clearTimeout(timer); timer = window.setTimeout(() => { void loadTeamLeads(); }, 600); });
    return () => { window.removeEventListener(KPI_MANAGEMENT_EXEMPT_EVENT, onMgmt); window.clearTimeout(timer); unsub(); };
  }, [isAdmin, loadTeamLeads, triggerToast]);
  const sortedBranches = useMemo(
    () => branches.filter((b) => b.id !== '100').sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true })),
    [branches]
  );
  const kpiOf = useCallback(
    (empId: string): KpiRoleForm => {
      const t = teamLeads.get(idKey(empId));
      return { mgmt: mgmtIds.has(idKey(empId)), tl: !!t, tlBranches: t ? [...t.branchIds] : [], tlMembers: t ? t.memberIds.join(', ') : '', tlActive: t ? t.active : true };
    },
    [mgmtIds, teamLeads]
  );

  const onlineByEmp = useMemo(() => {
    const m = new Map<string, OnlineOperatorPresence>();
    onlineOperators.forEach((op) => {
      const id = (op.empId || op.id || '').trim();
      if (id) {
        m.set(id, op);
        m.set(id.toLowerCase(), op);
      }
      if (op.name) {
        m.set(op.name.trim().toLowerCase(), op);
      }
    });
    return m;
  }, [onlineOperators]);

  const isStaffOnline = useCallback(
    (a: StaffAccount) => {
      const id = String(a.empId || '').trim();
      const name = String(a.name || '').trim().toLowerCase();
      return onlineByEmp.has(id) || onlineByEmp.has(id.toLowerCase()) || onlineByEmp.has(name);
    },
    [onlineByEmp]
  );

  const load = useCallback(async (fresh = false) => {
    const x = await loadStaff({ maxAgeMs: fresh ? 0 : 30000 });   // the list fetched at sign-in is reused for 30 s
    if (!x) {
      setErr('The accounts could not be loaded.');
      return;
    }
    setErr('');
    setList(x);
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => onStaffList(setList), []);   // a fresh list fetched anywhere (e.g. after a save) shows here at once

  const branchNames = useMemo(() => {
    const m = new Map<string, string>();
    branches.forEach((b) => m.set(b.id, b.name));
    return m;
  }, [branches]);
  const branchName = useCallback((id: string) => branchNames.get(id) || 'Branch ' + id, [branchNames]);
  const getLocation = useCallback(
    (a: StaffAccount) => locationMap[a.empId] || a.location || 'Phnom Penh',
    [locationMap]
  );

  const dq = useDeferredValue(q);
  const matched = useMemo(() => {
    const s = dq.trim().toLowerCase();
    return (list || []).filter((a) => {
      if (statusFilter === 'ONLINE' && !isStaffOnline(a)) return false;
      if (statusFilter === 'OFFLINE' && isStaffOnline(a)) return false;
      if (statusFilter === 'ACTIVE' && !a.active) return false;
      if (statusFilter === 'REVOKED' && a.active) return false;
      if (!s) return true;
      const kpiRole = (mgmtIds.has(idKey(a.empId)) ? 'management ' : '') + (teamLeads.has(idKey(a.empId)) ? 'team lead' : '');
      return [a.empId, a.name, a.branchId, branchName(a.branchId), ROLE_LABEL[a.role], getLocation(a), kpiRole].some((v) =>
        String(v).toLowerCase().includes(s)
      );
    });
  }, [list, dq, statusFilter, branchName, getLocation, isStaffOnline, mgmtIds, teamLeads]);

  const { sorted: shown, sort: stSort, toggle: stToggle } = useSort<StaffAccount>(matched, {
    emp: (a) => Number(a.empId) || a.empId,
    name: (a) => a.name,
    // (28 Nov 2026) KPI Role column: Management first, then Team leads, then frontline staff
    kpi: (a) => (mgmtIds.has(idKey(a.empId)) ? 0 : 2) + (teamLeads.has(idKey(a.empId)) ? 0 : 1),
    online: (a) => (isStaffOnline(a) ? 0 : 1),
    role: (a) => ROLE_LABEL[a.role],
    branch: (a) => Number(a.branchId) || a.branchId,
    location: (a) => getLocation(a),
    status: (a) => (a.active ? '1_retained' : '2_revoked'),
  });

  const pg = usePager(shown.length, [dq, stSort]);
  const openEdit = useCallback(
    (a: StaffAccount) => {
      setIsNew(false);
      setFormErr('');
      setForm({
        emp_id: a.empId,
        name: a.name,
        role: a.role,
        branch_id: a.branchId,
        position: a.position || '',
        contact: a.contact || '',
        telegram_username: (a.telegramUsername || '').replace(/^@/, ''),
        location: getLocation(a),
        active: a.active,
        password: '',
      });
      setKpiForm(kpiOf(a.empId));
    },
    [getLocation, kpiOf]
  );

  const roleOptions = role === 'SUPER_ADMIN' ? ['BRANCH', 'ADMIN', 'SUPER_ADMIN'] : ['BRANCH'];
  const canEdit = (a: StaffAccount) => role === 'SUPER_ADMIN' || (role === 'ADMIN' && a.role === 'BRANCH');
  const editingAccount = useMemo(
    () => (!isNew && form ? (list || []).find((x) => x.empId === form.emp_id) || null : null),
    [isNew, form, list]
  );
  const canDeleteEditing = Boolean(
    editingAccount &&
    isAdmin &&
    canEdit(editingAccount) &&
    !(currentEmpId && editingAccount.empId.trim().toLowerCase() === currentEmpId.trim().toLowerCase())
  );

  const handleToggleStatus = useCallback(
    async (a: StaffAccount) => {
      if (!isAdmin || !canEdit(a)) return;
      const nextActive = !a.active;
      const actionText = nextActive ? 'retained' : 'revoked';
      try {
        await saveStaffAccount({
          emp_id: a.empId,
          name: a.name,
          role: a.role,
          branch_id: a.branchId,
          position: a.position || undefined,
          contact: a.contact || undefined,
          telegram_username: a.telegramUsername || undefined,
          location: getLocation(a),
          active: nextActive,
        });
        triggerToast(`Access ${actionText} for ${a.name} (${a.empId}).`);
        if (onStaffUpdated) onStaffUpdated(); else load(true);   // one fresh download, shared
      } catch (err) {
        triggerToast(`Failed to update status: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [isAdmin, canEdit, getLocation, triggerToast, load, onStaffUpdated]
  );

  const handleConfirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const target = deleteTarget;
      await deleteStaffAccount({
        emp_id: target.empId,
        reason: deleteReason.trim() || 'Staff resigned',
      });
      setList((prev) => {
        if (!prev) return prev;
        const next = prev.filter((item) => item.empId !== target.empId);
        setCachedStaff(next);
        return next;
      });
      setLocationMap((prev) => {
        if (!(target.empId in prev)) return prev;
        const next = { ...prev };
        delete next[target.empId];
        try { localStorage.setItem(STAFF_LOCATION_KEY, JSON.stringify(next)); } catch {}
        return next;
      });
      if (form && !isNew && form.emp_id === target.empId) {
        setForm(null);
      }
      setDeleteTarget(null);
      triggerToast(`Deleted user ${target.name} (${target.empId}).`);
      if (onStaffUpdated) onStaffUpdated(); else load(true);
    } catch (err) {
      triggerToast(`Failed to delete user: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeleting(false);
    }
  };

  const save = async () => {
    if (!form) return;
    setFormErr('');
    if (!/^[A-Za-z0-9._-]{2,32}$/.test(form.emp_id.trim())) {
      setFormErr('Employee ID: 2–32 letters or digits.');
      return;
    }
    if (!form.name.trim()) {
      setFormErr('Enter the name.');
      return;
    }
    if (!form.branch_id) {
      setFormErr('Choose the branch.');
      return;
    }
    if (isNew && !form.password) {
      setFormErr('Set a first password (tap "Make one").');
      return;
    }
    if (form.password && form.password.length < 8) {
      setFormErr('The password must be at least 8 characters.');
      return;
    }
    const tlMemberIds = kpiForm.tlMembers.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    if (kpiForm.tl && !kpiForm.tlBranches.length && !tlMemberIds.length) {
      setFormErr('Team lead: choose at least one branch or add a Staff ID to the team.');
      return;
    }
    if (tlMemberIds.some((x) => !/^[A-Za-z0-9._-]{1,40}$/.test(x))) {
      setFormErr('Team lead: the extra Staff IDs must be letters or digits, separated by commas.');
      return;
    }
    setBusy(true);
    try {
      const cleanEmp = form.emp_id.trim();
      const existingAccount = (list || []).find((a) => a.empId.trim().toLowerCase() === cleanEmp.toLowerCase());
      if (existingAccount && existingAccount.name.trim().toLowerCase() !== form.name.trim().toLowerCase()) {
        saveStaffAlias(existingAccount.name.trim(), form.name.trim());
      }
      const cleanLoc = (form.location || 'Phnom Penh').trim();
      await saveStaffAccount({
        emp_id: cleanEmp,
        name: form.name.trim(),
        role: form.role,
        branch_id: form.branch_id,
        position: form.position || undefined,
        contact: form.contact || undefined,
        telegram_username: form.telegram_username ? form.telegram_username.trim().replace(/^@/, '') : undefined,
        location: cleanLoc,
        active: form.active,
        password: form.password || undefined,
      });
      const nextLocMap = { ...locationMap, [cleanEmp]: cleanLoc };
      setLocationMap(nextLocMap);
      try {
        localStorage.setItem(STAFF_LOCATION_KEY, JSON.stringify(nextLocMap));
      } catch {
        // ignore storage errors
      }
      if (form.password) setShownPassword({ emp: cleanEmp, pw: form.password });
      // (28 Nov 2026) KPI role: only what changed is sent
      const before = isNew ? blankKpi : kpiOf(cleanEmp);
      const kpiMsgs: string[] = [];
      try {
        if (before.mgmt !== kpiForm.mgmt) {
          await setManagementLevel([{ staffId: cleanEmp, staffName: form.name.trim(), on: kpiForm.mgmt }]);
          kpiMsgs.push(kpiForm.mgmt ? 'Management Level on' : 'Management Level off');
        }
        const sameList = (x: string[], y: string[]) => x.length === y.length && [...x].sort().join(',') === [...y].sort().join(',');
        const beforeMembers = before.tlMembers.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
        if (kpiForm.tl && (!before.tl || !sameList(before.tlBranches, kpiForm.tlBranches) || !sameList(beforeMembers, tlMemberIds) || before.tlActive !== kpiForm.tlActive
            || (teamLeads.get(idKey(cleanEmp))?.staffName || '') !== form.name.trim())) {
          await saveTeamLead({ staffId: cleanEmp, staffName: form.name.trim(), branchIds: kpiForm.tlBranches, memberIds: tlMemberIds, active: kpiForm.tlActive });
          kpiMsgs.push('Team lead saved');
        } else if (!kpiForm.tl && before.tl) {
          await deleteTeamLead(cleanEmp);
          kpiMsgs.push('Team lead removed');
        }
        if (kpiMsgs.length) await loadTeamLeads();
      } catch (kx) {
        setFormErr(`Account ${cleanEmp} saved, but the KPI role was not saved: ${kx instanceof Error ? kx.message : String(kx)}`);
        setIsNew(false);
        if (onStaffUpdated) onStaffUpdated(); else load(true);
        return;
      }
      triggerToast((isNew ? `Account ${cleanEmp} created` : `Account ${cleanEmp} saved`) + (kpiMsgs.length ? ' · ' + kpiMsgs.join(' · ') : ''));
      setForm(null);
      if (onStaffUpdated) onStaffUpdated(); else load(true);
    } catch (x) {
      setFormErr(x instanceof Error ? x.message : String(x));
    } finally {
      setBusy(false);
    }
  };

  const input =
    'px-2.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold outline-none focus:border-[#002F4A]';
  return (
    <div className="flex flex-col gap-4 apple-tab-panel">
      <section className="relative overflow-hidden rounded-3xl p-6 sm:p-8 border shadow-sm bg-slate-100 border-slate-200/90 text-slate-900" aria-label="Staff accounts header">
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2 max-w-3xl">
            <h1 className="text-2xl sm:text-3xl lg:text-[32px] font-extrabold tracking-tight flex items-center gap-3 text-slate-900 leading-tight">
              <UserCog className="w-7 h-7 sm:w-8 sm:h-8 shrink-0 text-[#002F4A]" aria-hidden />
              <span>
                Staff Accounts
                <span className="text-slate-500 font-semibold text-xl sm:text-2xl lg:text-[26px]"> · Access &amp; Permissions</span>
              </span>
            </h1>
            <p className="text-sm sm:text-base leading-relaxed text-slate-600">
              Institutional staff directory and access governance. Sign-in credentials, operational roles, branch assignments, and authority levels.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/90 inline-flex items-center gap-1.5 shadow-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>{(list || []).filter(isStaffOnline).length || onlineOperators.length || 1} Online Now</span>
              </span>
              <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-200/80 text-slate-700">
                <span>{(list || []).length} Total Accounts</span>
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => load(true)}
              className="btn btn-secondary px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs"
            >
              <RefreshCw className="w-3.5 h-3.5" /> <span>Refresh</span>
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => {
                  setIsNew(true);
                  setForm({ ...blank, password: makePassword() });
                  setKpiForm(blankKpi);
                  setFormErr('');
                }}
                className="btn btn-primary shadow-sm flex items-center gap-1.5 px-4 py-2 text-xs font-bold"
              >
                <Plus className="w-3.5 h-3.5" /> <span>New Account</span>
              </button>
            )}
          </div>
        </div>
      </section>

      {shownPassword && (
        <div
          role="status"
          className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-900 flex flex-wrap items-center gap-3"
        >
          <KeyRound className="w-4 h-4" />
          <span>
            First password for <b>{shownPassword.emp}</b>:{' '}
            <code className="font-mono font-bold bg-white px-1.5 py-0.5 rounded border border-emerald-200">
              {shownPassword.pw}
            </code>{' '}
            – give it to the person directly (not in a group chat). They must change it at their first sign-in.
          </span>
          <button
            type="button"
            onClick={() => setShownPassword(null)}
            className="ml-auto font-bold underline cursor-pointer"
          >
            Done
          </button>
        </div>
      )}

      {form && (
        <div className="bg-white rounded-2xl border border-[#002F4A]/30 p-6 shadow-md flex flex-col gap-3.5">
          <div className="text-sm font-extrabold text-slate-900">
            {isNew ? 'New account' : `Edit ${form.emp_id}`}
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-700">
              Employee ID
              <input
                className={input}
                value={form.emp_id}
                disabled={!isNew}
                onChange={(e) => setForm({ ...form, emp_id: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-700">
              Name
              <input
                className={input}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-700">
              Role
              <select
                className={input}
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                {roleOptions.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-700">
              Branch
              <select
                className={input}
                value={form.branch_id}
                onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
              >
                <option value="">Choose…</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.id} · {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-700">
              Location
              <input
                className={input}
                value={form.location}
                placeholder="Phnom Penh"
                onChange={(e) => setForm({ ...form, location: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-700">
              Position (optional)
              <input
                className={input}
                value={form.position}
                onChange={(e) => setForm({ ...form, position: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-700">
              <span>Telegram Handle <span className="text-[10px] text-sky-600 font-normal">(@mention tag)</span></span>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold">@</span>
                <input
                  className={input + ' pl-7 font-mono w-full'}
                  value={form.telegram_username}
                  placeholder="username"
                  onChange={(e) => setForm({ ...form, telegram_username: e.target.value.replace(/^@/, '') })}
                />
              </div>
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-700 sm:col-span-2 lg:col-span-3">
              {isNew ? 'First password' : 'New password (leave empty to keep)'}
              <div className="flex gap-2">
                <input
                  className={input + ' flex-1 font-mono'}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setForm({ ...form, password: makePassword() })}
                  className="px-2.5 rounded-lg border border-slate-300 text-[11px] font-bold cursor-pointer"
                >
                  Make one
                </button>
              </div>
            </label>
          </div>
          <div className="flex flex-col gap-2 p-3.5 rounded-2xl border border-slate-200 bg-slate-50/70 sm:col-span-2 lg:col-span-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800">Account Access Status (Retain or Revoke)</span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  form.active
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-rose-50 text-rose-700 border-rose-200'
                }`}
              >
                {form.active ? 'Retained (Can sign in & use)' : 'Revoked (Sign-in blocked)'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              Admin can select to retain access (allow user to keep using the system) or revoke access (block user immediately).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-0.5">
              <button
                type="button"
                onClick={() => setForm({ ...form, active: true })}
                className={`p-2.5 rounded-xl border text-left flex items-center gap-2.5 transition cursor-pointer ${
                  form.active
                    ? 'bg-emerald-50 border-emerald-500 text-emerald-900 ring-2 ring-emerald-500/20 font-bold shadow-2xs'
                    : 'bg-white hover:bg-slate-100 border-slate-200 text-slate-600'
                }`}
              >
                <CheckCircle2 className={`w-4 h-4 shrink-0 ${form.active ? 'text-emerald-600' : 'text-slate-400'}`} />
                <div>
                  <div className="text-xs font-bold">Retain Access (Active)</div>
                  <div className="text-[10px] font-normal text-slate-500">Allow user to sign in and keep using</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setForm({ ...form, active: false })}
                className={`p-2.5 rounded-xl border text-left flex items-center gap-2.5 transition cursor-pointer ${
                  !form.active
                    ? 'bg-rose-50 border-rose-500 text-rose-900 ring-2 ring-rose-500/20 font-bold shadow-2xs'
                    : 'bg-white hover:bg-slate-100 border-slate-200 text-slate-600'
                }`}
              >
                <Ban className={`w-4 h-4 shrink-0 ${!form.active ? 'text-rose-600' : 'text-slate-400'}`} />
                <div>
                  <div className="text-xs font-bold">Revoke Access (Revoked)</div>
                  <div className="text-[10px] font-normal text-slate-500">Revoke access &amp; block user from dashboard</div>
                </div>
              </button>
            </div>
          </div>
          {isAdmin && (
            <div className="flex flex-col gap-2.5 p-3.5 rounded-2xl border border-indigo-200/80 bg-indigo-50/30" data-staff-kpi-role>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-800">KPI role</span>
                <span className="text-[10.5px] text-slate-500">Used by the KPI page and the Merchant Visit app (Staff ID {form.emp_id.trim() || '—'})</span>
              </div>
              {kpiErr && <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">{kpiErr}</div>}
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input type="checkbox" className="mt-0.5" checked={kpiForm.mgmt} onChange={(e) => setKpiForm({ ...kpiForm, mgmt: e.target.checked })} data-staff-kpi-mgmt />
                <span>
                  <span className="block text-xs font-bold text-slate-900">Management Level · 0 KPI target, non-mandatory</span>
                  <span className="block text-[11px] text-slate-500">Shown on the KPI page with their figures, but not measured against a target and not ranked as frontline staff.</span>
                </span>
              </label>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input type="checkbox" className="mt-0.5" checked={kpiForm.tl} onChange={(e) => setKpiForm({ ...kpiForm, tl: e.target.checked })} data-staff-kpi-tl />
                <span>
                  <span className="block text-xs font-bold text-slate-900">Team lead · Team KPI in the Merchant Visit app</span>
                  <span className="block text-[11px] text-slate-500">Sees the KPI of the staff in the branches below (More → Team KPI), plus any Staff IDs added by hand.</span>
                </span>
              </label>
              {kpiForm.tl && (
                <div className="flex flex-col gap-2 pl-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-slate-700">Branches ({kpiForm.tlBranches.length})</span>
                    <label className="flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
                      <input type="checkbox" checked={kpiForm.tlActive} onChange={(e) => setKpiForm({ ...kpiForm, tlActive: e.target.checked })} />
                      Team KPI switched on
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto" data-staff-kpi-branches>
                    {sortedBranches.map((b) => {
                      const on = kpiForm.tlBranches.includes(b.id);
                      return (
                        <button key={b.id} type="button" aria-pressed={on}
                          onClick={() => setKpiForm({ ...kpiForm, tlBranches: on ? kpiForm.tlBranches.filter((x) => x !== b.id) : [...kpiForm.tlBranches, b.id] })}
                          className={`px-2 py-1 rounded-lg border text-[11px] cursor-pointer transition ${on ? 'bg-[#002F4A] border-[#002F4A] text-white font-bold' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'}`}>
                          {b.id} · {b.name}
                        </button>
                      );
                    })}
                  </div>
                  <label className="flex flex-col gap-1 text-[11px] font-bold text-slate-700">
                    Extra Staff IDs in the team (optional, separated by commas)
                    <input className={input} value={kpiForm.tlMembers} placeholder="e.g. 20011, 20012" onChange={(e) => setKpiForm({ ...kpiForm, tlMembers: e.target.value })} data-staff-kpi-members />
                  </label>
                </div>
              )}
            </div>
          )}
          {formErr && (
            <div
              role="alert"
              className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2"
            >
              {formErr}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              {!isNew && canDeleteEditing && editingAccount && (
                <button
                  type="button"
                  onClick={() => {
                    setDeleteReason('Staff resigned');
                    setDeleteTarget(editingAccount);
                  }}
                  disabled={busy || deleting}
                  title={`Delete user ${editingAccount.name} (${editingAccount.empId})`}
                  className="px-3.5 py-2 rounded-xl text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 disabled:opacity-60 inline-flex items-center gap-1.5 cursor-pointer transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete User
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setForm(null)}
                className="px-3.5 py-2 rounded-xl text-xs font-bold border border-slate-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={busy}
                className="px-3.5 py-2 rounded-xl text-xs font-extrabold bg-[#eaf4f2] hover:bg-[#d5eae6] text-[#1d5c55] hover:text-[#144741] border border-[#c3e0da] hover:border-[#9fd0c7] disabled:opacity-60 flex items-center gap-1.5 cursor-pointer transition"
              >
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save
              </button>
            </div>
          </div>
        </div>
      )}

      {err && (
        <div
          role="alert"
          className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3"
        >
          {err}
        </div>
      )}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[280px]">
            <div className="relative w-full sm:w-72">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search ID, name, branch, location…"
                aria-label="Search accounts"
                className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 text-xs outline-none focus:border-[#002F4A]"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-normal bg-slate-50 text-slate-800 outline-none focus:border-[#002F4A] cursor-pointer"
            >
              <option value="ALL">All Statuses ({list?.length || 0})</option>
              <option value="ONLINE">Online Now ({(list || []).filter(isStaffOnline).length})</option>
              <option value="OFFLINE">Offline ({(list || []).filter((a) => !isStaffOnline(a)).length})</option>
              <option value="ACTIVE">Retained / Active ({(list || []).filter((a) => a.active).length})</option>
              <option value="REVOKED">Revoked ({(list || []).filter((a) => !a.active).length})</option>
            </select>
            <ClearFiltersButton active={!!q || statusFilter !== 'ALL'} onClear={() => { setQ(''); setStatusFilter('ALL'); }} />
          </div>
        </div>
        {!list && !err && (
          <div className="p-4 flex flex-col gap-2" aria-busy="true" aria-label="Loading accounts">
            {Array.from({ length: 6 }, (_, i) => (
              <div
                key={i}
                className="h-8 rounded-lg bg-slate-100 animate-pulse"
                style={{ opacity: 1 - i * 0.12 }}
              />
            ))}
          </div>
        )}
        <div className="overflow-x-auto overflow-y-hidden">
          <table className="w-full text-xs">
            <thead className="glass-table-thead">
              <tr>
                <th className="text-right px-3 py-2.5 w-10">No.</th>
                <SortTh k="emp" sort={stSort} onSort={stToggle} className="text-left px-3 py-2.5">
                  Employee ID
                </SortTh>
                <SortTh k="name" sort={stSort} onSort={stToggle} className="text-left px-3 py-2.5">
                  Staff Name
                </SortTh>
                <SortTh k="kpi" sort={stSort} onSort={stToggle} className="text-left px-3 py-2.5">
                  KPI Role
                </SortTh>
                <SortTh k="online" sort={stSort} onSort={stToggle} className="text-left px-3 py-2.5">
                  Live Status
                </SortTh>
                <SortTh k="role" sort={stSort} onSort={stToggle} className="text-left px-3 py-2.5">
                  System Role
                </SortTh>
                <SortTh k="branch" sort={stSort} onSort={stToggle} className="text-left px-3 py-2.5">
                  Branch Name &amp; Code
                </SortTh>
                <SortTh k="location" sort={stSort} onSort={stToggle} className="text-left px-3 py-2.5">
                  Location
                </SortTh>
                <SortTh k="status" sort={stSort} onSort={stToggle} align="right" className="text-right px-3 py-2.5">
                  Status &amp; Actions
                </SortTh>
              </tr>
            </thead>
            <tbody>
              {shown.slice(pg.start, pg.drawEnd).map((a, rowIdx) => (
                <StaffRow
                  key={a.userId}
                  a={a}
                  no={pg.start + rowIdx + 1}
                  branchLabel={branchName(a.branchId)}
                  locationLabel={getLocation(a)}
                  onlineInfo={onlineByEmp.get(String(a.empId).trim()) || onlineByEmp.get(a.name.trim().toLowerCase())}
                  editable={isAdmin && canEdit(a)}
                  mgmt={mgmtIds.has(idKey(a.empId))}
                  teamLead={teamLeads.get(idKey(a.empId))}
                  onEdit={openEdit}
                  onToggleStatus={handleToggleStatus}
                />
              ))}
              {list && shown.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-500">
                    No accounts match the search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <Pager pg={pg} label="accounts" />
        </div>
      </div>

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-staff-title"
        >
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 shrink-0">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <h3 id="delete-staff-title" className="text-sm font-bold text-slate-900">
                    Delete Staff Account
                  </h3>
                  <p className="text-[11px] text-slate-500">Permanent user removal</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !deleting && setDeleteTarget(null)}
                disabled={deleting}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
                aria-label="Close delete dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 text-xs space-y-1">
                <div className="font-bold text-slate-900 text-sm">{deleteTarget.name}</div>
                <div className="text-slate-600">
                  Employee ID: <span className="font-mono font-semibold text-slate-800">{deleteTarget.empId}</span>
                </div>
                <div className="text-slate-600">
                  Role: <span className="font-medium text-slate-800">{ROLE_LABEL[deleteTarget.role] || deleteTarget.role}</span>
                  {' · '}
                  Branch: <span className="font-medium text-slate-800">{branchName(deleteTarget.branchId)}</span>
                </div>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed">
                This permanently deletes this staff member&apos;s sign-in credentials and removes them from the Staff Directory. Historical deployments and audit trail records are preserved.
              </p>

              <div>
                <label htmlFor="delete-staff-reason" className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Reason for deletion
                </label>
                <input
                  id="delete-staff-reason"
                  type="text"
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  disabled={deleting}
                  placeholder="Staff resigned"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-400"
                />
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-60 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {deleting ? 'Deleting...' : 'Delete User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const StaffRow = memo(function StaffRow({
  a,
  no,
  branchLabel,
  locationLabel,
  onlineInfo,
  editable,
  mgmt = false,
  teamLead,
  onEdit,
  onToggleStatus,
}: {
  a: StaffAccount;
  mgmt?: boolean;
  teamLead?: KpiTeamLead;
  no: number;
  branchLabel: string;
  locationLabel: string;
  onlineInfo?: OnlineOperatorPresence;
  editable: boolean;
  onEdit: (a: StaffAccount) => void;
  onToggleStatus: (a: StaffAccount) => void;
}) {
  return (
    <tr className="border-t border-slate-100 hover:bg-slate-50/80 transition-colors">
      <td className="px-3 py-2.5 text-right text-slate-500 tabular-nums">{no}</td>
      <td className="px-3 py-2.5 font-mono font-bold text-slate-900">{a.empId}</td>
      <td className="px-3 py-2.5 font-semibold text-slate-900">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{a.name}</span>
          {a.telegramUsername && (
            <span
              title="Configured for Telegram @mention push notifications"
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold bg-sky-50 text-sky-700 border border-sky-200"
            >
              @{a.telegramUsername.replace(/^@/, '')}
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5" data-kpi-role-cell>
        <div className="flex flex-wrap items-center gap-1">
          {mgmt && (
            <span title="Management Level: 0 KPI target, non-mandatory" data-badge-mgmt
              className="inline-flex items-center whitespace-nowrap px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
              Management
            </span>
          )}
          {teamLead && (
            <span title={`Team lead (Team KPI in the Merchant Visit app): branches ${teamLead.branchIds.join(', ') || '—'}${teamLead.memberIds.length ? ` + ${teamLead.memberIds.length} staff` : ''}${teamLead.active ? '' : ' · switched off'}`} data-badge-tl
              className={`inline-flex items-center whitespace-nowrap px-1.5 py-0.5 rounded-md text-[10px] font-bold border ${teamLead.active ? 'bg-[#002F4A]/5 text-[#002F4A] border-[#002F4A]/20' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>
              Team lead · {teamLead.branchIds.length} br.
            </span>
          )}
          {!mgmt && !teamLead && <span className="text-slate-400">—</span>}
        </div>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        {onlineInfo ? (
          <span
            title={`Online now · Viewing ${onlineInfo.activeTab || 'system'}`}
            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Online</span>
          </span>
        ) : (
          <span
            title="Offline (not currently signed in or active)"
            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-medium bg-slate-50 text-slate-400 border border-slate-200"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
            <span>Offline</span>
          </span>
        )}
      </td>
      <td className="px-3 py-2.5">
        {a.role !== 'BRANCH' && <ShieldCheck className="w-3.5 h-3.5 inline mr-1 text-[#002F4A]" />}
        {ROLE_LABEL[a.role]}
      </td>
      <td className="px-3 py-2.5">
        {branchLabel} · {a.branchId}
      </td>
      <td className="px-3 py-2.5">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 font-semibold text-[11px]">
          <MapPin className="w-3 h-3 text-slate-500 dark:text-slate-400" />
          <span>{locationLabel}</span>
        </span>
      </td>
      <td className="px-3 py-2.5 text-right whitespace-nowrap">
        <div className="flex items-center justify-end gap-2.5">
          <div className="inline-flex items-center gap-1.5 text-xs">
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                a.active ? 'bg-emerald-500' : 'bg-rose-500'
              }`}
            />
            <span className={a.active ? 'text-slate-800 font-medium' : 'text-slate-400 font-medium'}>
              {a.active ? 'Retained' : 'Revoked'}
            </span>
            {a.mustChangePassword && (
              <span className="text-[10px] text-slate-400 font-mono">· 1st login</span>
            )}
          </div>

          {editable && (
            <>
              <span className="text-slate-200 select-none">|</span>
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onToggleStatus(a)}
                  title={a.active ? `Revoke access for ${a.name} (${a.empId})` : `Retain access for ${a.name} (${a.empId})`}
                  className="px-2 py-0.5 rounded-md text-[11px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 transition cursor-pointer"
                >
                  {a.active ? 'Revoke' : 'Retain'}
                </button>
                <button
                  type="button"
                  onClick={() => onEdit(a)}
                  className="px-2 py-0.5 rounded-md text-[11px] font-semibold text-[#002F4A] hover:bg-slate-100 border border-slate-200 transition cursor-pointer"
                >
                  Edit
                </button>
              </div>
            </>
          )}
        </div>
      </td>
    </tr>
  );
});

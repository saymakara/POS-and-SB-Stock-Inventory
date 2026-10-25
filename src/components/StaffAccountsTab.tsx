import { ClearFiltersButton } from './ClearFiltersButton';
import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useSort, SortTh } from '../utils/sort';
import { usePager } from '../utils/usePager';
import { Pager } from './Pager';
import { UserCog, Plus, Search, Loader2, KeyRound, ShieldCheck, RefreshCw, MapPin } from 'lucide-react';
import { Branch, UserRole } from '../types';
import { StaffAccount, fetchStaffAccounts, saveStaffAccount, OnlineOperatorPresence } from '../services/supabaseService';
import { saveStaffAlias } from '../utils/staffUtils';

/**
 * Accounts & Access / Staff Directory: sign-in accounts of the inventory dashboard, kept in the database.
 * Policy #21: Includes Location field (all current staff set to "Phnom Penh").
 * Policy #32: Shows live "Online Now" indicator next to staff currently using the system.
 */

const ROLE_LABEL: Record<string, string> = { SUPER_ADMIN: 'Super Admin', ADMIN: 'Admin (HQ)', BRANCH: 'Branch staff' };
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

const STAFF_CACHE_KEY = 'staff_accounts_cache_v2';
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
}> = ({ role, branches, triggerToast, onlineOperators = [], onStaffUpdated }) => {
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const [list, setList] = useState<StaffAccount[] | null>(() => {
    try {
      const c = sessionStorage.getItem(STAFF_CACHE_KEY);
      return c ? JSON.parse(c) : null;
    } catch {
      return null;
    }
  });
  const [locationMap, setLocationMap] = useState<Record<string, string>>(loadLocationMap);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [form, setForm] = useState<typeof blank | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [shownPassword, setShownPassword] = useState<{ emp: string; pw: string } | null>(null);

  const onlineByEmp = useMemo(() => {
    const m = new Map<string, OnlineOperatorPresence>();
    onlineOperators.forEach((op) => {
      if (op.empId) m.set(String(op.empId).trim(), op);
    });
    return m;
  }, [onlineOperators]);

  const load = useCallback(async () => {
    const x = await fetchStaffAccounts(100, 0);
    if (!x) {
      setErr('The accounts could not be loaded.');
      return;
    }
    setErr('');
    setList(x);
    try {
      sessionStorage.setItem(STAFF_CACHE_KEY, JSON.stringify(x));
    } catch {
      /* storage blocked: fine */
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

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
    return (list || []).filter(
      (a) =>
        !s ||
        [a.empId, a.name, a.branchId, branchName(a.branchId), ROLE_LABEL[a.role], getLocation(a)].some((v) =>
          String(v).toLowerCase().includes(s)
        )
    );
  }, [list, dq, branchName, getLocation]);

  const { sorted: shown, sort: stSort, toggle: stToggle } = useSort<StaffAccount>(matched, {
    emp: (a) => Number(a.empId) || a.empId,
    name: (a) => a.name,
    role: (a) => ROLE_LABEL[a.role],
    branch: (a) => Number(a.branchId) || a.branchId,
    location: (a) => getLocation(a),
    status: (a) => (a.active ? (a.mustChangePassword ? 'Active · first password' : 'Active') : 'Off'),
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
    },
    [getLocation]
  );

  const roleOptions = role === 'SUPER_ADMIN' ? ['BRANCH', 'ADMIN', 'SUPER_ADMIN'] : ['BRANCH'];
  const canEdit = (a: StaffAccount) => role === 'SUPER_ADMIN' || (role === 'ADMIN' && a.role === 'BRANCH');

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
      triggerToast(isNew ? `Account ${cleanEmp} created` : `Account ${cleanEmp} saved`);
      setForm(null);
      load();
      if (onStaffUpdated) onStaffUpdated();
    } catch (x) {
      setFormErr(x instanceof Error ? x.message : String(x));
    } finally {
      setBusy(false);
    }
  };

  const input =
    'px-2.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold outline-none focus:border-[#003857]';
  return (
    <div className="flex flex-col gap-4 apple-tab-panel">
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#003857] text-white flex items-center justify-center shrink-0">
            <UserCog className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-extrabold text-slate-900">Staff Directory &amp; Access</h2>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>{onlineOperators.length || 1} Online Now</span>
              </span>
            </div>
            <p className="text-xs text-slate-600 max-w-2xl mt-0.5">
              Who can sign in to this dashboard. Sign-in is the Employee ID and a password; the role, branch, and
              location decide what each person can see and change.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={load}
            className="px-3 py-2 rounded-xl text-xs font-bold border border-slate-200 bg-slate-50 hover:bg-slate-100 flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                setIsNew(true);
                setForm({ ...blank, password: makePassword() });
                setFormErr('');
              }}
              className="px-3 py-2 rounded-xl text-xs font-extrabold bg-[#003857] hover:bg-[#002a42] text-white flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> New account
            </button>
          )}
        </div>
      </div>

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
        <div className="bg-white rounded-2xl border border-[#003857]/30 p-6 shadow-md flex flex-col gap-3.5">
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
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />{' '}
            Active (can sign in)
          </label>
          {formErr && (
            <div
              role="alert"
              className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2"
            >
              {formErr}
            </div>
          )}
          <div className="flex justify-end gap-2">
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
              className="px-3.5 py-2 rounded-xl text-xs font-extrabold bg-[#003857] text-white disabled:opacity-60 flex items-center gap-1.5 cursor-pointer"
            >
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save
            </button>
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
        <div className="p-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search ID, name, branch, location…"
              aria-label="Search accounts"
              className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 text-xs outline-none focus:border-[#003857]"
            />
          </div>
          <ClearFiltersButton active={!!q} onClear={() => setQ('')} />
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
        <div className="overflow-x-auto">
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
                <SortTh k="role" sort={stSort} onSort={stToggle} className="text-left px-3 py-2.5">
                  System Role
                </SortTh>
                <SortTh k="branch" sort={stSort} onSort={stToggle} className="text-left px-3 py-2.5">
                  Branch Code &amp; Name
                </SortTh>
                <SortTh k="location" sort={stSort} onSort={stToggle} className="text-left px-3 py-2.5">
                  Location
                </SortTh>
                <SortTh k="status" sort={stSort} onSort={stToggle} className="text-left px-3 py-2.5">
                  Account Status
                </SortTh>
                <th className="px-3 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(pg.start, pg.end).map((a, rowIdx) => (
                <StaffRow
                  key={a.userId}
                  a={a}
                  no={pg.start + rowIdx + 1}
                  branchLabel={branchName(a.branchId)}
                  locationLabel={getLocation(a)}
                  onlineInfo={onlineByEmp.get(String(a.empId).trim())}
                  editable={isAdmin && canEdit(a)}
                  onEdit={openEdit}
                />
              ))}
              {list && shown.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    No accounts match the search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <Pager pg={pg} label="accounts" />
        </div>
      </div>
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
  onEdit,
}: {
  a: StaffAccount;
  no: number;
  branchLabel: string;
  locationLabel: string;
  onlineInfo?: OnlineOperatorPresence;
  editable: boolean;
  onEdit: (a: StaffAccount) => void;
}) {
  return (
    <tr className="border-t border-slate-100 hover:bg-slate-50/80 transition-colors">
      <td className="px-3 py-2.5 text-right text-slate-500 tabular-nums">{no}</td>
      <td className="px-3 py-2.5 font-mono font-bold text-slate-900">{a.empId}</td>
      <td className="px-3 py-2.5 font-semibold text-slate-900">
        <div className="flex items-center gap-2">
          <span>{a.name}</span>
          {a.telegramUsername && (
            <span
              title="Configured for Telegram @mention push notifications"
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold bg-sky-50 text-sky-700 border border-sky-200"
            >
              @{a.telegramUsername.replace(/^@/, '')}
            </span>
          )}
          {onlineInfo && (
            <span
              title={`Online now · Viewing ${onlineInfo.activeTab}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>Online</span>
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5">
        {a.role !== 'BRANCH' && <ShieldCheck className="w-3.5 h-3.5 inline mr-1 text-[#003857]" />}
        {ROLE_LABEL[a.role]}
      </td>
      <td className="px-3 py-2.5">
        {a.branchId} · {branchLabel}
      </td>
      <td className="px-3 py-2.5">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-50 text-sky-800 border border-sky-200 font-semibold text-[11px]">
          <MapPin className="w-3 h-3 text-sky-600" />
          <span>{locationLabel}</span>
        </span>
      </td>
      <td className="px-3 py-2.5">
        {a.active ? (
          a.mustChangePassword ? (
            'Active · first password'
          ) : (
            <span className="text-emerald-700 font-bold">Active</span>
          )
        ) : (
          <span className="text-rose-700 font-bold">Off</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right">
        {editable && (
          <button
            type="button"
            onClick={() => onEdit(a)}
            className="text-[11px] font-bold text-[#003857] hover:underline cursor-pointer"
          >
            Edit
          </button>
        )}
      </td>
    </tr>
  );
});

import { ClearFiltersButton } from './ClearFiltersButton';
import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useSort, SortTh } from '../utils/sort';
import { usePager } from '../utils/usePager';
import { Pager } from './Pager';
import { UserCog, Plus, Search, Loader2, KeyRound, ShieldCheck, RefreshCw } from 'lucide-react';
import { Branch, UserRole } from '../types';
import { StaffAccount, fetchStaffAccounts, saveStaffAccount } from '../services/supabaseService';

/**
 * Accounts & Access (21 Oct 2026): sign-in accounts of the inventory dashboard, kept in the database.
 * Super Admin: any account and role. Admin: branch staff accounts only. Nobody can change their own role or switch
 * off their own account, and at least one active Super Admin always remains (checked by the database).
 * A new or reset password is a first password: the person must choose their own at the next sign-in.
 */

const ROLE_LABEL: Record<string, string> = { SUPER_ADMIN: 'Super Admin', ADMIN: 'Admin (HQ)', BRANCH: 'Branch staff' };
const blank = { emp_id: '', name: '', role: 'BRANCH', branch_id: '', position: '', contact: '', active: true, password: '' };

function makePassword(): string {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', bytes = new Uint32Array(10);
  crypto.getRandomValues(bytes);
  const s = Array.from(bytes, (n) => a[n % a.length]).join('');
  return s.slice(0, 5) + '-' + s.slice(5) + (/\d/.test(s) ? '' : '7');
}

const STAFF_CACHE_KEY = 'staff_accounts_cache_v1';                 // shown at once on the next visit, cleared at sign-out

export const StaffAccountsTab: React.FC<{ role: UserRole; branches: Branch[]; triggerToast: (m: string) => void }> = ({ role, branches, triggerToast }) => {
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  // the last list is shown at once while the fresh one loads (no empty screen, no waiting)
  const [list, setList] = useState<StaffAccount[] | null>(() => { try { const c = sessionStorage.getItem(STAFF_CACHE_KEY); return c ? JSON.parse(c) : null; } catch { return null; } });
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [form, setForm] = useState<typeof blank | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [shownPassword, setShownPassword] = useState<{ emp: string; pw: string } | null>(null);

  const load = useCallback(async () => {
    const x = await fetchStaffAccounts(100, 0);
    if (!x) { setErr('The accounts could not be loaded.'); return; }
    setErr(''); setList(x);
    try { sessionStorage.setItem(STAFF_CACHE_KEY, JSON.stringify(x)); } catch { /* storage blocked: fine */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const branchNames = useMemo(() => { const m = new Map<string, string>(); branches.forEach((b) => m.set(b.id, b.name)); return m; }, [branches]);
  const branchName = useCallback((id: string) => branchNames.get(id) || 'Branch ' + id, [branchNames]);
  const dq = useDeferredValue(q);                                      // typing stays instant; the list follows
  const matched = useMemo(() => {
    const s = dq.trim().toLowerCase();
    return (list || []).filter((a) => !s || [a.empId, a.name, a.branchId, branchName(a.branchId), ROLE_LABEL[a.role]].some((v) => String(v).toLowerCase().includes(s)));
  }, [list, dq, branchName]);
  const { sorted: shown, sort: stSort, toggle: stToggle } = useSort<StaffAccount>(matched, {
    emp: (a) => Number(a.empId) || a.empId, name: (a) => a.name, role: (a) => ROLE_LABEL[a.role], branch: (a) => Number(a.branchId) || a.branchId,
    status: (a) => (a.active ? (a.mustChangePassword ? 'Active · first password' : 'Active') : 'Off'),
  });
  // the first rows appear at once; the rest are added as the list is scrolled
  const pg = usePager(shown.length, [dq, stSort]);
  const openEdit = useCallback((a: StaffAccount) => {
    setIsNew(false); setFormErr('');
    setForm({ emp_id: a.empId, name: a.name, role: a.role, branch_id: a.branchId, position: a.position || '', contact: a.contact || '', active: a.active, password: '' });
  }, []);

  const roleOptions = role === 'SUPER_ADMIN' ? ['BRANCH', 'ADMIN', 'SUPER_ADMIN'] : ['BRANCH'];
  const canEdit = (a: StaffAccount) => role === 'SUPER_ADMIN' || (role === 'ADMIN' && a.role === 'BRANCH');

  const save = async () => {
    if (!form) return;
    setFormErr('');
    if (!/^[A-Za-z0-9._-]{2,32}$/.test(form.emp_id.trim())) { setFormErr('Employee ID: 2–32 letters or digits.'); return; }
    if (!form.name.trim()) { setFormErr('Enter the name.'); return; }
    if (!form.branch_id) { setFormErr('Choose the branch.'); return; }
    if (isNew && !form.password) { setFormErr('Set a first password (tap "Make one").'); return; }
    if (form.password && form.password.length < 8) { setFormErr('The password must be at least 8 characters.'); return; }
    setBusy(true);
    try {
      await saveStaffAccount({ emp_id: form.emp_id.trim(), name: form.name.trim(), role: form.role, branch_id: form.branch_id, position: form.position || undefined,
        contact: form.contact || undefined, active: form.active, password: form.password || undefined });
      if (form.password) setShownPassword({ emp: form.emp_id.trim(), pw: form.password });
      triggerToast(isNew ? `Account ${form.emp_id.trim()} created` : `Account ${form.emp_id.trim()} saved`);
      setForm(null);
      load();
    } catch (x) {
      setFormErr(x instanceof Error ? x.message : String(x));
    } finally { setBusy(false); }
  };

  const input = 'px-2.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold outline-none focus:border-[#003857]';
  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#003857] text-white flex items-center justify-center shrink-0"><UserCog className="w-5 h-5" /></div>
          <div>
            <h2 className="text-lg font-extrabold text-slate-900">Accounts &amp; Access</h2>
            <p className="text-xs text-slate-600 max-w-2xl">Who can sign in to this dashboard. Sign-in is the Employee ID and a password; the role and branch decide what each person can see and change.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={load} className="px-3 py-2 rounded-xl text-xs font-bold border border-slate-200 bg-slate-50 hover:bg-slate-100 flex items-center gap-1.5 cursor-pointer"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
          {isAdmin && (
            <button type="button" onClick={() => { setIsNew(true); setForm({ ...blank, password: makePassword() }); setFormErr(''); }}
              className="px-3 py-2 rounded-xl text-xs font-extrabold bg-[#003857] hover:bg-[#002a42] text-white flex items-center gap-1.5 cursor-pointer"><Plus className="w-3.5 h-3.5" /> New account</button>
          )}
        </div>
      </div>

      {shownPassword && (
        <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-900 flex flex-wrap items-center gap-3">
          <KeyRound className="w-4 h-4" />
          <span>First password for <b>{shownPassword.emp}</b>: <code className="font-mono font-bold bg-white px-1.5 py-0.5 rounded border border-emerald-200">{shownPassword.pw}</code> – give it to the person directly (not in a group chat). They must change it at their first sign-in.</span>
          <button type="button" onClick={() => setShownPassword(null)} className="ml-auto font-bold underline cursor-pointer">Done</button>
        </div>
      )}

      {form && (
        <div className="bg-white rounded-2xl border border-[#003857]/30 p-5 shadow-xs flex flex-col gap-3">
          <div className="text-sm font-extrabold text-slate-900">{isNew ? 'New account' : `Edit ${form.emp_id}`}</div>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-700">Employee ID
              <input className={input} value={form.emp_id} disabled={!isNew} onChange={(e) => setForm({ ...form, emp_id: e.target.value })} /></label>
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-700">Name
              <input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-700">Role
              <select className={input} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {roleOptions.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select></label>
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-700">Branch
              <select className={input} value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
                <option value="">Choose…</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.id} · {b.name}</option>)}
              </select></label>
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-700">Position (optional)
              <input className={input} value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} /></label>
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-700">{isNew ? 'First password' : 'New password (leave empty to keep)'}
              <div className="flex gap-2">
                <input className={input + ' flex-1 font-mono'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
                <button type="button" onClick={() => setForm({ ...form, password: makePassword() })} className="px-2.5 rounded-lg border border-slate-300 text-[11px] font-bold cursor-pointer">Make one</button>
              </div></label>
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active (can sign in)
          </label>
          {formErr && <div role="alert" className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{formErr}</div>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setForm(null)} className="px-3.5 py-2 rounded-xl text-xs font-bold border border-slate-200 cursor-pointer">Cancel</button>
            <button type="button" onClick={save} disabled={busy} className="px-3.5 py-2 rounded-xl text-xs font-extrabold bg-[#003857] text-white disabled:opacity-60 flex items-center gap-1.5 cursor-pointer">
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save
            </button>
          </div>
        </div>
      )}

      {err && <div role="alert" className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">{err}</div>}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ID, name, branch…" aria-label="Search accounts" className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 text-xs outline-none focus:border-[#003857]" />
          </div>
          <ClearFiltersButton active={!!q} onClear={() => setQ('')} />
        </div>
        {!list && !err && (
          <div className="p-4 flex flex-col gap-2" aria-busy="true" aria-label="Loading accounts">
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-8 rounded-lg bg-slate-100 animate-pulse" style={{ opacity: 1 - i * 0.12 }} />)}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="glass-table-thead">
              <tr><th className="text-right px-3 py-2 w-10">No.</th>
                <SortTh k="emp" sort={stSort} onSort={stToggle} className="text-left px-3 py-2">Employee ID</SortTh>
                <SortTh k="name" sort={stSort} onSort={stToggle} className="text-left px-3 py-2">Staff Name</SortTh>
                <SortTh k="role" sort={stSort} onSort={stToggle} className="text-left px-3 py-2">System Role</SortTh>
                <SortTh k="branch" sort={stSort} onSort={stToggle} className="text-left px-3 py-2">Branch Code &amp; Name</SortTh>
                <SortTh k="status" sort={stSort} onSort={stToggle} className="text-left px-3 py-2">Account Status</SortTh>
                <th className="px-3 py-2 text-right">Actions</th></tr>
            </thead>
            <tbody>
              {shown.slice(pg.start, pg.end).map((a, rowIdx) => (
                <StaffRow key={a.userId} a={a} no={pg.start + rowIdx + 1} branchLabel={branchName(a.branchId)} editable={isAdmin && canEdit(a)} onEdit={openEdit} />
              ))}
              {list && shown.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-slate-500">No accounts match the search.</td></tr>}
            </tbody>
          </table>
          <Pager pg={pg} label="accounts" />
        </div>
      </div>
    </div>
  );
};

/** One account line. Drawn again only when its own data changes, so typing, sorting and scrolling stay quick. */
const StaffRow = memo(function StaffRow({ a, no, branchLabel, editable, onEdit }: { a: StaffAccount; no: number; branchLabel: string; editable: boolean; onEdit: (a: StaffAccount) => void }) {
  return (
    <tr className="border-t border-slate-100 hover:bg-slate-50/80 transition-colors">
      <td className="px-3 py-2 text-right text-slate-500 tabular-nums">{no}</td>
      <td className="px-3 py-2 font-mono font-bold">{a.empId}</td>
      <td className="px-3 py-2 font-semibold text-slate-800">{a.name}</td>
      <td className="px-3 py-2">{a.role !== 'BRANCH' && <ShieldCheck className="w-3.5 h-3.5 inline mr-1 text-[#003857]" />}{ROLE_LABEL[a.role]}</td>
      <td className="px-3 py-2">{a.branchId} · {branchLabel}</td>
      <td className="px-3 py-2">{a.active ? (a.mustChangePassword ? 'Active · first password' : 'Active') : <span className="text-rose-700 font-bold">Off</span>}</td>
      <td className="px-3 py-2 text-right">
        {editable && <button type="button" onClick={() => onEdit(a)} className="text-[11px] font-bold text-[#003857] hover:underline cursor-pointer">Edit</button>}
      </td>
    </tr>
  );
});

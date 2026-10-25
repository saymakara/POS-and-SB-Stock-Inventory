import React, { useCallback, useEffect, useState } from 'react';
import { Lock, Eye, EyeOff, ArrowRight, KeyRound, AlertTriangle, Loader2 } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { AppBrandLogo } from './AppBrandLogo';

/**
 * Sign-in with the shared database (21 Oct 2026).
 * Staff sign in with their Employee ID and password (accounts are made by an admin in Accounts & Access).
 * The role and branch come from the database – never from the browser – and the database's access rules decide what
 * each person can see and change. A first password must be changed at the first sign-in.
 * When the database is not configured (local preview), the app runs as before.
 */

export interface StaffProfile {
  user_id: string;
  emp_id: string;
  name: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'BRANCH';
  branch_id: string;
  position: string | null;
  active: boolean;
  must_change_password: boolean;
}

const LOGIN_DOMAIN = '@staff.pos-sb-inventory.internal';
export const loginEmail = (empId: string) => empId.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '') + LOGIN_DOMAIN;

// the app keeps the signed-in person here (read once when it starts)
const SESSION_KEY = 'crm_pos_auth_session_v20';
const LAST_USER_KEY = 'crm_pos_last_user_v1';
// cached data of the person signed in before (a shared PC must never show it to the next person)
const CACHE_KEYS = ['crm_pos_devices_v20', 'crm_pos_reqs_v20', 'crm_pos_historical_merchants_v20', 'crm_pos_logs_v20', 'crm_pos_mobile_webhooks_v20',
  'crm_pos_notifs_v20', 'crm_pos_users_v20', 'crm_pos_branches_v20'];

export function clearLocalCaches(): void {
  try {
    CACHE_KEYS.forEach((k) => localStorage.removeItem(k));
    sessionStorage.clear();                                              // (review) also the staff list and screen caches
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage blocked */
  }
  try {
    indexedDB.deleteDatabase('pos_sb_stock_inventory_db');
  } catch {
    /* not available */
  }
}

export async function signOutEverywhere(): Promise<void> {
  clearLocalCaches();
  try {
    await supabase.auth.signOut();
  } catch {
    /* offline: the local session is gone anyway */
  }
  window.location.reload();
}

/** The staff profile; 'offline' when the server could not be reached (not the same as "no account"). */
async function loadProfile(userId: string): Promise<StaffProfile | null | 'offline'> {
  try {
    const { data, error } = await supabase.from('staff_profiles').select('*').eq('user_id', userId).maybeSingle();
    if (error) return 'offline';
    return (data as StaffProfile) || null;
  } catch {
    return 'offline';
  }
}

function storeSession(p: StaffProfile) {
  try {
    const last = localStorage.getItem(LAST_USER_KEY);
    if (last && last !== p.user_id) clearLocalCaches();          // another person on this browser: nothing of theirs stays
    localStorage.setItem(LAST_USER_KEY, p.user_id);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ role: p.role, operatorLabel: `${p.name} (${p.emp_id})`, branchId: p.branch_id, username: p.emp_id }));
    sessionStorage.setItem('crm_pos_staff_profile_v1', JSON.stringify(p));
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage blocked: the app still starts from the database */
  }
}

type Phase = 'checking' | 'signin' | 'change' | 'ready';

export const AuthGate: React.FC<{ children: (profile: StaffProfile | null) => React.ReactNode }> = ({ children }) => {
  const cachedInitialProfile = React.useMemo<StaffProfile | null>(() => {
    try {
      const raw = sessionStorage.getItem('crm_pos_staff_profile_v1');
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StaffProfile;
      return parsed && parsed.active && !parsed.must_change_password ? parsed : null;
    } catch {
      return null;
    }
  }, []);
  const [phase, setPhase] = useState<Phase>(!isSupabaseConfigured || cachedInitialProfile ? 'ready' : 'checking');
  const [profile, setProfile] = useState<StaffProfile | null>(cachedInitialProfile);
  const [empId, setEmpId] = useState('');
  const [password, setPassword] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const enter = useCallback(async (userId: string) => {
    const p = await loadProfile(userId);
    if (p === 'offline') {
      setError('No connection to the server. Please check the internet and try again.');
      setPhase('signin');
      return;
    }
    if (!p || !p.active) {
      await supabase.auth.signOut();
      setError(p ? 'This account is not active. Please contact your admin.' : 'No staff account is linked to this sign-in. Please contact your admin.');
      setPhase('signin');
      return;
    }
    setProfile(p);
    if (p.must_change_password) { setPhase('change'); return; }
    storeSession(p);
    setPhase('ready');
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      if (data.session?.user) enter(data.session.user.id);
      else { clearLocalCaches(); setPhase('signin'); }
    }).catch(() => alive && setPhase('signin'));
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') { clearLocalCaches(); setProfile(null); setPhase('signin'); }
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [enter]);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!empId.trim() || !password) { setError('Please enter your Employee ID and password.'); return; }
    setBusy(true);
    try {
      const { data, error: err } = await supabase.auth.signInWithPassword({ email: loginEmail(empId), password });
      if (err || !data.user) {
        setError(/invalid/i.test(err?.message || '') ? 'Employee ID or password is not correct.' : err?.message || 'Sign-in failed. Please try again.');
        return;
      }
      setPassword('');
      await enter(data.user.id);
    } catch {
      setError('No connection to the server. Please check the internet and try again.');
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !profile) return;
    setError('');
    if (newPw.length < 8) { setError('The new password must be at least 8 characters.'); return; }
    if (!/[A-Za-z]/.test(newPw) || !/\d/.test(newPw)) { setError('Use letters and digits in the new password.'); return; }
    if (newPw !== newPw2) { setError('The two passwords are not the same.'); return; }
    if (newPw.toLowerCase().includes(profile.emp_id.toLowerCase())) { setError('The password must not contain your Employee ID.'); return; }
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password: newPw });
      if (err) { setError(err.message); return; }
      const { error: err2 } = await supabase.rpc('password_changed');
      if (err2) { setError(err2.message); return; }
      setNewPw(''); setNewPw2('');
      const p = { ...profile, must_change_password: false };
      setProfile(p);
      storeSession(p);
      setPhase('ready');
    } catch {
      setError('No connection to the server, so the change may not be complete. Please try again (if your new password is already active, use it as the current one).');
    } finally {
      setBusy(false);
    }
  };

  if (phase === 'ready') return <>{children(profile)}</>;

  const card = 'w-full max-w-sm bg-white rounded-3xl border border-slate-200 shadow-xl p-7';
  const input = 'w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 outline-none focus:border-[#003857] focus:ring-2 focus:ring-[#003857]/15';
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-gradient-to-br from-slate-50 via-white to-slate-100">
      <div className={card}>
        <div className="flex items-center gap-3 mb-6">
          <AppBrandLogo presetId="merchant-store" size="lg" />
          <div>
            <div className="text-base font-extrabold text-slate-900 leading-tight">POS &amp; Sound Box Stock Inventory</div>
            <div className="text-xs text-slate-500 font-semibold">Merchant Support · Head Office</div>
          </div>
        </div>
        {phase === 'checking' && (
          <div className="flex items-center gap-2 text-sm text-slate-500 py-6 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Checking your session…</div>
        )}
        {phase === 'signin' && (
          <form onSubmit={signIn} className="flex flex-col gap-3.5" noValidate>
            <div>
              <label htmlFor="empId" className="block text-xs font-bold text-slate-700 mb-1">Employee ID</label>
              <input id="empId" className={input} value={empId} onChange={(e) => setEmpId(e.target.value)} autoComplete="username" inputMode="text" autoFocus />
            </div>
            <div>
              <label htmlFor="pw" className="block text-xs font-bold text-slate-700 mb-1">Password</label>
              <div className="relative">
                <input id="pw" className={input + ' pr-10'} type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
                <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer">
                  {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {error && <div role="alert" className="flex gap-2 items-start text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2"><AlertTriangle className="w-4 h-4 shrink-0" />{error}</div>}
            <button type="submit" disabled={busy} className="mt-1 w-full py-2.5 rounded-xl bg-[#003857] hover:bg-[#002a42] disabled:opacity-60 text-white text-sm font-extrabold flex items-center justify-center gap-2 cursor-pointer">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />} Sign in {!busy && <ArrowRight className="w-4 h-4" />}
            </button>
            <p className="text-[11px] text-slate-500 leading-snug">Forgot your password? Ask your admin to set a new one in Accounts &amp; Access.</p>
          </form>
        )}
        {phase === 'change' && profile && (
          <form onSubmit={changePassword} className="flex flex-col gap-3.5" noValidate>
            <div className="flex items-start gap-2 text-sm text-slate-700"><KeyRound className="w-4 h-4 mt-0.5 text-[#003857]" />
              <span>Welcome, <b>{profile.name}</b>. Please choose your own password before you continue.</span></div>
            <div>
              <label htmlFor="npw" className="block text-xs font-bold text-slate-700 mb-1">New password</label>
              <input id="npw" className={input} type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" autoFocus />
              <p className="text-[11px] text-slate-500 mt-1">At least 8 characters, with letters and digits.</p>
            </div>
            <div>
              <label htmlFor="npw2" className="block text-xs font-bold text-slate-700 mb-1">New password again</label>
              <input id="npw2" className={input} type="password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} autoComplete="new-password" />
            </div>
            {error && <div role="alert" className="flex gap-2 items-start text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2"><AlertTriangle className="w-4 h-4 shrink-0" />{error}</div>}
            <button type="submit" disabled={busy} className="w-full py-2.5 rounded-xl bg-[#003857] hover:bg-[#002a42] disabled:opacity-60 text-white text-sm font-extrabold cursor-pointer">
              {busy ? 'Saving…' : 'Save password and continue'}
            </button>
            <button type="button" onClick={() => signOutEverywhere()} className="text-xs font-bold text-slate-500 hover:text-slate-800 cursor-pointer">Sign out</button>
          </form>
        )}
      </div>
    </div>
  );
};

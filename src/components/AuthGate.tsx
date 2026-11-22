import React, { useCallback, useEffect, useState } from 'react';
import { Lock, Eye, EyeOff, ArrowRight, KeyRound, AlertTriangle, Loader2 } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { AppBrandLogo } from './AppBrandLogo';
import { clearKeptMemos } from '../utils/useKeptMemo';
import { clearCcCache } from '../services/ccService';
import { clearMvCache } from '../services/mvCache';
import { clearFresh } from '../utils/freshness';
import { clearWorkstationLock, notifySessionSignOut } from '../utils/sessionSecurity';
import { forgetSavedCopies } from '../utils/idbStorage';
import { markNavigationTransition } from '../utils/perfMonitor';

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
    localStorage.removeItem('crm_pos_staff_profile_v1');
  } catch {
    /* storage blocked */
  }
  try {
    indexedDB.deleteDatabase('pos_sb_stock_inventory_db');
    forgetSavedCopies();
  } catch {
    /* not available */
  }
  clearKeptMemos();
  clearCcCache();
  clearMvCache();
  clearFresh();
  clearWorkstationLock();                                                     // (31 Oct 2026) results kept in memory between screens
}

export async function signOutEverywhere(): Promise<void> {
  clearLocalCaches();
  notifySessionSignOut();
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
    const serializedProfile = JSON.stringify(p);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ role: p.role, operatorLabel: `${p.name} (${p.emp_id})`, branchId: p.branch_id, username: p.emp_id }));
    sessionStorage.setItem('crm_pos_staff_profile_v1', serializedProfile);
    localStorage.setItem('crm_pos_staff_profile_v1', serializedProfile);
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage blocked: the app still starts from the database */
  }
}

type Phase = 'checking' | 'signin' | 'change' | 'ready';

export const AuthGate: React.FC<{ children: (profile: StaffProfile | null) => React.ReactNode }> = ({ children }) => {
  const cachedInitialProfile = React.useMemo<StaffProfile | null>(() => {
    try {
      const raw = sessionStorage.getItem('crm_pos_staff_profile_v1') || localStorage.getItem('crm_pos_staff_profile_v1');
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

  const enter = useCallback(async (userId: string, fromSignIn = false) => {
    const p = await loadProfile(userId);
    if (p === 'offline') {
      setError('No connection to the server. Please check the internet and try again.');
      setPhase('signin');
      return;
    }
    if (!p || !p.active) {
      await supabase.auth.signOut();
      setError(p ? 'This account access has been revoked. Please contact your admin.' : 'No staff account is linked to this sign-in. Please contact your admin.');
      setPhase('signin');
      return;
    }
    setProfile(p);
    if (p.must_change_password) { setPhase('change'); return; }
    storeSession(p);
    markNavigationTransition(fromSignIn);
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

  // (20 Nov 2026) The sign-in kept by this browser can disappear without a "signed out" notice in this tab: another tab
  // or another page on the same github.io address cleared it, or the browser's site data was cleared. On 20 Nov the
  // pages then stayed on "Loading…" for 5 minutes while every request was refused as "not signed in". The portal now
  // checks when that storage changes, when the tab comes back into view, and once a minute (no server call: the sign-in
  // is read from this browser), and goes back to the sign-in page.
  useEffect(() => {
    if (!isSupabaseConfigured || phase !== 'ready') return;
    let alive = true;
    const check = () => {
      supabase.auth.getSession().then(({ data }) => {
        if (!alive || data.session) return;
        clearLocalCaches();
        setProfile(null);
        setError('You were signed out on this browser. Please sign in again.');
        setPhase('signin');
      }).catch(() => { /* cannot tell: keep the page */ });
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || (/^sb-.+-auth-token$/.test(e.key) && e.newValue === null)) check();
    };
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const timer = window.setInterval(check, 60_000);
    return () => {
      alive = false;
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.clearInterval(timer);
    };
  }, [phase]);

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
      clearWorkstationLock();
      await enter(data.user.id, true);
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

  const card = 'relative z-10 w-full max-w-[380px] bg-white rounded-3xl border border-slate-200/90 shadow-[0_20px_46px_rgba(15,23,42,0.07),0_4px_12px_rgba(15,23,42,0.03)] p-7';
  const input = 'w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 outline-none transition-colors focus:border-[#003857] focus:ring-2 focus:ring-[#003857]/15';
  return (
    <div
      className="relative min-h-screen flex items-center justify-center px-4 py-10 overflow-hidden"
      style={{ background: 'radial-gradient(circle at 50% 45%, #ffffff 0%, #eff2f6 65%, #e3e8ef 100%)' }}
    >
      {/* M6-2 Pure Platinum Monochrome Fold */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <svg viewBox="0 0 1440 720" preserveAspectRatio="none" className="w-full h-full block" fill="none">
          <defs>
            <linearGradient id="authgate-platinum-fold" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity={0.85} />
              <stop offset="100%" stopColor="#cbd5e1" stopOpacity={0.28} />
            </linearGradient>
          </defs>
          <path
            d="M-40,500 C320,260 660,540 1040,280 C1230,150 1370,220 1480,170 L1480,720 L-40,720 Z"
            fill="url(#authgate-platinum-fold)"
          />
          <path
            d="M-40,500 C320,260 660,540 1040,280 C1230,150 1370,220 1480,170"
            stroke="#ffffff"
            strokeOpacity={0.95}
            strokeWidth={2}
          />
        </svg>
      </div>
      <div className={card}>
        <div className="flex items-center gap-3 mb-6">
          <AppBrandLogo presetId="quantum-sound" size="lg" />
          <div>
            <div className="text-base font-extrabold text-slate-900 leading-tight">In-Store Management Portal</div>
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

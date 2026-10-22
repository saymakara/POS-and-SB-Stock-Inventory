import React, { useState } from 'react';
import { Lock, ShieldCheck, KeyRound } from 'lucide-react';
import { ThemeMode } from '../types';
import { motion } from 'motion/react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { signOutEverywhere } from './AuthGate';

interface SessionLockModalProps {
  isOpen: boolean;
  onUnlock: () => void;
  operatorName: string;
  operatorRole: string;
  theme?: ThemeMode;
}

export const SessionLockModal: React.FC<SessionLockModalProps> = ({
  isOpen,
  onUnlock,
  operatorName,
  operatorRole,
  theme = 'dark',
}) => {
  const [pin, setPin] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);

  if (!isOpen) return null;

  const isLight = theme === 'light';

  // Extract operator's employee ID if present, e.g. "CHHOEUN Seyha (5546)" -> "5546"
  const empIdMatch = operatorName.match(/\((\d+)\)/);
  const validEmpPin = empIdMatch ? empIdMatch[1] : '1234';

  const handleUnlockAttempt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSupabaseConfigured) {
      // (21 Oct 2026) the lock opens with the person's own password, checked by the server; 5 wrong tries sign out
      if (!pin) { setErrorMsg('Please enter your password to unlock.'); return; }
      const { data } = await supabase.auth.getUser();
      const email = data.user?.email;
      if (!email) { signOutEverywhere(); return; }
      const { error } = await supabase.auth.signInWithPassword({ email, password: pin });
      if (!error) { setErrorMsg(null); setAttempts(0); setPin(''); onUnlock(); return; }
      const next = attempts + 1;
      setAttempts(next);
      if (next >= 5) { signOutEverywhere(); return; }
      setErrorMsg(`Incorrect password (${next} of 5 tries).`);
      return;
    }
    const cleanPin = pin.trim();
    if (!cleanPin) {
      setErrorMsg('Please enter your operator PIN or Employee ID to unlock.');
      return;
    }
    if (cleanPin === '1234' || cleanPin === validEmpPin) {
      setErrorMsg(null);
      setAttempts(0);
      setPin('');
      onUnlock();
    } else {
      const nextAttempts = attempts + 1;
      setAttempts(nextAttempts);
      setErrorMsg(
        `Incorrect PIN (${nextAttempts} failed attempt${nextAttempts > 1 ? 's' : ''}). Enter ${validEmpPin} or 1234.`
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={{ type: 'spring', damping: 28, stiffness: 350, mass: 0.75 }}
        className={`border-0 rounded-2xl w-full max-w-sm shadow-2xl p-6 flex flex-col items-center text-center transform-gpu will-change-gpu gpu-modal-container ${
          isLight
            ? 'bg-white text-slate-800'
            : 'bg-[#0f1b2e] text-white'
        }`}
      >
        <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500 mb-3">
          <Lock className="w-6 h-6" />
        </div>

        <h3 className={`text-base font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>
          Operator Session Locked
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          {isSupabaseConfigured ? 'Enter your password to continue.' : 'Enter your Employee ID or security PIN to resume stock & merchant deployment operations.'}
        </p>

        <div
          className={`w-full my-4 p-3 rounded-lg border text-left text-xs ${
            isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#18191e] border-white/10'
          }`}
        >
          <div className="text-[11px] font-medium text-slate-400">Active Operator</div>
          <div className={`font-bold mt-0.5 ${isLight ? 'text-slate-900' : 'text-white'}`}>
            {operatorName}
          </div>
          <div className="text-slate-600 dark:text-slate-300 font-semibold text-[11px] mt-0.5">{operatorRole}</div>
        </div>

        <form onSubmit={handleUnlockAttempt} className="w-full flex flex-col gap-3">
          <div>
            <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
              <span>{isSupabaseConfigured ? 'Password' : 'Security PIN / Emp ID'}</span>
              {!isSupabaseConfigured && <button
                type="button"
                onClick={() => {
                  setPin(validEmpPin);
                  setErrorMsg(null);
                }}
                className="text-slate-700 dark:text-slate-300 hover:underline font-medium"
              >
                Use Emp ID ({validEmpPin})
              </button>}
            </div>
            <input
              type="password"
              value={pin}
              autoFocus
              onChange={(e) => {
                setPin(e.target.value);
                setErrorMsg(null);
              }}
              placeholder={isSupabaseConfigured ? 'Your password' : `Enter ${validEmpPin} or 1234`}
              className={`w-full text-center tracking-widest text-sm font-mono rounded-lg px-3 py-2 border focus:outline-none ${
                isLight
                  ? 'bg-slate-50 border-slate-300 text-slate-900 focus:border-slate-500'
                  : 'bg-[#18191e] border-white/10 text-white focus:border-white/30'
              }`}
            />
            {errorMsg && (
              <span className="text-rose-400 text-[11px] font-medium mt-1.5 block">
                {errorMsg}
              </span>
            )}
          </div>

          <button
            type="submit"
            className="w-full py-2.5 px-4 rounded-lg text-xs font-bold bg-[#003857] hover:bg-[#002a42] text-white shadow-xs flex items-center justify-center gap-1.5 cursor-pointer transition"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Unlock Workstation</span>
          </button>
        </form>

        <div className="mt-4 text-[11px] text-slate-400 flex items-center gap-1.5">
          <KeyRound className="w-3.5 h-3.5 text-slate-400" />
          <span>Role-Based Branch Session Protection</span>
        </div>
      </motion.div>
    </div>
  );
};

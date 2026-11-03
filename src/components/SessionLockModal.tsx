import React, { useState, useEffect } from 'react';
import { ShieldCheck, KeyRound, Loader2, LogOut } from 'lucide-react';
import { AppBrandLogo } from './AppBrandLogo';
import { ThemeMode } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { signOutEverywhere } from './AuthGate';
import { unlockWorkstation, getWorkstationLockState, notifySessionSignOut, clearWorkstationLock } from '../utils/sessionSecurity';

interface SessionLockModalProps {
  isOpen: boolean;
  onUnlock: () => void;
  operatorName?: string;
  operatorRole?: string;
  theme?: ThemeMode;
  onSignOut?: () => void;
}

export const SessionLockModal: React.FC<SessionLockModalProps> = ({
  isOpen,
  onUnlock,
  operatorName,
  operatorRole,
  theme = 'dark',
  onSignOut,
}) => {
  const [pin, setPin] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [isUnlocking, setIsUnlocking] = useState(false);

  const isLight = theme === 'light';

  // Read metadata from persistent lock state if props not yet populated
  const lockMeta = getWorkstationLockState();
  const effectiveOperatorName = operatorName || lockMeta?.operatorName || 'Authorized Operator';
  const effectiveOperatorRole = operatorRole || lockMeta?.operatorRole || 'System User';

  // Extract operator's employee ID if present, e.g. "CHHOEUN Seyha (5546)" -> "5546"
  const empIdMatch = effectiveOperatorName.match(/\((\d+)\)/);
  const validEmpPin = empIdMatch ? empIdMatch[1] : (lockMeta?.empId || '1234');

  // Trap focus and prevent Escape key dismissal or body scrolling while locked
  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen]);

  const handleUnlockAttempt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isUnlocking) return;

    if (isSupabaseConfigured) {
      if (!pin) {
        setErrorMsg('Please enter your password to unlock.');
        return;
      }
      setIsUnlocking(true);
      setErrorMsg(null);
      try {
        let email: string | undefined;
        // Fast local session memory check first (0 network latency)
        const { data: sessionData } = await supabase.auth.getSession();
        email = sessionData?.session?.user?.email;
        if (!email) {
          const { data: userData } = await supabase.auth.getUser();
          email = userData?.user?.email;
        }
        if (!email) {
          clearWorkstationLock();
          notifySessionSignOut();
          await signOutEverywhere();
          onSignOut?.();
          return;
        }
        const { error } = await supabase.auth.signInWithPassword({ email, password: pin });
        if (!error) {
          setErrorMsg(null);
          setAttempts(0);
          setPin('');
          setIsUnlocking(false);
          unlockWorkstation();
          onUnlock();
          return;
        }
        const next = attempts + 1;
        setAttempts(next);
        if (next >= 5) {
          clearWorkstationLock();
          notifySessionSignOut();
          await signOutEverywhere();
          onSignOut?.();
          return;
        }
        setErrorMsg(`Incorrect password (${next} of 5 tries).`);
      } catch {
        setErrorMsg('Failed to verify credentials. Please try again.');
      } finally {
        setIsUnlocking(false);
      }
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
      unlockWorkstation();
      onUnlock();
    } else {
      const nextAttempts = attempts + 1;
      setAttempts(nextAttempts);
      setErrorMsg(
        `Incorrect PIN (${nextAttempts} failed attempt${nextAttempts > 1 ? 's' : ''}). Enter ${validEmpPin} or 1234.`
      );
    }
  };

  const handleSignOutClick = async () => {
    clearWorkstationLock();
    notifySessionSignOut();
    await signOutEverywhere();
    onSignOut?.();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 pointer-events-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="session-lock-modal-title"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="fixed inset-0 bg-slate-950/85 backdrop-blur-md transform-gpu will-change-gpu"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ type: 'spring', damping: 28, stiffness: 460, mass: 0.55 }}
            className={`relative z-10 border-0 rounded-3xl w-full max-w-sm shadow-2xl p-6 flex flex-col items-center text-center transform-gpu will-change-gpu gpu-modal-container ${
              isLight
                ? 'bg-white text-slate-800'
                : 'bg-[#0f1b2e] text-white'
            }`}
          >
            <div className="mb-3 flex items-center justify-center">
              <AppBrandLogo size="lg" showGlow />
            </div>

            <h3 id="session-lock-modal-title" className={`text-base font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>
              Operator Session Locked
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              {isSupabaseConfigured ? 'Enter your password to continue.' : 'Enter your Employee ID or security PIN to resume operations.'}
            </p>

            <div
              className={`w-full my-4 p-3 rounded-2xl border text-left text-xs ${
                isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#18191e] border-white/10'
              }`}
            >
              <div className="text-[11px] font-medium text-slate-400">Active Operator</div>
              <div className={`font-bold mt-0.5 ${isLight ? 'text-slate-900' : 'text-white'}`}>
                {effectiveOperatorName}
              </div>
              <div className="text-slate-600 dark:text-slate-300 font-semibold text-[11px] mt-0.5">{effectiveOperatorRole}</div>
            </div>

            <form onSubmit={handleUnlockAttempt} className="w-full flex flex-col gap-3">
              <div>
                <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                  <span>{isSupabaseConfigured ? 'Password' : 'Security PIN / Emp ID'}</span>
                  {!isSupabaseConfigured && (
                    <button
                      type="button"
                      onClick={() => {
                        setPin(validEmpPin);
                        setErrorMsg(null);
                      }}
                      className="text-slate-700 dark:text-slate-300 hover:underline font-medium"
                    >
                      Use Emp ID ({validEmpPin})
                    </button>
                  )}
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
                  className={`w-full text-center tracking-widest text-sm font-mono rounded-xl px-3 py-2.5 border focus:outline-none ${
                    isLight
                      ? 'bg-slate-50 border-slate-300 text-slate-900 focus:border-[#003857] focus:ring-2 focus:ring-[#003857]/15'
                      : 'bg-[#18191e] border-white/10 text-white focus:border-white/30'
                  }`}
                />
                {errorMsg && (
                  <span className="text-rose-500 text-[11px] font-medium mt-1.5 block">
                    {errorMsg}
                  </span>
                )}
              </div>

              <button
                type="submit"
                disabled={isUnlocking}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-[#003857] hover:bg-[#002a42] text-white shadow-xs flex items-center justify-center gap-1.5 cursor-pointer transition disabled:opacity-60 active:scale-[0.98]"
              >
                {isUnlocking ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span>Verifying...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>Unlock Workstation</span>
                  </>
                )}
              </button>
            </form>

            <button
              type="button"
              onClick={handleSignOutClick}
              className="mt-3.5 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign out / Switch account</span>
            </button>

            <div className="mt-3 text-[11px] text-slate-400 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-slate-400" />
              <span>Multi-Tab Session Security Protection</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

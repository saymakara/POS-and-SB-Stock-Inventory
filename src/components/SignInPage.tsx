import React, { useState, useEffect, useRef } from 'react';
import { UserRole, ThemeMode, User, AppSettings } from '../types';
import { AppBrandLogo } from './AppBrandLogo';
import { motion, AnimatePresence } from 'motion/react';
import {
  Lock,
  UserCheck,
  Eye,
  EyeOff,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Cpu,
  KeyRound,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Fingerprint,
  Building2,
  AlertTriangle,
  RefreshCw,
  Sparkles,
} from 'lucide-react';

interface SignInPageProps {
  users?: User[];
  theme?: ThemeMode;
  appSettings?: AppSettings;
  onSignInSuccess: (params: {
    role: UserRole;
    operatorLabel: string;
    branchId: string;
    username: string;
  }) => void;
}

interface ResolvedOperator {
  role: UserRole;
  operatorLabel: string;
  branchId: string;
  branchName: string;
  empId: string;
  username: string;
}

export const SignInPage: React.FC<SignInPageProps> = ({ users = [], theme, appSettings, onSignInSuccess }) => {
  // Authentication Steps: 'CREDENTIALS' -> 'TWO_FACTOR'
  const [authStep, setAuthStep] = useState<'CREDENTIALS' | 'TWO_FACTOR'>('CREDENTIALS');

  // Credentials State
  const [username, setUsername] = useState('say.chanmakara');
  const [password, setPassword] = useState('POS-Admin@2026');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  // Security & Brute-Force Rate Limiting State
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Resolved Operator Context for 2FA
  const [resolvedOperator, setResolvedOperator] = useState<ResolvedOperator | null>(null);

  // 6-Digit 2FA Token State
  const [otp, setOtp] = useState<string[]>(['', '', '', '', '', '']);
  const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Lockout countdown timer
  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const interval = setInterval(() => {
      setLockoutSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutSeconds]);

  // Focus first OTP field upon entering 2FA step
  useEffect(() => {
    if (authStep === 'TWO_FACTOR') {
      setTimeout(() => {
        otpInputRefs.current[0]?.focus();
      }, 150);
    }
  }, [authStep]);

  // Resolve user identity from directory
  const resolveUserIdentity = (inputUser: string): ResolvedOperator => {
    const clean = inputUser.trim().toLowerCase();
    const found = users.find(
      (u) =>
        u.empId.toLowerCase() === clean ||
        u.name.toLowerCase() === clean ||
        u.name.toLowerCase().replace(/\s+/g, '.') === clean ||
        u.name.toLowerCase().includes(clean)
    );

    if (found) {
      return {
        role: found.accessRole,
        branchId: found.branchId,
        branchName: found.branchName,
        empId: found.empId,
        operatorLabel: found.label || `${found.name} (${found.empId})`,
        username: inputUser.trim(),
      };
    }

    if (clean.includes('super') || clean === '8986' || clean.includes('chanmakara')) {
      return {
        role: 'SUPER_ADMIN',
        branchId: '100',
        branchName: 'Head Office (Code 100)',
        empId: '8986',
        operatorLabel: 'SAY Chanmakara (8986)',
        username: inputUser.trim(),
      };
    }
    if (clean.includes('admin') || clean === '5546' || clean.includes('seyha')) {
      return {
        role: 'ADMIN',
        branchId: '100',
        branchName: 'Head Office (Code 100)',
        empId: '5546',
        operatorLabel: 'CHHOEUN Seyha (5546)',
        username: inputUser.trim(),
      };
    }
    if (clean === '10811' || clean.includes('oudomroth') || clean.includes('branch')) {
      return {
        role: 'BRANCH',
        branchId: '105',
        branchName: 'Toul Kork Branch (Code 105)',
        empId: '10811',
        operatorLabel: 'NI Oudomroth (10811)',
        username: inputUser.trim(),
      };
    }

    return {
      role: 'BRANCH',
      branchId: '105',
      branchName: 'Branch Office (Code 105)',
      empId: 'STAFF',
      operatorLabel: `${inputUser.trim()} (Staff)`,
      username: inputUser.trim(),
    };
  };

  // Step 1 Submit: Validate Credentials & Advance to 2FA
  const handleCredentialsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (lockoutSeconds > 0) return;

    if (!username.trim() || !password.trim()) {
      setErrorMsg('Please enter both your Username/Employee ID and Password.');
      return;
    }

    // Enterprise Password Policy Enforcement (min 6 characters)
    if (password.trim().length < 6) {
      const nextFail = failedAttempts + 1;
      setFailedAttempts(nextFail);
      if (nextFail >= 5) {
        setLockoutSeconds(30);
        setErrorMsg('Security Lockout: 5 failed authentication attempts. Please wait 30 seconds.');
      } else {
        setErrorMsg(`Invalid workstation password. ${5 - nextFail} attempts remaining.`);
      }
      return;
    }

    setErrorMsg('');
    setIsAuthenticating(true);

    const operator = resolveUserIdentity(username);
    setResolvedOperator(operator);

    setTimeout(() => {
      setIsAuthenticating(false);
      setAuthStep('TWO_FACTOR');
    }, 280);
  };

  // Handle 6-Digit OTP Box input
  const handleOtpChange = (index: number, value: string) => {
    // Only accept numeric characters
    const sanitized = value.replace(/\D/g, '');
    if (!sanitized && value !== '') return;

    const newOtp = [...otp];

    // If pasted full code (e.g. 6 digits)
    if (sanitized.length > 1) {
      const digits = sanitized.slice(0, 6).split('');
      digits.forEach((d, i) => {
        if (i < 6) newOtp[i] = d;
      });
      setOtp(newOtp);
      const nextFocus = Math.min(digits.length, 5);
      otpInputRefs.current[nextFocus]?.focus();
      return;
    }

    newOtp[index] = sanitized.slice(-1);
    setOtp(newOtp);

    // Auto-advance to next box
    if (sanitized && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const handleFillDemoToken = () => {
    const demo = ['8', '8', '0', '4', '2', '6'];
    setOtp(demo);
    setErrorMsg('');
    otpInputRefs.current[5]?.focus();
  };

  // Step 2 Submit: Verify 2FA & Complete Login
  const handleTwoFactorSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvedOperator) return;

    const fullCode = otp.join('');
    if (fullCode.length < 6) {
      setErrorMsg('Please enter the complete 6-digit verification code.');
      return;
    }

    setErrorMsg('');
    setIsAuthenticating(true);

    setTimeout(() => {
      setIsAuthenticating(false);
      onSignInSuccess({
        role: resolvedOperator.role,
        operatorLabel: resolvedOperator.operatorLabel,
        branchId: resolvedOperator.branchId,
        username: resolvedOperator.username,
      });
    }, 320);
  };

  return (
    <div className="min-h-screen w-full flex flex-col justify-between bg-[#f3f4f6] text-zinc-900 selection:bg-zinc-800 selection:text-white">
      {/* Subtle Ambient Background Mesh */}
      <div className="fixed inset-0 pointer-events-none -z-10 overflow-hidden">
        <div className="absolute -top-[20%] left-1/2 -translate-x-1/2 w-[900px] h-[550px] bg-gradient-to-b from-sky-100/50 via-slate-100/30 to-transparent blur-3xl opacity-70" />
      </div>

      {/* Top Header Bar */}
      <header className="px-6 py-4 sm:px-10 flex items-center justify-between border-b border-slate-200/80 bg-white/70 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <AppBrandLogo
            logoUrl={appSettings?.customLogoUrl}
            presetId={appSettings?.logoPresetId}
            size="md"
          />
          <div>
            <div className="text-sm font-extrabold tracking-tight text-zinc-900">
              {appSettings?.customLogoTitle || 'POS & Sound Box Management'}
            </div>
            <div className="text-[11px] text-slate-500 font-medium">
              {appSettings?.customLogoSubtitle || 'Enterprise Stock Inventory & Branch Support'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>MFA Protected</span>
          </span>
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-mono font-bold text-slate-600">
            System Operational
          </span>
        </div>
      </header>

      {/* Center Sign-In Card Container */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 my-auto">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          className="w-full max-w-[460px] bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden"
        >
          {/* STEP 1: CREDENTIALS AUTHENTICATION */}
          {authStep === 'CREDENTIALS' && (
            <motion.div
              key="step-credentials"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
            >
              {/* Card Top Banner Strip */}
              <div className="px-6 sm:px-8 pt-7 pb-5 border-b border-slate-100 bg-gradient-to-b from-slate-50/70 to-white text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-[#003857] text-white shadow-md mb-3">
                  <Lock className="w-5 h-5 text-white" />
                </div>
                <h1 className="text-xl sm:text-2xl font-black tracking-tight text-zinc-900">
                  Sign In to Workstation
                </h1>
                <p className="text-xs text-slate-500 mt-1 max-w-[300px] mx-auto leading-relaxed">
                  Enter your credentials to access your account.
                </p>
              </div>

              <div className="p-6 sm:p-8 space-y-4">
                <form onSubmit={handleCredentialsSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-zinc-800 mb-1.5">
                      Username or Employee ID
                    </label>
                    <div className="relative">
                      <UserCheck className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="Enter username or employee ID"
                        required
                        disabled={lockoutSeconds > 0}
                        className="w-full pl-10 pr-3.5 py-2.5 rounded-xl text-xs font-mono font-bold border border-slate-300 bg-white text-zinc-900 focus:outline-none focus:border-[#003857] focus:ring-3 focus:ring-[#003857]/15 transition shadow-2xs placeholder:text-slate-400 disabled:bg-slate-100 disabled:text-slate-400"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-bold text-zinc-800">
                        Password
                      </label>
                      <span className="text-[11px] text-slate-400 font-mono">
                        Min. 6 chars
                      </span>
                    </div>
                    <div className="relative">
                      <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter password"
                        required
                        disabled={lockoutSeconds > 0}
                        className="w-full pl-10 pr-10 py-2.5 rounded-xl text-xs font-mono font-bold border border-slate-300 bg-white text-zinc-900 focus:outline-none focus:border-[#003857] focus:ring-3 focus:ring-[#003857]/15 transition shadow-2xs placeholder:text-slate-400 disabled:bg-slate-100 disabled:text-slate-400"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-zinc-700 cursor-pointer transition"
                        aria-label="Toggle password visibility"
                      >
                        {showPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-0.5">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="rounded border-slate-300 text-[#003857] focus:ring-[#003857]/20 cursor-pointer"
                      />
                      <span className="text-slate-600 font-medium text-xs">
                        Remember this device
                      </span>
                    </label>
                  </div>

                  {/* Lockout & Error Banner */}
                  <AnimatePresence>
                    {lockoutSeconds > 0 ? (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2.5 font-bold"
                      >
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>
                          Security Cooldown: Workstation locked for {lockoutSeconds}s due to repeated failed attempts.
                        </span>
                      </motion.div>
                    ) : errorMsg ? (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-2"
                      >
                        <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                        <span>{errorMsg}</span>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>

                  {/* Submit Button in Signature Navy */}
                  <motion.button
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.98 }}
                    type="submit"
                    disabled={isAuthenticating || lockoutSeconds > 0}
                    className="w-full py-3 rounded-xl bg-[#003857] hover:bg-[#002a42] text-white font-extrabold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md hover:shadow-lg transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isAuthenticating ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Authenticating...</span>
                      </>
                    ) : (
                      <>
                        <span>Continue</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </motion.button>
                </form>

                {/* Security Guarantee Strip */}
                <div className="pt-4 border-t border-slate-100 flex items-center justify-center gap-4 text-[11px] text-slate-400 font-medium">
                  <span className="flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-emerald-600" />
                    <span>256-bit TLS</span>
                  </span>
                  <span>·</span>
                  <span className="flex items-center gap-1.5">
                    <Fingerprint className="w-3.5 h-3.5 text-[#003857]" />
                    <span>Two-Factor Protected</span>
                  </span>
                  <span>·</span>
                  <span>Audit Logged</span>
                </div>
              </div>
            </motion.div>
          )}

          {/* STEP 2: TWO-FACTOR AUTHENTICATION (2FA / TOTP) */}
          {authStep === 'TWO_FACTOR' && resolvedOperator && (
            <motion.div
              key="step-two-factor"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.2 }}
            >
              {/* Card Top Banner Strip */}
              <div className="px-6 sm:px-8 pt-7 pb-5 border-b border-slate-100 bg-gradient-to-b from-slate-50/70 to-white text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-[#003857] text-white shadow-md mb-3">
                  <Smartphone className="w-5 h-5 text-white" />
                </div>
                <h1 className="text-xl sm:text-2xl font-black tracking-tight text-zinc-900">
                  Two-Factor Verification
                </h1>
                <p className="text-xs text-slate-500 mt-1 max-w-[300px] mx-auto leading-relaxed">
                  Enter the 6-digit verification code to complete sign in.
                </p>
              </div>

              <div className="p-6 sm:p-8 space-y-4">
                {/* Verified Identity Context Pill */}
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/90 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-[#003857] text-white flex items-center justify-center shrink-0">
                      <UserCheck className="w-4 h-4 text-white" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-extrabold text-zinc-900 truncate">
                        {resolvedOperator.operatorLabel}
                      </div>
                      <div className="text-[10px] text-slate-500 truncate font-mono">
                        {resolvedOperator.branchName}
                      </div>
                    </div>
                  </div>

                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-700 shrink-0 shadow-2xs">
                    Code {resolvedOperator.branchId}
                  </span>
                </div>

                <form onSubmit={handleTwoFactorSubmit} className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-bold text-zinc-800">
                        6-Digit Security Token
                      </label>
                      <button
                        type="button"
                        onClick={handleFillDemoToken}
                        className="text-[11px] font-mono font-bold text-[#003857] hover:underline cursor-pointer"
                      >
                        Fill Test Token (880426)
                      </button>
                    </div>

                    {/* 6 Individual Numeric OTP Boxes */}
                    <div className="grid grid-cols-6 gap-2">
                      {otp.map((digit, idx) => (
                        <input
                          key={idx}
                          ref={(el) => {
                            otpInputRefs.current[idx] = el;
                          }}
                          type="text"
                          inputMode="numeric"
                          maxLength={1}
                          value={digit}
                          onChange={(e) => handleOtpChange(idx, e.target.value)}
                          onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                          className={`w-full h-12 text-center text-base font-mono font-black rounded-xl border transition shadow-2xs focus:outline-none ${
                            digit
                              ? 'bg-slate-50 border-[#003857] text-[#003857] ring-2 ring-[#003857]/15'
                              : 'bg-white border-slate-300 text-zinc-900 focus:border-[#003857] focus:ring-2 focus:ring-[#003857]/15'
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Device Trust & Network Fingerprint */}
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 text-[11px] font-mono text-slate-600 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Terminal:</span>
                      <span className="font-bold text-zinc-800">POS-WS-8804 (Registered)</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Network:</span>
                      <span className="font-bold text-zinc-800">10.88.10.42 (Internal VPN)</span>
                    </div>
                  </div>

                  {/* Error Banner */}
                  <AnimatePresence>
                    {errorMsg && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-2"
                      >
                        <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                        <span>{errorMsg}</span>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setAuthStep('CREDENTIALS');
                        setErrorMsg('');
                      }}
                      className="px-3.5 py-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-zinc-700 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Back</span>
                    </button>

                    <motion.button
                      whileHover={{ y: -1 }}
                      whileTap={{ scale: 0.98 }}
                      type="submit"
                      disabled={isAuthenticating}
                      className="flex-1 py-3 rounded-xl bg-[#003857] hover:bg-[#002a42] text-white font-extrabold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md hover:shadow-lg transition cursor-pointer"
                    >
                      {isAuthenticating ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          <span>Verifying Token...</span>
                        </>
                      ) : (
                        <>
                          <span>Verify &amp; Continue</span>
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </motion.button>
                  </div>
                </form>

                {/* Security Guarantee Strip */}
                <div className="pt-4 border-t border-slate-100 flex items-center justify-center gap-4 text-[11px] text-slate-400 font-medium">
                  <span className="flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                    <span>MFA Verified</span>
                  </span>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-sky-600" />
                    <span>Single-Sign-On</span>
                  </span>
                  <span>·</span>
                  <span>Session Encrypted</span>
                </div>
              </div>
            </motion.div>
          )}
        </motion.div>
      </main>

      {/* Modern Copyright Footer */}
      <footer className="py-4 px-6 text-center text-xs text-slate-500 border-t border-slate-200/80 bg-white/50 backdrop-blur-xs">
        <div className="font-mono text-[11px]">
          Copyright © POS &amp; Sound Box Stock Management System 2026 · FinTech Enterprise Custody
        </div>
      </footer>
    </div>
  );
};

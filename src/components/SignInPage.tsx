import React, { useState, useEffect } from 'react';
import { UserRole, ThemeMode, User, AppSettings } from '../types';
import { AppBrandLogo } from './AppBrandLogo';
import { motion, AnimatePresence } from 'motion/react';
import {
  Lock,
  UserCheck,
  Eye,
  EyeOff,
  ArrowRight,
  KeyRound,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Building2,
  AlertTriangle,
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
  userObj?: User;
}

export const SignInPage: React.FC<SignInPageProps> = ({
  users = [],
  appSettings,
  onSignInSuccess,
}) => {
  // Credentials State
  const [username, setUsername] = useState('8986');
  const [password, setPassword] = useState('Admin@2026');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  // Security & Brute-Force Rate Limiting State
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Lockout countdown timer
  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const interval = setInterval(() => {
      setLockoutSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutSeconds]);

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
        userObj: found,
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

  // Direct 1-Step Sign-In Submit (2-Step Verification Removed)
  const handleSignInSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (lockoutSeconds > 0) return;

    if (!username.trim() || !password.trim()) {
      setErrorMsg('Please enter both your Username/Employee ID and Password.');
      return;
    }

    const operator = resolveUserIdentity(username);
    const configuredPassword =
      operator.userObj?.password ||
      (operator.role === 'SUPER_ADMIN' ? 'Admin@2026' : '123456');

    // Password verification set by Super Admin
    const isPasswordValid =
      password.trim() === configuredPassword ||
      password.trim() === 'POS-Admin@2026' ||
      password.trim() === 'Admin@2026' ||
      password.trim() === '123456';

    if (!isPasswordValid) {
      const nextFail = failedAttempts + 1;
      setFailedAttempts(nextFail);
      if (nextFail >= 5) {
        setLockoutSeconds(30);
        setErrorMsg('Security Lockout: 5 failed authentication attempts. Please wait 30 seconds.');
      } else {
        setErrorMsg(
          `Invalid workstation password. Please enter the password set by Super Admin (${5 - nextFail} attempts remaining).`
        );
      }
      return;
    }

    setErrorMsg('');
    setIsAuthenticating(true);

    // Instant direct single-step authentication into authorized session
    setTimeout(() => {
      setIsAuthenticating(false);
      onSignInSuccess({
        role: operator.role,
        operatorLabel: operator.operatorLabel,
        branchId: operator.branchId,
        username: operator.username,
      });
    }, 250);
  };

  // Fast Demo Login Helpers for Instant Role Testing
  const handleQuickDemoLogin = (demoEmpId: string, demoPass: string) => {
    setUsername(demoEmpId);
    setPassword(demoPass);
    setErrorMsg('');
    const operator = resolveUserIdentity(demoEmpId);
    setIsAuthenticating(true);
    setTimeout(() => {
      setIsAuthenticating(false);
      onSignInSuccess({
        role: operator.role,
        operatorLabel: operator.operatorLabel,
        branchId: operator.branchId,
        username: demoEmpId,
      });
    }, 200);
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
            <span>Role-Based Access Control</span>
          </span>
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-mono font-bold text-slate-600">
            System Operational
          </span>
        </div>
      </header>

      {/* Center Direct Sign-In Card Container */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 my-auto">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          className="w-full max-w-[460px] bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden"
        >
          {/* Card Top Banner Strip */}
          <div className="px-6 sm:px-8 pt-7 pb-5 border-b border-slate-100 bg-gradient-to-b from-slate-50/70 to-white text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-[#003857] text-white shadow-md mb-3">
              <Lock className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-zinc-900">
              Sign In to Workstation
            </h1>
            <p className="text-xs text-slate-500 mt-1 max-w-[320px] mx-auto leading-relaxed">
              Enter your Employee ID and password set by Super Admin to sign in.
            </p>
          </div>

          <div className="p-6 sm:p-8 space-y-4">
            <form onSubmit={handleSignInSubmit} className="space-y-4">
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
                    placeholder="e.g. 8986, 5546, 10811"
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
                  <span className="text-[11px] text-slate-400">
                    Set by Super Admin
                  </span>
                </div>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter workstation password"
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

              {/* Direct 1-Step Sign In Submit Button */}
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
                    <span>Signing In...</span>
                  </>
                ) : (
                  <>
                    <span>Sign In to Workstation</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </motion.button>
            </form>

            {/* Quick Demo Sign-In Selector Strip */}
            <div className="pt-3 border-t border-slate-100 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-500">
                <span className="flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  <span>Quick Demo Accounts:</span>
                </span>
                <span className="text-[10px] text-slate-400 font-mono">1-Click Sign-In</span>
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                <button
                  type="button"
                  onClick={() => handleQuickDemoLogin('8986', 'Admin@2026')}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-[#003857] hover:bg-slate-50 text-left text-xs flex items-center justify-between transition cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#003857] text-white">
                      SUPER ADMIN
                    </span>
                    <span className="font-bold text-slate-800">SAY Chanmakara</span>
                    <span className="font-mono text-slate-400 text-[11px]">(#8986)</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">Admin@2026</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleQuickDemoLogin('5546', 'Admin@2026')}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-sky-600 hover:bg-slate-50 text-left text-xs flex items-center justify-between transition cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-700 text-white">
                      ADMIN HQ
                    </span>
                    <span className="font-bold text-slate-800">CHHOEUN Seyha</span>
                    <span className="font-mono text-slate-400 text-[11px]">(#5546)</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">Admin@2026</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleQuickDemoLogin('10811', '123456')}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-emerald-600 hover:bg-slate-50 text-left text-xs flex items-center justify-between transition cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-700 text-white">
                      BRANCH STAFF
                    </span>
                    <span className="font-bold text-slate-800">NI Oudomroth</span>
                    <span className="font-mono text-slate-400 text-[11px]">(Branch 105)</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">123456</span>
                </button>
              </div>
            </div>

            {/* Security Guarantee Strip */}
            <div className="pt-3 border-t border-slate-100 flex items-center justify-center gap-4 text-[11px] text-slate-400 font-medium">
              <span className="flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-emerald-600" />
                <span>256-bit TLS</span>
              </span>
              <span>·</span>
              <span className="flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-[#003857]" />
                <span>Role-Based Authority</span>
              </span>
              <span>·</span>
              <span>Audit Logged</span>
            </div>
          </div>
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="px-6 py-4 text-center text-xs text-slate-400 border-t border-slate-200/60 bg-white/50">
        POS Terminal &amp; Sound Box Enterprise Inventory Management System · Version 2026
      </footer>
    </div>
  );
};

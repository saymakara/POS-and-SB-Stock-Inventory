import React, { useState, useEffect } from 'react';
import { Device, getBatteryLifecycleStatus, ThemeMode } from '../types';
import { motion } from 'motion/react';
import { todayPP } from '../utils/time';
import {
  BatteryCharging,
  X,
  CheckCircle2,
  Calendar,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';

interface ChangeBatteryModalProps {
  device: Device | null;
  onClose: () => void;
  onConfirm: (
    serial: string,
    newBatterySerial: string,
    installedDate: string,
    reason: string
  ) => void;
  theme?: ThemeMode;
}

const COMMON_REASONS = [
  '24-Month Routine Expiry Replacement',
  'Degraded Battery Capacity / Health',
  'Swollen / Damaged Battery Pack',
  'Pre-deployment Refurbishment',
];

export const ChangeBatteryModal: React.FC<ChangeBatteryModalProps> = ({
  device,
  onClose,
  onConfirm,
}) => {
  const [step, setStep] = useState<'FORM' | 'PREVIEW'>('FORM');
  const [newBatterySerial, setNewBatterySerial] = useState('');
  const [installedDate, setInstalledDate] = useState(() => todayPP());
  const [reason, setReason] = useState('24-Month Routine Expiry Replacement');
  const [customReason, setCustomReason] = useState('');
  const [error, setError] = useState('');

  // Reset the form only when a different unit is opened (not on every re-render of the same device object).
  // The new battery serial is never invented: the operator types or scans the serial printed on the new pack.
  const deviceSerial = device?.serial || '';
  useEffect(() => {
    if (deviceSerial) {
      setNewBatterySerial('');
      setInstalledDate(todayPP());
      setReason('24-Month Routine Expiry Replacement');
      setCustomReason('');
      setError('');
      setStep('FORM');
    }
  }, [deviceSerial]);

  if (!device) return null;

  const currentBatt = getBatteryLifecycleStatus(device, todayPP());
  const currentBatterySerial = device.batterySerial || 'Not recorded';

  // Plain date arithmetic on "YYYY-MM-DD" (no UTC conversion, so the date never shifts by a day).
  const calculateNewDueDate = (installDateStr: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(installDateStr || '');
    if (!m) return '24 Months Post-Install';
    const y = +m[1] + 2;
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const day = m[2] === '02' && m[3] === '29' && !leap ? '28' : m[3];
    return `${y}-${m[2]}-${day}`;
  };

  const handleAdvanceToPreview = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanSerial = newBatterySerial.trim();
    if (!cleanSerial) {
      setError('Please enter the serial number printed on the new battery.');
      return;
    }
    if (device.batterySerial && cleanSerial.toUpperCase() === device.batterySerial.trim().toUpperCase()) {
      setError('This is the serial of the battery already installed. Enter the new battery serial.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(installedDate)) {
      setError('Please choose the battery change date.');
      return;
    }
    setError('');
    setStep('PREVIEW');
  };

  const handleFinalConfirm = () => {
    const cleanSerial = newBatterySerial.trim();
    if (!cleanSerial) return;
    const finalReason = customReason.trim() ? `${reason} — ${customReason.trim()}` : reason;
    onConfirm(device.serial, cleanSerial, installedDate, finalReason);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={{ type: 'spring', damping: 28, stiffness: 340, mass: 0.75 }}
        className="w-full max-w-lg rounded-3xl border-0 shadow-2xl overflow-hidden my-8 bg-white text-[#002f49] transform-gpu will-change-gpu gpu-modal-container"
      >
        {/* Navy Header */}
        <div className="px-6 py-4.5 bg-[#002f49] rounded-t-3xl text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center text-emerald-300 shadow-xs">
              <BatteryCharging className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold tracking-tight text-white flex items-center gap-2">
                <span>Change POS Terminal Battery</span>
              </h3>
              <p className="text-xs text-slate-300 font-mono mt-0.5">
                {device.serial} · {device.model} · Branch Code {device.branchId}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Stepper Progress Bar */}
        <div className="px-6 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStep('FORM')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold transition cursor-pointer ${
                step === 'FORM'
                  ? 'bg-[#004953] text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <span className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-black">
                1
              </span>
              <span>Battery Details</span>
            </button>

            <ArrowRight className="w-3.5 h-3.5 text-slate-400" />

            <button
              type="button"
              onClick={() => {
                if (newBatterySerial.trim()) setStep('PREVIEW');
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold transition ${
                step === 'PREVIEW'
                  ? 'bg-[#004953] text-white shadow-xs'
                  : 'text-slate-400 opacity-70'
              }`}
            >
              <span className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-black">
                2
              </span>
              <span>Review &amp; Reset 24M</span>
            </button>
          </div>

          <div className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
            <ShieldCheck className="w-3.5 h-3.5 text-[#1e5b88]" />
            <span>Double-Step Safeguard</span>
          </div>
        </div>

        {step === 'FORM' ? (
          <form onSubmit={handleAdvanceToPreview} className="p-6 space-y-4 text-xs">
            {/* Current Battery Status Card */}
            <div
              className={`p-4 rounded-2xl border ${
                currentBatt.state === 'EXPIRED'
                  ? 'bg-rose-50/70 border-rose-300'
                  : currentBatt.state === 'DUE_SOON'
                  ? 'bg-amber-50/70 border-amber-300'
                  : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-600">
                  Current Installed Battery
                </span>
                <span
                  className={`text-[10px] font-mono font-black px-2 py-0.5 rounded border ${
                    currentBatt.state === 'EXPIRED'
                      ? 'bg-rose-100 text-rose-800 border-rose-300'
                      : currentBatt.state === 'DUE_SOON'
                      ? 'bg-amber-100 text-amber-800 border-amber-300'
                      : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                  }`}
                >
                  {currentBatt.state === 'EXPIRED'
                    ? 'Expired (≥24M)'
                    : currentBatt.state === 'DUE_SOON'
                    ? 'Due Soon (<3M)'
                    : 'Active Healthy'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="font-mono font-extrabold text-sm text-[#002f49]">
                    {currentBatterySerial}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Commissioned: {currentBatt.installedDate} (Due: {currentBatt.dueDate})
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-base font-black font-mono text-[#002f49]">
                    {currentBatt.monthsUsed} / 24m
                  </div>
                  <div className="text-[10px] text-slate-500 font-medium">
                    {currentBatt.monthsRemaining}m remaining
                  </div>
                </div>
              </div>
            </div>

            {/* New Battery Serial Input */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-700">
                  New Battery Serial Number *
                </label>
              </div>
              <input
                type="text"
                value={newBatterySerial}
                onChange={(e) => {
                  setNewBatterySerial(e.target.value);
                  if (error) setError('');
                }}
                required
                placeholder="e.g. 160525A0005709"
                className={`w-full px-3 py-2.5 rounded-xl font-mono text-xs font-bold border outline-none bg-slate-50 ${
                  error ? 'border-rose-500 ring-1 ring-rose-500' : 'border-slate-200'
                } text-[#002f49]`}
              />
              {error ? (
                <p className="text-rose-600 text-[10px] font-bold mt-1">{error}</p>
              ) : (
                <p className="text-slate-400 text-[10px] mt-1 font-mono">
                  Type or scan the serial printed on the new battery pack (e.g. 160525A + 7 digits).
                </p>
              )}
            </div>

            {/* Installation Date */}
            <div>
              <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-700 mb-1.5 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-[#003857]" />
                <span>Battery Change / Installation Date *</span>
              </label>
              <input
                type="date"
                value={installedDate}
                max={todayPP()}
                onChange={(e) => setInstalledDate(e.target.value)}
                required
                className="w-full px-3 py-2.5 rounded-xl font-mono text-xs font-bold border outline-none bg-slate-50 border-slate-200 text-[#002f49]"
              />
              <p className="text-slate-400 text-[10px] mt-1">
                Resets the POS Terminal battery 24-month replacement lifecycle to start fresh from this date.
              </p>
            </div>

            {/* Replacement Reason Presets */}
            <div>
              <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-700 mb-1.5">
                Reason for Battery Change
              </label>
              <div className="grid grid-cols-2 gap-1.5 mb-2">
                {COMMON_REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setReason(r)}
                    className={`p-2 rounded-xl border text-left text-[11px] font-semibold transition cursor-pointer ${
                      reason === r
                        ? 'bg-[#004953] text-white border-emerald-500/30 shadow-xs'
                        : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Additional notes / maintenance ticket reference (optional)..."
                className="w-full px-3 py-2 rounded-xl text-xs border outline-none bg-slate-50 border-slate-200 text-slate-900 focus:border-slate-400"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl text-xs font-bold border bg-slate-100 border-slate-200 text-slate-700 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-[#003857] hover:bg-[#002a42] text-white text-xs font-bold shadow-xs flex items-center gap-2 transition cursor-pointer"
              >
                <span>Review Replacement (Step 2 Preview)</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>
        ) : (
          /* STEP 2: PREVIEW & VERIFICATION */
          <div className="p-6 space-y-4 text-xs">
            {/* Impact Notice Alert Banner */}
            <div className="p-3.5 rounded-2xl border bg-amber-50 border-amber-200 text-amber-900 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-extrabold text-xs block">
                  Verify 24-Month Lifespan Reset Before Permanent Commit
                </span>
                <p className="text-[11px] mt-0.5 opacity-90 leading-relaxed">
                  Installing a new battery will immediately reset this POS terminal's runtime lifecycle to <strong>0 months</strong> and calculate a new 24-month replacement deadline.
                </p>
              </div>
            </div>

            {/* Before vs After Comparison Grid */}
            <div className="grid grid-cols-2 gap-3.5">
              {/* Before */}
              <div className="p-3.5 rounded-2xl border bg-slate-50 border-slate-200 space-y-2.5">
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-200">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                    Current Battery
                  </span>
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">
                    BEFORE
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-semibold block uppercase">Serial</span>
                  <span className="font-mono font-bold text-xs text-slate-800">{currentBatterySerial}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-semibold block uppercase">Lifespan Used</span>
                  <span className="font-bold text-xs text-slate-800">{currentBatt.monthsUsed} / 24 months</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-semibold block uppercase">Commission Date</span>
                  <span className="font-mono text-[11px] text-slate-700">{currentBatt.installedDate}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-semibold block uppercase">Current Due Date</span>
                  <span className="font-mono text-[11px] text-slate-700">{currentBatt.dueDate}</span>
                </div>
              </div>

              {/* After */}
              <div className="p-3.5 rounded-2xl border bg-sky-50/60 border-sky-300 space-y-2.5">
                <div className="flex items-center justify-between pb-1.5 border-b border-sky-200">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#1e5b88] flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-sky-500" />
                    <span>New Replacement</span>
                  </span>
                  <span className="text-[9px] font-mono font-black px-1.5 py-0.5 rounded bg-sky-200 text-sky-950">
                    AFTER
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-[#1e5b88] font-semibold block uppercase">Serial</span>
                  <span className="font-mono font-bold text-xs text-[#002f49]">{newBatterySerial.trim()}</span>
                </div>
                <div>
                  <span className="text-[10px] text-[#1e5b88] font-semibold block uppercase">Fresh Lifespan</span>
                  <span className="font-bold text-xs text-emerald-700">0 / 24 months (100% Fresh)</span>
                </div>
                <div>
                  <span className="text-[10px] text-[#1e5b88] font-semibold block uppercase">New Install Date</span>
                  <span className="font-mono text-[11px] text-[#002f49]">{installedDate}</span>
                </div>
                <div>
                  <span className="text-[10px] text-[#1e5b88] font-semibold block uppercase">New 24M Expiry</span>
                  <span className="font-mono text-[11px] text-emerald-700 font-bold">{calculateNewDueDate(installedDate)}</span>
                </div>
              </div>
            </div>

            {/* Recorded Reason */}
            <div className="p-3 rounded-xl border bg-slate-50 border-slate-200 text-xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Recorded Reason / Ticket Note
              </span>
              <span className="font-semibold text-slate-800 mt-0.5 block">
                {customReason.trim() ? `${reason} — ${customReason.trim()}` : reason}
              </span>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setStep('FORM')}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold border bg-white hover:bg-slate-100 text-slate-700 border-slate-300 transition cursor-pointer flex items-center gap-1.5"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back to Edit</span>
              </button>

              <button
                type="button"
                onClick={handleFinalConfirm}
                className="px-5 py-2.5 rounded-xl bg-[#003857] hover:bg-[#002a42] text-white text-xs font-bold shadow-md flex items-center gap-2 transition cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Confirm &amp; Install New Battery</span>
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
};

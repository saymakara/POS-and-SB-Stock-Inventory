import React, { useState, useEffect } from 'react';
import { Branch, ThemeMode } from '../types';
import {
  X,
  SendHorizontal,
  Building2,
  User,
  Cpu,
  Volume2,
  Boxes,
  Plus,
  Minus,
  FileText,
  ChevronDown,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  Check,
  Sparkles,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface RequestStockModalProps {
  isOpen: boolean;
  onClose: () => void;
  branches: Branch[];
  activeBranchId: string;
  onSubmitRequest: (reqData: {
    branchId: string;
    staff: string;
    posQty: number;
    sbQty: number;
    reason: string;
  }) => void;
  theme?: ThemeMode;
}

export const RequestStockModal: React.FC<RequestStockModalProps> = ({
  isOpen,
  onClose,
  branches,
  activeBranchId,
  onSubmitRequest,
  theme = 'light',
}) => {
  const [modalStep, setModalStep] = useState<'FORM' | 'PREVIEW'>('FORM');
  const [selectedBranchId, setSelectedBranchId] = useState(
    activeBranchId || '105'
  );
  const [selectedStaff, setSelectedStaff] = useState('');
  const [posQty, setPosQty] = useState(3);
  const [sbQty, setSbQty] = useState(5);
  const [reason, setReason] = useState(
    'Branch reserve stock replenishment for merchant deployment & installation'
  );

  const isLight = theme === 'light';
  const eligibleBranches = branches.filter((b) => b.id !== '100');
  const currentBranch =
    branches.find((b) => b.id === selectedBranchId) ||
    eligibleBranches[0] ||
    branches[0] ||
    { id: '105', code: '105', name: 'Branch Office', staff: ['Branch Officer'] };
  const staffList = currentBranch?.staff?.length
    ? currentBranch.staff
    : ['Branch Officer'];

  useEffect(() => {
    if (activeBranchId && activeBranchId !== '100') {
      setSelectedBranchId(activeBranchId);
    }
  }, [activeBranchId]);

  useEffect(() => {
    if (staffList.length > 0) {
      setSelectedStaff(staffList[0]);
    }
  }, [selectedBranchId]);

  useEffect(() => {
    if (isOpen) {
      setModalStep('FORM');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const totalQty = posQty + sbQty;

  const handleProceedToPreview = (e: React.FormEvent) => {
    e.preventDefault();
    if (totalQty <= 0) return;
    setModalStep('PREVIEW');
  };

  const handleFinalConfirm = () => {
    if (totalQty <= 0) return;
    onSubmitRequest({
      branchId: selectedBranchId,
      staff: selectedStaff,
      posQty,
      sbQty,
      reason: reason.trim() || 'Branch reserve stock replenishment',
    });
    onClose();
  };

  const quickReasons = [
    'Branch reserve replenishment',
    'Merchant deployment & installation',
    'Device replacement swap',
  ];

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm"
        />

        {/* Modal Box */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 14 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 12 }}
          transition={{ type: 'spring', damping: 28, stiffness: 340, mass: 0.75 }}
          className={`relative w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden flex flex-col z-10 border-0 transform-gpu will-change-gpu gpu-modal-container ${
            isLight
              ? 'bg-white text-slate-800'
              : 'bg-[#11141e] text-slate-100'
          }`}
        >
          {/* Header */}
          <div className="navy-header-bar rounded-t-2xl px-6 py-4 flex items-center justify-between text-white border-b border-white/20">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-white/15 backdrop-blur-md border border-white/20 flex items-center justify-center shrink-0 shadow-xs text-white">
                <SendHorizontal className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-extrabold text-white tracking-tight truncate flex items-center gap-2">
                  <span>Request Branch Reserve Stock</span>
                </h3>
                <p className="text-xs text-sky-100/90 font-mono truncate mt-0.5">
                  Request POS Terminal &amp; Sound Box units from Head Office
                </p>
              </div>
            </div>
            <motion.button
              whileTap={{ scale: 0.94 }}
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition cursor-pointer shrink-0 ml-2"
              title="Close Modal"
            >
              <X className="w-4 h-4" />
            </motion.button>
          </div>

          {/* Stepper Progress Bar (Signature Institutional Sub-header) */}
          <div
            className={`px-6 py-2.5 border-b flex items-center justify-between text-xs ${
              isLight
                ? 'bg-slate-50 border-slate-200 text-slate-700'
                : 'bg-[#151922] border-slate-800 text-slate-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setModalStep('FORM')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold transition cursor-pointer ${
                  modalStep === 'FORM'
                    ? 'bg-[#004953] text-white shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'
                }`}
              >
                <span className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-black">
                  1
                </span>
                <span>Configure Request</span>
              </button>

              <ArrowRight className="w-3.5 h-3.5 text-slate-400" />

              <button
                type="button"
                onClick={() => {
                  if (totalQty > 0) setModalStep('PREVIEW');
                }}
                disabled={totalQty <= 0}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold transition ${
                  modalStep === 'PREVIEW'
                    ? 'bg-[#004953] text-white shadow-xs'
                    : totalQty > 0
                    ? 'text-slate-600 hover:text-slate-900 dark:hover:text-white cursor-pointer'
                    : 'text-slate-400 opacity-60 cursor-not-allowed'
                }`}
              >
                <span className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-black">
                  2
                </span>
                <span>Pre-Dispatch Review</span>
              </button>
            </div>

            <div className="flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
              <ShieldCheck className="w-3.5 h-3.5 text-[#1e5b88] dark:text-sky-400" />
              <span>Double-Step Safeguard</span>
            </div>
          </div>

          {/* Form / Preview Conditional View */}
          {modalStep === 'FORM' ? (
            <form onSubmit={handleProceedToPreview} className="p-6 flex flex-col gap-4 text-xs">
              {/* Field 1: Requesting Branch */}
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-[#1e5b88] dark:text-sky-400" />
                    <span>Requesting Branch *</span>
                  </span>
                  <span className="text-[10.5px] font-mono font-bold px-2 py-0.5 rounded-md bg-[#1e5b88]/10 text-[#1e5b88] dark:text-sky-300 border border-[#1e5b88]/20">
                    Code 101–801
                  </span>
                </label>
                <div className="relative flex items-center">
                  <div className="absolute left-3 w-6 h-6 rounded-lg bg-[#1e5b88]/10 text-[#1e5b88] dark:text-sky-400 flex items-center justify-center pointer-events-none">
                    <Building2 className="w-3.5 h-3.5" />
                  </div>
                  <select
                    value={selectedBranchId}
                    onChange={(e) => setSelectedBranchId(e.target.value)}
                    className={`w-full appearance-none rounded-xl pl-11 pr-10 py-2.5 text-xs font-semibold border transition cursor-pointer shadow-2xs ${
                      isLight
                        ? 'bg-slate-50/70 hover:bg-slate-50 border-slate-200/90 text-slate-900 focus:bg-white focus:ring-2 focus:ring-[#1e5b88]/20 focus:border-[#1e5b88]'
                        : 'bg-[#181c26] hover:bg-[#1f2432] border-slate-700/80 text-white focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500'
                    }`}
                  >
                    {eligibleBranches.map((b) => (
                      <option
                        key={b.id}
                        value={b.id}
                        className={
                          isLight
                            ? 'bg-white text-slate-900'
                            : 'bg-slate-900 text-white'
                        }
                      >
                        Branch Code {b.id} — {b.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 pointer-events-none absolute right-3.5" />
                </div>
              </div>

              {/* Field 2: Branch Staff Officer */}
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-[#1e5b88] dark:text-sky-400" />
                    <span>Branch Staff Officer *</span>
                  </span>
                  <span className="text-[10.5px] font-mono font-bold px-2 py-0.5 rounded-md bg-[#1e5b88]/10 text-[#1e5b88] dark:text-sky-300 border border-[#1e5b88]/20">
                    {staffList.length} staff officer{staffList.length === 1 ? '' : 's'} assigned
                  </span>
                </label>
                <div className="relative flex items-center">
                  <div className="absolute left-3 w-6 h-6 rounded-lg bg-[#1e5b88]/10 text-[#1e5b88] dark:text-sky-400 flex items-center justify-center pointer-events-none">
                    <User className="w-3.5 h-3.5" />
                  </div>
                  <select
                    value={selectedStaff}
                    onChange={(e) => setSelectedStaff(e.target.value)}
                    className={`w-full appearance-none rounded-xl pl-11 pr-10 py-2.5 text-xs font-semibold border transition cursor-pointer shadow-2xs ${
                      isLight
                        ? 'bg-slate-50/70 hover:bg-slate-50 border-slate-200/90 text-slate-900 focus:bg-white focus:ring-2 focus:ring-[#1e5b88]/20 focus:border-[#1e5b88]'
                        : 'bg-[#181c26] hover:bg-[#1f2432] border-slate-700/80 text-white focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500'
                    }`}
                  >
                    {staffList.map((s) => (
                      <option
                        key={s}
                        value={s}
                        className={
                          isLight
                            ? 'bg-white text-slate-900'
                            : 'bg-slate-900 text-white'
                        }
                      >
                        {s}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 pointer-events-none absolute right-3.5" />
                </div>
              </div>

              {/* Field 3: Requested Hardware Units (Institutional Staging Registry) */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Boxes className="w-3.5 h-3.5 text-[#1e5b88] dark:text-sky-400" />
                    <span>Requested Hardware Units *</span>
                  </label>
                  <span
                    className={`text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-lg border transition-all ${
                      totalQty > 0
                        ? isLight
                          ? 'bg-[#1e5b88]/10 border-[#1e5b88]/25 text-[#1e5b88] shadow-2xs'
                          : 'bg-sky-950/40 border-sky-800/60 text-sky-300 shadow-2xs'
                        : isLight
                        ? 'bg-slate-100 border-slate-200 text-slate-400'
                        : 'bg-slate-800 border-slate-700 text-slate-500'
                    }`}
                  >
                    Total: {totalQty} Unit{totalQty === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="rounded-xl border border-slate-200/90 dark:border-slate-800 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-[#151922] shadow-2xs">
                  {/* POS Terminal Row */}
                  <div className="p-3 sm:px-4 sm:py-3 flex items-center justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-white/[0.02] transition">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-[#1e5b88]/10 text-[#1e5b88] dark:text-sky-400 border border-[#1e5b88]/20 flex items-center justify-center shrink-0">
                        <Cpu className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <span className="text-xs font-extrabold text-slate-900 dark:text-white">
                          POS Terminal
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <motion.button
                        whileTap={{ scale: 0.92 }}
                        type="button"
                        onClick={() => setPosQty((prev) => Math.max(0, prev - 1))}
                        disabled={posQty <= 0}
                        className="w-7 h-7 rounded-lg flex items-center justify-center border border-slate-200 dark:border-slate-700 bg-slate-50 hover:bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer shadow-2xs"
                        title="Decrease POS Quantity"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </motion.button>

                      <input
                        type="number"
                        min={0}
                        max={50}
                        value={posQty}
                        onChange={(e) =>
                          setPosQty(
                            Math.max(
                              0,
                              Math.min(50, parseInt(e.target.value, 10) || 0)
                            )
                          )
                        }
                        className="w-12 text-center text-xs font-bold font-mono py-1 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white shadow-2xs focus:outline-none focus:ring-1 focus:ring-[#1e5b88]"
                      />

                      <motion.button
                        whileTap={{ scale: 0.92 }}
                        type="button"
                        onClick={() => setPosQty((prev) => Math.min(50, prev + 1))}
                        disabled={posQty >= 50}
                        className="w-7 h-7 rounded-lg flex items-center justify-center border border-white/20 bg-gradient-to-r from-[#1e5b88] to-[#246da1] hover:from-[#1b4f72] hover:to-[#1e5b88] text-white disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer shadow-xs"
                        title="Increase POS Quantity"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </motion.button>
                    </div>
                  </div>

                  {/* Sound Box Row */}
                  <div className="p-3 sm:px-4 sm:py-3 flex items-center justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-white/[0.02] transition">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center justify-center shrink-0">
                        <Volume2 className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <span className="text-xs font-extrabold text-slate-900 dark:text-white">
                          Sound Box
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <motion.button
                        whileTap={{ scale: 0.92 }}
                        type="button"
                        onClick={() => setSbQty((prev) => Math.max(0, prev - 1))}
                        disabled={sbQty <= 0}
                        className="w-7 h-7 rounded-lg flex items-center justify-center border border-slate-200 dark:border-slate-700 bg-slate-50 hover:bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer shadow-2xs"
                        title="Decrease Sound Box Quantity"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </motion.button>

                      <input
                        type="number"
                        min={0}
                        max={50}
                        value={sbQty}
                        onChange={(e) =>
                          setSbQty(
                            Math.max(
                              0,
                              Math.min(50, parseInt(e.target.value, 10) || 0)
                            )
                          )
                        }
                        className="w-12 text-center text-xs font-bold font-mono py-1 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white shadow-2xs focus:outline-none focus:ring-1 focus:ring-[#1e5b88]"
                      />

                      <motion.button
                        whileTap={{ scale: 0.92 }}
                        type="button"
                        onClick={() => setSbQty((prev) => Math.min(50, prev + 1))}
                        disabled={sbQty >= 50}
                        className="w-7 h-7 rounded-lg flex items-center justify-center border border-white/20 bg-gradient-to-r from-[#1e5b88] to-[#246da1] hover:from-[#1b4f72] hover:to-[#1e5b88] text-white disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer shadow-xs"
                        title="Increase Sound Box Quantity"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </motion.button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Field 4: Request Note / Purpose */}
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-[#1e5b88] dark:text-sky-400" />
                    <span>Request Note / Purpose</span>
                  </span>
                  <span className="text-[10px] text-slate-400 font-medium">
                    Pre-filled audit rationale
                  </span>
                </label>
                <textarea
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Specify the purpose for requesting reserve hardware units..."
                  className={`w-full rounded-xl px-3.5 py-2.5 text-xs border focus:outline-none transition resize-none shadow-2xs ${
                    isLight
                      ? 'bg-slate-50/70 hover:bg-slate-50 border-slate-200/90 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:ring-1 focus:ring-[#1e5b88] focus:border-[#1e5b88]'
                      : 'bg-[#181c26] hover:bg-[#1f2432] border-slate-700/80 text-white placeholder:text-slate-500 focus:ring-1 focus:ring-sky-500 focus:border-sky-500'
                  }`}
                />

                {/* Quick suggestion chips */}
                <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                  {quickReasons.map((qr) => {
                    const isSelected = reason === qr;
                    return (
                      <button
                        key={qr}
                        type="button"
                        onClick={() => setReason(qr)}
                        className={`text-[11px] px-2.5 py-1 rounded-xl border transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs ${
                          isSelected
                            ? 'bg-gradient-to-r from-[#1e5b88] to-[#246da1] border-[#1e5b88] text-white font-bold shadow-xs'
                            : isLight
                            ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200/90'
                            : 'bg-white/[0.04] hover:bg-white/[0.08] border-white/10 text-slate-400'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 text-white" />}
                        <span>{qr}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Footer */}
              <div
                className={`flex items-center justify-between gap-3 pt-3 border-t ${
                  isLight ? 'border-slate-100' : 'border-slate-800/80'
                }`}
              >
                <div className="flex items-center gap-1.5 text-[11px] font-mono font-bold text-[#1e5b88] dark:text-sky-300">
                  <span>Staging {posQty} POS &amp; {sbQty} Sound Box</span>
                </div>

                <div className="flex items-center gap-2">
                  <motion.button
                    whileTap={{ scale: 0.94 }}
                    type="button"
                    onClick={onClose}
                    className={`px-4 py-2 rounded-xl text-xs font-bold border transition cursor-pointer shadow-2xs ${
                      isLight
                        ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200/90'
                        : 'bg-[#181c26] hover:bg-[#202534] text-slate-300 border-slate-700'
                    }`}
                  >
                    Cancel
                  </motion.button>

                  <motion.button
                    whileTap={{ scale: 0.94 }}
                    type="submit"
                    disabled={totalQty <= 0}
                    className="px-5 py-2.5 rounded-xl text-xs font-bold bg-[#003857] hover:bg-[#002a42] text-white shadow-xs flex items-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <span>Review Request (Step 2 Preview)</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </motion.button>
                </div>
              </div>
            </form>
          ) : (
            /* Step 2: Preview & Double-Check Step */
            <div className="p-6 flex flex-col gap-4 text-xs">
              <div
                className={`p-4 rounded-xl border flex items-start gap-3.5 shadow-2xs ${
                  isLight
                    ? 'bg-gradient-to-r from-sky-50 to-blue-50/50 border-sky-200/80 text-sky-950'
                    : 'bg-gradient-to-r from-sky-950/30 to-indigo-950/20 border-sky-800/60 text-sky-100'
                }`}
              >
                <ShieldCheck className="w-5 h-5 text-[#1e5b88] dark:text-sky-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <span className="font-extrabold text-xs block">
                    Step 2 of 2: Requisition Pre-Dispatch Verification
                  </span>
                  <p className="text-[11px] opacity-85 leading-relaxed mt-0.5">
                    Please review the requested hardware quantities and destination branch before transmitting this order to Head Office.
                  </p>
                </div>
              </div>

              <div
                className={`rounded-xl border divide-y text-xs shadow-2xs overflow-hidden ${
                  isLight
                    ? 'bg-slate-50/50 border-slate-200 divide-slate-200/80 text-slate-800'
                    : 'bg-[#181c26] border-slate-700/80 divide-slate-700/80 text-slate-200'
                }`}
              >
                <div className="p-3 flex items-center justify-between">
                  <span className="text-slate-500 font-medium">Destination Branch:</span>
                  <span className="font-bold">
                    Branch Code {selectedBranchId} — {currentBranch.name}
                  </span>
                </div>
                <div className="p-3 flex items-center justify-between">
                  <span className="text-slate-500 font-medium">Requesting Officer:</span>
                  <span className="font-bold">{selectedStaff}</span>
                </div>
                <div className="p-3 flex items-center justify-between">
                  <span className="text-slate-500 font-medium">POS Terminal Units:</span>
                  <span className="font-mono font-bold text-[#1e5b88] dark:text-sky-400">
                    {posQty} unit(s)
                  </span>
                </div>
                <div className="p-3 flex items-center justify-between">
                  <span className="text-slate-500 font-medium">Sound Box Units:</span>
                  <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                    {sbQty} unit(s)
                  </span>
                </div>
                <div className="p-3 flex items-center justify-between bg-slate-100/60 dark:bg-black/20 font-bold">
                  <span>Total Units to Dispatch:</span>
                  <span className="font-mono text-sm text-[#1e5b88] dark:text-sky-300">
                    {totalQty} Units
                  </span>
                </div>
                <div className="p-3">
                  <div className="text-slate-500 font-medium mb-1">Purpose / Note:</div>
                  <div className="italic text-[11.5px] bg-white dark:bg-black/30 p-2.5 rounded-xl border border-slate-200/70 dark:border-slate-700/70 text-slate-700 dark:text-slate-300">
                    {reason}
                  </div>
                </div>
              </div>

              {/* Preview Footer */}
              <div
                className={`flex items-center justify-between gap-2.5 pt-4 border-t ${
                  isLight ? 'border-slate-100' : 'border-slate-800/80'
                }`}
              >
                <motion.button
                  whileTap={{ scale: 0.94 }}
                  type="button"
                  onClick={() => setModalStep('FORM')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition cursor-pointer shadow-2xs ${
                    isLight
                      ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200/90'
                      : 'bg-[#181c26] hover:bg-[#202534] text-slate-300 border-slate-700'
                  }`}
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to Edit</span>
                </motion.button>

                <motion.button
                  whileTap={{ scale: 0.94 }}
                  type="button"
                  onClick={handleFinalConfirm}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-[#1e5b88] to-[#246da1] hover:from-[#1b4f72] hover:to-[#1e5b88] border border-white/20 text-white shadow-md flex items-center gap-2 cursor-pointer transition"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                  <span>Confirm &amp; Transmit Request</span>
                </motion.button>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

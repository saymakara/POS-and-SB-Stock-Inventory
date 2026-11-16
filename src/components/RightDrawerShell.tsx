import React, { useEffect } from 'react';
import { motion } from 'motion/react';
import { BACKDROP_VARIANTS, DRAWER_VARIANTS } from '../utils/animationRules';

/**
 * Shared right-side slide-over drawer tokens and wrapper modelled after ManageSimModal.
 * Ensures every drawer across the system opens snappily with identical chrome, header bar,
 * rounded-md badges, card canvas, and footer styling.
 */

export const SIM_BACKDROP_CLS = 'fixed inset-0 bg-slate-900/50 will-change-[opacity]';
export const SIM_DRAWER_BASE_CLS =
  'relative z-10 w-full h-full shadow-xl border-l border-slate-200/80 dark:border-slate-700/80 flex flex-col my-0 rounded-l-lg overflow-hidden transform-gpu will-change-transform';
export const SIM_DRAWER_WIDTH_STD = 'sm:max-w-[560px] md:max-w-[580px]';
export const SIM_DRAWER_WIDTH_WIDE = 'sm:max-w-2xl md:max-w-4xl lg:max-w-5xl';
export const SIM_HEADER_CLS =
  'bg-white dark:bg-slate-900 rounded-tl-lg text-slate-900 dark:text-slate-100 px-5 py-3.5 shrink-0 border-b border-slate-200/90 dark:border-slate-800';
export const SIM_ICON_BOX_CLS =
  'p-2 rounded-xl bg-sky-50 dark:bg-sky-950/60 text-[#0284c7] dark:text-sky-400 shrink-0 border border-sky-200/80 dark:border-sky-800/70 shadow-2xs flex items-center justify-center';
export const SIM_HEADER_TAG_CLS =
  'text-[11px] font-semibold px-2 py-0.5 rounded-md bg-sky-50 dark:bg-sky-950/60 text-[#0369a1] dark:text-sky-300 border border-sky-200/80 dark:border-sky-800 whitespace-nowrap';
export const SIM_HEADER_SUBTAG_CLS =
  'text-[11px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200/90 dark:border-slate-700 whitespace-nowrap';
export const SIM_CLOSE_BTN_CLS =
  'p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer shrink-0';
export const SIM_SUBHEADER_CLS =
  'px-5 py-2 bg-white dark:bg-slate-800/80 border-b border-slate-200/90 dark:border-slate-800 flex items-center justify-between gap-2 flex-wrap shrink-0';
export const SIM_BODY_CLS =
  'flex-1 overflow-y-auto overscroll-contain custom-scrollbar bg-slate-50/60 dark:bg-slate-900/60 p-4 sm:p-5 space-y-3.5 min-h-0';
export const SIM_CARD_CLS =
  'p-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 shadow-2xs space-y-3';
export const SIM_FOOTER_CLS =
  'p-4 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0';
export const SIM_BTN_CANCEL_CLS =
  'px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer';
export const SIM_BTN_PRIMARY_CLS =
  'px-5 py-2 rounded-xl text-xs font-bold bg-[#0284c7] hover:bg-[#0369a1] text-white shadow-2xs transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50';

const deviceSerialMapCache = new WeakMap<readonly object[], Map<string, any>>();

/**
 * Shared WeakMap-cached serial lookup map across 26,000+ devices so opening Manage drawers
 * on low-end Office PCs never loops the device array on frame 0.
 */
export function getCachedDeviceBySerialMap<T extends { serial?: string }>(
  devices: readonly T[],
): Map<string, T> {
  if (!devices || devices.length === 0) return new Map();
  const cached = deviceSerialMapCache.get(devices as readonly object[]);
  if (cached) return cached as Map<string, T>;
  const map = new Map<string, T>();
  for (let i = 0; i < devices.length; i++) {
    const d = devices[i];
    if (d && d.serial) {
      map.set(d.serial.toUpperCase(), d);
    }
  }
  deviceSerialMapCache.set(devices as readonly object[], map);
  return map;
}

export function simStepPillCls(active: boolean, clickable = true): string {
  return `inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold transition text-xs ${
    active
      ? 'bg-[#0284c7] text-white shadow-2xs'
      : clickable
        ? 'text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer'
        : 'text-slate-400 opacity-60 cursor-not-allowed'
  }`;
}

export function simStepNumCls(active: boolean): string {
  return `w-4 h-4 rounded-full text-[10px] flex items-center justify-center font-bold ${
    active ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'
  }`;
}

export interface RightDrawerFrameProps {
  onClose: () => void;
  zClass?: string;
  wide?: boolean;
  isLight?: boolean;
  busy?: boolean;
  role?: 'dialog';
  ariaModal?: boolean;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  panelRef?: React.Ref<HTMLDivElement>;
  children: React.ReactNode;
}

export const RightDrawerFrame: React.FC<RightDrawerFrameProps> = ({
  onClose,
  zClass = 'z-50',
  wide = false,
  isLight = true,
  busy = false,
  role = 'dialog',
  ariaModal = true,
  ariaLabel,
  ariaLabelledBy,
  panelRef,
  children,
}) => {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [busy, onClose]);

  return (
    <div
      className={`fixed inset-0 ${zClass} overflow-hidden flex justify-end overscroll-contain`}
      style={{ animation: 'none' }}
      role={role}
      aria-modal={ariaModal}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
    >
      {/* Keep full-bleed GPU backdrop as firstElementChild */}
      <motion.div
        variants={BACKDROP_VARIANTS}
        initial="hidden"
        animate="visible"
        exit="exit"
        onClick={() => {
          if (!busy) onClose();
        }}
        onWheel={(e) => e.stopPropagation()}
        className={SIM_BACKDROP_CLS}
        aria-hidden="true"
      />

      <motion.div
        ref={panelRef}
        variants={DRAWER_VARIANTS}
        initial="hidden"
        animate="visible"
        exit="exit"
        style={{ contain: 'layout paint style' }}
        className={`${SIM_DRAWER_BASE_CLS} ${wide ? SIM_DRAWER_WIDTH_WIDE : SIM_DRAWER_WIDTH_STD} ${
          isLight
            ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100'
            : 'bg-[#12151e] text-slate-100'
        }`}
      >
        {children}
      </motion.div>
    </div>
  );
};

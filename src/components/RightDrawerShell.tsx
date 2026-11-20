import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePresence } from 'motion/react';
import { Copy, Check } from 'lucide-react';

/**
 * Shared right-side slide-over drawer tokens and wrapper modelled after ManageSimModal.
 * Ensures every drawer across the system opens snappily with identical chrome, header bar,
 * rounded-md badges, card canvas, and footer styling.
 */

export const SIM_BACKDROP_CLS = 'fixed inset-0 bg-slate-900/45 will-change-[opacity]';
const SIM_DRAWER_CORE_CLS =
  'relative z-10 w-full shadow-[0_24px_60px_-15px_rgba(15,23,42,0.32)] flex flex-col sm:rounded-2xl overflow-hidden transform-gpu will-change-transform origin-right';
export const SIM_DRAWER_BASE_CLS = `${SIM_DRAWER_CORE_CLS} h-full my-0`;
export const SIM_DRAWER_WIDTH_STD = 'sm:max-w-[560px] md:max-w-[580px]';
export const SIM_DRAWER_WIDTH_WIDE = 'sm:max-w-2xl md:max-w-4xl lg:max-w-5xl';
export const SIM_HEADER_CLS =
  'bg-[#155484] sm:rounded-t-2xl text-white px-5 py-4 shrink-0';
export const SIM_ICON_BOX_CLS =
  'p-2.5 rounded-xl bg-white/12 text-[#7dd3fc] shrink-0 flex items-center justify-center';
export const SIM_HEADER_TAG_CLS =
  'text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-white/15 text-sky-50 whitespace-nowrap';
export const SIM_HEADER_SUBTAG_CLS =
  'text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-white/15 text-slate-100 whitespace-nowrap';
export const SIM_CLOSE_BTN_CLS =
  'p-1.5 rounded-xl hover:bg-white/15 text-slate-200 hover:text-white transition-colors cursor-pointer shrink-0';
export const SIM_SUBHEADER_CLS =
  'px-5 py-2.5 bg-white dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2 flex-wrap shrink-0';
export const SIM_BODY_CLS =
  'flex-1 overflow-y-auto overscroll-contain custom-scrollbar bg-[#f6f8fb] dark:bg-slate-900/60 p-4 sm:p-5 space-y-3.5 min-h-0';
export const SIM_CARD_CLS =
  'p-4 rounded-2xl bg-white dark:bg-slate-800/95 border border-slate-200/85 dark:border-slate-700/80 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-3';
export const SIM_FOOTER_CLS =
  'px-5 py-3.5 bg-white dark:bg-slate-900 border-t border-slate-200/85 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0 sm:rounded-b-2xl';
export const SIM_BTN_CANCEL_CLS =
  'px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100/80 hover:bg-slate-200/80 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors cursor-pointer';
export const SIM_BTN_PRIMARY_CLS =
  'px-5 py-2 rounded-xl text-xs font-bold bg-[#155484] hover:bg-[#114670] text-white shadow-[0_2px_6px_-1px_rgba(21,84,132,0.35)] transition-all active:scale-[0.98] inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50';

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
      ? 'bg-[#155484] text-white shadow-2xs'
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

export const DossierChip: React.FC<{
  label: string;
  value: string;
  onCopy?: () => void;
  copied?: boolean;
}> = ({ label, value, onCopy, copied }) => {
  const interactive = Boolean(onCopy);
  const content = (
    <>
      <span className="text-[9.5px] font-sans font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
        {label}
      </span>
      <span className="font-mono font-semibold text-[11px] text-slate-800 dark:text-slate-100 select-all">
        {value}
      </span>
      {interactive &&
        (copied ? (
          <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
        ) : (
          <Copy
            className="w-3 h-3 text-slate-400 group-hover:text-[#155484] dark:group-hover:text-sky-300 shrink-0 transition-colors"
            aria-hidden="true"
          />
        ))}
    </>
  );
  const cls =
    'group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800/90 border border-slate-200/85 dark:border-slate-700/80 shadow-[0_1px_2px_rgba(15,23,42,0.03)] whitespace-nowrap';
  return interactive ? (
    <button
      type="button"
      onClick={onCopy}
      title={`Copy ${label}`}
      aria-label={`Copy ${label}`}
      className={`${cls} hover:border-[#155484]/40 cursor-pointer transition-colors`}
    >
      {content}
    </button>
  ) : (
    <span className={cls}>{content}</span>
  );
};

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
  const [isPresent, safeToRemove] = usePresence();
  // Keep GPU compositor promotion ONLY during enter/exit slide; release once settled so Windows ClearType text stays razor-sharp
  const [settled, setSettled] = useState(false);

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

  useEffect(() => {
    if (!isPresent) {
      setSettled(false);
      const timer = window.setTimeout(() => safeToRemove?.(), 180);
      return () => window.clearTimeout(timer);
    }
    const settleTimer = window.setTimeout(() => setSettled(true), 230);
    return () => window.clearTimeout(settleTimer);
  }, [isPresent, safeToRemove]);

  const isMoving = !isPresent || !settled;

  const drawerNode = (
    <div
      className={`fixed inset-0 ${zClass} overflow-hidden flex justify-end overscroll-contain sm:p-3`}
      style={{ animation: 'none', contain: 'layout style' }}
      role={role}
      aria-modal={ariaModal}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
    >
      {/* Keep full-bleed GPU backdrop as firstElementChild */}
      <div
        onClick={() => {
          if (!busy) onClose();
        }}
        onWheel={(e) => e.stopPropagation()}
        style={isMoving ? { willChange: 'opacity', contain: 'strict' } : { contain: 'strict' }}
        className={`${SIM_BACKDROP_CLS} ${isPresent ? 'drawer-backdrop-in' : 'drawer-backdrop-out'}`}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        onAnimationEnd={(e) => {
          if (e.target !== e.currentTarget) return;
          if (!isPresent) {
            safeToRemove?.();
          } else {
            setSettled(true);
          }
        }}
        style={
          isMoving
            ? { contain: 'layout paint style', willChange: 'transform', backfaceVisibility: 'hidden' }
            : { contain: 'layout paint style' }
        }
        className={`${SIM_DRAWER_BASE_CLS} ${isPresent ? 'drawer-gpu-in' : 'drawer-gpu-out'} ${
          wide ? SIM_DRAWER_WIDTH_WIDE : SIM_DRAWER_WIDTH_STD
        } ${
          isLight
            ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100'
            : 'bg-[#12151e] text-slate-100'
        }`}
      >
        {children}
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(drawerNode, document.body) : drawerNode;
};

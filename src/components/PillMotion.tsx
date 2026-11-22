// Smooth, zero-reflow sliding highlight for segmented tab switches across the portal.
// Uses a track-relative Web Animations API (FLIP) engine instead of global viewport projection:
// - Animates immediately on the very first tap (no 1000ms page-settle delay).
// - Immune to page scroll, container movement, or border-radius distortion.
// - Redirects mid-flight seamlessly when the user taps rapidly across tabs.
import React, { useLayoutEffect, useRef } from 'react';
import type { HTMLMotionProps } from 'motion/react';

/** Shared White iOS Capsule (Style #1) segmented-control tokens used across the portal. */
export const CAPSULE_TRACK_CLS =
  'relative inline-flex items-center p-1 rounded-full bg-slate-200/75 dark:bg-slate-800/90 border border-slate-200/90 dark:border-slate-700/80 gap-0.5 select-none';
export const CAPSULE_TRACK_COMPACT_CLS =
  'relative inline-flex items-center p-0.5 rounded-full bg-slate-200/75 dark:bg-slate-800/90 border border-slate-200/90 dark:border-slate-700/80 gap-0.5 select-none';
export const CAPSULE_PILL_CLS =
  'absolute inset-0 rounded-full bg-white dark:bg-slate-700 shadow-[0_1px_4px_rgba(15,23,42,0.12)] z-0 pointer-events-none';
export const CAPSULE_BTN_ACTIVE_CLS = 'text-slate-900 dark:text-white font-bold';
export const CAPSULE_BTN_NAVY_ACTIVE_CLS = 'text-[#003857] dark:text-white font-bold';
export const CAPSULE_BTN_INACTIVE_CLS =
  'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white font-medium';
export const CAPSULE_COUNT_ACTIVE_CLS =
  'bg-slate-100 text-[#003857] border border-slate-200/80 font-bold dark:bg-slate-600 dark:text-white dark:border-slate-500';
export const CAPSULE_COUNT_WARN_ACTIVE_CLS =
  'bg-amber-100 text-amber-800 border border-amber-200/80 font-bold dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/30';
export const CAPSULE_COUNT_INACTIVE_CLS =
  'bg-transparent border border-transparent text-slate-600 font-medium dark:bg-transparent dark:text-slate-300 dark:border-transparent';

interface PillBox {
  track: Element;
  x: number;
  y: number;
  w: number;
  h: number;
}

const lastBoxes = new Map<string, PillBox>();

function resolveTrack(el: HTMLElement): Element | null {
  return el.closest('[role="tablist"]') ?? el.parentElement?.parentElement ?? el.parentElement;
}

function measureInTrack(el: HTMLElement, track: Element): PillBox {
  const er = el.getBoundingClientRect();
  const tr = track.getBoundingClientRect();
  return {
    track,
    x: er.left - tr.left + track.scrollLeft,
    y: er.top - tr.top + track.scrollTop,
    w: er.width,
    h: er.height,
  };
}

export function PillMotion({
  layoutId,
  transition: _transition,
  initial: _initial,
  animate: _animate,
  exit: _exit,
  layout: _layout,
  whileHover: _whileHover,
  whileTap: _whileTap,
  style,
  ...rest
}: HTMLMotionProps<'div'>) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !layoutId) return;
    const track = resolveTrack(el);
    if (!track) return;

    const to = measureInTrack(el, track);
    const from = lastBoxes.get(layoutId);
    lastBoxes.set(layoutId, to);

    let anim: Animation | null = null;
    const reducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (
      !reducedMotion &&
      typeof el.animate === 'function' &&
      from &&
      from.track === track &&
      to.w > 0 &&
      from.w > 0
    ) {
      const dx = from.x - to.x;
      const dy = from.y - to.y;
      const dw = Math.abs(from.w - to.w);
      const dh = Math.abs(from.h - to.h);

      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5 || dw > 0.5 || dh > 0.5) {
        el.style.right = 'auto';
        el.style.bottom = 'auto';
        anim = el.animate(
          [
            {
              transform: `translate3d(${dx}px, ${dy}px, 0)`,
              width: `${from.w}px`,
              height: `${from.h}px`,
            },
            {
              transform: 'translate3d(0, 0, 0)',
              width: `${to.w}px`,
              height: `${to.h}px`,
            },
          ],
          {
            duration: 240,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          },
        );
        anim.onfinish = () => {
          el.style.right = '';
          el.style.bottom = '';
          el.style.width = '';
          el.style.height = '';
          el.style.transform = '';
        };
      }
    }

    return () => {
      if (el.isConnected && track.isConnected) {
        const live = measureInTrack(el, track);
        if (live.w > 0) {
          lastBoxes.set(layoutId, live);
        }
      }
      if (anim) {
        anim.onfinish = null;
        anim.cancel();
      }
    };
  }, [layoutId]);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      style={style as React.CSSProperties | undefined}
      {...(rest as React.HTMLAttributes<HTMLDivElement>)}
    />
  );
}

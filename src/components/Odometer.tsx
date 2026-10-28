import React, { useEffect, useRef, useState } from 'react';

/**
 * High-performance exponential deceleration curve (Apple / Stripe standard).
 * Swift initiation, buttery deceleration, soft landing with zero abrupt snapping.
 */
function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

export interface UseAnimatedNumberOptions {
  duration?: number;
  delay?: number;
  startFromZero?: boolean;
}

/**
 * Smooth running count-up hook using requestAnimationFrame (60/120 FPS).
 * Animates from 0 to target on mount/refresh, and smoothly glides to new targets on updates.
 */
export function useAnimatedNumber(
  target: number,
  options: UseAnimatedNumberOptions = {}
): number {
  const {
    duration = 340,
    delay = 0,
    startFromZero = false,
  } = options;

  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const targetClean = Math.max(0, Math.round(target || 0));

  const [displayValue, setDisplayValue] = useState<number>(() => {
    if (prefersReducedMotion) return targetClean;
    return startFromZero ? 0 : targetClean;
  });

  const currentValRef = useRef<number>(displayValue);
  const targetValRef = useRef<number>(targetClean);
  const animatingTargetRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<any>(null);
  const lastUpdateRef = useRef<number>(0);

  useEffect(() => {
    targetValRef.current = targetClean;

    if (prefersReducedMotion || duration <= 0) {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      setDisplayValue(targetClean);
      currentValRef.current = targetClean;
      animatingTargetRef.current = targetClean;
      return;
    }

    // Deduplication: if already animating towards this target or already reached it, do not restart!
    if (animatingTargetRef.current === targetClean) {
      if (rafRef.current !== null || timerRef.current !== null || currentValRef.current === targetClean) {
        return;
      }
    }

    const startVal = currentValRef.current;
    const endVal = targetClean;
    if (startVal === endVal) {
      animatingTargetRef.current = endVal;
      return;
    }

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const timeSinceLast = now - lastUpdateRef.current;
    lastUpdateRef.current = now;

    // Fast-settle optimization during streaming/batch hydration:
    // If incoming updates arrive rapidly in succession (< 250ms apart while an animation is already in flight),
    // snap immediately to avoid an endless spinning slot machine effect on every batch chunk.
    if (timeSinceLast < 250 && rafRef.current !== null) {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      currentValRef.current = endVal;
      setDisplayValue(endVal);
      animatingTargetRef.current = endVal;
      return;
    }

    animatingTargetRef.current = endVal;

    // Small step counts (<= 15) finish swiftly without delay
    const delta = Math.abs(endVal - startVal);
    const effectiveDuration = delta <= 15 ? Math.min(duration, 180) : duration;

    let startTime: number | null = null;

    const tick = (now: number) => {
      if (startTime === null) startTime = now;
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / effectiveDuration);
      const eased = easeOutExpo(progress);
      const nextVal = Math.round(startVal + (endVal - startVal) * eased);

      currentValRef.current = nextVal;
      setDisplayValue(nextVal);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        currentValRef.current = endVal;
        setDisplayValue(endVal);
        rafRef.current = null;
      }
    };

    if (delay > 0) {
      timerRef.current = setTimeout(() => {
        rafRef.current = requestAnimationFrame(tick);
      }, delay);
    } else {
      rafRef.current = requestAnimationFrame(tick);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [targetClean, duration, delay, prefersReducedMotion]);

  return displayValue;
}

export interface OdometerProps {
  value: number;
  className?: string;
  format?: boolean;
  duration?: number;
  delay?: number;
  prefix?: string;
  suffix?: string;
  startFromZero?: boolean;
}

/**
 * Odometer / Smooth Running Number Component:
 * Runs smoothly on GPU 60/120 FPS using easeOutExpo requestAnimationFrame.
 * Numbers roll smoothly on data updates instead of snapping abruptly.
 */
export const Odometer: React.FC<OdometerProps> = React.memo(({
  value,
  className = '',
  format = false,
  duration = 340,
  delay = 0,
  prefix = '',
  suffix = '',
  startFromZero = false,
}) => {
  const animatedValue = useAnimatedNumber(value, { duration, delay, startFromZero });
  const text = format ? animatedValue.toLocaleString() : String(animatedValue);

  return (
    <span
      className={`odo font-figure tabular-nums tracking-tight ${className}`}
      role="text"
      aria-label={`${prefix}${Math.max(0, Math.round(value || 0))}${suffix}`}
    >
      {prefix}
      {text}
      {suffix}
    </span>
  );
});

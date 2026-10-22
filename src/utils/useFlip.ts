import { RefObject, useLayoutEffect, useRef } from 'react';

/**
 * FLIP (First, Last, Invert, Play) for table rows.
 * Put `data-flip="<stable key>"` on each row and call useFlip(containerRef, [the things that reorder the rows]).
 * After a filter, sort or page change the rows that were already on screen glide from their old position to the new
 * one using only `transform` (compositor only, no layout work while it plays). New rows fade in with `opacity`.
 * Skipped for very long lists and for people who asked the system for reduced motion.
 */
const MAX_ROWS = 400;
const SPRING = 'transform 0.46s cubic-bezier(0.32, 0.72, 0, 1)';

export function useFlip(ref: RefObject<HTMLElement | null>, deps: ReadonlyArray<unknown>) {
  const prev = useRef<Map<string, number>>(new Map());
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-flip]'));
    const next = new Map<string, number>();
    // read phase: all positions first (one layout), so nothing is forced to recalculate in a loop
    const tops = rows.map((el) => el.offsetTop);
    rows.forEach((el, i) => next.set(el.dataset.flip as string, tops[i]));
    const before = prev.current;
    prev.current = next;
    const calm = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (calm || rows.length > MAX_ROWS || before.size === 0) return;

    const moved: HTMLElement[] = [];
    const fresh: HTMLElement[] = [];
    rows.forEach((el, i) => {
      const old = before.get(el.dataset.flip as string);
      if (old === undefined) { fresh.push(el); return; }
      const dy = old - tops[i];
      if (Math.abs(dy) < 2) return;
      el.style.transition = 'none';                 // Invert: put the row back where it was
      el.style.transform = `translate3d(0, ${dy}px, 0)`;
      el.style.willChange = 'transform';
      moved.push(el);
    });
    fresh.forEach((el) => { el.style.opacity = '0'; el.style.transition = 'none'; });
    if (!moved.length && !fresh.length) return;
    void root.offsetHeight;                          // commit the inverted state once
    requestAnimationFrame(() => {                    // Play: release to the new position on the GPU
      moved.forEach((el) => {
        el.style.transition = SPRING;
        el.style.transform = '';
        const done = () => { el.style.transition = ''; el.style.willChange = ''; el.removeEventListener('transitionend', done); };
        el.addEventListener('transitionend', done);
      });
      fresh.forEach((el) => {
        el.style.transition = 'opacity 0.3s cubic-bezier(0.32, 0.72, 0, 1)';
        el.style.opacity = '';
        const done = () => { el.style.transition = ''; el.removeEventListener('transitionend', done); };
        el.addEventListener('transitionend', done);
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * (23 Oct 2026) One glide for a whole list when its page changes: the list body fades in and rises 6 px as ONE layer
 * (rows are not animated one by one – 50 separate row animations were the stutter on page change).
 * GPU-only (opacity + transform); nothing for people who asked their device for reduced motion.
 */
export function glideIn(el: Element | null | undefined) {
  if (!el || typeof (el as HTMLElement).animate !== 'function') return;
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  if ((el as HTMLElement).getAnimations?.().length) return;                     // already gliding (one glide per change)
  (el as HTMLElement).animate(
    [{ opacity: 0.25, transform: 'translate3d(0, 6px, 0)' }, { opacity: 1, transform: 'translate3d(0, 0, 0)' }],
    { duration: 260, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
  );
}

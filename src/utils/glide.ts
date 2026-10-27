/**
 * (23 Oct 2026) Smooth CSS-powered page transition: triggers the .page-glide-in animation
 * on the list body/rows container without shifting surrounding layout or pagination controls.
 * Hardware-accelerated, calm enterprise-banking motion, respects reduced motion.
 */
export function glideIn(el: Element | null | undefined) {
  if (!el || typeof window === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const htmlEl = el as HTMLElement;
  htmlEl.classList.remove('page-glide-in');
  requestAnimationFrame(() => {
    htmlEl.classList.add('page-glide-in');
  });
}

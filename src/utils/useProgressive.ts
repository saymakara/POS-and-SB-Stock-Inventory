import { useEffect, useRef, useState } from 'react';

/**
 * Progressive rendering for long lists (22 Oct 2026, review).
 * The first `first` rows are drawn at once; more are added in steps of `step` as the list is scrolled towards its end
 * (an invisible marker just below the last row). Changing any of `resetOn` (a filter, a search, a sort) starts again
 * from the top. Long lists therefore open instantly, and the whole list is still reachable by scrolling.
 *
 * Usage:
 *   const { visible, sentinelRef } = useProgressive(rows.length, [query, sort]);
 *   rows.slice(0, visible).map(...);  {visible < rows.length && <div ref={sentinelRef} />}
 */
export function useProgressive(total: number, resetOn: ReadonlyArray<unknown>, first = 60, step = 80) {
  const [visible, setVisible] = useState(first);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setVisible(first); }, resetOn);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || visible >= total || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((en) => { if (en.some((x) => x.isIntersecting)) setVisible((v) => v + step); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [visible, total, step]);
  const shown = typeof IntersectionObserver === 'undefined' ? total : Math.min(visible, total);
  return { visible: shown, sentinelRef, hasMore: shown < total };
}

import { startTransition, useEffect, useMemo, useState } from 'react';

export const PAGE_SIZES = [50, 100] as const;

/**
 * (23 Nov 2026, smoothness) Rows drawn in the first frame when a list appears or its page changes. The rest of the page
 * follows one painted frame later, so a screen shows at once instead of waiting for 50-100 rows to be drawn.
 * Only the drawing is staged: counts, "Showing x-y of z", selection and export always use the whole page.
 */
const FIRST_ROWS = 15;

/**
 * How many rows of a list may be drawn right now: FIRST_ROWS when the list first appears or `windowKey` (its page)
 * changes, then all of them one painted frame later. A data refresh on the same page never stages again.
 */
export function useDrawLimit(windowKey: string): number {
  const [drawnKey, setDrawnKey] = useState<string | null>(null);
  useEffect(() => {
    if (drawnKey === windowKey) return;
    let raf = requestAnimationFrame(() => {                       // after the first rows have been painted
      raf = requestAnimationFrame(() => startTransition(() => setDrawnKey(windowKey)));
    });
    return () => cancelAnimationFrame(raf);
  }, [windowKey, drawnKey]);
  return drawnKey === windowKey ? Infinity : FIRST_ROWS;
}

/**
 * One paging rule for every table: 50 rows per page (or 100). Changing a filter, a search or the sort returns to page 1.
 * Usage: const pg = usePager(rows.length, [query, filter]);  rows.slice(pg.start, pg.drawEnd)  <Pager pg={pg} />
 * (`end` is the page's real end; `drawEnd` is where drawing has reached, equal to `end` from the second frame on.)
 */
export function usePager(total: number, resetOn: ReadonlyArray<unknown> = []) {
  const [pageSize, setPageSize] = useState<number>(50);
  const [page, setPage] = useState(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); }, [pageSize, ...resetOn]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safe = Math.min(page, pages);
  const limit = useDrawLimit(`${safe}|${pageSize}`);
  return useMemo(() => {
    const start = (safe - 1) * pageSize;
    const end = Math.min(total, safe * pageSize);
    return {
      page: safe, pages, pageSize, total, start, end,
      drawEnd: Math.min(end, start + limit),
      setPage: (p: number) => startTransition(() => setPage(Math.max(1, Math.min(pages, p)))),   // drawn in the background: no freeze
      setPageSize: (n: number) => startTransition(() => setPageSize(n === 100 ? 100 : 50)),
    };
  }, [safe, pages, pageSize, total, limit]);
}
export type Pager = ReturnType<typeof usePager>;

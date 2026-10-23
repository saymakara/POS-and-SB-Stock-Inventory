import { startTransition, useEffect, useMemo, useState } from 'react';

export const PAGE_SIZES = [50, 100] as const;

/**
 * One paging rule for every table: 50 rows per page (or 100). Changing a filter, a search or the sort returns to page 1.
 * Usage: const pg = usePager(rows.length, [query, filter]);  rows.slice(pg.start, pg.end)  <Pager pg={pg} />
 */
export function usePager(total: number, resetOn: ReadonlyArray<unknown> = []) {
  const [pageSize, setPageSize] = useState<number>(50);
  const [page, setPage] = useState(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); }, [pageSize, ...resetOn]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safe = Math.min(page, pages);
  return useMemo(() => ({
    page: safe, pages, pageSize, total,
    start: (safe - 1) * pageSize,
    end: Math.min(total, safe * pageSize),
    setPage: (p: number) => startTransition(() => setPage(Math.max(1, Math.min(pages, p)))),   // drawn in the background: no freeze
    setPageSize: (n: number) => setPageSize(n === 100 ? 100 : 50),
  }), [safe, pages, pageSize, total]);
}
export type Pager = ReturnType<typeof usePager>;

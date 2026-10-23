import React, { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Pager as PagerState } from '../utils/usePager';
import { PAGE_SIZES } from '../utils/usePager';

/** The same page bar under every table: rows shown, page buttons and 50 / 100 rows per page. */
export const Pager: React.FC<{ pg: PagerState; label?: string }> = ({ pg, label = 'rows' }) => {
  const bar = useRef<HTMLDivElement | null>(null);
  /** Another page: the new rows glide in and the top of the list glides into view (only when it is above the screen). */
  const go = (p: number) => {
    pg.setPage(p);
    const box = bar.current?.parentElement;
    if (box && box.getBoundingClientRect().top < 0) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  if (pg.total === 0) return null;
  return (
    <div ref={bar} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 border-t border-slate-200 bg-slate-50 text-xs text-slate-600 rounded-b-xl">
      <div className="tabular-nums">Showing {pg.start + 1}–{pg.end} of {pg.total.toLocaleString()} {label}</div>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5">
          <span className="text-slate-500">Rows per page</span>
          <select value={pg.pageSize} onChange={(e) => pg.setPageSize(Number(e.target.value))}
            className="border border-slate-200 bg-white rounded-lg px-1.5 py-1 text-xs cursor-pointer" aria-label="Rows per page">
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => go(pg.page - 1)} disabled={pg.page <= 1} aria-label="Previous page"
          className="p-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-40 hover:bg-slate-100 cursor-pointer disabled:cursor-default"><ChevronLeft className="w-3.5 h-3.5" /></button>
        <span className="tabular-nums min-w-[72px] text-center">Page {pg.page} / {pg.pages}</span>
        <button type="button" onClick={() => go(pg.page + 1)} disabled={pg.page >= pg.pages} aria-label="Next page"
          className="p-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-40 hover:bg-slate-100 cursor-pointer disabled:cursor-default"><ChevronRight className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  );
};

import React, { useCallback, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';

/**
 * Sorting for every table (22 Oct 2026). Click a column heading: first click = ascending (A→Z, 0→9, oldest→newest),
 * second = descending, third = back to the original order. Numbers and numbers inside text (e.g. "Branch 9", "Branch 10")
 * are compared as numbers; empty cells always go last. The whole list is sorted, not just the page on screen.
 */
export type SortDir = 'asc' | 'desc';
export interface SortState { key: string; dir: SortDir }
export type Accessors<T> = Record<string, (row: T) => string | number | null | undefined>;

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || v === '—';

export function sortRows<T>(rows: T[], sort: SortState | null, acc: Accessors<T>): T[] {
  if (!sort || !acc[sort.key]) return rows;
  const get = acc[sort.key];
  const sign = sort.dir === 'asc' ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i, v: get(r) }))
    .sort((a, b) => {
      const ea = isEmpty(a.v), eb = isEmpty(b.v);
      if (ea || eb) return ea && eb ? a.i - b.i : ea ? 1 : -1;           // empty cells last, in both directions
      const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : collator.compare(String(a.v), String(b.v));
      return c !== 0 ? c * sign : a.i - b.i;
    })
    .map((x) => x.r);
}

export function useSort<T>(rows: T[], accessors: Accessors<T>, initial: SortState | null = null) {
  const [sort, setSort] = useState<SortState | null>(initial);
  const toggle = useCallback((key: string) => setSort((s) => (!s || s.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null)), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sorted = useMemo(() => sortRows(rows, sort, accessors), [rows, sort]);
  return { sorted, sort, toggle };
}

/** A column heading that sorts when clicked. Use inside <thead><tr>. */
export const SortTh: React.FC<{
  k: string; sort: SortState | null; onSort: (k: string) => void; children: React.ReactNode; className?: string; align?: 'left' | 'center' | 'right';
}> = ({ k, sort, onSort, children, className, align }) => {
  const active = sort?.key === k;
  const Icon = !active ? ChevronsUpDown : sort!.dir === 'asc' ? ArrowUp : ArrowDown;
  const just = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start';
  return (
    <th className={className} aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(k)} className={`sort-btn inline-flex items-center gap-1.5 cursor-pointer w-full ${just}`} title="Sort: ascending, descending, original order">
        <span>{children}</span>
        <Icon className={`w-3 h-3 shrink-0 ${active ? 'opacity-100' : 'opacity-40'}`} aria-hidden />
      </button>
    </th>
  );
};

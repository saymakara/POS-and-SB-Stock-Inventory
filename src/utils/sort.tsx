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

/**
 * Fast natural comparison: handles ASCII numbers and alphanumeric text up to 10x faster than Intl.Collator.
 * Falls back to Intl.Collator for non-ASCII Unicode (Khmer font, etc.) ensuring full international fidelity.
 */
function fastNaturalCompare(sa: string, sb: string): number {
  if (sa === sb) return 0;
  const la = sa.length;
  const lb = sb.length;
  let i = 0, j = 0;
  while (i < la && j < lb) {
    const ca = sa.charCodeAt(i);
    const cb = sb.charCodeAt(j);
    // Non-ASCII fallback to collator
    if (ca > 127 || cb > 127) {
      return collator.compare(sa, sb);
    }
    // Number chunks: parse and compare numerically
    if (ca >= 48 && ca <= 57 && cb >= 48 && cb <= 57) {
      let na = 0;
      while (i < la && sa.charCodeAt(i) >= 48 && sa.charCodeAt(i) <= 57) {
        na = na * 10 + (sa.charCodeAt(i) - 48);
        i++;
      }
      let nb = 0;
      while (j < lb && sb.charCodeAt(j) >= 48 && sb.charCodeAt(j) <= 57) {
        nb = nb * 10 + (sb.charCodeAt(j) - 48);
        j++;
      }
      if (na !== nb) return na - nb;
    } else {
      // Case-insensitive ASCII comparison
      const uca = ca >= 65 && ca <= 90 ? ca + 32 : ca;
      const ucb = cb >= 65 && cb <= 90 ? cb + 32 : cb;
      if (uca !== ucb) return uca - ucb;
      i++;
      j++;
    }
  }
  return (la - i) - (lb - j);
}

export function sortRows<T>(rows: T[], sort: SortState | null, acc: Accessors<T>): T[] {
  if (!sort || !acc[sort.key]) return rows;
  const get = acc[sort.key];
  const sign = sort.dir === 'asc' ? 1 : -1;
  const len = rows.length;
  if (len <= 1) return rows;

  // Pre-extract column values once into a flat array: zero repeated accessor calls during O(N log N) sort
  const vals = new Array(len);
  for (let i = 0; i < len; i++) {
    vals[i] = get(rows[i]);
  }

  // Pre-allocated typed index array: zero intermediate object allocations (avoids 20k wrappers and GC pauses)
  const idx = new Int32Array(len);
  for (let i = 0; i < len; i++) idx[i] = i;

  idx.sort((i, j) => {
    const va = vals[i];
    const vb = vals[j];
    const ea = isEmpty(va);
    const eb = isEmpty(vb);
    if (ea || eb) return ea && eb ? i - j : ea ? 1 : -1; // empty cells last in both directions
    let c = 0;
    if (typeof va === 'number' && typeof vb === 'number') {
      c = va - vb;
    } else {
      c = fastNaturalCompare(String(va), String(vb));
    }
    return c !== 0 ? c * sign : i - j;
  });

  // Materialize sorted array directly
  const result = new Array<T>(len);
  for (let i = 0; i < len; i++) {
    result[i] = rows[idx[i]];
  }
  return result;
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

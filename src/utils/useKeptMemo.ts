import { useMemo } from 'react';

/**
 * (31 Oct 2026, performance) Like useMemo, but the last result is kept when the screen closes.
 * Opening a screen again with the same data (same arrays, same filters) re-uses the result instead of
 * re-counting ~27,600 units. Each call site passes its own fixed key. The cache only holds the latest
 * result per key, so memory does not grow. Use it only for pure calculations of props/state.
 */
const kept = new Map<string, { deps: readonly unknown[]; value: unknown }>();

export function useKeptMemo<T>(key: string, factory: () => T, deps: readonly unknown[]): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => {
    const hit = kept.get(key);
    if (hit && hit.deps.length === deps.length && hit.deps.every((d, i) => Object.is(d, deps[i]))) return hit.value as T;
    const value = factory();
    kept.set(key, { deps, value });
    return value;
  }, deps);
}

/** Forget every kept result (called when the signed-in user changes). */
export function clearKeptMemos(): void { kept.clear(); }

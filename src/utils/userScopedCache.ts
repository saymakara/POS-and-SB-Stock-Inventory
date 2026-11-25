import { supabase, isSupabaseConfigured } from '../lib/supabase';

/**
 * (23 Nov 2026, refactor) One place for the rule every memory cache follows: what was loaded for one signed-in person is
 * emptied as soon as another person signs in, or on sign-out, so one person never sees another person's rows.
 * Before, each cache (audit, field events, stock pages, KHQR, staff, materials, KPI, installs) set up its own copy of
 * the same sign-in listener; they now share one, with the same behaviour.
 */
const clearers = new Set<() => void>();
let owner: string | null | undefined;          // undefined until the first sign-in event has been seen
let listening = false;

/** Runs `clear` whenever the signed-in user changes. */
export function clearOnUserChange(clear: () => void): void {
  clearers.add(clear);
  if (listening || !isSupabaseConfigured) return;
  listening = true;
  try {
    supabase.auth.onAuthStateChange((_e, session) => {
      const id = session?.user?.id ?? null;
      if (owner !== undefined && id !== owner) {
        clearers.forEach((fn) => { try { fn(); } catch { /* one cache failing never stops the others */ } });
      }
      owner = id;
    });
  } catch { /* the caches simply stay as they are */ }
}

/** The signed-in user the memory caches belong to (undefined before the first sign-in event, null when signed out). */
export const cacheOwner = (): string | null | undefined => owner;

/** Puts `value` in a small most-recently-used map, dropping the oldest entries above `max`. */
export function rememberRecent<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value as K);
}

/**
 * (25 Nov 2026, speed) Identical requests made at the same moment share one answer: the second caller waits for the
 * request already on its way instead of sending another. Nothing is kept afterwards, so every later call asks afresh
 * (the answer is never older than before).
 */
const inflight = new Map<string, Promise<unknown>>();
export function shareInflight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = run().finally(() => { inflight.delete(key); });
  inflight.set(key, p);
  return p;
}

/**
 * (25 Nov 2026, speed) Reads started early - at sign-in, while the account is being checked and the app is still being
 * opened - and handed to the first screen that asks for the same thing, instead of that screen asking again once it has
 * opened. Each early answer is used once, only within `maxAgeMs`, and only by the same signed-in person; an early read
 * that failed is simply asked again. No extra request is ever made: a read that is not taken is the one the app would
 * have made a moment later anyway.
 */
const early = new Map<string, { p: Promise<unknown>; at: number }>();
clearOnUserChange(() => early.clear());
export function startEarly<T>(key: string, run: () => Promise<T | null>): void {
  if (early.has(key)) return;
  // run() is called before the entry exists, so the read itself never waits for its own early answer
  const p = run().catch(() => null);
  early.set(key, { p, at: Date.now() });
}
/** The early answer for `key` (once), or null when there is none / it failed / it is too old. */
export async function takeEarly<T>(key: string, maxAgeMs = 20_000): Promise<T | null> {
  const e = early.get(key);
  if (!e) return null;
  early.delete(key);
  if (Date.now() - e.at > maxAgeMs) return null;
  return ((await e.p) as T | null) ?? null;
}
export const hasEarly = (key: string): boolean => early.has(key);

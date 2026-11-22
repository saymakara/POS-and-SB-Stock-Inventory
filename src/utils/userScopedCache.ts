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

import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { fetchPendingFieldEvents, fetchReviewedFieldEvents } from './supabaseService';
import type { FieldEvent } from './supabaseService';

/**
 * (29 Oct 2026) Phone App Review (POS Terminal and Sound Box): instant opening.
 * The records are kept in memory (this browser tab only, never on disk) and shown at once when the screen opens; the
 * fresh list replaces them quietly. The same records are fetched in the background right after sign-in. The memory is
 * emptied when the signed-in user changes.
 */
let events: FieldEvent[] | null = null;
let owner: string | null | undefined;

export const clearFieldCache = () => { events = null; };
export const getCachedFieldEvents = () => events;
export const setCachedFieldEvents = (list: FieldEvent[]) => { events = list; };

if (isSupabaseConfigured) {
  try {
    supabase.auth.onAuthStateChange((_e, session) => {
      const id = session?.user?.id ?? null;
      if (owner !== undefined && id !== owner) clearFieldCache();
      owner = id;
    });
  } catch { /* the cache simply stays empty */ }
}

let inflight: Promise<void> | null = null;
export function prefetchFieldEvents(): Promise<void> {
  if (!isSupabaseConfigured) return Promise.resolve();
  if (inflight) return inflight;
  inflight = (async () => {
    const pendingReq = fetchPendingFieldEvents(1000, 0);
    const reviewedReq = fetchReviewedFieldEvents(1000, 0);
    const pending = await pendingReq;
    if (pending && !events) events = pending;                     // the Waiting list is usable as soon as it arrives
    const reviewed = await reviewedReq;
    if (pending || reviewed) {
      const keepPending = pending ?? (events || []).filter((e) => e.status === 'PENDING');
      const keepReviewed = reviewed ?? (events || []).filter((e) => e.status !== 'PENDING');
      events = [...keepPending, ...keepReviewed];
    }
  })().catch(() => {}).finally(() => { inflight = null; });
  return inflight;
}

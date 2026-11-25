import { isSupabaseConfigured } from '../lib/supabase';
import { fetchAllPendingFieldEvents, fetchReviewedFieldEvents, type FieldEvent } from './supabaseService';
import { clearFresh, isFresh, markFresh } from '../utils/freshness';
import { registerPortalCacheInvalidator } from '../utils/portalSync';
import { clearOnUserChange } from '../utils/userScopedCache';

/**
 * (29 Oct 2026) Phone App Review (POS Terminal and Sound Box): instant opening.
 * The records are kept in memory (this browser tab only, never on disk) and shown at once when the screen opens; the
 * fresh list replaces them quietly. The same records are fetched in the background right after sign-in. The memory is
 * emptied when the signed-in user changes.
 */
let events: FieldEvent[] | null = null;
let pendingComplete = false;
let reviewedComplete = false;

export const clearFieldCache = () => { events = null; pendingComplete = false; reviewedComplete = false; };
registerPortalCacheInvalidator(['field'], () => { clearFresh('field'); });
export const getCachedFieldEvents = () => events;
export const isFieldCacheComplete = () => pendingComplete;
export const isFieldReviewedReady = () => reviewedComplete;
export const setCachedFieldEvents = (list: FieldEvent[], complete = pendingComplete, reviewed = reviewedComplete) => {
  events = list;
  pendingComplete = complete;
  reviewedComplete = reviewed;
};

clearOnUserChange(clearFieldCache);

let inflight: Promise<void> | null = null;
/** (25 Nov 2026) The background read still on its way (null when none): the screen waits for it instead of reading again. */
export const fieldPrefetchRunning = (): Promise<void> | null => inflight;
const firstPageListeners = new Set<(list: FieldEvent[]) => void>();
/** (25 Nov 2026) Called once the first page of waiting records of the background read is here (the screen shows it at once). */
export const onFieldFirstPage = (fn: (list: FieldEvent[]) => void) => { firstPageListeners.add(fn); return () => { firstPageListeners.delete(fn); }; };
export function prefetchFieldEvents(): Promise<void> {
  if (!isSupabaseConfigured) return Promise.resolve();
  if (events && pendingComplete && reviewedComplete && isFresh('field', 300_000)) return Promise.resolve();
  if (inflight) return inflight;
  inflight = (async () => {
    const pendingReq = fetchAllPendingFieldEvents((firstPage) => {
      if (!events) {
        events = firstPage;
        pendingComplete = false;
      }
      firstPageListeners.forEach((fn) => { try { fn(firstPage); } catch { /* a screen that is gone */ } });
    });
    const reviewedReq = fetchReviewedFieldEvents(1000, 0);
    const pending = await pendingReq;
    if (pending) {
      events = [...pending, ...(events || []).filter((e) => e.status !== 'PENDING')];
      pendingComplete = true;                     // complete PENDING set across all pages
      markFresh('field');
    }
    const reviewed = await reviewedReq;
    if (pending || reviewed) {
      const keepPending = pending ?? (events || []).filter((e) => e.status === 'PENDING');
      const keepReviewed = reviewed ?? (events || []).filter((e) => e.status !== 'PENDING');
      events = [...keepPending, ...keepReviewed];
      if (pending) {
        pendingComplete = true;
        markFresh('field');
      }
      if (reviewed) {
        reviewedComplete = true;
      }
    }
  })().catch(() => {}).finally(() => { inflight = null; });
  return inflight;
}

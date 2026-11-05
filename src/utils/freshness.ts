/**
 * (5 Nov 2026, speed) When each answer was last fetched. A page that is opened again within a short time shows the copy
 * it already has and does not ask the database again (every request costs ~0.5-1 s on a slow connection); live updates
 * keep that copy current, and Refresh always asks the database. Memory only; emptied on sign-out.
 */
const at = new Map<string, number>();
export const markFresh = (key: string) => { at.set(key, Date.now()); };
export const isFresh = (key: string, maxAgeMs = 45000) => Date.now() - (at.get(key) || 0) < maxAgeMs;
/** Forget one group ("qr:") or everything. */
export function clearFresh(prefix = ''): void {
  if (!prefix) { at.clear(); return; }
  Array.from(at.keys()).forEach((k) => { if (k.startsWith(prefix)) at.delete(k); });
}

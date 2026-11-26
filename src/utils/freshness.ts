/**
 * (5 Nov 2026, speed) When each answer was last fetched. A page that is opened again within a short time shows the copy
 * it already has and does not ask the database again (every request costs ~0.5-1 s on a slow connection); live updates
 * keep that copy current, and Refresh always asks the database. Memory only; emptied on sign-out.
 */
const at = new Map<string, number>();
export const markFresh = (key: string) => { at.set(key, Date.now()); };
/**
 * (26 Nov 2026, fewer reads) While the live feed (Supabase realtime) is connected, every change to these screens' data
 * reaches this browser and empties their copy at once (registerPortalCacheInvalidator). So a copy that is still here is
 * still right: going back to the screen shows it without asking the database again, for up to 10 minutes (a safety
 * limit). When the live feed is down, the short rules apply as before; when it comes back, every copy is treated as
 * old once (a change may have been missed meanwhile).
 */
const LIVE_MAX_MS = 10 * 60_000;
const LIVE_COVERED = ['mv:', 'field', 'mat:'];                     // screens whose every change comes through the live feed
let live = false, wasLive = false;
export function setLiveSync(on: boolean): void {
  if (on && !live && wasLive) at.clear();                           // reconnected: what came meanwhile is read again
  live = on;
  if (on) wasLive = true;
}
export const isLiveSync = () => live;
/** The age a copy may reach: `maxAgeMs`, or up to 10 minutes while the live feed is connected. */
export const liveMaxAge = (maxAgeMs: number) => (live && maxAgeMs > 0 ? Math.max(maxAgeMs, LIVE_MAX_MS) : maxAgeMs);
export const isFresh = (key: string, maxAgeMs = 45000) => {
  const age = Date.now() - (at.get(key) || 0);
  if (age < maxAgeMs) return true;
  return live && age < LIVE_MAX_MS && LIVE_COVERED.some((p) => key.startsWith(p));
};
/** Forget one group ("qr:") or everything. */
export function clearFresh(prefix = ''): void {
  if (!prefix) { at.clear(); return; }
  Array.from(at.keys()).forEach((k) => { if (k.startsWith(prefix)) at.delete(k); });
}

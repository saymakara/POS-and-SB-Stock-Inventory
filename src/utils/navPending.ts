// (13 Nov 2026, speed) The page a tap has just chosen, before the new page has been drawn. The sidebar and the phone tab bar
// show it at once (one small re-render), while App draws the page itself as a background (transition) render that never
// blocks the next frame. Cleared when the page is on screen, or after 2 s if the tap led nowhere (e.g. a refused page).
import { useSyncExternalStore } from 'react';

let pending: string | null = null;
/** When the last page change started (and the app's first draw): see PillMotion. */
export let pageSwitchAt = typeof performance !== 'undefined' ? performance.now() : 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const subscribers = new Set<() => void>();

export function setPendingTab(id: string | null): void {
  if (pending === id) return;
  pending = id;
  if (id && typeof performance !== 'undefined') pageSwitchAt = performance.now();
  clearTimeout(timer);
  if (id) timer = setTimeout(() => setPendingTab(null), 2000);
  subscribers.forEach((fn) => fn());
}

export function usePendingTab(): string | null {
  return useSyncExternalStore(
    (cb) => { subscribers.add(cb); return () => { subscribers.delete(cb); }; },
    () => pending,
    () => null,
  );
}

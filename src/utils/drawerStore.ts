import { useSyncExternalStore } from 'react';

/**
 * (31 Oct 2026, native-like) Phone menu (drawer) open / closed. Kept outside the main page state so opening or closing
 * the menu redraws only the menu, not the whole page underneath: the tap answers at once on slow phones.
 */
let open = false;
const subs = new Set<() => void>();
export const getDrawerOpen = () => open;
export function setDrawerOpen(v: boolean | ((prev: boolean) => boolean)): void {
  const next = typeof v === 'function' ? v(open) : v;
  if (next === open) return;
  open = next;
  subs.forEach((f) => f());
}
export const closeDrawer = () => setDrawerOpen(false);
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useDrawerOpen = () => useSyncExternalStore(subscribe, getDrawerOpen, getDrawerOpen);

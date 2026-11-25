/**
 * (25 Nov 2026, free-plan quota) One rule for "the person came back to the portal tab": run `fn` when the tab is shown
 * again, but only after it was hidden for at least `minHiddenMs`, and not more often than every `minGapMs`.
 * Live updates (Supabase Realtime) keep an open portal current while it is in the background, so a short switch to
 * Telegram and back no longer re-downloads the same lists.
 * Returns the function that removes the listener.
 */
export function onTabReturn(fn: () => void, opts: { minHiddenMs?: number; minGapMs?: number } = {}): () => void {
  if (typeof document === 'undefined') return () => {};
  const minHidden = opts.minHiddenMs ?? 0;
  const minGap = opts.minGapMs ?? 0;
  let hiddenAt = document.visibilityState === 'hidden' ? Date.now() : 0;
  let lastRun = Date.now();                                        // the screen has just loaded its data
  const onVis = () => {
    const now = Date.now();
    if (document.visibilityState !== 'visible') { hiddenAt = now; return; }
    const away = hiddenAt ? now - hiddenAt : 0;
    hiddenAt = 0;
    if (away < minHidden || now - lastRun < minGap) return;
    lastRun = now;
    fn();
  };
  document.addEventListener('visibilitychange', onVis);
  return () => document.removeEventListener('visibilitychange', onVis);
}

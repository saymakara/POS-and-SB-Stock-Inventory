/**
 * Protection against runaway save loops (23 Oct 2026).
 *
 * On 22 Oct one screen kept re-sending a refused save about 100 times a second for nearly an hour: ~275,000 error
 * lines in the Supabase log, which used up the free log allowance. These pieces make that impossible:
 *
 *  - SaveGuard (circuit breaker): after FAILS failures within WINDOW_MS, saving from this screen is paused for
 *    PAUSE_MS and the user is asked to reload. A success clears the count.
 *  - throttled(): the "reload everything from the server" that follows a refused save runs at most once per
 *    MIN_GAP_MS, however many saves fail meanwhile, and waits longer after each consecutive failure (2 s, 6 s, 20 s).
 *  - watchNewVersion(): checks on tab visibility change (no background polling loop) whether a newer version was
 *    published, so an old tab is asked to reload instead of running old code.
 */
const FAILS = 4;
const WINDOW_MS = 60_000;
const PAUSE_MS = 120_000;
const BACKOFF_MS = [2_000, 6_000, 20_000];

export class SaveGuard {
  private stamps: number[] = [];
  private pausedUntil = 0;
  private streak = 0;

  /** True while saving is paused. */
  isOpen(now = Date.now()): boolean {
    return now < this.pausedUntil;
  }
  /** Seconds until saving is allowed again (0 when allowed). */
  secondsLeft(now = Date.now()): number {
    return Math.max(0, Math.ceil((this.pausedUntil - now) / 1000));
  }
  /** Record a failed save. Returns true when this failure opened the breaker. */
  fail(now = Date.now()): boolean {
    this.streak++;
    this.stamps = this.stamps.filter((t) => now - t < WINDOW_MS);
    this.stamps.push(now);
    if (this.stamps.length >= FAILS && !this.isOpen(now)) {
      this.pausedUntil = now + PAUSE_MS;
      this.stamps = [];
      return true;
    }
    return false;
  }
  /** Record a successful save. */
  ok(): void {
    this.stamps = [];
    this.streak = 0;
  }
  /** How long to wait before the next automatic reload, growing with each consecutive failure. */
  backoffMs(): number {
    return BACKOFF_MS[Math.min(Math.max(this.streak, 1), BACKOFF_MS.length) - 1];
  }
}

/** Runs `fn` at most once per `gap` ms; calls in between share the result of the one already running or just done. */
export function throttled<T>(fn: () => Promise<T>, gap: () => number): () => Promise<T | undefined> {
  let last = 0;
  let running: Promise<T> | null = null;
  return async () => {
    if (running) return running;
    if (Date.now() - last < gap()) return undefined;
    last = Date.now();
    running = fn().finally(() => { running = null; });
    return running;
  };
}

/**
 * Calls `onNew` once when the published site has a different main script than the one this page loaded.
 * Checks only when the tab becomes visible again (with a minimum cooldown between checks — no background setInterval polling loop).
 */
export function watchNewVersion(onNew: () => void, minCooldownMs = 10 * 60_000): () => void {
  if (typeof document === 'undefined') return () => {};
  const scriptOf = (html: string) => (html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/) || [])[1] || '';
  const mine = scriptOf(document.documentElement.outerHTML.includes('type="module"') ? document.documentElement.outerHTML : '');
  if (!mine) return () => {};                                         // dev server: no hashed bundle, nothing to compare
  let done = false;
  let lastCheckedAt = Date.now();
  const check = async () => {
    if (done || document.visibilityState !== 'visible') return;
    if (Date.now() - lastCheckedAt < minCooldownMs) return;
    lastCheckedAt = Date.now();
    try {
      const res = await fetch(`./index.html?v=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const theirs = scriptOf(await res.text());
      if (theirs && theirs !== mine) { done = true; onNew(); }
    } catch { /* offline: try again later */ }
  };
  const onVis = () => { if (document.visibilityState === 'visible') void check(); };
  document.addEventListener('visibilitychange', onVis);
  return () => { done = true; document.removeEventListener('visibilitychange', onVis); };
}

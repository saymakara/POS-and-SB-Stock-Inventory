/**
 * Lightweight cross-user and cross-tab live synchronization bus.
 * Coordinates cache invalidation and active-screen refreshes across Postgres CDC,
 * Supabase Realtime broadcast, same-browser BroadcastChannel, and local mutations.
 */

export type SyncDomain =
  | 'devices'
  | 'requisitions'
  | 'field'
  | 'qr'
  | 'cc'
  | 'materials'
  | 'kpi'
  | 'mv'
  | 'branches'
  | 'staff'
  | 'audit'
  | 'notifs';

/** (25 Nov 2026) local: at least one of the changes in this batch was made in this browser (not only by someone else). */
export interface SyncInfo { local: boolean }

interface ListenerEntry {
  domains: Set<SyncDomain>;
  cb: (changed: Set<SyncDomain>, info: SyncInfo) => void;
}

interface InvalidatorEntry {
  domains: Set<SyncDomain>;
  fn: () => void;
}

const listeners = new Set<ListenerEntry>();
const invalidators = new Set<InvalidatorEntry>();
const pendingEmit = new Set<SyncDomain>();
const pendingBroadcast = new Set<SyncDomain>();
const TAB_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

let emitTimer: number | null = null;
let pendingLocal = false;
let broadcastTimer: number | null = null;
let remoteSender: ((domains: SyncDomain[]) => void) | null = null;

// Optional same-browser tab sync channel (instant across tabs on the same workstation)
let localBc: BroadcastChannel | null = null;
if (typeof BroadcastChannel !== 'undefined') {
  try {
    localBc = new BroadcastChannel('pos_portal_live_sync_v1');
    localBc.onmessage = (ev: MessageEvent) => {
      const msg = ev?.data;
      if (!msg || msg.sender === TAB_ID || !Array.isArray(msg.domains)) return;
      emitPortalSync(msg.domains as SyncDomain[], { source: 'remote', broadcast: false });
    };
  } catch {
    localBc = null;
  }
}

export function getPortalTabId(): string {
  return TAB_ID;
}

export function registerPortalBroadcastSender(sender: ((domains: SyncDomain[]) => void) | null): void {
  remoteSender = sender;
}

function flushEmit(): void {
  emitTimer = null;
  if (pendingEmit.size === 0) return;
  const changed = new Set(pendingEmit);
  pendingEmit.clear();
  const info: SyncInfo = { local: pendingLocal };
  pendingLocal = false;

  listeners.forEach((entry) => {
    for (const d of changed) {
      if (entry.domains.has(d)) {
        try {
          entry.cb(changed, info);
        } catch {
          /* listener errors must not break sibling subscribers */
        }
        break;
      }
    }
  });
}

function flushBroadcast(): void {
  broadcastTimer = null;
  if (pendingBroadcast.size === 0) return;
  const list = Array.from(pendingBroadcast);
  pendingBroadcast.clear();

  if (localBc) {
    try {
      localBc.postMessage({ sender: TAB_ID, domains: list });
    } catch {
      /* channel may be closed */
    }
  }
  if (remoteSender) {
    try {
      remoteSender(list);
    } catch {
      /* network optional */
    }
  }
}

export function registerPortalCacheInvalidator(
  domains: SyncDomain | SyncDomain[],
  fn: () => void
): () => void {
  const entry: InvalidatorEntry = {
    domains: new Set(Array.isArray(domains) ? domains : [domains]),
    fn,
  };
  invalidators.add(entry);
  return () => {
    invalidators.delete(entry);
  };
}

/**
 * Notify active screens that one or more domains changed.
 * Set `broadcast: true` only for local user mutations so other users & tabs refresh too.
 */
export function emitPortalSync(
  domains: SyncDomain | SyncDomain[],
  opts: { broadcast?: boolean; source?: 'local' | 'remote'; skipInvalidate?: boolean } = {}
): void {
  const list = Array.isArray(domains) ? domains : [domains];
  if (list.length === 0) return;

  if (!opts.skipInvalidate) {
    invalidators.forEach((entry) => {
      for (const d of list) {
        if (entry.domains.has(d)) {
          try {
            entry.fn();
          } catch {
            /* ignore cache invalidation errors */
          }
          break;
        }
      }
    });
  }

  if (opts.source !== 'remote') pendingLocal = true;
  for (const d of list) {
    pendingEmit.add(d);
    if (opts.broadcast && opts.source !== 'remote') {
      pendingBroadcast.add(d);
    }
  }

  if (emitTimer === null && typeof window !== 'undefined') {
    emitTimer = window.setTimeout(flushEmit, 60);
  } else if (typeof window === 'undefined') {
    flushEmit();
  }

  if (pendingBroadcast.size > 0 && broadcastTimer === null && typeof window !== 'undefined') {
    broadcastTimer = window.setTimeout(flushBroadcast, 80);
  }
}

export function onPortalSync(
  domains: SyncDomain | SyncDomain[],
  cb: (changed: Set<SyncDomain>, info: SyncInfo) => void
): () => void {
  const entry: ListenerEntry = {
    domains: new Set(Array.isArray(domains) ? domains : [domains]),
    cb,
  };
  listeners.add(entry);
  return () => {
    listeners.delete(entry);
  };
}

/**
 * (25 Nov 2026, speed + free-plan quota) One rule for refreshing a heavy screen (the KPI summary is ~1.4 MB) when data
 * changes: a change made in this browser refreshes after `delayMs` as before; changes made by others (a KHQR entry can
 * arrive every few seconds) refresh at most once per `minGapMs` - the server keeps its KPI answer 3 minutes anyway, so
 * asking more often brought back the same figures - and a tab in the background waits until it is shown again, then
 * refreshes once. Nothing is skipped: the last change always leads to a refresh.
 */
export function createRefreshScheduler(run: () => void, opts: { delayMs?: number; minGapMs?: number } = {}) {
  const delayMs = opts.delayMs ?? 700;
  const minGapMs = opts.minGapMs ?? 60_000;
  let timer = 0;
  let lastRun = -Infinity;                                  // never refreshed yet: the first change is shown after delayMs
  let waitingForTab = false;
  const fire = () => { timer = 0; lastRun = Date.now(); run(); };
  const onVisible = () => {
    if (typeof document === 'undefined' || document.hidden || !waitingForTab) return;
    waitingForTab = false;
    window.clearTimeout(timer);
    timer = window.setTimeout(fire, delayMs);
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  return {
    trigger(info?: SyncInfo) {
      if (typeof window === 'undefined') { run(); return; }
      if (info?.local) {                                    // the person's own change: shown as quickly as before
        window.clearTimeout(timer);
        timer = window.setTimeout(fire, delayMs);
        return;
      }
      if (typeof document !== 'undefined' && document.hidden) { waitingForTab = true; return; }
      if (timer) return;                                    // already planned: this change is included
      const wait = Math.max(delayMs, lastRun + minGapMs - Date.now());
      timer = window.setTimeout(fire, wait);
    },
    dispose() {
      window.clearTimeout(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    },
  };
}

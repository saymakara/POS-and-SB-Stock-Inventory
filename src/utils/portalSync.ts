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

interface ListenerEntry {
  domains: Set<SyncDomain>;
  cb: (changed: Set<SyncDomain>) => void;
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

  listeners.forEach((entry) => {
    for (const d of changed) {
      if (entry.domains.has(d)) {
        try {
          entry.cb(changed);
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
  cb: (changed: Set<SyncDomain>) => void
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

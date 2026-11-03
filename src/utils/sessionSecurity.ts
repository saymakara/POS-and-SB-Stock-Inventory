/**
 * Workstation Session Security & Multi-Tab Synchronization.
 *
 * Guarantees that:
 * 1. When a session is locked in any browser tab (manually or via inactivity),
 *    all existing open tabs and ANY new tabs opened on the same browser are
 *    immediately locked and require password verification.
 * 2. Refreshing a locked tab never bypasses the lock.
 * 3. Unlocking or signing out in any tab immediately synchronizes across all open tabs.
 */

export const STORAGE_KEY_WORKSTATION_LOCKED = 'crm_pos_workstation_locked_v1';
export const STORAGE_KEY_LAST_ACTIVITY = 'crm_pos_last_activity_v1';
const BROADCAST_CHANNEL_NAME = 'crm_pos_session_security_v1';

export interface WorkstationLockState {
  locked: boolean;
  lockedAt: number;
  operatorName?: string;
  operatorRole?: string;
  empId?: string;
  reason?: 'manual' | 'inactivity';
}

export type SessionSecurityMessage =
  | { type: 'LOCK'; payload?: WorkstationLockState }
  | { type: 'UNLOCK' }
  | { type: 'SIGNOUT' }
  | { type: 'ACTIVITY'; timestamp: number };

let broadcastChannel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  if (!broadcastChannel) {
    try {
      broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    } catch {
      broadcastChannel = null;
    }
  }
  return broadcastChannel;
}

/** Check if the workstation is currently locked in persistent storage */
export function isWorkstationLocked(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_WORKSTATION_LOCKED);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return Boolean(parsed && parsed.locked);
  } catch {
    return false;
  }
}

/** Get full metadata of the current lock state */
export function getWorkstationLockState(): WorkstationLockState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_WORKSTATION_LOCKED);
    if (!raw) return null;
    return JSON.parse(raw) as WorkstationLockState;
  } catch {
    return null;
  }
}

/** Lock the workstation and immediately broadcast across all browser tabs */
export function lockWorkstation(meta?: Partial<WorkstationLockState>): void {
  if (typeof window === 'undefined') return;
  const state: WorkstationLockState = {
    locked: true,
    lockedAt: Date.now(),
    operatorName: meta?.operatorName,
    operatorRole: meta?.operatorRole,
    empId: meta?.empId,
    reason: meta?.reason || 'manual',
  };

  try {
    localStorage.setItem(STORAGE_KEY_WORKSTATION_LOCKED, JSON.stringify(state));
  } catch {}

  const ch = getChannel();
  if (ch) {
    try {
      ch.postMessage({ type: 'LOCK', payload: state });
    } catch {}
  }
}

/** Unlock the workstation and notify all open browser tabs */
export function unlockWorkstation(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY_WORKSTATION_LOCKED);
  } catch {}

  const ch = getChannel();
  if (ch) {
    try {
      ch.postMessage({ type: 'UNLOCK' });
    } catch {}
  }
}

/** Clear the lock without broadcasting (used during clean sign-out) */
export function clearWorkstationLock(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY_WORKSTATION_LOCKED);
  } catch {}
}

/** Broadcast sign-out across all open browser tabs */
export function notifySessionSignOut(): void {
  clearWorkstationLock();
  const ch = getChannel();
  if (ch) {
    try {
      ch.postMessage({ type: 'SIGNOUT' });
    } catch {}
  }
}

/** Record operator activity timestamp so all tabs know user is active */
export function recordCrossTabActivity(): void {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  try {
    localStorage.setItem(STORAGE_KEY_LAST_ACTIVITY, String(now));
  } catch {}
  const ch = getChannel();
  if (ch) {
    try {
      ch.postMessage({ type: 'ACTIVITY', timestamp: now });
    } catch {}
  }
}

/** Subscribe to session lock, unlock, signout, and activity events across all tabs */
export function subscribeSessionSecurity(callbacks: {
  onLock: (state?: WorkstationLockState) => void;
  onUnlock: () => void;
  onSignOut?: () => void;
  onActivity?: (timestamp: number) => void;
}): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY_WORKSTATION_LOCKED) {
      if (e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (parsed?.locked) callbacks.onLock(parsed);
        } catch {
          callbacks.onLock();
        }
      } else {
        callbacks.onUnlock();
      }
    } else if (e.key === STORAGE_KEY_LAST_ACTIVITY && e.newValue) {
      callbacks.onActivity?.(Number(e.newValue));
    }
  };

  window.addEventListener('storage', handleStorage);

  const ch = getChannel();
  const handleMessage = (event: MessageEvent<SessionSecurityMessage>) => {
    const msg = event.data;
    if (!msg || !msg.type) return;
    if (msg.type === 'LOCK') {
      callbacks.onLock(msg.payload);
    } else if (msg.type === 'UNLOCK') {
      callbacks.onUnlock();
    } else if (msg.type === 'SIGNOUT') {
      callbacks.onSignOut?.();
    } else if (msg.type === 'ACTIVITY') {
      callbacks.onActivity?.(msg.timestamp);
    }
  };

  if (ch) {
    ch.addEventListener('message', handleMessage);
  }

  return () => {
    window.removeEventListener('storage', handleStorage);
    if (ch) {
      ch.removeEventListener('message', handleMessage);
    }
  };
}

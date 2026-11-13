import { Device, Requisition, Branch, HistoricalMerchantRecord } from '../types';
import { pageSwitchAt } from './navPending';

const DB_NAME = 'pos_sb_stock_inventory_db';
const DB_VERSION = 2;
const STORE_DEVICES = 'devices';
const STORE_REQUISITIONS = 'requisitions';
const STORE_HISTORICAL = 'historical_merchants';
const STORE_BRANCHES = 'branches';
const STORE_META = 'metadata';

let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.reject(new Error('IndexedDB is not supported in this environment'));
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_DEVICES)) {
          const deviceStore = db.createObjectStore(STORE_DEVICES, { keyPath: 'serial' });
          deviceStore.createIndex('branchId', 'branchId', { unique: false });
          deviceStore.createIndex('stage', 'stage', { unique: false });
          deviceStore.createIndex('type', 'type', { unique: false });
          deviceStore.createIndex('mid', 'mid', { unique: false });
          deviceStore.createIndex('stockInDate', 'stockInDate', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_REQUISITIONS)) {
          db.createObjectStore(STORE_REQUISITIONS, { keyPath: 'reqId' });
        }
        if (!db.objectStoreNames.contains(STORE_HISTORICAL)) {
          db.createObjectStore(STORE_HISTORICAL, { keyPath: 'recordId' });
        }
        if (!db.objectStoreNames.contains(STORE_BRANCHES)) {
          db.createObjectStore(STORE_BRANCHES, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        dbPromise = null;
        reject(request.error);
      };
    });
  }

  return dbPromise;
}

export interface CachedInventorySnapshot {
  devices: Device[] | null;
  requisitions: Requisition[] | null;
  historicalMerchants: HistoricalMerchantRecord[] | null;
  branches: Branch[] | null;
  timestamp?: string;
}

/**
 * Loads the complete cached dataset from IndexedDB in a single fast transaction.
 * Resolves within ~10-25ms to enable instantaneous UI hydration on startup.
 */
export async function loadFullCacheFromIdb(): Promise<CachedInventorySnapshot> {
  try {
    const db = await getDb();
    const stores = [STORE_DEVICES, STORE_REQUISITIONS, STORE_HISTORICAL, STORE_BRANCHES, STORE_META].filter((s) =>
      db.objectStoreNames.contains(s)
    );
    if (!stores.includes(STORE_DEVICES)) {
      return { devices: null, requisitions: null, historicalMerchants: null, branches: null };
    }

    return new Promise((resolve) => {
      const tx = db.transaction(stores, 'readonly');
      let devices: Device[] | null = null;
      let requisitions: Requisition[] | null = null;
      let historicalMerchants: HistoricalMerchantRecord[] | null = null;
      let branches: Branch[] | null = null;
      let timestamp: string | undefined;

      const devReq = tx.objectStore(STORE_DEVICES).getAll();
      devReq.onsuccess = () => {
        if (devReq.result && devReq.result.length > 0) {
          devices = devReq.result;
          // the store now holds exactly these copies: later saves only write what differs from them
          persistedDevices.clear();
          for (const d of devReq.result as Device[]) persistedDevices.set(d.serial, d);
        }
      };

      if (stores.includes(STORE_REQUISITIONS)) {
        const reqReq = tx.objectStore(STORE_REQUISITIONS).getAll();
        reqReq.onsuccess = () => {
          if (reqReq.result && reqReq.result.length > 0) {
            requisitions = reqReq.result;
            persistedReqs.clear();
            for (const r of reqReq.result as Requisition[]) persistedReqs.set(r.reqId, r);
          }
        };
      }

      if (stores.includes(STORE_HISTORICAL)) {
        const histReq = tx.objectStore(STORE_HISTORICAL).getAll();
        histReq.onsuccess = () => {
          if (histReq.result && histReq.result.length > 0) historicalMerchants = histReq.result;
        };
      }

      if (stores.includes(STORE_BRANCHES)) {
        const branchReq = tx.objectStore(STORE_BRANCHES).getAll();
        branchReq.onsuccess = () => {
          if (branchReq.result && branchReq.result.length > 0) branches = branchReq.result;
        };
      }

      if (stores.includes(STORE_META)) {
        const metaReq = tx.objectStore(STORE_META).get('last_device_save');
        metaReq.onsuccess = () => {
          if (metaReq.result?.timestamp) timestamp = metaReq.result.timestamp;
        };
      }

      tx.oncomplete = () => {
        resolve({ devices, requisitions, historicalMerchants, branches, timestamp });
      };

      tx.onerror = () => {
        resolve({ devices: null, requisitions: null, historicalMerchants: null, branches: null });
      };
    });
  } catch (err) {
    console.warn('[IndexedDB] Error loading full cache:', err);
    return { devices: null, requisitions: null, historicalMerchants: null, branches: null };
  }
}

/**
 * High-Throughput Bulk Device Persister (IndexedDB)
 * Handles up to 500,000+ hardware devices without memory crashes or quota limits.
 */
// (13 Nov 2026, speed, phase 2) Background saves never share a frame with a tap or a page being drawn.
// Every put() copies the record on the main thread (structured clone): ~27,600 units are ~2.9 s of work on a slower laptop.
// The work is cut into slices of at most SLICE_MS, each run in an idle moment, and a slice waits while the user has just
// tapped, typed or scrolled, or a page switch is under way.
const SLICE_MS = 6;
const QUIET_AFTER_INPUT_MS = 700;
let lastInputAt = 0;
if (typeof window !== 'undefined') {
  const mark = () => { lastInputAt = performance.now(); };
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, mark, { capture: true, passive: true });
}
type IdleWin = Window & { requestIdleCallback?: (cb: (d: { timeRemaining: () => number; didTimeout: boolean }) => void, o?: { timeout: number }) => number };
/** Resolves with the time this slice may use: in an idle moment after any recent input / page switch has settled. */
function whenQuiet(): Promise<number> {
  const w = (typeof window !== 'undefined' ? window : undefined) as IdleWin | undefined;
  return new Promise<number>((resolve) => {
    if (!w?.requestIdleCallback) { setTimeout(() => resolve(SLICE_MS), 0); return; }
    const startedWaiting = performance.now();
    const ask = () => w.requestIdleCallback!((d) => {
      const now = performance.now();
      const busy = now - Math.max(lastInputAt, pageSwitchAt) < QUIET_AFTER_INPUT_MS;
      // never starve: after 8 s of a constantly busy page, save small slices anyway
      if (busy && now - startedWaiting < 8000) { setTimeout(ask, 120); return; }
      resolve(d.didTimeout || busy ? 2 : Math.max(2, Math.min(SLICE_MS, d.timeRemaining() - 1)));
    }, { timeout: 2000 });
    ask();
  });
}

/**
 * Writes `items` (and deletes `removeKeys`) in time-limited slices, one transaction per slice. `clearFirst`: the first slice
 * empties the store. Records written by a slice are kept even when a later slice fails (the next save completes them).
 */
async function writeInSlices<T>(storeName: string, items: T[], opts: { clearFirst?: boolean; removeKeys?: IDBValidKey[] } = {}): Promise<void> {
  const db = await getDb();
  const removeKeys = opts.removeKeys || [];
  let i = 0, r = 0, first = true;
  while (first || i < items.length || r < removeKeys.length) {
    const budget = await whenQuiet();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);
      if (first && opts.clearFirst) store.clear();
      const t0 = performance.now();
      let n = 0;
      // at least a few records per slice (progress even when the budget is tiny); clock checked every 8 records
      while (r < removeKeys.length && (n < 8 || (n & 7) !== 0 || performance.now() - t0 < budget)) { store.delete(removeKeys[r++]); n++; }
      while (i < items.length && (n < 8 || (n & 7) !== 0 || performance.now() - t0 < budget)) { store.put(items[i++]); n++; }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
    first = false;
  }
}

export async function saveDevicesToIdb(devices: Device[]): Promise<boolean> {
  try {
    // (13 Nov 2026, phase 2) idle, time-limited slices (see writeInSlices); before: 250 units per step at the next idle moment
    // or after 1 s at the latest, so steps of ~60 ms still landed in the middle of page switches
    await writeInSlices(STORE_DEVICES, devices, { clearFirst: true });
    const db = await getDb();
    if (db.objectStoreNames.contains(STORE_META)) {
      db.transaction([STORE_META], 'readwrite').objectStore(STORE_META).put({
        key: 'last_device_save',
        count: devices.length,
        timestamp: new Date().toISOString(),
      });
    }
    return true;
  } catch (err) {
    console.warn('[IndexedDB] Error saving devices to IDB:', err);
    return false;
  }
}

/**
 * (29 Oct 2026, speed review) What the IndexedDB device store holds, by reference. Before, EVERY change of the device list
 * (a live update, an edit, a reload) cleared the store and wrote all ~27,600 units again (~22 MB copied on the main thread).
 * Now only the units that differ from this map are written, and removed units are deleted.
 */
const persistedDevices = new Map<string, Device>();
const sameStoredDevice = (a: Device, b: Device): boolean =>
  !!a.rowVersion && a.rowVersion === b.rowVersion && a.updatedAt === b.updatedAt && a.stage === b.stage &&
  a.branchId === b.branchId && !!a.archived === !!b.archived && a.mid === b.mid && a.tid === b.tid &&
  a.merchantName === b.merchantName && a.note === b.note && (a.history?.length || 0) === (b.history?.length || 0);
let persistChain: Promise<unknown> = Promise.resolve();
const FULL_REWRITE_ABOVE = 8000;

export function persistDevicesIncremental(devices: Device[]): Promise<boolean> {
  const run = async (): Promise<boolean> => {
    try {
      if (!devices.length) return true;
      const changed: Device[] = [];
      const live = new Set<string>();
      for (const d of devices) {
        live.add(d.serial);
        const prev = persistedDevices.get(d.serial);
        if (prev === d) continue;
        // (30 Oct 2026) A fresh copy from the server with the same row version is the same record: the server raises
        // row_version on every update. Remember the new object, but do not write it again (saves ~20,000 writes per reload).
        if (prev && sameStoredDevice(prev, d)) { persistedDevices.set(d.serial, d); continue; }
        changed.push(d);
      }
      const removed: string[] = [];
      persistedDevices.forEach((_d, serial) => {
        if (!live.has(serial)) removed.push(serial);
      });
      if (!changed.length && !removed.length) return true;
      if (persistedDevices.size === 0 || changed.length > FULL_REWRITE_ABOVE || removed.length > FULL_REWRITE_ABOVE) {
        const ok = await saveDevicesToIdb(devices);
        if (ok) {
          persistedDevices.clear();
          for (const d of devices) persistedDevices.set(d.serial, d);
        }
        return ok;
      }
      await writeInSlices(STORE_DEVICES, changed, { removeKeys: removed });
      const db = await getDb();
      db.transaction([STORE_META], 'readwrite').objectStore(STORE_META).put({ key: 'last_device_save', count: devices.length, timestamp: new Date().toISOString() });
      for (const d of changed) persistedDevices.set(d.serial, d);
      for (const sn of removed) persistedDevices.delete(sn);
      return true;
    } catch (err) {
      console.warn('[IndexedDB] Error saving changed devices to IDB:', err);
      return false;
    }
  };
  // one write at a time: a later call sees what the earlier one stored
  const next = persistChain.then(run, run);
  persistChain = next.catch(() => undefined);
  return next;
}

/**
 * Persists requisitions to IndexedDB for fast browser caching.
 * (13 Nov 2026, speed, phase 2) Only the requests that changed are written (by reference: a changed request is a new object),
 * removed ones are deleted, in idle time-limited slices. Before: the store was emptied and every request written again on
 * every change (~230 ms on a slower laptop during sign-in).
 */
const persistedReqs = new Map<string, Requisition>();
/** Sign-out deletes the database: forget what it held, so the next save writes everything again. */
export function forgetSavedCopies(): void {
  persistedDevices.clear();
  persistedReqs.clear();
}
let reqChain: Promise<unknown> = Promise.resolve();
export function saveRequisitionsToIdb(requisitions: Requisition[]): Promise<boolean> {
  const run = async (): Promise<boolean> => {
    try {
      const db = await getDb();
      if (!db.objectStoreNames.contains(STORE_REQUISITIONS)) return false;
      const changed: Requisition[] = [];
      const live = new Set<string>();
      for (const r of requisitions) {
        live.add(r.reqId);
        if (persistedReqs.get(r.reqId) !== r) changed.push(r);
      }
      const removed: string[] = [];
      persistedReqs.forEach((_r, id) => { if (!live.has(id)) removed.push(id); });
      if (!changed.length && !removed.length) return true;
      // nothing known about the store yet (first save of this session): empty it first so no stale request stays
      await writeInSlices(STORE_REQUISITIONS, changed, { clearFirst: persistedReqs.size === 0, removeKeys: persistedReqs.size === 0 ? [] : removed });
      for (const r of changed) persistedReqs.set(r.reqId, r);
      for (const id of removed) persistedReqs.delete(id);
      return true;
    } catch (err) {
      console.warn('[IndexedDB] Error saving requisitions to IDB:', err);
      return false;
    }
  };
  const next = reqChain.then(run, run);
  reqChain = next.catch(() => undefined);
  return next;
}

/**
 * Persists historical merchants to IndexedDB.
 */
export async function saveHistoricalMerchantsToIdb(records: HistoricalMerchantRecord[]): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db.objectStoreNames.contains(STORE_HISTORICAL)) return false;
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_HISTORICAL], 'readwrite');
      const store = tx.objectStore(STORE_HISTORICAL);
      store.clear();
      for (const rec of records) {
        store.put(rec);
      }
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[IndexedDB] Error saving historical merchants to IDB:', err);
    return false;
  }
}

/**
 * Persists branches to IndexedDB.
 */
export async function saveBranchesToIdb(branches: Branch[]): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db.objectStoreNames.contains(STORE_BRANCHES)) return false;
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_BRANCHES], 'readwrite');
      const store = tx.objectStore(STORE_BRANCHES);
      store.clear();
      for (const b of branches) {
        store.put(b);
      }
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[IndexedDB] Error saving branches to IDB:', err);
    return false;
  }
}

/**
 * Saves a full snapshot of the inventory system to IndexedDB in one call.
 */
export async function saveFullSnapshotToIdb(snapshot: {
  devices?: Device[];
  requisitions?: Requisition[];
  historicalMerchants?: HistoricalMerchantRecord[];
  branches?: Branch[];
}): Promise<boolean> {
  try {
    const promises: Promise<boolean>[] = [];
    if (snapshot.devices && snapshot.devices.length > 0) {
      promises.push(saveDevicesToIdb(snapshot.devices));
    }
    if (snapshot.requisitions && snapshot.requisitions.length > 0) {
      promises.push(saveRequisitionsToIdb(snapshot.requisitions));
    }
    if (snapshot.historicalMerchants && snapshot.historicalMerchants.length > 0) {
      promises.push(saveHistoricalMerchantsToIdb(snapshot.historicalMerchants));
    }
    if (snapshot.branches && snapshot.branches.length > 0) {
      promises.push(saveBranchesToIdb(snapshot.branches));
    }
    const results = await Promise.all(promises);
    return results.every(Boolean);
  } catch (err) {
    console.warn('[IndexedDB] Error saving full snapshot to IDB:', err);
    return false;
  }
}

/**
 * Clears all devices from IndexedDB.
 */
export async function clearDevicesFromIdb(): Promise<boolean> {
  try {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_DEVICES, STORE_META], 'readwrite');
      tx.objectStore(STORE_DEVICES).clear();
      tx.objectStore(STORE_META).clear();
      persistedDevices.clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[IndexedDB] Error clearing devices from IDB:', err);
    return false;
  }
}

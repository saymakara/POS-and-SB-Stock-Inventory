import { Device, Requisition, Branch, HistoricalMerchantRecord } from '../types';

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
          if (reqReq.result && reqReq.result.length > 0) requisitions = reqReq.result;
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
export async function saveDevicesToIdb(
  devices: Device[],
  onProgress?: (saved: number, total: number) => void
): Promise<boolean> {
  try {
    const db = await getDb();
    const total = devices.length;

    // Use transaction in chunks of 5,000 to keep UI responsive on massive datasets
    // (30 Oct 2026) 1,000 per step (was 5,000): each step is a short task, so taps and scrolling stay smooth during the save
    const CHUNK_SIZE = 1000;
    for (let i = 0; i < total; i += CHUNK_SIZE) {
      const chunk = devices.slice(i, i + CHUNK_SIZE);
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE_DEVICES], 'readwrite');
        const store = tx.objectStore(STORE_DEVICES);

        if (i === 0) {
          // Clear old records on the first chunk
          store.clear();
        }

        for (let j = 0; j < chunk.length; j++) {
          store.put(chunk[j]);
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(new Error('Transaction aborted'));
      });

      onProgress?.(Math.min(i + CHUNK_SIZE, total), total);
    }

    // Save metadata update timestamp
    if (db.objectStoreNames.contains(STORE_META)) {
      const metaTx = db.transaction([STORE_META], 'readwrite');
      metaTx.objectStore(STORE_META).put({
        key: 'last_device_save',
        count: total,
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
      const db = await getDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE_DEVICES, STORE_META], 'readwrite');
        const store = tx.objectStore(STORE_DEVICES);
        for (const d of changed) store.put(d);
        for (const sn of removed) store.delete(sn);
        tx.objectStore(STORE_META).put({ key: 'last_device_save', count: devices.length, timestamp: new Date().toISOString() });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
      });
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
 * Loads all devices from IndexedDB. Returns null if empty or uninitialized.
 */
export async function loadDevicesFromIdb(): Promise<Device[] | null> {
  try {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_DEVICES], 'readonly');
      const store = tx.objectStore(STORE_DEVICES);
      const request = store.getAll();

      request.onsuccess = () => {
        const result = request.result as Device[];
        if (result && result.length > 0) {
          resolve(result);
        } else {
          resolve(null);
        }
      };

      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn('[IndexedDB] Error loading devices from IDB:', err);
    return null;
  }
}

/**
 * Persists requisitions to IndexedDB for fast browser caching.
 */
export async function saveRequisitionsToIdb(requisitions: Requisition[]): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db.objectStoreNames.contains(STORE_REQUISITIONS)) return false;
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_REQUISITIONS], 'readwrite');
      const store = tx.objectStore(STORE_REQUISITIONS);
      store.clear();
      for (const r of requisitions) {
        store.put(r);
      }
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[IndexedDB] Error saving requisitions to IDB:', err);
    return false;
  }
}

/**
 * Loads requisitions from IndexedDB.
 */
export async function loadRequisitionsFromIdb(): Promise<Requisition[] | null> {
  try {
    const db = await getDb();
    if (!db.objectStoreNames.contains(STORE_REQUISITIONS)) return null;
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_REQUISITIONS], 'readonly');
      const store = tx.objectStore(STORE_REQUISITIONS);
      const request = store.getAll();
      request.onsuccess = () => {
        const result = request.result as Requisition[];
        resolve(result && result.length > 0 ? result : null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn('[IndexedDB] Error loading requisitions from IDB:', err);
    return null;
  }
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
 * Loads historical merchants from IndexedDB.
 */
export async function loadHistoricalMerchantsFromIdb(): Promise<HistoricalMerchantRecord[] | null> {
  try {
    const db = await getDb();
    if (!db.objectStoreNames.contains(STORE_HISTORICAL)) return null;
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_HISTORICAL], 'readonly');
      const store = tx.objectStore(STORE_HISTORICAL);
      const request = store.getAll();
      request.onsuccess = () => {
        const result = request.result as HistoricalMerchantRecord[];
        resolve(result && result.length > 0 ? result : null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn('[IndexedDB] Error loading historical merchants from IDB:', err);
    return null;
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
 * Loads branches from IndexedDB.
 */
export async function loadBranchesFromIdb(): Promise<Branch[] | null> {
  try {
    const db = await getDb();
    if (!db.objectStoreNames.contains(STORE_BRANCHES)) return null;
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_BRANCHES], 'readonly');
      const store = tx.objectStore(STORE_BRANCHES);
      const request = store.getAll();
      request.onsuccess = () => {
        const result = request.result as Branch[];
        resolve(result && result.length > 0 ? result : null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn('[IndexedDB] Error loading branches from IDB:', err);
    return null;
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

/**
 * Clears all cached inventory stores in IndexedDB.
 */
export async function clearAllIdb(): Promise<boolean> {
  try {
    const db = await getDb();
    const stores = [STORE_DEVICES, STORE_REQUISITIONS, STORE_HISTORICAL, STORE_BRANCHES, STORE_META].filter((s) =>
      db.objectStoreNames.contains(s)
    );
    if (!stores.length) return true;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, 'readwrite');
      stores.forEach((s) => tx.objectStore(s).clear());
      persistedDevices.clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[IndexedDB] Error clearing all IDB:', err);
    return false;
  }
}

/**
 * Returns cache metadata such as last save timestamp and device count.
 */
export async function getIdbCacheMetadata(): Promise<{ timestamp?: string; count?: number } | null> {
  try {
    const db = await getDb();
    if (!db.objectStoreNames.contains(STORE_META)) return null;
    return new Promise((resolve) => {
      const tx = db.transaction([STORE_META], 'readonly');
      const req = tx.objectStore(STORE_META).get('last_device_save');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

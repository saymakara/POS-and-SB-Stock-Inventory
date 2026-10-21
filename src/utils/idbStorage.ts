import { Device } from '../types';

const DB_NAME = 'pos_sb_stock_inventory_db';
const DB_VERSION = 1;
const STORE_DEVICES = 'devices';
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
    const CHUNK_SIZE = 5000;
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
    const metaTx = db.transaction([STORE_META], 'readwrite');
    metaTx.objectStore(STORE_META).put({
      key: 'last_device_save',
      count: total,
      timestamp: new Date().toISOString(),
    });

    return true;
  } catch (err) {
    console.warn('[IndexedDB] Error saving devices to IDB:', err);
    return false;
  }
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
 * Clears all devices from IndexedDB.
 */
export async function clearDevicesFromIdb(): Promise<boolean> {
  try {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_DEVICES, STORE_META], 'readwrite');
      tx.objectStore(STORE_DEVICES).clear();
      tx.objectStore(STORE_META).clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[IndexedDB] Error clearing devices from IDB:', err);
    return false;
  }
}

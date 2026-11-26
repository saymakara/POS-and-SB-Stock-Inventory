/**
 * (26 Nov 2026, speed) A small copy on disk (IndexedDB) of figures the portal shows first - the KPI summary and its
 * day-by-day rows - so that opening the portal again (a new tab, the next morning's browser start) shows the figures at
 * once, then refreshes them from the database in the background ("stale while revalidate").
 *
 * Rules:
 *  - Only totals and counts per staff / branch / day: no merchant details, no device lists.
 *  - Each copy belongs to one signed-in person (their user id) and is used only by that person.
 *  - Everything is deleted on sign-out and when another person signs in on this browser (clearLocalCaches).
 *  - A copy is used only up to `maxAgeMs` old (the caller decides; the KPI copy is used only on the same Phnom Penh day).
 *  - Writing never blocks the screen: it waits for an idle moment. Any storage error simply means "no copy".
 */
const DB_NAME = 'portal_figures_v1';
const STORE = 'kv';

interface Entry<T> { key: string; owner: string; savedAt: number; value: T }

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (typeof window === 'undefined' || !window.indexedDB) return Promise.reject(new Error('no IndexedDB'));
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = window.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'key' }); };
      req.onsuccess = () => {
        const d = req.result;
        d.onversionchange = () => { d.close(); dbPromise = null; };   // deleted elsewhere (sign-out in another tab)
        resolve(d);
      };
      req.onerror = () => { dbPromise = null; reject(req.error); };
      req.onblocked = () => { dbPromise = null; reject(new Error('blocked')); };
    });
  }
  return dbPromise;
}

/** The copy saved under `key` for `owner`, when it is not older than `maxAgeMs`; otherwise undefined. */
export async function persistGet<T>(owner: string, key: string, maxAgeMs: number): Promise<T | undefined> {
  if (!owner) return undefined;
  try {
    const d = await db();
    const e = await new Promise<Entry<T> | undefined>((resolve) => {
      try {
        const r = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        r.onsuccess = () => resolve(r.result as Entry<T> | undefined);
        r.onerror = () => resolve(undefined);
      } catch { resolve(undefined); }
    });
    if (!e || e.owner !== owner || Date.now() - e.savedAt > maxAgeMs) return undefined;
    return e.value;
  } catch {
    return undefined;
  }
}

const pending = new Map<string, Entry<unknown>>();
let timer: number | null = null;
function flush(): void {
  timer = null;
  if (!pending.size) return;
  const list = Array.from(pending.values());
  pending.clear();
  void db().then((d) => {
    try {
      const st = d.transaction(STORE, 'readwrite').objectStore(STORE);
      list.forEach((e) => { try { st.put(e); } catch { /* a value that cannot be stored is skipped */ } });
    } catch { /* storage unavailable */ }
  }).catch(() => {});
}

/** Saves `value` under `key` for `owner` at the next idle moment (the latest value for a key wins). */
export function persistPut<T>(owner: string, key: string, value: T): void {
  if (!owner || typeof window === 'undefined') return;
  pending.set(key, { key, owner, savedAt: Date.now(), value });
  if (timer !== null) return;
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  timer = w.requestIdleCallback ? w.requestIdleCallback(flush, { timeout: 3000 }) : window.setTimeout(flush, 1000);
}

/** Deletes every saved copy (sign-out, another person signing in). */
export function persistClearAll(): void {
  pending.clear();
  const close = dbPromise;
  dbPromise = null;
  const drop = () => { try { window.indexedDB.deleteDatabase(DB_NAME); } catch { /* not available */ } };
  if (close) close.then((d) => { try { d.close(); } catch { /* */ } drop(); }).catch(drop); else drop();
}

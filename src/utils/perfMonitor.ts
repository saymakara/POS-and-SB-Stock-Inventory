/**
 * (31 Oct 2026) System Health monitor: how fast this browser session feels, measured where staff actually use it.
 * - Page experience (Core Web Vitals): LCP (main content shown), INP (reaction to taps/clicks), CLS (layout jumps)
 * - Database requests: time per request, grouped by table / function (the address only: no search text, no data)
 * - Errors: script errors, unhandled failures, and requests that failed
 * Everything stays in this browser tab's memory: nothing is sent or stored, and it resets on reload.
 */

export interface ApiCall { at: number; path: string; method: string; ms: number; status: number }
export interface ErrorEntry { at: number; source: 'script' | 'promise' | 'request'; message: string }
export interface PerfSnapshot {
  startedAt: number;
  ttfb: number | null;
  fcp: number | null;
  lcp: number | null;
  cls: number;
  inpWorst: number | null;
  inpP75: number | null;
  interactions: number;
  longTasks: number;
  longTaskMs: number;
  api: ApiCall[];
  errors: ErrorEntry[];
}

const MAX_API = 600;
const MAX_ERRORS = 60;

let started = false;
let startedAt = Date.now();
let ttfb: number | null = null;
let fcp: number | null = null;
let lcp: number | null = null;
let cls = 0;
let longTasks = 0;
let longTaskMs = 0;
const interactionWorst = new Map<number, number>(); // interactionId -> longest event duration
let api: ApiCall[] = [];
let errors: ErrorEntry[] = [];

const clip = (s: unknown, n = 220) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

function pushError(e: ErrorEntry) {
  errors.push(e);
  if (errors.length > MAX_ERRORS) errors = errors.slice(-MAX_ERRORS);
}

function observe(type: string, cb: (list: PerformanceObserverEntryList) => void, extra: Record<string, unknown> = {}) {
  try {
    new PerformanceObserver(cb).observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
  } catch {
    /* this browser does not report this measure */
  }
}

/** Start once, as early as possible (main.tsx). Safe to call again. */
export function startPerfMonitor(): void {
  if (started || typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;
  started = true;
  startedAt = Date.now();
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (nav) ttfb = Math.round(nav.responseStart);
  } catch { /* not available */ }
  observe('paint', (l) => l.getEntries().forEach((e) => { if (e.name === 'first-contentful-paint') fcp = Math.round(e.startTime); }));
  observe('largest-contentful-paint', (l) => { const all = l.getEntries(); const last = all[all.length - 1]; if (last) lcp = Math.round(last.startTime); });
  observe('layout-shift', (l) => l.getEntries().forEach((e) => {
    const s = e as PerformanceEntry & { value: number; hadRecentInput: boolean };
    if (!s.hadRecentInput) cls += s.value;
  }));
  observe('longtask', (l) => l.getEntries().forEach((e) => { longTasks += 1; longTaskMs += e.duration; }));
  observe('event', (l) => l.getEntries().forEach((e) => {
    const ev = e as PerformanceEntry & { interactionId?: number };
    if (!ev.interactionId) return;
    const prev = interactionWorst.get(ev.interactionId) || 0;
    if (e.duration > prev) interactionWorst.set(ev.interactionId, e.duration);
    if (interactionWorst.size > 2000) { const first = interactionWorst.keys().next().value; if (first !== undefined) interactionWorst.delete(first); }
  }), { durationThreshold: 16 });
  window.addEventListener('error', (e) => pushError({ at: Date.now(), source: 'script', message: clip(e.message || e.error) }));
  window.addEventListener('unhandledrejection', (e) => {
    const r = (e as PromiseRejectionEvent).reason;
    pushError({ at: Date.now(), source: 'promise', message: clip(r instanceof Error ? r.message : r) });
  });
}

/** The database address without the question part (?...): table or function name only, never search text or data. */
function pathOf(input: RequestInfo | URL): string {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return new URL(raw, window.location.href).pathname.replace(/\/+$/, '') || '/';
  } catch {
    return '(unknown)';
  }
}

/** Used as the Supabase client's fetch: times every database request. Behaviour is otherwise unchanged. */
export const monitoredFetch: typeof fetch = async (input, init) => {
  const t0 = performance.now();
  const method = (init?.method || (typeof input === 'object' && 'method' in input ? (input as Request).method : 'GET') || 'GET').toUpperCase();
  const path = pathOf(input);
  try {
    const res = await fetch(input, init);
    record({ at: Date.now(), path, method, ms: Math.round(performance.now() - t0), status: res.status });
    if (res.status >= 500) pushError({ at: Date.now(), source: 'request', message: `${method} ${path} → ${res.status}` });
    return res;
  } catch (err) {
    // a request cancelled on purpose (screen closed, newer search) is not an error: kept apart as status -1
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    record({ at: Date.now(), path, method, ms: Math.round(performance.now() - t0), status: aborted ? -1 : 0 });
    if (!aborted) {
      pushError({ at: Date.now(), source: 'request', message: `${method} ${path} → no answer (${clip(err instanceof Error ? err.message : err, 80)})` });
    }
    throw err;
  }
};

function record(c: ApiCall) {
  api.push(c);
  if (api.length > MAX_API) api = api.slice(-MAX_API);
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

export function getPerfSnapshot(): PerfSnapshot {
  const inter = [...interactionWorst.values()];
  return {
    startedAt, ttfb, fcp, lcp, cls: Math.round(cls * 1000) / 1000,
    inpWorst: inter.length ? Math.round(Math.max(...inter)) : null,
    inpP75: percentile(inter, 75) !== null ? Math.round(percentile(inter, 75) as number) : null,
    interactions: inter.length, longTasks, longTaskMs: Math.round(longTaskMs),
    api: api.slice(), errors: errors.slice(),
  };
}

/** Clears the request and error lists and the interaction measures (page-load measures are kept). */
export function resetPerfCounters(): void {
  api = []; errors = []; interactionWorst.clear(); longTasks = 0; longTaskMs = 0; startedAt = Date.now();
}

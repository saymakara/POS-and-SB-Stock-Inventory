import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
// (31 Oct 2026, speed) the app itself loads separately: the sign-in page no longer waits for the whole dashboard code
// (on a phone it was busy ~1 s before the fields could be used). It starts downloading at once in the background, so it
// is ready by the time the password is typed.
const loadApp = () => import('./AppWithMotion.tsx');
const App = lazy(loadApp);
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthGate } from './components/AuthGate';
import './index.css';
import { startFilterMarks } from './utils/filterMarks';
import { startPerfMonitor } from './utils/perfMonitor';
import { startClickGuard } from './utils/clickGuard';

// (31 Oct 2026) speed and error figures for Settings → System Health (kept in this tab's memory only)
startPerfMonitor();
// (31 Oct 2026) a double-click on a save-type button sends it once
startClickGuard();
startFilterMarks();
const warmApp = () => { loadApp().catch(() => {}); };
// Preload App immediately at t=0 if the user already has an active cached staff profile
try {
  const savedProfile = sessionStorage.getItem('crm_pos_staff_profile_v1') || localStorage.getItem('crm_pos_staff_profile_v1');
  if (savedProfile) {
    warmApp();
    // (26 Nov 2026, speed) today's KPI figures saved on disk for this person are put back while the app loads, so the
    // Dashboard shows them at once and refreshes them (see hydrateKpiFromDisk)
    const uid = String((JSON.parse(savedProfile) as { user_id?: string })?.user_id || '');
    if (uid) void import('./services/kpiService').then((k) => k.hydrateKpiFromDisk(uid)).catch(() => {});
  }
} catch { /* ignore */ }
// (07 Nov 2026) the background download starts only once the sign-in field is on screen (it used to race the sign-in
// screen on slow phones), or after 4 s for someone already signed in (whose app then loads directly anyway).
const warmSoon = () => {
  let started = false;
  const go = () => {
    if (started) return;
    started = true;
    setTimeout(() => {
      if ('requestIdleCallback' in window) (window as any).requestIdleCallback(warmApp, { timeout: 1500 }); else warmApp();
    }, 300);
  };
  if (document.getElementById('empId')) { go(); return; }
  const seen = new MutationObserver(() => { if (document.getElementById('empId')) { seen.disconnect(); go(); } });
  seen.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => { seen.disconnect(); go(); }, 4000);
};
warmSoon();

// Register Browser Cache Service Worker for lightning-fast loading
if (typeof window !== 'undefined' && 'serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (installing) {
            installing.addEventListener('statechange', () => {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[SW] Cache updated in background');
              }
            });
          }
        });
      })
      .catch((err) => {
        console.warn('[SW Registration Notice]', err);
      });
  });
}

// (21 Oct 2026) the app opens only after sign-in with the shared database; it restarts for each person signed in
// (03 Nov 2026) MotionConfig reducedMotion="user" now lives in AppWithMotion.tsx (keeps Motion off the sign-in screen)
// (20 Nov 2026, security review) never inside another site's frame: a hidden frame could trick a signed-in admin into
// clicking buttons ("clickjacking"). GitHub Pages cannot send the X-Frame-Options / frame-ancestors header, so the page
// itself refuses to start when it is framed.
const framed = (() => { try { return window.top !== window.self; } catch { return true; } })();
if (framed) {
  document.getElementById('root')!.textContent = 'For your security, the In-Store Management Portal cannot be opened inside another website.';
  try { window.top!.location.href = window.self.location.href; } catch { /* the other site blocks it: the message stays */ }
} else createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <AuthGate>{(profile) => (
      <Suspense fallback={<AppLoading />}>
        <App profile={profile} />
      </Suspense>
    )}</AuthGate>
  </ErrorBoundary>
);

/**
 * Shown only if the dashboard code is still downloading right after sign-in. (23 Nov 2026) The same shape as the portal
 * (sidebar, top bar, figure cards, chart) with soft placeholders, so the portal appears to fill in rather than
 * replace a spinner; matches the App shell geometry to prevent layout shift.
 */
function AppLoading() {
  return (
    <div className="min-h-[100dvh] flex items-start bg-[#f4f7fa]" role="status" aria-label="Loading">
      {/* Real #002F4A Sidebar Skeleton matching Overview + Merchant App Review sub-tree + Operations */}
      <div className="hidden md:flex flex-col w-[248px] shrink-0 min-h-[100dvh] bg-[#002F4A] px-3.5 py-4" aria-hidden="true">
        <div className="flex items-center gap-2.5 px-1.5 pb-4 mb-3 border-b border-white/10">
          <div className="skeleton-dark w-9 h-9 rounded-xl shrink-0" />
          <div className="space-y-1.5 flex-1">
            <div className="skeleton-dark h-3 w-32 rounded" />
            <div className="skeleton-dark h-2.5 w-20 rounded opacity-70" />
          </div>
        </div>
        <div className="skeleton-dark h-2.5 w-16 rounded ml-2 mb-2 opacity-60" />
        <div className="space-y-1.5 mb-1.5">
          <div className="h-9 rounded-xl bg-white/12 border border-white/15 px-2.5 flex items-center gap-2.5">
            <div className="skeleton-dark w-5 h-5 rounded-md" />
            <div className="skeleton-dark h-3 w-24 rounded" />
          </div>
          <div className="h-8 px-2.5 flex items-center gap-2.5">
            <div className="skeleton-dark w-5 h-5 rounded-md opacity-75" />
            <div className="skeleton-dark h-3 w-28 rounded opacity-75" />
          </div>
          <div className="h-8 px-2.5 flex items-center gap-2.5">
            <div className="skeleton-dark w-5 h-5 rounded-md opacity-75" />
            <div className="skeleton-dark h-3 w-32 rounded opacity-75" />
          </div>
          {/* Sub-tree under Merchant App Review */}
          <div className="ml-5 pl-3 border-l border-white/12 space-y-1.5 py-1">
            {[
              { w: 'w-20', badge: true },
              { w: 'w-18', badge: true },
              { w: 'w-12', badge: false },
              { w: 'w-24', badge: false },
              { w: 'w-18', badge: true },
            ].map((it, idx) => (
              <div key={idx} className="h-6 flex items-center justify-between pr-1">
                <div className="flex items-center gap-2">
                  <div className="skeleton-dark w-3.5 h-3.5 rounded opacity-65" />
                  <div className={`skeleton-dark h-2.5 ${it.w} rounded opacity-70`} />
                </div>
                {it.badge && <div className="skeleton-dark h-4 w-9 rounded-full opacity-70" />}
              </div>
            ))}
          </div>
        </div>
        <div className="skeleton-dark h-2.5 w-28 rounded ml-2 mt-3 mb-2 opacity-60" />
        <div className="space-y-1.5 flex-1">
          {['w-28', 'w-24', 'w-26', 'w-24', 'w-22', 'w-24', 'w-20', 'w-16'].map((w, i) => (
            <div key={i} className="h-8 px-2.5 flex items-center gap-2.5">
              <div className="skeleton-dark w-5 h-5 rounded-md opacity-70" />
              <div className={`skeleton-dark h-3 ${w} rounded opacity-70`} />
            </div>
          ))}
        </div>
        <div className="mt-4 pt-3 border-t border-white/10">
          <div className="skeleton-dark h-9 w-full rounded-xl opacity-75" />
        </div>
      </div>

      {/* Main Content Area matching real Dashboard layout */}
      <div className="flex-1 min-w-0 min-h-[100dvh] flex flex-col loading-in" aria-hidden="true">
        {/* Top Header */}
        <div className="h-16 border-b border-slate-200/80 bg-white px-5 flex items-center gap-3.5">
          <div className="skeleton h-9 w-9 rounded-xl shrink-0" />
          <div className="skeleton h-9 flex-1 max-w-sm rounded-xl" />
          <div className="ml-auto flex items-center gap-2.5">
            <div className="skeleton h-8 w-8 rounded-full" />
            <div className="skeleton h-8 w-8 rounded-full hidden sm:block" />
            <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-slate-200/80">
              <div className="space-y-1 text-right">
                <div className="skeleton h-3 w-24 rounded" />
                <div className="skeleton h-2.5 w-20 rounded ml-auto" />
              </div>
              <div className="skeleton h-8 w-8 rounded-full" />
            </div>
          </div>
        </div>

        <div className="p-5 sm:p-6 flex flex-col gap-5 max-w-[1600px] w-full mx-auto">
          {/* Greeting + Period/Branch/Export Pill Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1.5">
              <div className="skeleton h-7 w-60 rounded-lg" />
              <div className="skeleton h-3.5 w-44 rounded" />
            </div>
            <div className="h-10 rounded-full bg-white border border-slate-200/80 px-2 flex items-center gap-2">
              <div className="skeleton h-6 w-20 rounded-full" />
              <div className="skeleton h-6 w-24 rounded-full" />
              <div className="skeleton h-6 w-16 rounded-full" />
            </div>
          </div>

          {/* 4 Inset KPI Squircles inside Standalone White Shelf */}
          <div className="rounded-3xl bg-white border border-slate-200/80 p-3.5 sm:p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="rounded-[18px] bg-slate-50/70 border border-slate-200/70 px-4 py-3.5 flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="skeleton h-3 w-28 rounded" />
                    <div className="skeleton w-8 h-8 rounded-full shrink-0" />
                  </div>
                  <div className="flex items-end justify-between gap-2">
                    <div className="space-y-1.5">
                      <div className="skeleton h-7 w-20 rounded-md" />
                      <div className="skeleton h-3.5 w-14 rounded-full" />
                    </div>
                    <div className="skeleton h-8 w-20 rounded-lg shrink-0" />
                  </div>
                  <div className="pt-2 border-t border-slate-200/70 flex items-center justify-between">
                    <div className="skeleton h-2.5 w-24 rounded" />
                    <div className="skeleton h-2.5 w-12 rounded" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Row 1: Daily Volume & Staff (8 cols) + Channel Mix Donut (4 cols) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Daily Volume & Staff — Line/Area Wave + 5 Channel Sparkline Cards */}
            <div className="lg:col-span-8 rounded-[22px] bg-white border border-slate-200/80 p-5 flex flex-col gap-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="skeleton w-7 h-7 rounded-full shrink-0" />
                  <div className="space-y-1.5">
                    <div className="skeleton h-4 w-36 rounded" />
                    <div className="skeleton h-3 w-28 rounded" />
                  </div>
                </div>
                <div className="skeleton h-6 w-20 rounded-full" />
              </div>
              <div className="flex items-center gap-2">
                <div className="skeleton h-6 w-32 rounded-full" />
                <div className="skeleton h-6 w-24 rounded-full" />
              </div>
              {/* Chart area while loading: plain grid only (25 Nov 2026: no fake wave / bar shapes) */}
              <div className="w-full h-[215px] flex flex-col justify-between pt-2">
                <div className="relative flex-1 flex items-center">
                  <div className="flex flex-col justify-between h-full pr-2.5 py-1">
                    {[0, 1, 2, 3].map((k) => <div key={k} className="skeleton h-2.5 w-7 rounded" />)}
                  </div>
                  <div className="relative flex-1 h-full flex flex-col justify-between py-1">
                    {[0, 1, 2, 3].map((k) => <div key={k} className="w-full border-t border-dashed border-slate-200/80" />)}
                  </div>
                  <div className="flex flex-col justify-between h-full pl-2.5 py-1">
                    {[0, 1, 2, 3].map((k) => <div key={k} className="skeleton h-2.5 w-6 rounded" />)}
                  </div>
                </div>
                <div className="flex items-center justify-between pl-10 pr-9 pt-2">
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => <div key={k} className="skeleton h-2.5 w-4 rounded" />)}
                </div>
              </div>
              {/* 5 Channel Sparkline Dock Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
                {[0, 1, 2, 3, 4].map((k) => (
                  <div key={k} className="rounded-xl bg-slate-50/75 border border-slate-200/70 px-3 py-2.5 space-y-2">
                    <div className="flex items-center gap-1.5">
                      <div className="skeleton w-2 h-2 rounded-full" />
                      <div className="skeleton h-2.5 w-14 rounded" />
                    </div>
                    <div className="flex items-end justify-between gap-1">
                      <div className="skeleton h-4 w-12 rounded" />
                      <div className="skeleton h-3.5 w-8 rounded" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Channel Mix — Hollow Donut Ring + Callout Pills */}
            <div className="lg:col-span-4 rounded-[22px] bg-white border border-slate-200/80 p-5 flex flex-col justify-between gap-3">
              <div className="flex items-center justify-between gap-2">
                <div className="space-y-1.5">
                  <div className="skeleton h-4 w-28 rounded" />
                  <div className="skeleton h-3 w-36 rounded" />
                </div>
                <div className="skeleton h-4 w-14 rounded" />
              </div>
              <div className="flex-1 flex items-center justify-center py-4 relative">
                <div className="relative w-[196px] h-[196px] flex items-center justify-center">
                  <div className="absolute inset-0 rounded-full skeleton" />
                  <div className="w-[140px] h-[140px] rounded-full bg-white flex flex-col items-center justify-center gap-2 z-10">
                    <div className="skeleton h-2.5 w-14 rounded" />
                    <div className="skeleton h-7 w-16 rounded-md" />
                    <div className="skeleton h-3.5 w-20 rounded-full" />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
                {[0, 1, 2, 3].map((k) => (
                  <div key={k} className="flex items-center justify-between px-2 py-1 rounded-lg bg-slate-50/70">
                    <div className="skeleton h-2.5 w-14 rounded" />
                    <div className="skeleton h-2.5 w-8 rounded" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Row 2: Monthly POS vs Sound Box Grouped Bars (8 cols) + POS Battery Status (4 cols) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-8 rounded-[22px] bg-white border border-slate-200/80 p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <div className="space-y-1.5">
                  <div className="skeleton h-4 w-52 rounded" />
                  <div className="skeleton h-3 w-36 rounded" />
                </div>
                <div className="skeleton h-7 w-28 rounded-full" />
              </div>
              <div className="h-[190px] flex items-end gap-4 px-4 pt-4 pb-2 border-b border-slate-200/70">
              </div>
              <div className="flex justify-around px-4">
                {[0, 1, 2, 3, 4, 5].map((k) => <div key={k} className="skeleton h-2.5 w-9 rounded" />)}
              </div>
            </div>

            <div className="lg:col-span-4 rounded-[22px] bg-white border border-slate-200/80 p-5 flex flex-col gap-3.5">
              <div className="flex items-center justify-between">
                <div className="space-y-1.5">
                  <div className="skeleton h-4 w-36 rounded" />
                  <div className="skeleton h-3 w-28 rounded" />
                </div>
                <div className="skeleton h-5 w-14 rounded-full" />
              </div>
              <div className="skeleton h-3 w-full rounded-full" />
              <div className="grid grid-cols-3 gap-2">
                {[0, 1, 2].map((k) => (
                  <div key={k} className="rounded-xl bg-slate-50/80 border border-slate-200/70 p-2.5 space-y-1.5">
                    <div className="skeleton h-2.5 w-12 rounded" />
                    <div className="skeleton h-5 w-10 rounded" />
                  </div>
                ))}
              </div>
              <div className="space-y-2.5 pt-1">
                {[82, 64, 45].map((w, k) => (
                  <div key={k} className="space-y-1">
                    <div className="flex justify-between">
                      <div className="skeleton h-2.5 w-20 rounded" />
                      <div className="skeleton h-2.5 w-10 rounded" />
                    </div>
                    <div className="skeleton h-2 rounded-full" style={{ width: `${w}%` }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

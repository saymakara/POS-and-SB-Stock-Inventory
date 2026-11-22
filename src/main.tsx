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
  if (sessionStorage.getItem('crm_pos_staff_profile_v1') || localStorage.getItem('crm_pos_staff_profile_v1')) {
    warmApp();
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
    <div className="min-h-[100dvh] flex items-start bg-slate-50" role="status" aria-label="Loading">
      <div className="hidden md:flex flex-col gap-3 w-[248px] shrink-0 min-h-[100dvh] bg-[#112338] px-4 py-5" aria-hidden="true">
        <div className="flex items-center gap-3 mb-4"><div className="skeleton-dark w-9 h-9 rounded-xl" /><div className="skeleton-dark h-3.5 w-32" /></div>
        {[72, 58, 80, 64, 70, 52, 76, 60].map((w, i) => <div key={i} className="skeleton-dark h-8 rounded-xl" style={{ width: `${w}%` }} />)}
      </div>
      <div className="flex-1 min-w-0 min-h-[100dvh] flex flex-col loading-in" aria-hidden="true">
        <div className="h-16 border-b border-slate-200/80 bg-white/80 px-5 flex items-center gap-4">
          <div className="skeleton h-9 w-9 rounded-xl" /><div className="skeleton h-9 flex-1 max-w-md rounded-xl" /><div className="ml-auto skeleton h-9 w-40 rounded-xl" />
        </div>
        <div className="p-5 sm:p-6 flex flex-col gap-4">
          <div className="skeleton h-8 w-72 rounded-lg" />
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="rounded-[18px] bg-white border border-slate-200/80 px-4 py-3.5 flex flex-col gap-3">
                <div className="skeleton h-3 w-24 rounded" /><div className="skeleton h-7 w-16 rounded-md" /><div className="skeleton h-2.5 w-full rounded" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="xl:col-span-2 rounded-[22px] bg-white border border-slate-200/80 p-5"><div className="skeleton h-4 w-40 rounded mb-4" /><div className="skeleton h-64 rounded-2xl" /></div>
            <div className="rounded-[22px] bg-white border border-slate-200/80 p-5"><div className="skeleton h-4 w-28 rounded mb-4" /><div className="skeleton h-56 w-56 mx-auto" style={{ borderRadius: 9999 }} /></div>
          </div>
        </div>
      </div>
    </div>
  );
}

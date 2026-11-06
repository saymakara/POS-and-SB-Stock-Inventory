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
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <AuthGate>{(profile) => (
      <Suspense fallback={<AppLoading />}>
        <App profile={profile} />
      </Suspense>
    )}</AuthGate>
  </ErrorBoundary>
);

/** Shown only if the dashboard code is still downloading right after sign-in (usually it is already there). */
function AppLoading() {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-slate-50" role="status" aria-label="Loading">
      <div className="w-9 h-9 rounded-full border-[3px] border-slate-200 border-t-[#003857] animate-spin" />
    </div>
  );
}

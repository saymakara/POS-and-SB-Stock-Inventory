import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
// (31 Oct 2026, speed) the app itself loads separately: the sign-in page no longer waits for the whole dashboard code
// (on a phone it was busy ~1 s before the fields could be used). It starts downloading at once in the background, so it
// is ready by the time the password is typed.
const loadApp = () => import('./App.tsx');
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
if ('requestIdleCallback' in window) (window as any).requestIdleCallback(warmApp, { timeout: 1500 }); else setTimeout(warmApp, 600);

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
// (29 Oct 2026) MotionConfig reducedMotion="user": with "reduce motion" on in the phone/PC settings, Motion skips
// movement (opacity fades stay), like the CSS animations already do
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <MotionConfig reducedMotion="user">
      <AuthGate>{(profile) => (
        <Suspense fallback={<AppLoading />}>
          <App profile={profile} />
        </Suspense>
      )}</AuthGate>
    </MotionConfig>
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

import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthGate } from './components/AuthGate';
import './index.css';
import { startFilterMarks } from './utils/filterMarks';

startFilterMarks();

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
      <AuthGate>{(profile) => <App profile={profile} />}</AuthGate>
    </MotionConfig>
  </ErrorBoundary>
);

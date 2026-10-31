import React, { useEffect, useState } from 'react';
import { WifiOff, Wifi } from 'lucide-react';

/**
 * (31 Oct 2026) Tells staff at once when this computer loses its internet connection, and when it is back.
 * Shown as a small floating note (bottom centre) so the page does not move. When the connection returns the app
 * already reloads the latest data by itself (App: 'online' handler); this note only says so.
 */
export const ConnectionNotice: React.FC = () => {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [backAgain, setBackAgain] = useState(false);
  useEffect(() => {
    let t: number | undefined;
    const goOff = () => { setOnline(false); setBackAgain(false); };
    const goOn = () => { setOnline(true); setBackAgain(true); window.clearTimeout(t); t = window.setTimeout(() => setBackAgain(false), 4000); };
    window.addEventListener('offline', goOff);
    window.addEventListener('online', goOn);
    return () => { window.removeEventListener('offline', goOff); window.removeEventListener('online', goOn); window.clearTimeout(t); };
  }, []);
  if (online && !backAgain) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] pointer-events-none" role="status" aria-live="polite">
      {!online ? (
        <div className="dock-spring-enter flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 shadow-lg text-xs max-w-[92vw]">
          <WifiOff className="w-4 h-4 shrink-0" aria-hidden />
          <span><strong className="font-semibold">No internet connection.</strong> You are seeing the last loaded data. Saving will not work until the connection is back.</span>
        </div>
      ) : (
        <div className="dock-spring-enter flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-emerald-50 border border-emerald-300 text-emerald-900 shadow-lg text-xs">
          <Wifi className="w-4 h-4 shrink-0" aria-hidden />
          <span><strong className="font-semibold">Back online.</strong> Loading the latest data…</span>
        </div>
      )}
    </div>
  );
};

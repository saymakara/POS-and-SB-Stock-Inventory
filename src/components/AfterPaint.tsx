// (13 Nov 2026, speed, phase 2) A section drawn just after the page's first frame (`order` frames later, so several heavy
// sections are not all drawn in the same frame). Until then an empty block of about the same height keeps the page stable.
// Used for the sections of a page that are mostly below the fold (charts, long period tables).
import React, { startTransition, useEffect, useState } from 'react';

export function AfterPaint({ order = 1, minHeight, children }: { order?: number; minHeight: number; children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let left = order * 2;                                            // two animation frames = one painted frame
    let raf = requestAnimationFrame(function tick() {
      if (--left > 0) { raf = requestAnimationFrame(tick); return; }
      startTransition(() => setReady(true));
    });
    return () => cancelAnimationFrame(raf);
  }, [order]);
  if (ready) return <>{children}</>;
  return <div aria-hidden="true" className="rounded-2xl border border-slate-200/60 bg-white/60" style={{ minHeight }} />;
}

// (13 Nov 2026, speed, phase 2) A chart box that knows its width before the chart is drawn.
// recharts' ResponsiveContainer first commits an empty box, measures it in a layout effect and then draws the whole chart
// as an urgent (synchronous) re-render right after that commit: ~300 ms that nothing can interrupt on a slower laptop.
// Here the width comes from a ResizeObserver (after the browser's own layout, no forced layout) and the chart is drawn as a
// background (transition) render, which a tap or a page switch can interrupt. Same chart, same size.
import React, { startTransition, useEffect, useRef, useState } from 'react';

/** `stagger`: painted frames to wait before the first draw, so two charts side by side are not drawn in the same frame. */
export function MeasuredChart({ height, stagger = 0, children }: { height: number; stagger?: number; children: (width: number) => React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') { if (el) setWidth(el.clientWidth); return; }
    let raf = 0;
    let resizeTimer = 0;
    let first = true;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[entries.length - 1]?.contentRect.width || 0);
      if (w <= 0) return;
      const apply = () => startTransition(() => setWidth((prev) => (prev === w ? prev : w)));
      if (!first) {
        // After first paint, wait briefly so continuous sidebar collapse/expand animations don't trigger 15+ full SVG chart redraws
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(apply, 200);
        return;
      }
      first = false;
      if (stagger <= 0) { apply(); return; }
      let left = stagger * 2;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function tick() { if (--left > 0) raf = requestAnimationFrame(tick); else apply(); });
    });
    ro.observe(el);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); window.clearTimeout(resizeTimer); };
  }, [stagger]);
  return (
    <div ref={ref} style={{ width: '100%', height }}>
      {width > 0 ? children(width) : null}
    </div>
  );
}

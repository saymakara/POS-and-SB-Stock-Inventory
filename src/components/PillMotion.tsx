// (13 Nov 2026, speed) The sliding highlight of a segmented switch (a shared-layout animation). When it appears as part of a
// new page, it takes its layout id two frames later - after the page has been laid out and painted - so the animation
// library's measuring of the page is cheap then. Before, it measured the page right after the new page was inserted,
// forcing an extra layout of the whole page inside the same frame (up to 230 ms frozen on a laptop). Inside a page (a tap
// on another segment) the highlight slides from segment to segment exactly as before.
import { useEffect, useState } from 'react';
import { motion, type HTMLMotionProps } from 'motion/react';
import { pageSwitchAt } from '../utils/navPending';

const PAGE_SETTLE_MS = 1000;

export function PillMotion({ layoutId, ...rest }: HTMLMotionProps<'div'>) {
  const [ready, setReady] = useState(() => typeof performance === 'undefined' || performance.now() - pageSwitchAt > PAGE_SETTLE_MS);
  useEffect(() => {
    if (ready) return;
    let r2 = 0;
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setReady(true)); });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, [ready]);
  return <motion.div {...rest} layoutId={ready ? layoutId : undefined} />;
}

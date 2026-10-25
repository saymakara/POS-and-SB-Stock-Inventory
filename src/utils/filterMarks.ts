/**
 * (22 Oct 2026) A drop-down filter that is not on its first choice ("All …") is tinted, so everyone sees at a glance
 * that a filter is active. Only selects whose first option has the value ALL are marked; nothing else is touched.
 * (25 Oct 2026) Removed 800ms setInterval polling loop; updates are driven purely by DOM events and MutationObserver.
 */
export function startFilterMarks(): void {
  if (typeof document === 'undefined') return;
  let queued = false;
  const scan = () => {
    queued = false;
    document.querySelectorAll('select').forEach((el) => {
      const sel = el as HTMLSelectElement;
      const first = sel.options[0];
      if (!first || first.value !== 'ALL') {
        if (sel.dataset.filtered) delete sel.dataset.filtered;
        return;
      }
      const on = sel.selectedIndex > 0 ? 'true' : 'false';
      if (sel.dataset.filtered !== on) sel.dataset.filtered = on;
    });
  };
  const soon = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(scan);
  };
  document.addEventListener('change', soon, true);
  document.addEventListener('click', soon, true);
  document.addEventListener('keyup', soon, true);
  new MutationObserver(soon).observe(document.body, { childList: true, subtree: true });
  soon();
}

/**
 * (31 Oct 2026) Double-click protection for every save-type button in the system.
 *
 * A second click on the SAME save button within 0.8 second is ignored (a double-click, or a double tap on a touch
 * screen), so a request, approval, dispatch or receipt cannot be sent twice by accident. Applies to submit buttons
 * and to buttons whose label says Save, Submit, Confirm, Approve, Dispatch, Reject, Receive, Create, Bind, Replace,
 * Terminate, Send, Delete, Import, Upload, Transmit, Register, Archive, Restore, Push or Notify.
 * Other buttons (paging, +/−, Add row, filters, tabs) are not affected. A button can opt out with data-allow-repeat.
 * The database keeps its own checks (row versions, request status); this stops the duplicate before it is sent.
 */
const SAVE_WORDS = /\b(save|submit|confirm|approve|dispatch|reject|receive|create|bind|replace|terminate|send|delete|import|upload|transmit|register|archive|restore|push|notify|sign in|change password)\b/i;
const WINDOW_MS = 800; // a double-click is normally under 500 ms

let started = false;
let lastClick = new WeakMap<Element, number>();

export function isSaveButton(el: Element): boolean {
  if (el.hasAttribute('data-allow-repeat')) return false;
  if ((el as HTMLButtonElement).type === 'submit' && el.closest('form')) return true;
  const label = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.textContent || ''}`;
  return SAVE_WORDS.test(label);
}

export function startClickGuard(): void {
  if (started || typeof document === 'undefined') return;
  started = true;
  document.addEventListener(
    'click',
    (e) => {
      const target = e.target as Element | null;
      const btn = target?.closest?.('button, [role="button"], input[type="submit"]');
      if (!btn || !isSaveButton(btn)) return;
      const now = performance.now();
      const prev = lastClick.get(btn);
      if (prev !== undefined && now - prev < WINDOW_MS) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      lastClick.set(btn, now);
    },
    true // capture: runs before the screen's own click handlers
  );
  // typing or changing a field is a new intention (e.g. correcting a password): the next click always goes through
  const reset = () => { lastClick = new WeakMap(); };
  document.addEventListener('input', reset, true);
  document.addEventListener('change', reset, true);
}

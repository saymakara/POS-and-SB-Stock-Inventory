/**
 * (20 Nov 2026, security review) Links that come from stored records (Telegram post links, photo links) are opened only
 * when they are plain web addresses. A record holding `javascript:...` or `data:...` would otherwise run in the signed-in
 * admin's browser when the link is clicked. Returns the link, or '' when it must not be opened.
 */
export function safeHref(url: string | null | undefined): string {
  const s = String(url ?? '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch {
    return '';
  }
}

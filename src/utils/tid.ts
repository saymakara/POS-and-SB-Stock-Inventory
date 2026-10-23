/** The TID is always the last 8 digits of the 15-digit MID. Any other MID keeps the TID that was entered. */
export function tidFromMid(mid: string | undefined, fallback = ''): string {
  const m = (mid || '').trim();
  return /^\d{15}$/.test(m) ? m.slice(-8) : (fallback || '').trim();
}

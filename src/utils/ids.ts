/**
 * Record IDs that never collide (22 Oct 2026). The old IDs (e.g. REQ-2026-<count>, RET-<last 6 digits of the clock>)
 * repeated across branches and every ~17 minutes, so one record could overwrite another.
 * Format: PREFIX-YYYYMMDD-XXXXXX (6 random letters/digits from the browser's secure random source).
 */
import { todayPP } from './time';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newRecordId(prefix: string): string {
  const b = new Uint32Array(6);
  crypto.getRandomValues(b);
  return `${prefix}-${todayPP().replace(/-/g, '')}-${Array.from(b, (n) => ALPHABET[n % ALPHABET.length]).join('')}`;
}

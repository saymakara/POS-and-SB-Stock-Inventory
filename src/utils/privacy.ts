/**
 * Merchant contact details on screen (22 Oct 2026). Branch staff see a phone number masked ("012 *** 205") unless
 * they choose to reveal it; admins see it in full. Flagged for compliance review: who may see merchant phone numbers.
 */
import { UserRole } from '../types';
export function maskPhone(phone: string | null | undefined): string {
  const p = String(phone || '').trim();
  if (!p) return '—';
  const d = p.replace(/\D/g, '');
  if (d.length < 6) return '***';
  return `${d.slice(0, 3)} *** ${d.slice(-3)}`;
}
export const canSeeFullContact = (role: UserRole) => role === 'ADMIN' || role === 'SUPER_ADMIN';
export const phoneFor = (role: UserRole, phone: string | null | undefined) => (canSeeFullContact(role) ? (String(phone || '').trim() || '—') : maskPhone(phone));

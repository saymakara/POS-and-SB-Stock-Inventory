/**
 * The device life cycle in one place (22 Oct 2026): which stage may follow which, and what a move does to the
 * merchant binding. Every screen and handler that changes a stage uses this, so a unit can never jump from HQ stock
 * straight to "Installed Live", or keep an old merchant's MID after it was taken back.
 *
 * HQ_STOCK ──dispatch/receipt──▶ BRANCH_RESERVE ──▶ CONFIGURING ──▶ COMPLETE (installed at a merchant)
 * COMPLETE ──▶ FAULTY (taken back / terminated) or BRANCH_RESERVE (taken back, working) or LOST
 * FAULTY ──▶ HQ_STOCK (repaired at HQ) or BRANCH_RESERVE; LOST ──▶ HQ_STOCK / BRANCH_RESERVE (found)
 */
import { Device, LifecycleStage } from '../types';

export const ALLOWED_NEXT: Record<LifecycleStage, LifecycleStage[]> = {
  HQ_STOCK: ['BRANCH_RESERVE', 'LOST'],
  BRANCH_RESERVE: ['CONFIGURING', 'COMPLETE', 'HQ_STOCK', 'LOST'],
  CONFIGURING: ['COMPLETE', 'BRANCH_RESERVE', 'LOST'],
  COMPLETE: ['BRANCH_RESERVE', 'HQ_STOCK', 'LOST'],
  FAULTY: ['HQ_STOCK', 'BRANCH_RESERVE', 'LOST'],      // only for units that were already marked faulty before: they can leave this stage
  LOST: ['HQ_STOCK', 'BRANCH_RESERVE'],
};
export const canMove = (from: LifecycleStage, to: LifecycleStage) => from === to || ALLOWED_NEXT[from].includes(to);
export function moveError(from: LifecycleStage, to: LifecycleStage, labels: Record<string, { short: string }>): string {
  if (canMove(from, to)) return '';
  return `A unit cannot go from ${labels[from]?.short || from} to ${labels[to]?.short || to}. Allowed next: ${ALLOWED_NEXT[from].map((s) => labels[s]?.short || s).join(', ')}.`;
}
/** The status texts that go with a stage (one wording everywhere). */
export function statusOf(stage: LifecycleStage): { deploymentStatus: string; stockStatus: string } {
  switch (stage) {
    case 'COMPLETE': return { deploymentStatus: 'Deployed', stockStatus: 'At Merchant' };
    case 'CONFIGURING': return { deploymentStatus: 'In-process', stockStatus: 'In-Stock' };
    case 'FAULTY': return { deploymentStatus: 'Faulty / Returned', stockStatus: 'Faulty' };
    case 'LOST': return { deploymentStatus: 'Lost', stockStatus: 'Lost' };
    default: return { deploymentStatus: 'In-Stock (Reserve)', stockStatus: 'In-Stock' };
  }
}
/** A unit that is no longer at a merchant keeps no merchant details (they live on in Merchant History). */
export function unbound<T extends Device>(d: T): T {
  return { ...d, mid: '', tid: '', merchantName: '', merchantPhone: '', address: '', location: '', installedByStaff: '', replacedByStaff: '', deployedDate: '' };
}
/** The fields to apply when a unit moves to `to` (status texts; merchant cleared when it leaves the merchant). */
export function onMove<T extends Device>(d: T, to: LifecycleStage): T {
  const base = { ...d, stage: to, ...statusOf(to) } as T;
  return to === 'COMPLETE' || to === 'CONFIGURING' ? base : unbound(base);
}

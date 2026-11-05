import { clearFresh } from '../utils/freshness';
import type { MvVisit, MvVisitSummary } from './supabaseService';

/**
 * (4 Nov 2026) Merchant Visit: the last answers, kept in memory only (they hold merchant details; never written to disk,
 * emptied on sign-out). Going back to the page shows them at once and the fresh answer replaces them quietly, as on the
 * other review pages (before, the page flashed "Loading" on every visit).
 */
const pages = new Map<string, { rows: MvVisit[]; total: number }>();
const summaries = new Map<string, MvVisitSummary>();
export const getMvPage = (k: string) => pages.get(k);
export const setMvPage = (k: string, v: { rows: MvVisit[]; total: number }) => { if (pages.size > 40) pages.clear(); pages.set(k, v); };
export const getMvSummary = (k: string) => summaries.get(k);
export const setMvSummary = (k: string, v: MvVisitSummary) => { if (summaries.size > 20) summaries.clear(); summaries.set(k, v); };
export function clearMvCache(): void { pages.clear(); summaries.clear(); clearFresh('mv:'); }

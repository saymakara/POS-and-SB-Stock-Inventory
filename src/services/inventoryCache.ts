import { markFresh, clearFresh } from '../utils/freshness';
import { registerPortalCacheInvalidator } from '../utils/portalSync';
import type { Device, PaginatedResult } from '../types';
import { clearOnUserChange, rememberRecent } from '../utils/userScopedCache';

/**
 * (5 Nov 2026, speed) Inventory device page cache.
 * Keeps recently fetched server pages for Stock Inventory (POS Terminal, Sound Box, All) in memory.
 * Switching between POS Terminal and Sound Box shows cached rows at once without re-querying the database.
 * Memory only; cleared on sign-out / user switch.
 */
const pages = new Map<string, PaginatedResult<Device>>();
const MAX_KEYS = 50;

export function makeDevicePageKey(params: {
  page?: number;
  pageSize?: number;
  stage?: string;
  type?: string;
  branchId?: string;
  search?: string;
  archived?: boolean;
  orderCol?: string;
  ascending?: boolean;
}): string {
  return [
    params.page || 1,
    params.pageSize || 50,
    params.stage || 'ALL',
    params.type || 'ALL',
    params.branchId || 'ALL',
    (params.search || '').trim().toLowerCase(),
    params.archived ? 1 : 0,
    params.orderCol || 'serial',
    params.ascending !== false ? 1 : 0,
  ].join(':');
}

export const getCachedDevicePage = (k: string): PaginatedResult<Device> | undefined => pages.get(k);

export function setCachedDevicePage(k: string, v: PaginatedResult<Device>): void {
  rememberRecent(pages, k, v, MAX_KEYS);
  markFresh('inv:p:' + k);
}

export function clearInventoryCache(): void {
  pages.clear();
  clearFresh('inv:');
}

// (26 Nov 2026, enterprise data) a change by anyone marks the kept answers out of date instead of throwing them away: the page shows them at once and reads the new ones quietly behind them (stale while revalidate). Before, every change emptied the copy and the next visit showed a loading state.
export function markInventoryStale(): void { clearFresh('inv:'); }
registerPortalCacheInvalidator(['devices'], markInventoryStale);

clearOnUserChange(clearInventoryCache);

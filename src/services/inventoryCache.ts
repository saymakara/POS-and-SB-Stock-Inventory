import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { markFresh, clearFresh } from '../utils/freshness';
import type { Device, PaginatedResult } from '../types';

/**
 * (5 Nov 2026, speed) Inventory device page cache.
 * Keeps recently fetched server pages for Stock Inventory (POS Terminal, Sound Box, All) in memory.
 * Switching between POS Terminal and Sound Box shows cached rows at once without re-querying the database.
 * Memory only; cleared on sign-out / user switch.
 */
const pages = new Map<string, PaginatedResult<Device>>();
let owner: string | null | undefined;
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
  pages.delete(k);
  pages.set(k, v);
  while (pages.size > MAX_KEYS) {
    const firstKey = pages.keys().next().value;
    if (firstKey) pages.delete(firstKey);
  }
  markFresh('inv:p:' + k);
}

export function clearInventoryCache(): void {
  pages.clear();
  clearFresh('inv:');
}

if (isSupabaseConfigured) {
  try {
    supabase.auth.onAuthStateChange((_e, session) => {
      const id = session?.user?.id ?? null;
      if (owner !== undefined && id !== owner) clearInventoryCache();
      owner = id;
    });
  } catch {
    /* cache stays empty */
  }
}

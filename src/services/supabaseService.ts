import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Device, Requisition, HistoricalMerchantRecord, LifecycleStage, ArrangedDeviceItem } from '../types';
import { normalizeMid } from '../utils/display';
import { reportCaughtError } from '../utils/errorLogger';

/** Batch size and inter-batch delay for CSV / bulk device inserts (prevents connection pool exhaustion & payload timeouts). */
export const CSV_BATCH_SIZE = 100;
export const CSV_BATCH_DELAY_MS = 150;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface PaginatedResult<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Maps Supabase snake_case / postgres schema to application Device type
 */
function mapRowToDevice(row: any): Device {
  const stage = (row.stage || 'HQ_STOCK') as LifecycleStage;
  const cf: Record<string, string> = {};
  Object.entries(row.custom_fields && typeof row.custom_fields === 'object' ? row.custom_fields : {}).forEach(
    ([k, v]) => {
      if (v !== null && v !== undefined) cf[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
  );
  return {
    installedByStaff: cf.installedByStaff || undefined,
    replacedByStaff: cf.replacedByStaff || undefined,
    returnedByStaff: cf.returnedByStaff || undefined,
    returnedDate: cf.returnedDate || undefined,
    replacementDate: cf.replacementDate || undefined,
    replacedDate: cf.replacedDate || undefined,
    replacedFromSerial: cf.replacedFromSerial || undefined,
    replacedPrevSerial: cf.replacedPrevSerial || undefined,
    pushTrackingId: cf.pushTrackingId || row.push_tracking_id || undefined,
    pushDate: cf.pushDate || row.push_date || undefined,
    pushedBy: cf.pushedBy || row.pushed_by || undefined,
    staffTelegram: cf.staffTelegram || row.staff_telegram || undefined,
    serial: row.serial,
    batterySerial: row.battery_serial || undefined,
    batteryInstalledDate: row.battery_installed_date || undefined,
    type: row.type || 'POS Terminal',
    model: row.model || '',
    stockInDate: row.stock_in_date || '',
    branchId: row.branch_id || '100',
    branchName:
      row.branch_name ||
      (row.branch_id === '100' || !row.branch_id ? 'Head Office' : `Branch Code ${row.branch_id}`),
    staff: row.staff || '',
    stage,
    deploymentStatus:
      row.deployment_status ||
      (stage === 'COMPLETE'
        ? 'Deployed'
        : stage === 'BRANCH_RESERVE' || stage === 'HQ_STOCK'
        ? 'In-Stock (Reserve)'
        : 'In-process'),
    stockStatus: row.stock_status || (stage === 'COMPLETE' ? 'At Merchant' : 'In-Stock'),
    mid: normalizeMid(row.mid),
    tid: row.tid || '',
    merchantName: row.merchant_name || '',
    merchantPhone: row.merchant_phone || '',
    location: row.location || '',
    address: row.address || '',
    deployedDate: row.deployed_date || '',
    returnReason: row.return_reason || '',
    redeployCount: row.redeploy_count || 0,
    hoursInStage: row.hours_in_stage || 0,
    updatedAt: row.updated_at || '',
    note: row.note || '',
    history: Array.isArray(row.history) ? row.history : [],
    archived: Boolean(row.archived),
    integrityHash: row.integrity_hash || undefined,
    customFields: cf,
    rowVersion: typeof row.row_version === 'number' ? row.row_version : Number(row.row_version) || undefined,
  };
}

/**
 * Maps application Device to Supabase database row format
 */
function mapDeviceToRow(dev: Device): any {
  return {
    serial: dev.serial,
    type: dev.type,
    model: dev.model,
    stage: dev.stage,
    branch_id: dev.branchId,
    branch_name: dev.branchName,
    stock_in_date: dev.stockInDate || null,
    deployed_date: dev.deployedDate || null,
    battery_installed_date: dev.batteryInstalledDate || null,
    battery_serial: dev.batterySerial || null,
    redeploy_count: dev.redeployCount || 0,
    staff: dev.staff || null,
    merchant_name: dev.merchantName || null,
    merchant_phone: dev.merchantPhone || null,
    location: dev.location || null,
    address: dev.address || null,
    mid: normalizeMid(dev.mid) || null,
    tid: dev.tid || null,
    note: dev.note || null,
    history: dev.history || [],
    archived: Boolean(dev.archived),
    custom_fields: Object.assign(
      {},
      dev.customFields || {},
      Object.fromEntries(
        (
          [
            'installedByStaff',
            'replacedByStaff',
            'returnedByStaff',
            'returnedDate',
            'replacementDate',
            'replacedDate',
            'replacedFromSerial',
            'replacedPrevSerial',
            'staffTelegram',
            'pushTrackingId',
            'pushDate',
            'pushedBy',
          ] as const
        )
          .filter((k) => dev[k])
          .map((k) => [k, String(dev[k])])
      )
    ),
    return_reason: dev.returnReason || null,
    deployment_status: dev.deploymentStatus || null,
    stock_status: dev.stockStatus || null,
    hours_in_stage: dev.hoursInStage || 0,
    integrity_hash: dev.integrityHash || null,
    ...(dev.rowVersion ? { row_version: dev.rowVersion } : {}),
  };
}

/**
 * Maps Supabase row to application Requisition type
 */
function mapRowToRequisition(row: any): Requisition {
  return {
    reqId: row.req_id || row.id,
    date: row.date || row.created_at || new Date().toISOString(),
    branchId: row.branch_id || '100',
    branchName: row.branch_name || '',
    staff: row.staff || row.request_officer || '',
    posQty: Number(row.pos_qty) || 0,
    sbQty: Number(row.sb_qty || row.soundbox_qty) || 0,
    reason: row.reason || '',
    status: row.status || 'PENDING_ADMIN',
    arrangedDevices: Array.isArray(row.arranged_devices) ? row.arranged_devices : [],
    type: row.type === 'STOCK_RETURN' ? 'STOCK_RETURN' : 'STOCK_REQUEST',
    returnSerials: Array.isArray(row.return_serials) ? row.return_serials.map(String) : [],
    rejectReason: row.reject_reason || undefined,
    rejectedBy: row.rejected_by || undefined,
    rejectedAt: row.rejected_at || undefined,
  };
}

/**
 * Maps application Requisition to Supabase row format
 */
function mapRequisitionToRow(req: Requisition): any {
  return {
    req_id: req.reqId,
    date: req.date,
    branch_id: req.branchId,
    branch_name: req.branchName,
    staff: req.staff,
    pos_qty: req.posQty,
    sb_qty: req.sbQty,
    reason: req.reason,
    status: req.status,
    arranged_devices: req.arrangedDevices || [],
    type: req.type || 'STOCK_REQUEST',
    return_serials: req.returnSerials || [],
  };
}

/**
 * Strict Server-Side Paginated table reader using Supabase limit() and range(offset, offset + limit - 1).
 * Never downloads the entire dataset to slice locally; only fetches the active page.
 */
async function fetchPaginatedRows(
  table: string,
  orderCol: string,
  options: {
    limit?: number;
    offset?: number;
    ascending?: boolean;
    skipCount?: boolean;
    filters?: (query: any) => any;
  } = {}
): Promise<{ rows: any[]; count: number } | null> {
  const limit = Math.max(1, Math.min(options.limit || 50, 1000));
  const offset = Math.max(0, options.offset || 0);
  const ascending = options.ascending !== false;

  try {
    let q: any = supabase
      .from(table)
      .select('*', options.skipCount ? undefined : { count: 'exact' })
      .order(orderCol, { ascending });

    if (options.filters) {
      q = options.filters(q);
    }

    const { data, error, count } = await q.limit(limit).range(offset, offset + limit - 1);
    if (error) {
      throw error;
    }
    return {
      rows: data || [],
      count: typeof count === 'number' ? count : (data || []).length,
    };
  } catch (err) {
    await reportCaughtError(`fetchPaginatedRows(${table})`, err, { target: table, showPopup: false });
    return null;
  }
}

// -----------------------------------------------------------------------------
// DEVICES API (Strict Server-Side Pagination + Batch 100 Inserts)
// -----------------------------------------------------------------------------

export interface DeviceQueryParams {
  page?: number;
  pageSize?: number;
  stage?: string;
  type?: string;
  branchId?: string;
  search?: string;
  archived?: boolean;
  orderCol?: string;
  ascending?: boolean;
  afterSerial?: string;
}

export interface DeviceStageBreakdown {
  count: number;
  posCount: number;
  sbCount: number;
}

export interface DeviceStageSummary {
  all: number;
  hq: number;
  reserve: number;
  config: number;
  complete: number;
  faulty: number;
  lost: number;
  archived: number;
  byStage: Record<LifecycleStage, DeviceStageBreakdown>;
}

const ALL_LIFECYCLE_STAGES: LifecycleStage[] = [
  'HQ_STOCK',
  'BRANCH_RESERVE',
  'CONFIGURING',
  'COMPLETE',
  'FAULTY',
  'LOST',
];

function createEmptyStageSummary(): DeviceStageSummary {
  return {
    all: 0,
    hq: 0,
    reserve: 0,
    config: 0,
    complete: 0,
    faulty: 0,
    lost: 0,
    archived: 0,
    byStage: {
      HQ_STOCK: { count: 0, posCount: 0, sbCount: 0 },
      BRANCH_RESERVE: { count: 0, posCount: 0, sbCount: 0 },
      CONFIGURING: { count: 0, posCount: 0, sbCount: 0 },
      COMPLETE: { count: 0, posCount: 0, sbCount: 0 },
      FAULTY: { count: 0, posCount: 0, sbCount: 0 },
      LOST: { count: 0, posCount: 0, sbCount: 0 },
    },
  };
}

/**
 * Fetches exact 500K-row server-side stage & hardware-type counts without downloading device rows.
 * Uses RPC `get_device_stage_counts` when deployed, with automatic fallback to indexed PostgREST head count queries.
 */
export async function fetchDeviceStageCountsFromSupabase(
  branchId?: string
): Promise<DeviceStageSummary | null> {
  if (!isSupabaseConfigured) return null;
  const normalizedBranch = branchId && branchId !== 'ALL' ? branchId : null;

  try {
    const { data, error } = await supabase.rpc('get_device_stage_counts', {
      p_branch_id: normalizedBranch,
    });
    if (!error && data && typeof data === 'object') {
      const summary = createEmptyStageSummary();
      summary.archived = Number((data as any).archived) || 0;
      const stagesObj = (data as any).stages || {};
      for (const st of ALL_LIFECYCLE_STAGES) {
        const item = stagesObj[st];
        if (item) {
          const count = Number(item.count) || 0;
          const posCount = Number(item.posCount) || 0;
          const sbCount = Number(item.sbCount) || 0;
          summary.byStage[st] = { count, posCount, sbCount };
          summary.all += count;
        }
      }
      summary.hq = summary.byStage.HQ_STOCK.count;
      summary.reserve = summary.byStage.BRANCH_RESERVE.count;
      summary.config = summary.byStage.CONFIGURING.count;
      summary.complete = summary.byStage.COMPLETE.count;
      summary.faulty = summary.byStage.FAULTY.count;
      summary.lost = summary.byStage.LOST.count;
      return summary;
    }
  } catch {
    // Fallback to head-only exact count queries below if RPC is not yet installed
  }

  try {
    const countQuery = async (opts: { archived: boolean; stage?: LifecycleStage; type?: string }) => {
      let q: any = supabase
        .from('devices')
        .select('serial', { count: 'exact', head: true })
        .eq('archived', opts.archived);
      if (normalizedBranch) q = q.eq('branch_id', normalizedBranch);
      if (opts.stage) q = q.eq('stage', opts.stage);
      if (opts.type) q = q.eq('type', opts.type);
      const { count, error } = await q;
      if (error) throw error;
      return typeof count === 'number' ? count : 0;
    };

    const [archivedCount, ...stageBreakdowns] = await Promise.all([
      countQuery({ archived: true }),
      ...ALL_LIFECYCLE_STAGES.map(async (st) => {
        const [posCount, sbCount] = await Promise.all([
          countQuery({ archived: false, stage: st, type: 'POS Terminal' }),
          countQuery({ archived: false, stage: st, type: 'Sound Box' }),
        ]);
        return { stage: st, count: posCount + sbCount, posCount, sbCount };
      }),
    ]);

    const summary = createEmptyStageSummary();
    summary.archived = archivedCount;
    for (const item of stageBreakdowns) {
      summary.byStage[item.stage] = {
        count: item.count,
        posCount: item.posCount,
        sbCount: item.sbCount,
      };
      summary.all += item.count;
    }
    summary.hq = summary.byStage.HQ_STOCK.count;
    summary.reserve = summary.byStage.BRANCH_RESERVE.count;
    summary.config = summary.byStage.CONFIGURING.count;
    summary.complete = summary.byStage.COMPLETE.count;
    summary.faulty = summary.byStage.FAULTY.count;
    summary.lost = summary.byStage.LOST.count;
    return summary;
  } catch (err) {
    await reportCaughtError('fetchDeviceStageCountsFromSupabase', err, { showPopup: false });
    return null;
  }
}

/**
 * Checks an array of candidate CSV serial numbers against the full 500K-row `public.devices` table
 * using B-Tree primary key index `.in('serial', chunk)` lookups in chunks of 200.
 */
export async function checkExistingSerialsOnServer(serials: string[]): Promise<Set<string>> {
  const existing = new Set<string>();
  if (!isSupabaseConfigured || serials.length === 0) return existing;

  const uniqueSerials = Array.from(
    new Set(serials.map((s) => String(s || '').trim().toUpperCase()).filter(Boolean))
  );
  const CHUNK_SIZE = 200;

  try {
    for (let i = 0; i < uniqueSerials.length; i += CHUNK_SIZE) {
      const chunk = uniqueSerials.slice(i, i + CHUNK_SIZE);
      const { data, error } = await supabase
        .from('devices')
        .select('serial')
        .in('serial', chunk);

      if (error) {
        throw error;
      }
      for (const row of data || []) {
        if (row && row.serial) {
          existing.add(String(row.serial).trim().toUpperCase());
        }
      }
    }
  } catch (err) {
    await reportCaughtError('checkExistingSerialsOnServer', err, { showPopup: false });
  }
  return existing;
}

export async function fetchDevicesPageFromSupabase(
  params: DeviceQueryParams = {}
): Promise<PaginatedResult<Device> | null> {
  if (!isSupabaseConfigured) return null;
  const pageSize = params.pageSize === 100 ? 100 : 50;
  const page = Math.max(1, params.page || 1);
  const offset = (page - 1) * pageSize;
  const orderCol = params.orderCol || 'serial';
  const ascending = params.ascending !== false;

  const deviceOffset = params.afterSerial ? 0 : offset;
  const res = await fetchPaginatedRows('devices', orderCol, {
    limit: pageSize,
    offset: deviceOffset,
    ascending,
    filters: (q) => {
      let query = q;
      if (params.afterSerial) {
        query = query.gt('serial', params.afterSerial);
      }
      if (params.archived !== undefined) {
        query = query.eq('archived', params.archived);
      }
      if (params.stage && params.stage !== 'ALL') {
        query = query.eq('stage', params.stage);
      }
      if (params.type && params.type !== 'ALL') {
        query = query.eq('type', params.type);
      }
      if (params.branchId && params.branchId !== 'ALL') {
        query = query.eq('branch_id', params.branchId);
      }
      const term = (params.search || '').trim().replace(/[,()]/g, '');
      if (term) {
        query = query.or(
          `serial.ilike.%${term}%,mid.ilike.%${term}%,tid.ilike.%${term}%,merchant_name.ilike.%${term}%,model.ilike.%${term}%,battery_serial.ilike.%${term}%,branch_id.ilike.%${term}%,staff.ilike.%${term}%`
        );
      }
      return query;
    },
  });

  if (!res) return null;
  return {
    rows: res.rows.map(mapRowToDevice),
    total: res.count,
    page,
    pageSize,
  };
}

export async function fetchDevicesFromSupabase(
  limit = 1000,
  offset = 0,
  onFirstPage?: (rows: Device[], total: number) => void
): Promise<Device[] | null> {
  if (!isSupabaseConfigured) return null;
  const safeLimit = Math.max(100, Math.min(limit, 1000));
  try {
    const first = await fetchPaginatedRows('devices', 'serial', {
      limit: safeLimit,
      offset: Math.max(0, offset),
      ascending: true,
    });
    if (!first) return null;
    const all: Device[] = first.rows.map(mapRowToDevice);
    const totalToFetch = Math.min(first.count, 10000);
    if (onFirstPage) {
      onFirstPage(all.slice(), totalToFetch);
    }
    if (first.rows.length < safeLimit || all.length >= totalToFetch) {
      return all;
    }

    // Fetch remaining 1,000-row pages in parallel without recounting (`skipCount: true`)
    const offsets: number[] = [];
    for (let nextOff = Math.max(0, offset) + safeLimit; nextOff < totalToFetch; nextOff += safeLimit) {
      offsets.push(nextOff);
    }
    const CONCURRENCY = 6;
    for (let i = 0; i < offsets.length; i += CONCURRENCY) {
      const chunk = offsets.slice(i, i + CONCURRENCY);
      const pages = await Promise.all(
        chunk.map((off) =>
          fetchPaginatedRows('devices', 'serial', {
            limit: safeLimit,
            offset: off,
            ascending: true,
            skipCount: true,
          })
        )
      );
      for (const p of pages) {
        if (p && p.rows.length > 0) {
          all.push(...p.rows.map(mapRowToDevice));
        }
      }
    }
    return all;
  } catch (err) {
    await reportCaughtError('fetchDevicesFromSupabase', err, { showPopup: false });
    return null;
  }
}



// -----------------------------------------------------------------------------
// REQUISITIONS API (Strict Server-Side Pagination)
// -----------------------------------------------------------------------------

export interface RequisitionQueryParams {
  page?: number;
  pageSize?: number;
  status?: string;
  type?: string;
  branchId?: string;
  search?: string;
}

export async function fetchRequisitionsPageFromSupabase(
  params: RequisitionQueryParams = {}
): Promise<PaginatedResult<Requisition> | null> {
  if (!isSupabaseConfigured) return null;
  const pageSize = params.pageSize === 100 ? 100 : 50;
  const page = Math.max(1, params.page || 1);
  const offset = (page - 1) * pageSize;

  const res = await fetchPaginatedRows('requisitions', 'req_id', {
    limit: pageSize,
    offset,
    ascending: false,
    filters: (q) => {
      let query = q;
      if (params.status && params.status !== 'ALL') query = query.eq('status', params.status);
      if (params.type && params.type !== 'ALL') query = query.eq('type', params.type);
      if (params.branchId && params.branchId !== 'ALL') query = query.eq('branch_id', params.branchId);
      const term = (params.search || '').trim().replace(/[,()]/g, '');
      if (term) {
        query = query.or(`req_id.ilike.%${term}%,branch_name.ilike.%${term}%,staff.ilike.%${term}%,reason.ilike.%${term}%`);
      }
      return query;
    },
  });

  if (!res) return null;
  return {
    rows: res.rows
      .map(mapRowToRequisition)
      .sort((x, y) => String(y.date).localeCompare(String(x.date)) || y.reqId.localeCompare(x.reqId)),
    total: res.count,
    page,
    pageSize,
  };
}

export async function fetchRequisitionsFromSupabase(limit = 1000, offset = 0): Promise<Requisition[] | null> {
  if (!isSupabaseConfigured) return null;
  const safeLimit = Math.max(100, Math.min(limit, 1000));
  try {
    const allRows: any[] = [];
    let curOffset = Math.max(0, offset);
    while (true) {
      const res = await fetchPaginatedRows('requisitions', 'req_id', {
        limit: safeLimit,
        offset: curOffset,
        ascending: true,
        skipCount: true,
      });
      if (!res) return allRows.length > 0 ? allRows.map(mapRowToRequisition) : null;
      allRows.push(...res.rows);
      if (res.rows.length < safeLimit || allRows.length >= 2000) break;
      curOffset += safeLimit;
    }
    return allRows
      .map(mapRowToRequisition)
      .sort((x, y) => String(y.date).localeCompare(String(x.date)) || y.reqId.localeCompare(x.reqId));
  } catch (err) {
    await reportCaughtError('fetchRequisitionsFromSupabase', err, { showPopup: false });
    return null;
  }
}



// -----------------------------------------------------------------------------
// HISTORICAL MERCHANTS API (Strict Server-Side Pagination)
// -----------------------------------------------------------------------------

function mapRowToHistory(row: any): HistoricalMerchantRecord {
  return {
    recordId: row.record_id,
    merchantName: row.merchant_name,
    merchantPhone: row.merchant_phone,
    address: row.address,
    mid: normalizeMid(row.mid),
    tid: row.tid,
    deviceType: row.device_type,
    model: row.model,
    serial: row.serial,
    batterySerial: row.battery_serial,
    branchId: row.branch_id,
    branchName: row.branch_name,
    installedDate: row.installed_date,
    returnedDate: row.returned_date,
    activeDurationMonths: row.active_duration_months,
    returnReason: row.return_reason,
    status: row.status,
    handledByStaff: row.handled_by_staff,
    installedByStaff: row.installed_by_staff || undefined,
    replacedByStaff: row.replaced_by_staff || undefined,
    returnedByStaff: row.returned_by_staff || undefined,
    settlementFinalized: Boolean(row.settlement_finalized),
    notes: row.notes,
  };
}

export interface HistoricalMerchantsQueryParams {
  page?: number;
  pageSize?: number;
  branchId?: string;
  deviceType?: string;
  reason?: string;
  search?: string;
}

export async function fetchHistoricalMerchantsPageFromSupabase(
  params: HistoricalMerchantsQueryParams = {}
): Promise<PaginatedResult<HistoricalMerchantRecord> | null> {
  if (!isSupabaseConfigured) return null;
  const pageSize = params.pageSize === 100 ? 100 : 50;
  const page = Math.max(1, params.page || 1);
  const offset = (page - 1) * pageSize;

  const res = await fetchPaginatedRows('historical_merchants', 'returned_date', {
    limit: pageSize,
    offset,
    ascending: false,
    filters: (q) => {
      let query = q;
      if (params.branchId && params.branchId !== 'ALL') query = query.eq('branch_id', params.branchId);
      if (params.deviceType && params.deviceType !== 'ALL') query = query.eq('device_type', params.deviceType);
      if (params.reason && params.reason !== 'ALL') query = query.ilike('return_reason', `%${params.reason.slice(0, 15)}%`);
      const term = (params.search || '').trim().replace(/[,()]/g, '');
      if (term) {
        query = query.or(
          `merchant_name.ilike.%${term}%,mid.ilike.%${term}%,tid.ilike.%${term}%,serial.ilike.%${term}%,battery_serial.ilike.%${term}%,return_reason.ilike.%${term}%`
        );
      }
      return query;
    },
  });

  if (!res) return null;
  return {
    rows: res.rows.map(mapRowToHistory),
    total: res.count,
    page,
    pageSize,
  };
}

export async function fetchHistoricalMerchantsFromSupabase(
  limit = 1000,
  offset = 0
): Promise<HistoricalMerchantRecord[] | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const res = await fetchPaginatedRows('historical_merchants', 'record_id', {
      limit: Math.max(100, Math.min(limit, 1000)),
      offset,
      ascending: false,
      skipCount: true,
    });
    if (!res) return null;
    res.rows.sort((x: any, y: any) => String(y.returned_date || '').localeCompare(String(x.returned_date || '')));
    return res.rows.map(mapRowToHistory);
  } catch (err) {
    await reportCaughtError('fetchHistoricalMerchantsFromSupabase', err, { showPopup: false });
    return null;
  }
}

export async function insertHistoricalMerchantToSupabase(rec: HistoricalMerchantRecord): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  try {
    const row = {
      record_id: rec.recordId,
      merchant_name: rec.merchantName,
      merchant_phone: rec.merchantPhone,
      address: rec.address,
      mid: normalizeMid(rec.mid),
      tid: rec.tid,
      device_type: rec.deviceType,
      model: rec.model,
      serial: rec.serial,
      battery_serial: rec.batterySerial,
      branch_id: rec.branchId,
      branch_name: rec.branchName,
      installed_date: /^\d{4}-\d{2}-\d{2}/.test(rec.installedDate || '') ? rec.installedDate.slice(0, 10) : null,
      returned_date: /^\d{4}-\d{2}-\d{2}/.test(rec.returnedDate || '') ? rec.returnedDate.slice(0, 10) : null,
      active_duration_months: rec.activeDurationMonths,
      return_reason: rec.returnReason,
      status: rec.status,
      handled_by_staff: rec.handledByStaff,
      installed_by_staff: rec.installedByStaff || null,
      replaced_by_staff: rec.replacedByStaff || null,
      returned_by_staff: rec.returnedByStaff || null,
      settlement_finalized: rec.settlementFinalized,
      notes: rec.notes,
    };

    const { error } = await supabase.from('historical_merchants').insert(row);
    if (error) {
      throw error;
    }
    return true;
  } catch (err) {
    await reportCaughtError('insertHistoricalMerchantToSupabase', err, { target: rec.serial || rec.recordId });
    return false;
  }
}

// -----------------------------------------------------------------------------
// REALTIME SUBSCRIPTION
// -----------------------------------------------------------------------------

let channelSeq = 0;
const channelName = (base: string) => `${base}_${Date.now().toString(36)}_${++channelSeq}`;

export function subscribeToRealtimeChanges(
  onDeviceChange: (updatedDevice: Device) => void,
  onRequisitionChange?: (updatedReq: Requisition) => void,
  extra?: {
    onDeviceDelete?: (serial: string) => void;
    onRequisitionDelete?: (reqId: string) => void;
    onHistoryInsert?: (rec: HistoricalMerchantRecord) => void;
    onReconnect?: () => void;
  }
): () => void {
  if (!isSupabaseConfigured) return () => {};
  let dropped = false;
  const channel = supabase
    .channel(channelName('inventory_realtime_feed'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, (payload) => {
      if (payload.eventType === 'DELETE') {
        const serial = (payload.old as any)?.serial;
        if (serial) extra?.onDeviceDelete?.(serial);
        return;
      }
      if (payload.new && (payload.new as any).serial) onDeviceChange(mapRowToDevice(payload.new));
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'requisitions' }, (payload) => {
      if (payload.eventType === 'DELETE') {
        const id = (payload.old as any)?.req_id;
        if (id) extra?.onRequisitionDelete?.(id);
        return;
      }
      if (payload.new && (payload.new as any).req_id && onRequisitionChange)
        onRequisitionChange(mapRowToRequisition(payload.new));
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'historical_merchants' }, (payload) => {
      if (payload.new && (payload.new as any).record_id) extra?.onHistoryInsert?.(mapRowToHistory(payload.new));
    })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') dropped = true;
      else if (status === 'SUBSCRIBED' && dropped) {
        dropped = false;
        extra?.onReconnect?.();
      }
    });

  return () => {
    supabase.removeChannel(channel);
  };
}

// -----------------------------------------------------------------------------
// SAVING WITH BATCH INSERTS (100 ROWS PER BATCH + DELAY), REVIEW QUEUE, STAFF
// -----------------------------------------------------------------------------

function friendlyDbError(msg: string, serial?: string): string {
  if (/mid_digits/.test(msg))
    return `the MID${serial ? ' of ' + serial : ''} must be digits only (15 digits; a number shortened by Excel such as "1.00001E+14" cannot be saved)`;
  return msg;
}

export interface SaveResult {
  error: string;
  stale: boolean;
  versions: Map<string, number>;
}

/**
 * Saves devices using Batch Inserts of 100 rows at a time with a slight delay (150ms) between batches,
 * protecting the Supabase connection pool and preventing payload timeouts on large CSV uploads.
 * Wrapped in try/catch with Error-Only Logging (no logs on success).
 */
export async function saveDevicesStrict(
  devices: Device[],
  onBatchProgress?: (inserted: number, total: number, batchNum: number, totalBatches: number) => void
): Promise<SaveResult> {
  const versions = new Map<string, number>();
  if (!isSupabaseConfigured || devices.length === 0) return { error: '', stale: false, versions };
  const note = (data: any[] | null) =>
    (data || []).forEach((r: any) => versions.set(r.serial, Number(r.row_version)));

  try {
    const fresh = devices.filter((d) => !d.rowVersion);
    const known = devices.filter((d) => d.rowVersion);
    const totalBatches = Math.max(1, Math.ceil(fresh.length / CSV_BATCH_SIZE));

    for (let i = 0; i < fresh.length; i += CSV_BATCH_SIZE) {
      const batchSlice = fresh.slice(i, i + CSV_BATCH_SIZE);
      const batchNum = Math.floor(i / CSV_BATCH_SIZE) + 1;

      const { data, error } = await supabase
        .from('devices')
        .insert(batchSlice.map(mapDeviceToRow))
        .select('serial,row_version');

      if (error) {
        const dup = /duplicate key|23505/i.test(error.message + (error as any).code);
        const friendly = dup
          ? 'a unit with this serial already exists in the inventory'
          : friendlyDbError(error.message);
        await reportCaughtError('saveDevicesStrict.batchInsert', error, {
          target: batchSlice[0]?.serial,
        });
        return { error: friendly, stale: false, versions };
      }

      note(data);
      const insertedSoFar = Math.min(fresh.length, i + batchSlice.length);
      if (onBatchProgress) {
        onBatchProgress(insertedSoFar, fresh.length, batchNum, totalBatches);
      }

      // Slight delay between batches of 100 rows so we never exhaust the connection pool
      if (i + CSV_BATCH_SIZE < fresh.length) {
        await sleep(CSV_BATCH_DELAY_MS);
      }
    }

    let first: { error: string; stale: boolean } | null = null;
    for (let i = 0; i < known.length && !first; i += 6) {
      await Promise.all(
        known.slice(i, i + 6).map(async (d) => {
          try {
            const { data, error } = await supabase
              .from('devices')
              .update(mapDeviceToRow(d))
              .eq('serial', d.serial)
              .select('serial,row_version');
            if (error) {
              const stale = /STALE_ROW|PT409/.test(error.message + (error as any).code);
              first = first || {
                error: stale
                  ? `${d.serial} was changed by someone else just now`
                  : friendlyDbError(error.message, d.serial),
                stale,
              };
              await reportCaughtError('saveDevicesStrict.update', error, { target: d.serial });
            } else if (!data || data.length === 0) {
              const accessErr = `you do not have access to change ${d.serial}`;
              first = first || { error: accessErr, stale: false };
              await reportCaughtError(
                'saveDevicesStrict.updateAccess',
                { code: '42501', message: accessErr },
                { target: d.serial }
              );
            } else {
              note(data);
            }
          } catch (innerErr) {
            first = first || {
              error: innerErr instanceof Error ? innerErr.message : 'Network error',
              stale: false,
            };
            await reportCaughtError('saveDevicesStrict.updateException', innerErr, { target: d.serial });
          }
        })
      );
    }
    return first ? { ...(first as { error: string; stale: boolean }), versions } : { error: '', stale: false, versions };
  } catch (err) {
    await reportCaughtError('saveDevicesStrict', err, { target: devices[0]?.serial });
    return { error: err instanceof Error ? err.message : 'Network error', stale: false, versions };
  }
}

/** Saves a new or edited requisition (Error-Only Logging). */
export async function saveRequisitionStrict(req: Requisition, isNew: boolean): Promise<string> {
  if (!isSupabaseConfigured) return '';
  try {
    const row = mapRequisitionToRow(req);
    const { error } = isNew
      ? await supabase.from('requisitions').insert(row)
      : await supabase
          .from('requisitions')
          .update({ reason: row.reason, staff: row.staff, pos_qty: row.pos_qty, sb_qty: row.sb_qty })
          .eq('req_id', req.reqId);
    if (error) {
      throw error;
    }
    return '';
  } catch (err) {
    await reportCaughtError('saveRequisitionStrict', err, { target: req.reqId });
    return err instanceof Error ? err.message : String((err as any)?.message || 'Network error');
  }
}

/** Super Admin deletes units permanently in batches of 100 with delay (Error-Only Logging). */
export async function deleteDevicesOnServer(serials: string[]): Promise<string> {
  if (!isSupabaseConfigured || !serials.length) return '';
  try {
    for (let i = 0; i < serials.length; i += CSV_BATCH_SIZE) {
      const { error } = await supabase.from('devices').delete().in('serial', serials.slice(i, i + CSV_BATCH_SIZE));
      if (error) {
        throw error;
      }
      if (i + CSV_BATCH_SIZE < serials.length) {
        await sleep(CSV_BATCH_DELAY_MS);
      }
    }
    return '';
  } catch (err) {
    await reportCaughtError('deleteDevicesOnServer', err, { target: serials[0] });
    return err instanceof Error ? err.message : String((err as any)?.message || 'Network error');
  }
}

/** Super Admin: delete all Merchant History records (Error-Only Logging). */
export async function deleteAllHistoricalMerchantsOnServer(): Promise<string> {
  if (!isSupabaseConfigured) return '';
  try {
    const { error } = await supabase.from('historical_merchants').delete().not('record_id', 'is', null);
    if (error) {
      throw error;
    }
    return '';
  } catch (err) {
    await reportCaughtError('deleteAllHistoricalMerchantsOnServer', err);
    return err instanceof Error ? err.message : String((err as any)?.message || 'Network error');
  }
}

export async function dispatchRequisitionOnServer(
  reqId: string,
  serials: string[],
  note?: string
): Promise<ArrangedDeviceItem[]> {
  try {
    const { data, error } = await supabase.rpc('admin_dispatch_requisition', {
      p_req_id: reqId,
      p_serials: serials,
      p_note: note || null,
    });
    if (error) throw error;
    return (data && data.arranged) || [];
  } catch (err) {
    await reportCaughtError('dispatchRequisitionOnServer', err, { target: reqId });
    throw new Error(err instanceof Error ? err.message : String((err as any)?.message || err));
  }
}

export async function rejectRequisitionOnServer(reqId: string, reason: string): Promise<void> {
  try {
    const { error } = await supabase.rpc('admin_reject_requisition', { p_req_id: reqId, p_reason: reason });
    if (error) throw error;
  } catch (err) {
    await reportCaughtError('rejectRequisitionOnServer', err, { target: reqId });
    throw new Error(err instanceof Error ? err.message : String((err as any)?.message || err));
  }
}

export async function receiveReturnOnServer(
  reqId: string,
  note?: string
): Promise<{ moved: string[]; skipped: string[] }> {
  try {
    const { data, error } = await supabase.rpc('admin_receive_return', { p_req_id: reqId, p_note: note || null });
    if (error) throw error;
    return { moved: (data && data.moved) || [], skipped: (data && data.skipped) || [] };
  } catch (err) {
    await reportCaughtError('receiveReturnOnServer', err, { target: reqId });
    throw new Error(err instanceof Error ? err.message : String((err as any)?.message || err));
  }
}

export async function confirmReceiptOnServer(reqId: string): Promise<{ moved: string[]; skipped: string[] }> {
  try {
    const { data, error } = await supabase.rpc('branch_confirm_receipt', { p_req_id: reqId });
    if (error) throw error;
    return { moved: (data && data.moved) || [], skipped: (data && data.skipped) || [] };
  } catch (err) {
    await reportCaughtError('confirmReceiptOnServer', err, { target: reqId });
    throw new Error(err instanceof Error ? err.message : String((err as any)?.message || err));
  }
}

/**
 * Error-Only Audit Logging (25 Oct 2026).
 * To protect the Supabase log ingestion quota, routine 'Success' or 'Info' operations DO NOT write to the database.
 * Only actual errors (where action === 'ERROR' or title/detail indicates a failure) are written to Supabase.
 */
export async function writeAuditLog(
  title: string,
  detail: string,
  action?: string,
  target?: string
): Promise<void> {
  if (!isSupabaseConfigured) return;
  const isError =
    action === 'ERROR' || /\b(error|failed|failure|exception|refused|halted)\b/i.test(`${title} ${action || ''}`);
  if (!isError) {
    // Error-Only logging model: do not ping the database on successful or informational operations
    return;
  }
  try {
    const { error } = await supabase.from('audit_logs').insert({
      title: title.slice(0, 160),
      detail,
      action: action || 'ERROR',
      target: target || null,
    });
    if (error) throw error;
  } catch (err) {
    await reportCaughtError('writeErrorAuditLog', err, { skipDbLog: true, showPopup: false });
  }
}

export interface ServerAuditEntry {
  id: number;
  title: string;
  detail: string;
  role: string | null;
  branchId: string | null;
  createdAt: string;
  actorEmp: string | null;
  actorName: string | null;
  action: string | null;
  target: string | null;
}

export async function fetchAuditLogs(limit = 50, offset = 0): Promise<ServerAuditEntry[] | null> {
  if (!isSupabaseConfigured) return null;
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const safeOffset = Math.max(0, offset);
  try {
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(safeLimit)
      .range(safeOffset, safeOffset + safeLimit - 1);
    if (error) throw error;
    return (data || []).map((r: any) => ({
      id: r.id,
      title: r.title,
      detail: r.detail,
      role: r.role,
      branchId: r.branch_id,
      createdAt: r.created_at,
      actorEmp: r.actor_emp,
      actorName: r.actor_name,
      action: r.action,
      target: r.target,
    }));
  } catch (err) {
    await reportCaughtError('fetchAuditLogs', err, { showPopup: false });
    return null;
  }
}

export async function fetchAuditLogsPageFromSupabase(params: {
  page?: number;
  pageSize?: number;
  role?: string;
  search?: string;
}): Promise<PaginatedResult<ServerAuditEntry> | null> {
  if (!isSupabaseConfigured) return null;
  const pageSize = params.pageSize === 100 ? 100 : 50;
  const page = Math.max(1, params.page || 1);
  const offset = (page - 1) * pageSize;

  const res = await fetchPaginatedRows('audit_logs', 'created_at', {
    limit: pageSize,
    offset,
    ascending: false,
    filters: (q) => {
      let query = q;
      if (params.role && params.role !== 'ALL') {
        query = query.eq('role', params.role);
      }
      const term = (params.search || '').trim().replace(/[,()]/g, '');
      if (term) {
        query = query.or(
          `title.ilike.%${term}%,detail.ilike.%${term}%,actor_name.ilike.%${term}%,actor_emp.ilike.%${term}%,branch_id.ilike.%${term}%,target.ilike.%${term}%`
        );
      }
      return query;
    },
  });

  if (!res) return null;
  return {
    rows: res.rows.map((r: any) => ({
      id: r.id,
      title: r.title,
      detail: r.detail,
      role: r.role,
      branchId: r.branch_id,
      createdAt: r.created_at,
      actorEmp: r.actor_emp,
      actorName: r.actor_name,
      action: r.action,
      target: r.target,
    })),
    total: res.count,
    page,
    pageSize,
  };
}

export type FieldEventStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED' | 'CANCELLED';
export interface FieldIssue {
  code: string;
  level: 'warn' | 'block';
  text: string;
}
export interface FieldEvent {
  id: number;
  sourceRecordId: string;
  unitNo: number;
  revision: number;
  kind: 'INSTALL' | 'REPLACE' | 'BATTERY' | 'SB_MAINT' | 'SB_RETURN';
  deviceType: 'POS Terminal' | 'Sound Box';
  serial: string;
  oldSerial: string | null;
  oldBattery: string | null;
  newBattery: string | null;
  mid: string | null;
  tid: string | null;
  terminalName: string | null;
  outletName: string | null;
  branchText: string | null;
  branchId: string | null;
  staffId: string | null;
  staffName: string | null;
  recordedAt: string;
  latitude: number | null;
  longitude: number | null;
  remarks: string | null;
  payload: any;
  issues: FieldIssue[];
  status: FieldEventStatus;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  applied: any;
  receivedAt: string;
}

function mapFieldEvent(r: any): FieldEvent {
  return {
    id: r.id,
    sourceRecordId: r.source_record_id,
    unitNo: r.unit_no,
    revision: r.revision,
    kind: r.kind,
    deviceType: r.device_type,
    serial: r.serial,
    oldSerial: r.old_serial,
    oldBattery: r.old_battery,
    newBattery: r.new_battery,
    mid: r.mid,
    tid: r.tid,
    terminalName: r.terminal_name,
    outletName: r.outlet_name,
    branchText: r.branch_text,
    branchId: r.branch_id,
    staffId: r.staff_id,
    staffName: r.staff_name,
    recordedAt: r.recorded_at,
    latitude: r.latitude,
    longitude: r.longitude,
    remarks: r.remarks,
    payload: r.payload || {},
    issues: Array.isArray(r.issues) ? r.issues : [],
    status: r.status,
    reviewedByName: r.reviewed_by_name,
    reviewedAt: r.reviewed_at,
    reviewNote: r.review_note,
    applied: r.applied,
    receivedAt: r.received_at,
  };
}

export async function fetchBranchRegions(): Promise<Record<string, string>> {
  try {
    const { data, error } = await supabase.from('branches').select('id,region').limit(100).range(0, 99);
    if (error) throw error;
    const m: Record<string, string> = {};
    (data || []).forEach((b: any) => {
      m[String(b.id)] = String(b.region || '');
    });
    return m;
  } catch (err) {
    await reportCaughtError('fetchBranchRegions', err, { showPopup: false });
    return {};
  }
}

/** Waiting records fetched with strict server-side limit() and range(offset, offset + limit - 1). */
export async function fetchPendingFieldEvents(limit = 100, offset = 0): Promise<FieldEvent[] | null> {
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const safeOffset = Math.max(0, offset);
  try {
    const all: any[] = [];
    let curOffset = safeOffset;
    while (true) {
      const { data, error } = await supabase
        .from('field_events')
        .select('*')
        .eq('status', 'PENDING')
        .order('received_at', { ascending: false })
        .limit(safeLimit)
        .range(curOffset, curOffset + safeLimit - 1);
      if (error) throw error;
      const rows = data || [];
      all.push(...rows);
      if (rows.length < safeLimit || all.length >= 2000) break;
      curOffset += safeLimit;
    }
    return all.map(mapFieldEvent);
  } catch (err) {
    await reportCaughtError('fetchPendingFieldEvents', err, { showPopup: false });
    return null;
  }
}

export async function fetchReviewedFieldEvents(limit = 100, offset = 0): Promise<FieldEvent[] | null> {
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const safeOffset = Math.max(0, offset);
  try {
    const all: any[] = [];
    let curOffset = safeOffset;
    while (true) {
      const { data, error } = await supabase
        .from('field_events')
        .select('*')
        .neq('status', 'PENDING')
        .order('received_at', { ascending: false })
        .limit(safeLimit)
        .range(curOffset, curOffset + safeLimit - 1);
      if (error) throw error;
      const rows = data || [];
      all.push(...rows);
      if (rows.length < safeLimit || all.length >= 1000) break;
      curOffset += safeLimit;
    }
    return all.map(mapFieldEvent);
  } catch (err) {
    await reportCaughtError('fetchReviewedFieldEvents', err, { showPopup: false });
    return null;
  }
}



export async function fetchFieldEventsPageFromSupabase(params: {
  page?: number;
  pageSize?: number;
  status?: string;
  deviceType?: string;
  search?: string;
}): Promise<PaginatedResult<FieldEvent> | null> {
  if (!isSupabaseConfigured) return null;
  const pageSize = params.pageSize === 100 ? 100 : 50;
  const page = Math.max(1, params.page || 1);
  const offset = (page - 1) * pageSize;

  const res = await fetchPaginatedRows('field_events', 'received_at', {
    limit: pageSize,
    offset,
    ascending: false,
    filters: (q) => {
      let query = q;
      if (params.status && params.status !== 'ALL') query = query.eq('status', params.status);
      if (params.deviceType && params.deviceType !== 'ALL') query = query.eq('device_type', params.deviceType);
      const term = (params.search || '').trim().replace(/[,()]/g, '');
      if (term) {
        query = query.or(
          `serial.ilike.%${term}%,old_serial.ilike.%${term}%,source_record_id.ilike.%${term}%,mid.ilike.%${term}%,tid.ilike.%${term}%,outlet_name.ilike.%${term}%,terminal_name.ilike.%${term}%,staff_name.ilike.%${term}%,staff_id.ilike.%${term}%`
        );
      }
      return query;
    },
  });

  if (!res) return null;
  return {
    rows: res.rows.map(mapFieldEvent),
    total: res.count,
    page,
    pageSize,
  };
}

export async function countPendingFieldEvents(): Promise<number | null> {
  try {
    const { count, error } = await supabase
      .from('field_events')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'PENDING');
    if (error) throw error;
    return count || 0;
  } catch (err) {
    await reportCaughtError('countPendingFieldEvents', err, { showPopup: false });
    return null;
  }
}

export function subscribeToFieldEvents(onChange: (e: FieldEvent) => void): () => void {
  if (!isSupabaseConfigured) return () => {};
  const channel = supabase
    .channel(channelName('field_events_feed'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'field_events' }, (payload) => {
      if (payload.new && (payload.new as any).id) onChange(mapFieldEvent(payload.new));
    })
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

export async function recheckFieldEvent(id: number, branchId?: string): Promise<FieldIssue[]> {
  try {
    const { data, error } = await supabase.rpc('field_recheck', { p_id: id, p_branch: branchId || null });
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  } catch (err) {
    await reportCaughtError('recheckFieldEvent', err, { target: String(id) });
    throw new Error(err instanceof Error ? err.message : String((err as any)?.message || err));
  }
}

export async function approveFieldEvent(
  id: number,
  note: string,
  opt: { branch_id?: string; return_stage?: string; acknowledge?: boolean }
): Promise<any> {
  try {
    const { data, error } = await supabase.rpc('field_approve', { p_id: id, p_note: note || null, p_opt: opt });
    if (error) throw error;
    return data;
  } catch (err) {
    await reportCaughtError('approveFieldEvent', err, { target: String(id) });
    throw new Error(err instanceof Error ? err.message : String((err as any)?.message || err));
  }
}

export async function rejectFieldEvent(id: number, note: string): Promise<void> {
  try {
    const { error } = await supabase.rpc('field_reject', { p_id: id, p_note: note });
    if (error) throw error;
  } catch (err) {
    await reportCaughtError('rejectFieldEvent', err, { target: String(id) });
    throw new Error(err instanceof Error ? err.message : String((err as any)?.message || err));
  }
}

export interface StaffAccount {
  userId: string;
  empId: string;
  name: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'BRANCH';
  branchId: string;
  position: string | null;
  contact: string | null;
  telegramUsername?: string | null;
  location?: string | null;
  active: boolean;
  mustChangePassword: boolean;
  updatedAt: string;
}

const mapStaff = (r: any): StaffAccount => ({
  userId: r.user_id,
  empId: r.emp_id,
  name: r.name,
  role: r.role,
  branchId: r.branch_id,
  position: r.position,
  contact: r.contact,
  telegramUsername: r.telegram_username || null,
  location: r.location || 'Phnom Penh',
  active: !!r.active,
  mustChangePassword: !!r.must_change_password,
  updatedAt: r.updated_at,
});

export async function fetchStaffAccounts(limit = 100, offset = 0): Promise<StaffAccount[] | null> {
  const safeLimit = Math.max(1, Math.min(limit, 100));
  try {
    const all: any[] = [];
    let curOffset = Math.max(0, offset);
    while (true) {
      const { data, error } = await supabase
        .from('staff_profiles')
        .select('*')
        .order('emp_id')
        .limit(safeLimit)
        .range(curOffset, curOffset + safeLimit - 1);
      if (error) throw error;
      const rows = data || [];
      all.push(...rows);
      if (rows.length < safeLimit || all.length >= 2000) break;
      curOffset += safeLimit;
    }
    return all.map(mapStaff);
  } catch (err) {
    await reportCaughtError('fetchStaffAccounts', err, { showPopup: false });
    return null;
  }
}



export async function fetchStaffAccountsPageFromSupabase(params: {
  page?: number;
  pageSize?: number;
  search?: string;
}): Promise<PaginatedResult<StaffAccount> | null> {
  if (!isSupabaseConfigured) return null;
  const pageSize = params.pageSize === 100 ? 100 : 50;
  const page = Math.max(1, params.page || 1);
  const offset = (page - 1) * pageSize;

  const res = await fetchPaginatedRows('staff_profiles', 'emp_id', {
    limit: pageSize,
    offset,
    ascending: true,
    filters: (q) => {
      let query = q;
      const term = (params.search || '').trim().replace(/[,()]/g, '');
      if (term) {
        query = query.or(`emp_id.ilike.%${term}%,name.ilike.%${term}%,branch_id.ilike.%${term}%,role.ilike.%${term}%`);
      }
      return query;
    },
  });

  if (!res) return null;
  return {
    rows: res.rows.map(mapStaff),
    total: res.count,
    page,
    pageSize,
  };
}

export async function saveStaffAccount(p: {
  emp_id: string;
  name: string;
  role: string;
  branch_id: string;
  position?: string;
  contact?: string;
  telegram_username?: string;
  location?: string;
  active: boolean;
  password?: string;
}): Promise<StaffAccount> {
  try {
    const body: any = Object.assign({}, p);
    if (!body.password) delete body.password;
    const { data, error } = await supabase.rpc('admin_save_staff', { p: body });
    if (error) throw error;
    return mapStaff(data);
  } catch (err) {
    await reportCaughtError('saveStaffAccount', err, { target: p.emp_id });
    throw new Error(err instanceof Error ? err.message : String((err as any)?.message || err));
  }
}

export async function fetchBranchesFromSupabase(
  limit = 100,
  offset = 0
): Promise<{ id: string; code: string; name: string; region: string }[] | null> {
  if (!isSupabaseConfigured) return null;
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const safeOffset = Math.max(0, offset);
  try {
    const { data, error } = await supabase
      .from('branches')
      .select('id,code,name,region,active')
      .order('id')
      .limit(safeLimit)
      .range(safeOffset, safeOffset + safeLimit - 1);
    if (error) throw error;
    return (data || [])
      .filter((b: any) => b.active !== false)
      .map((b: any) => ({
        id: String(b.id),
        code: String(b.code || b.id),
        name: String(b.name || ''),
        region: String(b.region || ''),
      }));
  } catch (err) {
    await reportCaughtError('fetchBranchesFromSupabase', err, { showPopup: false });
    return null;
  }
}

export async function saveBranchOnServer(b: { id: string; name: string }): Promise<string> {
  if (!isSupabaseConfigured) return '';
  try {
    const { error } = await supabase
      .from('branches')
      .upsert({ id: b.id, code: b.id, name: b.name, active: true, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) throw error;
    return '';
  } catch (err) {
    await reportCaughtError('saveBranchOnServer', err, { target: b.id });
    return err instanceof Error ? err.message : String((err as any)?.message || 'Network error');
  }
}

export async function traceOnServer(
  q: string
): Promise<{ events: FieldEvent[]; audit: ServerAuditEntry[]; ok: boolean }> {
  const term = q.trim().replace(/[^A-Za-z0-9\-_ ]/g, '');
  if (!isSupabaseConfigured || term.length < 4) return { events: [], audit: [], ok: true };
  try {
    const [ev, au] = await Promise.all([
      supabase
        .from('field_events')
        .select('*')
        .or(
          `serial.ilike.%${term}%,old_serial.ilike.%${term}%,mid.ilike.%${term}%,tid.ilike.%${term}%,old_battery.ilike.%${term}%,new_battery.ilike.%${term}%`
        )
        .order('received_at', { ascending: false })
        .limit(50)
        .range(0, 49),
      supabase
        .from('audit_logs')
        .select('*')
        .or(`detail.ilike.%${term}%,target.ilike.%${term}%`)
        .order('created_at', { ascending: false })
        .limit(50)
        .range(0, 49),
    ]);
    if (ev.error) throw ev.error;
    if (au.error) throw au.error;
    return {
      ok: true,
      events: (ev.data || []).map(mapFieldEvent),
      audit: (au.data || []).map((r: any) => ({
        id: r.id,
        title: r.title,
        detail: r.detail,
        role: r.role,
        branchId: r.branch_id,
        createdAt: r.created_at,
        actorEmp: r.actor_emp,
        actorName: r.actor_name,
        action: r.action,
        target: r.target,
      })),
    };
  } catch (err) {
    await reportCaughtError('traceOnServer', err, { target: term, showPopup: false });
    return { events: [], audit: [], ok: false };
  }
}

/**
 * Policy #28: Allows Super Admin and Admin to rename/correct a device serial number on Supabase
 * in case it was uploaded wrong. Inserts the new serial row (or updates primary key) and removes the old serial row.
 */
export async function renameDeviceSerialOnServer(
  oldSerial: string,
  newSerial: string,
  updatedDevice?: Device
): Promise<string> {
  if (!isSupabaseConfigured) return '';
  const cleanOld = oldSerial.trim();
  const cleanNew = newSerial.trim().toUpperCase();
  if (!cleanOld || !cleanNew || cleanOld === cleanNew) return '';

  try {
    let devToInsert = updatedDevice;
    if (!devToInsert) {
      const { data: oldRow, error: fetchErr } = await supabase
        .from('devices')
        .select('*')
        .eq('serial', cleanOld)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!oldRow) {
        return `Original serial "${cleanOld}" not found in database.`;
      }
      devToInsert = mapRowToDevice(oldRow);
    }
    const newRow = mapDeviceToRow({ ...devToInsert, serial: cleanNew, rowVersion: undefined });
    delete newRow.row_version;

    // 1. Check if newSerial already exists
    const { data: existing } = await supabase
      .from('devices')
      .select('serial')
      .eq('serial', cleanNew)
      .maybeSingle();
    if (existing && existing.serial) {
      return `Serial "${cleanNew}" already exists in the database.`;
    }

    // 2. Insert the corrected serial row
    const { error: insertErr } = await supabase.from('devices').insert(newRow);
    if (insertErr) {
      throw insertErr;
    }

    // 3. Delete the old mistyped serial row
    const { error: deleteErr } = await supabase.from('devices').delete().eq('serial', cleanOld);
    if (deleteErr) {
      throw deleteErr;
    }
    return '';
  } catch (err) {
    await reportCaughtError('renameDeviceSerialOnServer', err, { target: `${cleanOld} -> ${cleanNew}` });
    return err instanceof Error ? err.message : String((err as any)?.message || 'Failed to rename serial');
  }
}

/**
 * Policy #25: Measures live round-trip connection ping (ms) with Supabase PostgREST using a lightweight head query,
 * warming the HTTP/2 / TLS connection pool for faster subsequent table queries.
 */
export async function measureSupabasePingMs(): Promise<number | null> {
  if (!isSupabaseConfigured) return null;
  const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    const { error } = await supabase
      .from('branches')
      .select('id', { head: true, count: 'estimated' })
      .limit(1);
    if (error) return null;
    const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return Math.max(1, Math.round(end - start));
  } catch {
    return null;
  }
}

/**
 * Policy #32: Live System Presence — see who is currently online and using the system in real time.
 */
export interface OnlineOperatorPresence {
  id?: string;
  uid: string;
  empId: string;
  name: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'BRANCH' | string;
  branchId: string;
  branchName?: string;
  activeTab?: string;
  onlineAt?: string;
  location?: string;
}

export function subscribeToOnlinePresence(
  currentOperator: OnlineOperatorPresence,
  onPresenceSync: (operators: OnlineOperatorPresence[]) => void
): { updateTab: (tab: string) => void; unsubscribe: () => void } {
  if (!isSupabaseConfigured) {
    onPresenceSync([currentOperator]);
    return {
      updateTab: (tab: string) => {
        onPresenceSync([{ ...currentOperator, activeTab: tab }]);
      },
      unsubscribe: () => {},
    };
  }

  let latestPayload: OnlineOperatorPresence = { ...currentOperator };
  const channel = supabase.channel('online_operators_presence', {
    config: {
      presence: {
        key: currentOperator.empId || currentOperator.uid,
      },
    },
  });

  const emitPresenceList = () => {
    try {
      const state = channel.presenceState<OnlineOperatorPresence>();
      const byEmp = new Map<string, OnlineOperatorPresence>();
      Object.values(state).forEach((entries) => {
        if (Array.isArray(entries)) {
          entries.forEach((entry) => {
            if (entry && (entry.empId || entry.uid)) {
              byEmp.set(entry.empId || entry.uid, entry);
            }
          });
        }
      });
      if (!byEmp.has(latestPayload.empId || latestPayload.uid)) {
        byEmp.set(latestPayload.empId || latestPayload.uid, latestPayload);
      }
      onPresenceSync(Array.from(byEmp.values()));
    } catch {
      onPresenceSync([latestPayload]);
    }
  };

  channel
    .on('presence', { event: 'sync' }, emitPresenceList)
    .on('presence', { event: 'join' }, emitPresenceList)
    .on('presence', { event: 'leave' }, emitPresenceList)
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        try {
          await channel.track(latestPayload);
          emitPresenceList();
        } catch {
          onPresenceSync([latestPayload]);
        }
      }
    });

  return {
    updateTab: (tab: string) => {
      latestPayload = { ...latestPayload, activeTab: tab };
      void channel.track(latestPayload).catch(() => {});
    },
    unsubscribe: () => {
      supabase.removeChannel(channel);
    },
  };
}

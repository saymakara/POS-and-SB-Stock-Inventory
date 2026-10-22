import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Device, Requisition, HistoricalMerchantRecord, LifecycleStage, Branch, ArrangedDeviceItem } from '../types';
import { normalizeMid } from '../utils/display';

/**
 * Maps Supabase snake_case / postgres schema to application Device type
 */
function mapRowToDevice(row: any): Device {
  const stage = (row.stage || 'HQ_STOCK') as LifecycleStage;
  // (22 Oct 2026) every custom value as text: approved phone records store GPS as numbers, which broke search
  const cf: Record<string, string> = {};
  Object.entries((row.custom_fields && typeof row.custom_fields === 'object') ? row.custom_fields : {}).forEach(([k, v]) => {
    if (v !== null && v !== undefined) cf[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
  });
  return {
    // (21 Oct 2026) officers and dates written by the database (approved phone app records) live in custom_fields
    installedByStaff: cf.installedByStaff || undefined,
    replacedByStaff: cf.replacedByStaff || undefined,
    returnedByStaff: cf.returnedByStaff || undefined,
    returnedDate: cf.returnedDate || undefined,
    replacementDate: cf.replacementDate || undefined,
    replacedFromSerial: cf.replacedFromSerial || undefined,
    serial: row.serial,
    batterySerial: row.battery_serial || undefined,
    batteryInstalledDate: row.battery_installed_date || undefined,
    type: row.type || 'POS Terminal',
    model: row.model || '',
    stockInDate: row.stock_in_date || '',
    branchId: row.branch_id || '100',
    branchName: row.branch_name || (row.branch_id === '100' || !row.branch_id ? 'Head Office' : `Branch Code ${row.branch_id}`),
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
    custom_fields: Object.assign({}, dev.customFields || {}, Object.fromEntries(
      (['installedByStaff', 'replacedByStaff', 'returnedByStaff', 'returnedDate', 'replacementDate', 'replacedFromSerial'] as const)
        .filter((k) => dev[k]).map((k) => [k, String(dev[k])]))),
    return_reason: dev.returnReason || null,
    deployment_status: dev.deploymentStatus || null,
    stock_status: dev.stockStatus || null,
    hours_in_stage: dev.hoursInStage || 0,
    integrity_hash: dev.integrityHash || null,
    // updated_at and the version are set by the database; the version sent back is the one this copy was read at
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

/** Reads a whole table page by page in a stable order (PostgREST returns at most 1000 rows per call). */
async function fetchAllRows(table: string, orderCol: string, pageSize = 1000, maxTotal = 500000): Promise<any[] | null> {
  // (22 Oct 2026) the first page also returns the total; the other pages are then read at the same time (faster start)
  const page = (from: number, withCount: boolean) =>
    supabase.from(table).select('*', withCount ? { count: 'exact' } : undefined).order(orderCol, { ascending: true }).range(from, from + pageSize - 1);
  const first = await page(0, true);
  if (first.error) {
    console.warn(`[Supabase] Error reading ${table}:`, first.error.message);
    return null;                                                       // never show a part of a list as if it were all of it
  }
  const rows: any[] = [...(first.data || [])];
  if (rows.length < pageSize) return rows;
  if (first.count == null) {                                           // no total given: read on page by page
    for (let from = pageSize; from < maxTotal; from += pageSize) {
      const r = await page(from, false);
      if (r.error) { console.warn(`[Supabase] Error reading ${table}:`, r.error.message); return null; }
      rows.push(...(r.data || []));
      if (!r.data || r.data.length < pageSize) break;
    }
    return rows;
  }
  const total = Math.min(first.count, maxTotal);
  if (total <= rows.length) return rows;
  const starts: number[] = [];
  for (let from = pageSize; from < total; from += pageSize) starts.push(from);
  for (let i = 0; i < starts.length; i += 4) {                         // at most 4 pages at a time
    const res = await Promise.all(starts.slice(i, i + 4).map((f) => page(f, false)));
    for (const r of res) {
      if (r.error) { console.warn(`[Supabase] Error reading ${table}:`, r.error.message); return null; }
      rows.push(...(r.data || []));
    }
  }
  // a row added while reading can shift a page: keep each key once
  const seen = new Set<string>();
  return rows.filter((r) => { const k = String(r[orderCol]); if (seen.has(k)) return false; seen.add(k); return true; });
}

// -----------------------------------------------------------------------------
// BRANCHES API
// -----------------------------------------------------------------------------

export async function bulkUpsertBranchesToSupabase(branches: Branch[]): Promise<boolean> {
  if (!isSupabaseConfigured || branches.length === 0) return false;
  try {
    const rows = branches.map((b) => ({
      id: b.id,
      code: b.code || b.id,
      name: b.name,
      staff: b.staff || [],
      active: true,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from('branches').upsert(rows, { onConflict: 'id' });
    if (error) {
      console.warn('[Supabase] Error bulk upserting branches:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Supabase] Exception bulk upserting branches:', err);
    return false;
  }
}

// -----------------------------------------------------------------------------
// DEVICES API
// -----------------------------------------------------------------------------

export async function fetchDevicesFromSupabase(): Promise<Device[] | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const rows = await fetchAllRows('devices', 'serial');             // ordered by the key: no row is skipped or read twice
    return rows ? rows.map(mapRowToDevice) : null;
  } catch (err) {
    console.warn('[Supabase] Exception fetching devices:', err);
    return null;
  }
}

export async function upsertDeviceToSupabase(device: Device): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  try {
    const row = mapDeviceToRow(device);
    const { error } = await supabase
      .from('devices')
      .upsert(row, { onConflict: 'serial' });

    if (error) {
      console.warn('[Supabase] Error upserting device:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Supabase] Exception upserting device:', err);
    return false;
  }
}

export async function bulkUpsertDevicesToSupabase(
  devices: Device[],
  onProgress?: (processed: number, total: number) => void
): Promise<boolean> {
  if (!isSupabaseConfigured || devices.length === 0) return false;

  try {
    // Process in batches of 500 rows to prevent HTTP request payload limit timeouts on 500K datasets
    const BATCH_SIZE = 500;
    const total = devices.length;

    for (let i = 0; i < total; i += BATCH_SIZE) {
      const slice = devices.slice(i, i + BATCH_SIZE);
      const rows = slice.map(mapDeviceToRow);
      const { error } = await supabase
        .from('devices')
        .upsert(rows, { onConflict: 'serial' });

      if (error) {
        console.warn(`[Supabase] Error bulk upserting batch ${i}-${i + slice.length}:`, error.message);
        return false;
      }
      onProgress?.(Math.min(i + BATCH_SIZE, total), total);
    }

    return true;
  } catch (err) {
    console.warn('[Supabase] Exception bulk upserting devices:', err);
    return false;
  }
}

// -----------------------------------------------------------------------------
// REQUISITIONS API
// -----------------------------------------------------------------------------

export async function fetchRequisitionsFromSupabase(): Promise<Requisition[] | null> {
  if (!isSupabaseConfigured) return null;

  try {
    const rows = await fetchAllRows('requisitions', 'req_id');
    if (!rows) return null;
    return rows.map(mapRowToRequisition)
      .sort((x, y) => String(y.date).localeCompare(String(x.date)) || y.reqId.localeCompare(x.reqId));
  } catch (err) {
    console.warn('[Supabase] Exception fetching requisitions:', err);
    return null;
  }
}

export async function upsertRequisitionToSupabase(req: Requisition): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  try {
    const row = mapRequisitionToRow(req);
    const { error } = await supabase
      .from('requisitions')
      .upsert(row, { onConflict: 'req_id' });

    if (error) {
      console.warn('[Supabase] Error upserting requisition:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Supabase] Exception upserting requisition:', err);
    return false;
  }
}

// -----------------------------------------------------------------------------
// HISTORICAL MERCHANTS API
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

export async function fetchHistoricalMerchantsFromSupabase(): Promise<HistoricalMerchantRecord[] | null> {
  if (!isSupabaseConfigured) return null;

  try {
    const data = await fetchAllRows('historical_merchants', 'record_id');
    if (!data) return null;
    data.sort((x: any, y: any) => String(y.returned_date || '').localeCompare(String(x.returned_date || '')));

    return data.map(mapRowToHistory);
  } catch (err) {
    console.warn('[Supabase] Exception fetching historical merchants:', err);
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

    // a new record is inserted (an existing record is never overwritten from a browser copy)
    const { error } = await supabase.from('historical_merchants').insert(row);

    if (error) {
      console.warn('[Supabase] Error inserting historical merchant:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Supabase] Exception inserting historical merchant:', err);
    return false;
  }
}

// -----------------------------------------------------------------------------
// REALTIME SUBSCRIPTION
// -----------------------------------------------------------------------------

let channelSeq = 0;
/** Each subscription gets its own channel name: two screens on one name would make the client refuse the second. */
const channelName = (base: string) => `${base}_${Date.now().toString(36)}_${++channelSeq}`;

export function subscribeToRealtimeChanges(
  onDeviceChange: (updatedDevice: Device) => void,
  onRequisitionChange?: (updatedReq: Requisition) => void,
  extra?: {
    onDeviceDelete?: (serial: string) => void;
    onRequisitionDelete?: (reqId: string) => void;
    /** A merchant-history record added on the server (e.g. by approving a phone app record). */
    onHistoryInsert?: (rec: HistoricalMerchantRecord) => void;
    /** Called when the live feed comes back after a drop: changes made meanwhile were missed, so reload. */
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
      if (payload.new && (payload.new as any).req_id && onRequisitionChange) onRequisitionChange(mapRowToRequisition(payload.new));
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'historical_merchants' }, (payload) => {
      if (payload.new && (payload.new as any).record_id) extra?.onHistoryInsert?.(mapRowToHistory(payload.new));
    })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') dropped = true;
      else if (status === 'SUBSCRIBED' && dropped) { dropped = false; extra?.onReconnect?.(); }
    });

  return () => {
    supabase.removeChannel(channel);
  };
}

// -----------------------------------------------------------------------------
// (21 Oct 2026) SAVING WITH A CLEAR ANSWER, REVIEW QUEUE, STAFF ACCOUNTS
// -----------------------------------------------------------------------------

/** Database refusals in plain words. */
function friendlyDbError(msg: string, serial?: string): string {
  if (/mid_digits/.test(msg)) return `the MID${serial ? ' of ' + serial : ''} must be digits only (15 digits; a number shortened by Excel such as "1.00001E+14" cannot be saved)`;
  return msg;
}

/** The outcome of a save: '' when saved, otherwise the reason; `versions` holds the new server version of each saved row. */
export interface SaveResult { error: string; stale: boolean; versions: Map<string, number> }

/**
 * Saves devices (22 Oct 2026). A unit read from the server carries its version and is updated only if nobody changed it
 * since (the database refuses a stale copy). A unit without a version is new and is inserted – it never overwrites a
 * unit that already exists.
 */
export async function saveDevicesStrict(devices: Device[]): Promise<SaveResult> {
  const versions = new Map<string, number>();
  if (!isSupabaseConfigured || devices.length === 0) return { error: '', stale: false, versions };
  const note = (data: any[] | null) => (data || []).forEach((r: any) => versions.set(r.serial, Number(r.row_version)));
  try {
    const fresh = devices.filter((d) => !d.rowVersion);
    const known = devices.filter((d) => d.rowVersion);
    for (let i = 0; i < fresh.length; i += 500) {
      const { data, error } = await supabase.from('devices').insert(fresh.slice(i, i + 500).map(mapDeviceToRow)).select('serial,row_version');
      if (error) {
        const dup = /duplicate key|23505/i.test(error.message + (error as any).code);
        return { error: dup ? 'a unit with this serial already exists in the inventory' : friendlyDbError(error.message), stale: false, versions };
      }
      note(data);
    }
    // one row per call (a few at a time): a refused stale row names itself, and the other rows are kept
    let first: { error: string; stale: boolean } | null = null;
    for (let i = 0; i < known.length && !first; i += 6) {
      await Promise.all(known.slice(i, i + 6).map(async (d) => {
        const { data, error } = await supabase.from('devices').update(mapDeviceToRow(d)).eq('serial', d.serial).select('serial,row_version');
        if (error) {
          const stale = /STALE_ROW|PT409/.test(error.message + (error as any).code);
          first = first || { error: stale ? `${d.serial} was changed by someone else just now` : friendlyDbError(error.message, d.serial), stale };
        } else if (!data || data.length === 0) {
          first = first || { error: `you do not have access to change ${d.serial}`, stale: false };
        } else note(data);
      }));
    }
    return first ? { ...(first as { error: string; stale: boolean }), versions } : { error: '', stale: false, versions };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network error', stale: false, versions };
  }
}

/** Saves a new request (status, units and returns change only through the functions below). */
export async function saveRequisitionStrict(req: Requisition, isNew: boolean): Promise<string> {
  if (!isSupabaseConfigured) return '';
  try {
    const row = mapRequisitionToRow(req);
    const { error } = isNew
      ? await supabase.from('requisitions').insert(row)
      : await supabase.from('requisitions').update({ reason: row.reason, staff: row.staff, pos_qty: row.pos_qty, sb_qty: row.sb_qty }).eq('req_id', req.reqId);
    return error ? error.message : '';
  } catch (err) {
    return err instanceof Error ? err.message : 'Network error';
  }
}

/** A super admin deletes units for good (the database allows this for the super admin only). */
export async function deleteDevicesOnServer(serials: string[]): Promise<string> {
  if (!isSupabaseConfigured || !serials.length) return '';
  try {
    for (let i = 0; i < serials.length; i += 200) {
      const { error } = await supabase.from('devices').delete().in('serial', serials.slice(i, i + 200));
      if (error) return error.message;
    }
    return '';
  } catch (err) {
    return err instanceof Error ? err.message : 'Network error';
  }
}

/** Super Admin: delete every Merchant History record in the database. Returns '' on success or the reason. */
export async function deleteAllHistoricalMerchantsOnServer(): Promise<string> {
  if (!isSupabaseConfigured) return '';
  try {
    const { error } = await supabase.from('historical_merchants').delete().not('record_id', 'is', null);
    return error ? error.message : '';
  } catch (err) {
    return err instanceof Error ? err.message : 'Network error';
  }
}

/** HQ dispatches units for a pending stock request; the database checks every unit and keeps them allocated in HQ stock. */
export async function dispatchRequisitionOnServer(reqId: string, serials: string[], note?: string): Promise<ArrangedDeviceItem[]> {
  const { data, error } = await supabase.rpc('admin_dispatch_requisition', { p_req_id: reqId, p_serials: serials, p_note: note || null });
  if (error) throw new Error(error.message);
  return (data && data.arranged) || [];
}

/** HQ approves a branch's stock return; the database moves only units still at that branch. */
export async function receiveReturnOnServer(reqId: string, note?: string): Promise<{ moved: string[]; skipped: string[] }> {
  const { data, error } = await supabase.rpc('admin_receive_return', { p_req_id: reqId, p_note: note || null });
  if (error) throw new Error(error.message);
  return { moved: (data && data.moved) || [], skipped: (data && data.skipped) || [] };
}

/** A branch confirms receipt of a dispatched request (the database moves the units). */
export async function confirmReceiptOnServer(reqId: string): Promise<{ moved: string[]; skipped: string[] }> {
  const { data, error } = await supabase.rpc('branch_confirm_receipt', { p_req_id: reqId });
  if (error) throw new Error(error.message);
  return { moved: (data && data.moved) || [], skipped: (data && data.skipped) || [] };
}

/** An entry in the server's audit log (who and when are stamped by the database). */
export async function writeAuditLog(title: string, detail: string, action?: string, target?: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    await supabase.from('audit_logs').insert({ title: title.slice(0, 160), detail, action: action || null, target: target || null });
  } catch {
    /* the local log keeps it */
  }
}

export interface ServerAuditEntry {
  id: number; title: string; detail: string; role: string | null; branchId: string | null; createdAt: string;
  actorEmp: string | null; actorName: string | null; action: string | null; target: string | null;
}
export async function fetchAuditLogs(limit = 1000): Promise<ServerAuditEntry[] | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) return null;
  return (data || []).map((r: any) => ({ id: r.id, title: r.title, detail: r.detail, role: r.role, branchId: r.branch_id, createdAt: r.created_at,
    actorEmp: r.actor_emp, actorName: r.actor_name, action: r.action, target: r.target }));
}

export type FieldEventStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED' | 'CANCELLED';
export interface FieldIssue { code: string; level: 'warn' | 'block'; text: string }
export interface FieldEvent {
  id: number; sourceRecordId: string; unitNo: number; revision: number;
  kind: 'INSTALL' | 'REPLACE' | 'BATTERY' | 'SB_MAINT' | 'SB_RETURN'; deviceType: 'POS Terminal' | 'Sound Box';
  serial: string; oldSerial: string | null; oldBattery: string | null; newBattery: string | null; mid: string | null; tid: string | null;
  terminalName: string | null; outletName: string | null; branchText: string | null; branchId: string | null; staffId: string | null; staffName: string | null;
  recordedAt: string; latitude: number | null; longitude: number | null; remarks: string | null; payload: any; issues: FieldIssue[];
  status: FieldEventStatus; reviewedByName: string | null; reviewedAt: string | null; reviewNote: string | null; applied: any; receivedAt: string;
}
function mapFieldEvent(r: any): FieldEvent {
  return { id: r.id, sourceRecordId: r.source_record_id, unitNo: r.unit_no, revision: r.revision, kind: r.kind, deviceType: r.device_type,
    serial: r.serial, oldSerial: r.old_serial, oldBattery: r.old_battery, newBattery: r.new_battery, mid: r.mid, tid: r.tid,
    terminalName: r.terminal_name, outletName: r.outlet_name, branchText: r.branch_text, branchId: r.branch_id, staffId: r.staff_id, staffName: r.staff_name,
    recordedAt: r.recorded_at, latitude: r.latitude, longitude: r.longitude, remarks: r.remarks, payload: r.payload || {}, issues: Array.isArray(r.issues) ? r.issues : [],
    status: r.status, reviewedByName: r.reviewed_by_name, reviewedAt: r.reviewed_at, reviewNote: r.review_note, applied: r.applied, receivedAt: r.received_at };
}
export async function fetchFieldEvents(limit = 500): Promise<FieldEvent[] | null> {
  // every pending record is always loaded (however many), plus the latest reviewed ones
  const [pend, done] = await Promise.all([
    supabase.from('field_events').select('*').eq('status', 'PENDING').order('received_at', { ascending: false }).limit(5000),
    supabase.from('field_events').select('*').neq('status', 'PENDING').order('received_at', { ascending: false }).limit(limit),
  ]);
  if (pend.error || done.error) return null;
  return [...(pend.data || []), ...(done.data || [])].map(mapFieldEvent);
}
/** branch id -> region ('Phnom Penh' or a province), used to show Phnom Penh or regional records in Phone App Review. */
export async function fetchBranchRegions(): Promise<Record<string, string>> {
  const { data, error } = await supabase.from('branches').select('id,region');
  if (error) return {};
  const m: Record<string, string> = {};
  (data || []).forEach((b: any) => { m[String(b.id)] = String(b.region || ''); });
  return m;
}
/** Waiting records only: small and fast, so the review list can paint first. */
export async function fetchPendingFieldEvents(): Promise<FieldEvent[] | null> {
  const { data, error } = await supabase.from('field_events').select('*').eq('status', 'PENDING').order('received_at', { ascending: true }).limit(5000);
  return error ? null : (data || []).map(mapFieldEvent);
}
/** Already reviewed records (approved / rejected / withdrawn), loaded in the background after the waiting ones. */
export async function fetchReviewedFieldEvents(limit = 600): Promise<FieldEvent[] | null> {
  const { data, error } = await supabase.from('field_events').select('*').neq('status', 'PENDING').order('received_at', { ascending: false }).limit(limit);
  return error ? null : (data || []).map(mapFieldEvent);
}
/** The number of records waiting for review (counted by the database, not limited by a page). */
export async function countPendingFieldEvents(): Promise<number | null> {
  const { count, error } = await supabase.from('field_events').select('id', { count: 'exact', head: true }).eq('status', 'PENDING');
  return error ? null : count || 0;
}
export function subscribeToFieldEvents(onChange: (e: FieldEvent) => void): () => void {
  if (!isSupabaseConfigured) return () => {};
  const channel = supabase.channel(channelName('field_events_feed'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'field_events' }, (payload) => {
      if (payload.new && (payload.new as any).id) onChange(mapFieldEvent(payload.new));
    })
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
export async function recheckFieldEvent(id: number, branchId?: string): Promise<FieldIssue[]> {
  const { data, error } = await supabase.rpc('field_recheck', { p_id: id, p_branch: branchId || null });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}
export async function approveFieldEvent(id: number, note: string, opt: { branch_id?: string; return_stage?: string; acknowledge?: boolean }): Promise<any> {
  const { data, error } = await supabase.rpc('field_approve', { p_id: id, p_note: note || null, p_opt: opt });
  if (error) throw new Error(error.message);
  return data;
}
export async function rejectFieldEvent(id: number, note: string): Promise<void> {
  const { error } = await supabase.rpc('field_reject', { p_id: id, p_note: note });
  if (error) throw new Error(error.message);
}

export interface StaffAccount {
  userId: string; empId: string; name: string; role: 'SUPER_ADMIN' | 'ADMIN' | 'BRANCH'; branchId: string;
  position: string | null; contact: string | null; active: boolean; mustChangePassword: boolean; updatedAt: string;
}
const mapStaff = (r: any): StaffAccount => ({ userId: r.user_id, empId: r.emp_id, name: r.name, role: r.role, branchId: r.branch_id, position: r.position,
  contact: r.contact, active: !!r.active, mustChangePassword: !!r.must_change_password, updatedAt: r.updated_at });
export async function fetchStaffAccounts(): Promise<StaffAccount[] | null> {
  const { data, error } = await supabase.from('staff_profiles').select('*').order('emp_id');
  if (error) return null;
  return (data || []).map(mapStaff);
}
export async function saveStaffAccount(p: { emp_id: string; name: string; role: string; branch_id: string; position?: string; contact?: string; active: boolean; password?: string }): Promise<StaffAccount> {
  const body: any = Object.assign({}, p); if (!body.password) delete body.password;
  const { data, error } = await supabase.rpc('admin_save_staff', { p: body });
  if (error) throw new Error(error.message);
  return mapStaff(data);
}
export async function fetchBranchesFromSupabase(): Promise<{ id: string; code: string; name: string }[] | null> {
  const { data, error } = await supabase.from('branches').select('id,code,name').order('id');
  if (error) return null;
  return (data || []).map((b: any) => ({ id: String(b.id), code: String(b.code || b.id), name: b.name }));
}

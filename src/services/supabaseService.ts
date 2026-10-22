import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Device, Requisition, HistoricalMerchantRecord, LifecycleStage, Branch } from '../types';

/**
 * Maps Supabase snake_case / postgres schema to application Device type
 */
function mapRowToDevice(row: any): Device {
  const stage = (row.stage || 'HQ_STOCK') as LifecycleStage;
  const cf = (row.custom_fields || {}) as Record<string, string>;
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
    model: row.model || 'Wizar POS Q2 Pro',
    stockInDate: row.stock_in_date || '',
    branchId: row.branch_id || '100',
    branchName: row.branch_name || 'Head Office',
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
    mid: row.mid || '',
    tid: row.tid || '',
    merchantName: row.merchant_name || '',
    merchantPhone: row.merchant_phone || '',
    location: row.location || 'Phnom Penh',
    address: row.address || '',
    deployedDate: row.deployed_date || '',
    returnReason: row.return_reason || '',
    redeployCount: row.redeploy_count || 0,
    hoursInStage: row.hours_in_stage || 12,
    updatedAt: row.updated_at || new Date().toISOString(),
    note: row.note || '',
    history: Array.isArray(row.history) ? row.history : [],
    archived: Boolean(row.archived),
    integrityHash: row.integrity_hash || `SHA256-${row.serial}`,
    customFields: row.custom_fields || {},
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
    mid: dev.mid || null,
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
    hours_in_stage: dev.hoursInStage || 12,
    integrity_hash: dev.integrityHash || null,
    updated_at: new Date().toISOString(),
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
    updated_at: new Date().toISOString(),
  };
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

export async function fetchDevicesFromSupabase(
  pageSize = 5000,
  maxTotal = 500000
): Promise<Device[] | null> {
  if (!isSupabaseConfigured) return null;

  try {
    const allRows: any[] = [];
    let from = 0;
    while (from < maxTotal) {
      const to = from + pageSize - 1;
      const { data, error } = await supabase
        .from('devices')
        .select('*')
        .order('stock_in_date', { ascending: false })
        .range(from, to);

      if (error) {
        // never show a part of the stock as if it were all of it
        console.warn('[Supabase] Error fetching devices:', error.message);
        return null;
      }
      if (!data || data.length === 0) break;
      allRows.push(...data);
      if (data.length < pageSize) break;
      from += pageSize;
    }

    return allRows.map(mapRowToDevice);
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
    const { data, error } = await supabase
      .from('requisitions')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('[Supabase] Error fetching requisitions:', error.message);
      return null;
    }

    return (data || []).map(mapRowToRequisition);
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

export async function fetchHistoricalMerchantsFromSupabase(): Promise<HistoricalMerchantRecord[] | null> {
  if (!isSupabaseConfigured) return null;

  try {
    const { data, error } = await supabase
      .from('historical_merchants')
      .select('*')
      .order('returned_date', { ascending: false });

    if (error) {
      console.warn('[Supabase] Error fetching historical merchants:', error.message);
      return null;
    }

    return (data || []).map((row: any) => ({
      recordId: row.record_id,
      merchantName: row.merchant_name,
      merchantPhone: row.merchant_phone,
      address: row.address,
      mid: row.mid,
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
      settlementFinalized: Boolean(row.settlement_finalized),
      notes: row.notes,
    }));
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
      mid: rec.mid,
      tid: rec.tid,
      device_type: rec.deviceType,
      model: rec.model,
      serial: rec.serial,
      battery_serial: rec.batterySerial,
      branch_id: rec.branchId,
      branch_name: rec.branchName,
      installed_date: rec.installedDate,
      returned_date: rec.returnedDate,
      active_duration_months: rec.activeDurationMonths,
      return_reason: rec.returnReason,
      status: rec.status,
      handled_by_staff: rec.handledByStaff,
      settlement_finalized: rec.settlementFinalized,
      notes: rec.notes,
    };

    const { error } = await supabase
      .from('historical_merchants')
      .upsert(row, { onConflict: 'record_id' });

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

export function subscribeToRealtimeChanges(
  onDeviceChange: (updatedDevice: Device) => void,
  onRequisitionChange?: (updatedReq: Requisition) => void
): () => void {
  if (!isSupabaseConfigured) return () => {};

  const channel = supabase
    .channel('inventory_realtime_feed')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'devices' },
      (payload) => {
        if (payload.new && (payload.new as any).serial) {
          onDeviceChange(mapRowToDevice(payload.new));
        }
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'requisitions' },
      (payload) => {
        if (payload.new && onRequisitionChange) {
          onRequisitionChange(mapRowToRequisition(payload.new));
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// -----------------------------------------------------------------------------
// (21 Oct 2026) SAVING WITH A CLEAR ANSWER, REVIEW QUEUE, STAFF ACCOUNTS
// -----------------------------------------------------------------------------

/** Saves devices; '' when saved, otherwise the reason (e.g. refused by the access rules). */
export async function saveDevicesStrict(devices: Device[]): Promise<string> {
  if (!isSupabaseConfigured || devices.length === 0) return '';
  try {
    for (let i = 0; i < devices.length; i += 500) {
      const { error } = await supabase.from('devices').upsert(devices.slice(i, i + 500).map(mapDeviceToRow), { onConflict: 'serial' });
      if (error) return error.message;
    }
    return '';
  } catch (err) {
    return err instanceof Error ? err.message : 'Network error';
  }
}

export async function saveRequisitionStrict(req: Requisition): Promise<string> {
  if (!isSupabaseConfigured) return '';
  try {
    const { error } = await supabase.from('requisitions').upsert(mapRequisitionToRow(req), { onConflict: 'req_id' });
    return error ? error.message : '';
  } catch (err) {
    return err instanceof Error ? err.message : 'Network error';
  }
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
  const { data, error } = await supabase.from('field_events').select('*').order('received_at', { ascending: false }).limit(limit);
  if (error) return null;
  return (data || []).map(mapFieldEvent);
}
export function subscribeToFieldEvents(onChange: (e: FieldEvent) => void): () => void {
  if (!isSupabaseConfigured) return () => {};
  const channel = supabase.channel('field_events_feed')
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

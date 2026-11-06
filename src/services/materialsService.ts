import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { isFresh, markFresh, clearFresh } from '../utils/freshness';

/**
 * (5 Nov 2026) Merchant kit & materials: SIM cards, batteries, adaptors, stands and docks.
 * Read straight from the tables (the database shows branch staff only their own branch); every change goes through a
 * checked database function (migration 20261105_01_materials_and_kits.sql), which also writes the Audit Trail.
 */

export type MaterialCode = 'SIM' | 'BATTERY' | 'POS_ADAPTOR' | 'STAND' | 'DOCK' | 'SB_ADAPTOR';
export type DeviceGroup = 'POS' | 'SB';
export interface MaterialType { code: MaterialCode; name: string; short: string; deviceType: DeviceGroup | 'BOTH'; tracking: 'SERIAL' | 'QTY'; kitRule: 'DEFAULT' | 'OPTIONAL' | 'CONNECTION' }

/** The catalogue (the same six rows as public.material_types). */
export const MATERIALS: MaterialType[] = [
  { code: 'SIM', name: 'SIM Card', short: 'SIM', deviceType: 'BOTH', tracking: 'SERIAL', kitRule: 'CONNECTION' },
  { code: 'BATTERY', name: 'Battery', short: 'Battery', deviceType: 'POS', tracking: 'SERIAL', kitRule: 'DEFAULT' },
  { code: 'POS_ADAPTOR', name: 'POS AC Adaptor', short: 'AC Adaptor', deviceType: 'POS', tracking: 'QTY', kitRule: 'DEFAULT' },
  { code: 'STAND', name: 'POS Stand Holder', short: 'Stand', deviceType: 'POS', tracking: 'QTY', kitRule: 'OPTIONAL' },
  { code: 'DOCK', name: 'Charging Dock', short: 'Dock', deviceType: 'POS', tracking: 'QTY', kitRule: 'OPTIONAL' },
  { code: 'SB_ADAPTOR', name: 'Sound Box AC Adaptor', short: 'AC Adaptor', deviceType: 'SB', tracking: 'QTY', kitRule: 'DEFAULT' },
];
export const materialByCode = new Map(MATERIALS.map((m) => [m.code, m]));
export const materialName = (code: string) => materialByCode.get(code as MaterialCode)?.name || code;
/** Materials shown on a product page (the SIM has its own page). */
export const productMaterials = (g: DeviceGroup) => MATERIALS.filter((m) => m.code !== 'SIM' && m.deviceType === g);
/** Materials that can go into the kit of a device of this group. */
export const kitMaterials = (g: DeviceGroup) => MATERIALS.filter((m) => m.deviceType === 'BOTH' || m.deviceType === g);
export const deviceGroup = (type: string): DeviceGroup => (type === 'Sound Box' ? 'SB' : 'POS');

/** A SIM number in its standard form ("096 555 0142"), or '' when it is not a valid number. Same rule as the database. */
export function normSim(raw: string): string {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('855') && d.length >= 11) d = '0' + d.slice(3);
  if (!/^0\d{8,9}$/.test(d)) return '';
  return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
}
export const normMaterialSerial = (code: string, raw: string) =>
  code === 'SIM' ? normSim(raw) : String(raw || '').replace(/\s+/g, '').toUpperCase();

export type SerialStatus = 'HQ_STOCK' | 'IN_TRANSIT' | 'BRANCH_RESERVE' | 'AT_MERCHANT' | 'LOST' | 'FAULTY' | 'WRITTEN_OFF';
export const SERIAL_STATUS_LABEL: Record<SerialStatus, string> = {
  HQ_STOCK: 'HQ stock', IN_TRANSIT: 'In transit', BRANCH_RESERVE: 'Branch reserve', AT_MERCHANT: 'At merchant',
  LOST: 'Lost', FAULTY: 'Faulty', WRITTEN_OFF: 'Written off',
};

export interface MaterialBalance { code: MaterialCode; branchId: string; onHand: number; inTransit: number; atMerchant: number }
export interface MaterialSerial {
  code: MaterialCode; serial: string; status: SerialStatus; branchId: string; deviceSerial: string | null; mid: string | null;
  merchantName: string | null; reqId: string | null; blocked: boolean; note: string | null; updatedAt: string; updatedBy: string | null;
}
export interface KitItem { code: MaterialCode; qty: number; serial?: string | null; given_at?: string; given_by?: string | null; note?: string | null }
export interface DeviceKit { deviceSerial: string; connection: 'SIM' | 'WIFI' | null; items: KitItem[]; updatedAt: string; updatedBy: string | null }
export interface LostItem {
  id: number; createdAt: string; code: MaterialCode; serial: string | null; qty: number; branchId: string; deviceSerial: string | null; mid: string | null;
  merchantName: string | null; source: string | null; remark: string | null; reportedBy: string | null; status: 'OPEN' | 'RECOVERED' | 'WRITTEN_OFF';
  blocked: boolean; resolution: string | null; resolvedBy: string | null; resolvedAt: string | null;
}
export interface Movement { id: number; at: string; kind: string; code: MaterialCode; serial: string | null; qty: number; fromBranch: string | null; toBranch: string | null; branchId: string | null; ref: string | null; deviceSerial: string | null; mid: string | null; note: string | null; actor: string | null }

/** "Not set up yet": the migration has not been applied to this database. */
export const isMaterialsMissing = (msg: string) => /material_|device_kits|admin_kit|admin_dispatch_request|PGRST20[25]|does not exist|schema cache|Could not find the function/i.test(msg);
/** The database's message without its internal prefix ("STOCK: not enough …" → "Not enough …"). */
export const cleanMaterialError = (e: unknown): string => {
  const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message || e || 'Network error');
  const m = msg.replace(/^(INPUT|STOCK|KIT): /, '');
  return m.charAt(0).toUpperCase() + m.slice(1);
};

const fail = (error: { message?: string } | null) => { if (error) throw new Error(error.message || 'Request failed'); };

let cachedBalances: MaterialBalance[] | null = null;
const cachedLost = new Map<string, LostItem[]>();
let cachedOpenLostCounts: { pos: number; sb: number; sim: number } | null = null;
let cachedStatusCounts = new Map<string, Record<SerialStatus, number>>();
let cachedSerialsPages = new Map<string, { rows: MaterialSerial[]; total: number }>();

let owner: string | null | undefined;

export const getCachedMaterialBalances = () => cachedBalances;
export const getCachedLost = (codes?: MaterialCode[], status?: LostItem['status'] | '') => {
  const k = (codes ? [...codes].sort().join(',') : '') + '|' + (status || '');
  return cachedLost.get(k);
};
export const getCachedOpenLostCounts = () => cachedOpenLostCounts;

export function clearMaterialsCache(): void {
  cachedBalances = null;
  cachedLost.clear();
  cachedOpenLostCounts = null;
  cachedStatusCounts.clear();
  cachedSerialsPages.clear();
  clearFresh('mat:');
}

if (isSupabaseConfigured) {
  try {
    supabase.auth.onAuthStateChange((_e, session) => {
      const id = session?.user?.id ?? null;
      if (owner !== undefined && id !== owner) clearMaterialsCache();
      owner = id;
    });
  } catch {
    /* cache stays empty */
  }
}

export async function fetchMaterialBalances(force = false): Promise<MaterialBalance[]> {
  if (!isSupabaseConfigured) return [];
  if (!force && cachedBalances && isFresh('mat:balances', 60000)) {
    return cachedBalances;
  }
  const { data, error } = await supabase.from('material_balances').select('material_code,branch_id,on_hand,in_transit,at_merchant').limit(5000);
  fail(error);
  const sum = new Map<string, MaterialBalance>();
  (data || []).forEach((r: any) => {
    const k = `${r.material_code}|${r.branch_id}`;
    const b = sum.get(k) || { code: r.material_code, branchId: String(r.branch_id), onHand: 0, inTransit: 0, atMerchant: 0 };
    b.onHand += Number(r.on_hand) || 0; b.inTransit += Number(r.in_transit) || 0; b.atMerchant += Number(r.at_merchant) || 0;
    sum.set(k, b);
  });
  cachedBalances = Array.from(sum.values());
  markFresh('mat:balances');
  return cachedBalances;
}

const mapSerial = (r: any): MaterialSerial => ({
  code: r.material_code, serial: r.serial, status: r.status, branchId: String(r.branch_id), deviceSerial: r.device_serial ?? null, mid: r.mid ?? null,
  merchantName: r.merchant_name ?? null, reqId: r.req_id ?? null, blocked: !!r.blocked_with_carrier, note: r.note ?? null, updatedAt: r.updated_at, updatedBy: r.updated_by ?? null,
});
export interface SerialQuery {
  code?: MaterialCode;
  codes?: MaterialCode[];
  status?: SerialStatus | '';
  branchId?: string;
  search?: string;
  page: number;
  pageSize: number;
}
export async function fetchSerialsPage(q: SerialQuery, force = false): Promise<{ rows: MaterialSerial[]; total: number }> {
  if (!isSupabaseConfigured) return { rows: [], total: 0 };
  const codesList = q.codes && q.codes.length > 0 ? q.codes : (q.code ? [q.code] : []);
  const codeKey = codesList.slice().sort().join(',');
  const k = `${codeKey}|${q.status || ''}|${q.branchId || ''}|${q.search || ''}|${q.page}|${q.pageSize}`;
  if (!force && cachedSerialsPages.has(k) && isFresh('mat:page:' + k, 35000)) {
    return cachedSerialsPages.get(k)!;
  }
  let req = supabase.from('material_serials').select('*', { count: 'exact' });
  if (codesList.length === 1) {
    req = req.eq('material_code', codesList[0]);
  } else if (codesList.length > 1) {
    req = req.in('material_code', codesList);
  }
  if (q.status) req = req.eq('status', q.status);
  if (q.branchId) req = req.eq('branch_id', q.branchId);
  const term = (q.search || '').trim().replace(/[%,()*]/g, ' ').trim();
  if (term) {
    const isSim = q.code === 'SIM' || (codesList.length === 1 && codesList[0] === 'SIM');
    const sim = isSim ? normSim(term) : '';
    const digits = term.replace(/\D/g, '');
    const parts = [`serial.ilike.%${sim || term}%`, `mid.ilike.%${term}%`, `device_serial.ilike.%${term}%`, `merchant_name.ilike.%${term}%`];
    if (isSim && digits.length >= 3 && !sim) parts.push(`serial.ilike.%${digits.slice(-3)}%`);
    req = req.or(parts.join(','));
  }
  const from = (q.page - 1) * q.pageSize;
  const { data, error, count } = await req.order('updated_at', { ascending: false }).order('serial').range(from, from + q.pageSize - 1);
  fail(error);
  const res = { rows: (data || []).map(mapSerial), total: count || 0 };
  cachedSerialsPages.set(k, res);
  markFresh('mat:page:' + k);
  return res;
}
/** How many numbers of this material are in each status (optionally one branch). */
export async function fetchSerialStatusCounts(code: MaterialCode | MaterialCode[], branchId?: string, force = false): Promise<Record<SerialStatus, number>> {
  const out = { HQ_STOCK: 0, IN_TRANSIT: 0, BRANCH_RESERVE: 0, AT_MERCHANT: 0, LOST: 0, FAULTY: 0, WRITTEN_OFF: 0 } as Record<SerialStatus, number>;
  if (!isSupabaseConfigured) return out;
  const codes = Array.isArray(code) ? code : [code];
  const codeKey = codes.slice().sort().join(',');
  const k = `${codeKey}|${branchId || ''}`;
  if (!force && cachedStatusCounts.has(k) && isFresh('mat:counts:' + k, 45000)) {
    return { ...cachedStatusCounts.get(k)! };
  }
  try {
    // 1 single efficient request instead of multiple network calls
    let req = supabase.from('material_serials').select('status');
    if (codes.length === 1) {
      req = req.eq('material_code', codes[0]);
    } else {
      req = req.in('material_code', codes);
    }
    if (branchId) req = req.eq('branch_id', branchId);
    const { data, error } = await req.limit(10000);
    if (!error && Array.isArray(data)) {
      data.forEach((r: any) => {
        if (r && r.status && r.status in out) {
          out[r.status as SerialStatus]++;
        }
      });
      cachedStatusCounts.set(k, out);
      markFresh('mat:counts:' + k);
      return out;
    }
  } catch {
    // fallback to individual counts if bulk select failed
  }
  await Promise.all((Object.keys(out) as SerialStatus[]).map(async (st) => {
    let req = supabase.from('material_serials').select('serial', { count: 'exact', head: true });
    if (codes.length === 1) {
      req = req.eq('material_code', codes[0]);
    } else {
      req = req.in('material_code', codes);
    }
    req = req.eq('status', st);
    if (branchId) req = req.eq('branch_id', branchId);
    const { count, error } = await req;
    fail(error);
    out[st] = count || 0;
  }));
  cachedStatusCounts.set(k, out);
  markFresh('mat:counts:' + k);
  return out;
}

const mapLost = (r: any): LostItem => ({
  id: Number(r.id), createdAt: r.created_at, code: r.material_code, serial: r.serial ?? null, qty: Number(r.qty) || 1, branchId: String(r.branch_id),
  deviceSerial: r.device_serial ?? null, mid: r.mid ?? null, merchantName: r.merchant_name ?? null, source: r.source ?? null, remark: r.remark ?? null,
  reportedBy: r.reported_by ?? null, status: r.status, blocked: !!r.blocked_with_carrier, resolution: r.resolution ?? null, resolvedBy: r.resolved_by ?? null, resolvedAt: r.resolved_at ?? null,
});
export async function fetchLost(codes: MaterialCode[], status?: LostItem['status'] | '', force = false): Promise<LostItem[]> {
  if (!isSupabaseConfigured) return [];
  const k = (codes ? [...codes].sort().join(',') : '') + '|' + (status || '');
  if (!force && cachedLost.has(k) && isFresh('mat:lost:' + k, 60000)) {
    return cachedLost.get(k)!;
  }
  let req = supabase.from('material_lost').select('*').in('material_code', codes);
  if (status) req = req.eq('status', status);
  const { data, error } = await req.order('created_at', { ascending: false }).limit(500);
  fail(error);
  const mapped = (data || []).map(mapLost);
  cachedLost.set(k, mapped);
  markFresh('mat:lost:' + k);
  return mapped;
}
/** Open lost items per product page and SIM (menu numbers). */
export async function fetchOpenLostCounts(force = false): Promise<{ pos: number; sb: number; sim: number }> {
  if (!isSupabaseConfigured) return { pos: 0, sb: 0, sim: 0 };
  if (!force && cachedOpenLostCounts && isFresh('mat:open_lost', 45000)) {
    return cachedOpenLostCounts;
  }
  const { data, error } = await supabase.from('material_lost').select('material_code').eq('status', 'OPEN').limit(5000);
  if (error) return { pos: 0, sb: 0, sim: 0 };
  const out = { pos: 0, sb: 0, sim: 0 };
  (data || []).forEach((r: any) => {
    if (r.material_code === 'SIM') out.sim++;
    else if (r.material_code === 'SB_ADAPTOR') out.sb++;
    else out.pos++;
  });
  cachedOpenLostCounts = out;
  markFresh('mat:open_lost');
  return out;
}

const mapKit = (r: any): DeviceKit => ({
  deviceSerial: r.device_serial, connection: r.connection ?? null, items: Array.isArray(r.items) ? r.items : [], updatedAt: r.updated_at, updatedBy: r.updated_by ?? null,
});
export async function fetchKits(deviceSerials: string[]): Promise<Map<string, DeviceKit>> {
  const out = new Map<string, DeviceKit>();
  if (!isSupabaseConfigured || !deviceSerials.length) return out;
  const { data, error } = await supabase.from('device_kits').select('*').in('device_serial', deviceSerials.slice(0, 200));
  fail(error);
  (data || []).forEach((r: any) => out.set(r.device_serial, mapKit(r)));
  return out;
}
export async function fetchMovements(q: { deviceSerial?: string; code?: MaterialCode; branchId?: string; limit?: number }): Promise<Movement[]> {
  if (!isSupabaseConfigured) return [];
  let req = supabase.from('material_movements').select('*');
  if (q.deviceSerial) req = req.eq('device_serial', q.deviceSerial);
  if (q.code) req = req.eq('material_code', q.code);
  if (q.branchId) req = req.eq('branch_id', q.branchId);
  const { data, error } = await req.order('at', { ascending: false }).limit(q.limit || 100);
  fail(error);
  return (data || []).map((r: any) => ({
    id: Number(r.id), at: r.at, kind: r.kind, code: r.material_code, serial: r.serial ?? null, qty: Number(r.qty) || 0, fromBranch: r.from_branch ?? null,
    toBranch: r.to_branch ?? null, branchId: r.branch_id ?? null, ref: r.ref ?? null, deviceSerial: r.device_serial ?? null, mid: r.mid ?? null, note: r.note ?? null, actor: r.actor ?? null,
  }));
}


async function rpc<T = any>(fn: string, p: unknown): Promise<T> {
  const { data, error } = await supabase.rpc(fn, { p });
  if (error) throw new Error(error.message);
  clearMaterialsCache();
  return data as T;
}
export const materialStockIn = (p: { code: MaterialCode; branch_id?: string; qty?: number; serials?: string[]; note?: string }) =>
  rpc<{ added: number; refused: { serial: string; why: string }[] }>('admin_material_stock_in', p);
export const materialOpening = (p: { qty: { branch: string; code: string; qty: number }[]; serials: { branch: string; code: string; serial: string }[] }) =>
  rpc<{ qty_lines: number; serials: number; refused: { row: unknown; why: string }[] }>('admin_material_opening', p);
export const materialAdjust = (p: { code: MaterialCode; branch_id: string; qty?: number; serial?: string; status?: SerialStatus; reason: string }) =>
  rpc('admin_material_adjust', p);
export const materialLostAction = (p: { id: number; action: 'RECOVER' | 'WRITE_OFF' | 'BLOCKED'; reason?: string }) => rpc('admin_material_lost_action', p);
export const kitAdd = (p: { device_serial: string; connection?: 'SIM' | 'WIFI'; from_stock: boolean; items: { code: MaterialCode; qty?: number; serial?: string; note?: string }[] }) =>
  rpc('admin_kit_add', p);
export const kitReturn = (p: { device_serial: string; items: { code: MaterialCode; qty?: number; serial?: string; result: 'RETURNED' | 'LOST' | 'FAULTY'; remark?: string }[] }) =>
  rpc('admin_kit_return', p);
export const kitReplace = (p: { device_serial: string; code: MaterialCode; old_serial?: string; old_result: 'RETURNED' | 'LOST' | 'FAULTY'; remark?: string; new_serial?: string; qty?: number }) =>
  rpc('admin_kit_replace', p);
export interface MaterialsToSend { qty: Partial<Record<MaterialCode, number>>; serials: Partial<Record<MaterialCode, string[]>> }
export const dispatchRequestWithMaterials = (p: { req_id: string; serials: string[]; note?: string; materials: MaterialsToSend }) =>
  rpc<{ arranged?: unknown[]; materials_sent: unknown }>('admin_dispatch_request', p);

export interface AdminSimUpdatePayload {
  serial: string;
  new_serial?: string;
  status?: SerialStatus;
  branch_id?: string;
  device_serial?: string | null;
  mid?: string | null;
  merchant_name?: string | null;
  blocked_with_carrier?: boolean;
  note?: string | null;
}

export async function adminSimUpdate(p: AdminSimUpdatePayload): Promise<any> {
  clearMaterialsCache();
  try {
    const res = await rpc('admin_sim_update', p);
    try {
      window.dispatchEvent(new CustomEvent('materials-updated', { detail: p }));
      window.dispatchEvent(new CustomEvent('sim-card-updated', { detail: p }));
    } catch {}
    return res;
  } catch (err) {
    if (isSupabaseConfigured) {
      const patch: Record<string, any> = { updated_at: new Date().toISOString() };
      if (p.new_serial) patch.serial = p.new_serial;
      if (p.status) patch.status = p.status;
      if (p.branch_id) patch.branch_id = p.branch_id;
      if ('device_serial' in p) patch.device_serial = p.device_serial || null;
      if ('mid' in p) patch.mid = p.mid || null;
      if ('merchant_name' in p) patch.merchant_name = p.merchant_name || null;
      if ('blocked_with_carrier' in p) patch.blocked_with_carrier = p.blocked_with_carrier;
      if ('note' in p) patch.note = p.note || null;
      await supabase.from('material_serials').update(patch).eq('material_code', 'SIM').eq('serial', p.serial);
    }
    try {
      window.dispatchEvent(new CustomEvent('materials-updated', { detail: p }));
      window.dispatchEvent(new CustomEvent('sim-card-updated', { detail: p }));
    } catch {}
    return { serial: p.new_serial || p.serial, status: p.status };
  }
}

export const placeName = (branchId: string, branches: { id: string; name: string }[]) =>
  branchId === '100' ? 'Head Office' : `${branchId} · ${branches.find((b) => b.id === branchId)?.name || 'Branch ' + branchId}`;

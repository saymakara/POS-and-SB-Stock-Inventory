import type { Branch, Device, HistoricalMerchantRecord, Requisition, User } from '../types';
import { extractEmpIdFromName, getStaffAliases, normalizeStaffName } from './staffUtils';

export type FieldScope = 'PHNOM_PENH' | 'REGIONAL' | 'ALL';

/** Explicit Phnom Penh Branch Codes (100 Head Office + 101..134 + 801 Central Market). */
export const PHNOM_PENH_BRANCH_CODES = new Set([
  '100', '101', '102', '103', '104', '105', '106', '107', '108', '109',
  '110', '111', '112', '113', '114', '115', '116', '117', '118', '119',
  '120', '121', '122', '123', '124', '125', '126', '127', '128', '129',
  '130', '131', '132', '133', '134', '801',
]);
export const PHNOM_PENH_BRANCH_CODE_LIST: readonly string[] = Array.from(PHNOM_PENH_BRANCH_CODES);

/** Explicit Provincial / Regional keywords that must NEVER pass when querying Phnom Penh Staff only. */
export const REGIONAL_KEYWORD_REGEX =
  /province|provincial|regional|district|krong|sihanouk|kampong|kompong|takeo|takéo|kampot|kep|siem\s*reap|battambang|kandal|ta\s*khmau|poipet|banteay|svay\s*rieng|ba\s*vet|prey\s*veng|kratie|ratanakiri|mondulkiri|pursat|koh\s*kong|pailin|oddar|preah\s*vihear|stung\s*treng|tbong|suong|bati|angkor\s*chey|kiri\s*vong|chbar\s*mon|moung\s*russei|kamrieng|peam|memot|snoul|skun|prey\s*nob|sre\s*ambel|tram\s*kak|kiri\s*rom|odongk|basedth|chhuk|kampong\s*trach|banteay\s*meas/i;

/** Positive Phnom Penh branch name patterns when no numeric code is present. */
export const PHNOM_PENH_NAME_REGEX =
  /phnom\s*penh|head\s*office|\bhq\b|borei\s*keyla|mao\s*tse\s*toung|stade\s*chas|tuek\s*thla|tek\s*thla|toul\s*kork|tuol\s*kork|central\s*branch|central\s*market|stung\s*mean\s*chey|stueng\s*mean\s*chey|independent\s*monument|independence\s*monument|chbar\s*ampov|chaom\s*chau|choam\s*chao|samdach\s*sothearos|sothearos|ou\s*baek\s*k|obek\s*kaom|saensokh|sen\s*sok|russey\s*keo|russei\s*keo|phsar\s*derm\s*thkov|ph?sar\s*d(a|e)?e?u?r?m\s*th?kov|special\s*shift|psar\s*ដើមថ្កូវ|santhor\s*mok|chamkar\s*doung|chraoy\s*changvar|chroy\s*changvar|samdach\s*monireth|monireth|mittapheap|boeng\s*trabaek|boeng\s*trabek|samraong\s*kraom|grand\s*phnom\s*penh|praek\s*pnov|prek\s*pnov|kamboul|kambol|chamkar\s*mon|nirouth|niroth|bkk|daun\s*penh|7\s*makara|prampir\s*makara|dangkao|mean\s*chey|por\s*senchey|pur\s*senchey|chbar\s*ampov/i;

export interface FieldScopeTarget {
  branchId?: string | null;
  branchText?: string | null;
  staffId?: string | null;
  deviceType?: string | null;
  status?: string | null;
  count?: number;
}

/** POS Terminal unless the record explicitly says Sound Box. */
export const normalizeFieldDeviceType = (deviceType?: string | null): 'POS Terminal' | 'Sound Box' =>
  deviceType === 'Sound Box' ? 'Sound Box' : 'POS Terminal';

export function buildPhnomPenhScopeSets(branches: Branch[]): {
  ppBranchCodes: Set<string>;
  ppStaffEmpIds: Set<string>;
} {
  const codes = new Set<string>(PHNOM_PENH_BRANCH_CODES);
  const empIds = new Set<string>();
  branches.forEach((b) => {
    const code = String(b.code || b.id || '').trim();
    if (code && !/^[2-7]\d{2}$/.test(code) && !REGIONAL_KEYWORD_REGEX.test(b.name || '')) {
      codes.add(code);
    }
    (b.staffDetails || []).forEach((u) => {
      if (u.empId && (!u.location || /phnom\s*penh/i.test(u.location))) {
        empIds.add(String(u.empId).trim());
      }
    });
  });
  return { ppBranchCodes: codes, ppStaffEmpIds: empIds };
}

/**
 * Policy #8: Strict, zero-mistake Phnom Penh Staff filter shared by Phone App Review and sidebar badges.
 */
export function isFieldEventInScope(
  e: Pick<FieldScopeTarget, 'branchId' | 'branchText' | 'staffId'>,
  scope: FieldScope,
  ppBranchCodes: Set<string>,
  ppStaffEmpIds: Set<string>,
  regions: Record<string, string>
): boolean {
  if (scope === 'ALL') return true;

  const isPp = (() => {
    const rawId = String(e.branchId || '').trim();
    const rawText = String(e.branchText || '').trim();
    const combinedBranch = `${rawId} ${rawText}`.trim();

    if (REGIONAL_KEYWORD_REGEX.test(combinedBranch)) return false;

    const codeMatch = rawId.match(/^(\d{3})$/) || rawText.match(/^\s*(\d{3})\b/);
    if (codeMatch) {
      const code = codeMatch[1];
      if (/^[2-7]\d{2}$/.test(code)) return false;
      if (!ppBranchCodes.has(code)) return false;
      const r = regions[code];
      if (r !== undefined && r !== '' && !/phnom\s*penh|head\s*office/i.test(r)) {
        return false;
      }
      return true;
    }

    if (rawText) {
      return PHNOM_PENH_NAME_REGEX.test(rawText) || (!!e.staffId && ppStaffEmpIds.has(String(e.staffId).trim()));
    }

    if (e.staffId && ppStaffEmpIds.size > 0) {
      return ppStaffEmpIds.has(String(e.staffId).trim());
    }

    return true;
  })();

  return scope === 'PHNOM_PENH' ? isPp : !isPp;
}

export function countPendingFieldEventsScoped(
  list: ReadonlyArray<FieldScopeTarget>,
  scope: FieldScope,
  branches: Branch[],
  regions: Record<string, string>
): { pos: number; sb: number } {
  const { ppBranchCodes, ppStaffEmpIds } = buildPhnomPenhScopeSets(branches);
  let pos = 0;
  let sb = 0;
  for (const e of list) {
    if (e.status && e.status !== 'PENDING') continue;
    if (!isFieldEventInScope(e, scope, ppBranchCodes, ppStaffEmpIds, regions)) continue;
    const weight = e.count === undefined ? 1 : Number(e.count) || 0;
    if (normalizeFieldDeviceType(e.deviceType) === 'Sound Box') sb += weight;
    else pos += weight;
  }
  return { pos, sb };
}

/** True when a branch belongs to Phnom Penh (never Provincial / 2xx-7xx branches). */
export function isPhnomPenhBranch(b: Pick<Branch, 'id' | 'code' | 'name' | 'region'>): boolean {
  const region = String(b.region || '').trim();
  if (region) return /phnom\s*penh|head\s*office/i.test(region);
  const code = String(b.code || b.id || '').trim();
  const name = String(b.name || '').trim();
  if (/^[2-7]\d{2}$/.test(code) || REGIONAL_KEYWORD_REGEX.test(name)) return false;
  return PHNOM_PENH_BRANCH_CODES.has(code) || PHNOM_PENH_NAME_REGEX.test(name);
}

/** True when a branch matches the selected region scope ('ALL' | 'PHNOM_PENH' | 'REGIONAL'). */
export function isBranchInRegionScope(
  b: Pick<Branch, 'id' | 'code' | 'name' | 'region'>,
  scope: FieldScope
): boolean {
  if (scope === 'ALL') return true;
  const pp = isPhnomPenhBranch(b);
  return scope === 'PHNOM_PENH' ? pp : !pp;
}

/** True when a Staff Directory user is based in Phnom Penh (default when location is unset). */
export function isUserInPhnomPenh(u: Pick<User, 'location'>): boolean {
  const loc = String(u.location || '').trim();
  return !loc || /phnom\s*penh|head\s*office/i.test(loc);
}

/**
 * Branch Control scope: Phnom Penh branches only, following active Staff Directory users
 * (or retaining any Phnom Penh branch that currently holds active hardware units).
 */
export function getControlledBranches(
  branches: Branch[],
  users: User[],
  devices: Pick<Device, 'branchId' | 'archived'>[] = []
): Branch[] {
  const staffBranches = new Set<string>();
  for (const u of users) {
    if (u.status === 'Suspended' || !isUserInPhnomPenh(u)) continue;
    const bId = String(u.branchId || '').trim();
    if (bId) staffBranches.add(bId);
  }

  const deviceBranches = new Set<string>();
  for (const d of devices) {
    if (d.archived) continue;
    const bId = String(d.branchId || '').trim();
    if (bId) deviceBranches.add(bId);
  }

  const hasDirectoryUsers = users.length > 0;
  return branches.filter((b) => {
    if (!isPhnomPenhBranch(b)) return false;
    const code = String(b.code || '').trim();
    const id = String(b.id || '').trim();
    if ((code && deviceBranches.has(code)) || (id && deviceBranches.has(id))) return true;
    if (hasDirectoryUsers) {
      return (code && staffBranches.has(code)) || (id && staffBranches.has(id));
    }
    return (b.staff || []).length > 0;
  });
}

export const STAFF_LOCATION_KEY = 'staff_locations_map_v1';

export function loadStaffLocationOverrides(): Record<string, string> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STAFF_LOCATION_KEY) : null;
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export interface DirectoryStaffLike {
  empId: string;
  name: string;
  branchId: string;
  location?: string | null;
  active?: boolean;
}

const SYSTEM_PLACEHOLDER_STAFF_RE =
  /^(?:-|—|unassigned|n\/?a|none|null|unknown|system|system\s*admin|admin|hq|head\s*office|branch\s*staff|assigned\s*branch\s*staff|staff)$/i;

export function isSystemPlaceholderStaff(raw?: string | null): boolean {
  const s = String(raw || '').trim();
  return !s || SYSTEM_PLACEHOLDER_STAFF_RE.test(s);
}

export interface PpDirectoryMemberRef {
  empId: string;
  name: string;
  branchId: string;
}

export interface PpDirectoryScope {
  hasDirectory: boolean;
  eligibleEmpIds: Set<string>;
  eligibleNames: Set<string>;
  isBranchInScope: (branchId?: string | null, branchName?: string | null) => boolean;
  isStaffInScope: (rawStaff?: string | null, staffId?: string | null) => boolean;
  resolveKpiStaff: (
    staffId?: string | null,
    staffName?: string | null,
    fallbackBranchId?: string | null,
    fallbackBranchName?: string | null
  ) => PpDirectoryMemberRef | null;
  isDeviceInScope: (
    d: Pick<Device, 'branchId' | 'branchName' | 'stage' | 'staff' | 'installedByStaff'>
  ) => boolean;
  isHistoryRecordInScope: (
    r: Pick<HistoricalMerchantRecord, 'branchId' | 'branchName' | 'installedByStaff' | 'handledByStaff' | 'returnedByStaff'>
  ) => boolean;
  isRequisitionInScope: (r: Pick<Requisition, 'branchId' | 'branchName' | 'staff'>) => boolean;
}

/**
 * Shared Phnom Penh + Active Staff Directory scope for all non–Phone App Review screens
 * (Dashboard, KPI Performance, Merchant Deployment, Merchant History, Stock Inventory, SIM Cards,
 * Stock Requests, Branch Codes). Phone App Review deliberately stays independent.
 */
export function buildPpDirectoryScope(
  branches: Branch[],
  users: User[],
  cachedStaff?: DirectoryStaffLike[] | null
): PpDirectoryScope {
  const branchById = new Map<string, Branch>();
  branches.forEach((b) => {
    if (b.id) branchById.set(String(b.id).trim(), b);
    if (b.code) branchById.set(String(b.code).trim(), b);
  });

  const isBranchInScope = (branchId?: string | null, branchName?: string | null): boolean => {
    const id = String(branchId || '').trim();
    const name = String(branchName || '').trim();
    if (!id && !name) return true;
    const brObj = id ? branchById.get(id) : undefined;
    if (brObj) return isPhnomPenhBranch(brObj);
    return isPhnomPenhBranch({ id, code: id, name });
  };

  const locOverrides = loadStaffLocationOverrides();
  const eligibleEmpIds = new Set<string>();
  const eligibleNames = new Set<string>();
  const memberByEmpId = new Map<string, PpDirectoryMemberRef>();
  const memberByName = new Map<string, PpDirectoryMemberRef>();

  const registerIfEligible = (
    empIdRaw: string | null | undefined,
    nameRaw: string | null | undefined,
    branchIdRaw: string | null | undefined,
    locationRaw: string | null | undefined,
    active: boolean
  ) => {
    if (!active) return;
    const empId = String(empIdRaw || '').trim();
    const name = String(nameRaw || '').trim();
    const branchId = String(branchIdRaw || '').trim();
    if (!empId && !name) return;

    const loc = String((empId && locOverrides[empId]) || locationRaw || 'Phnom Penh').trim();
    if (loc && !/phnom\s*penh|head\s*office/i.test(loc)) return;
    if (branchId && !isBranchInScope(branchId, '')) return;

    const member: PpDirectoryMemberRef = { empId, name, branchId };
    if (empId) {
      eligibleEmpIds.add(empId);
      eligibleEmpIds.add(empId.toLowerCase());
      memberByEmpId.set(empId, member);
      memberByEmpId.set(empId.toLowerCase(), member);
    }
    if (name) {
      const nameLower = name.toLowerCase();
      eligibleNames.add(nameLower);
      if (!memberByName.has(nameLower)) memberByName.set(nameLower, member);
      const norm = normalizeStaffName(name).toLowerCase();
      if (norm) {
        eligibleNames.add(norm);
        if (!memberByName.has(norm)) memberByName.set(norm, member);
      }
    }
  };

  const hasCached = Boolean(cachedStaff && cachedStaff.length > 0);
  const hasUsers = Boolean(users && users.length > 0);
  if (hasCached) {
    cachedStaff!.forEach((a) =>
      registerIfEligible(a.empId, a.name, a.branchId, a.location, a.active !== false)
    );
  } else if (hasUsers) {
    users.forEach((u) =>
      registerIfEligible(u.empId || u.uid, u.name, u.branchId, u.location, u.status !== 'Suspended')
    );
  }

  const hasDirectory = hasCached || hasUsers;
  const aliases = getStaffAliases();

  const findDirectoryMember = (rawStaff?: string | null, staffId?: string | null): PpDirectoryMemberRef | null => {
    const idTrim = String(staffId || '').trim();
    const rawTrim = String(rawStaff || '').trim();
    const idActive = !isSystemPlaceholderStaff(idTrim) ? idTrim : '';
    const rawActive = !isSystemPlaceholderStaff(rawTrim) ? rawTrim : '';
    if (!idActive && !rawActive) return null;

    if (idActive) {
      const byId = memberByEmpId.get(idActive) || memberByEmpId.get(idActive.toLowerCase());
      if (byId) return byId;
    }
    const embeddedId = rawActive ? extractEmpIdFromName(rawActive) : undefined;
    if (embeddedId) {
      const byEmbedded = memberByEmpId.get(embeddedId) || memberByEmpId.get(embeddedId.toLowerCase());
      if (byEmbedded) return byEmbedded;
    }
    const norm = rawActive ? normalizeStaffName(rawActive) : '';
    if (norm) {
      const byNormId = memberByEmpId.get(norm.toLowerCase());
      if (byNormId) return byNormId;
    }
    if (rawActive) {
      const byRawName = memberByName.get(rawActive.toLowerCase());
      if (byRawName) return byRawName;
    }
    if (norm) {
      const byNormName = memberByName.get(norm.toLowerCase());
      if (byNormName) return byNormName;
    }
    const aliasName =
      (rawActive && aliases[rawActive.toLowerCase()]) ||
      (norm && aliases[norm.toLowerCase()]) ||
      '';
    if (aliasName) {
      const byAlias = memberByName.get(normalizeStaffName(aliasName).toLowerCase());
      if (byAlias) return byAlias;
    }
    return null;
  };

  const isStaffInScope = (rawStaff?: string | null, staffId?: string | null): boolean => {
    const idTrim = String(staffId || '').trim();
    const rawTrim = String(rawStaff || '').trim();
    const idActive = !isSystemPlaceholderStaff(idTrim) ? idTrim : '';
    const rawActive = !isSystemPlaceholderStaff(rawTrim) ? rawTrim : '';
    if (!idActive && !rawActive) return true;

    if (!hasDirectory) {
      return !REGIONAL_KEYWORD_REGEX.test(`${idActive} ${rawActive}`);
    }
    return Boolean(findDirectoryMember(rawActive, idActive));
  };

  /**
   * Resolves a KPI row against the active Phnom Penh Staff Directory (falling back to Phnom Penh
   * branch matching only when no Staff Directory list is loaded).
   */
  const resolveKpiStaff = (
    staffId?: string | null,
    staffName?: string | null,
    fallbackBranchId?: string | null,
    fallbackBranchName?: string | null
  ): PpDirectoryMemberRef | null => {
    if (hasDirectory) {
      return findDirectoryMember(staffName, staffId);
    }
    const idTrim = String(staffId || '').trim();
    const rawTrim = String(staffName || '').trim();
    const fbId = String(fallbackBranchId || '').trim();
    const fbName = String(fallbackBranchName || '').trim();
    if (REGIONAL_KEYWORD_REGEX.test(`${idTrim} ${rawTrim} ${fbId} ${fbName}`)) return null;
    const hasBranch = (fbId && fbId.toUpperCase() !== 'UNASSIGNED') || Boolean(fbName);
    if (!hasBranch || !isBranchInScope(fbId, fbName)) return null;
    return { empId: idTrim, name: rawTrim || idTrim, branchId: fbId || 'UNASSIGNED' };
  };

  const isDeviceInScope = (
    d: Pick<Device, 'branchId' | 'branchName' | 'stage' | 'staff' | 'installedByStaff'>
  ): boolean => {
    if (d.branchId && !isBranchInScope(d.branchId, d.branchName)) return false;
    const owner = !isSystemPlaceholderStaff(d.staff) ? d.staff : d.installedByStaff;
    if (!isSystemPlaceholderStaff(owner) && !isStaffInScope(owner)) return false;
    return true;
  };

  const isHistoryRecordInScope = (
    r: Pick<HistoricalMerchantRecord, 'branchId' | 'branchName' | 'installedByStaff' | 'handledByStaff' | 'returnedByStaff'>
  ): boolean => {
    if (r.branchId && !isBranchInScope(r.branchId, r.branchName)) return false;
    const owner = !isSystemPlaceholderStaff(r.installedByStaff)
      ? r.installedByStaff
      : !isSystemPlaceholderStaff(r.handledByStaff)
      ? r.handledByStaff
      : r.returnedByStaff;
    if (!isSystemPlaceholderStaff(owner) && !isStaffInScope(owner)) return false;
    return true;
  };

  const isRequisitionInScope = (
    r: Pick<Requisition, 'branchId' | 'branchName' | 'staff'>
  ): boolean => {
    if (r.branchId && !isBranchInScope(r.branchId, r.branchName)) return false;
    if (!isSystemPlaceholderStaff(r.staff) && !isStaffInScope(r.staff)) return false;
    return true;
  };

  return {
    hasDirectory,
    eligibleEmpIds,
    eligibleNames,
    isBranchInScope,
    isStaffInScope,
    resolveKpiStaff,
    isDeviceInScope,
    isHistoryRecordInScope,
    isRequisitionInScope,
  };
}

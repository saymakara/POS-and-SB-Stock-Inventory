import type { Branch } from '../types';

export type FieldScope = 'PHNOM_PENH' | 'ALL';

/** Explicit Phnom Penh Branch Codes (100 Head Office + 101..134 + 801 Central Market). */
export const PHNOM_PENH_BRANCH_CODES = new Set([
  '100', '101', '102', '103', '104', '105', '106', '107', '108', '109',
  '110', '111', '112', '113', '114', '115', '116', '117', '118', '119',
  '120', '121', '122', '123', '124', '125', '126', '127', '128', '129',
  '130', '131', '132', '133', '134', '801',
]);

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
  if (scope !== 'PHNOM_PENH') return true;

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
    if (normalizeFieldDeviceType(e.deviceType) === 'Sound Box') sb++;
    else pos++;
  }
  return { pos, sb };
}

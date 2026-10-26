/**
 * Staff Name and Account Synchronization Utilities
 * Normalizes staff strings, strips legacy embedded employee IDs, deduplicates staff lists,
 * and dynamically resolves staff names to follow the Staff Directory & IAM Accounts.
 */
import { User, Branch } from '../types';

const STAFF_ALIASES_KEY = 'pos_staff_name_aliases';

/**
 * Normalizes a staff name by stripping any trailing employee ID tag
 * (e.g. "CHHON Sohoung (27631)" -> "CHHON Sohoung") and cleaning excess whitespace.
 */
export function normalizeStaffName(name?: string | null): string {
  if (!name) return '';
  return name.replace(/\s*\([A-Za-z0-9._-]+\)$/, '').trim();
}

/**
 * Extracts employee ID from string if embedded (e.g. "CHHON Sohoung (27631)" -> "27631")
 */
export function extractEmpIdFromName(name?: string | null): string | undefined {
  if (!name) return undefined;
  const match = name.match(/\(([A-Za-z0-9._-]+)\)$/);
  return match ? match[1].trim() : undefined;
}

/**
 * Deduplicates and cleans an array of staff names, returning unique base names in original order.
 */
export function deduplicateStaffList(list: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of list) {
    if (!item) continue;
    const clean = normalizeStaffName(item);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(clean);
    }
  }
  return result;
}

/**
 * Returns stored staff name aliases (e.g. when an admin updates a staff name in the directory).
 */
export function getStaffAliases(): Record<string, string> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STAFF_ALIASES_KEY) : null;
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      babe: 'Um Sovann Sokheng',
      'babe (11122)': 'Um Sovann Sokheng',
      ...parsed,
    };
  } catch {
    return {
      babe: 'Um Sovann Sokheng',
      'babe (11122)': 'Um Sovann Sokheng',
    };
  }
}

/**
 * Records an alias when a staff member's name is updated in the Staff Directory.
 */
export function saveStaffAlias(oldName: string, newName: string): void {
  if (!oldName || !newName || oldName.trim().toLowerCase() === newName.trim().toLowerCase()) return;
  try {
    const current = getStaffAliases();
    current[oldName.trim().toLowerCase()] = newName.trim();
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STAFF_ALIASES_KEY, JSON.stringify(current));
    }
  } catch (err) {
    console.error('Failed to save staff alias:', err);
  }
}

/**
 * Dynamically resolves any legacy or raw staff string to the current name in the Staff Directory.
 * Follows:
 * 1. Known staff aliases (e.g. "babe" -> "Um Sovann Sokheng")
 * 2. Embedded employee ID (e.g. "Babe (11122)" -> finds user 11122 -> "Um Sovann Sokheng")
 * 3. Exact empId or name match against active users directory
 */
export function resolveStaffFromDirectory(
  rawStaff?: string | null,
  branchId?: string | null,
  users?: User[] | null
): string {
  if (!rawStaff || !rawStaff.trim()) return '';
  const trimmed = rawStaff.trim();
  const normalized = normalizeStaffName(trimmed);
  const normalizedLower = normalized.toLowerCase();

  // 1. Check known aliases (e.g. "babe" -> "Um Sovann Sokheng")
  const aliases = getStaffAliases();
  if (aliases[normalizedLower]) {
    return aliases[normalizedLower];
  }
  if (aliases[trimmed.toLowerCase()]) {
    return aliases[trimmed.toLowerCase()];
  }

  // 2. Extract embedded empId if present (e.g. "Babe (11122)" -> "11122")
  const empId = extractEmpIdFromName(trimmed);
  if (empId && users && users.length > 0) {
    const match = users.find((u) => u.empId?.trim().toLowerCase() === empId.toLowerCase());
    if (match && match.name) {
      return normalizeStaffName(match.name);
    }
  }

  // 3. Match against users directory by empId or name
  if (users && users.length > 0) {
    // Exact match on empId
    const byEmpId = users.find((u) => u.empId && u.empId.trim().toLowerCase() === normalizedLower);
    if (byEmpId && byEmpId.name) return normalizeStaffName(byEmpId.name);

    // Exact match on name
    const byName = users.find((u) => normalizeStaffName(u.name).toLowerCase() === normalizedLower);
    if (byName && byName.name) return normalizeStaffName(byName.name);

    // Branch-scoped empId check
    if (branchId) {
      const branchUsers = users.filter((u) => String(u.branchId).trim() === String(branchId).trim() && u.status !== 'Suspended');
      for (const u of branchUsers) {
        if (u.empId && trimmed.includes(u.empId)) {
          return normalizeStaffName(u.name);
        }
      }
    }
  }

  return normalized;
}

export interface StaffDirectoryLookupResult {
  found: boolean;
  user?: User;
  resolvedName: string;
  empId?: string;
  branchId?: string;
  branchName?: string;
}

/**
 * Searches the Staff Directory and Branches to find a registered staff member.
 * Checks:
 * 1. Embedded EmpId in parenthesis (e.g. "KY Vibol (27267)" -> "27267")
 * 2. Exact match against user EmpId (e.g. "27267")
 * 3. Known aliases (e.g. "babe" -> "Um Sovann Sokheng")
 * 4. Exact match against user name (case-insensitive normalized)
 * 5. Username / contact / label
 * 6. Branch staff lists from Branch definitions
 */
export function lookupStaffInDirectory(
  rawStaff?: string | null,
  users?: User[] | null,
  branches?: Branch[] | null
): StaffDirectoryLookupResult {
  if (!rawStaff || !rawStaff.trim()) {
    return { found: false, resolvedName: '' };
  }
  const trimmed = rawStaff.trim();
  const normalized = normalizeStaffName(trimmed);
  const normalizedLower = normalized.toLowerCase();
  const trimmedLower = trimmed.toLowerCase();
  const embeddedEmpId = extractEmpIdFromName(trimmed);

  // 1. If embedded EmpId present, find in users by EmpId
  if (embeddedEmpId && users && users.length > 0) {
    const match = users.find((u) => u.empId?.trim().toLowerCase() === embeddedEmpId.toLowerCase());
    if (match) {
      return {
        found: true,
        user: match,
        resolvedName: normalizeStaffName(match.name),
        empId: match.empId,
        branchId: match.branchId,
        branchName: match.branchName,
      };
    }
  }

  // 2. Direct EmpId match in users
  if (users && users.length > 0) {
    const byEmpId = users.find((u) => u.empId && u.empId.trim().toLowerCase() === trimmedLower);
    if (byEmpId) {
      return {
        found: true,
        user: byEmpId,
        resolvedName: normalizeStaffName(byEmpId.name),
        empId: byEmpId.empId,
        branchId: byEmpId.branchId,
        branchName: byEmpId.branchName,
      };
    }
  }

  // 3. Known Aliases
  const aliases = getStaffAliases();
  const aliasResolved = aliases[trimmedLower] || aliases[normalizedLower];
  const targetNameLower = (aliasResolved || normalized).toLowerCase();

  // 4. Exact Name Match in users directory
  if (users && users.length > 0) {
    const byName = users.find(
      (u) =>
        normalizeStaffName(u.name).toLowerCase() === targetNameLower ||
        normalizeStaffName(u.name).toLowerCase() === normalizedLower
    );
    if (byName) {
      return {
        found: true,
        user: byName,
        resolvedName: normalizeStaffName(byName.name),
        empId: byName.empId,
        branchId: byName.branchId,
        branchName: byName.branchName,
      };
    }

    // 5. Username match
    const byUsername = users.find(
      (u) => u.username && u.username.trim().toLowerCase() === trimmedLower
    );
    if (byUsername) {
      return {
        found: true,
        user: byUsername,
        resolvedName: normalizeStaffName(byUsername.name),
        empId: byUsername.empId,
        branchId: byUsername.branchId,
        branchName: byUsername.branchName,
      };
    }
  }

  // 6. Branch staff lists from branches array
  if (branches && branches.length > 0) {
    for (const b of branches) {
      if (b.staffDetails && b.staffDetails.length > 0) {
        const detailMatch = b.staffDetails.find(
          (u) =>
            (embeddedEmpId && u.empId?.trim().toLowerCase() === embeddedEmpId.toLowerCase()) ||
            (u.empId && u.empId.trim().toLowerCase() === trimmedLower) ||
            normalizeStaffName(u.name).toLowerCase() === targetNameLower ||
            normalizeStaffName(u.name).toLowerCase() === normalizedLower
        );
        if (detailMatch) {
          return {
            found: true,
            user: detailMatch,
            resolvedName: normalizeStaffName(detailMatch.name),
            empId: detailMatch.empId,
            branchId: detailMatch.branchId || b.id,
            branchName: detailMatch.branchName || b.name,
          };
        }
      }

      if (b.staff && b.staff.length > 0) {
        const nameMatch = b.staff.find(
          (s) =>
            normalizeStaffName(s).toLowerCase() === targetNameLower ||
            normalizeStaffName(s).toLowerCase() === normalizedLower ||
            s.toLowerCase().includes(targetNameLower)
        );
        if (nameMatch) {
          return {
            found: true,
            resolvedName: normalizeStaffName(nameMatch),
            branchId: b.id,
            branchName: b.name,
          };
        }
      }
    }
  }

  return {
    found: false,
    resolvedName: normalized,
  };
}

export interface StaffBranchValidation {
  valid: boolean;
  resolvedStaffName: string;
  error?: string;
  matchedUser?: User;
}

/**
 * Validates that a staff exists in the Staff Directory AND matches the specified branch code.
 */
export function validateStaffWithBranch(
  rawStaff: string,
  targetBranch: Branch | undefined,
  users: User[],
  branches: Branch[]
): StaffBranchValidation {
  if (!rawStaff || !rawStaff.trim()) {
    return { valid: false, resolvedStaffName: '', error: 'Staff name cannot be blank.' };
  }

  const lookup = lookupStaffInDirectory(rawStaff, users, branches);
  if (!lookup.found) {
    return {
      valid: false,
      resolvedStaffName: normalizeStaffName(rawStaff),
      error: `Staff "${rawStaff}" does not exist in the Staff Directory. Please enter a valid registered staff name or Employee ID.`,
    };
  }

  if (targetBranch) {
    const staffBranchId = String(lookup.branchId || '').trim();
    const targetBranchId = String(targetBranch.id || targetBranch.code || '').trim();

    const isListedInBranchStaff = (targetBranch.staff || []).some(
      (s) => normalizeStaffName(s).toLowerCase() === lookup.resolvedName.toLowerCase()
    );

    const isBranchMatch = staffBranchId === targetBranchId || isListedInBranchStaff;

    if (!isBranchMatch) {
      const staffBranchObj = branches.find((b) => b.id === staffBranchId || b.code === staffBranchId);
      const staffBranchDisplay = staffBranchObj
        ? `${staffBranchObj.name} (Code ${staffBranchId})`
        : `Branch Code ${staffBranchId}`;
      const targetBranchDisplay = `${targetBranch.name} (Code ${targetBranch.id})`;

      return {
        valid: false,
        resolvedStaffName: lookup.resolvedName,
        matchedUser: lookup.user,
        error: `Staff "${lookup.resolvedName}"${lookup.empId ? ` (ID: ${lookup.empId})` : ''} is registered to ${staffBranchDisplay}, not ${targetBranchDisplay}. Assigned Staff and Branch Code must match the Staff Directory.`,
      };
    }
  }

  return {
    valid: true,
    resolvedStaffName: lookup.resolvedName,
    matchedUser: lookup.user,
  };
}

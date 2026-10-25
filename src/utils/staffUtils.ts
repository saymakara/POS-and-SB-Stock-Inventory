/**
 * Staff Name and Account Synchronization Utilities
 * Normalizes staff strings, strips legacy embedded employee IDs, deduplicates staff lists,
 * and dynamically resolves staff names to follow the Staff Directory & IAM Accounts.
 */
import { User } from '../types';

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

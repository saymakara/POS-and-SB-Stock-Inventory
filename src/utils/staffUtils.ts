/**
 * Staff Name and Account Synchronization Utilities
 * Normalizes staff strings, strips legacy embedded employee IDs, and deduplicates staff lists.
 */

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

/**
 * KPI Management Exemption Management
 * Allows administrators to explicitly define which staff members
 * belong to the Management Level and are exempt from mandatory frontline KPI requirements (0 target).
 *
 * Persisted in localStorage and synchronized across tabs & components via custom events.
 */

export interface ManagementExemptStaff {
  staffId: string;
  staffName: string;
  position?: string;
  branchId?: string;
  branchName?: string;
  addedAt?: string;
  addedBy?: string;
}

export const KPI_MANAGEMENT_EXEMPT_STORAGE_KEY = 'kpi_management_exempt_staff_v1';
export const KPI_MANAGEMENT_EXEMPT_EVENT = 'kpi_management_exempt_changed';

/**
 * Loads the defined list of management exempt staff.
 * Returns an empty array if none have been defined yet.
 */
export function getManagementExemptStaff(): ManagementExemptStaff[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KPI_MANAGEMENT_EXEMPT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Returns a Set of lower-cased staff IDs and names for O(1) exemption checks.
 */
export function getManagementExemptSet(): Set<string> {
  const list = getManagementExemptStaff();
  const set = new Set<string>();
  list.forEach((s) => {
    if (s.staffId) set.add(s.staffId.trim().toLowerCase());
    if (s.staffName) set.add(s.staffName.trim().toLowerCase());
  });
  return set;
}

/**
 * Saves the updated list of management exempt staff and broadcasts the change.
 */
export function saveManagementExemptStaff(list: ManagementExemptStaff[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KPI_MANAGEMENT_EXEMPT_STORAGE_KEY, JSON.stringify(list));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(KPI_MANAGEMENT_EXEMPT_EVENT, { detail: list }));
    }
  } catch (err) {
    console.error('Failed to save KPI management exempt staff:', err);
  }
}

/**
 * Adds a staff member to the management exemption list.
 */
export function addManagementExemptStaff(staff: ManagementExemptStaff): void {
  const current = getManagementExemptStaff();
  const exists = current.some(
    (s) =>
      (staff.staffId && s.staffId && s.staffId.trim().toLowerCase() === staff.staffId.trim().toLowerCase()) ||
      (staff.staffName && s.staffName && s.staffName.trim().toLowerCase() === staff.staffName.trim().toLowerCase())
  );
  if (!exists) {
    saveManagementExemptStaff([...current, staff]);
  }
}

/**
 * Removes a staff member from the management exemption list.
 */
export function removeManagementExemptStaff(staffIdOrName: string): void {
  const needle = staffIdOrName.trim().toLowerCase();
  const current = getManagementExemptStaff();
  const next = current.filter(
    (s) => s.staffId.trim().toLowerCase() !== needle && s.staffName.trim().toLowerCase() !== needle
  );
  saveManagementExemptStaff(next);
}

/**
 * Checks whether a specific staff member is explicitly defined as Management (Exempt).
 * Only staff explicitly added by the user/admin to the Management Exemption list will return true.
 */
export function isStaffManagementExempt(
  staffId?: string | null,
  staffName?: string | null,
  exemptSet?: Set<string>
): boolean {
  if (!staffId && !staffName) return false;
  const set = exemptSet || getManagementExemptSet();
  if (staffId && set.has(staffId.trim().toLowerCase())) return true;
  if (staffName && set.has(staffName.trim().toLowerCase())) return true;
  return false;
}

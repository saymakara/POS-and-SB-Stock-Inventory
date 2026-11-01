import { stampSecPP } from './time';

/**
 * (31 Oct 2026, UI standard) One way to write numbers everywhere on screen: thousands separator ("20,000", "8,571").
 * Not for codes (serials, MIDs, employee IDs, branch codes, years): those are shown exactly as stored.
 */
const nf = new Intl.NumberFormat('en-US');
export const fmtNum = (n: number | null | undefined): string => (n === null || n === undefined || Number.isNaN(n) ? '0' : nf.format(n));

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/**
 * (31 Oct 2026, UI standard) One way to show a date on screen: "31 Oct 2026, 14:05" (Phnom Penh time).
 * Takes the stored "2026-10-31 14:05:09" / "2026-10-31" text (already Phnom Penh time) or a full ISO time / Date.
 * For display only: sorting, CSV files and audit seals keep the stored text.
 */
export function showDateTime(v: string | Date | null | undefined, withSeconds = false): string {
  if (!v) return '—';
  let s = typeof v === 'string' ? v.trim() : '';
  const plain = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;
  if (!plain.test(s)) {
    const d = v instanceof Date ? v : new Date(s);
    if (Number.isNaN(d.getTime())) return String(v);
    s = stampSecPP(d);
  }
  const m = s.match(plain)!;
  const date = `${m[3]} ${MON[+m[2] - 1] || m[2]} ${m[1]}`;
  if (!m[4]) return date;
  return `${date}, ${m[4]}:${m[5]}${withSeconds && m[6] ? ':' + m[6] : ''}`;
}

/**
 * Ensures the branch name always includes the word "Branch" at the end.
 * E.g., "Tuek Thla" -> "Tuek Thla Branch", "Head Office" -> "Head Office Branch",
 * "Borei Keyla Branch" -> "Borei Keyla Branch".
 */
export function formatBranchName(name?: string | null): string {
  if (!name) return 'Unassigned';
  const clean = name.replace(/^Code\s+\d+\s*[·-]\s*/i, '').trim();
  if (!clean || clean.toLowerCase() === 'unassigned') return 'Unassigned';
  if (/^Branch\s+\d+/i.test(clean) || /\bbranch$/i.test(clean)) {
    return clean;
  }
  return `${clean} Branch`;
}

/**
 * Detects if a staff account or position belongs to the management level
 * (Branch Manager, Deputy Branch Manager, MS Supervisor, Team Lead, Unit Head, Admin).
 * Management level staff oversee operations and are exempt from mandatory frontline field KPIs.
 */
export function isManagementRole(position?: string | null, role?: string | null): boolean {
  if (role === 'SUPER_ADMIN' || role === 'ADMIN') return true;
  if (!position) return false;
  const p = position.trim().toLowerCase();
  return (
    p.includes('head') ||
    p.includes('manager') ||
    p.includes('supervisor') ||
    p.includes('team lead') ||
    p.includes('team-lead') ||
    p.includes('leader') ||
    p.includes('director') ||
    p.includes('admin') ||
    p.includes('management') ||
    p.includes('coordinator') ||
    /\b(bm|dbm|dm)\b/i.test(p)
  );
}

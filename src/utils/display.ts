/**
 * Small display helpers shared by the data tables (22 Oct 2026).
 */

/** True when the text contains Khmer letters (U+1780–U+17FF, U+19E0–U+19FF). */
export const hasKhmer = (s: string | null | undefined): boolean => /[ក-៿᧠-᧿]/.test(String(s || ''));

/** A merchant ID is 15 digits. Anything else (for example "1.00001E+14" from Excel) needs checking. */
export const isValidMid = (mid: string | null | undefined): boolean => /^\d{15}$/.test(String(mid || '').trim());

/** "1.00001E+14" and similar: a number Excel shortened, the real digits are lost. */
export const isExcelNumber = (v: string | null | undefined): boolean => /^\d+(\.\d+)?e\+\d+$/i.test(String(v || '').trim());

const parse = (d?: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '');
  return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
};

/** How long a unit was in service, counted from the two dates in years, months and days (never a stored figure). */
export function serviceLength(from?: string, to?: string): string {
  const a = parse(from), b = parse(to);
  if (!a || !b) return '—';
  if (Date.UTC(b.y, b.mo - 1, b.d) < Date.UTC(a.y, a.mo - 1, a.d)) return '—';
  let y = b.y - a.y, m = b.mo - a.mo, d = b.d - a.d;
  if (d < 0) {
    m -= 1;
    d += new Date(Date.UTC(b.y, b.mo - 1, 0)).getUTCDate();   // days in the month before the end date
  }
  if (m < 0) { y -= 1; m += 12; }
  if (y === 0 && m === 0 && d === 0) return 'Same day';
  const parts: string[] = [];
  if (y) parts.push(`${y} ${y === 1 ? 'year' : 'years'}`);
  if (m) parts.push(`${m} ${m === 1 ? 'month' : 'months'}`);
  if (d && !y) parts.push(`${d} ${d === 1 ? 'day' : 'days'}`);
  return parts.join(' ');
}

/** Title-case status text for chips (TERMINATED → Terminated). */
export const statusText = (s: string | null | undefined): string => {
  const t = String(s || '').toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '—';
};

/**
 * A merchant ID as its full digits (22 Oct 2026).
 * Excel often shows a long number as "6.26101900013633E+14". When all 15 digits are still there, they are restored
 * exactly ("626101900013633"); spaces, dashes and a trailing ".0" are removed. When Excel kept fewer digits
 * (for example "1.00001E+14") the real MID is lost: the text is returned unchanged so it is shown as needing a check,
 * never replaced by a guessed number.
 */
export function normalizeMid(v: string | number | null | undefined): string {
  let s = String(v ?? '').trim();
  if (!s) return '';
  s = s.replace(/[\s-]/g, '').replace(/\.0+$/, '');
  const m = /^(\d)(?:\.(\d+))?e\+?(\d+)$/i.exec(s);
  if (m) {
    const digits = m[1] + (m[2] || ''), exp = Number(m[3]);
    if (digits.length === exp + 1 || (digits.replace(/0+$/, '').length <= exp + 1 && digits.length >= 15)) {
      return (digits + '0'.repeat(Math.max(0, exp + 1 - digits.length))).slice(0, exp + 1);
    }
    return String(v).trim();                                           // digits lost: keep as is (shown as "check MID")
  }
  return s;
}

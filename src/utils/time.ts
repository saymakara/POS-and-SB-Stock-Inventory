/**
 * Dates and times in Phnom Penh (UTC+7), whatever the computer's own time zone (22 Oct 2026).
 * toISOString() is UTC: before 07:00 in Phnom Penh it gives yesterday's date – never use it for "today".
 */
const TZ = 'Asia/Phnom_Penh';
// (4 Nov 2026, speed) one formatter for the whole app: building a formatter costs ~0.1 ms, and this runs thousands of
// times per screen (KPI, dashboard, tables). Reused, the same 20,000 dates take 175 ms instead of 2,360 ms. Same output.
const PP_PARTS = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const intlParts = (d: Date) => {
  const p: Record<string, string> = {};
  PP_PARTS.formatToParts(d).forEach((x) => { p[x.type] = x.value; });
  if (p.hour === '24') p.hour = '00';
  return p;
};
// (23 Nov 2026, speed) Phnom Penh has been a fixed UTC+7 (no summer time) for decades, so the same parts come
// from plain arithmetic, ~15x faster than the formatter (the review lists and the Dashboard call this for every record).
// Dates before 1980 and invalid dates still go through the formatter, so the output (or the error) is exactly as before.
const PP_FIXED_FROM = Date.UTC(1980, 0, 1);
const PP_OFFSET_MS = 7 * 3600 * 1000;
const two = (n: number) => (n < 10 ? '0' + n : String(n));
const parts = (d: Date): Record<string, string> => {
  const t = d.getTime();
  if (!(t >= PP_FIXED_FROM) || t > 253402300799999) return intlParts(d);   // NaN, before 1980, after year 9999
  const s = new Date(t + PP_OFFSET_MS);
  return {
    year: String(s.getUTCFullYear()), month: two(s.getUTCMonth() + 1), day: two(s.getUTCDate()),
    hour: two(s.getUTCHours()), minute: two(s.getUTCMinutes()), second: two(s.getUTCSeconds()),
  };
};
/** "2026-10-22" */
export const todayPP = (d: Date = new Date()): string => { const p = parts(d); return `${p.year}-${p.month}-${p.day}`; };
/** "2026-10-22 14:05" */
export const stampPP = (d: Date = new Date()): string => { const p = parts(d); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`; };
/** "2026-10-22 14:05:09" */
export const stampSecPP = (d: Date = new Date()): string => { const p = parts(d); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`; };
/** "14:05:09" */
export const clockPP = (d: Date = new Date()): string => { const p = parts(d); return `${p.hour}:${p.minute}:${p.second}`; };
/** The months that end with this one: [{ key: '2026-10', label: 'Oct 2026' }, …] (oldest first). */
export function lastMonthsPP(n: number, d: Date = new Date()): { key: string; label: string }[] {
  const p = parts(d); let y = +p.year, m = +p.month; const out: { key: string; label: string }[] = [];
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (let i = 0; i < n; i++) { out.unshift({ key: `${y}-${String(m).padStart(2, '0')}`, label: `${names[m - 1]} ${y}` }); m--; if (!m) { m = 12; y--; } }
  return out;
}

const SHORT_MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** Shift a "YYYY-MM-DD" calendar day by `delta` days. */
export function addDaysYmd(ymd: string, delta: number): string {
  const t = Date.parse(`${ymd}T00:00:00Z`);
  if (Number.isNaN(t)) return ymd;
  return new Date(t + delta * 86400000).toISOString().slice(0, 10);
}

/** Signed calendar day difference (`toYmd - fromYmd`). */
export function diffDaysYmd(fromYmd: string, toYmd: string): number {
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

function fmtShortDayLabel(ymd: string): string {
  const [yy, mm, dd] = ymd.split('-').map(Number);
  if (!yy || !mm || !dd || mm < 1 || mm > 12) return ymd;
  return `${SHORT_MONTH_NAMES[mm - 1]} ${dd}`;
}

function fmtFullDayLabel(ymd: string): string {
  const [yy, mm, dd] = ymd.split('-').map(Number);
  if (!yy || !mm || !dd || mm < 1 || mm > 12) return ymd;
  return `${SHORT_MONTH_NAMES[mm - 1]} ${dd}, ${yy}`;
}

/** Human label for a single calendar date or inclusive "YYYY-MM-DD" date range. */
export function formatRangeLabelPP(fromYmd: string, toYmd: string, todayYmd: string = todayPP()): string {
  const a = fromYmd || todayYmd;
  const b = toYmd || a;
  const lo = a <= b ? a : b;
  const hi = a <= b ? b : a;
  if (lo === hi) {
    if (lo === todayYmd) return `Today · ${fmtShortDayLabel(lo)}`;
    if (lo === addDaysYmd(todayYmd, -1)) return `Yesterday · ${fmtShortDayLabel(lo)}`;
    return fmtFullDayLabel(lo);
  }
  if (lo.slice(0, 7) === hi.slice(0, 7)) {
    const [, mm, d1] = lo.split('-').map(Number);
    const [yy, , d2] = hi.split('-').map(Number);
    if (yy && mm >= 1 && mm <= 12) return `${SHORT_MONTH_NAMES[mm - 1]} ${d1} – ${d2}, ${yy}`;
  }
  if (lo.slice(0, 4) === hi.slice(0, 4)) {
    return `${fmtShortDayLabel(lo)} – ${fmtFullDayLabel(hi)}`;
  }
  return `${fmtFullDayLabel(lo)} – ${fmtFullDayLabel(hi)}`;
}

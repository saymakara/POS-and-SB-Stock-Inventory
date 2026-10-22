/**
 * Dates and times in Phnom Penh (UTC+7), whatever the computer's own time zone (22 Oct 2026).
 * toISOString() is UTC: before 07:00 in Phnom Penh it gives yesterday's date – never use it for "today".
 */
const TZ = 'Asia/Phnom_Penh';
const parts = (d: Date) => {
  const p: Record<string, string> = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    .formatToParts(d).forEach((x) => { p[x.type] = x.value; });
  if (p.hour === '24') p.hour = '00';
  return p;
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

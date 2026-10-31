import { csvFile } from './csv';
import { todayPP } from './time';

/**
 * (31 Oct 2026) "Export CSV" on the Phone App Review pages: every record that matches the filters on screen (all pages,
 * read from the server 1,000 at a time), saved as a CSV file Excel opens with Khmer text intact.
 */
export function downloadCsv(baseName: string, headers: string[], rows: unknown[][]): void {
  const url = URL.createObjectURL(csvFile([headers, ...rows]));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${baseName}_${todayPP()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Reads every page (`pageSize` rows each, 1,000 by default) until the last one; stops at `max` rows. */
export async function collectAll<T>(fetchPage: (page: number) => Promise<{ rows: T[]; total: number }>, pageSize = 1000, max = 200000): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= 1000; page++) {
    const res = await fetchPage(page);
    out.push(...res.rows);
    if (res.rows.length < pageSize || out.length >= res.total || out.length >= max) break;
  }
  return out.slice(0, max);
}

/** Phnom Penh date and time for a CSV cell ("2026-10-31 14:05"). */
export const csvTime = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p: Record<string, string> = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Phnom_Penh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(d).forEach((x) => { p[x.type] = x.value; });
  return `${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
};

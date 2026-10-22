/**
 * CSV / pasted-table reading that keeps empty fields and quoted values ("St 51, BKK1") (22 Oct 2026).
 * Accepts commas, tabs or semicolons (the first one found outside quotes in the first line), and Excel's BOM.
 */
export function detectDelimiter(firstLine: string): string {
  let q = false;
  for (const ch of firstLine) {
    if (ch === '"') q = !q;
    else if (!q && (ch === '\t' || ch === ',' || ch === ';')) return ch;
  }
  return ',';
}
export function parseCsv(text: string, delimiter?: string): string[][] {
  const src = String(text || '').replace(/^﻿/, '');
  const d = delimiter || detectDelimiter(src.split(/\r?\n/)[0] || '');
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"' && cell.trim() === '') { q = true; cell = ''; }
    else if (ch === d) { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell.trim()); cell = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}
/** One value for a CSV file (quoted; a leading = + - @ is neutralised so Excel never runs it as a formula). */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let s = String(value).replace(/\r?\n|\r/g, ' ').trim();
  // (review) also a leading tab / '|' and the full-width forms Excel accepts; plain negative numbers stay numbers
  if (/^[=+@\t|＝＋－＠]/.test(s) || (/^-/.test(s) && !/^-\d+(\.\d+)?$/.test(s))) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
/** A CSV file Excel opens with Khmer text intact (UTF-8 BOM, CRLF). */
export function csvFile(rows: unknown[][]): Blob {
  return new Blob(['﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
}

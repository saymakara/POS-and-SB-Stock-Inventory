/**
 * (25 Nov 2026, speed) The compact KPI summary (SQL 20261125_03_kpi_lite.sql, app.kpi_pack) turned back into the rows of
 * the full summary. Each packed list is { k: keys, n: names, r: rows as arrays }; staff_name / branch_name values are
 * the position of the name in n. A value the full row did not have comes as null and is left out again.
 * No other module is needed here, so this is checked on its own (tests/kpi_pack.test.ts).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function unpackKpiLists(d: any): any {
  if (!d || typeof d !== 'object' || !Array.isArray(d.packed)) return d;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any = { ...d };
  delete out.packed;
  for (const name of d.packed as string[]) {
    const p = d[name];
    if (!p || !Array.isArray(p.k) || !Array.isArray(p.r)) continue;
    const keys: string[] = p.k, names: string[] = Array.isArray(p.n) ? p.n : [];
    const nameCols = new Set(['staff_name', 'branch_name']);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    out[name] = p.r.map((row: any[]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const o: any = {};
      for (let i = 0; i < keys.length; i++) {
        const v = row[i];
        if (v === null || v === undefined) continue;                    // (a key the full row did not have)
        o[keys[i]] = nameCols.has(keys[i]) && typeof v === 'number' ? names[v] : v;
      }
      return o;
    });
  }
  return out;
}

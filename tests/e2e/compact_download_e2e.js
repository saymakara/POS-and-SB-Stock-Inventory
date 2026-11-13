// Compact stock download (13 Nov 2026, phase 2): the stock list read as arrays (public.devices_page_compact) must give
// exactly the same units as the table read, and the portal must fall back to the table read on a database without the
// function. Three sign-ins in fresh browsers: (a) OFFSET download (stand-in default), (b) serial ranges + table rows (database
// without migration 20261113_02), (c) serial ranges + compact arrays. The saved copy of the stock (every field of every unit,
// as the portal stores it) must be identical in all three. Run against a built dist/ on DIST_PORT (default 8500).
process.env.N_DEV = process.env.N_DEV || '4321';
const S = require('./lib/standin.js');
const { chromium, B, state, api, sleep, N_DEV } = S;
const PORT = process.env.DIST_PORT || '8500';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

async function signInAndRead(b, mode) {
  delete process.env.STANDIN_RANGES; delete process.env.STANDIN_COMPACT;
  if (mode !== 'offset') process.env.STANDIN_RANGES = '1';
  if (mode === 'compact') process.env.STANDIN_COMPACT = '1';
  state.compactCalls = 0;
  const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.route(B + '/**', api);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/index.html`);
  await p.waitForSelector('#empId', { state: 'visible' });
  await p.fill('#empId', '8986'); await p.fill('#pw', 'Secret123');
  state.calls.length = 0;
  await p.click('button[type=submit]');
  const shown = await p.waitForFunction((n) => document.body.innerText.replace(/,/g, '').includes(String(n)), N_DEV, { timeout: 60000 }).then(() => true).catch(() => false);
  ok(shown, `${mode}: the Dashboard shows all ${N_DEV} units`);
  const calls = state.calls.slice();
  // the saved copy (written in idle slices) is complete
  const read = () => p.evaluate(() => new Promise((res) => { const r = indexedDB.open('pos_sb_stock_inventory_db'); r.onsuccess = () => { const q = r.result.transaction(['devices'], 'readonly').objectStore('devices').getAll(); q.onsuccess = () => res(q.result); q.onerror = () => res([]); }; r.onerror = () => res([]); }));
  let saved = [];
  for (let k = 0; k < 120; k++) { saved = await read(); if (saved.length >= N_DEV) break; await sleep(500); }
  ok(saved.length === N_DEV, `${mode}: the saved copy holds all ${N_DEV} units (${saved.length})`);
  // a generated installed unit (merchant name with quotes, custom fields) and a unit still in stock read correctly
  const u = saved.find((d) => d.serial === 'WP100003');
  ok(!!u && u.merchantName === 'Merchant "3", St 3 #3' && u.mid === '200000000000003' && u.tid === '10000003' && u.stage === 'COMPLETE' && u.deployedDate === '2026-04-15', `${mode}: WP100003 has its merchant, MID, TID, stage and install date`);
  ok(!!u && u.customFields && u.customFields.installedByStaff === 'Staff 3' && u.rowVersion === 4 && u.history.length === 3, `${mode}: WP100003 keeps its custom fields, row version and history`);
  const h = saved.find((d) => d.serial === 'WP100000');
  ok(!!h && h.stage === 'HQ_STOCK' && h.mid === '' && h.merchantName === '' && h.branchId === '100', `${mode}: WP100000 (in stock) has no merchant and is at Head Office`);
  ok(errs.length === 0, `${mode}: no page errors (${errs.slice(0, 2).join(' | ')})`);
  await ctx.close();
  saved.sort((a, c) => (a.serial < c.serial ? -1 : 1));
  return { saved, calls, compactCalls: state.compactCalls };
}

(async () => {
  const b = await chromium.launch();
  const a = await signInAndRead(b, 'offset');
  const r = await signInAndRead(b, 'ranges');
  const c = await signInAndRead(b, 'compact');
  const tableRangeReads = (x) => x.calls.filter((k) => /^GET \/rest\/v1\/devices\?/.test(k) && /serial=gte\./.test(k)).length;
  ok(r.compactCalls === 1 && tableRangeReads(r) >= Math.ceil(N_DEV / 1000), `without the function: one try, then the table is read by ranges (${r.compactCalls} try, ${tableRangeReads(r)} range reads)`);
  ok(c.compactCalls >= Math.ceil(N_DEV / 1000) && tableRangeReads(c) === 0, `with the function: every range is read compactly (${c.compactCalls} compact reads, ${tableRangeReads(c)} table range reads)`);
  const fp = (x) => JSON.stringify(x.saved);
  ok(fp(a) === fp(r), 'ranges + table rows give exactly the same units as the OFFSET download');
  ok(fp(a) === fp(c), 'compact arrays give exactly the same units, field by field, as the OFFSET download');
  await b.close();
  console.log(fails ? `FAILED: ${fails}` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('HARNESS ' + e.message); process.exit(1); });

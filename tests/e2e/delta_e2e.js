// "Reload only what changed" (29 Oct 2026): after the first full load, a reload must ask the server only for changed units,
// merge them, and still show exactly the server's stock. Falls back to a full read when a unit was deleted. Run against a built
// dist/ served on DIST_PORT (default 8500). Never touches live data (stand-in API).
const { chromium, B, state, api, sleep, N_DEV } = require('./lib/standin.js');
const PORT = process.env.DIST_PORT || '8500';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const devCalls = () => state.calls.filter((c) => /\/rest\/v1\/devices/.test(c) && /^(GET|HEAD) /.test(c));
const fullPages = () => devCalls().filter((c) => /offset=\d+/.test(c) && !/updated_at=gte/.test(c));
const deltaCalls = () => devCalls().filter((c) => /updated_at=gte/.test(c));
const bytes = { n: 0 }; let measuring = true; const fresh = new WeakSet();

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.route(B + '/**', async (route) => { const r = route.request(); if (/\/rest\/v1\/devices/.test(r.url()) && r.method() === 'GET') { /* counted below */ } return api(route); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('request', (rq) => { if (measuring) fresh.add(rq); });
  p.on('response', async (res) => { try { if (/\/rest\/v1\/devices/.test(res.url()) && fresh.has(res.request())) { const buf = await res.body(); bytes.n += buf.length; } } catch (e) { /* ignore */ } });
  const showsCount = (n) => p.waitForFunction((x) => document.body.innerText.includes(x.toLocaleString('en-US')) || document.body.innerText.includes(String(x)), n, { timeout: 30000 }).then(() => true).catch(() => false);

  // 1. first visit: full load
  await p.goto(`http://127.0.0.1:${PORT}/index.html`); await sleep(1200);
  await p.fill('#empId', '8986'); await p.fill('#pw', 'Secret123');
  let t0 = Date.now(); state.calls.length = 0; bytes.n = 0;
  await p.click('button[type=submit]');
  ok(await showsCount(N_DEV), 'first visit shows all ' + N_DEV + ' units');
  const firstMs = Date.now() - t0;
  const savedCount = () => p.evaluate(() => new Promise((res) => { const r = indexedDB.open('pos_sb_stock_inventory_db'); r.onsuccess = () => { const c = r.result.transaction(['devices'], 'readonly').objectStore('devices').count(); c.onsuccess = () => res(c.result); c.onerror = () => res(0); }; r.onerror = () => res(0); }));
  for (let k = 0; k < 80 && (await savedCount()) < N_DEV; k++) await sleep(500);   // the saved copy is complete (written 1.5 s after the last change)
  await sleep(1500);
  ok(fullPages().length >= Math.ceil(N_DEV / 1000) - 1, `first visit reads the stock in pages (${fullPages().length} page requests, ${Math.round(bytes.n / 1048576)} MB, ${firstMs} ms to show the count)`);
  measuring = false; await sleep(200); measuring = true;

  // 2. reload with nothing changed on the server
  state.calls.length = 0; bytes.n = 0; t0 = Date.now();
  await p.reload(); 
  ok(await showsCount(N_DEV), 'reload shows all ' + N_DEV + ' units');
  const reloadMs = Date.now() - t0; await sleep(1500);
  console.log(`INFO reload (nothing changed): ${reloadMs} ms, device requests ${devCalls().length}, ${(bytes.n / 1024).toFixed(0)} KB`);
  ok(fullPages().length === 0, 'reload does NOT read the whole stock again (' + fullPages().length + ' page requests)');
  ok(deltaCalls().length >= 1, 'reload asks only for changed units (' + deltaCalls().length + ' request)');
  ok(bytes.n < 200 * 1024, 'reload downloads little (' + (bytes.n / 1024).toFixed(0) + ' KB)');

  // 3. another person changes one unit and adds one; a reload must show both
  const nowIso = new Date().toISOString().replace('Z', '000+00:00');
  const d5 = state.devices.find((x) => x.serial === 'WP100005');
  Object.assign(d5, { merchant_name: 'Changed By Someone Else', row_version: (d5.row_version || 1) + 1, updated_at: nowIso });
  state.devices.push(Object.assign({}, state.devices[0], { serial: 'WPNEW0001', row_version: 1, updated_at: nowIso, stage: 'HQ_STOCK', branch_id: '100', mid: null, tid: null, merchant_name: null }));
  state.calls.length = 0; bytes.n = 0;
  await p.reload();
  ok(await showsCount(N_DEV + 1), 'after a reload the new unit is counted: ' + (N_DEV + 1));
  await sleep(1200);
  ok(fullPages().length === 0 && deltaCalls().length >= 1, `changes arrived by the changed-only read (${deltaCalls().length} delta, ${fullPages().length} full pages, ${(bytes.n / 1024).toFixed(0)} KB)`);
  await p.getByText('Stock Inventory', { exact: true }).first().click(); await sleep(600);
  const box = p.locator('input[placeholder^="Search Serial SN"]');
  await box.fill('WPNEW0001'); await sleep(900);
  ok(/WPNEW0001/.test(await p.textContent('body')), 'the unit added by someone else is found by search');
  await box.fill('WP100005'); await sleep(900);
  ok(/Changed By Someone Else/.test(await p.textContent('body')), 'the unit changed by someone else shows the new merchant name');

  // 4. a unit is deleted on the server while this browser was closed: the count no longer matches -> full read, exact stock
  await sleep(2500);
  state.devices = state.devices.filter((x) => x.serial !== 'WP100010' && x.serial !== 'WP100011');
  state.calls.length = 0;
  await p.reload();
  ok(await showsCount(N_DEV - 1), 'after deletions the stock shows ' + (N_DEV - 1));
  await sleep(5000);
  ok(fullPages().length >= Math.ceil(N_DEV / 1000) - 1, 'a count mismatch falls back to the full read (' + fullPages().length + ' pages)');
  await box.fill('WP100010').catch(() => {}); 
  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();

// (26 Nov 2026) POS / Sound Box review reads its list WITHOUT each record's full app entry (lighter), and reads the full
// entry of one record when it is opened or edited. Usage: build (stand-in URL), serve dist on :8500, then node field_slim_e2e.js
process.env.N_DEV = process.env.N_DEV || '500';
const S = require('./lib/standin.js');
const { chromium, B, sleep } = S;
let fails = 0; const ok = (c, m, x) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== undefined && !c ? ' ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const ev = S.state.events.filter((e) => e.device_type === 'POS Terminal' && e.status === 'PENDING').sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)))[0];
const KEY = ev.mid;
ev.payload = { entry: { request_type: 'New Installation', details: [{ k: 'SIM Card', v: '1' }, { k: 'Charging Dock', v: 'N/a' }], checks: { power: 'OK' }, remarks: 'x'.repeat(400) },
  unit: { serial_input: 'SCAN', mid_input: 'TYPED' } };
const openBtn = () => P.locator('main').getByText(KEY, { exact: false }).first().locator('xpath=ancestor::*[.//button[@aria-expanded]][1]').locator('button[aria-expanded]').first();
let P;
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const reads = [];
  await ctx.route(B + '/**', async (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === '/rest/v1/field_events') reads.push({ select: u.searchParams.get('select') || '', id: u.searchParams.get('id') || '' });
    return S.api(r);
  });
  const p = await ctx.newPage(); P = p;
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8500/index.html');
  await p.waitForSelector('#empId'); await p.fill('#empId', '8986'); await p.fill('#pw', 'Secret123');
  await p.click('button[type=submit]'); await p.waitForFunction(() => /Executive/.test(document.body.innerText)); await sleep(1500);
  reads.length = 0;
  const side = p.locator('aside');
  await side.getByRole('group', { name: 'Merchant App Review sections' }).getByRole('button', { name: /^POS Terminal/ }).click(); await sleep(2000);
  const listReads = reads.filter((x) => !x.id && /source_record_id/.test(x.select));
  ok(listReads.length > 0 && listReads.every((x) => !/(^|,)payload(,|$)/.test(x.select) && /p_unit:payload->unit/.test(x.select)), 'the list is read without the full app entry (only request type + device part)', listReads.map((x) => x.select.slice(-80)));
  const body = await p.textContent('main');
  ok(body.includes(KEY), 'the list shows the records as before', body.slice(0, 300));
  // open the record -> its full entry is read once and its details show
  reads.length = 0;
  await openBtn().click(); await sleep(1500);
  const one = reads.filter((x) => x.id === 'eq.' + ev.id);
  ok(one.length === 1 && /(^|,)payload(,|$)/.test(one[0].select), 'opening a record reads its full entry once (one small read)', reads);
  const opened = await p.textContent('main');
  ok(/SIM Card: 1/.test(opened) && /Charging Dock: N\/a/.test(opened), 'its details (from the full entry) are shown', opened.slice(0, 200));
  // close and open again: no second read
  reads.length = 0;
  await openBtn().click(); await sleep(400);
  await openBtn().click(); await sleep(800);
  ok(reads.filter((x) => x.id === 'eq.' + ev.id).length === 0, 'opened again: no second read (kept)');
  // Edit (admin) shows the details from the full entry, with no extra read
  reads.length = 0;
  await p.locator('main [data-testid=edit-record]').first().click(); await sleep(800);
  const dlg = await p.locator('[role=dialog]').last().textContent().catch(() => '');
  ok(/SIM Card/.test(dlg || ''), 'Edit shows the detail fields from the full entry', (dlg || '').slice(0, 300));
  ok(reads.filter((x) => x.id === 'eq.' + ev.id).length === 0, 'Edit after opening needs no extra read');
  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();

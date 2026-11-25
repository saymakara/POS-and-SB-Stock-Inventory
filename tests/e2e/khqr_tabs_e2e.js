// (25 Nov 2026) KHQR: switching views (entries / failed / wrong / same MID) shows no loading placeholder and asks the
// database nothing once a view was opened; Same MID has a select-all box in its header. Run like the other e2e tests.
process.env.N_DEV = '2000';
const S = require(process.cwd() + '/tests/e2e/lib/standin.js');
const shared = [{ day: '2026-11-20', mid: '126112013081700', merchant_name: 'NGET SAL', staff_count: 2, entries: 2, branches: 'A, B', first_at: '2026-11-20T06:11:00Z', last_at: '2026-11-20T14:52:00Z',
  items: [{ record_id: 'QR-1', staff_id: '1', staff_name: 'A', branch: 'Toul Kork', activity: 'QR_INSTALL', qr: 2, at: '2026-11-20T06:11:00Z' }, { record_id: 'QR-2', staff_id: '2', staff_name: 'B', branch: 'Toul Kork', activity: 'QR_INSTALL', qr: 2, at: '2026-11-20T14:52:00Z' }] },
  { day: '2026-11-19', mid: '125021410540200', merchant_name: 'EAN', staff_count: 2, entries: 2, branches: 'C', first_at: '2026-11-19T08:12:00Z', last_at: '2026-11-19T10:02:00Z',
  items: [{ record_id: 'QR-3', staff_id: '3', staff_name: 'C', branch: 'Toul Kork', activity: 'QR_INSTALL', qr: 2, at: '2026-11-19T08:12:00Z' }, { record_id: 'QR-4', staff_id: '4', staff_name: 'D', branch: 'Toul Kork', activity: 'QR_INSTALL', qr: 2, at: '2026-11-19T10:02:00Z' }] }];
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await S.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  let reqs = []; let delay = 0;
  await ctx.route(S.B + '/**', async (r) => { const u = r.request().url(); reqs.push(u.split('?')[0].split('/').pop());
    if (delay) await S.sleep(delay);
    if (/qr_shared_mids/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(shared) });
    return S.api(r); });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8500/index.html');
  await p.waitForSelector('#empId'); await p.fill('#empId', '8986'); await p.fill('#pw', 'Secret123');
  await p.click('button[type=submit]'); await p.waitForFunction(() => /Executive/.test(document.body.innerText)); await S.sleep(1500);
  await p.locator('aside, nav').getByRole('button', { name: /^KHQR/ }).first().click(); await S.sleep(2500);
  delay = 600;
  const tab = (n) => p.getByRole('tab', { name: new RegExp('^' + n) });
  // visit each view once
  for (const t of ['Failed attempts', 'Wrong scans', 'Same MID', 'KHQR entries']) { await tab(t).click(); await S.sleep(1400); }
  // now switch around and watch for loading placeholders / requests
  let flicker = 0; reqs = [];
  for (const t of ['Failed attempts', 'Wrong scans', 'Same MID', 'KHQR entries', 'Wrong scans', 'Failed attempts', 'KHQR entries']) {
    await tab(t).click();
    for (let k = 0; k < 8; k++) { const n = await p.evaluate(() => [...document.querySelectorAll('main [aria-busy="true"], main .skeleton')].filter((e) => e.offsetParent !== null).length); if (n) flicker++; await S.sleep(40); }
  }
  ok(flicker === 0, 'switching between visited views: no loading placeholder at any moment (' + flicker + ' samples with one)');
  ok(reqs.filter((u) => /qr_attempts|qr_installations|qr_shared_mids/.test(u)).length === 0, 'switching between visited views: no new database request (' + reqs.join(',') + ')');
  // select all in Same MID
  await tab('Same MID').click(); await S.sleep(300);
  const sec = p.locator('[aria-label="Same MID by two or more staff"]');
  const head = sec.getByRole('button', { name: 'Select all shown' });
  ok(await head.isVisible(), 'Same MID: "select all" box in the header');
  await head.click(); await S.sleep(300);
  const bar = await p.textContent('body');
  ok(/4\s*Selected/i.test(bar) || /4 KHQR entries/i.test(bar), 'select all ticks every entry of every group shown (4)');
  ok(await sec.getByRole('button', { name: 'Unselect all shown' }).isVisible(), 'header box now unselects all');
  await sec.getByRole('button', { name: 'Unselect all shown' }).click(); await S.sleep(200);
  ok(!/4\s*Selected/i.test(await p.textContent('body')), 'unselect all clears the selection');
  
  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  await b.close(); process.exit(fails ? 1 : 0);
})();

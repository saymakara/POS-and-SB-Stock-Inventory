// (20 Nov 2026) The sign-in kept by this browser disappears without a "signed out" notice in this tab (another tab or
// another page on the same github.io address clears it). The portal must go back to the sign-in page with a message,
// not stay on "Loading…" sending requests that are refused. Run against a built dist/ served on 127.0.0.1:8500.
const S = require('./lib/standin.js');
const { chromium, sleep, B } = S;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const URL0 = 'http://127.0.0.1:' + (process.env.DIST_PORT || '8500') + '/index.html';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(B + '/**', S.api);
  const p = await ctx.newPage();
  await p.goto(URL0);
  await p.waitForSelector('#empId', { state: 'visible' });
  await p.fill('#empId', '8986'); await p.fill('#pw', 'Secret123'); await p.click('button[type=submit]');
  await p.waitForFunction(() => /Dashboard/.test(document.body.innerText), null, { timeout: 30000 }); await sleep(1000);
  ok(await p.evaluate(() => Object.keys(localStorage).some((k) => /^sb-.+-auth-token$/.test(k))), 'signed in: the sign-in is kept in this browser');

  // 1. another tab clears the kept sign-in only (no sign-out sent to the server)
  const p2 = await ctx.newPage(); await p2.goto(URL0 + '#other');
  await p2.evaluate(() => Object.keys(localStorage).filter((k) => /^sb-.+-auth-token$/.test(k)).forEach((k) => localStorage.removeItem(k)));
  const back = await p.waitForSelector('#empId', { state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
  ok(back, 'first tab returns to the sign-in page by itself');
  ok(/signed out on this browser/i.test(await p.locator('[role=alert]').first().innerText().catch(() => '')), 'it says why');
  await p2.close();

  // 2. signed in again; the whole storage is cleared by another page on the same address
  await p.fill('#empId', '8986'); await p.fill('#pw', 'Secret123'); await p.click('button[type=submit]');
  await p.waitForFunction(() => /Dashboard/.test(document.body.innerText), null, { timeout: 30000 }); await sleep(800);
  ok(!(await p.isVisible('#empId')), 'signed in again: the dashboard is shown');
  const p3 = await ctx.newPage(); await p3.goto(URL0 + '#other2');
  await p3.evaluate(() => localStorage.clear());
  ok(await p.waitForSelector('#empId', { state: 'visible', timeout: 5000 }).then(() => true).catch(() => false), 'storage cleared elsewhere: back to the sign-in page');
  await p3.close();

  // 3. a normal session is not disturbed: tab hidden and shown again, focus, with the sign-in still kept
  await p.fill('#empId', '8986'); await p.fill('#pw', 'Secret123'); await p.click('button[type=submit]');
  await p.waitForFunction(() => /Dashboard/.test(document.body.innerText), null, { timeout: 30000 }); await sleep(800);
  await p.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
  await sleep(1500);
  ok(!(await p.isVisible('#empId')) && /Dashboard/.test(await p.evaluate(() => document.body.innerText)), 'still signed in: the page stays');
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

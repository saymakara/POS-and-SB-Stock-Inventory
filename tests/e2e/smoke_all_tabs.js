// Smoke test (03 Nov 2026 audit): the sign-in screen must not download the heavy chart / animation libraries, and after
// sign-in every main tab must open without a page error or a console error. Charts must still render where used.
// Run against a built dist/ served on 127.0.0.1:${DIST_PORT:-8500} (node tests/e2e/serve-dist.cjs). Never touches live data (stand-in API).
const { chromium, B, api, sleep } = require('./lib/standin.js');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
// the sandbox cannot open the live-update socket; that message is about the test environment, not the app
const IGNORE = /WebSocket connection to .*realtime|Failed to load resource|ERR_TUNNEL|net::ERR/;
// (5 Nov 2026) Push Configuring is a tab of Stock Inventory → POS Terminal / Sound Box (checked in materials_e2e.js)
const TABS = ['Dashboard', 'KPI Performance', 'Merchant Deployment', 'Merchant History', 'Stock Inventory',
  'Stock Requests', 'Branch Codes', 'Staff Directory', 'Audit Trail', 'Settings'];

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.route(B + '/**', api);
  const p = await ctx.newPage();
  const pageErrors = []; const consoleErrors = []; const scripts = [];
  p.on('pageerror', (e) => pageErrors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) consoleErrors.push(m.text()); });
  p.on('request', (r) => { if (/\.js(\?|$)/.test(r.url())) scripts.push(r.url().split('/').pop()); });

  await p.goto('http://127.0.0.1:' + (process.env.DIST_PORT || '8500') + '/index.html');
  await p.waitForSelector('#empId', { state: 'visible' });
  const atSignIn = scripts.slice();
  ok(!atSignIn.some((s) => /vendor-charts/.test(s)), 'sign-in screen does not load the chart library (' + atSignIn.length + ' scripts)');
  ok(!atSignIn.some((s) => /vendor-motion/.test(s)), 'sign-in screen does not load the animation library before the field is shown');

  await p.fill('#empId', '8986'); await p.fill('#pw', 'Secret123'); await p.click('button[type=submit]');
  await p.waitForFunction(() => /Dashboard/.test(document.body.innerText), null, { timeout: 30000 });
  await sleep(1500);

  const chartTabs = [];
  for (const label of TABS) {
    const before = pageErrors.length + consoleErrors.length;
    const link = p.locator('aside, nav').getByText(label, { exact: true }).first();
    if (!(await link.count())) { ok(false, 'menu entry "' + label + '" found'); continue; }
    await link.click(); await sleep(1200);
    const after = pageErrors.length + consoleErrors.length;
    const crashed = await p.locator('text=/Something went wrong|could not be shown/i').count();
    ok(after === before && crashed === 0, 'tab "' + label + '" opens without errors' + (after > before ? ': ' + [...pageErrors, ...consoleErrors].slice(before).join(' | ').slice(0, 200) : ''));
    if (label === 'KPI Performance' || label === 'Merchant Deployment') {
      // these two tabs use Recharts: the on-demand chart chunk must arrive and the tab must not fall back to an error
      await p.waitForFunction(() => performance.getEntriesByType('resource').some((r) => /vendor-charts/.test(r.name)), null, { timeout: 10000 }).catch(() => {});
      chartTabs.push(label + ': ' + (await p.locator('.recharts-wrapper, .recharts-responsive-container').count()) + ' chart containers');
    }
  }
  ok(scripts.some((s) => /vendor-charts/.test(s)), 'chart library loaded on demand by the chart tabs (' + chartTabs.join('; ') + ')');
  ok(scripts.some((s) => /vendor-motion/.test(s)), 'animation library is loaded with the dashboard (MotionConfig still applied)');
  ok(pageErrors.length === 0, 'no uncaught page errors (' + pageErrors.length + ')');
  ok(consoleErrors.length === 0, 'no console errors (' + consoleErrors.length + ')' + (consoleErrors.length ? ': ' + consoleErrors.slice(0, 3).join(' | ').slice(0, 300) : ''));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

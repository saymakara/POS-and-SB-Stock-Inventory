// (7 Nov 2026) POS Terminal / Sound Box: Units ⇄ Push Configuring ⇄ Material switch smoothly. Watched on every animation
// frame: always exactly one view on screen (no blank moment, no two views), the switch itself never disappears, the page
// never collapses (no jump), the highlight glides; a view opened before comes back without being built again.
// Run against a built dist/ served on 127.0.0.1:8500 (node tests/e2e/serve-dist.cjs), stand-in API, no live data.
const S = require('./lib/standin.js');
const { chromium, sleep, B } = S;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const IGNORE = /WebSocket connection to .*realtime|Failed to load resource|ERR_TUNNEL|net::ERR|materials|404/;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(B + '/**', S.api);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errs.push(m.text()); });
  await p.goto('http://127.0.0.1:' + (process.env.DIST_PORT || '8500') + '/index.html');
  await p.waitForSelector('#empId', { state: 'visible' });
  await p.fill('#empId', '8986'); await p.fill('#pw', 'Secret123'); await p.click('button[type=submit]');
  await p.waitForFunction(() => /Dashboard/.test(document.body.innerText), null, { timeout: 30000 }); await sleep(1500);
  for (const prod of ['POS Terminal', 'Sound Box']) {
    await p.locator('aside').first().getByRole('group', { name: 'Stock Inventory sections' }).getByRole('button', { name: new RegExp('^' + prod) }).click();
    await sleep(1500);
    await p.evaluate(() => window.scrollTo(0, 420)); await sleep(200);
    const seq = ['Push Configuring', 'Material', 'Units', 'Push Configuring', 'Units', 'Material', 'Units'];
    for (let i = 0; i < seq.length; i++) {
      const name = seq[i];
      const r = await p.evaluate(async (name) => {
        const vis = (e) => !!e && e.offsetParent !== null && e.getBoundingClientRect().height > 0;
        const frames = []; let on = true; const y0 = window.scrollY;
        const tick = () => { const panels = [...document.querySelectorAll('main [role="tabpanel"]')].filter(vis).length;
          const lists = [...document.querySelectorAll('main [role="tablist"]')].filter((l) => vis(l) && /Units/.test(l.textContent)).length;
          frames.push({ panels, lists, h: document.documentElement.scrollHeight, y: window.scrollY }); if (on) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        await new Promise((r) => requestAnimationFrame(r));
        const tab = [...document.querySelectorAll('main [role="tab"]')].find((t) => vis(t) && t.textContent.trim().startsWith(name));
        const pill = tab.parentElement.querySelector('[aria-hidden].absolute');
        const t0 = performance.now(); tab.click(); const tClick = performance.now() - t0;
        await new Promise((r) => setTimeout(r, 120));
        const pillAnimating = [...document.querySelectorAll('main [role="tablist"]')].some((l) => vis(l) && [...l.querySelectorAll('[aria-hidden]')].some((x) => x.getAnimations().length));
        await new Promise((r) => setTimeout(r, 600)); on = false;
        const sel = [...document.querySelectorAll('main [role="tab"][aria-selected="true"]')].find(vis);
        return { tClick: Math.round(tClick), pillAnimating, minPanels: Math.min(...frames.map((f) => f.panels)), maxPanels: Math.max(...frames.map((f) => f.panels)),
          minLists: Math.min(...frames.map((f) => f.lists)), yJump: Math.max(...frames.map((f) => Math.abs(f.y - y0))), selected: sel && sel.textContent.trim(), n: frames.length };
      }, name);
      if (process.env.DBG) console.log(JSON.stringify(r));
      const again = i >= 3;
      ok(r.minPanels === 1 && r.maxPanels === 1, `${prod}: → ${name}: exactly one view on screen in every frame (${r.n} frames)`);
      ok(r.minLists === 1, `${prod}: → ${name}: the Units / Push / Material switch stays on screen`);
      ok(r.yJump <= 2, `${prod}: → ${name}: the page does not jump (scroll moved ${r.yJump}px)`);
      ok(r.selected && r.selected.startsWith(name) && r.pillAnimating, `${prod}: → ${name}: selected, highlight glides`);
      if (again) ok(r.tClick < 120, `${prod}: → ${name} again: shown without rebuilding (${r.tClick} ms)`);
    }
  }
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
  console.log(fails ? 'FAILED ' + fails : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('HARNESS ' + e.message); process.exit(2); });

// Performance measurement of the portal (13 Nov 2026): the same steps before and after a change, at a realistic stock
// size (N_DEV, default 27,649 like the live database) and at laptop / phone speed (CPU 4x slower, CPU env to change).
// Measures: time from Sign in to a ready dashboard (all stock loaded), every main screen switch (time to its content and
// the longest frozen moment), tap reaction (Event Timing, like Google's INP) and dropped frames while switching.
// Run against a built dist/ served on 127.0.0.1:${DIST_PORT:-8500}. Output: one JSON line (PERF {...}) plus a table.
process.env.N_DEV = process.env.N_DEV || '27649';
const S = require('./lib/standin.js');
const { chromium, B, sleep } = S;
const CPU = Number(process.env.CPU || 4);
const TABS = process.env.TABS ? process.env.TABS.split(',') : ['Dashboard', 'KPI Performance', 'Merchant Deployment', 'Merchant History', 'Stock Inventory', 'Stock Requests', 'Branch Codes', 'Staff Directory', 'Audit Trail', 'Settings'];

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  let bytes = 0, reqs = 0;
  await ctx.route(B + '/**', async (route) => { reqs++; return S.api(route); });
  const p = await ctx.newPage();
  p.on('response', async (r) => { try { if (r.url().startsWith(B)) { const body = await r.body(); bytes += body.length; } } catch (e) { /* streamed */ } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => {
    window.__lt = []; window.__ev = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push({ s: Math.round(e.startTime), d: Math.round(e.duration) }))).observe({ type: 'longtask', buffered: true });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (/pointer|click|key/.test(e.name)) window.__ev.push(Math.round(e.duration)); })).observe({ type: 'event', durationThreshold: 16, buffered: true });
  });
  const cdp = await ctx.newCDPSession(p); await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  const t0 = Date.now();
  await p.goto('http://127.0.0.1:' + (process.env.DIST_PORT || '8500') + '/index.html');
  await p.waitForSelector('#empId', { state: 'visible', timeout: 60000 });
  const signinReady = Date.now() - t0;
  await p.fill('#empId', '8986'); await p.fill('#pw', 'Secret123');
  bytes = 0; reqs = 0;
  const t1 = Date.now(); await p.evaluate(() => { window.__lt = []; });
  await p.click('button[type=submit]');
  await p.waitForFunction(() => /Dashboard/.test(document.body.innerText), null, { timeout: 60000 });
  const shell = Date.now() - t1;
  // ready: the stock numbers show the full count (all units loaded)
  await p.waitForFunction((n) => document.body.innerText.replace(/,/g, '').includes(String(n)), Number(process.env.N_DEV), { timeout: 120000 }).catch(() => {});
  const ready = Date.now() - t1;
  await sleep(Number(process.env.SETTLE_MS || 1500));   // SETTLE_MS: let background work (the first save of the stock copy) finish first
  const ltSign = await p.evaluate(() => window.__lt.splice(0));
  const signBytes = bytes, signReqs = reqs;
  const tabs = [];
  for (const label of TABS) {
    const link = p.locator('aside, nav').getByText(label, { exact: true }).first();
    if (!(await link.count())) continue;
    await sleep(600); await p.evaluate(() => { window.__lt = []; window.__ev = []; window.__fr = []; let last = performance.now(); const f = (t) => { window.__fr.push(t - last); last = t; if (window.__fr.length < 120) requestAnimationFrame(f); }; requestAnimationFrame(f); });
    const ts = Date.now(); await link.click();
    // content: the main area shows something new and the "loading" placeholders are gone
    await p.waitForFunction(() => !document.querySelector('main .skeleton, main [aria-busy="true"]'), null, { timeout: 15000 }).catch(() => {});
    const t = Date.now() - ts; await sleep(1200);
    const r = await p.evaluate(() => ({ lt: window.__lt.map((x) => x.d), ev: window.__ev.slice(), fr: window.__fr.slice() }));
    tabs.push({ tab: label, ms: t, worstFreeze: Math.max(0, ...r.lt), freezeTotal: r.lt.reduce((a, c) => a + c, 0), tapToPaint: Math.max(0, ...r.ev), droppedFrames: r.fr.filter((x) => x > 34).length });
  }
  const out = { cpu: CPU, devices: Number(process.env.N_DEV), signinPage: signinReady, shellAfterSignIn: shell, readyAfterSignIn: ready, signInLongTasksTotal: ltSign.reduce((a, c) => a + c.d, 0),
    signInWorstFreeze: Math.max(0, ...ltSign.map((x) => x.d)), signInRequests: signReqs, signInKB: Math.round(signBytes / 1024), tabs, errors: errs.length };
  console.log('PERF ' + JSON.stringify(out));
  console.log('sign-in page ' + signinReady + ' ms | shell ' + shell + ' ms | all stock ready ' + ready + ' ms | frozen total ' + out.signInLongTasksTotal + ' ms (worst ' + out.signInWorstFreeze + ') | ' + signReqs + ' requests, ' + out.signInKB + ' KB');
  for (const x of tabs) console.log(x.tab.padEnd(22) + String(x.ms).padStart(6) + ' ms  worst freeze ' + String(x.worstFreeze).padStart(4) + '  total ' + String(x.freezeTotal).padStart(5) + '  tap ' + String(x.tapToPaint).padStart(4) + '  dropped frames ' + x.droppedFrames);
  await b.close();
})().catch((e) => { console.log('HARNESS ' + e.message); process.exit(1); });

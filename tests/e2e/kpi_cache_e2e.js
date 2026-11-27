// (26 Nov 2026) KPI figures: kept on screen when someone else changes data (refreshed in the background, no loading
// state), saved on disk for the signed-in person so a new tab shows today's figures at once, and deleted on sign-out.
// Usage: build (stand-in URL), serve dist on :8500, then node kpi_cache_e2e.js
process.env.N_DEV = process.env.N_DEV || '300';
const S = require('./lib/standin.js');
const { chromium, B, sleep } = S;
let fails = 0; const ok = (c, m, x) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== undefined && !c ? ' ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const days = (from, to) => { const out = []; for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10)); return out; };
const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const summary = () => {
  const ds = days('2026-10-01', today);
  return {
    rules: [], targets: {}, staff: [{ staff_id: '20001', staff_name: 'STAFF Number1', branch_id: '101', branch_name: 'Branch 101', khqr_install: 3 }],
    daily: ds.map((d) => ({ period: d, khqr_install: 2, active_staff: 1, active_branches: 1 })), weekly: [], quarterly: [],
    monthly: [{ period: today.slice(0, 7), khqr_install: 40, active_staff: 1, active_branches: 1 }],
    monthly_staff: [{ month: today.slice(0, 7), staff_id: '20001', staff_name: 'STAFF Number1', branch_id: '101', branch_name: 'Branch 101', khqr_install: 40 }],
    daily_staff: ds.map((d) => ({ day: d, staff_id: '20001', staff_name: 'STAFF Number1', branch_id: '101', branch_name: 'Branch 101', total_tasks: 2, khqr_tasks: 2 })),
    daily_branch: ds.map((d) => ({ day: d, branch_id: '101', total_tasks: 2, khqr_tasks: 2, active_staff: 1 })),
    daily_from: '2026-10-01',
  };
};
const net = { calls: 0, delay: 0 };
const route = async (r) => {
  const u = new URL(r.request().url());
  const send = async (body) => { if (net.delay) await sleep(net.delay); return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) }).catch(() => {}); };
  if (u.pathname === '/rest/v1/rpc/kpi_dashboard_summary_lite') { net.calls++; return send(summary()); }
  if (u.pathname === '/rest/v1/rpc/kpi_dashboard_staff_slice_lite') { net.calls++; const s = summary(); return send({ rules: s.rules, targets: s.targets, staff: s.staff }); }
  return S.api(r);
};
const idbHas = (p) => p.evaluate(async () => {
  const dbs = indexedDB.databases ? await indexedDB.databases() : [];
  if (!dbs.some((d) => d.name === 'portal_figures_v1')) return false;
  return new Promise((res) => { const q = indexedDB.open('portal_figures_v1'); q.onsuccess = () => { try { const g = q.result.transaction('kv').objectStore('kv').get('kpi_summary_v3'); g.onsuccess = () => { res(Boolean(g.result)); q.result.close(); }; g.onerror = () => res(false); } catch { res(false); } }; q.onerror = () => res(false); });
});
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(B + '/**', route);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8500/index.html');
  await p.waitForSelector('#empId'); await p.fill('#empId', '8986'); await p.fill('#pw', 'Secret123');
  await p.click('button[type=submit]'); await p.waitForFunction(() => /Executive/.test(document.body.innerText)); await sleep(1500);
  const side = p.locator('aside, nav');
  await side.getByText('KPI Performance', { exact: true }).first().click();
  await p.waitForFunction(() => /STAFF Number1/i.test(document.querySelector('main')?.innerText || ''), null, { timeout: 15000 }).catch(() => {});
  ok(/STAFF Number1/i.test(await p.textContent('main')), 'KPI Performance shows the figures');
  await sleep(4000);
  ok(await idbHas(p), "today's KPI figures are saved on disk for this person");

  // someone else changes data (a KHQR entry): the figures stay on screen; opening the page again shows them at once
  await side.getByText('Dashboard', { exact: true }).first().click(); await sleep(800);
  await p.evaluate(() => { const bc = new BroadcastChannel('pos_portal_live_sync_v1'); bc.postMessage({ sender: 'someone-else', domains: ['qr'] }); bc.close(); });
  await sleep(600);
  net.delay = 3000; const c0 = net.calls;
  await side.getByText('KPI Performance', { exact: true }).first().click(); await sleep(400);
  ok(/STAFF Number1/i.test(await p.textContent('main')), 'after a change by someone else, the page still shows its figures at once (no loading state)');
  await sleep(3800);
  ok(net.calls - c0 >= 1 && net.calls - c0 <= 2, 'and reads the new figures once in the background (' + (net.calls - c0) + ' read)');

  // a new tab (nothing in this tab's memory): today's figures come from disk while the database answer is slow
  net.delay = 4000;
  const p2 = await ctx.newPage(); p2.on('pageerror', (e) => errs.push(String(e)));
  const t0 = Date.now();
  await p2.goto('http://127.0.0.1:8500/index.html');                       // (opens on the last page used: KPI Performance)
  await p2.waitForFunction(() => /STAFF Number1/i.test(document.querySelector('main')?.innerText || ''), null, { timeout: 12000 }).catch(() => {});
  const took = Date.now() - t0;
  ok(took < 3500, 'new tab: KPI figures shown from disk ' + took + ' ms after opening (the database answer takes 4 s)');
  net.delay = 0;

  // sign out: the copy on disk is deleted
  await p2.locator('button[title="Sign Out to Login Page"]').first().click();
  await p2.waitForSelector('#empId', { timeout: 15000 }); await sleep(1500);
  ok(!(await idbHas(p2)), 'sign-out deletes the figures kept on disk');
  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

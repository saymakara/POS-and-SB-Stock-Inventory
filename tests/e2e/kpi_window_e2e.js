// (26 Nov 2026) The KPI answer holds about 3 months of day-by-day rows ("daily_from"); months stay complete. The daily
// table of an older month reads that month's days once, on demand. Usage: build (stand-in URL), serve dist on :8500,
// then node kpi_window_e2e.js
process.env.N_DEV = process.env.N_DEV || '300';
const S = require('./lib/standin.js');
const { chromium, B, sleep } = S;
let fails = 0; const ok = (c, m, x) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== undefined && !c ? ' ' + JSON.stringify(x).slice(0, 400) : '')); if (!c) fails++; };
const days = (from, to) => { const out = []; for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10)); return out; };
const ppDay = (iso) => new Date(Date.parse(iso) + 7 * 3600000).toISOString().slice(0, 10);
const summary = (dailyFrom) => {
  const ds = days(dailyFrom, '2026-11-26');
  return {
    rules: [], targets: {}, staff: [{ staff_id: '20001', staff_name: 'STAFF Number1', branch_id: '101', branch_name: 'Branch 101', khqr_install: 3 }],
    daily: ds.slice(-30).map((d) => ({ period: d, khqr_install: 2, active_staff: 1, active_branches: 1 })),
    weekly: [], quarterly: [],
    monthly: ['2026-08', '2026-09', '2026-10', '2026-11'].map((m) => ({ period: m, khqr_install: 40, active_staff: 1, active_branches: 1 })),
    monthly_staff: ['2026-08', '2026-09', '2026-10', '2026-11'].map((m) => ({ month: m, staff_id: '20001', staff_name: 'STAFF Number1', branch_id: '101', branch_name: 'Branch 101', khqr_install: 40 })),
    daily_staff: ds.map((d) => ({ day: d, staff_id: '20001', staff_name: 'STAFF Number1', branch_id: '101', branch_name: 'Branch 101', total_tasks: d < '2026-09-01' ? 7 : 2, khqr_tasks: d < '2026-09-01' ? 7 : 2 })),
    daily_branch: ds.map((d) => ({ day: d, branch_id: '101', total_tasks: d < '2026-09-01' ? 7 : 2, khqr_tasks: d < '2026-09-01' ? 7 : 2, active_staff: 1 })),
    daily_from: dailyFrom,
  };
};
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const calls = [];
  await ctx.route(B + '/**', async (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === '/rest/v1/rpc/kpi_dashboard_summary_lite') {
      let body = {}; try { body = JSON.parse(r.request().postData() || '{}'); } catch { /* */ }
      calls.push(body);
      const from = body.p_from ? ppDay(body.p_from) : null;
      const win = '2026-09-01';
      return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(summary(from && from < win ? from : win)) });
    }
    if (u.pathname === '/rest/v1/rpc/kpi_dashboard_staff_slice_lite') {
      calls.push({ slice: true });
      const s = summary('2026-09-01');
      return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ rules: s.rules, targets: s.targets, staff: s.staff }) });
    }
    return S.api(r);
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8500/index.html');
  await p.waitForSelector('#empId'); await p.fill('#empId', '8986'); await p.fill('#pw', 'Secret123');
  await p.click('button[type=submit]'); await p.waitForFunction(() => /Executive/.test(document.body.innerText)); await sleep(1500);
  await p.locator('aside, nav').getByText('KPI Performance', { exact: true }).first().click(); await sleep(2500);
  const before = calls.length;
  ok(before >= 1 && calls.every((c) => c.slice || !c.p_from || ppDay(c.p_from) >= '2026-09-01'), 'KPI page: the normal answer (3 months of days) is read', calls);
  await p.getByRole('tab', { name: /Branch Daily Tasks/ }).click(); await sleep(1200);
  const sel = p.locator('select').filter({ has: p.locator('option', { hasText: /August 2026|Aug 2026/ }) }).first();
  ok(await sel.count() === 1, 'the month list still offers August (months stay complete)');
  const nov = /Month Tasks:\s*([\d,]+)/.exec(await p.textContent('main'));
  ok(nov && Number(nov[1]) > 0, 'November daily table shows its days (' + (nov && nov[1]) + ' tasks)');
  const n0 = calls.length;
  await sel.selectOption({ index: (await sel.locator('option').allTextContents()).findIndex((t) => /Aug/.test(t)) }); await sleep(2500);
  const extra = calls.slice(n0).filter((c) => !c.slice);
  ok(extra.length === 1 && extra[0].p_from && ppDay(extra[0].p_from) === '2026-08-01', 'an older month reads its days once (from 1 August)', extra);
  const txt = await p.textContent('main');
  const m = /Month Tasks:\s*([\d,]+) tasks/.exec(txt || '');
  ok(m && Number(m[1].replace(/,/g, '')) === 7 * 21,   // 21 work days in August 2026, 7 tasks each (only older days carry 7)
    'August daily table shows August\'s days (' + (m && m[1]) + ' tasks)', (txt || '').slice(0, 200));
  // back to November and to August again: no more reads
  const n1 = calls.length;
  const opts = await sel.locator('option').allTextContents();
  await sel.selectOption({ index: opts.findIndex((t) => /Nov/.test(t)) }); await sleep(800);
  await sel.selectOption({ index: opts.findIndex((t) => /Aug/.test(t)) }); await sleep(800);
  ok(calls.length === n1, 'switching months again needs no more reads', calls.slice(n1));
  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

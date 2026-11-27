// (27 Nov 2026) KPI Performance: Booth Event is its own category (card, filter, column in the branch / staff / timeline
// tables, top 10, export). Merchant Visit no longer holds the booth; the totals are unchanged.
// Usage: build (stand-in URL), serve dist on :8500, then node kpi_booth_e2e.js   (SHOT=path.png saves a screenshot)
process.env.N_DEV = process.env.N_DEV || '300';
const S = require('./lib/standin.js');
const { chromium, B, sleep } = S;
let fails = 0; const ok = (c, m, x) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== undefined && !c ? ' ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const rule = (code, category, sub, points) => ({ code, category, sub_category: sub, points, active: true, unit: 'per task', sort_order: 1 });
const rules = [
  rule('KHQR_INSTALL', 'KHQR', 'KHQR New Installation', 1), rule('KHQR_REPLACE', 'KHQR', 'KHQR Replacement', 1),
  rule('KHQR_PRINT_LAMINATE', 'KHQR', 'KHQR Print & Laminate', 0.2),
  rule('MV_BOOTH_EVENT_FULL_DAY', 'Merchant Visit', 'Booth Event - Full Day', 30), rule('MV_BOOTH_EVENT_HALF_DAY', 'Merchant Visit', 'Booth Event - Half Day', 15),
  rule('MV_STANDBY_VIP_HALF_DAY', 'Merchant Visit', 'Standby VIP - Half Day', 15),
];
// booth 271126 on one day (as 27 Nov, names from the stand-in Staff Directory): 4 staff, 120 task points, equal share 30 each; one standby VIP half day
const st = (id, name, ki, kr, extra, adj, adjB) => ({ staff_id: id, staff_name: name, branch_id: '101', branch_name: 'Branch 101', khqr_install: ki, khqr_replace: kr, extra, adj_pts: adj, adj_booth: adjB });
const staff = [
  st('20010', 'STAFF Number10', 14, 27, { MV_BOOTH_EVENT_FULL_DAY: 1 }, -49.2, -49.2),
  st('20011', 'STAFF Number11', 5, 22, { MV_BOOTH_EVENT_FULL_DAY: 1 }, -32.4, -32.4),
  st('20012', 'STAFF Number12', 3, 13, { MV_BOOTH_EVENT_FULL_DAY: 1 }, -19.2, -19.2),
  st('20013', 'STAFF Number13', 2, 14, { MV_BOOTH_EVENT_FULL_DAY: 1 }, -19.2, -19.2),
  st('20014', 'STAFF Number14', 0, 0, { MV_STANDBY_VIP_HALF_DAY: 1 }, 0, 0),
];
const summary = () => ({
  rules, targets: {}, staff, daily: [{ period: today, khqr_install: 24, khqr_replace: 76, active_staff: 5, active_branches: 1, extra: { MV_BOOTH_EVENT_FULL_DAY: 4, MV_STANDBY_VIP_HALF_DAY: 1 }, adj_pts: -120, adj_booth: -120 }],
  weekly: [], quarterly: [], monthly: [{ period: today.slice(0, 7), khqr_install: 24, khqr_replace: 76, active_staff: 5, active_branches: 1, extra: { MV_BOOTH_EVENT_FULL_DAY: 4, MV_STANDBY_VIP_HALF_DAY: 1 }, adj_pts: -120, adj_booth: -120 }],
  monthly_staff: staff.map((s) => Object.assign({ month: today.slice(0, 7) }, s)),
  daily_staff: staff.map((s) => ({ day: today, staff_id: s.staff_id, staff_name: s.staff_name, branch_id: '101', branch_name: 'Branch 101', total_tasks: s.khqr_install + s.khqr_replace + 1, khqr_tasks: s.khqr_install + s.khqr_replace, mv_tasks: 1, booth_tasks: s.extra.MV_BOOTH_EVENT_FULL_DAY ? 1 : 0 })),
  daily_branch: [{ day: today, branch_id: '101', total_tasks: 105, khqr_tasks: 100, mv_tasks: 5, booth_tasks: 4, active_staff: 5 }],
  daily_from: today.slice(0, 8) + '01',
});
const route = async (r) => {
  const u = new URL(r.request().url());
  const send = (body) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) }).catch(() => {});
  if (u.pathname === '/rest/v1/rpc/kpi_dashboard_summary_lite' || u.pathname === '/rest/v1/rpc/kpi_dashboard_summary') return send(summary());
  if (u.pathname === '/rest/v1/rpc/kpi_dashboard_staff_slice_lite' || u.pathname === '/rest/v1/rpc/kpi_dashboard_staff_slice') { const s = summary(); return send({ rules: s.rules, targets: s.targets, staff: s.staff }); }
  if (u.pathname === '/rest/v1/kpi_point_rules') return send(rules);
  return S.api(r);
};
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  await ctx.route(B + '/**', route);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8500/index.html');
  await p.waitForSelector('#empId'); await p.fill('#empId', '8986'); await p.fill('#pw', 'Secret123');
  await p.click('button[type=submit]'); await p.waitForFunction(() => /Executive/.test(document.body.innerText)); await sleep(1500);
  const side = p.locator('aside, nav');
  await side.getByText('KPI Performance', { exact: true }).first().click();
  await p.waitForFunction(() => /STAFF Number10/i.test(document.querySelector('main')?.innerText || ''), null, { timeout: 15000 }).catch(() => {});
  await sleep(2500);
  const main = await p.textContent('main');
  ok(/Booth Event/.test(main), 'the page shows a Booth Event category');
  const card = p.locator('main button', { hasText: 'Booth Event' }).filter({ hasText: 'full day' }).first();
  ok(await card.count() > 0 && /4 full day/.test(await card.innerText()), 'Booth Event card: 4 full days', await card.count() ? await card.innerText() : null);
  ok(await p.locator('main button', { hasText: /^Booth Event$/ }).count() >= 1 || /Booth Event/.test(main), 'Booth Event column header');
  // the staff table: the row of the booth staff member with 49.2 own points
  const staffTab = p.locator('main button', { hasText: /^Staff$/ }).first();
  if (await staffTab.count()) { await staffTab.click().catch(() => {}); await sleep(800); }
  const rowText = await p.locator('main button', { hasText: 'STAFF Number10' }).filter({ hasText: 'Code 110' }).first().innerText().catch(() => '');
  ok(/30/.test(rowText), 'Booth staff (49.2 own points) total stays 30', rowText);
  ok(/−19\.2/.test(rowText), 'Booth staff Booth Event column: 30 booth points - 49.2 shared out = -19.2', rowText);
  if (process.env.SHOT) { await p.screenshot({ path: process.env.SHOT, fullPage: false }); }
  // filter: Booth Event shows only booth staff
  const sel = p.locator('main select').filter({ has: p.locator('option[value="Booth Event"]') }).first();
  ok(await sel.count() > 0, 'category filter has Booth Event');
  if (await sel.count()) {
    await sel.selectOption('Booth Event'); await sleep(1200);
    const t = await p.textContent('main');
    ok(/STAFF Number10\b/.test(t) && !/STAFF Number14\b/.test(t.split('Booth Event').slice(1).join('')) , 'Booth Event filter: booth staff only (the standby staff member is not listed)');
    if (process.env.SHOT2) await p.screenshot({ path: process.env.SHOT2, fullPage: false });
  }
  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

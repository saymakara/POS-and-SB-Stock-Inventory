// Settings → KPI → Team leads (11 Nov 2026), against the stand-in Supabase API. Never touches live data.
// Admin: list, add (Staff ID, name, branches, other Staff IDs) -> kpi_team_lead_save; edit; remove -> kpi_team_lead_delete.
// Run against a built dist/ (VITE_SUPABASE_URL = the stand-in address) served on 127.0.0.1:8500 (node tests/e2e/serve-dist.cjs).
const S = require('./lib/standin.js');
const { chromium, B, sleep } = S;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const IGNORE = /WebSocket connection to .*realtime|Failed to load resource|ERR_TUNNEL|net::ERR/;
let leads = [{ staff_id: '8525', staff_name: 'OEUNG Yongchhy', branch_ids: ['101'], member_ids: [], active: true }];
const calls = [];
const json = (route, code, o) => route.fulfill({ status: code, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' }, body: JSON.stringify(o) });
async function api(route) {
  const req = route.request(), path = new URL(req.url()).pathname, body = req.postData() ? JSON.parse(req.postData()) : null;
  if (path === '/rest/v1/rpc/kpi_team_lead_list') return json(route, 200, leads);
  if (path === '/rest/v1/rpc/kpi_team_lead_save') { calls.push(['save', body.p]); leads = leads.filter((l) => l.staff_id !== body.p.staff_id).concat([body.p]); return json(route, 200, { ok: true, staff_id: body.p.staff_id }); }
  if (path === '/rest/v1/rpc/kpi_team_lead_delete') { calls.push(['delete', body.p_staff_id]); leads = leads.filter((l) => l.staff_id !== body.p_staff_id); return json(route, 200, { ok: true }); }
  return S.api(route);
}
(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); await ctx.route(B + '/**', api);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errs.push(m.text()); });
  p.on('dialog', (d) => d.accept());
  await p.goto('http://127.0.0.1:' + (process.env.DIST_PORT || '8500') + '/index.html');
  await p.waitForSelector('#empId', { state: 'visible' }); await p.fill('#empId', '8986'); await p.fill('#pw', 'Secret123'); await p.click('button[type=submit]');
  await p.waitForFunction(() => /Dashboard/.test(document.body.innerText), null, { timeout: 30000 }); await sleep(1200);
  await p.locator('aside, nav').getByText('Settings', { exact: true }).first().click(); await sleep(1500);
  await p.getByText('KPI Points & Rules').first().click().catch(() => {}); await sleep(1500);
  const sec = p.locator('section[aria-label="KPI team leads"]');
  ok(await sec.isVisible(), 'Settings → KPI: the Team leads card');
  ok(await sec.getByText('OEUNG Yongchhy').isVisible() && await sec.getByText(/101 /).first().isVisible(), 'lists the team leads with their branches');
  await sec.getByTestId('tl-add').click(); await sleep(400);
  await sec.getByTestId('tl-id').fill('8986'); await sec.getByTestId('tl-name').fill('SAY Chanmakara');
  await sec.locator('button[aria-pressed]').filter({ hasText: /^105 · / }).click(); await sec.locator('button[aria-pressed]').filter({ hasText: /^101 · / }).click();
  await sec.getByTestId('tl-members').fill('27121, 10386'); await sec.getByTestId('tl-save').click(); await sleep(1200);
  const s1 = calls.find((c) => c[0] === 'save');
  ok(s1 && s1[1].staff_id === '8986' && s1[1].staff_name === 'SAY Chanmakara' && JSON.stringify(s1[1].branch_ids.sort()) === '["101","105"]' && JSON.stringify(s1[1].member_ids) === '["27121","10386"]' && s1[1].active === true,
    'Add: kpi_team_lead_save with the Staff ID, name, branches and other Staff IDs (' + JSON.stringify(s1 && s1[1]) + ')');
  ok(await sec.getByText('SAY Chanmakara').isVisible() && await sec.getByText('27121, 10386').isVisible(), 'the new team lead is listed');
  await sec.locator('button[aria-label="Edit 8986"]').click(); await sleep(400);
  ok(await sec.getByTestId('tl-id').isDisabled(), 'Edit: the Staff ID cannot change');
  await sec.locator('button[aria-pressed]').filter({ hasText: /^101 · / }).click(); await sec.getByTestId('tl-save').click(); await sleep(1200);
  const s2 = calls.filter((c) => c[0] === 'save')[1];
  ok(s2 && JSON.stringify(s2[1].branch_ids) === '["105"]', 'Edit: a branch removed (' + JSON.stringify(s2 && s2[1].branch_ids) + ')');
  await sec.locator('button[aria-label="Remove 8525"]').click(); await sleep(1200);
  ok(calls.some((c) => c[0] === 'delete' && c[1] === '8525') && !(await sec.getByText('OEUNG Yongchhy').isVisible().catch(() => false)), 'Remove: kpi_team_lead_delete, gone from the list');
  ok(errs.length === 0, 'no page errors ' + errs.slice(0, 3).join(' | '));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('HARNESS ' + e.message); process.exit(1); });

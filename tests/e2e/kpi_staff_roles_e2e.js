// (28 Nov 2026) KPI roles live in the Staff Directory, against the stand-in Supabase API (never touches live data):
//  * Settings -> KPI no longer has the Management Level and Team leads cards (a one-line pointer instead)
//  * Staff Directory: KPI Role column (Branch Staff / HO Support / Management + Team lead); Edit -> KPI level (kpi_management_set),
//    Team lead with branches and extra Staff IDs (kpi_team_lead_save), removing a team lead (kpi_team_lead_delete)
//  * a browser's old Management list (localStorage) is copied to the database once, then removed
//  * Settings -> KPI Points & Rules: the one "Sync from Merchant Visit" also finds Sound Box Maintenance (kpi_sync_from_mv {source: field})
// Run against a built dist/ (stand-in URL) served on 127.0.0.1:8500 (node tests/e2e/serve-dist.cjs).
const S = require('./lib/standin.js');
const { chromium, B, sleep } = S;
let fails = 0; const ok = (c, m, x) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (!c && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const IGNORE = /WebSocket connection to .*realtime|Failed to load resource|ERR_TUNNEL|net::ERR/;
let leads = [{ staff_id: '20011', staff_name: 'STAFF Number11', branch_ids: ['101', '102'], member_ids: [], active: true }];
let mgmt = [{ staff_id: '20012', staff_name: 'STAFF Number12', level: 'MANAGEMENT' }];
let rules = [{ code: 'SB_MAINT', category: 'Sound Box', sub_category: 'Sound Box Operational Support', description: '', points: 2, unit: 'per visit', active: true, is_system: true, sort_order: 60 }];
const calls = [];
const json = (route, code, o) => route.fulfill({ status: code, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' }, body: JSON.stringify(o) });
async function api(route) {
  const req = route.request(), path = new URL(req.url()).pathname, body = req.postData() ? JSON.parse(req.postData()) : null;
  if (path === '/rest/v1/rpc/kpi_team_lead_list') return json(route, 200, leads);
  if (path === '/rest/v1/rpc/kpi_team_lead_save') { calls.push(['tl_save', body.p]); leads = leads.filter((l) => l.staff_id !== body.p.staff_id).concat([body.p]); return json(route, 200, { ok: true, staff_id: body.p.staff_id }); }
  if (path === '/rest/v1/rpc/kpi_team_lead_delete') { calls.push(['tl_delete', body.p_staff_id]); leads = leads.filter((l) => l.staff_id !== body.p_staff_id); return json(route, 200, { ok: true }); }
  if (path === '/rest/v1/rpc/kpi_management_list') return json(route, 200, mgmt);
  if (path === '/rest/v1/rpc/kpi_management_set') {
    calls.push(['mgmt_set', body.p]);
    for (const i of body.p.items) { mgmt = mgmt.filter((m) => m.staff_id !== i.staff_id); if (i.on) mgmt.push({ staff_id: i.staff_id, staff_name: i.staff_name, level: i.level || 'MANAGEMENT' }); }
    return json(route, 200, { ok: true, levels: true });
  }
  if (path === '/rest/v1/rpc/admin_save_staff') {
    calls.push(['staff_save', body.p]);
    const s = S.STAFF.find((x) => x.emp_id === body.p.emp_id) || {};
    Object.assign(s, { name: body.p.name, branch_id: body.p.branch_id, active: body.p.active });
    return json(route, 200, Object.assign({ user_id: 'u-x', role: 'BRANCH', must_change_password: false, updated_at: '2026-11-28T00:00:00Z' }, s, { emp_id: body.p.emp_id }));
  }
  if (path === '/rest/v1/rpc/kpi_get_settings_fast') return json(route, 200, { rules, targets: {} });
  if (path === '/rest/v1/kpi_point_rules') return json(route, 200, rules);
  if (path === '/rest/v1/rpc/kpi_sync_from_mv') {
    calls.push(['sync', body.p]);
    const field = body.p.source === 'field';
    const cand = field && !rules.some((r) => r.code === 'SB_MAINTENANCE')
      ? [{ code: 'SB_MAINTENANCE', activity: 'Sound Box Maintenance', sub_category: 'Sound Box Maintenance', category: 'Sound Box', visits: 680, points: 2, last_seen: '2026-11-27T10:45:58Z' }] : [];
    let added = [];
    if (body.p.apply) { added = cand.map((c) => ({ code: c.code, category: c.category, sub_category: c.sub_category, description: 'POS / Sound Box form', points: 2, unit: 'per visit', active: false, is_system: false, sort_order: 300 })); rules = rules.concat(added); }
    return json(route, 200, { applied: !!body.p.apply, added: added.length, new: cand, deleted_skipped: [], activities_checked: field ? 9 : 17, already_have_rule: field ? 8 : 17, rules: added, source: field ? 'field' : 'mv' });
  }
  return S.api(route);
}
(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await b.newContext({ viewport: { width: Number(process.env.VW || 1440), height: 900 } }); await ctx.route(B + '/**', api);
  // the old per-browser Management list (before 28 Nov 2026): one entry with a Staff ID, one with a name only
  await ctx.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('kpi_management_exempt_staff_v1', JSON.stringify([{ staffId: '20013', staffName: 'STAFF Number13' }, { staffId: '', staffName: 'Someone Without Id' }]));
      sessionStorage.setItem('seeded', '1');
    }
  });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errs.push(m.text()); });
  await p.goto('http://127.0.0.1:' + (process.env.DIST_PORT || '8500') + '/index.html');
  await p.waitForSelector('#empId', { state: 'visible' }); await p.fill('#empId', '8986'); await p.fill('#pw', 'Secret123'); await p.click('button[type=submit]');
  await p.waitForFunction(() => /Dashboard/.test(document.body.innerText), null, { timeout: 30000 }); await sleep(1200);
  const text = () => p.evaluate(() => document.body.innerText);

  // ---- Settings -> KPI: the two cards are gone; Sync POS & Sound Box
  await p.locator('aside, nav').getByText('Settings', { exact: true }).first().click(); await sleep(1500);
  await p.getByText('KPI Points & Rules').first().click().catch(() => {}); await sleep(1500);
  ok(!(await p.locator('section[aria-label="Management Level KPI Exemption"]').count()) && !(await p.locator('section[aria-label="KPI team leads"]').count()), 'Settings -> KPI: no Management Level card, no Team leads card');
  ok(await p.locator('[data-kpi-roles-moved]').isVisible() && /set in Staff Directory/.test(await p.locator('[data-kpi-roles-moved]').innerText()), 'a one-line pointer to the Staff Directory');
  ok(await p.locator('[data-kpi-sync]').count() === 1 && await p.locator('[data-kpi-sync-field]').count() === 0, 'one Sync button only ("Sync from Merchant Visit")');
  await p.locator('[data-kpi-sync]').click(); await sleep(1200);
  const list = await p.locator('[data-kpi-sync-list]').innerText().catch(() => '');
  ok(/Sync KPI tasks from Merchant Visit/.test(await text()) && /Sound Box Maintenance/.test(list) && /680 visit\(s\) · 2 pts/.test(list) && /POS \/ SB form/.test(list), 'Sync from Merchant Visit: also lists Sound Box Maintenance (POS / SB form), 680 visits, 2 pts', list);
  ok(calls.some((c) => c[0] === 'sync' && c[1].source === 'field' && !c[1].apply) && calls.some((c) => c[0] === 'sync' && !c[1].source && !c[1].apply), 'the one button checks both: visit activities and the POS / Sound Box forms');
  await p.locator('[data-kpi-sync-apply]').click(); await sleep(1500);
  ok(calls.some((c) => c[0] === 'sync' && c[1].source === 'field' && c[1].apply), 'Add: applied for the POS / Sound Box forms too');
  ok(/Sound Box Maintenance/.test(await text()) && /points these visits earn today/.test(await text()), 'the new task is listed; the message says form tasks start at today\'s points, Inactive');

  // ---- Staff Directory
  await p.locator('aside').first().getByRole('button', { name: /Staff Directory/ }).first().click(); await sleep(1800);
  const mg = calls.find((c) => c[0] === 'mgmt_set');
  ok(mg && mg[1].items.length === 1 && mg[1].items[0].staff_id === '20013' && mg[1].items[0].on === true, 'the old browser list is copied to the database once (Staff ID entries)', mg);
  ok(await p.evaluate(() => localStorage.getItem('kpi_management_exempt_staff_v1')) === null, 'the old browser copy is removed');
  ok(/Someone Without Id/.test(await text()), 'names without a Staff ID are listed back to set by hand');
  const search = p.getByPlaceholder(/search/i).first();
  const rowOf = (emp) => p.locator('main tr').filter({ hasText: emp }).first();
  await search.fill('20011'); await sleep(600);
  ok(/Team lead · 2 br\./.test(await rowOf('20011').innerText()), 'badge: Team lead · 2 branches', await rowOf('20011').innerText());
  await search.fill('20012'); await sleep(600);
  ok(/Management/.test(await rowOf('20012').innerText()), 'badge: Management', await rowOf('20012').innerText());
  ok(await p.locator('main thead').getByText('KPI Role', { exact: true }).count() === 1, 'the table has a KPI Role column');
  ok(/Management/.test(await rowOf('20012').locator('[data-kpi-role-cell]').innerText()) && !/Management/.test(await rowOf('20012').locator('td').nth(2).innerText()), 'Management is shown in the KPI Role column, not next to the name');
  await search.fill(''); await sleep(600);
  await p.locator('main thead').getByText('KPI Role', { exact: true }).click(); await sleep(500);
  const firstRoles = await p.locator('main tbody tr [data-kpi-role-cell]').evaluateAll((els) => els.slice(0, 5).map((e) => e.innerText.trim()));
  const rank = (t) => (/Management/.test(t) ? 0 : /HO Support/.test(t) ? 1 : /Team lead/.test(t) ? 2 : 3);
  ok(firstRoles.length === 5 && firstRoles.every((t, i) => i === 0 || rank(firstRoles[i - 1]) <= rank(t)) && rank(firstRoles[0]) === 0 && firstRoles.some((t) => rank(t) === 2),
    'sorting by KPI Role: Management first, then Team leads, then the rest', firstRoles);
  if (process.env.SHOT_TABLE) await p.screenshot({ path: process.env.SHOT_TABLE });
  ok(/^Branch Staff$/.test(firstRoles[4] || '') , 'staff without a KPI level show "Branch Staff"', firstRoles);
  await search.fill('team lead'); await sleep(600);
  ok(await p.locator('main tr').filter({ hasText: '20011' }).count() === 1, 'search "team lead" finds the team leads');

  // edit 20010: Management on + Team lead (branches 101, 105, two extra Staff IDs)
  const openEdit = async (emp) => { await search.fill(emp); await sleep(600); await rowOf(emp).getByRole('button', { name: 'Edit', exact: true }).click(); await sleep(500); };
  await openEdit('20010');
  const panel = p.locator('[data-staff-kpi-role]');
  ok(await panel.isVisible() && await p.locator('[data-staff-kpi-level] [data-level="BRANCH_STAFF"]').getAttribute('aria-checked') === 'true' && !(await p.locator('[data-staff-kpi-tl]').isChecked()),
    'Edit: KPI level Branch Staff (default), Team lead off');
  ok(/HO Support/.test(await p.locator('[data-staff-kpi-level]').innerText()) && /Management Level/.test(await p.locator('[data-staff-kpi-level]').innerText()), 'the KPI level offers Branch Staff, HO Support, Management Level');
  await p.locator('[data-staff-kpi-level] [data-level="HO_SUPPORT"]').click(); await p.locator('[data-staff-kpi-tl]').check(); await sleep(200);
  await p.getByRole('button', { name: /^Save/ }).first().click(); await sleep(800);
  ok(/choose at least one branch/i.test(await text()) && !calls.some((c) => c[0] === 'staff_save'), 'Team lead without branches or Staff IDs: asked to choose, nothing saved');
  await p.locator('[data-staff-kpi-branches] button').filter({ hasText: /^101 · / }).click();
  await p.locator('[data-staff-kpi-branches] button').filter({ hasText: /^105 · / }).click();
  await p.locator('[data-staff-kpi-members]').fill('27121, 10386');
  await p.getByRole('button', { name: /^Save/ }).first().click(); await sleep(1500);
  const ms = calls.filter((c) => c[0] === 'mgmt_set').pop();
  ok(ms && ms[1].items[0].staff_id === '20010' && ms[1].items[0].on === true && ms[1].items[0].level === 'HO_SUPPORT', 'Save: KPI level HO Support (kpi_management_set)', ms);
  const ts = calls.filter((c) => c[0] === 'tl_save').pop();
  ok(ts && ts[1].staff_id === '20010' && JSON.stringify([...ts[1].branch_ids].sort()) === '["101","105"]' && JSON.stringify(ts[1].member_ids) === '["27121","10386"]' && ts[1].active === true,
    'Save: team lead with branches 101, 105 and two Staff IDs (kpi_team_lead_save)', ts && ts[1]);
  ok(/HO Support \(KPI level\)/.test(await text()) && /Team lead saved/.test(await text()), 'the message names both changes', (await text()).split('\n').filter((l) => /20010|KPI level|Team lead/.test(l)).slice(0, 6));
  await search.fill('20010'); await sleep(700);
  const r10 = await rowOf('20010').innerText();
  ok(/HO Support/.test(r10) && /Team lead · 2 br\./.test(r10), 'badges shown on the row: HO Support + Team lead', r10);
  // 20012: Management back to Branch Staff
  await openEdit('20012');
  ok(await p.locator('[data-staff-kpi-level] [data-level="MANAGEMENT"]').getAttribute('aria-checked') === 'true', 'Edit a Management staff member: Management Level selected');
  await p.locator('[data-staff-kpi-level] [data-level="BRANCH_STAFF"]').click();
  await p.getByRole('button', { name: /^Save/ }).first().click(); await sleep(1500);
  const back = calls.filter((c) => c[0] === 'mgmt_set').pop();
  ok(back && back[1].items[0].staff_id === '20012' && back[1].items[0].on === false, 'Save: back to Branch Staff (removed from the list)', back);
  await search.fill('20012'); await sleep(700);
  ok(/Branch Staff/.test(await rowOf('20012').locator('[data-kpi-role-cell]').innerText()), 'the row now shows Branch Staff');

  // edit 20011: remove the team lead; nothing else changes
  const before = calls.length;
  await openEdit('20011');
  ok(await p.locator('[data-staff-kpi-tl]').isChecked() && await p.locator('[data-staff-kpi-branches] button[aria-pressed="true"]').count() === 2, 'Edit an existing team lead: ticked, 2 branches selected');
  await p.locator('[data-staff-kpi-tl]').uncheck();
  await p.getByRole('button', { name: /^Save/ }).first().click(); await sleep(1500);
  const after = calls.slice(before);
  ok(after.some((c) => c[0] === 'tl_delete' && c[1] === '20011') && !after.some((c) => c[0] === 'mgmt_set' || c[0] === 'tl_save'), 'Save: only kpi_team_lead_delete (nothing else sent)', after.map((c) => c[0]));
  await search.fill('20011'); await sleep(700);
  ok(!/Team lead/.test(await rowOf('20011').innerText()), 'the Team lead badge is gone');

  if (process.env.SHOT) { await openEdit('20010'); await p.locator('[data-staff-kpi-role]').scrollIntoViewIfNeeded(); await p.screenshot({ path: process.env.SHOT }); }
  ok(errs.length === 0, 'no page errors ' + errs.slice(0, 3).join(' | '));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('HARNESS ' + e.message); process.exit(1); });

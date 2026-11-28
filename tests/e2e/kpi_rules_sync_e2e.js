// Settings → KPI Points & Rules (22 Nov 2026): delete a KPI task, and "Sync from Merchant Visit", against the stand-in Supabase
// API. Never touches live data. Run against a built dist/ served on 127.0.0.1:8500 (node tests/e2e/serve-dist.cjs).
const S = require('./lib/standin.js');
const { chromium, B, sleep } = S;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const IGNORE = /WebSocket connection to .*realtime|Failed to load resource|ERR_TUNNEL|net::ERR/;
const rule = (code, category, sub, points, active, sort) => ({ code, category, sub_category: sub, description: sub + ' rule', points, unit: 'per visit', active, is_system: true, sort_order: sort });
let rules = [
  rule('POS_INSTALL', 'POS Terminal', 'POS New Installation', 5, true, 10),
  rule('MV_KEY_MERCHANT_VISIT', 'Merchant Visit', 'Key Merchant Visit', 2, true, 120),
  rule('MV_KHQR_ISSUE', 'Merchant Visit', 'KHQR Issue', 0.5, true, 130),
  rule('MV_BOOTH_EVENT', 'Merchant Visit', 'Booth Event', 0, false, 990),
];
const deleted = new Map();
const fresh = [
  { code: 'MV_POS_OFFLINE_COUNT', activity: 'POS Offline Count', sub_category: 'POS Offline Count', category: 'Merchant Visit', visits: 23, last_seen: '2026-11-20T08:00:00Z' },
  { code: 'MV_RETURN_TERMINATE_QR', activity: 'Return & Terminate QR', sub_category: 'Return & Terminate QR', category: 'Merchant Visit', visits: 1, last_seen: '2026-11-17T08:00:00Z' },
];
const calls = [];
let eventSettings = { id: 1, install_per_submission: true, booth_mode: 'shared', standby_mode: 'higher', half_day_weight: 0.5 };
const json = (route, code, o) => route.fulfill({ status: code, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' }, body: JSON.stringify(o) });
async function api(route) {
  const req = route.request(), path = new URL(req.url()).pathname, body = req.postData() ? JSON.parse(req.postData()) : null;
  if (path === '/rest/v1/rpc/kpi_get_settings_fast') return json(route, 200, { rules, targets: {} });
  if (path === '/rest/v1/kpi_event_settings') return json(route, 200, eventSettings);
  if (path === '/rest/v1/rpc/kpi_save_event_settings') { calls.push(['event', body.p]); eventSettings = Object.assign({}, eventSettings, body.p, { updated_by: 'SAY Chanmakara' }); return json(route, 200, eventSettings); }
  if (path === '/rest/v1/kpi_point_rules') return json(route, 200, rules);
  if (path === '/rest/v1/rpc/kpi_delete_rule') {
    calls.push(['delete', body.p_code]);
    const r = rules.find((x) => x.code === body.p_code); rules = rules.filter((x) => x.code !== body.p_code); if (r) deleted.set(r.code, r);
    return json(route, 200, { ok: true, code: body.p_code });
  }
  if (path === '/rest/v1/rpc/kpi_save_rule') {
    calls.push(['save', body.p]);
    const r = Object.assign({ is_system: false }, rules.find((x) => x.code === body.p.code) || {}, body.p);
    rules = rules.filter((x) => x.code !== r.code).concat([r]);
    return json(route, 200, r);
  }
  if (path === '/rest/v1/rpc/kpi_sync_from_mv') {
    // (28 Nov 2026) one Sync button asks for both: the visit activities and the POS / Sound Box forms (none missing here)
    if (body.p.source === 'field') return json(route, 200, { applied: !!body.p.apply, added: 0, new: [], deleted_skipped: [], activities_checked: 0, already_have_rule: 0, rules: [], source: 'field' });
    calls.push(['sync', body.p]);
    const have = new Set(rules.map((r) => r.code));
    const cand = fresh.filter((c) => !have.has(c.code));
    const del = [...deleted.values()].map((r) => ({ code: r.code, activity: r.sub_category, sub_category: r.sub_category, category: r.category, visits: 52, deleted_at: '2026-11-22T01:00:00Z', deleted_by: 'SAY Chanmakara' }));
    let added = [];
    if (body.p.apply) {
      added = cand.map((c, i) => ({ code: c.code, category: c.category, sub_category: c.sub_category, description: 'Merchant Visit app: ' + c.activity + ' - added by Sync; set the points, then switch it on', points: 0, unit: 'per visit', active: false, is_system: false, sort_order: 200 + i * 10 }));
      if (body.p.include_deleted) { added = added.concat([...deleted.values()]); deleted.clear(); }
      rules = rules.concat(added);
    }
    return json(route, 200, { applied: !!body.p.apply, added: added.length, new: cand, deleted_skipped: body.p.include_deleted ? [] : del, activities_checked: 17, already_have_rule: 15, rules: added });
  }
  return S.api(route);
}
(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); await ctx.route(B + '/**', api);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errs.push(m.text()); });
  await p.goto('http://127.0.0.1:' + (process.env.DIST_PORT || '8500') + '/index.html');
  await p.waitForSelector('#empId', { state: 'visible' }); await p.fill('#empId', '8986'); await p.fill('#pw', 'Secret123'); await p.click('button[type=submit]');
  await p.waitForFunction(() => /Dashboard/.test(document.body.innerText), null, { timeout: 30000 }); await sleep(1200);
  await p.locator('aside, nav').getByText('Settings', { exact: true }).first().click(); await sleep(1500);
  await p.getByText('KPI Points & Rules').first().click().catch(() => {}); await sleep(1500);
  const text = () => p.evaluate(() => document.body.innerText);
  ok(/KHQR Issue/.test(await text()) && /Key Merchant Visit/.test(await text()), 'the KPI tasks are listed');

  // ---- delete
  await p.locator('[data-kpi-delete-rule="MV_KHQR_ISSUE"]').click(); await sleep(400);
  ok(/Sync from Merchant Visit.{0,10} will not add it back/.test(await text()), 'the delete window says Sync will not add it back');
  await p.locator('[data-kpi-confirm-delete="MV_KHQR_ISSUE"]').click(); await sleep(1200);
  ok(calls.some((c) => c[0] === 'delete' && c[1] === 'MV_KHQR_ISSUE'), 'Delete calls kpi_delete_rule with the task code');
  ok(!(await p.locator('[data-kpi-delete-rule="MV_KHQR_ISSUE"]').count()), 'the deleted task is gone from the list');

  // ---- sync: preview
  await p.locator('[data-kpi-sync]').click(); await sleep(1200);
  const dry = calls.filter((c) => c[0] === 'sync')[0];
  ok(dry && dry[1].apply === false, 'Sync first only checks (apply false): nothing is added before you confirm');
  const list = await p.locator('[data-kpi-sync-list]').innerText().catch(() => '');
  ok(/POS Offline Count/.test(list) && /23 visit/.test(list) && /Return & Terminate QR/.test(list), 'the window lists the Merchant Visit tasks without a KPI task, with their visits');
  ok(/Also bring back 1 task\(s\) you deleted/.test(await text()) && /KHQR Issue/.test(await text()), 'the task you deleted is offered separately, not added by default');
  ok(/Add 2 KPI task\(s\)/.test(await p.locator('[data-kpi-sync-apply]').innerText()), 'the button adds 2 tasks');
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT });

  // ---- sync: apply
  await p.locator('[data-kpi-sync-apply]').click(); await sleep(1500);
  const ap = calls.filter((c) => c[0] === 'sync')[1];
  ok(ap && ap[1].apply === true && ap[1].include_deleted === false, 'Add calls kpi_sync_from_mv with apply true, deleted tasks left out');
  const t = await text();
  ok(/Added 2 KPI task\(s\) from Merchant Visit/.test(t), 'a message says the tasks were added and to set their points');
  ok((t.match(/New · set points/g) || []).length === 2, 'the 2 new tasks show in the list marked "New · set points"');
  ok(!(await p.locator('[data-kpi-delete-rule="MV_KHQR_ISSUE"]').count()), 'the deleted task was not added back');

  // ---- set points, switch on: the New mark goes
  const row = p.locator('tr', { hasText: 'POS Offline Count' });
  await row.locator('input[type=number]').fill('1'); await row.getByRole('button', { name: /Save/ }).click(); await sleep(800);
  await row.getByRole('button', { name: 'Inactive' }).click(); await sleep(800);
  const saves = calls.filter((c) => c[0] === 'save');
  ok(saves.some((c) => c[1].code === 'MV_POS_OFFLINE_COUNT' && c[1].points === 1) && saves.some((c) => c[1].code === 'MV_POS_OFFLINE_COUNT' && c[1].active === true), 'points and Active saved with kpi_save_rule');
  ok((((await text()).match(/New · set points/g)) || []).length === 1, 'once it has points and is Active, its New mark goes');

  // ---- sync again: bring back the deleted one
  await p.locator('[data-kpi-sync]').click(); await sleep(1200);
  await p.locator('[data-kpi-sync-include-deleted]').check(); await sleep(200);
  ok(/Add 1 KPI task\(s\)/.test(await p.locator('[data-kpi-sync-apply]').innerText()), 'ticking "bring back" offers the deleted task');
  await p.locator('[data-kpi-sync-apply]').click(); await sleep(1500);
  const ap2 = calls.filter((c) => c[0] === 'sync').pop();
  ok(ap2 && ap2[1].include_deleted === true, 'Add with include_deleted true');
  ok(await p.locator('[data-kpi-delete-rule="MV_KHQR_ISSUE"]').count() === 1, 'the deleted task is back in the list');

  // ---- nothing left
  const before = calls.filter((c) => c[0] === 'sync').length;
  await p.locator('[data-kpi-sync]').click(); await sleep(300);
  await p.waitForFunction(() => /Up to date\s*\n?\s*All 17 Merchant Visit app tasks already have a KPI task/i.test(document.body.innerText), null, { timeout: 4000 }).catch(() => {});
  ok(/Up to date\s*\n?\s*All 17 Merchant Visit app tasks already have a KPI task/i.test(await text()) && !(await p.locator('[data-kpi-sync-apply]').count()) && calls.filter((c) => c[0] === 'sync').length === before + 1, 'when nothing is missing, Sync just says it is up to date');

  // ---- an Inactive task at the bottom of a long page (owner, 22 Nov 2026: "I cannot delete"): the window must open on screen
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await sleep(300);
  const del = p.locator('[data-kpi-delete-rule="MV_BOOTH_EVENT"]');
  await del.scrollIntoViewIfNeeded(); await del.click(); await sleep(500);
  const confirmBtn = p.locator('[data-kpi-confirm-delete="MV_BOOTH_EVENT"]');
  const box = await confirmBtn.boundingBox().catch(() => null);
  const vh = await p.evaluate(() => window.innerHeight);
  ok(!!box && box.y >= 0 && box.y + box.height <= vh, 'deleting the last (Inactive) task: the confirm window is on screen (button at y=' + (box && Math.round(box.y)) + ', screen ' + vh + ')');
  await confirmBtn.click(); await sleep(1000);
  ok(calls.some((c) => c[0] === 'delete' && c[1] === 'MV_BOOTH_EVENT') && !(await del.count()), 'the Inactive task is deleted and gone from the list');
  await p.evaluate(() => window.scrollTo(0, 0)); await sleep(300);

  // ---- Booth Event / Standby VIP / per-submission settings card
  const card = p.locator('[data-kpi-event-settings]');
  ok(await card.isVisible(), 'the Booth Event, Standby VIP & per-submission card is shown to Super Admin');
  ok(await card.locator('[data-booth-mode="shared"]').isChecked() && await card.locator('[data-standby-mode="higher"]').isChecked() && await card.locator('[data-per-submission]').isChecked(),
    'it shows the saved rules (shared by tag, standby higher, once per submission)');
  ok(await card.locator('[data-kpi-event-save]').isDisabled(), 'Save is off until something changes');
  await card.locator('[data-half-weight]').selectOption('1'); await card.locator('[data-standby-mode="fixed"]').check(); await sleep(200);
  await card.locator('[data-kpi-event-save]').click(); await sleep(1200);
  const ev = calls.find((c) => c[0] === 'event');
  ok(ev && ev[1].booth_mode === 'shared' && ev[1].standby_mode === 'fixed' && ev[1].half_day_weight === 1 && ev[1].install_per_submission === true,
    'Save sends kpi_save_event_settings with the new rules (' + JSON.stringify(ev && ev[1]) + ')');
  ok(/Booth \/ Standby KPI rules saved/.test(await text()), 'a message confirms the save');
  await card.locator('[data-booth-mode="higher"]').check(); await sleep(150);
  ok(!(await card.locator('[data-half-weight]').count()), 'the half-day share setting only shows for "Shared by Booth Tag"');

  ok(errs.length === 0, 'no page errors ' + errs.slice(0, 3).join(' | '));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('HARNESS ' + e.message); process.exit(1); });

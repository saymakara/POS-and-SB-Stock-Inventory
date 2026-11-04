// Phone App Review: multiple select + permanent delete (4 Nov 2026), against the stand-in Supabase API.
// Super Admin: tick boxes on POS Terminal / KHQR / Merchant Visit / Credit Card, Delete (type DELETE) -> admin_delete_phone_records.
// Approved POS records are never selectable. An Admin sees no delete and no tick boxes outside waiting POS records.
// Run against a built dist/ (VITE_SUPABASE_URL = the stand-in address) served on 127.0.0.1:8500. Never touches live data.
process.env.N_DEV = process.env.N_DEV || '300';
const S = require('./lib/standin.js');
const { chromium, B, state, sleep, USERS } = S;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const IGNORE = /WebSocket connection to .*realtime|Failed to load resource|ERR_TUNNEL|net::ERR/;

USERS['7777@staff.pos-sb-inventory.internal'] = { id: 'u-ad', pw: 'Admin123', profile: { user_id: 'u-ad', emp_id: '7777', name: 'ADMIN Test', role: 'ADMIN', branch_id: '100', position: null, active: true, must_change_password: false } };
const now = Date.now(), iso = (m) => new Date(now - m * 60000).toISOString();
// ---- data
const visits = Array.from({ length: 6 }, (_, i) => ({ id: 7000 + i, record_id: 'REG-20261104-000' + (i + 1), activity: 'KHQR Issue', merchant_name: 'Shop ' + i, mid: '2000000000' + i,
  location: 'Phnom Penh', khan: '', latitude: null, longitude: null, remarks: '', answers: {}, photo_link: null, staff_id: 'STF1', staff_name: 'Staff 1',
  branch_text: 'Toul Kork Branch', branch_id: '105', submitted_at: iso(i * 10), edited_at: null }));
const qrs = Array.from({ length: 3 }, (_, i) => ({ id: 8000 + i, record_id: 'QR-20261104-00000' + (i + 1), request_id: 'r' + i, session_id: 's' + i, activity: 'NEW_INSTALLATION',
  staff_id: 'STF1', staff_name: 'Staff 1', branch_text: 'Toul Kork Branch', branch_id: '105', merchant_name: 'QR Shop ' + i, merchant_name_kh: null, mid: '12345678901234' + i,
  qr_expected: 1, qr_count: 1, failed_attempts: 0, status: 'COMPLETED', attempts: [], location: null, khan: null, latitude: null, longitude: null, gps_accuracy: null,
  remark: null, photo_count: 1, telegram_link: null, app_version: '3.66', captured_at: null, submitted_at: iso(i * 5) }));
const attempts = Array.from({ length: 4 }, (_, i) => ({ id: 6000 + i, session_id: 'sx' + i, activity: 'NEW_INSTALLATION', staff_id: 'STF1', staff_name: 'Staff 1',
  branch_text: 'Toul Kork Branch', branch_id: '105', expected_mid: '111111111111111', got_mid: '22222222222222' + i, got_name: 'Wrong ' + i, scanned_count: 1,
  client_at: iso(i), received_at: iso(i), kind: i < 2 ? 'SUBMIT_BLOCKED' : 'WRONG_SCAN' }));
const shared = [{ day: new Date(now).toISOString().slice(0, 10), mid: '123456789012341', merchant_name: 'QR Shop 1', staff_count: 2, entries: 2, branches: 'Toul Kork',
  first_at: iso(20), last_at: iso(5), items: [
    { record_id: 'QR-20261104-000002', staff_id: 'STF1', staff_name: 'Staff 1', branch: 'Toul Kork', activity: 'NEW_INSTALLATION', qr: 1, at: iso(20) },
    { record_id: 'QR-20261104-000003', staff_id: 'STF2', staff_name: 'Staff 2', branch: 'Toul Kork', activity: 'NEW_INSTALLATION', qr: 1, at: iso(5) }] }];
const ccs = Array.from({ length: 2 }, (_, i) => ({ id: 9500 + i, record_id: 'CC-20261104-000' + (i + 1), request_type: 'New Credit Card Request', card_status: 'Onboarded Successfully',
  full_name: 'Customer ' + i, contact: null, supplementary: [], photo_count: 1, staff_id: 'STF1', staff_name: 'Staff 1', branch_text: 'Toul Kork Branch', branch_id: '105',
  submitted_at: iso(i * 7), review_status: 'PENDING', review_history: [], limit_usd: 1000 }));
const posDev = state.devices.find((d) => d.type === 'POS Terminal');
const fe = (id, status, rec) => ({ id, source_record_id: rec, unit_no: 1, revision: 1, kind: 'INSTALL', device_type: 'POS Terminal', serial: posDev.serial, old_serial: null,
  mid: '200000000099' + id, tid: '0099' + id, terminal_name: 'Till', outlet_name: 'Del Test ' + status, branch_text: 'Toul Kork', branch_id: '105', staff_id: 'STF1', staff_name: 'Staff 1',
  recorded_at: iso(1), payload: {}, issues: [], status, received_at: iso(1) });
state.events.unshift(fe(9101, 'REJECTED', 'POS-DEL-0001'), fe(9102, 'APPROVED', 'POS-DEL-0002'), fe(9103, 'PENDING', 'POS-DEL-0003'));
const calls = [];
const json = (route, code, o, h) => route.fulfill({ status: code, contentType: 'application/json', headers: Object.assign({ 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' }, h || {}), body: JSON.stringify(o) });
async function api(route) {
  const req = route.request(), url = new URL(req.url()), path = url.pathname;
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  if (path === '/rest/v1/mv_visits') return json(route, 200, visits, { 'content-range': '0-' + Math.max(0, visits.length - 1) + '/' + visits.length });
  if (path === '/rest/v1/rpc/mv_visit_summary') return json(route, 200, { total: visits.length, staff: 1, branches: 1, no_branch: 0, with_gps: 0, by_activity: [{ activity: 'KHQR Issue', n: visits.length }] });
  if (path === '/rest/v1/qr_installations') return json(route, 200, qrs, { 'content-range': '0-' + Math.max(0, qrs.length - 1) + '/' + qrs.length });
  if (path === '/rest/v1/qr_attempts') {
    const k = url.searchParams.get('kind'); const list = attempts.filter((a) => !k || ('eq.' + a.kind) === k);
    return json(route, 200, list, { 'content-range': (list.length ? '0-' + (list.length - 1) : '*') + '/' + list.length });
  }
  if (path === '/rest/v1/rpc/qr_shared_mids') return json(route, 200, shared.filter((g) => g.items.some((x) => qrs.some((q) => q.record_id === x.record_id))));
  if (path === '/rest/v1/rpc/cc_list') return json(route, 200, { rows: ccs, total: ccs.length, masked: false });
  if (path === '/rest/v1/rpc/admin_delete_phone_records') {
    const p = body.p; calls.push(p);
    const me = S.getMe();
    if (!me || me.profile.role !== 'SUPER_ADMIN') return json(route, 403, { code: '42501', message: 'Only a Super Admin can delete phone app records.' });
    const ids = new Set(p.ids.map(Number)); let deleted = 0; const refused = [];
    const drop = (arr) => { for (let i = arr.length - 1; i >= 0; i--) if (ids.has(arr[i].id)) { if (arr === state.events && arr[i].status === 'APPROVED') { refused.push({ id: arr[i].id, record: arr[i].source_record_id, why: 'Approved' }); continue; } arr.splice(i, 1); deleted++; } };
    if (p.source === 'KHQR' && Array.isArray(p.record_ids)) qrs.filter((q) => p.record_ids.includes(q.record_id)).forEach((q) => ids.add(q.id));
    drop({ VISIT: visits, KHQR: qrs, KHQR_ATTEMPT: attempts, CC: ccs, FIELD: state.events }[p.source]);
    return json(route, 200, { deleted, refused, not_found: 0 });
  }
  return S.api(route);
}
async function signIn(b, emp, pw) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(B + '/**', api);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errs.push(m.text()); });
  await p.goto('http://127.0.0.1:' + (process.env.DIST_PORT || '8500') + '/index.html');
  await p.waitForSelector('#empId', { state: 'visible' });
  await p.fill('#empId', emp); await p.fill('#pw', pw); await p.click('button[type=submit]');
  await p.waitForFunction(() => /Dashboard/.test(document.body.innerText), null, { timeout: 30000 }); await sleep(1200);
  return { ctx, p, errs };
}
const side = (p) => p.locator('aside, nav');
const openPage = async (p, label) => {
  if (!(await side(p).getByText(label, { exact: true }).first().isVisible().catch(() => false))) { await side(p).getByText('Phone App Review', { exact: true }).first().click().catch(() => {}); await sleep(500); }
  await side(p).getByText(label, { exact: true }).first().click(); await sleep(1800);
};
async function confirmDelete(p, reason) {
  const dlg = p.locator('[role="dialog"][aria-labelledby="del-title"]');
  await dlg.waitFor({ state: 'visible', timeout: 5000 });
  const btn = dlg.getByRole('button', { name: /Delete permanently/ });
  const disabledBefore = await btn.isDisabled();
  await dlg.getByLabel('Type DELETE to confirm').fill('delete');
  if (reason) await dlg.locator('input').first().fill(reason);
  const enabledAfter = !(await btn.isDisabled());
  await btn.click(); await sleep(1500);
  return { disabledBefore, enabledAfter, closed: !(await dlg.isVisible().catch(() => false)) };
}

(async () => {
  const b = await chromium.launch();
  // ===== Super Admin
  let { ctx, p, errs } = await signIn(b, '8986', 'Secret123');
  // Merchant Visit
  await openPage(p, 'Merchant Visit');
  ok(await p.getByLabel('Select this page').count() === 1 && await p.getByLabel('Select REG-20261104-0001').count() === 1, 'Merchant Visit: tick boxes for a Super Admin');
  await p.getByLabel('Select REG-20261104-0001').click(); await p.getByLabel('Select REG-20261104-0002').click(); await sleep(300);
  ok(/2 Selected/.test(await p.textContent('main')) && !(await p.locator('[aria-expanded="true"]').count()), 'two ticked; ticking does not open the rows');
  await p.getByRole('button', { name: /Delete 2 permanently/ }).click();
  let c = await confirmDelete(p, 'Test entries');
  ok(c.disabledBefore && c.enabledAfter && c.closed, 'dialog: Delete stays locked until DELETE is typed, then closes');
  let last = calls[calls.length - 1];
  ok(last && last.source === 'VISIT' && JSON.stringify(last.ids.sort()) === JSON.stringify([7000, 7001]) && last.reason === 'Test entries', 'Merchant Visit: deleted 2 with the reason (' + JSON.stringify(last) + ')');
  ok(visits.length === 4 && !(await p.getByLabel('Select REG-20261104-0001').count()), 'the deleted visits are gone from the list');
  await p.getByLabel('Select this page').click(); await sleep(300);
  ok(/4 Selected/.test(await p.textContent('main')), '"select this page" ticks every visit on the page');
  await p.getByRole('button', { name: /Clear selection/ }).click(); await sleep(300);
  ok(!/Selected/.test(await p.textContent('main')), 'clear selection');
  // POS Terminal: rejected + waiting selectable, approved never
  await openPage(p, 'POS Terminal');
  await p.locator('button', { hasText: /^All\s*\(/ }).first().click(); await sleep(1200);
  const REC = { REJECTED: 'POS-DEL-0001', APPROVED: 'POS-DEL-0002', PENDING: 'POS-DEL-0003' };
  const rowOf = (status) => p.locator('div.border-b', { hasText: REC[status] }).first();
  const boxIn = async (status) => (await rowOf(status).count()) ? await rowOf(status).locator('button[aria-pressed]').count() : -1;
  const nRej = await boxIn('REJECTED'), nApp = await boxIn('APPROVED'), nPen = await boxIn('PENDING');
  ok(nRej >= 1 && nApp === 0 && nPen >= 1, 'POS: rejected and waiting records have a tick box, approved does not (' + [nRej, nApp, nPen] + ')');
  await rowOf('REJECTED').locator('button[aria-pressed]').first().click(); await rowOf('PENDING').locator('button[aria-pressed]').first().click(); await sleep(300);
  const bar = p.locator('[aria-label="Decide the selected records"]');
  ok(/2 Selected/.test(await bar.textContent()) && /Approve 1/.test(await bar.textContent()) && /Delete 2/.test(await bar.textContent()), 'POS bar: 2 selected, Approve / Reject for the 1 waiting, Delete 2');
  await bar.getByRole('button', { name: /Delete 2/ }).click();
  c = await confirmDelete(p, '');
  last = calls[calls.length - 1];
  ok(last.source === 'FIELD' && JSON.stringify(last.ids.sort()) === JSON.stringify([9101, 9103]) && c.closed, 'POS: deleted the rejected and the waiting record, never the approved (' + JSON.stringify(last.ids) + ')');
  ok(!(await p.locator('div.border-b', { hasText: 'POS-DEL-0001' }).count()) && await p.locator('div.border-b', { hasText: 'POS-DEL-0002' }).count() >= 1, 'POS list: deleted rows gone, approved row stays');
  // KHQR
  const mouseClick = async (loc) => { const bx = await loc.boundingBox(); await p.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2); await sleep(250); };
  await openPage(p, 'KHQR');
  await mouseClick(p.getByLabel('Select QR-20261104-000001'));
  ok(/1 Selected/.test(await p.textContent('main')) && await p.getByLabel('Select QR-20261104-000001').getAttribute('aria-pressed') === 'true', 'KHQR: a real mouse click ticks the box');
  await p.getByRole('button', { name: /Delete 1 permanently/ }).click();
  c = await confirmDelete(p, '');
  last = calls[calls.length - 1];
  ok(last.source === 'KHQR' && JSON.stringify(last.ids) === JSON.stringify([8000]) && qrs.length === 2, 'KHQR: deleted 1 entry');
  // Credit Card
  await openPage(p, 'Credit Card');
  await mouseClick(p.getByLabel('Select CC-20261104-0002'));
  ok(/1 Selected/.test(await p.textContent('main')), 'Credit Card: a real mouse click ticks the box');
  await p.getByRole('button', { name: /Delete 1 permanently/ }).click();
  c = await confirmDelete(p, '');
  last = calls[calls.length - 1];
  ok(last.source === 'CC' && JSON.stringify(last.ids) === JSON.stringify([9501]) && ccs.length === 1, 'Credit Card: deleted 1 entry');
  // KHQR: failed attempts, wrong scans, same MID
  await openPage(p, 'KHQR');
  await p.getByText('Wrong Scan', { exact: true }).first().click(); await sleep(1500);
  ok(await p.getByLabel(/^Select wrong scan /).count() === 2, 'KHQR Wrong scans: a tick box on each wrong scan (' + await p.getByLabel(/^Select wrong scan /).count() + ')');
  await mouseClick(p.getByLabel(/^Select wrong scan /).first());
  await p.getByRole('button', { name: /Delete 1 permanently/ }).click();
  c = await confirmDelete(p, '');
  last = calls[calls.length - 1];
  ok(last.source === 'KHQR_ATTEMPT' && last.ids.length === 1 && attempts.filter((a) => a.kind === 'WRONG_SCAN').length === 1, 'KHQR: deleted 1 wrong scan (' + JSON.stringify(last.ids) + ')');
  const failCard = p.getByText(/^Failed Attempts?$/).first();
  if (await failCard.count()) { await failCard.click(); await sleep(1500); }
  ok(await p.getByLabel(/^Select failed attempt /).count() === 2, 'KHQR Failed attempts: a tick box on each (' + await p.getByLabel(/^Select failed attempt /).count() + ')');
  await p.getByLabel('Select this page').first().click(); await sleep(250);
  await p.getByRole('button', { name: /Delete 2 permanently/ }).click();
  c = await confirmDelete(p, 'test');
  last = calls[calls.length - 1];
  ok(last.source === 'KHQR_ATTEMPT' && last.ids.length === 2 && attempts.filter((a) => a.kind === 'SUBMIT_BLOCKED').length === 0, 'KHQR: deleted the 2 failed attempts with "select this page"');
  await p.getByText('Same MID, 2+ staff', { exact: true }).first().click(); await sleep(1500);
  const grp = p.getByLabel(/^Select all entries of MID /).first();
  ok(await grp.count() === 1, 'KHQR Same MID: a tick box on the group');
  await mouseClick(grp);
  ok(/2 Selected/.test(await p.textContent('main')), 'ticking the group selects its 2 entries');
  await p.getByRole('button', { name: /Delete 2 permanently/ }).click();
  c = await confirmDelete(p, '');
  last = calls[calls.length - 1];
  ok(last.source === 'KHQR' && JSON.stringify((last.record_ids || []).sort()) === JSON.stringify(['QR-20261104-000002', 'QR-20261104-000003']) && qrs.length === 0,
    'KHQR Same MID: deleted the 2 entries by Record ID (' + JSON.stringify(last.record_ids) + ')');
  ok(errs.length === 0, 'Super Admin: no page or console errors ' + errs.slice(0, 3).join(' | '));
  await ctx.close();
  // ===== Super Admin on a tablet (touch): tap the boxes
  qrs.push({ ...qrs[0] || {}, id: 8100, record_id: 'QR-20261104-000100', request_id: 'r100', session_id: 's100', activity: 'NEW_INSTALLATION', staff_id: 'STF1', staff_name: 'Staff 1',
    branch_text: 'Toul Kork Branch', branch_id: '105', merchant_name: 'Tap Shop', merchant_name_kh: null, mid: '123456789012999', qr_expected: 1, qr_count: 1, failed_attempts: 0,
    status: 'COMPLETED', attempts: [], location: null, khan: null, latitude: null, longitude: null, gps_accuracy: null, remark: null, photo_count: 1, telegram_link: null,
    app_version: '3.66', captured_at: null, submitted_at: iso(1) });
  {
    const tctx = await b.newContext({ viewport: { width: 1024, height: 1366 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    await tctx.route(B + '/**', api);
    const tp = await tctx.newPage(); const terrs = []; tp.on('pageerror', (e) => terrs.push(e.message));
    await tp.goto('http://127.0.0.1:' + (process.env.DIST_PORT || '8500') + '/index.html'); await tp.waitForSelector('#empId', { state: 'visible' });
    await tp.fill('#empId', '8986'); await tp.fill('#pw', 'Secret123'); await tp.click('button[type=submit]');
    await tp.waitForFunction(() => /Dashboard/.test(document.body.innerText), null, { timeout: 30000 }); await sleep(1200);
    const tside = tp.locator('aside, nav');
    const topen = async (label) => {
      if (!(await tside.getByText(label, { exact: true }).first().isVisible().catch(() => false))) {
        const menu = tp.getByRole('button', { name: /menu|sidebar/i }).first(); if (await menu.count()) { await menu.tap().catch(() => {}); await sleep(500); }
        await tside.getByText('Phone App Review', { exact: true }).first().tap().catch(() => {}); await sleep(500);
      }
      await tside.getByText(label, { exact: true }).first().tap(); await sleep(1800);
    };
    await topen('KHQR');
    await tp.getByLabel('Select QR-20261104-000100').tap(); await sleep(300);
    ok(await tp.getByLabel('Select QR-20261104-000100').getAttribute('aria-pressed') === 'true', 'tablet: tapping the KHQR box ticks it');
    await topen('Credit Card');
    await tp.getByLabel('Select CC-20261104-0001').tap(); await sleep(300);
    ok(await tp.getByLabel('Select CC-20261104-0001').getAttribute('aria-pressed') === 'true', 'tablet: tapping the Credit Card box ticks it');
    ok(terrs.length === 0, 'tablet: no page errors ' + terrs.join(' | '));
    await tctx.close();
  }
  ({ ctx, p, errs } = await signIn(b, '8986', 'Secret123'));
  await ctx.close();
  // ===== Admin (not Super Admin)
  ({ ctx, p, errs } = await signIn(b, '7777', 'Admin123'));
  const before = calls.length;
  await openPage(p, 'Merchant Visit');
  ok(await p.getByLabel(/^Select REG-/).count() === 0 && await p.getByLabel('Select this page').count() === 0, 'Admin: no tick boxes on Merchant Visit');
  await openPage(p, 'KHQR');
  ok(await p.getByLabel(/^Select QR-/).count() === 0, 'Admin: no tick boxes on KHQR');
  await openPage(p, 'Credit Card');
  ok(await p.getByLabel(/^Select CC-/).count() === 0, 'Admin: no tick boxes on Credit Card');
  await openPage(p, 'POS Terminal');
  await p.locator('button', { hasText: /^All\s*\(/ }).first().click(); await sleep(1200);
  ok(await boxIn('APPROVED') === 0, 'Admin POS: approved not selectable');
  const firstBox = p.locator('[aria-label^="Select "][aria-pressed]').first();
  if (await firstBox.count()) { await firstBox.click(); await sleep(300); }
  const bar2 = p.locator('[aria-label="Decide the selected records"]');
  ok((await bar2.count()) === 0 || !/Delete/.test(await bar2.textContent()), 'Admin POS: approve / reject only, no Delete button');
  ok(calls.length === before, 'Admin: no delete call made');
  ok(errs.length === 0, 'Admin: no page or console errors ' + errs.slice(0, 3).join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

// Phone App Review: Edit details (7 Nov 2026), against the stand-in Supabase API. Never touches live data.
// Admin: Edit on POS Terminal, Merchant Visit, Credit Card and KHQR records -> admin_edit_phone_record with only the changed
// fields; an approved POS record shows its serial / MID / TID locked; the earlier changes and their Google Sheet state are
// listed. A branch user has no Edit.
// Run against a built dist/ (VITE_SUPABASE_URL = the stand-in address) served on 127.0.0.1:8500 (node tests/e2e/serve-dist.cjs).
process.env.N_DEV = process.env.N_DEV || '300';
const S = require('./lib/standin.js');
const { chromium, B, state, sleep, USERS } = S;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const IGNORE = /WebSocket connection to .*realtime|Failed to load resource|ERR_TUNNEL|net::ERR/;

USERS['7777@staff.pos-sb-inventory.internal'] = { id: 'u-ad', pw: 'Admin123', profile: { user_id: 'u-ad', emp_id: '7777', name: 'ADMIN Test', role: 'ADMIN', branch_id: '100', position: null, active: true, must_change_password: false } };
USERS['33105@staff.pos-sb-inventory.internal'] = { id: 'u-b105', pw: 'Branch123', profile: { user_id: 'u-b105', emp_id: '33105', name: 'SOK Branch', role: 'BRANCH', branch_id: '105', position: null, active: true, must_change_password: false } };
const now = Date.now(), iso = (m) => new Date(now - m * 60000).toISOString();
const visits = [{ id: 7000, record_id: 'REG-20261107-0001', activity: 'Market Coverage', merchant_name: 'Shop A', mid: '226110554113031', location: 'Phnom Penh', khan: 'Tuol Kouk',
  latitude: null, longitude: null, remarks: 'first', answers: { 'Activity Type': 'Market Coverage', Tag: 'Riverside', 'Merchant Name': 'Shop A', 'MID or Acc Number': '226110554113031', Location: 'Phnom Penh', Khan: 'Tuol Kouk', Remarks: 'first' },
  photo_link: null, staff_id: 'STF1', staff_name: 'Staff 1', branch_text: 'Toul Kork Branch', branch_id: '105', submitted_at: iso(10), edited_at: null }];
const qrs = [{ id: 8000, record_id: 'QR-20261107-000001', request_id: 'r0', session_id: 's0', activity: 'NEW_INSTALLATION', staff_id: 'STF1', staff_name: 'Staff 1', branch_text: 'Toul Kork Branch',
  branch_id: '105', merchant_name: 'QR Shop', merchant_name_kh: null, mid: '226110554113032', qr_expected: 1, qr_count: 1, failed_attempts: 0, status: 'COMPLETED', attempts: [],
  location: 'Phnom Penh', khan: null, latitude: null, longitude: null, gps_accuracy: null, remark: null, photo_count: 1, telegram_link: null, app_version: '3.79', captured_at: null, submitted_at: iso(5) }];
const ccs = [{ id: 9500, record_id: 'CC-20261107-001', request_type: 'New Credit Card Request', card_status: 'Onboarded Successfully', full_name: 'CUSTOMER ONE', contact: '012345678',
  marital: 'Single', primary_acc: '000111222', mid_or_acc: '', limit_usd: 1000, repayment: 'Full Payment 100%', email: '', remarks: '',
  supplementary: [{ full_name: 'SUPP ONE', marital: 'Single', account: '000333444', email: '' }], photo_count: 1, staff_id: 'STF1', staff_name: 'Staff 1',
  branch_text: 'Toul Kork Branch', branch_id: '105', submitted_at: iso(7), review_status: 'PENDING', review_history: [] }];
const posDev = state.devices.find((d) => d.type === 'POS Terminal');
const fe = (id, status, rec) => ({ id, source_record_id: rec, unit_no: 1, revision: 1, kind: 'INSTALL', device_type: 'POS Terminal', serial: posDev.serial, old_serial: null,
  mid: '226110554113' + String(id).slice(-3), tid: '54113' + String(id).slice(-3), terminal_name: 'Till', outlet_name: 'Edit Test ' + status, branch_text: 'Toul Kork', branch_id: '105',
  staff_id: 'STF1', staff_name: 'Staff 1', recorded_at: iso(1), payload: { entry: {}, unit: {} }, issues: [], status, received_at: iso(1), remarks: 'r' });
state.events.unshift(fe(9201, 'PENDING', 'POS-EDIT-0001'), fe(9202, 'APPROVED', 'POS-EDIT-0002'));
const calls = [];
const edits = [{ id: 1, source: 'FIELD', row_id: 9202, changes: { terminal_name: 'Front' }, old_values: { terminal_name: 'Till' }, edited_by: 'ADMIN Test (7777)', edited_at: iso(30), sheet_status: 'APPLIED', sheet_note: null, reason: 'typo' }];
const json = (route, code, o, h) => route.fulfill({ status: code, contentType: 'application/json', headers: Object.assign({ 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' }, h || {}), body: JSON.stringify(o) });
async function api(route) {
  const req = route.request(), url = new URL(req.url()), path = url.pathname;
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  if (path === '/rest/v1/mv_visits') return json(route, 200, visits, { 'content-range': '0-0/1' });
  if (path === '/rest/v1/rpc/mv_visit_summary') return json(route, 200, { total: 1, staff: 1, branches: 1, no_branch: 0, with_gps: 0, by_activity: [{ activity: 'Market Coverage', n: 1 }] });
  if (path === '/rest/v1/qr_installations') return json(route, 200, qrs, { 'content-range': '0-0/1' });
  if (path === '/rest/v1/qr_attempts') return json(route, 200, [], { 'content-range': '*/0' });
  if (path === '/rest/v1/rpc/qr_shared_mids') return json(route, 200, []);
  if (path === '/rest/v1/rpc/cc_list') return json(route, 200, { rows: ccs, total: 1, masked: false });
  if (path === '/rest/v1/phone_record_edits') {
    const src = (url.searchParams.get('source') || '').replace('eq.', ''), row = Number((url.searchParams.get('row_id') || '').replace('eq.', ''));
    return json(route, 200, edits.filter((e) => e.source === src && e.row_id === row));
  }
  if (path === '/rest/v1/rpc/admin_edit_phone_record') {
    const p = body.p; calls.push(p);
    const me = S.getMe();
    if (!me || !['ADMIN', 'SUPER_ADMIN'].includes(me.profile.role)) return json(route, 403, { code: '42501', message: 'Only an Admin or Super Admin can edit phone app records.' });
    if (p.source === 'FIELD') {
      const e = state.events.find((x) => x.id === p.id);
      if (e.status === 'APPROVED' && ['serial', 'mid', 'tid'].some((k) => k in p.changes)) return json(route, 400, { code: 'P0001', message: 'APPROVED: serial cannot be changed on an approved record' });
      Object.assign(e, p.changes);
    }
    if (p.source === 'VISIT') { Object.assign(visits[0].answers, p.changes.answers); if (p.changes.answers['Merchant Name']) visits[0].merchant_name = p.changes.answers['Merchant Name']; }
    if (p.source === 'CC') Object.assign(ccs[0], p.changes);
    if (p.source === 'KHQR') Object.assign(qrs[0], p.changes);
    return json(route, 200, { changed: Object.keys(p.changes.answers || p.changes), record: 'x', sheet: p.source === 'KHQR' ? 'NOT_NEEDED' : 'PENDING' });
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
const dialog = (p) => p.locator('[role="dialog"]').filter({ hasText: 'Reason for the change' });
const field = (p, label) => dialog(p).locator('label').filter({ has: p.locator(`span:text-is("${label}")`) }).locator('input, textarea, select').first();

(async () => {
  const b = await chromium.launch();
  let { ctx, p, errs } = await signIn(b, '7777', 'Admin123');
  // ---- POS Terminal: pending record
  await openPage(p, 'POS Terminal');
  await p.locator('main').getByText(/^All \(\d/).first().click(); await sleep(800);   // every status
  await p.getByPlaceholder(/Search/).first().fill('POS-EDIT-0001'); await sleep(1200);
  await p.locator('main button[aria-expanded]').filter({ hasText: posDev.serial }).first().click(); await sleep(700);   // (the serial opens the record)
  ok(await p.getByTestId('edit-record').first().isVisible(), 'POS Terminal: Edit details in the open record (Admin)');
  await p.getByTestId('edit-record').first().click(); await sleep(800);
  ok(await dialog(p).isVisible(), 'the edit window opens');
  ok(await p.getByTestId('edit-save').isDisabled(), 'Save is off until something changes');
  await field(p, 'Terminal Name').fill('Counter One');
  await field(p, 'Remarks').fill('fixed by HQ');
  ok(/Save 2 changes/.test(await p.getByTestId('edit-save').textContent()), 'Save shows the number of changes');
  await dialog(p).locator('input[placeholder^="e.g. typo"]').fill('typo');
  await p.getByTestId('edit-save').click(); await sleep(1500);
  let c = calls[calls.length - 1];
  ok(c && c.source === 'FIELD' && c.id === 9201 && JSON.stringify(c.changes) === JSON.stringify({ terminal_name: 'Counter One', remarks: 'fixed by HQ' }) && c.reason === 'typo',
    'saved with only the changed fields: ' + JSON.stringify(c));
  ok(!(await dialog(p).isVisible().catch(() => false)) && /Saved 2 changes/.test(await p.textContent('body')), 'window closes, "Saved 2 changes · the Google Sheet follows…"');
  // ---- approved record: stock fields locked, history shown
  await p.getByPlaceholder(/Search/).first().fill('POS-EDIT-0002'); await sleep(1200);
  await p.locator('main button[aria-expanded]').filter({ hasText: posDev.serial }).first().click(); await sleep(700);
  await p.getByTestId('edit-record').first().click(); await sleep(1000);
  const lockedTxt = await dialog(p).textContent();
  ok((lockedTxt.match(/Approved: this already changed the stock/g) || []).length >= 3 && (await field(p, 'Terminal Name').count()) === 1,
    'approved: MID, TID and serial locked with the reason; Terminal Name editable');
  ok(/Earlier changes/.test(lockedTxt) && /In the Google Sheet/.test(lockedTxt) && /Till → Front/.test(lockedTxt), 'earlier changes listed with their Google Sheet state');
  await dialog(p).getByRole('button', { name: 'Cancel' }).click(); await sleep(500);

  // ---- Merchant Visit: answers incl. Tag
  await openPage(p, 'Merchant Visit');
  await p.locator('main').getByText('Shop A').first().click(); await sleep(700);
  await p.getByTestId('edit-record').first().click(); await sleep(800);
  ok((await field(p, 'Tag').inputValue()) === 'Riverside' && (await field(p, 'Activity Type').count()) === 1, 'Merchant Visit: every answer editable (Tag, Activity Type, …)');
  await field(p, 'Tag').fill('Phsar Thmey');
  await p.getByTestId('edit-save').click(); await sleep(1500);
  c = calls[calls.length - 1];
  ok(c && c.source === 'VISIT' && c.id === 7000 && JSON.stringify(c.changes) === JSON.stringify({ answers: { Tag: 'Phsar Thmey' } }), 'visit saved through its answers: ' + JSON.stringify(c && c.changes));

  // ---- Credit Card: a supplementary card
  await openPage(p, 'Credit Card');
  await p.locator('main').getByText('CUSTOMER ONE').first().click(); await sleep(700);
  await p.getByTestId('edit-record').first().click(); await sleep(800);
  const supp = dialog(p).locator('h3', { hasText: 'Supplementary card 1' });
  ok(await supp.count() === 1, 'Credit Card: customer fields and each supplementary card');
  await dialog(p).locator('label').filter({ hasText: 'Full name' }).nth(1).locator('input').fill('SUPP UNO');
  await p.getByTestId('edit-save').click(); await sleep(1500);
  c = calls[calls.length - 1];
  ok(c && c.source === 'CC' && Array.isArray(c.changes.supplementary) && c.changes.supplementary[0].full_name === 'SUPP UNO' && c.changes.supplementary[0].account === '000333444'
    && Object.keys(c.changes).length === 1, 'supplementary cards sent as the whole list: ' + JSON.stringify(c && c.changes));

  // ---- KHQR: portal only
  await openPage(p, 'KHQR');
  await p.locator('main').getByText('QR Shop').first().click(); await sleep(700);
  await p.getByTestId('edit-record').first().click(); await sleep(800);
  ok(/kept only in the portal/.test(await dialog(p).textContent()), 'KHQR: the window says it is portal only');
  await field(p, 'Merchant name').fill('QR Shop 2');
  await p.getByTestId('edit-save').click(); await sleep(1500);
  c = calls[calls.length - 1];
  ok(c && c.source === 'KHQR' && c.changes.merchant_name === 'QR Shop 2', 'KHQR saved');
  ok(!errs.length, 'Admin: no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await ctx.close();

  // ---- branch user: no Edit
  ({ ctx, p, errs } = await signIn(b, '33105', 'Branch123'));
  const n0 = calls.length;
  if (await side(p).getByText('Phone App Review', { exact: true }).first().isVisible().catch(() => false)) {
    await openPage(p, 'Merchant Visit');
    await p.locator('main').getByText('Shop A').first().click().catch(() => {}); await sleep(700);
  }
  ok(await p.getByTestId('edit-record').count() === 0 && calls.length === n0, 'branch user: no Edit details');
  await ctx.close();
  await b.close();
  console.log(fails ? 'FAILED ' + fails : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('HARNESS ' + e.message); process.exit(2); });

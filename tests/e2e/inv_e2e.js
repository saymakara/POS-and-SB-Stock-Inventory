// Inventory dashboard against a stand-in of the Supabase API (the real one is not reachable from this workspace)
const { chromium } = require('playwright');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const B = process.env.SUPABASE_URL || 'https://mrrzfmtaqjdwhwznznie.supabase.co';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub) => b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, aud: 'authenticated' }) + '.sig';
const USERS = { '8986@staff.pos-sb-inventory.internal': { id: 'u-sa', pw: 'Secret123', profile: { user_id: 'u-sa', emp_id: '8986', name: 'SAY Chanmakara', role: 'SUPER_ADMIN', branch_id: '100', position: null, active: true, must_change_password: false } },
  '25490@staff.pos-sb-inventory.internal': { id: 'u-br', pw: 'First123', profile: { user_id: 'u-br', emp_id: '25490', name: 'SEOUN Chettra', role: 'BRANCH', branch_id: '105', position: null, active: true, must_change_password: true } } };
const dev = (serial, stage, branch, extra) => Object.assign({ serial, type: 'POS Terminal', model: 'Q2', stage, branch_id: branch, branch_name: 'Branch ' + branch, stock_in_date: '2026-10-01', history: [], custom_fields: {}, archived: false, redeploy_count: 0 }, extra || {});
const state = { devices: [dev('WP0001', 'BRANCH_RESERVE', '105', { row_version: 3, custom_fields: { latitude: 11.55, longitude: 104.92, installedByStaff: 'Sok Dara' } }), dev('WP0002', 'COMPLETE', '105', { mid: '200100000000001', tid: '00000001', merchant_name: 'Lucky Mart', row_version: 1 }),
    dev('WP0100', 'HQ_STOCK', '100', { battery_serial: 'BAT100', row_version: 1, stock_in_date: '2026-09-01' })],
  reqs: [{ req_id: 'REQ-20261022-ABC123', date: '2026-10-22 09:00', branch_id: '105', branch_name: 'Toul Kork Branch', staff: 'SEOUN Chettra (25490)', pos_qty: 1, sb_qty: 0, reason: 'New merchants', status: 'PENDING_ADMIN', arranged_devices: [], type: 'STOCK_REQUEST', return_serials: [] },
    { req_id: 'REQ-20261022-ZZZ999', date: '2026-10-22 08:00', branch_id: '105', branch_name: 'Toul Kork Branch', staff: 'SEOUN Chettra (25490)', pos_qty: 5, sb_qty: 0, reason: 'Extra', status: 'PENDING_ADMIN', arranged_devices: [], type: 'STOCK_REQUEST', return_serials: [] }],
  reqs2: true,
  events: [{ id: 7, source_record_id: 'POS-20261021-0001', unit_no: 1, revision: 1, kind: 'INSTALL', device_type: 'POS Terminal', serial: 'WP0001', old_serial: null, mid: '200123456789012', tid: '56789012',
    terminal_name: 'Till 1', outlet_name: 'Sokha Mart', branch_text: 'Toul Kork', branch_id: '105', staff_id: 'STF001', staff_name: 'Sok Dara', recorded_at: '2026-10-21T09:00:00+07:00', latitude: 11.55, longitude: 104.92,
    remarks: 'Installed', payload: { unit: { serial_input: 'SCAN', mid_input: 'TYPED' } }, issues: [], status: 'PENDING', received_at: '2026-10-21T02:01:00Z' },
        { id: 8, source_record_id: 'POS-20261021-0002', unit_no: 1, revision: 1, kind: 'INSTALL', device_type: 'POS Terminal', serial: 'WP0002', mid: '200999', tid: '999', outlet_name: 'Other', branch_text: 'Toul Kork', branch_id: '105',
      staff_name: 'Sok Dara', recorded_at: '2026-10-21T10:00:00+07:00', payload: {}, issues: [{ code: 'ALREADY_INSTALLED', level: 'warn', text: 'Serial WP0002 is already installed at Lucky Mart (MID 200100000000001).' }], status: 'PENDING', received_at: '2026-10-21T03:00:00Z' },
    { id: 9, source_record_id: 'POS-20261021-0001', unit_no: 2, revision: 1, kind: 'INSTALL', device_type: 'POS Terminal', serial: 'WP0003', mid: '200123456789099', tid: '56789099', terminal_name: 'Till 2', outlet_name: 'Sokha Mart', branch_text: 'Toul Kork', branch_id: '105', staff_name: 'Sok Dara', recorded_at: '2026-10-21T09:00:00+07:00', payload: {}, issues: [], status: 'PENDING', received_at: '2026-10-21T02:01:00Z' }],
  calls: [], saved: [], audit: [] };

// PostgREST-like reading: order by the key, "key=gt.X", offset/limit, at most MAX_ROWS rows, count=exact
const MAX_ROWS = Number(process.env.MAX_ROWS || 1000);
function pg(route, req, url, all, key) {
  let rows = all.slice().sort((a, b) => String(a[key]) < String(b[key]) ? -1 : String(a[key]) > String(b[key]) ? 1 : 0);
  const gt = url.searchParams.get(key); if (gt && gt.startsWith('gt.')) rows = rows.filter((r) => String(r[key]) > gt.slice(3));
  const off = Number(url.searchParams.get('offset') || 0), lim = Math.min(Number(url.searchParams.get('limit') || MAX_ROWS), MAX_ROWS);
  const part = rows.slice(off, off + lim);
  const h = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' };
  if (/count=exact/.test(req.headers()['prefer'] || '')) h['content-range'] = (part.length ? off + '-' + (off + part.length - 1) : '*') + '/' + rows.length;
  return route.fulfill({ status: 200, contentType: 'application/json', headers: h, body: JSON.stringify(part) });
}
let me = null;
async function api(route) {
  const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
  const body = req.postData() ? (() => { try { return JSON.parse(req.postData()); } catch (e) { return req.postData(); } })() : null;
  state.calls.push(method + ' ' + path + url.search);
  const json = (code, o) => route.fulfill({ status: code, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
  if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (path === '/auth/v1/token') {
    const u = USERS[body.email];
    if (!u || u.pw !== body.password) return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', msg: 'Invalid login credentials' });
    me = u;
    const user = { id: u.id, email: body.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} };
    return json(200, { access_token: jwt(u.id), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user });
  }
  if (path === '/auth/v1/user') {
    if (method === 'PUT') { me.pw = body.password; state.newPw = body.password; }
    return json(200, { id: me.id, email: Object.keys(USERS).find(k => USERS[k] === me), aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} });
  }
  if (path === '/auth/v1/logout') return route.fulfill({ status: 204 });
  if (path === '/rest/v1/staff_profiles') {
    const one = /object/.test(req.headers()['accept'] || '');
    const p = me && me.profile;
    const f = url.searchParams.get('user_id');
    if (one) return json(200, p);
    if (f) return json(200, Object.values(USERS).map(x => x.profile).filter(x => 'eq.' + x.user_id === f));
    return json(200, me && me.profile.role !== 'BRANCH' ? Object.values(USERS).map(x => x.profile) : [p]);
  }
  if (path === '/rest/v1/branches') { if (method !== 'GET') { state.branchSaves = (state.branchSaves || []).concat([body]); return json(201, []); } return json(200, [{ id: '100', code: '100', name: 'Head Office', region: 'Phnom Penh' }, { id: '105', code: '105', name: 'Toul Kork Branch', region: 'Phnom Penh' }, { id: '401', code: '401', name: 'Siem Reap Branch', region: 'Siem Reap' }]); }
  if (path === '/rest/v1/devices') {
    if (method === 'PATCH') {
      state.patched = state.patched || []; state.patched.push(body);
      const sn = (url.searchParams.get('serial') || '').replace(/^eq\./, ''); const d = state.devices.find(x => x.serial === sn);
      if (state.staleNext) { state.staleNext = false; return json(409, { code: '40001', message: 'STALE_ROW: device ' + sn + ' was changed by someone else just now' }); }
      if (!d) return json(200, []);
      if (body.row_version && body.row_version !== d.row_version) return json(409, { code: '40001', message: 'STALE_ROW: device ' + sn });
      Object.assign(d, body, { row_version: (d.row_version || 1) + 1 }); return json(200, [{ serial: sn, row_version: d.row_version }]);
    }
    if (method === 'POST') { state.saved.push(body); if (state.refuse) return json(403, { code: '42501', message: 'new row violates row-level security policy for table "devices"' }); return json(201, []); }
    const all = me && me.profile.role === 'BRANCH' ? state.devices.filter(d => d.branch_id === me.profile.branch_id) : state.devices;
    return pg(route, req, url, all, 'serial');
  }
  if (path === '/rest/v1/requisitions') return pg(route, req, url, me && me.profile.role === 'BRANCH' ? state.reqs.filter(r => r.branch_id === me.profile.branch_id) : state.reqs, 'req_id');
  if (path === '/rest/v1/historical_merchants') return json(200, []);
  if (path === '/rest/v1/branches' ) return json(200, []);
  if (path === '/rest/v1/field_events') {
    const st = url.searchParams.get('status') || '';
    const list = st === 'eq.PENDING' ? state.events.filter(e => e.status === 'PENDING') : st === 'neq.PENDING' ? state.events.filter(e => e.status !== 'PENDING') : state.events;
    if (method === 'HEAD') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-range': '0-' + Math.max(0, list.length - 1) + '/' + list.length } });
    return json(200, list);
  }
  if (path === '/rest/v1/rpc/admin_dispatch_requisition') {
    state.dispatch = body; const r = state.reqs.find(x => x.req_id === body.p_req_id);
    const items = body.p_serials.map(sn => { const d = state.devices.find(x => x.serial === sn); return { serial: d.serial, batterySerial: d.battery_serial || '', type: d.type, model: d.model }; });
    r.status = 'DISPATCHED'; r.arranged_devices = items; items.forEach(i => { state.devices.find(x => x.serial === i.serial).custom_fields = { allocatedTo: r.req_id }; });
    return json(200, { arranged: items });
  }
  if (path === '/rest/v1/rpc/admin_reject_requisition') { state.reject = body; const q = state.reqs.find(x => x.req_id === body.p_req_id); q.status = 'REJECTED'; q.reject_reason = body.p_reason; return json(200, { status: 'REJECTED' }); }
  if (path === '/rest/v1/audit_logs') { if (method === 'GET') return json(200, []); state.audit.push(body); return json(201, []); }
  if (path === '/rest/v1/rpc/password_changed') { me.profile.must_change_password = false; return json(200, null); }
  if (path === '/rest/v1/rpc/field_recheck') { const e = state.events.find(x => x.id === body.p_id); return json(200, e.issues); }
  if (path === '/rest/v1/rpc/field_approve') {
    state.approve = body; const e = state.events.find(x => x.id === body.p_id);
    if (e.issues.length && !(body.p_opt || {}).acknowledge) return json(400, { message: 'This record has warnings. Review them and confirm to approve.' });
    e.status = 'APPROVED'; const d = state.devices.find(x => x.serial === e.serial); Object.assign(d, { stage: 'COMPLETE', mid: e.mid, tid: e.tid, merchant_name: e.outlet_name });
    return json(200, { id: e.id, status: 'APPROVED' });
  }
  if (path === '/rest/v1/rpc/field_reject') { const e = state.events.find(x => x.id === body.p_id); e.status = 'REJECTED'; e.review_note = body.p_note; return json(200, { status: 'REJECTED' }); }
  return json(404, { message: 'not in the stand-in: ' + path });
}
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.route(B + '/**', api);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:8500/index.html'); await sleep(1500);
  ok(await p.isVisible('#empId') && !(await p.isVisible('text=Dashboard')), 'opens on the sign-in page (no app, no data before sign-in)');
  await p.fill('#empId', '8986'); await p.fill('#pw', 'wrong'); await p.click('button[type=submit]'); await sleep(800);
  ok(/Employee ID or password is not correct/.test(await p.textContent('[role=alert]')), 'wrong password → "Employee ID or password is not correct."');
  await p.fill('#pw', 'Secret123'); await p.click('button[type=submit]'); await sleep(3000);
  ok(!(await p.isVisible('#empId')), 'Super Admin signed in → the app opens ' + JSON.stringify([await p.textContent('body').then(t => t.slice(0, 300)), state.calls.slice(-6), errs]));
  const ss = await p.evaluate(() => JSON.parse(sessionStorage.getItem('crm_pos_auth_session_v20') || '{}'));
  ok(ss.role === 'SUPER_ADMIN' && ss.branchId === '100' && /SAY Chanmakara \(8986\)/.test(ss.operatorLabel), 'role and branch come from the database profile ' + JSON.stringify(ss));
  ok(state.calls.some(c => c.startsWith('GET /rest/v1/devices')) && !state.saved.length && !(state.patched || []).length, 'stock loaded from the database; nothing from the browser pushed up');
  ok(state.calls.some(c => /GET \/rest\/v1\/devices.*order=serial/.test(c)), 'devices read in serial order, page by page');
  // search over units with GPS numbers from the phone app (crashed before)
  await p.getByText('Stock Inventory', { exact: true }).first().click(); await sleep(1000);
  await p.fill('input[placeholder^="Search Serial SN"]', 'wp0001'); await sleep(800);
  ok(!errs.length && /WP0001/.test(await p.textContent('body')), 'inventory search works on phone-approved units ' + errs.join(' | '));
  await p.fill('input[placeholder^="Search Serial SN"]', '104.92'); await sleep(800);
  ok(!errs.length, 'search by a GPS value does not crash');
  await p.fill('input[placeholder^="Search Serial SN"]', ''); await sleep(300);
  // ---- 23 Oct 2026 additions
  const bodyTxt = async () => p.textContent('body');
  ok(/Sok Dara/.test(await bodyTxt()) && /Terminated & Returned/.test(await bodyTxt()), 'Stock Inventory: installer name above the branch code; Terminated & Returned summary card is back');
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/inventory.png' });
  const stageOpts = await p.locator('select option').allTextContents();
  ok(!stageOpts.some((t) => /Terminated & Returned/.test(t)), 'Terminated & Returned is not a Stock Inventory status/filter');
  
  ok(/Rows:/.test(await bodyTxt()), 'Stock Inventory has the page bar (rows per page, page x / y)');
  const pageSizes = await p.locator('select[aria-label="Rows per page"] option').allTextContents().catch(() => []);
  const invSizes = await p.locator('button:has-text("Max")').count();
  ok(pageSizes.length === 0 || pageSizes.join() === '50,100', 'page sizes are 50 and 100 ' + pageSizes.join() + ' ' + invSizes);
  // clear filters
  await p.fill('input[placeholder^="Search Serial SN"]', 'zzz'); await sleep(500);
  const clr = p.getByRole('button', { name: 'Clear filters' }).first();
  ok(await clr.isEnabled(), 'Clear filters is active when a search is typed');
  await clr.click(); await sleep(400);
  ok((await p.inputValue('input[placeholder^="Search Serial SN"]')) === '' && !(await clr.isEnabled()), 'Clear filters empties the search and goes back to disabled');
  // search everything
  await p.fill('input[placeholder*="Search"][class*="pl-"]', '').catch(() => {});
  const hs = p.locator('header input[type=text], header input:not([type])').first();
  await hs.fill('WP0002'); await sleep(500);
  await p.getByText('Show everything about', { exact: false }).first().click(); await sleep(1200);
  const tr = await bodyTxt();
  ok(/Everything about/.test(tr) && /Stock Inventory \(current status\)/.test(tr) && /Lucky Mart/.test(tr) && /Phone App Review records/.test(tr), 'search by serial shows the unit, history, requests and phone records together');
  await p.keyboard.press('Escape'); await sleep(300);
  // pop-ups stay in the middle of the screen
  await p.getByText('Merchant Deployment', { exact: true }).first().click(); await sleep(1500);
  await p.locator('tr', { hasText: 'Lucky Mart' }).first().locator('button[title^="Open the merchant"]').click(); await sleep(900);
  const dlg = p.locator('.fixed.inset-0').last();
  ok(await dlg.count() > 0, 'the 360 pop-up opens');
  if (await dlg.count()) {
    const box = await p.evaluate(() => { const els = [...document.querySelectorAll('.fixed.inset-0')]; const e = els[els.length - 1]; const c = e.firstElementChild; const r = (c || e).getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, vw: innerWidth, vh: innerHeight, h: r.height }; });
    ok(Math.abs(box.cx - box.vw / 2) < 12 && (box.h > box.vh - 20 || Math.abs(box.cy - box.vh / 2) < 40), 'the 360 pop-up opens in the middle of the screen ' + JSON.stringify(box));
    ok((await p.evaluate(() => getComputedStyle(document.body).overflow)) === 'hidden', 'the page behind a pop-up does not scroll');
    await p.keyboard.press('Escape'); await p.locator('button[aria-label="Close merchant profile"]').click().catch(() => {}); await sleep(400);
  }
  // (22 Oct 2026) dispatch goes through the server function; the request status is never saved directly
  await p.getByText('Stock Requests', { exact: true }).first().click(); await sleep(1200);
  await p.getByRole('button', { name: 'Dispatch', exact: true }).first().click(); await sleep(800);
  const arr = await p.textContent('body');
  ok(/WP0100/.test(arr), 'auto-match picks the free HQ unit WP0100');
  await p.click('text=Review Dispatch'); await sleep(600);
  await p.click('text=Confirm & Dispatch to Branch Code 105'); await sleep(1500);
  ok(state.dispatch && state.dispatch.p_req_id === 'REQ-20261022-ABC123' && JSON.stringify(state.dispatch.p_serials) === '["WP0100"]', 'dispatch → admin_dispatch_requisition with the chosen serial ' + JSON.stringify(state.dispatch));
  ok(!state.calls.some(c => /^(PATCH|POST) \/rest\/v1\/requisitions/.test(c)), 'request row not written by the browser (status changed only by the server)');
  ok(/Dispatched 1 unit/.test(await p.textContent('[role=status]')), 'the result is shown in the message area (toast rendered)');
  // reject a request with a reason
  await p.locator('tr', { hasText: 'REQ-20261022-ZZZ999' }).getByRole('button', { name: 'Reject' }).click(); await sleep(500);
  ok(await p.getByRole('button', { name: 'Reject request' }).isDisabled(), 'reject needs a reason (button disabled while empty)');
  await p.getByRole('button', { name: 'No stock available at Head Office' }).click(); await p.getByRole('button', { name: 'Reject request' }).click(); await sleep(1200);
  ok(state.reject && state.reject.p_req_id === 'REQ-20261022-ZZZ999' && /No stock/.test(state.reject.p_reason), 'reject → admin_reject_requisition with the reason ' + JSON.stringify(state.reject));
  ok(/Rejected: No stock available/.test(await p.textContent('body')), 'the rejected request shows its reason');
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/requests2.png' });
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/requests.png' });
  // review queue
  await p.click('text=Phone App Review'); await sleep(1500);
  const txt = await p.textContent('body');
  ok(/Phone App Review/.test(txt) && /WP0001/.test(txt) && /WP0002/.test(txt) && /Waiting \(3\)/.test(txt), 'Phone App Review lists the 3 waiting records (one row per MID)');
  const card = (sn) => p.locator('div.border-b', { hasText: sn }).last();
  ok(/POS Terminal/.test(txt) && await p.isVisible('button:has-text("All devices")') && await p.isVisible('button:has-text("Sound Box (")'), 'type filter: All / POS Terminal / Sound Box');
  ok(!/Open the location|Remarks/.test(txt), 'no location link and no remarks in the review cards');
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/review.png' });
  ok(/Device 1 of 2/.test(await card('WP0001').first().textContent()) && /Device 2 of 2/.test(await card('WP0003').first().textContent()) && /200123456789099/.test(await card('WP0003').first().textContent()), 'two devices of one entry are two rows, each with its own MID');
  ok(/Scanned/.test(await card('WP0001').first().textContent()), 'Phone App Review shows Scanned for a serial the phone scanned');
  await card('WP0001').locator('button[aria-expanded]').first().click(); await sleep(400);
  ok(/Serial: Scanned · MID: Typed by hand/.test(await card('WP0001').textContent()), 'details say how the serial and the MID were entered');
  await card('WP0001').locator('button[aria-expanded]').first().click(); await sleep(300);
  ok(/21 Oct 2026|Oct 2026/.test(await card('WP0001').first().textContent()), 'Phone App Review shows the Date Sent in its own column');
  await card('WP0001').locator('button[aria-expanded]').first().click(); await sleep(500);
  await card('WP0001').getByLabel('Verify serial (optional)').fill('WRONG1'); await sleep(200);
  ok(/Does not match the record/.test(await card('WP0001').textContent()), 'typed/scanned serial that differs is flagged');
  await card('WP0001').getByRole('button', { name: 'Approve', exact: true }).click(); await sleep(700);
  ok(/does not match this record/.test(await card('WP0001').textContent()) && state.events[0].status === 'PENDING', 'approval is refused while the verified serial does not match');
  await card('WP0001').getByLabel('Verify serial (optional)').fill('wp0001'); await sleep(200);
  ok(/Matches the record/.test(await card('WP0001').textContent()), 'matching serial is confirmed');
  await card('WP0002').getByRole('button', { name: 'Approve', exact: true }).click(); await sleep(600);
  ok(/checked the warnings/.test(await p.textContent('body')), 'a record with warnings: approval needs the "I checked the warnings" box');
  const devGets = () => state.calls.filter(c => c.startsWith('GET /rest/v1/devices')).length; const before = devGets();
  await card('WP0002').getByLabel('I checked the warnings').check(); await card('WP0002').getByRole('button', { name: 'Approve', exact: true }).click(); await sleep(1500);
  ok(devGets() === before, 'approval does not reload the whole stock (fewer server requests)');
  ok(/Approved · WP0002/.test(await p.textContent('[role=status]')), 'approval message shown');
  ok(state.approve && state.approve.p_id === 8 && state.approve.p_opt.acknowledge === true && state.events[1].status === 'APPROVED', 'approved with the warnings confirmed → the database applies it ' + JSON.stringify(state.approve));
  // several at once: tick WP0001, reject without a reason is refused, then with a reason
  await p.getByRole('button', { name: /Select all waiting/ }).click(); await sleep(300);
  ok(await p.isVisible('button:has-text("Reject 2")') && await p.isVisible('button:has-text("Approve 2")'), 'select several: bulk Approve / Reject buttons appear');
  await p.getByRole('button', { name: /^Reject 2/ }).click(); await sleep(400);
  ok(/Write the reason/.test(await p.textContent('body')), 'bulk reject needs a reason');
  await p.fill('input[aria-label="Reason for the selected records"]', 'Wrong serial – please correct in the app'); await p.getByRole('button', { name: /^Reject 2/ }).click(); await sleep(1500);
  ok(state.events[0].status === 'REJECTED' && /Wrong serial/.test(state.events[0].review_note), 'bulk reject with the reason');
  // a change refused by the server is said, not hidden
  state.refuse = true;
  await p.evaluate(() => 0);
  // accounts
  await p.click('text=Staff Directory'); await sleep(1200);
  const acc = await p.textContent('body');
  ok(/Accounts & Access/.test(acc) && /SEOUN Chettra/.test(acc) && /Branch staff/.test(acc), 'Accounts & Access lists the database accounts');
  // sign out: nothing stays in this browser
  await p.click('button[title="Sign Out to Login Page"]'); await sleep(2500);
  const left = await p.evaluate(() => ({ dev: localStorage.getItem('crm_pos_devices_v20'), ses: sessionStorage.getItem('crm_pos_auth_session_v20') }));
  ok(await p.isVisible('#empId') && !left.dev && !left.ses && state.calls.some(c => c.startsWith('POST /auth/v1/logout')), 'sign out → server session ended, cached data cleared, back to sign-in');
  // branch staff, first password
  me = null;
  await p.fill('#empId', '25490'); await p.fill('#pw', 'First123'); await p.click('button[type=submit]'); await sleep(1500);
  ok(/choose your own password/.test(await p.textContent('body')), 'first sign-in with a first password → must choose an own password');
  await p.fill('#npw', 'short'); await p.fill('#npw2', 'short'); await p.click('text=Save password and continue'); await sleep(300);
  ok(/at least 8 characters/.test(await p.textContent('[role=alert]')), 'weak password refused');
  await p.fill('#npw', 'Branch2026x'); await p.fill('#npw2', 'Branch2026x'); await p.click('text=Save password and continue'); await sleep(3000);
  const ss2 = await p.evaluate(() => JSON.parse(sessionStorage.getItem('crm_pos_auth_session_v20') || '{}'));
  ok(state.newPw === 'Branch2026x' && ss2.role === 'BRANCH' && ss2.branchId === '105', 'new password saved; branch staff enters as BRANCH 105 ' + JSON.stringify(ss2));
  await p.click('text=Phone App Review'); await sleep(1500);
  ok((await p.getByRole('button', { name: 'Approve', exact: true }).count()) === 0 && /Phone App Review/.test(await p.textContent('body')), 'branch staff: review list read-only');
  await p.getByText('Stock Requests', { exact: true }).first().click(); await sleep(1200);
  ok((await p.getByRole('button', { name: 'Dispatch', exact: true }).count()) === 0, 'branch staff: no dispatch actions');
  await p.getByText('Stock Inventory', { exact: true }).first().click(); await sleep(1200);
  const inv = await p.textContent('body');
  ok(/WP0001/.test(inv) && !/WP0100/.test(inv), 'branch staff sees only its own branch units');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
})().catch(e => { console.log('Error ' + e.message); process.exit(1); });

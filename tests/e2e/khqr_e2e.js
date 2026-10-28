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
    if (method === 'DELETE') {
      const snParam = url.searchParams.get('serial') || '';
      const inMatch = snParam.match(/^in\.\((.*)\)$/);
      const sns = inMatch ? inMatch[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')) : [snParam.replace(/^eq\./, '')];
      state.devices = state.devices.filter(x => !sns.includes(x.serial));
      return json(200, sns.map(sn => ({ serial: sn })));
    }
    const all = me && me.profile.role === 'BRANCH' ? state.devices.filter(d => d.branch_id === me.profile.branch_id) : state.devices;
    return pg(route, req, url, all, 'serial');
  }
  if (path === '/rest/v1/requisitions') return pg(route, req, url, me && me.profile.role === 'BRANCH' ? state.reqs.filter(r => r.branch_id === me.profile.branch_id) : state.reqs, 'req_id');
  if (path === '/rest/v1/historical_merchants') { if (method !== 'GET') { state.histSaved = (state.histSaved || []).concat(Array.isArray(body) ? body : [body]); return json(201, []); } return json(200, []); }
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

// ---- (28 Oct 2026) KHQR entries: New Installation / QR Replacement from the phone app
const now = Date.now();
state.qr = [];
for (let i = 1; i <= 120; i++) {
  const failed = i % 10 === 0 ? (i % 20 === 0 ? 2 : 1) : 0;
  state.qr.push({ id: i, record_id: 'QR-20261028-' + String(i).padStart(6, '0'), activity: i % 3 ? 'NEW_INSTALLATION' : 'QR_REPLACEMENT',
    staff_id: 'STF00' + (i % 4), staff_name: ['Sok Dara', 'Chan Vuthy', 'Kim Sreyneang', 'Heng Rith'][i % 4], branch_text: i % 2 ? 'Toul Kork' : 'Head Office', branch_id: i % 2 ? '105' : '100',
    merchant_name: 'SHOP ' + i, merchant_name_kh: i === 7 ? 'ហាងលក់ទំនិញ' : null, mid: String(200100000000000 + i), qr_expected: 1 + (i % 3), qr_count: 1 + (i % 3),
    failed_attempts: failed, status: failed ? 'FAILED_ATTEMPT' : 'COMPLETED',
    attempts: failed ? [{ at: new Date(now - i * 60000 - 30000).toISOString(), expected_mid: String(200100000000000 + i), got_mid: '200100000000999', got_name: 'OTHER SHOP' }] : [],
    latitude: 11.55 + i / 1000, longitude: 104.92, gps_accuracy: 12, remark: i === 10 ? 'Merchant had an old QR' : null, photo_count: 2,
    telegram_link: 'https://t.me/c/123/' + i, app_version: '3.48.0', captured_at: new Date(now - i * 60000).toISOString(), submitted_at: new Date(now - i * 60000).toISOString(),
    review_status: 'PENDING', reviewed_by_name: null, reviewed_at: null, review_note: null });
}
const pv = (url, k) => url.searchParams.getAll(k);
function qrList(url) {
  let rows = state.qr.slice();
  for (const v of pv(url, 'submitted_at')) { if (v.startsWith('gte.')) rows = rows.filter(r => r.submitted_at >= v.slice(4)); if (v.startsWith('lt.')) rows = rows.filter(r => r.submitted_at < v.slice(3)); }
  for (const v of pv(url, 'failed_attempts')) { if (v === 'gt.0') rows = rows.filter(r => r.failed_attempts > 0); if (v === 'eq.0') rows = rows.filter(r => r.failed_attempts === 0); }
  for (const k of ['review_status', 'activity', 'branch_id', 'mid']) for (const v of pv(url, k)) {
    if (v.startsWith('eq.')) rows = rows.filter(r => String(r[k]) === v.slice(3));
    if (v.startsWith('like.')) { const t = v.slice(5).replace(/%/g, ''); rows = rows.filter(r => String(r[k]).includes(t)); }
  }
  const or = url.searchParams.get('or');
  if (or) { const t = (or.match(/ilike\.%([^%]*)%/) || [])[1] || ''; rows = rows.filter(r => [r.merchant_name, r.merchant_name_kh, r.record_id, r.staff_name, r.staff_id].some(x => String(x || '').toLowerCase().includes(t.toLowerCase()))); }
  if (me && me.profile.role === 'BRANCH') rows = rows.filter(r => r.branch_id === me.profile.branch_id);
  rows.sort((a, b) => (a.submitted_at < b.submitted_at ? 1 : a.submitted_at > b.submitted_at ? -1 : b.id - a.id));
  return rows;
}
async function api2(route) {
  const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
  const body = req.postData() ? (() => { try { return JSON.parse(req.postData()); } catch (e) { return null; } })() : null;
  const H = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' };
  const json = (code, o, h) => route.fulfill({ status: code, contentType: 'application/json', headers: Object.assign({}, H, h || {}), body: JSON.stringify(o) });
  if (method === 'OPTIONS') return api(route);
  if (path === '/rest/v1/qr_installations') {
    state.calls.push(method + ' ' + path + url.search);
    if (state.qrMissing) return json(404, { code: 'PGRST205', message: "Could not find the table 'public.qr_installations' in the schema cache" });
    const rows = qrList(url);
    if (method === 'HEAD') return route.fulfill({ status: 200, headers: Object.assign({}, H, { 'content-range': '*/' + rows.length }) });
    const off = Number(url.searchParams.get('offset') || 0), lim = Number(url.searchParams.get('limit') || 1000);
    const part = rows.slice(off, off + lim);
    return json(200, part, { 'content-range': (part.length ? off + '-' + (off + part.length - 1) : '*') + '/' + rows.length });
  }
  if (path === '/rest/v1/rpc/qr_summary') {
    state.calls.push('RPC qr_summary ' + JSON.stringify(body));
    if (state.qrMissing) return json(404, { code: 'PGRST202', message: 'Could not find the function public.qr_summary' });
    let rows = state.qr.filter(r => (!body.p_from || r.submitted_at >= body.p_from) && (!body.p_to || r.submitted_at < body.p_to));
    if (me && me.profile.role === 'BRANCH') rows = rows.filter(r => r.branch_id === me.profile.branch_id);
    return json(200, { total: rows.length, completed: rows.filter(r => !r.failed_attempts).length, failed: rows.filter(r => r.failed_attempts).length,
      needs_review: rows.filter(r => r.failed_attempts && r.review_status === 'PENDING').length, install: rows.filter(r => r.activity === 'NEW_INSTALLATION').length,
      replace: rows.filter(r => r.activity === 'QR_REPLACEMENT').length, qr: rows.reduce((s, r) => s + r.qr_count, 0) });
  }
  if (path === '/rest/v1/rpc/qr_review') {
    state.calls.push('RPC qr_review ' + JSON.stringify(body)); state.reviews = (state.reviews || []).concat([body]);
    if (me.profile.role === 'BRANCH') return json(403, { code: '42501', message: 'Only HQ admins can review KHQR entries.' });
    const r = state.qr.find(x => x.id === body.p_id); r.review_status = body.p_status; r.review_note = body.p_note; r.reviewed_by_name = 'SAY Chanmakara (8986)'; r.reviewed_at = new Date().toISOString();
    return json(200, { id: r.id, review_status: r.review_status });
  }
  if (path === '/rest/v1/field_events' && method === 'HEAD') {
    state.calls.push(method + ' ' + path + url.search);
    let list = state.events.filter(e => e.status === 'PENDING');
    const dt = url.searchParams.get('device_type'); if (dt) list = list.filter(e => 'eq.' + e.device_type === dt);
    return route.fulfill({ status: 200, headers: Object.assign({}, H, { 'content-range': '*/' + list.length }) });
  }
  return api(route);
}
// a Sound Box record waiting too
state.events.push({ id: 20, source_record_id: 'SB-20261021-0001', unit_no: 1, revision: 1, kind: 'SB_MAINT', device_type: 'Sound Box', serial: 'SB0001', mid: '200123456789012', outlet_name: 'Sokha Mart', branch_text: 'Toul Kork', branch_id: '105', staff_name: 'Sok Dara', recorded_at: '2026-10-21T11:00:00+07:00', payload: {}, issues: [], status: 'PENDING', received_at: '2026-10-21T04:00:00Z' });

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx.route(B + '/**', api2);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:8500/index.html'); await sleep(1500);
  await p.fill('#empId', '8986'); await p.fill('#pw', 'Secret123'); await p.click('button[type=submit]'); await sleep(3500);
  ok(!(await p.isVisible('#empId')), 'Super Admin signed in');
  const side = p.locator('aside').first();
  for (const t of ['POS Terminal', 'Sound Box', 'KHQR']) ok(await side.getByRole('button', { name: new RegExp('^' + t) }).isVisible(), `sidebar: "${t}" under Phone App Review`);
  const sideTxt = await side.textContent();
  ok(/POS Terminal\s*3/.test(sideTxt) && /Sound Box\s*1/.test(sideTxt) && /KHQR\s*12/.test(sideTxt), 'sub-menu badges: 3 POS waiting, 1 Sound Box waiting, 12 KHQR need review ' + sideTxt.replace(/\s+/g, ' ').slice(0, 400));
  // POS Terminal
  await side.getByRole('button', { name: /^POS Terminal/ }).click(); await sleep(1500);
  let body = await p.textContent('main');
  ok(/Phone App Review\s*·\s*POS Terminal/.test(body) && /WP0001/.test(body) && !/SB0001/.test(body) && !(await p.isVisible('text=All devices')), 'POS Terminal: POS records only, no device type pills');
  await p.screenshot({ path: '/tmp/claude-0/t/d_pos.png' });
  await side.getByRole('button', { name: /^Sound Box/ }).click(); await sleep(1200);
  body = await p.textContent('main');
  ok(/Phone App Review\s*·\s*Sound Box/.test(body) && /SB0001/.test(body) && !/WP0001/.test(body), 'Sound Box: Sound Box records only');
  // KHQR
  await side.getByRole('button', { name: /^KHQR/ }).click(); await sleep(2000);
  body = await p.textContent('main');
  ok(/Phone App Review\s*·\s*KHQR/.test(body) && /SHOP 1200100000000001/.test(body), 'KHQR: entries shown, newest first');
  const rowsN = await p.locator('[aria-label="KHQR entries"] [data-page-content] > div').count();
  ok(rowsN === 50 && /Showing 1–50 of 120 entries/.test(body), 'KHQR: 50 per page, server total 120 ' + rowsN);
  ok(state.calls.some(c => /qr_installations\?select=.*submitted_at=gte\./.test(c) && /offset=0/.test(c) && /limit=50/.test(c)), 'read from the server: this month, offset 0, 50 rows');
  ok(/Needs review\s*\(12\)/.test(body) && /Failed Attempt\s*\(12\)/.test(body) && /Completed\s*\(108\)/.test(body), 'status tabs show the period counts');
  await p.screenshot({ path: '/tmp/claude-0/t/d_khqr.png' });
  await p.getByRole('button', { name: 'Next page' }).click(); await sleep(1200);
  body = await p.textContent('main');
  ok(/Showing 51–100 of 120/.test(body) && state.calls.some(c => /qr_installations.*offset=50/.test(c)), 'next page read from the server (offset 50)');
  // Needs review
  await p.getByRole('button', { name: /^Needs review/ }).first().click(); await sleep(1200);
  const nr = await p.locator('[aria-label="KHQR entries"] [data-page-content] > div').count();
  body = await p.textContent('[aria-label="KHQR entries"]');
  ok(nr === 12 && /Failed Attempt \(1\)/.test(body) && /Failed Attempt \(2\)/.test(body) && /Needs review/.test(body), 'Needs review: the 12 flagged entries, Failed Attempt (n)');
  // open the first one and review it
  await p.locator('[aria-label="KHQR entries"] [data-page-content] > div > button').first().click(); await sleep(800);
  body = await p.textContent('[aria-label="KHQR entries"]');
  ok(/scanned MID 200100000000999 \(OTHER SHOP\) instead of 2001000000000\d\d/.test(body) && /on Telegram/.test(body) && /11\.\d+, 104\.92/.test(body), 'details: the wrong MID scanned, Telegram post, location');
  await p.screenshot({ path: '/tmp/claude-0/t/d_khqr_open.png' });
  await p.getByRole('button', { name: 'Escalate' }).click(); await sleep(500);
  ok(/Please write the reason for escalation/.test(await p.textContent('[aria-label="KHQR entries"]')) && !(state.reviews || []).length, 'escalation needs a note');
  await p.getByRole('button', { name: /Mark as checked/ }).click(); await sleep(1200);
  ok((state.reviews || []).length === 1 && state.reviews[0].p_status === 'CHECKED', 'Mark as checked → qr_review(CHECKED) ' + JSON.stringify(state.reviews));
  body = await p.textContent('main');
  ok(/Needs review\s*\(11\)/.test(body), 'counts refreshed after review');
  await sleep(500);
  ok(/KHQR\s*11/.test(await side.textContent()), 'menu badge refreshed (11)');
  // search by MID
  await p.getByRole('button', { name: /^All\s*\(/ }).first().click(); await sleep(600);
  await p.fill('input[aria-label="Search KHQR entries"]', '200100000000077'); await sleep(1500);
  const one = await p.locator('[aria-label="KHQR entries"] [data-page-content] > div').count();
  ok(one === 1 && state.calls.some(c => /mid=eq\.200100000000077/.test(c)), 'search by a full MID → exact match on the server');
  await p.getByRole('button', { name: 'Clear filters' }).click(); await sleep(1500);
  ok(/Showing 1–50 of 120/.test(await p.textContent('main')), 'Clear filters → back to all');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  // branch staff: no review buttons
  // missing tables → setup note
  state.qrMissing = true;
  await p.getByRole('button', { name: 'Refresh' }).click(); await sleep(1500);
  ok(/KHQR tables are not set up/.test(await p.textContent('main')), 'database not migrated yet → a clear setup note');
  state.qrMissing = false;
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();

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

// ---- (28 Oct 2026) KHQR entries: New Installation / QR Replacement from the phone app (no approval step)
const now = Date.now();
state.qr = []; state.qrAtt = [];
const NAMES = ['Sok Dara', 'Chan Vuthy', 'Kim Sreyneang', 'Heng Rith'];
for (let i = 1; i <= 120; i++) {
  const failed = i % 10 === 0 ? (i % 20 === 0 ? 2 : 1) : 0;
  state.qr.push({ id: i, record_id: 'QR-20261028-' + String(i).padStart(6, '0'), activity: i % 3 ? 'NEW_INSTALLATION' : 'QR_REPLACEMENT',
    staff_id: '2722' + (i % 4), staff_name: NAMES[i % 4], branch_text: i % 2 ? 'Toul Kork' : 'Head Office', branch_id: i % 2 ? '105' : '100',
    merchant_name: 'SHOP ' + i, merchant_name_kh: i === 7 ? 'ហាងលក់ទំនិញ' : null, mid: String(200100000000000 + i), qr_expected: 1 + (i % 3), qr_count: 1 + (i % 3),
    failed_attempts: failed, status: failed ? 'FAILED_ATTEMPT' : 'COMPLETED',
    attempts: failed ? [{ at: new Date(now - i * 60000 - 30000).toISOString(), expected_mid: String(200100000000000 + i), got_mid: '200100000000999', got_name: 'OTHER SHOP' }] : [],
    location: 'Phnom Penh', khan: 'Tuol Kouk', latitude: 11.55 + i / 1000, longitude: 104.92, gps_accuracy: 12, remark: i === 10 ? 'Merchant had an old QR' : null, photo_count: 2,
    session_id: 's' + i, telegram_link: 'https://t.me/c/123/' + i, app_version: '3.49.0', captured_at: new Date(now - i * 60000).toISOString(), submitted_at: new Date(now - i * 60000).toISOString() });
  for (let k = 0; k < failed; k++) state.qrAtt.push({ staff_id: '2722' + (i % 4), staff_name: NAMES[i % 4], branch_text: i % 2 ? 'Toul Kork' : 'Head Office', branch_id: i % 2 ? '105' : '100',
    expected_mid: String(200100000000000 + i), got_mid: '200100000000999', got_name: 'OTHER SHOP', received_at: new Date(now - i * 60000 - 30000 - k * 1000).toISOString(), session_id: 's' + i,
    activity: i % 3 ? 'NEW_INSTALLATION' : 'QR_REPLACEMENT', scanned_count: 2 });
}
state.qrAtt.push({ staff_id: '27225', staff_name: 'Ouk Sophea', branch_text: 'Toul Kork', branch_id: '105', expected_mid: '200100000000777', got_mid: '200100000000778', received_at: new Date(now - 5000).toISOString(), session_id: 'x', activity: 'NEW_INSTALLATION', scanned_count: 3 });
state.qrAtt.forEach((a, i) => { a.id = i + 1; });
const pv = (url, k) => url.searchParams.getAll(k);
function qrList(url) {
  let rows = state.qr.slice();
  for (const v of pv(url, 'submitted_at')) { if (v.startsWith('gte.')) rows = rows.filter(r => r.submitted_at >= v.slice(4)); if (v.startsWith('lt.')) rows = rows.filter(r => r.submitted_at < v.slice(3)); }
  for (const v of pv(url, 'failed_attempts')) { if (v === 'gt.0') rows = rows.filter(r => r.failed_attempts > 0); if (v === 'eq.0') rows = rows.filter(r => r.failed_attempts === 0); }
  for (const k of ['activity', 'branch_id', 'mid', 'staff_id']) for (const v of pv(url, k)) {
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
  if (path === '/rest/v1/qr_attempts') {
    state.calls.push(method + ' ' + path + url.search);
    let rows = state.qrAtt.slice();
    for (const v of pv(url, 'received_at')) if (v.startsWith('gte.')) rows = rows.filter(r => r.received_at >= v.slice(4));
    for (const k of ['activity', 'branch_id', 'staff_id']) for (const v of pv(url, k)) if (v.startsWith('eq.')) rows = rows.filter(r => String(r[k]) === v.slice(3));
    const or = url.searchParams.get('or');
    if (or) { const t = (or.match(/like\.%([^%]*)%/) || [])[1] || ''; rows = rows.filter(r => [r.expected_mid, r.got_mid, r.staff_name, r.got_name, r.branch_text, r.staff_id].some(x => String(x || '').toLowerCase().includes(t.toLowerCase()))); }
    rows.sort((a, b) => (a.received_at < b.received_at ? 1 : -1));
    const off = Number(url.searchParams.get('offset') || 0), lim = Number(url.searchParams.get('limit') || 1000);
    const part = rows.slice(off, off + lim);
    return json(200, part, { 'content-range': (part.length ? off + '-' + (off + part.length - 1) : '*') + '/' + rows.length });
  }
  if (path === '/rest/v1/qr_installations' && url.searchParams.get('session_id')) {
    const ids = (url.searchParams.get('session_id').match(/^in\.\((.*)\)$/) || [, ''])[1].split(',').map(x => x.replace(/^"|"$/g, ''));
    return json(200, state.qr.filter(r => ids.includes(r.session_id)).map(r => ({ session_id: r.session_id, record_id: r.record_id })));
  }
  if (path === '/rest/v1/qr_installations') {
    state.calls.push(method + ' ' + path + url.search);
    if (state.qrMissing) return json(404, { code: 'PGRST205', message: "Could not find the table 'public.qr_installations' in the schema cache" });
    const rows = qrList(url);
    if (method === 'HEAD') return route.fulfill({ status: 200, headers: Object.assign({}, H, { 'content-range': '*/' + rows.length }) });
    const off = Number(url.searchParams.get('offset') || 0), lim = Number(url.searchParams.get('limit') || 1000);
    const part = rows.slice(off, off + lim);
    return json(200, part, { 'content-range': (part.length ? off + '-' + (off + part.length - 1) : '*') + '/' + rows.length });
  }
  const inP = (t, b) => (!b.p_from || t >= b.p_from) && (!b.p_to || t < b.p_to);
  if (path === '/rest/v1/rpc/qr_summary') {
    state.calls.push('RPC qr_summary ' + JSON.stringify(body));
    if (state.qrMissing) return json(404, { code: 'PGRST202', message: 'Could not find the function public.qr_summary' });
    const rows = state.qr.filter(r => inP(r.submitted_at, body)), att = state.qrAtt.filter(a => inP(a.received_at, body));
    return json(200, { total: rows.length, completed: rows.filter(r => !r.failed_attempts).length, failed: rows.filter(r => r.failed_attempts).length,
      install: rows.filter(r => r.activity === 'NEW_INSTALLATION').length, replace: rows.filter(r => r.activity === 'QR_REPLACEMENT').length,
      qr: rows.reduce((s, r) => s + r.qr_count, 0), attempts: att.length, staff_failed: new Set(att.map(a => a.staff_id)).size });
  }
  if (path === '/rest/v1/rpc/qr_month_history') {
    state.calls.push('RPC qr_month_history');
    if (state.qrMissing) return json(404, { code: 'PGRST202', message: 'Could not find the function public.qr_month_history' });
    return json(200, [{ month: '2026-10-01', entries: 120, install: 80, replace: 40, qr: 240, attempts: 19, staff_failed: 3, detailed: true },
      { month: '2026-09-01', entries: 98000, install: 70000, replace: 28000, qr: 210000, attempts: 412, staff_failed: 37, detailed: true },
      { month: '2026-08-01', entries: 91000, install: 65000, replace: 26000, qr: 190000, attempts: 530, staff_failed: 41, detailed: false }]);
  }
  if (path === '/rest/v1/rpc/qr_staff_failures') {
    state.calls.push('RPC qr_staff_failures ' + JSON.stringify(body));
    if (state.qrMissing) return json(404, { code: 'PGRST202', message: 'Could not find the function public.qr_staff_failures' });
    const m = new Map();
    state.qrAtt.filter(a => inP(a.received_at, body)).forEach(a => {
      const x = m.get(a.staff_id) || { staff_id: a.staff_id, staff_name: a.staff_name, branch_text: a.branch_text, attempts: 0, last_at: '', last_expected_mid: '', last_got_mid: '' };
      x.attempts++; if (a.received_at > x.last_at) { x.last_at = a.received_at; x.last_expected_mid = a.expected_mid; x.last_got_mid = a.got_mid; }
      m.set(a.staff_id, x);
    });
    const out = [...m.values()].map(x => { const e = state.qr.filter(r => r.staff_id === x.staff_id && inP(r.submitted_at, body)); return Object.assign(x, { entries: e.length, entries_failed: e.filter(r => r.failed_attempts).length }); })
      .sort((a, b) => b.attempts - a.attempts || (a.last_at < b.last_at ? 1 : -1));
    return json(200, out);
  }
  if (path === '/rest/v1/field_events' && method === 'HEAD') {
    state.calls.push(method + ' ' + path + url.search);
    let list = state.events.filter(e => e.status === 'PENDING');
    const dt = url.searchParams.get('device_type'); if (dt) list = list.filter(e => 'eq.' + e.device_type === dt);
    return route.fulfill({ status: 200, headers: Object.assign({}, H, { 'content-range': '*/' + list.length }) });
  }
  return api(route);
}
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
  const sideTxt = (await side.textContent()).replace(/\s+/g, ' ');
  ok(/POS Terminal\s*3/.test(sideTxt) && /Sound Box\s*1/.test(sideTxt) && /KHQR Operations/.test(sideTxt.replace(/KHQR\s*OPERATIONS/i, 'KHQR Operations')), 'badges: 3 POS, 1 Sound Box waiting; KHQR has no approval badge');
  await side.getByRole('button', { name: /^POS Terminal/ }).click(); await sleep(1500);
  let body = await p.textContent('main');
  ok(/Phone App Review\s*·\s*POS Terminal/.test(body) && /WP0001/.test(body) && !/SB0001/.test(body), 'POS Terminal: POS records only');
  ok(await p.isVisible('text=Admin HQ Stock'), 'stock cards still shown on the other pages');
  await side.getByRole('button', { name: /^Sound Box/ }).click(); await sleep(1200);
  body = await p.textContent('main');
  ok(/Phone App Review\s*·\s*Sound Box/.test(body) && /SB0001/.test(body) && !/WP0001/.test(body), 'Sound Box: Sound Box records only');
  // KHQR
  await side.getByRole('button', { name: /^KHQR/ }).click(); await sleep(2200);
  body = await p.textContent('body');
  ok(!(await p.isVisible('text=Admin HQ Stock')) && !(await p.isVisible('text=Branch Code 100 Vault')), 'KHQR page: the stock cards are gone');
  const stats = (await p.textContent('[aria-label="KHQR statistics"]')).replace(/\s+/g, ' ');
  ok(/KHQR entries\s*120/.test(stats) && /QR materials\s*240/.test(stats) && !/Completed/.test(stats) && /Failed Attempt\s*19\s*Submit blocked/.test(stats) && !/Restricted/.test(stats) && /Staff involved\s*3/.test(stats),
    'KHQR statistics only: entries, QR, completed, failed attempt entries, restricted submits, staff', stats.slice(0, 400));
  ok(!/Needs review|Mark as checked|Escalate/i.test(body), 'no approval step anywhere');
  const periods = await p.$$eval('select[aria-label="Period"] option', (o) => o.map(x => x.textContent));
  ok(JSON.stringify(periods) === JSON.stringify(['Today', 'Last 7 days', 'This month', 'Last month', 'Last 2 months']), 'periods: up to the last 2 months (details kept)', periods);
  const hist = (await p.textContent('[aria-label="Monthly history"]')).replace(/\s+/g, ' ');
  ok(/Oct 2026\s*Details\s*120/.test(hist) && /Aug 2026\s*Totals only\s*91,000/.test(hist), 'monthly history: kept months with details, older months as totals', hist.slice(0, 260));
  await p.screenshot({ path: '/tmp/claude-0/t/d6_hist.png', fullPage: true });
  const st = await p.locator('[aria-label="Failed attempts by staff"] .divide-y > button').allTextContents();
  ok(st.length === 3 && /Ouk Sophea/.test(st.join('|')) && /Sok Dara.*12/.test(st[0].replace(/\s+/g, ' ')), 'failed attempts by staff: 3 staff, most first', st.map(x => x.replace(/\s+/g, ' ').slice(0, 60)));
  const rowsN = await p.locator('[aria-label="KHQR entries"] [data-page-content] > div').count();
  ok(rowsN === 50 && /Showing 1–50 of 120 entries/.test(body), 'entries: 50 per page, server total 120');
  ok(/Phnom Penh · Tuol Kouk/.test(await p.textContent('[aria-label="KHQR entries"]')), 'Location and Khan in the list');
  await p.screenshot({ path: '/tmp/claude-0/t/d2_khqr.png' });
  await p.getByRole('button', { name: 'Next page' }).click(); await sleep(1200);
  ok(/Showing 51–100 of 120/.test(await p.textContent('main')) && state.calls.some(c => /qr_installations.*offset=50/.test(c)), 'next page read from the server (offset 50)');
  // Last month: a closed date range for every request
  await p.selectOption('select[aria-label="Period"]', 'LAST'); await sleep(1500);
  ok(state.calls.some(c => /qr_installations\?select=.*submitted_at=gte\..*submitted_at=lt\./.test(c)) && state.calls.some(c => /qr_summary .*"p_to":"20/.test(c)), 'Last month: from the 1st of last month to the 1st of this month');
  await p.selectOption('select[aria-label="Period"]', 'MONTH'); await sleep(1500);
  // the failed attempts log
  await p.getByRole('tab', { name: /Failed attempts log/ }).click(); await sleep(1500);
  let log = await p.locator('[aria-label="Failed attempts log"] [data-page-content] > div').allTextContents();
  ok(log.length === 19 && /Ouk Sophea/.test(log[0]) && /Not saved/.test(log[0]) && /QR-20261028-0000\d\d/.test(log[1]) && /200100000000999/.test(log[1]),
    'Failed attempts log: all 19 blocked submits, newest first; unsaved ones say "Not saved", saved ones show the Record ID', log.slice(0, 2).map(x => x.replace(/\s+/g, ' ')));
  await p.screenshot({ path: '/tmp/claude-0/t/d4_log.png' });
  // a staff member → their failed attempts in the log
  await p.locator('[aria-label="Failed attempts by staff"] .divide-y > button').nth(2).click(); await sleep(1500);
  log = await p.locator('[aria-label="Failed attempts log"] [data-page-content] > div').allTextContents();
  ok(log.length === 1 && /Ouk Sophea/.test(log[0]) && state.calls.some(c => /qr_attempts.*staff_id=eq\.27225/.test(c)) && /Staff: Ouk Sophea/.test(await p.textContent('main')), 'tap a staff member → their failed attempts (even with no saved entry)');
  await p.getByRole('button', { name: 'Clear filters' }).click(); await sleep(800);
  await p.getByRole('tab', { name: /KHQR entries/ }).click(); await sleep(800);
  const et = await p.textContent('main');
  ok(!(await p.getByRole('button', { name: /^Completed/ }).count()) && !/Completed \(/.test(et) && !(await p.locator('[aria-label="KHQR entries"] >> text=Failed Attempt (').count()), 'KHQR entries: no Completed / Failed Attempt split (every entry is a request)');
  await p.locator('[aria-label="KHQR entries"] [data-page-content] > div > button').first().click(); await sleep(800);
  const det = await p.textContent('[aria-label="KHQR entries"]');
  ok(/on Telegram/.test(det) && /Phnom Penh · Tuol Kouk/.test(det) && !/Failed attempts \(/.test(det), 'details: location, Telegram post (no failed-attempt box)');
  await p.screenshot({ path: '/tmp/claude-0/t/d2_open.png' });
  ok(/Showing 1–50 of 120/.test(await p.textContent('main')), 'Clear filters → back to all 120 entries');
  await p.fill('input[aria-label="Search KHQR entries"]', '200100000000077'); await sleep(1500);
  ok((await p.locator('[aria-label="KHQR entries"] [data-page-content] > div').count()) === 1 && state.calls.some(c => /mid=eq\.200100000000077/.test(c)), 'search by a full MID');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  state.qrMissing = true;
  await p.getByRole('button', { name: 'Refresh' }).click(); await sleep(1500);
  ok(/KHQR tables are not set up/.test(await p.textContent('main')), 'database not migrated yet → a clear setup note');
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();

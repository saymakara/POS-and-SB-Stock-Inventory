// (21 Nov 2026) Settings > Data: KHQR Installation data kept (6 months, delete a month), against a stand-in of the Supabase API.
// Never touches live data. Usage: build with VITE_SUPABASE_URL=https://mrrzfmtaqjdwhwznznie.supabase.co, serve dist on :8500, then node khqr_retention_e2e.js
// Usage: build with VITE_SUPABASE_URL=https://mrrzfmtaqjdwhwznznie.supabase.co, serve dist on :8500 (serve-dist.cjs), then node pos_offline_e2e.js
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
  events: [{ id: 7, source_record_id: 'POS-20261121-0001', unit_no: 1, revision: 1, kind: 'INSTALL', device_type: 'POS Terminal', serial: 'WP0001', old_serial: null, mid: '200123456789012', tid: '56789012',
    terminal_name: 'Till 1', outlet_name: 'Sokha Mart', branch_text: 'Toul Kork', branch_id: '105', staff_id: 'STF001', staff_name: 'Sok Dara', recorded_at: '2026-11-21T09:00:00+07:00',
    remarks: '', payload: { unit: { serial_input: 'SCAN', mid_input: 'TYPED' } }, issues: [], status: 'PENDING', received_at: '2026-11-21T02:01:00Z' },
    { id: 10, source_record_id: 'POS-20261121-0003', unit_no: 1, revision: 1, kind: 'INSTALL', device_type: 'POS Terminal', serial: 'WP0002', old_serial: null, mid: '200100000000001', tid: '00000001',
      terminal_name: 'Mall Till', outlet_name: 'Aeon Mall', branch_text: 'Toul Kork', branch_id: '105', staff_id: 'STF001', staff_name: 'Sok Dara', recorded_at: '2026-11-21T08:00:00+07:00',
      payload: { entry: { request_type: 'Integrated Installation' }, unit: {} }, issues: [], status: 'PENDING', received_at: '2026-11-21T01:00:00Z' },
    { id: 21, source_record_id: 'POC-20261121-0001', unit_no: 1, revision: 1, kind: 'POS_OFFLINE', device_type: 'POS Terminal', serial: '', mid: '200100000000001', tid: '00000001',
      terminal_name: 'Lucky Mart', outlet_name: 'Lucky Mart', branch_text: 'Toul Kork', branch_id: '105', staff_id: 'STF002', staff_name: 'Chan Dara', recorded_at: '2026-11-21T10:00:00+07:00',
      payload: { entry: { summary: 'POS Offline Count' }, unit: { unit_no: 1 } }, issues: [], status: 'APPROVED', reviewed_at: '2026-11-21T03:00:01Z', review_note: 'Recorded automatically - no approval needed', received_at: '2026-11-21T03:00:00Z' },
    { id: 22, source_record_id: 'POC-20261121-0002', unit_no: 1, revision: 1, kind: 'POS_OFFLINE', device_type: 'POS Terminal', serial: '', mid: '222031054110722', tid: '54110722',
      terminal_name: 'Old Cafe', outlet_name: 'Old Cafe', branch_text: 'Toul Kork', branch_id: '105', staff_id: 'STF002', staff_name: 'Chan Dara', recorded_at: '2026-11-21T11:00:00+07:00',
      payload: { entry: { summary: 'POS Offline Count' }, unit: { unit_no: 1 } },
      issues: [{ code: 'TID_UNKNOWN', level: 'warn', text: 'TID 54110722 is not on an installed POS terminal in the inventory (for information - nothing to do).' }], status: 'APPROVED', reviewed_at: '2026-11-21T04:00:01Z', review_note: 'Recorded automatically - no approval needed', received_at: '2026-11-21T04:00:00Z' }],
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
  if (path === '/rest/v1/rpc/qr_retention_info') {
    state.ret = state.ret || { keep: 6, months: [{ month: '2026-11', entries: 12000, attempts: 90, summary_entries: 0, current: true, auto_delete: false },
      { month: '2026-10', entries: 7000, attempts: 30, summary_entries: 0, current: false, auto_delete: false },
      { month: '2026-04', entries: 0, attempts: 0, summary_entries: 31000, current: false, auto_delete: true }] };
    if (me.profile.role === 'BRANCH') return json(400, { message: 'Only an admin can see this.' });
    return json(200, { keep_months: state.ret.keep, keep_from: state.ret.keep === 6 ? '2026-06' : '2026-09', updated_by: null, details_size: '23 MB', months: state.ret.months });
  }
  if (path === '/rest/v1/rpc/qr_retention_set') {
    if (me.profile.role !== 'SUPER_ADMIN') return json(400, { message: 'Only a Super Admin can change this.' });
    state.retSet = body.p; state.ret.keep = body.p.keep_months; return json(200, { keep_months: body.p.keep_months });
  }
  if (path === '/rest/v1/rpc/qr_delete_month') {
    if (me.profile.role !== 'SUPER_ADMIN') return json(400, { message: 'Only a Super Admin can delete KHQR data.' });
    state.delCalls = (state.delCalls || []).concat([body.p]);
    const m = state.ret.months.find((x) => x.month === body.p.month);
    if (m.current) return json(400, { message: 'The current month cannot be deleted.' });
    const take = Math.min(m.entries, body.p.max || 5000); m.entries -= take;
    const att = m.entries === 0 ? m.attempts : 0; m.attempts -= att; m.summary_entries += take;
    return json(200, { entries_removed: take, attempts_removed: att, remaining: m.entries + m.attempts, month: m.month });
  }
  if (path === '/rest/v1/rpc/field_approve') {
    state.approve = body; const e = state.events.find(x => x.id === body.p_id);
    if (e.issues.length && !(body.p_opt || {}).acknowledge) return json(400, { message: 'This record has warnings. Review them and confirm to approve.' });
    e.status = 'APPROVED'; if (e.kind !== 'POS_OFFLINE') { const d = state.devices.find(x => x.serial === e.serial); Object.assign(d, { stage: 'COMPLETE', mid: e.mid, tid: e.tid, merchant_name: e.outlet_name }); }
    return json(200, { id: e.id, status: 'APPROVED' });
  }
  if (path === '/rest/v1/rpc/field_reject') { const e = state.events.find(x => x.id === body.p_id); e.status = 'REJECTED'; e.review_note = body.p_note; return json(200, { status: 'REJECTED' }); }
  if (path === '/rest/v1/rpc/cc_counts') return json(200, { pending: 0, confirmed: 0, rejected: 0, no_review: 0, total: 0 });
  if (path === '/rest/v1/qr_installations') return json(200, [], { 'content-range': '0-0/0' });
  if (path === '/rest/v1/qr_attempts') return json(200, []);
  if (path === '/rest/v1/rpc/qr_summary') return json(200, { total: 0, completed: 0, failed: 0, install: 0, replace: 0, qr: 0, attempts: 0, staff_failed: 0 });
  if (path === '/rest/v1/rpc/qr_month_history') return json(200, []);
  if (path === '/rest/v1/rpc/device_page_bounds') return json(200, []);
  if (path === '/rest/v1/rpc/get_device_stage_counts') return json(200, {});
  if (path === '/rest/v1/rpc/cc_list') return json(200, []);
  if (path === '/rest/v1/rpc/kpi_dashboard_summary') return json(200, []);
  if (path === '/rest/v1/kpi_point_rules') return json(200, []);
  if (path === '/rest/v1/kpi_settings') return json(200, [{ id: 1 }]);
  return json(404, { message: 'not in the stand-in: ' + path });
}
(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.route(B + '/**', api);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const dialogs = []; p.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
  await p.goto('http://127.0.0.1:8500/index.html'); await sleep(1500);
  await p.fill('#empId', '8986'); await p.fill('#pw', 'Secret123'); await p.click('button[type=submit]'); await sleep(3000);
  await p.locator('aside, nav').getByText('Settings', { exact: true }).first().click(); await sleep(1500);
  await p.getByText('Data Backup, Export & Reset').first().click(); await sleep(1500);
  const sec = p.locator('section[aria-label="KHQR Installation data kept"]');
  ok(await sec.isVisible(), 'Settings > Data: the "KHQR Installation data kept" card');
  let t = (await sec.textContent()).replace(/\s+/g, ' ');
  const rows = async () => (await sec.locator('tbody tr').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim()).join(' | ');
  let r = await rows();
  ok(await sec.locator('select[aria-label="Months of KHQR details kept"]').inputValue() === '6', 'kept: 6 months (default)');
  ok(/From June 2026/.test(t) && /23 MB/.test(t), 'shows from which month details are kept and their size');
  ok(/November 2026 12,000 90 This month/.test(r) && /October 2026 7,000 30 Kept/.test(r) && /April 2026 — — Totals only/.test(r), 'month list: counts and status - ' + r);
  ok(await sec.locator('button[aria-label="Delete KHQR details of November 2026"]').count() === 0 && await sec.locator('button[aria-label="Delete KHQR details of April 2026"]').count() === 0,
    'no Delete for the current month, nor for a month already reduced to totals');
  // delete October: confirm, done in parts until nothing is left
  await sec.locator('button[aria-label="Delete KHQR details of October 2026"]').click(); await sleep(2500);
  ok(dialogs.some((d) => /Delete the KHQR Installation details of October 2026 \(7,030 records\)/.test(d) && /KPI Performance and dashboard totals for October 2026 stay/.test(d)), 'asks to confirm, saying KPI totals stay');
  ok((state.delCalls || []).length === 2 && state.delCalls.every((c) => c.month === '2026-10' && c.max === 5000), 'deleted in parts (2 calls of up to 5,000) - ' + JSON.stringify(state.delCalls));
  r = await rows();
  ok(/October 2026 — — Totals only \(details deleted\)/.test(r), 'October now shows "Totals only (details deleted)" - ' + r);
  const msg = await p.textContent('[role=status]').catch(() => '');
  ok(/October 2026:? ?7,030 KHQR records deleted · KPI and dashboard totals kept/.test(msg), 'message: records deleted, KPI totals kept [' + msg + ']');
  // keep 3 months instead of 6: confirm (shorter), saved
  await sec.locator('select[aria-label="Months of KHQR details kept"]').selectOption('3'); await sec.getByRole('button', { name: /Save/ }).click(); await sleep(1500);
  ok(state.retSet && state.retSet.keep_months === 3 && dialogs.some((d) => /Keep KHQR details for 3 month\(s\) instead of 6/.test(d)), 'keep 3 months: confirmed and saved');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();

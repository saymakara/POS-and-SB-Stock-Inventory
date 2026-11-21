// (21 Nov 2026) Sound Box review page: SB Operational Support and SB Maintenance as separate cards / types, against a stand-in of the Supabase API (harness from inv_e2e.js).
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
  events: [
    { id: 1, source_record_id: 'SB-20261121-0001', unit_no: 1, revision: 1, kind: 'INSTALL', device_type: 'Sound Box', serial: 'SBA001', old_serial: null, mid: '600000000000001', tid: null, terminal_name: 'Shop 1', outlet_name: 'Shop 1', branch_text: 'Toul Kork', branch_id: '105', staff_id: 'STF001', staff_name: 'Sok Dara', recorded_at: '2026-11-21T01:00:00+07:00', payload: { entry: {}, unit: {} }, issues: [], status: 'PENDING', received_at: '2026-11-21T01:00:00Z' },
    { id: 2, source_record_id: 'SBO-20261121-0001', unit_no: 1, revision: 1, kind: 'SB_MAINT', device_type: 'Sound Box', serial: 'SBA002', old_serial: null, mid: '600000000000002', tid: null, terminal_name: 'Shop 2', outlet_name: 'Shop 2', branch_text: 'Toul Kork', branch_id: '105', staff_id: 'STF001', staff_name: 'Sok Dara', recorded_at: '2026-11-21T02:00:00+07:00', payload: { entry: {}, unit: {} }, issues: [], status: 'PENDING', received_at: '2026-11-21T02:00:00Z' },
    { id: 3, source_record_id: 'SBO-20261121-0002', unit_no: 1, revision: 1, kind: 'SB_MAINT', device_type: 'Sound Box', serial: 'SBA003', old_serial: null, mid: '600000000000003', tid: null, terminal_name: 'Shop 3', outlet_name: 'Shop 3', branch_text: 'Toul Kork', branch_id: '105', staff_id: 'STF001', staff_name: 'Sok Dara', recorded_at: '2026-11-21T03:00:00+07:00', payload: { entry: {}, unit: {} }, issues: [], status: 'PENDING', received_at: '2026-11-21T03:00:00Z' },
    { id: 4, source_record_id: 'SBM-20261120-0001', unit_no: 1, revision: 1, kind: 'SB_MAINT', device_type: 'Sound Box', serial: 'SBA004', old_serial: null, mid: '600000000000004', tid: null, terminal_name: 'Shop 4', outlet_name: 'Shop 4', branch_text: 'Toul Kork', branch_id: '105', staff_id: 'STF001', staff_name: 'Sok Dara', recorded_at: '2026-11-21T04:00:00+07:00', payload: { entry: {}, unit: {} }, issues: [], status: 'PENDING', received_at: '2026-11-21T04:00:00Z' },
    { id: 5, source_record_id: 'SRT-20261120-0001', unit_no: 1, revision: 1, kind: 'SB_RETURN', device_type: 'Sound Box', serial: 'SBA005', old_serial: null, mid: '600000000000005', tid: null, terminal_name: 'Shop 5', outlet_name: 'Shop 5', branch_text: 'Toul Kork', branch_id: '105', staff_id: 'STF001', staff_name: 'Sok Dara', recorded_at: '2026-11-21T05:00:00+07:00', payload: { entry: {}, unit: {} }, issues: [], status: 'PENDING', received_at: '2026-11-21T05:00:00Z' },
  ],
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
  await p.goto('http://127.0.0.1:8500/index.html'); await sleep(1500);
  await p.fill('#empId', '8986'); await p.fill('#pw', 'Secret123'); await p.click('button[type=submit]'); await sleep(3000);
  await p.click('text=Merchant App Review'); await sleep(1500);
  await p.locator('aside').first().getByRole('group', { name: 'Merchant App Review sections' }).getByRole('button', { name: /^Sound Box/ }).click(); await sleep(1800);
  const txt = (await p.textContent('body')).replace(/\s+/g, ' ');
  ok(/SB operational support\s*2 waiting/.test(txt) && /SB maintenance\s*1 waiting/.test(txt), 'separate cards: "SB operational support" (2) and "SB maintenance" (1)');
  const cards = [...txt.matchAll(/(Installation|Replacement|Sound Box returned|SB operational support|SB maintenance)\s*(\d+|No records)/g)].map((m) => m[1]);
  ok(cards.join('|').startsWith('Installation|Replacement|Sound Box returned|SB operational support|SB maintenance'), 'cards in the app\'s order: Installation, Replacement, Return, SB Operational Support, SB Maintenance - ' + cards.join(', '));
  const sel = p.locator('select[aria-label="Filter by record type"]');
  const opts = (await sel.locator('option').allTextContents()).map((s) => s.replace(/ /g, ' ').trim());
  ok(opts.includes('SB operational support (2)') && opts.includes('SB maintenance (1)'), 'type filter: both, as their own types - ' + opts.join(' | '));
  ok(!opts.some((o) => /Integrated installation/.test(o)), 'no Integrated installation option on the Sound Box page');
  const rows = async () => (await p.locator('section[aria-label="Records"] button[aria-expanded]').allTextContents()).join(' | ');
  await sel.selectOption('SB_MAINT'); await sleep(900);
  let r = await rows(); ok(/SBA002/.test(r) && /SBA003/.test(r) && !/SBA004/.test(r) && !/SBA001/.test(r), 'SB operational support: only the SBO- records - ' + r.slice(0, 100));
  await sel.selectOption('SB_MAINTENANCE'); await sleep(900);
  r = await rows(); ok(/SBA004/.test(r) && !/SBA002/.test(r) && !/SBA003/.test(r), 'SB maintenance: only the SBM- record - ' + r.slice(0, 100));
  ok(/SB maintenance/.test(await p.locator('section[aria-label="Records"]').textContent()), 'its line says "SB maintenance" as its record type');
  await sel.selectOption('ALL'); await sleep(900);
  r = await rows(); ok(['SBA001', 'SBA002', 'SBA003', 'SBA004', 'SBA005'].every((s) => r.includes(s)), 'All Types: all 5 Sound Box records');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();

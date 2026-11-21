// (22 Nov 2026) Stock Inventory > Upload CSV against a stand-in of the Supabase API, with 27,000 units already in stock.
// Run with no settings to run every scenario (each in its own browser); ROWS / MODE / COMMIT / REFUSE run one scenario.
//   new     5,000 new serials: preview fast, one save step (stage parts + one commit), no per-unit requests, window closes
//   move    1,000 HQ stock units to a branch: the same, as moves carrying the version the page loaded
//   refuse  the server finds a problem: nothing saved, window stays open, the problem shows on its row
//   dup     a repeated battery serial and TIDs already used / repeated are caught before anything is sent
const { chromium } = require('playwright');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const B = process.env.SUPABASE_URL || 'https://mrrzfmtaqjdwhwznznie.supabase.co';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub) => b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, aud: 'authenticated' }) + '.sig';
const USERS = { '8986@staff.pos-sb-inventory.internal': { id: 'u-sa', pw: 'Secret123', profile: { user_id: 'u-sa', emp_id: '8986', name: 'SAY Chanmakara', role: 'SUPER_ADMIN', branch_id: '100', position: null, active: true, must_change_password: false } },
  '25490@staff.pos-sb-inventory.internal': { id: 'u-br', pw: 'First123', profile: { user_id: 'u-br', emp_id: '25490', name: 'SEOUN Chettra', role: 'BRANCH', branch_id: '105', position: null, active: true, must_change_password: true } } };
const dev = (serial, stage, branch, extra) => Object.assign({ serial, type: 'POS Terminal', model: 'Q2', stage, branch_id: branch, branch_name: 'Branch ' + branch, stock_in_date: '2026-10-01', history: [], custom_fields: {}, archived: false, redeploy_count: 0 }, extra || {});
const BIG = Number(process.env.EXISTING || 27000);
const state = { devices: [...Array.from({ length: BIG }, (_, i) => dev('EX' + String(i).padStart(8, '0'), i % 3 ? 'BRANCH_RESERVE' : 'HQ_STOCK', i % 3 ? '105' : '100', { row_version: 1 })), dev('WP0001', 'BRANCH_RESERVE', '105', { row_version: 3, custom_fields: { latitude: 11.55, longitude: 104.92, installedByStaff: 'Sok Dara' } }), dev('WP0002', 'COMPLETE', '105', { mid: '200100000000001', tid: '00000001', merchant_name: 'Lucky Mart', row_version: 1 }),
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
    if (method === 'PATCH') { state.patches = (state.patches || 0) + 1;
      state.patched = state.patched || []; state.patched.push(body);
      const sn = (url.searchParams.get('serial') || '').replace(/^eq\./, ''); const d = state.devices.find(x => x.serial === sn);
      if (state.staleNext) { state.staleNext = false; return json(409, { code: '40001', message: 'STALE_ROW: device ' + sn + ' was changed by someone else just now' }); }
      if (!d) return json(200, []);
      if (body.row_version && body.row_version !== d.row_version) return json(409, { code: '40001', message: 'STALE_ROW: device ' + sn });
      Object.assign(d, body, { row_version: (d.row_version || 1) + 1 }); return json(200, [{ serial: sn, row_version: d.row_version }]);
    }
    if (method === 'POST') { state.posts = (state.posts || 0) + 1; state.postRows = (state.postRows || 0) + (Array.isArray(body) ? body.length : 1); (Array.isArray(body) ? body : [body]).forEach((r) => state.devices.push(Object.assign({ row_version: 1 }, r))); return json(201, (Array.isArray(body) ? body : [body]).map((r) => ({ serial: r.serial, row_version: 1 }))); if (state.refuse) return json(403, { code: '42501', message: 'new row violates row-level security policy for table "devices"' }); return json(201, []); }
    if (method === 'DELETE') {
      const snParam = url.searchParams.get('serial') || '';
      const inMatch = snParam.match(/^in\.\((.*)\)$/);
      const sns = inMatch ? inMatch[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')) : [snParam.replace(/^eq\./, '')];
      state.devices = state.devices.filter(x => !sns.includes(x.serial));
      return json(200, sns.map(sn => ({ serial: sn })));
    }
    const all = me && me.profile.role === 'BRANCH' ? state.devices.filter(d => d.branch_id === me.profile.branch_id) : state.devices;
    const inSer = url.searchParams.get('serial'); if (inSer && inSer.startsWith('in.(')) { const want = new Set(inSer.slice(4, -1).split(',').map((s) => s.replace(/^"|"$/g, ''))); return json(200, all.filter((d) => want.has(d.serial)).map((d) => ({ serial: d.serial, row_version: d.row_version }))); }
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
  if (path === '/rest/v1/rpc/cc_counts') return json(200, { pending: 0, confirmed: 0, rejected: 0, no_review: 0, total: 0 });
  if (path === '/rest/v1/qr_installations') return json(200, [], { 'content-range': '0-0/0' });
  if (path === '/rest/v1/qr_attempts') return json(200, []);
  if (path === '/rest/v1/rpc/qr_summary') return json(200, { total: 0, completed: 0, failed: 0, install: 0, replace: 0, qr: 0, attempts: 0, staff_failed: 0 });
  if (path === '/rest/v1/rpc/qr_month_history') return json(200, []);
  if (path === '/rest/v1/rpc/device_page_bounds') return json(200, []);
  if (path === '/rest/v1/rpc/get_device_stage_counts') return json(200, {});
  if (path === '/rest/v1/rpc/cc_list') return json(200, []);
  if (path === '/rest/v1/rpc/kpi_dashboard_summary') return json(200, []);
  if (path === '/rest/v1/rpc/stock_batch_stage') { state.stageCalls = (state.stageCalls || 0) + 1; (state.staged = state.staged || []).push(...body.p.rows); return json(200, { staged: body.p.rows.length }); }
  if (path === '/rest/v1/rpc/stock_batch_commit') {
    state.commitCalls = (state.commitCalls || 0) + 1; const rows = state.staged || []; state.staged = [];
    if (process.env.REFUSE) return json(200, { ok: false, error_count: 1, errors: [{ row: 2, column: 'Serial_SN', message: 'Serial "X" is already in the inventory (HQ Stock at Head Office).' }] });
    const versions = rows.map((r) => { const d = state.devices.find((x) => x.serial === r.device.serial); if (d) { Object.assign(d, r.device); d.row_version = (d.row_version || 1) + 1; } else state.devices.push(Object.assign({}, r.device, { row_version: 1 })); return { serial: r.device.serial, row_version: d ? d.row_version : 1 }; });
    state.committedRows = rows.length; return json(200, { ok: true, created: rows.filter((r) => r.op === 'create').length, moved: rows.filter((r) => r.op === 'move').length, versions });
  }
  if (path === '/rest/v1/kpi_point_rules') return json(200, []);
  if (path === '/rest/v1/kpi_settings') return json(200, [{ id: 1 }]);
  return json(404, { message: 'not in the stand-in: ' + path });
}
if (!process.env.MODE && !process.env.ROWS) {
  // all scenarios, each in its own process and browser
  const { spawnSync } = require('child_process');
  const runs = [
    { MODE: 'new', ROWS: '5000', COMMIT: '1' },
    { MODE: 'move', ROWS: '1000', COMMIT: '1' },
    { MODE: 'new', ROWS: '300', COMMIT: '1', REFUSE: '1' },
    { MODE: 'dup', ROWS: '4' },
  ];
  let bad = 0;
  for (const r of runs) {
    const out = spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, r), encoding: 'utf8', timeout: 400000 });
    const lines = String(out.stdout || '').split('\n').filter((l) => /^(PASS|FAIL|\{)/.test(l));
    console.log('--- ' + JSON.stringify(r)); lines.forEach((l) => console.log(l));
    if (out.status !== 0) bad++;
  }
  console.log(bad ? `FAILED: ${bad} scenario(s)` : 'ALL PASSED');
  process.exit(bad ? 1 : 0);
}
(async () => {
  const N = Number(process.env.ROWS || 5000), MODE = process.env.MODE || 'new';
  const fs = require('fs'), path = '/tmp/claude-0/-home-user/686d8e03-0881-5953-b7e9-a3bcf9d68a19/scratchpad/batchperf/batch_' + N + '_' + MODE + '.csv';
  const lines = ['Serial_SN,Product_Type,Model,Battery_Serial,Branch_Code,Branch_Name,Lifecycle_Stage,Assigned_Staff' + (MODE === 'dup' ? ',Merchant_Name,MID' : '')];
  if (MODE === 'dup') lines.push(
    'ZNEW01,POS Terminal,Wizar POS Q2 Pro,ZDUP,100,Head Office,HQ_STOCK,,,',
    'ZNEW02,POS Terminal,Wizar POS Q2 Pro,ZDUP,100,Head Office,HQ_STOCK,,,',
    'ZNEW03,POS Terminal,Wizar POS Q2 Pro,ZB3,105,Toul Kork Branch,CONFIGURING,SEOUN Chettra (25490),Shop A,200100000000001',
    'ZNEW04,POS Terminal,Wizar POS Q2 Pro,ZB4,105,Toul Kork Branch,CONFIGURING,SEOUN Chettra (25490),Shop B,209900000000001');
  for (let i = 0; i < (MODE === 'dup' ? 0 : N); i++) {
    if (MODE === 'new') lines.push(`WPNEW${String(i).padStart(7, '0')},POS Terminal,Wizar POS Q2 Pro,ZBAT${i},100,Head Office,HQ_STOCK,`);
    else lines.push(`EX${String(i * 3).padStart(8, '0')},POS Terminal,Wizar POS Q2 Pro,,105,Toul Kork Branch,BRANCH_RESERVE,SEOUN Chettra (25490)`);   // HQ stock -> branch
  }
  fs.writeFileSync(path, lines.join('\n'));
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(B + '/**', api);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('crash', () => console.log('PAGE CRASHED')); p.on('close', () => console.log('PAGE CLOSED')); p.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|Failed to load resource/.test(m.text())) console.log('console: ' + m.text().slice(0, 200)); });
  await p.addInitScript(() => { window.__lt = []; new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: 'longtask', buffered: true }); });
  await p.goto('http://127.0.0.1:8500/index.html'); await sleep(1500);
  await p.fill('#empId', '8986'); await p.fill('#pw', 'Secret123'); await p.click('button[type=submit]'); await sleep(6000);
  await p.getByText('Stock Inventory', { exact: true }).first().click(); await sleep(2500);
  await p.getByRole('button', { name: /Upload CSV/ }).first().click(); await sleep(1500);
  const cdp = await ctx.newCDPSession(p); if (process.env.CPU) await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU) });
  await p.evaluate(() => { window.__lt = []; window.__t0 = performance.now(); });
  await p.locator('input[type=file][accept=".csv,.txt"]').first().setInputFiles(path);
  const t0 = Date.now();
  if (MODE === 'dup') {
    await p.waitForFunction(() => /Upload Halted/i.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {});
    const txt = await p.evaluate(() => document.body.innerText);
    const sent = (state.stageCalls || 0) + (state.commitCalls || 0) + (state.posts || 0) + (state.patches || 0);
    ok(/Battery serial "ZDUP" is twice in the file \(first at Row 2\)/.test(txt), 'repeated battery serial in the file is caught (row 3 points at row 2)');
    ok(/TID "00000001" is already used by WP0002/.test(txt), 'TID already on an installed unit is caught');
    ok(/TID "00000001" is twice in the file \(first at Row 4\)/.test(txt), 'TID repeated in the file is caught');
    ok(/Upload halted: fix/.test(txt) && await p.getByRole('button', { name: /Review Intake Batch/ }).isDisabled(), 'the upload is halted until the file is fixed');
    ok(sent === 0, 'nothing was sent to the server (' + sent + ' save requests)');
    console.log('errors: ' + errs.length + ' ' + errs.slice(0, 2).join(' | ')); ok(errs.length === 0, 'no page errors');
    await b.close(); process.exit(fails ? 1 : 0);
  }
  await p.waitForFunction((n) => new RegExp('(' + n + '|' + n.toLocaleString('en-US') + ') pre-validated serials ready').test(document.body.innerText), N, { timeout: Number(process.env.WAIT || 600000) }).catch(() => {});
  const validateMs = Date.now() - t0;
  const t2 = Date.now();
  await p.getByRole('button', { name: /Review Intake Batch/ }).click().catch(() => {});
  await p.waitForFunction((n) => [...document.querySelectorAll('button')].some((x) => x.textContent.includes('Confirm & Commit ' + n + ' Entries')), N, { timeout: Number(process.env.WAIT || 600000) }).catch(() => {});
  const step2Ms = Date.now() - t2;
  const lt = await p.evaluate(() => window.__lt.filter((x) => x[0] >= window.__t0).map((x) => x[1]));
  const domRows = await p.evaluate(() => document.querySelectorAll('tbody tr').length);
  const btn = await p.evaluate(() => ([...document.querySelectorAll('button')].find((x) => /Confirm & Commit/.test(x.textContent)) || {}).textContent);
  if (process.env.DEBUG) { console.log((await p.evaluate(() => { const d = [...document.querySelectorAll('[role=dialog], aside, div')].find((x) => /Confirm & Commit/.test(x.textContent) && x.textContent.length < 20000); return d ? d.innerText.slice(0, 2500) : 'no dialog'; }))); await p.screenshot({ path: '/tmp/claude-0/-home-user/686d8e03-0881-5953-b7e9-a3bcf9d68a19/scratchpad/batchperf/dbg.png' }); }
  console.log(JSON.stringify({ rows: N, mode: MODE, preview_ready_ms: validateMs, step2_ms: step2Ms, longest_freeze_ms: Math.max(0, ...lt), total_frozen_ms: lt.reduce((a, x) => a + x, 0), dom_rows: domRows, button: btn }));
  ok(new RegExp('Confirm & Commit ' + N + ' Entries').test(btn || ''), 'all ' + N + ' rows pass pre-validation');
  ok(validateMs < 3000, 'preview ready in ' + validateMs + ' ms (< 3 s; was 9.0 s for 5,000 rows)');
  ok(domRows <= 260 + 260, 'preview draws at most a page of rows (' + domRows + ' table rows on screen)');
  if (process.env.COMMIT) {
    state.posts = 0; state.patches = 0; state.postRows = 0;
    await p.evaluate(() => { window.__lt = []; window.__t0 = performance.now(); });
    const t1 = Date.now();
    await p.locator('button', { hasText: /Confirm & Commit/ }).click();
    await p.waitForFunction(() => !/Confirm & Commit/.test(document.body.innerText) || /Nothing was saved/.test(document.body.innerText), null, { timeout: 120000, polling: 50 }).catch(() => {});
    if (process.env.DEBUG) await p.screenshot({ path: '/tmp/claude-0/-home-user/686d8e03-0881-5953-b7e9-a3bcf9d68a19/scratchpad/batchperf/after_save.png' });
    const saveMs = Date.now() - t1;
    await sleep(3000);
    const lt2 = await p.evaluate(() => window.__lt.filter((x) => x[0] >= window.__t0).map((x) => x[1]));
    const msg = await p.evaluate(() => { const m = document.body.innerText.match(/(Saved: [^\n]*|Nothing was saved[^\n]*)/); return m ? m[1].slice(0, 200) : ''; });
    const open = await p.evaluate(() => /Batch Hardware Stock Intake/.test(document.body.innerText));
    console.log(JSON.stringify({ save_ms: saveMs, stage_calls: state.stageCalls || 0, commit_calls: state.commitCalls || 0, rows_committed: state.committedRows || 0, post_requests: state.posts, patch_requests: state.patches, longest_freeze_ms: Math.max(0, ...lt2), window_still_open: open, message: msg }));
    ok(state.commitCalls === 1 && state.stageCalls === Math.ceil(N / 2000), 'one save step: ' + state.stageCalls + ' part(s) sent + 1 commit');
    ok(!state.posts && !state.patches, 'no per-unit or per-batch requests (' + (state.posts || 0) + ' POST, ' + (state.patches || 0) + ' PATCH)');
    if (process.env.REFUSE) {
      ok(open && /Nothing was saved/.test(msg), 'refused: window stays open and says nothing was saved');
      ok(!state.committedRows, 'refused: no rows saved');
      const txt = await p.evaluate(() => document.body.innerText);
      ok(/Row 3, Column 1 \(Serial_SN\)/.test(txt) && /checked on the server/.test(txt), 'refused: the server problem shows on its CSV row (row 3)');
    } else {
      ok(!open && state.committedRows === N, 'saved: all ' + N + ' rows saved and the window closed');
      const stockText = await p.evaluate(() => document.body.innerText);
      if (MODE === 'new') ok(/WPNEW0000000/.test(stockText), 'the new units show in the stock list straight away');
      else ok(!/EX00000000\s[^\n]*Admin HQ Stock/.test(stockText), 'the moved units no longer show as HQ stock');
    }
  }
  console.log('errors: ' + errs.length + ' ' + errs.slice(0, 2).join(' | '));
  ok(errs.length === 0, 'no page errors');
  await b.close();
  process.exit(fails ? 1 : 0);
})();

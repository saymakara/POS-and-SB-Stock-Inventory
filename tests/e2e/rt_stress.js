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
  reqs: [{ req_id: 'REQ-20261022-ABC123', date: '2026-10-22 09:00', branch_id: '105', branch_name: 'Toul Kork Branch', staff: 'SEOUN Chettra (25490)', pos_qty: 1, sb_qty: 0, reason: 'New merchants', status: 'PENDING_ADMIN', arranged_devices: [], type: 'STOCK_REQUEST', return_serials: [] }],
  events: [{ id: 7, source_record_id: 'POS-20261021-0001', unit_no: 1, revision: 1, kind: 'INSTALL', device_type: 'POS Terminal', serial: 'WP0001', old_serial: null, mid: '200123456789012', tid: '56789012',
    terminal_name: 'Till 1', outlet_name: 'Sokha Mart', branch_text: 'Toul Kork', branch_id: '105', staff_id: 'STF001', staff_name: 'Sok Dara', recorded_at: '2026-10-21T09:00:00+07:00', latitude: 11.55, longitude: 104.92,
    remarks: 'Installed', payload: {}, issues: [], status: 'PENDING', received_at: '2026-10-21T02:01:00Z' },
    { id: 8, source_record_id: 'POS-20261021-0002', unit_no: 1, revision: 1, kind: 'INSTALL', device_type: 'POS Terminal', serial: 'WP0002', mid: '200999', tid: '999', outlet_name: 'Other', branch_text: 'Toul Kork', branch_id: '105',
      staff_name: 'Sok Dara', recorded_at: '2026-10-21T10:00:00+07:00', payload: {}, issues: [{ code: 'ALREADY_INSTALLED', level: 'warn', text: 'Serial WP0002 is already installed at Lucky Mart (MID 200100000000001).' }], status: 'PENDING', received_at: '2026-10-21T03:00:00Z' }],
  calls: [], saved: [], audit: [] };

// ---------- STRESS DATA (22 Oct 2026 review) ----------
const N_DEV = Number(process.env.N_DEV || 20000);
const BR = ['100','101','102','103','104','105','106','107','108','109','110','111','112','113','114','115','116','117','119','120','121','122','123','124','126','127','129','130','131','132','133','134','801'];
const STG = ['HQ_STOCK','BRANCH_RESERVE','CONFIGURING','COMPLETE','COMPLETE','COMPLETE','LOST'];
state.devices = [];
for (let i = 0; i < N_DEV; i++) {
  const stg = STG[i % STG.length]; const br = stg === 'HQ_STOCK' ? '100' : BR[1 + (i % (BR.length - 1))];
  const done = stg === 'COMPLETE';
  state.devices.push(dev('WP' + String(100000 + i), stg, br, { type: i % 3 === 0 ? 'Sound Box' : 'POS Terminal', row_version: 1 + (i % 5),
    mid: done ? String(200000000000000 + i) : null, tid: done ? String(10000000 + i) : null, merchant_name: done ? 'Merchant "' + i + '", St ' + (i % 300) + ' #' + i : null,
    merchant_phone: done ? '0' + (12000000 + i) : null, deployed_date: done ? '2026-' + String(1 + (i % 10)).padStart(2, '0') + '-15' : null,
    history: ['2026-10-01 09:00 | Stock Intake | HQ', '2026-10-05 10:00 | Dispatched | Branch ' + br, '2026-10-07 11:00 | Received | ' + br],
    custom_fields: done ? { installedByStaff: 'Staff ' + (i % 130), latitude: 11.5 + (i % 100) / 1000 } : {} }));
}
state.reqs = [];
for (let i = 0; i < 1500; i++) state.reqs.push({ req_id: 'REQ-2026' + String(1000000 + i), date: '2026-10-' + String(1 + (i % 22)).padStart(2, '0') + ' 09:00', branch_id: BR[1 + (i % 32)], branch_name: 'Branch ' + BR[1 + (i % 32)], staff: 'Staff ' + i, pos_qty: 1 + (i % 4), sb_qty: i % 3, reason: 'New merchants', status: ['PENDING_ADMIN','DISPATCHED','RECEIVED','REJECTED'][i % 4], arranged_devices: [], type: i % 7 === 0 ? 'STOCK_RETURN' : 'STOCK_REQUEST', return_serials: [] });
state.events = [];
for (let i = 0; i < 3000; i++) state.events.push({ id: 1000 + i, source_record_id: 'POS-2026-' + i, unit_no: 1, revision: 1, kind: ['INSTALL','REPLACE','BATTERY','SB_MAINT'][i % 4], device_type: i % 3 === 0 ? 'Sound Box' : 'POS Terminal',
  serial: 'WP' + String(100000 + (i * 7) % N_DEV), old_serial: i % 4 === 1 ? 'WP' + String(100000 + (i * 11) % N_DEV) : null, mid: String(200000000000000 + i), tid: String(10000000 + i), outlet_name: 'Outlet ' + i, terminal_name: 'Till ' + (i % 3),
  branch_text: 'Branch ' + BR[1 + (i % 32)], branch_id: i % 50 === 0 ? '401' : BR[1 + (i % 32)], staff_id: 'S' + i, staff_name: 'Staff ' + (i % 130), recorded_at: '2026-10-20T09:00:00+07:00', payload: {},
  issues: i % 9 === 0 ? [{ code: 'W', level: 'warn', text: 'Check this' }] : [], status: i < 1000 ? 'PENDING' : ['APPROVED','REJECTED','SUPERSEDED'][i % 3], received_at: new Date(Date.UTC(2026, 9, 1) + i * 60000).toISOString() });
const STAFF = [];
for (let i = 0; i < 130; i++) STAFF.push({ user_id: 'u-' + i, emp_id: String(20000 + i), name: 'STAFF Number' + i, role: i < 3 ? 'ADMIN' : 'BRANCH', branch_id: BR[i % 33], position: 'Officer', contact: null, active: true, must_change_password: i % 2 === 0, updated_at: '2026-10-22T00:00:00Z' });

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
    return json(200, me && me.profile.role !== 'BRANCH' ? Object.values(USERS).map(x => x.profile).concat(STAFF) : [p]);
  }
  if (path === '/rest/v1/branches') { if (method !== 'GET') { state.branchSaves = (state.branchSaves || []).concat([body]); return json(201, []); } return json(200, BR.map((id) => ({ id, code: id, name: id === '100' ? 'Head Office' : 'Branch ' + id, region: 'Phnom Penh' }))); }
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
  if (path === '/rest/v1/historical_merchants') return json(200, []);
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
  if (path === '/rest/v1/audit_logs') { state.audit.push(body); return json(201, []); }
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
  // a stand-in of the Supabase live feed (Phoenix protocol, JSON v2 frames)
  const sockets = [];
  await ctx.routeWebSocket(/realtime\/v1\/websocket/, (ws) => {
    const conn = { ws, topics: {} }; sockets.push(conn);
    ws.onMessage((raw) => {
      let m; try { m = JSON.parse(String(raw)); } catch (e) { return; }
      const [joinRef, ref, topic, event, payload] = m;
      if (event === 'heartbeat') return ws.send(JSON.stringify([null, ref, 'phoenix', 'phx_reply', { status: 'ok', response: {} }]));
      if (event === 'phx_join') {
        const pcs = ((payload && payload.config && payload.config.postgres_changes) || []).map((c, i) => Object.assign({ id: 100 + i + Object.keys(conn.topics).length * 10 }, c));
        conn.topics[topic] = { joinRef, pcs };
        ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: pcs } }]));
        return;
      }
      if (event === 'phx_leave') return ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]));
      if (ref) ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]));
    });
  });
  const COLS = [{ name: 'serial', type: 'text' }, { name: 'stage', type: 'text' }, { name: 'branch_id', type: 'text' }, { name: 'row_version', type: 'int4' }, { name: 'history', type: 'jsonb' }, { name: 'custom_fields', type: 'jsonb' }, { name: 'type', type: 'text' }];
  const push = (table, type, record, oldRecord) => {
    let n = 0;
    for (const c of sockets) for (const [topic, t] of Object.entries(c.topics)) {
      const pc = t.pcs.find((x) => x.table === table && (x.event === '*' || x.event === type));
      if (!pc) continue;
      c.ws.send(JSON.stringify([null, null, topic, 'postgres_changes', { ids: [pc.id], data: { schema: 'public', table, commit_timestamp: new Date().toISOString(), type, record: record || {}, old_record: oldRecord || {}, columns: COLS, errors: null } }]));
      n++;
    }
    return n;
  };
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', (m) => { if (/DBG/.test(m.text())) console.log(m.text()); });
  await p.addInitScript(() => {
    window.__lt = 0; window.__ltMax = 0;
    try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { window.__lt += e.duration; window.__ltMax = Math.max(window.__ltMax, e.duration); })).observe({ type: 'longtask', buffered: true }); } catch (e) {}
  });
  const lt = async () => p.evaluate(() => { const r = { total: Math.round(window.__lt), max: Math.round(window.__ltMax) }; window.__lt = 0; window.__ltMax = 0; return r; });
  await p.goto('http://127.0.0.1:8500/index.html'); await sleep(1200);
  await p.fill('#empId', '8986'); await p.fill('#pw', 'Secret123'); await p.click('button[type=submit]'); await sleep(4000);
  ok(sockets.length > 0 && sockets.some((c) => Object.keys(c.topics).length), 'live feed connected: ' + sockets.length + ' socket(s), topics ' + JSON.stringify(sockets.map((c) => Object.keys(c.topics))));
  await p.getByText('Stock Inventory', { exact: true }).first().click(); await sleep(1500);
  // 1) a burst of 500 changes from other users (e.g. a bulk dispatch): HQ_STOCK → BRANCH_RESERVE
  const hq = state.devices.filter((d) => d.stage === 'HQ_STOCK').slice(0, 500);
  await lt();
  const t0 = Date.now();
  hq.forEach((d) => { d.stage = 'BRANCH_RESERVE'; d.branch_id = '105'; d.row_version = (d.row_version || 1) + 1; push('devices', 'UPDATE', Object.assign({}, d)); });
  await sleep(1500);
  const l1 = await lt();
  ok(l1.max < 400 && !errs.length, `burst of 500 live changes applied: main thread busy ${l1.total} ms, longest freeze ${l1.max} ms (limit 400) ` + errs.join(' | '));
  const hqLeft = await p.evaluate(() => document.body.innerText);
  // 2) verify the stock moved in the app state by searching one unit
  const box = p.locator('input[placeholder^="Search Serial SN"]');
  await box.fill(hq[0].serial); await sleep(700);
  ok(/Branch Reserve/i.test(await p.locator('tbody').first().innerText()), 'a unit changed live shows its new stage (Branch Reserve)');
  // 3) an OLDER copy of a unit arriving late must not replace the newer one
  const d0 = hq[0]; push('devices', 'UPDATE', Object.assign({}, d0, { stage: 'HQ_STOCK', branch_id: '100', row_version: 1 })); await sleep(800);
  ok(/Branch Reserve/i.test(await p.locator('tbody').first().innerText()), 'an older copy arriving late is ignored (the newer stage stays)');
  // 4) a delete on the server removes the unit here
  push('devices', 'DELETE', null, { serial: d0.serial }); await sleep(800);
  { const tb = await p.locator('tbody').first().innerText(); ok(!tb.includes(d0.serial), 'a unit deleted on the server disappears live: ' + tb.slice(0, 200)); }
  // 5) a new unit inserted elsewhere appears
  push('devices', 'INSERT', { serial: 'WPNEW0001', stage: 'HQ_STOCK', branch_id: '100', row_version: 1, history: [], custom_fields: {}, type: 'POS Terminal' });
  await box.fill('WPNEW0001'); await sleep(800);
  ok((await p.locator('tbody').first().innerText()).includes('WPNEW0001'), 'a unit added on the server appears live');
  // 6) nothing received live is sent back to the server
  const writes = state.calls.filter((c) => /^(PATCH|POST) \/rest\/v1\/devices/.test(c));
  ok(writes.length === 0, 'live changes are not echoed back to the server (writes: ' + writes.length + ')');
  console.log('FIRST WRITES', JSON.stringify((state.patched || []).slice(0, 2)).slice(0, 1500), writes.slice(0, 3));
  // 7) sustained feed: 20 changes per second for 10 seconds while typing
  await box.fill('');
  await lt();
  const others = state.devices.filter((d) => d.stage === 'COMPLETE').slice(0, 200);
  for (let s2 = 0; s2 < 10; s2++) {
    for (let k = 0; k < 20; k++) { const d = others[s2 * 20 + k]; d.row_version = (d.row_version || 1) + 1; d.history = ['2026-10-22 | live ' + s2].concat(d.history || []); push('devices', 'UPDATE', Object.assign({}, d)); }
    await box.pressSequentially(String(s2), { delay: 20 });
    await sleep(1000);
  }
  const l2 = await lt();
  ok(l2.max < 400 && !errs.length, `sustained live feed (20/s for 10 s) while typing: busy ${l2.total} ms, longest freeze ${l2.max} ms`);
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();

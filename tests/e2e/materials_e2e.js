// Merchant kit & materials (5 Nov 2026), against the stand-in Supabase API. Never touches live data.
// Admin HQ: Stock Inventory group, POS Terminal (Units / Material), Stock In, Lost write-off, Sound Box material, SIM Card
// (Blocked with carrier), Merchant 360 Kit (Record kit), dispatch of a request with materials.
// Branch staff: own-branch views without admin actions, stock request with materials.
// Run against a built dist/ served on 127.0.0.1:8500 (node tests/e2e/serve-dist.cjs).
process.env.N_DEV = process.env.N_DEV || '300';
const S = require('./lib/standin.js');
const { chromium, B, state, sleep, USERS } = S;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const IGNORE = /WebSocket connection to .*realtime|Failed to load resource|ERR_TUNNEL|net::ERR/;

USERS['33105@staff.pos-sb-inventory.internal'] = { id: 'u-b105', pw: 'Branch123', profile: { user_id: 'u-b105', emp_id: '33105', name: 'SOK Branch', role: 'BRANCH', branch_id: '105', position: null, active: true, must_change_password: false } };
const month = (() => { const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Phnom_Penh', year: 'numeric', month: '2-digit' }).formatToParts(new Date()); return p.find((x) => x.type === 'year').value + '-' + p.find((x) => x.type === 'month').value; })();
const now = new Date().toISOString();
const merchantDev = state.devices.find((d) => d.stage === 'COMPLETE' && d.type === 'POS Terminal');
const M = {
  balances: [
    { material_code: 'POS_ADAPTOR', branch_id: '100', on_hand: 500, in_transit: 0, at_merchant: 0 }, { material_code: 'POS_ADAPTOR', branch_id: '105', on_hand: 12, in_transit: 2, at_merchant: 0 },
    { material_code: 'STAND', branch_id: '105', on_hand: 3, in_transit: 0, at_merchant: 0 }, { material_code: 'BATTERY', branch_id: '105', on_hand: 4, in_transit: 0, at_merchant: 0 },
    { material_code: 'SB_ADAPTOR', branch_id: '105', on_hand: 6, in_transit: 0, at_merchant: 0 }, { material_code: 'SIM', branch_id: '100', on_hand: 1200, in_transit: 0, at_merchant: 0 },
    { material_code: 'SIM', branch_id: '105', on_hand: 2, in_transit: 0, at_merchant: 1 },
  ],
  serials: [
    { material_code: 'SIM', serial: '096 555 0142', status: 'AT_MERCHANT', branch_id: '105', device_serial: merchantDev.serial, mid: merchantDev.mid, merchant_name: merchantDev.merchant_name, updated_at: now },
    { material_code: 'SIM', serial: '097 210 8833', status: 'BRANCH_RESERVE', branch_id: '105', updated_at: now },
    { material_code: 'SIM', serial: '097 210 8834', status: 'BRANCH_RESERVE', branch_id: '105', updated_at: now },
    { material_code: 'SIM', serial: '015 778 9014', status: 'LOST', branch_id: '121', updated_at: now },
  ],
  lost: [
    { id: 1, created_at: now, material_code: 'DOCK', serial: null, qty: 1, branch_id: '105', merchant_name: 'Lucky Mart', mid: '200100000000001', source: 'Return', remark: 'Shop closed', reported_by: 'Sok Dara', status: 'OPEN', blocked_with_carrier: false },
    { id: 2, created_at: now, material_code: 'SIM', serial: '015 778 9014', qty: 1, branch_id: '121', merchant_name: 'Kim Heng Shop', source: 'Return', remark: 'Merchant lost the SIM', reported_by: 'Chan Sophea', status: 'OPEN', blocked_with_carrier: false },
  ],
  counts: [{ id: 7, branch_id: '108', month, lines: [{ code: 'POS_ADAPTOR', system: 5, counted: 4, diff: -1, remark: 'given, not recorded' }], differences: 1, status: 'PENDING', submitted_by: 'Staff 108', submitted_at: now }],
  kits: [],
};
state.reqs.unshift({ req_id: 'REQ-MAT-0001', date: '2026-11-05 09:00', branch_id: '105', branch_name: 'Branch 105', staff: 'SOK Branch (33105)', pos_qty: 0, sb_qty: 0, reason: 'Materials only',
  status: 'PENDING_ADMIN', arranged_devices: [], type: 'STOCK_REQUEST', return_serials: [], materials: { SIM: 1, POS_ADAPTOR: 2 }, materials_sent: {} });
const rpcCalls = []; const reqPosts = []; const directWrites = [];
const json = (route, code, o, h) => route.fulfill({ status: code, contentType: 'application/json', headers: Object.assign({ 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' }, h || {}), body: JSON.stringify(o) });
const ranged = (route, list) => json(route, 200, list, { 'content-range': (list.length ? '0-' + (list.length - 1) : '*') + '/' + list.length });
async function api(route) {
  const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
  const body = req.postData() ? (() => { try { return JSON.parse(req.postData()); } catch (e) { return null; } })() : null;
  const me = S.getMe(); const branchOnly = (rows) => (me && me.profile.role === 'BRANCH' ? rows.filter((r) => String(r.branch_id) === me.profile.branch_id) : rows);
  const eq = (k) => { const v = url.searchParams.get(k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
  if (path === '/rest/v1/material_balances') return json(route, 200, branchOnly(M.balances));
  if (path === '/rest/v1/material_serials' && method !== 'GET' && method !== 'HEAD') { directWrites.push(method); return json(route, 403, { code: '42501', message: 'permission denied for table material_serials' }); }
  if (path === '/rest/v1/material_serials') {
    let rows = branchOnly(M.serials).filter((s) => !eq('material_code') || s.material_code === eq('material_code'));
    if (eq('status')) rows = rows.filter((s) => s.status === eq('status'));
    if (eq('branch_id')) rows = rows.filter((s) => s.branch_id === eq('branch_id'));
    const inSt = url.searchParams.get('status'); if (inSt && inSt.startsWith('in.')) { const l = inSt.slice(4, -1).split(','); rows = rows.filter((s) => l.includes(s.status)); }
    if (method === 'HEAD') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-range': '*/' + rows.length }, body: '' });
    return ranged(route, rows);
  }
  if (path === '/rest/v1/material_lost') {
    let rows = branchOnly(M.lost);
    const codes = url.searchParams.get('material_code'); if (codes && codes.startsWith('in.')) { const l = codes.slice(4, -1).split(',').map((x) => x.replace(/"/g, '')); rows = rows.filter((r) => l.includes(r.material_code)); }
    if (eq('status')) rows = rows.filter((r) => r.status === eq('status'));
    return json(route, 200, rows);
  }
  if (path === '/rest/v1/material_counts') return json(route, 200, branchOnly(M.counts).filter((c) => !eq('month') || c.month === eq('month')));
  if (path === '/rest/v1/device_kits') return json(route, 200, M.kits);
  if (path === '/rest/v1/material_movements') return json(route, 200, []);
  if (path === '/rest/v1/requisitions' && method === 'POST') { reqPosts.push(body); state.reqs.unshift(Object.assign({ materials_sent: {} }, body)); return json(route, 201, []); }
  const rpc = path.match(/^\/rest\/v1\/rpc\/((admin_material|admin_kit|material_count|admin_dispatch_request|admin_sim)\w*)$/);
  if (rpc) {
    const p = body && body.p; rpcCalls.push({ fn: rpc[1], p });
    if (me && me.profile.role === 'BRANCH' && rpc[1].startsWith('admin_')) return json(route, 403, { code: '42501', message: 'Only Admin HQ can do this.' });
    if (rpc[1] === 'admin_sim_update' && p.serial === '097 210 8834') return json(route, 400, { code: '22023', message: 'STOCK: SIM 097 210 8834 is lost. Recover it in Lost Materials first.' });
    if (rpc[1] === 'admin_sim_update') { const s = M.serials.find(x => x.serial === p.serial); if (s) { if (p.status) s.status = p.status; if (p.branch_id) s.branch_id = p.branch_id; if (p.device_serial !== undefined) s.device_serial = p.device_serial; if (p.mid !== undefined) s.mid = p.mid; if (p.merchant_name !== undefined) s.merchant_name = p.merchant_name; if (p.blocked !== undefined) s.blocked_with_carrier = p.blocked; if (p.new_serial) s.serial = p.new_serial; } return json(route, 200, s || {}); }
    if (rpc[1] === 'admin_material_stock_in') return json(route, 200, { added: p.qty || (p.serials || []).length, refused: [] });
    if (rpc[1] === 'admin_material_lost_action') { const l = M.lost.find((x) => x.id === p.id); if (p.action === 'BLOCKED') l.blocked_with_carrier = true; else l.status = p.action === 'RECOVER' ? 'RECOVERED' : 'WRITTEN_OFF'; return json(route, 200, { status: l.status }); }
    if (rpc[1] === 'admin_material_count_review') { M.counts.find((c) => c.id === p.id).status = p.action === 'APPROVE' ? 'APPROVED' : 'REJECTED'; return json(route, 200, { status: 'APPROVED' }); }
    if (rpc[1] === 'admin_kit_add') { M.kits.push({ device_serial: p.device_serial, connection: p.connection, items: p.items.map((i) => Object.assign({ qty: 1, given_at: now, given_by: 'TEST' }, i)), updated_at: now }); return json(route, 200, { added: p.items }); }
    if (rpc[1] === 'material_count_submit') { M.counts.push({ id: 99, branch_id: me.profile.branch_id, month: p.month, lines: [], differences: 0, status: 'PENDING', submitted_by: me.profile.name, submitted_at: now }); return json(route, 200, { id: 99, differences: 0 }); }
    if (rpc[1] === 'admin_dispatch_request') { const r = state.reqs.find((x) => x.req_id === p.req_id); r.status = 'DISPATCHED'; r.materials_sent = p.materials; return json(route, 200, { arranged: [], materials_sent: p.materials }); }
    return json(route, 200, {});
  }
  return S.api(route);
}
async function signIn(b, emp, pw, viewport) {
  const ctx = await b.newContext({ viewport: viewport || { width: 1440, height: 900 } });
  await ctx.route(B + '/**', api);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errs.push(m.text()); });
  await p.goto('http://127.0.0.1:' + (process.env.DIST_PORT || '8500') + '/index.html');
  await p.waitForSelector('#empId', { state: 'visible' });
  await p.fill('#empId', emp); await p.fill('#pw', pw); await p.click('button[type=submit]');
  await p.waitForFunction(() => /Dashboard/.test(document.body.innerText), null, { timeout: 30000 }); await sleep(1500);
  return { ctx, p, errs };
}
const stockGroup = (p) => p.locator('aside').first().getByRole('group', { name: 'Stock Inventory sections' });
const last = (fn) => rpcCalls.filter((c) => c.fn === fn).slice(-1)[0];

(async () => {
  const b = await chromium.launch();
  // ===================== Admin HQ =====================
  const { p, errs } = await signIn(b, '8986', 'Secret123');
  const g = stockGroup(p);
  ok(await g.count() === 1, 'Stock Inventory is a menu group');
  ok(await g.getByRole('button', { name: /^Monthly Count/ }).count() === 0, 'no Monthly Count page in the menu');
  ok(await p.locator('aside').first().getByText('Push Configuring', { exact: true }).count() === 0, 'Push Configuring is no longer a menu item');
  for (const t of ['POS Terminal', 'Sound Box', 'SIM Card']) ok(await g.getByRole('button', { name: new RegExp('^' + t) }).isVisible(), `Stock Inventory → ${t}`);
  // (5 Nov 2026) the menu number is the units waiting to be pushed; open lost items show on the Material tab (checked below)

  await g.getByRole('button', { name: /^POS Terminal/ }).click(); await sleep(1500);
  ok(await p.getByRole('tab', { name: 'Units' }).getAttribute('aria-selected') === 'true', 'POS Terminal opens on Units');
  await p.getByRole('tab', { name: /Push Configuring/ }).click(); await sleep(1500);
  ok(/Push Configuring Hub/.test(await p.textContent('main')) && await p.locator('option', { hasText: 'All Device Types' }).count() === 0 && !/Sound Box · /.test(await p.locator('main tbody').first().textContent()),
    'POS Terminal → Push Configuring: the hub with POS units only');
  await p.getByRole('tab', { name: 'Units' }).click(); await sleep(800);
  ok(await p.locator('option', { hasText: 'All Hardware Types' }).count() === 0, 'Units: the hardware type list is hidden (POS only)');
  ok(await p.getByRole('tab', { name: 'Material' }).count() === 0, 'Material tab is removed (unified inside Units)');
  ok(/1 Open Lost Material/.test(await p.textContent('main')), 'Unified Units view surfaces 1 open lost material alert');
  await p.locator('[aria-label="Filter Stock Type or Material"]').selectOption('ALL'); await sleep(1500);
  ok((await p.locator('section[aria-label="Material totals"]').count()) === 0, 'Redundant material totals KPI cards are removed');
  ok(await p.locator('[aria-label="Select Material Category"]').isVisible(), 'Material Category filter is visible');
  ok((await p.locator('section[aria-label="Stock per location"]').count()) === 0, 'Stock per location matrix table is removed from POS');
  // (6 Nov 2026) one Lost Materials list per page, shown only when something was reported lost
  const lostPos = p.locator('section[aria-label="Lost Materials · POS Terminal"]');
  ok((await lostPos.count()) === 1 && /Lucky Mart/.test(await lostPos.textContent()) && !/015 778 9014/.test(await lostPos.textContent()),
    'POS Terminal material: Lost Materials list with the lost charging dock (no SIM in it)');
  await lostPos.getByRole('button', { name: 'Write off' }).first().click(); await sleep(400);
  await p.locator('[role=dialog] input').last().fill('merchant closed, not reachable');
  await p.locator('[role=dialog]').getByRole('button', { name: 'Write off' }).click(); await sleep(1200);
  const wo = last('admin_material_lost_action');
  ok(wo && wo.p.id === 1 && wo.p.action === 'WRITE_OFF' && /merchant closed/.test(wo.p.reason), 'Lost dock → Write off with reason ' + JSON.stringify(wo && wo.p));

  await p.getByRole('button', { name: 'Stock In', exact: true }).click(); await sleep(400);
  await p.locator('#si-code').selectOption('POS_ADAPTOR');
  await p.locator('[role=dialog] input[type=number]').fill('50');
  await p.getByRole('button', { name: 'Add to stock' }).click(); await sleep(1200);
  const si = last('admin_material_stock_in');
  ok(si && si.p.code === 'POS_ADAPTOR' && si.p.qty === 50 && si.p.branch_id === '100', 'Stock In → admin_material_stock_in ' + JSON.stringify(si && si.p));

  await g.getByRole('button', { name: /^Sound Box/ }).click(); await sleep(1200);
  const sbScope = p.locator('[aria-label="Filter Stock Type or Material"]');
  if (await sbScope.isVisible()) { await sbScope.selectOption('ALL'); await sleep(1200); }
  const sbt = await p.locator('[aria-label="Select Material Category"]').textContent();
  ok(/Sound Box AC Adaptor/.test(sbt) && !/Charging Dock/.test(sbt), 'Sound Box material: only the Sound Box adaptor');
  ok((await p.locator('section[aria-label="Stock per location"]').count()) === 0, 'Stock per location matrix table is removed from Sound Box');
  ok((await p.locator('section[aria-label^="Lost Materials · Sound Box"]').count()) === 0, 'Sound Box material: no Lost Materials list (nothing lost)');

  await g.getByRole('button', { name: /^SIM Card/ }).click(); await sleep(1500);
  ok(/096 555 0142/.test(await p.textContent('body')) && /Branch [rR]eserve\s*2/i.test((await p.locator('[aria-label="Status"]').textContent()).replace(/\s+/g, ' ')), 'SIM Card: register and status counts');
  const lostSim = p.locator('section[aria-label="Lost Materials · SIM Card"]');
  ok((await lostSim.count()) === 1 && /015 778 9014/.test(await lostSim.textContent()), 'SIM Card: Lost Materials list with the lost SIM');
  await lostSim.getByRole('button', { name: 'Blocked with carrier' }).click(); await sleep(1200);
  const bl = last('admin_material_lost_action');
  ok(bl && bl.p.id === 2 && bl.p.action === 'BLOCKED', 'Lost SIM → Blocked with carrier');
  // (6 Nov 2026) Manage SIM: a refusal from the database is shown in the panel, nothing is reported as saved
  const row34 = p.locator('tr', { hasText: '097 210 8834' }).first();
  await row34.getByRole('button', { name: 'Manage' }).click(); await sleep(700);
  await p.getByRole('button', { name: /Return to HQ Stock/ }).click(); await sleep(200);
  await p.getByRole('button', { name: /Review Impact/ }).click(); await sleep(400);
  await p.getByRole('button', { name: /Confirm & Synchronize All/ }).click(); await sleep(1200);
  const panelTxt = await p.textContent('body');
  ok(/is lost\. Recover it in Lost Materials first/.test(panelTxt) && !/STOCK:/.test(panelTxt) && !/097 210 8834 updated successfully/.test(panelTxt),
    'Manage SIM: the refusal is shown in plain words, no "updated successfully"');
  ok(directWrites.length === 0 && last('admin_sim_update').p.serial === '097 210 8834', 'Manage SIM: only the checked function was called (no direct table write)');
  await p.getByRole('button', { name: 'Close', exact: true }).first().click(); await sleep(500);

  // Merchant 360 → Kit → Record kit
  await p.locator('aside').first().getByText('Merchant Deployment', { exact: true }).click(); await sleep(1800);
  const search = p.locator('input[placeholder*="Search"]').first();
  await search.fill(merchantDev.mid); await sleep(900);
  await p.getByRole('button', { name: '360 View' }).first().click(); await sleep(1500);
  ok(/Kit held by the merchant/.test(await p.textContent('body')) && /No kit recorded/.test(await p.textContent('body')), 'Merchant 360: Kit card, no kit recorded yet');
  await p.getByRole('button', { name: /Record kit/ }).first().click(); await sleep(500);
  const dlg = p.locator('[role=dialog]').last();
  await dlg.getByLabel('SIM Card number').fill('0965550199');
  const bat = dlg.getByLabel('Battery number'); if (!(await bat.inputValue())) await bat.fill('BAT-T-1');
  await dlg.getByRole('button', { name: 'Save kit' }).click(); await sleep(1500);
  const ka = last('admin_kit_add');
  ok(ka && ka.p.from_stock === false && ka.p.connection === 'SIM' && ka.p.items.some((i) => i.code === 'SIM' && /0965550199/.test(i.serial)) && ka.p.items.some((i) => i.code === 'POS_ADAPTOR'),
    'Record kit → admin_kit_add (baseline, SIM + adaptor) ' + JSON.stringify(ka && ka.p.items.map((i) => i.code)));
  ok(/0965550199|096 555 0199/.test(await p.textContent('body')), 'Kit card shows the recorded SIM');
  await p.getByRole('button', { name: 'Close merchant profile' }).click(); await sleep(600);

  // Stock Requests: dispatch a materials-only request
  await p.locator('aside').first().getByText('Stock Requests', { exact: true }).click(); await sleep(1800);
  ok(/SIM Card ×1 · POS AC Adaptor ×2|POS AC Adaptor ×2/.test(await p.textContent('body')), 'Stock Requests: requested materials shown on the request');
  const row = p.locator('tr', { hasText: 'REQ-MAT-0001' });
  await row.getByRole('button', { name: 'Manage' }).click(); await sleep(400);
  await p.getByRole('button', { name: 'Dispatch', exact: true }).click(); await sleep(800);
  ok(/Materials requested/.test(await p.textContent('body')), 'dispatch window: materials section');
  await p.getByLabel('SIM Card numbers').fill('096 555 0177');
  await p.getByRole('button', { name: /Review Dispatch/ }).click(); await sleep(600);
  ok(/Materials to send:/.test(await p.textContent('body')), 'preview lists the materials to send');
  await p.getByRole('button', { name: /Confirm & Dispatch/ }).click(); await sleep(1500);
  const dr = last('admin_dispatch_request');
  ok(dr && dr.p.req_id === 'REQ-MAT-0001' && dr.p.serials.length === 0 && dr.p.materials.qty.POS_ADAPTOR === 2 && dr.p.materials.serials.SIM[0] === '096 555 0177',
    'dispatch → admin_dispatch_request ' + JSON.stringify(dr && dr.p.materials));
  ok(errs.length === 0, 'Admin: no page or console errors ' + errs.slice(0, 3).join(' | '));
  await p.context().close();

  // ===================== Branch staff 105 =====================
  const s2 = await signIn(b, '33105', 'Branch123');
  const q = s2.p; const g2 = stockGroup(q);
  await g2.getByRole('button', { name: /^POS Terminal/ }).click(); await sleep(1200);
  await q.locator('[aria-label="Filter Stock Type or Material"]').selectOption('ALL'); await sleep(1200);
  const t2 = await q.locator('section[aria-label="POS Materials Inventory Table"]').textContent();
  ok(!/Head Office/.test(t2) && /105/.test(t2), 'branch staff see only their own branch');
  ok((await q.locator('section[aria-label="Stock per location"]').count()) === 0, 'Stock per location matrix table is removed for branch');
  ok(await q.getByRole('button', { name: 'Stock In', exact: true }).count() === 0 && await q.getByRole('button', { name: 'Correct', exact: true }).count() === 0, 'branch staff: no Stock In / Correct');

  await g2.getByRole('button', { name: /^POS Terminal/ }).click(); await sleep(1000);
  await q.locator('[aria-label="Select Material Category"]').selectOption('HARDWARE'); await sleep(800);
  await q.getByRole('button', { name: /Request HQ Stock/ }).click(); await sleep(800);
  await q.getByLabel('SIM Card quantity').fill('5');
  await q.getByLabel('POS AC Adaptor quantity').fill('2');
  await q.locator('form button[type=submit]').last().click(); await sleep(600);
  ok(/Materials:/.test(await q.textContent('body')), 'request preview lists the materials');
  await q.getByRole('button', { name: /Confirm|Submit/ }).last().click(); await sleep(2500);
  const rp = reqPosts.slice(-1)[0];
  ok(rp && rp.materials && rp.materials.SIM === 5 && rp.materials.POS_ADAPTOR === 2 && rp.pos_qty === 0, 'branch request saved with materials ' + JSON.stringify(rp && rp.materials));
  ok(s2.errs.length === 0, 'Branch: no page or console errors ' + s2.errs.slice(0, 3).join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });



// Credit Card: "Well Received" / "Follow Up" (11 Nov 2026), against the stand-in Supabase API. Never touches live data.
// Admin: Well Received on a waiting entry -> cc_docs WELL_RECEIVED, the row shows "Waiting documents"; Follow Up -> cc_docs
// FOLLOW_UP, counted; the "Waiting documents" filter asks cc_list for WAITING_DOCS. A branch user has no buttons.
// Run against a built dist/ (VITE_SUPABASE_URL = the stand-in address) served on 127.0.0.1:8500 (node tests/e2e/serve-dist.cjs).
const S = require('./lib/standin.js');
const { chromium, B, sleep, USERS } = S;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const IGNORE = /WebSocket connection to .*realtime|Failed to load resource|ERR_TUNNEL|net::ERR/;
USERS['7777@staff.pos-sb-inventory.internal'] = { id: 'u-ad', pw: 'Admin123', profile: { user_id: 'u-ad', emp_id: '7777', name: 'ADMIN Test', role: 'ADMIN', branch_id: '100', position: null, active: true, must_change_password: false } };
USERS['33105@staff.pos-sb-inventory.internal'] = { id: 'u-b105', pw: 'Branch123', profile: { user_id: 'u-b105', emp_id: '33105', name: 'SOK Branch', role: 'BRANCH', branch_id: '105', position: null, active: true, must_change_password: false } };
const now = Date.now(), iso = (m) => new Date(now - m * 60000).toISOString();
const ccs = [{ id: 9500, record_id: 'CC-20261111-001', request_type: 'New Credit Card Request', card_status: 'Onboarded Successfully', full_name: 'CUSTOMER ONE', contact: '012345678',
  marital: 'Single', primary_acc: '000111222', mid_or_acc: '', limit_usd: 1000, repayment: 'Full Payment 100%', email: '', remarks: '', supplementary: [], photo_count: 1,
  staff_id: 'STF1', staff_name: 'Staff 1', branch_text: 'Toul Kork Branch', branch_id: '105', submitted_at: iso(7), review_status: 'PENDING', review_history: [], doc_status: null, doc_followups: 0 }];
const calls = [];
const json = (route, code, o) => route.fulfill({ status: code, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' }, body: JSON.stringify(o) });
async function api(route) {
  const req = route.request(), url = new URL(req.url()), path = url.pathname, body = req.postData() ? JSON.parse(req.postData()) : null;
  if (path === '/rest/v1/rpc/cc_list') { calls.push(['cc_list', body]); const rows = body && body.p_review === 'WAITING_DOCS' ? ccs.filter((c) => c.doc_status === 'WAITING') : ccs; return json(route, 200, { rows, total: rows.length, masked: false }); }
  if (path === '/rest/v1/rpc/cc_counts') return json(route, 200, { total: 1, pending: 1, waiting_docs: ccs.filter((c) => c.doc_status === 'WAITING').length, confirmed: 0, rejected: 0, no_review: 0, cards: 0, pending_all: 1 });
  if (path === '/rest/v1/rpc/cc_docs') {
    calls.push(['cc_docs', body]);
    const me = S.getMe(); if (!me || !['ADMIN', 'SUPER_ADMIN'].includes(me.profile.role)) return json(route, 403, { code: '42501', message: 'Only Admin HQ can mark credit card documents.' });
    const c = ccs[0]; c.doc_status = 'WAITING'; if (body.p_action === 'WELL_RECEIVED') c.doc_since = new Date().toISOString(); else { c.doc_followups++; c.doc_last_followup = new Date().toISOString(); }
    return json(route, 200, { ok: true, record_id: c.record_id, doc_status: c.doc_status, doc_since: c.doc_since, doc_followups: c.doc_followups, doc_last_followup: c.doc_last_followup || null, by: 'ADMIN Test (7777)', at: new Date().toISOString() });
  }
  return S.api(route);
}
async function signIn(b, emp, pw) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); await ctx.route(B + '/**', api);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errs.push(m.text()); });
  await p.goto('http://127.0.0.1:' + (process.env.DIST_PORT || '8500') + '/index.html');
  await p.waitForSelector('#empId', { state: 'visible' }); await p.fill('#empId', emp); await p.fill('#pw', pw); await p.click('button[type=submit]');
  await p.waitForFunction(() => /Dashboard/.test(document.body.innerText), null, { timeout: 30000 }); await sleep(1200);
  return { ctx, p, errs };
}
const side = (p) => p.locator('aside, nav');
const openPage = async (p, label) => {
  if (!(await side(p).getByText(label, { exact: true }).first().isVisible().catch(() => false))) { await side(p).getByText('Phone App Review', { exact: true }).first().click().catch(() => {}); await sleep(500); }
  await side(p).getByText(label, { exact: true }).first().click(); await sleep(1800);
};
(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  let { ctx, p, errs } = await signIn(b, '7777', 'Admin123');
  await openPage(p, 'Credit Card');
  await p.locator('main [role="button"][aria-expanded]').filter({ hasText: 'CUSTOMER ONE' }).first().click(); await sleep(800);
  const wr = p.locator('main button').filter({ hasText: /^Well Received$/ });
  ok(await wr.isVisible(), 'Admin: "Well Received" on a waiting entry');
  ok(!(await p.locator('main button').filter({ hasText: /^Follow Up/ }).isVisible().catch(() => false)), 'no "Follow Up" before Well Received');
  await wr.click(); await sleep(1200);
  const c1 = calls.filter((c) => c[0] === 'cc_docs');
  ok(c1.length === 1 && c1[0][1].p_action === 'WELL_RECEIVED' && c1[0][1].p_record_id === 'CC-20261111-001', 'Well Received -> cc_docs WELL_RECEIVED');
  ok(await p.locator('main').getByText('Waiting documents').first().isVisible(), 'the entry now shows "Waiting documents"');
  ok(await p.locator('main').getByText(/waiting for the documents at Head Office/).isVisible(), 'the open entry says it waits for the documents');
  const fu = p.locator('main button').filter({ hasText: /^Follow Up/ });
  ok(await fu.isVisible() && !(await wr.isVisible().catch(() => false)), '"Follow Up" replaces "Well Received"');
  await fu.click(); await sleep(1200);
  const c2 = calls.filter((c) => c[0] === 'cc_docs');
  ok(c2.length === 2 && c2[1][1].p_action === 'FOLLOW_UP', 'Follow Up -> cc_docs FOLLOW_UP');
  ok(await p.locator('main').getByText(/followed up 1×/).isVisible() && await fu.isDisabled(), 'counted (1×); the button rests for 10 minutes');
  ok(await p.locator('main button:has-text("Confirm")').first().isVisible(), 'Confirm is still offered');
  await p.locator('main [role="tab"]').filter({ hasText: 'Waiting documents' }).first().click(); await sleep(1500);
  ok(calls.some((c) => c[0] === 'cc_list' && c[1] && c[1].p_review === 'WAITING_DOCS'), 'the "Waiting documents" filter asks for WAITING_DOCS');
  ok(errs.length === 0, 'admin: no page errors ' + errs.slice(0, 3).join(' | '));
  await ctx.close();
  ({ ctx, p, errs } = await signIn(b, '33105', 'Branch123'));
  await openPage(p, 'Credit Card');
  await p.locator('main [role="button"][aria-expanded]').filter({ hasText: 'CUSTOMER ONE' }).first().click(); await sleep(800);
  ok(!(await p.locator('main button').filter({ hasText: /^(Well Received|Follow Up)/ }).count()), 'branch user: no Well Received / Follow Up');
  ok(errs.length === 0, 'branch: no page errors ' + errs.slice(0, 3).join(' | '));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('HARNESS ' + e.message); process.exit(1); });

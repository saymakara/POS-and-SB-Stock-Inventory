// (26 Nov 2026) Pages keep their rows when someone else changes data: going back shows them at once (no loading state)
// and the new rows are read quietly behind them. Checked on Merchant Visit (KHQR and Credit Card use the same rule).
// Run against a built dist/ (VITE_SUPABASE_URL = the stand-in address) served on 127.0.0.1:8500 (node tests/e2e/serve-dist.cjs).
// Never touches live data.
process.env.N_DEV = process.env.N_DEV || '300';
const S = require('./lib/standin.js');
const { chromium, B, state, sleep } = S;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const IGNORE = /WebSocket connection to .*realtime|Failed to load resource|ERR_TUNNEL|net::ERR/;

// ---- data: 120 visits this month, and three POS maintenance / return records waiting for review
const ACTS = ['KHQR Issue', 'Account Opening', 'QR Merchant Onboarding', 'ABA Mobile Support'];
const now = Date.now();
const visits = Array.from({ length: 120 }, (_, i) => ({
  id: 5000 + i, record_id: 'REG-20261104-' + String(i + 1).padStart(4, '0'), activity: ACTS[i % 4], merchant_name: 'Shop ' + i + (i === 7 ? ' Lucky Mart' : ''),
  mid: String(200000000010000 + i), location: 'Phnom Penh', khan: 'Toul Kork', latitude: i % 5 ? 11.55 + i / 10000 : null, longitude: i % 5 ? 104.92 : null,
  remarks: i === 0 ? 'QR sticker faded, replaced' : '', answers: { 'Activity Type': ACTS[i % 4], 'Merchant Name': 'Shop ' + i, 'Phone Number': '0123' + String(i).padStart(5, '0'), 'Business Type': 'Mart' },
  photo_link: i === 0 ? 'https://t.me/c/123/45' : null, staff_id: 'STF' + (i % 9), staff_name: 'Staff ' + (i % 9), branch_text: i % 10 === 0 ? 'Special Shift' : 'Toul Kork Branch',
  branch_id: i % 10 === 0 ? null : '105', submitted_at: new Date(now - i * 600000).toISOString(), edited_at: i === 3 ? new Date(now).toISOString() : null,
}));
const calls = [];
function visitsRoute(route, req, url) {
  calls.push(url.search);
  let rows = visits.slice();
  const sp = url.searchParams;
  const act = sp.get('activity'); if (act && act.startsWith('eq.')) rows = rows.filter((v) => v.activity === decodeURIComponent(act.slice(3)));
  const br = sp.get('branch_id'); if (br === 'is.null') rows = rows.filter((v) => !v.branch_id); else if (br && br.startsWith('eq.')) rows = rows.filter((v) => v.branch_id === br.slice(3));
  sp.getAll('submitted_at').forEach((f) => { const t = Date.parse(f.slice(4)); if (f.startsWith('gte.')) rows = rows.filter((v) => Date.parse(v.submitted_at) >= t); if (f.startsWith('lt.')) rows = rows.filter((v) => Date.parse(v.submitted_at) < t); });
  const orq = sp.get('or'); if (orq) { const m = /merchant_name\.ilike\.%([^%]+)%/.exec(orq); if (m) rows = rows.filter((v) => v.merchant_name.toLowerCase().includes(m[1].toLowerCase())); }
  const mid = sp.get('mid'); if (mid && mid.startsWith('like.')) rows = rows.filter((v) => v.mid.includes(mid.slice(5).replace(/%/g, '')));
  const off = Number(sp.get('offset') || 0), lim = Number(sp.get('limit') || 50), part = rows.slice(off, off + lim);
  return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range',
    'content-range': (part.length ? off + '-' + (off + part.length - 1) : '*') + '/' + rows.length }, body: JSON.stringify(part) });
}

const net = { delay: 0 };
async function api(route) {
  const url = new URL(route.request().url());
  if (url.pathname === '/rest/v1/mv_visits') { if (net.delay) await sleep(net.delay); return visitsRoute(route, route.request(), url); }
  if (url.pathname === '/rest/v1/rpc/mv_visit_summary') {
    if (net.delay) await sleep(net.delay);
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ total: visits.length, staff: 9, branches: 1, no_branch: 0, with_gps: 0, by_activity: ACTS.map((a) => ({ activity: a, n: visits.filter((v) => v.activity === a).length })) }) }).catch(() => {});
  }
  return S.api(route);
}
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(B + '/**', api);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errs.push(m.text()); });
  await p.goto('http://127.0.0.1:8500/index.html');
  await p.waitForSelector('#empId', { state: 'visible' });
  await p.fill('#empId', '8986'); await p.fill('#pw', 'Secret123'); await p.click('button[type=submit]');
  await p.waitForFunction(() => /Dashboard/.test(document.body.innerText), null, { timeout: 30000 }); await sleep(1500);
  const side = p.locator('aside, nav');
  await side.getByText('Merchant App Review', { exact: true }).first().click().catch(() => {}); await sleep(600);
  await side.getByText('Merchant Visit', { exact: true }).first().click(); await sleep(2000);
  const rows = () => p.locator('[aria-label="Merchant visits"] [role="button"][aria-expanded]').count();
  ok(await rows() === 50, 'Merchant Visit opens with its rows');
  await side.getByText('Dashboard', { exact: true }).first().click(); await sleep(800);
  // someone else records a visit (a live change from another browser)
  await p.evaluate(() => { const bc = new BroadcastChannel('pos_portal_live_sync_v1'); bc.postMessage({ sender: 'someone-else', domains: ['mv'] }); bc.close(); });
  await sleep(500);
  net.delay = 2500; const c0 = calls.length;
  await side.getByText('Merchant Visit', { exact: true }).first().click(); await sleep(350);
  const shown = await rows();
  const loadingTxt = /Loading/i.test(await p.textContent('main'));
  ok(shown === 50 && !loadingTxt, 'going back after the change: the rows are shown at once, no loading state (' + shown + ' rows)');
  await sleep(3200);
  ok(calls.length - c0 >= 1, 'and the new rows are read quietly behind them (' + (calls.length - c0) + ' read)');
  ok(errs.length === 0, 'no page errors ' + errs.join(' | ').slice(0, 300));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

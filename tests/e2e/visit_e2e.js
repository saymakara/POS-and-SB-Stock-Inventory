// Merchant Visit page + POS maintenance / return in Phone App Review (4 Nov 2026), against the stand-in Supabase API.
// Run against a built dist/ (VITE_SUPABASE_URL = the stand-in address) served on 127.0.0.1:8500 (node serve_test.cjs).
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
const posDev = state.devices.find((d) => d.type === 'POS Terminal' && d.stage === 'COMPLETE');
const ev = (id, kind, details, remarks) => ({ id, source_record_id: kind.slice(0, 3) + '-20261104-000' + (id - 8999), unit_no: 1, revision: 1, kind, device_type: 'POS Terminal',
  serial: posDev.serial, old_serial: null, mid: posDev.mid, tid: posDev.tid, terminal_name: 'Till 1', outlet_name: null, branch_text: 'Toul Kork Branch', branch_id: '105',
  staff_id: 'STF001', staff_name: 'Sok Dara', recorded_at: new Date(now - 3600000).toISOString(), latitude: 11.55, longitude: 104.92, remarks,
  payload: { entry: { summary: details.map((d) => d.v).join(' · '), details }, unit: { serial_input: 'SCAN' } }, issues: [], status: 'PENDING', received_at: new Date(now - 3500000).toISOString() });
state.events.unshift(
  ev(9001, 'POS_RETURN', [{ k: 'Product Name', v: 'Q2PRO' }, { k: 'Charging Dock', v: 'Lost' }, { k: 'POS Stand Holder', v: 'N/a' }], 'Merchant lost the charging dock'),
  ev(9002, 'POS_MAINT', [{ k: 'Request Type', v: 'Request Paper Roll' }], 'Delivered 5 rolls'),
  ev(9003, 'POS_INACTIVE', [{ k: 'Maintenance', v: '2nd Maintenance' }, { k: 'Maintenance Type', v: 'Remote' }], ''));

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
async function api(route) {
  const req = route.request(), url = new URL(req.url());
  if (url.pathname === '/rest/v1/mv_visits') return visitsRoute(route, req, url);
  if (url.pathname === '/rest/v1/rpc/mv_visit_summary') {
    const by = ACTS.map((a) => ({ activity: a, n: visits.filter((v) => v.activity === a).length }));
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ total: visits.length, staff: 9, branches: 1, no_branch: visits.filter((v) => !v.branch_id).length, with_gps: visits.filter((v) => v.latitude).length, by_activity: by }) });
  }
  return S.api(route);
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(B + '/**', api);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errs.push(m.text()); });
  await p.goto('http://127.0.0.1:' + (process.env.DIST_PORT || '8500') + '/index.html');
  await p.waitForSelector('#empId', { state: 'visible' });
  await p.fill('#empId', '8986'); await p.fill('#pw', 'Secret123'); await p.click('button[type=submit]');
  await p.waitForFunction(() => /Dashboard/.test(document.body.innerText), null, { timeout: 30000 }); await sleep(1500);
  const side = p.locator('aside, nav');
  await side.getByText('Phone App Review', { exact: true }).first().click().catch(() => {}); await sleep(600);
  ok(await side.getByText('Merchant Visit', { exact: true }).count() > 0, 'sidebar: "Merchant Visit" under Phone App Review');
  await side.getByText('Merchant Visit', { exact: true }).first().click(); await sleep(2000);
  const main = async () => p.textContent('main');
  let t = await main();
  ok(/Merchant Visit/.test(t) && /Visits/.test(t) && /120/.test(t), 'page opens with the totals (120 visits)');
  ok(/KHQR Issue 30/.test(t) && /12 visit\(s\) without a matched branch/.test(t) && /80% of visits/.test(t), 'activities, unmatched branches and GPS share shown');
  const rowsN = await p.locator('[aria-label="Merchant visits"] [role="button"][aria-expanded]').count();
  ok(rowsN === 50 && /Showing 1–50 of 120/.test(t), '50 visits per page, server total 120 (' + rowsN + ')');
  ok(calls.some((c) => /submitted_at=gte\./.test(c)), 'This month: the list is read from the 1st of the month');
  await p.getByRole('button', { name: /next/i }).first().click().catch(() => {}); await sleep(1200);
  ok(/Showing 51–100 of 120/.test(await main()) && calls.some((c) => /offset=50/.test(c)), 'next page read from the server (offset 50)');
  await p.getByRole('button', { name: /previous|prev/i }).first().click().catch(() => {}); await sleep(1000);
  // details of the first visit
  await p.locator('[aria-label="Merchant visits"] [role="button"][aria-expanded]').first().click(); await sleep(700);
  t = await main();
  ok(/Phone Number/.test(t) && /012300000/.test(t) && /Business Type/.test(t) && /QR sticker faded, replaced/.test(t), 'details show every answer of the visit and the remark');
  ok(await p.locator('a[href="https://t.me/c/123/45"]').count() === 1 && await p.locator('a[href^="https://www.google.com/maps"]').count() === 0, 'photo link to Telegram; no map link when there is no GPS');
  // filters
  await p.selectOption('select[aria-label="Activity"]', 'Account Opening'); await sleep(1200);
  ok(calls.some((c) => /activity=eq\.Account(%20|\+| )Opening/.test(c)) && /Showing 1–30 of 30/.test(await main()), 'activity filter (30 Account Opening)');
  await p.selectOption('select[aria-label="Activity"]', ''); await p.selectOption('select[aria-label="Branch"]', 'NONE'); await sleep(1200);
  ok(calls.some((c) => /branch_id=is\.null/.test(c)) && /Showing 1–12 of 12/.test(await main()), '"No matched branch" filter (12)');
  await p.selectOption('select[aria-label="Branch"]', ''); await p.fill('input[aria-label="Search"]', 'lucky'); await sleep(1500);
  ok(/Showing 1–1 of 1/.test(await main()) && /Lucky Mart/.test(await main()), 'search by merchant name');
  await p.fill('input[aria-label="Search"]', ''); await sleep(800);
  await p.screenshot({ path: process.env.SHOT || '/tmp/visit_page.png' });
  // ---- POS maintenance / return in Phone App Review > POS Terminal
  await side.getByText('POS Terminal', { exact: true }).first().click(); await sleep(2200);
  t = await main();
  ok(/POS returned & terminated/.test(t) && /POS active maintenance/.test(t) && /POS in-active maintenance/.test(t), 'POS review lists the three new kinds with their names');
  const row = p.locator('span[title="POS returned & terminated"]').first().locator('xpath=ancestor::div[.//button[@aria-expanded]][1]');
  await row.locator('button[aria-expanded]').first().click(); await sleep(900);
  t = await main();
  ok(/Details/.test(t) && /Product Name: Q2PRO · Charging Dock: Lost · POS Stand Holder: N\/a/.test(t) && /Merchant lost the charging dock/.test(t), 'details: product, returned items and remark');
  ok(/The returned POS terminal goes to/.test(t), 'admin chooses where the returned terminal goes');
  await p.screenshot({ path: process.env.SHOT2 || '/tmp/pos_return_review.png' });
  ok(errs.length === 0, 'no page or console errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ').slice(0, 300) : ''));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

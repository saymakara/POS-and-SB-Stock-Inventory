// (20 Nov 2026) Dialogs, toasts and banners must sit on the SCREEN, not inside the page. An ancestor with layout / paint
// containment, a transform, filter or perspective becomes the "screen" for position:fixed elements - on 19 Nov
// "#root { contain: layout }" put the Staff Directory Delete User dialog 1,300 px below the view (it seemed to do nothing).
// Opens the main pages and checks every fixed element's ancestors; then opens Delete User and checks the dialog is in view.
const S = require('./lib/standin.js');
const { chromium, sleep, B } = S;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const TRAP = () => {
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    if (getComputedStyle(el).position !== 'fixed') continue;
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a);
      const why = [s.transform !== 'none' && 'transform', s.filter !== 'none' && 'filter', s.backdropFilter && s.backdropFilter !== 'none' && 'backdrop-filter',
        s.perspective !== 'none' && 'perspective', /transform|filter|perspective/.test(s.willChange) && 'will-change', /layout|paint|strict|content/.test(s.contain) && 'contain:' + s.contain].filter(Boolean);
      if (why.length) { out.push((el.id || el.className.toString().slice(0, 50)) + ' ← ' + (a.id ? '#' + a.id : a.tagName + '.' + a.className.toString().slice(0, 40)) + ' [' + why.join(',') + ']'); break; }
    }
  }
  return out;
};
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(B + '/**', S.api);
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:' + (process.env.DIST_PORT || '8500') + '/index.html'); await p.waitForSelector('#empId');
  await p.fill('#empId', '8986'); await p.fill('#pw', 'Secret123'); await p.click('button[type=submit]');
  await p.waitForFunction(() => /Dashboard/.test(document.body.innerText), null, { timeout: 30000 }); await sleep(1200);
  const pages = ['Dashboard', 'Staff Directory', 'Branch Codes', 'Audit Trail', 'Settings', 'Merchant Deployment', 'Stock Requests'];
  for (const name of pages) {
    const btn = p.locator('aside').first().getByRole('button', { name: new RegExp('^' + name) }).first();
    if (!(await btn.count())) { console.log('skip ' + name); continue; }
    await btn.click(); await sleep(1200);
    const trapped = await p.evaluate(TRAP);
    ok(trapped.length === 0, name + ': every fixed element sits on the screen' + (trapped.length ? ' - trapped: ' + trapped.join(' | ') : ''));
  }
  // Delete User dialog in view on a long page
  await p.locator('aside').first().getByRole('button', { name: /Staff Directory/ }).first().click(); await sleep(1200);
  await p.getByPlaceholder(/search/i).first().fill('20010'); await sleep(600);
  await p.locator('main').locator('div, tr, li').filter({ hasText: '20010' }).filter({ has: p.getByRole('button', { name: 'Edit', exact: true }) }).last().getByRole('button', { name: 'Edit', exact: true }).click(); await sleep(500);
  await p.getByPlaceholder(/search/i).first().fill(''); await sleep(800);              // the full list (131) again: a long page
  await p.getByRole('button', { name: /Delete User/ }).first().click(); await sleep(600);
  const r = await p.evaluate(() => { const d = document.querySelector('[aria-labelledby="delete-staff-title"]'); if (!d) return null; const c = d.firstElementChild.getBoundingClientRect(); return { top: Math.round(c.top), bottom: Math.round(c.bottom), h: innerHeight, page: document.documentElement.scrollHeight }; });
  ok(r && r.top >= 0 && r.bottom <= r.h, 'Delete User dialog is in view (' + JSON.stringify(r) + ')');
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

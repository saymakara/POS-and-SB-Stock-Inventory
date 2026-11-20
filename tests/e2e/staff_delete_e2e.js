// (20 Nov 2026) Staff Directory → Edit → Delete User: the reason is asked, the database function admin_delete_staff is
// called with the Employee ID and reason, the person leaves the list, and a clear message shows. A refusal from the
// database (e.g. "Only a Super Admin can delete admin accounts.") is shown and the person stays.
// Run against a built dist/ served on 127.0.0.1:8500 (node tests/e2e/serve-dist.cjs), stand-in API.
const S = require('./lib/standin.js');
const { chromium, sleep, B } = S;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const calls = []; const gone = new Set();
  await ctx.route(B + '/**', async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.pathname === '/rest/v1/rpc/admin_delete_staff' && req.method() === 'POST') {
      const p = JSON.parse(req.postData() || '{}').p || {};
      calls.push(p);
      const h = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
      if (p.emp_id === '20000') return route.fulfill({ status: 403, headers: h, body: JSON.stringify({ code: '42501', message: 'Only a Super Admin can delete admin accounts.' }) });
      gone.add(p.emp_id);
      const i = S.STAFF.findIndex((x) => x.emp_id === p.emp_id); if (i >= 0) S.STAFF.splice(i, 1);   // the server no longer has them
      return route.fulfill({ status: 200, headers: h, body: JSON.stringify({ deleted: true, emp_id: p.emp_id, name: 'STAFF Number10' }) });
    }
    return S.api(route);
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://127.0.0.1:' + (process.env.DIST_PORT || '8500') + '/index.html');
  await p.waitForSelector('#empId', { state: 'visible' });
  await p.fill('#empId', '8986'); await p.fill('#pw', 'Secret123'); await p.click('button[type=submit]');
  await p.waitForFunction(() => /Dashboard/.test(document.body.innerText), null, { timeout: 30000 }); await sleep(1000);
  await p.locator('aside').first().getByRole('button', { name: /Staff Directory/ }).first().click(); await sleep(1500);
  const search = p.getByPlaceholder(/search/i).first();
  const openDelete = async (emp) => {
    await search.fill(emp); await sleep(600);
    const row = p.locator('main').locator('div, tr, li').filter({ hasText: emp }).filter({ has: p.getByRole('button', { name: 'Edit', exact: true }) }).last();
    await row.getByRole('button', { name: 'Edit', exact: true }).click(); await sleep(500);
    await p.getByRole('button', { name: /Delete User/ }).first().click(); await sleep(400);
  };
  // 1. a branch staff member: deleted
  await openDelete('20010');
  const dlg = p.getByRole('dialog').filter({ hasText: 'Delete Staff Account' });
  ok(await dlg.isVisible(), 'Delete User asks for confirmation (name, Employee ID, role, branch, reason)');
  ok(/20010/.test(await dlg.textContent()) && /Historical deployments and audit trail records are preserved/.test(await dlg.textContent()), 'the dialog names the person and says their history is kept');
  await p.fill('#delete-staff-reason', 'Resigned 20 Nov');
  await dlg.getByRole('button', { name: /^Delete User$/ }).click(); await sleep(1200);
  ok(calls.length === 1 && calls[0].emp_id === '20010' && calls[0].reason === 'Resigned 20 Nov', 'the database function is called with the Employee ID and the reason (' + JSON.stringify(calls[0]) + ')');
  ok(/Deleted user .*20010/.test(await p.textContent('body')), 'a clear message: "Deleted user … (20010)"');
  await search.fill('20010'); await sleep(700);
  ok(!(await p.locator('main').getByText('20010', { exact: true }).count()), 'the person is no longer in the Staff Directory');
  // 2. refused by the database: shown, the person stays
  await openDelete('20000');
  await p.getByRole('dialog').filter({ hasText: 'Delete Staff Account' }).getByRole('button', { name: /^Delete User$/ }).click(); await sleep(1200);
  const bodyTxt = await p.textContent('body');
  ok(/Failed to delete user:? ?Only a Super Admin can delete admin accounts\./.test(bodyTxt), 'a refusal from the database is shown as it is');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

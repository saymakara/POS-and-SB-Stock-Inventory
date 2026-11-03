const { chromium } = require('playwright');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => {
  if (!c) {
    console.error('FAIL: ' + m);
    process.exit(1);
  }
  console.log('PASS ' + m);
};

const B = process.env.SUPABASE_URL || 'https://mrrzfmtaqjdwhwznznie.supabase.co';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub) => b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, aud: 'authenticated' }) + '.sig';
const USERS = {
  '8986@staff.pos-sb-inventory.internal': {
    id: 'u-sa',
    pw: 'Secret123',
    profile: { user_id: 'u-sa', emp_id: '8986', name: 'SAY Chanmakara', role: 'SUPER_ADMIN', branch_id: '100', position: null, active: true, must_change_password: false }
  }
};

let me = null;
async function api(route) {
  const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
  const body = req.postData() ? (() => { try { return JSON.parse(req.postData()); } catch (e) { return req.postData(); } })() : null;
  const json = (code, o) => route.fulfill({ status: code, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });

  if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });

  if (path === '/auth/v1/token') {
    const u = USERS[body.email];
    if (!u || u.pw !== body.password) return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials' });
    me = u;
    const user = { id: u.id, email: body.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} };
    return json(200, { access_token: jwt(u.id), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user });
  }

  if (path === '/auth/v1/user') {
    return json(200, { id: me.id, email: Object.keys(USERS).find(k => USERS[k] === me), aud: 'authenticated', role: 'authenticated' });
  }

  if (path === '/auth/v1/logout') return route.fulfill({ status: 204 });

  if (path === '/rest/v1/staff_profiles') {
    return json(200, me ? [me.profile] : []);
  }

  if (path === '/rest/v1/branches') {
    return json(200, [{ id: '100', code: '100', name: 'Head Office', region: 'Phnom Penh' }]);
  }

  if (path === '/rest/v1/devices') {
    return json(200, []);
  }

  if (path === '/rest/v1/field_events') {
    if (method === 'HEAD') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0' } });
    return json(200, []);
  }

  if (path === '/rest/v1/rpc/cc_counts') {
    return json(200, []);
  }

  if (path === '/rest/v1/rpc/cc_list') {
    return json(200, []);
  }

  if (path === '/rest/v1/audit_logs') {
    return json(201, []);
  }

  return json(200, []);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.route(B + '/**', api);

  // Tab 1: Sign in as Super Admin
  const tab1 = await context.newPage();
  await tab1.goto('http://127.0.0.1:8500/index.html');
  await sleep(1500);

  await tab1.fill('#empId', '8986');
  await tab1.fill('#pw', 'Secret123');
  await tab1.click('button[type=submit]');
  await sleep(3000);

  ok(!(await tab1.isVisible('#empId')), 'Tab 1: Signed in successfully as Super Admin');

  // Lock the session in Tab 1
  await tab1.click('button[title="Lock Operator Session"]');
  await sleep(1000);

  ok(await tab1.isVisible('text=Operator Session Locked'), 'Tab 1: Session is now locked');

  // Now open Tab 2 (simulating user opening another tab in browser while Tab 1 is locked)
  const tab2 = await context.newPage();
  await tab2.goto('http://127.0.0.1:8500/index.html');
  await sleep(2000);

  // Tab 2 MUST be locked and require password - CANNOT bypass!
  const isLockedInTab2 = await tab2.isVisible('text=Operator Session Locked');
  ok(isLockedInTab2, 'SECURITY VERIFIED: Tab 2 is immediately locked and DOES NOT bypass password!');

  // Refresh Tab 2 - verify refresh does NOT bypass password
  await tab2.reload();
  await sleep(2000);
  ok(await tab2.isVisible('text=Operator Session Locked'), 'SECURITY VERIFIED: Refreshing Tab 2 keeps session locked!');

  // Refresh Tab 1 - verify refresh does NOT bypass password
  await tab1.reload();
  await sleep(2000);
  ok(await tab1.isVisible('text=Operator Session Locked'), 'SECURITY VERIFIED: Refreshing Tab 1 keeps session locked!');

  // Now unlock in Tab 2 using correct password
  await tab2.fill('input[type="password"]', 'Secret123');
  await tab2.click('button:has-text("Unlock Workstation")');
  await sleep(2000);

  ok(!(await tab2.isVisible('text=Operator Session Locked')), 'Tab 2 unlocked with valid password');
  ok(!(await tab1.isVisible('text=Operator Session Locked')), 'CROSS-TAB SYNC: Tab 1 was unlocked automatically!');

  // Clean sign-out test
  await tab1.click('button[title="Sign Out to Login Page"]');
  await sleep(2500);

  ok(await tab1.isVisible('#empId'), 'Tab 1 signed out');
  await tab2.reload();
  await sleep(2000);
  ok(await tab2.isVisible('#empId'), 'Tab 2 is also signed out on reload');

  await browser.close();
  console.log('ALL SESSION LOCK SECURITY TESTS PASSED!');
})().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});

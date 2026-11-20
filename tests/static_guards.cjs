// Static guards (07 Nov 2026): rules from real incidents, checked on every build. Usage: node tests/static_guards.cjs
//  1. Tables that only checked database functions may change are never written directly from the portal
//     (Manage SIM once wrote material_serials directly and showed "saved" when nothing was saved).
//  2. Direct table writes live only in the service layer (src/services/supabaseService.ts) and the audit logger.
//  3. A database write or function call is never fired without reading its error (`await supabase.from(...).update(...)`
//     or `await supabase.rpc(...)` as a bare statement).
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'src');
const RPC_ONLY = ['phone_record_edits', 'material_types', 'material_serials', 'material_qty', 'material_movements', 'device_kits', 'material_lost', 'material_counts',
  'cc_entries', 'qr_installations', 'qr_attempts', 'field_events', 'mv_visits', 'staff_profiles'];
const WRITE_OK_FILES = ['services/supabaseService.ts', 'utils/errorLogger.ts'];
const files = []; (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(f)) files.push(p); } })(ROOT);
const problems = [];
for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const m = line.match(/\.from\(\s*['"]([a-z_]+)['"]\s*\)/);
    if (m) {
      const near = lines.slice(i, i + 4).join(' ');
      const writes = /\.(insert|update|upsert|delete)\(/.test(near);
      if (writes && RPC_ONLY.includes(m[1])) problems.push(rel + ':' + (i + 1) + ' writes "' + m[1] + '" directly (use its checked database function)');
      else if (writes && !WRITE_OK_FILES.includes(rel)) problems.push(rel + ':' + (i + 1) + ' writes "' + m[1] + '" outside the service layer');
    }
    if (/^\s*await\s+supabase\s*\.\s*(rpc\(|from\()/.test(line) && !/=\s*await/.test(line)) problems.push(rel + ':' + (i + 1) + ' database call whose error is never read');
  });
}
// (20 Nov 2026, security review) a database function runs for EVERYONE (PUBLIC, which includes "anon" = not signed in)
// unless it is revoked by hand - three functions were left open that way. From 20261120 on, every migration that creates a
// SECURITY DEFINER function must also revoke it from public in the same file.
const MIG = path.join(__dirname, '..', 'supabase', 'migrations');
if (fs.existsSync(MIG)) {
  for (const f of fs.readdirSync(MIG).filter((x) => /^\d{8}.*\.sql$/.test(x) && x.slice(0, 8) >= '20261120').sort()) {
    const sql = fs.readFileSync(path.join(MIG, f), 'utf8').replace(/--[^\n]*/g, '');
    const re = /create\s+(?:or\s+replace\s+)?function\s+([\w."]+)\s*\(/gi, starts = [];
    let m; while ((m = re.exec(sql))) starts.push({ name: m[1].replace(/"/g, ''), at: m.index });
    starts.forEach((s, k) => {
      const body = sql.slice(s.at, k + 1 < starts.length ? starts[k + 1].at : sql.length);
      const asAt = body.search(/\bas\s+\$/i), head = asAt > 0 ? body.slice(0, asAt) : body;   // SECURITY DEFINER is written before "as $..$"
      if (!/security\s+definer/i.test(head)) return;
      const esc = s.name.replace(/[.]/g, '\\.');
      if (!new RegExp('revoke[^;]*on\\s+function\\s+' + esc + '\\s*\\([^;]*from[^;]*\\bpublic\\b', 'i').test(sql))
        problems.push('supabase/migrations/' + f + ': SECURITY DEFINER function ' + s.name + ' is not revoked from public (anyone could call it without signing in)');
    });
  }
}
// (20 Nov 2026) layout / paint containment (or a transform / filter) on the page's root makes it the "screen" for every
// fixed element inside: on 19 Nov "#root { contain: layout style }" put dialogs and toasts 1,300 px below the view
// (Staff Directory Delete User seemed to do nothing). html, body, #root and main may only use style containment.
{
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /(^|[}\s,])(html|body|#root|main)\s*(?:,[^{]*)?\{([^}]*)\}/g; let m;
  while ((m = re.exec(css))) {
    const body = m[3];
    if (/contain\s*:\s*[^;]*(layout|paint|strict|content)/i.test(body) || /(^|;)\s*(transform|filter|perspective)\s*:\s*(?!none)/i.test(body) || /will-change\s*:[^;]*(transform|filter)/i.test(body))
      problems.push('src/index.css: "' + m[2] + '" must not use layout/paint containment, transform, filter or perspective (dialogs and toasts would leave the screen)');
  }
}
problems.forEach((p) => console.log('FAIL ' + p));
console.log(problems.length ? problems.length + ' FAILED' : 'PASS static guards (' + files.length + ' files)\nALL PASSED');
process.exit(problems.length ? 1 : 0);

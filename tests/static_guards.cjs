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
problems.forEach((p) => console.log('FAIL ' + p));
console.log(problems.length ? problems.length + ' FAILED' : 'PASS static guards (' + files.length + ' files)\nALL PASSED');
process.exit(problems.length ? 1 : 0);

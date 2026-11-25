// (25 Nov 2026) The compact KPI summary turns back into exactly the rows of the full one.
// The fixture is a real answer of the database (app.kpi_pack, 25 Nov 2026) with names replaced by placeholders, plus two
// edge rows: a staff name that is null and a row with keys missing. Run: npx tsx tests/unit/kpi_pack.test.ts
import { unpackKpiLists } from '../../src/utils/kpiPack';

const full = {
  staff: [],
  targets: { id: 1, staff_daily_target: 25, work_days_in_month: 22 },
  daily_staff: [
    { day: '2026-11-25', cc_tasks: 0, mv_tasks: 0, sb_tasks: 1, staff_id: '23929', branch_id: '601', pos_tasks: 5, khqr_tasks: 1, staff_name: 'Staff A', branch_name: 'Branch P', total_tasks: 7 },
    { day: '2026-11-25', cc_tasks: 0, mv_tasks: 0, sb_tasks: 0, staff_id: '8986', branch_id: '100', pos_tasks: 0, khqr_tasks: 1, staff_name: 'Staff D', branch_name: 'Head Office', total_tasks: 1 },
    { day: '2026-11-24', cc_tasks: 0, mv_tasks: 1, sb_tasks: 0, staff_id: '20287', branch_id: '901', pos_tasks: 0, khqr_tasks: 0, staff_name: 'Staff C', branch_name: 'Special Shift', total_tasks: 1 },
    { day: '2026-11-24', cc_tasks: 0, mv_tasks: 0, sb_tasks: 0, staff_id: '23929', branch_id: '601', pos_tasks: 6, khqr_tasks: 0, staff_name: 'Staff A', branch_name: 'Branch P', total_tasks: 6 },
  ],
  monthly_staff: [
    { extra: { MV_QR_REFRESHMENT: 1 }, month: '2026-11', adj_pts: 0, cc_supp: 0, sb_maint: 1, staff_id: '10230', branch_id: '433', sb_return: 0, cc_primary: 0, sb_install: 0, sb_replace: 0, staff_name: 'Staff S', branch_name: 'Branch B1', pos_battery: 0, pos_install: 0, pos_replace: 0, khqr_install: 0, khqr_replace: 1, khqr_materials: 3 },
    { extra: { MV_QR_REFRESHMENT: 6, MV_PAYSOUND_ALERT_TELEGRAM: 1 }, month: '2026-11', adj_pts: 0, cc_supp: 0, sb_maint: 0, staff_id: '10386', branch_id: '423', sb_return: 0, cc_primary: 0, sb_install: 12, sb_replace: 0, staff_name: 'Staff K', branch_name: 'Branch B2', pos_battery: 0, pos_install: 0, pos_replace: 0, khqr_install: 31, khqr_replace: 29, khqr_materials: 150 },
    { extra: { MV_ABA_QR_IN_GOOD_CONDITION: 148 }, month: '2026-11', adj_pts: 0, cc_supp: 0, sb_maint: 0, staff_id: '10435', branch_id: '632', sb_return: 0, cc_primary: 0, sb_install: 9, sb_replace: 0, staff_name: 'Staff V', branch_name: 'Branch K', pos_battery: 0, pos_install: 0, pos_replace: 1, khqr_install: 25, khqr_replace: 114, khqr_materials: 445 },
    { month: '2026-11', staff_id: 'X1', branch_id: '601', staff_name: null, pos_install: 2 },
    { month: '2026-11', staff_id: 'X2', branch_id: '601', branch_name: 'Toul Kork' },
  ],
};
// the database's packed answer for the same rows (names in the same positions as the real answer)
const packed = {
  staff: { k: [], n: [], r: [] },
  packed: ['daily_staff', 'monthly_staff', 'staff'],
  targets: full.targets,
  daily_staff: {
    k: ['branch_id', 'branch_name', 'cc_tasks', 'day', 'khqr_tasks', 'mv_tasks', 'pos_tasks', 'sb_tasks', 'staff_id', 'staff_name', 'total_tasks'],
    n: ['Staff A', 'Head Office', 'Staff C', 'Staff D', 'Branch P', 'Special Shift'],
    r: [['601', 4, 0, '2026-11-25', 1, 0, 5, 1, '23929', 0, 7], ['100', 1, 0, '2026-11-25', 1, 0, 0, 0, '8986', 3, 1], ['901', 5, 0, '2026-11-24', 0, 1, 0, 0, '20287', 2, 1], ['601', 4, 0, '2026-11-24', 0, 0, 6, 0, '23929', 0, 6]],
  },
  monthly_staff: {
    k: ['adj_pts', 'branch_id', 'branch_name', 'cc_primary', 'cc_supp', 'extra', 'khqr_install', 'khqr_materials', 'khqr_replace', 'month', 'pos_battery', 'pos_install', 'pos_replace', 'sb_install', 'sb_maint', 'sb_replace', 'sb_return', 'staff_id', 'staff_name'],
    n: ['Branch B1', 'Branch B2', 'Staff K', 'Branch K', 'Staff S', 'Toul Kork', 'Staff V'],
    r: [
      [0, '433', 0, 0, 0, { MV_QR_REFRESHMENT: 1 }, 0, 3, 1, '2026-11', 0, 0, 0, 0, 1, 0, 0, '10230', 4],
      [0, '423', 1, 0, 0, { MV_QR_REFRESHMENT: 6, MV_PAYSOUND_ALERT_TELEGRAM: 1 }, 31, 150, 29, '2026-11', 0, 0, 0, 12, 0, 0, 0, '10386', 2],
      [0, '632', 3, 0, 0, { MV_ABA_QR_IN_GOOD_CONDITION: 148 }, 25, 445, 114, '2026-11', 0, 0, 1, 9, 0, 0, 0, '10435', 6],
      [null, '601', null, null, null, null, null, null, null, '2026-11', null, 2, null, null, null, null, null, 'X1', null],
      [null, '601', 5, null, null, null, null, null, null, '2026-11', null, null, null, null, null, null, null, 'X2', null],
    ],
  },
};

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
// a key with null is the same as no key for every reader of these rows (they all use `value || default`)
const strip = (v: unknown): unknown => Array.isArray(v) ? v.map(strip) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== null).map(([k, x]): [string, unknown] => [k, strip(x)]).sort((p, q) => (p[0] < q[0] ? -1 : 1)))
  : v;
const same = (a: unknown, b: unknown) => JSON.stringify(strip(a)) === JSON.stringify(strip(b));

const out = unpackKpiLists(packed);
ok(same(out.daily_staff, full.daily_staff), 'daily_staff rows come back exactly (values, names, order)');
ok(same(out.monthly_staff, full.monthly_staff), 'monthly_staff rows come back exactly (incl. the extra counts object)');
ok(Array.isArray(out.staff) && out.staff.length === 0, 'an empty list stays empty');
ok(!('packed' in out), 'the packing marker is removed');
ok(out.targets === full.targets, 'parts that are not packed are passed through as they are');
ok(!('staff_name' in out.monthly_staff[3]) && out.monthly_staff[3].staff_id === 'X1', 'a null staff name is left out (readers fall back to the staff ID, as before)');
const plain = { staff: [{ staff_id: '1' }] };
ok(unpackKpiLists(plain) === plain, 'an answer of the full (old) function is used as it is');
ok(unpackKpiLists(null) === null, 'no answer stays no answer');
console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);

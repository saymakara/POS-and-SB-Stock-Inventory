// (27 Nov 2026) KPI Performance shows Booth Event as its own category; the Dashboard keeps it inside Merchant Visit.
// The total is the same either way. Run: npx tsx tests/unit/kpi_booth.test.ts
import { computeKpiPoints, isBoothEventCode } from '../../src/utils/kpiPoints';
import type { KpiPointRule, KpiRawCounts } from '../../src/services/kpiService';
let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const rule = (code: string, category: KpiPointRule['category'], points: number): KpiPointRule => ({
  code, category, subCategory: code, description: '', points, unit: 'per task', active: true, isSystem: false, sortOrder: 1, updatedBy: null, updatedAt: null,
});
const rules = new Map<string, KpiPointRule>([
  ['KHQR_INSTALL', rule('KHQR_INSTALL', 'KHQR', 1)],
  ['KHQR_REPLACE', rule('KHQR_REPLACE', 'KHQR', 1)],
  ['KHQR_PRINT_LAMINATE', rule('KHQR_PRINT_LAMINATE', 'KHQR', 0.2)],
  ['MV_BOOTH_EVENT_FULL_DAY', rule('MV_BOOTH_EVENT_FULL_DAY', 'Merchant Visit', 30)],
  ['MV_BOOTH_EVENT_HALF_DAY', rule('MV_BOOTH_EVENT_HALF_DAY', 'Merchant Visit', 15)],
  ['MV_STANDBY_VIP_HALF_DAY', rule('MV_STANDBY_VIP_HALF_DAY', 'Merchant Visit', 15)],
  ['MV_VISIT', rule('MV_VISIT', 'Merchant Visit', 1)],
]);
const base = (): KpiRawCounts => ({
  posInstall: 0, posReplace: 0, posBattery: 0, sbInstall: 0, sbReplace: 0, sbMaint: 0, sbReturn: 0,
  khqrInstall: 0, khqrReplace: 0, khqrMaterials: 0, ccPrimary: 0, ccSupp: 0,
});

ok(isBoothEventCode('MV_BOOTH_EVENT_FULL_DAY') && isBoothEventCode('MV_BOOTH_EVENT_HALF_DAY'), 'booth codes recognised');
ok(!isBoothEventCode('MV_STANDBY_VIP_HALF_DAY') && !isBoothEventCode('MV_VISIT'), 'standby / visits are not booth');

// MOK ChanvouchEng, 27 Nov: 14 new + 27 replaced KHQR (49.2 pts), one full booth day, equal share 30 -> adjustment -49.2
const mok: KpiRawCounts = { ...base(), khqrInstall: 14, khqrReplace: 27, extra: { MV_BOOTH_EVENT_FULL_DAY: 1 }, adjPts: -49.2, adjBooth: -49.2 };
const split = computeKpiPoints(mok, rules, { splitBooth: true });
const dash = computeKpiPoints(mok, rules);
ok(split.khqrPoints === 49.2, `KHQR column 49.2 (got ${split.khqrPoints})`);
ok(split.boothTasks === 1 && split.boothPoints === -19.2, `Booth Event: 1 day, 30 - 49.2 = -19.2 (got ${split.boothTasks}, ${split.boothPoints})`);
ok(split.mvTasks === 0 && split.mvPoints === 0, `Merchant Visit no longer holds the booth (got ${split.mvTasks}, ${split.mvPoints})`);
ok(split.totalPoints === 30, `KPI Performance total 30 (got ${split.totalPoints})`);
ok(dash.totalPoints === 30 && dash.mvTasks === 1 && dash.mvPoints === -19.2, `Dashboard unchanged: booth inside Merchant Visit, total 30 (got ${dash.mvTasks}, ${dash.mvPoints}, ${dash.totalPoints})`);
ok(split.totalTasks === dash.totalTasks, 'same task total on both pages');

// a booth day and a standby day in the same month: the standby part stays in Merchant Visit
const mix: KpiRawCounts = { ...base(), extra: { MV_BOOTH_EVENT_FULL_DAY: 1, MV_STANDBY_VIP_HALF_DAY: 1, MV_VISIT: 3 }, adjPts: 5, adjBooth: 8 };
const m = computeKpiPoints(mix, rules, { splitBooth: true });
ok(m.boothTasks === 1 && m.boothPoints === 38, `booth 30 + 8 = 38 (got ${m.boothPoints})`);
ok(m.mvTasks === 4 && m.mvPoints === 15, `MV: standby 15 + 3 visits - 3 standby adjustment = 15 (got ${m.mvTasks}, ${m.mvPoints})`);
ok(m.totalPoints === computeKpiPoints(mix, rules).totalPoints, 'same point total on both pages');

// older copies without adjBooth: everything stays in Merchant Visit's adjustment, total unchanged
const old: KpiRawCounts = { ...base(), extra: { MV_BOOTH_EVENT_FULL_DAY: 1 }, adjPts: -10 };
ok(computeKpiPoints(old, rules, { splitBooth: true }).totalPoints === 20, 'no adjBooth: total still 20');

if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log('all passed');

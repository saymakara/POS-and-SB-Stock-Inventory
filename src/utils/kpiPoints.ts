/** (27 Nov 2026) KPI points from raw counts and the point rules (moved from services/kpiService, which re-exports it). */
import type { KpiPointRule, KpiRawCounts } from '../services/kpiService';

export interface ComputedPoints {
  posTasks: number;
  posPoints: number;
  sbTasks: number;
  sbPoints: number;
  khqrTasks: number;
  khqrMaterials: number;
  khqrPoints: number;
  ccTasks: number;
  ccPoints: number;
  mvTasks: number;
  mvPoints: number;
  /** (27 Nov 2026) Booth Event days and points. Part of mvTasks / mvPoints unless computed with { splitBooth: true }. */
  boothTasks: number;
  boothPoints: number;
  totalTasks: number;
  totalPoints: number;
}

/** (27 Nov 2026) the KPI tasks of a Booth Event day (Full Day / Half Day) */
export const isBoothEventCode = (code: string): boolean => /^MV_BOOTH_EVENT_/.test(code);

export function rulePts(map: Map<string, KpiPointRule>, code: string): number {
  const r = map.get(code);
  return r && r.active ? r.points : 0;
}

/** `splitBooth`: Booth Event is its own category (KPI Performance) instead of a part of Merchant Visit (Dashboard). */
export function computeKpiPoints(c: KpiRawCounts, ruleMap: Map<string, KpiPointRule>, opts?: { splitBooth?: boolean }): ComputedPoints {
  const posTasks = c.posInstall + c.posReplace + c.posBattery;
  const posPoints =
    c.posInstall * rulePts(ruleMap, 'POS_INSTALL') +
    c.posReplace * rulePts(ruleMap, 'POS_REPLACE') +
    c.posBattery * rulePts(ruleMap, 'POS_BATTERY');

  const sbTasks = c.sbInstall + c.sbReplace + c.sbMaint + c.sbReturn;
  const sbPoints =
    c.sbInstall * rulePts(ruleMap, 'SB_INSTALL') +
    c.sbReplace * rulePts(ruleMap, 'SB_REPLACE') +
    c.sbMaint * rulePts(ruleMap, 'SB_MAINT') +
    c.sbReturn * rulePts(ruleMap, 'SB_RETURN');

  const khqrTasks = c.khqrInstall + c.khqrReplace;
  const khqrPoints =
    c.khqrInstall * rulePts(ruleMap, 'KHQR_INSTALL') +
    c.khqrReplace * rulePts(ruleMap, 'KHQR_REPLACE') +
    c.khqrMaterials * rulePts(ruleMap, 'KHQR_MATERIAL') +
    // (19 Nov 2026) KHQR Print & Laminate: per submission (New Installation or QR Replacement), the installer - points only
    (c.khqrInstall + c.khqrReplace) * rulePts(ruleMap, 'KHQR_PRINT_LAMINATE');

  const ccTasks = c.ccPrimary + c.ccSupp;
  const ccPoints =
    c.ccPrimary * rulePts(ruleMap, 'CC_PRIMARY') +
    c.ccSupp * rulePts(ruleMap, 'CC_SUPP');

  // (4 Nov 2026) the rules added for the Merchant Visit app & new tasks: counted per rule code, points from Settings
  let xPosTasks = 0, xPosPoints = 0, xSbTasks = 0, xSbPoints = 0, xCcTasks = 0, xCcPoints = 0, xKhqrTasks = 0, xKhqrPoints = 0, mvTasks = 0, mvPoints = 0, xOtherTasks = 0, xOtherPoints = 0;
  
  // Count direct task properties if provided and not already in c.extra
  if (c.posMaint && !c.extra?.['POS_MAINT']) {
    xPosTasks += c.posMaint;
    xPosPoints += c.posMaint * rulePts(ruleMap, 'POS_MAINT');
  }
  if (c.posInactive && !c.extra?.['POS_INACTIVE']) {
    xPosTasks += c.posInactive;
    xPosPoints += c.posInactive * rulePts(ruleMap, 'POS_INACTIVE');
  }
  if (c.posReturn && !c.extra?.['POS_RETURN']) {
    xPosTasks += c.posReturn;
    xPosPoints += c.posReturn * rulePts(ruleMap, 'POS_RETURN');
  }
  if (c.posAdaptor && !c.extra?.['POS_ADAPTOR']) {
    xPosTasks += c.posAdaptor;
    xPosPoints += c.posAdaptor * rulePts(ruleMap, 'POS_ADAPTOR');
  }
  if (c.posStand && !c.extra?.['POS_STAND']) {
    xPosTasks += c.posStand;
    xPosPoints += c.posStand * rulePts(ruleMap, 'POS_STAND');
  }
  if (c.posDock && !c.extra?.['POS_DOCK']) {
    xPosTasks += c.posDock;
    xPosPoints += c.posDock * rulePts(ruleMap, 'POS_DOCK');
  }
  if (c.sbAdaptor && !c.extra?.['SB_ADAPTOR']) {
    xSbTasks += c.sbAdaptor;
    xSbPoints += c.sbAdaptor * rulePts(ruleMap, 'SB_ADAPTOR');
  }

  let boothTasks = 0, boothPoints = 0;
  for (const [code, raw] of Object.entries(c.extra || {})) {
    const n = Number(raw) || 0, rule = ruleMap.get(code);
    if (!n) continue;
    if (isBoothEventCode(code)) {
      boothTasks += n;
      if (rule && (rule.active || rule.points > 0)) boothPoints += n * rule.points;
      if (!opts?.splitBooth) {
        mvTasks += n;
        if (rule && (rule.active || rule.points > 0)) mvPoints += n * rule.points;
      }
      continue;
    }
    if (rule && rule.active) {
      const pts = n * rule.points;
      if (rule.category === 'POS Terminal') { xPosTasks += n; xPosPoints += pts; }
      else if (rule.category === 'Sound Box') { xSbTasks += n; xSbPoints += pts; }
      else if (rule.category === 'Credit Card') { xCcTasks += n; xCcPoints += pts; }
      else if (rule.category === 'KHQR') { xKhqrTasks += n; xKhqrPoints += pts; }
      else if (rule.category === 'Merchant Visit') { mvTasks += n; mvPoints += pts; }
      else { xOtherTasks += n; xOtherPoints += pts; }
    } else if (code.startsWith('MV_')) {
      mvTasks += n;
      if (rule && rule.points > 0) mvPoints += n * rule.points;
    } else if (code.startsWith('POS_')) {
      xPosTasks += n;
      if (rule && rule.points > 0) xPosPoints += n * rule.points;
    } else if (code.startsWith('SB_')) {
      xSbTasks += n;
      if (rule && rule.points > 0) xSbPoints += n * rule.points;
    } else if (code.startsWith('CC_')) {
      xCcTasks += n;
      if (rule && rule.points > 0) xCcPoints += n * rule.points;
    } else if (code.startsWith('KHQR_')) {
      xKhqrTasks += n;
      if (rule && rule.points > 0) xKhqrPoints += n * rule.points;
    }
  }

  // (22 Nov 2026) Booth Event / Standby VIP adjustment (points only, counted with Merchant Visit);
  // (27 Nov 2026) with splitBooth, the Booth Event part goes to Booth Event
  const adjBooth = Number(c.adjBooth) || 0;
  boothPoints += adjBooth;
  if (opts?.splitBooth) mvPoints += (Number(c.adjPts) || 0) - adjBooth;
  else mvPoints += Number(c.adjPts) || 0;
  const splitT = opts?.splitBooth ? boothTasks : 0, splitP = opts?.splitBooth ? boothPoints : 0;

  const totalTasks = posTasks + xPosTasks + sbTasks + xSbTasks + khqrTasks + xKhqrTasks + ccTasks + xCcTasks + mvTasks + xOtherTasks + splitT;
  const totalPoints = Math.round((posPoints + xPosPoints + sbPoints + xSbPoints + khqrPoints + xKhqrPoints + ccPoints + xCcPoints + mvPoints + xOtherPoints + splitP) * 100) / 100;

  return {
    posTasks: posTasks + xPosTasks,
    posPoints: Math.round((posPoints + xPosPoints) * 100) / 100,
    sbTasks: sbTasks + xSbTasks,
    sbPoints: Math.round((sbPoints + xSbPoints) * 100) / 100,
    khqrTasks: khqrTasks + xKhqrTasks,
    khqrMaterials: c.khqrMaterials,
    khqrPoints: Math.round((khqrPoints + xKhqrPoints) * 100) / 100,
    ccTasks: ccTasks + xCcTasks,
    ccPoints: Math.round((ccPoints + xCcPoints) * 100) / 100,
    mvTasks,
    mvPoints: Math.round(mvPoints * 100) / 100,
    boothTasks,
    boothPoints: Math.round(boothPoints * 100) / 100,
    totalTasks,
    totalPoints,
  };
}

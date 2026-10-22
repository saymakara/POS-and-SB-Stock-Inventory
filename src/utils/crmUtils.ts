import { stampSecPP, clockPP } from './time';
import { Device } from '../types';

/** A merchant ID is exactly 15 digits (22 Oct 2026: the old MID-880… pattern never matched real MIDs). */
export const MID_REGEX = /^\d{15}$/;
export const TID_REGEX = /^(?:TID|KHQR)-(\d{3})(\d{2,5})$/;

/** Phnom Penh time (not the computer's own time zone). */
export function formatNowTimestamp(includeDate = true): string {
  return includeDate ? stampSecPP() : clockPP();
}

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let str = String(value).replace(/\r?\n|\r/g, ' ').trim();
  // Neutralize spreadsheet formula injection
  if (/^[=+\-@]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

export interface MidTidQuickCheck {
  midValid: boolean;
  tidValid: boolean;
  tidDuplicateDevice?: Device;
  midBranchMismatch: boolean;
  tidBranchMismatch: boolean;
  suggestedMid: string;
  suggestedTid: string;
}

export function validateMidTidPair(
  mid: string,
  tid: string,
  branchId: string,
  allDevices: Device[],
  excludeSerial?: string
): MidTidQuickCheck {
  const cleanMid = mid.trim().toUpperCase();
  const cleanTid = tid.trim().toUpperCase();

  const midMatch = cleanMid.match(MID_REGEX);
  const tidMatch = cleanTid.match(TID_REGEX);

  const midValid = Boolean(midMatch);
  const tidValid = Boolean(tidMatch);

  const midBranchMismatch = false;                                   // a 15-digit MID does not carry the branch
  const tidBranchMismatch = Boolean(tidMatch && branchId !== '100' && tidMatch[1] !== branchId);

  let tidDuplicateDevice: Device | undefined;
  if (cleanTid) {
    for (let i = 0; i < allDevices.length; i++) {
      const d = allDevices[i];
      if (d.serial !== excludeSerial && d.tid && d.tid.trim().toUpperCase() === cleanTid) {
        tidDuplicateDevice = d;
        break;
      }
    }
  }

  // (22 Oct 2026) no suggested MIDs or TIDs: they come from the acquiring record, never from this app
  const suggestedMid = '';
  const suggestedTid = '';

  return {
    midValid,
    tidValid,
    tidDuplicateDevice,
    midBranchMismatch,
    tidBranchMismatch,
    suggestedMid,
    suggestedTid,
  };
}

export interface MidConflictGroup {
  mid: string;
  serials: string[];
  devices: Device[];
  merchantName?: string;
}

/**
 * Finds any other devices currently holding the specified MID.
 * Enforces "One MID one Serial": Stops early on match limit.
 */
export function findMidDuplicateDevices(
  mid: string,
  allDevices: Device[],
  excludeSerial?: string,
  limit = 10
): Device[] {
  const clean = mid.trim().toUpperCase();
  if (!clean) return [];
  const matches: Device[] = [];
  const len = allDevices.length;
  for (let i = 0; i < len; i++) {
    const d = allDevices[i];
    if (d.serial === excludeSerial) continue;
    if (d.stage === 'FAULTY' || d.stage === 'LOST') continue;
    if (d.mid && d.mid.trim().toUpperCase() === clean) {
      matches.push(d);
      if (matches.length >= limit) break;
    }
  }
  return matches;
}

/**
 * High-Throughput MID Conflict Detector.
 * Only allocates collision objects when a true duplicate is discovered.
 */
export function detectDuplicateMids(devices: Device[]): Map<string, MidConflictGroup> {
  const duplicateMap = new Map<string, MidConflictGroup>();
  const firstSeen = new Map<string, Device>();
  const len = devices.length;

  for (let i = 0; i < len; i++) {
    const d = devices[i];
    if (d.stage === 'FAULTY' || d.stage === 'LOST') continue;
    const rawMid = d.mid;
    if (!rawMid) continue;
    const cleanMid = rawMid.trim().toUpperCase();
    if (!cleanMid) continue;

    const existingGroup = duplicateMap.get(cleanMid);
    if (existingGroup) {
      if (!existingGroup.serials.includes(d.serial)) {
        existingGroup.serials.push(d.serial);
        existingGroup.devices.push(d);
      }
      if (!existingGroup.merchantName && d.merchantName) {
        existingGroup.merchantName = d.merchantName;
      }
    } else {
      const first = firstSeen.get(cleanMid);
      if (first) {
        if (first.serial !== d.serial) {
          duplicateMap.set(cleanMid, {
            mid: cleanMid,
            serials: [first.serial, d.serial],
            devices: [first, d],
            merchantName: first.merchantName || d.merchantName,
          });
        }
      } else {
        firstSeen.set(cleanMid, d);
      }
    }
  }

  return duplicateMap;
}


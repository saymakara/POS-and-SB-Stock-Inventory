import { Device } from '../types';

export const MID_REGEX = /^MID-880(\d{3})-(\d{2,4})$/;
export const TID_REGEX = /^(?:TID|KHQR)-(\d{3})(\d{2,5})$/;

export function formatNowTimestamp(includeDate = true): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const MM = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return includeDate ? `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
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
  const branchCode = branchId && branchId !== '100' ? branchId : '105';

  const midMatch = cleanMid.match(MID_REGEX);
  const tidMatch = cleanTid.match(TID_REGEX);

  const midValid = Boolean(midMatch);
  const tidValid = Boolean(tidMatch);

  const midBranchMismatch = Boolean(midMatch && branchId !== '100' && midMatch[1] !== branchId);
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

  // Build deterministic clean suggestions if needed (scan up to 200 devices)
  const usedTidNums = new Set<number>();
  const scanLimit = Math.min(allDevices.length, 500);
  for (let i = 0; i < scanLimit; i++) {
    const d = allDevices[i];
    const m = (d.tid || '').trim().toUpperCase().match(TID_REGEX);
    if (m && m[1] === branchCode) {
      usedTidNums.add(parseInt(m[2], 10));
    }
  }
  let nextSeq = 1;
  while (usedTidNums.has(nextSeq)) nextSeq++;

  const seqDigits = cleanMid.replace(/\D/g, '').slice(-2) || String(nextSeq).padStart(2, '0');
  const suggestedMid = `MID-880${branchCode}-${seqDigits.padStart(2, '0')}`;
  const suggestedTid = `TID-${branchCode}${String(nextSeq).padStart(2, '0')}`;

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


import { Device } from '../types';

/** A merchant ID is exactly 15 digits (22 Oct 2026: the old MID-880… pattern never matched real MIDs). */
export const MID_REGEX = /^\d{15}$/;
export const TID_REGEX = /^(?:TID|KHQR)-(\d{3})(\d{2,5})$/;

export interface MidTidQuickCheck {
  midValid: boolean;
  tidValid: boolean;
  tidDuplicateDevice?: Device;
  midBranchMismatch: boolean;
  tidBranchMismatch: boolean;
  suggestedMid: string;
  suggestedTid: string;
}

export interface MidConflictGroup {
  mid: string;
  serials: string[];
  devices: Device[];
  merchantName?: string;
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


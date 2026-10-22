import React, { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { Device, UserRole } from '../types';
import { todayPP } from '../utils/time';

/**
 * Units a branch has handled but not finished (22 Oct 2026): installed without merchant information (name, MID or TID),
 * or left in Configuring for several days. The branch sees its own units; HQ sees every branch.
 */
const CONFIG_DAYS = 3;

const dayNumber = (s?: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null;
};

interface Item { device: Device; reason: string; days: number | null }

export const SetupAlert: React.FC<{ devices: Device[]; role: UserRole; onOpen: (serial: string) => void }> = ({ devices, role, onOpen }) => {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const items = useMemo<Item[]>(() => {
    const today = dayNumber(todayPP()) as number;
    const out: Item[] = [];
    devices.forEach((d) => {
      if (d.archived || d.branchId === '100') return;
      if (d.stage === 'COMPLETE') {
        const missing = [!d.merchantName?.trim() && 'merchant name', !d.mid?.trim() && 'MID', !d.tid?.trim() && 'TID'].filter(Boolean) as string[];
        if (missing.length) {
          const since = dayNumber(d.deployedDate) ?? dayNumber(d.updatedAt);
          out.push({ device: d, reason: `Installed without ${missing.join(', ')}`, days: since == null ? null : today - since });
        }
      } else if (d.stage === 'CONFIGURING') {
        const since = dayNumber(d.updatedAt) ?? dayNumber(d.deployedDate);
        const days = since == null ? null : today - since;
        if (days != null && days >= CONFIG_DAYS) out.push({ device: d, reason: `Configuring not finished for ${days} days`, days });
      }
    });
    return out.sort((a, b) => (b.days ?? 0) - (a.days ?? 0));
  }, [devices]);

  const byBranch = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    items.forEach(({ device: d }) => { const x = m.get(d.branchId) || { name: d.branchName, n: 0 }; x.n += 1; m.set(d.branchId, x); });
    return Array.from(m.entries()).sort((a, b) => b[1].n - a[1].n);
  }, [items]);

  if (!items.length) return null;
  const isHq = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const rows = all ? items : items.slice(0, 8);

  return (
    <div role="alert" className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 text-amber-950 shadow-xs">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="w-full text-left px-4 py-3 flex items-start gap-3 cursor-pointer">
        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">
            {items.length} unit{items.length === 1 ? '' : 's'} {isHq ? 'at branches ' : ''}still need merchant information or configuring
          </div>
          <div className="text-xs text-amber-900/80 mt-0.5">
            {isHq
              ? `Branches to follow up: ${byBranch.slice(0, 5).map(([id, x]) => `${id} · ${x.name.replace(' Branch', '')} (${x.n})`).join(', ')}${byBranch.length > 5 ? '…' : ''}`
              : 'Please add the merchant name, MID and TID, or finish configuring, for the units below.'}
          </div>
        </div>
        {open ? <ChevronUp className="w-4 h-4 mt-1" aria-hidden /> : <ChevronDown className="w-4 h-4 mt-1" aria-hidden />}
      </button>
      {open && (
        <div className="px-4 pb-3 border-t border-amber-200">
          <ul className="divide-y divide-amber-200/70">
            {rows.map(({ device: d, reason }) => (
              <li key={d.serial} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <button type="button" onClick={() => onOpen(d.serial)} className="font-mono font-semibold underline-offset-2 hover:underline cursor-pointer">{d.serial}</button>
                <span>{d.type}</span>
                <span className="text-amber-900/80">{reason}</span>
                <span className="ml-auto text-amber-900/80">{d.branchId} · {d.branchName.replace(' Branch', '')} · {d.installedByStaff || d.staff || 'staff not recorded'}</span>
              </li>
            ))}
          </ul>
          {items.length > 8 && (
            <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 text-xs font-semibold underline cursor-pointer">
              {all ? 'Show fewer' : `Show all ${items.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

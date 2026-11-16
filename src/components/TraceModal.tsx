import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'motion/react';
import { X, Search, Cpu, History, ClipboardList, Smartphone, ShieldCheck } from 'lucide-react';
import { Device, HistoricalMerchantRecord, Requisition } from '../types';
import { STAGE_META } from '../data/initialData';
import { traceOnServer, FieldEvent, ServerAuditEntry } from '../services/supabaseService';
import { CopyableRecordId } from './CopyableRecordId';
import {
  RightDrawerFrame,
  SIM_HEADER_CLS,
  SIM_ICON_BOX_CLS,
  SIM_CLOSE_BTN_CLS,
  SIM_BODY_CLS,
} from './RightDrawerShell';

interface Props {
  query: string;
  devices: Device[];
  history: HistoricalMerchantRecord[];
  requisitions: Requisition[];
  isAdmin: boolean;
  onOpenDevice: (serial: string) => void;
  onClose: () => void;
}

/** Search by serial, MID, TID or battery serial: shows everything known about it, in one place. */
export const TraceModal: React.FC<Props> = ({ query, devices, history, requisitions, isAdmin, onOpenDevice, onClose }) => {
  const q = query.trim().toLowerCase();
  const [server, setServer] = useState<{ events: FieldEvent[]; audit: ServerAuditEntry[]; ok: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    setServer(null);
    traceOnServer(query).then((r) => { if (live) setServer(r); }).catch(() => { if (live) setServer({ events: [], audit: [], ok: false }); });
    return () => { live = false; };
  }, [query]);

  const units = useMemo(() => devices.filter((d) =>
    d.serial.toLowerCase().includes(q) || (d.mid || '').toLowerCase().includes(q) || (d.tid || '').toLowerCase().includes(q) ||
    (d.batterySerial || '').toLowerCase().includes(q)).slice(0, 20), [devices, q]);
  const past = useMemo(() => history.filter((h) =>
    h.serial.toLowerCase().includes(q) || (h.mid || '').toLowerCase().includes(q) || (h.tid || '').toLowerCase().includes(q) ||
    (h.batterySerial || '').toLowerCase().includes(q)).slice(0, 40), [history, q]);
  const reqs = useMemo(() => {
    const serials = new Set(units.map((u) => u.serial.toLowerCase()));
    return requisitions.filter((r) =>
      (r.arrangedDevices || []).some((a) => a.serial.toLowerCase().includes(q) || serials.has(a.serial.toLowerCase())) ||
      (r.returnSerials || []).some((s) => s.toLowerCase().includes(q) || serials.has(s.toLowerCase())) ||
      r.reqId.toLowerCase().includes(q)).slice(0, 40);
  }, [requisitions, units, q]);

  const Section: React.FC<{ icon: React.ReactNode; title: string; count: number; children: React.ReactNode }> = ({ icon, title, count, children }) => (
    <section className="rounded-xl border border-slate-200 bg-white">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 text-xs text-slate-700">
        {icon}<span className="font-semibold">{title}</span><span className="ml-auto text-slate-500 tabular-nums">{count}</span>
      </header>
      <div className="p-3 text-xs text-slate-700 space-y-2">{count === 0 ? <span className="text-slate-400">Nothing found.</span> : children}</div>
    </section>
  );

  return createPortal(
    <AnimatePresence>
      <RightDrawerFrame onClose={onClose} zClass="z-[90]" ariaLabel="Search results">
        <div className={SIM_HEADER_CLS}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className={SIM_ICON_BOX_CLS}>
                <Search className="w-4 h-4 text-[#0284c7] dark:text-[#5cc8ff]" />
              </div>
              <div className="min-w-0">
                <div className="text-base font-bold text-slate-900 dark:text-white truncate">Everything about &ldquo;{query.trim()}&rdquo;</div>
                <div className="text-[11.5px] text-slate-500 dark:text-slate-400 truncate mt-0.5">Stock Inventory, Merchant History, Stock Requests, Merchant App &amp; Audit</div>
              </div>
            </div>
            <button type="button" onClick={onClose} className={SIM_CLOSE_BTN_CLS} aria-label="Close"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className={SIM_BODY_CLS}>
          <Section icon={<Cpu className="w-3.5 h-3.5 text-[#0284c7]" />} title="Stock Inventory (current status)" count={units.length}>
            {units.map((u) => (
              <div key={u.serial} className="rounded-lg border border-slate-100 p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="font-mono text-[#0284c7] hover:underline cursor-pointer" onClick={() => { onClose(); onOpenDevice(u.serial); }}>{u.serial}</button>
                  <span className="px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-[10px]">{STAGE_META[u.stage]?.short || u.stage}</span>
                  <span className="text-slate-500">{u.type} · {u.model}</span>
                </div>
                <div className="mt-1 text-slate-600">Branch {u.branchId}{u.merchantName ? ` · ${u.merchantName}` : ' · no merchant'}{u.mid ? ` · MID ${u.mid}` : ''}{u.tid ? ` · TID ${u.tid}` : ''}</div>
                <div className="text-slate-500">Installer {u.installedByStaff || u.staff || '-'}{u.batterySerial ? ` · Battery ${u.batterySerial}` : ''}</div>
                {(u.history || []).length > 0 && (
                  <details className="mt-1"><summary className="cursor-pointer text-slate-500">Unit history ({u.history.length})</summary>
                    <ul className="mt-1 space-y-0.5 text-slate-600">{u.history.slice(0, 40).map((h, i) => <li key={i} className="khmer">{h}</li>)}</ul>
                  </details>
                )}
              </div>
            ))}
          </Section>
          <Section icon={<History className="w-3.5 h-3.5 text-slate-600" />} title="Merchant History (past merchants)" count={past.length}>
            {past.map((h) => (
              <div key={h.recordId} className="rounded-lg border border-slate-100 p-2.5 khmer">
                <div className="flex items-center justify-between gap-2"><div className="min-w-0 truncate">{h.merchantName} · <span className="font-mono">{h.serial}</span> · {h.status}</div><CopyableRecordId id={h.recordId} /></div>
                <div className="text-slate-500">MID {h.mid || '-'} · TID {h.tid || '-'} · Branch {h.branchId} · {h.installedDate} → {h.returnedDate}</div>
                <div className="text-slate-500">{h.returnReason}{h.returnedByStaff ? ` · by ${h.returnedByStaff}` : ''}</div>
              </div>
            ))}
          </Section>
          <Section icon={<ClipboardList className="w-3.5 h-3.5 text-slate-600" />} title="Stock Requests and Returns" count={reqs.length}>
            {reqs.map((r) => (
              <div key={r.reqId} className="rounded-lg border border-slate-100 p-2.5">
                <div className="flex items-center justify-between gap-2"><div>{r.type === 'STOCK_RETURN' ? 'Return' : 'Request'} · {r.status.replace('_', ' ')}</div><CopyableRecordId id={r.reqId} /></div>
                <div className="text-slate-500">{r.date} · Branch {r.branchId} · {r.staff}</div>
              </div>
            ))}
          </Section>
          <Section icon={<Smartphone className="w-3.5 h-3.5 text-slate-600" />} title="Merchant App Review records" count={server?.events.length ?? 0}>
            {server === null ? <span className="text-slate-400">Loading…</span> : server.events.map((e) => (
              <div key={e.id} className="rounded-lg border border-slate-100 p-2.5 khmer">
                <div className="flex items-center justify-between gap-2"><div>{e.kind} · <span className="font-mono">{e.serial}</span> · {e.status}</div>{e.sourceRecordId && <CopyableRecordId id={e.sourceRecordId} />}</div>
                <div className="text-slate-500">{e.recordedAt} · MID {e.mid || '-'} · TID {e.tid || '-'} · {e.outletName || '-'} · {e.staffName || '-'}</div>
                {e.reviewNote && <div className="text-slate-500">Note: {e.reviewNote}</div>}
              </div>
            ))}
          </Section>
          {isAdmin && (
            <Section icon={<ShieldCheck className="w-3.5 h-3.5 text-slate-600" />} title="Audit trail" count={server?.audit.length ?? 0}>
              {server === null ? <span className="text-slate-400">Loading…</span> : server.audit.map((a) => (
                <div key={a.id} className="rounded-lg border border-slate-100 p-2.5 khmer">
                  <div>{a.title}</div><div className="text-slate-500">{a.detail}</div>
                  <div className="text-slate-400">{a.createdAt} · {a.actorName || 'System'}</div>
                </div>
              ))}
            </Section>
          )}
          {server && !server.ok && <p className="text-[11px] text-amber-700">The server could not be reached for Merchant App records and the audit trail. The rest is shown from this screen.</p>}
        </div>
      </RightDrawerFrame>
    </AnimatePresence>,
    document.body,
  );
};

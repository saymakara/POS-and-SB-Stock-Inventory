import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import type { SerialStatus } from '../services/materialsService';
import { SERIAL_STATUS_LABEL } from '../services/materialsService';

/** (5 Nov 2026) Shared pieces of the material pages, in the portal's own style. */

export const btnPrimary = 'inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-[#003857] hover:bg-[#002a42] text-white shadow-2xs cursor-pointer active:scale-[0.98] transition disabled:opacity-50 disabled:cursor-default';
export const btnLight = 'inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold border bg-white hover:bg-slate-50 text-slate-700 border-slate-200/90 shadow-2xs cursor-pointer active:scale-[0.98] transition disabled:opacity-50 disabled:cursor-default';
export const btnRow = 'px-2.5 py-1 rounded-lg text-xs font-medium border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 cursor-pointer disabled:opacity-50 disabled:cursor-default';
export const inputCls = 'w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 outline-none focus:border-slate-400';
export const labelCls = 'flex flex-col gap-1 text-xs font-semibold text-slate-600';

const STATUS_TONE: Record<SerialStatus, string> = {
  HQ_STOCK: 'bg-blue-50 text-[#003857] border-blue-200/90 font-semibold',
  IN_TRANSIT: 'bg-indigo-50 text-indigo-800 border-indigo-100',
  BRANCH_RESERVE: 'bg-sky-50 text-sky-800 border-sky-200/90 font-semibold',
  AT_MERCHANT: 'bg-emerald-50 text-emerald-800 border-emerald-200/90 font-semibold',
  LOST: 'bg-rose-50 text-rose-700 border-rose-100',
  FAULTY: 'bg-amber-50 text-amber-800 border-amber-100',
  WRITTEN_OFF: 'bg-slate-100 text-slate-600 border-slate-200',
};
export const StatusPill: React.FC<{ status: SerialStatus; extra?: string; label?: string }> = ({ status, extra, label }) => (
  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${STATUS_TONE[status]}`}>
    {label || SERIAL_STATUS_LABEL[status]}{extra ? ` · ${extra}` : ''}
  </span>
);
export const Pill: React.FC<{ tone: 'good' | 'warn' | 'bad' | 'info' | 'mute'; children: React.ReactNode }> = ({ tone, children }) => {
  const c = { good: 'bg-emerald-50 text-emerald-800 border-emerald-100', warn: 'bg-amber-50 text-amber-800 border-amber-100', bad: 'bg-rose-50 text-rose-700 border-rose-100',
    info: 'bg-sky-50 text-sky-800 border-sky-100', mute: 'bg-slate-100 text-slate-600 border-slate-200' }[tone];
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${c}`}>{children}</span>;
};

/** A centred pop-up (the page behind is locked), Escape or a click outside closes it unless busy. */
export const MaterialDialog: React.FC<{
  open: boolean; title: string; sub?: string; busy?: boolean; wide?: boolean; onClose: () => void;
  footer?: React.ReactNode; children: React.ReactNode; labelledBy?: string;
}> = ({ open, title, sub, busy, wide, onClose, footer, children }) => {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const t = setTimeout(() => box.current?.querySelector<HTMLElement>('input, select, textarea')?.focus(), 60);
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; clearTimeout(t); };
  }, [open, busy, onClose]);
  if (!open) return null;
  const id = 'matdlg-' + title.replace(/\W+/g, '-').toLowerCase();
  return createPortal(
    <div className="fixed inset-0 z-[95] flex justify-end overflow-hidden bg-slate-950/55" role="dialog" aria-modal="true" aria-labelledby={id}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div ref={box} className={`drawer-glide transform-gpu w-full ${wide ? 'sm:max-w-xl md:max-w-2xl' : 'sm:max-w-[560px] md:max-w-[580px]'} h-full flex flex-col bg-white shadow-2xl rounded-l-lg overflow-hidden `}>
        <div className="navy-header-bar rounded-tl-lg flex items-start justify-between gap-3 px-5 py-4 border-b border-white/15 text-white shrink-0">
          <div className="min-w-0">
            <h2 id={id} className="text-base font-bold text-white">{title}</h2>
            {sub && <p className="text-xs text-white/80 mt-0.5">{sub}</p>}
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer disabled:opacity-40"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 px-5 py-4 overflow-y-auto min-h-0 flex flex-col gap-3.5 custom-scrollbar">{children}</div>
        {footer && <div className="shrink-0 px-5 py-3.5 border-t border-slate-200 bg-slate-50/95 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
};

export const BusyLabel: React.FC<{ busy: boolean; children: React.ReactNode }> = ({ busy, children }) => (
  <>{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{children}</>
);

export const Kpi: React.FC<{ icon: React.ElementType; label: string; value: number | string | undefined; sub?: string; tone?: 'bad' }> = ({ icon: Icon, label, value, sub, tone }) => (
  <div className="rounded-2xl bg-white border border-slate-200/90 px-4 py-3.5 shadow-2xs min-w-0">
    <div className="flex items-center gap-2 text-slate-500 text-xs font-semibold uppercase tracking-wide">
      <Icon className="w-4 h-4 text-[#003857]" aria-hidden />{label}
    </div>
    <div className={`mt-1.5 text-2xl font-extrabold tabular-nums ${tone === 'bad' ? 'text-rose-700' : 'text-slate-900'}`}>{value === undefined ? '—' : typeof value === 'number' ? value.toLocaleString() : value}</div>
    {sub && <div className="mt-0.5 text-xs text-slate-500 truncate" title={sub}>{sub}</div>}
  </div>
);

/** "Not set up yet" notice when the migration has not been applied. */
export const MaterialsSetupNotice: React.FC = () => (
  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
    The material tables are not set up in the database yet. Apply the migration <span className="font-mono text-xs">20261105_01_materials_and_kits.sql</span> in the Supabase SQL Editor, then refresh.
  </div>
);

const DAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Phnom_Penh', day: '2-digit', month: 'short', year: 'numeric' });   // one formatter, reused
export const fmtDay = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : DAY.format(d);
};

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Loader2, Trash2, X, Check } from 'lucide-react';

/**
 * Phone App Review (4 Nov 2026): confirm a permanent delete. The Super Admin types DELETE; an optional reason goes to the
 * Audit Trail. The parent does the delete in onConfirm and closes the dialog when it is done.
 */
interface Props {
  open: boolean;
  count: number;
  what: string;                       // e.g. "KHQR entries"
  sample: string[];                   // Record IDs shown (the first few)
  note?: string;                      // an extra line, e.g. approved records that will be skipped
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

export const DeleteRecordsDialog: React.FC<Props> = (props) => (props.open ? <DeleteDialogBody {...props} /> : null);

/** (5 Nov 2026) Mounted fresh at every opening, so the box starts empty at once. Before, it was emptied a moment after
 *  the dialog appeared, which could wipe the first letters of a quick "DELETE". */
const DeleteDialogBody: React.FC<Props> = ({ count, what, sample, note, busy, onCancel, onConfirm }) => {
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, [busy, onCancel]);
  const ready = typed.trim().toUpperCase() === 'DELETE' && count > 0 && !busy;
  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-3 sm:p-6 bg-slate-900/50"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }} role="dialog" aria-modal="true" aria-labelledby="del-title">
      <div className="modal-glide w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200">
        <div className="flex items-start gap-3 px-5 pt-5">
          <span className="shrink-0 w-10 h-10 rounded-full bg-rose-50 border border-rose-100 flex items-center justify-center">
            <Trash2 className="w-5 h-5 text-rose-600" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="del-title" className="text-base font-bold text-slate-900">Delete {count.toLocaleString()} {what} permanently?</h2>
            <p className="mt-1 text-sm text-slate-600">They are removed from the portal and the database. This cannot be undone.</p>
          </div>
          <button type="button" onClick={onCancel} disabled={busy} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 pt-4 space-y-3 text-sm">
          {sample.length > 0 && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 font-mono text-xs text-slate-700 break-words">
              {sample.slice(0, 6).join(', ')}{count > 6 ? `, … and ${(count - 6).toLocaleString()} more` : ''}
            </div>
          )}
          <ul className="space-y-1 text-[13px] text-slate-600">
            <li className="flex gap-2"><AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" aria-hidden />Their KPI points are removed from the KPI figures.</li>
            <li className="flex gap-2"><AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" aria-hidden />The Merchant Visit app will not send them again. The Google Sheet keeps its own copy.</li>
            {note && <li className="flex gap-2"><AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" aria-hidden />{note}</li>}
          </ul>
          <label className="block">
            <span className="block text-xs text-slate-600 mb-1">Reason (optional, kept in the Audit Trail)</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} disabled={busy}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-slate-400" placeholder="e.g. Test entries / duplicate" />
          </label>
          <label className="block">
            <span className="block text-xs text-slate-600 mb-1">Type <b className="font-mono text-rose-700">DELETE</b> to confirm</span>
            <input ref={inputRef} value={typed} onChange={(e) => setTyped(e.target.value)} disabled={busy} aria-label="Type DELETE to confirm"
              onKeyDown={(e) => { if (e.key === 'Enter' && ready) onConfirm(reason.trim()); }}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono uppercase outline-none focus:border-rose-400" autoComplete="off" />
          </label>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 mt-1">
          <button type="button" onClick={onCancel} disabled={busy}
            className="px-4 py-2 rounded-xl text-sm border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 cursor-pointer disabled:opacity-60">Cancel</button>
          <button type="button" onClick={() => onConfirm(reason.trim())} disabled={!ready}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-rose-600 hover:bg-rose-700 text-white inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete permanently
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

/** A small bar above a list: "N selected · Clear · Delete permanently". */
export const SelectionBar: React.FC<{ count: number; onClear: () => void; onDelete: () => void; label?: string }> = ({ count, onClear, onDelete, label }) => (
  <section className="sticky top-2 z-10 bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200 shadow-sm px-4 py-2.5 flex flex-wrap items-center gap-3"
    aria-label="Selected records">
    <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 text-xs font-mono">{count.toLocaleString()} Selected</span>
    {label && <span className="text-xs text-slate-500">{label}</span>}
    <button type="button" onClick={onClear} className="text-xs text-slate-600 hover:text-slate-900 underline cursor-pointer">Clear selection</button>
    <button type="button" onClick={onDelete}
      className="ml-auto px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white inline-flex items-center gap-1.5 cursor-pointer">
      <Trash2 className="w-3.5 h-3.5" /> Delete {count.toLocaleString()} permanently
    </button>
  </section>
);

/** The records ticked in a list: id -> Record ID (kept across pages until cleared). */
export function useRecordSelection() {
  const [sel, setSel] = useState<Map<number, string>>(new Map());
  const toggle = useCallback((id: number, rec: string) => setSel((p) => {
    const n = new Map(p);
    if (n.has(id)) n.delete(id); else n.set(id, rec);
    return n;
  }), []);
  const setMany = useCallback((items: { id: number; rec: string }[], on: boolean) => setSel((p) => {
    const n = new Map(p);
    items.forEach((i) => { if (on) n.set(i.id, i.rec); else n.delete(i.id); });
    return n;
  }), []);
  const clear = useCallback(() => setSel(new Map()), []);
  return { sel, toggle, setMany, clear };
}

/** A tick box inside a clickable row: it never opens or closes the row. */
export const SelectBox: React.FC<{ checked: boolean; onChange: () => void; label: string; light?: boolean }> = ({ checked, onChange, label, light }) => (
  <button
    type="button"
    aria-pressed={checked}
    aria-label={label}
    onClick={(ev) => {
      ev.stopPropagation();
      onChange();
    }}
    onMouseDown={(ev) => ev.stopPropagation()}
    onPointerDown={(ev) => ev.stopPropagation()}
    onDoubleClick={(ev) => ev.stopPropagation()}
    onKeyDown={(ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        onChange();
      }
    }}
    className={`group/btn cursor-pointer inline-flex shrink-0 items-center justify-center w-8 h-8 sm:w-8.5 sm:h-8.5 rounded-lg transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
      light ? 'hover:bg-white/20' : 'hover:bg-slate-200/75'
    }`}
  >
    <span
      className={`w-5 h-5 rounded-md flex items-center justify-center transition-all ${
        checked
          ? light
            ? 'bg-emerald-500 text-white shadow-xs border border-emerald-400'
            : 'bg-[#003857] text-white shadow-xs border border-[#003857]'
          : light
          ? 'border-2 border-white/80 group-hover/btn:border-white group-hover/nocell:border-white bg-white/10'
          : 'border-2 border-slate-300 group-hover/btn:border-[#003857] group-hover/nocell:border-[#003857] bg-white shadow-2xs'
      }`}
    >
      {checked && <Check className="w-3.5 h-3.5 stroke-[3]" aria-hidden="true" />}
    </span>
  </button>
);

/**
 * The "No." cell of a selectable table: the tick box in a fixed slot on the left, the number right-aligned beside it,
 * so the boxes form one straight column whatever the number of digits (9 → 10 → 100), in the header and every row.
 * The slot is kept even when there is no box, so the numbers stay aligned as well.
 * Clicking anywhere in this cell (or on the number) toggles selection and NEVER triggers row accordion expansion.
 */
export const NoCell: React.FC<{
  box?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  onBoxClick?: () => void;
  header?: boolean;
  pad?: 'normal' | 'wide';
}> = ({ box, children, className = '', onBoxClick, header, pad = 'normal' }) => {
  const isClickable = Boolean(box && onBoxClick);

  const handleClick = (ev: React.MouseEvent) => {
    if (box) {
      ev.stopPropagation();
      onBoxClick?.();
    }
  };

  const stopProp = (ev: React.SyntheticEvent) => {
    if (box) {
      ev.stopPropagation();
    }
  };

  const padClasses = box
    ? header
      ? pad === 'wide'
        ? '-my-2 -ml-4 py-2 pl-4 pr-1 rounded-l-lg hover:bg-white/10 transition-colors'
        : '-my-2 -ml-3.5 py-2 pl-3.5 pr-1 rounded-l-lg hover:bg-white/10 transition-colors'
      : pad === 'wide'
      ? '-my-3 -ml-4 py-3 pl-4 pr-1 rounded-l-lg hover:bg-slate-200/50 transition-colors'
      : '-my-2.5 -ml-3.5 py-2.5 pl-3.5 pr-1 rounded-l-lg hover:bg-slate-200/50 transition-colors'
    : '';

  return (
    <div
      onClick={box ? handleClick : undefined}
      onMouseDown={stopProp}
      onPointerDown={stopProp}
      onDoubleClick={stopProp}
      className={`group/nocell flex items-center justify-between w-full h-full min-h-[36px] select-none ${
        isClickable ? 'cursor-pointer' : ''
      } ${padClasses} ${className}`}
      title={isClickable ? 'Click to select / unselect' : undefined}
    >
      <div
        className="inline-flex shrink-0 items-center justify-center -my-1 -ml-1"
        onClick={(ev) => {
          if (box) {
            ev.stopPropagation();
            onBoxClick?.();
          }
        }}
        onMouseDown={stopProp}
        onPointerDown={stopProp}
      >
        {box || null}
      </div>
      <span className="flex-1 text-right tabular-nums pr-1 font-mono">{children}</span>
    </div>
  );
};

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckSquare, Loader2, Square, Trash2, X } from 'lucide-react';

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

export const DeleteRecordsDialog: React.FC<Props> = ({ open, count, what, sample, note, busy, onCancel, onConfirm }) => {
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    setTyped(''); setReason('');
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
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
    onClick={(ev) => { ev.stopPropagation(); onChange(); }}
    onKeyDown={(ev) => ev.stopPropagation()}
    className="cursor-pointer inline-flex shrink-0"
  >
    {checked
      ? <CheckSquare className={`w-4 h-4 ${light ? 'text-emerald-300' : 'text-slate-800'}`} />
      : <Square className={`w-4 h-4 ${light ? 'text-white/75 hover:text-white' : 'text-slate-400 hover:text-slate-600'}`} />}
  </button>
);

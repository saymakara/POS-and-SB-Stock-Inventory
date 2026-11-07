// (7 Nov 2026) Phone App Review → Edit: an Admin / Super Admin corrects any field of a phone app record. One window for the
// five review pages; each page gives its fields. Saved by one checked database function (Audit Trail, approved POS / Sound
// Box stock fields locked) and written back to the Merchant Visit app's Google Sheet within a few minutes (KHQR: portal only).
import React, { useEffect, useMemo, useState } from 'react';
import { Lock, History, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import { MaterialDialog, BusyLabel, btnLight, btnPrimary, inputCls, labelCls } from './MaterialsUi';
import { editPhoneRecord, fetchPhoneEdits, PhoneEditLog, PhoneEditSource, PhoneEditResult } from '../services/phoneEditService';

export interface EditField {
  /** where the value goes: a column ("mid"), a visit answer ("answers.Tag"), a detail ("details.SIM Card"),
   *  a check ("checks.Power"), or a supplementary card ("supp.0.full_name") */
  key: string;
  label: string;
  value: string | number | null | undefined;
  multiline?: boolean;
  options?: string[];
  /** shown instead of an input, with this reason */
  locked?: string;
  section?: string;
  hint?: string;
  numeric?: boolean;
}

const txt = (v: unknown) => (v == null ? '' : String(v));

/** The changes object the database function expects, from the fields whose value changed. */
export function buildChanges(fields: EditField[], values: Record<string, string>): Record<string, unknown> {
  const out: Record<string, any> = {};
  const changed = fields.filter((f) => !f.locked && txt(values[f.key]).trim() !== txt(f.value).trim());
  changed.forEach((f) => {
    const v = values[f.key] ?? '';
    const m = /^(answers|details|checks)\.(.+)$/.exec(f.key);
    if (m) { (out[m[1]] = out[m[1]] || {})[m[2]] = v; return; }
    if (/^supp\.\d+\./.test(f.key)) return;                              // (cards: below, all together)
    out[f.key] = v;
  });
  if (changed.some((f) => /^supp\.\d+\./.test(f.key))) {                 // supplementary cards travel as the whole list
    const cards: Record<string, string>[] = [];
    fields.filter((f) => /^supp\.\d+\./.test(f.key)).forEach((f) => {
      const [, i, k] = /^supp\.(\d+)\.(.+)$/.exec(f.key) as RegExpExecArray;
      (cards[Number(i)] = cards[Number(i)] || {})[k] = values[f.key] ?? txt(f.value);
    });
    out.supplementary = cards;
  }
  return out;
}

const SHEET_TEXT: Record<PhoneEditLog['sheetStatus'], string> = {
  PENDING: 'Waiting for the Google Sheet', APPLIED: 'In the Google Sheet', FAILED: 'Not written to the Google Sheet', NOT_NEEDED: 'Portal only',
};

export const PhoneRecordEditDialog: React.FC<{
  open: boolean;
  source: PhoneEditSource;
  rowId: number;
  title: string;
  sub?: string;
  fields: EditField[];
  note?: string;
  onClose: () => void;
  onSaved: (r: PhoneEditResult) => void;
  triggerToast?: (m: string) => void;
}> = ({ open, source, rowId, title, sub, fields, note, onClose, onSaved, triggerToast }) => {
  const [values, setValues] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [log, setLog] = useState<PhoneEditLog[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setValues(Object.fromEntries(fields.map((f) => [f.key, txt(f.value)])));
    setReason(''); setErr(''); setLog(null);
    let live = true;
    fetchPhoneEdits(source, rowId).then((l) => { if (live) setLog(l); }).catch(() => { if (live) setLog([]); });
    return () => { live = false; };
    // the fields of the record opened (a refresh of the list behind must not wipe what is being typed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, source, rowId]);

  const changes = useMemo(() => buildChanges(fields, values), [fields, values]);
  const nChanged = useMemo(() => fields.filter((f) => !f.locked && txt(values[f.key]).trim() !== txt(f.value).trim()).length, [fields, values]);

  const save = async () => {
    if (!nChanged || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await editPhoneRecord(source, rowId, changes, reason.trim());
      onSaved(r);
      triggerToast?.(r.changed.length
        ? `Saved ${r.changed.length} change${r.changed.length > 1 ? 's' : ''}` + (r.sheet === 'PENDING' ? ' · the Google Sheet follows within a few minutes' : '')
        : 'Nothing changed');
      onClose();
    } catch (e: any) {
      setErr(e?.message || 'The change could not be saved.');
    } finally { setBusy(false); }
  };

  const sections = useMemo(() => {
    const m = new Map<string, EditField[]>();
    fields.forEach((f) => { const s = f.section || ''; m.set(s, [...(m.get(s) || []), f]); });
    return [...m.entries()];
  }, [fields]);

  return (
    <MaterialDialog open={open} title={title} sub={sub} busy={busy} wide onClose={onClose}
      footer={<>
        <button type="button" className={btnLight} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={btnPrimary} onClick={save} disabled={busy || !nChanged} data-testid="edit-save">
          <BusyLabel busy={busy}>{nChanged ? `Save ${nChanged} change${nChanged > 1 ? 's' : ''}` : 'Save'}</BusyLabel>
        </button>
      </>}>
      {note && <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 leading-relaxed">{note}</p>}
      {sections.map(([sec, list]) => (
        <div key={sec || '_'} className="flex flex-col gap-3">
          {sec && <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mt-1">{sec}</h3>}
          <div className="grid gap-3 sm:grid-cols-2">
            {list.map((f) => {
              const v = values[f.key] ?? '';
              const dirty = !f.locked && v.trim() !== txt(f.value).trim();
              const cls = `${inputCls} ${dirty ? '!border-amber-400 bg-amber-50/40' : ''}`;
              return (
                <label key={f.key} className={`${labelCls} ${f.multiline ? 'sm:col-span-2' : ''}`}>
                  <span className="flex items-center gap-1.5">{f.label}{dirty && <span className="text-[10px] font-bold text-amber-700">changed</span>}</span>
                  {f.locked ? (
                    <span className="flex items-start gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-slate-100 text-sm text-slate-600" title={f.locked}>
                      <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
                      <span className="min-w-0"><span className="block text-slate-800 font-mono break-all">{txt(f.value) || '—'}</span>
                        <span className="block text-[11px] font-normal text-slate-500 mt-0.5">{f.locked}</span></span>
                    </span>
                  ) : f.options ? (
                    <select className={cls} value={v} onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))} disabled={busy}>
                      {!f.options.includes(v) && <option value={v}>{v || '—'}</option>}
                      {f.options.map((o) => <option key={o} value={o}>{o || '—'}</option>)}
                    </select>
                  ) : f.multiline ? (
                    <textarea className={cls} rows={3} value={v} onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))} disabled={busy} />
                  ) : (
                    <input className={cls} value={v} inputMode={f.numeric ? 'numeric' : undefined} onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))} disabled={busy} />
                  )}
                  {f.hint && <span className="text-[11px] font-normal text-slate-500">{f.hint}</span>}
                </label>
              );
            })}
          </div>
        </div>
      ))}
      <label className={labelCls}>
        Reason for the change (optional, kept in the Audit Trail)
        <input className={inputCls} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} disabled={busy} placeholder="e.g. typo in the terminal name" />
      </label>
      {err && <p role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{err}</p>}
      {log && log.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-slate-200 pt-3">
          <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500"><History className="w-3.5 h-3.5" aria-hidden="true" />Earlier changes</h3>
          {log.map((l) => {
            const ch = (l.changes as any).answers || l.changes, old = (l.oldValues as any).answers || l.oldValues;
            return (
              <div key={l.id} className="text-xs text-slate-600 rounded-xl border border-slate-200 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-700">{l.editedBy} · {new Date(l.editedAt).toLocaleString('en-GB', { timeZone: 'Asia/Phnom_Penh', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  <span className={`inline-flex items-center gap-1 ${l.sheetStatus === 'APPLIED' ? 'text-emerald-700' : l.sheetStatus === 'FAILED' ? 'text-rose-700' : 'text-slate-500'}`}>
                    {l.sheetStatus === 'APPLIED' ? <CheckCircle2 className="w-3.5 h-3.5" /> : l.sheetStatus === 'FAILED' ? <AlertTriangle className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                    {SHEET_TEXT[l.sheetStatus]}{l.sheetStatus === 'FAILED' && l.sheetNote ? ` (${l.sheetNote})` : ''}
                  </span>
                </div>
                <ul className="mt-1 space-y-0.5">
                  {Object.keys(ch).map((k) => <li key={k} className="break-words"><span className="text-slate-500">{k}:</span> {fmtVal(old[k])} → <b className="text-slate-800">{fmtVal(ch[k])}</b></li>)}
                </ul>
                {l.reason && <p className="mt-1 text-slate-500">Reason: {l.reason}</p>}
              </div>
            );
          })}
        </div>
      )}
    </MaterialDialog>
  );
};

function fmtVal(v: unknown): string {
  if (v == null || v === '') return '—';
  if (typeof v === 'object') return Array.isArray(v) ? `${v.length} item(s)` : Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k} ${x ?? '—'}`).join(', ');
  return String(v);
}

import { memo, useCallback, useEffect, useState } from 'react';
import { Database, Loader2, Save, Trash2, Lock } from 'lucide-react';
import { KhqrRetention, deleteKhqrMonth, fetchKhqrRetention, setKhqrKeepMonths } from '../services/khqrRetentionService';

/**
 * (21 Nov 2026, owner) Settings > Data: KHQR Installation data kept on the server. The details are kept N months (default 6);
 * older months are deleted at night. A Super Admin chooses N and can delete one month's details now. KPI Performance and the
 * dashboards keep their totals after the night clean-up. (28 Nov 2026) The Delete button removes a month completely, totals included.
 */
interface Props { isSuperAdmin: boolean; toast: (m: string) => void }
const MONTHS = Array.from({ length: 24 }, (_, i) => i + 1);
const label = (ym: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : ym;
};
const fmt = (n: number) => n.toLocaleString('en-US');

export const KhqrRetentionSection = memo(function KhqrRetentionSection({ isSuperAdmin, toast }: Props) {
  const [info, setInfo] = useState<KhqrRetention | null>(null);
  const [err, setErr] = useState('');
  const [keep, setKeep] = useState(6);
  const [busy, setBusy] = useState<string>('');            // '' | 'save' | month being deleted
  const [progress, setProgress] = useState('');
  const load = useCallback(async () => {
    try { const r = await fetchKhqrRetention(); setInfo(r); setKeep(r.keepMonths); setErr(''); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!info || keep === info.keepMonths) return;
    if (keep < info.keepMonths && !window.confirm(`Keep KHQR details for ${keep} month(s) instead of ${info.keepMonths}?\n\nOlder months' details (entries, merchants, photos, GPS) will be deleted tonight. KPI Performance and dashboard totals stay.`)) return;
    setBusy('save');
    try { await setKhqrKeepMonths(keep); toast(`KHQR details are now kept for ${keep} month(s).`); await load(); }
    catch (e) { toast(`Not saved: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(''); }
  };
  const remove = async (ym: string, n: number) => {
    // (28 Nov 2026, owner) a deleted month is deleted completely: details AND totals
    if (!window.confirm(`Delete ALL KHQR Installation data of ${label(ym)}${n ? ` (${fmt(n)} records)` : ' (totals)'}?\n\nThe entries, merchant names, photo links, GPS and the month's totals are removed for good. ${label(ym)} will count 0 KHQR on the KHQR page, in KPI Performance and on the Dashboard.\n\nThis cannot be undone.`)) return;
    setBusy(ym); setProgress('');
    try {
      const done = await deleteKhqrMonth(ym, (removed, left) => setProgress(left > 0 ? `${fmt(removed)} deleted · ${fmt(left)} to go…` : ''));
      toast(`${label(ym)}: KHQR data deleted${done ? ` (${fmt(done)} records)` : ''} · totals removed too: the month now counts 0 in KHQR, KPI Performance and Dashboard.`);
      await load();
    } catch (e) { toast(`Not deleted: ${e instanceof Error ? e.message : String(e)}`); await load(); }
    finally { setBusy(''); setProgress(''); }
  };

  return (
    <section className="surface-card p-5 rounded-2xl shadow-xs border border-slate-200/80 space-y-4" aria-label="KHQR Installation data kept">
      <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
        <div className="w-8 h-8 rounded-lg bg-sky-50 text-sky-700 border border-sky-200 flex items-center justify-center"><Database className="w-4 h-4" /></div>
        <div className="min-w-0">
          <h3 className="text-sm font-extrabold text-zinc-900">KHQR Installation data kept</h3>
          <p className="text-[11px] text-slate-500">Details are kept on the server for the months below; older months are deleted at night. The night clean-up keeps the totals (KPI Performance, Dashboard); <strong>Delete</strong> removes a month completely, totals included.</p>
        </div>
      </div>
      {err ? <p className="text-xs text-rose-600" role="alert">{err}</p> : !info ? (
        <p className="text-xs text-slate-500 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-semibold text-slate-700">
              Keep details for
              <select value={keep} onChange={(e) => setKeep(Number(e.target.value))} disabled={!isSuperAdmin || !!busy} aria-label="Months of KHQR details kept"
                className="mt-1 block w-44 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 disabled:opacity-60">
                {MONTHS.map((m) => <option key={m} value={m}>{m === 1 ? 'This month only' : `${m} months`}</option>)}
              </select>
            </label>
            {isSuperAdmin ? (
              <button type="button" onClick={save} disabled={keep === info.keepMonths || !!busy}
                className="px-4 py-2 rounded-xl bg-[#eaf4f2] hover:bg-[#d5eae6] text-[#1d5c55] hover:text-[#144741] border border-[#c3e0da] hover:border-[#9fd0c7] text-xs font-semibold flex items-center gap-2 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed transition">
                {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
              </button>
            ) : (
              <span className="text-[11px] text-slate-500 flex items-center gap-1.5 pb-2"><Lock className="w-3.5 h-3.5 text-amber-500" /> Super Admin only</span>
            )}
            <p className="text-[11px] text-slate-500 pb-2">
              From {label(info.keepFrom)} · details now use {info.detailsSize}{info.updatedBy ? ` · set by ${info.updatedBy}` : ''}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100">
                  <th className="py-2 pr-3 font-bold">Month</th><th className="py-2 pr-3 font-bold text-right">Details kept</th>
                  <th className="py-2 pr-3 font-bold text-right">Attempts / wrong scans</th><th className="py-2 pr-3 font-bold">Status</th><th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {info.months.map((m) => {
                  const has = m.entries + m.attempts > 0, totals = m.summaryEntries > 0;
                  const status = m.current ? 'This month' : !has ? 'Totals only (details deleted)' : m.autoDelete ? 'Deleted tonight (totals kept)' : 'Kept';
                  return (
                    <tr key={m.month} className="border-b border-slate-50 last:border-0">
                      <td className="py-2 pr-3 font-semibold text-slate-800 whitespace-nowrap">{label(m.month)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{has ? fmt(m.entries) : '—'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{has ? fmt(m.attempts) : '—'}</td>
                      <td className={`py-2 pr-3 whitespace-nowrap ${!has ? 'text-slate-400' : m.autoDelete ? 'text-amber-600' : 'text-slate-600'}`}>
                        {busy === m.month && progress ? progress : status}
                      </td>
                      <td className="py-2 text-right">
                        {isSuperAdmin && (has || totals) && !m.current && (
                          <button type="button" onClick={() => remove(m.month, m.entries + m.attempts)} disabled={!!busy}
                            aria-label={`Delete all KHQR data of ${label(m.month)}`} title="Deletes the details and the totals of the month (counts 0 in KPI and Dashboard)"
                            className="px-2.5 py-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 text-[11px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed">
                            {busy === m.month ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} {has ? 'Delete month' : 'Delete totals'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!info.months.length && <tr><td colSpan={5} className="py-3 text-slate-500">No KHQR data yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
});

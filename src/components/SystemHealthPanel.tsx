import React, { useEffect, useMemo, useState } from 'react';
import { Activity, CheckCircle2, AlertTriangle, XCircle, RotateCcw, Copy } from 'lucide-react';
import { getPerfSnapshot, percentile, resetPerfCounters, PerfSnapshot } from '../utils/perfMonitor';

/**
 * (31 Oct 2026) Settings → System Health (Super Admin). Live speed and error figures for THIS browser session:
 * page experience (Google's Core Web Vitals), database request times and errors. Nothing is sent or stored.
 */
type Level = 'good' | 'fair' | 'poor' | 'none';
const level = (v: number | null, good: number, poor: number): Level => (v === null ? 'none' : v <= good ? 'good' : v <= poor ? 'fair' : 'poor');
const LEVEL_UI: Record<Level, { label: string; cls: string; Icon: React.ElementType }> = {
  good: { label: 'Good', cls: 'text-emerald-700 bg-emerald-50 border-emerald-200', Icon: CheckCircle2 },
  fair: { label: 'Needs attention', cls: 'text-amber-700 bg-amber-50 border-amber-200', Icon: AlertTriangle },
  poor: { label: 'Poor', cls: 'text-rose-700 bg-rose-50 border-rose-200', Icon: XCircle },
  none: { label: 'Not measured yet', cls: 'text-slate-600 bg-slate-50 border-slate-200', Icon: Activity },
};
const ms = (v: number | null) => (v === null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v} ms`);
const time = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** "/rest/v1/rpc/qr_summary" → "qr_summary (function)" */
const friendly = (path: string) => {
  const rpc = path.match(/\/rest\/v1\/rpc\/(.+)$/);
  if (rpc) return `${rpc[1]} (function)`;
  const tbl = path.match(/\/rest\/v1\/(.+)$/);
  if (tbl) return `${tbl[1]} (table)`;
  const auth = path.match(/\/auth\/v1\/(.+)$/);
  if (auth) return `sign-in: ${auth[1]}`;
  return path;
};

const Kpi: React.FC<{ title: string; value: string; hint: string; lv: Level }> = ({ title, value, hint, lv }) => {
  const u = LEVEL_UI[lv];
  return (
    <div className="surface-card rounded-2xl border border-slate-200 p-4 flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</span>
      <span className="text-2xl font-bold text-slate-900 tabular-nums">{value}</span>
      <span className={`self-start inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${u.cls}`}>
        <u.Icon className="w-3.5 h-3.5" aria-hidden />
        {u.label}
      </span>
      <span className="text-[11px] text-slate-500">{hint}</span>
    </div>
  );
};

export const SystemHealthPanel: React.FC = () => {
  const [snap, setSnap] = useState<PerfSnapshot>(() => getPerfSnapshot());
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const id = window.setInterval(() => setSnap(getPerfSnapshot()), 2000);
    return () => window.clearInterval(id);
  }, []);

  const apiAll = snap.api.filter((c) => c.status !== -1); // -1 = cancelled on purpose (not counted)
  const times = apiAll.map((c) => c.ms);
  const apiMedian = percentile(times, 50);
  const apiP95 = percentile(times, 95);
  const failed = apiAll.filter((c) => c.status === 0 || c.status >= 400).length;

  const byPath = useMemo(() => {
    const g = new Map<string, number[]>();
    const fails = new Map<string, number>();
    apiAll.forEach((c) => {
      const k = friendly(c.path);
      (g.get(k) || g.set(k, []).get(k)!).push(c.ms);
      if (c.status === 0 || c.status >= 400) fails.set(k, (fails.get(k) || 0) + 1);
    });
    return [...g.entries()]
      .map(([name, v]) => ({ name, calls: v.length, median: percentile(v, 50) || 0, p95: percentile(v, 95) || 0, max: Math.max(...v), fails: fails.get(name) || 0 }))
      .sort((a, b) => b.p95 - a.p95);
  }, [apiAll]);

  // (31 Oct 2026) one or two requests say little (one slow network moment would look like "very slow"): judge from 10 or more
  const fewApi = apiAll.length < 10;
  const report = () => [
    `System Health · ${new Date().toLocaleString('en-GB')} · since ${time(snap.startedAt)}`,
    `LCP ${ms(snap.lcp)} · INP worst ${ms(snap.inpWorst)} (typical ${ms(snap.inpP75)}, ${snap.interactions} interactions) · CLS ${snap.cls}`,
    `First server reply ${ms(snap.ttfb)} · first content ${ms(snap.fcp)} · busy moments ${snap.longTasks} (${snap.longTaskMs} ms)`,
    `Database requests ${apiAll.length} · median ${ms(apiMedian)} · 95% within ${ms(apiP95)} · failed ${failed}${fewApi ? ' (too few requests to judge: use the system a few minutes first)' : ''}`,
    ...byPath.slice(0, 15).map((r) => `  ${r.name}: ${r.calls}× median ${r.median} ms, 95% ${r.p95} ms, max ${r.max} ms${r.fails ? `, failed ${r.fails}` : ''}`),
    `Errors ${snap.errors.length}`,
    ...snap.errors.slice(-10).map((e) => `  ${time(e.at)} [${e.source}] ${e.message}`),
  ].join('\n');

  return (
    <div className="space-y-5" aria-label="System Health">
      <div className="surface-card rounded-2xl border border-slate-200 p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-extrabold text-zinc-900 flex items-center gap-2"><Activity className="w-4 h-4 text-sky-700" aria-hidden />System Health · this browser, live</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            How fast the system responds on this computer since {time(snap.startedAt)}. Updates every 2 seconds. Nothing is sent or stored; it resets when the page reloads.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { navigator.clipboard?.writeText(report()).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); }).catch(() => {}); }}
            className="px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 bg-white hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Copy className="w-3.5 h-3.5" aria-hidden />{copied ? 'Copied' : 'Copy report'}
          </button>
          <button
            type="button"
            onClick={() => { resetPerfCounters(); setSnap(getPerfSnapshot()); }}
            className="px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 bg-white hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden />Start new measurement
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi title="Page shown (LCP)" value={ms(snap.lcp)} lv={level(snap.lcp, 2500, 4000)} hint="Main content visible after opening. Target ≤ 2.5 s" />
        <Kpi title="Reaction (INP)" value={ms(snap.inpWorst)} lv={level(snap.inpWorst, 200, 500)} hint={`Slowest tap/click of ${snap.interactions}; typical ${ms(snap.inpP75)}. Target ≤ 200 ms`} />
        <Kpi title="Layout jumps (CLS)" value={snap.cls.toFixed(3)} lv={level(snap.cls, 0.1, 0.25)} hint="How much the page moved by itself. Target ≤ 0.1" />
        <Kpi title="Database, typical" value={ms(apiMedian)} lv={fewApi ? 'none' : level(apiMedian, 300, 1000)} hint={fewApi ? `Only ${apiAll.length} request(s) so far: too few to judge` : `Median of ${apiAll.length} requests. Target ≤ 300 ms`} />
        <Kpi title="Database, slow end" value={ms(apiP95)} lv={fewApi ? 'none' : level(apiP95, 800, 2000)} hint={fewApi ? 'Needs at least 10 requests' : '95% of requests finish within this. Target ≤ 800 ms'} />
        <Kpi title="Errors" value={String(snap.errors.length)} lv={snap.errors.length === 0 ? 'good' : snap.errors.length <= 3 ? 'fair' : 'poor'} hint={`${failed} failed request(s) · ${snap.longTasks} busy moment(s)`} />
      </div>

      <div className="surface-card rounded-2xl border border-slate-200 overflow-x-auto">
        <div className="px-4 py-2.5 border-b border-slate-200 text-[13px] font-medium text-slate-900">Database requests by table / function <span className="text-slate-500 text-[11.5px]">· slowest first</span></div>
        <table className="data-table w-full text-xs">
          <thead className="glass-table-thead">
            <tr><th>Table / function</th><th className="text-right">Requests</th><th className="text-right">Typical</th><th className="text-right">95% within</th><th className="text-right">Slowest</th><th className="text-right">Failed</th></tr>
          </thead>
          <tbody>
            {byPath.length === 0 && (<tr><td colSpan={6} className="text-center text-slate-500 py-6">No database requests yet in this measurement.</td></tr>)}
            {byPath.map((r) => (
              <tr key={r.name}>
                <td className="cell-mono">{r.name}</td>
                <td className="text-right tabular-nums">{r.calls}</td>
                <td className="text-right tabular-nums">{ms(r.median)}</td>
                <td className="text-right tabular-nums">{ms(r.p95)}</td>
                <td className="text-right tabular-nums">{ms(r.max)}</td>
                <td className={`text-right tabular-nums ${r.fails ? 'warn-text' : ''}`}>{r.fails}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="surface-card rounded-2xl border border-slate-200 overflow-x-auto">
        <div className="px-4 py-2.5 border-b border-slate-200 text-[13px] font-medium text-slate-900">Recent errors <span className="text-slate-500 text-[11.5px]">· newest first, up to 60</span></div>
        {snap.errors.length === 0 ? (
          <p className="px-4 py-5 text-xs text-slate-500">No errors in this measurement.</p>
        ) : (
          <table className="data-table w-full text-xs">
            <thead className="glass-table-thead"><tr><th>Time</th><th>Kind</th><th>Message</th></tr></thead>
            <tbody>
              {snap.errors.slice().reverse().map((e, i) => (
                <tr key={i}><td className="cell-mono whitespace-nowrap">{time(e.at)}</td><td className="whitespace-nowrap">{e.source === 'request' ? 'Request' : e.source === 'promise' ? 'Background task' : 'Script'}</td><td className="break-words">{e.message}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-[11px] text-slate-500">
        Other first measures: first server reply {ms(snap.ttfb)} · first content {ms(snap.fcp)}. Request figures show only the table or function name, never search text or record data.
      </p>
    </div>
  );
};

export default SystemHealthPanel;

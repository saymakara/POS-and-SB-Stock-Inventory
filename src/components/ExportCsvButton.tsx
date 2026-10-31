import React, { useState } from 'react';
import { FileSpreadsheet, Loader2 } from 'lucide-react';

/** (31 Oct 2026) "Export CSV" on the four Phone App Review pages: the same look as Export CSV everywhere else
 *  (Branch Codes, Audit Trail, Merchant History, Stock Inventory). */
export const ExportCsvButton: React.FC<{ onExport: () => Promise<number>; toast?: (m: string) => void; title?: string }> = ({ onExport, toast, title }) => {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const n = await onExport();
          toast?.(n ? `CSV file saved: ${n.toLocaleString()} row(s).` : 'Nothing to export with the current filters.');
        } catch (e) {
          toast?.(`The CSV file could not be made: ${e instanceof Error ? e.message : String(e)}`);
        } finally { setBusy(false); }
      }}
      title={title || 'Save every record that matches the filters as a CSV file (opens in Excel)'}
      className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer transition shadow-2xs shrink-0 whitespace-nowrap disabled:opacity-60 disabled:cursor-wait"
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" aria-hidden="true" /> : <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />}
      <span>{busy ? 'Preparing…' : 'Export CSV'}</span>
    </button>
  );
};

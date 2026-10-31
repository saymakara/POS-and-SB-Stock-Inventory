import React, { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';

/** (31 Oct 2026) The same "Export CSV" button on the four Phone App Review pages. */
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
      className="btn-press inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold cursor-pointer transition disabled:opacity-60 whitespace-nowrap"
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
      {busy ? 'Preparing…' : 'Export CSV'}
    </button>
  );
};

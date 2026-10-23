import React, { useEffect, useRef, useState } from 'react';
import { ScanLine, X } from 'lucide-react';

/** Text box that also accepts a scan: a handheld scanner types into it, and on phones a camera button reads the barcode / QR code. */
export const ScanField: React.FC<{ label: string; value: string; onChange: (v: string) => void; expected?: string; mono?: boolean; normalize?: (v: string) => string }>
  = ({ label, value, onChange, expected, mono = true, normalize = (v) => v.replace(/\s+/g, '').toUpperCase() }) => {
  const [cam, setCam] = useState(false);
  const [camErr, setCamErr] = useState('');
  const video = useRef<HTMLVideoElement | null>(null);
  const canScan = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;
  const filled = value.trim() !== '';
  const ok = filled && expected !== undefined && normalize(value) === normalize(expected);

  useEffect(() => {
    if (!cam) return;
    let stop = false; let stream: MediaStream | null = null; let timer = 0;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (video.current) { video.current.srcObject = stream; await video.current.play(); }
        const Det = (window as unknown as { BarcodeDetector: new (o?: unknown) => { detect: (v: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;
        const det = new Det();
        const tick = async () => {
          if (stop || !video.current) return;
          try { const r = await det.detect(video.current); if (r[0]?.rawValue) { onChange(r[0].rawValue); setCam(false); return; } } catch { /* keep trying */ }
          timer = window.setTimeout(tick, 250);
        };
        tick();
      } catch { setCamErr('The camera could not be opened. Type the value or use a scanner.'); setCam(false); }
    })();
    return () => { stop = true; window.clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cam]);

  return (
    <label className="flex flex-col gap-1 text-slate-600">{label}
      <span className="flex items-center gap-1.5">
        <input value={value} onChange={(e) => onChange(e.target.value)} maxLength={40} autoComplete="off" inputMode={mono ? 'text' : undefined}
          className={`flex-1 min-w-0 px-2 py-1.5 rounded-lg border bg-white text-xs text-slate-900 ${mono ? 'font-mono' : ''} ${filled ? (ok ? 'border-emerald-500' : 'border-rose-400') : 'border-slate-300'}`}
          placeholder="Type or scan" />
        {canScan && <button type="button" onClick={() => { setCamErr(''); setCam(true); }} aria-label={`Scan ${label}`} className="p-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 cursor-pointer"><ScanLine className="w-4 h-4" /></button>}
      </span>
      {filled && expected !== undefined && <span className={ok ? 'text-emerald-700' : 'text-rose-700'}>{ok ? 'Matches the record' : 'Does not match the record'}</span>}
      {camErr && <span className="text-rose-700">{camErr}</span>}
      {cam && (
        <div className="fixed inset-0 z-[95] bg-black/80 flex flex-col items-center justify-center p-4 gap-3" role="dialog" aria-modal="true" aria-label="Scan">
          <video ref={video} className="w-full max-w-sm rounded-xl bg-black" muted playsInline />
          <button type="button" onClick={() => setCam(false)} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white text-slate-800 text-sm cursor-pointer"><X className="w-4 h-4" />Close</button>
        </div>
      )}
    </label>
  );
};

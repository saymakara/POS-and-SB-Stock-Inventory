import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ThemeMode } from '../types';

interface GroupedBarChartProps {
  labels: string[];
  series1Label: string;
  series1Data: number[];
  series1Color: string;
  series2Label: string;
  series2Data: number[];
  series2Color: string;
  height?: number;
  theme?: ThemeMode;
  /** Optional screen-reader summary. When omitted, one is built from the data. */
  ariaLabel?: string;
}

type Ctx2D = CanvasRenderingContext2D;
/** roundRect is missing in some older browsers (e.g. older Android WebViews); fall back to a plain rectangle. */
function roundRectPath(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number | number[]) {
  ctx.beginPath();
  if (typeof (ctx as any).roundRect === 'function') (ctx as any).roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

export const GroupedBarChart: React.FC<GroupedBarChartProps> = ({
  labels,
  series1Label,
  series1Data,
  series1Color,
  series2Label,
  series2Data,
  series2Color,
  height = 240,
  theme = 'dark',
  ariaLabel,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!parent) return;

    const updateWidth = () => {
      if (parent.clientWidth > 0) {
        setContainerWidth(parent.clientWidth);
      }
    };

    updateWidth();

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        updateWidth();
      });
      observer.observe(parent);
    } else {
      window.addEventListener('resize', updateWidth);
    }

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateWidth);
    };
  }, []);

  // Redraw only when the values change, not when a parent passes a new array with the same values.
  const dataKey = useMemo(
    () => JSON.stringify([labels, series1Data, series2Data]),
    [labels, series1Data, series2Data]
  );
  const hasData = useMemo(
    () => series1Data.some((v) => v > 0) || series2Data.some((v) => v > 0),
    [series1Data, series2Data]
  );
  const summary = useMemo(() => {
    if (ariaLabel) return ariaLabel;
    if (labels.length === 0 || !hasData) return `Bar chart: ${series1Label} and ${series2Label}. No data to show.`;
    const parts = labels.map((l, i) => `${l}: ${series1Data[i] || 0} ${series1Label}, ${series2Data[i] || 0} ${series2Label}`);
    return `Bar chart of ${series1Label} and ${series2Label}. ${parts.join('; ')}.`;
    // dataKey covers labels/series value changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ariaLabel, dataKey, series1Label, series2Label, hasData]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    const dpr = window.devicePixelRatio || 1;
    const width = containerWidth || parent.clientWidth || 540;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const isLight = theme === 'light';

    const legendTextColor = isLight ? '#0f172a' : '#e2e8f0';
    const gridLineColor = isLight ? '#e2e8f0' : 'rgba(255, 255, 255, 0.1)';
    const axisTextColor = isLight ? '#64748b' : '#94a3b8';
    const valueTextColor = isLight ? '#0f172a' : '#f8fafc';
    const labelTextColor = isLight ? '#334155' : '#cbd5e1';
    const chartFont = '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, sans-serif';

    // Legend
    ctx.font = `700 11px ${chartFont}`;
    ctx.fillStyle = series1Color;
    roundRectPath(ctx, 16, 8, 10, 10, 3);
    ctx.fill();
    ctx.fillStyle = legendTextColor;
    ctx.fillText(series1Label, 32, 17);

    const s1Width = ctx.measureText(series1Label).width;
    ctx.fillStyle = series2Color;
    roundRectPath(ctx, 52 + s1Width, 8, 10, 10, 3);
    ctx.fill();
    ctx.fillStyle = legendTextColor;
    ctx.fillText(series2Label, 68 + s1Width, 17);

    const padLeft = 36;
    const padRight = 16;
    const padTop = 38;
    const padBottom = 38;
    const plotW = Math.max(100, width - padLeft - padRight);
    const plotH = Math.max(80, height - padTop - padBottom);
    const maxVal = Math.max(4, ...series1Data, ...series2Data);
    const steps = 4;

    ctx.strokeStyle = gridLineColor;
    ctx.lineWidth = 1;
    ctx.font = `600 10.5px ${chartFont}`;
    ctx.fillStyle = axisTextColor;

    for (let i = 0; i <= steps; i++) {
      const y = padTop + plotH - (i / steps) * plotH;
      const val = Math.round((i / steps) * maxVal);
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
      ctx.fillText(String(val), 8, y + 3);
    }

    const groupCount = Math.max(1, labels.length);
    const groupW = plotW / groupCount;
    const barW = Math.min(24, Math.max(8, (groupW - 14) / 2));

    labels.forEach((lbl, idx) => {
      const gx = padLeft + idx * groupW + (groupW - barW * 2 - 4) / 2;
      const v1 = series1Data[idx] || 0;
      const v2 = series2Data[idx] || 0;
      const h1 = (v1 / maxVal) * plotH;
      const h2 = (v2 / maxVal) * plotH;

      // Bar 1
      ctx.fillStyle = series1Color;
      if (h1 > 0) {
        roundRectPath(ctx, gx, padTop + plotH - h1, barW, h1, [4, 4, 0, 0]);
        ctx.fill();
      }

      // Bar 2
      ctx.fillStyle = series2Color;
      if (h2 > 0) {
        roundRectPath(ctx, gx + barW + 4, padTop + plotH - h2, barW, h2, [4, 4, 0, 0]);
        ctx.fill();
      }

      // Value annotations (centered above bars)
      ctx.font = `700 10px ${chartFont}`;
      if (v1 > 0) {
        ctx.fillStyle = valueTextColor;
        const tw1 = ctx.measureText(String(v1)).width;
        ctx.fillText(String(v1), gx + (barW - tw1) / 2, padTop + plotH - h1 - 4);
      }
      if (v2 > 0) {
        ctx.fillStyle = valueTextColor;
        const tw2 = ctx.measureText(String(v2)).width;
        ctx.fillText(String(v2), gx + barW + 4 + (barW - tw2) / 2, padTop + plotH - h2 - 4);
      }

      // X-axis label
      ctx.fillStyle = labelTextColor;
      ctx.font = `600 10.5px ${chartFont}`;
      const shortLbl = lbl.length > 11 ? lbl.slice(0, 10) + '…' : lbl;
      const tw = ctx.measureText(shortLbl).width;
      ctx.fillText(shortLbl, padLeft + idx * groupW + (groupW - tw) / 2, height - 14);
    });
    // labels / series are covered by dataKey (value-based)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dataKey,
    series1Color,
    series2Color,
    series1Label,
    series2Label,
    height,
    theme,
    containerWidth,
  ]);

  return (
    <div className="relative w-full flex items-center justify-center" style={{ height: height + 5 }}>
      <canvas ref={canvasRef} role="img" aria-label={summary} className="w-full h-full block">
        {summary}
      </canvas>
      {!hasData && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden="true">
          <span className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${theme === 'light' ? 'bg-white/90 text-slate-500' : 'bg-black/40 text-slate-300'}`}>
            No data for this period
          </span>
        </div>
      )}
    </div>
  );
};

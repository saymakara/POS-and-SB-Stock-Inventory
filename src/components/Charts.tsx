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
const NF = new Intl.NumberFormat('en-US');   // reused for every axis label and tooltip
const fmt = (n: number) => NF.format(n);
/** (31 Oct 2026, UI standard) round axis steps (0, 150, 300, 450, 600), not quarters of the highest bar (143, 286, 429). */
function niceScale(maxVal: number, targetSteps = 4): { max: number; steps: number; step: number } {
  const raw = Math.max(1, maxVal) / targetSteps;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = ([1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= raw) || 10 * mag);
  const steps = Math.max(1, Math.ceil(maxVal / step));
  return { max: step * steps, steps, step };
}
/** roundRect is missing in some older browsers (e.g. older Android WebViews); fall back to a plain rectangle. */
function roundRectPath(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number | number[]) {
  ctx.beginPath();
  if (typeof (ctx as any).roundRect === 'function') (ctx as any).roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

export const GroupedBarChart: React.FC<GroupedBarChartProps> = React.memo(({
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
  const [hover, setHover] = useState<{ idx: number; x: number } | null>(null);
  const geomRef = useRef<{ padLeft: number; groupW: number; count: number } | null>(null);
  const hoverRafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!parent) return;

    const updateWidth = () => {
      if (parent.clientWidth > 0) {
        setContainerWidth(parent.clientWidth);
      }
    };

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      // (13 Nov 2026, speed) the observer reports the first size itself, after the browser's own layout: reading clientWidth
      // here forced an extra layout of the whole page in the middle of drawing it (~100 ms on a slower laptop at sign-in)
      observer = new ResizeObserver((entries) => {
        const w = Math.round(entries[entries.length - 1]?.contentRect.width || 0);
        if (w > 0) setContainerWidth((prev) => (prev === w ? prev : w));
      });
      observer.observe(parent);
    } else {
      updateWidth();
      window.addEventListener('resize', updateWidth);
    }

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateWidth);
      if (hoverRafRef.current !== null) cancelAnimationFrame(hoverRafRef.current);
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
  const chartStats = useMemo(() => {
    const scale = niceScale(Math.max(4, ...series1Data, ...series2Data));
    const max1 = Math.max(...series1Data, 0);
    const max2 = Math.max(...series2Data, 0);
    return {
      scale,
      max1,
      max2,
      firstMax1: series1Data.indexOf(max1),
      firstMax2: series2Data.indexOf(max2),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);
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
    const targetW = Math.round(width * dpr);
    const targetH = Math.round(height * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

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
    const { scale, firstMax1, firstMax2 } = chartStats;
    const maxVal = scale.max;
    const steps = scale.steps;

    ctx.strokeStyle = gridLineColor;
    ctx.lineWidth = 1;
    ctx.font = `600 11px ${chartFont}`;
    ctx.fillStyle = axisTextColor;

    for (let i = 0; i <= steps; i++) {
      const y = padTop + plotH - (i / steps) * plotH;
      const val = Math.round(i * scale.step);
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
      const vs = fmt(val);
      ctx.fillText(vs, Math.max(2, padLeft - 6 - ctx.measureText(vs).width), y + 3);
    }

    const groupCount = Math.max(1, labels.length);
    const groupW = plotW / groupCount;
    geomRef.current = { padLeft, groupW, count: labels.length };
    // (31 Oct 2026, UI standard) numbers only where they help: the last group and each series' highest bar;
    // every other value is shown on hover / tap.
    const lastIdx = labels.length - 1;
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

      // Value annotations (centered above bars): last group + highest bar of each series
      ctx.font = `600 11px ${chartFont}`;
      if (v1 > 0 && (idx === lastIdx || idx === firstMax1)) {
        ctx.fillStyle = valueTextColor;
        const tw1 = ctx.measureText(fmt(v1)).width;
        ctx.fillText(fmt(v1), gx + (barW - tw1) / 2, padTop + plotH - h1 - 4);
      }
      if (v2 > 0 && (idx === lastIdx || idx === firstMax2)) {
        ctx.fillStyle = valueTextColor;
        const tw2 = ctx.measureText(fmt(v2)).width;
        ctx.fillText(fmt(v2), gx + barW + 4 + (barW - tw2) / 2, padTop + plotH - h2 - 4);
      }

      // X-axis label
      ctx.fillStyle = labelTextColor;
      ctx.font = `600 11px ${chartFont}`;
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
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={summary}
        className="w-full h-full block"
        onPointerMove={(e) => {
          const g = geomRef.current; if (!g || !g.count) return;
          const r = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - r.left;
          const idx = Math.floor((x - g.padLeft) / g.groupW);
          if (hoverRafRef.current !== null) cancelAnimationFrame(hoverRafRef.current);
          hoverRafRef.current = requestAnimationFrame(() => {
            hoverRafRef.current = null;
            if (idx < 0 || idx >= g.count) {
              setHover((prev) => (prev ? null : prev));
              return;
            }
            const nextX = g.padLeft + (idx + 0.5) * g.groupW;
            setHover((prev) => (prev && prev.idx === idx ? prev : { idx, x: nextX }));
          });
        }}
        onPointerLeave={() => {
          if (hoverRafRef.current !== null) {
            cancelAnimationFrame(hoverRafRef.current);
            hoverRafRef.current = null;
          }
          setHover(null);
        }}
      >
        {summary}
      </canvas>
      {hover && hasData && labels[hover.idx] !== undefined && (
        <div
          className="absolute top-8 pointer-events-none z-10 rounded-lg border border-slate-200 bg-white/95 shadow-md px-2.5 py-1.5 text-[11px] text-slate-700 whitespace-nowrap"
          style={{ left: hover.x, transform: `translateX(${hover.x > (containerWidth || 0) / 2 ? 'calc(-100% - 12px)' : '12px'})` }}
          role="status"
        >
          <div className="font-semibold text-slate-900 mb-0.5">{labels[hover.idx]}</div>
          <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: series1Color }} />{series1Label}: <strong className="text-slate-900">{fmt(series1Data[hover.idx] || 0)}</strong></div>
          <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: series2Color }} />{series2Label}: <strong className="text-slate-900">{fmt(series2Data[hover.idx] || 0)}</strong></div>
          {(() => { const t = (series1Data[hover.idx] || 0) + (series2Data[hover.idx] || 0); return t > 0 ? <div className="text-slate-500 mt-0.5">Total {fmt(t)} · {series1Label.split(" ")[0]} {Math.round(((series1Data[hover.idx] || 0) / t) * 100)}%</div> : null; })()}
        </div>
      )}
      {!hasData && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden="true">
          <span className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${theme === 'light' ? 'bg-white/90 text-slate-500' : 'bg-black/40 text-slate-300'}`}>
            No data for this period
          </span>
        </div>
      )}
    </div>
  );
});

export interface CrossChannelDayPoint {
  label: string;
  fullLabel?: string;
  pos: number;
  sb: number;
  khqr: number;
  mv: number;
  cc: number;
  activeStaff: number;
  activeBranches?: number;
  isFuture?: boolean;
}

export type VelocityChannelKey = 'ALL' | 'pos' | 'sb' | 'khqr' | 'mv' | 'cc';

interface CrossChannelVelocityChartProps {
  items: CrossChannelDayPoint[];
  focusChannel?: VelocityChannelKey;
  height?: number;
  theme?: ThemeMode;
  ariaLabel?: string;
}

export const CHANNEL_COLORS = {
  khqr: '#1e6091', // Baltic Blue
  sb: '#4F518C',   // Deep Purple (KPI Performance Sound Box)
  pos: '#184e77',  // Yale Blue
  mv: '#2d6a4f',   // Deep Forest Emerald
  cc: '#f59e0b',   // Amber / Yellow (KPI Performance Credit Card)
} as const;

const CHANNEL_SERIES = [
  { key: 'pos' as const, label: 'POS Terminal', color: CHANNEL_COLORS.pos },
  { key: 'sb' as const, label: 'Sound Box', color: CHANNEL_COLORS.sb },
  { key: 'khqr' as const, label: 'KHQR', color: CHANNEL_COLORS.khqr },
  { key: 'mv' as const, label: 'Merchant Visit', color: CHANNEL_COLORS.mv },
  { key: 'cc' as const, label: 'Credit Card', color: CHANNEL_COLORS.cc },
];

function hexToRgba(hex: string, alpha: number): string {
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return `rgba(30, 96, 145, ${alpha})`;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Monotonic cubic spline path builder preventing bezier overshoot on flat/zero segments. */
function traceMonotoneSpline(
  ctx: Ctx2D,
  pts: { x: number; y: number }[],
  minY: number,
  maxY: number
): void {
  if (pts.length === 0) return;
  const clampY = (y: number) => Math.max(minY, Math.min(maxY, y));
  const slopes = pts.map((_, i) => {
    if (pts.length === 1) return 0;
    if (i === 0) return (pts[1].y - pts[0].y) / Math.max(1, pts[1].x - pts[0].x);
    if (i === pts.length - 1) return (pts[i].y - pts[i - 1].y) / Math.max(1, pts[i].x - pts[i - 1].x);
    const sPrev = (pts[i].y - pts[i - 1].y) / Math.max(1, pts[i].x - pts[i - 1].x);
    const sNext = (pts[i + 1].y - pts[i].y) / Math.max(1, pts[i + 1].x - pts[i].x);
    if (sPrev * sNext <= 0) return 0;
    return (sPrev + sNext) / 2;
  });

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = (pts[i + 1].x - pts[i].x) / 3;
    const cp1y = clampY(pts[i].y + slopes[i] * dx);
    const cp2y = clampY(pts[i + 1].y - slopes[i + 1] * dx);
    ctx.bezierCurveTo(pts[i].x + dx, cp1y, pts[i + 1].x - dx, cp2y, pts[i + 1].x, pts[i + 1].y);
  }
}

/**
 * Lightweight Canvas smooth gradient-area spline + dashed Active Staff curve (Style 1 + Style 5).
 * Renders without pulling heavy Recharts bundles onto sign-in views.
 */
export const CrossChannelVelocityChart: React.FC<CrossChannelVelocityChartProps> = React.memo(({
  items,
  focusChannel = 'ALL',
  height = 250,
  theme = 'light',
  ariaLabel,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [hover, setHover] = useState<{ idx: number; x: number } | null>(null);
  const geomRef = useRef<{ padLeft: number; groupW: number; count: number } | null>(null);
  const hoverRafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!parent) return;

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver((entries) => {
        const w = Math.round(entries[entries.length - 1]?.contentRect.width || 0);
        if (w > 0) setContainerWidth((prev) => (prev === w ? prev : w));
      });
      observer.observe(parent);
    } else {
      if (parent.clientWidth > 0) setContainerWidth(parent.clientWidth);
      const onResize = () => { if (parent.clientWidth > 0) setContainerWidth(parent.clientWidth); };
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }

    return () => {
      observer?.disconnect();
      if (hoverRafRef.current !== null) cancelAnimationFrame(hoverRafRef.current);
    };
  }, []);

  const primarySeriesMeta = useMemo(() => {
    if (focusChannel === 'ALL') {
      return {
        label: 'All 5 Channels',
        color: theme === 'dark' ? '#38bdf8' : CHANNEL_COLORS.khqr,
        getVal: (d: CrossChannelDayPoint) => d.pos + d.sb + d.khqr + d.mv + d.cc,
      };
    }
    const found = CHANNEL_SERIES.find((s) => s.key === focusChannel)!;
    return {
      label: found.label,
      color: found.color,
      getVal: (d: CrossChannelDayPoint) => d[focusChannel],
    };
  }, [focusChannel, theme]);

  const dataKey = useMemo(() => JSON.stringify([items, focusChannel]), [items, focusChannel]);
  const hasData = useMemo(
    () => items.some((d) => primarySeriesMeta.getVal(d) + d.activeStaff > 0),
    [items, primarySeriesMeta]
  );
  const chartScales = useMemo(() => {
    const maxTasks = Math.max(4, ...items.map((d) => primarySeriesMeta.getVal(d)));
    const maxStaff = Math.max(4, ...items.map((d) => d.activeStaff));
    return {
      taskScale: niceScale(maxTasks, 4),
      staffScale: niceScale(maxStaff, 4),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);

  const summary = useMemo(() => {
    if (ariaLabel) return ariaLabel;
    if (!items.length || !hasData) return 'Cross-channel velocity chart. No data for this period.';
    return `Cross-channel velocity across ${items.length} periods.`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ariaLabel, dataKey, hasData]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;

    const dpr = window.devicePixelRatio || 1;
    const width = containerWidth || parent.clientWidth || 560;
    const targetW = Math.round(width * dpr);
    const targetH = Math.round(height * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const isLight = theme === 'light';
    const gridColor = isLight ? 'rgba(148, 163, 184, 0.18)' : 'rgba(255,255,255,0.08)';
    const axisColor = isLight ? '#64748b' : '#94a3b8';
    const rightAxisColor = isLight ? '#4F518C' : '#a2a5e0';
    const primaryStroke = primarySeriesMeta.color;
    const staffStroke = isLight ? CHANNEL_COLORS.sb : '#a2a5e0';
    const dotFill = isLight ? '#ffffff' : '#0f172a';
    const chartFont = '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, sans-serif';

    const padLeft = 38;
    const padRight = 32;
    const padTop = 26;
    const padBottom = 26;
    const plotW = Math.max(120, width - padLeft - padRight);
    const plotH = Math.max(80, height - padTop - padBottom);
    const baseY = padTop + plotH;

    const { taskScale, staffScale } = chartScales;

    // Horizontal dashed grid + Left/Right axes
    ctx.font = `600 10.5px ${chartFont}`;
    ctx.lineWidth = 1;
    for (let i = 0; i <= taskScale.steps; i++) {
      const ratio = i / taskScale.steps;
      const y = baseY - ratio * plotH;
      ctx.save();
      ctx.strokeStyle = i === 0 ? (isLight ? '#cbd5e1' : 'rgba(255,255,255,0.16)') : gridColor;
      if (i > 0) ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
      ctx.restore();

      const lv = Math.round(i * taskScale.step);
      const ls = lv >= 1000 ? `${(lv / 1000).toFixed(lv % 1000 === 0 ? 0 : 1)}k` : String(lv);
      ctx.fillStyle = axisColor;
      ctx.fillText(ls, Math.max(2, padLeft - 7 - ctx.measureText(ls).width), y + 3);

      const rv = Math.round(ratio * staffScale.max);
      ctx.fillStyle = rightAxisColor;
      ctx.fillText(String(rv), width - padRight + 6, y + 3);
    }

    const count = Math.max(1, items.length);
    const groupW = plotW / count;
    geomRef.current = { padLeft, groupW, count: items.length };
    const xLabelFontPx = groupW >= 40 ? 10 : groupW >= 20 ? 9.5 : 9;
    ctx.font = `600 ${xLabelFontPx}px ${chartFont}`;
    const maxLabelW = items.reduce((mx, it) => Math.max(mx, ctx.measureText(it.label).width), 0);
    const labelStep =
      maxLabelW + 5 <= groupW
        ? 1
        : Math.max(2, Math.ceil((maxLabelW + 8) / Math.max(1, groupW)));

    // Subtle hover focus column wash & vertical dashed crosshair
    if (hover && items[hover.idx]) {
      const bandW = Math.max(14, Math.min(44, groupW * 0.85));
      const hx = padLeft + hover.idx * groupW + groupW / 2;
      ctx.save();
      ctx.fillStyle = hexToRgba(primaryStroke, isLight ? 0.065 : 0.11);
      roundRectPath(ctx, hx - bandW / 2, padTop - 4, bandW, plotH + 8, 8);
      ctx.fill();
      ctx.strokeStyle = isLight ? 'rgba(100, 116, 139, 0.55)' : 'rgba(226, 232, 240, 0.48)';
      ctx.lineWidth = 1.1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hx, padTop);
      ctx.lineTo(hx, baseY);
      ctx.stroke();
      ctx.restore();
    }

    // X-axis date labels + faint baseline anchor dots on upcoming days
    items.forEach((item, idx) => {
      const cx = padLeft + idx * groupW + groupW / 2;
      if (item.isFuture) {
        ctx.save();
        ctx.fillStyle = isLight ? 'rgba(148, 163, 184, 0.35)' : 'rgba(148, 163, 184, 0.25)';
        ctx.beginPath();
        ctx.arc(cx, baseY, 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      const lastIdx = items.length - 1;
      const isLast = idx === lastIdx;
      const collidesWithLast = !isLast && (lastIdx - idx) * groupW < maxLabelW + 6;
      if ((idx % labelStep === 0 && !collidesWithLast) || isLast) {
        ctx.fillStyle = hover?.idx === idx ? (isLight ? '#0f172a' : '#ffffff') : axisColor;
        ctx.font = `${hover?.idx === idx ? '700' : '600'} ${xLabelFontPx}px ${chartFont}`;
        const tw = ctx.measureText(item.label).width;
        const lx = Math.min(width - padRight - tw, Math.max(padLeft, cx - tw / 2));
        ctx.fillText(item.label, lx, height - 7);
      }
    });

    // Slice to latest non-future day so curves stop cleanly at today
    const activeEndCount = items.reduce((last, d, i) => (!d.isFuture ? i + 1 : last), 0);
    const activeItems = items.slice(0, activeEndCount);

    // 1. Primary Series: Smooth Gradient Area Spline (Style 1 + Style 5)
    let peakIdx = -1;
    let peakTotal = 0;
    let peakY = baseY;
    const primaryPts = activeItems.map((item, idx) => {
      const val = primarySeriesMeta.getVal(item);
      const x = padLeft + idx * groupW + groupW / 2;
      const y = baseY - (val / taskScale.max) * plotH;
      if (val > peakTotal) {
        peakTotal = val;
        peakIdx = idx;
        peakY = y;
      }
      return { x, y, val };
    });

    if (primaryPts.length > 0 && primaryPts.some((p) => p.val > 0)) {
      // Soft vertical linear gradient fill under curve
      ctx.save();
      traceMonotoneSpline(ctx, primaryPts, padTop, baseY);
      ctx.lineTo(primaryPts[primaryPts.length - 1].x, baseY);
      ctx.lineTo(primaryPts[0].x, baseY);
      ctx.closePath();
      const areaGrad = ctx.createLinearGradient(0, padTop, 0, baseY);
      areaGrad.addColorStop(0, hexToRgba(primaryStroke, isLight ? 0.28 : 0.34));
      areaGrad.addColorStop(0.65, hexToRgba(primaryStroke, isLight ? 0.08 : 0.12));
      areaGrad.addColorStop(1, hexToRgba(primaryStroke, 0));
      ctx.fillStyle = areaGrad;
      ctx.fill();
      ctx.restore();

      // Luminous smooth primary spline
      ctx.save();
      ctx.strokeStyle = primaryStroke;
      ctx.lineWidth = 2.6;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.shadowColor = hexToRgba(primaryStroke, isLight ? 0.25 : 0.45);
      ctx.shadowBlur = 8;
      traceMonotoneSpline(ctx, primaryPts, padTop, baseY);
      ctx.stroke();
      ctx.restore();
    }

    // 2. Secondary Series: Dashed Smooth Active Staff Trendline
    const staffPts = activeItems.map((item, idx) => ({
      x: padLeft + idx * groupW + groupW / 2,
      y: baseY - (item.activeStaff / staffScale.max) * plotH,
      val: item.activeStaff,
    }));

    if (staffPts.length > 0 && staffPts.some((p) => p.val > 0)) {
      ctx.save();
      traceMonotoneSpline(ctx, staffPts, padTop, baseY);
      ctx.lineTo(staffPts[staffPts.length - 1].x, baseY);
      ctx.lineTo(staffPts[0].x, baseY);
      ctx.closePath();
      const staffGrad = ctx.createLinearGradient(0, padTop, 0, baseY);
      staffGrad.addColorStop(0, hexToRgba(staffStroke, isLight ? 0.07 : 0.10));
      staffGrad.addColorStop(1, hexToRgba(staffStroke, 0));
      ctx.fillStyle = staffGrad;
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = staffStroke;
      ctx.lineWidth = 2.1;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.setLineDash([5, 4]);
      traceMonotoneSpline(ctx, staffPts, padTop, baseY);
      ctx.stroke();
      ctx.restore();
    }

    // 3. Hollow Circular Data Nodes (drawn after both splines so nodes stay crisp)
    staffPts.forEach((pt, idx) => {
      const isHov = hover?.idx === idx;
      if (pt.val === 0 && !isHov) return;
      if (pt.val > 0 && primaryPts[idx]?.val > 0 && Math.abs(pt.y - primaryPts[idx].y) < 10 && !isHov) return;
      ctx.save();
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, isHov ? 4.2 : 2.6, 0, Math.PI * 2);
      ctx.fillStyle = isHov ? staffStroke : dotFill;
      ctx.fill();
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = isHov ? dotFill : staffStroke;
      ctx.stroke();
      ctx.restore();
    });

    primaryPts.forEach((pt, idx) => {
      const isHov = hover?.idx === idx;
      const isPeak = idx === peakIdx && peakTotal > 0;
      if (pt.val === 0 && !isHov) return;
      if (isHov) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 8, 0, Math.PI * 2);
        ctx.fillStyle = hexToRgba(primaryStroke, 0.22);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4.6, 0, Math.PI * 2);
        ctx.fillStyle = primaryStroke;
        ctx.fill();
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.save();
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, isPeak ? 4 : 3, 0, Math.PI * 2);
        ctx.fillStyle = dotFill;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = primaryStroke;
        ctx.stroke();
        ctx.restore();
      }
    });

    // Peak callout pill cleanly anchored above peak node when idle
    if (peakIdx >= 0 && peakTotal > 0 && hover === null) {
      const px = padLeft + peakIdx * groupW + groupW / 2;
      const label = fmt(peakTotal);
      ctx.font = `700 10px ${chartFont}`;
      const tw = ctx.measureText(label).width;
      const bw = tw + 12;
      const bh = 18;
      const bx = Math.min(width - padRight - bw, Math.max(padLeft, px - bw / 2));
      const by = Math.max(2, peakY - bh - 7);
      ctx.save();
      ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.96)' : 'rgba(15, 23, 42, 0.92)';
      ctx.strokeStyle = hexToRgba(primaryStroke, 0.35);
      ctx.lineWidth = 1;
      roundRectPath(ctx, bx, by, bw, bh, 9);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = isLight ? '#0f172a' : '#f8fafc';
      ctx.fillText(label, bx + 6, by + 12.5);
      ctx.restore();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, height, theme, containerWidth, hover, primarySeriesMeta]);

  const hoverItem = hover && items[hover.idx] ? items[hover.idx] : null;
  const hoverTotal = hoverItem
    ? hoverItem.pos + hoverItem.sb + hoverItem.khqr + hoverItem.mv + hoverItem.cc
    : 0;
  const hoverHeadlineVal = hoverItem ? primarySeriesMeta.getVal(hoverItem) : 0;

  return (
    <div className="relative w-full" style={{ height }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={summary}
        className="w-full h-full block cursor-crosshair"
        onPointerMove={(e) => {
          const g = geomRef.current;
          if (!g || !g.count) return;
          const r = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - r.left;
          const idx = Math.floor((x - g.padLeft) / g.groupW);
          if (hoverRafRef.current !== null) cancelAnimationFrame(hoverRafRef.current);
          hoverRafRef.current = requestAnimationFrame(() => {
            hoverRafRef.current = null;
            if (idx < 0 || idx >= g.count) {
              setHover((prev) => (prev ? null : prev));
              return;
            }
            const nextX = g.padLeft + (idx + 0.5) * g.groupW;
            setHover((prev) => (prev && prev.idx === idx ? prev : { idx, x: nextX }));
          });
        }}
        onPointerLeave={() => {
          if (hoverRafRef.current !== null) {
            cancelAnimationFrame(hoverRafRef.current);
            hoverRafRef.current = null;
          }
          setHover(null);
        }}
      >
        {summary}
      </canvas>
      {hover && hoverItem && hasData && (
        <div
          className="absolute top-2.5 pointer-events-none z-20 rounded-xl border border-slate-700/80 bg-[#0f172a]/95 backdrop-blur-md shadow-[0_12px_32px_rgba(15,23,42,0.38)] px-3.5 py-2.5 text-[11px] text-slate-200 whitespace-nowrap min-w-[205px]"
          style={{
            left: hover.x,
            transform: `translateX(${hover.x > (containerWidth || 0) * 0.52 ? 'calc(-100% - 12px)' : '12px'})`,
          }}
          role="status"
        >
          <div className="flex items-baseline justify-between gap-4 pb-1.5 mb-1.5 border-b border-slate-700/70">
            <span className="text-[10.5px] font-semibold text-slate-400">
              {hoverItem.fullLabel || hoverItem.label}
            </span>
            <span className="font-figure font-bold text-sm text-white">
              {fmt(hoverHeadlineVal)} tasks
            </span>
          </div>
          <div className="space-y-0.5">
            {CHANNEL_SERIES.map((s) =>
              hoverItem[s.key] > 0 ? (
                <div key={s.key} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-slate-300">
                    <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                    {s.label}
                  </span>
                  <strong className="font-figure text-white">{fmt(hoverItem[s.key])}</strong>
                </div>
              ) : null
            )}
          </div>
          <div className="flex items-center justify-between gap-3 pt-1.5 mt-1.5 border-t border-slate-700/70 text-[10.5px] text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 border-t-[2px] border-dashed border-[#a2a5e0] inline-block" />
              {hoverItem.isFuture && hoverTotal === 0 && hoverItem.activeStaff === 0
                ? 'Upcoming day'
                : `${fmt(hoverItem.activeStaff)} staff${hoverItem.activeBranches ? ` · ${hoverItem.activeBranches} branches` : ''}`}
            </span>
            {hoverItem.activeStaff > 0 && (
              <span className="font-figure font-semibold text-sky-300">
                {(hoverTotal / hoverItem.activeStaff).toFixed(1)}/staff
              </span>
            )}
          </div>
        </div>
      )}
      {!hasData && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden="true">
          <span className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/90 text-slate-500 border border-slate-200/80">
            No activity recorded for this period
          </span>
        </div>
      )}
    </div>
  );
});

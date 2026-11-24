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
  showLegend?: boolean;
  /** Overlay a month-to-month % change trend line on a secondary right % axis with +/- pill callouts. */
  showMomChangeLine?: boolean;
  /** Optional month immediately preceding labels[0] so the leftmost visible bar can also show true MoM %. */
  priorSeries1Value?: number;
  priorSeries2Value?: number;
  momLineLabel?: string;
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

interface MomDelta {
  pct: number | null;
  isBaseline: boolean;
  text: string;
}

function calcMomDelta(cur: number, prev: number | undefined): MomDelta {
  if (prev === undefined || prev <= 0) {
    return { pct: null, isBaseline: prev !== undefined && cur > 0, text: '' };
  }
  const pct = ((cur - prev) / prev) * 100;
  const rounded = Math.abs(pct) > 0 && Math.abs(pct) < 10 ? Number(pct.toFixed(1)) : Math.round(pct);
  const text = rounded > 0 ? `+${fmt(rounded)}%` : rounded < 0 ? `-${fmt(Math.abs(rounded))}%` : '0%';
  return { pct, isBaseline: false, text };
}

interface BoxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectsOverlap(a: BoxRect, b: BoxRect, pad = 2): boolean {
  return !(
    a.x + a.w + pad <= b.x ||
    b.x + b.w + pad <= a.x ||
    a.y + a.h + pad <= b.y ||
    b.y + b.h + pad <= a.y
  );
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
  showLegend = true,
  showMomChangeLine = false,
  priorSeries1Value,
  priorSeries2Value,
  momLineLabel = 'MoM Change %',
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
    let resizeTimer = 0;
    let first = true;
    if (typeof ResizeObserver !== 'undefined') {
      // (13 Nov 2026, speed) the observer reports the first size itself, after the browser's own layout: reading clientWidth
      // here forced an extra layout of the whole page in the middle of drawing it (~100 ms on a slower laptop at sign-in)
      observer = new ResizeObserver((entries) => {
        const w = Math.round(entries[entries.length - 1]?.contentRect.width || 0);
        if (w <= 0) return;
        if (first) {
          first = false;
          setContainerWidth((prev) => (prev === w ? prev : w));
          return;
        }
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => setContainerWidth((prev) => (prev === w ? prev : w)), 180);
      });
      observer.observe(parent);
    } else {
      updateWidth();
      window.addEventListener('resize', updateWidth);
    }

    return () => {
      observer?.disconnect();
      window.clearTimeout(resizeTimer);
      window.removeEventListener('resize', updateWidth);
      if (hoverRafRef.current !== null) cancelAnimationFrame(hoverRafRef.current);
    };
  }, []);

  // Redraw only when the values change, not when a parent passes a new array with the same values.
  const dataKey = useMemo(
    () => JSON.stringify([labels, series1Data, series2Data, priorSeries1Value ?? null, priorSeries2Value ?? null]),
    [labels, series1Data, series2Data, priorSeries1Value, priorSeries2Value]
  );
  const hasData = useMemo(
    () => series1Data.some((v) => v > 0) || series2Data.some((v) => v > 0),
    [series1Data, series2Data]
  );
  const chartStats = useMemo(() => {
    const scale = niceScale(Math.max(4, ...series1Data, ...series2Data));
    const max1 = Math.max(...series1Data, 0);
    const max2 = Math.max(...series2Data, 0);
    const momPoints = labels.map((_, idx) => {
      const v1 = series1Data[idx] || 0;
      const v2 = series2Data[idx] || 0;
      const p1 = idx === 0 ? priorSeries1Value : series1Data[idx - 1] || 0;
      const p2 = idx === 0 ? priorSeries2Value : series2Data[idx - 1] || 0;
      return {
        s1: calcMomDelta(v1, p1),
        s2: calcMomDelta(v2, p2),
      };
    });
    let maxGainIdx = -1;
    let maxDropIdx = -1;
    let maxGainVal = -Infinity;
    let maxDropVal = Infinity;
    momPoints.forEach((m, i) => {
      for (const d of [m.s1, m.s2]) {
        if (d.pct === null) continue;
        if (d.pct > 0 && d.pct > maxGainVal) {
          maxGainVal = d.pct;
          maxGainIdx = i;
        }
        if (d.pct < 0 && d.pct < maxDropVal) {
          maxDropVal = d.pct;
          maxDropIdx = i;
        }
      }
    });
    return {
      scale,
      momPoints,
      maxGainIdx,
      maxDropIdx,
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
    const gridLineColor = isLight ? 'rgba(148, 163, 184, 0.22)' : 'rgba(255, 255, 255, 0.08)';
    const baseLineColor = isLight ? '#cbd5e1' : 'rgba(255, 255, 255, 0.16)';
    const axisTextColor = isLight ? '#64748b' : '#94a3b8';
    const valueTextColor = isLight ? '#0f172a' : '#f8fafc';
    const labelTextColor = isLight ? '#475569' : '#cbd5e1';
    const chartFont = '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, sans-serif';

    if (showLegend) {
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
    }

    const { scale, momPoints, maxGainIdx, maxDropIdx, firstMax1, firstMax2 } = chartStats;
    const maxVal = scale.max;
    const steps = scale.steps;
    const hasMomOverlay =
      showMomChangeLine &&
      hasData &&
      momPoints.some((m) => m.s1.pct !== null || m.s2.pct !== null);
    const s1LineColor = isLight ? '#4b5563' : '#94a3b8';
    const s2LineColor = isLight ? '#374151' : '#cbd5e1';

    ctx.font = `600 10.5px ${chartFont}`;
    const maxAxisW = ctx.measureText(fmt(maxVal)).width;
    const padLeft = Math.max(36, Math.ceil(maxAxisW + 12));
    const padRight = hasMomOverlay ? Math.max(44, padLeft) : 14;
    const padTop = showLegend ? 40 : hasMomOverlay ? 36 : 22;
    const padBottom = 28;
    const plotW = Math.max(100, width - padLeft - padRight);
    const plotH = Math.max(80, height - padTop - padBottom);
    const baseY = padTop + plotH;

    ctx.lineWidth = 1;
    ctx.font = `600 10.5px ${chartFont}`;

    for (let i = 0; i <= steps; i++) {
      const y = baseY - (i / steps) * plotH;
      const val = Math.round(i * scale.step);
      ctx.save();
      ctx.strokeStyle = i === 0 ? baseLineColor : gridLineColor;
      if (i > 0) ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = axisTextColor;
      const vs = fmt(val);
      ctx.fillText(vs, Math.max(2, padLeft - 7 - ctx.measureText(vs).width), y + 3);
    }

    const groupCount = Math.max(1, labels.length);
    const groupW = plotW / groupCount;
    geomRef.current = { padLeft, groupW, count: labels.length };
    const lastIdx = labels.length - 1;
    const barGap = groupW >= 64 ? 6 : 4;
    const barW = Math.min(28, Math.max(8, (groupW - (groupW >= 64 ? 22 : 12) - barGap) / 2));

    // Subtle hover focus column wash behind the active month
    if (hover && labels[hover.idx] !== undefined) {
      const bandW = Math.max(24, Math.min(groupW - 4, barW * 2 + barGap + 18));
      const cx = padLeft + (hover.idx + 0.5) * groupW;
      ctx.save();
      ctx.fillStyle = isLight ? 'rgba(21, 84, 132, 0.055)' : 'rgba(56, 189, 248, 0.085)';
      roundRectPath(ctx, cx - bandW / 2, padTop - 4, bandW, plotH + 6, 8);
      ctx.fill();
      ctx.restore();
    }

    // Check if showing values above every bar fits cleanly without overlapping adjacent bars
    ctx.font = `600 10px ${chartFont}`;
    const allLabelsFit = labels.every((_, idx) => {
      const w1 = (series1Data[idx] || 0) > 0 ? ctx.measureText(fmt(series1Data[idx] || 0)).width : 0;
      const w2 = (series2Data[idx] || 0) > 0 ? ctx.measureText(fmt(series2Data[idx] || 0)).width : 0;
      const bothPresent = w1 > 0 && w2 > 0;
      return w1 <= barW + 10 && w2 <= barW + 10 && (!bothPresent || w1 + w2 + 8 <= groupW - 4);
    });

    const occupiedLabelRects: BoxRect[] = [];
    const barRects: BoxRect[] = [];
    const groupGeom: Array<{ gx: number; y1: number; y2: number; h1: number; h2: number }> = [];

    labels.forEach((lbl, idx) => {
      const isHovered = hover?.idx === idx;
      const gx = padLeft + idx * groupW + (groupW - barW * 2 - barGap) / 2;
      const v1 = series1Data[idx] || 0;
      const v2 = series2Data[idx] || 0;
      const h1 = (v1 / maxVal) * plotH;
      const h2 = (v2 / maxVal) * plotH;
      const y1 = baseY - h1;
      const y2 = baseY - h2;
      groupGeom.push({ gx, y1, y2, h1, h2 });

      // Bar 1 (with crisp vertical gradient)
      if (h1 > 0) {
        const g1 = ctx.createLinearGradient(0, y1, 0, baseY);
        g1.addColorStop(0, series1Color);
        g1.addColorStop(1, hexToRgba(series1Color, isLight ? 0.72 : 0.65));
        ctx.fillStyle = g1;
        roundRectPath(ctx, gx, y1, barW, h1, [5, 5, 0, 0]);
        ctx.fill();
        barRects.push({ x: gx, y: y1, w: barW, h: h1 });
      }

      // Bar 2 (with crisp vertical gradient)
      if (h2 > 0) {
        const g2 = ctx.createLinearGradient(0, y2, 0, baseY);
        g2.addColorStop(0, series2Color);
        g2.addColorStop(1, hexToRgba(series2Color, isLight ? 0.72 : 0.65));
        ctx.fillStyle = g2;
        roundRectPath(ctx, gx + barW + barGap, y2, barW, h2, [5, 5, 0, 0]);
        ctx.fill();
        barRects.push({ x: gx + barW + barGap, y: y2, w: barW, h: h2 });
      }

      // Value annotations: all bars when they fit cleanly, otherwise hovered/latest/peak bars
      ctx.font = `${isHovered ? '700' : '600'} 10px ${chartFont}`;
      const showV1 = v1 > 0 && (allLabelsFit || isHovered || idx === lastIdx || idx === firstMax1);
      const showV2 = v2 > 0 && (allLabelsFit || isHovered || idx === lastIdx || idx === firstMax2);
      if (showV1) {
        ctx.fillStyle = isHovered ? series1Color : valueTextColor;
        const s1 = fmt(v1);
        const tw1 = ctx.measureText(s1).width;
        const lx = gx + (barW - tw1) / 2;
        const ly = Math.max(12, baseY - h1 - (hasMomOverlay ? 8 : 5));
        ctx.fillText(s1, lx, ly);
        occupiedLabelRects.push({ x: lx - 2, y: ly - 10, w: tw1 + 4, h: 12 });
      }
      if (showV2) {
        ctx.fillStyle = isHovered ? series2Color : valueTextColor;
        const s2 = fmt(v2);
        const tw2 = ctx.measureText(s2).width;
        const x2Center = gx + barW + barGap + (barW - tw2) / 2;
        const tw1 = ctx.measureText(fmt(v1)).width;
        const baseOff = hasMomOverlay ? 8 : 5;
        const yOffset = showV1 && Math.abs(h1 - h2) < 12 && tw1 + tw2 > barW * 2 + barGap ? 14 : baseOff;
        const ly = Math.max(12, baseY - h2 - yOffset);
        ctx.fillText(s2, x2Center, ly);
        occupiedLabelRects.push({ x: x2Center - 2, y: ly - 10, w: tw2 + 4, h: 12 });
      }

      // X-axis label
      ctx.fillStyle = isHovered ? (isLight ? '#0f172a' : '#ffffff') : labelTextColor;
      ctx.font = `${isHovered ? '700' : '600'} 10.5px ${chartFont}`;
      const shortLbl = lbl.length > 11 ? lbl.slice(0, 10) + '…' : lbl;
      const tw = ctx.measureText(shortLbl).width;
      ctx.fillText(shortLbl, padLeft + idx * groupW + (groupW - tw) / 2, height - 8);
    });

    // Dual Separate Bar-Top-to-Bar-Top Curves with MoM % labels placed cleanly outside the bars
    if (hasMomOverlay) {
      const haloStroke = isLight ? 'rgba(255, 255, 255, 0.94)' : 'rgba(15, 23, 42, 0.94)';

      interface TrendNode {
        seriesIdx: 1 | 2;
        lineColor: string;
        idx: number;
        x: number;
        y: number;
        pct: number | null;
        isBaseline: boolean;
        text: string;
      }

      const s1HasCurve = momPoints.some((m) => m.s1.pct !== null);
      const s2HasCurve = momPoints.some((m) => m.s2.pct !== null);
      const bothCurvesActive = s1HasCurve && s2HasCurve;

      const seriesSpecs: Array<{ seriesIdx: 1 | 2; lineColor: string; dashed: boolean; pick: (m: (typeof momPoints)[number]) => MomDelta }> = [
        { seriesIdx: 1, lineColor: s1LineColor, dashed: true, pick: (m) => m.s1 },
        { seriesIdx: 2, lineColor: s2LineColor, dashed: !bothCurvesActive, pick: (m) => m.s2 },
      ];

      const allNodes: TrendNode[] = [];

      seriesSpecs.forEach(({ seriesIdx, lineColor, dashed, pick }) => {
        const nodes: TrendNode[] = momPoints.map((m, idx) => {
          const d = pick(m);
          const g = groupGeom[idx] || { gx: padLeft, y1: baseY, y2: baseY, h1: 0, h2: 0 };
          const cx = seriesIdx === 1 ? g.gx + barW / 2 : g.gx + barW + barGap + barW / 2;
          const barTopY = seriesIdx === 1 ? g.y1 : g.y2;
          if (d.pct !== null) {
            return { seriesIdx, lineColor, idx, x: cx, y: barTopY, pct: d.pct, isBaseline: false, text: d.text };
          }
          if (d.isBaseline) {
            return { seriesIdx, lineColor, idx, x: cx, y: barTopY, pct: null, isBaseline: true, text: '' };
          }
          return { seriesIdx, lineColor, idx, x: cx, y: baseY, pct: null, isBaseline: false, text: '' };
        });

        const runs: TrendNode[][] = [];
        let curRun: TrendNode[] = [];
        nodes.forEach((n) => {
          if (n.pct !== null) {
            // Link directly from the preceding bar's top rim into this bar's top rim
            if (curRun.length === 0 && n.idx > 0 && nodes[n.idx - 1].isBaseline) {
              curRun.push(nodes[n.idx - 1]);
            }
            curRun.push(n);
          } else if (curRun.length > 0) {
            runs.push(curRun);
            curRun = [];
          }
        });
        if (curRun.length > 0) runs.push(curRun);

        const linkedIndices = new Set<number>();
        runs.forEach((run) => {
          if (run.length < 2) return;
          run.forEach((rn) => linkedIndices.add(rn.idx));
          for (let i = 1; i < run.length; i++) {
            const prev = run[i - 1];
            const curr = run[i];
            const midX = (prev.x + curr.x) / 2;

            // Crisp halo stroke so thin charcoal hairline stays readable over dark bar fills
            ctx.save();
            ctx.strokeStyle = haloStroke;
            ctx.lineWidth = 3.4;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            if (dashed) ctx.setLineDash([4, 3.5]);
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.bezierCurveTo(midX, prev.y, midX, curr.y, curr.x, curr.y);
            ctx.stroke();
            ctx.restore();

            ctx.save();
            ctx.strokeStyle = lineColor;
            ctx.lineWidth = 1.6;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            if (dashed) ctx.setLineDash([4, 3.5]);
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.bezierCurveTo(midX, prev.y, midX, curr.y, curr.x, curr.y);
            ctx.stroke();
            ctx.restore();
          }
        });

        nodes.forEach((n) => {
          if (n.pct === null && !linkedIndices.has(n.idx)) return;
          const isHov = hover?.idx === n.idx;
          const dotColor =
            n.pct === null || n.pct === 0
              ? lineColor
              : n.pct > 0
                ? isLight ? '#059669' : '#34d399'
                : isLight ? '#e11d48' : '#fb7185';
          const r = n.pct === null ? 2.8 : isHov ? 4.5 : 3.5;
          ctx.save();
          ctx.fillStyle = dotColor;
          ctx.strokeStyle = haloStroke;
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
          allNodes.push(n);
        });
      });

      const priorityOrder = allNodes
        .filter((n) => n.text)
        .sort((a, b) => {
          const rank = (n: TrendNode) =>
            (hover?.idx === n.idx ? 1000 : 0) +
            (n.idx === lastIdx ? 400 : 0) +
            (n.idx === maxGainIdx ? 200 : 0) +
            (n.idx === maxDropIdx ? 150 : 0) +
            (n.pct !== null ? 50 : 10) +
            n.seriesIdx * 2 +
            n.idx;
          return rank(b) - rank(a);
        });

      const dotRects: BoxRect[] = allNodes.map((dn) => ({ x: dn.x - 5, y: dn.y - 5, w: 10, h: 10 }));
      const placedLabels: BoxRect[] = [];
      ctx.font = `700 10.5px ${chartFont}`;
      const labelH = 13;

      priorityOrder.forEach((n) => {
        const tw = ctx.measureText(n.text).width;
        const labelW = Math.ceil(tw + 2);
        const minX = padLeft + 2;
        const maxX = Math.max(minX, width - padRight - labelW - 2);

        const g = groupGeom[n.idx] || { gx: padLeft, y1: baseY, y2: baseY, h1: 0, h2: 0 };
        const ownLeft = n.seriesIdx === 1 ? g.gx : g.gx + barW + barGap;
        const ownRight = ownLeft + barW;
        const ownTop = n.seriesIdx === 1 ? g.y1 : g.y2;
        const barsLeft = g.gx;
        const barsRight = g.gx + barW * 2 + barGap;

        const dotY = Math.round(n.y - labelH / 2);
        const aboveOwnY1 = Math.round(ownTop - 21 - labelH);
        const aboveOwnY2 = Math.round(ownTop - 35 - labelH);
        const aboveGroupY1 = Math.round(Math.min(g.y1, g.y2) - 21 - labelH);
        const centerX = Math.round(n.x - labelW / 2);

        // Prioritize positions strictly OUTSIDE bar bodies and close to each bar
        const sideCandidates: Array<{ x: number; y: number }> =
          n.seriesIdx === 1
            ? [
                { x: Math.round(ownLeft - labelW - 6), y: dotY },
                { x: Math.round(barsRight + 6), y: dotY },
                { x: Math.round(ownLeft - labelW - 6), y: Math.round(ownTop - labelH / 2) },
                { x: centerX, y: aboveOwnY1 },
                // Shifted flush with bar1 right edge so wide labels clear taller bar2 beside it
                { x: Math.round(ownRight - labelW - 2), y: aboveOwnY1 },
                { x: Math.round(ownLeft - labelW - 6), y: dotY - 12 },
                { x: Math.round(ownLeft - labelW - 6), y: dotY + 12 },
                { x: Math.round(ownLeft - 2), y: aboveOwnY1 },
                { x: centerX, y: aboveOwnY2 },
                { x: Math.round(ownRight - labelW - 2), y: aboveOwnY2 },
                { x: centerX, y: aboveGroupY1 },
              ]
            : [
                { x: Math.round(ownRight + 6), y: dotY },
                { x: Math.round(ownLeft - labelW - 6), y: dotY },
                { x: Math.round(barsLeft - labelW - 6), y: dotY },
                { x: Math.round(ownRight + 6), y: Math.round(ownTop - labelH / 2) },
                { x: Math.round(ownLeft - labelW - 6), y: Math.round(ownTop - labelH / 2) },
                { x: centerX, y: aboveOwnY1 },
                // Shifted flush with bar2 left edge (+clearance) so wide labels clear taller bar1 beside it
                { x: Math.round(ownLeft + 2), y: aboveOwnY1 },
                { x: Math.round(ownRight + 6), y: dotY - 12 },
                { x: Math.round(ownRight + 6), y: dotY + 12 },
                { x: Math.round(barsRight - labelW + 2), y: aboveOwnY1 },
                { x: centerX, y: aboveOwnY2 },
                { x: Math.round(ownLeft + 2), y: aboveOwnY2 },
                { x: centerX, y: aboveGroupY1 },
              ];

        const fits = (cand: BoxRect, avoidBars: boolean): boolean => {
          if (cand.x < minX || cand.x > maxX || cand.y < 3 || cand.y + cand.h > baseY - 2) return false;
          if (placedLabels.some((r) => rectsOverlap(cand, r, 3))) return false;
          if (occupiedLabelRects.some((r) => rectsOverlap(cand, r, 2))) return false;
          if (dotRects.some((r) => rectsOverlap(cand, r, 2))) return false;
          if (avoidBars && barRects.some((r) => rectsOverlap(cand, r, 2))) return false;
          return true;
        };

        let chosenPos: { x: number; y: number } | null = null;
        for (const p of sideCandidates) {
          if (fits({ x: p.x, y: p.y, w: labelW, h: labelH }, true)) {
            chosenPos = p;
            break;
          }
        }
        // Dense 12M fallback if every outside-bar slot around tall adjacent bars is blocked
        if (!chosenPos) {
          const isDown = (n.pct ?? 0) < 0;
          const clampedX = Math.min(maxX, Math.max(minX, centerX));
          const fallbackCands = [
            { x: clampedX, y: aboveOwnY1 },
            { x: clampedX, y: Math.round(n.y + (isDown ? 8 : -(labelH + 7))) },
            { x: clampedX, y: Math.round(n.y + (isDown ? -(labelH + 7) : 8)) },
          ];
          for (const p of fallbackCands) {
            if (fits({ x: p.x, y: p.y, w: labelW, h: labelH }, false)) {
              chosenPos = p;
              break;
            }
          }
        }
        if (!chosenPos) return;

        placedLabels.push({ x: chosenPos.x, y: chosenPos.y, w: labelW, h: labelH });

        const isUp = (n.pct ?? 0) > 0;
        const isDown = (n.pct ?? 0) < 0;
        const txtColor = isUp
          ? isLight ? '#059669' : '#34d399'
          : isDown
            ? isLight ? '#e11d48' : '#fb7185'
            : isLight ? '#64748b' : '#94a3b8';

        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = haloStroke;
        ctx.strokeText(n.text, chosenPos.x + 1, chosenPos.y + 11);
        ctx.fillStyle = txtColor;
        ctx.fillText(n.text, chosenPos.x + 1, chosenPos.y + 11);
        ctx.restore();
      });
    }
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
    showLegend,
    showMomChangeLine,
    momLineLabel,
    hover,
    containerWidth,
  ]);

  const isLight = theme === 'light';

  return (
    <div className="relative w-full flex items-center justify-center" style={{ height: height + 5 }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={summary}
        className="w-full h-full block cursor-crosshair"
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
      {hover && hasData && labels[hover.idx] !== undefined && (() => {
        const m = chartStats.momPoints[hover.idx];
        const hasTooltipMom = Boolean(showMomChangeLine && (m?.s1.pct !== null || m?.s2.pct !== null));
        const deltaTextCls = (d?: MomDelta) => {
          if (!d || d.pct === null) return 'text-slate-400';
          if (d.pct > 0) return isLight ? 'text-emerald-600' : 'text-emerald-400';
          if (d.pct < 0) return isLight ? 'text-rose-600' : 'text-rose-400';
          return 'text-slate-400';
        };
        const v1 = series1Data[hover.idx] || 0;
        const v2 = series2Data[hover.idx] || 0;
        const t = v1 + v2;
        const s1Tag = /POS/i.test(series1Label) ? 'POS' : series1Label.split(' ')[0];
        const s2Tag = /Sound Box/i.test(series2Label) ? 'SB' : series2Label.split(' ')[0];

        return (
          <div
            className={`absolute top-2.5 pointer-events-none z-20 rounded-xl border backdrop-blur-md px-3 py-2 text-[11px] whitespace-nowrap min-w-[205px] ${
              isLight
                ? 'border-slate-200/90 bg-white/95 text-slate-700 shadow-[0_12px_32px_rgba(15,23,42,0.12)]'
                : 'border-slate-700/80 bg-[#0f172a]/95 text-slate-200 shadow-[0_12px_32px_rgba(15,23,42,0.38)]'
            }`}
            style={{ left: hover.x, transform: `translateX(${hover.x > (containerWidth || 0) * 0.52 ? `calc(-100% - ${showMomChangeLine ? 48 : 28}px)` : `${showMomChangeLine ? 48 : 28}px`})` }}
            role="status"
          >
            <div className={`flex items-center justify-between gap-3 font-bold pb-1 mb-1 border-b ${isLight ? 'border-slate-100 text-slate-900' : 'border-slate-700/70 text-white'}`}>
              <span>{labels[hover.idx]}</span>
              {hasTooltipMom && (
                <span className={`font-figure font-medium text-[10px] ${isLight ? 'text-slate-400' : 'text-slate-400'}`}>
                  MoM %
                </span>
              )}
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: series1Color }} />
                {series1Label}
              </span>
              <span className="inline-flex items-baseline gap-1.5 font-figure tabular-nums">
                <strong className={isLight ? 'text-slate-900' : 'text-white'}>{fmt(v1)}</strong>
                {showMomChangeLine && m?.s1.text && (
                  <span className={`text-[10px] font-semibold ${deltaTextCls(m.s1)}`}>
                    {m.s1.text}
                  </span>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4 mt-0.5">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: series2Color }} />
                {series2Label}
              </span>
              <span className="inline-flex items-baseline gap-1.5 font-figure tabular-nums">
                <strong className={isLight ? 'text-slate-900' : 'text-white'}>{fmt(v2)}</strong>
                {showMomChangeLine && m?.s2.text && (
                  <span className={`text-[10px] font-semibold ${deltaTextCls(m.s2)}`}>
                    {m.s2.text}
                  </span>
                )}
              </span>
            </div>
            {t > 0 && (
              <div className={`mt-1.5 pt-1 border-t flex items-center justify-between gap-3 text-[10.5px] font-figure ${
                isLight ? 'border-slate-100 text-slate-500' : 'border-slate-700/70 text-slate-400'
              }`}>
                <span>Total {fmt(t)}</span>
                <span>{s1Tag} {Math.round((v1 / t) * 100)}% · {s2Tag} {Math.round((v2 / t) * 100)}%</span>
              </div>
            )}
          </div>
        );
      })()}
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

/** Builds a clean SVG annular arc wedge between startRad and endRad radians. */
export function buildAnnularArcPath(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  startRad: number,
  endRad: number
): string {
  const largeArc = endRad - startRad > Math.PI ? 1 : 0;
  const c0 = Math.cos(startRad);
  const s0 = Math.sin(startRad);
  const c1 = Math.cos(endRad);
  const s1 = Math.sin(endRad);

  const x0Out = cx + rOuter * c0;
  const y0Out = cy + rOuter * s0;
  const x1Out = cx + rOuter * c1;
  const y1Out = cy + rOuter * s1;
  const x1In = cx + rInner * c1;
  const y1In = cy + rInner * s1;
  const x0In = cx + rInner * c0;
  const y0In = cy + rInner * s0;

  return [
    `M ${x0Out.toFixed(2)} ${y0Out.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x1Out.toFixed(2)} ${y1Out.toFixed(2)}`,
    `L ${x1In.toFixed(2)} ${y1In.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${x0In.toFixed(2)} ${y0In.toFixed(2)}`,
    'Z',
  ].join(' ');
}

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
  isWeekend?: boolean;
  holidayName?: string | null;
  dayOfWeek?: string;
}

export const VELOCITY_CALENDAR_COLORS = {
  weekendLight: '#64748b',
  weekendDark: '#94a3b8',
  holidayLight: '#d97706',
  holidayDark: '#fbbf24',
} as const;

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
    let resizeTimer = 0;
    let first = true;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver((entries) => {
        const w = Math.round(entries[entries.length - 1]?.contentRect.width || 0);
        if (w <= 0) return;
        if (first) {
          first = false;
          setContainerWidth((prev) => (prev === w ? prev : w));
          return;
        }
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => setContainerWidth((prev) => (prev === w ? prev : w)), 180);
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
      window.clearTimeout(resizeTimer);
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
    const weekendCount = items.filter((d) => d.isWeekend && !d.holidayName).length;
    const holidayCount = items.filter((d) => Boolean(d.holidayName)).length;
    const calSuffix =
      items.length > 1 && (weekendCount > 0 || holidayCount > 0)
        ? ` Includes ${weekendCount} weekend days and ${holidayCount} public holidays.`
        : '';
    return `Cross-channel velocity across ${items.length} periods.${calSuffix}`;
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

    const count = Math.max(1, items.length);
    const groupW = plotW / count;
    geomRef.current = { padLeft, groupW, count: items.length };

    // 0. Group contiguous Weekend & Cambodia Public Holiday bands (daily/multi-day series)
    type DayKind = 'work' | 'weekend' | 'holiday';
    const getDayKind = (d: CrossChannelDayPoint): DayKind =>
      d.holidayName ? 'holiday' : d.isWeekend ? 'weekend' : 'work';
    interface NonWorkBand {
      kind: 'weekend' | 'holiday';
      startIdx: number;
      endIdx: number;
      holidayName?: string | null;
      bx: number;
      bw: number;
    }
    const nonWorkBands: NonWorkBand[] = [];
    if (items.length > 1) {
      const bandInset = groupW >= 14 ? 1.5 : 0.75;
      let i = 0;
      while (i < items.length) {
        const kind = getDayKind(items[i]);
        if (kind === 'work') {
          i++;
          continue;
        }
        let j = i;
        while (j + 1 < items.length && getDayKind(items[j + 1]) === kind) {
          j++;
        }
        const bx = padLeft + i * groupW + bandInset;
        const bw = Math.max(4, (j - i + 1) * groupW - bandInset * 2);
        nonWorkBands.push({
          kind,
          startIdx: i,
          endIdx: j,
          holidayName: items[i].holidayName,
          bx,
          bw,
        });
        i = j + 1;
      }

      nonWorkBands.forEach((band) => {
        ctx.save();
        const colGrad = ctx.createLinearGradient(0, padTop, 0, baseY);
        if (band.kind === 'holiday') {
          colGrad.addColorStop(0, isLight ? 'rgba(245, 158, 11, 0.14)' : 'rgba(251, 191, 36, 0.17)');
          colGrad.addColorStop(1, isLight ? 'rgba(245, 158, 11, 0.04)' : 'rgba(251, 191, 36, 0.06)');
        } else {
          colGrad.addColorStop(0, isLight ? 'rgba(100, 116, 139, 0.095)' : 'rgba(148, 163, 184, 0.13)');
          colGrad.addColorStop(1, isLight ? 'rgba(100, 116, 139, 0.035)' : 'rgba(148, 163, 184, 0.045)');
        }
        roundRectPath(ctx, band.bx, padTop, band.bw, plotH, 4);
        ctx.fillStyle = colGrad;
        ctx.fill();

        if (band.kind === 'holiday') {
          ctx.setLineDash([2.5, 2.5]);
          ctx.strokeStyle = isLight ? 'rgba(217, 119, 6, 0.34)' : 'rgba(251, 191, 36, 0.36)';
          ctx.lineWidth = 1;
          ctx.stroke();
        } else {
          ctx.strokeStyle = isLight ? 'rgba(148, 163, 184, 0.22)' : 'rgba(148, 163, 184, 0.18)';
          ctx.lineWidth = 0.75;
          ctx.stroke();
        }

        // Crisp top accent bar distinguishing Holiday vs Weekend columns
        ctx.setLineDash([]);
        roundRectPath(
          ctx,
          band.bx + 0.5,
          padTop,
          Math.max(2, band.bw - 1),
          band.kind === 'holiday' ? 2.5 : 2,
          1.25
        );
        ctx.fillStyle =
          band.kind === 'holiday'
            ? isLight
              ? 'rgba(217, 119, 6, 0.85)'
              : 'rgba(251, 191, 36, 0.88)'
            : isLight
            ? 'rgba(100, 116, 139, 0.45)'
            : 'rgba(148, 163, 184, 0.50)';
        ctx.fill();
        ctx.restore();
      });
    }

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

    const xLabelFontPx = groupW >= 40 ? 10 : groupW >= 20 ? 9.5 : 9;
    ctx.font = `600 ${xLabelFontPx}px ${chartFont}`;
    const getCleanDateLabel = (raw: string) => raw.replace(/^[A-Za-z]{3,}\s+/, '');
    const maxLabelW = items.reduce((mx, it) => Math.max(mx, ctx.measureText(getCleanDateLabel(it.label)).width), 0);
    const labelStep =
      items.length <= 16
        ? 1
        : maxLabelW + 12 <= groupW && groupW >= 28
        ? 1
        : Math.max(2, Math.ceil((maxLabelW + 12) / Math.max(1, groupW)));

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

    // X-axis date labels + subtle baseline marker for upcoming regular workdays (no dots on weekends/holidays)
    items.forEach((item, idx) => {
      const cx = padLeft + idx * groupW + groupW / 2;
      const isHol = Boolean(item.holidayName);
      const isWknd = Boolean(item.isWeekend) && !isHol;
      if (item.isFuture && !isHol && !isWknd) {
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
        ctx.fillStyle =
          hover?.idx === idx
            ? isLight
              ? '#0f172a'
              : '#ffffff'
            : isHol
            ? isLight
              ? VELOCITY_CALENDAR_COLORS.holidayLight
              : VELOCITY_CALENDAR_COLORS.holidayDark
            : isWknd
            ? isLight
              ? '#475569'
              : '#cbd5e1'
            : axisColor;
        ctx.font = `${hover?.idx === idx || isHol ? '700' : '600'} ${xLabelFontPx}px ${chartFont}`;
        const displayLabel = getCleanDateLabel(item.label);
        const tw = ctx.measureText(displayLabel).width;
        const lx = Math.min(width - padRight - tw, Math.max(padLeft, cx - tw / 2));
        ctx.fillText(displayLabel, lx, height - 7);
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
    let peakBox: { bx: number; by: number; bw: number; bh: number } | null = null;
    if (peakIdx >= 0 && peakTotal > 0 && hover === null) {
      const px = padLeft + peakIdx * groupW + groupW / 2;
      const label = fmt(peakTotal);
      ctx.font = `700 10px ${chartFont}`;
      const tw = ctx.measureText(label).width;
      const bw = tw + 12;
      const bh = 18;
      const bx = Math.min(width - padRight - bw, Math.max(padLeft, px - bw / 2));
      const by = Math.max(2, peakY - bh - 7);
      peakBox = { bx, by, bw, bh };
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

    // Crisp top-gutter pills identifying Weekend & Holiday columns cleanly above gridline
    if (nonWorkBands.length > 0) {
      ctx.font = `700 8.5px ${chartFont}`;
      nonWorkBands.forEach((band) => {
        const candidates =
          band.kind === 'holiday'
            ? [
                band.holidayName ? band.holidayName.replace(/\s*\(.*?\)/g, '').trim() : '',
                'Holiday',
                'Hol',
                'H',
              ].filter(Boolean)
            : ['Weekend', 'Wknd', 'W'];

        let chosen: string | null = null;
        let textW = 0;
        for (const c of candidates) {
          const w = ctx.measureText(c).width;
          if (w + 7 <= band.bw + 2) {
            chosen = c;
            textW = w;
            break;
          }
        }
        if (!chosen) return;

        const pw = Math.min(band.bw + 4, textW + 8);
        const ph = 14;
        const px = Math.max(padLeft, Math.min(width - padRight - pw, band.bx + (band.bw - pw) / 2));
        const py = 5;

        if (
          peakBox &&
          peakBox.by <= py + ph + 3 &&
          px < peakBox.bx + peakBox.bw + 4 &&
          px + pw > peakBox.bx - 4
        ) {
          return;
        }

        ctx.save();
        roundRectPath(ctx, px, py, pw, ph, 4);
        if (band.kind === 'holiday') {
          ctx.fillStyle = isLight ? 'rgba(255, 251, 235, 0.96)' : 'rgba(69, 26, 3, 0.88)';
          ctx.strokeStyle = isLight ? 'rgba(245, 158, 11, 0.48)' : 'rgba(251, 191, 36, 0.48)';
        } else {
          ctx.fillStyle = isLight ? 'rgba(248, 250, 252, 0.96)' : 'rgba(30, 41, 59, 0.88)';
          ctx.strokeStyle = isLight ? 'rgba(148, 163, 184, 0.42)' : 'rgba(148, 163, 184, 0.35)';
        }
        ctx.lineWidth = 0.85;
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle =
          band.kind === 'holiday'
            ? isLight
              ? '#b45309'
              : '#fcd34d'
            : isLight
            ? '#475569'
            : '#cbd5e1';
        ctx.fillText(chosen, px + (pw - textW) / 2, py + 10);
        ctx.restore();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, height, theme, containerWidth, hover, primarySeriesMeta]);

  const isLight = theme === 'light';
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
          className={`absolute top-2.5 pointer-events-none z-20 rounded-xl border backdrop-blur-md px-3.5 py-2.5 text-[11px] whitespace-nowrap min-w-[205px] ${
            isLight
              ? 'border-slate-200/90 bg-white/95 text-slate-700 shadow-[0_12px_32px_rgba(15,23,42,0.12)]'
              : 'border-slate-700/80 bg-[#0f172a]/95 text-slate-200 shadow-[0_12px_32px_rgba(15,23,42,0.38)]'
          }`}
          style={{
            left: hover.x,
            transform: `translateX(${hover.x > (containerWidth || 0) * 0.52 ? 'calc(-100% - 12px)' : '12px'})`,
          }}
          role="status"
        >
          <div
            className={`flex items-baseline justify-between gap-4 pb-1.5 mb-1.5 border-b ${
              isLight ? 'border-slate-100' : 'border-slate-700/70'
            }`}
          >
            <span className={`text-[10.5px] font-semibold ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              {hoverItem.fullLabel || hoverItem.label}
            </span>
            <span className={`font-figure font-bold text-sm ${isLight ? 'text-slate-900' : 'text-white'}`}>
              {fmt(hoverHeadlineVal)} tasks
            </span>
          </div>
          {(hoverItem.holidayName || hoverItem.isWeekend) && (
            <div
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 mb-1.5 rounded-md border text-[10px] font-semibold ${
                hoverItem.holidayName
                  ? isLight
                    ? 'bg-amber-50 border-amber-200/90 text-amber-800'
                    : 'bg-amber-950/60 border-amber-800/70 text-amber-300'
                  : isLight
                  ? 'bg-slate-100/90 border-slate-200/90 text-slate-600'
                  : 'bg-slate-800/90 border-slate-700 text-slate-300'
              }`}
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{
                  background: hoverItem.holidayName
                    ? isLight
                      ? VELOCITY_CALENDAR_COLORS.holidayLight
                      : VELOCITY_CALENDAR_COLORS.holidayDark
                    : isLight
                    ? VELOCITY_CALENDAR_COLORS.weekendLight
                    : VELOCITY_CALENDAR_COLORS.weekendDark,
                }}
              />
              <span>
                {hoverItem.holidayName
                  ? `Holiday${hoverItem.dayOfWeek ? ` (${hoverItem.dayOfWeek})` : ''} · ${hoverItem.holidayName}${
                      hoverItem.isWeekend ? ' · Weekend' : ''
                    }`
                  : `Weekend${hoverItem.dayOfWeek ? ` · ${hoverItem.dayOfWeek}` : ''}`}
              </span>
            </div>
          )}
          <div className="space-y-0.5">
            {CHANNEL_SERIES.map((s) =>
              hoverItem[s.key] > 0 ? (
                <div key={s.key} className="flex items-center justify-between gap-3">
                  <span className={`flex items-center gap-1.5 ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
                    <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                    {s.label}
                  </span>
                  <strong className={`font-figure ${isLight ? 'text-slate-900' : 'text-white'}`}>
                    {fmt(hoverItem[s.key])}
                  </strong>
                </div>
              ) : null
            )}
          </div>
          <div
            className={`flex items-center justify-between gap-3 pt-1.5 mt-1.5 border-t text-[10.5px] ${
              isLight ? 'border-slate-100 text-slate-500' : 'border-slate-700/70 text-slate-400'
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              <span
                className={`w-2.5 border-t-[2px] border-dashed inline-block ${
                  isLight ? 'border-[#4F518C]' : 'border-[#a2a5e0]'
                }`}
              />
              {hoverItem.isFuture && hoverTotal === 0 && hoverItem.activeStaff === 0
                ? 'Upcoming day'
                : `${fmt(hoverItem.activeStaff)} staff${hoverItem.activeBranches ? ` · ${hoverItem.activeBranches} branches` : ''}`}
            </span>
            {hoverItem.activeStaff > 0 && (
              <span className={`font-figure font-semibold ${isLight ? 'text-[#1e6091]' : 'text-sky-300'}`}>
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

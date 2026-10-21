import React, { useEffect, useRef, useState } from 'react';
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    const dpr = window.devicePixelRatio || 2;
    const width = containerWidth || parent.clientWidth || 540;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);
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
    ctx.beginPath();
    ctx.roundRect(16, 8, 10, 10, 3);
    ctx.fill();
    ctx.fillStyle = legendTextColor;
    ctx.fillText(series1Label, 32, 17);

    const s1Width = ctx.measureText(series1Label).width;
    ctx.fillStyle = series2Color;
    ctx.beginPath();
    ctx.roundRect(52 + s1Width, 8, 10, 10, 3);
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
      ctx.beginPath();
      ctx.roundRect(gx, padTop + plotH - h1, barW, h1, [4, 4, 0, 0]);
      ctx.fill();

      // Bar 2
      ctx.fillStyle = series2Color;
      ctx.beginPath();
      ctx.roundRect(gx + barW + 4, padTop + plotH - h2, barW, h2, [4, 4, 0, 0]);
      ctx.fill();

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
  }, [
    labels,
    series1Data,
    series2Data,
    series1Color,
    series2Color,
    series1Label,
    series2Label,
    height,
    theme,
    containerWidth,
  ]);

  return (
    <div className="relative w-full h-[245px] flex items-center justify-center">
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
};

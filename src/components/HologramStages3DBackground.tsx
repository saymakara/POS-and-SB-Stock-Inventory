import React, { useRef, useEffect } from 'react';

interface Props {
  className?: string;
  activeCount?: number;
}

interface StageMeta {
  id: number;
  label: string;
  sub: string;
  icon: string;
  color: string;
  glow: string;
}

const STAGES: StageMeta[] = [
  {
    id: 1,
    label: '1. Add Stock',
    sub: 'Barcode Scan',
    icon: '📦',
    color: '#38bdf8',
    glow: 'rgba(56, 189, 248, 0.4)',
  },
  {
    id: 2,
    label: '2. Requisition',
    sub: 'Branch Allocation',
    icon: '🏢',
    color: '#818cf8',
    glow: 'rgba(129, 140, 248, 0.4)',
  },
  {
    id: 3,
    label: '3. Push Config',
    sub: 'OTA App Push',
    icon: '⚡',
    color: '#38bdf8',
    glow: 'rgba(56, 189, 248, 0.65)',
  },
  {
    id: 4,
    label: '4. Dispatch',
    sub: 'Field Courier',
    icon: '🛵',
    color: '#f472b6',
    glow: 'rgba(244, 114, 182, 0.4)',
  },
  {
    id: 5,
    label: '5. Merchant Live',
    sub: 'KHQR Active',
    icon: '🏪',
    color: '#34d399',
    glow: 'rgba(52, 211, 153, 0.5)',
  },
];

export const HologramStages3DBackground: React.FC<Props> = ({ className = '' }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let width = 0;
    let height = 0;
    let isVisible = true;

    // Handle resize
    const handleResize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    // Pause animation when offscreen
    const observer = new IntersectionObserver(([entry]) => {
      isVisible = entry.isIntersecting;
    });
    observer.observe(canvas);

    // Floating particles along orbital plane
    const stars: Array<{ x: number; y: number; r: number; alpha: number; speed: number }> = [];
    for (let i = 0; i < 45; i++) {
      stars.push({
        x: Math.random(),
        y: Math.random(),
        r: Math.random() * 1.5 + 0.5,
        alpha: Math.random() * 0.5 + 0.2,
        speed: Math.random() * 0.0006 + 0.0003,
      });
    }

    let startTime = performance.now();

    const render = (now: number) => {
      if (!isVisible) {
        animId = requestAnimationFrame(render);
        return;
      }

      const elapsed = (now - startTime) / 1000;
      ctx.clearRect(0, 0, width, height);

      // 1. Draw Subtle Ambient Starfield Particles
      stars.forEach((s) => {
        s.alpha += Math.sin(elapsed * 2 + s.x * 10) * 0.005;
        const currentAlpha = Math.max(0.1, Math.min(0.6, s.alpha));
        ctx.fillStyle = `rgba(186, 230, 253, ${currentAlpha})`;
        ctx.beginPath();
        ctx.arc(s.x * width, s.y * height, s.r, 0, Math.PI * 2);
        ctx.fill();
      });

      // 2. 3D Elliptical Orbital Stage Geometry
      const cx = width * 0.5;
      const cy = height * 0.44;
      const rx = Math.max(220, width * 0.42);
      const ry = Math.max(55, height * 0.22);

      // 3D Orbital Path Ring
      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Glowing Data Wave Traveling Through the Pipeline (from Stage 1 to 5)
      const waveProgress = (elapsed * 0.12) % 1; // full cycle every ~8s
      const waveAngle = waveProgress * Math.PI * 2;
      const waveX = cx + Math.cos(waveAngle) * rx;
      const waveY = cy + Math.sin(waveAngle) * ry;

      // Leading data packet
      ctx.fillStyle = '#38bdf8';
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(waveX, waveY, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Trailing laser pulses
      for (let t = 0; t < 6; t++) {
        const trailAngle = waveAngle - t * 0.08;
        const tx = cx + Math.cos(trailAngle) * rx;
        const ty = cy + Math.sin(trailAngle) * ry;
        ctx.fillStyle = `rgba(56, 189, 248, ${0.7 - t * 0.11})`;
        ctx.beginPath();
        ctx.arc(tx, ty, Math.max(1, 3.5 - t * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }

      // 3. Render 5 Floating Glassmorphic Hologram Platforms
      // Calculate depth so cards in front render on top
      const sortedStages = STAGES.map((stage, idx) => {
        // Orbit speed: slow rotation
        const baseAngle = (idx / STAGES.length) * Math.PI * 2 + elapsed * 0.14;
        const x = cx + Math.cos(baseAngle) * rx;
        const y = cy + Math.sin(baseAngle) * ry;
        // sin(baseAngle) gives depth: -1 is back, +1 is front
        const depth = Math.sin(baseAngle);
        const scale = 0.78 + (depth + 1) * 0.18; // scale from 0.78 (back) to 1.14 (front)
        const isFocalStage = stage.id === 3; // Push Configuring is our focal stage

        return {
          stage,
          x,
          y,
          depth,
          scale,
          isFocalStage,
          angle: baseAngle,
        };
      }).sort((a, b) => a.depth - b.depth);

      sortedStages.forEach((item) => {
        const { stage, x, y, scale, isFocalStage } = item;
        const floatOffset = Math.sin(elapsed * 2 + stage.id) * 4;

        ctx.save();
        ctx.translate(x, y + floatOffset);
        ctx.scale(scale, scale);

        // Ground shadow beneath floating platform
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.beginPath();
        ctx.ellipse(0, 32, 28, 8, 0, 0, Math.PI * 2);
        ctx.fill();

        // Holographic vertical light beam from base
        const beamHeight = isFocalStage ? 55 : 35;
        const beamGrad = ctx.createLinearGradient(0, 20, 0, -beamHeight);
        beamGrad.addColorStop(0, stage.glow);
        beamGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = beamGrad;
        ctx.beginPath();
        ctx.moveTo(-18, 20);
        ctx.lineTo(18, 20);
        ctx.lineTo(10, -beamHeight);
        ctx.lineTo(-10, -beamHeight);
        ctx.closePath();
        ctx.fill();

        // Frosted Glassmorphic Card Container
        const cardW = 68;
        const cardH = 46;
        const r = 12;

        // Card Glow
        ctx.shadowColor = stage.color;
        ctx.shadowBlur = isFocalStage ? 20 : 10;

        // Glass background
        ctx.fillStyle = isFocalStage
          ? 'rgba(7, 30, 56, 0.82)'
          : 'rgba(10, 22, 40, 0.72)';
        ctx.strokeStyle = isFocalStage
          ? 'rgba(56, 189, 248, 0.75)'
          : 'rgba(148, 163, 184, 0.3)';
        ctx.lineWidth = isFocalStage ? 1.8 : 1;

        ctx.beginPath();
        ctx.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, r);
        ctx.fill();
        ctx.stroke();

        ctx.shadowBlur = 0; // reset shadow for crisp text/icons

        // Holographic glass reflection highlight on card
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.beginPath();
        ctx.roundRect(-cardW / 2 + 2, -cardH / 2 + 2, cardW - 4, (cardH - 4) * 0.45, [r - 2, r - 2, 0, 0]);
        ctx.fill();

        // 3D Stage Icon
        ctx.font = '16px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(stage.icon, 0, -7);

        // Stage Short Label
        ctx.font = 'bold 8.5px ui-monospace, SFMono-Regular, monospace';
        ctx.fillStyle = isFocalStage ? '#7dd3fc' : '#cbd5e1';
        ctx.fillText(stage.label.replace(/^\d+\.\s*/, ''), 0, 11);

        // Active Soundwaves on Stage 5 (Merchant KHQR sound active)
        if (stage.id === 5) {
          for (let w = 1; w <= 3; w++) {
            const rippleR = 14 + ((elapsed * 18 + w * 7) % 20);
            const rippleAlpha = Math.max(0, 0.7 - rippleR / 34);
            ctx.strokeStyle = `rgba(52, 211, 153, ${rippleAlpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(cardW / 2 - 6, -cardH / 2 + 6, rippleR, -Math.PI * 0.6, Math.PI * 0.1);
            ctx.stroke();
          }
        }

        // Active OTA App Push Beams on Stage 3 (Focal Stage)
        if (stage.id === 3) {
          const pulse = Math.sin(elapsed * 5) * 3;
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.8)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(0, -7, 13 + pulse, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.restore();
      });

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
    };
  }, []);

  return (
    <div className={`absolute inset-0 pointer-events-none overflow-hidden select-none z-0 ${className}`}>
      {/* 3D Hardware Canvas Layer */}
      <canvas
        ref={canvasRef}
        className="w-full h-full block transform-gpu will-change-transform"
      />

      {/* Atmospheric Radial Gradients for Contrast & Readability */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(110% 110% at 50% 0%, rgba(0, 34, 56, 0.35) 0%, rgba(0, 15, 26, 0.8) 65%, rgba(0, 8, 16, 0.96) 100%)',
        }}
      />
    </div>
  );
};

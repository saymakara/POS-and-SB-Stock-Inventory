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
    color: '#bae6fd',
    glow: 'rgba(186, 230, 253, 0.6)',
  },
  {
    id: 2,
    label: '2. Requisition',
    sub: 'Branch Transfer',
    icon: '🏢',
    color: '#c7d2fe',
    glow: 'rgba(199, 210, 254, 0.6)',
  },
  {
    id: 3,
    label: '3. Push Config',
    sub: 'OTA App Push',
    icon: '⚡',
    color: '#ffffff',
    glow: 'rgba(255, 255, 255, 0.85)',
  },
  {
    id: 4,
    label: '4. Dispatch',
    sub: 'Field Courier',
    icon: '🛵',
    color: '#fbcfe8',
    glow: 'rgba(251, 207, 232, 0.6)',
  },
  {
    id: 5,
    label: '5. Merchant Live',
    sub: 'KHQR Active',
    icon: '🏪',
    color: '#a7f3d0',
    glow: 'rgba(167, 243, 208, 0.7)',
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

    // Luminous ambient energy orbs
    const orbs: Array<{ x: number; y: number; r: number; alpha: number; speed: number }> = [];
    for (let i = 0; i < 40; i++) {
      orbs.push({
        x: Math.random(),
        y: Math.random(),
        r: Math.random() * 2 + 1,
        alpha: Math.random() * 0.5 + 0.3,
        speed: Math.random() * 0.0008 + 0.0004,
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

      // 1. Draw Flowing Luminous Aurora Ribbon Waves in Background
      ctx.save();
      for (let wave = 0; wave < 2; wave++) {
        const waveOffset = elapsed * 0.8 + wave * Math.PI;
        const waveGrad = ctx.createLinearGradient(0, height * 0.3, width, height * 0.7);
        waveGrad.addColorStop(0, 'rgba(56, 189, 248, 0.08)');
        waveGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.12)');
        waveGrad.addColorStop(1, 'rgba(52, 211, 153, 0.08)');

        ctx.fillStyle = waveGrad;
        ctx.beginPath();
        ctx.moveTo(0, height);
        for (let x = 0; x <= width; x += 30) {
          const y =
            height * 0.5 +
            Math.sin(x * 0.004 + waveOffset) * 25 +
            Math.cos(x * 0.002 - waveOffset * 0.6) * 15;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(width, height);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      // 2. Draw Floating Luminous Light Sparks
      orbs.forEach((o) => {
        o.alpha += Math.sin(elapsed * 2.5 + o.x * 12) * 0.006;
        const currentAlpha = Math.max(0.15, Math.min(0.75, o.alpha));
        ctx.fillStyle = `rgba(255, 255, 255, ${currentAlpha})`;
        ctx.beginPath();
        ctx.arc(o.x * width, o.y * height, o.r, 0, Math.PI * 2);
        ctx.fill();
      });

      // 3. 3D Elliptical Orbital Stage Geometry
      const cx = width * 0.5;
      const cy = height * 0.44;
      const rx = Math.max(220, width * 0.42);
      const ry = Math.max(55, height * 0.22);

      // Glowing 3D Orbital Path Ring (Bright Cyan & White)
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      ctx.restore();

      // Glowing Fiber-Optic Data Pulse Traveling Through the 5 Stages
      const waveProgress = (elapsed * 0.14) % 1; // full cycle every ~7s
      const waveAngle = waveProgress * Math.PI * 2;
      const waveX = cx + Math.cos(waveAngle) * rx;
      const waveY = cy + Math.sin(waveAngle) * ry;

      // Trailing luminous comet particles
      for (let t = 0; t < 8; t++) {
        const trailAngle = waveAngle - t * 0.06;
        const tx = cx + Math.cos(trailAngle) * rx;
        const ty = cy + Math.sin(trailAngle) * ry;
        ctx.fillStyle = `rgba(255, 255, 255, ${0.9 - t * 0.11})`;
        ctx.beginPath();
        ctx.arc(tx, ty, Math.max(1, 4 - t * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }

      // Leading super-bright pulse
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#7dd3fc';
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(waveX, waveY, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 4. Render 5 Floating Luminous Crystal Glass Platforms
      const sortedStages = STAGES.map((stage, idx) => {
        const baseAngle = (idx / STAGES.length) * Math.PI * 2 + elapsed * 0.14;
        const x = cx + Math.cos(baseAngle) * rx;
        const y = cy + Math.sin(baseAngle) * ry;
        const depth = Math.sin(baseAngle);
        const scale = 0.82 + (depth + 1) * 0.18; // scale from 0.82 (back) to 1.18 (front)
        const isFocalStage = stage.id === 3;

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

        // Soft ambient blue shadow beneath floating crystal platform
        ctx.fillStyle = 'rgba(0, 48, 87, 0.3)';
        ctx.beginPath();
        ctx.ellipse(0, 32, 28, 8, 0, 0, Math.PI * 2);
        ctx.fill();

        // Holographic vertical light beam from base (luminous white/cyan gradient)
        const beamHeight = isFocalStage ? 60 : 38;
        const beamGrad = ctx.createLinearGradient(0, 20, 0, -beamHeight);
        beamGrad.addColorStop(0, stage.glow);
        beamGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = beamGrad;
        ctx.beginPath();
        ctx.moveTo(-18, 20);
        ctx.lineTo(18, 20);
        ctx.lineTo(10, -beamHeight);
        ctx.lineTo(-10, -beamHeight);
        ctx.closePath();
        ctx.fill();

        // Radiant Frosted Crystal Glass Card
        const cardW = 70;
        const cardH = 48;
        const r = 14;

        // Card Glow
        ctx.shadowColor = isFocalStage ? '#ffffff' : stage.color;
        ctx.shadowBlur = isFocalStage ? 22 : 12;

        // Crystal white translucent glass body
        ctx.fillStyle = isFocalStage
          ? 'rgba(255, 255, 255, 0.32)'
          : 'rgba(255, 255, 255, 0.22)';
        ctx.strokeStyle = isFocalStage
          ? 'rgba(255, 255, 255, 0.95)'
          : 'rgba(255, 255, 255, 0.6)';
        ctx.lineWidth = isFocalStage ? 2 : 1.2;

        ctx.beginPath();
        ctx.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, r);
        ctx.fill();
        ctx.stroke();

        ctx.shadowBlur = 0; // reset shadow for crisp typography

        // Prismatic reflection highlight on top half of card
        const reflGrad = ctx.createLinearGradient(0, -cardH / 2, 0, 0);
        reflGrad.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
        reflGrad.addColorStop(1, 'rgba(255, 255, 255, 0.05)');
        ctx.fillStyle = reflGrad;
        ctx.beginPath();
        ctx.roundRect(-cardW / 2 + 1.5, -cardH / 2 + 1.5, cardW - 3, (cardH - 3) * 0.46, [r - 2, r - 2, 0, 0]);
        ctx.fill();

        // 3D Stage Icon
        ctx.font = '17px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(stage.icon, 0, -8);

        // Stage Short Label with subtle contrast backdrop
        ctx.font = 'bold 9px ui-monospace, SFMono-Regular, monospace';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(0, 30, 60, 0.6)';
        ctx.shadowBlur = 4;
        ctx.fillText(stage.label.replace(/^\d+\.\s*/, ''), 0, 12);
        ctx.shadowBlur = 0;

        // Active Soundwaves on Stage 5 (Merchant KHQR sound active - Bright Emerald)
        if (stage.id === 5) {
          for (let w = 1; w <= 3; w++) {
            const rippleR = 14 + ((elapsed * 20 + w * 7) % 22);
            const rippleAlpha = Math.max(0, 0.85 - rippleR / 36);
            ctx.strokeStyle = `rgba(167, 243, 208, ${rippleAlpha})`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(cardW / 2 - 6, -cardH / 2 + 6, rippleR, -Math.PI * 0.6, Math.PI * 0.1);
            ctx.stroke();
          }
        }

        // Active OTA App Push Beams on Stage 3 (Focal Stage - Glowing White-Cyan Pulse)
        if (stage.id === 3) {
          const pulse = Math.sin(elapsed * 5.5) * 3.5;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.arc(0, -8, 14 + pulse, 0, Math.PI * 2);
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

      {/* Luminous Radiant Overlay: Subtle and bright, NOT dark */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(130% 120% at 50% 10%, rgba(255, 255, 255, 0.14) 0%, rgba(2, 132, 199, 0.05) 50%, rgba(0, 48, 85, 0.35) 100%)',
        }}
      />
    </div>
  );
};

import React, { useState } from 'react';

export type LogoPresetId = 'quantum-sound' | 'fintech-pulse' | 'apex-pos' | 'bank-shield' | 'merchant-store';

export interface AppBrandLogoProps {
  logoUrl?: string;
  presetId?: LogoPresetId;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  className?: string;
  showGlow?: boolean;
  altText?: string;
  animated?: boolean;
}

const SIZE_MAP = {
  xs: { box: 'w-5 h-5 rounded-md', icon: 'w-3.5 h-3.5', glow: 'blur-xs' },
  sm: { box: 'w-7 h-7 rounded-lg', icon: 'w-5 h-5', glow: 'blur-xs' },
  md: { box: 'w-9 h-9 rounded-xl', icon: 'w-7 h-7', glow: 'blur-xs' },
  lg: { box: 'w-12 h-12 rounded-2xl', icon: 'w-9 h-9', glow: 'blur-sm' },
  xl: { box: 'w-16 h-16 rounded-2xl', icon: 'w-12 h-12', glow: 'blur-md' },
  '2xl': { box: 'w-24 h-24 rounded-3xl', icon: 'w-18 h-18', glow: 'blur-lg' },
};

/**
 * 1. Official Browser Preset: Quantum SoundBox Wave (Original Flagship)
 * 4 Clean Equalizer Audio Frequency Bars in dark obsidian squircle, identical to the browser favicon,
 * enhanced with smooth 2D audio equalizer pulse micro-animations.
 */
// (30 Oct 2026) The 4 bars: same positions, sizes and colours as before (viewBox units out of 48).
const EQ_BARS = [
  { x: 13, y: 20, h: 8, anim: 'eq_bounce_1 1.6s ease-in-out infinite' },
  { x: 19, y: 14, h: 20, anim: 'eq_bounce_2 1.4s ease-in-out infinite 0.15s' },
  { x: 25, y: 11, h: 26, anim: 'eq_bounce_3 1.8s ease-in-out infinite 0.3s' },
  { x: 31, y: 17, h: 14, anim: 'eq_bounce_4 1.5s ease-in-out infinite 0.1s' },
];
const pct = (v: number) => `${(v / 48) * 100}%`;

export const SvgQuantumSound: React.FC<{ className?: string; animated?: boolean }> = ({
  className = 'w-full h-full',
  animated = true,
}) => (
  // (30 Oct 2026) The moving bars are drawn as plain page elements that move with transform only, so the graphics card
  // animates them. Before, the SVG bars changed height and position, which made the browser redo the whole screen about
  // 20 times a second on every tab (most on Stock Requests). Same look, same timing.
  <span className={`relative block ${className}`} aria-hidden="true">
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className="absolute inset-0 w-full h-full">
      <defs>
        <linearGradient id="soundSimpleBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0d1117" />
          <stop offset="100%" stopColor="#161b22" />
        </linearGradient>
        <linearGradient id="soundWaveGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#34d399" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="12" fill="url(#soundSimpleBg)" />
      <rect x="2" y="2" width="44" height="44" rx="12" stroke="white" strokeOpacity="0.12" strokeWidth="1" />
      {!animated && EQ_BARS.map((b) => <rect key={b.x} x={b.x} y={b.y} width="4" height={b.h} rx="2" fill="url(#soundWaveGrad)" />)}
    </svg>
    {animated && (
      <>
        <style>{`
          @keyframes eq_bounce_1 { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(2); } }
          @keyframes eq_bounce_2 { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(0.5); } }
          @keyframes eq_bounce_3 { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(0.6923); } }
          @keyframes eq_bounce_4 { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(1.7143); } }
          @media (prefers-reduced-motion: reduce) { .eq-bar { animation: none !important; } }
        `}</style>
        {EQ_BARS.map((b) => (
          <span
            key={b.x}
            className="eq-bar absolute rounded-full"
            style={{
              left: pct(b.x), top: pct(b.y), width: pct(4), height: pct(b.h),
              background: 'linear-gradient(to bottom right, #38bdf8, #34d399)',
              animation: b.anim, transformOrigin: 'center', willChange: 'transform',
            }}
          />
        ))}
      </>
    )}
  </span>
);

/**
 * 2. Preset: Fintech Pulse (Simple, Clean POS Terminal + Sound Box Wave)
 */
export const SvgFintechPulse: React.FC<{ className?: string; animated?: boolean }> = ({
  className = 'w-full h-full',
}) => (
  <svg
    viewBox="0 0 48 48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="simplePulseBg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#003844" />
        <stop offset="100%" stopColor="#005d6e" />
      </linearGradient>
      <linearGradient id="simplePulseWaves" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#10b981" />
        <stop offset="100%" stopColor="#38bdf8" />
      </linearGradient>
    </defs>

    <rect x="2" y="2" width="44" height="44" rx="12" fill="url(#simplePulseBg)" />
    <rect x="2" y="2" width="44" height="44" rx="12" stroke="white" strokeOpacity="0.14" strokeWidth="1" />

    <rect x="11" y="11" width="16" height="26" rx="4.5" fill="#ffffff" />
    <rect x="13.5" y="14" width="11" height="8.5" rx="2" fill="#002b36" />
    <circle cx="16.5" cy="27" r="1.5" fill="#005d6e" />
    <rect x="20" y="26" width="4.5" height="2" rx="1" fill="#005d6e" />
    <rect x="14.5" y="31.5" width="9" height="1.5" rx="0.75" fill="#cbd5e1" />

    <path
      d="M31 18C33.2 20.2 34.5 23 34.5 26C34.5 29 33.2 31.8 31 34"
      stroke="url(#simplePulseWaves)"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
    <path
      d="M36 13.5C39.5 17 41.5 21.2 41.5 26C41.5 30.8 39.5 35 36 38.5"
      stroke="url(#simplePulseWaves)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeOpacity="0.8"
    />
  </svg>
);

/**
 * 3. Preset: Apex Terminal (Minimal Flat Payment Card & Wave)
 */
export const SvgApexPos: React.FC<{ className?: string; animated?: boolean }> = ({
  className = 'w-full h-full',
}) => (
  <svg
    viewBox="0 0 48 48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="apexSimpleBg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#090d16" />
        <stop offset="100%" stopColor="#1e293b" />
      </linearGradient>
      <linearGradient id="apexAccent" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#00e5ff" />
        <stop offset="100%" stopColor="#10b981" />
      </linearGradient>
    </defs>
    <rect x="2" y="2" width="44" height="44" rx="12" fill="url(#apexSimpleBg)" />
    <rect x="2" y="2" width="44" height="44" rx="12" stroke="white" strokeOpacity="0.12" strokeWidth="1" />

    <rect x="10" y="14" width="21" height="20" rx="3.5" fill="#1e293b" stroke="white" strokeWidth="1.8" />
    <circle cx="16" cy="20" r="2.5" fill="url(#apexAccent)" />
    <path d="M14 27.5H27" stroke="white" strokeOpacity="0.4" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M34 19C36.5 21 38 23.5 38 26C38 28.5 36.5 31 34 33" stroke="url(#apexAccent)" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

/**
 * 4. Preset: Bank Vault Shield (Clean Security & Integrity)
 */
export const SvgBankShield: React.FC<{ className?: string; animated?: boolean }> = ({
  className = 'w-full h-full',
}) => (
  <svg
    viewBox="0 0 48 48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="shieldSimpleBg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#0a2540" />
        <stop offset="100%" stopColor="#00182c" />
      </linearGradient>
      <linearGradient id="shieldGold" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#fbbf24" />
        <stop offset="100%" stopColor="#f59e0b" />
      </linearGradient>
    </defs>
    <rect x="2" y="2" width="44" height="44" rx="12" fill="url(#shieldSimpleBg)" />
    <rect x="2" y="2" width="44" height="44" rx="12" stroke="white" strokeOpacity="0.12" strokeWidth="1" />

    <path
      d="M24 10L36 15V24C36 31 30.5 36.5 24 38.5C17.5 36.5 12 31 12 24V15L24 10Z"
      fill="#0c3254"
      stroke="url(#shieldGold)"
      strokeWidth="2.2"
      strokeLinejoin="round"
    />
    <path
      d="M19 24.5L22.5 28L29 20"
      stroke="white"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const PRESET_META: Record<
  LogoPresetId,
  {
    name: string;
    description: string;
    tag: string;
    Component: React.FC<{ className?: string; animated?: boolean }>;
  }
> = {
  'quantum-sound': {
    name: 'Sound Box Wave',
    description: 'Clean acoustic sound frequency equalizer bars inside dark obsidian squircle, identical to the browser favicon.',
    tag: 'Official Browser Logo',
    Component: SvgQuantumSound,
  },
  'fintech-pulse': {
    name: 'Simple Fintech Pulse',
    description: 'Clean minimalist POS terminal silhouette with bold dual acoustic broadcast arcs.',
    tag: 'POS Terminal',
    Component: SvgFintechPulse,
  },
  'apex-pos': {
    name: 'Apex Minimal',
    description: 'Modern geometric payment card contour with contactless NFC audio wave.',
    tag: 'Minimal Modern',
    Component: SvgApexPos,
  },
  'bank-shield': {
    name: 'Vault Shield',
    description: 'Clean institutional security shield with verified settlement checkmark.',
    tag: 'Executive Vault',
    Component: SvgBankShield,
  },
  'merchant-store': {
    name: 'Sound Box Wave',
    description: 'Clean acoustic sound frequency equalizer bars inside dark obsidian squircle.',
    tag: 'Official Browser Logo',
    Component: SvgQuantumSound,
  },
};

/**
 * Official Brand Logo Component (Roll back to original browser soundbox equalizer bars)
 */
export const AppBrandLogo: React.FC<AppBrandLogoProps> = ({
  logoUrl,
  presetId = 'quantum-sound',
  size = 'md',
  className = '',
  showGlow = false,
  altText = 'POS & Sound Box Stock Inventory Logo',
  animated = true,
}) => {
  const [imgError, setImgError] = useState(false);
  const sizeStyle = SIZE_MAP[size] || SIZE_MAP.md;
  const ActiveComponent = PRESET_META[presetId]?.Component || SvgQuantumSound;

  React.useEffect(() => {
    setImgError(false);
  }, [logoUrl]);

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 ${sizeStyle.box} ${className}`}
    >
      {/* Subtle Ambient Backlight Glow */}
      {showGlow && (
        <span
          className={`absolute inset-0 rounded-xl bg-gradient-to-tr from-sky-500/20 to-emerald-500/15 ${sizeStyle.glow} -z-10 pointer-events-none opacity-80`}
        />
      )}

      <div className="w-full h-full flex items-center justify-center">
        {logoUrl && !imgError ? (
          <div className="w-full h-full p-0.5 rounded-xl overflow-hidden bg-white/10 backdrop-blur-xs border border-white/20 shadow-xs">
            <img
              src={logoUrl}
              alt={altText}
              onError={() => setImgError(true)}
              className="w-full h-full object-contain rounded-lg"
            />
          </div>
        ) : (
          <ActiveComponent animated={animated} className="w-full h-full select-none" />
        )}
      </div>
    </div>
  );
};

import React from 'react';

export type LogoPresetId = 'fintech-pulse' | 'apex-pos' | 'bank-shield' | 'quantum-sound';

export interface AppBrandLogoProps {
  logoUrl?: string;
  presetId?: LogoPresetId;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  className?: string;
  showGlow?: boolean;
  altText?: string;
}

const SIZE_MAP = {
  xs: { box: 'w-5 h-5 rounded-md', icon: 'w-3 h-3' },
  sm: { box: 'w-7 h-7 rounded-lg', icon: 'w-4 h-4' },
  md: { box: 'w-9 h-9 rounded-xl', icon: 'w-5 h-5' },
  lg: { box: 'w-12 h-12 rounded-2xl', icon: 'w-7 h-7' },
  xl: { box: 'w-16 h-16 rounded-2xl', icon: 'w-9 h-9' },
  '2xl': { box: 'w-24 h-24 rounded-3xl', icon: 'w-14 h-14' },
};

/**
 * 1. Preset: Fintech Pulse (Simple, Clean POS Terminal + Sound Box Wave)
 * Modern minimalist design: Uncluttered white terminal body with smooth audio ripple.
 */
export const SvgFintechPulse: React.FC<{ className?: string }> = ({ className = 'w-full h-full' }) => (
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

    {/* Squircle Background Base */}
    <rect x="2" y="2" width="44" height="44" rx="12" fill="url(#simplePulseBg)" />
    <rect x="2" y="2" width="44" height="44" rx="12" stroke="white" strokeOpacity="0.14" strokeWidth="1" />

    {/* Clean Minimalist POS Terminal Body */}
    <rect x="11" y="11" width="16" height="26" rx="4.5" fill="#ffffff" />
    
    {/* Integrated Display */}
    <rect x="13.5" y="14" width="11" height="8.5" rx="2" fill="#002b36" />
    
    {/* Minimal Status Indicator & Chip Line */}
    <circle cx="16.5" cy="27" r="1.5" fill="#005d6e" />
    <rect x="20" y="26" width="4.5" height="2" rx="1" fill="#005d6e" />
    <rect x="14.5" y="31.5" width="9" height="1.5" rx="0.75" fill="#cbd5e1" />

    {/* Clean Sound Box Acoustic Waves */}
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
 * 2. Preset: Apex Terminal (Minimal Flat Payment Card & Wave)
 */
export const SvgApexPos: React.FC<{ className?: string }> = ({ className = 'w-full h-full' }) => (
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

    {/* Clean Card Silhouette with NFC Dot */}
    <rect x="10" y="14" width="21" height="20" rx="3.5" fill="#1e293b" stroke="white" strokeWidth="1.8" />
    <circle cx="16" cy="20" r="2.5" fill="url(#apexAccent)" />
    <path d="M14 27.5H27" stroke="white" strokeOpacity="0.4" strokeWidth="1.5" strokeLinecap="round" />

    {/* Modern NFC / Sound Waves */}
    <path d="M34 19C36.5 21 38 23.5 38 26C38 28.5 36.5 31 34 33" stroke="url(#apexAccent)" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

/**
 * 3. Preset: Bank Vault Shield (Clean Security & Integrity)
 */
export const SvgBankShield: React.FC<{ className?: string }> = ({ className = 'w-full h-full' }) => (
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

    {/* Minimalist Bold Shield */}
    <path
      d="M24 10L36 15V24C36 31 30.5 36.5 24 38.5C17.5 36.5 12 31 12 24V15L24 10Z"
      fill="#0c3254"
      stroke="url(#shieldGold)"
      strokeWidth="2.2"
      strokeLinejoin="round"
    />
    {/* Verified Check Line */}
    <path
      d="M19 24.5L22.5 28L29 20"
      stroke="white"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * 4. Preset: Quantum SoundBox (Minimal Acoustic Frequency Bars)
 */
export const SvgQuantumSound: React.FC<{ className?: string }> = ({ className = 'w-full h-full' }) => (
  <svg
    viewBox="0 0 48 48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
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

    {/* 4 Clean Equalizer Audio Frequency Bars */}
    <rect x="13" y="20" width="4" height="8" rx="2" fill="url(#soundWaveGrad)" />
    <rect x="19" y="14" width="4" height="20" rx="2" fill="url(#soundWaveGrad)" />
    <rect x="25" y="11" width="4" height="26" rx="2" fill="url(#soundWaveGrad)" />
    <rect x="31" y="17" width="4" height="14" rx="2" fill="url(#soundWaveGrad)" />
  </svg>
);

export const PRESET_META: Record<
  LogoPresetId,
  {
    name: string;
    description: string;
    tag: string;
    Component: React.FC<{ className?: string }>;
  }
> = {
  'fintech-pulse': {
    name: 'Simple Fintech Pulse',
    description: 'Clean minimalist POS terminal silhouette with bold dual acoustic broadcast arcs.',
    tag: 'Simple Default',
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
    tag: 'Executive',
    Component: SvgBankShield,
  },
  'quantum-sound': {
    name: 'Sound Box Wave',
    description: 'Minimal acoustic sound frequency equalizer bars inside dark obsidian squircle.',
    tag: 'Audio Focus',
    Component: SvgQuantumSound,
  },
};

export const AppBrandLogo: React.FC<AppBrandLogoProps> = ({
  logoUrl,
  presetId = 'quantum-sound',
  size = 'md',
  className = '',
  showGlow = false,
  altText = 'POS & Sound Box Stock Inventory Logo',
}) => {
  const [imgError, setImgError] = React.useState(false);
  const sizeStyle = SIZE_MAP[size] || SIZE_MAP.md;
  const ActiveComponent = PRESET_META[presetId]?.Component || SvgQuantumSound;

  // Reset error if URL changes
  React.useEffect(() => {
    setImgError(false);
  }, [logoUrl]);

  return (
    <div
      className={`relative flex items-center justify-center shrink-0 ${sizeStyle.box} ${className}`}
    >
      {showGlow && (
        <span className="absolute inset-0 rounded-2xl bg-emerald-500/20 blur-md -z-10 animate-pulse pointer-events-none" />
      )}

      {logoUrl && !imgError ? (
        <img
          src={logoUrl}
          alt={altText}
          onError={() => setImgError(true)}
          className="w-full h-full object-contain rounded-xl p-0.5"
        />
      ) : (
        <ActiveComponent className="w-full h-full drop-shadow-xs select-none" />
      )}
    </div>
  );
};

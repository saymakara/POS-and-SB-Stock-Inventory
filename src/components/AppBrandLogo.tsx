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
 * 1. Preset: Fintech Pulse (Flagship: Smart POS & Acoustic Broadcast Wave)
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
      <linearGradient id="nexusBg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#002238" />
        <stop offset="50%" stopColor="#003857" />
        <stop offset="100%" stopColor="#004e75" />
      </linearGradient>
      <linearGradient id="screenGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#031626" />
        <stop offset="100%" stopColor="#072b47" />
      </linearGradient>
      <linearGradient id="soundWaveGlow" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#38bdf8" />
        <stop offset="100%" stopColor="#34d399" />
      </linearGradient>
    </defs>

    {/* Squircle Base with Metallic Inner Rim */}
    <rect x="2" y="2" width="44" height="44" rx="13" fill="url(#nexusBg)" />
    <rect x="2.5" y="2.5" width="43" height="43" rx="12.5" stroke="white" strokeOpacity="0.18" strokeWidth="1" />
    <circle cx="19" cy="24" r="13" fill="#38bdf8" fillOpacity="0.12" />

    {/* Smart POS Terminal Body */}
    <rect x="9.5" y="10" width="17" height="28" rx="4.5" fill="#ffffff" />
    <rect x="10" y="10.5" width="16" height="27" rx="4" stroke="#e2e8f0" strokeWidth="0.8" />

    {/* OLED Screen */}
    <rect x="11.5" y="12.5" width="13" height="15" rx="2.5" fill="url(#screenGrad)" />

    {/* Screen Payment Wave / QR Elements */}
    <rect x="14.5" y="15.5" width="3" height="3" rx="0.75" fill="#38bdf8" />
    <rect x="19" y="15.5" width="3" height="3" rx="0.75" fill="#34d399" />
    <rect x="14.5" y="20" width="3" height="3" rx="0.75" fill="#34d399" />
    <circle cx="20.5" cy="21.5" r="1.5" fill="#38bdf8" />

    {/* Keypad / Chip Reader Accent */}
    <rect x="12" y="30" width="12" height="1.8" rx="0.9" fill="#003857" fillOpacity="0.85" />
    <rect x="12" y="33.5" width="5" height="1.5" rx="0.75" fill="#94a3b8" />
    <rect x="19" y="33.5" width="5" height="1.5" rx="0.75" fill="#38bdf8" />

    {/* Acoustic Sound Box Radiating Waves */}
    <path
      d="M29.5 19C31.8 21.2 33 23.5 33 26C33 28.5 31.8 30.8 29.5 33"
      stroke="url(#soundWaveGlow)"
      strokeWidth="2.8"
      strokeLinecap="round"
    />
    <path
      d="M34.5 15C38 18.5 40 22.2 40 26C40 29.8 38 33.5 34.5 37"
      stroke="url(#soundWaveGlow)"
      strokeWidth="2.8"
      strokeLinecap="round"
      strokeOpacity="0.85"
    />
    <circle cx="29" cy="26" r="1.5" fill="#6ee7b7" />
  </svg>
);

/**
 * 2. Preset: Apex Terminal (Modern Handheld POS + Contactless NFC & Gold EMV Chip)
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
      <linearGradient id="apexBg2" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#08101e" />
        <stop offset="100%" stopColor="#0f1f38" />
      </linearGradient>
      <linearGradient id="apexGlow" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#00f2fe" />
        <stop offset="100%" stopColor="#4facfe" />
      </linearGradient>
      <linearGradient id="apexGold" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#fbbf24" />
        <stop offset="100%" stopColor="#d97706" />
      </linearGradient>
    </defs>
    <rect x="2" y="2" width="44" height="44" rx="13" fill="url(#apexBg2)" />
    <rect x="2.5" y="2.5" width="43" height="43" rx="12.5" stroke="white" strokeOpacity="0.14" strokeWidth="1" />

    {/* Modern Handheld Terminal Frame */}
    <rect x="12" y="9" width="24" height="30" rx="5" fill="#132644" stroke="#38bdf8" strokeWidth="1.2" strokeOpacity="0.6" />

    {/* Interactive Glass Display */}
    <rect x="14.5" y="11.5" width="19" height="17" rx="3" fill="#061224" />

    {/* Contactless NFC Waves */}
    <path d="M21 16.5C22.2 15.5 23.8 15.5 25 16.5" stroke="url(#apexGlow)" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M19 19C21.2 17.5 24.8 17.5 27 19" stroke="url(#apexGlow)" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="23" cy="22.5" r="2" fill="url(#apexGlow)" />

    {/* Gold Smart EMV Security Chip */}
    <rect x="15" y="31.5" width="7" height="4.5" rx="1.2" fill="url(#apexGold)" />
    <line x1="18.5" y1="31.5" x2="18.5" y2="36" stroke="#92400e" strokeWidth="0.6" />
    <line x1="15" y1="33.8" x2="22" y2="33.8" stroke="#92400e" strokeWidth="0.6" />

    {/* Receipt Emitter Slot */}
    <line x1="25" y1="33.8" x2="33" y2="33.8" stroke="white" strokeOpacity="0.6" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/**
 * 3. Preset: Bank Vault Shield (Institutional Security & Verified Settlement)
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
      <linearGradient id="shieldBg2" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#00182c" />
        <stop offset="100%" stopColor="#003358" />
      </linearGradient>
      <linearGradient id="goldRim" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#fde047" />
        <stop offset="50%" stopColor="#eab308" />
        <stop offset="100%" stopColor="#ca8a04" />
      </linearGradient>
      <linearGradient id="shieldCyan" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#38bdf8" />
        <stop offset="100%" stopColor="#10b981" />
      </linearGradient>
    </defs>
    <rect x="2" y="2" width="44" height="44" rx="13" fill="url(#shieldBg2)" />
    <rect x="2.5" y="2.5" width="43" height="43" rx="12.5" stroke="white" strokeOpacity="0.14" strokeWidth="1" />

    {/* Sovereign Vault Shield */}
    <path
      d="M24 8.5L37 13.5V23.5C37 31.5 31 37.5 24 40C17 37.5 11 31.5 11 23.5V13.5L24 8.5Z"
      fill="#082845"
      stroke="url(#goldRim)"
      strokeWidth="2"
      strokeLinejoin="round"
    />

    {/* Inner Protective Core Plate */}
    <path
      d="M24 12L33.5 15.8V23.5C33.5 29.8 29 34.5 24 36.5C19 34.5 14.5 29.8 14.5 23.5V15.8L24 12Z"
      fill="#041a2e"
      stroke="white"
      strokeOpacity="0.12"
      strokeWidth="1"
    />

    {/* Verified Settlement Checkmark */}
    <path
      d="M19 23.5L22.5 27.5L29.5 19.5"
      stroke="url(#shieldCyan)"
      strokeWidth="2.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="24" cy="31" r="1.5" fill="#eab308" />
  </svg>
);

/**
 * 4. Preset: Quantum SoundBox (Acoustic Sound Box Speaker & Radiating Waves)
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
      <linearGradient id="quantumBg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#00182c" />
        <stop offset="50%" stopColor="#002d4f" />
        <stop offset="100%" stopColor="#00436d" />
      </linearGradient>
      <linearGradient id="soundNeonGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#38bdf8" />
        <stop offset="50%" stopColor="#00f2fe" />
        <stop offset="100%" stopColor="#34d399" />
      </linearGradient>
      <linearGradient id="speakerRing" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#34d399" />
        <stop offset="100%" stopColor="#0284c7" />
      </linearGradient>
    </defs>

    {/* Squircle Base with Metallic Inner Border */}
    <rect x="2" y="2" width="44" height="44" rx="13" fill="url(#quantumBg)" />
    <rect x="2.5" y="2.5" width="43" height="43" rx="12.5" stroke="white" strokeOpacity="0.18" strokeWidth="1" />

    {/* Sound Box Speaker Body Cube in Isometric Angle */}
    <path d="M12 20L24 13.5V32.5L12 26V20Z" fill="#082845" stroke="#38bdf8" strokeWidth="0.8" strokeOpacity="0.5" />
    <path d="M24 13.5L36 20V26L24 32.5V13.5Z" fill="#041a2e" stroke="#38bdf8" strokeWidth="0.8" strokeOpacity="0.5" />
    <path d="M12 20L24 13.5L36 20L24 26.5L12 20Z" fill="#0c385f" stroke="white" strokeWidth="0.8" strokeOpacity="0.3" />

    {/* Center High-Fidelity Audio Driver / Acoustic Speaker Core */}
    <circle cx="24" cy="23.5" r="7.5" fill="#021220" stroke="url(#speakerRing)" strokeWidth="1.8" />
    <circle cx="24" cy="23.5" r="4" fill="url(#soundNeonGrad)" />
    <circle cx="24" cy="23.5" r="1.6" fill="#ffffff" />

    {/* Radiating Sound Waves */}
    <path d="M33 17.5C35.5 19.5 37 21.5 37 24C37 26.5 35.5 28.5 33 30.5" stroke="url(#soundNeonGrad)" strokeWidth="2.4" strokeLinecap="round" />
    <path d="M15 17.5C12.5 19.5 11 21.5 11 24C11 26.5 12.5 28.5 15 30.5" stroke="url(#soundNeonGrad)" strokeWidth="2.4" strokeLinecap="round" strokeOpacity="0.6" />
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
    name: 'Smart POS & Audio Wave',
    description: 'Precision handheld payment terminal with dynamic acoustic broadcast waves.',
    tag: 'Flagship Core',
    Component: SvgFintechPulse,
  },
  'quantum-sound': {
    name: 'SoundBox Acoustic Hub',
    description: '3D acoustic sound box speaker with radiating payment verification pulses.',
    tag: 'Sound Box Hub',
    Component: SvgQuantumSound,
  },
  'apex-pos': {
    name: 'Apex Smart Terminal',
    description: 'Modern handheld POS terminal with OLED contactless NFC display and EMV chip.',
    tag: 'Minimal Modern',
    Component: SvgApexPos,
  },
  'bank-shield': {
    name: 'Institutional Vault Shield',
    description: 'Chiseled sovereign security shield with verified settlement checkmark.',
    tag: 'Executive',
    Component: SvgBankShield,
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
        <span className="absolute inset-0 rounded-2xl bg-sky-500/25 blur-md -z-10 animate-pulse pointer-events-none" />
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

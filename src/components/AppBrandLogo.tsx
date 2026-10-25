import React, { useState, useRef, useCallback } from 'react';

export type LogoPresetId = 'fintech-pulse' | 'apex-pos' | 'bank-shield' | 'quantum-sound';

export interface AppBrandLogoProps {
  logoUrl?: string;
  presetId?: LogoPresetId;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  className?: string;
  showGlow?: boolean;
  altText?: string;
  animate3D?: boolean;
  interactive?: boolean;
}

const SIZE_MAP = {
  xs: { box: 'w-5 h-5 rounded-md', icon: 'w-3.5 h-3.5', glow: 'blur-xs' },
  sm: { box: 'w-7 h-7 rounded-lg', icon: 'w-5 h-5', glow: 'blur-xs' },
  md: { box: 'w-9 h-9 rounded-xl', icon: 'w-7 h-7', glow: 'blur-sm' },
  lg: { box: 'w-12 h-12 rounded-2xl', icon: 'w-9 h-9', glow: 'blur-md' },
  xl: { box: 'w-16 h-16 rounded-2xl', icon: 'w-12 h-12', glow: 'blur-lg' },
  '2xl': { box: 'w-24 h-24 rounded-3xl', icon: 'w-18 h-18', glow: 'blur-xl' },
};

/**
 * 1. Flagship 3D Preset: Quantum SoundBox 3D
 * Multi-layer 3D acoustic sound box speaker with animated pulsing driver core,
 * radiating 3D payment sound waves, live green beacon, and diagonal glass gleam.
 */
export const SvgQuantumSound: React.FC<{ className?: string }> = ({ className = 'w-full h-full' }) => (
  <svg
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="qs3d_base" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#00182e" />
        <stop offset="45%" stopColor="#003554" />
        <stop offset="100%" stopColor="#004e75" />
      </linearGradient>

      <linearGradient id="qs3d_rim" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#7dd3fc" stopOpacity="0.85" />
        <stop offset="50%" stopColor="#ffffff" stopOpacity="0.45" />
        <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.2" />
      </linearGradient>

      <radialGradient id="qs3d_cone" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#38bdf8" />
        <stop offset="40%" stopColor="#0284c7" />
        <stop offset="80%" stopColor="#041f38" />
        <stop offset="100%" stopColor="#000e1c" />
      </radialGradient>

      <linearGradient id="qs3d_wave" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#38bdf8" />
        <stop offset="50%" stopColor="#00f2fe" />
        <stop offset="100%" stopColor="#34d399" />
      </linearGradient>

      <linearGradient id="qs3d_gleam" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
        <stop offset="50%" stopColor="#ffffff" stopOpacity="0.32" />
        <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
      </linearGradient>

      <filter id="qs3d_glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="1.5" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>

      <clipPath id="qs3d_clip">
        <rect x="3" y="3" width="58" height="58" rx="17" />
      </clipPath>
    </defs>

    <style>{`
      @keyframes qs3d_pulse_core {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.09); filter: drop-shadow(0 0 5px rgba(56, 189, 248, 0.7)); }
      }
      @keyframes qs3d_wave_l1 {
        0%, 100% { opacity: 0.35; transform: translateX(0); }
        50% { opacity: 1; transform: translateX(-1.5px); }
      }
      @keyframes qs3d_wave_l2 {
        0%, 100% { opacity: 0.2; transform: translateX(0); }
        50% { opacity: 0.9; transform: translateX(-2.5px); }
      }
      @keyframes qs3d_wave_r1 {
        0%, 100% { opacity: 0.35; transform: translateX(0); }
        50% { opacity: 1; transform: translateX(1.5px); }
      }
      @keyframes qs3d_wave_r2 {
        0%, 100% { opacity: 0.2; transform: translateX(0); }
        50% { opacity: 0.9; transform: translateX(2.5px); }
      }
      @keyframes qs3d_gleam_loop {
        0% { transform: translateX(-80px) rotate(35deg); }
        25% { transform: translateX(95px) rotate(35deg); }
        100% { transform: translateX(95px) rotate(35deg); }
      }
      @keyframes qs3d_beacon_beat {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.4); opacity: 0.65; }
      }
      .qs3d-core {
        transform-origin: 32px 33px;
        animation: qs3d_pulse_core 2.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
      }
      .qs3d-wl1 { transform-origin: 32px 33px; animation: qs3d_wave_l1 2.2s ease-in-out infinite; }
      .qs3d-wl2 { transform-origin: 32px 33px; animation: qs3d_wave_l2 2.2s ease-in-out infinite 0.25s; }
      .qs3d-wr1 { transform-origin: 32px 33px; animation: qs3d_wave_r1 2.2s ease-in-out infinite; }
      .qs3d-wr2 { transform-origin: 32px 33px; animation: qs3d_wave_r2 2.2s ease-in-out infinite 0.25s; }
      .qs3d-gleam { animation: qs3d_gleam_loop 4.2s ease-in-out infinite; }
      .qs3d-beacon { transform-origin: 32px 33px; animation: qs3d_beacon_beat 1.6s ease-in-out infinite; }
    `}</style>

    {/* 3D Base Squircle with Bevel and Inner Depth */}
    <rect x="3" y="3" width="58" height="58" rx="17" fill="url(#qs3d_base)" />
    <rect x="3.5" y="3.5" width="57" height="57" rx="16.5" stroke="url(#qs3d_rim)" strokeWidth="1.2" />

    {/* Diagonal Moving Glass Gleam Beam */}
    <g clipPath="url(#qs3d_clip)">
      <rect x="-30" y="-15" width="35" height="95" fill="url(#qs3d_gleam)" className="qs3d-gleam" />
    </g>

    {/* 3D Isometric SoundBox Cube Facets */}
    <path d="M16 26L32 17L48 26L32 35L16 26Z" fill="#0d3f66" stroke="#38bdf8" strokeWidth="0.8" strokeOpacity="0.6" />
    <path d="M16 26L32 35V49L16 40V26Z" fill="#08253f" stroke="#38bdf8" strokeWidth="0.8" strokeOpacity="0.4" />
    <path d="M32 35L48 26V40L32 49V35Z" fill="#041629" stroke="#38bdf8" strokeWidth="0.8" strokeOpacity="0.4" />

    {/* Integrated Smart POS Slot & Golden EMV Micro-Chip on Cube Top */}
    <path d="M25 21L32 17.2L39 21.2L32 25L25 21Z" fill="#02111f" stroke="#34d399" strokeWidth="0.6" strokeOpacity="0.8" />
    <rect x="30" y="19" width="4" height="2.5" rx="0.5" fill="#fbbf24" stroke="#d97706" strokeWidth="0.4" />

    {/* 3D Pulsing Acoustic Speaker Driver in Center */}
    <g className="qs3d-core">
      <circle cx="32" cy="33" r="11" fill="#02111f" stroke="url(#qs3d_wave)" strokeWidth="1.6" filter="url(#qs3d_glow)" />
      <circle cx="32" cy="33" r="8" fill="url(#qs3d_cone)" />
      <circle cx="32" cy="33" r="4.5" fill="#00f2fe" fillOpacity="0.25" stroke="#34d399" strokeWidth="1.2" />
      <circle cx="32" cy="33" r="2.2" fill="#ffffff" />
      <circle cx="32" cy="33" r="1.8" fill="#34d399" className="qs3d-beacon" />
    </g>

    {/* Dynamic 3D Sound Wave Broadcast Arcs Left & Right */}
    <path
      d="M17 25C13.5 28 11.5 31 11.5 34C11.5 37 13.5 40 17 43"
      stroke="url(#qs3d_wave)"
      strokeWidth="2.4"
      strokeLinecap="round"
      className="qs3d-wl1"
      filter="url(#qs3d_glow)"
    />
    <path
      d="M11 20C6.5 24.5 4 29 4 34C4 39 6.5 43.5 11 48"
      stroke="url(#qs3d_wave)"
      strokeWidth="2.2"
      strokeLinecap="round"
      className="qs3d-wl2"
      strokeOpacity="0.85"
    />

    <path
      d="M47 25C50.5 28 52.5 31 52.5 34C52.5 37 50.5 40 47 43"
      stroke="url(#qs3d_wave)"
      strokeWidth="2.4"
      strokeLinecap="round"
      className="qs3d-wr1"
      filter="url(#qs3d_glow)"
    />
    <path
      d="M53 20C57.5 24.5 60 29 60 34C60 39 57.5 43.5 53 48"
      stroke="url(#qs3d_wave)"
      strokeWidth="2.2"
      strokeLinecap="round"
      className="qs3d-wr2"
      strokeOpacity="0.85"
    />
  </svg>
);

/**
 * 2. 3D Preset: Fintech Pulse (Smart POS Terminal with Holographic Wave & SoundBox Broadcast)
 */
export const SvgFintechPulse: React.FC<{ className?: string }> = ({ className = 'w-full h-full' }) => (
  <svg
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="fp3d_base" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#00182e" />
        <stop offset="50%" stopColor="#003554" />
        <stop offset="100%" stopColor="#004e75" />
      </linearGradient>
      <linearGradient id="fp3d_rim" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#7dd3fc" stopOpacity="0.8" />
        <stop offset="100%" stopColor="#ffffff" stopOpacity="0.2" />
      </linearGradient>
      <linearGradient id="fp3d_screen" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#020d18" />
        <stop offset="100%" stopColor="#061e33" />
      </linearGradient>
      <linearGradient id="fp3d_glow" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#38bdf8" />
        <stop offset="50%" stopColor="#00f2fe" />
        <stop offset="100%" stopColor="#34d399" />
      </linearGradient>
      <filter id="fp3d_neon" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="1.5" result="b" />
        <feComposite in="SourceGraphic" in2="b" operator="over" />
      </filter>
      <clipPath id="fp3d_scr_clip">
        <rect x="16.5" y="18" width="17" height="20" rx="3" />
      </clipPath>
    </defs>

    <style>{`
      @keyframes fp3d_scan {
        0% { transform: translateY(-16px); opacity: 0; }
        30% { opacity: 0.95; }
        70% { opacity: 0.95; }
        100% { transform: translateY(22px); opacity: 0; }
      }
      @keyframes fp3d_nfc_pulse {
        0%, 100% { opacity: 0.35; transform: scale(0.96); }
        50% { opacity: 1; transform: scale(1.05); }
      }
      @keyframes fp3d_chip_glow {
        0%, 80%, 100% { filter: brightness(1); }
        90% { filter: brightness(1.6); }
      }
      .fp3d-scan-line { animation: fp3d_scan 2.6s ease-in-out infinite; }
      .fp3d-nfc { transform-origin: 25px 12px; animation: fp3d_nfc_pulse 2s ease-in-out infinite; }
      .fp3d-chip { animation: fp3d_chip_glow 3.2s ease-in-out infinite; }
    `}</style>

    {/* Squircle Base with Metallic Depth */}
    <rect x="3" y="3" width="58" height="58" rx="17" fill="url(#fp3d_base)" />
    <rect x="3.5" y="3.5" width="57" height="57" rx="16.5" stroke="url(#fp3d_rim)" strokeWidth="1.2" />

    {/* 3D Smart POS Terminal Body with Drop Depth */}
    <rect x="13" y="14" width="24" height="38" rx="6" fill="#082038" stroke="#38bdf8" strokeWidth="1" strokeOpacity="0.4" />
    <rect x="14" y="15" width="22" height="36" rx="5" fill="#ffffff" />
    <rect x="14.5" y="15.5" width="21" height="35" rx="4.5" stroke="#cbd5e1" strokeWidth="0.8" />

    {/* OLED Screen */}
    <rect x="16.5" y="18" width="17" height="20" rx="3" fill="url(#fp3d_screen)" />

    {/* Animated Scanner Bar in Screen */}
    <g clipPath="url(#fp3d_scr_clip)">
      <line x1="15" y1="26" x2="35" y2="26" stroke="url(#fp3d_glow)" strokeWidth="1.8" className="fp3d-scan-line" filter="url(#fp3d_neon)" />
    </g>

    {/* Screen QR Elements */}
    <rect x="20" y="21" width="3.5" height="3.5" rx="0.8" fill="#38bdf8" />
    <rect x="26" y="21" width="3.5" height="3.5" rx="0.8" fill="#34d399" />
    <rect x="20" y="27" width="3.5" height="3.5" rx="0.8" fill="#34d399" />
    <circle cx="27.5" cy="28.5" r="1.8" fill="#38bdf8" />

    {/* Golden Security EMV Chip */}
    <g className="fp3d-chip">
      <rect x="18" y="41" width="6.5" height="4.5" rx="1" fill="#fbbf24" stroke="#b45309" strokeWidth="0.5" />
      <line x1="21.2" y1="41" x2="21.2" y2="45.5" stroke="#78350f" strokeWidth="0.4" />
    </g>
    <rect x="27" y="42" width="6.5" height="2" rx="0.8" fill="#003857" />

    {/* Contactless NFC Radar at Terminal Top */}
    <g className="fp3d-nfc">
      <path d="M21 11C23 9.5 27 9.5 29 11" stroke="url(#fp3d_glow)" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M19 8C22.5 6 27.5 6 31 8" stroke="url(#fp3d_glow)" strokeWidth="1.8" strokeLinecap="round" strokeOpacity="0.7" />
    </g>

    {/* Acoustic Sound Waves emanating rightward from SoundBox Module */}
    <path d="M41 24C44 26.5 46 29.5 46 33C46 36.5 44 39.5 41 42" stroke="url(#fp3d_glow)" strokeWidth="2.4" strokeLinecap="round" filter="url(#fp3d_neon)" />
    <path d="M47 19C52 23 55 28 55 33C55 38 52 43 47 47" stroke="url(#fp3d_glow)" strokeWidth="2.2" strokeLinecap="round" strokeOpacity="0.8" />
    <circle cx="40" cy="33" r="2" fill="#34d399" />
  </svg>
);

/**
 * 3. 3D Preset: Apex Terminal (Futuristic Handheld POS with Contactless Ripple & EMV Processor)
 */
export const SvgApexPos: React.FC<{ className?: string }> = ({ className = 'w-full h-full' }) => (
  <svg
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="apexBg" x1="0%" y1="0%" x2="100%" y2="100%">
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
    <style>{`
      @keyframes apex_nfc {
        0%, 100% { opacity: 0.35; transform: scale(0.95); }
        50% { opacity: 1; transform: scale(1.08); }
      }
      .apex-nfc-waves { transform-origin: 32px 24px; animation: apex_nfc 2.4s ease-in-out infinite; }
    `}</style>
    <rect x="3" y="3" width="58" height="58" rx="17" fill="url(#apexBg)" />
    <rect x="3.5" y="3.5" width="57" height="57" rx="16.5" stroke="white" strokeOpacity="0.16" strokeWidth="1.2" />

    {/* Modern Handheld Terminal Frame */}
    <rect x="16" y="12" width="32" height="40" rx="7" fill="#132644" stroke="#38bdf8" strokeWidth="1.4" strokeOpacity="0.6" />
    <rect x="19.5" y="15.5" width="25" height="22" rx="4" fill="#061224" />

    {/* Contactless NFC Waves */}
    <g className="apex-nfc-waves">
      <path d="M28 22C29.5 20.5 34.5 20.5 36 22" stroke="url(#apexGlow)" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M25 25C28 23 36 23 39 25" stroke="url(#apexGlow)" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="32" cy="29" r="2.5" fill="url(#apexGlow)" />
    </g>

    {/* Gold Smart EMV Security Chip */}
    <rect x="20" y="41.5" width="9" height="6" rx="1.5" fill="url(#apexGold)" />
    <line x1="24.5" y1="41.5" x2="24.5" y2="47.5" stroke="#92400e" strokeWidth="0.8" />
    <line x1="20" y1="44.5" x2="29" y2="44.5" stroke="#92400e" strokeWidth="0.8" />

    {/* Receipt Emitter Slot */}
    <line x1="33" y1="44.5" x2="43" y2="44.5" stroke="white" strokeOpacity="0.75" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

/**
 * 4. 3D Preset: Bank Vault Shield (Institutional Security & Verified Settlement)
 */
export const SvgBankShield: React.FC<{ className?: string }> = ({ className = 'w-full h-full' }) => (
  <svg
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="shieldBg" x1="0%" y1="0%" x2="100%" y2="100%">
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
    <style>{`
      @keyframes shield_pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.05); filter: drop-shadow(0 0 6px rgba(16, 185, 129, 0.6)); }
      }
      .shield-check { transform-origin: 32px 32px; animation: shield_pulse 2.2s ease-in-out infinite; }
    `}</style>
    <rect x="3" y="3" width="58" height="58" rx="17" fill="url(#shieldBg)" />
    <rect x="3.5" y="3.5" width="57" height="57" rx="16.5" stroke="white" strokeOpacity="0.16" strokeWidth="1.2" />

    {/* Sovereign Vault Shield */}
    <path
      d="M32 11L49 17.5V31C49 41.5 41 49.5 32 53C23 49.5 15 41.5 15 31V17.5L32 11Z"
      fill="#082845"
      stroke="url(#goldRim)"
      strokeWidth="2.5"
      strokeLinejoin="round"
    />
    <path
      d="M32 15.5L44.5 20.5V31C44.5 39.2 38.5 45.5 32 48.2C25.5 45.5 19.5 39.2 19.5 31V20.5L32 15.5Z"
      fill="#041a2e"
      stroke="white"
      strokeOpacity="0.14"
      strokeWidth="1.2"
    />

    {/* Verified Settlement Checkmark */}
    <g className="shield-check">
      <path
        d="M25 31.5L30 36.5L39 26.5"
        stroke="url(#shieldCyan)"
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="41" r="2" fill="#eab308" />
    </g>
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
  'quantum-sound': {
    name: 'SoundBox 3D Acoustic Hub',
    description: '3D isometric acoustic sound box with real-time pulsing speaker cone and expanding 3D broadcast waves.',
    tag: 'Flagship 3D',
    Component: SvgQuantumSound,
  },
  'fintech-pulse': {
    name: 'Smart POS & Audio 3D',
    description: '3D smart payment terminal with active OLED laser scan, contactless NFC ripples, and soundwave broadcast.',
    tag: 'POS Core 3D',
    Component: SvgFintechPulse,
  },
  'apex-pos': {
    name: 'Apex Smart Terminal 3D',
    description: 'Futuristic handheld terminal with OLED contactless NFC display, gold EMV chip, and 3D depth.',
    tag: 'Modern 3D',
    Component: SvgApexPos,
  },
  'bank-shield': {
    name: 'Institutional Vault Shield 3D',
    description: 'Chiseled 3D sovereign gold-rimmed security shield with verified settlement checkmark.',
    tag: 'Executive 3D',
    Component: SvgBankShield,
  },
};

/**
 * Next-Gen 3D Animated Brand Logo Component
 * Features smooth hardware-accelerated 3D floating levitation,
 * interactive 3D parallax mouse tilt, and ambient neon glow.
 */
export const AppBrandLogo: React.FC<AppBrandLogoProps> = ({
  logoUrl,
  presetId = 'quantum-sound',
  size = 'md',
  className = '',
  showGlow = false,
  altText = 'POS & Sound Box Stock Inventory Logo',
  animate3D = true,
  interactive = true,
}) => {
  const [imgError, setImgError] = useState(false);
  const [tilt, setTilt] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const sizeStyle = SIZE_MAP[size] || SIZE_MAP.md;
  const ActiveComponent = PRESET_META[presetId]?.Component || SvgQuantumSound;

  // Reset error if URL changes
  React.useEffect(() => {
    setImgError(false);
  }, [logoUrl]);

  // Interactive 3D mouse parallax tilt
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!interactive || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5; // -0.5 to 0.5
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      setTilt({ x: x * 22, y: -y * 22 });
      setIsHovered(true);
    },
    [interactive]
  );

  const handleMouseLeave = useCallback(() => {
    if (!interactive) return;
    setTilt({ x: 0, y: 0 });
    setIsHovered(false);
  }, [interactive]);

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        perspective: 600,
        transformStyle: 'preserve-3d',
      }}
      className={`relative inline-flex items-center justify-center shrink-0 ${sizeStyle.box} ${className}`}
    >
      {/* 3D Ambient Neon Glow Halo */}
      {showGlow && (
        <span
          className={`absolute inset-0 rounded-2xl bg-gradient-to-tr from-sky-500/30 via-cyan-400/20 to-emerald-400/25 ${sizeStyle.glow} -z-10 animate-pulse pointer-events-none`}
        />
      )}

      {/* 3D Levitating & Tilting Core Frame */}
      <div
        style={{
          transform: isHovered
            ? `rotateX(${tilt.y}deg) rotateY(${tilt.x}deg) translateZ(8px) scale(1.05)`
            : animate3D
            ? undefined
            : 'none',
          transition: isHovered
            ? 'transform 0.1s cubic-bezier(0.2, 0, 0.2, 1)'
            : 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
          transformStyle: 'preserve-3d',
        }}
        className={`w-full h-full flex items-center justify-center ${
          animate3D && !isHovered ? 'animate-[logoFloat3D_4s_ease-in-out_infinite]' : ''
        }`}
      >
        {logoUrl && !imgError ? (
          <div className="w-full h-full p-0.5 rounded-xl overflow-hidden bg-white/10 backdrop-blur-xs border border-white/20 shadow-md">
            <img
              src={logoUrl}
              alt={altText}
              onError={() => setImgError(true)}
              className="w-full h-full object-contain rounded-lg drop-shadow-xs"
            />
          </div>
        ) : (
          <ActiveComponent className="w-full h-full drop-shadow-sm select-none" />
        )}
      </div>

      {/* Global CSS for 3D Levitating Float Motion */}
      <style>{`
        @keyframes logoFloat3D {
          0%, 100% {
            transform: translateY(0px) rotateX(0deg) rotateY(0deg);
          }
          50% {
            transform: translateY(-2.5px) rotateX(3.5deg) rotateY(-2.5deg);
          }
        }
      `}</style>
    </div>
  );
};

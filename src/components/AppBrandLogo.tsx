import React, { useState, useRef, useCallback } from 'react';

export type LogoPresetId = 'merchant-store' | 'quantum-sound' | 'fintech-pulse' | 'apex-pos' | 'bank-shield';

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
  md: { box: 'w-9 h-9 rounded-xl', icon: 'w-7 h-7', glow: 'blur-xs' },
  lg: { box: 'w-12 h-12 rounded-2xl', icon: 'w-9 h-9', glow: 'blur-sm' },
  xl: { box: 'w-16 h-16 rounded-2xl', icon: 'w-12 h-12', glow: 'blur-md' },
  '2xl': { box: 'w-24 h-24 rounded-3xl', icon: 'w-18 h-18', glow: 'blur-lg' },
};

/**
 * Modern Flat Vector: Verified Merchant Storefront Logo
 * Inspired directly by the boutique retail storefront emblem:
 * Features a circular deep sapphire canvas, pure white store facade,
 * 5-stripe scalloped emerald and mint canopy, navy door with mint knob,
 * dual-pane showcase windows, and prominent verified checkmark badge.
 */
export const SvgMerchantStore: React.FC<{ className?: string }> = ({ className = 'w-full h-full' }) => (
  <svg
    viewBox="0 0 100 100"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <defs>
      {/* Subtle deep sapphire background */}
      <radialGradient id="flat_store_bg" cx="50%" cy="46%" r="52%">
        <stop offset="0%" stopColor="#124e7c" />
        <stop offset="60%" stopColor="#0b385c" />
        <stop offset="100%" stopColor="#07263f" />
      </radialGradient>
    </defs>

    {/* Circular Background Container */}
    <circle cx="50" cy="50" r="48" fill="url(#flat_store_bg)" />

    {/* Concentric Accent Rings */}
    <circle cx="50" cy="50" r="44" stroke="rgba(255,255,255,0.08)" strokeWidth="0.75" />
    <circle cx="50" cy="50" r="37" stroke="rgba(255,255,255,0.05)" strokeWidth="0.75" />

    {/* Storefront Group */}
    <g>
      {/* White Store Building Facade */}
      <path
        d="M 30,38 L 70,38 L 70,61 Q 70,64 67,64 L 33,64 Q 30,64 30,61 Z"
        fill="#ffffff"
      />

      {/* Doorway */}
      <rect x="34.5" y="47.5" width="10.5" height="16.5" rx="1.2" fill="#0d385c" />
      <circle cx="42.5" cy="55.5" r="1" fill="#00d8a0" />

      {/* Windows (Two Panes) */}
      <rect x="48.5" y="47.5" width="8.5" height="10" rx="1" fill="#0d385c" />
      <rect x="58" y="47.5" width="8.5" height="10" rx="1" fill="#0d385c" />

      {/* Scalloped Awning Stripes (5 Vertical Stripes) */}
      {/* Stripe 1 (Leftmost): Dark Teal */}
      <path
        d="M 27.5,30 L 36.5,30 L 36.5,39 Q 32,43.5 27.5,39 Z"
        fill="#00997b"
      />
      {/* Stripe 2: Mint Teal */}
      <path
        d="M 36.5,30 L 45.5,30 L 45.5,39 Q 41,43.5 36.5,39 Z"
        fill="#61e3c2"
      />
      {/* Stripe 3 (Center): Dark Teal */}
      <path
        d="M 45.5,30 L 54.5,30 L 54.5,39 Q 50,43.5 45.5,39 Z"
        fill="#00997b"
      />
      {/* Stripe 4: Mint Teal */}
      <path
        d="M 54.5,30 L 63.5,30 L 63.5,39 Q 59,43.5 54.5,39 Z"
        fill="#61e3c2"
      />
      {/* Stripe 5 (Rightmost): Dark Teal */}
      <path
        d="M 63.5,30 L 72.5,30 L 72.5,39 Q 68,43.5 63.5,39 Z"
        fill="#00997b"
      />

      {/* Top Roof Fascia Beam */}
      <rect x="25.5" y="26" width="49" height="4.5" rx="2.25" fill="#ffffff" />
    </g>

    {/* Verified Checkmark Badge */}
    <g>
      {/* Separation Outer Mask Ring */}
      <circle cx="71" cy="63.5" r="13" fill="#082944" />
      {/* Emerald Badge Disc */}
      <circle cx="71" cy="63.5" r="10.2" fill="#1cb38b" />
      {/* Clean White Checkmark */}
      <path
        d="M 66,63.5 L 69.5,67 L 76.5,59.5"
        stroke="#ffffff"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  </svg>
);

export const SvgQuantumSound: React.FC<{ className?: string }> = ({ className = 'w-full h-full' }) => (
  <svg
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <defs>
      {/*  */}
      <linearGradient id="qs_base" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#141824" />
        <stop offset="40%" stopColor="#0a0d14" />
        <stop offset="100%" stopColor="#040508" />
      </linearGradient>

      {/*  */}
      <linearGradient id="qs_rim" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
        <stop offset="35%" stopColor="#94a3b8" stopOpacity="0.35" />
        <stop offset="70%" stopColor="#38bdf8" stopOpacity="0.45" />
        <stop offset="100%" stopColor="#ffffff" stopOpacity="0.75" />
      </linearGradient>

      {/*  */}
      <linearGradient id="qs_gold" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#fff3b0" />
        <stop offset="25%" stopColor="#fbbf24" />
        <stop offset="65%" stopColor="#d97706" />
        <stop offset="100%" stopColor="#92400e" />
      </linearGradient>

      {/*  */}
      <linearGradient id="qs_sapphire" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#004b80" />
        <stop offset="45%" stopColor="#002d4c" />
        <stop offset="100%" stopColor="#001424" />
      </linearGradient>

      {/*  */}
      <linearGradient id="qs_gleam" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
        <stop offset="50%" stopColor="#ffffff" stopOpacity="0.42" />
        <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
      </linearGradient>

      <clipPath id="qs_clip">
        <rect x="3" y="3" width="58" height="58" rx="17" />
      </clipPath>
    </defs>

    <style>{`
      @keyframes qs_gleam_sweep {
        0% { transform: translateX(-80px) rotate(32deg); }
        22% { transform: translateX(95px) rotate(32deg); }
        100% { transform: translateX(95px) rotate(32deg); }
      }
      @keyframes qs_acoustic_pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.07); filter: drop-shadow(0 0 4px rgba(251, 191, 36, 0.7)); }
      }
      @keyframes qs_wave_glow {
        0%, 100% { opacity: 0.45; }
        50% { opacity: 1; }
      }
      .qs-gleam { animation: qs_gleam_sweep 4.8s cubic-bezier(0.4, 0, 0.2, 1) infinite; }
      .qs-core { transform-origin: 39px 33px; animation: qs_acoustic_pulse 2.6s ease-in-out infinite; }
      .qs-wave { animation: qs_wave_glow 2.6s ease-in-out infinite; }
    `}</style>

    {/*  */}
    <rect x="3" y="3" width="58" height="58" rx="17" fill="url(#qs_base)" />
    <rect x="3.5" y="3.5" width="57" height="57" rx="16.5" stroke="url(#qs_rim)" strokeWidth="1.2" />
    <rect x="5.5" y="5.5" width="53" height="53" rx="14.5" stroke="url(#qs_gold)" strokeWidth="0.5" strokeOpacity="0.25" />

    {/*  */}
    <g clipPath="url(#qs_clip)">
      <rect x="-35" y="-15" width="28" height="95" fill="url(#qs_gleam)" className="qs-gleam" />
    </g>

    {/*  */}
    <path
      d="M14 20C14 16.5 16.5 14 20 14H29C31.8 14 34 16.2 34 19V41C34 43.8 31.8 46 29 46H20C16.5 46 14 43.5 14 40V20Z"
      fill="url(#qs_sapphire)"
      stroke="url(#qs_rim)"
      strokeWidth="0.9"
    />
    {/*  */}
    <rect x="16.5" y="17.5" width="15" height="15" rx="3" fill="#040912" stroke="#38bdf8" strokeWidth="0.6" strokeOpacity="0.4" />
    {/*  */}
    <rect x="19" y="20" width="3" height="3" rx="0.5" fill="#38bdf8" />
    <rect x="25" y="20" width="3" height="3" rx="0.5" fill="url(#qs_gold)" />
    <rect x="19" y="26" width="3" height="3" rx="0.5" fill="url(#qs_gold)" />
    <circle cx="26.5" cy="27.5" r="1.5" fill="#38bdf8" />

    {/*  */}
    <path d="M20.5 11C23 9.5 26.5 9.5 29 11" stroke="url(#qs_gold)" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M18.5 8.5C22.5 6.5 27.5 6.5 31.5 8.5" stroke="url(#qs_gold)" strokeWidth="1.3" strokeLinecap="round" strokeOpacity="0.65" />

    {/*  */}
    <rect x="18" y="36" width="7" height="5" rx="1.2" fill="url(#qs_gold)" stroke="#78350f" strokeWidth="0.4" />
    <line x1="21.5" y1="36" x2="21.5" y2="41" stroke="#78350f" strokeWidth="0.4" />
    <line x1="18" y1="38.5" x2="25" y2="38.5" stroke="#78350f" strokeWidth="0.4" />

    {/*  */}
    <g className="qs-core">
      <circle cx="39" cy="33" r="12" fill="#050a14" stroke="url(#qs_rim)" strokeWidth="1" />
      <circle cx="39" cy="33" r="9" fill="url(#qs_sapphire)" stroke="url(#qs_gold)" strokeWidth="1" />
      <circle cx="39" cy="33" r="5" fill="#02060d" stroke="url(#qs_gold)" strokeWidth="1.2" />
      <circle cx="39" cy="33" r="2.2" fill="url(#qs_gold)" />
    </g>

    {/*  */}
    <path
      d="M49 24C52 26.5 54 29.5 54 33C54 36.5 52 39.5 49 42"
      stroke="url(#qs_gold)"
      strokeWidth="2.2"
      strokeLinecap="round"
      className="qs-wave"
    />
    <path
      d="M54 19C58.5 23 61 27.8 61 33C61 38.2 58.5 43 54 47"
      stroke="url(#qs_gold)"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeOpacity="0.75"
      className="qs-wave"
    />
  </svg>
);

/**
 * 2. Apex POS Core 3D
 * Sleek smart payment terminal in chiseled titanium and obsidian with active laser horizon.
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
      <linearGradient id="fp_base" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#111622" />
        <stop offset="100%" stopColor="#040609" />
      </linearGradient>
      <linearGradient id="fp_rim" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.8" />
        <stop offset="50%" stopColor="#38bdf8" stopOpacity="0.4" />
        <stop offset="100%" stopColor="#ffffff" stopOpacity="0.6" />
      </linearGradient>
      <linearGradient id="fp_gold" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#fff3b0" />
        <stop offset="40%" stopColor="#fbbf24" />
        <stop offset="100%" stopColor="#b45309" />
      </linearGradient>
      <linearGradient id="fp_glass" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#031526" />
        <stop offset="100%" stopColor="#01070e" />
      </linearGradient>
      <clipPath id="fp_clip">
        <rect x="3" y="3" width="58" height="58" rx="17" />
      </clipPath>
    </defs>
    <style>{`
      @keyframes fp_scan_line {
        0% { transform: translateY(-12px); opacity: 0; }
        30%, 70% { opacity: 0.95; }
        100% { transform: translateY(18px); opacity: 0; }
      }
      .fp-scan { animation: fp_scan_line 2.8s ease-in-out infinite; }
    `}</style>

    <rect x="3" y="3" width="58" height="58" rx="17" fill="url(#fp_base)" />
    <rect x="3.5" y="3.5" width="57" height="57" rx="16.5" stroke="url(#fp_rim)" strokeWidth="1.2" />

    {/* Handheld Terminal Body in Midnight Navy & Titanium */}
    <rect x="18" y="11" width="28" height="42" rx="7" fill="#0b1828" stroke="url(#fp_rim)" strokeWidth="1" />
    <rect x="21" y="14" width="22" height="23" rx="4" fill="url(#fp_glass)" stroke="#38bdf8" strokeWidth="0.6" strokeOpacity="0.5" />

    {/* Laser Horizon Scanner */}
    <g clipPath="url(#fp_clip)">
      <line x1="21" y1="25" x2="43" y2="25" stroke="url(#fp_gold)" strokeWidth="1.5" className="fp-scan" />
    </g>

    {/* NFC Waves */}
    <path d="M28 19C30 18 34 18 36 19" stroke="url(#fp_gold)" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="32" cy="24" r="2.2" fill="#38bdf8" />

    {/* Gold EMV Chip */}
    <rect x="23" y="41" width="8" height="5.5" rx="1.2" fill="url(#fp_gold)" />
    <line x1="34" y1="44" x2="42" y2="44" stroke="#ffffff" strokeOpacity="0.75" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/**
 * 3. Apex Smart Terminal 3D
 * Executive handheld device with gold EMV chip and OLED contactless interface.
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
      <linearGradient id="apex_base" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#0a0e17" />
        <stop offset="100%" stopColor="#040508" />
      </linearGradient>
      <linearGradient id="apex_gold" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#fff3b0" />
        <stop offset="35%" stopColor="#fbbf24" />
        <stop offset="100%" stopColor="#b45309" />
      </linearGradient>
      <linearGradient id="apex_rim" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
        <stop offset="100%" stopColor="#64748b" stopOpacity="0.3" />
      </linearGradient>
    </defs>
    <style>{`
      @keyframes apex_glow {
        0%, 100% { transform: scale(1); opacity: 0.8; }
        50% { transform: scale(1.08); opacity: 1; filter: drop-shadow(0 0 5px rgba(251, 191, 36, 0.6)); }
      }
      .apex-pulse { transform-origin: 32px 24px; animation: apex_glow 2.4s ease-in-out infinite; }
    `}</style>
    <rect x="3" y="3" width="58" height="58" rx="17" fill="url(#apex_base)" />
    <rect x="3.5" y="3.5" width="57" height="57" rx="16.5" stroke="url(#apex_rim)" strokeWidth="1.2" />

    {/* Terminal Core */}
    <rect x="16" y="11" width="32" height="42" rx="7" fill="#0c1726" stroke="#38bdf8" strokeWidth="1" strokeOpacity="0.4" />
    <rect x="19.5" y="14.5" width="25" height="23" rx="4" fill="#020912" />

    <g className="apex-pulse">
      <path d="M28 21C29.5 19.5 34.5 19.5 36 21" stroke="url(#apex_gold)" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M25 24C28 22 36 22 39 24" stroke="url(#apex_gold)" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="32" cy="28.5" r="2.5" fill="#38bdf8" />
    </g>

    <rect x="21" y="41.5" width="9" height="6" rx="1.5" fill="url(#apex_gold)" />
    <line x1="33" y1="44.5" x2="43" y2="44.5" stroke="white" strokeOpacity="0.75" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

/**
 * 4. Sovereign Institutional Vault Shield 3D
 * Chiseled 3D 24K gold-rimmed security shield with verified settlement checkmark.
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
      <linearGradient id="sh_base" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#0b101d" />
        <stop offset="100%" stopColor="#04060a" />
      </linearGradient>
      <linearGradient id="sh_gold" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#fff3b0" />
        <stop offset="25%" stopColor="#fde047" />
        <stop offset="65%" stopColor="#eab308" />
        <stop offset="100%" stopColor="#92400e" />
      </linearGradient>
      <linearGradient id="sh_rim" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
        <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.3" />
      </linearGradient>
      <linearGradient id="sh_cyan" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#38bdf8" />
        <stop offset="100%" stopColor="#10b981" />
      </linearGradient>
    </defs>
    <style>{`
      @keyframes sh_beat {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.06); filter: drop-shadow(0 0 6px rgba(16, 185, 129, 0.6)); }
      }
      .sh-check { transform-origin: 32px 32px; animation: sh_beat 2.4s ease-in-out infinite; }
    `}</style>
    <rect x="3" y="3" width="58" height="58" rx="17" fill="url(#sh_base)" />
    <rect x="3.5" y="3.5" width="57" height="57" rx="16.5" stroke="url(#sh_rim)" strokeWidth="1.2" />

    {/* 3D Chiseled Vault Shield */}
    <path
      d="M32 11L49 17.5V31C49 41.5 41 49.5 32 53C23 49.5 15 41.5 15 31V17.5L32 11Z"
      fill="#061b30"
      stroke="url(#sh_gold)"
      strokeWidth="2.5"
      strokeLinejoin="round"
    />
    <path
      d="M32 15.5L44.5 20.5V31C44.5 39.2 38.5 45.5 32 48.2C25.5 45.5 19.5 39.2 19.5 31V20.5L32 15.5Z"
      fill="#020d18"
      stroke="white"
      strokeOpacity="0.16"
      strokeWidth="1.2"
    />

    <g className="sh-check">
      <path
        d="M25 31.5L30 36.5L39 26.5"
        stroke="url(#sh_cyan)"
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="41" r="2.2" fill="url(#sh_gold)" />
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
  'merchant-store': {
    name: 'Verified Merchant Hub',
    description: 'Clean modern flat storefront emblem with scalloped emerald and mint canopy, navy apertures, and verified checkmark badge.',
    tag: 'Official Brand',
    Component: SvgMerchantStore,
  },
  'quantum-sound': {
    name: 'Sovereign POS & SoundBox 3D',
    description: 'Chiseled obsidian & sapphire 3D dual-hardware emblem with 24K royal gold EMV chip, acoustic driver, and broadcast waves.',
    tag: 'Flagship Luxury',
    Component: SvgQuantumSound,
  },
  'fintech-pulse': {
    name: 'Apex Dual-Core Terminal 3D',
    description: 'Executive handheld terminal in polished obsidian, OLED laser horizon, and contactless acoustic radar.',
    tag: 'Executive POS',
    Component: SvgFintechPulse,
  },
  'apex-pos': {
    name: 'Titanium Smart Hub 3D',
    description: 'Precision brushed titanium and sapphire glass flagship terminal with golden EMV processor and 3D depth.',
    tag: 'Platinum Elite',
    Component: SvgApexPos,
  },
  'bank-shield': {
    name: 'Sovereign Vault Shield 3D',
    description: 'Chiseled 3D 24K gold-rimmed institutional security shield with sapphire facets and verified settlement checkmark.',
    tag: 'Institutional 3D',
    Component: SvgBankShield,
  },
};

/**
 * Next-Gen 3D Animated Luxury Brand Logo Component
 * Features hardware-accelerated 3D floating levitation,
 * interactive 3D parallax mouse tilt, and refined ambient shadow.
 */
export const AppBrandLogo: React.FC<AppBrandLogoProps> = ({
  logoUrl,
  presetId = 'merchant-store',
  size = 'md',
  className = '',
  showGlow = false,
  altText = 'POS & Sound Box Stock Inventory Logo',
  animate3D = false,
  interactive = false,
}) => {
  const [imgError, setImgError] = useState(false);
  const [tilt, setTilt] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const sizeStyle = SIZE_MAP[size] || SIZE_MAP.md;
  const ActiveComponent = PRESET_META[presetId]?.Component || SvgMerchantStore;

  // Reset error if URL changes
  React.useEffect(() => {
    setImgError(false);
  }, [logoUrl]);

  // Interactive 3D mouse parallax tilt
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!interactive || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      setTilt({ x: x * 20, y: -y * 20 });
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
      {/* Refined Luxury Ambient Backlight */}
      {showGlow && (
        <span
          className={`absolute inset-0 rounded-xl bg-gradient-to-tr from-sky-500/10 via-amber-400/10 to-transparent ${sizeStyle.glow} -z-10 pointer-events-none opacity-80`}
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
          <ActiveComponent className="w-full h-full drop-shadow-md select-none" />
        )}
      </div>

      {/* CSS for 3D Levitating Float Motion */}
      <style>{`
        @keyframes logoFloat3D {
          0%, 100% {
            transform: translateY(0px) rotateX(0deg) rotateY(0deg);
          }
          50% {
            transform: translateY(-2px) rotateX(3deg) rotateY(-2deg);
          }
        }
      `}</style>
    </div>
  );
};

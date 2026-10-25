import React, { useState, useRef, useCallback } from 'react';

export type LogoPresetId = 'merchant-store' | 'merchant-store-3d' | 'quantum-sound' | 'fintech-pulse' | 'apex-pos' | 'bank-shield';

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
 * 1. Flagship Luxury: Sovereign POS & SoundBox 3D (Default)
 * Sculpted obsidian & midnight sapphire dual-hardware prism.
 * Features smart terminal monolith, 24K royal gold EMV chip, acoustic driver core,
 * radiating sound waves, liquid platinum rim, and diagonal specular gleam.
 */
/**
 * Flagship Luxury: Verified Merchant Store 3D (Retina Vector)
 * Architectural ceramic storefront with 3D scalloped emerald & mint awning,
 * sapphire display aperture, and verified status checkmark badge.
 */
export const SvgMerchantStore: React.FC<{ className?: string }> = ({ className = 'w-full h-full' }) => (
  <svg
    viewBox="0 0 128 128"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <defs>
      {/* Background Deep Sapphire Disc */}
      <radialGradient id="ms_disc" cx="50%" cy="45%" r="55%">
        <stop offset="0%" stopColor="#004d80" />
        <stop offset="50%" stopColor="#002b48" />
        <stop offset="100%" stopColor="#001424" />
      </radialGradient>

      {/* Disc Rim Lighting */}
      <linearGradient id="ms_rim" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.6" />
        <stop offset="40%" stopColor="#38bdf8" stopOpacity="0.3" />
        <stop offset="100%" stopColor="#000000" stopOpacity="0.4" />
      </linearGradient>

      {/* Awning Scallop Colors */}
      <linearGradient id="ms_scallop_dark" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#00b58e" />
        <stop offset="65%" stopColor="#008f6f" />
        <stop offset="100%" stopColor="#006b52" />
      </linearGradient>

      <linearGradient id="ms_scallop_light" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#6ee7b7" />
        <stop offset="50%" stopColor="#34d399" />
        <stop offset="100%" stopColor="#10b981" />
      </linearGradient>

      {/* Store Wall White */}
      <linearGradient id="ms_wall" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="85%" stopColor="#f8fafc" />
        <stop offset="100%" stopColor="#e2e8f0" />
      </linearGradient>

      {/* Door & Window Sapphire */}
      <linearGradient id="ms_aperture" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#003454" />
        <stop offset="100%" stopColor="#001b2d" />
      </linearGradient>

      {/* Verified Badge Emerald */}
      <radialGradient id="ms_badge_glow" cx="40%" cy="35%" r="65%">
        <stop offset="0%" stopColor="#34d399" />
        <stop offset="45%" stopColor="#10b981" />
        <stop offset="90%" stopColor="#059669" />
        <stop offset="100%" stopColor="#047857" />
      </radialGradient>

      {/* Diagonal Specular Sheen */}
      <linearGradient id="ms_gleam" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
        <stop offset="50%" stopColor="#ffffff" stopOpacity="0.38" />
        <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
      </linearGradient>

      <clipPath id="ms_clip">
        <circle cx="64" cy="64" r="58" />
      </clipPath>

      <filter id="ms_shadow" x="-10%" y="-10%" width="120%" height="130%">
        <feDropShadow dx="0" dy="4" stdDeviation="3" floodColor="#000000" floodOpacity="0.3" />
      </filter>
    </defs>

    <style>{`
      @keyframes ms_gleam_sweep {
        0% { transform: translateX(-140px) rotate(30deg); }
        25% { transform: translateX(160px) rotate(30deg); }
        100% { transform: translateX(160px) rotate(30deg); }
      }
      @keyframes ms_badge_pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.04); filter: drop-shadow(0 0 6px rgba(52, 211, 153, 0.6)); }
      }
      .ms-gleam { animation: ms_gleam_sweep 5s cubic-bezier(0.4, 0, 0.2, 1) infinite; }
      .ms-badge { transform-origin: 92px 86px; animation: ms_badge_pulse 3s ease-in-out infinite; }
    `}</style>

    {/* Base Circular Disc with Outer Bezel */}
    <circle cx="64" cy="64" r="58" fill="url(#ms_disc)" />
    <circle cx="64" cy="64" r="58" stroke="url(#ms_rim)" strokeWidth="1.5" />

    {/* Concentric Orbital Rings */}
    <circle cx="64" cy="64" r="53" stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeDasharray="3 3" />
    <circle cx="64" cy="64" r="47" stroke="rgba(56,189,248,0.16)" strokeWidth="0.8" />

    {/* Storefront Group */}
    <g filter="url(#ms_shadow)">
      {/* White Wall Structure */}
      <rect x="36" y="46" width="56" height="42" rx="4" fill="url(#ms_wall)" />

      {/* Awning Under-Shadow on Wall */}
      <rect x="36" y="52" width="56" height="3" fill="#000000" opacity="0.12" />

      {/* Doorway */}
      <rect x="42" y="60" width="14" height="28" rx="2" fill="url(#ms_aperture)" />
      <circle cx="52.5" cy="74" r="1.6" fill="#10b981" />
      <circle cx="52.2" cy="73.6" r="0.5" fill="#ffffff" opacity="0.8" />

      {/* Display Windows */}
      <rect x="61" y="60" width="25" height="15" rx="2" fill="url(#ms_aperture)" />
      <line x1="73.5" y1="60" x2="73.5" y2="75" stroke="#ffffff" strokeWidth="1.5" />
      {/* Window Glint Slash */}
      <path d="M 62,75 L 67,60 L 69,60 L 64,75 Z" fill="#ffffff" opacity="0.22" />
      <path d="M 75,75 L 79,60 L 80.5,60 L 76.5,75 Z" fill="#ffffff" opacity="0.22" />

      {/* Roof Fascia Beam */}
      <rect x="29" y="32" width="70" height="7" rx="3.5" fill="#ffffff" />
      <line x1="32" y1="33" x2="96" y2="33" stroke="rgba(255,255,255,0.8)" strokeWidth="1" />

      {/* Scalloped Awning Stripes (5 Segments) */}
      <path d="M 32,38 L 44.8,38 L 44.8,50 Q 38.4,56 32,50 Z" fill="url(#ms_scallop_dark)" />
      <path d="M 44.8,38 L 57.6,38 L 57.6,50 Q 51.2,56 44.8,50 Z" fill="url(#ms_scallop_light)" />
      <path d="M 57.6,38 L 70.4,38 L 70.4,50 Q 64,56 57.6,50 Z" fill="url(#ms_scallop_dark)" />
      <path d="M 70.4,38 L 83.2,38 L 83.2,50 Q 76.8,56 70.4,50 Z" fill="url(#ms_scallop_light)" />
      <path d="M 83.2,38 L 96,38 L 96,50 Q 89.6,56 83.2,50 Z" fill="url(#ms_scallop_dark)" />

      {/* Canopy Top Seam Highlight */}
      <line x1="32" y1="38" x2="96" y2="38" stroke="rgba(255,255,255,0.4)" strokeWidth="0.8" />
    </g>

    {/* Verified Checkmark Badge (Foreground) */}
    <g className="ms-badge">
      {/* Badge Deep Shadow */}
      <circle cx="92" cy="87" r="18" fill="#000000" opacity="0.35" filter="blur(2px)" />
      {/* Badge Outer Navy Bezel */}
      <circle cx="92" cy="86" r="18" fill="#002238" />
      {/* Badge Emerald Body */}
      <circle cx="92" cy="86" r="15.5" fill="url(#ms_badge_glow)" />
      {/* Badge Specular Rim */}
      <path d="M 78,84 A 14 14 0 0 1 106,84 A 15.5 15.5 0 0 0 78,84" fill="#ffffff" opacity="0.4" />
      {/* Crisp White Checkmark */}
      <path
        d="M 84,86 L 89.5,91.5 L 100,79.5"
        stroke="#ffffff"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>

    {/* Diagonal Specular Gleam Sweep */}
    <g clipPath="url(#ms_clip)">
      <rect
        className="ms-gleam"
        x="-30"
        y="-30"
        width="28"
        height="180"
        fill="url(#ms_gleam)"
        pointerEvents="none"
      />
    </g>
  </svg>
);

/**
 * Flagship Luxury: Verified Merchant Hub (4K 3D Render)
 * Raytraced 3D render asset with tactile ceramic facade, 3D scalloped canopy, and glowing checkmark emblem.
 */
export const ImgMerchantStore3D: React.FC<{ className?: string }> = ({ className = 'w-full h-full' }) => (
  <div className={`relative w-full h-full rounded-2xl overflow-hidden flex items-center justify-center ${className}`}>
    <img
      src="/merchant-store-logo.png"
      alt="Verified Merchant Store 3D Logo"
      className="w-full h-full object-contain filter drop-shadow-md select-none"
      draggable={false}
    />
  </div>
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
    name: 'Verified Merchant Hub (Retina Vector)',
    description: 'High-resolution architectural ceramic storefront with 3D scalloped emerald & mint awning, sapphire display aperture, and verified status badge.',
    tag: 'Flagship Storefront',
    Component: SvgMerchantStore,
  },
  'merchant-store-3d': {
    name: 'Verified Merchant Hub (4K 3D Render)',
    description: 'Ultra-HD raytraced 3D render with tactile ceramic facade, 3D scalloped canopy, sapphire portal, and glowing verified checkmark emblem.',
    tag: 'Ultra-HD 3D',
    Component: ImgMerchantStore3D,
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
  animate3D = true,
  interactive = true,
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

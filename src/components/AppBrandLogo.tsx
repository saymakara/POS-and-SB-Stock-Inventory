import React, { useState } from 'react';

export type LogoPresetId = 'merchant-store';

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
 * Official System Logo: Verified Merchant Storefront
 * Pure 2D Flat Vector Emblem inspired directly by the verified storefront identity:
 * Features a modern squircle (rounded square) deep sapphire canvas, pure white store facade,
 * 5-stripe scalloped emerald and mint canopy, navy door with mint knob,
 * dual-pane showcase windows, and verified checkmark badge with smooth 2D animations.
 */
export const SvgMerchantStore: React.FC<{ className?: string; animated?: boolean }> = ({
  className = 'w-full h-full',
  animated = true,
}) => (
  <svg
    viewBox="0 0 100 100"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <defs>
      {/* Deep royal sapphire background */}
      <radialGradient id="vms_bg" cx="50%" cy="40%" r="65%">
        <stop offset="0%" stopColor="#145b8e" />
        <stop offset="55%" stopColor="#0e4773" />
        <stop offset="100%" stopColor="#082c4a" />
      </radialGradient>

      {/* Subtle linear 2D shimmer across awning and facade */}
      <linearGradient id="vms_shimmer" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
        <stop offset="50%" stopColor="#ffffff" stopOpacity="0.32" />
        <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
      </linearGradient>

      {/* Clip path for the 2D light sweep */}
      <clipPath id="vms_store_clip">
        <rect x="20" y="22" width="60" height="50" rx="4" />
      </clipPath>
    </defs>

    <style>{`
      @keyframes vms_badge_pulse {
        0%, 100% {
          transform: scale(1);
        }
        50% {
          transform: scale(1.06);
        }
      }
      @keyframes vms_radar_ring {
        0% {
          transform: scale(1);
          opacity: 0.85;
          stroke-width: 1.5;
        }
        60% {
          transform: scale(1.42);
          opacity: 0;
          stroke-width: 0.5;
        }
        100% {
          transform: scale(1.42);
          opacity: 0;
          stroke-width: 0;
        }
      }
      @keyframes vms_squircle_rim {
        0%, 100% {
          opacity: 0.18;
        }
        50% {
          opacity: 0.45;
        }
      }
      @keyframes vms_knob_beacon {
        0%, 100% {
          opacity: 0.8;
          transform: scale(1);
        }
        50% {
          opacity: 1;
          transform: scale(1.3);
        }
      }
      @keyframes vms_knob_ring {
        0% {
          transform: scale(1);
          opacity: 0.6;
        }
        50% {
          transform: scale(1.9);
          opacity: 0;
        }
        100% {
          transform: scale(1.9);
          opacity: 0;
        }
      }
      @keyframes vms_glint {
        0%, 25% {
          opacity: 0.2;
        }
        40% {
          opacity: 0.8;
        }
        60%, 100% {
          opacity: 0.2;
        }
      }
      @keyframes vms_awning_glow {
        0%, 100% {
          fill: #5ce2c0;
        }
        50% {
          fill: #7af3d6;
        }
      }
      @keyframes vms_flat_shimmer {
        0% {
          transform: translateX(-90px) skewX(-15deg);
        }
        28% {
          transform: translateX(130px) skewX(-15deg);
        }
        100% {
          transform: translateX(130px) skewX(-15deg);
        }
      }
      .vms-badge {
        transform-origin: 75px 68px;
        ${animated ? 'animation: vms_badge_pulse 2.8s ease-in-out infinite;' : ''}
      }
      .vms-radar {
        transform-origin: 75px 68px;
        ${animated ? 'animation: vms_radar_ring 2.8s ease-out infinite;' : ''}
      }
      .vms-rim {
        ${animated ? 'animation: vms_squircle_rim 3.6s ease-in-out infinite;' : ''}
      }
      .vms-knob {
        transform-origin: 41px 58px;
        ${animated ? 'animation: vms_knob_beacon 2.4s ease-in-out infinite;' : ''}
      }
      .vms-knob-halo {
        transform-origin: 41px 58px;
        ${animated ? 'animation: vms_knob_ring 2.4s ease-out infinite;' : ''}
      }
      .vms-glint {
        ${animated ? 'animation: vms_glint 3.2s ease-in-out infinite;' : ''}
      }
      .vms-awning-mint {
        ${animated ? 'animation: vms_awning_glow 3.6s ease-in-out infinite;' : ''}
      }
      .vms-shimmer-bar {
        ${animated ? 'animation: vms_flat_shimmer 5.5s cubic-bezier(0.4, 0, 0.2, 1) infinite;' : ''}
      }
    `}</style>

    {/* Squircle (Rounded Square) Background Container */}
    <rect x="3" y="3" width="94" height="94" rx="22" fill="url(#vms_bg)" />
    <rect x="3" y="3" width="94" height="94" rx="22" stroke="rgba(255, 255, 255, 0.16)" strokeWidth="1" />

    {/* Inner Subtle Squircle Accent Rim */}
    <rect className="vms-rim" x="7" y="7" width="86" height="86" rx="18" stroke="#1b6ca6" strokeWidth="0.8" />

    {/* Storefront Group */}
    <g>
      {/* White Store Building Facade */}
      <path
        d="M 27,37 L 73,37 L 73,65 Q 73,69 69,69 L 31,69 Q 27,69 27,65 Z"
        fill="#ffffff"
      />

      {/* Doorway */}
      <rect x="32" y="47.5" width="12" height="21.5" rx="1.5" fill="#0b375b" />
      {/* Doorknob with 2D beacon pulse and halo */}
      <circle className="vms-knob-halo" cx="41" cy="58" r="2.2" fill="#00d9a3" opacity="0.4" />
      <circle className="vms-knob" cx="41" cy="58" r="1.2" fill="#00d9a3" />

      {/* Windows (Two Panes) */}
      <rect x="48" y="47.5" width="10" height="12" rx="1.2" fill="#0b375b" />
      <rect x="59.5" y="47.5" width="10" height="12" rx="1.2" fill="#0b375b" />

      {/* Window Daylight Glint Highlights */}
      <line className="vms-glint" x1="49.5" y1="57.5" x2="56.5" y2="49.5" stroke="#5ce2c0" strokeWidth="1" strokeLinecap="round" opacity="0.4" />
      <line className="vms-glint" x1="61" y1="57.5" x2="68" y2="49.5" stroke="#5ce2c0" strokeWidth="1" strokeLinecap="round" opacity="0.4" />

      {/* Scalloped Awning Stripes (5 Vertical Stripes) */}
      {/* Stripe 1 (Leftmost): Dark Teal */}
      <path
        d="M 23,28 L 33.8,28 L 33.8,37 Q 28.4,42 23,37 Z"
        fill="#009e7e"
      />
      {/* Stripe 2: Mint Teal */}
      <path
        className="vms-awning-mint"
        d="M 33.8,28 L 44.6,28 L 44.6,37 Q 39.2,42 33.8,37 Z"
        fill="#5ce2c0"
      />
      {/* Stripe 3 (Center): Dark Teal */}
      <path
        d="M 44.6,28 L 55.4,28 L 55.4,37 Q 50,42 44.6,37 Z"
        fill="#009e7e"
      />
      {/* Stripe 4: Mint Teal */}
      <path
        className="vms-awning-mint"
        d="M 55.4,28 L 66.2,28 L 66.2,37 Q 60.8,42 55.4,37 Z"
        fill="#5ce2c0"
      />
      {/* Stripe 5 (Rightmost): Dark Teal */}
      <path
        d="M 66.2,28 L 77,28 L 77,37 Q 71.6,42 66.2,37 Z"
        fill="#009e7e"
      />

      {/* Top Roof Fascia Beam */}
      <rect x="22" y="24" width="56" height="5" rx="2.5" fill="#ffffff" />

      {/* Pure 2D Flat Shimmer Sweep Across Storefront */}
      <g clipPath="url(#vms_store_clip)">
        <rect
          className="vms-shimmer-bar"
          x="10"
          y="22"
          width="26"
          height="50"
          fill="url(#vms_shimmer)"
          pointerEvents="none"
        />
      </g>
    </g>

    {/* Verified Checkmark Badge with 2D Radar Ping and Pulse */}
    <g>
      {/* Separation Outer Mask Halo */}
      <circle cx="75" cy="68" r="15" fill="#082a47" />
      {/* Radar Ring expanding from badge center */}
      <circle className="vms-radar" cx="75" cy="68" r="12" fill="none" stroke="#00d9a3" strokeWidth="1.5" />
      {/* Emerald Badge Disc with Checkmark */}
      <g className="vms-badge">
        <circle cx="75" cy="68" r="12" fill="#14ab84" />
        <path
          d="M 69,68 L 73.5,72.5 L 81.5,63"
          stroke="#ffffff"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </g>
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
  'merchant-store': {
    name: 'Verified Merchant Hub',
    description: 'Official system logo with 5-stripe scalloped emerald and mint canopy, navy apertures, and animated verified checkmark badge.',
    tag: 'Official System Logo',
    Component: SvgMerchantStore,
  },
};

/**
 * Official Brand Logo Component (Pure 2D squircle with smooth micro-animations, zero 3D)
 */
export const AppBrandLogo: React.FC<AppBrandLogoProps> = ({
  logoUrl,
  presetId = 'merchant-store',
  size = 'md',
  className = '',
  showGlow = false,
  altText = 'POS & Sound Box Stock Inventory Logo',
  animated = true,
}) => {
  const [imgError, setImgError] = useState(false);
  const sizeStyle = SIZE_MAP[size] || SIZE_MAP.md;
  const ActiveComponent = PRESET_META[presetId]?.Component || SvgMerchantStore;

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
          className={`absolute inset-0 rounded-xl bg-gradient-to-tr from-sky-500/15 to-emerald-500/10 ${sizeStyle.glow} -z-10 pointer-events-none opacity-80`}
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

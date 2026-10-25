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
 * Features a circular deep sapphire canvas, pure white store facade,
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
      {/* Deep royal sapphire background disc */}
      <radialGradient id="vms_bg" cx="50%" cy="45%" r="52%">
        <stop offset="0%" stopColor="#145b8e" />
        <stop offset="55%" stopColor="#0e4773" />
        <stop offset="100%" stopColor="#082c4a" />
      </radialGradient>

      {/* Subtle linear 2D shimmer across awning and facade */}
      <linearGradient id="vms_shimmer" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
        <stop offset="50%" stopColor="#ffffff" stopOpacity="0.3" />
        <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
      </linearGradient>

      {/* Clip path for the 2D light sweep */}
      <clipPath id="vms_store_clip">
        <rect x="25" y="25" width="50" height="42" rx="4" />
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
      @keyframes vms_rings_breathe {
        0%, 100% {
          opacity: 0.18;
        }
        50% {
          opacity: 0.42;
        }
      }
      @keyframes vms_knob_beacon {
        0%, 100% {
          opacity: 0.85;
          transform: scale(1);
        }
        50% {
          opacity: 1;
          transform: scale(1.2);
        }
      }
      @keyframes vms_flat_shimmer {
        0% {
          transform: translateX(-80px);
        }
        25% {
          transform: translateX(110px);
        }
        100% {
          transform: translateX(110px);
        }
      }
      .vms-badge {
        transform-origin: 71px 63.5px;
        ${animated ? 'animation: vms_badge_pulse 2.8s ease-in-out infinite;' : ''}
      }
      .vms-rings {
        ${animated ? 'animation: vms_rings_breathe 3.6s ease-in-out infinite;' : ''}
      }
      .vms-knob {
        transform-origin: 42.5px 55.5px;
        ${animated ? 'animation: vms_knob_beacon 2.4s ease-in-out infinite;' : ''}
      }
      .vms-shimmer-bar {
        ${animated ? 'animation: vms_flat_shimmer 5.5s cubic-bezier(0.4, 0, 0.2, 1) infinite;' : ''}
      }
    `}</style>

    {/* Circular Background Container */}
    <circle cx="50" cy="50" r="48" fill="url(#vms_bg)" />

    {/* Concentric Accent Rings */}
    <g className="vms-rings">
      <circle cx="50" cy="50" r="44" stroke="#1b6ca6" strokeWidth="0.8" />
      <circle cx="50" cy="50" r="37" stroke="#165b8f" strokeWidth="0.8" />
    </g>

    {/* Storefront Group */}
    <g>
      {/* White Store Building Facade */}
      <path
        d="M 30,37.5 L 70,37.5 L 70,61.5 Q 70,64.5 67,64.5 L 33,64.5 Q 30,64.5 30,61.5 Z"
        fill="#ffffff"
      />

      {/* Doorway */}
      <rect x="34.5" y="47.5" width="10.5" height="17" rx="1.2" fill="#0b375b" />
      {/* Doorknob with 2D beacon pulse */}
      <circle className="vms-knob" cx="42.5" cy="55.5" r="1.1" fill="#00d9a3" />

      {/* Windows (Two Panes) */}
      <rect x="48.5" y="47.5" width="8.5" height="10" rx="1" fill="#0b375b" />
      <rect x="58" y="47.5" width="8.5" height="10" rx="1" fill="#0b375b" />

      {/* Scalloped Awning Stripes (5 Vertical Stripes) */}
      {/* Stripe 1 (Leftmost): Dark Teal */}
      <path
        d="M 26.5,29.5 L 35.9,29.5 L 35.9,37.5 Q 31.2,42 26.5,37.5 Z"
        fill="#009e7e"
      />
      {/* Stripe 2: Mint Teal */}
      <path
        d="M 35.9,29.5 L 45.3,29.5 L 45.3,37.5 Q 40.6,42 35.9,37.5 Z"
        fill="#5ce2c0"
      />
      {/* Stripe 3 (Center): Dark Teal */}
      <path
        d="M 45.3,29.5 L 54.7,29.5 L 54.7,37.5 Q 50,42 45.3,37.5 Z"
        fill="#009e7e"
      />
      {/* Stripe 4: Mint Teal */}
      <path
        d="M 54.7,29.5 L 64.1,29.5 L 64.1,37.5 Q 59.4,42 54.7,37.5 Z"
        fill="#5ce2c0"
      />
      {/* Stripe 5 (Rightmost): Dark Teal */}
      <path
        d="M 64.1,29.5 L 73.5,29.5 L 73.5,37.5 Q 68.8,42 64.1,37.5 Z"
        fill="#009e7e"
      />

      {/* Top Roof Fascia Beam */}
      <rect x="25.5" y="26" width="49" height="4.5" rx="2.25" fill="#ffffff" />

      {/* Pure 2D Flat Shimmer Sweep Across Storefront */}
      <g clipPath="url(#vms_store_clip)">
        <rect
          className="vms-shimmer-bar"
          x="10"
          y="25"
          width="20"
          height="45"
          fill="url(#vms_shimmer)"
          pointerEvents="none"
        />
      </g>
    </g>

    {/* Verified Checkmark Badge with 2D Pulse */}
    <g className="vms-badge">
      {/* Separation Outer Mask Halo */}
      <circle cx="71" cy="63.5" r="13" fill="#082a47" />
      {/* Emerald Badge Disc */}
      <circle cx="71" cy="63.5" r="10.2" fill="#14ab84" />
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
 * Official Brand Logo Component (Pure 2D with smooth micro-animations, zero 3D)
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

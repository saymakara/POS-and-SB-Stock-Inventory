/**
 * 20 Ways to Make Beautiful UI & Motion Animations (Enterprise Reference)
 * Encapsulating modern design engineering principles for high-performance enterprise UI.
 *
 * Principles Implemented:
 * 1. Ease-out for entrances.
 * 2. Dropdown transitions between 150–250ms.
 * 3. Stagger list rows by approximately 30ms.
 * 4. Scale interactive buttons to 0.97 on press.
 * 5. Use subtle stretch effects for appropriate draggable controls.
 * 6. Stagger secondary details as content settles.
 * 7. Use natural curved movement for selected object transitions.
 * 8. Use subtle pulses for successful actions.
 * 9. Ease-in-out for positional movements.
 * 10. Start popovers at approximately 0.95 scale.
 * 11. Enter elements from their triggering controls.
 * 12. Exit elements toward their triggering controls.
 * 13. Avoid unnecessary bounce animations.
 * 14. Keep dragging interactions directly responsive without animation lag.
 * 15. Make exit transitions approximately 20% shorter than entrances.
 * 16. Overlap outgoing and incoming states for seamless transitions.
 * 17. Use clipping masks for selected reveal effects.
 * 18. Use subtle crossfades for icon and state changes.
 * 19. Apply rubber-band effects only to appropriate drag and scroll interactions.
 * 20. Reuse consistent layout identities for shared-element transitions.
 */
import { Transition, Variants } from 'motion/react';

// ============================================================================
// 1. EASE-OUT FOR ENTRANCES
// ============================================================================
export const EASE_ENTRANCE = [0.16, 1, 0.3, 1] as const;
export const EASE_OUT_CALM = [0, 0, 0.2, 1] as const;

export const TRANSITION_ENTRANCE: Transition = {
  duration: 0.22,
  ease: EASE_ENTRANCE,
};

// ============================================================================
// 2. DROPDOWN TRANSITIONS BETWEEN 150-250ms & 15. EXITS 20% SHORTER
// ============================================================================
export const DURATION_DROPDOWN_ENTER = 0.20; // 200ms (within 150-250ms range)
export const DURATION_DROPDOWN_EXIT = 0.16;  // 160ms (exactly 20% shorter than 200ms entrance)

export const DURATION_MODAL_ENTER = 0.22;    // 220ms
export const DURATION_MODAL_EXIT = 0.176;    // 176ms (20% shorter)

export const DURATION_DRAWER_ENTER = 0.26;   // 260ms
export const DURATION_DRAWER_EXIT = 0.208;   // 208ms (20% shorter)

export const DURATION_FAST_ENTER = 0.14;     // 140ms
export const DURATION_FAST_EXIT = 0.112;     // 112ms (20% shorter)

// ============================================================================
// 3. STAGGER LIST ROWS BY APPROXIMATELY 30ms
// ============================================================================
export const STAGGER_ROW_DELAY = 0.03; // 30ms

export const STAGGER_TABLE_CONTAINER: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: STAGGER_ROW_DELAY,
      delayChildren: 0.02,
    },
  },
};

export const STAGGER_TABLE_ROW: Variants = {
  hidden: { opacity: 0, y: 5 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.18,
      ease: EASE_ENTRANCE,
    },
  },
};

/** Helper for CSS-based row staggering without extra DOM wrapper nodes */
export const staggerRowStyle = (index: number): React.CSSProperties => ({
  animationDelay: `${Math.min(index, 20) * 30}ms`,
});

// ============================================================================
// 4. SCALE INTERACTIVE BUTTONS TO 0.97 ON PRESS & 14. NO TWEEN WHILE HELD
// ============================================================================
export const PRESS_SCALE = 0.97;

export const WHILE_TAP_BUTTON = {
  scale: PRESS_SCALE,
  transition: { duration: 0.04, ease: EASE_OUT_CALM },
} as const;

export const WHILE_TAP_ICON = {
  scale: 0.92,
  transition: { duration: 0.04, ease: EASE_OUT_CALM },
} as const;

// ============================================================================
// 5. SUBTLE STRETCH EFFECTS FOR DRAGGABLE CONTROLS & KNOBS
// ============================================================================
export const STRETCH_KNOB_X = 1.12;

export const KNOB_ACTIVE_STRETCH: Variants = {
  idle: { scaleX: 1, scaleY: 1 },
  active: {
    scaleX: STRETCH_KNOB_X,
    scaleY: 0.94,
    transition: { duration: 0.08, ease: EASE_ENTRANCE },
  },
};

// ============================================================================
// 6. STAGGER SECONDARY DETAILS AS CONTENT SETTLES
// ============================================================================
export const SECONDARY_DETAILS_CONTAINER: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      delayChildren: 0.06,
      staggerChildren: STAGGER_ROW_DELAY,
    },
  },
};

export const SECONDARY_DETAILS_ITEM: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.18,
      ease: EASE_ENTRANCE,
    },
  },
};

// ============================================================================
// 7. NATURAL CURVED MOVEMENT FOR SELECTED OBJECT TRANSITIONS
// ============================================================================
export const EASE_ARC = [0.25, 0.1, 0.25, 1] as const;

export const TRANSITION_CURVED_PATH: Transition = {
  duration: 0.28,
  ease: EASE_ARC,
};

// ============================================================================
// 8. SUBTLE PULSES FOR SUCCESSFUL ACTIONS
// ============================================================================
export const SUCCESS_PULSE_ANIMATION = {
  scale: [1, 1.05, 1],
  transition: { duration: 0.24, ease: EASE_ENTRANCE },
};

export const SUCCESS_ICON_PULSE: Variants = {
  initial: { scale: 0.85, opacity: 0 },
  animate: {
    scale: [0.85, 1.14, 1],
    opacity: 1,
    transition: { duration: 0.26, ease: EASE_ENTRANCE },
  },
};

// ============================================================================
// 9. EASE-IN-OUT FOR POSITIONAL MOVEMENTS
// ============================================================================
export const EASE_MOVE = [0.4, 0, 0.2, 1] as const;

export const TRANSITION_MOVE: Transition = {
  duration: 0.24,
  ease: EASE_MOVE,
};

// ============================================================================
// 10. START POPOVERS AT ~0.95 SCALE, 11/12 TRIGGER ORIGIN, 15. EXITS 20% SHORTER
// ============================================================================
export const POPOVER_VARIANTS: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.95,
    transition: {
      duration: DURATION_DROPDOWN_EXIT,
      ease: [0.4, 0, 1, 1],
    },
  },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      duration: DURATION_DROPDOWN_ENTER,
      ease: EASE_ENTRANCE,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    transition: {
      duration: DURATION_DROPDOWN_EXIT,
      ease: [0.4, 0, 1, 1], // Rule 15: 20% shorter exit
    },
  },
};

export const DROPDOWN_VARIANTS = POPOVER_VARIANTS;

// ============================================================================
// 13. NO BOUNCE: CRITICALLY DAMPED, ZERO-OVERSHOOT SPRING
// ============================================================================
export const SPRING_NO_BOUNCE: Transition = {
  type: 'spring',
  stiffness: 480,
  damping: 34,
  mass: 0.55,
  bounce: 0,
};

/** Signature Spring Physics for Sliding Tab Navigation Pills across the portal */
export const SPRING_TAB_PILL: Transition = {
  type: 'spring',
  stiffness: 500,
  damping: 32,
  mass: 0.55,
};

// ============================================================================
// 14. DRAGGING RESPONSIVENESS WITHOUT ANIMATION LAG & 19. RUBBER BAND PAST BOUNDS
// ============================================================================
export const DRAG_RESPONSIVE_CONFIG = {
  dragElastic: 0.1, // Subtle physical resistance (rubber band)
  dragTransition: {
    bounceStiffness: 600,
    bounceDamping: 36,
  },
};

// ============================================================================
// MODAL & DRAWER STANDARDIZED VARIANTS (Rules 1, 10, 13, 15)
// ============================================================================
export const BACKDROP_VARIANTS: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.16, ease: [0.32, 0.72, 0, 1] },
  },
};

export const MODAL_VARIANTS: Variants = {
  hidden: {
    opacity: 0,
    y: 10,
    scale: 0.97,
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: DURATION_MODAL_ENTER,
      ease: [0.22, 1, 0.36, 1],
    },
  },
  exit: {
    opacity: 0,
    y: 6,
    scale: 0.97,
    transition: {
      duration: 0.16,
      ease: [0.32, 0.72, 0, 1],
    },
  },
};

export const DRAWER_VARIANTS: Variants = {
  hidden: {
    x: '100%',
  },
  visible: {
    x: 0,
    transition: {
      x: { type: 'spring', stiffness: 440, damping: 40, mass: 0.72, bounce: 0 },
    },
  },
  exit: {
    x: '100%',
    transition: {
      duration: 0.2,
      ease: [0.32, 0.72, 0, 1],
    },
  },
};

// ============================================================================
// 16. OVERLAP OUTGOING AND INCOMING STATES (CROSSFADE TABS & PAGE GLIDES)
// ============================================================================
export const CROSSFADE_OVERLAP_VARIANTS: Variants = {
  initial: { opacity: 0, y: 4 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.18, ease: EASE_ENTRANCE },
  },
  exit: {
    opacity: 0,
    y: -4,
    transition: { duration: 0.14, ease: [0.4, 0, 1, 1] }, // 20% shorter exit
  },
};

// ============================================================================
// 17. CLIPPING MASKS FOR SELECTED REVEAL EFFECTS
// ============================================================================
export const CLIP_MASK_REVEAL_VARIANTS: Variants = {
  hidden: {
    clipPath: 'inset(0% 0% 100% 0%)',
    opacity: 0,
  },
  visible: {
    clipPath: 'inset(0% 0% 0% 0%)',
    opacity: 1,
    transition: { duration: 0.22, ease: EASE_ENTRANCE },
  },
  exit: {
    clipPath: 'inset(0% 0% 100% 0%)',
    opacity: 0,
    transition: { duration: 0.176, ease: [0.4, 0, 1, 1] },
  },
};

// ============================================================================
// 18. SUBTLE CROSSFADES FOR ICON AND STATE CHANGES (2PX BLUR)
// ============================================================================
export const ICON_CROSSFADE_VARIANTS: Variants = {
  initial: { opacity: 0, filter: 'blur(2px)', scale: 0.92 },
  animate: {
    opacity: 1,
    filter: 'blur(0px)',
    scale: 1,
    transition: { duration: 0.14, ease: EASE_ENTRANCE },
  },
  exit: {
    opacity: 0,
    filter: 'blur(2px)',
    scale: 0.92,
    transition: { duration: 0.11, ease: [0.4, 0, 1, 1] }, // 20% shorter
  },
};

// ============================================================================
// 20. REUSABLE CONSISTENT LAYOUT IDENTITIES FOR SHARED-ELEMENT TRANSITIONS
// ============================================================================
export const SHARED_LAYOUT_IDS = {
  NAV_ACTIVE_PILL: 'nav-active-pill',
  TAB_VIEW_PILL: 'tab-view-pill',
  QR_VIEW_PILL: 'qr-view-pill',
  CC_REVIEW_PILL: 'cc-review-pill',
  FR_TYPE_PILL: 'fr-type-pill',
  FR_STATUS_PILL: 'fr-status-pill',
  KPI_VIEW_PILL: 'kpi-view-pill',
  KPI_SUBCAT_CATEGORY_PILL: 'kpi-subcat-category-pill',
  KPI_SUBCAT_VIEW_PILL: 'kpi-subcat-view-pill',
  PIPELINE_STAGE_PILL: 'activePipelineStagePill',
  PUSH_MODE_PILL: 'activePushModeIndicator',
  PRODUCT_VIEW_PILL: 'activeProductViewPill',
  SIM_HARDWARE_PILL: 'simHardwareFilterPill',
  SIM_STATUS_PILL: 'simStatusPill',
  SETTINGS_SUBTAB_PILL: 'settings-subtab-pill',
  MATERIAL_LEDGER_PILL: 'material-ledger-view-pill',
  CRM_TREND_MODE_PILL: 'crm-trend-mode-pill',
  CRM_TREND_HORIZON_PILL: 'crm-trend-horizon-pill',
  MOBILE_TAB_PILL: 'mobileTabIndicator',
} as const;

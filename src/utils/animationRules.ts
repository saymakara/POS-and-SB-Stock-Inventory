/**
 * 20 Ways to Make Beautiful UI & Motion Animations (Enterprise Reference)
 * Encapsulating modern design engineering principles for high-performance enterprise UI.
 */
import { Transition, Variants } from 'motion/react';

// 1. Ease-out for entrances
export const EASE_ENTRANCE = [0.16, 1, 0.3, 1] as const;
export const EASE_OUT_CALM = [0, 0, 0.2, 1] as const;

// 2. Dropdowns at 150–250ms
export const DURATION_DROPDOWN_ENTER = 0.2; // 200ms

// 15. Make exits 20% shorter
export const DURATION_DROPDOWN_EXIT = 0.16; // 160ms (20% shorter than 200ms entrance)
export const DURATION_MODAL_ENTER = 0.22;
export const DURATION_MODAL_EXIT = 0.176; // 20% shorter

// 3. Stagger list rows by 30ms
export const STAGGER_ROW_DELAY = 0.03; // 30ms

// 4. Scale to 0.97 on press & 14. Don't tween while held
export const PRESS_SCALE = 0.97;
export const WHILE_TAP_PRESS = {
  scale: PRESS_SCALE,
  transition: { duration: 0.04, ease: EASE_OUT_CALM },
} as const;

// 5. Stretch moving knobs 12%
export const STRETCH_KNOB_X = 1.12;

// 6. Stagger as details settle
export const STAGGER_SETTLE_CONTAINER: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: STAGGER_ROW_DELAY,
      delayChildren: 0.05,
    },
  },
};

export const STAGGER_ITEM_VARIANT: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.18,
      ease: EASE_ENTRANCE,
    },
  },
};

// 7. Arcs for object movement
export const EASE_ARC = [0.25, 0.1, 0.25, 1] as const;

// 8. Pulse to confirm success
export const SUCCESS_PULSE_ANIMATION = {
  scale: [1, 1.05, 1],
  transition: { duration: 0.24, ease: EASE_ENTRANCE },
};

// 9. Ease-in-out for moves
export const EASE_MOVE = [0.4, 0, 0.2, 1] as const;

// 10. Start popovers at 0.95, 11. Enter from trigger, 12. Exit to trigger, 15. Exits 20% shorter
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
};

// 13. No bounce on everyday UI: Critically damped, zero overshoot spring
export const SPRING_NO_BOUNCE: Transition = {
  type: 'spring',
  stiffness: 500,
  damping: 32,
  mass: 0.55,
  bounce: 0,
};

// 16. Overlap old & new states (crossfade tabs & page glides)
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

// 18. Crossfade icons + blur (2px blur on transition)
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

// 20. Reusable Layout IDs
export const SHARED_LAYOUT_IDS = {
  NAV_ACTIVE_PILL: 'nav-active-pill',
  TAB_VIEW_PILL: 'tab-view-pill',
  QR_VIEW_PILL: 'qr-view-pill',
  CC_REVIEW_PILL: 'cc-review-pill',
  FR_TYPE_PILL: 'fr-type-pill',
  FR_STATUS_PILL: 'fr-status-pill',
  KPI_VIEW_PILL: 'kpi-view-pill',
  PIPELINE_STAGE_PILL: 'activePipelineStagePill',
  PUSH_MODE_PILL: 'activePushModeIndicator',
} as const;

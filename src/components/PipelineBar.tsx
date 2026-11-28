import React from 'react';
import { LifecycleStage, UserRole, ThemeMode } from '../types';
import { STAGE_META } from '../data/initialData';
import { Odometer } from './Odometer';
import { motion, AnimatePresence } from 'motion/react';
import { WHILE_TAP_BUTTON, SPRING_NO_BOUNCE, SHARED_LAYOUT_IDS } from '../utils/animationRules';
import {
  PillMotion,
  CAPSULE_PILL_CLS,
  CAPSULE_BTN_ACTIVE_CLS,
  CAPSULE_BTN_INACTIVE_CLS,
  CAPSULE_COUNT_ACTIVE_CLS,
  CAPSULE_COUNT_INACTIVE_CLS,
} from './PillMotion';
import {
  Layers,
  Warehouse,
  Store,
  Wrench,
  CheckCircle2,
  RotateCcw,
  SearchX,
} from 'lucide-react';

interface PipelineBarProps {
  role?: UserRole;
  counts: {
    all: number;
    hq: number;
    reserve: number;
    config: number;
    complete: number;
    faulty: number;
    lost?: number;
  };
  currentStageFilter: string;
  onSelectStage: (stage: string) => void;
  theme?: ThemeMode;
  /** (5 Nov 2026) on a product page the first chip names the product ("All POS Terminal") */
  allLabel?: string;
  noPadding?: boolean;
  embedded?: boolean;
}

export const PipelineBar: React.FC<PipelineBarProps> = React.memo(({
  role = 'ADMIN',
  counts,
  currentStageFilter,
  onSelectStage,
  theme = 'light',
  allLabel,
  noPadding = false,
  embedded = false,
}) => {
  const isLight = theme === 'light';

  const stages: {
    id: 'ALL' | LifecycleStage;
    title: string;
    count: number;
    icon: React.ElementType;
    accentColor: string;
    hidden?: boolean;
  }[] = [
    {
      id: 'ALL',
      title: allLabel || 'All Stock',
      count: counts.all,
      icon: Layers,
      accentColor: isLight ? 'text-zinc-800' : 'text-zinc-200',
    },
    {
      id: 'HQ_STOCK',
      title: STAGE_META.HQ_STOCK.short,
      count: counts.hq,
      icon: Warehouse,
      accentColor: isLight ? 'text-slate-600' : 'text-slate-300',
      hidden: role === 'BRANCH',
    },
    {
      id: 'BRANCH_RESERVE',
      title: STAGE_META.BRANCH_RESERVE.short,
      count: counts.reserve,
      icon: Store,
      accentColor: isLight ? 'text-[#1e5b88]' : 'text-sky-300',
    },
    {
      id: 'CONFIGURING',
      title: STAGE_META.CONFIGURING.short,
      count: counts.config,
      icon: Wrench,
      accentColor: 'text-amber-600 dark:text-amber-400',
    },
    {
      id: 'COMPLETE',
      title: STAGE_META.COMPLETE.short,
      count: counts.complete,
      icon: CheckCircle2,
      accentColor: 'text-emerald-600',
    },
    {
      id: 'LOST',
      title: STAGE_META.LOST.short,
      count: counts.lost ?? 0,
      icon: SearchX,
      accentColor: 'text-rose-600 dark:text-rose-400',
    },
  ];

  const visibleStages = stages.filter((s) => !s.hidden);

  return (
    <section className={`w-full ${noPadding ? '' : 'px-4 sm:px-6 pt-3'}`}>
      <div
        className={`${
          embedded
            ? 'bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-1.5'
            : isLight
            ? 'surface-card-light p-2'
            : 'surface-card-dark p-2'
        } flex items-center justify-between gap-2 overflow-x-auto no-scrollbar`}
      >
        <div
          role="tablist"
          aria-label="Hardware lifecycle stages"
          className={`inline-flex items-center p-1 rounded-full border gap-1 min-w-max ${
            isLight
              ? 'bg-slate-200/75 border-slate-200/90'
              : 'bg-slate-800/90 border-slate-700/80'
          }`}
        >
          {visibleStages.map((s) => {
            const Icon = s.icon;
            const isSelected = currentStageFilter === s.id;
            return (
              <motion.button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                whileTap={WHILE_TAP_BUTTON}
                onClick={() => onSelectStage(s.id)}
                className={`relative px-3 py-1.5 rounded-full text-left flex items-center gap-2 cursor-pointer transition-colors duration-200 select-none outline-none ${
                  isSelected
                    ? CAPSULE_BTN_ACTIVE_CLS
                    : isLight
                    ? CAPSULE_BTN_INACTIVE_CLS
                    : 'text-slate-300 hover:text-white font-medium'
                }`}
              >
                {isSelected && (
                  <PillMotion
                    layoutId={SHARED_LAYOUT_IDS.PIPELINE_STAGE_PILL}
                    aria-hidden
                    transition={SPRING_NO_BOUNCE}
                    className={CAPSULE_PILL_CLS}
                  />
                )}
                <Icon
                  className={`w-3.5 h-3.5 shrink-0 relative z-10 transition-colors duration-200 ${s.accentColor}`}
                />
                <span className="text-xs font-semibold whitespace-nowrap relative z-10">
                  {s.title}
                </span>
                <span
                  className={`font-figure text-[11px] tabular-nums px-1.5 py-0.2 rounded-full relative z-10 transition-colors duration-200 ${
                    isSelected
                      ? CAPSULE_COUNT_ACTIVE_CLS
                      : isLight
                      ? CAPSULE_COUNT_INACTIVE_CLS
                      : 'bg-transparent border border-transparent text-slate-300 font-medium'
                  }`}
                >
                  <Odometer value={s.count} format={s.count >= 1000} duration={340} />
                </span>
              </motion.button>
            );
          })}
        </div>

        <AnimatePresence>
          {currentStageFilter !== 'ALL' && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9, x: 8 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.9, x: 8 }}
              transition={{ type: 'spring', stiffness: 500, damping: 32 }}
              type="button"
              whileTap={{ scale: 0.985 }}
              onClick={() => onSelectStage('ALL')}
              className={`px-2.5 py-1.5 rounded-md text-xs font-bold hover:underline flex items-center gap-1 cursor-pointer shrink-0 ${
                isLight ? 'text-zinc-700' : 'text-zinc-300'
              }`}
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
});

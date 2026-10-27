import React from 'react';
import { LifecycleStage, UserRole, ThemeMode } from '../types';
import { STAGE_META } from '../data/initialData';
import { Odometer } from './Odometer';
import { motion, AnimatePresence } from 'motion/react';
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
}

export const PipelineBar: React.FC<PipelineBarProps> = React.memo(({
  role = 'ADMIN',
  counts,
  currentStageFilter,
  onSelectStage,
  theme = 'light',
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
      title: 'All Stock',
      count: counts.all,
      icon: Layers,
      accentColor: isLight ? 'text-zinc-800' : 'text-zinc-200',
    },
    {
      id: 'HQ_STOCK',
      title: STAGE_META.HQ_STOCK.short,
      count: counts.hq,
      icon: Warehouse,
      accentColor: isLight ? 'text-indigo-700' : 'text-indigo-300',
      hidden: role === 'BRANCH',
    },
    {
      id: 'BRANCH_RESERVE',
      title: STAGE_META.BRANCH_RESERVE.short,
      count: counts.reserve,
      icon: Store,
      accentColor: isLight ? 'text-sky-700' : 'text-sky-300',
    },
    {
      id: 'CONFIGURING',
      title: STAGE_META.CONFIGURING.short,
      count: counts.config,
      icon: Wrench,
      accentColor: 'text-indigo-600 dark:text-indigo-400',
    },
    {
      id: 'COMPLETE',
      title: STAGE_META.COMPLETE.short,
      count: counts.complete,
      icon: CheckCircle2,
      accentColor: 'text-[#1cc88a]',
    },
    {
      id: 'LOST',
      title: STAGE_META.LOST.short,
      count: counts.lost ?? 0,
      icon: SearchX,
      accentColor: 'text-amber-600 dark:text-amber-400',
    },
  ];

  const visibleStages = stages.filter((s) => !s.hidden);

  return (
    <section className="w-full px-4 sm:px-6 pt-3">
      <div
        className={`${
          isLight ? 'surface-card-light' : 'surface-card-dark'
        } p-2 flex items-center justify-between gap-2 overflow-x-auto no-scrollbar`}
      >
        <div className="flex items-center gap-1.5 flex-1 min-w-max">
          {visibleStages.map((s) => {
            const Icon = s.icon;
            const isSelected = currentStageFilter === s.id;
            return (
              <motion.button
                key={s.id}
                type="button"
                whileTap={{ scale: 0.96 }}
                onClick={() => onSelectStage(s.id)}
                className={`relative px-3 py-1.5 rounded-md border text-left flex items-center gap-2 cursor-pointer transition-colors duration-200 ${
                  isSelected
                    ? 'border-transparent text-white'
                    : isLight
                    ? 'bg-white border-slate-200 text-zinc-800 hover:border-zinc-400'
                    : 'bg-[#18191e] border-zinc-800 text-slate-200 hover:border-zinc-600'
                }`}
              >
                {isSelected && (
                  <motion.div
                    layoutId="activePipelineStagePill"
                    transition={{ type: 'spring', stiffness: 480, damping: 30, mass: 0.55 }}
                    className="absolute -inset-[1px] rounded-md tab-active-blue border border-sky-400/40 shadow-xs z-0 pointer-events-none"
                  />
                )}
                <Icon
                  className={`w-3.5 h-3.5 shrink-0 relative z-10 transition-colors duration-200 ${
                    isSelected ? 'text-white' : s.accentColor
                  }`}
                />
                <span className="text-xs font-bold whitespace-nowrap relative z-10">
                  {s.title}
                </span>
                <span
                  className={`font-figure text-xs font-extrabold tabular-nums px-1.5 py-0.2 rounded relative z-10 transition-colors duration-200 ${
                    isSelected
                      ? 'bg-white/15 text-white'
                      : isLight
                      ? 'bg-slate-100 text-zinc-900 border border-slate-200'
                      : 'bg-zinc-800 text-white'
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
              whileTap={{ scale: 0.95 }}
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

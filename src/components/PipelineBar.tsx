import React from 'react';
import { LifecycleStage, UserRole, ThemeMode } from '../types';
import { STAGE_META } from '../data/initialData';
import {
  Layers,
  Warehouse,
  Store,
  Wrench,
  Truck,
  CheckCircle2,
  AlertTriangle,
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
      accentColor: isLight ? 'text-zinc-800' : 'text-zinc-200',
      hidden: role === 'BRANCH',
    },
    {
      id: 'BRANCH_RESERVE',
      title: STAGE_META.BRANCH_RESERVE.short,
      count: counts.reserve,
      icon: Store,
      accentColor: isLight ? 'text-[#003857]' : 'text-[#7cc4ed]',
    },
    {
      id: 'CONFIGURING',
      title: STAGE_META.CONFIGURING.short,
      count: counts.config,
      icon: Wrench,
      accentColor: 'text-[#d99b00] dark:text-[#f6c23e]',
    },
    {
      id: 'COMPLETE',
      title: STAGE_META.COMPLETE.short,
      count: counts.complete,
      icon: CheckCircle2,
      accentColor: 'text-[#1cc88a]',
    },
    {
      id: 'FAULTY',
      title: STAGE_META.FAULTY.short,
      count: counts.faulty,
      icon: RotateCcw,
      accentColor: 'text-[#e41e26]',
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
              <button
                key={s.id}
                type="button"
                onClick={() => onSelectStage(s.id)}
                className={`px-3 py-1.5 rounded-md border text-left flex items-center gap-2 cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-[#004953] border-emerald-500/40 text-white shadow-xs'
                    : isLight
                    ? 'bg-white border-slate-200 text-zinc-800 hover:border-zinc-400'
                    : 'bg-[#18191e] border-zinc-800 text-slate-200 hover:border-zinc-600'
                }`}
              >
                <Icon
                  className={`w-3.5 h-3.5 shrink-0 ${
                    isSelected ? 'text-white' : s.accentColor
                  }`}
                />
                <span className="text-xs font-bold whitespace-nowrap">
                  {s.title}
                </span>
                <span
                  className={`font-mono text-xs font-extrabold tabular-nums px-1.5 py-0.2 rounded ${
                    isSelected
                      ? 'bg-white/15 text-white'
                      : isLight
                      ? 'bg-slate-100 text-zinc-900 border border-slate-200'
                      : 'bg-zinc-800 text-white'
                  }`}
                >
                  {s.count}
                </span>
              </button>
            );
          })}
        </div>

        {currentStageFilter !== 'ALL' && (
          <button
            type="button"
            onClick={() => onSelectStage('ALL')}
            className={`px-2.5 py-1.5 rounded-md text-xs font-bold hover:underline flex items-center gap-1 cursor-pointer shrink-0 ${
              isLight ? 'text-zinc-700' : 'text-zinc-300'
            }`}
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset</span>
          </button>
        )}
      </div>
    </section>
  );
});



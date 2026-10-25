import React from 'react';
import { Device, HistoricalMerchantRecord, LifecycleStage, STAGE_ORDER, ThemeMode } from '../types';
import { STAGE_META } from '../data/initialData';
import { motion } from 'motion/react';
import { Odometer } from './Odometer';
import {
  Package,
  Building2,
  Settings,
  CheckCircle2,
  RotateCcw,
  SearchX,
} from 'lucide-react';

interface KpiCardsProps {
  devices: Device[];
  historicalMerchants?: HistoricalMerchantRecord[];
  theme?: ThemeMode;
  activeStageFilter?: string;
  onSelectStage?: (stage: LifecycleStage | 'ALL') => void;
  onOpenHistoryTab?: () => void;
  serverStatsByStage?: Record<LifecycleStage, { count: number; posCount: number; sbCount: number }>;
  serverTotal?: number;
}

const STAGE_ICONS: Record<LifecycleStage, React.ReactNode> = {
  HQ_STOCK: <Package className="w-4 h-4" />,
  BRANCH_RESERVE: <Building2 className="w-4 h-4" />,
  CONFIGURING: <Settings className="w-4 h-4" />,
  COMPLETE: <CheckCircle2 className="w-4 h-4" />,
  FAULTY: <RotateCcw className="w-4 h-4" />,
  LOST: <SearchX className="w-4 h-4" />,
};

const STAGE_STYLES: Record<
  LifecycleStage,
  {
    accentBar: string;
    iconBox: string;
    ringActive: string;
    subtitle: string;
  }
> = {
  HQ_STOCK: {
    accentBar: 'bg-slate-600',
    iconBox: 'bg-slate-100 text-slate-700 border-slate-200',
    ringActive: 'ring-2 ring-slate-600 border-slate-600',
    subtitle: 'Branch Code 100 Vault',
  },
  BRANCH_RESERVE: {
    accentBar: 'bg-sky-600',
    iconBox: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/20 dark:text-sky-300',
    ringActive: 'ring-2 ring-sky-600 border-sky-600',
    subtitle: 'Branch Code Buffer',
  },
  CONFIGURING: {
    accentBar: 'bg-indigo-600',
    iconBox: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    ringActive: 'ring-2 ring-indigo-600 border-indigo-600',
    subtitle: 'Under Configuring · App Push',
  },
  COMPLETE: {
    accentBar: 'bg-emerald-700',
    iconBox: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    ringActive: 'ring-2 ring-emerald-700 border-emerald-700',
    subtitle: 'Installed at Merchant',
  },
  FAULTY: {
    accentBar: 'bg-rose-700',
    iconBox: 'bg-rose-50 text-rose-800 border-rose-200',
    ringActive: 'ring-2 ring-rose-700 border-rose-700',
    subtitle: 'Merchant History & Swaps',
  },
  LOST: {
    accentBar: 'bg-amber-600',
    iconBox: 'bg-amber-50 text-amber-800 border-amber-200',
    ringActive: 'ring-2 ring-amber-600 border-amber-600',
    subtitle: 'Lost / Unrecoverable',
  },
};

/** Summary cards: the stock stages plus the Terminated & Returned count (reflected from Merchant History). */
const CARD_ORDER: LifecycleStage[] = [...STAGE_ORDER.filter((s) => s !== 'LOST'), 'FAULTY', 'LOST'];

export const KpiCards: React.FC<KpiCardsProps> = React.memo(({
  devices,
  historicalMerchants = [],
  activeStageFilter = 'ALL',
  onSelectStage,
  onOpenHistoryTab,
  serverStatsByStage,
  serverTotal,
}) => {
  const { total, statsByStage, replacedCount } = React.useMemo(() => {
    let activeTotal = 0;
    let swaps = 0;
    const stats: Record<LifecycleStage, { count: number; posCount: number; sbCount: number }> = {
      HQ_STOCK: { count: 0, posCount: 0, sbCount: 0 },
      BRANCH_RESERVE: { count: 0, posCount: 0, sbCount: 0 },
      CONFIGURING: { count: 0, posCount: 0, sbCount: 0 },
      COMPLETE: { count: 0, posCount: 0, sbCount: 0 },
      FAULTY: { count: 0, posCount: 0, sbCount: 0 },
      LOST: { count: 0, posCount: 0, sbCount: 0 },
    };

    for (let i = 0; i < devices.length; i++) {
      const d = devices[i];
      if (d.archived) continue;
      activeTotal++;
      if (d.replacedByStaff || d.replacedFromSerial || d.replacementDate) {
        swaps++;
      }
      const s = stats[d.stage];
      if (s) {
        s.count++;
        if (d.type === 'POS Terminal') s.posCount++;
        else if (d.type === 'Sound Box') s.sbCount++;
      }
    }

    // Policy #9: Card Summary Terminate and Returned reflects Merchant History count directly
    let histPos = 0;
    let histSb = 0;
    for (let i = 0; i < historicalMerchants.length; i++) {
      const h = historicalMerchants[i];
      if (h.deviceType === 'Sound Box') histSb++;
      else histPos++;
    }
    const historyStat = {
      count: historicalMerchants.length,
      posCount: histPos,
      sbCount: histSb,
    };

    if (serverStatsByStage && typeof serverTotal === 'number') {
      return {
        total: serverTotal,
        statsByStage: {
          ...serverStatsByStage,
          FAULTY: historyStat,
        },
        replacedCount: swaps,
      };
    }

    stats.FAULTY = historyStat;
    return { total: activeTotal, statsByStage: stats, replacedCount: swaps };
  }, [devices, historicalMerchants, serverStatsByStage, serverTotal]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4 mb-5">
      {CARD_ORDER.map((stage, idx) => {
        const meta = STAGE_META[stage];
        const style = STAGE_STYLES[stage];
        const stageStat = statsByStage[stage] || { count: 0, posCount: 0, sbCount: 0 };
        const count = stageStat.count;
        const posCount = stageStat.posCount;
        const sbCount = stageStat.sbCount;
        const pct = total > 0 ? Math.min(100, Math.round((count / total) * 100)) : 0;
        const isSelected = activeStageFilter === stage;
        const clickable = stage === 'FAULTY' ? !!onOpenHistoryTab : !!onSelectStage;
        const select = () => {
          if (stage === 'FAULTY') {
            if (onOpenHistoryTab) onOpenHistoryTab();
          } else if (onSelectStage) {
            onSelectStage(isSelected ? 'ALL' : stage);
          }
        };
        const a11yLabel = `${meta.short}: ${count} units, POS ${posCount}, Sound Box ${sbCount}.${
          clickable
            ? stage === 'FAULTY'
              ? ' Press to open Merchant History.'
              : isSelected
              ? ' Selected. Press to clear the filter.'
              : ' Press to filter the inventory by this stage.'
            : ''
        }`;

        return (
          <motion.div
            key={stage}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, delay: idx * 0.03, ease: [0.16, 1, 0.3, 1] }}
            whileHover={clickable ? { y: -2, transition: { duration: 0.12 } } : undefined}
            whileTap={clickable ? { scale: 0.98 } : undefined}
            onClick={clickable ? select : undefined}
            onKeyDown={
              clickable
                ? (e: React.KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      select();
                    }
                  }
                : undefined
            }
            role={clickable ? 'button' : 'group'}
            tabIndex={clickable ? 0 : undefined}
            aria-pressed={clickable && stage !== 'FAULTY' ? isSelected : undefined}
            aria-label={a11yLabel}
            className={`surface-card relative overflow-hidden rounded-xl p-3 sm:p-4 transition-all duration-150 select-none group shadow-md hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003857] ${
              clickable ? 'cursor-pointer' : ''
            } ${isSelected ? style.ringActive : 'hover:border-zinc-400'}`}
          >
            <div
              className={`absolute top-0 left-0 right-0 h-1 ${style.accentBar} opacity-90 group-hover:opacity-100 transition-opacity`}
            />

            <div className="flex items-center justify-between mb-2 sm:mb-3 pt-0.5">
              <div
                aria-hidden="true"
                className={`w-8 h-8 sm:w-9 sm:h-9 rounded-lg border flex items-center justify-center transition-transform duration-150 group-hover:scale-105 ${style.iconBox}`}
              >
                {STAGE_ICONS[stage]}
              </div>

              {stage === 'FAULTY' ? (
                <span
                  className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-md font-figure tabular-nums inline-flex items-center gap-1"
                  title="Includes Merchant History records and Device Replacements"
                >
                  <span>Swaps:</span>
                  <Odometer value={replacedCount} duration={850} />
                </span>
              ) : (
                <span className="text-[10px] sm:text-[11px] font-bold text-slate-500 font-figure tabular-nums">
                  <Odometer value={pct} duration={900} suffix="% share" />
                </span>
              )}
            </div>

            <div className="flex items-baseline justify-between gap-2 mb-1">
              <div className="text-2xl sm:text-3xl font-black tracking-tight tabular-nums font-figure leading-none text-[#002f49]">
                <Odometer value={count} format={count >= 1000} duration={950} />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {stage === 'FAULTY' ? 'Records' : 'Units'}
              </span>
            </div>

            <div className="mb-2.5 sm:mb-3">
              <div className="text-xs font-extrabold tracking-tight truncate text-[#002f49]">
                {meta.short}
              </div>
              <div className="text-[10px] font-medium truncate text-slate-500">
                {style.subtitle}
              </div>
            </div>

            <div className="w-full h-1.5 rounded-full overflow-hidden mb-2 sm:mb-2.5 bg-slate-100">
              <motion.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: Math.max(pct, count > 0 ? 6 : 0) / 100 }}
                transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                style={{ transformOrigin: 'left center', willChange: 'transform' }}
                className={`h-full w-full rounded-full ${style.accentBar}`}
              />
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-[10px] font-bold font-figure text-slate-500">
              <span>
                POS: <strong className="text-[#002f49]"><Odometer value={posCount} format={posCount >= 1000} duration={900} /></strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                SB: <strong className="text-[#002f49]"><Odometer value={sbCount} format={sbCount >= 1000} duration={900} /></strong>
              </span>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
});

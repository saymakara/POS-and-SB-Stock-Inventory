import React from 'react';
import { FilterX } from 'lucide-react';

/** Shared filter-bar styling tokens for consistent height and compact alignment across Merchant App Review tabs. */
export const REVIEW_FILTER_BAR_CLS = 'bg-white rounded-2xl border border-slate-200 px-3 py-2 shadow-2xs';
export const REVIEW_TAB_GROUP_CLS =
  'relative inline-flex items-center p-0.5 rounded-full bg-slate-200/75 dark:bg-slate-800/90 border border-slate-200/90 dark:border-slate-700/80 gap-0.5 max-w-full overflow-x-auto no-scrollbar [&>*]:shrink-0 shrink-0 select-none';
export const REVIEW_SELECT_CLS =
  'btn-press appearance-none h-[34px] pl-2.5 pr-6 rounded-xl text-xs font-medium border bg-white hover:bg-slate-50 text-slate-700 border-slate-200 outline-none focus:border-[#004e75] focus:ring-2 focus:ring-[#004e75]/10 transition-all cursor-pointer truncate';
export const REVIEW_INPUT_CLS =
  'w-full h-[34px] pl-8 pr-3 rounded-xl border border-slate-200 bg-white text-xs font-normal text-slate-800 placeholder:text-slate-400 outline-none focus:border-[#004e75] focus:ring-2 focus:ring-[#004e75]/10 shadow-2xs transition-all';

/** One "Clear filters" button for every tab: puts the search and all filters back to their starting values in one tap. */
export const ClearFiltersButton: React.FC<{
  active: boolean;
  onClear: () => void;
  className?: string;
  compact?: boolean;
  short?: boolean;
}> = ({ active, onClear, className = '', compact = false, short = false }) => (
  <button
    type="button"
    onClick={onClear}
    disabled={!active}
    aria-label="Clear filters"
    title={active ? 'Clear the search and all filters' : 'No filter is applied'}
    className={`btn-tactile inline-flex items-center justify-center gap-1.5 ${
      compact ? 'h-[34px] w-[34px] p-0' : short ? 'h-[34px] px-2.5' : 'px-3 py-2'
    } rounded-xl text-xs border shrink-0 whitespace-nowrap ${
      active
        ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100 hover:border-rose-300 font-semibold shadow-2xs cursor-pointer'
        : 'bg-slate-100 text-slate-400 border-slate-200 cursor-default'
    } ${className}`}
  >
    <FilterX className="w-3.5 h-3.5 shrink-0" />
    {compact ? (
      <span className="sr-only">Clear filters</span>
    ) : short ? (
      <span>
        Clear<span className="sr-only"> filters</span>
      </span>
    ) : (
      <span>Clear filters</span>
    )}
  </button>
);

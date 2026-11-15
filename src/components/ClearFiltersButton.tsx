import React from 'react';
import { FilterX } from 'lucide-react';

/** One "Clear filters" button for every tab: puts the search and all filters back to their starting values in one tap. */
export const ClearFiltersButton: React.FC<{ active: boolean; onClear: () => void; className?: string; compact?: boolean }> = ({ active, onClear, className = '', compact = false }) => (
  <button
    type="button"
    onClick={onClear}
    disabled={!active}
    aria-label="Clear filters"
    title={active ? 'Clear the search and all filters' : 'No filter is applied'}
    className={`btn-tactile inline-flex items-center justify-center gap-1.5 ${compact ? 'px-2 py-1.5' : 'px-3 py-2'} rounded-xl text-xs border shrink-0 whitespace-nowrap ${
      active
        ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100 hover:border-rose-300 font-semibold shadow-2xs cursor-pointer'
        : 'bg-slate-100 text-slate-400 border-slate-200 cursor-default'
    } ${className}`}
  >
    <FilterX className="w-3.5 h-3.5 shrink-0" />
    <span className={compact ? 'sr-only' : ''}>Clear filters</span>
  </button>
);

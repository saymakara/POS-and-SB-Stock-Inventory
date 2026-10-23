import React from 'react';
import { FilterX } from 'lucide-react';

/** One "Clear filters" button for every tab: puts the search and all filters back to their starting values in one tap. */
export const ClearFiltersButton: React.FC<{ active: boolean; onClear: () => void; className?: string }> = ({ active, onClear, className = '' }) => (
  <button
    type="button"
    onClick={onClear}
    disabled={!active}
    title={active ? 'Clear the search and all filters' : 'No filter is applied'}
    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs border transition shrink-0 ${
      active
        ? 'bg-white text-[#003857] border-[#003857]/40 hover:bg-[#003857] hover:text-white cursor-pointer'
        : 'bg-slate-50 text-slate-400 border-slate-200 cursor-default'
    } ${className}`}
  >
    <FilterX className="w-3.5 h-3.5" />
    <span>Clear filters</span>
  </button>
);

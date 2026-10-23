import React from 'react';
import { FilterX } from 'lucide-react';

/** One "Clear filters" button for every tab: puts the search and all filters back to their starting values in one tap. */
export const ClearFiltersButton: React.FC<{ active: boolean; onClear: () => void; className?: string }> = ({ active, onClear, className = '' }) => (
  <button
    type="button"
    onClick={onClear}
    disabled={!active}
    title={active ? 'Clear the search and all filters' : 'No filter is applied'}
    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs border transition-colors shrink-0 whitespace-nowrap ${
      active
        ? 'bg-[#003857] text-white border-[#003857] hover:bg-[#002a42] shadow-xs cursor-pointer'
        : 'bg-slate-100 text-slate-400 border-slate-200 cursor-default'
    } ${className}`}
  >
    <FilterX className="w-3.5 h-3.5" />
    <span>Clear filters</span>
  </button>
);

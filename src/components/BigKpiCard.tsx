import React from 'react';

/** (5 Nov 2026) The large figure card of the Phone App Review pages (KHQR, POS Terminal, Sound Box): one design for all. */
interface BigKpiCardProps {
  label: string;
  value: number | undefined;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  accentColor: 'blue' | 'emerald' | 'rose' | 'amber' | 'violet' | 'orange';
  badge?: string;
  onClick?: () => void;
  /** @deprecated No longer rendered (clean look) */
  actionLabel?: string;
}

export const BigKpiCard: React.FC<BigKpiCardProps> = ({
  label,
  value,
  sub,
  icon: Icon,
  accentColor,
  badge,
  onClick,
}) => {
  const isClickable = !!onClick;
  const Tag: any = isClickable ? 'button' : 'div';

  const theme = {
    blue: {
      iconBg: 'bg-sky-50 text-sky-600 border-sky-100',
      numColor: 'text-slate-900',
    },
    emerald: {
      iconBg: 'bg-emerald-50 text-emerald-600 border-emerald-100',
      numColor: 'text-slate-900',
    },
    rose: {
      iconBg: 'bg-rose-50 text-rose-600 border-rose-100',
      numColor: 'text-slate-900',
    },
    orange: {
      iconBg: 'bg-orange-50 text-orange-600 border-orange-100',
      numColor: 'text-slate-900',
    },
    violet: {
      iconBg: 'bg-violet-50 text-violet-600 border-violet-100',
      numColor: 'text-slate-900',
    },
    amber: {
      iconBg: 'bg-amber-50 text-amber-600 border-amber-100',
      numColor: 'text-slate-900',
    },
  }[accentColor];

  return (
    <Tag
      {...(isClickable ? { type: 'button', onClick, title: label } : {})}
      className={`relative flex flex-col justify-between p-5 rounded-2xl border border-slate-200/90 bg-white shadow-2xs transition-all duration-200 text-left ${
        isClickable ? 'cursor-pointer hover:border-slate-300 hover:shadow-md hover:-translate-y-0.5 group' : 'hover:border-slate-300 hover:shadow-xs'
      }`}
    >
      {/* Top row: Category Label + Icon Badge */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider truncate">
          {label}
        </span>
        <div className={`w-9.5 h-9.5 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center border shrink-0 transition-transform ${isClickable ? 'group-hover:scale-105' : ''} ${theme.iconBg}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>

      {/* Main KPI number */}
      <div className="my-2.5">
        <div className={`font-figure text-3xl sm:text-4xl font-bold tracking-tight tabular-nums leading-none ${theme.numColor}`}>
          {value === undefined ? '—' : value.toLocaleString()}
        </div>
      </div>

      {/* Subtitle / Footer info */}
      <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2 text-xs text-slate-500">
        <span className="truncate" title={sub}>
          {sub || '—'}
        </span>
        {badge ? (
          <span className="text-[11px] font-medium text-slate-400 shrink-0">
            {badge}
          </span>
        ) : null}
      </div>
    </Tag>
  );
};

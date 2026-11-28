import React from 'react';

export interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  id?: string;
  label?: string;
  title?: string;
  disabled?: boolean;
  className?: string;
}

/** Unified iOS emerald boolean switch (Style #1: h-6 w-11 capsule track with #059669 active fill). */
export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  checked,
  onChange,
  id,
  label,
  title,
  disabled = false,
  className = '',
}) => (
  <button
    id={id}
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    title={title}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`toggle-switch relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/35 disabled:opacity-50 disabled:cursor-not-allowed ${
      checked ? 'bg-emerald-600' : 'bg-slate-300/90 dark:bg-slate-600'
    } ${className}`}
  >
    <span
      aria-hidden="true"
      className={`toggle-knob pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out ${
        checked ? 'translate-x-5' : 'translate-x-0'
      }`}
    />
  </button>
);

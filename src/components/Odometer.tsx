import React from 'react';

/**
 * Odometer number: each digit is a column of 0-9 that slides with `transform` only, so a changing count rolls
 * smoothly on the GPU instead of snapping. Screen readers get the plain number.
 */
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

export const Odometer: React.FC<{ value: number; className?: string }> = ({ value, className }) => {
  const text = String(Math.max(0, Math.round(value)));
  return (
    <span className={`odo ${className || ''}`} role="text" aria-label={text}>
      {text.split('').map((ch, i) => (
        <span key={text.length - i} className="odo-col" aria-hidden>
          <span className="odo-strip" style={{ transform: `translate3d(0, ${-Number(ch) * 10}%, 0)` }}>
            {DIGITS.map((d) => <span key={d}>{d}</span>)}
          </span>
        </span>
      ))}
    </span>
  );
};

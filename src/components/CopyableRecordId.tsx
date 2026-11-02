import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

export interface CopyableRecordIdProps {
  id: string;
  label?: string;
  title?: string;
  className?: string;
  variant?: 'table' | 'badge' | 'pill' | 'subtle';
  onCopied?: (id: string) => void;
}

export const copyTextToClipboard = async (text: string): Promise<boolean> => {
  if (!text) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback below
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const success = document.execCommand('copy');
    document.body.removeChild(ta);
    return success;
  } catch {
    return false;
  }
};

export const CopyableRecordId: React.FC<CopyableRecordIdProps> = ({
  id,
  title,
  className = '',
  variant = 'table',
  onCopied,
}) => {
  const [copied, setCopied] = useState(false);

  if (!id) return <span className="text-slate-400 font-mono text-[11px]">—</span>;

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const ok = await copyTextToClipboard(id);
    if (ok) {
      setCopied(true);
      onCopied?.(id);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    }
  };

  if (variant === 'pill') {
    return (
      <button
        type="button"
        onClick={handleCopy}
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md font-mono text-[11px] font-medium border transition cursor-pointer select-none active:scale-95 ${
          copied
            ? 'bg-emerald-500/30 border-emerald-300/40 text-emerald-200'
            : 'bg-white/15 hover:bg-white/25 border-white/20 text-white'
        } ${className}`}
        title={title || (copied ? `Copied: ${id}` : `Click to copy ${id}`)}
      >
        <span>{id}</span>
        {copied ? (
          <Check className="w-3 h-3 text-emerald-300 shrink-0" aria-hidden />
        ) : (
          <Copy className="w-3 h-3 text-white/70 shrink-0" aria-hidden />
        )}
      </button>
    );
  }

  if (variant === 'badge') {
    return (
      <button
        type="button"
        onClick={handleCopy}
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md font-mono text-xs border transition cursor-pointer select-none active:scale-95 ${
          copied
            ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
            : 'bg-slate-100 hover:bg-slate-200/90 border-slate-200 text-slate-700 hover:text-slate-900'
        } ${className}`}
        title={title || (copied ? `Copied: ${id}` : `Click to copy ${id}`)}
      >
        <span>{id}</span>
        {copied ? (
          <Check className="w-3 h-3 text-emerald-600 shrink-0" aria-hidden />
        ) : (
          <Copy className="w-3 h-3 text-slate-400 shrink-0" aria-hidden />
        )}
      </button>
    );
  }

  // default table variant
  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`group/copy inline-flex items-center gap-1 -ml-1 px-1 py-0.5 rounded text-[11px] font-mono transition cursor-pointer max-w-full select-none active:scale-95 ${
        copied
          ? 'text-emerald-700 bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 font-semibold'
          : 'text-slate-500 hover:text-[#003857] hover:bg-sky-50 dark:hover:bg-slate-700/60 dark:text-slate-400'
      } ${className}`}
      title={title || (copied ? `Copied: ${id}` : `Click to copy ${id}`)}
    >
      <span className="truncate">{id}</span>
      {copied ? (
        <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden />
      ) : (
        <Copy
          className="w-3 h-3 text-slate-400 group-hover/copy:text-[#003857] dark:group-hover/copy:text-sky-300 shrink-0 opacity-60 group-hover/copy:opacity-100 transition"
          aria-hidden
        />
      )}
    </button>
  );
};

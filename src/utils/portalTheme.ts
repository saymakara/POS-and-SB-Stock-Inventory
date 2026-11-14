import { useCallback, useEffect, useState } from 'react';
import { ThemeMode } from '../types';

export type PortalPalette = 'navy' | 'cairn';

export const PORTAL_PALETTE_KEY = 'pos_portal_palette_v1';
export const PORTAL_MODE_KEY = 'pos_portal_mode_v1';
const THEME_EVENT = 'portal-theme-change';

const META_COLORS: Record<PortalPalette, Record<ThemeMode, string>> = {
  navy: { light: '#003857', dark: '#0B1220' },
  cairn: { light: '#1F5D50', dark: '#15171C' },
};

export function getStoredPortalPalette(): PortalPalette {
  try {
    const raw = localStorage.getItem(PORTAL_PALETTE_KEY);
    if (raw === 'navy' || raw === 'cairn') return raw;
  } catch {
    /* storage blocked */
  }
  return 'cairn';
}

export function getStoredThemeMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(PORTAL_MODE_KEY);
    if (raw === 'light' || raw === 'dark') return raw;
  } catch {
    /* storage blocked */
  }
  return 'light';
}

export function applyPortalTheme(palette: PortalPalette, mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.portalTheme = palette;
  root.dataset.theme = mode;
  root.classList.toggle('dark', mode === 'dark');
  root.style.colorScheme = mode;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', META_COLORS[palette][mode]);
  }
}

export function initPortalTheme(): { palette: PortalPalette; mode: ThemeMode } {
  const palette = getStoredPortalPalette();
  const mode = getStoredThemeMode();
  applyPortalTheme(palette, mode);
  return { palette, mode };
}

export function setPortalTheme(palette: PortalPalette, mode: ThemeMode): void {
  try {
    localStorage.setItem(PORTAL_PALETTE_KEY, palette);
    localStorage.setItem(PORTAL_MODE_KEY, mode);
  } catch {
    /* storage blocked */
  }
  applyPortalTheme(palette, mode);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: { palette, mode } }));
  }
}

export function usePortalTheme() {
  const [palette, setPaletteState] = useState<PortalPalette>(() => getStoredPortalPalette());
  const [mode, setModeState] = useState<ThemeMode>(() => getStoredThemeMode());

  useEffect(() => {
    applyPortalTheme(palette, mode);
  }, [palette, mode]);

  useEffect(() => {
    const onThemeEvent = (e: Event) => {
      const detail = (e as CustomEvent<{ palette: PortalPalette; mode: ThemeMode }>).detail;
      if (detail) {
        setPaletteState(detail.palette);
        setModeState(detail.mode);
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === PORTAL_PALETTE_KEY || e.key === PORTAL_MODE_KEY) {
        const nextPalette = getStoredPortalPalette();
        const nextMode = getStoredThemeMode();
        setPaletteState(nextPalette);
        setModeState(nextMode);
        applyPortalTheme(nextPalette, nextMode);
      }
    };
    window.addEventListener(THEME_EVENT, onThemeEvent);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(THEME_EVENT, onThemeEvent);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const setPalette = useCallback(
    (next: PortalPalette) => {
      setPaletteState(next);
      setPortalTheme(next, getStoredThemeMode());
    },
    []
  );

  const togglePalette = useCallback(() => {
    const next: PortalPalette = getStoredPortalPalette() === 'cairn' ? 'navy' : 'cairn';
    setPaletteState(next);
    setPortalTheme(next, getStoredThemeMode());
  }, []);

  const setMode = useCallback(
    (next: ThemeMode) => {
      setModeState(next);
      setPortalTheme(getStoredPortalPalette(), next);
    },
    []
  );

  const toggleMode = useCallback(() => {
    const next: ThemeMode = getStoredThemeMode() === 'dark' ? 'light' : 'dark';
    setModeState(next);
    setPortalTheme(getStoredPortalPalette(), next);
  }, []);

  return { palette, mode, setPalette, togglePalette, setMode, toggleMode };
}

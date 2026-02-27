export type ThemeMode = 'apple-light' | 'apple-dark';

export const THEME_OPTIONS: Array<{ value: ThemeMode; label: string }> = [
  { value: 'apple-light', label: '浅色' },
  { value: 'apple-dark', label: '深色' }
];

export function getInitialThemeMode(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'apple-light';
  }

  try {
    const stored = window.localStorage.getItem('f2_theme_mode');
    if (stored === 'glass' || stored === 'classic') {
      return 'apple-light';
    }

    if (stored === 'glass-ocean' || stored === 'glass-minimal' || stored === 'glass-sunset') {
      return 'apple-light';
    }

    const validModes = new Set<ThemeMode>(['apple-light', 'apple-dark']);
    return validModes.has(stored as ThemeMode) ? (stored as ThemeMode) : 'apple-light';
  } catch {
    return 'apple-light';
  }
}

export function persistThemeMode(themeMode: ThemeMode): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', themeMode);
  }

  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem('f2_theme_mode', themeMode);
  } catch {
    // ignore localStorage errors
  }
}

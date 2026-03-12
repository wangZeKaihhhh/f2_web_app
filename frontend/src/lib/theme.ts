export type ThemeMode = 'apple-light' | 'apple-dark';

export const THEME_OPTIONS: Array<{ value: ThemeMode; label: string }> = [
  { value: 'apple-dark', label: '深色' },
  { value: 'apple-light', label: '浅色' }
];

export function getInitialThemeMode(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'apple-dark';
  }

  try {
    const stored = window.localStorage.getItem('f2_theme_mode');
    if (stored === 'glass' || stored === 'classic') {
      return 'apple-light';
    }

    if (stored === 'glass-ocean' || stored === 'glass-minimal' || stored === 'glass-sunset') {
      return 'apple-dark';
    }

    const validModes = new Set<ThemeMode>(['apple-light', 'apple-dark']);
    return validModes.has(stored as ThemeMode) ? (stored as ThemeMode) : 'apple-dark';
  } catch {
    return 'apple-dark';
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

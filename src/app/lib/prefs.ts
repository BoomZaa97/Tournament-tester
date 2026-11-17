/** Personal display settings, kept per device (nothing to do with who may edit what). */

export type Theme = 'auto' | 'light' | 'dark';
export type TextSize = 'normal' | 'large';

export interface Prefs {
  theme: Theme;
  size: TextSize;
}

const KEY = 'tt.prefs.v1';
const DEFAULTS: Prefs = { theme: 'auto', size: 'normal' };

export function getPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
    return {
      theme: p.theme === 'light' || p.theme === 'dark' ? p.theme : 'auto',
      size: p.size === 'large' ? 'large' : 'normal',
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode: works until the tab closes */
  }
  applyPrefs(p);
}

/** Put the settings on <html> (styles.css reads data-theme / data-size). */
export function applyPrefs(p: Prefs) {
  const root = document.documentElement;
  if (p.theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = p.theme;
  if (p.size === 'large') root.dataset.size = 'large';
  else delete root.dataset.size;
  // the phone's address bar colour follows the chosen theme too
  for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const light = m.media.includes('light');
    if (!m.dataset.media) m.dataset.media = m.media;
    m.media = p.theme === 'auto' ? m.dataset.media : (p.theme === 'light') === light ? 'all' : 'not all';
  }
}

import { getSettings, makeStore } from './store';
import type { Settings, Store } from './store';

/** Hash routes work on GitHub Pages with no server config: #/t/abc123 */
function parse(hash: string): string[] {
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
}

class AppState {
  path = $state<string[]>(parse(location.hash));
  settings = $state<Settings>(getSettings());
  store = $state<Store>(makeStore(getSettings()));
  toast = $state<{ text: string; kind: 'ok' | 'error' } | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    addEventListener('hashchange', () => {
      this.path = parse(location.hash);
      scrollTo(0, 0);
    });
  }

  go(path: string) {
    location.hash = '#/' + path.replace(/^\//, '');
  }

  applySettings(s: Settings) {
    this.settings = s;
    this.store = makeStore(s);
  }

  notify(text: string, kind: 'ok' | 'error' = 'ok') {
    this.toast = { text, kind };
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast = null), kind === 'error' ? 6000 : 2500);
  }
}

export const app = new AppState();

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

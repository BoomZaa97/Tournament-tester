import { SvelteSet } from 'svelte/reactivity';
import { getSettings, KEYS_CHANGED, LOGGED_OUT, makeStore, myAccount } from './store';
import type { Account, Settings, Store } from './store';
import type { Player } from './model';

/** Hash routes work on GitHub Pages with no server config: #/t/abc123 */
function parse(hash: string): string[] {
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
}

class AppState {
  path = $state<string[]>(parse(location.hash));
  settings = $state<Settings>(getSettings());
  store = $state<Store>(makeStore(getSettings()));
  toast = $state<{ text: string; kind: 'ok' | 'error' } | null>(null);
  /** Logged-in player account on this device (shared mode). */
  account = $state<Account | null>(myAccount());
  /** Goes up whenever the account brought PINs or keys onto this device, so pages re-read them. */
  accountSync = $state(0);
  /** Ids of verified players (they have an account), from every player list the pages were sent. */
  verified = new SvelteSet<string>();
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // a removed helper link (or a replaced organizer link) was found out: pages re-check what this device can edit
    addEventListener(KEYS_CHANGED, () => this.accountSync++);
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
    this.syncAccount();
  }

  /** Re-read the account saved on this device (after logging in or out). */
  refreshAccount() {
    this.account = myAccount();
    this.accountSync++;
  }

  /** Bring this account's PINs and organizer keys onto this device. Quiet unless the login has expired. */
  async syncAccount() {
    if (!this.store.syncAccount || !myAccount()) return;
    try {
      await this.store.syncAccount();
    } catch (e) {
      if (errorText(e) === LOGGED_OUT) this.notify(LOGGED_OUT, 'error');
    }
    this.refreshAccount();
  }

  /** Note who is verified from a player list the sheet sent (accounts are never removed, so only add). */
  noteVerified(players: Player[]) {
    for (const p of players) if (p.account) this.verified.add(p.id);
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

import type { Player, TournamentDoc } from './model';

/**
 * What this device last saw of a Google Sheet, so pages can show it at once while the sheet
 * (4–6 s per request) answers. Only ever shown first and replaced by the sheet's answer.
 * Never holds PINs or keys: the sheet doesn't send those with tournaments.
 */
export interface CachedDoc {
  tournament: TournamentDoc;
  players: Player[];
  /** Has its log. Entries from the tournament list (lite) don't. */
  full: boolean;
}

interface Entry {
  t: TournamentDoc;
  players: Player[];
  full: boolean;
  /** When this device last stored or opened it (ms), to keep the most recent ones. */
  at: number;
}

interface Saved {
  url: string;
  list?: { tournaments: TournamentDoc[]; players: Player[] };
  docs: Record<string, Entry>;
}

export const CACHE_KEY = 'tt.cache.v1';
/** Most tournaments kept with their logs. */
export const CACHE_DOCS = 20;

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

export class DeviceCache {
  constructor(
    private url: string,
    private storage: Storage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
    private now: () => number = Date.now,
  ) {}

  private read(): Saved {
    try {
      const s: Saved = JSON.parse(this.storage?.getItem(CACHE_KEY) ?? 'null');
      // another sheet's data (the settings changed): start again
      if (s && s.url === this.url && s.docs) return s;
    } catch {
      /* corrupted or blocked: start again */
    }
    return { url: this.url, docs: {} };
  }

  private write(s: Saved) {
    const ids = Object.keys(s.docs).sort((a, b) => s.docs[b].at - s.docs[a].at);
    for (const id of ids.slice(CACHE_DOCS)) delete s.docs[id];
    try {
      this.storage?.setItem(CACHE_KEY, JSON.stringify(s));
    } catch {
      // storage full: keep only the newest few, else nothing (it's only a cache)
      try {
        for (const id of ids.slice(3)) delete s.docs[id];
        this.storage?.setItem(CACHE_KEY, JSON.stringify(s));
      } catch {
        try {
          this.storage?.removeItem(CACHE_KEY);
        } catch {
          /* ignore */
        }
      }
    }
  }

  /** The tournament list (lite: no logs). */
  setList(data: { tournaments: TournamentDoc[]; players: Player[] }) {
    const s = this.read();
    s.list = { tournaments: data.tournaments.map((t) => ({ ...t, log: [] })), players: data.players };
    this.write(s);
  }

  /** A tournament as the sheet just sent or stored it. `players` unset = keep the ones cached. */
  remember(t: TournamentDoc, players?: Player[], full = true) {
    const s = this.read();
    const old = s.docs[t.id];
    s.docs[t.id] = { t, players: players ?? old?.players ?? s.list?.players ?? [], full, at: this.now() };
    this.write(s);
  }

  forget(id: string) {
    const s = this.read();
    delete s.docs[id];
    if (s.list) s.list.tournaments = s.list.tournaments.filter((t) => t.id !== id);
    this.write(s);
  }

  /** The newest copy of one tournament this device has: its own entry, or the list's if that's newer. */
  peek(id: string): CachedDoc | null {
    const s = this.read();
    const d = s.docs[id];
    const l = s.list?.tournaments.find((t) => t.id === id);
    if (d && (!l || d.t.updatedAt >= l.updatedAt)) return { tournament: d.t, players: d.players, full: d.full };
    if (l) return { tournament: l, players: s.list!.players, full: false };
    return null;
  }

  /** The tournament list, with any newer copy of a tournament opened since. */
  peekAll(): { tournaments: TournamentDoc[]; players: Player[] } | null {
    const s = this.read();
    if (!s.list) return null;
    const tournaments = s.list.tournaments.map((t) => {
      const d = s.docs[t.id];
      return d && d.t.updatedAt > t.updatedAt ? d.t : t;
    });
    return { tournaments, players: s.list.players };
  }
}

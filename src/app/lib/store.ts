import type { Player, TournamentDoc } from './model';

export class VersionConflictError extends Error {
  constructor() {
    super('Someone else changed this tournament while you were editing. The latest version has been loaded; please redo your change.');
  }
}

export interface AllData {
  tournaments: TournamentDoc[];
  players: Player[];
}

/** Where data lives. Swap implementations without touching the UI. */
export interface Store {
  kind: 'local' | 'sheets';
  /** False for viewers of a shared Google Sheet who don't have the admin key. */
  canEdit: boolean;
  loadAll(): Promise<AllData>;
  get(id: string): Promise<TournamentDoc | null>;
  /** Saves and returns the doc with its new version. Throws VersionConflictError. */
  save(doc: TournamentDoc, players: Player[]): Promise<TournamentDoc>;
  remove(id: string): Promise<void>;
  renamePlayer(id: string, name: string): Promise<void>;
}

// ---------------------------------------------------------------- local

const LS_KEY = 'tt.data.v1';

function readLocal(): AllData {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* private mode or corrupted: start empty */
  }
  return { tournaments: [], players: [] };
}

function writeLocal(data: AllData) {
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

function upsertPlayers(list: Player[], add: Player[]): Player[] {
  const byId = new Map(list.map((p) => [p.id, p]));
  for (const p of add) byId.set(p.id, p);
  return [...byId.values()];
}

export class LocalStore implements Store {
  kind = 'local' as const;
  canEdit = true;

  async loadAll() {
    return readLocal();
  }

  async get(id: string) {
    return readLocal().tournaments.find((t) => t.id === id) ?? null;
  }

  async save(doc: TournamentDoc, players: Player[]) {
    const data = readLocal();
    const i = data.tournaments.findIndex((t) => t.id === doc.id);
    if (i >= 0 && data.tournaments[i].version !== doc.version) throw new VersionConflictError();
    const saved = { ...doc, version: doc.version + 1, updatedAt: new Date().toISOString() };
    if (i >= 0) data.tournaments[i] = saved;
    else data.tournaments.push(saved);
    data.players = upsertPlayers(data.players, players);
    writeLocal(data);
    return saved;
  }

  async remove(id: string) {
    const data = readLocal();
    data.tournaments = data.tournaments.filter((t) => t.id !== id);
    writeLocal(data);
  }

  async renamePlayer(id: string, name: string) {
    const data = readLocal();
    data.players = upsertPlayers(data.players, [{ id, name }]);
    writeLocal(data);
  }

  /** Replace everything (backup import). */
  importAll(data: AllData) {
    writeLocal(data);
  }
}

// ---------------------------------------------------------------- google sheets

/**
 * Talks to the Apps Script web app in /apps-script/Code.gs.
 * GET = public reads. POST = writes, checked against the admin key.
 * POSTs are sent as text/plain so the browser doesn't need a CORS preflight,
 * which Apps Script can't answer.
 */
export class SheetsStore implements Store {
  kind = 'sheets' as const;
  canEdit: boolean;

  constructor(private url: string, private key: string) {
    this.canEdit = key.length > 0;
  }

  private async call<T>(method: 'GET' | 'POST', params: Record<string, unknown>): Promise<T> {
    let res: Response;
    if (method === 'GET') {
      const qs = new URLSearchParams(params as Record<string, string>).toString();
      res = await fetch(`${this.url}?${qs}`);
    } else {
      res = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...params, key: this.key }),
      });
    }
    if (!res.ok) throw new Error(`Google Sheet request failed (${res.status})`);
    const body = await res.json();
    if (body.error === 'conflict') throw new VersionConflictError();
    if (body.error) throw new Error(body.error);
    return body as T;
  }

  loadAll() {
    return this.call<AllData>('GET', { action: 'all' });
  }

  async get(id: string) {
    const r = await this.call<{ tournament: TournamentDoc | null }>('GET', { action: 'get', id });
    return r.tournament;
  }

  async save(doc: TournamentDoc, players: Player[]) {
    const r = await this.call<{ tournament: TournamentDoc }>('POST', { action: 'save', tournament: doc, players });
    return r.tournament;
  }

  async remove(id: string) {
    await this.call('POST', { action: 'delete', id });
  }

  async renamePlayer(id: string, name: string) {
    await this.call('POST', { action: 'renamePlayer', id, name });
  }

  /** Returns true if the admin key is accepted. */
  async checkKey(): Promise<boolean> {
    const r = await this.call<{ admin: boolean }>('POST', { action: 'check' });
    return r.admin;
  }
}

// ---------------------------------------------------------------- settings

export interface Settings {
  source: 'local' | 'sheets';
  sheetsUrl: string;
  adminKey: string;
}

const SETTINGS_KEY = 'tt.settings.v1';

/** Site-wide default from public/config.json, so viewers need no setup. */
let siteConfig: { sheetsUrl?: string } = {};

export async function loadSiteConfig() {
  try {
    const res = await fetch('./config.json', { cache: 'no-store' });
    if (res.ok) siteConfig = await res.json();
  } catch {
    /* no config: local mode */
  }
}

export function getSettings(): Settings {
  let saved: Partial<Settings> = {};
  try {
    saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
  } catch {
    /* ignore */
  }
  const sheetsUrl = saved.sheetsUrl || siteConfig.sheetsUrl || '';
  return {
    source: saved.source ?? (sheetsUrl ? 'sheets' : 'local'),
    sheetsUrl,
    adminKey: saved.adminKey ?? '',
  };
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function makeStore(s: Settings = getSettings()): Store {
  if (s.source === 'sheets' && s.sheetsUrl) return new SheetsStore(s.sheetsUrl, s.adminKey);
  return new LocalStore();
}

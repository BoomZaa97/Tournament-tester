import type { MatchResult } from '../../core';
import { cleanCode, makeCode, UPDATE_SCRIPT } from './model';
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
  /** Site admin (the owner's key): can change every tournament. Always true in local mode. */
  isAdmin: boolean;
  /** Can this browser change this tournament? Admin, or its organizer/helper key is saved here. */
  canEdit(id: string): boolean;
  loadAll(): Promise<AllData>;
  get(id: string): Promise<TournamentDoc | null>;
  /** Saves and returns the doc with its new version. Throws VersionConflictError. */
  save(doc: TournamentDoc, players: Player[]): Promise<TournamentDoc>;
  remove(id: string): Promise<void>;
  renamePlayer(id: string, name: string): Promise<void>;
  /** The tournament with this join code. Throws if there is none. */
  findByCode(code: string): Promise<{ id: string; name: string }>;
  /** Shared (Google Sheet) mode only: players join and report their own scores. */
  signup?(id: string, name: string): Promise<{ playerId: string; pin: string; waitlisted?: boolean; tournament: TournamentDoc }>;
  report?(id: string, matchId: string, pin: string, result: ReportedResult, matchNo?: number): Promise<TournamentDoc>;
  /** Organizer/admin only: every entrant's PIN, by player id. */
  pins?(id: string): Promise<Record<string, string>>;
}

export type ReportedResult = Pick<MatchResult, 'winner' | 'score1' | 'score2' | 'p1' | 'p2'>;

// ---------------------------------------------------------------- keys kept in this browser

const KEYS = 'tt.keys.v1'; // { tournamentId: organizer key }
const PINS = 'tt.pins.v1'; // { tournamentId: { playerId, pin } }

function readJson<T>(k: string): Record<string, T> {
  try {
    return JSON.parse(localStorage.getItem(k) ?? '{}') ?? {};
  } catch {
    return {};
  }
}
function writeJson(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* private mode: works until the tab closes */
  }
}

export function orgKeyFor(id: string): string | undefined {
  return readJson<string>(KEYS)[id];
}
export function rememberOrgKey(id: string, key: string) {
  writeJson(KEYS, { ...readJson<string>(KEYS), [id]: key });
}
export function makeOrgKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return [...bytes].map((b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
}
export function myPin(id: string): { playerId: string; pin: string } | undefined {
  return readJson<{ playerId: string; pin: string }>(PINS)[id];
}
export function rememberPin(id: string, playerId: string, pin: string) {
  writeJson(PINS, { ...readJson(PINS), [id]: { playerId, pin } });
}
/** Link that gives a helper the same rights as the organizer. */
export function helperLink(id: string): string | undefined {
  const key = orgKeyFor(id);
  return key ? `${location.href.split('#')[0]}#/t/${id}/org/${key}` : undefined;
}

// ---------------------------------------------------------------- local

const LS_KEY = 'tt.data.v1';

function readLocal(): AllData {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const data: AllData = JSON.parse(raw);
      // tournaments made before join codes existed get one now
      if (data.tournaments.some((t) => !t.code)) {
        for (const t of data.tournaments) t.code ||= makeCode(data.tournaments.map((x) => x.code ?? ''));
        try {
          writeLocal(data);
        } catch {
          /* storage full: codes are made again next time */
        }
      }
      return data;
    }
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
  isAdmin = true;
  canEdit() {
    return true;
  }

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
    const code = doc.code || makeCode(data.tournaments.map((t) => t.code ?? ''));
    const saved = { ...doc, code, version: doc.version + 1, updatedAt: new Date().toISOString() };
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

  async findByCode(code: string) {
    const want = cleanCode(code);
    const t = readLocal().tournaments.find((t) => t.code && cleanCode(t.code) === want);
    if (!want || !t) throw new Error(`No tournament has the code ${want}`);
    return { id: t.id, name: t.name };
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
  isAdmin: boolean;

  constructor(private url: string, private key: string) {
    this.isAdmin = key.length > 0;
  }

  canEdit(id: string) {
    return this.isAdmin || !!orgKeyFor(id);
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
    // An older Google script that doesn't have this feature yet.
    if (typeof body.error === 'string' && body.error.startsWith('Unknown action')) throw new Error(UPDATE_SCRIPT);
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
    let orgKey = orgKeyFor(doc.id);
    if (!orgKey && doc.version === 0) {
      // A new tournament: whoever creates it is its organizer.
      orgKey = makeOrgKey();
      rememberOrgKey(doc.id, orgKey);
    }
    const r = await this.call<{ tournament: TournamentDoc }>('POST', { action: 'save', tournament: doc, players, orgKey: orgKey ?? '' });
    return r.tournament;
  }

  async remove(id: string) {
    await this.call('POST', { action: 'delete', id, orgKey: orgKeyFor(id) ?? '' });
  }

  async signup(id: string, name: string) {
    const r = await this.call<{ playerId: string; pin: string; waitlisted?: boolean; tournament: TournamentDoc }>('POST', { action: 'signup', id, name });
    rememberPin(id, r.playerId, r.pin);
    return r;
  }

  async report(id: string, matchId: string, pin: string, result: ReportedResult, matchNo?: number) {
    const r = await this.call<{ tournament: TournamentDoc; playerId: string }>('POST', { action: 'report', id, matchId, pin, result, matchNo });
    // So they don't have to type it again, unless this device already belongs to another player
    // (a borrowed phone keeps its owner).
    if (!myPin(id)) rememberPin(id, r.playerId, pin);
    return r.tournament;
  }

  async pins(id: string) {
    const r = await this.call<{ pins: Record<string, string> }>('POST', { action: 'pins', id, orgKey: orgKeyFor(id) ?? '' });
    return r.pins;
  }

  async renamePlayer(id: string, name: string) {
    await this.call('POST', { action: 'renamePlayer', id, name });
  }

  findByCode(code: string) {
    return this.call<{ id: string; name: string }>('GET', { action: 'code', code: cleanCode(code) });
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

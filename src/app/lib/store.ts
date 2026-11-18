import type { MatchResult } from '../../core';
import { DeviceCache } from './cache';
import type { CachedDoc } from './cache';
import { cleanCode, makeCode, UPDATE_SCRIPT } from './model';
import type { Official, Player, TournamentDoc } from './model';

export interface OfficialState {
  official: Official;
  officialNote: string;
}
import type { ChTournament } from './challonge';

export class VersionConflictError extends Error {
  constructor() {
    super('Someone else changed this tournament while you were editing. The latest version has been loaded; please redo your change.');
  }
}

/** A player's photo, bio and links (shown on their page). */
export interface Profile {
  /** A small square JPEG as a data: URL, or '' for none. */
  photo: string;
  bio: string;
  links: string[];
}

export interface AllData {
  tournaments: TournamentDoc[];
  players: Player[];
  /** Site-wide settings (shared mode). */
  site?: SiteSettings;
}

export interface SiteSettings {
  /** Only organizers and staff may create tournaments. */
  lockCreate: boolean;
  /** Announcements on the home page, newest first (staff post them). */
  news?: NewsItem[];
}

export interface NewsItem {
  id: string;
  title: string;
  text: string;
  /** https://… or a page on this site (#/…). */
  link: string;
  important: boolean;
  at: string;
}
export type NewsPost = Pick<NewsItem, 'title' | 'text' | 'link' | 'important'> & { id?: string };

/**
 * Roles. owner = the admin key on this device; the rest are given to accounts by the site admin.
 * See Code.gs (ROLE_RANK / PERMS) for what each may do; the script checks every request itself.
 */
export type Role = '' | 'organizer' | 'moderator' | 'admin' | 'owner';
export type Perm = 'tournaments' | 'players' | 'accounts' | 'audit' | 'roles' | 'settings' | 'create';
export const ROLE_RANK: Record<Role, number> = { '': 0, organizer: 1, moderator: 2, admin: 3, owner: 4 };
export const ROLE_LABEL: Record<Role, string> = { '': 'Player', organizer: 'Organizer', moderator: 'Moderator', admin: 'Admin', owner: 'Site owner' };
const PERM_RANK: Record<Perm, number> = { create: 1, tournaments: 2, players: 2, accounts: 2, audit: 2, roles: 3, settings: 3 };

export interface StaffAccount {
  id: string;
  username: string;
  playerId: string;
  name: string;
  role: Role;
  suspended: boolean;
  bannedUntil: string;
  banReason: string;
  locked: boolean;
  createdAt: string;
  lastLogin: string;
  lastSeen: string;
  recovery: boolean;
  twoStep: boolean;
  /** This device's role may manage it (it's below us). */
  manageable: boolean;
}

export interface AuditRow {
  time: string;
  actor: string;
  role: string;
  action: string;
  target: string;
  detail: string;
}

const SITE = 'tt.site.v1';
/** The site settings the sheet last sent (so pages know them before loading). */
export function siteSettings(): SiteSettings {
  try {
    return { lockCreate: false, ...JSON.parse(localStorage.getItem(SITE) || '{}') };
  } catch {
    return { lockCreate: false };
  }
}
const newsId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function rememberSite(site: SiteSettings | undefined) {
  if (!site) return;
  try {
    localStorage.setItem(SITE, JSON.stringify(site));
  } catch {
    /* ignore */
  }
}

/** Where data lives. Swap implementations without touching the UI. */
export interface Store {
  kind: 'local' | 'sheets';
  /** Site owner (the admin key): can change everything. Always true in local mode. */
  isAdmin: boolean;
  /** This device's role: owner (admin key) or the logged-in account's role. */
  role(): Role;
  /** May this device do this (by role)? The script checks it again. */
  can(perm: Perm): boolean;
  /** Can this browser change this tournament? Staff, or its organizer/helper key is saved here. */
  canEdit(id: string): boolean;
  /** Every tournament and player. Shared mode leaves out each tournament's log unless `full` (lists don't need it). */
  loadAll(opts?: { full?: boolean }): Promise<AllData>;
  get(id: string): Promise<TournamentDoc | null>;
  /**
   * One tournament (with its log) and its players, for its page. With `since` (the updatedAt the page
   * already shows), 'same' when nothing changed: polling stays cheap however many tournaments there are.
   */
  open(id: string, since?: string): Promise<{ tournament: TournamentDoc | null; players: Player[] } | 'same'>;
  /** Every player (to pick existing people when editing entrants). */
  players(): Promise<Player[]>;
  /**
   * What this device already has of a tournament, right now (shared mode: the device cache, maybe
   * out of date; `full` = has its log). Pages show it at once, then load the real thing.
   */
  peek(id: string): CachedDoc | null;
  /** The tournament list this device already has (shared mode: last seen, no logs). */
  peekAll(): AllData | null;
  /** A player's photo, bio and links (null = none yet). */
  profile(playerId: string): Promise<Profile | null>;
  /** The player themself (logged in) or the site admin. Returns what was stored. */
  saveProfile(playerId: string, profile: Profile): Promise<Profile>;
  /** Can this device change this player's profile? */
  canEditProfile(playerId: string): boolean;
  /**
   * Saves and returns the doc with its new version. Throws VersionConflictError.
   * `announce`: lines for the tournament's Discord channel, if it has one (shared mode).
   */
  save(doc: TournamentDoc, players: Player[], announce?: string[]): Promise<TournamentDoc>;
  remove(id: string): Promise<void>;
  renamePlayer(id: string, name: string): Promise<void>;
  /** Site admin: players in no tournament and without an account (`dryRun` only lists them). Returns who goes. */
  prunePlayers(dryRun: boolean): Promise<Player[]>;
  /** The tournament with this join code. Throws if there is none. */
  findByCode(code: string): Promise<{ id: string; name: string }>;
  /** Shared (Google Sheet) mode only: players join and report their own scores. */
  /** By name, or (no name) as the logged-in account's player. */
  signup?(id: string, name?: string): Promise<{ playerId: string; pin: string; waitlisted?: boolean; tournament: TournamentDoc }>;
  report?(id: string, matchId: string, pin: string, result: ReportedResult, matchNo?: number): Promise<TournamentDoc>;
  /** Mark someone as arrived (or not): a player with their PIN, or the organizer by player id. */
  checkin?(id: string, who: { pin: string } | { playerId: string }, here: boolean): Promise<TournamentDoc>;
  /** The opponent of whoever reported a result confirms it (ok) or disputes it, with their PIN. */
  confirm?(id: string, matchId: string, pin: string, ok: boolean, matchNo?: number, announce?: string[]): Promise<TournamentDoc>;
  /** Organizer: connect the tournament to a Discord channel (webhook link), or disconnect (''). Returns whether it's connected. */
  discord?(id: string, url: string): Promise<boolean>;
  /** Organizer: ask staff to make the tournament official (or withdraw the request). */
  requestOfficial?(id: string, note: string, cancel?: boolean): Promise<OfficialState>;
  /** Staff: make a tournament official ('yes'), refuse ('no') or clear it (''). */
  setOfficial(id: string, status: Official, note: string): Promise<OfficialState>;
  /** A Challonge tournament as Challonge's API returns it (fetched by the Google script; the key is never stored). */
  challonge?(ref: string, apiKey: string): Promise<ChTournament>;
  /** A player drops out of a running tournament with their PIN. */
  drop?(id: string, pin: string): Promise<TournamentDoc>;
  /** Organizer/admin only: every entrant's PIN, by player id. */
  pins?(id: string): Promise<Record<string, string>>;
  /** Player accounts (shared mode). Each returns the account now saved on this device. */
  /** Also returns the account's first recovery code (shown once). */
  register?(input: { username: string; password: string; name: string; claim?: { code: string; pin: string } }): Promise<Account & { recoveryCode?: string }>;
  /** `code`: the authenticator code, for accounts with two-step login (else the error is TWO_STEP). */
  login?(username: string, password: string, code?: string): Promise<Account>;
  /** Two-step login: a secret for the authenticator app (password), then the first code turns it on. */
  twoStepSetup?(password: string): Promise<{ secret: string; uri: string }>;
  twoStepOn?(code: string): Promise<Account>;
  twoStepOff?(password: string, code: string): Promise<Account>;
  /** Delete the logged-in account (password, and code with two-step). Logs this device out. */
  deleteMe?(password: string, code?: string): Promise<{ playerRemoved: boolean }>;
  /** Forgot password: username + one-time recovery code + new password. Logs in; returns the next recovery code. */
  recover?(username: string, code: string, newPassword: string): Promise<Account & { recoveryCode: string }>;
  /** Logged in: a new recovery code (the old one stops working). Needs the current password. */
  newRecoveryCode?(password: string): Promise<string>;
  /** Fetch this account's PINs and organizer keys onto this device (and share this device's keys with it). */
  syncAccount?(): Promise<Account>;
  changePassword?(password: string, newPassword: string): Promise<Account>;
  renameSelf?(name: string): Promise<Account>;
  /** Site admin: a new random password for the account of this player. */
  resetPassword?(playerId: string): Promise<{ username: string; password: string; twoStepOff?: boolean }>;
  /** Staff: remove a player's account. A player in no tournament goes too (playerRemoved); others stay, unverified. */
  deleteAccount?(playerId: string): Promise<{ playerRemoved: boolean }>;
  /** Staff (shared mode). */
  accounts?(): Promise<StaffAccount[]>;
  /** Admins: log this device in as a player (audited). `stopLoginAs` goes back. */
  loginAs?(playerId: string, reason?: string): Promise<Account>;
  setRole?(playerId: string, role: Role): Promise<void>;
  /** Suspend for some days or for good, or lift it (neither). */
  suspend?(playerId: string, opts: { days?: number; forever?: boolean; reason?: string }): Promise<void>;
  /** Log out every device: of another account (staff), or (no id) your own other devices. */
  logoutAll?(playerId?: string): Promise<void>;
  audit?(limit?: number): Promise<AuditRow[]>;
  setSite?(site: Partial<SiteSettings>): Promise<SiteSettings>;
  /** Staff: post (or, with an id, edit) an announcement, or remove one. */
  setNews(change: { post: NewsPost } | { remove: string }): Promise<SiteSettings>;
  /** The logged-in player's privacy choices. */
  setPrivacy?(p: { privateProfile?: boolean; unranked?: boolean }): Promise<Account>;
}

export interface Account {
  id: string;
  username: string;
  playerId: string;
  name: string;
  /** Has a recovery code (for "forgot password"). */
  recovery?: boolean;
  /** Two-step login (authenticator app) is on. */
  twoStep?: boolean;
  role?: Role;
  privateProfile?: boolean;
  unranked?: boolean;
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

// ---------------------------------------------------------------- account kept in this browser

const ACCOUNT = 'tt.account.v1';
/** Server message for a token that no longer works (password changed or reset). */
export const LOGGED_OUT = 'Your login has expired. Please log in again.';
export const SUSPENDED = 'This account is suspended';
/** Login needs the authenticator code (two-step login is on). */
export const TWO_STEP = 'Enter the 6-digit code from your authenticator app';

interface SavedAccount {
  token: string;
  account: Account;
  /** An admin logged in as this player ("Log in as"): this device's own keys are not shared with the account. */
  viewAs?: boolean;
  /** Tournament ids whose PIN / organizer key came from the account: removed again on log out. */
  pins: string[];
  keys: string[];
}

function savedAccount(): SavedAccount | null {
  try {
    const a = JSON.parse(localStorage.getItem(ACCOUNT) ?? 'null');
    return a && a.token && a.account ? { pins: [], keys: [], ...a } : null;
  } catch {
    return null;
  }
}
export function myAccount(): Account | null {
  return savedAccount()?.account ?? null;
}
function saveAccount(a: SavedAccount) {
  writeJson(ACCOUNT, a);
}
/** Log out on this device: forget the account and the PINs and organizer keys it brought. */
const VIEW_AS = 'tt.viewAs.v1'; // the admin's own saved account (or null) while logged in as someone

/** Logged in as someone else via "Log in as". */
export function viewingAs(): boolean {
  return !!savedAccount()?.viewAs;
}

/** Back from "Log in as": the admin's own login (if they had one) comes back. */
export function stopLoginAs() {
  let prev: SavedAccount | null = null;
  try {
    prev = JSON.parse(localStorage.getItem(VIEW_AS) || 'null');
    localStorage.removeItem(VIEW_AS);
  } catch {
    /* ignore */
  }
  forgetAccount();
  if (prev?.token) saveAccount({ ...prev, pins: [], keys: [] });
}

export function forgetAccount() {
  const a = savedAccount();
  if (a) {
    const pins = readJson(PINS);
    for (const id of a.pins) delete pins[id];
    writeJson(PINS, pins);
    const keys = readJson<string>(KEYS);
    for (const id of a.keys) delete keys[id];
    writeJson(KEYS, keys);
  }
  try {
    localStorage.removeItem(ACCOUNT);
  } catch {
    /* ignore */
  }
}
/**
 * Forget this device's organizer keys and PINs for tournaments that were deleted, so Settings and
 * the account stop listing them. `known` = the ids this device held when the list was asked for
 * (a tournament created meanwhile isn't in the answer yet, so it's left alone).
 */
export function forgetDeleted(existing: string[], known: { keys: string[]; pins: string[] }) {
  const live = new Set(existing);
  const keys = readJson<string>(KEYS);
  const pins = readJson(PINS);
  const goneKeys = known.keys.filter((id) => !live.has(id) && id in keys);
  const gonePins = known.pins.filter((id) => !live.has(id) && id in pins);
  if (!goneKeys.length && !gonePins.length) return;
  for (const id of goneKeys) delete keys[id];
  for (const id of gonePins) delete pins[id];
  writeJson(KEYS, keys);
  writeJson(PINS, pins);
  const a = savedAccount();
  if (a) saveAccount({ ...a, keys: a.keys.filter((id) => live.has(id)), pins: a.pins.filter((id) => live.has(id)) });
}
function heldIds() {
  return { keys: Object.keys(readJson<string>(KEYS)), pins: Object.keys(readJson(PINS)) };
}

/** Tournaments this device can edit with an organizer key. */
export function orgKeyIds(): string[] {
  return Object.keys(readJson<string>(KEYS));
}
/** Tournaments this device plays in (it has the PIN), with the player id. */
export function pinnedTournaments(): { id: string; playerId: string }[] {
  return Object.entries(readJson<{ playerId: string; pin: string }>(PINS)).map(([id, p]) => ({ id, playerId: p.playerId }));
}
/** Forget this device's organizer key for one tournament (it stops being able to edit it here). */
export function forgetOrgKey(id: string) {
  const keys = readJson<string>(KEYS);
  delete keys[id];
  writeJson(KEYS, keys);
}

/** Link that gives a helper the same rights as the organizer. */
export function helperLink(id: string): string | undefined {
  const key = orgKeyFor(id);
  return key ? `${location.href.split('#')[0]}#/t/${id}/org/${key}` : undefined;
}

// ---------------------------------------------------------------- local

const LS_KEY = 'tt.data.v1';
const PROFILES_KEY = 'tt.profiles.v1';

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

  role(): Role {
    return 'owner';
  }

  can() {
    return true;
  }
  canEdit() {
    return true;
  }

  async loadAll() {
    const d = readLocal();
    forgetDeleted(d.tournaments.map((t) => t.id), heldIds());
    return d;
  }

  async get(id: string) {
    return readLocal().tournaments.find((t) => t.id === id) ?? null;
  }

  async open(id: string) {
    const d = readLocal();
    return { tournament: d.tournaments.find((t) => t.id === id) ?? null, players: d.players };
  }

  async players() {
    return readLocal().players;
  }

  peek(id: string) {
    const d = readLocal();
    const t = d.tournaments.find((t) => t.id === id);
    return t ? { tournament: t, players: d.players, full: true } : null;
  }

  peekAll() {
    return readLocal();
  }

  async profile(playerId: string) {
    return readJson<Profile>(PROFILES_KEY)[playerId] ?? null;
  }

  async saveProfile(playerId: string, profile: Profile) {
    const all = readJson<Profile>(PROFILES_KEY);
    all[playerId] = profile;
    try {
      localStorage.setItem(PROFILES_KEY, JSON.stringify(all));
    } catch {
      throw new Error('This browser is out of storage space for the photo');
    }
    return profile;
  }

  canEditProfile() {
    return true;
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

  async setNews(change: { post: NewsPost } | { remove: string }) {
    const site = siteSettings();
    let news = site.news ?? [];
    if ('remove' in change) {
      news = news.filter((n) => n.id !== change.remove);
    } else {
      const p = change.post;
      const title = p.title.replace(/\s+/g, ' ').trim().slice(0, 80);
      if (!title) throw new Error('Give the announcement a title');
      const link = p.link.trim();
      if (link && !/^(https?:\/\/\S+|#\/\S*)$/.test(link)) throw new Error('The link must start with https:// (or #/ for a page on this site)');
      const item: NewsItem = { id: p.id ?? newsId(), title, text: p.text.trim().slice(0, 400), link, important: p.important, at: new Date().toISOString() };
      const old = p.id ? news.find((n) => n.id === p.id) : undefined;
      news = old ? news.map((n) => (n.id === p.id ? { ...item, at: old.at } : n)) : [item, ...news].slice(0, 8);
    }
    const next = { ...site, news };
    rememberSite(next);
    return next;
  }

  async setOfficial(id: string, status: Official, note: string) {
    const data = readLocal();
    const t = data.tournaments.find((x) => x.id === id);
    if (!t) throw new Error('Tournament not found');
    t.official = status;
    t.officialNote = note.trim();
    t.updatedAt = new Date().toISOString();
    writeLocal(data);
    return { official: status, officialNote: t.officialNote };
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

  async prunePlayers(dryRun: boolean) {
    const data = readLocal();
    const used = new Set<string>();
    for (const t of data.tournaments) {
      for (const e of t.entrants) used.add(e.id);
      for (const r of Object.values(t.results)) used.add(r.p1), used.add(r.p2);
    }
    const gone = data.players.filter((p) => !used.has(p.id));
    if (!dryRun && gone.length) {
      data.players = data.players.filter((p) => used.has(p.id));
      writeLocal(data);
    }
    return gone;
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

  private cache: DeviceCache;

  constructor(private url: string, private key: string) {
    this.isAdmin = key.length > 0;
    this.cache = new DeviceCache(url);
  }

  peek(id: string) {
    return this.cache.peek(id);
  }

  peekAll() {
    return this.cache.peekAll();
  }

  /** Keep what the sheet answered with on this device. */
  private keep(t: TournamentDoc) {
    this.cache.remember(t);
    return t;
  }

  role(): Role {
    if (this.isAdmin) return 'owner';
    return savedAccount()?.account.role ?? '';
  }

  can(perm: Perm) {
    if (perm === 'create' && !siteSettings().lockCreate) return true;
    return ROLE_RANK[this.role()] >= PERM_RANK[perm];
  }

  canEdit(id: string) {
    return this.can('tournaments') || !!orgKeyFor(id);
  }

  private staffToken() {
    const a = savedAccount();
    return a?.account.role ? a.token : '';
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
        // a staff account proves its role with its login token (`auth`); everyone else needs none
        body: JSON.stringify({ ...params, key: this.key, ...(this.staffToken() ? { auth: this.staffToken() } : {}) }),
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

  async loadAll(opts: { full?: boolean } = {}) {
    const held = heldIds();
    const data = await this.call<AllData>('GET', opts.full ? { action: 'all' } : { action: 'all', lite: '1' });
    this.cache.setList(data);
    rememberSite(data.site);
    forgetDeleted(data.tournaments.map((t) => t.id), held);
    return data;
  }

  async get(id: string) {
    const r = await this.call<{ tournament: TournamentDoc | null }>('GET', { action: 'get', id });
    return r.tournament;
  }

  async open(id: string, since?: string) {
    const r = await this.call<{ tournament?: TournamentDoc | null; players?: Player[]; same?: boolean }>(
      'GET',
      since ? { action: 'get', id, since } : { action: 'get', id },
    );
    if (r.same) return 'same' as const;
    // an older Google script sends no players with it
    const out = { tournament: r.tournament ?? null, players: r.players ?? (await this.loadAll()).players };
    if (out.tournament) this.cache.remember(out.tournament, out.players);
    else this.cache.forget(id);
    return out;
  }

  async profile(playerId: string) {
    try {
      // your own (or, for staff, anyone's) profile even when it's private
      const token = savedAccount()?.token;
      if (this.canEditProfile(playerId)) {
        try {
          return (await this.call<{ profile: Profile | null }>('POST', { action: 'readProfile', id: playerId, ...(token ? { token } : {}) })).profile;
        } catch (e) {
          // a script from before private profiles: every profile is public there, read it the old way
          if (!(e instanceof Error && e.message === UPDATE_SCRIPT)) throw e;
        }
      }
      return (await this.call<{ profile: Profile | null }>('GET', { action: 'profile', id: playerId })).profile;
    } catch (e) {
      if (e instanceof Error && e.message === UPDATE_SCRIPT) return null; // older script: no profiles yet
      throw e;
    }
  }

  async saveProfile(playerId: string, profile: Profile) {
    const token = savedAccount()?.token;
    const r = await this.call<{ profile: Profile }>('POST', { action: 'profile', id: playerId, ...profile, ...(token ? { token } : {}) });
    return r.profile;
  }

  canEditProfile(playerId: string) {
    return this.can('players') || savedAccount()?.account.playerId === playerId;
  }

  async players() {
    try {
      return (await this.call<{ players: Player[] }>('GET', { action: 'players' })).players;
    } catch (e) {
      if (e instanceof Error && e.message === UPDATE_SCRIPT) return (await this.loadAll()).players;
      throw e;
    }
  }

  async save(doc: TournamentDoc, players: Player[], announce?: string[]) {
    let orgKey = orgKeyFor(doc.id);
    if (!orgKey && doc.version === 0) {
      // A new tournament: whoever creates it is its organizer.
      orgKey = makeOrgKey();
      rememberOrgKey(doc.id, orgKey);
    }
    const token = savedAccount()?.token;
    const r = await this.call<{ tournament: TournamentDoc }>('POST', {
      action: 'save', tournament: doc, players, orgKey: orgKey ?? '', ...(token ? { token } : {}), ...(announce?.length ? { announce } : {}),
    });
    if (token && doc.version === 0) this.track('keys', doc.id);
    return this.keep(r.tournament);
  }

  async remove(id: string) {
    await this.call('POST', { action: 'delete', id, orgKey: orgKeyFor(id) ?? '' });
    this.cache.forget(id);
  }

  async signup(id: string, name?: string) {
    const who = name === undefined ? { token: savedAccount()?.token ?? '' } : { name };
    const r = await this.call<{ playerId: string; pin: string; waitlisted?: boolean; tournament: TournamentDoc }>('POST', { action: 'signup', id, ...who });
    rememberPin(id, r.playerId, r.pin);
    if (name === undefined) this.track('pins', id);
    this.keep(r.tournament);
    return r;
  }

  // ---- accounts

  /** Remember that this tournament's PIN or key came with the account, so log out removes it. */
  private track(kind: 'pins' | 'keys', id: string) {
    const a = savedAccount();
    if (a && !a[kind].includes(id)) saveAccount({ ...a, [kind]: [...a[kind], id] });
  }

  private async loggedIn(r: { token: string; account: Account }) {
    const old = savedAccount();
    const same = old?.account.id === r.account.id;
    if (old && !same) forgetAccount();
    saveAccount({ token: r.token, account: r.account, pins: same ? old!.pins : [], keys: same ? old!.keys : [] });
    try {
      return await this.syncAccount();
    } catch {
      return r.account; // logged in; PINs and keys come with the next sync
    }
  }

  /** PINs this device remembers: proof for taking over a player who already played here. */
  private claims() {
    return Object.entries(readJson<{ playerId: string; pin: string }>(PINS)).map(([id, p]) => ({ id, pin: p.pin }));
  }

  async register(input: { username: string; password: string; name: string; claim?: { code: string; pin: string } }) {
    const r = await this.call<{ token: string; account: Account; recoveryCode?: string }>('POST', { action: 'register', ...input, claims: this.claims() });
    return { ...(await this.loggedIn(r)), recoveryCode: r.recoveryCode };
  }

  async recover(username: string, code: string, newPassword: string) {
    const r = await this.call<{ token: string; account: Account; recoveryCode: string }>('POST', { action: 'recover', username, code, newPassword });
    return { ...(await this.loggedIn(r)), recoveryCode: r.recoveryCode };
  }

  async newRecoveryCode(password: string) {
    const a = savedAccount();
    const r = await this.call<{ recoveryCode: string; account: Account }>('POST', { action: 'recoveryCode', token: a?.token ?? '', password });
    const now = savedAccount();
    if (now) saveAccount({ ...now, account: r.account });
    return r.recoveryCode;
  }

  async login(username: string, password: string, code?: string) {
    const r = await this.call<{ token: string; account: Account }>('POST', { action: 'login', username, password, ...(code ? { code } : {}) });
    return this.loggedIn(r);
  }

  async twoStepSetup(password: string) {
    return this.call<{ secret: string; uri: string }>('POST', { action: 'twoStepSetup', token: savedAccount()?.token ?? '', password });
  }

  async twoStepOn(code: string) {
    const r = await this.call<{ account: Account }>('POST', { action: 'twoStepOn', token: savedAccount()?.token ?? '', code });
    const a = savedAccount();
    if (a) saveAccount({ ...a, account: r.account });
    return r.account;
  }

  async twoStepOff(password: string, code: string) {
    const r = await this.call<{ account: Account }>('POST', { action: 'twoStepOff', token: savedAccount()?.token ?? '', password, code });
    const a = savedAccount();
    if (a) saveAccount({ ...a, account: r.account });
    return r.account;
  }

  async deleteMe(password: string, code?: string) {
    const r = await this.call<{ playerRemoved: boolean }>('POST', { action: 'deleteMe', token: savedAccount()?.token ?? '', password, ...(code ? { code } : {}) });
    forgetAccount();
    return r;
  }

  async syncAccount() {
    const a = savedAccount();
    if (!a) throw new Error(LOGGED_OUT);
    let r: { account: Account; pins: Record<string, { playerId: string; pin: string }>; orgKeys: Record<string, string> };
    try {
      // logged in as someone else: don't hand this device's organizer keys to their account
      r = await this.call('POST', { action: 'me', token: a.token, orgKeys: a.viewAs ? {} : readJson<string>(KEYS) });
    } catch (e) {
      if (e instanceof Error && (e.message === LOGGED_OUT || e.message.startsWith(SUSPENDED))) forgetAccount();
      throw e;
    }
    // This device now acts as the account's player in its tournaments (a borrowed phone's PIN gives way).
    writeJson(PINS, { ...readJson(PINS), ...r.pins });
    writeJson(KEYS, { ...readJson<string>(KEYS), ...r.orgKeys });
    const now = savedAccount() ?? a;
    saveAccount({
      ...now,
      account: r.account,
      pins: [...new Set([...now.pins, ...Object.keys(r.pins)])],
      keys: [...new Set([...now.keys, ...Object.keys(r.orgKeys)])],
    });
    return r.account;
  }

  async changePassword(password: string, newPassword: string) {
    const a = savedAccount();
    const r = await this.call<{ token: string; account: Account }>('POST', { action: 'password', token: a?.token ?? '', password, newPassword });
    if (a) saveAccount({ ...a, token: r.token, account: r.account });
    return r.account;
  }

  async renameSelf(name: string) {
    const a = savedAccount();
    const r = await this.call<{ account: Account }>('POST', { action: 'rename', token: a?.token ?? '', name });
    if (a) saveAccount({ ...a, account: r.account });
    return r.account;
  }

  resetPassword(playerId: string) {
    return this.call<{ username: string; password: string; twoStepOff?: boolean }>('POST', { action: 'resetPassword', playerId });
  }

  async deleteAccount(playerId: string) {
    return this.call<{ playerRemoved: boolean }>('POST', { action: 'deleteAccount', playerId });
  }

  async loginAs(playerId: string, reason?: string) {
    const r = await this.call<{ token: string; account: Account }>('POST', { action: 'loginAs', playerId, reason: reason ?? '' });
    const mine = savedAccount();
    try {
      // keep the admin's own login to come back to (only the first time, not when switching between players)
      if (!mine?.viewAs) localStorage.setItem(VIEW_AS, JSON.stringify(mine));
    } catch {
      /* ignore */
    }
    if (mine) forgetAccount();
    saveAccount({ token: r.token, account: r.account, pins: [], keys: [], viewAs: true });
    try {
      return await this.syncAccount();
    } catch {
      return r.account;
    }
  }

  async accounts() {
    return (await this.call<{ accounts: StaffAccount[] }>('POST', { action: 'accounts' })).accounts;
  }

  async setRole(playerId: string, role: Role) {
    await this.call('POST', { action: 'setRole', playerId, role });
  }

  async suspend(playerId: string, opts: { days?: number; forever?: boolean; reason?: string }) {
    await this.call('POST', { action: 'suspend', playerId, ...opts });
  }

  async logoutAll(playerId?: string) {
    if (playerId) {
      await this.call('POST', { action: 'logoutAll', playerId });
      return;
    }
    const a = savedAccount();
    const r = await this.call<{ token: string; account: Account }>('POST', { action: 'logoutAll', token: a?.token ?? '' });
    if (a) saveAccount({ ...a, token: r.token, account: r.account });
  }

  async audit(limit = 300) {
    return (await this.call<{ audit: AuditRow[] }>('POST', { action: 'audit', limit })).audit;
  }

  async setNews(change: { post: NewsPost } | { remove: string }) {
    const r = await this.call<{ site: SiteSettings }>('POST', { action: 'news', ...change });
    rememberSite(r.site);
    return r.site;
  }

  async setSite(site: Partial<SiteSettings>) {
    const r = await this.call<{ site: SiteSettings }>('POST', { action: 'site', ...site });
    rememberSite(r.site);
    return r.site;
  }

  async setPrivacy(p: { privateProfile?: boolean; unranked?: boolean }) {
    const a = savedAccount();
    const r = await this.call<{ account: Account }>('POST', { action: 'privacy', token: a?.token ?? '', ...p });
    if (a) saveAccount({ ...a, account: r.account });
    return r.account;
  }

  async report(id: string, matchId: string, pin: string, result: ReportedResult, matchNo?: number) {
    const r = await this.call<{ tournament: TournamentDoc; playerId: string }>('POST', { action: 'report', id, matchId, pin, result, matchNo });
    // So they don't have to type it again, unless this device already belongs to another player
    // (a borrowed phone keeps its owner).
    if (!myPin(id)) rememberPin(id, r.playerId, pin);
    return this.keep(r.tournament);
  }

  async checkin(id: string, who: { pin: string } | { playerId: string }, here: boolean) {
    const r = await this.call<{ tournament: TournamentDoc; playerId: string }>('POST', {
      action: 'checkin', id, here, ...who, orgKey: orgKeyFor(id) ?? '',
    });
    if ('pin' in who && !myPin(id)) rememberPin(id, r.playerId, who.pin);
    return this.keep(r.tournament);
  }

  async confirm(id: string, matchId: string, pin: string, ok: boolean, matchNo?: number, announce?: string[]) {
    const r = await this.call<{ tournament: TournamentDoc; playerId: string }>('POST', {
      action: 'confirm', id, matchId, pin, ok, matchNo, ...(announce?.length ? { announce } : {}),
    });
    if (!myPin(id)) rememberPin(id, r.playerId, pin);
    return this.keep(r.tournament);
  }

  async requestOfficial(id: string, note: string, cancel = false) {
    return this.call<OfficialState>('POST', { action: 'requestOfficial', id, note, cancel, orgKey: orgKeyFor(id) ?? '' });
  }

  async setOfficial(id: string, status: Official, note: string) {
    return this.call<OfficialState>('POST', { action: 'setOfficial', id, status, note });
  }

  async discord(id: string, url: string) {
    const r = await this.call<{ discord: boolean }>('POST', { action: 'discord', id, url, orgKey: orgKeyFor(id) ?? '' });
    return r.discord;
  }

  async challonge(ref: string, apiKey: string) {
    const r = await this.call<{ challonge: ChTournament }>('POST', { action: 'challonge', ref, apiKey });
    return r.challonge;
  }

  async drop(id: string, pin: string) {
    const r = await this.call<{ tournament: TournamentDoc; playerId: string }>('POST', { action: 'drop', id, pin });
    return this.keep(r.tournament);
  }

  async pins(id: string) {
    const r = await this.call<{ pins: Record<string, string> }>('POST', { action: 'pins', id, orgKey: orgKeyFor(id) ?? '' });
    return r.pins;
  }

  async renamePlayer(id: string, name: string) {
    await this.call('POST', { action: 'renamePlayer', id, name });
  }

  async prunePlayers(dryRun: boolean) {
    const r = await this.call<{ removed: Player[] }>('POST', { action: 'prunePlayers', dryRun });
    return r.removed;
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

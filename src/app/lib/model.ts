import {
  BYE, createTournament, defaultTiebreakers, eliminationPlacements, finalsSize, hasPointsStage, isComplete, lockSwissRounds,
  overallPlacements, roundRobinStandings,
} from '../../core';
import type {
  Change, EntrantId, Format, FormatOptions, MatchResult, MatchTemplate, ResolvedMatch, Source, Tiebreaker, TournamentState,
} from '../../core';

/** A row in the entrant editor. */
export interface Row {
  key: string;
  name: string;
  /** Player id this slot had when editing started (absent for new rows). */
  origId?: string;
}

export interface Player {
  id: string;
  name: string;
}

export interface LogEntry {
  id: string;
  time: string; // ISO
  summary: string;
  changes: Change[];
  /** For tournament edits (entrants/format): the previous setup, so it can be undone. */
  restore?: Pick<TournamentDoc, 'name' | 'game' | 'format' | 'options' | 'scoring' | 'entrants' | 'results'>;
  undone?: boolean;
}

export interface Scoring {
  /** Golf-style games where the lower score wins. */
  lowerWins?: boolean;
  /** Round robin points. */
  points?: { win: number; draw: number; loss: number };
  tiebreakers?: Tiebreaker[];
}

/** Everything we store about one tournament. The bracket itself is never stored. */
export interface TournamentDoc {
  id: string;
  name: string;
  game: string;
  format: Format;
  options: FormatOptions;
  scoring: Scoring;
  /** Seed order. `id` is the player id, so history works across tournaments. */
  entrants: Player[];
  results: Record<string, MatchResult>;
  /** Players can add themselves (shared Google Sheet mode, before anything is played). */
  signup?: boolean;
  /**
   * Short join code people type on the home page (or scan as a QR code at the door). Made by the
   * Google script (unique there) or by this browser in local mode. Missing = the Google script is
   * an older version that doesn't know about codes yet.
   */
  code?: string;
  log: LogEntry[];
  createdAt: string;
  updatedAt: string;
  /** Bumped on every save; used to stop two people overwriting each other. */
  version: number;
}

export const FORMAT_LABEL: Record<Format, string> = {
  single_elim: 'Single elimination',
  double_elim: 'Double elimination',
  round_robin: 'Round robin',
  swiss: 'Swiss',
  groups: 'Groups',
};

/** Formats ranked by a points table (round robin, swiss) rather than a bracket. */
export function isTableFormat(format: Format): boolean {
  return hasPointsStage(format);
}

/** This tournament ends with a knockout final after its points stage. */
export function hasFinals(doc: Pick<TournamentDoc, 'format' | 'entrants' | 'options'>): boolean {
  return finalsSize(doc.format, doc.entrants.length, doc.options) > 0;
}

/** Name of the points stage tab / section. */
export function pointsStageName(format: Format): string {
  return format === 'groups' ? 'Groups' : 'Rounds';
}

/**
 * Everyone's final place (null = not decided yet), from the finals if there are any,
 * else the points table (only once finished) or the bracket.
 */
export function finalPlaces(doc: TournamentDoc, tstate: TournamentState): Map<EntrantId, number | null> {
  if (hasFinals(doc)) return new Map(overallPlacements(tstate, standingOptions(doc)).map((p) => [p.entrant, p.place]));
  if (isTableFormat(doc.format)) {
    const finished = statusOf(doc) === 'finished';
    return new Map(tableStandings(doc, tstate).map((r) => [r.entrant, finished ? r.rank : null]));
  }
  return new Map(eliminationPlacements(tstate).map((p) => [p.entrant, p.place]));
}

/** The admin's tiebreaker order, fitted to the format (OMW% and Buchholz only mean something in swiss). */
export function tiebreakersFor(format: Format, scoring: Scoring): Tiebreaker[] {
  const list = scoring.tiebreakers ?? defaultTiebreakers(format);
  const swissOnly: Tiebreaker[] = ['omw', 'buchholz'];
  if (format !== 'swiss') return list.filter((t) => !swissOnly.includes(t));
  return [...list, ...swissOnly.filter((t) => !list.includes(t))];
}

/** Points table for round robin / swiss, using the tournament's own scoring. */
export function tableStandings(doc: Pick<TournamentDoc, 'format' | 'scoring'>, tstate: TournamentState) {
  return roundRobinStandings(tstate, standingOptions(doc));
}

/** Points and tiebreakers for this tournament's tables. */
export function standingOptions(doc: Pick<TournamentDoc, 'format' | 'scoring'>) {
  return { points: doc.scoring.points, tiebreakers: tiebreakersFor(doc.format, doc.scoring) };
}

/** Join code letters: no look-alikes (no 0/O, no 1/I). Same set as Code.gs. */
export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeCode(used: Iterable<string> = []): string {
  const taken = new Set([...used].map(cleanCode));
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    const code = [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
    if (!taken.has(code)) return code;
  }
}

/** What someone typed, as a code: capitals, no spaces or dashes. */
export function cleanCode(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Shared mode, but the Google script was pasted before the newer features existed. */
export function scriptOutdated(doc: Pick<TournamentDoc, 'code'>, kind: 'local' | 'sheets'): boolean {
  return kind === 'sheets' && !doc.code;
}

export const UPDATE_SCRIPT = 'The site owner needs to update the Google script for this.';

export function newId(): string {
  return Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7);
}

export function toState(doc: Pick<TournamentDoc, 'format' | 'entrants' | 'options' | 'results'>): TournamentState {
  const ids = doc.entrants.map((e) => e.id);
  const state = { ...createTournament(doc.format, ids, doc.options), results: doc.results };
  if (doc.format !== 'swiss') return state;
  // A player may have reported into a swiss round the sheet couldn't freeze (it has no bracket
  // engine). Freeze it now, from the same results the player saw; the next save stores it.
  return { ...createTournament(doc.format, ids, lockSwissRounds(state, doc.results)), results: doc.results };
}

export function nameMap(doc: TournamentDoc, players: Player[] = []): Map<EntrantId, string> {
  const m = new Map(doc.entrants.map((e) => [e.id, e.name]));
  for (const p of players) if (m.has(p.id)) m.set(p.id, p.name); // registry wins (renames)
  return m;
}

/** "Quarterfinals", "Losers Round 2", "Grand Final Reset", ... */
export function roundName(t: MatchTemplate, all: MatchTemplate[], format: Format): string {
  const lastOf = (side: string) => Math.max(...all.filter((m) => m.side === side).map((m) => m.round));
  switch (t.side) {
    case 'RR':
      return t.group ? `Group ${t.group} · Round ${t.round}` : `Round ${t.round}`;
    case 'SW':
      return `Round ${t.round}`;
    case '3P':
      return '3rd Place';
    case 'GF':
      return t.round === 1 ? 'Grand Final' : 'Grand Final Reset';
    case 'L':
      return t.round === lastOf('L') ? 'Losers Final' : `Losers Round ${t.round}`;
    case 'W': {
      const fromEnd = lastOf('W') - t.round;
      if (format === 'double_elim' || all.some((m) => m.side === 'GF')) {
        return fromEnd === 0 ? 'Winners Final' : fromEnd === 1 ? 'Winners Semis' : `Winners Round ${t.round}`;
      }
      return ['Final', 'Semifinals', 'Quarterfinals'][fromEnd] ?? `Round ${t.round}`;
    }
  }
}

/** A match with an empty slot is never played (it auto-advances), so it is hidden and not numbered. */
export function isByeMatch(m: ResolvedMatch): boolean {
  return m.p1 === BYE || m.p2 === BYE;
}

/** Match numbers like Challonge: 1, 2, 3 ... in play order, skipping byes. */
export function matchNumbers(resolved: Map<string, ResolvedMatch>): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of resolved.values()) if (!isByeMatch(m)) out.set(m.template.id, out.size + 1);
  return out;
}

/** "Winner of 5" / "Loser of 2", looking through bye matches to the real source. */
export function describeSource(src: Source, resolved: Map<string, ResolvedMatch>, numbers: Map<string, number>): string {
  if (src.type === 'qualified') return `Finalist ${src.seed}`;
  if (src.type !== 'winner' && src.type !== 'loser') return 'TBD';
  const from = resolved.get(src.match);
  if (from && isByeMatch(from) && src.type === 'winner') {
    const real = from.p1 === BYE ? from.template.p2 : from.template.p1;
    return describeSource(real, resolved, numbers);
  }
  return `${src.type === 'winner' ? 'Winner' : 'Loser'} of ${numbers.get(src.match) ?? '?'}`;
}

export function formatScore(r?: MatchResult): string {
  if (!r) return '';
  if (r.forfeit) return 'FF';
  if (r.score1 === undefined && r.score2 === undefined) return r.winner === 'draw' ? 'Draw' : 'W';
  return `${r.score1 ?? 0}–${r.score2 ?? 0}`;
}

/** One-line description of a result for the change log. */
export function describeResult(r: MatchResult | undefined, names: Map<string, string>): string {
  if (!r) return 'no result';
  const a = names.get(r.p1) ?? '?';
  const b = names.get(r.p2) ?? '?';
  if (r.forfeit) return `${r.winner === 'p1' ? a : b} wins by forfeit vs ${r.winner === 'p1' ? b : a}`;
  const score = r.score1 !== undefined || r.score2 !== undefined ? ` ${r.score1 ?? 0}–${r.score2 ?? 0} ` : ' vs ';
  const tag = r.winner === 'draw' ? ' (draw)' : '';
  return `${a}${score}${b}${tag}`;
}

export function emptyDoc(): TournamentDoc {
  const now = new Date().toISOString();
  return {
    id: newId(),
    name: '',
    game: '',
    format: 'single_elim',
    options: {},
    scoring: {},
    entrants: [],
    results: {},
    log: [],
    createdAt: now,
    updatedAt: now,
    version: 0,
  };
}

export type Status = 'setup' | 'running' | 'finished';

export function statusOf(doc: TournamentDoc): Status {
  if (doc.entrants.length < 2 || Object.keys(doc.results).length === 0) return 'setup';
  return isComplete(toState(doc)) ? 'finished' : 'running';
}

export const STATUS_LABEL: Record<Status, string> = { setup: 'Not started', running: 'In progress', finished: 'Finished' };

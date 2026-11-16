import { BYE, createTournament, isComplete } from '../../core';
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
};

export function newId(): string {
  return Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7);
}

export function toState(doc: Pick<TournamentDoc, 'format' | 'entrants' | 'options' | 'results'>): TournamentState {
  const base = createTournament(doc.format, doc.entrants.map((e) => e.id), doc.options);
  return { ...base, results: doc.results };
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
      return `Round ${t.round}`;
    case '3P':
      return '3rd Place';
    case 'GF':
      return t.round === 1 ? 'Grand Final' : 'Grand Final Reset';
    case 'L':
      return t.round === lastOf('L') ? 'Losers Final' : `Losers Round ${t.round}`;
    case 'W': {
      const fromEnd = lastOf('W') - t.round;
      if (format === 'double_elim') {
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

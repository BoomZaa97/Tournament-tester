/**
 * Core types for the tournament engine.
 *
 * Key idea: we only ever STORE the bracket structure (generated once) and the
 * match results. Who plays in which match is always DERIVED from those two
 * things by `resolve()`. That is what makes editing old results safe.
 */

export type EntrantId = string;

/** Marker for "nobody" (an empty bracket slot). Byes auto-advance the other side. */
export const BYE = '__BYE__' as const;
export type Bye = typeof BYE;

/** Where a match slot gets its participant from. */
export type Source =
  | { type: 'seed'; seed: number } // 1-based seed in the entrant list
  | { type: 'winner'; match: string }
  | { type: 'loser'; match: string }
  | { type: 'empty' }; // always a bye

export type BracketSide =
  | 'W' // winners bracket (or the only bracket in single elim)
  | 'L' // losers bracket
  | 'GF' // grand final (double elim)
  | '3P' // third place match
  | 'RR'; // round robin

export interface MatchTemplate {
  id: string;
  side: BracketSide;
  round: number; // 1-based, within its side
  index: number; // 1-based position within the round
  p1: Source;
  p2: Source;
  /**
   * Only played if the condition holds. Used for the grand final reset:
   * the second GF is only needed if the losers-bracket player wins the first.
   */
  onlyIf?: { type: 'p2Won'; match: string };
  /**
   * When the loser of this match is knocked out, this is how "deep" they got.
   * Higher = better placement. Undefined = losing here does not eliminate.
   */
  elimLevel?: number;
  /** For final-type matches: the level the WINNER finishes at (e.g. champion, 3rd place). */
  winLevel?: number;
  /** Round-robin group label, if any. */
  group?: string;
}

export type Format = 'single_elim' | 'double_elim' | 'round_robin';

export interface Structure {
  format: Format;
  entrantCount: number;
  matches: MatchTemplate[];
}

export type Winner = 'p1' | 'p2' | 'draw';

export interface MatchResult {
  winner: Winner;
  score1?: number;
  score2?: number;
  /** Per-game scores for best-of-N, e.g. [[2,1],[0,2],[2,0]]. Optional. */
  games?: [number, number][];
  forfeit?: boolean;
  /** When the result was reported (ISO time). */
  at?: string;
  /**
   * Who actually played when this result was entered. If the bracket later
   * resolves different players into this match (because an earlier result was
   * edited), the result is flagged as a conflict instead of silently applied.
   */
  p1: EntrantId;
  p2: EntrantId;
}

/** Admin override: force a specific entrant into a match slot. */
export interface SlotOverride {
  p1?: EntrantId | Bye;
  p2?: EntrantId | Bye;
}

/** Settings for generating the bracket. Unused fields are ignored by other formats. */
export interface FormatOptions {
  /** Single elim: play a match for 3rd place. */
  thirdPlaceMatch?: boolean;
  /** Double elim: 'reset' (default) = if the losers-bracket player wins the grand final, play once more. */
  grandFinal?: 'reset' | 'single';
  /** Round robin: everyone plays everyone twice. */
  doubleRound?: boolean;
}

export interface TournamentState {
  structure: Structure;
  options?: FormatOptions;
  /** Entrants ordered by seed: entrants[0] is seed 1. */
  entrants: EntrantId[];
  results: Record<string, MatchResult>;
  overrides?: Record<string, SlotOverride>;
}

/** A participant slot after resolution. null = not decided yet. */
export type Slot = EntrantId | Bye | null;

export type MatchStatus =
  | 'waiting' // at least one participant not decided yet
  | 'ready' // both participants known, no result yet
  | 'done' // result recorded and valid
  | 'bye' // auto-resolved because one or both sides are empty
  | 'skipped' // conditional match that is not needed (e.g. no GF reset)
  | 'conflict'; // result recorded, but the players no longer match it

export interface ResolvedMatch {
  template: MatchTemplate;
  p1: Slot;
  p2: Slot;
  status: MatchStatus;
  result?: MatchResult;
  /** Set when status is done or bye. 'draw' gives no winner/loser. */
  winner: Slot;
  loser: Slot;
}

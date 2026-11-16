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
  | { type: 'empty' } // always a bye
  /** Swiss: filled by the pairing for that round, worked out from the earlier rounds. */
  | { type: 'swiss'; round: number; index: number; slot: 1 | 2 }
  /** Finals: the k-th finalist, once the organizer has confirmed who qualified (`options.finals.qualified`). */
  | { type: 'qualified'; seed: number };

export type BracketSide =
  | 'W' // winners bracket (or the only bracket in single elim)
  | 'L' // losers bracket
  | 'GF' // grand final (double elim)
  | '3P' // third place match
  | 'RR' // round robin
  | 'SW'; // swiss

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

export type Format = 'single_elim' | 'double_elim' | 'round_robin' | 'swiss' | 'groups';

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
  /**
   * A result a player reported with their PIN: 'reported' until the opponent confirms or disputes it.
   * Unset = entered by the organizer (counts as confirmed). The bracket engine ignores it.
   */
  status?: 'reported' | 'confirmed' | 'disputed';
  /** Who reported it (a player id), when a player did. */
  reportedBy?: EntrantId;
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
  /** Swiss: number of rounds. Default: enough to find a clear winner (log2 of the entrant count). */
  swissRounds?: number;
  /**
   * Swiss: the pairings of rounds that have STARTED (at least one result), frozen so that
   * editing an earlier result can't change a round people are already playing.
   * swissPairings[r - 1] = round r as [seed, seed] pairs, 0 = bye; null = not started
   * (paired automatically from the standings). Kept up to date by applyEdit and
   * restructure; never set by hand.
   */
  swissPairings?: (SwissPair[] | null)[];
  /** Groups: how many round-robin groups. Default: about 4 players per group. */
  groupCount?: number;
  /** Swiss, round robin and groups: the best players go on to a knockout final. */
  finals?: FinalsOptions;
  /**
   * Players who dropped out, as entrant seeds (1-based). They keep their results and their place in
   * the standings, but play no more: swiss doesn't pair them in rounds that haven't started, and any
   * match they would still have to play is a walkover (their opponent wins, nothing is stored).
   * The bracket structure doesn't change, so undoing a drop is just removing the seed again.
   * Carried over by player through `restructure`.
   */
  dropped?: number[];
}

/**
 * A knockout final after a points stage (a "top cut"). Its matches have ids starting with `F-`.
 * The finalists are only known once the organizer confirms them (`qualified`), so
 * the structure still only depends on format, entrant count and options.
 */
export interface FinalsOptions {
  format: 'single_elim' | 'double_elim';
  /** How many go through: in total, or from EACH group in the groups format. */
  advance: number;
  thirdPlaceMatch?: boolean;
  grandFinal?: 'reset' | 'single';
  /** Confirmed finalists, as entrant seeds (1-based) in finals seed order. Unset = finals not started. */
  qualified?: number[];
}

/** Two seeds (1-based) paired in a swiss round. A second seed of 0 means a bye. */
export type SwissPair = [number, number];

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
  | 'bye' // auto-resolved: one or both sides are empty, or (a walkover) a player dropped out
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
  /** A 'bye' between two real players because one dropped out (the loser). See `isWalkover`. */
  walkover?: boolean;
}

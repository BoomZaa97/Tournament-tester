import { BYE } from './types';
import type { EntrantId, FormatOptions, MatchResult, Slot, SwissPair, TournamentState, Winner } from './types';
import { resolve } from './resolve';

export type ResultInput = Omit<MatchResult, 'p1' | 'p2'>;

export interface Conflict {
  matchId: string;
  /** Who played when the result was entered. */
  played: { p1: EntrantId; p2: EntrantId };
  /** Who the bracket says should be in the match now. */
  now: { p1: Slot; p2: Slot };
  /** 'keep' is only possible when both new players are real entrants. */
  canKeep: boolean;
}

/**
 * reset: delete the result (the match must be replayed).
 * keep:  keep the score, but credit it to whoever is in the slot now
 *        (useful when the wrong name was entered upstream but the match really happened).
 */
export type Decision = 'reset' | 'keep';
export type Decider = Record<string, Decision> | ((c: Conflict) => Decision);

export interface Change {
  matchId: string;
  before?: MatchResult;
  after?: MatchResult;
}

export interface EditOutcome {
  results: Record<string, MatchResult>;
  /** Every result that changed, as one group (for the change log and undo). */
  changes: Change[];
  /** Every conflict that had to be decided, with what was decided. */
  conflicts: (Conflict & { decision: Decision })[];
  /** Format options to save with the results (swiss: which rounds are now frozen). */
  options: FormatOptions;
}

const isEntrant = (s: Slot): s is EntrantId => s !== null && s !== BYE;

function validate(state: TournamentState, matchId: string, input: ResultInput) {
  if (input.winner === 'draw' && !allowsDraws(state.structure.format)) throw new Error('Draws are not allowed in elimination brackets');
  if (!['p1', 'p2', 'draw'].includes(input.winner)) throw new Error(`Invalid winner: ${input.winner}`);
  if (!state.structure.matches.some((m) => m.id === matchId)) throw new Error(`Unknown match ${matchId}`);
}

/**
 * Set (or clear, with `null`) a match result and repair everything downstream.
 *
 * Unplayed matches downstream just pick up the new players automatically.
 * Matches already played with a player who is no longer there become conflicts,
 * which `decide` settles (default: reset). Because this is a pure function, the
 * UI can call it first as a PREVIEW, show the conflicts, let the admin choose,
 * then call it again with their choices to commit.
 */
export function applyEdit(
  state: TournamentState,
  matchId: string,
  input: ResultInput | null,
  decide: Decider = () => 'reset',
): EditOutcome {
  const results = { ...state.results };
  if (input === null) {
    delete results[matchId];
  } else {
    validate(state, matchId, input);
    const m = resolve(state).get(matchId)!;
    if (!isEntrant(m.p1) || !isEntrant(m.p2)) {
      throw new Error(`Match ${matchId} does not have two players yet`);
    }
    results[matchId] = { ...input, p1: m.p1, p2: m.p2 };
  }
  return settle(state, results, decide);
}

/** Apply several result changes at once (e.g. undo a change group), then repair. */
export function applyBatch(
  state: TournamentState,
  set: Record<string, MatchResult | undefined>,
  decide: Decider = () => 'reset',
): EditOutcome {
  const results = { ...state.results };
  for (const [id, r] of Object.entries(set)) {
    if (r) results[id] = r;
    else delete results[id];
  }
  return settle(state, results, decide);
}

/** Undo a change group: put every touched match back how it was. */
export function undo(state: TournamentState, changes: Change[], decide?: Decider): EditOutcome {
  return applyBatch(state, Object.fromEntries(changes.map((c) => [c.matchId, c.before])), decide);
}

/** Resolve conflicts until the bracket is consistent again. */
function settle(state: TournamentState, results: Record<string, MatchResult>, decide: Decider): EditOutcome {
  const original = state.results;
  const decisions: EditOutcome['conflicts'] = [];
  const pick = (c: Conflict): Decision =>
    !c.canKeep ? 'reset' : typeof decide === 'function' ? decide(c) : (decide[c.matchId] ?? 'reset');

  // Each pass fixes every current conflict; a reset can create new conflicts further
  // down, so loop. Bounded by the number of matches.
  for (let pass = 0; pass <= state.structure.matches.length; pass++) {
    const resolved = resolve({ ...state, results });
    const conflicts = [...resolved.values()].filter((m) => m.status === 'conflict');
    if (conflicts.length === 0) break;

    for (const m of conflicts) {
      const r = results[m.template.id];
      const c: Conflict = {
        matchId: m.template.id,
        played: { p1: r.p1, p2: r.p2 },
        now: { p1: m.p1, p2: m.p2 },
        canKeep: isEntrant(m.p1) && isEntrant(m.p2) && m.status === 'conflict' && !skippedOrPending(resolved, m.template.id),
      };
      const decision = pick(c);
      decisions.push({ ...c, decision });
      if (decision === 'keep') results[c.matchId] = { ...r, p1: m.p1 as EntrantId, p2: m.p2 as EntrantId };
      else delete results[c.matchId];
    }
  }

  const ids = new Set([...Object.keys(original), ...Object.keys(results)]);
  const changes: Change[] = [];
  for (const id of ids) {
    if (!sameResult(original[id], results[id])) changes.push({ matchId: id, before: original[id], after: results[id] });
  }
  return { results, changes, conflicts: decisions, options: lockSwissRounds(state, results) };
}

/** Draws only make sense where points are counted. */
export function allowsDraws(format: TournamentState['structure']['format']): boolean {
  return format === 'round_robin' || format === 'swiss';
}

/**
 * Swiss: freeze the pairing of every round that has a result, and unfreeze rounds
 * that have none (so they re-pair from the current standings). Returns the options
 * to store. Other formats: options unchanged.
 */
export function lockSwissRounds(state: TournamentState, results: Record<string, MatchResult>): FormatOptions {
  const options = { ...state.options };
  if (state.structure.format !== 'swiss') return options;
  const resolved = [...resolve({ ...state, results }).values()];
  const seedOf = (s: Slot) => (s && s !== BYE ? state.entrants.indexOf(s) + 1 : 0);
  const old = state.options?.swissPairings ?? [];
  const rounds = Math.max(0, ...state.structure.matches.map((m) => m.round));
  const next: (SwissPair[] | null)[] = [];
  for (let r = 1; r <= rounds; r++) {
    const ms = resolved.filter((m) => m.template.round === r);
    if (!ms.some((m) => results[m.template.id])) next.push(null);
    else if (old[r - 1]) next.push(old[r - 1]);
    else if (ms.some((m) => m.p1 === null || m.p2 === null)) next.push(null); // not paired yet: nothing to freeze
    else next.push(ms.map((m) => [seedOf(m.p1), seedOf(m.p2)]));
  }
  while (next.length && next[next.length - 1] === null) next.pop();
  if (next.length) options.swissPairings = next;
  else delete options.swissPairings;
  return options;
}

/** A conditional match (GF reset) that is not needed can never "keep" a result. */
function skippedOrPending(resolved: ReturnType<typeof resolve>, id: string): boolean {
  const t = resolved.get(id)!.template;
  if (!t.onlyIf) return false;
  const dep = resolved.get(t.onlyIf.match)!;
  return dep.status !== 'done' || dep.result!.winner !== 'p2';
}

function sameResult(a?: MatchResult, b?: MatchResult): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Replace an entrant everywhere (e.g. a sub takes over for someone who left). */
export function replaceEntrant(state: TournamentState, oldId: EntrantId, newId: EntrantId): TournamentState {
  if (state.entrants.includes(newId)) throw new Error(`${newId} is already in this tournament`);
  const swap = <T extends string>(x: T): T => (x === oldId ? (newId as T) : x);
  const results = Object.fromEntries(
    Object.entries(state.results).map(([id, r]) => [id, { ...r, p1: swap(r.p1), p2: swap(r.p2) }]),
  );
  const overrides = state.overrides
    ? Object.fromEntries(
        Object.entries(state.overrides).map(([id, o]) => [
          id,
          { ...o, ...(o.p1 && { p1: swap(o.p1) }), ...(o.p2 && { p2: swap(o.p2) }) },
        ]),
      )
    : undefined;
  return { ...state, entrants: state.entrants.map(swap), results, overrides };
}

/** Helper for score entry: higher score wins (or lower, for golf-style games). */
export function winnerFromScores(score1: number, score2: number, lowerWins = false): Winner {
  if (score1 === score2) return 'draw';
  return (score1 > score2) !== lowerWins ? 'p1' : 'p2';
}

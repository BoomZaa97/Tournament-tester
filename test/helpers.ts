import { applyEdit, createTournament, playableMatches } from '../src/core';
import type { EditOutcome, ResolvedMatch, TournamentState, Winner } from '../src/core';

/** Save an edit the way the app does: new results + options (swiss freezes rounds in options). */
export function commit(state: TournamentState, out: Pick<EditOutcome, 'results' | 'options'>): TournamentState {
  return { ...createTournament(state.structure.format, state.entrants, out.options), results: out.results };
}

export const names = (n: number) => Array.from({ length: n }, (_, i) => `P${i + 1}`);

/** Small deterministic random number generator so tests are repeatable. */
export function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

/** Play every match until nothing is left, choosing winners with `pick`. */
export function playAll(state: TournamentState, pick: (m: ResolvedMatch) => Winner): TournamentState {
  for (let guard = 0; guard < 10_000; guard++) {
    const ready = playableMatches(state);
    if (ready.length === 0) return state;
    const m = ready[0];
    const winner = pick(m);
    const score = winner === 'draw' ? [1, 1] : winner === 'p1' ? [2, 0] : [0, 2];
    const out = applyEdit(state, m.template.id, { winner, score1: score[0], score2: score[1] });
    state = commit(state, out);
  }
  throw new Error('Tournament never finished');
}

/** Better seed (lower number) always wins. */
export const favourite = (state: TournamentState) => (m: ResolvedMatch): Winner =>
  state.entrants.indexOf(m.p1 as string) < state.entrants.indexOf(m.p2 as string) ? 'p1' : 'p2';

export function set(state: TournamentState, id: string, winner: Winner, decide?: Parameters<typeof applyEdit>[3]) {
  const out = applyEdit(state, id, { winner }, decide);
  return { state: commit(state, out), out };
}

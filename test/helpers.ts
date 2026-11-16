import { applyEdit, playableMatches } from '../src/core';
import type { ResolvedMatch, TournamentState, Winner } from '../src/core';

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
    const out = applyEdit(state, m.template.id, { winner, score1: winner === 'p1' ? 2 : 0, score2: winner === 'p2' ? 2 : 0 });
    state = { ...state, results: out.results };
  }
  throw new Error('Tournament never finished');
}

/** Better seed (lower number) always wins. */
export const favourite = (state: TournamentState) => (m: ResolvedMatch): Winner =>
  state.entrants.indexOf(m.p1 as string) < state.entrants.indexOf(m.p2 as string) ? 'p1' : 'p2';

export function set(state: TournamentState, id: string, winner: Winner, decide?: Parameters<typeof applyEdit>[3]) {
  const out = applyEdit(state, id, { winner }, decide);
  return { state: { ...state, results: out.results }, out };
}

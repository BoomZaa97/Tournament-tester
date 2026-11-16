import { createTournament } from './create';
import { allowsDraws, lockSwissRounds } from './edit';
import { finalsSize } from './formats/finals';
import { droppedEntrants, resolve } from './resolve';
import type { EntrantId, Format, FormatOptions, MatchResult, SwissPair, TournamentState } from './types';

export interface RestructureInput {
  format?: Format;
  /** New entrant list in seed order. Add, remove or reorder (reseed) freely. */
  entrants?: EntrantId[];
  options?: FormatOptions;
}

export interface RestructureOutcome {
  state: TournamentState;
  /** Old results that were carried into the new bracket, by new match id. */
  kept: string[];
  /** Old results that no longer fit anywhere (shown to the admin before confirming). */
  dropped: { matchId: string; result: MatchResult }[];
}

/**
 * Change a running tournament: add a late entrant, remove someone, reseed,
 * switch options or even the format.
 *
 * The bracket is rebuilt from scratch, then every old result is re-applied
 * wherever the SAME two players meet at the same stage (same bracket side and
 * round; in round robin, anywhere). Results that no longer fit are returned
 * in `dropped` so the UI can show them before the admin confirms. Like
 * everything else here this is a pure function, so it doubles as a preview.
 *
 * Swiss: rounds that have started keep their pairings (by player, not seed).
 * A removed player's opponent gets a bye in those rounds; a late entrant sits
 * them out with no points. Rounds not started yet are simply re-paired.
 */
export function restructure(state: TournamentState, input: RestructureInput): RestructureOutcome {
  const format = input.format ?? state.structure.format;
  const entrants = input.entrants ?? state.entrants;
  const options: FormatOptions = { ...state.options, ...input.options };
  delete options.swissPairings; // never taken from input: rebuilt from the current state below
  if (format === 'swiss' && state.structure.format === 'swiss') {
    const pairings = carrySwissPairings(state, entrants);
    if (pairings.length) options.swissPairings = pairings;
  }
  const newSeed = new Map(entrants.map((e, i) => [e, i + 1]));
  // Dropped players stay dropped (by player, not seed; removed ones are forgotten). Never taken from
  // input. Left out while old results are placed (a dropped player's unplayed matches look like
  // walkovers, which would stop their played results from fitting) and added back at the end.
  const dropped = [...droppedEntrants(state)].map((e) => newSeed.get(e) ?? 0).filter((s) => s > 0).sort((a, b) => a - b);
  delete options.dropped;
  if (options.finals?.qualified) {
    // Finalists stay the same people. If one was removed, the organizer picks again.
    const moved = options.finals.qualified.map((s) => newSeed.get(state.entrants[s - 1]) ?? 0);
    const { qualified: _, ...rest } = options.finals;
    options.finals =
      moved.every((s) => s > 0) && moved.length === finalsSize(format, entrants.length, options) ? { ...rest, qualified: moved } : rest;
  }
  let next = createTournament(format, entrants, options);

  const oldResolved = resolve(state);
  const keyOf = (a: string, b: string, side: string, round: number) =>
    [[a, b].sort().join('|'), side, side === 'RR' ? '' : round].join('#');

  // Pool of old results waiting to be placed.
  const pool = new Map<string, { matchId: string; result: MatchResult }[]>();
  for (const m of oldResolved.values()) {
    if (m.status !== 'done') continue;
    const r = m.result!;
    if (r.winner === 'draw' && !allowsDraws(format)) continue; // can't carry into a bracket
    const k = keyOf(r.p1, r.p2, m.template.side, m.template.round);
    pool.set(k, [...(pool.get(k) ?? []), { matchId: m.template.id, result: r }]);
  }

  const results: Record<string, MatchResult> = {};
  const kept: string[] = [];
  // Placing a result can make later matches ready, so repeat until nothing changes.
  for (let changed = true; changed; ) {
    changed = false;
    const resolved = resolve({ ...next, results });
    for (const m of resolved.values()) {
      if (m.status !== 'ready') continue;
      const p1 = m.p1 as EntrantId;
      const p2 = m.p2 as EntrantId;
      const list = pool.get(keyOf(p1, p2, m.template.side, m.template.round));
      if (!list?.length) continue;
      const i = Math.max(0, list.findIndex((x) => x.matchId === m.template.id)); // prefer same match id
      const [{ result: old }] = list.splice(i, 1);
      results[m.template.id] = old.p1 === p1 ? old : flip(old);
      kept.push(m.template.id);
      changed = true;
    }
  }

  if (format === 'swiss') next = createTournament(format, entrants, lockSwissRounds({ ...next, results }, results));
  if (dropped.length) next = { ...next, options: { ...next.options, dropped } };
  return { state: { ...next, results }, kept, dropped: [...pool.values()].flat() };
}

/** Started swiss rounds, re-expressed in the new seed order. */
function carrySwissPairings(state: TournamentState, entrants: EntrantId[]): (SwissPair[] | null)[] {
  const newSeed = new Map(entrants.map((e, i) => [e, i + 1]));
  const seedNow = (oldSeed: number) => (oldSeed ? (newSeed.get(state.entrants[oldSeed - 1]) ?? 0) : 0);
  const out = (state.options?.swissPairings ?? []).map((round) => {
    if (!round) return null;
    const pairs: SwissPair[] = [];
    const byes: SwissPair[] = [];
    for (const [a, b] of round) {
      const [x, y] = [seedNow(a), seedNow(b)];
      if (x && y) pairs.push([x, y]);
      else if (x || y) byes.push([x || y, 0]);
    }
    return pairs.length || byes.length ? [...pairs, ...byes] : null;
  });
  while (out.length && out[out.length - 1] === null) out.pop();
  return out;
}

/** Same result seen from the other side. */
function flip(r: MatchResult): MatchResult {
  return {
    ...r,
    p1: r.p2,
    p2: r.p1,
    winner: r.winner === 'p1' ? 'p2' : r.winner === 'p2' ? 'p1' : 'draw',
    score1: r.score2,
    score2: r.score1,
    games: r.games?.map(([a, b]) => [b, a]),
  };
}

import { createTournament } from './create';
import { resolve } from './resolve';
import type { EntrantId, Format, FormatOptions, MatchResult, TournamentState } from './types';

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
 */
export function restructure(state: TournamentState, input: RestructureInput): RestructureOutcome {
  const format = input.format ?? state.structure.format;
  const entrants = input.entrants ?? state.entrants;
  const options = { ...state.options, ...input.options };
  const next = createTournament(format, entrants, options);

  const oldResolved = resolve(state);
  const keyOf = (a: string, b: string, side: string, round: number) =>
    [[a, b].sort().join('|'), side, format === 'round_robin' ? '' : round].join('#');

  // Pool of old results waiting to be placed.
  const pool = new Map<string, { matchId: string; result: MatchResult }[]>();
  for (const m of oldResolved.values()) {
    if (m.status !== 'done') continue;
    const r = m.result!;
    if (r.winner === 'draw' && format !== 'round_robin') continue; // can't carry into a bracket
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

  const dropped = [...pool.values()].flat();
  return { state: { ...next, results }, kept, dropped };
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

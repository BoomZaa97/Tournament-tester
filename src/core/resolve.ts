import { BYE } from './types';
import type { Bye, EntrantId, ResolvedMatch, Slot, Source, TournamentState } from './types';
import { pairSwiss, swissRecord } from './formats/swiss';

/**
 * Work out who is in every match, from the structure + results.
 * Pure function: same input, same output. Nothing about the bracket is stored
 * except results, so editing any result and calling this again "just works".
 */
export function resolve(state: TournamentState): Map<string, ResolvedMatch> {
  const byId = new Map(state.structure.matches.map((m) => [m.id, m]));
  const out = new Map<string, ResolvedMatch>();
  const visiting = new Set<string>();
  const swissRounds = new Map<number, [EntrantId, EntrantId | Bye][] | null>();

  /** Pairing for a swiss round that hasn't started: needs every earlier round finished. */
  const swissPairing = (round: number) => {
    if (!swissRounds.has(round)) {
      const earlier = state.structure.matches.filter((m) => m.side === 'SW' && m.round < round).map((m) => get(m.id));
      const ready = earlier.every((m) => m.status === 'done' || m.status === 'bye');
      swissRounds.set(round, ready ? pairSwiss(state.entrants, swissRecord(earlier)) : null);
    }
    return swissRounds.get(round)!;
  };

  const slotFrom = (src: Source): Slot => {
    switch (src.type) {
      case 'seed':
        return state.entrants[src.seed - 1] ?? BYE;
      case 'empty':
        return BYE;
      case 'winner':
        return get(src.match).winner;
      case 'loser':
        return get(src.match).loser;
      case 'swiss': {
        const pairing = swissPairing(src.round);
        if (!pairing) return null;
        return pairing[src.index - 1]?.[src.slot - 1] ?? BYE;
      }
      case 'qualified': {
        const qualified = state.options?.finals?.qualified;
        if (!qualified) return null; // finals not started yet
        const seed = qualified[src.seed - 1];
        return (seed && state.entrants[seed - 1]) || BYE;
      }
    }
  };

  function get(id: string): ResolvedMatch {
    const done = out.get(id);
    if (done) return done;
    const template = byId.get(id);
    if (!template) throw new Error(`Unknown match ${id}`);
    if (visiting.has(id)) throw new Error(`Cycle in bracket at ${id}`);
    visiting.add(id);

    const override = state.overrides?.[id];
    const p1 = override?.p1 ?? slotFrom(template.p1);
    const p2 = override?.p2 ?? slotFrom(template.p2);
    const result = state.results[id];
    const rm: ResolvedMatch = { template, p1, p2, result, status: 'waiting', winner: null, loser: null };

    let needed: boolean | null = true; // null = not known yet
    if (template.onlyIf) {
      const dep = get(template.onlyIf.match);
      needed = dep.status === 'done' ? dep.result!.winner === 'p2' : null;
    }

    if (needed === false) {
      rm.status = result ? 'conflict' : 'skipped';
    } else if (p1 === null || p2 === null || needed === null) {
      rm.status = result ? 'conflict' : 'waiting';
    } else if (p1 === BYE || p2 === BYE) {
      if (result) rm.status = 'conflict';
      else {
        rm.status = 'bye';
        rm.winner = p1 === BYE ? p2 : p1;
        rm.loser = BYE;
      }
    } else if (!result) {
      rm.status = 'ready';
    } else if (result.p1 !== p1 || result.p2 !== p2) {
      rm.status = 'conflict';
    } else {
      rm.status = 'done';
      if (result.winner === 'p1') [rm.winner, rm.loser] = [p1, p2];
      else if (result.winner === 'p2') [rm.winner, rm.loser] = [p2, p1];
    }

    visiting.delete(id);
    out.set(id, rm);
    return rm;
  }

  for (const m of state.structure.matches) get(m.id);
  return out;
}

/** Matches that can be played right now. */
export function playableMatches(state: TournamentState): ResolvedMatch[] {
  return [...resolve(state).values()].filter((m) => m.status === 'ready');
}

export function isComplete(state: TournamentState): boolean {
  return [...resolve(state).values()].every((m) => m.status === 'done' || m.status === 'bye' || m.status === 'skipped');
}

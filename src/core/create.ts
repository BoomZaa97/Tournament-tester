import type { EntrantId, Format, FormatOptions, TournamentState } from './types';
import { doubleElimination, singleElimination } from './formats/elimination';
import { roundRobin } from './formats/roundRobin';
import { swiss } from './formats/swiss';
import { groups } from './formats/groups';
import { withFinals } from './formats/finals';

/** Create a new tournament. `entrants` must be in seed order (first = seed 1). */
export function createTournament(format: Format, entrants: EntrantId[], opts: FormatOptions = {}): TournamentState {
  if (new Set(entrants).size !== entrants.length) throw new Error('Duplicate entrant');
  const n = entrants.length;
  const structure =
    format === 'single_elim' ? singleElimination(n, opts)
    : format === 'double_elim' ? doubleElimination(n, opts)
    : format === 'swiss' ? swiss(n, opts)
    : format === 'groups' ? groups(n, opts)
    : roundRobin(n, opts);
  return { structure: withFinals(structure, opts), options: { ...opts }, entrants: [...entrants], results: {} };
}

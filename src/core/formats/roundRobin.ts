import type { MatchTemplate, Structure } from '../types';

export interface RoundRobinOptions {
  /** Everyone plays everyone twice (home and away). */
  doubleRound?: boolean;
}

/**
 * Circle method: fix seed 1, rotate everyone else one step each round.
 * With an odd number of entrants one player sits out each round
 * (we simply don't create that match).
 */
export function roundRobin(n: number, opts: RoundRobinOptions = {}): Structure {
  if (n < 2) throw new Error('Need at least 2 entrants');
  const players: number[] = Array.from({ length: n }, (_, i) => i + 1);
  if (n % 2 === 1) players.push(0); // 0 = sits out
  const m = players.length;
  const legRounds = m - 1;
  const matches: MatchTemplate[] = [];

  const legs = opts.doubleRound ? 2 : 1;
  for (let leg = 0; leg < legs; leg++) {
    const rot = [...players];
    for (let r = 1; r <= legRounds; r++) {
      const round = leg * legRounds + r;
      let index = 0;
      for (let i = 0; i < m / 2; i++) {
        let a = rot[i];
        let b = rot[m - 1 - i];
        if (a === 0 || b === 0) continue;
        // Alternate who is "home" for the fixed player, so it isn't always seed 1.
        if (i === 0 && r % 2 === 0) [a, b] = [b, a];
        if (leg === 1) [a, b] = [b, a];
        index++;
        matches.push({
          id: `RR${round}-${index}`,
          side: 'RR',
          round,
          index,
          p1: { type: 'seed', seed: a },
          p2: { type: 'seed', seed: b },
        });
      }
      // rotate all but the first
      rot.splice(1, 0, rot.pop()!);
    }
  }
  return { format: 'round_robin', entrantCount: n, matches };
}

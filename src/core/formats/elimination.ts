import type { MatchTemplate, Source, Structure } from '../types';

/**
 * Standard bracket seed order, so seed 1 and 2 can only meet in the final.
 * size 4 -> [1,4,2,3], size 8 -> [1,8,4,5,2,7,3,6]
 */
export function bracketOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

export function bracketSize(n: number): number {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

const w = (round: number, index: number) => `W${round}-${index}`;
const l = (round: number, index: number) => `L${round}-${index}`;
const winner = (match: string): Source => ({ type: 'winner', match });
const loser = (match: string): Source => ({ type: 'loser', match });

/** Winners bracket shared by single and double elimination. */
function winnersBracket(n: number, eliminates: boolean): { matches: MatchTemplate[]; rounds: number } {
  const size = bracketSize(n);
  const rounds = Math.log2(size);
  const order = bracketOrder(size);
  const seedSource = (seed: number): Source => (seed <= n ? { type: 'seed', seed } : { type: 'empty' });
  const matches: MatchTemplate[] = [];

  for (let r = 1; r <= rounds; r++) {
    const count = size / 2 ** r;
    for (let i = 1; i <= count; i++) {
      matches.push({
        id: w(r, i),
        side: 'W',
        round: r,
        index: i,
        p1: r === 1 ? seedSource(order[2 * i - 2]) : winner(w(r - 1, 2 * i - 1)),
        p2: r === 1 ? seedSource(order[2 * i - 1]) : winner(w(r - 1, 2 * i)),
        elimLevel: eliminates ? r : undefined,
      });
    }
  }
  return { matches, rounds };
}

export interface SingleElimOptions {
  thirdPlaceMatch?: boolean;
}

export function singleElimination(n: number, opts: SingleElimOptions = {}): Structure {
  if (n < 2) throw new Error('Need at least 2 entrants');
  const { matches, rounds } = winnersBracket(n, true);
  const final = matches[matches.length - 1];
  final.winLevel = rounds + 1;

  if (opts.thirdPlaceMatch && rounds >= 2) {
    // Semi-final losers are no longer out at the semis; they play for 3rd.
    for (const m of matches) if (m.round === rounds - 1) m.elimLevel = undefined;
    matches.push({
      id: '3P-1',
      side: '3P',
      round: 1,
      index: 1,
      p1: loser(w(rounds - 1, 1)),
      p2: loser(w(rounds - 1, 2)),
      elimLevel: rounds - 0.5, // 4th, below 3rd place
      winLevel: rounds - 0.25, // 3rd, below the final loser
    });
  }
  return { format: 'single_elim', entrantCount: n, matches };
}

export interface DoubleElimOptions {
  /** 'reset' (default): if the losers-bracket player wins the grand final, play once more. */
  grandFinal?: 'reset' | 'single';
}

/**
 * Double elimination.
 *
 * Losers bracket for a bracket of size 2^k has 2(k-1) rounds:
 *  - L1: losers of W1 play each other
 *  - L2, L4, ...: "drop" rounds, survivors play the losers coming down from W2, W3, ...
 *  - L3, L5, ...: survivors play each other
 * Drop order is flipped every other round so players don't instantly rematch.
 */
export function doubleElimination(n: number, opts: DoubleElimOptions = {}): Structure {
  if (n < 2) throw new Error('Need at least 2 entrants');
  const { matches, rounds: k } = winnersBracket(n, false);
  const size = 2 ** k;

  let lbFinal: Source = loser(w(1, 1)); // only used when k = 1 (2 entrants)
  if (k >= 2) {
    // L1
    for (let i = 1; i <= size / 4; i++) {
      matches.push({
        id: l(1, i), side: 'L', round: 1, index: i,
        p1: loser(w(1, 2 * i - 1)), p2: loser(w(1, 2 * i)), elimLevel: 1,
      });
    }
    for (let j = 1; j <= k - 1; j++) {
      const dropRound = 2 * j;
      const count = size / 2 ** (j + 1);
      const flip = j % 2 === 1;
      for (let i = 1; i <= count; i++) {
        const from = flip ? count + 1 - i : i;
        matches.push({
          id: l(dropRound, i), side: 'L', round: dropRound, index: i,
          p1: loser(w(j + 1, from)), p2: winner(l(dropRound - 1, i)), elimLevel: dropRound,
        });
      }
      if (j < k - 1) {
        const r = dropRound + 1;
        for (let i = 1; i <= count / 2; i++) {
          matches.push({
            id: l(r, i), side: 'L', round: r, index: i,
            p1: winner(l(dropRound, 2 * i - 1)), p2: winner(l(dropRound, 2 * i)), elimLevel: r,
          });
        }
      }
    }
    lbFinal = winner(l(2 * (k - 1), 1));
  }

  const top = 2 * k; // above every losers-bracket level
  const wbFinal = winner(w(k, 1));
  matches.push({
    id: 'GF-1', side: 'GF', round: 1, index: 1,
    p1: wbFinal, p2: lbFinal, elimLevel: top - 1, winLevel: top,
  });
  if ((opts.grandFinal ?? 'reset') === 'reset') {
    matches.push({
      id: 'GF-2', side: 'GF', round: 2, index: 1,
      p1: wbFinal, p2: lbFinal, elimLevel: top - 1, winLevel: top,
      onlyIf: { type: 'p2Won', match: 'GF-1' },
    });
  }
  return { format: 'double_elim', entrantCount: n, matches };
}

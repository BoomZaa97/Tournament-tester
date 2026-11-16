import { BYE } from '../types';
import type { Bye, EntrantId, FormatOptions, MatchTemplate, ResolvedMatch, Structure } from '../types';

/**
 * Swiss: a fixed number of rounds; each round pairs players on the same score,
 * never twice against the same opponent if it can be avoided.
 *
 * Only rounds that have started are stored (`options.swissPairings`, by seed).
 * Every other round's pairing is worked out by `resolve()` from the results of
 * the rounds before it, so it appears as soon as the previous round is finished
 * and re-pairs itself if an earlier result is edited.
 */

/** Rounds needed for one player to be the only one left unbeaten. */
export function swissDefaultRounds(n: number): number {
  return Math.max(1, Math.ceil(Math.log2(Math.max(2, n))));
}

/** Most rounds possible without a rematch. */
export function swissMaxRounds(n: number): number {
  return Math.max(1, n % 2 === 0 ? n - 1 : n);
}

export function swissRoundCount(n: number, opts: FormatOptions = {}): number {
  const want = Math.round(opts.swissRounds ?? swissDefaultRounds(n));
  return Math.min(Math.max(1, want), swissMaxRounds(n));
}

export function swiss(n: number, opts: FormatOptions = {}): Structure {
  if (n < 2) throw new Error('Need at least 2 entrants');
  const rounds = swissRoundCount(n, opts);
  const matches: MatchTemplate[] = [];
  for (let round = 1; round <= rounds; round++) {
    const frozen = opts.swissPairings?.[round - 1];
    if (frozen) {
      frozen.forEach(([a, b], i) =>
        matches.push({
          id: `S${round}-${i + 1}`,
          side: 'SW',
          round,
          index: i + 1,
          p1: a ? { type: 'seed', seed: a } : { type: 'empty' },
          p2: b ? { type: 'seed', seed: b } : { type: 'empty' },
        }),
      );
      continue;
    }
    // Not started: one slot per pair, plus a bye slot (always last) when the count is odd.
    const count = Math.ceil(n / 2);
    for (let index = 1; index <= count; index++) {
      const byeSlot = n % 2 === 1 && index === count;
      matches.push({
        id: `S${round}-${index}`,
        side: 'SW',
        round,
        index,
        p1: { type: 'swiss', round, index, slot: 1 },
        p2: byeSlot ? { type: 'empty' } : { type: 'swiss', round, index, slot: 2 },
      });
    }
  }
  return { format: 'swiss', entrantCount: n, matches };
}

export interface SwissRecord {
  /** Match points: win or bye = 1, draw = 0.5. Used for pairing only. */
  score: Map<EntrantId, number>;
  /** Pairs that already played, as "a|b" (sorted). */
  met: Set<string>;
  byes: Map<EntrantId, number>;
}

const pairKey = (a: EntrantId, b: EntrantId) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Scores and past opponents from finished swiss matches. */
export function swissRecord(matches: Iterable<ResolvedMatch>): SwissRecord {
  const score = new Map<EntrantId, number>();
  const met = new Set<string>();
  const byes = new Map<EntrantId, number>();
  const add = (e: EntrantId, x: number) => score.set(e, (score.get(e) ?? 0) + x);
  for (const m of matches) {
    if (m.walkover && m.winner && m.winner !== BYE) {
      add(m.winner, 1); // opponent dropped out: a win, but not a bye (and they didn't meet)
    } else if (m.status === 'bye' && m.winner && m.winner !== BYE) {
      add(m.winner, 1);
      byes.set(m.winner, (byes.get(m.winner) ?? 0) + 1);
    } else if (m.status === 'done' && m.result) {
      const { p1, p2, winner } = m.result;
      met.add(pairKey(p1, p2));
      if (winner === 'draw') {
        add(p1, 0.5);
        add(p2, 0.5);
      } else add(winner === 'p1' ? p1 : p2, 1);
    }
  }
  return { score, met, byes };
}

const SEARCH_BUDGET = 20_000;
const cache = new Map<string, [EntrantId, EntrantId | Bye][]>();

/**
 * Pair one round. `entrants` in seed order. Returns pairs with the higher-ranked
 * player first, and the bye (if any) last.
 *
 * Players are ranked by score, then seed. Going down the ranking, each player is
 * paired with someone in the same score group (top half against bottom half, as
 * in chess swiss), else the closest lower score. A backtracking search avoids
 * rematches; the bye goes to the lowest-ranked player who has had the fewest byes.
 * Only if no rematch-free pairing exists are rematches allowed.
 */
export function pairSwiss(entrants: EntrantId[], rec: SwissRecord): [EntrantId, EntrantId | Bye][] {
  const sc = (e: EntrantId) => rec.score.get(e) ?? 0;
  const ranked = [...entrants].sort((a, b) => sc(b) - sc(a)); // stable: seed order within a score
  const cacheKey = JSON.stringify([ranked.map((e) => [e, sc(e), rec.byes.get(e) ?? 0]), [...rec.met].sort()]);
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  const candidates = (p: EntrantId, rest: EntrantId[]): EntrantId[] => {
    const same = rest.filter((x) => sc(x) === sc(p));
    const group = [p, ...same];
    const h = Math.max(1, Math.floor(group.length / 2));
    return [...group.slice(h), ...group.slice(1, h).reverse(), ...rest.filter((x) => sc(x) !== sc(p))];
  };

  let out: [EntrantId, EntrantId | Bye][] | null = null;
  for (const allowRematch of [false, true]) {
    let budget = SEARCH_BUDGET;
    const search = (rem: EntrantId[]): [EntrantId, EntrantId][] | null => {
      if (rem.length === 0) return [];
      if (--budget < 0) return null;
      const [p, ...rest] = rem;
      let order = candidates(p, rest);
      if (allowRematch) order = [...order.filter((c) => !rec.met.has(pairKey(p, c))), ...order.filter((c) => rec.met.has(pairKey(p, c)))];
      for (const c of order) {
        if (!allowRematch && rec.met.has(pairKey(p, c))) continue;
        const sub = search(rest.filter((x) => x !== c));
        if (sub) return [[p, c], ...sub];
        if (budget < 0) return null;
      }
      return null;
    };

    const byeOrder: (EntrantId | null)[] =
      ranked.length % 2 === 1
        ? [...ranked].reverse().sort((a, b) => (rec.byes.get(a) ?? 0) - (rec.byes.get(b) ?? 0))
        : [null];
    for (const bye of byeOrder) {
      const pairs = search(bye ? ranked.filter((x) => x !== bye) : ranked);
      if (pairs) {
        out = bye ? [...pairs, [bye, BYE]] : pairs;
        break;
      }
      if (budget < 0) break;
    }
    if (out) break;
  }
  if (!out) throw new Error('Swiss pairing failed'); // unreachable: rematches allowed always pairs

  if (cache.size > 200) cache.clear();
  cache.set(cacheKey, out);
  return out;
}

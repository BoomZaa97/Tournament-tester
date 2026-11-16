import { describe, expect, it } from 'vitest';
import {
  BYE, applyEdit, bracketOrder, winnerFromScores, createTournament, eliminationPlacements, isComplete, resolve, roundRobinStandings,
} from '../src/core';
import type { EntrantId, TournamentState } from '../src/core';
import { favourite, names, playAll, rng, set } from './helpers';

describe('seeding', () => {
  it('puts top seeds as far apart as possible', () => {
    expect(bracketOrder(4)).toEqual([1, 4, 2, 3]);
    expect(bracketOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });
});

describe('single elimination', () => {
  it('builds the right number of matches', () => {
    expect(createTournament('single_elim', names(8)).structure.matches).toHaveLength(7);
    expect(createTournament('single_elim', names(8), { thirdPlaceMatch: true }).structure.matches).toHaveLength(8);
  });

  it('gives byes to top seeds and advances them automatically', () => {
    const t = createTournament('single_elim', names(6));
    const r = resolve(t);
    expect(r.get('W1-1')!.status).toBe('bye');
    expect(r.get('W1-1')!.winner).toBe('P1');
    expect(r.get('W1-3')!.winner).toBe('P2');
    expect(r.get('W2-1')!.p1).toBe('P1');
  });

  it('favourites win -> seeds finish in order', () => {
    let t = createTournament('single_elim', names(8), { thirdPlaceMatch: true });
    t = playAll(t, favourite(t));
    expect(isComplete(t)).toBe(true);
    const p = Object.fromEntries(eliminationPlacements(t).map((x) => [x.entrant, x.place]));
    expect(p).toMatchObject({ P1: 1, P2: 2, P3: 3, P4: 4, P5: 5, P8: 5 });
  });

  it('without a 3rd place match both semi losers are 3rd', () => {
    let t = createTournament('single_elim', names(4));
    t = playAll(t, favourite(t));
    const p = Object.fromEntries(eliminationPlacements(t).map((x) => [x.entrant, x.place]));
    expect(p).toEqual({ P1: 1, P2: 2, P3: 3, P4: 3 });
  });
});

describe('double elimination', () => {
  it('8 players: 7 winners + 6 losers + 2 grand final matches', () => {
    const s = createTournament('double_elim', names(8)).structure.matches;
    expect(s.filter((m) => m.side === 'W')).toHaveLength(7);
    expect(s.filter((m) => m.side === 'L')).toHaveLength(6);
    expect(s.filter((m) => m.side === 'GF')).toHaveLength(2);
  });

  it('skips the grand final reset when the winners-bracket player wins', () => {
    let t = createTournament('double_elim', names(8));
    t = playAll(t, favourite(t));
    const r = resolve(t);
    expect(r.get('GF-1')!.winner).toBe('P1');
    expect(r.get('GF-2')!.status).toBe('skipped');
    expect(isComplete(t)).toBe(true);
    const p = Object.fromEntries(eliminationPlacements(t).map((x) => [x.entrant, x.place]));
    expect(p).toMatchObject({ P1: 1, P2: 2, P3: 3, P4: 4 });
  });

  it('plays the reset when the losers-bracket player wins GF-1', () => {
    let t = createTournament('double_elim', names(4));
    t = playAll(t, (m) => (m.template.id === 'GF-1' ? 'p2' : favourite(t)(m)));
    const r = resolve(t);
    expect(r.get('GF-2')!.status).toBe('done');
    expect(isComplete(t)).toBe(true);
    // P1 won GF-2 (favourite), so P1 is still champion
    expect(eliminationPlacements(t)[0]).toEqual({ entrant: 'P1', place: 1 });
  });

  it('GF-1 alone does not crown anyone while the reset is pending', () => {
    let t = createTournament('double_elim', names(4));
    for (const id of ['W1-1', 'W1-2', 'W2-1', 'L1-1', 'L2-1']) t = set(t, id, 'p1').state;
    t = set(t, 'GF-1', 'p2').state;
    expect(resolve(t).get('GF-2')!.status).toBe('ready');
    const placed = eliminationPlacements(t).filter((p) => p.place !== null).map((p) => p.entrant);
    expect(placed.sort()).toEqual(['P3', 'P4']);
  });
});

describe('round robin', () => {
  it.each([2, 3, 4, 5, 8, 9])('%i players: everyone plays everyone exactly once', (n) => {
    const t = createTournament('round_robin', names(n));
    const pairs = t.structure.matches.map((m) => [m.p1, m.p2].map((s) => (s as { seed: number }).seed).sort().join('-'));
    expect(pairs).toHaveLength((n * (n - 1)) / 2);
    expect(new Set(pairs).size).toBe(pairs.length);
    // nobody plays twice in the same round
    const rounds = new Map<number, number[]>();
    for (const m of t.structure.matches) {
      const seeds = [m.p1, m.p2].map((s) => (s as { seed: number }).seed);
      rounds.set(m.round, [...(rounds.get(m.round) ?? []), ...seeds]);
    }
    for (const s of rounds.values()) expect(new Set(s).size).toBe(s.length);
  });

  it('double round robin plays each pair twice', () => {
    expect(createTournament('round_robin', names(4), { doubleRound: true }).structure.matches).toHaveLength(12);
  });

  it('standings with points, draws and head-to-head tiebreak', () => {
    let t = createTournament('round_robin', ['A', 'B', 'C']);
    const find = (a: string, b: string) => {
      const m = [...resolve(t).values()].find((x) => new Set([x.p1, x.p2]).size === 2 && [x.p1, x.p2].includes(a) && [x.p1, x.p2].includes(b))!;
      return { id: m.template.id, aIsP1: m.p1 === a };
    };
    // A beats B, B beats C, C beats A -> all on 3 pts; h2h also tied; diff decides.
    const play = (a: string, b: string, sa: number, sb: number) => {
      const { id, aIsP1 } = find(a, b);
      const [s1, s2] = aIsP1 ? [sa, sb] : [sb, sa];
      t = { ...t, results: applyEditScores(t, id, s1, s2) };
    };
    play('A', 'B', 5, 0);
    play('B', 'C', 1, 0);
    play('C', 'A', 1, 0);
    const rows = roundRobinStandings(t);
    // diffs: A +4, B -4, C 0
    expect(rows.map((r) => r.entrant)).toEqual(['A', 'C', 'B']);
    expect(rows.map((r) => r.points)).toEqual([3, 3, 3]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('draws are allowed in round robin, not in brackets', () => {
    const rr = createTournament('round_robin', names(2));
    expect(() => set(rr, 'RR1-1', 'draw')).not.toThrow();
    const se = createTournament('single_elim', names(2));
    expect(() => set(se, 'W1-1', 'draw')).toThrow(/Draws/);
  });
});

function applyEditScores(t: TournamentState, id: string, s1: number, s2: number) {
  return applyEdit(t, id, { winner: winnerFromScores(s1, s2), score1: s1, score2: s2 }).results;
}

describe('random full runs (every size 2..40)', () => {
  for (const format of ['single_elim', 'double_elim'] as const) {
    it(`${format}: always finishes with one champion and sensible placements`, () => {
      for (let n = 2; n <= 40; n++) {
        for (let seed = 1; seed <= 5; seed++) {
          const rand = rng(n * 100 + seed);
          let t = createTournament(format, names(n), { thirdPlaceMatch: seed % 2 === 0 });
          t = playAll(t, () => (rand() < 0.5 ? 'p1' : 'p2'));
          expect(isComplete(t), `${format} n=${n}`).toBe(true);

          const placements = eliminationPlacements(t);
          expect(placements.every((p) => p.place !== null), `${format} n=${n}`).toBe(true);
          expect(placements.filter((p) => p.place === 1)).toHaveLength(1);

          // losses per entrant: 1 max in single elim, 2 max in double elim
          const losses = new Map<EntrantId, number>();
          for (const m of resolve(t).values()) {
            if (m.status === 'done' && m.loser && m.loser !== BYE && m.template.side !== '3P') {
              losses.set(m.loser, (losses.get(m.loser) ?? 0) + 1);
            }
          }
          const max = format === 'single_elim' ? 1 : 2;
          for (const [e, c] of losses) expect(c, `${e} in ${format} n=${n}`).toBeLessThanOrEqual(max);
          // everyone but the champion lost at least once (ignoring 3rd place match)
          expect(losses.size).toBeGreaterThanOrEqual(n - 1 - (seed % 2 === 0 && n >= 4 ? 1 : 0));
        }
      }
    });
  }
});

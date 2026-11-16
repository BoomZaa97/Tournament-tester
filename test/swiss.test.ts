import { describe, expect, it } from 'vitest';
import {
  BYE, applyEdit, createTournament, isComplete, resolve, restructure, swissStandings, undo,
} from '../src/core';
import type { EntrantId, ResolvedMatch, TournamentState } from '../src/core';
import { commit, favourite, names, playAll, rng, set } from './helpers';

const round = (t: TournamentState, r: number) =>
  [...resolve(t).values()].filter((m) => m.template.side === 'SW' && m.template.round === r);
const pairs = (t: TournamentState, r: number) =>
  round(t, r).map((m) => (m.p2 === BYE ? `${m.p1}-bye` : `${m.p1}-${m.p2}`));

/** Play one whole round with `pick`. */
function playRound(t: TournamentState, r: number, pick: (m: ResolvedMatch) => 'p1' | 'p2' | 'draw') {
  for (const m of round(t, r)) {
    if (m.status !== 'ready') continue;
    t = commit(t, applyEdit(t, m.template.id, { winner: pick(m) }));
  }
  return t;
}

describe('swiss', () => {
  it('builds log2(n) rounds by default, with a bye slot when the count is odd', () => {
    const t8 = createTournament('swiss', names(8));
    expect(t8.structure.matches).toHaveLength(3 * 4);
    const t7 = createTournament('swiss', names(7));
    expect(t7.structure.matches).toHaveLength(3 * 4);
    expect(createTournament('swiss', names(8), { swissRounds: 5 }).structure.matches).toHaveLength(5 * 4);
    // never more rounds than there are opponents
    expect(createTournament('swiss', names(4), { swissRounds: 9 }).structure.matches).toHaveLength(3 * 2);
  });

  it('round 1 is top half vs bottom half; round 2 waits for round 1', () => {
    const t = createTournament('swiss', names(8));
    expect(pairs(t, 1)).toEqual(['P1-P5', 'P2-P6', 'P3-P7', 'P4-P8']);
    expect(round(t, 2).every((m) => m.status === 'waiting')).toBe(true);
  });

  it('pairs players on the same score', () => {
    let t = createTournament('swiss', names(8));
    t = playRound(t, 1, favourite(t));
    // winners P1-P4 on 1 point, losers P5-P8 on 0
    expect(pairs(t, 2)).toEqual(['P1-P3', 'P2-P4', 'P5-P7', 'P6-P8']);
  });

  it('gives the bye to the lowest-ranked player, never twice, and counts it as a win', () => {
    let t = createTournament('swiss', names(5));
    expect(pairs(t, 1)).toEqual(['P1-P3', 'P2-P4', 'P5-bye']);
    t = playAll(t, favourite(t));
    const byes = [1, 2, 3].map((r) => round(t, r).find((m) => m.p2 === BYE)!.p1);
    expect(new Set(byes).size).toBe(3);
    const p5 = swissStandings(t).find((r) => r.entrant === 'P5')!;
    expect(p5.byes).toBe(1);
    expect(p5.wins).toBeGreaterThanOrEqual(1);
  });

  it('allows draws', () => {
    const t = createTournament('swiss', names(4));
    expect(() => set(t, 'S1-1', 'draw')).not.toThrow();
  });

  it('with 4 players and 3 rounds everyone meets everyone once', () => {
    let t = createTournament('swiss', names(4), { swissRounds: 3 });
    t = playAll(t, favourite(t));
    const met = [1, 2, 3].flatMap((r) => round(t, r).map((m) => [m.p1, m.p2].sort().join('|')));
    expect(new Set(met).size).toBe(6);
  });

  it('ranks by points, then Buchholz (strength of opponents)', () => {
    let t = createTournament('swiss', names(8));
    t = playAll(t, favourite(t));
    const rows = swissStandings(t);
    expect(rows[0].entrant).toBe('P1');
    expect(rows[0].wins).toBe(3);
    // every row's points/buchholz order is non-increasing
    for (let i = 1; i < rows.length; i++) {
      const [a, b] = [rows[i - 1], rows[i]];
      expect(a.points > b.points || (a.points === b.points && a.buchholz >= b.buchholz)).toBe(true);
    }
  });

  describe('editing', () => {
    it('freezes a round once it has a result', () => {
      let t = createTournament('swiss', names(8));
      expect(t.options?.swissPairings).toBeUndefined();
      t = set(t, 'S1-1', 'p1').state;
      expect(t.options?.swissPairings).toEqual([[[1, 5], [2, 6], [3, 7], [4, 8]]]);
    });

    it('editing a past round re-pairs the next round if it has not started', () => {
      let t = createTournament('swiss', names(8));
      t = playRound(t, 1, favourite(t));
      expect(pairs(t, 2)).toEqual(['P1-P3', 'P2-P4', 'P5-P7', 'P6-P8']);
      t = set(t, 'S1-1', 'p2').state; // P5 actually beat P1
      expect(pairs(t, 2)).toEqual(['P2-P4', 'P3-P5', 'P1-P7', 'P6-P8']);
    });

    it('editing a past round does not touch a round that has started', () => {
      let t = createTournament('swiss', names(8));
      t = playRound(t, 1, favourite(t));
      t = set(t, 'S2-1', 'p1').state; // round 2 has started
      const before = pairs(t, 2);
      const { state, out } = set(t, 'S1-1', 'p2');
      expect(out.conflicts).toEqual([]);
      expect(pairs(state, 2)).toEqual(before);
      expect(state.results['S2-1']).toEqual(t.results['S2-1']);
    });

    it('a later round still re-pairs from the corrected standings', () => {
      let t = createTournament('swiss', names(8));
      t = playRound(t, 1, favourite(t));
      t = playRound(t, 2, favourite(t));
      const r3 = pairs(t, 3);
      t = set(t, 'S1-1', 'p2').state; // P5 beat P1 after all: P1 and P5 swap scores
      expect(pairs(t, 3)).not.toEqual(r3);
      // P2 and P5 are now the only players on 2 wins
      expect(pairs(t, 3)).toEqual(['P2-P5', 'P1-P4', 'P3-P6', 'P7-P8']);
    });

    it('undoing the only result of a round unfreezes it', () => {
      let t = createTournament('swiss', names(8));
      t = playRound(t, 1, favourite(t));
      const { state, out } = set(t, 'S2-1', 'p1');
      expect(state.options?.swissPairings).toHaveLength(2);
      const back = commit(state, undo(state, out.changes));
      expect(back.options?.swissPairings).toHaveLength(1);
    });

    it('clearing a round 1 result makes the next round wait again', () => {
      let t = createTournament('swiss', names(8));
      t = playRound(t, 1, favourite(t));
      t = commit(t, applyEdit(t, 'S1-2', null));
      expect(round(t, 2).every((m) => m.status === 'waiting')).toBe(true);
    });
  });

  describe('changing the tournament', () => {
    const started = () => {
      let t = createTournament('swiss', names(6));
      t = playRound(t, 1, favourite(t));
      return set(t, 'S2-1', 'p1').state; // round 2 started
    };

    it('reseeding keeps the started rounds and their results', () => {
      const t = started();
      const reversed = [...t.entrants].reverse();
      const out = restructure(t, { entrants: reversed });
      expect(out.dropped).toEqual([]);
      expect(out.kept.sort()).toEqual(Object.keys(t.results).sort());
      expect(pairs(out.state, 1)).toEqual(pairs(t, 1));
      expect(pairs(out.state, 2)).toEqual(pairs(t, 2));
    });

    it('a late entrant sits out started rounds and joins the next one', () => {
      let t = started();
      const out = restructure(t, { entrants: [...t.entrants, 'Late'] });
      expect(out.dropped).toEqual([]);
      t = out.state;
      expect(pairs(t, 1).join()).not.toContain('Late');
      t = playRound(t, 2, favourite(t));
      expect(pairs(t, 3).join()).toContain('Late');
    });

    it("removing a player gives their opponent a bye in started rounds", () => {
      const t = started();
      const p1Opp = round(t, 1).find((m) => m.p1 === 'P6' || m.p2 === 'P6')!;
      const opp = p1Opp.p1 === 'P6' ? p1Opp.p2 : p1Opp.p1;
      const out = restructure(t, { entrants: t.entrants.filter((e) => e !== 'P6') });
      expect(out.dropped.map((d) => d.matchId)).toEqual([p1Opp.template.id]);
      expect(pairs(out.state, 1)).toContain(`${opp}-bye`);
    });

    it('switching to swiss from round robin keeps nothing it cannot place', () => {
      let t = createTournament('round_robin', names(4));
      t = playAll(t, favourite(t));
      const out = restructure(t, { format: 'swiss' });
      expect(out.state.structure.format).toBe('swiss');
      expect(out.kept).toEqual([]);
    });
  });

  it('random full runs, every size 2..40: always finishes, no rematches, one game per round', () => {
    for (let n = 2; n <= 40; n++) {
      for (let seed = 1; seed <= 3; seed++) {
        const rand = rng(n * 100 + seed);
        let t = createTournament('swiss', names(n));
        t = playAll(t, () => {
          const x = rand();
          return x < 0.1 ? 'draw' : x < 0.55 ? 'p1' : 'p2';
        });
        expect(isComplete(t), `n=${n}`).toBe(true);

        const rounds = Math.max(...t.structure.matches.map((m) => m.round));
        const met = new Set<string>();
        const byes = new Map<EntrantId, number>();
        for (let r = 1; r <= rounds; r++) {
          const seen: EntrantId[] = [];
          for (const m of round(t, r)) {
            if (m.p2 === BYE) {
              seen.push(m.p1 as string);
              byes.set(m.p1 as string, (byes.get(m.p1 as string) ?? 0) + 1);
              continue;
            }
            expect(m.status, `n=${n} ${m.template.id}`).toBe('done');
            const key = [m.p1, m.p2].sort().join('|');
            expect(met.has(key), `rematch ${key} n=${n}`).toBe(false);
            met.add(key);
            seen.push(m.p1 as string, m.p2 as string);
          }
          expect(seen.sort(), `n=${n} round ${r}`).toEqual([...t.entrants].sort());
        }
        for (const [e, c] of byes) expect(c, `${e} byes n=${n}`).toBe(1);
        expect(swissStandings(t)).toHaveLength(n);
      }
    }
  });
});

describe('swiss with player reports (shared mode)', () => {
  it('a round a player reported into is frozen when the tournament loads', async () => {
    const { toState } = await import('../src/app/lib/model');
    // round 1 played and frozen; a player then reports a round 2 match straight to the sheet,
    // which can't freeze round 2 itself
    let t = createTournament('swiss', names(8));
    t = playRound(t, 1, favourite(t));
    const m = round(t, 2)[0];
    const reported = { ...t.results, [m.template.id]: { winner: 'p1' as const, p1: m.p1 as string, p2: m.p2 as string } };
    const doc = { format: 'swiss' as const, entrants: t.entrants.map((id) => ({ id, name: id })), options: t.options ?? {}, results: reported };
    expect(doc.options.swissPairings).toHaveLength(1);

    const loaded = toState(doc);
    expect(loaded.options?.swissPairings).toHaveLength(2);
    const before = pairs(loaded, 2);
    // the organizer now corrects round 1: round 2 must not be re-paired under the reported result
    const { state, out } = set(loaded, 'S1-1', 'p2');
    expect(out.conflicts).toEqual([]);
    expect(pairs(state, 2)).toEqual(before);
  });
});

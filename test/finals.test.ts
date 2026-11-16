import { describe, expect, it } from 'vitest';
import {
  BYE, applyEdit, createTournament, finalsSize, groupMembers, groupStandings, isComplete, isFinalsMatch, lockSwissRounds,
  overallPlacements, resolve, restructure, roundRobinStandings, suggestFinalists,
} from '../src/core';
import type { Format, FormatOptions, ResolvedMatch, TournamentState } from '../src/core';
import { commit, favourite, names, playAll, rng } from './helpers';

const points = (t: TournamentState) => [...resolve(t).values()].filter((m) => !isFinalsMatch(m.template));
const finals = (t: TournamentState) => [...resolve(t).values()].filter((m) => isFinalsMatch(m.template));

/** What the organizer does: accept the suggested finalists. */
function startFinals(t: TournamentState, finalists = suggestFinalists(t).finalists): TournamentState {
  const options: FormatOptions = { ...t.options, finals: { ...t.options!.finals!, qualified: finalists.map((e) => t.entrants.indexOf(e) + 1) } };
  return { ...createTournament(t.structure.format, t.entrants, options), results: t.results };
}

/** Play only the points stage. */
function playPoints(t: TournamentState, pick: (m: ResolvedMatch) => 'p1' | 'p2' | 'draw') {
  for (let guard = 0; guard < 5000; guard++) {
    const m = points(t).find((x) => x.status === 'ready');
    if (!m) return t;
    t = commit(t, applyEdit(t, m.template.id, { winner: pick(m) }));
  }
  throw new Error('never finished');
}

describe('groups', () => {
  it('deals seeds out snaking across the groups', () => {
    expect(Object.fromEntries(groupMembers(8, { groupCount: 2 }))).toEqual({ A: [1, 4, 5, 8], B: [2, 3, 6, 7] });
    expect(Object.fromEntries(groupMembers(10, { groupCount: 3 }))).toEqual({ A: [1, 6, 7], B: [2, 5, 8], C: [3, 4, 9, 10] });
  });

  it('defaults to groups of about 4, never a group of 1', () => {
    expect(groupMembers(16).size).toBe(4);
    expect(groupMembers(3, { groupCount: 5 }).size).toBe(1);
    for (let n = 2; n <= 40; n++) for (const g of groupMembers(n, { groupCount: 7 }).values()) expect(g.length).toBeGreaterThanOrEqual(2);
  });

  it('everyone plays everyone in their group once, and nobody outside it', () => {
    for (let n = 2; n <= 40; n++) {
      const t = createTournament('groups', names(n));
      const groupOf = new Map<string, string>();
      for (const [label, seeds] of groupMembers(n)) for (const s of seeds) groupOf.set(`P${s}`, label);
      const met = new Set<string>();
      for (const m of resolve(t).values()) {
        const [a, b] = [m.p1 as string, m.p2 as string];
        expect(groupOf.get(a)).toBe(m.template.group);
        expect(groupOf.get(b)).toBe(m.template.group);
        const key = [a, b].sort().join('|');
        expect(met.has(key)).toBe(false);
        met.add(key);
      }
      let expected = 0;
      for (const g of groupMembers(n).values()) expected += (g.length * (g.length - 1)) / 2;
      expect(met.size).toBe(expected);
    }
  });

  it('has a table per group, and draws are allowed', () => {
    let t = createTournament('groups', names(8), { groupCount: 2 });
    t = playPoints(t, (m) => (m.template.round === 1 ? 'draw' : favourite(t)(m)));
    const tables = groupStandings(t);
    expect([...tables.keys()]).toEqual(['A', 'B']);
    expect(tables.get('A')!.map((r) => r.entrant)).toHaveLength(4);
    expect(tables.get('A')!.some((r) => r.draws > 0)).toBe(true);
  });
});

describe('finals', () => {
  const opts = (advance: number, format: 'single_elim' | 'double_elim' = 'single_elim'): FormatOptions => ({ finals: { format, advance } });

  it('adds a knockout bracket of the right size after the points stage', () => {
    expect(finalsSize('swiss', 16, opts(8))).toBe(8);
    expect(finalsSize('swiss', 6, opts(8))).toBe(6); // never more than the field
    expect(finalsSize('round_robin', 6, opts(1))).toBe(2); // a final needs two
    expect(finalsSize('groups', 16, { groupCount: 4, ...opts(2) })).toBe(8); // 2 per group
    expect(finalsSize('single_elim', 16, opts(8))).toBe(0); // brackets have no finals
    const t = createTournament('swiss', names(16), opts(8));
    expect(finals(t)).toHaveLength(7);
    expect(finals(t).every((m) => m.status === 'waiting')).toBe(true);
  });

  it('waits for the organizer, then fills the bracket from the confirmed finalists', () => {
    let t = createTournament('round_robin', names(6), opts(4));
    t = playPoints(t, favourite(t));
    expect(finals(t).every((m) => m.p1 === null)).toBe(true);
    expect(isComplete(t)).toBe(false);
    const s = suggestFinalists(t);
    expect(s.finalists).toEqual(['P1', 'P2', 'P3', 'P4']);
    expect(s.tieAtCut).toBe(false);
    t = startFinals(t);
    const semis = finals(t).filter((m) => m.template.round === 1).map((m) => `${m.p1}-${m.p2}`);
    expect(semis).toEqual(['P1-P4', 'P2-P3']);
  });

  it('groups: top N of each group, crossed so group winners meet late', () => {
    let t = createTournament('groups', names(8), { groupCount: 2, ...opts(2) });
    t = playPoints(t, favourite(t));
    // A = P1 P4 P5 P8, B = P2 P3 P6 P7
    expect(suggestFinalists(t).finalists).toEqual(['P1', 'P2', 'P4', 'P3']);
    t = startFinals(t);
    expect(finals(t).filter((m) => m.template.round === 1).map((m) => `${m.p1}-${m.p2}`)).toEqual(['P1-P3', 'P2-P4']);
  });

  it('warns when the cut line splits a tie', () => {
    let t = createTournament('round_robin', names(4), opts(2));
    t = playPoints(t, () => 'draw');
    expect(suggestFinalists(t).tieAtCut).toBe(true);
  });

  it('finals have no draws; the points stage may', () => {
    let t = createTournament('swiss', names(4), opts(2));
    t = playPoints(t, favourite(t));
    t = startFinals(t);
    const final = finals(t).find((m) => m.status === 'ready')!;
    expect(() => applyEdit(t, final.template.id, { winner: 'draw' })).toThrow(/Draws/);
  });

  it('points tables never count finals matches', () => {
    let t = createTournament('round_robin', names(4), opts(2));
    t = playPoints(t, favourite(t));
    const before = roundRobinStandings(t);
    t = startFinals(t);
    t = playAll(t, (m) => (m.p1 === 'P2' ? 'p1' : 'p2')); // P2 wins the final
    expect(roundRobinStandings(t)).toEqual(before);
    expect(overallPlacements(t).slice(0, 2)).toEqual([
      { entrant: 'P2', place: 1 },
      { entrant: 'P1', place: 2 },
    ]);
    expect(overallPlacements(t).slice(2).map((p) => p.place)).toEqual([3, 4]);
  });

  it('swiss rounds are frozen as usual and finals rounds are not mistaken for swiss rounds', () => {
    let t = createTournament('swiss', names(8), opts(4));
    t = playPoints(t, favourite(t));
    t = startFinals(t);
    const pairings = t.options!.swissPairings!;
    expect(pairings).toHaveLength(3);
    const ready = finals(t).find((m) => m.status === 'ready')!;
    const out = applyEdit(t, ready.template.id, { winner: 'p1' });
    expect(out.options.swissPairings).toEqual(pairings);
    expect(lockSwissRounds(t, t.results).finals!.qualified).toEqual(t.options!.finals!.qualified);
  });

  it('editing the points stage after the finals started does not change the finalists', () => {
    let t = createTournament('round_robin', names(4), opts(2));
    t = playPoints(t, favourite(t));
    t = startFinals(t);
    const before = finals(t).map((m) => [m.p1, m.p2]);
    const m = points(t).find((x) => x.p1 === 'P1' && x.p2 === 'P2') ?? points(t).find((x) => x.p1 === 'P2' && x.p2 === 'P1')!;
    t = commit(t, applyEdit(t, m.template.id, { winner: m.p1 === 'P1' ? 'p2' : 'p1' }));
    expect(finals(t).map((x) => [x.p1, x.p2])).toEqual(before);
  });

  it('restructure keeps finalists by player, and reopens the finals if one is removed', () => {
    let t = createTournament('round_robin', names(5), opts(2));
    t = playPoints(t, favourite(t));
    t = startFinals(t);
    const reseeded = restructure(t, { entrants: ['P5', 'P4', 'P3', 'P2', 'P1'] }).state;
    expect(finals(reseeded).map((m) => [m.p1, m.p2])).toEqual([['P1', 'P2']]);
    const removed = restructure(t, { entrants: ['P2', 'P3', 'P4', 'P5'] }).state;
    expect(removed.options!.finals!.qualified).toBeUndefined();
    expect(finals(removed)[0].status).toBe('waiting');
  });

  const combos: [Format, FormatOptions][] = [
    ['swiss', opts(8)],
    ['swiss', opts(4, 'double_elim')],
    ['round_robin', opts(4)],
    ['round_robin', { finals: { format: 'single_elim', advance: 4, thirdPlaceMatch: true } }],
    ['groups', opts(2)],
    ['groups', { groupCount: 3, ...opts(2, 'double_elim') }],
  ];
  for (const [format, o] of combos) {
    const max = format === 'round_robin' ? 16 : 40;
    const extra = o.finals!.thirdPlaceMatch ? ' with 3rd place' : o.groupCount ? ` (${o.groupCount} groups)` : '';
    it(`${format} + ${o.finals!.format} finals${extra}: random full runs 2..${max} finish with one champion`, () => {
      for (let n = 2; n <= max; n += 3) {
        const r = rng(n);
        let t = createTournament(format, names(n), o);
        t = playPoints(t, () => (r() < 0.1 ? 'draw' : r() < 0.5 ? 'p1' : 'p2'));
        t = startFinals(t);
        t = playAll(t, () => (r() < 0.5 ? 'p1' : 'p2'));
        expect(isComplete(t)).toBe(true);
        const places = overallPlacements(t);
        expect(places.filter((p) => p.place === 1)).toHaveLength(1);
        expect(places.every((p) => p.place !== null)).toBe(true);
        expect(places).toHaveLength(n);
        expect(finals(t).every((m) => m.p1 !== BYE || m.p2 !== BYE)).toBe(true);
      }
    });
  }
});

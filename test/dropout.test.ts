import { describe, expect, it } from 'vitest';
import {
  createTournament, eliminationPlacements, isComplete, lockSwissRounds, playableMatches, resolve, restructure, roundRobinStandings, suggestFinalists,
} from '../src/core';
import type { Format, FormatOptions, TournamentState } from '../src/core';
import { favourite, names, playAll, rng, set } from './helpers';

/** Drop players (by entrant id) the way the app does: add their seeds to options.dropped. */
function drop(state: TournamentState, ...who: string[]): TournamentState {
  const seeds = who.map((e) => state.entrants.indexOf(e) + 1);
  const dropped = [...new Set([...(state.options?.dropped ?? []), ...seeds])].sort((a, b) => a - b);
  const options: FormatOptions = { ...state.options, dropped };
  return { ...createTournament(state.structure.format, state.entrants, options), results: state.results };
}

const inMatches = (state: TournamentState, e: string) =>
  [...resolve(state).values()].filter((m) => m.p1 === e || m.p2 === e);

describe('dropping out', () => {
  it('swiss: a dropped player is not paired in later rounds but keeps their results', () => {
    let t = createTournament('swiss', names(6), { swissRounds: 3 });
    for (const m of playableMatches(t)) t = set(t, m.template.id, 'p1').state; // round 1
    t = drop(t, 'P1');
    const r2 = [...resolve(t).values()].filter((m) => m.template.round === 2);
    expect(r2.some((m) => m.p1 === 'P1' || m.p2 === 'P1')).toBe(false);
    // 5 left: two pairs and a bye, the last slot is empty
    expect(r2.filter((m) => m.status === 'ready')).toHaveLength(2);
    expect(r2.filter((m) => m.status === 'bye' && m.winner !== '__BYE__' && !m.walkover)).toHaveLength(1);

    t = playAll(t, favourite(t));
    expect(isComplete(t)).toBe(true);
    // P1 only ever played round 1
    expect(inMatches(t, 'P1').every((m) => m.template.round === 1)).toBe(true);
    const row = roundRobinStandings(t).find((r) => r.entrant === 'P1')!;
    expect(row).toMatchObject({ played: 1, wins: 1, losses: 0 });
  });

  it("swiss: dropping during a round that has started gives the opponent a walkover win", () => {
    let t = createTournament('swiss', names(4), { swissRounds: 2 });
    const [first, second] = playableMatches(t);
    t = set(t, first.template.id, 'p1').state; // round 1 has started (frozen)
    const quitter = second.p2 as string;
    t = drop(t, quitter);
    const m = resolve(t).get(second.template.id)!;
    expect(m).toMatchObject({ status: 'bye', walkover: true, winner: second.p1, loser: quitter });
    expect(playableMatches(t).some((x) => x.template.id === second.template.id)).toBe(false);

    const table = roundRobinStandings(t);
    expect(table.find((r) => r.entrant === second.p1)).toMatchObject({ played: 1, wins: 1, byes: 0, points: 3 });
    expect(table.find((r) => r.entrant === quitter)).toMatchObject({ played: 1, losses: 1, points: 0 });

    // round 2 pairs the other three (one gets a bye), never the quitter
    t = playAll(t, favourite(t));
    expect(isComplete(t)).toBe(true);
    expect(inMatches(t, quitter).every((x) => x.template.round === 1)).toBe(true);
  });

  it('swiss: a round someone reported into (not frozen yet) keeps its pairing when a player drops', () => {
    let t = createTournament('swiss', names(6), { swissRounds: 3 });
    for (const m of playableMatches(t)) t = set(t, m.template.id, 'p1').state; // round 1, frozen
    const r2 = playableMatches(t);
    // a player reports into round 2 through the sheet: the result is stored, the round isn't frozen
    const reported = r2[0];
    const results = { ...t.results, [reported.template.id]: { winner: 'p1' as const, p1: reported.p1 as string, p2: reported.p2 as string } };
    t = { ...t, results };
    const quitter = r2[1].p2 as string;
    t = drop(t, quitter);
    // the app freezes such a round when it loads the tournament (toState)
    t = { ...createTournament('swiss', t.entrants, lockSwissRounds(t, t.results)), results: t.results };
    const after = resolve(t);
    expect(after.get(reported.template.id)!.status).toBe('done'); // not a conflict
    // the quitter plays no more: either their match is a walkover, or the round re-paired without them
    expect([...after.values()].some((m) => m.status === 'ready' && (m.p1 === quitter || m.p2 === quitter))).toBe(false);
    expect([...after.values()].some((m) => m.status === 'conflict')).toBe(false);
  });

  it('swiss: if pairing without the quitter would clash with a reported result, the round keeps everyone', () => {
    let t = createTournament('swiss', names(4), { swissRounds: 3 });
    for (const m of playableMatches(t)) t = set(t, m.template.id, 'p1').state;
    const [top, bottom] = playableMatches(t);
    t = { ...t, results: { ...t.results, [bottom.template.id]: { winner: 'p1', p1: bottom.p1 as string, p2: bottom.p2 as string } } };
    const quitter = top.p2 as string;
    t = drop(t, quitter);
    t = { ...createTournament('swiss', t.entrants, lockSwissRounds(t, t.results)), results: t.results };
    const after = resolve(t);
    expect(after.get(bottom.template.id)!.status).toBe('done');
    expect(after.get(top.template.id)).toMatchObject({ status: 'bye', walkover: true, winner: top.p1, loser: quitter });
  });

  it('undoing a drop brings the match back (nothing was stored)', () => {
    let t = createTournament('single_elim', names(4));
    const before = resolve(t);
    t = drop(t, 'P4');
    expect(resolve(t).get('W1-1')!.status).toBe('bye');
    const undone = { ...createTournament('single_elim', t.entrants, { ...t.options, dropped: [] }), results: t.results };
    expect(resolve(undone).get('W1-1')!.status).toBe(before.get('W1-1')!.status);
    expect(Object.keys(t.results)).toEqual([]);
  });

  it('single elimination: dropping forfeits their next match, and they still get a place', () => {
    let t = createTournament('single_elim', names(8));
    t = set(t, 'W1-1', 'p1').state; // P1 beats P8
    t = drop(t, 'P1');
    t = playAll(t, favourite(t));
    expect(isComplete(t)).toBe(true);
    const p1 = inMatches(t, 'P1');
    const nextMatch = p1.find((m) => m.template.round === 2)!;
    expect(nextMatch).toMatchObject({ status: 'bye', walkover: true, loser: 'P1' });
    const places = new Map(eliminationPlacements(t).map((p) => [p.entrant, p.place]));
    expect(places.get('P1')).toBe(3); // out in the semifinal (round 2 of 3)
  });

  it('double elimination: a dropped grand finalist walks over, no reset is needed', () => {
    let t = createTournament('double_elim', names(4));
    for (let i = 0; i < 20; i++) {
      const ready = playableMatches(t).filter((m) => m.template.side !== 'GF');
      if (!ready.length) break;
      t = set(t, ready[0].template.id, favourite(t)(ready[0])).state;
    }
    const gf = resolve(t).get('GF-1')!;
    expect(gf.status).toBe('ready');
    t = drop(t, gf.p2 as string);
    const after = resolve(t);
    expect(after.get('GF-1')).toMatchObject({ status: 'bye', winner: gf.p1 });
    expect(after.get('GF-2')!.status).toBe('skipped');
    expect(isComplete(t)).toBe(true);
    expect(eliminationPlacements(t).find((p) => p.place === 1)!.entrant).toBe(gf.p1);
  });

  it('round robin: the remaining matches of a dropped player count as forfeit losses', () => {
    let t = createTournament('round_robin', names(4));
    const firstOfP1 = playableMatches(t).find((m) => m.p1 === 'P1' || m.p2 === 'P1')!;
    t = set(t, firstOfP1.template.id, firstOfP1.p1 === 'P1' ? 'p1' : 'p2').state;
    t = drop(t, 'P1');
    expect(playableMatches(t).some((m) => m.p1 === 'P1' || m.p2 === 'P1')).toBe(false);
    t = playAll(t, favourite(t));
    expect(isComplete(t)).toBe(true);
    const table = roundRobinStandings(t);
    expect(table.find((r) => r.entrant === 'P1')).toMatchObject({ played: 3, wins: 1, losses: 2 });
    // everyone still played 3
    expect(table.every((r) => r.played === 3)).toBe(true);
    expect(Object.keys(t.results)).toHaveLength(4); // only real matches are stored
  });

  it('restructure carries drops by player and keeps their played results', () => {
    let t = createTournament('swiss', names(6), { swissRounds: 3 });
    for (const m of playableMatches(t)) t = set(t, m.template.id, 'p1').state;
    t = drop(t, 'P2');
    const played = Object.keys(t.results).length;
    // reseed: reverse the order
    const out = restructure(t, { entrants: [...t.entrants].reverse() });
    expect(out.dropped).toEqual([]);
    expect(Object.keys(out.state.results)).toHaveLength(played);
    expect(out.state.options!.dropped).toEqual([out.state.entrants.indexOf('P2') + 1]);
    // removing the dropped player forgets the drop
    const gone = restructure(t, { entrants: t.entrants.filter((e) => e !== 'P2') });
    expect(gone.state.options!.dropped).toBeUndefined();
    // input can't set drops
    const sneaky = restructure(t, { options: { dropped: [1, 3] } });
    expect(sneaky.state.options!.dropped).toEqual([2]);
  });

  it('finalists are suggested without dropped players', () => {
    let t = createTournament('round_robin', names(5), { finals: { format: 'single_elim', advance: 2 } });
    t = playAll(t, favourite(t));
    t = drop(t, 'P1');
    expect(suggestFinalists(t).finalists).toEqual(['P2', 'P3']);
  });

  const formats: [Format, FormatOptions][] = [
    ['single_elim', {}],
    ['double_elim', {}],
    ['round_robin', {}],
    ['swiss', {}],
    ['groups', { finals: { format: 'single_elim', advance: 2 } }],
  ];
  for (const [format, opts] of formats) {
    it(`${format}: random drops part-way always finish (sizes 2..24)`, () => {
      const rand = rng(format.length * 97);
      for (let n = 2; n <= 24; n++) {
        let t = createTournament(format, names(n), opts);
        let quitters = 0;
        for (let step = 0; step < 2000; step++) {
          const ready = playableMatches(t);
          if (!ready.length) {
            if (format === 'groups' && t.options?.finals && !t.options.finals.qualified) {
              const q = suggestFinalists(t).finalists.map((e) => t.entrants.indexOf(e) + 1);
              const options = { ...t.options, finals: { ...t.options.finals, qualified: q } };
              t = { ...createTournament(format, t.entrants, options), results: t.results };
              continue;
            }
            break;
          }
          if (quitters < 2 && rand() < 0.1) {
            const active = t.entrants.filter((_, i) => !(t.options?.dropped ?? []).includes(i + 1));
            t = drop(t, active[Math.floor(rand() * active.length)]);
            quitters++;
            continue;
          }
          const m = ready[Math.floor(rand() * ready.length)];
          t = set(t, m.template.id, rand() < 0.5 ? 'p1' : 'p2').state;
        }
        expect(isComplete(t), `${format} n=${n}`).toBe(true);
        // dropped players never got a match after dropping: none of their matches are ready
        const out = new Set((t.options?.dropped ?? []).map((s) => t.entrants[s - 1]));
        expect([...resolve(t).values()].some((m) => m.status === 'ready' && (out.has(m.p1!) || out.has(m.p2!)))).toBe(false);
      }
    });
  }
});

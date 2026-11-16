import { describe, expect, it } from 'vitest';
import { applyEdit, createTournament, replaceEntrant, resolve, restructure, undo } from '../src/core';
import { favourite, names, playAll, set } from './helpers';

// 8-player single elim: W1-1 = P1 v P8, W1-2 = P4 v P5, W2-1 = winners of those.
describe('editing results', () => {
  it('unplayed downstream matches update silently', () => {
    let t = createTournament('single_elim', names(8));
    t = set(t, 'W1-1', 'p1').state; // P1 beats P8
    expect(resolve(t).get('W2-1')!.p1).toBe('P1');

    const { state, out } = set(t, 'W1-1', 'p2'); // oops, P8 actually won
    expect(resolve(state).get('W2-1')!.p1).toBe('P8');
    expect(out.conflicts).toHaveLength(0);
    expect(out.changes).toHaveLength(1);
  });

  it('played downstream matches become conflicts; default is to reset them', () => {
    let t = createTournament('single_elim', names(8));
    for (const id of ['W1-1', 'W1-2', 'W2-1']) t = set(t, id, 'p1').state; // P1 > P8, P4 > P5, P1 > P4

    const { state, out } = set(t, 'W1-1', 'p2');
    expect(out.conflicts.map((c) => [c.matchId, c.decision])).toEqual([['W2-1', 'reset']]);
    expect(out.conflicts[0].played).toEqual({ p1: 'P1', p2: 'P4' });
    expect(out.conflicts[0].now).toEqual({ p1: 'P8', p2: 'P4' });
    expect(resolve(state).get('W2-1')!.status).toBe('ready');
    expect(out.changes.map((c) => c.matchId).sort()).toEqual(['W1-1', 'W2-1']);
  });

  it('reset cascades all the way down', () => {
    let t = createTournament('single_elim', names(8));
    t = playAll(t, favourite(t));
    const { state, out } = set(t, 'W1-1', 'p2'); // P8 upsets P1 -> P1's whole run is invalid
    expect(out.conflicts.map((c) => c.matchId)).toEqual(['W2-1', 'W3-1']);
    expect(resolve(state).get('W3-1')!.status).toBe('waiting');
  });

  it('"keep" credits the old result to the new player (wrong name typed upstream)', () => {
    let t = createTournament('single_elim', names(8));
    for (const id of ['W1-1', 'W1-2', 'W2-1']) t = set(t, id, 'p1').state;
    const { state, out } = set(t, 'W1-1', 'p2', { 'W2-1': 'keep' });
    expect(out.conflicts[0].decision).toBe('keep');
    const w2 = resolve(state).get('W2-1')!;
    expect(w2.status).toBe('done');
    expect(w2.winner).toBe('P8');
  });

  it('a preview is just a call whose result you do not save', () => {
    let t = createTournament('single_elim', names(8));
    for (const id of ['W1-1', 'W1-2', 'W2-1']) t = set(t, id, 'p1').state;
    const before = JSON.stringify(t);
    const preview = applyEdit(t, 'W1-1', { winner: 'p2' });
    expect(preview.conflicts).toHaveLength(1);
    expect(JSON.stringify(t)).toBe(before);
  });

  it('undo restores the whole change group', () => {
    let t = createTournament('single_elim', names(8));
    t = playAll(t, favourite(t));
    const original = t.results;
    const { state, out } = set(t, 'W1-1', 'p2');
    const back = undo(state, out.changes);
    expect(back.results).toEqual(original);
  });

  it('clearing a result un-plays it and resets dependants', () => {
    let t = createTournament('single_elim', names(4));
    t = playAll(t, favourite(t));
    const out = applyEdit(t, 'W1-1', null);
    expect(out.results['W1-1']).toBeUndefined();
    expect(out.results['W2-1']).toBeUndefined();
    expect(out.results['W1-2']).toBeDefined();
  });

  it('changing GF-1 so the reset is no longer needed removes the reset result', () => {
    let t = createTournament('double_elim', names(4));
    t = playAll(t, (m) => (m.template.id === 'GF-1' ? 'p2' : favourite(t)(m)));
    expect(t.results['GF-2']).toBeDefined();
    const { state, out } = set(t, 'GF-1', 'p1', () => 'keep');
    expect(out.conflicts.map((c) => [c.matchId, c.canKeep, c.decision])).toEqual([['GF-2', false, 'reset']]);
    expect(resolve(state).get('GF-2')!.status).toBe('skipped');
  });

  it('cannot report a match that has no players yet', () => {
    const t = createTournament('single_elim', names(8));
    expect(() => set(t, 'W2-1', 'p1')).toThrow(/two players/);
  });
});

describe('editing the tournament itself', () => {
  it('replace a player who left with a sub, keeping all their results', () => {
    let t = createTournament('single_elim', names(4));
    t = set(t, 'W1-1', 'p1').state;
    t = replaceEntrant(t, 'P1', 'Sub');
    const r = resolve(t);
    expect(r.get('W1-1')!.status).toBe('done');
    expect(r.get('W2-1')!.p1).toBe('Sub');
  });

  it('late entrant in round robin: all existing results are kept', () => {
    let t = createTournament('round_robin', names(4));
    t = playAll(t, () => 'p1');
    const out = restructure(t, { entrants: [...t.entrants, 'Late'] });
    expect(out.dropped).toHaveLength(0);
    expect(out.kept).toHaveLength(6);
    expect(out.state.structure.matches).toHaveLength(10);
    // the same players won the same matches
    const winners = (s: typeof t) =>
      [...resolve(s).values()].filter((m) => m.status === 'done').map((m) => `${m.winner}>${m.loser}`).sort();
    expect(winners(out.state)).toEqual(winners(t));
  });

  it('removing a player from round robin drops only their matches', () => {
    let t = createTournament('round_robin', names(4));
    t = playAll(t, () => 'p1');
    const out = restructure(t, { entrants: ['P1', 'P2', 'P3'] });
    expect(out.kept).toHaveLength(3);
    expect(out.dropped).toHaveLength(3);
    expect(out.dropped.every((d) => d.result.p1 === 'P4' || d.result.p2 === 'P4')).toBe(true);
  });

  it('reseeding an elimination bracket keeps results where the same pair still meets', () => {
    let t = createTournament('single_elim', names(8));
    t = set(t, 'W1-1', 'p1').state; // P1 v P8
    t = set(t, 'W1-2', 'p1').state; // P4 v P5
    // swap seeds 2 and 3: round 1 pairs for P1 and P4 are unchanged
    const out = restructure(t, { entrants: ['P1', 'P3', 'P2', 'P4', 'P5', 'P6', 'P7', 'P8'] });
    expect(out.dropped).toHaveLength(0);
    expect(resolve(out.state).get('W2-1')!.p1).toBe('P1');
    expect(resolve(out.state).get('W2-1')!.p2).toBe('P4');
  });

  it('turning on a 3rd place match mid-tournament keeps everything', () => {
    let t = createTournament('single_elim', names(8));
    t = playAll(t, favourite(t));
    const out = restructure(t, { options: { thirdPlaceMatch: true } });
    expect(out.dropped).toHaveLength(0);
    expect(resolve(out.state).get('3P-1')!.status).toBe('ready');
  });

  it('a result where players swapped sides is flipped correctly', () => {
    let t = createTournament('round_robin', ['A', 'B']);
    t = { ...t, results: applyEdit(t, 'RR1-1', { winner: 'p1', score1: 3, score2: 1 }).results };
    const p1 = resolve(t).get('RR1-1')!.p1;
    const out = restructure(t, { entrants: ['B', 'A'] });
    const m = resolve(out.state).get('RR1-1')!;
    expect(m.winner).toBe(p1);
    expect(m.p1 === p1 ? m.result!.score1 : m.result!.score2).toBe(3);
  });
});

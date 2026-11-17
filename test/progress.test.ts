import { describe, expect, it } from 'vitest';
import { resolve } from '../src/core';
import { emptyDoc, progressOf, summaryOf, toState } from '../src/app/lib/model';
import type { TournamentDoc } from '../src/app/lib/model';

/** Play every ready match until the tournament is over, p1 always winning. */
function playAll(doc: TournamentDoc): TournamentDoc {
  for (;;) {
    const ready = [...resolve(toState(doc)).values()].filter((m) => m.status === 'ready');
    if (!ready.length) return doc;
    const m = ready[0];
    doc = { ...doc, results: { ...doc.results, [m.template.id]: { winner: 'p1', p1: m.p1!, p2: m.p2! } } };
  }
}

const docOf = (format: TournamentDoc['format'], n: number, options = {}): TournamentDoc => ({
  ...emptyDoc(),
  format,
  options,
  entrants: Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i })),
});

describe('tournament progress for the list and header', () => {
  it('counts real matches only: no byes, and a grand final reset only when it is needed', () => {
    // 6 players: 2 first-round byes in an 8-slot bracket
    const doc = docOf('double_elim', 6, { grandFinal: 'reset' });
    const before = progressOf(resolve(toState(doc)));
    expect(before.played).toBe(0);
    const done = playAll(doc);
    const after = progressOf(resolve(toState(done)));
    expect(after.played).toBe(after.total);
    expect(after.total).toBe(Object.keys(done.results).length);
    // seed 1 won every match, so no reset was played and it isn't counted
    expect(after.total).toBe(before.total);
  });

  it('gives the status and the champion', () => {
    const doc = docOf('single_elim', 5);
    expect(summaryOf(doc)).toMatchObject({ status: 'setup', played: 0, total: 4, champion: null });
    const done = playAll(doc);
    expect(summaryOf(done)).toMatchObject({ status: 'finished', played: 4, total: 4, champion: 'P0' });
    expect(summaryOf(docOf('swiss', 1))).toMatchObject({ status: 'setup', total: 0 });
  });
});

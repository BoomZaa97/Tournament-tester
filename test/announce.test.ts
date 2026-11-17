import { describe, expect, it } from 'vitest';
import { resolve } from '../src/core';
import { announcements } from '../src/app/lib/announce';
import { emptyDoc, toState } from '../src/app/lib/model';
import type { TournamentDoc } from '../src/app/lib/model';

const LINK = 'https://example.org/#/t/x';

function start(names: string[], extra: Partial<TournamentDoc> = {}): TournamentDoc {
  return { ...emptyDoc(), id: 'x', name: 'Friday', format: 'single_elim', entrants: names.map((n) => ({ id: n, name: n.toUpperCase() })), ...extra };
}
/** Play the next ready match: p1 wins 2–1. */
function playOne(doc: TournamentDoc, status?: 'reported' | 'confirmed'): TournamentDoc {
  const m = [...resolve(toState(doc)).values()].find((x) => x.status === 'ready')!;
  return { ...doc, results: { ...doc.results, [m.template.id]: { winner: 'p1', score1: 2, score2: 1, p1: m.p1!, p2: m.p2!, ...(status ? { status } : {}) } } };
}

describe('Discord announcements', () => {
  it('first result: started + the score with the round; header and link around it', () => {
    const t0 = start(['a', 'b', 'c', 'd']);
    const t1 = playOne(t0);
    expect(announcements(t0, t1, LINK)).toEqual(['**Friday**', 'Started.', '**A** 2–1 D · Semifinals', `<${LINK}>`]);
  });

  it('nothing to say: no lines; reported results wait until they are confirmed', () => {
    const t1 = playOne(start(['a', 'b', 'c', 'd']));
    expect(announcements(t1, { ...t1, name: 'Renamed' }, LINK)).toEqual([]);
    const reported = playOne(t1, 'reported');
    expect(announcements(t1, reported, LINK)).toEqual([]);
    const id = Object.keys(reported.results).find((k) => !t1.results[k])!;
    const confirmed = { ...reported, results: { ...reported.results, [id]: { ...reported.results[id], status: 'confirmed' as const } } };
    expect(announcements(reported, confirmed, LINK)).toEqual(['**Friday**', '**B** 2–1 C · Semifinals', `<${LINK}>`]);
  });

  it('the last result names the champion', () => {
    let t = start(['a', 'b']);
    const t0 = t;
    t = playOne(t);
    const lines = announcements(t0, t, LINK);
    expect(lines).toContain('Champion: **A**');
    expect(lines).toContain('**A** 2–1 B · Final');
  });

  it('a big batch is cut short', () => {
    const t0 = start(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p']);
    let t = t0;
    for (let i = 0; i < 8; i++) t = playOne(t);
    const lines = announcements(t0, t, LINK);
    expect(lines.filter((l) => l.includes('Round of 16') || l.includes('2–1'))).toHaveLength(6);
    expect(lines).toContain('…and 2 more results');
  });
});

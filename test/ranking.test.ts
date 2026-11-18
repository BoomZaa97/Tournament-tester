import { describe, expect, it } from 'vitest';
import { resolve } from '../src/core';
import { categoryOf, cleanDivision, divisionOf, emptyDoc, toState } from '../src/app/lib/model';
import type { TournamentDoc } from '../src/app/lib/model';
import { eventPoints, filterTournaments, placementPoints, PROVISIONAL, ranked, rankings, START_RATING } from '../src/app/lib/ranking';

let clock = Date.parse('2026-01-01T10:00:00Z');
const tick = () => new Date((clock += 60_000)).toISOString();

/** A finished tournament: the lower id always wins (or `winner` decides). */
function played(
  id: string,
  format: TournamentDoc['format'],
  names: string[],
  extra: Partial<TournamentDoc> = {},
  winner: (a: string, b: string) => 'p1' | 'p2' | 'draw' = (a, b) => (a < b ? 'p1' : 'p2'),
): TournamentDoc {
  let doc: TournamentDoc = {
    ...emptyDoc(), id, name: id, format, createdAt: tick(), ...extra,
    entrants: names.map((n) => ({ id: n, name: n.toUpperCase() })),
  };
  for (;;) {
    const m = [...resolve(toState(doc)).values()].find((x) => x.status === 'ready');
    if (!m) return doc;
    const w = winner(m.p1!, m.p2!);
    doc = { ...doc, results: { ...doc.results, [m.template.id]: { winner: w, p1: m.p1!, p2: m.p2!, at: tick() } } };
  }
}

describe('rankings', () => {
  it('gives placement points, medals and titles from finished tournaments only', () => {
    const t1 = played('t1', 'single_elim', ['a', 'b', 'c', 'd']);
    const unfinished = { ...played('t2', 'single_elim', ['a', 'b', 'c', 'd']), results: {} };
    const rows = rankings([t1, unfinished], []);
    expect(rows.get('a')).toMatchObject({ points: 100, titles: 1, medals: [1, 0, 0], best: 1, events: 2 });
    expect(rows.get('b')).toMatchObject({ points: 70, medals: [0, 1, 0], best: 2 });
    // c and d both lost in the semis: both 3rd
    expect(rows.get('d')!.points).toBe(placementPoints(3));
    expect(rows.get('a')!.player.name).toBe('A');
  });

  it('rates winners up and losers down, equal at the start, and records the history per tournament', () => {
    const t1 = played('t1', 'round_robin', ['a', 'b', 'c']);
    const rows = rankings([t1], []);
    const a = rows.get('a')!;
    const c = rows.get('c')!;
    expect(a.rating).toBeGreaterThan(START_RATING);
    expect(c.rating).toBeLessThan(START_RATING);
    // Elo is zero-sum
    const total = [...rows.values()].reduce((s, r) => s + r.rating, 0);
    expect(total).toBeCloseTo(3 * START_RATING, 6);
    expect(a.rated).toBe(2);
    expect(a.history).toHaveLength(1);
    expect(a.history[0]).toMatchObject({ tournamentId: 't1', rating: a.rating });
    expect(a.change).toBeCloseTo(a.rating - START_RATING, 6);
    expect(a.wins).toBe(2);
  });

  it('counts beating a stronger player for more', () => {
    // b beats c many times first, then a (unrated) beats b, versus a beating c
    const warm = Array.from({ length: 4 }, (_, i) => played('w' + i, 'single_elim', ['b', 'c']));
    const upset = played('u', 'single_elim', ['a', 'b']);
    const easy = played('e', 'single_elim', ['a', 'c']);
    const gainVsStrong = rankings([...warm, upset], []).get('a')!.rating - START_RATING;
    const gainVsWeak = rankings([...warm, easy], []).get('a')!.rating - START_RATING;
    expect(gainVsStrong).toBeGreaterThan(gainVsWeak);
  });

  it('leaves forfeits out of the rating but keeps them in the record; draws count half', () => {
    const t = played('t', 'single_elim', ['a', 'b']);
    const ff = { ...t, results: { 'W1-1': { ...t.results['W1-1'], forfeit: true } } };
    const r = rankings([ff], []).get('a')!;
    expect(r.rating).toBe(START_RATING);
    expect(r.rated).toBe(0);
    expect(r.wins).toBe(1);
    const draw = played('d', 'round_robin', ['a', 'b'], {}, () => 'draw');
    const d = rankings([draw], []);
    expect(d.get('a')!.rating).toBe(START_RATING);
    expect(d.get('a')!.draws).toBe(1);
  });

  it('ranks by rating with provisional players last, or by points', () => {
    const many = Array.from({ length: PROVISIONAL }, (_, i) => played('r' + i, 'round_robin', ['a', 'b', 'c']));
    const newbie = played('n', 'single_elim', ['d', 'e']);
    const rows = rankings([...many, newbie], []);
    const byRating = ranked(rows.values(), 'rating');
    expect(byRating.map((r) => r.player.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(byRating.map((r) => r.rank)).toEqual([1, 2, 3, null, null]);
    const byPoints = ranked(rows.values(), 'points');
    expect(byPoints[0]).toMatchObject({ rank: 1, points: 100 * PROVISIONAL });
    // d won the 2-player event: 100 points, same as nobody else; b and d share nothing
    expect(byPoints.find((r) => r.player.id === 'd')!.rank).not.toBeNull();
  });

  it('shares a rank on equal points', () => {
    const t1 = played('t1', 'single_elim', ['a', 'b']);
    const t2 = played('t2', 'single_elim', ['c', 'd']);
    const pts = ranked(rankings([t1, t2], []).values(), 'points');
    expect(pts.slice(0, 2).map((r) => r.rank)).toEqual([1, 1]);
    expect(pts[2].rank).toBe(3);
  });

  it('filters by game, category and year', () => {
    const ts = [
      played('x', 'single_elim', ['a', 'b'], { game: 'Chess', category: 'Sports', createdAt: '2025-05-01T00:00:00Z' }),
      played('y', 'single_elim', ['a', 'b'], { game: 'Chess', category: 'Esports', createdAt: '2026-05-01T00:00:00Z' }),
      played('z', 'single_elim', ['a', 'b'], { game: 'Go', createdAt: '2026-06-01T00:00:00Z' }),
    ];
    expect(filterTournaments(ts, { game: 'Chess' }).map((t) => t.id)).toEqual(['x', 'y']);
    expect(filterTournaments(ts, { game: 'Chess', category: 'Esports' }).map((t) => t.id)).toEqual(['y']);
    expect(filterTournaments(ts, { year: 2026 }).map((t) => t.id)).toEqual(['y', 'z']);
    expect(filterTournaments(ts, {}).length).toBe(3);
  });

  it('majors count double and semi-majors one and a half times; they can be filtered', () => {
    const major = played('m', 'single_elim', ['a', 'b', 'c', 'd'], { tier: 'major' });
    const semi = played('s', 'single_elim', ['b', 'c'], { tier: 'semi' });
    const small = played('n', 'single_elim', ['c', 'd']);
    const rows = rankings([major, semi, small], []);
    expect(rows.get('a')).toMatchObject({ points: 200, titles: 1, majorTitles: 1, semiTitles: 0 });
    expect(rows.get('b')).toMatchObject({ points: 140 + 150, titles: 1, majorTitles: 0, semiTitles: 1 });
    expect(rows.get('c')!.points).toBe(eventPoints(3, 'major') + eventPoints(2, 'semi') + eventPoints(1, 'small'));
    expect(eventPoints(2, 'semi')).toBe(105);
    expect(filterTournaments([major, semi, small], { tier: 'major' }).map((t) => t.id)).toEqual(['m']);
    expect(filterTournaments([major, semi, small], { tier: 'small' }).map((t) => t.id)).toEqual(['n']);
  });
});

describe('category and division', () => {
  it('division defaults to Open; old age-group categories count as the division', () => {
    expect(divisionOf({})).toBe('Open');
    expect(categoryOf({ category: 'Esports' })).toBe('Esports');
    expect(divisionOf({ category: 'Esports', division: 'U18' })).toBe('U18');
    expect(divisionOf({ division: 'open' })).toBe('Open');
    // made before divisions existed
    expect(categoryOf({ category: 'Open' })).toBe('');
    expect(divisionOf({ category: 'Open' })).toBe('Open');
    expect(divisionOf({ category: 'U18' })).toBe('U18');
    expect(categoryOf({ category: 'U18' })).toBe('');
    expect(categoryOf({ category: 'Doubles' })).toBe('Doubles');
    expect(cleanDivision(' Open ')).toBeUndefined();
    expect(cleanDivision(' U15  girls ')).toBe('U15 girls');
  });

  it('rankings filter by division', () => {
    const a = { ...emptyDoc(), id: 'a', division: 'U18' };
    const b = { ...emptyDoc(), id: 'b' };
    const c = { ...emptyDoc(), id: 'c', category: 'U18' };
    expect(filterTournaments([a, b, c], { division: 'U18' }).map((t) => t.id)).toEqual(['a', 'c']);
    expect(filterTournaments([a, b, c], { division: 'Open' }).map((t) => t.id)).toEqual(['b']);
  });
});

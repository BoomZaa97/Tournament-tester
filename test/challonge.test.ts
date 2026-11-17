import { describe, expect, it } from 'vitest';
import { createTournament, resolve } from '../src/core';
import { fromChallonge, parseScores } from '../src/app/lib/challonge';
import type { ChMatch, ChTournament } from '../src/app/lib/challonge';

// Shaped like Challonge's API v1 (`include_participants=1&include_matches=1`): every item wrapped.
const people = (names: string[]) => names.map((name, i) => ({ participant: { id: 100 + i, name, display_name: name, seed: i + 1 } }));
let nextId = 1;
const m = (round: number, p1: number, p2: number, winner: number | null, scores: string, extra: Partial<ChMatch> = {}) => ({
  match: { id: nextId++, round, player1_id: 100 + p1, player2_id: 100 + p2, winner_id: winner === null ? null : 100 + winner, scores_csv: scores, state: 'complete', completed_at: '2026-10-01T12:00:00.000Z', ...extra },
});

function play(t: ChTournament) {
  const out = fromChallonge(t, []);
  const ids = out.entrants.map((e) => e.id);
  const tstate = { ...createTournament(out.format, ids, out.options), results: out.results };
  return { out, tstate, resolved: resolve(tstate), name: (id: string | null | undefined) => out.entrants.find((e) => e.id === id)?.name };
}

describe('Challonge import', () => {
  it('scores: one set is the score, several sets count sets won', () => {
    expect(parseScores('3-1')).toEqual([3, 1]);
    expect(parseScores('3-1,1-3,3-2')).toEqual([2, 1]);
    expect(parseScores('-2-5')).toEqual([-2, 5]);
    expect(parseScores('')).toBeNull();
    expect(parseScores(null)).toBeNull();
  });

  it('double elimination with a grand final reset: every match lands where it was played', () => {
    nextId = 1;
    // seeds: 0 Alice, 1 Bob, 2 Cara, 3 Dan
    const t: ChTournament = {
      name: 'Friday #3',
      tournament_type: 'double elimination',
      game_name: 'Tekken 8',
      grand_finals_modifier: null,
      participants: people(['Alice', 'Bob', 'Cara', 'Dan']),
      matches: [
        m(1, 0, 3, 0, '2-0'),
        m(1, 1, 2, 2, '1-2'),
        m(2, 0, 2, 0, '2-1'), // winners final
        m(-1, 3, 1, 1, '0-2'),
        m(-2, 2, 1, 2, '2-0'), // losers final
        m(3, 0, 2, 2, '1-3'), // grand final
        m(3, 0, 2, 0, '3-2'), // reset
      ],
    };
    const { out, resolved, name } = play(t);
    expect(out.name).toBe('Friday #3');
    expect(out.game).toBe('Tekken 8');
    expect(out.format).toBe('double_elim');
    expect(out.entrants.map((e) => e.name)).toEqual(['Alice', 'Bob', 'Cara', 'Dan']);
    expect(out.imported).toBe(7);
    expect(out.skipped).toEqual([]);
    expect([...resolved.values()].filter((x) => x.status === 'ready' || x.status === 'waiting')).toHaveLength(0);
    // the reset was won by Alice: she is the champion
    const gf = [...resolved.values()].filter((x) => x.template.side === 'GF' && x.status === 'done');
    expect(gf).toHaveLength(2);
    expect(name(gf[gf.length - 1].winner)).toBe('Alice');
    // scores follow who is p1 here, not on Challonge
    const gf1 = gf[0];
    const cara = gf1.result!.winner === 'p1' ? gf1.result!.score1 : gf1.result!.score2;
    expect(cara).toBe(3);
    expect(name(gf1.winner)).toBe('Cara');
    expect(gf1.result!.at).toBe('2026-10-01T12:00:00.000Z');
  });

  it('known players keep their ids; duplicate names are told apart', () => {
    nextId = 1;
    const known = [{ id: 'old-alice', name: 'alice' }];
    const t: ChTournament = { name: 'X', tournament_type: 'single elimination', participants: people(['Alice', 'Bob', 'Bob']), matches: [] };
    const out = fromChallonge(t, known);
    expect(out.entrants[0].id).toBe('old-alice');
    expect(out.entrants.map((e) => e.name)).toEqual(['alice', 'Bob', 'Bob (2)']);
    expect(out.created.map((p) => p.name)).toEqual(['Bob', 'Bob (2)']);
  });

  it('single elimination: third place match, forfeits, and a match that has no place here is listed', () => {
    nextId = 1;
    const t: ChTournament = {
      name: 'Cup',
      tournament_type: 'single elimination',
      hold_third_place_match: true,
      participants: people(['A', 'B', 'C', 'D']),
      matches: [
        m(1, 0, 3, 0, '', { forfeited: true }),
        m(1, 1, 2, 1, '2-0'),
        m(2, 0, 1, 1, '2-1'),
        m(2, 3, 2, 3, '2-0'), // 3rd place
        m(5, 0, 2, 0, '1-0'), // A never met C: can't be placed
      ],
    };
    const { out, resolved, name } = play(t);
    expect(out.options.thirdPlaceMatch).toBe(true);
    expect(out.imported).toBe(4);
    expect(out.skipped).toEqual(['A vs C (1–0)']);
    const first = [...resolved.values()].find((x) => x.status === 'done' && x.result?.forfeit);
    expect(name(first?.winner)).toBe('A');
    const third = [...resolved.values()].find((x) => x.template.side === '3P');
    expect(name(third?.winner)).toBe('D');
  });

  it('round robin: draws count, a second meeting makes it a double round robin', () => {
    nextId = 1;
    const t: ChTournament = {
      name: 'League',
      tournament_type: 'round robin',
      participants: people(['A', 'B', 'C']),
      matches: [m(1, 0, 1, null, '1-1'), m(2, 0, 2, 2, '0-2'), m(3, 1, 2, 1, '3-0'), m(4, 1, 0, 1, '2-0')],
    };
    const { out } = play(t);
    expect(out.format).toBe('round_robin');
    expect(out.options.doubleRound).toBe(true);
    expect(out.imported).toBe(4);
    expect(Object.values(out.results).some((r) => r.winner === 'draw')).toBe(true);
  });

  it("swiss: Challonge's own pairings are kept, byes included, later rounds are paired here", () => {
    nextId = 1;
    const t: ChTournament = {
      name: 'Swiss night',
      tournament_type: 'swiss',
      swiss_rounds: 3,
      participants: people(['A', 'B', 'C', 'D', 'E']),
      matches: [
        // round 1: A–E, B–D, C has the bye (not a match on Challonge)
        m(1, 0, 4, 0, '2-0'),
        m(1, 1, 3, 3, '0-2'),
        // round 2: A–D, C–E (not B–C as we might pair it), B has the bye
        m(2, 0, 3, 3, '1-2'),
        m(2, 2, 4, null, '1-1'),
        // round 3 not played yet
        { match: { id: 99, round: 3, player1_id: 103, player2_id: 102, winner_id: null, scores_csv: '', state: 'open' } },
      ],
    };
    const { out, resolved, name } = play(t);
    expect(out.format).toBe('swiss');
    expect(out.options.swissRounds).toBe(3);
    expect(out.options.swissPairings).toEqual([
      [[1, 5], [2, 4], [3, 0]],
      [[1, 4], [3, 5], [2, 0]],
    ]);
    expect(out.imported).toBe(4);
    expect(out.skipped).toEqual([]);
    const r2 = resolved.get('S2-1')!;
    expect([name(r2.p1), name(r2.p2)]).toEqual(['A', 'D']);
    expect(name(r2.winner)).toBe('D');
    expect(resolved.get('S2-2')!.result!.winner).toBe('draw');
    // round 3 is paired by the site from the standings
    expect([...resolved.values()].filter((x) => x.template.id.startsWith('S3-') && x.status === 'ready').length).toBeGreaterThan(0);
  });

  it('formats this site lacks: players only, with a note', () => {
    nextId = 1;
    const out = fromChallonge({ name: 'FFA', tournament_type: 'free for all', participants: people(['A', 'B']), matches: [] }, []);
    expect(out.format).toBe('single_elim');
    expect(out.notes[0]).toMatch(/free for all/);
    expect(out.entrants).toHaveLength(2);
    expect(out.results).toEqual({});
  });
});

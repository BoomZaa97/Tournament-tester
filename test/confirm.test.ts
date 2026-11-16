import { describe, expect, it } from 'vitest';
import { applyEdit, createTournament, resolve, restructure, undo } from '../src/core';
import type { MatchResult } from '../src/core';
import { names } from './helpers';

describe('reported / confirmed / disputed results', () => {
  const base = createTournament('round_robin', names(4));
  const id = [...resolve(base).values()][0].template.id;
  const m = resolve(base).get(id)!;
  const reported: MatchResult = { winner: 'p1', score1: 2, score2: 1, p1: m.p1 as string, p2: m.p2 as string, status: 'disputed', reportedBy: m.p1 as string };
  const state = { ...base, results: { [id]: reported } };

  it('the bracket ignores the confirmation state', () => {
    expect(resolve(state).get(id)!.status).toBe('done');
  });

  it('the organizer settles a disputed result by saving it: what they save counts as confirmed', () => {
    const out = applyEdit(state, id, { winner: 'p1', score1: 2, score2: 1 });
    expect(out.results[id].status).toBeUndefined();
    expect(out.changes).toHaveLength(1); // logged, so it can be undone
    expect(undo({ ...state, results: out.results }, out.changes).results[id]).toEqual(reported);
  });

  it('a restructure keeps the state with the result', () => {
    const out = restructure(state, { entrants: [...state.entrants].reverse() });
    expect(Object.values(out.state.results)[0]).toMatchObject({ status: 'disputed', reportedBy: m.p1 });
  });
});

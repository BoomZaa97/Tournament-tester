import { BYE } from './types';
import type { EntrantId, ResolvedMatch, TournamentState } from './types';
import { resolve } from './resolve';

export interface Placement {
  entrant: EntrantId;
  /** Final place (ties share a place, e.g. two 3rds). null = still in the running. */
  place: number | null;
}

/**
 * Placements for single/double elimination.
 * Each entrant ends at a "level" (how deep they got). Place = 1 + number of
 * entrants who got deeper or are still alive.
 */
export function eliminationPlacements(state: TournamentState): Placement[] {
  const resolved = resolve(state);
  const level = new Map<EntrantId, number>();

  // A grand final whose reset match is being played does not decide anything.
  const undecisive = new Set<string>();
  for (const m of resolved.values()) {
    const dep = m.template.onlyIf?.match;
    if (dep && m.status !== 'skipped') undecisive.add(dep);
  }

  for (const m of resolved.values()) {
    if (m.status !== 'done' && m.status !== 'bye') continue;
    if (undecisive.has(m.template.id)) continue;
    const { elimLevel, winLevel } = m.template;
    if (elimLevel !== undefined && m.loser && m.loser !== BYE) level.set(m.loser, elimLevel);
    if (winLevel !== undefined && m.winner && m.winner !== BYE) level.set(m.winner, winLevel);
  }

  return state.entrants
    .map((e) => {
      const lv = level.get(e);
      if (lv === undefined) return { entrant: e, place: null };
      const above = state.entrants.filter((o) => o !== e && (level.get(o) ?? Infinity) > lv).length;
      return { entrant: e, place: above + 1 };
    })
    .sort((a, b) => (a.place ?? 0) - (b.place ?? 0));
}

export type Tiebreaker =
  | 'h2h' // points in matches between the tied players only
  | 'diff' // score difference
  | 'for' // total score
  | 'wins'; // number of wins

export interface RoundRobinOptions {
  points?: { win: number; draw: number; loss: number };
  tiebreakers?: Tiebreaker[];
}

export interface StandingRow {
  entrant: EntrantId;
  rank: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  for: number;
  against: number;
  diff: number;
  points: number;
}

export function roundRobinStandings(state: TournamentState, opts: RoundRobinOptions = {}): StandingRow[] {
  const points = opts.points ?? { win: 3, draw: 1, loss: 0 };
  const tiebreakers = opts.tiebreakers ?? ['h2h', 'diff', 'for'];
  const done = [...resolve(state).values()].filter((m) => m.status === 'done');

  const tally = (subset: EntrantId[], matches: ResolvedMatch[]) => {
    const rows = new Map<EntrantId, StandingRow>(
      subset.map((e) => [e, { entrant: e, rank: 0, played: 0, wins: 0, draws: 0, losses: 0, for: 0, against: 0, diff: 0, points: 0 }]),
    );
    for (const m of matches) {
      const r = m.result!;
      const a = rows.get(r.p1);
      const b = rows.get(r.p2);
      if (!a || !b) continue;
      a.played++; b.played++;
      a.for += r.score1 ?? 0; a.against += r.score2 ?? 0;
      b.for += r.score2 ?? 0; b.against += r.score1 ?? 0;
      if (r.winner === 'draw') { a.draws++; b.draws++; a.points += points.draw; b.points += points.draw; }
      else {
        const [w, l] = r.winner === 'p1' ? [a, b] : [b, a];
        w.wins++; l.losses++; w.points += points.win; l.points += points.loss;
      }
    }
    for (const row of rows.values()) row.diff = row.for - row.against;
    return rows;
  };

  const all = tally(state.entrants, done);

  // Split a tied group using tiebreakers in order. Returns groups, best first.
  const breakTie = (group: EntrantId[], tbs: Tiebreaker[]): EntrantId[][] => {
    if (group.length <= 1 || tbs.length === 0) return [group];
    const [tb, ...rest] = tbs;
    let key: (e: EntrantId) => number;
    if (tb === 'h2h') {
      const mini = tally(group, done);
      key = (e) => mini.get(e)!.points;
    } else {
      key = (e) => all.get(e)![tb];
    }
    return splitBy(group, key).flatMap((g) => breakTie(g, rest));
  };

  const ordered = splitBy(state.entrants, (e) => all.get(e)!.points).flatMap((g) => breakTie(g, tiebreakers));
  const out: StandingRow[] = [];
  let rank = 1;
  for (const g of ordered) {
    for (const e of g) out.push({ ...all.get(e)!, rank });
    rank += g.length;
  }
  return out;
}

/** Group by key, highest key first. Keeps seed order inside a group. */
function splitBy(items: EntrantId[], key: (e: EntrantId) => number): EntrantId[][] {
  const groups = new Map<number, EntrantId[]>();
  for (const e of items) {
    const k = key(e);
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  return [...groups.entries()].sort((a, b) => b[0] - a[0]).map(([, g]) => g);
}

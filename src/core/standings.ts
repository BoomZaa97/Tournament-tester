import { BYE } from './types';
import type { EntrantId, Format, ResolvedMatch, TournamentState } from './types';
import { resolve } from './resolve';
import { groupMembers } from './formats/groups';
import { finalsSize } from './formats/finals';

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
export function eliminationPlacements(state: TournamentState, among: EntrantId[] = state.entrants): Placement[] {
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

  return among
    .map((e) => {
      const lv = level.get(e);
      if (lv === undefined) return { entrant: e, place: null };
      const above = among.filter((o) => o !== e && (level.get(o) ?? Infinity) > lv).length;
      return { entrant: e, place: above + 1 };
    })
    .sort((a, b) => (a.place ?? 0) - (b.place ?? 0));
}

export type Tiebreaker =
  | 'h2h' // points in matches between the tied players only
  | 'diff' // score difference
  | 'for' // total score
  | 'wins' // number of wins
  | 'buchholz'; // total points of everyone you played (swiss: rewards a harder schedule)

export function defaultTiebreakers(format: Format): Tiebreaker[] {
  return format === 'swiss' ? ['buchholz', 'h2h', 'diff', 'for'] : ['h2h', 'diff', 'for'];
}

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
  /** Swiss byes (each counts as a win). */
  byes: number;
  /** Sum of opponents' points. */
  buchholz: number;
}

/** Standings table for swiss (same rules as round robin, byes count as wins). */
export function swissStandings(state: TournamentState, opts: RoundRobinOptions = {}): StandingRow[] {
  return roundRobinStandings(state, opts);
}

/** Matches of the points stage (not the finals). */
const isPointsMatch = (m: ResolvedMatch) => m.template.side === 'RR' || m.template.side === 'SW';

/** Points table for round robin, swiss and groups (all groups together). Finals don't count. */
export function roundRobinStandings(state: TournamentState, opts: RoundRobinOptions = {}): StandingRow[] {
  const resolved = [...resolve(state).values()].filter(isPointsMatch);
  return pointsTable(resolved, state.entrants, opts, state.structure.format);
}

/** One points table per group (groups format), by group label. */
export function groupStandings(state: TournamentState, opts: RoundRobinOptions = {}): Map<string, StandingRow[]> {
  const resolved = [...resolve(state).values()].filter(isPointsMatch);
  const out = new Map<string, StandingRow[]>();
  for (const [label, seeds] of groupMembers(state.entrants.length, state.options)) {
    const members = seeds.map((s) => state.entrants[s - 1]);
    out.set(label, pointsTable(resolved.filter((m) => m.template.group === label), members, opts, 'groups'));
  }
  return out;
}

function pointsTable(resolved: ResolvedMatch[], entrants: EntrantId[], opts: RoundRobinOptions, format: Format): StandingRow[] {
  const points = opts.points ?? { win: 3, draw: 1, loss: 0 };
  const tiebreakers = opts.tiebreakers ?? defaultTiebreakers(format);
  const done = resolved.filter((m) => m.status === 'done');
  const byes = resolved.filter((m) => m.status === 'bye' && m.template.side === 'SW' && m.winner && m.winner !== BYE);

  const tally = (subset: EntrantId[], matches: ResolvedMatch[]) => {
    const rows = new Map<EntrantId, StandingRow>(
      subset.map((e) => [
        e,
        { entrant: e, rank: 0, played: 0, wins: 0, draws: 0, losses: 0, for: 0, against: 0, diff: 0, points: 0, byes: 0, buchholz: 0 },
      ]),
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

  const all = tally(entrants, done);
  for (const m of byes) {
    const row = all.get(m.winner!);
    if (!row) continue;
    row.played++; row.wins++; row.byes++; row.points += points.win;
  }
  for (const m of done) {
    const a = all.get(m.result!.p1);
    const b = all.get(m.result!.p2);
    if (a && b) { a.buchholz += b.points; b.buchholz += a.points; }
  }

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

  const ordered = splitBy(entrants, (e) => all.get(e)!.points).flatMap((g) => breakTie(g, tiebreakers));
  const out: StandingRow[] = [];
  let rank = 1;
  for (const g of ordered) {
    for (const e of g) out.push({ ...all.get(e)!, rank });
    rank += g.length;
  }
  return out;
}

export interface FinalistSuggestion {
  /** Who would go through, in finals seed order. */
  finalists: EntrantId[];
  /** The last one in and the first one out are tied: the organizer should decide. */
  tieAtCut: boolean;
}

/**
 * Who goes on to the finals, from the points stage standings.
 * Swiss / round robin: the top N. Groups: the top N of each group, seeded by place
 * and then group (A1, B1, A2, B2, ...), so group winners don't meet early.
 */
export function suggestFinalists(state: TournamentState, opts: RoundRobinOptions = {}): FinalistSuggestion {
  const format = state.structure.format;
  const size = finalsSize(format, state.entrants.length, state.options);
  const tables = format === 'groups' ? [...groupStandings(state, opts).values()] : [roundRobinStandings(state, opts)];
  const finalists: EntrantId[] = [];
  const taken = tables.map(() => 0);
  for (let place = 0; finalists.length < size; place++) {
    let any = false;
    tables.forEach((t, i) => {
      if (finalists.length < size && t[place]) {
        finalists.push(t[place].entrant);
        taken[i]++;
        any = true;
      }
    });
    if (!any) break;
  }
  const tieAtCut = tables.some((t, i) => taken[i] > 0 && !!t[taken[i]] && t[taken[i]].rank === t[taken[i] - 1].rank);
  return { finalists, tieAtCut };
}

/**
 * Final placings for a tournament with finals: finalists by how far they got in the
 * finals (null while still in), then everyone else by the points stage (in groups:
 * by their place in the group). Null for everyone until the finals are confirmed.
 */
export function overallPlacements(state: TournamentState, opts: RoundRobinOptions = {}): Placement[] {
  const qualified = state.options?.finals?.qualified;
  if (!qualified) return state.entrants.map((entrant) => ({ entrant, place: null }));
  const finalists = qualified.map((s) => state.entrants[s - 1]).filter(Boolean);
  const inFinals = new Set(finalists);
  const top = eliminationPlacements(state, finalists);

  // Points-stage position of everyone else: rank in the table, or place in their group.
  const position = new Map<EntrantId, number>();
  if (state.structure.format === 'groups') {
    for (const table of groupStandings(state, opts).values()) table.forEach((r) => position.set(r.entrant, r.rank));
  } else {
    for (const r of roundRobinStandings(state, opts)) position.set(r.entrant, r.rank);
  }
  const rest = state.entrants.filter((e) => !inFinals.has(e));
  const others = rest
    .map((e) => ({
      entrant: e,
      place: finalists.length + 1 + rest.filter((o) => position.get(o)! < position.get(e)!).length,
    }))
    .sort((a, b) => a.place - b.place);
  return [...top, ...others];
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

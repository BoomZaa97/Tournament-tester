import { resolve } from '../../core';
import type { EntrantId } from '../../core';
import { categoryOf, divisionOf, finalPlaces, isOfficial, matchNumbers, statusOf, TIER_WEIGHT, tierOf, toState } from './model';
import type { Player, Tier, TournamentDoc } from './model';

/**
 * Rankings, worked out from the tournaments themselves (nothing extra is stored):
 *  - rating: Elo over every played match, in the order they were played. Everyone starts at 1500;
 *    beating a stronger player gains more. Forfeits, byes and walkovers don't count.
 *  - confirmed rating: the same Elo, but only over matches in official tournaments (checked by staff),
 *    so it can't be pumped up with made-up events.
 *  - points: placement points from finished tournaments, added up like a season or circuit.
 *    Majors count double, semi-majors one and a half times.
 */

export const START_RATING = 1500;
/** Fewer rated matches than this: the rating is still settling ("provisional"). */
export const PROVISIONAL = 5;

/** Points for a final place: 1st 100, 2nd 70, 3rd 50, 4th 40, top 8 25, top 16 15, anyone else 10. */
export function placementPoints(place: number): number {
  if (place <= 1) return 100;
  if (place === 2) return 70;
  if (place === 3) return 50;
  if (place === 4) return 40;
  if (place <= 8) return 25;
  if (place <= 16) return 15;
  return 10;
}

/** Placement points in an event of this size. */
export function eventPoints(place: number, tier: Tier): number {
  return Math.round(placementPoints(place) * TIER_WEIGHT[tier]);
}

/** Bigger steps while a rating is new, smaller once it has settled. */
const kFactor = (rated: number) => (rated < 10 ? 40 : 24);

export interface RankFilter {
  /** '' or unset = every game. */
  game?: string;
  /** '' or unset = every category. */
  category?: string;
  /** '' or unset = every division (Open, U18…). */
  division?: string;
  /** Only tournaments made in this year. */
  year?: number;
  /** '' or unset = every event size. */
  tier?: Tier | '';
}

export function filterTournaments(tournaments: TournamentDoc[], f: RankFilter): TournamentDoc[] {
  return tournaments.filter(
    (t) =>
      (!f.game || t.game === f.game) &&
      (!f.category || categoryOf(t) === f.category) &&
      (!f.division || divisionOf(t) === f.division) &&
      (!f.tier || tierOf(t) === f.tier) &&
      (!f.year || new Date(t.createdAt).getFullYear() === f.year),
  );
}

export interface RatingPoint {
  tournamentId: string;
  tournamentName: string;
  at: string;
  /** Rating after this tournament's matches. */
  rating: number;
}

export interface RankRow {
  player: Player;
  rating: number;
  /** Matches that counted for the rating. */
  rated: number;
  peak: number;
  /** Rating change in the player's latest tournament. */
  change: number;
  /** Elo from official tournaments only. */
  confirmed: number;
  /** Matches that counted for the confirmed rating. */
  confirmedRated: number;
  /** Confirmed rating change in the player's latest official tournament. */
  confirmedChange: number;
  /** Official tournaments played. */
  officialEvents: number;
  history: RatingPoint[];
  points: number;
  events: number;
  wins: number;
  losses: number;
  draws: number;
  titles: number;
  /** 1st, 2nd and 3rd places in finished tournaments. */
  medals: [number, number, number];
  /** Best final place (finished tournaments), null if none yet. */
  best: number | null;
  /** Wins of majors and semi-majors. */
  majorTitles: number;
  semiTitles: number;
}

interface Played {
  t: TournamentDoc;
  at: string;
  order: number;
  a: EntrantId;
  b: EntrantId;
  /** a's score: 1 win, 0 loss, ½ draw. */
  s: number;
}

/** Everyone in these tournaments with their rating, points and record. */
export function rankings(tournaments: TournamentDoc[], players: Player[]): Map<string, RankRow> {
  const known = new Map(players.map((p) => [p.id, p]));
  const out = new Map<string, RankRow>();
  const row = (id: string, fallback = id) => {
    let r = out.get(id);
    if (!r) {
      r = {
        player: known.get(id) ?? { id, name: fallback }, rating: START_RATING, rated: 0, peak: START_RATING, change: 0, history: [],
        confirmed: START_RATING, confirmedRated: 0, confirmedChange: 0, officialEvents: 0,
        points: 0, events: 0, wins: 0, losses: 0, draws: 0, titles: 0, medals: [0, 0, 0], best: null, majorTitles: 0, semiTitles: 0,
      };
      out.set(id, r);
    }
    return r;
  };

  const played: Played[] = [];
  for (const t of tournaments) {
    const official = isOfficial(t);
    for (const e of t.entrants) {
      const r = row(e.id, e.name);
      r.events++;
      if (official) r.officialEvents++;
    }
    if (t.entrants.length < 2) continue;
    const state = toState(t);
    const resolved = resolve(state);
    const numbers = matchNumbers(resolved);
    for (const m of resolved.values()) {
      if (m.status !== 'done' || !m.result) continue;
      const r = m.result;
      const a = row(r.p1);
      const b = row(r.p2);
      if (r.winner === 'draw') (a.draws++, b.draws++);
      else if (r.winner === 'p1') (a.wins++, b.losses++);
      else (b.wins++, a.losses++);
      if (r.forfeit) continue; // nobody actually played
      played.push({ t, at: r.at ?? t.createdAt, order: numbers.get(m.template.id) ?? 0, a: r.p1, b: r.p2, s: r.winner === 'draw' ? 0.5 : r.winner === 'p1' ? 1 : 0 });
    }
    if (statusOf(t) !== 'finished') continue;
    const tier = tierOf(t);
    for (const [id, place] of finalPlaces(t, state)) {
      if (place === null) continue;
      const r = row(id);
      r.points += eventPoints(place, tier);
      if (place <= 3) r.medals[place - 1]++;
      if (place === 1) {
        r.titles++;
        if (tier === 'major') r.majorTitles++;
        if (tier === 'semi') r.semiTitles++;
      }
      r.best = r.best === null ? place : Math.min(r.best, place);
    }
  }

  // Elo, in the order the matches were played
  played.sort((x, y) => x.at.localeCompare(y.at) || x.t.createdAt.localeCompare(y.t.createdAt) || x.order - y.order);
  const note = (r: RankRow, p: Played) => {
    const last = r.history[r.history.length - 1];
    if (last && last.tournamentId === p.t.id) {
      last.rating = r.rating;
      last.at = p.at;
    } else {
      r.history.push({ tournamentId: p.t.id, tournamentName: p.t.name, at: p.at, rating: r.rating });
    }
  };
  for (const p of played) {
    const a = out.get(p.a)!;
    const b = out.get(p.b)!;
    const expected = 1 / (1 + 10 ** ((b.rating - a.rating) / 400));
    const da = kFactor(a.rated) * (p.s - expected);
    const db = kFactor(b.rated) * (1 - p.s - (1 - expected));
    a.rating += da;
    b.rating += db;
    a.rated++;
    b.rated++;
    for (const r of [a, b]) {
      r.peak = Math.max(r.peak, r.rating);
      note(r, p);
    }
  }
  // confirmed rating: the same, over official tournaments only
  const last = new Map<string, { t: string; before: number }>();
  for (const p of played) {
    if (!isOfficial(p.t)) continue;
    const a = out.get(p.a)!;
    const b = out.get(p.b)!;
    for (const r of [a, b]) {
      const l = last.get(r.player.id);
      if (!l || l.t !== p.t.id) last.set(r.player.id, { t: p.t.id, before: r.confirmed });
    }
    const expected = 1 / (1 + 10 ** ((b.confirmed - a.confirmed) / 400));
    const da = kFactor(a.confirmedRated) * (p.s - expected);
    const db = kFactor(b.confirmedRated) * (1 - p.s - (1 - expected));
    a.confirmed += da;
    b.confirmed += db;
    a.confirmedRated++;
    b.confirmedRated++;
  }
  for (const [id, l] of last) {
    const r = out.get(id)!;
    r.confirmedChange = r.confirmed - l.before;
  }
  for (const r of out.values()) {
    const h = r.history;
    r.change = h.length ? h[h.length - 1].rating - (h.length > 1 ? h[h.length - 2].rating : START_RATING) : 0;
  }
  return out;
}

export type RankBy = 'rating' | 'confirmed' | 'points';

/** A row for a player who hasn't played (in this scope) yet. */
export function emptyRow(player: Player): RankRow {
  return {
    player, rating: START_RATING, rated: 0, peak: START_RATING, change: 0, history: [], confirmed: START_RATING, confirmedRated: 0,
    confirmedChange: 0, officialEvents: 0, points: 0, events: 0, wins: 0, losses: 0, draws: 0, titles: 0, medals: [0, 0, 0], best: null,
    majorTitles: 0, semiTitles: 0,
  };
}

export interface Ranked extends RankRow {
  /** Place in the ranking (ties share it); null while the rating is provisional (rating rankings) or without points. */
  rank: number | null;
}

/**
 * Sorted for a ranking table. By rating, players with fewer than PROVISIONAL rated matches come
 * last without a rank; by points, only people with points are ranked.
 */
export function ranked(rows: Iterable<RankRow>, by: RankBy): Ranked[] {
  const list = [...rows];
  const counts = (r: RankRow) => (by === 'rating' ? r.rated >= PROVISIONAL : by === 'confirmed' ? r.confirmedRated >= PROVISIONAL : r.points > 0);
  const value = (r: RankRow) => (by === 'rating' ? Math.round(r.rating) : by === 'confirmed' ? Math.round(r.confirmed) : r.points);
  list.sort(
    (x, y) =>
      Number(counts(y)) - Number(counts(x)) ||
      value(y) - value(x) ||
      (by === 'rating' ? y.points - x.points : Math.round(y.rating) - Math.round(x.rating)) ||
      y.titles - x.titles ||
      x.player.name.localeCompare(y.player.name),
  );
  const out: Ranked[] = [];
  list.forEach((r, i) => {
    const prev = out[i - 1];
    const rank = !counts(r) ? null : prev && prev.rank !== null && value(prev) === value(r) ? prev.rank : i + 1;
    out.push({ ...r, rank });
  });
  return out;
}

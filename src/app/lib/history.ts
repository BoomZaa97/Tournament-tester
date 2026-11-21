import { gameOf } from './games';
import { resolve } from '../../core';
import type { EntrantId } from '../../core';
import { categoryOf, divisionOf, finalPlaces, isOfficial, matchNumbers, OPEN, roundName, statusOf, tierOf, toState } from './model';
import type { Player, Tier, TournamentDoc } from './model';
import { eventPoints } from './ranking';

export interface HistoryMatch {
  tournamentId: string;
  tournamentName: string;
  game: string;
  matchNo: number;
  round: string;
  opponent: EntrantId;
  outcome: 'W' | 'L' | 'D';
  /** Score from this player's point of view, e.g. "2–1". */
  score: string;
  forfeit: boolean;
  at: string;
}

export interface PlayerStats {
  player: Player;
  matches: HistoryMatch[];
  wins: number;
  losses: number;
  draws: number;
  tournaments: {
    id: string; name: string; game: string; category: string;
    /** '' for Open. */
    division: string;
    tier: Tier; official: boolean; place: number | null; finished: boolean; at: string;
    /** Ranking points earned (finished tournaments). */
    points: number;
    entrants: number;
  }[];
  titles: number;
}

/** Every player's full record, computed from all tournaments. Nothing extra is stored. */
export function buildHistory(tournaments: TournamentDoc[], players: Player[]): Map<string, PlayerStats> {
  const known = new Map(players.map((p) => [p.id, p]));
  const out = new Map<string, PlayerStats>();
  const get = (id: string, fallback: string) => {
    let s = out.get(id);
    if (!s) {
      s = { player: known.get(id) ?? { id, name: fallback }, matches: [], wins: 0, losses: 0, draws: 0, tournaments: [], titles: 0 };
      out.set(id, s);
    }
    return s;
  };

  for (const t of tournaments) {
    if (t.entrants.length < 2) continue;
    const state = toState(t);
    const resolved = resolve(state);
    const numbers = matchNumbers(resolved);
    const finished = statusOf(t) === 'finished';
    const places = finalPlaces(t, state);

    for (const e of t.entrants) {
      const s = get(e.id, e.name);
      const place = places.get(e.id) ?? null;
      const tier = tierOf(t);
      s.tournaments.push({
        id: t.id, name: t.name, game: gameOf(t), category: categoryOf(t), division: divisionOf(t) === OPEN ? '' : divisionOf(t), tier, official: isOfficial(t), place, finished, at: t.createdAt,
        points: finished && place ? eventPoints(place, tier) : 0, entrants: t.entrants.length,
      });
      if (place === 1 && finished) s.titles++;
    }

    for (const m of resolved.values()) {
      if (m.status !== 'done' || !m.result) continue;
      const r = m.result;
      for (const side of ['p1', 'p2'] as const) {
        const me = r[side];
        const other = side === 'p1' ? r.p2 : r.p1;
        const outcome = r.winner === 'draw' ? 'D' : r.winner === side ? 'W' : 'L';
        const mine = side === 'p1' ? r.score1 : r.score2;
        const theirs = side === 'p1' ? r.score2 : r.score1;
        const s = get(me, me);
        s.matches.push({
          tournamentId: t.id,
          tournamentName: t.name,
          game: gameOf(t),
          matchNo: numbers.get(m.template.id) ?? 0,
          round: roundName(m.template, state.structure.matches, t.format),
          opponent: other,
          outcome,
          score: r.forfeit ? 'FF' : mine !== undefined ? `${mine}–${theirs ?? 0}` : '',
          forfeit: !!r.forfeit,
          at: r.at ?? t.createdAt,
        });
        if (outcome === 'W') s.wins++;
        else if (outcome === 'L') s.losses++;
        else s.draws++;
      }
    }
  }
  for (const s of out.values()) {
    s.matches.sort((a, b) => b.at.localeCompare(a.at));
    s.tournaments.sort((a, b) => b.at.localeCompare(a.at));
  }
  return out;
}

/** One game's part of a player's record (matches, tournaments, titles). */
export function statsForGame(s: PlayerStats, game: string): PlayerStats {
  const matches = s.matches.filter((m) => m.game === game);
  const tournaments = s.tournaments.filter((t) => t.game === game);
  return {
    player: s.player,
    matches,
    tournaments,
    wins: matches.filter((m) => m.outcome === 'W').length,
    losses: matches.filter((m) => m.outcome === 'L').length,
    draws: matches.filter((m) => m.outcome === 'D').length,
    titles: tournaments.filter((t) => t.finished && t.place === 1).length,
  };
}

export interface GameLine {
  game: string;
  events: number;
  wins: number;
  losses: number;
  draws: number;
  titles: number;
  /** Best finishing place in a finished tournament. */
  best: number | null;
  points: number;
  /** When they last played it. */
  last: string;
}

/** A player's record split by game, most played first. */
export function byGame(s: PlayerStats): GameLine[] {
  const games = [...new Set(s.tournaments.map((t) => t.game))];
  return games
    .map((game) => {
      const g = statsForGame(s, game);
      const places = g.tournaments.filter((t) => t.finished && t.place).map((t) => t.place!);
      const dates = [...g.tournaments.map((t) => t.at), ...g.matches.map((m) => m.at)].sort();
      return {
        game,
        events: g.tournaments.length,
        wins: g.wins,
        losses: g.losses,
        draws: g.draws,
        titles: g.titles,
        best: places.length ? Math.min(...places) : null,
        points: g.tournaments.reduce((n, t) => n + t.points, 0),
        last: dates[dates.length - 1] ?? '',
      };
    })
    .sort((a, b) => b.events - a.events || b.wins + b.losses + b.draws - (a.wins + a.losses + a.draws) || a.game.localeCompare(b.game));
}

export function winRate(s: Pick<PlayerStats, 'wins' | 'losses' | 'draws'>): string {
  const n = s.wins + s.losses + s.draws;
  return n ? `${Math.round(((s.wins + s.draws / 2) / n) * 100)}%` : '–';
}

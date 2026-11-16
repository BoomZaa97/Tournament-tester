import { eliminationPlacements, resolve, roundRobinStandings } from '../../core';
import type { EntrantId } from '../../core';
import { matchNumbers, roundName, statusOf, toState } from './model';
import type { Player, TournamentDoc } from './model';

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
  tournaments: { id: string; name: string; game: string; place: number | null; finished: boolean; at: string }[];
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
    const places = new Map<string, number | null>(
      t.format === 'round_robin'
        ? roundRobinStandings(state, t.scoring).map((r) => [r.entrant, finished ? r.rank : null])
        : eliminationPlacements(state).map((p) => [p.entrant, p.place]),
    );

    for (const e of t.entrants) {
      const s = get(e.id, e.name);
      const place = places.get(e.id) ?? null;
      s.tournaments.push({ id: t.id, name: t.name, game: t.game, place, finished, at: t.createdAt });
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
          game: t.game,
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

export function winRate(s: Pick<PlayerStats, 'wins' | 'losses' | 'draws'>): string {
  const n = s.wins + s.losses + s.draws;
  return n ? `${Math.round(((s.wins + s.draws / 2) / n) * 100)}%` : '–';
}

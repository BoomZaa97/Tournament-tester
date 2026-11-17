import { createTournament, resolve } from '../../core';
import type { EntrantId, Format, FormatOptions, MatchResult, SwissPair } from '../../core';
import type { Player } from './model';
import { nameKey, rowsToPlayers } from './players';

/**
 * Turning a Challonge tournament (API v1 JSON, fetched by the Google script) into one of ours.
 * Players come in Challonge's seed order. Results are matched by who played: elimination and
 * round robin replay the bracket and take each match from Challonge as soon as the same two players
 * meet here; Swiss keeps Challonge's own pairings (frozen, like any Swiss round that has started).
 * Anything that can't be placed is listed in `skipped`, never guessed.
 */

export interface ChParticipant {
  id: number;
  name?: string | null;
  display_name?: string | null;
  seed?: number | null;
}
export interface ChMatch {
  id: number;
  round: number;
  player1_id: number | null;
  player2_id: number | null;
  winner_id: number | null;
  scores_csv?: string | null;
  state: string;
  forfeited?: boolean | null;
  completed_at?: string | null;
  updated_at?: string | null;
  group_id?: number | null;
}
export interface ChTournament {
  name: string;
  tournament_type: string;
  game_name?: string | null;
  hold_third_place_match?: boolean | null;
  grand_finals_modifier?: string | null;
  swiss_rounds?: number | null;
  group_stages_enabled?: boolean | null;
  created_at?: string | null;
  started_at?: string | null;
  participants?: ({ participant: ChParticipant } | ChParticipant)[];
  matches?: ({ match: ChMatch } | ChMatch)[];
}

export interface Imported {
  name: string;
  game: string;
  format: Format;
  options: FormatOptions;
  /** Seed order. */
  entrants: Player[];
  /** Players that are new to this site. */
  created: Player[];
  results: Record<string, MatchResult>;
  /** Finished Challonge matches that were placed. */
  imported: number;
  /** Finished Challonge matches that couldn't be placed, as "A vs B (2–1)". */
  skipped: string[];
  /** Anything the organizer should know (unsupported parts). */
  notes: string[];
}

const unwrap = <T>(x: T | Record<string, T>, key: string): T => ((x as Record<string, T>)[key] ?? x) as T;

/** Challonge "3-1" or sets "3-1,1-3,3-2" → [player1, player2]: the score, or sets won. */
export function parseScores(csv: string | null | undefined): [number, number] | null {
  const sets = String(csv ?? '')
    .split(',')
    .map((s) => s.trim().match(/^(-?\d+)-(-?\d+)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => [Number(m[1]), Number(m[2])] as [number, number]);
  if (!sets.length) return null;
  if (sets.length === 1) return sets[0];
  return sets.reduce<[number, number]>((acc, [a, b]) => [acc[0] + (a > b ? 1 : 0), acc[1] + (b > a ? 1 : 0)], [0, 0]);
}

const FORMATS: Record<string, Format> = {
  'single elimination': 'single_elim',
  'double elimination': 'double_elim',
  'round robin': 'round_robin',
  swiss: 'swiss',
};

export function fromChallonge(t: ChTournament, known: Player[]): Imported {
  const notes: string[] = [];
  const parts = (t.participants ?? []).map((p) => unwrap<ChParticipant>(p, 'participant'));
  parts.sort((a, b) => (a.seed ?? 1e9) - (b.seed ?? 1e9) || a.id - b.id);

  // names must be unique here (two "Alex" would become one player)
  const seen = new Map<string, number>();
  const rows = parts.map((p) => {
    let name = String(p.display_name || p.name || `Player ${p.id}`).replace(/\s+/g, ' ').trim();
    const k = nameKey(name);
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    if (n > 1) name = `${name} (${n})`;
    return { key: String(p.id), name };
  });
  const { entrants, created } = rowsToPlayers(rows, known);
  const idOf = new Map<number, EntrantId>(parts.map((p, i) => [p.id, entrants[i].id]));
  const nameOf = new Map<number, string>(parts.map((p, i) => [p.id, entrants[i].name]));

  const type = String(t.tournament_type ?? '').toLowerCase();
  let format = FORMATS[type];
  const options: FormatOptions = {};
  if (!format) {
    format = 'single_elim';
    notes.push(`Challonge's "${t.tournament_type}" format isn't available here: only the players were imported, as single elimination. Change the format in the Edit tab.`);
  }
  if (format === 'single_elim' && t.hold_third_place_match) options.thirdPlaceMatch = true;
  if (format === 'double_elim') {
    const gf = String(t.grand_finals_modifier ?? '');
    if (gf === 'single match') options.grandFinal = 'single';
    if (gf === 'skip') {
      options.grandFinal = 'single';
      notes.push('Challonge skipped the grand final; here the grand final is one match.');
    }
  }

  const all = (t.matches ?? []).map((m) => unwrap<ChMatch>(m, 'match'));
  if (t.group_stages_enabled) notes.push("Challonge's group stage isn't imported: only the final stage's matches are.");
  const playable = all.filter((m) => !m.group_id);
  const done = playable
    .filter((m) => m.state === 'complete' && m.player1_id && m.player2_id && idOf.has(m.player1_id) && idOf.has(m.player2_id))
    .sort((a, b) => a.id - b.id);
  const label = (m: ChMatch) => {
    const s = parseScores(m.scores_csv);
    return `${nameOf.get(m.player1_id!) ?? '?'} vs ${nameOf.get(m.player2_id!) ?? '?'}${s ? ` (${s[0]}–${s[1]})` : ''}`;
  };

  /** Challonge's match as our result, with `p1` / `p2` being who is p1 / p2 in our match. */
  const toResult = (m: ChMatch, p1: EntrantId): MatchResult | null => {
    const a = idOf.get(m.player1_id!)!;
    const b = idOf.get(m.player2_id!)!;
    const flipped = a !== p1;
    const s = parseScores(m.scores_csv);
    const [s1, s2] = s ? (flipped ? [s[1], s[0]] : s) : [undefined, undefined];
    let winner: MatchResult['winner'];
    if (m.winner_id) winner = idOf.get(m.winner_id) === (flipped ? b : a) ? 'p1' : 'p2';
    else if (s && s[0] === s[1]) winner = 'draw';
    else return null;
    const at = m.completed_at || m.updated_at || undefined;
    return {
      winner,
      ...(s1 !== undefined ? { score1: s1, score2: s2 } : {}),
      ...(m.forfeited ? { forfeit: true } : {}),
      p1: flipped ? b : a,
      p2: flipped ? a : b,
      ...(at ? { at: new Date(at).toISOString() } : {}),
    };
  };

  const ids = entrants.map((e) => e.id);
  let results: Record<string, MatchResult> = {};
  const used = new Set<number>();
  if (FORMATS[type]) {
    if (format === 'swiss') {
      // Challonge's own pairings, round by round (by seed; 0 = bye)
      const seedOf = new Map<number, number>(parts.map((p, i) => [p.id, i + 1]));
      const lastRound = Math.max(0, ...playable.map((m) => m.round));
      options.swissRounds = Math.max(lastRound, t.swiss_rounds ?? 0) || undefined;
      const pairings: (SwissPair[] | null)[] = [];
      for (let r = 1; r <= lastRound; r++) {
        const inRound = playable.filter((m) => m.round === r && m.player1_id && m.player2_id).sort((a, b) => a.id - b.id);
        if (!inRound.some((m) => done.includes(m))) {
          pairings.push(null); // not started: paired here from the standings
          continue;
        }
        const pairs: SwissPair[] = inRound.map((m) => [seedOf.get(m.player1_id!) ?? 0, seedOf.get(m.player2_id!) ?? 0]);
        const playing = new Set(pairs.flat());
        for (let s = 1; s <= parts.length; s++) if (!playing.has(s)) pairs.push([s, 0]);
        pairings.push(pairs);
        inRound.forEach((m, i) => {
          if (!done.includes(m)) return;
          const r1 = toResult(m, idOf.get(m.player1_id!)!);
          if (!r1) return;
          results[`S${r}-${i + 1}`] = r1;
          used.add(m.id);
        });
      }
      while (pairings.length && pairings[pairings.length - 1] === null) pairings.pop();
      if (pairings.length) options.swissPairings = pairings;
    } else {
      if (format === 'round_robin') {
        const count = new Map<string, number>();
        for (const m of done) {
          const k = [m.player1_id, m.player2_id].sort().join('|');
          count.set(k, (count.get(k) ?? 0) + 1);
        }
        if ([...count.values()].some((n) => n > 1)) options.doubleRound = true;
      }
      // replay: whenever two players meet here, take their next unused match from Challonge
      for (let pass = 0; pass < 500; pass++) {
        const resolved = resolve({ ...createTournament(format, ids, options), results });
        let progress = false;
        for (const m of resolved.values()) {
          if (m.status !== 'ready' || typeof m.p1 !== 'string' || typeof m.p2 !== 'string') continue;
          const pair = new Set([m.p1, m.p2]);
          const c = done.find((x) => !used.has(x.id) && pair.has(idOf.get(x.player1_id!)!) && pair.has(idOf.get(x.player2_id!)!));
          if (!c) continue;
          const r1 = toResult(c, m.p1);
          if (!r1 || (r1.winner === 'draw' && format !== 'round_robin')) continue;
          used.add(c.id);
          results = { ...results, [m.template.id]: r1 };
          progress = true;
        }
        if (!progress) break;
      }
    }
  }

  return {
    name: String(t.name ?? '').trim() || 'Imported tournament',
    game: String(t.game_name ?? '').trim(),
    format,
    options,
    entrants,
    created,
    results,
    imported: used.size,
    skipped: done.filter((m) => !used.has(m.id)).map(label),
    notes,
  };
}

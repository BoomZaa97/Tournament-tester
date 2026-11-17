import { resolve } from '../../core';
import type { MatchResult } from '../../core';
import { championOf, matchNumbers, nameMap, roundName, toState } from './model';
import type { Player, TournamentDoc } from './model';

/** At most this many result lines in one message (a big batch edit shouldn't flood the channel). */
const MAX_RESULTS = 6;

/** A result everyone can rely on: entered by the organizer, or confirmed by the opponent. */
const settled = (r: MatchResult | undefined) => !!r && (!r.status || r.status === 'confirmed');

function scoreLine(r: MatchResult, names: Map<string, string>): string {
  const a = names.get(r.p1) ?? '?';
  const b = names.get(r.p2) ?? '?';
  if (r.winner === 'draw') return r.score1 === undefined ? `${a} drew with ${b}` : `${a} ${r.score1}–${r.score2} ${b} (draw)`;
  const won = r.winner === 'p1' ? a : b;
  const lost = r.winner === 'p1' ? b : a;
  if (r.forfeit) return `**${won}** wins by forfeit vs ${lost}`;
  if (r.score1 === undefined || r.score2 === undefined) return `**${won}** beat ${lost}`;
  const [w, l] = r.winner === 'p1' ? [r.score1, r.score2] : [r.score2, r.score1];
  return `**${won}** ${w}–${l} ${lost}`;
}

/**
 * What to post to the tournament's Discord channel for a change from `prev` to `next`: started,
 * newly settled results (with the round), finals started, champion. Empty = nothing worth posting.
 * The Google script only adds the channel; it never sees the bracket, so the lines are made here.
 */
export function announcements(prev: TournamentDoc, next: TournamentDoc, link: string, players: Player[] = []): string[] {
  if (next.entrants.length < 2) return [];
  const names = nameMap(next, players);
  const lines: string[] = [];
  const before = Object.keys(prev.results).length;
  const after = Object.keys(next.results).length;
  if (before === 0 && after > 0) lines.push('Started.');

  const state = toState(next);
  const resolved = resolve(state);
  const numbers = matchNumbers(resolved);
  const results: { line: string; no: number }[] = [];
  for (const [id, r] of Object.entries(next.results)) {
    if (!settled(r)) continue;
    const old = prev.results[id];
    const same =
      settled(old) && old!.winner === r.winner && old!.score1 === r.score1 && old!.score2 === r.score2 && old!.p1 === r.p1 && old!.p2 === r.p2;
    if (same) continue;
    const m = resolved.get(id);
    const round = m ? roundName(m.template, state.structure.matches, next.format) : '';
    results.push({ line: scoreLine(r, names) + (round ? ` · ${round}` : ''), no: numbers.get(id) ?? 0 });
  }
  const sorted = results.sort((x, y) => x.no - y.no);
  for (const r of sorted.slice(0, MAX_RESULTS)) lines.push(r.line);
  if (sorted.length > MAX_RESULTS) lines.push(`…and ${sorted.length - MAX_RESULTS} more results`);

  const q = next.options.finals?.qualified;
  if (q?.length && !prev.options.finals?.qualified?.length) {
    lines.push(`Finals: ${q.map((s) => names.get(next.entrants[s - 1]?.id) ?? '?').join(', ')}`);
  }
  const champ = championOf(next, state);
  if (champ && champ !== championOf(prev, toState(prev))) lines.push(`Champion: **${names.get(champ) ?? '?'}**`);

  if (!lines.length) return [];
  return [`**${next.name || 'Tournament'}**`, ...lines, `<${link}>`];
}

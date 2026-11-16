import type { Format, FormatOptions, MatchTemplate, Source, Structure } from '../types';
import { doubleElimination, singleElimination } from './elimination';
import { groupMembers } from './groups';

/**
 * Finals ("top cut"): after a points stage (swiss, round robin, groups), the best
 * players play a knockout bracket. It is a normal single/double elimination bracket
 * whose ids start with `F-` and whose seeds come from `options.finals.qualified`
 * (set when the organizer confirms who went through), via `{type:'qualified'}` sources.
 */

export const FINALS_PREFIX = 'F-';

export function isFinalsMatch(t: Pick<MatchTemplate, 'id'>): boolean {
  return t.id.startsWith(FINALS_PREFIX);
}

/** Formats with a points table, which can be followed by finals. */
export function hasPointsStage(format: Format): boolean {
  return format === 'round_robin' || format === 'swiss' || format === 'groups';
}

/** How many players play the finals (0 = no finals). */
export function finalsSize(format: Format, n: number, opts: FormatOptions = {}): number {
  if (!opts.finals || !hasPointsStage(format) || n < 2) return 0;
  const advance = Math.max(1, Math.round(opts.finals.advance || 0));
  const total =
    format === 'groups'
      ? [...groupMembers(n, opts).values()].reduce((sum, g) => sum + Math.min(advance, g.length), 0)
      : advance;
  return Math.min(n, Math.max(2, total));
}

/** The stage-1 structure with the finals bracket added after it. */
export function withFinals(stage1: Structure, opts: FormatOptions): Structure {
  const size = finalsSize(stage1.format, stage1.entrantCount, opts);
  if (!size) return stage1;
  const f = opts.finals!;
  const bracket =
    f.format === 'double_elim'
      ? doubleElimination(size, { grandFinal: f.grandFinal })
      : singleElimination(size, { thirdPlaceMatch: f.thirdPlaceMatch });
  const id = (x: string) => FINALS_PREFIX + x;
  const src = (s: Source): Source => {
    switch (s.type) {
      case 'seed':
        return { type: 'qualified', seed: s.seed };
      case 'winner':
      case 'loser':
        return { type: s.type, match: id(s.match) };
      default:
        return s;
    }
  };
  const finals = bracket.matches.map(
    (m): MatchTemplate => ({
      ...m,
      id: id(m.id),
      p1: src(m.p1),
      p2: src(m.p2),
      ...(m.onlyIf && { onlyIf: { ...m.onlyIf, match: id(m.onlyIf.match) } }),
    }),
  );
  return { ...stage1, matches: [...stage1.matches, ...finals] };
}

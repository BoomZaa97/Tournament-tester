import type { FormatOptions, MatchTemplate, Structure } from '../types';
import { roundRobin } from './roundRobin';

/**
 * Groups: players are split into round-robin groups (A, B, C, ...), usually followed
 * by a knockout final for the best of each group (see `finals.ts`).
 *
 * Seeds are dealt out like cards, snaking back and forth (A gets 1, B 2, C 3, then
 * C 4, B 5, A 6, ...), so every group gets a fair mix of strong and weak seeds.
 */

export const GROUP_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Most groups possible: every group needs at least 2 players. */
export function maxGroups(n: number): number {
  return Math.max(1, Math.min(GROUP_LABELS.length, Math.floor(n / 2)));
}

/** Default: groups of about 4. */
export function defaultGroupCount(n: number): number {
  return Math.max(1, Math.round(n / 4));
}

export function groupCount(n: number, opts: FormatOptions = {}): number {
  const want = Math.round(opts.groupCount ?? defaultGroupCount(n));
  return Math.min(Math.max(1, want), maxGroups(n));
}

/** Seeds (1-based) in each group, by group label, best seed first. */
export function groupMembers(n: number, opts: FormatOptions = {}): Map<string, number[]> {
  const g = groupCount(n, opts);
  const out = new Map<string, number[]>();
  for (let i = 0; i < g; i++) out.set(GROUP_LABELS[i], []);
  for (let s = 1; s <= n; s++) {
    const pass = Math.floor((s - 1) / g);
    const pos = (s - 1) % g;
    out.get(GROUP_LABELS[pass % 2 === 0 ? pos : g - 1 - pos])!.push(s);
  }
  return out;
}

export function groups(n: number, opts: FormatOptions = {}): Structure {
  if (n < 2) throw new Error('Need at least 2 entrants');
  const matches: MatchTemplate[] = [];
  for (const [label, seeds] of groupMembers(n, opts)) {
    for (const m of roundRobin(seeds.length, opts).matches) {
      const global = (src: MatchTemplate['p1']) => (src.type === 'seed' ? { type: 'seed' as const, seed: seeds[src.seed - 1] } : src);
      matches.push({ ...m, id: `${label}-${m.id}`, group: label, p1: global(m.p1), p2: global(m.p2) });
    }
  }
  return { format: 'groups', entrantCount: n, matches };
}

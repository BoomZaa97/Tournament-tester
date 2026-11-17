import { newId } from './model';
import type { Player, Row } from './model';

/**
 * Turn editor rows into players. A name that matches a known player (ignoring
 * case) reuses that player's id, so their history carries across tournaments.
 * Returns the entrants in seed order and any brand-new players to save.
 */
/** Names compare without case or extra spaces (like the Google script): "Pha", " pha " and "PHA" are one name. */
export function nameKey(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function rowsToPlayers(rows: Row[], known: Player[]): { entrants: Player[]; created: Player[] } {
  const byName = new Map(known.map((p) => [nameKey(p.name), p]));
  const created: Player[] = [];
  const entrants = rows
    .filter((r) => r.name.trim())
    .map((r) => {
      const name = r.name.replace(/\s+/g, ' ').trim();
      const key = nameKey(name);
      let p = byName.get(key);
      if (!p) {
        p = { id: newId(), name };
        byName.set(key, p);
        created.push(p);
      }
      return p;
    });
  return { entrants, created };
}

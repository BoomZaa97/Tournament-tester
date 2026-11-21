import { describe, expect, it } from 'vitest';
import { canonicalGame, categoryForGame, GAMES, gameKey, gameOf, usedGames } from '../src/app/lib/games';
import { filterTournaments } from '../src/app/lib/ranking';
import { emptyDoc } from '../src/app/lib/model';

describe('games', () => {
  it('writes one game one way: names and aliases, any case, spacing or punctuation', () => {
    for (const raw of ['CS2', 'cs2', ' CS 2 ', 'Counter-Strike 2', 'counter strike 2', 'CSGO', 'cs:go']) {
      expect(canonicalGame(raw)).toBe('CS2');
    }
    expect(canonicalGame('mlbb')).toBe('Mobile Legends');
    expect(canonicalGame('arena of valor')).toBe('RoV');
    expect(canonicalGame('Liên Quân')).toBe('RoV');
    expect(canonicalGame('ping-pong')).toBe('Table tennis');
    expect(canonicalGame('pokemon tcg')).toBe('Pokémon TCG');
  });

  it('keeps other games as typed (tidied), joining a spelling already used on the site', () => {
    expect(canonicalGame('  Beat   Saber ')).toBe('Beat Saber');
    expect(canonicalGame('beat saber', ['Beat Saber'])).toBe('Beat Saber');
    expect(canonicalGame('เกมใหม่ 1', ['เกมใหม่1'])).toBe('เกมใหม่1');
    expect(canonicalGame('x'.repeat(60))).toHaveLength(40);
    expect(canonicalGame('')).toBe('');
    expect(canonicalGame('   ')).toBe('');
  });

  it('every listed name and alias points at exactly one game', () => {
    const seen = new Map<string, string>();
    for (const g of GAMES) {
      for (const n of [g.name, ...(g.aliases ?? [])]) {
        const k = gameKey(n);
        expect(seen.get(k) ?? g.name, `${n} is used by two games`).toBe(g.name);
        seen.set(k, g.name);
      }
    }
  });

  it('suggests a category for listed games only', () => {
    expect(categoryForGame('CS2')).toBe('Esports');
    expect(categoryForGame('Badminton')).toBe('Sports');
    expect(categoryForGame('Chess')).toBe('Board games');
    expect(categoryForGame('Magic: The Gathering')).toBe('Card games');
    expect(categoryForGame('Beat Saber')).toBe('');
  });

  it('old tournaments typed differently share one ranking and one count', () => {
    const t = (id: string, game: string) => ({ ...emptyDoc(), id, game });
    const all = [t('a', 'cs2'), t('b', 'Counter-Strike 2'), t('c', 'CS2'), t('d', 'Valorant'), t('e', '')];
    expect(all.map(gameOf)).toEqual(['CS2', 'CS2', 'CS2', 'Valorant', '']);
    expect(filterTournaments(all, { game: 'CS2' }).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(usedGames(all)).toEqual(['CS2', 'Valorant']);
  });
});

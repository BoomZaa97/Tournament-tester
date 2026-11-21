/**
 * Games: rankings are kept per game, so one game must always be written the same way
 * ("cs2", "CS 2" and "Counter-Strike 2" are all CS2). New tournaments pick from GAMES or type
 * another game; `gameOf` reads any stored name (old ones too) as the name used everywhere.
 */

export type GameGroup = 'Esports' | 'Sports' | 'Board & card games';

export interface GameInfo {
  name: string;
  group: GameGroup;
  /** Other ways people write it (compared by `gameKey`). */
  aliases?: string[];
}

export const GAMES: GameInfo[] = [
  { name: 'CS2', group: 'Esports', aliases: ['Counter-Strike 2', 'Counter Strike', 'CS', 'CSGO', 'CS:GO', 'Counter-Strike: Global Offensive'] },
  { name: 'Valorant', group: 'Esports', aliases: ['Valo', 'VLR'] },
  { name: 'League of Legends', group: 'Esports', aliases: ['LoL', 'League'] },
  { name: 'Dota 2', group: 'Esports', aliases: ['Dota'] },
  { name: 'RoV', group: 'Esports', aliases: ['Arena of Valor', 'AoV', 'Realm of Valor', 'Liên Quân'] },
  { name: 'Mobile Legends', group: 'Esports', aliases: ['MLBB', 'Mobile Legends: Bang Bang', 'ML'] },
  { name: 'Honor of Kings', group: 'Esports', aliases: ['HoK'] },
  { name: 'PUBG Mobile', group: 'Esports', aliases: ['PUBGM', 'PUBG M'] },
  { name: 'PUBG', group: 'Esports', aliases: ['PUBG Battlegrounds', 'Battlegrounds'] },
  { name: 'Free Fire', group: 'Esports', aliases: ['Garena Free Fire', 'FF'] },
  { name: 'Call of Duty: Mobile', group: 'Esports', aliases: ['CODM', 'COD Mobile'] },
  { name: 'Fortnite', group: 'Esports' },
  { name: 'Apex Legends', group: 'Esports', aliases: ['Apex'] },
  { name: 'Overwatch 2', group: 'Esports', aliases: ['Overwatch', 'OW', 'OW2'] },
  { name: 'Marvel Rivals', group: 'Esports' },
  { name: 'Rainbow Six Siege', group: 'Esports', aliases: ['R6', 'R6S', 'Rainbow Six', 'Rainbow 6'] },
  { name: 'Rocket League', group: 'Esports', aliases: ['RL'] },
  { name: 'EA Sports FC', group: 'Esports', aliases: ['EA FC', 'FC 24', 'FC 25', 'FC 26', 'FIFA'] },
  { name: 'eFootball', group: 'Esports', aliases: ['PES', 'Pro Evolution Soccer'] },
  { name: 'Street Fighter 6', group: 'Esports', aliases: ['SF6', 'Street Fighter'] },
  { name: 'Tekken 8', group: 'Esports', aliases: ['T8', 'Tekken'] },
  { name: 'Super Smash Bros. Ultimate', group: 'Esports', aliases: ['Smash', 'Smash Ultimate', 'SSBU'] },
  { name: 'Teamfight Tactics', group: 'Esports', aliases: ['TFT'] },
  { name: 'Clash Royale', group: 'Esports', aliases: ['CR'] },
  { name: 'Brawl Stars', group: 'Esports' },
  { name: 'Hearthstone', group: 'Esports', aliases: ['HS'] },
  { name: 'Minecraft', group: 'Esports' },
  { name: 'Football', group: 'Sports', aliases: ['Soccer'] },
  { name: 'Futsal', group: 'Sports' },
  { name: 'Basketball', group: 'Sports' },
  { name: 'Volleyball', group: 'Sports' },
  { name: 'Badminton', group: 'Sports' },
  { name: 'Table tennis', group: 'Sports', aliases: ['Ping pong', 'Ping-pong'] },
  { name: 'Tennis', group: 'Sports' },
  { name: 'Pool', group: 'Sports', aliases: ['Billiards', '8-ball', '8 ball', 'Snooker'] },
  { name: 'Darts', group: 'Sports' },
  { name: 'Sepak takraw', group: 'Sports', aliases: ['Takraw'] },
  { name: 'Chess', group: 'Board & card games' },
  { name: 'Go', group: 'Board & card games', aliases: ['Baduk', 'Weiqi'] },
  { name: 'Magic: The Gathering', group: 'Board & card games', aliases: ['MTG', 'Magic'] },
  { name: 'Pokémon TCG', group: 'Board & card games', aliases: ['Pokemon TCG', 'PTCG'] },
  { name: 'Yu-Gi-Oh!', group: 'Board & card games', aliases: ['Yugioh', 'YGO'] },
];

export const GAME_GROUPS: GameGroup[] = ['Esports', 'Sports', 'Board & card games'];

/** Compare key: case, spaces and punctuation ignored (letters of any script are kept). */
export function gameKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

const BY_KEY = new Map<string, GameInfo>();
for (const g of GAMES) {
  BY_KEY.set(gameKey(g.name), g);
  for (const a of g.aliases ?? []) BY_KEY.set(gameKey(a), g);
}

/** The game in the list for this name or alias, if any. */
export function knownGame(name: string): GameInfo | undefined {
  return BY_KEY.get(gameKey(name));
}

/** Spaces tidied, max 40 characters. */
export function cleanGame(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 40);
}

/**
 * The name to store and show: the list's name for a known game or alias, else a game already used
 * on the site written another way (`used`), else the name as typed (tidied).
 */
export function canonicalGame(raw: string, used: string[] = []): string {
  const name = cleanGame(raw);
  if (!name) return '';
  const k = gameKey(name);
  if (!k) return name;
  const known = BY_KEY.get(k);
  if (known) return known.name;
  return used.find((u) => gameKey(u) === k) ?? name;
}

const seen = new Map<string, string>();
/** A tournament's game as shown and compared everywhere (old free-typed names map onto the list). */
export function gameOf(t: { game?: string }): string {
  const raw = t.game ?? '';
  let out = seen.get(raw);
  if (out === undefined) {
    out = canonicalGame(raw);
    if (seen.size < 2000) seen.set(raw, out);
  }
  return out;
}

/** The category a new tournament of this game most likely has (filled in for the organizer). */
export function categoryForGame(name: string): string {
  const g = knownGame(name);
  if (!g) return '';
  return g.group === 'Board & card games' ? (/tcg|gathering|yu-gi-oh/i.test(g.name) ? 'Card games' : 'Board games') : g.group;
}

/** Games played on this site, most tournaments first. */
export function usedGames(tournaments: { game?: string }[]): string[] {
  const count = new Map<string, number>();
  for (const t of tournaments) {
    const g = gameOf(t);
    if (g) count.set(g, (count.get(g) ?? 0) + 1);
  }
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([g]) => g);
}

/**
 * Runs apps-script/Code.gs in Node against a fake in-memory spreadsheet,
 * so the Google Sheets backend is tested without a Google account.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function fakeGoogle(adminKey = 'secret') {
  const sheets = new Map<string, string[][]>();
  const sheet = (name: string) => {
    const grid = () => sheets.get(name)!;
    const ensure = (r: number, c: number) => {
      const g = grid();
      while (g.length < r) g.push([]);
      for (const row of g) while (row.length < c) row.push('');
    };
    const api = {
      getDataRange: () => ({ getValues: () => grid().map((r) => [...r]) }),
      getLastRow: () => grid().length,
      getLastColumn: () => Math.max(0, ...grid().map((r) => r.length)),
      setFrozenRows: () => {},
      getRange: (r: number, c: number, nr: number, nc: number) => {
        const range = {
          setValues: (vals: unknown[][]) => {
            ensure(r + nr - 1, c + nc - 1);
            vals.forEach((row, i) => row.forEach((v, j) => (grid()[r - 1 + i][c - 1 + j] = String(v))));
            return range;
          },
          getValues: () => {
            ensure(r + nr - 1, c + nc - 1);
            return grid().slice(r - 1, r - 1 + nr).map((row) => row.slice(c - 1, c - 1 + nc));
          },
          clearContent: () => {
            for (let i = r - 1; i < r - 1 + nr && i < grid().length; i++) for (let j = c - 1; j < c - 1 + nc; j++) grid()[i][j] = '';
            // trim fully empty trailing rows, like Sheets' getLastRow does
            while (grid().length > 1 && grid()[grid().length - 1].every((v) => v === '')) grid().pop();
            return range;
          },
          setNumberFormat: () => range,
          setFontWeight: () => range,
        };
        return range;
      },
    };
    return api;
  };
  const ctx = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n: string) => (sheets.has(n) ? sheet(n) : null),
        insertSheet: (n: string) => (sheets.set(n, []), sheet(n)),
      }),
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text: string) => ({ setMimeType: () => ({ text }) }),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => adminKey }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      // Apps Script returns signed bytes (-128..127)
      computeDigest: (_alg: string, s: string) => [...createHash('sha256').update(s, 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
    },
    JSON,
    Date,
    Object,
    String,
    Number,
    Math,
    isNaN,
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync('apps-script/Code.gs', 'utf8'), ctx);
  const g = ctx as unknown as { doGet: (e: unknown) => { text: string }; doPost: (e: unknown) => { text: string } };
  return {
    sheets,
    get: (params: Record<string, string>) => JSON.parse(g.doGet({ parameter: params }).text),
    post: (body: Record<string, unknown>) => JSON.parse(g.doPost({ postData: { contents: JSON.stringify(body) } }).text),
  };
}

const doc = {
  id: 't1',
  name: 'Friday',
  game: 'Chess',
  format: 'single_elim',
  options: { thirdPlaceMatch: true },
  scoring: {},
  entrants: [
    { id: 'a', name: 'Alice' },
    { id: 'b', name: '=Bob' },
    { id: 'c', name: '007' },
  ],
  results: { 'W1-2': { winner: 'p2', score1: 1, score2: 2, p1: 'b', p2: 'c', at: '2026-11-16T10:00:00.000Z' } },
  log: [{ id: 'l1', time: '2026-11-16T10:00:00.000Z', summary: 'Match 1', changes: [{ matchId: 'W1-2', after: { winner: 'p2' } }] }],
  createdAt: '2026-11-16T09:00:00.000Z',
  updatedAt: '2026-11-16T09:00:00.000Z',
  version: 0,
};

describe('Google Sheets backend (Code.gs)', () => {
  it('saves and reads back a swiss tournament with frozen rounds', () => {
    const g = fakeGoogle();
    const swiss = {
      ...doc,
      id: 's1',
      format: 'swiss',
      options: { swissRounds: 3, swissPairings: [[[1, 3], [2, 0]], null, [[2, 1], [3, 0]]] },
      results: { 'S1-1': { winner: 'draw', p1: 'a', p2: 'c', at: '2026-11-16T10:00:00.000Z' } },
      log: [],
    };
    const saved = g.post({ key: 'secret', action: 'save', tournament: swiss, players: swiss.entrants });
    expect(saved.error).toBeUndefined();
    const back = g.get({ action: 'get', id: 's1' }).tournament;
    expect(back.format).toBe('swiss');
    expect(back.options).toEqual(swiss.options);
    expect(back.results).toEqual(swiss.results);
  });

  it('saves and reads back a tournament unchanged', () => {
    const g = fakeGoogle();
    const saved = g.post({ key: 'secret', action: 'save', tournament: doc, players: doc.entrants });
    expect(saved.error).toBeUndefined();
    expect(saved.tournament.version).toBe(1);

    const back = g.get({ action: 'get', id: 't1' }).tournament;
    expect(back.entrants).toEqual(doc.entrants);
    expect(back.results).toEqual(doc.results);
    expect(back.options).toEqual(doc.options);
    expect(back.log).toEqual(doc.log);
    expect(back.version).toBe(1);

    const all = g.get({ action: 'all' });
    expect(all.tournaments).toHaveLength(1);
    expect(all.players.map((p: { name: string }) => p.name).sort()).toEqual(['007', '=Bob', 'Alice']);
  });

  it('names that look like formulas are stored safely', () => {
    const g = fakeGoogle();
    g.post({ key: 'secret', action: 'save', tournament: doc, players: [] });
    const entrants = g.sheets.get('Entrants')!;
    expect(entrants.some((r) => r.includes("'=Bob"))).toBe(true);
  });

  it('anyone can read; writing needs the admin key or an organizer key', () => {
    const g = fakeGoogle();
    expect(g.post({ key: 'wrong', action: 'save', tournament: doc }).error).toMatch(/organizer key/);
    expect(g.post({ key: 'wrong', action: 'check' })).toEqual({ admin: false, organizer: false });
    expect(g.post({ key: 'secret', action: 'check' })).toEqual({ admin: true, organizer: false });
    expect(g.get({ action: 'all' }).tournaments).toEqual([]);
  });

  it('stops two people overwriting each other', () => {
    const g = fakeGoogle();
    g.post({ key: 'secret', action: 'save', tournament: doc });
    // someone else saves version 0 again -> conflict
    expect(g.post({ key: 'secret', action: 'save', tournament: doc }).error).toBe('conflict');
    expect(g.post({ key: 'secret', action: 'save', tournament: { ...doc, version: 1 } }).tournament.version).toBe(2);
  });

  it('a winner typed by hand as a name is understood', () => {
    const g = fakeGoogle();
    g.post({ key: 'secret', action: 'save', tournament: doc });
    const results = g.sheets.get('Results')!;
    const h = results[0];
    results[1][h.indexOf('winner')] = '=bob'; // admin typed the name instead of p1
    expect(g.get({ action: 'get', id: 't1' }).tournament.results['W1-2'].winner).toBe('p1');
  });

  it('only touches rows of the tournament being saved; delete removes them', () => {
    const g = fakeGoogle();
    g.post({ key: 'secret', action: 'save', tournament: doc });
    g.post({ key: 'secret', action: 'save', tournament: { ...doc, id: 't2', name: 'Other' } });
    g.post({ key: 'secret', action: 'save', tournament: { ...doc, results: {}, version: 1 } });
    const all = g.get({ action: 'all' }).tournaments;
    expect(all.find((t: { id: string }) => t.id === 't1').results).toEqual({});
    expect(Object.keys(all.find((t: { id: string }) => t.id === 't2').results)).toEqual(['W1-2']);

    g.post({ key: 'secret', action: 'delete', id: 't2' });
    expect(g.get({ action: 'all' }).tournaments.map((t: { id: string }) => t.id)).toEqual(['t1']);
  });

  describe('organizers, sign-up and player reports', () => {
    const ORG = 'organizer-key-0123456789';
    const swiss = { ...doc, id: 'o1', format: 'swiss', options: {}, results: {}, log: [], signup: true };
    const create = (g: ReturnType<typeof fakeGoogle>) => g.post({ action: 'save', orgKey: ORG, tournament: swiss, players: swiss.entrants });
    const pins = (g: ReturnType<typeof fakeGoogle>) => g.post({ action: 'pins', id: 'o1', orgKey: ORG }).pins as Record<string, string>;

    it('anyone can create a tournament; only its organizer (or the admin) can change it', () => {
      const g = fakeGoogle();
      expect(create(g).error).toBeUndefined();
      expect(g.post({ action: 'check', id: 'o1', orgKey: ORG })).toEqual({ admin: false, organizer: true });
      expect(g.post({ action: 'save', orgKey: 'someone-else-key-12345', tournament: { ...swiss, version: 1 } }).error).toMatch(/organizer/);
      expect(g.post({ action: 'save', orgKey: ORG, tournament: { ...swiss, name: 'Renamed', version: 1 } }).tournament.version).toBe(2);
      expect(g.post({ action: 'save', key: 'secret', tournament: { ...swiss, version: 2 } }).tournament.version).toBe(3);
      expect(g.post({ action: 'delete', id: 'o1', orgKey: 'nope-nope-nope-nope' }).error).toMatch(/organizer/);
      expect(g.post({ action: 'renamePlayer', id: 'a', name: 'X', orgKey: ORG }).error).toMatch(/site admin/);
      // the organizer key is never stored in plain text
      expect(g.sheets.get('Tournaments')!.flat()).not.toContain(ORG);
      expect(g.post({ action: 'delete', id: 'o1', orgKey: ORG }).ok).toBe(true);
    });

    it('organizers cannot rename people in the shared player list', () => {
      const g = fakeGoogle();
      g.post({ key: 'secret', action: 'save', tournament: doc, players: doc.entrants });
      create(g);
      g.post({ action: 'save', orgKey: ORG, tournament: { ...swiss, version: 1 }, players: [{ id: 'a', name: 'Hacked' }] });
      expect(g.get({ action: 'all' }).players.find((p: { id: string }) => p.id === 'a').name).toBe('Alice');
    });

    it('players sign up and get a PIN that survives organizer saves and is never public', () => {
      const g = fakeGoogle();
      create(g);
      const out = g.post({ action: 'signup', id: 'o1', name: '  Dana  ' });
      expect(out.pin).toMatch(/^\d{6}$/);
      expect(out.tournament.entrants.map((e: { name: string }) => e.name)).toEqual(['Alice', '=Bob', '007', 'Dana']);
      expect(out.tournament.version).toBe(2);
      expect(g.post({ action: 'signup', id: 'o1', name: 'dana' }).error).toMatch(/already signed up/);

      const before = pins(g);
      expect(before[out.playerId]).toBe(out.pin);
      expect(Object.keys(before)).toHaveLength(4);
      // organizer reorders entrants and saves: PINs stay with their players
      const t = g.get({ action: 'get', id: 'o1' }).tournament;
      g.post({ action: 'save', orgKey: ORG, tournament: { ...t, entrants: [...t.entrants].reverse() } });
      expect(pins(g)).toEqual(before);

      const publicText = JSON.stringify(g.get({ action: 'all' }));
      for (const pin of Object.values(before)) expect(publicText).not.toContain(pin);
      expect(publicText).not.toContain('orgKeyHash');
      expect(g.post({ action: 'pins', id: 'o1', orgKey: 'wrong-wrong-wrong-wrong' }).error).toMatch(/organizer/);
    });

    it('sign-up only while open and before anything is played', () => {
      const g = fakeGoogle();
      g.post({ action: 'save', orgKey: ORG, tournament: { ...swiss, signup: false } });
      expect(g.post({ action: 'signup', id: 'o1', name: 'Eve' }).error).toMatch(/closed/);
      const t = g.get({ action: 'get', id: 'o1' }).tournament;
      expect(t.signup).toBe(false);
      g.post({ action: 'save', orgKey: ORG, tournament: { ...t, signup: true, results: { 'S1-1': { winner: 'p1', p1: 'a', p2: 'c' } } } });
      expect(g.post({ action: 'signup', id: 'o1', name: 'Eve' }).error).toMatch(/already started/);
    });

    it('a player reports their own unplayed match with their PIN', () => {
      const g = fakeGoogle();
      create(g);
      const p = pins(g);
      const result = { winner: 'p2', score1: 1, score2: 2, p1: 'a', p2: 'c' };
      const send = (pin: string, r: object, matchId = 'S1-1') => g.post({ action: 'report', id: 'o1', matchId, pin, result: r, matchNo: 1 });

      expect(send('000000', result).error).toBe('Wrong PIN');
      expect(send(p.b, result).error).toMatch(/your own matches/);
      expect(send(p.a, { ...result, p2: 'zzz' }).error).toMatch(/not in this match/);
      expect(send(p.a, { ...result, winner: 'nobody' }).error).toMatch(/winner/);

      const ok = send(p.a, result);
      expect(ok.error).toBeUndefined();
      expect(ok.tournament.results['S1-1']).toMatchObject({ winner: 'p2', score1: 1, score2: 2, p1: 'a', p2: 'c' });
      expect(ok.tournament.version).toBe(2);
      const entry = ok.tournament.log.at(-1);
      expect(entry.summary).toBe('Match 1: Alice 1–2 007 (reported by Alice)');
      expect(entry.changes).toEqual([{ matchId: 'S1-1', after: ok.tournament.results['S1-1'] }]);

      // fixes are for the organizer: players can't overwrite a result
      expect(send(p.c, { ...result, winner: 'p1' }).error).toMatch(/already has a result/);
      // draws only where the format allows them
      const se = { ...swiss, id: 'o2', format: 'single_elim' };
      g.post({ action: 'save', orgKey: ORG, tournament: se });
      const p2 = g.post({ action: 'pins', id: 'o2', orgKey: ORG }).pins;
      expect(g.post({ action: 'report', id: 'o2', matchId: 'W1-2', pin: p2.b, result: { winner: 'draw', p1: 'b', p2: 'c' } }).error).toMatch(/winner/);
    });

    it('groups allow draws; finals never do', () => {
      const g = fakeGoogle();
      const gr = { ...swiss, id: 'o3', format: 'groups', options: { groupCount: 1, finals: { format: 'single_elim', advance: 2 } } };
      g.post({ action: 'save', orgKey: ORG, tournament: gr });
      const p = g.post({ action: 'pins', id: 'o3', orgKey: ORG }).pins;
      const draw = (matchId: string) => g.post({ action: 'report', id: 'o3', matchId, pin: p.a, result: { winner: 'draw', p1: 'a', p2: 'b' } });
      expect(draw('F-W1-1').error).toMatch(/winner/);
      expect(draw('A-RR1-1').error).toBeUndefined();
      // the finals settings survive the round trip
      expect(g.get({ action: 'get', id: 'o3' }).tournament.options.finals).toEqual({ format: 'single_elim', advance: 2 });
    });
  });

  it('renaming a player updates every tab', () => {
    const g = fakeGoogle();
    g.post({ key: 'secret', action: 'save', tournament: doc, players: doc.entrants });
    g.post({ key: 'secret', action: 'renamePlayer', id: 'c', name: 'Charlie' });
    const t = g.get({ action: 'get', id: 't1' }).tournament;
    expect(t.entrants[2].name).toBe('Charlie');
    expect(g.sheets.get('Results')!.flat()).toContain('Charlie');
  });
});

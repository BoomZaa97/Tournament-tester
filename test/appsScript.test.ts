/**
 * Runs apps-script/Code.gs in Node against a fake in-memory spreadsheet,
 * so the Google Sheets backend is tested without a Google account.
 */
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

  it('rejects writes without the admin key, but anyone can read', () => {
    const g = fakeGoogle();
    expect(g.post({ key: 'wrong', action: 'save', tournament: doc }).error).toMatch(/admin key/);
    expect(g.post({ key: 'wrong', action: 'check' })).toEqual({ admin: false });
    expect(g.post({ key: 'secret', action: 'check' })).toEqual({ admin: true });
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

  it('renaming a player updates every tab', () => {
    const g = fakeGoogle();
    g.post({ key: 'secret', action: 'save', tournament: doc, players: doc.entrants });
    g.post({ key: 'secret', action: 'renamePlayer', id: 'c', name: 'Charlie' });
    const t = g.get({ action: 'get', id: 't1' }).tournament;
    expect(t.entrants[2].name).toBe('Charlie');
    expect(g.sheets.get('Results')!.flat()).toContain('Charlie');
  });
});

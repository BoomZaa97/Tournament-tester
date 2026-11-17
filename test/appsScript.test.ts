/**
 * Runs apps-script/Code.gs in Node against a fake in-memory spreadsheet,
 * so the Google Sheets backend is tested without a Google account.
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { fakeGoogle as fake } from '../scripts/fake-google.mjs';

function fakeGoogle(adminKey = 'secret') {
  return fake({ adminKey });
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

    it('sign-ups beyond the player limit go on a waitlist, in order, with their own PIN', () => {
      const g = fakeGoogle();
      g.post({ action: 'save', orgKey: ORG, tournament: { ...swiss, maxPlayers: 4 } });
      expect(g.post({ action: 'signup', id: 'o1', name: 'Dana' }).waitlisted).toBe(false);
      const eve = g.post({ action: 'signup', id: 'o1', name: 'Eve' });
      expect(eve.waitlisted).toBe(true);
      expect(eve.pin).toMatch(/^\d{6}$/);
      expect(eve.tournament.entrants).toHaveLength(4); // not in the bracket
      expect(eve.tournament.waitlist).toEqual([{ id: eve.playerId, name: 'Eve' }]);
      expect(eve.tournament.maxPlayers).toBe(4);
      expect(eve.tournament.log.at(-1).summary).toBe('Eve joined the waitlist');
      const fay = g.post({ action: 'signup', id: 'o1', name: 'Fay' });
      expect(g.post({ action: 'signup', id: 'o1', name: 'eve' }).error).toMatch(/already signed up/);
      expect(fay.tournament.waitlist.map((w: { name: string }) => w.name)).toEqual(['Eve', 'Fay']);

      // PINs: the organizer sees them, viewers never do; no two people share one
      const p = pins(g);
      expect(p[eve.playerId]).toBe(eve.pin);
      expect(new Set(Object.values(p)).size).toBe(6);
      expect(JSON.stringify(g.get({ action: 'all' }))).not.toContain(eve.pin);

      // a spot opens (limit raised): people already waiting still go first
      let t = g.get({ action: 'get', id: 'o1' }).tournament;
      t = g.post({ action: 'save', orgKey: ORG, tournament: { ...t, maxPlayers: 8 } }).tournament;
      expect(g.post({ action: 'signup', id: 'o1', name: 'Gus' }).waitlisted).toBe(true);

      // the organizer moves Eve up: she keeps her PIN and leaves the waitlist
      t = g.get({ action: 'get', id: 'o1' }).tournament;
      const moved = g.post({ action: 'save', orgKey: ORG, tournament: { ...t, entrants: [...t.entrants, { id: eve.playerId, name: 'Eve' }] } });
      expect(moved.tournament.entrants.map((e: { name: string }) => e.name)).toEqual(['Alice', '=Bob', '007', 'Dana', 'Eve']);
      expect(moved.tournament.waitlist.map((w: { name: string }) => w.name)).toEqual(['Fay', 'Gus']);
      expect(pins(g)[eve.playerId]).toBe(eve.pin);
      // seeds stay 1..n: the waitlist never shows up among the entrants
      const tab = g.sheets.get('Entrants')!;
      const seeds = tab.slice(1).map((r) => r[tab[0].indexOf('seed')]);
      expect(seeds).toEqual(['1', '2', '3', '4', '5']);

      g.post({ action: 'delete', id: 'o1', orgKey: ORG });
      expect(g.sheets.get('Waitlist')!.length).toBeLessThanOrEqual(1);
    });

    it('check-in: players with their PIN, the organizer for anyone; kept across saves; not after the start', () => {
      const g = fakeGoogle();
      g.post({ action: 'save', orgKey: ORG, tournament: { ...swiss, maxPlayers: 3 } });
      const p = pins(g);
      const checkin = (body: object) => g.post({ action: 'checkin', id: 'o1', ...body });
      expect(checkin({ pin: p.a }).error).toMatch(/isn't open/);

      let t = g.get({ action: 'get', id: 'o1' }).tournament;
      t = g.post({ action: 'save', orgKey: ORG, tournament: { ...t, checkIn: true } }).tournament;
      expect(t.checkIn).toBe(true);
      expect(t.checkedIn).toEqual([]);

      expect(checkin({ pin: '123' }).error).toBe('Wrong PIN');
      const ok = checkin({ pin: p.a });
      expect(ok.playerId).toBe('a');
      expect(ok.tournament.checkedIn).toEqual(['a']);
      // doesn't touch the bracket: same version, so an organizer's open edit still saves
      expect(ok.tournament.version).toBe(t.version);

      // waitlisted people can check in too
      const wl = g.post({ action: 'signup', id: 'o1', name: 'Zed' });
      expect(wl.waitlisted).toBe(true);
      expect(checkin({ pin: wl.pin }).tournament.checkedIn).toEqual(['a', wl.playerId]);
      expect(checkin({ pin: wl.pin, here: false }).tournament.checkedIn).toEqual(['a']);

      // the organizer marks anyone (no PIN needed); others can't
      expect(checkin({ playerId: 'c', orgKey: 'wrong-wrong-wrong-wrong' }).error).toMatch(/organizer/);
      expect(checkin({ playerId: 'c', orgKey: ORG }).tournament.checkedIn).toEqual(['a', 'c']);
      expect(checkin({ playerId: 'zzz', orgKey: ORG }).error).toMatch(/not in this tournament/);

      // an organizer save (here: removing the no-show "b") keeps check-ins by player
      t = g.get({ action: 'get', id: 'o1' }).tournament;
      t = g.post({ action: 'save', orgKey: ORG, tournament: { ...t, entrants: t.entrants.filter((e: { id: string }) => e.id !== 'b') } }).tournament;
      expect(t.checkedIn).toEqual(['a', 'c']);
      expect(JSON.stringify(g.get({ action: 'all' }))).not.toContain(p.a);

      g.post({ action: 'save', orgKey: ORG, tournament: { ...t, results: { 'S1-1': { winner: 'p1', p1: 'a', p2: 'c' } } } });
      expect(checkin({ pin: p.a, here: false }).error).toMatch(/already started/);
    });

    it('a player drops out with their PIN once the tournament has started; logged so the organizer can undo it', () => {
      const g = fakeGoogle();
      create(g);
      const p = pins(g);
      const drop = (pin: string) => g.post({ action: 'drop', id: 'o1', pin });
      expect(drop(p.c).error).toMatch(/hasn't started/);
      const report = (pin: string, r: object, matchId: string) => g.post({ action: 'report', id: 'o1', matchId, pin, result: r });
      expect(report(p.a, { winner: 'p1', p1: 'a', p2: 'c' }, 'S1-1').error).toBeUndefined();

      expect(drop('999999').error).toBe('Wrong PIN');
      const before = g.get({ action: 'get', id: 'o1' }).tournament;
      const out = drop(p.c);
      expect(out.error).toBeUndefined();
      expect(out.tournament.options.dropped).toEqual([3]); // 007 is seed 3
      expect(out.tournament.version).toBe(before.version + 1);
      const entry = out.tournament.log.at(-1);
      expect(entry.summary).toBe('007 dropped out');
      expect(entry.restore.options).toEqual(before.options);
      expect(entry.restore.results).toEqual(before.results);
      expect(drop(p.c).error).toMatch(/already dropped/);
      // a dropped player can't report, and nobody can report a match against them
      expect(report(p.c, { winner: 'p1', p1: 'c', p2: 'b' }, 'S2-1').error).toMatch(/dropped out/);
      expect(report(p.b, { winner: 'p1', p1: 'b', p2: 'c' }, 'S2-1').error).toMatch(/dropped out/);
      // organizer saves keep it (it's in options)
      const t = g.get({ action: 'get', id: 'o1' }).tournament;
      expect(g.post({ action: 'save', orgKey: ORG, tournament: t }).tournament.options.dropped).toEqual([3]);
    });

    it("the opponent confirms or disputes a reported score with their PIN; the organizer's results count as confirmed", () => {
      const g = fakeGoogle();
      create(g);
      const p = pins(g);
      const rep = g.post({ action: 'report', id: 'o1', matchId: 'S1-1', pin: p.a, result: { winner: 'p1', score1: 2, score2: 0, p1: 'a', p2: 'c' } });
      expect(rep.tournament.results['S1-1']).toMatchObject({ status: 'reported', reportedBy: 'a' });
      const confirm = (pin: string, ok: boolean, matchId = 'S1-1') => g.post({ action: 'confirm', id: 'o1', matchId, pin, ok, matchNo: 1 });

      expect(confirm('000000', true).error).toBe('Wrong PIN');
      expect(confirm(p.a, true).error).toMatch(/opponent has to confirm/);
      expect(confirm(p.b, true).error).toMatch(/your own matches/);
      expect(confirm(p.c, true, 'S1-2').error).toMatch(/no result/);

      const out = confirm(p.c, false);
      expect(out.error).toBeUndefined();
      expect(out.tournament.results['S1-1']).toMatchObject({ status: 'disputed', reportedBy: 'a', winner: 'p1' });
      const entry = out.tournament.log.at(-1);
      expect(entry.summary).toBe('Match 1: 007 disputed the result: the organizer needs to settle it');
      expect(entry.changes[0].before.status).toBe('reported'); // the organizer can undo it from the log
      expect(confirm(p.c, true).error).toMatch(/disputed/);

      // the organizer settles it by saving a result without a status
      const t = out.tournament;
      const settled = { ...t.results['S1-1'] };
      delete settled.status;
      const saved = g.post({ action: 'save', orgKey: ORG, tournament: { ...t, results: { 'S1-1': settled } } }).tournament;
      expect(saved.results['S1-1'].status).toBeUndefined();
      expect(saved.results['S1-1'].reportedBy).toBe('a');
      expect(confirm(p.c, true).error).toMatch(/already settled/);

      // a confirmed report
      g.post({ action: 'report', id: 'o1', matchId: 'S1-2', pin: p.b, result: { winner: 'p2', p1: 'b', p2: 'a' } });
      expect(confirm(p.a, true, 'S1-2').tournament.results['S1-2'].status).toBe('confirmed');
      // and it survives an organizer save
      const again = g.get({ action: 'get', id: 'o1' }).tournament;
      expect(g.post({ action: 'save', orgKey: ORG, tournament: again }).tournament.results['S1-2']).toMatchObject({ status: 'confirmed', reportedBy: 'b' });
    });

    it('no limit set: nobody is waitlisted', () => {
      const g = fakeGoogle();
      create(g);
      for (const n of ['D', 'E', 'F', 'G']) expect(g.post({ action: 'signup', id: 'o1', name: n }).waitlisted).toBe(false);
      expect(g.get({ action: 'get', id: 'o1' }).tournament.waitlist).toEqual([]);
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

  describe('accounts', () => {
    const ORG = 'organizer-key-0123456789';
    const open = { ...doc, id: 'o1', format: 'swiss', options: {}, results: {}, log: [], signup: true };
    type G = ReturnType<typeof fakeGoogle>;
    const create = (g: G, extra: Record<string, unknown> = {}) =>
      g.post({ action: 'save', orgKey: ORG, tournament: open, players: open.entrants, ...extra });
    const reg = (g: G, body: Record<string, unknown>) => g.post({ action: 'register', password: 'hunter22', ...body });
    const pinsOf = (g: G) => g.post({ action: 'pins', id: 'o1', orgKey: ORG }).pins as Record<string, string>;

    it('register, log in, wrong passwords lock the account for a while; nothing secret is public', () => {
      const g = fakeGoogle();
      const r = reg(g, { username: 'Dana_1', name: 'Dana' });
      expect(r.error).toBeUndefined();
      expect(r.account).toMatchObject({ username: 'dana_1', name: 'Dana' });
      expect(r.token).toMatch(/^\w+\.[0-9a-f]{40}$/);
      expect(reg(g, { username: 'dana_1', name: 'Other' }).error).toMatch(/taken/);
      expect(reg(g, { username: 'x', name: 'Other' }).error).toMatch(/3 to 24/);
      expect(reg(g, { username: 'other', name: 'Other', password: '123' }).error).toMatch(/6 characters/);

      const ok = g.post({ action: 'login', username: ' DANA_1 ', password: 'hunter22' });
      expect(ok.account.playerId).toBe(r.account.playerId);
      expect(ok.token).toBe(r.token);
      for (let i = 0; i < 5; i++) expect(g.post({ action: 'login', username: 'dana_1', password: 'nope' }).error).toBe('Wrong username or password');
      // 5 wrong in a row: even the right password has to wait
      expect(g.post({ action: 'login', username: 'dana_1', password: 'hunter22' }).error).toMatch(/Try again in 10 minutes/);

      const all = g.get({ action: 'all' });
      expect(all.players).toEqual([{ id: r.account.playerId, name: 'Dana', account: true }]);
      const text = JSON.stringify(all);
      expect(text).not.toContain('hunter22');
      expect(text).not.toContain('passHash');
      // the password itself is never stored
      expect(g.sheets.get('Accounts')!.flat().join(' ')).not.toContain('hunter22');
    });

    it('join with one tap; a name with an account can only be used by logging in', () => {
      const g = fakeGoogle();
      create(g);
      const { token, account } = reg(g, { username: 'dana', name: 'Dana' });
      const out = g.post({ action: 'signup', id: 'o1', token });
      expect(out.error).toBeUndefined();
      expect(out.playerId).toBe(account.playerId);
      expect(out.pin).toMatch(/^\d{6}$/);
      expect(out.tournament.entrants.map((e: { name: string }) => e.name)).toContain('Dana');
      expect(g.post({ action: 'signup', id: 'o1', token }).error).toMatch(/already signed up/);
      expect(g.post({ action: 'signup', id: 'o1', name: 'dana' }).error).toMatch(/has an account/);
      expect(g.post({ action: 'signup', id: 'o1', token: token.slice(0, -1) + 'x' }).error).toMatch(/log in again/);
    });

    it('a logged-in device gets its PINs and organizer keys; keys it brings are kept for other devices', () => {
      const g = fakeGoogle();
      const { token } = reg(g, { username: 'olga', name: 'Olga' });
      // made while logged in: the account keeps the key
      expect(create(g, { token }).error).toBeUndefined();
      // made on another device before logging in, brought along on the next sync
      const KEY2 = 'second-organizer-key-99';
      g.post({ action: 'save', orgKey: KEY2, tournament: { ...open, id: 'o2' }, players: open.entrants });
      const signed = g.post({ action: 'signup', id: 'o2', token });

      const me = g.post({ action: 'me', token, orgKeys: { o2: KEY2, o1: 'wrong-key-wrong-key', nope: KEY2 } });
      expect(me.orgKeys).toEqual({ o1: ORG, o2: KEY2 });
      expect(me.pins).toEqual({ o2: { playerId: signed.playerId, pin: signed.pin } });
      expect(g.post({ action: 'me', token }).orgKeys).toEqual({ o1: ORG, o2: KEY2 });
      // deleted tournaments drop out
      g.post({ action: 'delete', id: 'o2', orgKey: KEY2 });
      expect(g.post({ action: 'me', token }).orgKeys).toEqual({ o1: ORG });
      expect(g.post({ action: 'me', token: 'abc.def' }).error).toMatch(/log in again/);
    });

    it('taking over a player who already played needs one of their PINs', () => {
      const g = fakeGoogle();
      create(g);
      const dana = g.post({ action: 'signup', id: 'o1', name: 'Dana' });
      expect(reg(g, { username: 'dana', name: 'dana' }).error).toMatch(/join code and your PIN/);
      expect(reg(g, { username: 'dana', name: 'Dana', claims: [{ id: 'o1', pin: '000000' }] }).error).toMatch(/join code and your PIN/);
      // the PIN this device remembers
      const r = reg(g, { username: 'dana', name: 'Dana', claims: [{ id: 'o1', pin: dana.pin }] });
      expect(r.account.playerId).toBe(dana.playerId);
      expect(reg(g, { username: 'dana2', name: 'Dana', claims: [{ id: 'o1', pin: dana.pin }] }).error).toMatch(/already has an account/);
      // or typed with the join code, under a new name (renames the player everywhere)
      const code = g.get({ action: 'get', id: 'o1' }).tournament.code as string;
      const r2 = reg(g, { username: 'ally', name: 'Ally', claim: { code: code.toLowerCase(), pin: pinsOf(g)['a'] } });
      expect(r2.account).toMatchObject({ playerId: 'a', name: 'Ally' });
      expect(g.get({ action: 'get', id: 'o1' }).tournament.entrants[0].name).toBe('Ally');
      expect(reg(g, { username: 'z9z', name: 'Zed', claim: { code, pin: '123456' } }).error).toMatch(/don't match/);
    });

    it('change password logs out other devices; rename yourself; the admin resets a password', () => {
      const g = fakeGoogle();
      create(g);
      const { token, account } = reg(g, { username: 'dana', name: 'Dana' });
      expect(g.post({ action: 'password', token, password: 'wrong!', newPassword: 'newpass1' }).error).toMatch(/current password/);
      const changed = g.post({ action: 'password', token, password: 'hunter22', newPassword: 'newpass1' });
      expect(changed.token).not.toBe(token);
      expect(g.post({ action: 'me', token }).error).toMatch(/log in again/);
      expect(g.post({ action: 'login', username: 'dana', password: 'newpass1' }).token).toBe(changed.token);

      expect(g.post({ action: 'rename', token: changed.token, name: 'Alice' }).error).toMatch(/already called/);
      expect(g.post({ action: 'rename', token: changed.token, name: 'Dana B' }).account.name).toBe('Dana B');

      expect(g.post({ action: 'resetPassword', playerId: account.playerId, orgKey: ORG }).error).toMatch(/site admin/);
      const reset = g.post({ action: 'resetPassword', playerId: account.playerId, key: 'secret' });
      expect(reset.username).toBe('dana');
      expect(g.post({ action: 'login', username: 'dana', password: reset.password }).account.name).toBe('Dana B');
      expect(g.post({ action: 'me', token: changed.token }).error).toMatch(/log in again/);
    });
  });

  describe('categories and profiles', () => {
    it('stores a tournament category next to the game, trimmed and short', () => {
      const g = fakeGoogle();
      g.post({ key: 'secret', action: 'save', tournament: { ...doc, category: '  U18   girls ' } });
      expect(g.get({ action: 'get', id: 't1' }).tournament.category).toBe('U18 girls');
      expect(g.sheets.get('Tournaments')![0].slice(0, 4)).toEqual(['id', 'name', 'game', 'category']);
      expect(g.get({ action: 'all', lite: '1' }).tournaments[0].category).toBe('U18 girls');
    });

    it('lets only the player (logged in) or the site admin change a profile, and checks what goes in', () => {
      const g = fakeGoogle();
      g.post({ key: 'secret', action: 'save', tournament: doc, players: doc.entrants });
      const dana = g.post({ action: 'register', username: 'dana', password: 'hunter22', name: 'Dana' });
      const me = dana.account.playerId;
      const photo = 'data:image/jpeg;base64,' + 'A'.repeat(100);
      expect(g.get({ action: 'profile', id: me }).profile).toBeNull();

      const ok = g.post({ action: 'profile', id: me, token: dana.token, photo, bio: ' Hi! ', links: ['https://x.com/dana', ''] });
      expect(ok.error).toBeUndefined();
      expect(ok.profile).toEqual({ photo, bio: 'Hi!', links: ['https://x.com/dana'] });
      expect(g.get({ action: 'profile', id: me }).profile).toEqual(ok.profile);

      // not someone else's, not without logging in
      expect(g.post({ action: 'profile', id: 'a', token: dana.token, bio: 'x' }).error).toMatch(/your own/);
      expect(g.post({ action: 'profile', id: me, bio: 'x' }).error).toMatch(/log in/);
      // the admin can
      expect(g.post({ action: 'profile', id: 'a', key: 'secret', bio: 'Admin wrote this' }).profile.bio).toBe('Admin wrote this');
      expect(g.post({ action: 'profile', id: 'nobody', key: 'secret', bio: 'x' }).error).toMatch(/not found/);

      const bad = (body: Record<string, unknown>) => g.post({ action: 'profile', id: me, token: dana.token, ...body }).error;
      expect(bad({ photo: 'https://evil.example/x.png' })).toMatch(/can't be used/);
      expect(bad({ photo: 'data:image/svg+xml;base64,AAAA' })).toMatch(/can't be used/);
      expect(bad({ photo: 'data:image/jpeg;base64,' + 'A'.repeat(50000) })).toMatch(/too big/);
      expect(bad({ bio: 'x'.repeat(281) })).toMatch(/280/);
      expect(bad({ links: ['javascript:alert(1)'] })).toMatch(/https/);
      expect(bad({ links: ['https://a.b', 'https://c.d', 'https://e.f', 'https://g.h'] })).toMatch(/Up to 3/);

      // photos stay out of the lists (only the player page reads them)
      expect(JSON.stringify(g.get({ action: 'all', lite: '1' }))).not.toContain('base64');
      expect(JSON.stringify(g.get({ action: 'players' }))).not.toContain('base64');
    });
  });

  describe('join codes', () => {
    it('every tournament gets a unique code that never changes; anyone can look it up', () => {
      const g = fakeGoogle();
      const a = g.post({ key: 'secret', action: 'save', tournament: doc }).tournament;
      const b = g.post({ key: 'secret', action: 'save', tournament: { ...doc, id: 't2' } }).tournament;
      expect(a.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
      expect(b.code).not.toBe(a.code);
      const again = g.post({ key: 'secret', action: 'save', tournament: { ...doc, version: 1, code: 'HACKED' } }).tournament;
      expect(again.code).toBe(a.code);
      expect(g.get({ action: 'get', id: 't1' }).tournament.code).toBe(a.code);

      const typed = a.code.toLowerCase().slice(0, 3) + ' - ' + a.code.slice(3);
      expect(g.get({ action: 'code', code: typed })).toEqual({ id: 't1', name: 'Friday' });
      expect(g.get({ action: 'code', code: 'ZZZZZZ' }).error).toMatch(/No tournament/);
      expect(g.get({ action: 'code', code: '' }).error).toMatch(/Type a code/);
    });

    it('tournaments saved by an older script get a code the first time they are read', () => {
      const g = fakeGoogle();
      g.post({ key: 'secret', action: 'save', tournament: doc });
      const rows = g.sheets.get('Tournaments')!;
      const col = rows[0].indexOf('code');
      rows[1][col] = ''; // as if the old script had saved it
      const code = g.get({ action: 'all' }).tournaments[0].code;
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
      expect(rows[1][col]).toBe(code);
      expect(g.get({ action: 'code', code }).id).toBe('t1');
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

  describe('many tournaments in one sheet', () => {
    const TAB_THIRD: Record<string, string> = { Entrants: 'seed', Results: 'matchId', Log: 'time' };
    const ev = (n: number, players = 4) => ({
      ...doc,
      id: 'e' + n,
      name: 'Event ' + n,
      createdAt: `2026-11-${String(n).padStart(2, '0')}T09:00:00.000Z`,
      entrants: Array.from({ length: players }, (_, i) => ({ id: `e${n}p${i}`, name: `P${n}-${i}` })),
      results: { 'W1-1': { winner: 'p1', p1: `e${n}p0`, p2: `e${n}p${players - 1}`, at: '2026-11-16T10:00:00.000Z' } },
      log: [{ id: 'l' + n, time: '2026-11-16T10:00:00.000Z', summary: 'Match 1', changes: [] }],
    });
    const col = (g: ReturnType<typeof fakeGoogle>, tab: string, name: string) => {
      const rows = g.sheets.get(tab)!;
      const c = rows[0].indexOf(name);
      return rows.slice(1).map((r) => r[c]);
    };
    /** The tournament ids of a tab's blocks, top to bottom. */
    const blocks = (g: ReturnType<typeof fakeGoogle>, tab: string) =>
      col(g, tab, 'tournamentId').filter((id, i, all) => id !== all[i - 1]);
    const rowsOf = (g: ReturnType<typeof fakeGoogle>, tab: string, id: string) => {
      const rows = g.sheets.get(tab)!;
      const c = rows[0].indexOf('tournamentId');
      return rows.filter((r) => r[c] === id).map((r) => r.join('|'));
    };

    it('keeps each tournament in one block, newest on top, with its name, and only rewrites that block', () => {
      const g = fakeGoogle(); // tabs start with 30 rows: these outgrow them
      for (let n = 1; n <= 6; n++) expect(g.post({ key: 'secret', action: 'save', tournament: ev(n, 8) }).error).toBeUndefined();
      for (const tab of ['Entrants', 'Results', 'Log']) {
        expect(blocks(g, tab)).toEqual(['e6', 'e5', 'e4', 'e3', 'e2', 'e1']);
        expect(g.sheets.get(tab)![0].slice(0, 2)).toEqual(['tournamentId', 'tournament']);
      }
      expect(col(g, 'Tournaments', 'id')).toEqual(['e6', 'e5', 'e4', 'e3', 'e2', 'e1']);
      expect(new Set(col(g, 'Entrants', 'tournament'))).toEqual(new Set(['Event 1', 'Event 2', 'Event 3', 'Event 4', 'Event 5', 'Event 6']));
      expect(col(g, 'Entrants', 'tournamentId')).toHaveLength(48);

      // edit event 3: more players, renamed. Nothing else moves or changes.
      const others = ['e1', 'e2', 'e4', 'e5', 'e6'].map((id) => rowsOf(g, 'Entrants', id));
      const t3 = g.get({ action: 'get', id: 'e3' }).tournament;
      const more = [...t3.entrants, { id: 'x1', name: 'Late' }, { id: 'x2', name: 'Later' }];
      g.post({ key: 'secret', action: 'save', tournament: { ...t3, name: 'Event 3 (final)', entrants: more } });
      expect(blocks(g, 'Entrants')).toEqual(['e6', 'e5', 'e4', 'e3', 'e2', 'e1']);
      expect(['e1', 'e2', 'e4', 'e5', 'e6'].map((id) => rowsOf(g, 'Entrants', id))).toEqual(others);
      expect(rowsOf(g, 'Entrants', 'e3')).toHaveLength(10);
      expect(rowsOf(g, 'Results', 'e3')[0]).toContain('Event 3 (final)');

      // a player report adds a row at the end of that block only
      const pins = g.post({ key: 'secret', action: 'pins', id: 'e5' }).pins;
      const r = g.post({ action: 'report', id: 'e5', matchId: 'W1-2', pin: pins.e5p1, result: { winner: 'p1', p1: 'e5p1', p2: 'e5p6' } });
      expect(r.error).toBeUndefined();
      expect(blocks(g, 'Results')).toEqual(['e6', 'e5', 'e4', 'e3', 'e2', 'e1']);
      expect(blocks(g, 'Log')).toEqual(['e6', 'e5', 'e4', 'e3', 'e2', 'e1']);
      expect(r.tournament.log.map((l: { summary: string }) => l.summary)).toEqual(['Match 1', expect.stringContaining('reported by P5-1')]);

      // delete takes out exactly its rows
      g.post({ key: 'secret', action: 'delete', id: 'e4' });
      for (const tab of ['Entrants', 'Results', 'Log']) expect(blocks(g, tab)).toEqual(['e6', 'e5', 'e3', 'e2', 'e1']);
      expect(['e1', 'e2', 'e6'].map((id) => rowsOf(g, 'Entrants', id))).toEqual([others[0], others[1], others[4]]);
      expect(g.get({ action: 'all' }).tournaments).toHaveLength(5);
    });

    it('a big sign-up grows its block past the sheet size', () => {
      const g = fakeGoogle();
      g.post({ key: 'secret', action: 'save', tournament: { ...ev(1, 2), results: {}, log: [], signup: true } });
      g.post({ key: 'secret', action: 'save', tournament: ev(2) });
      for (let i = 0; i < 40; i++) expect(g.post({ action: 'signup', id: 'e1', name: 'Walk-in ' + i }).error).toBeUndefined();
      expect(g.get({ action: 'get', id: 'e1' }).tournament.entrants).toHaveLength(42);
      expect(blocks(g, 'Entrants')).toEqual(['e2', 'e1']);
      expect(blocks(g, 'Log')).toEqual(['e2', 'e1']);
      expect(g.get({ action: 'get', id: 'e2' }).tournament.entrants).toHaveLength(4);
    });

    it('rows moved by hand are gathered back on the next save, without losing any', () => {
      const g = fakeGoogle();
      g.post({ key: 'secret', action: 'save', tournament: ev(1) });
      g.post({ key: 'secret', action: 'save', tournament: ev(2) });
      // swap the first row of each block (e2 rows are on top)
      const rows = g.sheets.get('Entrants')!;
      const top = rows[1];
      const bottom = rows[rows.length - 1];
      const copy = [...top];
      top.splice(0, top.length, ...bottom);
      bottom.splice(0, bottom.length, ...copy);
      expect(blocks(g, 'Entrants')).toEqual(['e1', 'e2', 'e1', 'e2']);
      // readers still see everyone
      expect(g.get({ action: 'get', id: 'e1' }).tournament.entrants).toHaveLength(4);
      const t1 = g.get({ action: 'get', id: 'e1' }).tournament;
      g.post({ key: 'secret', action: 'save', tournament: t1 });
      expect(blocks(g, 'Entrants')).toEqual(['e1', 'e2']);
      expect(g.get({ action: 'get', id: 'e1' }).tournament.entrants).toEqual(t1.entrants);
      expect(g.get({ action: 'get', id: 'e2' }).tournament.entrants).toHaveLength(4);
    });

    it('pages poll cheaply: unchanged tournaments answer { same: true }; lists can skip logs', () => {
      const g = fakeGoogle();
      g.post({ key: 'secret', action: 'save', tournament: ev(1) });
      const first = g.get({ action: 'get', id: 'e1' });
      expect(first.players.map((p: { name: string }) => p.name)).toEqual(['P1-0', 'P1-1', 'P1-2', 'P1-3']);
      expect(g.get({ action: 'get', id: 'e1', since: first.tournament.updatedAt })).toEqual({ same: true });
      expect(g.get({ action: 'get', id: 'nope', since: 'x' })).toEqual({ tournament: null });
      expect(g.get({ action: 'all', lite: '1' }).tournaments[0].log).toEqual([]);
      expect(g.get({ action: 'players' }).players).toHaveLength(4);
      expect(g.get({ action: 'all' }).tournaments[0].log).toHaveLength(1);

      // a result fixed by hand in the sheet: onEdit marks the tournament as changed
      const rows = g.sheets.get('Results')!;
      const w = rows[0].indexOf('winner');
      rows[1][w] = 'p2';
      (g.ctx.onEdit as (e: unknown) => void)({ range: g.tab('Results').getRange(2, w + 1) });
      const after = g.get({ action: 'get', id: 'e1', since: first.tournament.updatedAt });
      expect(after.same).toBeUndefined();
      expect(after.tournament.results['W1-1'].winner).toBe('p2');
    });

    it('tidies a mixed-up sheet without the name column once, keeping every tournament the same', () => {
      const g = fakeGoogle();
      for (let n = 1; n <= 3; n++) g.post({ key: 'secret', action: 'save', tournament: ev(n) });
      const before = [1, 2, 3].map((n) => g.get({ action: 'get', id: 'e' + n }).tournament);
      // as an older script left it: no `tournament` column, rows of different tournaments interleaved
      for (const tab of ['Entrants', 'Results', 'Log']) {
        const rows = g.sheets.get(tab)!;
        for (const r of rows) r.splice(1, 1);
        const body = rows.slice(1).map((r) => [...r]);
        const mixed = body.filter((_, i) => i % 2).concat(body.filter((_, i) => !(i % 2)));
        mixed.forEach((r, i) => rows[i + 1].splice(0, rows[i + 1].length, ...r));
      }
      g.props.delete('LAYOUT');
      expect(blocks(g, 'Entrants').length).toBeGreaterThan(3);

      const after = [1, 2, 3].map((n) => g.get({ action: 'get', id: 'e' + n }).tournament);
      expect(after).toEqual(before);
      for (const tab of ['Entrants', 'Results', 'Log']) {
        expect(blocks(g, tab)).toEqual(['e3', 'e2', 'e1']);
        expect(g.sheets.get(tab)![0].slice(0, 3)).toEqual(['tournamentId', 'tournament', TAB_THIRD[tab]]);
      }
      expect(g.props.get('LAYOUT')).toBe('2');
    });

    // the real previous script, when git history is there (CI checks out only the latest commit)
    const hasOld = (() => {
      try {
        execSync('git cat-file -e dfa95ed:apps-script/Code.gs', { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    })();
    it.skipIf(!hasOld)('tidies a sheet written by the previous script once, keeping every tournament the same', () => {
      const dir = mkdtempSync(join(tmpdir(), 'tt-'));
      const old = join(dir, 'Code.gs');
      writeFileSync(old, execSync('git show dfa95ed:apps-script/Code.gs', { encoding: 'utf8' }));
      const g = fake({ adminKey: 'secret', codePath: old, rows: 200 });
      for (let n = 1; n <= 3; n++) g.post({ key: 'secret', action: 'save', tournament: ev(n) });
      // the old script moves a tournament's rows to the bottom on every save: mixed up
      const pins = g.post({ key: 'secret', action: 'pins', id: 'e1' }).pins;
      g.post({ action: 'report', id: 'e1', matchId: 'W1-2', pin: pins.e1p1, result: { winner: 'p1', p1: 'e1p1', p2: 'e1p2' } });
      g.post({ key: 'secret', action: 'save', tournament: g.get({ action: 'get', id: 'e2' }).tournament });
      const before = [1, 2, 3].map((n) => g.get({ action: 'get', id: 'e' + n }).tournament);
      expect(g.sheets.get('Entrants')![0]).not.toContain('tournament');

      vm.runInContext(readFileSync('apps-script/Code.gs', 'utf8'), g.ctx as vm.Context); // the owner pastes the new script
      // newer scripts add fields (an empty category); everything that was there stays the same
      const after = [1, 2, 3].map((n) => g.get({ action: 'get', id: 'e' + n }).tournament);
      expect(after).toEqual(before.map((t) => ({ ...t, category: after[0].category })));
      expect(after[0].category).toBe('');
      for (const tab of ['Entrants', 'Results', 'Log']) {
        expect(blocks(g, tab)).toEqual(['e3', 'e2', 'e1']);
        expect(g.sheets.get(tab)![0][1]).toBe('tournament');
      }
      expect(col(g, 'Results', 'tournament')).toContain('Event 1');
      expect(g.props.get('LAYOUT')).toBe('2');
    });
  });
});

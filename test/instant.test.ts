import { describe, expect, it } from 'vitest';
import { CACHE_DOCS, CACHE_KEY, DeviceCache } from '../src/app/lib/cache';
import { createSaveQueue } from '../src/app/lib/saveQueue';
import { emptyDoc } from '../src/app/lib/model';
import type { TournamentDoc } from '../src/app/lib/model';

function memory(limit = Infinity) {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (v.length > limit) throw new Error('QuotaExceededError');
      m.set(k, v);
    },
    removeItem: (k: string) => void m.delete(k),
  };
}

const t = (id: string, updatedAt: string, extra: Partial<TournamentDoc> = {}): TournamentDoc => ({
  ...emptyDoc(),
  id,
  name: id,
  updatedAt,
  log: [{ id: 'l', time: updatedAt, summary: 'x', changes: [] }],
  ...extra,
});

describe('device cache', () => {
  it('gives back what the sheet sent, newest copy first, and only for the same sheet', () => {
    const s = memory();
    const c = new DeviceCache('https://sheet/a', s);
    expect(c.peek('x')).toBeNull();
    expect(c.peekAll()).toBeNull();

    c.setList({ tournaments: [t('x', '2026-01-01'), t('y', '2026-01-01')], players: [{ id: 'p', name: 'P' }] });
    // a list entry has no log: not full
    expect(c.peek('x')).toMatchObject({ full: false, players: [{ id: 'p' }] });
    expect(c.peek('x')!.tournament.log).toEqual([]);

    c.remember(t('x', '2026-01-02'), [{ id: 'q', name: 'Q' }]);
    expect(c.peek('x')).toMatchObject({ full: true, tournament: { updatedAt: '2026-01-02' }, players: [{ id: 'q' }] });
    expect(c.peekAll()!.tournaments.map((d) => d.updatedAt)).toEqual(['2026-01-02', '2026-01-01']);

    // a save's answer keeps the players already cached
    c.remember(t('x', '2026-01-03'));
    expect(c.peek('x')!.players).toEqual([{ id: 'q', name: 'Q' }]);

    // the list got newer than the opened copy: the list wins (and isn't full)
    c.setList({ tournaments: [t('x', '2026-01-09')], players: [] });
    expect(c.peek('x')).toMatchObject({ full: false, tournament: { updatedAt: '2026-01-09' } });

    c.forget('x');
    expect(c.peek('x')).toBeNull();

    // another sheet: nothing
    expect(new DeviceCache('https://sheet/b', s).peekAll()).toBeNull();
  });

  it('keeps only the most recent tournaments, and survives a full or broken storage', () => {
    const s = memory();
    let clock = 0;
    const c = new DeviceCache('u', s, () => ++clock);
    for (let i = 0; i < CACHE_DOCS + 5; i++) c.remember(t('t' + i, '2026'));
    expect(c.peek('t0')).toBeNull();
    expect(c.peek('t' + (CACHE_DOCS + 4))).not.toBeNull();
    expect(Object.keys(JSON.parse(s.m.get(CACHE_KEY)!).docs)).toHaveLength(CACHE_DOCS);

    // storage too small for everything: keeps the newest few rather than failing
    const small = memory(2500);
    const c2 = new DeviceCache('u', small, () => ++clock);
    for (let i = 0; i < 10; i++) c2.remember(t('t' + i, '2026'));
    expect(c2.peek('t9')).not.toBeNull();

    s.m.set(CACHE_KEY, '{not json');
    expect(new DeviceCache('u', s).peek('t1')).toBeNull();
    expect(new DeviceCache('u', undefined).peek('t1')).toBeNull();
  });
});

describe('background save queue', () => {
  type D = { version: number; v: string };
  const deferred = <T>() => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
    return { promise, resolve, reject };
  };

  it('saves one after another, each with the version of the last answer', async () => {
    const sent: D[] = [];
    let server = 5;
    const shown: string[] = [];
    const q = createSaveQueue<D>({
      send: async (d) => {
        sent.push(d);
        if (d.version !== server) throw new Error('conflict');
        server++;
        return { ...d, version: server };
      },
      onSaved: (d, left) => !left && shown.push(d.v),
      onFailed: () => shown.push('failed'),
    });
    q.confirmed = { version: 5, v: 'start' };
    const ready = deferred<void>();
    // both built on the page's copy (version 5), the second on top of the first
    const a = q.push({ version: 5, v: 'a' }, ready.promise);
    const b = q.push({ version: 5, v: 'ab' }, ready.promise);
    expect(q.pending).toBe(2);
    expect(sent).toHaveLength(0); // waits for the first load
    ready.resolve();
    expect(await a).toBe(true);
    expect(await b).toBe(true);
    expect(sent.map((d) => d.version)).toEqual([5, 6]);
    expect(shown).toEqual(['ab']);
    expect(q.confirmed).toEqual({ version: 7, v: 'ab' });
    expect(q.pending).toBe(0);
  });

  it('drops the saves after a failed one and reports it once', async () => {
    const first = deferred<D>();
    const sent: string[] = [];
    const failed: unknown[] = [];
    const q = createSaveQueue<D>({
      send: (d) => {
        sent.push(d.v);
        return d.v === 'a' ? first.promise : Promise.resolve({ ...d, version: d.version + 1 });
      },
      onSaved: () => {},
      onFailed: (e) => failed.push(e),
    });
    q.confirmed = { version: 1, v: '' };
    const a = q.push({ version: 1, v: 'a' });
    const b = q.push({ version: 1, v: 'ab' });
    first.reject(new Error('offline'));
    expect(await a).toBe(false);
    expect(await b).toBe(false);
    expect(sent).toEqual(['a']);
    expect(failed).toHaveLength(1);
    expect(q.confirmed).toEqual({ version: 1, v: '' });

    // later saves work again
    expect(await q.push({ version: 1, v: 'c' })).toBe(true);
    await q.idle();
    expect(q.confirmed).toEqual({ version: 2, v: 'c' });
  });
});

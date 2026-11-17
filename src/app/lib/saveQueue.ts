/**
 * Saves that run in the background, one after another, so the page can show a change at once.
 *
 * Each change is built on the page's latest (not yet saved) copy, so it carries an old `version`;
 * it's sent with the version of the sheet's last answer instead. If a save fails, the saves queued
 * after it are dropped (they were built on top of it) and `onFailed` puts the page back.
 */
export interface SaveQueue<T extends { version: number }, M = undefined> {
  /** The sheet's copy: after a load, and after each save. */
  confirmed: T | null;
  /** Saves not finished yet. */
  readonly pending: number;
  /** Queue a save. Resolves true once it's stored, false if it (or one before it) failed. */
  push(next: T, ready?: Promise<unknown>, meta?: M): Promise<boolean>;
  /** Resolves once every queued save has finished. */
  idle(): Promise<void>;
}

export function createSaveQueue<T extends { version: number }, M = undefined>(opts: {
  /** `meta`: whatever was pushed with it (e.g. new players to save with it). */
  send: (doc: T, meta?: M) => Promise<T>;
  /** One save went through; `left` = saves still queued. */
  onSaved: (saved: T, left: number) => void;
  /** A save failed: every queued save is dropped. */
  onFailed: (error: unknown) => void;
  onPending?: (pending: number) => void;
}): SaveQueue<T, M> {
  let tail: Promise<unknown> = Promise.resolve();
  let generation = 0;
  let pending = 0;
  const q: SaveQueue<T, M> = {
    confirmed: null,
    get pending() {
      return pending;
    },
    idle() {
      return tail.then(() => undefined);
    },
    push(next, ready = Promise.resolve(), meta) {
      const gen = generation;
      pending++;
      opts.onPending?.(pending);
      const run = tail
        .then(() => ready)
        .catch(() => undefined) // a failed first load: try anyway, the sheet will say if it's out of date
        .then(async () => {
          if (gen !== generation) return false;
          try {
            const saved = await opts.send(q.confirmed ? { ...next, version: q.confirmed.version } : next, meta);
            q.confirmed = saved;
            opts.onSaved(saved, pending - 1);
            return true;
          } catch (e) {
            generation++;
            opts.onFailed(e);
            return false;
          }
        })
        .catch(() => false)
        .finally(() => {
          pending--;
          opts.onPending?.(pending);
        });
      tail = run;
      return run;
    },
  };
  return q;
}

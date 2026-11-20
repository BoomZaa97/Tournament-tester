// A fake of the Google Apps Script services Code.gs uses, backed by an in-memory spreadsheet.
// Used by the tests (test/appsScript.test.ts) and the local fake server (scripts/fake-sheet-server.mjs).
// Like real Google Sheets, a tab has a fixed number of rows (new tabs start with `rows` empty rows),
// ranges outside it throw, deleting every row under the frozen header throws, and cells hold at most
// 50,000 characters.
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export function fakeGoogle({ adminKey = 'secret', codePath = 'apps-script/Code.gs', rows = 30 } = {}) {
  const props = new Map([['ADMIN_KEY', adminKey]]);
  /** name -> { grid: string[][] (one array per sheet row, all of them), frozen } */
  const tabs = new Map();
  /** name -> the rows that have something in them (what tests look at), like getDataRange */
  const sheets = {
    get: (name) => {
      const t = tabs.get(name);
      return t ? t.grid.slice(0, lastRow(t)) : undefined;
    },
    has: (name) => tabs.has(name),
    /** For tests that edit the sheet "by hand". */
    set: (name, r, c, value) => (tabs.get(name).grid[r][c] = String(value)),
    dump: () => Object.fromEntries([...tabs.keys()].map((n) => [n, sheets.get(n)])),
  };

  const filled = (row) => row.some((v) => v !== '');
  const lastRow = (t) => {
    for (let i = t.grid.length - 1; i >= 0; i--) if (filled(t.grid[i])) return i + 1;
    return 0;
  };
  const lastCol = (t) => {
    let n = 0;
    for (const row of t.grid) for (let j = row.length - 1; j >= n; j--) if (row[j] !== '') n = j + 1;
    return n;
  };

  const sheet = (name) => {
    const t = tabs.get(name);
    const check = (r, c, nr, nc) => {
      if (!(nr >= 1 && nc >= 1)) throw new Error('The number of rows and columns in the range must be at least 1.');
      if (r < 1 || c < 1 || r + nr - 1 > t.grid.length || c + nc - 1 > 26) {
        throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
      }
    };
    const api = {
      getName: () => name,
      getMaxRows: () => t.grid.length,
      getLastRow: () => lastRow(t),
      getLastColumn: () => lastCol(t),
      getDataRange: () => api.getRange(1, 1, Math.max(lastRow(t), 1), Math.max(lastCol(t), 1)),
      setFrozenRows: (n) => void (t.frozen = n),
      insertRowsAfter: (r, n) => {
        if (r < 1 || r > t.grid.length) throw new Error('Those rows are out of bounds.');
        t.grid.splice(r, 0, ...Array.from({ length: n }, () => []));
      },
      deleteRows: (r, n) => {
        if (r < 1 || r + n - 1 > t.grid.length) throw new Error('Those rows are out of bounds.');
        if (t.grid.length - n <= t.frozen) throw new Error('Sorry, it is not possible to delete all non-frozen rows.');
        t.grid.splice(r - 1, n);
      },
      insertColumnAfter: (c) => {
        for (const row of t.grid) if (row.length > c) row.splice(c, 0, '');
      },
      getRange: (r, c, nr = 1, nc = 1) => {
        check(r, c, nr, nc);
        const cells = (fn) => {
          for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) fn(t.grid[r - 1 + i], c - 1 + j, i, j);
        };
        const range = {
          getSheet: () => api,
          getRow: () => r,
          getNumRows: () => nr,
          getValues: () => {
            const out = Array.from({ length: nr }, () => Array(nc).fill(''));
            cells((row, k, i, j) => (out[i][j] = row[k] ?? ''));
            return out;
          },
          setValues: (vals) => {
            if (vals.length !== nr || vals.some((v) => v.length !== nc)) throw new Error('The number of rows or columns in the data does not match the range.');
            for (const v of vals.flat()) if (String(v).length > 50000) throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.');
            cells((row, k, i, j) => {
              while (row.length < k) row.push('');
              row[k] = String(vals[i][j]);
            });
            return range;
          },
          clearContent: () => {
            cells((row, k) => k < row.length && (row[k] = ''));
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

  // CacheService: entries expire on a clock tests can move forward (`advance(ms)`)
  let clock = 0;
  const cache = new Map();
  const cached = (k) => {
    const e = cache.get(k);
    if (e && e.expires <= clock) cache.delete(k);
    return cache.get(k)?.value ?? null;
  };
  // UrlFetchApp: never touches the internet; records each request and answers with `reply`
  const fetched = [];
  let reply = () => ({ code: 204, body: '' });
  const ctx = {
    UrlFetchApp: {
      fetch: (url, options = {}) => {
        fetched.push({ url, options });
        const r = reply(url, options);
        return { getResponseCode: () => r.code, getContentText: () => r.body };
      },
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => cached(k),
        getAll: (ks) => Object.fromEntries(ks.filter((k) => cached(k) !== null).map((k) => [k, cached(k)])),
        put: (k, v, secs = 600) => void cache.set(k, { value: String(v), expires: clock + Math.min(secs, 21600) * 1000 }),
        putAll: (o, secs = 600) => {
          for (const [k, v] of Object.entries(o)) cache.set(k, { value: String(v), expires: clock + Math.min(secs, 21600) * 1000 });
        },
        remove: (k) => void cache.delete(k),
      }),
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => (tabs.has(n) ? sheet(n) : null),
        insertSheet: (n) => {
          tabs.set(n, { grid: Array.from({ length: rows }, () => []), frozen: 0 });
          return sheet(n);
        },
      }),
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (text) => ({ setMimeType: () => ({ text }) }) },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => void props.set(k, String(v)) }),
    },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      // Apps Script returns signed bytes (-128..127)
      MacAlgorithm: { HMAC_SHA_1: 'sha1' },
      // byte-array form (Apps Script bytes are signed)
      computeHmacSignature: (alg, v, k) =>
        [...createHmac(alg, Buffer.from(k.map((b) => b & 255))).update(Buffer.from(v.map((b) => b & 255))).digest()].map((b) =>
          b > 127 ? b - 256 : b,
        ),
      computeHmacSha256Signature: (v, k) => [...createHmac('sha256', k).update(v, 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
      getUuid: () => randomUUID(),
      computeDigest: (_alg, s) => [...createHash('sha256').update(s, 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(codePath, 'utf8'), ctx);

  return {
    ctx,
    props,
    /** Move the CacheService clock forward. */
    advance: (ms) => void (clock += ms),
    /** Every UrlFetchApp request Code.gs made, oldest first. */
    fetched,
    /** How the fake internet answers: (url, options) => {code, body}. */
    onFetch: (fn) => void (reply = fn),
    sheets,
    /** A sheet tab as Code.gs sees it (e.g. to call onEdit with one of its ranges). */
    tab: (name) => sheet(name),
    get: (params) => JSON.parse(ctx.doGet({ parameter: params }).text),
    post: (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text),
  };
}

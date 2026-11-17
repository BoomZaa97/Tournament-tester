// Runs apps-script/Code.gs against an in-memory spreadsheet and serves it over HTTP,
// so the site can be tested end to end without touching the real Google Sheet.
// usage: npm run sheet:fake   (or: node scripts/fake-sheet-server.mjs [Code.gs path] [port] [adminKey])
// Then in the dev site run: localStorage.setItem("tt.settings.v1", JSON.stringify({source: "sheets", sheetsUrl: "http://localhost:5180/exec", adminKey: ""}))
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import vm from 'node:vm';

const [codePath = 'apps-script/Code.gs', port = '5180', adminKey = 'test-admin'] = process.argv.slice(2);
const sheets = new Map();
const props = new Map([['ADMIN_KEY', adminKey]]);
const sheet = (name) => {
  const grid = () => sheets.get(name);
  const ensure = (r, c) => {
    const g = grid();
    while (g.length < r) g.push([]);
    for (const row of g) while (row.length < c) row.push('');
  };
  return {
    getDataRange: () => ({ getValues: () => grid().map((r) => [...r]) }),
    getLastRow: () => grid().length,
    getLastColumn: () => Math.max(0, ...grid().map((r) => r.length)),
    setFrozenRows: () => {},
    getRange: (r, c, nr, nc) => {
      const range = {
        setValues: (vals) => {
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
          while (grid().length > 1 && grid()[grid().length - 1].every((v) => v === '')) grid().pop();
          return range;
        },
        setNumberFormat: () => range,
        setFontWeight: () => range,
      };
      return range;
    },
  };
};
const ctx = {
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({
      getSheetByName: (n) => (sheets.has(n) ? sheet(n) : null),
      insertSheet: (n) => (sheets.set(n, []), sheet(n)),
    }),
  },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (text) => ({ setMimeType: () => ({ text }) }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => void props.set(k, v) }) },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' },
    Charset: { UTF_8: 'utf8' },
    computeHmacSha256Signature: (v, k) => [...createHmac('sha256', k).update(v, 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
    getUuid: () => randomUUID(),
    computeDigest: (_a, s) => [...createHash('sha256').update(s, 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
  },
};
vm.createContext(ctx);
vm.runInContext(readFileSync(codePath, 'utf8'), ctx);

http
  .createServer((req, res) => {
    const send = (text) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(text);
    };
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/dump') return send(JSON.stringify(Object.fromEntries(sheets)));
    if (req.method === 'GET') return send(ctx.doGet({ parameter: Object.fromEntries(url.searchParams) }).text);
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => send(ctx.doPost({ postData: { contents: body } }).text));
  })
  .listen(Number(port), () => console.log(`fake sheet on http://localhost:${port}/exec`));

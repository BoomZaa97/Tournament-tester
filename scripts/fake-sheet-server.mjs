// Runs apps-script/Code.gs against an in-memory spreadsheet and serves it over HTTP,
// so the site can be tested end to end without touching the real Google Sheet.
// usage: npm run sheet:fake   (or: node scripts/fake-sheet-server.mjs [Code.gs path] [port] [adminKey])
// Then in the dev site run: localStorage.setItem("tt.settings.v1", JSON.stringify({source: "sheets", sheetsUrl: "http://localhost:5180/exec", adminKey: ""}))
// GET /dump shows every tab. SHEET_DELAY=5000 makes every answer as slow as the real Google script;
// GET /fail?n=1 makes the next n saves (POSTs) fail, to try what the site does then.
// Nothing goes to the internet: GET /fetched lists what Code.gs would have sent (Discord messages, Challonge requests).
import http from 'node:http';
import { fakeGoogle } from './fake-google.mjs';

const [codePath = 'apps-script/Code.gs', port = '5180', adminKey = 'test-admin'] = process.argv.slice(2);
const g = fakeGoogle({ adminKey, codePath, rows: 1000 });
const delay = Number(process.env.SHEET_DELAY ?? 0);
let failNext = 0;

// Challonge stand-in: any api.challonge.com request gets this finished 8-player bracket
// (key "bad-key-0000" gets 401, link ".../missing" gets 404). Discord etc. still get 204.
const names = ['Pha', 'Bank', 'Mint', 'Ton', 'Fah', 'Nok', 'Beam', 'Golf'];
let mid = 1;
const cm = (round, a, b, w, scores, extra = {}) => ({
  match: { id: mid++, round, player1_id: 10 + a, player2_id: 10 + b, winner_id: 10 + w, scores_csv: scores, state: 'complete', forfeited: false, completed_at: '2026-10-03T13:00:00.000Z', ...extra },
});
const demo = {
  tournament: {
    name: 'Demo Cup (fake Challonge)',
    tournament_type: 'single elimination',
    game_name: 'Street Fighter 6',
    hold_third_place_match: false,
    started_at: '2026-10-03T12:00:00.000Z',
    participants: names.map((name, i) => ({ participant: { id: 10 + i, name, display_name: name, seed: i + 1 } })),
    matches: [
      cm(1, 0, 7, 0, '2-0'), cm(1, 3, 4, 4, '1-2'), cm(1, 1, 6, 1, '2-1'), cm(1, 2, 5, 2, '2-0'),
      cm(2, 0, 4, 0, '2-1'), cm(2, 1, 2, 2, '0-2'),
      cm(3, 0, 2, 2, '3-1,1-3,2-3'),
      cm(9, 7, 6, 7, '2-0'), // a friendly that has no place in the bracket
    ],
  },
};
g.onFetch((u) => {
  if (!u.startsWith('https://api.challonge.com/')) return { code: 204, body: '' };
  if (u.includes('api_key=bad-key-0000')) return { code: 401, body: '' };
  if (u.includes('/missing.json')) return { code: 404, body: '' };
  return { code: 200, body: JSON.stringify(demo) };
});

http
  .createServer((req, res) => {
    const send = (text) =>
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(text);
      }, delay);
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/dump') return send(JSON.stringify(g.sheets.dump()));
    if (url.pathname === '/fetched') return send(JSON.stringify(g.fetched));
    if (url.pathname === '/fail') return send(JSON.stringify({ failNext: (failNext = Number(url.searchParams.get('n') ?? 1)) }));
    if (req.method === 'GET') return send(g.ctx.doGet({ parameter: Object.fromEntries(url.searchParams) }).text);
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      if (failNext > 0) return failNext--, send(JSON.stringify({ error: 'Simulated failure' }));
      send(g.ctx.doPost({ postData: { contents: body } }).text);
    });
  })
  .listen(Number(port), () => console.log(`fake sheet on http://localhost:${port}/exec`));

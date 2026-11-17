// Runs apps-script/Code.gs against an in-memory spreadsheet and serves it over HTTP,
// so the site can be tested end to end without touching the real Google Sheet.
// usage: npm run sheet:fake   (or: node scripts/fake-sheet-server.mjs [Code.gs path] [port] [adminKey])
// Then in the dev site run: localStorage.setItem("tt.settings.v1", JSON.stringify({source: "sheets", sheetsUrl: "http://localhost:5180/exec", adminKey: ""}))
// GET /dump shows every tab.
import http from 'node:http';
import { fakeGoogle } from './fake-google.mjs';

const [codePath = 'apps-script/Code.gs', port = '5180', adminKey = 'test-admin'] = process.argv.slice(2);
const g = fakeGoogle({ adminKey, codePath, rows: 1000 });

http
  .createServer((req, res) => {
    const send = (text) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(text);
    };
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/dump') return send(JSON.stringify(g.sheets.dump()));
    if (req.method === 'GET') return send(g.ctx.doGet({ parameter: Object.fromEntries(url.searchParams) }).text);
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => send(g.ctx.doPost({ postData: { contents: body } }).text));
  })
  .listen(Number(port), () => console.log(`fake sheet on http://localhost:${port}/exec`));

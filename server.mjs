import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { initialize, advance, snapshot, pool } from './db.mjs';
import { planOnce, plannerStatus, plannerPollMs } from './planner.mjs';
import { LOCATIONS } from './sim.mjs';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const files = new Map([
  ['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']],
  ['/map.js', ['map.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']],
  ['/crest.svg', ['crest.svg', 'image/svg+xml']]
]);
await initialize();
const server = http.createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
    if (path === '/api/village') {
      const state = await snapshot();
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ...state, locations: LOCATIONS, planner: plannerStatus }));
    } else if (files.has(path)) {
      const [file, type] = files.get(path);
      const body = await readFile(new URL('./public/' + file, import.meta.url));
      res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' }).end(body);
    } else { res.writeHead(404).end(); }
  } catch { res.writeHead(503, { 'Content-Type': 'text/plain' }).end('Dalecrest is temporarily unavailable.'); }
});
let advancing = false;
const clock = setInterval(async () => {
  if (advancing) return;
  advancing = true;
  try { await advance(); }
  catch { console.error('Village tick could not be committed. Retrying on next tick.'); }
  finally { advancing = false; }
}, 1000);
const planner = setInterval(planOnce, plannerPollMs);
server.listen(port, host, () => {
  console.log('Dalecrest is listening at http://' + host + ':' + port);
  planOnce();
});
function shutdown() {
  clearInterval(clock); clearInterval(planner);
  server.close(() => pool.end());
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

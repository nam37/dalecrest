import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { initialize, advance, snapshot, currentMap, pool } from './db.mjs';
import { planOnce, plannerStatus, plannerPollMs } from './planner.mjs';
import { locationsOf } from './sim.mjs';
import { affairs } from './engine/civic.mjs';
import { requestArchive } from './request-archive.mjs';
import { dailyArchive, publishNextDaily } from './daily.mjs';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const types = { html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', woff2: 'font/woff2' };
// Everything the browser may fetch, listed once at startup. The engine modules are shared with the page.
const files = new Map([['/', new URL('./public/index.html', import.meta.url)], ['/sim.mjs', new URL('./sim.mjs', import.meta.url)]]);
for (const name of await readdir(new URL('./public/', import.meta.url))) files.set('/' + name, new URL('./public/' + name, import.meta.url));
for (const name of await readdir(new URL('./engine/', import.meta.url))) files.set('/engine/' + name, new URL('./engine/' + name, import.meta.url));
for (const name of ['three.module.min.js', 'three.core.min.js']) files.set('/vendor/' + name, new URL('./node_modules/three/build/' + name, import.meta.url));
// The typefaces are npm dependencies too, so the page still loads nothing from another host.
const faces = { 'im-fell-english': ['400-normal', '400-italic'], 'im-fell-english-sc': ['400-normal'], alegreya: ['400-normal', '400-italic', '600-normal'] };
for (const [family, cuts] of Object.entries(faces)) {
  for (const cut of cuts) {
    const name = family + '-latin-' + cut + '.woff2';
    files.set('/vendor/fonts/' + name, new URL('./node_modules/@fontsource/' + family + '/files/' + name, import.meta.url));
  }
}

await initialize();
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
    if (path === '/api/village') {
      const { map, ...state } = await snapshot({ withMap: true });
      const knownRevision = url.searchParams.get('mapRevision');
      const includeMap = knownRevision !== null && knownRevision !== String(map.revision);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ...state, map: includeMap ? map : undefined,
        locations: locationsOf(map, state.actors), affairs: affairs({ ...state, map }), planner: plannerStatus }));
    } else if (path === '/api/requests' || path.startsWith('/api/requests/')) {
      const { status, body } = await requestArchive(pool, url);
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    } else if (path === '/api/daily') {
      const { status, body } = await dailyArchive(pool, url.searchParams.get('day'));
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    } else if (path === '/api/map') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(await currentMap()));
    } else if (files.has(path)) {
      const file = files.get(path);
      const body = await readFile(file);
      if (path.startsWith('/vendor/')) res.setHeader('Cache-Control', 'public, max-age=604800');
      res.writeHead(200, { 'Content-Type': types[file.pathname.split('.').pop()] + '; charset=utf-8' }).end(body);
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
const editDaily = () => publishNextDaily(pool).catch(error => {
  console.error('Dalecrest Daily publication delayed.', error.message);
});
const press = setInterval(editDaily, 5000);
server.listen(port, host, () => {
  console.log('Dalecrest is listening at http://' + host + ':' + port);
  planOnce();
  editDaily();
});
function shutdown() {
  clearInterval(clock); clearInterval(planner); clearInterval(press);
  server.close(() => pool.end());
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

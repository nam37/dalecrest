import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { initialize, advance, nextTickDelay, snapshot, currentMap, pool, recentEvents, reviewGoalsOnce, draftSongOnce, publishCivicAccountOnce, listenForVillageChanges } from './db.mjs';
import { planOnce, plannerStatus, plannerPollMs } from './planner.mjs';
import { locationsOf } from './sim.mjs';
import { affairs } from './engine/civic.mjs';
import { requestArchive } from './request-archive.mjs';
import { dailyArchive, publishNextDaily, searchDaily } from './daily.mjs';
import { dailyIllustrations } from './engine/daily-illustrations.mjs';
import { createVillageStream } from './village-stream.mjs';
import { mapRevisions, mapRevision, residentHeat } from './village-history.mjs';
import { recordPage } from './record-pages.mjs';
import { recordPath } from './public/record-links.js';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const songwritingPilot = process.env.VILLAGE_SONGWRITING === '1';
const types = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', svg: 'image/svg+xml; charset=utf-8', webp: 'image/webp', woff2: 'font/woff2',
};
// Everything the browser may fetch, listed once at startup. The engine modules are shared with the page.
const files = new Map([['/', new URL('./public/index.html', import.meta.url)], ['/sim.mjs', new URL('./sim.mjs', import.meta.url)]]);
for (const entry of await readdir(new URL('./public/', import.meta.url), { withFileTypes: true })) {
  if (entry.isFile()) files.set('/' + entry.name, new URL('./public/' + entry.name, import.meta.url));
}
for (const { src } of Object.values(dailyIllustrations).flat()) files.set(src, new URL('./public' + src, import.meta.url));
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
async function villageState() {
  const state = await snapshot({ withMap: true });
  return { ...state, locations: locationsOf(state.map, state.actors), affairs: affairs(state), planner: { ...plannerStatus } };
}
const stream = createVillageStream(villageState);
const stopListening = listenForVillageChanges(stream.changed);
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}

function siteNavigation(path) {
  const home = path === '/' || path === '/index.html' ? '' : '/';
  const link = (href, label) => `<a href="${href}"${href === path ? ' aria-current="page"' : ''}>${label}</a>`;
  const primary = `${link(home + '#village', 'Village')}${link(home + '#residents', 'Residents')}${link(home + '#chronicle', 'Chronicle')}`;
  const publications = `${link('/daily.html', 'Dalecrest Daily')}${songwritingPilot ? link('/residents/robin#journal', 'Robin’s Journal') : ''}`;
  const more = `${link('/following.html', 'Following')}${link('/growth.html', 'Growth')}${link('/atlas.html', 'Sandbox')}${link('/development.html', 'Development')}`;
  return `<nav class="site-nav" aria-label="Observatory">
    ${primary}<div class="site-publications">${publications}</div>
    <details class="site-more"><summary>More</summary><div class="site-more-links">${more}</div></details>
  </nav>
  <details class="mobile-site-menu">
    <summary class="mobile-site-toggle"><span class="site-menu-icon" aria-hidden="true"></span>Menu</summary>
    <nav class="mobile-site-links" aria-label="Observatory">
      ${primary}${publications}
      <div class="mobile-site-more" role="group" aria-label="More"><span aria-hidden="true">More</span>${more}</div>
    </nav>
  </details>
  <script type="module" src="/site-navigation.js"></script>`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const page = recordPath(path);
    const heat = path.match(/^\/api\/residents\/([a-z0-9-]+)\/heat-map$/);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
    if (path === '/api/village/stream') stream.subscribe(res, req.method === 'HEAD');
    else if (path === '/api/village') {
      const { map, ...state } = await villageState();
      const knownRevision = url.searchParams.get('mapRevision');
      const includeMap = knownRevision !== null && knownRevision !== String(map.revision);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ...state, map: includeMap ? map : undefined }));
    } else if (path === '/api/events') {
      const kind = url.searchParams.get('type');
      if (kind && !/^[a-z]{1,20}$/.test(kind)) { res.writeHead(400).end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(await recentEvents(kind)));
    } else if (path === '/api/requests' || path.startsWith('/api/requests/')) {
      const { status, body } = await requestArchive(pool, url);
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    } else if (path === '/api/daily') {
      const { status, body } = await dailyArchive(pool, url.searchParams.get('day'));
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    } else if (path === '/api/daily/search') {
      const { status, body } = await searchDaily(pool, url.searchParams.get('q'), url.searchParams.get('page'));
      json(res, status, body);
    } else if (path.startsWith('/api/records/')) {
      const ref = recordPath(path.slice('/api/records'.length));
      if (!ref) { json(res, 400, { error: 'Invalid record address.' }); return; }
      const { status, body } = ref.kind === 'promises'
        ? await requestArchive(pool, new URL('/api/requests/' + ref.id + url.search, url))
        : await recordPage(pool, ref, url.searchParams);
      json(res, status, body);
    } else if (path === '/api/map/revisions') {
      const raw = url.searchParams.get('revision');
      if (raw === null) { json(res, 200, await mapRevisions(pool)); return; }
      const revision = Number(raw);
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(revision)) { json(res, 400, { error: 'Invalid map revision.' }); return; }
      const frame = await mapRevision(pool, revision);
      json(res, frame ? 200 : 404, frame ?? { error: 'Map revision not found.' });
    } else if (heat) {
      const raw = url.searchParams.get('days') ?? '7';
      if (!['7', '30', 'all'].includes(raw)) { json(res, 400, { error: 'Invalid lookback.' }); return; }
      const data = await residentHeat(pool, heat[1], raw === 'all' ? null : Number(raw));
      json(res, data ? 200 : 404, data ?? { error: 'Resident not found.' });
    } else if (path === '/api/map') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(await currentMap()));
    } else if (page || files.has(path)) {
      const file = files.get(page ? page.kind === 'promises' ? '/requests.html' : '/record.html' : path);
      const extension = file.pathname.split('.').pop();
      const body = extension === 'html' ? (await readFile(file, 'utf8')).replace('<!-- site-navigation -->', siteNavigation(path)) : await readFile(file);
      if (path.startsWith('/vendor/')) res.setHeader('Cache-Control', 'public, max-age=604800');
      res.writeHead(200, { 'Content-Type': types[extension] }).end(body);
    } else { res.writeHead(404).end(); }
  } catch { res.writeHead(503, { 'Content-Type': 'text/plain' }).end('Dalecrest is temporarily unavailable.'); }
});
let clock, stopping = false;
async function runClock() {
  let delay = 1000;
  try {
    await advance();
    if (!stopping) delay = await nextTickDelay();
  } catch { console.error('Village tick could not be committed. Retrying on next tick.'); }
  if (!stopping) clock = setTimeout(runClock, Math.max(20, delay));
}
async function plan() {
  const before = plannerStatus.state;
  await planOnce();
  if (plannerStatus.state !== before) stream.changed();
}
const planner = setInterval(plan, plannerPollMs);
const editDaily = () => publishNextDaily(pool).catch(error => {
  console.error('Dalecrest Daily publication delayed.', error.message);
});
const press = setInterval(editDaily, 5000);
let writingAccount = false;
const accounts = setInterval(async () => {
  if (writingAccount) return;
  writingAccount = true;
  try { await publishCivicAccountOnce(); }
  catch (error) { console.error('A civic account could not be published.', error.message); }
  finally { writingAccount = false; }
}, 30000);
// Goal reviews, one at a time, under their own spending cap.
let reviewing = false;
const reviews = setInterval(async () => {
  if (reviewing) return;
  reviewing = true;
  try { await reviewGoalsOnce(); }
  catch (error) { console.error('A goal review could not be completed.', error.message); }
  finally { reviewing = false; }
}, 4000);
let drafting = false;
const songs = setInterval(async () => {
  if (drafting) return;
  drafting = true;
  try { await draftSongOnce(); }
  catch (error) { console.error('A songwriting session could not be drafted.', error.message); }
  finally { drafting = false; }
}, 7000);
server.listen(port, host, () => {
  console.log('Dalecrest is listening at http://' + host + ':' + port);
  runClock();
  plan();
  editDaily();
});
function shutdown() {
  stopping = true;
  clearTimeout(clock); clearInterval(planner); clearInterval(press); clearInterval(reviews); clearInterval(accounts); clearInterval(songs);
  stopListening();
  stream.close();
  server.close(() => pool.end());
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

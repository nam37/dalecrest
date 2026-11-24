import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIPv4 } from 'node:net';
import { adminAuth, loadCredentials } from './admin-auth.mjs';
import { openClockAudit } from './admin-audit.mjs';

const execute = promisify(execFile);
const modes = new Set(['1x', '2x', 'day-night']);
const maxBody = 4096;
const helper = '/usr/local/sbin/dalecrest-set-clock';
const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/admin.js', ['admin.js', 'text/javascript']],
  ['/charts.js', ['charts.js', 'text/javascript']],
  ['/echarts.js', ['../node_modules/echarts/dist/echarts.min.js', 'text/javascript']],
  ['/admin.css', ['admin.css', 'text/css']],
]);

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readJson(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new RequestError(415, 'Send a JSON request.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > maxBody) {
      req.resume();
      throw new RequestError(413, 'This request is too large.');
    }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new RequestError(400, 'This request contains invalid JSON.'); }
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
}

export function hostClockCommands() {
  const run = (args, timeout) => execute('/usr/bin/sudo', ['-n', '--', helper, ...args], { timeout, maxBuffer: 128 * 1024 });
  return {
    async health() { return JSON.parse((await run(['status'], 9000)).stdout); },
    async metrics() { return JSON.parse((await run(['metrics'], 12000)).stdout); },
    async set(mode, expected) { await run([mode, expected], 330000); },
  };
}

export async function createAdminServer({ publicOrigin, basePath = '', preview = false, villageName = 'Dalecrest', credentials, auditFile, clock }) {
  const origin = new URL(publicOrigin);
  const local = origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if ((origin.protocol !== 'https:' && !(preview && local)) || origin.pathname !== '/' || origin.search ||
      origin.hash || origin.username || origin.password) throw new Error('Set the HTTPS origin of the admin panel.');
  if (!/^(?:\/[a-z0-9][a-z0-9-]*)*$/.test(basePath)) {
    throw new Error('Set ADMIN_BASE_PATH to a path such as /admin without a trailing slash.');
  }
  const panelPath = basePath + '/';
  const auth = adminAuth(loadCredentials(credentials), { secure: !local, path: panelPath });
  const audit = await openClockAudit(auditFile);
  const validOrigin = req => req.headers.origin === origin.origin;
  let active = null, busy = false, cached, checked = 0, check;
  let metrics, metricsAt = 0, pendingMetrics;

  async function health(fresh = false) {
    if (fresh && check) await check;
    if (!fresh && Date.now() - checked < 2000) return cached;
    if (!check) {
      check = Promise.resolve().then(() => clock.health()).then(result => result, () => null).then(result => {
        checked = Date.now();
        cached = result;
        return result;
      }).finally(() => { check = null; });
    }
    return check;
  }

  async function recentMetrics() {
    if (!pendingMetrics && Date.now() - metricsAt >= 60000) {
      pendingMetrics = Promise.resolve().then(() => clock.metrics()).then(result => {
        metrics = result;
        metricsAt = Date.now();
      }).catch(() => {}).finally(() => { pendingMetrics = null; });
    }
    if (pendingMetrics) await pendingMetrics;
    if (Date.now() - metricsAt >= 60000) throw new RequestError(503, 'Village chart data is temporarily unavailable.');
    return metrics;
  }

  async function apply(entry) {
    let succeeded = false;
    try {
      await clock.set(entry.requested, entry.before);
      succeeded = true;
    } catch { /* The host helper reports and handles rollback. */ }
    const result = await health(true);
    const effective = result?.clock.mode ?? null;
    const status = !succeeded ? 'failed' : effective === entry.requested ? 'verified' : 'unverified';
    await audit.write({ id: entry.id, status, effective, finishedAt: new Date().toISOString() });
  }

  async function requestChange(viewer, input) {
    const { mode, expected, reason, revert } = input || {};
    if (!modes.has(mode) || !modes.has(expected) || typeof reason !== 'string' || !reason.trim() || reason.trim().length > 300) {
      throw new RequestError(400, 'Choose a clock pace and give a reason of up to 300 characters.');
    }
    if (revert !== undefined) {
      const earlier = audit.find(revert);
      if (earlier?.status !== 'verified' || earlier.before !== mode) throw new RequestError(400, 'This record has no verified setting to restore.');
    }
    if (busy) throw new RequestError(409, 'A clock change is already in progress.');
    busy = true;
    try {
      const current = await health(true);
      if (!current?.clock.mode) throw new RequestError(503, 'The current preset could not be verified.');
      if (current.clock.mode !== expected) throw new RequestError(409, 'The live pace changed. Review it before applying a setting.');
      if (mode === expected) throw new RequestError(409, 'This clock pace is already active.');
      const entry = { id: randomUUID(), requestedBy: viewer.name, before: expected, requested: mode, reason: reason.trim(),
        requestedAt: new Date().toISOString(), status: 'applying', ...(revert && { reverts: revert }) };
      await audit.write(entry);
      active = entry;
      void apply(entry).catch(() => {
        // Keep new changes blocked when the previous action could not be recorded.
        console.error('Could not record the clock change outcome.');
      }).then(() => {
        if (audit.find(entry.id).status !== 'applying') { active = null; busy = false; }
      });
      return entry;
    } catch (error) {
      busy = false;
      throw error;
    }
  }

  return http.createServer({ requestTimeout: 10000, headersTimeout: 10000 }, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      if (req.headers.host !== origin.host) throw new RequestError(403, 'This host is outside the admin origin.');
      const pathname = new URL(req.url, origin).pathname;
      if (basePath && pathname === basePath && (req.method === 'GET' || req.method === 'HEAD')) {
        res.writeHead(308, { Location: panelPath }).end();
        return;
      }
      if (!pathname.startsWith(panelPath)) throw new RequestError(404, 'This admin address does not exist.');
      const path = pathname.slice(basePath.length);
      if (path === '/api/agent') {
        if (req.headers.origin && !validOrigin(req)) throw new RequestError(403, 'This request is outside the admin origin.');
        if (!auth.agent(req)) {
          res.setHeader('WWW-Authenticate', 'Bearer');
          throw new RequestError(401, 'An agent key is required.');
        }
        if (req.method !== 'GET') {
          res.setHeader('Allow', 'GET');
          throw new RequestError(405, 'Agent access is read-only.');
        }
        const changes = audit.recent().map(({ reason, ...entry }) => entry);
        return json(res, 200, { villageName, preview, health: await health(), active: changes.find(entry => entry.id === active?.id) ?? null, changes });
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        const asset = assets.get(path);
        if (asset) {
          const [file, type] = asset;
          const content = req.method === 'HEAD' ? undefined : await readFile(new URL('./admin-ui/' + file, import.meta.url));
          res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' }).end(content);
          return;
        }
      }
      if (req.method === 'POST' && !validOrigin(req)) throw new RequestError(403, 'This request is outside the admin origin.');
      if (req.method === 'POST' && path === '/api/session') {
        const result = await auth.login(req, await readJson(req));
        if (result.cookie) res.setHeader('Set-Cookie', result.cookie);
        return json(res, result.status, result.viewer ? { viewer: result.viewer }
          : { error: result.status === 429 ? 'Too many sign-in attempts. Try again later.' : 'The name or password was incorrect.' });
      }
      const viewer = auth.viewer(req);
      if (!viewer) throw new RequestError(401, 'Sign in to the admin panel.');
      if (req.method === 'POST' && path === '/api/logout') {
        res.setHeader('Set-Cookie', auth.logout(req));
        return json(res, 200, {});
      }
      if (req.method === 'GET' && path === '/api/status') {
        return json(res, 200, { viewer, villageName, preview, health: await health(), active });
      }
      if (req.method === 'GET' && path === '/api/metrics') return json(res, 200, await recentMetrics());
      if (req.method === 'GET' && path === '/api/changes') return json(res, 200, { changes: audit.recent() });
      if (req.method === 'POST' && path === '/api/clock') {
        if (viewer.role !== 'operator') throw new RequestError(403, 'Clock changes require an operator account.');
        const entry = await requestChange(viewer, await readJson(req));
        return json(res, 202, { change: entry });
      }
      throw new RequestError(404, 'This admin address does not exist.');
    } catch (error) {
      if (error instanceof RequestError) json(res, error.status, { error: error.message });
      else {
        console.error('An admin request could not be completed.');
        json(res, 500, { error: 'The admin request could not be completed.' });
      }
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = process.env;
  if (!env.ADMIN_ORIGIN || !env.ADMIN_CREDENTIALS || !env.ADMIN_AUDIT_FILE) {
    throw new Error('Set ADMIN_ORIGIN, ADMIN_CREDENTIALS and ADMIN_AUDIT_FILE.');
  }
  const port = Number(env.ADMIN_PORT || 4180);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Set a valid ADMIN_PORT.');
  const host = env.ADMIN_LISTEN_HOST || '127.0.0.1';
  const [first, second] = host.split('.').map(Number);
  if (!isIPv4(host) || !(first === 127 || first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168))) {
    throw new Error('Set ADMIN_LISTEN_HOST to a loopback or private IPv4 address.');
  }
  const server = await createAdminServer({
    publicOrigin: env.ADMIN_ORIGIN, basePath: env.ADMIN_BASE_PATH, villageName: env.ADMIN_VILLAGE_NAME,
    credentials: JSON.parse(await readFile(env.ADMIN_CREDENTIALS, 'utf8')),
    auditFile: env.ADMIN_AUDIT_FILE,
    clock: hostClockCommands(),
  });
  server.listen(port, host, () => console.log('Dalecrest administration is listening on ' + host + ':' + port));
}

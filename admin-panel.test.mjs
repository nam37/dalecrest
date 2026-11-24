import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createAdminServer } from './admin.mjs';
import { keyDigest, passwordHash } from './admin-auth.mjs';

const password = 'fixture password for dalecrest';
const agentKey = 'a'.repeat(43);
const wait = () => new Promise(resolve => setTimeout(resolve, 15));

test('operators can verify and restore the live pace and read-only credentials cannot change it', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dalecrest-admin-test-'));
  const hash = await passwordHash(password);
  const reservation = createServer().listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const origin = 'http://127.0.0.1:' + port;
  let mode = '1x', unblock, setCalls = [];
  const options = {
    publicOrigin: origin, preview: true, auditFile: path.join(directory, 'audit.ndjson'),
    credentials: { accounts: [{ name: 'operator', role: 'operator', password: hash }, { name: 'monitor', role: 'monitor', password: hash }],
      agentKeys: [{ name: 'fixture', digest: keyDigest(agentKey) }] },
    clock: {
      health: async () => ({ clock: { mode } }),
      async set(next, expected) {
        setCalls.push([next, expected]);
        assert.equal(expected, mode);
        if (next === '2x') await new Promise(resolve => { unblock = resolve; });
        if (next === 'day-night') throw new Error('The helper rejected the change.');
        mode = next;
      },
    },
  };
  let server;
  async function start() {
    server = await createAdminServer(options);
    server.listen(port, '127.0.0.1');
    await once(server, 'listening');
  }
  const close = () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  function request(route, { cookie, body, headers = {}, method } = {}) {
    return fetch(origin + route, { method: method ?? (body ? 'POST' : 'GET'), headers: {
      ...(body && { Origin: origin, 'Content-Type': 'application/json' }),
      ...(cookie && { Cookie: cookie }), ...headers,
    }, ...(body && { body: JSON.stringify(body) }) });
  }
  async function login(name) {
    const response = await request('/api/session', { body: { name, password } });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly; SameSite=Strict/);
    return cookie.split(';')[0];
  }
  async function awaitStatus(cookie, id, status) {
    for (let attempt = 0; attempt < 70; attempt++) {
      const { changes } = await (await request('/api/changes', { cookie })).json();
      const change = changes.find(entry => entry.id === id);
      if (change?.status === status) return change;
      await wait();
    }
    assert.fail('Expected clock change status ' + status);
  }
  try {
    await start();
    assert.equal((await request('/')).status, 200);
    assert.equal((await request('/api/status')).status, 401);
    assert.equal((await request('/api/agent')).status, 401);
    assert.equal((await request('/api/session', { body: { name: 'operator', password: 'wrong' } })).status, 401);
    assert.equal((await request('/api/session', { body: { name: 'operator', password }, headers: { Origin: 'https://elsewhere.example' } })).status, 403);
    const agent = { Authorization: 'Bearer fixture.' + agentKey };
    assert.equal((await request('/api/agent', { headers: agent })).status, 200);
    assert.equal((await request('/api/agent', { headers: agent, body: {} })).status, 405);
    assert.equal((await request('/api/status', { headers: agent })).status, 401);
    const proposed = { mode: '2x', expected: '1x', reason: 'Check the queue at a faster pace.' };
    const monitor = await login('monitor');
    assert.equal((await request('/api/clock', { cookie: monitor, body: proposed })).status, 403);
    assert.equal((await request('/api/clock', { headers: agent, body: proposed })).status, 401);
    let operator = await login('operator');
    assert.equal((await request('/api/clock', { cookie: operator, body: proposed, headers: { Origin: 'https://elsewhere.example' } })).status, 403);
    assert.equal((await request('/api/clock', { cookie: operator, body: { ...proposed, mode: '4x' } })).status, 400);
    assert.equal((await request('/api/clock', { cookie: operator, body: { ...proposed, expected: 'day-night' } })).status, 409);
    const accepted = await request('/api/clock', { cookie: operator, body: proposed });
    assert.equal(accepted.status, 202);
    const { change } = await accepted.json();
    assert.equal(change.requestedBy, 'operator');
    assert.equal((await request('/api/clock', { cookie: operator, body: proposed })).status, 409);
    assert.equal((await awaitStatus(operator, change.id, 'applying')).before, '1x');
    unblock();
    assert.equal((await awaitStatus(operator, change.id, 'verified')).effective, '2x');
    const agentStatus = await (await request('/api/agent', { headers: agent })).json();
    assert.equal(agentStatus.changes[0].effective, '2x');
    assert.equal(agentStatus.changes[0].reason, undefined);

    await close();
    await start();
    assert.equal((await request('/api/changes', { cookie: operator })).status, 401);
    operator = await login('operator');
    const restored = await request('/api/clock', { cookie: operator, body: {
      mode: '1x', expected: '2x', reason: 'End the trial.', revert: change.id,
    } });
    assert.equal(restored.status, 202);
    const { change: restore } = await restored.json();
    assert.equal((await awaitStatus(operator, restore.id, 'verified')).reverts, change.id);
    const failed = await request('/api/clock', { cookie: operator, body: { mode: 'day-night', expected: '1x', reason: 'Test a rejected change.' } });
    assert.equal(failed.status, 202);
    const { change: rejection } = await failed.json();
    assert.equal((await awaitStatus(operator, rejection.id, 'failed')).effective, '1x');
    assert.deepEqual(setCalls, [['2x', '1x'], ['1x', '2x'], ['day-night', '1x']]);
    assert.equal((await request('/api/logout', { cookie: operator, body: {} })).status, 200);
    assert.equal((await request('/api/status', { cookie: operator })).status, 401);
  } finally {
    unblock?.();
    if (server?.listening) await close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('the admin prefix scopes the page, browser session and agent API', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dalecrest-admin-prefix-test-'));
  let server;
  try {
    const reservation = createServer().listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    const host = '127.0.0.1:' + port;
    const origin = 'https://' + host;
    server = await createAdminServer({
      publicOrigin: origin, basePath: '/admin', auditFile: path.join(directory, 'audit.ndjson'),
      credentials: {
        accounts: [{ name: 'operator', role: 'operator', password: await passwordHash(password) }],
        agentKeys: [{ name: 'fixture', digest: keyDigest(agentKey) }],
      },
      clock: { health: async () => ({ clock: { mode: '1x' } }), metrics: async () => ({ tokens: [{ openai: 20 }] }) },
    });
    server.listen(port, '127.0.0.1');
    await once(server, 'listening');
    const request = (route, options) => fetch('http://' + host + route, { ...options, redirect: 'manual' });
    const redirect = await request('/admin');
    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.get('location'), '/admin/');
    const page = await request('/admin/');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /src="\.\/admin\.js"/);
    assert.equal((await request('/admin/admin.js')).status, 200);
    assert.equal((await request('/admin/charts.js')).status, 200);
    const chartLibrary = await request('/admin/echarts.js');
    assert.equal(chartLibrary.status, 200);
    assert.ok((await chartLibrary.arrayBuffer()).byteLength > 1000);
    assert.equal((await request('/admin/admin.css')).status, 200);
    assert.equal((await request('/')).status, 404);
    assert.equal((await request('/api/agent')).status, 404);
    assert.equal((await request('/administrator')).status, 404);

    const login = await request('/admin/api/session', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'operator', password }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie');
    assert.match(cookie, /^__Secure-dalecrest-admin=[^;]+; Path=\/admin\/; HttpOnly; SameSite=Strict; .*; Secure$/);
    const session = { Cookie: cookie.split(';')[0] };
    assert.equal((await request('/admin/api/status', { headers: session })).status, 200);
    const metrics = await request('/admin/api/metrics', { headers: session });
    assert.equal(metrics.status, 200);
    assert.deepEqual(await metrics.json(), { tokens: [{ openai: 20 }] });

    const headers = { Authorization: 'Bearer fixture.' + agentKey };
    assert.equal((await request('/admin/api/agent', { headers })).status, 200);
    assert.equal((await request('/admin/api/agent', { headers, method: 'POST' })).status, 405);
    assert.equal((await request('/admin/api/status', { headers })).status, 401);
    assert.equal((await request('/admin/api/metrics', { headers })).status, 401);
  } finally {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

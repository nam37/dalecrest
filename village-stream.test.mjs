import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { setImmediate as flushed } from 'node:timers/promises';
import test from 'node:test';
import pg from 'pg';
import { createVillageStream } from './village-stream.mjs';
import { applyVillageChanges, villageChanges } from './public/village-update.js';

const first = { nextTickInMs: 1000, world: { minute: 90, mapRevision: 1, herd: true }, map: { seed: 1, revision: 1 },
  actors: [{ id: 'agnes', name: 'Agnes', needs: { hunger: 10 } }, { id: 'oswin', name: 'Oswin' }],
  events: [{ id: 2, text: 'Work begins' }, { id: 1, text: 'Dawn' }], locations: {}, affairs: {}, planner: {} };

test('village patches preserve the order, retained fields and pairing of world and map', () => {
  const after = { ...first, world: { minute: 91, mapRevision: 2 }, map: { seed: 1, revision: 2 },
    actors: [{ id: 'agnes', name: 'Agnes', needs: { hunger: 11 } }, { id: 'joan', name: 'Joan' }],
    events: [{ id: 3, text: 'News' }, { id: 2, text: 'Work begins', account: 'A line' }] };
  const changes = villageChanges(first, after);
  assert.deepEqual(changes.actors.rows[0], { id: 'agnes', set: { needs: { hunger: 11 } } });
  assert.deepEqual(changes.world.remove, ['herd']);
  assert.deepEqual(applyVillageChanges(first, JSON.parse(JSON.stringify(changes))), after);
  assert.equal(first.world.herd, true);
  assert.deepEqual(villageChanges(first, structuredClone(first)), {});
});

test('a clock boundary publishes its minute and next pace in the same stream update', () => {
  const day = { ...first, world: { ...first.world, minute: 1319 }, tickMinutes: 1, tickMs: 15000, clockPeriod: 'day' };
  const night = { ...day, world: { ...day.world, minute: 1320 }, tickMs: 7500, clockPeriod: 'night' };
  const patch = JSON.parse(JSON.stringify(villageChanges(day, night)));
  assert.deepEqual(patch, { world: { set: { minute: 1320 } }, tickMs: 7500, clockPeriod: 'night' });
  assert.deepEqual(applyVillageChanges(day, patch), night);
});

class Response extends EventEmitter {
  frames = [];
  writeHead(status, headers) { this.status = status; this.headers = headers; }
  flushHeaders() {}
  write(text) { this.frames.push(text); return !this.blocked; }
  end() { this.emit('close'); }
  destroy() { this.destroyed = true; this.end(); }
}
const event = frame => JSON.parse(frame.split('\n')[1].slice('data: '.length));

test('one read feeds all viewers, reconnect takes a baseline, and a slow viewer cannot queue updates', async () => {
  let reads = 0, state = first;
  const stream = createVillageStream(async () => { reads++; return state; });
  try {
    const a = new Response(), b = new Response();
    stream.subscribe(a); stream.subscribe(b);
    await flushed();
    assert.equal(reads, 1);
    assert.match(a.headers['Content-Type'], /^text\/event-stream/);
    assert.ok(a.frames.at(-1).startsWith('event: snapshot\n'));
    assert.deepEqual(event(a.frames.at(-1)).state.map, first.map);
    b.blocked = true;
    state = { ...first, actors: [{ ...first.actors[0], action: { kind: 'work' } }, first.actors[1]] };
    stream.changed(); stream.changed();
    await flushed();
    assert.equal(reads, 2);
    assert.equal(a.frames.at(-1), b.frames.at(-1));
    assert.ok(a.frames.at(-1).startsWith('event: update\n'));
    assert.deepEqual(event(a.frames.at(-1)).state, { actors: { rows: [{ id: 'agnes', set: { action: { kind: 'work' } } }] } });
    state = { ...state, world: { ...state.world, minute: 93 } };
    stream.changed();
    await flushed();
    assert.equal(b.destroyed, true);
    const restarted = new Response();
    stream.subscribe(restarted);
    assert.ok(restarted.frames.at(-1).startsWith('event: snapshot\n'));
    assert.equal(event(restarted.frames.at(-1)).state.world.minute, 93);
    assert.equal(reads, 3);
  } finally { stream.close(); }
});

const adminUrl = process.env.DALECREST_TEST_ADMIN_URL;
test('PostgreSQL wakes the stream after commit, including resident changes between ticks', { skip: !adminUrl }, async () => {
  const name = 'dalecrest_stream_' + randomUUID().replaceAll('-', '');
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  let created = false, pool, client, stop;
  try {
    await admin.query('CREATE DATABASE ' + name);
    created = true;
    const url = new URL(adminUrl);
    url.pathname = '/' + name;
    process.env.DATABASE_URL = url.href;
    const db = await import('./db.mjs');
    pool = db.pool;
    await db.initialize();
    const signals = new EventEmitter();
    let seen = 0;
    stop = db.listenForVillageChanges(() => { seen++; signals.emit('changed'); });
    await once(signals, 'changed', { signal: AbortSignal.timeout(5000) });
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query("UPDATE dalecrest.actors SET state = jsonb_set(state, '{lastJob}', '45') WHERE id='agnes'");
    const before = await db.snapshot({ withMap: true });
    assert.equal(seen, 1);
    const awakened = once(signals, 'changed', { signal: AbortSignal.timeout(5000) });
    await client.query('COMMIT');
    await awakened;
    const after = await db.snapshot({ withMap: true });
    assert.equal(before.world.minute, after.world.minute);
    assert.notEqual(before.actors.find(a => a.id === 'agnes').lastJob, 45);
    assert.equal(after.actors.find(a => a.id === 'agnes').lastJob, 45);
    assert.equal(seen, 2);
  } finally {
    stop?.();
    client?.release();
    await pool?.end();
    if (created) await admin.query('DROP DATABASE ' + name + ' WITH (FORCE)');
    await admin.end();
  }
});

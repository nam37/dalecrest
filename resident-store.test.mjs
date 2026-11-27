// Residents are stored in two parts, and visitors are sent a slimmer copy. Both are checked here,
// with the part that needs a database run against PostgreSQL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createVillage } from './sim.mjs';
import { publicResident, publicVillage, SHOWN_MEMORIES } from './village-feed.mjs';
import { RESIDENT_PARTS, hotState } from './resident-store.mjs';
import { sameOffer } from './action-turns.mjs';

test('visitors are sent the latest memories and settled goals, and nothing private', () => {
  const village = createVillage(), actor = village.actors[0];
  actor.memories = Array.from({ length: 9 }, (_, i) => ({ minute: i, text: 'memory ' + i }));
  actor.goalHistory = [{ status: 'met', text: 'a' }, { status: 'active', text: 'b' }, { status: 'missed', text: 'c' }, { status: 'overtaken', text: 'd' }];
  actor.instructions = { sleep: { label: 'Sleeping' } };
  actor.observations = { hearth: { lit: true } };
  const shown = publicResident(actor);
  assert.deepEqual(shown.memories.map(m => m.text), ['memory 5', 'memory 6', 'memory 7', 'memory 8']);
  assert.equal(shown.memories.length, SHOWN_MEMORIES);
  assert.deepEqual(shown.goalHistory.map(g => g.text), ['c', 'd']);
  for (const key of ['instructions', 'observations', 'reports', 'requestMemories']) assert.equal(Object.hasOwn(shown, key), false, key);
  assert.equal(actor.memories.length, 9, 'the resident itself is untouched');
  assert.deepEqual(shown.action, actor.action);
  village.world.mootHistory = [{ id: 'moot-1' }];
  village.world.told = { x: 1 };
  const sent = publicVillage({ world: village.world, actors: village.actors, affairs: { mootHistory: village.world.mootHistory } });
  assert.equal(sent.world.mootHistory, undefined);
  assert.equal(sent.world.told, undefined);
  assert.equal(sent.world.minute, village.world.minute);
  assert.deepEqual(sent.affairs.mootHistory, [{ id: 'moot-1' }]);
});

test('a reply still starts when only the time on offer has changed', () => {
  assert.ok(sameOffer('Cutting wood at the coppice (90 village minutes).', 'Cutting wood at the coppice (120 village minutes).'));
  assert.ok(sameOffer('Try to visit Hugh at the mill if they are still there (20 village minutes after arrival).',
    'Try to visit Hugh at the mill if they are still there (30 village minutes after arrival).'));
  assert.ok(sameOffer('Voting for the field.', 'Voting for the field.'));
  assert.ok(!sameOffer('Cutting wood at the coppice (90 village minutes).', 'Cutting wood at the far wood (90 village minutes).'));
  assert.ok(!sameOffer('Resting at home (60 village minutes).', 'Walking on the green (60 village minutes).'));
});

test('the minute-to-minute record leaves the long lists out', () => {
  const actor = createVillage().actors[0];
  const hot = hotState(actor);
  for (const name of RESIDENT_PARTS) assert.equal(Object.hasOwn(hot, name), false, name);
  assert.deepEqual(hot.needs, actor.needs);
  assert.equal(hot.id, actor.id);
});

const adminUrl = process.env.DALECREST_TEST_ADMIN_URL;
test('PostgreSQL keeps the long lists apart, writes only those that change and reads residents whole', { skip: !adminUrl }, async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  const name = 'dalecrest_parts_' + randomUUID().replaceAll('-', '');
  let db, created = false;
  await admin.connect();
  try {
    await admin.query('CREATE DATABASE ' + name);
    created = true;
    const url = new URL(adminUrl);
    url.pathname = '/' + name;
    process.env.DATABASE_URL = url.href;
    delete process.env.PLANNER_PROVIDER;
    db = await import('./db.mjs');
    const store = await import('./resident-store.mjs');
    await db.initialize();
    const { pool } = db;
    const tick = async () => { await pool.query('UPDATE dalecrest.world SET next_tick=now()'); await db.advance(); };

    // The table row holds no long list. Each one is a part of its own.
    const rows = (await pool.query('SELECT state FROM dalecrest.actors')).rows;
    assert.ok(rows.length >= 8);
    for (const { state } of rows) for (const part of RESIDENT_PARTS) assert.equal(Object.hasOwn(state, part), false, part);
    const whole = await db.snapshot();
    assert.ok(whole.actors.every(a => Array.isArray(a.memories) && Array.isArray(a.goalHistory)));
    assert.deepEqual((await store.readResident(pool, whole.actors[0].id)).memories, whole.actors[0].memories);

    // A minute rewrites only the parts that changed in it.
    await tick();
    const before = new Map((await pool.query("SELECT actor_id||':'||part AS k, xmin::text AS x, value FROM dalecrest.resident_parts")).rows.map(r => [r.k, r]));
    await tick();
    const after = (await pool.query("SELECT actor_id||':'||part AS k, xmin::text AS x, value FROM dalecrest.resident_parts")).rows;
    const rewritten = after.filter(r => before.get(r.k)?.x !== r.x);
    assert.ok(after.length > 20 && rewritten.length < after.length / 2, rewritten.length + ' of ' + after.length + ' parts rewritten');
    for (const r of rewritten) if (before.has(r.k)) assert.notDeepEqual(r.value, before.get(r.k).value, r.k + ' was rewritten unchanged');

    // A record written whole, as an older release wrote it, reads with its own lists and is split on the next minute.
    const agnes = (await db.snapshot()).actors.find(a => a.id === 'agnes');
    agnes.memories.push({ minute: 1, text: 'A record written whole.', actorIds: ['agnes'], kind: 'observation' });
    await pool.query('UPDATE dalecrest.actors SET state=$1 WHERE id=$2', [agnes, agnes.id]);
    assert.equal((await db.snapshot()).actors.find(a => a.id === 'agnes').memories.at(-1).text, 'A record written whole.');
    await tick();
    const { rows: [{ state }] } = await pool.query("SELECT state FROM dalecrest.actors WHERE id='agnes'");
    assert.equal(Object.hasOwn(state, 'memories'), false);
    const { rows: [{ value }] } = await pool.query("SELECT value FROM dalecrest.resident_parts WHERE actor_id='agnes' AND part='memories'");
    assert.ok(value.some(m => m.text === 'A record written whole.'));

    // An observer can ask for some parts only.
    const slim = await db.snapshot({ withMap: true, parts: ['memories'] });
    assert.ok(slim.actors.every(a => Array.isArray(a.memories) && !Object.hasOwn(a, 'goalHistory')));
    assert.ok(slim.map?.places?.length);
  } finally {
    if (db) await db.pool.end();
    await admin.end().catch(() => {});
    if (created) {
      const cleanup = new pg.Client({ connectionString: adminUrl });
      await cleanup.connect();
      await cleanup.query('DROP DATABASE ' + name + ' WITH (FORCE)').catch(() => {});
      await cleanup.end();
    }
  }
});

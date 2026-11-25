import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { mapRevision, mapRevisions, residentHeat } from './village-history.mjs';

// Runs only when DALECREST_TEST_ADMIN_URL names a development server that may create databases.
const adminUrl = process.env.DALECREST_TEST_ADMIN_URL;

test('PostgreSQL moves an old village onto a map, then stores a newcomer and the ground they change', { skip: !adminUrl }, async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  const name = 'dalecrest_test_' + randomUUID().replaceAll('-', '');
  let db, created = false;
  await admin.connect();
  try {
    await admin.query('CREATE DATABASE ' + name);
    created = true;
    const url = new URL(adminUrl);
    url.pathname = '/' + name;
    // A database as the first release left it: no map table, everyone living at 'cottages'.
    const old = new pg.Client({ connectionString: url.href });
    await old.connect();
    await old.query(`
      CREATE SCHEMA dalecrest;
      CREATE TABLE dalecrest.world (id integer PRIMARY KEY CHECK (id = 1), state jsonb NOT NULL, next_tick timestamptz NOT NULL DEFAULT now());
      CREATE TABLE dalecrest.actors (id text PRIMARY KEY, ordinal integer UNIQUE NOT NULL, state jsonb NOT NULL, CHECK (state->>'id' = id));
      CREATE TABLE dalecrest.events (id bigserial PRIMARY KEY, minute bigint NOT NULL, kind text NOT NULL, actor_ids text[] NOT NULL, description text NOT NULL);`);
    const { createVillage } = await import('./sim.mjs');
    const founded = createVillage();
    const world = { minute: 2 * 1440 + 500, seed: founded.world.seed, supplies: founded.world.supplies };
    await old.query('INSERT INTO dalecrest.world(id, state) VALUES (1, $1)', [world]);
    for (const [ordinal, actor] of founded.actors.entries()) {
      delete actor.appearance;
      Object.assign(actor, { home: 'cottages', position: { x: 31, y: 58 } });
      actor.action = { kind: 'rest', label: 'Resting at home', reason: 'Tired.', target: 'cottages', phase: 'working', remaining: 5 };
      await old.query('INSERT INTO dalecrest.actors(id, ordinal, state) VALUES ($1, $2, $3)', [actor.id, ordinal, actor]);
    }
    await old.end();

    process.env.DATABASE_URL = url.href;
    db = await import('./db.mjs');
    await db.initialize();
    let snapshot = await db.snapshot();
    const initialObserver = await db.snapshot({ withMap:true });
    const first = initialObserver.map.revision;
    assert.equal(first, snapshot.world.mapRevision);
    assert.ok(Number.isFinite(initialObserver.nextTickInMs));
    assert.equal((await db.snapshot({ withMap:true })).map,initialObserver.map);
    assert.ok(snapshot.actors.every(a => /^cottage-\d$/.test(a.home) && a.action.target === a.home));
    assert.ok(snapshot.actors.every(a => a.appearance?.seed === a.id));
    assert.equal(snapshot.world.minute, world.minute);
    assert.deepEqual(await mapRevisions(db.pool), [{ revision: first, minute: world.minute }]);
    assert.deepEqual((await mapRevision(db.pool, first)).map, initialObserver.map);
    assert.equal((await residentHeat(db.pool, 'agnes', 7)).minutes, 0);
    await db.initialize();
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM dalecrest.events')).rows[0].n, 1);

    // Run the clock until a traveller arrives and the village has changed its map.
    for (let i = 0; i < 4000 && (snapshot.actors.length === 8 || snapshot.world.mapRevision === first); i++) {
      await db.pool.query("UPDATE dalecrest.world SET next_tick = now() - interval '1 second'");
      await db.advance();
      if (i % 40 === 0) snapshot = await db.snapshot();
    }
    snapshot = await db.snapshot();
    assert.ok(snapshot.actors.length > 8, 'no newcomer was stored');
    assert.ok(snapshot.actors.every(a => a.appearance?.seed === (a.arrived == null ? a.id : `${a.id}@${a.arrived}`)));
    const rows = (await db.pool.query('SELECT id, ordinal FROM dalecrest.actors ORDER BY ordinal')).rows;
    assert.deepEqual(rows.map(r => r.ordinal), rows.map((_, i) => i));
    assert.deepEqual(rows.map(r => r.id), snapshot.actors.map(a => a.id));
    const stored = (await db.pool.query('SELECT revision, state FROM dalecrest.map')).rows[0];
    assert.equal(Number(stored.revision), snapshot.world.mapRevision);
    assert.notEqual(stored.state.revision, first);
    assert.equal(stored.state.revision, snapshot.world.mapRevision);
    const latestObserver = await db.snapshot({ withMap:true });
    assert.equal(latestObserver.world.mapRevision,latestObserver.map.revision);
    assert.deepEqual(latestObserver.map,stored.state);
    assert.equal(initialObserver.map.revision,first);
    const archive = await mapRevisions(db.pool);
    assert.ok(archive.length > 1);
    assert.equal(archive[0].revision, first);
    assert.equal(archive.at(-1).revision, latestObserver.map.revision);
    assert.deepEqual((await mapRevision(db.pool, first)).map, initialObserver.map);
    const presence = await residentHeat(db.pool, 'agnes', null);
    assert.equal(presence.minutes, latestObserver.world.minute - world.minute);
    assert.equal(presence.cells.reduce((total, cell) => total + cell[2], 0), presence.minutes);
    assert.ok((await db.pool.query("SELECT 1 FROM dalecrest.events WHERE kind = 'arrival'")).rowCount);
  } finally {
    if (db) await db.pool.end();
    if (created) await admin.query('DROP DATABASE ' + name);
    await admin.end();
  }
});

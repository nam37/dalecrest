// Ticks record how long each part took, and the database is sampled for table sizes. The health report reads both.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { tickTimer } from './tick-telemetry.mjs';

test('a tick timer adds up each phase and the whole', () => {
  let clock = 0;
  const timer = tickTimer(() => clock);
  clock = 5; timer.mark('read');
  clock = 7; timer.mark('step');
  clock = 10; timer.mark('read');
  assert.deepEqual(timer.phases, { read: 8, step: 2 });
  clock = 12;
  assert.equal(timer.total(), 12);
});

const adminUrl = process.env.DALECREST_TEST_ADMIN_URL;
test('PostgreSQL keeps tick timings and table sizes, and the health report reads them', { skip: !adminUrl }, async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  const name = 'dalecrest_telemetry_' + randomUUID().replaceAll('-', '');
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
    const telemetry = await import('./tick-telemetry.mjs');
    const { readAdminHealth } = await import('./admin-health.mjs');
    await db.initialize();
    const { pool } = db;
    const tick = async () => { await pool.query('UPDATE dalecrest.world SET next_tick=now()'); await db.advance(); };
    for (let i = 0; i < 3; i++) await tick();

    // Every tick is counted once in each phase it ran, and the commit is recorded with the tick after it.
    const { rows } = await pool.query('SELECT phase, sum(ticks)::int AS ticks FROM dalecrest.tick_timings GROUP BY phase');
    const counted = Object.fromEntries(rows.map(r => [r.phase, r.ticks]));
    for (const phase of ['read', 'step', 'events', 'knowledge', 'residents', 'presence', 'records', 'clock', 'total']) assert.equal(counted[phase], 3, phase);
    assert.equal(counted.commit, 2);
    // A tick that finds the clock not yet due records nothing.
    await db.advance();
    assert.equal((await pool.query("SELECT sum(ticks)::int AS n FROM dalecrest.tick_timings WHERE phase='total'")).rows[0].n, 3);

    // The first tick took a size sample. Another within the hour is skipped unless forced.
    assert.equal((await pool.query('SELECT count(DISTINCT measured_at)::int AS n FROM dalecrest.table_sizes')).rows[0].n, 1);
    assert.equal(await telemetry.sampleSizes(pool, { force: false }), false);
    let storage = await telemetry.readTableSizes(pool);
    assert.equal(storage.comparedOverDays, null, 'one sample says nothing about growth');
    assert.ok(storage.tables.some(t => t.name === 'actors' && t.bytes > 0));
    assert.ok(storage.tables.some(t => t.name === 'resident_parts'));
    assert.ok(storage.databaseBytes > 0);

    // Growth is measured against the oldest sample in the last week.
    await pool.query(`INSERT INTO dalecrest.table_sizes(measured_at, name, bytes, row_estimate)
      SELECT measured_at - interval '2 days', name, bytes - 2048, row_estimate FROM dalecrest.table_sizes`);
    storage = await telemetry.readTableSizes(pool);
    assert.equal(storage.comparedOverDays, 2);
    assert.equal(storage.tables.find(t => t.name === 'actors').growthPerDay, 1024);
    assert.equal(storage.databaseGrowthPerDay, 1024);
    // Samples older than the kept span are dropped when the next is taken.
    await pool.query(`INSERT INTO dalecrest.table_sizes(measured_at, name, bytes) VALUES (now() - interval '40 days', 'actors', 1)`);
    assert.equal(await telemetry.sampleSizes(pool, { force: true }), true);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM dalecrest.table_sizes WHERE measured_at < now() - interval '35 days'")).rows[0].n, 0);

    const health = await readAdminHealth(pool, { ...await db.snapshot({ withMap: true }), planner: { state: 'ready' } });
    assert.equal(health.ticks.lastTwoHours.ticks, 3);
    assert.ok(health.ticks.lastTwoHours.meanMs > 0);
    assert.ok(health.ticks.lastTwoHours.phases.residents.maxMs >= health.ticks.lastTwoHours.phases.residents.meanMs);
    assert.equal(health.ticks.lastDay.ticks, 3);
    assert.ok(health.storage.tables.length > 10);
    assert.equal(typeof health.storage.logWrittenPerDay, 'number');
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import { clockPace } from './engine/clock.mjs';
import { availableActions, createVillage, startChosen, stepVillage } from './sim.mjs';

const fixed = { PLANNER_PROVIDER: 'openai' };
const variable = { ...fixed, VILLAGE_CLOCK_MODE: 'day-night' };
const day = { minutes: 1, seconds: 15, period: 'day' };
const night = { minutes: 1, seconds: 7.5, period: 'night' };

test('the pace describes the interval after the committed minute', () => {
  assert.deepEqual(clockPace(359, variable), night);
  assert.deepEqual(clockPace(360, variable), day);
  assert.deepEqual(clockPace(1319, variable), day);
  assert.deepEqual(clockPace(1320, variable), night);
  assert.deepEqual(clockPace(1440, variable), night);
  assert.deepEqual(clockPace(1800, variable), day);
  assert.deepEqual(clockPace(360, fixed), { minutes: 1, seconds: 30, period: null });
  assert.deepEqual(clockPace(1320, { ...fixed, VILLAGE_SECONDS_PER_MINUTE: '15' }), { minutes: 1, seconds: 15, period: null });
  assert.deepEqual(clockPace(360, {}), { minutes: 3, seconds: 3, period: null });
});

test('fixed and variable replays preserve actions and event order across dusk, midnight and dawn', () => {
  function replay(env) {
    const village = createVillage(), events = [], records = [], choices = [];
    village.world.minute = 1318;
    while (village.world.minute < 1820) {
      const { minutes } = clockPace(village.world.minute, env);
      events.push(...stepVillage(village, { minutes, externalActions: true, records }));
      for (const actor of village.actors) {
        if (actor.action.kind !== 'waiting') continue;
        const menu = availableActions(actor, village);
        const rest = 'rest:' + actor.home, green = 'leisure:green';
        const id = village.world.minute < 1800 && menu.has(rest) ? rest : menu.has(green) ? green : menu.keys().next().value;
        if (id && startChosen(actor, village, id, { id: String(choices.length + 1) })) choices.push(id);
      }
    }
    return { village, events, records, choices };
  }
  const baseline = replay(fixed);
  assert.ok(baseline.choices.length);
  assert.equal(baseline.events.filter(event => event.minute === 1800 && event.text.startsWith('Dawn breaks')).length, 1);
  assert.deepEqual(replay(variable), baseline);
});

const adminUrl = process.env.DALECREST_TEST_ADMIN_URL;
test('PostgreSQL commits a fractional clock deadline with its minute and resumes without catch-up', { skip: !adminUrl }, async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  const name = 'dalecrest_clock_' + randomUUID().replaceAll('-', '');
  let db, created = false;
  await admin.connect();
  try {
    await admin.query('CREATE DATABASE ' + name);
    created = true;
    const url = new URL(adminUrl);
    url.pathname = '/' + name;
    process.env.DATABASE_URL = url.href;
    process.env.PLANNER_PROVIDER = 'openai';
    process.env.VILLAGE_CLOCK_MODE = 'day-night';
    db = await import('./db.mjs');
    await db.initialize();

    async function due(minute, secondsLate) {
      const { rows: [row] } = await db.pool.query(`UPDATE dalecrest.world
        SET state=jsonb_set(state,'{minute}',to_jsonb($1::int)), next_tick=statement_timestamp()-make_interval(secs=>$2)
        RETURNING next_tick::text AS deadline`, [minute, secondsLate]);
      return row.deadline;
    }
    const deadline = async () => (await db.pool.query('SELECT next_tick::text FROM dalecrest.world')).rows[0].next_tick;
    for (const [minute, expected] of [[1318, day], [1319, night], [1439, night], [1799, day]]) {
      const before = await due(minute, 2);
      await Promise.all([db.advance(), db.advance()]);
      const after = await db.snapshot({ withMap: true });
      assert.equal(after.world.minute, minute + 1);
      assert.equal(after.tickMinutes, expected.minutes);
      assert.equal(after.tickMs, expected.seconds * 1000);
      assert.equal(after.clockPeriod, expected.period);
      const { rows: [row] } = await db.pool.query('SELECT extract(epoch FROM next_tick-$1::timestamptz)::float8 AS elapsed FROM dalecrest.world', [before]);
      assert.equal(row.elapsed, expected.seconds);
      assert.ok(after.nextTickInMs > 0 && after.nextTickInMs <= expected.seconds * 1000);
    }

    await due(1400, 120);
    await db.advance();
    assert.equal((await db.snapshot()).world.minute, 1401);
    assert.ok(await db.nextTickDelay() > 5000);
    const scheduled = await deadline();
    await db.initialize();
    assert.equal(await deadline(), scheduled, 'a restart during a valid interval preserves its deadline');

    process.env.VILLAGE_CLOCK_MODE = 'fixed';
    process.env.VILLAGE_SECONDS_PER_MINUTE = '15';
    await db.initialize();
    const trial = await db.snapshot({ withMap: true });
    assert.equal(trial.world.minute, 1401);
    assert.equal(trial.clockPeriod, null);
    assert.equal(trial.tickMs, 15000);
    assert.ok(trial.nextTickInMs > 12500 && trial.nextTickInMs <= 15000);

    await db.pool.query(`INSERT INTO dalecrest.activity_log (actor_id, minute, basis)
      VALUES ('agnes', 1799, 'waiting'), ('agnes', 1801, 'fresh')`);
    await db.pool.query(`INSERT INTO dalecrest.decision_traces
      (actor_id, observed_minute, model, endpoint, request_body, decision_since, token_charge, status)
      VALUES ('agnes', 1799, 'test', 'test', '{}', 1799, 100, 'superseded')`);
    const { stdout } = await promisify(execFile)(process.execPath, ['tools/pilot-report.mjs']);
    assert.match(stdout, /Around dawn: 1 waits .* 2\.0 village minutes/);
    assert.match(stdout, /Around dawn: 1 of 1 choices unavailable, superseded or stale/);
  } finally {
    if (db) await db.pool.end();
    if (created) await admin.query('DROP DATABASE ' + name);
    await admin.end();
  }
});

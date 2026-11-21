import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createVillage, stepVillage } from './sim.mjs';

function shift(job, remaining = 1) {
  const [target, label] = job === 'bake' ? ['oven', 'Baking bread'] : ['wood', 'Stacking firewood'];
  return { kind: 'work', job, target, label, remaining, phase: 'working' };
}

const tick = village => stepVillage(village, { externalActions: true, minutes: 1 });

test('a helper remains attached to the actual wood shift across a saved village', () => {
  const village = createVillage();
  const oswin = village.actors.find(a => a.id === 'oswin');
  const edith = village.actors.find(a => a.id === 'edith');
  // The stores have room for three bundles and nobody has a shortage to discuss.
  for (const [key, capacity] of Object.entries(village.world.capacity)) village.world.supplies[key] = Math.min(20, capacity);
  oswin.action = { ...shift('cut', 7), basis: { kind: 'standing', trace: '18' } };
  edith.position = { ...oswin.position };
  edith.action = { kind: 'social', label: 'Visiting Oswin', target: 'wood', friendId: 'oswin', phase: 'working', remaining: 28 };
  const helping = tick(village);
  assert.ok(helping.some(e => e.text.includes('lent Oswin Holt a hand')));
  const resumed = JSON.parse(JSON.stringify(village));
  const events = stepVillage(resumed, { externalActions: true, minutes: 4 });
  assert.deepEqual(events.filter(e => e.outcome).map(e => e.outcome), [{
    job: 'cut', site: 'wood', workerId: 'oswin', helperIds: ['edith'], status: 'completed',
    stockDelta: { wood: 3 }, basis: 'standing', traceId: '18'
  }]);
  assert.equal(resumed.world.supplies.wood, 23);
});

test('blocked and interrupted shifts record a factual cause once and consume nothing', () => {
  for (const [reason, status] of [['too little room', 'blocked'], ['could not be reached', 'blocked'], ['moot', 'interrupted']]) {
    const village = createVillage();
    const mabel = village.actors.find(a => a.id === 'mabel');
    mabel.action = shift('bake');
    if (reason === 'too little room') village.world.supplies.bread = 31;
    if (reason === 'could not be reached') Object.assign(mabel.action, { phase: 'travelling', target: 'missing-oven' });
    if (reason === 'moot') village.world.moot = { at: village.world.minute + 36, tries: 0 };
    const before = { ...village.world.supplies };
    const outcomes = stepVillage(village, { minutes: 2, externalActions: true }).filter(e => e.outcome);
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].outcome.status, status);
    assert.match(outcomes[0].outcome.reason, new RegExp(reason));
    assert.deepEqual(outcomes[0].outcome.stockDelta, {});
    assert.deepEqual(village.world.supplies, before);
    assert.equal(mabel.memories.at(-1).text, outcomes[0].text);
  }
});

const adminUrl = process.env.DALECREST_TEST_ADMIN_URL;
test('PostgreSQL commits competing oven shifts and stock together, including after a failed tick', { skip: !adminUrl }, async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  const name = 'dalecrest_outcomes_' + randomUUID().replaceAll('-', '');
  let db, created = false;
  await admin.connect();
  try {
    await admin.query('CREATE DATABASE ' + name);
    created = true;
    const url = new URL(adminUrl);
    url.pathname = '/' + name;
    process.env.DATABASE_URL = url.href;
    process.env.PLANNER_PROVIDER = 'openai';
    process.env.VILLAGE_SECONDS_PER_MINUTE = '30';
    db = await import('./db.mjs');
    await db.initialize();
    const { pool } = db;
    const initial = await db.snapshot();
    const stocks = { ...initial.world.supplies, flour: 4, wood: 1, bread: 0 };
    await pool.query("UPDATE dalecrest.world SET state=jsonb_set(state,'{supplies}',$1), next_tick=now()", [{ ...stocks, flour: 8, wood: 2 }]);
    await pool.query("UPDATE dalecrest.actors SET state=jsonb_set(state,'{action,remaining}','100') WHERE id <> 'mabel'");
    const waiting = { kind: 'waiting', phase: 'waiting', label: 'Choosing the next activity', target: 'oven',
      remaining: 0, since: initial.world.minute, why: 'no instruction applies', previous: { kind: 'idle', label: 'Starting the day', target: 'oven' } };
    await pool.query("UPDATE dalecrest.actors SET state=jsonb_set(state,'{action}',$1) WHERE id='mabel'", [waiting]);
    async function choose(choice) {
      const ticket = await db.claimAction(7000);
      assert.ok(JSON.parse(ticket.body).questions[0].choices.some(option => option.value === choice));
      await db.recordReply(ticket.id, { status: 200, requestId: 'test-oven', redacted: false, body: JSON.stringify({
        answers: [{ name: 'next_action', type: 'choice', choice, confidence: 0.8 }], usage: { total_tokens: 300 } }) });
      assert.equal((await db.applyRecordedDecision(ticket.id)).status, 'applied');
      return ticket;
    }
    const inspection = await choose('inspect:oven');
    assert.equal(JSON.parse(inspection.body).input[0].content[0].data.lastOvenCheck, null);
    for (let i = 0; i < 3; i++) {
      await pool.query('UPDATE dalecrest.world SET next_tick=now()');
      await db.advance();
    }
    const afterCheck = await db.snapshot();
    const seen = afterCheck.actors.find(a => a.id === 'mabel').observations.ovenStores;
    assert.equal(seen.minute, afterCheck.world.minute);
    const observed = await pool.query("SELECT outcome FROM dalecrest.events WHERE kind='observation' AND actor_ids=ARRAY['mabel']");
    assert.deepEqual(observed.rows, [{ outcome: { ...seen, traceId: inspection.id } }]);
    await db.initialize();
    await pool.query("UPDATE dalecrest.world SET state=jsonb_set(state,'{supplies}',$1), next_tick=now()", [stocks]);
    const ticket = await choose('work:bake:oven');
    const recalled = JSON.parse(ticket.body).input[0].content[0].data.lastOvenCheck;
    assert.deepEqual([recalled.flour, recalled.wood, recalled.minute], [8, 2, seen.minute]);
    await pool.query("UPDATE dalecrest.actors SET state=jsonb_set(state,'{action,remaining}','1') WHERE id='mabel'");
    await pool.query("UPDATE dalecrest.actors SET state=jsonb_set(state,'{action}',$1) WHERE id='robin'", [shift('bake')]);

    // Fail at the event insert, after the tick has written the changed world and actors.
    await pool.query('ALTER TABLE dalecrest.events ADD CONSTRAINT fail_test_tick CHECK (outcome IS NULL) NOT VALID');
    await assert.rejects(db.advance(), { code: '23514' });
    const rolledBack = await db.snapshot();
    assert.equal(rolledBack.world.minute, afterCheck.world.minute);
    assert.deepEqual(rolledBack.world.supplies, stocks);
    assert.equal(rolledBack.actors.find(a => a.id === 'mabel').action.remaining, 1);
    await pool.query('ALTER TABLE dalecrest.events DROP CONSTRAINT fail_test_tick');
    await Promise.all([db.advance(), db.advance()]);
    await db.initialize();
    await db.advance();
    const { rows } = await pool.query("SELECT outcome FROM dalecrest.events WHERE kind='work' AND outcome IS NOT NULL ORDER BY id");
    assert.equal(rows.length, 2);
    assert.equal(rows[0].outcome.workerId, 'mabel');
    assert.equal(rows[0].outcome.status, 'completed');
    assert.equal(rows[0].outcome.traceId, ticket.id);
    assert.equal(rows[0].outcome.basis, 'fresh');
    assert.deepEqual(rows[0].outcome.stockDelta, { flour: -2, wood: -1, bread: 5 });
    const linked = await pool.query(`SELECT s.trace_id FROM dalecrest.decision_steps s
      JOIN dalecrest.events e ON e.id=s.event_id WHERE e.outcome->>'workerId'='mabel'`);
    assert.deepEqual(linked.rows, [{ trace_id: ticket.id }]);
    assert.equal(rows[1].outcome.workerId, 'robin');
    assert.equal(rows[1].outcome.status, 'blocked');
    assert.match(rows[1].outcome.reason, /too little wood/);
    assert.deepEqual(rows[1].outcome.stockDelta, {});
    assert.deepEqual((await db.snapshot()).world.supplies, { ...stocks, flour: 2, wood: 0, bread: 5 });
  } finally {
    if (db) await db.pool.end();
    if (created) await admin.query('DROP DATABASE ' + name);
    await admin.end();
  }
});

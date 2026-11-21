import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

// Runs only when DALECREST_TEST_ADMIN_URL names a development server that may create databases.
const adminUrl = process.env.DALECREST_TEST_ADMIN_URL;

test('PostgreSQL keeps the clock moving without replies and records how each activity began', { skip: !adminUrl }, async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  const name = 'dalecrest_standing_test_' + randomUUID().replaceAll('-', '');
  let db, created = false;
  await admin.connect();
  try {
    await admin.query('CREATE DATABASE ' + name);
    created = true;
    const url = new URL(adminUrl);
    url.pathname = '/' + name;
    process.env.DATABASE_URL = url.href;
    process.env.PLANNER_PROVIDER = 'openai';
    delete process.env.VILLAGE_SECONDS_PER_MINUTE;
    db = await import('./db.mjs');
    await db.initialize();
    const tick = async () => { await db.pool.query('UPDATE dalecrest.world SET next_tick=now()'); await db.advance(); };
    const resident = async id => (await db.snapshot()).actors.find(a => a.id === id);
    const log = async where => (await db.pool.query('SELECT * FROM dalecrest.activity_log WHERE ' + where + ' ORDER BY id')).rows;

    // Nobody has been told anything yet, so everyone waits. Time passes all the same.
    const start = (await db.snapshot()).world.minute;
    for (let i = 0; i < 3; i++) await tick();
    let now = await db.snapshot({ withMap: true });
    assert.equal(now.world.minute, start + 3);
    assert.ok(now.actors.every(a => a.action.kind === 'waiting'));
    assert.ok(now.nextTickInMs > 25000 && now.nextTickInMs <= 30000, 'the next village minute is thirty real seconds away');
    assert.equal((await log("basis='waiting' AND reason='no instruction applies'")).length, now.actors.length);
    const health = (await db.pool.query('SELECT ticks, late_ms_max FROM dalecrest.world')).rows[0];
    assert.equal(Number(health.ticks), 3);
    assert.ok(health.late_ms_max >= 0 && health.late_ms_max < 5000);

    // At ten at night Alice finishes a stretch of sleep. With no instruction for it, that is a choice.
    const alice = await resident('alice');
    await db.pool.query("UPDATE dalecrest.actors SET state=jsonb_set(state,'{action}',$1)",
      [JSON.stringify({ kind: 'work', label: 'Busy', target: 'green', phase: 'working', remaining: 999 })]);
    await db.pool.query("UPDATE dalecrest.actors SET state=jsonb_set(state,'{action}',$1) WHERE id='alice'",
      [JSON.stringify({ kind: 'rest', label: 'Sleeping at home', target: alice.home, phase: 'working', remaining: 1 })]);
    await db.pool.query("UPDATE dalecrest.world SET state=jsonb_set(state,'{minute}','1320')");
    await tick();
    assert.equal((await resident('alice')).action.kind, 'waiting');
    const ticket = await db.claimAction(7000);
    const question = JSON.parse(ticket.body).questions[0];
    const sleep = question.choices.find(c => c.value.startsWith('rest:'));
    assert.match(sleep.description, /Alice Brook’s cottage/);
    await db.recordReply(ticket.id, { status: 200, requestId: 'req-sleep', redacted: false, body: JSON.stringify({
      answers: [{ type: 'choice', name: 'next_action', choice: sleep.value, confidence: 0.8 }], usage: { total_tokens: 300 } }) });
    assert.equal((await db.applyRecordedDecision(ticket.id)).status, 'applied');
    const chosen = (await resident('alice')).action;
    assert.equal(chosen.basis.kind, 'fresh');
    const [fresh] = await log("basis='fresh'");
    assert.deepEqual([fresh.actor_id, fresh.routine, fresh.trace_id, fresh.reason], ['alice', 'sleep', ticket.id, 'no instruction applies']);

    // When that stretch of sleep ends she sleeps on by the same instruction. No second request is made.
    for (let i = 0; i < 140 && (await resident('alice')).action.basis?.kind !== 'standing'; i++) await tick();
    const next = (await resident('alice')).action;
    assert.equal(next.basis.kind, 'standing');
    assert.equal(next.basis.trace, ticket.id);
    const [standing] = await log("basis='standing'");
    assert.deepEqual([standing.actor_id, standing.routine, standing.trace_id], ['alice', 'sleep', ticket.id]);
    assert.equal(await db.claimAction(7000), undefined);
    const trace = (await db.pool.query('SELECT end_reason FROM dalecrest.decision_traces WHERE id=$1', [ticket.id])).rows[0];
    assert.equal(trace.end_reason, 'activity_ended');
  } finally {
    if (db) await db.pool.end();
    if (created) await admin.query('DROP DATABASE ' + name);
    await admin.end();
  }
});

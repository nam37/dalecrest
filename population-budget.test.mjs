import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createVillage, welcomeResidents } from './sim.mjs';

test('settlement fills available hall beds once and keeps existing residents', () => {
  const village = createVillage(), original = structuredClone(village.actors);
  const events = welcomeResidents(village, 10);
  assert.deepEqual(village.actors.slice(0, 8), original);
  assert.equal(village.actors.length, 10);
  assert.deepEqual(events.map(e => e.actorIds[0]), village.actors.slice(8).map(a => a.id));
  assert.equal(new Set(village.actors.map(a => a.id)).size, 10);
  assert.ok(village.actors.slice(8).every(a => a.home === 'hall' && a.desires.length && a.action.kind === 'arrive'));
  assert.deepEqual(welcomeResidents(village, 10), []);
  assert.deepEqual(welcomeResidents(village, 12), []);
});

const adminUrl = process.env.DALECREST_TEST_ADMIN_URL;
test('the live clock persists arrivals and skips a resident who has used their hourly allowance', { skip: !adminUrl }, async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  const name = 'dalecrest_population_' + randomUUID().replaceAll('-', '');
  let db, created = false;
  await admin.connect();
  try {
    await admin.query('CREATE DATABASE ' + name);
    created = true;
    const url = new URL(adminUrl);
    url.pathname = '/' + name;
    process.env.DATABASE_URL = url.href;
    process.env.PLANNER_PROVIDER = 'openai';
    process.env.VILLAGE_MIN_RESIDENTS = '10';
    db = await import('./db.mjs');
    await db.initialize();
    await db.advance();
    await db.initialize();
    await db.pool.query('UPDATE dalecrest.world SET next_tick=now()');
    await db.advance();
    const state = await db.snapshot();
    assert.equal(state.actors.length, 10);
    assert.equal(state.events.filter(e => e.type === 'arrival').length, 2);
    await db.pool.query(`INSERT INTO dalecrest.decision_traces(actor_id, observed_minute, model, endpoint, request_body, status, token_charge)
      VALUES ('agnes', $1, 'fixture','fixture','{}','applied',48000)`, [state.world.minute]);
    const first = await db.claimAction(480000);
    assert.ok(first.id);
    assert.notEqual(JSON.parse(first.body).input[0].content[0].data.name, 'Agnes Reed');
    assert.deepEqual(await db.claimAction(48000), { budgetLimited: true });
    await db.pool.query("UPDATE dalecrest.decision_traces SET requested_at=now()-interval '61 minutes' WHERE actor_id='agnes'");
    const second = await db.claimAction(480000);
    assert.equal(JSON.parse(second.body).input[0].content[0].data.name, 'Agnes Reed');
    await db.pool.query(`UPDATE dalecrest.actors SET state=jsonb_set(state,'{action,kind}','"idle"') WHERE id <> 'robin'`);
    await db.pool.query(`INSERT INTO dalecrest.decision_traces(actor_id,observed_minute,model,endpoint,request_body,status,token_charge)
      VALUES ('robin',$1,'fixture','fixture','{}','applied',48000)`, [state.world.minute]);
    const reporter = await db.claimAction(480000);
    assert.equal(JSON.parse(reporter.body).input[0].content[0].data.name, 'Robin Marsh');
    await db.pool.query("UPDATE dalecrest.decision_traces SET status='unavailable',requested_at=now()-interval '2 minutes',token_charge=12000 WHERE id=$1", [reporter.id]);
    assert.deepEqual(await db.claimAction(480000), { budgetLimited: true });
  } finally {
    if (db) await db.pool.end();
    if (created) await admin.query('DROP DATABASE ' + name);
    await admin.end();
  }
});

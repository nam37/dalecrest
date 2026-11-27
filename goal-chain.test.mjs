// The chain in PostgreSQL: an observation, the goal review that rests a goal on it, the action choice
// that goal informed, the outcome, and who witnessed it, read back with one query.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { remember, memoryKey } from './engine/memory.mjs';
import { readResident } from './resident-store.mjs';

const adminUrl = process.env.DALECREST_TEST_ADMIN_URL;

test('PostgreSQL follows an observation through a goal review and a choice to its outcome', { skip: !adminUrl }, async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  const name = 'dalecrest_goals_' + randomUUID().replaceAll('-', '');
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
    const tickNow = async () => { await pool.query('UPDATE dalecrest.world SET next_tick=now()'); await db.advance(); };
    await tickNow();
    // The founding goals are stored as first versions.
    const founding = await pool.query("SELECT goal_id, version, kind, source FROM dalecrest.goal_versions WHERE actor_id='oswin' ORDER BY goal_id");
    assert.deepEqual(founding.rows.map(r => [r.goal_id, r.version, r.kind, r.source]), [['g1', 1, 'evidence', 'founding'], ['g2', 1, 'evidence', 'founding']]);

    // Oswin sees something that matters to him, and a review is due.
    const oswin = await readResident(pool, 'oswin');
    const { rows: [{ state: world }] } = await pool.query('SELECT state FROM dalecrest.world WHERE id=1');
    remember(oswin, world.minute, 'Oswin Holt found the oven’s woodpile empty with the cold coming on.', ['oswin'], 'observation', { importance: 8, shortage: 'wood' });
    const key = memoryKey(oswin, oswin.memories.at(-1));
    oswin.reviewDue = { since: world.minute, why: 'learned something consequential' };
    oswin.action = { kind: 'waiting', phase: 'waiting', label: 'Choosing the next activity', target: 'wood', remaining: 0, since: world.minute,
      why: 'no instruction applies', previous: { kind: 'idle', label: 'Starting the day', target: 'wood' } };
    await pool.query("UPDATE dalecrest.actors SET state=$1 WHERE id='oswin'", [oswin]);
    // Everyone else is busy for the rest of the test.
    await pool.query("UPDATE dalecrest.actors SET state=jsonb_set(state,'{action}',jsonb_build_object('kind','rest','label','Resting','target',state->>'home','phase','working','remaining',600)) WHERE id <> 'oswin'");

    // The goal model, stood in for, reads the request and rests a new goal on what Oswin saw.
    let sent;
    const reply = review => async (url, init) => {
      sent = JSON.parse(init.body);
      return { status: 200, text: async () => JSON.stringify({ stop_reason: 'end_turn', usage: { input_tokens: 1200, output_tokens: 150 },
        content: [{ type: 'text', text: JSON.stringify(review) }] }) };
    };
    const decisions = [
      { action: 'keep', goalId: 'g1', text: '', kind: 'evidence', focus: 'work', about: '', condition: { type: 'none', item: '', atLeast: 0, place: '', job: '', count: 0, requestId: '', withinHours: 0 }, evidence: [] },
      { action: 'keep', goalId: 'g2', text: '', kind: 'evidence', focus: 'social', about: '', condition: { type: 'none', item: '', atLeast: 0, place: '', job: '', count: 0, requestId: '', withinHours: 0 }, evidence: [] },
      { action: 'new', goalId: '', text: 'Stack a load of firewood before nightfall', kind: 'condition', focus: 'work', about: '',
        condition: { type: 'work', item: '', atLeast: 0, place: '', job: 'cut', count: 1, requestId: '', withinHours: 12 }, evidence: [key] },
    ];
    const settled = await db.reviewGoalsOnce({ key: 'test-key', request: reply({ decisions, statement: 'The oven shall not go cold while I have an axe.' }) });
    assert.equal(settled.status, 'applied');
    assert.equal(sent.model, 'claude-haiku-5-5');
    assert.equal(sent.output_config.format.type, 'json_schema');
    const input = JSON.parse(sent.messages[0].content);
    assert.ok(input.observations.some(o => o.key === key), JSON.stringify([input.resident.id, key, input.observations]));
    const [version] = (await pool.query("SELECT * FROM dalecrest.goal_versions WHERE actor_id='oswin' AND goal_id='g3'")).rows;
    assert.deepEqual([version.kind, version.status, version.basis, Number(version.review_id) > 0], ['condition', 'active', [key], true]);
    const [said] = (await pool.query("SELECT description, salience FROM dalecrest.events WHERE kind='intention'")).rows;
    assert.equal(said.description, 'Oswin Holt, in their own words: “The oven shall not go cold while I have an axe.”');
    assert.ok(said.salience >= 3);
    const [rev] = (await pool.query('SELECT status, token_charge, statement FROM dalecrest.goal_reviews')).rows;
    assert.deepEqual([rev.status, rev.token_charge], ['applied', 1350]);

    // He chooses to cut wood, and the request records the goal it was given.
    const ticket = await db.claimAction(20000);
    const asked = JSON.parse(ticket.body).input[0].content[0].data;
    assert.ok(asked.goals.some(g => g.text === 'Stack a load of firewood before nightfall'), JSON.stringify([asked.name, asked.goals]));
    await db.recordReply(ticket.id, { status: 200, requestId: 'test-goal', redacted: false, body: JSON.stringify({
      answers: [{ name: 'next_action', type: 'choice', choice: 'work:cut:wood', confidence: 0.9 }], usage: { total_tokens: 400 } }) });
    assert.equal((await db.applyRecordedDecision(ticket.id)).status, 'applied');
    const [trace] = (await pool.query('SELECT goal_keys, observation_keys FROM dalecrest.decision_traces WHERE id=$1', [ticket.id])).rows;
    assert.ok(trace.goal_keys.includes('oswin:g3:1'));
    // Finish the shift at the coppice.
    const cutting = await readResident(pool, 'oswin');
    const { rows: [{ state: map }] } = await pool.query('SELECT state FROM dalecrest.map');
    const coppice = map.places.find(p => p.id === 'wood');
    Object.assign(cutting.action, { phase: 'working', remaining: 1 });
    delete cutting.action.path;
    cutting.position = { x: coppice.at[0], y: coppice.at[1] };
    await pool.query("UPDATE dalecrest.actors SET state=$1 WHERE id='oswin'", [cutting]);
    await pool.query("UPDATE dalecrest.world SET state=jsonb_set(state,'{supplies,wood}','2')");
    await tickNow();
    await tickNow();

    // The goal is settled by the engine, and the whole chain reads back in one query.
    const [met] = (await pool.query("SELECT status, outcome FROM dalecrest.goal_versions WHERE actor_id='oswin' AND goal_id='g3'")).rows;
    assert.equal(met.status, 'met');
    const chain = (await pool.query("SELECT * FROM dalecrest.goal_chain WHERE actor_id='oswin' AND goal_id='g3'")).rows;
    assert.ok(chain.length >= 1, 'the chain did not read back');
    const link = chain.find(r => r.witnessed_by === 'oswin');
    assert.equal(link.observation, 'Oswin Holt found the oven’s woodpile empty with the cold coming on.');
    assert.equal(link.goal, 'Stack a load of firewood before nightfall');
    assert.equal(Number(link.trace_id), Number(ticket.id));
    assert.match(link.outcome, /^Oswin Holt stacked/);
  } finally {
    if (db) await db.pool.end();
    if (created) await admin.query('DROP DATABASE ' + name);
    await admin.end();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createVillage, stepVillage } from './sim.mjs';
import { advanceWithTraces } from './decision-trace.mjs';
import { decisionBody, sendDecision, interpretDecision } from './decisions.mjs';

const observation = { name: 'Agnes Reed', goals: ['Maintain the grain reserve'], needs: { hunger: 17 } };
const body = decisionBody(observation);
const raw = '{ "answers":[{"name":"priority","type":"choice","choice":"food","confidence":0.76,"probabilities":[{"value":"food","probability":0.8}]}], "usage":{"input_tokens":129} }\n';

test('transport preserves the exact posted and returned text and provider request ID', async () => {
  const reply = await sendDecision(body, 'test-key', async (_, options) => {
    assert.equal(options.body, body);
    return new Response(raw, {headers: {'x-request-id': 'req-example'}});
  });
  assert.deepEqual(reply, {status: 200, requestId: 'req-example', body: raw, redacted: false});
  assert.equal(interpretDecision(observation, reply).confidence, 0.76);
  const failure = await sendDecision(body, 'test-key', async () => new Response('bad credential test-key', {status:401}));
  assert.deepEqual(failure, {status:401,requestId:null,body:'bad credential [credential redacted]',redacted:true});
});

test('minute-level tracing leaves actions, RNG, and journal identical and stops at expiry', () => {
  const actual = createVillage(), expected = structuredClone(actual);
  const until = actual.world.minute + 135;
  const traced = advanceWithTraces(actual, 150, [{actor_id:'agnes',id:'7',until_minute:until}]);
  assert.deepEqual(traced.events, stepVillage(expected, {minutes:150}));
  assert.deepEqual(actual, expected);
  for (const kind of ['selected','arrived','activity_ended']) assert.ok(traced.steps.some(s=>s.kind===kind));
  assert.ok(traced.steps.every(s=>s.minute < until && s.trace_id==='7'));
});

// Opt-in. The connection needs CREATEDB. Only the uniquely named database created here is dropped.
test('PostgreSQL preserves the trace, resumes a received reply, and links actual events', {
  skip: !process.env.DALECREST_TEST_ADMIN_URL
}, async () => {
  const {default:pg} = await import('pg');
  const admin = new pg.Client({connectionString:process.env.DALECREST_TEST_ADMIN_URL});
  await admin.connect();
  const name = 'dalecrest_trace_test_' + randomUUID().replaceAll('-','');
  const url = new URL(process.env.DALECREST_TEST_ADMIN_URL);
  let db, created = false;
  try {
    await admin.query('CREATE DATABASE ' + name);
    created = true;
    url.pathname = '/' + name;
    process.env.DATABASE_URL = url.href;
    db = await import('./db.mjs');
    await db.initialize();
    const snapshot = await db.snapshot();
    const minute = snapshot.world.minute;
    const tickets = await Promise.all([1,2].map(()=>db.reserveDecision(300,'agnes',minute,body)));
    const ids = tickets.filter(Boolean);
    assert.equal(ids.length,1);
    const id = ids[0];
    await db.recordReply(id,{status:200,body:raw,requestId:'req-db-test',redacted:false});
    assert.equal(await db.pendingDecision(),id);
    assert.equal((await db.applyRecordedDecision(id)).status,'applied');
    assert.equal(await db.applyRecordedDecision(id),undefined);
    // End a meal on the next minute and observe the following selection in the same three-minute tick.
    await db.pool.query(`UPDATE dalecrest.actors SET state=jsonb_set(state,'{action}',$1::jsonb)
      WHERE id='agnes'`,[JSON.stringify({kind:'food',label:'Taking a loaf',phase:'working',target:'oven',remaining:1})]);
    await db.advance();
    const trace = (await db.pool.query('SELECT * FROM dalecrest.decision_traces WHERE id=$1',[id])).rows[0];
    assert.equal(trace.confidence,0.76);
    assert.equal(trace.response_body,raw);
    assert.equal(trace.request_body,body);
    assert.equal(trace.state_at_application.action.kind,snapshot.actors[0].action.kind);
    const steps = (await db.pool.query(`SELECT s.kind, e.kind AS event FROM dalecrest.decision_steps s
      LEFT JOIN dalecrest.events e ON e.id=s.event_id WHERE s.trace_id=$1`,[id])).rows;
    assert.ok(steps.some(s=>s.kind==='selected'));
    assert.ok(steps.some(s=>s.kind==='activity_ended'));
    assert.ok(steps.some(s=>s.kind==='chronicle' && s.event==='meal'));
    assert.ok(!JSON.stringify(await db.snapshot()).includes('req-db-test'));
    // A delayed response retains the wire evidence even when its plan is too old.
    await db.pool.query('UPDATE dalecrest.planner_limits SET next_request_at=now()');
    const stale = await db.reserveDecision(300,'hugh',minute-150,body);
    await db.recordReply(stale,{status:200,body:raw,requestId:'req-stale',redacted:false});
    assert.equal((await db.applyRecordedDecision(stale)).status,'stale');
    await db.pool.query('UPDATE dalecrest.planner_limits SET next_request_at=now()');
    const bad = await db.reserveDecision(300,'hugh',minute,body);
    await db.recordReply(bad,{status:502,body:'bad gateway',requestId:null,redacted:false});
    assert.equal((await db.applyRecordedDecision(bad)).status,'http_error');
    const err = (await db.pool.query('SELECT response_body,confidence FROM dalecrest.decision_traces WHERE id=$1',[bad])).rows[0];
    assert.deepEqual(err,{response_body:'bad gateway',confidence:null});

    // A night-time meal beats the old sleep heuristic when Luna explicitly selects it.
    process.env.PLANNER_PROVIDER = 'openai';
    const alice = snapshot.actors.find(a => a.id === 'alice');
    const sleep = {kind:'rest', label:'Sleeping at home', target:alice.home, phase:'working', remaining:1};
    await db.pool.query("UPDATE dalecrest.actors SET state=jsonb_set(state,'{action,remaining}','999')");
    await db.pool.query("UPDATE dalecrest.actors SET state=jsonb_set(jsonb_set(state,'{action}',$1),'{needs,hunger}','4') WHERE id='alice'",[sleep]);
    await db.pool.query("UPDATE dalecrest.world SET state=jsonb_set(state,'{minute}','1320'),next_tick=now()");
    assert.equal(await db.claimAction(7000),undefined);
    await db.advance();
    assert.equal((await db.snapshot()).actors.find(a => a.id==='alice').action.kind,'waiting');
    const beforeWait = (await db.snapshot()).world.minute;
    await db.pool.query('UPDATE dalecrest.world SET next_tick=now()');
    await db.advance();
    const waitingState = await db.snapshot();
    assert.equal(waitingState.world.minute,beforeWait+1);
    assert.equal(waitingState.actors.find(a=>a.id==='alice').action.kind,'waiting');
    assert.deepEqual(await db.claimAction(0),{budgetLimited:true});
    const tickets2 = await Promise.all([db.claimAction(7000),db.claimAction(7000)]);
    const [first] = tickets2.filter(Boolean);
    assert.equal(tickets2.filter(Boolean).length,1);
    const question = JSON.parse(first.body).questions[0];
    assert.equal(question.name,'next_action');
    const meal = question.choices.find(c => c.value.startsWith('food:')).value;
    const reply = value => ({status:200,requestId:'req-action',redacted:false,body:JSON.stringify({
      answers:[{type:'choice',name:'next_action',choice:value,confidence:0.91}],usage:{total_tokens:275}})});
    await db.recordReply(first.id,reply(meal));
    await db.pool.query("UPDATE dalecrest.world SET state=jsonb_set(state,'{supplies,bread}','0')");
    assert.equal((await db.applyRecordedDecision(first.id)).status,'unavailable');
    assert.equal((await db.snapshot()).actors.find(a => a.id==='alice').action.kind,'waiting');
    await db.pool.query("UPDATE dalecrest.decision_traces SET requested_at=now()-interval '2 minutes' WHERE id=$1",[first.id]);
    const empty = await db.claimAction(7000);
    assert.ok(!JSON.parse(empty.body).questions[0].choices.some(c => c.value.startsWith('food:')));
    await db.recordReply(empty.id,reply(meal));
    assert.equal((await db.applyRecordedDecision(empty.id)).status,'invalid_response');
    await db.pool.query("UPDATE dalecrest.decision_traces SET requested_at=now()-interval '2 minutes' WHERE id=$1",[empty.id]);
    await db.pool.query("UPDATE dalecrest.world SET state=jsonb_set(state,'{supplies,bread}','10')");
    const fresh = await db.claimAction(7000);
    await db.recordReply(fresh.id,reply(meal));
    assert.equal(await db.pendingDecision(),fresh.id);
    assert.equal((await db.applyRecordedDecision(fresh.id)).status,'applied');
    assert.equal(await db.applyRecordedDecision(fresh.id),undefined);
    const started = (await db.snapshot()).actors.find(a=>a.id==='alice').action;
    assert.equal(started.choiceId,meal);
    assert.equal(started.decisionTraceId,fresh.id);
    for (let i=0;i<90;i++) {
      await db.pool.query('UPDATE dalecrest.world SET next_tick=now()');
      await db.advance();
      if ((await db.snapshot()).actors.find(a=>a.id==='alice').action.kind==='waiting') break;
    }
    const history = (await db.pool.query(`SELECT s.kind,e.kind AS event FROM dalecrest.decision_steps s
      LEFT JOIN dalecrest.events e ON s.event_id=e.id WHERE s.trace_id=$1 ORDER BY s.minute,s.id`,[fresh.id])).rows;
    assert.deepEqual(history.map(s=>s.kind),['selected','arrived','activity_ended','chronicle']);
    assert.equal(history.at(-1).event,'meal');
    const saved = (await db.pool.query('SELECT token_charge,choice,confidence,end_reason FROM dalecrest.decision_traces WHERE id=$1',[fresh.id])).rows[0];
    assert.deepEqual(saved,{token_charge:275,choice:meal,confidence:0.91,end_reason:'activity_ended'});
  } finally {
    if (db) await db.pool.end();
    if (created) await admin.query('DROP DATABASE ' + name);
    await admin.end();
  }
});

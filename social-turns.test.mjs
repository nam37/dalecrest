import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { createVillage, stepVillage, startChosen, availableActions, locationsOf } from './sim.mjs';
import { actionBody } from './decisions.mjs';

const who = (v, id) => v.actors.find(a => a.id === id);
const tick = (v, minutes = 1) => stepVillage(v, { externalActions: true, minutes });
const body = (v, a) => JSON.parse(actionBody(a, v.world, availableActions(a, v), locationsOf(v.map, v.actors)));
const options = (v, a) => [...availableActions(a, v).keys()];
function choose(v, a, prefix, trace) {
  const key = options(v, a).find(k => k.startsWith(prefix));
  assert.ok(key, 'expected option ' + prefix);
  assert.ok(startChosen(a, v, key, { id: trace, model: 'fixture' }));
}
function complete(v, a) {
  const action = a.action, events = [];
  for (let i = 0; i < 400 && action === a.action; i++) events.push(...tick(v));
  assert.notEqual(a.action, action);
  return events;
}
function at(v, a, site) {
  const [x, y] = v.map.places.find(p => p.id === site).at;
  a.position = { x, y };
  a.action.target = site;
}
function start() {
  const v = createVillage();
  v.world.supplies.wood = 0;
  tick(v);
  return v;
}
function inspect(v, id = 'mabel') {
  const a = who(v, id);
  choose(v, a, 'inspect:', '1');
  complete(v, a);
}
function ask(v) {
  const m = who(v, 'mabel');
  inspect(v);
  choose(v, m, 'ask:oswin:wood-', '2');
  const event = complete(v, m).find(e => e.outcome?.verb === 'ask');
  assert.equal(event.outcome.delivered, true);
  return event.outcome.requestId;
}

test('any witness can share or relay dated knowledge without sharing it with bystanders', () => {
  const v = start(), alice = who(v, 'alice'), edith = who(v, 'edith'), hugh = who(v, 'hugh');
  inspect(v, 'alice');
  at(v, edith, 'oven');
  at(v, hugh, 'oven');
  v.world.supplies.wood = 26;
  choose(v, alice, 'share:edith:oven-', '2');
  const report = complete(v, alice).find(e => e.outcome?.verb === 'share');
  assert.deepEqual(report.actorIds, ['alice', 'edith']);
  assert.equal(edith.reports.oven.fact.wood, 0);
  assert.equal(edith.observations?.ovenStores, undefined);
  assert.equal(hugh.reports, undefined);
  let data = body(v, edith).input[0].content[0].data;
  assert.equal(data.lastOvenCheck, null);
  assert.match(data.heard[0].observed, /August 1312/);
  assert.ok(options(v, edith).some(k => k.startsWith('ask:oswin:wood-')));
  assert.ok(!options(v, alice).some(k => k.startsWith('share:edith:oven-')));
  choose(v, edith, 'share:hugh:oven-', '3');
  complete(v, edith);
  data = body(v, hugh).input[0].content[0].data;
  assert.equal(data.heard[0].toldBy, edith.name);
  assert.equal(data.heard[0].witnessedBy, alice.name);
  assert.equal(hugh.reports.oven.fact.id, edith.reports.oven.fact.id);
  inspect(v, 'edith');
  assert.ok(!options(v, edith).some(k => k.startsWith('ask:oswin:wood-')));
  assert.ok(options(v, edith).some(k => k.startsWith('share:alice:oven-edith')));
});

test('a missed visit does not deliver knowledge or create a request', () => {
  const v = start(), m = who(v, 'mabel'), o = who(v, 'oswin');
  inspect(v);
  choose(v, m, 'ask:oswin:wood-', '2');
  at(v, o, 'hall');
  const event = complete(v, m).find(e => e.outcome?.verb === 'ask');
  assert.equal(event.outcome.delivered, false);
  assert.deepEqual(event.actorIds, ['mabel']);
  assert.equal(o.reports, undefined);
  assert.equal(v.world.helpRequests, undefined);
});

test('an interrupted conversation records the attempted contact once', () => {
  const v = start(), m = who(v, 'mabel');
  inspect(v);
  choose(v, m, 'ask:oswin:wood-', '2');
  v.world.moot = { at: v.world.minute + 36, tries: 0 };
  const failures = tick(v, 2).filter(e => e.outcome?.delivered === false);
  assert.equal(failures.length, 1);
  assert.match(failures[0].outcome.cause, /moot/);
  assert.equal(failures[0].outcome.traceId, '2');
  assert.equal(who(v, 'oswin').reports, undefined);
});

test('a wellkeeper can ask for help on a low count from work, without ever visiting an oven', () => {
  const v = start(), alice = who(v, 'alice'), robin = who(v, 'robin');
  v.world.supplies.water = 0;
  choose(v, alice, 'work:draw:', '1');
  complete(v, alice);
  assert.equal(alice.observations.lastWork.stock.water, 4);
  assert.equal(alice.observations.ovenStores, undefined);
  at(v, robin, 'well');
  const [askKey] = options(v, alice).filter(k => k.startsWith('ask:robin:water-'));
  assert.ok(askKey);
  v.world.supplies.water = 14;
  choose(v, alice, askKey, '2');
  const ask = complete(v, alice).find(e => e.outcome?.verb === 'ask');
  assert.equal(ask.outcome.fact.stock.water, 4);
  assert.equal(ask.outcome.terms.item, 'water');
  assert.ok(!options(v, robin).some(k => k.startsWith('ask:alice:water-')));
  assert.ok(options(v, robin).some(k => k.startsWith('accept:alice:')));
});

test('recipients can decline, do something else, or leave an ask unanswered', () => {
  for (const answer of ['decline', 'unanswered']) {
    const v = start(), request = ask(v), o = who(v, 'oswin'), m = who(v, 'mabel');
    const choices = options(v, o);
    assert.ok(choices.some(k => k.startsWith('accept:mabel:')));
    assert.ok(choices.some(k => k.startsWith('decline:mabel:')));
    assert.ok(choices.some(k => k.startsWith('work:cut:')));
    assert.equal(body(v, who(v, 'alice')).input[0].content[0].data.helpRequests, undefined);
    if (answer === 'decline') {
      choose(v, o, 'decline:mabel:', '3');
      complete(v, o);
      assert.equal(m.helpBook[request].status, 'declined');
      assert.equal(v.world.helpRequests[request], undefined);
      assert.ok(!options(v, m).some(k => k.startsWith('ask:oswin:wood-')));
    } else {
      choose(v, o, 'leisure:green', '3');
      assert.equal(v.world.helpRequests[request].status, 'asked');
      v.world.minute = v.world.helpRequests[request].due;
      const [expired] = tick(v).filter(e => e.outcome?.requestId === request);
      assert.equal(expired.outcome.verb, 'unanswered');
      assert.equal(m.helpBook[request], undefined);
    }
  }
});

test('only a chosen shift for the promise earns credit, and the requester can learn its outcome in person', () => {
  let v = start();
  const request = ask(v);
  v = JSON.parse(JSON.stringify(v));
  const o = who(v, 'oswin'), m = who(v, 'mabel');
  choose(v, o, 'accept:mabel:', '3');
  complete(v, o);
  assert.equal(m.helpBook[request].status, 'accepted');
  const alternative = JSON.parse(JSON.stringify(v)), other = who(alternative, 'oswin');
  choose(alternative, other, 'work:cut:', '4');
  complete(alternative, other);
  assert.equal(alternative.world.helpRequests[request].status, 'accepted');
  alternative.world.minute = alternative.world.helpRequests[request].due;
  assert.ok(tick(alternative).some(e => e.outcome?.verb === 'broken'));
  choose(v, o, 'help:' + request + ':', '5');
  assert.equal(o.action.basis.kind, 'fresh');
  assert.equal(Object.values(o.instructions || {}).some(i => i.trace === '5'), false);
  const events = complete(v, o), shift = events.find(e => e.outcome?.commitmentId);
  assert.deepEqual(shift.outcome.stockDelta, { wood: 3 });
  assert.equal(shift.outcome.traceId, '5');
  assert.equal(o.helpBook[request].status, 'kept');
  assert.equal(m.helpBook[request].status, 'accepted');
  choose(v, o, 'share:mabel:work-', '6');
  complete(v, o);
  assert.equal(m.helpBook[request].status, 'kept');
});

const adminUrl = process.env.DALECREST_TEST_ADMIN_URL;
test('PostgreSQL delivers the request once and rejects a reply made before the recipient heard it', { skip: !adminUrl }, async () => {
  const admin = new pg.Client({ connectionString: adminUrl }), name = 'dalecrest_social_' + randomUUID().replaceAll('-', '');
  let db, created;
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
    const v = start(), m = who(v, 'mabel'), o = who(v, 'oswin');
    inspect(v);
    at(v, m, 'wood');
    for (const a of v.actors) {
      if (a !== m && a !== o) Object.assign(a.action, { remaining: 999, kind: 'leisure', phase: 'working' });
    }
    m.action.since = v.world.minute - 2;
    o.action.since = v.world.minute - 1;
    await db.pool.query('UPDATE dalecrest.world SET state=$1, next_tick=now()', [v.world]);
    for (const a of v.actors) await db.pool.query('UPDATE dalecrest.actors SET state=$1 WHERE id=$2', [a, a.id]);
    async function chosen(ticket, prefix) {
      const choice = JSON.parse(ticket.body).questions[0].choices.find(c => c.value.startsWith(prefix)).value;
      await db.recordReply(ticket.id, { status: 200, redacted: false, body: JSON.stringify({ answers: [{ name: 'next_action', type: 'choice', choice, confidence: 0.8 }], usage: { total_tokens: 50 } }) });
      return (await db.applyRecordedDecision(ticket.id)).status;
    }
    const askTurn = await db.claimAction(100000);
    assert.equal(await chosen(askTurn, 'ask:oswin:wood-'), 'applied');
    const oldTurn = await db.claimAction(100000);
    assert.equal(JSON.parse(oldTurn.body).input[0].content[0].data.name, o.name);
    await db.advance();
    await db.pool.query('ALTER TABLE dalecrest.events ADD CONSTRAINT reject_exchange CHECK (kind <> \'social\') NOT VALID');
    await db.pool.query('UPDATE dalecrest.world SET next_tick=now()');
    await assert.rejects(db.advance(), { code: '23514' });
    assert.equal((await db.snapshot()).world.helpRequests, undefined);
    await db.pool.query('ALTER TABLE dalecrest.events DROP CONSTRAINT reject_exchange');
    await Promise.all([db.advance(), db.advance()]);
    await db.initialize();
    assert.equal(await chosen(oldTurn, 'work:cut:'), 'superseded');
    const received = (await db.pool.query("SELECT outcome FROM dalecrest.events WHERE outcome->>'verb'='ask'")).rows;
    assert.equal(received.length, 1);
    assert.equal(received[0].outcome.traceId, askTurn.id);
    // Give the next turn to the addressee, just as the normal queue eventually does.
    await db.pool.query("UPDATE dalecrest.actors SET state=jsonb_set(state,'{action,kind}','\"leisure\"') WHERE id='mabel'");
    const answer = await db.claimAction(100000);
    assert.equal(JSON.parse(answer.body).input[0].content[0].data.helpRequests[0].status, 'asked');
    assert.equal(await chosen(answer, 'decline:mabel:'), 'applied');
    for (let n = 0; n < 2; n++) {
      await db.pool.query('UPDATE dalecrest.world SET next_tick=now()');
      await db.advance();
    }
    const rows = await db.pool.query("SELECT outcome FROM dalecrest.events WHERE outcome->>'requestId'=$1 ORDER BY id", [received[0].outcome.requestId]);
    assert.deepEqual(rows.rows.map(r => [r.outcome.verb, r.outcome.traceId]), [['ask', askTurn.id], ['decline', answer.id]]);
  } finally {
    if (db) await db.pool.end();
    if (created) await admin.query('DROP DATABASE ' + name);
    await admin.end();
  }
});

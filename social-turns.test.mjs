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

test('a failed report stays in the next decision but the same visit waits for a chance to meet', () => {
  let v = start();
  inspect(v);
  let m = who(v, 'mabel'), a = who(v, 'agnes');
  at(v, a, 'green');
  const closeReport = 'share:agnes:oven-';
  const distant = body(v, m).questions[0].choices.find(o => o.value.startsWith(closeReport));
  assert.match(distant.description, /if they are still there .*after arrival/);
  assert.ok(startChosen(m, v, distant.value, { id: '2', model: 'fixture' }));
  at(v, a, a.home);
  a.action = { kind: 'rest', target: a.home, label: 'Resting at home', phase: 'working', remaining: 105 };

  const failure = complete(v, m).find(e => e.outcome?.verb === 'share');
  assert.equal(failure.outcome.delivered, false);
  assert.equal(failure.outcome.traceId, '2');
  assert.equal(failure.outcome.target, 'green');
  assert.equal(failure.outcome.factId, 'oven-mabel-' + m.observations.ovenStores.minute);
  assert.equal(a.reports, undefined);

  // Preserve the failed encounter through a reload and make it compete with weightier memories.
  v = JSON.parse(JSON.stringify(v));
  m = who(v, 'mabel');
  a = who(v, 'agnes');
  for (let i = 0; i < 6; i++) m.memories.push({ minute: v.world.minute, importance: 9, text: 'Important memory ' + i });
  const after = body(v, m);
  const canReport = decision => decision.questions[0].choices.some(o => o.value.startsWith(closeReport));
  assert.ok(after.input[0].content[0].data.recentMemories.some(memory => memory.endsWith(failure.text)));
  assert.equal(canReport(after), false);
  assert.ok(after.questions[0].choices.some(o => o.value.startsWith('share:oswin:oven-')));
  assert.ok(after.questions[0].choices.some(o => o.value === 'leisure:green'));
  assert.equal(startChosen(m, v, distant.value, { id: '3' }), null);

  a.action = { kind: 'waiting', target: a.home, phase: 'waiting', remaining: 0 };
  assert.equal(canReport(body(v, m)), false);
  assert.ok(!options(v, m).some(k => k.startsWith('social:agnes:')));
  v.world.minute = failure.minute + 30;
  assert.equal(canReport(body(v, m)), true);
  a.action.kind = 'rest';
  assert.equal(canReport(body(v, m)), false);

  v.world.minute = failure.minute + 2;
  a.action.kind = 'waiting';
  at(v, a, 'green');
  choose(v, m, closeReport, '4');
  assert.equal(complete(v, m).find(e => e.outcome?.verb === 'share').outcome.delivered, true);
  assert.equal(a.reports.oven.fact.id, failure.outcome.factId);
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
  assert.equal(other.requestMemories.at(-1).status, 'broken');
  assert.equal(who(alternative, 'mabel').requestMemories.at(-1).status, 'unconfirmed');
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

test('personal request histories survive the deadline and a late account can confirm a named shift', () => {
  let v = start();
  const id = ask(v), o = who(v, 'oswin'), e = who(v, 'edith');
  choose(v, o, 'accept:mabel:', '3');
  complete(v, o);
  choose(v, o, 'help:' + id + ':', '4');
  complete(v, o);
  const proof = o.observations.lastWork;
  at(v, e, 'wood');
  choose(v, o, 'share:edith:work-', '5');
  complete(v, o);
  choose(v, o, 'work:cut:', '6');
  complete(v, o);
  assert.notEqual(o.observations.lastWork.id, proof.id);
  v.world.minute = o.helpBook[id].due;
  tick(v);
  v = JSON.parse(JSON.stringify(v));
  const helper = who(v, 'oswin'), requester = who(v, 'mabel'), relay = who(v, 'edith');
  const past = a => body(v, a).input[0].content[0].data.pastRequests;
  assert.equal(past(helper)[0].status, 'kept');
  assert.equal(past(requester)[0].status, 'unconfirmed');
  assert.equal(past(relay), undefined);
  assert.equal(requester.helpBook[id], undefined);
  assert.ok(options(v, helper).some(key => key.startsWith('share:mabel:' + proof.id + ':')));
  at(v, requester, 'wood');
  choose(v, relay, 'share:mabel:' + proof.id, '7');
  const shared = complete(v, relay).find(event => event.outcome?.verb === 'share');
  assert.equal(shared.outcome.requestId, id);
  assert.equal(past(requester).length, 1);
  assert.deepEqual([past(requester)[0].status, past(requester)[0].witnessedBy, past(requester)[0].toldBy],
    ['kept', helper.name, relay.name]);
  assert.equal(past(who(v, 'alice')), undefined);
});

const adminUrl = process.env.DALECREST_TEST_ADMIN_URL;
test('an ordinary shift leaves the request alone until a new count, then the requester decides', () => {
  let v = start();
  const id = ask(v), m = who(v, 'mabel'), o = who(v, 'oswin');
  choose(v, o, 'work:cut:', '3');
  o.instructions = {};
  const cut = complete(v, o).find(e => e.outcome?.stockDelta?.wood);
  assert.equal(cut.outcome.stockDelta.wood, 3);
  assert.equal(cut.outcome.commitmentId, undefined);
  assert.equal(m.helpBook[id].status, 'asked');
  assert.equal(body(v, m).input[0].content[0].data.helpRequests[0].reasonToReconsider, undefined);
  assert.ok(!options(v, m).some(k => k.startsWith('release:')));
  inspect(v);
  const news = body(v, m).input[0].content[0].data.helpRequests[0].reasonToReconsider;
  assert.deepEqual([news.originalCount, news.observedReserve, news.witnessedBy], [0, 3, m.name]);
  assert.equal(news.quantityAdded, undefined);
  assert.ok(!JSON.stringify(news).includes('Oswin'));
  const key = options(v, m).find(k => k.startsWith('release:oswin:'));
  v.world.supplies.wood = 0;
  assert.ok(options(v, m).includes(key), 'unseen consumption cannot change her options');
  choose(v, m, 'retain:', '4');
  const keep = complete(v, m).find(e => e.outcome?.verb === 'retain');
  assert.deepEqual(keep.actorIds, ['mabel']);
  assert.equal(keep.outcome.traceId, '4');
  assert.equal(keep.outcome.evidence.count, 3);
  assert.equal(v.world.helpRequests[id].status, 'asked');
  assert.equal(o.helpBook[id].reviewedFact, undefined);
  assert.equal(body(v, m).input[0].content[0].data.helpRequests[0].reasonToReconsider.keptOpenOnThisEvidence, true);
  assert.ok(!options(v, m).some(k => k.startsWith('retain:')));
  inspect(v);
  v = JSON.parse(JSON.stringify(v));
  const resumed = who(v, 'mabel');
  choose(v, resumed, 'release:oswin:', '5');
  const release = complete(v, resumed).find(e => e.outcome?.verb === 'release');
  assert.equal(release.outcome.delivered, true);
  assert.equal(release.outcome.evidence.count, 0, 'the actor may release even when the count is low');
  assert.equal(release.outcome.terms.status, 'released');
  assert.equal(who(v, 'oswin').helpBook[id].status, 'released');
  assert.equal(v.world.helpRequests[id], undefined);
});

test('retelling a work outcome preserves who stacked wood and gives no secret reserve balance', () => {
  const v = start(), id = ask(v), m = who(v, 'mabel'), o = who(v, 'oswin'), edith = who(v, 'edith');
  // A different resident does the cutting, and Oswin relays the account to Mabel.
  choose(v, edith, 'work:cut:', '3');
  edith.instructions = {};
  complete(v, edith);
  at(v, o, 'wood');
  choose(v, edith, 'share:oswin:work-', '4');
  complete(v, edith);
  assert.equal(m.helpBook[id].update, undefined);
  choose(v, o, 'share:mabel:work-', '5');
  complete(v, o);
  const r = m.helpBook[id];
  assert.deepEqual([r.update.observer, r.update.toldBy, r.update.added, r.update.learnedTrace], [edith.name, o.name, 3, '5']);
  assert.equal(r.update.count, undefined);
  assert.equal(m.observations.ovenStores.wood, 0);
  assert.ok(options(v, m).some(k => k.startsWith('retain:')));
  assert.equal(body(v, who(v, 'alice')).input[0].content[0].data.helpRequests, undefined);
  const report = structuredClone(r.update);
  choose(v, o, 'accept:mabel:', '6');
  complete(v, o);
  assert.deepEqual(m.helpBook[id].update, report);
  choose(v, m, 'release:oswin:', '7');
  at(v, o, 'hall');
  const missed = complete(v, m).find(e => e.outcome?.verb === 'release');
  assert.equal(missed.outcome.delivered, false);
  assert.equal(v.world.helpRequests[id].status, 'accepted');
  assert.equal(o.helpBook[id].status, 'accepted');
});

test('a wellkeeper can review a request from a personal water count', () => {
  const v = start(), alice = who(v, 'alice'), robin = who(v, 'robin');
  v.world.supplies.water = 0;
  choose(v, alice, 'work:draw:', '1');
  complete(v, alice);
  at(v, robin, 'well');
  choose(v, alice, 'ask:robin:water-', '2');
  const id = complete(v, alice).find(e => e.outcome?.verb === 'ask').outcome.requestId;
  choose(v, alice, 'work:draw:', '3');
  complete(v, alice);
  const review = alice.helpBook[id].update;
  assert.deepEqual([review.count, review.added, review.observer], [8, 4, alice.name]);
  choose(v, alice, 'release:robin:', '4');
  complete(v, alice);
  assert.equal(robin.helpBook[id].status, 'released');
});

test('deferring restores ordinary activities and an older account cannot reopen the same review', () => {
  const v = start(), id = ask(v), m = who(v, 'mabel'), o = who(v, 'oswin');
  choose(v, o, 'work:cut:', '3');
  o.instructions = {};
  complete(v, o);
  // Historical work memories recorded this exact outcome without a structured amount.
  delete o.observations.lastWork.produced;
  choose(v, o, 'share:mabel:work-', '4');
  complete(v, o);
  assert.deepEqual(options(v, m).map(k => k.split(':')[0]).sort(), ['defer','release','retain']);
  assert.equal(m.helpBook[id].update.added, 3);
  choose(v, m, 'defer:', '5');
  complete(v, m);
  assert.equal(v.world.helpRequests[id].status, 'asked');
  assert.ok(options(v, m).some(k => k.startsWith('inspect:')));
  assert.ok(!options(v, m).some(k => k.startsWith('defer:')));
  inspect(v);
  const seen = structuredClone(m.helpBook[id].update);
  choose(v, m, 'retain:', '6');
  complete(v, m);
  // Another messenger brings the older account after the new firsthand count.
  const e = who(v, 'edith');
  at(v, e, 'wood');
  choose(v, o, 'share:edith:work-', '7');
  complete(v, o);
  choose(v, e, 'share:mabel:work-', '8');
  complete(v, e);
  assert.deepEqual(m.helpBook[id].update, seen);
  assert.ok(!options(v, m).some(k => k.startsWith('retain:')));
});

test('PostgreSQL preserves a recheck and applies the withdrawal once across a failed delivery tick', { skip: !adminUrl }, async () => {
  const admin = new pg.Client({ connectionString: adminUrl }), name = 'dalecrest_review_' + randomUUID().replaceAll('-', '');
  let db, created;
  await admin.connect();
  try {
    await admin.query('CREATE DATABASE ' + name);
    created = true;
    const url = new URL(adminUrl);
    url.pathname = '/' + name;
    // The other PostgreSQL case in this file imports db.mjs for its own isolated database.
    process.env.DATABASE_URL = url.href;
    process.env.PLANNER_PROVIDER = 'openai';
    process.env.VILLAGE_SECONDS_PER_MINUTE = '30';
    db = await import('./db.mjs?request-review-test');
    await db.initialize();
    const v = start(), id = ask(v), m = who(v, 'mabel');
    v.world.supplies.wood = 3;
    at(v, m, 'oven');
    at(v, who(v, 'oswin'), 'oven');
    for (const a of v.actors) {
      if (a !== m) Object.assign(a.action, { remaining: 400, kind: 'leisure', phase: 'working' });
      await db.pool.query('UPDATE dalecrest.actors SET state=$1 WHERE id=$2', [a, a.id]);
    }
    await db.pool.query('UPDATE dalecrest.world SET state=$1, next_tick=now()', [v.world]);
    async function chooseInDb(prefix) {
      const ticket = await db.claimAction(100000);
      const menu = JSON.parse(ticket.body).questions[0].choices;
      const choice = menu.find(c => c.value.startsWith(prefix)).value;
      await db.recordReply(ticket.id, { status: 200, redacted: false, body: JSON.stringify({
        answers: [{ name: 'next_action', type: 'choice', choice, confidence: 0.8 }], usage: { total_tokens: 40 }
      }) });
      assert.equal((await db.applyRecordedDecision(ticket.id)).status, 'applied');
      return ticket;
    }
    async function tickDb() {
      await db.pool.query('UPDATE dalecrest.world SET next_tick=now()');
      await db.advance();
    }
    const inspection = await chooseInDb('inspect:');
    for (let i = 0; i < 3; i++) await tickDb();
    await db.initialize();
    const release = await chooseInDb('release:oswin:');
    assert.equal(JSON.parse(release.body).input[0].content[0].data.helpRequests[0].reasonToReconsider.observedReserve, 3);
    await tickDb();
    await db.pool.query("ALTER TABLE dalecrest.events ADD CONSTRAINT fail_release CHECK (outcome->>'verb' IS DISTINCT FROM 'release') NOT VALID");
    await assert.rejects(tickDb(), { code: '23514' });
    assert.equal((await db.snapshot()).world.helpRequests[id].status, 'asked');
    await db.pool.query('ALTER TABLE dalecrest.events DROP CONSTRAINT fail_release');
    await Promise.all([db.advance(), db.advance()]);
    const after = await db.snapshot();
    assert.equal(after.world.helpRequests[id], undefined);
    assert.equal(who(after, 'oswin').helpBook[id].status, 'released');
    const rows = await db.pool.query("SELECT outcome FROM dalecrest.events WHERE outcome->>'verb'='release'");
    assert.equal(rows.rowCount, 1);
    assert.deepEqual([rows.rows[0].outcome.traceId, rows.rows[0].outcome.evidence.learnedTrace], [release.id, inspection.id]);
  } finally {
    if (db) await db.pool.end();
    if (created) await admin.query('DROP DATABASE ' + name);
    await admin.end();
  }
});

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

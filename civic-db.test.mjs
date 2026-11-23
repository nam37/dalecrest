import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { recordPage } from './record-pages.mjs';
import { recordPath } from './public/record-links.js';

const adminUrl = process.env.DALECREST_TEST_ADMIN_URL;

test('the production queue records one traceable ballot per attendee and starts the agreed field', { skip: !adminUrl }, async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  const name = 'dalecrest_moot_test_' + randomUUID().replaceAll('-', '');
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
    const q = (sql, args) => db.pool.query(sql, args);
    const tick = async () => { await q('UPDATE dalecrest.world SET next_tick=now()'); await db.advance(); };
    const { world, actors, map } = await db.snapshot({ withMap: true });
    const hall = map.places.find(p => p.id === 'hall');
    const voters = new Map([['agnes','support'], ['hugh','support'], ['mabel','support'], ['oswin','oppose'], ['edith','abstain']]);
    world.minute = 1109;
    // A saved proposal and scheduled moot in the format used before individual ballots existed.
    world.proposals = [{ key: 'field', kind: 'field', by: 'agnes', since: 900, supporters: ['agnes','robin','hugh','mabel'], heard: [] }];
    world.moot = { at: 1110, tries: 0 };
    await q('UPDATE dalecrest.world SET state=$1', [world]);
    const address = recordPath('/moots/moot-1110'), params = new URLSearchParams();
    assert.equal((await recordPage(db.pool, address, params)).body.status, 'scheduled');
    const agnesRecord = recordPath('/residents/agnes');
    const firstVisit = (await recordPage(db.pool, agnesRecord, params)).body.cursor;
    for (const actor of actors) {
      if (voters.has(actor.id)) {
        actor.position = { x: hall.at[0], y: hall.at[1] };
        actor.action = { kind: 'meeting', target: 'hall', label: 'Attending the moot', phase: 'working', remaining: 75 };
      } else actor.action = { kind: 'rest', target: actor.home, label: 'Sleeping', phase: 'working', remaining: 200 };
      await q('UPDATE dalecrest.actors SET state=$1 WHERE id=$2', [actor, actor.id]);
    }
    await tick();
    const traces = new Set();
    for (let i = 0; i < voters.size; i++) {
      const ticket = await db.claimAction(480000);
      const request = JSON.parse(ticket.body), question = request.questions[0];
      const context = request.input[0].content[0].data;
      const actor = actors.find(a => a.name === context.name), vote = voters.get(actor.id);
      assert.ok(vote);
      assert.deepEqual(question.choices.map(c => c.value.split(':').at(-1)), ['support','oppose','abstain']);
      assert.equal(context.civicNews.find(p => p.proposalKey === 'field').witness, actor.id);
      assert.ok(context.goals.length);
      const selected = question.choices.find(c => c.value.endsWith(':' + vote)).value;
      await db.recordReply(ticket.id, { status: 200, requestId: 'fixture-' + ticket.id, redacted: false,
        body: JSON.stringify({ answers: [{ type: 'choice', name: question.name, choice: selected }], usage: { total_tokens: 200 } }) });
      assert.equal((await db.applyRecordedDecision(ticket.id)).status, 'applied');
      assert.equal(await db.applyRecordedDecision(ticket.id), undefined);
      traces.add(ticket.id);
    }
    assert.equal(traces.size, voters.size);
    for (let i = 0; i < 40; i++) await tick();
    const after = await db.snapshot();
    const [result] = after.world.mootHistory;
    assert.deepEqual(result.items.map(item => [item.status,item.support,item.oppose,item.abstain,item.missing]), [['agreed',3,1,1,0]]);
    assert.deepEqual(new Set(result.ballots.map(b => b.trace.traceId)), traces);
    assert.equal(after.world.projects[0].kind, 'field');
    const audit = await q(`SELECT e.actor_ids[1] AS who, t.choice FROM dalecrest.events e
      JOIN dalecrest.decision_traces t ON t.id::text=e.outcome->>'traceId' AND t.status='applied'
      WHERE e.outcome->>'civic'='ballot'
        AND EXISTS (SELECT 1 FROM dalecrest.goal_versions g WHERE (g.actor_id || ':' || g.goal_id || ':' || g.version)=ANY(t.goal_keys))
        AND EXISTS (SELECT 1 FROM dalecrest.observations o WHERE o.actor_id=t.actor_id AND o.details ? 'civicNews'
          AND (o.actor_id || ':' || o.seq)=ANY(t.observation_keys))`);
    assert.deepEqual(new Map(audit.rows.map(r => [r.who, r.choice.split(':').at(-1)])), voters);
    const { readout } = await import('./readout.mjs');
    const report = await readout(db.pool);
    const stage = report.stages.find(s => s.stage === '4');
    assert.equal(stage.lines.find(l => l.what.startsWith('Ballots linked')).value, '5 of 5');
    assert.equal(stage.lines.find(l => l.what.startsWith('Completed moots')).value, '1 of 1');
    await q("UPDATE dalecrest.world SET state=jsonb_set(state, '{mootHistory}', '[]') WHERE id=1");
    const archived = await recordPage(db.pool, address, params);
    assert.equal(archived.body.path, '/moots/moot-1110');
    assert.equal(archived.body.items[0].status, 'agreed');
    assert.deepEqual(new Map(archived.body.items[0].votes.map(({ id, choice }) => [id, choice])), voters);
    assert.ok(!JSON.stringify(archived.body).includes('traceId'));
    const day = (await recordPage(db.pool, recordPath('/days/1'), params)).body;
    assert.ok(day.events.some(event => event.mootId === 'moot-1110' &&
      event.people.some(person => person.path === '/residents/agnes')));
    const since = new URLSearchParams({ after: firstVisit });
    const update = (await recordPage(db.pool, agnesRecord, since)).body;
    const { rows: [{ latestId }] } = await q('SELECT max(id)::text AS "latestId" FROM dalecrest.events');
    assert.equal(update.cursor, latestId);
    assert.ok(update.activity.items.some(event => event.text.startsWith('The moot agreed')));
    assert.ok(!update.activity.items.some(event => event.text.includes('cast a ballot')));
    const revisit = await recordPage(db.pool, agnesRecord, new URLSearchParams({ after: update.cursor }));
    assert.deepEqual(revisit.body.activity, { items: [], next: null });
  } finally {
    await db?.pool.end();
    if (created) await admin.query('DROP DATABASE ' + name + ' WITH (FORCE)');
    await admin.end();
  }
});

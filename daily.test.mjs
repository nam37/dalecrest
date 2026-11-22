import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { availableActions, createVillage, stepVillage } from './sim.mjs';
import { dailyArchive, publishNextDaily, queueEditions } from './daily.mjs';

test('Robin takes the reporting job in a saved village and writes only about people at his beat', () => {
  const village = createVillage(), robin = village.actors.find(a => a.id === 'robin');
  const hall = village.map.places.find(p => p.id === 'hall');
  const thomas = village.actors.find(a => a.id === 'thomas');
  const home = robin.home, relationships = structuredClone(robin.relationships);
  Object.assign(robin, { trade: 'harvest', role: 'Field hand', workplace: 'fields' });
  stepVillage(village, { minutes: 0 });
  assert.equal(robin.trade, 'report');
  assert.equal(robin.home, home);
  assert.deepEqual(robin.relationships, relationships);
  const round = availableActions(robin, village).get('report:hall');
  assert.ok(round);
  robin.action = { ...round, phase: 'working', remaining: 3 };
  robin.position = { x: hall.at[0], y: hall.at[1] };
  thomas.action = { kind: 'work', job: 'mend', target: 'hall', label: 'Mending the hall', phase: 'working', remaining: 9 };
  const notes = stepVillage(village, { minutes: 3 }).filter(e => e.type === 'fieldnote');
  assert.equal(notes.length, 1);
  assert.deepEqual(notes[0].actorIds, ['robin', 'thomas']);
  assert.equal(notes[0].place.id, 'hall');
  assert.match(notes[0].text, /mending the hall/);
  assert.equal(robin.memories.find(m => m.kind === 'fieldnote').text, notes[0].text);
  assert.equal(robin.daysWorked, 1);
});

const adminUrl = process.env.DALECREST_TEST_ADMIN_URL;
test('the morning press persists one sourced edition per day and follows yesterday across a restart', { skip: !adminUrl }, async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  const name = 'dalecrest_press_' + randomUUID().replaceAll('-', '');
  let db, created = false;
  await admin.connect();
  try {
    await admin.query('CREATE DATABASE ' + name);
    created = true;
    const url = new URL(adminUrl);
    url.pathname = '/' + name;
    process.env.DATABASE_URL = url.href;
    process.env.PLANNER_PROVIDER = 'openai';
    process.env.VILLAGE_SECONDS_PER_MINUTE = '1';
    db = await import('./db.mjs');
    await db.initialize();
    const { pool } = db;
    const add = async (minute, kind, text) => (await pool.query(`INSERT INTO dalecrest.events(minute,kind,actor_ids,description)
      VALUES ($1,$2,'{}',$3) RETURNING id`, [minute, kind, text])).rows[0].id;
    const note = await add(720, 'fieldnote', 'Robin saw Mabel waiting at the oven.');
    // A public record beyond the browser's hundred-event window is still eligible.
    await pool.query(`INSERT INTO dalecrest.events(minute,kind,actor_ids,description)
      SELECT 1000, 'meal', '{}', 'A loaf was taken.' FROM generate_series(1,105)`);
    await add(1439, 'civic', 'The moot agreed to build a well.');
    const update = await add(1440, 'build', 'Work started on the new well.');
    await queueEditions(pool, null, 1799);
    assert.equal((await dailyArchive(pool, null)).body.pending, null);
    await pool.query("UPDATE dalecrest.world SET state=state || '{\"minute\":1799}'::jsonb,next_tick=now()");
    await db.advance();
    await db.initialize();
    assert.equal((await dailyArchive(pool, null)).body.pending, 1);
    let calls = 0;
    const editor = (valid, follow = false) => async (_url, options) => {
      calls++;
      const input = JSON.parse(JSON.parse(options.body).messages[0].content);
      let lead, sinceYesterday = [];
      if (follow) {
        assert.equal(input.previousEdition.headline, 'Mabel at the oven');
        assert.ok(input.villageRecords.some(r => r.id === update));
        lead = [{ text: 'Work began on the well.', sources: [update] }];
        const priorWell = input.previousEdition.briefs[0].sources[0];
        sinceYesterday = [{ text: 'Work started on the well the moot agreed to build.', sources: [priorWell, update] }];
      } else {
        assert.equal(input.previousEdition, null);
        assert.equal(input.robinsNotebook[0].id, note);
        assert.ok(input.villageRecords.length > 100);
        assert.ok(!input.villageRecords.some(r => r.id === update));
        lead = [{ text: 'Mabel waited at the oven.', sources: [valid ? note : 'unknown'] }];
      }
      const meeting = input.villageRecords.find(r => r.kind === 'civic');
      const copy = { headline: follow ? 'Work on the well' : 'Mabel at the oven', lead, sinceYesterday,
        briefs: meeting ? [{ text: meeting.text, sources: [meeting.id] }] : [] };
      return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(copy) }] });
    };
    await assert.rejects(publishNextDaily(pool, { key: 'fixture', request: editor(false) }), /unsourced/);
    assert.equal((await dailyArchive(pool, null)).body.issue, null);
    await publishNextDaily(pool, { key: 'fixture', request: editor(true) });
    assert.equal(calls, 1, 'retry cooldown');
    await pool.query('UPDATE dalecrest.daily_editions SET retry_at=now()');
    await Promise.all([1, 2].map(() => publishNextDaily(pool, { key: 'fixture', request: editor(true) })));
    assert.equal(calls, 2, 'one editor claimed the edition');
    await queueEditions(pool, 1802, 3240);
    await publishNextDaily(pool, { key: 'fixture', request: editor(true, true) });
    const latest = (await dailyArchive(pool, null)).body.issue;
    assert.equal(latest.older, 1);
    assert.equal(latest.day, 2);
    assert.equal(latest.edition.sinceYesterday[0].sources.length, 2);
    assert.equal((await dailyArchive(pool, '1')).body.issue.newer, 2);
    assert.equal((await dailyArchive(pool, '3')).status, 404);
    assert.equal((await dailyArchive(pool, 'oops')).status, 400);
  } finally {
    if (db) await db.pool.end();
    if (created) await admin.query('DROP DATABASE ' + name);
    await admin.end();
  }
});

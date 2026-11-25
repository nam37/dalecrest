import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { availableActions, createVillage, stepVillage } from './sim.mjs';
import { composeEdition, dailyArchive, publishNextDaily, queueEditions, searchDaily } from './daily.mjs';
import { chooseDailyIllustration } from './engine/daily-illustrations.mjs';
import { readAdminMetrics } from './admin-metrics.mjs';

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

test('the editor is given the day as a neighbour would tell it, without the archive’s housekeeping', async () => {
  const survey = { id: '9', minute: 1081, kind: 'village', text: 'The parish was surveyed, and every lane, field and cottage of Dalecrest set down on a new map.' };
  const loaves = { id: '12', minute: 1440 + 546, kind: 'work', text: 'Mabel Ash drew five loaves.', workSite: 'oven', placeId: 'storehouse' };
  const note = { id: '13', minute: 1440 + 1283, kind: 'fieldnote', text: 'At the mill, Robin saw Hugh Fen grinding barley.' };
  const flour = { id: '7', minute: 730, kind: 'work', text: 'Hugh Fen ground two measures of barley into three of flour.' };
  const prior = { headline: 'Parish Surveyed', lead: [{ text: 'The parish was surveyed.', sources: ['9'] }],
    briefs: [{ text: 'Hugh ground barley.', sources: ['7'] }], sinceYesterday: [], sources: [survey, flour],
    illustration: { subject: 'mill', sourceId: '7' } };
  let input;
  const request = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.match(body.system, /Robin Marsh/);
    assert.equal(body.max_tokens, 16384);
    input = JSON.parse(body.messages[0].content);
    const copy = { headline: 'Five Loaves', lead: [{ text: 'Mabel baked.', sources: ['7', '12'] }],
      briefs: [{ text: 'I saw Hugh at the stones.', sources: ['13'] }],
      sinceYesterday: [{ text: 'Hugh is at the mill again.', sources: ['7', '13'] }] };
    return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(copy) }] });
  };
  const edition = await composeEdition({ day: 2, records: [{ ...survey, id: '10', minute: 1500 }, loaves, note], prior }, { key: 'fixture', request });
  assert.deepEqual(input.villageRecords, [{ id: '12', kind: 'work', text: loaves.text, when: '2 August, in the middle of the morning' }]);
  assert.equal(input.robinsNotebook[0].when, '2 August, late at night');
  assert.equal(input.previousEdition.headline, undefined);
  assert.equal(input.previousEdition.illustration, undefined);
  assert.deepEqual(input.previousEdition.lead, []);
  assert.deepEqual(input.previousEdition.sources, [{ id: '7', kind: 'work', text: flour.text, when: '1 August, around midday' }]);
  assert.deepEqual(edition.sources.map(s => s.id), ['7', '12', '13']);
  assert.deepEqual(edition.illustration, { subject: 'oven', sourceId: '12' });
  assert.equal(edition.sources[1].workSite, undefined);
  // A follow-up to the housekeeping record has nothing left to cite.
  const stale = async () => Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ headline: 'Five Loaves',
    lead: [{ text: 'Mabel baked.', sources: ['12'] }], briefs: [{ text: 'I saw Hugh.', sources: ['13'] }],
    sinceYesterday: [{ text: 'No word on the survey.', sources: ['9'] }] }) }] });
  await assert.rejects(composeEdition({ day: 2, records: [loaves, note], prior }, { key: 'fixture', request: stale }), /unsourced/);
});

test('lead art favours corroborating citations and links to the strongest record', () => {
  const records = [
    { id: '1', kind: 'social', text: 'Mabel asked about the barley strips.' },
    { id: '2', kind: 'work', text: 'Agnes brought in three measures.', placeId: 'field-18' },
    { id: '3', kind: 'work', text: 'Hugh ground barley into flour.' },
    { id: '4', kind: 'civic', text: 'The moot assembled at the village hall.' },
    { id: '5', kind: 'intention', text: 'Agnes hopes to mend the oven.' },
  ];
  const lead = [{ sources: ['1', '3'] }, { sources: ['3', '2'] }];
  assert.deepEqual(chooseDailyIllustration(lead, records), { subject: 'fields', sourceId: '2' });
  assert.deepEqual(chooseDailyIllustration(lead, [...records].reverse()), { subject: 'fields', sourceId: '2' });
  assert.equal(chooseDailyIllustration([{ sources: ['5'] }], records), null);
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
      return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(copy) }],
        usage: { input_tokens: 100, output_tokens: 25, cache_read_input_tokens: 50 } });
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
    await queueEditions(pool, 3240, 4680);
    const { issue: latest, pending } = (await dailyArchive(pool, null)).body;
    assert.equal(latest.older, 1);
    assert.equal(latest.day, 2);
    assert.deepEqual(latest.publishedDays, [2, 1]);
    assert.equal(pending, 3);
    assert.equal(latest.edition.sinceYesterday[0].sources.length, 2);
    assert.equal(latest.edition.illustration, null);
    const { rows: [stored] } = await pool.query('SELECT edition FROM dalecrest.daily_editions WHERE day=1');
    assert.deepEqual(stored.edition.illustration, { subject: 'oven', sourceId: note });
    await pool.query("UPDATE dalecrest.daily_editions SET edition=edition-'illustration' WHERE day=1");
    const first = (await dailyArchive(pool, '1')).body.issue;
    assert.equal(first.newer, 2);
    assert.deepEqual(first.publishedDays, [2, 1]);
    assert.deepEqual(first.edition.illustration, stored.edition.illustration);
    assert.equal((await dailyArchive(pool, '3')).status, 404);
    assert.equal((await dailyArchive(pool, 'oops')).status, 400);
    assert.deepEqual((await pool.query('SELECT day, attempt, token_charge FROM dalecrest.daily_model_usage ORDER BY day,attempt')).rows,
      [{ day: 1, attempt: 1, token_charge: 175 }, { day: 1, attempt: 2, token_charge: 175 }, { day: 2, attempt: 1, token_charge: 175 }]);
    const { rows: [bucket] } = await pool.query(`SELECT ((now() AT TIME ZONE 'America/New_York')::date - 1)::text AS date,
      ((now() AT TIME ZONE 'America/New_York')::date - 1 + time '12:00') AT TIME ZONE 'America/New_York' AS start`);
    await pool.query(`INSERT INTO dalecrest.activity_log(actor_id, minute, basis, recorded_at)
      VALUES ('chart-fixture',1700,'waiting',$1::timestamptz),
             ('chart-fixture',1701,'fresh',$1::timestamptz + interval '20 seconds'),
             ('chart-fixture',1702,'standing',$1::timestamptz + interval '30 seconds')`, [bucket.start]);
    await pool.query(`INSERT INTO dalecrest.decision_traces(actor_id,model,endpoint,request_body,observed_minute,requested_at,token_charge)
      VALUES ('chart-fixture','model','https://example.test','{}',1701,$1,70)`, [bucket.start]);
    const metrics = await readAdminMetrics(pool);
    assert.equal(metrics.tokens.length, 14);
    assert.equal(metrics.tokens.find(row => row.date === bucket.date).openai, 70);
    assert.equal(metrics.tokens.reduce((sum, row) => sum + row.anthropic, 0), 525);
    assert.equal(metrics.waits.find(row => row.date === bucket.date).p95, 20);
    assert.deepEqual(metrics.activities.actors.find(actor => actor.id === 'chart-fixture').starts.at(-1), { fresh: 1, standing: 1 });

    const olderSearchIssue = { headline: 'Village news', lead: [{ text: 'Talk turned to the alehouse.' }] };
    const newerSearchIssue = {
      headline: 'News from the Alehouse',
      lead: Array.from({ length: 17 }, () => ({ text: 'At the alehouse, the matter was settled.' })),
      briefs: [{ text: 'The tally includes %_ by the ALEHOUSE.' }],
      sinceYesterday: [{ text: 'There was more news of the alehouse.' }],
      sources: [{ id: '321', text: 'Robin made a note of the alehouse.' }],
    };
    await pool.query(`INSERT INTO dalecrest.daily_editions(day, edition, published_at)
      VALUES (4, $1, now()), (5, $2, now())`, [olderSearchIssue, newerSearchIssue]);
    await add(3500, 'fieldnote', 'An alehouse was mentioned in an unpublished record.');
    const pageOne = (await searchDaily(pool, '  aleHOUSE  ')).body;
    assert.equal(pageOne.query, 'aleHOUSE');
    assert.equal(pageOne.matches.length, 20);
    assert.equal(pageOne.hasMore, true);
    assert.equal(pageOne.matches[0].match, 'Alehouse');
    assert.deepEqual([pageOne.matches[0].anchor, pageOne.matches[1].anchor, ...pageOne.matches.slice(-2).map(hit => hit.anchor)],
      ['headline', 'lead-1', 'briefs-1', 'since-yesterday-1']);
    const pageTwo = (await searchDaily(pool, 'alehouse', '2')).body;
    assert.equal(pageTwo.hasMore, false);
    assert.deepEqual(pageTwo.matches.map(hit => [hit.day, hit.anchor]), [[5, 'record-321'], [4, 'lead-1']]);
    const literal = (await searchDaily(pool, '%_')).body.matches;
    assert.deepEqual(literal.map(hit => [hit.anchor, hit.match]), [['briefs-1', '%_']]);
    assert.equal((await searchDaily(pool, '   ')).status, 400);
    assert.equal((await searchDaily(pool, 'alehouse', '0')).status, 400);
  } finally {
    if (db) await db.pool.end();
    if (created) await admin.query('DROP DATABASE ' + name);
    await admin.end();
  }
});

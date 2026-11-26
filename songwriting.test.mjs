import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { availableActions, createVillage, startChosen, stepVillage } from './sim.mjs';
import { memoryKey, remember } from './engine/memory.mjs';
import { place } from './engine/roads.mjs';
import { readSongDraft } from './song-drafts.mjs';
import { recordPage } from './record-pages.mjs';
import { journalEntries } from './robin-journal.mjs';

const compose = 'compose:write:green';
const villageMinute = 1080;
const note = 'At the mill, Robin saw Hugh feeding barley to the millstones.';
const lines = ['I heard the turning wheel', 'And saw the barley fall', 'The dust lay on the sill', 'As dusk came over all'];
const title = 'The Turning Wheel';

function prepareEvening(robin, map, minute = villageMinute) {
  const [x, y] = place(map, 'green').at;
  robin.position = { x, y };
  robin.rounds = { mill: minute - 55 };
  robin.action = { kind: 'waiting', phase: 'waiting', since: minute - 1, remaining: 0, target: 'green',
    reason: 'Will decide after gathering news.', previous: { kind: 'report', label: 'Gathering news', target: 'mill' } };
}

function addFieldNote(robin) {
  remember(robin, villageMinute - 55, note, ['robin', 'hugh'], 'fieldnote', { site: 'mill' });
  return memoryKey(robin, robin.memories.at(-1));
}

const response = verse => JSON.stringify({ stop_reason: 'end_turn', usage: { input_tokens: 500, output_tokens: 100 },
  content: [{ type: 'text', text: JSON.stringify(verse) }] });

test('the pilot preserves Robin’s goals and records a completed session once across a save', () => {
  let village = createVillage();
  let robin = village.actors.find(actor => actor.id === 'robin');
  const prior = structuredClone(robin.goals);
  assert.equal(robin.songwriting, undefined);
  village.world.songwritingPilot = true;
  village.world.minute = villageMinute;
  stepVillage(village, { minutes: 0 });
  stepVillage(village, { minutes: 0 });
  assert.deepEqual(robin.goals.slice(0, 2), prior);
  assert.equal(robin.goalBook.filter(goal => goal.id === 'songwriting').length, 1);
  assert.match(robin.backstory, /makes up songs/);
  assert.equal(village.actors.filter(actor => actor.songwriting).length, 1);
  prepareEvening(robin, village.map);
  const key = addFieldNote(robin);
  const selected = startChosen(robin, village, compose, { id: '47' });
  assert.equal(selected.routine, null);
  const drafts = [];
  const events = stepVillage(village, { minutes: 20, externalActions: true, songDrafts: drafts });
  village = JSON.parse(JSON.stringify(village));
  events.push(...stepVillage(village, { minutes: 25, externalActions: true, songDrafts: drafts }));
  const sessions = events.filter(event => event.type === 'song');
  assert.equal(sessions.length, 1);
  const { song } = sessions[0].outcome;
  assert.equal(song.ended - song.started + 1, 40);
  assert.equal(song.decisionTraceId, '47');
  assert.equal(song.site, 'green');
  assert.equal(drafts.length, 1);
  assert.ok(drafts[0].sources.some(source => source.key === key));
  robin = village.actors.find(actor => actor.id === 'robin');
  assert.equal(availableActions(robin, village).has(compose), false);
});

test('sessions with no unused material finish without asking for a verse', () => {
  const village = createVillage(undefined, { songwriting: true });
  village.world.minute = villageMinute;
  const robin = village.actors.find(actor => actor.id === 'robin');
  prepareEvening(robin, village.map);
  robin.songwriting.used.push(addFieldNote(robin));
  assert.ok(startChosen(robin, village, compose, { id: 1 }));
  const drafts = [];
  const events = stepVillage(village, { minutes: 40, externalActions: true, songDrafts: drafts });
  assert.equal(events.find(event => event.type === 'song').outcome.song.status, 'no_material');
  assert.deepEqual(drafts, []);
});

test('a published verse uses only offered memories and screens names and extra formatting', () => {
  const source = { key: 'robin:21', minute: 1060, kind: 'fieldnote', text: note };
  const session = { title: null, sources: [source] };
  const verse = { title, lines, sources: [source.key] };
  const read = changes => readSongDraft({ status: 200, body: response({ ...verse, ...changes }) }, session, ['Hugh Fen']);
  assert.deepEqual(read().sources, [{ key: source.key, minute: source.minute, kind: source.kind }]);
  assert.equal(read({ sources: ['hugh:21'] }).status, 'invalid');
  assert.equal(read({ sources: [] }).status, 'invalid');
  assert.equal(read({ lines: ['I saw Hugh at the mill', ...lines.slice(1)] }).status, 'invalid');
  assert.equal(read({ lines: ['<em>A turning wheel</em>', ...lines.slice(1)] }).status, 'invalid');
});

test('a completed manuscript survives the start of Robin’s next song', () => {
  const village = createVillage(undefined, { songwriting: true });
  const robin = village.actors.find(actor => actor.id === 'robin');
  const song = robin.songwriting;
  village.world.minute = villageMinute;
  prepareEvening(robin, village.map);
  const key = addFieldNote(robin);
  song.title = title;
  song.verses.push({ minute: villageMinute - 20, lines, sources: [{ key, minute: villageMinute - 55, kind: 'fieldnote' }] });
  song.used.push(key);
  assert.ok(startChosen(robin, village, 'compose:finish:green', { id: 1 }));
  const finished = stepVillage(village, { minutes: 12, externalActions: true }).find(event => event.type === 'song').outcome.song;
  assert.equal(finished.status, 'finished');
  assert.deepEqual(finished.manuscript.verses[0].lines, lines);

  village.world.minute = villageMinute + 1440;
  prepareEvening(robin, village.map, village.world.minute);
  assert.ok(startChosen(robin, village, 'compose:begin:green', { id: 2 }));
  const drafts = [];
  const events = stepVillage(village, { minutes: 40, externalActions: true, songDrafts: drafts });
  assert.ok(events.some(event => event.outcome?.song?.status === 'started'));
  assert.ok(!events.some(event => event.outcome?.song?.status === 'archive'));
  assert.equal(song.status, 'writing');
  assert.deepEqual(song.verses, []);
  assert.equal(drafts[0].version, song.version);
  assert.equal(drafts[0].title, null);
  assert.equal(finished.manuscript.title, title);
  assert.equal(finished.manuscript.closedAt, villageMinute + 12);
});

test('dated entries describe recorded acts and preserve exact authored words', () => {
  const words = 'I intend to bring my notes back to the hall.';
  const evidence = [
    { id: '1', minute: 1000, kind: 'note', text: note },
    { id: '2', minute: 1005, kind: 'note', text: note },
    { id: '3', minute: 2450, kind: 'choice', detail: 'meeting', text: 'Attending the moot' },
    { id: '4', minute: 2460, kind: 'song', detail: 'interrupted', text: 'Robin Marsh put down his writing to attend the moot.' },
    { id: '5', minute: 2500, kind: 'words', text: words, public: true },
    { id: '6', minute: 4000, kind: 'song', detail: 'archive', text: 'Archive' },
  ];
  const [second, first] = journalEntries(evidence);
  assert.deepEqual(second.lines.map(line => line.text), ['I set out for the moot.', 'I put down my writing to attend the moot.', words]);
  assert.equal(second.lines[2].source.href, '/days/2#event-5');
  assert.equal(first.lines.length, 1);
  assert.match(first.lines[0].text, /I saw Hugh/);
  assert.equal(journalEntries(evidence).length, 2);
});

const adminUrl = process.env.DALECREST_TEST_ADMIN_URL;

test('PostgreSQL applies Robin’s choice and publishes a sourced verse while the clock keeps moving', { skip: !adminUrl }, async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  const name = 'dalecrest_song_' + randomUUID().replaceAll('-', '');
  let db, created = false;
  await admin.connect();
  try {
    await admin.query('CREATE DATABASE ' + name);
    created = true;
    const url = new URL(adminUrl);
    url.pathname = '/' + name;
    process.env.DATABASE_URL = url.href;
    process.env.PLANNER_PROVIDER = 'openai';
    process.env.VILLAGE_SONGWRITING = '1';
    db = await import('./db.mjs');
    await db.initialize();
    const { pool } = db;
    const tickNow = async () => { await pool.query('UPDATE dalecrest.world SET next_tick=now()'); await db.advance(); };
    const { rows: [{ state: world }] } = await pool.query('SELECT state FROM dalecrest.world WHERE id=1');
    const { rows: [{ state: robin }] } = await pool.query("SELECT state FROM dalecrest.actors WHERE id='robin'");
    prepareEvening(robin, await db.currentMap());
    const key = addFieldNote(robin);
    world.minute = villageMinute;
    await pool.query('UPDATE dalecrest.world SET state=$1 WHERE id=1', [world]);
    await pool.query("UPDATE dalecrest.actors SET state=$1 WHERE id='robin'", [robin]);
    const choice = await db.claimAction(1e9);
    assert.ok(JSON.parse(choice.body).questions[0].choices.some(option => option.value === compose));
    await db.recordReply(choice.id, { status: 200, redacted: false, body: JSON.stringify({ answers: [
      { type: 'choice', name: 'next_action', choice: compose }
    ] }) });
    assert.equal((await db.applyRecordedDecision(choice.id)).status, 'applied');
    for (let i = 0; i < 40; i++) await tickNow();
    const { rows } = await pool.query('SELECT status FROM dalecrest.song_drafts');
    assert.deepEqual(rows, [{ status: 'queued' }]);

    const entered = Promise.withResolvers(), release = Promise.withResolvers();
    const drafting = db.draftSongOnce({ key: 'test-key', request: async (_url, options) => {
      entered.resolve(JSON.parse(JSON.parse(options.body).messages[0].content));
      await release.promise;
      return new Response(response({ title, lines, sources: [key] }));
    } });
    try {
      const draft = await Promise.race([entered.promise, drafting.then(() => assert.fail('No draft was requested'))]);
      assert.ok(draft.memories.some(memory => memory.key === key));
      await tickNow();
      assert.equal((await db.snapshot()).world.minute, villageMinute + 41);
    } finally { release.resolve(); }
    assert.equal(await drafting, 'applied');
    await db.initialize();
    assert.equal(await db.draftSongOnce({ key: 'test-key', request: () => assert.fail('Duplicate draft') }), undefined);
    const { body: { journal } } = await recordPage(pool, { kind: 'residents', id: 'robin' }, new URLSearchParams());
    assert.equal(journal.title, title);
    assert.equal(journal.composingDays, 1);
    assert.equal(journal.verses.length, 1);
    assert.deepEqual(journal.verses[0].lines, lines);
    assert.equal(journal.verses[0].sources[0].key, key);
    assert.equal(journal.entries.length, 2);

    await pool.query(`INSERT INTO dalecrest.events(minute,kind,actor_ids,description,salience)
      VALUES (300,'fieldnote',ARRAY['robin','hugh'],$1,1)`, [note]);
    const manuscript = { title: 'An Earlier Song', status: 'finished', started: 450, closedAt: 1500, verses: journal.verses };
    await pool.query(`INSERT INTO dalecrest.events(minute,kind,actor_ids,description,outcome,salience)
      VALUES (1500,'song',ARRAY['robin'],'Robin Marsh finished his song.',$1,1)`, [{ song: { lifetime: 0, status: 'finished', manuscript } }]);
    await pool.query("UPDATE dalecrest.world SET state=jsonb_set(state,'{minute}','13000') WHERE id=1");
    const current = (await recordPage(pool, { kind: 'residents', id: 'robin' }, new URLSearchParams())).body.journal;
    assert.equal(current.catalog[0].title, manuscript.title);
    assert.ok(current.olderBefore);
    const backfill = (await recordPage(pool, { kind: 'residents', id: 'robin' }, new URLSearchParams({ journalBefore: current.olderBefore }))).body.journal;
    assert.equal(backfill.olderBefore, null);
    assert.ok(backfill.days.find(day => day.minute === 0)?.lines.some(line => /I saw Hugh/.test(line.text)));
  } finally {
    await db?.pool.end();
    if (created) await admin.query('DROP DATABASE ' + name);
    await admin.end();
  }
});

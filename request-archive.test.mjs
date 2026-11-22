import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { requestArchive, requestIndexes } from './request-archive.mjs';

const adminUrl = process.env.DALECREST_TEST_ADMIN_URL;
test('request links, participant history and verified endings survive the latest 100 events', { skip: !adminUrl }, async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  const name = 'dalecrest_archive_' + randomUUID().replaceAll('-', '');
  let db, created;
  await admin.connect();
  try {
    await admin.query('CREATE DATABASE ' + name);
    created = true;
    const url = new URL(adminUrl);
    url.pathname = '/' + name;
    db = new pg.Client({ connectionString: url.href });
    await db.connect();
    await db.query(`CREATE SCHEMA dalecrest;
      CREATE TABLE dalecrest.events (id bigserial PRIMARY KEY, minute bigint, kind text, actor_ids text[], description text, outcome jsonb);
      ALTER SEQUENCE dalecrest.events_id_seq RESTART WITH 9007199254740993;
      ${requestIndexes}`);
    const id = 'fixture-wood';
    const terms = { askerId: 'mabel', asker: 'Mabel', helperId: 'oswin', helper: 'Oswin', terms: 'stack wood', due: 1440, status: 'asked' };
    const add = (description, outcome, actors = ['mabel', 'oswin']) => db.query(
      'INSERT INTO dalecrest.events(minute,kind,actor_ids,description,outcome) VALUES (50,\'social\',$1,$2,$3)', [actors, description, outcome]);
    const ask = key => add('asked', { verb: 'ask', delivered: true, requestId: key, terms });
    const read = path => requestArchive(db, new URL('https://localhost/api/requests' + path));
    await ask(id);
    for (let i = 0; i < 26; i++) await add('review', { verb: 'retain', requestId: id }, ['mabel']);
    await add('named shift', { commitmentId: id }, ['oswin']);
    await add('kept', { requestId: id, terms: { ...terms, status: 'kept' } }, ['oswin']);
    await add('missed visit', { requestId: id, verb: 'release', delivered: false }, ['mabel']);
    await add('late report', { verb: 'share', fact: { kept: true, requestId: id } }, ['edith', 'mabel']);
    await add('ordinary shift', { stockDelta: { wood: 3 } }, ['oswin']);
    for (let i = 0; i < 26; i++) await ask('other-' + i);
    await db.query("INSERT INTO dalecrest.events(minute,kind,actor_ids,description) SELECT i,'meal','{}','ate' FROM generate_series(1,110) i");
    const first = (await read('/' + id)).body;
    assert.equal(first.request.status, 'kept');
    assert.equal(first.request.lastEvent.description, 'late report');
    assert.deepEqual(first.items.slice(0, 4).map(e => e.description), ['late report', 'missed visit', 'kept', 'named shift']);
    const earlier = (await read('/' + id + '?before=' + first.next)).body;
    const together = [...first.items, ...earlier.items];
    assert.equal(earlier.next, null);
    assert.equal(new Set(together.map(e => e.id)).size, 31);
    assert.equal(together.at(-1).id, '9007199254740993');
    assert.ok(together.every(e => e.description !== 'ordinary shift'));
    for (const participant of ['mabel', 'oswin']) {
      const list = (await read('?resident=' + participant)).body;
      assert.equal(list.items.length, 25);
      // A later insertion cannot shift the older page underneath a returning viewer.
      await ask('arrived-' + participant);
      const older = (await read('?resident=' + participant + '&before=' + list.next)).body;
      assert.equal(older.items.at(-1).id, id);
      assert.ok(older.items.every(r => !list.items.some(prev => prev.id === r.id)));
    }
    assert.deepEqual((await read('?resident=edith')).body.items, []);
    assert.equal((await read('/missing')).status, 404);
    for (const invalid of ['0', '1x', '9223372036854775808']) assert.equal((await read('?before=' + invalid)).status, 400);
  } finally {
    if (db) await db.end();
    if (created) await admin.query('DROP DATABASE ' + name);
    await admin.end();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { writeCivicAccount } from './civic-accounts.mjs';

const lines = { first: 'I favour the cottage.', second: 'I would leave the cottage for another day.' };
const reply = words => Response.json({ stop_reason: 'end_turn', usage: { input_tokens: 120, output_tokens: 18 },
  content: [{ type: 'text', text: JSON.stringify(words) }] });
test('accounts screen both speakers before publishing any dialogue', async () => {
  const claim = { id: '1', attempt: 1, speakers: [{ name: 'Alice' }, { name: 'Hugh' }], body: '{}' };
  const writes = [];
  const db = { query: async (_sql, params) => writes.push(params) };
  for (const second of [null, '<script>Markup</script>', 'A first claim. A second claim.']) {
    await assert.rejects(writeCivicAccount(db, claim, 'fixture', async () => reply({ ...lines, second })), /Invalid civic account/);
  }
  assert.equal(writes.length, 0);
  await writeCivicAccount(db, claim, 'fixture', async () => reply(lines));
  assert.deepEqual(writes[0], ['1', 1, 'Alice said, “I favour the cottage.” Hugh said, “I would leave the cottage for another day.”', 138]);
});

const adminUrl = process.env.DALECREST_TEST_ADMIN_URL;
test('a recorded moot can receive one account across concurrent editors and restarts', { skip: !adminUrl }, async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  const name = 'dalecrest_accounts_' + randomUUID().replaceAll('-', '');
  await admin.connect();
  let db, created = false;
  try {
    await admin.query('CREATE DATABASE ' + name);
    created = true;
    const url = new URL(adminUrl);
    url.pathname = '/' + name;
    process.env.DATABASE_URL = url.href;
    db = await import('./db.mjs');
    await db.initialize();
    const ballots = [{ actorId: 'alice', choice: 'support' }, { actorId: 'hugh', choice: 'oppose' }];
    const outcome = { civic: 'resolution', mootId: 'moot-1', proposalKey: 'cottage:alice', status: 'postponed', ballots,
      positions: [{ actorId: 'mabel', position: 'support' }] };
    const { rows: [event] } = await db.pool.query(`INSERT INTO dalecrest.events(minute,kind,description,actor_ids,outcome,salience)
      VALUES (1200,'civic','The moot put off a cottage.',ARRAY['alice','hugh'],$1,7) RETURNING id`, [outcome]);
    const before = await db.snapshot();
    let calls = 0;
    const request = async (_url, options) => {
      calls++;
      const input = JSON.parse(JSON.parse(options.body).messages[0].content);
      assert.deepEqual(input.speakers, ballots.map(({ actorId, choice }) =>
        ({ name: before.actors.find(a => a.id === actorId)?.name || actorId, vote: choice })));
      return reply(lines);
    };
    const options = { request, key: 'fixture', budget: 6000 };
    await db.publishCivicAccountOnce({ ...options, key: '' });
    await db.publishCivicAccountOnce({ ...options, budget: 20 });
    assert.equal(calls, 0);
    const fail = { ...options, request: async () => Response.json({}, { status: 503 }) };
    await assert.rejects(db.publishCivicAccountOnce(fail), /503/);
    await db.initialize();
    await db.publishCivicAccountOnce(options);
    assert.equal(calls, 0);
    await db.pool.query("UPDATE dalecrest.civic_accounts SET requested_at=now()-interval '11 minutes' WHERE event_id=$1", [event.id]);
    await Promise.all([db.publishCivicAccountOnce(options), db.publishCivicAccountOnce(options)]);
    await db.publishCivicAccountOnce(options);
    assert.equal(calls, 1);
    const after = await db.snapshot();
    assert.deepEqual(before.world, after.world);
    assert.deepEqual(before.actors, after.actors);
    const source = after.events.find(e => String(e.id) === event.id);
    assert.equal(source.text, 'The moot put off a cottage.');
    assert.match(source.account, /Hugh.* said/);
    assert.equal((await db.recentEvents('civic')).find(e => e.id === event.id).account, source.account);
  } finally {
    if (db) await db.pool.end();
    if (created) await admin.query('DROP DATABASE ' + name);
    await admin.end();
  }
});

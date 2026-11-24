import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { loavesIn, shape, tickSeconds, readoutText } from './readout.mjs';

test('the readout counts loaves that left the shelves and not loaves that came out of the oven', () => {
  assert.equal(loavesIn('Agnes Reed drew 3 loaves at the storehouse for the household and ate one.'), 3);
  assert.equal(loavesIn('Agnes Reed drew the household’s loaf at the storehouse and ate it.'), 1);
  assert.equal(loavesIn('Hugh Dale drew a loaf at the storehouse and ate it.'), 1);
  assert.equal(loavesIn('Alice Ford drew 2 loaves at the storehouse for the larder at home.'), 2);
  assert.equal(loavesIn('Oswin Holt took a loaf from the common oven.'), 1);
  assert.equal(loavesIn('Mabel Ash drew five loaves from the oven.'), 0);
  assert.equal(loavesIn('Agnes Reed ate bread from the larder at home.'), 0);
});

test('the readout counts chronicle sentences by their shape and reads the clock pace as the server does', () => {
  assert.equal(shape('Mabel Ash took a loaf from the common oven.'), shape('Hugh Dale took a loaf from the common oven.'));
  assert.equal(tickSeconds({ PLANNER_PROVIDER: 'openai' }), 30);
  assert.equal(tickSeconds({}), 3);
  assert.equal(tickSeconds({ VILLAGE_SECONDS_PER_MINUTE: '10' }), 10);
});

// Runs only when DALECREST_TEST_ADMIN_URL names a development server that may create databases.
const adminUrl = process.env.DALECREST_TEST_ADMIN_URL;

test('PostgreSQL gives each stage’s measures from the village’s own records', { skip: !adminUrl }, async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  const name = 'dalecrest_readout_test_' + randomUUID().replaceAll('-', '');
  let db, created = false;
  await admin.connect();
  try {
    await admin.query('CREATE DATABASE ' + name);
    created = true;
    const url = new URL(adminUrl);
    url.pathname = '/' + name;
    process.env.DATABASE_URL = url.href;
    delete process.env.PLANNER_PROVIDER;
    db = await import('./db.mjs');
    await db.initialize();
    const { readout } = await import('./readout.mjs');
    const q = (sql, args) => db.pool.query(sql, args);
    const m = Number((await q("SELECT state->>'minute' AS m FROM dalecrest.world")).rows[0].m);
    const [a, b] = (await q('SELECT id FROM dalecrest.actors ORDER BY ordinal LIMIT 2')).rows.map(r => r.id);
    const residents = Number((await q('SELECT count(*) FROM dalecrest.actors')).rows[0].count);

    // One applied choice of a meal at hunger 12, and one reply that came too late to use.
    const trace = async (status, tokens, state) => (await q(`INSERT INTO dalecrest.decision_traces(actor_id, model, endpoint, request_body,
      observed_minute, status, token_charge, decision_since, applied_minute, state_at_application)
      VALUES ($1, 'fixture', 'fixture', '{}', $2, $3, $4, $2, $5, $6) RETURNING id`,
    [a, m, status, tokens, status === 'applied' ? m : null, state])).rows[0].id;
    const meal = await trace('applied', 700, { action: { kind: 'food' }, needs: { hunger: 12 } });
    await trace('superseded', 300, null);
    // A wait, the fresh choice that ended it, a standing repeat, the instruction ending, and a repeat after it ended.
    const act = (who, minute, basis, routine, traceId) => q(`INSERT INTO dalecrest.activity_log(actor_id, minute, basis, routine, trace_id)
      VALUES ($1, $2, $3, $4, $5)`, [who, minute, basis, routine, traceId]);
    await act(a, m, 'waiting', null, null);
    await act(a, m + 1, 'fresh', null, meal);
    await act(a, m + 5, 'standing', 'meal', meal);
    await act(a, m + 10, 'instruction_ended', 'meal', meal);
    await act(a, m + 20, 'standing', 'meal', meal);
    await act(b, m + 30, 'fresh', null, null);

    const event = (minute, kind, ids, text, outcome) => q(`INSERT INTO dalecrest.events(minute, kind, actor_ids, description, outcome, salience)
      VALUES ($1, $2, $3, $4, $5, 5)`, [minute, kind, ids, text, outcome]);
    await event(m + 40, 'observation', [a], 'A counted 4 measures of flour and 0 bundles of firewood.', { flour: 4, wood: 0 });
    await event(m + 60, 'village', [b], 'The firewood ran out at a cottage, and B woke to a cold house.', { hearths: 8, lit: 6, firewoodTaken: 2 });
    await event(m + 70, 'social', [a, b], 'A asked B for firewood.', { verb: 'ask', requestId: 'r1' });
    await event(m + 80, 'social', [a, b], 'B kept the promise.', { verb: 'kept', requestId: 'r1' });
    await event(m + 90, 'meal', [a], 'Agnes Reed drew 3 loaves at the storehouse for the household and ate one.', null);
    await event(m + 95, 'work', [b], 'Mabel Ash drew five loaves from the oven.', null);
    // A village day has passed since the window opened, and the allowance was open throughout.
    await q(`UPDATE dalecrest.world SET state = jsonb_set(jsonb_set(state, '{minute}', to_jsonb($1::bigint)), '{allowanceSince}', '0')`, [m + 1440]);

    const report = await readout(db.pool, { hours: 24, tick: 3 });
    const find = what => report.stages.flatMap(s => s.lines).find(l => l.what.startsWith(what));
    assert.equal(report.window.fromMinute, m);
    assert.equal(report.window.villageDays, 1);
    assert.equal(find('Activities started on a stale instruction').verdict, 'not met');
    assert.equal(find('Activities started on a stale instruction').value, '1');
    assert.equal(find('Activities started with no recorded exchange').value, '1');
    assert.equal(find('Share of activities that needed a fresh choice').value, '50%');
    assert.equal(find('Real wait for a fresh choice').verdict, 'met');
    assert.equal(find('Requests for help asked').value, '1');
    assert.match(find('How requests ended').value, /^1 kept, 0 broken/);
    assert.equal(find('Oven counts that found flour and no firewood').verdict, 'met');
    assert.match(find('Action tokens').value, /^1000 on 2 requests, 1 applied/);
    assert.equal(find('Most action tokens in any rolling hour').value, '1000');
    assert.equal(find('Mornings a hearth went cold').value, '1, 2 cold hearths in all');
    assert.equal(find('Meals chosen at a hunger under').verdict, 'not met');
    assert.equal(find('Loaves drawn per resident per village day').value, (3 / residents).toFixed(2));
    assert.equal(find('Days a household ran short while the storehouse did not').value, '1');
    assert.equal(find('A viewer can tell').verdict, 'needs a viewer');
    assert.match(readoutText(report), /Stage 3a · The common store/);
    assert.equal(find('Meals in the last seven village days').verdict, 'no data');

    const dawn = 360 + 7 * 1440;
    const reserve = { minute: dawn, readyDays: 0.4, hallDays: 0.1, storehouseDays: 0.2, larderDays: 0.1, unpreparedDays: 3 };
    const portion = { meal: { food: 'cooked', household: 'cottage-1', portions: 1, hungerRelieved: 40, sources: [
      { source: 'game', portions: 0.75, hungerRelieved: 30 }, { source: 'unknown', portions: 0.25, hungerRelieved: 10 },
    ] } };
    await event(360, 'meal', [a], 'Ate before the window.', portion);
    await event(m + 100, 'meal', [a], 'Ate a cooked meal.', portion);
    await event(dawn + 1, 'meal', [b], 'Ate after the window.', portion);
    for (let minute = 360 + 1440; minute <= dawn; minute += 1440) {
      await event(minute, 'village', [], 'Dawn food count.', { foodReserve: { ...reserve, minute }, hungryAdults: 1, missedBreakfasts: 2 });
    }
    await q(`UPDATE dalecrest.world SET state = jsonb_set(jsonb_set(state, '{minute}', to_jsonb($1::bigint)), '{foodReserve}', $2)`,
      [dawn + 120, reserve]);
    const withFood = await readout(db.pool, { hours: 24, tick: 3 });
    assert.equal(withFood.food.portions, 1);
    assert.equal(withFood.food.hungerRelieved, 40);
    assert.equal(withFood.food.dawns.length, 7);
    assert.deepEqual(withFood.food.bySource, { game: { portions: 0.75, hungerRelieved: 30 }, unknown: { portions: 0.25, hungerRelieved: 10 } });
    assert.match(readoutText(withFood), /Ready food at the latest dawn: 0\.40 village days/);
    assert.match(readoutText(withFood), /7 adult mornings, 14 missed child breakfasts/);
  } finally {
    await db?.pool.end();
    if (created) await admin.query('DROP DATABASE ' + name + ' WITH (FORCE)');
    await admin.end();
  }
});

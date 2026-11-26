import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { readAdminMetrics, readDecisionReports, readTrace, reasonGroup, summarizeDecisions } from './admin-metrics.mjs';

// A stored request and reply in the shape the village sends and the provider returns.
const menu = ['work:mill:mill', 'leisure:green', 'rest:home'];
const request = (choices = menu) => JSON.stringify({ model: 'gpt-6-luna',
  input: [{ role: 'user', content: [{ type: 'input_json', data: { name: 'Robin', note: '"questions": is only text here' } }] }],
  questions: [{ type: 'choice', name: 'next_action', choices: choices.map(value => ({ value, description: value })), instructions: 'Choose.' }] });
const questionsOf = body => body.slice(body.indexOf('"questions":'));
const reply = (odds, choice = menu[0]) => JSON.stringify({ model: 'gpt-6-luna', answers: [{ type: 'choice', name: 'next_action', choice,
  ...(odds && { probabilities: odds.map((probability, i) => ({ value: menu[i], probability })) }), confidence: 0.3 }] });

test('a stored decision gives the chosen option’s place in the menu and the gap between the two likeliest', () => {
  assert.deepEqual(readTrace({ choice: 'leisure:green', questions: questionsOf(request()), reply: reply([0.44, 0.55, 0.01], 'leisure:green') }),
    { position: 2, size: 3, margin: 0.11 });
  assert.deepEqual(readTrace({ choice: 'rest:home', questions: questionsOf(request()), reply: reply(null) }),
    { position: 3, size: 3, margin: null });
  assert.equal(readTrace({ choice: 'elsewhere', questions: questionsOf(request()), reply: reply([1, 0, 0]) }), null);
  assert.equal(readTrace({ choice: 'rest:home', questions: null, reply: reply([1, 0, 0]) }), null);
  assert.equal(readTrace({ choice: 'rest:home', questions: questionsOf(request()), reply: 'not json' }), null);
});

test('decision reports group reasons, count close calls per resident and tally menu positions', () => {
  assert.equal(reasonGroup('would run into my promise to Mabel Ash to cut wood'), 'would run into a promise');
  assert.equal(reasonGroup(null), '(not recorded)');
  const trace = (id, name, choice, odds) => ({ id, name, choice, questions: questionsOf(request()), reply: reply(odds, choice) });
  const summary = summarizeDecisions({
    reasons: [{ reason: 'no instruction applies', count: 3 }, { reason: 'would run into my promise to Agnes Reed to draw water', count: 1 },
      { reason: 'would run into my promise to Hugh Fen to cut wood', count: 2 }, { reason: null, count: 1 }],
    repeats: [{ finished: 'work', fresh: 4, sameAgain: 3 }],
    traces: [
      trace('robin', 'Robin Marsh', 'work:mill:mill', [0.55, 0.44, 0.01]),
      trace('robin', 'Robin Marsh', 'leisure:green', [0.25, 0.5, 0.25]),
      trace('robin', 'Robin Marsh', 'work:mill:mill', [0.9, 0.05, 0.05]),
      trace('agnes', 'Agnes Reed', 'rest:home', null),
      { id: 'agnes', name: 'Agnes Reed', choice: 'rest:home', questions: null, reply: '{}' },
    ],
  });
  assert.deepEqual(summary.freshReasons, [{ reason: 'no instruction applies', count: 3 }, { reason: 'would run into a promise', count: 3 },
    { reason: '(not recorded)', count: 1 }]);
  assert.deepEqual(summary.repeats, [{ finished: 'work', fresh: 4, sameAgain: 3 }]);
  assert.deepEqual(summary.closeCalls.all, { decisions: 3, within10: 0, within20: 1, within30: 2, medianMargin: 0.25 });
  assert.equal(summary.closeCalls.unreadable, 1);
  assert.equal(summary.closeCalls.withoutOdds, 1);
  assert.deepEqual(summary.closeCalls.residents.map(r => [r.id, r.decisions]), [['agnes', 0], ['robin', 3]]);
  assert.equal(summary.closeCalls.residents[1].medianMargin, 0.25);
  assert.deepEqual(summary.menuPosition, [{ position: 1, offered: 4, chosen: 2 }, { position: 2, offered: 4, chosen: 1 },
    { position: 3, offered: 4, chosen: 1 }]);
  assert.deepEqual(summarizeDecisions({}).menuPosition, []);
});

const adminUrl = process.env.DALECREST_TEST_ADMIN_URL;
test('decision reports read the activity log and stored decisions in PostgreSQL', { skip: !adminUrl }, async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  const name = 'dalecrest_reports_' + randomUUID().replaceAll('-', '');
  let db, created = false;
  await admin.connect();
  try {
    await admin.query('CREATE DATABASE ' + name);
    created = true;
    const url = new URL(adminUrl);
    url.pathname = '/' + name;
    process.env.DATABASE_URL = url.href;
    db = await import('./db.mjs');
    await db.initialize();
    const { pool } = db;
    const log = (actor, minute, basis, action, reason, ago) => pool.query(`INSERT INTO dalecrest.activity_log(actor_id,minute,basis,action,reason,recorded_at)
      VALUES ($1,$2,$3,$4,$5,now() - make_interval(secs => $6))`, [actor, minute, basis, action, reason, ago]);
    const mill = { kind: 'work', job: 'mill', target: 'mill' }, green = { kind: 'leisure', target: 'green' };
    // Ann finished at the mill and chose the mill again. Ben finished on the green and chose the mill.
    await log('ann', 10, 'waiting', mill, 'instruction ran its course', 600);
    await log('ann', 11, 'fresh', mill, null, 590);
    await log('ben', 10, 'waiting', green, 'would run into my promise to Ann to grind barley', 500);
    await log('ben', 11, 'fresh', mill, null, 490);
    await log('ben', 20, 'standing', green, null, 480);
    // Two days ago: outside the window.
    await log('ann', 1, 'waiting', green, 'no instruction applies', 2 * 86400);
    await log('ann', 2, 'fresh', green, null, 2 * 86400 - 10);
    // A resident has one decision in force. Each new one ends the last, as the village records it.
    const trace = async (actor, choice, odds, ago, extra = {}) => {
      await pool.query(`UPDATE dalecrest.decision_traces SET ended_minute=10, end_reason='replaced'
        WHERE actor_id=$1 AND status='applied' AND ended_minute IS NULL`, [actor]);
      await pool.query(`INSERT INTO dalecrest.decision_traces
        (actor_id,model,endpoint,request_body,observed_minute,requested_at,token_charge,decision_since,choice,response_body,status)
        VALUES ($1,'gpt-6-luna','https://example.test',$2,10,now() - make_interval(secs => $3),300,10,$4,$5,'applied')`,
        [actor, extra.request ?? request(), ago, choice, reply(odds, choice)]);
    };
    await trace('ann', 'work:mill:mill', [0.55, 0.44, 0.01], 300);
    await trace('ben', 'leisure:green', [0.1, 0.8, 0.1], 200);
    await trace('ben', 'leisure:green', [0.1, 0.8, 0.1], 3 * 86400);
    await trace('ben', 'rest:home', [0.3, 0.3, 0.4], 100, { request: 'not a request' });

    const reports = await readDecisionReports(pool);
    assert.equal(reports.hours, 24);
    assert.equal(reports.truncated, false);
    assert.deepEqual(reports.freshReasons, [{ reason: 'instruction ran its course', count: 1 }, { reason: 'would run into a promise', count: 1 }]);
    assert.deepEqual(reports.repeats, [{ finished: 'leisure', fresh: 1, sameAgain: 0 }, { finished: 'work', fresh: 1, sameAgain: 1 }]);
    assert.deepEqual(reports.closeCalls.all, { decisions: 2, within10: 0, within20: 1, within30: 1, medianMargin: 0.405 });
    assert.equal(reports.closeCalls.unreadable, 1);
    assert.deepEqual(reports.closeCalls.residents.map(r => [r.id, r.decisions]), [['ann', 1], ['ben', 1]]);
    assert.deepEqual(reports.menuPosition, [{ position: 1, offered: 2, chosen: 1 }, { position: 2, offered: 2, chosen: 1 },
      { position: 3, offered: 2, chosen: 0 }]);

    await trace('robin', 'work:mill:mill', [0.55, 0.44, 0.01], 50);
    await trace('past', 'work:mill:mill', [0.55, 0.44, 0.01], 20 * 86400);
    await trace('future', 'work:mill:mill', [0.55, 0.44, 0.01], -1800);
    await pool.query(`INSERT INTO dalecrest.decision_traces
      (actor_id,model,endpoint,request_body,observed_minute,token_charge)
      SELECT 'extra-' || n,'gpt-6-luna','https://example.test','{}',10,100 FROM generate_series(1,7) AS g(n)`);
    await pool.query(`INSERT INTO dalecrest.goal_reviews(actor_id,observed_minute,why,model,request_body,token_charge)
      VALUES ('robin',10,'needs direction','claude-haiku','{}',900)`);
    await pool.query(`INSERT INTO dalecrest.song_drafts(session_id,session,requested_at,token_charge)
      VALUES ('test-song','{"actorId":"robin"}',now(),200)`);
    await pool.query(`INSERT INTO dalecrest.daily_model_usage(day,attempt,requested_at,token_charge) VALUES (1,1,now(),460)`);

    const { tokens, residentTokens } = await readAdminMetrics(pool);
    assert.equal(tokens.length, 14);
    assert.equal(tokens.reduce((sum, day) => sum + day.openai, 0), 2200);
    assert.equal(tokens.reduce((sum, day) => sum + day.anthropic, 0), 1560);
    assert.deepEqual(residentTokens.slice(0, 3), [
      { id: 'robin', name: 'Robin Marsh', openai: 300, anthropic: 1100, total: 1400 },
      { id: 'ben', name: 'ben', openai: 900, anthropic: 0, total: 900 },
      { id: 'ann', name: 'ann', openai: 300, anthropic: 0, total: 300 },
    ]);
    assert.deepEqual(residentTokens.slice(3).map(row => row.id), ['extra-1', 'extra-2', 'extra-3', 'extra-4', 'extra-5']);
  } finally {
    await db?.pool.end();
    if (created) await admin.query('DROP DATABASE ' + name + ' WITH (FORCE)');
    await admin.end();
  }
});

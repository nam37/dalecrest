// Runs a village on the model-driven path with a scripted stand-in for the Decisions API, so the
// clock, standing instructions and the activity log can be watched and measured without spending tokens.
//   node --env-file=.env tools/standin-village.mjs
// It uses its own database (STANDIN_DATABASE, default dalecrest_standin) in the server DATABASE_URL names,
// listens on port 4175 unless PORT is set, and never contacts a model provider.
//   VILLAGE_SECONDS_PER_MINUTE  real seconds per village minute (default 2 here, to see days pass)
//   STANDIN_REPLY_SECONDS       how long the stand-in takes to answer a request (default 4)
import pg from 'pg';

const name = process.env.STANDIN_DATABASE || 'dalecrest_standin';
if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error('STANDIN_DATABASE must be a plain lowercase database name.');
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to the PostgreSQL server that should hold the stand-in database.');
const url = new URL(process.env.DATABASE_URL);
if (url.pathname === '/' + name) throw new Error('The stand-in database must differ from the one in DATABASE_URL.');
const admin = new URL(url);
admin.pathname = '/postgres';
const client = new pg.Client({ connectionString: admin.href });
await client.connect();
if (!(await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])).rowCount) await client.query('CREATE DATABASE ' + name);
await client.end();
url.pathname = '/' + name;
process.env.DATABASE_URL = url.href;
process.env.PORT ||= '4175';
process.env.VILLAGE_SECONDS_PER_MINUTE ||= '2';
// The model-driven path, with no credential: the server applies recorded replies and sends nothing.
process.env.PLANNER_PROVIDER = 'openai';
delete process.env.OPENAI_API_KEY;
delete process.env.OLLAMA_MODEL;

await import('../server.mjs');
const db = await import('../db.mjs');
const replyAfter = Number(process.env.STANDIN_REPLY_SECONDS || 4) * 1000;

// A plausible resident: eat when hungry, sleep at night, go to the moot, otherwise work, visit or walk.
function choose(request) {
  const seen = request.input[0].content[0].data, ids = request.questions[0].choices.map(c => c.value);
  const pick = prefix => ids.find(id => id.startsWith(prefix));
  const hour = Number(seen.time.slice(0, 2)), night = hour >= 21 || hour < 6;
  const turn = Number(seen.time.slice(3)) + seen.name.length;
  return pick('meeting:') || (seen.needs.hunger > 55 && pick('food:')) || (night && pick('rest:')) || pick('work:build:')
    || (turn % 3 === 0 && seen.needs.loneliness > 30 && pick('social:')) || (turn % 3 !== 1 && pick('work:')) || pick('leisure:') || ids[0];
}

let busy = false;
setInterval(async () => {
  if (busy) return;
  busy = true;
  try {
    const ticket = await db.claimAction(1e9);
    if (!ticket?.id) return;
    // Label the exchange honestly: no model chose this.
    await db.pool.query("UPDATE dalecrest.decision_traces SET model='the stand-in script' WHERE id=$1", [ticket.id]);
    const request = JSON.parse(ticket.body), choice = choose(request);
    setTimeout(() => db.recordReply(ticket.id, { status: 200, requestId: 'standin-' + ticket.id, redacted: false,
      body: JSON.stringify({ answers: [{ type: 'choice', name: 'next_action', choice, confidence: 1 }], usage: { total_tokens: Math.ceil(ticket.body.length / 3) + 80 } }) })
      .catch(() => console.error('The stand-in could not record a reply.')), replyAfter);
  } catch { console.error('The stand-in could not claim a turn. Retrying.'); }
  finally { busy = false; }
}, 500);
console.log('Stand-in decisions are answering in place of the Decisions API. No model is contacted.');

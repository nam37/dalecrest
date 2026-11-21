// Reports the Stage 0 pilot measurements from a village's database:
//   node --env-file=.env tools/pilot-report.mjs [real hours to look back, default 24]
// It reads only. Set DATABASE_URL to the village to measure.
import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to the village database to measure.');
const hours = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 24;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const all = async (sql, args = []) => (await db.query(sql, args)).rows;
const since = `now() - make_interval(hours => ${hours})`;

const world = await one(`SELECT (state->>'minute')::bigint AS minute, ticks, late_ms_max,
  (SELECT count(*)::int FROM dalecrest.actors) AS residents FROM dalecrest.world`);
const span = await one(`SELECT min(minute) AS first, max(minute) AS last, count(*)::int AS n FROM dalecrest.activity_log WHERE recorded_at > ${since}`);
const villageDays = span.n ? Math.max(1, Number(span.last) - Number(span.first)) / 1440 : 0;
console.log(`Dalecrest pilot report · last ${hours} real hours`);
console.log(`Village minute ${world.minute} (day ${Math.floor(world.minute / 1440) + 1}) · ${world.residents} residents · ${villageDays.toFixed(2)} village days covered`);
console.log(`Clock: ${world.ticks} ticks since counting began, latest any tick ran: ${(world.late_ms_max / 1000).toFixed(1)} s`);
if (!span.n) { console.log('No activity has been recorded in this window.'); await db.end(); process.exit(0); }

console.log('\nHow activities began');
const basis = await all(`SELECT basis, count(*)::int AS n FROM dalecrest.activity_log WHERE recorded_at > ${since} GROUP BY basis ORDER BY n DESC`);
const started = basis.filter(b => b.basis === 'fresh' || b.basis === 'standing').reduce((sum, b) => sum + b.n, 0);
for (const b of basis) {
  const share = b.basis === 'fresh' || b.basis === 'standing' ? ` · ${(100 * b.n / started).toFixed(0)}% of activities started` : '';
  console.log(`  ${b.basis.padEnd(18)} ${String(b.n).padStart(6)}${share}`);
}
const fresh = basis.find(b => b.basis === 'fresh')?.n || 0;
console.log(`  Fresh choices per resident per village day: ${(fresh / world.residents / villageDays).toFixed(1)}`);

console.log('\nWhy a fresh choice was needed');
for (const r of await all(`SELECT coalesce(reason,'(not recorded)') AS reason, count(*)::int AS n FROM dalecrest.activity_log
  WHERE basis='waiting' AND recorded_at > ${since} GROUP BY 1 ORDER BY n DESC`)) console.log(`  ${String(r.n).padStart(6)}  ${r.reason}`);

console.log('\nInstructions that ended');
for (const r of await all(`SELECT routine, reason, count(*)::int AS n FROM dalecrest.activity_log
  WHERE basis='instruction_ended' AND recorded_at > ${since} GROUP BY 1,2 ORDER BY n DESC LIMIT 12`)) console.log(`  ${String(r.n).padStart(6)}  ${r.routine} · ${r.reason}`);

// A wait runs from the row that opened it to the next fresh or standing row for the same resident.
const waits = `WITH ordered AS (
    SELECT actor_id, basis, recorded_at, waited_minutes,
      lead(basis) OVER w AS next_basis, lead(recorded_at) OVER w AS next_at
    FROM dalecrest.activity_log WHERE basis IN ('waiting','fresh','standing') WINDOW w AS (PARTITION BY actor_id ORDER BY id))
  SELECT actor_id, next_basis, extract(epoch FROM next_at - recorded_at) AS seconds FROM ordered
  WHERE basis='waiting' AND next_at IS NOT NULL AND recorded_at > ${since}`;
const wait = await one(`SELECT count(*)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds) AS median,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY seconds) AS p95, max(seconds) AS longest FROM (${waits}) w`);
console.log('\nReal time from an activity ending to the next one starting, when a choice was needed');
if (wait.n) {
  console.log(`  ${wait.n} waits · median ${Number(wait.median).toFixed(0)} s · 95th percentile ${Number(wait.p95).toFixed(0)} s · longest ${Number(wait.longest).toFixed(0)} s`);
  for (const r of await all(`SELECT actor_id, max(seconds) AS longest, count(*)::int AS n FROM (${waits}) w GROUP BY 1 ORDER BY 2 DESC LIMIT 5`)) {
    console.log(`  ${r.actor_id.padEnd(12)} longest ${Number(r.longest).toFixed(0)} s over ${r.n} waits`);
  }
  const ended = await all(`SELECT next_basis, count(*)::int AS n FROM (${waits}) w GROUP BY 1`);
  console.log('  Ended by: ' + ended.map(e => `${e.next_basis === 'fresh' ? 'a reply' : 'an instruction coming to cover the moment'} ${e.n}`).join(', '));
} else console.log('  No completed waits yet.');
const open = await one(`SELECT count(*)::int AS n FROM dalecrest.actors WHERE state#>>'{action,kind}'='waiting'`);
console.log(`  Residents waiting right now: ${open.n}`);
// Of the wait for a reply, how much was the queue and how much the provider.
const split = await one(`SELECT avg(extract(epoch FROM response_at - requested_at)) AS api FROM dalecrest.decision_traces
  WHERE decision_since IS NOT NULL AND response_at IS NOT NULL AND requested_at > ${since}`);
if (split.api !== null) console.log(`  Mean time a request spent with the provider: ${Number(split.api).toFixed(1)} s. The rest of a wait is time queued for budget.`);

console.log('\nSpending on action choices');
const spend = await one(`SELECT count(*)::int AS requests, coalesce(sum(token_charge),0)::int AS tokens,
  count(*) FILTER (WHERE status='applied')::int AS applied,
  coalesce(sum(token_charge) FILTER (WHERE status<>'applied'),0)::int AS unapplied_tokens,
  avg(token_charge) FILTER (WHERE status='applied') AS per_applied
  FROM dalecrest.decision_traces WHERE decision_since IS NOT NULL AND requested_at > ${since}`);
console.log(`  ${spend.requests} requests · ${spend.tokens} tokens · ${spend.applied} applied` + (spend.per_applied ? ` at ${Number(spend.per_applied).toFixed(0)} tokens each` : ''));
console.log(`  Tokens spent on replies that were not applied: ${spend.unapplied_tokens}`);
console.log(`  Per real day: ${(spend.tokens * 24 / hours).toFixed(0)} tokens · per village day: ${(spend.tokens / villageDays).toFixed(0)} tokens`);
for (const r of await all(`SELECT status, count(*)::int AS n FROM dalecrest.decision_traces
  WHERE decision_since IS NOT NULL AND requested_at > ${since} GROUP BY 1 ORDER BY n DESC`)) console.log(`  ${String(r.n).padStart(6)}  ${r.status}`);
await db.end();

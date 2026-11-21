import pg from 'pg';
import { reserveAction, startChosenAction } from './action-turns.mjs';
import { createVillage, stepVillage, adoptVillage, FOCUSES, DEFAULT_SEED } from './sim.mjs';
import { DECISIONS_MODEL, DECISIONS_URL, interpretDecision } from './decisions.mjs';
import { initializeTraces, advanceWithTraces, writeSteps, writeActivities, residentState } from './decision-trace.mjs';

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in .env to a PostgreSQL database before starting Dalecrest.');
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 5000 });
pool.on('error', () => console.error('A database connection closed. The pool will reconnect.'));

async function transaction(run) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await run(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

// The map changes rarely, so each process keeps the revision it last read or wrote.
let held = null;
async function loadMap(db, revision) {
  if (held?.revision === revision) return held;
  const { rows } = await db.query('SELECT state FROM dalecrest.map WHERE id=1');
  return held = rows[0]?.state ?? null;
}
async function saveMap(db, map) {
  await db.query(`INSERT INTO dalecrest.map(id, revision, state) VALUES (1, $1, $2)
    ON CONFLICT (id) DO UPDATE SET revision = excluded.revision, state = excluded.state`, [map.revision, map]);
}
async function saveActors(db, actors) {
  await db.query(`INSERT INTO dalecrest.actors(id, ordinal, state)
    SELECT payload.actor->>'id', payload.n - 1, payload.actor
    FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS payload(actor, n)
    ON CONFLICT (id) DO UPDATE SET state = excluded.state`, [JSON.stringify(actors)]);
}
export async function currentMap() {
  return (await pool.query('SELECT state FROM dalecrest.map WHERE id=1')).rows[0].state;
}

async function recordEvents(db, events) {
  if (!events.length) return [];
  const result = await db.query(`INSERT INTO dalecrest.events(minute, kind, actor_ids, description)
    SELECT e.minute, e.type, e."actorIds", e.text FROM jsonb_to_recordset($1::jsonb)
    AS e(minute bigint, type text, "actorIds" text[], text text) RETURNING id, minute, actor_ids`, [JSON.stringify(events)]);
  return result.rows;
}

export async function initialize() {
  await transaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(39495127)');
    await db.query(`
      CREATE SCHEMA IF NOT EXISTS dalecrest;
      CREATE TABLE IF NOT EXISTS dalecrest.world (
        id integer PRIMARY KEY CHECK (id = 1), state jsonb NOT NULL,
        next_tick timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS dalecrest.actors (
        id text PRIMARY KEY, ordinal integer UNIQUE NOT NULL, state jsonb NOT NULL,
        CHECK (state->>'id' = id)
      );
      CREATE TABLE IF NOT EXISTS dalecrest.events (
        id bigserial PRIMARY KEY, minute bigint NOT NULL, kind text NOT NULL,
        actor_ids text[] NOT NULL, description text NOT NULL
      );
      CREATE TABLE IF NOT EXISTS dalecrest.map (
        id integer PRIMARY KEY CHECK (id = 1), revision bigint NOT NULL, state jsonb NOT NULL
      );
      CREATE TABLE IF NOT EXISTS dalecrest.planner_limits (
        provider text PRIMARY KEY, next_request_at timestamptz NOT NULL
      );
    `);
    await initializeTraces(db);
    await db.query(`ALTER TABLE dalecrest.world ADD COLUMN IF NOT EXISTS ticks bigint NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS late_ms_max integer NOT NULL DEFAULT 0`);
    // The clock stops with the server. Time it was down is not counted as the clock running late.
    await db.query('UPDATE dalecrest.world SET next_tick = now() WHERE next_tick < now()');
    const seed = Number(process.env.VILLAGE_SEED) || DEFAULT_SEED;
    const stored = await db.query('SELECT state FROM dalecrest.world WHERE id=1 FOR UPDATE');
    if (stored.rowCount) {
      // A village founded before the map existed keeps its residents and gains the ground under them.
      if ((await db.query('SELECT id FROM dalecrest.map WHERE id=1')).rowCount) return;
      const world = stored.rows[0].state;
      const actors = (await db.query('SELECT state FROM dalecrest.actors ORDER BY ordinal')).rows.map(r => r.state);
      const map = adoptVillage({ world, actors }, seed);
      await db.query('UPDATE dalecrest.world SET state=$1 WHERE id=1', [world]);
      await saveActors(db, actors);
      await saveMap(db, map);
      await recordEvents(db, [{ minute: world.minute, type: 'village', actorIds: [], text: 'The parish was surveyed, and every lane, field and cottage of Dalecrest set down on a new map.' }]);
      return;
    }
    const village = createVillage(seed);
    if (process.env.PLANNER_PROVIDER !== 'openai') village.events.push(...stepVillage(village, { minutes: 105 }));
    await db.query('INSERT INTO dalecrest.world(id, state) VALUES (1, $1)', [village.world]);
    await saveActors(db, village.actors);
    await saveMap(db, village.map);
    await recordEvents(db, village.events);
  });
}

export async function reserveDecision(seconds, actorId, minute, body) {
  const result = await pool.query(`WITH slot AS (
    INSERT INTO dalecrest.planner_limits(provider, next_request_at)
    VALUES ('decisions', now() + make_interval(secs => $1))
    ON CONFLICT (provider) DO UPDATE SET next_request_at = excluded.next_request_at
    WHERE dalecrest.planner_limits.next_request_at <= now() RETURNING provider)
    INSERT INTO dalecrest.decision_traces(actor_id,observed_minute,model,endpoint,request_body)
    SELECT $2,$3,$4,$5,$6 FROM slot RETURNING id`, [seconds, actorId, minute, DECISIONS_MODEL, DECISIONS_URL, body]);
  return result.rows[0]?.id;
}

export async function recordReply(id, reply) {
  let tokens;
  try { tokens = JSON.parse(reply.body)?.usage?.total_tokens; } catch { /* Error replies can be plain text. */ }
  await pool.query(`UPDATE dalecrest.decision_traces SET
    status=CASE WHEN status='unknown' AND decision_since IS NOT NULL THEN 'late_response' ELSE 'received' END,
    token_charge=CASE WHEN token_charge IS NULL THEN NULL ELSE coalesce($6,token_charge) END, response_at=clock_timestamp(),
    http_status=$2, provider_request_id=$3, response_body=$4, credential_redacted=$5, error=NULL
    WHERE id=$1 AND status IN ('requested','unknown')`, [id, reply.status, reply.requestId, reply.body, reply.redacted, Number.isSafeInteger(tokens) && tokens > 0 && tokens <= 2147483647 ? tokens : null]);
}

export async function recordTransportFailure(id) {
  await pool.query(`UPDATE dalecrest.decision_traces SET status='transport_error',
    error='Transport failed before a complete response was received.' WHERE id=$1 AND status='requested'`, [id]);
}

export async function pendingDecision() {
  await pool.query(`UPDATE dalecrest.decision_traces SET status='unknown', error='Response was not recorded.'
    WHERE status='requested' AND requested_at < now() - interval '5 minutes'`);
  const r = await pool.query("SELECT id FROM dalecrest.decision_traces WHERE status='received' ORDER BY id LIMIT 1");
  return r.rows[0]?.id;
}

// Village time advances on its own schedule, whatever the models are doing. The pace is a pilot
// parameter: real seconds per village minute, 30 when the Decisions API chooses and 1 under local rules.
function clockPace(direct) {
  const set = Number(process.env.VILLAGE_SECONDS_PER_MINUTE);
  const pace = set > 0 ? set : direct ? 30 : 1;
  const minutes = Math.max(1, Math.round(3 / pace));
  return { minutes, seconds: minutes * pace };
}

export async function advance() {
  // A step changes the held map in place, so a failed commit must not leave that copy behind.
  return transaction(tick).catch(error => { held = null; throw error; });
}
async function tick(db) {
  const result = await db.query('SELECT state FROM dalecrest.world WHERE id=1 AND next_tick <= now() FOR UPDATE SKIP LOCKED');
  if (!result.rowCount) return;
  const world = result.rows[0].state;
  const actors = (await db.query('SELECT state FROM dalecrest.actors ORDER BY ordinal')).rows.map(r => r.state);
  const map = await loadMap(db, world.mapRevision);
  const before = map.revision;
  const traces = (await db.query(`SELECT id,actor_id,until_minute,decision_since FROM dalecrest.decision_traces
      WHERE status='applied' AND ended_minute IS NULL`)).rows;
  const direct = process.env.PLANNER_PROVIDER === 'openai';
  const { minutes, seconds } = clockPace(direct);
  const records = [];
  const { events, steps } = advanceWithTraces({ world, actors, map }, minutes, traces, direct, records);
  // The right-hand sides read the row as it was, so lateness is measured against the tick that was due.
  await db.query(`UPDATE dalecrest.world SET state=$1, ticks=ticks+1,
    late_ms_max=greatest(late_ms_max, least(extract(epoch FROM now()-next_tick)*1000, 2000000000)::int),
    next_tick=now()+make_interval(secs=>$2) WHERE id=1`, [world, seconds]);
  await saveActors(db, actors);
  if (map.revision !== before) await saveMap(db, map);
  const chronicle = await recordEvents(db, events);
  await writeSteps(db, steps, chronicle, traces, world.minute);
  await writeActivities(db, records);
}

// Observers only see committed maps. Capture one map and its residents in the same database snapshot.
let observerMap = null;
export async function snapshot({ withMap = false } = {}) {
  const cached = observerMap;
  const result = await pool.query(`
    SELECT w.state AS world,
      ${withMap ? `greatest(0, extract(epoch FROM w.next_tick - statement_timestamp()) * 1000)::int AS "nextTickInMs",
        (SELECT m.state FROM dalecrest.map m WHERE m.id=w.id AND m.revision IS DISTINCT FROM $1::bigint) AS map,` : ''}
      (SELECT jsonb_agg(state ORDER BY ordinal) FROM dalecrest.actors) AS actors,
      COALESCE((SELECT jsonb_agg(to_jsonb(recent) ORDER BY recent.id DESC) FROM
        (SELECT id, minute, kind AS type, actor_ids AS "actorIds", description AS text
         FROM dalecrest.events ORDER BY id DESC LIMIT 100) recent),'[]'::jsonb) AS events
    FROM dalecrest.world w WHERE w.id=1`, withMap ? [cached?.revision ?? null] : []);
  const state = result.rows[0];
  if (withMap) {
    state.map ??= cached;
    observerMap = state.map;
  }
  return state;
}

async function persistPlan(db, minute, actorId, basedOn, focus, reason, model, method) {
  if (minute - basedOn > 120) return { status: 'stale' };
  const actor = (await db.query('SELECT state FROM dalecrest.actors WHERE id=$1', [actorId])).rows[0]?.state;
  if (!actor) return { status: 'actor_missing' };
  if (actor.plan?.model === model && actor.plan.until > minute) return { status: 'superseded' };
  await db.query(`UPDATE dalecrest.decision_traces SET ended_minute=$2,end_reason='replaced'
    WHERE actor_id=$1 AND status='applied' AND ended_minute IS NULL`, [actorId, minute]);
  actor.plan = { focus, reason, until: minute + 360, model, method, madeAt: minute };
  actor.lastModelPlanAt = minute;
  await db.query('UPDATE dalecrest.actors SET state=$1 WHERE id=$2', [actor, actor.id]);
  const text = method === 'choice' ? actor.name + ' prioritized ' + focus + '. ' + reason : actor.name + ' made a plan. “' + reason + '”';
  await recordEvents(db, [{ minute, type: 'plan', actorIds: [actor.id], text }]);
  return { status: 'applied', until: actor.plan.until, state: residentState(actor) };
}

async function lockClock(db) {
  const { rows } = await db.query('SELECT state FROM dalecrest.world WHERE id=1 FOR UPDATE');
  return rows[0].state.minute;
}

export async function savePlan(actorId, basedOn, focus, reason, model, method = 'generated') {
  if (!FOCUSES.includes(focus) || !reason) return false;
  return transaction(async db => {
    const result = await persistPlan(db, await lockClock(db), actorId, basedOn, focus, reason, model, method);
    return result.status === 'applied';
  });
}

async function lockedVillage(db) {
  const { rows: [row] } = await db.query('SELECT state FROM dalecrest.world WHERE id=1 FOR UPDATE');
  const world = row.state;
  const actors = (await db.query('SELECT state FROM dalecrest.actors ORDER BY ordinal')).rows.map(r => r.state);
  const map = await loadMap(db, world.mapRevision);
  return { world, actors, map };
}

export async function claimAction(hourlyBudget) {
  return transaction(async db => reserveAction(db, await lockedVillage(db), hourlyBudget));
}

export async function applyRecordedDecision(id) {
  return transaction(async db => {
    const village = await lockedVillage(db);
    const minute = village.world.minute;
    const trace = (await db.query(`SELECT * FROM dalecrest.decision_traces
      WHERE id=$1 AND status='received' FOR UPDATE`, [id])).rows[0];
    if (!trace) return;
    const request = JSON.parse(trace.request_body);
    const parsed = interpretDecision(request.input[0].content[0].data, {status: trace.http_status, body: trace.response_body}, request.questions[0]);
    let result = parsed;
    if (!parsed.error) {
      result = trace.decision_since != null
        ? await startChosenAction(db, trace, parsed.focus, village, recordEvents)
        : await persistPlan(db, minute, trace.actor_id, Number(trace.observed_minute), parsed.focus, parsed.reason, trace.model, 'choice');
    }
    await db.query(`UPDATE dalecrest.decision_traces SET status=$2, error=$3, choice=$4, confidence=$5,
      applied_minute=$6, until_minute=$7, state_at_application=$8 WHERE id=$1`,
      [id, result.status, parsed.error, parsed.focus, parsed.confidence, result.status === 'applied' ? minute : null, result.until, result.state]);
    return result;
  });
}

import pg from 'pg';
import { eventRequestKey, requestIndexes } from './request-archive.mjs';
import { dailySchema, queueEditions } from './daily.mjs';
import { civicAccountSchema, eventAccount, claimCivicAccount, writeCivicAccount } from './civic-accounts.mjs';
import { appointReporter } from './engine/reporting.mjs';
import { reserveAction, startChosenAction } from './action-turns.mjs';
import { createVillage, stepVillage, adoptVillage, welcomeResidents, FOCUSES, DEFAULT_SEED } from './sim.mjs';
import { POPULATION_LIMIT } from './engine/people.mjs';
import { DECISIONS_MODEL, DECISIONS_URL, interpretDecision } from './decisions.mjs';
import { salienceOf, PUBLIC } from './engine/chronicle.mjs';
import { knowledgeSchema, writeGoals, writeObservations } from './knowledge.mjs';
import { claimReview, goalModel, sendReview, settleReview } from './goal-reviews.mjs';
import { claimSongDraft, queueSongDrafts, settleSongDraft, songDraftSchema } from './song-drafts.mjs';
import { initializeTraces, advanceWithTraces, writeSteps, writeActivities, residentState } from './decision-trace.mjs';
import { historySchema, collectPresence, writePresence } from './village-history.mjs';
import { eventMootKey, recordIndexes } from './record-pages.mjs';
import { clockPace } from './engine/clock.mjs';

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in .env to a PostgreSQL database before starting Dalecrest.');
const minimumResidents = Number(process.env.VILLAGE_MIN_RESIDENTS ?? 8);
if (!Number.isInteger(minimumResidents) || minimumResidents < 0 || minimumResidents > POPULATION_LIMIT) {
  throw new Error('VILLAGE_MIN_RESIDENTS must be an integer between 0 and ' + POPULATION_LIMIT);
}
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
async function saveMap(db, map, minute) {
  await db.query(`WITH current AS (
      INSERT INTO dalecrest.map(id, revision, state) VALUES (1, $1, $2)
      ON CONFLICT (id) DO UPDATE SET revision=excluded.revision, state=excluded.state RETURNING revision, state
    )
    INSERT INTO dalecrest.map_revisions(revision, minute, state)
    SELECT revision, $3, state FROM current ON CONFLICT (revision) DO NOTHING`, [map.revision, map, minute]);
}
async function saveActors(db, actors) {
  // A resident who has left or died is no longer in the village. A new one takes the next place in the order.
  await db.query('DELETE FROM dalecrest.actors WHERE NOT (id = ANY($1::text[]))', [actors.map(a => a.id)]);
  await db.query(`WITH payload AS (SELECT actor, n FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS p(actor, n)),
      fresh AS (SELECT n, row_number() OVER (ORDER BY n) AS k FROM payload
        WHERE NOT EXISTS (SELECT 1 FROM dalecrest.actors a WHERE a.id = payload.actor->>'id'))
    INSERT INTO dalecrest.actors(id, ordinal, state)
    SELECT payload.actor->>'id', (SELECT coalesce(max(ordinal), -1) FROM dalecrest.actors) + coalesce(fresh.k, 0), payload.actor
    FROM payload LEFT JOIN fresh USING (n) ORDER BY payload.n
    ON CONFLICT (id) DO UPDATE SET state = excluded.state`, [JSON.stringify(actors)]);
}
export async function currentMap() {
  return (await pool.query('SELECT state FROM dalecrest.map WHERE id=1')).rows[0].state;
}

async function recordEvents(db, events) {
  if (!events.length) return [];
  const rated = events.map(e => ({ ...e, salience: e.salience ?? salienceOf(e) }));
  const result = await db.query(`INSERT INTO dalecrest.events(minute, kind, actor_ids, description, outcome, place, salience)
    SELECT e.minute, e.type, e."actorIds", e.text, e.outcome, e.place, e.salience FROM jsonb_to_recordset($1::jsonb)
    AS e(minute bigint, type text, "actorIds" text[], text text, outcome jsonb, place jsonb, salience smallint) RETURNING id, minute, actor_ids, description`, [JSON.stringify(rated)]);
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
      ALTER TABLE dalecrest.events ADD COLUMN IF NOT EXISTS outcome jsonb;
      ALTER TABLE dalecrest.events ADD COLUMN IF NOT EXISTS place jsonb;
      ALTER TABLE dalecrest.events ADD COLUMN IF NOT EXISTS salience smallint;
      ${requestIndexes}
      ${recordIndexes}
      ${dailySchema}
      ${civicAccountSchema}
      CREATE TABLE IF NOT EXISTS dalecrest.map (
        id integer PRIMARY KEY CHECK (id = 1), revision bigint NOT NULL, state jsonb NOT NULL
      );
      ${historySchema}
      CREATE TABLE IF NOT EXISTS dalecrest.planner_limits (
        provider text PRIMARY KEY, next_request_at timestamptz NOT NULL
      );
    `);
    await initializeTraces(db);
    // Entries recorded before the chronicle selected are rated once, by the same rules in outline.
    await db.query(`UPDATE dalecrest.events SET salience = CASE
        WHEN kind = 'meal' THEN 0
        WHEN kind IN ('plan','work','fieldnote','observation') THEN CASE WHEN outcome ? 'commitmentId' THEN 5 ELSE 1 END
        WHEN kind = 'social' THEN CASE
          WHEN outcome->>'verb' IN ('ask','accept','decline','release') THEN 6
          WHEN outcome->>'verb' IN ('kept','broken') THEN 7
          WHEN outcome->>'verb' = 'unanswered' THEN 5
          WHEN outcome->>'verb' IN ('retain','defer') THEN 2
          WHEN outcome->>'verb' IS NOT NULL THEN 3
          WHEN description LIKE '% lent % a hand %' THEN 2
          WHEN description LIKE '% discussed the dwindling %' THEN 4
          WHEN description LIKE '% divided a warm loaf%' THEN 3
          ELSE 1 END
        WHEN kind = 'village' THEN CASE WHEN outcome ? 'hearths' THEN 6 ELSE 2 END
        WHEN kind = 'civic' THEN CASE WHEN description LIKE 'Word goes round%' THEN 5 ELSE 7 END
        WHEN kind = 'build' THEN 7 WHEN kind = 'arrival' THEN 8 ELSE 4 END
      WHERE salience IS NULL`);
    await db.query(`CREATE INDEX IF NOT EXISTS events_public ON dalecrest.events (id DESC) WHERE salience >= ${PUBLIC}`);
    // Missed visits were once rated as public news. Those with no request for help riding on them are not.
    await db.query(`UPDATE dalecrest.events SET salience = ${PUBLIC - 1} WHERE salience >= ${PUBLIC} AND kind = 'social'
      AND outcome->>'delivered' = 'false' AND NOT outcome ? 'requestId'`);
    await db.query(knowledgeSchema);
    await db.query(songDraftSchema);
    await db.query(`
      CREATE OR REPLACE FUNCTION dalecrest.notify_observers() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_notify('dalecrest_village_changed', '');
        RETURN NULL;
      END;
      $$;
      ${['world', 'actors', 'map', 'events', 'civic_accounts'].map(table => `
        CREATE OR REPLACE TRIGGER notify_observers AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE
          ON dalecrest.${table} FOR EACH STATEMENT EXECUTE FUNCTION dalecrest.notify_observers();
      `).join('')}
    `);
    await db.query(`ALTER TABLE dalecrest.world ADD COLUMN IF NOT EXISTS ticks bigint NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS late_ms_max integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS clock_pace jsonb`);
    const seed = Number(process.env.VILLAGE_SEED) || DEFAULT_SEED;
    const songwriting = process.env.VILLAGE_SONGWRITING === '1';
    const stored = await db.query('SELECT state FROM dalecrest.world WHERE id=1 FOR UPDATE');
    if (stored.rowCount) {
      const pace = clockPace(stored.rows[0].state.minute, process.env);
      // Keep a running interval across a restart. If the rate changed, schedule a full new interval.
      // Time spent stopped never advances the simulation or counts as clock lateness.
      await db.query(`UPDATE dalecrest.world SET clock_pace=$1,
        next_tick=CASE WHEN next_tick <= statement_timestamp() THEN statement_timestamp()
          WHEN clock_pace IS NULL THEN least(next_tick, statement_timestamp()+make_interval(secs=>$2))
          WHEN clock_pace <> $1 THEN statement_timestamp()+make_interval(secs=>$2)
          ELSE next_tick END WHERE id=1`, [pace, pace.seconds]);
      await queueEditions(db, null, stored.rows[0].state.minute);
      const robin = (await db.query("SELECT state FROM dalecrest.actors WHERE id='robin' AND state->>'trade'='harvest'")).rows[0]?.state;
      if (robin) {
        appointReporter(robin);
        await db.query("UPDATE dalecrest.actors SET state=$1 WHERE id='robin'", [robin]);
      }
      // A village founded before the map existed keeps its residents and gains the ground under them.
      const world = stored.rows[0].state;
      if (Boolean(world.songwritingPilot) !== songwriting) {
        if (songwriting) world.songwritingPilot = true;
        else delete world.songwritingPilot;
        await db.query('UPDATE dalecrest.world SET state=$1 WHERE id=1', [world]);
      }
      if ((await db.query('SELECT id FROM dalecrest.map WHERE id=1')).rowCount) {
        // Earlier versions kept a single map. Its current revision is the first available checkpoint.
        await db.query(`INSERT INTO dalecrest.map_revisions(revision, minute, state)
          SELECT revision, $1, state FROM dalecrest.map WHERE id=1 ON CONFLICT (revision) DO NOTHING`, [world.minute]);
        return;
      }
      const actors = (await db.query('SELECT state FROM dalecrest.actors ORDER BY ordinal')).rows.map(r => r.state);
      const map = adoptVillage({ world, actors }, seed);
      await db.query('UPDATE dalecrest.world SET state=$1 WHERE id=1', [world]);
      await saveActors(db, actors);
      await saveMap(db, map, world.minute);
      await recordEvents(db, [{ minute: world.minute, type: 'village', actorIds: [], text: 'The parish was surveyed, and every lane, field and cottage of Dalecrest set down on a new map.' }]);
      return;
    }
    const village = createVillage(seed, { songwriting });
    const presence = collectPresence();
    const foundingRevision = village.map.revision;
    await saveMap(db, village.map, village.world.minute);
    if (process.env.PLANNER_PROVIDER !== 'openai') village.events.push(...stepVillage(village, { minutes: 105, observe: presence.observe }));
    await db.query('INSERT INTO dalecrest.world(id, state, clock_pace) VALUES (1, $1, $2)',
      [village.world, clockPace(village.world.minute, process.env)]);
    await saveActors(db, village.actors);
    if (village.map.revision !== foundingRevision) await saveMap(db, village.map, village.world.minute);
    await writePresence(db, presence.rows);
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

const untilNextTick = 'greatest(0, ceil(extract(epoch FROM next_tick - statement_timestamp()) * 1000))::int';

export async function nextTickDelay() {
  const { rows: [row] } = await pool.query(`SELECT ${untilNextTick} AS delay FROM dalecrest.world WHERE id=1`);
  return row?.delay ?? 1000;
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
  const { minutes } = clockPace(world.minute, process.env);
  const beforeMinute = world.minute;
  const records = [];
  const songDrafts = [];
  const village = { world, actors, map };
  if (process.env.VILLAGE_FAMILY_ARRIVALS === '1') world.familyArrivals ??= [];
  const arrivals = welcomeResidents(village, minimumResidents);
  const presence = collectPresence();
  const { events, steps } = advanceWithTraces(village, minutes, traces, direct, records, presence.observe, songDrafts);
  const chronicle = await recordEvents(db, [...arrivals, ...events]);
  await writeGoals(db, actors);
  await writeObservations(db, actors, chronicle);
  await saveActors(db, actors);
  if (map.revision !== before) await saveMap(db, map, world.minute);
  await writePresence(db, presence.rows);
  await queueEditions(db, beforeMinute, world.minute);
  await writeSteps(db, steps, chronicle, traces, world.minute);
  await writeActivities(db, records);
  await queueSongDrafts(db, songDrafts);
  const pace = clockPace(world.minute, process.env);
  // Anchor ordinary ticks to the previous deadline so sub-second intervals and incidental delays
  // do not accumulate. After a whole missed interval, schedule from now instead of racing to catch up.
  await db.query(`UPDATE dalecrest.world SET state=$1, clock_pace=$3, ticks=ticks+1,
    late_ms_max=greatest(late_ms_max, least(extract(epoch FROM now()-next_tick)*1000, 2000000000)::int),
    next_tick=CASE WHEN next_tick+make_interval(secs=>$2) > statement_timestamp()
      THEN next_tick+make_interval(secs=>$2)
      ELSE statement_timestamp()+make_interval(secs=>$2) END WHERE id=1`, [world, pace.seconds, pace]);
}

// Observers only see committed maps. Capture one map and its residents in the same database snapshot.
let observerMap = null;
export async function snapshot({ withMap = false } = {}) {
  const cached = observerMap;
  const result = await pool.query(`
    SELECT w.state AS world,
      ${withMap ? `${untilNextTick} AS "nextTickInMs", w.clock_pace AS "clockPace",
        jsonb_build_array((SELECT max(id) FROM dalecrest.events),
          (SELECT count(*) FROM dalecrest.civic_accounts WHERE account IS NOT NULL)) AS "eventVersion",
        (SELECT m.state FROM dalecrest.map m WHERE m.id=w.id AND m.revision IS DISTINCT FROM $1::bigint) AS map,` : ''}
      COALESCE((SELECT jsonb_agg(state ORDER BY ordinal) FROM dalecrest.actors), '[]'::jsonb) AS actors,
      COALESCE((SELECT jsonb_agg(to_jsonb(recent) ORDER BY recent.id DESC) FROM
        (SELECT id, minute, kind AS type, actor_ids AS "actorIds", description AS text, place, salience,
          ${eventRequestKey} AS "requestId", ${eventMootKey} AS "mootId", ${eventAccount} AS account
         FROM dalecrest.events WHERE salience >= ${PUBLIC} ORDER BY id DESC LIMIT 100) recent),'[]'::jsonb) AS events
    FROM dalecrest.world w WHERE w.id=1`, withMap ? [cached?.revision ?? null] : []);
  const state = result.rows[0];
  if (withMap) {
    const pace = state.clockPace ?? clockPace(state.world.minute, process.env);
    delete state.clockPace;
    state.tickMinutes = pace.minutes;
    state.tickMs = pace.seconds * 1000;
    state.clockPeriod = pace.period;
    state.map ??= cached;
    observerMap = state.map;
  }
  return state;
}

// LISTEN has its own session so streaming viewers never hold a connection from the query pool.
export function listenForVillageChanges(changed) {
  let connection, retry, stopped = false, backoff = 1000;
  async function connect() {
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, keepAlive: true });
    connection = db;
    function lost() {
      if (stopped || connection !== db) return;
      connection = null;
      db.end().catch(() => {});
      retry = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 10000);
    }
    db.on('error', lost);
    db.once('end', lost);
    db.on('notification', message => {
      if (connection === db && message.channel === 'dalecrest_village_changed') changed();
    });
    try {
      await db.connect();
      await db.query('LISTEN dalecrest_village_changed');
      if (!stopped && connection === db) {
        backoff = 1000;
        changed();
      }
    } catch { lost(); }
  }
  connect();
  return () => {
    stopped = true;
    clearTimeout(retry);
    connection?.end().catch(() => {});
  };
}

// The latest 100 entries of one kind, or of every kind, routine included, for the full chronicle.
export async function recentEvents(kind) {
  const { rows } = await pool.query(`SELECT id, minute, kind AS type, actor_ids AS "actorIds", description AS text, place, salience,
      ${eventRequestKey} AS "requestId", ${eventMootKey} AS "mootId", ${eventAccount} AS account
      FROM dalecrest.events WHERE ($1::text IS NULL OR kind = $1) ORDER BY id DESC LIMIT 100`, [kind || null]);
  return rows;
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

// One goal review: claimed and recorded under the clock's lock, sent without it, and applied under it
// again. Without a key nothing is sent and residents keep the goals they have.
export async function reviewGoalsOnce({ key = process.env.CLAUDE_KEY?.trim(), request = fetch, budget, model } = {}) {
  if (!key) return;
  const claim = await transaction(async db => claimReview(db, await lockedVillage(db), { budget, model }));
  if (!claim || claim.budgetLimited) return claim;
  let reply;
  try { reply = await sendReview(claim.body, key, request); }
  catch (error) {
    await pool.query("UPDATE dalecrest.goal_reviews SET status='transport_error', error='Transport failed before a reply was received.' WHERE id=$1", [claim.id]);
    throw error;
  }
  return transaction(async db => {
    const village = await lockedVillage(db);
    const settled = await settleReview(db, village, claim, reply, recordEvents);
    const actor = village.actors.find(a => a.id === claim.actorId);
    if (settled.status === 'applied' && actor) {
      await writeGoals(db, [actor]);
      await writeObservations(db, [actor]);
      await db.query('UPDATE dalecrest.actors SET state=$1 WHERE id=$2', [actor, actor.id]);
    }
    return settled;
  });
}

export async function claimAction(hourlyBudget) {
  return transaction(async db => reserveAction(db, await lockedVillage(db), hourlyBudget));
}

export async function draftSongOnce({ key = process.env.CLAUDE_KEY?.trim(), request = fetch, model = goalModel,
  budget = Number(process.env.SONG_DRAFT_TOKENS_PER_HOUR ?? 6000) } = {}) {
  if (process.env.VILLAGE_SONGWRITING !== '1' || !key || !Number.isSafeInteger(budget) || budget <= 0) return;
  const claim = await transaction(async db => claimSongDraft(db, await lockedVillage(db), { budget, model, recordEvents }));
  if (!claim) return;
  let reply;
  try { reply = await sendReview(claim.body, key, request); }
  catch (error) {
    await transaction(async db => settleSongDraft(db, await lockedVillage(db), claim, null, recordEvents));
    throw error;
  }
  return transaction(async db => settleSongDraft(db, await lockedVillage(db), claim, reply, recordEvents));
}

export async function publishCivicAccountOnce({ key = process.env.CLAUDE_KEY?.trim(), request = fetch, budget, model } = {}) {
  if (!key) return;
  const claim = await transaction(db => claimCivicAccount(db, { budget, model }));
  if (claim) await writeCivicAccount(pool, claim, key, request);
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

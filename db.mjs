import pg from 'pg';
import { createVillage, stepVillage, FOCUSES } from './sim.mjs';

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

async function recordEvents(db, events) {
  if (!events.length) return;
  await db.query(`INSERT INTO dalecrest.events(minute, kind, actor_ids, description)
    SELECT e.minute, e.type, e."actorIds", e.text FROM jsonb_to_recordset($1::jsonb)
    AS e(minute bigint, type text, "actorIds" text[], text text)`, [JSON.stringify(events)]);
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
      CREATE TABLE IF NOT EXISTS dalecrest.planner_limits (
        provider text PRIMARY KEY, next_request_at timestamptz NOT NULL
      );
    `);
    if ((await db.query('SELECT id FROM dalecrest.world WHERE id=1')).rowCount) return;
    const village = createVillage();
    village.events.push(...stepVillage(village, { minutes: 105 }));
    await db.query('INSERT INTO dalecrest.world(id, state) VALUES (1, $1)', [village.world]);
    for (const [ordinal, actor] of village.actors.entries()) {
      await db.query('INSERT INTO dalecrest.actors(id,ordinal,state) VALUES ($1,$2,$3)', [actor.id, ordinal, actor]);
    }
    await recordEvents(db, village.events);
  });
}

export async function reserveOpenAICall(seconds) {
  const result = await pool.query(`INSERT INTO dalecrest.planner_limits(provider, next_request_at)
    VALUES ('decisions', now() + make_interval(secs => $1))
    ON CONFLICT (provider) DO UPDATE SET next_request_at = excluded.next_request_at
    WHERE dalecrest.planner_limits.next_request_at <= now() RETURNING provider`, [seconds]);
  return result.rowCount === 1;
}

export async function advance() {
  return transaction(async db => {
    const result = await db.query('SELECT state FROM dalecrest.world WHERE id=1 AND next_tick <= now() FOR UPDATE SKIP LOCKED');
    if (!result.rowCount) return;
    const world = result.rows[0].state;
    const actors = (await db.query('SELECT state FROM dalecrest.actors ORDER BY ordinal')).rows.map(r => r.state);
    const events = stepVillage({ world, actors }, { minutes: 3 });
    await db.query("UPDATE dalecrest.world SET state=$1, next_tick=now()+interval '3 seconds' WHERE id=1", [world]);
    await db.query(`UPDATE dalecrest.actors a SET state = payload.actor
      FROM jsonb_array_elements($1::jsonb) AS payload(actor) WHERE a.id = payload.actor->>'id'`, [JSON.stringify(actors)]);
    await recordEvents(db, events);
  });
}

export async function snapshot() {
  const result = await pool.query(`
    SELECT w.state AS world,
      (SELECT jsonb_agg(state ORDER BY ordinal) FROM dalecrest.actors) AS actors,
      COALESCE((SELECT jsonb_agg(to_jsonb(recent) ORDER BY recent.id DESC) FROM
        (SELECT id, minute, kind AS type, actor_ids AS "actorIds", description AS text
         FROM dalecrest.events ORDER BY id DESC LIMIT 100) recent),'[]'::jsonb) AS events
    FROM dalecrest.world w WHERE w.id=1`);
  return result.rows[0];
}

export async function savePlan(actorId, basedOn, focus, reason, model, method = 'generated') {
  if (!FOCUSES.includes(focus) || !reason) return false;
  return transaction(async db => {
    const { rows } = await db.query('SELECT state FROM dalecrest.world WHERE id=1 FOR UPDATE');
    const minute = rows[0].state.minute;
    if (minute - basedOn > 120) return false;
    const actor = (await db.query('SELECT state FROM dalecrest.actors WHERE id=$1', [actorId])).rows[0]?.state;
    if (!actor || (actor.plan?.model === model && actor.plan.until > minute)) return false;
    actor.plan = { focus, reason, until: minute + 360, model, method, madeAt: minute };
    actor.lastModelPlanAt = minute;
    await db.query('UPDATE dalecrest.actors SET state=$1 WHERE id=$2', [actor, actor.id]);
    const text = method === 'choice' ? actor.name + ' prioritized ' + focus + '. ' + reason : actor.name + ' made a plan. “' + reason + '”';
    await recordEvents(db, [{ minute, type: 'plan', actorIds: [actor.id], text }]);
    return true;
  });
}

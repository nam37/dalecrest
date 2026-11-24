import pg from 'pg';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatDate } from './engine/calendar.mjs';

const days = 14;
const timeZone = 'America/New_York';
const villageDay = 1440;
const calendar = `SELECT (current_timestamp AT TIME ZONE $1)::date AS today,
    (current_timestamp AT TIME ZONE $1)::date - ($2::int - 1) AS first_day`;
const timeRange = `>= (SELECT first_day::timestamp AT TIME ZONE $1 FROM calendar)
  AND requested_at <= current_timestamp`;

export async function readAdminMetrics(db) {
  const { rows: tokens } = await db.query(`WITH calendar AS (${calendar}), charges AS (
    SELECT requested_at, 'openai' AS source, token_charge FROM dalecrest.decision_traces
      WHERE token_charge IS NOT NULL AND requested_at ${timeRange}
    UNION ALL SELECT requested_at, 'anthropic', token_charge FROM dalecrest.goal_reviews
      WHERE token_charge IS NOT NULL AND requested_at ${timeRange}
    UNION ALL SELECT requested_at, 'anthropic', token_charge FROM dalecrest.civic_accounts
      WHERE requested_at ${timeRange}
    UNION ALL SELECT requested_at, 'anthropic', token_charge FROM dalecrest.daily_model_usage
      WHERE requested_at ${timeRange}
  ), totals AS (
    SELECT (requested_at AT TIME ZONE $1)::date AS date,
      sum(token_charge) FILTER (WHERE source='openai') AS openai,
      sum(token_charge) FILTER (WHERE source='anthropic') AS anthropic
    FROM charges GROUP BY 1
  )
  SELECT (first_day + offset_days)::text AS date, first_day + offset_days = today AS partial,
    coalesce(openai,0)::float8 AS openai, coalesce(anthropic,0)::float8 AS anthropic
  FROM calendar CROSS JOIN generate_series(0,$2::int-1) AS series(offset_days)
    LEFT JOIN totals ON totals.date=first_day+offset_days ORDER BY 1`, [timeZone, days]);

  const { rows: waits } = await db.query(`WITH calendar AS (${calendar}), ordered AS (
    SELECT recorded_at, basis,
      lead(recorded_at) OVER activity AS next_at, lead(basis) OVER activity AS next_basis
    FROM dalecrest.activity_log WHERE basis IN ('waiting','fresh','standing')
      AND recorded_at >= (SELECT first_day::timestamp AT TIME ZONE $1 FROM calendar)
      AND recorded_at <= current_timestamp
    WINDOW activity AS (PARTITION BY actor_id ORDER BY id)
  ), elapsed AS (
    SELECT (recorded_at AT TIME ZONE $1)::date AS date, extract(epoch FROM next_at-recorded_at) AS seconds
    FROM ordered WHERE basis='waiting' AND next_basis IN ('fresh','standing')
  ), totals AS (
    SELECT date, count(*)::int AS count,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds) AS median,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY seconds) AS p95
    FROM elapsed GROUP BY date
  )
  SELECT (first_day + offset_days)::text AS date, first_day + offset_days = today AS partial,
    coalesce(count,0) AS count, median, p95
  FROM calendar CROSS JOIN generate_series(0,$2::int-1) AS series(offset_days)
    LEFT JOIN totals ON totals.date=first_day+offset_days ORDER BY 1`, [timeZone, days]);

  const { rows } = await db.query(`WITH bounds AS (
    SELECT (state->>'minute')::bigint / $1::int AS today,
      greatest(0, (state->>'minute')::bigint / $1::int - ($2::int-1)) AS first_day
    FROM dalecrest.world WHERE id=1
  ), starts AS (
    SELECT actor_id, (minute / $1::int)::int AS day,
      count(*) FILTER (WHERE basis='fresh')::int AS fresh,
      count(*) FILTER (WHERE basis='standing')::int AS standing
    FROM dalecrest.activity_log WHERE basis IN ('fresh','standing')
      AND minute >= (SELECT first_day * $1::int FROM bounds)
    GROUP BY 1,2
  ), residents AS (
    SELECT id, coalesce(state->>'name',id) AS name FROM dalecrest.actors
    UNION ALL SELECT DISTINCT actor_id, actor_id FROM starts
      WHERE NOT EXISTS (SELECT 1 FROM dalecrest.actors WHERE id=actor_id)
  )
  SELECT days.day::int AS day, days.day = today AS partial, id, name,
    coalesce(fresh,0) AS fresh, coalesce(standing,0) AS standing
  FROM bounds CROSS JOIN generate_series(first_day,today) AS days(day) CROSS JOIN residents
    LEFT JOIN starts ON starts.actor_id=id AND starts.day=days.day ORDER BY name,id,days.day`, [villageDay, days]);

  const activityDays = new Map();
  const actors = new Map();
  for (const { day, partial, id, name, fresh, standing } of rows) {
    if (!activityDays.has(day)) activityDays.set(day, {
      date: formatDate(day * villageDay, 'full'), label: formatDate(day * villageDay, 'short'), partial,
    });
    if (!actors.has(id)) actors.set(id, { id, name, starts: [] });
    actors.get(id).starts.push({ fresh, standing });
  }
  return { timeZone, tokens, waits, activities: { days: [...activityDays.values()], actors: [...actors.values()] } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000, statement_timeout: 3000 });
  try {
    await db.connect();
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    console.log(JSON.stringify(await readAdminMetrics(db)));
  } catch {
    console.error('Could not read the village chart data.');
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

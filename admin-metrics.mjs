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
  return { timeZone, tokens, waits, activities: { days: [...activityDays.values()], actors: [...actors.values()] },
    decisions: await readDecisionReports(db) };
}

// ------------------------------------------------------------------- decision reports
// Fixed, aggregate reports on how residents' choices were made over the last real day. They answer
// questions such as which standing-instruction rules send residents back for a fresh choice, how often
// a fresh choice repeats what just finished, how often the model's top two options were close, and
// whether an option's place in the menu changes how often it is chosen. Totals only: no request or reply.

export const decisionHours = 24;
const traceLimit = 8000;
export const closeThresholds = [0.1, 0.2, 0.3];

// A reason that names a promise is grouped with the other promises, so the table counts kinds of reason.
export const reasonGroup = reason => !reason ? '(not recorded)'
  : reason.startsWith('would run into my promise') ? 'would run into a promise' : reason;

export async function readDecisionReports(db, hours = decisionHours) {
  const { rows: reasons } = await db.query(`SELECT reason, count(*)::int AS count FROM dalecrest.activity_log
    WHERE basis='waiting' AND recorded_at > now() - make_interval(hours => $1) GROUP BY 1`, [hours]);

  // Each wait records the activity that had just finished. The fresh start after it records the choice.
  const { rows: repeats } = await db.query(`WITH steps AS (
      SELECT basis, action, recorded_at, lead(basis) OVER w AS next_basis, lead(action) OVER w AS next_action
      FROM dalecrest.activity_log WHERE basis IN ('waiting','fresh','standing')
        AND recorded_at > now() - make_interval(hours => $1 + 1)
      WINDOW w AS (PARTITION BY actor_id ORDER BY id))
    SELECT coalesce(action->>'kind', '(unknown)') AS finished, count(*)::int AS fresh,
      count(*) FILTER (WHERE action->>'kind' = next_action->>'kind'
        AND coalesce(action->>'job', action->>'target') = coalesce(next_action->>'job', next_action->>'target'))::int AS "sameAgain"
    FROM steps WHERE basis='waiting' AND next_basis='fresh' AND recorded_at > now() - make_interval(hours => $1)
    GROUP BY 1 ORDER BY 2 DESC, 1`, [hours]);

  // Only the questions part of each request is read: the menu, in the order it was offered.
  const { rows: traces } = await db.query(`SELECT t.actor_id AS id, coalesce(a.state->>'name', t.actor_id) AS name, t.choice,
      CASE WHEN strpos(t.request_body, '"questions":') > 0
        THEN substring(t.request_body from strpos(t.request_body, '"questions":')) END AS questions,
      t.response_body AS reply
    FROM dalecrest.decision_traces t LEFT JOIN dalecrest.actors a ON a.id = t.actor_id
    WHERE t.token_charge IS NOT NULL AND t.requested_at > now() - make_interval(hours => $1)
      AND t.decision_since IS NOT NULL AND t.choice IS NOT NULL AND t.response_body IS NOT NULL
    ORDER BY t.id DESC LIMIT $2`, [hours, traceLimit]);

  return { hours, ...summarizeDecisions({ reasons, repeats, traces }), truncated: traces.length === traceLimit };
}

const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const round = n => n == null ? null : Math.round(n * 1000) / 1000;

// What one stored decision says: the chosen option's place in the menu, and the gap between the
// model's two most likely options. Returns null for a record that cannot be read.
export function readTrace({ choice, questions, reply }) {
  try {
    const asked = JSON.parse('{' + questions).questions;
    const question = asked.find(q => q.name === 'next_action') ?? asked[0];
    const values = question.choices.map(c => c.value);
    const position = values.indexOf(choice) + 1;
    if (!position) return null;
    const answer = JSON.parse(reply).answers?.find(a => a?.name === question.name);
    const odds = (answer?.probabilities || []).map(p => p?.probability).filter(Number.isFinite).sort((a, b) => b - a);
    return { position, size: values.length, margin: odds.length >= 2 ? round(odds[0] - odds[1]) : null };
  } catch {
    return null;
  }
}

export function summarizeDecisions({ reasons = [], repeats = [], traces = [] }) {
  const grouped = new Map();
  for (const { reason, count } of reasons) grouped.set(reasonGroup(reason), (grouped.get(reasonGroup(reason)) || 0) + count);
  const freshReasons = [...grouped].map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

  const residents = new Map(), offered = [], chosen = [], margins = [];
  let unreadable = 0, withoutOdds = 0;
  for (const trace of traces) {
    const read = readTrace(trace);
    if (!read) { unreadable++; continue; }
    for (let i = 0; i < read.size; i++) offered[i] = (offered[i] || 0) + 1;
    chosen[read.position - 1] = (chosen[read.position - 1] || 0) + 1;
    if (!residents.has(trace.id)) residents.set(trace.id, { id: trace.id, name: trace.name, margins: [] });
    if (read.margin == null) { withoutOdds++; continue; }
    margins.push(read.margin);
    residents.get(trace.id).margins.push(read.margin);
  }
  const closeness = list => ({
    decisions: list.length,
    ...Object.fromEntries(closeThresholds.map(t => ['within' + Math.round(t * 100), list.filter(m => m <= t).length])),
    medianMargin: round(median(list)),
  });
  return {
    freshReasons,
    repeats,
    closeCalls: {
      thresholds: closeThresholds, read: traces.length - unreadable, unreadable, withoutOdds,
      all: closeness(margins),
      residents: [...residents.values()].map(({ id, name, margins: list }) => ({ id, name, ...closeness(list) }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    },
    menuPosition: offered.map((count, i) => ({ position: i + 1, offered: count, chosen: chosen[i] || 0 })),
  };
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

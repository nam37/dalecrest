// Tick timings come from the clock. Storage sizes come from a separate sampler. The health report reads both.

export const TIMING_DAYS = 30;
export const SIZE_DAYS = 35;
const SAMPLE_EVERY_MS = 10 * 60000;

// One row per real hour and phase keeps the record small however fast the clock runs.
export const telemetrySchema = `
  CREATE TABLE IF NOT EXISTS dalecrest.tick_timings (
    hour timestamptz NOT NULL, phase text NOT NULL, ticks integer NOT NULL,
    total_ms float8 NOT NULL, max_ms float8 NOT NULL, PRIMARY KEY (hour, phase)
  );
  CREATE TABLE IF NOT EXISTS dalecrest.table_sizes (
    measured_at timestamptz NOT NULL, name text NOT NULL, bytes bigint NOT NULL, row_estimate bigint,
    PRIMARY KEY (measured_at, name)
  );
`;

// Marks the end of each phase. A phase that runs more than once in a tick adds up.
export function tickTimer(now = () => performance.now()) {
  const started = now();
  let last = started;
  const phases = {};
  return {
    phases,
    mark(phase) {
      const at = now();
      phases[phase] = (phases[phase] ?? 0) + at - last;
      last = at;
    },
    total() { return now() - started; },
  };
}

export async function writeTimings(db, phases) {
  const rows = Object.entries(phases).filter(([, ms]) => Number.isFinite(ms)).map(([phase, ms]) => ({ phase, ms }));
  if (!rows.length) return;
  await db.query(`INSERT INTO dalecrest.tick_timings(hour, phase, ticks, total_ms, max_ms)
    SELECT date_trunc('hour', statement_timestamp()), p.phase, 1, p.ms, p.ms FROM jsonb_to_recordset($1::jsonb) AS p(phase text, ms float8)
    ON CONFLICT (hour, phase) DO UPDATE SET ticks = dalecrest.tick_timings.ticks + 1,
      total_ms = dalecrest.tick_timings.total_ms + excluded.total_ms,
      max_ms = greatest(dalecrest.tick_timings.max_ms, excluded.max_ms)`, [JSON.stringify(rows)]);
}

// Keep hourly samples across restarts. The database size and write-ahead log position are kept beside the tables.
export async function sampleSizes(db, { force = false } = {}) {
  const { rowCount } = await db.query(`INSERT INTO dalecrest.table_sizes(measured_at, name, bytes, row_estimate)
    SELECT statement_timestamp(), s.name, s.bytes, s.row_estimate FROM (
      SELECT c.relname::text AS name, pg_total_relation_size(c.oid) AS bytes, greatest(c.reltuples, 0)::bigint AS row_estimate
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'dalecrest' AND c.relkind IN ('r', 'p')
      UNION ALL SELECT '(database)', pg_database_size(current_database()), NULL
      UNION ALL SELECT '(log written)', pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0')::bigint, NULL) s
    WHERE $1 OR NOT EXISTS (SELECT 1 FROM dalecrest.table_sizes WHERE measured_at > statement_timestamp() - interval '1 hour')`, [force]);
  if (!rowCount) return false;
  await db.query(`DELETE FROM dalecrest.table_sizes WHERE measured_at < statement_timestamp() - make_interval(days => $1)`, [SIZE_DAYS]);
  await db.query(`DELETE FROM dalecrest.tick_timings WHERE hour < statement_timestamp() - make_interval(days => $1)`, [TIMING_DAYS]);
  return true;
}

export function startStorageSampling(db) {
  let timer, stopped = false;
  async function sample() {
    try { await sampleSizes(db); }
    catch { console.error('Table sizes could not be sampled.'); }
    if (!stopped) timer = setTimeout(sample, SAMPLE_EVERY_MS);
  }
  sample();
  return () => { stopped = true; clearTimeout(timer); };
}

const round = value => Number.isFinite(value) ? Math.round(value * 10) / 10 : null;

function summarize(rows) {
  const phases = {};
  for (const row of rows) phases[row.phase] = { meanMs: round(row.total_ms / row.ticks), maxMs: round(row.max_ms), ticks: row.ticks };
  return { ticks: phases.total?.ticks ?? 0, meanMs: phases.total?.meanMs ?? null, maxMs: phases.total?.maxMs ?? null, phases };
}

// The current and previous real hour, and the last day, each as a mean and a worst case per phase.
export async function readTickTimings(db) {
  const { rows } = await db.query(`SELECT phase, recent, sum(ticks)::int AS ticks, sum(total_ms)::float8 AS total_ms, max(max_ms)::float8 AS max_ms
    FROM (SELECT *, hour >= date_trunc('hour', statement_timestamp()) - interval '1 hour' AS recent FROM dalecrest.tick_timings
      WHERE phase <> 'sizes' AND hour >= date_trunc('hour', statement_timestamp()) - interval '23 hours') t
    GROUP BY GROUPING SETS ((phase, recent), (phase))`);
  return {
    lastTwoHours: summarize(rows.filter(row => row.recent === true)),
    lastDay: summarize(rows.filter(row => row.recent === null)),
  };
}

// The latest sample of every table, largest first, with growth per day against the oldest sample in the last week.
export async function readTableSizes(db) {
  const { rows } = await db.query(`WITH latest AS (SELECT max(measured_at) AS at FROM dalecrest.table_sizes),
      earliest AS (SELECT min(measured_at) AS at FROM dalecrest.table_sizes, latest WHERE measured_at >= latest.at - interval '7 days')
    SELECT n.name, n.bytes, n.row_estimate, o.bytes AS old_bytes, latest.at AS measured_at,
      extract(epoch FROM latest.at - earliest.at)::float8 / 86400 AS days
    FROM dalecrest.table_sizes n CROSS JOIN latest CROSS JOIN earliest
    LEFT JOIN dalecrest.table_sizes o ON o.name = n.name AND o.measured_at = earliest.at
    WHERE n.measured_at = latest.at ORDER BY n.bytes DESC`);
  if (!rows.length) return null;
  const days = rows[0].days;
  // Less than an hour apart says nothing about a day.
  const perDay = row => days >= 1 / 24 && row.old_bytes !== null ? Math.round((Number(row.bytes) - Number(row.old_bytes)) / days) : null;
  const special = name => name.startsWith('(');
  const find = name => rows.find(row => row.name === name);
  return {
    measuredAt: rows[0].measured_at.toISOString(),
    comparedOverDays: days >= 1 / 24 ? round(days) : null,
    databaseBytes: find('(database)') ? Number(find('(database)').bytes) : null,
    databaseGrowthPerDay: find('(database)') ? perDay(find('(database)')) : null,
    logWrittenPerDay: find('(log written)') ? perDay(find('(log written)')) : null,
    tables: rows.filter(row => !special(row.name)).map(row => ({
      name: row.name, bytes: Number(row.bytes), rows: row.row_estimate === null ? null : Number(row.row_estimate), growthPerDay: perDay(row),
    })),
  };
}

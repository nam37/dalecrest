import pg from 'pg';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatDate } from './engine/calendar.mjs';
import { clockPace } from './engine/clock.mjs';
import { hourlyActionBudget } from './action-turns.mjs';
import { readTickTimings, readTableSizes } from './tick-telemetry.mjs';

export function effectiveMode({ world, tickMinutes, tickMs, clockPeriod }) {
  if (tickMinutes !== 1) return null;
  if (clockPeriod === null) return tickMs === 30000 ? '1x' : tickMs === 15000 ? '2x' : null;
  const pace = clockPace(world.minute, { VILLAGE_CLOCK_MODE: 'day-night' });
  return pace.period === clockPeriod && pace.seconds * 1000 === tickMs ? 'day-night' : null;
}

export async function readAdminHealth(db, village, { revision, lastBackup } = {}) {
  const { rows: [usage] } = await db.query(`SELECT
    coalesce(sum(token_charge),0)::float8 AS tokens,
    count(*) FILTER (WHERE status IN ('requested','received'))::int AS pending,
    (SELECT greatest(0, extract(epoch FROM statement_timestamp() - next_tick) * 1000)::float8
       FROM dalecrest.world WHERE id=1) AS overdue
    FROM dalecrest.decision_traces WHERE requested_at > now()-interval '1 hour'`);
  const waiting = village.actors.filter(actor => actor.action.kind === 'waiting');
  const oldest = waiting.reduce((minute, actor) => Math.min(minute, actor.action.since ?? village.world.minute), village.world.minute);
  // A release older than the telemetry tables, or a slow catalogue, leaves these out rather than the whole report.
  const ticks = await readTickTimings(db).catch(() => null);
  const storage = await readTableSizes(db).catch(() => null);
  return {
    checkedAt: new Date().toISOString(),
    clock: {
      minute: village.world.minute,
      date: formatDate(village.world.minute, 'full'),
      mode: effectiveMode(village),
      period: village.clockPeriod ?? null,
      tickMs: village.tickMs,
      tickMinutes: village.tickMinutes,
      overdueMs: usage.overdue,
    },
    residents: village.actors.length,
    planner: { state: village.planner.state, model: village.planner.model, waiting: waiting.length,
      oldestWaitMinutes: waiting.length ? village.world.minute - oldest : null, pending: usage.pending },
    actionTokens: { used: usage.tokens, hourlyCap: hourlyActionBudget },
    deployment: { revision: revision || null, lastBackup: lastBackup || null },
    ticks,
    storage,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000, statement_timeout: 3000 });
  try {
    await db.connect();
    const response = await fetch('http://127.0.0.1:' + (process.env.PORT || 4173) + '/api/village', { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error();
    const stamp = Number(process.env.DALECREST_LAST_BACKUP || 0);
    console.log(JSON.stringify(await readAdminHealth(db, await response.json(), {
      revision: process.env.DALECREST_RELEASE,
      lastBackup: stamp > 0 ? new Date(stamp * 1000).toISOString() : null,
    })));
  } catch {
    console.error('Could not read the running village health.');
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

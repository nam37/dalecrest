const cellSize = 2;
const dayMinutes = 1440;

export const historySchema = `
  CREATE TABLE IF NOT EXISTS dalecrest.map_revisions (
    revision bigint PRIMARY KEY,
    minute bigint NOT NULL,
    state jsonb NOT NULL
  );
  CREATE TABLE IF NOT EXISTS dalecrest.resident_presence (
    actor_id text NOT NULL,
    arrived bigint NOT NULL,
    day integer NOT NULL,
    cell_x integer NOT NULL,
    cell_y integer NOT NULL,
    minutes integer NOT NULL CHECK (minutes > 0),
    first_minute bigint NOT NULL,
    last_minute bigint NOT NULL,
    PRIMARY KEY (actor_id, arrived, day, cell_x, cell_y)
  );
`;

export function collectPresence() {
  const cells = new Map();
  return {
    observe({ world: { minute }, actors, map }) {
      const day = Math.floor(minute / dayMinutes);
      for (const actor of actors) {
        const { id, position } = actor, arrived = actor.arrived ?? 0;
        const { x, y } = position ?? {};
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
        const cellX = Math.floor(x / cellSize), cellY = Math.floor(y / cellSize);
        const key = JSON.stringify([id, arrived, day, cellX, cellY]);
        let cell = cells.get(key);
        if (!cell) cells.set(key, cell = { actor_id: id, arrived, day, cell_x: cellX, cell_y: cellY, minutes: 0, first_minute: minute });
        cell.minutes++;
        cell.last_minute = minute;
      }
    },
    get rows() { return [...cells.values()]; },
  };
}

export async function writePresence(db, rows) {
  if (!rows.length) return;
  await db.query(`INSERT INTO dalecrest.resident_presence AS p (actor_id, arrived, day, cell_x, cell_y, minutes, first_minute, last_minute)
    SELECT * FROM jsonb_to_recordset($1) AS r(actor_id text, arrived bigint, day integer, cell_x integer, cell_y integer,
      minutes integer, first_minute bigint, last_minute bigint)
    ON CONFLICT (actor_id, arrived, day, cell_x, cell_y) DO UPDATE
    SET minutes=p.minutes+excluded.minutes, first_minute=least(p.first_minute, excluded.first_minute),
      last_minute=greatest(p.last_minute, excluded.last_minute)`, [JSON.stringify(rows)]);
}

export async function mapRevisions(db) {
  const { rows } = await db.query(`SELECT jsonb_build_object('revision', revision, 'minute', minute) AS frame
    FROM dalecrest.map_revisions ORDER BY revision`);
  return rows.map(row => row.frame);
}

export async function mapRevision(db, revision) {
  const { rows } = await db.query(`SELECT jsonb_build_object('revision', revision, 'minute', minute, 'map', state) AS frame
    FROM dalecrest.map_revisions WHERE revision=$1`, [revision]);
  return rows[0]?.frame;
}

export async function residentHeat(db, id, days) {
  const { rows: [row] } = await db.query(`
    WITH resident AS (
      SELECT coalesce((state->>'arrived')::bigint, 0) AS arrived FROM dalecrest.actors WHERE id=$1
    ), cells AS (
      SELECT cell_x, cell_y, sum(minutes) AS minutes, min(first_minute) AS first_minute, max(last_minute) AS last_minute
      FROM dalecrest.resident_presence
      WHERE actor_id=$1 AND arrived=(SELECT arrived FROM resident) AND ($2::integer IS NULL OR day >=
        (SELECT (state->>'minute')::bigint / ${dayMinutes} FROM dalecrest.world WHERE id=1) - $2::integer + 1)
      GROUP BY cell_x, cell_y
    )
    SELECT EXISTS (SELECT FROM resident) AS known,
      jsonb_build_object(
        'cells', coalesce(jsonb_agg(jsonb_build_array(cell_x, cell_y, minutes) ORDER BY minutes DESC, cell_x, cell_y), '[]'::jsonb),
        'minutes', coalesce(sum(minutes), 0), 'firstMinute', min(first_minute), 'lastMinute', max(last_minute)
      ) AS heat
    FROM cells`, [id, days]);
  return row.known ? { ...row.heat, cellSize } : null;
}

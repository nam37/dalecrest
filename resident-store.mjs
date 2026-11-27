// A resident's record is kept in two places. What changes from minute to minute (needs, action,
// position and the like) stays in dalecrest.actors.state, which every tick rewrites. The long lists
// (memories, goal history, observations, standing instructions, reports, the goal book and remembered
// requests) are kept one row each in dalecrest.resident_parts and written only when they change, so a
// tick no longer copies every resident's whole past.
//
// A record written whole into actors.state, by an older release or a test, still reads correctly: its
// own lists win over the stored parts, and the next write moves them out.
export const RESIDENT_PARTS = ['memories', 'goalHistory', 'observations', 'instructions', 'reports', 'goalBook', 'requestMemories'];
const PART = new Set(RESIDENT_PARTS);

export const residentPartsSchema = `
  CREATE TABLE IF NOT EXISTS dalecrest.resident_parts (
    actor_id text NOT NULL, part text NOT NULL, value jsonb NOT NULL,
    PRIMARY KEY (actor_id, part)
  );`;

// The text of each part as it was read or last written, by resident object, so a write can skip
// whatever is unchanged. A resident never read through here has every part it carries written.
const stored = new WeakMap();

// A SQL expression for a whole resident row of dalecrest.actors aliased `alias`. With `partsParam`
// (a text[] parameter such as '$2') only the named parts are joined.
export function residentJson(alias, partsParam = null) {
  return `coalesce((SELECT jsonb_object_agg(p.part, p.value) FROM dalecrest.resident_parts p
    WHERE p.actor_id = ${alias}.id${partsParam ? ` AND p.part = ANY(${partsParam}::text[])` : ''}), '{}'::jsonb) || ${alias}.state`;
}

export const hotState = actor => Object.fromEntries(Object.entries(actor).filter(([key]) => !PART.has(key)));

function assemble(state, parts) {
  const held = {};
  for (const [name, value] of Object.entries(parts)) if (PART.has(name)) held[name] = JSON.stringify(value);
  const actor = { ...parts, ...state };
  stored.set(actor, held);
  return actor;
}

// Every resident, in the village's order.
export async function readResidents(db) {
  const { rows } = await db.query(`SELECT a.state, coalesce((SELECT jsonb_object_agg(p.part, p.value)
      FROM dalecrest.resident_parts p WHERE p.actor_id = a.id), '{}'::jsonb) AS parts
    FROM dalecrest.actors a ORDER BY a.ordinal`);
  return rows.map(row => assemble(row.state, row.parts));
}
// One resident by id, or undefined. `where` adds a condition on the row `a`.
export async function readResident(db, id, { where = '' } = {}) {
  const { rows: [row] } = await db.query(`SELECT a.state, coalesce((SELECT jsonb_object_agg(p.part, p.value)
      FROM dalecrest.resident_parts p WHERE p.actor_id = a.id), '{}'::jsonb) AS parts
    FROM dalecrest.actors a WHERE a.id = $1 ${where}`, [id]);
  return row && assemble(row.state, row.parts);
}

// Writes the parts that changed since the residents were read. A part the resident no longer carries
// is removed, but only when it was read: a resident built elsewhere may simply not have loaded it.
export async function writeResidentParts(db, actors) {
  const changed = [], removed = [];
  for (const actor of actors) {
    const held = stored.get(actor), now = {};
    for (const name of RESIDENT_PARTS) {
      if (actor[name] !== undefined) {
        const text = now[name] = JSON.stringify(actor[name]);
        if (held?.[name] !== text) changed.push('{"id":' + JSON.stringify(actor.id) + ',"part":"' + name + '","value":' + text + '}');
      } else if (held && Object.hasOwn(held, name)) removed.push({ id: actor.id, part: name });
    }
    stored.set(actor, now);
  }
  if (changed.length) {
    await db.query(`INSERT INTO dalecrest.resident_parts(actor_id, part, value)
      SELECT p->>'id', p->>'part', p->'value' FROM jsonb_array_elements($1::jsonb) p
      ON CONFLICT (actor_id, part) DO UPDATE SET value = excluded.value`, ['[' + changed.join(',') + ']']);
  }
  if (removed.length) {
    await db.query(`DELETE FROM dalecrest.resident_parts r USING jsonb_to_recordset($1::jsonb) AS d(id text, part text)
      WHERE r.actor_id = d.id AND r.part = d.part`, [JSON.stringify(removed)]);
  }
  return changed.length;
}

// One resident who is already in the village.
export async function writeResident(db, actor) {
  await db.query('UPDATE dalecrest.actors SET state=$1 WHERE id=$2', [hotState(actor), actor.id]);
  await writeResidentParts(db, [actor]);
}

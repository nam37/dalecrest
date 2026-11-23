// Project the observer's account from committed events. Villager prompts never read this archive.
const pageSize = 25;
const requestKey = "coalesce(outcome->>'requestId', outcome->>'commitmentId', CASE WHEN outcome->'fact'->>'kept'='true' THEN outcome->'fact'->>'requestId' END)";
const deliveredAsk = "outcome->>'verb'='ask' AND outcome->>'delivered'='true' AND outcome->>'requestId' IS NOT NULL";

export const requestIndexes = `
  CREATE INDEX IF NOT EXISTS events_by_help_request ON dalecrest.events ((${requestKey}), id DESC)
    WHERE ${requestKey} IS NOT NULL;
  CREATE INDEX IF NOT EXISTS delivered_help_requests ON dalecrest.events (id DESC) WHERE ${deliveredAsk};
`;
export const eventRequestKey = requestKey;

const validName = value => /^[a-z0-9_-]{1,200}$/i.test(value);
export const validCursor = value => /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;

function page(rows, key) {
  const items = rows.slice(0, pageSize);
  return { items, next: rows.length > pageSize ? items.at(-1)[key] : null };
}

export async function requestArchive(db, url) {
  const id = url.pathname.slice('/api/requests'.length).replace(/^\//, '');
  const resident = url.searchParams.get('resident'), before = url.searchParams.get('before');
  if ((id && !validName(id)) || (resident !== null && !validName(resident)) || (before !== null && !validCursor(before))) {
    return { status: 400, body: { error: 'Invalid archive address.' } };
  }
  // The header and its page of events are read in one statement, even while the next village tick commits.
  const timeline = id ? `, (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id::bigint DESC) FROM (
    SELECT id::text, minute, kind, description FROM dalecrest.events
    WHERE ${requestKey}=a.request AND ($3::bigint IS NULL OR id < $3)
    ORDER BY dalecrest.events.id DESC LIMIT ${pageSize + 1}
  ) e) AS events` : '';
  const { rows } = await db.query(`
    WITH asks AS (
      SELECT id, outcome->>'requestId' AS request, outcome->'terms' AS terms, description, minute
      FROM dalecrest.events WHERE ${deliveredAsk}
        AND ($1::text IS NULL OR outcome->>'requestId'=$1)
        AND ($2::text IS NULL OR $2=ANY(actor_ids))
        AND ($1 IS NOT NULL OR $3::bigint IS NULL OR id < $3)
      ORDER BY id DESC LIMIT ${pageSize + 1}
    )
    SELECT a.id::text AS cursor, a.request AS id, a.terms->>'askerId' AS "askerId", a.terms->>'asker' AS asker,
      a.terms->>'helperId' AS "helperId", a.terms->>'helper' AS helper, a.terms->>'terms' AS terms,
      a.description AS opening, (a.terms->>'due')::bigint AS due, a.minute AS opened,
      (SELECT outcome->'terms'->>'status' FROM dalecrest.events WHERE ${requestKey}=a.request
        AND outcome->'terms'->>'status' IS NOT NULL ORDER BY id DESC LIMIT 1) AS status,
      (SELECT jsonb_build_object('id',id::text, 'minute',minute, 'description',description)
        FROM dalecrest.events WHERE ${requestKey}=a.request ORDER BY id DESC LIMIT 1) AS "lastEvent"
      ${timeline}
    FROM asks a ORDER BY a.id DESC`, [id || null, resident, before]);
  if (!id) return { status: 200, body: page(rows, 'cursor') };
  if (!rows.length) return { status: 404, body: { error: 'This request was not found.' } };
  const { events, ...request } = rows[0];
  return { status: 200, body: { request, ...page(events || [], 'id') } };
}

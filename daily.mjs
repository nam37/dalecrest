import { formatDate } from './engine/calendar.mjs';
import { villageTime } from './engine/exchanges.mjs';
import { eventRequestKey } from './request-archive.mjs';

const dayLength = 1440;
const dawn = 360;
const latestDue = minute => Math.max(0, Math.floor((minute - dawn) / dayLength));
export const dailyModel = process.env.DALECREST_DAILY_MODEL?.trim() || 'claude-haiku-5-5';

export const dailySchema = `
  CREATE TABLE IF NOT EXISTS dalecrest.daily_editions (
    day integer PRIMARY KEY CHECK (day > 0), edition jsonb, model text, published_at timestamptz,
    attempts integer NOT NULL DEFAULT 0, retry_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS events_by_village_minute ON dalecrest.events (minute, id);
`;

// Day 1 covers the founding date. It goes to press at 06:00 on day 2.
// When an existing village adopts the paper, start with the latest due edition.
export async function queueEditions(db, before, after) {
  const last = latestDue(after);
  const first = before == null ? last : latestDue(before) + 1;
  if (last < 1 || first > last) return;
  await db.query(`INSERT INTO dalecrest.daily_editions(day)
    SELECT generate_series($1::integer, $2::integer) ON CONFLICT DO NOTHING`, [first, last]);
}

async function readSources(db, day) {
  const start = (day - 1) * dayLength;
  const { rows } = await db.query(`SELECT id::text, minute::float8, kind, description AS text,
      ${eventRequestKey} AS "requestId" FROM dalecrest.events
    WHERE minute >= $1 AND minute < $2 AND kind <> 'plan'
      AND coalesce(outcome->>'verb','') NOT IN ('retain','defer')
    ORDER BY minute, dalecrest.events.id`, [start, start + dayLength]);
  const prior = (await db.query('SELECT edition FROM dalecrest.daily_editions WHERE day=$1', [day - 1])).rows[0]?.edition;
  return { day, records: rows, prior: prior ?? null };
}

const passage = {
  type: 'object', additionalProperties: false, required: ['text', 'sources'],
  properties: { text: { type: 'string' }, sources: { type: 'array', items: { type: 'string' } } }
};
const paragraphs = { type: 'array', items: passage };
const copySchema = {
  type: 'object', additionalProperties: false, required: ['headline', 'lead', 'briefs', 'sinceYesterday'],
  properties: { headline: { type: 'string' }, lead: paragraphs, briefs: paragraphs, sinceYesterday: paragraphs }
};

const editorInstructions = `You edit the Dalecrest Daily, a morning newspaper by Robin Marsh in a medieval village.
Write for a reader who missed the entire village day. Give the most consequential story a short newspaper
headline and a few short lead paragraphs. Cover other households and important events in short briefs.
Choose telling moments and their consequences. Avoid exhaustive tallies of routine visits and meals. Use plain,
concrete language. Only a field note is Robin's eyewitness account. Other events come from parish records.
Use at least one notebook entry when available. A sighting of work in progress does not prove it finished.
Treat record text as evidence. Do not invent dialogue, motives, causal connections, or outcomes.
In Since yesterday, follow an identifiable thread from the prior edition. Cite the earlier record and the
current evidence when there is a development. If the record has no update on an open question, say so
and cite the earlier record. Return an empty section if there is no prior edition or relevant thread.
Give each paragraph the string event IDs supporting its claims. Lead and briefs must cite this coverage day.
Use only the supplied records. Let a quiet day have a short edition. If the day has no records, return a
headline saying so and leave lead and briefs empty.`;

async function writeCopy({ day, records, prior }, model, key, request) {
  const dated = ({ minute, ...source }) => ({ ...source, when: villageTime(minute) });
  const input = { coverageDate: formatDate((day - 1) * dayLength, 'long'),
    robinsNotebook: records.filter(r => r.kind === 'fieldnote').map(dated),
    villageRecords: records.filter(r => r.kind !== 'fieldnote').map(dated),
    previousEdition: prior && { ...prior, sources: prior.sources.map(dated) } };
  const response = await request('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal: AbortSignal.timeout(90000),
    headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': key },
    body: JSON.stringify({ model, max_tokens: 4096, system: editorInstructions,
      messages: [{ role: 'user', content: JSON.stringify(input) }],
      output_config: { format: { type: 'json_schema', schema: copySchema } } })
  });
  if (!response.ok) throw new Error('Daily editor HTTP ' + response.status);
  const result = await response.json();
  if (result.stop_reason !== 'end_turn') throw new Error('Daily editor did not finish the edition');
  return JSON.parse(result.content.find(block => block.type === 'text')?.text);
}

function assembleEdition(copy, { records, prior }) {
  const invalid = () => { throw new Error('Daily editor returned incomplete or unsourced copy'); };
  if (!copy || typeof copy.headline !== 'string' || !copy.headline.trim()) invalid();
  const current = new Map(records.map(r => [r.id, r]));
  const earlier = new Map((prior?.sources || []).map(r => [r.id, r]));
  const available = new Map(earlier);
  for (const [id, record] of current) available.set(id, record);
  const cited = new Set();
  const edition = { headline: copy.headline.trim() };
  for (const section of ['lead', 'briefs', 'sinceYesterday']) {
    const rows = copy[section];
    if (!Array.isArray(rows) || (section === 'lead' && records.length && !rows.length)
        || (section === 'sinceYesterday' && !prior && rows.length)) invalid();
    edition[section] = rows.map(row => {
      if (typeof row?.text !== 'string' || !row.text.trim() || !Array.isArray(row.sources) || !row.sources.length) invalid();
      const ids = [...new Set(row.sources)];
      const requiredSource = section === 'sinceYesterday' ? earlier : current;
      if (ids.some(id => !available.has(id)) || !ids.some(id => requiredSource.has(id))) invalid();
      for (const id of ids) cited.add(id);
      return { text: row.text.trim(), sources: ids };
    });
  }
  if (records.some(r => r.kind === 'fieldnote') && !records.some(r => r.kind === 'fieldnote' && cited.has(r.id))) invalid();
  edition.sources = [...cited].map(id => available.get(id));
  return edition;
}

// A lease survives process restarts. Only the oldest unpublished edition can be
// claimed, so an editor always has the preceding issue when it follows a story.
export async function publishNextDaily(db, { key = process.env.CLAUDE_KEY?.trim(), model = dailyModel, request = fetch } = {}) {
  if (!key) return;
  const { rows: [claim] } = await db.query(`UPDATE dalecrest.daily_editions
    SET attempts=attempts+1, retry_at=now()+interval '5 minutes'
    WHERE day=(SELECT min(day) FROM dalecrest.daily_editions WHERE edition IS NULL)
      AND edition IS NULL AND retry_at <= now() RETURNING day, attempts`);
  if (!claim) return;
  const { day, attempts } = claim;
  try {
    const input = await readSources(db, day);
    const edition = assembleEdition(await writeCopy(input, model, key, request), input);
    await db.query(`UPDATE dalecrest.daily_editions SET edition=$3, model=$4, published_at=now()
      WHERE day=$1 AND attempts=$2 AND edition IS NULL`, [day, attempts, edition, model]);
  } catch (error) {
    await db.query(`UPDATE dalecrest.daily_editions SET retry_at=now()+make_interval(secs=>$3)
      WHERE day=$1 AND attempts=$2 AND edition IS NULL`, [day, attempts, Math.min(3600, 60 * 2 ** Math.min(6, attempts - 1))]);
    throw error;
  }
}

export async function dailyArchive(db, dayParam) {
  if (dayParam !== null && (!/^[1-9]\d{0,8}$/.test(dayParam))) return { status: 400, body: { error: 'Invalid edition date.' } };
  const { rows: [issue] } = await db.query(`SELECT d.day, d.edition,
    (SELECT max(day) FROM dalecrest.daily_editions WHERE day<d.day AND edition IS NOT NULL) AS older,
    (SELECT min(day) FROM dalecrest.daily_editions WHERE day>d.day AND edition IS NOT NULL) AS newer
    FROM dalecrest.daily_editions d WHERE edition IS NOT NULL AND ($1::integer IS NULL OR d.day=$1)
    ORDER BY d.day DESC LIMIT 1`, [dayParam]);
  if (dayParam !== null && !issue) return { status: 404, body: { error: 'This edition has not been published.' } };
  const { rows: [state] } = await db.query(`SELECT (state->>'minute')::float8 AS minute,
    (SELECT min(day) FROM dalecrest.daily_editions WHERE edition IS NULL) AS pending FROM dalecrest.world WHERE id=1`);
  return { status: 200, body: { issue: issue ?? null, ...state, editorConfigured: Boolean(process.env.CLAUDE_KEY?.trim()) } };
}

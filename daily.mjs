import { formatDate } from './engine/calendar.mjs';
import { eventRequestKey } from './request-archive.mjs';

const dayLength = 1440;
const dawn = 360;
const latestDue = minute => Math.max(0, Math.floor((minute - dawn) / dayLength));
const outputTokenLimit = 8192;
export const dailyModel = process.env.DALECREST_DAILY_MODEL?.trim() || 'claude-sonnet-5-5';

export const dailySchema = `
  CREATE TABLE IF NOT EXISTS dalecrest.daily_editions (
    day integer PRIMARY KEY CHECK (day > 0), edition jsonb, model text, published_at timestamptz,
    attempts integer NOT NULL DEFAULT 0, retry_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS dalecrest.daily_model_usage (
    day integer NOT NULL, attempt integer NOT NULL, requested_at timestamptz NOT NULL,
    token_charge integer NOT NULL CHECK (token_charge > 0), PRIMARY KEY (day, attempt, requested_at)
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

// The archive's own housekeeping is worded like village news. The paper does not report it or follow it up.
const housekeeping = record => record.kind === 'village' && record.text.startsWith('The parish was surveyed');
function coverable(prior) {
  const dropped = new Set((prior?.sources || []).filter(housekeeping).map(r => r.id));
  if (!dropped.size) return prior;
  const keep = rows => rows.filter(row => !row.sources.some(id => dropped.has(id)));
  return { ...prior, headline: prior.lead.length === keep(prior.lead).length ? prior.headline : undefined,
    lead: keep(prior.lead), briefs: keep(prior.briefs), sinceYesterday: keep(prior.sinceYesterday),
    sources: prior.sources.filter(r => !dropped.has(r.id)) };
}

// The village keeps no clocks. The editor is told when a thing happened as a neighbour would say it.
const hours = [[4, 'in the small hours'], [6, 'before dawn'], [9, 'early in the morning'], [12, 'in the middle of the morning'],
  [14, 'around midday'], [17, 'in the afternoon'], [21, 'in the evening'], [24, 'late at night']];
const partOfDay = minute => hours.find(([until]) => Math.floor(minute / 60) % 24 < until)[1];

const passage = {
  type: 'object', additionalProperties: false, required: ['text', 'sources'],
  properties: { text: { type: 'string' }, sources: { type: 'array', items: { type: 'string' } } }
};
const paragraphs = { type: 'array', items: passage };
const copySchema = {
  type: 'object', additionalProperties: false, required: ['headline', 'lead', 'briefs', 'sinceYesterday'],
  properties: { headline: { type: 'string' }, lead: paragraphs, briefs: paragraphs, sinceYesterday: paragraphs }
};

const editorInstructions = `You are Robin Marsh, who writes the Dalecrest Daily, the morning newspaper of a
medieval village, and who cannot believe his luck at being paid to notice things. Write for a neighbour who
missed the whole of the day and wants to enjoy hearing about it.

Voice. Robin delights in particulars and catalogues the day with relish, as a keen diarist does. No detail of
a neighbour's work is too small for him, and he would sooner include one than leave it out. Let him be warm,
curious and dry by turns. He may pass a remark, admire a piece of work, notice a pattern across the day, or
admit to being pleased or puzzled, and he may say "I". Such remarks are his opinions and must read as his.
Find fresh turns of phrase in each edition and do not repeat a joke. Gather small doings into paragraphs with
shape and rhythm, and vary the sentences. Never write like a clerk or a log, and never pad: a quiet day gets
a short edition that enjoys the little there is.

Truth. Every fact Robin states must come from the supplied records. Do not invent speech, motives, causes,
outcomes, weather, or anything else a record does not say. That covers small things too: how well a job was
done, how long it took, what came before it, and what it led to. His pleasure goes into how he tells a thing
and what he thinks of it, never into added detail. "I hear" and "I am told" introduce only what a record says. A sighting of work in progress does not prove it
was finished. robinsNotebook holds what Robin saw for himself, and he may say he saw it. villageRecords are
things he has on good report: he must not say or imply that he watched them, and his remarks on them are
remarks on what he has heard. Two records are connected only if one of them says so. Say when a thing
happened only as its record's "when" gives it. Never mention records, sources or IDs in the prose, and never remark on what
is not known or apologise for a gap.

Shape. Give the best story of the day a short newspaper headline and a few lead paragraphs. Put the other
households and doings in briefs. Use at least one notebook entry when there is one. In sinceYesterday, pick
up an identifiable thread from previousEdition. Where it has moved on, cite the earlier record and the new
one. Where it has gone quiet, Robin may say in a line that he is still watching it, and cite the earlier
record. Leave sinceYesterday empty if there is no previous edition or no thread worth following.

Give each paragraph the string event IDs that support its facts. Lead and briefs must cite records from this
coverage day. If the day has no records, return a headline saying so and leave lead and briefs empty.`;

async function writeCopy({ day, records, prior }, model, key, request, recordUsage) {
  const dated = ({ minute, ...source }) => ({ ...source, when: formatDate(minute, 'day') + ', ' + partOfDay(minute) });
  const input = { coverageDate: formatDate((day - 1) * dayLength, 'long'),
    robinsNotebook: records.filter(r => r.kind === 'fieldnote').map(dated),
    villageRecords: records.filter(r => r.kind !== 'fieldnote').map(dated),
    previousEdition: prior && { ...prior, sources: prior.sources.map(dated) } };
  const response = await request('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal: AbortSignal.timeout(120000),
    headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': key },
    body: JSON.stringify({ model, max_tokens: outputTokenLimit, system: editorInstructions,
      messages: [{ role: 'user', content: JSON.stringify(input) }],
      output_config: { format: { type: 'json_schema', schema: copySchema } } })
  });
  if (!response.ok) throw new Error('Daily editor HTTP ' + response.status);
  const result = await response.json();
  const usage = result.usage || {};
  const tokens = (usage.input_tokens || 0) + (usage.output_tokens || 0)
    + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
  if (recordUsage && Number.isSafeInteger(tokens) && tokens > 0) await recordUsage(tokens);
  if (result.stop_reason !== 'end_turn') throw new Error(`Daily editor did not finish the edition (${result.stop_reason})`);
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

// Writes one edition from a day's records and the edition before it.
export async function composeEdition(sources, { key, model = dailyModel, request = fetch, recordUsage }) {
  const input = { ...sources, records: sources.records.filter(r => !housekeeping(r)), prior: coverable(sources.prior) };
  return assembleEdition(await writeCopy(input, model, key, request, recordUsage), input);
}

// A lease survives process restarts. Only the oldest unpublished edition can be
// claimed, so an editor always has the preceding issue when it follows a story.
export async function publishNextDaily(db, { key = process.env.CLAUDE_KEY?.trim(), model = dailyModel, request = fetch } = {}) {
  if (!key) return;
  const { rows: [claim] } = await db.query(`UPDATE dalecrest.daily_editions
    SET attempts=attempts+1, retry_at=now()+interval '5 minutes'
    WHERE day=(SELECT min(day) FROM dalecrest.daily_editions WHERE edition IS NULL)
      AND edition IS NULL AND retry_at <= now() RETURNING day, attempts, clock_timestamp() AS requested_at`);
  if (!claim) return;
  const { day, attempts } = claim;
  try {
    const edition = await composeEdition(await readSources(db, day), { key, model, request,
      recordUsage: tokens => db.query(`INSERT INTO dalecrest.daily_model_usage(day,attempt,requested_at,token_charge)
        VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [day, attempts, claim.requested_at, tokens]),
    });
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
  const { rows: [issue] } = await db.query(`SELECT d.day, d.edition, d.model,
    (SELECT max(day) FROM dalecrest.daily_editions WHERE day<d.day AND edition IS NOT NULL) AS older,
    (SELECT min(day) FROM dalecrest.daily_editions WHERE day>d.day AND edition IS NOT NULL) AS newer
    FROM dalecrest.daily_editions d WHERE edition IS NOT NULL AND ($1::integer IS NULL OR d.day=$1)
    ORDER BY d.day DESC LIMIT 1`, [dayParam]);
  if (dayParam !== null && !issue) return { status: 404, body: { error: 'This edition has not been published.' } };
  const { rows: [state] } = await db.query(`SELECT (state->>'minute')::float8 AS minute,
    (SELECT min(day) FROM dalecrest.daily_editions WHERE edition IS NULL) AS pending FROM dalecrest.world WHERE id=1`);
  return { status: 200, body: { issue: issue ?? null, ...state, editorConfigured: Boolean(process.env.CLAUDE_KEY?.trim()) } };
}

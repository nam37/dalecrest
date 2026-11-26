import { placeName } from './sim.mjs';
import { PUBLIC } from './engine/chronicle.mjs';
import { childView } from './engine/children.mjs';
import { songManuscript } from './engine/songwriting.mjs';
import { eventAccount } from './civic-accounts.mjs';
import { eventRequestKey, validCursor } from './request-archive.mjs';
import { readRobinEntries } from './robin-journal.mjs';
import { dayLink, housing, householdLink, mootLink, residentLink, validRecordMinute } from './public/record-links.js';

export const eventMootKey = "outcome->>'mootId'";
export const recordIndexes = `
  CREATE INDEX IF NOT EXISTS events_by_moot ON dalecrest.events ((${eventMootKey}), id)
    WHERE kind='civic' AND ${eventMootKey} IS NOT NULL;`;
const dayMinutes = 1440;
const activityLimit = 20;
const result = (record, path) => ({ status: 200, body: { ...record, path } });
const missing = noun => ({ status: 404, body: { error: 'This ' + noun + ' could not be found.' } });

async function directory(db, mootId = '') {
  const { rows: [row] } = await db.query(`
    SELECT (w.state->>'minute')::float8 AS minute, w.state->'departed' AS departed,
      coalesce((SELECT max(id)::text FROM dalecrest.events), '0') AS cursor,
      w.state->'coldHearths' AS cold, w.state->'cottages' AS cottages, w.state->'moot' AS moot,
      (SELECT state->'songwriting' FROM dalecrest.actors WHERE id='robin') AS songwriting,
      (SELECT sitting FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.state->'mootHistory')='array'
        THEN w.state->'mootHistory' ELSE '[]'::jsonb END) sitting WHERE sitting->>'id'=$1) AS "closedMoot",
      m.state->'places' AS places,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', state->'name', 'role', state->'role',
        'home', state->'home', 'arrived', state->'arrived', 'born', state->'born', 'backstory', state->'backstory',
        'action', jsonb_build_object('label', state->'action'->'label', 'phase', state->'action'->'phase',
          'target', state->'action'->'target')) ORDER BY ordinal) FROM dalecrest.actors), '[]'::jsonb) AS actors,
      coalesce((SELECT jsonb_agg(jsonb_build_object('minute', minute, 'text', description,
        'actorIds', actor_ids, 'outcome', outcome, 'account', ${eventAccount}) ORDER BY id)
        FROM dalecrest.events WHERE kind='civic' AND ${eventMootKey}=$1 AND $1<>''), '[]'::jsonb) AS "mootEvents"
    FROM dalecrest.world w JOIN dalecrest.map m ON m.id=w.id WHERE w.id=1`, [mootId]);
  return row;
}

const former = person => ({
  id: person.id, name: person.name, role: person.role, home: person.home, arrived: person.arrived,
  left: person.minute, how: person.how, age: person.age,
});

function residentOf(village, id, { lifetime, at, latest = false } = {}) {
  const living = village.actors.find(a => a.id === id);
  const old = (village.departed ?? []).filter(a => a.id === id).map(former);
  const current = living && { ...living, arrived: living.arrived ?? 0 };
  if (at != null) {
    return old.find(p => p.left >= at && (p.arrived == null || p.arrived <= at)) ??
      (current?.arrived <= at ? current : null);
  }
  if (latest) return current ?? old.at(-1);
  if (lifetime?.startsWith('left-')) return old.find(p => p.left === Number(lifetime.slice(5)));
  const arrived = Number(lifetime ?? 0);
  return current?.arrived === arrived ? current : old.find(p => p.arrived === arrived);
}

const house = (village, id) => {
  const site = village.places.find(p => p.id === id && housing(p.kind));
  return site && { id, name: placeName(site, village.actors), kind: site.kind, path: householdLink(id) };
};

function residentRecord(village, ref, params) {
  const at = params.get('at');
  if (at !== null && !validRecordMinute(at)) return { status: 400, body: { error: 'Invalid village time.' } };
  const person = residentOf(village, ref.id, { lifetime: ref.lifetime, at: at === null ? null : Number(at),
    latest: !ref.lifetime && params.get('latest') === '1' });
  if (!person) return missing('resident');
  return result({ person, minute: village.minute, household: house(village, person.home) }, residentLink(person));
}

async function robinJournal(db, village, person, before) {
  if (person.id !== 'robin' || person.arrived !== 0) return null;
  const song = person.left == null ? village.songwriting : village.departed?.find(resident =>
    resident.id === person.id && resident.minute === person.left)?.songwriting;
  if (!song) return null;
  const through = person.left ?? village.minute;
  const day = Math.floor(through / dayMinutes);
  const firstDay = Math.max(Math.floor(song.since / dayMinutes), day - 6);
  const { rows: [journal] } = await db.query(`WITH entries AS (
      SELECT id, minute, description, outcome#>>'{song,status}' AS status FROM dalecrest.events
      WHERE kind='song' AND actor_ids @> ARRAY['robin'] AND outcome#>>'{song,lifetime}'='0' AND minute >= $1
    ) SELECT
      coalesce((SELECT jsonb_agg(jsonb_build_object('minute', minute, 'text', description) ORDER BY id DESC)
        FROM (SELECT * FROM entries ORDER BY id DESC LIMIT 14) recent), '[]'::jsonb) AS entries,
      (SELECT count(DISTINCT minute / ${dayMinutes})::int FROM entries
        WHERE minute >= $2 AND status IN ('session', 'no_material', 'stale_session')) AS "composingDays",
      coalesce((SELECT jsonb_agg(jsonb_build_object('minute', applied_minute, 'text', statement) ORDER BY applied_minute DESC)
        FROM (SELECT applied_minute, statement FROM dalecrest.goal_reviews
          WHERE actor_id='robin' AND applied_minute BETWEEN $1 AND $3 AND statement IS NOT NULL
            AND result->'applied' @> '[{"goal":"songwriting"}]'::jsonb
          ORDER BY applied_minute DESC LIMIT 4) intentions), '[]'::jsonb) AS intentions`,
    [song.since, firstDay * dayMinutes, through]);
  const { rows: archived } = await db.query(`SELECT outcome#>'{song,manuscript}' AS manuscript
    FROM dalecrest.events WHERE kind='song' AND actor_ids @> ARRAY['robin'] AND minute BETWEEN $1 AND $2
      AND outcome#>>'{song,lifetime}'='0' AND outcome#>>'{song,manuscript,status}'='finished'
    ORDER BY (outcome#>>'{song,manuscript,closedAt}')::bigint DESC, id DESC`, [song.since, through]);
  const catalog = archived.map(row => row.manuscript);
  const original = song.status === 'finished' && !song.archived && songManuscript(song);
  if (original) catalog.unshift(original);
  const cited = [...new Set([song, ...catalog].flatMap(draft => draft.verses.flatMap(verse => verse.sources.map(source => source.key))))];
  const evidence = new Map();
  if (cited.length) {
    const { rows } = await db.query(`SELECT o.actor_id || ':' || o.seq AS key, e.id::text AS id,
        CASE WHEN e.kind='fieldnote' THEN e.description END AS note, e.salience >= ${PUBLIC} AS public
      FROM dalecrest.observations o JOIN dalecrest.events e ON e.id=o.event_id
      WHERE o.actor_id='robin' AND o.seq=ANY($1::int[]) AND (e.salience >= ${PUBLIC} OR e.kind='fieldnote')`,
    [cited.map(key => Number(key.split(':')[1]))]);
    for (const item of rows) evidence.set(item.key, item);
  }
  const sourced = verses => verses.map(verse => ({ ...verse, sources: verse.sources.map(source => {
    const item = evidence.get(source.key);
    return { ...source, ...(item?.public && { href: dayLink(source.minute) + '#event-' + item.id }),
      ...(item?.note && { note: item.note }) };
  }) }));
  const daily = await readRobinEntries(db, person.left ?? day * dayMinutes - 1, before);
  return { title: song.title ?? null, status: song.status, verses: sourced(song.verses), windowDays: day - firstDay + 1,
    catalog: catalog.map(draft => ({ ...draft, verses: sourced(draft.verses) })), ...journal, ...daily };
}

function householdRecord(village, id) {
  const household = house(village, id);
  if (!household) return missing('household');
  const site = village.places.find(p => p.id === id);
  const residents = village.actors.filter(p => p.home === id).map(p => ({ name: p.name, role: p.role, born: p.born, path: residentLink(p) }));
  const cottage = village.cottages?.[id];
  const children = (cottage?.children ?? []).map(child => {
    const { name, born, action } = childView(child, id, village.minute);
    const at = action && village.places.find(place => place.id === action.target);
    return { name, born, ...(child.id && { id: child.id }),
      ...(action && { activity: action.label, travelling: action.phase === 'travelling', location: at && placeName(at, village.actors) }) };
  });
  const stores = cottage && { wood: cottage.woodpile, bread: cottage.larder, allowance: cottage.ration };
  return result({ household, stage: site.stage, minute: village.minute, residents, children, stores,
    cold: (village.cold ?? []).includes(id) }, household.path);
}

function mootRecord(village, id) {
  const at = Number(id.slice(5));
  const live = village.moot?.at === at ? village.moot : null;
  const saved = village.closedMoot, records = village.mootEvents;
  if (!live && !saved && !records.length) return missing('moot');
  const resolutions = records.filter(r => r.outcome?.civic === 'resolution');
  const settled = resolutions[0]?.outcome;
  const close = records.find(r => r.outcome?.civic === 'closing' || /^(Only \d+ came to the hall|The moot met at the hall)/.test(r.text));
  const closedAt = saved?.closedAt ?? resolutions[0]?.minute ?? close?.minute;
  const quorum = saved?.quorum ?? live?.quorum ?? settled?.quorum ?? close?.outcome.quorum;
  const attendees = saved?.attendees ?? live?.attendees ?? settled?.attendees ?? close?.actorIds ?? [];
  const items = (saved?.items ?? (live ? live.agenda ?? [] : resolutions.map(r => r.outcome))).map(item => {
    const key = item.key ?? item.proposalKey;
    const report = resolutions.find(r => r.outcome.proposalKey === key);
    const votes = saved?.ballots ?? live?.ballots ?? report?.outcome.ballots ?? [];
    return { key, title: item.title, status: item.status, reason: item.reason, support: item.support, oppose: item.oppose,
      abstain: item.abstain, missing: item.missing, account: report?.account,
      votes: votes.filter(v => v.proposalKey === key).map(v => ({ id: v.actorId, choice: v.choice })) };
  });
  const postponed = (quorum != null && attendees.length < quorum) || items.length && items.every(item => item.status === 'postponed');
  const status = saved?.status ?? close?.outcome.status ?? (live ? (live.agenda ? 'sitting' : 'scheduled') :
    closedAt == null ? 'recorded' : postponed ? 'postponed' : 'resolved');
  return result({ at, closedAt, quorum, status, items,
    attendees: attendees.map(actorId => participant(village, actorId, closedAt ?? village.minute)),
    notes: records.filter(r => !['ballot', 'resolution'].includes(r.outcome?.civic)).map(r => r.text) }, mootLink(id));
}

function participant(village, id, at) {
  const person = residentOf(village, id, { at });
  return { id, name: person?.name ?? id, path: person ? residentLink(person) : null };
}

async function villageDay(db, day) {
  const from = (day - 1) * dayMinutes;
  const { rows: [row] } = await db.query(`
    SELECT floor((w.state->>'minute')::bigint / ${dayMinutes})::int + 1 AS current,
      w.state->'departed' AS departed,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', state->'name', 'arrived', state->'arrived')), '[]'::jsonb)
        FROM dalecrest.actors) AS actors,
      EXISTS(SELECT FROM dalecrest.daily_editions WHERE day=$1 AND edition IS NOT NULL) AS edition,
      coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.minute, e.id::bigint) FROM (
        SELECT id::text, minute, kind AS type, description AS text, actor_ids AS "actorIds", ${eventRequestKey} AS "requestId",
          ${eventMootKey} AS "mootId", ${eventAccount} AS account FROM dalecrest.events
        WHERE minute >= $2 AND minute < $3 AND (salience >= ${PUBLIC} OR outcome ? 'lesson' OR outcome ? 'chore')
      ) e), '[]'::jsonb) AS events
    FROM dalecrest.world w WHERE w.id=1 AND (w.state->>'minute')::bigint >= $2`, [day, from, from + dayMinutes]);
  if (!row) return missing('village day');
  const events = row.events.map(({ actorIds, ...event }) => ({
    ...event, people: actorIds.map(id => participant(row, id, event.minute)).filter(person => person.path),
  }));
  return result({ day, current: row.current, edition: row.edition, events }, dayLink(from));
}

async function activitySince(db, record, { after, before }) {
  const { person, household, cursor } = record;
  const scope = person
    ? 'actor_ids @> ARRAY[$4::text] AND minute >= $5 AND ($6::bigint IS NULL OR minute <= $6)'
    : "place->>'id'=$4 AND (kind IN ('life','build','village') OR outcome ? 'chore')";
  const bounds = person ? [person.id, person.arrived ?? 0, person.left ?? null] : [household.id];
  // Use the same high-water mark as the record. A tick committed between the reads belongs to the next visit.
  const { rows } = await db.query(`
    SELECT id::text, minute, description AS text, outcome->>'life' AS life
    FROM dalecrest.events
    WHERE (salience >= ${PUBLIC} OR outcome ? 'chore' OR outcome ? 'lesson')
      AND id > $1 AND id <= $2 AND ($3::bigint IS NULL OR id < $3) AND ${scope}
    ORDER BY dalecrest.events.id DESC LIMIT ${activityLimit + 1}`, [after, cursor, before, ...bounds]);
  const items = rows.slice(0, activityLimit);
  return { items, next: rows.length > activityLimit ? items.at(-1).id : null };
}

export async function recordPage(db, ref, params) {
  if (ref.kind === 'days') return villageDay(db, Number(ref.id));
  const village = await directory(db, ref.kind === 'moots' ? ref.id : '');
  if (ref.kind === 'moots') return mootRecord(village, ref.id);
  const after = params.get('after'), before = params.get('before');
  if ((after !== null && after !== '0' && !validCursor(after)) ||
      (before !== null && (after === null || !validCursor(before)))) {
    return { status: 400, body: { error: 'Invalid update address.' } };
  }
  const record = ref.kind === 'residents' ? residentRecord(village, ref, params) : householdRecord(village, ref.id);
  if (record.status !== 200) return record;
  if (record.body.person) {
    const before = params.get('journalBefore');
    if (before !== null && !validRecordMinute(before)) return { status: 400, body: { error: 'Invalid Journal date.' } };
    const journal = await robinJournal(db, village, record.body.person, before === null ? null : Number(before));
    if (journal) record.body.journal = journal;
  }
  record.body.cursor = village.cursor;
  if (after !== null) record.body.activity = await activitySince(db, record.body, { after, before });
  return record;
}

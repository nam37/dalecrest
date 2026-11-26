import { PUBLIC } from './engine/chronicle.mjs';
import { dayLink } from './public/record-links.js';

const DAY = 1440;
const pageDays = 7;
const songwriting = {
  session: 'I worked on my song on the green.',
  started: 'I started a new song on the green.',
  no_material: 'I spent time writing on the green. The session yielded no verse.',
  interrupted: 'I put down my writing to attend the moot.',
  verse: 'I added a verse to my song.',
  revised: 'I revised the last verse.',
  finished: 'I finished my song.',
  set_aside: 'I set my draft aside.',
};

function journalLine(row) {
  const { id, minute, kind, text, detail, public: linked } = row;
  const source = { label: { note: 'Field note', song: 'Writing record', choice: 'Activity choice', words: 'Goal review', eveningPlan: 'Evening plan' }[kind], text,
    ...(linked && { href: dayLink(minute) + '#event-' + id }) };
  if (kind === 'words') return { minute, kind, text, source };
  if (kind === 'eveningPlan') return { minute, kind, text, plannedFor: Number(detail), source };
  if (kind === 'song' && songwriting[detail]) return { minute, kind, detail, text: songwriting[detail], source };
  if (kind === 'note') {
    if (text.includes(', Robin saw ')) return { minute, kind, text: text.replace(', Robin saw ', ', I saw '), source };
    if (text.startsWith('Robin finished a round at ')) return { minute, kind, kindOfNote: 'round', text: text.replace(/^Robin /, 'I '), source };
  }
  if (kind === 'choice') {
    const outing = /^(Gathering news at |Visiting )(.+)$/.exec(text);
    if (outing) return { minute, kind, detail, text: (detail === 'report' ? 'I set out to gather news at ' : 'I set out to visit ') + outing[2] + '.', source };
    if (detail === 'meeting') return { minute, kind, detail, text: 'I set out for the moot.', source };
    if (detail === 'compose') return { minute, kind, detail, text: 'I chose to work on my song.', source };
  }
  return null;
}

// Choose a few distinct records for each day. Summaries describe recorded acts. Only a saved,
// published statement appears as a quotation from Robin.
export function journalEntries(records) {
  const days = new Map();
  for (const row of records) {
    const line = journalLine(row);
    if (!line) continue;
    const day = Math.floor(line.minute / DAY);
    if (!days.has(day)) days.set(day, new Map());
    const lines = days.get(day);
    const key = line.kind + ':' + (line.plannedFor ?? '') + ':' + line.text;
    if (!lines.has(key)) lines.set(key, line);
  }
  return [...days].sort(([a], [b]) => b - a).map(([day, recorded]) => {
    const lines = [...recorded.values()];
    const starting = lines.some(line => line.kind === 'song' && line.detail === 'started');
    const songs = lines.filter(line => line.kind === 'song' && (!starting || line.detail !== 'session')).slice(-2);
    const notes = lines.filter(line => line.kind === 'note' && line.kindOfNote !== 'round').slice(0, 2);
    const rounds = notes.length ? [] : lines.filter(line => line.kindOfNote === 'round').slice(0, 1);
    const choices = lines.filter(line => line.kind === 'choice' && (!notes.length || line.detail !== 'report') &&
      (!songs.length || line.detail !== 'compose'));
    const meeting = choices.find(line => line.detail === 'meeting');
    const selected = (meeting ? [meeting, ...choices.filter(line => line !== meeting)] : choices).slice(0, notes.length ? 1 : 2);
    const words = lines.filter(line => line.kind === 'words').slice(-2);
    const plans = lines.filter(line => line.kind === 'eveningPlan');
    return { minute: day * DAY, lines: [...notes, ...rounds, ...selected, ...songs, ...words, ...plans].sort((a, b) => a.minute - b.minute) };
  });
}

export async function readRobinEntries(db, through, before) {
  const lastDay = Math.min(Math.floor(through / DAY), before == null ? Infinity : before - 1);
  if (lastDay < 0) return { days: [], olderBefore: null };
  const firstDay = Math.max(0, lastDay - pageDays + 1);
  const end = Math.min(through + 1, (lastDay + 1) * DAY);
  const { rows } = await db.query(`SELECT id, minute::float8, kind, text, detail, public FROM (
      SELECT id::text, minute, CASE kind WHEN 'fieldnote' THEN 'note' ELSE 'song' END AS kind,
        description AS text, outcome#>>'{song,status}' AS detail, salience >= ${PUBLIC} AS public
      FROM dalecrest.events WHERE minute >= $1 AND minute < $2 AND actor_ids @> ARRAY['robin']
        AND (kind='fieldnote' OR (kind='song' AND outcome#>>'{song,lifetime}'='0'
          AND outcome#>>'{song,status}'=ANY($3::text[])))
      UNION ALL
      SELECT id::text, minute, 'choice', action->>'label', action->>'kind', false
      FROM dalecrest.activity_log WHERE actor_id='robin' AND basis='fresh' AND minute >= $1 AND minute < $2
        AND action->>'kind' IN ('report','social','meeting','compose') AND action->>'label' IS NOT NULL
      UNION ALL
      SELECT statement_event_id::text, applied_minute, 'words', statement, null, true
      FROM dalecrest.goal_reviews WHERE actor_id='robin' AND status='applied'
        AND applied_minute >= $1 AND applied_minute < $2 AND statement IS NOT NULL AND statement_event_id IS NOT NULL
      UNION ALL
      SELECT id::text, minute, 'eveningPlan', outcome#>>'{eveningPlan,text}', outcome#>>'{eveningPlan,startsAt}', false
      FROM dalecrest.events WHERE minute >= $1 AND minute < $2 AND kind='plan' AND actor_ids @> ARRAY['robin']
        AND outcome ? 'eveningPlan'
    ) evidence ORDER BY minute, kind, id`, [firstDay * DAY, end, Object.keys(songwriting)]);
  return { days: journalEntries(rows), olderBefore: firstDay || null };
}

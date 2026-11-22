// The live readout. For each stage of the roadmap, the "Done when" measures that the village's own
// records can answer, read from PostgreSQL and marked against their targets. It reads only.
//   node --env-file=.env readout.mjs [real hours to look back, default 168] [--json]
// On the server, where the image holds the root modules but not tools/:
//   docker exec dalecrest-app node readout.mjs
// It reads the village DATABASE_URL names. tools/pilot-report.mjs has Stage 0 in more detail.
//
// A line is "met" or "not met" when the record settles it, "no data" when the window holds nothing to
// count, and "needs a viewer" or "see note" where the measure is not in the database at all.
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { formatDate } from './engine/calendar.mjs';
import { PUBLIC } from './engine/chronicle.mjs';
import { ALLOWANCE, MEAL_FLOOR } from './engine/storehouse.mjs';
import { goalBudget } from './goal-reviews.mjs';

// The village's hourly ceiling on action tokens, as action-turns.mjs sets it.
export const ACTION_CEILING = 480000;
const DAY = 1440;

// A sentence with its names and numbers taken out, so "Mabel took a loaf" and "Hugh took a loaf" count
// together. The same rule as tools/year.mjs.
export const shape = text => text.replace(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, 'X').replace(/\d+/g, 'N').slice(0, 80);

// Loaves a chronicle sentence says left the storehouse or the oven for a resident.
export function loavesIn(text) {
  const n = text.match(/drew (\d+) loaves at the storehouse/);
  if (n) return Number(n[1]);
  if (/drew (the household’s|a) loaf at the storehouse/.test(text) || /took a loaf from the (common oven|bakehouse)/.test(text)) return 1;
  return 0;
}

// Real seconds between ticks, by the rule db.mjs uses for the server this runs beside.
export function tickSeconds(env = process.env) {
  const set = Number(env.VILLAGE_SECONDS_PER_MINUTE);
  const pace = set > 0 ? set : env.PLANNER_PROVIDER === 'openai' ? 30 : 1;
  return Math.max(1, Math.round(3 / pace)) * pace;
}

const num = v => v == null ? null : Number(v);
const per = (n, d) => d > 0 ? n / d : null;
const fixed = (v, places = 1) => v == null || !Number.isFinite(v) ? '—' : v.toFixed(places);
const line = (what, value, target, verdict, note) => ({ what, value, target, verdict, ...(note && { note }) });

export async function readout(db, { hours = 168, tick = tickSeconds() } = {}) {
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const all = async (sql, args = []) => (await db.query(sql, args)).rows;

  // A database the current server has not yet started on lacks the newer records.
  const missing = (await all(`SELECT need FROM unnest($1::text[]) need
    WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='dalecrest' AND table_name || '.' || column_name = need)`,
  [['world.ticks', 'activity_log.basis', 'decision_traces.token_charge', 'goal_reviews.token_charge', 'goal_versions.status', 'goal_chain.trace_id', 'observations.details', 'events.salience']])).map(r => r.need);
  if (missing.length) throw new Error('This database predates the records the readout reads (' + missing.join(', ') + '). Start the current server on it once to bring it up to date.');
  const world = await one(`SELECT (state->>'minute')::bigint AS minute, (state->>'allowanceSince')::bigint AS allowance_since,
    ticks, late_ms_max, (SELECT count(*)::int FROM dalecrest.actors) AS residents FROM dalecrest.world WHERE id=1`);
  if (!world) throw new Error('This database holds no village.');
  const now = Number(world.minute), residents = world.residents;

  // The window is the last so many real hours. Activity rows carry the real time, so they say which
  // village minutes those hours covered. A village with no activity log is read over its whole record.
  const span = await one(`SELECT min(minute) AS first, count(*)::int AS n,
      extract(epoch FROM max(recorded_at) - min(recorded_at)) / 3600 AS real_hours
    FROM dalecrest.activity_log WHERE recorded_at > now() - make_interval(hours => $1)`, [hours]);
  const logged = span.n > 0;
  const from = logged ? Number(span.first) : 0;
  const days = Math.max(1 / DAY, (now - from) / DAY);
  const since = 'now() - make_interval(hours => $1)';

  // ---------------------------------------------------------------- Stage 0
  const basis = Object.fromEntries((await all(`SELECT basis, count(*)::int AS n FROM dalecrest.activity_log
    WHERE recorded_at > ${since} GROUP BY basis`, [hours])).map(r => [r.basis, r.n]));
  const fresh = basis.fresh || 0, standing = basis.standing || 0, started = fresh + standing;
  const freshPerDay = logged ? per(fresh, residents * days) : null;
  const unbased = await one(`SELECT count(*)::int AS n FROM dalecrest.activity_log
    WHERE basis IN ('fresh','standing') AND trace_id IS NULL AND recorded_at > ${since}`, [hours]);
  const stale = await one(`SELECT count(*)::int AS n FROM dalecrest.activity_log s
    WHERE s.basis='standing' AND s.recorded_at > ${since} AND EXISTS (
      SELECT 1 FROM dalecrest.activity_log e WHERE e.basis='instruction_ended' AND e.actor_id=s.actor_id
        AND e.trace_id=s.trace_id AND e.routine IS NOT DISTINCT FROM s.routine AND e.id < s.id)`, [hours]);
  const wait = await one(`WITH ordered AS (
      SELECT basis, recorded_at, lead(recorded_at) OVER w AS next_at
      FROM dalecrest.activity_log WHERE basis IN ('waiting','fresh','standing') WINDOW w AS (PARTITION BY actor_id ORDER BY id))
    SELECT count(*)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY s) AS median,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY s) AS p95, max(s) AS longest
    FROM (SELECT extract(epoch FROM next_at - recorded_at) AS s FROM ordered
      WHERE basis='waiting' AND next_at IS NOT NULL AND recorded_at > ${since}) w`, [hours]);
  const lateS = Number(world.late_ms_max) / 1000;
  const stage0 = [
    line('Real hours of activity in the window', fixed(num(span.real_hours)), '168, a full pilot week',
      // The first and last rows of a week's window fall a little inside it.
      !logged ? 'no data' : num(span.real_hours) >= 167 ? 'met' : 'not met'),
    line('Latest any tick has run', fixed(lateS) + ' s', 'no more than one tick, ' + tick + ' s',
      world.ticks > 0 ? (lateS <= tick ? 'met' : 'not met') : 'no data', 'Since counting began, not only in the window.'),
    line('Activities started on a stale instruction', String(stale.n), '0', logged ? (stale.n === 0 ? 'met' : 'not met') : 'no data'),
    line('Activities started with no recorded exchange', String(unbased.n), '0', logged ? (unbased.n === 0 ? 'met' : 'not met') : 'no data'),
    line('Share of activities that needed a fresh choice', started ? fixed(100 * fresh / started, 0) + '%' : '—', 'known',
      started ? 'met' : 'no data', started ? fresh + ' fresh, ' + standing + ' standing, ' + (basis.waiting || 0) + ' waits' : null),
    line('Fresh choices per resident per village day', fixed(freshPerDay), '5 to 10 in the plan’s estimate',
      freshPerDay == null ? 'no data' : 'see note', 'The estimate is not a target. Stage 3 asks that this rise.'),
    line('Real wait for a fresh choice', wait.n ? 'median ' + fixed(num(wait.median), 0) + ' s, 95th percentile ' + fixed(num(wait.p95), 0)
      + ' s, longest ' + fixed(num(wait.longest), 0) + ' s' : '—', 'known', wait.n ? 'met' : 'no data'),
  ];

  // ---------------------------------------------------------------- Stage 1 and spending
  const verbs = Object.fromEntries((await all(`SELECT outcome->>'verb' AS verb, count(*)::int AS n FROM dalecrest.events
    WHERE minute >= $1 AND kind='social' AND outcome->>'verb' IN ('ask','accept','decline','unanswered','kept','broken','release')
    GROUP BY 1`, [from])).map(r => [r.verb, r.n]));
  const ended = (verbs.kept || 0) + (verbs.broken || 0) + (verbs.release || 0);
  const shortMornings = await one(`SELECT count(*)::int AS counts, count(DISTINCT minute / ${DAY})::int AS days,
      coalesce(string_agg(DISTINCT a, ', '), '') AS who
    FROM dalecrest.events, unnest(actor_ids) a
    WHERE minute >= $1 AND kind='observation' AND (outcome->>'flour')::numeric > 0 AND (outcome->>'wood')::numeric = 0`, [from]);
  const actionSpend = await one(`SELECT coalesce(sum(token_charge), 0)::bigint AS tokens, count(*)::int AS requests,
      count(*) FILTER (WHERE status='applied')::int AS applied,
      coalesce(sum(token_charge) FILTER (WHERE status<>'applied'), 0)::bigint AS unapplied
    FROM dalecrest.decision_traces WHERE decision_since IS NOT NULL AND requested_at > ${since}`, [hours]);
  const actionPeak = await one(`SELECT max(s)::bigint AS peak FROM (SELECT sum(token_charge) OVER (ORDER BY requested_at
      RANGE BETWEEN interval '1 hour' PRECEDING AND CURRENT ROW) AS s
    FROM dalecrest.decision_traces WHERE decision_since IS NOT NULL AND token_charge IS NOT NULL AND requested_at > ${since}) x`, [hours]);
  const tokens = Number(actionSpend.tokens);
  const stage1 = [
    line('Requests for help asked', String(verbs.ask || 0), 'known', (verbs.ask || 0) ? 'met' : 'no data',
      (verbs.ask || 0) ? fixed(per(verbs.ask, days), 2) + ' a village day' : null),
    line('How requests ended', ['kept', 'broken', 'release', 'decline', 'unanswered'].map(v => (verbs[v] || 0) + ' ' + (v === 'release' ? 'released' : v === 'decline' ? 'declined' : v)).join(', '),
      'known', ended + (verbs.decline || 0) + (verbs.unanswered || 0) ? 'met' : 'no data'),
    line('Oven counts that found flour and no firewood', shortMornings.counts + ' on ' + shortMornings.days + ' days',
      'at least one, unscripted', shortMornings.counts ? 'met' : 'not met', shortMornings.who ? 'Counted by ' + shortMornings.who + '.' : null),
    line('Action tokens', tokens + ' on ' + actionSpend.requests + ' requests, ' + actionSpend.applied + ' applied',
      'known', actionSpend.requests ? 'met' : 'no data', actionSpend.requests
        ? Number(actionSpend.unapplied) + ' tokens went on replies never applied. ' + fixed(per(tokens, days), 0) + ' a village day.'
          + (ended ? ' ' + fixed(per(tokens, ended), 0) + ' per request that ended kept, broken or released.' : '') : null),
    line('Most action tokens in any rolling hour', String(num(actionPeak.peak) ?? '—'), 'under ' + ACTION_CEILING,
      actionPeak.peak == null ? 'no data' : Number(actionPeak.peak) <= ACTION_CEILING ? 'met' : 'not met'),
  ];

  // ---------------------------------------------------------------- Stage 2
  const reviews = await one(`SELECT count(*)::int AS n, count(*) FILTER (WHERE applied_minute IS NOT NULL)::int AS applied,
      coalesce(sum(token_charge), 0)::bigint AS tokens, count(statement_event_id)::int AS words
    FROM dalecrest.goal_reviews WHERE requested_at > ${since}`, [hours]);
  const reviewPeak = await one(`SELECT max(s)::bigint AS peak FROM (SELECT sum(token_charge) OVER (ORDER BY requested_at
      RANGE BETWEEN interval '1 hour' PRECEDING AND CURRENT ROW) AS s
    FROM dalecrest.goal_reviews WHERE token_charge IS NOT NULL AND requested_at > ${since}) x`, [hours]);
  const settled = Object.fromEntries((await all(`SELECT status, count(*)::int AS n FROM dalecrest.goal_versions
    WHERE settled_minute >= $1 GROUP BY status`, [from])).map(r => [r.status, r.n]));
  const revised = await one(`SELECT count(*)::int AS n, count(*) FILTER (WHERE about IS NOT NULL)::int AS about_others
    FROM dalecrest.goal_versions WHERE review_id IS NOT NULL AND since_minute >= $1`, [from]);
  const chain = await one(`SELECT count(DISTINCT trace_id)::int AS choices, count(DISTINCT outcome_event_id)::int AS outcomes
    FROM dalecrest.goal_chain WHERE observed_minute >= $1`, [from]);
  const settledCount = Object.values(settled).reduce((s, n) => s + n, 0);
  const stage2 = [
    line('Goal reviews', reviews.n + ', ' + reviews.applied + ' applied', 'known', reviews.n ? 'met' : 'no data',
      reviews.n ? fixed(per(reviews.n, residents * days), 2) + ' per resident per village day, '
        + fixed(per(Number(reviews.tokens), reviews.n), 0) + ' tokens each.' : null),
    line('Most review tokens in any rolling hour', String(num(reviewPeak.peak) ?? '—'), 'under ' + goalBudget,
      reviewPeak.peak == null ? 'no data' : Number(reviewPeak.peak) <= goalBudget ? 'met' : 'not met'),
    line('Goals the engine settled from the record', Object.entries(settled).map(([s, n]) => n + ' ' + s).join(', ') || '0',
      'at least one', settledCount ? 'met' : 'no data'),
    line('Goal versions written by reviews', revised.n + ', ' + revised.about_others + ' about another resident', 'at least one',
      revised.n ? 'met' : 'no data'),
    line('Choices traceable from an observation through a goal', chain.choices + ', reaching ' + chain.outcomes + ' outcomes',
      'at least one', chain.choices ? 'met' : 'no data'),
    line('Sentences published in a resident’s own words', String(reviews.words), 'known', reviews.n ? 'met' : 'no data'),
  ];

  // ---------------------------------------------------------------- Stage 3
  const publicRows = await all(`SELECT description FROM dalecrest.events WHERE minute >= $1 AND salience >= ${PUBLIC}`, [from]);
  const counts = new Map();
  for (const r of publicRows) counts.set(shape(r.description), (counts.get(shape(r.description)) || 0) + 1);
  const [topText, topN] = [...counts].sort((a, b) => b[1] - a[1])[0] || ['', 0];
  const topShare = per(topN, publicRows.length);
  const hearths = await one(`SELECT count(*)::int AS mornings, coalesce(sum((outcome->>'hearths')::int - (outcome->>'lit')::int), 0)::int AS cold
    FROM dalecrest.events WHERE minute >= $1 AND kind='village' AND outcome ? 'hearths' AND (outcome->>'lit')::int < (outcome->>'hearths')::int`, [from]);
  const lives = Object.fromEntries((await all(`SELECT coalesce(outcome->>'life', '') AS life, count(*)::int AS n FROM dalecrest.events
    WHERE minute >= $1 AND kind='life' GROUP BY 1`, [from])).map(r => [r.life, r.n]));
  const ill = await all(`SELECT outcome->>'cause' AS cause, count(*)::int AS n FROM dalecrest.events
    WHERE minute >= $1 AND kind='life' AND outcome->>'life'='ill' GROUP BY 1 ORDER BY 2 DESC`, [from]);
  const needs = await one(`SELECT avg((state#>>'{needs,hunger}')::numeric) AS hunger, avg((state#>>'{needs,cold}')::numeric) AS cold,
    count(*) FILTER (WHERE state ? 'illness' AND state->'illness' <> 'null'::jsonb)::int AS ill FROM dalecrest.actors`);
  const stage3 = [
    line('Real tradeoffs per resident per village day', fixed(freshPerDay), 'risen since Stage 0',
      freshPerDay == null ? 'no data' : 'see note', 'Counted as fresh choices, as Stage 0 counts them. Compare windows before and after a release.'),
    line('Commonest sentence in the public chronicle', topN ? fixed(100 * topShare) + '% of ' + publicRows.length : '—', 'no more than 10%',
      topN ? (topShare <= 0.1 ? 'met' : 'not met') : 'no data', topN ? '“' + topText + '”' : null),
    line('Mornings a hearth went cold', hearths.mornings + ', ' + hearths.cold + ' cold hearths in all', 'known', 'met'),
    line('Illness', ill.map(r => r.n + ' from ' + r.cause).join(', ') || '0', 'known', 'met',
      (lives.recovered || 0) + ' recovered, ' + (lives.left || 0) + ' left, ' + (lives.died || 0) + ' died. ' + needs.ill + ' ill now.'),
    line('Average hunger and cold now', fixed(num(needs.hunger), 0) + ' and ' + fixed(num(needs.cold), 0), 'known', 'met'),
  ];

  // ---------------------------------------------------------------- Stage 3a
  const allowanceFrom = world.allowance_since == null ? null : Math.max(from, Number(world.allowance_since));
  let loaves = 0;
  if (allowanceFrom != null) {
    for (const r of await all(`SELECT description FROM dalecrest.events WHERE minute >= $1
      AND (description LIKE '%at the storehouse%' OR description LIKE '%took a loaf from the%')`, [allowanceFrom])) loaves += loavesIn(r.description);
  }
  const breadDays = allowanceFrom == null ? 0 : Math.max(1 / DAY, (now - allowanceFrom) / DAY);
  const loafRate = allowanceFrom == null ? null : per(loaves, residents * breadDays);
  const early = await one(`SELECT count(*)::int AS n, min((state_at_application#>>'{needs,hunger}')::numeric) AS lowest
    FROM dalecrest.decision_traces WHERE status='applied' AND applied_minute >= $1
      AND state_at_application#>>'{action,kind}' = 'food' AND (state_at_application#>>'{needs,hunger}')::numeric < $2`, [from, MEAL_FLOOR]);
  // A household runs short when the children go without or a house wakes cold. The storehouse runs short
  // on a day someone found its shelves bare, or the keeper counted too little bread.
  const shortDays = await all(`SELECT DISTINCT minute / ${DAY} AS day FROM dalecrest.events
    WHERE minute >= $1 AND kind='village' AND (outcome ? 'hungry' OR (outcome ? 'hearths' AND (outcome->>'lit')::int < (outcome->>'hearths')::int))`, [from]);
  const bare = new Set((await all(`SELECT DISTINCT minute / ${DAY} AS day FROM dalecrest.observations
    WHERE minute >= $1 AND details->>'shortage'='bread'`, [from])).map(r => Number(r.day)));
  const householdOnly = new Set(shortDays.map(r => Number(r.day)).filter(d => !bare.has(d)));
  const split = allowanceFrom == null || !logged ? null : await one(`SELECT
      count(*) FILTER (WHERE basis='fresh' AND minute < $1)::int AS before_n, count(*) FILTER (WHERE basis='fresh' AND minute >= $1)::int AS after_n,
      min(minute) FILTER (WHERE minute < $1) AS before_from, count(DISTINCT actor_id) FILTER (WHERE minute < $1)::int AS before_who,
      count(DISTINCT actor_id) FILTER (WHERE minute >= $1)::int AS after_who
    FROM dalecrest.activity_log`, [Number(world.allowance_since)]);
  const beforeRate = split?.before_n ? per(split.before_n, split.before_who * (Number(world.allowance_since) - Number(split.before_from)) / DAY) : null;
  const afterRate = split?.after_n ? per(split.after_n, split.after_who * (now - Number(world.allowance_since)) / DAY) : null;
  const stage3a = [
    line('Loaves drawn per resident per village day', fixed(loafRate, 2), '1 to 1.5', loafRate == null ? 'no data'
      : loafRate >= 1 && loafRate <= 1.5 ? 'met' : 'not met', 'The allowance is ' + ALLOWANCE + ' a grown resident and a loaf for each child old enough to eat.'),
    line('Meals chosen at a hunger under ' + MEAL_FLOOR, String(early.n), '0', logged ? (early.n === 0 ? 'met' : 'not met') : 'no data',
      early.n ? 'The lowest was ' + fixed(num(early.lowest), 0) + '.' : null),
    line('Days a household ran short while the storehouse did not', String(householdOnly.size), 'at least one',
      householdOnly.size ? 'met' : 'no data', 'A cold house or an empty larder, on a day nobody found the storehouse short of bread.'),
    line('A viewer can tell from the storehouse what is short', '—', 'yes', 'needs a viewer'),
    line('Fresh choices per resident per village day, before and after the allowance', fixed(beforeRate) + ' and ' + fixed(afterRate),
      'known', beforeRate != null && afterRate != null ? 'met' : 'no data', 'Over the whole activity log, not only the window.'),
  ];

  return {
    window: { hours, fromMinute: from, toMinute: now, villageDays: days, logged, residents },
    stages: [
      { stage: '0', title: 'Liveness and meaningful choices', lines: stage0 },
      { stage: '1', title: 'The promise pilot, and what it cost', lines: stage1 },
      { stage: '2', title: 'Goals and memory', lines: stage2 },
      { stage: '3', title: 'A village with stakes', lines: stage3 },
      { stage: '3a', title: 'The common store', lines: stage3a },
    ],
  };
}

// The readout as plain text, one stage at a time.
export function readoutText(report, formatDate = m => 'minute ' + m) {
  const { window: w } = report, out = [];
  out.push('Dalecrest live readout · last ' + w.hours + ' real hours');
  out.push(w.logged ? 'Village ' + formatDate(w.fromMinute) + ' to ' + formatDate(w.toMinute) + ' · ' + w.villageDays.toFixed(2) + ' village days · ' + w.residents + ' residents'
    : 'No activity was logged in these hours, so the village’s whole record is read · ' + w.residents + ' residents');
  const mark = { met: 'met', 'not met': 'NOT MET', 'no data': 'no data', 'needs a viewer': 'viewer', 'see note': 'note' };
  for (const s of report.stages) {
    out.push('', 'Stage ' + s.stage + ' · ' + s.title);
    for (const l of s.lines) {
      out.push('  [' + mark[l.verdict].padEnd(7) + '] ' + l.what + ': ' + l.value + '  (target: ' + l.target + ')');
      if (l.note) out.push('            ' + l.note);
    }
  }
  const tally = report.stages.flatMap(s => s.lines).reduce((t, l) => ({ ...t, [l.verdict]: (t[l.verdict] || 0) + 1 }), {});
  out.push('', Object.entries(tally).map(([k, n]) => n + ' ' + k).join(' · '));
  return out.join('\n');
}

// Run directly, it prints the readout for the village DATABASE_URL names.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to the village database to measure.');
  const hours = Number(process.argv.slice(2).find(a => /^\d+(\.\d+)?$/.test(a))) || 168;
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const report = await readout(db, { hours });
    console.log(process.argv.includes('--json') ? JSON.stringify(report, null, 2) : readoutText(report, m => formatDate(m, 'short')));
  } finally {
    await db.end();
  }
}

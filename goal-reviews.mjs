// Goal reviews. When a resident needs direction, has seen a goal settled, or has learned something
// consequential, the general-purpose model reviews their goals: it keeps, revises or retires each one
// and may set a new one, citing the observations and evidence it rests on. The engine checks every
// decision before it applies it. Between reviews, and whenever the model is unavailable, the resident
// keeps the goals they had. Reviews have their own spending cap, so they never take turns from action
// choices. See design decision 14 and Stage 2 of docs/roadmap.md.
import { locationsOf } from './sim.mjs';
import { recall, memoryKey, remember } from './engine/memory.mjs';
import { activeGoals, applyReview, reviewInput, screenStatement } from './engine/goals.mjs';
import { acceptEveningPlan, offerEveningPlan, songwritingContext } from './engine/songwriting.mjs';
import { villageTime } from './engine/exchanges.mjs';
import { r2 } from './engine/geom.mjs';

export const goalModel = process.env.DALECREST_GOAL_MODEL?.trim() || 'claude-haiku-5-5';
export const goalBudget = Number(process.env.GOAL_REVIEW_TOKENS_PER_HOUR || 30000);
const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

const condition = {
  type: 'object', additionalProperties: false, required: ['type', 'item', 'atLeast', 'place', 'job', 'count', 'requestId', 'withinHours'],
  properties: { type: { type: 'string', enum: ['none', 'store', 'reach', 'work', 'commitment'] }, item: { type: 'string' }, atLeast: { type: 'integer' },
    place: { type: 'string' }, job: { type: 'string' }, count: { type: 'integer' }, requestId: { type: 'string' }, withinHours: { type: 'integer' } },
};
export const reviewSchema = {
  type: 'object', additionalProperties: false, required: ['decisions', 'statement'],
  properties: {
    decisions: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['action', 'goalId', 'text', 'kind', 'focus', 'about', 'condition', 'evidence'],
      properties: { action: { type: 'string', enum: ['keep', 'revise', 'retire', 'new'] }, goalId: { type: 'string' }, text: { type: 'string' },
        kind: { type: 'string', enum: ['condition', 'evidence'] }, focus: { type: 'string', enum: ['work', 'social', 'rest', 'food'] },
        about: { type: 'string' }, condition, evidence: { type: 'array', items: { type: 'string' } } } } },
    statement: { type: 'string' },
  },
};

const eveningPlanSchema = {
  ...reviewSchema, required: [...reviewSchema.required, 'eveningPlan'],
  properties: { ...reviewSchema.properties, eveningPlan: {
    type: 'object', additionalProperties: false, required: ['evening', 'statement'],
    properties: { evening: { type: 'string', enum: ['none', 'today', 'tomorrow'] }, statement: { type: 'string' } },
  } },
};

export const reviewInstructions = `You keep the personal goals of one resident of Dalecrest, a medieval English village in
1312. You are told who they are, the goals they hold, how any goals settled since their last review ended, the
memories that bear on them, the recorded evidence about any neighbour a goal concerns, and why this review was called.

Decide for every goal in force whether to keep, revise or retire it, and whether to set a new one. Make one decision
per goal in force, plus at most two new goals. No more than four goals may be in force afterwards.

Two kinds of goal:
- "condition": something the village record can settle. Give a condition from the vocabulary: "store" (item,
  atLeast, withinHours), "reach" (place id, withinHours), "work" (job, count of finished shifts, withinHours) or
  "commitment" (requestId of one of their open requests). withinHours is a whole number from 1 to 96.
- "evidence": what the resident wants that only evidence can inform, such as earning a neighbour's trust. Its
  condition has type "none".
A goal about another resident gives that resident's id in "about". To revise or retire a goal about another
resident, cite in "evidence" the keys of the observations or evidence it rests on. Cite only keys you are given.

For "keep" and "retire", give the goal's goalId and leave text empty. For "revise", give the goalId and the new
words. For "new", leave goalId empty. Unused fields are empty strings or 0.

The goals are the resident's own: true to their role, temperament and circumstances, and grounded in what they
know. Do not assume events the input does not record. Keep a goal that still serves them; change it only for a
reason in the input.

"statement" is one plain sentence in the resident's own voice about the most important change, as they might say
it to a neighbour, without modern idiom. It is published under their name as what they say they intend. Leave it
empty if nothing changed.`;

const eveningPlanInstructions = `

Robin can also make one personal plan to work on his current song on the green after his rounds.
In "eveningPlan", choose one of the offered evenings and give one plain first-person sentence beginning with "I".
Use the given dates and write what he means to do, in his own words. He can make this plan even when all his goals stay the same.
When he has no particular intention to write on an offered evening, use "none" and an empty sentence.
The plan is a personal intention that can give way to something more pressing.`;

// The memories a review is shown: what bears on the people the resident's goals concern and on the
// resident's own place, and what matters most.
function recalledForReview(actor, minute) {
  const people = [...new Set([...activeGoals(actor).map(g => g.about), actor.spouse].filter(Boolean))];
  return recall(actor, { minute, people, place: actor.home, limit: 10 });
}

// Under the clock's lock: picks the resident whose review has waited longest, if the hour's cap allows,
// and records the request before it is sent. Returns { id, body } or nothing.
export async function claimReview(db, village, { budget = goalBudget, model = goalModel } = {}) {
  const due = village.actors.filter(a => a.reviewDue).sort((a, b) => a.reviewDue.since - b.reviewDue.since);
  if (!due.length) return null;
  const { rows: [spend] } = await db.query(`SELECT coalesce(sum(token_charge),0)::int AS spent FROM dalecrest.goal_reviews
    WHERE token_charge IS NOT NULL AND requested_at > now() - interval '1 hour'`);
  if (spend.spent >= budget) return { budgetLimited: true };
  const { rows } = await db.query(`SELECT DISTINCT ON (actor_id) actor_id, status, observed_minute,
      requested_at > now() - interval '10 minutes' AS recent FROM dalecrest.goal_reviews
    WHERE actor_id = ANY($1) ORDER BY actor_id, id DESC`, [due.map(a => a.id)]);
  const last = new Map(rows.map(r => [r.actor_id, r]));
  const names = locationsOf(village.map, village.actors);
  for (const actor of due) {
    const prior = last.get(actor.id);
    if (prior?.status === 'requested' && prior.recent) continue;
    // A review that failed for this same call waits ten minutes before it is tried again.
    if (prior && prior.status !== 'applied' && Number(prior.observed_minute) >= actor.reviewDue.since && prior.recent) continue;
    const recalled = recalledForReview(actor, village.world.minute);
    const input = reviewInput(actor, village, names, recalled);
    const songwriting = songwritingContext(actor, village.world);
    if (songwriting) input.songwriting = songwriting;
    const planOffer = offerEveningPlan(actor, village.world);
    if (planOffer) input.eveningsForWriting = planOffer.evenings.map(({ evening, startsAt, expiresAt }) => ({
      evening, canStartFrom: villageTime(startsAt), lastStartBefore: villageTime(expiresAt),
    }));
    const offered = [...recalled.map(m => memoryKey(actor, m)), ...input.evidence.map(e => e.key)];
    const body = JSON.stringify({ model, max_tokens: 4096, system: reviewInstructions + (planOffer ? eveningPlanInstructions : ''),
      messages: [{ role: 'user', content: JSON.stringify(input) }],
      output_config: { format: { type: 'json_schema', schema: planOffer ? eveningPlanSchema : reviewSchema } } });
    const estimate = Math.ceil(Buffer.byteLength(body) / 3) + 600;
    if (spend.spent + estimate > budget) return { budgetLimited: true };
    const { rows: [made] } = await db.query(`INSERT INTO dalecrest.goal_reviews(actor_id,observed_minute,why,model,request_body,offered,token_charge)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [actor.id, village.world.minute, actor.reviewDue.why, model, body, offered, estimate]);
    return { id: made.id, body, actorId: actor.id, since: actor.reviewDue.since, planOffer };
  }
  return null;
}

// Sends a recorded request. Never stores or echoes the key.
export async function sendReview(body, key, request = fetch) {
  const response = await request(MESSAGES_URL, {
    method: 'POST', signal: AbortSignal.timeout(90000),
    headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': key }, body,
  });
  const text = await response.text();
  return { status: response.status, body: text.includes(key) ? text.replaceAll(key, '[credential redacted]') : text };
}

// Reads the model's reply: the review it returned, the tokens it cost, or why it is unusable.
export function readReply(reply) {
  if (reply.status < 200 || reply.status >= 300) return { status: 'http_error', error: 'Goal model HTTP ' + reply.status };
  let parsed;
  try { parsed = JSON.parse(reply.body); } catch { return { status: 'invalid', error: 'Reply was not JSON' }; }
  const u = parsed.usage || {};
  const tokens = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  if (parsed.stop_reason === 'refusal') return { status: 'refused', error: 'The goal model declined', tokens };
  if (parsed.stop_reason !== 'end_turn') return { status: 'invalid', error: 'The review stopped early: ' + parsed.stop_reason, tokens };
  const text = parsed.content?.find(b => b.type === 'text')?.text;
  try { return { status: 'valid', review: JSON.parse(text), tokens }; } catch { return { status: 'invalid', error: 'The review was not JSON', tokens }; }
}

// Converts the schema's empty strings and zeros back to absent fields.
function cleanDecision(d) {
  const c = d.condition || {};
  return { action: d.action, goalId: d.goalId || null, text: d.text || null, kind: d.kind, focus: d.focus, about: d.about || null,
    condition: c.type && c.type !== 'none' ? { type: c.type, item: c.item, atLeast: c.atLeast, place: c.place, job: c.job, count: c.count,
      requestId: c.requestId, withinHours: c.withinHours } : null,
    evidence: d.evidence || [] };
}

// Under the clock's lock: applies a received review to the resident it was for. recordEvents is db.mjs's.
export async function settleReview(db, village, claim, reply, recordEvents) {
  const read = readReply(reply);
  const actor = village.actors.find(a => a.id === claim.actorId);
  const minute = village.world.minute;
  let status = read.status, result = null, statement = null, eventId = null;
  if (read.status === 'valid') {
    if (!actor) status = 'actor_missing';
    else if (!actor.reviewDue || actor.reviewDue.since !== claim.since) status = 'superseded';
    else {
      const offered = (await db.query('SELECT offered FROM dalecrest.goal_reviews WHERE id=$1', [claim.id])).rows[0].offered;
      const before = activeGoals(actor).map(g => ({ ...g }));
      result = applyReview(actor, village, { decisions: (read.review.decisions || []).map(cleanDecision) }, { reviewId: claim.id, offered });
      status = 'applied';
      const changed = result.applied.filter(a => a.action !== 'keep');
      for (const a of changed) {
        const g = activeGoals(actor).find(x => x.id === a.goal) || before.find(x => x.id === a.goal);
        const text = a.action === 'retire' ? actor.name + ' gave up the goal “' + g.text + '”.' : actor.name + (a.action === 'new' ? ' took up a new goal: “' : ' revised a goal: “') + g.text + '”.';
        remember(actor, minute, text, [actor.id], 'goal', { goal: a.goal, reviewId: claim.id, importance: 6 });
      }
      statement = changed.length ? screenStatement(read.review.statement) : null;
      const proposed = read.review.eveningPlan;
      const plan = acceptEveningPlan(actor, village.world, claim.planOffer, proposed?.evening);
      const words = plan ? screenStatement(proposed.statement) : null;
      if (statement || words) {
        const at = village.map.places.find(p => p.id === actor.action.target);
        const place = at ? { x: r2(at.at[0]), y: r2(at.at[1]), id: at.id } : { x: r2(actor.position.x), y: r2(actor.position.y) };
        const source = { minute, actorIds: [actor.id], place };
        if (statement) {
          const [event] = await recordEvents(db, [{ ...source, type: 'intention',
            text: actor.name + ', in their own words: “' + statement + '”', outcome: { reviewId: claim.id, statedIntention: true } }]);
          eventId = event.id;
        }
        if (words && /^I(?:\s|['’])/.test(words)) {
          const [event] = await recordEvents(db, [{ ...source, type: 'plan',
            text: actor.name + ' planned an evening of writing: “' + words + '”',
            outcome: { eveningPlan: { ...plan, reviewId: claim.id, text: words } } }]);
          actor.songwriting.eveningPlan = { ...plan, reviewId: claim.id, eventId: event.id };
          result.eveningPlanEventId = event.id;
        }
      }
    }
  }
  await db.query(`UPDATE dalecrest.goal_reviews SET status=$2, response_at=clock_timestamp(), http_status=$3, response_body=$4,
      token_charge=coalesce($5, token_charge), error=$6, applied_minute=$7, result=$8, statement=$9, statement_event_id=$10 WHERE id=$1`,
    [claim.id, status, reply.status, reply.body, read.tokens || null, read.error || null, status === 'applied' ? minute : null,
      result && JSON.stringify(result), statement, eventId]);
  // A review that could not be used leaves the resident's goals as they were, and the review still due.
  return { status, result, statement };
}


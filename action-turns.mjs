import { DECISIONS_MODEL, DECISIONS_URL, actionBody, actionDescription, recalledFor } from './decisions.mjs';
import { activeGoals, goalKey } from './engine/goals.mjs';
import { memoryKey } from './engine/memory.mjs';
import { civicObservationKeys } from './engine/civic-news.mjs';
import { ballotOffers, mootAttendanceOpen } from './engine/civic.mjs';
import { availableActions, startChosen, locationsOf } from './sim.mjs';
import { residentState, writeActivities } from './decision-trace.mjs';
import { weatherAt } from './engine/seasons.mjs';
import { shapeActionMenu } from './engine/action-menu.mjs';
import { eveningPlanAudit } from './engine/songwriting.mjs';
import { writeResident } from './resident-store.mjs';

const villageHourlyCeiling = 480000;
export const hourlyActionBudget = Math.min(villageHourlyCeiling, Number(process.env.OPENAI_ACTION_TOKENS_PER_HOUR || villageHourlyCeiling));
const residentHourlyBudget = 48000;

// Both reservation and application run under the same world-row lock used by ticks.
export async function reserveAction(db, village, hourlyBudget) {
  const waiting = village.actors.filter(a => a.action.kind === 'waiting');
  if (!waiting.length) return;
  const { rows } = await db.query(`SELECT DISTINCT ON (actor_id) actor_id, decision_since, observed_minute, status,
    requested_at > now() - interval '1 minute' AS cooling FROM dalecrest.decision_traces
    WHERE decision_since IS NOT NULL AND actor_id=ANY($1) ORDER BY actor_id,id DESC`, [waiting.map(a => a.id)]);
  const recent = new Map(rows.map(row => [row.actor_id, row]));
  const turn = actor => {
    const last = recent.get(actor.id);
    return Math.max(actor.action.since, Number(last?.observed_minute ?? 0));
  };
  const pressing = actor => ballotOffers(actor, village).length ? 2 : Number(Boolean(actor.action.why?.startsWith('would run into')));
  const eligible = waiting.filter(actor => {
    const last = recent.get(actor.id);
    if (!last) return true;
    if (['received','requested'].includes(last.status)) return false;
    return Number(last.decision_since) !== actor.action.since || !last.cooling;
  // A choice that something is about to overtake is served first, then whoever has waited longest.
  }).sort((a,b) => pressing(b) - pressing(a) || turn(a) - turn(b));
  if (!eligible.length) return;
  // A rolling hour limits total use. A smaller burst allowance spreads decisions across the hour.
  const { rows: [usage] } = await db.query(`WITH recent AS (
      SELECT actor_id, token_charge, requested_at, id FROM dalecrest.decision_traces
      WHERE token_charge IS NOT NULL AND requested_at > now()-interval '1 hour')
    SELECT coalesce(max(charged),0)::int AS spent,
      (SELECT coalesce(jsonb_object_agg(actor_id, tokens), '{}'::jsonb)
       FROM (SELECT actor_id, sum(token_charge) AS tokens FROM recent GROUP BY actor_id) residents) AS by_actor,
      greatest(0, max(charged - elapsed * $1::numeric / 3600))::float8 AS debt
    FROM (SELECT sum(token_charge) OVER (ORDER BY requested_at DESC,id DESC) AS charged,
      extract(epoch FROM now()-requested_at) AS elapsed FROM recent) rolling`, [hourlyBudget]);
  if (usage.spent >= hourlyBudget) return { budgetLimited: true };
  const names = locationsOf(village.map, village.actors);
  const weather = weatherAt(village.world.minute, village.map.seed).text;
  let limited = false;
  for (const actor of eligible) {
    const diagnostics = {};
    const feasible = availableActions(actor, village, diagnostics);
    const { menu, audit, context } = shapeActionMenu(actor, village, feasible, diagnostics.ownTrade);
    if (!menu.size) continue;
    const body = actionBody(actor, village.world, menu, names, weather, context);
    // Reserve before sending. The provider's reported total replaces this estimate when available.
    const estimate = Math.ceil(Buffer.byteLength(body) / 3) + 80;
    const allowance = actor.id === 'robin' ? 60000 : residentHourlyBudget;
    if ((usage.by_actor[actor.id] || 0) + estimate > allowance || usage.spent + estimate > hourlyBudget ||
        usage.debt + estimate > Math.max(estimate, hourlyBudget / 4)) {
      limited = true;
      continue;
    }
    const goals = activeGoals(actor).map(g => goalKey(actor, g));
    const seen = [...new Set([...recalledFor(actor, village.world).map(m => memoryKey(actor, m)), ...civicObservationKeys(actor, village.world)])];
    const eveningPlan = eveningPlanAudit(actor, village.world, menu);
    if (eveningPlan) audit.eveningPlan = eveningPlan;
    const result = await db.query(`INSERT INTO dalecrest.decision_traces
      (actor_id,observed_minute,model,endpoint,request_body,decision_since,token_charge,goal_keys,observation_keys,menu_audit)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [actor.id, village.world.minute, DECISIONS_MODEL, DECISIONS_URL, body, actor.action.since, estimate, goals, seen, audit]);
    return { id: result.rows[0].id, body };
  }
  if (limited) return { budgetLimited: true };
}

// The menu can move on while a reply is on its way. The same activity offered for a different stretch
// of time is still what was chosen, so it starts instead of going back to the model.
const withoutMinutes = text => text?.replace(/ \(\d+ village minutes(?: after arrival)?\)\.$/, '');
export const sameOffer = (now, then) => now === then || withoutMinutes(now) === withoutMinutes(then);

export async function startChosenAction(db, trace, choice, village, recordEvents) {
  const actor = village.actors.find(a => a.id === trace.actor_id);
  if (!actor) return { status: 'actor_missing' };
  if (actor.action.kind !== 'waiting' || actor.action.since !== Number(trace.decision_since)) return { status: 'superseded' };
  const action = availableActions(actor, village).get(choice);
  const choices = JSON.parse(trace.request_body).questions[0].choices;
  const offered = choices.find(option => option.value === choice);
  if (!offered || !action || !sameOffer(actionDescription(action, locationsOf(village.map, village.actors)), offered.description)) return { status: 'unavailable' };
  const minute = village.world.minute;
  const state = residentState(actor);
  // The request's minute also distinguishes the current moot from an earlier one.
  const mootWasOffered = mootAttendanceOpen(village.world.moot, Number(trace.observed_minute))
    && choices.some(option => option.value === 'meeting:hall');
  const started = startChosen(actor, village, choice, { id: trace.id, model: trace.model, mootWasOffered });
  if (!started) return { status: 'unavailable' };
  await db.query(`UPDATE dalecrest.decision_traces SET ended_minute=$2,end_reason='replaced'
    WHERE actor_id=$1 AND status='applied' AND ended_minute IS NULL`, [actor.id, minute]);
  await writeResident(db, actor);
  if (started.ballot) await db.query('UPDATE dalecrest.world SET state=$1 WHERE id=1', [village.world]);
  await writeActivities(db, [{ actorId: actor.id, minute, basis: 'fresh', routine: started.routine, reason: started.why,
    traceId: trace.id, waited: started.waited, action: { kind: action.kind, label: action.label, target: action.target } }]);
  const hall = started.ballot && village.map.places.find(p => p.id === 'hall');
  const voting = { support: 'voted for', oppose: 'voted against', abstain: 'abstained on' };
  const [event] = await recordEvents(db, [started.ballot ? {
    minute, type: 'civic', actorIds: [actor.id], place: { id: 'hall', x: hall.x, y: hall.y },
    text: actor.name + ' ' + voting[action.choice] + ' ' + action.title + '.',
    outcome: { civic: 'ballot', mootId: action.mootId, proposalKey: action.proposalKey, choice: action.choice, traceId: trace.id },
  } : { minute, type: 'plan', actorIds: [actor.id], text: actor.name + ' chose the next activity: ' + action.label + '.' }]);
  await db.query(`INSERT INTO dalecrest.decision_steps(trace_id,minute,kind,details,event_id)
    VALUES ($1,$2,'selected',$3,$4)`, [trace.id, minute, residentState(actor), event.id]);
  return { status: 'applied', state };
}

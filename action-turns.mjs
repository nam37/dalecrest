import { DECISIONS_MODEL, DECISIONS_URL, actionBody, actionDescription } from './decisions.mjs';
import { availableActions, startChosen, locationsOf } from './sim.mjs';
import { residentState, writeActivities } from './decision-trace.mjs';
import { weatherAt } from './engine/seasons.mjs';

export const hourlyActionBudget = Number(process.env.OPENAI_ACTION_TOKENS_PER_HOUR || 7000);

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
  const pressing = actor => Number(Boolean(actor.action.why?.startsWith('would run into')));
  const eligible = waiting.filter(actor => {
    const last = recent.get(actor.id);
    if (!last) return true;
    if (['received','requested'].includes(last.status)) return false;
    return Number(last.decision_since) !== actor.action.since || !last.cooling;
  // A choice that something is about to overtake is served first, then whoever has waited longest.
  }).sort((a,b) => pressing(b) - pressing(a) || turn(a) - turn(b));
  if (!eligible.length) return;
  // A rolling hour limits total use. A smaller burst allowance spreads decisions across the hour.
  const { rows: [usage] } = await db.query(`SELECT coalesce(max(charged),0)::int AS spent,
      greatest(0, max(charged - elapsed * $1::numeric / 3600))::float8 AS debt
    FROM (SELECT sum(token_charge) OVER (ORDER BY requested_at DESC,id DESC) AS charged,
      extract(epoch FROM now()-requested_at) AS elapsed FROM dalecrest.decision_traces
      WHERE token_charge IS NOT NULL AND requested_at > now()-interval '1 hour') recent`, [hourlyBudget]);
  const actor = eligible[0];
  const menu = availableActions(actor, village);
  if (!menu.size) return;
  const body = actionBody(actor, village.world, menu, locationsOf(village.map, village.actors), weatherAt(village.world.minute, village.map.seed).text);
  // Reserve before sending. The provider's reported total replaces this estimate when available.
  const estimate = Math.ceil(Buffer.byteLength(body) / 3) + 80;
  if (usage.spent + estimate > hourlyBudget || usage.debt + estimate > Math.max(estimate, hourlyBudget / 4)) return { budgetLimited: true };
  const result = await db.query(`INSERT INTO dalecrest.decision_traces
    (actor_id,observed_minute,model,endpoint,request_body,decision_since,token_charge)
    VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [actor.id, village.world.minute, DECISIONS_MODEL, DECISIONS_URL, body, actor.action.since, estimate]);
  return { id: result.rows[0].id, body };
}

export async function startChosenAction(db, trace, choice, village, recordEvents) {
  const actor = village.actors.find(a => a.id === trace.actor_id);
  if (!actor) return { status: 'actor_missing' };
  if (actor.action.kind !== 'waiting' || actor.action.since !== Number(trace.decision_since)) return { status: 'superseded' };
  const action = availableActions(actor, village).get(choice);
  const offered = JSON.parse(trace.request_body).questions[0].choices.find(option => option.value === choice);
  if (!action || actionDescription(action, locationsOf(village.map, village.actors)) !== offered.description) return { status: 'unavailable' };
  const minute = village.world.minute;
  const state = residentState(actor);
  const started = startChosen(actor, village, choice, { id: trace.id, model: trace.model });
  if (!started) return { status: 'unavailable' };
  await db.query(`UPDATE dalecrest.decision_traces SET ended_minute=$2,end_reason='replaced'
    WHERE actor_id=$1 AND status='applied' AND ended_minute IS NULL`, [actor.id, minute]);
  await db.query('UPDATE dalecrest.actors SET state=$1 WHERE id=$2', [actor, actor.id]);
  await writeActivities(db, [{ actorId: actor.id, minute, basis: 'fresh', routine: started.routine, reason: started.why,
    traceId: trace.id, waited: started.waited, action: { kind: action.kind, label: action.label, target: action.target } }]);
  const [event] = await recordEvents(db, [{ minute, type: 'plan', actorIds: [actor.id],
    text: actor.name + ' chose the next activity: ' + action.label + '.' }]);
  await db.query(`INSERT INTO dalecrest.decision_steps(trace_id,minute,kind,details,event_id)
    VALUES ($1,$2,'selected',$3,$4)`, [trace.id, minute, residentState(actor), event.id]);
  return { status: 'applied', state };
}

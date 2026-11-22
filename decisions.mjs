import { recalledOvenStores } from './engine/observations.mjs';
import { recentMissedMeeting, socialContext, villageTime } from './engine/exchanges.mjs';
import { ownWorkContext } from './engine/village-work.mjs';
import { lifeContext } from './engine/lives.mjs';
import { buildingsContext, restDay } from './engine/workday.mjs';
import { visitorContext } from './engine/visitors.mjs';
import { storehouseContext } from './engine/storehouse.mjs';
import { recall } from './engine/memory.mjs';
import { activeGoals, goalContext } from './engine/goals.mjs';
import { preferredOuting } from './engine/foraging.mjs';

// The memories put before the action model: what bears on the people the resident's goals, marriage and
// open requests concern and on where they are, weighed against recency and importance.
export function recalledFor(actor, world) {
  const people = [...new Set([...activeGoals(actor).map(g => g.about), actor.spouse,
    ...Object.values(actor.helpBook || {}).flatMap(r => [r.askerId, r.helperId])])].filter(id => id && id !== actor.id);
  const options = { minute: world.minute, people, place: actor.action.target };
  const memories = recall(actor, options);
  const missed = recentMissedMeeting(actor, world.minute);
  if (!missed || memories.includes(missed)) return memories;
  return [...recall(actor, { ...options, limit: 5 }), missed].sort((a, b) => a.minute - b.minute);
}

export const DECISIONS_MODEL = 'gpt-6-luna';

const choices = [
  { value: 'work', description: 'Work at a trade or replenish village supplies.' },
  { value: 'social', description: 'Spend time with another resident or offer help.' },
  { value: 'rest', description: 'Go home to recover from fatigue.' },
  { value: 'food', description: 'Find a meal to satisfy hunger.' }
];

export const DECISIONS_URL = 'https://api.openai.com/v1/decisions';

// names maps a place ID to what residents call it, so a model never reads "cottage-3".
export function actionDescription(action, names = {}) {
  if (action.kind === 'review') return action.label + '.';
  if (action.kind === 'report') return action.label + ' and taking eyewitness notes (' + action.remaining + ' village minutes).';
  if (action.onSpot) return action.label + ' here (' + action.remaining + ' village minutes).';
  const at = ' at ' + (names[action.target]?.name || action.target);
  if (action.kind === 'conversation') {
    return 'Try to ' + action.label[0].toLowerCase() + action.label.slice(1) + at +
      ' if they are still there (' + action.remaining + ' village minutes after arrival).';
  }
  return action.label + at + ' (' + action.remaining + ' village minutes).';
}

// weather is what anyone out of doors can see and feel, in a few words. A resident also knows
// whether their own hearth had firewood this morning.
export function actionBody(actor, world, menu, names = {}, weather, menuContext = {}) {
  const last = actor.action.previous, hearth = actor.observations?.hearth;
  const outing = preferredOuting(actor, menu);
  const observation = {
    name: actor.name, role: actor.role, traits: actor.traits, goals: actor.goalBook ? goalContext(actor, names) : actor.goals,
    desires: actor.desires.map(({ focus, weight, target }) => ({ focus, weight, target })),
    ...(outing && { preferredActivity: outing }),
    ...menuContext,
    needs: Object.fromEntries(Object.entries(actor.needs).map(([need, value]) => [need, Math.round(value)])),
    lastActivity: last && { kind: last.kind, label: last.label, place: names[last.target]?.name || last.target },
    whyThisIsAChoice: actor.action.why,
    time: villageTime(world.minute), ...lifeContext(actor, world.minute), ...socialContext(actor, world.minute), ...ownWorkContext(actor, world),
    ...(weather && { weather }), ...(restDay(world.minute) && { dayOfRest: restDay(world.minute) }),
    ...visitorContext(actor, world, names), ...buildingsContext(actor, world, names), ...storehouseContext(actor, world, world.minute),
    ...(hearth && world.minute - hearth.minute < 1440 && !hearth.lit && { ownHearth: world.cottages?.[actor.home] ? 'Cold since this morning: the woodpile at home ran out.' : 'Cold since this morning: there was no firewood left in the common store for the hall.' }),
    lastOvenCheck: recalledOvenStores(actor, world.minute), recentMemories: recalledFor(actor, world).map(m => villageTime(m.minute) + ': ' + m.text)
  };
  const options = Array.from(menu, ([value, action]) => ({
    value, description: actionDescription(action, names)
  }));
  const review = options.some(o => o.value.startsWith('retain:'))
    ? ' Reconsider whether you still need the help using the new information. Use only the offered choices. A reported delivery tells you how much was added. Supplies can be used afterward.' : '';
  const preference = outing ? ' Favor the preferred activity when the resident’s needs and responsibilities allow, and decide whether this is a good time to go.' : '';
  return JSON.stringify({
    model: DECISIONS_MODEL, input: [{ role: 'user', content: [{ type: 'input_json', data: observation }] }],
    questions: [{ type: 'choice', name: 'next_action', choices: options,
      instructions: 'Choose the activity this resident will begin now. Weigh goals, needs (100 is urgent), time, weather and memories. The last oven check is what they personally counted then. Null means they have not checked. Stocks can change.' + preference + review }]
  });
}

export function decisionBody(observation) {
  return JSON.stringify({
    model: DECISIONS_MODEL,
    input: [{ role: 'user', content: [{ type: 'input_json', data: observation }] }],
    questions: [{ type: 'choice', name: 'priority', choices,
      instructions: 'Select this villager’s most plausible priority for the next few village hours. Use their goals, temperament, past encounters, available supplies and hour of day. Needs closer to 100 are more urgent.' }]
  });
}

export async function sendDecision(body, apiKey, request = fetch) {
  const response = await request(DECISIONS_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(30000)
  });
  const text = await response.text();
  // Some authentication errors echo credentials. Never persist an exact copy of our key.
  const redacted = text.includes(apiKey);
  return { status: response.status, requestId: response.headers.get('x-request-id'),
    body: redacted ? text.replaceAll(apiKey, '[credential redacted]') : text, redacted };
}

export function interpretDecision(observation, reply, question = { name: 'priority', choices }) {
  if (reply.status < 200 || reply.status >= 300) return { status: 'http_error', error: 'OpenAI HTTP ' + reply.status };
  let parsed;
  try { parsed = JSON.parse(reply.body); } catch { return { status: 'invalid_response', error: 'Invalid JSON response' }; }
  const answer = Array.isArray(parsed?.answers) && parsed.answers.find(a => a?.name === question.name);
  const invalid = 'OpenAI returned no valid ' + question.name;
  if (answer?.type === 'refusal') return { status: 'refused', error: invalid };
  if (answer?.type !== 'choice' || !question.choices.some(c => c.value === answer.choice)) return { status: 'invalid_response', error: invalid };
  const focus = answer.choice;
  if (question.name === 'next_action') return { status: 'valid', focus, confidence: Number.isFinite(answer.confidence) ? answer.confidence : null };
  const need = { food: 'hunger', social: 'loneliness', rest: 'fatigue' }[focus];
  const reason = need ? 'At decision time, ' + need + ' was ' + Math.round(observation.needs[need]) + '/100.'
    : 'Recorded work goal: ' + observation.goals[0] + '.';
  return { status: 'valid', focus, reason, confidence: Number.isFinite(answer.confidence) ? answer.confidence : null };
}

export async function choosePriority(observation, apiKey, request = fetch) {
  const result = interpretDecision(observation, await sendDecision(decisionBody(observation), apiKey, request));
  if (result.error) throw new Error(result.error);
  return { focus: result.focus, reason: result.reason };
}

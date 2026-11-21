import { recalledOvenStores } from './engine/observations.mjs';

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
  return action.label + ' at ' + (names[action.target]?.name || action.target) + ' (' + action.remaining + ' village minutes).';
}

// weather is what anyone out of doors can see and feel, in a few words. A resident also knows
// whether their own hearth had firewood this morning.
export function actionBody(actor, world, menu, names = {}, weather) {
  const time = world.minute % 1440, last = actor.action.previous, hearth = actor.observations?.hearth;
  const observation = {
    name: actor.name, role: actor.role, traits: actor.traits, goals: actor.goals,
    desires: actor.desires.map(({ focus, weight, target }) => ({ focus, weight, target })),
    needs: Object.fromEntries(Object.entries(actor.needs).map(([need, value]) => [need, Math.round(value)])),
    lastActivity: last && { kind: last.kind, label: last.label, place: names[last.target]?.name || last.target },
    whyThisIsAChoice: actor.action.why,
    time: [Math.floor(time / 60), time % 60].map(n => String(n).padStart(2, '0')).join(':'),
    ...(weather && { weather }),
    ...(hearth && world.minute - hearth.minute < 1440 && !hearth.lit && { ownHearth: 'Cold since this morning: there was no firewood left in the common store.' }),
    lastOvenCheck: recalledOvenStores(actor, world.minute), recentMemories: actor.memories.slice(-2).map(m => m.text)
  };
  const options = Array.from(menu, ([value, action]) => ({
    value, description: actionDescription(action, names)
  }));
  return JSON.stringify({
    model: DECISIONS_MODEL, input: [{ role: 'user', content: [{ type: 'input_json', data: observation }] }],
    questions: [{ type: 'choice', name: 'next_action', choices: options,
      instructions: 'Choose the activity this resident will begin now. Weigh goals, needs (100 is urgent), time, weather and memories. The last oven check is what they personally counted then. Null means they have not checked. Stocks can change.' }]
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

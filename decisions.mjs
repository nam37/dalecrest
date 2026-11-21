export const DECISIONS_MODEL = 'gpt-6-luna';

const choices = [
  { value: 'work', description: 'Work at a trade or replenish village supplies.' },
  { value: 'social', description: 'Spend time with another resident or offer help.' },
  { value: 'rest', description: 'Go home to recover from fatigue.' },
  { value: 'food', description: 'Find a meal to satisfy hunger.' }
];

export const DECISIONS_URL = 'https://api.openai.com/v1/decisions';

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

export function interpretDecision(observation, reply) {
  if (reply.status < 200 || reply.status >= 300) return { status: 'http_error', error: 'OpenAI HTTP ' + reply.status };
  let parsed;
  try { parsed = JSON.parse(reply.body); } catch { return { status: 'invalid_response', error: 'Invalid JSON response' }; }
  const answer = Array.isArray(parsed?.answers) && parsed.answers.find(a => a?.name === 'priority');
  if (answer?.type === 'refusal') return { status: 'refused', error: 'OpenAI returned no valid priority' };
  if (answer?.type !== 'choice' || !choices.some(c => c.value === answer.choice)) return { status: 'invalid_response', error: 'OpenAI returned no valid priority' };
  const focus = answer.choice;
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

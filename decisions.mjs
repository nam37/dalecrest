export const DECISIONS_MODEL = 'gpt-6-luna';

const choices = [
  { value: 'work', description: 'Work at a trade or replenish village supplies.' },
  { value: 'social', description: 'Spend time with another resident or offer help.' },
  { value: 'rest', description: 'Go home to recover from fatigue.' },
  { value: 'food', description: 'Find a meal to satisfy hunger.' }
];

export async function choosePriority(observation, apiKey, request = fetch) {
  const response = await request('https://api.openai.com/v1/decisions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: DECISIONS_MODEL,
      input: [{ role: 'user', content: [{ type: 'input_json', data: observation }] }],
      questions: [{ type: 'choice', name: 'priority', choices,
        instructions: 'Select this villager’s most plausible priority for the next few village hours. Use their goals, temperament, past encounters, available supplies and hour of day. Needs closer to 100 are more urgent.' }]
    }),
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error('OpenAI HTTP ' + response.status);
  const answer = (await response.json()).answers?.find(a => a.name === 'priority');
  if (answer?.type !== 'choice' || !choices.some(c => c.value === answer.choice)) throw new Error('OpenAI returned no valid priority');
  const focus = answer.choice;
  const need = { food: 'hunger', social: 'loneliness', rest: 'fatigue' }[focus];
  const reason = need ? 'At decision time, ' + need + ' was ' + Math.round(observation.needs[need]) + '/100.'
    : 'Recorded work goal: ' + observation.goals[0] + '.';
  return { focus, reason };
}

import { FOCUSES } from './sim.mjs';
import { snapshot, savePlan } from './db.mjs';

const model = process.env.OLLAMA_MODEL?.trim();
export const plannerStatus = { configured: Boolean(model), model: model || null, state: model ? 'starting' : 'local rules' };
const base = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const schema = {
  type: 'object', additionalProperties: false, required: ['focus', 'reason'],
  properties: { focus: { type: 'string', enum: FOCUSES }, reason: { type: 'string' } }
};
let inFlight = false;

export async function planOnce() {
  if (!model || inFlight) return;
  inFlight = true;
  try {
    const { world, actors } = await snapshot();
    const actor = actors.filter(a => !a.plan || a.plan.until <= world.minute)
      .sort((a, b) => (a.lastModelPlanAt ?? -1) - (b.lastModelPlanAt ?? -1))[0];
    if (!actor) return;
    const knownPeople = actors.filter(a => a.id !== actor.id).map(a => ({ name: a.name, affinity: actor.relationships[a.id] }));
    const observation = {
      name: actor.name, role: actor.role, background: actor.backstory, traits: actor.traits,
      goals: actor.goals, desires: actor.desires, needs: actor.needs, currentActivity: actor.action.label,
      recentMemories: actor.memories.slice(-4), knownPeople,
      hour: Math.floor(world.minute / 60) % 24, sharedStores: world.supplies
    };
    const response = await fetch(new URL('/api/chat', base), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: false, think: false, format: schema, options: { num_ctx: 4096, num_predict: 170 },
        messages: [
          { role: 'system', content: 'Choose a priority for the next few hours as this medieval villager. Needs near 100 are urgent. Choose one allowed focus. Give one brief, specific first-person intention, with a truthful reason grounded in the observations. Do not claim an action already happened. Reply with a JSON object containing focus and reason.' },
          { role: 'user', content: JSON.stringify(observation) }
        ] }),
      signal: AbortSignal.timeout(90000)
    });
    if (!response.ok) throw new Error('Model request failed');
    const result = JSON.parse((await response.json()).message.content);
    if (!FOCUSES.includes(result.focus) || typeof result.reason !== 'string' || !result.reason.trim()) throw new Error('Invalid plan');
    await savePlan(actor.id, world.minute, result.focus, result.reason.trim().slice(0, 320), model);
    plannerStatus.state = 'connected';
  } catch {
    plannerStatus.state = 'offline · local rules active';
  } finally { inFlight = false; }
}

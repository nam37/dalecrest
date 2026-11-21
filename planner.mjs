import { FOCUSES } from './sim.mjs';
import { snapshot, savePlan, claimAction, recordReply, recordTransportFailure, pendingDecision, applyRecordedDecision } from './db.mjs';
import { sendDecision, DECISIONS_MODEL } from './decisions.mjs';
import { hourlyActionBudget } from './action-turns.mjs';
import { setTimeout as delay } from 'node:timers/promises';

const decisions = process.env.PLANNER_PROVIDER === 'openai';
const model = decisions ? DECISIONS_MODEL : process.env.OLLAMA_MODEL?.trim();
const key = process.env.OPENAI_API_KEY?.trim();
if (decisions && (!Number.isSafeInteger(hourlyActionBudget) || hourlyActionBudget < 0)) throw new Error('Set a nonnegative hourly action token budget.');
export const plannerPollMs = decisions ? 2000 : 20000;
export const plannerStatus = { configured: Boolean(model), model: model || null, state: decisions && !key ? 'awaiting API key · residents waiting' : model ? 'ready' : 'local rules' };
const base = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const schema = {
  type: 'object', additionalProperties: false, required: ['focus', 'reason'],
  properties: { focus: { type: 'string', enum: FOCUSES }, reason: { type: 'string' } }
};
let inFlight = false;

async function finishDecision(id) {
  const result = await applyRecordedDecision(id);
  if (result?.error) throw new Error(result.error);
  if (result?.status === 'applied') plannerStatus.state = 'connected';
}

export async function planOnce() {
  if (!model || inFlight) return;
  inFlight = true;
  try {
    if (decisions) {
      const pending = await pendingDecision();
      if (pending) { await finishDecision(pending); return; }
      if (!key) return;
      const ticket = await claimAction(hourlyActionBudget);
      if (!ticket) return;
      if (ticket.budgetLimited) { plannerStatus.state = 'waiting for token budget'; return; }
      const { id, body } = ticket;
      let reply;
      try { reply = await sendDecision(body, key); }
      catch (error) { await recordTransportFailure(id); throw error; }
      // Retry saving the same reply after a transient database disconnect.
      for (let attempt = 1; ; attempt++) {
        try { await recordReply(id, reply); break; }
        catch (error) {
          if (attempt === 3) throw error;
          await delay(attempt * 1000);
        }
      }
      await finishDecision(id);
      return;
    }
    const { world, actors } = await snapshot();
    const actor = actors.filter(a => a.plan?.model !== model || a.plan.until <= world.minute)
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
  } catch (error) {
    const status = decisions && /^OpenAI HTTP \d{3}$/.test(error.message) ? error.message : 'offline';
    plannerStatus.state = status + (decisions ? ' · residents waiting' : ' · local rules active');
  } finally { inFlight = false; }
}

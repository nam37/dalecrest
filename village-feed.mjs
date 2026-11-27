// What a visitor's page is sent of the village. The page shows a resident's last few memories and
// settled goals, so only those travel. Planner instructions, private observations and reports stay on
// the server, and the world's moot history reaches the page through the affairs summary instead.
export const FEED_PARTS = ['memories', 'goalHistory', 'goalBook'];
export const SHOWN_MEMORIES = 4;
export const SHOWN_GOALS = 2;
const SETTLED = new Set(['met', 'missed', 'overtaken']);
const PRIVATE = ['observations', 'instructions', 'reports', 'requestMemories'];
const WORLD_PRIVATE = ['mootHistory', 'told'];

export function publicResident(actor) {
  const shown = { ...actor };
  for (const key of PRIVATE) delete shown[key];
  if (Array.isArray(actor.memories)) shown.memories = actor.memories.slice(-SHOWN_MEMORIES);
  if (Array.isArray(actor.goalHistory)) shown.goalHistory = actor.goalHistory.filter(g => SETTLED.has(g.status)).slice(-SHOWN_GOALS);
  return shown;
}

export function publicVillage(state) {
  const world = { ...state.world };
  for (const key of WORLD_PRIVATE) delete world[key];
  return { ...state, world, actors: state.actors.map(publicResident) };
}

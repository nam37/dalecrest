// What the hour and the residents lend to both views: how light it is, and which hearths are lit.

// day is 0 through the night and 1 at noon. dark is its complement, easing quickly after dawn.
// dusk is the warm band around sunrise and sunset.
export function light(minute) {
  const m = ((minute % 1440) + 1440) % 1440, p = (m - 300) / 930;
  const day = p > 0 && p < 1 ? Math.sin(Math.PI * p) : 0;
  const bright = Math.min(1, day * 2.4);
  const dusk = Math.max(0, 1 - Math.min(Math.abs(m - 300), Math.abs(m - 1230)) / 85);
  return { minute: m, p, day, bright, dark: 1 - bright, dusk, night: bright < 0.35 };
}

// Buildings with someone inside: a home being slept or rested in, an oven in use, the hall during
// a moot, the alehouse of an evening. They smoke by day and glow by night.
export function hearths(map, actors) {
  const lit = new Set();
  for (const a of actors) {
    const action = a.action;
    if (!action || action.phase !== 'working') continue;
    if (action.kind === 'rest' || action.kind === 'meeting' || (action.kind === 'leisure' && action.target !== 'green')
      || (action.kind === 'work' && (action.job === 'bake' || action.job === 'weave'))) lit.add(action.target);
  }
  return map.places.filter(p => p.w && p.kind !== 'field' && p.stage === 2 && lit.has(p.id));
}

// A resident who is indoors and out of sight.
export const indoors = actor => actor.action?.kind === 'rest' && actor.action.phase === 'working';
